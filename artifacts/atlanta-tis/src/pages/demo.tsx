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
  Stethoscope, ShoppingCart, UtensilsCrossed, Globe2,
  Loader2, ArrowRight, AlertCircle, MapPin, FileCheck2, ChevronRight,
  ChevronDown, Hourglass, ShieldCheck, Download,
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

type SecondaryVariable = {
  unit: string;
  unitShort: string;
  confidence: "nhts_2017" | "sandag_2002" | "nchrp_716" | "blended_mpo" | "interpolated";
  note?: string;
};

type LandUse = {
  code: string;
  name: string;
  unit: string;
  unitShort: string;
  secondaryVariables?: SecondaryVariable[];
};

type StudyTier = "auto" | "worksheet" | "abbreviated" | "full";

type StudyForm = {
  projectName: string;
  latitude: number;
  longitude: number;
  landUseCode: string;
  size: number;
  openingYear: number;
  studyRadiusMi: number;
  independentVariable?: string;
  // Deliverable scope. "auto" resolves from project size + jurisdiction
  // thresholds (Gwinnett 4-level / TxDOT TSP Ch. 16 / CDOT TDM Tiers /
  // OPR screening cascade / FDOT MTSIH planning vs. detailed). Explicit
  // values override the resolver when the consultant needs a specific
  // shape (e.g. forcing a Worksheet for an Atlanta carwash that auto-
  // resolves to Abbreviated to match a city's request).
  studyTier?: StudyTier;
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
  regionName?: string;
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
  global_paris: Globe2,
  global_london: Globe2,
  global_tokyo: Globe2,
  global_sydney: Globe2,
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

/**
 * Project-name keyword → suggested land-use code(s). When the user types
 * a recognizable project name ("Marriott Buckhead", "240-unit apartment
 * tower", "shopping plaza") the form surfaces a pill above the dropdown
 * suggesting the most likely code. Conservative match list: only codes
 * where the mapping is unambiguous from a single keyword. Misses are
 * cheap (no pill); false-positives would teach the engineer to ignore
 * the hint, so we tune for precision over recall.
 *
 * Codes here are limited to the public-data land uses the engine actually
 * ships (210/220/310/520/530/710/720/820/850/912/110/130/140/150) so an
 * accepted hint always resolves on /generate. Land uses with no clean free
 * rate (restaurant, fast-food) are deliberately not suggested.
 */
const PROJECT_NAME_HINTS: Array<{ pattern: RegExp; code: string; label: string }> = [
  // Lodging
  { pattern: /\b(?:hotel|inn|marriott|hilton|hyatt|sheraton|westin|four\s*seasons|motel|resort|extended[\s-]?stay)\b/i, code: "310", label: "Hotel" },
  // Residential
  { pattern: /\b(?:apartments?|apt|multifamily|condos?|condominiums?|townhomes?|townhouses?|mid[\s-]?rise|tower)\b/i, code: "220", label: "Multifamily / Apartment" },
  { pattern: /\b(?:subdivision|single[\s-]?family|sfd|homes?\s*subdivision)\b/i, code: "210", label: "Single-Family Detached" },
  // Office
  { pattern: /\b(?:medical\s+office|dental|mob)\b/i, code: "720", label: "Medical/Dental Office" },
  { pattern: /\b(?:office\s+tower|office\s+park|office\s+building|business\s+park|class\s*[ab])\b/i, code: "710", label: "General Office" },
  // Retail
  { pattern: /\b(?:shopping\s+center|shopping\s+mall|mall|plaza|retail)\b/i, code: "820", label: "Shopping Center / Retail" },
  { pattern: /\b(?:supermarket|grocery)\b/i, code: "850", label: "Supermarket" },
  { pattern: /\b(?:bank|credit\s+union)\b/i, code: "912", label: "Bank" },
  // Institutional
  { pattern: /\b(?:elementary|primary\s+school)\b/i, code: "520", label: "Elementary / Primary School" },
  { pattern: /\b(?:high\s+school)\b/i, code: "530", label: "High School" },
  // Industrial
  { pattern: /\b(?:warehouse|fulfillment\s+center|distribution\s+center)\b/i, code: "150", label: "Warehousing" },
  { pattern: /\b(?:manufacturing|factory|plant)\b/i, code: "140", label: "Manufacturing" },
  { pattern: /\b(?:light\s+industrial|industrial|flex)\b/i, code: "110", label: "Light Industrial" },
];

/**
 * Suggest the first land-use code whose keyword pattern hits in the
 * project name. Returns null when nothing matches the name reads as
 * generic ("Project Phase 1" etc.). Caller uses this to surface a
 * "Did you mean …?" pill above the dropdown.
 */
function suggestIteCodeForName(name: string): { code: string; label: string } | null {
  const trimmed = name.trim();
  if (trimmed.length < 4) return null;
  for (const h of PROJECT_NAME_HINTS) {
    if (h.pattern.test(trimmed)) return { code: h.code, label: h.label };
  }
  return null;
}

/**
 * Suggest 2–3 quick-pick sizes for the user's land use + chosen unit. The
 * sizes are the "what does a typical project look like" sizes a developer
 * is likely to be sketching — e.g. for multifamily: 80 / 160 / 320 DU.
 * Tuned to span small / medium / large for each code so the chip strip is
 * useful regardless of project scale. Falls back to a generic 50/100/200
 * scheme for codes without a custom entry.
 */
function quickSizesFor(landUseCode: string, unitShort: string): number[] {
  // unitShort key disambiguates secondary-variable choices.
  const key = `${landUseCode}:${unitShort}`;
  const map: Record<string, number[]> = {
    // Residential — DU
    "210:DU": [80, 160, 320],
    "215:DU": [60, 120, 240],
    "220:DU": [80, 160, 320],
    "221:DU": [120, 200, 400],
    "222:DU": [200, 400, 800],
    "230:DU": [80, 160, 320],
    "251:DU": [40, 80, 160],
    "252:DU": [60, 120, 240],
    // Residential alternates
    "221:ksf": [100, 200, 400],
    "222:ksf": [200, 400, 800],
    "210:acres": [10, 30, 80],
    // Lodging
    "310:rooms": [120, 200, 320],
    "310:occ":   [90, 150, 240],
    "310:emp":   [50, 100, 200],
    "311:rooms": [120, 200, 320],
    "320:rooms": [60, 100, 160],
    "330:rooms": [180, 320, 500],
    // Office
    "710:ksf":   [25, 50, 100],
    "710:emp":   [80, 200, 500],
    "712:ksf":   [10, 20, 35],
    "720:ksf":   [20, 45, 80],
    "720:emp":   [40, 100, 250],
    "750:ksf":   [50, 100, 200],
    "770:ksf":   [50, 100, 250],
    // Retail
    "820:ksf":   [40, 75, 150],
    "820:emp":   [50, 150, 350],
    "820:acres": [4, 8, 15],
    "850:ksf":   [40, 60, 80],
    "934:ksf":   [3, 4, 6],
    "934:seats": [40, 80, 120],
    "932:ksf":   [6, 10, 14],
    "932:seats": [120, 200, 300],
    // Institutional
    "520:students": [400, 700, 1000],
    "520:ksf":      [40, 70, 100],
    "520:rooms":    [20, 35, 50],   // classrooms
    "522:rooms":    [22, 35, 48],
    "530:students": [800, 1500, 2400],
    "530:rooms":    [32, 60, 96],
    "550:students": [5000, 12000, 25000],
    "560:ksf":      [10, 25, 60],
    "560:seats":    [200, 600, 1500],
    "560:att":      [150, 400, 1000],
    "565:students": [60, 120, 200],
    "565:rooms":    [5, 10, 16],    // day-care classrooms
    "610:beds":     [120, 250, 500],
    "610:ksf":      [150, 300, 600],
    "610:lic":      [120, 250, 500],
    "610:OR":       [4, 10, 20],
    "620:res":      [60, 120, 240],
    "630:ksf":      [10, 25, 60],
    "630:exam":     [5, 12, 30],
    "630:pract":    [2, 5, 12],
    "720:exam":     [8, 20, 50],
    "720:pract":    [3, 8, 20],
    // Retail extras
    "820:tnt":      [15, 30, 60],
    "820:stalls":   [200, 400, 800],
    "850:lanes":    [6, 12, 20],
    "840:veh":      [60, 150, 350],
    "841:veh":      [60, 150, 350],
    "880:rx":       [1, 2, 3],
    "881:DTL":      [1, 2, 3],
    "911:tlr":      [2, 4, 8],
    "912:DTL":      [2, 4, 6],
    "934:DTL":      [1, 2, 3],
    "935:DTL":      [1, 2, 3],
    "935:seats":    [20, 40, 60],
    "936:seats":    [20, 40, 60],
    // Auto service / fuel
    "941:emp":      [3, 6, 12],
    "942:bays":     [4, 8, 14],
    "944:VFP":      [4, 8, 16],
    "944:pumps":    [2, 4, 8],
    "945:VFP":      [4, 8, 16],
    "945:pumps":    [2, 4, 8],
    "945:ksf":      [3, 5, 8],      // c-store sqft
    "948:tnls":     [1, 2, 3],
    // Industrial
    "110:ksf":   [50, 150, 400],
    "150:ksf":   [100, 300, 800],
    "150:acres": [10, 30, 80],
    "150:dock":  [10, 30, 80],
    "140:ksf":   [60, 200, 500],
    // Recreation
    "415:fld":    [1, 2, 4],
    "415:stalls": [10, 30, 80],
    "430:rnd":    [60, 120, 300],
    "488:att":    [40, 120, 320],
  };
  return map[key] ?? [50, 100, 200];
}

/**
 * Recommendation for study radius based on the project's scale. Cold-click
 * visitors usually leave the slider at the default; this hint nudges
 * larger projects to a larger radius so they don't miss obvious mitigation
 * candidates one mile away. The thresholds match the practitioner rule of
 * thumb: <100 DU / <50 ksf → 0.5 mi (very local), DRI-scale → 1.5–3 mi.
 */
function recommendRadiusMi(landUseCode: string, unitShort: string, size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0.75;
  // Hotel / hospitality use rooms-equivalent
  if (unitShort === "rooms") {
    if (size >= 400) return 2.0;
    if (size >= 200) return 1.5;
    if (size >= 100) return 1.0;
    return 0.5;
  }
  // Residential DUs
  if (unitShort === "DU") {
    if (size >= 500) return 2.0;
    if (size >= 250) return 1.5;
    if (size >= 100) return 1.0;
    return 0.5;
  }
  // Square-footage codes
  if (unitShort === "ksf") {
    if (size >= 500) return 2.5;
    if (size >= 250) return 1.5;
    if (size >= 100) return 1.0;
    return 0.5;
  }
  // Employees / students / acres / seats — heuristic scale by absolute number
  if (size >= 1000) return 1.5;
  if (size >= 200) return 1.0;
  return 0.75;
}

/** localStorage key for the persisted demo form. Bumping the version
 *  invalidates older saved drafts that may have shapes the new form
 *  can't restore cleanly. */
const DEMO_FORM_LOCALSTORAGE_KEY = "tis-demo-form:v2";

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

type ResolvedRegion = {
  code: string;
  displayName: string;
  country?: string;
  city?: string;
};

export default function DemoPage() {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [resolvedRegion, setResolvedRegion] = useState<ResolvedRegion | null>(null);
  const [landUses, setLandUses] = useState<LandUse[] | null>(null);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [response, setResponse] = useState<DemoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Fallback land uses surfaced when /demo/landuses fails or returns
  // empty (network issue, ad-blocker, slow API rollout, etc.). Without
  // this, the user lands on a form with a disabled land-use button and
  // no error message — they bounce. With it, the form is always usable;
  // the live API is just an upgrade path. List mirrors the public-data
  // land-use codes the live engine actually ships, so a fallback selection
  // always resolves on /generate.
  const FALLBACK_LAND_USES: LandUse[] = [
    { code: "210", name: "Single-Family Detached Housing", unit: "Dwelling Units", unitShort: "DU" },
    { code: "220", name: "Multifamily Housing / Apartment", unit: "Dwelling Units", unitShort: "DU" },
    { code: "310", name: "Hotel", unit: "Occupied Rooms", unitShort: "rooms" },
    { code: "520", name: "Elementary / Primary School", unit: "1,000 sqft GFA", unitShort: "ksf" },
    { code: "530", name: "High School", unit: "1,000 sqft GFA", unitShort: "ksf" },
    {
      code: "710",
      name: "General Office",
      unit: "1,000 sqft GFA",
      unitShort: "ksf",
      // Keep the unit picker working on the fallback path too. Mirrors
      // the live land-uses.ts payload for this code.
      secondaryVariables: [
        { unit: "Employees", unitShort: "emp", confidence: "nchrp_716", note: "NCHRP 716 per-employee backstop" },
      ],
    },
    { code: "720", name: "Medical / Dental Office", unit: "1,000 sqft GFA", unitShort: "ksf" },
    { code: "820", name: "Shopping Center / Retail", unit: "1,000 sqft GLA", unitShort: "ksf" },
    { code: "850", name: "Supermarket", unit: "1,000 sqft GFA", unitShort: "ksf" },
    { code: "912", name: "Bank", unit: "1,000 sqft GFA", unitShort: "ksf" },
    { code: "110", name: "Light Industrial", unit: "1,000 sqft GFA", unitShort: "ksf" },
    { code: "150", name: "Warehousing", unit: "1,000 sqft GFA", unitShort: "ksf" },
  ];

  const [landUsesError, setLandUsesError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLandUsesError(null);
    Promise.all([
      fetch("/tis-api/demo/presets").then((r) => r.json()).catch(() => ({ presets: [], resolvedRegion: null })),
      fetch("/tis-api/demo/landuses").then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    ]).then(([p, l]) => {
      if (cancelled) return;
      setPresets((p?.presets as Preset[] | undefined) ?? []);
      setResolvedRegion((p?.resolvedRegion as ResolvedRegion | null) ?? null);
      const fetched = (l?.landUses as LandUse[] | undefined) ?? [];
      if (fetched.length === 0) {
        // The fetch resolved but returned nothing usable. Fall back to
        // the hardcoded list and tell the user, so they can still run
        // the demo on the common codes.
        setLandUses(FALLBACK_LAND_USES);
        setLandUsesError("Couldn't load the full land-use library. Using a fallback list of the most-used codes — refresh to retry.");
      } else {
        setLandUses(fetched);
      }
    }).catch(() => {
      if (cancelled) return;
      // Network / parse failure. Same fallback path.
      setLandUses(FALLBACK_LAND_USES);
      setLandUsesError("Couldn't load the full land-use library. Using a fallback list of the most-used codes — refresh to retry.");
    });
    return () => { cancelled = true; };
  }, [reloadTick]);

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
        credentials: "include",
        body: JSON.stringify(form),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setResponse(data);
      // Clear the saved draft on a successful run so a fresh visit doesn't
      // surprise the user with stale inputs from someone else's session at
      // the same browser. The form is unmounted while the result is showing,
      // so this clear happens behind the scenes.
      try {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(DEMO_FORM_LOCALSTORAGE_KEY);
        }
      } catch {
        // Quota / private browsing — ignore; the form will just re-save.
      }
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
              Drop a pin in any of our 300 indexed metros worldwide — Atlanta,
              Paris, Tokyo, Sydney, anywhere we cover. We'll generate a full
              screening TIS: every intersection, approach-level v/c and queues,
              all peak periods, mitigations, methodology, and Monte-Carlo
              sensitivity. Nothing held back. No email required.
            </p>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
        {!response && !loading && (
          <DemoForm presets={presets} landUses={landUses} landUsesError={landUsesError} onReload={() => setReloadTick((n) => n + 1)} onRun={run} resolvedRegion={resolvedRegion} />
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
 *   - (lat, lon) must fall inside the bbox of one of our 300 indexed
 *     metros. Client-side check is loose (just valid lat/lon range);
 *     the backend re-validates against the canonical regions registry
 *     and returns a clear error if the site is outside coverage.
 *   - size in (0, 10000]
 *   - landUseCode must match a published public-data land-use row
 */

function DemoForm({
  presets, landUses, landUsesError, onReload, onRun, resolvedRegion,
}: {
  presets: Preset[] | null;
  landUses: LandUse[] | null;
  landUsesError: string | null;
  onReload: () => void;
  onRun: (form: StudyForm) => void;
  resolvedRegion: ResolvedRegion | null;
}) {
  const currentYear = new Date().getFullYear();
  // Hydrate from localStorage if a prior session left a draft behind. Cold-
  // click visitors often bounce away to /pricing or /cities to research and
  // come back; without persistence they lose every input. v2 of the key
  // also stores independentVariable so the unit picker survives a reload.
  const persisted = useMemo<Partial<StudyForm> | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(DEMO_FORM_LOCALSTORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StudyForm>;
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }, []);

  const [projectName, setProjectName] = useState(persisted?.projectName ?? "");
  const [latitude, setLatitude] = useState(persisted?.latitude !== undefined ? String(persisted.latitude) : "");
  const [longitude, setLongitude] = useState(persisted?.longitude !== undefined ? String(persisted.longitude) : "");
  const [landUseCode, setLandUseCode] = useState(persisted?.landUseCode ?? "221");
  const [size, setSize] = useState(persisted?.size !== undefined ? String(persisted.size) : "");
  const [openingYear, setOpeningYear] = useState(persisted?.openingYear !== undefined ? String(persisted.openingYear) : String(currentYear + 1));
  // Study radius — how far from the site the engine sweeps for affected
  // signals. Default 0.75 mi balances coverage and latency for a cold-
  // click visitor; the slider exposes 0.25 → 3 mi for prospects who
  // want to test bigger sites. Backend clamps to the same range.
  const [studyRadiusMi, setStudyRadiusMi] = useState(persisted?.studyRadiusMi ?? 0.75);
  // Chosen independent variable. Empty string ⇒ use the land use's primary
  // unit (the demo behaves identically to before for codes without secondaries).
  const [independentVariable, setIndependentVariable] = useState(persisted?.independentVariable ?? "");
  // Deliverable tier. "auto" lets the backend resolver pick based on
  // project size + jurisdiction thresholds; explicit values force the
  // sub-template (worksheet / abbreviated / full).
  const [studyTier, setStudyTier] = useState<StudyTier>(persisted?.studyTier ?? "auto");
  const [formError, setFormError] = useState<string | null>(null);

  // Land-use combobox state. The dropdown has the public-data codes; without a
  // search box, an engineer landing from cold outreach has to scroll
  // through everything from Single-Family Housing to Mini-Warehouse to
  // find Museum or Live Theater. Typeahead filters on code, name, and
  // unit so "the" surfaces Live Theater + Movie Theater, "kid" finds
  // Day Care, "shop" finds the retail family, etc.
  const [landUseOpen, setLandUseOpen] = useState(false);
  const [landUseQuery, setLandUseQuery] = useState("");
  const filteredLandUses = useMemo(() => {
    if (!landUses) return [];
    const q = landUseQuery.trim().toLowerCase();
    if (!q) return landUses;
    return landUses.filter((lu) =>
      lu.code.toLowerCase().includes(q) ||
      lu.name.toLowerCase().includes(q) ||
      lu.unitShort.toLowerCase().includes(q),
    );
  }, [landUses, landUseQuery]);

  // Address → coordinates UI state. Cold-click visitors think in
  // addresses, not lat/lon; the geocoder lets them paste "1100 Peachtree
  // St, Atlanta GA" and skip the coordinate lookup that was bouncing
  // them. Resolved address is shown back so they can confirm the right
  // place was picked.
  const [addressQuery, setAddressQuery] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);

  async function resolveAddress() {
    const q = addressQuery.trim();
    if (q.length < 3) {
      setGeocodeError("Type at least a few characters of an address.");
      return;
    }
    setGeocoding(true);
    setGeocodeError(null);
    setFormError(null);
    try {
      const r = await fetch("/tis-api/demo/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await r.json();
      if (!r.ok) {
        setGeocodeError(String(data?.error ?? "Couldn't look that up."));
        setResolvedAddress(null);
        return;
      }
      setLatitude(String(data.latitude));
      setLongitude(String(data.longitude));
      setResolvedAddress(String(data.displayName ?? q));
    } catch {
      setGeocodeError("Couldn't reach the address lookup. Try again or paste coordinates directly.");
    } finally {
      setGeocoding(false);
    }
  }

  const activeLandUse = useMemo(
    () => landUses?.find((lu) => lu.code === landUseCode) ?? null,
    [landUses, landUseCode],
  );

  // The unit short the form is currently sized in — primary by default,
  // secondary when the user picked an alternate from the variable picker.
  // Used to scope the size input label, quick-size chips, and radius
  // recommendation.
  const activeUnitShort = useMemo(() => {
    if (!activeLandUse) return "";
    if (independentVariable && activeLandUse.secondaryVariables?.some((v) => v.unitShort === independentVariable)) {
      return independentVariable;
    }
    return activeLandUse.unitShort;
  }, [activeLandUse, independentVariable]);

  const activeVariableMeta = useMemo<SecondaryVariable | null>(() => {
    if (!activeLandUse || !independentVariable) return null;
    return activeLandUse.secondaryVariables?.find((v) => v.unitShort === independentVariable) ?? null;
  }, [activeLandUse, independentVariable]);

  // Project-name → land-use-code hint. Only surfaces when the matched code is
  // DIFFERENT from the current selection — no point telling the user "did
  // you mean 310 Hotel?" if they already picked 310.
  const nameHint = useMemo(() => {
    const h = suggestIteCodeForName(projectName);
    if (!h) return null;
    if (h.code === landUseCode) return null;
    // Only surface when we actually have the suggested code in the menu.
    if (!landUses?.some((lu) => lu.code === h.code)) return null;
    return h;
  }, [projectName, landUseCode, landUses]);

  // Size-based radius recommendation. Only surfaces when the user's current
  // radius differs from the recommendation by ≥0.25 mi — small deltas aren't
  // worth a nag.
  const recommendedRadius = useMemo(() => {
    const sz = Number(size);
    if (!Number.isFinite(sz) || sz <= 0 || !activeUnitShort) return null;
    const rec = recommendRadiusMi(landUseCode, activeUnitShort, sz);
    if (Math.abs(rec - studyRadiusMi) < 0.25) return null;
    return rec;
  }, [size, landUseCode, activeUnitShort, studyRadiusMi]);

  // Size quick-pick chips, scoped to the active code + chosen unit. Empty
  // array when there's no useful suggestion (e.g. unknown alternate unit).
  const quickSizes = useMemo<number[]>(() => {
    if (!activeLandUse || !activeUnitShort) return [];
    return quickSizesFor(landUseCode, activeUnitShort);
  }, [activeLandUse, landUseCode, activeUnitShort]);

  // Persist the form state to localStorage so navigating away and back
  // doesn't lose work. Only persist when the user has typed something
  // meaningful (avoids polluting localStorage on first page hit).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const draft: Partial<StudyForm> = {
      projectName,
      latitude: Number(latitude),
      longitude: Number(longitude),
      landUseCode,
      size: Number(size),
      openingYear: Math.trunc(Number(openingYear)) || currentYear + 1,
      studyRadiusMi,
      independentVariable: independentVariable || undefined,
      studyTier,
    };
    const hasContent =
      projectName.trim() !== "" || latitude !== "" || longitude !== "" || size !== "";
    try {
      if (hasContent) {
        window.localStorage.setItem(DEMO_FORM_LOCALSTORAGE_KEY, JSON.stringify(draft));
      } else {
        window.localStorage.removeItem(DEMO_FORM_LOCALSTORAGE_KEY);
      }
    } catch {
      // Quota / disabled storage / private browsing — silently ignore;
      // persistence is a convenience, not a correctness requirement.
    }
  }, [projectName, latitude, longitude, landUseCode, size, openingYear, studyRadiusMi, independentVariable, studyTier, currentYear]);

  // Reset the independent variable when the user picks a different land use
  // — the unitShort that was valid for the old code may not exist on the new one.
  useEffect(() => {
    if (!activeLandUse || !independentVariable) return;
    const valid =
      independentVariable === activeLandUse.unitShort ||
      activeLandUse.secondaryVariables?.some((v) => v.unitShort === independentVariable);
    if (!valid) setIndependentVariable("");
  }, [activeLandUse, independentVariable]);

  function applyPreset(p: Preset) {
    // Reflect the preset in the form for visual feedback...
    setProjectName(p.prefill.projectName);
    setLatitude(String(p.prefill.latitude));
    setLongitude(String(p.prefill.longitude));
    setLandUseCode(p.prefill.landUseCode);
    setSize(String(p.prefill.size));
    // Presets always use the primary variable; reset any leftover secondary.
    setIndependentVariable("");
    setFormError(null);
    // ...and immediately run the study. Cold-click visitors from cold
    // outreach were clicking a preset, seeing the form populate, not
    // realizing they had to ALSO press "Run study," and bouncing. One
    // click should produce a real result; the form below stays editable
    // for re-runs on the visitor's own coords.
    onRun({
      projectName: p.prefill.projectName,
      latitude: p.prefill.latitude,
      longitude: p.prefill.longitude,
      landUseCode: p.prefill.landUseCode,
      size: p.prefill.size,
      openingYear: Math.trunc(Number(openingYear)) || currentYear + 1,
      studyRadiusMi,
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const lat = Number(latitude);
    const lon = Number(longitude);
    const sz = Number(size);
    const yr = Number(openingYear);

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setFormError(`Latitude must be a number between -90 and 90.`);
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      setFormError(`Longitude must be a number between -180 and 180.`);
      return;
    }
    if (!landUseCode || !landUses?.some((lu) => lu.code === landUseCode)) {
      setFormError("Pick a land use.");
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
      studyRadiusMi,
      independentVariable: independentVariable || undefined,
      studyTier,
    });
  }

  /** Nudge the geocoded coordinate by ±deltaDeg in lat/lon. Used by the
   *  "Use a different coordinate near here" mini-editor when the geocoded
   *  address landed at a different corner of a large parcel than the
   *  developer actually means. ~0.01° ≈ 1.1 km north-south. */
  function nudgeCoord(field: "lat" | "lon", deltaDeg: number) {
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (field === "lat") {
      setLatitude((lat + deltaDeg).toFixed(4));
    } else {
      setLongitude((lon + deltaDeg).toFixed(4));
    }
  }

  const inputCls =
    "w-full px-3 py-2 text-sm rounded-md border border-border bg-background " +
    "focus:outline-none focus:ring-2 focus:ring-blue-700/30 focus:border-blue-700 " +
    "font-mono tabular-nums";
  const labelCls = "block text-[11px] uppercase tracking-[0.16em] font-mono text-muted-foreground mb-1.5";

  return (
    <form onSubmit={submit} className="space-y-6">
      {resolvedRegion && (
        <div className="rounded-md border border-blue-700/30 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 flex items-start gap-3">
          <MapPin className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <div className="font-semibold text-foreground">
              Looks like you're near {resolvedRegion.displayName}
              {resolvedRegion.city ? ` (${resolvedRegion.city})` : ""}.
            </div>
            <div className="text-muted-foreground mt-0.5">
              Localized examples for your metro are shown first below — click any to fill the form, or enter your own site coordinates.
            </div>
          </div>
        </div>
      )}

      {/* One-click sample runs — clicking any preset auto-fills the form
          AND launches the study immediately. This is the on-ramp for
          cold-click visitors who don't have a specific site in hand. */}
      {presets && presets.length > 0 && (
        <div className="rounded-xl border-2 border-blue-700/40 bg-blue-50/60 dark:bg-blue-950/40 p-5 space-y-3">
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            <div className="font-mono text-xs uppercase tracking-[0.16em] font-semibold text-blue-800 dark:text-blue-300">
              Run a sample TIS · one click launches
            </div>
            <div className="text-[11px] text-muted-foreground">
              {presets.length} starting points
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {presets.map((p) => {
              // Localized presets carry IDs like local_<region>_<verb>;
              // strip the prefix so the verb resolves to the right icon
              // ("multifamily"→Building2, "office"→Briefcase, etc.).
              const iconKey = p.id.startsWith("local_")
                ? p.id.split("_").slice(-1)[0] ?? p.id
                : p.id;
              const Icon = ICONS[iconKey] ?? Building2;
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
            Any of our 300 covered metros worldwide
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

          {/* Address → coords. The fast path for cold-click visitors:
              type an address, click Find, lat/lon auto-fill. The
              lat/lon row below stays editable for power-users who
              know exact coords or want to override the geocode. */}
          <div>
            <label htmlFor="demo-address" className={labelCls}>
              Site address <span className="text-muted-foreground/60 normal-case">(fastest path)</span>
            </label>
            <div className="flex gap-2">
              <input
                id="demo-address"
                type="text"
                value={addressQuery}
                onChange={(e) => setAddressQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void resolveAddress();
                  }
                }}
                placeholder="e.g. 1100 Peachtree St NE, Atlanta GA"
                className={inputCls + " font-sans flex-1"}
                data-testid="input-address"
                disabled={geocoding}
              />
              <button
                type="button"
                onClick={() => void resolveAddress()}
                disabled={geocoding || addressQuery.trim().length < 3}
                className="px-4 py-2 text-sm font-semibold rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                data-testid="button-geocode"
              >
                {geocoding ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking up</>
                ) : (
                  <><MapPin className="w-3.5 h-3.5" /> Find</>
                )}
              </button>
            </div>
            {resolvedAddress && !geocodeError && (
              <div className="mt-1.5 text-[11px] text-muted-foreground flex items-start gap-1.5">
                <FileCheck2 className="w-3 h-3 text-emerald-600 shrink-0 mt-0.5" />
                <span className="truncate" title={resolvedAddress}>
                  Resolved: {resolvedAddress}
                </span>
              </div>
            )}
            {geocodeError && (
              <div className="mt-1.5 text-[11px] text-red-600 flex items-start gap-1.5">
                <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                <span>{geocodeError}</span>
              </div>
            )}
          </div>

          {/* Coords — auto-filled by the address lookup above, or
              editable directly for power-users. */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="demo-lat" className={labelCls}>Latitude</label>
              <input
                id="demo-lat"
                type="number"
                step="0.0001"
                min={-90}
                max={90}
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
                min={-180}
                max={180}
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                placeholder="-84.3848"
                className={inputCls}
                required
                data-testid="input-longitude"
              />
            </div>
          </div>

          {/* Nudge controls for projects where the geocoded address sits on
              the wrong corner of a large parcel (DRI-scale developments,
              entire blocks). 0.01° ≈ 1.1 km north-south; 0.001° ≈ 110 m. */}
          {latitude && longitude && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground -mt-2">
              <span>Nudge coordinate:</span>
              <button type="button" onClick={() => nudgeCoord("lat", 0.001)} className="px-1.5 py-0.5 rounded border border-border hover:border-foreground/40 font-mono">N+</button>
              <button type="button" onClick={() => nudgeCoord("lat", -0.001)} className="px-1.5 py-0.5 rounded border border-border hover:border-foreground/40 font-mono">S+</button>
              <button type="button" onClick={() => nudgeCoord("lon", 0.001)} className="px-1.5 py-0.5 rounded border border-border hover:border-foreground/40 font-mono">E+</button>
              <button type="button" onClick={() => nudgeCoord("lon", -0.001)} className="px-1.5 py-0.5 rounded border border-border hover:border-foreground/40 font-mono">W+</button>
              <span className="text-muted-foreground/60">(±110 m steps — useful for large parcels)</span>
            </div>
          )}

          {/* Study radius — how far from the site to sweep for affected
              signals. Slider 0.25 → 3.0 mi (demo cap). Most prospects
              leave this alone, but the option is here for larger sites. */}
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-1.5">
              <label htmlFor="demo-radius" className={labelCls + " mb-0"}>
                Study radius
              </label>
              <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
                {studyRadiusMi.toFixed(2)} mi
              </span>
            </div>
            <input
              id="demo-radius"
              type="range"
              min={0.25}
              max={3}
              step={0.25}
              value={studyRadiusMi}
              onChange={(e) => setStudyRadiusMi(Number(e.target.value))}
              className="w-full accent-blue-700"
              data-testid="input-radius"
            />
            <div className="flex justify-between mt-1 font-mono text-[10px] text-muted-foreground tabular-nums">
              <span>0.25 mi</span>
              <span>1.5 mi</span>
              <span>3.0 mi</span>
            </div>
            {recommendedRadius !== null && (
              <button
                type="button"
                onClick={() => setStudyRadiusMi(recommendedRadius)}
                className="mt-1.5 text-[11px] text-blue-700 hover:text-blue-800 inline-flex items-center gap-1"
                data-testid="button-radius-recommend"
              >
                ⤷ Recommend {recommendedRadius.toFixed(2)} mi for this project scale
              </button>
            )}
          </div>

          {/* Deliverable tier. Most consultants leave this on Auto and let
              the backend resolver pick from project size + host-jurisdiction
              thresholds (Gwinnett 4-level / TxDOT TSP Ch. 16 / CDOT TDM
              Tiers / OPR screening cascade / FDOT MTSIH planning vs.
              detailed / DfT 2007 Annex B). The explicit values are here
              for jurisdictions that occasionally ask for a different shape
              than the auto-resolver picks. */}
          <div>
            <label htmlFor="demo-tier" className={labelCls}>
              Deliverable tier
            </label>
            <select
              id="demo-tier"
              value={studyTier}
              onChange={(e) => setStudyTier(e.target.value as StudyTier)}
              className="w-full px-3 py-2 rounded border border-border bg-background text-foreground focus:border-blue-700 focus:outline-none text-sm"
              data-testid="select-study-tier"
            >
              <option value="auto">Auto — pick from project size + jurisdiction</option>
              <option value="worksheet">Worksheet / Screening Letter (smallest projects)</option>
              <option value="abbreviated">Abbreviated TIS (mid-tier projects)</option>
              <option value="full">Full Traffic Impact Study (large projects)</option>
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Auto reads the host jurisdiction's published thresholds. Override
              when a reviewing agency asks for a specific deliverable shape.
            </p>
          </div>

          {/* Project name → land-use-code hint. Surfaced as a small pill above the
              dropdown when the user's project name unambiguously points to a
              specific code and they haven't picked that code yet. */}
          {nameHint && (
            <button
              type="button"
              onClick={() => setLandUseCode(nameHint.code)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-blue-700/40 bg-blue-50 dark:bg-blue-950/30 text-xs text-blue-800 dark:text-blue-300 hover:border-blue-700 transition-colors"
              data-testid="button-name-hint"
            >
              <Sparkles className="w-3 h-3" />
              Did you mean <span className="font-mono">LU {nameHint.code}</span>{" "}
              <span className="font-semibold">{nameHint.label}</span>?
            </button>
          )}

          {/* Land use + size + year */}
          <div className="grid sm:grid-cols-12 gap-4">
            <div className="sm:col-span-6 relative">
              <label htmlFor="demo-landuse" className={labelCls}>
                Land use {landUses === null && <span className="text-muted-foreground/60">(loading…)</span>}
                {landUsesError && (
                  <button type="button" onClick={onReload} className="ml-2 normal-case text-amber-600 underline hover:no-underline">
                    {landUsesError.includes("fallback") ? "Using fallback list · retry" : "retry"}
                  </button>
                )}
              </label>
              <button
                id="demo-landuse"
                type="button"
                onClick={() => setLandUseOpen((v) => !v)}
                disabled={!landUses || landUses.length === 0}
                className={inputCls + " font-sans text-left flex items-center justify-between gap-2"}
                data-testid="input-landuse"
              >
                <span className="truncate">
                  {activeLandUse ? `${activeLandUse.code} · ${activeLandUse.name}` : "Select land use"}
                </span>
                <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${landUseOpen ? "rotate-180" : ""}`} />
              </button>
              {landUseOpen && (
                <>
                  {/* Click-outside backdrop. z-30 so it sits above the
                      form but below the dropdown panel (z-40). */}
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => { setLandUseOpen(false); setLandUseQuery(""); }}
                    aria-hidden
                  />
                  <div className="absolute z-40 mt-1 w-full bg-background border border-border rounded-md shadow-lg overflow-hidden">
                    <div className="p-2 border-b border-border bg-slate-50 dark:bg-slate-950/40">
                      <input
                        type="text"
                        autoFocus
                        value={landUseQuery}
                        onChange={(e) => setLandUseQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setLandUseOpen(false);
                            setLandUseQuery("");
                          } else if (e.key === "Enter" && filteredLandUses.length > 0) {
                            e.preventDefault();
                            setLandUseCode(filteredLandUses[0]!.code);
                            setLandUseOpen(false);
                            setLandUseQuery("");
                          }
                        }}
                        placeholder="Search by code, name, or unit (museum, theater, ksf…)"
                        className="w-full px-3 py-1.5 text-sm rounded-sm border border-border bg-background focus:outline-none focus:ring-2 focus:ring-blue-700/30 focus:border-blue-700 font-sans"
                        data-testid="input-landuse-search"
                      />
                    </div>
                    <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
                      {filteredLandUses.length === 0 ? (
                        <li className="px-3 py-4 text-xs text-muted-foreground text-center">
                          No land uses match "{landUseQuery}".
                        </li>
                      ) : (
                        filteredLandUses.map((lu) => (
                          <li key={lu.code}>
                            <button
                              type="button"
                              onClick={() => {
                                setLandUseCode(lu.code);
                                setLandUseOpen(false);
                                setLandUseQuery("");
                              }}
                              className={
                                "w-full text-left px-3 py-1.5 text-sm hover:bg-accent transition-colors flex items-baseline justify-between gap-3 " +
                                (lu.code === landUseCode ? "bg-blue-50/60 dark:bg-blue-950/30 font-semibold" : "")
                              }
                              role="option"
                              aria-selected={lu.code === landUseCode}
                            >
                              <span className="truncate">
                                <span className="font-mono text-xs text-muted-foreground tabular-nums">{lu.code}</span>
                                <span className="ml-2">{lu.name}</span>
                              </span>
                              <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                                {lu.unitShort}
                              </span>
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                    <div className="px-3 py-1.5 border-t border-border bg-slate-50 dark:bg-slate-950/40 font-mono text-[10px] text-muted-foreground flex items-center justify-between">
                      <span>{filteredLandUses.length} of {landUses?.length ?? 0} shown</span>
                      <span>Enter to pick · Esc to close</span>
                    </div>
                  </div>
                </>
              )}
              {/* Unit picker — surfaces when a code publishes (or our
                  table derives) more than one independent variable for the
                  chosen code. Sizing a hotel by occupied rooms instead of
                  rooms, an office by employees instead of ksf, a church by
                  weekly attendees — all map cleanly to the right rate set
                  via TisRequest.independentVariable. Empty selection ⇒
                  primary unit (the original demo behavior). */}
              {activeLandUse && (activeLandUse.secondaryVariables?.length ?? 0) > 0 && (
                <div className="mt-2 space-y-1 p-2.5 rounded-md bg-blue-50/60 dark:bg-blue-950/30 border border-blue-700/30">
                  <div className="text-[11px] font-semibold text-blue-800 dark:text-blue-300">
                    Measure this project by:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setIndependentVariable("")}
                      className={
                        "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border transition-colors " +
                        (independentVariable === ""
                          ? "bg-foreground text-background border-foreground"
                          : "bg-background text-foreground border-border hover:border-foreground/40")
                      }
                      data-testid="button-variable-primary"
                    >
                      <span className="font-mono text-[10px] text-muted-foreground">{activeLandUse.unitShort}</span>
                      <span>{activeLandUse.unit}</span>
                    </button>
                    {(activeLandUse.secondaryVariables ?? []).map((v) => (
                      <button
                        key={v.unitShort}
                        type="button"
                        onClick={() => setIndependentVariable(v.unitShort)}
                        title={v.note ?? ""}
                        className={
                          "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs border transition-colors " +
                          (independentVariable === v.unitShort
                            ? "bg-foreground text-background border-foreground"
                            : "bg-background text-foreground border-border hover:border-foreground/40")
                        }
                        data-testid={`button-variable-${v.unitShort}`}
                      >
                        <span className="font-mono text-[10px] text-muted-foreground">{v.unitShort}</span>
                        <span>{v.unit}</span>
                        {v.confidence === "interpolated" && (
                          <span className="font-mono text-[9px] text-amber-700 dark:text-amber-400" title="Derived rate — see methodology">~</span>
                        )}
                      </button>
                    ))}
                  </div>
                  {activeVariableMeta?.confidence === "interpolated" && activeVariableMeta?.note && (
                    <div className="text-[10px] text-amber-700 dark:text-amber-400 leading-snug">
                      Derived rate — {activeVariableMeta.note}. Recorded in the report's methodology.
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="sm:col-span-3">
              <label htmlFor="demo-size" className={labelCls}>
                Size {activeLandUse && <span className="text-muted-foreground/60 normal-case">({activeUnitShort})</span>}
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
              {/* Quick-pick size chips — one-click fills the size field with
                  a "what does a typical project look like" value for this
                  land use + chosen unit. Cuts the keystrokes needed to run
                  the demo from ~6 to 1 for ballpark studies. */}
              {quickSizes.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {quickSizes.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setSize(String(v))}
                      className={
                        "inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-mono tabular-nums border transition-colors " +
                        (String(v) === size
                          ? "bg-blue-700 text-white border-blue-700"
                          : "bg-background text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground")
                      }
                      data-testid={`button-size-${v}`}
                    >
                      {v.toLocaleString()}
                    </button>
                  ))}
                  <span className="text-[10px] text-muted-foreground/60 font-mono">
                    {activeUnitShort}
                  </span>
                </div>
              )}
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
              Coordinates must fall inside one of our 300 covered metros.
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
      "Calculating public-data trip generation",
      "Running signalized capacity analysis",
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
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  async function downloadPdf() {
    setPdfLoading(true);
    setPdfError(null);
    try {
      const res = await fetch("/tis-api/demo/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          projectName: response.projectName,
          latitude: response.latitude,
          longitude: response.longitude,
          landUseCode: response.landUseCode,
          size: response.size,
          openingYear: response.openingYear,
          studyRadiusMi: response.studyRadiusMi,
        }),
      });
      if (!res.ok) {
        // Server returns JSON for errors; binary for success.
        const ct = res.headers.get("content-type") ?? "";
        const msg = ct.includes("application/json")
          ? ((await res.json())?.error ?? `HTTP ${res.status}`)
          : `HTTP ${res.status}`;
        throw new Error(msg);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safe = response.projectName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
      a.download = `${safe || "tis-demo"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : "PDF download failed.");
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <div className="space-y-10">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          >
            ← Run a different study
          </button>
          <button
            type="button"
            onClick={downloadPdf}
            disabled={pdfLoading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
          >
            {pdfLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating PDF…
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Download this report as PDF
              </>
            )}
          </button>
        </div>
        {pdfError && (
          <div className="text-xs text-red-700 dark:text-red-400 inline-flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" /> {pdfError}
          </div>
        )}
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground pt-2">
          Your demo result · full analysis
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          {response.projectName}
        </h1>
        <p className="text-sm text-muted-foreground font-mono">
          {response.latitude.toFixed(4)}, {response.longitude.toFixed(4)}
          {response.regionName ? ` · ${response.regionName}` : ""} ·{" "}
          {response.landUseName} (LU {response.landUseCode}) ·{" "}
          {response.size.toLocaleString()} {response.landUseUnitShort}
        </p>
        <p className="text-sm text-muted-foreground">
          Generated against indexed regional traffic data · NHTS 2017 / SANDAG 2002 / NCHRP 716 · Webster/Akçelik · MUTCD
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
          note={`${tg.landUseName} (LU ${tg.landUseCode}) · ${tg.size.toLocaleString()} ${tg.unit}`}
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

      {/* Conversion CTA — same hairline-panel treatment as the home FinalCta */}
      <section className="border border-border bg-slate-50 dark:bg-slate-950/40 px-6 sm:px-10 py-10 sm:py-12">
        <div className="grid lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-8 space-y-3">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Save it, brand it, send it.
            </h2>
            <p className="text-muted-foreground text-lg leading-relaxed max-w-xl">
              This screening ran once and isn't saved anywhere. A free
              account lets you keep studies, point the same engine at as
              many sites as you want, and download white-labeled PDFs with
              your firm's logo and PE stamp block on the cover. No credit
              card.
            </p>
          </div>
          <div className="lg:col-span-4 flex flex-col sm:flex-row lg:flex-col gap-3">
            <Link
              href="/signup?plan=trial"
              className="group inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
            >
              Sign up free
              <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold rounded-lg border border-border hover:bg-accent transition-colors"
            >
              See plans
            </Link>
          </div>
        </div>
      </section>
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
        what gets assigned to off-site intersections after pass-by and ULI
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
          label="Published capacity math"
          body="Webster/Akçelik delay — the same open formulations US practice is built on."
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
