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
 *   §01a Distribution      the project's trips THROUGH this junction
 *                          (intersection-distribution.tsx): the twelve
 *                          turning movements as an animated junction with
 *                          their inbound / outbound split, AM / PM tabs,
 *                          the row's share of the study and rank, where the
 *                          trips head next (the ledgers' exit octants and
 *                          the map's client routes that pass this junction)
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
 * and `check:intersection-study` walks them for every studied row) — except
 * the five engine recomputations the model discloses (ENGINE_RECOMPUTATIONS)
 * and §00 names. With a scenario row that prints anything different from the
 * base the page draws the scenario and shows base → scenario pairs wherever
 * a value differs; the capacity weather factor is the scenario's when the
 * studio changed the weather (scenarioWeatherFactor).
 *
 * URL state (`?signal=<signalId>`) belongs to the page that mounts this
 * (pages/tis.tsx): opening pushes history, Close / Escape / back pops it.
 *
 * Dialog: Tab and Shift+Tab cycle inside the study and every other child of
 * <body> is `inert` while it is open, so the report beneath can neither be
 * focused nor read by assistive technology until Close.
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
import { DistributionSection } from "@/components/intersection-distribution";
import { QueueLaneAnimation, type QueueLaneInputs } from "@/components/queue-animation";
import { SignalControls } from "@/components/signal-controls";
import { studyModelFromRow, SECTIONS, ENGINE_RECOMPUTATIONS, Q95_FACTOR, type IntersectionStudyModel, type QueueApproachModel, type SectionId } from "@/lib/intersection-study-model";
import { QUEUE_FT_PER_VEH } from "@/lib/intersection-geometry";
import { type ScenarioState, type SignalTimingEdit, type RowFallback, baseOverridesBySignal, scenarioWeatherFactor } from "@/lib/scenario-solve";
import type { Route } from "@/lib/study-map-sim";
import { SATURATION_FLOW_VPH } from "@workspace/tis-engine-core";

export type IntersectionStudyProps = {
  /** The base report (its rows, weather factor, base overrides). */
  report: TisReport;
  /** The base row for the studied signal. */
  row: TisAffectedIntersection;
  /** The scenario re-solve of the same row when the studio has client edits. */
  scenarioRow?: TisAffectedIntersection | null;
  /** The whole scenario re-solve (its period reports carry the AM row and the scenario's period trips for §01a). */
  scenarioReport?: TisReport | null;
  /** The studio's substitutions for THIS signal's scenario row (ScenarioSolution.rowFallbacks.get(signalId)) — with
   *  "pathLedger" the scenario's turn ledgers are the browser's, not the engine's, and §01a labels them approximated. */
  scenarioRowFallbacks?: ReadonlySet<RowFallback> | null;
  /** Site→row routes the study map built (StudyMapAlive `onRoutes`), for §01a's route continuation; absent ⇒ that list says the map has not routed. */
  routesBySignalId?: ReadonlyMap<string, Route> | null;
  /** Open another signal's study (a §01a link); absent ⇒ plain text. */
  onOpenSignal?: (signalId: string) => void;
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

export function IntersectionStudy({ report, row, scenarioRow, scenarioReport, scenarioRowFallbacks, routesBySignalId, onOpenSignal, scenario, onScenarioChange, onClose }: IntersectionStudyProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState<SectionId>("summary");
  // The weather factor the DRAWN row was solved with: the studio's scenario
  // weather when set, else the report's own — never the base's under a
  // scenario weather edit.
  const weatherFactor = scenarioWeatherFactor(report, scenario);
  const model: IntersectionStudyModel = useMemo(
    () => studyModelFromRow(row, scenarioRow ?? null, { weatherFactor }),
    [row, scenarioRow, weatherFactor],
  );
  // The model decides whether the scenario row is a scenario for THIS signal
  // (an edit elsewhere re-solves every row into an identical fresh object).
  const drawn = model.scenario && scenarioRow ? scenarioRow : row;
  const plan = model.plan;
  const s = model.summary;
  const sev = SEVERITY_CONFIG[s.severity] ?? SEVERITY_CONFIG.none!;
  const SevIcon = sev.icon;
  const baseSev = s.base && s.base.severity !== s.severity ? SEVERITY_CONFIG[s.base.severity] ?? SEVERITY_CONFIG.none! : null;

  // ---- dialog behaviour: focus in/out and trapped, Escape, the page beneath inert, body scroll lock, print class ----
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    body.classList.add("intersection-study-open");
    // Everything else under <body> (the app root, other portals present now)
    // is inert while the study is open: unfocusable, unreachable, hidden
    // from assistive technology — a modal in fact, not just by aria-modal.
    const root = rootRef.current;
    const madeInert: Element[] = [];
    for (const el of Array.from(body.children)) {
      if (el === root || el.hasAttribute("inert")) continue;
      el.setAttribute("inert", "");
      madeInert.push(el);
    }
    closeRef.current?.focus();
    // The listener reads the latest onClose through the ref, so it is bound
    // once. Tab / Shift+Tab wrap inside the study.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== "Tab" || !root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter((el) => !el.hasAttribute("inert") && el.offsetParent !== null);
      if (focusable.length === 0) { e.preventDefault(); root.focus(); return; }
      const first = focusable[0]!, last = focusable[focusable.length - 1]!;
      const current = document.activeElement as HTMLElement | null;
      const inside = !!current && root.contains(current);
      if (e.shiftKey) {
        if (!inside || current === first) { e.preventDefault(); last.focus(); }
      } else if (!inside || current === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      for (const el of madeInert) el.removeAttribute("inert");
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

  const queueScaleFt = model.queuing.reduce((m, q) => Math.max(m, q.q95Ft, q.storageQueueFt ?? 0, q.storageFt ?? 0), 1);
  // One lane at λ ÷ lanes, so every mark is the per-lane share of the
  // engine's approach-total figures (Q95 ÷ lanes), and the "avg" mark is the
  // lane's expected end-of-red queue λ(C − g) — the quantity the readout's
  // end-of-red mean measures. The engine's Q1 is a different quantity
  // (Webster's back-of-queue) and is quoted, not marked. The lane discharges
  // at 1800 × the weather factor, the row's own capacity basis.
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
      averageVehicles: round1(q.endOfRedMeanPerLaneVeh),
      averageFt: Math.round(q.endOfRedMeanPerLaneVeh * QUEUE_FT_PER_VEH),
      averageSource: "λ(C−g)",
      p95Vehicles: round1(q.q95PerLaneVeh),
      p95Ft: Math.round(q.q95PerLaneFt),
      ...(q.lanes > 1 ? { p95Label: `95th ÷ ${q.lanes} ln` } : {}),
    },
    // Storage on record is compared by the model against the queue it names
    // (the L group's own, or the row's worst approach) — the lane's marks are
    // per-lane through figures, so the bay is drawn only when that queue is
    // the approach's own single lane.
    storage: q.storageFt !== null && q.lanes === 1 && q.storageQueueBasis === "row worst approach" && q.storageQueueFt === q.q95Ft
      ? { availableFt: q.storageFt, verdict: q.verdict }
      : { availableFt: null, verdict: "not_measured" },
    title: `${q.direction} approach · one lane${q.lanes > 1 ? ` of ${q.lanes}` : ""}`,
    captionPrefix: `${q.direction} build`,
    ...(q.weatherFactor !== 1 ? { satFlowNote: `${SATURATION_FLOW_VPH} × weather ${q.weatherFactor.toFixed(2)}` } : {}),
    testId: `anim-queue-${q.direction}`,
  });
  const laneNote = (q: QueueApproachModel): string => {
    const q1 = `engine Q1 ${round1(q.avgQueuePerLaneVeh)} veh${q.lanes > 1 ? " per lane" : ""} (Webster back-of-queue, Q95 ÷ ${Q95_FACTOR})`;
    const x = Math.min(0.99, q.vOverC);
    const factor = 1 / Math.max(0.05, 1 - x * q.gOverC);
    return `${q.direction}: end-of-red mean λ(C−g) = ${round1(q.endOfRedMeanPerLaneVeh)} veh${q.lanes > 1 ? " per lane" : ""}; ${q1} is larger by 1/(1 − x·g/C) = ${factor.toFixed(2)}.`;
  };

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
            <p className="mt-3 text-xs text-muted-foreground max-w-prose" data-testid="study-honesty">
              {model.scenario
                ? "This page draws the scenario studio's re-solve of this signal (the engine's own row math on the edited inputs) with the base study's value beside every figure that moved"
                : "Every figure on this page is the report's own row for this signal, taken apart below (lanes, queues, timing, a simulation and a what-if)"}
              {" "}— except {ENGINE_RECOMPUTATIONS.length} figures the row does not print, each the engine's own function run in the browser on this row's inputs and labelled where it appears: {ENGINE_RECOMPUTATIONS.map((r, i) => `${i + 1}. ${r}`).join("; ")}. The §04 simulation is a measurement, not a report figure.
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

          {/* §01a */}
          <section id="study-distribution" data-section="distribution" aria-labelledby="study-distribution-title" className="scroll-mt-24" data-testid="study-section-distribution">
            <SectionHeader id="distribution" n="01a" label="Distribution through this junction" />
            <p className="text-xs text-muted-foreground max-w-prose mb-3" data-testid="study-distribution-caption">
              The project's trips as they pass this junction: the row's own turning-movement table drawn as arrows (width ∝ trips), each movement's share travelling toward the site
              (blue) or away from it (amber) from the row's turn ledgers or the engine's octant model re-run on the row's inputs, the row's share of the study's trips, and where the trips head next.
              {model.scenario ? " The scenario re-solve is drawn; the toggle shows the base." : ""}
            </p>
            <DistributionSection
              report={report}
              row={row}
              scenarioReport={model.scenario ? scenarioReport ?? null : null}
              scenarioRow={model.scenario ? scenarioRow ?? null : null}
              scenarioLedgerSynthesised={model.scenario && !!scenarioRowFallbacks?.has("pathLedger")}
              scenarioDiffers={model.scenario}
              plan={plan}
              routesBySignalId={routesBySignalId ?? null}
              {...(onOpenSignal ? { onOpenSignal } : {})}
            />
          </section>

          {/* §02 */}
          <section id="study-queuing" data-section="queuing" aria-labelledby="study-queuing-title" className="scroll-mt-24" data-testid="study-section-queuing">
            <SectionHeader id="queuing" n="02" label="Queuing" />
            <p className="text-xs text-muted-foreground max-w-prose mb-3" data-testid="study-queuing-caption">
              Each approach's 95th-percentile back-of-queue (build) — the approach total across its lanes, as the engine computes it — beside the storage the report carries for it, on one scale; then the
              queue-forming lane those numbers imply — the Webster cyclic queue of the queuing study, parameterised with this approach's
              volume, the engine's capacity for it (s {SATURATION_FLOW_VPH} × g/C × lanes{weatherFactor !== 1 ? ` × weather ${weatherFactor.toFixed(2)}${model.scenario && scenario.weather ? " (scenario weather)" : ""}` : ""}), its cycle and effective green.
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
                        <th className="text-right py-1 px-2 font-medium">Q95 (approach)</th>
                        <th className="text-right py-1 px-2 font-medium">Storage</th>
                        <th className="text-left py-1 px-2 font-medium">Compared queue vs storage</th>
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
                            <td className="py-1 px-2 text-right font-mono tabular-nums">{q.storageFt !== null ? <>{q.storageFt} ft <span className="text-muted-foreground">{q.storageBasis === "lane-group" ? "L bay" : "row bay"}</span></> : <span className="text-muted-foreground">none on record</span>}</td>
                            <td className="py-1 px-2">
                              <QueueBar queueFt={q.storageQueueFt ?? q.q95Ft} storageFt={q.storageFt ?? undefined} scaleFt={queueScaleFt} deficient={q.storageDeficient ?? undefined} width={140} />
                              {q.storageFt !== null && q.storageQueueFt !== null && (
                                <div className="text-[10px] text-muted-foreground font-mono tabular-nums whitespace-nowrap" data-testid={`study-queue-compared-${q.direction}`}>
                                  {q.storageQueueFt.toFixed(0)} ft {q.storageQueueBasis === "left-turn group" ? "left-turn group Q95" : "row worst-approach Q95"}
                                </div>
                              )}
                            </td>
                            <td className={`py-1 pl-2 text-center font-mono ${q.verdict === "fail" ? "text-red-600 font-semibold" : q.verdict === "pass" ? "text-emerald-600" : "text-muted-foreground"}`}>
                              {q.verdict === "fail" ? "queue exceeds storage" : q.verdict === "pass" ? "fits" : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="text-[11px] text-muted-foreground mt-1 mb-4" data-testid="study-queue-note">
                  Bars share one scale ({queueScaleFt.toFixed(0)} ft); the outline is the storage on record and the red run the compared queue past it. The flag is the engine's or the
                  deliverable's own comparison, on the queue it names: an imported left-turn group's storage against that group's Q95 (row-math.ts), a row-level governing bay against the
                  row's worst-approach Q95 (the PDF's storage-bay adequacy table) — never this approach's total Q95 against a bay meant for one movement. "None on record" means the report
                  carries no bay length for this approach — nothing is compared, nothing is flagged. {QUEUE_FT_PER_VEH} ft per queued vehicle, the engine's own constant.
                  {model.queuing.some((q) => q.timingAssumed) ? ` Capacity here uses the screening g/C 0.45 on a ${model.queuing.find((q) => q.timingAssumed)?.cycleSec ?? 90} s cycle${(model.queuing.find((q) => q.timingAssumed)?.cycleSec ?? 90) !== 90 ? " (the imported cycle the engine computed this row on)" : ""} because the row carries no timing plan.` : ""}
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {model.queuing.map((q) => (
                    <QueueLaneAnimation key={`${model.signalId}-${q.direction}`} {...laneInputs(q)} />
                  ))}
                </div>
                <div className="text-[11px] text-muted-foreground mt-2 space-y-1" data-testid="study-lane-note">
                  <div>
                    Each lane runs at λ ÷ lanes and is marked with the per-lane share of the engine's approach-total figures ({model.queuing.some((q) => q.lanes > 1) ? "Q95 ÷ lanes where an approach has more than one" : "one lane, so the whole Q95"}), the division the queuing study makes. The "avg" mark is the lane's expected end-of-red queue λ(C − g) — what the end-of-red mean measures — not the engine's Q1:
                    the engine's average back-of-queue Q1 = Q95 ÷ {Q95_FACTOR} (Webster's back-of-queue, signal-delay.ts queue95Ft) counts vehicles still joining while the front discharges and is larger by 1/(1 − x·g/C).
                  </div>
                  <div className="font-mono">{model.queuing.map(laneNote).join(" ")}</div>
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
                <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{w.basis === "measured-cycle" ? "Engine fallback plan (Webster splits on the measured cycle), for comparison" : "Webster optimum, for comparison"}</div>
                <div className="text-xs text-muted-foreground">
                  The engine's own computeSignalTiming on this row's printed no-build volumes and lane counts{drawn.approaches.some((a) => Array.isArray(a.laneGroups) && a.laneGroups.length > 0) ? ", the measured left share from its lane groups" : ""}{typeof drawn.utdfCycleLenSec === "number" ? ` and its imported ${drawn.utdfCycleLenSec} s cycle` : ""} — exactly what row-math.ts hands the fallback:
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
                      ? <span className="text-muted-foreground">The plan in use is {t.source === "override" ? "your scenario plan" : BASIS_LABEL[t.basis] ?? t.basis} ({t.cycleLenSec} s); the plan above is shown for comparison only and is used in no number.</span>
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
