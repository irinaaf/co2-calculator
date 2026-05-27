# CO₂ Route Calculator — Norway

**Portfolio project** · Compare CO₂ emissions across all transport modes between any two points in Norway, with multimodal Entur routing, real timetable data, ferry crossing detection, and built-in CSRD scope 3 export.

> Built by [@irinaaf](https://github.com/irinaaf)

---

## Why this exists

Since 2024–2026, large Norwegian companies are required to report CO₂ emissions including **employee commuting** (Scope 3, Category 7 under ESRS E1-6 / GHG Protocol). This tool automates the process and generates ready-to-use text for the annual sustainability report.

It also solves a personal question: *what is the actual CO₂ footprint of my own commute?*

---

## What it does

Enter origin, destination, departure time and work days per year — get results across four sections:

| Section | What it shows |
|---|---|
| Public transport | Real multi-leg routes (bus, train, ferry, tram, metro, flight) from Entur — searched across ±4 hours |
| Private car | EV / petrol / diesel comparison (+ bicycle and walking for routes ≤ 25 km) |
| Combined (P+R) | Drive to nearest station + public transport |
| Bicycle | For routes ≤ 30 km, with OSM cycleway routing |

**Best route** = global CO₂ minimum across all scenario types including car variants.

A toggle switches between **Lowest CO₂** (global winner across all modes) and **Public transport only** (best ground transit route). The selected mode determines what appears in the CSRD export.

---

## Data export

### CSV
Full data dump in one file: selected route with per-leg breakdown, all public transport options, all car variants, ferry crossings, and annual impact summary. Opens correctly in Excel (UTF-8 BOM, Norwegian thousand separators).

### CSRD Scope 3 report
Opens in a modal with a Copy button. Pre-formatted for direct paste into the annual sustainability report — includes reporting basis, per-leg breakdown with emission factors, and full methodology with data source URLs. Standards: **ESRS E1-6**, **GHG Protocol Category 3.7**.

---

## Design

Scandinavian minimalism — warm off-white background, white cards, muted forest green accent. All transport icons from **lucide-react** (monochrome, consistent line style). No emoji in UI.

---

## Quick start

```bash
git clone https://github.com/irinaaf/co2-calculator
cd co2-calculator
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). No API keys required — Entur is free and open.

To use Google Maps instead of OSRM for road distance, add `.env.local`:

```
ROUTING_PROVIDER=google
GOOGLE_MAPS_API_KEY=your_key_here
```

---

## Tech stack

| | |
|---|---|
| Framework | Next.js 16 + TypeScript |
| Styling | Tailwind CSS + lucide-react |
| Transit routes | Entur Journey Planner v3 (GraphQL) |
| Geocoding | Entur Geocoder API |
| Road distance | OSRM / Google Maps (env-switchable) |
| Deployment | Vercel |

---

## Roadmap

The current tool calculates emissions for a **single route** — one person, one journey. The natural next steps extend this to organizational use.

### Bulk calculation (CSV upload)
Upload a file with employee home addresses and workplace locations. The system calculates CO₂ for each employee's commute and exports an aggregated report ready for CSRD submission.

```
Input:  employee_id, home_address, workplace
        1001, Rissa, Indre Fosen, Trondheim S
        1002, Molde, Bergen stasjon

Output: employee_id, best_route, co2_per_trip, annual_co2, transport_mode
        1001, bus+ferry, 0.70 kg, 308 kg, public_transport
        1002, bus, 3.40 kg, 1 496 kg, public_transport
        ─────────────────────────────────────────────────
        Company total: 47 tonnes CO₂/year
```

Technically: the same `/api/calculate` endpoint called in a loop — no new methodology, just scale.

### HR system integration
Connect to Workday, BambooHR, or similar HRIS to pull employee addresses automatically. Run on a schedule and push results directly into a CSRD reporting platform (Workiva, Salesforce Net Zero, etc.).

### AI-assisted organizational audit
Given a company's office locations and employee distribution, an AI agent identifies all commute corridors, clusters employees by zone, calculates total Scope 3 Category 7 emissions, and generates the CSRD section — without manual input beyond the HR data file.

> The single-route interface serves a critical role in all three scenarios: it enables **spot verification**. Sustainability officers can validate any individual route before trusting bulk results — ensuring the methodology is correct before it scales.

---

## Documentation

| | |
|---|---|
| [METHODOLOGY.md](./METHODOLOGY.md) | Emission factors, data sources, occupancy assumptions, worked examples |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Technical implementation: data flow, API design, component structure, algorithms |

---

## Author

[@irinaaf](https://github.com/irinaaf) · demonstrating: Norwegian open data integration (Entur, Miljødirektoratet, EEA), CSRD/ESRS regulatory context, TypeScript / Next.js / React, Scandinavian UX design.
