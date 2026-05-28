/**
 * UK DfT Road Traffic Statistics AADF → per-metro AADT JSON.
 *
 * DfT publishes a world-class national flow dataset (the "AADF" — Annual
 * Average Daily Flow, functionally equivalent to AADT). 46k count points
 * across the entire UK road network, latest year 2024, free, no auth.
 *
 * Endpoint: https://roadtraffic.dft.gov.uk/api/average-annual-daily-flow
 *   ?filter[year]=2024&page[size]=5000&page[number]=N
 *
 * Each row has lat/lon + count_point_id + all_motor_vehicles (the AADT-
 * equivalent total) + per-vehicle-class splits. We snap to all_motor_vehicles.
 *
 * Pulls all UK 2024 AADF once, writes per-metro <slug>-aadt.json for the 7
 * wired UK metros. Re-runs are idempotent (downloads + processes again,
 * data is small enough — ~4MB per page).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-dft-aadt.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../../artifacts/api-server/src/data");

const API = "https://roadtraffic.dft.gov.uk/api/average-annual-daily-flow";
const YEAR = 2024;
const PAGE_SIZE = 5000;
const SNAP_M = 400;  // a bit wider than US point-station snap; UK count points are sparser per-metro

const UK_METROS: Record<string, { latMin: number; latMax: number; lonMin: number; lonMax: number }> = {
  london: { latMin: 51.28, latMax: 51.69, lonMin: -0.51, lonMax: 0.33 },
  "manchester-uk": { latMin: 53.35, latMax: 53.60, lonMin: -2.42, lonMax: -2.05 },
  "birmingham-uk": { latMin: 52.40, latMax: 52.58, lonMin: -2.02, lonMax: -1.70 },
  glasgow: { latMin: 55.78, latMax: 55.95, lonMin: -4.42, lonMax: -4.10 },
  edinburgh: { latMin: 55.88, latMax: 56.00, lonMin: -3.40, lonMax: -3.00 },
  leeds: { latMin: 53.70, latMax: 53.90, lonMin: -1.72, lonMax: -1.40 },
  bristol: { latMin: 51.40, latMax: 51.55, lonMin: -2.70, lonMax: -2.40 },
};

type AadfRow = {
  count_point_id: number;
  year: number;
  latitude: string;  // DfT returns these as strings
  longitude: string;
  road_name: string;
  road_type: string;
  all_motor_vehicles: number;
  all_hgvs: number;
  cars_and_taxis: number;
};

type CountPoint = { id: number; lat: number; lon: number; aadt: number; road: string };

const M_PER_DEG_LAT = 111_320;
function mPerDegLonAt(lat: number): number {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}
function pointDistMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const midLat = (lat1 + lat2) / 2;
  const mPerLon = mPerDegLonAt(midLat);
  return Math.sqrt(((lat1 - lat2) * M_PER_DEG_LAT) ** 2 + ((lon1 - lon2) * mPerLon) ** 2);
}

async function fetchAllPages(): Promise<CountPoint[]> {
  const out: CountPoint[] = [];
  let page = 1;
  while (true) {
    const url = `${API}?filter%5Byear%5D=${YEAR}&page%5Bsize%5D=${PAGE_SIZE}&page%5Bnumber%5D=${page}`;
    console.log(`  fetching page ${page}...`);
    const res = await fetch(url, { headers: { "User-Agent": "tis-study/1.0", Accept: "application/json" } });
    if (!res.ok) throw new Error(`DfT page ${page}: ${res.status}`);
    const json = (await res.json()) as { data: AadfRow[]; last_page: number };
    for (const r of json.data) {
      const aadt = r.all_motor_vehicles;
      if (!Number.isFinite(aadt) || aadt <= 0) continue;
      const lat = parseFloat(r.latitude);
      const lon = parseFloat(r.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      out.push({ id: r.count_point_id, lat, lon, aadt, road: r.road_name ?? "" });
    }
    if (page >= json.last_page) break;
    page++;
  }
  return out;
}

function buildGrid(points: CountPoint[]): Map<string, CountPoint[]> {
  const grid = new Map<string, CountPoint[]>();
  for (const p of points) {
    const k = `${Math.floor(p.lat / 0.005)}_${Math.floor(p.lon / 0.005)}`;
    let bucket = grid.get(k);
    if (!bucket) { bucket = []; grid.set(k, bucket); }
    bucket.push(p);
  }
  return grid;
}

async function main(): Promise<void> {
  console.log("Fetching all UK 2024 AADF from DfT...");
  const all = await fetchAllPages();
  console.log(`Got ${all.length} count points with 2024 AADF\n`);

  for (const [slug, bbox] of Object.entries(UK_METROS)) {
    const signalsPath = resolve(DATA_DIR, `${slug}-signals.json`);
    if (!existsSync(signalsPath)) {
      console.warn(`  ! ${slug}: no signals file, skipping`);
      continue;
    }
    const signals = JSON.parse(readFileSync(signalsPath, "utf8")) as Array<
      [number, number, number, string | null, number]
    >;

    // Filter DfT points to this metro's bbox
    const inMetro = all.filter(
      (p) => p.lat >= bbox.latMin && p.lat <= bbox.latMax && p.lon >= bbox.lonMin && p.lon <= bbox.lonMax,
    );
    const grid = buildGrid(inMetro);

    const result: Record<string, { aadt: number; year: number; kFactor: number; distM: number; source: "ncdot" }> = {};
    const distances: number[] = [];
    let snapped = 0;

    for (const [sid, lat, lon] of signals) {
      const latCell = Math.floor(lat / 0.005);
      const lonCell = Math.floor(lon / 0.005);
      let best: { p: CountPoint; d: number } | null = null;
      for (let dlat = -3; dlat <= 3; dlat++) {
        for (let dlon = -3; dlon <= 3; dlon++) {
          const bucket = grid.get(`${latCell + dlat}_${lonCell + dlon}`);
          if (!bucket) continue;
          for (const p of bucket) {
            const d = pointDistMeters(lat, lon, p.lat, p.lon);
            if (d <= SNAP_M && (best === null || d < best.d)) best = { p, d };
          }
        }
      }
      if (best) {
        result[String(sid)] = {
          aadt: best.p.aadt,
          year: YEAR,
          kFactor: 9,
          distM: Math.round(best.d),
          source: "ncdot",
        };
        snapped++;
        distances.push(best.d);
      }
    }

    distances.sort((a, b) => a - b);
    const p50 = Math.round(distances[Math.floor(distances.length / 2)] ?? 0);
    const p90 = Math.round(distances[Math.floor(distances.length * 0.9)] ?? 0);
    const outPath = resolve(DATA_DIR, `${slug}-aadt.json`);
    writeFileSync(outPath, JSON.stringify(result));
    console.log(
      `${slug.padEnd(16)} pts=${String(inMetro.length).padStart(5)}  snapped ${snapped} / ${signals.length}  (${((snapped / signals.length) * 100).toFixed(1)}%)  p50=${p50}m p90=${p90}m`,
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
