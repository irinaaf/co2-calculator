# CO₂ Route Calculator — Norway

**Portfolio project** · Compare CO₂ emissions across all transport modes between any two points in Norway, with multimodal Entur routing, real timetable data, and built-in CSRD scope 3 export.

> Built by [@irinaaf](https://github.com/irinaaf)

---

## Why this exists

Since 2024–2026, large Norwegian companies are required to report CO₂ emissions including **employee commuting** (Scope 3, Category 7 under ESRS E1-6 / GHG Protocol). Previously this was done manually in Excel. This tool automates the entire process and generates ready-to-use text for the annual sustainability report.

---

## What it does

The user enters an origin, a destination, selects a departure time and number of work days per year — and receives results in four sections:

| Section | What it shows |
|---|---|
| 🚌 Public transport | Real multi-leg routes (bus, train, ferry, tram, metro, flight) from Entur — searched across a ±4 hour window from departure time |
| 🚗 Private car | EV vs petrol vs diesel comparison (+ bicycle and walking for routes ≤ 25 km) |
| 🔀 Combined (Park & Ride) | Drive to nearest station + public transport for the rest |
| 🚲 Bicycle | Only for routes ≤ 30 km, with actual cycleway routing via OpenStreetMap |

**Best route** is selected as the global minimum CO₂ across all scenario types — including car variants. The card clearly labels what type of transport wins (public transport, car EV, via flight, P+R, etc.).

For each option the app shows:
- CO₂ per trip (always in **kg**, no unit switching)
- Estimated travel time
- Approximate cost (NOK)
- Annual CO₂ (round trip × work days) — calculated from the overall winner, not just transit
- Actual departure time from Entur (may differ from requested time due to wide-window search)
- Per-leg CO₂ breakdown with transport mode and operator

---

## Where the data comes from

### 1. Address search (geocoding)

**Source:** [Entur Geocoder API](https://developer.entur.org/) — Norway's official geocoder. Covers addresses, transit stops, localities, ferry terminals. Requests proxied through `/api/geocode` (Next.js route) to keep `ET-Client-Name` header server-side and avoid CORS.

### 2. Public transport routes — wide-window search

**Source:** [Entur Journey Planner API v3](https://developer.entur.org/pages-journeyplanner-journeyplanner/) — national aggregator for all Norwegian public transport (60 operators: Vy, AtB, Ruter, Skyss, Fjord1, Norled, Widerøe, etc.).

**How it works:**
```
Base departure time →
  → 5 parallel Entur queries: 0h, +2h, +4h, −2h, −4h offsets
  → each returns up to 2 trip patterns
  → deduplicate by leg-signature (mode + distance rounded to 5 km)
  → sort by duration, return up to 6 unique patterns
  → sorted by CO₂ ascending before display
```

This ensures meaningful results even when the requested time has no available connections (e.g. night hours, infrequent rural routes).

**Validation:** If departure time is in the past (> 60 seconds), the form shows a calm informational notice before submitting.

### 3. Road distance for cars

**Source:** [OSRM](https://project-osrm.org/) (Open Source Routing Machine) — router on OpenStreetMap data. Accounts for ferry crossings on E39 and mountain roads.

> **Switching to Google Maps:** add to `.env.local`:
> ```
> ROUTING_PROVIDER=google
> GOOGLE_MAPS_API_KEY=your_key
> ```
> No code changes needed — provider switches automatically via `lib/routing.ts`.

### 4. Bicycle routing

**Source:** Entur Journey Planner with `directMode: bicycle` — uses OpenTripPlanner + OpenStreetMap cycleway tags. Shows "Cycleways" badge when dedicated infrastructure is found.

### 5. CO₂ emission factors

All values always displayed in **kg** (no grams, no tonnes). Values ≥ 1 000 kg use Norwegian thousand separator (space): `1 234 kg`.

### Occupancy assumption

All CO₂ factors are expressed as **kg CO₂e per passenger-kilometre (pkm)**:

- **Public transport** (bus, tram, metro, rail, ferry, hurtigbåt): the factor already accounts for **average vehicle occupancy**. You pay only your share of the vehicle's total emissions. For example, a regional bus emitting 1.3 kg CO₂/km with 48 average passengers → 0.027 kg/pkm per person.
- **Private car**: the factor assumes a **solo driver** (one person per vehicle). This is the standard assumption used by the GHG Protocol and most CSRD tools when individual carpooling data is unavailable. If two people share a car, the real per-person CO₂ is halved — but the calculator uses worst-case solo driver for conservative corporate reporting.

This distinction matters for Norway: a hurtigbåt or long-distance diesel bus can have a higher CO₂/pkm than a solo electric car precisely because the vessel/vehicle is rarely full.

| Transport | Factor | Source |
|---|---|---|
| 🚆 Train (Vy) | 9 g/pkm → 0.009 kg/pkm | Vy environmental report · ~99% hydropower |
| 🚇 Metro T-bane | 5 g/pkm | Ruter report |
| 🚃 Tram | 4 g/pkm | EEA |
| ⛴️ Ferry | 19 g/pkm | Norled / Fjord1 fleet average 2023 |
| 🚤 Hurtigbåt | 25 g/pkm | EEA (higher speed) |
| 🚌 Bus — Oslo (Ruter) | 11 g/pkm | Ruter 2024: ~62% electric fleet |
| 🚌 Bus — Trondheim (AtB) | 18 g/pkm | AtB fleet data |
| 🚌 Regional bus | 27 g/pkm | EEA Transport 2023 |
| ✈️ Domestic flight | 255 g/pkm | EEA + IPCC radiative forcing ×1.9 |
| 🚗 Car (petrol) | 192 g/pkm | Miljødirektoratet |
| 🚗 Car (diesel) | 171 g/pkm | Miljødirektoratet |
| ⚡ Car (EV) | 18 g/pkm | Norwegian grid ~17 g CO₂/kWh × 0.2 kWh/km |
| 🚲 Bicycle | 0 g/pkm | — |
| 🚶 Walking | 0 g/pkm | — |

**Operator-specific bus factors** are applied automatically using the operator name returned by Entur (Ruter, AtB, Skyss, Kolumbus, etc.).

### 6. CO₂ calculation logic

```
CO₂ (kg) = leg distance (km) × emission factor (kg/pkm)
Total CO₂ = sum across all legs
Annual CO₂ = overallWinnerCo2 × 2 (round trip) × work days
```

**Best route** = `min(CO₂ across all scenarios)`:
- All transit patterns (including flight)
- Combined P+R journey
- All car variants (EV, petrol, diesel)

---

## Data export

### CSV export
Table with all journey options and CO₂ figures — ready for Excel.

### CSRD Scope 3 report
Opens in a modal with a **Copy** button. Pre-formatted text for the "Employee commuting" section:
- Route and methodology
- CO₂ per trip and annual total
- Per-leg breakdown with factors and operator names
- Standards: **ESRS E1-6**, **GHG Protocol Category 3.7**

---

## Design

Scandinavian minimalism — warm off-white background, white cards with subtle shadow, muted forest green accent. All transport icons from **lucide-react** (line icons, monochrome). No emoji in UI.

---

## Tech stack

| Component | Technology | Purpose |
|---|---|---|
| Framework | Next.js (latest) + TypeScript | Fullstack: UI + server-side API routes |
| Styling | Tailwind CSS | Responsive design |
| Icons | lucide-react 0.474.0 | Transport and UI icons |
| Transit routes | Entur Journey Planner v3 (GraphQL) | Real public transport routing |
| Geocoding | Entur Geocoder API | Address and stop search |
| Cycling | Entur + OpenTripPlanner + OSM | Bicycle routing with cycleways |
| Road distance | OSRM / Google Maps (switchable) | Car distance calculation |
| CO₂ factors | Miljødirektoratet + EEA 2023 + Vy | Emission calculations |
| Deployment | Vercel | Zero-config Next.js hosting |

**All APIs are free and open.** No API keys required (Google Maps is optional).

---

## Project structure

```
co2-calculator/
├── lib/
│   ├── entur.ts        # Entur API client: geocoding + wide-window routing + bicycle
│   ├── emissions.ts    # CO₂ factors, per-leg calculation, formatCo2 (always kg)
│   ├── routing.ts      # Road distance: OSRM or Google Maps (env-switchable)
│   ├── export.ts       # CSV and CSRD modal text export
│   └── utils.ts        # Tailwind cn() helper
│
├── pages/
│   ├── api/
│   │   ├── calculate.ts  # Main handler: geocoding → wide-window search → 4 scenario types
│   │   └── geocode.ts    # Proxy to Entur geocoder (autocomplete, avoids CORS)
│   ├── _app.tsx
│   └── index.tsx         # Main UI: form + 4 result sections + Best route card + CSRD modal
│
└── components/
    ├── PlaceInput.tsx      # Input with Entur autocomplete dropdown
    ├── LegBreakdown.tsx    # Per-leg route timeline (stop → icon → stop)
    ├── CarScenario.tsx     # Private car comparison with progress bars
    └── BicycleScenario.tsx # Bicycle route card with cycleway badge
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

### Deploy to Vercel

```bash
npm i -g vercel
vercel
```

---

## CSRD context — for HR and sustainability professionals

**CSRD** (Corporate Sustainability Reporting Directive) is an EU directive requiring companies to publicly report climate impact. In Norway it entered force through an amendment to the Accounting Act (June 2024).

**Scope 3, Category 7 — Employee commuting** is the specific reporting line this tool addresses. Companies are required to estimate emissions from employee commutes.

Applicable to ~1,200 Norwegian companies by 2026 (revenue >€40M or >250 employees).

---

## Author

Built as a portfolio project by [@irinaaf](https://github.com/irinaaf), demonstrating:
- Integration with Norwegian open government data (Entur, Miljødirektoratet, EEA)
- Norwegian regulatory context (CSRD, ESRS E1-6)
- TypeScript / Next.js / React with Scandinavian design principles
- Product thinking: UX designed for business users (HR, sustainability officers)
