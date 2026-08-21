/**
 * Extend multi-state metro inventories (signals + roads) to their FULL
 * bounding box using Geofabrik state PBF extracts.
 *
 * Why this exists: the 2026-05 pipeline (fetch-from-geofabrik-pbf.ts) built
 * several multi-state metros from a single state's PBF, so the out-of-state
 * side of each bbox shipped empty — new_york_metro had no NJ signals
 * (Newark/Jersey City/Elizabeth = 0), washington_dc_metro was District-only
 * (no NoVA, no suburban MD), philadelphia_metro had no South Jersey. Any
 * prospect running the /demo on a site there got an empty study. Overpass
 * full-bbox refetches are the alternative, but the public mirrors are too
 * flaky for NYC-density pulls; PBFs download once and parse locally.
 *
 * Unlike fetch-from-geofabrik-pbf.ts (which OVERWRITES per state and thus
 * can't accumulate a multi-state metro), this script APPENDS:
 *
 *   Signals — spatially matched against the existing inventory (15 m grid
 *   lookup); only unmatched nodes are appended, with their real OSM node
 *   ids. Existing tuples stay byte-identical and in place. This contract
 *   matters: `<slug>-aadt.json` is keyed by the signal tuple's id, and the
 *   Geofabrik-era files carry SEQUENTIAL ids (0,1,2,...) — reordering or
 *   renumbering would silently rewire measured AADT onto the wrong signals.
 *   A collision guard bumps any OSM id that would clash.
 *
 *   Roads — named motorway..tertiary(+links) ways intersecting the metro
 *   bbox are appended to the existing {classes, ways} file, with lanes/
 *   maxspeed carried like fetch-osm-roads.ts (5-tuples; readers tolerate
 *   the existing 3-tuples alongside). A content key (class|name|first
 *   vertex) makes re-runs idempotent. Since each append comes from a state
 *   the existing file never covered, no real-world dupes are possible.
 *
 * Appended signals have no AADT record yet — run the supplement pass after:
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-aadt-by-signal.ts \
 *     --supplement-only new-york philadelphia washington-dc
 *
 * Run (downloads ~1GB of PBFs to $GEOFABRIK_DIR, default /tmp/geofabrik_pbf):
 *   pnpm --filter @workspace/scripts exec tsx src/extend-region-coverage.ts
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS, type RegionCode } from "../../artifacts/tis-api-server/src/lib/regions";
import { resolveRoadFile, readJsonMaybeGz, writeJsonMaybeGz } from "./road-file-io";

const PBF_DIR = process.env["GEOFABRIK_DIR"] ?? "/tmp/geofabrik_pbf";

/**
 * Which state PBFs fill which metros' missing side.
 *
 * "new-york" was added 2026-08-18 for Suffolk County: the 2026-05 extraction
 * clipped new-york-signals.json to the then-current bbox (extent matched it
 * to four decimals, zero signals east of -73.4), so the Suffolk coverage
 * boxes added in regions.ts would otherwise claim territory with no
 * inventory — dropping every Suffolk site onto the 15-mile nearest-N
 * fallback, a WORSE answer than the honest "not covered" it replaced.
 */
const STATE_TARGETS: Record<string, RegionCode[]> = {
  "new-jersey": ["new_york_metro", "philadelphia_metro"],
  virginia: ["washington_dc_metro"],
  maryland: ["washington_dc_metro"],
  "new-york": ["new_york_metro"],
};

const MATCH_RADIUS_M = 15;
const CELL_DEG = 0.005;

const ROAD_HIGHWAYS = [
  "motorway", "trunk", "primary", "secondary", "tertiary",
  "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
];
const ROAD_CLASS_CODE = new Map<string, number>([
  ["motorway", 0], ["trunk", 1], ["primary", 2], ["secondary", 3], ["tertiary", 4],
]);

type SignalTuple = [number, number, number, string | null, number];
type Bounds = { latMin: number; latMax: number; lonMin: number; lonMax: number };
type GeoJsonFeature = {
  type: "Feature";
  geometry: { type: string; coordinates: number[] | number[][] | number[][][] };
  properties: Record<string, unknown>;
};

function osmium(args: string): void {
  const cmd = `osmium ${args}`;
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function download(state: string): string {
  mkdirSync(PBF_DIR, { recursive: true });
  const pbf = path.join(PBF_DIR, `${state}.osm.pbf`);
  if (existsSync(pbf) && statSync(pbf).size > 10_000_000) {
    console.log(`  (${state} PBF already downloaded)`);
    return pbf;
  }
  const url = `https://download.geofabrik.de/north-america/us/${state}-latest.osm.pbf`;
  console.log(`  downloading ${url}`);
  execSync(`curl -fL --retry 3 -o "${pbf}" "${url}"`, { stdio: "inherit" });
  return pbf;
}

/** osmium tags-filter → export geojson (with @id attributes). Idempotent. */
function extractState(state: string): { signalsGeoJson: string; roadsGeoJson: string } {
  const pbf = download(state);
  const sgj = path.join(PBF_DIR, `${state}-signals.geojson`);
  const rgj = path.join(PBF_DIR, `${state}-roads.geojson`);
  if (!existsSync(sgj)) {
    const sigPbf = path.join(PBF_DIR, `${state}-signals.osm.pbf`);
    if (!existsSync(sigPbf)) {
      osmium(`tags-filter --overwrite -o "${sigPbf}" "${pbf}" n/highway=traffic_signals`);
    }
    osmium(`export --overwrite -o "${sgj}" -f geojson --attributes=type,id "${sigPbf}"`);
  }
  if (!existsSync(rgj)) {
    const roadPbf = path.join(PBF_DIR, `${state}-roads.osm.pbf`);
    if (!existsSync(roadPbf)) {
      const expr = ROAD_HIGHWAYS.map((h) => `w/highway=${h}`).join(" ");
      osmium(`tags-filter --overwrite -o "${roadPbf}" "${pbf}" ${expr}`);
    }
    osmium(`export --overwrite -o "${rgj}" -f geojson --attributes=type,id "${roadPbf}"`);
  }
  return { signalsGeoJson: sgj, roadsGeoJson: rgj };
}

/** FeatureCollection or line-delimited — same probe as fetch-from-geofabrik-pbf. */
function parseGeoJsonFeatures(filePath: string): GeoJsonFeature[] {
  const sizeMB = statSync(filePath).size / 1024 / 1024;
  console.log(`  reading ${filePath} (${sizeMB.toFixed(1)} MB)`);
  const trimmed = readFileSync(filePath, "utf8").trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as { features?: GeoJsonFeature[]; type?: string };
      if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) return obj.features;
    } catch { /* fall through */ }
  }
  const out: GeoJsonFeature[] = [];
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    try {
      const f = JSON.parse(l) as GeoJsonFeature;
      if (f.type === "Feature") out.push(f);
    } catch { /* skip malformed */ }
  }
  return out;
}

function inBbox(lat: number, lon: number, b: Bounds): boolean {
  return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
}

function lineIntersectsBbox(coords: number[][], b: Bounds): boolean {
  let latLo = Infinity, latHi = -Infinity, lonLo = Infinity, lonHi = -Infinity;
  for (const [lon, lat] of coords) {
    if (lat! < latLo) latLo = lat!;
    if (lat! > latHi) latHi = lat!;
    if (lon! < lonLo) lonLo = lon!;
    if (lon! > lonHi) lonHi = lon!;
  }
  return !(latHi < b.latMin || latLo > b.latMax || lonHi < b.lonMin || lonLo > b.lonMax);
}

/**
 * Membership boxes for a metro: the coverage union when declared, else the
 * single bbox. Mirrors regionForCoordinate — a region with coverageBoxes has
 * a `bounds` that is only the envelope, and the envelope must not decide
 * what gets appended (new_york_metro's spans Long Island Sound).
 */
function metroBoxes(metro: RegionCode): Bounds[] {
  const r = REGIONS[metro]!;
  return r.coverageBoxes ?? [r.bounds];
}

function inAnyBbox(lat: number, lon: number, boxes: Bounds[]): boolean {
  return boxes.some((b) => inBbox(lat, lon, b));
}

function lineIntersectsAnyBbox(coords: number[][], boxes: Bounds[]): boolean {
  return boxes.some((b) => lineIntersectsBbox(coords, b));
}

function distMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const M_PER_DEG_LAT = 111_320;
  const midLat = (lat1 + lat2) / 2;
  const mPerDegLon = 111_320 * Math.cos((midLat * Math.PI) / 180);
  return Math.sqrt(((lat1 - lat2) * M_PER_DEG_LAT) ** 2 + ((lon1 - lon2) * mPerDegLon) ** 2);
}

function buildIndex(tuples: SignalTuple[]): Map<string, number[]> {
  const idx = new Map<string, number[]>();
  for (let i = 0; i < tuples.length; i++) {
    const [, lat, lon] = tuples[i]!;
    const k = `${Math.floor(lat / CELL_DEG)}_${Math.floor(lon / CELL_DEG)}`;
    let bucket = idx.get(k);
    if (!bucket) { bucket = []; idx.set(k, bucket); }
    bucket.push(i);
  }
  return idx;
}

function hasNeighbor(tuples: SignalTuple[], idx: Map<string, number[]>, lat: number, lon: number): boolean {
  const latCell = Math.floor(lat / CELL_DEG);
  const lonCell = Math.floor(lon / CELL_DEG);
  for (let dlat = -1; dlat <= 1; dlat++) {
    for (let dlon = -1; dlon <= 1; dlon++) {
      const bucket = idx.get(`${latCell + dlat}_${lonCell + dlon}`);
      if (!bucket) continue;
      for (const i of bucket) {
        const [, tlat, tlon] = tuples[i]!;
        if (distMeters(lat, lon, tlat, tlon) <= MATCH_RADIUS_M) return true;
      }
    }
  }
  return false;
}

/** Same parsing as fetch-osm-roads.ts. */
function parseLanes(raw: unknown): number | null {
  if (typeof raw !== "string" || !raw) return null;
  let best: number | null = null;
  for (const part of raw.split(";")) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n > 0 && n < 30 && (best === null || n > best)) best = n;
  }
  return best;
}
function parseMaxspeedKmh(raw: unknown): number | null {
  if (typeof raw !== "string" || !raw) return null;
  const m = raw.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph)?$/);
  if (!m) return null;
  const val = Number.parseFloat(m[1]!);
  if (!Number.isFinite(val) || val <= 0) return null;
  return Math.round(m[2] === "mph" ? val * 1.60934 : val);
}

function regionSlug(code: RegionCode): string {
  return code.replace(/_metro$/, "").replace(/_/g, "-");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../artifacts/api-server/src/data");
const ARCHIVE_DIR = path.resolve(DATA_DIR, "_osm-archive");

function archiveOnce(src: string, archiveName: string): void {
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const dst = path.resolve(ARCHIVE_DIR, archiveName);
  if (!existsSync(dst)) copyFileSync(src, dst);
}

function appendSignals(metro: RegionCode, features: GeoJsonFeature[], state: string): void {
  const slug = regionSlug(metro);
  const p = path.resolve(DATA_DIR, `${slug}-signals.json`);
  if (!existsSync(p)) throw new Error(`Missing baseline signals at ${p}`);
  archiveOnce(p, `${slug}-signals.pre-extend.json`);

  const existing = JSON.parse(readFileSync(p, "utf8")) as SignalTuple[];
  const boxes = metroBoxes(metro);
  const idx = buildIndex(existing);
  const usedIds = new Set<number>(existing.map((t) => t[0]));
  const appended: SignalTuple[] = [];
  let dup = 0;
  let idBumps = 0;

  for (const f of features) {
    if (f.geometry.type !== "Point") continue;
    const [lon, lat] = f.geometry.coordinates as [number, number];
    if (!inAnyBbox(lat, lon, boxes)) continue;
    if (hasNeighbor(existing, idx, lat, lon)) { dup++; continue; }
    let id = Number.parseInt(String(f.properties["@id"] ?? f.properties["id"] ?? ""), 10);
    if (!Number.isFinite(id) || id <= 0) continue;
    // Guard against colliding with the legacy sequential ids (0..N) or a
    // previously appended id — bump far outside the real OSM id range.
    while (usedIds.has(id)) { id += 1_000_000_000_000; idBumps++; }
    usedIds.add(id);
    const name = typeof f.properties["name"] === "string" ? (f.properties["name"] as string) : null;
    appended.push([id, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, name, 2]);
    // Also index the appended one so two same-state nodes 10m apart don't both land.
    existing.push(appended[appended.length - 1]!);
    const k = `${Math.floor(lat / CELL_DEG)}_${Math.floor(lon / CELL_DEG)}`;
    let bucket = idx.get(k);
    if (!bucket) { bucket = []; idx.set(k, bucket); }
    bucket.push(existing.length - 1);
  }

  writeFileSync(p, JSON.stringify(existing));
  console.log(`  ✔ ${slug} signals: +${appended.length} from ${state} (dup-skipped ${dup}, id bumps ${idBumps}) → total ${existing.length}`);
}

function appendRoads(metro: RegionCode, features: GeoJsonFeature[], state: string): void {
  const slug = regionSlug(metro);
  // Baseline may be raw .json or gzipped .json.gz (post-refetch regions are
  // gz-only). Read whichever exists and write back in the SAME format so the
  // file never silently changes representation mid-append.
  const p = resolveRoadFile(DATA_DIR, slug);
  if (!p) throw new Error(`Missing baseline roads at ${path.resolve(DATA_DIR, `${slug}-roads.json[.gz]`)}`);
  archiveOnce(p, `${slug}-roads.pre-extend.json${p.endsWith(".gz") ? ".gz" : ""}`);

  const road = readJsonMaybeGz<{ classes: string[]; ways: unknown[] }>(p);
  const boxes = metroBoxes(metro);

  // Idempotency key: class|name|first vertex. Appends come from states the
  // file never covered, so collisions only occur on a re-run.
  const seen = new Set<string>();
  for (const w of road.ways) {
    const way = w as unknown[];
    const pts = way[2] as Array<[number, number]> | undefined;
    if (!Array.isArray(pts) || pts.length === 0) continue;
    seen.add(`${way[0]}|${way[1]}|${pts[0]![0]}|${pts[0]![1]}`);
  }

  let added = 0;
  const byClass: Record<string, number> = {};
  for (const f of features) {
    const name = typeof f.properties["name"] === "string" ? (f.properties["name"] as string).trim() : "";
    if (!name) continue;
    const hw = f.properties["highway"] as string | undefined;
    if (!hw) continue;
    const baseClass = hw.endsWith("_link") ? hw.slice(0, -5) : hw;
    const code = ROAD_CLASS_CODE.get(baseClass);
    if (code === undefined) continue;

    const geoms: number[][][] = [];
    if (f.geometry.type === "LineString") geoms.push(f.geometry.coordinates as number[][]);
    else if (f.geometry.type === "MultiLineString") for (const part of f.geometry.coordinates as number[][][]) geoms.push(part);
    else continue;

    const lanes = parseLanes(f.properties["lanes"]);
    const maxspeed = parseMaxspeedKmh(f.properties["maxspeed"]);

    for (const g of geoms) {
      if (g.length < 2) continue;
      if (!lineIntersectsAnyBbox(g, boxes)) continue;
      const polyline = g.map(([lon, lat]) => [
        Math.round((lat as number) * 1e5) / 1e5,
        Math.round((lon as number) * 1e5) / 1e5,
      ]);
      const key = `${code}|${name}|${polyline[0]![0]}|${polyline[0]![1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      road.ways.push([code, name, polyline, lanes, maxspeed]);
      byClass[baseClass] = (byClass[baseClass] ?? 0) + 1;
      added++;
    }
  }

  writeJsonMaybeGz(p, road);
  console.log(`  ✔ ${slug} roads: +${added} ways from ${state} (${JSON.stringify(byClass)}) → total ${road.ways.length}`);
}

function main(): void {
  for (const [state, metros] of Object.entries(STATE_TARGETS)) {
    console.log(`\n=== ${state} → ${metros.join(", ")} ===`);
    const { signalsGeoJson, roadsGeoJson } = extractState(state);
    const signalFeatures = parseGeoJsonFeatures(signalsGeoJson);
    console.log(`  ${signalFeatures.length} signals statewide`);
    for (const metro of metros) appendSignals(metro, signalFeatures, state);
    const roadFeatures = parseGeoJsonFeatures(roadsGeoJson);
    console.log(`  ${roadFeatures.length} road features statewide`);
    for (const metro of metros) appendRoads(metro, roadFeatures, state);
  }
}

main();
