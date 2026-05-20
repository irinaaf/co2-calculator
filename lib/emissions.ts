/**
 * CO₂ emission factors (kg CO₂e per passenger-km)
 *
 * Sources:
 * - Miljødirektoratet: https://www.miljodirektoratet.no/klimakalkulator
 * - EEA Transport and Environment Report 2023
 * - Norwegian rail: ~99% hydro → ~0.009 kg/pkm (Vy data)
 * - Norled / Fjord1 ferry fleet emission data 2023
 * - Ruter (Oslo) reported 2024 bus electrification: ~62% electric
 * - Aviation: includes radiative forcing multiplier ×1.9 (IPCC)
 */

import type { EnturMode, JourneyLeg, JourneyOption } from "./entur";

// ─────────────────────────────────────────────────────────────────
// Mode config (for the simple distance-based calculator, kept for
// fallback + the "all options" comparison grid)
// ─────────────────────────────────────────────────────────────────

export type TransportMode =
  | "car_petrol"
  | "car_diesel"
  | "car_ev"
  | "bus"
  | "train"
  | "flight"
  | "ferry"
  | "hurtigbat"
  | "tram"
  | "metro"
  | "bicycle"
  | "foot";

export interface ModeConfig {
  id: TransportMode;
  label: string;
  emoji: string;
  /** kg CO₂e per passenger-km */
  co2PerKm: number;
  /** NOK per km (rough estimate) */
  costPerKm: number;
  /** Average speed km/h (used to estimate travel time) */
  avgSpeedKmh: number;
  color: string;
  description: string;
}

export const MODES: ModeConfig[] = [
  {
    id: "flight",
    label: "Fly",
    emoji: "✈️",
    co2PerKm: 0.255, // domestic, incl. radiative forcing ×1.9
    costPerKm: 1.8,
    avgSpeedKmh: 650,
    color: "#E24B4A",
    description: "Domestic flight (incl. radiative forcing)",
  },
  {
    id: "car_petrol",
    label: "Car (petrol)",
    emoji: "🚗",
    co2PerKm: 0.192, // solo driver, avg Norwegian car ~120 g/km WLTP
    costPerKm: 1.55,
    avgSpeedKmh: 80,
    color: "#D85A30",
    description: "Solo driver, average petrol car",
  },
  {
    id: "car_diesel",
    label: "Car (diesel)",
    emoji: "🚗",
    co2PerKm: 0.171,
    costPerKm: 1.45,
    avgSpeedKmh: 80,
    color: "#BA7517",
    description: "Solo driver, average diesel car",
  },
  {
    id: "car_ev",
    label: "Car (EV)",
    emoji: "⚡",
    co2PerKm: 0.018, // Norwegian electricity mix ~17g CO₂/kWh × 0.2 kWh/km
    costPerKm: 0.22,
    avgSpeedKmh: 80,
    color: "#639922",
    description: "EV with Norwegian electricity mix",
  },
  {
    id: "bus",
    label: "Bus",
    emoji: "🚌",
    co2PerKm: 0.027,
    costPerKm: 0.6,
    avgSpeedKmh: 65,
    color: "#BA7517",
    description: "Regional bus, average occupancy",
  },
  {
    id: "train",
    label: "Train",
    emoji: "🚆",
    co2PerKm: 0.009, // Norwegian rail ~99% hydro
    costPerKm: 0.9,
    avgSpeedKmh: 80,
    color: "#1D9E75",
    description: "Norwegian rail (Vy) — nearly zero emission",
  },
  {
    id: "ferry",
    label: "Ferry",
    emoji: "⛴️",
    co2PerKm: 0.019, // Norled/Fjord1 fleet average 2023
    costPerKm: 0.5,
    avgSpeedKmh: 20,
    color: "#0891B2",
    description: "Car/passenger ferry (Norled / Fjord1 / AtB)",
  },
  {
    id: "hurtigbat",
    label: "Hurtigbåt",
    emoji: "🚤",
    co2PerKm: 0.025, // higher speed = more fuel per km
    costPerKm: 1.2,
    avgSpeedKmh: 35,
    color: "#2563EB",
    description: "High-speed passenger boat",
  },
  {
    id: "tram",
    label: "Tram",
    emoji: "🚃",
    co2PerKm: 0.004, // electric, Norwegian grid
    costPerKm: 0.3,
    avgSpeedKmh: 25,
    color: "#7C3AED",
    description: "City tram (Oslo, Bergen, Trondheim)",
  },
  {
    id: "metro",
    label: "Metro / T-bane",
    emoji: "🚇",
    co2PerKm: 0.005,
    costPerKm: 0.3,
    avgSpeedKmh: 40,
    color: "#4F46E5",
    description: "Oslo T-bane — electric, hydro grid",
  },
  {
    id: "bicycle",
    label: "Bicycle",
    emoji: "🚲",
    co2PerKm: 0.0,
    costPerKm: 0.05,
    avgSpeedKmh: 15,
    color: "#10B981",
    description: "Zero direct emissions",
  },
  {
    id: "foot",
    label: "Walking",
    emoji: "🚶",
    co2PerKm: 0.0,
    costPerKm: 0.0,
    avgSpeedKmh: 5,
    color: "#10B981",
    description: "Zero direct emissions",
  },
];

// ─────────────────────────────────────────────────────────────────
// Per-operator CO₂ coefficients for bus
// More accurate than a single average — Ruter (Oslo) is ~62% electric
// ─────────────────────────────────────────────────────────────────

const OPERATOR_BUS_CO2: Record<string, number> = {
  Ruter:       0.011, // Oslo — ~62% electric fleet (2024 report)
  AtB:         0.018, // Trondheim
  Skyss:       0.019, // Bergen / Vestland
  Kolumbus:    0.020, // Stavanger / Rogaland
  Brakar:      0.024, // Viken vest
  Østfold:     0.025,
  Norgesbuss:  0.026,
  Nettbuss:    0.026,
};

/**
 * Return the best CO₂ coefficient for a bus leg.
 * Falls back to generic 0.027 if operator is unknown.
 */
function busCoefficient(operatorName: string | null): number {
  if (!operatorName) return 0.027;
  // Match on operator name prefix (handles "Ruter AS", "AtB AS" etc.)
  for (const [key, val] of Object.entries(OPERATOR_BUS_CO2)) {
    if (operatorName.toLowerCase().startsWith(key.toLowerCase())) return val;
  }
  return 0.027;
}

// ─────────────────────────────────────────────────────────────────
// Map EnturMode → CO₂ coefficient
// ─────────────────────────────────────────────────────────────────

function co2ForLeg(leg: JourneyLeg): number {
  switch (leg.mode) {
    case "rail":    return 0.009;
    case "metro":   return 0.005;
    case "tram":    return 0.004;
    case "water":   return isHurtigbat(leg) ? 0.025 : 0.019;
    case "air":     return 0.255;
    case "foot":    return 0.0;
    case "bicycle":
    case "bicycle_rent": return 0.0;
    case "coach":   return 0.027;
    case "bus":     return busCoefficient(leg.operatorName);
    default:        return 0.027; // unknown — assume bus
  }
}

/** Detect hurtigbåt from subMode */
function isHurtigbat(leg: JourneyLeg): boolean {
  const sub = (leg.subMode ?? "").toLowerCase();
  return (
    sub.includes("highspeed") ||
    sub.includes("local") === false && leg.mode === "water" && (leg.avgSpeedKmh ?? 0) > 25
  );
}

// ─────────────────────────────────────────────────────────────────
// Per-leg CO₂ result (used in the leg breakdown UI)
// ─────────────────────────────────────────────────────────────────

export interface LegResult {
  fromName: string;
  toName: string;
  mode: EnturMode;
  /** e.g. "🚌 Ruta 315 · AtB" */
  modeLabel: string;
  emoji: string;
  distanceKm: number;
  durationMinutes: number;
  co2Kg: number;
  co2PerKm: number;
  operatorName: string | null;
  lineName: string | null;
  color: string;
}

export interface JourneyResult {
  durationMinutes: number;
  totalCo2Kg: number;
  /** Annual round-trip CO₂ */
  annualCo2Kg: number;
  legs: LegResult[];
  /** Actual departure time from Entur (ISO string) — may differ from requested time */
  departureTime?: string;
}

/** Map EnturMode to display emoji */
function modeEmoji(mode: EnturMode): string {
  const map: Partial<Record<EnturMode, string>> = {
    rail: "🚆", metro: "🚇", tram: "🚃",
    water: "⛴️", air: "✈️", foot: "🚶",
    bicycle: "🚲", bicycle_rent: "🚲",
    bus: "🚌", coach: "🚌", unknown: "🚌",
  };
  return map[mode] ?? "🚌";
}

/** Map EnturMode to chart color */
function modeColor(mode: EnturMode): string {
  const map: Partial<Record<EnturMode, string>> = {
    rail: "#1D9E75", metro: "#4F46E5", tram: "#7C3AED",
    water: "#0891B2", air: "#E24B4A", foot: "#10B981",
    bicycle: "#10B981", bicycle_rent: "#10B981",
    bus: "#BA7517", coach: "#BA7517", unknown: "#BA7517",
  };
  return map[mode] ?? "#BA7517";
}

/**
 * Convert a raw Entur JourneyOption into a JourneyResult with CO₂ per leg.
 */
export function calcJourneyResult(
  option: JourneyOption,
  workDaysPerYear: number,
  departureTime?: Date
): JourneyResult {
  const legs: LegResult[] = option.legs
    // skip very short foot legs at start/end (< 50m)
    .filter((leg) => !(leg.mode === "foot" && leg.distanceMetres < 50))
    .map((leg) => {
      const distanceKm = leg.distanceMetres / 1000;
      const co2PerKm   = co2ForLeg(leg);
      const co2Kg      = parseFloat((co2PerKm * distanceKm).toFixed(3));
      const parts = [modeEmoji(leg.mode)];
      if (leg.lineName)    parts.push(leg.lineName);
      if (leg.operatorName) parts.push(`· ${leg.operatorName}`);

      return {
        fromName:     leg.fromName,
        toName:       leg.toName,
        mode:         leg.mode,
        modeLabel:    parts.join(" "),
        emoji:        modeEmoji(leg.mode),
        distanceKm:   parseFloat(distanceKm.toFixed(2)),
        durationMinutes: Math.round(leg.durationSeconds / 60),
        co2Kg,
        co2PerKm,
        operatorName: leg.operatorName,
        lineName:     leg.lineName,
        color:        modeColor(leg.mode),
      };
    });

  const totalCo2Kg = parseFloat(
    legs.reduce((sum, l) => sum + l.co2Kg, 0).toFixed(3)
  );

  return {
    durationMinutes: Math.round(option.durationSeconds / 60),
    totalCo2Kg,
    annualCo2Kg: parseFloat((totalCo2Kg * 2 * workDaysPerYear).toFixed(1)),
    legs,
    departureTime: departureTime?.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────
// Legacy: simple distance-based calculation (kept for fallback /
// the "all-modes comparison" grid when Entur has no public transit)
// ─────────────────────────────────────────────────────────────────

export interface RouteResult {
  mode: ModeConfig;
  distanceKm: number;
  co2Kg: number;
  annualCo2Kg: number;
  costNok: number;
  annualCostNok: number;
  durationMinutes: number;
}

export function calculateResults(
  distanceKm: number,
  workDaysPerYear: number,
  modes: TransportMode[] = [
    "flight", "car_petrol", "car_ev", "bus", "train",
    "ferry", "tram", "metro",
  ]
): RouteResult[] {
  return MODES.filter((m) => modes.includes(m.id)).map((mode) => {
    const co2Kg   = parseFloat((mode.co2PerKm * distanceKm).toFixed(3));
    const costNok = parseFloat((mode.costPerKm * distanceKm).toFixed(0));
    const durationMinutes = Math.round((distanceKm / mode.avgSpeedKmh) * 60);
    return {
      mode,
      distanceKm,
      co2Kg,
      annualCo2Kg: parseFloat((co2Kg * 2 * workDaysPerYear).toFixed(1)),
      costNok,
      annualCostNok: parseFloat((costNok * 2 * workDaysPerYear).toFixed(0)),
      durationMinutes,
    };
  });
}

// ─────────────────────────────────────────────────────────────────
// Formatters
// ─────────────────────────────────────────────────────────────────

export function formatCo2(kg: number): string {
  if (kg === 0)   return "0 kg";
  if (kg < 0.01)  return `${kg.toFixed(3)} kg`;
  if (kg < 1)     return `${kg.toFixed(2)} kg`;
  if (kg < 10)    return `${kg.toFixed(1)} kg`;
  if (kg < 1000)  return `${Math.round(kg)} kg`;
  // ≥ 1 000 kg: space as thousands separator (European style)
  return `${Math.round(kg).toLocaleString("nb-NO")} kg`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}`;
}
