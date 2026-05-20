/**
 * lib/ferries.ts — Norwegian ferry crossings reference data
 *
 * Used to detect ferry crossings in car routes and display
 * informational CO₂ notes (not added to the calculated total).
 *
 * CO₂ per car figures are estimates based on:
 * - Norled/Fjord1 fleet emission data 2023
 * - Approx. vehicle deck capacity × ferry route fuel consumption
 * - GHG Protocol: ferry vehicle transport = Scope 3 Cat.6 / Cat.7
 *
 * Sources:
 * - Statens vegvesen (road administration) ferry route data
 * - Samferdselsdepartementet annual reports
 * - Norled sustainability report 2023
 */

export interface FerryCrossing {
  name: string;
  route?: string;
  operator: string;
  distanceKm: number;
  durationMinutes: number;
  co2PerPassengerKg: number;
  /** Estimated CO₂ per car — informational only, NOT added to route total */
  co2PerCarKg: number;
  isEroad: boolean;
  /** Terminal coordinates [lat, lon] */
  terminals: [[number, number], [number, number]];
}

export const FERRY_CROSSINGS: FerryCrossing[] = [
  // ── Trondheim area ───────────────────────────────────────────
  {
    name: "Rørvik – Flakk",
    route: "E39",
    operator: "AtB / Fjord1",
    distanceKm: 15.8,
    durationMinutes: 20,
    co2PerPassengerKg: 0.30,
    co2PerCarKg: 0.62,
    isEroad: true,
    terminals: [[63.4480, 10.2040], [63.5590, 10.5080]],
  },
  // ── Møre og Romsdal ─────────────────────────────────────────
  {
    name: "Anda – Lote",
    route: "Rv15",
    operator: "Fjord1",
    distanceKm: 5.7,
    durationMinutes: 10,
    co2PerPassengerKg: 0.11,
    co2PerCarKg: 0.44,
    isEroad: false,
    terminals: [[61.9230, 5.7540], [61.9350, 5.8810]],
  },
  {
    name: "Festøya – Solavågen",
    route: "Rv60",
    operator: "Fjord1",
    distanceKm: 4.2,
    durationMinutes: 8,
    co2PerPassengerKg: 0.08,
    co2PerCarKg: 0.33,
    isEroad: false,
    terminals: [[62.3760, 5.9800], [62.3370, 6.0420]],
  },
  {
    name: "Molde – Vestnes",
    route: "E39",
    operator: "Fjord1",
    distanceKm: 18.0,
    durationMinutes: 35,
    co2PerPassengerKg: 0.34,
    co2PerCarKg: 0.72,
    isEroad: true,
    terminals: [[62.7360, 7.1600], [62.6250, 7.6780]],
  },
  {
    name: "Hareid – Sulesund",
    route: "E39",
    operator: "Fjord1",
    distanceKm: 4.7,
    durationMinutes: 10,
    co2PerPassengerKg: 0.09,
    co2PerCarKg: 0.37,
    isEroad: true,
    terminals: [[62.3690, 6.0310], [62.4030, 6.1020]],
  },
  // ── Rogaland ─────────────────────────────────────────────────
  {
    name: "Mortavika – Arsvågen",
    route: "E39",
    operator: "Norled",
    distanceKm: 7.8,
    durationMinutes: 25,
    co2PerPassengerKg: 0.15,
    co2PerCarKg: 0.48,
    isEroad: true,
    terminals: [[59.2810, 5.5550], [59.3590, 5.4570]],
  },
  // ── Hordaland / Vestland ─────────────────────────────────────
  {
    name: "Halhjem – Sandvikvåg",
    route: "E39",
    operator: "Norled",
    distanceKm: 26.5,
    durationMinutes: 45,
    co2PerPassengerKg: 0.50,
    co2PerCarKg: 1.05,
    isEroad: true,
    terminals: [[60.1770, 5.4680], [59.9710, 5.3540]],
  },
  {
    name: "Brekke – Isane",
    route: "Rv13",
    operator: "Fjord1",
    distanceKm: 4.0,
    durationMinutes: 10,
    co2PerPassengerKg: 0.08,
    co2PerCarKg: 0.32,
    isEroad: false,
    terminals: [[61.0010, 5.4470], [60.9840, 5.3680]],
  },
  // ── Sogn og Fjordane ─────────────────────────────────────────
  {
    name: "Mannheller – Fodnes",
    route: "E16",
    operator: "Fjord1",
    distanceKm: 6.8,
    durationMinutes: 15,
    co2PerPassengerKg: 0.13,
    co2PerCarKg: 0.54,
    isEroad: true,
    terminals: [[61.2300, 7.2380], [61.2680, 7.3490]],
  },
  // ── Nordland ─────────────────────────────────────────────────
  {
    name: "Bodø – Lofoten coastal",
    route: "Coastal",
    operator: "Torghatten Nord",
    distanceKm: 40.0,
    durationMinutes: 75,
    co2PerPassengerKg: 0.76,
    co2PerCarKg: 1.60,
    isEroad: false,
    terminals: [[67.2804, 14.4049], [67.5270, 12.1020]],
  },
];

// ─────────────────────────────────────────────────────────────
// Route crossing detection
// ─────────────────────────────────────────────────────────────

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

/**
 * Check if a route likely CROSSES a ferry.
 *
 * Algorithm:
 *   1. Route straight-line distance must be > 1.2× the ferry distance.
 *      This filters city-internal routes (e.g. 0.15 km Dronningens gate →
 *      St. Olav won't trigger Rørvik–Flakk which is 19.5 km long).
 *   2. Cross-side check: one endpoint within maxKm of terminal A AND
 *      the other endpoint within maxKm of terminal B.
 *      This ensures the route goes FROM one side of the strait TO the other.
 */
function routeCrossesFerry(
  fromLat: number, fromLon: number,
  toLat: number,   toLon: number,
  ferry: FerryCrossing,
  maxTerminalKm = 25
): boolean {
  const [t1, t2] = ferry.terminals;
  const routeLen = haversineKm(fromLat, fromLon, toLat, toLon);
  const ferryLen = haversineKm(t1[0], t1[1], t2[0], t2[1]);

  // Route must be meaningfully longer than the ferry crossing itself
  if (routeLen < ferryLen * 1.2) return false;

  const dF1 = haversineKm(fromLat, fromLon, t1[0], t1[1]);
  const dF2 = haversineKm(fromLat, fromLon, t2[0], t2[1]);
  const dT1 = haversineKm(toLat, toLon,   t1[0], t1[1]);
  const dT2 = haversineKm(toLat, toLon,   t2[0], t2[1]);

  // Cross-side: from near t1 + to near t2, or vice versa
  return (dF1 <= maxTerminalKm && dT2 <= maxTerminalKm) ||
         (dF2 <= maxTerminalKm && dT1 <= maxTerminalKm);
}

/**
 * Detect ferry crossings for a route between two coordinates.
 * Returns only ferries that the route likely crosses (not just nearby ones).
 */
export function detectFerryCrossingsFromPoints(
  fromLat: number, fromLon: number,
  toLat: number,   toLon: number
): FerryCrossing[] {
  return FERRY_CROSSINGS.filter((ferry) =>
    routeCrossesFerry(fromLat, fromLon, toLat, toLon, ferry)
  );
}
