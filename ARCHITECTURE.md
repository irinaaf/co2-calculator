# Technical Architecture — CO₂ Route Calculator

> Internal reference for technical interviewers, code reviewers, and contributors.
> For emission methodology and data sources see [METHODOLOGY.md](./METHODOLOGY.md).

---

## Overview

Next.js 16 fullstack application — same codebase handles React UI (client) and serverless API routes (server, Vercel Edge/Lambda). No separate backend.

```
Browser (React)
    │
    ├── /api/geocode     ← proxies Entur Geocoder (CORS + Cache-Control)
    └── /api/calculate   ← orchestrates all data sources
            │
            ├── Entur Geocoder API          (address → lat/lon)
            ├── Entur Journey Planner v3    (wide-window transit routes)
            ├── OSRM / Google Maps          (road distance)
            ├── Entur bicycle mode          (cycleway routing)
            ├── lib/ferries.ts              (ferry crossing detection)
            └── lib/emissions.ts            (CO₂ per leg)
```

---

## Project Structure

```
co2-calculator/
├── lib/
│   ├── entur.ts        # Geocoder + wide-window Journey Planner + bicycle
│   ├── emissions.ts    # CO₂ factors, CarVariant, per-leg calc, formatCo2
│   ├── routing.ts      # Road distance: OSRM or Google Maps (env-switchable)
│   ├── ferries.ts      # Ferry crossing detection + CO₂ per car reference
│   └── export.ts       # exportCsv() full dump + exportCsrdText()
│
├── pages/
│   ├── api/
│   │   ├── calculate.ts  # Main handler: geocoding → wide-window → scenarios
│   │   └── geocode.ts    # Proxy to Entur geocoder (avoids CORS)
│   └── index.tsx         # UI: form + 4 sections + Best route + modals
│
└── components/
    ├── PlaceInput.tsx          # Input with Entur autocomplete (debounce + AbortController)
    ├── LegBreakdown.tsx        # Transit timeline: stop → icon → stop
    ├── CarScenario.tsx         # Car variants with progress bars
    ├── BicycleScenario.tsx     # Bicycle route card
    └── FerryCrossingsInfo.tsx  # Ferry crossing reference panel
```

---

## Data Flow — Step by Step

### 1. Address autocomplete

```
User types → PlaceInput (280ms debounce, AbortController cancels stale requests)
    → /api/geocode?q=...
    → Entur Geocoder: ET-Client-Name header, boundary=NO
    → Cache-Control: max-age=300
    → PlaceSuggestion[] { label, layer, lat, lon }
    → dropdown with lucide icons per layer type
```

### 2. Time zone handling

`datetime-local` HTML input returns `"YYYY-MM-DDTHH:MM"` — **no timezone**. The server runs UTC; without correction this would shift departure by ±1–2 h. Fix in `calculate.ts`:

```typescript
const local = new Date(dateTime + ":00");
const formatter = new Intl.DateTimeFormat("en", {
  timeZone: "Europe/Oslo", timeZoneName: "shortOffset"
});
const offsetStr = formatter.formatToParts(local)
  .find(p => p.type === "timeZoneName")?.value ?? "GMT+2";
const offsetHours = parseInt(offsetStr.match(/GMT([+-])(\d+)/)?.[2] ?? "2")
  * (offsetStr.includes("-") ? -1 : 1);
departure = new Date(local.getTime() - offsetHours * 3_600_000);
```

The default departure time in the UI is also built with local `getFullYear/getMonth/…` getters (not `toISOString()`) for the same reason.

**Past departure time:** if the user submits a past time, the UI shows a soft warning and sends the **nearest future occurrence of the same weekday and time** to Entur — ensuring real timetable results for typical commute patterns.

### 3. Wide-window transit search

A single Entur query often returns no results at a specific hour (no train, only flights). Solution — `fetchJourneysWideWindow()`:

```
5 parallel queries at offsets: 0h, +2h, +4h, −2h, −4h
  (offsets in the past are skipped)

Each query → up to 2 nearest departures from that time

Deduplicate by sig = legs.map(l => `${l.mode}:${round(distanceM/5000)}`).join("|")
Sort by duration → return up to 9 unique patterns
```

Called from `calculate.ts` with `windowHours=4`, `stepHours=2`, `maxResults=9`.

### 4. "Origin"/"Destination" replacement

Entur returns `fromPlace.name = "Origin"` / `"Destination"` for coordinate-based (non-stop) queries. After `calcJourneyResult()`, names are replaced with real geocoded labels via an immutable spread:

```typescript
const replacePlaceholder = (name: string): string => {
  if (name === "Origin" || name === "origin") return fromLabel;
  if (name === "Destination" || name === "destination") return toLabel;
  return name;
};
processedJourneys = transitJourneys.map(journey => ({
  ...journey,
  legs: journey.legs.map(leg => ({
    ...leg,
    fromName: replacePlaceholder(leg.fromName),
    toName:   replacePlaceholder(leg.toName),
  })),
}));
```

### 5. CO₂ calculation per leg

```typescript
co2ForLeg(leg):
  rail   → 0.009 kg/pkm
  metro  → 0.005
  tram   → 0.004
  water  → hurtigbåt? 0.025 : 0.019
  air    → 0.255
  foot   → 0
  bus    → OPERATOR_BUS_CO2[operatorName] ?? 0.027

OPERATOR_BUS_CO2 = {
  Ruter: 0.011,  AtB: 0.018,  Skyss: 0.019,
  Kolumbus: 0.020,  Brakar: 0.024,  ...
}

Annual CO₂ = totalCo2Kg × 2 (round trip) × workDays
```

Public transport factors include average vehicle occupancy. Car factors assume solo driver (GHG Protocol Cat.7 default).

### 6. Ferry crossing detection (`lib/ferries.ts`)

Static table of 10 major Norwegian ferry crossings with terminal coordinates. Detection — cross-side haversine check:

```
routeCrossesFerry(from, to, ferry):
  1. if routeLen < ferryLen × 1.2 → false   // filters city-internal routes

  2. maxTerminalKm = max(40, ferryLen × 1.5) // dynamic catchment radius

  3. (dist(from,t1) ≤ max AND dist(to,t2) ≤ max)
     OR
     (dist(from,t2) ≤ max AND dist(to,t1) ≤ max)
```

Examples: `Dronningens gate → St. Olav` (0.15 km) does NOT trigger Rørvik–Flakk (19.5 km). `Rissa → Trondheim` (27.6 km) does. `Stavanger → Bokn` triggers Mortavika–Arsvågen via the 40 km floor.

Ferry CO₂ per car is shown informational only, NOT added to the route total (GHG Protocol assigns vehicle ferry transport to Scope 3 Cat.6; adding it would require per-vessel utilization data not available in open APIs).

### 7. Scenario building

```
Type 1: Transit   — all Entur patterns (incl. flight), sorted by CO₂
Type 2: Car       — OSRM road distance × EV/petrol/diesel factors
                    + bicycle/walking when roadKm ≤ 25
Type 3: Combined  — synthetic P+R: EV ~15 km to station + best transit
Type 4: Bicycle   — Entur directMode:bicycle (only if haversine ≤ 30 km)
                    hidden when bicycle already shown in Type 2
```

### 8. Best Route selection (client-side)

```typescript
allJourneys = [...transitScenarios, combinedScenario].flatMap(s => s.journey ?? []);
bestJourney = allJourneys.sort((a, b) => a.totalCo2Kg - b.totalCo2Kg)[0];

bestCarVariant = carVariants.sort((a, b) => a.co2Kg - b.co2Kg)[0];
carIsOverallBest = bestCarVariant.co2Kg < bestJourney.totalCo2Kg;

overallWinnerCo2 = min(bestJourney.totalCo2Kg, bestCarVariant.co2Kg);
// Annual Impact uses overallWinnerCo2 — never biased toward a flight route
```

Toggle `bestMode`:
- `"co2"` — shows global winner (transit or car)
- `"transit"` — shows best ground transit only (no car, no air)

The active mode is exported in both CSV and CSRD report as the `reportingBasis` label.

### 9. Badge determination

```typescript
dominantMode(journey): "flight"|"ferry"|"rail"|"bus"|"transit"

winnerBadge:
  carIsOverallBest  → { icon: Car,        label: "{variant} is lowest CO₂" }
  bestIsAir         → { icon: Plane,      label: "via flight" }
  bestIsCombined    → { icon: Shuffle,    label: "Car + public transport" }
  ferry             → { icon: Ship,       label: "Ferry route" }
  bus               → { icon: Bus,        label: "Bus is lowest CO₂" }
  default           → { icon: TrainFront, label: "Public transport is lowest CO₂" }
```

### 10. Rate limiting

In-memory per-IP limiter (20 req/min) using a `Map<ip, {count, resetAt}>`. Bypassed when `NODE_ENV === "test"`. Resets on Lambda cold start — sufficient for portfolio use; Redis/Upstash for production.

---

## Component Architecture

```
index.tsx
├── PlaceInput           — Entur autocomplete (proxied, debounced, AbortController)
├── LegBreakdown         — transit timeline with lucide mode icons
│     ├── fmtDeparture() — formats ISO → Oslo timezone display
│     └── fmtSeconds()   — exact duration from Entur durationSeconds
├── CarScenario          — car/bike/walk variants with progress bars
├── BicycleScenario      — bicycle route card (suppressed if ≤25km route)
└── FerryCrossingsInfo   — ferry panel (car: CO₂/car; transit: name only)
```

**Page layout (when results shown):**
1. Best route card — global winner, toggle, badge
2. Public transport section (ground routes + air subsection)
3. Private car section (with ferry crossings panel if applicable)
4. Car + public transport (P+R)
5. Bicycle (if applicable)
6. Annual impact
7. Export buttons

**Icons (lucide-react 0.474.0):**

| Component | Icons used |
|---|---|
| `index.tsx` | Car, Leaf, Bus, Clock, TrainFront, Plane, Ship, Shuffle, Info, X |
| `LegBreakdown` | TrainFront, TramFront, Bus, Ship, Plane, Car, Bike, PersonStanding, Zap, Shuffle, HelpCircle |
| `CarScenario` | Car, Zap, Fuel, Bike, PersonStanding |
| `BicycleScenario` | Bike, Leaf, Route |
| `FerryCrossingsInfo` | Ship |

---

## File Reference

| File | Purpose |
|---|---|
| `pages/index.tsx` | Main UI — form, results, best-route logic, modals |
| `pages/api/calculate.ts` | API handler — geocoding, routing, CO₂, scenario building |
| `pages/api/geocode.ts` | Geocoder proxy with Cache-Control header |
| `lib/entur.ts` | Entur Journey Planner + Geocoder GraphQL client |
| `lib/emissions.ts` | CO₂ factors, `CarVariant`, `calcJourneyResult`, formatters |
| `lib/ferries.ts` | 10 ferry crossings + cross-side detection algorithm |
| `lib/routing.ts` | OSRM road distance, 8s timeout, haversine×1.25 fallback |
| `lib/export.ts` | `exportCsv()` full dump · `exportCsrdText()` ESRS E1-6 |
| `components/PlaceInput.tsx` | Autocomplete input |
| `components/LegBreakdown.tsx` | Per-journey leg timeline |
| `components/CarScenario.tsx` | Car/bike/walk variant grid |
| `components/BicycleScenario.tsx` | Bicycle route summary |
| `components/FerryCrossingsInfo.tsx` | Ferry crossing panel |
| `METHODOLOGY.md` | Emission factors, data sources, worked examples |

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `ROUTING_PROVIDER` | `"osrm"` | `"osrm"` or `"google"` |
| `GOOGLE_MAPS_API_KEY` | — | Required if `ROUTING_PROVIDER=google` |

No API keys required for the base version (Entur is free and open).

---

## Known Limitations

| Issue | Details |
|---|---|
| Car ferry CO₂ not in total | OSRM treats ferry as road. Adding ferry CO₂ separately would require per-vessel utilization data not available in open APIs. CO₂/car shown for reference only. |
| P+R is synthetic | ~15 km EV leg heuristic to nearest station — not a real Entur Park & Ride query. |
| Air in "Public transport" | Entur returns air legs. Shown in a separate subsection labelled "via flight (high CO₂)". |
| Solo driver assumption | Car CO₂ assumes 1 person. Carpooling data unavailable at route level. |
| Ferry table coverage | 10 main crossings. Minor and seasonal ferries not covered. |
| In-memory rate limiter | Resets on Lambda cold start. Use Redis for production. |

---

## Author

[@irinaaf](https://github.com/irinaaf)
