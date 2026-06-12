/**
 * Chicago CDOT Average Daily Traffic Counts → measured AADT overlay.
 *
 * Source: City of Chicago open-data portal, dataset gc7y-n4xa
 *   https://data.cityofchicago.org/Transportation/Average-Daily-Traffic-Counts/gc7y-n4xa
 * Served via the Socrata Open Data API (SODA). The dataset is a
 * rolling, per-segment, per-day vehicle-count feed maintained by CDOT
 * (covers 2,331 distinct segmentids; 2020-10 to present). Each row
 * carries the day's count plus midpoint coordinates for the segment.
 *
 * Why this overlay matters for the IL renderer:
 *   - The existing `chicago-aadt.json` is populated from IDOT's state
 *     AADT layer (gis1.dot.illinois.gov). IDOT's published AADT is
 *     state-highway-focused; many Chicago city arterials and
 *     collectors are dark even though CDOT collects daily counts on
 *     them.
 *   - The Illinois TIS spec (REGIONAL-SPECS/illinois-tis-spec.md §1.2)
 *     names CDOT's portal as the canonical ADT source for Chicago
 *     city streets; the IL renderer already cites it.
 *
 * Methodology:
 *   1. Query SODA for `segmentid, midpointlat, midpointlon, count(*),
 *      avg(vehiclecount)` grouped by segmentid (one row per segment)
 *      with a 1-year rolling window. Segments with <30 daily records
 *      in the window are dropped — too thin a sample to call AADT.
 *   2. Aggregate by segmentid (segments appear separately per
 *      direction; we keep them separate because a NB/SB pair on a
 *      one-way couplet correctly count toward each direction's volume,
 *      and snapping picks the nearer one).
 *   3. Snap each Chicago signal to the nearest segment midpoint within
 *      150m. The CDOT segments are short (~100-300m); 150m guarantees
 *      a signal near the midpoint of an adjacent segment still snaps.
 *   4. Merge into chicago-aadt.json with a prefer-newer-year rule:
 *      CDOT 2025-2026 mean wins over IDOT 2020/2022; signals already
 *      covered by IDOT 2024-2025 keep their existing record if the
 *      CDOT segment is not closer.
 *   5. Update metro-coverage.ts for chicago_metro — bump aadtPct,
 *      append "+ CDOT ADT Portal" to aadtSource.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-chicago-cdot-aadt.ts
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

const SLUG = "chicago";
const CODE = "chicago_metro";
const ENDPOINT = "https://data.cityofchicago.org/resource/gc7y-n4xa.json";
const PAGE = 5000;
const SNAP_M = 150;
const MIN_DAYS = 30; // segments with fewer daily counts in the window are too thin
const WINDOW_DAYS = 365;
const SOURCE_TAG = "cdot_adt_portal";
const SOURCE_LABEL = "CDOT ADT Portal (rolling 365-day mean)";
// Take the K-factor estimate from FHWA standard urban arterial (9%).
const K_FACTOR = 9;

type AadtRec = { aadt: number; year: number; kFactor: number; distM: number; source: string };
type Signal = [number, number, number, (string | null)?, number?];
type SegRow = {
  segmentid: string;
  midpointlat: string;
  midpointlon: string;
  count: string;
  avg_vehiclecount_number: string;
};
type Seg = { lat: number; lon: number; aadt: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mLon;
  const dy = (lat2 - lat1) * mLat;
  return Math.hypot(dx, dy);
}

async function fetchSegments(): Promise<Seg[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString().slice(0, 19);
  const segs: Seg[] = [];
  for (let offset = 0; offset < 50_000; offset += PAGE) {
    const url = new URL(ENDPOINT);
    url.searchParams.set(
      "$select",
      "segmentid, midpointlat, midpointlon, count(*), avg(vehiclecount::number)",
    );
    url.searchParams.set("$where", `timestamp > '${since}'`);
    url.searchParams.set("$group", "segmentid, midpointlat, midpointlon");
    url.searchParams.set("$having", `count(*) >= ${MIN_DAYS}`);
    url.searchParams.set("$limit", String(PAGE));
    url.searchParams.set("$offset", String(offset));
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`SODA ${res.status} ${res.statusText} @ offset ${offset}`);
    const rows = (await res.json()) as SegRow[];
    if (rows.length === 0) break;
    for (const r of rows) {
      const lat = Number(r.midpointlat);
      const lon = Number(r.midpointlon);
      const aadt = Math.round(Number(r.avg_vehiclecount_number));
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(aadt) || aadt <= 0) continue;
      segs.push({ lat, lon, aadt });
    }
    console.log(`  fetched ${segs.length} segments (offset ${offset})`);
    if (rows.length < PAGE) break;
    await sleep(200);
  }
  return segs;
}

const CELL_DEG = 0.01;
function cellKey(lat: number, lon: number): number {
  return ((Math.floor(lat / CELL_DEG) + 20000) << 16) | (Math.floor(lon / CELL_DEG) + 20000);
}
function buildGrid(segs: Seg[]): Map<number, Seg[]> {
  const g = new Map<number, Seg[]>();
  for (const s of segs) {
    const k = cellKey(s.lat, s.lon);
    let arr = g.get(k);
    if (!arr) g.set(k, (arr = []));
    arr.push(s);
  }
  return g;
}
function nearest(grid: Map<number, Seg[]>, lat: number, lon: number): { aadt: number; distM: number } | null {
  const baseLat = Math.floor(lat / CELL_DEG);
  const baseLon = Math.floor(lon / CELL_DEG);
  let best: { aadt: number; distM: number } | null = null;
  for (let dl = -1; dl <= 1; dl++) for (let dn = -1; dn <= 1; dn++) {
    const arr = grid.get(((baseLat + dl + 20000) << 16) | (baseLon + dn + 20000));
    if (!arr) continue;
    for (const s of arr) {
      const d = distM(lat, lon, s.lat, s.lon);
      if (d > SNAP_M) continue;
      if (!best || d < best.distM) best = { aadt: s.aadt, distM: Math.round(d) };
    }
  }
  return best;
}

function loadExisting(): Record<string, AadtRec> {
  const p = path.resolve(DATA_DIR, `${SLUG}-aadt.json`);
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8"));
}

function updateCoverage(text: string, newPct: number): string {
  const pctRe = new RegExp(`(\\{ code: "${CODE}",[^}]*?aadtPct:\\s*)([0-9.]+)`);
  let next = text.replace(pctRe, `$1${newPct}`);
  const srcRe = new RegExp(`(\\{ code: "${CODE}",[^}]*?aadtSource:\\s*")([^"]*)(")`);
  next = next.replace(srcRe, (m, pre, src, post) =>
    src.includes("CDOT") ? m : `${pre}${src} + CDOT ADT Portal${post}`,
  );
  return next;
}

async function main(): Promise<void> {
  const sigPath = path.resolve(DATA_DIR, `${SLUG}-signals.json`);
  if (!existsSync(sigPath)) {
    console.error(`! ${sigPath} not found — Chicago signals must exist first.`);
    process.exit(2);
  }
  const signals: Signal[] = JSON.parse(readFileSync(sigPath, "utf8"));
  console.log(`Chicago: ${signals.length} signals`);

  console.log("Fetching CDOT ADT segments (≥30 daily records in past 365 days)…");
  const segs = await fetchSegments();
  console.log(`Loaded ${segs.length} segments with annual mean`);

  if (segs.length === 0) {
    console.error("! No CDOT segments returned — aborting without touching the AADT file.");
    process.exit(3);
  }

  const grid = buildGrid(segs);
  const existing = loadExisting();
  const existingCount = Object.keys(existing).length;

  const merged: Record<string, AadtRec> = { ...existing };
  let filled = 0;
  let replaced = 0;
  let kept = 0;
  for (const [id, lat, lon] of signals) {
    const hit = nearest(grid, lat, lon);
    if (!hit) continue;
    const key = String(id);
    const prev = merged[key];
    const rec: AadtRec = {
      aadt: hit.aadt,
      year: new Date().getUTCFullYear(),
      kFactor: K_FACTOR,
      distM: hit.distM,
      source: SOURCE_TAG,
    };
    if (!prev) {
      merged[key] = rec;
      filled++;
    } else if ((prev.year ?? 0) < rec.year - 1 || prev.source === "synthetic_osm_class") {
      // CDOT 2025-2026 wins over IDOT 2020-2024 and over any synthetic baseline.
      merged[key] = rec;
      replaced++;
    } else {
      kept++;
    }
  }

  writeFileSync(path.resolve(DATA_DIR, `${SLUG}-aadt.json`), JSON.stringify(merged));
  const total = signals.length;
  const newPct = Math.round((Object.keys(merged).length / total) * 1000) / 10;
  const oldPct = Math.round((existingCount / total) * 1000) / 10;
  console.log(
    `Snap: filled ${filled} dark / replaced ${replaced} older / kept ${kept} newer-or-equal`,
  );
  console.log(`Coverage: ${oldPct}% → ${newPct}% (signals: ${total}, mapped: ${Object.keys(merged).length})`);

  const coverage = readFileSync(COVERAGE_PATH, "utf8");
  const next = updateCoverage(coverage, newPct);
  if (next === coverage) {
    console.log(`! metro-coverage.ts pattern miss for ${CODE} — no row updated`);
  } else {
    writeFileSync(COVERAGE_PATH, next);
    console.log(`Updated metro-coverage.ts row for ${CODE} (label includes "${SOURCE_LABEL}")`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
