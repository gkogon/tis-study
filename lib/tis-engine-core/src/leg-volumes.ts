/**
 * Leg volumes and turning-movement estimation.
 *
 * WHY. A study intersection has received ONE background volume — the design
 * hour (AADT × K) of the count nearest the signal, i.e. the main road's —
 * split across the four approaches by a seeded ±15% jitter on a 30/25/25/20
 * base (row-math.ts approachVolumeShares), then 15/70/15 within each
 * approach for the diagrams and 10/80/10 for the protected-left inference.
 * The minor street was carrying a quarter of the main road's volume no
 * matter what it carries; the main-road approaches were carrying 25–30% of
 * a design hour that is really ~50% per direction.
 *
 * WHAT. Three modes, one resolver:
 *   network   (default) main-road legs = the signal's counted design hour,
 *             half per direction; other legs = the road-class baseline the
 *             analyzer itself falls back to (VOLUME_BY_CLASS), half per
 *             direction, labeled class_default; a client link count (CSV)
 *             overrides either on its leg.
 *   screening today's shares — the engine simply does not consult this
 *             module (row-math), so the row is byte-identical.
 * Movements are then BALANCED against the exit legs by iterative
 * proportional fitting (Furness) from a geometry seed — the method behind
 * NCHRP 255 / NCHRP 765 project-level refinement — so Σin = Σout holds at
 * the node and a reviewer can check it by hand.
 *
 * DATA REALITY. The AADT join is per signal (one nearest count, class-gated),
 * not per segment; `totalVolume` is already vph. So "network" is honest
 * about what is counted (the main road) and what is a baseline (the rest),
 * and every leg carries its source. Both quantities are TWO-WAY roadway
 * counts (the design hour of a two-way AADT; the class ladder is a two-way
 * baseline), and OSM maps a divided arterial as a PAIR of one-way
 * carriageways (every McKnight Road way is `oneway`). A one-way leg
 * therefore carries HALF of the two-way quantity in its physical direction
 * and 0 the other way — the same per-direction share a two-way leg gets —
 * never the whole two-way count, which would double the through approach at
 * every divided arterial. Known limitation: a true one-way COUPLET street
 * (two parallel one-way streets a block apart, each carrying the whole
 * direction) is understated by ~2× under this rule; twin-carriageway
 * detection (pairing the two carriageways of one road) is a follow-up.
 *
 * Pure: no I/O, no DB, no clock. Spec:
 * docs/superpowers/specs/2026-09-16-leg-volumes-and-movement-estimation-design.md
 */
import type { Direction, Movement } from "./webster-timing.ts";

export type LegSource = "csv" | "signal_aadt" | "class_default";

/** One incident link at a junction, as the routing graph knows it. */
export type JunctionLeg = {
  /** Compass bearing (deg, 0 = north, clockwise) from the node to the link's far end. */
  bearingDeg: number;
  /** OSM class code 0 (motorway) … 4 (tertiary); lower = higher class. */
  cls: number;
  /** "in": travel only toward the node; "out": only away; null: two-way. */
  oneWay: "in" | "out" | null;
};

export type LegVolume = {
  dir: Direction;
  /** Toward the junction (the approach volume). */
  enteringVph: number;
  /** Away from the junction; null = unknown. */
  exitingVph: number | null;
  oneWay: "in" | "out" | null;
  source: LegSource;
  cls: number;
};

/** null on a side with no leg (a T-intersection). */
export type LegVolumes = Record<Direction, LegVolume | null>;

/**
 * Two-way design-hour baseline by OSM class code — the analyzer's
 * VOLUME_BY_CLASS ladder (artifacts/api-server/src/lib/regional-intersections.ts),
 * mirrored here so an uncounted minor leg gets the same number the analyzer
 * would have given a signal on that road. Half per direction.
 */
export const MINOR_LEG_DESIGN_HOUR_VPH_BY_CLASS: Record<number, number> = {
  0: 2500, // motorway
  1: 2000, // trunk
  2: 1500, // primary
  3: 1000, // secondary
  4: 700,  // tertiary
};
const DEFAULT_MINOR_LEG_VPH = 1000;

export const DIRS: Direction[] = ["NB", "SB", "EB", "WB"];

/**
 * Bearing from the node to where each approach's traffic COMES FROM. An
 * approach is named by its direction of travel: NB traffic arrives from the
 * south leg (180°). Mirrors row-math APPROACH_ORIGIN_BEARING.
 */
export const ORIGIN_BEARING: Record<Direction, number> = { NB: 180, SB: 0, EB: 270, WB: 90 };
const DIR_AT_ORIGIN: Record<number, Direction> = { 0: "SB", 90: "WB", 180: "NB", 270: "EB" };

/** The approach whose leg a movement from `from` exits through (spec §4.3).
 * From the spec's formula — approach origin bearing β: through exits via
 * the leg at β+180°, left via β+90°, right via β−90° — mapped to the
 * approach whose ORIGIN_BEARING is that leg. An eastbound driver (from the
 * west, β = 270°) turning left heads north: the north leg is SB's origin.
 */
export const EXIT_LEG: Record<Direction, Record<Movement, Direction>> = {
  NB: { T: "SB", L: "EB", R: "WB" },
  SB: { T: "NB", L: "WB", R: "EB" },
  EB: { T: "WB", L: "SB", R: "NB" },
  WB: { T: "EB", L: "NB", R: "SB" },
};

/**
 * Quantize each incident link to the nearest cardinal and name the approach
 * that arrives along it. Two links on one cardinal (a skewed five-leg): keep
 * the higher class (lower cls; tie → first seen) and count the other as
 * dropped — a 4×4 matrix cannot carry a fifth leg and pretending otherwise
 * would fabricate a movement.
 */
export function assignLegsToApproaches(legs: JunctionLeg[]): {
  byDir: Partial<Record<Direction, JunctionLeg>>;
  dropped: number;
} {
  const byDir: Partial<Record<Direction, JunctionLeg>> = {};
  let dropped = 0;
  for (const leg of legs) {
    if (!Number.isFinite(leg.bearingDeg)) { dropped++; continue; }
    const b = ((leg.bearingDeg % 360) + 360) % 360;
    const cardinal = (Math.round(b / 90) * 90) % 360;
    const dir = DIR_AT_ORIGIN[cardinal]!;
    const cur = byDir[dir];
    if (!cur) { byDir[dir] = leg; continue; }
    dropped++;
    if (leg.cls < cur.cls) byDir[dir] = leg;
  }
  return { byDir, dropped };
}

export type LegVolumeInputs = {
  /** The signal's design hour (vph) — AnalyzerIntersection.totalVolume (AADT × K, or the analyzer's class baseline). */
  signalDesignHourVph: number;
  /** Client link counts already snapped to this junction's legs. Empty until the CSV importer ships. */
  csv?: Partial<Record<Direction, { enteringVph?: number; exitingVph?: number }>>;
};

const pos = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const angDiff = (a: number, b: number): number => { const d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };

/**
 * Split a two-way volume onto one leg's two directions, honoring one-way.
 * `twoWayVph` is a two-way roadway count, so each direction is half of it;
 * a one-way leg is one carriageway of that road and carries its half in its
 * physical direction and 0 the other way (see DATA REALITY above — a couplet
 * street is understated by this rule, a divided arterial is not doubled).
 */
function splitLeg(twoWayVph: number, oneWay: "in" | "out" | null): { entering: number; exiting: number } {
  const perDirection = twoWayVph / 2;
  if (oneWay === "in") return { entering: perDirection, exiting: 0 };
  if (oneWay === "out") return { entering: 0, exiting: perDirection };
  return { entering: perDirection, exiting: perDirection };
}

/**
 * Which two legs are the main road: the two highest-class legs (lowest cls);
 * among more than two tied at the best class, the pair closest to opposite
 * (a through road), so a same-class stem never displaces a through leg.
 */
export function mainRoadLegs(byDir: Partial<Record<Direction, JunctionLeg>>): Direction[] {
  const present = DIRS.filter((d) => byDir[d]);
  if (present.length <= 2) return present;
  const best = Math.min(...present.map((d) => byDir[d]!.cls));
  const tied = present.filter((d) => byDir[d]!.cls === best);
  if (tied.length <= 2) {
    if (tied.length === 2) return tied;
    // One best leg: pair it with the closest-to-opposite among the rest, preferring class.
    const a = tied[0]!;
    const rest = present.filter((d) => d !== a).sort((x, y) =>
      (byDir[x]!.cls - byDir[y]!.cls) || (angDiff(byDir[a]!.bearingDeg, byDir[y]!.bearingDeg) - angDiff(byDir[a]!.bearingDeg, byDir[x]!.bearingDeg)));
    return [a, rest[0]!];
  }
  let bestPair: Direction[] = [tied[0]!, tied[1]!];
  let bestOpp = -1;
  for (let i = 0; i < tied.length; i++) for (let j = i + 1; j < tied.length; j++) {
    const opp = angDiff(byDir[tied[i]!]!.bearingDeg, byDir[tied[j]!]!.bearingDeg);
    if (opp > bestOpp) { bestOpp = opp; bestPair = [tied[i]!, tied[j]!]; }
  }
  return bestPair;
}

/**
 * Per-leg entering / exiting volume with a source label (spec §4.2, amended
 * for per-signal data): csv → signal design hour on the main road → class
 * baseline on the rest. Absent legs are null. Never NaN.
 */
export function resolveLegVolumes(
  byDir: Partial<Record<Direction, JunctionLeg>>,
  inputs: LegVolumeInputs,
): LegVolumes {
  const out: LegVolumes = { NB: null, SB: null, EB: null, WB: null };
  const main = new Set(mainRoadLegs(byDir));
  const designHour = pos(inputs.signalDesignHourVph);
  for (const d of DIRS) {
    const leg = byDir[d];
    if (!leg) continue;
    const isMain = main.has(d);
    const twoWay = isMain ? designHour : (MINOR_LEG_DESIGN_HOUR_VPH_BY_CLASS[leg.cls] ?? DEFAULT_MINOR_LEG_VPH);
    const base = splitLeg(twoWay, leg.oneWay);
    const baseSource: LegSource = isMain ? "signal_aadt" : "class_default";
    const csv = inputs.csv?.[d];
    const csvIn = csv && typeof csv.enteringVph === "number" && Number.isFinite(csv.enteringVph) && csv.enteringVph >= 0 ? csv.enteringVph : undefined;
    const csvOut = csv && typeof csv.exitingVph === "number" && Number.isFinite(csv.exitingVph) && csv.exitingVph >= 0 ? csv.exitingVph : undefined;
    // A client count overlays the baseline per direction. enteringVph is the
    // capacity input and must be a number, so an exit-only count leaves the
    // entering side on the baseline (and the leg's source describes that
    // entering volume); an entering-only count leaves the exit UNKNOWN (null)
    // rather than inventing one from a baseline the client did not measure.
    out[d] = {
      dir: d,
      enteringVph: csvIn ?? base.entering,
      exitingVph: csvOut ?? (csvIn !== undefined ? null : base.exiting),
      oneWay: leg.oneWay,
      source: csvIn !== undefined ? "csv" : baseSource,
      cls: leg.cls,
    };
  }
  return out;
}

export const IPF_TOLERANCE_VPH = 0.5;
export const IPF_MAX_ITER = 50;
export const EXIT_IMBALANCE_NORMALIZE_PCT = 0.05;

/** Four-leg prior — today's 15/70/15, now only a seed. */
const SEED_SHARE: Record<Movement, number> = { L: 0.15, T: 0.70, R: 0.15 };
/** Through-road approach at a T (one turn possible): 85/15. */
const SEED_T_THROUGH = 0.85;

export type MovementEstimate = {
  /** matrix[from][to] in vph — `to` is the approach whose leg the movement exits through. Diagonal always 0. */
  matrix: Record<Direction, Record<Direction, number>>;
  /** Per-approach L/T/R shares, Σ = 1 (finite even on a zero or absent approach). */
  shares: Record<Direction, Record<Movement, number>>;
  leftVph: Record<Direction, number>;
  /** Each leg's entering volume over the total, Σ = 1; 0 on absent legs. */
  enteringShares: Record<Direction, number>;
  totalEnteringVph: number;
  diagnostics: {
    method: "ipf" | "seed_only";
    iterations: number;
    maxResidualVph: number;
    imbalancePct: number;
    exitsNormalized: boolean;
    constrainedExits: number;
  };
};

const zeroMatrix = (): Record<Direction, Record<Direction, number>> => ({
  NB: { NB: 0, SB: 0, EB: 0, WB: 0 }, SB: { NB: 0, SB: 0, EB: 0, WB: 0 },
  EB: { NB: 0, SB: 0, EB: 0, WB: 0 }, WB: { NB: 0, SB: 0, EB: 0, WB: 0 },
});

/** Seed shares for one approach, respecting which exits physically exist. */
function seedRow(from: Direction, legs: LegVolumes): Record<Movement, number> {
  const fromLeg = legs[from];
  const can = (m: Movement): boolean => {
    const to = legs[EXIT_LEG[from][m]];
    return !!fromLeg && fromLeg.oneWay !== "out" && !!to && to.oneWay !== "in";
  };
  const avail: Movement[] = (["L", "T", "R"] as const).filter(can);
  const w: Record<Movement, number> = { L: 0, T: 0, R: 0 };
  if (avail.length === 0) return w;
  if (avail.length === 3) { w.L = SEED_SHARE.L; w.T = SEED_SHARE.T; w.R = SEED_SHARE.R; return w; }
  if (!avail.includes("T")) { for (const m of avail) w[m] = 1 / avail.length; return w; }   // a stem: L/R only
  w.T = avail.length === 1 ? 1 : SEED_T_THROUGH;                                              // through road at a T
  for (const m of avail) if (m !== "T") w[m] = (1 - w.T) / (avail.length - 1);
  return w;
}

/**
 * Balance the movements against the legs (spec §4.3): seed by geometry, then
 * Furness/IPF — rows to entering, constrained columns to exiting — until the
 * largest residual is ≤ 0.5 vph or 50 iterations. Never NaN.
 */
export function estimateMovements(legs: LegVolumes): MovementEstimate {
  const entering: Record<Direction, number> = { NB: 0, SB: 0, EB: 0, WB: 0 };
  const exiting: Record<Direction, number | null> = { NB: null, SB: null, EB: null, WB: null };
  for (const d of DIRS) {
    const l = legs[d];
    if (!l) continue;
    entering[d] = pos(l.enteringVph);
    exiting[d] = l.exitingVph === null ? null : pos(l.exitingVph);
  }
  const totalEnteringVph = DIRS.reduce((s, d) => s + entering[d], 0);

  // Seed matrix in vph.
  const seedShares: Record<Direction, Record<Movement, number>> = { NB: seedRow("NB", legs), SB: seedRow("SB", legs), EB: seedRow("EB", legs), WB: seedRow("WB", legs) };
  const m = zeroMatrix();
  for (const from of DIRS) for (const mv of ["L", "T", "R"] as const) m[from][EXIT_LEG[from][mv]] = entering[from] * seedShares[from][mv];

  // Column targets: only legs with a known exit volume constrain.
  const present = DIRS.filter((d) => legs[d]);
  const constrained = present.filter((d) => exiting[d] !== null);
  const sumExit = constrained.reduce((s, d) => s + (exiting[d] as number), 0);
  const allConstrained = constrained.length === present.length && present.length > 0;
  const imbalancePct = allConstrained && totalEnteringVph > 0 ? Math.abs(sumExit - totalEnteringVph) / totalEnteringVph : 0;
  let exitsNormalized = false;
  const target: Record<Direction, number | null> = { ...exiting };
  if (allConstrained && imbalancePct > EXIT_IMBALANCE_NORMALIZE_PCT && sumExit > 0) {
    const k = totalEnteringVph / sumExit;
    for (const d of constrained) target[d] = (exiting[d] as number) * k;
    exitsNormalized = true;
  }

  let iterations = 0;
  let maxResidualVph = 0;
  const residual = (): number => {
    let r = 0;
    for (const d of DIRS) r = Math.max(r, Math.abs(DIRS.reduce((s, t) => s + m[d][t], 0) - entering[d]));
    for (const t of constrained) r = Math.max(r, Math.abs(DIRS.reduce((s, d) => s + m[d][t], 0) - (target[t] as number)));
    return r;
  };
  if (constrained.length > 0) {
    for (iterations = 1; iterations <= IPF_MAX_ITER; iterations++) {
      for (const d of DIRS) {
        const rs = DIRS.reduce((s, t) => s + m[d][t], 0);
        if (rs > 0) { const k = entering[d] / rs; for (const t of DIRS) m[d][t] *= k; }
      }
      for (const t of constrained) {
        const cs = DIRS.reduce((s, d) => s + m[d][t], 0);
        if (cs > 0) { const k = (target[t] as number) / cs; for (const d of DIRS) m[d][t] *= k; }
      }
      maxResidualVph = residual();
      if (maxResidualVph <= IPF_TOLERANCE_VPH) break;
    }
    if (iterations > IPF_MAX_ITER) iterations = IPF_MAX_ITER;
    // Rows are what capacity consumes: land on them exactly after the last column pass.
    for (const d of DIRS) {
      const rs = DIRS.reduce((s, t) => s + m[d][t], 0);
      if (rs > 0) { const k = entering[d] / rs; for (const t of DIRS) m[d][t] *= k; }
    }
    maxResidualVph = residual();
  }

  const shares: Record<Direction, Record<Movement, number>> = { NB: { L: 0, T: 0, R: 0 }, SB: { L: 0, T: 0, R: 0 }, EB: { L: 0, T: 0, R: 0 }, WB: { L: 0, T: 0, R: 0 } };
  const leftVph: Record<Direction, number> = { NB: 0, SB: 0, EB: 0, WB: 0 };
  const enteringShares: Record<Direction, number> = { NB: 0, SB: 0, EB: 0, WB: 0 };
  for (const from of DIRS) {
    const rs = DIRS.reduce((s, t) => s + m[from][t], 0);
    const seedSum = seedShares[from].L + seedShares[from].T + seedShares[from].R;
    for (const mv of ["L", "T", "R"] as const) {
      shares[from][mv] = rs > 0
        ? m[from][EXIT_LEG[from][mv]] / rs
        : seedSum > 0 ? seedShares[from][mv] / seedSum : SEED_SHARE[mv];   // zero/absent approach: finite prior
    }
    leftVph[from] = m[from][EXIT_LEG[from].L];
    enteringShares[from] = totalEnteringVph > 0 ? entering[from] / totalEnteringVph : 0;
  }
  for (const d of DIRS) for (const t of DIRS) if (!Number.isFinite(m[d][t])) m[d][t] = 0;

  return {
    matrix: m, shares, leftVph, enteringShares, totalEnteringVph,
    diagnostics: { method: constrained.length > 0 ? "ipf" : "seed_only", iterations, maxResidualVph, imbalancePct, exitsNormalized, constrainedExits: constrained.length },
  };
}

/** One call for the server: legs → estimate, or undefined when nothing is present. */
export type LegEstimate = { legs: LegVolumes; movements: MovementEstimate; legsDropped: number; anyCsv: boolean };
export function buildLegEstimate(junctionLegs: JunctionLeg[], inputs: LegVolumeInputs): LegEstimate | undefined {
  const { byDir, dropped } = assignLegsToApproaches(junctionLegs);
  if (DIRS.every((d) => !byDir[d])) return undefined;
  const legs = resolveLegVolumes(byDir, inputs);
  const movements = estimateMovements(legs);
  const anyCsv = DIRS.some((d) => legs[d]?.source === "csv");
  return { legs, movements, legsDropped: dropped, anyCsv };
}
