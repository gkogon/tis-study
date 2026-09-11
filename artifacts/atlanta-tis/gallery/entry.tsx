/**
 * Alive surfaces — gallery entry.
 *
 * Mounts the site's real React components (StudyMapAlive, ScenarioStudio,
 * WarrantsReport, QueuingReport) on real engine output. The TIS report is the
 * scenario solver's own fixture (../scripts/fixtures/scenario-base.json): the
 * Peachtree Multifamily request run through THIS branch's engine with Track
 * E2's exact re-solve inputs, so the studio section re-solves it in the page
 * with no fallback. The only gallery-specific glue is a window.fetch mock that
 * serves the network fixtures StudyMapAlive asks for, with short delays so the
 * pending-phase stage list is visible rather than instantaneous. The studio
 * runs client-side only here — no engine hand-off, so its Access tab and
 * "Send to engine" are hidden, exactly as the component does without onRerun.
 */
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { TisReport } from "@workspace/tis-api-client-react";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { StudyMapAlive } from "../src/components/study-map-alive";
import { ScenarioStudio } from "../src/components/scenario-studio";
import { WarrantsReport, type WarrantsReportT } from "../src/components/warrants-report";
import { QueuingReport, type QueuingReportT } from "../src/components/queuing-report";
import { solveScenarioDetailed, isClientScenarioDirty, EMPTY_SCENARIO, type ScenarioState } from "../src/lib/scenario-solve";
import region from "./fixtures/region.json";
import roads from "./fixtures/roads.json";
import signals from "./fixtures/signals.json";
import tisReportJson from "../scripts/fixtures/scenario-base.json";
import warrantsJson from "./fixtures/warrants-report.json";
import queuingJson from "./fixtures/queuing-report.json";

const SITE = { latitude: 33.7861, longitude: -84.3853 };
const RADIUS_MI = 0.5;
const PROJECT = "Peachtree Multifamily";
const TIS_REPORT = tisReportJson as unknown as TisReport;
const WARRANTS = warrantsJson as unknown as WarrantsReportT;
const QUEUING = queuingJson as unknown as QueuingReportT;

// ---- fetch mock: StudyMapAlive's three network calls, served from the fixtures ----
// Delays are deliberate: the first two stages of the pending list are real fetches,
// and on a live server they take a moment. Nothing else is allowed out.
function installFetchMock(): void {
  const json = (data: unknown, ms: number, signal?: AbortSignal | null): Promise<Response> =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        resolve(new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }));
      }, ms);
      signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); });
    });
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const signal = init?.signal ?? null;
    if (url.includes("/tis-api/region-for")) return json(region, 350, signal);
    if (url.includes("/api/roads")) return json(roads, 900, signal);
    if (url.includes("/api/intersections")) return json(signals, 1500, signal);
    return Promise.resolve(new Response("not found", { status: 404 }));
  }) as typeof window.fetch;
}

function Section({ eyebrow, heading, lede, children }: { eyebrow: string; heading: string; lede?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="g-section">
      <div className="g-eyebrow">{eyebrow}</div>
      <h2 className="g-heading">{heading}</h2>
      {lede ? <p className="g-lede">{lede}</p> : null}
      {children}
    </section>
  );
}

function GeneratingSection() {
  const [phase, setPhase] = useState<"pending" | "report">("pending");
  const [run, setRun] = useState(0);
  return (
    <Section
      eyebrow="01 · study-map-alive · phase pending → report"
      heading="While a study generates"
      lede={<>{PROJECT} — 240 mid-rise apartments at 1100 Peachtree St NE, {RADIUS_MI} mi study radius. The first two stages are real fetches of the analyzer's road network and signal inventory; the pulses run shortest paths from the site to every signal in range while the engine works.</>}
    >
      <div className="g-actions">
        <button type="button" className="g-btn g-btn-primary" onClick={() => setPhase("report")} disabled={phase === "report"}>Report lands →</button>
        <button type="button" className="g-btn" onClick={() => { setPhase("pending"); setRun((r) => r + 1); }}>Reset</button>
        <span className="g-status">phase: <code>{phase}</code></span>
      </div>
      <StudyMapAlive key={run} site={SITE} radiusMi={RADIUS_MI} phase={phase} report={phase === "report" ? TIS_REPORT : null} projectName={PROJECT} />
    </Section>
  );
}

/** The scenario studio beside the live map, wired exactly as pages/tis.tsx
 *  wires it: one scenario state, one memoised solve keyed on the inputs the
 *  solve reads (a map click only changes the selection), the scenario report
 *  fed to the map, and the base report handed to the studio as the yardstick
 *  until something is edited. No onRerun: client-side only. */
function StudioSection() {
  const [scenario, setScenario] = useState<ScenarioState>(EMPTY_SCENARIO);
  const solveKey = JSON.stringify([scenario.size, scenario.passByPct, scenario.internalCapturePct, scenario.growthRatePct, scenario.weather, scenario.timing]);
  const clientDirty = isClientScenarioDirty(scenario);
  const solution = useMemo(() => {
    const s = solveScenarioDetailed(TIS_REPORT, scenario);
    return isClientScenarioDirty(scenario) ? s : { ...s, report: TIS_REPORT };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solveKey]);
  const scenarioReport = clientDirty ? solution.report : null;
  const fallbackRows = solution.rowFallbacks.size;
  return (
    <Section
      eyebrow="03 · scenario-studio + study-map-alive · client-side solve"
      heading="Scenario studio"
      lede={<>The same {TIS_REPORT.intersectionsStudied}-signal study, re-solved in the browser as it is edited. Site size, pass-by, internal capture, growth and weather on the Site tab; click a signal on the map for its timing plan on the Signal tab — cycle, NS/EW split, protected lefts — and every row re-solves with the engine's own row math (buildAffectedRow, recommendMitigation, buildSummaryMitigations). The engine's report carries every exact re-solve input, so the untouched solve reproduces it field for field: {fallbackRows === 0 ? "no row needed a fallback" : `${fallbackRows} rows needed a fallback`}. Driveway edits go to the engine, so the Access tab is hidden on this client-only page.</>}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <StudyMapAlive
          site={SITE}
          radiusMi={RADIUS_MI}
          phase="report"
          report={TIS_REPORT}
          projectName={PROJECT}
          scenarioReport={scenarioReport}
          selectedSignalId={scenario.selectedSignalId}
          onSelectSignal={(id) => setScenario((s) => ({ ...s, selectedSignalId: id }))}
        />
        <ScenarioStudio report={TIS_REPORT} solution={solution} scenario={scenario} onChange={setScenario} />
      </div>
    </Section>
  );
}

function App() {
  const w = WARRANTS;
  const q = QUEUING;
  return (
    <main className="g-page">
      <header className="g-header">
        <div className="g-eyebrow">simpleimpactstudies.com · gallery</div>
        <h1 className="g-title">Alive surfaces</h1>
        <p className="g-intro">The site's new live visualizations, running the real React components on real engine output — a 40-signal Midtown Atlanta TIS, its scenario studio re-solving in the page, an MUTCD signal-warrant screening and a Webster queue check.</p>
      </header>

      <GeneratingSection />

      <Section
        eyebrow="02 · study-map-alive · phase report"
        heading="Trip assignment"
        lede={<>The same map after the report lands: {TIS_REPORT.intersectionsStudied} signals studied, each carrying its Build LOS badge (No-Build on the toggle); project trips leave the site along shortest routes at a rate proportional to the PM-peak trips each signal receives. Hover a signal for its numbers.</>}
      >
        <StudyMapAlive site={SITE} radiusMi={RADIUS_MI} phase="report" report={TIS_REPORT} projectName={PROJECT} />
      </Section>

      <StudioSection />

      <Section
        eyebrow="04 · warrants-report + warrant-curve-chart"
        heading="Signal warrants"
        lede={<>{w.intersection.major} @ {w.intersection.minor} — major 2+ lanes per direction, minor 1 lane per direction, 85th-percentile speed 40 mph, 7 crashes in 12 months; major street peaks at 1,380 vph (17:00), minor approach at 238 vph. Warrants {w.warrants.filter((x) => x.met).map((x) => x.id).join(", ")} met.</>}
      >
        <WarrantsReport report={w} />
      </Section>

      <Section
        eyebrow="05 · queuing-report + queue-animation"
        heading="Queue forming"
        lede={<>{q.intersection.approach} — {q.inputs.hourlyVolumeVph} vph on {q.inputs.laneCount} lane, {q.inputs.cycleLengthSec} s cycle with {q.inputs.effectiveGreenSec} s effective green, {q.inputs.saturationFlowVphpl.toLocaleString()} vphpl saturation flow, {q.inputs.vehicleSpacingFt} ft spacing, {q.inputs.analysisPeriodHr * 60}-minute period, {q.storage.availableFt} ft of storage. v/c {q.capacity.vOverC.toFixed(2)} — the bay is {Math.abs(q.storage.marginFt ?? 0)} ft short.</>}
      >
        <QueuingReport report={q} />
      </Section>

      <footer className="g-footer">Home opener and city maps are live on simpleimpactstudies.com</footer>
    </main>
  );
}

document.documentElement.classList.add("dark");
installFetchMock();
const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<TooltipProvider><App /></TooltipProvider>);
