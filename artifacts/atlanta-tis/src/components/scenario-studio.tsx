/**
 * ScenarioStudio — the rail beside the live study map where an engineer
 * changes the study and watches the engine's own row math answer.
 *
 *   Site    size, pass-by, internal capture, growth, weather — re-solved in
 *           the browser through the real credit chain and buildAffectedRow.
 *   Signal  the selected signal's timing plan (cycle, splits, protected
 *           lefts) as an override the engine consumes ahead of Webster;
 *           base → scenario LOS and delay, the scenario's approach table.
 *   Access  driveways — routing needs the road network, so this tab hands
 *           the whole scenario to the engine (POST /whatif). Hidden when the
 *           page has no server to send to (the gallery).
 *
 * Every number shown is either the base report's or the client solve's
 * (`solution.report`), never an approximation of either. Where the solve
 * had to reconstruct an input from the printed report (a study generated
 * before the engine emitted its exact inputs), the provenance line says so.
 */
import { useEffect, useMemo, useState } from "react";
import type { TisReport, TisAffectedIntersection, TisWeather, Driveway } from "@workspace/tis-api-client-react";
import { Loader2, RotateCcw, Send, AlertCircle } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { DrivewayEditor } from "@/components/driveway-editor";
import { LosBadge, ApproachDetailTable } from "@/components/tis-report-bits";
import {
  type ScenarioState, type ScenarioSolution, type SignalTimingEdit, type RowFallback, type WhatIfRequest,
  EMPTY_SCENARIO, isScenarioDirty, isClientScenarioDirty, toWhatIfRequest,
  timingEditFromRow, withCycle, withNsShare, withProtectedLeft, withLeftSplit, throughBudgetS,
  LOST_TIME_S, MIN_SPLIT_S,
} from "@/lib/scenario-solve";

export type ScenarioStudioProps = {
  /** The engine's report — the yardstick every readout compares against. */
  report: TisReport;
  /** The client solve of `report` for `scenario`. */
  solution: ScenarioSolution;
  scenario: ScenarioState;
  onChange: (next: ScenarioState) => void;
  /** Send the scenario to the engine (POST /whatif). Absent ⇒ no server:
   *  the Access tab and the send button are hidden. */
  onRerun?: (req: WhatIfRequest) => void;
  rerunPending?: boolean;
  rerunError?: string | null;
  /** "Engine vs client" line after a server run: the largest field difference. */
  engineDiff?: { maxDelayDeltaSec: number; maxVcDelta: number; losMismatches: number; rows: number } | null;
};

const WEATHER_OPTIONS: Array<{ value: TisWeather; label: string; cap: number }> = [
  { value: "clear", label: "Clear", cap: 1.0 },
  { value: "light_rain", label: "Light rain", cap: 0.95 },
  { value: "heavy_rain", label: "Heavy rain", cap: 0.86 },
  { value: "light_snow", label: "Light snow", cap: 0.86 },
  { value: "heavy_snow", label: "Heavy snow", cap: 0.70 },
];

const FALLBACK_LABEL: Record<RowFallback, string> = {
  baseVolume: "design-hour volume from printed approach volumes",
  loadWeight: "load weight from printed trips",
  pathLedger: "turn ledger from printed movements",
  gOverC: "timing from printed g/C",
  utdfAttach: "Synchro record re-matched",
  calibration: "calibration multiplier rounded",
  turbo: "turbo-lane screening held at base",
  baseOnly: "row held at base",
};

const BASIS_LABEL: Record<string, string> = {
  webster: "Webster optimum from no-build volumes",
  measured: "measured plan (Synchro)",
  "measured-cycle": "measured cycle, Webster splits",
  "screening-default": "screening default (90 s, g/C 0.45)",
};

function fmtDelta(a: number, b: number, digits = 1, unit = ""): string {
  const d = b - a;
  if (Math.abs(d) < 0.5 * Math.pow(10, -digits)) return "no change";
  return `${d > 0 ? "+" : ""}${d.toFixed(digits)}${unit}`;
}

function Readout({ label, base, value, unit, digits = 0, warnAbove }: { label: string; base: number; value: number; unit?: string; digits?: number; warnAbove?: number }) {
  const changed = base.toFixed(digits) !== value.toFixed(digits);
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">
        {changed && <span className="text-muted-foreground">{base.toFixed(digits)}{unit} → </span>}
        <span className={warnAbove !== undefined && value > warnAbove ? "text-amber-600 font-semibold" : "font-semibold"}>{value.toFixed(digits)}{unit}</span>
      </span>
    </div>
  );
}

function SliderRow({ id, label, value, base, min, max, step, format, onChange, disabled }: {
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

export function ScenarioStudio({ report, solution, scenario, onChange, onRerun, rerunPending, rerunError, engineDiff }: ScenarioStudioProps) {
  const [tab, setTab] = useState<"site" | "signal" | "access">("site");
  const scenarioReport = solution.report;
  const tg = report.tripGeneration;
  const baseRows = useMemo(() => new Map(report.affectedIntersections.map((r) => [r.signalId, r])), [report]);
  const scenRows = useMemo(() => new Map(scenarioReport.affectedIntersections.map((r) => [r.signalId, r])), [scenarioReport]);
  const selectedId = scenario.selectedSignalId;
  const baseRow = selectedId ? baseRows.get(selectedId) ?? null : null;
  const scenRow = selectedId ? scenRows.get(selectedId) ?? null : null;

  // A map click lands on the Signal tab.
  useEffect(() => { if (selectedId) setTab("signal"); }, [selectedId]);

  const set = (patch: Partial<ScenarioState>) => onChange({ ...scenario, ...patch });
  const setTiming = (id: string, edit: SignalTimingEdit | null) => {
    const timing = { ...scenario.timing };
    if (edit) timing[id] = edit; else delete timing[id];
    set({ timing });
  };

  const dirty = isScenarioDirty(scenario);
  const clientDirty = isClientScenarioDirty(scenario);
  const canRerun = typeof onRerun === "function";
  const fallbackRows = solution.rowFallbacks.size;
  const fallbackKinds = useMemo(() => {
    const s = new Set<RowFallback>();
    for (const v of solution.rowFallbacks.values()) for (const f of v) if (f !== "baseOnly") s.add(f);
    return [...s];
  }, [solution]);

  // ---- Site tab values ----
  const size = scenario.size ?? tg.size;
  const passBy = scenario.passByPct ?? report.passByPctApplied;
  const ic = scenario.internalCapturePct ?? report.internalCapturePctApplied;
  const growth = scenario.growthRatePct ?? report.growthAppliedPct;
  const weather = scenario.weather ?? report.weather;
  const sizeMax = Math.max(10, Math.ceil(tg.size * 3));
  const sizeStep = tg.size >= 1000 ? 10 : tg.size >= 100 ? 5 : 1;
  const pm = solution.externalTrips.pm_peak;
  const am = solution.externalTrips.am_peak;

  // ---- Signal tab values ----
  const edit: SignalTimingEdit | null = selectedId
    ? scenario.timing[selectedId] ?? (baseRow ? timingEditFromRow(baseRow) : null)
    : null;
  const overridden = !!(selectedId && scenario.timing[selectedId]);
  const timing = scenRow?.signalTiming;
  const nsShare = edit ? edit.nsThroughSplitS / Math.max(1, throughBudgetS(edit)) : 0.5;
  const pedNs = timing?.pedMinGreenNsSec, pedEw = timing?.pedMinGreenEwSec;
  const pedShort = edit && ((pedNs !== undefined && edit.nsThroughSplitS - LOST_TIME_S < pedNs) || (pedEw !== undefined && edit.ewThroughSplitS - LOST_TIME_S < pedEw));
  const rowFallbacks = selectedId ? [...(solution.rowFallbacks.get(selectedId) ?? [])] : [];

  const sendToEngine = () => { if (onRerun) onRerun(toWhatIfRequest(report, scenario)); };

  return (
    <div className="flex flex-col gap-3 min-w-0 lg:border-l lg:pl-4" data-testid="scenario-studio">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">Scenario studio</div>
          <div className="text-xs text-muted-foreground">Edits re-solve with the engine's own row math.</div>
        </div>
        {dirty && (
          <button type="button" onClick={() => onChange({ ...EMPTY_SCENARIO, selectedSignalId: scenario.selectedSignalId, applyToReport: scenario.applyToReport })} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted" data-testid="button-scenario-reset">
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "site" | "signal" | "access")}>
        <TabsList className="w-full">
          <TabsTrigger value="site" className="flex-1" data-testid="tab-scenario-site">Site</TabsTrigger>
          <TabsTrigger value="signal" className="flex-1" data-testid="tab-scenario-signal">Signal</TabsTrigger>
          {canRerun && <TabsTrigger value="access" className="flex-1" data-testid="tab-scenario-access">Access</TabsTrigger>}
        </TabsList>

        <TabsContent value="site" className="space-y-4">
          <SliderRow id="scenario-size" label={`Size (${tg.unitShort ?? tg.unit})`} value={size} base={tg.size} min={sizeStep} max={sizeMax} step={sizeStep} format={(v) => v.toLocaleString()} onChange={(v) => set({ size: v === tg.size ? null : v })} />
          <SliderRow id="scenario-passby" label="Pass-by" value={passBy} base={report.passByPctApplied} min={0} max={70} step={1} format={(v) => `${v.toFixed(0)}%`} onChange={(v) => set({ passByPct: v === report.passByPctApplied ? null : v })} />
          <SliderRow id="scenario-ic" label="Internal capture" value={ic} base={report.internalCapturePctApplied} min={0} max={50} step={1} format={(v) => `${v.toFixed(0)}%`} onChange={(v) => set({ internalCapturePct: v === report.internalCapturePctApplied ? null : v })} />
          <SliderRow id="scenario-growth" label={`Background growth (${report.growthYears} yr)`} value={growth} base={report.growthAppliedPct} min={-5} max={6} step={0.25} format={(v) => `${v.toFixed(2)}%/yr`} onChange={(v) => set({ growthRatePct: v === report.growthAppliedPct ? null : v })} />
          <div className="space-y-1">
            <label htmlFor="scenario-weather" className="text-xs font-medium">Weather</label>
            <select id="scenario-weather" value={weather} onChange={(e) => { const v = e.target.value as TisWeather; set({ weather: v === report.weather ? null : v }); }} className="w-full rounded-md border bg-background px-2 py-1 text-xs" data-testid="select-scenario-weather">
              {WEATHER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label} (capacity ×{o.cap.toFixed(2)})</option>)}
            </select>
          </div>
          <div className="space-y-1 border-t pt-3">
            {pm && <Readout label="PM external trips" base={pm.base} value={pm.scenario} />}
            {am && <Readout label="AM external trips" base={am.base} value={am.scenario} />}
            <Readout label="LOS drops" base={report.intersectionsWithLosDrop} value={scenarioReport.intersectionsWithLosDrop} />
            <Readout label="At LOS E or F" base={report.intersectionsAtLosEf} value={scenarioReport.intersectionsAtLosEf} warnAbove={0} />
            <Readout label="Worst delay Δ" base={report.worstDelayDeltaSec} value={scenarioReport.worstDelayDeltaSec} unit="s" digits={1} warnAbove={5} />
            {report.worstDelayDeltaDesignSec !== undefined && scenarioReport.worstDelayDeltaDesignSec !== undefined && (
              <Readout label="Worst design-year Δ" base={report.worstDelayDeltaDesignSec} value={scenarioReport.worstDelayDeltaDesignSec} unit="s" digits={1} warnAbove={5} />
            )}
          </div>
          {solution.distributionHeld && (
            <div className="text-[11px] text-muted-foreground" data-testid="note-distribution-held">
              Trip distribution and turn ledgers held at the base study; the road network only re-solves in the engine.
            </div>
          )}
        </TabsContent>

        <TabsContent value="signal" className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="scenario-signal" className="text-xs font-medium">Signal</label>
            <select id="scenario-signal" value={selectedId ?? ""} onChange={(e) => set({ selectedSignalId: e.target.value || null })} className="w-full rounded-md border bg-background px-2 py-1 text-xs" data-testid="select-scenario-signal">
              <option value="">Click a signal on the map, or pick one</option>
              {report.affectedIntersections.map((r) => (
                <option key={r.signalId} value={r.signalId}>{r.name}{scenario.timing[r.signalId] ? " (edited)" : ""}</option>
              ))}
            </select>
          </div>
          {baseRow && scenRow && edit && (
            <>
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <div className="font-medium truncate" title={baseRow.name}>{baseRow.name}</div>
                  <div className="text-muted-foreground font-mono text-[11px]">{baseRow.signalId} · {baseRow.distanceMi.toFixed(2)} mi · +{scenRow.addedTripsPmPeak} PM trips</div>
                </div>
                <div className="flex items-center gap-1 shrink-0" data-testid="signal-los-readout">
                  <LosBadge los={baseRow.futureLos} size="sm" />
                  <span className="text-muted-foreground">→</span>
                  <LosBadge los={scenRow.futureLos} size="sm" />
                </div>
              </div>
              <div className="space-y-1">
                <Readout label="Build delay" base={baseRow.futureDelaySec} value={scenRow.futureDelaySec} unit="s" digits={1} />
                <Readout label="No-build delay" base={baseRow.existingDelaySec} value={scenRow.existingDelaySec} unit="s" digits={1} />
                <Readout label="Build v/c" base={baseRow.futureVc} value={scenRow.futureVc} digits={2} warnAbove={0.95} />
                <Readout label="95th-pct queue" base={baseRow.queue95thFt} value={scenRow.queue95thFt} unit=" ft" digits={0} />
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Mitigation</span>
                  <span className="font-mono">{baseRow.mitigationSeverity !== scenRow.mitigationSeverity && <span className="text-muted-foreground">{baseRow.mitigationSeverity} → </span>}<span className="font-semibold">{scenRow.mitigationSeverity}</span></span>
                </div>
              </div>

              <div className="border-t pt-3 space-y-3">
                <SliderRow id="scenario-cycle" label="Cycle" value={edit.cycleLenSec} base={baseRow.signalTiming?.cycleLenSec} min={30} max={300} step={5} format={(v) => `${v.toFixed(0)} s`} onChange={(v) => setTiming(baseRow.signalId, withCycle(edit, v))} />
                <SliderRow id="scenario-ns-share" label="Through split · NS share" value={Math.round(nsShare * 100)} min={Math.ceil((MIN_SPLIT_S / Math.max(1, throughBudgetS(edit))) * 100)} max={Math.floor(100 - (MIN_SPLIT_S / Math.max(1, throughBudgetS(edit))) * 100)} step={1}
                  format={(v) => `NS ${v.toFixed(0)}% / EW ${(100 - v).toFixed(0)}%`} onChange={(v) => setTiming(baseRow.signalId, withNsShare(edit, v / 100))} />
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
                        <label htmlFor={`scenario-left-${axis}`} className="font-medium">Protected left · {axis.toUpperCase()}</label>
                        <Switch id={`scenario-left-${axis}`} checked={on} onCheckedChange={(v) => setTiming(baseRow.signalId, withProtectedLeft(edit, axis, v))} data-testid={`switch-scenario-left-${axis}`} />
                      </div>
                      {on && split !== undefined && (
                        <SliderRow id={`scenario-left-split-${axis}`} label={`${axis.toUpperCase()} left split`} value={split} min={MIN_SPLIT_S} max={maxLeft} step={1} format={(v) => `${v.toFixed(0)} s`} onChange={(v) => setTiming(baseRow.signalId, withLeftSplit(edit, axis, v))} />
                      )}
                    </div>
                  );
                })}
                {(pedNs !== undefined || pedEw !== undefined) && (
                  <div className={`text-[11px] ${pedShort ? "text-amber-600" : "text-muted-foreground"}`} data-testid="note-ped-minimum">
                    Pedestrian minimum green: NS {pedNs?.toFixed(1) ?? "—"} s, EW {pedEw?.toFixed(1) ?? "—"} s{pedShort ? " — a through split is below its walk time plus lost time." : "."}
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <button type="button" onClick={() => setTiming(baseRow.signalId, null)} disabled={!overridden} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50" data-testid="button-scenario-webster">
                    <RotateCcw className="w-3 h-3" /> Webster optimum
                  </button>
                  <div className="text-[11px] text-muted-foreground text-right" data-testid="signal-timing-provenance">
                    {timing ? (
                      timing.source === "override"
                        ? `Your plan · ${timing.cycleLenSec} s · ${timing.criticalPhases} critical phases`
                        : `${BASIS_LABEL[timing.basis] ?? timing.basis} · ${timing.cycleLenSec} s`
                    ) : "Screening basis (no timing resolved)"}
                  </div>
                </div>
              </div>

              <div className="border-t pt-3 overflow-x-auto">
                <ApproachDetailTable approaches={scenRow.approaches} />
              </div>
              {rowFallbacks.length > 0 && (
                <div className="text-[11px] text-muted-foreground" data-testid="signal-fallbacks">
                  Reconstructed from the printed report: {rowFallbacks.map((f) => FALLBACK_LABEL[f]).join("; ")}.
                </div>
              )}
            </>
          )}
        </TabsContent>

        {canRerun && (
          <TabsContent value="access" className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Driveways reroute trips on the road network, so the engine re-runs the whole scenario — nothing here changes the map until it does.
            </div>
            <DrivewayEditor
              site={{ latitude: report.request.latitude, longitude: report.request.longitude }}
              driveways={scenario.driveways ?? report.request.driveways ?? []}
              onChange={(d) => set({ driveways: d })}
            />
            <button type="button" onClick={sendToEngine} disabled={!!rerunPending} className="inline-flex items-center gap-1.5 rounded-md bg-foreground text-background px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-50" data-testid="button-scenario-rerun">
              {rerunPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</> : <><Send className="w-3.5 h-3.5" /> Re-run with the engine</>}
            </button>
          </TabsContent>
        )}
      </Tabs>

      <div className="border-t pt-3 space-y-2">
        {canRerun && clientDirty && tab !== "access" && (
          <button type="button" onClick={sendToEngine} disabled={!!rerunPending} className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50" data-testid="button-scenario-send">
            {rerunPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running in the engine…</> : <><Send className="w-3.5 h-3.5" /> Send to engine</>}
          </button>
        )}
        {rerunError && (
          <div className="flex items-start gap-1.5 text-xs text-red-700 dark:text-red-300" data-testid="scenario-rerun-error">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>{rerunError}</span>
          </div>
        )}
        {engineDiff && (
          <div className="text-[11px] text-muted-foreground font-mono tabular-nums" data-testid="scenario-engine-diff">
            {engineDiff.maxDelayDeltaSec === 0 && engineDiff.maxVcDelta === 0 && engineDiff.losMismatches === 0
              ? `Engine vs client: 0 differences over ${engineDiff.rows} rows.`
              : `Engine vs client: max Δ delay ${engineDiff.maxDelayDeltaSec.toFixed(1)} s, max Δ v/c ${engineDiff.maxVcDelta.toFixed(2)}, ${engineDiff.losMismatches} LOS mismatch${engineDiff.losMismatches === 1 ? "" : "es"} over ${engineDiff.rows} rows.`}
          </div>
        )}
        <div className="text-[11px] text-muted-foreground" data-testid="scenario-provenance">
          {fallbackRows === 0
            ? "Exact: every row rebuilt from the engine's own inputs."
            : `${fallbackRows} of ${report.affectedIntersections.length} rows reconstructed from the printed report (${fallbackKinds.map((f) => FALLBACK_LABEL[f]).join("; ")}); within ±0.2 s of the engine, exact once the study is regenerated.`}
          {solution.reportFallbacks.has("jurisdiction") ? " Planning office read from the base summary." : ""}
          {solution.baseOnly.size > 0 ? ` ${solution.baseOnly.size} row(s) held at base.` : ""}
        </div>
      </div>
    </div>
  );
}
