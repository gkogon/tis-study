/**
 * Fetch measured AADT for a Japanese metro from MLIT's 令和3年度
 * 全国道路・街路交通情勢調査（道路交通センサス, 2021 National Road Traffic Census).
 *
 * Source: the official census result web-map serves the surveyed road
 * network as tiled GeoJSON at
 *   https://www.mlit.go.jp/road/ir/ir-data/census_visualizationR3/<rank>/{z}/{x}/{y}.geojson
 * (z=13). Each LineString/MultiLineString feature carries the census
 * section ID plus observed volumes:
 *   - census   : 交通調査基本区間番号 (section ID)
 *   - 24H_trf  : 平日24時間自動車類交通量 (weekday 24-hour vehicle count) ← AADT proxy
 *   - 12H_trf  : daytime 12-hour count
 *   - konz     : 混雑度 (congestion ratio)
 *   - speed_ME / speed_DT : peak / off-peak travel speed
 *
 * 24H_trf is the closest official Japanese equivalent to AADT. It is a
 * single-day weekday observation (Japan does not publish AAWDT→AADT
 * factors per point), so it slightly overstates a true annual-average
 * for weekend-light corridors, but it is real measured data on the
 * actual centerline and is the national standard input for Japanese
 * traffic-impact work.
 *
 * Census coverage is the major-road network (国道・主要地方道・主要市道),
 * not every residential street, so the snapped share of signals is
 * naturally lower than the synthetic baseline — that's the honest
 * measured footprint.
 *
 * Output: <slug>-aadt.json overlays the synthetic baseline with
 * source: "mlit_census_r3_2021" for snapped signals, and updates the
 * metro-coverage.ts row for the metro.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-jp-census-aadt.ts <metro>
 *   where <metro> is one of: tokyo osaka yokohama nagoya sapporo
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

const BASE = "https://www.mlit.go.jp/road/ir/ir-data/census_visualizationR3";
const RANKS = ["drm10", "drm20", "drm31", "drm32", "drm40_50", "drm60_70"];
const ZOOM = 13;

const SNAP_RADIUS_M = 70; // signals sit on the surveyed centerline
const DENSIFY_M = 25; // interpolate centerline points at this spacing
const GRID_DEG = 0.0025; // ~250 m spatial-index cell

type BBox = { latMin: number; latMax: number; lonMin: number; lonMax: number };

// bounds mirror tis-api-server/src/lib/regions.ts <code>.bounds
const REGIONS: Record<string, { code: string; bbox: BBox }> = {
  tokyo: { code: "tokyo_metro", bbox: { latMin: 35.55, latMax: 35.83, lonMin: 139.55, lonMax: 139.9 } },
  osaka: { code: "osaka_metro", bbox: { latMin: 34.55, latMax: 34.78, lonMin: 135.35, lonMax: 135.62 } },
  yokohama: { code: "yokohama_metro", bbox: { latMin: 35.32, latMax: 35.55, lonMin: 139.5, lonMax: 139.72 } },
  nagoya: { code: "nagoya_metro", bbox: { latMin: 35.06, latMax: 35.24, lonMin: 136.83, lonMax: 137.05 } },
  sapporo: { code: "sapporo_metro", bbox: { latMin: 43.0, latMax: 43.2, lonMin: 141.2, lonMax: 141.5 } },
};

const CENSUS_SOURCE_LABEL =
  "MLIT 全国道路・街路交通情勢調査（道路交通センサス）令和3年度 — 24h observed volumes";

type AadtRec = { aadt: number; year: number; kFactor: number; distM: number; source: string };
type CandPoint = { lat: number; lon: number; aadt: number };

function lon2x(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
function lat2y(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z);
}

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mLon;
  const dy = (lat2 - lat1) * mLat;
  return Math.sqrt(dx * dx + dy * dy);
}

async function fetchTile(rank: string, x: number, y: number): Promise<unknown | null> {
  const url = `${BASE}/${rank}/${ZOOM}/${x}/${y}.geojson`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    console.warn(`  ! ${res.status} ${url}`);
    return null;
  }
  return res.json();
}

// Walk an array of [lon,lat] vertices, emitting densified candidate points.
function densifyLine(coords: number[][], aadt: number, out: CandPoint[]): void {
  for (let i = 0; i < coords.length; i++) {
    const [lon, lat] = coords[i];
    out.push({ lat, lon, aadt });
    if (i === coords.length - 1) break;
    const [lon2, lat2] = coords[i + 1];
    const segLen = distM(lat, lon, lat2, lon2);
    const steps = Math.floor(segLen / DENSIFY_M);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push({ lat: lat + (lat2 - lat) * t, lon: lon + (lon2 - lon) * t, aadt });
    }
  }
}

function gridKey(lat: number, lon: number): string {
  return `${Math.floor(lat / GRID_DEG)}:${Math.floor(lon / GRID_DEG)}`;
}

async function main(): Promise<void> {
  const slug = process.argv[2];
  const region = slug ? REGIONS[slug] : undefined;
  if (!region) {
    console.error(`Usage: tsx src/fetch-jp-census-aadt.ts <metro>\n  metro ∈ {${Object.keys(REGIONS).join(", ")}}`);
    process.exit(1);
  }
  const { code, bbox: BBOX } = region;
  console.log(`Metro: ${slug} (${code})  bbox ${JSON.stringify(BBOX)}`);

  // 1. Determine the tile window covering the bbox.
  const xMin = lon2x(BBOX.lonMin, ZOOM);
  const xMax = lon2x(BBOX.lonMax, ZOOM);
  const yMin = lat2y(BBOX.latMax, ZOOM); // north edge → smaller y
  const yMax = lat2y(BBOX.latMin, ZOOM);
  const tiles: Array<{ x: number; y: number }> = [];
  for (let x = xMin; x <= xMax; x++) for (let y = yMin; y <= yMax; y++) tiles.push({ x, y });
  console.log(
    `Tile window z${ZOOM}: x ${xMin}..${xMax}, y ${yMin}..${yMax} = ${tiles.length} tiles × ${RANKS.length} ranks`,
  );

  // 2. Fetch all tiles/ranks with a small concurrency pool; collect dense candidate points.
  const candidates: CandPoint[] = [];
  const seenCensus = new Set<string>();
  const jobs: Array<{ rank: string; x: number; y: number }> = [];
  for (const rank of RANKS) for (const t of tiles) jobs.push({ rank, ...t });

  let done = 0;
  let hitTiles = 0;
  const POOL = 10;
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const gj = (await fetchTile(job.rank, job.x, job.y)) as
        | { features?: Array<{ geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }> }
        | null;
      done++;
      if (gj?.features?.length) {
        hitTiles++;
        for (const f of gj.features) {
          const vol = f.properties?.["24H_trf"];
          const census = String(f.properties?.["census"] ?? "");
          if (typeof vol !== "number" || vol <= 0) continue;
          // dedupe links that span multiple tiles by census ID
          if (census && seenCensus.has(census)) continue;
          if (census) seenCensus.add(census);
          const g = f.geometry;
          if (g.type === "LineString") {
            densifyLine(g.coordinates as number[][], vol, candidates);
          } else if (g.type === "MultiLineString") {
            for (const part of g.coordinates as number[][][]) densifyLine(part, vol, candidates);
          }
        }
      }
      if (done % 100 === 0) console.log(`  fetched ${done}/${jobs.length} (tiles with data: ${hitTiles})`);
    }
  }
  await Promise.all(Array.from({ length: POOL }, () => worker()));
  console.log(
    `Census links: ${seenCensus.size} unique sections → ${candidates.length} densified candidate points (tiles with data: ${hitTiles})`,
  );

  // 3. Spatial-index candidates into a grid.
  const grid = new Map<string, CandPoint[]>();
  for (const c of candidates) {
    const k = gridKey(c.lat, c.lon);
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(c);
  }

  // 4. Snap signals to nearest candidate within radius.
  const sigPath = path.resolve(DATA_DIR, `${slug}-signals.json`);
  const aadtPath = path.resolve(DATA_DIR, `${slug}-aadt.json`);
  const signals = JSON.parse(readFileSync(sigPath, "utf8")) as Array<
    [number, number, number, string | null, number]
  >;
  const existing = existsSync(aadtPath)
    ? (JSON.parse(readFileSync(aadtPath, "utf8")) as Record<string, AadtRec>)
    : {};

  const measured: Record<string, AadtRec> = {};
  const snapDists: number[] = [];
  for (const [osmId, sLat, sLon] of signals) {
    const baseLatCell = Math.floor(sLat / GRID_DEG);
    const baseLonCell = Math.floor(sLon / GRID_DEG);
    let best: { aadt: number; d: number } | null = null;
    for (let dLat = -1; dLat <= 1; dLat++) {
      for (let dLon = -1; dLon <= 1; dLon++) {
        const arr = grid.get(`${baseLatCell + dLat}:${baseLonCell + dLon}`);
        if (!arr) continue;
        for (const c of arr) {
          const d = distM(sLat, sLon, c.lat, c.lon);
          if (d > SNAP_RADIUS_M) continue;
          if (!best || d < best.d) best = { aadt: c.aadt, d };
        }
      }
    }
    if (best) {
      measured[String(osmId)] = {
        aadt: best.aadt,
        year: 2021,
        kFactor: 9,
        distM: Math.round(best.d),
        source: "mlit_census_r3_2021",
      };
      snapDists.push(best.d);
    }
  }
  const snapped = snapDists.length;
  const pct = (snapped / signals.length) * 100;
  const median = snapped ? [...snapDists].sort((a, b) => a - b)[Math.floor(snapped / 2)] : 0;
  console.log(`Snapped ${snapped} / ${signals.length} = ${pct.toFixed(1)}% (median ${median.toFixed(1)}m to centerline)`);

  // 5. Merge measured over synthetic baseline.
  const merged: Record<string, AadtRec> = {};
  for (const [k, v] of Object.entries(existing)) {
    if (v.source === "synthetic_osm_class") merged[k] = v;
  }
  for (const [k, v] of Object.entries(measured)) merged[k] = v;
  writeFileSync(aadtPath, JSON.stringify(merged));
  console.log(
    `Wrote ${aadtPath} — ${Object.keys(merged).length} total (measured ${snapped}, synthetic ${Object.keys(merged).length - snapped})`,
  );

  // 6. Update metro-coverage.ts row for this metro.
  const measuredPct = Math.round(pct * 10) / 10;
  let coverage = readFileSync(COVERAGE_PATH, "utf8");
  const pattern = new RegExp(
    `(\\{ code: "${code}",[^}]*?)aadtPct:\\s*[0-9.]+,([^}]*?)aadtSource:\\s*"[^"]*",\\s*aadtQuality:\\s*"[^"]*",`,
  );
  if (pattern.test(coverage)) {
    coverage = coverage.replace(
      pattern,
      `$1aadtPct: ${measuredPct},$2aadtSource: "${CENSUS_SOURCE_LABEL}", aadtQuality: "measured",`,
    );
    writeFileSync(COVERAGE_PATH, coverage);
    console.log(`Updated ${code}: aadtPct=${measuredPct}%, quality=measured`);
  } else {
    console.log(`! pattern miss — ${code} coverage row not updated`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
