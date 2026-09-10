/**
 * Scenario solver — re-solves a TIS report in the browser with the ENGINE'S
 * OWN row math (@workspace/tis-engine-core: buildAffectedRow,
 * recommendMitigation, buildSummaryMitigations, externalTripsForPeriod).
 *
 * Nothing here approximates delay, capacity or mitigation: every row is
 * rebuilt by the same function the server ran, from a candidate + params
 * reconstructed out of the report. What the browser CANNOT redo is the road
 * network — trip distribution (`tripDistribution.byDirection`) and the
 * path-turn ledgers are held at the base study's values, and driveway edits
 * go to the engine (`toWhatIfRequest` → POST /tis-api/whatif).
 *
 * Exactness. A report generated after Track E2 carries unrounded inputs
 * (`designHourVolumeVph`, `loadWeight`, `pathTurns`, `utdfRecordIndex`,
 * `delayMultiplierExact`, `jurisdiction`, …); with those the client solve is
 * byte-identical to the server. Reports that predate them (every saved study
 * today) are reconstructed from the PRINTED fields, and each substitution is
 * recorded on the solution's `fallbacks` so the UI can say so and U2 can
 * retire them. The documented substitutions and their error bounds:
 *
 *   baseVolume   the design-hour volume is the midpoint of the intersection
 *                of every printed approach volume's round1 interval
 *                (current + no-build, every period, ÷ the deterministic
 *                approach share) → typically ±0.03 vph; falls back to the
 *                sum of the PM current volumes (±0.2 vph).
 *   loadWeight   addedTripsPmPeak / (base PM external trips, exact)
 *                → weight to ±0.5 / externalTrips; other periods' integer
 *                trip counts may differ by ±1.
 *   pathLedger   movementSource:"path" rows without ledgers: the outbound and
 *                inbound share ledgers are solved per movement from two
 *                periods' printed movement tables (their in-fractions differ,
 *                so the 2×2 system is determined; integer rounding is the only
 *                error). With one period the printed pattern is held fixed.
 *   gOverC       a measured/measured-cycle timing whose Synchro record cannot
 *                be found is re-expressed as an override from the printed
 *                round3 g/C (±0.0005), labelled source "override".
 *   utdfAttach   without utdfRecordIndex the record is re-snapped by the
 *                engine's 0.35-mi coordinate rule, else by normalized name.
 *   calibration  delayMultiplier (round2) in place of the exact multiplier.
 *   jurisdiction planning office parsed from the base mitigation summary.
 *   turbo        turbo-lane geometry is not printable; the base screening
 *                rides along unchanged.
 *
 * scripts/check-scenario-solve.mjs pins these bounds on a real 40-row report.
 */
import type {
  TisReport,
  TisAffectedIntersection,
  TisPeriodReport,
  TisRequest,
  TisAnalysisPeriod,
  TisWeather,
  Driveway,
  UtdfIntersectionData,
} from "@workspace/tis-api-client-react";
import {
  LAND_USES,
  resolveRatesForVariable,
  externalTripsForPeriod,
  periodDirectionalIn,
  buildAffectedRow,
  buildSummaryMitigations,
  WEATHER_FACTOR,
  PERIOD_VOLUME_FACTOR,
  PER_INTERSECTION_CAPACITY_VPH,
  APPROACH_CAPACITY_VPH,
  DESIGN_YEAR_HORIZON_DEFAULT,
  approachVolumeShares,
  utdfMeasuredTotals,
  clamp,
  round1,
  round2,
  type AnalyzerIntersection,
  type UtdfIntersectionInput,
  type RowCalibration,
  type PathTurnShare,
  type ScenarioParams,
  type AffectedIntersection,
  type SignalTimingOverride,
  type Weather,
  type AnalysisPeriod,
  type LandUse,
  type ResolvedRates,
  type Direction,
} from "@workspace/tis-engine-core";

// ---------------------------------------------------------------------------
// The report fields Track E2 adds for an exact re-solve. They are not in the
// generated client types yet, so they are read through this local view and
// every absence falls back (and is flagged) as documented above.
// ---------------------------------------------------------------------------

export type ExactRowFields = {
  designHourVolumeVph?: number;
  loadWeight?: number;
  pathTurns?: PathTurnShare[];
  pathTurnsIn?: PathTurnShare[];
  mainThroughLanes?: number;
  minorThroughLanes?: number;
  mainThroughLanesMeasured?: boolean;
  utdfRecordIndex?: number;
  signalTiming?: {
    gOverCnsExact?: number;
    gOverCewExact?: number;
    gOverCnsLeftExact?: number;
    gOverCewLeftExact?: number;
  };
  calibration?: { delayMultiplierExact?: number };
};

export type ExactPeriodFields = {
  periodVolumeFactor?: number;
  inFraction?: number;
  externalTripsExact?: number;
  existingUseCreditExact?: number;
};

export type ExactFields = {
  designYear?: number;
  designYearHorizonYears?: number;
  regionCode?: string;
  jurisdiction?: { dotName: string; planningOfficeName: string };
  autoModeShareSource?: string;
  weatherFactorExact?: number;
};

type ExactRow = TisAffectedIntersection & Partial<ExactRowFields>;
type ExactPeriod = TisPeriodReport & Partial<ExactPeriodFields> & { tripGeneration: TisPeriodReport["tripGeneration"] & Partial<ExactPeriodFields> };
type ExactReport = TisReport & Partial<ExactFields>;

// ---------------------------------------------------------------------------
// Scenario state
// ---------------------------------------------------------------------------

/** One signal's timing plan as the Signal tab edits it: a cycle and the split
 *  (seconds, including the 5 s lost time) of every phase. Σ splits === cycle.
 *  Converted to the engine's Synchro-shaped override by `timingEditToOverride`. */
export type SignalTimingEdit = {
  cycleLenSec: number;
  nsThroughSplitS: number;
  ewThroughSplitS: number;
  /** Present ⇒ a protected left phase on that axis. */
  nsLeftSplitS?: number;
  ewLeftSplitS?: number;
};

export type ScenarioState = {
  /** Site edits; null = the base study's value. */
  size: number | null;
  passByPct: number | null;
  internalCapturePct: number | null;
  growthRatePct: number | null;
  weather: TisWeather | null;
  /** Per-signal timing overrides keyed by signalId. */
  timing: Record<string, SignalTimingEdit>;
  /** Access-tab driveways: a local copy of request.driveways, sent only to the engine. */
  driveways: Driveway[] | null;
  selectedSignalId: string | null;
  applyToReport: boolean;
};

export const EMPTY_SCENARIO: ScenarioState = {
  size: null,
  passByPct: null,
  internalCapturePct: null,
  growthRatePct: null,
  weather: null,
  timing: {},
  driveways: null,
  selectedSignalId: null,
  applyToReport: false,
};

/** True when any edit differs from the base study (selection alone is not an edit). */
export function isScenarioDirty(s: ScenarioState): boolean {
  return s.size !== null || s.passByPct !== null || s.internalCapturePct !== null
    || s.growthRatePct !== null || s.weather !== null || Object.keys(s.timing).length > 0
    || s.driveways !== null;
}

/** True when the client solve alone is dirty (driveways only reach the engine). */
export function isClientScenarioDirty(s: ScenarioState): boolean {
  return s.size !== null || s.passByPct !== null || s.internalCapturePct !== null
    || s.growthRatePct !== null || s.weather !== null || Object.keys(s.timing).length > 0;
}

// ---------------------------------------------------------------------------
// Timing edit <-> engine override
// ---------------------------------------------------------------------------

/** NEMA-style phase numbers the override is expressed in. Only the MAPPING
 *  matters to timingFromSynchroPhases (a left is protected iff its phase differs
 *  from its through's). */
const PHASE = { nsT: 2, ewT: 4, nsL: 1, ewL: 3 } as const;

/** The engine reads effective green as split − 5 s lost time (floored at 10 s). */
export const LOST_TIME_S = 5;
export const MIN_SPLIT_S = 15; // MIN_PHASE_GREEN_S 10 + lost time

export function timingEditToOverride(e: SignalTimingEdit): SignalTimingOverride {
  const nsProt = e.nsLeftSplitS !== undefined;
  const ewProt = e.ewLeftSplitS !== undefined;
  const phaseByMovement: Record<string, number> = {
    NBT: PHASE.nsT, SBT: PHASE.nsT, NBR: PHASE.nsT, SBR: PHASE.nsT,
    EBT: PHASE.ewT, WBT: PHASE.ewT, EBR: PHASE.ewT, WBR: PHASE.ewT,
    NBL: nsProt ? PHASE.nsL : PHASE.nsT, SBL: nsProt ? PHASE.nsL : PHASE.nsT,
    EBL: ewProt ? PHASE.ewL : PHASE.ewT, WBL: ewProt ? PHASE.ewL : PHASE.ewT,
  };
  const splitSByPhase: Record<string, number> = {
    [String(PHASE.nsT)]: e.nsThroughSplitS,
    [String(PHASE.ewT)]: e.ewThroughSplitS,
    ...(nsProt ? { [String(PHASE.nsL)]: e.nsLeftSplitS as number } : {}),
    ...(ewProt ? { [String(PHASE.ewL)]: e.ewLeftSplitS as number } : {}),
  };
  return { cycleLenSec: e.cycleLenSec, phaseByMovement, splitSByPhase };
}

/** Seed a timing edit from a row's printed timing (g/C × cycle + lost time),
 *  so opening the Signal tab starts from the plan the study actually used. */
export function timingEditFromRow(row: TisAffectedIntersection): SignalTimingEdit | null {
  const t = row.signalTiming;
  if (!t) return null;
  const C = t.cycleLenSec;
  const split = (gc: number) => Math.max(MIN_SPLIT_S, gc * C + LOST_TIME_S);
  return {
    cycleLenSec: C,
    nsThroughSplitS: split(t.gOverCns),
    ewThroughSplitS: split(t.gOverCew),
    ...(t.gOverCnsLeft !== undefined ? { nsLeftSplitS: split(t.gOverCnsLeft) } : {}),
    ...(t.gOverCewLeft !== undefined ? { ewLeftSplitS: split(t.gOverCewLeft) } : {}),
  };
}

/** Rescale an edit to a new cycle, keeping every phase's share of the cycle. */
export function withCycle(e: SignalTimingEdit, cycleLenSec: number): SignalTimingEdit {
  const k = cycleLenSec / e.cycleLenSec;
  return {
    cycleLenSec,
    nsThroughSplitS: e.nsThroughSplitS * k,
    ewThroughSplitS: e.ewThroughSplitS * k,
    ...(e.nsLeftSplitS !== undefined ? { nsLeftSplitS: e.nsLeftSplitS * k } : {}),
    ...(e.ewLeftSplitS !== undefined ? { ewLeftSplitS: e.ewLeftSplitS * k } : {}),
  };
}

/** Seconds of the cycle not taken by protected-left phases — what the NS/EW
 *  through split slider divides. */
export function throughBudgetS(e: SignalTimingEdit): number {
  return e.cycleLenSec - (e.nsLeftSplitS ?? 0) - (e.ewLeftSplitS ?? 0);
}

/** Set the NS share of the through budget (0..1); EW takes the rest. */
export function withNsShare(e: SignalTimingEdit, nsShare: number): SignalTimingEdit {
  const budget = throughBudgetS(e);
  const ns = clamp(nsShare * budget, MIN_SPLIT_S, budget - MIN_SPLIT_S);
  return { ...e, nsThroughSplitS: ns, ewThroughSplitS: budget - ns };
}

/** Toggle a protected left on an axis. Turning one on takes `leftSplitS` out of
 *  the two through phases pro rata; turning it off hands the seconds back. */
export function withProtectedLeft(e: SignalTimingEdit, axis: "ns" | "ew", on: boolean, leftSplitS = MIN_SPLIT_S): SignalTimingEdit {
  const key = axis === "ns" ? "nsLeftSplitS" : "ewLeftSplitS";
  const cur = e[key];
  if (on === (cur !== undefined)) return e;
  const through = e.nsThroughSplitS + e.ewThroughSplitS;
  const delta = on ? -leftSplitS : (cur as number);
  const k = (through + delta) / through;
  const next: SignalTimingEdit = {
    ...e,
    nsThroughSplitS: Math.max(MIN_SPLIT_S, e.nsThroughSplitS * k),
    ewThroughSplitS: Math.max(MIN_SPLIT_S, e.ewThroughSplitS * k),
  };
  if (on) next[key] = leftSplitS; else delete next[key];
  return next;
}

/** Set one protected-left split; the through phases absorb the difference pro rata. */
export function withLeftSplit(e: SignalTimingEdit, axis: "ns" | "ew", leftSplitS: number): SignalTimingEdit {
  const key = axis === "ns" ? "nsLeftSplitS" : "ewLeftSplitS";
  const cur = e[key];
  if (cur === undefined) return e;
  const through = e.nsThroughSplitS + e.ewThroughSplitS;
  const nextThrough = through - (leftSplitS - cur);
  if (nextThrough < 2 * MIN_SPLIT_S) return e;
  const k = nextThrough / through;
  return { ...e, [key]: leftSplitS, nsThroughSplitS: e.nsThroughSplitS * k, ewThroughSplitS: e.ewThroughSplitS * k };
}

// ---------------------------------------------------------------------------
// Solution
// ---------------------------------------------------------------------------

export type RowFallback =
  | "baseVolume" | "loadWeight" | "pathLedger" | "gOverC" | "utdfAttach" | "calibration" | "turbo" | "baseOnly";
export type ReportFallback = "jurisdiction" | "autoModeShare" | "landUse";

export type ScenarioSolution = {
  report: TisReport;
  /** Per-row substitutions made because an exact input was absent. */
  rowFallbacks: Map<string, Set<RowFallback>>;
  /** Report-level substitutions. */
  reportFallbacks: Set<ReportFallback>;
  /** Rows passed through from the base unchanged (could not be reconstructed). */
  baseOnly: Set<string>;
  /** True when trips were edited and byDirection / ledgers were held at base. */
  distributionHeld: boolean;
  /** External auto trips per period, base → scenario (exact, unrounded). */
  externalTrips: Record<string, { base: number; scenario: number }>;
};

const TRAVEL_BEARING: Record<Direction, number> = { NB: 0, EB: 90, SB: 180, WB: 270 };
const TURN_DELTA = { T: 0, R: 90, L: 270 } as const;

/** Haversine metres — the engine's snap rule is 0.35 mi. */
function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad, dLon = (bLon - aLon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const SNAP_MAX_M = 0.35 * 1609.34;
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function landUseByCode(code: string | undefined): LandUse | undefined {
  return code ? LAND_USES.find((l) => l.code === code) : undefined;
}

/** Planning office for the "Major" summary line: E2's jurisdiction field, else
 *  the name the base summary already printed. */
function planningOffice(report: ExactReport): { name: string; fallback: boolean } {
  if (report.jurisdiction?.planningOfficeName) return { name: report.jurisdiction.planningOfficeName, fallback: false };
  for (const line of report.mitigationSummary ?? []) {
    const m = /coordinate with (.+)\.$/.exec(line);
    if (m && m[1]) return { name: m[1], fallback: true };
  }
  return { name: "the governing agency", fallback: true };
}

/** Find the UTDF record that produced a row's measured volumes, the engine's way. */
function attachUtdfRecord(row: ExactRow, records: UtdfIntersectionData[] | undefined): { rec?: UtdfIntersectionInput; fallback: boolean } {
  if (!records || records.length === 0 || !row.volumeSource) return { rec: undefined, fallback: false };
  if (typeof row.utdfRecordIndex === "number" && records[row.utdfRecordIndex]) {
    return { rec: records[row.utdfRecordIndex] as UtdfIntersectionInput, fallback: false };
  }
  let best: UtdfIntersectionData | undefined, bestD = SNAP_MAX_M;
  for (const r of records) {
    if (typeof r.latitude !== "number" || typeof r.longitude !== "number") continue;
    if (!utdfMeasuredTotals(r as UtdfIntersectionInput)) continue;
    const d = haversineM(r.latitude, r.longitude, row.latitude, row.longitude);
    if (d < bestD) { bestD = d; best = r; }
  }
  if (!best) {
    const target = normName(row.name);
    const named = records.filter((r) => r.name && normName(r.name) === target && utdfMeasuredTotals(r as UtdfIntersectionInput));
    if (named.length === 1) best = named[0];
  }
  return { rec: best as UtdfIntersectionInput | undefined, fallback: true };
}

/** An override that reproduces a printed timing (used when the measured
 *  record behind a "measured"/"measured-cycle" row cannot be found). */
function overrideFromPrintedTiming(row: ExactRow): SignalTimingOverride | undefined {
  const t = row.signalTiming;
  if (!t) return undefined;
  const ex = row.signalTiming as ExactRowFields["signalTiming"] | undefined;
  const edit: SignalTimingEdit = {
    cycleLenSec: t.cycleLenSec,
    nsThroughSplitS: (ex?.gOverCnsExact ?? t.gOverCns) * t.cycleLenSec + LOST_TIME_S,
    ewThroughSplitS: (ex?.gOverCewExact ?? t.gOverCew) * t.cycleLenSec + LOST_TIME_S,
    ...(t.gOverCnsLeft !== undefined ? { nsLeftSplitS: (ex?.gOverCnsLeftExact ?? t.gOverCnsLeft) * t.cycleLenSec + LOST_TIME_S } : {}),
    ...(t.gOverCewLeft !== undefined ? { ewLeftSplitS: (ex?.gOverCewLeftExact ?? t.gOverCewLeft) * t.cycleLenSec + LOST_TIME_S } : {}),
  };
  return timingEditToOverride(edit);
}

/** The design-hour volume from the printed per-approach volumes: every
 *  `currentVolumeVph` / `existingVolumeVph` is round1(V × share × factor), so
 *  each bounds V to an interval of width 0.1 / (share × factor); the
 *  intersection over all approaches and periods pins V far tighter than any
 *  one of them. Undefined when the intervals do not overlap (a row whose
 *  shares are not the deterministic model's). */
function designHourVolumeFromPrinted(
  rows: Array<{ row: TisAffectedIntersection; factor: number; growth: number }>,
  shares: Record<Direction, number>,
): number | undefined {
  let lo = -Infinity, hi = Infinity, any = false;
  for (const { row, factor, growth } of rows) {
    for (const a of row.approaches ?? []) {
      const sh = shares[a.direction as Direction];
      if (!(sh > 0)) continue;
      const bound = (v: number | undefined, k: number) => {
        if (typeof v !== "number" || !(k > 0)) return;
        any = true;
        lo = Math.max(lo, (v - 0.05 - 1e-9) / (sh * k));
        hi = Math.min(hi, (v + 0.05 + 1e-9) / (sh * k));
      };
      bound(a.currentVolumeVph, factor);
      bound(a.existingVolumeVph, factor * growth);
    }
  }
  if (!any || lo > hi || !(hi > 0)) return undefined;
  return (lo + hi) / 2;
}

/** Solve a path row's outbound and inbound share ledgers from two periods'
 *  printed movement tables. Per movement k the engine printed
 *  M_p(k) = ext_p × (out_k × (1 − f_p) + in_k × f_p) (rounded), so two periods
 *  with different in-fractions determine out_k and in_k; negative solutions
 *  (integer rounding noise) clamp to 0. The ledgers are period-independent,
 *  exactly like the engine's. */
function ledgerFromTwoPeriods(
  entries: Array<{ row: TisAffectedIntersection; ext: number; inF: number }>,
): { out: PathTurnShare[]; in: PathTurnShare[] } | undefined {
  if (entries.length < 2) return undefined;
  let p1 = entries[0]!, p2 = entries[1]!;
  for (const a of entries) for (const b of entries) if (Math.abs(a.inF - b.inF) > Math.abs(p1.inF - p2.inF)) { p1 = a; p2 = b; }
  if (Math.abs(p1.inF - p2.inF) < 1e-6 || !(p1.ext > 0) || !(p2.ext > 0)) return undefined;
  const a1 = p1.ext * (1 - p1.inF), b1 = p1.ext * p1.inF, a2 = p2.ext * (1 - p2.inF), b2 = p2.ext * p2.inF;
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-9) return undefined;
  const keys = new Map<string, { approach: Direction; movement: "L" | "T" | "R"; m1: number; m2: number }>();
  const take = (row: TisAffectedIntersection, which: "m1" | "m2") => {
    for (const m of row.movements ?? []) {
      const k = `${m.approach}-${m.movement}`;
      const e = keys.get(k) ?? { approach: m.approach as Direction, movement: m.movement as "L" | "T" | "R", m1: 0, m2: 0 };
      e[which] += m.trips;
      keys.set(k, e);
    }
  };
  take(p1.row, "m1"); take(p2.row, "m2");
  if (keys.size === 0) return undefined;
  const out: PathTurnShare[] = [], inn: PathTurnShare[] = [];
  let sumO = 0, sumI = 0, A1 = 0, A2 = 0;
  for (const e of keys.values()) {
    const enter = TRAVEL_BEARING[e.approach];
    const exit = (enter + TURN_DELTA[e.movement]) % 360;
    const o = Math.max(0, (e.m1 * b2 - e.m2 * b1) / det);
    const i = Math.max(0, (a1 * e.m2 - a2 * e.m1) / det);
    A1 += e.m1; A2 += e.m2; sumO += o; sumI += i;
    if (o > 0) out.push({ enterBearingDeg: enter, exitBearingDeg: exit, share: o });
    if (i > 0) inn.push({ enterBearingDeg: enter, exitBearingDeg: exit, share: i });
  }
  if (out.length === 0 && inn.length === 0) return undefined;
  // The per-movement clamp above biases the ledger SUMS (every negative
  // solution is integer noise around zero), and the row's project load
  // depends on the sums alone (ledgerWeight in buildAffectedRow). So the
  // shape comes from the movements but the SUMS come from the row totals:
  // the centroid of the region where both periods' integer totals round
  // back to the printed ones, clipped to Σout ≥ 0, Σin ≥ 0.
  const sums = feasibleLedgerSums(a1, b1, A1, a2, b2, A2);
  let O: number, I: number;
  if (sums) ({ O, I } = sums);
  else {
    O = (A1 * b2 - A2 * b1) / det; I = (a1 * A2 - a2 * A1) / det;
    if (O < 0) { O = 0; I = b1 > 0 ? A1 / b1 : 0; }
    if (I < 0) { I = 0; O = a1 > 0 ? A1 / a1 : 0; }
  }
  if (sumO > 0 && O > 0) for (const t of out) t.share *= O / sumO;
  if (sumI > 0 && I > 0) for (const t of inn) t.share *= I / sumI;
  // A side the totals say is empty but the movements gave a shape to: the
  // shape is noise; a side the totals say is loaded but no movement solved
  // positive: hold the other side's pattern for it.
  const outL = O > 0 ? (out.length ? out : inn.map((t) => ({ ...t, share: (t.share / (I || 1)) * O }))) : [];
  const inL = I > 0 ? (inn.length ? inn : out.map((t) => ({ ...t, share: (t.share / (O || 1)) * I }))) : [];
  return { out: outL, in: inL };
}

/** Centroid of { (O, I) ≥ 0 : |a_p O + b_p I − A_p| ≤ ½ for p = 1, 2 } — the
 *  ledger sums for which both periods' printed integer trip counts are
 *  reproduced. Undefined when the region is empty (the row's totals are not
 *  a two-ledger blend at these in-fractions). */
function feasibleLedgerSums(a1: number, b1: number, A1: number, a2: number, b2: number, A2: number): { O: number; I: number } | undefined {
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-12) return undefined;
  const corner = (s1: number, s2: number): [number, number] => [
    ((A1 + s1) * b2 - (A2 + s2) * b1) / det,
    (a1 * (A2 + s2) - a2 * (A1 + s1)) / det,
  ];
  const h = 0.5 - 1e-9;
  let poly: Array<[number, number]> = [corner(-h, -h), corner(h, -h), corner(h, h), corner(-h, h)];
  // Sutherland–Hodgman against O ≥ 0 and I ≥ 0.
  for (const axis of [0, 1] as const) {
    const next: Array<[number, number]> = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
      const pin = p[axis] >= 0, qin = q[axis] >= 0;
      if (pin) next.push(p);
      if (pin !== qin) {
        const t = p[axis] / (p[axis] - q[axis]);
        next.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    poly = next;
    if (poly.length === 0) return undefined;
  }
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const cross = p[0] * q[1] - q[0] * p[1];
    area += cross; cx += (p[0] + q[0]) * cross; cy += (p[1] + q[1]) * cross;
  }
  if (Math.abs(area) < 1e-18) {
    const n = poly.length;
    return { O: Math.max(0, poly.reduce((s, p) => s + p[0], 0) / n), I: Math.max(0, poly.reduce((s, p) => s + p[1], 0) / n) };
  }
  return { O: Math.max(0, cx / (3 * area)), I: Math.max(0, cy / (3 * area)) };
}

/** Hold a path row's printed PM movement pattern fixed as a share ledger for
 *  one period (the single-period fallback). Shares are sized so the row's
 *  period load equals externalTrips × weight exactly (the engine's
 *  ledgerWeight), which makes the integerized movements reproduce the printed
 *  table on the base solve. */
function ledgerFromMovements(row: ExactRow, weight: number, inFraction: number): { out: PathTurnShare[]; in: PathTurnShare[] } | undefined {
  const mv = row.movements;
  if (!mv || mv.length === 0 || !(row.addedTripsPmPeak > 0) || !(weight > 0)) return undefined;
  // Record the pattern on whichever side carries the larger share of this
  // period's trips (keeps the synthetic shares bounded); the other side is an
  // EMPTY ledger, which the engine treats as "recorded, no turns" — so the
  // printed pattern is applied as-is, never mirrored.
  const useInbound = inFraction >= 0.5;
  const f = useInbound ? inFraction : 1 - inFraction;
  if (!(f > 0)) return undefined;
  const turns: PathTurnShare[] = mv.map((m) => {
    const enter = TRAVEL_BEARING[m.approach as Direction];
    const exit = (enter + TURN_DELTA[m.movement as "L" | "T" | "R"]) % 360;
    return { enterBearingDeg: enter, exitBearingDeg: exit, share: (m.trips / row.addedTripsPmPeak) * weight / f };
  });
  return useInbound ? { out: [], in: turns } : { out: turns, in: [] };
}

type PeriodInputs = {
  period: AnalysisPeriod;
  externalTrips: number;
  inFraction: number;
  raw: number;
  passByCredit: number;
  internalCredit: number;
  externalGross: number;
  existingCredit: number;
};

function periodInputs(args: {
  lu: LandUse; rates: ResolvedRates; size: number; period: AnalysisPeriod;
  passByPct: number; internalCapturePct: number; autoModeShare: number;
  existing: { lu: LandUse; size: number; rates: ResolvedRates; passByPct: number; internalCapturePct: number } | null;
  inFraction?: number;
}): PeriodInputs {
  const ext = externalTripsForPeriod({
    lu: args.lu, size: args.size, period: args.period, rates: args.rates,
    passByPct: args.passByPct, internalCapturePct: args.internalCapturePct, autoModeShare: args.autoModeShare,
  });
  let existingCredit = 0;
  if (args.existing) {
    existingCredit = externalTripsForPeriod({
      lu: args.existing.lu, size: args.existing.size, period: args.period, rates: args.existing.rates,
      passByPct: args.existing.passByPct, internalCapturePct: args.existing.internalCapturePct, autoModeShare: args.autoModeShare,
    }).externalTrips;
  }
  return {
    period: args.period,
    externalTrips: Math.max(0, ext.externalTrips - existingCredit),
    inFraction: args.inFraction ?? periodDirectionalIn(args.lu, args.period),
    raw: ext.rawTrips,
    passByCredit: ext.passByCredit,
    internalCredit: ext.internalCredit,
    externalGross: ext.externalTrips,
    existingCredit,
  };
}

/**
 * Re-solve the report for a scenario. Never throws on a row: a row that cannot
 * be reconstructed passes through unchanged and is listed in `baseOnly`.
 */
export function solveScenarioDetailed(reportIn: TisReport, state: ScenarioState): ScenarioSolution {
  const report = reportIn as ExactReport;
  const req = report.request;
  const rowFallbacks = new Map<string, Set<RowFallback>>();
  const reportFallbacks = new Set<ReportFallback>();
  const baseOnly = new Set<string>();
  const flag = (id: string, f: RowFallback) => {
    let s = rowFallbacks.get(id);
    if (!s) { s = new Set(); rowFallbacks.set(id, s); }
    s.add(f);
  };

  const tripsEdited = state.size !== null || state.passByPct !== null || state.internalCapturePct !== null;
  const lu = landUseByCode(report.tripGeneration.landUseCode);
  if (!lu) {
    // Without the registry entry no trip arithmetic is possible: whole report base-only.
    reportFallbacks.add("landUse");
    for (const r of report.affectedIntersections) baseOnly.add(r.signalId);
    return { report: reportIn, rowFallbacks, reportFallbacks, baseOnly, distributionHeld: false, externalTrips: {} };
  }
  const tg = report.tripGeneration;
  const resolved = resolveRatesForVariable(lu, req.independentVariable);
  const rates: ResolvedRates = {
    ...resolved,
    dailyRate: tg.dailyRate ?? resolved.dailyRate,
    amRate: tg.amRate ?? resolved.amRate,
    pmRate: tg.pmRate ?? resolved.pmRate,
  };
  const existingLu = landUseByCode(req.existingLandUseCode);
  const existingSize = Math.max(0, Number(req.existingSize) || 0);
  const existing = existingLu && existingSize > 0
    ? {
        lu: existingLu, size: existingSize, rates: resolveRatesForVariable(existingLu, undefined),
        passByPct: clamp(existingLu.passByPctPm, 0, 70), internalCapturePct: clamp(existingLu.internalCapturePctPm, 0, 50),
      }
    : null;
  let autoModeShare = report.autoModeShareApplied;
  if (typeof autoModeShare !== "number") { autoModeShare = 1; reportFallbacks.add("autoModeShare"); }

  // ---- scenario-level inputs ----
  const baseSize = tg.size;
  const size = state.size ?? baseSize;
  const basePassBy = clamp(report.passByPctApplied, 0, 70);
  const baseIc = clamp(report.internalCapturePctApplied, 0, 50);
  const passByPct = clamp(state.passByPct ?? basePassBy, 0, 70);
  const internalCapturePct = clamp(state.internalCapturePct ?? baseIc, 0, 50);
  const growthRatePct = clamp(state.growthRatePct ?? report.growthAppliedPct, -5, 6);
  const growthYears = Math.max(0, report.growthYears);
  const horizon = report.designYearHorizonYears ?? DESIGN_YEAR_HORIZON_DEFAULT;
  const designYears = growthYears + horizon;
  const growthMultiplier = Math.pow(1 + growthRatePct / 100, growthYears);
  const designGrowthMultiplier = Math.pow(1 + growthRatePct / 100, designYears);
  const weather: TisWeather = state.weather ?? report.weather;
  const weatherFactor = state.weather === null
    ? (report.weatherFactorExact ?? WEATHER_FACTOR[report.weather as Weather] ?? report.weatherCapacityFactor)
    : WEATHER_FACTOR[weather as Weather];
  const capacityVph = PER_INTERSECTION_CAPACITY_VPH * weatherFactor;
  const approachCapacityVph = APPROACH_CAPACITY_VPH * weatherFactor;
  const octants = report.tripDistribution?.byDirection;
  const conservedLabeling = report.affectedIntersections.some((r) => r.movementSource !== undefined);
  const signalTiming: ScenarioParams["signalTiming"] = req.signalTiming === "screening" ? "screening" : "computed";
  const project = { lat: req.latitude, lon: req.longitude };
  const office = planningOffice(report);
  if (office.fallback) reportFallbacks.add("jurisdiction");

  // Base per-period inputs (exact) — the load-weight and ledger fallbacks
  // reconstruct from the printed integer trips against these.
  const gm0 = Math.pow(1 + report.growthAppliedPct / 100, growthYears);
  const basePeriods = (report.periodReports as ExactPeriod[])
    .filter((p) => p.period !== "daily")
    .map((p) => {
      const period = p.period as AnalysisPeriod;
      const inF = p.inFraction ?? p.tripGeneration.inFraction;
      const pi = periodInputs({ lu, rates, size: baseSize, period, passByPct: basePassBy, internalCapturePct: baseIc, autoModeShare, existing, inFraction: inF });
      return {
        period,
        ext: p.externalTripsExact ?? p.tripGeneration.externalTripsExact ?? pi.externalTrips,
        inF: pi.inFraction,
        factor: p.periodVolumeFactor ?? PERIOD_VOLUME_FACTOR[period] ?? 1,
        rowsById: new Map(p.affectedIntersections.map((r) => [r.signalId, r])),
      };
    });
  const basePm = basePeriods.find((p) => p.period === "pm_peak");
  const basePmExternal = basePm?.ext
    ?? periodInputs({ lu, rates, size: baseSize, period: "pm_peak", passByPct: basePassBy, internalCapturePct: baseIc, autoModeShare, existing }).externalTrips;

  // ---- candidates, reconstructed from the PM rows ----
  type Cand = {
    base: ExactRow;
    sig: AnalyzerIntersection;
    utdf?: UtdfIntersectionInput;
    calibration?: RowCalibration;
    weight: number;
    timingOverride?: SignalTimingOverride;
    ledgerExact?: { out: PathTurnShare[]; in?: PathTurnShare[] };
    ok: boolean;
  };
  const candidates: Cand[] = (report.affectedIntersections as ExactRow[]).map((row) => {
    const id = row.signalId;
    const cand: Cand = { base: row, sig: { id, name: row.name, zone: row.zone, latitude: row.latitude, longitude: row.longitude, totalVolume: 0 }, weight: 0, ok: true };

    // UTDF record (measured volumes replace totalVolume inside buildAffectedRow).
    const att = attachUtdfRecord(row, req.utdfIntersections);
    if (att.rec) { cand.utdf = att.rec; if (att.fallback) flag(id, "utdfAttach"); }
    else if (row.volumeSource) {
      // The measured record is gone: keep the printed measured volume as the
      // design-hour anchor and the printed timing (below). Approach shares
      // fall back to the deterministic model, so the row is disclosed.
      flag(id, "utdfAttach");
    }

    // Design-hour volume.
    if (typeof row.designHourVolumeVph === "number" && row.designHourVolumeVph > 0) {
      cand.sig.totalVolume = row.designHourVolumeVph;
    } else if (row.approaches?.length) {
      const fromIntervals = cand.utdf
        ? undefined
        : designHourVolumeFromPrinted(
            basePeriods.flatMap((p) => { const r = p.rowsById.get(id); return r ? [{ row: r, factor: p.factor, growth: gm0 }] : []; }),
            approachVolumeShares(id),
          );
      const cur = fromIntervals
        ?? row.approaches.reduce((s, a) => s + (typeof a.currentVolumeVph === "number" ? a.currentVolumeVph : a.existingVolumeVph / gm0), 0);
      if (cur > 0) { cand.sig.totalVolume = cur; flag(id, "baseVolume"); } else cand.ok = false;
    } else cand.ok = false;

    // Through lanes: E2 fields, else the printed per-approach provenance.
    if (typeof row.mainThroughLanes === "number") {
      cand.sig.mainThroughLanes = row.mainThroughLanes;
      cand.sig.mainThroughLanesMeasured = row.mainThroughLanesMeasured ?? true;
      if (typeof row.minorThroughLanes === "number") cand.sig.minorThroughLanes = row.minorThroughLanes;
    } else if (row.approaches?.some((a) => a.lanesSource === "osm")) {
      const shares = cand.utdf ? utdfMeasuredTotals(cand.utdf)?.shares : undefined;
      const sh = shares ?? approachVolumeShares(id);
      const nsMajor = sh.NB + sh.SB >= sh.EB + sh.WB;
      for (const a of row.approaches) {
        if (a.lanesSource !== "osm" || typeof a.throughLanes !== "number") continue;
        const onMajor = nsMajor ? a.direction === "NB" || a.direction === "SB" : a.direction === "EB" || a.direction === "WB";
        if (onMajor) { cand.sig.mainThroughLanes = a.throughLanes; cand.sig.mainThroughLanesMeasured = true; }
        else cand.sig.minorThroughLanes = a.throughLanes;
      }
    }

    // Calibration.
    if (row.calibration) {
      const exact = (row.calibration as ExactRowFields["calibration"])?.delayMultiplierExact;
      cand.calibration = {
        multiplier: exact ?? row.calibration.delayMultiplier,
        sampleCount: row.calibration.sampleCount,
        lastObservedDelaySec: row.calibration.lastObservedDelaySec ?? null,
      };
      if (exact === undefined) flag(id, "calibration");
    }

    // Load weight.
    if (typeof row.loadWeight === "number") cand.weight = row.loadWeight;
    else { cand.weight = basePmExternal > 0 ? row.addedTripsPmPeak / basePmExternal : 0; flag(id, "loadWeight"); }

    // Ledgers: E2's exact ones, else solved from two periods' printed tables.
    if (row.pathTurns) cand.ledgerExact = { out: row.pathTurns, in: row.pathTurnsIn };
    else if (row.movementSource === "path") {
      const solved = ledgerFromTwoPeriods(
        basePeriods.flatMap((p) => { const r = p.rowsById.get(id); return r ? [{ row: r, ext: p.ext, inF: p.inF }] : []; }),
      );
      if (solved) { cand.ledgerExact = solved; flag(id, "pathLedger"); }
    }

    // Timing: the scenario's edit wins; else a measured timing whose record is
    // missing is re-expressed from the printed g/C.
    const edit = state.timing[id];
    if (edit) cand.timingOverride = timingEditToOverride(edit);
    else if (row.signalTiming && (row.signalTiming.basis === "measured" || row.signalTiming.basis === "measured-cycle") && !cand.utdf) {
      cand.timingOverride = overrideFromPrintedTiming(row);
      flag(id, "gOverC");
    }
    if (row.turboLane) flag(id, "turbo");
    if (!cand.ok) { baseOnly.add(id); flag(id, "baseOnly"); }
    return cand;
  });

  // ---- per period ----
  const externalTrips: ScenarioSolution["externalTrips"] = {};
  const periodReports: TisPeriodReport[] = (report.periodReports as ExactPeriod[]).map((p) => {
    const period = p.period as AnalysisPeriod;
    const inFractionExact = p.inFraction ?? p.tripGeneration.inFraction;
    const basePi = periodInputs({ lu, rates, size: baseSize, period, passByPct: basePassBy, internalCapturePct: baseIc, autoModeShare, existing, inFraction: inFractionExact });
    const pi = periodInputs({ lu, rates, size, period, passByPct, internalCapturePct, autoModeShare, existing, inFraction: inFractionExact });
    externalTrips[period] = { base: p.externalTripsExact ?? p.tripGeneration.externalTripsExact ?? basePi.externalTrips, scenario: pi.externalTrips };
    const inTrips = Math.round(pi.externalTrips * pi.inFraction);
    const outTrips = Math.round(pi.externalTrips) - inTrips;
    const tripGeneration: TisPeriodReport["tripGeneration"] = {
      ...p.tripGeneration,
      rawTrips: Math.round(pi.raw),
      passByCredit: Math.round(pi.passByCredit),
      internalCaptureCredit: Math.round(pi.internalCredit),
      externalTrips: Math.round(pi.externalGross),
      inTrips,
      outTrips,
      ...(existing ? { existingUseCredit: Math.round(pi.existingCredit), netNewExternalTrips: Math.round(pi.externalTrips) } : {}),
    };
    if (period === "daily") return { ...p, tripGeneration, affectedIntersections: [], intersectionsWithLosDrop: 0, intersectionsAtLosEf: 0, worstDelayDeltaSec: 0 };

    const params: ScenarioParams = {
      growthMultiplier,
      designGrowthMultiplier,
      capacityVph,
      approachCapacityVph,
      externalTrips: pi.externalTrips,
      inFraction: pi.inFraction,
      periodVolumeFactor: p.periodVolumeFactor ?? PERIOD_VOLUME_FACTOR[period] ?? 1,
      ...(octants ? { distributionOctants: octants } : {}),
      ...(conservedLabeling ? { conservedLabeling: true } : {}),
      ...(req.realLaneGeometry === false ? { realLaneGeometry: false } : {}),
      signalTiming,
      weatherFactor,
    };
    const baseRowsById = new Map(p.affectedIntersections.map((r) => [r.signalId, r]));
    const rows: TisAffectedIntersection[] = candidates.map((c) => {
      const baseRow = baseRowsById.get(c.base.signalId) ?? c.base;
      if (!c.ok) return baseRow;
      let turns = c.ledgerExact?.out, turnsIn = c.ledgerExact?.in;
      if (!c.ledgerExact && c.base.movementSource === "path") {
        const l = ledgerFromMovements(c.base, c.weight, pi.inFraction);
        if (l) { turns = l.out; turnsIn = l.in; flag(c.base.signalId, "pathLedger"); }
      }
      let built: AffectedIntersection;
      try {
        built = buildAffectedRow(
          { sig: c.sig, distanceMi: c.base.distanceMi, ...(c.utdf ? { utdf: c.utdf } : {}), ...(c.timingOverride ? { timingOverride: c.timingOverride } : {}) },
          c.weight, project, params, c.calibration, turns, turnsIn,
        );
      } catch {
        baseOnly.add(c.base.signalId); flag(c.base.signalId, "baseOnly");
        return baseRow;
      }
      // The base carries measured volumes whose record is gone: keep the label.
      if (c.base.volumeSource && !c.utdf) built.volumeSource = c.base.volumeSource as AffectedIntersection["volumeSource"];
      // Turbo geometry is not printable; the base screening rides along.
      if (baseRow.turboLane && !built.turboLane) (built as unknown as { turboLane: unknown }).turboLane = baseRow.turboLane;
      return built as unknown as TisAffectedIntersection;
    });
    const dropCount = rows.filter((r) => r.losChanged).length;
    const efCount = rows.filter((r) => r.futureLos === "E" || r.futureLos === "F").length;
    const worstDelta = rows.reduce((m, r) => Math.max(m, r.futureDelaySec - r.existingDelaySec), 0);
    return { ...p, tripGeneration, affectedIntersections: rows, intersectionsWithLosDrop: dropCount, intersectionsAtLosEf: efCount, worstDelayDeltaSec: round1(worstDelta) };
  });

  const pm = periodReports.find((p) => p.period === "pm_peak");
  const pmRows = pm?.affectedIntersections ?? report.affectedIntersections;
  const design = pmRows.filter((r) => r.designBuildDelaySec !== undefined);

  // Top-level trip-generation summary, the server's rounding.
  const dailyTrips = Math.round(rates.dailyRate * size);
  const amTrips = Math.round(rates.amRate * size);
  const pmTrips = Math.round(rates.pmRate * size);
  const pmIn = Math.round(pmTrips * lu.directionalSplitPm.in);
  const amIn = Math.round(amTrips * lu.amDirectionalIn);

  const out: TisReport = {
    ...reportIn,
    // Same request object on purpose: the page's metadata effects key on it.
    request: reportIn.request,
    tripGeneration: {
      ...tg, size, dailyTrips, amPeakTrips: amTrips, pmPeakTrips: pmTrips, pmIn, pmOut: pmTrips - pmIn,
      ...("amIn" in tg ? { amIn, amOut: amTrips - amIn } : {}),
    } as TisReport["tripGeneration"],
    affectedIntersections: pmRows,
    intersectionsStudied: pmRows.length,
    intersectionsWithLosDrop: pm?.intersectionsWithLosDrop ?? reportIn.intersectionsWithLosDrop,
    intersectionsAtLosEf: pm?.intersectionsAtLosEf ?? reportIn.intersectionsAtLosEf,
    worstDelayDeltaSec: pm?.worstDelayDeltaSec ?? reportIn.worstDelayDeltaSec,
    ...(design.length > 0
      ? { worstDelayDeltaDesignSec: round1(design.reduce((m, r) => Math.max(m, (r.designBuildDelaySec ?? 0) - (r.designNoBuildDelaySec ?? 0)), 0)) }
      : {}),
    mitigationSummary: buildSummaryMitigations(pmRows, { planningOfficeName: office.name }),
    periodReports,
    growthAppliedPct: growthRatePct,
    weather,
    weatherCapacityFactor: round2(weatherFactor),
    passByPctApplied: passByPct,
    internalCapturePctApplied: internalCapturePct,
  };
  return { report: out, rowFallbacks, reportFallbacks, baseOnly, distributionHeld: tripsEdited, externalTrips };
}

/** Spec signature: the re-solved report alone. */
export function solveScenario(report: TisReport, state: ScenarioState): TisReport {
  return solveScenarioDetailed(report, state).report;
}

// ---------------------------------------------------------------------------
// Engine hand-off
// ---------------------------------------------------------------------------

/** The per-signal timing override as POST /whatif accepts it (Track E2's
 *  `signalTimingOverrides[]`): snapped by coordinates / name like a UTDF
 *  record, consumed as the first timing provider, volumes untouched. */
export type SignalTimingOverrideRequest = {
  latitude: number;
  longitude: number;
  name?: string;
  cycleLenSec: number;
  phaseByMovement: Record<string, number>;
  splitSByPhase: Record<string, number>;
};

export type WhatIfRequest = TisRequest & { signalTimingOverrides?: SignalTimingOverrideRequest[] };

/** The base request plus every scenario edit, for the engine to re-run. */
export function toWhatIfRequest(report: TisReport, state: ScenarioState): WhatIfRequest {
  const req = report.request;
  const rowsById = new Map(report.affectedIntersections.map((r) => [r.signalId, r]));
  const overrides: SignalTimingOverrideRequest[] = [];
  for (const [id, edit] of Object.entries(state.timing)) {
    const row = rowsById.get(id);
    if (!row) continue;
    const o = timingEditToOverride(edit);
    overrides.push({
      latitude: row.latitude, longitude: row.longitude, name: row.name,
      cycleLenSec: Math.round(o.cycleLenSec as number),
      phaseByMovement: o.phaseByMovement as Record<string, number>,
      splitSByPhase: Object.fromEntries(Object.entries(o.splitSByPhase ?? {}).map(([k, v]) => [k, Math.round((v as number) * 10) / 10])),
    });
  }
  const out: WhatIfRequest = {
    ...req,
    ...(state.size !== null ? { size: state.size } : {}),
    ...(state.passByPct !== null ? { passByPct: state.passByPct } : {}),
    ...(state.internalCapturePct !== null ? { internalCapturePct: state.internalCapturePct } : {}),
    ...(state.growthRatePct !== null ? { growthRatePct: state.growthRatePct } : {}),
    ...(state.weather !== null ? { weather: state.weather } : {}),
    ...(overrides.length > 0 ? { signalTimingOverrides: overrides } : {}),
    runSensitivity: false,
  };
  if (state.driveways !== null) {
    if (state.driveways.length > 0) out.driveways = state.driveways;
    else delete out.driveways;
  }
  return out;
}

/** Largest absolute difference between two solves of the same study, field by
 *  field over the PM rows — the "engine vs client" diff line. */
export function reportDiff(a: TisReport, b: TisReport): { maxDelayDeltaSec: number; maxVcDelta: number; losMismatches: number; rows: number } {
  const byId = new Map(b.affectedIntersections.map((r) => [r.signalId, r]));
  let maxDelay = 0, maxVc = 0, los = 0, rows = 0;
  for (const r of a.affectedIntersections) {
    const s = byId.get(r.signalId);
    if (!s) continue;
    rows++;
    maxDelay = Math.max(maxDelay, Math.abs(r.futureDelaySec - s.futureDelaySec), Math.abs(r.existingDelaySec - s.existingDelaySec));
    maxVc = Math.max(maxVc, Math.abs(r.futureVc - s.futureVc), Math.abs(r.existingVc - s.existingVc));
    if (r.futureLos !== s.futureLos || r.existingLos !== s.existingLos) los++;
  }
  return { maxDelayDeltaSec: round1(maxDelay), maxVcDelta: round2(maxVc), losMismatches: los, rows };
}

export const PERIOD_ORDER: TisAnalysisPeriod[] = ["am_peak", "pm_peak", "saturday_midday", "daily"];
