/**
 * FHWA HPMS national AADT overlay for US metros.
 *
 * The per-state DOT wires (fetch-aadt-by-signal.ts) mostly publish AADT only on
 * the STATE highway system, leaving local-agency arterials and collectors dark —
 * which is why ~44 US metros sit below 75% coverage (California worst: Caltrans
 * is state-highway-only, so LA was ~22%). FHWA's HPMS Public Release is the
 * federal aggregate of every state's submittal and carries AADT on the entire
 * Federal-Aid System (principal + minor arterials, major + urban collectors) —
 * exactly where signals live. It's served per-state as ArcGIS FeatureServers:
 *   https://geo.dot.gov/server/rest/services/Hosted/<State>_2018_PR/FeatureServer/0
 * with lowercase fields `aadt`, `year_record`, `f_system`, polyline geometry.
 *
 * This script snaps that HPMS AADT onto each signal and MERGES it into the
 * metro's existing <slug>-aadt.json with a PREFER-NEWER-YEAR rule: a signal
 * keeps its existing state-DOT value unless HPMS is newer; dark signals get
 * filled. So fresher station-measured counts are never lost, and the local
 * network that had nothing gets real measured volumes. Source: "fhwa_hpms_2018".
 *
 * 2018 is the latest PUBLIC HPMS release on geo.dot.gov (2019+ require a token).
 * States without a public service (NC/RI/NJ/SC/SD as of probe) are skipped —
 * they already have state-DOT coverage.
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-hpms-aadt.ts los-angeles
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-hpms-aadt.ts --partial   # all US metros < 75%
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-hpms-aadt.ts --all-us
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS, type RegionCode } from "../../artifacts/tis-api-server/src/lib/regions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

const HPMS_YEAR = 2018;
const SNAP_M = 200;
const DEFAULT_K_FACTOR_PCT = 9; // FHWA standard urban arterial
const PAGE_SIZE = 2000;
const PARTIAL_THRESHOLD = 75;

// stateCode → HPMS Public Release service name stem (underscored full state
// name). geo.dot.gov hosts `Hosted/<stem>_2018_PR/FeatureServer/0`.
const STATE_HPMS_STEM: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District_of_Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New_Hampshire", NJ: "New_Jersey",
  NM: "New_Mexico", NY: "New_York", NC: "North_Carolina", ND: "North_Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode_Island", SC: "South_Carolina", SD: "South_Dakota",
  TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia",
  WA: "Washington", WV: "West_Virginia", WI: "Wisconsin", WY: "Wyoming",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const regionSlug = (code: string) => code.replace(/_metro$/, "").replace(/_/g, "-");

type AadtRec = { aadt: number; year: number; kFactor: number; distM: number; source: string };
type Signal = [number, number, number, (string | null)?, number?];

// ── spatial grid over HPMS polyline segments ──────────────────────────
const CELL_DEG = 0.01;
type Seg = { aadt: number; year: number; alat: number; alon: number; blat: number; blon: number };
type Grid = Map<number, Seg[]>;
const cellKey = (a: number, b: number) => ((a + 20000) << 16) | (b + 20000);

function addSeg(grid: Grid, s: Seg) {
  const lk = Math.floor((s.alat + s.blat) / 2 / CELL_DEG);
  const lo = Math.floor((s.alon + s.blon) / 2 / CELL_DEG);
  for (let dl = -1; dl <= 1; dl++) for (let dn = -1; dn <= 1; dn++) {
    const k = cellKey(lk + dl, lo + dn);
    let arr = grid.get(k);
    if (!arr) { arr = []; grid.set(k, arr); }
    arr.push(s);
  }
}

function distToSeg(lat: number, lon: number, s: Seg): number {
  const mLat = 111_320, mLon = 111_320 * Math.cos((lat * Math.PI) / 180);
  const px = (lon - s.alon) * mLon, py = (lat - s.alat) * mLat;
  const dx = (s.blon - s.alon) * mLon, dy = (s.blat - s.alat) * mLat;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px, py);
  let t = (px * dx + py * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(t * dx - px, t * dy - py);
}

function nearest(grid: Grid, lat: number, lon: number): { aadt: number; year: number; distM: number } | null {
  const segs = grid.get(cellKey(Math.floor(lat / CELL_DEG), Math.floor(lon / CELL_DEG)));
  if (!segs) return null;
  let best: { aadt: number; year: number; distM: number } | null = null;
  for (const s of segs) {
    const d = distToSeg(lat, lon, s);
    if (d > SNAP_M) continue;
    if (!best || d < best.distM) best = { aadt: s.aadt, year: s.year, distM: Math.round(d) };
  }
  return best;
}

type HpmsFeature = {
  attributes: { aadt: number | null; year_record: number | null };
  geometry?: { paths: Array<Array<[number, number]>> };
};

/** Fetch all aadt>0 HPMS segments in a bbox, paginated, into a snap grid. */
async function fetchHpmsGrid(stem: string, b: { latMin: number; latMax: number; lonMin: number; lonMax: number }): Promise<{ grid: Grid; segs: number } | null> {
  const base = `https://geo.dot.gov/server/rest/services/Hosted/${stem}_${HPMS_YEAR}_PR/FeatureServer/0/query`;
  const env = `${b.lonMin},${b.latMin},${b.lonMax},${b.latMax}`;
  const grid: Grid = new Map();
  let offset = 0, total = 0;
  for (let page = 0; page < 200; page++) {
    const url = `${base}?where=${encodeURIComponent("aadt>0")}&geometry=${encodeURIComponent(env)}`
      + `&geometryType=esriGeometryEnvelope&inSR=4326&outSR=4326&spatialRel=esriSpatialRelIntersects`
      + `&outFields=${encodeURIComponent("aadt,year_record")}&returnGeometry=true`
      + `&resultOffset=${offset}&resultRecordCount=${PAGE_SIZE}&f=json`;
    let json: { features?: HpmsFeature[]; exceededTransferLimit?: boolean; error?: unknown } | null = null;
    for (let attempt = 0; attempt < 4 && !json; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        const j = await res.json();
        if (j.error) { if (offset === 0 && page === 0) return null; throw new Error(JSON.stringify(j.error)); }
        json = j;
      } catch (e) {
        if (attempt === 3) throw e;
        await sleep(3000 + attempt * 3000);
      }
    }
    const feats = json!.features ?? [];
    for (const f of feats) {
      const aadt = f.attributes.aadt;
      const yr = f.attributes.year_record ?? HPMS_YEAR;
      if (!aadt || aadt <= 0 || !f.geometry?.paths) continue;
      for (const pathPts of f.geometry.paths) {
        for (let i = 0; i < pathPts.length - 1; i++) {
          const a = pathPts[i]!, c = pathPts[i + 1]!;
          // ArcGIS polyline coords are [lon, lat]
          addSeg(grid, { aadt, year: yr, alat: a[1], alon: a[0], blat: c[1], blon: c[0] });
          total++;
        }
      }
    }
    if (!json!.exceededTransferLimit || feats.length === 0) break;
    offset += feats.length;
    await sleep(400);
  }
  return { grid, segs: total };
}

function loadExisting(slug: string): Record<string, AadtRec> {
  const p = path.resolve(DATA_DIR, `${slug}-aadt.json`);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return {}; }
}

function updateCoverage(coverage: string, code: string, newPct: number): string {
  // Bump aadtPct, and append "+ FHWA HPMS 2018" to aadtSource once.
  const pctRe = new RegExp(`(\\{ code: "${code}",[^}]*?aadtPct:\\s*)([0-9.]+)`);
  let next = coverage.replace(pctRe, `$1${newPct}`);
  const srcRe = new RegExp(`(\\{ code: "${code}",[^}]*?aadtSource:\\s*")([^"]*)(")`);
  next = next.replace(srcRe, (m, pre, src, post) =>
    src.includes("HPMS") ? m : `${pre}${src} + FHWA HPMS 2018${post}`);
  return next;
}

async function processMetro(code: RegionCode, coverageRef: { text: string }): Promise<void> {
  const region = REGIONS[code];
  const slug = regionSlug(code);
  const stateCode = region.stateCode;
  const stem = STATE_HPMS_STEM[stateCode];
  const sigPath = path.resolve(DATA_DIR, `${slug}-signals.json`);
  if (!existsSync(sigPath)) { console.log(`  skip ${slug} (no signals)`); return; }
  if (!stem) { console.log(`  skip ${slug} (no HPMS stem for ${stateCode})`); return; }

  const signals: Signal[] = JSON.parse(readFileSync(sigPath, "utf8"));
  const existing = loadExisting(slug);
  const existingCount = Object.keys(existing).length;

  let res;
  try {
    res = await fetchHpmsGrid(stem, region.bounds);
  } catch (e) {
    console.log(`  ✗ ${slug}: HPMS fetch failed (${(e as Error).message.slice(0, 80)})`);
    return;
  }
  if (!res) { console.log(`  skip ${slug} (${stateCode} has no public HPMS ${HPMS_YEAR} service)`); return; }

  const merged: Record<string, AadtRec> = { ...existing };
  let filled = 0, replaced = 0, snapped = 0;
  for (const [id, lat, lon] of signals) {
    const hit = nearest(res.grid, lat, lon);
    if (!hit) continue;
    snapped++;
    const key = String(id);
    const prev = merged[key];
    const rec: AadtRec = { aadt: hit.aadt, year: hit.year, kFactor: DEFAULT_K_FACTOR_PCT, distM: hit.distM, source: "fhwa_hpms_2018" };
    if (!prev) { merged[key] = rec; filled++; }
    else if (hit.year > prev.year) { merged[key] = rec; replaced++; }
  }

  writeFileSync(path.resolve(DATA_DIR, `${slug}-aadt.json`), JSON.stringify(merged));
  const total = signals.length;
  const newPct = Math.round((Object.keys(merged).length / total) * 1000) / 10;
  const oldPct = Math.round((existingCount / total) * 1000) / 10;
  coverageRef.text = updateCoverage(coverageRef.text, code, newPct);
  console.log(`  ✓ ${slug} [${stateCode}]: ${res.segs} HPMS segs, snapped ${snapped}/${total} | filled ${filled} replaced ${replaced} | coverage ${oldPct}% → ${newPct}%`);
}

function isUS(code: RegionCode): boolean {
  const r = REGIONS[code];
  return r.active && (r.country === undefined || r.country === "US") && code !== "atlanta_metro";
}

function coveragePct(code: RegionCode): number {
  const slug = regionSlug(code);
  const sigPath = path.resolve(DATA_DIR, `${slug}-signals.json`);
  if (!existsSync(sigPath)) return 100;
  const signals: unknown[] = JSON.parse(readFileSync(sigPath, "utf8"));
  const existing = loadExisting(slug);
  if (!signals.length) return 100;
  return (Object.keys(existing).length / signals.length) * 100;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const usCodes = (Object.keys(REGIONS) as RegionCode[]).filter(isUS);
  let codes: RegionCode[];
  if (args.includes("--all-us")) codes = usCodes;
  else if (args.includes("--partial")) codes = usCodes.filter((c) => coveragePct(c) < PARTIAL_THRESHOLD);
  else {
    const want = new Set(args.filter((a) => !a.startsWith("--")));
    codes = usCodes.filter((c) => want.has(regionSlug(c)) || want.has(c));
  }
  if (!codes.length) {
    console.error("Usage: fetch-hpms-aadt.ts <slug...> | --partial | --all-us");
    process.exit(2);
  }
  console.log(`HPMS overlay over ${codes.length} US metro(s)`);
  const coverageRef = { text: readFileSync(COVERAGE_PATH, "utf8") };
  for (const code of codes) await processMetro(code, coverageRef);
  writeFileSync(COVERAGE_PATH, coverageRef.text);
  console.log("=== done ===");
}

main().catch((e) => { console.error(e); process.exit(1); });
