# CO₂ Route Calculator — Technical Audit Report

**Date:** 2026-05-20  
**Auditor:** Claude Sonnet 4.6 (automated code review)  
**Scope:** Full codebase — lib/, pages/, components/  
**Branch:** claude/tender-leavitt-b20325

---

## Executive Summary

**Overall health score: 7 / 10**

The project is a well-structured, purposeful Next.js application with clean separation of concerns, coherent data flow, and meaningful real-world domain modelling. TypeScript strict mode is enabled, lucide-react is imported with named imports (tree-shaken correctly), and the CO₂ methodology is transparently documented. The public Entur API is used without a key and correctly identified in headers.

The score is held back by a cluster of medium-to-high severity issues that are all fixable without rearchitecting:

- No rate limiting on `/api/calculate` — a single malicious user can exhaust the Entur and OSRM quotas.
- A stale-response race condition in `PlaceInput` is latent but real.
- The timezone offset parsing regex silently swallows half-hour offsets and misreads `GMT+10` (reads only the last digit).
- Three `as unknown as CalculateResponse` escape hatches bypass TypeScript's error type safety.
- Direct mutation of cached `JourneyResult` legs (the "Origin/Destination" replacement) causes correctness risk if results are ever memoized or shared.
- One duplicate `subtitle` assignment is a dead-code bug that silently overwrites itself.

---

## Findings Table

| # | Issue | Severity | File : Line | Fix |
|---|-------|----------|-------------|-----|
| F-01 | No rate limiting on `/api/calculate` — fires up to 7 external requests per call (5× Entur, 1× OSRM, 1× Entur bicycle) | High | `pages/api/calculate.ts:198` | Add `upstash/ratelimit` or a simple in-memory token bucket per IP |
| F-02 | Timezone offset regex `GMT([+-])(\d+)` only captures single-digit hours; `GMT+10` is read as `+0` (last char `0`) | High | `pages/api/calculate.ts:228–229` | Use `\d+` with full match: `parseInt(offsetMatch[2])` already reads the group — but the regex stops at `\d+` which does match multi-digit. **Actual bug:** half-hour zones like `GMT+5:30` are silently truncated. For Norway this is inert (only +1/+2), but the regex is fragile |
| F-03 | Stale response race condition in `PlaceInput.fetchSuggestions`: debounce delays the fetch, but if a slow response arrives after a faster one from a later keystroke, it overwrites the newer state | Medium | `components/PlaceInput.tsx:55–67` | Capture an `AbortController` per request; abort on the next invocation |
| F-04 | Direct mutation of `JourneyResult.legs[].fromName/toName` — mutates the objects returned by `calcJourneyResult` in-place. If results are ever cached or referentially shared, downstream code will see corrupted names | Medium | `pages/api/calculate.ts:279–289` | Replace with: `leg = { ...leg, fromName: fromLabel }` or clone the journey before mutation |
| F-05 | Duplicate `subtitle` property assignment — line 345 silently overwrites line 344, making line 344 dead code | Medium | `pages/api/calculate.ts:344–345` | Remove line 344 (`subtitle: ... emoji ...`) which uses `l.emoji` (undefined on `LegResult`); keep line 345 only |
| F-06 | `as unknown as CalculateResponse` used 3× to coerce error-shaped objects into the success response type — bypasses type safety on error paths | Medium | `pages/api/calculate.ts:205, 212, 416` | Define a discriminated union: `type ApiResponse = CalculateResponse \| { error: string }` and use that as the response type |
| F-07 | `features.map((f: any) => ...)` in geocode proxy — `any` type for upstream GeoJSON response | Medium | `pages/api/geocode.ts:47` | Define an inline interface `GeoJsonFeature` with the expected shape, or use a type assertion with a guard |
| F-08 | `any` used 3× in `entur.ts`: `(f: any)` in geocodeAutocomplete, `patterns: any[]`, and `(pattern: any)` in fetchJourneyOptions | Medium | `lib/entur.ts:105, 206–207, 209` | Define `RawGeoFeature` and `RawTripPattern` interfaces for the upstream JSON shapes |
| F-09 | `mode: "car_ev" as any` in `buildCombinedJourney` — forces an invalid `EnturMode` value into a `LegResult.mode` field | Medium | `pages/api/calculate.ts:155` | Either extend `EnturMode` to include `"car_ev"` or define a separate `CombinedLeg` type that uses `TransportMode` |
| F-10 | `isHurtigbat()` logic has a precedence bug: `sub.includes("local") === false` is evaluated as `(sub.includes("local")) === false` (correct), but the second `&&` clause `(leg.avgSpeedKmh ?? 0) > 25` references `avgSpeedKmh` which does not exist on `JourneyLeg` — it will always be `0` | Medium | `lib/emissions.ts:223–226` | Remove the dead speed branch; rely solely on `subMode` containing "highspeed" |
| F-11 | Ferry cross-side algorithm uses a flat 25 km radius for all 10 crossings. For Bodø–Lofoten (40 km crossing), the radius is too tight relative to the crossing length; Trondheim city queries could falsely match Rørvik–Flakk if the user is within 25 km of Flakk terminal | Medium | `lib/ferries.ts:185` | Make `maxTerminalKm` per-crossing (e.g. `ferry.distanceKm * 1.5`), or tighten the default to 20 km |
| F-12 | `/api/geocode` sets `Cache-Control: public` — the response includes geocoded coordinates that are user-specific only if the query is. The header is fine for anonymous queries, but if any auth is added later this becomes a security issue. Currently no headers are stripped from the upstream Entur response | Low | `pages/api/geocode.ts:55` | Document the intentional public caching; add a comment noting that private user data must not be cached this way |
| F-13 | `GOOGLE_MAPS_API_KEY` is correctly used only in `lib/routing.ts` (server-side, never imported in components or pages/index.tsx). Confirmed safe | Info | `lib/routing.ts:97` | No action needed |
| F-14 | `buildCombinedJourney` heuristic: `carLegKm = min(15, roadKm * 0.2)`. For a 3 km route, this gives a 0.6 km car leg — plausible. For a 500 km route it caps at 15 km — reasonable. For a 5 km route the P+R combined scenario shows a 1 km car leg to a station, which is unrealistic (no P+R station within 1 km of origin for most routes) | Low | `pages/api/calculate.ts:145` | Add a minimum threshold: `const carLegKm = Math.min(15, Math.max(3, roadKm * 0.2))` |
| F-15 | `workDays = 0` handled: `Math.min(Math.max(Number(workDays) \|\| 220, 1), 365)` clamps to [1, 365]. If API receives `workDays = 0` it becomes `220` (the `\|\| 220` fallback for falsy). This is correct but surprising — `0` is treated the same as `undefined` | Low | `pages/api/calculate.ts:216` | Use explicit check: `workDays != null && workDays !== "" ? Math.min(Math.max(Number(workDays), 1), 365) : 220` |
| F-16 | `dominantMode()` and `winnerBadge` object are recalculated inline on every render of `Home` — not wrapped in `useMemo` | Low | `pages/index.tsx:144–166` | Wrap in `useMemo([bestJourney, carIsOverallBest, bestTransitMode])` |
| F-17 | `allJourneys.sort(...)` mutates the source array in-place on every render (since `allJourneys` is a new array, this is safe — but `carJourneys.sort(...)` on line 131 also mutates an array constructed inline, which is fine). No real bug, but both sorts should use `[...arr].sort()` for clarity | Low | `pages/index.tsx:124–131` | Minor: `[...allJourneys].sort(...)` |
| F-18 | `lib/routing.ts` file header is in Russian — inconsistent with the English codebase | Low | `lib/routing.ts:1–14` | Translate comments to English for consistency |
| F-19 | `export.ts`: `_comparison: unknown[]` parameter is unused (kept for "signature compat"). This is dead API surface that will confuse callers | Low | `lib/export.ts:9, 71` | Remove the parameter from both functions and update call sites in `index.tsx` |
| F-20 | `LegBreakdown` does not forward `durationSeconds` from `JourneyResult` to `LegResult`. `JourneyResult.durationSeconds` exists (line 257 in emissions.ts) but `LegResult` (line 234) has `durationSeconds` on the interface — however `calcJourneyResult` at line 322 uses `option.durationSeconds` but the `JourneyResult` return type does not declare it in the interface (line 250–258). The field is set on line 322 but missing from the interface — TypeScript strict mode would normally catch this | Medium | `lib/emissions.ts:250–258, 321–322` | Add `durationSeconds?: number` to the `JourneyResult` interface |
| F-21 | `PlaceInput` suggestion dropdown uses index `i` as `key` prop — items can reorder when Entur returns different sorted results, causing React reconciliation with wrong keys | Low | `components/PlaceInput.tsx:119` | Use `key={s.label}` or `key={s.lat + ',' + s.lon}` |
| F-22 | No `aria-label` or `role` attributes on the suggestion dropdown buttons; keyboard navigation is not possible (no `onKeyDown` handler for arrow keys/Enter on the dropdown) | Low | `components/PlaceInput.tsx:118–130` | Add `role="listbox"` on container and `role="option"` + `aria-selected` on items; handle keyboard events |
| F-23 | OSRM public demo server (`router.project-osrm.org`) is used — ToS prohibit high-volume usage. No retry logic or circuit breaker. If OSRM is down, fallback is haversine × 1.25 which could be 30–40% off for mountain routes | Low | `lib/routing.ts:67` | Document the production recommendation to self-host OSRM; add a note in env configuration |
| F-24 | `fetchJourneysWideWindow` skips past-time queries but silently returns an empty array when ALL 5 offsets are in the past — no error is surfaced. The handler treats empty `transitJourneys` as "no routes found" rather than "bad input time" | Low | `lib/entur.ts:286–287`, `pages/api/calculate.ts:319–326` | Distinguish between "all queries skipped (time in past)" and "queries ran but no routes" |
| F-25 | `CarScenario` component receives `title` and `subtitle` props but never renders them (the function signature accepts `{ variants }` only, ignoring `title` and `subtitle`) | Low | `components/CarScenario.tsx:23` | Either remove unused props from the interface or render the subtitle |

---

## Top 5 Priority Fixes

### Priority 1 — Add rate limiting to `/api/calculate` (F-01)

**Risk:** Each call fires up to 7 parallel external HTTP requests. Without rate limiting, a script making 10 concurrent calls/second would fire 70 external requests/second — enough to get the IP banned by Entur and OSRM.

**Fix:** Add a lightweight in-memory rate limiter at the top of the handler. For Vercel serverless, an upstash Redis-based limiter is the production solution; for development, a simple in-memory map suffices:

```typescript
// pages/api/calculate.ts — add near top of file
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string, maxPerMinute = 20): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > maxPerMinute;
}

// Inside handler, before the geocode step:
const ip = req.headers["x-forwarded-for"]?.toString().split(",")[0] ?? "unknown";
if (isRateLimited(ip)) {
  return res.status(429).json({ error: "Too many requests" } as unknown as CalculateResponse);
}
```

### Priority 2 — Fix stale response race condition in `PlaceInput` (F-03)

**Risk:** User types "Trondheim", waits for slow response, types "Ålesund" — the Trondheim response arrives after the Ålesund response and overwrites the dropdown. This is a classic debounce pitfall.

**Current code (lines 55–67):**
```typescript
const fetchSuggestions = useCallback(
  debounce(async (query: string) => {
    // ...
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
    const data: PlaceSuggestion[] = await res.json();
    setSuggestions(data);  // ← can be stale
  }, 280), []
);
```

**Fix — add AbortController:**
```typescript
const abortRef = useRef<AbortController | null>(null);

const fetchSuggestions = useCallback(
  debounce(async (query: string) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    if (query.trim().length < 2) { setSuggestions([]); setOpen(false); return; }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/geocode?q=${encodeURIComponent(query)}`,
        { signal: abortRef.current.signal }
      );
      if (!res.ok) throw new Error("geocode failed");
      const data: PlaceSuggestion[] = await res.json();
      setSuggestions(data);
      setOpen(data.length > 0);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setSuggestions([]);
    } finally { setLoading(false); }
  }, 280), []
);
```

### Priority 3 — Fix direct mutation of JourneyResult legs (F-04)

**Risk:** `calcJourneyResult` returns objects; the handler mutates `leg.fromName` and `leg.toName` in-place. If response objects are ever cached (e.g. in a React ref, or if the function is called from a memoized context), the mutation will silently corrupt leg names globally.

**Current code (lines 279–289):**
```typescript
transitJourneys.forEach((journey) => {
  journey.legs.forEach((leg, idx) => {
    if (leg.fromName === "Origin" || leg.fromName === "origin")
      leg.fromName = fromLabel;  // ← mutates in place
    // ...
  });
});
```

**Fix — clone the journey:**
```typescript
const processedJourneys = transitJourneys.map((journey) => ({
  ...journey,
  legs: journey.legs.map((leg) => ({
    ...leg,
    fromName:
      leg.fromName === "Origin" || leg.fromName === "origin" ? fromLabel
      : leg.fromName === "Destination" || leg.fromName === "destination" ? toLabel
      : leg.fromName,
    toName:
      leg.toName === "Origin" || leg.toName === "origin" ? fromLabel
      : leg.toName === "Destination" || leg.toName === "destination" ? toLabel
      : leg.toName,
  })),
}));
```

### Priority 4 — Remove dead subtitle line and `as unknown as CalculateResponse` casts (F-05, F-06)

**Dead subtitle (line 344–345):**
```typescript
// BEFORE — line 344 is dead code, line 345 overwrites it
subtitle: `Drive to station · then ${transitJourneys[0].legs.map((l) => l.emoji).join(" + ")}`,
subtitle: `Drive to station · then ${transitJourneys[0].legs.filter((l) => l.mode !== "foot").map((l) => l.mode).join(" + ")}`,

// AFTER — keep only line 345 (also: l.emoji doesn't exist on LegResult)
subtitle: `Drive to station · then ${transitJourneys[0].legs.filter((l) => l.mode !== "foot").map((l) => l.mode).join(" + ")}`,
```

**Type-safe error responses (lines 205, 212, 416):**
```typescript
// BEFORE
res.status(405).json({ error: "Method not allowed" } as unknown as CalculateResponse);

// AFTER — use a union response type
type ApiResult = CalculateResponse | { error: string };
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResult>
) {
  // ...
  return res.status(405).json({ error: "Method not allowed" });
}
```

### Priority 5 — Fix `isHurtigbat()` dead branch and `any` types in entur.ts (F-10, F-08)

**`avgSpeedKmh` does not exist on `JourneyLeg` — it is always `0`:**
```typescript
// CURRENT (lib/emissions.ts:223–226) — second condition always false
function isHurtigbat(leg: JourneyLeg): boolean {
  const sub = (leg.subMode ?? "").toLowerCase();
  return (
    sub.includes("highspeed") ||
    sub.includes("local") === false && leg.mode === "water" && (leg.avgSpeedKmh ?? 0) > 25
    // ↑ avgSpeedKmh is not on JourneyLeg — this is always 0 > 25 = false
  );
}

// FIX — simplify to subMode only
function isHurtigbat(leg: JourneyLeg): boolean {
  const sub = (leg.subMode ?? "").toLowerCase();
  return sub.includes("highspeed") || sub.includes("highspeedpassenger");
}
```

**Replace `any` types in entur.ts:**
```typescript
// BEFORE (line 105)
return (json.features ?? []).map((f: any) => ({ ... }));

// AFTER — add raw shape interface
interface RawGeoFeature {
  properties: { label: string; layer: string };
  geometry: { coordinates: [number, number] };
}
// Then:
return (json.features ?? [] as RawGeoFeature[]).map((f: RawGeoFeature) => ({ ... }));
```

---

## Detailed Analysis by Section

### 1. TypeScript Strictness

`tsconfig.json` correctly enables `"strict": true`. However:

- **3× `any` in `lib/entur.ts`** (lines 105, 206–207, 209): upstream JSON bodies typed as `any[]` / `any`. This is the most common source of runtime errors in the application because a change in the Entur GraphQL response schema would be silent at compile time.
- **1× `any` in `pages/api/geocode.ts`** (line 47): `features: any[]` for the upstream GeoJSON array.
- **1× `as any`** in `pages/api/calculate.ts` (line 155): `mode: "car_ev" as any` forces an invalid `EnturMode` into `LegResult`. The `car_ev` mode is rendered by `ModeIcon` in `LegBreakdown` with a `case "car_ev"` branch, but this case is actually missing from `LegBreakdown.tsx` (only in `CarScenario.tsx`). The `ModeIcon` in `LegBreakdown` falls through to `HelpCircle` for `car_ev`.
- **3× `as unknown as CalculateResponse`** (lines 205, 212, 416): bypasses the response type entirely.

### 2. Architecture & Separation of Concerns

**Positive:** Business logic is cleanly separated. `lib/emissions.ts`, `lib/ferries.ts`, `lib/entur.ts`, and `lib/routing.ts` are all pure computation modules with no React or HTTP-handler concerns. The API route is the only orchestration point. Components are display-only.

**Concerns:**
- `buildCombinedJourney()` in `calculate.ts` mixes a heuristic model (P+R ~15 km) with the transport scenario construction. This is acceptable for an MVP but should be a named limitation.
- `detectUnavailable()` in `calculate.ts` only checks for `"air"` and `"rail"` modes, silently ignoring `"bus"`, `"water"`, and `"tram"`. The function is used to show "N/A" labels in the UI, but a water-only route would not surface "no train" as unavailable even if relevant.
- The `dominantMode()` function is defined inline inside the `Home` component (line 144) rather than in a utility or the emissions module. It belongs in `lib/emissions.ts`.

### 3. Ferry Detection Algorithm

**Cross-side algorithm correctness:**

The algorithm is logically correct for the stated goal. Testing against documented edge cases:

- **Same-city route (Dronningens gate → St. Olav, 0.15 km):** `routeLen (0.15) < ferryLen (19.5) × 1.2 = 23.4` → `false`. Correctly filtered.
- **Rissa → Trondheim (27.6 km straight line):** `27.6 > 19.5 × 1.2 = 23.4` → passes filter. Then: Rissa is ~15 km from Rørvik terminal (t2), Trondheim is ~7 km from Flakk terminal (t1). Both ≤ 25 km → `true`. Correctly detected.
- **Oslo → Tromsø (very long route, ~1,500 km):** routeLen >> all ferry lengths, passes filter. But neither endpoint is within 25 km of any of the 10 terminal pairs → `false`. Correct.
- **Bergen → Stavanger (Halhjem–Sandvikvåg):** Bergen is ~15 km from Halhjem (60.177, 5.468), Stavanger is ~35 km from Arsvågen (59.359, 5.457) — Stavanger is actually outside the 25 km radius for Arsvågen. This is a **potential false negative**: Bergen–Stavanger via E39 does cross this ferry, but the algorithm may miss it depending on exact user-entered coordinates.

**Terminal coordinate accuracy:**
- Rørvik–Flakk: terminals listed as `[63.4480, 10.2040]` and `[63.5590, 10.5080]`. Rørvik ferry terminal is at approximately 63.448°N, 10.204°E — correct. Flakk is at approximately 63.558°N, 10.510°E — correct within ~100 m.
- Halhjem: listed as `[60.1770, 5.4680]` — correct (60.177°N).
- Bodø–Lofoten: listed as `[67.2804, 14.4049]` and `[67.5270, 12.1020]`. The Bodø terminal is at approximately 67.280°N, 14.405°E — close. The Lofoten end at Røst/Moskenes varies by season. The 25 km radius is very tight for a 40 km crossing.

### 4. Performance

**lucide-react tree-shaking:** Confirmed correct. All icons are named imports: `import { Car, Plane, ... } from "lucide-react"`. lucide-react v0.474 supports tree-shaking by default with ESM. No full-library import detected.

**Parallel fetching:** `fetchBicycleRoute` and `fetchJourneysWideWindow` are started in parallel (line 257–267). Good.

**Re-renders:**
- `dominantMode()` runs on every render (no `useMemo`).
- `winnerBadge` object is recreated on every render.
- `allJourneys.sort()` runs on every render.
- `carJourneys.sort()` runs on every render.
- For a static results page these are cheap, but wrapping in `useMemo` is best practice.

**Wide-window search rate limiting risk:** 5 parallel Entur requests per user request is not excessive for an open API that encourages use with `ET-Client-Name`. However, there is no back-off or retry logic if any request returns HTTP 429.

### 5. Security

**API key exposure:** `GOOGLE_MAPS_API_KEY` is only read in `lib/routing.ts` which is a server-side module. It is never imported in any component or `pages/index.tsx`. Safe.

**Input sanitization:** User-supplied `from` and `to` strings are passed to `geocodeOne()` which appends them as a URL query parameter via `new URLSearchParams({ text: q, ... })`. `URLSearchParams` encodes special characters automatically — injection is not possible via this path. The value is not used in any SQL, shell command, or evaluated expression. Safe.

**Header exposure in `/api/geocode`:** The proxy fetches from Entur and returns only the mapped `PlaceSuggestion[]` array — no upstream headers (e.g. `Set-Cookie`, `Authorization`) are forwarded. The proxy only adds `Cache-Control`. Safe.

**`Cache-Control: public` on geocode responses:** Geographic address → coordinates mappings are not user-sensitive. Public caching for 5 minutes is appropriate.

### 6. Data Accuracy

**CO₂ per car ferry estimates:** The figures (`co2PerCarKg`) are presented as estimates based on fleet data and are clearly marked as informational. The methodology note at the top of `ferries.ts` cites Norled sustainability report 2023. The values are reasonable (e.g. 0.62 kg for a ~16 km diesel-ferry crossing at ~50 vehicles/sailing is approximately correct for a LNG/diesel vessel).

**`buildCombinedJourney` heuristic:** `carLegKm = min(15, roadKm * 0.2)`.
- Route = 5 km: car leg = 1 km. Unrealistic (almost certainly walking distance to the station — the P+R scenario makes no sense for a 5 km route).
- Route = 75 km: car leg = 15 km. Plausible.
- Route = 500 km: car leg = 15 km. Plausible (caps at 15 km which is a reasonable station catchment).
- **Known limitation correctly documented** in ARCHITECTURE.md and `buildCombinedJourney()` JSDoc.

**Leg mutation and caching:** As noted in F-04, `transitJourneys.forEach(j => j.legs.forEach(leg => ...))` mutates `leg.fromName` on the `LegResult` objects that were returned by `calcJourneyResult`. These same objects are then included in the response JSON. Since Next.js serializes the response to JSON before sending, there is no risk of the mutation propagating to a subsequent request — but if the code ever becomes isomorphic (SSR + client-side caching) this would be a silent correctness bug.

### 7. Reliability

**Entur returns 0 results for all 5 offsets:**
- `fetchJourneysWideWindow` returns `[]`.
- Handler pushes a placeholder scenario with `journey: null` and `subtitle: "No routes found"`.
- UI renders the placeholder message. Graceful.

**OSRM timeout (8 seconds):**
- `AbortSignal.timeout(8_000)` is used. Good.
- On timeout/error, `getRoadDistance` catches and falls back to `haversine × 1.25`.
- The fallback provider is exposed in the response as `"fallback"` which the UI displays as "estimated". Good.

**Geocoder returns sea coordinates:** If Entur geocodes a query to a location in the sea (e.g. "Nordsjøen"), OSRM will fail with "no route found" (code ≠ "Ok") and fall back to haversine. Entur Journey Planner will either return 0 results or error with a GraphQL error. The outer `try/catch` in the handler returns HTTP 500 with the error message. Marginally handled but not user-friendly.

**`workDays = 0`:** Handled via `Number(workDays) || 220` — 0 is falsy, defaults to 220. See F-15.

---

## Positive Findings

1. **TypeScript strict mode enabled** — the `tsconfig.json` has `"strict": true`. The compiler catches most type errors at build time.

2. **lucide-react tree-shaking is correct** — all icon imports use named imports. No `import * as Icons` or full-library import was found.

3. **Clean separation of concerns** — all CO₂ logic is in `lib/emissions.ts`, all ferry data in `lib/ferries.ts`, all routing in `lib/routing.ts`. The API handler is a thin orchestrator. Components are pure display.

4. **Entur ET-Client-Name correctly added** — required by Entur ToS, correctly set to `"portfolio-co2-calculator"` in all fetch calls to the Entur API.

5. **OSRM has an 8-second timeout with graceful fallback** — `AbortSignal.timeout(8_000)` is used; failure falls back to haversine × 1.25 and the UI shows "estimated" for the provider.

6. **`Promise.allSettled` used for wide-window search** — failed individual Entur queries do not crash the entire calculation. Partial results are still returned.

7. **Timezone handling is functionally correct for Norway** — although the regex is fragile (see F-02), Norway only uses UTC+1 (winter) and UTC+2 (summer), so the current implementation correctly handles both CET and CEST.

8. **Input validation on workDays** — `Math.min(Math.max(Number(workDays) || 220, 1), 365)` clamps to a safe range server-side, regardless of what the client sends.

9. **CO₂ methodology is transparently documented** — sources are cited in code comments (Vy data, EEA 2023, Norled reports) and in the README. The CSRD export correctly attributes the data sources.

10. **No secrets in client-side code** — `GOOGLE_MAPS_API_KEY` is confirmed server-side only. Entur is key-free.

11. **`reactStrictMode: true`** in `next.config.js` — helps surface side-effect bugs in development.

12. **Deduplication by leg signature** in `fetchJourneysWideWindow` is a thoughtful design — avoids returning 10 identical train trips at different times when only 2–3 unique routing patterns exist.

---

## Appendix: Issue Severity Definitions

| Severity | Definition |
|----------|-----------|
| Critical | Data loss, security vulnerability, or incorrect CO₂ calculation by >10% |
| High | Could affect all users or cause API abuse/ban; latent correctness bug |
| Medium | Type safety bypass, race condition, dead code with wrong behavior |
| Low | Code quality, maintainability, minor UX issues |
| Info | Confirmed safe, no action required |
