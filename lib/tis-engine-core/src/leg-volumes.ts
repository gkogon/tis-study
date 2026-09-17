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
 * and every leg carries its source.
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

/** Split a two-way volume onto one leg's two directions, honoring one-way. */
function splitLeg(twoWayVph: number, oneWay: "in" | "out" | null): { entering: number; exiting: number } {
  if (oneWay === "in") return { entering: twoWayVph, exiting: 0 };
  if (oneWay === "out") return { entering: 0, exiting: twoWayVph };
  return { entering: twoWayVph / 2, exiting: twoWayVph / 2 };
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
    const csv = inputs.csv?.[d];
    const csvIn = csv && typeof csv.enteringVph === "number" && Number.isFinite(csv.enteringVph) && csv.enteringVph >= 0 ? csv.enteringVph : undefined;
    const csvOut = csv && typeof csv.exitingVph === "number" && Number.isFinite(csv.exitingVph) && csv.exitingVph >= 0 ? csv.exitingVph : undefined;
    if (csvIn !== undefined || csvOut !== undefined) {
      // A count on this leg. Whichever direction the client did not count
      // stays unknown (null) rather than being filled from a baseline — the
      // worksheet says "csv" for this leg and must not mix sources inside it.
      out[d] = { dir: d, enteringVph: csvIn ?? 0, exitingVph: csvOut ?? null, oneWay: leg.oneWay, source: "csv", cls: leg.cls };
      continue;
    }
    const twoWay = main.has(d) ? designHour : (MINOR_LEG_DESIGN_HOUR_VPH_BY_CLASS[leg.cls] ?? DEFAULT_MINOR_LEG_VPH);
    const { entering, exiting } = splitLeg(twoWay, leg.oneWay);
    out[d] = { dir: d, enteringVph: entering, exitingVph: exiting, oneWay: leg.oneWay, source: main.has(d) ? "signal_aadt" : "class_default", cls: leg.cls };
  }
  return out;
}
