/**
 * Pull Charlotte CDOT's authoritative signal inventory and merge it into the
 * existing OSM-derived charlotte-signals.json.
 *
 * Why merge, not replace:
 *   - CDOT's layer covers ONLY signals inside Charlotte city limits (~1,395
 *     total, ~1,292 operational).
 *   - The OSM dump covers the full Charlotte MSA (4,198 signals), including
 *     Mecklenburg suburbs + Cabarrus / Union / Gaston / Lincoln / Iredell
 *     counties + York/Chester/Lancaster on the SC side.
 *   - A straight replacement would silently lose coverage in every suburb.
 *
 * Merge strategy:
 *   1. Pull all CDOT operational signals (SERVSTAT='OP').
 *   2. For each CDOT signal, find the nearest OSM signal within 50m.
 *   3. Match → replace name+coords with CDOT data, keep OSM id (stable refs).
 *   4. No match → emit a CDOT-only tuple with id = -SIGNAL_ID (negative,
 *      distinguishable from OSM ids which are always positive).
 *   5. Unmatched OSM signals pass through untouched.
 *
 * Schema preserved (tuple): [id, lat, lon, name|null, roadClass]
 *   id        → OSM id (positive) or -CDOT SIGNAL_ID (negative)
 *   name      → CDOT UNITDESC reformatted ("STREET A & STREET B"), or null
 *               (caller falls back to OSM roads-based naming)
 *   roadClass → left at 2 (placeholder, derived at serve time)
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-charlotte-cdot-signals.ts
 */

import { writeFileSync, readFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDOT_LAYER =
  "https://gis.charlottenc.gov/arcgis/rest/services/Accela/Accela/MapServer/11";
const PAGE_SIZE = 1000;
const MATCH_RADIUS_M = 50;

type SignalTuple = [number, number, number, string | null, number];

type CdotFeature = {
  attributes: {
    OBJECTID: number;
    SIGNAL_ID: number | null;
    UNITDESC: string | null;
    UNITTYPEDESC: string | null;
    SERVSTAT: string | null;
  };
  geometry: { x: number; y: number };
};

/** Reformat CDOT UNITDESC ("MOORES CHAPEL RD_SAM WILSON RD") to "Street A & Street B".
 *  Title-cases the result to match how the OSM-derived names render in the UI. */
function formatIntersectionName(unitdesc: string | null): string | null {
  if (!unitdesc) return null;
  const cleaned = unitdesc.trim();
  if (!cleaned) return null;
  // CDOT uses a single underscore to separate the two intersecting streets.
  // Some records have stray multi-underscores — split on first underscore, rejoin remainder.
  const parts = cleaned.split("_");
  if (parts.length < 2) return titleCase(cleaned);
  const a = titleCase(parts[0]!.trim());
  const b = titleCase(parts.slice(1).join("_").trim());
  if (!a || !b) return titleCase(cleaned);
  return `${a} & ${b}`;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => {
      // Keep common road suffixes / abbreviations uppercase or capitalize properly.
      const upper = w.toUpperCase();
      if (["NC", "SC", "US", "I", "II", "III", "IV", "NW", "NE", "SW", "SE"].includes(upper)) return upper;
      // Capitalize first letter for everything else.
      return w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1);
    })
    .join(" ");
}

async function fetchAllCdotFeatures(): Promise<CdotFeature[]> {
  const out: CdotFeature[] = [];
  let offset = 0;
  while (true) {
    const url =
      `${CDOT_LAYER}/query` +
      `?where=${encodeURIComponent("SERVSTAT='OP'")}` +
      `&outFields=OBJECTID,SIGNAL_ID,UNITDESC,UNITTYPEDESC,SERVSTAT` +
      `&outSR=4326` +
      `&resultRecordCount=${PAGE_SIZE}` +
      `&resultOffset=${offset}` +
      `&f=json`;
    console.log(`  fetching page offset=${offset}`);
    const res = await fetch(url, { headers: { "User-Agent": "tis-study/1.0" } });
    if (!res.ok) throw new Error(`CDOT query failed at offset ${offset}: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { features?: CdotFeature[]; exceededTransferLimit?: boolean };
    const features = json.features ?? [];
    out.push(...features);
    if (!json.exceededTransferLimit || features.length === 0) break;
    offset += features.length;
  }
  return out;
}

/** Equirectangular meters between two lat/lon points — plenty accurate intra-metro. */
function distMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const M_PER_DEG_LAT = 111_320;
  const midLat = (lat1 + lat2) / 2;
  const mPerDegLon = 111_320 * Math.cos((midLat * Math.PI) / 180);
  const dy = (lat1 - lat2) * M_PER_DEG_LAT;
  const dx = (lon1 - lon2) * mPerDegLon;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Build a coarse 0.005°-grid spatial index over OSM signals for fast nearest lookup. */
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
  const signalsPath = path.resolve(dataDir, "charlotte-signals.json");

  if (!existsSync(signalsPath)) {
    throw new Error(`Existing OSM signals not found at ${signalsPath}. Run fetch-osm-signals first.`);
  }

  // Archive the OSM-only version before we overwrite. Idempotent.
  mkdirSync(archiveDir, { recursive: true });
  const archivePath = path.resolve(archiveDir, "charlotte-signals.json");
  if (!existsSync(archivePath)) {
    copyFileSync(signalsPath, archivePath);
    console.log(`Archived OSM-only signals → ${archivePath}`);
  }

  console.log("Loading OSM baseline...");
  const osm = JSON.parse(readFileSync(signalsPath, "utf8")) as SignalTuple[];
  console.log(`  OSM signals: ${osm.length}`);

  console.log("Pulling CDOT signals...");
  const cdot = await fetchAllCdotFeatures();
  console.log(`  CDOT operational signals fetched: ${cdot.length}`);

  // Build spatial index on OSM
  const idx = buildOsmIndex(osm);

  // Walk CDOT signals: match → overlay; no match → emit new tuple with negative id.
  let matched = 0;
  let unmatched = 0;
  let badCoord = 0;
  const newTuples: SignalTuple[] = [];

  // Mutable copy of OSM tuples so we can overlay name/coords in place.
  const merged: SignalTuple[] = osm.map((t) => [...t] as SignalTuple);

  for (const f of cdot) {
    const lat = f.geometry?.y;
    const lon = f.geometry?.x;
    if (typeof lat !== "number" || typeof lon !== "number" || !isFinite(lat) || !isFinite(lon)) {
      badCoord++;
      continue;
    }
    const name = formatIntersectionName(f.attributes.UNITDESC);
    const cdotId = f.attributes.SIGNAL_ID ?? f.attributes.OBJECTID;

    const m = findNearestOsmIdx(merged, idx, lat, lon, MATCH_RADIUS_M);
    if (m) {
      // Overlay: keep OSM id (stable refs across runs), replace coords + name
      // with CDOT values. roadClass stays at 2 — derived at serve time.
      const [osmId] = merged[m.osmIdx]!;
      merged[m.osmIdx] = [osmId, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, name, 2];
      matched++;
    } else {
      // CDOT-only signal: emit with negative id to mark provenance.
      newTuples.push([-cdotId, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, name, 2]);
      unmatched++;
    }
  }

  const finalTuples = [...merged, ...newTuples];
  writeFileSync(signalsPath, JSON.stringify(finalTuples));

  console.log("");
  console.log(`Matched (OSM ←CDOT overlay):  ${matched}`);
  console.log(`Unmatched CDOT (added new):   ${unmatched}`);
  console.log(`Bad coords skipped:           ${badCoord}`);
  console.log(`OSM-only (suburb signals):    ${osm.length - matched}`);
  console.log(`Total signals after merge:    ${finalTuples.length}`);
  console.log(`Wrote → ${signalsPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
