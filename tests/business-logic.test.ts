/**
 * Business logic tests — client-side derived values (Part 3)
 *
 * Tests pure functions that can be extracted and tested in isolation:
 *   - Annual CO₂ = overallWinnerCo2 × 2 × workDays
 *   - dominantMode() — all cases covered
 *
 * dominantMode is defined inline in index.tsx, so we replicate
 * the logic here to test it in isolation. We also test the
 * annualCo2 formula directly.
 */

import type { LegResult } from "@/lib/emissions";
import type { EnturMode } from "@/lib/entur";

// ─────────────────────────────────────────────────────────────────
// Annual CO₂ formula
// ─────────────────────────────────────────────────────────────────

describe("Annual CO₂ formula: overallWinnerCo2 × 2 × workDays", () => {
  function annualCo2(overallWinnerCo2Kg: number, workDays: number): number {
    return overallWinnerCo2Kg * 2 * workDays;
  }

  test("0.9 kg × 2 × 220 = 396 kg", () => {
    expect(annualCo2(0.9, 220)).toBeCloseTo(396, 5);
  });

  test("25.5 kg × 2 × 220 = 11220 kg (flight scenario)", () => {
    expect(annualCo2(25.5, 220)).toBeCloseTo(11220, 1);
  });

  test("0 kg × 2 × 220 = 0 kg (bicycle scenario)", () => {
    expect(annualCo2(0, 220)).toBe(0);
  });

  test("1.8 kg × 2 × 220 = 792 kg (EV car scenario)", () => {
    expect(annualCo2(1.8, 220)).toBeCloseTo(792, 3);
  });

  test("workDays = 1 (clamped minimum): 0.9 × 2 × 1 = 1.8 kg", () => {
    expect(annualCo2(0.9, 1)).toBeCloseTo(1.8, 5);
  });

  test("workDays = 365 (clamped maximum): 0.9 × 2 × 365 = 657 kg", () => {
    expect(annualCo2(0.9, 365)).toBeCloseTo(657, 3);
  });

  test("is symmetric: same co2 for same inputs", () => {
    const a = annualCo2(5.123, 220);
    const b = annualCo2(5.123, 220);
    expect(a).toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────
// dominantMode() — replicated from index.tsx
// ─────────────────────────────────────────────────────────────────

/**
 * Replica of the dominantMode() function from index.tsx.
 * Tests the business logic in isolation.
 */
function dominantMode(
  legs: Pick<LegResult, "mode">[]
): "flight" | "ferry" | "mixed" | "rail" | "bus" | "transit" {
  const modes = legs
    .filter((l) => l.mode !== "foot")
    .map((l) => l.mode as string);

  if (modes.includes("air")) return "flight";
  if (modes.includes("water") && (modes.includes("rail") || modes.includes("bus"))) return "mixed";
  if (modes.includes("water")) return "ferry";
  if (modes.includes("rail") || modes.includes("tram") || modes.includes("metro")) return "rail";
  if (modes.includes("bus") || modes.includes("coach")) return "bus";
  return "transit";
}

describe("dominantMode()", () => {
  function legs(modes: EnturMode[]): Pick<LegResult, "mode">[] {
    return modes.map((mode) => ({ mode }));
  }

  // ── Flight ──────────────────────────────────────────────────────

  test("air only → 'flight'", () => {
    expect(dominantMode(legs(["air"]))).toBe("flight");
  });

  test("air + foot → 'flight' (foot ignored)", () => {
    expect(dominantMode(legs(["foot", "air", "foot"]))).toBe("flight");
  });

  test("air + rail → 'flight' (air takes priority)", () => {
    expect(dominantMode(legs(["rail", "air"]))).toBe("flight");
  });

  // ── Ferry (water only) ──────────────────────────────────────────

  test("water only → 'ferry'", () => {
    expect(dominantMode(legs(["water"]))).toBe("ferry");
  });

  test("water + foot → 'ferry'", () => {
    expect(dominantMode(legs(["foot", "water"]))).toBe("ferry");
  });

  // ── Mixed (water + rail or bus) ─────────────────────────────────

  test("water + rail → 'mixed'", () => {
    expect(dominantMode(legs(["water", "rail"]))).toBe("mixed");
  });

  test("water + bus → 'mixed'", () => {
    expect(dominantMode(legs(["water", "bus"]))).toBe("mixed");
  });

  test("water + bus + foot → 'mixed'", () => {
    expect(dominantMode(legs(["foot", "bus", "water", "foot"]))).toBe("mixed");
  });

  // ── Rail ────────────────────────────────────────────────────────

  test("rail only → 'rail'", () => {
    expect(dominantMode(legs(["rail"]))).toBe("rail");
  });

  test("tram only → 'rail'", () => {
    expect(dominantMode(legs(["tram"]))).toBe("rail");
  });

  test("metro only → 'rail'", () => {
    expect(dominantMode(legs(["metro"]))).toBe("rail");
  });

  test("rail + foot → 'rail'", () => {
    expect(dominantMode(legs(["foot", "rail"]))).toBe("rail");
  });

  test("metro + tram → 'rail'", () => {
    expect(dominantMode(legs(["metro", "tram"]))).toBe("rail");
  });

  // ── Bus ─────────────────────────────────────────────────────────

  test("bus only → 'bus'", () => {
    expect(dominantMode(legs(["bus"]))).toBe("bus");
  });

  test("coach only → 'bus'", () => {
    expect(dominantMode(legs(["coach"]))).toBe("bus");
  });

  test("bus + foot → 'bus'", () => {
    expect(dominantMode(legs(["foot", "bus"]))).toBe("bus");
  });

  // ── Transit (fallback) ──────────────────────────────────────────

  test("foot only → 'transit' (no non-foot modes)", () => {
    expect(dominantMode(legs(["foot"]))).toBe("transit");
  });

  test("empty legs → 'transit'", () => {
    expect(dominantMode([])).toBe("transit");
  });

  test("bicycle only → 'transit' (not in dominant list)", () => {
    expect(dominantMode(legs(["bicycle"]))).toBe("transit");
  });

  // ── Priority order ──────────────────────────────────────────────

  test("air beats water (flight > ferry)", () => {
    expect(dominantMode(legs(["water", "air"]))).toBe("flight");
  });

  test("water + rail returns 'mixed', not 'rail'", () => {
    expect(dominantMode(legs(["rail", "water"]))).toBe("mixed");
  });

  test("rail beats bus (rail > bus priority)", () => {
    // rail is checked before bus in the function
    expect(dominantMode(legs(["bus", "rail"]))).toBe("rail");
  });
});

// ─────────────────────────────────────────────────────────────────
// Badge determination logic (winnerBadge)
// ─────────────────────────────────────────────────────────────────

describe("Badge determination — winnerBadge logic", () => {
  /**
   * Simplified badge label determination matching ARCHITECTURE.md §9.
   */
  function determineBadgeLabel(opts: {
    carIsOverallBest: boolean;
    bestIsFlight: boolean;
    bestIsCombined: boolean;
    dominantModeResult: string;
  }): string {
    if (opts.carIsOverallBest) return "Car (EV) is lowest CO₂";
    if (opts.bestIsFlight) return "via flight";
    if (opts.bestIsCombined) return "Car + public transport";
    if (opts.dominantModeResult === "ferry") return "Ferry route";
    if (opts.dominantModeResult === "bus") return "Bus is lowest CO₂";
    return "Public transport is lowest CO₂";
  }

  test("carIsOverallBest → 'Car (EV) is lowest CO₂'", () => {
    expect(
      determineBadgeLabel({ carIsOverallBest: true, bestIsFlight: false, bestIsCombined: false, dominantModeResult: "rail" })
    ).toBe("Car (EV) is lowest CO₂");
  });

  test("bestIsFlight → 'via flight'", () => {
    expect(
      determineBadgeLabel({ carIsOverallBest: false, bestIsFlight: true, bestIsCombined: false, dominantModeResult: "flight" })
    ).toBe("via flight");
  });

  test("bestIsCombined → 'Car + public transport'", () => {
    expect(
      determineBadgeLabel({ carIsOverallBest: false, bestIsFlight: false, bestIsCombined: true, dominantModeResult: "rail" })
    ).toBe("Car + public transport");
  });

  test("dominantMode='ferry' → 'Ferry route'", () => {
    expect(
      determineBadgeLabel({ carIsOverallBest: false, bestIsFlight: false, bestIsCombined: false, dominantModeResult: "ferry" })
    ).toBe("Ferry route");
  });

  test("dominantMode='bus' → 'Bus is lowest CO₂'", () => {
    expect(
      determineBadgeLabel({ carIsOverallBest: false, bestIsFlight: false, bestIsCombined: false, dominantModeResult: "bus" })
    ).toBe("Bus is lowest CO₂");
  });

  test("default (rail/transit) → 'Public transport is lowest CO₂'", () => {
    expect(
      determineBadgeLabel({ carIsOverallBest: false, bestIsFlight: false, bestIsCombined: false, dominantModeResult: "rail" })
    ).toBe("Public transport is lowest CO₂");
  });

  test("carIsOverallBest takes priority over flight", () => {
    // Car is best even when dominantMode is flight (unlikely but edge case)
    expect(
      determineBadgeLabel({ carIsOverallBest: true, bestIsFlight: true, bestIsCombined: false, dominantModeResult: "flight" })
    ).toBe("Car (EV) is lowest CO₂");
  });
});
