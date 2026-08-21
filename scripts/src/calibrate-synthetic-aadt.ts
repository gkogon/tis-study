/**
 * Calibration analysis for the per-group synthetic-AADT baselines.
 *
 * Joins every MEASURED signal (the cities where we have real counts) to its
 * nearest OSM road segment and reads back the segment's class + lanes +
 * maxspeed. From that we derive, empirically:
 *   1. per-group × per-class median measured AADT  → the base-table anchors
 *   2. how AADT scales with lane count within a class → the lane factor
 *   3. how AADT tracks maxspeed (secondary signal)
 *
 * Anchored groups: europe (paris/madrid/berlin), east_asia (tokyo/osaka).
 * north_america keeps its legacy DOT-derived baseline. The other five groups
 * have no measured city, so they're scaled estimates in region-groups.ts.
 *
 * Read-only — prints a report, writes nothing. Requires the length-5 road
 * bundles (run after fetch-osm-roads.ts --osm-only).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/calibrate-synthetic-aadt.ts
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS } from "../../artifacts/tis-api-server/src/lib/regions";
import { regionGroup, uncoveredCountries, type RegionGroup } from "./region-groups";
import { resolveRoadFile, readJsonMaybeGz } from "./road-file-io";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../artifacts/api-server/src/data");
const CELL_DEG = 0.005;
const FAR_RADIUS_M = 150;
const CLASS_NAME = ["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified"];

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
    if (classCode > 4) continue; // major roads only (match synthetic snap behavior)
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
    const key = s.classCode * 1000 + d; // prefer most-major, then nearest
    if (key < bestKey) { bestKey = key; best = s; }
  }
  return best;
}

const regionSlug = (code: string) => code.replace(/_metro$/, "").replace(/_/g, "-");
const median = (a: number[]) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : NaN;
const quant = (a: number[], p: number) => a.length ? [...a].sort((x, y) => x - y)[Math.floor(p * (a.length - 1))]! : NaN;

type Row = { group: RegionGroup; classCode: number; lanes: number | null; maxspeed: number | null; aadt: number };

function collect(slug: string, group: RegionGroup, measuredSrcPrefixes: string[]): Row[] {
  const sigPath = path.resolve(DATA_DIR, `${slug}-signals.json`);
  const roadPath = resolveRoadFile(DATA_DIR, slug); // .json.gz preferred, .json fallback
  const aadtPath = path.resolve(DATA_DIR, `${slug}-aadt.json`);
  if (!existsSync(sigPath) || !roadPath || !existsSync(aadtPath)) return [];
  const signals: Array<[number, number, number]> = JSON.parse(readFileSync(sigPath, "utf8"));
  const road: RoadNetwork = readJsonMaybeGz(roadPath);
  const aadt: Record<string, { aadt: number; source: string }> = JSON.parse(readFileSync(aadtPath, "utf8"));
  const coords = new Map<number, [number, number]>();
  for (const [id, lat, lon] of signals) coords.set(id, [lat, lon]);
  const grid = buildGrid(road);
  const rows: Row[] = [];
  for (const [id, rec] of Object.entries(aadt)) {
    if (!measuredSrcPrefixes.some((p) => rec.source.startsWith(p))) continue;
    const c = coords.get(Number(id));
    if (!c) continue;
    const seg = nearest(grid, c[0], c[1]);
    if (!seg) continue;
    rows.push({ group, classCode: seg.classCode, lanes: seg.lanes, maxspeed: seg.maxspeed, aadt: rec.aadt });
  }
  const laneTagged = rows.filter((r) => r.lanes != null).length;
  console.log(`  ${slug}: ${rows.length} measured signals joined to a major road  (lanes present on ${laneTagged} = ${Math.round(100 * laneTagged / Math.max(1, rows.length))}%)`);
  return rows;
}

function main(): void {
  // 1. Coverage audit
  const osmCountries = new Set<string>();
  for (const r of Object.values(REGIONS)) if (r.dataSourceId === "osm_only") osmCountries.add(r.country ?? "US");
  const uncovered = uncoveredCountries(osmCountries);
  console.log(`=== osm_only countries: ${osmCountries.size} ===`);
  console.log(uncovered.length ? `⚠ UNCOVERED by classifier: ${uncovered.join(", ")}` : "✓ all osm_only countries covered by region-groups classifier");

  // 2. Collect measured rows per anchored group
  console.log(`\n=== joining measured signals → road class/lanes/speed ===`);
  // For Canada, pull every non-synthetic source tag we've wired:
  //   - provincial DOTs: mto / ab_transportation / mb_infrastructure / mtq_djma
  //   - city portals: toronto_open_data_svc / ottawa_open_data_midblock /
  //                   hamilton_open_data_adt / calgary_open_data_(2023|volumes) /
  //                   edmonton_open_data_aawdt / winnipeg_open_data_midblock /
  //                   halifax_open_data_traffic_studies / vancouver_open_data_directional /
  //                   montreal_open_data_intersection
  const CA_PREFIXES = [
    "mto", "ab_transportation", "mb_infrastructure", "mtq_djma",
    "toronto_open_data_svc", "ottawa_open_data_midblock", "hamilton_open_data_adt",
    "calgary_open_data_", "edmonton_open_data_aawdt", "winnipeg_open_data_midblock",
    "halifax_open_data_traffic_studies", "vancouver_open_data_directional",
    "montreal_open_data_intersection",
  ];
  const rows: Row[] = [
    ...collect("paris", "europe", ["paris_opendata"]),
    ...collect("madrid", "europe", ["madrid_ayto"]),
    ...collect("berlin", "europe", ["berlin_senat"]),
    ...collect("tokyo", "east_asia", ["mlit_census"]),
    ...collect("osaka", "east_asia", ["mlit_census"]),
    ...collect("toronto", "canada", CA_PREFIXES),
    ...collect("ottawa", "canada", CA_PREFIXES),
    ...collect("hamilton", "canada", CA_PREFIXES),
    ...collect("montreal", "canada", CA_PREFIXES),
    ...collect("quebec-city", "canada", CA_PREFIXES),
    ...collect("vancouver", "canada", CA_PREFIXES),
    ...collect("calgary", "canada", CA_PREFIXES),
    ...collect("edmonton", "canada", CA_PREFIXES),
    ...collect("winnipeg", "canada", CA_PREFIXES),
    ...collect("halifax", "canada", CA_PREFIXES),
  ];

  // 3. Per group×class median AADT
  for (const group of ["europe", "east_asia", "canada"] as RegionGroup[]) {
    console.log(`\n=== ${group.toUpperCase()} — per-class measured AADT (the base-table anchor) ===`);
    for (let c = 0; c <= 4; c++) {
      const v = rows.filter((r) => r.group === group && r.classCode === c).map((r) => r.aadt);
      if (!v.length) { console.log(`  ${CLASS_NAME[c]?.padEnd(12)} n=0`); continue; }
      console.log(`  ${CLASS_NAME[c]?.padEnd(12)} n=${String(v.length).padEnd(5)} p25=${Math.round(quant(v, .25))} median=${Math.round(median(v))} p75=${Math.round(quant(v, .75))}`);
    }
    // 4. Lane factor within class (use the densest class with lane data)
    console.log(`  -- lane scaling within class (median AADT by lane count) --`);
    for (let c = 1; c <= 3; c++) {
      const byLane: string[] = [];
      for (const ln of [1, 2, 3, 4, 5, 6]) {
        const v = rows.filter((r) => r.group === group && r.classCode === c && r.lanes === ln).map((r) => r.aadt);
        if (v.length >= 5) byLane.push(`${ln}L:${Math.round(median(v))}(n${v.length})`);
      }
      if (byLane.length) console.log(`     ${CLASS_NAME[c]}: ${byLane.join("  ")}`);
    }
  }

  // 5. maxspeed signal (pooled, both groups)
  console.log(`\n=== maxspeed vs AADT (pooled anchored groups, secondary signal) ===`);
  for (const [lo, hi] of [[0, 40], [41, 60], [61, 90], [91, 200]]) {
    const v = rows.filter((r) => r.maxspeed != null && r.maxspeed >= lo && r.maxspeed <= hi).map((r) => r.aadt);
    if (v.length >= 5) console.log(`  ${lo}-${hi} km/h: median=${Math.round(median(v))} (n=${v.length})`);
  }
}

main();
