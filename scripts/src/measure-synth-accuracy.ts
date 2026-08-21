/**
 * Per-region synthetic-AADT accuracy measurement.
 *
 * For every measured signal globally, compute the synth prediction using the
 * CURRENT model (per-metro baseline × laneFactor × speedFactor) and compare
 * to the actual measured AADT. Report MAPE (mean absolute % error), MdAPE
 * (median), accuracy = 1 − MAPE, and % of predictions within ±10/20/30/50%.
 *
 * Read-only. Prints a per-metro table and a global rollup. Writes
 * artifacts/api-server/src/data/synth-accuracy.json with per-region figures.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/measure-synth-accuracy.ts
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS, type Region } from "../../artifacts/tis-api-server/src/lib/regions";
import { resolveRoadFile, readJsonMaybeGz } from "./road-file-io";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../artifacts/api-server/src/data");

const CELL_DEG = 0.005;
const FAR_RADIUS_M = 150;

// Mirror of synth model (precompute-tier10-synthetic-aadt.ts).
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

const regionSlug = (code: string) => code.replace(/_metro$/, "").replace(/_/g, "-");
const median = (a: number[]) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : NaN;

type AadtRec = { aadt: number; source: string };
type BaselineEntry = { baseline: Record<string, number>; method: string };

type RegionAccuracy = {
  code: string;
  method: string;
  n: number;
  mape: number;       // mean absolute % error (0..1+)
  mdape: number;      // median absolute % error
  accuracy: number;   // 1 − mdape, capped to [0, 1]
  within10: number;   // % of predictions within ±10% of actual
  within20: number;
  within30: number;
  within50: number;
};

function measureRegion(region: Region, baselines: Record<string, BaselineEntry>): RegionAccuracy | null {
  const slug = regionSlug(region.code);
  const sigPath = path.resolve(DATA_DIR, `${slug}-signals.json`);
  const roadPath = resolveRoadFile(DATA_DIR, slug); // .json.gz preferred, .json fallback
  const aadtPath = path.resolve(DATA_DIR, `${slug}-aadt.json`);
  if (!existsSync(sigPath) || !roadPath || !existsSync(aadtPath)) return null;
  let signals: Array<[number, number, number]>;
  let road: RoadNetwork;
  let aadt: Record<string, AadtRec>;
  try {
    signals = JSON.parse(readFileSync(sigPath, "utf8"));
    road = readJsonMaybeGz(roadPath);
    aadt = JSON.parse(readFileSync(aadtPath, "utf8"));
  } catch {
    return null;
  }
  const coords = new Map<number, [number, number]>();
  for (const sig of signals) coords.set(sig[0], [sig[1], sig[2]]);
  const grid = buildGrid(road);

  const baseline = baselines[region.code];
  if (!baseline) return null;

  const errors: number[] = [];
  for (const [id, rec] of Object.entries(aadt)) {
    if (!rec || rec.source === "synthetic_osm_class" || typeof rec.source !== "string") continue;
    if (rec.aadt == null || rec.aadt <= 0) continue;
    const c = coords.get(Number(id));
    if (!c) continue;
    const seg = nearest(grid, c[0], c[1]);
    if (!seg) continue;
    const base = baseline.baseline[String(seg.classCode)] ?? baseline.baseline["4"]!;
    const predicted = base * laneFactor(seg.lanes, seg.classCode) * speedFactor(seg.maxspeed);
    const err = Math.abs(predicted - rec.aadt) / rec.aadt;
    errors.push(err);
  }
  if (errors.length === 0) return null;

  const mape = errors.reduce((s, e) => s + e, 0) / errors.length;
  const mdape = median(errors);
  const accuracy = Math.max(0, 1 - mdape);
  const within = (band: number) => errors.filter((e) => e <= band).length / errors.length;
  return {
    code: region.code,
    method: baseline.method,
    n: errors.length,
    mape: Math.round(mape * 1000) / 1000,
    mdape: Math.round(mdape * 1000) / 1000,
    accuracy: Math.round(accuracy * 1000) / 1000,
    within10: Math.round(within(0.10) * 1000) / 10,
    within20: Math.round(within(0.20) * 1000) / 10,
    within30: Math.round(within(0.30) * 1000) / 10,
    within50: Math.round(within(0.50) * 1000) / 10,
  };
}

function main(): void {
  const baselinesPath = path.resolve(DATA_DIR, "per-metro-baseline.json");
  if (!existsSync(baselinesPath)) {
    console.error(`✗ per-metro-baseline.json not found. Run calibrate-global-per-metro.ts first.`);
    process.exit(1);
  }
  const baselines: Record<string, BaselineEntry> = JSON.parse(readFileSync(baselinesPath, "utf8"));

  console.log(`Measuring accuracy across all regions with measured signals…`);
  const results: RegionAccuracy[] = [];
  for (const region of Object.values(REGIONS)) {
    const r = measureRegion(region, baselines);
    if (r) results.push(r);
  }
  results.sort((a, b) => b.accuracy - a.accuracy);

  console.log(`\n=== Per-region accuracy (n=${results.length} regions with measured signals) ===`);
  console.log(`code                                  method                n     MdAPE   accuracy  ±10%   ±20%   ±30%   ±50%`);
  for (const r of results.slice(0, 25)) {
    console.log(`  ${r.code.padEnd(35)} ${r.method.padEnd(20)} ${String(r.n).padStart(5)}  ${(r.mdape*100).toFixed(1).padStart(5)}%  ${(r.accuracy*100).toFixed(1).padStart(6)}%  ${String(r.within10).padStart(4)}%  ${String(r.within20).padStart(4)}%  ${String(r.within30).padStart(4)}%  ${String(r.within50).padStart(4)}%`);
  }
  console.log(`  …`);
  for (const r of results.slice(-15)) {
    console.log(`  ${r.code.padEnd(35)} ${r.method.padEnd(20)} ${String(r.n).padStart(5)}  ${(r.mdape*100).toFixed(1).padStart(5)}%  ${(r.accuracy*100).toFixed(1).padStart(6)}%  ${String(r.within10).padStart(4)}%  ${String(r.within20).padStart(4)}%  ${String(r.within30).padStart(4)}%  ${String(r.within50).padStart(4)}%`);
  }

  // Global rollup (sample-weighted)
  const totalN = results.reduce((s, r) => s + r.n, 0);
  const wMdape = results.reduce((s, r) => s + r.mdape * r.n, 0) / totalN;
  const wMape = results.reduce((s, r) => s + r.mape * r.n, 0) / totalN;
  const wW10 = results.reduce((s, r) => s + r.within10 * r.n, 0) / totalN;
  const wW20 = results.reduce((s, r) => s + r.within20 * r.n, 0) / totalN;
  const wW30 = results.reduce((s, r) => s + r.within30 * r.n, 0) / totalN;
  const wW50 = results.reduce((s, r) => s + r.within50 * r.n, 0) / totalN;
  console.log(`\n=== Global rollup (sample-weighted across ${totalN.toLocaleString()} measured signals) ===`);
  console.log(`  MAPE   (mean):      ${(wMape*100).toFixed(1)}%`);
  console.log(`  MdAPE  (median):    ${(wMdape*100).toFixed(1)}%`);
  console.log(`  Accuracy = 1 − MdAPE: ${((1 - wMdape)*100).toFixed(1)}%`);
  console.log(`  Within ±10%:        ${wW10.toFixed(1)}%`);
  console.log(`  Within ±20%:        ${wW20.toFixed(1)}%`);
  console.log(`  Within ±30%:        ${wW30.toFixed(1)}%`);
  console.log(`  Within ±50%:        ${wW50.toFixed(1)}%`);

  // 90% target check
  const meetTarget = results.filter((r) => r.accuracy >= 0.9).length;
  console.log(`\n=== 90% target ===`);
  console.log(`  ${meetTarget}/${results.length} regions meet ≥90% accuracy (MdAPE ≤ 10%)`);

  writeFileSync(path.resolve(DATA_DIR, "synth-accuracy.json"), JSON.stringify({
    regions: results,
    globalRollup: {
      regions: results.length,
      totalMeasuredSignals: totalN,
      mape: Math.round(wMape * 1000) / 1000,
      mdape: Math.round(wMdape * 1000) / 1000,
      accuracy: Math.round((1 - wMdape) * 1000) / 1000,
      within10: Math.round(wW10 * 10) / 10,
      within20: Math.round(wW20 * 10) / 10,
      within30: Math.round(wW30 * 10) / 10,
      within50: Math.round(wW50 * 10) / 10,
    },
  }, null, 2));
  console.log(`\nWrote per-region accuracy to synth-accuracy.json`);
}

main();
