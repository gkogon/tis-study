// TIS-in-a-box — Traffic Impact Study generator (Phase 1, deepened).
//
// Phase-1 capabilities (over the original screening report):
//   - Multi-period analysis: AM peak, PM peak, Saturday midday, daily totals.
//   - Approach-level HCM analysis: NB/SB/EB/WB v/c, delay, LOS, 95th-pct queue.
//   - Background-growth multiplier on existing volume to opening year.
//   - Weather adjustment (HCM Ch. 11) on capacity (rain/snow severity).
//   - Pass-by + internal-capture credits before off-site assignment
//     (standard pass-by methodology; ULI Mixed-Use Internal Capture).
//   - Monte-Carlo sensitivity analysis (100 iterations) over trip-rate and
//     existing-volume uncertainty.
//   - Project templates (frontend; engine just needs the LU rates).
//
// All math remains transparent. Constants are either public-data average trip
// rates (SANDAG 2002 / NHTS 2017 / NCHRP 716), HCM thresholds, or
// clearly-stated engineering assumptions.

import { logger } from "./logger";
import {
  intersectionsWithinRadius,
  nearestNIntersections,
  nearestFallbackNote,
  dedupCloseSignals,
  forceIncludeIntersections,
  coverageWarningForCandidates,
  haversineMeters,
  SNAP_MAX_MI,
  type ForceIncludeInput,
  type CoverageWarning,
  type CoverageNote,
} from "./intersection-coverage";
import { matchIntersectionByName } from "./synchro-name-match";
import { getAutoModeShare, getAutoModeShareSource, getLondonAutoModeShare, type PTALBand } from "./mode-share";
import { lookupLondonPtal } from "./tfl-ptal";
import { loadCalibrationMap } from "./tis-calibration";
import { modeChoiceLogit, type DemandZone } from "./four-step-model";
import { type CardinalDir } from "./caltran-gravity";
import { fetchLocalRoads, assignRoutes, assignRoutesWithTurns, assignWithDriveways, buildGraph, directedReachability, type ConservationReport, type RouteAssignment, type DrivewayAssignment, type DrivewayResult, type TurnFlow } from "./network-assignment";
import { selectCordonGateways, snapSignalsToJunctions } from "./cordon-gateways";
import { type Driveway } from "./driveways";
import { getTransitContext } from "./transit-routes";
import { ATLANTA_METRO, regionForCoordinate, type Region } from "./regions";
// The pure engine core (lib/tis-engine-core): HCM delay / LOS / queue math,
// Webster timing, the geometric movement assignment, the land-use registry,
// measured growth rates, the UTDF reader, the volume-plausibility guard,
// turbo-lane screening, the per-row math (buildAffectedRow and its helpers),
// the mitigation verdict and per-period trip generation. Everything here that
// touches the network, the db, the region assets or the logger stays in this
// file; the row arithmetic itself lives in the package so the browser can
// re-solve a study with the engine's own code.
import {
  // signal-delay
  type Los,
  delayToLos,
  vcToDelay,
  queue95Ft,
  CRITICAL_MOVEMENT_FRACTION,
  PER_INTERSECTION_CAPACITY_VPH,
  APPROACH_CAPACITY_VPH,
  // regional-growth-rates
  DESIGN_YEAR_HORIZON_DEFAULT,
  GROWTH_OVERRIDE_PREFIX,
  getMeasuredGrowthRate,
  getMeasuredGrowthSource,
  // land-uses — canonical public-data registry (SANDAG 2002 / NHTS 2017 /
  // NCHRP 716). Re-exported below for any downstream callers that imported
  // `LAND_USES` from this module.
  LAND_USES,
  resolveRatesForVariable,
  type LandUse,
  type ResolvedRates,
  type RateConfidence,
  // movement-assignment
  type PathTurnShare,
  // volume-plausibility / trip-loading
  implausibleVolumeDisclosures,
  intersectionLoadFraction,
  // row-math
  type Weather,
  WEATHER_FACTOR,
  type AnalysisPeriod,
  PERIOD_VOLUME_FACTOR,
  type Direction,
  bearingDeg,
  mulberry32,
  type AnalyzerIntersection,
  type UtdfMovementValues,
  type UtdfIntersectionInput,
  type SignalTimingOverrideInput,
  type ApproachImpact,
  type LaneGroupImpact,
  type AffectedIntersection,
  type SignalTimingProvenance,
  utdfMeasuredTotals,
  laneGroupsForApproach,
  type ScenarioParams,
  buildAffectedRow,
  clamp,
  round1,
  round2,
  // mitigation
  SCREENING_DELAY_DELTA_MINOR_SEC,
  SCREENING_DELAY_DELTA_MODERATE_SEC,
  // trips
  periodRawTrips,
  periodDirectionalIn,
  externalTripsForPeriod,
} from "@workspace/tis-engine-core";
import {
  computeTripDistribution,
  type DistributionMethod,
  type TripDistributionSummary,
  type TripDistributionCtx,
  type GravityZoneInput,
  type DistributionCandidateMeta,
} from "./trip-distribution";
// Lazy: the module import is cheap; blockGroupAt() parses the ~12 MB national
// TAZ asset only on first call, which happens only for surrogate-method studies.
import { blockGroupAt, nationalTazAvailable } from "./national-block-group-taz";
// UK Census journey-to-work OD (2011 WU03EW, Greater London). Lazy: the asset is
// parsed on first computeOdAffinity() call, only for UK surrogate-method studies.
import { computeOdAffinity, ukOdAvailable } from "./greater-london-msoa-od";

export { LAND_USES, resolveRatesForVariable, type LandUse, type ResolvedRates, type RateConfidence };
// Re-export the delay model for back-compat (turbo-lane.ts / uk-capacity.ts and
// any other consumer that imported these from "./tis").
export { delayToLos, vcToDelay, queue95Ft };
export type { Los };
// Back-compat for everything this module declared before the row math moved to
// lib/tis-engine-core: the types the routes, renderers and check scripts read
// through "./tis", the lane-group splitter, and the screening thresholds.
export type {
  Weather,
  AnalysisPeriod,
  Direction,
  UtdfMovementValues,
  UtdfIntersectionInput,
  SignalTimingOverrideInput,
  ApproachImpact,
  LaneGroupImpact,
  AffectedIntersection,
  SignalTimingProvenance,
};
export { laneGroupsForApproach, SCREENING_DELAY_DELTA_MINOR_SEC, SCREENING_DELAY_DELTA_MODERATE_SEC };

export function getLandUse(code: string): LandUse | undefined {
  return LAND_USES.find((l) => l.code === code);
}

// HCM LOS thresholds, capacity constants, and the delay/queue model live in
// ./signal-delay (imported + re-exported above).

// Net PM-peak car-mode external-trip count below which renderers are
// expected to demote junction-capacity analysis to a screening appendix
// and lead §5.4 with a trip-comparison narrative instead. Calibrated
// against three published London residential TAs (PTAL band → DU count
// → junctions modelled):
//   - Registry Beckenham — PTAL 5,  134 DU → 0 junctions, trip-comparison only
//   - Hyde Estate        — PTAL 2,  115 DU → 0 junctions, trip-comparison only
//   - Holloway           — PTAL 6a, 985 DU → 3 junctions, ONLY because
//     the scheme proposes new site accesses plus a TLRN junction
//     (Camden Road / Parkhurst Road / Hillmarton Road).
// Below ~15 PM-peak car trips the published convention is trip-
// comparison, not capacity modelling. Surfaced as a single constant so
// future calibration can move it without hunting renderer code. Tracks
// PTAL-banded mode share (mode-share.ts getLondonAutoModeShare): at
// PTAL 6a, 100 dwellings yields ~2 PM car trips — well below this
// threshold, which is the intended behavior.
const JUNCTION_IMPACT_PM_TRIP_THRESHOLD = 15;

const PERIOD_LABEL: Record<AnalysisPeriod, string> = {
  am_peak: "AM Peak Hour",
  pm_peak: "PM Peak Hour",
  saturday_midday: "Saturday Midday",
  daily: "Daily Total",
};

// Trip distribution + route assignment now live in four-step-model.ts
// (NCHRP-716 gamma-friction gravity model + BPR capacity-constrained
// assignment), wired into generateTisReport below.

// ---------- Intersection-summary fetch from analyzer ----------

const ANALYZER_BASE_URL = process.env["ANALYZER_API_URL"] ?? "http://localhost:8080";

// Per-region caches. The Atlanta cache hydrates from the legacy
// /atlanta/intersections endpoint for back-compat; other regions hydrate
// from the new region-aware /intersections?regionCode=... endpoint.
const intersectionCache = new Map<string, AnalyzerIntersection[]>();
const inFlightByRegion = new Map<string, Promise<AnalyzerIntersection[]>>();
// Large metros (NY, LA, SF, Seattle…) and freshly-loaded regions can take well
// over 5s to serve their intersection inventory on a cold analyzer cache, which
// failed the study outright. Default to 30s and allow tuning via env.
const ANALYZER_FETCH_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env["ANALYZER_FETCH_TIMEOUT_MS"]) || 30000,
);

async function fetchIntersections(regionCode: string = "atlanta_metro"): Promise<AnalyzerIntersection[]> {
  const cached = intersectionCache.get(regionCode);
  if (cached) return cached;
  const existing = inFlightByRegion.get(regionCode);
  if (existing) return existing;

  // Atlanta keeps its legacy URL (rich enrichment); other regions use the
  // region-aware route that serves OSM-synthesized stubs.
  const url = regionCode === "atlanta_metro"
    ? `${ANALYZER_BASE_URL}/api/atlanta/intersections`
    : `${ANALYZER_BASE_URL}/api/intersections?regionCode=${encodeURIComponent(regionCode)}`;

  const promise = (async (): Promise<AnalyzerIntersection[]> => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ANALYZER_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) {
        throw new Error(
          `Failed to fetch intersection inventory from analyzer at ${url}: ${res.status} ${res.statusText}`,
        );
      }
      const json = (await res.json()) as unknown;
      if (!Array.isArray(json)) {
        throw new Error(`Analyzer intersection response was not an array (got ${typeof json}).`);
      }
      const inventory = json as AnalyzerIntersection[];
      intersectionCache.set(regionCode, inventory);
      logger.info({ regionCode, count: inventory.length, url }, "tis.intersections_loaded");
      return inventory;
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `Analyzer intersection inventory fetch timed out after ${ANALYZER_FETCH_TIMEOUT_MS}ms (${url}).`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  })();
  inFlightByRegion.set(regionCode, promise);
  try {
    return await promise;
  } finally {
    inFlightByRegion.delete(regionCode);
  }
}

// ---------- Public report types ----------

export type TisRequest = {
  projectName: string;
  address: string;
  latitude: number;
  longitude: number;
  landUseCode: string;
  size: number;
  openingYear: number;
  studyRadiusMi?: number;
  // Phase 1 additions (all optional → backward compatible)
  analysisPeriods?: AnalysisPeriod[];
  growthRatePct?: number;       // 0..6, default 1.5 % per year
  weather?: Weather;            // default "clear"
  passByPct?: number;           // 0..70, overrides land-use default
  internalCapturePct?: number;  // 0..50, overrides land-use default
  runSensitivity?: boolean;     // default false
  // Independent-variable choice. Matches the primary `unitShort` of the
  // selected land use (default) or the `unitShort` of one of its
  // secondaryVariables (e.g. "emp" to size an office by employees instead
  // of ksf). When unset or unmatched, the primary published variable is
  // used. The chosen variable is surfaced in the report so a reviewing PE
  // can verify the assumption.
  independentVariable?: string;
  // Tier of TIS deliverable to produce. "auto" resolves to one of the
  // three concrete tiers from the project's size + jurisdiction
  // thresholds; the explicit values override the resolver when the
  // consultant has a specific deliverable scope in mind.
  // Default: "auto".
  studyTier?: StudyTier;
  // Optional prior land use on the site, free-text. London residential
  // TAs lean on cumulative-vs-previous-use trip comparison (e.g. "vs the
  // existing office", "vs the prior motor-garage use") whenever the net
  // car-mode peak is small enough that capacity modelling isn't the
  // limiting factor. When set, the London renderer's §5.4 demoted-path
  // prose names this prior use; when unset, the prose scaffolds a TODO
  // for the consultant.
  priorUse?: string;
  // London PTAL band for the site (0, 1a, 1b, 2, 3, 4, 5, 6a, 6b). When
  // supplied for a London project the engine swaps the flat 0.38
  // london_metro auto-mode share for the PTAL-banded curve in
  // mode-share.ts. Unset → flat-average behavior preserved.
  // Lat/lon → PTAL lookup against the TfL 100m grid is the planned
  // follow-up (WebCAT 3.0 / Datastore GIS) — out of scope here.
  ptalBand?: PTALBand;
  // DfT 2007 Appendix B "regardless of size" escalator inputs that the
  // engine itself cannot derive. The London renderer's Appendix B
  // branching uses these to escalate a size-based TS shape back to a
  // TA shape when either trigger applies:
  //   - ptaInsideAqma: the site lies inside or adjacent to a declared
  //     Air Quality Management Area (LAQM under the Environment Act
  //     1995).
  //   - infrastructureAdequacy: the consultant's judgement of whether
  //     local transport infrastructure is adequate to serve the
  //     proposal. "inadequate" forces a TA shape; "adequate" / "unknown"
  //     do not. Mirrors the Appendix B Table 1 escalator language.
  ptaInsideAqma?: boolean;
  infrastructureAdequacy?: "adequate" | "inadequate" | "unknown";
  // Study-intersection scoping. DEFAULT (unset/false): analyze EVERY signalized
  // intersection within `studyRadiusMi` — the radius is the user's stated study
  // scope, honored literally. When true: apply the MTIASD impact scoping
  // (nearest-STUDY_NEAREST_FLOOR + any ≥STUDY_MIN_PM_SITE_TRIPS, no upper cap) to
  // trim the study to the materially-impacted set — the opt-in lean report. To
  // shorten a report the lever is a smaller radius, not silent scoping within the
  // chosen radius.
  scopeStudyIntersections?: boolean;
  // Force-include specific study intersections regardless of `studyRadiusMi` —
  // a reviewer's agreed corridor scope (e.g. an arterial's signals spanning
  // beyond a default 0.5-mi radius). PURELY ADDITIVE: these are UNIONed with the
  // radius set, never removing a signal the radius found, and they survive the
  // opt-in `scopeStudyIntersections` trim. Absent/empty ⇒ byte-identical to
  // today. See findAffectedIntersections + forceIncludeIntersections.
  //   - studyIntersectionIds: analyzer signal ids, matched exactly (unknown
  //     ids are ignored).
  //   - additionalStudyPoints: free coordinates (pasted/map-clicked), each
  //     snapped to the nearest inventory signal within ~0.35 mi. Robust when a
  //     signal's name is unknown (many inventory names are null); points with
  //     no nearby signal are ignored.
  studyIntersectionIds?: string[];
  additionalStudyPoints?: Array<{ latitude: number; longitude: number }>;
  /** Measured turning-movement data imported from a Synchro UTDF file (the
   *  structured records `/utdf/parse` emits — never the raw file text, which
   *  would be echoed into every stored payload). Each record is snapped to
   *  the nearest study candidate within ~0.35 mi (nearest record wins per
   *  signal, ties/losers logged loudly); at matched intersections the
   *  measured volumes replace the AADT-derived existing volumes (growth
   *  still applies on top; PM is the measured anchor hour, other periods
   *  scale by PERIOD_VOLUME_FACTOR), turn-bay storage feeds the
   *  storage-adequacy comparison, and the imported cycle length feeds the
   *  Webster uniform-delay term. Absent ⇒ byte-identical output. */
  utdfIntersections?: UtdfIntersectionInput[];
  distributionMethod?: DistributionMethod;
  /** Existing (prior) land use occupying the site today, for a redevelopment
   *  trip-generation credit. Structured (a LAND_USES code + size), distinct from
   *  the free-text `priorUse` used by the London narrative. When set with a
   *  positive `existingSize`, the existing use's external trips are computed with
   *  the same pipeline and credited against the proposed use, so the report shows
   *  net new external trips. Absent ⇒ greenfield, output unchanged. */
  existingLandUseCode?: string;
  existingSize?: number;
  /** Conserved path assignment (DEFAULT ON): destinations become cordon
   *  gateways on the study boundary (weighted by the printed directional
   *  distribution), project trips are routed through the network, and each
   *  resolvable study intersection's turning movements + approach loading
   *  derive from the actual paths through it — so flow is conserved between
   *  adjacent intersections. Changes v/c, delay and LOS at resolved
   *  intersections (the legacy loading is deliberately un-normalized).
   *  Omitted/true ⇒ conserved assignment runs. Explicit false ⇒ legacy
   *  octant behavior, byte-identical to the old default output. */
  conservedAssignment?: boolean;
  /** Use MEASURED lane counts from an imported Synchro [Lanes] section to size
   *  each lane group's capacity (lanes x saturation flow x g/C), instead of the
   *  one-critical-lane screening assumption. Only ever applies at intersections
   *  whose imported record actually carried lane counts — everywhere else the
   *  output is unchanged either way. Changes v/c, delay-derived LOS inputs and
   *  queue at those intersections. Omitted/true ⇒ measured geometry is used.
   *  Explicit false ⇒ one-critical-lane, byte-identical to the pre-change
   *  output (see scripts/verify-lane-geometry.mjs). */
  realLaneGeometry?: boolean;
  /** Signal timing basis. Omitted / "computed" = per-intersection cycle and
   *  splits from the timing resolver (measured Synchro phases > measured
   *  cycle > Webster from no-build volumes > screening default), capacity
   *  re-derived per approach from that timing. "screening" = the legacy flat
   *  90 s / g/C 0.45 for every intersection, byte-identical to the pre-change
   *  output. */
  signalTiming?: "computed" | "screening";
  /** Site access points with per-movement turn restrictions. When present,
   *  project trips route through these driveways and forbidden movements
   *  reroute onto the network (U-turns). Absent or empty ⇒ single-site
   *  behavior, byte-identical to today. Max 12 driveways. */
  driveways?: Driveway[];
  /** Per-signal TIMING overrides for a what-if scenario (cycle + phase map +
   *  splits, no volumes). Snapped to study signals by the same 0.35-mi /
   *  name rules as utdfIntersections (attachTimingOverrides) and consumed
   *  only as the FIRST provider of the signal-timing resolver, so the
   *  matched row's existing volumes and approach shares are untouched. Every
   *  record's fate is reported on `timingOverrideSummary`. Absent ⇒
   *  byte-identical output. */
  signalTimingOverrides?: SignalTimingOverrideInput[];
};

export type StudyTier = "auto" | "worksheet" | "abbreviated" | "full";
export type ResolvedStudyTier = Exclude<StudyTier, "auto">;
export type { DistributionMethod } from "./trip-distribution";

export type TripGenerationSummary = {
  landUseCode: string;
  landUseName: string;
  size: number;
  unit: string;
  /** Short label for the chosen independent variable (e.g. "ksf", "emp"). */
  unitShort: string;
  /**
   * Provenance of the rate the screening actually used:
   *   - "sandag_2002"  SANDAG 2002 vehicular traffic-generation guide.
   *   - "nhts_2017"    FHWA NHTS 2017 trend table.
   *   - "nchrp_716"    NCHRP Report 716 per-employee/HH parameter table.
   *   - "blended_mpo"  Blended MPO screening guidance (rough — disclosed).
   *   - "interpolated" Derived from a defensible engineering ratio (also
   *                    surfaced via the legal disclaimer).
   * PDF renderers display this in §4 so a reviewing PE can verify the
   * assumption.
   */
  variableConfidence: RateConfidence;
  /** Optional engineering note for the chosen variable. */
  variableNote?: string;
  /**
   * The trip-generation rates actually applied, per unit of the chosen
   * independent variable, plus the free-source provenance string behind them.
   *
   * These exist so a reviewing PE can audit the arithmetic — rate × size ≈
   * trips — instead of taking the trip totals on faith. Before this, the
   * report printed the totals and a provenance TAG but never the rate itself,
   * which made the single most basic check a reviewer performs impossible.
   * Optional so payloads stored before this shipped still parse.
   */
  dailyRate?: number;
  amRate?: number;
  pmRate?: number;
  /** Free-source citation for the applied rate (e.g. the SANDAG 2002 guide). */
  variableSource?: string;
  dailyTrips: number;
  amPeakTrips: number;
  pmPeakTrips: number;
  amIn: number;
  amOut: number;
  pmIn: number;
  pmOut: number;
  /**
   * Existing (prior) land-use redevelopment credit — present only when the
   * request supplied `existingLandUseCode`. `existingUseCreditPm` is the
   * existing use's PM-peak external trips credited against the proposed use;
   * `netNewExternalPm` is the PM-peak net new external trips actually assigned
   * (proposed external − credit, floored at 0).
   */
  existingLandUseCode?: string;
  existingLandUseName?: string;
  existingSize?: number;
  existingUnit?: string;
  existingUseCreditPm?: number;
  netNewExternalPm?: number;
};

export type PeriodTripGen = {
  period: AnalysisPeriod;
  periodLabel: string;
  rawTrips: number;
  passByCredit: number;
  internalCaptureCredit: number;
  externalTrips: number;
  inTrips: number;
  outTrips: number;
  /** Redevelopment credit — present only when the request supplied an existing
   *  land use. `netNewExternalTrips` = externalTrips − existingUseCredit (≥ 0)
   *  and is the count actually assigned to the network. */
  existingUseCredit?: number;
  netNewExternalTrips?: number;
};

export type PeriodReport = {
  period: AnalysisPeriod;
  periodLabel: string;
  tripGeneration: PeriodTripGen;
  affectedIntersections: AffectedIntersection[];
  intersectionsWithLosDrop: number;
  intersectionsAtLosEf: number;
  worstDelayDeltaSec: number;
  // ---- Exact re-solve inputs for this period (unrounded): what the period
  // loop handed buildAffectedRow, so a client can rebuild every row with the
  // engine's code. Net assigned trips = max(0, externalTripsExact −
  // (existingUseCreditExact ?? 0)), the same chain the loop applies.
  periodVolumeFactor: number;
  inFraction: number;
  externalTripsExact: number;
  existingUseCreditExact?: number;
};

export type SensitivityResult = {
  iterations: number;
  worstDelayDeltaMean: number;
  worstDelayDeltaP10: number;
  worstDelayDeltaP50: number;
  worstDelayDeltaP90: number;
  probAnyLosDrop: number;       // share of iterations with ≥1 LOS drop
  probAnyLosEf: number;         // share of iterations with ≥1 LOS E or F
  expectedLosDrops: number;     // mean count of intersections with LOS drop
};

export type TisReport = {
  generatedAt: string;
  request: TisRequest;
  studyRadiusMi: number;
  tripGeneration: TripGenerationSummary;       // PM peak (back-compat)
  affectedIntersections: AffectedIntersection[]; // PM peak (back-compat)
  intersectionsStudied: number;
  /** Total signalized intersections within the study radius (before the
   *  impact-significance scope). `intersectionsStudied` is the analyzed subset. */
  intersectionsInStudyArea: number;
  /** In-radius records merged away as duplicates of a junction already kept. */
  intersectionsMergedAsDuplicates: number;
  intersectionsWithLosDrop: number;
  intersectionsAtLosEf: number;
  worstDelayDeltaSec: number;
  mitigationSummary: string[];
  findings: string[];
  methodology: string[];
  // Phase 1 additions
  periodReports: PeriodReport[];
  growthAppliedPct: number;
  growthYears: number;
  /** Source label for `growthAppliedPct` when it came from measured
   *  historical-AADT data rather than the screening default. Lets
   *  renderers name the derivation in their growth-rate prose. Absent
   *  when the screening default (1.5%/yr) was used. */
  growthSource?: string;
  /** Opening + 20yr design horizon used for the Design-Year scenarios. */
  designYear?: number;
  designYearHorizonYears?: number;
  weather: Weather;
  weatherCapacityFactor: number;
  passByPctApplied: number;
  internalCapturePctApplied: number;
  /** The auto-mode share that was multiplied through to derive net car
   *  trips. Equal to the per-metro default unless a PTAL band was
   *  supplied for a London project, in which case it is the
   *  PTAL-banded value. Surfaced so renderers print the actual share
   *  rather than a hard-coded constant. */
  autoModeShareApplied: number;
  // ---- Exact re-solve inputs (report level): the region strings the text
  // builders print, and the unrounded weather factor the capacity math used.
  regionCode: string;
  jurisdiction: { dotName: string; planningOfficeName: string };
  autoModeShareSource: string;
  weatherFactorExact: number;
  /** The opening-year growth multiplier the engine multiplied existing
   *  volumes by: (1 + growthAppliedPct/100) ^ growthYears. */
  growthMultiplierExact: number;
  /** The design-year growth multiplier the engine used for the Design-Year
   *  scenarios. NOT derivable from growthAppliedPct / growthYears /
   *  designYearHorizonYears alone: the engine grows the design year over
   *  max(0, designYear - currentYear), and growthYears is clamped to 0
   *  whenever openingYear is at or before the current year, so for a past
   *  opening year the design span is shorter than growthYears + horizon.
   *  Printed so a re-solve reproduces the design-year columns exactly. */
  designGrowthMultiplierExact: number;
  /** How request.signalTimingOverrides attached (attachTimingOverrides).
   *  Present whenever the request carried the array, so a what-if client can
   *  always show which overrides took. */
  timingOverrideSummary?: TimingOverrideMatchSummary;
  /** Step-4 network route assignment (which road corridors carry the
   *  project trips). Absent when the region has no road network. */
  routeAssignment?: RouteAssignment;
  /** The PTAL band the engine resolved for this London project, plus
   *  its source. "caller" means `request.ptalBand` was supplied;
   *  "tfl-webcat-2023" means the engine ran a point-in-polygon
   *  lookup against the TfL WebCAT 3.0 PTAL 2023 grid; absent means
   *  no band was resolved (non-London project, outside Greater London,
   *  or the lookup failed and the flat london_metro fallback applied). */
  resolvedPtalBand?: { band: PTALBand; source: "caller" | "tfl-webcat-2023"; ai?: number };
  sensitivity?: SensitivityResult;
  /** True when the project's net PM-peak car-mode external trips meet or
   *  exceed `JUNCTION_IMPACT_PM_TRIP_THRESHOLD`. Renderers (currently
   *  only London) use this to decide whether junction-capacity analysis
   *  earns headline placement (true) or is demoted to a screening
   *  appendix behind a trip-comparison narrative (false). */
  junctionImpactSignificant: boolean;
  /** Set ONLY when the study radius contained no signalized intersection to
   *  analyze — almost always a bad geocode (the coordinate resolved to open
   *  water or an area outside our signal coverage) rather than a real finding.
   *  Absent on every normal study. Routes surface this as a 422 so a user or a
   *  live demo sees a "verify the site location" message instead of a
   *  silently-empty report. See `intersection-coverage.ts`. */
  coverageWarning?: CoverageWarning;
  /** Set ONLY when the study radius contained no signals and the engine fell
   *  back to the nearest-N set (sparse rural/exurban site). The study
   *  succeeded; this is the disclosure that every analyzed intersection sits
   *  beyond the stated radius. Also echoed into `methodology` so every
   *  renderer that prints the methodology list discloses it in the PDF. */
  coverageNote?: CoverageNote;
  /** How the request's imported utdfIntersections records attached to study
   *  signals. Present ONLY when at least one record needed name-based
   *  matching (Synchro-report-PDF import) — UTDF-text-only and non-UTDF
   *  studies keep byte-identical payloads. See attachUtdfData. */
  utdfMatchSummary?: UtdfMatchSummary;
  /** Florida standard: the Caltran mass/distance gravity model + directional
   *  trip distribution. Present ONLY for Florida studies (every other region
   *  keeps the NCHRP-716 gamma distribution and leaves this absent). Drives the
   *  FL renderer's gravity worksheet, directional-distribution figure, and
   *  project-trip assignment. See caltran-gravity.ts. */
  flGravity?: FlGravitySummary;
  /** Region-agnostic trip-distribution summary (all regions). */
  tripDistribution?: TripDistributionSummary;
  /** Driveway access assignment result. Present only when `request.driveways`
   *  was supplied and non-empty AND a road network was available to route
   *  through. Absent ⇒ no driveways or roads unavailable (base LOS unchanged). */
  driveways?: {
    driveways: DrivewayResult[];
    reroutes: { destIndex: number; trips: number }[];
  };
};

/** One zone (study-area intersection) row of the Caltran gravity worksheet. */
export type FlGravityZone = {
  id: string;
  name: string;
  distanceMi: number;
  bearingDeg: number;
  cardinal: CardinalDir;
  /** Gross attraction proxy M (see `FlGravitySummary.massBasis`). */
  mass: number;
  /** M / (d^β · d_site) — the un-normalized gravity pull. */
  term: number;
  /** Percent of project trips distributed to this zone (Σ = 100). */
  sharePct: number;
};

/** Caltran gravity model + directional distribution for a Florida study. */
export type FlGravitySummary = {
  /** Distance decay exponent β used (1 = the Caltran worksheet's linear form). */
  betaExponent: number;
  /** Human-readable description of what the zone mass M represents. */
  massBasis: string;
  /** Every study-area zone, sorted by trip share descending. */
  zones: FlGravityZone[];
  /** Percent of project trips by compass wedge (Σ = 100). */
  byDirection: Record<CardinalDir, number>;
  /** The four aerial-figure quadrant pairs (NNE+ENE, ESE+SSE, SSW+WSW, WNW+NNW). */
  sectors: Record<string, number>;
};

// ---------- Implementation ----------

/** Florida (US) — where the Caltran gravity model is the distribution standard. */
function isFloridaRegion(region: Region): boolean {
  return region.stateCode === "FL" && (region.country ?? "US") === "US";
}

/** UK — distribution methods use UK references (WebTAG/DMRB, TRICS, Census WU03EW). */
function isUkRegion(region: Region): boolean {
  return (region.country ?? "US") === "UK";
}

const CURRENT_YEAR = new Date().getUTCFullYear();

// ---------- Study-intersection scoping (MTIASD study-limit / de-minimis) ----------
//
// findAffectedIntersections returns EVERY signalized intersection within the
// study radius. In a dense urban grid that is dozens (downtown Chicago ≈ 98,
// Midtown ≈ 132 within 0.5 mi), which is not a screening study — a TIS analyzes
// the site-adjacent intersections plus those the site materially impacts, not
// every signal in a circle (ITE MTIASD §2.2, Table 3; the de-minimis rule:
// traffic below ~a handful of added peak-hour trips is not a study intersection).
//
// We keep: (1) the nearest few (site access + adjacent + first signalized in
// each direction), always; plus (2) any intersection the four-step model assigns
// at least STUDY_MIN_PM_SITE_TRIPS PM-peak site trips. The scope therefore scales
// with the project's trip-making — small project → few intersections, large
// project → more — which is exactly the MTIASD Table 3 intent, instead of scaling
// with how dense the surrounding grid happens to be. There is deliberately no
// hard upper cap: within an opted-in scope, every materially-impacted signal is
// carried (the radius is the user's scope; see the "every light" product rule).
// Tunable screening defaults (calibrate against real studies as the corpus grows).
const STUDY_NEAREST_FLOOR = 5;        // immediate study area: site-adjacent + ~first signalized each direction
const STUDY_MIN_PM_SITE_TRIPS = 8;    // de-minimis screening floor: site must assign ≥8 PM-peak trips

// Per-intersection project-trip loading (distance decay). Distinct from the
// gravity DISTRIBUTION (weights): impact/scoping load concentrates at the site
// access, distribution/route-assignment stay gravity-based. See trip-loading.ts.

/**
 * Indices (into a nearest-first `candidates` array) of the study intersections.
 * `loadFractions` is the per-intersection project-trip loading (see
 * intersectionLoadFraction); `pmExternalAutoTrips` the PM-peak auto trips it
 * loads. An intersection is studied if it carries ≥ STUDY_MIN_PM_SITE_TRIPS
 * project trips, plus the nearest-floor always. Pure + deterministic.
 */
function selectStudyIntersectionIdx(loadFractions: number[], pmExternalAutoTrips: number, n: number): number[] {
  const assigned = (i: number): number => (loadFractions[i] ?? 0) * pmExternalAutoTrips;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i < STUDY_NEAREST_FLOOR || assigned(i) >= STUDY_MIN_PM_SITE_TRIPS) idx.push(i);
  }
  return idx;
}

// A study-intersection candidate. `forced` marks a signal pulled in by the
// additive force-include inputs (see forceInclude below) rather than by the
// radius — it is analyzed even when beyond `radiusMi` and is protected from the
// opt-in `scopeStudyIntersections` trim.
type StudyCandidate = {
  sig: AnalyzerIntersection;
  distanceMi: number;
  forced?: boolean;
  /** Measured UTDF record snapped to this signal (attachUtdfData). Presence
   *  gates every measured-data path in buildAffectedRow; absent ⇒ legacy. */
  utdf?: UtdfIntersectionInput;
  /** Index of `utdf` in req.utdfIntersections (echoed as utdfRecordIndex). */
  utdfIndex?: number;
  /** What-if timing override snapped to this signal (attachTimingOverrides).
   *  Read ONLY by the timing resolver's first provider — never for volumes. */
  timingOverride?: SignalTimingOverrideInput;
};

// ---------- UTDF measured-data attachment (opt-in, req.utdfIntersections) ----------

/** How the imported records attached — surfaced on the payload ONLY when the
 *  request carried a record that needed name matching (see generateTisReport),
 *  so legacy UTDF-text studies keep byte-identical payloads. */
export type UtdfMatchSummary = {
  total: number;
  matched: number;
  matchedByCoordinates: number;
  matchedByName: number;
  unmatchedNames: string[];
};

/**
 * Snap measured UTDF records onto the study candidates (mutates `candidates`
 * by setting `utdf` on matched entries), and report how each record fared.
 *
 * TWO MATCHING MODES, coordinates first:
 *
 *  - COORDINATES (UTDF-text records): same proximity contract as the
 *    force-include machinery — a record matches the nearest candidate within
 *    SNAP_MAX_MI (~0.35 mi; client coordinates are 4-dp-rounded ≈ 11 m, far
 *    inside it). dedupCloseSignals can collapse several UTDF nodes onto one
 *    signal, so each candidate keeps ONE record — the nearest.
 *
 *  - NAME (Synchro-report-PDF records, which carry no coordinates): the
 *    record's intersection name must match EXACTLY ONE candidate's inventory
 *    name after normalization (synchro-name-match.ts — separators, suffixes,
 *    ordinals, directionals). A tie matches nothing: a wrong-but-plausible
 *    attachment is worse than none. Name records run AFTER every coordinate
 *    record so coordinates keep priority at a contested signal.
 *
 * Every displaced/unmatched/tied/empty record is logged BY NAME and counted
 * in the returned summary, never silently dropped (the road-parser lesson).
 * Purely additive: no records ⇒ no-op.
 */
function attachUtdfData(
  candidates: StudyCandidate[],
  records: UtdfIntersectionInput[],
): UtdfMatchSummary {
  const snapMaxM = SNAP_MAX_MI * 1609.34;
  const label = (u: UtdfIntersectionInput): string =>
    `${u.name ?? (u.intId !== undefined ? `INTID ${u.intId}` : "unnamed")}` +
    (u.latitude !== undefined && u.longitude !== undefined
      ? ` @ (${u.latitude}, ${u.longitude})`
      : " (no coordinates)");
  const summary: UtdfMatchSummary = {
    total: records.length, matched: 0, matchedByCoordinates: 0, matchedByName: 0, unmatchedNames: [],
  };
  const unmatched = (u: UtdfIntersectionInput): void => {
    summary.unmatchedNames.push(label(u));
  };
  const hasCoords = (u: UtdfIntersectionInput): boolean =>
    typeof u.latitude === "number" && Number.isFinite(u.latitude) &&
    typeof u.longitude === "number" && Number.isFinite(u.longitude);

  // ---- Pass 1: coordinate records (nearest-wins per signal) ----
  // Distance from each candidate to its attached record, for nearest-wins.
  const attachedDistM = new Map<StudyCandidate, number>();
  const nameRecords: Array<{ rec: UtdfIntersectionInput; index: number }> = [];
  for (let index = 0; index < records.length; index++) {
    const rec = records[index]!;
    if (!utdfMeasuredTotals(rec)) {
      logger.warn({ record: label(rec) }, "tis.utdf_record_no_volumes");
      unmatched(rec);
      continue;
    }
    if (!hasCoords(rec)) {
      if (rec.name && rec.name.trim().length > 0) {
        nameRecords.push({ rec, index });
      } else {
        // Neither coordinates nor a name — nothing to match on.
        logger.warn({ record: label(rec) }, "tis.utdf_record_no_coords_no_name");
        unmatched(rec);
      }
      continue;
    }
    let best: StudyCandidate | undefined;
    let bestM = Infinity;
    for (const c of candidates) {
      const dM = haversineMeters(rec.latitude!, rec.longitude!, c.sig.latitude, c.sig.longitude);
      if (dM < bestM) { bestM = dM; best = c; }
    }
    if (!best || bestM > snapMaxM) {
      logger.warn(
        { record: label(rec), nearestM: Math.round(bestM) },
        "tis.utdf_record_unmatched",
      );
      unmatched(rec);
      continue;
    }
    const prevM = attachedDistM.get(best);
    if (prevM !== undefined) {
      // Two UTDF nodes snapped to one (deduped) signal — keep the nearer
      // record, never sum (summing would double-count one junction's traffic).
      if (bestM >= prevM) {
        logger.warn(
          { displaced: label(rec), keptSignal: best.sig.id, keptDistM: Math.round(prevM) },
          "tis.utdf_record_displaced_by_nearer",
        );
        unmatched(rec);
        continue;
      }
      logger.warn(
        { displaced: label(best.utdf!), replacedBy: label(rec), signal: best.sig.id },
        "tis.utdf_record_displaced_by_nearer",
      );
      summary.matchedByCoordinates--;
      summary.matched--;
      unmatched(best.utdf!);
    }
    best.utdf = rec;
    best.utdfIndex = index;
    attachedDistM.set(best, bestM);
    summary.matched++;
    summary.matchedByCoordinates++;
  }

  // ---- Pass 2: name records (unambiguous normalized-name match) ----
  for (const { rec, index } of nameRecords) {
    const result = matchIntersectionByName(rec.name!, candidates, (c) => c.sig.name);
    if (result.kind === "tie") {
      logger.warn(
        {
          record: label(rec),
          tiedSignals: result.candidates.map((c) => `${c.sig.id} "${c.sig.name}"`),
        },
        "tis.utdf_record_name_tie",
      );
      unmatched(rec);
      continue;
    }
    if (result.kind === "none") {
      logger.warn(
        {
          record: label(rec),
          candidateCount: candidates.length,
          nearMisses: result.nearMisses.map((c) => `${c.sig.id} "${c.sig.name}"`),
        },
        "tis.utdf_record_name_unmatched",
      );
      unmatched(rec);
      continue;
    }
    const best = result.candidate;
    if (best.utdf) {
      // A coordinate record (or an earlier name record) already holds this
      // signal — coordinates keep priority; among name records, first wins.
      logger.warn(
        { displaced: label(rec), keptRecord: label(best.utdf), signal: best.sig.id },
        "tis.utdf_record_displaced_by_existing",
      );
      unmatched(rec);
      continue;
    }
    best.utdf = rec;
    best.utdfIndex = index;
    summary.matched++;
    summary.matchedByName++;
  }
  return summary;
}

// ---------- What-if timing overrides (req.signalTimingOverrides) ----------

/** How the request's timing overrides attached. Mirrors the OpenAPI
 *  TimingOverrideMatchSummary schema. Always emitted when the request carried
 *  the array — a what-if client must be able to tell a dropped override from
 *  one that resolved to the same timing. */
export type TimingOverrideMatchSummary = {
  total: number;
  matched: number;
  matchedByCoordinates: number;
  matchedByName: number;
  matches: Array<{ index: number; signalId: string; signalName: string; by: "coordinates" | "name" }>;
  unmatched: Array<{
    index: number;
    label: string;
    reason: "no_signal_within_snap" | "displaced_by_nearer" | "name_tie" | "name_unmatched" | "displaced_by_existing";
  }>;
};

/**
 * Snap what-if timing overrides onto the study candidates (mutates
 * `candidates` by setting `timingOverride` on matched entries). SAME matching
 * rules as attachUtdfData, minus the volume gate (overrides carry none):
 *
 *  - COORDINATES first: nearest candidate within SNAP_MAX_MI (~0.35 mi),
 *    nearest-wins per signal — a second override for the same signal
 *    displaces only if nearer, never merges.
 *  - NAME fallback: an override whose coordinates miss every candidate, when
 *    it carries a name, tries the unambiguous normalized-name match. Ties
 *    match nothing; a signal already holding an override keeps it.
 *
 * Purely additive and timing-only: the attached record is read by exactly one
 * consumer — the first provider of resolveTimingForRow — so a matched signal's
 * existing volumes, approach shares, lane counts and storage are the base
 * study's, byte for byte. No records ⇒ no-op.
 */
function attachTimingOverrides(
  candidates: StudyCandidate[],
  overrides: SignalTimingOverrideInput[],
): TimingOverrideMatchSummary {
  const snapMaxM = SNAP_MAX_MI * 1609.34;
  const label = (o: SignalTimingOverrideInput, index: number): string =>
    `${o.name ?? `override #${index + 1}`} @ (${o.latitude}, ${o.longitude})`;
  const summary: TimingOverrideMatchSummary = {
    total: overrides.length, matched: 0, matchedByCoordinates: 0, matchedByName: 0, matches: [], unmatched: [],
  };
  const attachedDistM = new Map<StudyCandidate, number>();
  const attachedIndex = new Map<StudyCandidate, number>();
  const nameFallback: Array<{ rec: SignalTimingOverrideInput; index: number }> = [];
  const unmatch = (index: number, rec: SignalTimingOverrideInput, reason: TimingOverrideMatchSummary["unmatched"][number]["reason"]): void => {
    summary.unmatched.push({ index, label: label(rec, index), reason });
    logger.warn({ record: label(rec, index), reason }, "tis.timing_override_unmatched");
  };
  const hasName = (o: SignalTimingOverrideInput): boolean => typeof o.name === "string" && o.name.trim().length > 0;

  // ---- Pass 1: coordinates (nearest-wins per signal) ----
  for (let index = 0; index < overrides.length; index++) {
    const rec = overrides[index]!;
    let best: StudyCandidate | undefined;
    let bestM = Infinity;
    for (const c of candidates) {
      const dM = haversineMeters(rec.latitude, rec.longitude, c.sig.latitude, c.sig.longitude);
      if (dM < bestM) { bestM = dM; best = c; }
    }
    if (!best || bestM > snapMaxM) {
      if (hasName(rec)) nameFallback.push({ rec, index });
      else unmatch(index, rec, "no_signal_within_snap");
      continue;
    }
    const prevM = attachedDistM.get(best);
    if (prevM !== undefined) {
      if (bestM >= prevM) { unmatch(index, rec, "displaced_by_nearer"); continue; }
      const prevIndex = attachedIndex.get(best)!;
      summary.matches = summary.matches.filter((m) => m.index !== prevIndex);
      summary.matched--;
      summary.matchedByCoordinates--;
      unmatch(prevIndex, best.timingOverride!, "displaced_by_nearer");
    }
    best.timingOverride = rec;
    attachedDistM.set(best, bestM);
    attachedIndex.set(best, index);
    summary.matched++;
    summary.matchedByCoordinates++;
    summary.matches.push({ index, signalId: best.sig.id, signalName: best.sig.name, by: "coordinates" });
  }

  // ---- Pass 2: name fallback (unambiguous normalized-name match) ----
  for (const { rec, index } of nameFallback) {
    const result = matchIntersectionByName(rec.name!, candidates, (c) => c.sig.name);
    if (result.kind === "tie") { unmatch(index, rec, "name_tie"); continue; }
    if (result.kind === "none") { unmatch(index, rec, "name_unmatched"); continue; }
    const best = result.candidate;
    if (best.timingOverride) { unmatch(index, rec, "displaced_by_existing"); continue; }
    best.timingOverride = rec;
    attachedIndex.set(best, index);
    summary.matched++;
    summary.matchedByName++;
    summary.matches.push({ index, signalId: best.sig.id, signalName: best.sig.name, by: "name" });
  }
  summary.unmatched.sort((a, b) => a.index - b.index);
  return summary;
}

async function findAffectedIntersections(
  lat: number, lon: number, radiusMi: number, regionCode: string,
  forceInclude?: ForceIncludeInput,
): Promise<{
  candidates: Array<StudyCandidate>;
  coverageNote?: CoverageNote;
  /** In-radius inventory records BEFORE same-junction merging. */
  inRadiusCount: number;
  /** In-radius records absorbed into a kept junction by the dedup. */
  mergedCount: number;
}> {
  const inventory = await fetchIntersections(regionCode);
  // Radius filter + nearest-first sort and the same-junction dedup both live in
  // the dependency-free `intersection-coverage` leaf module so the distance
  // ceilings can be regression-tested with plain node. Telemetry (its only
  // dependency on `logger`) stays here.
  let within = intersectionsWithinRadius(inventory, lat, lon, radiusMi);
  // Sparse-site fallback: an empty radius set on a rural/exurban site would
  // otherwise fail the whole study (no_signals_in_radius 422) even though the
  // nearest town's junctions are exactly what a reviewer scopes there. Widen to
  // the nearest N within the ceiling and carry a disclosure note; the radius
  // default (analyze EVERYTHING inside it) is untouched for any site with at
  // least one in-radius signal. A site with nothing inside the ceiling either
  // keeps the hard warning — that's water or truly uncovered ground.
  let coverageNote: CoverageNote | undefined;
  if (within.length === 0) {
    const fallback = nearestNIntersections(inventory, lat, lon);
    if (fallback.length > 0) {
      within = fallback;
      coverageNote = nearestFallbackNote(radiusMi, fallback);
      logger.info(
        { lat, lon, radiusMi, region: regionCode, usedCount: fallback.length,
          nearestMi: coverageNote.nearestDistanceMi, farthestMi: coverageNote.farthestDistanceMi },
        "tis.nearest_n_fallback",
      );
    }
  }
  const dedup = dedupCloseSignals(within);
  const { merged, nameAbsorbedBeyond45m } = dedup;
  // Typed to allow the additive `forced` flag below; absent-force path returns
  // these radius signals unchanged.
  const kept: StudyCandidate[] = dedup.kept;
  // Log the dedup outcome so production shows whether the threshold is catching
  // what we expect. `nameAbsorbedBeyond45m` isolates the name-rule merges beyond
  // the 45 m distance threshold — the ones the NAME_DEDUP_MAX_M ceiling bounds —
  // so over-collapse of distinct junctions stays observable. Not in the report.
  if (merged.length > 0) {
    // WARN, not debug: every merge removes an intersection from the study, and
    // the gravity step then normalizes trip shares across whatever survives --
    // so a wrong merge silently rescales every volume, v/c and delay in the
    // report. `nameAbsorbedBeyond45m` is the risky subset: those rest on name
    // equality alone, and where signal names are derived from nearby road names
    // rather than supplied by the source data, two distinct junctions on the
    // same pair of roads carry the same name and merge.
    logger.warn({
      inRadiusCount: within.length,
      keptCount: kept.length,
      mergedCount: merged.length,
      nameAbsorbedBeyond45m,
      merged: merged.map((m) => ({ id: m.sig.id, name: m.sig.name })),
    }, "tis.intersection-dedup");
  }

  // Force-include (ADDITIVE): union reviewer-scoped intersections that the
  // radius missed. Never removes anything the radius found; when no ids/points
  // are supplied this whole block is skipped and the output is byte-identical.
  const hasForce =
    forceInclude != null &&
    ((forceInclude.ids?.length ?? 0) > 0 || (forceInclude.points?.length ?? 0) > 0);
  if (!hasForce) {
    return { candidates: kept, coverageNote, inRadiusCount: within.length, mergedCount: merged.length };
  }

  const { included, unmatchedIds, unsnappedPoints } = forceIncludeIntersections(
    inventory, lat, lon, forceInclude,
  );
  if (unmatchedIds.length > 0 || unsnappedPoints.length > 0) {
    logger.warn(
      { regionCode, unmatchedIds, unsnappedPoints },
      "tis.force_include_unresolved",
    );
  }

  // Mark force-included signals that are ALREADY inside the radius so they
  // survive the opt-in scoping trim; append the ones the radius missed. The
  // append set is deduped by id against the radius set here, then the whole
  // union is re-run through dedupCloseSignals so a beyond-radius record for the
  // SAME physical junction as an in-radius signal (OSM way-split) collapses.
  const forcedIds = new Set(included.map((e) => e.sig.id));
  for (const k of kept) if (forcedIds.has(k.sig.id)) k.forced = true;
  const keptIds = new Set(kept.map((k) => k.sig.id));
  const extras: StudyCandidate[] = included
    .filter((e) => !keptIds.has(e.sig.id))
    .map((e) => ({ sig: e.sig, distanceMi: e.distanceMi, forced: true }));
  if (extras.length === 0) {
    return { candidates: kept, coverageNote, inRadiusCount: within.length, mergedCount: merged.length };
  }

  const combined = [...kept, ...extras].sort((a, b) => a.distanceMi - b.distanceMi);
  const deduped = dedupCloseSignals(combined);
  logger.info(
    { regionCode, radiusMi, radiusCount: kept.length, forcedAdded: deduped.kept.length - kept.length },
    "tis.force_include",
  );
  // inRadiusCount/mergedCount describe the RADIUS set only; force-included
  // signals from outside it are carried on each candidate's `forced` flag.
  return { candidates: deduped.kept, coverageNote, inRadiusCount: within.length, mergedCount: merged.length };
}

function plainFindings(
  trips: TripGenerationSummary,
  rows: AffectedIntersection[],
  growthYears: number,
  growthPct: number,
  weather: Weather,
  weatherFactor: number,
  passByPct: number,
  internalCapPct: number,
  sens: SensitivityResult | undefined,
  region: Region,
  autoModeShare: number,
): string[] {
  const out: string[] = [];
  out.push(
    `Project will generate ${trips.dailyTrips.toLocaleString()} new daily vehicle trips, with ${trips.pmPeakTrips} during the PM peak hour (${trips.pmIn} inbound / ${trips.pmOut} outbound).`,
  );
  if (passByPct > 0 || internalCapPct > 0) {
    out.push(
      `Pass-by credit ${passByPct.toFixed(0)}% and internal-capture credit ${internalCapPct.toFixed(0)}% applied at the PM peak (25% of that credit at the AM and Saturday-midday periods, per the industry rule of thumb that off-peak shopping diverts less) before off-site assignment (standard pass-by methodology; ULI Internal Capture).`,
    );
  }
  if (autoModeShare < 0.95) {
    const nonAutoPct = Math.round((1 - autoModeShare) * 100);
    out.push(
      `Auto-mode share of ${(autoModeShare * 100).toFixed(0)}% applied to external trips for ${region.displayName}; ${nonAutoPct}% of generated trips are assumed to arrive by transit, walking, or cycling and do not load the off-site roadway network. Source: ${getAutoModeShareSource(region.code)}.`,
    );
  }
  if (growthYears > 0 && growthPct > 0) {
    const mul = Math.pow(1 + growthPct / 100, growthYears);
    out.push(
      `Existing volumes were grown by ${growthPct.toFixed(2)}%/yr over ${growthYears} year${growthYears === 1 ? "" : "s"} (×${mul.toFixed(2)}) to the opening-year horizon.`,
    );
  }
  if (weather !== "clear") {
    out.push(
      `Weather scenario "${weather.replace("_", " ")}" reduced lane-group capacity by ${(100 * (1 - weatherFactor)).toFixed(0)}% (published rain/snow capacity-reduction factors).`,
    );
  }
  if (rows.length === 0) {
    out.push("No signalized intersections were found within the study radius — no off-site capacity impact is anticipated.");
    return out;
  }
  // Every count and every delta below NAMES ITS HORIZON. An unscoped headline
  // computed from the opening year alone understates the study against its own
  // printed design-year values — a reviewer who spots that reads the whole
  // document as understated.
  const openingDelta = (r: AffectedIntersection) => r.futureDelaySec - r.existingDelaySec;
  const designDelta = (r: AffectedIntersection) =>
    (r.designBuildDelaySec ?? 0) - (r.designNoBuildDelaySec ?? 0);
  const hasDesign = rows.some((r) => r.designBuildDelaySec !== undefined);

  const dropped = rows.filter((r) => r.losChanged).length;
  const ef = rows.filter((r) => r.futureLos === "E" || r.futureLos === "F").length;
  const efDesign = rows.filter((r) => r.designBuildLos === "E" || r.designBuildLos === "F").length;
  out.push(
    `${rows.length} signalized intersection${rows.length === 1 ? "" : "s"} fall within the study area; ${dropped} are projected to drop at least one LOS grade in the opening year after build-out.`,
  );
  if (ef > 0) {
    out.push(`${ef} intersection${ef === 1 ? " is" : "s are"} projected to operate at LOS E or F under the opening-year build condition and require formal mitigation per ${region.jurisdiction.dotName} TIS guidance.`);
  } else if (hasDesign && efDesign > 0) {
    out.push(`All studied intersections remain at LOS D or better under the opening-year build condition, but ${efDesign} ${efDesign === 1 ? "is" : "are"} projected to reach LOS E or F under the design-year build condition.`);
  } else {
    out.push(`All studied intersections are projected to remain at LOS D or better with build traffic${hasDesign ? " in both the opening and design years" : " in the opening year"}; no mitigation is indicated at screening level.`);
  }

  const worstBy = (f: (r: AffectedIntersection) => number) =>
    rows.reduce<AffectedIntersection | null>((a, b) => (a == null || f(b) > f(a) ? b : a), null);

  const worst = worstBy(openingDelta);
  if (worst && openingDelta(worst) >= SCREENING_DELAY_DELTA_MINOR_SEC) {
    out.push(
      `Worst opening-year impact: ${worst.name} — projected delay rises ${openingDelta(worst).toFixed(1)}s (LOS ${worst.existingLos} → ${worst.futureLos}); 95th-pct queue ${worst.queue95thFt.toFixed(0)} ft on the critical approach.`,
    );
  }

  // Reconcile the headline against the design year, ALWAYS when one was
  // analyzed — not only when it crosses a threshold. The design-year delta is
  // routinely the larger of the two, and a headline that reports only the
  // opening-year figure contradicts values printed elsewhere in the same study.
  if (hasDesign && worst) {
    const worstD = worstBy(designDelta)!;
    const maxOpening = openingDelta(worst);
    const maxDesign = designDelta(worstD);
    out.push(
      maxOpening < 0.05 && maxDesign < 0.05
        // Both round to zero: "0.0s and 0.0s" is a sentence that says nothing.
        // State the fact instead — it still records that BOTH horizons were checked.
        ? "No measurable delay change at either the opening year or the design year."
        : `Largest projected delay change: ${maxOpening.toFixed(1)}s in the opening year (${worst.name}) and ${maxDesign.toFixed(1)}s in the design year (${worstD.name}).`
          + (maxDesign > maxOpening
            ? ` The design-year figure is the larger; that difference is driven by background traffic growth over the design horizon, not by the development.`
            : ""),
    );
  }
  const turboRows = rows.filter((r) => r.turboLane);
  if (turboRows.length > 0) {
    const gains = turboRows.map((r) => r.turboLane!.capacityGainPct);
    const lo = Math.round(Math.min(...gains));
    const hi = Math.round(Math.max(...gains));
    const range = lo === hi ? `≈${lo}%` : `≈${lo}–${hi}%`;
    out.push(
      `${turboRows.length} signalized 3-leg T-intersection${turboRows.length === 1 ? "" : "s"} in the study area screen as turbo-lane (continuous-green-T) candidate${turboRows.length === 1 ? "" : "s"}, offering ${range} main-street approach-capacity recovery — see the capacity appendix. Field verification of lane configuration, median, and signal timing is required before design.`,
    );
  }
  // Scenario-sensitivity finding (the statistical Monte-Carlo finding has
  // been retired per standard TIA practice — engine output retained for
  // demo-mode diagnostics but not surfaced in deliverable findings).
  out.push(
    `Conclusions are reported at the applied screening assumptions. Discrete-scenario sensitivity at the formal TIA scoping meeting should test: trip-generation method (rate vs. fitted-curve equation); internal capture and pass-by credit variants; and a ±0.5%/yr background growth band around the applied value.`,
  );
  return out;
}

const TIS_METHODOLOGY = [
  "Trip generation uses public-data average rates (SANDAG 2002, corroborated by NHTS 2017 / NCHRP 716) for the selected land-use code, computed for AM peak, PM peak, Saturday midday, and daily totals. Saturday-midday rates are estimated as a published industry multiple of the PM peak rate by land-use category.",
  "Pass-by and internal-capture credits are applied in full at the PM peak (and at 25% of that credit fraction for the AM and Saturday-midday periods) per standard pass-by screening methodology and ULI Mixed-Use Internal Capture defaults; only the residual external vehicle trips are assigned to off-site intersections.",
  "Existing intersection volumes are grown to the opening-year horizon at the user-supplied annual growth rate (default 1.5%/yr) before the capacity analysis.",
  "Weather adjustment applies published rain/snow capacity-reduction factors as adopted in US traffic-engineering practice: clear 1.00, light rain 0.95, heavy rain 0.86, light snow 0.86, heavy snow 0.70. The factor multiplies the saturation flow at every intersection.",
  "Off-site impact is screened for all signalized intersections within the study radius (default 0.5 mi) using the four-step travel demand model (FHWA; NCHRP Report 716). Step 1 Trip Generation: public-data average rates (SANDAG 2002 / NHTS 2017 / NCHRP 716) give the site's external (post pass-by / internal-capture) productions. Step 2 Trip Distribution: a production-constrained gravity model T_j = P · (A_j·F_j) / Σ(A_x·F_x) allocates trips to surrounding signals, where attractiveness A_j is the signal's through-volume and the friction factor F_j is the NCHRP-716 gamma function F = a·t^b·e^(c·t) (home-based-work coefficients a=28507, b=-0.02, c=-0.123) on the travel time t to each signal. Step 3 Mode Choice: a binary logit P(auto)=1/(1+e^-(ASC−λ·ΔGC)) calibrated to the metro's auto-mode share — measured (ACS B08301) where the metro is wired, otherwise the ACS B08301 metropolitan median of 90% — and shifted by site urbanity (a density proxy from surrounding through-volumes) so denser, more transit-served sites split further from auto; only the resulting vehicle trips load the network. Step 4 Route Assignment: a capacity-constrained assignment using the BPR volume-delay function t = t0·[1 + 0.15·(v/c)^4] iteratively shifts trips away from over-capacity signals toward less-congested alternatives. Signals lacking AADT data fall back to a constant 5,000 vpd attraction.",
  "After assignment, all signalized intersections within the study radius are reported in the affected-intersections table. Project-added trips, v/c ratio change, control delay change, LOS change, and 95th-percentile queue are reported for each intersection so the reviewer can assess relative impact. Intersections beyond the study radius are excluded from analysis.",
  "Auto-mode share is applied per metro before assignment. Suburban-US metros default to 90% auto (ACS 5-Year B08301 median); transit-heavy metros use measured auto-mode share (e.g., NYC 32%, Tokyo 30%, London 38%, San Francisco 47%). Non-auto trips (transit, walking, cycling) do not load the off-site roadway. This is a screening-level adjustment; a real TIS submittal in a transit-heavy market should refine with project-specific TAZ data.",
  "Candidate signals are de-duplicated within a 45m clustering threshold to prevent OSM divided-arterial splits and way-record artifacts from double-counting a single physical intersection.",
  "Intersection-level control delay uses the standard signalized-intersection model d = d1 + d2 (Webster uniform delay + Akçelik time-dependent incremental-delay term, both openly published) with a 90s cycle, g/C = 0.45, 1,800 vphpl saturation flow (× weather factor), 15-minute peak analysis period (T = 0.25 hr) and pretimed-signal incremental-delay factor k = 0.5. Reported control delay is capped at 300 s (LOS F) for screening reliability — the incremental-delay term is not calibrated far above capacity, so oversaturated approaches are reported as LOS F rather than an implausible delay figure; a calibrated design-level analysis (HCS / Synchro) supersedes this screen.",
  "Approach-level analysis splits each signal's inflow across NB/SB/EB/WB approaches (deterministic per-signal allocation perturbed ±15% from a 30/25/25/20 base) and assigns added trips to each approach by cosine-similarity to the bearing of the project relative to the signal. Per-approach v/c, control delay, LOS, and 95th-percentile back-of-queue length (standard cyclic-queue relation with Poisson percentile factor: Q95 ≈ Q1 × 1.65 × 25 ft/veh) are reported.",
  "Level of Service is assigned from the conventional US signalized control-delay bands republished in state DOT traffic-engineering manuals: A ≤10s, B ≤20s, C ≤35s, D ≤55s, E ≤80s, F >80s.",
  "Sensitivity is reported in narrative form per standard TIA practice: trip-generation method (rate vs. fitted-curve equation), discrete internal capture and pass-by credit variants, and a ±0.5%/yr growth-rate band around the applied value. The engine retains an internal stochastic-sensitivity routine (Box-Muller-perturbed trip rate and existing volume) for demo-mode diagnostics; it is not surfaced in the deliverable because TIA sensitivity is conducted through discrete scoping-agreed scenario variants, not statistical perturbation of unmeasured distributions.",
  "Mitigations are screening-level recommendations sized to the projected delay change, not full Synchro/SimTraffic optimization runs. A formal TIS submittal should validate these recommendations with detailed traffic counts and signal-timing analysis.",
  "Turbo-lane (continuous-green-T) screening flags signalized 3-leg T-intersections where one or more main-street through lanes could flow continuously while the minor-street left turn merges in the median — recovering the green time the through movement would otherwise lose to the signal. Candidacy requires measured 3-leg geometry, an arterial-class main street, and a detected median (divided carriageway), all derived from the OpenStreetMap road network. Approach-capacity gain is computed as (turbo lanes / approach lanes) × (1 − g/C) / (g/C), with the main-street through g/C derived from the modeled main-vs-minor critical-flow split; the result is reported within the +7%…+173% envelope documented in the continuous-green-T design literature — the standard national references for this geometry (David Plummer & Associates, Adding Turbo Lanes to T-Intersections, 2010; and the Design Guidelines for the Development of Continuous Green Intersections, 1997). Lane counts and signal timing must be field-verified before design.",
];

// Florida distribution standard: swap the four-step methodology's Step-2 clause
// from the NCHRP-716 gamma-friction gravity model to the Caltran mass/distance
// gravity model, so the methodology narrative matches the FL renderer's §6.1
// gravity worksheet. Every other region keeps the gamma description.
const CALTRAN_STEP2_CLAUSE =
  "Step 2 Trip Distribution: the Caltran mass/distance gravity model — the Florida distribution standard (Caltran Engineering HCA Westside TIS) — allocates trips to surrounding zones by T_j = (M_j / (d_j · d_site)) / Σ(M_x / (d_x · d_site)), where mass M_j is each signal's through-volume (destination-activity attraction proxy) and d_j is its straight-line distance from the site (site-zone distance normalizer d_site = 1). The normalized zone shares set the directional distribution and drive the project-trip assignment.";

const FLAT_SIGNAL_CLAUSE = "with a 90s cycle, g/C = 0.45, 1,800 vphpl saturation flow (× weather factor)";
const RESOLVED_SIGNAL_CLAUSE =
  "with each intersection's own cycle length and green splits from the signal-timing resolver — a client Synchro record's measured cycle and per-phase splits where the record carries them, otherwise a Webster optimum cycle (60–120 s) with Critical Movement Method splits derived from the no-build approach volumes (FHWA-HOP-07-006), a protected-left phase where the FHWA-HRT-04-091 cross product of left-turn and opposing through volume warrants one, and a pedestrian minimum green from the crossing width; timing is resolved once from no-build volumes and held fixed across every scenario, approach capacity is 1,800 vphpl saturation flow × that phase's g/C (× weather factor), and an intersection at or beyond saturation (Y ≥ 0.85) reports the flat 90s / g/C 0.45 screening default instead";

function tisMethodologyForRegion(region: Region, signalTiming: "computed" | "screening" = "computed"): string[] {
  const base = signalTiming === "computed"
    ? TIS_METHODOLOGY.map((m) => (m.includes(FLAT_SIGNAL_CLAUSE) ? m.replace(FLAT_SIGNAL_CLAUSE, RESOLVED_SIGNAL_CLAUSE) : m))
    : TIS_METHODOLOGY;
  if (!isFloridaRegion(region)) return base;
  return base.map((m) =>
    m.includes("NCHRP-716 gamma function")
      ? m.replace(
          /Step 2 Trip Distribution:.*?on the travel time t to each signal\./,
          CALTRAN_STEP2_CLAUSE,
        )
      : m,
  );
}

// ---------- Monte Carlo sensitivity (Box-Muller, deterministic seed) ----------

function gaussian(rng: () => number): number {
  const u = Math.max(1e-9, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx]!;
}

function runSensitivityAnalysis(
  candidates: Array<{ sig: AnalyzerIntersection; distanceMi: number }>,
  loadWeights: number[],
  baseExternalTrips: number,
  capacityVph: number,
  growthMultiplier: number,
  iterations: number = 100,
): SensitivityResult {
  const rng = mulberry32(0xC0FFEE);
  const worstDeltas: number[] = [];
  const losDropCounts: number[] = [];
  let withDrop = 0;
  let withEf = 0;

  for (let i = 0; i < iterations; i++) {
    const tripPerturb = Math.max(0.5, Math.min(1.5, 1 + 0.10 * gaussian(rng)));
    const volPerturb = Math.max(0.5, Math.min(1.5, 1 + 0.15 * gaussian(rng)));
    const trips = baseExternalTrips * tripPerturb;

    let worstDelta = 0;
    let dropCount = 0;
    let efCount = 0;
    candidates.forEach((c, idx) => {
      const w = loadWeights[idx]!;
      const grownVol = c.sig.totalVolume * growthMultiplier * volPerturb;
      const beforeCrit = grownVol * CRITICAL_MOVEMENT_FRACTION;
      const beforeVc = beforeCrit / capacityVph;
      const addedCrit = trips * w * CRITICAL_MOVEMENT_FRACTION;
      const afterVc = beforeVc + addedCrit / capacityVph;
      const bd = vcToDelay(beforeVc, capacityVph);
      const ad = vcToDelay(afterVc, capacityVph);
      const delta = ad - bd;
      if (delta > worstDelta) worstDelta = delta;
      const bl = delayToLos(bd);
      const al = delayToLos(ad);
      if (bl !== al) dropCount++;
      if (al === "E" || al === "F") efCount++;
    });

    worstDeltas.push(worstDelta);
    losDropCounts.push(dropCount);
    if (dropCount > 0) withDrop++;
    if (efCount > 0) withEf++;
  }

  const sorted = [...worstDeltas].sort((a, b) => a - b);
  const mean = worstDeltas.reduce((s, v) => s + v, 0) / Math.max(1, iterations);
  const expectedLosDrops = losDropCounts.reduce((s, v) => s + v, 0) / Math.max(1, iterations);

  return {
    iterations,
    worstDelayDeltaMean: round1(mean),
    worstDelayDeltaP10: round1(percentile(sorted, 10)),
    worstDelayDeltaP50: round1(percentile(sorted, 50)),
    worstDelayDeltaP90: round1(percentile(sorted, 90)),
    probAnyLosDrop: Math.round((withDrop / Math.max(1, iterations)) * 100) / 100,
    probAnyLosEf: Math.round((withEf / Math.max(1, iterations)) * 100) / 100,
    expectedLosDrops: round1(expectedLosDrops),
  };
}

// ---------- Main entry point ----------

export async function generateTisReport(req: TisRequest): Promise<TisReport> {
  const lu = getLandUse(req.landUseCode);
  if (!lu) {
    throw new Error(`Unknown land-use code: ${req.landUseCode}`);
  }
  if (!Number.isFinite(req.size) || req.size <= 0) {
    throw new Error("size must be a positive number");
  }
  const radiusMi = req.studyRadiusMi ?? 0.5;

  const periods = (req.analysisPeriods && req.analysisPeriods.length > 0)
    ? req.analysisPeriods
    : (["am_peak", "pm_peak", "saturday_midday", "daily"] as AnalysisPeriod[]);

  const weather = req.weather ?? "clear";
  const weatherFactor = WEATHER_FACTOR[weather];
  const capacityVph = PER_INTERSECTION_CAPACITY_VPH * weatherFactor;
  const approachCapacityVph = APPROACH_CAPACITY_VPH * weatherFactor;

  const passByPct = clamp(req.passByPct ?? lu.passByPctPm, 0, 70);
  const internalCapturePct = clamp(req.internalCapturePct ?? lu.internalCapturePctPm, 0, 50);

  // Resolve the active rate set from the chosen independent variable
  // (primary unitShort by default; matches a secondary's unitShort
  // otherwise). The renderers + findings need both the rates and the
  // metadata so the report surfaces which assumption was used.
  const rates = resolveRatesForVariable(lu, req.independentVariable);

  // Optional existing (prior) land use → redevelopment trip-generation credit.
  // Resolved once; its per-period trips are computed with the same pipeline as
  // the proposed use (raw → pass-by → internal capture → auto-mode) and its own
  // registry defaults, then subtracted from the proposed external trips. Absent
  // or zero-size ⇒ existingUse is null and every downstream path is unchanged.
  const existingLuRaw = req.existingLandUseCode ? getLandUse(req.existingLandUseCode) : null;
  const existingSize = Math.max(0, Number(req.existingSize) || 0);
  const existingUse = existingLuRaw && existingSize > 0
    ? {
        lu: existingLuRaw,
        size: existingSize,
        rates: resolveRatesForVariable(existingLuRaw, undefined),
        passByPct: clamp(existingLuRaw.passByPctPm, 0, 70),
        internalCapturePct: clamp(existingLuRaw.internalCapturePctPm, 0, 50),
      }
    : null;

  // Resolve region once from the project coordinate. Region-scoped cache
  // means a Charlotte project won't accidentally see Atlanta signals.
  // Fall back to Atlanta if outside every active region (belt-and-braces;
  // OpenAPI bounds + per-region check should have caught it upstream).
  const region = regionForCoordinate(req.latitude, req.longitude) ?? ATLANTA_METRO;

  // Background growth rate. Order of precedence:
  //   1. Explicit `req.growthRatePct` (user overrides — scenario modeling)
  //   2. Per-metro measured CAGR from regional-growth-rates (when no
  //      explicit override and the metro has historical AADT data wired)
  //   3. Screening default 1.5%/yr (legacy behavior)
  // The measured rate also writes back into the result payload's
  // `growthAppliedPct` + `growthSource` so the renderer prose and
  // No-Build / Build LOS columns stay consistent — without this, the IL
  // renderer §5 prose would print "1.80%/yr" while the engine still grew
  // volumes at 1.50%/yr, a reviewer-visible mismatch.
  // The measured rate is resolved even when an override wins, so the payload can
  // name what the override DISPLACED. Previously `measuredRate` was set to
  // undefined on override, which suppressed `growthSource` entirely — an
  // overridden study printed its growth figure with no provenance at all while
  // the engine held a cited rate it had not used, and a reviewer had no way to
  // see that an override had happened at all.
  const measuredRate = getMeasuredGrowthRate(region.code);
  const growthOverridePct = req.growthRatePct;
  const growthIsOverride = growthOverridePct !== undefined;
  const growthRatePct = clamp(growthOverridePct ?? measuredRate?.growthPct ?? 1.5, -5, 6);
  const growthYears = Math.max(0, req.openingYear - CURRENT_YEAR);
  const growthMultiplier = Math.pow(1 + growthRatePct / 100, growthYears);
  // 4th-scenario design year: opening + 20yr at the same CAGR. Per IL
  // D8 Appx. A and BLRS §27-6.02(a); other US state TIS standards mostly
  // converge on the same 20-yr horizon.
  const designYearHorizon = DESIGN_YEAR_HORIZON_DEFAULT;
  const designYear = req.openingYear + designYearHorizon;
  const designYears = Math.max(0, designYear - CURRENT_YEAR);
  const designGrowthMultiplier = Math.pow(1 + growthRatePct / 100, designYears);

  const { candidates, coverageNote, inRadiusCount, mergedCount } = await findAffectedIntersections(
    req.latitude, req.longitude, radiusMi, region.code,
    { ids: req.studyIntersectionIds, points: req.additionalStudyPoints },
  );
  // Attach measured UTDF records to their signals (opt-in; see attachUtdfData).
  // Runs BEFORE any buildAffectedRow call so both the per-period loop and the
  // synthesized-PM path see the same attachments. Absent/empty ⇒ no-op.
  // The match summary is surfaced on the payload ONLY when a record needed
  // name-based matching (a Synchro-report-PDF record, or any record without
  // usable coordinates) — legacy UTDF-text requests keep byte-identical
  // payloads while the new import path gets a reviewable match report.
  let utdfMatchSummary: UtdfMatchSummary | undefined;
  if (Array.isArray(req.utdfIntersections) && req.utdfIntersections.length > 0) {
    const summary = attachUtdfData(candidates, req.utdfIntersections);
    const usedNameMatching = req.utdfIntersections.some(
      (u) =>
        u.source === "synchro_pdf" ||
        !(typeof u.latitude === "number" && Number.isFinite(u.latitude) &&
          typeof u.longitude === "number" && Number.isFinite(u.longitude)),
    );
    if (usedNameMatching) utdfMatchSummary = summary;
    logger.info(
      {
        records: req.utdfIntersections.length,
        matched: candidates.filter((c) => c.utdf).length,
        byName: summary.matchedByName,
      },
      "tis.utdf_attach",
    );
  }
  // What-if timing overrides: snapped AFTER the UTDF records (they never
  // compete — a signal can hold both; the override outranks the record in the
  // timing resolver and the record still supplies the volumes). The summary is
  // ALWAYS surfaced when the array was sent, so a client can see which
  // overrides took; absent array ⇒ absent summary, byte-identical payloads.
  let timingOverrideSummary: TimingOverrideMatchSummary | undefined;
  if (Array.isArray(req.signalTimingOverrides)) {
    timingOverrideSummary = attachTimingOverrides(candidates, req.signalTimingOverrides);
    logger.info(
      { records: req.signalTimingOverrides.length, matched: timingOverrideSummary.matched, unmatched: timingOverrideSummary.unmatched.length },
      "tis.timing_override_attach",
    );
  }
  // No signal within the study radius → almost certainly a bad geocode (open
  // water / outside our signal coverage), not a real "0-impact" finding. Flag
  // it on the report so the routes can answer with a clear message instead of
  // a silently-empty study. The rest of the pipeline still runs (trip
  // generation etc. are coordinate-independent), so a caller that ignores the
  // warning gets the same report as before — nothing regresses.
  const coverageWarning = coverageWarningForCandidates(candidates.length, radiusMi);
  if (coverageWarning) {
    logger.info(
      { lat: req.latitude, lon: req.longitude, radiusMi, region: region.code },
      "tis.no_signals_in_radius",
    );
  }
  const project = { lat: req.latitude, lon: req.longitude };
  const calibrationMap = await loadCalibrationMap();

  // Per-metro auto-mode share. NYC's project trips don't all arrive by
  // car (transit-heavy market); applying the share is the screening-
  // level version of mode choice. Suburban-US default 90% means almost
  // no change in those markets; transit-heavy metros see a meaningful
  // reduction (e.g., London 38%, Tokyo 30%, NYC 32%).
  // London PTAL refinement: the flat 0.38 london_metro figure is the
  // Greater-London average and is ~10× too high at high-PTAL inner-
  // London sites where London Plan T6 Part B sets a car-free starting
  // point. Band-resolution precedence for london_metro projects:
  //   1. Caller-supplied req.ptalBand wins (explicit override; the
  //      consultant ran WebCAT and knows the band).
  //   2. Otherwise the engine queries the TfL WebCAT 3.0 PTAL 2023 grid
  //      (point-in-polygon on the 100m × 100m FeatureServer layer) and
  //      uses the looked-up band.
  //   3. If the lookup returns null (out-of-extent, network failure,
  //      grid gap), fall back to the flat london_metro 0.38 — same as
  //      pre-PTAL behavior so degrade is graceful, not breaking.
  let resolvedPtalBand: TisReport["resolvedPtalBand"] = undefined;
  if (region.code === "london_metro") {
    if (req.ptalBand) {
      resolvedPtalBand = { band: req.ptalBand, source: "caller" };
    } else {
      const looked = await lookupLondonPtal(req.latitude, req.longitude);
      if (looked) {
        resolvedPtalBand = { band: looked.band, source: "tfl-webcat-2023", ai: looked.ai };
      }
    }
  }
  // Step 3 — Mode choice. London uses the PTAL-accessibility path (already
  // a site-responsive mode choice). Everywhere else, a binary logit
  // calibrated to the metro's measured auto-mode share, shifted by SITE
  // URBANITY: a density proxy from the surrounding signals' through-volumes
  // so a downtown parcel splits more toward transit/walk than a greenfield
  // parcel in the same metro.
  const densityVols = candidates.map((c) => c.sig.totalVolume).filter((v) => v > 0).sort((a, b) => a - b);
  const medianVol = densityVols.length ? densityVols[Math.floor(densityVols.length / 2)]! : 0;
  // `totalVolume` is DESIGN-HOUR vph (AADT × K-factor — see the
  // PERIOD_FACTOR note at the top of this file), so the density reference
  // must be design-hour scale: 30,000 AADT at the FHWA-standard 9% K is
  // ~2,700 vph. The old divisor compared vph against the 30k AADT figure
  // directly, which pinned densityIndex near 0.06 for every metro (real
  // medians ~1,800 vph) — flattening the mode-choice shift and classifying
  // every US site as rural in areaTypeFromDensity.
  const DENSITY_DESIGN_HOUR_REF_VPH = 2_700; // 30,000 AADT × 0.09 K
  const densityIndex = Math.min(1, Math.max(0, medianVol / DENSITY_DESIGN_HOUR_REF_VPH));
  // Real transit LOS (best-effort): when a Transitland key is configured,
  // measure the stops/routes near the site and fold that accessibility into
  // the mode-choice logit. Returns null fast (no key / no data) → the logit
  // uses the density proxy alone.
  let transitAccess: number | undefined;
  if (!resolvedPtalBand) {
    try {
      const tctx = await getTransitContext(req.latitude, req.longitude, 0.5);
      if (tctx && tctx.stops.length > 0) {
        const within = tctx.stops.filter((s) => s.distanceMi <= 0.25).length;
        const routeCount = Object.values(tctx.routesByAgency ?? {})
          .reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
        const nearest = tctx.stops[0]?.distanceMi ?? Infinity;
        const acc = Math.min(0.5, within / 12) + Math.min(0.3, routeCount / 20)
          + (nearest <= 0.2 ? 0.2 : nearest <= 0.4 ? 0.1 : 0);
        transitAccess = Math.min(1, Math.max(0, acc));
      }
    } catch { /* transit data unavailable — density-only mode choice */ }
  }
  const autoModeShare = resolvedPtalBand
    ? getLondonAutoModeShare(resolvedPtalBand.band)
    : modeChoiceLogit(getAutoModeShare(region.code), densityIndex, { transitAccess }).auto;

  // ----- Four-step travel demand model: distribution + assignment -------
  // Steps 1–3 (generation/mode-choice) are computed per period below; the
  // spatial DISTRIBUTION (gravity model) and ASSIGNMENT (BPR capacity-
  // constrained) are computed once here and reused as period-independent
  // shares. Replaces the old inverse-square heuristic with the NCHRP-716
  // gamma friction factor + BPR congestion feedback. See four-step-model.ts.
  const FALLBACK_VOLUME = 5_000;
  const refVolume = Math.max(
    FALLBACK_VOLUME,
    ...candidates.map((c) => (c.sig.totalVolume > 0 ? c.sig.totalVolume : 0)),
  );
  // PM-peak external auto trips drive the BPR loading (the controlling
  // period); the resulting shares apply to every period.
  const pmRawForAssign = periodRawTrips(lu, req.size, "pm_peak", rates);
  const pmPassByForAssign = pmRawForAssign * (passByPct / 100);
  const pmInternalForAssign = (pmRawForAssign - pmPassByForAssign) * (internalCapturePct / 100);
  const pmExternalAutoForAssign = Math.max(0, pmRawForAssign - pmPassByForAssign - pmInternalForAssign) * autoModeShare;
  // Build the four-step demand zones EXACTLY as before (refVolume-normalized
  // baseVoverC) so the unified layer reproduces origin/main weights byte-for-byte.
  const demandZones: DemandZone[] = candidates.map((c) => ({
    id: c.sig.id,
    attraction: c.sig.totalVolume > 0 ? c.sig.totalVolume : FALLBACK_VOLUME,
    distanceMi: c.distanceMi,
    baseVoverC: clamp((c.sig.totalVolume > 0 ? c.sig.totalVolume : FALLBACK_VOLUME) / refVolume, 0.05, 1.0),
  }));
  // Caltran gravity zones (mass + bearing) built exactly as the FL branch did.
  const gravityZones: GravityZoneInput[] = candidates.map((c) => ({
    id: c.sig.id,
    mass: c.sig.totalVolume > 0 ? c.sig.totalVolume : FALLBACK_VOLUME,
    distanceMi: c.distanceMi,
    bearingDeg: bearingDeg(
      { lat: req.latitude, lon: req.longitude },
      { lat: c.sig.latitude, lon: c.sig.longitude },
    ),
  }));
  const distMeta: DistributionCandidateMeta[] = candidates.map((c, i) => ({
    id: c.sig.id,
    name: c.sig.name,
    distanceMi: c.distanceMi,
    bearingDeg: gravityZones[i]!.bearingDeg,
    mass: gravityZones[i]!.mass,
  }));
  // Surrogate (market-area) activity mass, computed only when the surrogate
  // method is requested for a non-FL study (FL always uses Caltran gravity, so
  // the block-group lookup — which lazily parses the 12 MB national TAZ asset on
  // first call — is skipped for every other study). Each candidate's mass is the
  // surrounding block-group population + employment (Census 2020 + LODES8).
  let activityMass: number[] | undefined;
  const uk = isUkRegion(region);
  let ukOd: TripDistributionCtx["ukOd"] | undefined;
  if (req.distributionMethod === "surrogate" && !isFloridaRegion(region) && !uk && nationalTazAvailable()) {
    // US surrogate: block-group population + employment (Census 2020 + LODES8).
    activityMass = candidates.map((c) => {
      const bg = blockGroupAt(c.sig.latitude, c.sig.longitude);
      return bg ? bg.population + bg.jobsShopping + bg.jobsCommerce + bg.jobsWorking : 0;
    });
  } else if (req.distributionMethod === "surrogate" && uk && ukOdAvailable()) {
    // UK surrogate = Census journey-to-work catchment: project the site MSOA's
    // 2011 WU03EW commuter flows onto each candidate's bearing from the site.
    const od = computeOdAffinity({
      siteLat: req.latitude,
      siteLon: req.longitude,
      candidateBearings: gravityZones.map((g) => g.bearingDeg),
      landUseCode: req.landUseCode,
    });
    if (od && od.hasFlows) {
      activityMass = od.affinity;
      ukOd = { matched: od.matched, direction: od.direction, hasFlows: od.hasFlows, source: od.source };
    }
  }
  // Unified trip-distribution layer. Default (unset method) resolves to the
  // gravity strategy — four-step for most regions, Caltran mass/distance for
  // FL — producing byte-identical weights/loadMultipliers/flGravity to the
  // prior inline path (the leaf consumes the pre-built zones above).
  const distCtx: TripDistributionCtx = {
    meta: distMeta,
    demandZones,
    gravityZones,
    pmExternalAutoTrips: pmExternalAutoForAssign,
    isFlorida: isFloridaRegion(region),
    landUseCode: req.landUseCode,
    densityIndex,
    ...(uk ? { isUk: true } : {}),
    ...(activityMass ? { activityMass } : {}),
    ...(ukOd ? { ukOd } : {}),
  };
  const dist = computeTripDistribution(req.distributionMethod, distCtx);
  let weights = dist.weights;
  const flLoadMultiplier = dist.loadMultipliers;
  // Preserve the FL renderer's flGravity contract from the unified summary
  // (share-sorted zones, matching origin/main).
  const flGravity: FlGravitySummary | undefined = isFloridaRegion(region)
    ? {
        betaExponent: dist.betaExponent,
        massBasis: dist.massBasis,
        zones: dist.zones.map((z) => ({
          id: z.id,
          name: z.name,
          distanceMi: z.distanceMi,
          bearingDeg: z.bearingDeg,
          cardinal: z.cardinal,
          mass: z.mass,
          term: z.term,
          sharePct: z.sharePct,
        })),
        byDirection: dist.byDirection,
        sectors: dist.sectors,
      }
    : undefined;
  // Per-intersection project-trip load fraction: distance-decay concentration
  // (trip-loading.ts), re-oriented by the Florida gravity multiplier (= 1 for
  // every non-FL region), clamped so no intersection can carry more than the
  // full project volume.
  const loadWeights = candidates.map((c, i) =>
    clamp(intersectionLoadFraction(c.distanceMi) * flLoadMultiplier[i]!, 0, 1),
  );

  // Study-intersection set. DEFAULT: every signalized intersection within the
  // chosen radius is studied — the radius is the user's stated scope, honored
  // literally. OPT-IN (req.scopeStudyIntersections): apply the MTIASD impact
  // scoping to trim to the site-adjacent + materially-impacted set. Either way
  // the four-step distribution above still runs over ALL candidates (correct
  // demand model); this only bounds what gets analyzed + reported.
  const studyLoads = candidates.map((c) => intersectionLoadFraction(c.distanceMi));
  // Force-included intersections (req.studyIntersectionIds / additionalStudyPoints)
  // are always studied — they survive the opt-in trim even if the MTIASD screen
  // wouldn't have kept them. Under the default (no scoping) this is a no-op.
  const forcedIdx = candidates.flatMap((c, i) => (c.forced ? [i] : []));
  const studyIdx = req.scopeStudyIntersections
    ? [...new Set([
        ...selectStudyIntersectionIdx(studyLoads, pmExternalAutoForAssign, candidates.length),
        ...forcedIdx,
      ])].sort((a, b) => a - b)
    : candidates.map((_, i) => i);
  const studySet = new Set(studyIdx);

  // Step 4 (network) — best-effort road-network route assignment. Loads the
  // PM-peak project trips onto the actual road corridors via shortest-path
  // + BPR equilibrium. Additive: per-signal trip totals are unchanged; this
  // reports which roads carry the trips. Falls back silently (undefined)
  // when the region has no road network available.
  let routeAssignment: RouteAssignment | undefined;
  let drivewayAssignment: DrivewayAssignment | undefined;
  // Hoisted for the conserved-assignment block below: it reuses the same
  // fetched network + measured-volume seeds instead of re-fetching.
  let segsForConserved: Awaited<ReturnType<typeof fetchLocalRoads>> = null;
  let conservedVolumeRefs: Array<{ lat: number; lon: number; aadt: number }> = [];
  try {
    const segs = await fetchLocalRoads(region.code, req.latitude, req.longitude, radiusMi);
    if (segs) {
      const dests = candidates.map((c, i) => ({
        lat: c.sig.latitude,
        lon: c.sig.longitude,
        trips: (weights[i] ?? 0) * pmExternalAutoForAssign,
      }));
      // Measured per-link existing volume: seed link v/c from the counted
      // signal volumes (AADT) rather than functional-class defaults.
      const volumeRefs = candidates
        .filter((c) => c.sig.totalVolume > 0)
        .map((c) => ({ lat: c.sig.latitude, lon: c.sig.longitude, aadt: c.sig.totalVolume }));
      routeAssignment = assignRoutes({ lat: req.latitude, lon: req.longitude }, dests, segs, { volumeRefs });
      segsForConserved = segs;
      conservedVolumeRefs = volumeRefs;
      // Driveway-aware assignment: when driveways are supplied, route through
      // them and record per-destination added trips. Opt-in: absent/empty ⇒
      // byte-identical to today (no loadWeights change, no driveways payload).
      if (Array.isArray(req.driveways) && req.driveways.length > 0) {
        const dwDests = candidates.map((c) => ({
          lat: c.sig.latitude,
          lon: c.sig.longitude,
          trips: 1, // uniform — we care about shares, not absolute volumes here
        }));
        drivewayAssignment = assignWithDriveways(
          { lat: req.latitude, lon: req.longitude },
          dwDests,
          segs,
          req.driveways,
          { volumeRefs },
        );
      }
    }
  } catch {
    /* network roads unavailable — gravity assignment stands on its own */
  }

  // When driveways are present and routing succeeded, derive per-intersection
  // load shares from the driveway assignment's per-destination added trips.
  // Normalize to a share (Σ = 1), then scale by the existing near-site decay
  // so magnitude stays consistent with the base loading. When driveways are
  // absent or the assignment failed, dwShare is null and we fall through to
  // the original loadWeights (opt-in guard: byte-identical to today).
  const dwShare: number[] | null =
    drivewayAssignment?.available && candidates.length > 0
      ? (() => {
          const tot =
            drivewayAssignment.perDestinationAddedTrips.reduce((s, v) => s + v, 0) || 1;
          return drivewayAssignment.perDestinationAddedTrips.map(
            (v, i) =>
              clamp(
                (v / tot) * candidates.length * intersectionLoadFraction(candidates[i]!.distanceMi),
                0,
                1,
              ),
          );
        })()
      : null;

  // Effective per-intersection load weight: the driveway routing share when a
  // driveway assignment was produced, else the base distance-decay loadWeights.
  // Used by EVERY loading path — the period rows, the synthesized PM report, and
  // the sensitivity Monte Carlo — so driveway routing is reflected consistently
  // (dwShare is null when no driveways ⇒ byte-identical to today).
  const effectiveWeights = candidates.map((_, i) => (dwShare ? dwShare[i]! : loadWeights[i]!));

  // ---- Conserved path assignment (DEFAULT ON; req.conservedAssignment) ----
  // The gate below normalizes the flag engine-side (`!== false`) so the
  // default covers EVERY entry path — /generate, /generate/pdf, the London TA
  // handlers AND the demo routes, whose parseDemoRequest whitelist never
  // passes the flag through. Explicit false is the only way to get the
  // legacy octant-only loading.
  // Destinations become cordon gateways on the study boundary, weighted by the
  // SAME byDirection the report prints in its distribution section. Project
  // trips are routed through the network with the turn ledger retained; every
  // study signal that resolves to a real graph junction gets its turning
  // movements AND its approach loading from the actual paths through it, so
  // flow is conserved between adjacent resolved intersections. Signals that
  // do not resolve (no junction within 100 m, minor legs absent from the
  // graph, or a node collision) keep the legacy octant model and are labeled
  // movementSource:"octant" — an honest per-row boundary, never a blend.
  let pathTurnsByCandidate: Array<PathTurnShare[] | undefined> | undefined;
  // Recorded inbound (gateway→site) turns per candidate. Defined ONLY when
  // the routing graph carries one-way links (the router then routes the
  // return direction for real instead of relying on the outbound mirror).
  // undefined on all-two-way graphs ⇒ every downstream consumer keeps the
  // historical mirror, bit-for-bit.
  let pathTurnsInByCandidate: Array<PathTurnShare[] | undefined> | undefined;
  let conservedAssignment:
    | {
        enabled: true;
        gatewayCount: number;
        classCeiling: number;
        emptyOctants: string[];
        resolvedIntersections: number;
        octantFallbacks: number;
        conservation: ConservationReport;
      }
    | undefined;
  if (req.conservedAssignment !== false && segsForConserved && segsForConserved.length > 0) {
    try {
      const cg = buildGraph(segsForConserved, conservedVolumeRefs);
      let cordon = selectCordonGateways(
        cg,
        { lat: req.latitude, lon: req.longitude },
        radiusMi,
        dist.byDirection,
      );
      // Directed-reachability screen — one-way-bearing graphs ONLY. The ring/
      // octant/capacity selection is purely geometric: on a heavily one-way
      // grid it can pick a gateway no legal path serves in EITHER direction,
      // whose demand share then silently evaporates at routing time (the
      // pred=-1 skip), deflating routed/onNetworkPct and every resolved
      // weight with no diagnostic. Drop such gateways and renormalize so the
      // cordon's Σshare stays 1 over gateways that can actually route. On
      // all-two-way graphs (every shipped region today) the gate keeps this
      // block inert and the selection byte-identical.
      if (cordon && cg.links.some((lk) => lk.dir !== 0)) {
        const reach = directedReachability(cg, cg.nearestNode(req.latitude, req.longitude));
        const kept = cordon.gateways.filter(
          (gw) => reach.outbound[gw.node] === 1 || reach.inbound[gw.node] === 1,
        );
        if (kept.length === 0) {
          cordon = null; // no routable cordon — the legacy path stands
        } else if (kept.length < cordon.gateways.length) {
          const sum = kept.reduce((s, gw) => s + gw.share, 0);
          cordon = { ...cordon, gateways: kept.map((gw) => ({ ...gw, share: gw.share / sum })) };
        }
      }
      if (cordon) {
        const net = assignRoutesWithTurns(
          { lat: req.latitude, lon: req.longitude },
          cordon.gateways.map((gw) => ({ lat: gw.lat, lon: gw.lon, trips: gw.share })),
          segsForConserved,
          { volumeRefs: conservedVolumeRefs },
        );
        const turnsByNode = new Map<number, TurnFlow[]>();
        for (const t of net.turns) {
          const arr = turnsByNode.get(t.node);
          if (arr) arr.push(t);
          else turnsByNode.set(t.node, [t]);
        }
        // Inbound ledger by node — present only on one-way-bearing graphs.
        const turnsInByNode = net.turnsInbound ? new Map<number, TurnFlow[]>() : undefined;
        for (const t of net.turnsInbound ?? []) {
          const arr = turnsInByNode!.get(t.node);
          if (arr) arr.push(t);
          else turnsInByNode!.set(t.node, [t]);
        }
        const snaps = snapSignalsToJunctions(
          cg,
          candidates.map((c) => ({ lat: c.sig.latitude, lon: c.sig.longitude })),
        );
        // Bearing of travel along a link INTO / OUT OF a node.
        const other = (li: number, node: number): number => {
          const lk = cg.links[li]!;
          return lk.a === node ? lk.b : lk.a;
        };
        const bearing = (a: number, b: number): number => {
          const p = Math.PI / 180;
          const y = Math.sin((cg.nodeLon[b]! - cg.nodeLon[a]!) * p) * Math.cos(cg.nodeLat[b]! * p);
          const x = Math.cos(cg.nodeLat[a]! * p) * Math.sin(cg.nodeLat[b]! * p)
            - Math.sin(cg.nodeLat[a]! * p) * Math.cos(cg.nodeLat[b]! * p)
            * Math.cos((cg.nodeLon[b]! - cg.nodeLon[a]!) * p);
          return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
        };
        const toShares = (rows: TurnFlow[]): PathTurnShare[] =>
          rows.map((t) => ({
            enterBearingDeg: bearing(other(t.inLink, t.node), t.node),
            exitBearingDeg: bearing(t.node, other(t.outLink, t.node)),
            share: t.trips,
          }));
        let resolved = 0;
        pathTurnsByCandidate = candidates.map(() => undefined);
        if (turnsInByNode) pathTurnsInByCandidate = candidates.map(() => undefined);
        for (let i = 0; i < candidates.length; i++) {
          const snap = snaps[i]!;
          if (snap.node < 0) continue;
          const turnsOut = turnsByNode.get(snap.node) ?? [];
          if (turnsInByNode) {
            // One-way-bearing graph: inbound paths are routed for real and may
            // legitimately use DIFFERENT streets than outbound, so a signal
            // resolves when either direction's paths pass through it. Empty
            // arrays are kept (they mean "that direction does not pass here"),
            // never collapsed back to the mirror.
            const turnsIn = turnsInByNode.get(snap.node) ?? [];
            if (turnsOut.length === 0 && turnsIn.length === 0) continue;
            resolved++;
            pathTurnsByCandidate[i] = toShares(turnsOut);
            pathTurnsInByCandidate![i] = toShares(turnsIn);
          } else {
            if (turnsOut.length === 0) continue;
            resolved++;
            pathTurnsByCandidate[i] = toShares(turnsOut);
          }
        }
        // Conserved loading: a resolved intersection's load weight IS its path
        // through-share, replacing the un-normalized distance-decay estimate.
        // Two-way graphs: the in/out mirror sums to the same total, so the
        // outbound sum is the whole story and addedTripsExact equals the sum
        // of the path movement rows (cross-foots hold), exactly as before.
        // One-way graphs: the two directions can differ, and weights must stay
        // period-independent (shared across AM/PM whose inFraction differ), so
        // the weight is the direction-agnostic mean of the two through-share
        // sums; buildAffectedRow re-derives each period's exact junction load
        // from the ledgers themselves, keeping the integer cross-foots exact.
        for (let i = 0; i < candidates.length; i++) {
          const turns = pathTurnsByCandidate[i];
          if (!turns) continue;
          const turnsIn = pathTurnsInByCandidate?.[i];
          if (turnsIn !== undefined) {
            const sumOut = turns.reduce((sum, t) => sum + t.share, 0);
            const sumIn = turnsIn.reduce((sum, t) => sum + t.share, 0);
            effectiveWeights[i] = clamp((sumOut + sumIn) / 2, 0, 1);
          } else {
            effectiveWeights[i] = clamp(turns.reduce((sum, t) => sum + t.share, 0), 0, 1);
          }
        }
        conservedAssignment = {
          enabled: true,
          gatewayCount: cordon.gateways.length,
          classCeiling: cordon.classCeiling,
          emptyOctants: cordon.emptyOctants,
          resolvedIntersections: resolved,
          octantFallbacks: candidates.length - resolved,
          conservation: net.conservation,
        };
      }
    } catch {
      /* conserved assignment is best-effort; the legacy path stands */
    }
  }

  // Per-period analyses.
  const periodReports: PeriodReport[] = [];
  for (const period of periods) {
    // Pass-by + internal capture only credit at the PM peak (most defensible
    // application). For other periods we apply 25% of the PM credit fraction
    // (industry rule of thumb that off-peak shopping has less pass-by).
    // Mode-split: only the auto-mode share lands on the off-site roadway.
    // Walk / transit / cycle trips don't contribute to intersection v/c.
    // The chain itself lives in the engine core (externalTripsForPeriod) so
    // the browser scenario solver applies the identical arithmetic.
    const { rawTrips: raw, passByCredit, internalCredit, externalTrips } = externalTripsForPeriod({
      lu, size: req.size, period, rates, passByPct, internalCapturePct, autoModeShare,
    });

    // Redevelopment credit: the existing use's external trips already on the
    // network are credited against the proposed use's, so only the net new
    // external trips are distributed and assigned. Same pipeline + the existing
    // use's own pass-by/internal defaults; floored at 0 (a shrinking
    // redevelopment adds no net load rather than removing background traffic).
    let existingCredit = 0;
    if (existingUse) {
      existingCredit = externalTripsForPeriod({
        lu: existingUse.lu, size: existingUse.size, period, rates: existingUse.rates,
        passByPct: existingUse.passByPct, internalCapturePct: existingUse.internalCapturePct, autoModeShare,
      }).externalTrips;
    }
    const netNewExternal = Math.max(0, externalTrips - existingCredit);

    const inFraction = periodDirectionalIn(lu, period);
    // In/out split reflects what is actually assigned — the net new external
    // trips (identical to externalTrips when there is no existing use).
    const inTrips = Math.round(netNewExternal * inFraction);
    const outTrips = Math.round(netNewExternal) - inTrips;

    const params: ScenarioParams = {
      growthMultiplier,
      designGrowthMultiplier,
      capacityVph,
      approachCapacityVph,
      externalTrips: netNewExternal,
      inFraction,
      periodVolumeFactor: PERIOD_VOLUME_FACTOR[period] ?? 1,
      distributionOctants: dist.byDirection,
      ...(pathTurnsByCandidate ? { conservedLabeling: true } : {}),
      // Explicit false pins the legacy one-critical-lane lane-group basis.
      ...(req.realLaneGeometry === false ? { realLaneGeometry: false } : {}),
      // Signal timing resolves per intersection unless the request pins the
      // legacy flat basis.
      signalTiming: req.signalTiming === "screening" ? "screening" : "computed",
      weatherFactor,
    };

    // For "daily" we don't run an intersection-level analysis (HCM control
    // delay isn't defined over a 24-hour window). Emit trip generation only.
    const allRows = period === "daily"
      ? []
      : candidates.map((c, i) =>
          buildAffectedRow(
            c,
            effectiveWeights[i]!,
            project,
            params,
            calibrationMap.get(c.sig.id),
            pathTurnsByCandidate?.[i],
            pathTurnsInByCandidate?.[i],
          ),
        );

    // Report only the study intersections (site-adjacent + materially impacted).
    const rows = allRows.filter((_, i) => studySet.has(i));

    const dropCount = rows.filter((r) => r.losChanged).length;
    const efCount = rows.filter((r) => r.futureLos === "E" || r.futureLos === "F").length;
    const worstDelta = rows.reduce(
      (m, r) => Math.max(m, r.futureDelaySec - r.existingDelaySec),
      0,
    );

    periodReports.push({
      period,
      periodLabel: PERIOD_LABEL[period],
      tripGeneration: {
        period,
        periodLabel: PERIOD_LABEL[period],
        rawTrips: Math.round(raw),
        passByCredit: Math.round(passByCredit),
        internalCaptureCredit: Math.round(internalCredit),
        externalTrips: Math.round(externalTrips),
        inTrips,
        outTrips,
        ...(existingUse
          ? {
              existingUseCredit: Math.round(existingCredit),
              netNewExternalTrips: Math.round(netNewExternal),
            }
          : {}),
      },
      affectedIntersections: rows,
      intersectionsWithLosDrop: dropCount,
      intersectionsAtLosEf: efCount,
      worstDelayDeltaSec: round1(worstDelta),
      // Exact re-solve inputs: what this period handed buildAffectedRow.
      periodVolumeFactor: params.periodVolumeFactor ?? 1,
      inFraction,
      externalTripsExact: externalTrips,
      ...(existingUse ? { existingUseCreditExact: existingCredit } : {}),
    });
  }

  // PM peak is the canonical/back-compat block. If the user excluded PM,
  // synthesize it for the back-compat fields so downstream consumers don't
  // crash.
  const pmReport = periodReports.find((p) => p.period === "pm_peak")
    ?? (await synthesizePmReport(lu, req, candidates, effectiveWeights, project, growthMultiplier, designGrowthMultiplier, capacityVph, approachCapacityVph, passByPct, internalCapturePct, rates, studySet, dist.byDirection, pathTurnsByCandidate, pathTurnsInByCandidate));

  // Top-level back-compat trip-generation summary uses ORIGINAL (non-credited)
  // PM trips so the existing UI labels keep their meaning. Rates come from
  // the resolved variable so a secondary-variable run also produces a
  // sensible summary in the back-compat fields.
  const dailyTrips = Math.round(rates.dailyRate * req.size);
  const amTrips = Math.round(rates.amRate * req.size);
  const pmTrips = Math.round(rates.pmRate * req.size);
  const pmIn = Math.round(pmTrips * lu.directionalSplitPm.in);
  const pmOut = pmTrips - pmIn;
  // AM directional split mirrors the PM convention (gross entering/exiting
  // split of the summary trips) so the summary trip-generation table shows a
  // real AM split instead of a total-and-dash. Uses the land use's AM in-share.
  const amIn = Math.round(amTrips * lu.amDirectionalIn);
  const amOut = amTrips - amIn;
  const tripGeneration: TripGenerationSummary = {
    landUseCode: lu.code,
    landUseName: lu.name,
    size: req.size,
    unit: rates.unit,
    unitShort: rates.unitShort,
    variableConfidence: rates.confidence,
    variableNote: rates.note,
    dailyRate: rates.dailyRate,
    amRate: rates.amRate,
    pmRate: rates.pmRate,
    variableSource: rates.source,
    dailyTrips,
    amPeakTrips: amTrips,
    pmPeakTrips: pmTrips,
    amIn,
    amOut,
    pmIn,
    pmOut,
    ...(existingUse
      ? {
          existingLandUseCode: existingUse.lu.code,
          existingLandUseName: existingUse.lu.name,
          existingSize: existingUse.size,
          existingUnit: existingUse.rates.unit,
          existingUseCreditPm: (pmReport.tripGeneration as { existingUseCredit?: number }).existingUseCredit ?? 0,
          netNewExternalPm: (pmReport.tripGeneration as { netNewExternalTrips?: number }).netNewExternalTrips
            ?? pmReport.tripGeneration.externalTrips,
        }
      : {}),
  };

  // Sensitivity analysis (PM peak external trips).
  const sens = req.runSensitivity
    ? runSensitivityAnalysis(
        candidates,
        effectiveWeights,
        pmReport.tripGeneration.externalTrips,
        capacityVph,
        growthMultiplier,
      )
    : undefined;

  // `region` is already resolved earlier (before findAffectedIntersections)
  // — reuse it for the findings/mitigation language so the report is
  // self-consistent.
  // Background-volume plausibility. Leads the findings list when it fires —
  // a reader must not reach the LOS tables before being told the volumes
  // behind them are not credible.
  const volumeDisclosures = implausibleVolumeDisclosures(pmReport.affectedIntersections);

  const findings = [
    ...volumeDisclosures,
    ...plainFindings(
      tripGeneration,
      pmReport.affectedIntersections,
      growthYears,
      growthRatePct,
      weather,
      weatherFactor,
      passByPct,
      internalCapturePct,
      sens,
      region,
      autoModeShare,
    ),
  ];

  const mitigationSummary = buildSummaryMitigations(pmReport.affectedIntersections, region);

  // Junction-impact significance: derived from the net PM-peak car-mode
  // external trips (already mode-share-net-out upstream). Below the
  // threshold, the London renderer demotes §5.4's junction capacity
  // table to Appendix A and leads with a trip-comparison narrative —
  // matching the published convention for sub-150-unit residential TAs.
  // Other renderers ignore the flag today (the US convention is to
  // model every nearby signalised junction regardless of project size).
  const junctionImpactSignificant =
    pmReport.tripGeneration.externalTrips >= JUNCTION_IMPACT_PM_TRIP_THRESHOLD;

  return {
    generatedAt: new Date().toISOString(),
    request: req,
    // On a nearest-N fallback study the ACTUAL study area is the fallback
    // reach, not the requested radius. Renderers print "N study
    // intersections within a X-mile radius" from this field — reporting the
    // widened distance keeps every PDF factually true without per-renderer
    // changes (the requested radius survives in request.studyRadiusMi and
    // coverageNote.radiusMi).
    studyRadiusMi: coverageNote
      ? Math.ceil(coverageNote.farthestDistanceMi * 10) / 10
      : radiusMi,
    tripGeneration,
    affectedIntersections: pmReport.affectedIntersections,
    intersectionsStudied: pmReport.affectedIntersections.length,
    // The study area's population is what the inventory holds inside the radius,
    // NOT what survived same-junction merging. Reporting the post-merge count here
    // made a set that had silently lost intersections look complete.
    intersectionsInStudyArea: inRadiusCount,
    intersectionsMergedAsDuplicates: mergedCount,
    intersectionsWithLosDrop: pmReport.intersectionsWithLosDrop,
    intersectionsAtLosEf: pmReport.intersectionsAtLosEf,
    worstDelayDeltaSec: pmReport.worstDelayDeltaSec,
    // Design-year companion to worstDelayDeltaSec, so a consumer can see the
    // opening-year headline is scoped rather than absolute. The design-year
    // delta is routinely the larger of the two; reporting only the opening-year
    // figure contradicts values printed elsewhere in the same study.
    ...(() => {
      const d = pmReport.affectedIntersections.filter((r) => r.designBuildDelaySec !== undefined);
      return d.length > 0
        ? {
            worstDelayDeltaDesignSec: round1(
              d.reduce((m, r) => Math.max(m, (r.designBuildDelaySec ?? 0) - (r.designNoBuildDelaySec ?? 0)), 0),
            ),
          }
        : {};
    })(),
    mitigationSummary,
    findings,
    // The fallback disclosure rides the methodology list so every renderer
    // that prints methodology discloses the widened study set in the PDF
    // without per-renderer changes.
    methodology: [
      // Disclosures first: both of these qualify every number below them.
      ...volumeDisclosures,
      ...(coverageNote ? [coverageNote.message] : []),
      ...tisMethodologyForRegion(region, req.signalTiming === "screening" ? "screening" : "computed"),
    ],
    periodReports,
    growthAppliedPct: growthRatePct,
    growthYears,
    ...(growthIsOverride
      ? {
          growthSource: [
            `${GROWTH_OVERRIDE_PREFIX} — ${growthRatePct.toFixed(2)}%/yr was supplied with the request and applied in place of the engine's own rate.`,
            growthOverridePct !== undefined && Math.abs(growthOverridePct - growthRatePct) > 0.005
              ? `The requested value ${growthOverridePct.toFixed(2)}%/yr was clamped to the permitted range.`
              : "",
            measuredRate
              ? `The measured rate for this region is ${measuredRate.growthPct.toFixed(2)}%/yr (${getMeasuredGrowthSource(region.code) ?? "per-metro historical AADT layer"} — median per-segment CAGR across ${measuredRate.stations} matched count stations within the ${region.displayName} bounding box (${measuredRate.yearFrom} → ${measuredRate.yearTo})).`
              : "No measured growth rate is wired for this region, so there is no measured value to compare the override against.",
            "The applied rate is not derived from measured data; its basis must be stated by the preparer.",
          ].filter(Boolean).join(" "),
        }
      : measuredRate
        ? {
            growthSource: `${getMeasuredGrowthSource(region.code) ?? "Per-metro historical AADT layer"} — median per-segment CAGR across ${measuredRate.stations} matched count stations within the ${region.displayName} bounding box (${measuredRate.yearFrom} → ${measuredRate.yearTo})`,
          }
        : {}),
    designYear,
    designYearHorizonYears: designYearHorizon,
    weather,
    weatherCapacityFactor: round2(weatherFactor),
    passByPctApplied: passByPct,
    internalCapturePctApplied: internalCapturePct,
    autoModeShareApplied: autoModeShare,
    // Exact re-solve inputs (report level): the region strings the findings
    // and mitigation summary print, and the unrounded weather factor.
    regionCode: region.code,
    jurisdiction: {
      dotName: region.jurisdiction.dotName,
      planningOfficeName: region.jurisdiction.planningOfficeName,
    },
    autoModeShareSource: getAutoModeShareSource(region.code),
    weatherFactorExact: weatherFactor,
    growthMultiplierExact: growthMultiplier,
    designGrowthMultiplierExact: designGrowthMultiplier,
    ...(timingOverrideSummary ? { timingOverrideSummary } : {}),
    ...(routeAssignment ? { routeAssignment } : {}),
    ...(conservedAssignment ? { conservedAssignment } : {}),
    ...(resolvedPtalBand ? { resolvedPtalBand } : {}),
    sensitivity: sens,
    junctionImpactSignificant,
    ...(coverageWarning ? { coverageWarning } : {}),
    ...(coverageNote ? { coverageNote } : {}),
    ...(utdfMatchSummary ? { utdfMatchSummary } : {}),
    ...(flGravity ? { flGravity } : {}),
    tripDistribution: dist,
    ...(drivewayAssignment?.available
      ? {
          driveways: {
            driveways: drivewayAssignment.driveways,
            reroutes: drivewayAssignment.reroutes,
          },
        }
      : {}),
  };
}

async function synthesizePmReport(
  lu: LandUse,
  req: TisRequest,
  // StudyCandidate so any attached UTDF record (c.utdf) flows through this
  // synthesized-PM path exactly as it does through the per-period loop.
  candidates: Array<StudyCandidate>,
  loadWeights: number[],
  project: { lat: number; lon: number },
  growthMultiplier: number,
  designGrowthMultiplier: number,
  capacityVph: number,
  approachCapacityVph: number,
  passByPct: number,
  internalCapturePct: number,
  rates: ResolvedRates,
  studySet: Set<number>,
  distributionOctants?: Record<string, number>,
  pathTurnsByCandidate?: Array<PathTurnShare[] | undefined>,
  pathTurnsInByCandidate?: Array<PathTurnShare[] | undefined>,
): Promise<PeriodReport> {
  const raw = periodRawTrips(lu, req.size, "pm_peak", rates);
  const passByCredit = raw * (passByPct / 100);
  const internalCredit = (raw - passByCredit) * (internalCapturePct / 100);
  const externalTrips = Math.max(0, raw - passByCredit - internalCredit);
  const inFraction = lu.directionalSplitPm.in;
  const params: ScenarioParams = { growthMultiplier, designGrowthMultiplier, capacityVph, approachCapacityVph, externalTrips, inFraction, periodVolumeFactor: PERIOD_VOLUME_FACTOR.pm_peak, ...(distributionOctants ? { distributionOctants } : {}), ...(pathTurnsByCandidate ? { conservedLabeling: true } : {}), ...(req.realLaneGeometry === false ? { realLaneGeometry: false } : {}), signalTiming: req.signalTiming === "screening" ? "screening" : "computed", weatherFactor: capacityVph / PER_INTERSECTION_CAPACITY_VPH };
  const calibrationMap = await loadCalibrationMap();
  const allRows = candidates.map((c, i) =>
    buildAffectedRow(c, loadWeights[i]!, project, params, calibrationMap.get(c.sig.id), pathTurnsByCandidate?.[i], pathTurnsInByCandidate?.[i]),
  );
  const rows = allRows.filter((_, i) => studySet.has(i));
  return {
    period: "pm_peak",
    periodLabel: PERIOD_LABEL.pm_peak,
    tripGeneration: {
      period: "pm_peak",
      periodLabel: PERIOD_LABEL.pm_peak,
      rawTrips: Math.round(raw),
      passByCredit: Math.round(passByCredit),
      internalCaptureCredit: Math.round(internalCredit),
      externalTrips: Math.round(externalTrips),
      inTrips: Math.round(externalTrips * inFraction),
      outTrips: Math.round(externalTrips) - Math.round(externalTrips * inFraction),
    },
    affectedIntersections: rows,
    intersectionsWithLosDrop: rows.filter((r) => r.losChanged).length,
    intersectionsAtLosEf: rows.filter((r) => r.futureLos === "E" || r.futureLos === "F").length,
    worstDelayDeltaSec: round1(rows.reduce((m, r) => Math.max(m, r.futureDelaySec - r.existingDelaySec), 0)),
    periodVolumeFactor: PERIOD_VOLUME_FACTOR.pm_peak,
    inFraction,
    externalTripsExact: externalTrips,
  };
}

function buildSummaryMitigations(rows: AffectedIntersection[], region: Region): string[] {
  if (rows.length === 0) return ["No off-site mitigations required."];
  const major = rows.filter((r) => r.mitigationSeverity === "major");
  const moderate = rows.filter((r) => r.mitigationSeverity === "moderate");
  const minor = rows.filter((r) => r.mitigationSeverity === "minor");
  const none = rows.filter((r) => r.mitigationSeverity === "none");
  const out: string[] = [];
  if (major.length) {
    out.push(`Major mitigation required at ${major.length} intersection${major.length === 1 ? "" : "s"}: add critical-approach turn lane(s) and retime the signal; coordinate with ${region.jurisdiction.planningOfficeName}.`);
  }
  if (moderate.length) {
    out.push(`Moderate mitigation at ${moderate.length} intersection${moderate.length === 1 ? "" : "s"}: extend critical-phase green and add protected-only left-turn phasing as needed.`);
  }
  if (minor.length) {
    out.push(`Signal-timing optimization at ${minor.length} intersection${minor.length === 1 ? "" : "s"} (3–5s green-time shift toward the critical phase) is sufficient.`);
  }
  if (none.length === rows.length) {
    out.push(`All studied intersections fall below the ${SCREENING_DELAY_DELTA_MINOR_SEC}-second screening threshold for additional delay across every analyzed horizon. That threshold is a screening default, not an agency criterion — no jurisdiction was resolved for this site — and this screen applies no v/c test and no separate clause for approaches already failing in the no-build. The governing agency's TIS criteria supersede it.`);
  }
  return out;
}

