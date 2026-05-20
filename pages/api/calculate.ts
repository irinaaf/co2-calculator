import type { NextApiRequest, NextApiResponse } from "next";
import { geocodeOne, fetchJourneysWideWindow, fetchBicycleRoute } from "@/lib/entur";
import { getRoadDistance } from "@/lib/routing";
import { detectFerryCrossingsFromPoints, type FerryCrossing } from "@/lib/ferries";
import {
  calcJourneyResult,
  MODES,
  type JourneyResult,
} from "@/lib/emissions";

// ─────────────────────────────────────────────────────────────────
// Rate limiting (in-memory per IP, 20 req/min)
// ─────────────────────────────────────────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string, maxPerMinute = 20): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > maxPerMinute;
}

// ─────────────────────────────────────────────────────────────────
// Request / Response types
// ─────────────────────────────────────────────────────────────────

export interface CalculateRequest {
  from: string;
  to: string;
  /** ISO datetime string, e.g. "2026-05-20T08:00" — defaults to now+1h */
  dateTime?: string;
  workDays?: number;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  displayName: string;
}

/**
 * One "scenario" shown in the UI as a card.
 *
 * type:
 *   "transit"  — public transport only (from Entur)
 *   "car"      — private car only (EV or petrol, distance-based)
 *   "combined" — Park & Ride: car to station + public transit
 *   "bicycle"  — bicycle-only route via OSM cycleways (Entur OTP)
 */
export type ScenarioType = "transit" | "car" | "combined" | "bicycle";

export interface Scenario {
  type: ScenarioType;
  title: string;         // e.g. "Public transport"
  subtitle: string;      // e.g. "🚌 Bus + ⛴️ Ferry · 1h 25m"
  journey: JourneyResult | null;  // null for pure-car scenarios
  /** For car/combined: simple per-mode results */
  carVariants?: CarVariant[];
  bicycleRoute?: BicycleScenario;
}

export interface CarVariant {
  label: string;   // "EV (electric)", "Petrol"
  emoji: string;
  co2Kg: number;
  annualCo2Kg: number;
  costNok: number;
  durationMinutes: number;
  color: string;
}

export interface BicycleScenario {
  distanceKm: number;
  durationMinutes: number;
  /** True if Entur OTP routed at least partly on dedicated cycleways */
  hasCycleways: boolean;
  annualCo2Kg: number; // always 0
  /** Estimated annual savings vs car petrol */
  savingVsCarKg: number;
}

export interface CalculateResponse {
  from: GeoPoint;
  to: GeoPoint;
  /** Straight-line distance km */
  distanceKm: number;
  /** Road distance km (haversine × 1.25 correction) */
  roadDistanceKm: number;
  routingProvider: string;
  scenarios: Scenario[];
  /** Transport modes not available on this route (e.g. ["flight", "train"]) */
  unavailableModes: string[];
  /** Ferry crossings detected on this route — informational only, not added to CO₂ total */
  ferryCrossings: FerryCrossing[];
  error?: string;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Build car-only CarVariant[] for a given road distance */
function buildCarVariants(
  roadKm: number,
  workDays: number
): CarVariant[] {
  const alwaysModes = ["car_ev", "car_petrol", "car_diesel"] as const;
  // Show bicycle & walking only for short urban distances
  const urbanModes = roadKm <= 25 ? (["bicycle", "foot"] as const) : [];
  const allModes = [...alwaysModes, ...urbanModes];
  return allModes.map((id) => {
    const cfg = MODES.find((m) => m.id === id)!;
    const co2Kg  = parseFloat((cfg.co2PerKm * roadKm).toFixed(3));
    const costNok = parseFloat((cfg.costPerKm * roadKm).toFixed(0));
    return {
      label: cfg.label,
      emoji: cfg.emoji,
      co2Kg,
      annualCo2Kg: parseFloat((co2Kg * 2 * workDays).toFixed(1)),
      costNok,
      durationMinutes: Math.round((roadKm / cfg.avgSpeedKmh) * 60),
      color: cfg.color,
    };
  });
}

/**
 * Build a synthetic "combined" journey:
 * First leg = car to nearest transit hub (~15 km avg),
 * remaining legs = best Entur transit journey.
 *
 * This is a heuristic model — in a full app you'd query Entur with
 * accessModes: ["car"] which requires a stops-db lookup.
 */
function buildCombinedJourney(
  transitJourney: JourneyResult,
  roadKm: number,
  workDays: number
): JourneyResult {
  // Estimate car leg to first transit stop
  // Assume ~15 km drive OR 20% of road distance, whichever is smaller
  const carLegKm = Math.min(15, roadKm * 0.2);

  const evMode = MODES.find((m) => m.id === "car_ev")!;
  const co2CarLeg  = parseFloat((evMode.co2PerKm * carLegKm).toFixed(3));
  const durCarMins = Math.round((carLegKm / evMode.avgSpeedKmh) * 60);

  // Synthetic car leg
  const carLeg = {
    fromName: "Origin (car)",
    toName: transitJourney.legs[0]?.fromName ?? "Station",
    mode: "car_ev" as const,
    modeLabel: `⚡ Car (EV) · ~${carLegKm} km`,
    emoji: "⚡",
    distanceKm: carLegKm,
    durationMinutes: durCarMins,
    durationSeconds: durCarMins * 60,
    co2Kg: co2CarLeg,
    co2PerKm: evMode.co2PerKm,
    operatorName: null,
    lineName: null,
    color: evMode.color,
  };

  const allLegs = [carLeg, ...transitJourney.legs];
  const totalCo2 = parseFloat(
    allLegs.reduce((s, l) => s + l.co2Kg, 0).toFixed(3)
  );
  const totalDur = durCarMins + transitJourney.durationMinutes;

  return {
    durationMinutes: totalDur,
    durationSeconds: totalDur * 60,
    totalCo2Kg: totalCo2,
    annualCo2Kg: parseFloat((totalCo2 * 2 * workDays).toFixed(1)),
    legs: allLegs,
  };
}

// ─────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────

/**
 * Detect which simple modes are NOT present in any Entur journey leg.
 * Used to show "N/A" labels in the UI for unavailable transport types.
 */
function detectUnavailable(journeys: import("@/lib/emissions").JourneyResult[]): string[] {
  const presentModes = new Set(journeys.flatMap((j) => j.legs.map((l) => l.mode)));
  const unavailable: string[] = [];
  if (!presentModes.has("air"))  unavailable.push("flight");
  if (!presentModes.has("rail")) unavailable.push("train");
  return unavailable;
}


type ApiResult = CalculateResponse | { error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const ip =
    (req.headers?.["x-forwarded-for"] as string | undefined)?.split(",")[0].trim() ??
    req.socket?.remoteAddress ??
    "unknown";
  if (process.env.NODE_ENV !== "test" && isRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests — try again in a minute" });
  }

  const { from, to, dateTime, workDays } = req.body as CalculateRequest;

  if (!from || !to) {
    return res.status(400).json({ error: "from and to are required" });
  }

  const days = Math.min(Math.max(Number(workDays) || 220, 1), 365);

  let departure: Date;
  try {
    if (dateTime) {
      // datetime-local sends "YYYY-MM-DDTHH:MM" without timezone.
      // Treat it as Norway time (Europe/Oslo = UTC+1 in winter, UTC+2 in summer).
      // Append ":00" and let Intl resolve the offset, then rebuild as UTC.
      const local = new Date(dateTime + ":00");
      // Get Norway offset in minutes at that moment
      const formatter = new Intl.DateTimeFormat("en", { timeZone: "Europe/Oslo", timeZoneName: "shortOffset" });
      const offsetStr = formatter.formatToParts(local).find((p) => p.type === "timeZoneName")?.value ?? "GMT+2";
      const offsetMatch = offsetStr.match(/GMT([+-])(\d+)/);
      const offsetHours = offsetMatch ? parseInt(offsetMatch[2]) * (offsetMatch[1] === "+" ? 1 : -1) : 2;
      departure = new Date(local.getTime() - offsetHours * 3_600_000);
    } else {
      departure = new Date(Date.now() + 3_600_000);
    }
    if (isNaN(departure.getTime())) throw new Error("bad date");
  } catch {
    departure = new Date(Date.now() + 3_600_000);
  }

  try {
    // ── 1. Geocode ───────────────────────────────────────────────
    const [fromGeo, toGeo] = await Promise.all([
      geocodeOne(from),
      geocodeOne(to),
    ]);

    const fromPoint: GeoPoint = { lat: fromGeo.lat, lon: fromGeo.lon, displayName: fromGeo.label };
    const toPoint:   GeoPoint = { lat: toGeo.lat,   lon: toGeo.lon,   displayName: toGeo.label  };

    const distanceKm  = parseFloat(haversineKm(fromPoint.lat, fromPoint.lon, toPoint.lat, toPoint.lon).toFixed(1));

    // ── 2. Get real road distance (OSRM / Google Maps) ───────────
    const roadInfo = await getRoadDistance(fromPoint.lat, fromPoint.lon, toPoint.lat, toPoint.lon);
    const roadDistanceKm = roadInfo.distanceKm;

    // ── 3. Fetch Entur journey options ───────────────────────────
    // Run transit + bicycle fetch in parallel for performance
    const bicyclePromise = distanceKm <= 30
      ? fetchBicycleRoute(fromPoint.lat, fromPoint.lon, toPoint.lat, toPoint.lon, departure)
      : Promise.resolve(null);

    const rawJourneys = await fetchJourneysWideWindow(
      fromPoint.lat, fromPoint.lon,
      toPoint.lat,   toPoint.lon,
      departure,
      4,  // ±4 hours window
      2,  // step 2 hours
      9   // up to 9 unique — ensures 2-3 ground options after air filter
    );

    const transitJourneys = rawJourneys
      .map((j) => calcJourneyResult(j, days, j.queryDateTime))
      .sort((a, b) => a.totalCo2Kg - b.totalCo2Kg);

    // Replace generic "Origin"/"Destination" placeholders from Entur
    // with real display names from the geocoder.
    // Entur returns these placeholders for coordinate-based (non-stop) queries.
    const fromLabel = fromPoint.displayName.split(",")[0].trim();
    const toLabel   = toPoint.displayName.split(",")[0].trim();

    const replacePlaceholder = (name: string): string => {
      if (name === "Origin" || name === "origin") return fromLabel;
      if (name === "Destination" || name === "destination") return toLabel;
      return name;
    };

    const processedJourneys = transitJourneys.map((journey) => ({
      ...journey,
      legs: journey.legs.map((leg) => ({
        ...leg,
        fromName: replacePlaceholder(leg.fromName),
        toName:   replacePlaceholder(leg.toName),
      })),
    }));

    const bikeResult = await bicyclePromise;

    // ── 4. Build scenarios ───────────────────────────────────────

    const scenarios: Scenario[] = [];

    // SCENARIO 1: Public transport — show all Entur options
    if (processedJourneys.length > 0) {
      // Best transit journey = first (lowest CO₂)
      const best = processedJourneys[0];
      scenarios.push({
        type: "transit",
        title: "Public transport only",
        subtitle: best.legs.map((l) => l.mode).filter((m) => m !== "foot").join(" + ") +
          ` · ${best.durationMinutes} min`,
        journey: best,
      });
      processedJourneys.slice(1).forEach((j, i) => {
        scenarios.push({
          type: "transit",
          title: `Public transport — option ${i + 2}`,
          subtitle: j.legs.map((l) => l.mode).filter((m) => m !== "foot").join(" + ") +
            ` · ${j.durationMinutes} min`,
          journey: j,
        });
      });
    } else {
      // No Entur routes — placeholder
      scenarios.push({
        type: "transit",
        title: "Public transport only",
        subtitle: "No routes found via Entur for this origin/destination",
        journey: null,
      });
    }

    // SCENARIO 2: Private car only
    const carVariants = buildCarVariants(roadDistanceKm, days);
    scenarios.push({
      type: "car",
      title: "Private car only",
      subtitle: `~${roadDistanceKm} km road distance`,
      journey: null,
      carVariants,
    });

    // SCENARIO 3: Combined (P+R / car + transit)
    if (processedJourneys.length > 0) {
      const combined = buildCombinedJourney(processedJourneys[0], roadDistanceKm, days);
      scenarios.push({
        type: "combined",
        title: "Car + Public transport (P+R)",
        subtitle: `Drive to station · then ${processedJourneys[0].legs.filter((l) => l.mode !== "foot").map((l) => l.mode).join(" + ")}`,
        journey: combined,
      });
    }

    // SCENARIO 4: Bicycle (only if ≤ 30 km)
    if (distanceKm <= 30) {
      // Estimate petrol car CO₂ for savings calculation
      const carPetrol = MODES.find((m) => m.id === "car_petrol")!;
      const carCo2PerTrip = carPetrol.co2PerKm * roadDistanceKm;
      const savingVsCarKg = parseFloat((carCo2PerTrip * 2 * days).toFixed(1));

      if (bikeResult) {
        // Entur returned a real OSM bicycle route
        scenarios.push({
          type: "bicycle",
          title: "Bicycle",
          subtitle: bikeResult.hasCycleways
            ? "Route via dedicated cycleways (OSM)"
            : "Route via roads and paths (OSM)",
          journey: null,
          bicycleRoute: {
            distanceKm: parseFloat((bikeResult.distanceMetres / 1000).toFixed(1)),
            durationMinutes: Math.round(bikeResult.durationSeconds / 60),
            hasCycleways: bikeResult.hasCycleways,
            annualCo2Kg: 0,
            savingVsCarKg,
          },
        });
      } else {
        // Fallback: straight-line estimate if Entur bike query failed
        const bikeSpeed = 15; // km/h average
        scenarios.push({
          type: "bicycle",
          title: "Bicycle",
          subtitle: "Distance-based estimate (OSM routing unavailable)",
          journey: null,
          bicycleRoute: {
            distanceKm: parseFloat(distanceKm.toFixed(1)),
            durationMinutes: Math.round((distanceKm / bikeSpeed) * 60),
            hasCycleways: false,
            annualCo2Kg: 0,
            savingVsCarKg,
          },
        });
      }
    }

    // Detect ferry crossings for informational display
    const ferryCrossings = detectFerryCrossingsFromPoints(
      fromPoint.lat, fromPoint.lon,
      toPoint.lat, toPoint.lon
    );

    return res.status(200).json({
      from: fromPoint,
      to: toPoint,
      distanceKm,
      roadDistanceKm,
      routingProvider: roadInfo.provider,
      scenarios,
      unavailableModes: processedJourneys.length > 0
        ? detectUnavailable(processedJourneys)
        : ["train", "flight"],
      ferryCrossings,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
}
