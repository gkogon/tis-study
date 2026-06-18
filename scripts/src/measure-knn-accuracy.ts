/**
 * Leave-one-out KNN/IDW accuracy measurement.
 *
 * For every measured signal globally, predict its AADT by IDW over its
 * nearest measured neighbors (excluding itself), then compare to actual.
 * This is the proper held-out evaluation for the KNN synthesis path:
 * predicting a signal from data that does NOT include it.
 *
 * Reports per-region accuracy under KNN vs the class-baseline model (from
 * measure-synth-accuracy.ts), so the lift is visible per metro.
 *
 * Read-only. Writes artifacts/api-server/src/data/synth-accuracy-knn.json.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/measure-knn-accuracy.ts
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS, type Region } from "../../artifacts/tis-api-server/src/lib/regions";
import { MeasuredIndex, idwPredict, type MeasuredSignal } from "./knn-idw-aadt";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../artifacts/api-server/src/data");

const CELL_DEG = 0.005;
const FAR_RADIUS_M = 150;

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

function nearestRoad(grid: Grid, lat: number, lon: number): Segment | null {
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

type Result = {
  code: string;
  n: number;
  mdape: number;
  accuracy: number;
  within10: number;
  within20: number;
  within30: number;
  within50: number;
  fallbackPct: number; // % of measured signals where KNN found < 2 neighbors
};

function measureRegion(region: Region): Result | null {
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

  // Build the measured-signal index for this metro: snap each measured to a
  // road class, then add to the spatial KNN index.
  const measured: MeasuredSignal[] = [];
  for (const [idStr, rec] of Object.entries(aadt)) {
    if (!rec || rec.source === "synthetic_osm_class" || typeof rec.source !== "string") continue;
    if (rec.aadt == null || rec.aadt <= 0) continue;
    const id = Number(idStr);
    const c = coords.get(id);
    if (!c) continue;
    const seg = nearestRoad(grid, c[0], c[1]);
    if (!seg) continue;
    measured.push({ id, lat: c[0], lon: c[1], classCode: seg.classCode, aadt: rec.aadt });
  }
  if (measured.length < 5) return null;

  const index = new MeasuredIndex(measured);
  const errors: number[] = [];
  let fallback = 0;
  for (const s of measured) {
    const neighbors = index.query(s.lat, s.lon, s.classCode, { k: 5, maxRadiusM: 4000, excludeId: s.id });
    const pred = idwPredict(neighbors, { p: 2, minNeighbors: 2 });
    if (pred == null) { fallback++; continue; }
    errors.push(Math.abs(pred - s.aadt) / s.aadt);
  }
  if (errors.length === 0) return null;

  const within = (band: number) => errors.filter((e) => e <= band).length / errors.length;
  const md = median(errors);
  return {
    code: region.code,
    n: errors.length,
    mdape: Math.round(md * 1000) / 1000,
    accuracy: Math.round(Math.max(0, 1 - md) * 1000) / 1000,
    within10: Math.round(within(0.10) * 1000) / 10,
    within20: Math.round(within(0.20) * 1000) / 10,
    within30: Math.round(within(0.30) * 1000) / 10,
    within50: Math.round(within(0.50) * 1000) / 10,
    fallbackPct: Math.round((fallback / measured.length) * 1000) / 10,
  };
}

function main(): void {
  console.log(`Leave-one-out KNN/IDW accuracy across all regions with measured signals…`);
  const results: Result[] = [];
  for (const region of Object.values(REGIONS)) {
    const r = measureRegion(region);
    if (r) results.push(r);
  }
  results.sort((a, b) => b.accuracy - a.accuracy);

  console.log(`\n=== Per-region KNN/IDW accuracy (n=${results.length} regions) ===`);
  console.log(`code                                    n    MdAPE  accuracy  ±10%  ±20%  ±30%  ±50%  fallback`);
  for (const r of results.slice(0, 30)) {
    console.log(`  ${r.code.padEnd(37)} ${String(r.n).padStart(5)}  ${(r.mdape*100).toFixed(1).padStart(5)}%  ${(r.accuracy*100).toFixed(1).padStart(6)}%  ${String(r.within10).padStart(4)}%  ${String(r.within20).padStart(4)}%  ${String(r.within30).padStart(4)}%  ${String(r.within50).padStart(4)}%  ${String(r.fallbackPct).padStart(5)}%`);
  }
  console.log(`  …`);
  for (const r of results.slice(-15)) {
    console.log(`  ${r.code.padEnd(37)} ${String(r.n).padStart(5)}  ${(r.mdape*100).toFixed(1).padStart(5)}%  ${(r.accuracy*100).toFixed(1).padStart(6)}%  ${String(r.within10).padStart(4)}%  ${String(r.within20).padStart(4)}%  ${String(r.within30).padStart(4)}%  ${String(r.within50).padStart(4)}%  ${String(r.fallbackPct).padStart(5)}%`);
  }

  const totalN = results.reduce((s, r) => s + r.n, 0);
  const wMdape = results.reduce((s, r) => s + r.mdape * r.n, 0) / totalN;
  const wW10 = results.reduce((s, r) => s + r.within10 * r.n, 0) / totalN;
  const wW20 = results.reduce((s, r) => s + r.within20 * r.n, 0) / totalN;
  const wW30 = results.reduce((s, r) => s + r.within30 * r.n, 0) / totalN;
  const wW50 = results.reduce((s, r) => s + r.within50 * r.n, 0) / totalN;
  console.log(`\n=== Global rollup (sample-weighted across ${totalN.toLocaleString()} measured signals) ===`);
  console.log(`  MdAPE:        ${(wMdape*100).toFixed(1)}%`);
  console.log(`  Accuracy:     ${((1 - wMdape)*100).toFixed(1)}%`);
  console.log(`  Within ±10%:  ${wW10.toFixed(1)}%`);
  console.log(`  Within ±20%:  ${wW20.toFixed(1)}%`);
  console.log(`  Within ±30%:  ${wW30.toFixed(1)}%`);
  console.log(`  Within ±50%:  ${wW50.toFixed(1)}%`);

  const meet90 = results.filter((r) => r.accuracy >= 0.9).length;
  const meet80 = results.filter((r) => r.accuracy >= 0.8).length;
  const meet70 = results.filter((r) => r.accuracy >= 0.7).length;
  console.log(`\n=== Targets ===`);
  console.log(`  ${meet90}/${results.length} regions meet ≥90% accuracy (MdAPE ≤ 10%)`);
  console.log(`  ${meet80}/${results.length} regions meet ≥80%`);
  console.log(`  ${meet70}/${results.length} regions meet ≥70%`);

  writeFileSync(path.resolve(DATA_DIR, "synth-accuracy-knn.json"), JSON.stringify({
    regions: results,
    globalRollup: {
      regions: results.length,
      totalMeasuredSignals: totalN,
      mdape: Math.round(wMdape * 1000) / 1000,
      accuracy: Math.round((1 - wMdape) * 1000) / 1000,
      within10: Math.round(wW10 * 10) / 10,
      within20: Math.round(wW20 * 10) / 10,
      within30: Math.round(wW30 * 10) / 10,
      within50: Math.round(wW50 * 10) / 10,
    },
  }, null, 2));
  console.log(`\nWrote per-region KNN accuracy to synth-accuracy-knn.json`);
}

main();
