# Technical Architecture — CO₂ Route Calculator

> A detailed guide to how the application works internally — for technical interviewers, code reviewers, and future contributors.

---

## Overview

The app is a **Next.js 16 fullstack application** — the same codebase handles both the React UI (client-side) and the serverless API routes (server-side, run on Vercel Edge/Lambda). There is no separate backend server.

```
Browser (React)
    │
    ├── /api/geocode     ← proxies to Entur Geocoder
    └── /api/calculate   ← orchestrates all data sources, returns scenarios
            │
            ├── Entur Geocoder API     (address → lat/lon)
            ├── Entur Journey Planner  (lat/lon + time → transit routes)
            ├── OSRM / Google Maps     (lat/lon → road distance)
            └── emissions.ts           (distance × factor → CO₂)
```

---

## Data Flow — Step by Step

### 1. Address autocomplete

```
User types → PlaceInput component
    → debounced fetch to /api/geocode?q=...  (280ms debounce)
    → Next.js API route proxies to Entur Geocoder
        GET https://api.entur.io/geocoder/v1/autocomplete
        Headers: ET-Client-Name: portfolio-co2-calculator
    → returns PlaceSuggestion[] { label, layer, lat, lon }
    → dropdown renders with lucide icons per layer type
```

**Why proxy?** Entur requires `ET-Client-Name` header. Sending it from the browser would expose it publicly (minor). More importantly, the proxy allows response caching (`Cache-Control: max-age=300`) and keeps CORS headers clean.

---

### 2. Form submission

```
User clicks "Calculate footprint"
    → client validates: departure time must be in the future (±60s)
    → POST /api/calculate { from, to, dateTime, workDays }
```

---

### 3. Geocoding (server-side)

```typescript
// pages/api/calculate.ts
const [fromGeo, toGeo] = await Promise.all([
  geocodeOne(from),   // lib/entur.ts → Entur Geocoder
  geocodeOne(to),
]);
// Returns: { lat, lon, label }
```

Uses `geocodeOne()` from `lib/entur.ts` which calls the same Entur Geocoder endpoint used for autocomplete, but resolves just the top result.

---

### 4. Road distance (for car scenarios)

```typescript
// lib/routing.ts
const roadInfo = await getRoadDistance(fromLat, fromLon, toLat, toLon);
// roadInfo = { distanceKm, durationMinutes, provider: "osrm" | "google" | "fallback" }
```

**Provider selection** via `process.env.ROUTING_PROVIDER`:

| `ROUTING_PROVIDER` | API called | Notes |
|---|---|---|
| `"osrm"` (default) | `router.project-osrm.org` | Free, no key, knows Norwegian ferry crossings |
| `"google"` | Google Maps Distance Matrix | Requires `GOOGLE_MAPS_API_KEY` env var |
| fallback (any error) | Haversine × 1.25 | Straight-line estimate, no external call |

The abstraction means switching providers requires only a `.env.local` change — no code modification.

---

### 5. Wide-window transit search

This is the most complex part. A single Entur query for a specific time often returns no results (train doesn't run at that hour) or only flight routes. Instead:

```typescript
// lib/entur.ts — fetchJourneysWideWindow()

offsets = [0, +2h, +4h, −2h, −4h]   // 5 parallel queries

Promise.allSettled(
  offsets.map(offset => {
    if (offset < now - 60s) skip;      // never query the past
    fetchJourneyOptions(..., dt + offset, numTrips=2)
  })
)

// Deduplicate by leg-signature:
// sig = legs.map(l => `${l.mode}:${round(l.distanceMetres / 5000)}`).join("|")
// Different departure times with same route structure → keep only one

// Return: up to 6 unique journeys, sorted by duration
```

**Why ±4 hours?** Norwegian rural bus/ferry routes may only run a few times per day. A 4-hour window reliably catches the nearest available connection.

**GraphQL query structure:**
```graphql
query Trip($fromLat, $fromLon, $toLat, $toLon, $dateTime, $numTrips) {
  trip(
    from: { coordinates: { latitude: $fromLat, longitude: $fromLon } }
    to:   { coordinates: { latitude: $toLat,   longitude: $toLon   } }
    dateTime: $dateTime
    numTripPatterns: $numTrips
    # No modes filter → includes rail, bus, water, air, tram, metro
  ) {
    tripPatterns {
      duration
      legs {
        mode              # rail | bus | water | air | tram | metro | foot
        distance          # metres
        duration          # seconds
        fromPlace { name }
        toPlace   { name }
        operator  { name }   # "AtB", "Ruter", "Vy", "Widerøe"...
        line      { publicCode }  # "R70", "FB65", "315"...
        transportSubmode  # "localBus", "highSpeedPassengerService"...
      }
    }
  }
}
```

---

### 6. CO₂ calculation per leg

```typescript
// lib/emissions.ts — calcJourneyResult()

legs.map(leg => {
  const co2PerKm = co2ForLeg(leg);     // lookup by mode + operator
  const distanceKm = leg.distanceMetres / 1000;
  return { co2Kg: co2PerKm * distanceKm, ... };
});

totalCo2Kg = sum(legs.map(l => l.co2Kg));
annualCo2Kg = totalCo2Kg × 2 × workDaysPerYear;  // round trip
```

**Operator-specific bus factors:**
```typescript
const OPERATOR_BUS_CO2: Record<string, number> = {
  Ruter:    0.011,  // Oslo — 62% electric fleet (2024)
  AtB:      0.018,  // Trondheim
  Skyss:    0.019,  // Bergen / Vestland
  Kolumbus: 0.020,  // Stavanger
  // ... fallback: 0.027
};
```

This is applied by matching `leg.operatorName` prefix to the table.

---

### 7. Scenario building

`calculate.ts` builds 4 scenario types:

```typescript
// Type 1: Transit (all Entur journeys, including flight)
transitJourneys.forEach(j => scenarios.push({ type: "transit", journey: j }));

// Type 2: Car only (distance-based, no Entur)
scenarios.push({
  type: "car",
  carVariants: buildCarVariants(roadDistanceKm, days)
  // Variants: EV, petrol, diesel
  // + bicycle, foot if roadDistanceKm ≤ 25km
});

// Type 3: Combined P+R (synthetic: EV car leg + best transit journey)
const carLegKm = min(15, roadKm * 0.2);
combined = { legs: [carLeg, ...bestTransitJourney.legs] };
scenarios.push({ type: "combined", journey: combined });

// Type 4: Bicycle (only if haversineKm ≤ 30)
await fetchBicycleRoute(..., directMode: bicycle)  // separate Entur query
scenarios.push({ type: "bicycle", bicycleRoute: { distanceKm, durationMinutes, hasCycleways } });
```

---

### 8. Best Route selection (client-side)

```typescript
// pages/index.tsx

// Collect ALL journey candidates
const allJourneys = [
  ...transitScenarios.flatMap(s => s.journey ? [s.journey] : []),
  ...(combinedScenario?.journey ? [combinedScenario.journey] : []),
];

// Best journey = minimum CO₂ across all real journeys
const bestJourney = allJourneys.sort((a, b) => a.totalCo2Kg - b.totalCo2Kg)[0];

// Car winner check
const bestCarVariant = carVariants.sort((a, b) => a.co2Kg - b.co2Kg)[0];
const carIsOverallBest = bestCarVariant.co2Kg < bestJourney.totalCo2Kg;

// Overall winner CO₂ (used for Annual Impact)
const overallWinnerCo2 = Math.min(bestJourney.totalCo2Kg, bestCarVariant.co2Kg);
```

**Annual Impact** always uses `overallWinnerCo2` — avoids showing inflated annual totals when the best-CO₂ journey happens to be a flight.

---

### 9. Badge determination

The "Best route" card always shows a badge explaining what transport type won:

```typescript
function dominantMode(journey): string {
  modes = journey.legs.filter(l => l.mode !== "foot").map(l => l.mode);
  if "air" in modes → "flight"
  if "water" in modes + "rail"/"bus" → "mixed"
  if "water" → "ferry"
  if "rail"/"tram"/"metro" → "rail"
  if "bus" → "bus"
}

winnerBadge =
  carIsOverallBest → { icon: Car,       label: "Car (EV) is lowest CO₂",         bg: green  }
  bestIsAir        → { icon: Plane,     label: "via flight",                      bg: amber  }
  bestIsCombined   → { icon: Shuffle,   label: "Car + public transport",          bg: gray   }
  ferry            → { icon: Ship,      label: "Ferry route",                     bg: blue   }
  bus              → { icon: Bus,       label: "Bus is lowest CO₂",              bg: gray   }
  default          → { icon: TrainFront,label: "Public transport is lowest CO₂", bg: green  }
```

---

## Component Architecture

```
index.tsx (page)
├── PlaceInput          — autocomplete via /api/geocode
├── LegBreakdown        — transit timeline: stop → [mode icon] → stop → ...
│     └── LegSegment   — single connector with mode icon in circle
├── CarScenario         — private car variants with progress bars + mode icons
└── BicycleScenario     — bicycle stats with cycleway badge
```

All transport icons come from **lucide-react** (v0.474.0):

| Component | Icons used |
|---|---|
| LegBreakdown | TrainFront, TramFront, Bus, Ship, Plane, Car, Bike, PersonStanding, Zap, Shuffle, HelpCircle |
| CarScenario | Car, Zap, Fuel, Bike, PersonStanding |
| BicycleScenario | Bike, Leaf, Route |
| index.tsx | Car, Plane, Leaf, Clock, TrainFront, Ship, Bus, Shuffle |

---

## State Management

No external state library. All state lives in `useState` hooks in `index.tsx`:

```typescript
const [from, setFrom]           // origin string
const [to, setTo]               // destination string
const [workDays, setWorkDays]   // 1–250, default 220
const [dateTime, setDateTime]   // ISO string from datetime-local input
const [loading, setLoading]     // API in-flight
const [error, setError]         // validation or API error message
const [data, setData]           // CalculateResponse | null
const [csrdText, setCsrdText]   // CSRD modal text | null
```

`CalculateResponse` is the single source of truth — all derived values (bestJourney, carVariants, etc.) are computed inline during render, not stored.

---

## Key Design Decisions

### Why Entur over Google Maps for transit?
Entur covers all 60 Norwegian operators including rural buses, ferries, and hurtigbåt. Google Maps Transit is incomplete for Norway outside major cities.

### Why wide-window search?
Single-time Entur queries frequently return zero results on infrequent rural routes. The ±4h window with deduplication gives meaningful alternatives without overwhelming the user.

### Why OSRM for road distance (not Google Maps)?
OSRM is free, open-source, and — critically — it knows about Norwegian ferry crossings on coastal roads (E39, etc.), which Google Maps also handles but requires a paid key.

### Why no state management library?
The app has a single page with a simple linear flow: input → API call → display results. `useState` is sufficient and keeps the bundle small.

### Why all CO₂ in kg only?
Early versions showed grams for small values and tonnes for large ones. User testing (informal) showed this caused confusion when comparing 279 g vs 67.6 kg vs 3.6 t — different mental models for the same "bad vs good vs catastrophic" scale. Uniform kg removes that cognitive load.

---

## API Types Reference

```typescript
// /api/calculate response
interface CalculateResponse {
  from: GeoPoint;          // { lat, lon, displayName }
  to: GeoPoint;
  distanceKm: number;      // straight-line (haversine)
  roadDistanceKm: number;  // real road distance from OSRM
  routingProvider: string; // "osrm" | "google" | "fallback"
  scenarios: Scenario[];   // typed by: "transit" | "car" | "combined" | "bicycle"
  unavailableModes: string[]; // e.g. ["train", "flight"] — not found on this route
}

// Per-leg emission result
interface LegResult {
  mode: EnturMode;        // "rail" | "bus" | "water" | "air" | "foot" | ...
  co2Kg: number;          // kg CO₂e for this leg
  co2PerKm: number;       // kg/pkm factor applied
  distanceKm: number;
  durationMinutes: number;
  fromName: string;
  toName: string;
  operatorName: string | null;  // "AtB", "Ruter", "Vy", ...
  lineName: string | null;      // "315", "R70", "FB65", ...
  departureTime?: string;       // ISO string — actual Entur departure
}
```

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `ROUTING_PROVIDER` | `"osrm"` | `"osrm"` or `"google"` |
| `GOOGLE_MAPS_API_KEY` | — | Required if `ROUTING_PROVIDER=google` |

No other secrets required. Entur APIs are completely free and open.

---

## Author

[@irinaaf](https://github.com/irinaaf)
