# Technical Architecture — CO₂ Route Calculator

> A detailed guide to how the application works internally — for technical interviewers, code reviewers, and future contributors.

---

## Overview

Next.js 16 fullstack application — same codebase handles React UI (client) and serverless API routes (server, Vercel Edge/Lambda). No separate backend.

```
Browser (React)
    │
    ├── /api/geocode     ← proxies to Entur Geocoder (CORS + caching)
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

`datetime-local` HTML input returns `"YYYY-MM-DDTHH:MM"` — **no timezone**. On the server (UTC), this would be misinterpreted. Fix in `calculate.ts`:

```typescript
// Treat datetime-local value as Europe/Oslo local time
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

Departure times displayed via `toLocaleString("en-GB", { timeZone: "Europe/Oslo" })`.

### 3. Wide-window transit search

A single Entur query for a specific time often returns no results (no train at that hour, only flights). Solution — `fetchJourneysWideWindow()`:

```
offsets = [0, +2h, +4h, −2h, −4h]  (5 parallel queries)

Promise.allSettled(offsets.map(offset => {
  if (dt + offset < now - 60s) skip;
  fetchJourneyOptions(..., dt + offset, numTrips=2)
}))

Deduplicate by sig = legs.map(l => `${l.mode}:${round(distanceM/5000)}`).join("|")
Sort by duration → return up to 9 unique patterns
```

### 4. "Origin"/"Destination" replacement

Entur returns `fromPlace.name = "Origin"` / `toPlace.name = "Destination"` for coordinate-based queries (non-stop input). After `calcJourneyResult()`, names are replaced with real geocoded labels using an immutable spread:

```typescript
const fromLabel = fromPoint.displayName.split(",")[0].trim();
const toLabel   = toPoint.displayName.split(",")[0].trim();

const replacePlaceholder = (name: string): string => {
  if (name === "Origin" || name === "origin") return fromLabel;
  if (name === "Destination" || name === "destination") return toLabel;
  return name;
};

const processedJourneys = transitJourneys.map(journey => ({
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
  bus    → OPERATOR_BUS_CO2[leg.operatorName] ?? 0.027

OPERATOR_BUS_CO2 = {
  Ruter: 0.011,   // Oslo — 62% electric 2024
  AtB:   0.018,   // Trondheim
  Skyss: 0.019,   // Bergen
  ...
}
```

**Occupancy:** Public transport factors already divide by average occupancy. Car factors assume solo driver (GHG Protocol default for Cat.7 corporate reporting).

### 6. Ferry crossing detection (`lib/ferries.ts`)

Static table of 10 major Norwegian ferry crossings with terminal coordinates. Detection algorithm — cross-side haversine check:

```
routeCrossesFerry(from, to, ferry):
  1. routeLen = haversine(from, to)
     ferryLen = haversine(t1, t2)
     if routeLen < ferryLen × 1.2 → false  // city route filter

  2. Dynamic radius: maxTerminalKm = max(40, ferryLen × 1.5)

  3. Cross-side check:
     (dist(from, t1) ≤ maxTerminalKm AND dist(to, t2) ≤ maxTerminalKm)
     OR
     (dist(from, t2) ≤ maxTerminalKm AND dist(to, t1) ≤ maxTerminalKm)
```

Result: `Dronningens gate → St. Olav` (0.15 km) does NOT trigger Rørvik–Flakk (19.5 km). `Rissa → Trondheim` (27.6 km) does. `Stavanger → Bokn` triggers Mortavika–Arsvågen via 40 km dynamic radius.

**CO₂ per car** (shown informational only, NOT added to total):
- GHG Protocol assigns vehicle ferry transport to Scope 3 Cat.6
- OSRM includes ferry distance but applies EV/petrol factor throughout
- Adding ferry separately would require knowing vehicle deck utilization per crossing

`CalculateResponse` includes `ferryCrossings: FerryCrossing[]` — the detected crossings are passed to the client and displayed once in a dedicated card after the Best route block (mode="car", showing CO₂ per car as a reference value).

### 7. Scenario building

```typescript
// Type 1: Transit (all Entur patterns, incl. flight, sorted by CO₂)
// Type 2: Car (OSRM distance × EV/petrol/diesel/bike/walk factors)
// Type 3: Combined P+R (synthetic: EV ~15km + best transit journey)
// Type 4: Bicycle (Entur directMode:bicycle, only if haversine ≤ 30km)
//          → NOT shown if bicycle already in Type 2 (route ≤ 25km)
```

### 8. Best Route selection (client-side)

```typescript
// All journey candidates (incl. air and combined)
allJourneys = [...transitScenarios, combinedScenario].flatMap(s => s.journey ?? []);
bestJourney = allJourneys.sort((a, b) => a.totalCo2Kg - b.totalCo2Kg)[0];

// Car candidates
bestCarVariant = carVariants.sort((a, b) => a.co2Kg - b.co2Kg)[0];
carIsOverallBest = bestCarVariant.co2Kg < bestJourney.totalCo2Kg;

overallWinnerCo2 = min(bestJourney.totalCo2Kg, bestCarVariant.co2Kg);

// Annual Impact always uses overallWinnerCo2 — not biased toward flight routes
annualCo2 = overallWinnerCo2 × 2 × workDays;
```

### 9. Badge determination

All winner badges use the `<Leaf>` icon regardless of transport type. Colors distinguish route category:

```typescript
winnerBadge:
  carIsOverallBest  → { icon: Leaf, label: "Car (EV) is lowest CO₂",        bg: green  }
  bestIsAir         → { icon: Leaf, label: "via flight",                     bg: amber  }
  bestIsCombined    → { icon: Leaf, label: "Car + public transport",          bg: gray   }
  ferry             → { icon: Leaf, label: "Ferry route",                    bg: blue   }
  bus               → { icon: Leaf, label: "Bus is lowest CO₂",              bg: gray   }
  default           → { icon: Leaf, label: "Public transport is lowest CO₂", bg: green  }
```

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
└── FerryCrossingsInfo   — ferry panel shown once after Best route card (mode="car")
```

**Page layout order (when results shown):**
1. Best route card (green, winner summary)
2. Ferry crossings card — once, mode="car" (CO₂ per car, informational reference)
3. Section 1: Public transport (ground + air subsections)
4. Section 2: Private car
5. Section 3: Car + public transport (P+R)
6. Section 4: Bicycle (if applicable)
7. Annual impact
8. Export buttons

**Icons (lucide-react 0.474.0):**

| Component | Icons |
|---|---|
| LegBreakdown | TrainFront, TramFront, Bus, Ship, Plane, Car, Bike, PersonStanding, Zap, Shuffle, HelpCircle |
| CarScenario | Car, Zap, Fuel, Bike, PersonStanding |
| BicycleScenario | Bike, Leaf, Route |
| FerryCrossingsInfo | Ship |
| index.tsx | Car, Leaf, Clock, TrainFront, Info, X |

---

## File Reference

| File | Purpose |
|---|---|
| `pages/index.tsx` | Main UI — form, results layout, best-route logic |
| `pages/api/calculate.ts` | API orchestrator — geocoding, routing, CO₂, scenarios |
| `pages/api/geocode.ts` | Geocoder proxy with Cache-Control header |
| `lib/entur.ts` | Entur Journey Planner + Geocoder GraphQL client |
| `lib/emissions.ts` | CO₂ factors, `calcJourneyResult`, `calculateResults` |
| `lib/ferries.ts` | Static table of 10 Norwegian ferry crossings + detection algorithm |
| `lib/routing.ts` | OSRM road distance with 8s timeout, haversine×1.25 fallback |
| `lib/export.ts` | `exportCsv` and `exportCsrdText` (ESRS E1-6 Cat.7) |
| `components/PlaceInput.tsx` | Autocomplete input with debounce + AbortController |
| `components/LegBreakdown.tsx` | Per-journey leg timeline |
| `components/CarScenario.tsx` | Car/bike/walk variant grid |
| `components/BicycleScenario.tsx` | Bicycle route summary |
| `components/FerryCrossingsInfo.tsx` | Ferry crossing info panel (car: CO₂ per car; transit: name only) |
| `METHODOLOGY.md` | User-facing methodology and data source documentation |

---

## Data Sources

| Source | URL | Used for |
|---|---|---|
| Entur Journey Planner v3 | https://developer.entur.org/pages-journeyplanner-journeyplanner | Transit routes (GraphQL) |
| Entur Geocoder | https://developer.entur.org/pages-geocoder-api | Address → coordinates |
| Miljødirektoratet | https://miljostatus.miljodirektoratet.no/tema/klima/norske-utslipp-av-klimagasser/klimagassutslipp-fra-transport/ | Norwegian transport emission factors |
| SSB | https://www.ssb.no/natur-og-miljo/forurensning-og-klima/statistikk/utslipp-til-luft | National emission statistics |
| Entur miljø | https://miljo.entur.org/om-prosjektet | SINTEF Energimodul / ISO 14083:2023 methodology |
| SINTEF Energimodul | https://energimodul.sintef.no/method | Per-operator CO₂ methodology |
| EEA | https://www.eea.europa.eu/en/analysis/maps-and-charts/estimated-specific-emissions-of-co2 | Estimated specific CO₂ emissions by mode |
| OSRM | http://router.project-osrm.org | Road distance routing |

---

## Known Limitations

| Issue | Details | Status |
|---|---|---|
| Car ferry CO₂ not in total | Ferry CO₂ per car shown for reference only. OSRM treats ferry as road; adding it separately requires vehicle deck utilization data not available in open APIs. | Documented in UI |
| P+R is synthetic | Combined scenario uses ~15km EV leg to nearest station (heuristic), not a real Entur Park & Ride query | Known limitation |
| Air transit in "Public transport" | Entur returns air legs; shown in separate subsection with "via flight (high CO₂)" label | By design |
| Solo driver assumption | Car CO₂ assumes 1 person. Carpooling halves per-person CO₂ but data unavailable at route level | Documented in UI |
| Ferry table coverage | 10 main crossings. Minor ferries and seasonal routes not covered | Acceptable for MVP |

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `ROUTING_PROVIDER` | `"osrm"` | `"osrm"` or `"google"` |
| `GOOGLE_MAPS_API_KEY` | — | Required if `ROUTING_PROVIDER=google` |

No API keys required for base version (Entur is free and open).

---

## Author

[@irinaaf](https://github.com/irinaaf)
