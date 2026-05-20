"use client";

import type { RouteResult } from "@/lib/emissions";
import { formatCo2 } from "@/lib/emissions";

interface Co2ChartProps {
  results: RouteResult[];
}

export function Co2Chart({ results }: Co2ChartProps) {
  const sorted = [...results].sort((a, b) => b.annualCo2Kg - a.annualCo2Kg);
  const max = sorted[0]?.annualCo2Kg ?? 1;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Annual CO₂ · round trip × work days
      </h3>
      {sorted.map((r) => {
        const pct = Math.max(3, Math.round((r.annualCo2Kg / max) * 100));
        return (
          <div key={r.mode.id} className="flex items-center gap-3">
            <span className="w-6 text-base" role="img" aria-label={r.mode.label}>
              {r.mode.emoji}
            </span>
            <span className="w-24 text-xs text-muted-foreground">
              {r.mode.label}
            </span>
            <div className="flex-1 overflow-hidden rounded-full bg-muted" style={{ height: 10 }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, background: r.mode.color }}
              />
            </div>
            <span className="w-16 text-right text-xs font-medium tabular-nums text-foreground">
              {formatCo2(r.annualCo2Kg)}
            </span>
          </div>
        );
      })}
      <p className="text-[10px] text-muted-foreground">
        Sources: Miljødirektoratet · EEA Transport 2023 · Vy (Norwegian rail)
      </p>
    </div>
  );
}
