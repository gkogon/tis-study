/**
 * Intersection micro-simulation: one signalized junction, four approaches,
 * built from the affected-intersection row the report printed for it. Pure
 * TypeScript — no DOM — so `scripts/check-intersection-sim.mjs` runs it
 * headless under plain node; the Simulate tab draws `cars()` and `phase()`.
 *
 * WHAT IT IS. The opener's car-following (`car-following.ts`: CAR_L, VMAX,
 * ACC, BRAKE, GAP) moves vehicles up each approach; the stop line of every
 * lane is a server that admits one vehicle per saturation headway
 * (3600 / 1800 vphpl = 2.0 s) while its phase is green; the signal is the
 * row's own timing (cycle, g/C per phase, protected lefts) with the engine's
 * 5 s lost time per phase shown as 4 s yellow + 1 s all-red. Arrivals are
 * Poisson per movement from a seeded RNG, so the same seed replays the same
 * hour. Every number in `IntersectionSimInputs` comes from the row or from
 * a documented engine default — nothing is invented, and every default is
 * flagged in `notes` so the view can say so.
 *
 * WHAT IT IS NOT. A calibrated Synchro/VISSIM model. Simulated delay is a
 * stochastic measurement of the SAME queueing process the engine's Webster
 * d1 + Akçelik d2 describe analytically (`signal-delay.ts` vcToDelay), so
 * the two agree within a band (±40 % at v/c ≤ 0.7, checked) but are not
 * expected to match; the report's number is the engine's, always.
 *
 * ENGINE DEFAULTS MIRRORED (file:line on main at the time of writing):
 *   saturation flow 1800 vphpl        lib/tis-engine-core/src/signal-delay.ts:51   SATURATION_FLOW_VPH
 *   vehicle length 25 ft (queue ft)    lib/tis-engine-core/src/signal-delay.ts:55   VEH_LENGTH_FT
 *   screening cycle 90 s / g/C 0.45    lib/tis-engine-core/src/signal-delay.ts:49-50 CYCLE_LEN, G_OVER_C
 *   lost time 5 s per phase            lib/tis-engine-core/src/webster-timing.ts:60 LOST_TIME_PER_PHASE_S
 *   left 0.10 / through 0.80 / right   lib/tis-engine-core/src/webster-timing.ts:104-105, 187
 *     the remainder (0.10)               DEFAULT_LEFT_TURN_SHARE, DEFAULT_THROUGH_SHARE, leftAndThrough()
 *   one through lane per direction     lib/tis-engine-core/src/webster-timing.ts:88 DEFAULT_THROUGH_LANES_PER_DIR;
 *                                      row-math.ts:1083 omits throughLanes when the source is "default"
 *   permissive left rides the through  lib/tis-engine-core/src/webster-timing.ts:43-47, 434-443
 *     phase (no gap acceptance)          gOverCForMovement — the engine's own stated simplification
 *   protected left has its own phase   lib/tis-engine-core/src/webster-timing.ts:436-441 gOverCnsLeft / gOverCewLeft
 *   approach capacity = s × g/C × lanes lib/tis-engine-core/src/row-math.ts:885-886 approachCap()
 *   yellow 4 s + all-red 1 s           the opener's split of the same 5 s (study-alive-sim.ts phase())
 *   assumed left bay 250 ft            spec §3.3 — drawn dashed and flagged `leftBayAssumed`
 *
 * SATURATION FLOW. The follower rule alone does not produce 1800 vphpl —
 * with the opener's 1.8 s reaction margin a standing queue discharges at
 * ≈1060 vphpl, and with no margin at ≈2060. The stop-line server is what
 * pins discharge to the engine's figure: the head of each lane is PACED
 * (never stopped) so that it crosses no earlier than 2.0 s after the
 * previous vehicle in that lane. The follower's reaction margin is therefore
 * 0 here (FOLLOW_HEADWAY_S) so the server, not the follower, is binding;
 * the brick-wall stopping term still spaces vehicles physically.
 *
 * UNITS. Feet and seconds. Along each approach `s` is signed distance from
 * the stop line: vehicles enter at −APPROACH_LEN_FT, queue at s < 0, cross
 * at s = 0 and are removed at EXIT_FT. Lane −1 is the left-turn bay, lanes
 * 0..n−1 are through lanes with 0 innermost (next to the centreline).
 */

import type {
  TisAffectedIntersection,
  TisAffectedIntersectionSignalTiming,
  TisApproachImpact,
} from "@workspace/tis-api-client-react";
import {
  SATURATION_FLOW_VPH,
  VEH_LENGTH_FT,
  CYCLE_LEN,
  G_OVER_C,
  LOST_TIME_PER_PHASE_S,
  DEFAULT_LEFT_TURN_SHARE,
  DEFAULT_THROUGH_SHARE,
  DEFAULT_THROUGH_LANES_PER_DIR,
} from "@workspace/tis-engine-core";
import { CAR_L, GAP, VMAX, followGap, targetSpeed, stepSpeed } from "./car-following.ts";

export type Direction = "NB" | "SB" | "EB" | "WB";
export type Movement = "L" | "T" | "R";
export type Axis = "ns" | "ew";
export type Scenario = "nobuild" | "build";
export type Light = "G" | "Y" | "R";
export type PhaseKey = "nsL" | "ns" | "ewL" | "ew";

export const DIRECTIONS: readonly Direction[] = ["NB", "SB", "EB", "WB"];
export const MOVEMENTS: readonly Movement[] = ["L", "T", "R"];
const AXIS_OF: Record<Direction, Axis> = { NB: "ns", SB: "ns", EB: "ew", WB: "ew" };
/** The through movement a left turn crosses: NB-L crosses SB-T. */
export const OPPOSING: Record<Direction, Direction> = { NB: "SB", SB: "NB", EB: "WB", WB: "EB" };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Saturation headway, s — 3600 / SATURATION_FLOW_VPH (signal-delay.ts:51). */
export const SAT_HEADWAY_S = 3600 / SATURATION_FLOW_VPH;
/** Yellow inside the engine's 5 s lost time per phase (webster-timing.ts:60). */
export const YELLOW_S = 4;
/** All-red — the rest of the lost time. */
export const ALL_RED_S = LOST_TIME_PER_PHASE_S - YELLOW_S;
/** Left-turn bay length when no storage is known (spec §3.3). */
export const ASSUMED_LEFT_BAY_FT = 250;
/** Drawn approach length; a queue longer than this waits in an entry buffer that still counts. */
export const APPROACH_LEN_FT = 1000;
/** Vehicles are removed this far past the stop line. */
export const EXIT_FT = 100;
/** Fixed integration step, s. `step(dt)` sub-steps at this so results depend on simulated time only. */
export const SIM_DT = 0.05;
/** Opener's yellow rule: a vehicle closer than this to the line proceeds on yellow (study-alive-sim.ts `bestD > 28`) — decided once per vehicle, at the yellow's onset. */
export const YELLOW_GO_FT = 28;
/** Opener's queue rule: a vehicle below this speed is queued (study-alive-sim.ts `c.v < 3`). */
export const QUEUE_SPEED = 3;
/** Opener's delay rule: time below this speed is stopped + slowed delay (study-alive-sim.ts `c.v < 12`). */
export const SLOW_SPEED = 12;
/** Follower reaction margin — 0 so the stop-line server is the binding constraint (see header). */
export const FOLLOW_HEADWAY_S = 0;
/**
 * Start-up lost time: a standing queue's first vehicle crosses no earlier
 * than this after its green begins (the conventional ≈2 s, FHWA Signal
 * Timing Manual). Together with the ≈2 s a platoon extends into the yellow
 * (YELLOW_GO_FT at onset) the sim's effective green equals its displayed
 * green — i.e. the engine's g — which `check:intersection-sim` measures.
 */
export const STARTUP_LOST_S = 2;
/** Opener's entry rule: no spawn within CAR_L + GAP + 30 of another vehicle (study-alive-sim.ts spawn()). */
const ENTRY_CLEAR_FT = CAR_L + GAP + 30;
/** Free-flow travel time over the drawn approach — control delay is travel time beyond this. */
export const FREE_FLOW_S = APPROACH_LEN_FT / VMAX;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type SimApproachInputs = {
  direction: Direction;
  /** Total demand in this scenario, vph (background + project). */
  vph: number;
  /** Through lanes (≥ 1). */
  throughLanes: number;
  lanesSource: "import" | "osm" | "default";
  /** Share of `vph` turning left / right; through is the remainder. */
  leftShare: number;
  rightShare: number;
  /** Per-movement demand, vph, = background + project. */
  movementVph: Record<Movement, number>;
  /** Background (no-build) demand by movement, vph. */
  backgroundVph: Record<Movement, number>;
  /** Project trips by movement, vph — zeros for the no-build scenario. */
  projectTrips: Record<Movement, number>;
  splitSource: "laneGroups" | "default";
  /** Present ⇒ a left-turn bay of this length. */
  leftBayFt?: number;
  leftBaySource?: "laneGroups" | "existingStorage" | "assumed";
  leftBayAssumed?: boolean;
};

export type SimPhase = { key: PhaseKey; greenSec: number };

export type SimSignalInputs = {
  cycleLenSec: number;
  /** Effective greens, s — g/C × cycle. */
  gNs: number;
  gEw: number;
  /** Protected-left greens, s — present ⇒ that axis's left is protected. */
  gNsLeft?: number;
  gEwLeft?: number;
  yellowSec: number;
  allRedSec: number;
  basis: TisAffectedIntersectionSignalTiming["basis"];
  source?: string;
  /** True when the row carried no signalTiming and the screening default was used. */
  assumed: boolean;
  /** Phase sequence, in order; each phase shows greenSec, then yellow, then all-red. */
  phases: SimPhase[];
  /** Seconds of the cycle no modelled phase covers (all-red slack); 0 for engine-computed timing. */
  slackSec: number;
};

export type IntersectionSimInputs = {
  signalId: string;
  name: string;
  scenario: Scenario;
  approaches: Record<Direction, SimApproachInputs>;
  signal: SimSignalInputs;
  /** Every default or fallback that was applied, in plain words. */
  notes: string[];
};

export type SimInputsOptions = {
  /** Timing to run instead of the row's (the studio's scenario timing). */
  signalTiming?: TisAffectedIntersectionSignalTiming;
  /** Bay length when none is known; default ASSUMED_LEFT_BAY_FT. */
  assumedLeftBayFt?: number;
};

const pos = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);

function screeningDefaultTiming(): TisAffectedIntersectionSignalTiming {
  return {
    basis: "screening-default",
    cycleLenSec: CYCLE_LEN,
    criticalPhases: 2,
    gOverCns: G_OVER_C,
    gOverCew: G_OVER_C,
    leftPhasingNs: "permissive",
    leftPhasingEw: "permissive",
  };
}

/** Signal inputs from a timing record: greens = g/C × C, phases in lead-left order. */
export function signalInputsFromTiming(t: TisAffectedIntersectionSignalTiming, assumed: boolean, notes: string[]): SimSignalInputs {
  const C = t.cycleLenSec;
  const gcNs = t.gOverCnsExact ?? t.gOverCns;
  const gcEw = t.gOverCewExact ?? t.gOverCew;
  const nsProt = t.leftPhasingNs === "protected" && typeof (t.gOverCnsLeftExact ?? t.gOverCnsLeft) === "number";
  const ewProt = t.leftPhasingEw === "protected" && typeof (t.gOverCewLeftExact ?? t.gOverCewLeft) === "number";
  const gcNsL = nsProt ? (t.gOverCnsLeftExact ?? t.gOverCnsLeft ?? 0) : undefined;
  const gcEwL = ewProt ? (t.gOverCewLeftExact ?? t.gOverCewLeft ?? 0) : undefined;
  let gNs = gcNs * C, gEw = gcEw * C;
  let gNsLeft = gcNsL !== undefined ? gcNsL * C : undefined;
  let gEwLeft = gcEwL !== undefined ? gcEwL * C : undefined;
  const nPhases = 2 + (nsProt ? 1 : 0) + (ewProt ? 1 : 0);
  const lost = LOST_TIME_PER_PHASE_S * nPhases;
  const sumG = gNs + gEw + (gNsLeft ?? 0) + (gEwLeft ?? 0);
  const avail = C - lost;
  let slackSec = 0;
  if (sumG > avail + 1e-9 && sumG > 0) {
    // The record's greens plus 5 s lost time per phase overrun the cycle
    // (the flat screening default: 0.45 + 0.45 leaves 9 s, not 10). Scale the
    // greens down so the phases fit; capacity moves by the same ratio.
    const k = avail / sumG;
    gNs *= k; gEw *= k;
    if (gNsLeft !== undefined) gNsLeft *= k;
    if (gEwLeft !== undefined) gEwLeft *= k;
    notes.push(`Greens scaled by ${k.toFixed(3)} so ${nPhases} phases × 5 s lost time fit the ${C} s cycle.`);
  } else if (sumG < avail - 1e-9) {
    slackSec = avail - sumG;
    notes.push(`${slackSec.toFixed(1)} s of the cycle serves no modelled phase (shown all-red).`);
  }
  const phases: SimPhase[] = [];
  if (gNsLeft !== undefined) phases.push({ key: "nsL", greenSec: gNsLeft });
  phases.push({ key: "ns", greenSec: gNs });
  if (gEwLeft !== undefined) phases.push({ key: "ewL", greenSec: gEwLeft });
  phases.push({ key: "ew", greenSec: gEw });
  return {
    cycleLenSec: C, gNs, gEw,
    ...(gNsLeft !== undefined ? { gNsLeft } : {}),
    ...(gEwLeft !== undefined ? { gEwLeft } : {}),
    yellowSec: YELLOW_S, allRedSec: ALL_RED_S,
    basis: t.basis, ...(t.source ? { source: t.source } : {}),
    assumed, phases, slackSec,
  };
}

/**
 * Build the sim's inputs from one report row. `scenario` picks the volumes:
 * "nobuild" = the row's opening-year no-build volumes (`existingVolumeVph`,
 * which the schema documents as no-build despite its name); "build" adds the
 * project trips by movement from `movements[]`.
 */
export function simInputsFromRow(row: TisAffectedIntersection, scenario: Scenario, opts: SimInputsOptions = {}): IntersectionSimInputs {
  const notes: string[] = [];
  const timingRec = opts.signalTiming ?? row.signalTiming;
  const timingAssumed = !timingRec;
  if (timingAssumed) notes.push(`No signal timing on the row: screening default ${CYCLE_LEN} s cycle, g/C ${G_OVER_C} both axes, permissive lefts.`);
  const signal = signalInputsFromTiming(timingRec ?? screeningDefaultTiming(), timingAssumed, notes);
  const protectedAxis: Record<Axis, boolean> = { ns: signal.gNsLeft !== undefined, ew: signal.gEwLeft !== undefined };
  const assumedBay = opts.assumedLeftBayFt ?? ASSUMED_LEFT_BAY_FT;
  const movements = row.movements ?? [];

  const approaches = {} as Record<Direction, SimApproachInputs>;
  for (const d of DIRECTIONS) {
    const a: TisApproachImpact | undefined = row.approaches.find((x) => x.direction === d);
    const background = pos(a?.existingVolumeVph);
    const lanesRaw = a?.throughLanes;
    const lanesKnown = typeof lanesRaw === "number" && Number.isFinite(lanesRaw) && lanesRaw >= 1;
    const throughLanes = lanesKnown ? Math.floor(lanesRaw) : DEFAULT_THROUGH_LANES_PER_DIR;
    const lanesSource: SimApproachInputs["lanesSource"] = lanesKnown ? (a?.lanesSource ?? "import") : "default";

    // Background L/T/R split: measured lane-group volumes when the row has
    // them, else the engine's 10/80/10 convention.
    const lg = a?.laneGroups;
    const lgTotal = lg ? lg.reduce((s, g) => s + pos(g.existingVolumeVph), 0) : 0;
    let shares: Record<Movement, number>;
    let splitSource: SimApproachInputs["splitSource"];
    if (lg && lgTotal > 0) {
      const of = (m: Movement): number => pos(lg.find((g) => g.movement === m)?.existingVolumeVph) / lgTotal;
      shares = { L: of("L"), T: of("T"), R: of("R") };
      splitSource = "laneGroups";
    } else {
      shares = { L: DEFAULT_LEFT_TURN_SHARE, T: DEFAULT_THROUGH_SHARE, R: 1 - DEFAULT_LEFT_TURN_SHARE - DEFAULT_THROUGH_SHARE };
      splitSource = "default";
    }
    const backgroundVph: Record<Movement, number> = { L: background * shares.L, T: background * shares.T, R: background * shares.R };

    // Project trips by movement — build only.
    const projectTrips: Record<Movement, number> = { L: 0, T: 0, R: 0 };
    if (scenario === "build") {
      const mine = movements.filter((m) => m.approach === d);
      if (mine.length > 0) {
        for (const m of mine) projectTrips[m.movement] += pos(m.trips);
      } else if (pos(a?.addedTripsPeak) > 0) {
        // Pre-movements payload: the approach total is known but not its turns.
        const added = pos(a?.addedTripsPeak);
        for (const m of MOVEMENTS) projectTrips[m] = added * shares[m];
        notes.push(`${d}: ${added} project trips spread by the background split (row has no movements table).`);
      }
    }
    const movementVph: Record<Movement, number> = {
      L: backgroundVph.L + projectTrips.L, T: backgroundVph.T + projectTrips.T, R: backgroundVph.R + projectTrips.R,
    };
    const vph = movementVph.L + movementVph.T + movementVph.R;

    // Left-turn bay: a protected left needs its own lane; a lane-group L entry
    // says one exists. Length from the lane group, else the row's governing
    // storage when it is this left, else assumed.
    const lgL = lg?.find((g) => g.movement === "L");
    const hasBay = protectedAxis[AXIS_OF[d]] || lgL !== undefined;
    let bay: Pick<SimApproachInputs, "leftBayFt" | "leftBaySource" | "leftBayAssumed"> = {};
    if (hasBay) {
      if (lgL && pos(lgL.storageFt) > 0) bay = { leftBayFt: pos(lgL.storageFt), leftBaySource: "laneGroups", leftBayAssumed: false };
      else if (row.storageMovement === `${d}L` && pos(row.existingStorageFt) > 0) bay = { leftBayFt: pos(row.existingStorageFt), leftBaySource: "existingStorage", leftBayAssumed: false };
      else {
        bay = { leftBayFt: assumedBay, leftBaySource: "assumed", leftBayAssumed: true };
        notes.push(`${d}: left-turn bay length unknown — ${assumedBay} ft assumed.`);
      }
    }

    approaches[d] = {
      direction: d, vph, throughLanes, lanesSource,
      leftShare: vph > 0 ? movementVph.L / vph : 0,
      rightShare: vph > 0 ? movementVph.R / vph : 0,
      movementVph, backgroundVph, projectTrips, splitSource, ...bay,
    };
  }
  const defaultSplit = DIRECTIONS.filter((d) => approaches[d].splitSource === "default");
  if (defaultSplit.length > 0) {
    notes.push(`Background turns on ${defaultSplit.join("/")} use the engine's ${DEFAULT_LEFT_TURN_SHARE}/${DEFAULT_THROUGH_SHARE}/${(1 - DEFAULT_LEFT_TURN_SHARE - DEFAULT_THROUGH_SHARE).toFixed(2)} L/T/R convention (no per-movement count).`);
  }
  const defaultLanes = DIRECTIONS.filter((d) => approaches[d].lanesSource === "default");
  if (defaultLanes.length > 0) notes.push(`Through lanes on ${defaultLanes.join("/")} default to ${DEFAULT_THROUGH_LANES_PER_DIR} (no lane count on the row).`);
  notes.push("Permissive lefts discharge with their through phase, as the engine assumes (no gap acceptance); pedestrian minimums are not simulated.");
  return { signalId: row.signalId, name: row.name, scenario, approaches, signal, notes };
}

// ---------------------------------------------------------------------------
// RNG — mulberry32, one instance per arrival stream so a build run shares its
// background arrivals with the no-build run of the same seed (common random
// numbers: the project stream only adds vehicles).
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export type SimCar = {
  id: number;
  approach: Direction;
  /** −1 = left-turn bay; 0..n−1 through lanes, 0 innermost. */
  lane: number;
  /** Feet from the stop line along the approach (negative = upstream). */
  s: number;
  /** ft/s */
  v: number;
  movement: Movement;
  /** A project trip (build scenario). */
  project: boolean;
};

type Car = SimCar & {
  arrivedT: number;
  slowT: number;
  /** Decided at yellow onset: true = within YELLOW_GO_FT, proceeds; false/undefined = stops. */
  yellowGo?: boolean;
};

type Stream = { approach: Direction; movement: Movement; project: boolean; rate: number; rnd: () => number; nextT: number };

type Lane = {
  approach: Direction;
  index: number;
  isBay: boolean;
  /** Leader first. */
  cars: Car[];
  /** Arrived but the entry is occupied; still on the network. */
  buffer: Car[];
  lastCrossT: number;
  lastLight: Light;
};

type ApproachState = {
  d: Direction;
  in: SimApproachInputs;
  lanes: Lane[];
  bay: Lane | undefined;
  arrivals: number;
  departures: number;
  delaySum: number;
  slowSum: number;
  cycleMaxQueue: number;
  cycleQueues: number[];
};

export type ApproachSimMetrics = {
  direction: Direction;
  arrivals: number;
  throughput: number;
  onNetwork: number;
  /** Mean control delay of vehicles that crossed the stop line: travel time beyond free flow, s. */
  simDelaySec: number;
  /** Mean time below SLOW_SPEED while approaching — the opener's stopped + slowed rule, s. */
  stoppedDelaySec: number;
  /** 95th percentile of the per-cycle maximum back-of-queue in the worst lane, ft (VEH_LENGTH_FT per vehicle). */
  q95Ft: number;
  maxQueueFt: number;
  cyclesSampled: number;
};

export type IntersectionSimMetrics = {
  simT: number;
  cycles: number;
  arrivals: number;
  throughput: number;
  onNetwork: number;
  approaches: Record<Direction, ApproachSimMetrics>;
};

export type PhaseState = {
  key: PhaseKey | "slack";
  state: "G" | "Y" | "AR";
  timeInPhase: number;
  cycleT: number;
  lights: Record<Direction, Record<Movement, Light>>;
};

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

export class IntersectionSim {
  readonly inputs: IntersectionSimInputs;
  readonly seed: number;
  private stepN = 0;
  private accum = 0;
  private nextId = 1;
  private readonly streams: Stream[] = [];
  private readonly ap: Record<Direction, ApproachState>;
  private readonly phaseStarts: number[];
  private readonly cycleLen: number;
  private lastCycleIndex = 0;

  constructor(inputs: IntersectionSimInputs, seed = 1) {
    this.inputs = inputs;
    this.seed = seed >>> 0;
    this.cycleLen = inputs.signal.cycleLenSec;
    this.phaseStarts = [];
    let u = 0;
    for (const p of inputs.signal.phases) { this.phaseStarts.push(u); u += p.greenSec + YELLOW_S + ALL_RED_S; }
    this.ap = {} as Record<Direction, ApproachState>;
    DIRECTIONS.forEach((d, di) => {
      const a = inputs.approaches[d];
      const lanes: Lane[] = [];
      for (let i = 0; i < a.throughLanes; i++) lanes.push({ approach: d, index: i, isBay: false, cars: [], buffer: [], lastCrossT: -Infinity, lastLight: "R" });
      const bay: Lane | undefined = a.leftBayFt !== undefined
        ? { approach: d, index: -1, isBay: true, cars: [], buffer: [], lastCrossT: -Infinity, lastLight: "R" }
        : undefined;
      this.ap[d] = { d, in: a, lanes, bay, arrivals: 0, departures: 0, delaySum: 0, slowSum: 0, cycleMaxQueue: 0, cycleQueues: [] };
      MOVEMENTS.forEach((m, mi) => {
        for (const project of [false, true]) {
          const rate = (project ? a.projectTrips[m] : a.backgroundVph[m]) / 3600;
          if (!(rate > 0)) continue;
          const streamSeed = (this.seed + 1) * 1000003 + di * 101 + mi * 17 + (project ? 7 : 0);
          const rnd = mulberry32(streamSeed);
          const st: Stream = { approach: d, movement: m, project, rate, rnd, nextT: 0 };
          st.nextT = this.expGap(st);
          this.streams.push(st);
        }
      });
    });
  }

  private expGap(st: Stream): number {
    return -Math.log(1 - st.rnd()) / st.rate;
  }

  get simT(): number { return this.stepN * SIM_DT; }

  cyclesCompleted(): number { return Math.floor(this.simT / this.cycleLen); }

  // ------------------------------------------------------------ signal
  private phaseAt(cycleT: number): { key: PhaseKey | "slack"; state: "G" | "Y" | "AR"; timeInPhase: number } {
    const phases = this.inputs.signal.phases;
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i]!, start = this.phaseStarts[i]!;
      const tp = cycleT - start;
      if (tp < 0) continue;
      if (tp < p.greenSec) return { key: p.key, state: "G", timeInPhase: tp };
      if (tp < p.greenSec + YELLOW_S) return { key: p.key, state: "Y", timeInPhase: tp };
      if (tp < p.greenSec + YELLOW_S + ALL_RED_S) return { key: p.key, state: "AR", timeInPhase: tp };
    }
    const last = this.phaseStarts[this.phaseStarts.length - 1] ?? 0;
    const lastP = phases[phases.length - 1];
    const end = last + (lastP ? lastP.greenSec + YELLOW_S + ALL_RED_S : 0);
    return { key: "slack", state: "AR", timeInPhase: cycleT - end };
  }

  private lightFor(ph: { key: PhaseKey | "slack"; state: "G" | "Y" | "AR" }, key: PhaseKey): Light {
    if (ph.key !== key) return "R";
    return ph.state === "G" ? "G" : ph.state === "Y" ? "Y" : "R";
  }

  /** The phase key that serves a lane: a bay on a protected axis has its own; everything else rides the through phase. */
  private laneKey(lane: Lane): PhaseKey {
    const axis = AXIS_OF[lane.approach];
    const prot = axis === "ns" ? this.inputs.signal.gNsLeft !== undefined : this.inputs.signal.gEwLeft !== undefined;
    if (lane.isBay && prot) return axis === "ns" ? "nsL" : "ewL";
    return axis;
  }

  phase(): PhaseState {
    const cycleT = this.simT % this.cycleLen;
    const ph = this.phaseAt(cycleT);
    const lights = {} as Record<Direction, Record<Movement, Light>>;
    for (const d of DIRECTIONS) {
      const axis = AXIS_OF[d];
      const through = this.lightFor(ph, axis);
      const prot = axis === "ns" ? this.inputs.signal.gNsLeft !== undefined : this.inputs.signal.gEwLeft !== undefined;
      const left = prot ? this.lightFor(ph, axis === "ns" ? "nsL" : "ewL") : through;
      lights[d] = { L: left, T: through, R: through };
    }
    return { key: ph.key, state: ph.state, timeInPhase: ph.timeInPhase, cycleT, lights };
  }

  // ------------------------------------------------------------ stepping
  /** Advance by `dt` seconds of simulated time, in fixed SIM_DT sub-steps. */
  step(dt: number): void {
    this.accum += dt;
    while (this.accum >= SIM_DT - 1e-9) {
      this.substep();
      this.accum -= SIM_DT;
    }
  }

  /** Advance until `n` more signal cycles have completed. */
  runCycles(n: number): void {
    const target = this.cyclesCompleted() + n;
    while (this.cyclesCompleted() < target) this.substep();
    this.accum = 0;
  }

  private substep(): void {
    const t0 = this.simT;
    const dt = SIM_DT;
    const t1 = (this.stepN + 1) * SIM_DT;
    const ph = this.phaseAt(t0 % this.cycleLen);

    // Arrivals due in (t0, t1]: into the lane's entry buffer.
    for (const st of this.streams) {
      while (st.nextT <= t1) {
        const a = this.ap[st.approach];
        const lane = this.entryLane(a, st.movement);
        lane.buffer.push({
          id: this.nextId++, approach: st.approach, lane: lane.index, s: -APPROACH_LEN_FT, v: 0,
          movement: st.movement, project: st.project, arrivedT: st.nextT, slowT: 0,
        });
        a.arrivals++;
        st.nextT += this.expGap(st);
      }
    }

    for (const d of DIRECTIONS) {
      const a = this.ap[d];
      const bay = a.bay;
      const bayFt = a.in.leftBayFt ?? 0;
      const laneOrder: Lane[] = bay ? [bay, ...a.lanes] : a.lanes;
      for (const lane of laneOrder) {
        // Entry: admit the buffer head when the opener's spawn clearance holds.
        if (lane.buffer.length > 0) {
          const tail = lane.cars[lane.cars.length - 1];
          const spacing = tail ? tail.s - (-APPROACH_LEN_FT) : Infinity;
          if (spacing >= ENTRY_CLEAR_FT) {
            const c = lane.buffer.shift()!;
            c.v = Math.min(VMAX, targetSpeed(followGap(spacing, 0, FOLLOW_HEADWAY_S)));
            lane.cars.push(c);
          }
        }
        for (const c of lane.buffer) c.slowT += dt; // waiting to enter is delay too

        const light = this.lightFor(ph, this.laneKey(lane));
        if (light === "G" && lane.lastLight !== "G") {
          // Green onset with a standing queue: start-up lost time before the
          // first vehicle crosses (a vehicle arriving at speed is not held).
          const head = lane.cars.find((c) => c.s < 0);
          if (head && head.v < QUEUE_SPEED) lane.lastCrossT = Math.max(lane.lastCrossT, t0 + STARTUP_LOST_S - SAT_HEADWAY_S);
        }
        if (light === "Y" && lane.lastLight !== "Y") {
          // Yellow onset: each vehicle decides once — within YELLOW_GO_FT it
          // proceeds, beyond it stops (the opener's rule, made a decision).
          for (const c of lane.cars) if (c.s < 0) c.yellowGo = -c.s <= YELLOW_GO_FT;
        }
        lane.lastLight = light;
        let headSeen = false;
        for (let i = 0; i < lane.cars.length; i++) {
          const c = lane.cars[i]!;
          const ahead = i > 0 ? lane.cars[i - 1] : undefined;
          let d = Infinity;
          if (ahead) d = Math.min(d, followGap(ahead.s - c.s, c.v, FOLLOW_HEADWAY_S));
          let paceV = Infinity;
          if (c.s < 0) {
            // A left turn in the inner through lane with a bay alongside:
            // move into the bay once inside its length and there is room
            // behind its tail; otherwise wait behind the tail (bay overflow
            // blocks the through lane, as it does in the field).
            if (bay && !lane.isBay && lane.index === 0 && c.movement === "L") {
              const bTail = bay.cars[bay.cars.length - 1];
              const room = !bTail || bTail.s - c.s >= CAR_L + GAP;
              if (c.s >= -bayFt && room) {
                lane.cars.splice(i, 1);
                i--;
                c.lane = -1;
                c.yellowGo = undefined;
                bay.cars.push(c);
                continue; // moves with the bay next sub-step
              }
              if (bTail) d = Math.min(d, followGap(bTail.s - c.s, c.v, FOLLOW_HEADWAY_S));
            }
            const distToLine = -c.s;
            const mustStop = light === "R" || (light === "Y" && c.yellowGo !== true);
            if (mustStop) d = Math.min(d, distToLine);
            if (!headSeen) {
              headSeen = true;
              // Stop-line server: cross no earlier than one saturation headway
              // after the previous vehicle in this lane — paced, not stopped.
              const earliest = lane.lastCrossT + SAT_HEADWAY_S;
              if (t0 < earliest) paceV = distToLine / (earliest - t0);
            }
          }
          const vt = Math.min(targetSpeed(d), paceV);
          c.v = stepSpeed(c.v, vt, dt);
          if (d <= 1) c.v = 0;
          const wasUpstream = c.s < 0;
          if (wasUpstream && c.v < SLOW_SPEED) c.slowT += dt;
          c.s += c.v * dt;
          if (wasUpstream && c.s >= 0) {
            const crossT = c.v > 0 ? t1 - c.s / c.v : t1;
            lane.lastCrossT = crossT;
            a.departures++;
            a.delaySum += Math.max(0, crossT - c.arrivedT - FREE_FLOW_S);
            a.slowSum += c.slowT;
          }
        }
        // Past the exit: gone. Leaders leave first, so a filter keeps order.
        if (lane.cars.length > 0 && lane.cars[0]!.s >= EXIT_FT) lane.cars = lane.cars.filter((c) => c.s < EXIT_FT);
      }

      // Back of queue this sub-step: the worst lane's queued vehicles (+ its buffer).
      let q = 0;
      for (const lane of laneOrder) {
        let n = lane.buffer.length;
        for (const c of lane.cars) if (c.s < 0 && c.v < QUEUE_SPEED) n++;
        if (n > q) q = n;
      }
      if (q > a.cycleMaxQueue) a.cycleMaxQueue = q;
    }

    this.stepN++;
    const cyc = this.cyclesCompleted();
    if (cyc > this.lastCycleIndex) {
      for (const d of DIRECTIONS) {
        const a = this.ap[d];
        a.cycleQueues.push(a.cycleMaxQueue);
        a.cycleMaxQueue = 0;
      }
      this.lastCycleIndex = cyc;
    }
  }

  /** Lane a new arrival heads for: lefts inner, rights outer, throughs the emptiest through lane. */
  private entryLane(a: ApproachState, m: Movement): Lane {
    const lanes = a.lanes;
    if (m === "L") {
      // Straight into the bay when it spans the whole drawn approach.
      if (a.bay && (a.in.leftBayFt ?? 0) >= APPROACH_LEN_FT) return a.bay;
      return lanes[0]!;
    }
    if (m === "R") return lanes[lanes.length - 1]!;
    let best = lanes[0]!;
    for (const l of lanes) if (l.cars.length + l.buffer.length < best.cars.length + best.buffer.length) best = l;
    return best;
  }

  // ------------------------------------------------------------ readouts
  cars(): SimCar[] {
    const out: SimCar[] = [];
    for (const d of DIRECTIONS) {
      const a = this.ap[d];
      const all = a.bay ? [a.bay, ...a.lanes] : a.lanes;
      for (const lane of all) for (const c of lane.cars) out.push({ id: c.id, approach: c.approach, lane: c.lane, s: c.s, v: c.v, movement: c.movement, project: c.project });
    }
    return out;
  }

  metrics(): IntersectionSimMetrics {
    const approaches = {} as Record<Direction, ApproachSimMetrics>;
    let arrivals = 0, throughput = 0, onNetwork = 0;
    for (const d of DIRECTIONS) {
      const a = this.ap[d];
      const all = a.bay ? [a.bay, ...a.lanes] : a.lanes;
      let on = 0;
      for (const lane of all) on += lane.cars.length + lane.buffer.length;
      const sorted = [...a.cycleQueues].sort((x, y) => x - y);
      approaches[d] = {
        direction: d,
        arrivals: a.arrivals,
        throughput: a.departures,
        onNetwork: on,
        simDelaySec: a.departures > 0 ? a.delaySum / a.departures : 0,
        stoppedDelaySec: a.departures > 0 ? a.slowSum / a.departures : 0,
        q95Ft: percentile(sorted, 0.95) * VEH_LENGTH_FT,
        maxQueueFt: (sorted[sorted.length - 1] ?? 0) * VEH_LENGTH_FT,
        cyclesSampled: sorted.length,
      };
      arrivals += a.arrivals; throughput += a.departures; onNetwork += on;
    }
    return { simT: this.simT, cycles: this.cyclesCompleted(), arrivals, throughput, onNetwork, approaches };
  }
}
