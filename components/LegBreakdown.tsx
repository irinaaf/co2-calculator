/**
 * LegBreakdown — minimal Scandinavian transit timeline.
 * Uses lucide-react icons for all transport modes.
 */

import {
  TrainFront,
  TramFront,
  Bus,
  Ship,
  Plane,
  Car,
  Bike,
  PersonStanding,
  Zap,
  HelpCircle,
  Shuffle,
} from "lucide-react";
import type { JourneyResult, LegResult } from "@/lib/emissions";
import { formatCo2, formatDuration } from "@/lib/emissions";

interface Props {
  journey: JourneyResult;
  index: number;
  isBest: boolean;
  badge?: string;
}

// ── Transport mode → Lucide icon ─────────────────────────────

function ModeIcon({ mode, size = 16 }: { mode: string; size?: number }) {
  const props = { size, strokeWidth: 1.8 };
  switch (mode) {
    case "rail":        return <TrainFront {...props} />;
    case "metro":       return <TrainFront {...props} />;
    case "tram":        return <TramFront  {...props} />;
    case "water":       return <Ship       {...props} />;
    case "air":         return <Plane      {...props} />;
    case "bus":
    case "coach":       return <Bus        {...props} />;
    case "foot":        return <PersonStanding {...props} />;
    case "bicycle":
    case "bicycle_rent":return <Bike       {...props} />;
    case "car_ev":      return <Zap        {...props} />;
    default:            return <HelpCircle {...props} />;
  }
}

// ── Mode label ───────────────────────────────────────────────
function modeLabel(leg: LegResult): string {
  const parts: string[] = [];
  if (leg.lineName)    parts.push(leg.lineName);
  if (leg.operatorName) parts.push(leg.operatorName);
  return parts.join(" · ") || "";
}

// ─────────────────────────────────────────────────────────────

// Format departure time: "Mon 20 May · 10:35"
function fmtDeparture(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function LegBreakdown({ journey, index, isBest, badge }: Props) {
  const { legs, totalCo2Kg, durationMinutes } = journey;
  const stops = legs.map((l) => l.fromName);
  if (legs.length > 0) stops.push(legs[legs.length - 1].toName);

  return (
    <div>
      {/* Header row */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          {badge ? (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border"
              style={{
                borderColor: badge === "Flight" ? "hsl(40,60%,78%)" : "hsl(220,8%,86%)",
                color:       badge === "Flight" ? "hsl(40,55%,38%)" : "hsl(220,8%,48%)",
                background:  badge === "Flight" ? "hsl(40,80%,94%)" : "hsl(220,8%,97%)",
              }}>
              {badge === "Flight" && <Plane    size={11} strokeWidth={1.8} />}
              {badge === "P+R"    && <Shuffle  size={11} strokeWidth={1.8} />}
              {badge}
            </span>
          ) : isBest ? (
            <span className="text-xs px-2 py-0.5 rounded-full border"
              style={{ borderColor: "hsl(150,25%,75%)", color: "hsl(150,30%,35%)", background: "hsl(150,24%,96%)" }}>
              Best option
            </span>
          ) : (
            <span className="text-xs" style={{ color: "hsl(220,8%,55%)" }}>
              Option {index + 1}
            </span>
          )}
        </div>
        <div className="text-right">
          <span className="text-sm font-semibold"
            style={{ color: isBest ? "hsl(150,30%,35%)" : "hsl(220,14%,20%)" }}>
            {formatCo2(totalCo2Kg)}
          </span>
          <span className="text-xs ml-2" style={{ color: "hsl(220,12%,40%)" }}>
            {formatDuration(durationMinutes)}
          </span>
          {journey.departureTime && (
            <div className="text-xs mt-0.5" style={{ color: "hsl(220,8%,55%)" }}>
              {fmtDeparture(journey.departureTime)}
            </div>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="flex flex-wrap items-start pb-2 gap-y-3">
        {stops.map((stop, si) => (
          <div key={si} className="flex items-start flex-shrink-0">
            <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
              <div className="w-2 h-2 rounded-full mt-3.5 flex-shrink-0"
                style={{
                  background: si === 0
                    ? "hsl(220,14%,20%)"
                    : si === stops.length - 1
                    ? "hsl(150,30%,40%)"
                    : "hsl(220,8%,72%)",
                }}
              />
              <span className="text-xs text-center max-w-[68px] leading-tight"
                style={{ color: "hsl(220,14%,25%)" }}>
                {stop}
              </span>
            </div>
            {si < legs.length && <LegSegment leg={legs[si]} />}
          </div>
        ))}
      </div>

      {/* Per-leg detail rows */}
      <div className="mt-4 pt-3 border-t space-y-2" style={{ borderColor: "hsl(220,8%,93%)" }}>
        {legs
          .filter((l) => l.mode !== "foot" || l.distanceKm > 0.1)
          .map((leg, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2" style={{ color: "hsl(220,12%,30%)" }}>
                <span className="flex-shrink-0" style={{ color: "hsl(220,12%,35%)" }}>
                  <ModeIcon mode={leg.mode} size={15} />
                </span>
                <span>
                  {leg.fromName.split(",")[0]} → {leg.toName.split(",")[0]}
                </span>
                {modeLabel(leg) && (
                  <span style={{ color: "hsl(220,8%,50%)" }}>
                    · {modeLabel(leg)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                <span style={{ color: "hsl(220,12%,40%)" }}>
                  {formatDuration(leg.durationMinutes)}
                </span>
                <span className="font-medium" style={{ color: "hsl(150,35%,32%)" }}>
                  {formatCo2(leg.co2Kg)}
                </span>
              </div>
            </div>
          ))}
      </div>

      {/* Annual CO₂ */}
      <div className="mt-3 flex justify-between items-center text-xs pt-2.5 border-t"
        style={{ borderColor: "hsl(220,8%,93%)" }}>
        <span style={{ color: "hsl(220,8%,48%)" }}>
          Annual CO₂ · round trip × work days
        </span>
        <span className="font-semibold" style={{ color: "hsl(220,14%,12%)" }}>
          {formatCo2(journey.annualCo2Kg)}
        </span>
      </div>
    </div>
  );
}

// ── Leg segment connector ────────────────────────────────────

function LegSegment({ leg }: { leg: LegResult }) {
  return (
    <div className="flex flex-col items-center flex-1 min-w-[72px] mx-2">
      <div className="flex items-center w-full mt-4">
        <div className="flex-1 h-px" style={{ background: "hsl(220,8%,86%)" }} />
        <div
          className="mx-1 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: "hsl(220,8%,93%)", color: "hsl(220,14%,28%)" }}
        >
          <ModeIcon mode={leg.mode} size={15} />
        </div>
        <div className="flex-1 h-px" style={{ background: "hsl(220,8%,86%)" }} />
      </div>
      <span className="text-[10px] mt-1.5 text-center" style={{ color: "hsl(220,8%,55%)" }}>
        {formatDuration(leg.durationMinutes)}
      </span>
    </div>
  );
}
