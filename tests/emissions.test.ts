/**
 * Unit tests for lib/emissions.ts
 *
 * Covers:
 *   - formatCo2()
 *   - formatDuration()
 *   - calcJourneyResult() — multi-leg journey, operator-specific bus, car occupancy
 *   - CO₂ spot-checks (Part 4)
 */

import {
  formatCo2,
  formatDuration,
  calcJourneyResult,
  calculateResults,
  MODES,
} from "@/lib/emissions";
import type { JourneyOption } from "@/lib/entur";

// ─────────────────────────────────────────────────────────────────
// formatCo2()
// ─────────────────────────────────────────────────────────────────

describe("formatCo2()", () => {
  test("0 → '0 kg'", () => {
    expect(formatCo2(0)).toBe("0 kg");
  });

  test("0.003 → '0.003 kg' (< 0.01, 3 decimal places)", () => {
    expect(formatCo2(0.003)).toBe("0.003 kg");
  });

  test("0.28 → '0.28 kg' (< 1, 2 decimal places)", () => {
    expect(formatCo2(0.28)).toBe("0.28 kg");
  });

  test("7.34 → '7.3 kg' (< 10, 1 decimal place)", () => {
    // The implementation uses toFixed(1) for values < 10
    expect(formatCo2(7.34)).toBe("7.3 kg");
  });

  test("999 → '999 kg' (< 1000, rounded integer)", () => {
    expect(formatCo2(999)).toBe("999 kg");
  });

  test("1000 → formatted with space thousands separator (Norwegian locale)", () => {
    // Norwegian locale (nb-NO) uses thin/narrow no-break space as thousands separator
    const result = formatCo2(1000);
    // Normalize all space variants to regular space for comparison
    const normalized = result.replace(/ | /g, " ");
    expect(normalized).toBe("1 000 kg");
  });

  test("29700 → formatted with space thousands separator", () => {
    const result = formatCo2(29700);
    const normalized = result.replace(/ | /g, " ");
    expect(normalized).toBe("29 700 kg");
  });
});

// ─────────────────────────────────────────────────────────────────
// formatDuration()
// ─────────────────────────────────────────────────────────────────

describe("formatDuration()", () => {
  test("0 → '0 min'", () => {
    expect(formatDuration(0)).toBe("0 min");
  });

  test("45 → '45 min'", () => {
    expect(formatDuration(45)).toBe("45 min");
  });

  test("60 → '1h 00m'", () => {
    expect(formatDuration(60)).toBe("1h 00m");
  });

  test("90 → '1h 30m'", () => {
    expect(formatDuration(90)).toBe("1h 30m");
  });

  test("209 → '3h 29m'", () => {
    expect(formatDuration(209)).toBe("3h 29m");
  });

  test("180 → '3h 00m'", () => {
    expect(formatDuration(180)).toBe("3h 00m");
  });
});

// ─────────────────────────────────────────────────────────────────
// calcJourneyResult() — multi-leg journey
// ─────────────────────────────────────────────────────────────────

describe("calcJourneyResult()", () => {
  // Mock journey: bus(AtB, 18km) + water(Norled, 16km) + bus(AtB, 4km)
  const mockOption: JourneyOption = {
    durationSeconds: 5400, // 90 minutes
    legs: [
      {
        mode: "bus",
        distanceMetres: 18000,
        durationSeconds: 1800,
        fromName: "Rissa",
        toName: "Rørvik",
        operatorName: "AtB",
        lineName: "310",
        subMode: null,
      },
      {
        mode: "water",
        distanceMetres: 16000,
        durationSeconds: 1200,
        fromName: "Rørvik",
        toName: "Flakk",
        operatorName: "Norled",
        lineName: "Flakk–Rørvik",
        subMode: null,
      },
      {
        mode: "bus",
        distanceMetres: 4000,
        durationSeconds: 600,
        fromName: "Flakk",
        toName: "Dronningens gate",
        operatorName: "AtB",
        lineName: "5",
        subMode: null,
      },
    ],
  };

  const workDays = 220;
  let result: ReturnType<typeof calcJourneyResult>;

  beforeAll(() => {
    result = calcJourneyResult(mockOption, workDays);
  });

  test("totalCo2Kg: bus(AtB,18km) + water(Norled,16km) + bus(AtB,4km)", () => {
    // AtB bus: 0.018 kg/km; water (not hurtigbat): 0.019 kg/km
    const expected =
      parseFloat((0.018 * 18).toFixed(3)) +
      parseFloat((0.019 * 16).toFixed(3)) +
      parseFloat((0.018 * 4).toFixed(3));
    // totalCo2Kg is computed as parseFloat(sum.toFixed(3))
    expect(result.totalCo2Kg).toBeCloseTo(expected, 3);
  });

  test("annualCo2Kg = totalCo2Kg × 2 × workDays", () => {
    const expected = parseFloat((result.totalCo2Kg * 2 * workDays).toFixed(1));
    expect(result.annualCo2Kg).toBe(expected);
  });

  test("durationSeconds preserved exactly from JourneyOption", () => {
    // calcJourneyResult returns durationSeconds from the option directly
    expect(result.durationSeconds).toBe(5400);
  });

  test("durationMinutes = Math.round(5400/60) = 90", () => {
    expect(result.durationMinutes).toBe(90);
  });

  test("has 3 legs", () => {
    expect(result.legs).toHaveLength(3);
  });

  test("bus leg has correct co2PerKm (AtB = 0.018)", () => {
    expect(result.legs[0].co2PerKm).toBe(0.018);
    expect(result.legs[2].co2PerKm).toBe(0.018);
  });

  test("water leg has correct co2PerKm (Norled ferry, not hurtigbat = 0.019)", () => {
    expect(result.legs[1].co2PerKm).toBe(0.019);
  });
});

// ─────────────────────────────────────────────────────────────────
// calcJourneyResult() — short foot legs filtered out
// ─────────────────────────────────────────────────────────────────

describe("calcJourneyResult() — foot leg filtering", () => {
  const optionWithShortFootLeg: JourneyOption = {
    durationSeconds: 3600,
    legs: [
      {
        mode: "foot",
        distanceMetres: 30, // < 50m, should be filtered
        durationSeconds: 30,
        fromName: "A",
        toName: "B",
        operatorName: null,
        lineName: null,
        subMode: null,
      },
      {
        mode: "rail",
        distanceMetres: 100000,
        durationSeconds: 3600,
        fromName: "B",
        toName: "C",
        operatorName: "Vy",
        lineName: "Oslo–Bergen",
        subMode: null,
      },
      {
        mode: "foot",
        distanceMetres: 200, // >= 50m, should be kept
        durationSeconds: 120,
        fromName: "C",
        toName: "D",
        operatorName: null,
        lineName: null,
        subMode: null,
      },
    ],
  };

  test("foot legs < 50m are filtered out, >= 50m are kept", () => {
    const result = calcJourneyResult(optionWithShortFootLeg, 220);
    expect(result.legs).toHaveLength(2); // short foot removed, long foot kept
    expect(result.legs[0].mode).toBe("rail");
    expect(result.legs[1].mode).toBe("foot");
  });
});

// ─────────────────────────────────────────────────────────────────
// Operator-specific bus coefficients
// ─────────────────────────────────────────────────────────────────

describe("Operator-specific bus CO₂ coefficients", () => {
  function busLeg(operatorName: string | null, distanceMetres = 10000): JourneyOption {
    return {
      durationSeconds: 600,
      legs: [
        {
          mode: "bus",
          distanceMetres,
          durationSeconds: 600,
          fromName: "A",
          toName: "B",
          operatorName,
          lineName: null,
          subMode: null,
        },
      ],
    };
  }

  test("Ruter → 0.011 kg/km", () => {
    const result = calcJourneyResult(busLeg("Ruter"), 1);
    expect(result.legs[0].co2PerKm).toBe(0.011);
  });

  test("Ruter AS → 0.011 kg/km (prefix match)", () => {
    const result = calcJourneyResult(busLeg("Ruter AS"), 1);
    expect(result.legs[0].co2PerKm).toBe(0.011);
  });

  test("AtB → 0.018 kg/km", () => {
    const result = calcJourneyResult(busLeg("AtB"), 1);
    expect(result.legs[0].co2PerKm).toBe(0.018);
  });

  test("Skyss → 0.019 kg/km", () => {
    const result = calcJourneyResult(busLeg("Skyss"), 1);
    expect(result.legs[0].co2PerKm).toBe(0.019);
  });

  test("Unknown operator → 0.027 kg/km (fallback)", () => {
    const result = calcJourneyResult(busLeg("UnknownBussAS"), 1);
    expect(result.legs[0].co2PerKm).toBe(0.027);
  });

  test("null operator → 0.027 kg/km (fallback)", () => {
    const result = calcJourneyResult(busLeg(null), 1);
    expect(result.legs[0].co2PerKm).toBe(0.027);
  });
});

// ─────────────────────────────────────────────────────────────────
// Car occupancy — solo driver assumption (factors NOT divided by occupancy)
// ─────────────────────────────────────────────────────────────────

describe("Car occupancy — solo driver assumption", () => {
  test("EV car co2PerKm in MODES is 0.018 (solo driver, NOT divided by occupancy)", () => {
    const evMode = MODES.find((m) => m.id === "car_ev");
    expect(evMode).toBeDefined();
    expect(evMode!.co2PerKm).toBe(0.018);
  });

  test("Petrol car co2PerKm in MODES is 0.192 (solo driver, NOT divided by occupancy)", () => {
    const petrolMode = MODES.find((m) => m.id === "car_petrol");
    expect(petrolMode).toBeDefined();
    expect(petrolMode!.co2PerKm).toBe(0.192);
  });

  test("calculateResults for EV over 100km = 1.80 kg (solo, no occupancy split)", () => {
    const results = calculateResults(100, 220, ["car_ev"]);
    expect(results[0].co2Kg).toBeCloseTo(1.8, 2);
  });

  test("calculateResults for petrol over 100km = 19.20 kg (solo, no occupancy split)", () => {
    const results = calculateResults(100, 220, ["car_petrol"]);
    expect(results[0].co2Kg).toBeCloseTo(19.2, 2);
  });
});

// ─────────────────────────────────────────────────────────────────
// Part 4 — CO₂ spot-checks (known values, pure unit tests)
// ─────────────────────────────────────────────────────────────────

describe("CO₂ spot-checks — 100 km journeys (±2% tolerance)", () => {
  function singleLegJourney(
    mode: import("@/lib/entur").EnturMode,
    distanceMetres: number,
    operatorName: string | null = null,
    subMode: string | null = null
  ): JourneyOption {
    return {
      durationSeconds: 3600,
      legs: [
        {
          mode,
          distanceMetres,
          durationSeconds: 3600,
          fromName: "A",
          toName: "B",
          operatorName,
          lineName: null,
          subMode,
        },
      ],
    };
  }

  const tol = 0.02; // 2% tolerance

  test("100km train (Vy) → 0.90 kg CO₂ (±2%)", () => {
    const result = calcJourneyResult(singleLegJourney("rail", 100000, "Vy"), 220);
    expect(result.totalCo2Kg).toBeCloseTo(0.9, 1);
    expect(result.totalCo2Kg).toBeGreaterThanOrEqual(0.9 * (1 - tol));
    expect(result.totalCo2Kg).toBeLessThanOrEqual(0.9 * (1 + tol));
  });

  test("100km bus (Ruter) → 1.10 kg CO₂ (±2%)", () => {
    const result = calcJourneyResult(singleLegJourney("bus", 100000, "Ruter"), 220);
    expect(result.totalCo2Kg).toBeCloseTo(1.1, 1);
    expect(result.totalCo2Kg).toBeGreaterThanOrEqual(1.1 * (1 - tol));
    expect(result.totalCo2Kg).toBeLessThanOrEqual(1.1 * (1 + tol));
  });

  test("100km bus (AtB) → 1.80 kg CO₂ (±2%)", () => {
    const result = calcJourneyResult(singleLegJourney("bus", 100000, "AtB"), 220);
    expect(result.totalCo2Kg).toBeCloseTo(1.8, 1);
    expect(result.totalCo2Kg).toBeGreaterThanOrEqual(1.8 * (1 - tol));
    expect(result.totalCo2Kg).toBeLessThanOrEqual(1.8 * (1 + tol));
  });

  test("100km bus (unknown operator) → 2.70 kg CO₂ (±2%)", () => {
    const result = calcJourneyResult(singleLegJourney("bus", 100000, null), 220);
    expect(result.totalCo2Kg).toBeCloseTo(2.7, 1);
    expect(result.totalCo2Kg).toBeGreaterThanOrEqual(2.7 * (1 - tol));
    expect(result.totalCo2Kg).toBeLessThanOrEqual(2.7 * (1 + tol));
  });

  test("100km ferry (regular, not hurtigbat) → 1.90 kg CO₂ (±2%)", () => {
    // subMode null → not hurtigbat → 0.019 kg/km
    const result = calcJourneyResult(singleLegJourney("water", 100000, "Norled", null), 220);
    expect(result.totalCo2Kg).toBeCloseTo(1.9, 1);
    expect(result.totalCo2Kg).toBeGreaterThanOrEqual(1.9 * (1 - tol));
    expect(result.totalCo2Kg).toBeLessThanOrEqual(1.9 * (1 + tol));
  });

  test("100km EV car → 1.80 kg CO₂ (±2%)", () => {
    const results = calculateResults(100, 220, ["car_ev"]);
    const co2 = results[0].co2Kg;
    expect(co2).toBeCloseTo(1.8, 1);
    expect(co2).toBeGreaterThanOrEqual(1.8 * (1 - tol));
    expect(co2).toBeLessThanOrEqual(1.8 * (1 + tol));
  });

  test("100km petrol car → 19.20 kg CO₂ (±2%)", () => {
    const results = calculateResults(100, 220, ["car_petrol"]);
    const co2 = results[0].co2Kg;
    expect(co2).toBeCloseTo(19.2, 1);
    expect(co2).toBeGreaterThanOrEqual(19.2 * (1 - tol));
    expect(co2).toBeLessThanOrEqual(19.2 * (1 + tol));
  });

  test("100km flight → 25.50 kg CO₂ (±2%)", () => {
    const result = calcJourneyResult(singleLegJourney("air", 100000), 220);
    expect(result.totalCo2Kg).toBeCloseTo(25.5, 1);
    expect(result.totalCo2Kg).toBeGreaterThanOrEqual(25.5 * (1 - tol));
    expect(result.totalCo2Kg).toBeLessThanOrEqual(25.5 * (1 + tol));
  });

  test("Annual CO₂: 0.9 kg × 2 × 220 = 396 kg (exact)", () => {
    // calcJourneyResult uses parseFloat((total * 2 * workDays).toFixed(1))
    // 0.9 * 2 * 220 = 396.0 exactly
    const result = calcJourneyResult(singleLegJourney("rail", 100000, "Vy"), 220);
    expect(result.annualCo2Kg).toBe(396);
  });
});
