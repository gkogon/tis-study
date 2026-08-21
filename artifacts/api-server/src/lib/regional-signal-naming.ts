/**
 * Region-aware cross-street naming for signals in non-Atlanta regions.
 *
 * Algorithm mirrors atlanta-signal-naming.ts (grid-bucketed nearest-segment
 * lookup, 80m → 150m fallback radii, distinct-name deduping). The difference
 * is the cache: keyed per region, so a process serving multiple metros doesn't
 * stomp on itself when a Charlotte call lands after a Tampa call.
 *
 * Why a separate file: the Atlanta path is feature-rich and stable. Mixing
 * the per-region cache logic into atlanta-signal-naming.ts risks regressing
 * a well-tuned hot path for the sake of avoiding ~150 lines of duplication.
 * When a future refactor consolidates the data layer, this can be merged.
 */

import { readDataJson } from "./data-files";

const CELL_DEG = 0.005;
const NEAR_RADIUS_M = 80;
const FAR_RADIUS_M = 150;

type Segment = {
  name: string;
  /** OSM highway class code: 0=motorway, 1=trunk, 2=primary, 3=secondary, 4=tertiary */
  classCode: number;
  alat: number; alon: number; blat: number; blon: number;
};
type Grid = Map<number, Segment[]>;

type RoadNetwork = { classes: string[]; ways: unknown[] };

/**
 * Per-signal naming result. `roadClassCode` is the *most-major* (lowest-code)
 * road segment found within FAR_RADIUS_M of the signal — used by callers to
 * pick a sensible volume baseline. -1 when no named road is in range.
 */
export type SignalNamingResult = {
  name: string;
  roadClassCode: number;
};

function cellKey(latIdx: number, lonIdx: number): number {
  return ((latIdx + 20000) << 16) | (lonIdx + 20000);
}

function buildGrid(road: RoadNetwork): Grid {
  const grid: Grid = new Map();
  for (const w of road.ways) {
    const way = w as unknown[];
    if (way.length < 3 || typeof way[1] !== "string") continue;
    const classCode = typeof way[0] === "number" ? (way[0] as number) : 99;
    const name = (way[1] as string).trim();
    if (!name) continue;
    const pts = way[2] as Array<[number, number]>;
    if (!Array.isArray(pts) || pts.length < 2) continue;

    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const seg: Segment = { name, classCode, alat: a[0], alon: a[1], blat: b[0], blon: b[1] };
      const aLatIdx = Math.floor(a[0] / CELL_DEG);
      const aLonIdx = Math.floor(a[1] / CELL_DEG);
      const bLatIdx = Math.floor(b[0] / CELL_DEG);
      const bLonIdx = Math.floor(b[1] / CELL_DEG);
      const minLat = Math.min(aLatIdx, bLatIdx);
      const maxLat = Math.max(aLatIdx, bLatIdx);
      const minLon = Math.min(aLonIdx, bLonIdx);
      const maxLon = Math.max(aLonIdx, bLonIdx);
      for (let li = minLat; li <= maxLat; li++) {
        for (let lo = minLon; lo <= maxLon; lo++) {
          const key = cellKey(li, lo);
          let bucket = grid.get(key);
          if (!bucket) { bucket = []; grid.set(key, bucket); }
          bucket.push(seg);
        }
      }
    }
  }
  return grid;
}

function pointToSegmentMeters(
  lat: number, lon: number,
  alat: number, alon: number, blat: number, blon: number,
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
 * Resolve the cross-street label AND the most-major road class for one signal.
 * Returns null when no named road is in range; caller falls back to "Signal #<id>"
 * and a default volume baseline.
 */
function analyzeOneSignal(grid: Grid, lat: number, lon: number): SignalNamingResult | null {
  const latIdx = Math.floor(lat / CELL_DEG);
  const lonIdx = Math.floor(lon / CELL_DEG);
  // Per-name: closest distance + class of the closest segment carrying that name
  const bestPerName = new Map<string, { distance: number; classCode: number }>();
  // Most-major class observed within FAR_RADIUS_M (lower code = bigger road).
  let bestClass = 99;
  let bestClassDist = Infinity;

  for (let dlat = -1; dlat <= 1; dlat++) {
    for (let dlon = -1; dlon <= 1; dlon++) {
      const bucket = grid.get(cellKey(latIdx + dlat, lonIdx + dlon));
      if (!bucket) continue;
      for (const s of bucket) {
        const d = pointToSegmentMeters(lat, lon, s.alat, s.alon, s.blat, s.blon);
        const prev = bestPerName.get(s.name);
        if (prev === undefined || d < prev.distance) {
          bestPerName.set(s.name, { distance: d, classCode: s.classCode });
        }
        // Track the most-major road class within FAR_RADIUS_M as the signal's class.
        // Tie-break on distance so we don't pick a far-away motorway over a nearby trunk.
        if (d <= FAR_RADIUS_M && (s.classCode < bestClass || (s.classCode === bestClass && d < bestClassDist))) {
          bestClass = s.classCode;
          bestClassDist = d;
        }
      }
    }
  }

  if (bestPerName.size === 0) return null;
  const ranked = Array.from(bestPerName.entries()).sort((a, b) => a[1].distance - b[1].distance);
  const [n1, { distance: d1 }] = ranked[0]!;
  const norm = (s: string) => s.toLowerCase().replace(/[\s,;./-]+/g, "");
  const n1Norm = norm(n1);
  const second = ranked.slice(1).find(([n]) => norm(n) !== n1Norm);
  const roadClassCode = bestClass === 99 ? -1 : bestClass;

  let name: string | null = null;
  if (second && second[1].distance <= NEAR_RADIUS_M && d1 <= NEAR_RADIUS_M) name = `${n1} & ${second[0]}`;
  else if (second && second[1].distance <= FAR_RADIUS_M && d1 <= FAR_RADIUS_M) name = `${n1} & ${second[0]}`;
  else if (d1 <= FAR_RADIUS_M) name = `Near ${n1}`;
  if (!name) return null;
  return { name, roadClassCode };
}

// ---------- Per-region cache + data loading ----------
// Path resolution + gzip-aware reads live in data-files.ts (shared with
// regional-roads.ts and atlanta-data.ts): `<slug>-roads.json.gz` is
// preferred over `<slug>-roads.json`, so post-refetch gz-only regions keep
// their signal names instead of silently falling back to "Signal #<osmId>".

function regionCodeToSlug(regionCode: string): string {
  return regionCode.replace(/_metro$/, "").replace(/_/g, "-");
}

const gridCache = new Map<string, Grid>();
const nameCache = new Map<string, Map<number, SignalNamingResult>>();

/** Return signal-id → {name, roadClassCode} map for a region, lazily built. */
export function getSignalNamesForRegion(regionCode: string): Map<number, SignalNamingResult> {
  const cached = nameCache.get(regionCode);
  if (cached) return cached;

  const slug = regionCodeToSlug(regionCode);

  // Roads dataset may not exist yet for some regions; in that case we return
  // an empty map and the caller falls back to "Signal #<osmId>".
  let road: RoadNetwork;
  try {
    road = readDataJson<RoadNetwork>(`${slug}-roads.json`);
  } catch {
    const empty = new Map<number, SignalNamingResult>();
    nameCache.set(regionCode, empty);
    return empty;
  }

  let grid = gridCache.get(regionCode);
  if (!grid) {
    grid = buildGrid(road);
    gridCache.set(regionCode, grid);
  }

  const signals = readDataJson<Array<[number, number, number, string | null, number]>>(
    `${slug}-signals.json`,
  );

  const out = new Map<number, SignalNamingResult>();
  for (const [osmId, lat, lon] of signals) {
    // Negative IDs indicate city-authoritative signals (e.g. Charlotte CDOT
    // overlays) — those carry their own canonical name in the embedded slot,
    // so the roads-based naming pass is wasted work for them.
    if (osmId < 0) continue;
    const result = analyzeOneSignal(grid, lat, lon);
    if (result) out.set(osmId, result);
  }
  nameCache.set(regionCode, out);
  return out;
}

/** Reset caches — used by tests. */
export function _clearNamingCache(): void {
  gridCache.clear();
  nameCache.clear();
}
