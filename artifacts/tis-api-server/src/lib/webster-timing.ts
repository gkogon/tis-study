/**
 * Volume-responsive signal timing: Webster optimum cycle length + the Critical
 * Movement Method for green splits, with protected-left phasing and a
 * pedestrian minimum green — and a resolver that ranks measured sources above
 * the computed model.
 *
 * WHY THIS EXISTS. Every study in every metro was analyzed at a flat 90 s
 * cycle and g/C 0.45 (signal-delay.ts CYCLE_LEN / G_OVER_C), regardless of how
 * much traffic the intersection carries. A quiet collector and a saturated
 * arterial got identical timing, and a protected left got the same green as
 * its through. That was the single largest unrealism left in the screening
 * model, and unlike measured timing it is fixable with data the engine already
 * has: the approach volumes, and (since #195) lane counts.
 *
 * WHY NOT MEASURED TIMING EVERYWHERE. Agency timing feeds exist but are rare,
 * undiscoverable through data catalogs, and absent from all but a handful of
 * served metros. The 2026-09-01 sweep (docs/superpowers/specs/
 * 2026-09-01-signal-timing-wiring-design.md §2, §9) found exactly one open
 * per-intersection feed — Miami-Dade DTPW's TOD timing sheets — and confirmed
 * that the richest open signal layers (Austin, Chicago, Raleigh, Charlotte,
 * FDOT) carry no cycle, split or offset. GDOT's ATSPM portal holds measured
 * splits but exposes no documented feed or bulk API. So a derived model is
 * still required as the universal tier, and measured sources plug in ABOVE it
 * through `resolveSignalTiming` rather than replacing it.
 *
 * SOURCES.
 *  - FHWA-HOP-07-006, "Signal Timing on a Shoestring" (R.D. Henry, FHWA Office
 *    of Operations, March 2005): Webster optimum cycle, Critical Movement
 *    Method splits, 5 s lost time per critical phase, round to next 5 s.
 *  - FHWA-HRT-04-091, "Signalized Intersections: Informational Guide" (FHWA,
 *    2004), §on left-turn phasing: the cross-product guidance (left-turn
 *    volume × opposing through volume ≥ 50,000 / 90,000 / 110,000 for one /
 *    two / three opposing through lanes) used here to infer a protected left
 *    where no import states the phasing.
 *  - MUTCD pedestrian clearance convention: 7 s WALK + crossing distance at
 *    3.5 ft/s. Lane width taken as 12 ft.
 *  All three are US Government works: public domain, no license.
 *
 * ⚠️ DELIBERATELY NOT IMPLEMENTED: the Quick Estimation Method cycle equation
 * in FHWA-HOP-08-024 §6. It is HCM-derived, and HCM was stripped from this
 * product (#104/#144). Only Webster and Critical Movement content is used.
 *
 * WHAT IS STILL NOT MODELED (screening-level, by design): coordination /
 * arrival type (Webster d1 assumes random arrivals), actuation (fixed-time
 * assumption), and the reduced capacity of a PERMISSIVE left that must find
 * gaps in opposing traffic — a permissive left is given its through phase's
 * g/C, which overstates its capacity at busy intersections.
 */

import { CYCLE_LEN, G_OVER_C, SATURATION_FLOW_VPH } from "./signal-delay.ts";

export type Direction = "NB" | "SB" | "EB" | "WB";
export type Movement = "L" | "T" | "R";
export type Axis = "ns" | "ew";
export type LeftPhasing = "protected" | "permissive";
export type TimingBasis = "measured" | "measured-cycle" | "webster" | "screening-default";
export type LeftPhasingSource = "import" | "explicit" | "inferred" | "default";

/** Lost time per critical phase, seconds. HOP-07-006 uses 5 s. */
export const LOST_TIME_PER_PHASE_S = 5;

/**
 * Cycle bounds for the COMPUTED tier. HOP-07-006 gives 60 s as the practical
 * starting cycle for a two-phase signal; FHWA guidance prefers <= 120 s for a
 * conventional four-legged intersection. A cycle can exceed MAX_CYCLE_S only
 * when the phases it must serve (lost time + every phase's minimum) do not fit
 * — see `requiredCycleS`.
 */
export const MIN_CYCLE_S = 60;
export const MAX_CYCLE_S = 120;
/** Hard bound on any cycle the engine will carry, measured or computed. */
export const ABSOLUTE_MAX_CYCLE_S = 300;
export const ABSOLUTE_MIN_CYCLE_S = 30;

/**
 * Practical minimum green a vehicle phase can be served, seconds. Without this
 * floor a phase whose approaches measure zero volume gets zero green, hence
 * g/C = 0, hence CAPACITY ZERO and v/c = Infinity for every movement on that
 * axis (found by property-based fuzzing on T-intersections).
 */
export const MIN_PHASE_GREEN_S = 10;

/** Pedestrian minimum: 7 s WALK + crossing distance / 3.5 ft/s, 12 ft lanes. */
export const PED_WALK_S = 7;
export const PED_WALK_SPEED_FTPS = 3.5;
export const LANE_WIDTH_FT = 12;
/** Through lanes per direction assumed for a crossing when no count is known. */
export const DEFAULT_THROUGH_LANES_PER_DIR = 1;

/**
 * Webster destabilizes as the intersection approaches saturation — the (1 - Y)
 * denominator sends the cycle to infinity — and HOP-07-006 says so outright.
 * Above this critical-flow-ratio sum we report the screening default.
 */
export const MAX_CRITICAL_FLOW_RATIO = 0.85;

/**
 * Protected-left inference, FHWA-HRT-04-091: cross product of left-turn volume
 * and opposing through volume, by number of opposing through lanes.
 */
export const LEFT_CROSS_PRODUCT_THRESHOLDS: Record<1 | 2 | 3, number> = { 1: 50000, 2: 90000, 3: 110000 };
/** Left-turn share of an approach when no turning count exists (the export's
 *  10/80/10 convention; see utdf-export.ts). */
export const DEFAULT_LEFT_TURN_SHARE = 0.10;
export const DEFAULT_THROUGH_SHARE = 0.80;

export type SignalTiming = {
  cycleLenS: number;
  /** Effective green ratio of the north–south THROUGH phase (also serves a
   *  permissive NS left and the NS rights). */
  gOverCns: number;
  /** Effective green ratio of the east–west THROUGH phase. */
  gOverCew: number;
  /** Effective green ratio of a PROTECTED north–south left phase. Present
   *  only when `leftPhasing.ns === "protected"`. */
  gOverCnsLeft?: number;
  gOverCewLeft?: number;
  leftPhasing: { ns: LeftPhasing; ew: LeftPhasing };
  leftPhasingSource: LeftPhasingSource;
  /** Number of critical phases: 2 (through/through) + one per protected axis. */
  criticalPhases: 2 | 3 | 4;
  /** Sum of critical flow ratios (Webster's Y); 0 when volumes were absent. */
  criticalFlowRatio: number;
  /** Pedestrian minimum green applied to each THROUGH phase, seconds. */
  pedMinGreenS: { ns: number; ew: number };
  /**
   * How this timing was derived, so the report can say:
   *  - "measured"          cycle AND per-movement splits from a source
   *  - "measured-cycle"    cycle from a source, splits computed
   *  - "webster"           computed from approach volumes
   *  - "screening-default" volumes absent, or Y >= MAX_CRITICAL_FLOW_RATIO
   */
  basis: TimingBasis;
  /** Which measured source produced a measured tier (e.g. "synchro"). */
  source?: string;
};

export type ComputeSignalTimingArgs = {
  /** Approach volumes, vph. Missing/zero approaches are treated as absent. */
  approachVph: Partial<Record<Direction, number>>;
  /** Measured left-turn volumes by approach, vph. Absent → the
   *  DEFAULT_LEFT_TURN_SHARE convention. */
  leftVph?: Partial<Record<Direction, number>>;
  /** Explicit phasing per axis (from an import, or a caller's decision).
   *  Absent → inferred from volumes unless `inferLeftPhasing === false`. */
  leftPhasing?: Partial<Record<Axis, LeftPhasing>>;
  leftPhasingSource?: LeftPhasingSource;
  inferLeftPhasing?: boolean;
  /** Opposing through lanes per direction on each axis, for the cross-product
   *  threshold. Absent → 1. */
  opposingLanes?: Partial<Record<Axis, number>>;
  /** Lanes a pedestrian crosses while walking WITH the axis's through phase —
   *  i.e. the TOTAL lane count of the cross street (both directions). Keyed by
   *  the phase that serves the crossing: `ns` = lanes of the EW street.
   *  Absent → 2 × DEFAULT_THROUGH_LANES_PER_DIR. */
  crossingLanes?: Partial<Record<Axis, number>>;
  /** A cycle length from a measured source. When present it WINS the cycle
   *  (only the splits are computed) and the basis is "measured-cycle". */
  measuredCycleS?: number;
  /** Per-lane saturation flow. Defaults to the engine constant so this module
   *  cannot silently re-baseline capacity (HOP-07-006 says 1,900 is typical;
   *  the engine has always used 1,800; changing that is a separate decision). */
  saturationFlowVph?: number;
};

const DIRS: Direction[] = ["NB", "SB", "EB", "WB"];
const AXIS_OF: Record<Direction, Axis> = { NB: "ns", SB: "ns", EB: "ew", WB: "ew" };
const OPPOSITE: Record<Direction, Direction> = { NB: "SB", SB: "NB", EB: "WB", WB: "EB" };

const pos = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);
const round2 = (x: number): number => Math.round(x * 100) / 100;
const roundUpTo5 = (x: number): number => Math.ceil(x / 5) * 5;

/** 7 s WALK + (lanes × 12 ft) / 3.5 ft/s. */
export function pedestrianMinGreenS(crossingLanes: number): number {
  const lanes = crossingLanes > 0 && Number.isFinite(crossingLanes) ? crossingLanes : 2 * DEFAULT_THROUGH_LANES_PER_DIR;
  return PED_WALK_S + (lanes * LANE_WIDTH_FT) / PED_WALK_SPEED_FTPS;
}

function leftAndThrough(args: Pick<ComputeSignalTimingArgs, "approachVph" | "leftVph">, d: Direction): { left: number; through: number } {
  const total = pos(args.approachVph[d]);
  const measuredLeft = args.leftVph?.[d];
  if (typeof measuredLeft === "number" && Number.isFinite(measuredLeft) && measuredLeft >= 0) {
    const left = Math.min(total, measuredLeft);
    return { left, through: Math.max(0, total - left) };
  }
  return { left: total * DEFAULT_LEFT_TURN_SHARE, through: total * DEFAULT_THROUGH_SHARE };
}

/**
 * Infer protected vs permissive left phasing per axis from the cross product
 * of left-turn volume and the OPPOSING through volume (FHWA-HRT-04-091).
 * Either direction on an axis meeting the threshold protects the axis.
 */
export function inferLeftPhasing(args: Pick<ComputeSignalTimingArgs, "approachVph" | "leftVph" | "opposingLanes">): Record<Axis, LeftPhasing> {
  const out: Record<Axis, LeftPhasing> = { ns: "permissive", ew: "permissive" };
  for (const d of DIRS) {
    const axis = AXIS_OF[d];
    const { left } = leftAndThrough(args, d);
    const { through: opposingThrough } = leftAndThrough(args, OPPOSITE[d]);
    const lanesRaw = args.opposingLanes?.[axis];
    const lanes = (typeof lanesRaw === "number" && lanesRaw >= 3 ? 3 : lanesRaw === 2 ? 2 : 1) as 1 | 2 | 3;
    if (left * opposingThrough >= LEFT_CROSS_PRODUCT_THRESHOLDS[lanes]) out[axis] = "protected";
  }
  return out;
}

type Phase = { key: "nsT" | "ewT" | "nsL" | "ewL"; clv: number; floorS: number };

/** Lost time plus every phase's minimum green — the shortest cycle that can
 *  legally serve the phase set. */
function requiredCycleS(phases: Phase[]): number {
  return LOST_TIME_PER_PHASE_S * phases.length + phases.reduce((s, p) => s + p.floorS, 0);
}

/**
 * Critical Movement Method splits with floors: green after lost time is shared
 * in proportion to each phase's critical lane volume; any phase below its floor
 * is pinned there and the remainder is re-shared among the others. The caller
 * guarantees `cycle >= requiredCycleS(phases)`, so the floors always fit.
 */
function splitGreens(cycle: number, phases: Phase[]): Record<string, number> {
  const G = cycle - LOST_TIME_PER_PHASE_S * phases.length;
  const pinned = new Map<string, number>();
  for (let iter = 0; iter < phases.length + 1; iter++) {
    const free = phases.filter((p) => !pinned.has(p.key));
    const avail = G - [...pinned.values()].reduce((s, g) => s + g, 0);
    const clvSum = free.reduce((s, p) => s + p.clv, 0);
    let changed = false;
    for (const p of free) {
      const g = clvSum > 0 ? avail * (p.clv / clvSum) : avail / free.length;
      if (g < p.floorS) { pinned.set(p.key, p.floorS); changed = true; }
    }
    if (!changed) {
      const out: Record<string, number> = {};
      for (const p of phases) out[p.key] = pinned.get(p.key) ?? (clvSum > 0 ? avail * (p.clv / clvSum) : avail / free.length);
      return out;
    }
  }
  // Every phase pinned (only possible when Σ floors === G exactly).
  const out: Record<string, number> = {};
  for (const p of phases) out[p.key] = pinned.get(p.key) ?? p.floorS;
  return out;
}

function screeningDefault(extra: Partial<SignalTiming> = {}): SignalTiming {
  return {
    cycleLenS: CYCLE_LEN,
    gOverCns: G_OVER_C,
    gOverCew: G_OVER_C,
    leftPhasing: { ns: "permissive", ew: "permissive" },
    leftPhasingSource: "default",
    criticalPhases: 2,
    criticalFlowRatio: 0,
    pedMinGreenS: { ns: pedestrianMinGreenS(2), ew: pedestrianMinGreenS(2) },
    basis: "screening-default",
    ...extra,
  };
}

/**
 * Compute cycle length and green splits from approach volumes.
 *
 * Phases: NS through and EW through always; plus a protected NS left and/or
 * EW left when the phasing says so. The critical lane volume of a through
 * phase is the heavier approach's through(+right) volume — the whole approach
 * when that axis's left is permissive, since the left shares the phase. The
 * critical lane volume of a protected-left phase is the heavier left.
 */
export function computeSignalTiming(args: ComputeSignalTimingArgs): SignalTiming {
  const s = args.saturationFlowVph ?? SATURATION_FLOW_VPH;
  const inferred = args.inferLeftPhasing === false ? { ns: "permissive" as const, ew: "permissive" as const } : inferLeftPhasing(args);
  const phasing: Record<Axis, LeftPhasing> = {
    ns: args.leftPhasing?.ns ?? inferred.ns,
    ew: args.leftPhasing?.ew ?? inferred.ew,
  };
  const phasingSource: LeftPhasingSource = args.leftPhasing?.ns !== undefined || args.leftPhasing?.ew !== undefined
    ? (args.leftPhasingSource ?? "explicit")
    : args.inferLeftPhasing === false ? "default" : "inferred";
  const pedMin = {
    ns: pedestrianMinGreenS(args.crossingLanes?.ns ?? 2 * DEFAULT_THROUGH_LANES_PER_DIR),
    ew: pedestrianMinGreenS(args.crossingLanes?.ew ?? 2 * DEFAULT_THROUGH_LANES_PER_DIR),
  };

  const clvFor = (axis: Axis): { through: number; left: number } => {
    const [a, b]: Direction[] = axis === "ns" ? ["NB", "SB"] : ["EB", "WB"];
    if (phasing[axis] === "permissive") {
      return { through: Math.max(pos(args.approachVph[a]), pos(args.approachVph[b])), left: 0 };
    }
    const la = leftAndThrough(args, a), lb = leftAndThrough(args, b);
    return { through: Math.max(la.through, lb.through), left: Math.max(la.left, lb.left) };
  };
  const ns = clvFor("ns"), ew = clvFor("ew");
  const phases: Phase[] = [
    { key: "nsT", clv: ns.through, floorS: Math.max(MIN_PHASE_GREEN_S, pedMin.ns) },
    { key: "ewT", clv: ew.through, floorS: Math.max(MIN_PHASE_GREEN_S, pedMin.ew) },
    ...(phasing.ns === "protected" ? [{ key: "nsL" as const, clv: ns.left, floorS: MIN_PHASE_GREEN_S }] : []),
    ...(phasing.ew === "protected" ? [{ key: "ewL" as const, clv: ew.left, floorS: MIN_PHASE_GREEN_S }] : []),
  ];
  const clvSum = phases.reduce((t, p) => t + p.clv, 0);
  if (!(clvSum > 0) || !(s > 0)) return screeningDefault({ pedMinGreenS: pedMin });
  const Y = clvSum / s;
  const nCritical = phases.length as 2 | 3 | 4;
  const lostTime = LOST_TIME_PER_PHASE_S * nCritical;
  const required = roundUpTo5(requiredCycleS(phases));

  let cycle: number;
  let basis: TimingBasis;
  const measured = args.measuredCycleS;
  if (typeof measured === "number" && Number.isFinite(measured) && measured >= ABSOLUTE_MIN_CYCLE_S && measured <= ABSOLUTE_MAX_CYCLE_S) {
    // A measured cycle wins — but a cycle shorter than the phases it must serve
    // is not a controller value the engine can honor, so it is raised to the
    // shortest cycle that fits (the basis still says where the cycle came from).
    cycle = Math.max(measured, required);
    basis = "measured-cycle";
  } else if (Y >= MAX_CRITICAL_FLOW_RATIO) {
    return screeningDefault({ criticalFlowRatio: round2(Y), pedMinGreenS: pedMin });
  } else {
    // Webster optimum: C = (1.5 L + 5) / (1 - Y), rounded up to 5 s, clamped.
    const raw = (1.5 * lostTime + 5) / (1 - Y);
    cycle = Math.max(required, Math.min(MAX_CYCLE_S, Math.max(MIN_CYCLE_S, roundUpTo5(raw))));
    basis = "webster";
  }
  cycle = Math.min(ABSOLUTE_MAX_CYCLE_S, cycle);

  const g = splitGreens(cycle, phases);
  return {
    cycleLenS: cycle,
    gOverCns: g.nsT! / cycle,
    gOverCew: g.ewT! / cycle,
    ...(phasing.ns === "protected" ? { gOverCnsLeft: g.nsL! / cycle } : {}),
    ...(phasing.ew === "protected" ? { gOverCewLeft: g.ewL! / cycle } : {}),
    leftPhasing: phasing,
    leftPhasingSource: phasingSource,
    criticalPhases: nCritical,
    criticalFlowRatio: round2(Y),
    pedMinGreenS: pedMin,
    basis,
  };
}

export type SynchroPhaseRecord = {
  cycleLenSec?: number;
  /** Phase number serving each movement, from [Lanes] Phase1 (NBL, NBT, …). */
  phaseByMovement?: Partial<Record<string, number>>;
  /** Split (max green) seconds by phase number, from [Timings]. */
  splitSByPhase?: Partial<Record<string | number, number>>;
};

/**
 * The MEASURED tier from a Synchro record: cycle plus per-phase splits mapped
 * to movements. Returns undefined — never a guess — when the record lacks the
 * cycle, the through-phase splits, or the movement→phase map (no NEMA
 * phase-numbering assumptions are made), so the resolver degrades to
 * "measured-cycle" or lower.
 *
 * Effective green = split − lost time (5 s), floored at MIN_PHASE_GREEN_S.
 * A left is protected when its phase differs from its through's phase.
 */
export function timingFromSynchroPhases(rec: SynchroPhaseRecord): SignalTiming | undefined {
  const cycle = rec.cycleLenSec;
  if (typeof cycle !== "number" || !Number.isFinite(cycle) || cycle < ABSOLUTE_MIN_CYCLE_S || cycle > ABSOLUTE_MAX_CYCLE_S) return undefined;
  const map = rec.phaseByMovement, splits = rec.splitSByPhase;
  if (!map || !splits) return undefined;
  const phaseOf = (mv: string): number | undefined => {
    const p = map[mv];
    return typeof p === "number" && Number.isFinite(p) && p > 0 ? p : undefined;
  };
  const splitOf = (p: number | undefined): number | undefined => {
    if (p === undefined) return undefined;
    const v = splits[p] ?? splits[String(p)];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
  };
  const greenOf = (ps: Array<number | undefined>): number | undefined => {
    const vals = ps.map(splitOf).filter((v): v is number => v !== undefined);
    if (vals.length === 0) return undefined;
    return Math.max(MIN_PHASE_GREEN_S, Math.max(...vals) - LOST_TIME_PER_PHASE_S);
  };
  const nsT = greenOf([phaseOf("NBT"), phaseOf("SBT")]);
  const ewT = greenOf([phaseOf("EBT"), phaseOf("WBT")]);
  if (nsT === undefined || ewT === undefined) return undefined;
  const protectedOn = (l1: string, t1: string, l2: string, t2: string): boolean => {
    const a = phaseOf(l1), b = phaseOf(l2);
    return (a !== undefined && a !== phaseOf(t1)) || (b !== undefined && b !== phaseOf(t2));
  };
  const nsProt = protectedOn("NBL", "NBT", "SBL", "SBT");
  const ewProt = protectedOn("EBL", "EBT", "WBL", "WBT");
  const nsL = nsProt ? greenOf([phaseOf("NBL"), phaseOf("SBL")]) : undefined;
  const ewL = ewProt ? greenOf([phaseOf("EBL"), phaseOf("WBL")]) : undefined;
  // Greens are bounded by the cycle they came from; Σ g/C ≤ 1 by construction
  // of a real timing plan, but a malformed record could exceed it — scale down.
  let greens = [nsT, ewT, nsL ?? 0, ewL ?? 0];
  const sum = greens.reduce((s, v) => s + v, 0);
  const cap = cycle - LOST_TIME_PER_PHASE_S * (2 + (nsL ? 1 : 0) + (ewL ? 1 : 0));
  if (sum > cap && cap > 0) greens = greens.map((v) => (v * cap) / sum);
  const [gNsT, gEwT, gNsL, gEwL] = greens;
  return {
    cycleLenS: cycle,
    gOverCns: gNsT / cycle,
    gOverCew: gEwT / cycle,
    ...(nsL !== undefined ? { gOverCnsLeft: gNsL / cycle } : {}),
    ...(ewL !== undefined ? { gOverCewLeft: gEwL / cycle } : {}),
    leftPhasing: { ns: nsProt ? "protected" : "permissive", ew: ewProt ? "protected" : "permissive" },
    leftPhasingSource: "import",
    criticalPhases: (2 + (nsL !== undefined ? 1 : 0) + (ewL !== undefined ? 1 : 0)) as 2 | 3 | 4,
    criticalFlowRatio: 0,
    pedMinGreenS: { ns: pedestrianMinGreenS(2), ew: pedestrianMinGreenS(2) },
    basis: "measured",
    source: "synchro",
  };
}

export type TimingProvider = () => SignalTiming | undefined;

/**
 * One resolver, ordered providers. The first provider that returns a timing
 * wins (a client's Synchro upload ranks above an agency sheet, which ranks
 * above the computed model); when none resolves, the timing is computed from
 * `fallback` — Webster from volumes, or the screening default without them.
 */
export function resolveSignalTiming(args: { providers: TimingProvider[]; fallback: ComputeSignalTimingArgs }): SignalTiming {
  for (const p of args.providers) {
    const t = p();
    if (t) return t;
  }
  return computeSignalTiming(args.fallback);
}

/** Green ratio of the THROUGH phase serving an approach. */
export function gOverCForApproach(t: SignalTiming, d: Direction): number {
  return AXIS_OF[d] === "ns" ? t.gOverCns : t.gOverCew;
}

/** Green ratio serving a movement: a protected left gets its own phase;
 *  through, right and a permissive left ride the through phase. */
export function gOverCForMovement(t: SignalTiming, d: Direction, m: Movement): number {
  const axis = AXIS_OF[d];
  if (m === "L" && t.leftPhasing[axis] === "protected") {
    const g = axis === "ns" ? t.gOverCnsLeft : t.gOverCewLeft;
    if (typeof g === "number") return g;
  }
  return gOverCForApproach(t, d);
}

/** The heavier-through-phase g/C — the intersection-level capacity basis. */
export function criticalGOverC(t: SignalTiming): number {
  return Math.max(t.gOverCns, t.gOverCew);
}
