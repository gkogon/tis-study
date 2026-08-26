/**
 * Canada AADT deepfill — second-wave measured-count sources for the 10
 * Canadian metros, targeting the ~12.5k signals still dark after the
 * first-wave wiring (fetch-canada-aadt.ts / -geocoded.ts / toronto-svc).
 *
 * Design mirrors fetch-aldot-deepfill.ts: a standalone script, one
 * SourceConfig per (metro, dataset) pair so a metro can take any number
 * of overlay sources. Merge semantics are the shared Canada rules:
 *   - a measured record always beats synthetic_osm_class regardless of
 *     distance;
 *   - among two measured records the CLOSER snap wins (so first-wave
 *     city-core counts are never displaced by a farther suburb count);
 *   - existing records are never deleted (append/upgrade only).
 *
 * Unlike fetch-canada-aadt.ts:processMetro, the coverage stats printed
 * here count ONLY records with source !== "synthetic_osm_class" — the
 * legacy script counts every key in the merged file, which inflates to
 * ~100% now that the synthetic backfill shares the same files.
 * metro-coverage.ts aadtPct (total incl. synthetic) is left untouched;
 * aadtSource labels are updated manually at the end of the wave.
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-canada-aadt-deepfill.ts <source|--all|--metro <slug>> [--dry]
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");

type BBox = { latMin: number; latMax: number; lonMin: number; lonMax: number };

type AadtRec = { aadt: number; year: number; kFactor: number; distM: number; source: string };

type CandPoint = { lat: number; lon: number; aadt: number; year: number };

type SourceConfig = {
  key: string; // CLI selector, unique per (metro, dataset)
  slug: string; // data-file slug, e.g. "vancouver"
  bbox: BBox; // regions.ts metro bounds — candidates outside are dropped
  sourceTag: string; // written into AadtRec.source
  snapM: number;
  fetch: (cfg: SourceConfig) => Promise<CandPoint[]>;
};

// Metro bounds from artifacts/tis-api-server/src/lib/regions.ts (2026-08-26).
const BOUNDS: Record<string, BBox> = {
  toronto: { latMin: 43.5, latMax: 44.0, lonMin: -79.7, lonMax: -79.0 },
  montreal: { latMin: 45.4, latMax: 45.7, lonMin: -73.8, lonMax: -73.4 },
  vancouver: { latMin: 49.1, latMax: 49.4, lonMin: -123.3, lonMax: -122.5 },
  calgary: { latMin: 50.8, latMax: 51.2, lonMin: -114.3, lonMax: -113.8 },
  ottawa: { latMin: 45.2, latMax: 45.5, lonMin: -76.0, lonMax: -75.4 },
  edmonton: { latMin: 53.4, latMax: 53.7, lonMin: -113.7, lonMax: -113.3 },
  winnipeg: { latMin: 49.7, latMax: 50.0, lonMin: -97.3, lonMax: -96.9 },
  "quebec-city": { latMin: 46.7, latMax: 47.0, lonMin: -71.4, lonMax: -71.1 },
  hamilton: { latMin: 43.1, latMax: 43.4, lonMin: -80.0, lonMax: -79.7 },
  halifax: { latMin: 44.5, latMax: 44.8, lonMin: -63.8, lonMax: -63.4 },
};

// ── Geometry helpers (shared with fetch-canada-aadt.ts) ─────────────────
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

const DENSIFY_M = 25;
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

function inBbox(lat: number, lon: number, b: BBox): boolean {
  return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
}

function numOf(v: unknown): number {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/,/g, ""));
    if (isFinite(n)) return n;
  }
  return 0;
}

function numField(a: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const n = numOf(a[k]);
    if (n) return n;
  }
  return 0;
}

// ── Generic access-method handlers ──────────────────────────────────────

/**
 * ArcGIS REST paginator (FeatureServer/MapServer layer). Handles point,
 * polyline and multipoint geometry, requests outSR=4326, paginates on
 * exceededTransferLimit with resultOffset (works on services without an
 * orderable objectIdField — the TDMPublic lesson).
 */
async function arcgisQuery(opts: {
  url: string;
  where?: string;
  volumeFields: string[];
  yearFields?: string[];
  fixedYear?: number;
  /** Multi-year column layout (Durham): first non-zero [field, year] pair wins. */
  volumeYearPairs?: Array<[string, number]>;
  bbox: BBox;
  pageSize?: number;
}): Promise<CandPoint[]> {
  const out: CandPoint[] = [];
  const pageSize = opts.pageSize ?? 2000;
  let offset = 0;
  let pages = 0;
  while (true) {
    const url =
      `${opts.url}/query?where=${encodeURIComponent(opts.where ?? "1=1")}` +
      `&outFields=*&returnGeometry=true&outSR=4326` +
      `&resultRecordCount=${pageSize}&resultOffset=${offset}&f=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`arcgis ${res.status} @ offset ${offset}: ${opts.url}`);
    const json = (await res.json()) as {
      features?: Array<{
        attributes: Record<string, unknown>;
        geometry?: { x?: number; y?: number; paths?: number[][][]; points?: number[][] };
      }>;
      exceededTransferLimit?: boolean;
      error?: { message?: string };
    };
    if (json.error) throw new Error(`arcgis error: ${json.error.message} @ ${opts.url}`);
    const feats = json.features ?? [];
    for (const f of feats) {
      let vol = 0;
      let pairYear = 0;
      if (opts.volumeYearPairs) {
        for (const [field, y] of opts.volumeYearPairs) {
          const v = numOf(f.attributes[field]);
          if (v > 0) { vol = v; pairYear = y; break; }
        }
      } else {
        vol = numField(f.attributes, opts.volumeFields);
      }
      if (vol <= 0) continue;
      const year =
        pairYear ||
        (opts.yearFields ? Math.round(numField(f.attributes, opts.yearFields)) : 0) ||
        opts.fixedYear ||
        2024;
      const g = f.geometry;
      if (!g) continue;
      if (typeof g.x === "number" && typeof g.y === "number") {
        if (inBbox(g.y, g.x, opts.bbox)) out.push({ lat: g.y, lon: g.x, aadt: Math.round(vol), year });
      } else if (Array.isArray(g.paths)) {
        const tmp: CandPoint[] = [];
        for (const p of g.paths) densifyLine(p, Math.round(vol), year, tmp);
        for (const c of tmp) if (inBbox(c.lat, c.lon, opts.bbox)) out.push(c);
      } else if (Array.isArray(g.points)) {
        for (const [x, y] of g.points) if (inBbox(y, x, opts.bbox)) out.push({ lat: y, lon: x, aadt: Math.round(vol), year });
      }
    }
    pages++;
    if (!json.exceededTransferLimit || feats.length === 0) break;
    offset += feats.length;
    if (pages > 200) break; // runaway guard
  }
  return out;
}

/** Socrata SODA JSON with a point/location column or explicit lat/lon columns. */
async function socrataQuery(opts: {
  domain: string;
  dataset: string;
  volumeFields: string[];
  yearFields?: string[];
  fixedYear?: number;
  latFields?: string[];
  lonFields?: string[];
  pointFields?: string[]; // GeoJSON-style {type:"Point",coordinates:[lon,lat]} or WKT "POINT (lon lat)"
  where?: string;
  bbox: BBox;
}): Promise<CandPoint[]> {
  const out: CandPoint[] = [];
  const pageSize = 5000;
  let offset = 0;
  while (true) {
    let url = `https://${opts.domain}/resource/${opts.dataset}.json?$limit=${pageSize}&$offset=${offset}`;
    if (opts.where) url += `&$where=${encodeURIComponent(opts.where)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`socrata ${res.status}: ${url}`);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const vol = numField(row, opts.volumeFields);
      if (vol <= 0) continue;
      const year =
        (opts.yearFields ? Math.round(numField(row, opts.yearFields)) : 0) || opts.fixedYear || 2024;
      let lat = opts.latFields ? numField(row, opts.latFields) : 0;
      let lon = opts.lonFields ? numField(row, opts.lonFields) : 0;
      if ((!lat || !lon) && opts.pointFields) {
        for (const pf of opts.pointFields) {
          const v = row[pf] as { coordinates?: number[] } | string | undefined;
          if (v && typeof v === "object" && Array.isArray(v.coordinates)) {
            [lon, lat] = v.coordinates;
            break;
          }
          if (typeof v === "string") {
            const m = /POINT\s*\((-?[\d.]+)\s+(-?[\d.]+)\)/.exec(v);
            if (m) { lon = parseFloat(m[1]); lat = parseFloat(m[2]); break; }
          }
        }
      }
      if (!lat || !lon || !inBbox(lat, lon, opts.bbox)) continue;
      out.push({ lat, lon, aadt: Math.round(vol), year });
    }
    if (rows.length < pageSize) break;
    offset += rows.length;
  }
  return out;
}

/** WFS GeoJSON (2.0.0 or 1.0.0) with line or point geometry. */
async function wfsQuery(opts: {
  base: string; // full URL incl. service/version/request/typename/outputformat, WITHOUT bbox
  volumeProp: (props: Record<string, unknown>) => { aadt: number; year: number } | null;
  bbox: BBox;
  bboxParam?: string; // e.g. `&bbox=latMin,lonMin,latMax,lonMax,EPSG:4326`
}): Promise<CandPoint[]> {
  const url = opts.base + (opts.bboxParam ?? "");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`wfs ${res.status}: ${url}`);
  const json = (await res.json()) as {
    features?: Array<{
      properties: Record<string, unknown>;
      geometry: { type: string; coordinates: unknown };
    }>;
  };
  const out: CandPoint[] = [];
  for (const f of json.features ?? []) {
    const v = opts.volumeProp(f.properties);
    if (!v) continue;
    const g = f.geometry;
    const tmp: CandPoint[] = [];
    if (g.type === "Point") {
      const [lon, lat] = g.coordinates as number[];
      tmp.push({ lat, lon, aadt: v.aadt, year: v.year });
    } else if (g.type === "LineString") {
      densifyLine(g.coordinates as number[][], v.aadt, v.year, tmp);
    } else if (g.type === "MultiLineString") {
      for (const part of g.coordinates as number[][][]) densifyLine(part, v.aadt, v.year, tmp);
    }
    for (const c of tmp) if (inBbox(c.lat, c.lon, opts.bbox)) out.push(c);
  }
  return out;
}

// ── Custom fetchers ─────────────────────────────────────────────────────

/**
 * Surrey: 3,830 per-lane detector loops at 368 signalized intersections.
 * Loop geometry from the FME GeoJSON stream; volumes from the date-windowed
 * counts API, aggregated to average daily entering volume per intersection
 * over SURREY_DAYS recent days (Montréal precedent: sum all approaches).
 */
const SURREY_LOOPS_URL =
  "https://gisprod.surrey.ca/fmedatastreaming/TrafficLoopCount/TrafficLoops.fmw";
const SURREY_COUNTS_URL =
  "https://gisprod.surrey.ca/fmedatastreaming/TrafficLoopCount/TrafficLoopCounts.fmw";
// Fixed recent window (full days, ending before today 2026-08-26).
const SURREY_DAYS = [
  "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15",
  "2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19", "2026-08-20",
  "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24",
];

async function fetchSurrey(cfg: SourceConfig): Promise<CandPoint[]> {
  const res = await fetch(SURREY_LOOPS_URL);
  if (!res.ok) throw new Error(`Surrey loops: ${res.status}`);
  const gj = (await res.json()) as {
    features?: Array<{
      properties: Record<string, unknown>;
      geometry?: { type: string; coordinates: number[] };
    }>;
  };
  const loopToInt = new Map<string, string>();
  const intCoords = new Map<string, { latSum: number; lonSum: number; n: number }>();
  for (const f of gj.features ?? []) {
    const p = f.properties;
    const loopId = String(p.LOOP_ID ?? "");
    const intId = String(p.INTERSECTION_ID ?? "");
    const g = f.geometry;
    if (!loopId || !intId || !g || g.type !== "Point") continue;
    const [lon, lat] = g.coordinates;
    loopToInt.set(loopId, intId);
    const c = intCoords.get(intId) ?? { latSum: 0, lonSum: 0, n: 0 };
    c.latSum += lat; c.lonSum += lon; c.n++;
    intCoords.set(intId, c);
  }
  console.log(`  Surrey: ${loopToInt.size} loops at ${intCoords.size} intersections`);

  // day → intersection → vehicles
  const dayTotals = new Map<string, Map<string, number>>();
  for (const day of SURREY_DAYS) {
    // 4× 6-hour windows keeps each response manageable.
    const windows = [
      [`${day}T00:00:00`, `${day}T06:00:00`],
      [`${day}T06:00:00`, `${day}T12:00:00`],
      [`${day}T12:00:00`, `${day}T18:00:00`],
      [`${day}T18:00:00`, `${day}T23:59:59`],
    ];
    const perInt = new Map<string, number>();
    let rows = 0;
    let failed = false;
    for (const [a, b] of windows) {
      const url = `${SURREY_COUNTS_URL}?startdatetime=${a}&enddatetime=${b}`;
      const r = await fetch(url);
      if (!r.ok) { console.log(`  Surrey ${day} ${a.slice(11, 16)}: ${r.status} — skipping day`); failed = true; break; }
      const rowsJson = (await r.json()) as Array<{ LOOP_ID?: string; TRAFFIC_COUNT?: number }>;
      for (const row of rowsJson) {
        const intId = loopToInt.get(String(row.LOOP_ID ?? ""));
        const v = numOf(row.TRAFFIC_COUNT);
        if (!intId || v <= 0) continue;
        perInt.set(intId, (perInt.get(intId) ?? 0) + v);
        rows++;
      }
    }
    if (!failed && rows > 0) {
      dayTotals.set(day, perInt);
      console.log(`  Surrey ${day}: ${rows} loop rows`);
    }
  }
  if (dayTotals.size === 0) throw new Error("Surrey: no usable days");

  const out: CandPoint[] = [];
  for (const [intId, c] of intCoords) {
    let sum = 0;
    let days = 0;
    for (const perInt of dayTotals.values()) {
      const v = perInt.get(intId);
      if (v && v > 0) { sum += v; days++; }
    }
    if (days < 3) continue; // too sparse to call it a daily average
    const lat = c.latSum / c.n;
    const lon = c.lonSum / c.n;
    if (!inBbox(lat, lon, cfg.bbox)) continue;
    out.push({ lat, lon, aadt: Math.round(sum / days), year: 2026 });
  }
  console.log(`  Surrey: ${out.length} intersection daily averages over ${dayTotals.size} days`);
  return out;
}

/** BC MoTT WFS layers (UTV segments with current AADT; legacy TMP count points). */
const BCMOTT_BASE =
  "https://maps.th.gov.bc.ca/geoV05/ows?service=WFS&version=2.0.0&request=GetFeature" +
  "&outputFormat=JSON&srsName=EPSG:4326";
// WFS bbox here is lon,lat order despite EPSG:4326 (validated 2026-08-26).
const BCMOTT_BBOX = "&bbox=-123.3,49.1,-122.5,49.4,EPSG:4326";

function yearFromDatetime(v: unknown, fallback: number): number {
  if (typeof v === "string") {
    const y = parseInt(v.slice(0, 4), 10);
    if (y >= 1980 && y <= 2030) return y;
  }
  return fallback;
}

async function fetchBcMottUtv(cfg: SourceConfig): Promise<CandPoint[]> {
  return wfsQuery({
    base: `${BCMOTT_BASE}&typeName=tig:TIG_UTV_SEGMENT_EXT&count=2000`,
    bboxParam: BCMOTT_BBOX,
    bbox: cfg.bbox,
    volumeProp: (p) => {
      const aadt = numOf(p.MAP_RENDERING_AADT);
      if (aadt <= 0) return null;
      return { aadt: Math.round(aadt), year: yearFromDatetime(p.LAST_UPDATE_DATETIME, 2024) };
    },
  });
}

async function fetchBcMottTmp(cfg: SourceConfig): Promise<CandPoint[]> {
  return wfsQuery({
    base: `${BCMOTT_BASE}&typeName=tig:TIG_TMP_GEOM_EXT_V&count=5000`,
    bboxParam: BCMOTT_BBOX,
    bbox: cfg.bbox,
    volumeProp: (p) => {
      const aadt = numOf(p.AADT);
      if (aadt <= 0) return null;
      const year = Math.round(numOf(p.LAST_YEAR)) || 2000;
      return { aadt: Math.round(aadt), year };
    },
  });
}

/**
 * Toronto bdit_volumes: the city Big Data Innovation Team's modeled citywide
 * AADT (2015), published as a shapefile on the CityofToronto GitHub. Minimal
 * SHP/DBF readers below — records are polylines with avg_vol per direction
 * row; directional rows are summed per l2_group_n before densifying.
 */
const BDIT_SHP =
  "https://raw.githubusercontent.com/CityofToronto/bdit_volumes/master/static_map/shp/aadt_2015_l2.shp";
const BDIT_DBF =
  "https://raw.githubusercontent.com/CityofToronto/bdit_volumes/master/static_map/shp/aadt_2015_l2.dbf";

function parseDbf(buf: Buffer): Array<Record<string, unknown>> {
  const nRec = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  const fields: Array<{ name: string; len: number }> = [];
  let off = 32;
  while (buf[off] !== 0x0d && off < headerLen) {
    const name = buf.toString("ascii", off, off + 11).replace(/\0.*$/, "");
    const len = buf[off + 16];
    fields.push({ name, len });
    off += 32;
  }
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < nRec; i++) {
    const base = headerLen + i * recLen;
    if (buf[base] === 0x2a) continue; // deleted
    let p = base + 1;
    const row: Record<string, unknown> = {};
    for (const f of fields) {
      row[f.name] = buf.toString("ascii", p, p + f.len).trim();
      p += f.len;
    }
    rows.push(row);
  }
  return rows;
}

function parseShpPolylines(buf: Buffer): Array<number[][][]> {
  const out: Array<number[][][]> = [];
  let off = 100;
  while (off + 8 <= buf.length) {
    const contentLen = buf.readUInt32BE(off + 4) * 2; // 16-bit words → bytes
    const rec = off + 8;
    const shapeType = buf.readInt32LE(rec);
    if (shapeType === 3 || shapeType === 13) {
      const numParts = buf.readInt32LE(rec + 36);
      const numPoints = buf.readInt32LE(rec + 40);
      const partsOff = rec + 44;
      const pointsOff = partsOff + numParts * 4;
      const partIdx: number[] = [];
      for (let i = 0; i < numParts; i++) partIdx.push(buf.readInt32LE(partsOff + i * 4));
      const pts: number[][] = [];
      for (let i = 0; i < numPoints; i++) {
        const x = buf.readDoubleLE(pointsOff + i * 16);
        const y = buf.readDoubleLE(pointsOff + i * 16 + 8);
        pts.push([x, y]);
      }
      const parts: number[][][] = [];
      for (let i = 0; i < numParts; i++) {
        parts.push(pts.slice(partIdx[i], i + 1 < numParts ? partIdx[i + 1] : numPoints));
      }
      out.push(parts);
    } else {
      out.push([]);
    }
    off = rec + contentLen;
  }
  return out;
}

/**
 * Inverse Transverse Mercator, UTM zone 17N on GRS80 (NAD83 ≈ WGS84 at
 * metre scale). Standard series expansion — checked against the bdit
 * extent landing inside the Toronto bbox.
 */
function utm17nToLonLat(E: number, N: number): [number, number] {
  const a = 6378137.0;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const lon0 = (-81 * Math.PI) / 180;
  const e2 = f * (2 - f);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const M = (N - 0) / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const ep2 = e2 / (1 - e2);
  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sin1 * sin1);
  const T1 = tan1 * tan1;
  const C1 = ep2 * cos1 * cos1;
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sin1 * sin1, 1.5);
  const D = (E - 500000) / (N1 * k0);
  const phi =
    phi1 -
    ((N1 * tan1) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon =
    lon0 +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) /
      cos1;
  return [(lon * 180) / Math.PI, (phi * 180) / Math.PI];
}

async function fetchTorontoBdit(cfg: SourceConfig): Promise<CandPoint[]> {
  const [shpRes, dbfRes] = await Promise.all([fetch(BDIT_SHP), fetch(BDIT_DBF)]);
  if (!shpRes.ok || !dbfRes.ok) throw new Error(`bdit: shp ${shpRes.status} dbf ${dbfRes.status}`);
  const shp = Buffer.from(await shpRes.arrayBuffer());
  const dbf = Buffer.from(await dbfRes.arrayBuffer());
  const rows = parseDbf(dbf);
  let shapes = parseShpPolylines(shp);
  if (rows.length !== shapes.length) {
    console.log(`  bdit: dbf ${rows.length} vs shp ${shapes.length} — pairing by index anyway`);
  }
  // Coordinates ship in UTM 17N (probe ~616k/4.83M) — reproject to lon/lat.
  const probe = shapes.find((s) => s.length && s[0].length);
  const [px, py] = probe?.[0][0] ?? [0, 0];
  if (px > 100000 && py > 1000000) {
    shapes = shapes.map((parts) =>
      parts.map((part) => part.map(([x, y]) => utm17nToLonLat(x, y))),
    );
    const [qx, qy] = shapes.find((s) => s.length && s[0].length)?.[0][0] ?? [0, 0];
    console.log(`  bdit: reprojected UTM17N → lon/lat (probe ${qx.toFixed(4)}, ${qy.toFixed(4)})`);
    if (qx < -81 || qx > -78 || qy < 43 || qy > 45) {
      throw new Error(`bdit: reprojection sanity failed (${qx}, ${qy})`);
    }
  } else if (px < -180 || px > -70 || py < 40 || py > 50) {
    throw new Error(`bdit: unexpected coordinate frame (${px}, ${py}) — aborting`);
  }
  // Sum directional avg_vol per l2_group_n; keep one geometry per group.
  const byGroup = new Map<string, { vol: number; parts: number[][][] }>();
  for (let i = 0; i < rows.length && i < shapes.length; i++) {
    const vol = numOf(rows[i].avg_vol);
    if (vol <= 0) continue;
    const key = String(rows[i].l2_group_n ?? i);
    const cur = byGroup.get(key);
    if (cur) cur.vol += vol;
    else byGroup.set(key, { vol, parts: shapes[i] });
  }
  const out: CandPoint[] = [];
  for (const { vol, parts } of byGroup.values()) {
    const tmp: CandPoint[] = [];
    for (const part of parts) densifyLine(part, Math.round(vol), 2015, tmp);
    for (const c of tmp) if (inBbox(c.lat, c.lon, cfg.bbox)) out.push(c);
  }
  console.log(`  bdit: ${byGroup.size} centreline groups (directional rows summed)`);
  return out;
}

/**
 * Gatineau: 7,384 per-approach 24h counts (CKAN GeoJSON, BOM-prefixed).
 * Approaches within ~40 m and the same year are clustered and summed
 * (Montréal precedent: intersection daily = sum of approach volumes).
 */
const GATINEAU_URL =
  "https://www.donneesquebec.ca/recherche/dataset/f1e7f552-278d-47d6-89c9-6aa9d3293bd1/resource/388e4ff5-e1f1-4c81-a734-79b907fcf236/download/comptage.json";

async function fetchGatineau(cfg: SourceConfig): Promise<CandPoint[]> {
  const res = await fetch(GATINEAU_URL);
  if (!res.ok) throw new Error(`Gatineau: ${res.status}`);
  const text = (await res.text()).replace(/^﻿/, "");
  const gj = JSON.parse(text) as {
    features?: Array<{
      properties: Record<string, unknown>;
      geometry?: { type: string; coordinates: number[] };
    }>;
  };
  // cluster key: year + ~40m coordinate bucket
  const clusters = new Map<string, { latSum: number; lonSum: number; n: number; vol: number; year: number }>();
  for (const f of gj.features ?? []) {
    const vol = numOf(f.properties.DEBIT_TOTAL24H);
    const year = Math.round(numOf(f.properties.ANNEE)) || 2020;
    const g = f.geometry;
    if (vol <= 0 || !g || g.type !== "Point") continue;
    const [lon, lat] = g.coordinates;
    const key = `${year}:${Math.round(lat / 0.00036)}:${Math.round(lon / 0.0005)}`;
    const c = clusters.get(key) ?? { latSum: 0, lonSum: 0, n: 0, vol: 0, year };
    c.latSum += lat; c.lonSum += lon; c.n++; c.vol += vol;
    clusters.set(key, c);
  }
  // latest year wins per ~40m location bucket
  const byLoc = new Map<string, { lat: number; lon: number; vol: number; year: number }>();
  for (const c of clusters.values()) {
    const lat = c.latSum / c.n;
    const lon = c.lonSum / c.n;
    if (!inBbox(lat, lon, cfg.bbox)) continue;
    const locKey = `${Math.round(lat / 0.00036)}:${Math.round(lon / 0.0005)}`;
    const cur = byLoc.get(locKey);
    if (!cur || c.year > cur.year) byLoc.set(locKey, { lat, lon, vol: c.vol, year: c.year });
  }
  console.log(`  Gatineau: ${gj.features?.length ?? 0} approach counts → ${byLoc.size} intersection points`);
  return [...byLoc.values()].map((c) => ({ lat: c.lat, lon: c.lon, aadt: Math.round(c.vol), year: c.year }));
}

/**
 * Nova Scotia provincial pair: volumes (Socrata 8524-ec3n) joined to the
 * 2024 section line geometry (vg5n-eehf) on zero-padded section_id.
 * Directional rows of the latest count date are summed per section.
 */
async function fetchNsHalifax(cfg: SourceConfig): Promise<CandPoint[]> {
  const volUrl =
    "https://data.novascotia.ca/resource/8524-ec3n.json?$limit=5000&$where=" +
    encodeURIComponent("county='HFX' AND aadt IS NOT NULL");
  const res = await fetch(volUrl);
  if (!res.ok) throw new Error(`NS volumes: ${res.status}`);
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  // latest date per section; sum directions sharing that date
  const bySection = new Map<string, { date: string; aadt: number }>();
  for (const r of rows) {
    const sec = String(Math.round(numOf(r.section_id)));
    const date = String(r.date ?? "");
    const aadt = numOf(r.aadt);
    if (!sec || !date || aadt <= 0) continue;
    const cur = bySection.get(sec);
    if (!cur || date > cur.date) bySection.set(sec, { date, aadt });
    else if (date === cur.date) cur.aadt += aadt;
  }
  console.log(`  NS: ${rows.length} HFX volume rows → ${bySection.size} sections (latest date, directions summed)`);

  const geoRes = await fetch(
    "https://data.novascotia.ca/resource/vg5n-eehf.json?$limit=2000&$where=" +
      encodeURIComponent("county='HFX'"),
  );
  if (!geoRes.ok) throw new Error(`NS geometry: ${geoRes.status}`);
  const geo = (await geoRes.json()) as Array<{
    section_id?: string;
    the_geom?: { type: string; coordinates: unknown };
  }>;
  const out: CandPoint[] = [];
  let joined = 0;
  for (const g of geo) {
    const sec = String(parseInt(g.section_id ?? "", 10));
    const v = bySection.get(sec);
    if (!v || !g.the_geom) continue;
    joined++;
    const year = parseInt(v.date.slice(0, 4), 10) || 2024;
    const tmp: CandPoint[] = [];
    if (g.the_geom.type === "MultiLineString") {
      for (const part of g.the_geom.coordinates as number[][][]) {
        densifyLine(part, Math.round(v.aadt), year, tmp);
      }
    } else if (g.the_geom.type === "LineString") {
      densifyLine(g.the_geom.coordinates as number[][], Math.round(v.aadt), year, tmp);
    }
    for (const c of tmp) if (inBbox(c.lat, c.lon, cfg.bbox)) out.push(c);
  }
  console.log(`  NS: ${joined} sections joined to geometry`);
  return out;
}

/**
 * Hamilton ADT refresh: layer 39 ships NULL geometry — join GEO_ID to the
 * Street_Centreline SEGID and take the segment midpoint (better than the
 * cross-street name geocode in fetch-canada-aadt-geocoded.ts).
 */
const HAM_ADT_URL =
  "https://services.arcgis.com/rYz782eMbySr2srL/arcgis/rest/services/Average_Daily_Traffic_Count/FeatureServer/39";
const HAM_CTRL_URL =
  "https://services.arcgis.com/rYz782eMbySr2srL/arcgis/rest/services/Street_Centreline/FeatureServer/14";

async function fetchHamiltonJoin(cfg: SourceConfig): Promise<CandPoint[]> {
  // ADT attributes (no geometry)
  const adt: Array<{ segId: string; vol: number; year: number }> = [];
  let offset = 0;
  while (true) {
    const url =
      `${HAM_ADT_URL}/query?where=${encodeURIComponent("AVERAGE_DAILY_TRAFFIC_COUNT > 0 AND COUNT_YEAR >= 2019")}` +
      `&outFields=GEO_ID,AVERAGE_DAILY_TRAFFIC_COUNT,COUNT_YEAR&returnGeometry=false` +
      `&resultRecordCount=2000&resultOffset=${offset}&f=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Hamilton ADT: ${res.status}`);
    const json = (await res.json()) as {
      features?: Array<{ attributes: Record<string, unknown> }>;
      exceededTransferLimit?: boolean;
    };
    const feats = json.features ?? [];
    for (const f of feats) {
      const segId = String(Math.round(numOf(f.attributes.GEO_ID)));
      const vol = numOf(f.attributes.AVERAGE_DAILY_TRAFFIC_COUNT);
      const year = Math.round(numOf(f.attributes.COUNT_YEAR));
      if (segId && vol > 0) adt.push({ segId, vol, year });
    }
    if (!json.exceededTransferLimit || feats.length === 0) break;
    offset += feats.length;
  }
  // latest year per segment
  const bySeg = new Map<string, { vol: number; year: number }>();
  for (const a of adt) {
    const cur = bySeg.get(a.segId);
    if (!cur || a.year > cur.year) bySeg.set(a.segId, { vol: a.vol, year: a.year });
  }
  console.log(`  Hamilton: ${adt.length} ADT rows (2019+) → ${bySeg.size} segments`);

  // centreline midpoints
  const out: CandPoint[] = [];
  offset = 0;
  let joined = 0;
  while (true) {
    const url =
      `${HAM_CTRL_URL}/query?where=1%3D1&outFields=SEGID&returnGeometry=true&outSR=4326` +
      `&resultRecordCount=2000&resultOffset=${offset}&f=json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Hamilton centreline: ${res.status}`);
    const json = (await res.json()) as {
      features?: Array<{ attributes: Record<string, unknown>; geometry?: { paths?: number[][][] } }>;
      exceededTransferLimit?: boolean;
    };
    const feats = json.features ?? [];
    for (const f of feats) {
      const segId = String(Math.round(numOf(f.attributes.SEGID)));
      const v = bySeg.get(segId);
      const path0 = f.geometry?.paths?.[0];
      if (!v || !path0 || path0.length === 0) continue;
      const mid = path0[Math.floor(path0.length / 2)];
      const [lon, lat] = mid;
      if (!inBbox(lat, lon, cfg.bbox)) continue;
      out.push({ lat, lon, aadt: Math.round(v.vol), year: v.year });
      joined++;
    }
    if (!json.exceededTransferLimit || feats.length === 0) break;
    offset += feats.length;
  }
  console.log(`  Hamilton: ${joined} segments joined to centreline midpoints`);
  return out;
}

/** Burlington 2016-2018 backfill: three year layers on the AADT service. */
async function fetchBurlingtonBackfill(cfg: SourceConfig): Promise<CandPoint[]> {
  const layers: Array<{ url: string; year: number }> = [
    { url: "https://services1.arcgis.com/xbWF6o8qyXoMFa8L/arcgis/rest/services/AADT/FeatureServer/0", year: 2016 },
    { url: "https://services1.arcgis.com/xbWF6o8qyXoMFa8L/arcgis/rest/services/AADT/FeatureServer/1", year: 2017 },
    { url: "https://services1.arcgis.com/xbWF6o8qyXoMFa8L/arcgis/rest/services/AADT/FeatureServer/2", year: 2018 },
  ];
  const out: CandPoint[] = [];
  for (const l of layers) {
    const pts = await arcgisQuery({
      url: l.url,
      volumeFields: ["Volume"],
      yearFields: ["AADT_Year"],
      fixedYear: l.year,
      bbox: cfg.bbox,
    });
    out.push(...pts);
  }
  return out;
}

// ── Source registry (validated endpoints, 2026-08-26 hunt) ──────────────
const SOURCES: SourceConfig[] = [
  // Vancouver — the 38% ceiling breakers
  {
    key: "van-surrey-loops",
    slug: "vancouver",
    bbox: BOUNDS.vancouver,
    sourceTag: "surrey_loop_counts",
    snapM: 600,
    fetch: fetchSurrey,
  },
  {
    key: "van-bcmott-utv",
    slug: "vancouver",
    bbox: BOUNDS.vancouver,
    sourceTag: "bc_mott_utv_aadt",
    snapM: 500,
    fetch: fetchBcMottUtv,
  },
  {
    key: "van-bcmott-tmp",
    slug: "vancouver",
    bbox: BOUNDS.vancouver,
    sourceTag: "bc_mott_tmp_aadt",
    snapM: 800,
    fetch: fetchBcMottTmp,
  },
  // Toronto
  // tor-bdit-2015 (fetchTorontoBdit) is deliberately NOT registered: measured
  // on 2026-08-26, it lights ZERO dark signals (Toronto's dark remainder is
  // the 905, outside city limits) while displacing 2,237 real SVC counts
  // with 2015 modeled values that ride the centreline and therefore always
  // win the closer-snap rule. Re-register only if the merge gains a
  // source-rank tier that lets real counts outrank models.
  {
    key: "tor-durham",
    slug: "toronto",
    bbox: BOUNDS.toronto,
    sourceTag: "durham_region_aadt",
    snapM: 800,
    fetch: (cfg) =>
      arcgisQuery({
        url: "https://maps.durham.ca/arcgis/rest/services/Open_Data/Durham_OpenData/MapServer/33",
        volumeFields: [],
        volumeYearPairs: [
          ["AADT_2024", 2024], ["AADT_2023", 2023], ["AADT_2022", 2022],
          ["AADT_2019", 2019], ["AADT_2018", 2018], ["AADT_2017", 2017],
        ],
        bbox: cfg.bbox,
      }),
  },
  // Ottawa
  // NOTE ott-gatineau is currently INERT: ottawa-signals.json holds zero
  // signals on the Québec side (verified 2026-08-26 — 0 signals at
  // lat>45.46 & lon<-75.63), so its 2,158 intersection points have nothing
  // to snap to. Kept registered so a future Ottawa signals re-fetch that
  // includes Gatineau picks the data up for free.
  {
    key: "ott-gatineau",
    slug: "ottawa",
    bbox: BOUNDS.ottawa,
    sourceTag: "gatineau_open_data_debits",
    snapM: 400,
    fetch: fetchGatineau,
  },
  {
    key: "ott-intvol-2025",
    slug: "ottawa",
    bbox: BOUNDS.ottawa,
    sourceTag: "ottawa_intersection_volume",
    snapM: 400,
    fetch: (cfg) =>
      arcgisQuery({
        url: "https://services.arcgis.com/G6F8XLCl5KtAlZ2G/arcgis/rest/services/Transportation_Intersection_Volume_2025/FeatureServer/0",
        volumeFields: ["Total_Adjusted_Volume__24h_"],
        fixedYear: 2025,
        bbox: cfg.bbox,
      }),
  },
  // Hamilton (incl. Burlington, which sits in the hamilton bbox)
  {
    key: "ham-burlington-2022",
    slug: "hamilton",
    bbox: BOUNDS.hamilton,
    sourceTag: "burlington_open_data_aadt",
    snapM: 600,
    fetch: (cfg) =>
      arcgisQuery({
        url: "https://services1.arcgis.com/xbWF6o8qyXoMFa8L/arcgis/rest/services/AADT_2022/FeatureServer/0",
        volumeFields: ["Volume"],
        yearFields: ["AADT_Year"],
        fixedYear: 2022,
        bbox: cfg.bbox,
      }),
  },
  {
    key: "ham-burlington-2016-18",
    slug: "hamilton",
    bbox: BOUNDS.hamilton,
    sourceTag: "burlington_open_data_aadt",
    snapM: 600,
    fetch: fetchBurlingtonBackfill,
  },
  {
    key: "ham-adt-join",
    slug: "hamilton",
    bbox: BOUNDS.hamilton,
    sourceTag: "hamilton_open_data_adt",
    snapM: 600,
    fetch: fetchHamiltonJoin,
  },
  // Halifax
  {
    key: "hfx-nsprov",
    slug: "halifax",
    bbox: BOUNDS.halifax,
    sourceTag: "ns_public_works_aadt",
    snapM: 800,
    fetch: fetchNsHalifax,
  },
  // Edmonton satellites
  {
    key: "edm-stalbert-2024",
    slug: "edmonton",
    bbox: BOUNDS.edmonton,
    sourceTag: "st_albert_open_data_adt",
    snapM: 800,
    fetch: (cfg) =>
      arcgisQuery({
        url: "https://services1.arcgis.com/fyyY0cNXvmUWvX1x/arcgis/rest/services/Traffic_Counts_2024/FeatureServer/0",
        volumeFields: ["ADT2024"],
        fixedYear: 2024,
        bbox: cfg.bbox,
      }),
  },
  {
    key: "edm-stalbert-2023",
    slug: "edmonton",
    bbox: BOUNDS.edmonton,
    sourceTag: "st_albert_open_data_adt",
    snapM: 800,
    fetch: (cfg) =>
      arcgisQuery({
        url: "https://services1.arcgis.com/fyyY0cNXvmUWvX1x/arcgis/rest/services/TrafficCounts2023/FeatureServer/0",
        volumeFields: ["ADT"],
        fixedYear: 2023,
        bbox: cfg.bbox,
      }),
  },
];

// ── Shared snap + merge (true-measured accounting) ──────────────────────
const DRY = process.argv.includes("--dry");

async function processSource(cfg: SourceConfig): Promise<void> {
  console.log(`\n=== ${cfg.key} → ${cfg.slug} ===`);
  const candidates = await cfg.fetch(cfg);
  console.log(`  ${candidates.length} candidate points in bbox`);
  if (candidates.length === 0) return;

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
  let dark2measured = 0;
  let synth2measured = 0;
  let measuredUpgraded = 0;
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
    const priorMeasured = prior && prior.source !== "synthetic_osm_class";
    if (priorMeasured && prior.distM <= bestD) continue;
    merged[key] = {
      aadt: best.aadt,
      year: best.year,
      kFactor: 9,
      distM: Math.round(bestD),
      source: cfg.sourceTag,
    };
    snapDists.push(bestD);
    if (!prior) dark2measured++;
    else if (priorMeasured) measuredUpgraded++;
    else synth2measured++;
  }

  const measuredTotal = Object.values(merged).filter((r) => r.source !== "synthetic_osm_class").length;
  const measuredPct = Math.round((measuredTotal / signals.length) * 1000) / 10;
  const median = snapDists.length
    ? [...snapDists].sort((a, b) => a - b)[Math.floor(snapDists.length / 2)]
    : 0;
  console.log(
    `  Snap: ${dark2measured} dark→measured + ${synth2measured} synthetic→measured + ${measuredUpgraded} measured-upgraded (median ${median.toFixed(0)} m).`,
  );
  console.log(`  TRUE measured: ${measuredTotal}/${signals.length} = ${measuredPct}%`);

  if (DRY) {
    console.log("  --dry: not writing");
    return;
  }
  writeFileSync(aadtPath, JSON.stringify(merged));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--dry");
  let selected: SourceConfig[];
  if (args[0] === "--all") {
    selected = SOURCES;
  } else if (args[0] === "--metro" && args[1]) {
    selected = SOURCES.filter((s) => s.slug === args[1]);
  } else if (args[0]) {
    selected = SOURCES.filter((s) => s.key === args[0]);
  } else {
    console.error(
      `Usage: tsx src/fetch-canada-aadt-deepfill.ts <source|--all|--metro <slug>> [--dry]\n  sources: ${SOURCES.map((s) => s.key).join(", ") || "(none registered yet)"}`,
    );
    process.exit(1);
  }
  if (selected.length === 0) {
    console.error("No matching sources.");
    process.exit(1);
  }
  for (const s of selected) {
    try {
      await processSource(s);
    } catch (e) {
      console.error(`  ERROR ${s.key}:`, e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
