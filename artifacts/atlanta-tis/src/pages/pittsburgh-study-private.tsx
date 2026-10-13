/**
 * /pittsburgh-study-private — a private, unlisted presentation of the saved
 * Pittsburgh sample study (McKnight Road Retail Development, 200,000 sq ft
 * shopping center, opening 2028) the way the live site presents a study,
 * with the PDF's report sections brought to life.
 *
 * Unlisted: lazy-loaded from App.tsx (nothing else imports or links it),
 * disallowed in robots.txt, absent from the sitemap, and `noindex, nofollow`
 * while mounted. No sign-in: the report is a static file under
 * public/samples, fetched at runtime so it never lands in a JS bundle. No
 * engine call, no quota, no what-if hand-off — the only network calls besides
 * that file are the live study map's own public road-network and signal
 * look-ups (/tis-api/region-for, /api/roads, /api/intersections) and the base
 * map's tiles.
 *
 * Reused live components, fed the saved report read-only: StudyMapAlive (the
 * network with animated trip flows), TripDistributionCard (the distribution
 * rose), IntersectionTable (the capacity table with expandable approaches)
 * and IntersectionStudy (one signal opened as its own study, `?signal=` URL
 * state; its §05 what-if re-solves in the browser only, as on /demo).
 *
 * Every number printed here is the report's own field, or a count / sort /
 * format of its rows (lib/pittsburgh-study.ts, pinned by
 * scripts/check-pittsburgh-study-private.mjs). Scenario naming follows the
 * PDF's §8.1 table: Existing = current-year, No-Build = opening-year
 * background growth, Build = No-Build plus project trips. LOS is graded for
 * the weekday PM peak hour only, as the PDF's §3.3 states.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LazyMotion, MotionConfig, domAnimation, m, animate, useInView, useReducedMotion } from "framer-motion";
import { MapContainer, CircleMarker, Circle, Marker, Tooltip as LeafletTooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { AlertCircle, ArrowRight, Loader2, MapPin, Play, RotateCcw } from "lucide-react";
import type { TisAffectedIntersection, TisAnalysisPeriod, TisReport } from "@workspace/tis-api-client-react";
import { StudyMapAlive } from "@/components/study-map-alive";
import { TripDistributionCard } from "@/components/trip-distribution-card";
import { IntersectionTable, LosBadge, LOS_COLORS, SEVERITY_CONFIG } from "@/components/tis-report-bits";
import { IntersectionStudy } from "@/components/intersection-study";
import { Marker as SectionMarker, LosScaleStrip } from "@/components/section-marker";
import { usePageMeta } from "@/hooks/use-page-meta";
import { useSignalStudyUrl } from "@/hooks/use-signal-study-url";
import { bearingDeg, bearingToOctant, type Octant } from "@/lib/distribution-rose";
import type { Route, RoadSegment } from "@/lib/study-map-sim";
import { solveScenarioDetailed, isClientScenarioDirty, EMPTY_SCENARIO, type ScenarioState } from "@/lib/scenario-solve";
import {
  SAMPLE_JSON_PATH, SCREENING_NOTE, STATE_NAME, LOS_GRADES, LOS_SCENARIOS, PERIOD_LABEL, PERIOD_TAB,
  installRobotsNoIndex, payloadProblems, headlineStats, losDistribution, countAtLosEf, rowLos, rowDelay, losRank,
  delayDelta, existingYear, topByDelayDelta, topByQueue, criticalApproach, queueVehicles, periodWaterfall,
  isGradedPeriod, severityCounts, splitMitigation, methodFacts, fmtInt, fmtSignedSec, fmtPct, QUEUE_FT_PER_VEHICLE,
  type PittsburghSamplePayload, type LosScenario, type Severity,
} from "@/lib/pittsburgh-study";

const PAGE_PATH = "/pittsburgh-study-private";
const EASE = [0.16, 1, 0.3, 1] as const;

// ---------------------------------------------------------------------------
// data — fetched once per page load, started as soon as this chunk evaluates
// ---------------------------------------------------------------------------

let payloadPromise: Promise<PittsburghSamplePayload> | null = null;
function loadPayload(): Promise<PittsburghSamplePayload> {
  if (!payloadPromise) {
    const url = `${import.meta.env.BASE_URL}${SAMPLE_JSON_PATH}`;
    payloadPromise = fetch(url, { credentials: "omit" })
      .then((r) => {
        if (!r.ok) throw new Error(`The saved study did not load (HTTP ${r.status}).`);
        return r.json() as Promise<unknown>;
      })
      .then((x) => {
        const problems = payloadProblems(x);
        if (problems.length > 0) throw new Error(`The saved study is incomplete (${problems.slice(0, 3).join(", ")}).`);
        return x as PittsburghSamplePayload;
      });
    // A failed load can be retried from the error state.
    payloadPromise.catch(() => { payloadPromise = null; });
  }
  return payloadPromise;
}
if (typeof window !== "undefined") loadPayload().catch(() => { /* surfaced by the page */ });

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; payload: PittsburghSamplePayload };

function useSamplePayload(): [LoadState, () => void] {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    loadPayload()
      .then((payload) => { if (live) setState({ status: "ready", payload }); })
      .catch((e: unknown) => { if (live) setState({ status: "error", message: e instanceof Error ? e.message : "The saved study did not load." }); });
    return () => { live = false; };
  }, [attempt]);
  return [state, () => setAttempt((n) => n + 1)];
}

// ---------------------------------------------------------------------------
// small motion atoms
// ---------------------------------------------------------------------------

/** A number that counts up the first time it scrolls into view and tweens
 *  on later changes. Screen readers get the final value only. */
function Num({ value, decimals = 0, prefix = "", suffix = "", duration = 1.1, className }: {
  value: number; decimals?: number; prefix?: string; suffix?: string; duration?: number; className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const cur = useRef(0);
  useEffect(() => {
    if (!inView) return;
    if (reduced) { cur.current = value; setShown(value); return; }
    const c = animate(cur.current, value, { duration, ease: EASE, onUpdate: (v) => { cur.current = v; setShown(v); } });
    return () => c.stop();
  }, [inView, reduced, value, duration]);
  const fmt = (v: number) => (decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString("en-US"));
  return (
    <span ref={ref} className={className}>
      <span aria-hidden className="tabular-nums">{prefix}{fmt(shown)}{suffix}</span>
      <span className="sr-only">{prefix}{fmt(value)}{suffix}</span>
    </span>
  );
}

/** Fades and lifts its children in once, the first time they scroll into view. */
function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <m.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.6, delay, ease: EASE }}
    >
      {children}
    </m.div>
  );
}

/** A bar's transition: eased, optionally staggered; instant for reduced motion. */
function useBarTransition(): (delay?: number, duration?: number) => { duration: number; delay?: number; ease?: typeof EASE } {
  const reduced = useReducedMotion();
  return (delay = 0, duration = 0.9) => (reduced ? { duration: 0 } : { duration, delay, ease: EASE });
}

function useIsDark(): boolean {
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const on = () => setDark(document.documentElement.classList.contains("dark"));
    window.addEventListener("sis-theme", on);
    return () => window.removeEventListener("sis-theme", on);
  }, []);
  return dark;
}

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

export default function PittsburghStudyPrivatePage() {
  usePageMeta({
    title: "McKnight Road Retail Development — sample study",
    description: "Screening-level traffic impact study, Pittsburgh MSA.",
  });
  useEffect(() => installRobotsNoIndex(document), []);
  const [state, retry] = useSamplePayload();

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <main data-testid="pgh-study-private-root" className="pgh-study min-h-screen">
          {state.status === "loading" && <LoadingState />}
          {state.status === "error" && <ErrorState message={state.message} onRetry={retry} />}
          {state.status === "ready" && <StudyView payload={state.payload} />}
        </main>
        <style>{PAGE_CSS}</style>
      </MotionConfig>
    </LazyMotion>
  );
}

const PAGE_CSS = `
.pgh-study .pgh-los-dot { transition: fill .55s ease, stroke .55s ease; transform-box: fill-box; transform-origin: center; animation: pgh-pop .5s cubic-bezier(.16,1,.3,1) both; }
@keyframes pgh-pop { from { opacity: 0; transform: scale(.15); } to { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .pgh-study .pgh-los-dot { animation: none; transition: none; } }
.pgh-study .leaflet-container { font: inherit; background: #f1f5f9; }
.dark .pgh-study .leaflet-container { background: #0B1220; }
`;

function LoadingState() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-24 flex items-center gap-3 text-sm text-muted-foreground" role="status">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading the study…
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-24">
      <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/20 p-5 text-sm text-red-800 dark:text-red-200 flex items-start gap-3">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="space-y-2">
          <div className="font-medium">{message}</div>
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-md border border-current px-2.5 py-1 text-xs font-medium">
            <RotateCcw className="w-3.5 h-3.5" /> Try again
          </button>
        </div>
      </div>
    </div>
  );
}

const SECTIONS = [
  { id: "summary", label: "Summary" },
  { id: "trips", label: "Trip generation" },
  { id: "distribution", label: "Distribution" },
  { id: "los", label: "Level of service" },
  { id: "queues", label: "Queues" },
  { id: "mitigation", label: "Mitigation" },
  { id: "method", label: "Method and limits" },
] as const;

function StudyView({ payload }: { payload: PittsburghSamplePayload }) {
  const r = payload.report;

  // ---- one signal's study, as on /demo: the same two-state model ----
  // `scenario.selectedSignalId` is the selection (map ring, table highlight);
  // `openStudyId` is the open full-screen study, bound to `?signal=`. The
  // study's §05 what-if re-solves in the browser only — nothing is sent.
  const [scenario, setScenario] = useState<ScenarioState>(EMPTY_SCENARIO);
  const clientDirty = isClientScenarioDirty(scenario);
  const solveKey = JSON.stringify([scenario.size, scenario.passByPct, scenario.internalCapturePct, scenario.growthRatePct, scenario.weather, scenario.timing]);
  const solution = useMemo(
    () => (clientDirty ? solveScenarioDetailed(r, scenario) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [r, clientDirty, solveKey],
  );
  const scenarioReport = solution ? solution.report : null;
  const [hoverOctant, setHoverOctant] = useState<Octant | null>(null);
  const selectedId = scenario.selectedSignalId;
  const [openStudyId, setOpenStudyId] = useState<string | null>(null);
  function selectSignal(id: string | null) {
    setScenario((s) => (s.selectedSignalId === id ? s : { ...s, selectedSignalId: id }));
  }
  const { syncUrl } = useSignalStudyUrl({
    basePath: PAGE_PATH,
    report: r,
    setOpenSignalId: (id) => { setOpenStudyId(id); if (id) selectSignal(id); },
  });
  function openStudy(id: string | null) {
    setOpenStudyId(id);
    if (id) selectSignal(id);
    syncUrl(id);
  }
  const onMapSelect = (id: string | null) => { if (id) openStudy(id); else selectSignal(null); };
  const studyRow = useMemo(() => (openStudyId ? r.affectedIntersections.find((x) => x.signalId === openStudyId) ?? null : null), [r, openStudyId]);
  const studyScenarioRow = useMemo(
    () => (scenarioReport && openStudyId ? scenarioReport.affectedIntersections.find((x) => x.signalId === openStudyId) ?? null : null),
    [scenarioReport, openStudyId],
  );
  const focusSignalId = openStudyId ?? selectedId;
  const focusRow = focusSignalId ? r.affectedIntersections.find((x) => x.signalId === focusSignalId) ?? null : null;
  const focusOctant: Octant | null = focusRow ? bearingToOctant(bearingDeg(r.request.latitude, r.request.longitude, focusRow.latitude, focusRow.longitude)) : null;
  const [mapRoutes, setMapRoutes] = useState<Map<string, Route> | null>(null);

  return (
    <>
      <Hero payload={payload} />
      <SectionNav />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-24 space-y-20">
        <SummarySection payload={payload} />
        <TripGenerationSection report={r} />
        <section id="distribution" className="scroll-mt-32 space-y-6" aria-labelledby="distribution-title">
          <SectionMarker n="03" label="Trip distribution and assignment" />
          <SectionTitle id="distribution-title" title="Where the project's trips go" note={assignmentNote(r)} />
          <Reveal>
            <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <StudyMapAlive
                site={{ latitude: r.request.latitude, longitude: r.request.longitude }}
                radiusMi={r.studyRadiusMi}
                phase="report"
                report={r}
                projectName={payload.projectName}
                scenarioReport={scenarioReport}
                selectedSignalId={selectedId}
                onSelectSignal={onMapSelect}
                highlightOctant={hoverOctant}
                throughSignalId={focusSignalId}
                onRoutes={setMapRoutes}
              />
            </div>
          </Reveal>
          <Reveal>
            <TripDistributionCard
              report={r}
              onHoverOctant={setHoverOctant}
              highlightOctant={focusOctant}
              highlightLabel={focusRow ? `${focusRow.name} · ${focusRow.distanceMi.toFixed(2)} mi` : null}
            />
          </Reveal>
        </section>
        <LosSection report={r} selectedId={selectedId} onOpen={openStudy} />
        <QueueSection report={r} onOpen={openStudy} />
        <MitigationSection report={r} onOpen={openStudy} />
        <MethodSection payload={payload} />
        <PageFooter payload={payload} />
      </div>

      {studyRow && (
        <IntersectionStudy
          report={r}
          row={studyRow}
          scenarioRow={studyScenarioRow}
          scenarioReport={scenarioReport}
          scenarioRowFallbacks={solution ? solution.rowFallbacks.get(studyRow.signalId) ?? null : null}
          routesBySignalId={mapRoutes}
          onOpenSignal={openStudy}
          scenario={scenario}
          onScenarioChange={setScenario}
          onClose={() => openStudy(null)}
        />
      )}
    </>
  );
}

function assignmentNote(r: TisReport): string {
  const td = r.tripDistribution;
  const ra = r.routeAssignment;
  const parts: string[] = [];
  if (td) parts.push(`${td.methodLabel}: ${td.basis.replace(/\.$/, "")}.`);
  if (ra?.available) {
    parts.push(`Assigned by ${ra.method}${ra.iterations ? `, ${ra.iterations} iterations` : ""} — ${ra.destinationsRouted} of ${ra.destinationsTotal} studied signals routed${typeof ra.onNetworkPct === "number" ? `, ${Math.round(ra.onNetworkPct)}% on the road network` : ""}.`);
  }
  parts.push("Hover a sector of the rose to follow one direction on the map; click a signal to open it as its own study.");
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// hero + section nav
// ---------------------------------------------------------------------------

function sizeLabel(p: PittsburghSamplePayload): string {
  const tg = p.report.tripGeneration;
  if (tg.unitShort === "ksf") return `${fmtInt(tg.size * 1000)} sq ft${/GLA/.test(tg.unit) ? " GLA" : ""}`;
  return `${fmtInt(tg.size)} ${tg.unit}`;
}

function runDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });
}

function Hero({ payload }: { payload: PittsburghSamplePayload }) {
  const r = payload.report;
  const tg = r.tripGeneration;
  const h = headlineStats(payload);
  const chips: Array<{ k: string; v: string }> = [
    { k: "Land use", v: `${tg.landUseCode} · ${tg.landUseName}` },
    { k: "Size", v: sizeLabel(payload) },
    { k: "Opening year", v: String(r.request.openingYear) },
    { k: "Design year", v: r.designYear ? String(r.designYear) : "—" },
    { k: "Study area", v: `${r.studyRadiusMi}-mile radius` },
    { k: "Graded period", v: "Weekday PM peak hour" },
  ];
  const tiles: Array<{ value: number; decimals?: number; prefix?: string; suffix?: string; label: string; sub: string; tone?: "warn" | "bad" }> = [
    { value: h.dailyTrips, label: "Daily trips", sub: "gross, weekday" },
    { value: h.pmNetExternal, label: "PM peak trips on the network", sub: `net new external, of ${fmtInt(h.pmGross)} gross` },
    { value: h.intersections, label: "Signalized intersections", sub: `within ${r.studyRadiusMi} miles of the site` },
    { value: h.losDrops, label: "Drop a LOS grade", sub: `${r.request.openingYear} No-Build → Build`, tone: h.losDrops > 0 ? "warn" : undefined },
    { value: h.atLosEf, label: "At LOS E or F", sub: `${r.request.openingYear} Build`, tone: h.atLosEf > 0 ? "bad" : undefined },
    { value: h.worstDelta, decimals: 1, prefix: "+", suffix: " s", label: "Worst delay change", sub: h.worstRow ? h.worstRow.name : "—", tone: h.worstDelta >= 15 ? "warn" : undefined },
  ];
  return (
    <header className="relative overflow-hidden border-b border-border">
      <div aria-hidden className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,rgba(37,99,235,0.14),transparent_60%)]" />
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-10">
        <Reveal>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <span className="text-blue-600 dark:text-blue-400 font-semibold">Traffic impact study</span>
            <span aria-hidden>·</span>
            <span>Sample study</span>
            <span aria-hidden>·</span>
            <span>{payload.regionName}, {STATE_NAME}</span>
          </div>
          <h1 className="mt-3 text-3xl sm:text-5xl font-bold tracking-tight text-foreground">{payload.projectName}</h1>
          <p className="mt-3 text-base sm:text-lg text-muted-foreground max-w-3xl leading-relaxed">
            A {sizeLabel(payload)} shopping center on the McKnight Road corridor, opening in {r.request.openingYear}, screened against
            every signalized intersection within {r.studyRadiusMi} miles — trip generation, distribution, assignment and
            Existing / No-Build / Build level of service.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground font-mono">
            <span className="inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{r.request.latitude.toFixed(4)}° N, {Math.abs(r.request.longitude).toFixed(4)}° W</span>
            <span>Engine run {runDate(r.generatedAt)}</span>
          </div>
        </Reveal>
        <Reveal delay={0.08}>
          <dl className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px rounded-xl overflow-hidden border border-border bg-border">
            {chips.map((c) => (
              <div key={c.k} className="bg-card px-3 py-2.5 min-w-0">
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{c.k}</dt>
                <dd className="text-sm font-medium leading-snug">{c.v}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
        <div className="mt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {tiles.map((t, i) => (
            <Reveal key={t.label} delay={0.12 + i * 0.06} className="min-w-0">
              <div className="h-full rounded-xl border border-border bg-card px-4 py-4 shadow-sm">
                <div className={`text-3xl sm:text-[2.1rem] leading-none font-bold tracking-tight ${t.tone === "bad" ? "text-red-600 dark:text-red-400" : t.tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
                  <Num value={t.value} decimals={t.decimals} prefix={t.prefix} suffix={t.suffix} />
                </div>
                <div className="mt-2 text-xs font-semibold">{t.label}</div>
                <div className="text-[11px] text-muted-foreground leading-snug line-clamp-2" title={t.sub}>{t.sub}</div>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mt-5 text-xs text-muted-foreground">{SCREENING_NOTE}</p>
      </div>
      <LosScaleStrip />
    </header>
  );
}

function SectionNav() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const reduced = useReducedMotion();
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    if (els.length === 0 || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return (
    <nav aria-label="Report sections" className="sticky top-16 z-30 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto py-2 text-sm [scrollbar-width:none]">
        {SECTIONS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" })}
            className={`shrink-0 rounded-md px-2.5 py-1 transition-colors ${active === s.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            aria-current={active === s.id ? "true" : undefined}
          >
            <span className="font-mono text-[10px] mr-1.5 opacity-70">§{String(i + 1).padStart(2, "0")}</span>{s.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function SectionTitle({ id, title, note }: { id: string; title: string; note?: string }) {
  return (
    <div className="space-y-2 -mt-3">
      <h2 id={id} className="text-2xl sm:text-3xl font-bold tracking-tight">{title}</h2>
      {note && <p className="text-sm text-muted-foreground max-w-4xl leading-relaxed">{note}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// §01 executive summary
// ---------------------------------------------------------------------------

const SCENARIO_NAME: Record<LosScenario, string> = { existing: "Existing", noBuild: "No-Build", build: "Build" };

function scenarioYear(r: TisReport, sc: LosScenario): number {
  return sc === "existing" ? existingYear(r) : r.request.openingYear;
}

function SummarySection({ payload }: { payload: PittsburghSamplePayload }) {
  const r = payload.report;
  const rows = r.affectedIntersections;
  const h = headlineStats(payload);
  const ef = { existing: countAtLosEf(rows, "existing"), noBuild: countAtLosEf(rows, "noBuild"), build: countAtLosEf(rows, "build") };
  const sev = severityCounts(rows);
  const candidates = sev.major + sev.moderate + sev.minor;
  const w = h.worstRow;
  return (
    <section id="summary" className="scroll-mt-32 pt-12 space-y-6" aria-labelledby="summary-title">
      <SectionMarker n="01" label="Executive summary" />
      <SectionTitle id="summary-title" title="What the development does to the network" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Reveal className="space-y-4 text-sm leading-relaxed">
          <p>
            The proposed {payload.projectName} is a {sizeLabel(payload)} shopping center (Land Use {r.tripGeneration.landUseCode}) in
            the {payload.regionName}, {STATE_NAME}, opening in {r.request.openingYear}. The screening covers all {r.intersectionsStudied} signalized
            intersections within {r.studyRadiusMi} miles of the site and grades them for the weekday PM peak hour under
            Existing ({existingYear(r)}), No-Build ({r.request.openingYear}) and Build ({r.request.openingYear}) conditions.
          </p>
          <ul className="space-y-2.5">
            <Finding>
              The site generates <b>{fmtInt(h.dailyTrips)}</b> gross daily trips and <b>{fmtInt(h.pmGross)}</b> in the PM peak hour; after pass-by
              credit and mode share, <b>{fmtInt(h.pmNetExternal)}</b> net new vehicle trips ({fmtInt(h.pmIn)} in / {fmtInt(h.pmOut)} out) load the off-site network.
            </Finding>
            <Finding>
              <b>{h.losDrops}</b> intersection{h.losDrops === 1 ? "" : "s"} drop one or more LOS grades under {r.request.openingYear} Build conditions.
            </Finding>
            <Finding>
              <b>{h.atLosEf}</b> operate at LOS E or F under Build — against {ef.noBuild} under No-Build and {ef.existing} today.
            </Finding>
            {w && (
              <Finding>
                Largest change: <b>{w.name}</b>, {w.existingDelaySec.toFixed(1)} → {w.futureDelaySec.toFixed(1)} s/veh ({fmtSignedSec(delayDelta(w))}, LOS {w.existingLos} → {w.futureLos}),
                95th-percentile queue {fmtInt(w.queue95thFt)} ft on the critical approach.
              </Finding>
            )}
            <Finding>
              Screening-level mitigation candidates at <b>{candidates}</b> of {rows.length} intersections across the opening and design years (§06).
            </Finding>
          </ul>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-baseline justify-between gap-3">
              <div className="text-sm font-semibold">Level of service across the study area</div>
              <div className="text-[11px] text-muted-foreground">{rows.length} intersections · weekday PM peak</div>
            </div>
            <LosShiftChart report={r} />
            <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              {LOS_GRADES.map((g) => (
                <span key={g} className="inline-flex items-center gap-1">
                  <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: LOS_COLORS[g]!.map }} />LOS {g}
                </span>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Finding({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden className="mt-2 w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0" />
      <span className="[&_b]:font-semibold [&_b]:text-foreground text-muted-foreground">{children}</span>
    </li>
  );
}

function LosShiftChart({ report }: { report: TisReport }) {
  const rows = report.affectedIntersections;
  const n = Math.max(1, rows.length);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -15% 0px" });
  const reduced = useReducedMotion();
  return (
    <div ref={ref} className="mt-4 space-y-3">
      {LOS_SCENARIOS.map((sc, i) => {
        const dist = losDistribution(rows, sc);
        const ef = countAtLosEf(rows, sc);
        return (
          <div key={sc} className="grid grid-cols-[5.5rem_minmax(0,1fr)_3rem] sm:grid-cols-[6.5rem_minmax(0,1fr)_3.5rem] items-center gap-3">
            <div>
              <div className="text-sm font-medium">{SCENARIO_NAME[sc]}</div>
              <div className="text-[11px] font-mono text-muted-foreground">{scenarioYear(report, sc)}</div>
            </div>
            <div className="flex h-9 rounded-md overflow-hidden bg-muted" role="img" aria-label={`${SCENARIO_NAME[sc]}: ${LOS_GRADES.map((g) => `${dist[g]} at LOS ${g}`).join(", ")}`}>
              {LOS_GRADES.map((g, j) => dist[g] > 0 && (
                <m.div
                  key={g}
                  className="h-full flex items-center justify-center overflow-hidden text-[11px] font-semibold border-r border-black/10 last:border-r-0"
                  style={{ backgroundColor: LOS_COLORS[g]!.map, color: g === "F" ? "#fff" : "#0f172a" }}
                  initial={{ width: 0 }}
                  animate={{ width: inView ? `${(dist[g] / n) * 100}%` : 0 }}
                  transition={reduced ? { duration: 0 } : { duration: 0.75, delay: i * 0.35 + j * 0.05, ease: EASE }}
                  title={`${dist[g]} at LOS ${g}`}
                >
                  <span className="whitespace-nowrap">{g}{dist[g] > 1 && <span className="opacity-70 ml-0.5">{dist[g]}</span>}</span>
                </m.div>
              ))}
            </div>
            <div className="text-right">
              <div className={`text-lg font-bold leading-none ${ef > 0 ? "text-red-600 dark:text-red-400" : ""}`}><Num value={ef} duration={0.8} /></div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">E / F</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// §02 trip generation — period tabs + gross → net waterfall
// ---------------------------------------------------------------------------

function TripGenerationSection({ report }: { report: TisReport }) {
  const tg = report.tripGeneration;
  const periods = report.periodReports;
  const [active, setActive] = useState<TisAnalysisPeriod>(() => periods.find((p) => p.period === "pm_peak")?.period ?? periods[0]!.period);
  const cur = periods.find((p) => p.period === active) ?? periods[0]!;
  const w = periodWaterfall(cur);
  const auto = (report.autoModeShareApplied ?? 1) * 100;
  const afterCredits = w.gross - w.passBy - w.internalCapture;
  const steps: Array<{ key: string; label: string; value: number; from: number; tone: "total" | "minus" | "result" }> = [
    { key: "gross", label: "Gross trips", value: w.gross, from: 0, tone: "total" },
    { key: "passby", label: `Pass-by credit (${fmtPct(w.passByPct, w.passByPct % 1 ? 1 : 0)})`, value: w.passBy, from: w.gross - w.passBy, tone: "minus" },
    { key: "ic", label: `Internal capture (${fmtPct(report.internalCapturePctApplied)})`, value: w.internalCapture, from: afterCredits, tone: "minus" },
    { key: "mode", label: `Transit, walk, bike (${fmtPct(100 - auto, 1)})`, value: w.nonAuto, from: w.external, tone: "minus" },
    { key: "net", label: "Net new vehicle trips", value: w.external, from: 0, tone: "result" },
  ];
  const scale = Math.max(1, w.gross);
  const bar = useBarTransition();
  const graded = isGradedPeriod(active);
  const pr = periods.find((p) => p.period === "pm_peak");
  return (
    <section id="trips" className="scroll-mt-32 space-y-6" aria-labelledby="trips-title">
      <SectionMarker n="02" label="Trip generation" />
      <SectionTitle
        id="trips-title"
        title="Trips by analysis period"
        note={`Land Use ${tg.landUseCode} (${tg.landUseName}) at ${tg.dailyRate} daily, ${tg.amRate} AM-peak and ${tg.pmRate} PM-peak trips per ${tg.unit}. Rate source: ${tg.variableSource ?? "public-data screening rates"}.`}
      />
      <Reveal>
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div role="tablist" aria-label="Analysis period" className="flex gap-1 overflow-x-auto border-b border-border px-3 pt-3 [scrollbar-width:none]">
            {periods.map((p) => (
              <button
                key={p.period}
                role="tab"
                type="button"
                aria-selected={active === p.period}
                onClick={() => setActive(p.period)}
                className={`relative shrink-0 px-3 sm:px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${active === p.period ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                data-testid={`tab-period-${p.period}`}
              >
                {PERIOD_TAB[p.period]}
                {isGradedPeriod(p.period) && <span className="ml-1.5 rounded bg-blue-600/10 text-blue-700 dark:text-blue-300 px-1 py-px text-[9px] uppercase tracking-wider align-middle">graded</span>}
                {active === p.period && <span aria-hidden className="absolute left-2 right-2 -bottom-px h-0.5 rounded bg-blue-600" />}
              </button>
            ))}
          </div>
          <div className="p-5 sm:p-6 grid gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{PERIOD_LABEL[active]} · gross to net</div>
              {steps.map((s) => (
                <div key={s.key} className="grid grid-cols-[minmax(0,1fr)_5rem] sm:grid-cols-[13rem_minmax(0,1fr)_5rem] items-center gap-x-3 gap-y-1 py-1.5">
                  <div className={`text-sm truncate ${s.tone === "result" ? "font-semibold" : s.tone === "minus" ? "text-muted-foreground" : "font-medium"}`} title={s.label}>{s.label}</div>
                  <div className={`text-right text-sm tabular-nums sm:order-last ${s.tone === "result" ? "font-bold text-blue-700 dark:text-blue-300" : s.tone === "minus" ? "text-muted-foreground" : "font-semibold"}`}>
                    {s.tone === "minus" && s.value > 0 ? "−" : ""}<Num value={s.value} duration={0.7} />
                  </div>
                  <div className="col-span-2 sm:col-span-1 relative h-6 rounded bg-muted/60 overflow-hidden">
                    <m.div
                      className={`absolute top-0 bottom-0 rounded ${s.tone === "total" ? "bg-slate-400 dark:bg-slate-500" : s.tone === "minus" ? "bg-red-400/70 dark:bg-red-500/60" : "bg-blue-600"}`}
                      initial={false}
                      animate={{ left: `${(s.from / scale) * 100}%`, width: `${(s.value / scale) * 100}%` }}
                      transition={bar(0, 0.7)}
                    />
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground pt-3 leading-relaxed">
                Net trips = (gross − pass-by − internal capture) × auto mode share ({fmtPct(auto, 1)}). Only net new vehicle trips are
                assigned to off-site intersections.
              </p>
            </div>
            <div className="space-y-5">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Direction</div>
                <InOutSplit inTrips={w.inTrips} outTrips={w.outTrips} />
              </div>
              <div className="rounded-xl border border-border p-4 text-sm">
                {graded && pr ? (
                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-wider text-blue-700 dark:text-blue-300 font-semibold">Graded period</div>
                    <div className="grid grid-cols-3 gap-2">
                      <MiniStat label="LOS drops" value={<Num value={pr.intersectionsWithLosDrop} duration={0.6} />} />
                      <MiniStat label="At LOS E/F" value={<Num value={pr.intersectionsAtLosEf} duration={0.6} />} />
                      <MiniStat label="Worst Δ" value={<Num value={pr.worstDelayDeltaSec} decimals={1} prefix="+" suffix=" s" duration={0.6} />} />
                    </div>
                    <p className="text-xs text-muted-foreground">Level of service, delay and queues in §04–§05 are this period's.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Trip generation only</div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {active === "daily"
                        ? "Daily totals size the site's traffic; intersections are graded for the weekday PM peak hour."
                        : `This screening grades level of service for the weekday PM peak hour only; ${PERIOD_TAB[active]} trips are reported, not graded. A formal study would normally add the AM peak${active === "saturday_midday" ? " and, for retail, the Saturday peak" : ""}.`}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
          <PeriodTable report={report} active={active} onPick={setActive} />
        </div>
      </Reveal>
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function InOutSplit({ inTrips, outTrips }: { inTrips: number; outTrips: number }) {
  const total = Math.max(1, inTrips + outTrips);
  const inPct = (inTrips / total) * 100;
  const bar = useBarTransition();
  return (
    <div>
      <div className="flex h-8 rounded-md overflow-hidden bg-muted text-xs font-semibold">
        <m.div className="h-full bg-blue-600 text-white flex items-center pl-2 overflow-hidden whitespace-nowrap" initial={false} animate={{ width: `${inPct}%` }} transition={bar(0, 0.7)}>
          In
        </m.div>
        <m.div className="h-full bg-sky-300 dark:bg-sky-700 text-slate-900 dark:text-white flex items-center justify-end pr-2 overflow-hidden whitespace-nowrap" initial={false} animate={{ width: `${100 - inPct}%` }} transition={bar(0, 0.7)}>
          Out
        </m.div>
      </div>
      <div className="mt-1.5 flex justify-between text-sm tabular-nums">
        <span><b><Num value={inTrips} duration={0.6} /></b> <span className="text-muted-foreground text-xs">entering</span></span>
        <span><span className="text-muted-foreground text-xs">exiting</span> <b><Num value={outTrips} duration={0.6} /></b></span>
      </div>
    </div>
  );
}

function PeriodTable({ report, active, onPick }: { report: TisReport; active: TisAnalysisPeriod; onPick: (p: TisAnalysisPeriod) => void }) {
  return (
    <div className="border-t border-border overflow-x-auto">
      <table className="w-full text-sm min-w-[620px]">
        <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Period</th>
            <th className="text-right px-3 py-2 font-medium">Gross</th>
            <th className="text-right px-3 py-2 font-medium">Pass-by</th>
            <th className="text-right px-3 py-2 font-medium">Int. capture</th>
            <th className="text-right px-3 py-2 font-medium">Net external</th>
            <th className="text-right px-3 py-2 font-medium">In</th>
            <th className="text-right px-4 py-2 font-medium">Out</th>
          </tr>
        </thead>
        <tbody>
          {report.periodReports.map((p) => {
            const w = periodWaterfall(p);
            const on = p.period === active;
            return (
              <tr key={p.period} onClick={() => onPick(p.period)} className={`border-t border-border cursor-pointer transition-colors ${on ? "bg-blue-600/5" : "hover:bg-muted/40"}`}>
                <td className={`px-4 py-2 ${on ? "font-semibold" : ""}`}>{p.periodLabel}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtInt(w.gross)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{w.passBy > 0 ? `−${fmtInt(w.passBy)}` : "0"}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{w.internalCapture > 0 ? `−${fmtInt(w.internalCapture)}` : "0"}</td>
                <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmtInt(w.external)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmtInt(w.inTrips)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{fmtInt(w.outTrips)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §04 level of service — LOS map with scenario playback, delay bars, table
// ---------------------------------------------------------------------------

function siteIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    html: `<div style="width:24px;height:24px;border-radius:50% 50% 50% 0;background:#2563eb;border:2px solid #fff;transform:rotate(-45deg) translate(4px, 4px);box-shadow:0 2px 6px rgba(0,0,0,0.45);"></div>`,
  });
}

/** Did this row get worse moving INTO scenario `sc` (from the one before it)? */
function worsenedInto(row: TisAffectedIntersection, sc: LosScenario): boolean {
  if (sc === "existing") return false;
  const prev: LosScenario = sc === "build" ? "noBuild" : "existing";
  return losRank(rowLos(row, sc)) > losRank(rowLos(row, prev));
}

function LosSection({ report, selectedId, onOpen }: { report: TisReport; selectedId: string | null; onOpen: (id: string) => void }) {
  const rows = report.affectedIntersections;
  const [sc, setSc] = useState<LosScenario>("build");
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const order: LosScenario[] = ["existing", "noBuild", "build"];
    let i = 0;
    setSc(order[0]!);
    const t = setInterval(() => {
      i += 1;
      if (i >= order.length) { clearInterval(t); setPlaying(false); return; }
      setSc(order[i]!);
    }, 1700);
    return () => clearInterval(t);
  }, [playing]);
  const dist = losDistribution(rows, sc);
  const worse = rows.filter((x) => worsenedInto(x, sc)).length;
  return (
    <section id="los" className="scroll-mt-32 space-y-6" aria-labelledby="los-title">
      <SectionMarker n="04" label="Level of service · PM peak" />
      <SectionTitle
        id="los-title"
        title="Existing, No-Build and Build"
        note={`Every signalized intersection in the study area, graded on control delay. Existing is ${existingYear(report)}; No-Build grows existing volumes to ${report.request.openingYear}; Build adds the project's trips. Play the three scenarios to watch the network change.`}
      />
      <Reveal>
        <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <LosMap report={report} sc={sc} selectedId={selectedId} onOpen={onOpen} />
          <div className="space-y-4 min-w-0">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Scenario</div>
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="radiogroup" aria-label="Scenario">
                {LOS_SCENARIOS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={sc === s}
                    onClick={() => { setPlaying(false); setSc(s); }}
                    className={`rounded-md px-1 py-1.5 text-xs font-medium transition-colors ${sc === s ? "bg-blue-600 text-white shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-background/60"}`}
                    data-testid={`button-los-scenario-${s}`}
                  >
                    {SCENARIO_NAME[s]}<span className="block font-mono text-[10px] opacity-70">{scenarioYear(report, s)}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                data-testid="button-los-play"
              >
                {playing ? <><RotateCcw className="w-3.5 h-3.5" /> Stop</> : <><Play className="w-3.5 h-3.5" /> Play Existing → No-Build → Build</>}
              </button>
            </div>
            <div className="space-y-1.5">
              {LOS_GRADES.map((g) => (
                <div key={g} className="grid grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-center gap-2">
                  <LosBadge los={g} size="sm" />
                  <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                    <m.div className="h-full rounded-full" style={{ backgroundColor: LOS_COLORS[g]!.map }} initial={false} animate={{ width: `${(dist[g] / Math.max(1, rows.length)) * 100}%` }} transition={{ duration: 0.5, ease: EASE }} />
                  </div>
                  <div className="text-right text-sm font-semibold tabular-nums">{dist[g]}</div>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground leading-relaxed">
              <span className="font-semibold text-foreground">{SCENARIO_NAME[sc]} {scenarioYear(report, sc)}:</span>{" "}
              {countAtLosEf(rows, sc)} at LOS E or F.
              {sc !== "existing" && <> {worse} intersection{worse === 1 ? "" : "s"} lose a grade against {sc === "build" ? "No-Build" : "Existing"} (ringed on the map).</>}
              {" "}Click a signal to open its study.
            </div>
          </div>
        </div>
      </Reveal>
      <Reveal>
        <DelayChangeBars report={report} onOpen={onOpen} />
      </Reveal>
      <Reveal>
        <IntersectionTable report={report} selectedSignalId={selectedId} onSelect={onOpen} />
      </Reveal>
    </section>
  );
}

// The LOS map's ground is the study's own road network (the public
// /api/roads the live study map reads, same URL so the browser's HTTP cache
// serves it once), drawn on a Leaflet canvas — no third-party raster tiles.
let roadsPromise: { key: string; p: Promise<RoadSegment[]> } | null = null;
function loadRoads(report: TisReport): Promise<RoadSegment[]> {
  const lat = report.request.latitude, lon = report.request.longitude;
  // The same query StudyMapAlive builds, so the second request is a cache hit.
  const rad = Math.min(8, report.studyRadiusMi * 1.2 + 0.15);
  const key = `${lat},${lon},${rad}`;
  if (roadsPromise?.key === key) return roadsPromise.p;
  const p = (async () => {
    let regionCode = report.regionCode ?? null;
    if (!regionCode) {
      const rr = await fetch(`/tis-api/region-for?lat=${lat}&lon=${lon}`);
      regionCode = rr.ok ? ((await rr.json()) as { regionCode: string | null }).regionCode : null;
    }
    if (!regionCode) return [];
    const r = await fetch(`/api/roads?regionCode=${encodeURIComponent(regionCode)}&lat=${lat}&lon=${lon}&radiusMi=${rad}`);
    if (!r.ok) return [];
    const j = (await r.json()) as { available?: boolean; segments?: RoadSegment[] };
    return j.available && Array.isArray(j.segments) ? j.segments : [];
  })().catch(() => [] as RoadSegment[]);
  roadsPromise = { key, p };
  return p;
}

const ROAD_STYLE_DARK = [{ w: 3.4, c: "#3A4A66" }, { w: 2.8, c: "#33425C" }, { w: 2.2, c: "#2D3B54" }, { w: 1.5, c: "#27344B" }, { w: 0.9, c: "#212D42" }];
const ROAD_STYLE_LIGHT = [{ w: 3.4, c: "#94a3b8" }, { w: 2.8, c: "#a5b1c2" }, { w: 2.2, c: "#b8c2d0" }, { w: 1.5, c: "#cbd3de" }, { w: 0.9, c: "#dbe1e9" }];

function RoadNetworkLayer({ report, dark }: { report: TisReport; dark: boolean }) {
  const map = useMap();
  const [segs, setSegs] = useState<RoadSegment[] | null>(null);
  useEffect(() => {
    let live = true;
    loadRoads(report).then((x) => { if (live) setSegs(x); });
    return () => { live = false; };
  }, [report]);
  useEffect(() => {
    if (!segs || segs.length === 0) return;
    const renderer = L.canvas({ padding: 0.4 });
    const byCls: Array<Array<[[number, number], [number, number]]>> = [[], [], [], [], []];
    for (const sg of segs) byCls[Math.max(0, Math.min(4, Math.round(sg[0])))]!.push([[sg[1], sg[2]], [sg[3], sg[4]]]);
    const style = dark ? ROAD_STYLE_DARK : ROAD_STYLE_LIGHT;
    const layers: L.Polyline[] = [];
    // Minor classes first so arterials draw on top.
    for (let c = 4; c >= 0; c--) {
      if (byCls[c]!.length === 0) continue;
      layers.push(L.polyline(byCls[c]!, { renderer, color: style[c]!.c, weight: style[c]!.w, opacity: 1, interactive: false, lineCap: "round" }).addTo(map));
    }
    return () => { layers.forEach((l) => l.remove()); };
  }, [segs, dark, map]);
  return null;
}

/** Fit the study area once the container has its real size (and again if it resizes). */
function FitStudyArea({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    let last = "";
    const fit = () => {
      const k = `${el.clientWidth}x${el.clientHeight}`;
      if (k === last || el.clientWidth === 0) return;
      last = k;
      map.invalidateSize();
      map.fitBounds(bounds, { animate: false });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [map, bounds]);
  return null;
}

function LosMap({ report, sc, selectedId, onOpen }: { report: TisReport; sc: LosScenario; selectedId: string | null; onOpen: (id: string) => void }) {
  const dark = useIsDark();
  const reduced = useReducedMotion();
  const center = useMemo<[number, number]>(() => [report.request.latitude, report.request.longitude], [report.request.latitude, report.request.longitude]);
  const radiusM = report.studyRadiusMi * 1609.344;
  const bounds = useMemo(() => L.latLng(center[0], center[1]).toBounds(radiusM * 2.08), [center, radiusM]);
  const order = useMemo(() => [...report.affectedIntersections].sort((a, b) => a.distanceMi - b.distanceMi), [report.affectedIntersections]);
  const icon = useMemo(() => siteIcon(), []);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -15% 0px" });
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!inView) return;
    if (reduced) { setShown(order.length); return; }
    let i = 0;
    const t = setInterval(() => { i += 1; setShown(i); if (i >= order.length) clearInterval(t); }, 40);
    return () => clearInterval(t);
  }, [inView, reduced, order.length]);
  return (
    <div ref={ref} className="relative isolate h-[340px] sm:h-[480px] rounded-lg overflow-hidden border border-border" data-testid="los-map">
      <MapContainer bounds={bounds} zoomSnap={0.25} zoomDelta={0.5} scrollWheelZoom={false} attributionControl={false} style={{ height: "100%", width: "100%" }}>
        <FitStudyArea bounds={bounds} />
        <RoadNetworkLayer report={report} dark={dark} />
        <Circle center={center} radius={radiusM} pathOptions={{ color: "#3b82f6", weight: 1.2, dashArray: "5 7", fillColor: "#3b82f6", fillOpacity: 0.04 }} interactive={false} />
        <Marker position={center} icon={icon}>
          <LeafletTooltip direction="top" offset={[0, -30]}>
            <div className="text-xs font-semibold">Site — {report.request.projectName}</div>
          </LeafletTooltip>
        </Marker>
        {order.slice(0, shown).map((r) => {
          const los = rowLos(r, sc);
          const hot = worsenedInto(r, sc);
          const sel = selectedId === r.signalId;
          return (
            <CircleMarker
              key={r.signalId}
              center={[r.latitude, r.longitude]}
              radius={hot ? 10 : 7}
              pathOptions={{
                className: "pgh-los-dot",
                fillColor: LOS_COLORS[los]?.map ?? "#94a3b8",
                fillOpacity: 0.95,
                color: sel ? "#60a5fa" : hot ? (dark ? "#f8fafc" : "#0f172a") : dark ? "#0B1220" : "#ffffff",
                weight: sel ? 3.5 : hot ? 2.5 : 1.5,
              }}
              eventHandlers={{ click: () => onOpen(r.signalId) }}
            >
              <LeafletTooltip>
                <div className="text-xs">
                  <div className="font-semibold">{r.name}</div>
                  <div>{SCENARIO_NAME[sc]} {scenarioYear(report, sc)}: LOS {los} · {rowDelay(r, sc).toFixed(1)} s/veh</div>
                  <div className="text-muted-foreground">+{r.addedTripsPmPeak} PM peak project trips · {r.distanceMi.toFixed(2)} mi</div>
                </div>
              </LeafletTooltip>
            </CircleMarker>
          );
        })}
      </MapContainer>
      <div className="pointer-events-none absolute right-2 top-2 z-[500] rounded-md bg-background/85 backdrop-blur px-2 py-1 text-[11px] font-medium shadow-sm">
        {SCENARIO_NAME[sc]} {scenarioYear(report, sc)} · {report.studyRadiusMi}-mile study area
      </div>
      <div className="pointer-events-none absolute left-2 bottom-1.5 z-[500] font-mono text-[10px] text-muted-foreground/90">Road network © OpenStreetMap contributors · not to scale for design</div>
    </div>
  );
}

function LosChip({ los, delay }: { los: string; delay: number }) {
  return (
    <m.span
      className="inline-flex"
      initial={{ opacity: 0, scale: 0.6 }}
      whileInView={{ opacity: 1, scale: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.35, delay, ease: EASE }}
    >
      <LosBadge los={los} size="sm" />
    </m.span>
  );
}

function DelayChangeBars({ report, onOpen }: { report: TisReport; onOpen: (id: string) => void }) {
  const top = topByDelayDelta(report.affectedIntersections, 10);
  const max = Math.max(1, ...top.map(delayDelta));
  const bar = useBarTransition();
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <div>
          <div className="text-sm font-semibold">Largest delay changes from the project</div>
          <div className="text-xs text-muted-foreground">{report.request.openingYear} Build − No-Build control delay (s/veh), weekday PM peak. LOS shown Existing → No-Build → Build; delay No-Build → Build.</div>
        </div>
        <div className="text-[11px] text-muted-foreground">Top {top.length} of {report.affectedIntersections.length}</div>
      </div>
      <ol className="space-y-1">
        {top.map((r, i) => {
          const d = delayDelta(r);
          return (
            <li key={r.signalId}>
              <button
                type="button"
                onClick={() => onOpen(r.signalId)}
                className="w-full grid grid-cols-[minmax(0,1fr)_4.5rem] md:grid-cols-[minmax(0,17rem)_7.5rem_minmax(0,1fr)_8.5rem_4.5rem] items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 transition-colors"
              >
                <span className="text-sm font-medium truncate" title={r.name}>{r.name}</span>
                <span className="text-right md:order-last text-sm font-bold tabular-nums text-amber-700 dark:text-amber-400">{fmtSignedSec(d)}</span>
                <span className="hidden md:flex items-center gap-1">
                  <LosChip los={rowLos(r, "existing")} delay={0.1 + i * 0.04} />
                  <ArrowRight className="w-3 h-3 text-muted-foreground" />
                  <LosChip los={rowLos(r, "noBuild")} delay={0.3 + i * 0.04} />
                  <ArrowRight className="w-3 h-3 text-muted-foreground" />
                  <LosChip los={rowLos(r, "build")} delay={0.5 + i * 0.04} />
                </span>
                <span className="col-span-2 md:col-span-1 relative h-5 rounded bg-muted/60 overflow-hidden">
                  <m.span
                    className={`absolute inset-y-0 left-0 rounded ${r.futureLos === "F" ? "bg-red-500" : r.futureLos === "E" ? "bg-orange-500" : "bg-amber-400"}`}
                    initial={{ width: 0 }}
                    whileInView={{ width: `${(Math.max(0, d) / max) * 100}%` }}
                    viewport={{ once: true }}
                    transition={bar(i * 0.05)}
                  />
                </span>
                <span className="hidden md:block text-right text-[11px] font-mono text-muted-foreground tabular-nums whitespace-nowrap">
                  {r.existingDelaySec.toFixed(1)} → {r.futureDelaySec.toFixed(1)} s
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// §05 queues
// ---------------------------------------------------------------------------

function QueueSection({ report, onOpen }: { report: TisReport; onOpen: (id: string) => void }) {
  const top = topByQueue(report.affectedIntersections, 10);
  const max = Math.max(1, ...top.map((r) => r.queue95thFt));
  const bar = useBarTransition();
  const anyStorage = report.affectedIntersections.some((r) => typeof r.existingStorageFt === "number" && r.existingStorageFt > 0);
  return (
    <section id="queues" className="scroll-mt-32 space-y-6" aria-labelledby="queues-title">
      <SectionMarker n="05" label="Queues" />
      <SectionTitle
        id="queues-title"
        title="95th-percentile queues"
        note={`Build ${report.request.openingYear}, weekday PM peak, on each signal's critical approach (the approach with the longest queue), at ${QUEUE_FT_PER_VEHICLE} ft per queued vehicle.${anyStorage ? "" : " No measured storage length is on record for these approaches, so storage adequacy is not evaluated — it needs field-measured bay lengths."}`}
      />
      <Reveal>
        <div className="rounded-2xl border border-border bg-card p-5">
          <ol className="space-y-2.5">
            {top.map((r, i) => {
              const dir = criticalApproach(r);
              const pct = (r.queue95thFt / max) * 100;
              const carPct = Math.min(100, (QUEUE_FT_PER_VEHICLE / Math.max(QUEUE_FT_PER_VEHICLE, r.queue95thFt)) * 100);
              return (
                <li key={r.signalId}>
                  <button type="button" onClick={() => onOpen(r.signalId)} className="w-full text-left rounded-md px-2 py-1 hover:bg-muted/60 transition-colors">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="font-medium truncate" title={r.name}>{r.name}</span>
                      <span className="shrink-0 tabular-nums">
                        <b><Num value={r.queue95thFt} duration={0.9} /></b> ft
                        <span className="text-muted-foreground text-xs"> · ≈{queueVehicles(r.queue95thFt)} veh{dir ? ` · ${dir}` : ""}</span>
                      </span>
                    </div>
                    <div className="mt-1 relative h-3.5 rounded-sm bg-muted/60 overflow-hidden">
                      <span aria-hidden className="absolute left-0 inset-y-0 w-0.5 bg-foreground/70 z-10" />
                      <m.span
                        className="absolute inset-y-0 left-0.5 block"
                        style={{
                          originX: 0,
                          width: `${pct}%`,
                          backgroundImage: `repeating-linear-gradient(90deg, ${r.queue95thFt >= 800 ? "rgb(239 68 68)" : r.queue95thFt >= 400 ? "rgb(249 115 22)" : "rgb(245 158 11)"} 0 ${carPct * 0.78}%, transparent ${carPct * 0.78}% ${carPct}%)`,
                        }}
                        initial={{ scaleX: 0 }}
                        whileInView={{ scaleX: 1 }}
                        viewport={{ once: true }}
                        transition={bar(0.05 * i, 1.2)}
                      />
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="mt-4 text-xs text-muted-foreground">
            Each block is one queued vehicle, forming back from the stop line. Click a row to open that intersection's queuing detail by approach.
          </p>
        </div>
      </Reveal>
    </section>
  );
}

// ---------------------------------------------------------------------------
// §06 mitigation
// ---------------------------------------------------------------------------

const SEVERITY_TONE: Record<Severity, string> = {
  major: "text-red-600 dark:text-red-400",
  moderate: "text-amber-600 dark:text-amber-400",
  minor: "text-yellow-600 dark:text-yellow-400",
  none: "text-emerald-600 dark:text-emerald-400",
};
const SEVERITY_NAME: Record<Severity, string> = { major: "Major", moderate: "Moderate", minor: "Minor", none: "None indicated" };

function MitigationSection({ report, onOpen }: { report: TisReport; onOpen: (id: string) => void }) {
  const rows = report.affectedIntersections;
  const counts = severityCounts(rows);
  const groups = (["major", "moderate", "minor"] as const)
    .map((s) => ({ s, rows: rows.filter((r) => r.mitigationSeverity === s).sort((a, b) => delayDelta(b) - delayDelta(a)) }))
    .filter((g) => g.rows.length > 0);
  const design = report.designYear;
  return (
    <section id="mitigation" className="scroll-mt-32 space-y-6" aria-labelledby="mitigation-title">
      <SectionMarker n="06" label="Mitigation" />
      <SectionTitle
        id="mitigation-title"
        title="Screening-level mitigation candidates"
        note={`Candidates for the Build deficiencies above, not an engineering recommendation: whether any mitigation is required, and in what form, is determined by the engineer of record and the reviewing agency after analysis with collected counts. Each signal's severity is the worse of its opening-year (${report.request.openingYear})${design ? ` and design-year (${design})` : ""} verdicts, on screening defaults rather than an agency criterion — Build LOS F is major; Build LOS E or 15 s or more of added delay is moderate; 5 s or more, or LOS D with any increase, is minor.`}
      />
      <Reveal>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(["major", "moderate", "minor", "none"] as const).map((s) => {
            const Icon = SEVERITY_CONFIG[s]!.icon;
            return (
              <div key={s} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className={`flex items-center gap-1.5 text-xs font-semibold ${SEVERITY_TONE[s]}`}><Icon className="w-3.5 h-3.5" />{SEVERITY_NAME[s]}</div>
                <div className="mt-1 text-3xl font-bold"><Num value={counts[s]} duration={0.9} /></div>
                <div className="text-[11px] text-muted-foreground">of {rows.length} intersections</div>
              </div>
            );
          })}
        </div>
      </Reveal>
      <div className="space-y-4">
        {groups.map((g) => <MitigationGroup key={g.s} severity={g.s} rows={g.rows} report={report} onOpen={onOpen} />)}
      </div>
    </section>
  );
}

function MitigationGroup({ severity, rows, report, onOpen }: { severity: Severity; rows: TisAffectedIntersection[]; report: TisReport; onOpen: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const stripped = splitMitigation(rows[0]!.mitigation).verdict.replace(/^(Major|Moderate|Minor):\s*/, "");
  const verdict = stripped.charAt(0).toUpperCase() + stripped.slice(1);
  const shown = all ? rows : rows.slice(0, 6);
  return (
    <Reveal>
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <div className={`text-sm font-semibold ${SEVERITY_TONE[severity]}`}>{SEVERITY_NAME[severity]} · {rows.length}</div>
          <p className="text-sm text-muted-foreground mt-1">{verdict}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-muted/40">
              <tr>
                <th className="text-left px-5 py-2 font-medium">Intersection</th>
                <th className="text-center px-2 py-2 font-medium">Build {report.request.openingYear}</th>
                {report.designYear && <th className="text-center px-2 py-2 font-medium">Build {report.designYear}</th>}
                <th className="text-left px-3 py-2 font-medium">Governing horizon</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const sp = splitMitigation(r.mitigation);
                return (
                  <tr key={r.signalId} className="border-t border-border hover:bg-muted/40 cursor-pointer" onClick={() => onOpen(r.signalId)}>
                    <td className="px-5 py-2 font-medium">{r.name}</td>
                    <td className="px-2 py-2 text-center"><LosBadge los={r.futureLos} size="sm" /></td>
                    {report.designYear && <td className="px-2 py-2 text-center">{r.designBuildLos ? <LosBadge los={r.designBuildLos} size="sm" /> : "—"}</td>}
                    <td className="px-3 py-2 text-xs text-muted-foreground">{sp.horizon ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length > 6 && (
          <button type="button" onClick={() => setAll((v) => !v)} className="w-full border-t border-border px-5 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
            {all ? "Show fewer" : `Show all ${rows.length}`}
          </button>
        )}
      </div>
    </Reveal>
  );
}

// ---------------------------------------------------------------------------
// §07 method and limits + footer
// ---------------------------------------------------------------------------

function MethodSection({ payload }: { payload: PittsburghSamplePayload }) {
  const facts = methodFacts(payload);
  return (
    <section id="method" className="scroll-mt-32 space-y-6" aria-labelledby="method-title">
      <SectionMarker n="07" label="Method and limits" />
      <SectionTitle id="method-title" title="How this screening was produced, and what it does not cover" />
      <Reveal>
        <dl className="rounded-2xl border border-border bg-card divide-y divide-border">
          {facts.map((f) => (
            <div key={f.label} className="grid gap-1 sm:grid-cols-[11rem_minmax(0,1fr)] px-5 py-3.5">
              <dt className="text-xs uppercase tracking-wider text-muted-foreground font-semibold pt-0.5">{f.label}</dt>
              <dd className="text-sm leading-relaxed">{f.text}</dd>
            </div>
          ))}
        </dl>
      </Reveal>
      <Reveal>
        <div className="rounded-xl border border-blue-300/60 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30 px-5 py-4 text-sm font-medium text-blue-950 dark:text-blue-100" data-testid="screening-note">
          {SCREENING_NOTE}
        </div>
      </Reveal>
    </section>
  );
}

function PageFooter({ payload }: { payload: PittsburghSamplePayload }) {
  return (
    <footer className="border-t border-border pt-6 text-xs text-muted-foreground flex flex-wrap justify-between gap-3">
      <span>Simple Impact Studies · {payload.projectName} · {payload.regionName}, {STATE_NAME}</span>
      <span>Engine run {runDate(payload.report.generatedAt)} · road network © OpenStreetMap contributors</span>
    </footer>
  );
}
