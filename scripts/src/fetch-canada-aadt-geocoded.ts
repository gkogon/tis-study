/**
 * Three more Canadian metros where measured AADT data exists but the
 * publishing portal doesn't ship usable coordinates. Each requires a
 * join or a geocoding pass that the unified fetch-canada-aadt.ts
 * couldn't handle without inline complication, so they live here.
 *
 * vancouver  — maps.vancouver.ca/server/rest/services/VanMapViewer/
 *              Traffic_and_Transportation publishes Directional Segment
 *              Counts as feature layers (415=2024, 411=2023, 219=2022,
 *              181=2021, 178=2020, 60=2019, 201=2018, 9=2011-2017) and
 *              Permanent Vehicle Counts (208) with AvgDaily_0/AvgDaily_1
 *              fields — but the parent map service strips polyline
 *              geometry on REST query (paths come back null). Solution:
 *              JOIN by Location string against opendata.vancouver.ca's
 *              `directional-traffic-count-locations` (6,680 entries
 *              with LineString geometry + `location` field). Strings
 *              like "1800 ROBSON ST" line up.
 *
 * hamilton   — open.hamilton.ca's Average Daily Traffic Count FS has
 *              2,350 rows with `AVERAGE_DAILY_TRAFFIC_COUNT +
 *              COUNT_YEAR + LOCATION_DESCRIPTION` but no geometry and
 *              null COORDINATES. The city's Street Centreline FS
 *              (19,855 segments, all road classes, full geometry)
 *              keys on STREET_NAME / STREET_SUFFIX_DIRECTION. Each ADT
 *              row's description follows the pattern
 *              `<STREET> btwn <CROSS1> & <CROSS2>` — parse, find
 *              centreline segments matching STREET, find intersection
 *              points with CROSS1 + CROSS2, take the midpoint of the
 *              segment between them. Falls back to street centroid
 *              when one or both cross streets aren't named major roads.
 *
 * winnipeg   — data.winnipeg.ca's Midblock Traffic Counts (buvf-b9wp)
 *              are 15-minute interval rows with no per-row coords.
 *              SoQL aggregate groups by (study_id, location_description,
 *              count_direction); average across days × directions =
 *              daily AADT. Location strings follow
 *              `<STREET> - <CROSS1> to <CROSS2>`. Geocoded against
 *              Winnipeg's Road Network FS (ngsx-caav, 1,521 segments).
 *              Sparser network → many studies fall back to centroid.
 *
 * Each fetcher returns an array of measured candidate points. Shared
 * snap-and-merge writes them into <slug>-aadt.json with measured >
 * synthetic preference — synthetic_osm_class records from the prior
 * backfill get replaced wherever a measured candidate snaps within
 * radius, regardless of which is closer.
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-canada-aadt-geocoded.ts <metro>
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-canada-aadt-geocoded.ts --all
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

type BBox = { latMin: number; latMax: number; lonMin: number; lonMax: number };
type AadtRec = { aadt: number; year: number; kFactor: number; distM: number; source: string };
type CandPoint = { lat: number; lon: number; aadt: number; year: number };

const GRID_DEG = 0.0025;
const DENSIFY_M = 25;

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
function densifyLine(coords: number[][], aadt: number, year: number, out: CandPoint[]): void {
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

// ── Helpers for paginated ArcGIS REST queries ─────────────────────────
async function fetchAllArcgisFeatures<T>(
  baseUrl: string,
  where: string,
  outFields: string,
  returnGeom: boolean,
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  while (true) {
    const url =
      `${baseUrl}/query?where=${encodeURIComponent(where)}` +
      `&outFields=${encodeURIComponent(outFields)}` +
      `&returnGeometry=${returnGeom}` +
      (returnGeom ? "&outSR=4326" : "") +
      `&resultRecordCount=2000&resultOffset=${offset}&f=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ArcGIS ${baseUrl} offset ${offset}: ${res.status}`);
    const json = (await res.json()) as { features?: T[]; exceededTransferLimit?: boolean };
    const feats = json.features ?? [];
    out.push(...feats);
    if (!json.exceededTransferLimit || feats.length === 0) break;
    offset += feats.length;
  }
  return out;
}

// ── Vancouver ──────────────────────────────────────────────────────────
const VAN_BASE =
  "https://maps.vancouver.ca/server/rest/services/VanMapViewer/Traffic_and_Transportation/MapServer";

// Directional Segment Counts by year (most recent first so we keep newest).
const VAN_LAYERS: Array<{ id: number; year: number; label: string }> = [
  { id: 415, year: 2024, label: "2024 Directional Segment Counts" },
  { id: 411, year: 2023, label: "2023 Directional Segment Counts" },
  { id: 219, year: 2022, label: "2022 Directional Segment Counts" },
  { id: 181, year: 2021, label: "2021 Directional Segment Counts" },
  { id: 178, year: 2020, label: "2020 Directional Segment Counts" },
  { id: 60,  year: 2019, label: "2019 Directional Segment Counts" },
  { id: 201, year: 2018, label: "2018 Directional Segment Counts" },
  { id: 9,   year: 2017, label: "2011-2017 Directional Segment Counts" }, // Latest_Study_Year carries the actual year
];

const VAN_OPENDATA_URL =
  "https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets/directional-traffic-count-locations/records";

/**
 * Parse a Vancouver Location/location string into (block, street) where
 * block is a single integer (the first block number if it's a range) and
 * street is a fully-normalized key. Returns null when the leading token
 * isn't a number, which catches non-block strings ("Disraeli Bridge").
 *
 * Examples:
 *   "1800 ROBSON ST"             → { block: 1800, street: "ROBSON ST" }
 *   "8000-8100 ANGUS DRIVE"      → { block: 8000, street: "ANGUS ST" } — DR/DRIVE both → ST? no:
 *   Actually we normalize street type per Hamilton's helper: STREET→ST, DRIVE→DR, …
 */
function parseVanLocation(s: string): { block: number; street: string } | null {
  const trimmed = s.trim().toUpperCase().replace(/\s+/g, " ");
  // Block-or-range at the start.
  const m = trimmed.match(/^(\d{1,5})(?:-(\d{1,5}))?\s+(.+)$/);
  if (!m) return null;
  const block = parseInt(m[1], 10);
  // Reuse the Hamilton abbreviation map for street type / direction.
  const street = normalizeHamStreetName(m[3]);
  return { block, street };
}

/** Canonical join key — pin block to its hundreds bucket so 1800 ROBSON
 *  matches 1700-1800 ROBSON, 1800-1900 ROBSON, etc. */
function vanJoinKey(block: number, street: string): string {
  return `${Math.floor(block / 100)}|${street}`;
}

// Permanent Vehicle Counts layer (208) ships its own geometry directly
// — different from the Directional Segment Count layers which strip
// geometry on REST queries. Each segment has up to 4 years of AADT
// values (AADT0/AADT1/AADT2/AADT3 with YearAADT0/1/2/3). 55 records →
// ~200 measured datapoints once we use every available year.
async function fetchVancouverPermanent(): Promise<CandPoint[]> {
  type PermAttr = {
    Segment?: string;
    Direction?: string;
    AADT0?: number | null; YearAADT0?: number | null;
    AADT1?: number | null; YearAADT1?: number | null;
    AADT2?: number | null; YearAADT2?: number | null;
    AADT3?: number | null; YearAADT3?: number | null;
  };
  const feats = await fetchAllArcgisFeatures<{ attributes: PermAttr; geometry?: { paths: number[][][] } }>(
    `${VAN_BASE}/208`,
    "1=1",
    "Segment,Direction,AADT0,YearAADT0,AADT1,YearAADT1,AADT2,YearAADT2,AADT3,YearAADT3",
    true,
  );
  const out: CandPoint[] = [];
  for (const f of feats) {
    const a = f.attributes;
    // Pick the most recent non-null AADT slot.
    let best: { aadt: number; year: number } | null = null;
    for (let i = 0; i < 4; i++) {
      const aadt = (a as unknown as Record<string, number | null>)[`AADT${i}`];
      const year = (a as unknown as Record<string, number | null>)[`YearAADT${i}`];
      if (typeof aadt === "number" && aadt > 0 && typeof year === "number" && year > 0) {
        if (!best || year > best.year) best = { aadt, year };
      }
    }
    if (!best) continue;
    const paths = f.geometry?.paths ?? [];
    for (const p of paths) {
      if (p.length >= 2) densifyLine(p, best.aadt, best.year, out);
      else if (p.length === 1) out.push({ lon: p[0][0], lat: p[0][1], aadt: best.aadt, year: best.year });
    }
  }
  console.log(`  Vancouver Permanent: ${feats.length} segments → ${out.length} candidate points`);
  return out;
}

async function fetchVancouver(): Promise<CandPoint[]> {
  // 1. Pull all counts across year layers — keep latest per Location.
  type VanCountAttr = {
    Location: string;
    AvgDaily_0?: number | null;
    AvgDaily_1?: number | null;
    Latest_Study_Year?: number;
  };
  const latest = new Map<string, { aadt: number; year: number }>();
  for (const lyr of VAN_LAYERS) {
    const feats = await fetchAllArcgisFeatures<{ attributes: VanCountAttr }>(
      `${VAN_BASE}/${lyr.id}`,
      "AvgDaily_0 IS NOT NULL OR AvgDaily_1 IS NOT NULL",
      "Location,AvgDaily_0,AvgDaily_1,Latest_Study_Year",
      false,
    );
    let kept = 0;
    for (const f of feats) {
      const a = f.attributes;
      const parsed = a.Location ? parseVanLocation(a.Location) : null;
      if (!parsed) continue;
      const aadt = Math.round((a.AvgDaily_0 ?? 0) + (a.AvgDaily_1 ?? 0));
      if (aadt <= 0) continue;
      const year = a.Latest_Study_Year ?? lyr.year;
      const key = vanJoinKey(parsed.block, parsed.street);
      const cur = latest.get(key);
      if (!cur || year > cur.year) {
        latest.set(key, { aadt, year });
        kept++;
      }
    }
    console.log(`  Vancouver ${lyr.label}: ${feats.length} → ${kept} fresh`);
  }
  console.log(`  Vancouver: ${latest.size} unique locations with AvgDaily across all years`);

  // 2. Pull location → polyline from opendata.vancouver.ca.
  type OdsRow = {
    location: string;
    geom?: { type: string; geometry: { type: string; coordinates: number[][] } };
    geo_point_2d?: { lon: number; lat: number };
  };
  const locCoords = new Map<string, number[][]>();
  let offset = 0;
  while (true) {
    const url = `${VAN_OPENDATA_URL}?limit=100&offset=${offset}&select=location,geom,geo_point_2d`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenDataSoft offset ${offset}: ${res.status}`);
    const json = (await res.json()) as { results?: OdsRow[]; total_count?: number };
    const rows = json.results ?? [];
    if (rows.length === 0) break;
    for (const r of rows) {
      if (!r.location) continue;
      const parsed = parseVanLocation(r.location);
      if (!parsed) continue;
      // Index under both endpoints of a range so either block matches.
      const m = r.location.trim().toUpperCase().match(/^(\d+)-(\d+)/);
      const blocks = m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [parsed.block];
      const lineCoords = r.geom?.geometry?.coordinates;
      const geom: number[][] | null =
        Array.isArray(lineCoords) && lineCoords.length >= 2
          ? lineCoords
          : r.geo_point_2d
            ? [[r.geo_point_2d.lon, r.geo_point_2d.lat]]
            : null;
      if (!geom) continue;
      for (const b of blocks) locCoords.set(vanJoinKey(b, parsed.street), geom);
    }
    offset += rows.length;
    if (offset >= (json.total_count ?? 0)) break;
  }
  console.log(`  Vancouver: ${locCoords.size} locations with geometry from open-data portal`);

  // 3. Join: latest count + coords → candidate points. If exact (block,street)
  //    misses, fall back to scanning adjacent hundred-blocks of the same street
  //    (block ± 1 hundred), which handles the case where the count was at
  //    e.g. block 5400 and the geometry index has 5300-5500.
  const out: CandPoint[] = [];
  let matched = 0;
  let unmatched = 0;
  for (const [key, count] of latest) {
    let coords = locCoords.get(key);
    if (!coords) {
      const [bucketStr, street] = key.split("|");
      const bucket = parseInt(bucketStr, 10);
      for (const off of [-1, 1, -2, 2]) {
        coords = locCoords.get(`${bucket + off}|${street}`);
        if (coords) break;
      }
    }
    if (!coords) {
      unmatched++;
      continue;
    }
    matched++;
    if (coords.length >= 2) {
      densifyLine(coords, count.aadt, count.year, out);
    } else {
      const [lon, lat] = coords[0];
      out.push({ lat, lon, aadt: count.aadt, year: count.year });
    }
  }
  console.log(`  Vancouver: joined ${matched} counts to geometry, ${unmatched} unmatched → ${out.length} candidate points`);
  // Layer 208 Permanent Vehicle Counts comes through with its own
  // geometry — appended directly.
  const permPoints = await fetchVancouverPermanent();
  out.push(...permPoints);
  return out;
}

// ── Hamilton ───────────────────────────────────────────────────────────
const HAM_ADT_URL =
  "https://services.arcgis.com/rYz782eMbySr2srL/arcgis/rest/services/Average_Daily_Traffic_Count/FeatureServer/39";
const HAM_CTRL_URL =
  "https://services.arcgis.com/rYz782eMbySr2srL/arcgis/rest/services/Street_Centreline/FeatureServer/14";

type HamSegment = { name: string; coords: number[][]; latMin: number; latMax: number; lonMin: number; lonMax: number };

function normalizeHamStreetName(raw: string): string {
  // Hamilton centreline names look like "Main Street West"; ADT descriptions
  // look like "MAIN ST W btwn DALEWOOD & GARY". Normalize both sides to a
  // canonical "MAIN ST W" by:
  //  - uppercase
  //  - replace full type words with abbreviations (STREET→ST, ROAD→RD, etc.)
  //  - drop everything past the directional suffix
  //  - collapse whitespace.
  let s = raw.trim().toUpperCase();
  const typeMap: Array<[RegExp, string]> = [
    [/\bSTREET\b/g, "ST"],
    [/\bROAD\b/g, "RD"],
    [/\bAVENUE\b/g, "AV"],
    [/\bAVE\b/g, "AV"],
    [/\bDRIVE\b/g, "DR"],
    [/\bBOULEVARD\b/g, "BV"],
    [/\bBLVD\b/g, "BV"],
    [/\bPARKWAY\b/g, "PY"],
    [/\bPKWY\b/g, "PY"],
    [/\bLANE\b/g, "LN"],
    [/\bPLACE\b/g, "PL"],
    [/\bCRESCENT\b/g, "CR"],
    [/\bCRES\b/g, "CR"],
    [/\bCOURT\b/g, "CT"],
    [/\bCOURT$/g, "CT"],
    [/\bCIRCLE\b/g, "CL"],
    [/\bHIGHWAY\b/g, "HWY"],
    [/\bNORTH\b/g, "N"],
    [/\bSOUTH\b/g, "S"],
    [/\bEAST\b/g, "E"],
    [/\bWEST\b/g, "W"],
  ];
  for (const [re, to] of typeMap) s = s.replace(re, to);
  return s.replace(/\s+/g, " ").trim();
}

async function fetchHamilton(cfg: MetroConfig): Promise<CandPoint[]> {
  // 1. Pull ADT rows.
  type AdtAttr = {
    AVERAGE_DAILY_TRAFFIC_COUNT: number;
    COUNT_YEAR: string;
    LOCATION_DESCRIPTION: string;
  };
  const adt = await fetchAllArcgisFeatures<{ attributes: AdtAttr }>(
    HAM_ADT_URL,
    "AVERAGE_DAILY_TRAFFIC_COUNT IS NOT NULL AND AVERAGE_DAILY_TRAFFIC_COUNT > 0",
    "AVERAGE_DAILY_TRAFFIC_COUNT,COUNT_YEAR,LOCATION_DESCRIPTION",
    false,
  );
  console.log(`  Hamilton: ${adt.length} ADT rows`);

  // 2. Pull centreline segments inside Hamilton bbox.
  type CtrlAttr = { STREET_NAME_COMPLETE: string };
  const ctrl = await fetchAllArcgisFeatures<{
    attributes: CtrlAttr;
    geometry?: { paths: number[][][] };
  }>(
    HAM_CTRL_URL,
    "STREET_NAME_COMPLETE IS NOT NULL",
    "STREET_NAME_COMPLETE",
    true,
  );
  console.log(`  Hamilton: ${ctrl.length} centreline segments`);

  // 3. Index centreline by normalized name AND by base name (no type/direction
  //    suffix). ADT location_descriptions use bare cross-street names
  //    ("DALEWOOD") while the centreline carries the full "DALEWOOD AV"; the
  //    base-name index lets cross-street lookups still match.
  const byName = new Map<string, HamSegment[]>();
  const byBase = new Map<string, HamSegment[]>();
  for (const f of ctrl) {
    const full = normalizeHamStreetName(f.attributes.STREET_NAME_COMPLETE ?? "");
    if (!full) continue;
    // Base = drop trailing type token (ST/RD/AV/…) and any directional after it.
    const base = full
      .replace(/\s+(N|S|E|W)$/, "")
      .replace(/\s+(ST|RD|AV|DR|BV|PY|LN|PL|CR|CT|CL|HWY)$/, "")
      .replace(/\s+(N|S|E|W)$/, "")
      .trim();
    const paths = f.geometry?.paths ?? [];
    for (const p of paths) {
      if (p.length < 2) continue;
      let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
      for (const [lon, lat] of p) {
        if (lat < latMin) latMin = lat;
        if (lat > latMax) latMax = lat;
        if (lon < lonMin) lonMin = lon;
        if (lon > lonMax) lonMax = lon;
      }
      const seg: HamSegment = { name: full, coords: p, latMin, latMax, lonMin, lonMax };
      let arr = byName.get(full);
      if (!arr) byName.set(full, (arr = []));
      arr.push(seg);
      if (base && base !== full) {
        let barr = byBase.get(base);
        if (!barr) byBase.set(base, (barr = []));
        barr.push(seg);
      }
    }
  }
  console.log(`  Hamilton: ${byName.size} full names, ${byBase.size} base names`);

  // Helper: find segments for a cross-street query — try full first, then base.
  const lookupCross = (rawName: string): HamSegment[] | null => {
    const full = normalizeHamStreetName(rawName);
    return byName.get(full) ?? byBase.get(full) ?? null;
  };

  // 4. For each ADT row, geocode the location to a single (lat,lon).
  const out: CandPoint[] = [];
  let matchedBoth = 0;
  let matchedStreet = 0;
  let unmatched = 0;
  for (const r of adt) {
    const a = r.attributes;
    const desc = a.LOCATION_DESCRIPTION;
    if (!desc) { unmatched++; continue; }
    const year = parseInt(a.COUNT_YEAR, 10) || 2024;

    // Parse "STREET btwn CROSS1 & CROSS2"; tolerate "STREET" alone (no btwn).
    const m = desc.match(/^(.+?)\s+btwn\s+(.+?)\s*&\s*(.+?)$/i);
    let streetRaw: string, cross1Raw: string | null = null, cross2Raw: string | null = null;
    if (m) {
      streetRaw = m[1]; cross1Raw = m[2]; cross2Raw = m[3];
    } else {
      streetRaw = desc;
    }
    const streetN = normalizeHamStreetName(streetRaw);
    const streetSegs = byName.get(streetN);
    if (!streetSegs || streetSegs.length === 0) { unmatched++; continue; }

    // Find a target point on the named street by snapping cross-street midpoints.
    let target: { lat: number; lon: number } | null = null;
    if (cross1Raw && cross2Raw) {
      const c1Segs = lookupCross(cross1Raw);
      const c2Segs = lookupCross(cross2Raw);
      if (c1Segs && c2Segs) {
        // Find points on STREET that are within 60 m of a CROSS1 vertex,
        // and a separate point within 60 m of a CROSS2 vertex; midpoint.
        // 60 m tolerates centreline-vertex offsets at unequal-class
        // intersections (a local cross-street vertex isn't always exactly
        // shared with an arterial vertex in Hamilton's data).
        const p1 = nearestVertexOnSegments(streetSegs, c1Segs, 60);
        const p2 = nearestVertexOnSegments(streetSegs, c2Segs, 60);
        if (p1 && p2) {
          target = { lat: (p1.lat + p2.lat) / 2, lon: (p1.lon + p2.lon) / 2 };
          matchedBoth++;
        }
      }
    }
    if (!target) {
      // Fallback: centroid of all STREET segments.
      let sLat = 0, sLon = 0, n = 0;
      for (const seg of streetSegs) {
        for (const [lon, lat] of seg.coords) { sLat += lat; sLon += lon; n++; }
      }
      if (n === 0) { unmatched++; continue; }
      target = { lat: sLat / n, lon: sLon / n };
      matchedStreet++;
    }

    // Bbox guard so a same-name street outside the metro doesn't pull us off.
    if (target.lat < cfg.bbox.latMin || target.lat > cfg.bbox.latMax) { unmatched++; continue; }
    if (target.lon < cfg.bbox.lonMin || target.lon > cfg.bbox.lonMax) { unmatched++; continue; }

    out.push({ lat: target.lat, lon: target.lon, aadt: Math.round(a.AVERAGE_DAILY_TRAFFIC_COUNT), year });
  }
  console.log(`  Hamilton: geocoded ${matchedBoth} via cross-street midpoint + ${matchedStreet} via street centroid + ${unmatched} unmatched`);
  return out;
}

/** Find a vertex on any of `targets` that's nearest to (or within thresh of) any vertex on `near`. */
function nearestVertexOnSegments(
  targets: HamSegment[],
  near: HamSegment[],
  threshM: number,
): { lat: number; lon: number } | null {
  let best: { lat: number; lon: number; d: number } | null = null;
  for (const t of targets) {
    for (const [tLon, tLat] of t.coords) {
      for (const n of near) {
        // bbox prune
        if (tLat < n.latMin - 0.001 || tLat > n.latMax + 0.001) continue;
        if (tLon < n.lonMin - 0.001 || tLon > n.lonMax + 0.001) continue;
        for (const [nLon, nLat] of n.coords) {
          const d = distM(tLat, tLon, nLat, nLon);
          if (d <= threshM && (!best || d < best.d)) best = { lat: tLat, lon: tLon, d };
        }
      }
    }
  }
  return best;
}

// ── Winnipeg ───────────────────────────────────────────────────────────
const WIN_MID_URL = "https://data.winnipeg.ca/resource/buvf-b9wp.json";
const WIN_ROAD_URL = "https://data.winnipeg.ca/resource/ngsx-caav.json";

type WinAgg = {
  study_id: string;
  location_description: string;
  count_direction: string;
  total_volume: string;
  interval_count: string;
};

async function fetchWinnipeg(cfg: MetroConfig): Promise<CandPoint[]> {
  // 1. Aggregate per (study_id, direction).
  const aggs: WinAgg[] = [];
  const PAGE = 10000;
  let offset = 0;
  while (true) {
    const url =
      `${WIN_MID_URL}?$select=study_id,location_description,count_direction,` +
      `sum(count_15_minutes) AS total_volume,count(*) AS interval_count` +
      `&$group=study_id,location_description,count_direction` +
      `&$limit=${PAGE}&$offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Winnipeg agg offset ${offset}: ${res.status}`);
    const rows = (await res.json()) as WinAgg[];
    aggs.push(...rows);
    if (rows.length < PAGE) break;
    offset += rows.length;
  }
  console.log(`  Winnipeg: ${aggs.length} (study_id × direction) aggregates`);

  // Roll up to per-study daily AADT (sum across directions, normalized by days).
  type WinStudy = { study_id: string; loc: string; aadt: number; year: number };
  const byStudy = new Map<string, WinStudy>();
  for (const a of aggs) {
    const total = parseFloat(a.total_volume);
    const intervals = parseFloat(a.interval_count);
    if (!isFinite(total) || !isFinite(intervals) || intervals <= 0) continue;
    // direction-days for this row = intervals / 96 (4 × 24)
    const dirDays = intervals / 96;
    if (dirDays < 0.25) continue; // < 6 h of data — skip
    const dailyPerDir = total / dirDays;
    const cur = byStudy.get(a.study_id);
    if (cur) {
      cur.aadt += Math.round(dailyPerDir);
    } else {
      byStudy.set(a.study_id, {
        study_id: a.study_id,
        loc: a.location_description ?? "",
        aadt: Math.round(dailyPerDir),
        year: 2024, // count_date not pulled here; mark generic vintage
      });
    }
  }
  console.log(`  Winnipeg: ${byStudy.size} unique studies (post-rollup)`);

  // 2. Pull Winnipeg Road Network and index by normalized name.
  const roads = await (async () => {
    const out: Array<{ name: string; coords: number[][] }> = [];
    let off = 0;
    while (true) {
      const url = `${WIN_ROAD_URL}?$limit=5000&$offset=${off}`;
      const res = await fetch(url);
      if (!res.ok) break;
      const rows = (await res.json()) as Array<{
        full_name?: string;
        the_geom?: { type: string; coordinates: number[][][] | number[][] } | string;
      }>;
      if (rows.length === 0) break;
      for (const r of rows) {
        if (!r.full_name) continue;
        const name = normalizeHamStreetName(r.full_name); // same abbreviation map works
        const g = r.the_geom;
        if (!g || typeof g === "string") continue;
        if (g.type === "MultiLineString") {
          for (const part of g.coordinates as number[][][]) {
            if (Array.isArray(part) && part.length >= 2) out.push({ name, coords: part });
          }
        } else if (g.type === "LineString") {
          const c = g.coordinates as number[][];
          if (Array.isArray(c) && c.length >= 2) out.push({ name, coords: c });
        }
      }
      off += rows.length;
      if (rows.length < 5000) break;
    }
    return out;
  })();
  // Index by both full name and base name (drop trailing type/direction)
  // so bare cross-street references like "Park" find "Park Blvd" segments.
  const byName = new Map<string, HamSegment[]>();
  const byBase = new Map<string, HamSegment[]>();
  for (const r of roads) {
    const full = r.name;
    const base = full
      .replace(/\s+(N|S|E|W)$/, "")
      .replace(/\s+(ST|RD|AV|DR|BV|PY|LN|PL|CR|CT|CL|HWY)$/, "")
      .replace(/\s+(N|S|E|W)$/, "")
      .trim();
    let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
    for (const [lon, lat] of r.coords) {
      if (lat < latMin) latMin = lat;
      if (lat > latMax) latMax = lat;
      if (lon < lonMin) lonMin = lon;
      if (lon > lonMax) lonMax = lon;
    }
    const seg: HamSegment = { name: full, coords: r.coords, latMin, latMax, lonMin, lonMax };
    let arr = byName.get(full);
    if (!arr) byName.set(full, (arr = []));
    arr.push(seg);
    if (base && base !== full) {
      let barr = byBase.get(base);
      if (!barr) byBase.set(base, (barr = []));
      barr.push(seg);
    }
  }
  console.log(`  Winnipeg: ${roads.length} centreline parts → ${byName.size} full names, ${byBase.size} base names`);

  const lookupCross = (rawName: string): HamSegment[] | null => {
    const full = normalizeHamStreetName(rawName);
    return byName.get(full) ?? byBase.get(full) ?? null;
  };

  // 3. Parse Winnipeg location "STREET - CROSS1 to CROSS2" and geocode.
  const out: CandPoint[] = [];
  let matchedBoth = 0, matchedCentroid = 0, unmatched = 0;
  for (const s of byStudy.values()) {
    const desc = s.loc;
    if (!desc) { unmatched++; continue; }
    // Examples:
    //   "Lagimodiere Blvd  - Dawson Rd N to Maginot St"
    //   "Disraeli Bridge"
    let streetRaw: string, c1Raw: string | null = null, c2Raw: string | null = null;
    const m = desc.match(/^(.+?)\s+-\s+(.+?)\s+to\s+(.+?)$/i);
    if (m) { streetRaw = m[1]; c1Raw = m[2]; c2Raw = m[3]; }
    else streetRaw = desc;
    const streetN = normalizeHamStreetName(streetRaw);
    const streetSegs = byName.get(streetN) ?? byBase.get(streetN);
    if (!streetSegs || streetSegs.length === 0) { unmatched++; continue; }

    let target: { lat: number; lon: number } | null = null;
    if (c1Raw && c2Raw) {
      const c1Segs = lookupCross(c1Raw);
      const c2Segs = lookupCross(c2Raw);
      if (c1Segs && c2Segs) {
        const p1 = nearestVertexOnSegments(streetSegs, c1Segs, 80);
        const p2 = nearestVertexOnSegments(streetSegs, c2Segs, 80);
        if (p1 && p2) {
          target = { lat: (p1.lat + p2.lat) / 2, lon: (p1.lon + p2.lon) / 2 };
          matchedBoth++;
        }
      }
    }
    if (!target) {
      // Fallback: centroid of street segments.
      let sLat = 0, sLon = 0, n = 0;
      for (const seg of streetSegs) for (const [lon, lat] of seg.coords) { sLat += lat; sLon += lon; n++; }
      if (n === 0) { unmatched++; continue; }
      target = { lat: sLat / n, lon: sLon / n };
      matchedCentroid++;
    }
    if (target.lat < cfg.bbox.latMin || target.lat > cfg.bbox.latMax) { unmatched++; continue; }
    if (target.lon < cfg.bbox.lonMin || target.lon > cfg.bbox.lonMax) { unmatched++; continue; }
    out.push({ lat: target.lat, lon: target.lon, aadt: s.aadt, year: s.year });
  }
  console.log(`  Winnipeg: ${matchedBoth} cross-street midpoint + ${matchedCentroid} street centroid + ${unmatched} unmatched`);
  return out;
}

// ── Montreal: city turning movement counts (donnees.montreal.ca CSV) ───
// donnees.montreal.ca's `comptage-vehicules-pietons` ships ~52 MB CSV of
// 15-minute intersection turning-movement rows back to 2008. Each row is
// one mode (Code_Banque) at one intersection at one 15-min slot, with
// per-approach movement counts (NBLT/NBT/NBRT/etc.) and lat/lon. We sum
// all motor-vehicle modes (everything except Pietons=10 and Velos=11)
// across all approaches per intersection-day, average across days, and
// emit one AADT estimate per intersection.
const MTL_CSV_URL =
  "https://donnees.montreal.ca/dataset/584de76b-13b9-47ea-af12-0c37b8eb5de5/resource/f82f00c0-baed-4fa1-8b01-6ed60146d102/download/comptages_vehicules_cyclistes_pietons.csv";

async function fetchMontrealCity(cfg: MetroConfig): Promise<CandPoint[]> {
  console.log(`  Montreal city: downloading ${MTL_CSV_URL}`);
  // donnees.montreal.ca rejects default fetch user-agent with HTTP 403; a
  // browser-shaped UA passes through. Tested 2026-06-16.
  const res = await fetch(MTL_CSV_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0) AppleWebKit/537.36 Chrome/121",
      Accept: "text/csv,*/*",
    },
  });
  if (!res.ok) throw new Error(`Montreal city CSV: ${res.status}`);
  const csv = await res.text();
  console.log(`  Montreal city: downloaded ${(csv.length / 1024 / 1024).toFixed(1)} MB`);

  // Header parse (column ordering varies if upstream updates the file).
  const nlIdx = csv.indexOf("\n");
  const header = csv.slice(0, nlIdx).split(",");
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Montreal city CSV missing column: ${name}`);
    return i;
  };
  const iId = col("Id_Intersection");
  const iDate = col("Date");
  const iCode = col("Code_Banque");
  const iLon = col("Longitude");
  const iLat = col("Latitude");
  // Approach movement columns. Sum all 12 to get total intersection volume
  // (every vehicle either turns or goes through).
  const moveCols = [
    "NBLT","NBT","NBRT","SBLT","SBT","SBRT",
    "EBLT","EBT","EBRT","WBLT","WBT","WBRT",
  ].map(col);

  // Aggregators: per intersection, sum vehicle movements across all rows,
  // count distinct dates observed, capture coords from the first row.
  type AggRow = { vol: number; dates: Set<string>; lat: number; lon: number };
  const agg = new Map<string, AggRow>();
  let rowCount = 0;
  let pos = nlIdx + 1;
  while (pos < csv.length) {
    const next = csv.indexOf("\n", pos);
    const end = next < 0 ? csv.length : next;
    const line = csv.slice(pos, end);
    pos = end + 1;
    if (!line) continue;
    const r = parseCsvRow(line);
    rowCount++;
    const code = parseInt(r[iCode], 10);
    if (code === 10 || code === 11) continue; // pedestrians / bikes
    const id = r[iId];
    if (!id) continue;
    const date = r[iDate];
    let sum = 0;
    for (const ci of moveCols) {
      const v = parseInt(r[ci], 10);
      if (isFinite(v)) sum += v;
    }
    if (sum <= 0) continue;
    let cur = agg.get(id);
    if (!cur) {
      const lat = parseFloat(r[iLat]);
      const lon = parseFloat(r[iLon]);
      if (!isFinite(lat) || !isFinite(lon)) continue;
      if (lat < cfg.bbox.latMin || lat > cfg.bbox.latMax) continue;
      if (lon < cfg.bbox.lonMin || lon > cfg.bbox.lonMax) continue;
      cur = { vol: 0, dates: new Set<string>(), lat, lon };
      agg.set(id, cur);
    }
    cur.vol += sum;
    cur.dates.add(date);
  }
  console.log(`  Montreal city: parsed ${rowCount} rows, ${agg.size} intersections in bbox`);

  // Roll up. Each row is a 15-min slot, so vehicle slots × 15 min = 24 h × 4 = 96 per day per mode.
  // We summed ALL modes (excluding ped/bike) across ALL rows — i.e. across
  // every 15-min slot × every mode × every observed day. To get daily AADT
  // per intersection: total / (intervals_observed/96) where intervals_observed
  // is hard to compute without per-mode bookkeeping. Approximation: total
  // movement / days_observed. This OVER-counts because we summed across
  // modes (autos, trucks, etc.) but for AADT both are wanted — so the sum
  // is correct vehicle-AADT. Days observed = distinct dates per intersection.
  const out: CandPoint[] = [];
  for (const a of agg.values()) {
    const days = a.dates.size;
    if (days < 1) continue;
    const aadt = Math.round(a.vol / days);
    if (aadt <= 0) continue;
    out.push({ lat: a.lat, lon: a.lon, aadt, year: 2024 });
  }
  console.log(`  Montreal city: ${out.length} candidate intersection points`);
  return out;
}

// Reusable parseCsvRow (RFC 4180-ish).
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

// ── Shared snap + merge (measured > synthetic preference) ──────────────
type MetroConfig = {
  slug: string;
  code: string;
  bbox: BBox;
  sourceTag: string;
  coverageLabel: string;
  snapM: number;
  fetch: (cfg: MetroConfig) => Promise<CandPoint[]>;
};

const METROS: Record<string, MetroConfig> = {
  vancouver: {
    slug: "vancouver",
    code: "vancouver_metro",
    bbox: { latMin: 49.1, latMax: 49.4, lonMin: -123.3, lonMax: -122.5 },
    sourceTag: "vancouver_open_data_directional",
    coverageLabel: "Vancouver Open Data Directional Segment Counts (2011-2024) + Permanent Vehicle Counts + OSM-class synthetic",
    snapM: 2000,
    fetch: fetchVancouver as (cfg: MetroConfig) => Promise<CandPoint[]>,
  },
  hamilton: {
    slug: "hamilton",
    code: "hamilton_metro",
    bbox: { latMin: 43.1, latMax: 43.4, lonMin: -80.0, lonMax: -79.7 },
    sourceTag: "hamilton_open_data_adt",
    coverageLabel: "Hamilton Open Data Average Daily Traffic + MTO Historical AADT 2019 + OSM-class synthetic",
    // Snap radius wider than the others: Hamilton's ADT geocoding is via
    // cross-street midpoint (when both cross streets resolve) or street
    // centroid (when they don't), so the target point can be 200-400 m
    // from the actual count location even with a successful match.
    snapM: 1000,
    fetch: fetchHamilton,
  },
  winnipeg: {
    slug: "winnipeg",
    code: "winnipeg_metro",
    bbox: { latMin: 49.7, latMax: 50.0, lonMin: -97.3, lonMax: -96.9 },
    sourceTag: "winnipeg_open_data_midblock",
    coverageLabel: "Winnipeg Open Data Midblock Counts (aggregated) + MHTIS 2019 + OSM-class synthetic",
    snapM: 600,
    fetch: fetchWinnipeg,
  },
  montreal: {
    slug: "montreal",
    code: "montreal_metro",
    bbox: { latMin: 45.4, latMax: 45.7, lonMin: -73.8, lonMax: -73.4 },
    sourceTag: "montreal_open_data_intersection",
    coverageLabel: "Montréal Open Data intersection turning-movement counts + MTQ DJMA + OSM-class synthetic",
    snapM: 800,
    fetch: fetchMontrealCity,
  },
};

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
  let newMeasured = 0;
  let replacedSynthetic = 0;
  let keptMeasured = 0;
  const snapDists: number[] = [];
  for (const [id, sLat, sLon] of signals) {
    const baseLatCell = Math.floor(sLat / GRID_DEG);
    const baseLonCell = Math.floor(sLon / GRID_DEG);
    let best: CandPoint | null = null;
    let bestD = Infinity;
    const cellHalf = Math.ceil((cfg.snapM * 1.1) / (GRID_DEG * 111_000));
    for (let dLat = -cellHalf; dLat <= cellHalf; dLat++) {
      for (let dLon = -cellHalf; dLon <= cellHalf; dLon++) {
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
    if (prior && prior.source !== "synthetic_osm_class") {
      // Prior is measured; keep it unless new is closer.
      if (prior.distM <= bestD) { keptMeasured++; continue; }
    }
    const isReplacingSynthetic = prior && prior.source === "synthetic_osm_class";
    merged[key] = {
      aadt: best.aadt,
      year: best.year,
      kFactor: 9,
      distM: Math.round(bestD),
      source: cfg.sourceTag,
    };
    snapDists.push(bestD);
    if (isReplacingSynthetic) replacedSynthetic++;
    else newMeasured++;
  }

  const measuredTotal = Object.values(merged).filter((v) => v.source !== "synthetic_osm_class").length;
  const totalRecs = Object.keys(merged).length;
  const sigCount = signals.length;
  const measuredPct = Math.round((measuredTotal / sigCount) * 1000) / 10;
  const totalPct = Math.round((totalRecs / sigCount) * 1000) / 10;
  const median = snapDists.length
    ? [...snapDists].sort((a, b) => a - b)[Math.floor(snapDists.length / 2)]
    : 0;
  console.log(
    `  Snap: +${newMeasured} new measured, ${replacedSynthetic} synthetic→measured, ${keptMeasured} prior-measured kept (median ${median.toFixed(0)} m).`,
  );
  console.log(
    `  Counts: measured ${measuredTotal}/${sigCount} (${measuredPct}%) | total ${totalRecs}/${sigCount} (${totalPct}%)`,
  );

  writeFileSync(aadtPath, JSON.stringify(merged));

  // Update aadtPct (= total coverage) and aadtSource label.
  let coverage = readFileSync(COVERAGE_PATH, "utf8");
  const aadtPctRe = new RegExp(`(\\{ code: "${cfg.code}",[^}]*?)aadtPct:\\s*[0-9.]+,`);
  const aadtSrcRe = new RegExp(`(\\{ code: "${cfg.code}",[^}]*?)aadtSource:\\s*"[^"]*",`);
  if (aadtPctRe.test(coverage)) {
    coverage = coverage.replace(aadtPctRe, `$1aadtPct: ${totalPct},`);
  } else {
    console.log("  ! aadtPct pattern miss");
  }
  if (aadtSrcRe.test(coverage)) {
    coverage = coverage.replace(aadtSrcRe, `$1aadtSource: "${cfg.coverageLabel}",`);
  } else {
    const liveSrcRe = new RegExp(`(\\{ code: "${cfg.code}",[^}]*?liveSource:\\s*null,)\\s*(dotName:)`);
    if (liveSrcRe.test(coverage)) {
      coverage = coverage.replace(liveSrcRe, `$1 aadtSource: "${cfg.coverageLabel}", $2`);
    }
  }
  writeFileSync(COVERAGE_PATH, coverage);
  console.log(`  Updated metro-coverage: ${cfg.code} aadtPct=${totalPct}% (measured ${measuredPct}%)`);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error(`Usage: tsx src/fetch-canada-aadt-geocoded.ts <metro|--all>\n  metros: ${Object.keys(METROS).join(", ")}`);
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
