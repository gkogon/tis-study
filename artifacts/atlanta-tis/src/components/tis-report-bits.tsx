/**
 * Shared report atoms: the LOS palette, the LOS badge, the mitigation-severity
 * config, the approach-detail table and the delay confidence band.
 *
 * Extracted from pages/tis.tsx so the scenario studio (components/) and the
 * gallery can render the same rows the printed report renders — one palette,
 * one badge, one table. tis.tsx imports these back; nothing here changed.
 */
import type { TisApproachImpact } from "@workspace/tis-api-client-react";
import { CheckCircle2, AlertTriangle, AlertCircle, Info } from "lucide-react";

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
