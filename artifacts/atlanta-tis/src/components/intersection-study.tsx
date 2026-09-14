/**
 * IntersectionStudy — one signal, opened as its own study (spec §3.2a).
 *
 * A full-screen view over the report (a portal into <body>, above the site
 * nav, `role="dialog"`, Escape closes, focus moves in and returns), with its
 * own scroll, a sticky "On this page" § nav and seven sections in the
 * drawing-set language the report itself uses:
 *
 *   §00 Summary            the verdict strip: LOS no-build → build, delay,
 *                          v/c, worst queue, project trips, mitigation
 *                          severity, timing basis
 *   §01 Approaches & lanes the plan view, the approach table, project trips
 *                          by movement, the lane statement (imported lane
 *                          groups, or the honest default)
 *   §02 Queuing            each approach's 95th-percentile queue against
 *                          storage on record, and the queue-forming lane
 *                          (queue-animation.tsx) parameterised with THAT
 *                          approach's vph, capacity, cycle, green and storage
 *   §03 Signal timing      the plan in use (base → scenario), its splits, and
 *                          the Webster optimum for comparison
 *   §04 Simulation         the single-junction micro-simulation
 *                          (intersection-sim-view.tsx)
 *   §05 What-if            the studio's Signal controls (signal-controls.tsx)
 *                          for this signal — an edit re-solves the whole page
 *                          through the same solveScenario the studio uses
 *   §06 Mitigation & method  verdict, turbo-lane screen, method notes
 *
 * Every number is the report row's, or the studio's re-solve of it with the
 * engine's own row math (`intersection-study-model.ts` builds the sections
 * and `check:intersection-study` walks them for every studied row). With a
 * scenario row the page draws the scenario and shows base → scenario pairs
 * wherever a printed value differs.
 *
 * URL state (`?signal=<signalId>`) belongs to the page that mounts this
 * (pages/tis.tsx): opening pushes history, Close / Escape / back pops it.
 *
 * Print: while the study is open only the study prints — the rules at the
 * bottom hide every other child of <body> — one intersection per print.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TisReport, TisAffectedIntersection } from "@workspace/tis-api-client-react";
import { X, Printer, ArrowRight } from "lucide-react";
import { Marker } from "@/components/section-marker";
import { LosBadge, SEVERITY_CONFIG, ApproachDetailTable, MovementsGrid } from "@/components/tis-report-bits";
import { IntersectionPlan } from "@/components/intersection-plan";
import { Pair, Stat, ScenarioDelta, TimingBlock, LanesSection, QueueBar, BASIS_LABEL, LEFT_SOURCE_LABEL } from "@/components/intersection-explorer";
import { IntersectionSimView } from "@/components/intersection-sim-view";
import { QueueLaneAnimation, type QueueLaneInputs } from "@/components/queue-animation";
import { SignalControls } from "@/components/signal-controls";
import { studyModelFromRow, SECTIONS, type IntersectionStudyModel, type QueueApproachModel, type SectionId } from "@/lib/intersection-study-model";
import { QUEUE_FT_PER_VEH } from "@/lib/intersection-geometry";
import { type ScenarioState, type SignalTimingEdit, baseOverridesBySignal } from "@/lib/scenario-solve";

export type IntersectionStudyProps = {
  /** The base report (its rows, weather factor, base overrides). */
  report: TisReport;
  /** The base row for the studied signal. */
  row: TisAffectedIntersection;
  /** The scenario re-solve of the same row when the studio has client edits. */
  scenarioRow?: TisAffectedIntersection | null;
  scenario: ScenarioState;
  onScenarioChange: (next: ScenarioState) => void;
  onClose: () => void;
};

const round1 = (x: number) => Math.round(x * 10) / 10;

function SectionHeader({ id, n, label }: { id: SectionId; n: string; label: string }) {
  return (
    <div id={`study-${id}-title`}>
      <Marker n={n} label={label} />
    </div>
  );
}

export function IntersectionStudy({ report, row, scenarioRow, scenario, onScenarioChange, onClose }: IntersectionStudyProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState<SectionId>("summary");
  const weatherFactor = report.weatherFactorExact ?? report.weatherCapacityFactor;
  const model: IntersectionStudyModel = useMemo(
    () => studyModelFromRow(row, scenarioRow ?? null, { weatherFactor }),
    [row, scenarioRow, weatherFactor],
  );
  const drawn = scenarioRow ?? row;
  const plan = model.plan;
  const s = model.summary;
  const sev = SEVERITY_CONFIG[s.severity] ?? SEVERITY_CONFIG.none!;
  const SevIcon = sev.icon;
  const baseSev = s.base && s.base.severity !== s.severity ? SEVERITY_CONFIG[s.base.severity] ?? SEVERITY_CONFIG.none! : null;

  // ---- dialog behaviour: focus in/out, Escape, body scroll lock, print class ----
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    body.classList.add("intersection-study-open");
    closeRef.current?.focus();
    // The listener reads the latest onClose through the ref, so it is bound once.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); } };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      body.style.overflow = prevOverflow;
      body.classList.remove("intersection-study-open");
      previous?.focus?.();
    };
  }, []);

  // A new signal in the same open study starts at the top.
  useEffect(() => { rootRef.current?.scrollTo({ top: 0 }); setActive("summary"); }, [model.signalId]);

  // Active section for the § nav.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const els = SECTIONS.map((sec) => root.querySelector<HTMLElement>(`#study-${sec.id}`)).filter((el): el is HTMLElement => !!el);
    const obs = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      const first = visible[0];
      if (first) setActive((first.target as HTMLElement).dataset.section as SectionId);
    }, { root, rootMargin: "-15% 0px -70% 0px", threshold: 0 });
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [model.signalId]);

  const jump = (id: SectionId) => {
    const el = rootRef.current?.querySelector<HTMLElement>(`#study-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(id);
  };

  // ---- §05: the same timing-edit semantics as the studio's Signal tab ----
  const baseOverrides = useMemo(() => baseOverridesBySignal(report), [report]);
  const id = row.signalId;
  const edit: SignalTimingEdit | null = scenario.timing[id] ?? model.whatIf.edit;
  const overridden = !!scenario.timing[id];
  const baseOverridden = baseOverrides.has(id);
  const cleared = scenario.timing[id] === null;
  const canReset = overridden || (baseOverridden && !cleared);
  const setTiming = (next: SignalTimingEdit | null | undefined) => {
    const timing = { ...scenario.timing };
    if (next === undefined) delete timing[id]; else timing[id] = next;
    onScenarioChange({ ...scenario, timing });
  };

  const queueScaleFt = model.queuing.reduce((m, q) => Math.max(m, q.q95Ft, q.storageFt ?? 0), 1);
  const laneInputs = (q: QueueApproachModel): QueueLaneInputs => ({
    arrivalVph: Math.round(q.arrivalVph),
    arrivalPerLaneVph: q.arrivalPerLaneVph,
    laneCount: q.lanes,
    satFlowVphpl: q.satFlowVphpl,
    cycleSec: q.cycleSec,
    effectiveGreenSec: round1(q.effectiveGreenSec),
    spacingFt: QUEUE_FT_PER_VEH,
    capacityPerLaneVph: q.capacityPerLaneVph,
    vOverC: q.vOverC,
    queue: {
      averageVehicles: round1(q.avgQueueVeh),
      averageFt: Math.round(q.avgQueueFt),
      averageSource: "engine Q1",
      p95Vehicles: round1(q.q95Veh),
      p95Ft: Math.round(q.q95Ft),
    },
    storage: { availableFt: q.storageFt, verdict: q.verdict },
    title: `${q.direction} approach · one lane`,
    captionPrefix: `${q.direction} build`,
    testId: `anim-queue-${q.direction}`,
  });

  const w = model.timing.webster;
  const t = model.timing.current;
  const turbo = model.mitigation.turboLane;

  const node = (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="study-title"
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-background text-foreground"
      data-intersection-study-root=""
      data-testid="intersection-study"
      data-signal-id={model.signalId}
    >
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 print:static print:bg-white">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Intersection study{model.scenario ? " · scenario" : ""} · {report.request.projectName}
            </div>
            <h1 id="study-title" className="text-base sm:text-lg font-semibold truncate" title={model.name} data-testid="study-name">{model.name}</h1>
            <div className="text-xs text-muted-foreground font-mono">{model.signalId} · {model.distanceMi.toFixed(2)} mi · {model.zone} · +{s.addedTrips} PM trips</div>
          </div>
          <div className="flex items-center gap-2 shrink-0 print:hidden">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"
              title="Print this intersection's study on its own"
              data-testid="button-study-print"
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"
              aria-label="Close the intersection study"
              data-testid="button-study-close"
            >
              <X className="w-3.5 h-3.5" /> Close
            </button>
          </div>
        </div>
        <nav aria-label="On this page" className="lg:hidden border-t overflow-x-auto print:hidden">
          <ol className="max-w-6xl mx-auto px-4 flex gap-4 py-1.5 font-mono text-[11px] whitespace-nowrap">
            {SECTIONS.map((sec) => (
              <li key={sec.id}>
                <button type="button" onClick={() => jump(sec.id)} className={active === sec.id ? "text-blue-700 dark:text-blue-300 font-semibold" : "text-muted-foreground"} aria-current={active === sec.id ? "true" : undefined}>
                  §{sec.n} {sec.label}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 lg:grid lg:grid-cols-[190px_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="On this page" className="hidden lg:block sticky top-24 self-start print:hidden" data-testid="study-nav">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-3">On this page</div>
          <ol className="space-y-1.5 font-mono text-[11px]">
            {SECTIONS.map((sec) => (
              <li key={sec.id}>
                <button
                  type="button"
                  onClick={() => jump(sec.id)}
                  className={`flex items-baseline gap-2 text-left w-full ${active === sec.id ? "text-blue-700 dark:text-blue-300 font-semibold" : "text-muted-foreground hover:text-foreground"}`}
                  aria-current={active === sec.id ? "true" : undefined}
                  data-testid={`study-nav-${sec.id}`}
                >
                  <span className="tabular-nums">§{sec.n}</span>
                  <span className="font-sans text-xs">{sec.label}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="mt-6 text-[11px] text-muted-foreground leading-snug font-sans">
            {model.scenario ? "Drawn from the scenario re-solve; base → scenario pairs wherever a value differs." : "Drawn from the report's own row for this signal."}
          </div>
        </nav>

        <main className="space-y-14 min-w-0">
          {/* §00 */}
          <section id="study-summary" data-section="summary" aria-labelledby="study-summary-title" className="scroll-mt-24 break-inside-avoid" data-testid="study-section-summary">
            <SectionHeader id="summary" n="00" label="Summary" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4 rounded-lg border p-4">
              <Stat label="LOS no-build → build" testId="study-los">
                {s.base && (s.base.los.noBuild !== s.los.noBuild || s.base.los.build !== s.los.build) && (
                  <span className="flex items-center gap-1 text-muted-foreground opacity-70">
                    <LosBadge los={s.base.los.noBuild} size="sm" /> → <LosBadge los={s.base.los.build} size="sm" />
                    <span className="mx-1">⇒</span>
                  </span>
                )}
                <LosBadge los={s.los.noBuild} size="sm" /> <span className="text-muted-foreground">→</span> <LosBadge los={s.los.build} size="sm" />
              </Stat>
              <Stat label="Control delay (build)" testId="study-delay">
                <Pair base={s.base?.delay.build} value={s.delay.build} digits={1} unit=" s" />
                <span className="text-muted-foreground">(no-build <Pair base={s.base?.delay.noBuild} value={s.delay.noBuild} digits={1} unit=" s" />)</span>
              </Stat>
              <Stat label="v/c (build)" testId="study-vc">
                <Pair base={s.base?.vc.build} value={s.vc.build} digits={2} />
                <span className="text-muted-foreground">(no-build <Pair base={s.base?.vc.noBuild} value={s.vc.noBuild} digits={2} />)</span>
              </Stat>
              <Stat label="Worst 95th-pct queue" testId="study-queue">
                <Pair base={s.base?.worstQueueFt} value={s.worstQueueFt} digits={0} unit=" ft" />
              </Stat>
              <Stat label="Project trips (PM)" testId="study-trips">
                <Pair base={s.base?.addedTrips} value={s.addedTrips} digits={0} />
              </Stat>
              <Stat label="Mitigation" testId="study-severity">
                {baseSev && <span className={`inline-flex items-center gap-1 ${baseSev.color} opacity-70`}>{baseSev.label} <span className="text-muted-foreground">→</span></span>}
                <span className={`inline-flex items-center gap-1 font-medium ${sev.color}`}><SevIcon className="w-3.5 h-3.5" />{sev.label}</span>
              </Stat>
              <Stat label="Timing basis" testId="study-timing-basis">
                <span className="leading-snug">{s.timingBasis}{s.base && s.base.timingBasis !== s.timingBasis ? <span className="text-muted-foreground"> (was {s.base.timingBasis})</span> : null}</span>
              </Stat>
              <Stat label="LOS changed" testId="study-los-changed">
                <span className={s.losChanged ? "text-amber-600 font-medium" : "text-muted-foreground"}>{s.losChanged ? "yes — a grade drops with the project" : "no"}</span>
              </Stat>
            </div>
            <p className="mt-3 text-xs text-muted-foreground max-w-prose">
              {model.scenario
                ? "This page draws the scenario studio's re-solve of this signal — the engine's own row math on the edited inputs — with the base study's value beside every figure that moved."
                : "Every figure on this page is the report's own row for this signal; the sections below take it apart — lanes, queues, timing, a simulation and a what-if — without estimating anything the report does not carry."}
            </p>
          </section>

          {/* §01 */}
          <section id="study-approaches" data-section="approaches" aria-labelledby="study-approaches-title" className="scroll-mt-24" data-testid="study-section-approaches">
            <SectionHeader id="approaches" n="01" label="Approaches & lanes" />
            <div className="grid gap-6 lg:grid-cols-2 items-start">
              <IntersectionPlan plan={plan} />
              <div className="space-y-4 min-w-0">
                <div className="overflow-x-auto">
                  <ApproachDetailTable approaches={drawn.approaches} />
                </div>
                {model.scenario && <ScenarioDelta plan={plan} changed={plan.approaches.filter((a) => a.changed)} />}
                <MovementsGrid row={drawn} />
              </div>
            </div>
            <div className="mt-6 border-t pt-4">
              <LanesSection plan={plan} />
            </div>
          </section>

          {/* §02 */}
          <section id="study-queuing" data-section="queuing" aria-labelledby="study-queuing-title" className="scroll-mt-24" data-testid="study-section-queuing">
            <SectionHeader id="queuing" n="02" label="Queuing" />
            <p className="text-xs text-muted-foreground max-w-prose mb-3">
              Each approach's 95th-percentile back-of-queue (build) against the storage the report carries for it, on one scale; then the
              queue-forming lane those numbers imply — the Webster cyclic queue of the queuing study, parameterised with this approach's
              volume, the engine's capacity for it (s × g/C × lanes{weatherFactor !== undefined && weatherFactor !== 1 ? ` × weather ${weatherFactor.toFixed(2)}` : ""}), its cycle and effective green.
            </p>
            {model.queuing.length === 0 ? (
              <div className="text-xs text-muted-foreground">No approach detail on this row.</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" data-testid="study-queue-table">
                    <thead>
                      <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                        <th className="text-left py-1 pr-2 font-medium">Approach</th>
                        <th className="text-right py-1 px-2 font-medium">Lanes</th>
                        <th className="text-right py-1 px-2 font-medium">Build vph</th>
                        <th className="text-right py-1 px-2 font-medium">Capacity vph</th>
                        <th className="text-right py-1 px-2 font-medium">v/c</th>
                        <th className="text-right py-1 px-2 font-medium">g/C</th>
                        <th className="text-right py-1 px-2 font-medium">Q95</th>
                        <th className="text-right py-1 px-2 font-medium">Storage</th>
                        <th className="text-left py-1 px-2 font-medium">Queue vs storage</th>
                        <th className="text-center py-1 pl-2 font-medium">Flag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.queuing.map((q) => {
                        const a = plan.approaches.find((x) => x.direction === q.direction);
                        return (
                          <tr key={q.direction} className="border-b last:border-0" data-testid={`study-queue-${q.direction}`}>
                            <td className="py-1 pr-2 font-mono font-semibold">{q.direction}</td>
                            <td className="py-1 px-2 text-right font-mono tabular-nums">{q.lanes}<span className="text-muted-foreground"> {q.lanesSource === "default" ? "default" : q.lanesSource}</span></td>
                            <td className="py-1 px-2 text-right font-mono tabular-nums"><Pair base={a?.base?.vph.build} value={q.arrivalVph} digits={0} /></td>
                            <td className="py-1 px-2 text-right font-mono tabular-nums">{q.capacityVph.toFixed(0)}</td>
                            <td className={`py-1 px-2 text-right font-mono tabular-nums ${q.vOverC >= 0.95 ? "text-red-600 font-semibold" : q.vOverC >= 0.85 ? "text-amber-600" : ""}`}><Pair base={a?.base?.vc.build} value={q.vOverC} digits={2} /></td>
                            <td className="py-1 px-2 text-right font-mono tabular-nums">{q.gOverC.toFixed(3)}</td>
                            <td className="py-1 px-2 text-right font-mono tabular-nums whitespace-nowrap"><Pair base={a?.base?.queue95Ft} value={q.q95Ft} digits={0} unit=" ft" /> <span className="text-muted-foreground">({q.q95Veh.toFixed(1)} veh)</span></td>
                            <td className="py-1 px-2 text-right font-mono tabular-nums">{q.storageFt !== null ? `${q.storageFt} ft` : <span className="text-muted-foreground">none on record</span>}</td>
                            <td className="py-1 px-2"><QueueBar queueFt={q.q95Ft} storageFt={q.storageFt ?? undefined} scaleFt={queueScaleFt} deficient={q.storageDeficient ?? undefined} width={140} /></td>
                            <td className={`py-1 pl-2 text-center font-mono ${q.verdict === "fail" ? "text-red-600 font-semibold" : q.verdict === "pass" ? "text-emerald-600" : "text-muted-foreground"}`}>
                              {q.verdict === "fail" ? "queue exceeds storage" : q.verdict === "pass" ? "fits" : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="text-[11px] text-muted-foreground mt-1 mb-4">
                  Bars share one scale ({queueScaleFt.toFixed(0)} ft); the outline is the storage on record and the red run the queue past it. "None on record" means the report
                  carries no bay length for this approach — nothing is compared, nothing is flagged. {QUEUE_FT_PER_VEH} ft per queued vehicle, the engine's own constant.
                  {model.queuing.some((q) => q.timingAssumed) ? " Capacity here uses the screening default (90 s, g/C 0.45) because the row carries no timing plan." : ""}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {model.queuing.map((q) => (
                    <QueueLaneAnimation key={`${model.signalId}-${q.direction}`} {...laneInputs(q)} />
                  ))}
                </div>
                <div className="text-[11px] text-muted-foreground mt-2">
                  The "engine Q1" beside each end-of-red mean is the engine's average back-of-queue, Q95 ÷ 1.65 — its own Poisson factor (signal-delay.ts queue95Ft) — not a separate measurement.
                </div>
              </>
            )}
          </section>

          {/* §03 */}
          <section id="study-timing" data-section="timing" aria-labelledby="study-timing-title" className="scroll-mt-24 break-inside-avoid" data-testid="study-section-timing">
            <SectionHeader id="timing" n="03" label="Signal timing" />
            <div className="grid gap-6 lg:grid-cols-2 items-start">
              <div className="space-y-4">
                <TimingBlock timing={model.timing.current} base={model.timing.base} changed={model.timing.changed} />
                {t && model.timing.splits && (
                  <div className="space-y-1" data-testid="study-splits">
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Phase splits (green + {model.timing.lostTimePerPhaseS} s lost time)</div>
                    <table className="text-xs">
                      <thead>
                        <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                          <th className="text-left py-1 pr-3 font-medium">Phase</th>
                          <th className="text-right py-1 px-3 font-medium">Split</th>
                          <th className="text-right py-1 px-3 font-medium">Effective green</th>
                          <th className="text-right py-1 pl-3 font-medium">g/C</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono tabular-nums">
                        {model.timing.splits.nsLeft !== undefined && <tr className="border-b"><td className="py-1 pr-3">NS protected left</td><td className="py-1 px-3 text-right">{model.timing.splits.nsLeft.toFixed(1)} s</td><td className="py-1 px-3 text-right">{((t.gOverC.nsLeft ?? 0) * t.cycleLenSec).toFixed(1)} s</td><td className="py-1 pl-3 text-right">{(t.gOverC.nsLeft ?? 0).toFixed(3)}</td></tr>}
                        <tr className="border-b"><td className="py-1 pr-3">NS through</td><td className="py-1 px-3 text-right">{model.timing.splits.ns.toFixed(1)} s</td><td className="py-1 px-3 text-right">{(t.gOverC.ns * t.cycleLenSec).toFixed(1)} s</td><td className="py-1 pl-3 text-right">{t.gOverC.ns.toFixed(3)}</td></tr>
                        {model.timing.splits.ewLeft !== undefined && <tr className="border-b"><td className="py-1 pr-3">EW protected left</td><td className="py-1 px-3 text-right">{model.timing.splits.ewLeft.toFixed(1)} s</td><td className="py-1 px-3 text-right">{((t.gOverC.ewLeft ?? 0) * t.cycleLenSec).toFixed(1)} s</td><td className="py-1 pl-3 text-right">{(t.gOverC.ewLeft ?? 0).toFixed(3)}</td></tr>}
                        <tr className="border-b"><td className="py-1 pr-3">EW through</td><td className="py-1 px-3 text-right">{model.timing.splits.ew.toFixed(1)} s</td><td className="py-1 px-3 text-right">{(t.gOverC.ew * t.cycleLenSec).toFixed(1)} s</td><td className="py-1 pl-3 text-right">{t.gOverC.ew.toFixed(3)}</td></tr>
                        <tr><td className="py-1 pr-3 text-muted-foreground">Cycle</td><td className="py-1 px-3 text-right font-semibold">{t.cycleLenSec} s</td><td className="py-1 px-3 text-right text-muted-foreground">{t.criticalPhases} phases × {model.timing.lostTimePerPhaseS} s lost</td><td /></tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="space-y-2 rounded-lg border p-4" data-testid="study-webster">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Webster optimum, for comparison</div>
                <div className="text-xs text-muted-foreground">
                  The engine's own computeSignalTiming on this row's printed no-build volumes and lane counts:
                </div>
                <div className="font-mono text-xs tabular-nums space-y-0.5">
                  <div>Cycle <span className="font-semibold">{w.cycleLenS} s</span> · {w.criticalPhases} critical phases · Y {w.criticalFlowRatio.toFixed(2)}</div>
                  <div>NS through g/C {w.gOverCns.toFixed(3)}{w.gOverCnsLeft !== undefined ? ` · NS left g/C ${w.gOverCnsLeft.toFixed(3)}` : ""}</div>
                  <div>EW through g/C {w.gOverCew.toFixed(3)}{w.gOverCewLeft !== undefined ? ` · EW left g/C ${w.gOverCewLeft.toFixed(3)}` : ""}</div>
                  <div className="text-muted-foreground">Lefts NS {w.leftPhasing.ns} · EW {w.leftPhasing.ew} · {LEFT_SOURCE_LABEL[w.leftPhasingSource] ?? w.leftPhasingSource} · ped min NS {w.pedMinGreenS.ns.toFixed(1)} s, EW {w.pedMinGreenS.ew.toFixed(1)} s</div>
                  <div className="text-muted-foreground">Basis {BASIS_LABEL[w.basis] ?? w.basis}</div>
                </div>
                <div className="text-[11px] leading-snug" data-testid="study-webster-note">
                  {model.timing.websterInUse
                    ? <span className="text-emerald-700 dark:text-emerald-300">This is the plan in use on this row.</span>
                    : t
                      ? <span className="text-muted-foreground">The plan in use is {t.source === "override" ? "your scenario plan" : BASIS_LABEL[t.basis] ?? t.basis} ({t.cycleLenSec} s); Webster's optimum is shown for comparison only and is used in no number.</span>
                      : <span className="text-muted-foreground">No plan was resolved on this row; the screening default sized its capacity.</span>}
                </div>
              </div>
            </div>
          </section>

          {/* §04 */}
          <section id="study-simulation" data-section="simulation" aria-labelledby="study-simulation-title" className="scroll-mt-24" data-testid="study-section-simulation">
            <SectionHeader id="simulation" n="04" label="Simulation" />
            <IntersectionSimView sim={model.sim} />
          </section>

          {/* §05 */}
          <section id="study-whatif" data-section="whatif" aria-labelledby="study-whatif-title" className="scroll-mt-24" data-testid="study-section-whatif">
            <SectionHeader id="whatif" n="05" label="What-if" />
            <div className="grid gap-6 lg:grid-cols-2 items-start">
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground max-w-prose">
                  The scenario studio's Signal controls for this signal. An edit becomes a timing override the engine consumes ahead of Webster;
                  every section above re-solves through the same <span className="font-mono">solveScenario</span> the studio uses — the engine's own row math, in the browser.
                  {model.scenario ? " The studio's Signal tab shows the same edit." : ""}
                </p>
                {edit ? (
                  <SignalControls
                    edit={edit}
                    baseCycleLenSec={model.whatIf.baseCycleLenSec}
                    timing={model.whatIf.timing}
                    onChange={(next) => setTiming(next)}
                    onReset={() => setTiming(baseOverridden ? null : undefined)}
                    canReset={canReset}
                    idPrefix="study"
                  />
                ) : (
                  <div className="text-xs text-muted-foreground" data-testid="study-whatif-none">No timing plan resolved on this row — there is nothing to retime.</div>
                )}
              </div>
              <div className="space-y-2 rounded-lg border p-4" data-testid="study-whatif-readout">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Base → scenario, this signal</div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Build LOS</span>
                  <LosBadge los={row.futureLos} size="sm" /> <ArrowRight className="w-3 h-3 text-muted-foreground" /> <LosBadge los={drawn.futureLos} size="sm" />
                </div>
                <Readout label="Build delay" base={row.futureDelaySec} value={drawn.futureDelaySec} unit=" s" digits={1} />
                <Readout label="No-build delay" base={row.existingDelaySec} value={drawn.existingDelaySec} unit=" s" digits={1} />
                <Readout label="Build v/c" base={row.futureVc} value={drawn.futureVc} digits={2} />
                <Readout label="Worst 95th-pct queue" base={row.queue95thFt} value={drawn.queue95thFt} unit=" ft" digits={0} />
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Mitigation</span>
                  <span className="font-mono">{row.mitigationSeverity !== drawn.mitigationSeverity && <span className="text-muted-foreground">{row.mitigationSeverity} → </span>}<span className="font-semibold">{drawn.mitigationSeverity}</span></span>
                </div>
                <div className="text-[11px] text-muted-foreground leading-snug pt-1">
                  {overridden
                    ? "Your plan is in force on this signal; \"Webster optimum\" drops it."
                    : cleared
                      ? "The base study's override on this signal is cleared; it resolves to its record or Webster."
                      : baseOverridden
                        ? "This signal's base plan is an override the engine already applied; \"Webster optimum\" clears it."
                        : "No edit on this signal yet — the sliders sit at the plan the study used."}
                </div>
              </div>
            </div>
          </section>

          {/* §06 */}
          <section id="study-mitigation" data-section="mitigation" aria-labelledby="study-mitigation-title" className="scroll-mt-24 break-inside-avoid" data-testid="study-section-mitigation">
            <SectionHeader id="mitigation" n="06" label="Mitigation & method" />
            <div className="grid gap-6 lg:grid-cols-2 items-start">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {baseSev && <span className={`inline-flex items-center gap-1 text-sm ${baseSev.color} opacity-70`}>{baseSev.label} <span className="text-muted-foreground">→</span></span>}
                  <span className={`inline-flex items-center gap-1 text-sm font-semibold ${sev.color}`}><SevIcon className="w-4 h-4" />{sev.label}</span>
                </div>
                {model.mitigation.base && model.mitigation.base.mitigation !== model.mitigation.mitigation && (
                  <div className="text-xs text-muted-foreground line-through decoration-muted-foreground/50">{model.mitigation.base.mitigation}</div>
                )}
                <div className="text-sm leading-snug" data-testid="study-mitigation-text">{model.mitigation.mitigation}</div>
                <div className="space-y-1 pt-2" data-testid="study-turbo">
                  <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Turbo-lane screen</div>
                  {turbo ? (
                    <div className="text-xs space-y-1">
                      <div className="font-mono tabular-nums">
                        Type {String(turbo.turboType ?? "?")} · {String(turbo.turboDirection ?? "")} through continuous · minor leg {String(turbo.minorLegDirection ?? "")} · {String(turbo.medianType ?? "")} median · {String(turbo.approachLanes ?? "")} → {String(turbo.turboLanes ?? "")} lanes
                      </div>
                      {typeof turbo.capacityGainPct === "number" && typeof turbo.baselineApproachDelaySec === "number" && typeof turbo.mitigatedApproachDelaySec === "number" && (
                        <div className="font-mono tabular-nums">
                          Capacity +{(turbo.capacityGainPct as number).toFixed(0)} % · approach delay {(turbo.baselineApproachDelaySec as number).toFixed(1)} → {(turbo.mitigatedApproachDelaySec as number).toFixed(1)} s · LOS {String(turbo.baselineApproachLos ?? "")} → {String(turbo.mitigatedApproachLos ?? "")}
                        </div>
                      )}
                      {typeof turbo.note === "string" && <div className="text-muted-foreground">{turbo.note}</div>}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      {model.mitigation.turboScreened
                        ? "The screen accepted this junction's geometry but printed no candidate."
                        : "The turbo-lane screen is geometry-only (a three-leg T on a divided main street); this junction's geometry returned no candidate, so no scenario can make it one."}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-1" data-testid="study-method">
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Method notes that apply to this row</div>
                <ol className="list-decimal list-inside space-y-1 text-xs text-muted-foreground leading-snug">
                  {model.mitigation.methodNotes.map((n, i) => <li key={i}>{n}</li>)}
                </ol>
              </div>
            </div>
          </section>
        </main>
      </div>

      <style>{`
        @media print {
          body.intersection-study-open > :not([data-intersection-study-root]) { display: none !important; }
          [data-intersection-study-root] { position: static !important; inset: auto !important; overflow: visible !important; height: auto !important; z-index: auto !important; }
          [data-intersection-study-root] header { position: static !important; }
          [data-intersection-study-root] section { break-inside: avoid; page-break-inside: avoid; }
          [data-intersection-study-root] .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );

  return createPortal(node, document.body);
}

function Readout({ label, base, value, unit = "", digits = 0 }: { label: string; base: number; value: number; unit?: string; digits?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Pair base={base} value={value} digits={digits} unit={unit} />
    </div>
  );
}
