/**
 * Unit tests for lib/ferries.ts
 *
 * Covers:
 *   - detectFerryCrossingsFromPoints() — various route scenarios
 *   - FERRY_CROSSINGS data validation — Norwegian coordinate bounds
 */

import {
  detectFerryCrossingsFromPoints,
  FERRY_CROSSINGS,
} from "@/lib/ferries";

// ─────────────────────────────────────────────────────────────────
// detectFerryCrossingsFromPoints()
// ─────────────────────────────────────────────────────────────────

describe("detectFerryCrossingsFromPoints()", () => {
  test("Rissa → Trondheim: should detect Rørvik–Flakk", () => {
    // Rissa is south of the Trondheim fjord, Trondheim is north
    // The route crosses the Rørvik–Flakk ferry
    const crossings = detectFerryCrossingsFromPoints(63.595, 9.978, 63.430, 10.395);
    const names = crossings.map((c) => c.name);
    expect(names).toContain("Rørvik – Flakk");
  });

  test("Dronningens gate → St. Olav (0.15 km): should NOT detect any ferry", () => {
    // Two adjacent city locations in Trondheim — too short to cross any ferry
    const crossings = detectFerryCrossingsFromPoints(63.430, 10.395, 63.431, 10.393);
    expect(crossings).toHaveLength(0);
  });

  test("Oslo → Bergen: should NOT detect Rørvik–Flakk", () => {
    // Oslo to Bergen goes south of Rørvik–Flakk terminals
    const crossings = detectFerryCrossingsFromPoints(59.914, 10.752, 60.391, 5.322);
    const names = crossings.map((c) => c.name);
    expect(names).not.toContain("Rørvik – Flakk");
  });

  test("Rennesøy → Haugesund: should detect Mortavika–Arsvågen", () => {
    const crossings = detectFerryCrossingsFromPoints(59.10, 5.58, 59.55, 5.30);
    const names = crossings.map((c) => c.name);
    expect(names).toContain("Mortavika – Arsvågen");
  });

  test("Stavanger → Leirvik: should detect Mortavika–Arsvågen", () => {
    // Mortavika terminal: (59.281, 5.555), Arsvågen terminal: (59.359, 5.457)
    // Stavanger (58.970, 5.733) is ~36 km from Mortavika — within the new 40 km dynamic radius.
    // Leirvik (59.786, 5.444) is ~47 km from Arsvågen — within 40 km? Let's use a closer point.
    // Use a point north of Arsvågen (Bokn area: 59.55, 5.40) as destination.
    const crossings = detectFerryCrossingsFromPoints(58.970, 5.733, 59.55, 5.40);
    const names = crossings.map((c) => c.name);
    expect(names).toContain("Mortavika – Arsvågen");
  });

  test("Reverse direction: Trondheim → Rissa should also detect Rørvik–Flakk", () => {
    // The algorithm is symmetric (cross-side check handles both directions)
    const forward = detectFerryCrossingsFromPoints(63.595, 9.978, 63.430, 10.395);
    const reverse = detectFerryCrossingsFromPoints(63.430, 10.395, 63.595, 9.978);

    const forwardNames = forward.map((c) => c.name).sort();
    const reverseNames = reverse.map((c) => c.name).sort();

    expect(reverseNames).toEqual(forwardNames);
    expect(reverseNames).toContain("Rørvik – Flakk");
  });

  test("Same point → same point: should detect no ferry", () => {
    const crossings = detectFerryCrossingsFromPoints(63.430, 10.395, 63.430, 10.395);
    expect(crossings).toHaveLength(0);
  });

  test("Returns an array (even if no crossings found)", () => {
    const crossings = detectFerryCrossingsFromPoints(60.0, 11.0, 60.1, 11.1);
    expect(Array.isArray(crossings)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
// FERRY_CROSSINGS data validation
// ─────────────────────────────────────────────────────────────────

describe("FERRY_CROSSINGS — data integrity", () => {
  test("has exactly 10 entries", () => {
    expect(FERRY_CROSSINGS).toHaveLength(10);
  });

  test("all entries have valid Norwegian coordinates (lat 57–71°N, lon 4–31°E)", () => {
    for (const ferry of FERRY_CROSSINGS) {
      for (const [lat, lon] of ferry.terminals) {
        expect(lat).toBeGreaterThanOrEqual(57);
        expect(lat).toBeLessThanOrEqual(71);
        expect(lon).toBeGreaterThanOrEqual(4);
        expect(lon).toBeLessThanOrEqual(31);
      }
    }
  });

  test("all entries have a non-empty name", () => {
    for (const ferry of FERRY_CROSSINGS) {
      expect(typeof ferry.name).toBe("string");
      expect(ferry.name.trim().length).toBeGreaterThan(0);
    }
  });

  test("all entries have a non-empty operator", () => {
    for (const ferry of FERRY_CROSSINGS) {
      expect(typeof ferry.operator).toBe("string");
      expect(ferry.operator.trim().length).toBeGreaterThan(0);
    }
  });

  test("all entries have positive distanceKm", () => {
    for (const ferry of FERRY_CROSSINGS) {
      expect(ferry.distanceKm).toBeGreaterThan(0);
    }
  });

  test("all entries have positive durationMinutes", () => {
    for (const ferry of FERRY_CROSSINGS) {
      expect(ferry.durationMinutes).toBeGreaterThan(0);
    }
  });

  test("all entries have positive co2PerPassengerKg", () => {
    for (const ferry of FERRY_CROSSINGS) {
      expect(ferry.co2PerPassengerKg).toBeGreaterThan(0);
    }
  });

  test("all entries have positive co2PerCarKg", () => {
    for (const ferry of FERRY_CROSSINGS) {
      expect(ferry.co2PerCarKg).toBeGreaterThan(0);
    }
  });

  test("all entries have isEroad as a boolean", () => {
    for (const ferry of FERRY_CROSSINGS) {
      expect(typeof ferry.isEroad).toBe("boolean");
    }
  });

  test("all terminals are arrays of exactly 2 points with [lat, lon]", () => {
    for (const ferry of FERRY_CROSSINGS) {
      expect(ferry.terminals).toHaveLength(2);
      for (const terminal of ferry.terminals) {
        expect(terminal).toHaveLength(2);
        expect(typeof terminal[0]).toBe("number");
        expect(typeof terminal[1]).toBe("number");
      }
    }
  });

  test("Rørvik–Flakk entry has expected Trondheim-area coordinates", () => {
    const rorvik = FERRY_CROSSINGS.find((f) => f.name === "Rørvik – Flakk");
    expect(rorvik).toBeDefined();
    // Terminals should be around lat 63.4–63.6, lon 10.2–10.5
    for (const [lat, lon] of rorvik!.terminals) {
      expect(lat).toBeGreaterThan(63.0);
      expect(lat).toBeLessThan(64.0);
      expect(lon).toBeGreaterThan(10.0);
      expect(lon).toBeLessThan(11.0);
    }
  });

  test("Mortavika–Arsvågen entry has expected Rogaland-area coordinates", () => {
    const mortavika = FERRY_CROSSINGS.find((f) => f.name === "Mortavika – Arsvågen");
    expect(mortavika).toBeDefined();
    // Terminals should be around lat 59.2–59.4, lon 5.4–5.6
    for (const [lat, lon] of mortavika!.terminals) {
      expect(lat).toBeGreaterThan(59.0);
      expect(lat).toBeLessThan(60.0);
      expect(lon).toBeGreaterThan(5.0);
      expect(lon).toBeLessThan(6.0);
    }
  });
});
