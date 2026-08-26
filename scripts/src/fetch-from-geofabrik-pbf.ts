/**
 * Extract per-metro roads (and optionally signals) from Geofabrik OSM PBF
 * state extracts — the no-rate-limit alternative to Overpass.
 *
 * Why this exists: Overpass API times out (504/429) on bulk regional
 * queries — first during the 2026-05-27 expansion run, again during the
 * 2026-08 residential/oneway refetch (main instance 504s, mirrors refusing
 * connections). Geofabrik publishes daily PBF snapshots per US state with
 * no rate limits — download once, filter locally with osmium, slice by
 * metro bbox.
 *
 * OUTPUT FORMAT — must stay in lockstep with fetch-osm-roads.ts (the
 * Overpass fetcher), which is the format's ground truth:
 *
 *   {
 *     "classes": ["motorway","trunk","primary","secondary","tertiary",
 *                 "residential","unclassified"],
 *     "ways": [
 *       [classCode, "Way Name"|null, [[lat,lon], ...], lanes|null, maxspeedKmh|null, oneway],
 *     ]
 *   }
 *
 *   name is null for unnamed ways (kept for routing since 2026-08-25).
 *
 * The classes ARRAY ORDER is the classCode mapping — reordering it silently
 * remaps every way's class downstream, so CLASSES here must be identical to
 * fetch-osm-roads.ts, not merely same-membership. `oneway` is relative to
 * way node order (1 = along, -1 = against, 0 = two-way); osmium's geojson
 * export preserves node order in LineString coordinates, so the sign
 * convention carries over from OSM unchanged (verified way-for-way against
 * an Overpass-fetched region: identical polylines, identical oneway).
 *
 * Written as `<slug>-roads.json.gz` (gzip -9, same policy as
 * fetch-osm-roads.ts): statewide raw JSON exceeds GitHub's 100MB per-file
 * hard limit post-residential-refetch, so fresh fetches must never land
 * raw. Readers prefer .gz; a stale raw twin is removed.
 *
 * Pipeline per state:
 *   1. osmium tags-filter <state>.osm.pbf w/highway=motorway,...,residential,
 *        unclassified (+ _link variants) → <state>-roads-v2.osm.pbf
 *   2. osmium export -f geojsonseq → <state>-roads-v2.geojsonseq
 *      (line-delimited: a statewide roads-with-residential geojson can
 *      exceed V8's ~512MB max string length, so the FeatureCollection
 *      format cannot even be read; geojsonseq streams line by line)
 *   3. Stream the features; for each requested metro in this state, filter
 *      by bbox and write <slug>-roads.json.gz.
 *
 * The intermediate *-v2* files are versioned because pre-2026-08 runs left
 * tertiary-and-up extracts (<state>-roads.geojson) in /tmp/geofabrik_pbf;
 * reusing those would silently drop residential/unclassified/oneway.
 *
 * Signals extraction is OPT-IN via --signals: the shipped `<slug>-signals.json`
 * files key AADT tuples by id (append-only invariant, cf. PR #82), so a road
 * refetch must not rewrite them as a side effect.
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-from-geofabrik-pbf.ts charlotte_metro
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-from-geofabrik-pbf.ts \
 *     --out-dir /tmp/roads_out georgia_statewide          # validation runs
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-from-geofabrik-pbf.ts \
 *     --signals savannah_metro                            # also rewrite signals
 */

import { execSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS, type RegionCode } from "../../artifacts/tis-api-server/src/lib/regions";
import { gzipJson } from "./road-file-io";

const PBF_DIR = "/tmp/geofabrik_pbf";

// Which metros pull from which state PBFs. Single primary state per metro:
// processState() WRITES the metro's file, so listing a metro under two
// states would make whichever state runs last overwrite the other's slice.
// For metros that straddle a state line (Charlotte NC/SC, Chattanooga TN/GA,
// Memphis TN/MS/AR, ...) the out-of-state edge of the bbox is therefore
// missing from a Geofabrik fetch — those edges only get full coverage from
// the Overpass path, which queries by bbox not by state.
export const STATES: Record<string, RegionCode[]> = {
  florida: ["jacksonville_metro", "pensacola_metro", "fort_lauderdale_metro", "west_palm_beach_metro", "daytona_beach_metro", "lakeland_metro", "tallahassee_metro", "fort_myers_metro", "sarasota_metro", "florida_statewide", "tampa_metro", "orlando_metro", "miami_dade_metro"],
  georgia: ["atlanta_metro", "savannah_metro", "augusta_metro", "macon_metro", "georgia_statewide"],
  tennessee: ["memphis_metro", "knoxville_metro", "chattanooga_metro", "nashville_metro"],
  "north-carolina": ["asheville_metro", "wilmington_metro", "triad_metro", "fayetteville_metro", "greenville_nc_metro", "charlotte_metro", "raleigh_durham_metro"],
  "south-carolina": ["charleston_sc_metro", "columbia_sc_metro", "greenville_spartanburg_metro", "south_carolina_statewide"],
  alabama: ["birmingham_metro", "mobile_metro", "huntsville_metro"],
  virginia: ["hampton_roads_metro", "richmond_metro", "roanoke_metro", "charlottesville_metro", "washington_dc_metro"],
  kentucky: ["louisville_metro", "lexington_metro"],
  louisiana: ["new_orleans_metro"],
  // ── Tier-4 ──
  "district-of-columbia": ["washington_dc_metro"],
  maryland: ["baltimore_metro", "washington_dc_metro"],
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
  ontario: ["toronto_metro", "ottawa_metro", "hamilton_metro"],
  quebec: ["montreal_metro", "quebec_city_metro"],
  "british-columbia": ["vancouver_metro"],
  alberta: ["calgary_metro", "edmonton_metro"],
  manitoba: ["winnipeg_metro"],
  "nova-scotia": ["halifax_metro"],
  // ── Tier-9: Mexico + UK ──
  mexico: ["mexico_city_metro", "guadalajara_metro", "monterrey_metro", "puebla_metro", "tijuana_metro", "toluca_metro", "leon_metro", "juarez_metro", "queretaro_metro", "merida_metro"],
  "great-britain": ["london_metro", "manchester_uk_metro", "birmingham_uk_metro", "glasgow_metro", "edinburgh_metro", "leeds_metro", "bristol_metro"],
  // ── Tier-10: international country extracts (2026-08-24) — the Overpass-
  // remainder rollout. Keys are Geofabrik extract names; multi-country
  // extracts (gcc-states, malaysia-singapore-brunei, china for Hong Kong)
  // carry every covered metro. All URLs HEAD-validated 200 on 2026-08-24.
  argentina: ["rosario_metro", "buenos_aires_metro", "cordoba_metro"],
  australia: ["brisbane_metro", "adelaide_metro", "sydney_metro", "perth_metro", "melbourne_metro"],
  austria: ["vienna_metro"],
  bangladesh: ["dhaka_metro"],
  belgium: ["brussels_metro", "antwerp_metro"],
  brazil: ["belo_horizonte_metro", "brasilia_metro", "salvador_br_metro", "fortaleza_metro", "sao_paulo_metro", "rio_de_janeiro_metro"],
  bulgaria: ["sofia_metro"],
  chile: ["santiago_cl_metro"],
  china: ["hong_kong_metro"],
  colombia: ["bogota_metro", "medellin_metro"],
  "costa-rica": ["san_jose_cr_metro"],
  croatia: ["zagreb_metro"],
  "czech-republic": ["prague_metro"],
  denmark: ["copenhagen_metro"],
  ecuador: ["quito_metro"],
  egypt: ["cairo_metro"],
  ethiopia: ["addis_ababa_metro"],
  finland: ["helsinki_metro"],
  france: ["lyon_metro", "nice_metro", "nantes_metro", "toulouse_metro", "paris_metro", "strasbourg_metro", "marseille_metro", "bordeaux_metro"],
  "gcc-states": ["dubai_metro", "abu_dhabi_metro", "kuwait_city_metro", "muscat_metro", "doha_metro", "riyadh_metro"],
  germany: ["berlin_metro", "hamburg_metro", "hannover_metro", "munich_metro", "dusseldorf_metro", "frankfurt_metro", "stuttgart_metro", "leipzig_metro", "cologne_metro", "dortmund_metro", "bremen_metro"],
  ghana: ["accra_metro"],
  greece: ["athens_metro"],
  hungary: ["budapest_metro"],
  india: ["bangalore_metro", "kolkata_metro", "mumbai_metro", "ahmedabad_metro", "chennai_metro", "pune_metro", "delhi_metro", "hyderabad_metro"],
  indonesia: ["surabaya_metro", "jakarta_metro"],
  "ireland-and-northern-ireland": ["dublin_metro"],
  "israel-and-palestine": ["tel_aviv_metro"],
  italy: ["florence_metro", "bologna_metro", "milan_metro", "rome_metro", "turin_metro", "palermo_metro", "naples_metro", "genoa_metro"],
  japan: ["fukuoka_metro", "yokohama_metro", "sapporo_metro", "tokyo_metro", "osaka_metro", "nagoya_metro"],
  jordan: ["amman_metro"],
  kazakhstan: ["almaty_metro"],
  kenya: ["nairobi_metro"],
  lebanon: ["beirut_metro"],
  lithuania: ["vilnius_metro"],
  "malaysia-singapore-brunei": ["penang_metro", "kuala_lumpur_metro", "singapore_metro"],
  morocco: ["casablanca_metro"],
  netherlands: ["amsterdam_metro", "rotterdam_metro", "the_hague_metro"],
  "new-zealand": ["auckland_metro", "wellington_metro"],
  nigeria: ["lagos_metro"],
  norway: ["oslo_metro"],
  pakistan: ["karachi_metro"],
  panama: ["panama_city_metro"],
  peru: ["lima_metro"],
  philippines: ["manila_metro"],
  poland: ["warsaw_metro", "krakow_metro", "lodz_metro"],
  portugal: ["porto_metro", "lisbon_metro"],
  romania: ["bucharest_metro"],
  "senegal-and-gambia": ["dakar_metro"],
  serbia: ["belgrade_metro"],
  "south-africa": ["durban_metro", "cape_town_metro", "johannesburg_metro"],
  "south-korea": ["seoul_metro", "busan_metro", "incheon_metro"],
  spain: ["barcelona_metro", "madrid_metro", "zaragoza_metro", "malaga_metro", "seville_metro", "valencia_metro"],
  sweden: ["stockholm_metro"],
  switzerland: ["geneva_metro", "zurich_metro"],
  taiwan: ["kaohsiung_metro", "taipei_metro"],
  tanzania: ["dar_es_salaam_metro"],
  thailand: ["bangkok_metro"],
  tunisia: ["tunis_metro"],
  turkey: ["istanbul_metro", "ankara_metro"],
  ukraine: ["kyiv_metro"],
  uruguay: ["montevideo_metro"],
  uzbekistan: ["tashkent_metro"],
  vietnam: ["hanoi_metro", "ho_chi_minh_metro"],
};

/** Geofabrik download path for a STATES key (relative to download.geofabrik.de). */
export function geofabrikPath(state: string): string {
  const CANADA = new Set(["ontario", "quebec", "british-columbia", "alberta", "manitoba", "nova-scotia"]);
  if (CANADA.has(state)) return `north-america/canada/${state}-latest.osm.pbf`;
  if (state === "mexico") return `north-america/mexico-latest.osm.pbf`;
  if (state === "great-britain") return `europe/great-britain-latest.osm.pbf`;
  const INTL: Record<string, string> = {
    "argentina": "south-america/argentina",
    "australia": "australia-oceania/australia",
    "austria": "europe/austria",
    "bangladesh": "asia/bangladesh",
    "belgium": "europe/belgium",
    "brazil": "south-america/brazil",
    "bulgaria": "europe/bulgaria",
    "chile": "south-america/chile",
    "china": "asia/china",
    "colombia": "south-america/colombia",
    "costa-rica": "central-america/costa-rica",
    "croatia": "europe/croatia",
    "czech-republic": "europe/czech-republic",
    "denmark": "europe/denmark",
    "ecuador": "south-america/ecuador",
    "egypt": "africa/egypt",
    "ethiopia": "africa/ethiopia",
    "finland": "europe/finland",
    "france": "europe/france",
    "gcc-states": "asia/gcc-states",
    "germany": "europe/germany",
    "ghana": "africa/ghana",
    "greece": "europe/greece",
    "hungary": "europe/hungary",
    "india": "asia/india",
    "indonesia": "asia/indonesia",
    "ireland-and-northern-ireland": "europe/ireland-and-northern-ireland",
    "israel-and-palestine": "asia/israel-and-palestine",
    "italy": "europe/italy",
    "japan": "asia/japan",
    "jordan": "asia/jordan",
    "kazakhstan": "asia/kazakhstan",
    "kenya": "africa/kenya",
    "lebanon": "asia/lebanon",
    "lithuania": "europe/lithuania",
    "malaysia-singapore-brunei": "asia/malaysia-singapore-brunei",
    "morocco": "africa/morocco",
    "netherlands": "europe/netherlands",
    "new-zealand": "australia-oceania/new-zealand",
    "nigeria": "africa/nigeria",
    "norway": "europe/norway",
    "pakistan": "asia/pakistan",
    "panama": "central-america/panama",
    "peru": "south-america/peru",
    "philippines": "asia/philippines",
    "poland": "europe/poland",
    "portugal": "europe/portugal",
    "romania": "europe/romania",
    "senegal-and-gambia": "africa/senegal-and-gambia",
    "serbia": "europe/serbia",
    "south-africa": "africa/south-africa",
    "south-korea": "asia/south-korea",
    "spain": "europe/spain",
    "sweden": "europe/sweden",
    "switzerland": "europe/switzerland",
    "taiwan": "asia/taiwan",
    "tanzania": "africa/tanzania",
    "thailand": "asia/thailand",
    "tunisia": "africa/tunisia",
    "turkey": "europe/turkey",
    "ukraine": "europe/ukraine",
    "uruguay": "south-america/uruguay",
    "uzbekistan": "asia/uzbekistan",
    "vietnam": "asia/vietnam",
  };
  const intl = INTL[state];
  if (intl) return `${intl}-latest.osm.pbf`;
  return `north-america/us/${state}-latest.osm.pbf`;
}

// MUST match fetch-osm-roads.ts exactly — array order IS the classCode
// mapping baked into every shipped file. Same-membership is not enough.
const CLASSES = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
  "unclassified",
] as const;
const CLASS_CODE = new Map(CLASSES.map((c, i) => [c, i] as const));

type Bounds = { latMin: number; latMax: number; lonMin: number; lonMax: number };

type GeoJsonFeature = {
  type: "Feature";
  geometry: { type: "Point" | "LineString" | "MultiLineString"; coordinates: number[] | number[][] | number[][][] };
  properties: Record<string, unknown>;
};

/**
 * One-way direction relative to the way's own node order:
 *   1  traffic flows first-node -> last-node
 *  -1  traffic flows last-node -> first-node ("oneway=-1")
 *   0  two-way
 * (Copied from fetch-osm-roads.ts — value parity is load-bearing for the
 * router; "reversible"/"alternating" fall through to 0 there too.)
 */
function parseOneway(raw: string | undefined): number {
  if (!raw) return 0;
  const v = raw.trim().toLowerCase();
  if (v === "yes" || v === "true" || v === "1") return 1;
  if (v === "-1" || v === "reverse") return -1;
  return 0;
}

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

/**
 * Roads extract for one state: tags-filter → geojsonseq. Idempotent (skips
 * existing files). Filenames carry -v2 because pre-2026-08 intermediates in
 * PBF_DIR were tertiary-and-up; reusing them would silently drop the
 * residential/unclassified classes this refetch exists to add.
 */
function extractStateRoads(state: string): string | null {
  const pbf = path.join(PBF_DIR, `${state}.osm.pbf`);
  if (!existsSync(pbf)) {
    console.warn(`  ✗ ${state}: PBF not downloaded (${pbf})`);
    return null;
  }
  const seq = path.join(PBF_DIR, `${state}-roads-v2.geojsonseq`);
  if (existsSync(seq)) {
    console.log(`  (roads geojsonseq already exists for ${state}; skipping extract)`);
    return seq;
  }
  const tmpPbf = path.join(PBF_DIR, `${state}-roads-v2.osm.pbf`);
  if (!existsSync(tmpPbf)) {
    const expr = CLASSES.flatMap((h) => [`w/highway=${h}`, `w/highway=${h}_link`]).join(" ");
    osmium(`tags-filter --overwrite -o "${tmpPbf}" "${pbf}" ${expr}`);
  }
  osmium(`export --overwrite -o "${seq}" -f geojsonseq "${tmpPbf}"`);
  return seq;
}

/** Signals extract for one state (opt-in; see --signals). */
function extractStateSignals(state: string): string | null {
  const pbf = path.join(PBF_DIR, `${state}.osm.pbf`);
  if (!existsSync(pbf)) return null;
  const sgj = path.join(PBF_DIR, `${state}-signals.geojson`);
  if (existsSync(sgj)) {
    console.log(`  (signals geojson already exists for ${state}; skipping extract)`);
    return sgj;
  }
  const sigPbf = path.join(PBF_DIR, `${state}-signals.osm.pbf`);
  if (!existsSync(sigPbf)) {
    osmium(`tags-filter --overwrite -o "${sigPbf}" "${pbf}" n/highway=traffic_signals`);
  }
  osmium(`export --overwrite -o "${sgj}" -f geojson "${sigPbf}"`);
  return sgj;
}

/** Test if a point is inside a bbox. */
function inBbox(lat: number, lon: number, b: Bounds): boolean {
  return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
}

/** Test if a LineString intersects a bbox (cheap envelope test). */
function lineIntersectsBbox(coords: number[][], b: Bounds): boolean {
  let lineLatMin = Infinity, lineLatMax = -Infinity, lineLonMin = Infinity, lineLonMax = -Infinity;
  for (const [lon, lat] of coords) {
    if (lat! < lineLatMin) lineLatMin = lat!;
    if (lat! > lineLatMax) lineLatMax = lat!;
    if (lon! < lineLonMin) lineLonMin = lon!;
    if (lon! > lineLonMax) lineLonMax = lon!;
  }
  return !(lineLatMax < b.latMin || lineLatMin > b.latMax || lineLonMax < b.lonMin || lineLonMin > b.lonMax);
}

/**
 * Stream features from an osmium geojsonseq file (RFC 8142: one feature per
 * line, each prefixed with RS \x1e). Statewide roads-with-residential output
 * runs to multiple GB — past V8's max string length — so whole-file parsing
 * is not an option, and neither is the FeatureCollection format.
 */
async function* streamFeatures(filePath: string): AsyncGenerator<GeoJsonFeature> {
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    const l = (line.charCodeAt(0) === 0x1e ? line.slice(1) : line).trim();
    if (!l) continue;
    try {
      const f = JSON.parse(l) as GeoJsonFeature;
      if (f.type === "Feature") yield f;
    } catch { /* skip malformed line */ }
  }
}

/** Parse a whole (small) geojson file — signals only, a few MB per state. */
function readFeatures(filePath: string): GeoJsonFeature[] {
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
    } catch { /* skip */ }
  }
  return out;
}

function regionSlug(code: RegionCode): string {
  return code.replace(/_metro$/, "").replace(/_/g, "-");
}

type MetroAcc = {
  code: RegionCode;
  slug: string;
  bounds: Bounds;
  /** Per-way tuples pre-serialized: keeps peak memory ≈ output size instead
   *  of a full object graph (statewide ways run to hundreds of MB). */
  parts: string[];
  byClass: Record<string, number>;
};

/** Run the roads pipeline for one state: extract → stream-split per metro → write .json.gz. */
async function processStateRoads(state: string, metros: RegionCode[], outDir: string): Promise<void> {
  console.log(`\n=== ${state} → metros: ${metros.join(", ")} ===`);
  const seq = extractStateRoads(state);
  if (!seq) return;

  const accs: MetroAcc[] = [];
  for (const metro of metros) {
    const region = REGIONS[metro];
    if (!region) { console.warn(`  ✗ unknown region ${metro}`); continue; }
    const b = region.bounds;
    if (b.latMin === 0 && b.latMax === 0) { console.warn(`  ✗ ${metro} has placeholder bounds; fill in regions.ts first`); continue; }
    accs.push({ code: metro, slug: regionSlug(metro), bounds: b, parts: [], byClass: {} });
  }
  if (accs.length === 0) return;

  let features = 0;
  for await (const f of streamFeatures(seq)) {
    features++;
    if (features % 500000 === 0) console.log(`  … ${features} features streamed`);
    // Unnamed ways are KEPT (name = null) since the 2026-08-25 Option-A
    // decision: the roads file feeds ROUTING as well as cross-street naming,
    // and unnamed ways are exactly the freeway ramps (unnamed _link ways in
    // every metro) and the residential grid in no-street-name countries
    // (Japan: ~3-5% of residential ways carry a name). All naming consumers
    // guard on typeof way[1] === "string", so null names render nothing.
    const name = (f.properties.name as string | undefined)?.trim() || null;
    const highway = f.properties.highway as string | undefined;
    if (!highway) continue;
    const baseClass = highway.endsWith("_link") ? highway.slice(0, -5) : highway;
    const code = CLASS_CODE.get(baseClass as (typeof CLASSES)[number]);
    if (code === undefined) continue;
    const lanes = parseLanes(f.properties.lanes as string | undefined);
    const maxspeed = parseMaxspeedKmh(f.properties.maxspeed as string | undefined);
    const oneway = parseOneway(f.properties.oneway as string | undefined);

    // Geometry: LineString, or MultiLineString (each part becomes a way tuple).
    // osmium export preserves way node order in coordinates, so `oneway`'s
    // sign stays relative to the emitted polyline order — same convention as
    // the Overpass path.
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
      for (const acc of accs) {
        if (!lineIntersectsBbox(g, acc.bounds)) continue;
        // Round to 5 decimals (~1.1m precision) to save bundle size — same
        // rounding as fetch-osm-roads.ts.
        const polyline = g.map(([lon, lat]) => [
          Math.round((lat as number) * 1e5) / 1e5,
          Math.round((lon as number) * 1e5) / 1e5,
        ]);
        acc.parts.push(JSON.stringify([code, name, polyline, lanes, maxspeed, oneway]));
        acc.byClass[baseClass] = (acc.byClass[baseClass] ?? 0) + 1;
      }
    }
  }
  console.log(`  ${features} road features in ${state} statewide`);

  mkdirSync(outDir, { recursive: true });
  for (const acc of accs) {
    // Assemble the document textually: identical bytes to JSON.stringify of
    // the equivalent object, without materializing the object graph.
    const json = `{"classes":${JSON.stringify([...CLASSES])},"ways":[${acc.parts.join(",")}]}`;
    const roadPath = path.join(outDir, `${acc.slug}-roads.json.gz`);
    writeFileSync(roadPath, gzipJson(json));
    // Same policy as fetch-osm-roads.ts: readers prefer .gz, so a stale raw
    // twin is pure liability (shadow-confuses tooling, risks a >100MB commit).
    const rawTwin = path.join(outDir, `${acc.slug}-roads.json`);
    if (existsSync(rawTwin)) {
      rmSync(rawTwin);
      console.log(`  (removed stale raw twin ${rawTwin})`);
    }
    console.log(`  ✔ ${acc.slug}: ${acc.parts.length} ways (${JSON.stringify(acc.byClass)}) → ${roadPath}`);
  }
}

/** Signals pipeline for one state (opt-in). Same tuple shape as before:
 *  [id, lat, lon, name|null, 2]. */
async function processStateSignals(state: string, metros: RegionCode[], outDir: string): Promise<void> {
  const sgj = extractStateSignals(state);
  if (!sgj) return;
  const signalFeatures = readFeatures(sgj);
  console.log(`  ${signalFeatures.length} signals in ${state} statewide`);
  mkdirSync(outDir, { recursive: true });
  for (const metro of metros) {
    const region = REGIONS[metro];
    if (!region) continue;
    const b = region.bounds;
    const slug = regionSlug(metro);
    const sigOut: Array<[number, number, number, string | null, number]> = [];
    for (const f of signalFeatures) {
      if (f.geometry.type !== "Point") continue;
      const [lon, lat] = f.geometry.coordinates as [number, number];
      if (!inBbox(lat!, lon!, b)) continue;
      const id = parseInt(String((f.properties as { "@id"?: string; id?: number })["@id"] ?? f.properties.id ?? 0), 10) || sigOut.length;
      const name = (f.properties.name as string | undefined) ?? null;
      sigOut.push([id, Math.round(lat! * 1e5) / 1e5, Math.round(lon! * 1e5) / 1e5, name, 2]);
    }
    const sigPath = path.join(outDir, `${slug}-signals.json`);
    writeFileSync(sigPath, JSON.stringify(sigOut));
    console.log(`  ✔ ${slug}: ${sigOut.length} signals → ${sigPath}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantSignals = args.includes("--signals");
  let outDir: string | null = null;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--signals") continue;
    if (a === "--out-dir") {
      outDir = args[++i] ?? null;
      if (!outDir) { console.error("--out-dir requires a directory argument"); process.exit(2); }
      continue;
    }
    if (a.startsWith("--")) { console.error(`Unknown flag: ${a}`); process.exit(2); }
    positional.push(a);
  }
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const resolvedOutDir = outDir
    ? path.resolve(outDir)
    : path.resolve(__dirname, "../../artifacts/api-server/src/data");

  // Metro-code filter. When given, only those metros are written and only
  // their states' PBFs are required — a full-state run would otherwise
  // rebuild every sibling metro's files. With --signals that would break the
  // tuple-id keying their <slug>-aadt.json depends on (append-only
  // invariant, cf. PR #82); running road-only unfiltered is merely slow.
  const wanted = new Set(positional as RegionCode[]);
  const unknownWanted = positional.filter((m) => !Object.values(STATES).some((ms) => ms.includes(m as RegionCode)));
  if (unknownWanted.length > 0) {
    console.error(`Not in the STATES map: ${unknownWanted.join(", ")} — add a state mapping first.`);
    process.exit(2);
  }
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
    console.error(`Download with:`);
    for (const s of missing) {
      console.error(`  curl -L -o ${PBF_DIR}/${s}.osm.pbf https://download.geofabrik.de/${geofabrikPath(s)}`);
    }
    process.exit(1);
  }

  for (const [state, metros] of states) {
    try {
      await processStateRoads(state, metros, resolvedOutDir);
      if (wantSignals) await processStateSignals(state, metros, resolvedOutDir);
    } catch (e) {
      console.error(`✗ ${state}: ${(e as Error).message}`);
    }
  }
}

// Entry guard: STATES/geofabrikPath are exported for tooling (coverage
// audits), and a bare import must not kick off a fetch run.
const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
