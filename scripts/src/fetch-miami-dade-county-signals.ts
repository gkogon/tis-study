/**
 * Pull Miami-Dade County's authoritative signal inventory and merge it into
 * the existing OSM-derived miami-dade-signals.json.
 *
 * Mirrors fetch-charlotte-cdot-signals.ts (same merge strategy / tuple
 * schema). Differences:
 *   - Source: services.arcgis.com/8Pc9XBTAsYuxx9Ny/.../TrafficSignals_gdb
 *   - Coverage: 6,033 total signals across Miami-Dade County
 *   - Name field: INTRSECTN (already in "Street A & Street B" form — just
 *     normalize whitespace; no underscore reformat like Charlotte's UNITDESC)
 *   - No SERVSTAT filter — Miami-Dade exposes a CNSTRSTAT code instead. We
 *     keep everything (no public data dictionary maps the codes); a future
 *     pass can filter out specific construction states once we have the key.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-miami-dade-county-signals.ts
 */

import { writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const COUNTY_LAYER =
  "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/TrafficSignals_gdb/FeatureServer/0";
const PAGE_SIZE = 2000; // matches the layer's maxRecordCount
const MATCH_RADIUS_M = 50;

type SignalTuple = [number, number, number, string | null, number];

type CountyFeature = {
  attributes: {
    OBJECTID: number;
    ASSETID: number | null;
    INTRSECTN: string | null;
    SYSTEMCONTROL: string | null;
    LAT: number | null;
    LON: number | null;
  };
  geometry?: { x: number; y: number };
};

/** Normalize INTRSECTN. Miami-Dade's field is already in "Street A & Street B"
 *  shape, so we just collapse whitespace and trim. Null/blank returns null
 *  (caller falls back to roads naming if available). */
function normalizeName(intrsectn: string | null): string | null {
  if (!intrsectn) return null;
  const s = intrsectn.replace(/\s+/g, " ").trim();
  return s.length > 0 ? s : null;
}

async function fetchAllCountyFeatures(): Promise<CountyFeature[]> {
  const out: CountyFeature[] = [];
  let offset = 0;
  while (true) {
    const url =
      `${COUNTY_LAYER}/query` +
      `?where=${encodeURIComponent("1=1")}` +
      `&outFields=OBJECTID,ASSETID,INTRSECTN,SYSTEMCONTROL,LAT,LON` +
      `&outSR=4326` +
      `&resultRecordCount=${PAGE_SIZE}` +
      `&resultOffset=${offset}` +
      `&f=json`;
    console.log(`  fetching page offset=${offset}`);
    const res = await fetch(url, { headers: { "User-Agent": "tis-study/1.0" } });
    if (!res.ok) throw new Error(`Miami-Dade query failed at offset ${offset}: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { features?: CountyFeature[]; exceededTransferLimit?: boolean };
    const features = json.features ?? [];
    out.push(...features);
    if (!json.exceededTransferLimit || features.length === 0) break;
    offset += features.length;
  }
  return out;
}

function distMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const M_PER_DEG_LAT = 111_320;
  const midLat = (lat1 + lat2) / 2;
  const mPerDegLon = 111_320 * Math.cos((midLat * Math.PI) / 180);
  const dy = (lat1 - lat2) * M_PER_DEG_LAT;
  const dx = (lon1 - lon2) * mPerDegLon;
  return Math.sqrt(dx * dx + dy * dy);
}

function buildOsmIndex(osm: SignalTuple[]): Map<string, number[]> {
  const idx = new Map<string, number[]>();
  for (let i = 0; i < osm.length; i++) {
    const [, lat, lon] = osm[i]!;
    const k = `${Math.floor(lat / 0.005)}_${Math.floor(lon / 0.005)}`;
    let bucket = idx.get(k);
    if (!bucket) { bucket = []; idx.set(k, bucket); }
    bucket.push(i);
  }
  return idx;
}

function findNearestOsmIdx(
  osm: SignalTuple[],
  idx: Map<string, number[]>,
  lat: number,
  lon: number,
  maxM: number,
): { osmIdx: number; distM: number } | null {
  const latCell = Math.floor(lat / 0.005);
  const lonCell = Math.floor(lon / 0.005);
  let best: { osmIdx: number; distM: number } | null = null;
  for (let dlat = -1; dlat <= 1; dlat++) {
    for (let dlon = -1; dlon <= 1; dlon++) {
      const bucket = idx.get(`${latCell + dlat}_${lonCell + dlon}`);
      if (!bucket) continue;
      for (const i of bucket) {
        const [, olat, olon] = osm[i]!;
        const d = distMeters(lat, lon, olat, olon);
        if (d <= maxM && (best === null || d < best.distM)) {
          best = { osmIdx: i, distM: d };
        }
      }
    }
  }
  return best;
}

async function main(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = path.resolve(__dirname, "../../artifacts/api-server/src/data");
  const archiveDir = path.resolve(dataDir, "_osm-archive");
  const signalsPath = path.resolve(dataDir, "miami-dade-signals.json");

  if (!existsSync(signalsPath)) {
    throw new Error(`Existing OSM signals not found at ${signalsPath}. Run fetch-osm-signals first.`);
  }

  mkdirSync(archiveDir, { recursive: true });
  const archivePath = path.resolve(archiveDir, "miami-dade-signals.json");
  if (!existsSync(archivePath)) {
    copyFileSync(signalsPath, archivePath);
    console.log(`Archived OSM-only signals → ${archivePath}`);
  }

  console.log("Loading OSM baseline...");
  const osm = JSON.parse(readFileSync(signalsPath, "utf8")) as SignalTuple[];
  console.log(`  OSM signals: ${osm.length}`);

  console.log("Pulling Miami-Dade County signals...");
  const county = await fetchAllCountyFeatures();
  console.log(`  County signals fetched: ${county.length}`);

  const idx = buildOsmIndex(osm);

  let matched = 0;
  let unmatched = 0;
  let badCoord = 0;
  const newTuples: SignalTuple[] = [];
  const merged: SignalTuple[] = osm.map((t) => [...t] as SignalTuple);

  for (const f of county) {
    // Prefer geometry coords (server-projected to WGS84 via outSR); fall back
    // to LAT/LON attribute fields if geometry is missing.
    const lat = f.geometry?.y ?? f.attributes.LAT;
    const lon = f.geometry?.x ?? f.attributes.LON;
    if (typeof lat !== "number" || typeof lon !== "number" || !isFinite(lat) || !isFinite(lon)) {
      badCoord++;
      continue;
    }
    const name = normalizeName(f.attributes.INTRSECTN);
    const countyId = f.attributes.ASSETID ?? f.attributes.OBJECTID;

    const m = findNearestOsmIdx(merged, idx, lat, lon, MATCH_RADIUS_M);
    if (m) {
      const [osmId] = merged[m.osmIdx]!;
      merged[m.osmIdx] = [osmId, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, name, 2];
      matched++;
    } else {
      newTuples.push([-countyId, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, name, 2]);
      unmatched++;
    }
  }

  const finalTuples = [...merged, ...newTuples];
  writeFileSync(signalsPath, JSON.stringify(finalTuples));

  console.log("");
  console.log(`Matched (OSM ←County overlay):  ${matched}`);
  console.log(`Unmatched County (added new):   ${unmatched}`);
  console.log(`Bad coords skipped:             ${badCoord}`);
  console.log(`OSM-only (no county equivalent):${osm.length - matched}`);
  console.log(`Total signals after merge:      ${finalTuples.length}`);
  console.log(`Wrote → ${signalsPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
