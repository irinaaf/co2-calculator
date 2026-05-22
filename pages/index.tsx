import { useState, useMemo } from "react";
import Head from "next/head";
import { Car, Leaf, Clock, TrainFront, Info, X } from "lucide-react";
import type { CalculateResponse } from "./api/calculate";
import type { JourneyResult } from "@/lib/emissions";
import { PlaceInput } from "@/components/PlaceInput";
import { LegBreakdown } from "@/components/LegBreakdown";
import { CarScenario } from "@/components/CarScenario";
import { BicycleScenario } from "@/components/BicycleScenario";
import { FerryCrossingsInfo } from "@/components/FerryCrossingsInfo";
import { exportCsv, exportCsrdText, type SelectedJourney } from "@/lib/export";
import { formatCo2, formatDuration } from "@/lib/emissions";

const EXAMPLE_ROUTES = [
  { from: "Rissa, Indre Fosen", to: "Trondheim S" },
  { from: "Trondheim S", to: "Ålesund" },
  { from: "Trondheim S", to: "Oslo S" },
  { from: "Trondheim S", to: "Bergen stasjon" },
];

function defaultDateTime(): string {
  const d = new Date(Date.now() + 3_600_000);
  d.setMinutes(0, 0, 0);
  return d.toISOString().slice(0, 16);
}

// ── Shared inline SVG icons ───────────────────────────────────
const Ic = {
  clock: (sz = 14) => (
    <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5"/><path d="M8 4.5V8l2.5 1.5"/>
    </svg>
  ),
  export: (sz = 13) => (
    <svg width={sz} height={sz} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 13h10"/>
    </svg>
  ),
};

// ── Section label ─────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span className="label-xs">{children}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
export default function Home() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [workDays, setWorkDays] = useState(220);
  const [dateTime, setDateTime] = useState(defaultDateTime);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [data, setData] = useState<CalculateResponse | null>(null);
  const [csrdText, setCsrdText] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [bestMode, setBestMode] = useState<"co2" | "transit">("co2");

  async function calculate(e: React.FormEvent) {
    e.preventDefault();
    if (!from.trim() || !to.trim()) return;

    setWarning(null);

    const isPast = !!(dateTime &&
      !isNaN(new Date(dateTime).getTime()) &&
      new Date(dateTime).getTime() < Date.now() - 60_000);
    if (isPast) {
      setWarning("Departure time is in the past. Schedules shown are based on current departures — valid for CSRD reporting purposes.");
    }

    // For past dates: keep the same TIME and DAY OF WEEK, but move to the
    // nearest future occurrence of that weekday (today or next week).
    // Example: user entered "Monday 08:00" last week → send next Monday 08:00.
    function nextMatchingWeekday(dt: string): string {
      // Parse explicitly to avoid browser DST-at-midnight edge cases
      const [datePart, timePart] = dt.split("T");
      const [targetHH, targetMM] = timePart.split(":").map(Number);
      // Use noon to determine day-of-week — avoids DST transitions at midnight
      const targetDow = new Date(datePart + "T12:00:00").getDay();

      const now = new Date();
      const candidate = new Date(now);
      candidate.setHours(targetHH, targetMM, 0, 0);

      let daysAhead = (targetDow - now.getDay() + 7) % 7;
      if (daysAhead === 0 && candidate.getTime() <= Date.now()) daysAhead = 7;
      candidate.setDate(candidate.getDate() + daysAhead);

      // Return as local datetime string — the API interprets this as Europe/Oslo local time.
      // toISOString() returns UTC which would cause a ±1-2h error depending on season.
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${candidate.getFullYear()}-${pad(candidate.getMonth() + 1)}-${pad(candidate.getDate())}T${pad(candidate.getHours())}:${pad(candidate.getMinutes())}`;
    }

    const effectiveDateTime = isPast ? nextMatchingWeekday(dateTime) : dateTime;

    setLoading(true); setError(null); setData(null); setCsrdText(null);
    try {
      const res = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, workDays, dateTime: effectiveDateTime }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Calculation failed");
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally { setLoading(false); }
  }

  function buildSelectedJourney(): SelectedJourney | null {
    if (bestMode === "transit") return bestTransitOnly;
    if (carIsOverallBest && bestCarVariant) {
      return {
        totalCo2Kg: overallWinnerCo2,
        annualCo2Kg: parseFloat((overallWinnerCo2 * 2 * workDays).toFixed(1)),
        durationMinutes: 0,
        durationSeconds: 0,
        legs: [],
        label: bestCarVariant.label,
      };
    }
    return bestJourney;
  }

  function handleExportCsv() {
    if (!data) return;
    const journeys = data.scenarios.flatMap((s) => s.journey ? [s.journey] : []);
    exportCsv(journeys, buildSelectedJourney(),
      data.from.displayName, data.to.displayName, data.distanceKm, workDays);
  }
  function handleCsrd() {
    if (!data) return;
    const journeys = data.scenarios.flatMap((s) => s.journey ? [s.journey] : []);
    const reportingBasis = bestMode === "co2"
      ? "Global CO₂ minimum (all transport modes)"
      : "Best public transport route";
    const text = exportCsrdText(journeys, buildSelectedJourney(), reportingBasis,
      data.from.displayName, data.to.displayName, data.distanceKm, workDays);
    setCsrdText(text);
  }

  const transitScenarios = data?.scenarios.filter((s) => s.type === "transit") ?? [];
  const carScenario      = data?.scenarios.find((s) => s.type === "car") ?? null;
  const combinedScenario = data?.scenarios.find((s) => s.type === "combined") ?? null;
  const bicycleScenario  = data?.scenarios.find((s) => s.type === "bicycle") ?? null;

  const groundTransitScenarios = transitScenarios.filter(
    (s) => !s.journey?.legs.some((l) => l.mode === "air")
  );
  const bestTransitOnly: JourneyResult | null =
    groundTransitScenarios.flatMap((s) => s.journey ? [s.journey] : [])
      .sort((a, b) => a.totalCo2Kg - b.totalCo2Kg)[0] ?? null;

  const airTransitScenarios = transitScenarios.filter(
    (s) => s.journey?.legs.some((l) => l.mode === "air")
  );

  const allJourneys: JourneyResult[] = [
    ...transitScenarios.flatMap((s) => s.journey ? [s.journey] : []),
    ...(combinedScenario?.journey ? [combinedScenario.journey] : []),
  ];
  const carJourneys = carScenario?.carVariants
    ? carScenario.carVariants.map((v) => ({ co2Kg: v.co2Kg, label: v.label }))
    : [];

  const bestJourney: JourneyResult | null =
    allJourneys.sort((a, b) => a.totalCo2Kg - b.totalCo2Kg)[0] ?? null;

  const bestCarCo2 = carScenario?.carVariants
    ? Math.min(...carScenario.carVariants.map((v) => v.co2Kg))
    : null;

  const bestCarVariant = carJourneys.sort((a, b) => a.co2Kg - b.co2Kg)[0] ?? null;
  const overallWinnerCo2 = Math.min(
    bestJourney?.totalCo2Kg ?? Infinity,
    bestCarVariant?.co2Kg ?? Infinity
  );
  const carIsOverallBest = bestCarVariant !== null &&
    bestCarVariant.co2Kg < (bestJourney?.totalCo2Kg ?? Infinity);

  const bestIsAir = bestJourney?.legs.some((l) => l.mode === "air") ?? false;
  const bestIsCombined = !carIsOverallBest &&
    combinedScenario?.journey !== undefined &&
    bestJourney === combinedScenario.journey;

  function dominantMode(j: JourneyResult | null): string {
    if (!j) return "transit";
    const modes = j.legs.map((l) => l.mode).filter((m) => m !== "foot");
    if (modes.includes("air"))   return "flight";
    if (modes.includes("water")) return modes.includes("rail") || modes.includes("bus") ? "mixed" : "ferry";
    if (modes.includes("rail"))  return "rail";
    if (modes.includes("tram") || modes.includes("metro")) return "rail";
    if (modes.includes("bus"))   return "bus";
    return "transit";
  }
  const bestTransitMode = useMemo(() => dominantMode(bestJourney), [bestJourney]);

  const winnerBadge = useMemo(() => carIsOverallBest
    ? { icon: <Leaf size={11} strokeWidth={1.8} />, label: `${bestCarVariant?.label} is lowest CO₂`, bg: "hsl(150,24%,86%)", color: "hsl(150,30%,30%)" }
    : bestIsAir
    ? { icon: <Leaf size={11} strokeWidth={1.8} />, label: "via flight", bg: "hsl(40,80%,92%)", color: "hsl(40,60%,35%)" }
    : bestIsCombined
    ? { icon: <Leaf size={11} strokeWidth={1.8} />, label: "Car + public transport", bg: "hsl(220,8%,92%)", color: "hsl(220,12%,40%)" }
    : bestTransitMode === "ferry"
    ? { icon: <Leaf size={11} strokeWidth={1.8} />, label: "Ferry route", bg: "hsl(210,30%,92%)", color: "hsl(210,35%,35%)" }
    : bestTransitMode === "bus"
    ? { icon: <Leaf size={11} strokeWidth={1.8} />, label: "Bus is lowest CO₂", bg: "hsl(220,8%,92%)", color: "hsl(220,12%,40%)" }
    : { icon: <Leaf size={11} strokeWidth={1.8} />, label: "Public transport is lowest CO₂", bg: "hsl(150,24%,86%)", color: "hsl(150,30%,30%)" },
  [carIsOverallBest, bestCarVariant, bestIsAir, bestIsCombined, bestTransitMode]);

  const effectiveIsCarBest = bestMode === "co2" && carIsOverallBest;
  const effectiveJourney   = bestMode === "transit" ? bestTransitOnly : bestJourney;
  const effectiveCo2       = bestMode === "transit"
    ? (bestTransitOnly?.totalCo2Kg ?? 0)
    : overallWinnerCo2;

  return (
    <>
      <Head>
        <title>CO₂ Route Calculator — Norway</title>
        <meta name="description" content="Compare CO₂ emissions for train, bus, ferry and car between Norwegian locations. CSRD scope 3 export." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen" style={{ background: "hsl(34,20%,96%)" }}>

        {/* ── HEADER ─────────────────────────────────────────── */}
        <header className="border-b" style={{ background: "hsl(34,20%,96%)", borderColor: "hsl(220,8%,90%)" }}>
          <div className="mx-auto max-w-2xl px-5 py-4 flex items-center justify-between">
            <div>
              <h1 className="text-sm font-semibold" style={{ color: "hsl(220,14%,12%)" }}>
                CO₂ Route Calculator
              </h1>
              <p className="text-xs mt-0.5" style={{ color: "hsl(220,8%,52%)" }}>
                Norway · Entur Journey Planner · Miljødirektoratet
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs px-3 py-1 rounded-full"
                style={{ background: "hsl(150,24%,92%)", color: "hsl(150,30%,32%)", border: "1px solid hsl(150,24%,82%)" }}>
                CSRD scope 3 ready
              </span>
              <button onClick={() => setShowAbout(true)}
                className="flex items-center gap-1.5 text-xs transition-colors"
                style={{ color: "hsl(220,8%,52%)" }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "hsl(150,30%,35%)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "hsl(220,8%,52%)")}>
                <Info size={13} strokeWidth={1.8} />
                About
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-2xl px-5 py-8 space-y-3">

          {/* ── SEARCH CARD ───────────────────────────────────── */}
          <div className="rounded-2xl p-6 space-y-5"
            style={{ background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px hsl(220,8%,90%)" }}>
            <form onSubmit={calculate} className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <PlaceInput label="From" value={from} onChange={setFrom}
                  placeholder="Trondheim, Kongens gate 1…" required />
                <PlaceInput label="To" value={to} onChange={setTo}
                  placeholder="Ålesund, Apotekergata…" required />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="label-xs">Departure time</label>
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border"
                    style={{ borderColor: "hsl(220,8%,90%)", background: "hsl(220,8%,97%)" }}>
                    <span style={{ color: "hsl(220,8%,60%)" }}>{Ic.clock(14)}</span>
                    <input type="datetime-local" value={dateTime}
                      onChange={(e) => setDateTime(e.target.value)}
                      className="flex-1 bg-transparent text-sm outline-none"
                      style={{ color: "hsl(220,14%,12%)" }} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="label-xs">Work days / year</label>
                  <div className="flex items-center gap-3 h-[42px]">
                    <input type="range" min={1} max={250} step={1} value={workDays}
                      onChange={(e) => setWorkDays(Number(e.target.value))}
                      className="w-full"
                      style={{
                        background: `linear-gradient(to right, hsl(150,30%,42%) ${((workDays - 1) / 249) * 100}%, hsl(220,8%,88%) ${((workDays - 1) / 249) * 100}%)`,
                      }} />
                    <span className="w-12 text-right text-sm font-medium tabular-nums" style={{ color: "hsl(220,14%,12%)" }}>
                      {workDays}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="text-xs text-muted-foreground self-center">Popular routes:</span>
                {EXAMPLE_ROUTES.map((r) => (
                  <button key={`${r.from}-${r.to}`} type="button"
                    onClick={() => { setFrom(r.from); setTo(r.to); }}
                    className="rounded-full border border-border px-3 py-1 text-xs transition-all"
                    style={{ borderColor: "hsl(220,8%,86%)", color: "hsl(220,8%,40%)", background: "#fff" }}
                    onMouseEnter={(e) => { const b = e.currentTarget; b.style.borderColor = "hsl(150,30%,45%)"; b.style.color = "hsl(150,30%,35%)"; }}
                    onMouseLeave={(e) => { const b = e.currentTarget; b.style.borderColor = "hsl(220,8%,86%)"; b.style.color = "hsl(220,8%,40%)"; }}>
                    {r.from} → {r.to}
                  </button>
                ))}
              </div>

              <button type="submit" disabled={loading}
                className="w-full py-3.5 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-50"
                style={{ background: "hsl(150,30%,35%)", color: "#fff", letterSpacing: "-0.01em" }}>
                {loading ? "Looking up routes…" : "Calculate footprint"}
              </button>
            </form>
          </div>

          {/* ── ERROR ─────────────────────────────────────────── */}
          {error && (
            <div className="rounded-xl px-4 py-3 text-sm flex items-start gap-2.5"
              style={{ background: "hsl(220,8%,96%)", border: "1px solid hsl(220,8%,88%)", color: "hsl(220,12%,40%)" }}>
              <span className="flex-shrink-0 mt-0.5" style={{ color: "hsl(220,8%,58%)" }}>
                <Clock size={14} strokeWidth={1.8} />
              </span>
              <span>{error}</span>
            </div>
          )}

          {/* ── WARNING (past time, non-blocking) ─────────────── */}
          {warning && (
            <div className="rounded-xl px-4 py-3 text-sm flex items-start gap-2.5"
              style={{ background: "hsl(220,8%,96%)", border: "1px solid hsl(220,8%,88%)", color: "hsl(220,12%,40%)" }}>
              <span className="flex-shrink-0 mt-0.5" style={{ color: "hsl(220,8%,58%)" }}>
                <Clock size={14} strokeWidth={1.8} />
              </span>
              <span>{warning}</span>
            </div>
          )}

          {/* ── RESULTS ───────────────────────────────────────── */}
          {data && (
            <div className="space-y-3">

              {/* BEST ROUTE */}
              {(bestJourney || carIsOverallBest) && (
                <div className="rounded-2xl p-6"
                  style={{ background: "hsl(150,20%,94%)", border: "1px solid hsl(150,20%,84%)" }}>
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="w-1 h-5 rounded-full flex-shrink-0" style={{ background: "hsl(150,30%,38%)" }} />
                    <span className="text-base font-semibold" style={{ color: "hsl(220,14%,12%)" }}>Best route</span>
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                      style={{ background: winnerBadge.bg, color: winnerBadge.color }}>
                      {winnerBadge.icon}
                      {winnerBadge.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 mb-5">
                    <span className="text-xs" style={{ color: "hsl(220,8%,52%)" }}>Best by:</span>
                    {(["co2", "transit"] as const).map((mode) => (
                      <button key={mode} type="button" onClick={() => setBestMode(mode)}
                        className="text-xs px-2.5 py-1 rounded-full transition-colors"
                        style={bestMode === mode
                          ? { background: "hsl(150,24%,86%)", color: "hsl(150,30%,30%)", border: "1px solid hsl(150,24%,76%)" }
                          : { background: "#fff", color: "hsl(220,8%,52%)", border: "1px solid hsl(220,8%,86%)" }
                        }>
                        {mode === "co2" ? "🌿 Lowest CO₂" : "🚌 Public transport only"}
                      </button>
                    ))}
                  </div>

                  {bestMode === "transit" && !bestTransitOnly ? (
                    <p className="text-sm pb-5" style={{ color: "hsl(220,8%,55%)" }}>
                      No public transport routes found for this route.
                    </p>
                  ) : (
                  <div className="grid grid-cols-3 gap-4 mb-5">
                    <div>
                      <p className="label-xs mb-1.5">Route</p>
                      <p className="text-sm font-medium" style={{ color: "hsl(220,14%,15%)" }}>
                        {data.from.displayName.split(",")[0]} → {data.to.displayName.split(",")[0]}
                      </p>
                    </div>
                    <div>
                      <p className="label-xs mb-1.5">{effectiveIsCarBest ? "Mode" : "Duration"}</p>
                      {effectiveIsCarBest ? (
                        <p className="text-sm font-semibold" style={{ color: "hsl(220,14%,15%)" }}>
                          {bestCarVariant?.label}
                        </p>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span style={{ color: "hsl(220,8%,50%)" }}>{Ic.clock(14)}</span>
                          <p className="text-sm font-semibold" style={{ color: "hsl(220,14%,15%)" }}>
                            {formatDuration(effectiveJourney!.durationMinutes)}
                          </p>
                        </div>
                      )}
                    </div>
                    <div>
                      <p className="label-xs mb-1.5">CO₂ per trip</p>
                      <div className="flex items-center gap-1.5">
                        <span style={{ color: "hsl(150,30%,40%)" }}><Leaf size={14} strokeWidth={1.8} /></span>
                        <p className="text-sm font-semibold" style={{ color: "hsl(150,30%,32%)" }}>
                          {formatCo2(effectiveCo2)}
                        </p>
                      </div>
                    </div>
                  </div>
                  )}

                  <div className="pt-4 border-t flex justify-between items-center"
                    style={{ borderColor: "hsl(150,18%,80%)" }}>
                    {effectiveIsCarBest ? (
                      <>
                        <span className="text-xs" style={{ color: "hsl(220,8%,52%)" }}>vs. best public transport</span>
                        {bestJourney && (
                          <span className="text-xs" style={{ color: "hsl(220,14%,30%)" }}>
                            {formatCo2(bestJourney.totalCo2Kg)} CO₂{" "}
                            <span style={{ color: "hsl(220,8%,52%)" }}>
                              (+{formatCo2(bestJourney.totalCo2Kg - (bestCarVariant?.co2Kg ?? 0))})
                            </span>
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="text-xs" style={{ color: "hsl(220,8%,52%)" }}>vs. Electric car</span>
                        {bestCarCo2 !== null && (
                          <span className="text-xs" style={{ color: "hsl(220,14%,30%)" }}>
                            {formatCo2(bestCarCo2 as number)} CO₂{" "}
                            <span style={{ color: "hsl(220,8%,52%)" }}>
                              ({(bestCarCo2 as number) > effectiveCo2
                                ? `+${formatCo2((bestCarCo2 as number) - effectiveCo2)}`
                                : `−${formatCo2(effectiveCo2 - (bestCarCo2 as number))}`})
                            </span>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* ── FERRY CROSSINGS (once, after Best route) ──────── */}
              {(data.ferryCrossings?.length ?? 0) > 0 && (
                <div className="rounded-2xl p-6"
                  style={{ background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px hsl(220,8%,90%)" }}>
                  <FerryCrossingsInfo crossings={data.ferryCrossings} mode="car" />
                </div>
              )}

              {/* ── SECTION 1: Public transport ─────────────────── */}
              <div className="rounded-2xl p-6"
                style={{ background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px hsl(220,8%,90%)" }}>
                <SectionLabel>Public transport</SectionLabel>
                {groundTransitScenarios.some((s) => s.journey) ? (
                  <div className="space-y-6">
                    {groundTransitScenarios.map((s, i) =>
                      s.journey ? (
                        <div key={i}>
                          {i > 0 && <div className="border-t mb-6" style={{ borderColor: "hsl(220,8%,93%)" }} />}
                          <LegBreakdown journey={s.journey} index={i} isBest={i === 0} />
                        </div>
                      ) : null
                    )}
                  </div>
                ) : (
                  <p className="text-sm py-2" style={{ color: "hsl(220,8%,55%)" }}>
                    No public transport routes found via Entur. Try a more specific address or nearby station.
                  </p>
                )}
                {airTransitScenarios.some((s) => s.journey) && (
                  <div className="mt-5 pt-5 border-t" style={{ borderColor: "hsl(220,8%,93%)" }}>
                    <p className="label-xs mb-3">Via flight (high CO₂)</p>
                    <div className="space-y-4">
                      {airTransitScenarios.map((s, i) =>
                        s.journey ? (
                          <LegBreakdown key={i} journey={s.journey} index={i} isBest={false} badge="Flight" />
                        ) : null
                      )}
                    </div>
                  </div>
                )}
                {(data.unavailableModes?.length ?? 0) > 0 && (
                  <p className="text-xs mt-4 pt-4 border-t" style={{ borderColor: "hsl(220,8%,93%)", color: "hsl(220,8%,58%)" }}>
                    Not available on this route: {data.unavailableModes.join(", ")}
                  </p>
                )}
              </div>

              {/* ── SECTION 2: Private car ───────────────────────── */}
              {carScenario?.carVariants && (
                <div className="rounded-2xl p-6"
                  style={{ background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px hsl(220,8%,90%)" }}>
                  <SectionLabel>
                    {carScenario.carVariants.some((v) => v.label === "Bicycle" || v.label === "Walking")
                      ? "Private car & active modes"
                      : "Private car"}
                  </SectionLabel>
                  <CarScenario variants={carScenario.carVariants} />
                  <p className="text-xs mt-4" style={{ color: "hsl(220,8%,60%)" }}>
                    Road distance: {data.roadDistanceKm} km ·{" "}
                    {data.routingProvider === "google" ? "Google Maps" :
                     data.routingProvider === "osrm" ? "OSRM / OpenStreetMap" : "estimated"}
                  </p>
                </div>
              )}

              {/* ── SECTION 3: Combined P+R ──────────────────────── */}
              {combinedScenario?.journey && (
                <div className="rounded-2xl p-6"
                  style={{ background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px hsl(220,8%,90%)" }}>
                  <SectionLabel>Car + public transport (Park &amp; Ride)</SectionLabel>
                  <LegBreakdown journey={combinedScenario.journey} index={0} isBest={false} badge="P+R" />
                </div>
              )}

              {/* ── SECTION 4: Bicycle ───────────────────────────── */}
              {/* Show only when bicycle is NOT already shown in Private car section (route > 25 km) */}
              {bicycleScenario?.bicycleRoute &&
               !carScenario?.carVariants?.some((v) => v.label === "Bicycle") && (
                <div className="rounded-2xl p-6"
                  style={{ background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px hsl(220,8%,90%)" }}>
                  <SectionLabel>Bicycle</SectionLabel>
                  <BicycleScenario data={bicycleScenario.bicycleRoute} />
                </div>
              )}

              {/* ── ANNUAL IMPACT ─────────────────────────────────── */}
              {(bestJourney || carIsOverallBest) && (
                <div className="rounded-2xl p-6"
                  style={{ background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px hsl(220,8%,90%)" }}>
                  <p className="text-sm font-semibold mb-5" style={{ color: "hsl(220,14%,12%)" }}>
                    Annual impact · {carIsOverallBest ? bestCarVariant?.label : "best public transport"}
                  </p>
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span style={{ color: "hsl(220,8%,52%)" }}>Work days per year</span>
                      <span style={{ color: "hsl(220,14%,22%)" }}>{workDays} days</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span style={{ color: "hsl(220,8%,52%)" }}>One-way trips</span>
                      <span style={{ color: "hsl(220,14%,22%)" }}>{workDays} trips</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span style={{ color: "hsl(220,8%,52%)" }}>Round trips (to &amp; from work)</span>
                      <span style={{ color: "hsl(220,14%,22%)" }}>{workDays * 2} trips</span>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t space-y-2.5" style={{ borderColor: "hsl(220,8%,92%)" }}>
                    <div className="flex justify-between text-sm">
                      <span style={{ color: "hsl(220,8%,52%)" }}>CO₂ one-way × {workDays} days</span>
                      <span className="font-medium tabular-nums" style={{ color: "hsl(220,14%,22%)" }}>
                        {formatCo2(overallWinnerCo2 * workDays)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="font-medium" style={{ color: "hsl(220,14%,12%)" }}>
                        Total CO₂ (round trip × {workDays} days)
                      </span>
                      <span className="font-semibold" style={{ color: "hsl(150,30%,35%)" }}>
                        {formatCo2(overallWinnerCo2 * 2 * workDays)}
                      </span>
                    </div>
                    {bestCarCo2 !== null && (
                      <div className="flex justify-between text-sm">
                        <span style={{ color: "hsl(220,8%,52%)" }}>
                          {carIsOverallBest ? "vs. best public transport" : "Saved vs. electric car"}
                        </span>
                        <span style={{ color: "hsl(220,14%,35%)" }}>
                          {carIsOverallBest
                            ? formatCo2((bestJourney?.totalCo2Kg ?? 0) * 2 * workDays - overallWinnerCo2 * 2 * workDays)
                            : formatCo2(Math.abs((bestCarCo2 as number) * 2 * workDays - overallWinnerCo2 * 2 * workDays))}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── EXPORT ───────────────────────────────────────── */}
              <div className="flex gap-2 pt-1">
                {[
                  { label: "Export CSV", fn: handleExportCsv },
                  { label: "CSRD scope 3 report", fn: handleCsrd },
                ].map(({ label, fn }) => (
                  <button key={label} onClick={fn}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium border transition-colors"
                    style={{ borderColor: "hsl(220,8%,86%)", color: "hsl(220,8%,40%)", background: "#fff" }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = "hsl(150,30%,45%)"; e.currentTarget.style.color = "hsl(150,30%,35%)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = "hsl(220,8%,86%)"; e.currentTarget.style.color = "hsl(220,8%,40%)"; }}>
                    {Ic.export(13)}
                    {label}
                  </button>
                ))}
              </div>

            </div>
          )}
        </main>

        {/* ── FOOTER ── */}
        <footer className="border-t py-5 px-5" style={{ borderColor: "hsl(220,8%,90%)" }}>
          <div className="mx-auto max-w-2xl flex items-center justify-between">
            <span className="text-xs" style={{ color: "hsl(220,8%,55%)" }}>CO₂ Route Calculator · Norway</span>
            <a href="https://github.com/irinaaf" target="_blank" rel="noopener noreferrer"
              className="text-xs flex items-center gap-1.5 transition-colors"
              style={{ color: "hsl(220,8%,52%)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "hsl(220,14%,20%)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "hsl(220,8%,52%)")}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.164 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.268 2.75 1.026A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.026 2.747-1.026.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.741 0 .267.18.578.688.48C19.138 20.161 22 16.418 22 12c0-5.523-4.477-10-10-10z"/>
              </svg>
              @irinaaf
            </a>
          </div>
        </footer>

      </div>

      {/* ── ABOUT MODAL ──────────────────────────────────────── */}
      {showAbout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAbout(false); }}>
          <div className="w-full max-w-xl rounded-2xl flex flex-col overflow-hidden"
            style={{ background: "#fff", boxShadow: "0 24px 64px rgba(0,0,0,0.18)", maxHeight: "88vh" }}>
            <div className="flex items-center justify-between px-7 pt-7 pb-0 flex-shrink-0">
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest mb-2"
                  style={{ color: "hsl(150,30%,40%)", letterSpacing: "0.1em" }}>
                  Portfolio Project
                </div>
                <h2 className="text-xl font-semibold" style={{ color: "hsl(220,14%,10%)", letterSpacing: "-0.02em" }}>
                  CO₂ Route Calculator
                </h2>
                <p className="text-sm mt-1" style={{ color: "hsl(220,8%,50%)" }}>
                  Sustainable commute planning for Norway
                </p>
              </div>
              <button onClick={() => setShowAbout(false)}
                className="w-8 h-8 flex items-center justify-center rounded-xl flex-shrink-0 ml-4"
                style={{ background: "hsl(220,8%,95%)", color: "hsl(220,8%,50%)" }}>
                <X size={14} strokeWidth={2} />
              </button>
            </div>
            <div className="overflow-y-auto px-7 py-6 space-y-6">
              <p className="text-sm leading-relaxed" style={{ color: "hsl(220,14%,20%)" }}>
                A multimodal CO₂ calculator that finds the <strong>lowest-emission route</strong> between
                any two points in Norway — across public transport, private car, cycling, and combined options.
                Built on real timetable data from Entur and official emission factors from Miljødirektoratet.
              </p>
              <div>
                <p className="label-xs mb-3">Key capabilities</p>
                <div className="space-y-2.5">
                  {[
                    { icon: <TrainFront size={14} strokeWidth={1.8}/>, text: "Real multimodal routing via Entur Journey Planner (60 operators — trains, buses, ferries, trams, metro, flights)" },
                    { icon: <Clock size={14} strokeWidth={1.8}/>, text: "Wide-window search: scans ±4 hours around departure time to find the best available connections" },
                    { icon: <Car size={14} strokeWidth={1.8}/>, text: "Compares ALL transport types in one view — public transport, EV, petrol, diesel, bicycle, walking, P+R" },
                    { icon: <Leaf size={14} strokeWidth={1.8}/>, text: "Best route selected as global CO₂ minimum across all options, not just public transport" },
                    { icon: <Info size={14} strokeWidth={1.8}/>, text: "CSRD Scope 3 report export — pre-formatted for ESRS E1-6 Category 7 employee commuting" },
                  ].map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3">
                      <span className="flex-shrink-0 mt-0.5" style={{ color: "hsl(150,30%,40%)" }}>{item.icon}</span>
                      <span className="text-sm" style={{ color: "hsl(220,12%,28%)" }}>{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="label-xs mb-3">Methodology</p>
                <div className="rounded-xl p-4 space-y-2"
                  style={{ background: "hsl(220,8%,97%)", border: "1px solid hsl(220,8%,91%)" }}>
                  {[
                    ["Emission factors", "EEA (estimated specific emissions by mode) · Miljødirektoratet · Entur + SINTEF Energimodul (ISO 14083:2023)"],
                    ["Norwegian rail", "0.009 kg CO₂/pkm — Vy operates on ~99% hydropower"],
                    ["Buses", "Operator-specific fleet data: Ruter (Oslo) 0.011 · AtB (Trondheim) 0.018 · regional 0.027 kg/pkm"],
                    ["Ferry", "0.019–0.025 kg/pkm — Norled/Fjord1 fleet data 2023"],
                    ["Flight", "0.255 kg/pkm incl. IPCC radiative forcing ×1.9"],
                    ["Road distance", "OSRM routing engine (OpenStreetMap) — accounts for E39 ferry crossings"],
                    ["Car assumption", "Solo driver (1 person). Public transport factors already include average vehicle occupancy — you pay your share of shared emissions."],
                  ].map(([label, value], idx) => (
                    <div key={idx} className="flex justify-between text-xs gap-4">
                      <span style={{ color: "hsl(220,8%,52%)", flexShrink: 0 }}>{label}</span>
                      <span style={{ color: "hsl(220,14%,22%)", textAlign: "right" }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="label-xs mb-3">CSRD relevance</p>
                <p className="text-sm leading-relaxed" style={{ color: "hsl(220,12%,30%)" }}>
                  Under Norway&#39;s CSRD implementation (June 2024), ~1,200 companies must report
                  Scope 3 emissions by 2026. This tool generates <strong>ESRS E1-6 compliant text</strong> for
                  Category 7 (employee commuting) — ready to paste into the annual sustainability report.
                </p>
              </div>
              <div>
                <p className="label-xs mb-3">Built with</p>
                <div className="flex flex-wrap gap-2">
                  {["Next.js 16", "TypeScript", "Tailwind CSS", "lucide-react", "Entur API", "OSRM", "Miljødirektoratet"].map((t) => (
                    <span key={t} className="text-xs px-2.5 py-1 rounded-lg"
                      style={{ background: "hsl(220,8%,95%)", color: "hsl(220,12%,35%)", border: "1px solid hsl(220,8%,89%)" }}>{t}</span>
                  ))}
                </div>
              </div>
              <div className="pt-2 border-t flex justify-between items-center"
                style={{ borderColor: "hsl(220,8%,92%)" }}>
                <a href="https://github.com/irinaaf" target="_blank" rel="noopener noreferrer"
                  className="text-xs" style={{ color: "hsl(150,30%,40%)" }}>
                  View source on GitHub · @irinaaf
                </a>
                <button onClick={() => setShowAbout(false)}
                  className="text-xs px-4 py-2 rounded-xl font-medium"
                  style={{ background: "hsl(150,30%,35%)", color: "#fff" }}>
                  Get started
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CSRD MODAL */}
      {csrdText && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.35)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setCsrdText(null); }}>
          <div className="w-full max-w-2xl rounded-2xl flex flex-col"
            style={{ background: "#fff", boxShadow: "0 20px 60px rgba(0,0,0,0.18)", maxHeight: "80vh" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
              style={{ borderColor: "hsl(220,8%,92%)" }}>
              <span className="text-sm font-semibold" style={{ color: "hsl(220,14%,12%)" }}>
                CSRD scope 3 report
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(csrdText ?? "").then(() => {
                      const btn = document.getElementById("csrd-copy-btn");
                      if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy"; }, 2000); }
                    });
                  }}
                  id="csrd-copy-btn"
                  className="text-xs px-3 py-1.5 rounded-lg border font-medium"
                  style={{ borderColor: "hsl(220,8%,86%)", color: "hsl(220,8%,40%)", background: "#fff" }}>
                  Copy
                </button>
                <button onClick={() => setCsrdText(null)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg"
                  style={{ color: "hsl(220,8%,50%)", background: "hsl(220,8%,96%)" }}>
                  <X size={12} strokeWidth={1.8} />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto px-6 py-5 flex-1">
              <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap"
                style={{ color: "hsl(220,14%,22%)" }}>
                {csrdText}
              </pre>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
