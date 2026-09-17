/**
 * Intersection explorer — the section components of one signal's study,
 * assembled by `intersection-study.tsx` (spec §3.2a): the pieces that were
 * the tabbed panel's header, Analysis and Lanes content. The panel container
 * itself is gone; selecting a signal opens the full-screen study instead.
 *
 *   Pair / Stat      "base → scenario" value pairs and the metric-strip cell.
 *   ScenarioDelta    the approaches whose printed values moved between the
 *                    base and the scenario.
 *   TimingBlock      cycle, g/C per phase, left phasing, basis, ped minimum.
 *   LanesSection     with an import: the per-movement lane groups (lanes,
 *                    capacity, volumes, v/c, queue vs storage, deficiency)
 *                    with a bar each. Without: the through-lane counts the
 *                    engine sized each approach with and where they came
 *                    from, the DEFAULT turn shares the engine used for
 *                    background traffic — stated as the assumption they are —
 *                    and where a Synchro import goes in. No lane data is
 *                    invented.
 *   QueueBar         one queue-vs-storage bar on a shared scale.
 *
 * Every number is the report's or the client solve's
 * (src/lib/intersection-geometry.ts reads them off the row).
 */
import type { TisLaneGroupImpact } from "@workspace/tis-api-client-react";
import { LosBadge } from "@/components/tis-report-bits";
import {
  lanesSourceLabel, legSourceLabel, ASSUMED_BAY_FT,
  type IntersectionPlan as Plan, type ApproachPlan, type TimingSummary,
} from "@/lib/intersection-geometry";

export const BASIS_LABEL: Record<string, string> = {
  webster: "Webster optimum from no-build volumes",
  measured: "measured plan (Synchro)",
  "measured-cycle": "measured cycle, Webster splits",
  "screening-default": "screening default (90 s, g/C 0.45)",
};

export const LEFT_SOURCE_LABEL: Record<string, string> = {
  import: "from the Synchro record",
  explicit: "as specified",
  inferred: "inferred (FHWA-HRT-04-091 cross product)",
  default: "screening default",
};

/** "base → value" when the printed values differ, else the value alone. */
export function Pair({ base, value, digits = 1, unit = "" }: { base?: number; value: number; digits?: number; unit?: string }) {
  const changed = base !== undefined && base.toFixed(digits) !== value.toFixed(digits);
  return (
    <span className="font-mono tabular-nums">
      {changed && <span className="text-muted-foreground">{base!.toFixed(digits)}{unit} → </span>}
      <span className={changed ? "font-semibold" : ""}>{value.toFixed(digits)}{unit}</span>
    </span>
  );
}

export function Stat({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0" data-testid={testId}>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-xs flex items-center gap-1">{children}</span>
    </div>
  );
}

/** The approaches whose printed values moved between the base and the scenario. */
export function ScenarioDelta({ plan, changed }: { plan: Plan; changed: ApproachPlan[] }) {
  if (changed.length === 0) {
    return <div className="text-[11px] text-muted-foreground" data-testid="explorer-scenario-delta">Scenario: no approach value differs from the base study on this signal.</div>;
  }
  return (
    <div className="space-y-1" data-testid="explorer-scenario-delta">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Base → scenario ({changed.length} of {plan.approaches.length} approaches differ)</div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="text-left py-1 pr-2 font-medium">Approach</th>
            <th className="text-right py-1 px-2 font-medium">Build vph</th>
            <th className="text-right py-1 px-2 font-medium">Build v/c</th>
            <th className="text-right py-1 px-2 font-medium">Build delay</th>
            <th className="text-center py-1 px-2 font-medium">Build LOS</th>
            <th className="text-right py-1 pl-2 font-medium">Q95 (ft)</th>
          </tr>
        </thead>
        <tbody>
          {changed.map((a) => (
            <tr key={a.direction} className="border-b last:border-0">
              <td className="py-1 pr-2 font-mono font-semibold">{a.direction}</td>
              <td className="py-1 px-2 text-right"><Pair base={a.base?.vph.build} value={a.vph.build} digits={0} /></td>
              <td className="py-1 px-2 text-right"><Pair base={a.base?.vc.build} value={a.vc.build} digits={2} /></td>
              <td className="py-1 px-2 text-right"><Pair base={a.base?.delay.build} value={a.delay.build} digits={1} unit=" s" /></td>
              <td className="py-1 px-2 text-center">
                {a.base && a.base.los.build !== a.los.build && <><LosBadge los={a.base.los.build} size="sm" /> <span className="text-muted-foreground">→</span> </>}
                <LosBadge los={a.los.build} size="sm" />
              </td>
              <td className="py-1 pl-2 text-right"><Pair base={a.base?.queue95Ft} value={a.queue95Ft} digits={0} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TimingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export function TimingBlock({ timing, base, changed }: { timing: TimingSummary | null; base: TimingSummary | null; changed: boolean }) {
  if (!timing) {
    return (
      <div className="space-y-1" data-testid="explorer-timing">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Signal timing</div>
        <div className="text-xs text-muted-foreground">No timing plan resolved on this row (screening basis).</div>
      </div>
    );
  }
  const phasing = (axis: "ns" | "ew") => {
    const cur = timing.leftPhasing[axis];
    const was = base?.leftPhasing[axis];
    return <span className="font-mono">{was && was !== cur && <span className="text-muted-foreground">{was} → </span>}{cur}</span>;
  };
  return (
    <div className="space-y-1" data-testid="explorer-timing">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Signal timing{changed ? " · changed in the scenario" : ""}</div>
      <TimingRow label="Cycle"><Pair base={base?.cycleLenSec} value={timing.cycleLenSec} digits={0} unit=" s" /> <span className="text-muted-foreground">· {timing.criticalPhases} critical phases</span></TimingRow>
      <TimingRow label="NS through g/C"><Pair base={base?.gOverC.ns} value={timing.gOverC.ns} digits={3} /></TimingRow>
      <TimingRow label="EW through g/C"><Pair base={base?.gOverC.ew} value={timing.gOverC.ew} digits={3} /></TimingRow>
      {(timing.gOverC.nsLeft !== undefined || base?.gOverC.nsLeft !== undefined) && (
        <TimingRow label="NS left g/C">{timing.gOverC.nsLeft !== undefined ? <Pair base={base?.gOverC.nsLeft} value={timing.gOverC.nsLeft} digits={3} /> : <span className="font-mono text-muted-foreground">{base?.gOverC.nsLeft?.toFixed(3)} → none</span>}</TimingRow>
      )}
      {(timing.gOverC.ewLeft !== undefined || base?.gOverC.ewLeft !== undefined) && (
        <TimingRow label="EW left g/C">{timing.gOverC.ewLeft !== undefined ? <Pair base={base?.gOverC.ewLeft} value={timing.gOverC.ewLeft} digits={3} /> : <span className="font-mono text-muted-foreground">{base?.gOverC.ewLeft?.toFixed(3)} → none</span>}</TimingRow>
      )}
      <TimingRow label="Left phasing">NS {phasing("ns")} · EW {phasing("ew")}{timing.leftPhasingSource ? <span className="text-muted-foreground"> · {LEFT_SOURCE_LABEL[timing.leftPhasingSource] ?? timing.leftPhasingSource}</span> : null}</TimingRow>
      <TimingRow label="Basis">
        {timing.source === "override" ? "your plan (scenario override)" : BASIS_LABEL[timing.basis] ?? timing.basis}
        {timing.source && timing.source !== "override" ? <span className="text-muted-foreground"> · source {timing.source}</span> : null}
        {base && base.basis !== timing.basis ? <span className="text-muted-foreground"> (was {BASIS_LABEL[base.basis] ?? base.basis})</span> : null}
      </TimingRow>
      {(timing.pedMin.ns !== undefined || timing.pedMin.ew !== undefined) && (
        <TimingRow label="Pedestrian minimum green"><span className="font-mono">NS {timing.pedMin.ns?.toFixed(1) ?? "—"} s · EW {timing.pedMin.ew?.toFixed(1) ?? "—"} s</span></TimingRow>
      )}
      {timing.criticalFlowRatio !== undefined && (
        <TimingRow label="Critical flow ratio (Y)"><Pair base={base?.criticalFlowRatio} value={timing.criticalFlowRatio} digits={2} /></TimingRow>
      )}
    </div>
  );
}

export function QueueBar({ queueFt, storageFt, scaleFt, deficient, width = 120 }: { queueFt: number; storageFt?: number; scaleFt: number; deficient?: boolean; width?: number }) {
  const W = width, H = 10;
  const px = (ft: number) => (Math.max(0, ft) / Math.max(1, scaleFt)) * W;
  const q = Math.min(W, px(queueFt));
  const s = storageFt !== undefined ? Math.min(W, px(storageFt)) : undefined;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" role="img" aria-label={`queue ${queueFt.toFixed(0)} ft${storageFt !== undefined ? ` against ${storageFt} ft of storage` : ""}`}>
      <rect x="0" y="0" width={W} height={H} className="fill-muted" />
      {s !== undefined && <rect x="0" y="0" width={s} height={H} fill="none" strokeWidth="1" className="stroke-foreground/50" />}
      <rect x="0" y="2" width={s !== undefined ? Math.min(q, s) : q} height={H - 4} className="fill-sky-500/70" />
      {s !== undefined && q > s && <rect x={s} y="2" width={q - s} height={H - 4} className={deficient === false ? "fill-amber-500/80" : "fill-red-500/80"} />}
    </svg>
  );
}

export function LanesSection({ plan }: { plan: Plan }) {
  if (plan.hasLaneGroups) {
    const rows = plan.approaches.flatMap((a) => (a.laneGroups ?? []).map((g) => ({ a, g })));
    const scaleFt = rows.reduce((m, { g }) => Math.max(m, g.queue95thFt, g.storageFt ?? 0), 1);
    return (
      <div className="space-y-2" data-testid="explorer-lanes-groups">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Lane groups (from the imported Synchro record)</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="text-left py-1 pr-2 font-medium">Approach</th>
                <th className="text-left py-1 px-2 font-medium">Mvmt</th>
                <th className="text-right py-1 px-2 font-medium">Lanes</th>
                <th className="text-right py-1 px-2 font-medium">Capacity vph</th>
                <th className="text-right py-1 px-2 font-medium">No-build vph</th>
                <th className="text-right py-1 px-2 font-medium">+Trips</th>
                <th className="text-right py-1 px-2 font-medium">Future vph</th>
                <th className="text-right py-1 px-2 font-medium">v/c</th>
                <th className="text-right py-1 px-2 font-medium">Q95 (ft)</th>
                <th className="text-right py-1 px-2 font-medium">Storage (ft)</th>
                <th className="text-left py-1 px-2 font-medium">Queue vs storage</th>
                <th className="text-center py-1 pl-2 font-medium">Deficient</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, g }: { a: ApproachPlan; g: TisLaneGroupImpact }) => (
                <tr key={`${a.direction}${g.movement}`} className="border-b last:border-0" data-testid={`lane-group-${a.direction}${g.movement}`}>
                  <td className="py-1 pr-2 font-mono font-semibold">{a.direction}</td>
                  <td className="py-1 px-2 font-mono">{g.movement}</td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums whitespace-nowrap">{g.lanes !== undefined ? `${g.lanes}` : "—"}{g.lanesSource ? <span className="text-muted-foreground"> {g.lanesSource}</span> : null}</td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums">{g.capacityVph !== undefined ? g.capacityVph.toFixed(0) : "—"}</td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums">{g.existingVolumeVph.toFixed(0)}</td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums">{g.addedTripsPeak}</td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums">{g.futureVolumeVph.toFixed(0)}</td>
                  <td className={`py-1 px-2 text-right font-mono tabular-nums ${g.futureVc >= 0.95 ? "text-red-600 font-semibold" : g.futureVc >= 0.85 ? "text-amber-600" : ""}`}>{g.futureVc.toFixed(2)}</td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums">{g.queue95thFt.toFixed(0)}</td>
                  <td className="py-1 px-2 text-right font-mono tabular-nums">{g.storageFt !== undefined ? g.storageFt : "—"}</td>
                  <td className="py-1 px-2"><QueueBar queueFt={g.queue95thFt} storageFt={g.storageFt} scaleFt={scaleFt} deficient={g.storageDeficient} /></td>
                  <td className={`py-1 pl-2 text-center font-mono ${g.storageDeficient ? "text-red-600 font-semibold" : "text-muted-foreground"}`}>{g.storageFt !== undefined ? (g.storageDeficient ? "yes" : "no") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-muted-foreground">
          Movement shares within each approach come from the record's measured turning movements applied to the approach's no-build volume;
          lane counts marked "import" are the record's [Lanes] section, "osm" the OSM lanes tag on the through movement, and a
          blank count is the engine's one-critical-lane basis. Bars share one scale ({scaleFt.toFixed(0)} ft); the outline is the
          bay's storage and the red run is the queue past it.
        </div>
        {plan.approaches.some((a) => !a.laneGroups) && (
          <div className="text-[11px] text-muted-foreground">
            Approaches without a row here ({plan.approaches.filter((a) => !a.laneGroups).map((a) => a.direction).join(", ")}) had no measured movement in the record.
          </div>
        )}
      </div>
    );
  }

  const shares = plan.defaultTurnShares;
  return (
    <div className="space-y-3" data-testid="explorer-lanes-default">
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Through lanes the engine sized each approach with</div>
        <table className="text-xs">
          <thead>
            <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="text-left py-1 pr-3 font-medium">Approach</th>
              <th className="text-right py-1 px-3 font-medium">Through lanes</th>
              <th className="text-left py-1 px-3 font-medium">Source</th>
              <th className="text-left py-1 px-3 font-medium">Left bay</th>
              <th className="text-right py-1 pl-3 font-medium">Project trips L / T / R</th>
            </tr>
          </thead>
          <tbody>
            {plan.approaches.map((a) => (
              <tr key={a.direction} className="border-b last:border-0" data-testid={`lanes-approach-${a.direction}`}>
                <td className="py-1 pr-3 font-mono font-semibold">{a.direction}</td>
                <td className="py-1 px-3 text-right font-mono tabular-nums">{a.throughLanes}</td>
                <td className={`py-1 px-3 ${a.lanesSource === "default" ? "text-muted-foreground" : ""}`}>{lanesSourceLabel(a.lanesSource)}{a.legSource ? <span className="text-muted-foreground"> · volume: {legSourceLabel(a.legSource)}</span> : null}</td>
                <td className="py-1 px-3 text-muted-foreground">
                  {a.leftBay.present
                    ? a.leftBay.basis === "protected-phase"
                      ? `implied by the protected ${a.direction === "NB" || a.direction === "SB" ? "NS" : "EW"} left phase; length ${a.leftBay.storageFt !== undefined ? `${a.leftBay.storageFt} ft (imported)` : `unknown (drawn at ${ASSUMED_BAY_FT} ft)`}`
                      : a.leftBay.storageFt !== undefined ? `${a.leftBay.storageFt} ft (imported storage record)` : "present, length unknown"
                    : "none on record"}
                </td>
                <td className="py-1 pl-3 text-right font-mono tabular-nums">{a.addedByMovement.L} / {a.addedByMovement.T} / {a.addedByMovement.R}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-xs space-y-1.5 max-w-prose">
        <p>
          No Synchro record is attached to this intersection, so the report carries no per-lane background counts. For the
          background traffic the engine used its default turn split — <span className="font-mono">{(shares.left * 100).toFixed(0)} %</span> left,{" "}
          <span className="font-mono">{(shares.through * 100).toFixed(0)} %</span> through, <span className="font-mono">{(shares.right * 100).toFixed(0)} %</span> right
          on every approach — which is an assumption, not a measurement. The project trips above are real (they come from the assignment);
          the background split is not.
        </p>
        <p className="text-muted-foreground">
          Import your Synchro model (the "Import from Synchro" control above the study form takes a UTDF file or a Synchro report PDF)
          and regenerate to get measured turning movements, lane counts per movement, turn-bay storage and per-lane-group queues here.
        </p>
      </div>
    </div>
  );
}
