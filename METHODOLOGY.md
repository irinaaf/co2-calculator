# Emission Calculation Methodology

This document explains how CO₂ emissions are calculated for each journey in the CO₂ Route Calculator. The goal is transparency: every number in the app can be traced back to a specific data source and calculation step.

---

## How a journey becomes a CO₂ number

The core idea is simple: **each leg of the journey gets its own CO₂ calculation**, and the results are summed up.

```
Total CO₂ = Σ (distance of each leg × emission factor for that mode)
```

The emission factor expresses how many kilograms of CO₂ are produced per one **passenger-kilometre** (pkm) — that is, one person travelling one kilometre.

---

## Worked example: Rissa, Indre Fosen → Trondheim S

This route is a good illustration because it involves multiple transport modes including a mandatory ferry crossing — something most generic calculators cannot handle.

### What the journey looks like

When you enter this route, the calculator queries the Entur Journey Planner API. Entur knows the real timetable and returns the actual trip with each leg:

| Leg | Mode | Route | Operator | Distance |
|---|---|---|---|---|
| 1 | Walking | Rissa → Rissa bussterminal | — | 0.32 km |
| 2 | Bus | Rissa → Rørvik kai | AtB · Line 350 | 18.5 km |
| 3 | Ferry | Rørvik kai → Flakk kai | AtB / Fjord1 | 15.8 km |
| 4 | Bus | Flakk kai → Trondheim S | AtB · Line 350 | 3.7 km |
| 5 | Walking | Trondheim S → destination | — | 0.08 km |

Notice that Entur correctly identifies the ferry between Rørvik and Flakk — this is a real segment of the route across the fjord, not an approximation. Most other tools would calculate a straight-line distance between Rissa and Trondheim and multiply by a generic bus factor, completely missing the ferry.

### The CO₂ calculation

| Leg | Distance | Emission factor | CO₂ |
|---|---|---|---|
| Walking | 0.32 km | 0 kg/pkm | 0 kg |
| Bus, AtB (18.5 km) | 18.5 km | 0.018 kg/pkm | 0.333 kg |
| Ferry (15.8 km) | 15.8 km | 0.019 kg/pkm | 0.300 kg |
| Bus, AtB (3.7 km) | 3.7 km | 0.018 kg/pkm | 0.067 kg |
| Walking | 0.08 km | 0 kg/pkm | 0 kg |
| **Total per trip** | **38.4 km** | | **0.700 kg CO₂** |

**Annual figure** (round trip, 220 work days): `0.700 × 2 × 220 = 308 kg CO₂/year`

---

## Where emission factors come from

### Two-layer approach

The calculator uses a two-layer methodology:

**Layer 1 — Baseline factors from EEA**
The European Environment Agency publishes mode-level emission factors for all major passenger transport modes. These serve as the starting point for all calculations.

Source: [Estimated specific emissions of CO₂ by mode of transport (EEA-30)](https://www.eea.europa.eu/en/analysis/maps-and-charts/estimated-specific-emissions-of-co2)

**Layer 2 — Operator adjustments**
For Norwegian operators that publish fleet electrification data, the baseline is adjusted to reflect the actual mix of electric and diesel vehicles in their fleet. The weighted average is then used instead of the generic factor.

For example, AtB (Trondheim) reports approximately 40% electric buses. The adjusted factor:

```
AtB factor = (0.60 × 0.027 diesel) + (0.40 × 0.011 electric) = 0.018 kg/pkm
```

Using the generic EEA diesel factor (0.027) would give a result 48% higher for this operator. The distinction matters because Norway's bus fleets are electrifying at very different rates depending on the city and operator.

### Emission factors by mode

| Transport mode | Factor | Source |
|---|---|---|
| Train (Vy) | 0.009 kg/pkm | Vy environmental report — Norwegian rail runs on ~99% hydropower |
| Metro T-bane (Oslo) | 0.005 kg/pkm | Ruter sustainability report 2024 |
| Tram | 0.004 kg/pkm | EEA — electric traction |
| Ferry | 0.019 kg/pkm | Norled / Fjord1 fleet average 2023 |
| Express passenger boat (hurtigbåt) | 0.025 kg/pkm | EEA — higher speed means more fuel per km |
| Bus — Oslo (Ruter) | 0.011 kg/pkm | Ruter 2024: ~62% of urban buses are electric |
| Bus — Trondheim (AtB) | 0.018 kg/pkm | AtB fleet composition data |
| Bus — Bergen (Skyss) | 0.019 kg/pkm | Skyss fleet data |
| Regional bus | 0.027 kg/pkm | EEA baseline |
| Domestic flight | 0.255 kg/pkm | EEA + IPCC radiative forcing multiplier ×1.9 |
| Car — petrol | 0.192 kg/pkm | Miljødirektoratet, Norwegian fleet average (WLTP) |
| Car — diesel | 0.171 kg/pkm | Miljødirektoratet, Norwegian fleet average (WLTP) |
| Car — EV | 0.018 kg/pkm | Norwegian electricity grid (~17 g CO₂/kWh) × average consumption (0.2 kWh/km) |
| Bicycle | 0 kg/pkm | Zero direct emissions |
| Walking | 0 kg/pkm | Zero direct emissions |

---

## Why some factors are surprisingly high

### Hurtigbåt vs. electric car

It may seem counterintuitive, but a hurtigbåt (high-speed passenger boat) can produce more CO₂ per person than a solo electric car on the same route. This happens because:

- Hurtigbåter run on diesel and travel at high speed, which requires significantly more fuel per kilometre than a slow ferry
- Norway has ~200 express boat vessels on ~100 routes, almost all diesel-powered
- Only about 10 of these routes are currently technically feasible for battery operation
- An EV in Norway charges from a grid that is ~98% hydropower, giving it an exceptionally low emission factor

This is one of the main insights the calculator was built to demonstrate — and it is invisible to any tool that uses a generic "public transport" factor.

### Domestic flight with radiative forcing

The emission factor for flights (0.255 kg/pkm) includes a **radiative forcing multiplier of ×1.9**, recommended by the IPCC. Aircraft do not only burn fuel — they also produce contrails and emit water vapour at altitude, where these substances have a stronger warming effect than at ground level. The multiplier accounts for this total climate impact, not just the direct CO₂ from combustion.

---

## How occupancy is handled

All public transport factors are already expressed **per passenger** — meaning the vehicle's total emissions are divided by the average number of passengers on that type of service. You only pay your proportional share of the bus, ferry or train's emissions.

Car factors assume a **solo driver**. This is the standard assumption under the GHG Protocol (Scope 3, Category 7) when individual carpooling data is not available. If two people share a car, the real per-person CO₂ is halved — but for conservative corporate sustainability reporting, the solo driver figure is the standard.

---

## What the calculator does not include

---

## Choosing which route to report

The Best route card has a toggle with two views:

- **Lowest CO₂** — shows the global minimum across all transport types (public transport, private car, combined P+R). This is the most accurate answer to "what produces the least CO₂ for this journey?"
- **Public transport only** — shows the best ground transit option (bus, train, ferry, tram, metro — no flights). Useful when a company policy requires employees to use public transport, or when the analyst wants to report transit separately from car use.

The selected toggle also determines which journey is exported in the CSRD Scope 3 report and CSV. This ensures the exported data matches what the user sees on screen.

For CSRD Category 7 reporting, both views are methodologically valid — the GHG Protocol allows companies to use the transport mode that employees actually use. The "Lowest CO₂" view gives the theoretical minimum; the "Public transport only" view is more realistic if employees cannot or do not use a car.

---

## Using the calculator for past periods

The Entur Journey Planner API operates on live timetables — it cannot return historical departures. For CSRD annual reporting (e.g. calculating 2024 commute emissions in 2025), this is not a problem, because:

- Norwegian public transport routes are stable — the Rissa–Trondheim route with a ferry crossing has not changed significantly year to year
- Emission factors (kg CO₂/pkm) are updated annually but change slowly
- The GHG Protocol for Scope 3 Category 7 allows the use of representative typical-day calculations rather than exact historical records

When a past departure time is entered, the calculator automatically queries Entur for the **nearest future occurrence of the same weekday and time** — for example, if "Monday 08:00" from last week is entered, it queries the next Monday at 08:00. A soft informational notice is shown to the user. The resulting route and CO₂ figures are a valid representative estimate for CSRD reporting.


| Item | Status |
|---|---|
| Ferry CO₂ for a car carried on the ferry | Shown as a separate informational panel when a ferry crossing is detected on the route — not added to the route total. OSRM routing treats ferry crossings as road segments; adding vehicle-carrying ferry emissions separately would require vessel-specific capacity data not available in open APIs. |
| Infrastructure emissions (building roads, tracks) | Not included — consistent with standard GHG Protocol Scope 3 Cat. 7 methodology |
| Vehicle manufacturing emissions | Not included — scope limited to operational (tailpipe + upstream electricity) emissions |

---

## Data sources and references

- **EEA**: [Estimated specific emissions of CO₂ by mode of transport (EEA-30)](https://www.eea.europa.eu/en/analysis/maps-and-charts/estimated-specific-emissions-of-co2)
- **Entur + SINTEF Energimodul**: [miljo.entur.org](https://miljo.entur.org) — national platform for public transport emissions, follows ISO 14083:2023
- **Miljødirektoratet**: [klimagassutslipp fra transport](https://miljostatus.miljodirektoratet.no/tema/klima/norske-utslipp-av-klimagasser/klimagassutslipp-fra-transport/) — Norwegian national greenhouse gas inventory
- **SSB**: [Utslipp til luft](https://www.ssb.no/natur-og-miljo/forurensning-og-klima/statistikk/utslipp-til-luft) — Statistics Norway, air emissions by source
- **Vy**: Annual environmental report 2023
- **Ruter**: Sustainability report 2024
- **Norled / Fjord1**: Fleet emission data 2023
- **IPCC**: Guidelines on radiative forcing for aviation
