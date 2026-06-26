/**
 * ALDOT historical AADT deep-fill for Alabama metros (Birmingham/Huntsville/Mobile).
 *
 * WHY THIS EXISTS (state-specific, MTIA-driven):
 *   The generic federal overlay (fetch-hpms-aadt.ts) is the usual way we light up
 *   the local/collector network a state-DOT's *current* feed leaves dark. But the
 *   FHWA HPMS Public Release on geo.dot.gov is presently returning HTTP 500 for
 *   every state (its backing DB host is refusing connections), so the federal
 *   path is unavailable. The ITE Multimodal Transportation Impact Analysis RP
 *   (RP-020G-E, 2023) §3.4.2 (Field Reconnaissance & Data Collection) and §5.5
 *   (Data Sources) establish a hierarchy: prefer the best available *local*,
 *   measured count, recency-ranked, over any modeled/synthetic value. So when the
 *   federal aggregate is down, fall back to the state's OWN deeper layer.
 *
 *   ALDOT's TDMPublic layer carries ~282k point stations spanning 2014-2025 — far
 *   more than the `YearAADT IN (2024,2025)` slice the primary wire
 *   (fetch-aadt-by-signal.ts) ingests. Those older-but-real stations sit on the
 *   exact local arterials/collectors where signals go dark. This script mines the
 *   full active layer and MERGES with a PREFER-NEWER-YEAR rule: a signal keeps its
 *   existing (fresher) value; only genuinely dark signals get filled, with the
 *   nearest measured station. No 2024-2025 count is ever overwritten by an older one.
 *
 *   This is the "vary by state" pattern: each state publishes its AADT differently,
 *   so the deepening source is state-specific. Alabama → ALDOT TDMPublic. The merge
 *   semantics (prefer-newer, fill-dark, measured-over-synthetic) are shared.
 *
 * Read-mostly: rewrites <slug>-aadt.json (merge only) and bumps aadtPct +
 * appends the source provenance in metro-coverage.ts.
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-aldot-deepfill.ts birmingham
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-aldot-deepfill.ts birmingham huntsville mobile
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS, type RegionCode } from "../../artifacts/tis-api-server/src/lib/regions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

const ALDOT_URL =
  "https://aldotgis.dot.state.al.us/pubgis2/rest/services/EGISATDServices/TDMPublic/MapServer/0/query";
const WHERE = "IsActive = 1 AND AADT > 0"; // all active years — the deep historical layer
const SNAP_M = 500; // matches the ALDOT point-station snap used by the primary wire
const DEFAULT_K_FACTOR_PCT = 9;
const PAGE_SIZE = 2000; // = layer maxRecordCount
const SOURCE_TAG = "aldot";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const regionSlug = (code: string) => code.replace(/_metro$/, "").replace(/_/g, "-");

type AadtRec = { aadt: number; year: number; kFactor: number; distM: number; source: string };
type Signal = [number, number, number, (string | null)?, number?];

// ── spatial grid over ALDOT point stations ────────────────────────────
const CELL_DEG = 0.01;
type Station = { aadt: number; year: number; lat: number; lon: number };
type Grid = Map<number, Station[]>;
const cellKey = (a: number, b: number) => ((a + 20000) << 16) | (b + 20000);

function addStation(grid: Grid, s: Station) {
  const lk = Math.floor(s.lat / CELL_DEG);
  const lo = Math.floor(s.lon / CELL_DEG);
  const k = cellKey(lk, lo);
  let arr = grid.get(k);
  if (!arr) { arr = []; grid.set(k, arr); }
  arr.push(s);
}

function distM(lat: number, lon: number, s: Station): number {
  const mLat = 111_320, mLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot((lon - s.lon) * mLon, (lat - s.lat) * mLat);
}

/** Nearest station within SNAP_M, scanning the 3×3 cell neighborhood. */
function nearest(grid: Grid, lat: number, lon: number): { aadt: number; year: number; distM: number } | null {
  const cl = Math.floor(lat / CELL_DEG), cn = Math.floor(lon / CELL_DEG);
  let best: { aadt: number; year: number; distM: number } | null = null;
  for (let dl = -1; dl <= 1; dl++) for (let dn = -1; dn <= 1; dn++) {
    const arr = grid.get(cellKey(cl + dl, cn + dn));
    if (!arr) continue;
    for (const s of arr) {
      const d = distM(lat, lon, s);
      if (d > SNAP_M) continue;
      if (!best || d < best.distM) best = { aadt: s.aadt, year: s.year, distM: Math.round(d) };
    }
  }
  return best;
}

type AldotFeature = { attributes: { AADT: number | null; YearAADT: number | null }; geometry?: { x: number; y: number } };

async function fetchStations(b: { latMin: number; latMax: number; lonMin: number; lonMax: number }): Promise<{ grid: Grid; count: number }> {
  const env = `${b.lonMin},${b.latMin},${b.lonMax},${b.latMax}`;
  const grid: Grid = new Map();
  let offset = 0, count = 0;
  for (let page = 0; page < 200; page++) {
    const url = `${ALDOT_URL}?where=${encodeURIComponent(WHERE)}&geometry=${encodeURIComponent(env)}`
      + `&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects`
      + `&outFields=${encodeURIComponent("AADT,YearAADT")}&returnGeometry=true`
      + `&resultOffset=${offset}&resultRecordCount=${PAGE_SIZE}&f=json`;
    let json: { features?: AldotFeature[]; exceededTransferLimit?: boolean; error?: unknown } | null = null;
    for (let attempt = 0; attempt < 4 && !json; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        const j = await res.json();
        if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 120));
        json = j;
      } catch (e) {
        if (attempt === 3) throw e;
        await sleep(3000 + attempt * 3000);
      }
    }
    const feats = json!.features ?? [];
    for (const f of feats) {
      const aadt = f.attributes.AADT;
      const yr = f.attributes.YearAADT ?? 0;
      if (!aadt || aadt <= 0 || !f.geometry) continue;
      addStation(grid, { aadt, year: yr, lat: f.geometry.y, lon: f.geometry.x });
      count++;
    }
    if (!json!.exceededTransferLimit || feats.length === 0) break;
    offset += feats.length;
    await sleep(300);
  }
  return { grid, count };
}

function loadExisting(slug: string): Record<string, AadtRec> {
  const p = path.resolve(DATA_DIR, `${slug}-aadt.json`);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
}

function updateCoverage(coverage: string, code: string, newPct: number): string {
  const pctRe = new RegExp(`(\\{ code: "${code}",[^}]*?aadtPct:\\s*)([0-9.]+)`);
  let next = coverage.replace(pctRe, `$1${newPct}`);
  const srcRe = new RegExp(`(\\{ code: "${code}",[^}]*?aadtSource:\\s*")([^"]*)(")`);
  next = next.replace(srcRe, (m, pre, src, post) =>
    src.includes("historical") ? m : `${pre}${src} + ALDOT historical deep-fill (2014-2025)${post}`);
  return next;
}

async function processMetro(code: RegionCode, coverageRef: { text: string }): Promise<void> {
  const region = REGIONS[code];
  const slug = regionSlug(code);
  if (region.stateCode !== "AL") { console.log(`  skip ${slug} (not Alabama; this deep-fill is ALDOT-specific)`); return; }
  const sigPath = path.resolve(DATA_DIR, `${slug}-signals.json`);
  if (!existsSync(sigPath)) { console.log(`  skip ${slug} (no signals)`); return; }

  const signals: Signal[] = JSON.parse(readFileSync(sigPath, "utf8"));
  const existing = loadExisting(slug);
  const existingCount = Object.keys(existing).length;

  let res;
  try { res = await fetchStations(region.bounds); }
  catch (e) { console.log(`  ✗ ${slug}: ALDOT fetch failed (${(e as Error).message.slice(0, 100)})`); return; }

  const merged: Record<string, AadtRec> = { ...existing };
  let filled = 0, replaced = 0, snapped = 0;
  for (const [id, lat, lon] of signals) {
    const hit = nearest(res.grid, lat, lon);
    if (!hit) continue;
    snapped++;
    const key = String(id);
    const prev = merged[key];
    const rec: AadtRec = { aadt: hit.aadt, year: hit.year, kFactor: DEFAULT_K_FACTOR_PCT, distM: hit.distM, source: SOURCE_TAG };
    if (!prev) { merged[key] = rec; filled++; }
    else if (hit.year > prev.year) { merged[key] = rec; replaced++; }
  }

  writeFileSync(path.resolve(DATA_DIR, `${slug}-aadt.json`), JSON.stringify(merged));
  const total = signals.length;
  const newPct = Math.round((Object.keys(merged).length / total) * 1000) / 10;
  const oldPct = Math.round((existingCount / total) * 1000) / 10;
  coverageRef.text = updateCoverage(coverageRef.text, code, newPct);
  console.log(`  ✓ ${slug} [AL]: ${res.count} ALDOT stations | snapped ${snapped}/${total} | filled ${filled} replaced ${replaced} | coverage ${oldPct}% → ${newPct}%`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const want = new Set(args.length ? args : ["birmingham"]);
  const codes = (Object.keys(REGIONS) as RegionCode[]).filter((c) => want.has(regionSlug(c)) || want.has(c));
  if (!codes.length) { console.error("Usage: fetch-aldot-deepfill.ts <slug...>  (default: birmingham)"); process.exit(2); }
  console.log(`ALDOT historical deep-fill over ${codes.length} metro(s)`);
  const coverageRef = { text: readFileSync(COVERAGE_PATH, "utf8") };
  for (const code of codes) await processMetro(code, coverageRef);
  writeFileSync(COVERAGE_PATH, coverageRef.text);
  console.log("=== done ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
