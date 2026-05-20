import type { BicycleScenario as BicycleScenarioData } from "@/pages/api/calculate";
import { formatCo2, formatDuration } from "@/lib/emissions";
import { Bike, Leaf, Route } from "lucide-react";

interface Props { data: BicycleScenarioData; }

export function BicycleScenario({ data }: Props) {
  const { distanceKm, durationMinutes, hasCycleways, savingVsCarKg } = data;

  return (
    <div>
      {/* Header row with icon */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <span style={{ color: "hsl(150,30%,40%)" }}><Bike size={20} strokeWidth={1.8} /></span>
          <span className="text-sm font-medium" style={{ color: "hsl(220,14%,12%)" }}>
            Bicycle · {distanceKm} km
          </span>
          {hasCycleways && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded"
              style={{ background: "hsl(210,24%,94%)", color: "hsl(210,30%,40%)" }}>
              <Route size={12} strokeWidth={2} />
              Cycleways
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span style={{ color: "hsl(150,30%,42%)" }}><Leaf size={14} strokeWidth={1.8} /></span>
          <span className="text-sm font-semibold" style={{ color: "hsl(150,30%,32%)" }}>0 g</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div>
          <p className="label-xs mb-1">Duration</p>
          <p className="text-sm font-semibold" style={{ color: "hsl(220,14%,15%)" }}>
            {formatDuration(durationMinutes)}
          </p>
        </div>
        <div>
          <p className="label-xs mb-1">Distance</p>
          <p className="text-sm font-semibold" style={{ color: "hsl(220,14%,15%)" }}>{distanceKm} km</p>
        </div>
        <div>
          <p className="label-xs mb-1">Cost</p>
          <p className="text-sm font-semibold" style={{ color: "hsl(150,30%,35%)" }}>Free</p>
        </div>
      </div>

      <p className="text-xs mb-4" style={{ color: "hsl(220,8%,55%)" }}>
        {hasCycleways
          ? "Route via dedicated cycle infrastructure · OpenStreetMap"
          : "Route via roads and shared paths · OpenStreetMap"}
      </p>

      {/* Annual saving */}
      <div className="flex justify-between items-center pt-3 border-t text-sm"
        style={{ borderColor: "hsl(220,8%,93%)" }}>
        <span style={{ color: "hsl(220,8%,52%)" }}>Annual CO₂ saving vs petrol car</span>
        <span className="font-semibold" style={{ color: "hsl(150,30%,35%)" }}>
          −{formatCo2(savingVsCarKg)}
        </span>
      </div>
    </div>
  );
}
