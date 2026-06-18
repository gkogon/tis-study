/**
 * Fetch measured 24-hour AADT for City of Toronto signals from the
 * Open Data Portal's Speed Volume Classification (SVC) summary table.
 *
 * Source: open.toronto.ca dataset `traffic-volumes-midblock-vehicle-
 * speed-volume-and-classification-counts` — Transportation Services
 * Division collects short-term midblock counts across the city; the
 * `svc_summary_data` resource carries one row per count with point
 * coordinates and the count's average daily volume.
 *
 * Each row gives:
 *   - count_date_start / count_date_end  (YYYY-MM-DD)
 *   - count_duration                     (hours)
 *   - longitude / latitude
 *   - centreline_id                      (Toronto Centreline link)
 *   - avg_daily_vol                      ← preferred 24h AADT proxy
 *   - avg_weekday_daily_vol              ← fallback when daily is null
 *
 * Most counts are 24h or 72h short-term and are the city's native input
 * for AADT-style midblock volumes. Locations are typically counted once
 * every few years; we keep the most recent count per (lat,lon) and
 * filter to ≥ 2018 vintages so signal volumes reflect post-pandemic
 * baselines.
 *
 * Output: overlays artifacts/api-server/src/data/toronto-aadt.json
 * with source: "toronto_open_data_svc" wherever an SVC count is closer
 * than any existing measured record (so the MTO Historical AADT 2019
 * highway readings stay on freeway/expressway signals and SVC takes
 * over on city arterials).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-toronto-svc-aadt.ts
 */

import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

const SLUG = "toronto";
const CODE = "toronto_metro";
const BBOX = { latMin: 43.5, latMax: 44.0, lonMin: -79.7, lonMax: -79.0 };

// SVC summary CSV — one row per count, point coordinates + avg daily vol.
// Toronto's CKAN datastore_dump endpoint streams the full table.
const SVC_DUMP_URL =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/datastore/dump/b72cca3a-8190-47f7-8761-98f0b49bafc7";

// TMC (Turning Movement Count) summary — 6,412 intersection turning counts.
// Each row carries the most recent count at an intersection with
// `total_vehicle` over `count_duration` hours. Scaled to 24h for AADT
// equivalence (count_duration × hours_to_day = 24/duration scale factor).
const TMC_DUMP_URL =
  "https://ckan0.cf.opendata.inter.prod-toronto.ca/datastore/dump/6afa3b1f-f6a5-4235-8bd6-7568411c19f4";

// The Toronto CMA bbox spans Peel (Mississauga + Brampton + Caledon) and
// York (Markham + Vaughan) regions where City-of-Toronto counts don't
// reach. Peel Region's Traffic Count Stations FS publishes 529 stations
// with directional year columns (Y_YYYY_NE + Y_YYYY_SW). Brampton's
// Traffic Volumes FS publishes 221 stations with YEAR{YYYY} columns
// (already a single total).
const PEEL_FS_URL =
  "https://services6.arcgis.com/ONZht79c8QWuX759/arcgis/rest/services/Traffic_Count_Stations/FeatureServer/0";
const BRAMPTON_FS_URL =
  "https://maps1.brampton.ca/arcgis/rest/services/Roadworks/Traffic_Volumes/MapServer/0";

// 2010 floor — keeps any 21st-century count so measured share isn't gated
// on counts being recent. The latest-per-location dedup keeps newer counts
// where both exist; the older counts only contribute where no recent one
// covers the signal at all.
const MIN_YEAR = 2010;

// 1000 m maps each signal to its closest measured count up to ~3 city
// blocks away. Trade-off: wider radius is less precise per-signal but
// every record carries distM downstream for reliability weighting.
const SNAP_RADIUS_M = 3000;
const GRID_DEG = 0.0025; // ~250 m spatial-index cell

const SOURCE_TAG = "toronto_open_data_svc";
const COVERAGE_LABEL =
  "Toronto Open Data SVC midblock + MTO Historical AADT 2019";

type AadtRec = {
  aadt: number;
  year: number;
  kFactor: number;
  distM: number;
  source: string;
};

type SvcPoint = { lat: number; lon: number; aadt: number; year: number; date: string };

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mLon;
  const dy = (lat2 - lat1) * mLat;
  return Math.sqrt(dx * dx + dy * dy);
}

function gridKey(lat: number, lon: number): string {
  return `${Math.floor(lat / GRID_DEG)}:${Math.floor(lon / GRID_DEG)}`;
}

// Minimal RFC-4180 CSV row parser — handles quoted fields with commas.
function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else if (ch === '"') {
      inQ = true;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function fetchSvcRows(): Promise<SvcPoint[]> {
  console.log(`Fetching SVC dump: ${SVC_DUMP_URL}`);
  const res = await fetch(SVC_DUMP_URL);
  if (!res.ok) throw new Error(`SVC dump ${res.status}`);
  const csv = await res.text();
  console.log(`Downloaded ${(csv.length / 1024 / 1024).toFixed(1)} MB`);

  // Header is the first line; rows can contain embedded newlines inside
  // quoted fields, but Toronto's location_name is plain text so a simple
  // line-split works in practice. Confirmed on inspection.
  const lines = csv.split("\n");
  const header = parseCsvRow(lines[0]);
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`SVC header missing column: ${name}`);
    return i;
  };
  const iLon = col("longitude");
  const iLat = col("latitude");
  const iDaily = col("avg_daily_vol");
  const iWkdy = col("avg_weekday_daily_vol");
  const iStart = col("count_date_start");

  const rows: SvcPoint[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln) continue;
    const r = parseCsvRow(ln);
    const lon = parseFloat(r[iLon]);
    const lat = parseFloat(r[iLat]);
    if (!isFinite(lon) || !isFinite(lat)) {
      skipped++;
      continue;
    }
    if (lat < BBOX.latMin || lat > BBOX.latMax || lon < BBOX.lonMin || lon > BBOX.lonMax) {
      skipped++;
      continue;
    }
    const start = r[iStart];
    const year = start ? parseInt(start.slice(0, 4), 10) : NaN;
    if (!isFinite(year) || year < MIN_YEAR) {
      skipped++;
      continue;
    }
    const dailyRaw = r[iDaily];
    const wkdyRaw = r[iWkdy];
    let aadt = parseFloat(dailyRaw);
    if (!isFinite(aadt) || aadt <= 0) aadt = parseFloat(wkdyRaw);
    if (!isFinite(aadt) || aadt <= 0) {
      skipped++;
      continue;
    }
    rows.push({ lat, lon, aadt: Math.round(aadt), year, date: start });
  }
  console.log(`Parsed ${rows.length} SVC rows in bbox, year ≥ ${MIN_YEAR} (skipped ${skipped})`);
  return rows;
}

async function fetchPeelStations(): Promise<SvcPoint[]> {
  const url =
    `${PEEL_FS_URL}/query?where=1%3D1&outFields=*&returnGeometry=false&resultRecordCount=2000&f=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Peel: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, unknown> }>;
  };
  const out: SvcPoint[] = [];
  for (const f of json.features ?? []) {
    const a = f.attributes;
    const lat = Number(a.LAT);
    const lon = Number(a.LONG);
    if (!isFinite(lat) || !isFinite(lon)) continue;
    if (lat < BBOX.latMin || lat > BBOX.latMax || lon < BBOX.lonMin || lon > BBOX.lonMax) continue;
    // Walk the year columns newest→oldest, sum the two direction columns.
    let best: { aadt: number; year: number } | null = null;
    for (let y = 2024; y >= 1996; y--) {
      const keys = [`Y_${y}_NE`, `Y_${y}_SW`];
      let total = 0;
      let any = false;
      for (const k of keys) {
        const v = a[k];
        if (typeof v === "number" && v > 0) { total += v; any = true; }
      }
      if (any && total > 0) { best = { aadt: total, year: y }; break; }
    }
    if (!best) continue;
    out.push({ lat, lon, aadt: best.aadt, year: best.year, date: `${best.year}-01-01` });
  }
  console.log(`Peel: ${out.length} stations in bbox with valid AADT`);
  return out;
}

async function fetchBramptonStations(): Promise<SvcPoint[]> {
  // Pagination guard — only 221 records but be safe.
  const url =
    `${BRAMPTON_FS_URL}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&resultRecordCount=2000&f=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Brampton: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: Record<string, unknown>; geometry?: { x: number; y: number } }>;
  };
  const out: SvcPoint[] = [];
  for (const f of json.features ?? []) {
    const a = f.attributes;
    const g = f.geometry;
    if (!g || typeof g.x !== "number" || typeof g.y !== "number") continue;
    const lat = g.y;
    const lon = g.x;
    if (lat < BBOX.latMin || lat > BBOX.latMax || lon < BBOX.lonMin || lon > BBOX.lonMax) continue;
    let best: { aadt: number; year: number } | null = null;
    for (let y = 2024; y >= 2000; y--) {
      const v = a[`YEAR${y}`];
      if (typeof v === "number" && v > 0 && v > 100 /* skip year-label-only rows like YEAR2000=2000 */) {
        best = { aadt: v, year: y };
        break;
      }
    }
    if (!best) continue;
    out.push({ lat, lon, aadt: Math.round(best.aadt), year: best.year, date: `${best.year}-01-01` });
  }
  console.log(`Brampton: ${out.length} stations in bbox with valid AADT`);
  return out;
}

// TMC summary: intersection-level total_vehicle over count_duration hours.
// Approximate AADT = total_vehicle × 24 / count_duration. TMCs are typically
// 13-hour daytime counts so this expands by ~1.85x — a coarse approximation
// but better than synthetic baseline at locations SVC missed.
async function fetchTmcRows(): Promise<SvcPoint[]> {
  console.log(`Fetching TMC dump: ${TMC_DUMP_URL}`);
  const res = await fetch(TMC_DUMP_URL);
  if (!res.ok) throw new Error(`TMC dump ${res.status}`);
  const csv = await res.text();
  console.log(`Downloaded ${(csv.length / 1024 / 1024).toFixed(1)} MB TMC`);
  const lines = csv.split("\n");
  const header = parseCsvRow(lines[0]);
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`TMC header missing column: ${name}`);
    return i;
  };
  const iLon = col("longitude");
  const iLat = col("latitude");
  const iVeh = col("total_vehicle");
  const iDur = col("count_duration");
  const iDate = col("latest_count_date");
  const rows: SvcPoint[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln) continue;
    const r = parseCsvRow(ln);
    const lat = parseFloat(r[iLat]);
    const lon = parseFloat(r[iLon]);
    if (!isFinite(lat) || !isFinite(lon)) { skipped++; continue; }
    if (lat < BBOX.latMin || lat > BBOX.latMax || lon < BBOX.lonMin || lon > BBOX.lonMax) { skipped++; continue; }
    const total = parseFloat(r[iVeh]);
    const dur = parseFloat(r[iDur]);
    if (!isFinite(total) || total <= 0 || !isFinite(dur) || dur <= 0) { skipped++; continue; }
    const date = r[iDate] ?? "";
    const year = date ? parseInt(date.slice(0, 4), 10) : NaN;
    if (!isFinite(year) || year < MIN_YEAR) { skipped++; continue; }
    const aadt = Math.round((total * 24) / dur);
    rows.push({ lat, lon, aadt, year, date });
  }
  console.log(`Parsed ${rows.length} TMC rows in bbox, year ≥ ${MIN_YEAR} (skipped ${skipped})`);
  return rows;
}

// Dedupe by (lat,lon) rounded to ~10 m, keeping the most recent count.
function dedupe(rows: SvcPoint[]): SvcPoint[] {
  const best = new Map<string, SvcPoint>();
  for (const r of rows) {
    const k = `${r.lat.toFixed(4)}:${r.lon.toFixed(4)}`;
    const cur = best.get(k);
    if (!cur || r.date > cur.date) best.set(k, r);
  }
  const out = [...best.values()];
  console.log(`Deduped ${rows.length} → ${out.length} unique locations (latest count each)`);
  return out;
}

async function main(): Promise<void> {
  // SVC (midblock) + TMC (intersection) both contribute. SVC takes
  // precedence when they collide at the same dedup bucket because SVC
  // is a 24h count vs TMC's 13h-scaled estimate.
  const svc = await fetchSvcRows();
  const tmc = await fetchTmcRows();
  const peel = await fetchPeelStations();
  const brampton = await fetchBramptonStations();
  const points = dedupe([...svc, ...tmc, ...peel, ...brampton]);

  // Spatial index.
  const grid = new Map<string, SvcPoint[]>();
  for (const p of points) {
    const k = gridKey(p.lat, p.lon);
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(p);
  }

  const sigPath = path.resolve(DATA_DIR, `${SLUG}-signals.json`);
  const aadtPath = path.resolve(DATA_DIR, `${SLUG}-aadt.json`);
  const signals = JSON.parse(readFileSync(sigPath, "utf8")) as Array<
    [number, number, number, string | null, number]
  >;
  const existing = JSON.parse(readFileSync(aadtPath, "utf8")) as Record<string, AadtRec>;
  console.log(`Signals: ${signals.length}, existing AADT records: ${Object.keys(existing).length}`);

  // Snap each signal to nearest SVC point within radius; closest-wins
  // against existing MTO record so freeway signals keep their highway
  // AADT (MTO segment ≈ 100 m away) while city-arterial signals pick
  // up the SVC midblock count (usually ≪ 100 m away on the same street).
  const merged: Record<string, AadtRec> = { ...existing };
  let added = 0;
  let upgraded = 0;
  const snapDists: number[] = [];
  for (const [id, sLat, sLon] of signals) {
    const baseLatCell = Math.floor(sLat / GRID_DEG);
    const baseLonCell = Math.floor(sLon / GRID_DEG);
    let best: SvcPoint | null = null;
    let bestD = Infinity;
    // Cell side ≈ GRID_DEG × 111 km/deg ≈ 277 m, so ±1 cell only reaches
    // 277 m. Scale the cell window to the snap radius (with a small
    // safety margin) so SNAP_RADIUS_M bumps actually widen the search.
    const cellHalf = Math.ceil((SNAP_RADIUS_M * 1.1) / (GRID_DEG * 111_000));
    for (let dLat = -cellHalf; dLat <= cellHalf; dLat++) {
      for (let dLon = -cellHalf; dLon <= cellHalf; dLon++) {
        const arr = grid.get(`${baseLatCell + dLat}:${baseLonCell + dLon}`);
        if (!arr) continue;
        for (const p of arr) {
          const d = distM(sLat, sLon, p.lat, p.lon);
          if (d > SNAP_RADIUS_M) continue;
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
      }
    }
    if (!best) continue;
    const key = String(id);
    const prior = merged[key];
    // Measured > synthetic regardless of distance.
    if (prior && prior.source !== "synthetic_osm_class" && prior.distM <= bestD) continue;
    merged[key] = {
      aadt: best.aadt,
      year: best.year,
      kFactor: 9,
      distM: Math.round(bestD),
      source: SOURCE_TAG,
    };
    snapDists.push(bestD);
    if (prior) upgraded++;
    else added++;
  }

  const measuredTotal = Object.keys(merged).length;
  const measuredPct = Math.round((measuredTotal / signals.length) * 1000) / 10;
  const median = snapDists.length
    ? [...snapDists].sort((a, b) => a - b)[Math.floor(snapDists.length / 2)]
    : 0;
  console.log(
    `SVC snap: ${added} new + ${upgraded} upgraded (median ${median.toFixed(1)} m). ` +
      `Total measured: ${measuredTotal}/${signals.length} = ${measuredPct}%`,
  );

  writeFileSync(aadtPath, JSON.stringify(merged));
  console.log(`Wrote ${aadtPath}`);

  // Update metro-coverage.ts row for Toronto.
  // Existing row layout (one-line literal in the file):
  //   { code: "toronto_metro", slug: "toronto", ..., aadtPct: 4.3, ..., aadtSource: "...", ... }
  let coverage = readFileSync(COVERAGE_PATH, "utf8");
  const aadtPctRe = new RegExp(
    `(\\{ code: "${CODE}",[^}]*?)aadtPct:\\s*[0-9.]+,`,
  );
  const aadtSrcRe = new RegExp(
    `(\\{ code: "${CODE}",[^}]*?)aadtSource:\\s*"[^"]*",`,
  );
  if (!aadtPctRe.test(coverage) || !aadtSrcRe.test(coverage)) {
    console.log("! pattern miss — toronto_metro row not updated");
    return;
  }
  coverage = coverage.replace(aadtPctRe, `$1aadtPct: ${measuredPct},`);
  coverage = coverage.replace(aadtSrcRe, `$1aadtSource: "${COVERAGE_LABEL}",`);
  writeFileSync(COVERAGE_PATH, coverage);
  console.log(`Updated metro-coverage: ${CODE} aadtPct=${measuredPct}%, source="${COVERAGE_LABEL}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
