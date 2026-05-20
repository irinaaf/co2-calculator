/**
 * API route tests for /api/calculate (pages/api/calculate.ts)
 *
 * Covers:
 *   - Valid request: verifies CalculateResponse shape
 *   - Entur returns 0 results: car scenario present, unavailableModes populated
 *   - workDays = 0: clamped to minimum 1
 *   - Method validation (non-POST → 405)
 *   - Missing from/to → 400
 */

import type { NextApiRequest, NextApiResponse } from "next";
import type { CalculateResponse } from "@/pages/api/calculate";

// ─────────────────────────────────────────────────────────────────
// Mock all external dependencies
// ─────────────────────────────────────────────────────────────────

jest.mock("@/lib/entur", () => ({
  geocodeOne: jest.fn(),
  fetchJourneysWideWindow: jest.fn(),
  fetchBicycleRoute: jest.fn(),
}));

jest.mock("@/lib/routing", () => ({
  getRoadDistance: jest.fn(),
}));

import { geocodeOne, fetchJourneysWideWindow, fetchBicycleRoute } from "@/lib/entur";
import { getRoadDistance } from "@/lib/routing";
import handler from "@/pages/api/calculate";

// ─────────────────────────────────────────────────────────────────
// Mock request/response helpers
// ─────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<NextApiRequest> = {}): NextApiRequest {
  return {
    method: "POST",
    body: {
      from: "Trondheim",
      to: "Bergen",
      workDays: 220,
    },
    ...overrides,
  } as unknown as NextApiRequest;
}

function makeRes() {
  let statusCode = 200;
  let jsonBody: any = null;

  const res = {
    status: jest.fn().mockImplementation((code: number) => {
      statusCode = code;
      return res;
    }),
    json: jest.fn().mockImplementation((body: any) => {
      jsonBody = body;
      return res;
    }),
    getStatusCode: () => statusCode,
    getBody: () => jsonBody,
  };

  return res as unknown as NextApiResponse<CalculateResponse> & {
    getStatusCode: () => number;
    getBody: () => any;
  };
}

// ─────────────────────────────────────────────────────────────────
// Setup mocks with default valid behavior
// ─────────────────────────────────────────────────────────────────

const mockGeocode = geocodeOne as jest.MockedFunction<typeof geocodeOne>;
const mockFetchJourneys = fetchJourneysWideWindow as jest.MockedFunction<typeof fetchJourneysWideWindow>;
const mockFetchBicycle = fetchBicycleRoute as jest.MockedFunction<typeof fetchBicycleRoute>;
const mockGetRoadDistance = getRoadDistance as jest.MockedFunction<typeof getRoadDistance>;

function setupValidMocks() {
  mockGeocode.mockImplementation(async (query) => {
    if (query.toLowerCase().includes("trondheim")) {
      return { label: "Trondheim, Trøndelag", lat: 63.430, lon: 10.395, layer: "locality" };
    }
    return { label: "Bergen, Vestland", lat: 60.391, lon: 5.322, layer: "locality" };
  });

  mockGetRoadDistance.mockResolvedValue({
    distanceKm: 520.0,
    durationMinutes: 390,
    provider: "osrm",
  });

  mockFetchBicycle.mockResolvedValue(null);

  // Return one transit journey: train Trondheim→Bergen
  const futureDate = new Date(Date.now() + 10 * 3_600_000);
  mockFetchJourneys.mockResolvedValue([
    {
      durationSeconds: 25200, // 7 hours
      queryDateTime: futureDate,
      legs: [
        {
          mode: "rail",
          distanceMetres: 490000,
          durationSeconds: 25200,
          fromName: "Trondheim S",
          toName: "Bergen stasjon",
          operatorName: "Vy",
          lineName: "Bergen Line",
          subMode: null,
        },
      ],
    },
  ]);
}

beforeEach(() => {
  jest.clearAllMocks();
  setupValidMocks();
});

// ─────────────────────────────────────────────────────────────────
// Method validation
// ─────────────────────────────────────────────────────────────────

describe("Handler — method validation", () => {
  test("GET request → 405 Method Not Allowed", async () => {
    const req = makeReq({ method: "GET" });
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });

  test("PUT request → 405 Method Not Allowed", async () => {
    const req = makeReq({ method: "PUT" });
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });
});

// ─────────────────────────────────────────────────────────────────
// Missing fields validation
// ─────────────────────────────────────────────────────────────────

describe("Handler — input validation", () => {
  test("missing 'from' field → 400 Bad Request", async () => {
    const req = makeReq({ body: { to: "Bergen", workDays: 220 } });
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("missing 'to' field → 400 Bad Request", async () => {
    const req = makeReq({ body: { from: "Trondheim", workDays: 220 } });
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("missing both fields → 400 Bad Request", async () => {
    const req = makeReq({ body: {} });
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─────────────────────────────────────────────────────────────────
// Valid request — response shape
// ─────────────────────────────────────────────────────────────────

describe("Handler — valid request, response shape", () => {
  test("returns 200 with expected CalculateResponse shape", async () => {
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.getBody();

    // Required top-level fields
    expect(body).toHaveProperty("from");
    expect(body).toHaveProperty("to");
    expect(body).toHaveProperty("distanceKm");
    expect(body).toHaveProperty("roadDistanceKm");
    expect(body).toHaveProperty("routingProvider");
    expect(body).toHaveProperty("scenarios");
    expect(body).toHaveProperty("unavailableModes");
    expect(body).toHaveProperty("ferryCrossings");
  });

  test("from/to GeoPoints have lat, lon, displayName", async () => {
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    const body = res.getBody();
    expect(body.from).toHaveProperty("lat");
    expect(body.from).toHaveProperty("lon");
    expect(body.from).toHaveProperty("displayName");
    expect(body.to).toHaveProperty("lat");
    expect(body.to).toHaveProperty("lon");
    expect(body.to).toHaveProperty("displayName");
  });

  test("scenarios array is non-empty and contains car scenario", async () => {
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    const body = res.getBody();
    expect(Array.isArray(body.scenarios)).toBe(true);
    expect(body.scenarios.length).toBeGreaterThan(0);

    const carScenario = body.scenarios.find((s: any) => s.type === "car");
    expect(carScenario).toBeDefined();
  });

  test("car scenario has carVariants with EV and petrol", async () => {
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    const body = res.getBody();
    const carScenario = body.scenarios.find((s: any) => s.type === "car");
    expect(carScenario.carVariants).toBeDefined();
    expect(Array.isArray(carScenario.carVariants)).toBe(true);

    const labels = carScenario.carVariants.map((v: any) => v.label);
    expect(labels).toContain("Car (EV)");
    expect(labels).toContain("Car (petrol)");
  });

  test("transit scenario is present when Entur returns journeys", async () => {
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    const body = res.getBody();
    const transitScenario = body.scenarios.find((s: any) => s.type === "transit");
    expect(transitScenario).toBeDefined();
    expect(transitScenario.journey).not.toBeNull();
  });

  test("ferryCrossings is an array", async () => {
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    const body = res.getBody();
    expect(Array.isArray(body.ferryCrossings)).toBe(true);
  });

  test("routingProvider matches mock ('osrm')", async () => {
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    const body = res.getBody();
    expect(body.routingProvider).toBe("osrm");
  });

  test("distanceKm is a positive number", async () => {
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    const body = res.getBody();
    expect(body.distanceKm).toBeGreaterThan(0);
    expect(typeof body.distanceKm).toBe("number");
  });

  test("roadDistanceKm matches mock (520.0)", async () => {
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    const body = res.getBody();
    expect(body.roadDistanceKm).toBe(520.0);
  });
});

// ─────────────────────────────────────────────────────────────────
// Entur returns 0 results
// ─────────────────────────────────────────────────────────────────

describe("Handler — Entur returns 0 transit results", () => {
  beforeEach(() => {
    mockFetchJourneys.mockResolvedValue([]);
  });

  test("scenarios still contains car scenario", async () => {
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    const body = res.getBody();
    expect(body.scenarios.some((s: any) => s.type === "car")).toBe(true);
  });

  test("transit scenario has journey = null (no routes found)", async () => {
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    const body = res.getBody();
    const transitScenario = body.scenarios.find((s: any) => s.type === "transit");
    expect(transitScenario).toBeDefined();
    expect(transitScenario.journey).toBeNull();
  });

  test("unavailableModes includes 'train' and 'flight'", async () => {
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    const body = res.getBody();
    expect(body.unavailableModes).toContain("train");
    expect(body.unavailableModes).toContain("flight");
  });

  test("combined scenario is absent when no transit journeys", async () => {
    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    const body = res.getBody();
    const combinedScenario = body.scenarios.find((s: any) => s.type === "combined");
    expect(combinedScenario).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────
// workDays clamping
// ─────────────────────────────────────────────────────────────────

describe("Handler — workDays clamping", () => {
  test("workDays = 0 → clamped to 1 (annualCo2Kg > 0 for non-zero routes)", async () => {
    const req = makeReq({ body: { from: "Trondheim", to: "Bergen", workDays: 0 } });
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.getBody();
    // Clamped to minimum 1, so annual values should be non-zero
    const carScenario = body.scenarios.find((s: any) => s.type === "car");
    expect(carScenario).toBeDefined();
    const evVariant = carScenario.carVariants.find((v: any) => v.label === "Car (EV)");
    // annualCo2Kg = co2Kg * 2 * days(min 1), so must be positive
    expect(evVariant.annualCo2Kg).toBeGreaterThan(0);
  });

  test("workDays = -100 → clamped to 1", async () => {
    const req = makeReq({ body: { from: "Trondheim", to: "Bergen", workDays: -100 } });
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.getBody();
    const carScenario = body.scenarios.find((s: any) => s.type === "car");
    const evVariant = carScenario.carVariants.find((v: any) => v.label === "Car (EV)");
    expect(evVariant.annualCo2Kg).toBeGreaterThan(0);
  });

  test("workDays = 500 → clamped to 365 (annual ratio ≈ 365/220 vs workDays=220)", async () => {
    const req220 = makeReq({ body: { from: "Trondheim", to: "Bergen", workDays: 220 } });
    const req500 = makeReq({ body: { from: "Trondheim", to: "Bergen", workDays: 500 } });
    const res220 = makeRes();
    const res500 = makeRes();

    await handler(req220, res220);
    await handler(req500, res500);

    const body220 = res220.getBody();
    const body500 = res500.getBody();

    const carScenario220 = body220.scenarios.find((s: any) => s.type === "car");
    const carScenario500 = body500.scenarios.find((s: any) => s.type === "car");

    const evVariant220 = carScenario220.carVariants.find((v: any) => v.label === "Car (EV)");
    const evVariant500 = carScenario500.carVariants.find((v: any) => v.label === "Car (EV)");

    // workDays 500 clamped to 365, so ratio should be 365/220
    const ratio = evVariant500.annualCo2Kg / evVariant220.annualCo2Kg;
    expect(ratio).toBeCloseTo(365 / 220, 1);
  });

  test("workDays = undefined → defaults to 220", async () => {
    const req = makeReq({ body: { from: "Trondheim", to: "Bergen" } });
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    // Should complete without error
  });
});

// ─────────────────────────────────────────────────────────────────
// Geocoder error
// ─────────────────────────────────────────────────────────────────

describe("Handler — geocoder failure", () => {
  test("returns 500 when geocodeOne throws", async () => {
    mockGeocode.mockRejectedValue(new Error("Location not found: \"XYZ\""));

    const req = makeReq();
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.getBody();
    expect(body.error).toBeDefined();
  });
});
