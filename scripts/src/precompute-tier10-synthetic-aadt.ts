/**
 * Generate synthetic AADT for each Tier-10 (osm_only) metro.
 *
 * For every signal, spatial-joins to the nearest named road segment
 * in the metro's roads dataset and assigns a baseline AADT keyed off
 * the OSM highway class:
 *
 *   motorway  → 60,000 vpd (5,400 vph at K=9%)
 *   trunk     → 30,000 vpd
 *   primary   → 15,000 vpd
 *   secondary →  8,000 vpd
 *   tertiary  →  4,000 vpd
 *
 * Writes `<slug>-aadt.json` with `source: "synthetic_osm_class"` so
 * the runtime AADT loader (regional-intersections.ts) picks it up
 * the same way it picks up measured DOT-snapped AADT. Each entry
 * carries a `distM` so the engine can downweight if a signal sits
 * far from the nearest road. kFactor defaults to FHWA 9% standard.
 *
 * Why synthetic: real per-segment AADT counts don't exist for most
 * countries outside the US/UK/AU. This baseline keeps the engine
 * producing sensible vph everywhere; the UI labels Tier-10 metros
 * "Synthetic" (aadtQuality: "synthetic") so users don't mistake
 * modeled volumes for measured counts.
 *
 * Updates metro-coverage.ts with the snap rate (aadtPct) and
 * aadtSource / aadtQuality fields.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/precompute-tier10-synthetic-aadt.ts
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS } from "../../artifacts/tis-api-server/src/lib/regions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

const CELL_DEG = 0.005;
const FAR_RADIUS_M = 150;

// Per-class AADT baseline (vehicles per day, annual average).
// Aligned with the engine's serve-time VOLUME_BY_CLASS but expressed
// as AADT (× 1/K to get peak vph): K-factor 9% standard.
const AADT_BY_CLASS: Record<number, number> = {
  0: 60_000, // motorway
  1: 30_000, // trunk
  2: 15_000, // primary
  3: 8_000,  // secondary
  4: 4_000,  // tertiary
};
const K_FACTOR = 9;

type Segment = {
  classCode: number;
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
    if (way.length !== 3) continue;
    const classCode = typeof way[0] === "number" ? (way[0] as number) : 99;
    if (!(classCode in AADT_BY_CLASS)) continue;
    const pts = way[2] as Array<[number, number]>;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const seg: Segment = { classCode, alat: a[0], alon: a[1], blat: b[0], blon: b[1] };
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

function nearestClass(grid: Grid, lat: number, lon: number): { classCode: number; distM: number } | null {
  const lk = Math.floor(lat / CELL_DEG);
  const lo = Math.floor(lon / CELL_DEG);
  const segs = grid.get(cellKey(lk, lo));
  if (!segs) return null;
  let best: { classCode: number; distM: number } | null = null;
  for (const s of segs) {
    const d = distToSegMeters(lat, lon, s);
    if (d > FAR_RADIUS_M) continue;
    // Prefer most-major (lowest classCode) within range; tiebreak by distance.
    if (best === null || s.classCode < best.classCode || (s.classCode === best.classCode && d < best.distM)) {
      best = { classCode: s.classCode, distM: Math.round(d) };
    }
  }
  return best;
}

function regionSlug(code: string): string {
  return code.replace(/_metro$/, "").replace(/_/g, "-");
}

type AadtRec = { aadt: number; year: number; kFactor: number; distM: number; source: string };

function generateForRegion(slug: string): { total: number; snapped: number; snapPct: number } | null {
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
  if (!Array.isArray(signals) || signals.length === 0) return { total: 0, snapped: 0, snapPct: 0 };

  const grid = buildGrid(road);
  const out: Record<string, AadtRec> = {};
  let snapped = 0;
  for (const [osmId, lat, lon] of signals) {
    if (osmId < 0) continue; // city-authoritative signals — skip
    const nearest = nearestClass(grid, lat, lon);
    if (!nearest) continue;
    out[String(osmId)] = {
      aadt: AADT_BY_CLASS[nearest.classCode] ?? 4_000,
      year: 2024,
      kFactor: K_FACTOR,
      distM: nearest.distM,
      source: "synthetic_osm_class",
    };
    snapped++;
  }

  const outPath = path.resolve(DATA_DIR, `${slug}-aadt.json`);
  writeFileSync(outPath, JSON.stringify(out));
  return {
    total: signals.length,
    snapped,
    snapPct: Math.round((snapped / signals.length) * 1000) / 10,
  };
}

function updateCoverage(coverage: string, regionCode: string, snapPct: number): { text: string; changed: boolean } {
  // Update aadtPct + add aadtSource if missing + add aadtQuality discriminator.
  const pattern = new RegExp(
    `(\\{ code: "${regionCode}",[^}]*?aadtPct:\\s*)([0-9.]+)(,\\s*liveSource:\\s*null,)(\\s*dotName:)`,
  );
  if (!pattern.test(coverage)) return { text: coverage, changed: false };
  const aadtFields = `aadtSource: "Synthesized from OSM road-class geometry (HCM baseline)", aadtQuality: "synthetic",`;
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
    const slug = regionSlug(region.code);
    const r = generateForRegion(slug);
    if (!r) {
      console.log(`  skip ${region.code} (missing data files)`);
      continue;
    }
    totalSnapped += r.snapped;
    totalSignals += r.total;
    const res = updateCoverage(coverage, region.code, r.snapPct);
    if (res.changed) {
      coverage = res.text;
      updated++;
    }
    console.log(`  ${r.snapPct >= 75 ? "✓" : "•"} ${region.code}: snapped ${r.snapped}/${r.total} = ${r.snapPct}%`);
  }

  writeFileSync(COVERAGE_PATH, coverage);
  console.log(`\n=== Updated ${updated}/${tier10.length} metros in coverage ===`);
  console.log(`Aggregate snap: ${totalSnapped}/${totalSignals} = ${((totalSnapped / totalSignals) * 100).toFixed(1)}%`);
}

main();
