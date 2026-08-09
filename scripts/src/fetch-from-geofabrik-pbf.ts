/**
 * Extract per-metro signals + roads from Geofabrik OSM PBF state extracts.
 *
 * Why this exists: Overpass API has been timing out (504/429) on bulk
 * regional queries during the 2026-05-27 expansion run. Geofabrik
 * publishes daily PBF snapshots per US state with no rate limits —
 * download once, parse locally, slice by metro bbox.
 *
 * Pipeline per state:
 *   1. osmium tags-filter <state>.osm.pbf n/highway=traffic_signals \
 *        → <state>-signals.geojson
 *   2. osmium tags-filter <state>.osm.pbf w/highway=motorway,trunk,...,tertiary \
 *        → <state>-roads.geojson  (with named only)
 *   3. Stream-parse the geojson; for each metro in this state, filter by
 *      its bbox + write the existing schema
 *      (compact tuple <slug>-signals.json + classes/ways <slug>-roads.json).
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-from-geofabrik-pbf.ts
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS, type RegionCode } from "../../artifacts/tis-api-server/src/lib/regions";

const PBF_DIR = "/tmp/geofabrik_pbf";

// Which metros pull from which state PBFs. For metros that span state lines
// we include all relevant states (Chattanooga TN+GA, Memphis TN+MS+AR,
// Louisville KY+IN, etc.). When a state's PBF isn't downloaded, signals/
// roads outside the primary state are silently missing — those edge areas
// of the metro will have lower coverage.
const STATES: Record<string, RegionCode[]> = {
  florida: ["jacksonville_metro", "pensacola_metro", "fort_lauderdale_metro", "west_palm_beach_metro", "daytona_beach_metro", "lakeland_metro", "tallahassee_metro", "fort_myers_metro", "sarasota_metro"],
  georgia: ["savannah_metro", "augusta_metro", "macon_metro"],
  tennessee: ["memphis_metro", "knoxville_metro", "chattanooga_metro"],
  "north-carolina": ["asheville_metro", "wilmington_metro", "triad_metro", "fayetteville_metro", "greenville_nc_metro"],
  "south-carolina": ["charleston_sc_metro", "columbia_sc_metro", "greenville_spartanburg_metro"],
  alabama: ["birmingham_metro", "mobile_metro", "huntsville_metro"],
  virginia: ["hampton_roads_metro", "richmond_metro", "roanoke_metro", "charlottesville_metro"],
  kentucky: ["louisville_metro", "lexington_metro"],
  louisiana: ["new_orleans_metro"],
  // ── Tier-4 ──
  "district-of-columbia": ["washington_dc_metro"],
  maryland: ["baltimore_metro"],
  pennsylvania: ["philadelphia_metro", "pittsburgh_metro", "allentown_metro", "harrisburg_metro", "scranton_metro", "erie_metro"],
  "new-york": ["new_york_metro", "rochester_ny_metro", "buffalo_metro", "syracuse_metro", "albany_metro"],
  massachusetts: ["boston_metro", "worcester_metro", "springfield_ma_metro"],
  illinois: ["chicago_metro", "springfield_il_metro", "rockford_metro", "peoria_metro", "champaign_metro"],
  michigan: ["detroit_metro", "grand_rapids_metro", "lansing_metro", "ann_arbor_metro", "flint_metro"],
  minnesota: ["twin_cities_metro", "rochester_mn_metro", "duluth_metro"],
  ohio: ["cleveland_metro", "columbus_oh_metro", "cincinnati_metro", "toledo_metro", "akron_metro", "dayton_metro", "youngstown_metro"],
  indiana: ["indianapolis_metro", "fort_wayne_metro", "south_bend_metro", "evansville_metro"],
  missouri: ["st_louis_metro", "kansas_city_metro", "springfield_mo_metro", "columbia_mo_metro"],
  wisconsin: ["milwaukee_metro", "madison_metro", "green_bay_metro"],
  texas: ["houston_metro", "dallas_fort_worth_metro", "austin_metro", "san_antonio_metro", "el_paso_metro", "corpus_christi_metro", "lubbock_metro", "mcallen_metro"],
  // ── Tier-5 ──
  california: ["los_angeles_metro", "sf_bay_metro", "san_diego_metro", "sacramento_metro", "inland_empire_metro", "fresno_metro", "bakersfield_metro", "stockton_metro", "modesto_metro", "oxnard_metro"],
  oregon: ["portland_metro", "eugene_metro", "salem_or_metro"],
  washington: ["seattle_metro", "spokane_metro", "tacoma_metro"],
  nevada: ["las_vegas_metro", "reno_metro"],
  arizona: ["phoenix_metro", "tucson_metro"],
  colorado: ["denver_metro", "colorado_springs_metro", "fort_collins_metro"],
  utah: ["salt_lake_city_metro", "provo_metro", "ogden_metro"],
  "new-mexico": ["albuquerque_metro"],
  // ── Tier-6: 50-state coverage ──
  connecticut: ["hartford_metro", "new_haven_metro", "bridgeport_metro"],
  "rhode-island": ["providence_metro"],
  "new-hampshire": ["manchester_metro"],
  vermont: ["burlington_vt_metro"],
  maine: ["portland_me_metro"],
  "new-jersey": ["trenton_metro"],
  "west-virginia": ["charleston_wv_metro"],
  mississippi: ["jackson_ms_metro"],
  arkansas: ["little_rock_metro"],
  oklahoma: ["oklahoma_city_metro", "tulsa_metro"],
  iowa: ["des_moines_metro", "cedar_rapids_metro"],
  nebraska: ["omaha_metro"],
  kansas: ["wichita_metro"],
  "north-dakota": ["fargo_metro"],
  "south-dakota": ["sioux_falls_metro"],
  idaho: ["boise_metro"],
  montana: ["billings_metro"],
  wyoming: ["cheyenne_metro"],
  alaska: ["anchorage_metro"],
  hawaii: ["honolulu_metro"],
  // ── Tier-8: Canada (Geofabrik publishes per-province under north-america/canada/) ──
  // Path uses canadian state name only; the prefix `canada/` is added by the
  // download URL constructor when state has no US equivalent (see script).
  ontario: ["toronto_metro", "ottawa_metro", "hamilton_metro"],
  quebec: ["montreal_metro", "quebec_city_metro"],
  "british-columbia": ["vancouver_metro"],
  alberta: ["calgary_metro", "edmonton_metro"],
  manitoba: ["winnipeg_metro"],
  "nova-scotia": ["halifax_metro"],
  // ── Tier-9: Mexico + UK ──
  mexico: ["mexico_city_metro", "guadalajara_metro", "monterrey_metro", "puebla_metro", "tijuana_metro", "toluca_metro", "leon_metro", "juarez_metro", "queretaro_metro", "merida_metro"],
  "great-britain": ["london_metro", "manchester_uk_metro", "birmingham_uk_metro", "glasgow_metro", "edinburgh_metro", "leeds_metro", "bristol_metro"],
};

const ROAD_HIGHWAYS = [
  "motorway", "trunk", "primary", "secondary", "tertiary",
  "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
];
const ROAD_CLASS_CODE = new Map<string, number>([
  ["motorway", 0], ["trunk", 1], ["primary", 2], ["secondary", 3], ["tertiary", 4],
]);

type GeoJsonFeature = {
  type: "Feature";
  geometry: { type: "Point" | "LineString" | "MultiLineString"; coordinates: number[] | number[][] | number[][][] };
  properties: Record<string, unknown>;
};

/** OSM `lanes` is total both-directions; values like "2", "3", "2;3" occur.
 *  Take the max of any ;-separated list. Returns null when untagged/unparseable.
 *  (Same semantics as fetch-osm-roads.ts.) */
function parseLanes(raw: string | undefined): number | null {
  if (!raw) return null;
  let best: number | null = null;
  for (const part of raw.split(";")) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n > 0 && n < 30 && (best === null || n > best)) best = n;
  }
  return best;
}

/** OSM `maxspeed` → km/h. Handles "50", "50 mph", "50 km/h"; null for zone
 *  refs ("RU:urban"), "none", "walk", or anything non-numeric. */
function parseMaxspeedKmh(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph)?$/);
  if (!m) return null;
  const val = Number.parseFloat(m[1]!);
  if (!Number.isFinite(val) || val <= 0) return null;
  const kmh = m[2] === "mph" ? val * 1.60934 : val;
  return Math.round(kmh);
}

function osmium(args: string): void {
  const cmd = `osmium ${args}`;
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

/** Extract signals + roads geojson per state via osmium. Idempotent (skips if file exists). */
function extractState(state: string): { signalsGeoJson: string; roadsGeoJson: string } | null {
  const pbf = path.join(PBF_DIR, `${state}.osm.pbf`);
  if (!existsSync(pbf)) {
    console.warn(`  ✗ ${state}: PBF not downloaded (${pbf})`);
    return null;
  }
  const sgj = path.join(PBF_DIR, `${state}-signals.geojson`);
  const rgj = path.join(PBF_DIR, `${state}-roads.geojson`);

  if (!existsSync(sgj)) {
    // osmium tags-filter outputs OSM PBF only; geojson must be a 2-step.
    const sigPbf = path.join(PBF_DIR, `${state}-signals.osm.pbf`);
    if (!existsSync(sigPbf)) {
      osmium(`tags-filter --overwrite -o "${sigPbf}" "${pbf}" n/highway=traffic_signals`);
    }
    osmium(`export --overwrite -o "${sgj}" -f geojson "${sigPbf}"`);
  } else {
    console.log(`  (signals geojson already exists for ${state}; skipping extract)`);
  }
  if (!existsSync(rgj)) {
    const tmpPbf = path.join(PBF_DIR, `${state}-roads.osm.pbf`);
    if (!existsSync(tmpPbf)) {
      const expr = ROAD_HIGHWAYS.map((h) => `w/highway=${h}`).join(" ");
      osmium(`tags-filter --overwrite -o "${tmpPbf}" "${pbf}" ${expr}`);
    }
    osmium(`export --overwrite -o "${rgj}" -f geojson "${tmpPbf}"`);
  } else {
    console.log(`  (roads geojson already exists for ${state}; skipping extract)`);
  }
  return { signalsGeoJson: sgj, roadsGeoJson: rgj };
}

/** Test if a point is inside a bbox. */
function inBbox(lat: number, lon: number, b: { latMin: number; latMax: number; lonMin: number; lonMax: number }): boolean {
  return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
}

/** Test if a LineString intersects a bbox (cheap envelope test). */
function lineIntersectsBbox(coords: number[][], b: { latMin: number; latMax: number; lonMin: number; lonMax: number }): boolean {
  let lineLatMin = Infinity, lineLatMax = -Infinity, lineLonMin = Infinity, lineLonMax = -Infinity;
  for (const [lon, lat] of coords) {
    if (lat < lineLatMin) lineLatMin = lat;
    if (lat > lineLatMax) lineLatMax = lat;
    if (lon < lineLonMin) lineLonMin = lon;
    if (lon > lineLonMax) lineLonMax = lon;
  }
  return !(lineLatMax < b.latMin || lineLatMin > b.latMax || lineLonMax < b.lonMin || lineLonMin > b.lonMax);
}

/**
 * Stream-parse a geojson file. Files can be huge (>100MB for a state's
 * roads), so we parse one feature at a time rather than loading whole JSON.
 * osmium's geojson format writes one feature per line OR a FeatureCollection.
 * We probe and pick the right strategy.
 */
function parseGeoJsonFeatures(filePath: string): GeoJsonFeature[] {
  // For simplicity, load whole file. Geofabrik PBFs are ~280MB; the filtered
  // geojsons are far smaller (signals ~few MB, roads ~50-150MB). Node can
  // handle this in ~2-4GB heap; if we hit limits we'll switch to streaming.
  const sizeMB = statSync(filePath).size / 1024 / 1024;
  console.log(`  reading ${filePath} (${sizeMB.toFixed(1)} MB)`);
  const text = readFileSync(filePath, "utf8");
  // osmium produces a FeatureCollection OR line-delimited features depending
  // on options. Try FeatureCollection first.
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as { features?: GeoJsonFeature[]; type?: string };
      if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) return obj.features;
      if ((obj as GeoJsonFeature).type === "Feature") return [obj as unknown as GeoJsonFeature];
    } catch {
      // Fall through to line-delimited
    }
  }
  // Line-delimited GeoJSON: one feature per line
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

/** Run the pipeline for one state: extract → split per metro → write outputs. */
function processState(state: string, metros: RegionCode[]): void {
  console.log(`\n=== ${state} → metros: ${metros.join(", ")} ===`);
  const extracted = extractState(state);
  if (!extracted) return;

  // ── Signals ────────────────────────────────────────────────────────
  const signalFeatures = parseGeoJsonFeatures(extracted.signalsGeoJson);
  console.log(`  ${signalFeatures.length} signals in ${state} statewide`);

  // ── Roads ──────────────────────────────────────────────────────────
  const roadFeatures = parseGeoJsonFeatures(extracted.roadsGeoJson);
  console.log(`  ${roadFeatures.length} road features in ${state} statewide`);

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = path.resolve(__dirname, "../../artifacts/api-server/src/data");

  for (const metro of metros) {
    const region = REGIONS[metro];
    if (!region) continue;
    const b = region.bounds;
    const slug = metro.replace(/_metro$/, "").replace(/_/g, "-");

    // Signals → tuple format
    const sigOut: Array<[number, number, number, string | null, number]> = [];
    for (const f of signalFeatures) {
      if (f.geometry.type !== "Point") continue;
      const [lon, lat] = f.geometry.coordinates as [number, number];
      if (!inBbox(lat, lon, b)) continue;
      const id = parseInt(String((f.properties as { "@id"?: string; id?: number })["@id"] ?? f.properties.id ?? 0), 10) || sigOut.length;
      const name = (f.properties.name as string | undefined) ?? null;
      sigOut.push([id, Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, name, 2]);
    }
    const sigPath = path.join(dataDir, `${slug}-signals.json`);
    writeFileSync(sigPath, JSON.stringify(sigOut));
    console.log(`  ✔ ${slug}: ${sigOut.length} signals → ${sigPath}`);

    // Roads → {classes, ways} format with named ways only. Length-5
    // tuples [code, name, polyline, lanes|null, maxspeedKmh|null] —
    // same shape fetch-osm-roads.ts writes; readers accept length ≥ 3.
    const ways: unknown[] = [];
    const byClass: Record<string, number> = {};
    for (const f of roadFeatures) {
      const name = (f.properties.name as string | undefined)?.trim();
      if (!name) continue;
      const highway = f.properties.highway as string | undefined;
      if (!highway) continue;
      const baseClass = highway.endsWith("_link") ? highway.slice(0, -5) : highway;
      const code = ROAD_CLASS_CODE.get(baseClass);
      if (code === undefined) continue;
      const lanes = parseLanes(f.properties.lanes as string | undefined);
      const maxspeed = parseMaxspeedKmh(f.properties.maxspeed as string | undefined);

      // Geometry: could be LineString or MultiLineString
      const geoms: number[][][] = [];
      if (f.geometry.type === "LineString") {
        geoms.push(f.geometry.coordinates as number[][]);
      } else if (f.geometry.type === "MultiLineString") {
        for (const part of f.geometry.coordinates as number[][][]) geoms.push(part);
      } else {
        continue;
      }

      for (const g of geoms) {
        if (g.length < 2) continue;
        if (!lineIntersectsBbox(g, b)) continue;
        // Round to 5 decimals (~1.1m precision) to save bundle size.
        const polyline = g.map(([lon, lat]) => [
          Math.round((lat as number) * 1e5) / 1e5,
          Math.round((lon as number) * 1e5) / 1e5,
        ]);
        ways.push([code, name, polyline, lanes, maxspeed]);
        byClass[baseClass] = (byClass[baseClass] ?? 0) + 1;
      }
    }
    const roadOut = { classes: ["motorway", "trunk", "primary", "secondary", "tertiary"], ways };
    const roadPath = path.join(dataDir, `${slug}-roads.json`);
    writeFileSync(roadPath, JSON.stringify(roadOut));
    console.log(`  ✔ ${slug}: ${ways.length} ways (${JSON.stringify(byClass)}) → ${roadPath}`);
  }
}

function main(): void {
  // Optional CLI filter: metro codes. When given, only those metros are
  // written and only their states' PBFs are required — a full-state run
  // would otherwise rebuild every sibling metro's signals/roads files,
  // breaking the tuple-id keying their <slug>-aadt.json depends on
  // (append-only invariant, cf. PR #82).
  const wanted = new Set(process.argv.slice(2) as RegionCode[]);
  const states: Array<[string, RegionCode[]]> = [];
  for (const [state, metros] of Object.entries(STATES)) {
    const filtered = wanted.size > 0 ? metros.filter((m) => wanted.has(m)) : metros;
    if (filtered.length > 0) states.push([state, filtered]);
  }

  // Verify the needed PBFs are downloaded
  const missing: string[] = [];
  for (const [state] of states) {
    const pbf = path.join(PBF_DIR, `${state}.osm.pbf`);
    if (!existsSync(pbf)) missing.push(state);
  }
  if (missing.length > 0) {
    console.error(`Missing PBFs: ${missing.join(", ")}`);
    console.error(`Download with: for s in ${missing.join(" ")}; do curl -L -o ${PBF_DIR}/$s.osm.pbf https://download.geofabrik.de/north-america/us/$s-latest.osm.pbf; done`);
    process.exit(1);
  }

  for (const [state, metros] of states) {
    try {
      processState(state, metros);
    } catch (e) {
      console.error(`✗ ${state}: ${(e as Error).message}`);
    }
  }
}

main();
