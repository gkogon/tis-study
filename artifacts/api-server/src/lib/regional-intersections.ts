/**
 * Minimal per-region intersection inventory loader.
 *
 * Atlanta has rich per-signal enrichment (accidents, calibration, road-network
 * cross-streets, severity scoring) built up over years of data work in
 * atlanta-analysis.ts. For newly-launched regions (Charlotte, Nashville,
 * Tampa, Orlando, Raleigh-Durham, Miami-Dade) we ship only the raw OSM
 * signal inventory and synthesize the rest of the IntersectionSummary
 * shape with safe defaults.
 *
 * What's synthesized:
 *   - id            = "<regionSlug>-<osmId>" (collision-safe across regions)
 *   - name          = the OSM signal's `name` tag, or "Signal #<osmId>" fallback
 *   - zone          = 0.1°-grid bucket as "lat_lon" so the engine can still
 *                     group nearby signals
 *   - roadClass     = "primary" (real classification arrives when the metro
 *                     gets a roads dataset + signal-naming pass)
 *   - totalVolume   = 1200 vph baseline (rough metro arterial — the TIS
 *                     engine's growth/assignment math still works against a
 *                     constant; calibration replaces this per-signal later)
 *   - turningVolume = 0
 *   - inefficiencyScore / avgDelaySeconds = 0
 *   - severity      = "low"
 *
 * This is intentionally a stub. The TIS engine consumes only id/name/zone/
 * lat/lon/totalVolume, so the unused fields exist to satisfy the schema
 * (ListIntersectionsResponse Zod validator) without falsifying analytics.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lruSet } from "./bounded-cache";
import type { IntersectionSummary, Severity } from "./atlanta-analysis";
import { getSignalNamesForRegion } from "./regional-signal-naming";
import { neighborhoodFor } from "./regional-zones";

/** Per-signal AADT record matching scripts/src/fetch-aadt-by-signal.ts output. */
type AadtRecord = {
  aadt: number;
  year: number;
  /** K-factor: peak-hour traffic as a percentage of daily (typically 8-10%). */
  kFactor: number;
  distM: number;
  /**
   * Provenance tag. Short DOT slug aligned with `dataSourceId` in
   * regions.ts (idot / mdot_mi / nysdot / caltrans / fhwa_hpms_2018 /
   * cdot_adt_portal / synthetic_osm_class / mlit_census_r3_2021 / etc.).
   * Not consumed by routing logic — it's an audit trail.
   */
  source: string;
};
type AadtMap = Record<string, AadtRecord>;

const aadtCache = new Map<string, AadtMap>();

/** Load `<slug>-aadt.json` for a region, returning empty map if not built yet. */
function loadAadtForRegion(slug: string): AadtMap {
  const cached = aadtCache.get(slug);
  if (cached) return cached;
  let map: AadtMap = {};
  try {
    const p = findData(`${slug}-aadt.json`);
    map = JSON.parse(readFileSync(p, "utf8")) as AadtMap;
  } catch {
    // No AADT for this region yet — caller falls back to road-class baseline.
  }
  lruSet(aadtCache, slug, map);
  return map;
}

/**
 * Per-road-class hourly volume baseline (vph at signalized intersection).
 * Rough order-of-magnitude defaults derived from HCM/AADT typical ranges —
 * good enough to make TIS LOS/queue math behave sensibly while we don't
 * have real per-signal counts. Real calibration replaces these.
 *
 * Index = OSM class code from the roads file (0..4).
 */
const VOLUME_BY_CLASS: Record<number, number> = {
  0: 2500, // motorway
  1: 2000, // trunk
  2: 1500, // primary
  3: 1000, // secondary
  4: 700,  // tertiary
};
const DEFAULT_VOLUME = 1000;

/** OSM class code → human label for the roadClass field.
 *  Note: the OpenAPI IntersectionSummary.roadClass enum is constrained to
 *  motorway/trunk/primary/secondary/other (no "tertiary"). Class 4 maps to
 *  "other" rather than "tertiary" so the response passes Zod validation
 *  for dense urban grids where signals frequently sit on tertiary OSM
 *  ways (most of the Tier-10 metros). The engine indexes by the numeric
 *  classCode in VOLUME_BY_CLASS, so the relabel doesn't change vph math. */
const CLASS_NAME: Record<number, string> = {
  0: "motorway",
  1: "trunk",
  2: "primary",
  3: "secondary",
  4: "other",
};
const DEFAULT_CLASS_NAME = "primary";

// Same compact tuple format the OSM fetcher writes (see scripts/src/fetch-osm-signals.ts).
type SignalTuple = [number, number, number, string | null, number];

const __dirname = dirname(fileURLToPath(import.meta.url));

function findData(filename: string): string {
  const candidates = [
    resolve(__dirname, `data/${filename}`),
    resolve(__dirname, `../data/${filename}`),
    resolve(process.cwd(), `artifacts/api-server/dist/data/${filename}`),
    resolve(process.cwd(), `artifacts/api-server/src/data/${filename}`),
  ];
  for (const path of candidates) {
    try {
      readFileSync(path, "utf8").length;
      return path;
    } catch {
      // try next
    }
  }
  throw new Error(`Data file not found: ${filename} (looked in: ${candidates.join(", ")})`);
}

const cache = new Map<string, IntersectionSummary[]>();

/** Convert "charlotte_metro" → "charlotte", "raleigh_durham_metro" → "raleigh-durham". */
export function regionCodeToSlug(regionCode: string): string {
  return regionCode.replace(/_metro$/, "").replace(/_/g, "-");
}

/**
 * Region bounds + display name for zone labeling. Duplicates the canonical
 * registry in artifacts/tis-api-server/src/lib/regions.ts because api-server
 * and tis-api-server are independent workspaces and we don't want a runtime
 * cross-package import. Keep these in sync when a new region is added.
 */
type RegionBoundsInfo = {
  displayName: string;
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number };
};
const REGION_INFO: Record<string, RegionBoundsInfo> = {
  // Tier-0
  atlanta_metro: { displayName: "Atlanta MSA", bounds: { latMin: 33.4, latMax: 34.2, lonMin: -84.9, lonMax: -83.9 } },
  charlotte_metro: { displayName: "Charlotte MSA", bounds: { latMin: 34.5, latMax: 35.7, lonMin: -81.4, lonMax: -80.3 } },
  nashville_metro: { displayName: "Nashville MSA", bounds: { latMin: 35.7, latMax: 36.7, lonMin: -87.5, lonMax: -85.9 } },
  tampa_metro: { displayName: "Tampa MSA", bounds: { latMin: 27.5, latMax: 28.7, lonMin: -83.0, lonMax: -82.0 } },
  orlando_metro: { displayName: "Orlando MSA", bounds: { latMin: 28.2, latMax: 29.0, lonMin: -81.7, lonMax: -80.7 } },
  raleigh_durham_metro: { displayName: "Raleigh-Durham CSA", bounds: { latMin: 35.4, latMax: 36.5, lonMin: -79.2, lonMax: -78.0 } },
  miami_dade_metro: { displayName: "Miami-Dade County", bounds: { latMin: 25.1, latMax: 26.0, lonMin: -80.9, lonMax: -80.1 } },
  // Tier-1 (existing state DOTs)
  jacksonville_metro: { displayName: "Jacksonville MSA", bounds: { latMin: 30.0, latMax: 30.9, lonMin: -82.2, lonMax: -81.3 } },
  memphis_metro: { displayName: "Memphis MSA", bounds: { latMin: 34.5, latMax: 35.6, lonMin: -90.5, lonMax: -89.2 } },
  knoxville_metro: { displayName: "Knoxville MSA", bounds: { latMin: 35.5, latMax: 36.5, lonMin: -84.7, lonMax: -83.4 } },
  chattanooga_metro: { displayName: "Chattanooga MSA", bounds: { latMin: 34.7, latMax: 35.4, lonMin: -85.8, lonMax: -84.7 } },
  savannah_metro: { displayName: "Savannah MSA", bounds: { latMin: 31.7, latMax: 32.5, lonMin: -81.6, lonMax: -80.7 } },
  asheville_metro: { displayName: "Asheville MSA", bounds: { latMin: 35.2, latMax: 36.0, lonMin: -83.2, lonMax: -82.1 } },
  wilmington_metro: { displayName: "Wilmington MSA", bounds: { latMin: 33.7, latMax: 34.7, lonMin: -78.4, lonMax: -77.5 } },
  triad_metro: { displayName: "Piedmont Triad CSA", bounds: { latMin: 35.6, latMax: 36.6, lonMin: -80.8, lonMax: -79.4 } },
  // Tier-2 (new state DOTs)
  birmingham_metro: { displayName: "Birmingham MSA", bounds: { latMin: 33.0, latMax: 34.0, lonMin: -87.4, lonMax: -86.0 } },
  hampton_roads_metro: { displayName: "Hampton Roads MSA", bounds: { latMin: 36.5, latMax: 37.6, lonMin: -77.1, lonMax: -75.9 } },
  richmond_metro: { displayName: "Richmond MSA", bounds: { latMin: 37.2, latMax: 38.0, lonMin: -78.1, lonMax: -77.0 } },
  charleston_sc_metro: { displayName: "Charleston (SC) MSA", bounds: { latMin: 32.4, latMax: 33.2, lonMin: -80.4, lonMax: -79.5 } },
  columbia_sc_metro: { displayName: "Columbia (SC) MSA", bounds: { latMin: 33.6, latMax: 34.5, lonMin: -81.5, lonMax: -80.5 } },
  louisville_metro: { displayName: "Louisville MSA", bounds: { latMin: 37.9, latMax: 38.5, lonMin: -86.1, lonMax: -85.3 } },
  new_orleans_metro: { displayName: "New Orleans MSA", bounds: { latMin: 29.6, latMax: 30.6, lonMin: -90.7, lonMax: -89.3 } },
  // Tier-3 (smaller metros).
  lexington_metro: { displayName: "Lexington-Fayette MSA", bounds: { latMin: 37.7, latMax: 38.3, lonMin: -84.9, lonMax: -84.1 } },
  mobile_metro: { displayName: "Mobile MSA", bounds: { latMin: 30.2, latMax: 31.2, lonMin: -88.5, lonMax: -87.7 } },
  huntsville_metro: { displayName: "Huntsville MSA", bounds: { latMin: 34.4, latMax: 35.1, lonMin: -87.0, lonMax: -86.2 } },
  pensacola_metro: { displayName: "Pensacola MSA", bounds: { latMin: 30.3, latMax: 31.0, lonMin: -87.7, lonMax: -86.7 } },
  fayetteville_metro: { displayName: "Fayetteville (NC) MSA", bounds: { latMin: 34.7, latMax: 35.6, lonMin: -79.5, lonMax: -78.6 } },
  greenville_nc_metro: { displayName: "Greenville (NC) MSA", bounds: { latMin: 35.4, latMax: 35.9, lonMin: -77.6, lonMax: -77.0 } },
  augusta_metro: { displayName: "Augusta MSA", bounds: { latMin: 33.2, latMax: 33.8, lonMin: -82.4, lonMax: -81.7 } },
  macon_metro: { displayName: "Macon-Bibb MSA", bounds: { latMin: 32.4, latMax: 33.1, lonMin: -83.9, lonMax: -83.2 } },
  // Tier-4 (Coast + Midwest + Westward).
  washington_dc_metro: { displayName: "Washington-Arlington-Alexandria MSA", bounds: { latMin: 38.6, latMax: 39.2, lonMin: -77.6, lonMax: -76.7 } },
  baltimore_metro: { displayName: "Baltimore-Columbia-Towson MSA", bounds: { latMin: 39.0, latMax: 39.7, lonMin: -77.0, lonMax: -76.2 } },
  philadelphia_metro: { displayName: "Philadelphia MSA", bounds: { latMin: 39.7, latMax: 40.4, lonMin: -75.5, lonMax: -74.95 } },
  pittsburgh_metro: { displayName: "Pittsburgh MSA", bounds: { latMin: 40.2, latMax: 40.7, lonMin: -80.4, lonMax: -79.6 } },
  new_york_metro: { displayName: "New York-Newark-Jersey City MSA", bounds: { latMin: 40.2, latMax: 41.2, lonMin: -74.5, lonMax: -73.4 } },
  boston_metro: { displayName: "Boston-Cambridge-Newton MSA", bounds: { latMin: 42.1, latMax: 42.7, lonMin: -71.5, lonMax: -70.7 } },
  chicago_metro: { displayName: "Chicago-Naperville-Elgin MSA", bounds: { latMin: 41.4, latMax: 42.3, lonMin: -88.5, lonMax: -87.3 } },
  detroit_metro: { displayName: "Detroit-Warren-Dearborn MSA", bounds: { latMin: 42.0, latMax: 42.8, lonMin: -83.7, lonMax: -82.6 } },
  twin_cities_metro: { displayName: "Minneapolis-St. Paul-Bloomington MSA", bounds: { latMin: 44.6, latMax: 45.4, lonMin: -93.8, lonMax: -92.7 } },
  cleveland_metro: { displayName: "Cleveland-Elyria MSA", bounds: { latMin: 41.2, latMax: 41.8, lonMin: -82.1, lonMax: -81.3 } },
  columbus_oh_metro: { displayName: "Columbus (OH) MSA", bounds: { latMin: 39.7, latMax: 40.3, lonMin: -83.3, lonMax: -82.5 } },
  cincinnati_metro: { displayName: "Cincinnati MSA", bounds: { latMin: 38.9, latMax: 39.4, lonMin: -85.0, lonMax: -84.0 } },
  indianapolis_metro: { displayName: "Indianapolis-Carmel-Anderson MSA", bounds: { latMin: 39.5, latMax: 40.1, lonMin: -86.6, lonMax: -85.7 } },
  st_louis_metro: { displayName: "St. Louis MSA", bounds: { latMin: 38.4, latMax: 39.0, lonMin: -90.7, lonMax: -89.9 } },
  kansas_city_metro: { displayName: "Kansas City MSA", bounds: { latMin: 38.8, latMax: 39.4, lonMin: -94.9, lonMax: -94.2 } },
  milwaukee_metro: { displayName: "Milwaukee-Waukesha MSA", bounds: { latMin: 42.8, latMax: 43.4, lonMin: -88.3, lonMax: -87.7 } },
  houston_metro: { displayName: "Houston-The Woodlands-Sugar Land MSA", bounds: { latMin: 29.3, latMax: 30.3, lonMin: -95.9, lonMax: -94.8 } },
  dallas_fort_worth_metro: { displayName: "Dallas-Fort Worth-Arlington MSA", bounds: { latMin: 32.4, latMax: 33.4, lonMin: -97.6, lonMax: -96.4 } },
  austin_metro: { displayName: "Austin-Round Rock-Georgetown MSA", bounds: { latMin: 30.0, latMax: 30.7, lonMin: -98.1, lonMax: -97.3 } },
  san_antonio_metro: { displayName: "San Antonio-New Braunfels MSA", bounds: { latMin: 29.2, latMax: 29.8, lonMin: -98.8, lonMax: -98.2 } },
  // ── Tier-5: West Coast + Mountain West ──
  los_angeles_metro: { displayName: "Los Angeles-Long Beach-Anaheim MSA", bounds: { latMin: 33.4, latMax: 34.5, lonMin: -118.95, lonMax: -117.7 } },
  sf_bay_metro: { displayName: "San Francisco-Oakland-San Jose CSA", bounds: { latMin: 37.2, latMax: 38.1, lonMin: -122.6, lonMax: -121.6 } },
  san_diego_metro: { displayName: "San Diego-Chula Vista-Carlsbad MSA", bounds: { latMin: 32.54, latMax: 33.5, lonMin: -117.6, lonMax: -116.6 } },
  sacramento_metro: { displayName: "Sacramento-Roseville-Folsom MSA", bounds: { latMin: 38.3, latMax: 39.0, lonMin: -121.8, lonMax: -120.9 } },
  inland_empire_metro: { displayName: "Riverside-San Bernardino-Ontario MSA", bounds: { latMin: 33.4, latMax: 34.5, lonMin: -117.7, lonMax: -116.0 } },
  fresno_metro: { displayName: "Fresno MSA", bounds: { latMin: 36.5, latMax: 37.1, lonMin: -120.0, lonMax: -119.2 } },
  portland_metro: { displayName: "Portland-Vancouver-Hillsboro MSA", bounds: { latMin: 45.2, latMax: 45.8, lonMin: -123.1, lonMax: -122.3 } },
  seattle_metro: { displayName: "Seattle-Tacoma-Bellevue MSA", bounds: { latMin: 47.35, latMax: 47.9, lonMin: -122.6, lonMax: -121.8 } },
  las_vegas_metro: { displayName: "Las Vegas-Henderson-Paradise MSA", bounds: { latMin: 35.9, latMax: 36.4, lonMin: -115.5, lonMax: -114.9 } },
  phoenix_metro: { displayName: "Phoenix-Mesa-Chandler MSA", bounds: { latMin: 33.2, latMax: 33.9, lonMin: -112.6, lonMax: -111.5 } },
  tucson_metro: { displayName: "Tucson MSA", bounds: { latMin: 31.9, latMax: 32.5, lonMin: -111.2, lonMax: -110.6 } },
  denver_metro: { displayName: "Denver-Aurora-Centennial MSA", bounds: { latMin: 39.4, latMax: 40.0, lonMin: -105.4, lonMax: -104.6 } },
  salt_lake_city_metro: { displayName: "Salt Lake City-West Valley City-Murray MSA", bounds: { latMin: 40.4, latMax: 41.0, lonMin: -112.2, lonMax: -111.6 } },
  albuquerque_metro: { displayName: "Albuquerque MSA", bounds: { latMin: 34.9, latMax: 35.4, lonMin: -107.0, lonMax: -106.3 } },
  // ── Tier-6: 50-state coverage ──
  hartford_metro: { displayName: "Hartford-East Hartford-Middletown MSA", bounds: { latMin: 41.6, latMax: 42.0, lonMin: -73.0, lonMax: -72.5 } },
  providence_metro: { displayName: "Providence-Warwick MSA", bounds: { latMin: 41.6, latMax: 42.0, lonMin: -71.7, lonMax: -71.1 } },
  manchester_metro: { displayName: "Manchester-Nashua MSA", bounds: { latMin: 42.7, latMax: 43.2, lonMin: -71.7, lonMax: -71.3 } },
  burlington_vt_metro: { displayName: "Burlington-South Burlington MSA", bounds: { latMin: 44.3, latMax: 44.6, lonMin: -73.4, lonMax: -73.1 } },
  portland_me_metro: { displayName: "Portland-South Portland MSA", bounds: { latMin: 43.5, latMax: 43.9, lonMin: -70.5, lonMax: -70.0 } },
  trenton_metro: { displayName: "Trenton-Princeton MSA", bounds: { latMin: 40.1, latMax: 40.5, lonMin: -74.9, lonMax: -74.5 } },
  charleston_wv_metro: { displayName: "Charleston (WV) MSA", bounds: { latMin: 38.2, latMax: 38.5, lonMin: -81.8, lonMax: -81.4 } },
  jackson_ms_metro: { displayName: "Jackson (MS) MSA", bounds: { latMin: 32.1, latMax: 32.5, lonMin: -90.4, lonMax: -89.9 } },
  little_rock_metro: { displayName: "Little Rock-North Little Rock-Conway MSA", bounds: { latMin: 34.5, latMax: 35.0, lonMin: -92.6, lonMax: -92.0 } },
  oklahoma_city_metro: { displayName: "Oklahoma City MSA", bounds: { latMin: 35.2, latMax: 35.7, lonMin: -97.8, lonMax: -97.2 } },
  tulsa_metro: { displayName: "Tulsa MSA", bounds: { latMin: 35.9, latMax: 36.3, lonMin: -96.2, lonMax: -95.7 } },
  des_moines_metro: { displayName: "Des Moines-West Des Moines MSA", bounds: { latMin: 41.4, latMax: 41.8, lonMin: -94.0, lonMax: -93.4 } },
  omaha_metro: { displayName: "Omaha-Council Bluffs MSA", bounds: { latMin: 41.0, latMax: 41.5, lonMin: -96.3, lonMax: -95.7 } },
  wichita_metro: { displayName: "Wichita MSA", bounds: { latMin: 37.5, latMax: 37.9, lonMin: -97.6, lonMax: -97.0 } },
  fargo_metro: { displayName: "Fargo MSA", bounds: { latMin: 46.7, latMax: 47.1, lonMin: -97.1, lonMax: -96.7 } },
  sioux_falls_metro: { displayName: "Sioux Falls MSA", bounds: { latMin: 43.4, latMax: 43.7, lonMin: -96.9, lonMax: -96.5 } },
  boise_metro: { displayName: "Boise City MSA", bounds: { latMin: 43.4, latMax: 43.8, lonMin: -116.5, lonMax: -115.9 } },
  billings_metro: { displayName: "Billings MT MSA", bounds: { latMin: 45.6, latMax: 45.9, lonMin: -108.7, lonMax: -108.3 } },
  cheyenne_metro: { displayName: "Cheyenne MSA", bounds: { latMin: 41.0, latMax: 41.3, lonMin: -104.9, lonMax: -104.7 } },
  anchorage_metro: { displayName: "Anchorage Municipality", bounds: { latMin: 61.1, latMax: 61.3, lonMin: -150.0, lonMax: -149.5 } },
  honolulu_metro: { displayName: "Urban Honolulu MSA", bounds: { latMin: 21.2, latMax: 21.5, lonMin: -158.0, lonMax: -157.7 } },
  // ── Tier-8: Canada (10 metros) ──
  toronto_metro: { displayName: "Toronto CMA", bounds: { latMin: 43.5, latMax: 44.0, lonMin: -79.7, lonMax: -79.0 } },
  montreal_metro: { displayName: "Montréal CMM", bounds: { latMin: 45.4, latMax: 45.7, lonMin: -73.8, lonMax: -73.4 } },
  vancouver_metro: { displayName: "Metro Vancouver Regional District", bounds: { latMin: 49.1, latMax: 49.4, lonMin: -123.3, lonMax: -122.5 } },
  calgary_metro: { displayName: "Calgary CMA", bounds: { latMin: 50.8, latMax: 51.2, lonMin: -114.3, lonMax: -113.8 } },
  ottawa_metro: { displayName: "Ottawa CMA", bounds: { latMin: 45.2, latMax: 45.5, lonMin: -76.0, lonMax: -75.4 } },
  edmonton_metro: { displayName: "Edmonton CMA", bounds: { latMin: 53.4, latMax: 53.7, lonMin: -113.7, lonMax: -113.3 } },
  winnipeg_metro: { displayName: "Winnipeg CMA", bounds: { latMin: 49.7, latMax: 50.0, lonMin: -97.3, lonMax: -96.9 } },
  quebec_city_metro: { displayName: "Québec CMA", bounds: { latMin: 46.7, latMax: 47.0, lonMin: -71.4, lonMax: -71.1 } },
  hamilton_metro: { displayName: "Hamilton CMA", bounds: { latMin: 43.1, latMax: 43.4, lonMin: -80.0, lonMax: -79.7 } },
  halifax_metro: { displayName: "Halifax CMA", bounds: { latMin: 44.5, latMax: 44.8, lonMin: -63.8, lonMax: -63.4 } },
  // ── Tier-9: Mexico (10) ──
  mexico_city_metro: { displayName: "Ciudad de México (ZMVM)", bounds: { latMin: 19.2, latMax: 19.6, lonMin: -99.3, lonMax: -98.9 } },
  guadalajara_metro: { displayName: "Guadalajara ZM", bounds: { latMin: 20.5, latMax: 20.8, lonMin: -103.5, lonMax: -103.2 } },
  monterrey_metro: { displayName: "Monterrey ZM", bounds: { latMin: 25.5, latMax: 25.9, lonMin: -100.5, lonMax: -100.1 } },
  puebla_metro: { displayName: "Puebla-Tlaxcala ZM", bounds: { latMin: 18.9, latMax: 19.2, lonMin: -98.3, lonMax: -98.0 } },
  tijuana_metro: { displayName: "Tijuana ZM", bounds: { latMin: 32.4, latMax: 32.53, lonMin: -117.1, lonMax: -116.8 } },
  toluca_metro: { displayName: "Toluca ZM", bounds: { latMin: 19.2, latMax: 19.4, lonMin: -99.8, lonMax: -99.5 } },
  leon_metro: { displayName: "León ZM", bounds: { latMin: 21.0, latMax: 21.2, lonMin: -101.8, lonMax: -101.5 } },
  juarez_metro: { displayName: "Ciudad Juárez ZM", bounds: { latMin: 31.5, latMax: 31.75, lonMin: -106.6, lonMax: -106.3 } },
  queretaro_metro: { displayName: "Querétaro ZM", bounds: { latMin: 20.5, latMax: 20.7, lonMin: -100.5, lonMax: -100.3 } },
  merida_metro: { displayName: "Mérida ZM", bounds: { latMin: 20.9, latMax: 21.1, lonMin: -89.7, lonMax: -89.5 } },
  // ── Tier-9: UK (7) ──
  london_metro: { displayName: "Greater London", bounds: { latMin: 51.28, latMax: 51.69, lonMin: -0.51, lonMax: 0.33 } },
  manchester_uk_metro: { displayName: "Greater Manchester", bounds: { latMin: 53.35, latMax: 53.60, lonMin: -2.42, lonMax: -2.05 } },
  birmingham_uk_metro: { displayName: "West Midlands (Birmingham)", bounds: { latMin: 52.40, latMax: 52.58, lonMin: -2.02, lonMax: -1.70 } },
  glasgow_metro: { displayName: "Glasgow City Region", bounds: { latMin: 55.78, latMax: 55.95, lonMin: -4.42, lonMax: -4.10 } },
  edinburgh_metro: { displayName: "Edinburgh + Lothians", bounds: { latMin: 55.88, latMax: 56.00, lonMin: -3.40, lonMax: -3.00 } },
  leeds_metro: { displayName: "West Yorkshire (Leeds-Bradford)", bounds: { latMin: 53.70, latMax: 53.90, lonMin: -1.72, lonMax: -1.40 } },
  bristol_metro: { displayName: "Bristol (West of England)", bounds: { latMin: 51.40, latMax: 51.55, lonMin: -2.70, lonMax: -2.40 } },
  // ── Tier-7: depth push (55 secondary metros) ──
  rochester_ny_metro: { displayName: "Rochester (NY) MSA", bounds: { latMin: 43.0, latMax: 43.3, lonMin: -78.0, lonMax: -77.4 } },
  buffalo_metro: { displayName: "Buffalo-Cheektowaga-Niagara Falls MSA", bounds: { latMin: 42.7, latMax: 43.1, lonMin: -79.0, lonMax: -78.5 } },
  syracuse_metro: { displayName: "Syracuse MSA", bounds: { latMin: 42.9, latMax: 43.2, lonMin: -76.3, lonMax: -75.9 } },
  albany_metro: { displayName: "Albany-Schenectady-Troy MSA", bounds: { latMin: 42.5, latMax: 42.9, lonMin: -74.0, lonMax: -73.6 } },
  toledo_metro: { displayName: "Toledo MSA", bounds: { latMin: 41.5, latMax: 41.8, lonMin: -84.0, lonMax: -83.4 } },
  akron_metro: { displayName: "Akron MSA", bounds: { latMin: 41.0, latMax: 41.2, lonMin: -81.7, lonMax: -81.3 } },
  dayton_metro: { displayName: "Dayton-Kettering MSA", bounds: { latMin: 39.6, latMax: 40.0, lonMin: -84.3, lonMax: -83.9 } },
  youngstown_metro: { displayName: "Youngstown-Warren-Boardman MSA", bounds: { latMin: 41.0, latMax: 41.3, lonMin: -80.9, lonMax: -80.5 } },
  grand_rapids_metro: { displayName: "Grand Rapids-Kentwood MSA", bounds: { latMin: 42.8, latMax: 43.1, lonMin: -85.9, lonMax: -85.4 } },
  lansing_metro: { displayName: "Lansing-East Lansing MSA", bounds: { latMin: 42.6, latMax: 42.9, lonMin: -84.7, lonMax: -84.3 } },
  ann_arbor_metro: { displayName: "Ann Arbor MSA", bounds: { latMin: 42.2, latMax: 42.4, lonMin: -83.9, lonMax: -83.6 } },
  flint_metro: { displayName: "Flint MSA", bounds: { latMin: 42.9, latMax: 43.2, lonMin: -83.9, lonMax: -83.5 } },
  allentown_metro: { displayName: "Allentown-Bethlehem-Easton MSA", bounds: { latMin: 40.5, latMax: 40.8, lonMin: -75.7, lonMax: -75.2 } },
  harrisburg_metro: { displayName: "Harrisburg-Carlisle MSA", bounds: { latMin: 40.1, latMax: 40.4, lonMin: -77.0, lonMax: -76.6 } },
  scranton_metro: { displayName: "Scranton-Wilkes-Barre MSA", bounds: { latMin: 41.3, latMax: 41.6, lonMin: -75.9, lonMax: -75.4 } },
  erie_metro: { displayName: "Erie MSA", bounds: { latMin: 42.0, latMax: 42.2, lonMin: -80.3, lonMax: -79.9 } },
  worcester_metro: { displayName: "Worcester MSA", bounds: { latMin: 42.1, latMax: 42.5, lonMin: -72.0, lonMax: -71.6 } },
  springfield_ma_metro: { displayName: "Springfield (MA) MSA", bounds: { latMin: 42.0, latMax: 42.2, lonMin: -72.8, lonMax: -72.4 } },
  new_haven_metro: { displayName: "New Haven-Milford MSA", bounds: { latMin: 41.2, latMax: 41.4, lonMin: -73.1, lonMax: -72.8 } },
  bridgeport_metro: { displayName: "Bridgeport-Stamford-Norwalk MSA", bounds: { latMin: 41.0, latMax: 41.3, lonMin: -73.6, lonMax: -73.0 } },
  fort_wayne_metro: { displayName: "Fort Wayne MSA", bounds: { latMin: 40.9, latMax: 41.2, lonMin: -85.4, lonMax: -85.0 } },
  south_bend_metro: { displayName: "South Bend-Mishawaka MSA", bounds: { latMin: 41.5, latMax: 41.8, lonMin: -86.4, lonMax: -86.0 } },
  evansville_metro: { displayName: "Evansville MSA", bounds: { latMin: 37.8, latMax: 38.2, lonMin: -87.8, lonMax: -87.3 } },
  madison_metro: { displayName: "Madison MSA", bounds: { latMin: 43.0, latMax: 43.2, lonMin: -89.6, lonMax: -89.2 } },
  green_bay_metro: { displayName: "Green Bay MSA", bounds: { latMin: 44.4, latMax: 44.6, lonMin: -88.2, lonMax: -87.8 } },
  springfield_il_metro: { displayName: "Springfield (IL) MSA", bounds: { latMin: 39.6, latMax: 39.9, lonMin: -89.8, lonMax: -89.5 } },
  rockford_metro: { displayName: "Rockford MSA", bounds: { latMin: 42.1, latMax: 42.4, lonMin: -89.2, lonMax: -88.8 } },
  peoria_metro: { displayName: "Peoria MSA", bounds: { latMin: 40.5, latMax: 40.9, lonMin: -89.8, lonMax: -89.3 } },
  champaign_metro: { displayName: "Champaign-Urbana MSA", bounds: { latMin: 40.0, latMax: 40.2, lonMin: -88.4, lonMax: -88.1 } },
  el_paso_metro: { displayName: "El Paso MSA", bounds: { latMin: 31.75, latMax: 31.95, lonMin: -106.6, lonMax: -106.2 } },
  corpus_christi_metro: { displayName: "Corpus Christi MSA", bounds: { latMin: 27.6, latMax: 28.0, lonMin: -97.6, lonMax: -97.2 } },
  lubbock_metro: { displayName: "Lubbock MSA", bounds: { latMin: 33.4, latMax: 33.7, lonMin: -102.0, lonMax: -101.7 } },
  mcallen_metro: { displayName: "McAllen-Edinburg-Mission MSA", bounds: { latMin: 26.0, latMax: 26.4, lonMin: -98.4, lonMax: -97.9 } },
  bakersfield_metro: { displayName: "Bakersfield MSA", bounds: { latMin: 35.2, latMax: 35.5, lonMin: -119.2, lonMax: -118.9 } },
  stockton_metro: { displayName: "Stockton-Lodi MSA", bounds: { latMin: 37.8, latMax: 38.2, lonMin: -121.5, lonMax: -121.1 } },
  modesto_metro: { displayName: "Modesto MSA", bounds: { latMin: 37.5, latMax: 37.8, lonMin: -121.2, lonMax: -120.8 } },
  oxnard_metro: { displayName: "Oxnard-Thousand Oaks-Ventura MSA", bounds: { latMin: 34.1, latMax: 34.5, lonMin: -119.5, lonMax: -118.7 } },
  colorado_springs_metro: { displayName: "Colorado Springs MSA", bounds: { latMin: 38.7, latMax: 39.0, lonMin: -104.9, lonMax: -104.6 } },
  fort_collins_metro: { displayName: "Fort Collins MSA", bounds: { latMin: 40.4, latMax: 40.7, lonMin: -105.2, lonMax: -104.9 } },
  reno_metro: { displayName: "Reno-Sparks MSA", bounds: { latMin: 39.4, latMax: 39.7, lonMin: -119.9, lonMax: -119.6 } },
  spokane_metro: { displayName: "Spokane-Spokane Valley MSA", bounds: { latMin: 47.5, latMax: 47.8, lonMin: -117.6, lonMax: -117.2 } },
  tacoma_metro: { displayName: "Tacoma-Pierce County", bounds: { latMin: 47.0, latMax: 47.4, lonMin: -122.7, lonMax: -122.2 } },
  eugene_metro: { displayName: "Eugene-Springfield MSA", bounds: { latMin: 43.9, latMax: 44.2, lonMin: -123.3, lonMax: -122.9 } },
  salem_or_metro: { displayName: "Salem (OR) MSA", bounds: { latMin: 44.8, latMax: 45.1, lonMin: -123.2, lonMax: -122.8 } },
  provo_metro: { displayName: "Provo-Orem MSA", bounds: { latMin: 40.1, latMax: 40.4, lonMin: -111.8, lonMax: -111.5 } },
  ogden_metro: { displayName: "Ogden-Clearfield MSA", bounds: { latMin: 41.1, latMax: 41.4, lonMin: -112.2, lonMax: -111.8 } },
  rochester_mn_metro: { displayName: "Rochester (MN) MSA", bounds: { latMin: 43.9, latMax: 44.2, lonMin: -92.6, lonMax: -92.3 } },
  duluth_metro: { displayName: "Duluth MSA", bounds: { latMin: 46.6, latMax: 46.9, lonMin: -92.3, lonMax: -92.0 } },
  fort_lauderdale_metro: { displayName: "Fort Lauderdale (Broward County)", bounds: { latMin: 26.0, latMax: 26.4, lonMin: -80.4, lonMax: -80.0 } },
  west_palm_beach_metro: { displayName: "West Palm Beach (Palm Beach County)", bounds: { latMin: 26.4, latMax: 26.9, lonMin: -80.4, lonMax: -80.0 } },
  daytona_beach_metro: { displayName: "Deltona-Daytona Beach-Ormond Beach MSA", bounds: { latMin: 29.0, latMax: 29.4, lonMin: -81.3, lonMax: -80.9 } },
  lakeland_metro: { displayName: "Lakeland-Winter Haven MSA", bounds: { latMin: 27.9, latMax: 28.2, lonMin: -82.1, lonMax: -81.7 } },
  tallahassee_metro: { displayName: "Tallahassee MSA", bounds: { latMin: 30.2, latMax: 30.7, lonMin: -84.5, lonMax: -84.0 } },
  fort_myers_metro: { displayName: "Cape Coral-Fort Myers MSA", bounds: { latMin: 26.4, latMax: 26.8, lonMin: -82.1, lonMax: -81.7 } },
  roanoke_metro: { displayName: "Roanoke MSA", bounds: { latMin: 37.1, latMax: 37.4, lonMin: -80.1, lonMax: -79.7 } },
  charlottesville_metro: { displayName: "Charlottesville MSA", bounds: { latMin: 37.9, latMax: 38.2, lonMin: -78.6, lonMax: -78.3 } },
  springfield_mo_metro: { displayName: "Springfield (MO) MSA", bounds: { latMin: 37.0, latMax: 37.3, lonMin: -93.4, lonMax: -93.1 } },
  columbia_mo_metro: { displayName: "Columbia (MO) MSA", bounds: { latMin: 38.8, latMax: 39.1, lonMin: -92.5, lonMax: -92.1 } },
  cedar_rapids_metro: { displayName: "Cedar Rapids MSA", bounds: { latMin: 41.9, latMax: 42.1, lonMin: -91.8, lonMax: -91.5 } },
  // ── Tier-10: global expansion (OSM signals + roads, no DOT AADT) ──
  // Europe (50)
  berlin_metro: { displayName: "Berlin", bounds: { latMin: 52.34, latMax: 52.68, lonMin: 13.08, lonMax: 13.76 } },
  hamburg_metro: { displayName: "Hamburg", bounds: { latMin: 53.39, latMax: 53.74, lonMin: 9.73, lonMax: 10.32 } },
  munich_metro: { displayName: "München (Munich)", bounds: { latMin: 48.06, latMax: 48.25, lonMin: 11.36, lonMax: 11.72 } },
  cologne_metro: { displayName: "Köln (Cologne)", bounds: { latMin: 50.83, latMax: 51.08, lonMin: 6.77, lonMax: 7.16 } },
  frankfurt_metro: { displayName: "Frankfurt am Main", bounds: { latMin: 50.02, latMax: 50.22, lonMin: 8.50, lonMax: 8.80 } },
  stuttgart_metro: { displayName: "Stuttgart", bounds: { latMin: 48.69, latMax: 48.87, lonMin: 9.04, lonMax: 9.32 } },
  dusseldorf_metro: { displayName: "Düsseldorf", bounds: { latMin: 51.16, latMax: 51.32, lonMin: 6.69, lonMax: 6.92 } },
  leipzig_metro: { displayName: "Leipzig", bounds: { latMin: 51.27, latMax: 51.42, lonMin: 12.28, lonMax: 12.50 } },
  dortmund_metro: { displayName: "Dortmund", bounds: { latMin: 51.44, latMax: 51.60, lonMin: 7.32, lonMax: 7.62 } },
  bremen_metro: { displayName: "Bremen", bounds: { latMin: 53.00, latMax: 53.21, lonMin: 8.66, lonMax: 8.98 } },
  hannover_metro: { displayName: "Hannover", bounds: { latMin: 52.30, latMax: 52.45, lonMin: 9.65, lonMax: 9.85 } },
  paris_metro: { displayName: "Paris (Île-de-France)", bounds: { latMin: 48.78, latMax: 48.95, lonMin: 2.20, lonMax: 2.50 } },
  marseille_metro: { displayName: "Marseille", bounds: { latMin: 43.20, latMax: 43.40, lonMin: 5.30, lonMax: 5.55 } },
  lyon_metro: { displayName: "Lyon", bounds: { latMin: 45.66, latMax: 45.83, lonMin: 4.74, lonMax: 4.95 } },
  toulouse_metro: { displayName: "Toulouse", bounds: { latMin: 43.51, latMax: 43.69, lonMin: 1.34, lonMax: 1.55 } },
  nice_metro: { displayName: "Nice", bounds: { latMin: 43.65, latMax: 43.78, lonMin: 7.18, lonMax: 7.34 } },
  nantes_metro: { displayName: "Nantes", bounds: { latMin: 47.16, latMax: 47.31, lonMin: -1.65, lonMax: -1.45 } },
  bordeaux_metro: { displayName: "Bordeaux", bounds: { latMin: 44.78, latMax: 44.93, lonMin: -0.66, lonMax: -0.51 } },
  strasbourg_metro: { displayName: "Strasbourg", bounds: { latMin: 48.50, latMax: 48.65, lonMin: 7.66, lonMax: 7.83 } },
  rome_metro: { displayName: "Roma (Rome)", bounds: { latMin: 41.78, latMax: 42.00, lonMin: 12.36, lonMax: 12.62 } },
  milan_metro: { displayName: "Milano (Milan)", bounds: { latMin: 45.39, latMax: 45.55, lonMin: 9.07, lonMax: 9.30 } },
  naples_metro: { displayName: "Napoli (Naples)", bounds: { latMin: 40.78, latMax: 40.92, lonMin: 14.14, lonMax: 14.32 } },
  turin_metro: { displayName: "Torino (Turin)", bounds: { latMin: 45.00, latMax: 45.13, lonMin: 7.59, lonMax: 7.74 } },
  palermo_metro: { displayName: "Palermo", bounds: { latMin: 38.07, latMax: 38.21, lonMin: 13.27, lonMax: 13.46 } },
  bologna_metro: { displayName: "Bologna", bounds: { latMin: 44.42, latMax: 44.55, lonMin: 11.27, lonMax: 11.42 } },
  florence_metro: { displayName: "Firenze (Florence)", bounds: { latMin: 43.74, latMax: 43.84, lonMin: 11.17, lonMax: 11.32 } },
  genoa_metro: { displayName: "Genova (Genoa)", bounds: { latMin: 44.36, latMax: 44.48, lonMin: 8.83, lonMax: 9.04 } },
  madrid_metro: { displayName: "Madrid", bounds: { latMin: 40.32, latMax: 40.55, lonMin: -3.85, lonMax: -3.55 } },
  barcelona_metro: { displayName: "Barcelona", bounds: { latMin: 41.32, latMax: 41.46, lonMin: 2.06, lonMax: 2.25 } },
  valencia_metro: { displayName: "València (Valencia)", bounds: { latMin: 39.40, latMax: 39.55, lonMin: -0.47, lonMax: -0.30 } },
  seville_metro: { displayName: "Sevilla (Seville)", bounds: { latMin: 37.32, latMax: 37.47, lonMin: -6.06, lonMax: -5.86 } },
  zaragoza_metro: { displayName: "Zaragoza", bounds: { latMin: 41.59, latMax: 41.72, lonMin: -0.97, lonMax: -0.79 } },
  malaga_metro: { displayName: "Málaga", bounds: { latMin: 36.65, latMax: 36.78, lonMin: -4.55, lonMax: -4.35 } },
  amsterdam_metro: { displayName: "Amsterdam", bounds: { latMin: 52.30, latMax: 52.43, lonMin: 4.78, lonMax: 4.99 } },
  rotterdam_metro: { displayName: "Rotterdam", bounds: { latMin: 51.86, latMax: 51.98, lonMin: 4.36, lonMax: 4.59 } },
  the_hague_metro: { displayName: "Den Haag (The Hague)", bounds: { latMin: 52.03, latMax: 52.13, lonMin: 4.21, lonMax: 4.40 } },
  brussels_metro: { displayName: "Bruxelles (Brussels)", bounds: { latMin: 50.78, latMax: 50.93, lonMin: 4.27, lonMax: 4.48 } },
  antwerp_metro: { displayName: "Antwerpen (Antwerp)", bounds: { latMin: 51.16, latMax: 51.30, lonMin: 4.32, lonMax: 4.50 } },
  zurich_metro: { displayName: "Zürich (Zurich)", bounds: { latMin: 47.32, latMax: 47.45, lonMin: 8.45, lonMax: 8.62 } },
  geneva_metro: { displayName: "Genève (Geneva)", bounds: { latMin: 46.16, latMax: 46.27, lonMin: 6.07, lonMax: 6.22 } },
  vienna_metro: { displayName: "Wien (Vienna)", bounds: { latMin: 48.13, latMax: 48.32, lonMin: 16.18, lonMax: 16.50 } },
  lisbon_metro: { displayName: "Lisboa (Lisbon)", bounds: { latMin: 38.66, latMax: 38.83, lonMin: -9.27, lonMax: -9.08 } },
  porto_metro: { displayName: "Porto", bounds: { latMin: 41.07, latMax: 41.21, lonMin: -8.72, lonMax: -8.55 } },
  dublin_metro: { displayName: "Dublin", bounds: { latMin: 53.27, latMax: 53.42, lonMin: -6.40, lonMax: -6.10 } },
  warsaw_metro: { displayName: "Warszawa (Warsaw)", bounds: { latMin: 52.13, latMax: 52.35, lonMin: 20.85, lonMax: 21.18 } },
  krakow_metro: { displayName: "Kraków", bounds: { latMin: 50.00, latMax: 50.13, lonMin: 19.83, lonMax: 20.05 } },
  lodz_metro: { displayName: "Łódź", bounds: { latMin: 51.70, latMax: 51.83, lonMin: 19.35, lonMax: 19.55 } },
  prague_metro: { displayName: "Praha (Prague)", bounds: { latMin: 49.97, latMax: 50.16, lonMin: 14.30, lonMax: 14.62 } },
  budapest_metro: { displayName: "Budapest", bounds: { latMin: 47.40, latMax: 47.58, lonMin: 18.95, lonMax: 19.22 } },
  bucharest_metro: { displayName: "București (Bucharest)", bounds: { latMin: 44.36, latMax: 44.55, lonMin: 25.97, lonMax: 26.20 } },
  stockholm_metro: { displayName: "Stockholm", bounds: { latMin: 59.25, latMax: 59.40, lonMin: 17.85, lonMax: 18.18 } },
  oslo_metro: { displayName: "Oslo", bounds: { latMin: 59.83, latMax: 60.00, lonMin: 10.65, lonMax: 10.85 } },
  copenhagen_metro: { displayName: "København (Copenhagen)", bounds: { latMin: 55.60, latMax: 55.75, lonMin: 12.45, lonMax: 12.66 } },
  helsinki_metro: { displayName: "Helsinki", bounds: { latMin: 60.13, latMax: 60.27, lonMin: 24.83, lonMax: 25.15 } },
  athens_metro: { displayName: "Αθήνα (Athens)", bounds: { latMin: 37.92, latMax: 38.05, lonMin: 23.66, lonMax: 23.83 } },
  // Asia (35)
  tokyo_metro: { displayName: "Tokyo (東京)", bounds: { latMin: 35.55, latMax: 35.83, lonMin: 139.55, lonMax: 139.90 } },
  osaka_metro: { displayName: "Osaka (大阪)", bounds: { latMin: 34.55, latMax: 34.78, lonMin: 135.35, lonMax: 135.62 } },
  yokohama_metro: { displayName: "Yokohama (横浜)", bounds: { latMin: 35.32, latMax: 35.55, lonMin: 139.50, lonMax: 139.72 } },
  nagoya_metro: { displayName: "Nagoya (名古屋)", bounds: { latMin: 35.06, latMax: 35.24, lonMin: 136.83, lonMax: 137.05 } },
  sapporo_metro: { displayName: "Sapporo (札幌)", bounds: { latMin: 43.00, latMax: 43.20, lonMin: 141.20, lonMax: 141.50 } },
  fukuoka_metro: { displayName: "Fukuoka (福岡)", bounds: { latMin: 33.50, latMax: 33.70, lonMin: 130.30, lonMax: 130.55 } },
  seoul_metro: { displayName: "Seoul (서울)", bounds: { latMin: 37.40, latMax: 37.70, lonMin: 126.78, lonMax: 127.18 } },
  busan_metro: { displayName: "Busan (부산)", bounds: { latMin: 35.05, latMax: 35.27, lonMin: 128.96, lonMax: 129.22 } },
  incheon_metro: { displayName: "Incheon (인천)", bounds: { latMin: 37.32, latMax: 37.55, lonMin: 126.55, lonMax: 126.78 } },
  mumbai_metro: { displayName: "Mumbai", bounds: { latMin: 18.85, latMax: 19.30, lonMin: 72.75, lonMax: 73.00 } },
  delhi_metro: { displayName: "Delhi (NCT)", bounds: { latMin: 28.40, latMax: 28.83, lonMin: 76.85, lonMax: 77.40 } },
  bangalore_metro: { displayName: "Bengaluru (Bangalore)", bounds: { latMin: 12.85, latMax: 13.13, lonMin: 77.45, lonMax: 77.78 } },
  hyderabad_metro: { displayName: "Hyderabad", bounds: { latMin: 17.28, latMax: 17.55, lonMin: 78.30, lonMax: 78.62 } },
  chennai_metro: { displayName: "Chennai", bounds: { latMin: 12.85, latMax: 13.20, lonMin: 80.13, lonMax: 80.32 } },
  kolkata_metro: { displayName: "Kolkata", bounds: { latMin: 22.45, latMax: 22.70, lonMin: 88.27, lonMax: 88.45 } },
  pune_metro: { displayName: "Pune", bounds: { latMin: 18.40, latMax: 18.62, lonMin: 73.72, lonMax: 74.00 } },
  ahmedabad_metro: { displayName: "Ahmedabad", bounds: { latMin: 22.95, latMax: 23.13, lonMin: 72.45, lonMax: 72.70 } },
  hong_kong_metro: { displayName: "Hong Kong", bounds: { latMin: 22.18, latMax: 22.40, lonMin: 113.95, lonMax: 114.32 } },
  singapore_metro: { displayName: "Singapore", bounds: { latMin: 1.22, latMax: 1.48, lonMin: 103.60, lonMax: 104.05 } },
  taipei_metro: { displayName: "Taipei (台北)", bounds: { latMin: 24.95, latMax: 25.18, lonMin: 121.42, lonMax: 121.65 } },
  kaohsiung_metro: { displayName: "Kaohsiung (高雄)", bounds: { latMin: 22.55, latMax: 22.78, lonMin: 120.20, lonMax: 120.42 } },
  bangkok_metro: { displayName: "Bangkok (กรุงเทพมหานคร)", bounds: { latMin: 13.55, latMax: 14.00, lonMin: 100.32, lonMax: 100.78 } },
  ho_chi_minh_metro: { displayName: "Ho Chi Minh City (TP. Hồ Chí Minh)", bounds: { latMin: 10.65, latMax: 10.90, lonMin: 106.55, lonMax: 106.85 } },
  hanoi_metro: { displayName: "Hanoi (Hà Nội)", bounds: { latMin: 20.95, latMax: 21.13, lonMin: 105.72, lonMax: 105.95 } },
  manila_metro: { displayName: "Manila (Metro Manila)", bounds: { latMin: 14.50, latMax: 14.78, lonMin: 120.92, lonMax: 121.13 } },
  jakarta_metro: { displayName: "Jakarta", bounds: { latMin: -6.40, latMax: -6.05, lonMin: 106.65, lonMax: 107.00 } },
  surabaya_metro: { displayName: "Surabaya", bounds: { latMin: -7.40, latMax: -7.15, lonMin: 112.62, lonMax: 112.85 } },
  kuala_lumpur_metro: { displayName: "Kuala Lumpur", bounds: { latMin: 3.05, latMax: 3.27, lonMin: 101.55, lonMax: 101.82 } },
  penang_metro: { displayName: "Penang (George Town)", bounds: { latMin: 5.27, latMax: 5.50, lonMin: 100.18, lonMax: 100.40 } },
  karachi_metro: { displayName: "Karachi", bounds: { latMin: 24.78, latMax: 25.20, lonMin: 66.90, lonMax: 67.30 } },
  tashkent_metro: { displayName: "Toshkent (Tashkent)", bounds: { latMin: 41.20, latMax: 41.40, lonMin: 69.18, lonMax: 69.42 } },
  // Middle East (8)
  dubai_metro: { displayName: "Dubai", bounds: { latMin: 25.05, latMax: 25.30, lonMin: 55.10, lonMax: 55.50 } },
  abu_dhabi_metro: { displayName: "Abu Dhabi", bounds: { latMin: 24.30, latMax: 24.55, lonMin: 54.27, lonMax: 54.62 } },
  riyadh_metro: { displayName: "Riyadh (الرياض)", bounds: { latMin: 24.55, latMax: 24.85, lonMin: 46.55, lonMax: 46.85 } },
  tel_aviv_metro: { displayName: "Tel Aviv (תל אביב)", bounds: { latMin: 32.00, latMax: 32.20, lonMin: 34.72, lonMax: 34.85 } },
  istanbul_metro: { displayName: "Istanbul (İstanbul)", bounds: { latMin: 40.85, latMax: 41.20, lonMin: 28.65, lonMax: 29.27 } },
  ankara_metro: { displayName: "Ankara", bounds: { latMin: 39.83, latMax: 40.05, lonMin: 32.62, lonMax: 32.92 } },
  doha_metro: { displayName: "Doha (الدوحة)", bounds: { latMin: 25.20, latMax: 25.40, lonMin: 51.45, lonMax: 51.65 } },
  amman_metro: { displayName: "Amman (عمّان)", bounds: { latMin: 31.83, latMax: 32.05, lonMin: 35.78, lonMax: 36.05 } },
  beirut_metro: { displayName: "Beirut (بيروت)", bounds: { latMin: 33.85, latMax: 33.93, lonMin: 35.45, lonMax: 35.58 } },
  // South America (15)
  sao_paulo_metro: { displayName: "São Paulo", bounds: { latMin: -23.78, latMax: -23.40, lonMin: -46.85, lonMax: -46.35 } },
  rio_de_janeiro_metro: { displayName: "Rio de Janeiro", bounds: { latMin: -23.07, latMax: -22.75, lonMin: -43.85, lonMax: -43.10 } },
  brasilia_metro: { displayName: "Brasília", bounds: { latMin: -16.05, latMax: -15.65, lonMin: -48.10, lonMax: -47.75 } },
  salvador_br_metro: { displayName: "Salvador (BA)", bounds: { latMin: -13.05, latMax: -12.85, lonMin: -38.55, lonMax: -38.35 } },
  fortaleza_metro: { displayName: "Fortaleza", bounds: { latMin: -3.85, latMax: -3.65, lonMin: -38.65, lonMax: -38.40 } },
  belo_horizonte_metro: { displayName: "Belo Horizonte", bounds: { latMin: -20.05, latMax: -19.78, lonMin: -44.05, lonMax: -43.83 } },
  buenos_aires_metro: { displayName: "Buenos Aires", bounds: { latMin: -34.72, latMax: -34.45, lonMin: -58.55, lonMax: -58.30 } },
  cordoba_metro: { displayName: "Córdoba (AR)", bounds: { latMin: -31.50, latMax: -31.30, lonMin: -64.30, lonMax: -64.10 } },
  rosario_metro: { displayName: "Rosario", bounds: { latMin: -33.05, latMax: -32.85, lonMin: -60.78, lonMax: -60.55 } },
  santiago_cl_metro: { displayName: "Santiago de Chile", bounds: { latMin: -33.65, latMax: -33.30, lonMin: -70.85, lonMax: -70.45 } },
  bogota_metro: { displayName: "Bogotá", bounds: { latMin: 4.45, latMax: 4.85, lonMin: -74.27, lonMax: -73.95 } },
  medellin_metro: { displayName: "Medellín", bounds: { latMin: 6.13, latMax: 6.35, lonMin: -75.70, lonMax: -75.45 } },
  lima_metro: { displayName: "Lima", bounds: { latMin: -12.20, latMax: -11.85, lonMin: -77.20, lonMax: -76.85 } },
  montevideo_metro: { displayName: "Montevideo", bounds: { latMin: -34.95, latMax: -34.78, lonMin: -56.30, lonMax: -56.05 } },
  quito_metro: { displayName: "Quito", bounds: { latMin: -0.40, latMax: -0.05, lonMin: -78.62, lonMax: -78.40 } },
  // Africa (8)
  johannesburg_metro: { displayName: "Johannesburg", bounds: { latMin: -26.30, latMax: -26.05, lonMin: 27.85, lonMax: 28.20 } },
  cape_town_metro: { displayName: "Cape Town", bounds: { latMin: -34.10, latMax: -33.85, lonMin: 18.35, lonMax: 18.75 } },
  durban_metro: { displayName: "Durban (eThekwini)", bounds: { latMin: -29.95, latMax: -29.72, lonMin: 30.92, lonMax: 31.10 } },
  cairo_metro: { displayName: "Cairo (القاهرة)", bounds: { latMin: 29.92, latMax: 30.20, lonMin: 31.13, lonMax: 31.50 } },
  lagos_metro: { displayName: "Lagos", bounds: { latMin: 6.30, latMax: 6.65, lonMin: 3.20, lonMax: 3.50 } },
  nairobi_metro: { displayName: "Nairobi", bounds: { latMin: -1.40, latMax: -1.15, lonMin: 36.65, lonMax: 36.95 } },
  casablanca_metro: { displayName: "Casablanca (الدار البيضاء)", bounds: { latMin: 33.50, latMax: 33.65, lonMin: -7.72, lonMax: -7.50 } },
  accra_metro: { displayName: "Accra", bounds: { latMin: 5.50, latMax: 5.70, lonMin: -0.30, lonMax: -0.05 } },
  // Oceania (6)
  sydney_metro: { displayName: "Sydney", bounds: { latMin: -33.95, latMax: -33.60, lonMin: 150.85, lonMax: 151.32 } },
  melbourne_metro: { displayName: "Melbourne", bounds: { latMin: -38.05, latMax: -37.65, lonMin: 144.75, lonMax: 145.27 } },
  brisbane_metro: { displayName: "Brisbane", bounds: { latMin: -27.65, latMax: -27.30, lonMin: 152.85, lonMax: 153.20 } },
  perth_metro: { displayName: "Perth", bounds: { latMin: -32.10, latMax: -31.78, lonMin: 115.70, lonMax: 116.05 } },
  adelaide_metro: { displayName: "Adelaide", bounds: { latMin: -35.05, latMax: -34.80, lonMin: 138.45, lonMax: 138.78 } },
  auckland_metro: { displayName: "Auckland", bounds: { latMin: -37.05, latMax: -36.70, lonMin: 174.55, lonMax: 174.95 } },
  wellington_metro: { displayName: "Wellington", bounds: { latMin: -41.35, latMax: -41.18, lonMin: 174.72, lonMax: 174.92 } },
  // Eastern Europe (1) — Russia removed.
  kyiv_metro: { displayName: "Kyiv (Київ)", bounds: { latMin: 50.30, latMax: 50.55, lonMin: 30.30, lonMax: 30.78 } },
  // Central America / Caribbean (3)
  panama_city_metro: { displayName: "Panama City", bounds: { latMin: 8.85, latMax: 9.10, lonMin: -79.65, lonMax: -79.40 } },
  san_jose_cr_metro: { displayName: "San José (CR)", bounds: { latMin: 9.85, latMax: 10.05, lonMin: -84.20, lonMax: -83.95 } },
  havana_metro: { displayName: "La Habana (Havana)", bounds: { latMin: 22.95, latMax: 23.20, lonMin: -82.55, lonMax: -82.27 } },
};

/** Compass-quadrant zone label relative to the region centroid.
 *  Atlanta has hand-curated polygon zones (Buckhead/Sandy Springs/etc).
 *  For new metros we don't have that local-geography work yet, so this
 *  gives at least a human-readable bucket like "NW Charlotte" or "Central
 *  Tampa" without requiring per-metro curation. Hand-curated polygons can
 *  replace this per region as someone with local knowledge gets to it.
 *
 *  - Within `centralRadiusMi` of the centroid → "Central <displayName>"
 *  - Otherwise → one of "NW|NE|SW|SE <displayName>"
 */
const M_PER_DEG_LAT = 111_320;
const MI_PER_M = 1 / 1609.344;
const CENTRAL_RADIUS_MI = 4;

function computeZone(
  lat: number,
  lon: number,
  bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number },
  displayName: string,
): string {
  const cLat = (bounds.latMin + bounds.latMax) / 2;
  const cLon = (bounds.lonMin + bounds.lonMax) / 2;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((cLat * Math.PI) / 180);
  const dyMi = (lat - cLat) * M_PER_DEG_LAT * MI_PER_M;
  const dxMi = (lon - cLon) * mPerDegLon * MI_PER_M;
  const distMi = Math.sqrt(dxMi * dxMi + dyMi * dyMi);
  // Strip " MSA", " CSA", " County" suffixes for compact zone labels.
  const base = displayName.replace(/\s+(MSA|CSA|County)$/i, "");
  if (distMi <= CENTRAL_RADIUS_MI) return `Central ${base}`;
  const ns = lat >= cLat ? "N" : "S";
  const ew = lon >= cLon ? "E" : "W";
  return `${ns}${ew} ${base}`;
}

/** Load the synthesized IntersectionSummary[] for a non-Atlanta region. */
export function loadRegionalIntersections(regionCode: string): IntersectionSummary[] {
  const cached = cache.get(regionCode);
  if (cached) return cached;

  const slug = regionCodeToSlug(regionCode);
  const text = readFileSync(findData(`${slug}-signals.json`), "utf8");
  const tuples = JSON.parse(text) as SignalTuple[];

  const region = REGION_INFO[regionCode];
  if (!region) throw new Error(`Unknown region for regional-intersections: ${regionCode}`);

  // Cross-street labels + nearest road class, resolved from the region's
  // roads dataset (if loaded). Empty map when roads file isn't built yet —
  // names fall back to "Signal #<id>" and volume to DEFAULT_VOLUME.
  const namingByOsmId = getSignalNamesForRegion(regionCode);

  // State-DOT AADT snapped to each signal (FDOT for FL metros, NCDOT for
  // NC metros). Empty map when the region doesn't have AADT loaded yet.
  // When present, replaces the road-class volume baseline below with a
  // measured-traffic estimate: vph = aadt × kFactor / 100.
  const aadtBySignal = loadAadtForRegion(slug);

  const summaries: IntersectionSummary[] = tuples.map(([rawId, lat, lon, embeddedName]) => {
    // Negative IDs come from authoritative city sources (e.g. Charlotte CDOT)
    // that don't have an OSM equivalent. Format the display ID nicely.
    const isCityAuthoritative = rawId < 0;
    const idLabel = isCityAuthoritative ? `${slug}-cdot-${Math.abs(rawId)}` : `${slug}-${rawId}`;

    // Only look up roads-based naming for OSM-derived tuples (the city-
    // authoritative ones already carry the canonical intersection name).
    const naming = isCityAuthoritative ? undefined : namingByOsmId.get(rawId);

    // Name precedence:
    //   1. embeddedName when present — this is the city-authoritative cross-
    //      street label (e.g. Charlotte CDOT UNITDESC overlaid by the
    //      fetch-charlotte-cdot-signals script). Strictly better than the
    //      OSM-roads-derived fallback.
    //   2. roads-derived "Street A & Street B" via the naming module.
    //   3. "Signal #<id>" stub.
    const name = embeddedName ?? naming?.name ?? `Signal #${Math.abs(rawId)}`;

    // Road class + volume baseline keyed off the nearest road's OSM class.
    // City-authoritative signals don't have a roads-derived class either —
    // they get the DEFAULT until we wire a separate roads lookup for them.
    const classCode = naming?.roadClassCode ?? -1;
    const roadClass = classCode >= 0 ? (CLASS_NAME[classCode] ?? DEFAULT_CLASS_NAME) : DEFAULT_CLASS_NAME;

    // Volume: prefer measured AADT × K-factor when we have it for this
    // signal. Otherwise fall back to the road-class baseline.
    // AADT × (K/100) gives peak-hour vph at the count station. For FDOT
    // segments the K-factor is per-segment (e.g. 9.0). For NCDOT stations
    // we default K to FHWA's 9% standard.
    const aadtRec = aadtBySignal[String(rawId)];
    const totalVolume = aadtRec
      ? Math.max(100, Math.round((aadtRec.aadt * aadtRec.kFactor) / 100))
      : classCode >= 0
        ? (VOLUME_BY_CLASS[classCode] ?? DEFAULT_VOLUME)
        : DEFAULT_VOLUME;

    // Zone: prefer real neighborhood polygon when one's loaded for this
    // region (Nashville, Orlando today). Falls back to compass quadrant
    // for regions without neighborhood data, or signals outside city limits.
    const zone =
      neighborhoodFor(regionCode, lat, lon) ??
      computeZone(lat, lon, region.bounds, region.displayName);

    return {
      id: idLabel,
      name,
      zone,
      roadClass,
      latitude: lat,
      longitude: lon,
      totalVolume,
      turningVolume: 0,
      inefficiencyScore: 0,
      avgDelaySeconds: 0,
      severity: "low" as Severity,
    };
  });

  lruSet(cache, regionCode, summaries);
  return summaries;
}

/** Reset cache — used by tests. */
export function _clearRegionalCache(): void {
  cache.clear();
}
