/**
 * Public /demo page. Lets a non-signed-in prospect run a REAL screening-
 * level TIS against live GDOT data on ARBITRARY coordinates inside the
 * Atlanta MSA, and see the FULL deliverable inline — every intersection,
 * approach-level v/c + queues, all periods, mitigations, methodology,
 * and Monte-Carlo sensitivity — without giving us their email.
 *
 * The demo intentionally shows the complete analysis (not a teaser):
 * the conversion lever is "run it on YOUR project, save it, and
 * white-label the PDF," not "see the rest behind a signup wall."
 *
 * Backed by POST /tis-api/demo/generate with the demoRateLimiter
 * (3/day/IP). Curated presets are surfaced as one-click form prefills.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Sparkles, Building2, Briefcase, ShoppingBag, Coffee, Home, Hotel,
  Stethoscope, ShoppingCart, UtensilsCrossed,
  Loader2, ArrowRight, AlertCircle, MapPin, FileCheck2, ChevronRight,
  ChevronDown, Hourglass, ShieldCheck,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

type Preset = {
  id: string;
  label: string;
  blurb?: string;
  prefill: {
    projectName: string;
    latitude: number;
    longitude: number;
    landUseCode: string;
    size: number;
  };
};

type LandUse = { code: string; name: string; unit: string; unitShort: string };

type StudyForm = {
  projectName: string;
  latitude: number;
  longitude: number;
  landUseCode: string;
  size: number;
  openingYear: number;
};

type Los = "A" | "B" | "C" | "D" | "E" | "F";

type ApproachImpact = {
  direction: string;
  existingVolumeVph: number;
  addedTripsPeak: number;
  futureVolumeVph: number;
  existingVc: number;
  futureVc: number;
  existingDelaySec: number;
  futureDelaySec: number;
  existingLos: Los;
  futureLos: Los;
  queue95thFt: number;
};

type AffectedIntersection = {
  signalId: string;
  name: string;
  zone: string;
  distanceMi: number;
  existingVc: number;
  addedTripsPmPeak: number;
  futureVc: number;
  existingDelaySec: number;
  futureDelaySec: number;
  existingLos: Los;
  futureLos: Los;
  losChanged: boolean;
  mitigation: string;
  mitigationSeverity: "none" | "minor" | "moderate" | "major";
  approaches: ApproachImpact[];
  queue95thFt: number;
  calibration?: {
    sampleCount: number;
    delayMultiplier: number;
    lastObservedDelaySec: number | null;
  };
};

type PeriodTripGen = {
  period: string;
  periodLabel: string;
  rawTrips: number;
  passByCredit: number;
  internalCaptureCredit: number;
  externalTrips: number;
  inTrips: number;
  outTrips: number;
};

type PeriodReport = {
  period: string;
  periodLabel: string;
  tripGeneration: PeriodTripGen;
  affectedIntersections: AffectedIntersection[];
  intersectionsWithLosDrop: number;
  intersectionsAtLosEf: number;
  worstDelayDeltaSec: number;
};

type SensitivityResult = {
  iterations: number;
  worstDelayDeltaMean: number;
  worstDelayDeltaP10: number;
  worstDelayDeltaP50: number;
  worstDelayDeltaP90: number;
  probAnyLosDrop: number;
  probAnyLosEf: number;
  expectedLosDrops: number;
};

type DemoReport = {
  generatedAt: string;
  studyRadiusMi: number;
  tripGeneration: {
    landUseCode: string;
    landUseName: string;
    size: number;
    unit: string;
    dailyTrips: number;
    amPeakTrips: number;
    pmPeakTrips: number;
    pmIn: number;
    pmOut: number;
  };
  intersectionsStudied: number;
  intersectionsWithLosDrop: number;
  intersectionsAtLosEf: number;
  worstDelayDeltaSec: number;
  mitigationSummary: string[];
  findings: string[];
  methodology: string[];
  affectedIntersections: AffectedIntersection[];
  periodReports: PeriodReport[];
  growthAppliedPct: number;
  growthYears: number;
  weather: string;
  weatherCapacityFactor: number;
  passByPctApplied: number;
  internalCapturePctApplied: number;
  sensitivity?: SensitivityResult;
};

type DemoResponse = {
  projectName: string;
  latitude: number;
  longitude: number;
  landUseCode: string;
  landUseName: string;
  landUseUnitShort: string;
  size: number;
  openingYear: number;
  studyRadiusMi: number;
  report: DemoReport;
};

const ICONS: Record<string, typeof Building2> = {
  multifamily: Building2,
  office: Briefcase,
  retail: ShoppingBag,
  drivethrough: Coffee,
  subdivision: Home,
  hotel: Hotel,
  medical: Stethoscope,
  supermarket: ShoppingCart,
  restaurant: UtensilsCrossed,
};

const LOS_CHIP: Record<string, string> = {
  A: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  B: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  C: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  D: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  E: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  F: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
};

const SEVERITY_CHIP: Record<string, string> = {
  major: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  moderate: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  minor: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  none: "bg-slate-100 text-slate-600 dark:bg-slate-800/40 dark:text-slate-400",
};

function losChip(los: string) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${LOS_CHIP[los] ?? ""}`}>
      {los}
    </span>
  );
}

function humanizeWeather(w: string) {
  return w.replace(/_/g, " ");
}

export default function DemoPage() {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [landUses, setLandUses] = useState<LandUse[] | null>(null);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [response, setResponse] = useState<DemoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/tis-api/demo/presets").then((r) => r.json()).catch(() => ({ presets: [] })),
      fetch("/tis-api/demo/landuses").then((r) => r.json()).catch(() => ({ landUses: [] })),
    ]).then(([p, l]) => {
      if (cancelled) return;
      setPresets((p?.presets as Preset[] | undefined) ?? []);
      setLandUses((l?.landUses as LandUse[] | undefined) ?? []);
    });
    return () => { cancelled = true; };
  }, []);

  async function run(form: StudyForm) {
    setLoading(true);
    setError(null);
    setActiveName(
      form.projectName ||
        `${form.latitude.toFixed(4)}, ${form.longitude.toFixed(4)}`,
    );
    setResponse(null);
    try {
      const r = await fetch("/tis-api/demo/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setResponse(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setResponse(null);
    setActiveName(null);
    setError(null);
  }

  return (
    <div className="overflow-x-hidden">
      {!response && (
        <div className="relative">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 -z-10 h-[500px] bg-gradient-to-b from-slate-100/80 via-background to-background dark:from-slate-900/30"
          />
          <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-12 space-y-6 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 dark:bg-slate-100 border border-slate-900 dark:border-slate-100 text-xs font-medium text-white dark:text-slate-900">
              <Sparkles className="w-3.5 h-3.5" />
              Live demo · no signup required
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.05] tracking-tight text-slate-900 dark:text-slate-50 max-w-3xl mx-auto">
              Run a real screening TIS
              <br />
              <span className="bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
                in the next 30 seconds.
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Drop a pin anywhere in the Atlanta MSA. We'll generate a full
              screening TIS against live GDOT data: every intersection,
              approach-level v/c and queues, all peak periods, mitigations,
              methodology, and Monte-Carlo sensitivity. Nothing held back. No
              email required.
            </p>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
        {!response && !loading && (
          <DemoForm presets={presets} landUses={landUses} onRun={run} />
        )}

        {loading && <LoadingState projectName={activeName} />}

        {error && !loading && (
          <ErrorState message={error} onReset={reset} />
        )}

        {response && (
          <ResultView response={response} onReset={reset} />
        )}

        {!response && !loading && (
          <FooterTrust />
        )}
      </div>

      <SiteFooter />
    </div>
  );
}

/**
 * Coordinate-driven study form. The user enters lat / lon / land use /
 * size — same fields a real authenticated study takes — and the demo
 * runs against live GDOT data inside the Atlanta MSA. Quick-fill
 * preset buttons sit above the form for one-click examples.
 *
 * Bounds (mirrored on the server in routes/demo.ts):
 *   - lat in [33.4, 34.2]   (Atlanta MSA box)
 *   - lon in [-84.9, -83.9]
 *   - size in (0, 10000]
 *   - landUseCode must match a published ITE 11th Ed. row
 */
const ATL_BOUNDS = { latMin: 33.4, latMax: 34.2, lonMin: -84.9, lonMax: -83.9 };

function DemoForm({
  presets, landUses, onRun,
}: {
  presets: Preset[] | null;
  landUses: LandUse[] | null;
  onRun: (form: StudyForm) => void;
}) {
  const currentYear = new Date().getFullYear();
  const [projectName, setProjectName] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [landUseCode, setLandUseCode] = useState("221");
  const [size, setSize] = useState("");
  const [openingYear, setOpeningYear] = useState(String(currentYear + 1));
  const [formError, setFormError] = useState<string | null>(null);

  const activeLandUse = useMemo(
    () => landUses?.find((lu) => lu.code === landUseCode) ?? null,
    [landUses, landUseCode],
  );

  function applyPreset(p: Preset) {
    setProjectName(p.prefill.projectName);
    setLatitude(String(p.prefill.latitude));
    setLongitude(String(p.prefill.longitude));
    setLandUseCode(p.prefill.landUseCode);
    setSize(String(p.prefill.size));
    setFormError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const lat = Number(latitude);
    const lon = Number(longitude);
    const sz = Number(size);
    const yr = Number(openingYear);

    if (!Number.isFinite(lat) || lat < ATL_BOUNDS.latMin || lat > ATL_BOUNDS.latMax) {
      setFormError(`Latitude must be between ${ATL_BOUNDS.latMin} and ${ATL_BOUNDS.latMax} (Atlanta MSA).`);
      return;
    }
    if (!Number.isFinite(lon) || lon < ATL_BOUNDS.lonMin || lon > ATL_BOUNDS.lonMax) {
      setFormError(`Longitude must be between ${ATL_BOUNDS.lonMin} and ${ATL_BOUNDS.lonMax} (Atlanta MSA).`);
      return;
    }
    if (!landUseCode || !landUses?.some((lu) => lu.code === landUseCode)) {
      setFormError("Pick an ITE land use.");
      return;
    }
    if (!Number.isFinite(sz) || sz <= 0 || sz > 10000) {
      setFormError("Size must be between 0 and 10,000.");
      return;
    }
    if (!Number.isFinite(yr) || yr < currentYear - 1 || yr > currentYear + 30) {
      setFormError(`Opening year must be between ${currentYear - 1} and ${currentYear + 30}.`);
      return;
    }

    onRun({
      projectName: projectName.trim(),
      latitude: lat,
      longitude: lon,
      landUseCode,
      size: sz,
      openingYear: Math.trunc(yr),
    });
  }

  const inputCls =
    "w-full px-3 py-2 text-sm rounded-md border border-border bg-background " +
    "focus:outline-none focus:ring-2 focus:ring-blue-700/30 focus:border-blue-700 " +
    "font-mono tabular-nums";
  const labelCls = "block text-[11px] uppercase tracking-[0.16em] font-mono text-muted-foreground mb-1.5";

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* Quick-fill examples — collapsible, click to prefill the form */}
      {presets && presets.length > 0 && (
        <div className="rounded-xl border border-border bg-slate-50 dark:bg-slate-950/40 p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Quick examples — click to fill the form
            </div>
            <div className="text-[11px] text-muted-foreground">
              {presets.length} starting points
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {presets.map((p) => {
              const Icon = ICONS[p.id] ?? Building2;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p)}
                  className="text-left rounded-md border border-border bg-background px-3 py-2.5 hover:border-foreground/40 hover:shadow-sm transition-all flex items-center gap-3"
                >
                  <Icon className="w-4 h-4 text-blue-700 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold tracking-tight truncate">{p.label}</div>
                    {p.blurb && (
                      <div className="text-[10px] font-mono text-muted-foreground truncate">{p.blurb}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* The form itself — instrument-panel layout, hairline cells */}
      <div className="border border-border bg-background">
        <div className="px-5 py-3 border-b border-border bg-slate-50 dark:bg-slate-950/40 flex items-baseline justify-between gap-4 flex-wrap">
          <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Demo study inputs
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            Atlanta MSA · lat 33.4–34.2 · lon -84.9 to -83.9
          </span>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          {/* Project name */}
          <div>
            <label htmlFor="demo-name" className={labelCls}>
              Project name <span className="text-muted-foreground/60 normal-case">(optional)</span>
            </label>
            <input
              id="demo-name"
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Peachtree multifamily, etc."
              className={inputCls + " font-sans"}
              data-testid="input-project-name"
            />
          </div>

          {/* Coords */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="demo-lat" className={labelCls}>Latitude</label>
              <input
                id="demo-lat"
                type="number"
                step="0.0001"
                min={ATL_BOUNDS.latMin}
                max={ATL_BOUNDS.latMax}
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                placeholder="33.7858"
                className={inputCls}
                required
                data-testid="input-latitude"
              />
            </div>
            <div>
              <label htmlFor="demo-lon" className={labelCls}>Longitude</label>
              <input
                id="demo-lon"
                type="number"
                step="0.0001"
                min={ATL_BOUNDS.lonMin}
                max={ATL_BOUNDS.lonMax}
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="-84.3848"
                className={inputCls}
                required
                data-testid="input-longitude"
              />
            </div>
          </div>

          {/* Land use + size + year */}
          <div className="grid sm:grid-cols-12 gap-4">
            <div className="sm:col-span-6">
              <label htmlFor="demo-landuse" className={labelCls}>
                ITE land use {landUses === null && <span className="text-muted-foreground/60">(loading…)</span>}
              </label>
              <select
                id="demo-landuse"
                value={landUseCode}
                onChange={(e) => setLandUseCode(e.target.value)}
                disabled={!landUses || landUses.length === 0}
                className={inputCls + " font-sans"}
                data-testid="input-landuse"
              >
                {(landUses ?? []).map((lu) => (
                  <option key={lu.code} value={lu.code}>
                    {lu.code} · {lu.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-3">
              <label htmlFor="demo-size" className={labelCls}>
                Size {activeLandUse && <span className="text-muted-foreground/60 normal-case">({activeLandUse.unitShort})</span>}
              </label>
              <input
                id="demo-size"
                type="number"
                step="any"
                min={0.1}
                max={10000}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="240"
                className={inputCls}
                required
                data-testid="input-size"
              />
            </div>
            <div className="sm:col-span-3">
              <label htmlFor="demo-year" className={labelCls}>Opening year</label>
              <input
                id="demo-year"
                type="number"
                step="1"
                min={currentYear - 1}
                max={currentYear + 30}
                value={openingYear}
                onChange={(e) => setOpeningYear(e.target.value)}
                className={inputCls}
                required
                data-testid="input-year"
              />
            </div>
          </div>

          {formError && (
            <div className="text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="submit"
              className="group inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
              data-testid="button-run-demo"
            >
              Run study
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </button>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              Coordinates must fall inside the Atlanta MSA box.
            </span>
          </div>
        </div>
      </div>
    </form>
  );
}

function LoadingState({ projectName }: { projectName: string | null }) {
  const stages = useMemo(
    () => [
      "Pulling live GDOT signal data",
      "Calculating ITE-11th-Ed. trip generation",
      "Running HCM 6th-Ed. capacity analysis",
      "Computing Monte-Carlo sensitivity",
      "Drafting findings + methodology",
    ],
    [],
  );
  const [stageIdx, setStageIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setStageIdx((i) => Math.min(stages.length - 1, i + 1));
    }, 4500);
    return () => clearInterval(t);
  }, [stages.length]);
  return (
    <div className="rounded-2xl border border-border bg-gradient-to-br from-slate-50 to-background dark:from-slate-950/40 p-10 sm:p-14 text-center space-y-6">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 mx-auto">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
      <div className="space-y-2 max-w-md mx-auto">
        <h2 className="text-2xl font-bold tracking-tight">Generating your study…</h2>
        <p className="text-sm text-muted-foreground">
          Running the same screening pipeline a paying customer's study runs
          through. This usually takes 20–60 seconds.
        </p>
      </div>
      <ol className="space-y-1.5 max-w-md mx-auto text-left">
        {stages.map((s, i) => (
          <li
            key={s}
            className={
              "flex items-center gap-2 text-sm transition-colors " +
              (i < stageIdx
                ? "text-foreground"
                : i === stageIdx
                  ? "text-foreground font-medium"
                  : "text-muted-foreground/60")
            }
          >
            <span className={
              "inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0 " +
              (i < stageIdx
                ? "bg-blue-700 text-white"
                : i === stageIdx
                  ? "bg-blue-700/20 text-blue-700"
                  : "bg-muted text-muted-foreground")
            }>
              {i < stageIdx ? "✓" : i === stageIdx ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : ""}
            </span>
            {s}
          </li>
        ))}
      </ol>
      {projectName && (
        <div className="text-[11px] text-muted-foreground pt-2 font-mono truncate max-w-md mx-auto">
          {projectName}
        </div>
      )}
    </div>
  );
}

function ErrorState({ message, onReset }: { message: string; onReset: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 p-8 text-center space-y-4">
      <AlertCircle className="w-8 h-8 text-red-700 mx-auto" />
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight">Demo didn't complete</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">{message}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md border hover:bg-accent transition-colors"
        >
          Try again
        </button>
        <Link
          href="/signup?plan=trial"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-foreground text-background hover:bg-foreground/90 transition-all"
        >
          Sign up to run a real study <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

function SectionHead({ step, title, note }: { step: string; title: string; note?: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold uppercase tracking-widest text-blue-700">
        {step}
      </div>
      <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
        {title}
      </h2>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
    </div>
  );
}

function ResultView({ response, onReset }: { response: DemoResponse; onReset: () => void }) {
  const r = response.report;
  const tg = r.tripGeneration;
  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          ← Run a different study
        </button>
        <div className="text-xs font-semibold uppercase tracking-widest text-blue-700">
          Your demo result · full analysis
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          {response.projectName}
        </h1>
        <p className="text-sm text-muted-foreground font-mono">
          {response.latitude.toFixed(4)}, {response.longitude.toFixed(4)} ·{" "}
          {response.landUseName} (ITE {response.landUseCode}) ·{" "}
          {response.size.toLocaleString()} {response.landUseUnitShort}
        </p>
        <p className="text-sm text-muted-foreground">
          Generated against live GDOT data · ITE 11th Ed. · HCM 6th Ed. · MUTCD
        </p>
      </div>

      {/* Headline metrics */}
      <div className="rounded-2xl border border-border bg-background overflow-hidden shadow-sm">
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border">
          <BigMetric value={String(r.intersectionsStudied)} label="Intersections" />
          <BigMetric value={String(r.intersectionsWithLosDrop)} label="LOS drops" tone={r.intersectionsWithLosDrop > 0 ? "warn" : "good"} />
          <BigMetric value={String(r.intersectionsAtLosEf)} label="At LOS E/F" tone={r.intersectionsAtLosEf > 0 ? "warn" : "good"} />
          <BigMetric value={`+${r.worstDelayDeltaSec.toFixed(1)}s`} label="Worst Δ delay" />
        </div>
      </div>

      <AssumptionsStrip r={r} />

      {/* Trip generation across all periods */}
      <section className="space-y-4">
        <SectionHead
          step="Trip generation"
          title="Trips by analysis period"
          note={`${tg.landUseName} (ITE ${tg.landUseCode}) · ${tg.size.toLocaleString()} ${tg.unit}`}
        />
        <PeriodTripGenTable periods={r.periodReports} dailyTrips={tg.dailyTrips} />
      </section>

      {/* Affected intersections — full list, expandable approach detail */}
      {r.affectedIntersections.length > 0 && (
        <section className="space-y-4">
          <SectionHead
            step="Capacity analysis"
            title={`Affected intersections (${r.affectedIntersections.length})`}
            note="PM peak governing period. Click any row for approach-level v/c, delay, queues, and the recommended mitigation."
          />
          <IntersectionTable rows={r.affectedIntersections} />
        </section>
      )}

      {/* Mitigation summary */}
      {r.mitigationSummary.length > 0 && (
        <section className="space-y-4">
          <SectionHead step="Mitigations" title="Recommended mitigations" />
          <div className="rounded-2xl border border-border bg-background p-6 sm:p-8">
            <ul className="space-y-2.5 text-sm leading-relaxed">
              {r.mitigationSummary.map((m, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="text-blue-700 mt-1">•</span>
                  <span>{m}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Sensitivity */}
      {r.sensitivity && (
        <section className="space-y-4">
          <SectionHead
            step="Sensitivity"
            title="Monte-Carlo sensitivity"
            note={`${r.sensitivity.iterations.toLocaleString()} iterations · trip rate and existing volume perturbed within published variance.`}
          />
          <SensitivityPanel s={r.sensitivity} />
        </section>
      )}

      {/* Findings */}
      {r.findings.length > 0 && (
        <section className="space-y-4">
          <SectionHead step="Findings" title="Key findings" />
          <div className="rounded-2xl border border-border bg-background p-6 sm:p-8">
            <ul className="space-y-2.5 text-sm leading-relaxed">
              {r.findings.map((f, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="text-blue-700 mt-1">•</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Methodology */}
      {r.methodology.length > 0 && (
        <section className="space-y-4">
          <SectionHead step="Methodology" title="How this study was produced" />
          <div className="rounded-2xl border border-border bg-background p-6 sm:p-8">
            <ol className="space-y-2.5 text-sm leading-relaxed list-decimal pl-5 marker:text-muted-foreground">
              {r.methodology.map((m, i) => (
                <li key={i} className="pl-1">{m}</li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {/* Conversion section — strong CTA to sign up */}
      <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white px-6 sm:px-12 py-10 sm:py-14 overflow-hidden relative">
        <div
          aria-hidden
          className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-blue-600/20 blur-3xl pointer-events-none"
        />
        <div className="relative space-y-5">
          <div className="text-xs font-semibold uppercase tracking-widest text-blue-300">
            That was the full analysis — nothing held back
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight max-w-2xl">
            Now run it on your project.
            <br />
            <span className="text-blue-300">10 free studies on signup.</span>
          </h2>
          <p className="text-slate-300 leading-relaxed max-w-2xl">
            The screening you just ran is what a paying customer gets, with
            none of it held back. Sign up free and point the same engine at
            your own sites unlimited times, save deliverables as white-labeled
            PDFs (your firm logo on the cover, methodology and limitations
            appendices, a PE stamp box), and manage studies across all six
            engines. No credit card.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/signup?plan=trial"
              className="group inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-white text-slate-900 hover:bg-slate-100 transition-all shadow-sm"
            >
              Sign up free <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <a
              href="/sample-tis-report.pdf"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg border border-white/20 hover:bg-white/10 transition-colors"
            >
              <FileCheck2 className="w-4 h-4" /> Download a sample PDF
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function AssumptionsStrip({ r }: { r: DemoReport }) {
  const items: Array<{ label: string; value: string }> = [
    { label: "Study radius", value: `${r.studyRadiusMi.toFixed(2)} mi` },
    { label: "Background growth", value: `${r.growthAppliedPct.toFixed(1)}%/yr · ${r.growthYears} yr` },
    { label: "Weather", value: humanizeWeather(r.weather) },
    { label: "Pass-by credit", value: `${r.passByPctApplied.toFixed(0)}%` },
    { label: "Internal capture", value: `${r.internalCapturePctApplied.toFixed(0)}%` },
  ];
  return (
    <div className="rounded-2xl border border-border bg-background overflow-hidden">
      <div className="px-6 py-3 border-b border-border bg-slate-50 dark:bg-slate-950/40 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Study assumptions
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-border">
        {items.map((it) => (
          <div key={it.label} className="px-4 py-4">
            <div className="text-sm font-semibold tracking-tight">{it.value}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
              {it.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PeriodTripGenTable({
  periods, dailyTrips,
}: { periods: PeriodReport[]; dailyTrips: number }) {
  return (
    <div className="rounded-2xl border border-border bg-background overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Period</th>
              <th className="text-right px-4 py-2 font-medium">Raw trips</th>
              <th className="text-right px-4 py-2 font-medium">Pass-by</th>
              <th className="text-right px-4 py-2 font-medium">Internal capture</th>
              <th className="text-right px-4 py-2 font-medium">External trips</th>
              <th className="text-right px-4 py-2 font-medium">In / Out</th>
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              const t = p.tripGeneration;
              return (
                <tr key={p.period} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">{p.periodLabel}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{Math.round(t.rawTrips).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">−{Math.round(t.passByCredit).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">−{Math.round(t.internalCaptureCredit).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">{Math.round(t.externalTrips).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {Math.round(t.inTrips).toLocaleString()} / {Math.round(t.outTrips).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border bg-muted/20">
        Daily two-way trips: {Math.round(dailyTrips).toLocaleString()}. External trips are
        what gets assigned to off-site intersections after ITE pass-by and ULI
        internal-capture credits.
      </div>
    </div>
  );
}

function IntersectionTable({ rows }: { rows: AffectedIntersection[] }) {
  return (
    <div className="rounded-2xl border border-border bg-background overflow-hidden">
      <div className="px-6 py-3 border-b border-border bg-slate-50 dark:bg-slate-950/40 text-xs text-muted-foreground">
        Sorted by distance from site
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Signal</th>
              <th className="text-right px-4 py-2 font-medium">Dist (mi)</th>
              <th className="text-right px-4 py-2 font-medium">+ Trips</th>
              <th className="text-center px-4 py-2 font-medium">Existing</th>
              <th className="text-center px-4 py-2 font-medium">Future</th>
              <th className="text-right px-4 py-2 font-medium">Δ delay</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((it, idx) => (
              <IntersectionRow key={it.signalId ?? idx} it={it} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IntersectionRow({ it }: { it: AffectedIntersection }) {
  const [open, setOpen] = useState(false);
  const delta = it.futureDelaySec - it.existingDelaySec;
  return (
    <>
      <tr
        className="border-t border-border cursor-pointer hover:bg-accent/40 transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <td className="px-4 py-2 font-medium">{it.name}</td>
        <td className="px-4 py-2 text-right tabular-nums">{it.distanceMi.toFixed(2)}</td>
        <td className="px-4 py-2 text-right tabular-nums">{Math.round(it.addedTripsPmPeak)}</td>
        <td className="px-4 py-2 text-center">{losChip(it.existingLos)}</td>
        <td className="px-4 py-2 text-center">
          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${LOS_CHIP[it.futureLos] ?? ""}`}>
            {it.losChanged ? "▲ " : ""}{it.futureLos}
          </span>
        </td>
        <td className={`px-4 py-2 text-right tabular-nums ${delta > 5 ? "text-red-700 font-medium" : "text-muted-foreground"}`}>
          +{delta.toFixed(1)}s
        </td>
        <td className="px-2 py-2 text-muted-foreground">
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </td>
      </tr>
      {open && (
        <tr className="border-t border-border bg-muted/20">
          <td colSpan={7} className="px-4 py-4">
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <MiniStat label="Existing v/c" value={it.existingVc.toFixed(2)} />
                <MiniStat label="Future v/c" value={it.futureVc.toFixed(2)} />
                <MiniStat label="95th queue" value={`${Math.round(it.queue95thFt)} ft`} />
                <MiniStat label="Zone" value={it.zone || "—"} />
              </div>

              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${SEVERITY_CHIP[it.mitigationSeverity] ?? ""}`}>
                  {it.mitigationSeverity}
                </span>
                <span className="text-muted-foreground">{it.mitigation}</span>
              </div>

              {it.calibration && (
                <div className="text-xs text-muted-foreground">
                  Calibrated against {it.calibration.sampleCount.toLocaleString()} live
                  observation{it.calibration.sampleCount === 1 ? "" : "s"} ·
                  delay multiplier ×{it.calibration.delayMultiplier.toFixed(2)}
                </div>
              )}

              {it.approaches.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs min-w-[560px]">
                    <thead className="bg-muted/40 uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-1.5 font-medium">Approach</th>
                        <th className="text-right px-3 py-1.5 font-medium">Exist v/c</th>
                        <th className="text-right px-3 py-1.5 font-medium">Future v/c</th>
                        <th className="text-center px-3 py-1.5 font-medium">Exist LOS</th>
                        <th className="text-center px-3 py-1.5 font-medium">Future LOS</th>
                        <th className="text-right px-3 py-1.5 font-medium">Future delay</th>
                        <th className="text-right px-3 py-1.5 font-medium">95th queue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {it.approaches.map((a) => (
                        <tr key={a.direction} className="border-t border-border">
                          <td className="px-3 py-1.5 font-medium">{a.direction}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{a.existingVc.toFixed(2)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{a.futureVc.toFixed(2)}</td>
                          <td className="px-3 py-1.5 text-center">{losChip(a.existingLos)}</td>
                          <td className="px-3 py-1.5 text-center">{losChip(a.futureLos)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{a.futureDelaySec.toFixed(1)}s</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(a.queue95thFt)} ft</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <div className="text-sm font-semibold tabular-nums tracking-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
        {label}
      </div>
    </div>
  );
}

function SensitivityPanel({ s }: { s: SensitivityResult }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-6 sm:p-8 space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Stat label="Worst Δ delay — P10" value={`+${s.worstDelayDeltaP10.toFixed(1)}s`} />
        <Stat label="Median (P50)" value={`+${s.worstDelayDeltaP50.toFixed(1)}s`} />
        <Stat label="P90" value={`+${s.worstDelayDeltaP90.toFixed(1)}s`} />
        <Stat label="Mean" value={`+${s.worstDelayDeltaMean.toFixed(1)}s`} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Stat label="P(any LOS drop)" value={`${(s.probAnyLosDrop * 100).toFixed(0)}%`} />
        <Stat label="P(any LOS E/F)" value={`${(s.probAnyLosEf * 100).toFixed(0)}%`} />
        <Stat label="Expected LOS drops" value={s.expectedLosDrops.toFixed(1)} />
      </div>
      <div className="text-xs text-muted-foreground">
        Probabilities are the share of {s.iterations.toLocaleString()} Monte-Carlo
        iterations meeting each condition — a measure of how robust the screening
        conclusion is to input uncertainty.
      </div>
    </div>
  );
}

function BigMetric({
  value, label, tone,
}: { value: string; label: string; tone?: "warn" | "good" }) {
  const valueColor =
    tone === "warn" ? "text-amber-600" :
    tone === "good" ? "text-green-700" :
    "text-foreground";
  return (
    <div className="px-4 py-5 text-center">
      <div className={`text-3xl sm:text-4xl font-bold tabular-nums tracking-tight ${valueColor}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
        {label}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-bold tabular-nums tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function FooterTrust() {
  return (
    <div className="border-t border-border pt-8 mt-8 space-y-6">
      <div className="text-center max-w-2xl mx-auto space-y-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-blue-700">
          What you'll get
        </div>
        <h3 className="text-xl font-bold tracking-tight">A real study, not a marketing demo.</h3>
      </div>
      <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
        <TrustTile
          icon={Hourglass}
          label="~30 seconds"
          body="From button click to a complete deliverable, end-to-end."
        />
        <TrustTile
          icon={MapPin}
          label="Live GDOT data"
          body="Indexed metro signals and live 511 incident feed."
        />
        <TrustTile
          icon={ShieldCheck}
          label="HCM 6th Ed. capacity"
          body="Same methodology a real TIS submittal cites."
        />
      </div>
      <div className="text-xs text-muted-foreground text-center pt-2">
        Demo is rate-limited to 3 runs/day per IP. Sign up to run the engine on
        your own projects + unlimited runs on Growth.
      </div>
    </div>
  );
}

function TrustTile({
  icon: Icon, label, body,
}: { icon: typeof Hourglass; label: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-2">
      <Icon className="w-5 h-5 text-blue-700" />
      <div className="font-semibold text-sm">{label}</div>
      <div className="text-xs text-muted-foreground leading-relaxed">{body}</div>
    </div>
  );
}
