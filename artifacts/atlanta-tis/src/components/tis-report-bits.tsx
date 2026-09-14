/**
 * Shared report atoms: the LOS palette, the LOS badge, the mitigation-severity
 * config, the approach-detail table, the project-trips-by-movement grid, the
 * affected-intersections capacity table and the delay confidence band.
 *
 * Extracted from pages/tis.tsx so the scenario studio and the intersection
 * study (components/) and the gallery can render the same rows the printed
 * report renders — one palette, one badge, one table. tis.tsx imports these
 * back; nothing here changed.
 */
import { Fragment, useState } from "react";
import type { TisReport, TisAffectedIntersection, TisApproachImpact } from "@workspace/tis-api-client-react";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CitationRef } from "@/components/citation-ref";

// ±15% confidence band on delay-delta projections at the 80% confidence
// level. Mirrors the calibration RMSE disclosure in the methodology appendix.
export const DELAY_CONFIDENCE_FRAC = 0.15;
export function delayBand(delta: number): { lo: number; hi: number } {
  const half = Math.abs(delta) * DELAY_CONFIDENCE_FRAC;
  return { lo: delta - half, hi: delta + half };
}

export const LOS_COLORS: Record<string, { bg: string; fg: string; border: string; map: string }> = {
  A: { bg: "bg-emerald-100 dark:bg-emerald-950/40", fg: "text-emerald-800 dark:text-emerald-200", border: "border-emerald-300", map: "#10b981" },
  B: { bg: "bg-emerald-100 dark:bg-emerald-950/40", fg: "text-emerald-800 dark:text-emerald-200", border: "border-emerald-300", map: "#22c55e" },
  C: { bg: "bg-yellow-100 dark:bg-yellow-950/40", fg: "text-yellow-800 dark:text-yellow-200", border: "border-yellow-300", map: "#eab308" },
  D: { bg: "bg-amber-100 dark:bg-amber-950/40", fg: "text-amber-800 dark:text-amber-200", border: "border-amber-300", map: "#f59e0b" },
  E: { bg: "bg-orange-100 dark:bg-orange-950/40", fg: "text-orange-800 dark:text-orange-200", border: "border-orange-300", map: "#f97316" },
  F: { bg: "bg-red-100 dark:bg-red-950/40", fg: "text-red-800 dark:text-red-200", border: "border-red-300", map: "#dc2626" },
};

export const SEVERITY_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  none: { label: "No mitigation", color: "text-emerald-600", icon: CheckCircle2 },
  minor: { label: "Minor", color: "text-yellow-600", icon: Info },
  moderate: { label: "Moderate", color: "text-amber-600", icon: AlertTriangle },
  major: { label: "Major", color: "text-red-600", icon: AlertCircle },
};

export function LosBadge({ los, size = "md" }: { los: string; size?: "sm" | "md" }) {
  const c = LOS_COLORS[los] ?? LOS_COLORS.A!;
  const dims = size === "sm" ? "w-6 h-6 text-xs" : "w-7 h-7 text-sm";
  return (
    <span className={`inline-flex items-center justify-center ${dims} rounded font-bold border ${c.bg} ${c.fg} ${c.border}`}>
      {los}
    </span>
  );
}

export function ApproachDetailTable({ approaches }: { approaches: TisApproachImpact[] }) {
  if (!approaches || approaches.length === 0) {
    return <div className="text-xs text-muted-foreground">No approach detail.</div>;
  }
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
        Approach detail (signalized-intersection screening model, weather-adjusted)
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="text-left py-1 pr-2 font-medium">Approach</th>
            <th className="text-right py-1 px-2 font-medium">No-Build vph</th>
            <th className="text-right py-1 px-2 font-medium">+Trips</th>
            <th className="text-right py-1 px-2 font-medium">Future vph</th>
            <th className="text-right py-1 px-2 font-medium">v/c (no-build → build)</th>
            <th className="text-right py-1 px-2 font-medium">Delay (no-build → build)</th>
            <th className="text-center py-1 px-2 font-medium">LOS (no-build → build)</th>
            <th className="text-right py-1 pl-2 font-medium">Q95 (ft)</th>
          </tr>
        </thead>
        <tbody>
          {approaches.map((a) => (
            <tr key={a.direction} className="border-b last:border-0">
              <td className="py-1 pr-2 font-mono font-semibold">{a.direction}</td>
              <td className="py-1 px-2 text-right tabular-nums">{a.existingVolumeVph.toFixed(0)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{a.addedTripsPeak}</td>
              <td className="py-1 px-2 text-right tabular-nums">{a.futureVolumeVph.toFixed(0)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{a.existingVc.toFixed(2)} → <span className={a.futureVc >= 0.95 ? "text-red-600 font-semibold" : a.futureVc >= 0.85 ? "text-amber-600" : ""}>{a.futureVc.toFixed(2)}</span></td>
              <td className="py-1 px-2 text-right tabular-nums">{a.existingDelaySec.toFixed(1)}s → {a.futureDelaySec.toFixed(1)}s</td>
              <td className="py-1 px-2 text-center"><LosBadge los={a.existingLos} /> → <LosBadge los={a.futureLos} /></td>
              <td className={`py-1 pl-2 text-right tabular-nums ${a.queue95thFt >= 400 ? "text-red-600 font-semibold" : a.queue95thFt >= 250 ? "text-amber-600" : ""}`}>
                {a.queue95thFt.toFixed(0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const GRID_DIRECTIONS = ["NB", "SB", "EB", "WB"] as const;
const GRID_MOVEMENTS = ["L", "T", "R"] as const;

const MOVEMENT_SOURCE_LABEL: Record<string, string> = {
  path: "from the routed paths through this junction (conserved assignment)",
  octant: "from the geometric octant model",
};

/**
 * Project trips by movement — the row's integer `movements` table as a
 * 3 × 4 grid (L/T/R × NB/SB/EB/WB) with approach and movement totals. The
 * PROJECT increment only: the engine does not carry a measured background
 * turn split at screening level, and the caption says so.
 */
export function MovementsGrid({ row }: { row: Pick<TisAffectedIntersection, "movements" | "movementSource" | "addedTripsPmPeak"> }) {
  const movements = row.movements ?? [];
  if (movements.length === 0) {
    return (
      <div className="text-xs text-muted-foreground" data-testid="movements-grid-empty">
        No project-trip movement table on this row (the engine prints one only when the assignment put at least one whole trip on a movement).
      </div>
    );
  }
  const cell: Record<string, number> = {};
  for (const m of movements) cell[`${m.approach}${m.movement}`] = (cell[`${m.approach}${m.movement}`] ?? 0) + m.trips;
  const colTotal = (d: string) => GRID_MOVEMENTS.reduce((s, m) => s + (cell[`${d}${m}`] ?? 0), 0);
  const rowTotal = (m: string) => GRID_DIRECTIONS.reduce((s, d) => s + (cell[`${d}${m}`] ?? 0), 0);
  const total = GRID_DIRECTIONS.reduce((s, d) => s + colTotal(d), 0);
  const source = row.movementSource ? MOVEMENT_SOURCE_LABEL[row.movementSource] ?? row.movementSource : null;
  return (
    <div className="space-y-1" data-testid="movements-grid">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Project trips by movement (PM peak)</div>
      <table className="text-xs tabular-nums">
        <thead>
          <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="text-left py-1 pr-3 font-medium"></th>
            {GRID_DIRECTIONS.map((d) => <th key={d} className="text-right py-1 px-2 font-medium font-mono">{d}</th>)}
            <th className="text-right py-1 pl-3 font-medium">Σ</th>
          </tr>
        </thead>
        <tbody>
          {GRID_MOVEMENTS.map((m) => (
            <tr key={m} className="border-b last:border-0">
              <td className="py-1 pr-3 font-mono font-semibold">{m === "L" ? "Left" : m === "T" ? "Through" : "Right"}</td>
              {GRID_DIRECTIONS.map((d) => {
                const v = cell[`${d}${m}`] ?? 0;
                return <td key={d} className={`py-1 px-2 text-right font-mono ${v === 0 ? "text-muted-foreground/60" : ""}`} data-testid={`movement-${d}${m}`}>{v}</td>;
              })}
              <td className="py-1 pl-3 text-right font-mono text-muted-foreground">{rowTotal(m)}</td>
            </tr>
          ))}
          <tr className="border-t">
            <td className="py-1 pr-3 text-muted-foreground">Σ</td>
            {GRID_DIRECTIONS.map((d) => <td key={d} className="py-1 px-2 text-right font-mono text-muted-foreground">{colTotal(d)}</td>)}
            <td className="py-1 pl-3 text-right font-mono font-semibold">{total}</td>
          </tr>
        </tbody>
      </table>
      <div className="text-[11px] text-muted-foreground">
        Project increment only{source ? `, ${source}` : ""}; the background turn split is not measured at screening level.
        {total !== row.addedTripsPmPeak ? ` The table sums to ${total} against ${row.addedTripsPmPeak} PM trips on the row.` : ""}
      </div>
    </div>
  );
}

export type IntersectionTableProps = {
  report: TisReport;
  /** Fired on a row click — opens that intersection's study. When present the
   *  row does NOT toggle its inline detail; the chevron does. */
  onSelect?: (signalId: string) => void;
  /** Row to highlight (the page's selected signal). */
  selectedSignalId?: string | null;
};

/** The affected-intersections capacity table the report prints. */
export function IntersectionTable({ report, onSelect, selectedSignalId }: IntersectionTableProps) {
  // Sort by impact severity — losChanged first, then by delay delta.
  const sorted = [...report.affectedIntersections].sort((a, b) => {
    if (a.losChanged !== b.losChanged) return a.losChanged ? -1 : 1;
    return (b.futureDelaySec - b.existingDelaySec) - (a.futureDelaySec - a.existingDelaySec);
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <Card className="break-inside-avoid">
      <CardHeader>
        <CardTitle className="text-base">
          Affected intersections — capacity table<CitationRef tags={["HCM_19", "HCM_19_8"]} />
        </CardTitle>
        <CardDescription>
          Per-intersection LOS before vs after build-out (PM peak). {onSelect
            ? "Click any row to open that intersection as its own study; the chevron expands its NB/SB/EB/WB approach detail in place."
            : "Click any row to expand NB/SB/EB/WB approach detail with v/c, delay, LOS and 95th-percentile back-of-queue."}
          {" "}Rows are sorted by impact severity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-6"></th>
                <th className="text-left py-2 pr-2 font-medium">Intersection</th>
                <th className="text-left py-2 px-2 font-medium">Zone</th>
                <th className="text-right py-2 px-2 font-medium">Dist (mi)</th>
                <th className="text-right py-2 px-2 font-medium">+Trips PM</th>
                <th className="text-center py-2 px-2 font-medium">LOS no-build</th>
                <th className="text-center py-2 px-2 font-medium">LOS build</th>
                <th className="text-right py-2 px-2 font-medium">Delay Δ</th>
                <th className="text-right py-2 px-2 font-medium">Q95 (ft)</th>
                <th className="text-center py-2 pl-2 font-medium">Mitigation</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-6 text-muted-foreground text-sm">
                    No signalized intersections within the study radius.
                  </td>
                </tr>
              )}
              {sorted.map((r: TisAffectedIntersection) => {
                const sev = SEVERITY_CONFIG[r.mitigationSeverity] ?? SEVERITY_CONFIG.none!;
                const SevIcon = sev.icon;
                const delta = r.futureDelaySec - r.existingDelaySec;
                const isOpen = expanded.has(r.signalId);
                const isSelected = !!selectedSignalId && selectedSignalId === r.signalId;
                return (
                  <Fragment key={r.signalId}>
                  <tr
                    className={`border-b last:border-0 align-middle cursor-pointer ${isSelected ? "bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100/70 dark:hover:bg-blue-950/50" : "hover:bg-muted/30"}`}
                    // With a study to open, the row opens it and ONLY the chevron
                    // toggles the inline detail — a row is never left expanded
                    // under the study. Without one the row toggles, as before.
                    onClick={() => { if (onSelect) onSelect(r.signalId); else toggle(r.signalId); }}
                    aria-selected={isSelected || undefined}
                    data-testid={`row-intersection-${r.signalId}`}
                  >
                    <td className="py-2 pr-1 text-muted-foreground">
                      <button
                        type="button"
                        className="inline-flex items-center rounded p-0.5 hover:bg-muted"
                        onClick={(e) => { e.stopPropagation(); toggle(r.signalId); }}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Collapse" : "Expand"} approach detail for ${r.name}`}
                        data-testid={`toggle-intersection-${r.signalId}`}
                      >
                        {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="font-medium truncate max-w-[200px] flex items-center gap-1.5">
                        {r.name}
                        {r.calibration && r.calibration.sampleCount > 0 && (
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900"
                            title={`Screening delay calibrated against ${r.calibration.sampleCount} observed sample${r.calibration.sampleCount === 1 ? "" : "s"} (multiplier ×${r.calibration.delayMultiplier.toFixed(2)})`}
                            data-testid={`badge-calibrated-${r.signalId}`}
                          >
                            Calibrated
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">{r.signalId}</div>
                    </td>
                    <td className="py-2 px-2 text-muted-foreground text-xs">{r.zone}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{r.distanceMi.toFixed(2)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{r.addedTripsPmPeak}</td>
                    <td className="py-2 px-2 text-center"><LosBadge los={r.existingLos} /></td>
                    <td className="py-2 px-2 text-center"><LosBadge los={r.futureLos} /></td>
                    <td className={`py-2 px-2 text-right tabular-nums ${delta >= 15 ? "text-red-600 font-semibold" : delta >= 5 ? "text-amber-600 font-semibold" : ""}`}>
                      {delta >= 0 ? "+" : ""}{delta.toFixed(1)}s
                      {Math.abs(delta) >= 1 && (
                        <div className="text-[9px] text-muted-foreground font-normal">
                          ±{(Math.abs(delta) * DELAY_CONFIDENCE_FRAC).toFixed(1)}s
                        </div>
                      )}
                    </td>
                    <td className={`py-2 px-2 text-right tabular-nums ${r.queue95thFt >= 400 ? "text-red-600 font-semibold" : r.queue95thFt >= 250 ? "text-amber-600" : ""}`}>
                      {r.queue95thFt.toFixed(0)}
                    </td>
                    <td className="py-2 pl-2 text-center">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium ${sev.color}`} title={r.mitigation}>
                        <SevIcon className="w-3.5 h-3.5" />
                        {sev.label}
                      </span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b last:border-0 bg-muted/20">
                      <td colSpan={10} className="py-3 px-3">
                        <ApproachDetailTable approaches={r.approaches} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
