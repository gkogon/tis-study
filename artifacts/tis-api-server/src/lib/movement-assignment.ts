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
 * Assign a study intersection's added project trips to turning movements.
 *
 * @param bearingIntersectionToSite  degrees from north, intersection → site
 * @param octantSharesPct            directional distribution (NNE…NNW, Σ≈100)
 * @param addedTrips                 exact (fractional) project trips at this
 *                                   intersection for the analyzed peak
 * @param inFraction                 share of trips inbound to the site (0..1)
 */
export function assignMovements(
  bearingIntersectionToSite: number,
  octantSharesPct: Record<string, number>,
  addedTrips: number,
  inFraction: number,
): MovementLoad[] {
  const total = Math.round(addedTrips);
  if (!(addedTrips > 0) || total <= 0) return [];

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

  // Largest-remainder integer allocation so the movement trips cross-foot with
  // the intersection's reported added-trip count exactly.
  const rows = [...loads.values()].sort((a, b) => b.exact - a.exact);
  const floors = rows.map((r) => Math.floor(r.exact * (total / addedTrips)));
  let assigned = floors.reduce((s, v) => s + v, 0);
  const remainders = rows
    .map((r, i) => ({ i, rem: r.exact * (total / addedTrips) - floors[i]! }))
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
