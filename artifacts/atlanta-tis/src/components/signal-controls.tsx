/**
 * SignalControls — one signal's timing plan as the engineer edits it: cycle,
 * the NS/EW through split, a protected left per axis with its split, the
 * pedestrian-minimum note, the "Webster optimum" reset and the provenance
 * line. Extracted verbatim from the scenario studio's Signal tab so the
 * studio and the intersection study (§05 What-if) mount the SAME controls
 * on the SAME `SignalTimingEdit`; every edit goes back through `onChange`
 * and the caller re-solves with `solveScenario`.
 *
 * Element ids and test ids keep the studio's `scenario-*` names by default
 * (`idPrefix`), so the studio's UI is byte-identical; the study passes its
 * own prefix because both can be mounted at once.
 */
import type { TisAffectedIntersectionSignalTiming } from "@workspace/tis-api-client-react";
import { RotateCcw } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  type SignalTimingEdit,
  withCycle, withNsShare, withProtectedLeft, withLeftSplit, throughBudgetS,
  LOST_TIME_S, MIN_SPLIT_S,
} from "@/lib/scenario-solve";

export const BASIS_LABEL: Record<string, string> = {
  webster: "Webster optimum from no-build volumes",
  measured: "measured plan (Synchro)",
  "measured-cycle": "measured cycle, Webster splits",
  "screening-default": "screening default (90 s, g/C 0.45)",
};

export function SliderRow({ id, label, value, base, min, max, step, format, onChange, disabled }: {
  id: string; label: string; value: number; base?: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <label htmlFor={id} className="font-medium">{label}</label>
        <span className="font-mono tabular-nums">
          {base !== undefined && format(base) !== format(value) && <span className="text-muted-foreground">{format(base)} → </span>}
          {format(value)}
        </span>
      </div>
      <Slider id={id} value={[value]} min={min} max={max} step={step} disabled={disabled} onValueChange={([v]) => { if (typeof v === "number") onChange(v); }} aria-label={label} data-testid={`slider-${id}`} />
    </div>
  );
}

export type SignalControlsProps = {
  /** The plan being edited (seeded from the row by `timingEditFromRow`). */
  edit: SignalTimingEdit;
  /** The base row's cycle, for the cycle slider's "base →" readout. */
  baseCycleLenSec?: number;
  /** The scenario row's resolved timing: g/C readouts, ped minimums, provenance. */
  timing?: TisAffectedIntersectionSignalTiming;
  onChange: (next: SignalTimingEdit) => void;
  /** "Webster optimum": drop the edit (and clear a base override when the caller says so). */
  onReset: () => void;
  canReset: boolean;
  /** Prefix for element ids and EVERY test id (`<prefix>-signal-controls`,
   *  `<prefix>-note-ped-minimum`, `<prefix>-signal-timing-provenance`, …);
   *  default "scenario" (the studio's). The study passes "study", so the two
   *  mounts never share an id. */
  idPrefix?: string;
};

export function SignalControls({ edit, baseCycleLenSec, timing, onChange, onReset, canReset, idPrefix = "scenario" }: SignalControlsProps) {
  const nsShare = edit.nsThroughSplitS / Math.max(1, throughBudgetS(edit));
  const pedNs = timing?.pedMinGreenNsSec, pedEw = timing?.pedMinGreenEwSec;
  const pedShort = (pedNs !== undefined && edit.nsThroughSplitS - LOST_TIME_S < pedNs) || (pedEw !== undefined && edit.ewThroughSplitS - LOST_TIME_S < pedEw);
  return (
    <div className="space-y-3" data-testid={`${idPrefix}-signal-controls`}>
      <SliderRow id={`${idPrefix}-cycle`} label="Cycle" value={edit.cycleLenSec} base={baseCycleLenSec} min={30} max={300} step={5} format={(v) => `${v.toFixed(0)} s`} onChange={(v) => onChange(withCycle(edit, v))} />
      <SliderRow id={`${idPrefix}-ns-share`} label="Through split · NS share" value={Math.round(nsShare * 100)} min={Math.ceil((MIN_SPLIT_S / Math.max(1, throughBudgetS(edit))) * 100)} max={Math.floor(100 - (MIN_SPLIT_S / Math.max(1, throughBudgetS(edit))) * 100)} step={1}
        format={(v) => `NS ${v.toFixed(0)}% / EW ${(100 - v).toFixed(0)}%`} onChange={(v) => onChange(withNsShare(edit, v / 100))} />
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="font-mono tabular-nums text-muted-foreground">NS {edit.nsThroughSplitS.toFixed(0)} s split · g/C {timing ? timing.gOverCns.toFixed(3) : "—"}</div>
        <div className="font-mono tabular-nums text-muted-foreground">EW {edit.ewThroughSplitS.toFixed(0)} s split · g/C {timing ? timing.gOverCew.toFixed(3) : "—"}</div>
      </div>
      {(["ns", "ew"] as const).map((axis) => {
        const on = axis === "ns" ? edit.nsLeftSplitS !== undefined : edit.ewLeftSplitS !== undefined;
        const split = axis === "ns" ? edit.nsLeftSplitS : edit.ewLeftSplitS;
        const maxLeft = Math.max(MIN_SPLIT_S, edit.cycleLenSec - (axis === "ns" ? edit.ewLeftSplitS ?? 0 : edit.nsLeftSplitS ?? 0) - 2 * MIN_SPLIT_S);
        return (
          <div key={axis} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <label htmlFor={`${idPrefix}-left-${axis}`} className="font-medium">Protected left · {axis.toUpperCase()}</label>
              <Switch id={`${idPrefix}-left-${axis}`} checked={on} onCheckedChange={(v) => onChange(withProtectedLeft(edit, axis, v))} data-testid={`switch-${idPrefix}-left-${axis}`} />
            </div>
            {on && split !== undefined && (
              <SliderRow id={`${idPrefix}-left-split-${axis}`} label={`${axis.toUpperCase()} left split`} value={split} min={MIN_SPLIT_S} max={maxLeft} step={1} format={(v) => `${v.toFixed(0)} s`} onChange={(v) => onChange(withLeftSplit(edit, axis, v))} />
            )}
          </div>
        );
      })}
      {(pedNs !== undefined || pedEw !== undefined) && (
        <div className={`text-[11px] ${pedShort ? "text-amber-600" : "text-muted-foreground"}`} data-testid={`${idPrefix}-note-ped-minimum`}>
          Pedestrian minimum green: NS {pedNs?.toFixed(1) ?? "—"} s, EW {pedEw?.toFixed(1) ?? "—"} s{pedShort ? " — a through split is below its walk time plus lost time." : "."}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onReset} disabled={!canReset} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50" data-testid={`button-${idPrefix}-webster`}>
          <RotateCcw className="w-3 h-3" /> Webster optimum
        </button>
        <div className="text-[11px] text-muted-foreground text-right" data-testid={`${idPrefix}-signal-timing-provenance`}>
          {timing ? (
            timing.source === "override"
              ? `Your plan · ${timing.cycleLenSec} s · ${timing.criticalPhases} critical phases`
              : `${BASIS_LABEL[timing.basis] ?? timing.basis} · ${timing.cycleLenSec} s`
          ) : "Screening basis (no timing resolved)"}
        </div>
      </div>
    </div>
  );
}
