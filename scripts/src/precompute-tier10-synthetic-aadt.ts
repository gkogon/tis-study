/**
 * Generate synthetic AADT for each Tier-10 (osm_only) metro.
 *
 * For every signal, spatial-joins to the nearest named major-road segment and
 * assigns a baseline AADT from a PER-REGION-GROUP, per-class table, then
 * modulates by the segment's lane count and posted speed:
 *
 *   aadt = BASE[group][class] · laneFactor(lanes, class) · speedFactor(maxspeed)
 *
 * Why per-group: a single global per-class constant was ~3.5x wrong between
 * regions — measured medians run ~6.5k in European cities vs ~23k in Japanese
 * ones. Groups are motorization regimes (see region-groups.ts), not continents,
 * so high-motorization Gulf states aren't lumped with dense South Asia.
 * north_america/europe/east_asia baselines are anchored to measured AADT
 * (calibrate-synthetic-aadt.ts); the other five are scaled estimates.
 *
 * Why lane/speed modulation: per-class constants ignored the dominant error —
 * within a class, real AADT spans an order of magnitude. A road's lane count
 * (and, secondarily, posted speed) is the cheapest OSM signal that tracks that
 * spread, so a 6-lane primary no longer reads the same as a 2-lane one.
 *
 * Writes `<slug>-aadt.json` with `source: "synthetic_osm_class"`. The runtime
 * AADT loader treats it like measured DOT-snapped AADT; the UI labels these
 * metros `aadtQuality: "synthetic"` so modeled volumes aren't mistaken for
 * measured counts. Each entry carries `distM` for far-snap downweighting and a
 * per-group `kFactor`.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/precompute-tier10-synthetic-aadt.ts
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS, type Region } from "../../artifacts/tis-api-server/src/lib/regions";
import { regionGroup, type RegionGroup } from "./region-groups";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

const CELL_DEG = 0.005;
const FAR_RADIUS_M = 150;

// Per-group, per-class AADT baseline (vehicles/day, annual average), anchored at
// each class's TYPICAL lane count (REF_LANES) so laneFactor is ~1.0 for a normal
// road and only deviates for atypically wide/narrow ones. Class codes:
//   0 motorway · 1 trunk · 2 primary · 3 secondary · 4 tertiary
// CALIBRATED (2026-06-01) from measured city counts: north_america (US DOT),
// europe (Paris/Madrid/Berlin), east_asia (Tokyo/Osaka). ESTIMATE for the rest.
const BASE_AADT: Record<RegionGroup, Record<number, number>> = {
  // CALIBRATED from measured median AADT at signalized intersections, by the
  // class each signal snaps to (calibrate-synthetic-aadt.ts). Motorway is kept
  // high because signals almost never snap to a true motorway mainline — when
  // one does it's a ramp/interchange, and the rare case shouldn't be lowballed.
  north_america: { 0: 60_000, 1: 30_000, 2: 15_000, 3: 8_000, 4: 4_000 },   // CALIBRATED (legacy US DOT baseline)
  europe:        { 0: 50_000, 1: 18_000, 2: 8_000,  3: 6_000,  4: 4_500 },  // CALIBRATED — Paris/Madrid/Berlin (n≈9.9k)
  east_asia:     { 0: 60_000, 1: 32_000, 2: 22_000, 3: 13_500, 4: 10_000 }, // CALIBRATED — Tokyo/Osaka (n≈15.7k)
  gulf:          { 0: 65_000, 1: 32_000, 2: 16_000, 3: 9_000,  4: 5_000 },  // ESTIMATE (high motorization)
  south_se_asia: { 0: 45_000, 1: 24_000, 2: 14_000, 3: 8_000,  4: 4_500 },  // ESTIMATE (congested arterials)
  africa:        { 0: 35_000, 1: 18_000, 2: 10_000, 3: 6_000,  4: 3_500 },  // ESTIMATE (sparse, low motorization)
  latin_america: { 0: 50_000, 1: 26_000, 2: 13_000, 3: 8_000,  4: 4_500 },  // ESTIMATE (mid, dense cities)
  oceania:       { 0: 55_000, 1: 28_000, 2: 12_000, 3: 7_000,  4: 4_000 },  // ESTIMATE (car-dependent, low density)
};

// Peak-hour factor (K, % of AADT in the design hour). US/FHWA ≈ 9%; flatter,
// longer peaks in dense/developing networks → slightly lower K.
const K_FACTOR_BY_GROUP: Record<RegionGroup, number> = {
  north_america: 9, europe: 10, east_asia: 10, gulf: 9,
  south_se_asia: 8, africa: 8, latin_america: 9, oceania: 9,
};

// Typical (reference) OSM lane count per class — lanes is total both directions.
// laneFactor = (lanes / REF_LANES[class]) ^ LANE_EXP, clamped. Sub-linear because
// volume per lane falls as lanes are added. null lanes → factor 1.0 (use base).
const REF_LANES: Record<number, number> = { 0: 6, 1: 4, 2: 4, 3: 2, 4: 2 };
const LANE_EXP = 0.7;       // literature default (capacity ~linear in lanes, volume/lane sublinear);
                            // empirical fit pending lane re-fetch of the measured metros.
const LANE_FACTOR_MIN = 0.45;
const LANE_FACTOR_MAX = 2.2;

function laneFactor(lanes: number | null, classCode: number): number {
  if (lanes == null || lanes <= 0) return 1.0;
  const ref = REF_LANES[classCode] ?? 2;
  const f = Math.pow(lanes / ref, LANE_EXP);
  return Math.max(LANE_FACTOR_MIN, Math.min(LANE_FACTOR_MAX, f));
}

// Posted speed is a weak, sparse secondary signal — keep the effect gentle.
function speedFactor(maxspeed: number | null): number {
  if (maxspeed == null) return 1.0;
  if (maxspeed <= 30) return 0.9;
  if (maxspeed <= 50) return 1.0;
  if (maxspeed <= 70) return 1.08;
  if (maxspeed <= 90) return 1.12;
  return 1.15;
}

type Segment = {
  classCode: number; lanes: number | null; maxspeed: number | null;
  alat: number; alon: number; blat: number; blon: number;
};
type Grid = Map<number, Segment[]>;
type RoadNetwork = { classes: string[]; ways: unknown[] };

function cellKey(latIdx: number, lonIdx: number): number {
  return ((latIdx + 20000) << 16) | (lonIdx + 20000);
}

function buildGrid(road: RoadNetwork): Grid {
  const grid: Grid = new Map();
  for (const w of road.ways) {
    const way = w as unknown[];
    if (way.length < 3) continue; // tolerate legacy length-3 and length-5 (lanes/maxspeed) tuples
    const classCode = typeof way[0] === "number" ? (way[0] as number) : 99;
    if (!(classCode in BASE_AADT.north_america)) continue; // major roads only (0..4)
    const pts = way[2] as Array<[number, number]>;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const lanes = typeof way[3] === "number" ? (way[3] as number) : null;
    const maxspeed = typeof way[4] === "number" ? (way[4] as number) : null;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const seg: Segment = { classCode, lanes, maxspeed, alat: a[0], alon: a[1], blat: b[0], blon: b[1] };
      const midLat = (a[0] + b[0]) / 2;
      const midLon = (a[1] + b[1]) / 2;
      const lk = Math.floor(midLat / CELL_DEG);
      const lo = Math.floor(midLon / CELL_DEG);
      for (let dl = -1; dl <= 1; dl++) {
        for (let dn = -1; dn <= 1; dn++) {
          const k = cellKey(lk + dl, lo + dn);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k)!.push(seg);
        }
      }
    }
  }
  return grid;
}

function distToSegMeters(lat: number, lon: number, s: Segment): number {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const px = (lon - s.alon) * mLon;
  const py = (lat - s.alat) * mLat;
  const dx = (s.blon - s.alon) * mLon;
  const dy = (s.blat - s.alat) * mLat;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.sqrt(px * px + py * py);
  let t = (px * dx + py * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = t * dx - px;
  const cy = t * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
}

function nearestSegment(grid: Grid, lat: number, lon: number): { seg: Segment; distM: number } | null {
  const lk = Math.floor(lat / CELL_DEG);
  const lo = Math.floor(lon / CELL_DEG);
  const segs = grid.get(cellKey(lk, lo));
  if (!segs) return null;
  let best: { seg: Segment; distM: number } | null = null;
  for (const s of segs) {
    const d = distToSegMeters(lat, lon, s);
    if (d > FAR_RADIUS_M) continue;
    // Prefer most-major (lowest classCode) within range; tiebreak by distance.
    if (best === null || s.classCode < best.seg.classCode || (s.classCode === best.seg.classCode && d < best.distM)) {
      best = { seg: s, distM: Math.round(d) };
    }
  }
  return best;
}

function regionSlug(code: string): string {
  return code.replace(/_metro$/, "").replace(/_/g, "-");
}

type AadtRec = { aadt: number; year: number; kFactor: number; distM: number; source: string };

function generateForRegion(region: Region): { total: number; snapped: number; snapPct: number; measured: number } | null {
  const slug = regionSlug(region.code);
  const sigPath = path.resolve(DATA_DIR, `${slug}-signals.json`);
  const roadPath = path.resolve(DATA_DIR, `${slug}-roads.json`);
  if (!existsSync(sigPath) || !existsSync(roadPath)) return null;
  let signals: Array<[number, number, number, string | null, number]>;
  let road: RoadNetwork;
  try {
    signals = JSON.parse(readFileSync(sigPath, "utf8"));
    road = JSON.parse(readFileSync(roadPath, "utf8"));
  } catch {
    return null;
  }
  if (!Array.isArray(signals) || signals.length === 0) return { total: 0, snapped: 0, snapPct: 0, measured: 0 };

  const group = regionGroup(region.country);
  const base = BASE_AADT[group];
  const kFactor = K_FACTOR_BY_GROUP[group];

  const grid = buildGrid(road);
  const out: Record<string, AadtRec> = {};
  let snapped = 0;
  for (const [osmId, lat, lon] of signals) {
    if (osmId < 0) continue; // city-authoritative signals — skip
    const hit = nearestSegment(grid, lat, lon);
    if (!hit) continue;
    const baseAadt = base[hit.seg.classCode] ?? base[4]!;
    const aadt = Math.round(baseAadt * laneFactor(hit.seg.lanes, hit.seg.classCode) * speedFactor(hit.seg.maxspeed));
    out[String(osmId)] = {
      aadt,
      year: 2024,
      kFactor,
      distM: hit.distM,
      source: "synthetic_osm_class",
    };
    snapped++;
  }

  const outPath = path.resolve(DATA_DIR, `${slug}-aadt.json`);

  // Non-destructive, order-stable merge: never clobber a measured overlay.
  // Some osm_only metros (paris, tokyo, osaka, berlin, madrid) carry a partial
  // measured AADT layer in this same file under a non-synthetic `source`. Those
  // measured counts are the credibility hook in cold outreach, so a measured
  // entry must always survive a synthetic pass. Walk the existing file in its
  // own key order — keep every measured entry verbatim, refresh each still-
  // snapped synthetic entry in place, drop synthetics that no longer snap —
  // then append newly-snapped synthetic signals.
  let merged: Record<string, AadtRec> = out;
  let measured = 0;
  if (existsSync(outPath)) {
    try {
      const existing = JSON.parse(readFileSync(outPath, "utf8")) as Record<string, AadtRec>;
      merged = {};
      for (const [id, rec] of Object.entries(existing)) {
        if (rec && rec.source !== "synthetic_osm_class") {
          merged[id] = rec;
          measured++;
        } else if (out[id]) {
          merged[id] = out[id];
        }
      }
      for (const id of Object.keys(out)) {
        if (!(id in merged)) merged[id] = out[id];
      }
    } catch {
      merged = out; // Unreadable existing file: write fresh synthetic.
    }
  }

  writeFileSync(outPath, JSON.stringify(merged));
  return {
    total: signals.length,
    snapped,
    snapPct: Math.round((snapped / signals.length) * 1000) / 10,
    measured,
  };
}

function updateCoverage(coverage: string, regionCode: string, snapPct: number): { text: string; changed: boolean } {
  // Update aadtPct + add aadtSource if missing + add aadtQuality discriminator.
  const pattern = new RegExp(
    `(\\{ code: "${regionCode}",[^}]*?aadtPct:\\s*)([0-9.]+)(,\\s*liveSource:\\s*null,)(\\s*dotName:)`,
  );
  if (!pattern.test(coverage)) return { text: coverage, changed: false };
  const aadtFields = `aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic",`;
  const next = coverage.replace(pattern, `$1${snapPct}$3 ${aadtFields}$4`);
  return { text: next, changed: next !== coverage };
}

function main(): void {
  const tier10 = Object.values(REGIONS).filter((r) => r.dataSourceId === "osm_only");
  console.log(`Tier-10 regions: ${tier10.length}`);

  let coverage = readFileSync(COVERAGE_PATH, "utf8");
  let updated = 0;
  let totalSnapped = 0;
  let totalSignals = 0;

  for (const region of tier10) {
    const r = generateForRegion(region);
    if (!r) {
      console.log(`  skip ${region.code} (missing data files)`);
      continue;
    }
    totalSnapped += r.snapped;
    totalSignals += r.total;
    if (r.measured > 0) {
      // Measured-overlay metro: its coverage row (aadtPct / aadtQuality:
      // "measured") is owned by the measured-overlay script. Leave coverage
      // untouched and just report what the synthetic pass preserved.
      console.log(`  ⊙ ${region.code} [${regionGroup(region.country)}]: preserved ${r.measured} measured + filled synthetic ${r.snapped}/${r.total}`);
      continue;
    }
    const res = updateCoverage(coverage, region.code, r.snapPct);
    if (res.changed) {
      coverage = res.text;
      updated++;
    }
    console.log(`  ${r.snapPct >= 75 ? "✓" : "•"} ${region.code} [${regionGroup(region.country)}]: snapped ${r.snapped}/${r.total} = ${r.snapPct}%`);
  }

  writeFileSync(COVERAGE_PATH, coverage);
  console.log(`\n=== Updated ${updated}/${tier10.length} metros in coverage ===`);
  console.log(`Aggregate snap: ${totalSnapped}/${totalSignals} = ${((totalSnapped / totalSignals) * 100).toFixed(1)}%`);
}

main();
