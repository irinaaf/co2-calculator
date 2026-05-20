/**
 * Unit tests for lib/routing.ts
 *
 * Covers:
 *   - getRoadDistance() with mocked OSRM response — distance/duration parsing
 *   - Fallback: when fetch throws, returns haversine × 1.25 with provider="fallback"
 */

import { getRoadDistance } from "@/lib/routing";

// ─────────────────────────────────────────────────────────────────
// Mocking global fetch
// ─────────────────────────────────────────────────────────────────

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.ROUTING_PROVIDER;
});

// ─────────────────────────────────────────────────────────────────
// OSRM provider
// ─────────────────────────────────────────────────────────────────

describe("getRoadDistance() — OSRM provider", () => {
  beforeEach(() => {
    process.env.ROUTING_PROVIDER = "osrm";
  });

  test("parses distance and duration from valid OSRM response", async () => {
    // Mock OSRM response: 50.123 km, 2500 seconds
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [
          {
            distance: 50123, // metres
            duration: 2500,  // seconds
          },
        ],
      }),
    });

    const result = await getRoadDistance(63.430, 10.395, 63.595, 9.978);

    expect(result.provider).toBe("osrm");
    expect(result.distanceKm).toBe(50.1); // parseFloat((50123/1000).toFixed(1))
    expect(result.durationMinutes).toBe(42); // Math.round(2500/60)
  });

  test("uses lon,lat order in OSRM URL (OSRM expects lon first)", async () => {
    let capturedUrl = "";
    global.fetch = jest.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [{ distance: 10000, duration: 600 }],
        }),
      });
    });

    const fromLat = 59.914;
    const fromLon = 10.752;
    const toLat = 60.391;
    const toLon = 5.322;

    await getRoadDistance(fromLat, fromLon, toLat, toLon);

    // OSRM expects coordinates as lon,lat
    expect(capturedUrl).toContain(`${fromLon},${fromLat};${toLon},${toLat}`);
  });

  test("throws and falls back to haversine when OSRM returns non-OK code", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "NoRoute",
        routes: [],
      }),
    });

    const result = await getRoadDistance(59.914, 10.752, 60.391, 5.322);

    // Should fall back to haversine × 1.25
    expect(result.provider).toBe("fallback");
    expect(result.distanceKm).toBeGreaterThan(0);
  });

  test("falls back when OSRM HTTP response is not ok (e.g. 500)", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const result = await getRoadDistance(59.914, 10.752, 60.391, 5.322);

    expect(result.provider).toBe("fallback");
  });
});

// ─────────────────────────────────────────────────────────────────
// Fallback: when fetch throws
// ─────────────────────────────────────────────────────────────────

describe("getRoadDistance() — fallback on network error", () => {
  beforeEach(() => {
    process.env.ROUTING_PROVIDER = "osrm";
  });

  test("returns haversine × 1.25 with provider='fallback' when fetch throws", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    // Trondheim → Bergen (roughly 450km straight-line)
    const fromLat = 63.430;
    const fromLon = 10.395;
    const toLat = 60.391;
    const toLon = 5.322;

    const result = await getRoadDistance(fromLat, fromLon, toLat, toLon);

    expect(result.provider).toBe("fallback");

    // Verify the haversine × 1.25 calculation manually
    const R = 6371;
    const dLat = ((toLat - fromLat) * Math.PI) / 180;
    const dLon = ((toLon - fromLon) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((fromLat * Math.PI) / 180) *
        Math.cos((toLat * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    const straightKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const expectedRoadKm = parseFloat((straightKm * 1.25).toFixed(1));

    expect(result.distanceKm).toBe(expectedRoadKm);
  });

  test("fallback durationMinutes = Math.round(roadKm / 80 * 60)", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("timeout"));

    const result = await getRoadDistance(59.914, 10.752, 60.391, 5.322);

    expect(result.provider).toBe("fallback");
    // Duration should be consistent with 80 km/h average
    const expectedDuration = Math.round((result.distanceKm / 80) * 60);
    expect(result.durationMinutes).toBe(expectedDuration);
  });

  test("returns positive distance for real Norwegian coordinates", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("fail"));

    const result = await getRoadDistance(59.914, 10.752, 60.391, 5.322);

    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.durationMinutes).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// Google Maps provider (fallback scenario — no API key)
// ─────────────────────────────────────────────────────────────────

describe("getRoadDistance() — Google provider falls back without API key", () => {
  beforeEach(() => {
    process.env.ROUTING_PROVIDER = "google";
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  test("falls back to haversine when GOOGLE_MAPS_API_KEY is not set", async () => {
    // No mock needed — function throws internally because key is missing
    // It should catch the error and use the fallback
    const result = await getRoadDistance(59.914, 10.752, 60.391, 5.322);

    expect(result.provider).toBe("fallback");
    expect(result.distanceKm).toBeGreaterThan(0);
  });
});
