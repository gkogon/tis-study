/**
 * Intersection geometry — the plan the explorer draws for one studied signal,
 * read straight off the report row (and, when the studio has edits, the
 * browser re-solve of that row).
 *
 * Pure: no DOM, no React. Every number is the report's own — approach volumes,
 * v/c, delay, LOS, the 95th-percentile queue (already in feet; the engine's
 * VEH_LENGTH_FT converts it back to vehicles), imported turn-bay storage and
 * lane counts where the row carries them — or an engine constant named as
 * such (DEFAULT_LEFT_TURN_SHARE / DEFAULT_THROUGH_SHARE). Where the report
 * says nothing the plan says so (`lanesSource: "default"`, `leftBay.assumed`)
 * rather than filling a lane or a bay length in.
 *
 * What the row carries, and what the plan does with it:
 *
 *   approaches[].throughLanes / lanesSource   drawn as that many lanes; absent
 *       ⇒ the engine sized the approach with ONE lane (its screening default)
 *       and the plan says "default".
 *   approaches[].laneGroups[]   present with a Synchro/UTDF import (measured
 *       turning movements) OR, under legVolumes: network, from the balanced
 *       estimate of the study's leg volumes; the row's `volumeSource` says
 *       which (`laneGroupBasis`), and the Lanes tab words each accordingly.
 *       The L group's storageFt / storageDeficient / queue95thFt are the bay
 *       (a storage length only ever comes from an import); the whole array
 *       rides along for the Lanes tab.
 *   legVolumes[] / volumeSource   under legVolumes: network, each approach's
 *       background-volume source (`legSource`) for the Lanes tab.
 *   existingStorageFt / storageMovement   the governing imported bay at row
 *       level (e.g. "NBL"): used for that approach when no lane group says
 *       more, compared against the ROW's worst 95th-percentile queue
 *       (`queue95thFt` at row level) exactly as the PDF's storage-bay
 *       adequacy table compares it (pdf-export.ts §9.2: existing bay vs the
 *       intersection's Q95 Build), so the flag here is the deliverable's; a
 *       left-turn record ("NBL") is itself a bay on record and is drawn as
 *       one, at its length. `storageQueueFt` says which queue was compared.
 *   signalTiming.leftPhasingNs/Ew   "protected" ⇒ that axis is drawn with a
 *       left bay even without a lane record (a protected phase implies a
 *       lane); its length is ASSUMED_BAY_FT and the bay is flagged `assumed`
 *       so the view draws it dashed.
 *   movements[]   project trips by approach × L/T/R, summed per approach
 *       exactly as the engine sums `addedByMovement` (row-math.ts).
 *
 * Scenario: `planFromRow(row, scenarioRow)` draws the SCENARIO row and keeps
 * the base row's printed values beside each field (`base`), so the view can
 * show "base → scenario" wherever they differ. With no scenario row the plan
 * is the base row alone and `base` is absent.
 */
import type {
  TisAffectedIntersection,
  TisApproachImpact,
  TisLaneGroupImpact,
  TisDirection,
} from "@workspace/tis-api-client-react";
import { VEH_LENGTH_FT, DEFAULT_LEFT_TURN_SHARE, DEFAULT_THROUGH_SHARE } from "@workspace/tis-engine-core";

export type Direction = TisDirection;
export type Movement = "L" | "T" | "R";
export type Los = "A" | "B" | "C" | "D" | "E" | "F";
export type LanesSource = "import" | "osm" | "default";
export type Pair<T> = { noBuild: T; build: T };

export const DIRECTIONS: readonly Direction[] = ["NB", "SB", "EB", "WB"];
export const MOVEMENTS: readonly Movement[] = ["L", "T", "R"];

/** Feet per queued vehicle — the engine's own constant (signal-delay.ts). */
export const QUEUE_FT_PER_VEH = VEH_LENGTH_FT;

/** Bay length drawn when a left bay is implied (protected phase, or a lane
 *  group with no storage record) but no storage length is known. Drawn
 *  dashed and labelled "assumed"; never used in any number. */
export const ASSUMED_BAY_FT = 250;

/** The background turn split the engine uses when no import supplies one
 *  (webster-timing.ts). Stated on the Lanes tab as an assumption. */
export const DEFAULT_TURN_SHARES = {
  left: DEFAULT_LEFT_TURN_SHARE,
  through: DEFAULT_THROUGH_SHARE,
  right: Math.max(0, 1 - DEFAULT_LEFT_TURN_SHARE - DEFAULT_THROUGH_SHARE),
} as const;

export type LeftBay = {
  present: boolean;
  /** Storage length in ft when the report carries one for this approach's left. */
  storageFt?: number;
  /** True when the bay is drawn at ASSUMED_BAY_FT because no length is known. */
  assumed: boolean;
  /** Why the bay is drawn at all. Absent when not present. "lane-group" =
   *  the import's L group; "storage-record" = the row's governing imported
   *  bay names this approach's left (existingStorageFt / storageMovement);
   *  "protected-phase" = implied by the axis's protected left phase. */
  basis?: "lane-group" | "storage-record" | "protected-phase";
};

export type ApproachBase = {
  vph: Pair<number>;
  vc: Pair<number>;
  delay: Pair<number>;
  los: Pair<Los>;
  queue95Ft: number;
  addedTrips: number;
};

export type ApproachPlan = ApproachBase & {
  direction: Direction;
  /** Through lanes the engine sized this approach with (1 when "default"). */
  throughLanes: number;
  lanesSource: LanesSource;
  leftBay: LeftBay;
  /** The approach's 95th-percentile back-of-queue, in vehicles (ft ÷ 25). */
  queue95Veh: number;
  /** Storage the queue is compared against, when the report carries one. */
  storageFt?: number;
  storageDeficient?: boolean;
  /** "lane-group" = the L group's own storage and the engine's own flag;
   *  "row" = the row-level governing bay (existingStorageFt) against the
   *  row's worst queue, the PDF's storage-bay comparison. */
  storageBasis?: "lane-group" | "row";
  /** The queue `storageDeficient` compared against `storageFt`, ft: the L
   *  group's own queue95thFt ("lane-group") or the row's worst-approach
   *  queue95thFt ("row"). Absent without storage. Not the approach Q95 —
   *  that is `queue95Ft`, which no storage on record compares against. */
  storageQueueFt?: number;
  /** What `storageQueueFt` is, for a label: "left-turn group" or "row worst approach". */
  storageQueueBasis?: "left-turn group" | "row worst approach";
  /** Project trips on this approach by movement, summed from `movements`. */
  addedByMovement: Record<Movement, number>;
  /** Per-movement lane groups: an import's, or the balanced estimate's (the
   *  plan's laneGroupBasis says which). */
  laneGroups?: TisLaneGroupImpact[];
  /** The base row's values when a scenario row was drawn. */
  base?: ApproachBase;
  /** True when any printed base value differs from the scenario's. */
  changed: boolean;
  /** Where this approach's background volume came from (legVolumes: network rows). */
  legSource?: "csv" | "signal_aadt" | "signal_baseline" | "class_default";
};

export type TimingSummary = {
  basis: string;
  source?: string;
  cycleLenSec: number;
  criticalPhases: number;
  gOverC: { ns: number; ew: number; nsLeft?: number; ewLeft?: number };
  leftPhasing: { ns: string; ew: string };
  leftPhasingSource?: string;
  pedMin: { ns?: number; ew?: number };
  criticalFlowRatio?: number;
};

export type Verdict = {
  los: Pair<Los>;
  delay: Pair<number>;
  vc: Pair<number>;
  worstQueueFt: number;
  addedTrips: number;
  severity: string;
  mitigation: string;
  losChanged: boolean;
};

/** What a plan's lane groups were built from: a measured Synchro/UTDF
 *  record's turning movements, or the balanced estimate of the study's leg
 *  volumes (Furness/IPF) under legVolumes: network. */
export type LaneGroupBasis = "measured" | "estimated";

/** The lane-group basis a row's `volumeSource` implies. "network_estimate" /
 *  "link_csv" rows carry the estimate; "utdf_tmc" / "synchro_pdf_tmc" rows
 *  carry a record. The engine prints one of those four on every row that
 *  has lane groups, so an absent label (a report saved before volumeSource
 *  existed, when lane groups came only with a record) reads as measured. */
export function laneGroupBasis(volumeSource: TisAffectedIntersection["volumeSource"] | undefined): LaneGroupBasis {
  return volumeSource === "network_estimate" || volumeSource === "link_csv" ? "estimated" : "measured";
}

export type IntersectionPlan = {
  signalId: string;
  name: string;
  zone: string;
  distanceMi: number;
  /** Present approaches in NB, SB, EB, WB order. */
  approaches: ApproachPlan[];
  /** True when any approach carries lane groups (an import attached, or the
   *  balanced estimate under legVolumes: network — see laneGroupBasis). */
  hasLaneGroups: boolean;
  /** Where those lane groups came from; present only with hasLaneGroups. */
  laneGroupBasis?: LaneGroupBasis;
  timing: TimingSummary | null;
  verdict: Verdict;
  /** Project trips by approach × movement (0 where the table has no row). */
  movements: Record<Direction, Record<Movement, number>>;
  /** Present only when the row printed a movements table. */
  movementSource?: string;
  hasMovements: boolean;
  /** The engine's default background turn split, for the Lanes tab to state. */
  defaultTurnShares: typeof DEFAULT_TURN_SHARES;
  /** Longest queue / storage / assumed bay on any approach, for a shared scale. */
  scaleFt: number;
  /** True when a scenario row was drawn. */
  scenario: boolean;
  base?: { timing: TimingSummary | null; verdict: Verdict };
  /** True when the scenario's timing plan differs from the base's. */
  timingChanged: boolean;
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const num = (v: unknown, fallback = 0): number => (finite(v) ? v : fallback);

function approachBase(a: TisApproachImpact): ApproachBase {
  return {
    vph: { noBuild: num(a.existingVolumeVph), build: num(a.futureVolumeVph) },
    vc: { noBuild: num(a.existingVc), build: num(a.futureVc) },
    delay: { noBuild: num(a.existingDelaySec), build: num(a.futureDelaySec) },
    los: { noBuild: a.existingLos as Los, build: a.futureLos as Los },
    queue95Ft: num(a.queue95thFt),
    addedTrips: num(a.addedTripsPeak),
  };
}

function sameBase(a: ApproachBase, b: ApproachBase): boolean {
  return a.vph.noBuild === b.vph.noBuild && a.vph.build === b.vph.build
    && a.vc.noBuild === b.vc.noBuild && a.vc.build === b.vc.build
    && a.delay.noBuild === b.delay.noBuild && a.delay.build === b.delay.build
    && a.los.noBuild === b.los.noBuild && a.los.build === b.los.build
    && a.queue95Ft === b.queue95Ft && a.addedTrips === b.addedTrips;
}

export function timingSummary(row: TisAffectedIntersection): TimingSummary | null {
  const t = row.signalTiming;
  if (!t) return null;
  return {
    basis: t.basis,
    ...(t.source ? { source: t.source } : {}),
    cycleLenSec: num(t.cycleLenSec),
    criticalPhases: num(t.criticalPhases),
    gOverC: {
      ns: num(t.gOverCns),
      ew: num(t.gOverCew),
      ...(finite(t.gOverCnsLeft) ? { nsLeft: t.gOverCnsLeft } : {}),
      ...(finite(t.gOverCewLeft) ? { ewLeft: t.gOverCewLeft } : {}),
    },
    leftPhasing: { ns: t.leftPhasingNs, ew: t.leftPhasingEw },
    ...(t.leftPhasingSource ? { leftPhasingSource: t.leftPhasingSource } : {}),
    pedMin: {
      ...(finite(t.pedMinGreenNsSec) ? { ns: t.pedMinGreenNsSec } : {}),
      ...(finite(t.pedMinGreenEwSec) ? { ew: t.pedMinGreenEwSec } : {}),
    },
    ...(finite(t.criticalFlowRatio) ? { criticalFlowRatio: t.criticalFlowRatio } : {}),
  };
}

function sameTiming(a: TimingSummary | null, b: TimingSummary | null): boolean {
  if (!a || !b) return a === b;
  return a.basis === b.basis && a.source === b.source && a.cycleLenSec === b.cycleLenSec
    && a.criticalPhases === b.criticalPhases
    && a.gOverC.ns === b.gOverC.ns && a.gOverC.ew === b.gOverC.ew
    && a.gOverC.nsLeft === b.gOverC.nsLeft && a.gOverC.ewLeft === b.gOverC.ewLeft
    && a.leftPhasing.ns === b.leftPhasing.ns && a.leftPhasing.ew === b.leftPhasing.ew;
}

export function verdictFromRow(row: TisAffectedIntersection): Verdict {
  return {
    los: { noBuild: row.existingLos as Los, build: row.futureLos as Los },
    delay: { noBuild: num(row.existingDelaySec), build: num(row.futureDelaySec) },
    vc: { noBuild: num(row.existingVc), build: num(row.futureVc) },
    worstQueueFt: num(row.queue95thFt),
    addedTrips: num(row.addedTripsPmPeak),
    severity: row.mitigationSeverity,
    mitigation: row.mitigation,
    losChanged: !!row.losChanged,
  };
}

/** Project trips by approach × movement from the row's integer table. */
export function movementsByApproach(row: TisAffectedIntersection): Record<Direction, Record<Movement, number>> {
  const out = {} as Record<Direction, Record<Movement, number>>;
  for (const d of DIRECTIONS) out[d] = { L: 0, T: 0, R: 0 };
  for (const m of row.movements ?? []) {
    const cell = out[m.approach as Direction];
    if (cell && (m.movement === "L" || m.movement === "T" || m.movement === "R")) cell[m.movement] += num(m.trips);
  }
  return out;
}

/** The axis a direction travels on. */
export function axisOf(d: Direction): "ns" | "ew" {
  return d === "NB" || d === "SB" ? "ns" : "ew";
}

function approachPlan(
  a: TisApproachImpact,
  row: TisAffectedIntersection,
  movements: Record<Direction, Record<Movement, number>>,
  baseApproach: TisApproachImpact | undefined,
): ApproachPlan {
  const d = a.direction as Direction;
  const lanesKnown = finite(a.throughLanes) && (a.throughLanes as number) > 0 && (a.lanesSource === "import" || a.lanesSource === "osm");
  const throughLanes = lanesKnown ? Math.round(a.throughLanes as number) : 1;
  const lanesSource: LanesSource = lanesKnown ? (a.lanesSource as LanesSource) : "default";

  const laneGroups = Array.isArray(a.laneGroups) && a.laneGroups.length > 0 ? a.laneGroups : undefined;
  const leftGroup = laneGroups?.find((g) => g.movement === "L");
  const t = row.signalTiming;
  const protectedAxis = t ? (axisOf(d) === "ns" ? t.leftPhasingNs === "protected" : t.leftPhasingEw === "protected") : false;

  // Storage for this approach: the L group's own bay first, else the
  // row-level governing bay when it names one of this approach's movements.
  const rowStorageHere = finite(row.existingStorageFt) && (row.existingStorageFt as number) > 0
    && typeof row.storageMovement === "string" && row.storageMovement.startsWith(d);
  const leftStorageFt = leftGroup && finite(leftGroup.storageFt) && (leftGroup.storageFt as number) > 0
    ? (leftGroup.storageFt as number)
    : rowStorageHere && row.storageMovement === `${d}L` ? (row.existingStorageFt as number) : undefined;

  const leftBay: LeftBay = leftGroup
    ? { present: true, ...(leftStorageFt !== undefined ? { storageFt: leftStorageFt } : {}), assumed: leftStorageFt === undefined, basis: "lane-group" }
    : protectedAxis
      ? { present: true, ...(leftStorageFt !== undefined ? { storageFt: leftStorageFt } : {}), assumed: leftStorageFt === undefined, basis: "protected-phase" }
      : leftStorageFt !== undefined
        ? { present: true, storageFt: leftStorageFt, assumed: false, basis: "storage-record" }
        : { present: false, assumed: false };

  const base = approachBase(a);
  const queue95Ft = base.queue95Ft;

  let storageFt: number | undefined;
  let storageDeficient: boolean | undefined;
  let storageBasis: "lane-group" | "row" | undefined;
  let storageQueueFt: number | undefined;
  let storageQueueBasis: ApproachPlan["storageQueueBasis"];
  if (leftGroup && finite(leftGroup.storageFt) && (leftGroup.storageFt as number) > 0) {
    // The engine's own comparison: the L group's queue against the L bay
    // (row-math.ts laneGroupsForApproach `storageDeficient: queue > bay`).
    storageFt = leftGroup.storageFt as number;
    storageQueueFt = num(leftGroup.queue95thFt);
    storageQueueBasis = "left-turn group";
    storageDeficient = typeof leftGroup.storageDeficient === "boolean"
      ? leftGroup.storageDeficient
      : storageQueueFt > storageFt;
    storageBasis = "lane-group";
  } else if (rowStorageHere) {
    // The PDF's comparison (pdf-export.ts §9.2 Storage-Bay Adequacy): the
    // row's existing bay against the row's Q95 Build — its WORST approach
    // queue, not this approach's own.
    storageFt = row.existingStorageFt as number;
    storageQueueFt = num(row.queue95thFt);
    storageQueueBasis = "row worst approach";
    storageDeficient = storageQueueFt > storageFt;
    storageBasis = "row";
  }

  const baseValues = baseApproach ? approachBase(baseApproach) : undefined;
  return {
    direction: d,
    throughLanes,
    lanesSource,
    leftBay,
    ...base,
    queue95Veh: queue95Ft / QUEUE_FT_PER_VEH,
    ...(storageFt !== undefined ? { storageFt, storageDeficient: !!storageDeficient, storageBasis, storageQueueFt, storageQueueBasis } : {}),
    addedByMovement: { ...movements[d] },
    ...(laneGroups ? { laneGroups } : {}),
    ...(baseValues ? { base: baseValues } : {}),
    changed: baseValues ? !sameBase(base, baseValues) : false,
    ...(() => {
      const leg = Array.isArray((row as any).legVolumes) ? (row as any).legVolumes.find((l: any) => l.direction === a.direction) : undefined;
      return leg?.source ? { legSource: leg.source } : {};
    })(),
  };
}

/**
 * The plan for `row`, or for `scenarioRow` with `row` kept as the base.
 * Approaches come out in NB, SB, EB, WB order; a direction the row does not
 * carry is simply absent.
 */
export function planFromRow(row: TisAffectedIntersection, scenarioRow?: TisAffectedIntersection | null): IntersectionPlan {
  const drawn = scenarioRow ?? row;
  const scenario = !!scenarioRow && scenarioRow !== row;
  const movements = movementsByApproach(drawn);
  const byDir = new Map((drawn.approaches ?? []).map((a) => [a.direction as Direction, a]));
  const baseByDir = new Map((row.approaches ?? []).map((a) => [a.direction as Direction, a]));
  const approaches: ApproachPlan[] = [];
  for (const d of DIRECTIONS) {
    const a = byDir.get(d);
    if (!a) continue;
    approaches.push(approachPlan(a, drawn, movements, scenario ? baseByDir.get(d) : undefined));
  }

  const timing = timingSummary(drawn);
  const verdict = verdictFromRow(drawn);
  const baseTiming = scenario ? timingSummary(row) : null;
  const scaleFt = approaches.reduce((m, a) => Math.max(
    m,
    a.queue95Ft,
    a.storageFt ?? 0,
    a.leftBay.present ? (a.leftBay.storageFt ?? ASSUMED_BAY_FT) : 0,
    ...(a.laneGroups ?? []).map((g) => Math.max(num(g.queue95thFt), num(g.storageFt))),
  ), 0);

  return {
    signalId: drawn.signalId,
    name: drawn.name,
    zone: drawn.zone,
    distanceMi: num(drawn.distanceMi),
    approaches,
    hasLaneGroups: approaches.some((a) => !!a.laneGroups),
    ...(approaches.some((a) => !!a.laneGroups) ? { laneGroupBasis: laneGroupBasis(drawn.volumeSource) } : {}),
    timing,
    verdict,
    movements,
    ...(drawn.movementSource ? { movementSource: drawn.movementSource } : {}),
    hasMovements: Array.isArray(drawn.movements) && drawn.movements.length > 0,
    defaultTurnShares: DEFAULT_TURN_SHARES,
    scaleFt,
    scenario,
    ...(scenario ? { base: { timing: baseTiming, verdict: verdictFromRow(row) } } : {}),
    timingChanged: scenario ? !sameTiming(timing, baseTiming) : false,
  };
}

/** Human label for a lane-count provenance. */
export function lanesSourceLabel(s: LanesSource): string {
  switch (s) {
    case "import": return "Synchro import";
    case "osm": return "OSM lanes tag";
    default: return "engine default (1 lane)";
  }
}

/** Human label for a leg-volume provenance. */
export function legSourceLabel(s: NonNullable<ApproachPlan["legSource"]>): string {
  switch (s) {
    case "csv": return "client link count";
    case "signal_aadt": return "signal's counted design hour";
    case "signal_baseline": return "road-class baseline assigned to this signal (no compatible count)";
    default: return "road-class baseline";
  }
}
