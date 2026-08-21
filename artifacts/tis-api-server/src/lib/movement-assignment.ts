// Turning-movement assignment of project trips — pure-geometry leaf module.
//
// Answers "which movements does the project load at this intersection?"
// (NB-Left / NB-Thru / NB-Right …) at screening level, WITHOUT turning-movement
// counts: every project trip through a study intersection travels between the
// site and a destination/origin zone, so its movement at the intersection is
// determined by the entry travel direction and the exit leg:
//
//   outbound  site → intersection → zone:  enters traveling away from the site
//             (on the leg that faces the site) and exits toward the zone's
//             compass octant;
//   inbound   zone → intersection → site:  enters traveling from the zone's
//             octant and exits on the leg toward the site.
//
// Zone octants come from the study's directional trip distribution
// (byDirection, Σ=100). Zones "behind" the intersection (site side) are
// down-weighted by cosine alignment — a trip only passes through this
// intersection when its zone lies beyond it along the site→intersection axis.
//
// This assignment is the single source of truth for project loading at a study
// intersection: the printed Affected-movements table uses the integer view
// (assignMovements) and the per-approach capacity math in buildAffectedRow
// uses the exact fractional view aggregated by entering approach
// (approachAddedTripsFromMovements), so the two always reconcile.
//
// Dependency-free so the movement geometry can be regression-tested with plain
// node (no logger/db imports), like signal-delay.ts and intersection-coverage.ts.

export type MovementDirection = "NB" | "SB" | "EB" | "WB";
export type Movement = "L" | "T" | "R";

export type MovementLoad = {
  /** Entering approach, named by travel direction (HCM convention). */
  approach: MovementDirection;
  movement: Movement;
  /** Integer project trips on this movement for the analyzed peak. Largest-
   *  remainder allocation, so Σ trips === round(addedTrips) exactly. */
  trips: number;
};

export type MovementLoadExact = {
  /** Entering approach, named by travel direction (HCM convention). */
  approach: MovementDirection;
  movement: Movement;
  /** Exact (fractional) project trips on this movement — Σ === addedTrips.
   *  Carried unrounded so sub-1-trip junction loads (high-PTAL London sites)
   *  still perturb the capacity math instead of collapsing to zero. */
  exact: number;
};

// Octant centers matching caltran-gravity's bearingToCardinal (floor(b/45)):
// NNE = [0°,45°) → center 22.5°, and so on around the compass.
const OCTANT_CENTER_DEG: Record<string, number> = {
  NNE: 22.5, ENE: 67.5, ESE: 112.5, SSE: 157.5,
  SSW: 202.5, WSW: 247.5, WNW: 292.5, NNW: 337.5,
};

// Travel direction quantized to the four cardinal legs.
function cardinal4(bearing: number): number {
  return (Math.round(((bearing % 360) + 360) % 360 / 90) % 4) * 90;
}

const TRAVEL_DIR_NAME: Record<number, MovementDirection> = {
  0: "NB", 90: "EB", 180: "SB", 270: "WB",
};

// Movement from entry travel direction → exit travel direction (right-hand
// traffic): +0° through, +90° right, +270° left. U-turns (+180°) are folded
// into the left-turn movement per standard screening practice.
function classify(enterDir: number, exitDir: number): Movement {
  const delta = ((exitDir - enterDir) % 360 + 360) % 360;
  if (delta === 0) return "T";
  if (delta === 90) return "R";
  return "L"; // 270 = left, 180 = U-turn folded into left
}

/**
 * Exact (fractional) movement loads for a study intersection's added project
 * trips. Same geometry as `assignMovements`, but ungated on the rounded trip
 * count and unrounded: this is what the per-approach capacity math consumes,
 * so a junction receiving < 0.5 trips still carries its fractional load.
 *
 * @param bearingIntersectionToSite  degrees from north, intersection → site
 * @param octantSharesPct            directional distribution (NNE…NNW, Σ≈100)
 * @param addedTrips                 exact (fractional) project trips at this
 *                                   intersection for the analyzed peak
 * @param inFraction                 share of trips inbound to the site (0..1)
 */
export function assignMovementLoadsExact(
  bearingIntersectionToSite: number,
  octantSharesPct: Record<string, number>,
  addedTrips: number,
  inFraction: number,
): MovementLoadExact[] {
  if (!(addedTrips > 0)) return [];

  // Direction from the site toward (and past) this intersection — the compass
  // side whose zones route through it.
  const beyondBearing = (bearingIntersectionToSite + 180) % 360;

  // Cosine-aligned zone weights: only octants beyond the intersection carry
  // weight; an octant at 90° off-axis contributes nothing.
  let weightSum = 0;
  const zoneWeights: Array<{ centerDeg: number; w: number }> = [];
  for (const [name, centerDeg] of Object.entries(OCTANT_CENTER_DEG)) {
    const share = Math.max(0, Number(octantSharesPct[name]) || 0);
    const diff = (((centerDeg - beyondBearing) % 360) + 540) % 360 - 180;
    const w = share * Math.max(0, Math.cos((diff * Math.PI) / 180));
    if (w > 0) {
      zoneWeights.push({ centerDeg, w });
      weightSum += w;
    }
  }
  // Degenerate distribution (all weight behind the intersection): fall back to
  // straight-through along the site axis, which is what a purely distance-
  // decayed load implies.
  if (weightSum <= 0) {
    zoneWeights.length = 0;
    zoneWeights.push({ centerDeg: beyondBearing, w: 1 });
    weightSum = 1;
  }

  const siteLegDir = cardinal4(bearingIntersectionToSite); // exit dir toward site
  const outboundEnterDir = cardinal4(beyondBearing);       // entering from the site

  const inShare = Math.min(1, Math.max(0, inFraction));
  const loads = new Map<string, { approach: MovementDirection; movement: Movement; exact: number }>();
  const add = (enterDir: number, exitDir: number, trips: number) => {
    if (trips <= 0) return;
    const approach = TRAVEL_DIR_NAME[enterDir]!;
    const movement = classify(enterDir, exitDir);
    const key = `${approach}-${movement}`;
    const cur = loads.get(key);
    if (cur) cur.exact += trips;
    else loads.set(key, { approach, movement, exact: trips });
  };

  for (const z of zoneWeights) {
    const zoneFrac = z.w / weightSum;
    // Outbound: enter from the site leg, exit toward the zone octant.
    add(outboundEnterDir, cardinal4(z.centerDeg), addedTrips * (1 - inShare) * zoneFrac);
    // Inbound: enter traveling from the zone octant, exit on the site leg.
    add(cardinal4(z.centerDeg + 180), siteLegDir, addedTrips * inShare * zoneFrac);
  }

  return [...loads.values()]
    .map((r) => ({ approach: r.approach, movement: r.movement, exact: r.exact }))
    .sort((a, b) => b.exact - a.exact);
}

/**
 * Exact added project trips per approach row, aggregated from the geometric
 * movement assignment by ENTERING approach: inbound trips load the approach
 * they enter the intersection on (from their origin octant); outbound trips
 * enter on the site-facing leg traveling away from the site and load that
 * travel-direction row. Every trip is counted exactly once, so the four
 * loads sum to `addedTrips` and — after the integer allocation — reconcile
 * with the Affected-movements table approach-by-approach.
 */
export function approachAddedTripsFromMovements(
  bearingIntersectionToSite: number,
  octantSharesPct: Record<string, number>,
  addedTrips: number,
  inFraction: number,
): Record<MovementDirection, number> {
  const byApproach: Record<MovementDirection, number> = { NB: 0, SB: 0, EB: 0, WB: 0 };
  for (const l of assignMovementLoadsExact(bearingIntersectionToSite, octantSharesPct, addedTrips, inFraction)) {
    byApproach[l.approach] += l.exact;
  }
  return byApproach;
}

/**
 * Assign a study intersection's added project trips to turning movements.
 * Integer view of `assignMovementLoadsExact` for the printed Affected-
 * movements table; parameters as there.
 */
export function assignMovements(
  bearingIntersectionToSite: number,
  octantSharesPct: Record<string, number>,
  addedTrips: number,
  inFraction: number,
): MovementLoad[] {
  const total = Math.round(addedTrips);
  if (!(addedTrips > 0) || total <= 0) return [];

  // Largest-remainder integer allocation so the movement trips cross-foot with
  // the intersection's reported added-trip count exactly.
  const rows = assignMovementLoadsExact(
    bearingIntersectionToSite,
    octantSharesPct,
    addedTrips,
    inFraction,
  );
  return integerizeMovementLoads(rows, addedTrips, total);
}

/**
 * Largest-remainder integerization of exact movement loads against a target
 * total. Extracted from `assignMovements` so path-derived rows (conserved
 * assignment) integerize through the SAME arithmetic as octant rows — two
 * allocators would eventually disagree by ±1 and break the printed cross-foot.
 * `assignMovements` delegates here; its output is unchanged.
 */
export function integerizeMovementLoads(
  rows: MovementLoadExact[],
  exactTotal: number,
  total: number = Math.round(exactTotal),
): MovementLoad[] {
  if (!(exactTotal > 0) || total <= 0 || rows.length === 0) return [];
  const floors = rows.map((r) => Math.floor(r.exact * (total / exactTotal)));
  let assigned = floors.reduce((s, v) => s + v, 0);
  const remainders = rows
    .map((r, i) => ({ i, rem: r.exact * (total / exactTotal) - floors[i]! }))
    .sort((a, b) => b.rem - a.rem);
  for (const { i } of remainders) {
    if (assigned >= total) break;
    floors[i]! += 1;
    assigned += 1;
  }

  return rows
    .map((r, i) => ({ approach: r.approach, movement: r.movement, trips: floors[i]! }))
    .filter((r) => r.trips > 0)
    .sort((a, b) => b.trips - a.trips);
}

/**
 * One geometric turn observed on the routed network, in SHARE units (fraction
 * of total project demand making this turn at this junction, site→cordon
 * direction). Direction-agnostic: the in/out split is applied later, per
 * period, because inFraction differs between AM and PM.
 */
export type PathTurnShare = {
  /** Compass bearing of travel INTO the junction (deg from north). */
  enterBearingDeg: number;
  /** Compass bearing of travel OUT of the junction. */
  exitBearingDeg: number;
  /** Fraction of project demand making this turn, 0..1. */
  share: number;
};

/**
 * Exact movement loads from path-derived turns — the conserved-assignment
 * counterpart of `assignMovementLoadsExact`.
 *
 * The ledger's turns are recorded in the OUTBOUND (site→cordon) direction.
 * Outbound trips make the turn as recorded, weighted (1 − inFraction).
 *
 * Inbound trips come in two flavours:
 *  - `turnsInbound` ABSENT (all-two-way graphs): the reverse of every
 *    outbound path is legal, so inbound is the mirror — enter on the reverse
 *    of the recorded exit leg, leave on the reverse of the recorded entry
 *    leg, weighted inFraction. Bit-for-bit the historical behaviour.
 *  - `turnsInbound` PRESENT (the routing graph carries one-way links): the
 *    mirror could imply wrong-way travel on a one-way pair, so the router
 *    recorded the true return paths on the transposed graph. Those turns are
 *    applied AS RECORDED (they are already in travel-toward-site
 *    orientation), weighted inFraction — no mirroring. An empty array is
 *    meaningful: the routed inbound paths genuinely do not pass this node
 *    (on a one-way pair the return street is a different street).
 *
 * Both ledgers stay in share units; inFraction is applied HERE, per period,
 * because it differs between AM and PM. Same quantization (cardinal4) and
 * movement rule (classify — U folded into L) as the octant path,
 * deliberately: the two sources must agree about what "NB Left" means or the
 * report contradicts itself between intersections with different
 * movementSource.
 */
export function pathMovementLoadsExact(
  turns: PathTurnShare[],
  tripsScale: number,
  inFraction: number,
  turnsInbound?: PathTurnShare[],
): MovementLoadExact[] {
  const agg = new Map<string, MovementLoadExact>();
  const add = (enterDir: number, exitDir: number, exact: number) => {
    if (!(exact > 0)) return;
    const approach = TRAVEL_DIR_NAME[enterDir]!;
    const movement = classify(enterDir, exitDir);
    const k = `${approach}-${movement}`;
    const row = agg.get(k);
    if (row) row.exact += exact;
    else agg.set(k, { approach, movement, exact });
  };
  for (const t of turns) {
    const enter4 = cardinal4(t.enterBearingDeg);
    const exit4 = cardinal4(t.exitBearingDeg);
    // Outbound: as recorded.
    add(enter4, exit4, t.share * tripsScale * (1 - inFraction));
    // Inbound mirror: reverse path, reverse legs — ONLY when no recorded
    // inbound ledger exists (all-two-way graphs, where the mirror is legal).
    if (turnsInbound === undefined) {
      add((exit4 + 180) % 360, (enter4 + 180) % 360, t.share * tripsScale * inFraction);
    }
  }
  // Recorded inbound turns: already in travel orientation, applied as-is.
  for (const t of turnsInbound ?? []) {
    add(cardinal4(t.enterBearingDeg), cardinal4(t.exitBearingDeg), t.share * tripsScale * inFraction);
  }
  return [...agg.values()].sort(
    (a, b) => b.exact - a.exact || a.approach.localeCompare(b.approach) || a.movement.localeCompare(b.movement),
  );
}
