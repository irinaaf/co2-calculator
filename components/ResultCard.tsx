import type { RouteResult } from "@/lib/emissions";
import { formatCo2, formatDuration } from "@/lib/emissions";
import { cn } from "@/lib/utils";

interface ResultCardProps {
  result: RouteResult;
  isBest: boolean;
  isUnavailable?: boolean;
  maxCo2: number;
}

export function ResultCard({
  result,
  isBest,
  isUnavailable = false,
  maxCo2,
}: ResultCardProps) {
  const { mode, co2Kg, costNok, durationMinutes } = result;
  const barWidth = Math.max(4, Math.round((co2Kg / maxCo2) * 100));

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-4 transition-colors",
        isUnavailable
          ? "border-border bg-muted/30 opacity-50"
          : isBest
          ? "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20"
          : "border-border bg-card"
      )}
    >
      {isBest && !isUnavailable && (
        <span className="self-start rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
          Best choice
        </span>
      )}
      {isUnavailable && (
        <span className="self-start rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          N/A on route
        </span>
      )}

      <div className="flex items-center gap-2">
        <span className="text-2xl" role="img" aria-label={mode.label}>
          {mode.emoji}
        </span>
        <span className="text-sm font-medium text-foreground">{mode.label}</span>
      </div>

      <div>
        {isUnavailable ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <>
            <p
              className="text-xl font-semibold"
              style={{ color: isBest ? "#0F6E56" : mode.color }}
            >
              {formatCo2(co2Kg)}
            </p>
            <p className="text-xs text-muted-foreground">per trip</p>
          </>
        )}
      </div>

      {/* Mini bar */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {!isUnavailable && (
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${barWidth}%`, background: mode.color }}
          />
        )}
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{isUnavailable ? "—" : formatDuration(durationMinutes)}</span>
        <span>{isUnavailable ? "—" : `~${costNok.toLocaleString("nb-NO")} kr`}</span>
      </div>

      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {mode.description}
      </p>
    </div>
  );
}
