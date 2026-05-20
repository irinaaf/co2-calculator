# Claude Code Tasks — CO₂ Route Calculator

Two task prompts for Claude Code:
1. Technical audit and quality assessment
2. Comprehensive testing (unit + UI + business logic)

---

## Task 1 — Technical Audit and Quality Assessment

```
You are a senior TypeScript/Next.js engineer. Perform a comprehensive technical audit of the CO₂ Route Calculator project located at /Users/irinaafanaseva/Analytic/co2-calculator.

Read ARCHITECTURE.md and README.md first to understand the project fully before starting.

## Scope of audit

### 1. Code quality & standards
- TypeScript strictness: check tsconfig.json, identify any `any` types, missing type guards, unsafe casts (e.g. `as number`, `as unknown`)
- ESLint compliance: run `npm run lint` and categorize all warnings/errors by severity
- Dead code: unused variables, imports, unreachable branches, deprecated patterns
- Naming conventions: consistency in file names, component names, variable names
- Component responsibility: any component doing too much (violates SRP)

### 2. Architecture & design patterns
- Separation of concerns: is business logic (emissions.ts, routing.ts, ferries.ts) cleanly separated from UI?
- Ferry detection heuristic in lib/ferries.ts: is the cross-side algorithm correct? Test edge cases: same city, reverse direction, very long routes (Oslo→Tromsø)
- Error handling: are all async operations wrapped in try/catch? Are errors surfaced properly?
- Race conditions: PlaceInput uses debounce — can stale responses overwrite newer ones?
- The timezone conversion in calculate.ts (Intl.DateTimeFormat approach) — is it robust for DST transitions?

### 3. Performance
- Wide-window search fires 5 parallel Entur requests — risk of rate limiting? Is there caching?
- Bundle size: is lucide-react tree-shaken correctly? (only imported icons, not full library)
- Re-renders: missing useMemo/useCallback where needed
- The `dominantMode()` function and `winnerBadge` calculation run on every render — should they be memoized?

### 4. Security
- /api/geocode proxy: does it expose any headers it shouldn't?
- Input sanitization: are `from` and `to` user inputs sanitized before passing to Entur?
- `GOOGLE_MAPS_API_KEY` confirmed server-side only?
- Rate limiting: any protection against abuse of /api/calculate (fires up to 5+1 parallel external requests)?

### 5. Data accuracy
- The `buildCombinedJourney()` function uses a hardcoded ~15km car leg heuristic — is this reasonable? What happens for very short routes (< 5km) or very long routes (> 500km)?
- `detectFerryCrossingsFromPoints()` — test the cross-side algorithm for all 10 ferry crossings in the table. Are terminal coordinates accurate?
- The CO₂ per car estimates in FERRY_CROSSINGS — are the methodology and sources documented? Are they reasonable?
- `transitJourneys.forEach(j => j.legs.forEach(leg => ...))` mutates `leg.fromName` directly on the JourneyResult — is this a problem if results are cached or reused?

### 6. Reliability
- What happens when Entur returns 0 results for all 5 time offsets?
- What happens when OSRM times out (8s timeout in lib/routing.ts)?
- What if the geocoder returns coordinates in the sea (invalid address)?
- What if `workDays = 0`? (slider min is 1, but API could receive any value)

## Deliverable
Produce AUDIT_REPORT.md in the project root with:
- Executive summary (overall health score 1–10 with justification)
- Findings table: Issue | Severity (Critical/High/Medium/Low) | File:Line | Fix
- Top 5 priority fixes with code examples
- Positive findings (what is done well)
```

---

## Task 2 — Comprehensive Testing

```
You are a QA engineer. Create and run a comprehensive test suite for the CO₂ Route Calculator at /Users/irinaafanaseva/Analytic/co2-calculator.

Read ARCHITECTURE.md first to understand the system before writing tests.

## Part 1 — Unit tests (lib/ functions)

### lib/emissions.ts
- formatCo2(): 0 → "0 kg", 0.003 → "0.003 kg", 0.28 → "0.28 kg", 7.34 → "7.34 kg", 999 → "999 kg", 1000 → "1 000 kg" (space separator), 29700 → "29 700 kg"
- formatDuration(): 0 → "0 min", 45 → "45 min", 60 → "1h 00m", 90 → "1h 30m", 209 → "3h 29m", 180 → "3h 00m"
- calcJourneyResult(): mock legs [bus(AtB, 18km), water(Norled, 16km), bus(AtB, 4km)]. Verify: totalCo2Kg = 0.018×18 + 0.019×16 + 0.018×4, annualCo2Kg = total×2×220, durationSeconds preserved exactly
- Operator-specific bus: Ruter→0.011, AtB→0.018, Skyss→0.019, unknown→0.027
- Occupancy: verify that car factors (0.018 EV, 0.192 petrol) are NOT divided by occupancy (solo driver assumption)

### lib/ferries.ts
- detectFerryCrossingsFromPoints():
  - Rissa (63.595, 9.978) → Trondheim (63.430, 10.395): should detect Rørvik–Flakk ✅
  - Dronningens gate (63.430, 10.395) → St. Olav (63.431, 10.393): should NOT detect any ferry ✅
  - Oslo (59.914, 10.752) → Bergen (60.391, 5.322): should NOT detect Rørvik–Flakk ✅
  - Stavanger (58.970, 5.733) → Bergen (60.391, 5.322): should detect Mortavika–Arsvågen ✅
  - Cross-side direction test: reverse (Trondheim → Rissa) should also detect Rørvik–Flakk
- Terminal coordinates: verify all 10 entries have plausible Norwegian coordinates (lat 57–71°N, lon 4–31°E)

### lib/routing.ts
- getRoadDistance(): mock OSRM response, verify distance/duration parsing
- Fallback: when fetch throws, returns haversine×1.25 with provider="fallback"
- Google Maps path: mock ROUTING_PROVIDER=google env, verify correct URL

### lib/entur.ts
- fetchJourneysWideWindow(): mock fetchJourneyOptions
  - Past offsets skipped (no query before Date.now()-60s)
  - Deduplication: two journeys with same mode:distance sig → keep one
  - Returns sorted by duration ascending
  - Promise.allSettled failure: partial results returned, no crash
- fmtDeparture (in LegBreakdown): "2026-05-20T11:00:00.000Z" → should show "11:00" in CEST (+2) → "13:00 Oslo time" — wait, verify this is correctly showing Europe/Oslo time

## Part 2 — API route tests (/api/calculate)

- Valid request: mock Entur + OSRM, verify CalculateResponse shape includes: from, to, distanceKm, roadDistanceKm, routingProvider, scenarios, unavailableModes, ferryCrossings
- Departure in past: `dateTime = "2020-01-01T08:00"` → API should handle gracefully (doesn't validate, client does)
- Entur returns 0 results: scenarios contains car scenario, unavailableModes includes "train", ferryCrossings is []
- Origin/Destination replacement: mock Entur returning legs with fromName="Origin", toName="Destination" → verify they are replaced with fromPoint.displayName / toPoint.displayName short form
- Ferry detection: coordinates straddling Rørvik–Flakk → ferryCrossings.length > 0
- workDays = 0: should be clamped (min 1, max 365)

## Part 3 — Business logic (client-side derived values)

Test in isolation or via integration:
- carIsOverallBest = true when car.co2Kg < bestJourney.totalCo2Kg
- overallWinnerCo2 = min(transit, car) — never picks flight over EV if EV is cheaper
- Annual CO₂ = overallWinnerCo2 × 2 × workDays (not bestJourney.annualCo2Kg which might be flight)
- Bicycle section suppressed when carVariants includes label "Bicycle"
- groundTransitScenarios excludes air-leg journeys
- dominantMode(): all 6 cases covered (flight, ferry, mixed, rail, bus, transit)

## Part 4 — E2E tests (Playwright)

### Happy path — ferry route
1. Open localhost:3000
2. From: "Rissa" → select "Rissa sentrum, Indre Fosen"
3. To: "Trondheim S" → select
4. Set departure: tomorrow 08:00
5. Click "Calculate footprint"
6. Assert: Public transport section contains a leg with Ship icon
7. Assert: Private car section contains FerryCrossingsInfo panel with "Rørvik – Flakk"
8. Assert: FerryCrossingsInfo in car section shows CO₂ value (e.g. "+0.62 kg")
9. Assert: Annual impact shows "kg" values (no "t" or "g")
10. Assert: Best route badge is visible

### City route — no ferry
1. From: "Dronningens gate, Trondheim" → To: "St. Olavs hospital, Trondheim"
2. Calculate
3. Assert: NO FerryCrossingsInfo panel anywhere on page
4. Assert: Bicycle section NOT shown (route < 25km, bike is in car section)

### Time validation
1. Set departure: yesterday 08:00
2. Click Calculate
3. Assert: Clock icon notice appears (NOT red destructive error)

### CSRD modal
1. Calculate any route
2. Click "CSRD scope 3 report"
3. Assert: modal opens
4. Assert: Copy button present
5. Click Copy
6. Assert: button text changes to "Copied!" then back to "Copy"

### About modal
1. Click "About" in header
2. Assert: modal opens with "Portfolio Project" label
3. Click outside modal → closes

## Part 5 — CO₂ spot-checks (known values)

| Scenario | Expected | Tolerance |
|---|---|---|
| 100km train (Vy) | 0.90 kg | ±2% |
| 100km bus (Ruter) | 1.10 kg | ±2% |
| 100km bus (AtB) | 1.80 kg | ±2% |
| 100km bus (unknown) | 2.70 kg | ±2% |
| 100km ferry | 1.90 kg | ±2% |
| 100km EV car | 1.80 kg | ±2% |
| 100km petrol car | 19.20 kg | ±2% |
| 100km flight | 25.50 kg | ±2% |
| Annual: 0.9kg × 2 × 220 | 396 kg | exact |

## Deliverable
1. Create /tests/ directory with all unit test files (Jest)
2. Create /tests/e2e/ with Playwright specs
3. Add to package.json: `"test": "jest"`, `"test:e2e": "playwright test"`
4. Run all unit tests → report
5. Save TEST_REPORT.md: total tests, pass/fail, coverage, bugs found
```

---

*Last updated: 2026-05-20 — reflects ferry detection, timezone fix, Origin/Destination replacement, bicycle deduplication, durationSeconds precision.*
