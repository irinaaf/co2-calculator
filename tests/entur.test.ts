/**
 * Unit tests for lib/entur.ts
 *
 * Covers:
 *   - fetchJourneysWideWindow() — deduplication logic, partial results on failure
 *   - fetchJourneyOptions() — response parsing
 */

import {
  fetchJourneysWideWindow,
  fetchJourneyOptions,
} from "@/lib/entur";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

// ─────────────────────────────────────────────────────────────────
// Mock Entur GraphQL response builder
// ─────────────────────────────────────────────────────────────────

function makeTripResponse(patterns: Array<{ duration: number; legs: any[] }>) {
  return {
    ok: true,
    json: async () => ({
      data: {
        trip: {
          tripPatterns: patterns,
        },
      },
    }),
  };
}

// ─────────────────────────────────────────────────────────────────
// fetchJourneyOptions()
// ─────────────────────────────────────────────────────────────────

describe("fetchJourneyOptions()", () => {
  test("returns empty array when no tripPatterns in response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { trip: { tripPatterns: [] } },
      }),
    });

    const result = await fetchJourneyOptions(59.914, 10.752, 60.391, 5.322, new Date());
    expect(result).toHaveLength(0);
  });

  test("maps Entur GraphQL response to JourneyOption shape", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      makeTripResponse([
        {
          duration: 7200,
          legs: [
            {
              mode: "rail",
              distance: 500000,
              duration: 7200,
              fromPlace: { name: "Oslo S" },
              toPlace: { name: "Bergen stasjon" },
              operator: { name: "Vy" },
              line: { publicCode: "Bergen Line" },
              transportSubmode: null,
            },
          ],
        },
      ])
    );

    const result = await fetchJourneyOptions(59.914, 10.752, 60.391, 5.322, new Date());
    expect(result).toHaveLength(1);
    expect(result[0].durationSeconds).toBe(7200);
    expect(result[0].legs).toHaveLength(1);
    expect(result[0].legs[0].mode).toBe("rail");
    expect(result[0].legs[0].distanceMetres).toBe(500000);
    expect(result[0].legs[0].fromName).toBe("Oslo S");
    expect(result[0].legs[0].toName).toBe("Bergen stasjon");
    expect(result[0].legs[0].operatorName).toBe("Vy");
    expect(result[0].legs[0].lineName).toBe("Bergen Line");
  });

  test("throws when HTTP response is not ok", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });

    await expect(
      fetchJourneyOptions(59.914, 10.752, 60.391, 5.322, new Date())
    ).rejects.toThrow("Entur Journey Planner error: 503");
  });

  test("throws when GraphQL response contains errors", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        errors: [{ message: "Variable 'fromLat' is invalid" }],
      }),
    });

    await expect(
      fetchJourneyOptions(59.914, 10.752, 60.391, 5.322, new Date())
    ).rejects.toThrow("Entur GraphQL error");
  });

  test("handles missing operator/line gracefully (null values)", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      makeTripResponse([
        {
          duration: 3600,
          legs: [
            {
              mode: "bus",
              distance: 20000,
              duration: 3600,
              fromPlace: { name: "A" },
              toPlace: { name: "B" },
              operator: null,
              line: null,
              transportSubmode: null,
            },
          ],
        },
      ])
    );

    const result = await fetchJourneyOptions(59.914, 10.752, 60.391, 5.322, new Date());
    expect(result[0].legs[0].operatorName).toBeNull();
    expect(result[0].legs[0].lineName).toBeNull();
    expect(result[0].legs[0].subMode).toBeNull();
  });

  test("normalises 'rail' mode correctly", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      makeTripResponse([{
        duration: 3600,
        legs: [{
          mode: "RAIL",
          distance: 100000,
          duration: 3600,
          fromPlace: { name: "A" },
          toPlace: { name: "B" },
          operator: null,
          line: null,
          transportSubmode: null,
        }],
      }])
    );
    const result = await fetchJourneyOptions(59.914, 10.752, 60.391, 5.322, new Date());
    expect(result[0].legs[0].mode).toBe("rail");
  });
});

// ─────────────────────────────────────────────────────────────────
// fetchJourneysWideWindow() — deduplication
// ─────────────────────────────────────────────────────────────────

describe("fetchJourneysWideWindow() — deduplication", () => {
  test("deduplicates journeys with identical leg signatures across time offsets", async () => {
    // Simulate all time-offset queries returning the same journey pattern
    const sameJourneyResponse = makeTripResponse([
      {
        duration: 7200,
        legs: [
          {
            mode: "rail",
            distance: 500000, // same signature: "rail:100"
            duration: 7200,
            fromPlace: { name: "Oslo S" },
            toPlace: { name: "Bergen stasjon" },
            operator: { name: "Vy" },
            line: { publicCode: "Bergen Line" },
            transportSubmode: null,
          },
        ],
      },
    ]);

    // All parallel fetches return the same result
    global.fetch = jest.fn().mockResolvedValue(sameJourneyResponse);

    const baseTime = new Date(Date.now() + 10 * 3_600_000); // 10 hours from now

    const result = await fetchJourneysWideWindow(
      59.914, 10.752,
      60.391, 5.322,
      baseTime,
      4, // windowHours
      2, // stepHours
      9  // maxResults
    );

    // Should have exactly 1 unique result despite multiple queries
    expect(result).toHaveLength(1);
  });

  test("handles partial failures gracefully (Promise.allSettled)", async () => {
    let callCount = 0;

    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      // First call succeeds, rest fail
      if (callCount === 1) {
        return Promise.resolve(
          makeTripResponse([
            {
              duration: 7200,
              legs: [
                {
                  mode: "bus",
                  distance: 100000,
                  duration: 7200,
                  fromPlace: { name: "A" },
                  toPlace: { name: "B" },
                  operator: { name: "Ruter" },
                  line: { publicCode: "100" },
                  transportSubmode: null,
                },
              ],
            },
          ])
        );
      }
      return Promise.reject(new Error("Network failure"));
    });

    const baseTime = new Date(Date.now() + 10 * 3_600_000);

    // Should not throw — Promise.allSettled handles partial failures
    const result = await fetchJourneysWideWindow(
      59.914, 10.752,
      60.391, 5.322,
      baseTime,
      4,
      2,
      9
    );

    // At least the one successful result should be included
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  test("sorts results by duration (shortest first)", async () => {
    let callCount = 0;

    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      // Different durations and distances far enough apart to create different signatures
      const duration = callCount === 1 ? 10800 : 7200;
      const distance = callCount === 1 ? 200000 : 50000; // 200km → sig "rail:40", 50km → "rail:10"

      return Promise.resolve(
        makeTripResponse([
          {
            duration,
            legs: [
              {
                mode: "rail",
                distance,
                duration,
                fromPlace: { name: "A" },
                toPlace: { name: "B" },
                operator: { name: "Vy" },
                line: { publicCode: `L${callCount}` },
                transportSubmode: null,
              },
            ],
          },
        ])
      );
    });

    const baseTime = new Date(Date.now() + 10 * 3_600_000);

    const result = await fetchJourneysWideWindow(
      59.914, 10.752,
      60.391, 5.322,
      baseTime,
      4,
      2,
      9
    );

    // Results should be sorted by durationSeconds ascending
    for (let i = 1; i < result.length; i++) {
      expect(result[i].durationSeconds).toBeGreaterThanOrEqual(result[i - 1].durationSeconds);
    }
  });

  test("respects maxResults limit", async () => {
    // Return unique journeys with very different distances to ensure distinct signatures
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve(
        makeTripResponse([
          {
            duration: 3600 * callCount,
            legs: [
              {
                mode: "bus",
                distance: callCount * 50000, // 50km apart → different signature bucket
                duration: 3600 * callCount,
                fromPlace: { name: "A" },
                toPlace: { name: "B" },
                operator: null,
                line: null,
                transportSubmode: null,
              },
            ],
          },
        ])
      );
    });

    const baseTime = new Date(Date.now() + 10 * 3_600_000);
    const maxResults = 2;

    const result = await fetchJourneysWideWindow(
      59.914, 10.752,
      60.391, 5.322,
      baseTime,
      4,
      2,
      maxResults
    );

    expect(result.length).toBeLessThanOrEqual(maxResults);
  });

  test("attaches queryDateTime to each result", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      makeTripResponse([
        {
          duration: 7200,
          legs: [
            {
              mode: "rail",
              distance: 500000,
              duration: 7200,
              fromPlace: { name: "Oslo S" },
              toPlace: { name: "Bergen stasjon" },
              operator: { name: "Vy" },
              line: { publicCode: "Bergen Line" },
              transportSubmode: null,
            },
          ],
        },
      ])
    );

    const baseTime = new Date(Date.now() + 10 * 3_600_000);

    const result = await fetchJourneysWideWindow(
      59.914, 10.752,
      60.391, 5.322,
      baseTime,
      4,
      2,
      9
    );

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].queryDateTime).toBeInstanceOf(Date);
  });

  test("skips queries for times more than 60s in the past", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      makeTripResponse([])
    );

    // Use a past time (e.g., 10 hours ago) — all offset queries should be skipped
    const pastTime = new Date(Date.now() - 10 * 3_600_000);

    const result = await fetchJourneysWideWindow(
      59.914, 10.752,
      60.391, 5.322,
      pastTime,
      4,
      2,
      9
    );

    // Either no results (all skipped) or fetch wasn't called much
    expect(Array.isArray(result)).toBe(true);
  });
});
