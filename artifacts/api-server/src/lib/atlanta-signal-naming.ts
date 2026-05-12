/**
 * Cross-street naming for traffic signals.
 *
 * The raw OSM signals dataset (`atlanta-signals.json`) only carries names for
 * 5 of ~7,393 signals. For the other 99.93% we derive a "Street A & Street B"
 * label by finding the two closest *named* road segments around each signal,
 * using the road network we already ship in `atlanta-roads.json`.
 *
 * Implementation notes:
 *   - We index every named road segment into a coarse lat/lon grid (cell size
 *     ≈500m). For each signal we only scan its cell + 8 neighbors. With ~24K
 *     named ways → ~200K segments → ~3 segments/cell average, every signal
 *     resolves against ~140 candidate segments on average. The whole pass takes well under
 *     a second on cold start and is memoized for the rest of the process
 *     lifetime.
 *   - Distance uses an equirectangular projection (meters) calibrated at the
 *     signal's own latitude. Plenty accurate for sub-kilometer queries inside
 *     metro Atlanta.
 *   - We keep the *closest* segment per distinct road name and pick the two
 *     names with the smallest distance, expanding the search radius in two
 *     stages (80m → 150m). If we still can't find two distinct names we fall
 *     back to one name ("Near Roswell Rd") or null (caller falls back to its
 *     existing coordinate-based label).
 */

import type { RoadNetwork } from "./atlanta-data";

const CELL_DEG = 0.005; // ≈500m at metro Atlanta latitude
const NEAR_RADIUS_M = 80; // first pass: signal "on" the cross
const FAR_RADIUS_M = 150; // fallback: still close enough to be the cross street

type Segment = {
  name: string;
  alat: number;
  alon: number;
  blat: number;
  blon: number;
};

type Grid = Map<number, Segment[]>;

function cellKey(latIdx: number, lonIdx: number): number {
  // Pack two ints into one number. Lat range ~33-34, lon range ~-85 to -83
  // → indices fit comfortably in 16 bits each after offsetting.
  return ((latIdx + 20000) << 16) | (lonIdx + 20000);
}

function buildGrid(road: RoadNetwork): Grid {
  const grid: Grid = new Map();

  for (const w of road.ways) {
    const way = w as unknown[];
    // Way is either [classCode, polyline] (unnamed) or
    // [classCode, name, polyline] (named). Skip unnamed.
    if (way.length !== 3 || typeof way[1] !== "string") continue;
    const name = (way[1] as string).trim();
    if (!name) continue;
    const pts = way[2] as Array<[number, number]>;
    if (!Array.isArray(pts) || pts.length < 2) continue;

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const seg: Segment = { name, alat: a[0], alon: a[1], blat: b[0], blon: b[1] };

      const aLatIdx = Math.floor(a[0] / CELL_DEG);
      const aLonIdx = Math.floor(a[1] / CELL_DEG);
      const bLatIdx = Math.floor(b[0] / CELL_DEG);
      const bLonIdx = Math.floor(b[1] / CELL_DEG);

      // Insert into both endpoints' cells (and any cell between them, in the
      // common case where a segment is short and stays in 1-2 cells).
      const minLat = Math.min(aLatIdx, bLatIdx);
      const maxLat = Math.max(aLatIdx, bLatIdx);
      const minLon = Math.min(aLonIdx, bLonIdx);
      const maxLon = Math.max(aLonIdx, bLonIdx);
      for (let li = minLat; li <= maxLat; li++) {
        for (let lo = minLon; lo <= maxLon; lo++) {
          const key = cellKey(li, lo);
          let bucket = grid.get(key);
          if (!bucket) {
            bucket = [];
            grid.set(key, bucket);
          }
          bucket.push(seg);
        }
      }
    }
  }

  return grid;
}

/**
 * Closest distance (meters) from point (lat, lon) to segment (a→b), using a
 * local equirectangular projection. The projection metres-per-degree
 * coefficients are evaluated at the signal's latitude — plenty accurate for
 * sub-km queries within a single metro area.
 */
function pointToSegmentMeters(
  lat: number,
  lon: number,
  alat: number,
  alon: number,
  blat: number,
  blon: number,
): number {
  const M_PER_DEG_LAT = 111_320;
  const mPerDegLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const px = (lon - alon) * mPerDegLon;
  const py = (lat - alat) * M_PER_DEG_LAT;
  const bx = (blon - alon) * mPerDegLon;
  const by = (blat - alat) * M_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  let t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = px - bx * t;
  const dy = py - by * t;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Build the cross-street name for one signal. Returns "Street A & Street B"
 * when two distinct nearby named roads are found. Returns "Near Street A"
 * when only one is in range. Returns null when there's no named road in
 * either radius — caller is expected to fall back to its coordinate label.
 */
function nameOneSignal(
  grid: Grid,
  lat: number,
  lon: number,
): string | null {
  const latIdx = Math.floor(lat / CELL_DEG);
  const lonIdx = Math.floor(lon / CELL_DEG);

  // Closest distance per distinct road name within the search neighborhood.
  const bestPerName = new Map<string, number>();

  for (let dlat = -1; dlat <= 1; dlat++) {
    for (let dlon = -1; dlon <= 1; dlon++) {
      const bucket = grid.get(cellKey(latIdx + dlat, lonIdx + dlon));
      if (!bucket) continue;
      for (const s of bucket) {
        const d = pointToSegmentMeters(lat, lon, s.alat, s.alon, s.blat, s.blon);
        const prev = bestPerName.get(s.name);
        if (prev === undefined || d < prev) {
          bestPerName.set(s.name, d);
        }
      }
    }
  }

  if (bestPerName.size === 0) return null;

  const ranked = Array.from(bestPerName.entries()).sort((a, b) => a[1] - b[1]);
  const [n1, d1] = ranked[0]!;

  // Pick the second name, skipping anything that's effectively the same road
  // as the first under a loose normalization. OSM has duplicate name records
  // like "US 278;GA 10" vs "US 278; GA 10" (extra space) that would otherwise
  // produce labels like "US 278;GA 10 & US 278; GA 10".
  const norm = (s: string) => s.toLowerCase().replace(/[\s,;./-]+/g, "");
  const n1Norm = norm(n1);
  const second = ranked.slice(1).find(([n]) => norm(n) !== n1Norm);

  if (second && second[1] <= NEAR_RADIUS_M && d1 <= NEAR_RADIUS_M) {
    return `${n1} & ${second[0]}`;
  }
  if (second && second[1] <= FAR_RADIUS_M && d1 <= FAR_RADIUS_M) {
    return `${n1} & ${second[0]}`;
  }
  if (d1 <= FAR_RADIUS_M) {
    return `Near ${n1}`;
  }
  return null;
}

let cachedGrid: Grid | null = null;
let cachedNames: Map<number, string> | null = null;

/**
 * Resolve cross-street names for every signal in `signals`. Returns a map
 * keyed by OSM signal id → display name. Signals without a usable nearby
 * named road are absent from the map (caller falls back).
 *
 * Memoized — the second call is a no-op map return, regardless of which
 * signals array is passed (the dataset is fixed at process start).
 */
export function resolveSignalNames(
  signals: ReadonlyArray<readonly [number, number, number, ...unknown[]]>,
  road: RoadNetwork,
): Map<number, string> {
  if (cachedNames) return cachedNames;
  if (!cachedGrid) cachedGrid = buildGrid(road);
  const out = new Map<number, string>();
  for (const s of signals) {
    const [osmId, lat, lon] = s;
    const name = nameOneSignal(cachedGrid, lat, lon);
    if (name) out.set(osmId, name);
  }
  cachedNames = out;
  return out;
}
