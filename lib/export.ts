import type { JourneyResult, CarVariant } from "@/lib/emissions";
import type { FerryCrossing } from "@/lib/ferries";
import { formatCo2, formatDuration } from "@/lib/emissions";

/** Selected journey passed from the UI toggle — may be a transit leg or a synthetic car entry */
export type SelectedJourney = JourneyResult & { label?: string };

// ─────────────────────────────────────────────────────────────────
// CSV export — full data dump: all transit options, car variants,
// ferry crossings, selected route, and annual totals
// ─────────────────────────────────────────────────────────────────

export function exportCsv(
  journeys: JourneyResult[],
  selectedJourney: SelectedJourney | null,
  carVariants: CarVariant[],
  ferryCrossings: FerryCrossing[],
  bestModeLabel: string,         // e.g. "Lowest CO₂" or "Public transport only"
  from: string,
  to: string,
  distanceKm: number,
  roadDistanceKm: number,
  workDays: number
) {
  const rows: string[][] = [];

  // ── Header ────────────────────────────────────────────────────
  rows.push(["CO₂ Route Calculator — Norway", "", "", "", "", ""]);
  rows.push([`Route: ${from} → ${to}`, "", "", "", "", ""]);
  rows.push([`Straight-line distance: ${distanceKm} km`, `Road distance: ${roadDistanceKm} km`, "", "", "", ""]);
  rows.push([`Work days / year: ${workDays}`, `Reporting mode: ${bestModeLabel}`, "", "", "", ""]);
  rows.push([`Generated: ${new Date().toISOString().slice(0, 10)}`, "", "", "", "", ""]);
  rows.push(["Sources: Entur Journey Planner · EEA (estimated specific CO₂ by mode) · Miljødirektoratet · SINTEF Energimodul (ISO 14083:2023)", "", "", "", "", ""]);
  rows.push([""]);

  // ── Selected route (winner per toggle) ───────────────────────
  if (selectedJourney) {
    const isCar = selectedJourney.legs.length === 0 && !!selectedJourney.label;
    rows.push(["SELECTED ROUTE — " + bestModeLabel.toUpperCase(), "", "", "", "", ""]);
    if (isCar) {
      rows.push(["Mode", "CO₂ per trip (kg)", "Annual CO₂ (kg)", "Note", "", ""]);
      rows.push([
        selectedJourney.label ?? "Car",
        selectedJourney.totalCo2Kg.toString(),
        selectedJourney.annualCo2Kg.toString(),
        "Private car · solo driver (GHG Protocol default)",
        "", "",
      ]);
    } else {
      rows.push([
        "Total CO₂/trip",
        formatCo2(selectedJourney.totalCo2Kg),
        "Annual CO₂",
        formatCo2(selectedJourney.annualCo2Kg),
        "Duration",
        formatDuration(selectedJourney.durationMinutes),
      ]);
      if (selectedJourney.legs.length > 0) {
        rows.push([""]);
        rows.push(["From", "To", "Mode", "Distance (km)", "CO₂ (kg)", "Factor (g/pkm)", "Operator", "Line"]);
        selectedJourney.legs.forEach((l) => {
          rows.push([
            l.fromName, l.toName, l.mode,
            l.distanceKm.toFixed(2),
            l.co2Kg.toFixed(3),
            (l.co2PerKm * 1000).toFixed(1),
            l.operatorName ?? "",
            l.lineName ?? "",
          ]);
        });
      }
    }
    rows.push([""]);
  }

  // ── All transit journey options ───────────────────────────────
  if (journeys.length > 0) {
    rows.push(["ALL PUBLIC TRANSPORT OPTIONS (via Entur)", "", "", "", "", ""]);
    rows.push(["#", "Route summary", "CO₂/trip (kg)", "Annual CO₂ (kg)", "Duration", "Departure"]);
    journeys.forEach((j, i) => {
      const summary = j.legs
        .filter((l) => l.mode !== "foot")
        .map((l) => `${l.mode}(${l.distanceKm.toFixed(1)}km)`)
        .join(" + ");
      rows.push([
        `Option ${i + 1}`,
        summary,
        j.totalCo2Kg.toString(),
        j.annualCo2Kg.toString(),
        formatDuration(j.durationMinutes),
        j.departureTime ? new Date(j.departureTime).toLocaleString("no-NO", { timeZone: "Europe/Oslo", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "",
      ]);
    });

    // Per-leg breakdown for each option
    journeys.forEach((j, i) => {
      if (j.legs.length === 0) return;
      rows.push([""]);
      rows.push([`Option ${i + 1} — leg breakdown`, "", "", "", "", ""]);
      rows.push(["From", "To", "Mode", "Distance (km)", "CO₂ (kg)", "Factor (g/pkm)", "Operator", "Line"]);
      j.legs.forEach((l) => {
        rows.push([
          l.fromName, l.toName, l.mode,
          l.distanceKm.toFixed(2),
          l.co2Kg.toFixed(3),
          (l.co2PerKm * 1000).toFixed(1),
          l.operatorName ?? "",
          l.lineName ?? "",
        ]);
      });
    });
    rows.push([""]);
  }

  // ── Private car comparison ────────────────────────────────────
  if (carVariants.length > 0) {
    rows.push(["PRIVATE CAR OPTIONS", "", "", "", "", ""]);
    rows.push(["Mode", "CO₂/trip (kg)", "Annual CO₂ (kg)", "Duration", "Cost/trip (NOK)", "Annual cost (NOK)"]);
    carVariants.forEach((v) => {
      rows.push([
        v.label,
        v.co2Kg.toString(),
        v.annualCo2Kg.toString(),
        formatDuration(v.durationMinutes),
        v.costNok.toString(),
        v.annualCo2Kg !== undefined ? (v.costNok * 2 * workDays).toString() : "",
      ]);
    });
    rows.push([""]);
  }

  // ── Ferry crossings reference ─────────────────────────────────
  if (ferryCrossings.length > 0) {
    rows.push(["FERRY CROSSINGS ON ROUTE (informational)", "", "", "", "", ""]);
    rows.push(["Crossing", "Operator", "Distance (km)", "Duration (min)", "CO₂/passenger (kg)", "CO₂/car (kg) — reference only"]);
    ferryCrossings.forEach((f) => {
      rows.push([
        f.name + (f.route ? ` (${f.route})` : ""),
        f.operator,
        f.distanceKm.toString(),
        f.durationMinutes.toString(),
        f.co2PerPassengerKg.toString(),
        f.co2PerCarKg.toString(),
      ]);
    });
    rows.push(["Note: CO₂ per car is shown for reference only. Vehicle ferry transport is Scope 3 Cat.6 — not included in commute total.", "", "", "", "", ""]);
    rows.push([""]);
  }

  // ── Annual impact summary ─────────────────────────────────────
  if (selectedJourney) {
    rows.push(["ANNUAL IMPACT SUMMARY", "", "", "", "", ""]);
    rows.push(["Work days", "One-way trips", "Round trips", "CO₂/trip (kg)", "Annual CO₂ (kg)", "Reporting basis"]);
    rows.push([
      workDays.toString(),
      workDays.toString(),
      (workDays * 2).toString(),
      selectedJourney.totalCo2Kg.toString(),
      selectedJourney.annualCo2Kg.toString(),
      bestModeLabel,
    ]);
    rows.push([""]);
  }

  // ── Generate and download ─────────────────────────────────────
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `co2-route-${from}-${to}-${new Date().toISOString().slice(0, 10)}.csv`
    .replace(/\s+/g, "-").replace(/[^a-z0-9.\-]/gi, "").toLowerCase();
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────
// CSRD Scope 3 text export
// ─────────────────────────────────────────────────────────────────

export function exportCsrdText(
  journeys: JourneyResult[],
  selectedJourney: SelectedJourney | null,
  reportingBasis: string,
  from: string,
  to: string,
  distanceKm: number,
  workDays: number
): string {
  const lines: string[] = [
    "CSRD SCOPE 3 — EMPLOYEE COMMUTE EMISSIONS REPORT",
    "Generated by CO₂ Route Calculator · github.com/irinaaf",
    "",
    `Route analysed:       ${from} → ${to}`,
    `Straight-line dist.:  ${distanceKm} km`,
    `Work days per year:   ${workDays}`,
    `Calculation date:     ${new Date().toISOString().slice(0, 10)}`,
    `Reporting basis:      ${reportingBasis}`,
    "",
  ];

  if (selectedJourney) {
    const isCar = selectedJourney.legs.length === 0 && !!selectedJourney.label;
    if (isCar) {
      lines.push("SELECTED ROUTE:");
      lines.push(`  Mode:     ${selectedJourney.label} (private car)`);
      lines.push(`  Total:    ${formatCo2(selectedJourney.totalCo2Kg)} per trip  |  Annual: ${formatCo2(selectedJourney.annualCo2Kg)}`);
      lines.push("  Note: Solo driver assumption per GHG Protocol Category 7.");
      lines.push("        Car ferry crossings are shown separately if detected on route.");
      lines.push("");
    } else {
      lines.push("SELECTED ROUTE:");
      lines.push(`  Total:    ${formatCo2(selectedJourney.totalCo2Kg)} per trip  |  Annual: ${formatCo2(selectedJourney.annualCo2Kg)}`);
      if (selectedJourney.durationMinutes > 0) {
        lines.push(`  Duration: ${formatDuration(selectedJourney.durationMinutes)}`);
      }
      lines.push("");
      if (selectedJourney.legs.length > 0) {
        lines.push("  Leg breakdown:");
        selectedJourney.legs.forEach((l) => {
          const coeff = `${(l.co2PerKm * 1000).toFixed(1)} g/pkm`;
          lines.push(
            `  · ${l.fromName.padEnd(22)} → ${l.toName.padEnd(22)}` +
            `  ${l.mode.padEnd(14)}` +
            `  ${coeff} × ${l.distanceKm} km = ${formatCo2(l.co2Kg)}`
          );
          if (l.operatorName) lines.push(`    Operator: ${l.operatorName}${l.lineName ? ` · Line ${l.lineName}` : ""}`);
        });
        lines.push("");
      }
    }
  } else {
    lines.push("No routes found for this selection.");
    lines.push("");
  }

  if (journeys.length > 0) {
    lines.push(`ALL TRANSIT OPTIONS (${journeys.length} total, for reference):`);
    journeys.forEach((j, i) => {
      lines.push(`  Option ${i + 1}:  ${formatCo2(j.totalCo2Kg)}/trip  |  Annual: ${formatCo2(j.annualCo2Kg)}  |  ${formatDuration(j.durationMinutes)}`);
    });
    lines.push("");
  }

  lines.push("METHODOLOGY:");
  lines.push("Routes sourced from Entur Journey Planner API v3 (real timetable + OpenStreetMap data).");
  lines.push("Emission factors: EEA — Estimated specific emissions of CO₂ by mode of transport");
  lines.push("  (eea.europa.eu/en/analysis/maps-and-charts/estimated-specific-emissions-of-co2).");
  lines.push("Norwegian public transport: Entur + SINTEF Energimodul (miljo.entur.org), ISO 14083:2023.");
  lines.push("Car factors: Miljødirektoratet Norwegian fleet average (miljostatus.miljodirektoratet.no).");
  lines.push("Norwegian rail: 0.009 kg CO₂e/pkm (Vy, ~99% hydropower).");
  lines.push("Ferry: 0.019 kg CO₂e/pkm (Norled/Fjord1 fleet average 2023).");
  lines.push("Bus: operator-specific factor where available (Ruter 0.011, AtB 0.018, regional 0.027).");
  lines.push("Aviation: includes IPCC radiative forcing multiplier ×1.9.");
  lines.push("Road distance: OSRM / OpenStreetMap (switchable to Google Maps via env vars).");
  lines.push("");
  lines.push("Scope: ESRS E1-6, GHG Protocol Category 3.7 — Employee commuting.");

  return lines.join("\n");
}
