/**
 * Alive surfaces — gallery entry.
 *
 * Mounts the site's real React components (StudyMapAlive, ScenarioStudio,
 * TripDistributionCard, IntersectionStudy, WarrantsReport, QueuingReport) on
 * real engine output. The TIS report is the scenario solver's own fixture
 * (../scripts/fixtures/scenario-base.json): the Peachtree Multifamily request
 * run through THIS branch's engine with Track E2's exact re-solve inputs, so
 * the studio section re-solves it in the page with no fallback. The only
 * gallery-specific glue is a window.fetch mock that serves the network
 * fixtures StudyMapAlive asks for, with short delays so the pending-phase
 * stage list is visible rather than instantaneous. The studio and the
 * intersection study's §05 run client-side only here — no engine hand-off, so
 * the studio's Access tab and "Send to engine" are hidden, exactly as the
 * component does without onRerun.
 */
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { TisReport } from "@workspace/tis-api-client-react";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { StudyMapAlive } from "../src/components/study-map-alive";
import { ScenarioStudio } from "../src/components/scenario-studio";
import { TripDistributionCard } from "../src/components/trip-distribution-card";
import { IntersectionStudy } from "../src/components/intersection-study";
import { LosBadge } from "../src/components/tis-report-bits";
import { WarrantsReport, type WarrantsReportT } from "../src/components/warrants-report";
import { QueuingReport, type QueuingReportT } from "../src/components/queuing-report";
import { solveScenarioDetailed, solveScenario, isClientScenarioDirty, EMPTY_SCENARIO, type ScenarioState } from "../src/lib/scenario-solve";
import type { Octant } from "../src/lib/distribution-rose";
import { buildRoadGraph, routesForRows, type RoadSegment } from "../src/lib/study-map-sim";
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

/** The live distribution rose above the map it steers: hovering a sector of
 *  the rose reports its octant, and the map dims every row and flow outside
 *  that 45° bearing sector from the site — wired as pages/tis.tsx and
 *  pages/demo.tsx wire it (`onHoverOctant` → `highlightOctant`). */
function DistributionSection() {
  const [hoverOctant, setHoverOctant] = useState<Octant | null>(null);
  const td = TIS_REPORT.tripDistribution;
  const zones = td?.zones?.length ?? 0;
  return (
    <Section
      eyebrow="06 · trip-distribution-alive + study-map-alive · highlightOctant"
      heading="Trip distribution"
      lede={<>The report's own directional distribution ({td?.methodLabel ?? "gravity"}, {zones} destination zones) drawn live: eight sectors scaled to their share, particles streaming out at a rate proportional to it, the zones placed by bearing and distance and lit heaviest-first. Hover a sector — the map above it keeps only the signals and flows inside that bearing and dims the rest. Every share and every zone is <code>report.tripDistribution</code>; nothing is derived in the page beyond the drawing.</>}
    >
      <div className="space-y-4">
        <StudyMapAlive site={SITE} radiusMi={RADIUS_MI} phase="report" report={TIS_REPORT} projectName={PROJECT} highlightOctant={hoverOctant} />
        <TripDistributionCard report={TIS_REPORT} onHoverOctant={setHoverOctant} />
      </div>
    </Section>
  );
}

/** One signal opened as its own study. A short list of the report's rows,
 *  sorted as the capacity table sorts them (a LOS drop first, then by delay
 *  delta); a button per row opens IntersectionStudy over the page — the same
 *  full-screen view /tis and /demo open from a map click or a table row, with
 *  §05 What-if re-solving that signal in the browser through solveScenario.
 *  No URL state here (the page that mounts the study owns that); Close, Escape
 *  or the list's own button return to the gallery. */
const STUDY_ROWS = 6;
function StudySection() {
  const [scenario, setScenario] = useState<ScenarioState>(EMPTY_SCENARIO);
  const clientDirty = isClientScenarioDirty(scenario);
  const solveKey = JSON.stringify([scenario.size, scenario.passByPct, scenario.internalCapturePct, scenario.growthRatePct, scenario.weather, scenario.timing]);
  const scenarioReport = useMemo(
    () => (clientDirty ? solveScenario(TIS_REPORT, scenario) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientDirty, solveKey],
  );
  // The study map's site→row routes, built once from the same road fixture
  // the maps above route on — what the study's §01a lists other routes from.
  const routes = useMemo(
    () => routesForRows(buildRoadGraph((roads as { segments: RoadSegment[] }).segments), { lat: SITE.latitude, lon: SITE.longitude }, TIS_REPORT.affectedIntersections),
    [],
  );
  const rows = useMemo(
    () => [...TIS_REPORT.affectedIntersections]
      .sort((a, b) => (a.losChanged !== b.losChanged ? (a.losChanged ? -1 : 1) : (b.futureDelaySec - b.existingDelaySec) - (a.futureDelaySec - a.existingDelaySec)))
      .slice(0, STUDY_ROWS),
    [],
  );
  const selectedId = scenario.selectedSignalId;
  const select = (id: string | null) => setScenario((s) => (s.selectedSignalId === id ? s : { ...s, selectedSignalId: id }));
  const row = selectedId ? TIS_REPORT.affectedIntersections.find((r) => r.signalId === selectedId) ?? null : null;
  const scenarioRow = scenarioReport && selectedId ? scenarioReport.affectedIntersections.find((r) => r.signalId === selectedId) ?? null : null;
  const edited = Object.keys(scenario.timing).length;
  return (
    <Section
      eyebrow="07 · intersection-study · §00–§06, client-side solve"
      heading="An intersection as its own study"
      lede={<>Any of the {TIS_REPORT.intersectionsStudied} signals opens as a full-screen study structured like the report: §00 Summary, §01 Approaches &amp; lanes (the plan view), §01a Distribution through this junction (the row's twelve turning movements as an animated junction — width ∝ trips, blue toward the site, amber away, from the row's turn ledgers or the engine's octant model re-run on its inputs — AM / PM tabs, the row's share of the study and rank, and where the trips head next), §02 Queuing (each approach's Q95 against storage, and the queue-forming lane per approach), §03 Signal timing (the plan in use and the Webster optimum), §04 Simulation (the single-junction micro-sim on that row's inputs), §05 What-if (the studio's Signal controls — an edit re-solves every section with the engine's own row math), §06 Mitigation &amp; method. The {STUDY_ROWS} heaviest-impact rows are listed; Escape or Close returns here.{edited ? ` ${edited} signal${edited === 1 ? " carries" : "s carry"} a §05 edit in this page's scenario.` : ""}</>}
    >
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm" data-testid="gallery-study-rows">
          <thead>
            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <th className="text-left py-2 px-3 font-medium">Intersection</th>
              <th className="text-right py-2 px-3 font-medium">Dist (mi)</th>
              <th className="text-right py-2 px-3 font-medium">+Trips PM</th>
              <th className="text-center py-2 px-3 font-medium">LOS no-build → build</th>
              <th className="text-right py-2 px-3 font-medium">Delay Δ</th>
              <th className="text-right py-2 px-3 font-medium">Q95 (ft)</th>
              <th className="py-2 px-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const delta = r.futureDelaySec - r.existingDelaySec;
              const isOpen = r.signalId === selectedId;
              return (
                <tr key={r.signalId} className={`border-b last:border-0 align-middle ${isOpen ? "bg-blue-50 dark:bg-blue-950/30" : ""}`}>
                  <td className="py-2 px-3">
                    <div className="font-medium truncate max-w-[280px]">{r.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{r.signalId}{scenario.timing[r.signalId] !== undefined ? " · §05 edit" : ""}</div>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.distanceMi.toFixed(2)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{r.addedTripsPmPeak}</td>
                  <td className="py-2 px-3 text-center whitespace-nowrap"><LosBadge los={r.existingLos} /> <span className="text-muted-foreground">→</span> <LosBadge los={r.futureLos} /></td>
                  <td className={`py-2 px-3 text-right tabular-nums ${delta >= 15 ? "text-red-600 font-semibold" : delta >= 5 ? "text-amber-600 font-semibold" : ""}`}>{delta >= 0 ? "+" : ""}{delta.toFixed(1)}s</td>
                  <td className={`py-2 px-3 text-right tabular-nums ${r.queue95thFt >= 400 ? "text-red-600 font-semibold" : r.queue95thFt >= 250 ? "text-amber-600" : ""}`}>{r.queue95thFt.toFixed(0)}</td>
                  <td className="py-2 px-3 text-right">
                    <button type="button" className="g-btn g-btn-primary" onClick={() => select(r.signalId)} data-testid={`gallery-open-study-${r.signalId}`}>Open study →</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {row && (
        <IntersectionStudy
          report={TIS_REPORT}
          row={row}
          scenarioRow={scenarioRow}
          scenarioReport={scenarioReport}
          routesBySignalId={routes}
          onOpenSignal={select}
          scenario={scenario}
          onScenarioChange={setScenario}
          onClose={() => select(null)}
        />
      )}
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
        <p className="g-intro">The site's new live visualizations, running the real React components on real engine output — a 40-signal Midtown Atlanta TIS, its scenario studio re-solving in the page, an MUTCD signal-warrant screening, a Webster queue check, the study's live trip-distribution rose, and any of its intersections opened as its own study.</p>
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

      <DistributionSection />

      <StudySection />

      <footer className="g-footer">Home opener and city maps are live on simpleimpactstudies.com</footer>
    </main>
  );
}

document.documentElement.classList.add("dark");
installFetchMock();
const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<TooltipProvider><App /></TooltipProvider>);
