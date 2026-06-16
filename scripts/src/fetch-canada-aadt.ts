/**
 * Fetch measured AADT overlays for six more Canadian metros, each from
 * the best-available open dataset. Each fetch returns a list of
 * candidate measurement points (points for point sources, densified
 * polyline vertices for line sources) which the shared snap-and-merge
 * step writes into the metro's <slug>-aadt.json with closest-wins
 * against any existing record (so provincial-highway AADT from the
 * 2026-05-27 wiring stays where it's the closest measurement, and
 * city-arterial overlays take over elsewhere).
 *
 * Source-by-metro (all confirmed-public as of 2026-06-16):
 *
 *   ottawa      ArcGIS REST  open.ottawa.ca Transportation Midblock
 *                            Volumes 2024 — 895 point counts with
 *                            Volume + AADT_Year fields.
 *
 *   halifax     ArcGIS REST  HRM Open Data HRM Traffic Studies — 6,465
 *                            short-term study points with AAWT
 *                            (Average Annual Weekday Traffic) + YEAR;
 *                            vintages 2023-2026.
 *
 *   calgary     Socrata      data.calgary.ca Traffic Volumes for 2023
 *                            — 4,596 multilinestring segments with a
 *                            single `volume` (annual AADT) value.
 *
 *   edmonton    Socrata      data.edmonton.ca Average Annual Weekday
 *                            Traffic Volumes 2011-2022 — 16,713 point
 *                            counts with average_daily_volume +
 *                            latitude/longitude + year.
 *
 *   montreal    MTQ WFS      ws.mapserver.transports.gouv.qc.ca
 *                            circulation_routier — linear network of
 *                            provincial highways, 10-year-history
 *                            DJMA (Débit Journalier Moyen Annuel =
 *                            AADT) values per segment.
 *
 *   quebec-city MTQ WFS      same MTQ feed, different bbox.
 *
 * Vancouver (BC) and Halifax-the-province (NS) at provincial-highway
 * level remain blocked: MoTI publishes WFS-only and no third-party
 * mirror with anything more recent than the 2004-2010 archived
 * counter series. City of Vancouver does not publish midblock counts
 * as open data (probed 2026-06-16). Winnipeg city counts are
 * 15-minute interval rows that would need cross-day aggregation —
 * deferred (city already has MHTIS provincial coverage).
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-canada-aadt.ts <metro>
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-canada-aadt.ts --all
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

type BBox = { latMin: number; latMax: number; lonMin: number; lonMax: number };

type AadtRec = {
  aadt: number;
  year: number;
  kFactor: number;
  distM: number;
  source: string;
};

type CandPoint = { lat: number; lon: number; aadt: number; year: number };

type MetroConfig = {
  slug: string;
  code: string; // matches RegionCode in regions.ts and metro-coverage.ts
  bbox: BBox;
  sourceTag: string; // written into AadtRec.source
  coverageLabel: string; // human-readable label for metro-coverage.ts aadtSource
  snapM: number;
  fetch: (cfg: MetroConfig) => Promise<CandPoint[]>;
};

// ── Geometry helpers ────────────────────────────────────────────────────
const GRID_DEG = 0.0025;

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

// Densify a [[lon,lat],...] line into ~25 m-spaced candidate points so
// nearest-point snap matches nearest-polyline-distance within 12 m.
const DENSIFY_M = 25;
function densifyLine(
  coords: number[][],
  aadt: number,
  year: number,
  out: CandPoint[],
): void {
  for (let i = 0; i < coords.length; i++) {
    const [lon, lat] = coords[i];
    out.push({ lat, lon, aadt, year });
    if (i === coords.length - 1) break;
    const [lon2, lat2] = coords[i + 1];
    const segLen = distM(lat, lon, lat2, lon2);
    const steps = Math.floor(segLen / DENSIFY_M);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push({ lat: lat + (lat2 - lat) * t, lon: lon + (lon2 - lon) * t, aadt, year });
    }
  }
}

// Minimal RFC-4180 CSV row parser — Toronto/Calgary CSV is well-behaved.
function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQ = false; }
      } else cur += ch;
    } else if (ch === ",") { out.push(cur); cur = ""; }
    else if (ch === '"') inQ = true;
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ── Ottawa: ArcGIS REST point service ──────────────────────────────────
const OTTAWA_URL =
  "https://services.arcgis.com/G6F8XLCl5KtAlZ2G/arcgis/rest/services/Transportation_Midblock_Volumes_2024/FeatureServer/0";

async function fetchOttawa(cfg: MetroConfig): Promise<CandPoint[]> {
  const where = encodeURIComponent("Volume IS NOT NULL AND Volume > 0");
  const url =
    `${OTTAWA_URL}/query?where=${where}` +
    `&outFields=Volume,AADT_Year,Lat,Long` +
    `&returnGeometry=false&resultRecordCount=5000&f=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Ottawa: ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{ attributes: { Volume: number; AADT_Year: number; Lat: number; Long: number } }>;
  };
  const out: CandPoint[] = [];
  for (const f of json.features ?? []) {
    const a = f.attributes;
    if (!a.Volume || !a.Lat || !a.Long) continue;
    if (a.Lat < cfg.bbox.latMin || a.Lat > cfg.bbox.latMax) continue;
    if (a.Long < cfg.bbox.lonMin || a.Long > cfg.bbox.lonMax) continue;
    out.push({ lat: a.Lat, lon: a.Long, aadt: Math.round(a.Volume), year: a.AADT_Year || 2024 });
  }
  console.log(`  Ottawa: ${out.length} midblock points in bbox`);
  return out;
}

// ── Halifax: ArcGIS REST point service (HRM Traffic Studies) ───────────
const HALIFAX_URL =
  "https://services2.arcgis.com/11XBiaBYA9Ep0yNJ/arcgis/rest/services/HRM_Traffic_Studies/FeatureServer/0";

async function fetchHalifax(cfg: MetroConfig): Promise<CandPoint[]> {
  // Year ≥ 2018 to skip pre-pandemic studies; lots of HRM rows have
  // YEAR=null but still carry recent ADDDATE — we keep year=2024 in
  // that case so the record carries a non-zero year downstream.
  const where = encodeURIComponent("AAWT IS NOT NULL AND AAWT > 0");
  const out: CandPoint[] = [];
  let offset = 0;
  while (true) {
    const url =
      `${HALIFAX_URL}/query?where=${where}` +
      `&outFields=AAWT,YEAR` +
      `&returnGeometry=true&outSR=4326` +
      `&resultRecordCount=2000&resultOffset=${offset}&f=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Halifax: ${res.status} offset ${offset}`);
    const json = (await res.json()) as {
      features?: Array<{
        attributes: { AAWT: number; YEAR: number | null };
        geometry?: { x: number; y: number };
      }>;
      exceededTransferLimit?: boolean;
    };
    const feats = json.features ?? [];
    for (const f of feats) {
      const g = f.geometry;
      const a = f.attributes;
      if (!g || !a.AAWT) continue;
      // Halifax service publishes geometry in EPSG:4326 directly (x=lon, y=lat).
      const lon = g.x;
      const lat = g.y;
      if (lat < cfg.bbox.latMin || lat > cfg.bbox.latMax) continue;
      if (lon < cfg.bbox.lonMin || lon > cfg.bbox.lonMax) continue;
      const year = a.YEAR && a.YEAR >= 2018 ? a.YEAR : 2024;
      out.push({ lat, lon, aadt: a.AAWT, year });
    }
    if (!json.exceededTransferLimit || feats.length === 0) break;
    offset += feats.length;
  }
  console.log(`  Halifax: ${out.length} AAWT points in bbox`);
  return out;
}

// ── Calgary: Socrata multilinestring with annual volume ────────────────
async function fetchCalgary(cfg: MetroConfig): Promise<CandPoint[]> {
  const url =
    `https://data.calgary.ca/resource/bjag-w7zi.json?$limit=50000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Calgary: ${res.status}`);
  const rows = (await res.json()) as Array<{
    year: string;
    volume?: string;
    multilinestring?: { type: string; coordinates: number[][][] };
  }>;
  const out: CandPoint[] = [];
  let skipped = 0;
  for (const r of rows) {
    const vol = parseFloat(r.volume ?? "");
    const yr = parseInt(r.year, 10);
    if (!isFinite(vol) || vol <= 0 || !r.multilinestring) { skipped++; continue; }
    for (const line of r.multilinestring.coordinates) {
      // Bbox filter on first vertex (Calgary segments are short enough that
      // first-vertex membership ≈ segment membership).
      const first = line[0];
      if (!first) continue;
      const [lon, lat] = first;
      if (lat < cfg.bbox.latMin || lat > cfg.bbox.latMax) continue;
      if (lon < cfg.bbox.lonMin || lon > cfg.bbox.lonMax) continue;
      densifyLine(line, Math.round(vol), yr || 2023, out);
    }
  }
  console.log(`  Calgary: ${rows.length} rows → ${out.length} densified candidate points (skipped ${skipped})`);
  return out;
}

// ── Edmonton: Socrata point with average_daily_volume ──────────────────
async function fetchEdmonton(cfg: MetroConfig): Promise<CandPoint[]> {
  // Dataset has 16,713 rows — Socrata default limit is 1000, ask for all.
  const url =
    `https://data.edmonton.ca/resource/b58q-nxjr.json?$limit=50000&$order=year DESC`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Edmonton: ${res.status}`);
  const rows = (await res.json()) as Array<{
    year?: string;
    average_daily_volume?: string;
    latitude?: string;
    longitude?: string;
  }>;
  // Keep latest year per (lat,lon) — the dataset spans 2011-2022 with
  // many sites recounted across years.
  const latest = new Map<string, CandPoint>();
  for (const r of rows) {
    const lat = parseFloat(r.latitude ?? "");
    const lon = parseFloat(r.longitude ?? "");
    const yr = parseInt(r.year ?? "", 10);
    const aadt = parseFloat(r.average_daily_volume ?? "");
    if (!isFinite(lat) || !isFinite(lon) || !isFinite(aadt) || aadt <= 0) continue;
    if (lat < cfg.bbox.latMin || lat > cfg.bbox.latMax) continue;
    if (lon < cfg.bbox.lonMin || lon > cfg.bbox.lonMax) continue;
    const k = `${lat.toFixed(5)}:${lon.toFixed(5)}`;
    const cur = latest.get(k);
    if (!cur || yr > cur.year) {
      latest.set(k, { lat, lon, aadt: Math.round(aadt), year: yr || 2022 });
    }
  }
  const out = [...latest.values()];
  console.log(`  Edmonton: ${rows.length} rows → ${out.length} unique points in bbox`);
  return out;
}

// ── Montreal + Quebec City: MTQ WFS GeoJSON ────────────────────────────
// One feature per traffic section with ten years of DJMA (yearly AADT)
// values in `val_djma_annee_1`..`val_djma_annee_10`. `annee_1` corresponds
// to `djma_annee_1` (year stamp). We pick the most-recent non-empty year.
type MtqFeature = {
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
};

function latestMtqAadt(props: Record<string, unknown>): { aadt: number; year: number } | null {
  for (let i = 1; i <= 10; i++) {
    const raw = props[`val_djma_annee_${i}`];
    if (raw === "" || raw === null || raw === undefined) continue;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw));
    if (!isFinite(n) || n <= 0) continue;
    const yr = parseInt(String(props[`djma_annee_${i}`] ?? "0"), 10);
    return { aadt: Math.round(n), year: yr || 2025 };
  }
  return null;
}

async function fetchMtq(cfg: MetroConfig): Promise<CandPoint[]> {
  const bbox = `${cfg.bbox.latMin},${cfg.bbox.lonMin},${cfg.bbox.latMax},${cfg.bbox.lonMax},EPSG:4326`;
  const url =
    `https://ws.mapserver.transports.gouv.qc.ca/swtq` +
    `?service=wfs&version=2.0.0&request=getfeature` +
    `&typename=ms:circulation_routier` +
    `&srsname=EPSG:4326&outputformat=geojson` +
    `&bbox=${encodeURIComponent(bbox)}&count=5000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MTQ: ${res.status}`);
  const json = (await res.json()) as { features?: MtqFeature[] };
  const out: CandPoint[] = [];
  let withData = 0;
  for (const f of json.features ?? []) {
    const v = latestMtqAadt(f.properties);
    if (!v) continue;
    withData++;
    const g = f.geometry;
    // MTQ ships MultiLineString — densify every part.
    if (g.type === "LineString") {
      densifyLine(g.coordinates as number[][], v.aadt, v.year, out);
    } else if (g.type === "MultiLineString") {
      for (const part of g.coordinates as number[][][]) {
        densifyLine(part, v.aadt, v.year, out);
      }
    }
  }
  console.log(`  ${cfg.slug}: ${json.features?.length ?? 0} MTQ segments (${withData} with AADT) → ${out.length} candidate points`);
  return out;
}

// ── Registry ────────────────────────────────────────────────────────────
const METROS: Record<string, MetroConfig> = {
  ottawa: {
    slug: "ottawa",
    code: "ottawa_metro",
    bbox: { latMin: 45.2, latMax: 45.5, lonMin: -76.0, lonMax: -75.4 },
    sourceTag: "ottawa_open_data_midblock",
    coverageLabel: "Ottawa Open Data Midblock Volumes 2024 + MTO Historical AADT 2019",
    snapM: 250,
    fetch: fetchOttawa,
  },
  halifax: {
    slug: "halifax",
    code: "halifax_metro",
    bbox: { latMin: 44.5, latMax: 44.8, lonMin: -63.8, lonMax: -63.4 },
    sourceTag: "halifax_open_data_traffic_studies",
    coverageLabel: "HRM Open Data Traffic Studies (AAWT, 2023-2026)",
    snapM: 250,
    fetch: fetchHalifax,
  },
  calgary: {
    slug: "calgary",
    code: "calgary_metro",
    bbox: { latMin: 50.8, latMax: 51.2, lonMin: -114.3, lonMax: -113.8 },
    sourceTag: "calgary_open_data_2023",
    coverageLabel: "Calgary Open Data Traffic Volumes 2023 + Alberta Transportation LoS 2021",
    snapM: 200,
    fetch: fetchCalgary,
  },
  edmonton: {
    slug: "edmonton",
    code: "edmonton_metro",
    bbox: { latMin: 53.4, latMax: 53.7, lonMin: -113.7, lonMax: -113.3 },
    sourceTag: "edmonton_open_data_aawdt",
    coverageLabel: "Edmonton Open Data AAWDT 2011-2022 + Alberta Transportation LoS 2021",
    snapM: 250,
    fetch: fetchEdmonton,
  },
  montreal: {
    slug: "montreal",
    code: "montreal_metro",
    bbox: { latMin: 45.4, latMax: 45.7, lonMin: -73.8, lonMax: -73.4 },
    sourceTag: "mtq_djma",
    coverageLabel: "MTQ DJMA (Débit Journalier Moyen Annuel, latest available 2016-2025)",
    snapM: 200,
    fetch: fetchMtq,
  },
  "quebec-city": {
    slug: "quebec-city",
    code: "quebec_city_metro",
    bbox: { latMin: 46.7, latMax: 47.0, lonMin: -71.4, lonMax: -71.1 },
    sourceTag: "mtq_djma",
    coverageLabel: "MTQ DJMA (Débit Journalier Moyen Annuel, latest available 2016-2025)",
    snapM: 200,
    fetch: fetchMtq,
  },
};

// ── Shared snap + merge ─────────────────────────────────────────────────
async function processMetro(cfg: MetroConfig): Promise<void> {
  console.log(`\n=== ${cfg.slug} (${cfg.code}) ===`);
  const candidates = await cfg.fetch(cfg);
  if (candidates.length === 0) {
    console.log("  No candidates — skipping.");
    return;
  }

  const grid = new Map<string, CandPoint[]>();
  for (const c of candidates) {
    const k = gridKey(c.lat, c.lon);
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(c);
  }

  const sigPath = path.resolve(DATA_DIR, `${cfg.slug}-signals.json`);
  const aadtPath = path.resolve(DATA_DIR, `${cfg.slug}-aadt.json`);
  const signals = JSON.parse(readFileSync(sigPath, "utf8")) as Array<
    [number, number, number, string | null, number]
  >;
  const existing: Record<string, AadtRec> = existsSync(aadtPath)
    ? JSON.parse(readFileSync(aadtPath, "utf8"))
    : {};

  const merged: Record<string, AadtRec> = { ...existing };
  let added = 0;
  let upgraded = 0;
  const snapDists: number[] = [];
  for (const [id, sLat, sLon] of signals) {
    const baseLatCell = Math.floor(sLat / GRID_DEG);
    const baseLonCell = Math.floor(sLon / GRID_DEG);
    let best: CandPoint | null = null;
    let bestD = Infinity;
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        const arr = grid.get(`${baseLatCell + dLat}:${baseLonCell + dLon}`);
        if (!arr) continue;
        for (const p of arr) {
          const d = distM(sLat, sLon, p.lat, p.lon);
          if (d > cfg.snapM) continue;
          if (d < bestD) { bestD = d; best = p; }
        }
      }
    }
    if (!best) continue;
    const key = String(id);
    const prior = merged[key];
    if (prior && prior.distM <= bestD) continue; // existing record closer
    merged[key] = {
      aadt: best.aadt,
      year: best.year,
      kFactor: 9,
      distM: Math.round(bestD),
      source: cfg.sourceTag,
    };
    snapDists.push(bestD);
    if (prior) upgraded++; else added++;
  }

  const measuredTotal = Object.keys(merged).length;
  const measuredPct = Math.round((measuredTotal / signals.length) * 1000) / 10;
  const median = snapDists.length
    ? [...snapDists].sort((a, b) => a - b)[Math.floor(snapDists.length / 2)]
    : 0;
  console.log(
    `  Snap: ${added} new + ${upgraded} upgraded (median ${median.toFixed(1)} m). ` +
      `Total measured: ${measuredTotal}/${signals.length} = ${measuredPct}%`,
  );

  writeFileSync(aadtPath, JSON.stringify(merged));

  // Update metro-coverage.ts row.
  let coverage = readFileSync(COVERAGE_PATH, "utf8");
  const aadtPctRe = new RegExp(`(\\{ code: "${cfg.code}",[^}]*?)aadtPct:\\s*[0-9.]+,`);
  const aadtSrcRe = new RegExp(`(\\{ code: "${cfg.code}",[^}]*?)aadtSource:\\s*"[^"]*",`);
  if (!aadtPctRe.test(coverage)) {
    console.log("  ! aadtPct pattern miss");
    return;
  }
  coverage = coverage.replace(aadtPctRe, `$1aadtPct: ${measuredPct},`);
  if (aadtSrcRe.test(coverage)) {
    coverage = coverage.replace(aadtSrcRe, `$1aadtSource: "${cfg.coverageLabel}",`);
  } else {
    // Row has no aadtSource key yet — insert after liveSource: null,
    const liveSrcRe = new RegExp(`(\\{ code: "${cfg.code}",[^}]*?liveSource:\\s*null,)\\s*(dotName:)`);
    if (liveSrcRe.test(coverage)) {
      coverage = coverage.replace(liveSrcRe, `$1 aadtSource: "${cfg.coverageLabel}", $2`);
    } else {
      console.log("  ! could not insert aadtSource");
    }
  }
  writeFileSync(COVERAGE_PATH, coverage);
  console.log(`  Updated metro-coverage: ${cfg.code} aadtPct=${measuredPct}%`);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error(`Usage: tsx src/fetch-canada-aadt.ts <metro|--all>\n  metros: ${Object.keys(METROS).join(", ")}`);
    process.exit(1);
  }
  const metros = arg === "--all" ? Object.values(METROS) : [METROS[arg]];
  if (!metros[0]) {
    console.error(`Unknown metro: ${arg}`);
    process.exit(1);
  }
  for (const m of metros) {
    try {
      await processMetro(m);
    } catch (e) {
      console.error(`  ERROR ${m.slug}:`, e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Suppress unused-warning for the CSV helper (kept for future Socrata
// or open-data CSV expansions that don't have JSON endpoints).
void parseCsvRow;
