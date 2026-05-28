/**
 * Entur Journey Planner v3 — GraphQL client
 * 
 * Docs: https://developer.entur.org/pages-journeyplanner-journeyplanner
 * Endpoint: https://api.entur.io/journey-planner/v3/graphql
 * Auth: ET-Client-Name header required (free, no token needed)
 *
 * Geocoder: https://developer.entur.org/pages-geocoder-api
 * Endpoint: https://api.entur.io/geocoder/v1/autocomplete
 */

const JP_ENDPOINT =
  "https://api.entur.io/journey-planner/v3/graphql";

const GEO_ENDPOINT =
  "https://api.entur.io/geocoder/v1/autocomplete";

// Identify our app to Entur (required by their ToS, no token needed)
const CLIENT_NAME = "portfolio-co2-calculator";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** Entur transport mode values returned in TripPattern legs */
export type EnturMode =
  | "rail"
  | "bus"
  | "coach"
  | "tram"
  | "metro"
  | "water"      // ferry + hurtigbåt
  | "air"
  | "foot"
  | "bicycle"
  | "bicycle_rent"
  | "unknown";

/** One leg of a journey (e.g. Bus Rissa→Rørvik, then Ferry Rørvik→Flakk) */
export interface JourneyLeg {
  mode: EnturMode;
  /** Distance in metres */
  distanceMetres: number;
  /** Duration in seconds */
  durationSeconds: number;
  /** Human-readable departure stop */
  fromName: string;
  /** Human-readable arrival stop */
  toName: string;
  /** Operator name (e.g. "AtB", "Ruter", "Vy") — used for EV-bus coefficient */
  operatorName: string | null;
  /** Line name/number e.g. "315", "Flakk–Rørvik" */
  lineName: string | null;
  /** Sub-mode: can be "localBus", "railReplacementBus", "highSpeedPassengerService" etc. */
  subMode: string | null;
}

/** One complete journey option (a TripPattern in Entur terminology) */
export interface JourneyOption {
  /** Total duration in seconds */
  durationSeconds: number;
  legs: JourneyLeg[];
}

/** Raw GeoJSON feature returned by Entur geocoder */
interface RawGeoFeature {
  properties: { label: string; layer: string };
  geometry: { coordinates: [number, number] };
}

/** Raw leg object inside a TripPattern from Entur Journey Planner */
interface RawLeg {
  mode: string;
  distance: number | null;
  duration: number | null;
  fromPlace: { name: string } | null;
  toPlace: { name: string } | null;
  operator: { name: string } | null;
  line: { publicCode: string } | null;
  transportSubmode: string | null;
}

/** Raw TripPattern object from Entur Journey Planner */
interface RawTripPattern {
  duration: number;
  legs: RawLeg[];
}

/** Raw GraphQL error object */
interface RawGraphQLError {
  message: string;
}

/** Result from the geocoder */
export interface GeoFeature {
  label: string;    // display name
  lat: number;
  lon: number;
  layer: string;    // "venue", "stop", "address", "locality", etc.
}

/** Result from fetchBicycleRoute */
export interface BicycleRoute {
  distanceMetres: number;
  durationSeconds: number;
  /** OSM-based: true if the planner found dedicated cycle infrastructure */
  hasCycleways: boolean;
}

// ─────────────────────────────────────────────────────────────────
// Geocoder — autocomplete (for UI)
// ─────────────────────────────────────────────────────────────────

export async function geocodeAutocomplete(
  text: string,
  size = 5
): Promise<GeoFeature[]> {
  const params = new URLSearchParams({
    text,
    size: String(size),
    lang: "no",
    // restrict to Norway
    boundary_country_code: "NO",
  });

  const res = await fetch(`${GEO_ENDPOINT}?${params}`, {
    headers: { "ET-Client-Name": CLIENT_NAME },
  });

  if (!res.ok) throw new Error(`Entur geocoder error: ${res.status}`);

  const json = await res.json();

  return (json.features ?? [] as RawGeoFeature[]).map((f: RawGeoFeature) => ({
    label: f.properties.label,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    layer: f.properties.layer,
  }));
}

// ─────────────────────────────────────────────────────────────────
// Geocoder — single resolve (for API route)
// ─────────────────────────────────────────────────────────────────

export async function geocodeOne(query: string): Promise<GeoFeature> {
  const results = await geocodeAutocomplete(query, 1);
  if (!results.length) throw new Error(
    `Could not find location: "${query}". Try a more specific address, a nearby town name, or a transit stop name.`
  );
  return results[0];
}

// ─────────────────────────────────────────────────────────────────
// Journey Planner — fetch trip options
// ─────────────────────────────────────────────────────────────────

const TRIP_QUERY = /* GraphQL */ `
  query Trip(
    $fromLat: Float!
    $fromLon: Float!
    $toLat: Float!
    $toLon: Float!
    $dateTime: DateTime!
    $numTrips: Int!
  ) {
    trip(
      from: { coordinates: { latitude: $fromLat, longitude: $fromLon } }
      to:   { coordinates: { latitude: $toLat,   longitude: $toLon   } }
      dateTime: $dateTime
      numTripPatterns: $numTrips
    ) {
      tripPatterns {
        duration
        legs {
          mode
          distance
          duration
          fromPlace { name }
          toPlace   { name }
          operator  { name }
          line      { publicCode }
          transportSubmode
        }
      }
    }
  }
`;

/**
 * Fetch up to `numTrips` journey options from Entur Journey Planner.
 * Returns an empty array if no routes found (e.g. remote location
 * with no public transport).
 */
export async function fetchJourneyOptions(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  dateTime: Date,
  numTrips = 3
): Promise<JourneyOption[]> {
  const body = JSON.stringify({
    query: TRIP_QUERY,
    variables: {
      fromLat,
      fromLon,
      toLat,
      toLon,
      // Entur expects ISO 8601 with timezone
      dateTime: dateTime.toISOString(),
      numTrips,
    },
  });

  const res = await fetch(JP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ET-Client-Name": CLIENT_NAME,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Entur Journey Planner error: ${res.status}`);
  }

  const json = await res.json();

  if (json.errors?.length) {
    throw new Error(
      `Entur GraphQL error: ${(json.errors as RawGraphQLError[]).map((e) => e.message).join("; ")}`
    );
  }

  const patterns: RawTripPattern[] =
    json.data?.trip?.tripPatterns ?? [];

  return patterns.map((pattern): JourneyOption => ({
    durationSeconds: pattern.duration,
    legs: pattern.legs.map((leg): JourneyLeg => ({
      mode: normaliseMode(leg.mode, leg.transportSubmode ?? undefined),
      distanceMetres: leg.distance ?? 0,
      durationSeconds: leg.duration ?? 0,
      fromName: leg.fromPlace?.name ?? "",
      toName: leg.toPlace?.name ?? "",
      operatorName: leg.operator?.name ?? null,
      lineName: leg.line?.publicCode ?? null,
      subMode: leg.transportSubmode ?? null,
    })),
  }));
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Normalise Entur mode + subMode to our EnturMode union.
 * Entur returns "water" for all water transport;
 * subMode distinguishes ferry vs. hurtigbåt.
 */
function normaliseMode(mode: string, subMode?: string): EnturMode {
  const m = (mode ?? "").toLowerCase();
  if (m === "rail")    return "rail";
  if (m === "metro")   return "metro";
  if (m === "tram")    return "tram";
  if (m === "water")   return "water";
  if (m === "air")     return "air";
  if (m === "foot")    return "foot";
  if (m === "bicycle") return "bicycle";
  if (m === "bus" || m === "coach") {
    return m === "coach" ? "coach" : "bus";
  }
  return "unknown";
}

// ─────────────────────────────────────────────────────────────────
// Wide-window search: fetch journeys across ±N hours
// Returns all unique trip patterns found, tagged with departure time
// ─────────────────────────────────────────────────────────────────

export interface JourneyOptionWithTime extends JourneyOption {
  /** The dateTime used for this query */
  queryDateTime: Date;
}

/**
 * Search for journeys in a wide time window around `baseDateTime`.
 * Fires multiple Entur queries at offsets (e.g. -4h, -2h, 0, +2h, +4h)
 * and deduplicates by leg signature.
 *
 * Returns up to `maxResults` unique journeys sorted by totalDuration.
 */
export async function fetchJourneysWideWindow(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  baseDateTime: Date,
  windowHours = 4,
  stepHours = 2,
  maxResults = 6
): Promise<JourneyOptionWithTime[]> {
  // Build offset list: 0, +step, +2step, ... up to window; and -step, -2step... down to -window
  const offsets: number[] = [0];
  for (let h = stepHours; h <= windowHours; h += stepHours) {
    offsets.push(h);
    offsets.push(-h);
  }

  // Fire all queries in parallel
  const results = await Promise.allSettled(
    offsets.map(async (offsetH) => {
      const dt = new Date(baseDateTime.getTime() + offsetH * 3_600_000);
      // Don't search in the past
      if (dt.getTime() < Date.now() - 60_000) return [];
      const journeys = await fetchJourneyOptions(fromLat, fromLon, toLat, toLon, dt, 2);
      return journeys.map((j): JourneyOptionWithTime => ({ ...j, queryDateTime: dt }));
    })
  );

  // Flatten successful results
  const all: JourneyOptionWithTime[] = results
    .filter((r): r is PromiseFulfilledResult<JourneyOptionWithTime[]> => r.status === "fulfilled")
    .flatMap((r) => r.value);

  // Deduplicate by leg signature (mode+distance rounded to 5km)
  const seen = new Set<string>();
  const unique: JourneyOptionWithTime[] = [];
  for (const j of all) {
    const sig = j.legs
      .map((l) => `${l.mode}:${Math.round(l.distanceMetres / 5000)}`)
      .join("|");
    if (!seen.has(sig)) {
      seen.add(sig);
      unique.push(j);
    }
  }

  // Sort by duration (shortest first) and return top N
  return unique
    .sort((a, b) => a.durationSeconds - b.durationSeconds)
    .slice(0, maxResults);
}

// ─────────────────────────────────────────────────────────────────
// Bicycle route — directMode: bicycle (OSM cycleway-aware routing)
// ─────────────────────────────────────────────────────────────────

const BIKE_QUERY = /* GraphQL */ `
  query BikeTrip(
    $fromLat: Float!
    $fromLon: Float!
    $toLat:   Float!
    $toLon:   Float!
    $dateTime: DateTime!
  ) {
    trip(
      from: { coordinates: { latitude: $fromLat, longitude: $fromLon } }
      to:   { coordinates: { latitude: $toLat,   longitude: $toLon   } }
      dateTime: $dateTime
      numTripPatterns: 1
      modes: { directMode: bicycle }
    ) {
      tripPatterns {
        duration
        legs {
          mode
          distance
          duration
          steps {
            streetName
            bikeLane
            area
          }
        }
      }
    }
  }
`;

/**
 * Fetch a bicycle-only route from Entur (OpenTripPlanner + OSM).
 * Only meaningful for distances ≤ ~30 km.
 * Returns null if no route found or the request fails.
 */
export async function fetchBicycleRoute(
  fromLat: number,
  fromLon: number,
  toLat: number,
  toLon: number,
  dateTime: Date
): Promise<BicycleRoute | null> {
  const body = JSON.stringify({
    query: BIKE_QUERY,
    variables: { fromLat, fromLon, toLat, toLon, dateTime: dateTime.toISOString() },
  });

  try {
    const res = await fetch(JP_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "ET-Client-Name": CLIENT_NAME },
      body,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const pattern = json.data?.trip?.tripPatterns?.[0];
    if (!pattern) return null;

    const leg = pattern.legs?.[0];
    // Check if any step uses a dedicated bike lane
    const hasCycleways = (leg?.steps ?? []).some(
      (s: any) => s.bikeLane === true
    );

    return {
      distanceMetres: leg?.distance ?? 0,
      durationSeconds: pattern.duration ?? 0,
      hasCycleways,
    };
  } catch {
    return null;
  }
}
