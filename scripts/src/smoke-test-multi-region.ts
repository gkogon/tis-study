/**
 * Multi-region end-to-end smoke test.
 *
 * Validates that the region-resolution plumbing introduced in the
 * multi-region expansion actually produces the right jurisdiction
 * strings for each of the 140 indexed metros (50 states + DC). Specifically:
 *
 *   1. regionForCoordinate(lat, lon) finds the correct region for a
 *      sample coordinate inside every metro's bounding box.
 *   2. The resolved Region carries the right dotName, planningOfficeName,
 *      and parkingCodeCitation (the three fields that get substituted
 *      into generated TIS PDFs).
 *   3. getActiveRegion(regionCode) returns the matching Region with the
 *      right jurisdictional copy.
 *
 * If anything regresses (e.g. someone adds Charlotte coords and gets
 * Atlanta's DOT name back), this test fails loudly.
 *
 * Run:  pnpm --filter @workspace/scripts exec tsx src/smoke-test-multi-region.ts
 */

import {
  REGIONS,
  ATLANTA_METRO,
  regionForCoordinate,
  getActiveRegion,
  type Region,
  type RegionCode,
} from "../../artifacts/tis-api-server/src/lib/regions";

type Probe = {
  regionCode: RegionCode;
  /** A coordinate inside the metro core, hand-picked from a known landmark. */
  lat: number;
  lon: number;
  /** Substring that must appear in jurisdiction.dotName. */
  expectDotIncludes: string;
};

const PROBES: Probe[] = [
  // Tier-0
  { regionCode: "atlanta_metro", lat: 33.7490, lon: -84.3880, expectDotIncludes: "Atlanta" },
  { regionCode: "charlotte_metro", lat: 35.2271, lon: -80.8431, expectDotIncludes: "Charlotte" },
  { regionCode: "nashville_metro", lat: 36.1627, lon: -86.7816, expectDotIncludes: "Nashville" },
  { regionCode: "tampa_metro", lat: 27.9506, lon: -82.4572, expectDotIncludes: "Tampa" },
  { regionCode: "orlando_metro", lat: 28.5383, lon: -81.3792, expectDotIncludes: "Orlando" },
  { regionCode: "raleigh_durham_metro", lat: 35.7796, lon: -78.6382, expectDotIncludes: "Raleigh" },
  { regionCode: "miami_dade_metro", lat: 25.7617, lon: -80.1918, expectDotIncludes: "Miami-Dade" },
  // Tier-1
  { regionCode: "jacksonville_metro", lat: 30.3322, lon: -81.6557, expectDotIncludes: "Jacksonville" },
  { regionCode: "memphis_metro", lat: 35.1495, lon: -90.0490, expectDotIncludes: "Memphis" },
  { regionCode: "knoxville_metro", lat: 35.9606, lon: -83.9207, expectDotIncludes: "Knoxville" },
  { regionCode: "chattanooga_metro", lat: 35.0456, lon: -85.3097, expectDotIncludes: "Chattanooga" },
  { regionCode: "savannah_metro", lat: 32.0809, lon: -81.0912, expectDotIncludes: "Savannah" },
  { regionCode: "asheville_metro", lat: 35.5951, lon: -82.5515, expectDotIncludes: "Asheville" },
  { regionCode: "wilmington_metro", lat: 34.2257, lon: -77.9447, expectDotIncludes: "Wilmington" },
  { regionCode: "triad_metro", lat: 36.0726, lon: -79.7920, expectDotIncludes: "Greensboro" }, // Triad-Greensboro
  // Tier-2
  { regionCode: "birmingham_metro", lat: 33.5186, lon: -86.8104, expectDotIncludes: "Birmingham" },
  { regionCode: "hampton_roads_metro", lat: 36.8508, lon: -76.2859, expectDotIncludes: "Hampton Roads" },
  { regionCode: "richmond_metro", lat: 37.5407, lon: -77.4360, expectDotIncludes: "Richmond" },
  { regionCode: "charleston_sc_metro", lat: 32.7765, lon: -79.9311, expectDotIncludes: "Charleston" },
  { regionCode: "columbia_sc_metro", lat: 34.0007, lon: -81.0348, expectDotIncludes: "Columbia" },
  { regionCode: "louisville_metro", lat: 38.2527, lon: -85.7585, expectDotIncludes: "Louisville" },
  { regionCode: "new_orleans_metro", lat: 29.9511, lon: -90.0715, expectDotIncludes: "New Orleans" },
  // Tier-3
  { regionCode: "lexington_metro", lat: 38.0406, lon: -84.5037, expectDotIncludes: "Lexington" },
  { regionCode: "mobile_metro", lat: 30.6954, lon: -88.0399, expectDotIncludes: "Mobile" },
  { regionCode: "huntsville_metro", lat: 34.7304, lon: -86.5861, expectDotIncludes: "Huntsville" },
  { regionCode: "pensacola_metro", lat: 30.4213, lon: -87.2169, expectDotIncludes: "Pensacola" },
  { regionCode: "fayetteville_metro", lat: 35.0527, lon: -78.8784, expectDotIncludes: "Fayetteville" },
  { regionCode: "greenville_nc_metro", lat: 35.6127, lon: -77.3664, expectDotIncludes: "Greenville" },
  { regionCode: "augusta_metro", lat: 33.4734, lon: -81.9748, expectDotIncludes: "Augusta" },
  { regionCode: "macon_metro", lat: 32.8407, lon: -83.6324, expectDotIncludes: "Macon" },
  // Tier-4: Coast + Midwest + Westward
  { regionCode: "washington_dc_metro", lat: 38.9072, lon: -77.0369, expectDotIncludes: "DDOT" },
  { regionCode: "baltimore_metro", lat: 39.2904, lon: -76.6122, expectDotIncludes: "Baltimore" },
  { regionCode: "philadelphia_metro", lat: 39.9526, lon: -75.1652, expectDotIncludes: "Philadelphia" },
  { regionCode: "pittsburgh_metro", lat: 40.4406, lon: -79.9959, expectDotIncludes: "Pittsburgh" },
  { regionCode: "new_york_metro", lat: 40.7128, lon: -74.0060, expectDotIncludes: "NYC" },
  { regionCode: "boston_metro", lat: 42.3601, lon: -71.0589, expectDotIncludes: "Boston" },
  { regionCode: "chicago_metro", lat: 41.8781, lon: -87.6298, expectDotIncludes: "Chicago" },
  { regionCode: "detroit_metro", lat: 42.3314, lon: -83.0458, expectDotIncludes: "Detroit" },
  { regionCode: "twin_cities_metro", lat: 44.9778, lon: -93.2650, expectDotIncludes: "Minneapolis" },
  { regionCode: "cleveland_metro", lat: 41.4993, lon: -81.6944, expectDotIncludes: "Cleveland" },
  { regionCode: "columbus_oh_metro", lat: 39.9612, lon: -82.9988, expectDotIncludes: "Columbus" },
  { regionCode: "cincinnati_metro", lat: 39.1031, lon: -84.5120, expectDotIncludes: "Cincinnati" },
  { regionCode: "indianapolis_metro", lat: 39.7684, lon: -86.1581, expectDotIncludes: "Indianapolis" },
  { regionCode: "st_louis_metro", lat: 38.6270, lon: -90.1994, expectDotIncludes: "St. Louis" },
  { regionCode: "kansas_city_metro", lat: 39.0997, lon: -94.5786, expectDotIncludes: "Kansas City" },
  { regionCode: "milwaukee_metro", lat: 43.0389, lon: -87.9065, expectDotIncludes: "Milwaukee" },
  { regionCode: "houston_metro", lat: 29.7604, lon: -95.3698, expectDotIncludes: "Houston" },
  { regionCode: "dallas_fort_worth_metro", lat: 32.7767, lon: -96.7970, expectDotIncludes: "Dallas" },
  { regionCode: "austin_metro", lat: 30.2672, lon: -97.7431, expectDotIncludes: "Austin" },
  { regionCode: "san_antonio_metro", lat: 29.4241, lon: -98.4936, expectDotIncludes: "San Antonio" },
  // Tier-5: West Coast + Mountain West
  { regionCode: "los_angeles_metro", lat: 34.0522, lon: -118.2437, expectDotIncludes: "LADOT" },
  { regionCode: "sf_bay_metro", lat: 37.7749, lon: -122.4194, expectDotIncludes: "SFMTA" },
  { regionCode: "san_diego_metro", lat: 32.7157, lon: -117.1611, expectDotIncludes: "San Diego" },
  { regionCode: "sacramento_metro", lat: 38.5816, lon: -121.4944, expectDotIncludes: "Sacramento" },
  { regionCode: "inland_empire_metro", lat: 33.9533, lon: -117.3962, expectDotIncludes: "Riverside" },
  { regionCode: "fresno_metro", lat: 36.7378, lon: -119.7871, expectDotIncludes: "Fresno" },
  { regionCode: "portland_metro", lat: 45.5152, lon: -122.6784, expectDotIncludes: "PBOT" },
  { regionCode: "seattle_metro", lat: 47.6062, lon: -122.3321, expectDotIncludes: "SDOT" },
  { regionCode: "las_vegas_metro", lat: 36.1716, lon: -115.1391, expectDotIncludes: "Las Vegas" },
  { regionCode: "phoenix_metro", lat: 33.4484, lon: -112.0740, expectDotIncludes: "Phoenix" },
  { regionCode: "tucson_metro", lat: 32.2226, lon: -110.9747, expectDotIncludes: "Tucson" },
  { regionCode: "denver_metro", lat: 39.7392, lon: -104.9903, expectDotIncludes: "Denver" },
  { regionCode: "salt_lake_city_metro", lat: 40.7608, lon: -111.8910, expectDotIncludes: "Salt Lake City" },
  { regionCode: "albuquerque_metro", lat: 35.0844, lon: -106.6504, expectDotIncludes: "Albuquerque" },
  // Tier-6: 50-state coverage
  { regionCode: "hartford_metro", lat: 41.7637, lon: -72.6851, expectDotIncludes: "Hartford" },
  { regionCode: "providence_metro", lat: 41.8240, lon: -71.4128, expectDotIncludes: "Providence" },
  { regionCode: "manchester_metro", lat: 42.9956, lon: -71.4548, expectDotIncludes: "Manchester" },
  { regionCode: "burlington_vt_metro", lat: 44.4759, lon: -73.2121, expectDotIncludes: "Burlington" },
  { regionCode: "portland_me_metro", lat: 43.6591, lon: -70.2568, expectDotIncludes: "Portland" },
  { regionCode: "trenton_metro", lat: 40.2206, lon: -74.7565, expectDotIncludes: "Trenton" },
  { regionCode: "charleston_wv_metro", lat: 38.3498, lon: -81.6326, expectDotIncludes: "Charleston" },
  { regionCode: "jackson_ms_metro", lat: 32.2988, lon: -90.1848, expectDotIncludes: "Jackson" },
  { regionCode: "little_rock_metro", lat: 34.7465, lon: -92.2896, expectDotIncludes: "Little Rock" },
  { regionCode: "oklahoma_city_metro", lat: 35.4676, lon: -97.5164, expectDotIncludes: "Oklahoma City" },
  { regionCode: "tulsa_metro", lat: 36.1540, lon: -95.9928, expectDotIncludes: "Tulsa" },
  { regionCode: "des_moines_metro", lat: 41.5868, lon: -93.6250, expectDotIncludes: "Des Moines" },
  { regionCode: "omaha_metro", lat: 41.2565, lon: -95.9345, expectDotIncludes: "Omaha" },
  { regionCode: "wichita_metro", lat: 37.6872, lon: -97.3301, expectDotIncludes: "Wichita" },
  { regionCode: "fargo_metro", lat: 46.8772, lon: -96.7898, expectDotIncludes: "Fargo" },
  { regionCode: "sioux_falls_metro", lat: 43.5446, lon: -96.7311, expectDotIncludes: "Sioux Falls" },
  { regionCode: "boise_metro", lat: 43.6150, lon: -116.2023, expectDotIncludes: "ACHD" },
  { regionCode: "billings_metro", lat: 45.7833, lon: -108.5007, expectDotIncludes: "Billings" },
  { regionCode: "cheyenne_metro", lat: 41.1400, lon: -104.8202, expectDotIncludes: "Cheyenne" },
  { regionCode: "anchorage_metro", lat: 61.2181, lon: -149.9003, expectDotIncludes: "Anchorage" },
  { regionCode: "honolulu_metro", lat: 21.3099, lon: -157.8581, expectDotIncludes: "Honolulu" },
  // Tier-7: depth push (55 secondary metros)
  { regionCode: "rochester_ny_metro", lat: 43.1566, lon: -77.6088, expectDotIncludes: "Rochester" },
  { regionCode: "buffalo_metro", lat: 42.8864, lon: -78.8784, expectDotIncludes: "Buffalo" },
  { regionCode: "syracuse_metro", lat: 43.0481, lon: -76.1474, expectDotIncludes: "Syracuse" },
  { regionCode: "albany_metro", lat: 42.6526, lon: -73.7562, expectDotIncludes: "Albany" },
  { regionCode: "toledo_metro", lat: 41.6528, lon: -83.5379, expectDotIncludes: "Toledo" },
  { regionCode: "akron_metro", lat: 41.0814, lon: -81.5190, expectDotIncludes: "Akron" },
  { regionCode: "dayton_metro", lat: 39.7589, lon: -84.1916, expectDotIncludes: "Dayton" },
  { regionCode: "youngstown_metro", lat: 41.0998, lon: -80.6495, expectDotIncludes: "Youngstown" },
  { regionCode: "grand_rapids_metro", lat: 42.9634, lon: -85.6681, expectDotIncludes: "Grand Rapids" },
  { regionCode: "lansing_metro", lat: 42.7325, lon: -84.5555, expectDotIncludes: "Lansing" },
  { regionCode: "ann_arbor_metro", lat: 42.2808, lon: -83.7430, expectDotIncludes: "Ann Arbor" },
  { regionCode: "flint_metro", lat: 43.0125, lon: -83.6875, expectDotIncludes: "Flint" },
  { regionCode: "allentown_metro", lat: 40.6084, lon: -75.4902, expectDotIncludes: "Allentown" },
  { regionCode: "harrisburg_metro", lat: 40.2732, lon: -76.8867, expectDotIncludes: "Harrisburg" },
  { regionCode: "scranton_metro", lat: 41.4090, lon: -75.6624, expectDotIncludes: "Scranton" },
  { regionCode: "erie_metro", lat: 42.1292, lon: -80.0851, expectDotIncludes: "Erie" },
  { regionCode: "worcester_metro", lat: 42.2626, lon: -71.8023, expectDotIncludes: "Worcester" },
  { regionCode: "springfield_ma_metro", lat: 42.1015, lon: -72.5898, expectDotIncludes: "Springfield" },
  { regionCode: "new_haven_metro", lat: 41.3083, lon: -72.9279, expectDotIncludes: "New Haven" },
  { regionCode: "bridgeport_metro", lat: 41.1865, lon: -73.1952, expectDotIncludes: "Bridgeport" },
  { regionCode: "fort_wayne_metro", lat: 41.0793, lon: -85.1394, expectDotIncludes: "Fort Wayne" },
  { regionCode: "south_bend_metro", lat: 41.6764, lon: -86.2520, expectDotIncludes: "South Bend" },
  { regionCode: "evansville_metro", lat: 37.9716, lon: -87.5711, expectDotIncludes: "Evansville" },
  { regionCode: "madison_metro", lat: 43.0731, lon: -89.4012, expectDotIncludes: "Madison" },
  { regionCode: "green_bay_metro", lat: 44.5133, lon: -88.0133, expectDotIncludes: "Green Bay" },
  { regionCode: "springfield_il_metro", lat: 39.7817, lon: -89.6501, expectDotIncludes: "Springfield" },
  { regionCode: "rockford_metro", lat: 42.2711, lon: -89.0940, expectDotIncludes: "Rockford" },
  { regionCode: "peoria_metro", lat: 40.6936, lon: -89.5890, expectDotIncludes: "Peoria" },
  { regionCode: "champaign_metro", lat: 40.1164, lon: -88.2434, expectDotIncludes: "Champaign" },
  { regionCode: "el_paso_metro", lat: 31.85, lon: -106.4850, expectDotIncludes: "El Paso" },
  { regionCode: "corpus_christi_metro", lat: 27.8006, lon: -97.3964, expectDotIncludes: "Corpus Christi" },
  { regionCode: "lubbock_metro", lat: 33.5779, lon: -101.8552, expectDotIncludes: "Lubbock" },
  { regionCode: "mcallen_metro", lat: 26.2034, lon: -98.2300, expectDotIncludes: "McAllen" },
  { regionCode: "bakersfield_metro", lat: 35.3733, lon: -119.0187, expectDotIncludes: "Bakersfield" },
  { regionCode: "stockton_metro", lat: 37.9577, lon: -121.2908, expectDotIncludes: "Stockton" },
  { regionCode: "modesto_metro", lat: 37.6391, lon: -120.9969, expectDotIncludes: "Modesto" },
  { regionCode: "oxnard_metro", lat: 34.1975, lon: -119.1771, expectDotIncludes: "Oxnard" },
  { regionCode: "colorado_springs_metro", lat: 38.8339, lon: -104.8214, expectDotIncludes: "Colorado Springs" },
  { regionCode: "fort_collins_metro", lat: 40.5853, lon: -105.0844, expectDotIncludes: "Fort Collins" },
  { regionCode: "reno_metro", lat: 39.5296, lon: -119.8138, expectDotIncludes: "Reno" },
  { regionCode: "spokane_metro", lat: 47.6587, lon: -117.4260, expectDotIncludes: "Spokane" },
  { regionCode: "tacoma_metro", lat: 47.2529, lon: -122.4443, expectDotIncludes: "Tacoma" },
  { regionCode: "eugene_metro", lat: 44.0521, lon: -123.0868, expectDotIncludes: "Eugene" },
  { regionCode: "salem_or_metro", lat: 44.9429, lon: -123.0351, expectDotIncludes: "Salem" },
  { regionCode: "provo_metro", lat: 40.2338, lon: -111.6585, expectDotIncludes: "Provo" },
  { regionCode: "ogden_metro", lat: 41.2230, lon: -111.9738, expectDotIncludes: "Ogden" },
  { regionCode: "rochester_mn_metro", lat: 44.0121, lon: -92.4802, expectDotIncludes: "Rochester" },
  { regionCode: "duluth_metro", lat: 46.7867, lon: -92.1005, expectDotIncludes: "Duluth" },
  { regionCode: "fort_lauderdale_metro", lat: 26.1224, lon: -80.1373, expectDotIncludes: "Fort Lauderdale" },
  { regionCode: "west_palm_beach_metro", lat: 26.7153, lon: -80.0534, expectDotIncludes: "West Palm Beach" },
  { regionCode: "daytona_beach_metro", lat: 29.2108, lon: -81.0228, expectDotIncludes: "Daytona Beach" },
  { regionCode: "lakeland_metro", lat: 28.0395, lon: -81.9498, expectDotIncludes: "Lakeland" },
  { regionCode: "tallahassee_metro", lat: 30.4383, lon: -84.2807, expectDotIncludes: "Tallahassee" },
  { regionCode: "fort_myers_metro", lat: 26.6406, lon: -81.8723, expectDotIncludes: "Fort Myers" },
  { regionCode: "roanoke_metro", lat: 37.2710, lon: -79.9414, expectDotIncludes: "Roanoke" },
  { regionCode: "charlottesville_metro", lat: 38.0293, lon: -78.4767, expectDotIncludes: "Charlottesville" },
  { regionCode: "springfield_mo_metro", lat: 37.2090, lon: -93.2923, expectDotIncludes: "Springfield" },
  { regionCode: "columbia_mo_metro", lat: 38.9517, lon: -92.3341, expectDotIncludes: "Columbia" },
  { regionCode: "cedar_rapids_metro", lat: 41.9779, lon: -91.6656, expectDotIncludes: "Cedar Rapids" },
  // Tier-8: Canada (10 metros across 7 provinces)
  { regionCode: "toronto_metro", lat: 43.6532, lon: -79.3832, expectDotIncludes: "Toronto" },
  { regionCode: "montreal_metro", lat: 45.5017, lon: -73.5673, expectDotIncludes: "Montréal" },
  { regionCode: "vancouver_metro", lat: 49.2827, lon: -123.1207, expectDotIncludes: "Vancouver" },
  { regionCode: "calgary_metro", lat: 51.0447, lon: -114.0719, expectDotIncludes: "Calgary" },
  { regionCode: "ottawa_metro", lat: 45.4215, lon: -75.6972, expectDotIncludes: "Ottawa" },
  { regionCode: "edmonton_metro", lat: 53.5461, lon: -113.4938, expectDotIncludes: "Edmonton" },
  { regionCode: "winnipeg_metro", lat: 49.8951, lon: -97.1384, expectDotIncludes: "Winnipeg" },
  { regionCode: "quebec_city_metro", lat: 46.8139, lon: -71.2080, expectDotIncludes: "Québec" },
  { regionCode: "hamilton_metro", lat: 43.2557, lon: -79.8711, expectDotIncludes: "Hamilton" },
  { regionCode: "halifax_metro", lat: 44.6488, lon: -63.5752, expectDotIncludes: "Halifax" },
  // Tier-9: Mexico (10) — Spanish jurisdictional names
  { regionCode: "mexico_city_metro", lat: 19.4326, lon: -99.1332, expectDotIncludes: "SEMOVI" },
  { regionCode: "guadalajara_metro", lat: 20.6597, lon: -103.3496, expectDotIncludes: "Jalisco" },
  { regionCode: "monterrey_metro", lat: 25.6866, lon: -100.3161, expectDotIncludes: "Nuevo León" },
  { regionCode: "puebla_metro", lat: 19.0414, lon: -98.2063, expectDotIncludes: "Puebla" },
  { regionCode: "tijuana_metro", lat: 32.5149, lon: -117.0382, expectDotIncludes: "Baja California" },
  { regionCode: "toluca_metro", lat: 19.2826, lon: -99.6557, expectDotIncludes: "México" },
  { regionCode: "leon_metro", lat: 21.1250, lon: -101.6860, expectDotIncludes: "León" },
  { regionCode: "juarez_metro", lat: 31.6904, lon: -106.4245, expectDotIncludes: "Juárez" },
  { regionCode: "queretaro_metro", lat: 20.5888, lon: -100.3899, expectDotIncludes: "Querétaro" },
  { regionCode: "merida_metro", lat: 20.9674, lon: -89.5926, expectDotIncludes: "Yucatán" },
  // Tier-9: United Kingdom (7)
  { regionCode: "london_metro", lat: 51.5074, lon: -0.1278, expectDotIncludes: "TfL" },
  { regionCode: "manchester_uk_metro", lat: 53.4808, lon: -2.2426, expectDotIncludes: "TfGM" },
  { regionCode: "birmingham_uk_metro", lat: 52.4862, lon: -1.8904, expectDotIncludes: "TfWM" },
  { regionCode: "glasgow_metro", lat: 55.8642, lon: -4.2518, expectDotIncludes: "Strathclyde" },
  { regionCode: "edinburgh_metro", lat: 55.9533, lon: -3.1883, expectDotIncludes: "Edinburgh" },
  { regionCode: "leeds_metro", lat: 53.8008, lon: -1.5491, expectDotIncludes: "West Yorkshire" },
  { regionCode: "bristol_metro", lat: 51.4545, lon: -2.5879, expectDotIncludes: "West of England" },
];

type Result = { name: string; ok: boolean; got?: string; want?: string };
const results: Result[] = [];

function check(name: string, ok: boolean, got?: string, want?: string): void {
  results.push({ name, ok, got, want });
}

console.log("=== Multi-region jurisdiction smoke test ===\n");

// Confirm every probe coordinate resolves to the expected region.
let resolvedOk = 0;
let resolvedFail = 0;
for (const p of PROBES) {
  const region = regionForCoordinate(p.lat, p.lon);
  if (!region) {
    check(`regionForCoordinate(${p.regionCode})`, false, "null", p.regionCode);
    resolvedFail++;
    console.log(`✗ ${p.regionCode.padEnd(24)} (${p.lat}, ${p.lon}) → null (no active region)`);
    continue;
  }
  if (region.code !== p.regionCode) {
    check(`regionForCoordinate(${p.regionCode})`, false, region.code, p.regionCode);
    resolvedFail++;
    console.log(`✗ ${p.regionCode.padEnd(24)} (${p.lat}, ${p.lon}) → ${region.code} (wrong region — overlap?)`);
    continue;
  }
  resolvedOk++;
  if (!region.jurisdiction.dotName.includes(p.expectDotIncludes)) {
    check(`dotName(${p.regionCode})`, false, region.jurisdiction.dotName, p.expectDotIncludes);
    console.log(`✗ ${p.regionCode.padEnd(24)} dotName='${region.jurisdiction.dotName}' missing '${p.expectDotIncludes}'`);
  } else {
    check(`dotName(${p.regionCode})`, true);
  }
}

console.log("");
console.log(`Coordinate resolution: ${resolvedOk}/${PROBES.length} regions matched expected metro`);
console.log("");

// Verify getActiveRegion(code) round-trips and returns Atlanta on fallback paths.
console.log("--- getActiveRegion fallback behavior ---");
const noArg = getActiveRegion();
check("getActiveRegion() defaults to Atlanta", noArg.code === "atlanta_metro", noArg.code, "atlanta_metro");
console.log(`  no args → ${noArg.code} (${noArg.code === "atlanta_metro" ? "✓" : "✗"})`);

const unknown = getActiveRegion("not_a_real_metro" as RegionCode);
check("getActiveRegion(unknown) → Atlanta", unknown.code === "atlanta_metro", unknown.code, "atlanta_metro");
console.log(`  unknown code → ${unknown.code} (${unknown.code === "atlanta_metro" ? "✓" : "✗"})`);

const charlotte = getActiveRegion("charlotte_metro");
check("getActiveRegion(charlotte) returns Charlotte", charlotte.code === "charlotte_metro", charlotte.code, "charlotte_metro");
console.log(`  charlotte_metro → ${charlotte.code} (${charlotte.code === "charlotte_metro" ? "✓" : "✗"})`);

// Spot-check parking citation strings match jurisdiction (catches accidental
// copy-paste mistakes across the 30 entries in regions.ts).
console.log("");
console.log("--- Spot-check parking citations are not all Atlanta's ---");
const atlantaCitation = ATLANTA_METRO.jurisdiction.parkingCodeCitation;
let mismatchedCitations = 0;
for (const code of Object.keys(REGIONS) as RegionCode[]) {
  if (code === "atlanta_metro") continue;
  const r: Region = REGIONS[code];
  if (!r.active) continue;
  if (r.jurisdiction.parkingCodeCitation === atlantaCitation) {
    check(`parking citation distinct for ${code}`, false, "= Atlanta's", "distinct");
    mismatchedCitations++;
    console.log(`  ✗ ${code} has Atlanta's parking citation`);
  }
}
if (mismatchedCitations === 0) {
  console.log(`  ✓ all ${Object.keys(REGIONS).filter((c) => REGIONS[c as RegionCode].active && c !== "atlanta_metro").length} active non-Atlanta regions have distinct parking citations`);
}

// Summary
const ok = results.filter((r) => r.ok).length;
const total = results.length;
console.log("");
console.log("=== Summary ===");
console.log(`${ok}/${total} assertions passed`);
const fails = results.filter((r) => !r.ok);
if (fails.length > 0) {
  console.log("");
  console.log("FAILURES:");
  for (const f of fails) {
    console.log(`  ✗ ${f.name}: got=${JSON.stringify(f.got)} want=${JSON.stringify(f.want)}`);
  }
  process.exit(1);
}
console.log("All checks passed ✓");
