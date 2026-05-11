// TIS-in-a-box — Traffic Impact Study generator (Phase 1, deepened).
//
// Phase-1 capabilities (over the original screening report):
//   - Multi-period analysis: AM peak, PM peak, Saturday midday, daily totals.
//   - Approach-level HCM analysis: NB/SB/EB/WB v/c, delay, LOS, 95th-pct queue.
//   - Background-growth multiplier on existing volume to opening year.
//   - Weather adjustment (HCM Ch. 11) on capacity (rain/snow severity).
//   - Pass-by + internal-capture credits before off-site assignment
//     (ITE Pass-By Trip Generation Manual; ULI Mixed-Use Internal Capture).
//   - Monte-Carlo sensitivity analysis (100 iterations) over trip-rate and
//     existing-volume uncertainty.
//   - Project templates (frontend; engine just needs the LU rates).
//
// All math remains transparent. Constants are either published ITE rates,
// HCM thresholds, or clearly-stated engineering assumptions.

import { logger } from "./logger";
import { loadCalibrationMap, type CalibrationEntry } from "./tis-calibration";
// Canonical land-use registry (ITE 11th Ed.) lives in one place so the
// Parking engine and TIS engine stay in sync. Re-exported below for any
// downstream callers that imported `LAND_USES` from this module.
import { LAND_USES, type LandUse } from "./land-uses";

export { LAND_USES, type LandUse };

export function getLandUse(code: string): LandUse | undefined {
  return LAND_USES.find((l) => l.code === code);
}

// ---------- HCM LOS thresholds (HCM 6th Ed, Ex. 19-8) ----------

export type Los = "A" | "B" | "C" | "D" | "E" | "F";

const LOS_THRESHOLDS: Array<{ los: Los; maxDelay: number }> = [
  { los: "A", maxDelay: 10 },
  { los: "B", maxDelay: 20 },
  { los: "C", maxDelay: 35 },
  { los: "D", maxDelay: 55 },
  { los: "E", maxDelay: 80 },
  { los: "F", maxDelay: Infinity },
];

export function delayToLos(delaySec: number): Los {
  for (const t of LOS_THRESHOLDS) if (delaySec <= t.maxDelay) return t.los;
  return "F";
}

const CYCLE_LEN = 90;
const G_OVER_C = 0.45;
const SATURATION_FLOW_VPH = 1800;
const CRITICAL_MOVEMENT_FRACTION = 0.45;
const PER_INTERSECTION_CAPACITY_VPH = SATURATION_FLOW_VPH * G_OVER_C;
const APPROACH_CAPACITY_VPH = PER_INTERSECTION_CAPACITY_VPH; // 1 critical lane per approach
const VEH_LENGTH_FT = 25;

// Weather capacity adjustment (HCM Ch. 11). Multiplied into the saturation
// flow (and thus the lane group capacity).
export type Weather = "clear" | "light_rain" | "heavy_rain" | "light_snow" | "heavy_snow";
const WEATHER_FACTOR: Record<Weather, number> = {
  clear: 1.0,
  light_rain: 0.95,
  heavy_rain: 0.86,
  light_snow: 0.86,
  heavy_snow: 0.70,
};

export type AnalysisPeriod = "am_peak" | "pm_peak" | "saturday_midday" | "daily";

const PERIOD_LABEL: Record<AnalysisPeriod, string> = {
  am_peak: "AM Peak Hour",
  pm_peak: "PM Peak Hour",
  saturday_midday: "Saturday Midday",
  daily: "Daily Total",
};

export type Direction = "NB" | "SB" | "EB" | "WB";
const DIRECTIONS: Direction[] = ["NB", "SB", "EB", "WB"];

// Approach origin bearings (degrees from north): the compass direction the
// driver is COMING FROM when approaching the signal on that approach.
//   NB approach → driver is south of signal moving north  → origin bearing 180
//   SB approach → driver is north of signal moving south  → origin bearing   0
//   EB approach → driver is west  of signal moving east   → origin bearing 270
//   WB approach → driver is east  of signal moving west   → origin bearing  90
const APPROACH_ORIGIN_BEARING: Record<Direction, number> = {
  NB: 180, SB: 0, EB: 270, WB: 90,
};

// ---------- HCM signalized-intersection delay (Ex. 19-18) ----------

export function vcToDelay(vc: number, capacityVph: number = PER_INTERSECTION_CAPACITY_VPH): number {
  const x = Math.max(0, vc);
  const xForD1 = Math.min(0.99, x);
  const d1 = (0.5 * CYCLE_LEN * Math.pow(1 - G_OVER_C, 2)) / (1 - xForD1 * G_OVER_C);

  const T = 0.25;
  const k = 0.5;
  const d2 = x > 0
    ? 900 * T * ((x - 1) + Math.sqrt(Math.pow(x - 1, 2) + (8 * k * x) / (capacityVph * T)))
    : 0;

  return d1 + d2;
}

// 95th-percentile back-of-queue length per HCM 6th Ed. Eq. 19-50, simplified.
//   Q1 (avg vehicles per cycle queued) = (vph/3600) * C * (1 - g/C) / (1 - x*g/C)
//   Q95 ≈ Q1 * 1.65  (Poisson incremental factor, undersaturated)
//   length_ft = Q95 * VEH_LENGTH_FT
export function queue95Ft(approachVph: number, capacityVph: number): number {
  if (approachVph <= 0) return 0;
  const x = Math.min(0.99, approachVph / capacityVph);
  const arrPerSec = approachVph / 3600;
  const q1 = (arrPerSec * CYCLE_LEN * (1 - G_OVER_C)) / Math.max(0.05, 1 - x * G_OVER_C);
  const q95 = q1 * 1.65;
  return q95 * VEH_LENGTH_FT;
}

// ---------- Geo helpers ----------

const EARTH_R_M = 6371000;
function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_M * Math.asin(Math.sqrt(s));
}

// Initial bearing from a → b, in degrees from north (0..360).
function bearingDeg(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lon - a.lon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

const M_PER_MI = 1609.34;

// ---------- Deterministic per-signal hash + PRNG ----------

function hash32(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
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
function approachVolumeShares(signalId: string): Record<Direction, number> {
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

// Distribute added project trips to the four approaches, weighted by the
// cosine similarity between (a) the approach's origin bearing and (b) the
// bearing from the signal back to the project site. Floor of 0.10 each so
// every approach gets at least some trips.
function approachAddedTripShares(
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

// Inverse-distance weights for assigning project trips across affected signals.
function assignmentWeights(affected: Array<{ distanceMi: number }>): number[] {
  if (affected.length === 0) return [];
  const raw = affected.map((a) => 1 / Math.max(0.06, a.distanceMi));
  const total = raw.reduce((s, v) => s + v, 0);
  return total > 0 ? raw.map((v) => v / total) : raw.map(() => 1 / raw.length);
}

// ---------- Intersection-summary fetch from analyzer ----------

type AnalyzerIntersection = {
  id: string;
  name: string;
  zone: string;
  latitude: number;
  longitude: number;
  totalVolume: number;
};

const ANALYZER_BASE_URL = process.env["ANALYZER_API_URL"] ?? "http://localhost:8080";

let intersectionCache: AnalyzerIntersection[] | null = null;
let inFlight: Promise<AnalyzerIntersection[]> | null = null;
const ANALYZER_FETCH_TIMEOUT_MS = 5000;

async function fetchIntersections(): Promise<AnalyzerIntersection[]> {
  if (intersectionCache) return intersectionCache;
  if (inFlight) return inFlight;
  const url = `${ANALYZER_BASE_URL}/api/atlanta/intersections`;
  inFlight = (async (): Promise<AnalyzerIntersection[]> => {
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
      intersectionCache = json as AnalyzerIntersection[];
      logger.info({ count: intersectionCache.length, url }, "tis.intersections_loaded");
      return intersectionCache;
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
  try {
    return await inFlight;
  } finally {
    inFlight = null;
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
};

export type ApproachImpact = {
  direction: Direction;
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

export type AffectedIntersection = {
  signalId: string;
  name: string;
  zone: string;
  latitude: number;
  longitude: number;
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
  // Phase 1 additions
  approaches: ApproachImpact[];
  queue95thFt: number; // worst approach
  // Phase 2 moat: when ground-truth observations exist for this signal we
  // adjust HCM delay by `delayMultiplier` and surface the metadata so the
  // printed report can render a "calibrated against N samples" badge.
  calibration?: {
    sampleCount: number;
    delayMultiplier: number;
    lastObservedDelaySec: number | null;
  };
};

export type TripGenerationSummary = {
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

export type PeriodTripGen = {
  period: AnalysisPeriod;
  periodLabel: string;
  rawTrips: number;
  passByCredit: number;
  internalCaptureCredit: number;
  externalTrips: number;
  inTrips: number;
  outTrips: number;
};

export type PeriodReport = {
  period: AnalysisPeriod;
  periodLabel: string;
  tripGeneration: PeriodTripGen;
  affectedIntersections: AffectedIntersection[];
  intersectionsWithLosDrop: number;
  intersectionsAtLosEf: number;
  worstDelayDeltaSec: number;
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
  weather: Weather;
  weatherCapacityFactor: number;
  passByPctApplied: number;
  internalCapturePctApplied: number;
  sensitivity?: SensitivityResult;
};

// ---------- Implementation ----------

const CURRENT_YEAR = new Date().getUTCFullYear();

async function findAffectedIntersections(
  lat: number, lon: number, radiusMi: number,
): Promise<Array<{ sig: AnalyzerIntersection; distanceMi: number }>> {
  const radiusM = radiusMi * M_PER_MI;
  const inventory = await fetchIntersections();
  const out: Array<{ sig: AnalyzerIntersection; distanceMi: number }> = [];
  for (const s of inventory) {
    const dM = haversineM({ lat, lon }, { lat: s.latitude, lon: s.longitude });
    if (dM <= radiusM) {
      out.push({ sig: s, distanceMi: dM / M_PER_MI });
    }
  }
  out.sort((a, b) => a.distanceMi - b.distanceMi);
  return out;
}

function periodRawTrips(lu: LandUse, size: number, period: AnalysisPeriod): number {
  switch (period) {
    case "am_peak": return lu.amRate * size;
    case "pm_peak": return lu.pmRate * size;
    case "saturday_midday": return lu.pmRate * size * lu.satMultiplier;
    case "daily": return lu.dailyRate * size;
  }
}

function periodDirectionalIn(lu: LandUse, period: AnalysisPeriod): number {
  switch (period) {
    case "am_peak": return lu.amDirectionalIn;
    case "pm_peak": return lu.directionalSplitPm.in;
    case "saturday_midday": return 0.50;
    case "daily": return 0.50;
  }
}

function recommendMitigation(
  delayDelta: number, futureLos: Los,
): { text: string; severity: AffectedIntersection["mitigationSeverity"] } {
  if (futureLos === "F") {
    return {
      text: "Major: add a dedicated turn lane on the critical approach AND retime the signal; reconsider site driveway alignment or development scale if delay remains above 80s.",
      severity: "major",
    };
  }
  if (futureLos === "E" || delayDelta >= 15) {
    return {
      text: "Moderate: extend critical-phase green time and consider a protected-only left-turn phase to absorb the new demand without queue spillback.",
      severity: "moderate",
    };
  }
  if (delayDelta >= 5 || (futureLos === "D" && delayDelta > 0)) {
    return {
      text: "Minor: signal-timing optimization (shift 3–5s of green to the critical phase) is sufficient. No geometric change required.",
      severity: "minor",
    };
  }
  return {
    text: "No mitigation required — projected delay change is below the City's 5-second TIS threshold.",
    severity: "none",
  };
}

type ScenarioParams = {
  growthMultiplier: number;       // applied to existing volume
  capacityVph: number;            // weather-adjusted intersection capacity
  approachCapacityVph: number;    // weather-adjusted approach capacity
  externalTrips: number;          // post-credit external trips for this period
  inFraction: number;             // directional split for this period
};

function buildAffectedRow(
  c: { sig: AnalyzerIntersection; distanceMi: number },
  weight: number,
  project: { lat: number; lon: number },
  params: ScenarioParams,
  calibration?: CalibrationEntry,
): AffectedIntersection {
  const grownVolume = c.sig.totalVolume * params.growthMultiplier;
  const beforeCriticalVph = grownVolume * CRITICAL_MOVEMENT_FRACTION;
  const beforeVc = beforeCriticalVph / params.capacityVph;

  const addedTrips = Math.round(params.externalTrips * weight);
  const addedCriticalVph = addedTrips * CRITICAL_MOVEMENT_FRACTION;
  const afterVc = beforeVc + addedCriticalVph / params.capacityVph;

  // HCM delay first; calibration multiplier applied AFTER so the LOS bucket
  // reflects the calibrated value reviewers care about. When no row exists
  // for this signal `multiplier` is 1.0 and behavior is unchanged.
  // Clamp to a sane positive range so a bad calibration row (e.g. 0 or
  // negative) cannot collapse delay → push every signal to LOS A and
  // wreck mitigation decisions. Range mirrors the DB CHECK constraint.
  const calMul = Math.min(5, Math.max(0.25, calibration?.multiplier ?? 1.0));
  const beforeDelay = vcToDelay(beforeVc, params.capacityVph) * calMul;
  const afterDelay = vcToDelay(afterVc, params.capacityVph) * calMul;
  const beforeLos = delayToLos(beforeDelay);
  const afterLos = delayToLos(afterDelay);

  // Approach split.
  const volShares = approachVolumeShares(c.sig.id);
  const tripShares = approachAddedTripShares(c.sig, project);
  // Note: added trips arrive at the signal from outside, so each approach
  // gains (in-fraction × addedTrips × tripShares[d]); the out-flow leaves on
  // the opposite approach. For peak-hour delay we model both as a directional
  // load using the inbound share + outbound share split per direction.
  const approaches: ApproachImpact[] = DIRECTIONS.map((d) => {
    const baseVol = grownVolume * volShares[d];
    const inOnApproach = addedTrips * params.inFraction * tripShares[d];
    // Outbound trips depart on the approach opposite the inbound origin.
    const oppositeShare = tripShares[oppositeDir(d)];
    const outOnApproach = addedTrips * (1 - params.inFraction) * oppositeShare;
    const futureVol = baseVol + inOnApproach + outOnApproach;

    const exVc = (baseVol * 1.0) / params.approachCapacityVph;
    const fuVc = (futureVol * 1.0) / params.approachCapacityVph;
    const exDelay = vcToDelay(exVc, params.approachCapacityVph) * calMul;
    const fuDelay = vcToDelay(fuVc, params.approachCapacityVph) * calMul;
    return {
      direction: d,
      existingVolumeVph: round1(baseVol),
      addedTripsPeak: Math.round(inOnApproach + outOnApproach),
      futureVolumeVph: round1(futureVol),
      existingVc: round2(exVc),
      futureVc: round2(fuVc),
      existingDelaySec: round1(exDelay),
      futureDelaySec: round1(fuDelay),
      existingLos: delayToLos(exDelay),
      futureLos: delayToLos(fuDelay),
      queue95thFt: round1(queue95Ft(futureVol, params.approachCapacityVph)),
    };
  });

  const worstQueue = approaches.reduce((m, a) => Math.max(m, a.queue95thFt), 0);
  const mit = recommendMitigation(afterDelay - beforeDelay, afterLos);

  return {
    signalId: c.sig.id,
    name: c.sig.name,
    zone: c.sig.zone,
    latitude: c.sig.latitude,
    longitude: c.sig.longitude,
    distanceMi: round2(c.distanceMi),
    existingVc: round2(beforeVc),
    addedTripsPmPeak: addedTrips,
    futureVc: round2(afterVc),
    existingDelaySec: round1(beforeDelay),
    futureDelaySec: round1(afterDelay),
    existingLos: beforeLos,
    futureLos: afterLos,
    losChanged: beforeLos !== afterLos,
    mitigation: mit.text,
    mitigationSeverity: mit.severity,
    approaches,
    queue95thFt: round1(worstQueue),
    calibration: calibration
      ? {
          sampleCount: calibration.sampleCount,
          delayMultiplier: round2(calibration.multiplier),
          lastObservedDelaySec: calibration.lastObservedDelaySec,
        }
      : undefined,
  };
}

function oppositeDir(d: Direction): Direction {
  switch (d) {
    case "NB": return "SB";
    case "SB": return "NB";
    case "EB": return "WB";
    case "WB": return "EB";
  }
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
): string[] {
  const out: string[] = [];
  out.push(
    `Project will generate ${trips.dailyTrips.toLocaleString()} new daily vehicle trips, with ${trips.pmPeakTrips} during the PM peak hour (${trips.pmIn} inbound / ${trips.pmOut} outbound).`,
  );
  if (passByPct > 0 || internalCapPct > 0) {
    out.push(
      `Pass-by credit ${passByPct.toFixed(0)}% and internal-capture credit ${internalCapPct.toFixed(0)}% applied at the PM peak before off-site assignment (ITE Pass-By Trip Generation Manual; ULI Internal Capture).`,
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
      `Weather scenario "${weather.replace("_", " ")}" reduced lane-group capacity by ${(100 * (1 - weatherFactor)).toFixed(0)}% per HCM Ch. 11.`,
    );
  }
  if (rows.length === 0) {
    out.push("No signalized intersections were found within the study radius — no off-site capacity impact is anticipated.");
    return out;
  }
  const dropped = rows.filter((r) => r.losChanged).length;
  const ef = rows.filter((r) => r.futureLos === "E" || r.futureLos === "F").length;
  out.push(
    `${rows.length} signalized intersection${rows.length === 1 ? "" : "s"} fall within the study area; ${dropped} are projected to drop at least one LOS grade after build-out.`,
  );
  if (ef > 0) {
    out.push(`${ef} intersection${ef === 1 ? " is" : "s are"} projected to operate at LOS E or F under the build condition and require formal mitigation per City of Atlanta DOT TIS guidance.`);
  } else {
    out.push("All studied intersections are projected to remain at LOS D or better with build traffic; no formal mitigation is required.");
  }
  const worst = rows.reduce<AffectedIntersection | null>(
    (a, b) => (a == null || (b.futureDelaySec - b.existingDelaySec) > (a.futureDelaySec - a.existingDelaySec) ? b : a),
    null,
  );
  if (worst && worst.futureDelaySec - worst.existingDelaySec >= 5) {
    out.push(
      `Worst-impact location: ${worst.name} — projected delay rises ${(worst.futureDelaySec - worst.existingDelaySec).toFixed(1)}s (LOS ${worst.existingLos} → ${worst.futureLos}); 95th-pct queue ${worst.queue95thFt.toFixed(0)} ft on the critical approach.`,
    );
  }
  if (sens) {
    out.push(
      `Monte-Carlo sensitivity (${sens.iterations} runs, ±10% trip-rate / ±15% existing-volume): worst-case delay change is ${sens.worstDelayDeltaP50.toFixed(1)}s (median); 80% range ${sens.worstDelayDeltaP10.toFixed(1)}–${sens.worstDelayDeltaP90.toFixed(1)}s. Probability of ≥1 LOS drop: ${(sens.probAnyLosDrop * 100).toFixed(0)}%.`,
    );
  }
  return out;
}

const TIS_METHODOLOGY = [
  "Trip generation uses ITE Trip Generation Manual 11th-Edition average rates for the selected land-use code, computed for AM peak, PM peak, Saturday midday, and daily totals. Saturday-midday rates are estimated as a published industry multiple of the PM peak rate by land-use category.",
  "Pass-by and internal-capture credits are applied at the PM peak per ITE's Pass-By Trip Generation Manual (3rd Edition) and ULI Mixed-Use Internal Capture defaults; only the residual external trips are assigned to off-site intersections.",
  "Existing intersection volumes are grown to the opening-year horizon at the user-supplied annual growth rate (default 1.5%/yr) before the capacity analysis.",
  "Weather adjustment follows HCM 6th-Edition Ch. 11 (rain/snow capacity reduction): clear 1.00, light rain 0.95, heavy rain 0.86, light snow 0.86, heavy snow 0.70. The factor multiplies the saturation flow at every intersection.",
  "Off-site impact is screened for all signalized intersections within the study radius (default 0.5 mi). New trips are assigned by inverse-distance weighting (clamped at 100m), normalised to sum to 100% of the period's external trip total.",
  "Intersection-level control delay uses the HCM signalized-intersection model d = d1 + d2 (Webster uniform delay + Akçelik/HCM incremental-delay term) with a 90s cycle, g/C = 0.45, 1,800 vphpl saturation flow (× weather factor), 15-minute peak analysis period (T = 0.25 hr) and pretimed-signal incremental-delay factor k = 0.5.",
  "Approach-level analysis splits each signal's inflow across NB/SB/EB/WB approaches (deterministic per-signal allocation perturbed ±15% from a 30/25/25/20 base) and assigns added trips to each approach by cosine-similarity to the bearing of the project relative to the signal. Per-approach v/c, control delay, LOS, and 95th-percentile back-of-queue length (HCM Eq. 19-50, Q95 ≈ Q1 × 1.65 × 25 ft/veh) are reported.",
  "Level of Service is assigned from HCM 6th-Edition signalized-intersection control-delay thresholds (Exhibit 19-8): A ≤10s, B ≤20s, C ≤35s, D ≤55s, E ≤80s, F >80s.",
  "Optional Monte-Carlo sensitivity perturbs the project trip rate by N(1, 0.10) and the baseline existing volume by N(1, 0.15) over 100 iterations and reports the resulting distribution of worst-case delay change and probability of any LOS drop.",
  "Mitigations are screening-level recommendations sized to the projected delay change, not full Synchro/SimTraffic optimization runs. A formal TIS submittal should validate these recommendations with detailed traffic counts and signal-timing analysis.",
];

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
  weights: number[],
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
      const w = weights[idx] ?? 0;
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
    throw new Error(`Unknown ITE land-use code: ${req.landUseCode}`);
  }
  if (!Number.isFinite(req.size) || req.size <= 0) {
    throw new Error("size must be a positive number");
  }
  const radiusMi = req.studyRadiusMi ?? 0.5;

  const periods = (req.analysisPeriods && req.analysisPeriods.length > 0)
    ? req.analysisPeriods
    : (["am_peak", "pm_peak", "saturday_midday", "daily"] as AnalysisPeriod[]);

  const growthRatePct = clamp(req.growthRatePct ?? 1.5, 0, 6);
  const growthYears = Math.max(0, req.openingYear - CURRENT_YEAR);
  const growthMultiplier = Math.pow(1 + growthRatePct / 100, growthYears);

  const weather = req.weather ?? "clear";
  const weatherFactor = WEATHER_FACTOR[weather];
  const capacityVph = PER_INTERSECTION_CAPACITY_VPH * weatherFactor;
  const approachCapacityVph = APPROACH_CAPACITY_VPH * weatherFactor;

  const passByPct = clamp(req.passByPct ?? lu.passByPctPm, 0, 70);
  const internalCapturePct = clamp(req.internalCapturePct ?? lu.internalCapturePctPm, 0, 50);

  const candidates = await findAffectedIntersections(req.latitude, req.longitude, radiusMi);
  const weights = assignmentWeights(candidates);
  const project = { lat: req.latitude, lon: req.longitude };
  const calibrationMap = await loadCalibrationMap();

  // Per-period analyses.
  const periodReports: PeriodReport[] = [];
  for (const period of periods) {
    const raw = periodRawTrips(lu, req.size, period);
    // Pass-by + internal capture only credit at the PM peak (most defensible
    // application). For other periods we apply 25% of the PM credit fraction
    // (industry rule of thumb that off-peak shopping has less pass-by).
    const creditScale = period === "pm_peak" ? 1.0 : 0.25;
    const passByCredit = raw * (passByPct / 100) * creditScale;
    const internalCredit = (raw - passByCredit) * (internalCapturePct / 100) * creditScale;
    const externalTrips = Math.max(0, raw - passByCredit - internalCredit);
    const inFraction = periodDirectionalIn(lu, period);
    const inTrips = Math.round(externalTrips * inFraction);
    const outTrips = Math.round(externalTrips) - inTrips;

    const params: ScenarioParams = {
      growthMultiplier,
      capacityVph,
      approachCapacityVph,
      externalTrips,
      inFraction,
    };

    // For "daily" we don't run an intersection-level analysis (HCM control
    // delay isn't defined over a 24-hour window). Emit trip generation only.
    const rows = period === "daily"
      ? []
      : candidates.map((c, i) =>
          buildAffectedRow(c, weights[i] ?? 0, project, params, calibrationMap.get(c.sig.id)),
        );

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
      },
      affectedIntersections: rows,
      intersectionsWithLosDrop: dropCount,
      intersectionsAtLosEf: efCount,
      worstDelayDeltaSec: round1(worstDelta),
    });
  }

  // PM peak is the canonical/back-compat block. If the user excluded PM,
  // synthesize it for the back-compat fields so downstream consumers don't
  // crash.
  const pmReport = periodReports.find((p) => p.period === "pm_peak")
    ?? (await synthesizePmReport(lu, req, candidates, weights, project, growthMultiplier, capacityVph, approachCapacityVph, passByPct, internalCapturePct));

  // Top-level back-compat trip-generation summary uses ORIGINAL (non-credited)
  // PM trips so the existing UI labels keep their meaning.
  const dailyTrips = Math.round(lu.dailyRate * req.size);
  const amTrips = Math.round(lu.amRate * req.size);
  const pmTrips = Math.round(lu.pmRate * req.size);
  const pmIn = Math.round(pmTrips * lu.directionalSplitPm.in);
  const pmOut = pmTrips - pmIn;
  const tripGeneration: TripGenerationSummary = {
    landUseCode: lu.code,
    landUseName: lu.name,
    size: req.size,
    unit: lu.unit,
    dailyTrips,
    amPeakTrips: amTrips,
    pmPeakTrips: pmTrips,
    pmIn,
    pmOut,
  };

  // Sensitivity analysis (PM peak external trips).
  const sens = req.runSensitivity
    ? runSensitivityAnalysis(
        candidates,
        weights,
        pmReport.tripGeneration.externalTrips,
        capacityVph,
        growthMultiplier,
      )
    : undefined;

  const findings = plainFindings(
    tripGeneration,
    pmReport.affectedIntersections,
    growthYears,
    growthRatePct,
    weather,
    weatherFactor,
    passByPct,
    internalCapturePct,
    sens,
  );

  const mitigationSummary = buildSummaryMitigations(pmReport.affectedIntersections);

  return {
    generatedAt: new Date().toISOString(),
    request: req,
    studyRadiusMi: radiusMi,
    tripGeneration,
    affectedIntersections: pmReport.affectedIntersections,
    intersectionsStudied: pmReport.affectedIntersections.length,
    intersectionsWithLosDrop: pmReport.intersectionsWithLosDrop,
    intersectionsAtLosEf: pmReport.intersectionsAtLosEf,
    worstDelayDeltaSec: pmReport.worstDelayDeltaSec,
    mitigationSummary,
    findings,
    methodology: TIS_METHODOLOGY,
    periodReports,
    growthAppliedPct: growthRatePct,
    growthYears,
    weather,
    weatherCapacityFactor: round2(weatherFactor),
    passByPctApplied: passByPct,
    internalCapturePctApplied: internalCapturePct,
    sensitivity: sens,
  };
}

async function synthesizePmReport(
  lu: LandUse,
  req: TisRequest,
  candidates: Array<{ sig: AnalyzerIntersection; distanceMi: number }>,
  weights: number[],
  project: { lat: number; lon: number },
  growthMultiplier: number,
  capacityVph: number,
  approachCapacityVph: number,
  passByPct: number,
  internalCapturePct: number,
): Promise<PeriodReport> {
  const raw = periodRawTrips(lu, req.size, "pm_peak");
  const passByCredit = raw * (passByPct / 100);
  const internalCredit = (raw - passByCredit) * (internalCapturePct / 100);
  const externalTrips = Math.max(0, raw - passByCredit - internalCredit);
  const inFraction = lu.directionalSplitPm.in;
  const params: ScenarioParams = { growthMultiplier, capacityVph, approachCapacityVph, externalTrips, inFraction };
  const calibrationMap = await loadCalibrationMap();
  const rows = candidates.map((c, i) =>
    buildAffectedRow(c, weights[i] ?? 0, project, params, calibrationMap.get(c.sig.id)),
  );
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
  };
}

function buildSummaryMitigations(rows: AffectedIntersection[]): string[] {
  if (rows.length === 0) return ["No off-site mitigations required."];
  const major = rows.filter((r) => r.mitigationSeverity === "major");
  const moderate = rows.filter((r) => r.mitigationSeverity === "moderate");
  const minor = rows.filter((r) => r.mitigationSeverity === "minor");
  const none = rows.filter((r) => r.mitigationSeverity === "none");
  const out: string[] = [];
  if (major.length) {
    out.push(`Major mitigation required at ${major.length} intersection${major.length === 1 ? "" : "s"}: add critical-approach turn lane(s) and retime the signal; coordinate with City of Atlanta Office of Mobility Planning.`);
  }
  if (moderate.length) {
    out.push(`Moderate mitigation at ${moderate.length} intersection${moderate.length === 1 ? "" : "s"}: extend critical-phase green and add protected-only left-turn phasing as needed.`);
  }
  if (minor.length) {
    out.push(`Signal-timing optimization at ${minor.length} intersection${minor.length === 1 ? "" : "s"} (3–5s green-time shift toward the critical phase) is sufficient.`);
  }
  if (none.length === rows.length) {
    out.push("All studied intersections operate within the City's no-mitigation threshold (≤5s additional delay) under the build condition.");
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}
function round1(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
