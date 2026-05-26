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

A toggle lets you switch the Best route view between **Lowest CO₂** (global winner across all modes) and **Public transport only** (best ground transit route). The selected mode also determines which journey appears in the CSRD export.

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

**Past departure time:** If the selected time is in the past, a soft informational notice is shown — but the calculation still runs. Entur is queried using the **nearest future occurrence of the same weekday and time** (e.g. last Monday 08:00 → next Monday 08:00), ensuring real timetable results for typical commute patterns.

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

- Shows **CO₂ per car** (e.g. `+0.62 kg for Rørvik–Flakk`) — **not added to the calculated total**, shown for reference only
- Also shows crossing name, operator, distance, and duration

**Detection algorithm** (`lib/ferries.ts`):
1. Route straight-line distance must be > 1.2× the ferry crossing distance (filters city routes)
2. Cross-side check: one endpoint near terminal A AND other endpoint near terminal B

Covers 10 main crossings: E39 (Rørvik–Flakk, Mortavika–Arsvågen, Molde–Vestnes, Hareid–Sulesund, Halhjem–Sandvikvåg), plus Rv15, Rv60, E16, Rv13, Nordland coastal.

### 6. CO₂ emission factors

All values displayed in **kg only** (no grams, no tonnes). Values ≥ 1 000 kg use Norwegian thousand separator (space): `1 234 kg`.

#### Occupancy assumption

All factors are expressed in **kg CO₂e per passenger-kilometre (pkm)**.

**CO₂e** (CO₂-equivalent) means the factor covers not just CO₂ but all greenhouse gases produced (CH₄, N₂O, and others), each converted to a common scale based on their global warming potential. For example, 1 kg of methane (CH₄) equals ~28 kg CO₂e. All EEA and SINTEF factors already include these gases — so the number you see is the full climate impact, not just carbon dioxide.


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
| 🚌 Regional bus | 0.027 kg/pkm | [EEA — Estimated specific emissions of CO₂ by mode of transport](https://www.eea.europa.eu/en/analysis/maps-and-charts/estimated-specific-emissions-of-co2) |
| ✈️ Domestic flight | 0.255 kg/pkm | EEA (same source) + IPCC radiative forcing ×1.9 |
| 🚗 Car (petrol) | 0.192 kg/pkm | Miljødirektoratet · solo driver |
| 🚗 Car (diesel) | 0.171 kg/pkm | Miljødirektoratet · solo driver |
| ⚡ Car (EV) | 0.018 kg/pkm | Norwegian grid ~17 g CO₂/kWh × 0.2 kWh/km |
| 🚲 Bicycle | 0 kg/pkm | — |
| 🚶 Walking | 0 kg/pkm | — |

**Operator-specific bus factors** are applied automatically based on the operator name returned by Entur. Factors are available for Ruter (Oslo) and AtB (Trondheim) based on their published fleet electrification data. For Bergen (Skyss), Stavanger (Kolumbus), and northern Norway where detailed fleet data is not publicly available, the EEA baseline (0.027 kg/pkm) is used as a conservative estimate.

> 📖 For a full explanation of the methodology — including a worked example with real trip data, how operator-specific factors are calculated, and what is and isn't included — see [METHODOLOGY.md](./METHODOLOGY.md).

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
Full data dump — everything calculated in a single request, in one file:
- **Selected route** (matching the active Best route toggle) with per-leg breakdown: mode, distance, CO₂, factor, operator, line
- **All public transport options** from Entur with leg breakdowns and departure times
- **All private car variants** (EV, petrol, diesel — and bicycle/walking for short routes)
- **Ferry crossings** on the route with CO₂ per car reference values
- **Annual impact summary**: one-way trips, round trips, total annual CO₂, reporting basis
- File is named `co2-route-[from]-[to]-[date].csv` and opens correctly in Excel (UTF-8 BOM included)

### CSRD Scope 3 report (modal + Copy button)
Opens in a modal window with a **Copy** button. Pre-formatted text block ready to paste into the annual sustainability report:
- Reporting basis label (Lowest CO₂ or Public transport only — matching the active toggle)
- Selected route: CO₂ per trip, annual total, per-leg breakdown with factors and operator names
- All transit options listed for reference
- Full methodology section with data source URLs
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

## Data sources

| Source | What it provides | Link |
|---|---|---|
| Entur Journey Planner v3 | Real multimodal routes, timetables, operator data | [developer.entur.org](https://developer.entur.org) |
| Entur + SINTEF Energimodul | Official Norwegian platform for public transport emission factors (ISO 14083:2023) | [miljo.entur.org](https://miljo.entur.org/om-prosjektet) |
| EEA | Baseline emission factors by transport mode (bus, ferry, flight, etc.) | [Estimated specific emissions of CO₂ by mode](https://www.eea.europa.eu/en/analysis/maps-and-charts/estimated-specific-emissions-of-co2) |
| Miljødirektoratet | Norwegian greenhouse gas inventory, transport sector | [klimagassutslipp fra transport](https://miljostatus.miljodirektoratet.no/tema/klima/norske-utslipp-av-klimagasser/klimagassutslipp-fra-transport/) |
| SSB | National air emissions statistics by source | [Utslipp til luft](https://www.ssb.no/natur-og-miljo/forurensning-og-klima/statistikk/utslipp-til-luft) |
| Vy | Rail emission factor (~99% hydropower) | Vy environmental report 2023 |
| Ruter / AtB | Operator-specific bus fleet electrification data | Ruter sustainability report 2024 · AtB fleet data |
| Norled / Fjord1 | Ferry emission factor | Fleet average data 2023 |

---

## Roadmap

The current tool calculates emissions for a **single route** — one person, one journey. The natural next steps extend this to organizational use.

### Bulk calculation (CSV upload)
Upload a file with employee home addresses and workplace locations. The system calculates CO₂ for each employee's commute and exports an aggregated report ready for CSRD submission.

```
Input:  employee_id, home_address, workplace
        1001, Rissa, Indre Fosen, Trondheim S
        1002, Molde, Bergen stasjon
        ...

Output: employee_id, best_route, co2_per_trip, annual_co2, transport_mode
        1001, bus+ferry, 0.70 kg, 308 kg, public_transport
        1002, bus, 3.40 kg, 1 496 kg, public_transport
        ─────────────────────────────────────
        Company total: 47 tonnes CO₂/year
```

Technically: the same `/api/calculate` endpoint, called in a loop — no new methodology, just scale. The current per-route accuracy (Entur timetables, operator-specific factors, ferry detection) carries forward directly.

### HR system integration
Connect to Workday, BambooHR, or similar HRIS to pull employee addresses automatically. Run the calculation on a schedule (monthly or annually). Push results directly into the CSRD reporting platform (Workiva, Salesforce Net Zero, etc.), eliminating manual data entry.

### AI-assisted organizational audit
Given a company's office locations and employee distribution, an AI agent automatically identifies all commute corridors, clusters employees by zone, calculates total Scope 3 Category 7 emissions, and generates the CSRD section with methodology documentation — without any manual input beyond the HR data file.

> The single-route interface serves a critical role in all three scenarios: it enables **spot verification**. Sustainability officers can validate any individual route before trusting bulk results — ensuring the methodology is correct before it scales to hundreds of employees.

---

## Author

[@irinaaf](https://github.com/irinaaf) · demonstrating: Norwegian open data integration (Entur, Miljødirektoratet, EEA), CSRD/ESRS regulatory context, TypeScript / Next.js / React, Scandinavian UX design.
