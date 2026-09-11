// Per-intersection row math of the TIS engine — the pure core of tis.ts.
//
// Everything here was moved VERBATIM out of artifacts/tis-api-server/src/lib/
// tis.ts (period factors, the deterministic approach-share model, the UTDF
// measured-record helpers, lane groups, through-lane provenance, the signal
// timing resolver and buildAffectedRow itself) so the browser can re-solve a
// study row with the engine's own code. No logger, no db, no fetch, no
// process.env: every input is plain data (the candidate signal, the scenario
// params, an optional calibration entry, optional turn ledgers) and the output
// is the printed AffectedIntersection row.
//
// Behaviour contract: byte-identical to the pre-move engine. The server's
// check:conserved-assignment legacy baseline is the proof.
import { UTDF_MOVEMENTS, type UtdfMovement } from "./utdf-import.ts";
import {
  type Los,
  delayToLos,
  vcToDelay,
  queue95Ft,
  CRITICAL_MOVEMENT_FRACTION,
  APPROACH_CAPACITY_VPH,
  SATURATION_FLOW_VPH,
} from "./signal-delay.ts";
import {
  resolveSignalTiming,
  timingFromSynchroPhases,
  gOverCForApproach,
  gOverCForMovement,
  criticalGOverC,
  DEFAULT_THROUGH_LANES_PER_DIR,
  type Direction,
  type SignalTiming,
} from "./webster-timing.ts";
import {
  assignMovements,
  assignMovementLoadsExact,
  approachAddedTripsFromMovements,
  integerizeMovementLoads,
  pathMovementLoadsExact,
  type Movement,
  type MovementLoad,
  type MovementLoadExact,
  type PathTurnShare,
} from "./movement-assignment.ts";
import { screenTurboCandidate, turboLaneScreening, type TurboLaneScreening } from "./turbo-lane.ts";
import { recommendMitigation } from "./mitigation.ts";

/** Per-signal delay calibration handed to buildAffectedRow as plain data.
 *  Structurally identical to the server's CalibrationEntry (tis-calibration.ts,
 *  which is db-backed and therefore stays out of this package). */
export type RowCalibration = {
  multiplier: number;
  sampleCount: number;
  lastObservedDelaySec: number | null;
};

// Weather capacity adjustment (HCM Ch. 11). Multiplied into the saturation
// flow (and thus the lane group capacity).
export type Weather = "clear" | "light_rain" | "heavy_rain" | "light_snow" | "heavy_snow";
export const WEATHER_FACTOR: Record<Weather, number> = {
  clear: 1.0,
  light_rain: 0.95,
  heavy_rain: 0.86,
  light_snow: 0.86,
  heavy_snow: 0.70,
};

export type AnalysisPeriod = "am_peak" | "pm_peak" | "saturday_midday" | "daily";
// Background-network temporal peaking, expressed as a fraction of the stored
// design-hour volume. The signal `totalVolume` is AADT × K-factor, i.e. the
// highest (design) hour of the day, which is conventionally the PM peak — so
// PM anchors at 1.00 and the other analysis hours carry a documented, smaller
// share of the design hour. Without this every period reused the single
// design-hour volume, so the AM / PM / Saturday turning-movement diagrams and
// per-approach v/c came out byte-identical even though the network is not
// equally loaded at every time of day. This factors the BACKGROUND network
// only (a property of the surrounding roads, not the development — the
// project's own trips are already generated per period). Screening-level
// defaults; a submitted study substitutes measured per-period turning counts.
export const PERIOD_VOLUME_FACTOR: Record<AnalysisPeriod, number> = {
  am_peak: 0.90,
  pm_peak: 1.0, // anchor: stored volume is the design (≈ PM) hour
  saturday_midday: 0.80,
  daily: 1.0, // daily emits trip generation only — no junction analysis runs
};
export const DIRECTIONS: Direction[] = ["NB", "SB", "EB", "WB"];

// Approach origin bearings (degrees from north): the compass direction the
// driver is COMING FROM when approaching the signal on that approach.
//   NB approach → driver is south of signal moving north  → origin bearing 180
//   SB approach → driver is north of signal moving south  → origin bearing   0
//   EB approach → driver is west  of signal moving east   → origin bearing 270
//   WB approach → driver is east  of signal moving west   → origin bearing  90
export const APPROACH_ORIGIN_BEARING: Record<Direction, number> = {
  NB: 180, SB: 0, EB: 270, WB: 90,
};


// ---------- Geo helpers ----------

// Initial bearing from a → b, in degrees from north (0..360).
export function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

// ---------- Deterministic per-signal hash + PRNG ----------

export function hash32(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Approach split for existing volume. NB/SB usually carry slightly more on
// arterial-style signals. We use a deterministic perturbation (±15%) of a
// 30/25/25/20 base.
export function approachVolumeShares(signalId: string): Record<Direction, number> {
  const rng = mulberry32(hash32(signalId));
  const base = { NB: 0.30, SB: 0.25, EB: 0.25, WB: 0.20 };
  const raw: Record<Direction, number> = { NB: 0, SB: 0, EB: 0, WB: 0 };
  let total = 0;
  for (const d of DIRECTIONS) {
    const jitter = 1 + (rng() - 0.5) * 0.30;
    raw[d] = base[d] * jitter;
    total += raw[d];
  }
  for (const d of DIRECTIONS) raw[d] = raw[d] / total;
  return raw;
}

// LEGACY fallback: distribute added project trips to the four approaches,
// weighted by the cosine similarity between (a) the approach's origin bearing
// and (b) the bearing from the signal back to the project site. Floor of 0.10
// each so every approach gets at least some trips. Used only when no
// directional distribution ran — with distribution octants, buildAffectedRow
// derives the per-approach loading from the geometric movement assignment
// instead (approachAddedTripsFromMovements), which has no floor.
export function approachAddedTripShares(
  signal: { latitude: number; longitude: number },
  project: { lat: number; lon: number },
): Record<Direction, number> {
  const bearingSignalToProject = bearingDeg(
    { lat: signal.latitude, lon: signal.longitude },
    { lat: project.lat, lon: project.lon },
  );
  const raw: Record<Direction, number> = { NB: 0, SB: 0, EB: 0, WB: 0 };
  let total = 0;
  for (const d of DIRECTIONS) {
    const diff = ((APPROACH_ORIGIN_BEARING[d] - bearingSignalToProject + 540) % 360) - 180;
    const cos = Math.cos((diff * Math.PI) / 180);
    raw[d] = Math.max(0.10, cos + 0.10);
    total += raw[d];
  }
  for (const d of DIRECTIONS) raw[d] = raw[d] / total;
  return raw;
}
export type AnalyzerIntersection = {
  id: string;
  name: string;
  zone: string;
  latitude: number;
  longitude: number;
  totalVolume: number;
  // Turbo-lane (continuous-green-T) screening geometry from the analyzer.
  // All optional → older analyzer payloads (and regions without a roads
  // dataset) simply omit them and no turbo screening is produced.
  roadClass?: string;
  legCount?: number;
  minorLegBearing?: number | null;
  medianType?: "raised" | "painted" | "none";
  mainThroughLanes?: number;
  mainThroughLanesMeasured?: boolean;
  /** Per-direction through lanes on the minor (cross-street) approach, from
   *  OSM `lanes`. Absent when the matched way carries no tag. */
  minorThroughLanes?: number;
};
/** Per-movement numeric values keyed by the twelve standard Synchro
 *  movements — turning-movement volumes (vph) or turn-bay storage (ft).
 *  Mirrors the OpenAPI UtdfMovementValues named schema. */
export type UtdfMovementValues = Partial<Record<UtdfMovement, number>>;

/** Measured data for one intersection imported from a Synchro UTDF file.
 *  Mirrors the OpenAPI UtdfIntersectionData named schema (the same records
 *  `/utdf/parse` emits and the client forwards on the generate request). */
export type UtdfIntersectionInput = {
  intId?: number;
  name?: string;
  /** Which importer produced this record. Absent = "utdf_text" (legacy
   *  records predate the field). "synchro_pdf" records come from a Synchro
   *  report PDF: they carry a name but NO coordinates, match by normalized
   *  name (attachUtdfData), and get the "synchro_pdf_tmc" provenance label. */
  source?: "utdf_text" | "synchro_pdf";
  /** Present on UTDF-text records (4-dp rounded). Synchro report PDFs carry
   *  no coordinates, so PDF records omit both and match by name instead.
   *  Coordinates keep priority whenever present. */
  latitude?: number;
  longitude?: number;
  /** Measured turning-movement volumes, vph — ONE modeled hour (the PM peak
   *  by Synchro convention; the engine anchors it at the PM period). */
  volumes: UtdfMovementValues;
  /** Representative PHF / heavy-vehicle %. Carried for provenance only —
   *  the screening capacity model has no PHF or HV input today, so these
   *  deliberately do not alter the math (documented; see PR). */
  phf?: number;
  hvPct?: number;
  /** Turn-bay storage lengths (ft) by movement, from [Lanes] Storage. */
  storageFt?: UtdfMovementValues;
  /** Lane COUNT by movement, from [Lanes] Lanes — real measured geometry.
   *  Present only on records whose [Lanes] section carried counts; a Synchro
   *  report PDF import typically will not. When absent the lane group falls
   *  back to the one-critical-lane screening basis, which is what every study
   *  used before this shipped. */
  lanes?: UtdfMovementValues;
  /** Cycle length (s) from [Timings] — feeds Webster d1 for this signal. */
  cycleLenSec?: number;
  /** Phase number serving each movement ([Lanes] Phase1) and split seconds by
   *  phase ([Timings]). Together they are a measured g/C per movement — the
   *  "measured" timing tier. Absent → the record supplies at most a cycle. */
  phaseByMovement?: Record<string, number>;
  splitSByPhase?: Record<string, number>;
};

/** A per-signal TIMING override for a what-if scenario — the measured tier
 *  (cycle + phase map + splits) WITHOUT turning volumes. Mirrors the OpenAPI
 *  SignalTimingOverride schema. Consumed only by resolveTimingForRow, as its
 *  first provider; it never touches the row's volumes or approach shares. */
export type SignalTimingOverrideInput = {
  latitude: number;
  longitude: number;
  name?: string;
  cycleLenSec: number;
  phaseByMovement: Record<string, number>;
  splitSByPhase: Record<string, number>;
};

/** The candidate a row is built from: the inventory signal plus whatever the
 *  caller attached to it (a measured UTDF record and its index in the
 *  request's array; a what-if timing override). */
export type RowCandidate = {
  sig: AnalyzerIntersection;
  utdf?: UtdfIntersectionInput;
  /** Index of `utdf` in request.utdfIntersections, echoed on the row so a
   *  client can rebuild it with the same record. */
  utdfIndex?: number;
  timingOverride?: SignalTimingOverrideInput;
};
export type ApproachImpact = {
  /** Project-added trips split across left/through/right on THIS approach,
   *  from the geometric movement assignment the engine already runs off the
   *  trip-distribution octants (movement-assignment.ts). Covers the PROJECT
   *  increment only — background turning splits are not measured at screening
   *  level, so consumers must not read this as a total turn split. Absent when
   *  no distribution ran. */
  addedByMovement?: { L: number; T: number; R: number };
  direction: Direction;
  // True current-year baseline (no growth).
  currentVolumeVph: number;
  currentVc: number;
  currentDelaySec: number;
  currentLos: Los;
  // Existing-grown-to-opening-year (No-Build). Legacy naming kept.
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
  /** Through lanes this approach's capacity was sized with, and where the
   *  count came from: "import" = the record's [Lanes] section, "osm" = the
   *  OSM `lanes` tag on the road the signal was matched to (main-street count
   *  on the volume-major axis, minor-street count on the other). Absent on
   *  the one-lane screening default and under realLaneGeometry: false, so
   *  legacy payloads are byte-identical. */
  throughLanes?: number;
  lanesSource?: "import" | "osm";
  /** Per-turn-movement detail, present ONLY when an imported Synchro/UTDF
   *  record supplied measured turning-movement volumes for this intersection.
   *  Without measured movements the approach total is the finest granularity
   *  this screen can report honestly, so this stays absent rather than being
   *  filled from an assumed turn split. */
  laneGroups?: LaneGroupImpact[];
};

/** One turn-movement lane group (left / through / right) on an approach. */
export type LaneGroupImpact = {
  movement: "L" | "T" | "R";
  existingVolumeVph: number;
  addedTripsPeak: number;
  futureVolumeVph: number;
  futureVc: number;
  queue95thFt: number;
  /** This movement's own imported turn-bay storage, when the record had one. */
  storageFt?: number;
  /** 95th-percentile queue exceeds that bay — the mitigation trigger. */
  storageDeficient?: boolean;
  /** Measured lane count for this movement, from the imported [Lanes] section.
   *  Present ONLY where the record carried real geometry. Its absence is what
   *  makes the row fall back to the one-critical-lane screening basis, and the
   *  report says which basis each row used. */
  lanes?: number;
  /** Where `lanes` came from: the record's [Lanes] section, or the OSM
   *  through-lane count (through movement only). */
  lanesSource?: "import" | "osm";
  /** Capacity actually used for this lane group, vph. Printed so a reviewing
   *  engineer can see whether the row was measured-geometry or screening. */
  capacityVph?: number;
};

export type AffectedIntersection = {
  signalId: string;
  /** Per-direction through lanes on the major / minor approach, from the OSM
   *  `lanes` tag on the road the signal was matched to. Present only where
   *  OSM carried a tag — absence is what makes the UTDF export fall back to
   *  its 1L/2T/1R screening default, and the export row says which basis it
   *  used. Never populated speculatively. */
  mainThroughLanes?: number;
  minorThroughLanes?: number;
  /** True when mainThroughLanes came from a measured OSM tag — the only case
   *  the engine uses it. Emitted beside mainThroughLanes so a client rebuilds
   *  the same AnalyzerIntersection. */
  mainThroughLanesMeasured?: boolean;
  name: string;
  zone: string;
  latitude: number;
  longitude: number;
  distanceMi: number;
  // ---- Exact re-solve inputs (unrounded). The engine's own inputs to this
  // row, printed so a client can call buildAffectedRow with the engine's code
  // and reproduce every printed field byte for byte.
  /** The unrounded design-hour volume the row anchors on: the inventory's
   *  AADT x K design hour, or the measured UTDF total when a record attached.
   *  The period's background volume is this x periodVolumeFactor. */
  designHourVolumeVph: number;
  /** The caller's per-intersection load weight (exact): distance decay,
   *  driveway share, or the conserved through-share. Passed straight back to
   *  buildAffectedRow as `weight`. */
  loadWeight: number;
  /** Conserved-assignment turn ledgers (share units) the row was built with.
   *  `pathTurnsIn` is present only on one-way-bearing graphs; an empty array
   *  is meaningful (see buildAffectedRow). */
  pathTurns?: PathTurnShare[];
  pathTurnsIn?: PathTurnShare[];
  /** The exact (fractional) movement loads the integer `movements` table was
   *  integerized from and the per-approach loading derives from. */
  movementsExact?: MovementLoadExact[];
  /** Index into request.utdfIntersections of the attached measured record. */
  utdfRecordIndex?: number;
  // True current-year baseline — existing volumes WITHOUT growth applied.
  // State TIS conventions report this as "Existing Year" or "Year YYYY"
  // and renderers expect three scenarios stacked: Current → No-Build → Build.
  currentVc: number;
  currentDelaySec: number;
  currentLos: Los;
  // No-Build = opening-year existing-volumes-grown WITHOUT project trips.
  // Historically labeled "existing" in this codebase; that naming is a
  // legacy quirk — the values are no-build under HCM convention.
  existingVc: number;
  addedTripsPmPeak: number;
  futureVc: number;
  existingDelaySec: number;
  futureDelaySec: number;
  existingLos: Los;
  futureLos: Los;
  // Design-year scenarios — opening-year volumes grown by an additional
  // `designYearHorizon` years at the same compound growth rate. Project
  // trips at full build-out are unchanged from the Opening-Year Build
  // scenario (the project's external trip generation doesn't grow with
  // the design horizon — its build-out is fixed). Required by IL D8
  // Appx. A (and most US state TIS standards) as the 4th scenario.
  // Optional so older payloads pre-design-year refactor still validate.
  designNoBuildVc?: number;
  designNoBuildDelaySec?: number;
  designNoBuildLos?: Los;
  designBuildVc?: number;
  designBuildDelaySec?: number;
  designBuildLos?: Los;
  losChanged: boolean;
  mitigation: string;
  mitigationSeverity: "none" | "minor" | "moderate" | "major";
  // Phase 1 additions
  approaches: ApproachImpact[];
  queue95thFt: number; // worst approach
  // Phase 2 moat: when ground-truth observations exist for this signal we
  // adjust HCM delay by `delayMultiplier` and surface the metadata so the
  // printed report can render a "calibrated against N samples" badge.
  calibration?: {
    sampleCount: number;
    delayMultiplier: number;
    /** The unrounded multiplier the engine applied (delayMultiplier is 2 dp). */
    delayMultiplierExact: number;
    lastObservedDelaySec: number | null;
  };
  // Turbo-lane (continuous-green-T) screening, present only when this signal is
  // a genuine 3-leg T-intersection candidate. Reported for every candidate in
  // the study area regardless of LOS (screening-study convention).
  turboLane?: TurboLaneScreening;
  /** Per-turning-movement breakdown of the added project trips (NB-L/T/R …),
   *  derived from the study's directional trip distribution and the site's
   *  bearing from this intersection (assignMovements). Integer trips that
   *  cross-foot with addedTripsPmPeak AND, approach-by-approach, with the
   *  approaches' addedTripsPeak (both derive from the same geometric
   *  assignment). Present when a distribution ran and the intersection
   *  receives ≥1 rounded trip. */
  movements?: MovementLoad[];
  /** Where the movements table came from: "path" = derived from the actual
   *  routed paths through this junction (conserved assignment; approach
   *  loading uses the same rows), "octant" = the geometric octant model.
   *  Absent on pre-flag payloads and when no distribution ran. */
  movementSource?: "path" | "octant";
  /** Provenance of the EXISTING volumes at this intersection: "utdf_tmc" =
   *  measured turning-movement counts from an imported Synchro UTDF model
   *  replaced the AADT-derived design-hour estimate (growth still applied on
   *  top; the measurement anchors PM, other periods scale by the period
   *  factors). "synchro_pdf_tmc" = the same substitution, but the counts came
   *  from an imported Synchro report PDF and the record matched this signal
   *  by normalized name (report PDFs carry no coordinates). Absent =
   *  AADT-derived estimate — legacy payloads unchanged. */
  volumeSource?: "utdf_tmc" | "synchro_pdf_tmc";
  /** Field-measured existing turn-bay storage (ft) for the governing
   *  movement (see storageMovement), imported from the UTDF [Lanes] Storage
   *  record. Activates the renderers' storage-bay-adequacy tables, which
   *  already gate on exactly this field. */
  existingStorageFt?: number;
  /** Governing movement for existingStorageFt (e.g. "NBL") — the shortest
   *  imported turn bay, left-turn bays preferred (the movement most likely
   *  to spill back). */
  storageMovement?: string;
  /** Cycle length (s) imported from the UTDF [Timings] section and used in
   *  this intersection's Webster uniform-delay term in place of the 90 s
   *  screening default. */
  utdfCycleLenSec?: number;
  /** How this intersection's signal timing was resolved and what it was
   *  (see webster-timing.ts). Absent on requests that set
   *  signalTiming: "screening" and on payloads that predate the resolver. */
  signalTiming?: SignalTimingProvenance;
};

export type SignalTimingProvenance = {
  basis: SignalTiming["basis"];
  source?: string;
  cycleLenSec: number;
  criticalPhases: 2 | 3 | 4;
  gOverCns: number;
  gOverCew: number;
  gOverCnsLeft?: number;
  gOverCewLeft?: number;
  /** Unrounded green ratios (the printed ones are 3 dp) — what capacity was
   *  actually sized from. */
  gOverCnsExact: number;
  gOverCewExact: number;
  gOverCnsLeftExact?: number;
  gOverCewLeftExact?: number;
  leftPhasingNs: "protected" | "permissive";
  leftPhasingEw: "protected" | "permissive";
  leftPhasingSource: SignalTiming["leftPhasingSource"];
  criticalFlowRatio: number;
  pedMinGreenNsSec: number;
  pedMinGreenEwSec: number;
};
/** Per-approach totals of a measured UTDF movement-volume record. */
export function utdfApproachTotals(volumes: UtdfMovementValues): Record<Direction, number> {
  const out: Record<Direction, number> = { NB: 0, SB: 0, EB: 0, WB: 0 };
  for (const mv of UTDF_MOVEMENTS) {
    const v = volumes[mv];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      out[mv.slice(0, 2) as Direction] += v;
    }
  }
  return out;
}

export type UtdfMeasured = {
  /** Measured intersection total (Σ all movements), vph — the PM anchor. */
  totalVph: number;
  /** Measured per-approach share of the total (Σ = 1). Replaces the
   *  deterministic-jitter approachVolumeShares fabrication. */
  shares: Record<Direction, number>;
};

/** Totals + approach shares from a measured record, or undefined when the
 *  record carries no positive volume (nothing defensible to substitute). */
export function utdfMeasuredTotals(u: UtdfIntersectionInput): UtdfMeasured | undefined {
  const byApproach = utdfApproachTotals(u.volumes ?? {});
  const total = DIRECTIONS.reduce((s, d) => s + byApproach[d], 0);
  if (!(total > 0)) return undefined;
  const shares = { NB: 0, SB: 0, EB: 0, WB: 0 } as Record<Direction, number>;
  for (const d of DIRECTIONS) shares[d] = byApproach[d] / total;
  return { totalVph: total, shares };
}

/** The governing imported turn bay: the SHORTEST positive storage length,
 *  left-turn bays preferred (left bays are where spillback bites first and
 *  are what the storage records almost always describe). */
export function utdfGoverningStorage(
  u: UtdfIntersectionInput,
): { movement: UtdfMovement; storageFt: number } | undefined {
  const st = u.storageFt;
  if (!st) return undefined;
  let best: { movement: UtdfMovement; storageFt: number } | undefined;
  let bestIsLeft = false;
  for (const mv of UTDF_MOVEMENTS) {
    const v = st[mv];
    if (!(typeof v === "number" && Number.isFinite(v) && v > 0)) continue;
    const isLeft = mv.endsWith("L");
    const wins =
      best === undefined
      || (isLeft && !bestIsLeft)
      || (isLeft === bestIsLeft && v < best.storageFt);
    if (wins) { best = { movement: mv, storageFt: v }; bestIsLeft = isLeft; }
  }
  return best;
}

/**
 * Split one approach into its left / through / right lane groups, using the
 * MEASURED turning-movement volumes from an imported Synchro/UTDF record.
 *
 * Why this is honest and the old worst-approach number was the ceiling: the
 * screen has never had a turn split for background traffic. Project trips are
 * movement-resolved (path assignment), but existing volume was only ever known
 * per approach — so any per-movement queue would have been built on an invented
 * split. An imported record removes exactly that gap, and only for the
 * intersections it covers, which is why this returns undefined otherwise.
 *
 * Two deliberate choices:
 *  - Movement shares are taken WITHIN the approach and applied to the same
 *    `approachVolumeVph` the approach row already uses, rather than using the
 *    record's absolute volumes. That keeps the lane-group rows cross-footing to
 *    the approach row exactly, the same discipline the printed +Trips column
 *    already follows.
 *  - Capacity per lane group is the SAME one-critical-lane basis as the
 *    approach itself (`APPROACH_CAPACITY_VPH` = saturation flow x g/C; see
 *    signal-delay.ts). The granularity changes; the capacity model does not.
 *    Real per-lane-group capacity needs lane counts and phasing, which no
 *    import carries today -- a calibrated Synchro run supersedes this.
 */
export function laneGroupsForApproach(opts: {
  approach: Direction;
  utdf: UtdfIntersectionInput;
  approachVolumeVph: number;
  addedExactByMovement: Record<Movement, number>;
  addedTripsPeak: number;
  laneCapacityVph: number;
  cycleLenS?: number;
  /** Per-movement one-lane capacity and green ratio under a resolved signal
   *  timing: a protected left gets its own phase's g/C, through/right and a
   *  permissive left ride the through phase. Absent → laneCapacityVph and the
   *  screening g/C for every movement (legacy). */
  laneCapacityByMovement?: Partial<Record<Movement, number>>;
  gOverCByMovement?: Partial<Record<Movement, number>>;
  /** OSM through-lane count for this approach, used to size the THROUGH
   *  lane group when the record carried no [Lanes] count for it. Left and
   *  right stay one-lane — OSM does not say how many lanes are turn bays. */
  osmThroughLanes?: number;
  /** False reproduces the pre-lane-geometry one-critical-lane basis exactly,
   *  for the legacy escape hatch on TisRequest. Omitted/true uses measured
   *  lane counts where the import supplied them. */
  useRealLaneGeometry?: boolean;
}): LaneGroupImpact[] | undefined {
  const { approach, utdf, approachVolumeVph, addedExactByMovement } = opts;
  const vols = utdf.volumes ?? {};
  const measured: Record<Movement, number> = { L: 0, T: 0, R: 0 };
  let measuredApproachTotal = 0;
  for (const m of ["L", "T", "R"] as const) {
    const v = vols[`${approach}${m}` as UtdfMovement];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      measured[m] = v;
      measuredApproachTotal += v;
    }
  }
  // No measured volume on this approach: nothing to split. A zero total would
  // also make every share NaN, which is how fabricated numbers get printed.
  if (!(measuredApproachTotal > 0)) return undefined;
  // A non-finite or negative approach volume would propagate straight into the
  // printed volumes and queues as negative numbers. Upstream should never send
  // one, but "should never" is not a guard, and a negative queue length in a
  // sealed study is indefensible. Found by property-based fuzzing.
  if (!Number.isFinite(approachVolumeVph) || approachVolumeVph < 0) return undefined;

  // Integerize added trips by largest remainder so the lane-group column sums
  // to the approach's printed +Trips exactly (independent rounding drifts +/-1).
  const exact = (["L", "T", "R"] as const).map((m) => addedExactByMovement[m] ?? 0);
  const exactTotal = exact.reduce((s, v) => s + v, 0);
  // Demand with no movement basis to distribute it by. The allocator below can
  // only hand out one trip per movement in that state, so it would print a
  // fabricated 1/1/1 and drop the rest. Report nothing instead — the approach
  // row still carries the full count, and the caption's cross-foot promise
  // stays true.
  if (opts.addedTripsPeak > 0 && !(exactTotal > 0)) return undefined;
  const scaled = exactTotal > 0
    ? exact.map((v) => (v / exactTotal) * opts.addedTripsPeak)
    : [0, 0, 0];
  const floors = scaled.map((v) => Math.floor(v));
  let remainder = opts.addedTripsPeak - floors.reduce((s, v) => s + v, 0);
  const order = scaled
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const added = [...floors];
  for (const { i } of order) {
    if (remainder <= 0) break;
    added[i] += 1;
    remainder -= 1;
  }

  const storage = utdf.storageFt ?? {};
  const laneCounts = utdf.lanes ?? {};
  return (["L", "T", "R"] as const).map((m, idx) => {
    const share = measured[m] / measuredApproachTotal;
    const existingVolumeVph = approachVolumeVph * share;
    const futureVolumeVph = existingVolumeVph + added[idx];

    // Real lane geometry when the import carried it: capacity scales with the
    // number of lanes serving THIS movement, on the same saturation-flow x g/C
    // basis the rest of the screen uses. Without a count we keep the
    // one-critical-lane assumption, which is what every study did before this
    // — so an intersection with no [Lanes] data is bit-for-bit unchanged.
    const importedCount = laneCounts[`${approach}${m}` as UtdfMovement];
    const hasImported = opts.useRealLaneGeometry !== false
      && typeof importedCount === "number" && Number.isFinite(importedCount) && importedCount > 0;
    const hasOsm = !hasImported && m === "T" && opts.useRealLaneGeometry !== false
      && typeof opts.osmThroughLanes === "number" && Number.isFinite(opts.osmThroughLanes) && opts.osmThroughLanes > 0;
    const hasLanes = hasImported || hasOsm;
    const laneCount = hasImported ? (importedCount as number) : hasOsm ? (opts.osmThroughLanes as number) : undefined;
    const oneLane = opts.laneCapacityByMovement?.[m] ?? opts.laneCapacityVph;
    const capacity = hasLanes
      ? oneLane * (laneCount as number)
      : oneLane;

    const futureVc = futureVolumeVph / capacity;
    const queue = queue95Ft(futureVolumeVph, capacity, opts.cycleLenS, opts.gOverCByMovement?.[m]);
    const bay = storage[`${approach}${m}` as UtdfMovement];
    const hasBay = typeof bay === "number" && Number.isFinite(bay) && bay > 0;
    return {
      movement: m,
      existingVolumeVph: round1(existingVolumeVph),
      addedTripsPeak: added[idx],
      futureVolumeVph: round1(futureVolumeVph),
      futureVc: round2(futureVc),
      queue95thFt: round1(queue),
      capacityVph: round1(capacity),
      ...(hasLanes ? { lanes: laneCount as number, lanesSource: (hasImported ? "import" : "osm") as "import" | "osm" } : {}),
      ...(hasBay ? { storageFt: bay, storageDeficient: queue > bay } : {}),
    };
  });
}
export type ScenarioParams = {
  growthMultiplier: number;       // current → opening-year (no-build / build)
  /** Current → design year (opening + designYearHorizon at same CAGR).
   *  Optional so callers that don't want the 4th scenario can omit it;
   *  the engine just won't emit the designNoBuild* / designBuild* fields. */
  designGrowthMultiplier?: number;
  capacityVph: number;            // weather-adjusted intersection capacity
  approachCapacityVph: number;    // weather-adjusted approach capacity
  externalTrips: number;          // post-credit external trips for this period
  inFraction: number;             // directional split for this period
  /** True only when the conserved-assignment flag ran for this report. Gates
   *  the movementSource label: with the flag off, payloads must stay
   *  byte-identical, so even the octant label may not appear. */
  conservedLabeling?: boolean;
  /** Background-network volume as a fraction of the stored design hour for
   *  this period (PERIOD_VOLUME_FACTOR). Optional; defaults to 1.0 so any
   *  caller that omits it keeps the prior design-hour behaviour. */
  periodVolumeFactor?: number;
  /** Mirrors TisRequest.realLaneGeometry; false pins the legacy one-critical-
   *  lane basis for lane groups. */
  realLaneGeometry?: boolean;
  /** Mirrors TisRequest.signalTiming. "screening" (or absent, for callers
   *  that predate the resolver) keeps the flat 90 s / 0.45 capacity basis;
   *  "computed" resolves timing per intersection and re-derives capacity. */
  signalTiming?: "computed" | "screening";
  /** Weather capacity factor already folded into capacityVph /
   *  approachCapacityVph; carried separately so a re-derived capacity applies
   *  the same factor. Absent → recovered from approachCapacityVph. */
  weatherFactor?: number;
  /** Directional trip-distribution octant shares (NNE…NNW, Σ≈100) from the
   *  study's distribution step. When present, each affected-intersection row
   *  gains a per-turning-movement breakdown of its added project trips
   *  (assignMovements) AND the per-approach loading (futureVol / v/c / delay /
   *  LOS / queue / +Trips) derives from that same geometric assignment.
   *  Optional → omitted = no movements field and the legacy cosine+0.10-floor
   *  approach split, unchanged. */
  distributionOctants?: Record<string, number>;
};

/**
 * Resolve this intersection's signal timing ONCE, from the NO-BUILD approach
 * volumes, for reuse across every scenario (Current, No-Build, Build, Design
 * No-Build, Design Build). Recomputing per scenario would let Webster retime
 * the signal to absorb the project's own trips — a mitigation the applicant
 * never asked the agency for — and mitigation triggers would evaporate.
 *
 * Tiers, strict: a client Synchro record with a phase→movement map and
 * splits ("measured") > its cycle alone ("measured-cycle") > Webster from
 * volumes ("webster") > the flat screening default. Lane counts feed the
 * protected-left inference (opposing through lanes) and the pedestrian
 * minimum (crossing width): the record's [Lanes] counts when it has them,
 * else the OSM through lanes matched to the signal, main axis = the heavier
 * axis by volume. Returns undefined under signalTiming: "screening".
 */
export type ThroughLanes = { lanes: number; source: "import" | "osm" | "default" };

/**
 * Through lanes per approach, with provenance. Precedence, the rule #195 set
 * for the UTDF export: the record's [Lanes] count for that approach's through
 * movement > the OSM through-lane count on the road the signal was matched to
 * (OSM gives a main-street and a minor-street count but not which compass
 * axis each is; volume decides — the heavier no-build axis is the major road)
 * > one lane. realLaneGeometry: false pins one lane everywhere, so the
 * pre-lane-geometry capacity basis stays reachable with the flag that has
 * always pinned it.
 */
export function throughLanesByApproach(
  c: RowCandidate,
  approachVph: Record<Direction, number>,
  realLaneGeometry: boolean | undefined,
): Record<Direction, ThroughLanes> {
  const out = {} as Record<Direction, ThroughLanes>;
  const nsMajor = approachVph.NB + approachVph.SB >= approachVph.EB + approachVph.WB;
  const osmMain = c.sig.mainThroughLanesMeasured && Number.isInteger(c.sig.mainThroughLanes) && (c.sig.mainThroughLanes as number) > 0
    ? (c.sig.mainThroughLanes as number) : undefined;
  const osmMinor = Number.isInteger(c.sig.minorThroughLanes) && (c.sig.minorThroughLanes as number) > 0
    ? (c.sig.minorThroughLanes as number) : undefined;
  for (const d of DIRECTIONS) {
    if (realLaneGeometry === false) { out[d] = { lanes: 1, source: "default" }; continue; }
    const imported = c.utdf?.lanes?.[`${d}T` as UtdfMovement];
    if (typeof imported === "number" && Number.isFinite(imported) && imported > 0) { out[d] = { lanes: imported, source: "import" }; continue; }
    const onMajor = nsMajor ? d === "NB" || d === "SB" : d === "EB" || d === "WB";
    const osm = onMajor ? osmMain : osmMinor;
    out[d] = osm !== undefined ? { lanes: osm, source: "osm" } : { lanes: 1, source: "default" };
  }
  return out;
}

export function resolveTimingForRow(
  c: RowCandidate,
  measured: ReturnType<typeof utdfMeasuredTotals> | undefined,
  utdfCycleLenS: number | undefined,
  approachVph: Record<Direction, number>,
  lanesPerDir: { ns: number; ew: number },
  params: ScenarioParams,
): SignalTiming | undefined {
  if (params.signalTiming !== "computed") return undefined;
  // Measured left share per approach, applied to the SAME no-build approach
  // volume the row uses (the lane-group discipline), never the record's
  // absolute counts.
  let leftVph: Partial<Record<Direction, number>> | undefined;
  const vols = measured && c.utdf ? c.utdf.volumes : undefined;
  if (vols) {
    leftVph = {};
    for (const d of DIRECTIONS) {
      const l = vols[`${d}L` as UtdfMovement], t = vols[`${d}T` as UtdfMovement], r = vols[`${d}R` as UtdfMovement];
      const posv = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
      const tot: number = posv(l) + posv(t) + posv(r);
      if (tot > 0 && typeof l === "number" && Number.isFinite(l) && l >= 0) leftVph[d] = approachVph[d] * (l / tot);
    }
  }
  return resolveSignalTiming({
    providers: [
      // A what-if timing override outranks everything: it is the engineer's
      // explicit scenario for THIS signal. Same measured-tier arithmetic as a
      // Synchro record (cycle + phase map + splits), stamped "override" so
      // the row says where its timing came from. Volumes are never read
      // from it — the record has none — so the no-build baseline is exactly
      // the base study's.
      () => {
        if (!c.timingOverride) return undefined;
        const t = timingFromSynchroPhases(c.timingOverride);
        return t ? { ...t, source: "override" } : undefined;
      },
      () => (measured && c.utdf ? timingFromSynchroPhases(c.utdf) : undefined),
    ],
    fallback: {
      approachVph,
      ...(leftVph ? { leftVph } : {}),
      opposingLanes: { ns: lanesPerDir.ns, ew: lanesPerDir.ew },
      // Pedestrians walking with the NS phase cross the EW street.
      crossingLanes: { ns: 2 * lanesPerDir.ew, ew: 2 * lanesPerDir.ns },
      ...(utdfCycleLenS !== undefined ? { measuredCycleS: utdfCycleLenS } : {}),
    },
  });
}

export function buildAffectedRow(
  c: RowCandidate & { distanceMi: number },
  weight: number,
  project: { lat: number; lon: number },
  params: ScenarioParams,
  calibration?: RowCalibration,
  pathTurns?: PathTurnShare[],
  // Recorded inbound (gateway→site) turns — defined ONLY when the routing
  // graph carries one-way links and this signal resolved. undefined ⇒ the
  // historical inbound mirror of `pathTurns`, bit-for-bit. An EMPTY array is
  // meaningful: the routed inbound paths do not pass this junction.
  pathTurnsIn?: PathTurnShare[],
): AffectedIntersection {
  // Measured UTDF data for this signal (attachUtdfData). When present, the
  // measured turning-movement total replaces the AADT-derived design-hour
  // volume as the EXISTING condition, the measured approach split replaces
  // the deterministic-jitter fabrication, the imported cycle length feeds
  // Webster d1, and the imported turn-bay storage rides the row for the
  // storage-adequacy comparison. Absent ⇒ every path below is unchanged.
  const measured = c.utdf ? utdfMeasuredTotals(c.utdf) : undefined;
  const utdfCycleLenS =
    measured && typeof c.utdf?.cycleLenSec === "number" && Number.isFinite(c.utdf.cycleLenSec)
      ? Math.min(300, Math.max(30, c.utdf.cycleLenSec))
      : undefined;

  // Background-network volume for THIS period: the stored design-hour volume
  // (or the measured UTDF turning-movement total — one modeled hour, which is
  // the PM/design hour by Synchro convention, so it anchors the same way)
  // scaled by the period's peaking factor (PERIOD_VOLUME_FACTOR — PM anchors
  // at 1.0, AM/Saturday carry a smaller share). Drives every background-volume
  // figure below so each period's diagrams and v/c differ instead of reusing
  // one design hour.
  const baseVolume = (measured ? measured.totalVph : c.sig.totalVolume) * (params.periodVolumeFactor ?? 1);

  // Approach split: the MEASURED per-approach shares when a UTDF record is
  // attached (real counted geometry), else the deterministic screening
  // perturbation of the 30/25/25/20 base. Needed here (not just in the
  // approach loop) because the signal timing is resolved from these shares.
  const volShares = measured ? measured.shares : approachVolumeShares(c.sig.id);

  // ---- Signal timing: resolved once from NO-BUILD volumes, held fixed ----
  // Under signalTiming: "screening" `timing` is undefined and every capacity,
  // cycle and g/C below collapses to the flat legacy constants — the
  // pre-change arithmetic, byte for byte.
  const weatherFactor = params.weatherFactor ?? params.approachCapacityVph / APPROACH_CAPACITY_VPH;
  const noBuildVph = baseVolume * params.growthMultiplier;
  const noBuildByApproach: Record<Direction, number> = {
    NB: noBuildVph * volShares.NB, SB: noBuildVph * volShares.SB, EB: noBuildVph * volShares.EB, WB: noBuildVph * volShares.WB,
  };
  // Through lanes per approach (import > OSM > one lane; realLaneGeometry:
  // false pins one lane). They size capacity below AND feed the timing
  // resolver's protected-left inference and pedestrian minimum.
  const laneInfo = throughLanesByApproach(c, noBuildByApproach, params.realLaneGeometry);
  const lanesPerDir = {
    ns: Math.max(laneInfo.NB.lanes, laneInfo.SB.lanes) || DEFAULT_THROUGH_LANES_PER_DIR,
    ew: Math.max(laneInfo.EB.lanes, laneInfo.WB.lanes) || DEFAULT_THROUGH_LANES_PER_DIR,
  };
  const nsMajor = noBuildByApproach.NB + noBuildByApproach.SB >= noBuildByApproach.EB + noBuildByApproach.WB;
  const criticalLanes = nsMajor ? lanesPerDir.ns : lanesPerDir.ew;
  const timing = resolveTimingForRow(c, measured, utdfCycleLenS, noBuildByApproach, lanesPerDir, params);
  // Intersection-level capacity: the critical-movement fraction of the total
  // is a per-lane critical volume, so the major axis's lane count scales it.
  const capacityVph = (timing ? SATURATION_FLOW_VPH * criticalGOverC(timing) * weatherFactor : params.capacityVph) * criticalLanes;
  const approachCap = (d: Direction): number =>
    (timing ? SATURATION_FLOW_VPH * gOverCForApproach(timing, d) * weatherFactor : params.approachCapacityVph) * laneInfo[d].lanes;
  const cyc = timing ? timing.cycleLenS : utdfCycleLenS;
  const gcInt = timing ? criticalGOverC(timing) : undefined;
  const gcApp = (d: Direction): number | undefined => (timing ? gOverCForApproach(timing, d) : undefined);

  // True current-year baseline — no growth, no project. State TIS
  // conventions report this as the "Existing Conditions" scenario;
  // it's what a count taken this week would show.
  const currentVolume = baseVolume;
  const currentCriticalVph = currentVolume * CRITICAL_MOVEMENT_FRACTION;
  const currentVc = currentCriticalVph / capacityVph;

  // No-Build = current volumes grown to the opening year, no project.
  // Historically labeled "before" / "existing" here.
  const grownVolume = baseVolume * params.growthMultiplier;
  const beforeCriticalVph = grownVolume * CRITICAL_MOVEMENT_FRACTION;
  const beforeVc = beforeCriticalVph / capacityVph;

  // Build = No-Build + project trips. Carry the EXACT (fractional) project
  // load through the v/c, delay and per-approach math; round only for the
  // integer trip count surfaced in the report. Rounding the count first and
  // then deriving v/c from it discarded sub-vehicle loads entirely: at high-
  // PTAL London sites (car-mode share ~3%) a whole scheme can distribute < 1
  // net car trip to a junction, which previously collapsed to an exact 0.0
  // delta and read as if the analysis had not run. The exact load preserves
  // the (negligible but real) impact in the capacity math; `addedTrips` stays
  // an integer because the API schema types the reported count as such.
  // With a RECORDED inbound ledger (one-way graphs), the junction's project
  // load is the per-period directional blend of the two ledgers' shares:
  // outbound weighted (1 − inFraction), inbound weighted inFraction. The
  // caller's `weight` is necessarily period-independent (it is shared across
  // AM/PM, whose inFraction differ), so deriving the exact load from the
  // ledgers themselves is what keeps Σ movement rows === addedTripsExact and
  // every integer cross-foot below intact. Without an inbound ledger this is
  // exactly the historical arithmetic (mirror ⇒ both directions share one
  // through-sum ⇒ the blend collapses to `weight`).
  const ledgerWeight = pathTurnsIn !== undefined && pathTurns
    ? pathTurns.reduce((s, t) => s + t.share, 0) * (1 - params.inFraction)
      + pathTurnsIn.reduce((s, t) => s + t.share, 0) * params.inFraction
    : undefined;
  const addedTripsExact = params.externalTrips * (ledgerWeight ?? weight);
  const addedTrips = Math.round(addedTripsExact);
  const addedCriticalVph = addedTripsExact * CRITICAL_MOVEMENT_FRACTION;
  const afterVc = beforeVc + addedCriticalVph / capacityVph;

  // Design-Year No-Build = current × designGrowthMultiplier (no project).
  // Design-Year Build   = Design No-Build + project trips (same external
  // trip generation as the Opening Build scenario; the project's build-out
  // trips don't grow with the design horizon).
  const dgm = params.designGrowthMultiplier;
  const hasDesignYear = dgm !== undefined && dgm > 0;
  const designNoBuildCriticalVph = hasDesignYear
    ? baseVolume * (dgm as number) * CRITICAL_MOVEMENT_FRACTION
    : 0;
  const designNoBuildVc = hasDesignYear ? designNoBuildCriticalVph / capacityVph : 0;
  const designBuildVc = hasDesignYear ? designNoBuildVc + addedCriticalVph / capacityVph : 0;

  // HCM delay first; calibration multiplier applied AFTER so the LOS bucket
  // reflects the calibrated value reviewers care about. When no row exists
  // for this signal `multiplier` is 1.0 and behavior is unchanged.
  // Clamp to a sane positive range so a bad calibration row (e.g. 0 or
  // negative) cannot collapse delay → push every signal to LOS A and
  // wreck mitigation decisions. Range mirrors the DB CHECK constraint.
  const calMul = Math.min(5, Math.max(0.25, calibration?.multiplier ?? 1.0));
  // Under "screening" `cyc` is the imported cycle (or undefined) and `gcInt`
  // is undefined, which falls back to the screening default inside vcToDelay
  // — byte-identical legacy math.
  const currentDelay = vcToDelay(currentVc, capacityVph, cyc, gcInt) * calMul;
  const beforeDelay = vcToDelay(beforeVc, capacityVph, cyc, gcInt) * calMul;
  const afterDelay = vcToDelay(afterVc, capacityVph, cyc, gcInt) * calMul;
  const currentLos = delayToLos(currentDelay);
  const beforeLos = delayToLos(beforeDelay);
  const afterLos = delayToLos(afterDelay);
  const designNoBuildDelay = hasDesignYear ? vcToDelay(designNoBuildVc, capacityVph, cyc, gcInt) * calMul : 0;
  const designBuildDelay = hasDesignYear ? vcToDelay(designBuildVc, capacityVph, cyc, gcInt) * calMul : 0;
  const designNoBuildLos = hasDesignYear ? delayToLos(designNoBuildDelay) : undefined;
  const designBuildLos = hasDesignYear ? delayToLos(designBuildDelay) : undefined;

  // Turning-movement assignment of the added trips: geometry from the site
  // bearing + the study's distribution octants (see movement-assignment.ts).
  // Computed BEFORE the approach split because it is the single source of
  // truth for where the project loads this intersection: `movements` is the
  // integer view for the printed Affected-movements table, and the exact
  // fractional view (aggregated by entering approach) drives the per-approach
  // capacity loading below, so the two always reconcile. `movements` is
  // omitted when no distribution ran or the rounded junction load is zero, so
  // pre-distribution payloads and negligible-impact junctions are unchanged.
  const bearingIntersectionToSite = bearingDeg(
    { lat: c.sig.latitude, lon: c.sig.longitude },
    { lat: project.lat, lon: project.lon },
  );
  // Conserved assignment: when the caller resolved this signal to a network
  // junction, the movements come from the ACTUAL routed paths through it, in
  // share units scaled here by this period's external trips. The caller has
  // already set `weight` to the path through-share, so addedTripsExact equals
  // the sum of these rows and every cross-foot below holds unchanged.
  // A signal on a one-way pair can resolve with an EMPTY outbound ledger but
  // real inbound turns (the return street is a different street), so the gate
  // accepts either direction's rows when the inbound ledger exists.
  const pathRows = pathTurns
    && (pathTurns.length > 0 || (pathTurnsIn !== undefined && pathTurnsIn.length > 0))
    && params.distributionOctants
    ? pathMovementLoadsExact(pathTurns, params.externalTrips, params.inFraction, pathTurnsIn)
    : undefined;
  const movements: MovementLoad[] | undefined = pathRows
    ? integerizeMovementLoads(pathRows, addedTripsExact)
    : params.distributionOctants
      ? assignMovements(
          bearingIntersectionToSite,
          params.distributionOctants,
          addedTripsExact,
          params.inFraction,
        )
      : undefined;
  // Exact per-approach project load, by ENTERING approach: inbound trips load
  // the approach they enter on from their origin octant; outbound trips enter
  // on the site-facing leg traveling away from the site and load that
  // travel-direction row. Geometry decides the split — no floor share — so an
  // approach the distribution never routes through carries zero project trips.
  const movementAdded: Record<Direction, number> | undefined = pathRows
    ? pathRows.reduce(
        (acc, r) => { acc[r.approach] += r.exact; return acc; },
        { NB: 0, SB: 0, EB: 0, WB: 0 } as Record<Direction, number>,
      )
    : params.distributionOctants
      ? approachAddedTripsFromMovements(
          bearingIntersectionToSite,
          params.distributionOctants,
          addedTripsExact,
          params.inFraction,
        )
      : undefined;
  // The exact movement rows behind `movements` (path ledger rows, or the
  // octant model's fractional rows — the same array assignMovements
  // integerizes). Printed so a client can re-integerize at a different trip
  // scale with the engine's own allocator.
  const movementsExact: MovementLoadExact[] | undefined = pathRows
    ? pathRows
    : params.distributionOctants
      ? assignMovementLoadsExact(
          bearingIntersectionToSite,
          params.distributionOctants,
          addedTripsExact,
          params.inFraction,
        )
      : undefined;

  // (`volShares` is defined above, beside the timing resolution.)
  // Legacy fallback (no distribution octants): cosine-similarity split with a
  // 0.10 floor on every approach; the out-flow leaves on the approach opposite
  // the inbound origin. Kept only for payloads where no distribution ran.
  const tripShares = movementAdded ? undefined : approachAddedTripShares(c.sig, project);
  const approaches: ApproachImpact[] = DIRECTIONS.map((d) => {
    // Current-year baseline (no growth) for this approach.
    const currentVolByApproach = currentVolume * volShares[d];
    const capD = approachCap(d);
    const currentVcByApproach = currentVolByApproach / capD;
    const currentDelayByApproach = vcToDelay(currentVcByApproach, capD, cyc, gcApp(d)) * calMul;

    // No-Build (existing-grown-to-opening-year).
    const baseVol = grownVolume * volShares[d];
    // Distribute the EXACT junction load across approaches — distributing the
    // pre-rounded integer double-rounded the split and could zero out every
    // approach on a sub-vehicle junction load (high-PTAL London schemes).
    const addedOnApproach = movementAdded
      ? movementAdded[d]
      : addedTripsExact * params.inFraction * tripShares![d]
        + addedTripsExact * (1 - params.inFraction) * tripShares![oppositeDir(d)];
    const futureVol = baseVol + addedOnApproach;

    // Printed +Trips: when the movements table is printed alongside, sum ITS
    // integer rows for this approach so the two columns cross-foot exactly
    // (independent rounding could drift ±1); otherwise round the exact load.
    const addedTripsPeak = movements && movements.length > 0
      ? movements.reduce((s, m) => s + (m.approach === d ? m.trips : 0), 0)
      : Math.round(addedOnApproach);

    const exVc = (baseVol * 1.0) / capD;
    const fuVc = (futureVol * 1.0) / capD;
    const exDelay = vcToDelay(exVc, capD, cyc, gcApp(d)) * calMul;
    const fuDelay = vcToDelay(fuVc, capD, cyc, gcApp(d)) * calMul;
    return {
      direction: d,
      currentVolumeVph: round1(currentVolByApproach),
      currentVc: round2(currentVcByApproach),
      currentDelaySec: round1(currentDelayByApproach),
      currentLos: delayToLos(currentDelayByApproach),
      existingVolumeVph: round1(baseVol),
      addedTripsPeak,
      futureVolumeVph: round1(futureVol),
      existingVc: round2(exVc),
      futureVc: round2(fuVc),
      existingDelaySec: round1(exDelay),
      futureDelaySec: round1(fuDelay),
      existingLos: delayToLos(exDelay),
      futureLos: delayToLos(fuDelay),
      queue95thFt: round1(queue95Ft(futureVol, capD, cyc, gcApp(d))),
      ...(laneInfo[d].source !== "default" ? { throughLanes: laneInfo[d].lanes, lanesSource: laneInfo[d].source } : {}),
      // Project-trip L/T/R for this approach, from the geometric assignment
      // already computed above off the distribution octants. Emitted so the
      // UTDF export can write existing + a REAL project split instead of
      // flattening the total to 10/80/10. Project increment only — the
      // background split is still unmeasured at screening level.
      ...(() => {
        if (!movements) return {};
        const byMv = { L: 0, T: 0, R: 0 };
        let any = false;
        for (const m of movements) {
          if (m.approach !== d) continue;
          byMv[m.movement] += m.trips;
          any = true;
        }
        return any ? { addedByMovement: byMv } : {};
      })(),
      // Per-movement queues, but only where an imported record supplies a real
      // turn split for the background traffic. Absent everywhere else on
      // purpose — see laneGroupsForApproach.
      ...(() => {
        if (!c.utdf) return {};
        const addedExactByMovement: Record<Movement, number> = { L: 0, T: 0, R: 0 };
        if (pathRows && pathRows.length > 0) {
          for (const r of pathRows) {
            if (r.approach === d) addedExactByMovement[r.movement] += r.exact;
          }
        } else {
          // Not path-resolved (no routed graph, or this candidate failed to
          // snap). Fall back to the OCTANT movement split, which is the same
          // array addedTripsPeak itself is summed from — so the lane-group
          // rows cross-foot to the approach row by construction.
          //
          // Previously this branch left the record at all-zeros, which made
          // exactTotal 0 in the allocator; the largest-remainder loop can only
          // add one trip per movement, so an approach carrying 45 added trips
          // printed 1/1/1 and silently discarded 42 of them — under a caption
          // that tells the reviewer the columns cross-foot.
          for (const m of movements ?? []) {
            if (m.approach === d) addedExactByMovement[m.movement] += m.trips;
          }
        }
        const laneGroups = laneGroupsForApproach({
          approach: d,
          utdf: c.utdf,
          approachVolumeVph: baseVol,
          addedExactByMovement,
          addedTripsPeak,
          laneCapacityVph: capD / laneInfo[d].lanes,
          cycleLenS: cyc,
          ...(laneInfo[d].source === "osm" ? { osmThroughLanes: laneInfo[d].lanes } : {}),
          ...(timing
            ? {
                laneCapacityByMovement: {
                  L: SATURATION_FLOW_VPH * gOverCForMovement(timing, d, "L") * weatherFactor,
                  T: capD / laneInfo[d].lanes,
                  R: capD / laneInfo[d].lanes,
                },
                gOverCByMovement: {
                  L: gOverCForMovement(timing, d, "L"),
                  T: gOverCForApproach(timing, d),
                  R: gOverCForApproach(timing, d),
                },
              }
            : {}),
          useRealLaneGeometry: params.realLaneGeometry,
        });
        return laneGroups ? { laneGroups } : {};
      })(),
    };
  });

  const worstQueue = approaches.reduce((m, a) => Math.max(m, a.queue95thFt), 0);

  // Every analyzed horizon goes to the test, not just the opening year.
  let mit = recommendMitigation([
    { label: "opening year", delta: afterDelay - beforeDelay, los: afterLos },
    ...(hasDesignYear
      ? [{ label: "design year", delta: designBuildDelay - designNoBuildDelay, los: designBuildLos }]
      : []),
  ]);

  // Turbo-lane (continuous-green-T) screening. Computed for every candidate
  // 3-leg T-intersection regardless of LOS; when the intersection also fails
  // under Build, the turbo option is folded into the mitigation prose.
  let turboLane: TurboLaneScreening | undefined;
  const turboCand = screenTurboCandidate(c.sig);
  if (turboCand) {
    const volOf = (d: Direction) =>
      approaches.find((a) => a.direction === d)?.futureVolumeVph ?? 0;
    const [m1, m2] = turboCand.mainStreetDirections;
    const turboDirection = volOf(m1) >= volOf(m2) ? m1 : m2;
    turboLane = turboLaneScreening(
      turboCand,
      turboDirection,
      volOf(turboDirection),
      volOf(turboCand.minorLegDirection),
      calMul,
    );
    if (afterLos === "E" || afterLos === "F" || afterDelay - beforeDelay >= 15) {
      mit = {
        severity: mit.severity,
        text:
          `${mit.text} As a signalized 3-leg T-intersection, it is also a turbo-lane (continuous-green T, ` +
          `Type ${turboLane.turboType}) candidate: running the ${turboLane.turboDirection} main-street through ` +
          `continuously recovers ≈${Math.round(turboLane.capacityGainPct)}% approach capacity ` +
          `(v/c ${turboLane.baselineApproachVc.toFixed(2)} → ${turboLane.mitigatedApproachVc.toFixed(2)}), ` +
          `subject to field verification of the median and right-of-way.`,
      };
    }
  }

  return {
    signalId: c.sig.id,
    ...(c.sig.mainThroughLanesMeasured && c.sig.mainThroughLanes
      ? { mainThroughLanes: c.sig.mainThroughLanes, mainThroughLanesMeasured: true }
      : {}),
    ...(c.sig.minorThroughLanes ? { minorThroughLanes: c.sig.minorThroughLanes } : {}),
    name: c.sig.name,
    zone: c.sig.zone,
    latitude: c.sig.latitude,
    longitude: c.sig.longitude,
    distanceMi: round2(c.distanceMi),
    // Exact re-solve inputs — unrounded, exactly what this call received.
    designHourVolumeVph: measured ? measured.totalVph : c.sig.totalVolume,
    loadWeight: weight,
    ...(pathTurns ? { pathTurns } : {}),
    ...(pathTurnsIn !== undefined ? { pathTurnsIn } : {}),
    ...(movementsExact && movementsExact.length > 0 ? { movementsExact } : {}),
    ...(c.utdfIndex !== undefined ? { utdfRecordIndex: c.utdfIndex } : {}),
    currentVc: round2(currentVc),
    currentDelaySec: round1(currentDelay),
    currentLos: currentLos,
    existingVc: round2(beforeVc),
    addedTripsPmPeak: addedTrips,
    futureVc: round2(afterVc),
    existingDelaySec: round1(beforeDelay),
    futureDelaySec: round1(afterDelay),
    existingLos: beforeLos,
    futureLos: afterLos,
    ...(hasDesignYear
      ? {
          designNoBuildVc: round2(designNoBuildVc),
          designNoBuildDelaySec: round1(designNoBuildDelay),
          designNoBuildLos,
          designBuildVc: round2(designBuildVc),
          designBuildDelaySec: round1(designBuildDelay),
          designBuildLos,
        }
      : {}),
    losChanged: beforeLos !== afterLos,
    mitigation: mit.text,
    mitigationSeverity: mit.severity,
    approaches,
    queue95thFt: round1(worstQueue),
    calibration: calibration
      ? {
          sampleCount: calibration.sampleCount,
          delayMultiplier: round2(calibration.multiplier),
          delayMultiplierExact: calibration.multiplier,
          lastObservedDelaySec: calibration.lastObservedDelaySec,
        }
      : undefined,
    turboLane,
    ...(movements && movements.length > 0 ? { movements } : {}),
    ...(movements && movements.length > 0 && params.conservedLabeling
      ? { movementSource: (pathRows ? "path" : "octant") as "path" | "octant" }
      : {}),
    // UTDF measured-data provenance + payload, presence-gated on the attached
    // record so non-UTDF studies stay byte-identical field-by-field. The
    // label discriminates the importer: "synchro_pdf_tmc" = counts from a
    // Synchro report PDF (matched by name), "utdf_tmc" = UTDF text export
    // (matched by coordinates) — a reviewer sees which artifact to audit.
    ...(measured
      ? {
          volumeSource: (c.utdf?.source === "synchro_pdf"
            ? "synchro_pdf_tmc"
            : "utdf_tmc") as "utdf_tmc" | "synchro_pdf_tmc",
        }
      : {}),
    ...(utdfCycleLenS !== undefined ? { utdfCycleLenSec: utdfCycleLenS } : {}),
    ...(timing
      ? {
          signalTiming: {
            basis: timing.basis,
            ...(timing.source ? { source: timing.source } : {}),
            cycleLenSec: timing.cycleLenS,
            criticalPhases: timing.criticalPhases,
            gOverCns: round3(timing.gOverCns),
            gOverCew: round3(timing.gOverCew),
            ...(timing.gOverCnsLeft !== undefined ? { gOverCnsLeft: round3(timing.gOverCnsLeft) } : {}),
            ...(timing.gOverCewLeft !== undefined ? { gOverCewLeft: round3(timing.gOverCewLeft) } : {}),
            gOverCnsExact: timing.gOverCns,
            gOverCewExact: timing.gOverCew,
            ...(timing.gOverCnsLeft !== undefined ? { gOverCnsLeftExact: timing.gOverCnsLeft } : {}),
            ...(timing.gOverCewLeft !== undefined ? { gOverCewLeftExact: timing.gOverCewLeft } : {}),
            leftPhasingNs: timing.leftPhasing.ns,
            leftPhasingEw: timing.leftPhasing.ew,
            leftPhasingSource: timing.leftPhasingSource,
            criticalFlowRatio: timing.criticalFlowRatio,
            pedMinGreenNsSec: round1(timing.pedMinGreenS.ns),
            pedMinGreenEwSec: round1(timing.pedMinGreenS.ew),
          } satisfies SignalTimingProvenance,
        }
      : {}),
    ...(() => {
      const storage = measured && c.utdf ? utdfGoverningStorage(c.utdf) : undefined;
      return storage
        ? { existingStorageFt: storage.storageFt, storageMovement: storage.movement }
        : {};
    })(),
  };
}

export function oppositeDir(d: Direction): Direction {
  switch (d) {
    case "NB": return "SB";
    case "SB": return "NB";
    case "EB": return "WB";
    case "WB": return "EB";
  }
}
export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function round1(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
