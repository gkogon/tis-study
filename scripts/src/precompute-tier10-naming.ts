/**
 * Run the signal-naming algorithm offline against each Tier-10 metro
 * (osm_only data source), count how many signals successfully snap to
 * a real "Street A & Street B" cross-street label vs. fall back to
 * "Signal #<id>", and write the namedPct back into metro-coverage.ts.
 *
 * Why: the metro-coverage.ts namedPct field originally reflected only
 * the OSM `name` tag embedded in signal tuples — which is rarely
 * populated globally. The actual runtime naming pass (regional-
 * signal-naming.ts) does spatial join against the roads dataset and
 * produces real intersection names for ~85-99% of signals in metros
 * that have a decent roads dataset. This script makes the coverage
 * appendix reflect what the engine will actually serve.
 *
 * Algorithm is identical to regional-signal-naming.ts but runs offline
 * — copied here to avoid pulling api-server into the scripts workspace
 * (which would expose Express + DB types to the script entry point).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/precompute-tier10-naming.ts
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
const NEAR_RADIUS_M = 80;
const FAR_RADIUS_M = 150;

type Segment = {
  name: string;
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

function analyzeOne(grid: Grid, lat: number, lon: number): { name: string } | null {
  const lk = Math.floor(lat / CELL_DEG);
  const lo = Math.floor(lon / CELL_DEG);
  const segs = grid.get(cellKey(lk, lo));
  if (!segs) return null;

  const near = segs
    .map((s) => ({ s, d: distToSegMeters(lat, lon, s) }))
    .filter((x) => x.d <= FAR_RADIUS_M)
    .sort((a, b) => a.d - b.d);
  if (near.length === 0) return null;

  const closest = near[0]!;
  const radiusForOthers = closest.d <= NEAR_RADIUS_M ? FAR_RADIUS_M : FAR_RADIUS_M * 1.5;
  const other = near.find((x) => x.d <= radiusForOthers && x.s.name !== closest.s.name);
  if (other) return { name: `${closest.s.name} & ${other.s.name}` };
  return { name: closest.s.name };
}

function regionSlug(code: string): string {
  return code.replace(/_metro$/, "").replace(/_/g, "-");
}

function computeNamedPct(slug: string): { signals: number; namedPct: number } | null {
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
  if (!Array.isArray(signals) || signals.length === 0) return { signals: 0, namedPct: 0 };
  const grid = buildGrid(road);
  let named = 0;
  for (const [, lat, lon, embeddedName] of signals) {
    if (embeddedName) { named++; continue; }
    const r = analyzeOne(grid, lat, lon);
    if (r) named++;
  }
  return { signals: signals.length, namedPct: Math.round((named / signals.length) * 1000) / 10 };
}

function main(): void {
  const tier10 = Object.values(REGIONS).filter((r) => r.dataSourceId === "osm_only");
  console.log(`Tier-10 regions: ${tier10.length}`);

  let coverage = readFileSync(COVERAGE_PATH, "utf8");
  const lowConfidence: Array<{ code: string; pct: number; signals: number }> = [];
  let updated = 0;

  for (const region of tier10) {
    const slug = regionSlug(region.code);
    const r = computeNamedPct(slug);
    if (!r) {
      console.log(`  skip ${region.code} (missing data files)`);
      continue;
    }
    const pattern = new RegExp(
      `(\\{ code: "${region.code}",[^}]*?signals:\\s*)(\\d+)(,\\s*namedPct:\\s*)([0-9.]+)`,
    );
    if (!pattern.test(coverage)) {
      console.log(`  ! ${region.code}: pattern miss`);
      continue;
    }
    const before = coverage;
    coverage = coverage.replace(pattern, `$1${r.signals}$3${r.namedPct}`);
    if (coverage !== before) updated++;
    if (r.namedPct < 75) lowConfidence.push({ code: region.code, pct: r.namedPct, signals: r.signals });
    console.log(`  ${r.namedPct >= 75 ? "✓" : "•"} ${region.code}: signals=${r.signals} named=${r.namedPct}%`);
  }

  writeFileSync(COVERAGE_PATH, coverage);
  console.log(`\n=== Synced ${updated}/${tier10.length} metros ===`);
  if (lowConfidence.length > 0) {
    console.log(`\n⚠ ${lowConfidence.length} metros below 75% Tier-B threshold:`);
    for (const l of lowConfidence.sort((a, b) => a.pct - b.pct)) {
      console.log(`  ${l.code}: ${l.pct}% (${l.signals} signals)`);
    }
  } else {
    console.log(`\n✓ All Tier-10 metros at ≥75% namedPct (B-tier runability).`);
  }
}

main();
