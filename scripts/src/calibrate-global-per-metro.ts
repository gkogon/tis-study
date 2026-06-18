/**
 * Global per-metro synthetic-AADT calibration.
 *
 * Replaces the per-region-group baseline (north_america / europe / east_asia /
 * canada / gulf / south_se_asia / africa / latin_america / oceania) with a
 * city-specific baseline for every metro globally. The synthesis script
 * (precompute-tier10-synthetic-aadt.ts) reads `per-metro-baseline.json` and
 * looks up the baseline by region.code before falling back to the group
 * baseline.
 *
 * Two calibration paths per metro (the more direct, the better the fit):
 *
 *   1. DIRECT — metros with ≥30 measured signals on a class get that class's
 *      median (normalized for lanes + posted speed so the baseline cleanly
 *      factors with the lane/speed multipliers applied at synthesis time).
 *      Direct medians are then (a) clamped to per-class sanity ceilings and
 *      (b) monotonized so motorway ≥ trunk ≥ primary ≥ secondary ≥ tertiary —
 *      this filters federal-highway-source pollution (SICT/HPMS land on OSM
 *      motorway+trunk classes at very high AADT and would otherwise dominate
 *      the medians for those classes).
 *
 *   2. GROUP × MOTORIZATION-SCALAR — fallback for classes with too few
 *      measured signals (or metros with no measured signals at all). The
 *      region-group baseline is scaled by (country motorization / group
 *      reference motorization), clamped to [0.4, 1.6] so unusual ownership
 *      figures (Bangladesh ~5/1000, US 868/1000) don't break the scaler.
 *
 * COUNTRY-ANCHOR was tried and dropped — it transferred Monterrey's federal-
 * highway medians (median trunk 86k) to every Mexican metro that had no
 * measured data, polluting urban-arterial baselines. The right transfer
 * boundary turned out to be "same metro" (direct cal) or "same group"
 * (motorization scalar), not "same country" (mixed source types).
 *
 * Read-only on existing AADT data. Writes
 * artifacts/api-server/src/data/per-metro-baseline.json with one entry per
 * region code:
 *
 *   { regionCode: { method: "direct" | "direct+group_fill" | "group_scaled" | "group",
 *                   provenance: "…",
 *                   baseline: { 0: motorway, 1: trunk, 2: primary, 3: secondary, 4: tertiary },
 *                   measuredN: { 0..4: count of measured signals used } } }
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/calibrate-global-per-metro.ts
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS, type Region } from "../../artifacts/tis-api-server/src/lib/regions";
import { regionGroup, type RegionGroup } from "./region-groups";
import { metroMotorization, GROUP_REFERENCE_MOTORIZATION } from "./country-motorization";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../artifacts/api-server/src/data");
const OUT_PATH = path.resolve(DATA_DIR, "per-metro-baseline.json");

const CELL_DEG = 0.005;
const FAR_RADIUS_M = 150;
const CLASS_NAME = ["motorway", "trunk", "primary", "secondary", "tertiary"];
const SCALAR_MIN = 0.4;
const SCALAR_MAX = 1.6;

// Per-class direct-calibration sample threshold. Higher for motorway/trunk
// because signals are sparse on real motorways (mostly at ramps + transitions),
// so a small sample is dominated by low-volume edge cases. Threshold scales
// down as you go to denser classes — tertiary signals are everywhere, so 30
// is plenty.
const MIN_PER_CLASS: Record<number, number> = {
  0: 100,  // motorway — ramp/transition bias dominates small samples
  1: 50,   // trunk
  2: 30,   // primary
  3: 30,   // secondary
  4: 30,   // tertiary
};

// Per-class sanity ceilings — calibrated to defensible urban-arterial maxima
// across world cities. A direct-cal median above the ceiling almost always
// means the source corpus is federal-highway data (SICT, HPMS) snapped to the
// OSM class, not urban-signal data. The cap preserves the metro's data for
// snap-AADT lookup while preventing its medians from anchoring synthesis at
// federal-highway volumes.
const CLASS_CEILING: Record<number, number> = {
  0: 250_000,  // motorway — busiest urban freeways (LA 405, Tokyo Shuto) top out here
  1: 60_000,   // trunk — heaviest urban-classed trunks ≈50-60k; cap filters federal-highway pollution
  2: 35_000,   // primary — heaviest urban arterials (Reforma, Champs-Élysées)
  3: 22_000,   // secondary — most secondary roads under 20k
  4: 15_000,   // tertiary — most tertiary roads under 12k
};

// Per-class sanity floors — guards against tiny-sample medians on side-streets.
const CLASS_FLOOR: Record<number, number> = {
  0: 8_000, 1: 3_000, 2: 1_500, 3: 800, 4: 400,
};

// Mirror of synth-script reference values (precompute-tier10-synthetic-aadt.ts).
// Used to *normalize out* lane/speed from measured AADT during calibration so
// the per-metro baseline is the "AADT for a typical-width, ~50 km/h road of
// this class in this metro" and synthesis can reapply laneFactor/speedFactor.
const REF_LANES: Record<number, number> = { 0: 6, 1: 4, 2: 4, 3: 2, 4: 2 };
const LANE_EXP = 0.7;
const LANE_FACTOR_MIN = 0.45;
const LANE_FACTOR_MAX = 2.2;

function laneFactor(lanes: number | null, classCode: number): number {
  if (lanes == null || lanes <= 0) return 1.0;
  const ref = REF_LANES[classCode] ?? 2;
  const f = Math.pow(lanes / ref, LANE_EXP);
  return Math.max(LANE_FACTOR_MIN, Math.min(LANE_FACTOR_MAX, f));
}
function speedFactor(maxspeed: number | null): number {
  if (maxspeed == null) return 1.0;
  if (maxspeed <= 30) return 0.9;
  if (maxspeed <= 50) return 1.0;
  if (maxspeed <= 70) return 1.08;
  if (maxspeed <= 90) return 1.12;
  return 1.15;
}

// Region-group baseline (the existing per-group BASE_AADT, kept in sync with
// precompute-tier10-synthetic-aadt.ts). Used as final fallback.
const BASE_AADT: Record<RegionGroup, Record<number, number>> = {
  north_america: { 0: 60_000, 1: 30_000, 2: 15_000, 3: 8_000,  4: 4_000 },
  canada:        { 0: 60_000, 1: 31_000, 2: 17_500, 3: 15_500, 4: 21_900 },
  europe:        { 0: 50_000, 1: 18_000, 2: 8_000,  3: 6_000,  4: 4_500 },
  east_asia:     { 0: 60_000, 1: 32_000, 2: 22_000, 3: 13_500, 4: 10_000 },
  gulf:          { 0: 65_000, 1: 32_000, 2: 16_000, 3: 9_000,  4: 5_000 },
  south_se_asia: { 0: 45_000, 1: 24_000, 2: 14_000, 3: 8_000,  4: 4_500 },
  africa:        { 0: 35_000, 1: 18_000, 2: 10_000, 3: 6_000,  4: 3_500 },
  latin_america: { 0: 50_000, 1: 26_000, 2: 13_000, 3: 8_000,  4: 4_500 },
  oceania:       { 0: 55_000, 1: 28_000, 2: 12_000, 3: 7_000,  4: 4_000 },
};

// ---------------- Spatial join helpers ----------------

type Segment = {
  classCode: number; lanes: number | null; maxspeed: number | null;
  alat: number; alon: number; blat: number; blon: number;
};
type Grid = Map<number, Segment[]>;
type RoadNetwork = { classes: string[]; ways: unknown[] };

const cellKey = (a: number, b: number) => ((a + 20000) << 16) | (b + 20000);

function buildGrid(road: RoadNetwork): Grid {
  const grid: Grid = new Map();
  for (const w of road.ways) {
    const way = w as unknown[];
    if (way.length < 3) continue;
    const classCode = typeof way[0] === "number" ? (way[0] as number) : 99;
    if (classCode > 4) continue;
    const pts = way[2] as Array<[number, number]>;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const lanes = typeof way[3] === "number" ? (way[3] as number) : null;
    const maxspeed = typeof way[4] === "number" ? (way[4] as number) : null;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      const seg: Segment = { classCode, lanes, maxspeed, alat: a[0], alon: a[1], blat: b[0], blon: b[1] };
      const lk = Math.floor((a[0] + b[0]) / 2 / CELL_DEG);
      const lo = Math.floor((a[1] + b[1]) / 2 / CELL_DEG);
      for (let dl = -1; dl <= 1; dl++) for (let dn = -1; dn <= 1; dn++) {
        const k = cellKey(lk + dl, lo + dn);
        (grid.get(k) ?? grid.set(k, []).get(k)!).push(seg);
      }
    }
  }
  return grid;
}

function distToSeg(lat: number, lon: number, s: Segment): number {
  const mLat = 111_320, mLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const px = (lon - s.alon) * mLon, py = (lat - s.alat) * mLat;
  const dx = (s.blon - s.alon) * mLon, dy = (s.blat - s.alat) * mLat;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px, py);
  let t = (px * dx + py * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(t * dx - px, t * dy - py);
}

function nearest(grid: Grid, lat: number, lon: number): Segment | null {
  const segs = grid.get(cellKey(Math.floor(lat / CELL_DEG), Math.floor(lon / CELL_DEG)));
  if (!segs) return null;
  let best: Segment | null = null, bestKey = Infinity;
  for (const s of segs) {
    const d = distToSeg(lat, lon, s);
    if (d > FAR_RADIUS_M) continue;
    const key = s.classCode * 1000 + d;
    if (key < bestKey) { bestKey = key; best = s; }
  }
  return best;
}

const median = (a: number[]) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : NaN;

// ---------------- Direct calibration ----------------

const regionSlug = (code: string) => code.replace(/_metro$/, "").replace(/_/g, "-");

type AadtRec = { aadt: number; source: string };

type DirectCal = {
  /** Per-class normalized median AADT (only classes with ≥ MIN_PER_CLASS samples). */
  perClass: Record<number, number>;
  /** Sample count per class. */
  n: Record<number, number>;
  /** Total measured signals successfully joined to any class. */
  measuredJoined: number;
};

function directCalibrate(region: Region): DirectCal | null {
  const slug = regionSlug(region.code);
  const sigPath = path.resolve(DATA_DIR, `${slug}-signals.json`);
  const roadPath = path.resolve(DATA_DIR, `${slug}-roads.json`);
  const aadtPath = path.resolve(DATA_DIR, `${slug}-aadt.json`);
  if (!existsSync(sigPath) || !existsSync(roadPath) || !existsSync(aadtPath)) return null;
  let signals: Array<[number, number, number]>;
  let road: RoadNetwork;
  let aadt: Record<string, AadtRec>;
  try {
    signals = JSON.parse(readFileSync(sigPath, "utf8"));
    road = JSON.parse(readFileSync(roadPath, "utf8"));
    aadt = JSON.parse(readFileSync(aadtPath, "utf8"));
  } catch {
    return null;
  }
  const coords = new Map<number, [number, number]>();
  for (const sig of signals) coords.set(sig[0], [sig[1], sig[2]]);
  const grid = buildGrid(road);

  const buckets: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [] };
  for (const [id, rec] of Object.entries(aadt)) {
    if (!rec || rec.source === "synthetic_osm_class" || typeof rec.source !== "string") continue;
    if (rec.aadt == null || rec.aadt <= 0) continue;
    const c = coords.get(Number(id));
    if (!c) continue;
    const seg = nearest(grid, c[0], c[1]);
    if (!seg) continue;
    // Normalize: divide measured AADT by lane/speed factor so the per-class
    // baseline is the "AADT for a REF_LANES-lane, ~50 km/h road of this class".
    const lf = laneFactor(seg.lanes, seg.classCode);
    const sf = speedFactor(seg.maxspeed);
    const norm = rec.aadt / (lf * sf);
    buckets[seg.classCode]!.push(norm);
  }
  const perClass: Record<number, number> = {};
  const n: Record<number, number> = {};
  let totalJoined = 0;
  for (let c = 0; c <= 4; c++) {
    const v = buckets[c]!;
    n[c] = v.length;
    totalJoined += v.length;
    if (v.length >= MIN_PER_CLASS[c]!) perClass[c] = Math.round(median(v));
  }
  if (totalJoined === 0) return null;
  return { perClass, n, measuredJoined: totalJoined };
}

// ---------------- Sanity + monotonicity ----------------

function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }

/**
 * Apply per-class sanity ceiling/floor and motorway ≥ trunk ≥ primary ≥
 * secondary ≥ tertiary monotonicity. Operates on a fully-populated baseline.
 *
 * Why monotonicity: OSM road classification is hierarchy-coherent — a road
 * tagged "trunk" should carry no more traffic than a co-located "motorway"
 * in the same metro. Direct-cal medians sometimes violate this because of
 * source bias (federal-highway sources land on trunk, urban-signal sources
 * land on primary, no overlap), so a pool-adjacent-violators smoothing
 * restores the hierarchy without losing the city-specific magnitude.
 */
function sanitize(baseline: Record<number, number>): Record<number, number> {
  const out: Record<number, number> = {};
  for (let c = 0; c <= 4; c++) {
    out[c] = clamp(baseline[c]!, CLASS_FLOOR[c]!, CLASS_CEILING[c]!);
  }
  // Pool-adjacent-violators (PAV) for non-increasing 0 → 4.
  // If any class violates monotonicity, pool with its neighbor (downstream)
  // and take the max — pulls up the lower class to match the higher one.
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (let c = 0; c < 4; c++) {
      if (out[c]! < out[c + 1]!) {
        const pooled = Math.max(out[c]!, out[c + 1]!);
        out[c] = pooled;
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Re-clamp after monotonicity (the PAV pass can push trunk/primary up to
  // a motorway pooled value that exceeds the trunk ceiling).
  for (let c = 0; c <= 4; c++) out[c] = clamp(out[c]!, CLASS_FLOOR[c]!, CLASS_CEILING[c]!);
  // PAV again because re-clamp may break monotonicity (e.g., if motorway capped at
  // 250k but trunk capped at 60k, trunk now < primary if primary capped at 35k).
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (let c = 0; c < 4; c++) {
      if (out[c]! < out[c + 1]!) {
        out[c] = out[c + 1]!;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

// ---------------- Final baseline per metro ----------------

type BaselineEntry = {
  method: "direct" | "direct+group_fill" | "group_scaled" | "group";
  provenance: string;
  baseline: Record<number, number>;
  measuredN: Record<number, number>;
};

function buildBaseline(region: Region, direct: DirectCal | null): BaselineEntry {
  const group = regionGroup(region.country);
  const groupBase = BASE_AADT[group];

  const motorization = metroMotorization(region.code, region.country);
  const groupRef = GROUP_REFERENCE_MOTORIZATION[group] ?? 600;
  const groupScalar = motorization != null
    ? clamp(motorization / groupRef, SCALAR_MIN, SCALAR_MAX)
    : 1.0;

  const rawBaseline: Record<number, number> = {};
  const measuredN: Record<number, number> = direct?.n ?? { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };

  let directHits = 0;
  let groupHits = 0;
  for (let c = 0; c <= 4; c++) {
    if (direct && direct.perClass[c] != null) {
      rawBaseline[c] = direct.perClass[c]!;
      directHits++;
    } else {
      rawBaseline[c] = Math.round(groupBase[c]! * groupScalar);
      groupHits++;
    }
  }

  // Sanity + monotonicity — applies to mixed direct+group baselines too,
  // so federal-highway-polluted direct medians get caught and group-fill
  // values get pulled into the same monotone hierarchy.
  const baseline = sanitize(rawBaseline);

  let method: BaselineEntry["method"];
  let provenance: string;
  if (directHits === 5) {
    method = "direct";
    provenance = `direct calibration: n=${measuredN[0]}/${measuredN[1]}/${measuredN[2]}/${measuredN[3]}/${measuredN[4]} per class`;
  } else if (directHits > 0) {
    method = "direct+group_fill";
    provenance = `direct calibration on ${directHits} classes; ${groupHits} thin-sample classes filled from ${group} × ${groupScalar.toFixed(2)} motorization scalar`;
  } else if (motorization != null && groupScalar !== 1.0) {
    method = "group_scaled";
    provenance = `${group} baseline × ${groupScalar.toFixed(2)} (country motorization ${motorization}/1000 vs ${group} reference ${groupRef}/1000)`;
  } else {
    method = "group";
    provenance = `${group} baseline (no measured signals, no motorization data)`;
  }
  return { method, provenance, baseline, measuredN };
}

// ---------------- Main ----------------

function main(): void {
  console.log(`Direct-calibrating ${Object.values(REGIONS).length} regions…`);
  const directs = new Map<string, DirectCal>();
  let withDirect = 0;
  for (const region of Object.values(REGIONS)) {
    const d = directCalibrate(region);
    if (d && d.measuredJoined > 0) {
      directs.set(region.code, d);
      withDirect++;
    }
  }
  console.log(`  ${withDirect} regions have at least 1 measured signal joined to a major-road class`);

  console.log(`Building final per-metro baselines (sanitized + monotonized)…`);
  const out: Record<string, BaselineEntry> = {};
  const counts: Record<string, number> = { direct: 0, "direct+group_fill": 0, group_scaled: 0, group: 0 };
  for (const region of Object.values(REGIONS)) {
    const direct = directs.get(region.code) ?? null;
    const entry = buildBaseline(region, direct);
    out[region.code] = entry;
    counts[entry.method] = (counts[entry.method] ?? 0) + 1;
  }

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${Object.keys(out).length} per-metro baselines to per-metro-baseline.json`);
  console.log(`Method breakdown:`);
  for (const [m, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    if (n > 0) console.log(`  ${m.padEnd(22)} ${n}`);
  }

  // Spot-check sample
  console.log(`\nSample baselines:`);
  const samples = [
    "atlanta_metro", "new_york_metro", "los_angeles_metro",
    "toronto_metro", "vancouver_metro",
    "paris_metro", "london_metro", "berlin_metro", "madrid_metro",
    "tokyo_metro", "osaka_metro",
    "mexico_city_metro", "mumbai_metro", "lagos_metro", "sao_paulo_metro",
    "marseille_metro", "rome_metro", "milan_metro", "munich_metro",
    "singapore_metro", "hong_kong_metro", "dubai_metro",
  ];
  for (const code of samples) {
    const e = out[code];
    if (!e) continue;
    const b = e.baseline;
    console.log(`  ${code.padEnd(25)} [${e.method.padEnd(20)}] ${String(b[0]).padStart(6)} / ${String(b[1]).padStart(6)} / ${String(b[2]).padStart(6)} / ${String(b[3]).padStart(6)} / ${String(b[4]).padStart(6)}`);
  }
}

main();
