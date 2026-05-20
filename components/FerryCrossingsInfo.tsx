/**
 * FerryCrossingsInfo — informational panel about ferry crossings on the route.
 *
 * Displayed under:
 * - Private car section: shows CO₂ per car (informational, NOT added to total)
 * - Public transport / Combined / Bicycle sections: shows crossing name only (no value)
 *
 * CO₂ per car is NOT included in the calculated route total.
 * It is shown as a reference because:
 * - GHG Protocol assigns vehicle ferry transport to Scope 3 Cat.6/7
 * - OSRM includes ferry distance but applies only EV/petrol factor
 * - Actual ferry CO₂ per car varies significantly by operator and vessel
 */

import { Ship } from "lucide-react";
import type { FerryCrossing } from "@/lib/ferries";

interface Props {
  crossings: FerryCrossing[];
  /** "car" = show CO₂ per car value; "transit" = show name only */
  mode: "car" | "transit";
}

export function FerryCrossingsInfo({ crossings, mode }: Props) {
  if (!crossings.length) return null;

  return (
    <div className="mt-4 pt-3 border-t" style={{ borderColor: "hsl(210,30%,90%)" }}>
      <div className="flex items-center gap-1.5 mb-2">
        <span style={{ color: "hsl(210,35%,45%)" }}>
          <Ship size={13} strokeWidth={1.8} />
        </span>
        <span className="label-xs" style={{ color: "hsl(210,35%,45%)" }}>
          Ferry crossings on this route
        </span>
      </div>

      <div className="space-y-2">
        {crossings.map((ferry) => (
          <div key={ferry.name}
            className="rounded-lg px-3 py-2 text-xs flex items-start justify-between gap-3"
            style={{ background: "hsl(210,30%,96%)", border: "1px solid hsl(210,25%,88%)" }}>

            <div className="space-y-0.5">
              <div className="font-medium" style={{ color: "hsl(220,14%,20%)" }}>
                {ferry.name}
                {ferry.route && (
                  <span className="ml-1.5 font-normal" style={{ color: "hsl(220,8%,55%)" }}>
                    {ferry.route}
                  </span>
                )}
              </div>
              <div style={{ color: "hsl(220,8%,55%)" }}>
                {ferry.operator} · {ferry.distanceKm} km · ~{ferry.durationMinutes} min
              </div>
            </div>

            {mode === "car" ? (
              <div className="text-right flex-shrink-0">
                <div className="font-semibold" style={{ color: "hsl(30,60%,40%)" }}>
                  +{ferry.co2PerCarKg.toFixed(2)} kg CO₂
                </div>
                <div style={{ color: "hsl(220,8%,60%)" }}>per car · for reference</div>
              </div>
            ) : (
              <div className="text-right flex-shrink-0">
                <div style={{ color: "hsl(210,35%,45%)" }}>
                  included in route
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {mode === "car" && (
        <p className="text-xs mt-2" style={{ color: "hsl(220,8%,58%)" }}>
          ⓘ Ferry CO₂ per car is shown for reference only and is not included in the route total.
          The car emission factor above covers the road distance including ferry crossing length.
        </p>
      )}
    </div>
  );
}
