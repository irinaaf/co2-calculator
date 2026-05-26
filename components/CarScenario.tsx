import { Car, Bike, PersonStanding, Zap, Fuel } from "lucide-react";
import type { CarVariant } from "@/lib/emissions";
import { formatCo2, formatDuration } from "@/lib/emissions";

interface Props {
  variants: CarVariant[];
}

// ── Mode icon from label ─────────────────────────────────────
function ModeIcon({ label }: { label: string }) {
  const id = label.toLowerCase();
  const props = { size: 18, strokeWidth: 1.8 };
  if (id.includes("ev") || id.includes("electric")) return <Zap      {...props} />;
  if (id.includes("petrol"))                          return <Fuel     {...props} />;
  if (id.includes("diesel"))                          return <Fuel     {...props} />;
  if (id.includes("bicycle") || id.includes("bike")) return <Bike     {...props} />;
  if (id.includes("walk") || id.includes("foot"))    return <PersonStanding {...props} />;
  return <Car {...props} />;
}

export function CarScenario({ variants }: Props) {
  const sorted = [...variants].sort((a, b) => a.co2Kg - b.co2Kg);
  const maxCo2 = Math.max(...variants.filter((v) => v.co2Kg > 0).map((v) => v.co2Kg), 1);

  return (
    <div className="space-y-4">
      {sorted.map((v) => {
        const isZero   = v.co2Kg === 0;
        const isLowest = v.co2Kg === sorted[0].co2Kg;
        const barPct   = isZero ? 100 : Math.max(3, Math.round((v.co2Kg / maxCo2) * 100));

        return (
          <div key={v.label}>
            <div className="flex items-center justify-between mb-1.5">
              {/* Left: icon + label + badge */}
              <div className="flex items-center gap-2.5">
                <span style={{ color: isLowest ? "hsl(220,14%,25%)" : "hsl(220,8%,55%)" }}>
                  <ModeIcon label={v.label} />
                </span>
                <span className="text-sm" style={{
                  color:      isLowest ? "hsl(220,14%,12%)" : "hsl(220,14%,35%)",
                  fontWeight: isLowest ? 500 : 400,
                }}>
                  {v.label}
                </span>
                {isLowest && !isZero && (
                  <span className="text-xs px-1.5 py-0.5 rounded"
                    style={{ background: "hsl(150,24%,92%)", color: "hsl(150,30%,32%)" }}>
                    lowest
                  </span>
                )}
                {isZero && (
                  <span className="text-xs px-1.5 py-0.5 rounded"
                    style={{ background: "hsl(150,24%,92%)", color: "hsl(150,30%,32%)" }}>
                    zero CO₂
                  </span>
                )}
              </div>
              {/* Right: duration + CO₂ */}
              <div className="flex items-center gap-4 text-xs flex-shrink-0">
                <span style={{ color: "hsl(220,8%,52%)" }}>
                  {formatDuration(v.durationMinutes)}
                </span>
                <span className="font-semibold w-16 text-right tabular-nums"
                  style={{ color: isZero ? "hsl(150,30%,35%)" : isLowest ? "hsl(220,14%,15%)" : "hsl(220,14%,35%)" }}>
                  {isZero ? "0 g" : formatCo2(v.co2Kg)}
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-1 w-full rounded-full overflow-hidden"
              style={{ background: "hsl(220,8%,92%)" }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{
                  width:      `${barPct}%`,
                  background: isZero   ? "hsl(150,30%,52%)"
                            : isLowest ? "hsl(220,14%,38%)"
                            :            "hsl(220,8%,70%)",
                }}
              />
            </div>

            <p className="text-xs mt-1" style={{ color: "hsl(220,8%,58%)" }}>
              {isZero
                ? `${formatDuration(v.durationMinutes)} · free`
                : `~${v.costNok.toLocaleString("nb-NO")} kr/trip · Annual: ${formatCo2(v.annualCo2Kg)}`}
            </p>
          </div>
        );
      })}
    </div>
  );
}
