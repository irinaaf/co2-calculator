# CO₂ Route Calculator — Norway

**Portfolio project** · Compare CO₂ emissions across all transport modes between any two points in Norway, with multimodal Entur routing, real timetable data, ferry crossing detection, and built-in CSRD scope 3 export.

> Built by [@irinaaf](https://github.com/irinaaf)

---

## Why this exists

Since 2024–2026, large Norwegian companies are required to report CO₂ emissions including **employee commuting** (Scope 3, Category 7 under ESRS E1-6 / GHG Protocol). This tool automates the process and generates ready-to-use text for the annual sustainability report.

It also solves a personal question: *what is the actual CO₂ footprint of my own commute?*

---

## What it does

Enter origin, destination, departure time and work days per year — get results in four sections:

| Section | What it shows |
|---|---|
| 🚌 Public transport | Real multi-leg routes (bus, train, ferry, tram, metro, flight) from Entur — searched across ±4 hours |
| 🚗 Private car | EV / petrol / diesel comparison (+ bicycle and walking for routes ≤ 25 km) |
| 🔀 Combined (P+R) | Drive to nearest station + public transport |
| 🚲 Bicycle | Only for routes ≤ 30 km, with OSM cycleway routing (shown only when not duplicated in Private car) |

**Best route** = global CO₂ minimum across ALL scenario types including car variants. The card shows a badge indicating what type of transport wins.

---

## Where the data comes from

### 1. Address search (geocoding)

**Source:** [Entur Geocoder API](https://developer.entur.org/) — Norway's official geocoder. Requests proxied through `/api/geocode` to keep `ET-Client-Name` server-side.

### 2. Public transport routes — wide-window search

**Source:** [Entur Journey Planner API v3](https://developer.entur.org/pages-journeyplanner-journeyplanner/) — 60 operators: Vy, AtB, Ruter, Skyss, Fjord1, Norled, Widerøe, etc.

**How it works:**
```
Base departure time →
  → 5 parallel Entur queries: 0h, +2h, +4h, −2h, −4h offsets
  → returns up to 9 unique trip patterns (deduplicated by leg-signature)
  → sorted by CO₂ ascending
  → "Origin"/"Destination" labels replaced with real geocoded names
```

**Validation:** Departure time in the past shows a calm informational notice.

**Time zone:** All departure times treated as `Europe/Oslo` (CET/CEST) — correctly handles UTC±1/±2 conversion before sending to Entur.

### 3. Road distance for cars

**Source:** [OSRM](https://project-osrm.org/) — router on OpenStreetMap. Accounts for ferry crossings on E39.

> **Switching to Google Maps:** add `.env.local`:
> ```
> ROUTING_PROVIDER=google
> GOOGLE_MAPS_API_KEY=your_key
> ```

### 4. Bicycle routing

**Source:** Entur Journey Planner `directMode: bicycle` (OpenTripPlanner + OSM). Shows "Cycleways" badge when dedicated infrastructure is detected.

### 5. Ferry crossing detection

When a car route passes through a known Norwegian ferry crossing, an **informational panel** appears:

- **Private car section**: shows CO₂ per car (e.g. `+0.62 kg for Rørvik–Flakk`) — **not added to the calculated total**, shown for reference only
- **Combined P+R and Bicycle sections**: shows ferry name only

**Detection algorithm** (`lib/ferries.ts`):
1. Route straight-line distance must be > 1.2× the ferry crossing distance (filters city routes)
2. Cross-side check: one endpoint near terminal A AND other endpoint near terminal B

Covers 10 main crossings: E39 (Rørvik–Flakk, Mortavika–Arsvågen, Molde–Vestnes, Hareid–Sulesund, Halhjem–Sandvikvåg), plus Rv15, Rv60, E16, Rv13, Nordland coastal.

### 6. CO₂ emission factors

All values displayed in **kg only** (no grams, no tonnes). Values ≥ 1 000 kg use Norwegian thousand separator (space): `1 234 kg`.

#### Occupancy assumption

All factors are **kg CO₂e per passenger-kilometre (pkm)**:

- **Public transport**: factor already accounts for **average vehicle occupancy**. You pay only your share of the vehicle's total emissions. Example: regional bus emitting 1.3 kg CO₂/km with 48 average passengers → 0.027 kg/pkm per person.
- **Private car**: assumes a **solo driver** (one person). This is the standard GHG Protocol assumption when individual carpooling data is unavailable. If two people share a car, real per-person CO₂ is halved — the calculator uses worst-case solo driver for conservative corporate reporting.

This distinction matters for Norway: a hurtigbåt or long-distance diesel bus can have higher CO₂/pkm than a solo electric car precisely because the vessel/vehicle is rarely full.

| Transport | Factor | Source |
|---|---|---|
| 🚆 Train (Vy) | 0.009 kg/pkm | Vy environmental report · ~99% hydropower |
| 🚇 Metro T-bane | 0.005 kg/pkm | Ruter report |
| 🚃 Tram | 0.004 kg/pkm | EEA |
| ⛴️ Ferry | 0.019 kg/pkm | Norled / Fjord1 fleet average 2023 |
| 🚤 Hurtigbåt | 0.025 kg/pkm | EEA (higher speed) |
| 🚌 Bus — Oslo (Ruter) | 0.011 kg/pkm | Ruter 2024: ~62% electric fleet |
| 🚌 Bus — Trondheim (AtB) | 0.018 kg/pkm | AtB fleet data |
| 🚌 Regional bus | 0.027 kg/pkm | EEA Transport 2023 |
| ✈️ Domestic flight | 0.255 kg/pkm | EEA + IPCC radiative forcing ×1.9 |
| 🚗 Car (petrol) | 0.192 kg/pkm | Miljødirektoratet · solo driver |
| 🚗 Car (diesel) | 0.171 kg/pkm | Miljødirektoratet · solo driver |
| ⚡ Car (EV) | 0.018 kg/pkm | Norwegian grid ~17 g CO₂/kWh × 0.2 kWh/km |
| 🚲 Bicycle | 0 kg/pkm | — |
| 🚶 Walking | 0 kg/pkm | — |

**Operator-specific bus factors** applied automatically from Entur operator name.

### 7. CO₂ calculation

```
CO₂ (kg) = leg distance (km) × emission factor (kg/pkm)
Total CO₂  = sum across all legs
Annual CO₂ = overallWinnerCo2 × 2 (round trip) × work days
```

`overallWinnerCo2` = minimum CO₂ across **all scenarios** (transit + combined + car variants). Annual Impact always uses the global winner, not just transit.

---

## Data export

### CSV export
All journey options with per-leg CO₂ breakdown — ready for Excel.

### CSRD Scope 3 report (modal + Copy button)
Pre-formatted text for annual sustainability report:
- Route and methodology
- CO₂ per trip and annual total  
- Per-leg breakdown with factors, operator names, line numbers
- Standards: **ESRS E1-6**, **GHG Protocol Category 3.7**

---

## Design

Scandinavian minimalism — warm off-white background, white cards with subtle shadow, muted forest green accent. All transport icons from **lucide-react** (monochrome, consistent line style). No emoji in UI.

---

## Tech stack

| Component | Technology |
|---|---|
| Framework | Next.js 16 + TypeScript |
| Styling | Tailwind CSS |
| Icons | lucide-react 0.474.0 |
| Transit routes | Entur Journey Planner v3 (GraphQL) · wide-window ±4h |
| Geocoding | Entur Geocoder API (proxied, server-side) |
| Bicycle | Entur + OpenTripPlanner + OSM |
| Road distance | OSRM / Google Maps (env-switchable via `lib/routing.ts`) |
| Ferry detection | Custom cross-side heuristic (`lib/ferries.ts`) |
| CO₂ factors | Miljødirektoratet + EEA 2023 + Vy + operator data |
| Deployment | Vercel |

---

## Project structure

```
co2-calculator/
├── lib/
│   ├── entur.ts        # Geocoder + wide-window Journey Planner + bicycle
│   ├── emissions.ts    # CO₂ factors, per-leg calc, formatCo2 (always kg)
│   ├── routing.ts      # Road distance: OSRM or Google Maps (switchable)
│   ├── ferries.ts      # Ferry crossing detection + CO₂ per car reference
│   ├── export.ts       # CSV and CSRD text export
│   └── utils.ts        # Tailwind cn() helper
│
├── pages/
│   ├── api/
│   │   ├── calculate.ts  # Main handler: geocoding → wide-window → scenarios
│   │   └── geocode.ts    # Proxy to Entur geocoder (avoids CORS)
│   └── index.tsx         # UI: form + 4 sections + Best route + About modal + CSRD modal
│
└── components/
    ├── PlaceInput.tsx          # Input with Entur autocomplete
    ├── LegBreakdown.tsx        # Transit timeline: stop → icon → stop
    ├── CarScenario.tsx         # Car variants with bars + lucide icons
    ├── BicycleScenario.tsx     # Bicycle route card
    └── FerryCrossingsInfo.tsx  # Ferry crossing reference panel
```

---

## Quick start

```bash
git clone https://github.com/irinaaf/co2-route-calculator
cd co2-route-calculator
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Switch to Google Maps (optional)

```bash
# .env.local
ROUTING_PROVIDER=google
GOOGLE_MAPS_API_KEY=your_key_here
```

---

## CSRD context

**CSRD** (Corporate Sustainability Reporting Directive) entered force in Norway June 2024. ~900–1 200 Norwegian companies must report Scope 3 emissions by 2026.

**Scope 3, Category 7 — Employee commuting** is the specific reporting line this tool addresses. No major CSRD platform (Salesforce Net Zero, Workiva, IBM Envizi, Persefoni, Watershed) integrates with real public transit APIs — all use survey-based distance estimation. This tool provides route-accurate multimodal calculation specifically for Norwegian infrastructure.

---

## Author

[@irinaaf](https://github.com/irinaaf) · demonstrating: Norwegian open data integration (Entur, Miljødirektoratet, EEA), CSRD/ESRS regulatory context, TypeScript / Next.js / React, Scandinavian UX design.
