/**
 * Public metro-coverage catalog. Drives the §04 Coverage section on the
 * marketing site + the per-metro detail pages.
 *
 * Numbers reflect the data actually loaded in artifacts/api-server/src/data/
 * as of 2026-05-27. Re-export from the api-server data-pipeline when we
 * automate the refresh; for now this is hand-maintained alongside the
 * fetch scripts (scripts/src/fetch-*.ts).
 *
 * Convention:
 *   - `aadtPct` is the share of signals snapped to measured state-DOT AADT
 *     (vs. synthetic road-class baseline). 75%+ → "Tier A" coverage,
 *     featured prominently. Below → "Tier B", listed but not highlighted.
 *   - `liveSource` is the state DOT feeding live incidents. null = no
 *     live feed wired (Nashville/Birmingham/etc — see DATA_SOURCES.md).
 */

export type LiveSource = "GDOT 511" | "NCDOT TIMS" | "FDOT DIVAS" | "KYTC closures"
  | "NYSDOT" | "IDOT" | "MDOT" | "MnDOT" | "WisDOT"
  | "TxDOT DriveTexas" | "ADOT Traffic Events" | "NMDOT Public Incidents"
  | "ODOT-OR TripCheck" | "MD CHART" | "MoDOT WZDx"
  | "511 Ontario" | "Québec 511" | "DriveBC" | "511 Alberta" | "Manitoba 511" | "511 NS";

export type MetroCoverage = {
  /** Region code matching tis-api-server/src/lib/regions.ts. */
  code: string;
  /** URL slug for /cities/:slug — matches the data-file naming. */
  slug: string;
  /** Marketing name; falls back to formal `displayName` when set. */
  shortName: string;
  /** Long form used on the detail page hero ("Charlotte MSA", "Piedmont Triad CSA"). */
  longName: string;
  state: "GA" | "NC" | "TN" | "FL" | "AL" | "SC" | "VA" | "KY" | "LA"
    | "DC" | "MD" | "PA" | "NY" | "MA" | "IL" | "MI" | "MN" | "OH"
    | "IN" | "MO" | "WI" | "TX"
    | "CA" | "OR" | "WA" | "NV" | "AZ" | "CO" | "UT" | "NM"
    | "CT" | "RI" | "NH" | "VT" | "ME" | "NJ" | "WV" | "MS" | "AR" | "OK"
    | "IA" | "NE" | "KS" | "ND" | "SD" | "ID" | "MT" | "WY" | "AK" | "HI"
    | "ON" | "QC" | "BC" | "AB" | "MB" | "NS";  // Canadian provinces (Tier-8)
  /** Country defaults to US when omitted (back-compat for all pre-Tier-8 rows). */
  country?: "US" | "CA";
  signals: number;
  /** % of signals named via OSM roads or city dataset (vs "Signal #<id>" stub). */
  namedPct: number;
  /** % of signals snapped to measured state-DOT AADT. 0 means synthetic baseline. */
  aadtPct: number;
  liveSource: LiveSource | null;
  /** Top-line state-DOT AADT data source label, for the row hover. */
  aadtSource?: string;
  /** Local DOT / engineering body responsible for traffic-impact review. */
  dotName: string;
  /** Planning office that issues development orders. */
  planningOfficeName: string;
  /** Local zoning ordinance / code section the parking citation points to. */
  parkingCodeCitation: string;
  /** Optional city-authoritative signal overlay applied on top of OSM. */
  citySignalSource?: string;
  /** Whether a neighborhood-polygon dataset is loaded for the region. */
  hasNeighborhoodPolygons?: boolean;
};

/** All 30 metros currently indexed by the platform. Order is alphabetical
 *  within state, with Atlanta first (the flagship). The Coverage grid
 *  resorts by AADT% desc for display. Jurisdiction copy mirrors
 *  tis-api-server/src/lib/regions.ts — keep in sync when a new region
 *  ships. */
export const METROS: MetroCoverage[] = [
  // GA
  { code: "atlanta_metro", slug: "atlanta", shortName: "Atlanta", longName: "Atlanta MSA", state: "GA", signals: 7393, namedPct: 82.6, aadtPct: 100, liveSource: "GDOT 511", aadtSource: "GDOT calibrated counts",
    dotName: "City of Atlanta DOT", planningOfficeName: "City of Atlanta Office of Mobility Planning",
    parkingCodeCitation: "City of Atlanta Zoning Ordinance, Article 10 — Off-Street Parking and Loading." },
  { code: "augusta_metro", slug: "augusta", shortName: "Augusta", longName: "Augusta MSA", state: "GA", signals: 519, namedPct: 99.4, aadtPct: 75.1, liveSource: null, aadtSource: "GDOT AADT (DeKalbGIS ingest)",
    dotName: "Augusta Engineering Department", planningOfficeName: "Augusta Planning and Development Department",
    parkingCodeCitation: "Augusta Comprehensive Zoning Ordinance, Section 4-2 — Off-Street Parking." },
  { code: "macon_metro", slug: "macon", shortName: "Macon-Bibb", longName: "Macon-Bibb MSA", state: "GA", signals: 815, namedPct: 94.7, aadtPct: 47.1, liveSource: null, aadtSource: "GDOT AADT (state highways)",
    dotName: "Macon-Bibb County Engineering Department", planningOfficeName: "Macon-Bibb County Planning & Zoning Commission",
    parkingCodeCitation: "Macon-Bibb County Land Development Code, Article 6 — Parking." },
  { code: "savannah_metro", slug: "savannah", shortName: "Savannah", longName: "Savannah MSA", state: "GA", signals: 722, namedPct: 98.9, aadtPct: 76.7, liveSource: null, aadtSource: "GDOT AADT (DeKalbGIS ingest)",
    dotName: "City of Savannah Traffic Engineering", planningOfficeName: "Chatham County-Savannah Metropolitan Planning Commission",
    parkingCodeCitation: "Savannah Zoning Ordinance, Article 9 — Off-Street Parking." },

  // NC
  { code: "asheville_metro", slug: "asheville", shortName: "Asheville", longName: "Asheville MSA", state: "NC", signals: 699, namedPct: 95.7, aadtPct: 84.4, liveSource: "NCDOT TIMS", aadtSource: "NCDOT 2024 AADT stations",
    dotName: "City of Asheville Transportation Department", planningOfficeName: "City of Asheville Planning & Urban Design",
    parkingCodeCitation: "Asheville Unified Development Ordinance, Section 7-11 — Parking." },
  { code: "charlotte_metro", slug: "charlotte", shortName: "Charlotte", longName: "Charlotte MSA", state: "NC", signals: 4562, namedPct: 98.9, aadtPct: 86.3, liveSource: "NCDOT TIMS", aadtSource: "NCDOT 2024 AADT stations",
    dotName: "Charlotte DOT (CDOT)", planningOfficeName: "Charlotte-Mecklenburg Planning Department",
    parkingCodeCitation: "Charlotte Unified Development Ordinance (UDO), Article 19 — Parking.",
    citySignalSource: "CDOT Accela traffic-signal layer (overlaid on OSM)",
    hasNeighborhoodPolygons: true },
  { code: "fayetteville_metro", slug: "fayetteville", shortName: "Fayetteville", longName: "Fayetteville (NC) MSA", state: "NC", signals: 1096, namedPct: 97.4, aadtPct: 70.0, liveSource: "NCDOT TIMS", aadtSource: "NCDOT 2024 AADT stations",
    dotName: "Fayetteville Engineering & Infrastructure Department", planningOfficeName: "Fayetteville Planning Department",
    parkingCodeCitation: "Fayetteville Unified Development Ordinance, Article 30-5 — Parking." },
  { code: "greenville_nc_metro", slug: "greenville-nc", shortName: "Greenville (NC)", longName: "Greenville (NC) MSA", state: "NC", signals: 299, namedPct: 98.0, aadtPct: 70.9, liveSource: "NCDOT TIMS", aadtSource: "NCDOT 2024 AADT stations",
    dotName: "Greenville Engineering Department", planningOfficeName: "Greenville Planning Division",
    parkingCodeCitation: "Greenville Zoning Ordinance, Title 9 — Off-Street Parking." },
  { code: "raleigh_durham_metro", slug: "raleigh-durham", shortName: "Raleigh-Durham", longName: "Raleigh-Durham CSA", state: "NC", signals: 4904, namedPct: 97.8, aadtPct: 95.4, liveSource: "NCDOT TIMS", aadtSource: "NCDOT 2024 AADT stations",
    dotName: "Raleigh Department of Transportation", planningOfficeName: "Raleigh Department of City Planning",
    parkingCodeCitation: "Raleigh Unified Development Ordinance (UDO), Article 7.1 — Parking.",
    citySignalSource: "Raleigh Traffic Signals Public (city overlay)",
    hasNeighborhoodPolygons: true },
  { code: "triad_metro", slug: "triad", shortName: "Piedmont Triad", longName: "Piedmont Triad CSA", state: "NC", signals: 2940, namedPct: 98.5, aadtPct: 88.6, liveSource: "NCDOT TIMS", aadtSource: "NCDOT 2024 AADT stations",
    dotName: "Greensboro DOT / Winston-Salem DOT", planningOfficeName: "Piedmont Authority for Regional Transportation (PART)",
    parkingCodeCitation: "Greensboro LDO, Section 30-9 — Parking; Winston-Salem UDO, Chapter B, Article VI — Parking." },
  { code: "wilmington_metro", slug: "wilmington", shortName: "Wilmington", longName: "Wilmington MSA", state: "NC", signals: 621, namedPct: 98.7, aadtPct: 94.4, liveSource: "NCDOT TIMS", aadtSource: "NCDOT 2024 AADT stations",
    dotName: "City of Wilmington Traffic Engineering", planningOfficeName: "City of Wilmington Planning, Development & Transportation",
    parkingCodeCitation: "Wilmington Land Development Code, Section 18-301 — Parking." },

  // TN
  { code: "chattanooga_metro", slug: "chattanooga", shortName: "Chattanooga", longName: "Chattanooga MSA", state: "TN", signals: 523, namedPct: 95.8, aadtPct: 40.3, liveSource: null, aadtSource: "TDOT Traffic Points (state routes only)",
    dotName: "Chattanooga DOT", planningOfficeName: "Chattanooga Department of Transportation Planning",
    parkingCodeCitation: "City of Chattanooga Zoning Ordinance, Section 38 — Parking." },
  { code: "knoxville_metro", slug: "knoxville", shortName: "Knoxville", longName: "Knoxville MSA", state: "TN", signals: 1553, namedPct: 96.6, aadtPct: 37.4, liveSource: null, aadtSource: "TDOT Traffic Points (state routes only)",
    dotName: "Knoxville Engineering Department", planningOfficeName: "Knoxville-Knox County Planning",
    parkingCodeCitation: "City of Knoxville Zoning Ordinance, Article 12 — Parking." },
  { code: "memphis_metro", slug: "memphis", shortName: "Memphis", longName: "Memphis MSA", state: "TN", signals: 1280, namedPct: 98.3, aadtPct: 33.5, liveSource: null, aadtSource: "TDOT Traffic Points (state routes only)",
    dotName: "City of Memphis Division of Public Works", planningOfficeName: "Memphis & Shelby County Division of Planning and Development",
    parkingCodeCitation: "Memphis Unified Development Code, Article 4.5 — Parking." },
  { code: "nashville_metro", slug: "nashville", shortName: "Nashville", longName: "Nashville MSA", state: "TN", signals: 2685, namedPct: 96.9, aadtPct: 31.2, liveSource: null, aadtSource: "TDOT Traffic Points (state routes only)",
    dotName: "Nashville DOT (NDOT)", planningOfficeName: "Metro Nashville Planning Department",
    parkingCodeCitation: "Metropolitan Nashville Zoning Code, Title 17 — Parking and Loading.",
    hasNeighborhoodPolygons: true },

  // FL
  { code: "jacksonville_metro", slug: "jacksonville", shortName: "Jacksonville", longName: "Jacksonville MSA", state: "FL", signals: 2512, namedPct: 97.6, aadtPct: 84.6, liveSource: "FDOT DIVAS", aadtSource: "FDOT AADT TDA",
    dotName: "Jacksonville Public Works", planningOfficeName: "Jacksonville Planning and Development Dept.",
    parkingCodeCitation: "City of Jacksonville Zoning Code, Part 4 — Off-Street Parking." },
  { code: "miami_dade_metro", slug: "miami-dade", shortName: "Miami-Dade", longName: "Miami-Dade County", state: "FL", signals: 10302, namedPct: 98.9, aadtPct: 85.1, liveSource: "FDOT DIVAS", aadtSource: "FDOT AADT TDA + MDC stations",
    dotName: "Miami-Dade Department of Transportation and Public Works",
    planningOfficeName: "Miami-Dade Regulatory and Economic Resources Department",
    parkingCodeCitation: "Miami-Dade County Code, Chapter 33 — Zoning, Article XXVII — Off-Street Parking.",
    citySignalSource: "Miami-Dade County TrafficSignals_gdb (overlay on OSM)",
    hasNeighborhoodPolygons: true },
  { code: "orlando_metro", slug: "orlando", shortName: "Orlando", longName: "Orlando MSA", state: "FL", signals: 6850, namedPct: 96.5, aadtPct: 67.8, liveSource: "FDOT DIVAS", aadtSource: "FDOT AADT TDA",
    dotName: "City of Orlando Transportation Engineering Division", planningOfficeName: "City of Orlando Planning Division",
    parkingCodeCitation: "Orlando Land Development Code, Chapter 61 — Off-Street Parking and Loading.",
    citySignalSource: "City of Orlando ITS Devices (overlay on OSM)",
    hasNeighborhoodPolygons: true },
  { code: "pensacola_metro", slug: "pensacola", shortName: "Pensacola", longName: "Pensacola MSA", state: "FL", signals: 658, namedPct: 98.8, aadtPct: 88.4, liveSource: "FDOT DIVAS", aadtSource: "FDOT AADT TDA",
    dotName: "Escambia County Engineering / City of Pensacola Public Works", planningOfficeName: "Florida-Alabama TPO (FL-AL TPO)",
    parkingCodeCitation: "Escambia County Land Development Code, Chapter 4 — Off-Street Parking." },
  { code: "tampa_metro", slug: "tampa", shortName: "Tampa", longName: "Tampa MSA", state: "FL", signals: 5208, namedPct: 97.4, aadtPct: 80.5, liveSource: "FDOT DIVAS", aadtSource: "FDOT AADT TDA",
    dotName: "City of Tampa Transportation Division", planningOfficeName: "Tampa Planning Commission",
    parkingCodeCitation: "City of Tampa Land Development Code, Chapter 27 — Off-Street Parking.",
    hasNeighborhoodPolygons: true },

  // AL
  { code: "birmingham_metro", slug: "birmingham", shortName: "Birmingham", longName: "Birmingham MSA", state: "AL", signals: 1854, namedPct: 95.0, aadtPct: 83.2, liveSource: null, aadtSource: "ALDOT TDM 2024-2025 AADT",
    dotName: "City of Birmingham Department of Transportation", planningOfficeName: "Birmingham Department of Planning, Engineering & Permits",
    parkingCodeCitation: "Birmingham Zoning Ordinance, Article 5 — Off-Street Parking and Loading." },
  { code: "huntsville_metro", slug: "huntsville", shortName: "Huntsville", longName: "Huntsville MSA", state: "AL", signals: 968, namedPct: 98.2, aadtPct: 60.3, liveSource: null, aadtSource: "ALDOT TDM 2024-2025 AADT (state highways)",
    dotName: "Huntsville Traffic Engineering Department", planningOfficeName: "Huntsville City Planning Division",
    parkingCodeCitation: "Huntsville Zoning Ordinance, Article 7 — Off-Street Parking and Loading." },
  { code: "mobile_metro", slug: "mobile", shortName: "Mobile", longName: "Mobile MSA", state: "AL", signals: 900, namedPct: 95.9, aadtPct: 87.9, liveSource: null, aadtSource: "ALDOT TDM 2024-2025 AADT",
    dotName: "City of Mobile Public Works", planningOfficeName: "Mobile City Planning Department",
    parkingCodeCitation: "Mobile Zoning Ordinance, Section 64-9 — Off-Street Parking." },

  // SC
  { code: "charleston_sc_metro", slug: "charleston-sc", shortName: "Charleston", longName: "Charleston (SC) MSA", state: "SC", signals: 806, namedPct: 97.1, aadtPct: 69.4, liveSource: null, aadtSource: "SCDOT 2017 counts",
    dotName: "City of Charleston Department of Traffic and Transportation",
    planningOfficeName: "Berkeley-Charleston-Dorchester Council of Governments (BCDCOG)",
    parkingCodeCitation: "Charleston Zoning Ordinance, Article 8 — Off-Street Parking and Loading." },
  { code: "columbia_sc_metro", slug: "columbia-sc", shortName: "Columbia", longName: "Columbia (SC) MSA", state: "SC", signals: 976, namedPct: 99.4, aadtPct: 80.9, liveSource: null, aadtSource: "SCDOT 2017 counts",
    dotName: "City of Columbia Engineering Services", planningOfficeName: "Central Midlands Council of Governments (CMCOG)",
    parkingCodeCitation: "Columbia Land Development Code, Section 17-265 — Parking." },

  // VA
  { code: "hampton_roads_metro", slug: "hampton-roads", shortName: "Hampton Roads", longName: "Hampton Roads MSA", state: "VA", signals: 4676, namedPct: 99.6, aadtPct: 94.2, liveSource: null, aadtSource: "VDOT 2024 Bidirectional ADT",
    dotName: "Virginia DOT Hampton Roads District", planningOfficeName: "Hampton Roads Transportation Planning Organization",
    parkingCodeCitation: "Norfolk Zoning Ordinance, Chapter 14 — Parking and Loading (jurisdiction varies by city)." },
  { code: "richmond_metro", slug: "richmond", shortName: "Richmond", longName: "Richmond MSA", state: "VA", signals: 3522, namedPct: 100.0, aadtPct: 97.0, liveSource: null, aadtSource: "VDOT 2024 Bidirectional ADT",
    dotName: "Richmond Department of Public Works", planningOfficeName: "Richmond Department of Planning and Development Review",
    parkingCodeCitation: "Richmond Zoning Ordinance, Article VII — Off-Street Parking and Loading." },

  // KY
  { code: "lexington_metro", slug: "lexington", shortName: "Lexington", longName: "Lexington-Fayette MSA", state: "KY", signals: 978, namedPct: 99.9, aadtPct: 48.4, liveSource: null, aadtSource: "KYTC Traffic Section AADT (state highways)",
    dotName: "Lexington-Fayette Urban County Government Traffic Engineering", planningOfficeName: "Lexington Division of Planning",
    parkingCodeCitation: "Lexington-Fayette Urban County Government Zoning Ordinance, Article 16 — Parking." },
  { code: "louisville_metro", slug: "louisville", shortName: "Louisville", longName: "Louisville MSA", state: "KY", signals: 1461, namedPct: 98.6, aadtPct: 74.7, liveSource: "KYTC closures", aadtSource: "KYTC Traffic Section AADT (state-system; 0.3pp below Tier-A)",
    dotName: "Louisville Metro Department of Public Works", planningOfficeName: "Louisville Metro Office of Planning",
    parkingCodeCitation: "Louisville Metro Land Development Code, Chapter 9 — Parking." },

  // LA
  { code: "new_orleans_metro", slug: "new-orleans", shortName: "New Orleans", longName: "New Orleans MSA", state: "LA", signals: 1979, namedPct: 98.3, aadtPct: 41.8, liveSource: null, aadtSource: "RPC SE Louisiana (RPC + DOTD, state highways)",
    dotName: "New Orleans Department of Public Works", planningOfficeName: "Regional Planning Commission of Southeast Louisiana",
    parkingCodeCitation: "New Orleans Comprehensive Zoning Ordinance, Article 22 — Off-Street Parking." },

  // ── Tier-4: Coast + Midwest + Westward (signal counts pending extraction) ──
  // DC
  { code: "washington_dc_metro", slug: "washington-dc", shortName: "Washington DC", longName: "Washington-Arlington-Alexandria MSA", state: "DC", signals: 2741, namedPct: 99.7, aadtPct: 99.3, liveSource: null, aadtSource: "DDOT 2023 Traffic Volume",
    dotName: "District Department of Transportation (DDOT)", planningOfficeName: "DC Office of Planning",
    parkingCodeCitation: "DC Zoning Regulations, Subtitle C, Chapter 7 — Off-Street Parking." },
  // MD
  { code: "baltimore_metro", slug: "baltimore", shortName: "Baltimore", longName: "Baltimore-Columbia-Towson MSA", state: "MD", signals: 4770, namedPct: 99.7, aadtPct: 92.7, liveSource: "MD CHART", aadtSource: "MDOT-SHA 2023 AADT segments",
    dotName: "Baltimore City DOT", planningOfficeName: "Baltimore Department of Planning",
    parkingCodeCitation: "Baltimore City Zoning Code, Title 16 — Parking and Loading." },
  // PA
  { code: "philadelphia_metro", slug: "philadelphia", shortName: "Philadelphia", longName: "Philadelphia MSA", state: "PA", signals: 8449, namedPct: 96.5, aadtPct: 93.1, liveSource: null, aadtSource: "PennDOT RMS Traffic Volumes",
    dotName: "Philadelphia Streets Department", planningOfficeName: "Philadelphia City Planning Commission",
    parkingCodeCitation: "Philadelphia Zoning Code, Chapter 14-800 — Parking and Loading." },
  { code: "pittsburgh_metro", slug: "pittsburgh", shortName: "Pittsburgh", longName: "Pittsburgh MSA", state: "PA", signals: 2973, namedPct: 99.2, aadtPct: 93.7, liveSource: null, aadtSource: "PennDOT RMS Traffic Volumes",
    dotName: "Pittsburgh Department of Mobility and Infrastructure (DOMI)", planningOfficeName: "Pittsburgh Department of City Planning",
    parkingCodeCitation: "Pittsburgh Zoning Code, Chapter 914 — Parking, Loading and Access." },
  // NY
  { code: "new_york_metro", slug: "new-york", shortName: "New York", longName: "New York-Newark-Jersey City MSA", state: "NY", signals: 24004, namedPct: 90.7, aadtPct: 97.8, liveSource: null,
    dotName: "New York City Department of Transportation (NYC DOT)", planningOfficeName: "NYC Department of City Planning",
    parkingCodeCitation: "NYC Zoning Resolution, Article I, Chapter 3 — Off-Street Parking.",
    aadtSource: "NYSDOT TDV AADT 2019 (per-borough)" },
  // MA
  { code: "boston_metro", slug: "boston", shortName: "Boston", longName: "Boston-Cambridge-Newton MSA", state: "MA", signals: 7815, namedPct: 99.8, aadtPct: 96.9, liveSource: null, aadtSource: "MassDOT 2024 Traffic Inventory",
    dotName: "Boston Transportation Department (BTD)", planningOfficeName: "Boston Planning & Development Agency (BPDA)",
    parkingCodeCitation: "Boston Zoning Code, Article 23 — Off-Street Parking and Loading." },
  // IL
  { code: "chicago_metro", slug: "chicago", shortName: "Chicago", longName: "Chicago-Naperville-Elgin MSA", state: "IL", signals: 13305, namedPct: 99.0, aadtPct: 97.4, liveSource: null,
    dotName: "Chicago Department of Transportation (CDOT)", planningOfficeName: "Chicago Department of Planning and Development",
    parkingCodeCitation: "Chicago Zoning Ordinance, Section 17-10 — Off-Street Parking and Loading.",
    aadtSource: "IDOT 2020 Annual Average Daily Traffic" },
  // MI
  { code: "detroit_metro", slug: "detroit", shortName: "Detroit", longName: "Detroit-Warren-Dearborn MSA", state: "MI", signals: 7041, namedPct: 98.7, aadtPct: 75.3, liveSource: null,
    dotName: "Detroit Department of Public Works", planningOfficeName: "Detroit Planning and Development Department",
    parkingCodeCitation: "Detroit Zoning Ordinance, Chapter 61, Article XIV — Parking.",
    aadtSource: "MDOT 2023 Traffic Volumes" },
  // MN
  { code: "twin_cities_metro", slug: "twin-cities", shortName: "Twin Cities", longName: "Minneapolis-St. Paul-Bloomington MSA", state: "MN", signals: 6504, namedPct: 98.3, aadtPct: 96.4, liveSource: null,
    dotName: "Minneapolis Department of Public Works / St. Paul Public Works", planningOfficeName: "Metropolitan Council (Twin Cities regional planning)",
    parkingCodeCitation: "Minneapolis Code of Ordinances, Title 20, Chapter 541 — Off-Street Parking.",
    aadtSource: "MnDOT AADT Segments Current" },
  // OH
  { code: "cleveland_metro", slug: "cleveland", shortName: "Cleveland", longName: "Cleveland-Elyria MSA", state: "OH", signals: 3475, namedPct: 98.9, aadtPct: 95.9, liveSource: null, aadtSource: "ODOT 2024 Traffic Count Segments",
    dotName: "Cleveland Division of Traffic Engineering", planningOfficeName: "Cleveland City Planning Commission",
    parkingCodeCitation: "Cleveland Codified Ordinances, Title VII, Chapter 349 — Off-Street Parking." },
  { code: "columbus_oh_metro", slug: "columbus-oh", shortName: "Columbus (OH)", longName: "Columbus (OH) MSA", state: "OH", signals: 2551, namedPct: 99.0, aadtPct: 95.8, liveSource: null, aadtSource: "ODOT 2024 Traffic Count Segments",
    dotName: "Columbus Division of Traffic Management", planningOfficeName: "Columbus Department of Development, Planning Division",
    parkingCodeCitation: "Columbus City Codes, Chapter 3312 — Off-Street Parking and Loading." },
  { code: "cincinnati_metro", slug: "cincinnati", shortName: "Cincinnati", longName: "Cincinnati MSA", state: "OH", signals: 2632, namedPct: 98.4, aadtPct: 98.6, liveSource: null, aadtSource: "ODOT 2024 Traffic Count Segments",
    dotName: "Cincinnati Department of Transportation and Engineering (DOTE)", planningOfficeName: "Cincinnati City Planning Commission",
    parkingCodeCitation: "Cincinnati Zoning Code, Chapter 1425 — Off-Street Parking." },
  // IN
  { code: "indianapolis_metro", slug: "indianapolis", shortName: "Indianapolis", longName: "Indianapolis-Carmel-Anderson MSA", state: "IN", signals: 3745, namedPct: 99.1, aadtPct: 85.0, liveSource: null, aadtSource: "INDOT 2021 AADT segments",
    dotName: "Indianapolis Department of Public Works", planningOfficeName: "Indianapolis Department of Metropolitan Development",
    parkingCodeCitation: "Indianapolis-Marion County Code, Chapter 743 — Off-Street Parking." },
  // MO
  { code: "st_louis_metro", slug: "st-louis", shortName: "St. Louis", longName: "St. Louis MSA", state: "MO", signals: 3581, namedPct: 97.6, aadtPct: 22.6, liveSource: "MoDOT WZDx", aadtSource: "MoDOT Directional AADT (state highways)",
    dotName: "St. Louis Streets Department", planningOfficeName: "St. Louis Planning and Urban Design Agency",
    parkingCodeCitation: "St. Louis Revised Code, Title 26, Chapter 26.68 — Off-Street Parking." },
  { code: "kansas_city_metro", slug: "kansas-city", shortName: "Kansas City", longName: "Kansas City MSA", state: "MO", signals: 2086, namedPct: 94.4, aadtPct: 26.4, liveSource: "MoDOT WZDx", aadtSource: "MoDOT Directional AADT (state highways)",
    dotName: "Kansas City Public Works Department", planningOfficeName: "Kansas City Department of City Planning & Development",
    parkingCodeCitation: "Kansas City Code of Ordinances, Chapter 88-420 — Off-Street Parking." },
  // WI
  { code: "milwaukee_metro", slug: "milwaukee", shortName: "Milwaukee", longName: "Milwaukee-Waukesha MSA", state: "WI", signals: 4621, namedPct: 99.9, aadtPct: 97.7, liveSource: null,
    dotName: "Milwaukee Department of Public Works", planningOfficeName: "Milwaukee Department of City Development",
    parkingCodeCitation: "Milwaukee Code of Ordinances, Chapter 295-403 — Off-Street Parking and Loading.",
    aadtSource: "WisDOT Traffic Counts" },
  // TX
  { code: "houston_metro", slug: "houston", shortName: "Houston", longName: "Houston-The Woodlands-Sugar Land MSA", state: "TX", signals: 14498, namedPct: 99.4, aadtPct: 99.4, liveSource: "TxDOT DriveTexas", aadtSource: "TxDOT current AADT",
    dotName: "Houston Public Works (Traffic Operations)", planningOfficeName: "Houston Planning & Development Department",
    parkingCodeCitation: "Houston Code of Ordinances, Chapter 26, Article VIII — Off-Street Parking." },
  { code: "dallas_fort_worth_metro", slug: "dallas-fort-worth", shortName: "Dallas-Fort Worth", longName: "Dallas-Fort Worth-Arlington MSA", state: "TX", signals: 15796, namedPct: 99.9, aadtPct: 99.6, liveSource: "TxDOT DriveTexas", aadtSource: "TxDOT current AADT",
    dotName: "Dallas DOT / Fort Worth Transportation & Public Works", planningOfficeName: "North Central Texas Council of Governments (NCTCOG)",
    parkingCodeCitation: "Dallas Development Code, Article VIII, Division 51A-4.300 — Off-Street Parking." },
  { code: "austin_metro", slug: "austin", shortName: "Austin", longName: "Austin-Round Rock-Georgetown MSA", state: "TX", signals: 2932, namedPct: 98.8, aadtPct: 99.3, liveSource: "TxDOT DriveTexas", aadtSource: "TxDOT current AADT",
    dotName: "Austin Transportation and Public Works (TPW)", planningOfficeName: "Austin Planning Department",
    parkingCodeCitation: "Austin Land Development Code, Chapter 25-6 — Transportation, Subchapter D — Parking." },
  { code: "san_antonio_metro", slug: "san-antonio", shortName: "San Antonio", longName: "San Antonio-New Braunfels MSA", state: "TX", signals: 3374, namedPct: 99.7, aadtPct: 99.4, liveSource: "TxDOT DriveTexas", aadtSource: "TxDOT current AADT",
    dotName: "San Antonio Public Works Department", planningOfficeName: "San Antonio Planning Department",
    parkingCodeCitation: "San Antonio Unified Development Code, Article V, Section 35-526 — Off-Street Parking." },

  // ── Tier-5: West Coast + Mountain West (signal counts pending extraction) ──
  // CA
  { code: "los_angeles_metro", slug: "los-angeles", shortName: "Los Angeles", longName: "Los Angeles-Long Beach-Anaheim MSA", state: "CA", signals: 30933, namedPct: 99.9, aadtPct: 21.8, liveSource: null,
    dotName: "Los Angeles Department of Transportation (LADOT)", planningOfficeName: "Los Angeles Department of City Planning",
    parkingCodeCitation: "LA Municipal Code, Chapter 1, Article 2, Section 12.21-A — Off-Street Parking.",
    aadtSource: "Caltrans Traffic Census" },
  { code: "sf_bay_metro", slug: "sf-bay", shortName: "SF Bay", longName: "San Francisco-Oakland-San Jose CSA", state: "CA", signals: 15751, namedPct: 99.3, aadtPct: 29.5, liveSource: null,
    dotName: "San Francisco Municipal Transportation Agency (SFMTA)", planningOfficeName: "San Francisco Planning Department",
    parkingCodeCitation: "SF Planning Code, Article 1.5, Section 151 — Off-Street Parking and Loading.",
    aadtSource: "Caltrans Traffic Census" },
  { code: "san_diego_metro", slug: "san-diego", shortName: "San Diego", longName: "San Diego-Chula Vista-Carlsbad MSA", state: "CA", signals: 10246, namedPct: 99.9, aadtPct: 25.0, liveSource: null,
    dotName: "City of San Diego Transportation Department", planningOfficeName: "City of San Diego Planning Department",
    parkingCodeCitation: "San Diego Municipal Code, Chapter 14, Article 2, Division 5 — Parking Regulations.",
    aadtSource: "Caltrans Traffic Census" },
  { code: "sacramento_metro", slug: "sacramento", shortName: "Sacramento", longName: "Sacramento-Roseville-Folsom MSA", state: "CA", signals: 4428, namedPct: 99.5, aadtPct: 15.9, liveSource: null,
    dotName: "Sacramento Department of Public Works", planningOfficeName: "Sacramento Community Development Department",
    parkingCodeCitation: "Sacramento City Code, Title 17, Chapter 17.608 — Off-Street Parking.",
    aadtSource: "Caltrans Traffic Census" },
  { code: "inland_empire_metro", slug: "inland-empire", shortName: "Inland Empire", longName: "Riverside-San Bernardino-Ontario MSA", state: "CA", signals: 12141, namedPct: 99.9, aadtPct: 19.6, liveSource: null,
    dotName: "Riverside County Transportation / SB County Public Works", planningOfficeName: "Western Riverside COG (WRCOG) / SBCOG",
    parkingCodeCitation: "Riverside Municipal Code, Chapter 19.580 — Parking; SB Development Code, Chapter 83.11 — Parking.",
    aadtSource: "Caltrans Traffic Census" },
  { code: "fresno_metro", slug: "fresno", shortName: "Fresno", longName: "Fresno MSA", state: "CA", signals: 1887, namedPct: 100.0, aadtPct: 22.4, liveSource: null,
    dotName: "City of Fresno Public Works Department", planningOfficeName: "Fresno Development and Resource Management Department",
    parkingCodeCitation: "Fresno Municipal Code, Article 14 — Off-Street Parking and Loading.",
    aadtSource: "Caltrans Traffic Census" },
  // OR
  { code: "portland_metro", slug: "portland", shortName: "Portland", longName: "Portland-Vancouver-Hillsboro MSA", state: "OR", signals: 3333, namedPct: 99.1, aadtPct: 44.1, liveSource: "ODOT-OR TripCheck", aadtSource: "ODOT-OR 2024 Traffic Flow (state highways)",
    dotName: "Portland Bureau of Transportation (PBOT)", planningOfficeName: "Portland Bureau of Planning and Sustainability",
    parkingCodeCitation: "Portland Zoning Code, Chapter 33.266 — Parking and Loading." },
  // WA
  { code: "seattle_metro", slug: "seattle", shortName: "Seattle", longName: "Seattle-Tacoma-Bellevue MSA", state: "WA", signals: 4770, namedPct: 98.8, aadtPct: 38.8, liveSource: null, aadtSource: "WSDOT 2024 Traffic Sections (state highways)",
    dotName: "Seattle Department of Transportation (SDOT)", planningOfficeName: "Seattle Office of Planning and Community Development",
    parkingCodeCitation: "Seattle Municipal Code, Chapter 23.54 — Off-Street Parking." },
  // NV
  { code: "las_vegas_metro", slug: "las-vegas", shortName: "Las Vegas", longName: "Las Vegas-Henderson-Paradise MSA", state: "NV", signals: 5698, namedPct: 99.8, aadtPct: 70.5, liveSource: null, aadtSource: "NDOT TRINA 2024 AADT",
    dotName: "City of Las Vegas Department of Public Works", planningOfficeName: "City of Las Vegas Department of Planning",
    parkingCodeCitation: "Las Vegas Municipal Code, Title 19.08 — Off-Street Parking and Loading." },
  // AZ
  { code: "phoenix_metro", slug: "phoenix", shortName: "Phoenix", longName: "Phoenix-Mesa-Chandler MSA", state: "AZ", signals: 7977, namedPct: 99.8, aadtPct: 98.1, liveSource: "ADOT Traffic Events", aadtSource: "ADOT 2024 AADT",
    dotName: "City of Phoenix Street Transportation Department", planningOfficeName: "City of Phoenix Planning and Development Department",
    parkingCodeCitation: "Phoenix Zoning Ordinance, Section 702 — Off-Street Parking Requirements." },
  { code: "tucson_metro", slug: "tucson", shortName: "Tucson", longName: "Tucson MSA", state: "AZ", signals: 1950, namedPct: 100.0, aadtPct: 99.0, liveSource: "ADOT Traffic Events", aadtSource: "ADOT 2024 AADT",
    dotName: "City of Tucson Department of Transportation and Mobility", planningOfficeName: "Tucson Planning and Development Services Department",
    parkingCodeCitation: "Tucson Unified Development Code, Section 7.4.4 — Vehicle Parking and Loading." },
  // CO
  { code: "denver_metro", slug: "denver", shortName: "Denver", longName: "Denver-Aurora-Centennial MSA", state: "CO", signals: 7700, namedPct: 99.3, aadtPct: 32.6, liveSource: null, aadtSource: "CDOT-CO OTIS 2024 (state highways)",
    dotName: "Denver Department of Transportation and Infrastructure (DOTI)", planningOfficeName: "Denver Community Planning and Development",
    parkingCodeCitation: "Denver Zoning Code, Article 10 — Parking and Loading." },
  // UT
  { code: "salt_lake_city_metro", slug: "salt-lake-city", shortName: "Salt Lake City", longName: "Salt Lake City-West Valley City-Murray MSA", state: "UT", signals: 2887, namedPct: 99.4, aadtPct: 94.9, liveSource: null, aadtSource: "UDOT 2024 AADT",
    dotName: "Salt Lake City Transportation Division", planningOfficeName: "Salt Lake City Planning Division",
    parkingCodeCitation: "Salt Lake City Zoning Ordinance, Section 21A.44 — Off-Street Parking, Mobility, and Loading." },
  // NM
  { code: "albuquerque_metro", slug: "albuquerque", shortName: "Albuquerque", longName: "Albuquerque MSA", state: "NM", signals: 1939, namedPct: 99.7, aadtPct: 97.8, liveSource: "NMDOT Public Incidents", aadtSource: "NMDOT 2024 HPMS",
    dotName: "Albuquerque Department of Municipal Development", planningOfficeName: "Albuquerque Planning Department",
    parkingCodeCitation: "Albuquerque Integrated Development Ordinance (IDO), Section 14-16-5-5 — Parking and Loading." },

  // ── Tier-6: 50-state coverage push (signal counts pending extraction) ──
  // CT
  { code: "hartford_metro", slug: "hartford", shortName: "Hartford", longName: "Hartford-East Hartford-Middletown MSA", state: "CT", signals: 2339, namedPct: 99.6, aadtPct: 96.9, liveSource: null, aadtSource: "CTDOT Traffic Monitoring",
    dotName: "Hartford Department of Public Works", planningOfficeName: "Hartford Department of Development Services",
    parkingCodeCitation: "Hartford Zoning Regulations, Article 7 — Off-Street Parking and Loading." },
  // RI
  { code: "providence_metro", slug: "providence", shortName: "Providence", longName: "Providence-Warwick MSA", state: "RI", signals: 1319, namedPct: 100.0, aadtPct: 47.2, liveSource: null, aadtSource: "RIDOT Traffic Counts (sparse, mixed vintage)",
    dotName: "Providence Department of Public Works", planningOfficeName: "Providence Department of Planning and Development",
    parkingCodeCitation: "Providence Zoning Ordinance, Article 14 — Parking and Loading." },
  // NH
  { code: "manchester_metro", slug: "manchester", shortName: "Manchester", longName: "Manchester-Nashua MSA", state: "NH", signals: 1023, namedPct: 98.1, aadtPct: 99.9, liveSource: null, aadtSource: "NHDOT HPMS 2024 AADT",
    dotName: "City of Manchester Highway Department", planningOfficeName: "Manchester Planning and Community Development Department",
    parkingCodeCitation: "Manchester Zoning Ordinance, Article 8 — Parking and Loading." },
  // VT
  { code: "burlington_vt_metro", slug: "burlington-vt", shortName: "Burlington (VT)", longName: "Burlington-South Burlington MSA", state: "VT", signals: 237, namedPct: 100.0, aadtPct: 96.6, liveSource: null, aadtSource: "VTrans 2024 AADT",
    dotName: "Burlington Department of Public Works", planningOfficeName: "Burlington Planning and Zoning Department",
    parkingCodeCitation: "Burlington Comprehensive Development Ordinance, Article 8 — Parking and Transportation Demand Management." },
  // ME
  { code: "portland_me_metro", slug: "portland-me", shortName: "Portland (ME)", longName: "Portland-South Portland MSA", state: "ME", signals: 829, namedPct: 100.0, aadtPct: 100.0, liveSource: null, aadtSource: "MaineDOT AADT",
    dotName: "City of Portland Department of Public Works", planningOfficeName: "Portland Department of Planning and Urban Development",
    parkingCodeCitation: "Portland Land Use Ordinance, Chapter 14, Section 14-332 — Off-Street Parking." },
  // NJ
  { code: "trenton_metro", slug: "trenton", shortName: "Trenton", longName: "Trenton-Princeton MSA", state: "NJ", signals: 862, namedPct: 94.9, aadtPct: 46.5, liveSource: null, aadtSource: "NJDOT current AADT (state routes only)",
    dotName: "Trenton Department of Public Works", planningOfficeName: "Trenton Department of Housing and Economic Development",
    parkingCodeCitation: "Trenton Land Development Ordinance, Chapter 315 — Parking, Loading and Driveways." },
  // WV
  { code: "charleston_wv_metro", slug: "charleston-wv", shortName: "Charleston (WV)", longName: "Charleston (WV) MSA", state: "WV", signals: 439, namedPct: 98.6, aadtPct: 95.7, liveSource: null, aadtSource: "WVDOT Segment AADT",
    dotName: "Charleston Department of Public Works", planningOfficeName: "Charleston Planning Department",
    parkingCodeCitation: "Charleston Zoning Ordinance, Article 1135 — Off-Street Parking." },
  // MS
  { code: "jackson_ms_metro", slug: "jackson-ms", shortName: "Jackson (MS)", longName: "Jackson (MS) MSA", state: "MS", signals: 599, namedPct: 98.7, aadtPct: 0, liveSource: null,
    dotName: "Jackson Department of Public Works", planningOfficeName: "Jackson Department of Planning and Development",
    parkingCodeCitation: "Jackson Zoning Ordinance, Article 18 — Off-Street Parking and Loading." },
  // AR
  { code: "little_rock_metro", slug: "little-rock", shortName: "Little Rock", longName: "Little Rock-North Little Rock-Conway MSA", state: "AR", signals: 680, namedPct: 99.7, aadtPct: 0, liveSource: null,
    dotName: "Little Rock Department of Public Works", planningOfficeName: "Little Rock Department of Planning and Development",
    parkingCodeCitation: "Little Rock Zoning Ordinance, Section 36 — Off-Street Parking." },
  // OK
  { code: "oklahoma_city_metro", slug: "oklahoma-city", shortName: "Oklahoma City", longName: "Oklahoma City MSA", state: "OK", signals: 2994, namedPct: 99.9, aadtPct: 87.8, liveSource: null, aadtSource: "ODOT-OK AADT Network",
    dotName: "Oklahoma City Public Works Department", planningOfficeName: "Oklahoma City Planning Department",
    parkingCodeCitation: "Oklahoma City Municipal Code, Title 25, Chapter 59 — Off-Street Parking and Loading." },
  { code: "tulsa_metro", slug: "tulsa", shortName: "Tulsa", longName: "Tulsa MSA", state: "OK", signals: 2785, namedPct: 99.9, aadtPct: 95.2, liveSource: null, aadtSource: "ODOT-OK AADT Network",
    dotName: "City of Tulsa Engineering Services", planningOfficeName: "Tulsa Planning Office",
    parkingCodeCitation: "Tulsa Zoning Code, Chapter 65 — Off-Street Parking." },
  // IA
  { code: "des_moines_metro", slug: "des-moines", shortName: "Des Moines", longName: "Des Moines-West Des Moines MSA", state: "IA", signals: 1738, namedPct: 100.0, aadtPct: 100.0, liveSource: null, aadtSource: "Iowa DOT RAMS AADT",
    dotName: "Des Moines Public Works Department", planningOfficeName: "Des Moines Department of Development Services",
    parkingCodeCitation: "Des Moines Municipal Code, Chapter 134 — Zoning, Article XV — Parking and Loading." },
  // NE
  { code: "omaha_metro", slug: "omaha", shortName: "Omaha", longName: "Omaha-Council Bluffs MSA", state: "NE", signals: 2658, namedPct: 99.8, aadtPct: 53.4, liveSource: null, aadtSource: "Nebraska DOT AADT Points",
    dotName: "Omaha Public Works Department", planningOfficeName: "Omaha Planning Department",
    parkingCodeCitation: "Omaha Municipal Code, Chapter 55 — Zoning, Article XV — Parking and Loading." },
  // KS
  { code: "wichita_metro", slug: "wichita", shortName: "Wichita", longName: "Wichita MSA", state: "KS", signals: 766, namedPct: 100.0, aadtPct: 28.7, liveSource: null, aadtSource: "KSDOT AADT Flow Map (state system)",
    dotName: "Wichita Department of Public Works", planningOfficeName: "Wichita-Sedgwick County Metropolitan Area Planning Department",
    parkingCodeCitation: "Wichita-Sedgwick County Unified Zoning Code, Section IV-A — Off-Street Parking and Loading." },
  // ND
  { code: "fargo_metro", slug: "fargo", shortName: "Fargo", longName: "Fargo MSA", state: "ND", signals: 401, namedPct: 99.5, aadtPct: 95.8, liveSource: null, aadtSource: "NDDOT Traffic Counts",
    dotName: "Fargo Engineering Department", planningOfficeName: "Fargo Planning and Development Department",
    parkingCodeCitation: "Fargo Land Development Code, Article 20-0700 — Parking and Loading." },
  // SD
  { code: "sioux_falls_metro", slug: "sioux-falls", shortName: "Sioux Falls", longName: "Sioux Falls MSA", state: "SD", signals: 611, namedPct: 100.0, aadtPct: 19.8, liveSource: null, aadtSource: "SDDOT State Trunk AADT (2021)",
    dotName: "Sioux Falls Public Works Department", planningOfficeName: "Sioux Falls Planning and Development Services",
    parkingCodeCitation: "Sioux Falls Shape Places Zoning Ordinance, Section 161.083 — Parking and Loading." },
  // ID
  { code: "boise_metro", slug: "boise", shortName: "Boise", longName: "Boise City MSA", state: "ID", signals: 617, namedPct: 100.0, aadtPct: 98.4, liveSource: null, aadtSource: "ITD LRS AADT",
    dotName: "Ada County Highway District (ACHD)", planningOfficeName: "Boise Planning and Development Services",
    parkingCodeCitation: "Boise City Code, Title 11, Chapter 11-04 — Off-Street Parking." },
  // MT
  { code: "billings_metro", slug: "billings", shortName: "Billings", longName: "Billings MT MSA", state: "MT", signals: 208, namedPct: 100.0, aadtPct: 98.1, liveSource: null, aadtSource: "MDT 2025 AADT Counts",
    dotName: "Billings Public Works Department", planningOfficeName: "Billings Community Planning and Community Services",
    parkingCodeCitation: "Billings City Code, Chapter 27, Article XIII — Off-Street Parking." },
  // WY
  { code: "cheyenne_metro", slug: "cheyenne", shortName: "Cheyenne", longName: "Cheyenne MSA", state: "WY", signals: 167, namedPct: 100.0, aadtPct: 97.0, liveSource: null, aadtSource: "WYDOT ITSM AADT (2022)",
    dotName: "Cheyenne Public Works Department", planningOfficeName: "Cheyenne Planning and Development Office",
    parkingCodeCitation: "Cheyenne Unified Development Code, Section 5-8 — Off-Street Parking." },
  // AK
  { code: "anchorage_metro", slug: "anchorage", shortName: "Anchorage", longName: "Anchorage Municipality", state: "AK", signals: 548, namedPct: 99.3, aadtPct: 95.4, liveSource: null, aadtSource: "AKDOT TrafficLinks AADT",
    dotName: "Anchorage Department of Public Works", planningOfficeName: "Anchorage Planning Department",
    parkingCodeCitation: "Anchorage Municipal Code, Title 21, Chapter 21.07.090 — Off-Street Parking." },
  // HI
  { code: "honolulu_metro", slug: "honolulu", shortName: "Honolulu", longName: "Urban Honolulu MSA", state: "HI", signals: 809, namedPct: 98.9, aadtPct: 97.9, liveSource: null, aadtSource: "HIDOT HPMS 2024 Traffic Volume",
    dotName: "Honolulu Department of Transportation Services", planningOfficeName: "Honolulu Department of Planning and Permitting",
    parkingCodeCitation: "Honolulu Land Use Ordinance, Chapter 21, Article 6 — Off-Street Parking and Loading." },

  // ── Tier-7: depth push (55 secondary metros, signal counts pending extraction) ──
  // NY (4)
  { code: "rochester_ny_metro", slug: "rochester-ny", shortName: "Rochester (NY)", longName: "Rochester (NY) MSA", state: "NY", signals: 1105, namedPct: 99.6, aadtPct: 94.8, liveSource: null, aadtSource: "NYSDOT Traffic Monitoring", dotName: "Rochester Department of Environmental Services", planningOfficeName: "Rochester Bureau of Planning and Zoning", parkingCodeCitation: "Rochester City Code, Chapter 120, Article XII — Off-Street Parking." },
  { code: "buffalo_metro", slug: "buffalo", shortName: "Buffalo", longName: "Buffalo-Cheektowaga-Niagara Falls MSA", state: "NY", signals: 1402, namedPct: 99.2, aadtPct: 98.9, liveSource: null, aadtSource: "NYSDOT Traffic Monitoring", dotName: "Buffalo Department of Public Works", planningOfficeName: "Buffalo Office of Strategic Planning", parkingCodeCitation: "Buffalo Unified Development Ordinance, Section 9.3 — Off-Street Parking." },
  { code: "syracuse_metro", slug: "syracuse", shortName: "Syracuse", longName: "Syracuse MSA", state: "NY", signals: 1049, namedPct: 98.9, aadtPct: 95.0, liveSource: null, aadtSource: "NYSDOT Traffic Monitoring", dotName: "Syracuse Department of Public Works", planningOfficeName: "Syracuse Bureau of Planning and Sustainability", parkingCodeCitation: "Syracuse Zoning Rules and Regulations, Section IV.D — Parking." },
  { code: "albany_metro", slug: "albany", shortName: "Albany", longName: "Albany-Schenectady-Troy MSA", state: "NY", signals: 1370, namedPct: 97.4, aadtPct: 97.7, liveSource: null, aadtSource: "NYSDOT Traffic Monitoring", dotName: "Albany Department of General Services", planningOfficeName: "Albany Department of Planning and Development", parkingCodeCitation: "Albany Unified Sustainable Development Ordinance, Article III — Parking." },
  // OH (4)
  { code: "toledo_metro", slug: "toledo", shortName: "Toledo", longName: "Toledo MSA", state: "OH", signals: 990, namedPct: 99.3, aadtPct: 99.3, liveSource: null, aadtSource: "ODOT 2024 Traffic Count Segments", dotName: "Toledo Division of Transportation", planningOfficeName: "Toledo Plan Commission", parkingCodeCitation: "Toledo Municipal Code, Chapter 1107 — Off-Street Parking." },
  { code: "akron_metro", slug: "akron", shortName: "Akron", longName: "Akron MSA", state: "OH", signals: 827, namedPct: 99.2, aadtPct: 99.2, liveSource: null, aadtSource: "ODOT 2024 Traffic Count Segments", dotName: "Akron Engineering Bureau", planningOfficeName: "Akron Planning Department", parkingCodeCitation: "Akron Codified Ordinances, Title 1, Chapter 153 — Off-Street Parking." },
  { code: "dayton_metro", slug: "dayton", shortName: "Dayton", longName: "Dayton-Kettering MSA", state: "OH", signals: 1100, namedPct: 98.6, aadtPct: 99.4, liveSource: null, aadtSource: "ODOT 2024 Traffic Count Segments", dotName: "Dayton Department of Public Works", planningOfficeName: "Dayton Department of Planning, Neighborhoods, and Development", parkingCodeCitation: "Dayton Land Development Code, Chapter 150-322 — Off-Street Parking." },
  { code: "youngstown_metro", slug: "youngstown", shortName: "Youngstown", longName: "Youngstown-Warren-Boardman MSA", state: "OH", signals: 618, namedPct: 98.5, aadtPct: 97.6, liveSource: null, aadtSource: "ODOT 2024 Traffic Count Segments", dotName: "Youngstown Public Works Department", planningOfficeName: "Youngstown City Planning Commission", parkingCodeCitation: "Youngstown Zoning Code, Chapter 1163 — Off-Street Parking." },
  // MI (4)
  { code: "grand_rapids_metro", slug: "grand-rapids", shortName: "Grand Rapids", longName: "Grand Rapids-Kentwood MSA", state: "MI", signals: 767, namedPct: 100.0, aadtPct: 98.7, liveSource: null, aadtSource: "MDOT-MI 2023 Traffic Volumes", dotName: "Grand Rapids Engineering Department", planningOfficeName: "Grand Rapids Planning Department", parkingCodeCitation: "Grand Rapids Zoning Ordinance, Chapter 61 — Off-Street Parking." },
  { code: "lansing_metro", slug: "lansing", shortName: "Lansing", longName: "Lansing-East Lansing MSA", state: "MI", signals: 394, namedPct: 99.5, aadtPct: 96.7, liveSource: null, aadtSource: "MDOT-MI 2023 Traffic Volumes", dotName: "Lansing Department of Public Service", planningOfficeName: "Lansing Planning Office", parkingCodeCitation: "Lansing Zoning Ordinance, Chapter 1290 — Parking." },
  { code: "ann_arbor_metro", slug: "ann-arbor", shortName: "Ann Arbor", longName: "Ann Arbor MSA", state: "MI", signals: 435, namedPct: 98.6, aadtPct: 93.3, liveSource: null, aadtSource: "MDOT-MI 2023 Traffic Volumes", dotName: "Ann Arbor Public Services Department", planningOfficeName: "Ann Arbor Planning Services", parkingCodeCitation: "Ann Arbor Unified Development Code, Section 5.16 — Parking." },
  { code: "flint_metro", slug: "flint", shortName: "Flint", longName: "Flint MSA", state: "MI", signals: 389, namedPct: 99.5, aadtPct: 94.9, liveSource: null, aadtSource: "MDOT-MI 2023 Traffic Volumes", dotName: "Flint Department of Public Works", planningOfficeName: "Flint Department of Planning and Development", parkingCodeCitation: "Flint Zoning Ordinance, Article 50-22 — Off-Street Parking." },
  // PA (4)
  { code: "allentown_metro", slug: "allentown", shortName: "Allentown", longName: "Allentown-Bethlehem-Easton MSA", state: "PA", signals: 992, namedPct: 97.2, aadtPct: 94.3, liveSource: null, aadtSource: "PennDOT RMS Traffic Volumes", dotName: "Allentown Public Works Department", planningOfficeName: "Allentown Planning Bureau", parkingCodeCitation: "Allentown Zoning Ordinance, Article 13 — Off-Street Parking." },
  { code: "harrisburg_metro", slug: "harrisburg", shortName: "Harrisburg", longName: "Harrisburg-Carlisle MSA", state: "PA", signals: 679, namedPct: 99.4, aadtPct: 98.4, liveSource: null, aadtSource: "PennDOT RMS Traffic Volumes", dotName: "Harrisburg Department of Public Works", planningOfficeName: "Harrisburg Bureau of Planning", parkingCodeCitation: "Harrisburg Zoning Code, Chapter 7-329 — Off-Street Parking." },
  { code: "scranton_metro", slug: "scranton", shortName: "Scranton", longName: "Scranton-Wilkes-Barre MSA", state: "PA", signals: 410, namedPct: 99.5, aadtPct: 92.9, liveSource: null, aadtSource: "PennDOT RMS Traffic Volumes", dotName: "Scranton Department of Public Works", planningOfficeName: "Scranton Office of Economic and Community Development", parkingCodeCitation: "Scranton Zoning Ordinance, Article VII — Off-Street Parking." },
  { code: "erie_metro", slug: "erie", shortName: "Erie", longName: "Erie MSA", state: "PA", signals: 404, namedPct: 99.8, aadtPct: 96.0, liveSource: null, aadtSource: "PennDOT RMS Traffic Volumes", dotName: "Erie Department of Public Works", planningOfficeName: "Erie Department of Planning", parkingCodeCitation: "Erie Zoning Ordinance, Section 209-71 — Off-Street Parking." },
  // MA (2)
  { code: "worcester_metro", slug: "worcester", shortName: "Worcester", longName: "Worcester MSA", state: "MA", signals: 537, namedPct: 99.6, aadtPct: 95.0, liveSource: null, aadtSource: "MassDOT 2024 Traffic Inventory", dotName: "Worcester Department of Public Works and Parks", planningOfficeName: "Worcester Division of Planning and Regulatory Services", parkingCodeCitation: "Worcester Zoning Ordinance, Article IV — Parking and Loading." },
  { code: "springfield_ma_metro", slug: "springfield-ma", shortName: "Springfield (MA)", longName: "Springfield (MA) MSA", state: "MA", signals: 390, namedPct: 99.7, aadtPct: 91.5, liveSource: null, aadtSource: "MassDOT 2024 Traffic Inventory", dotName: "Springfield Department of Public Works", planningOfficeName: "Springfield Office of Planning and Economic Development", parkingCodeCitation: "Springfield Zoning Ordinance, Article 7 — Off-Street Parking." },
  // CT (2)
  { code: "new_haven_metro", slug: "new-haven", shortName: "New Haven", longName: "New Haven-Milford MSA", state: "CT", signals: 1134, namedPct: 99.2, aadtPct: 99.6, liveSource: null, aadtSource: "CTDOT Traffic Monitoring", dotName: "New Haven Department of Public Works", planningOfficeName: "New Haven City Plan Department", parkingCodeCitation: "New Haven Zoning Ordinance, Article V, Section 29 — Off-Street Parking." },
  { code: "bridgeport_metro", slug: "bridgeport", shortName: "Bridgeport-Stamford", longName: "Bridgeport-Stamford-Norwalk MSA", state: "CT", signals: 1791, namedPct: 99.5, aadtPct: 99.1, liveSource: null, aadtSource: "CTDOT Traffic Monitoring", dotName: "Bridgeport Department of Public Facilities", planningOfficeName: "Bridgeport Planning and Economic Development Department", parkingCodeCitation: "Bridgeport Zoning Regulations, Section 12 — Off-Street Parking." },
  // IN (3)
  { code: "fort_wayne_metro", slug: "fort-wayne", shortName: "Fort Wayne", longName: "Fort Wayne MSA", state: "IN", signals: 757, namedPct: 99.2, aadtPct: 85.5, liveSource: null, aadtSource: "INDOT 2021 AADT segments", dotName: "Fort Wayne Public Works Division", planningOfficeName: "Fort Wayne Department of Planning Services", parkingCodeCitation: "Fort Wayne Unified Development Ordinance, Section 6.4 — Parking." },
  { code: "south_bend_metro", slug: "south-bend", shortName: "South Bend", longName: "South Bend-Mishawaka MSA", state: "IN", signals: 505, namedPct: 100.0, aadtPct: 95.0, liveSource: null, aadtSource: "INDOT 2021 AADT segments", dotName: "South Bend Department of Public Works", planningOfficeName: "South Bend Department of Community Investment", parkingCodeCitation: "South Bend Zoning Ordinance, Chapter 21-08 — Parking." },
  { code: "evansville_metro", slug: "evansville", shortName: "Evansville", longName: "Evansville MSA", state: "IN", signals: 419, namedPct: 93.3, aadtPct: 91.4, liveSource: null, aadtSource: "INDOT 2021 AADT segments", dotName: "Evansville Department of Transportation and Services", planningOfficeName: "Evansville Area Plan Commission", parkingCodeCitation: "Evansville Zoning Code, Chapter 18.155 — Off-Street Parking." },
  // WI (2)
  { code: "madison_metro", slug: "madison", shortName: "Madison", longName: "Madison MSA", state: "WI", signals: 1132, namedPct: 100.0, aadtPct: 81.4, liveSource: null, aadtSource: "WisDOT Traffic Counts", dotName: "Madison Traffic Engineering Division", planningOfficeName: "Madison Department of Planning, Community and Economic Development", parkingCodeCitation: "Madison General Ordinances, Section 28.141 — Parking." },
  { code: "green_bay_metro", slug: "green-bay", shortName: "Green Bay", longName: "Green Bay MSA", state: "WI", signals: 359, namedPct: 100.0, aadtPct: 98.9, liveSource: null, aadtSource: "WisDOT Traffic Counts", dotName: "Green Bay Department of Public Works", planningOfficeName: "Green Bay Department of Community and Economic Development", parkingCodeCitation: "Green Bay Zoning Ordinance, Section 13-1903 — Off-Street Parking." },
  // IL (4)
  { code: "springfield_il_metro", slug: "springfield-il", shortName: "Springfield (IL)", longName: "Springfield (IL) MSA", state: "IL", signals: 1450, namedPct: 98.6, aadtPct: 99.8, liveSource: null, aadtSource: "IDOT 2025 AADT", dotName: "Springfield Department of Public Works", planningOfficeName: "Springfield-Sangamon County Regional Planning Commission", parkingCodeCitation: "Springfield Zoning Ordinance, Chapter 155.103 — Off-Street Parking." },
  { code: "rockford_metro", slug: "rockford", shortName: "Rockford", longName: "Rockford MSA", state: "IL", signals: 536, namedPct: 98.5, aadtPct: 100.0, liveSource: null, aadtSource: "IDOT 2025 AADT", dotName: "Rockford Department of Public Works", planningOfficeName: "Rockford Community and Economic Development Department", parkingCodeCitation: "Rockford Zoning Ordinance, Article 9 — Off-Street Parking." },
  { code: "peoria_metro", slug: "peoria", shortName: "Peoria", longName: "Peoria MSA", state: "IL", signals: 571, namedPct: 100.0, aadtPct: 100.0, liveSource: null, aadtSource: "IDOT 2025 AADT", dotName: "Peoria Public Works Department", planningOfficeName: "Peoria Community Development Department", parkingCodeCitation: "Peoria Code of Ordinances, Appendix B, Section 6.5 — Off-Street Parking." },
  { code: "champaign_metro", slug: "champaign", shortName: "Champaign-Urbana", longName: "Champaign-Urbana MSA", state: "IL", signals: 354, namedPct: 100.0, aadtPct: 100.0, liveSource: null, aadtSource: "IDOT 2025 AADT", dotName: "Champaign Public Works Department", planningOfficeName: "Champaign Planning and Development Department", parkingCodeCitation: "Champaign Zoning Ordinance, Article VII — Off-Street Parking." },
  // TX (4)
  { code: "el_paso_metro", slug: "el-paso", shortName: "El Paso", longName: "El Paso MSA", state: "TX", signals: 1549, namedPct: 99.9, aadtPct: 95.5, liveSource: "TxDOT DriveTexas", aadtSource: "TxDOT current AADT", dotName: "El Paso Streets and Maintenance Department", planningOfficeName: "El Paso Planning and Inspections Department", parkingCodeCitation: "El Paso City Code, Chapter 20.18 — Off-Street Parking." },
  { code: "corpus_christi_metro", slug: "corpus-christi", shortName: "Corpus Christi", longName: "Corpus Christi MSA", state: "TX", signals: 454, namedPct: 98.7, aadtPct: 100.0, liveSource: "TxDOT DriveTexas", aadtSource: "TxDOT current AADT", dotName: "Corpus Christi Engineering Services Department", planningOfficeName: "Corpus Christi Development Services Department", parkingCodeCitation: "Corpus Christi Unified Development Code, Article 7 — Parking." },
  { code: "lubbock_metro", slug: "lubbock", shortName: "Lubbock", longName: "Lubbock MSA", state: "TX", signals: 382, namedPct: 98.7, aadtPct: 100.0, liveSource: "TxDOT DriveTexas", aadtSource: "TxDOT current AADT", dotName: "Lubbock Public Works Department", planningOfficeName: "Lubbock Planning Department", parkingCodeCitation: "Lubbock Code of Ordinances, Chapter 40 — Off-Street Parking." },
  { code: "mcallen_metro", slug: "mcallen", shortName: "McAllen", longName: "McAllen-Edinburg-Mission MSA", state: "TX", signals: 755, namedPct: 99.5, aadtPct: 99.5, liveSource: "TxDOT DriveTexas", aadtSource: "TxDOT current AADT", dotName: "McAllen Public Works Department", planningOfficeName: "McAllen Planning Department", parkingCodeCitation: "McAllen Code of Ordinances, Chapter 138 — Off-Street Parking." },
  // CA (4)
  { code: "bakersfield_metro", slug: "bakersfield", shortName: "Bakersfield", longName: "Bakersfield MSA", state: "CA", signals: 1229, namedPct: 100.0, aadtPct: 16.9, liveSource: null, aadtSource: "Caltrans 2023 Traffic Census (state highways)", dotName: "Bakersfield Public Works Department", planningOfficeName: "Bakersfield Development Services Department", parkingCodeCitation: "Bakersfield Municipal Code, Chapter 17.58 — Off-Street Parking." },
  { code: "stockton_metro", slug: "stockton", shortName: "Stockton", longName: "Stockton-Lodi MSA", state: "CA", signals: 1017, namedPct: 99.4, aadtPct: 21.0, liveSource: null, aadtSource: "Caltrans 2023 Traffic Census (state highways)", dotName: "Stockton Public Works Department", planningOfficeName: "Stockton Community Development Department", parkingCodeCitation: "Stockton Municipal Code, Title 16, Chapter 16.64 — Parking." },
  { code: "modesto_metro", slug: "modesto", shortName: "Modesto", longName: "Modesto MSA", state: "CA", signals: 748, namedPct: 99.6, aadtPct: 27.3, liveSource: null, aadtSource: "Caltrans 2023 Traffic Census (state highways)", dotName: "Modesto Public Works Department", planningOfficeName: "Modesto Community and Economic Development Department", parkingCodeCitation: "Modesto Municipal Code, Title 10, Chapter 10-2.1407 — Parking." },
  { code: "oxnard_metro", slug: "oxnard", shortName: "Oxnard-Thousand Oaks", longName: "Oxnard-Thousand Oaks-Ventura MSA", state: "CA", signals: 2148, namedPct: 99.6, aadtPct: 28.9, liveSource: null, aadtSource: "Caltrans 2023 Traffic Census (state highways)", dotName: "Oxnard Public Works Department", planningOfficeName: "Oxnard Development Services Department", parkingCodeCitation: "Oxnard City Code, Chapter 16, Article 7 — Off-Street Parking." },
  // CO (2)
  { code: "colorado_springs_metro", slug: "colorado-springs", shortName: "Colorado Springs", longName: "Colorado Springs MSA", state: "CO", signals: 1336, namedPct: 99.5, aadtPct: 16.4, liveSource: null, aadtSource: "CDOT-CO OTIS (state highways)", dotName: "Colorado Springs Public Works Department", planningOfficeName: "Colorado Springs Planning and Community Development Department", parkingCodeCitation: "Colorado Springs City Code, Chapter 7, Article 4 — Parking." },
  { code: "fort_collins_metro", slug: "fort-collins", shortName: "Fort Collins", longName: "Fort Collins MSA", state: "CO", signals: 752, namedPct: 98.0, aadtPct: 38.3, liveSource: null, aadtSource: "CDOT-CO OTIS (state highways)", dotName: "Fort Collins Streets Department", planningOfficeName: "Fort Collins Community Development and Neighborhood Services", parkingCodeCitation: "Fort Collins Land Use Code, Article 3.2.2 — Access, Circulation and Parking." },
  // NV (1)
  { code: "reno_metro", slug: "reno", shortName: "Reno", longName: "Reno-Sparks MSA", state: "NV", signals: 900, namedPct: 100.0, aadtPct: 91.2, liveSource: null, aadtSource: "NDOT TRINA 2024 AADT", dotName: "Reno Public Works Department", planningOfficeName: "Reno Community Development Department", parkingCodeCitation: "Reno Municipal Code, Title 18.12, Section 18.12.1305 — Parking." },
  // WA (2)
  { code: "spokane_metro", slug: "spokane", shortName: "Spokane", longName: "Spokane-Spokane Valley MSA", state: "WA", signals: 584, namedPct: 99.7, aadtPct: 36.3, liveSource: null, aadtSource: "WSDOT 2024 Traffic Sections (state highways)", dotName: "Spokane Streets Department", planningOfficeName: "Spokane Planning Services Department", parkingCodeCitation: "Spokane Municipal Code, Chapter 17C.230 — Parking and Loading." },
  { code: "tacoma_metro", slug: "tacoma", shortName: "Tacoma", longName: "Tacoma-Pierce County", state: "WA", signals: 1351, namedPct: 97.5, aadtPct: 36.5, liveSource: null, aadtSource: "WSDOT 2024 Traffic Sections (state highways)", dotName: "Tacoma Public Works Department", planningOfficeName: "Tacoma Planning and Development Services", parkingCodeCitation: "Tacoma Municipal Code, Chapter 13.06.510 — Off-Street Parking." },
  // OR (2)
  { code: "eugene_metro", slug: "eugene", shortName: "Eugene", longName: "Eugene-Springfield MSA", state: "OR", signals: 399, namedPct: 100.0, aadtPct: 27.6, liveSource: "ODOT-OR TripCheck", aadtSource: "ODOT-OR 2024 Traffic Flow (state highways)", dotName: "Eugene Public Works Department", planningOfficeName: "Eugene Planning Division", parkingCodeCitation: "Eugene Code, Chapter 9.6400 — Parking and Loading Standards." },
  { code: "salem_or_metro", slug: "salem-or", shortName: "Salem (OR)", longName: "Salem (OR) MSA", state: "OR", signals: 298, namedPct: 100.0, aadtPct: 37.9, liveSource: "ODOT-OR TripCheck", aadtSource: "ODOT-OR 2024 Traffic Flow (state highways)", dotName: "Salem Public Works Department", planningOfficeName: "Salem Community Planning and Development Department", parkingCodeCitation: "Salem Revised Code, Title 12, Chapter 806 — Off-Street Parking." },
  // UT (2)
  { code: "provo_metro", slug: "provo", shortName: "Provo", longName: "Provo-Orem MSA", state: "UT", signals: 591, namedPct: 99.0, aadtPct: 96.8, liveSource: null, aadtSource: "UDOT 2024 AADT", dotName: "Provo Public Works Department", planningOfficeName: "Provo Community Development Department", parkingCodeCitation: "Provo City Code, Title 14, Chapter 37 — Parking and Loading." },
  { code: "ogden_metro", slug: "ogden", shortName: "Ogden", longName: "Ogden-Clearfield MSA", state: "UT", signals: 306, namedPct: 99.0, aadtPct: 90.8, liveSource: null, aadtSource: "UDOT 2024 AADT", dotName: "Ogden Public Services Department", planningOfficeName: "Ogden Community and Economic Development Department", parkingCodeCitation: "Ogden Municipal Code, Title 15, Chapter 27 — Off-Street Parking." },
  // MN (2)
  { code: "rochester_mn_metro", slug: "rochester-mn", shortName: "Rochester (MN)", longName: "Rochester (MN) MSA", state: "MN", signals: 332, namedPct: 99.7, aadtPct: 99.7, liveSource: null, aadtSource: "MnDOT current AADT segments", dotName: "Rochester Department of Public Works", planningOfficeName: "Rochester-Olmsted Planning Department", parkingCodeCitation: "Rochester Code of Ordinances, Section 63.290 — Off-Street Parking." },
  { code: "duluth_metro", slug: "duluth", shortName: "Duluth", longName: "Duluth MSA", state: "MN", signals: 189, namedPct: 99.5, aadtPct: 99.5, liveSource: null, aadtSource: "MnDOT current AADT segments", dotName: "Duluth Engineering Division", planningOfficeName: "Duluth Planning and Construction Services Division", parkingCodeCitation: "Duluth City Code, Chapter 50, Article VII — Off-Street Parking." },
  // FL (6)
  { code: "fort_lauderdale_metro", slug: "fort-lauderdale", shortName: "Fort Lauderdale", longName: "Fort Lauderdale (Broward County)", state: "FL", signals: 3692, namedPct: 99.9, aadtPct: 97.3, liveSource: "FDOT DIVAS", aadtSource: "FDOT AADT TDA", dotName: "Fort Lauderdale Transportation and Mobility Department", planningOfficeName: "Broward County Planning Council", parkingCodeCitation: "Fort Lauderdale Unified Land Development Regulations, Section 47-20 — Parking." },
  { code: "west_palm_beach_metro", slug: "west-palm-beach", shortName: "West Palm Beach", longName: "West Palm Beach (Palm Beach County)", state: "FL", signals: 2174, namedPct: 98.9, aadtPct: 93.3, liveSource: "FDOT DIVAS", aadtSource: "FDOT AADT TDA", dotName: "West Palm Beach Engineering Services Department", planningOfficeName: "Palm Beach County Planning, Zoning and Building Department", parkingCodeCitation: "West Palm Beach Code of Ordinances, Chapter 94 — Zoning, Article XII — Off-Street Parking." },
  { code: "daytona_beach_metro", slug: "daytona-beach", shortName: "Daytona Beach", longName: "Deltona-Daytona Beach-Ormond Beach MSA", state: "FL", signals: 550, namedPct: 99.5, aadtPct: 93.6, liveSource: "FDOT DIVAS", aadtSource: "FDOT AADT TDA", dotName: "Daytona Beach Public Works Department", planningOfficeName: "Volusia County Growth and Resource Management", parkingCodeCitation: "Daytona Beach Land Development Code, Article 8 — Off-Street Parking." },
  { code: "lakeland_metro", slug: "lakeland", shortName: "Lakeland", longName: "Lakeland-Winter Haven MSA", state: "FL", signals: 718, namedPct: 98.6, aadtPct: 90.0, liveSource: "FDOT DIVAS", aadtSource: "FDOT AADT TDA", dotName: "Lakeland Public Works Department", planningOfficeName: "Polk County Land Development Division", parkingCodeCitation: "Lakeland Land Development Code, Article 7 — Off-Street Parking." },
  { code: "tallahassee_metro", slug: "tallahassee", shortName: "Tallahassee", longName: "Tallahassee MSA", state: "FL", signals: 722, namedPct: 99.7, aadtPct: 96.3, liveSource: "FDOT DIVAS", aadtSource: "FDOT AADT TDA", dotName: "Tallahassee Underground Utilities and Public Infrastructure", planningOfficeName: "Tallahassee-Leon County Planning Department", parkingCodeCitation: "Tallahassee Land Development Code, Chapter 10, Section 10-256 — Parking." },
  { code: "fort_myers_metro", slug: "fort-myers", shortName: "Fort Myers", longName: "Cape Coral-Fort Myers MSA", state: "FL", signals: 1096, namedPct: 99.1, aadtPct: 83.9, liveSource: "FDOT DIVAS", aadtSource: "FDOT AADT TDA", dotName: "Fort Myers Public Works Department", planningOfficeName: "Lee County Department of Community Development", parkingCodeCitation: "Fort Myers Land Development Code, Section 86-191 — Off-Street Parking." },
  // VA (2)
  { code: "roanoke_metro", slug: "roanoke", shortName: "Roanoke", longName: "Roanoke MSA", state: "VA", signals: 482, namedPct: 100.0, aadtPct: 99.6, liveSource: null, aadtSource: "VDOT 2024 Traffic Volume", dotName: "Roanoke Transportation Division", planningOfficeName: "Roanoke Planning, Building, and Development Department", parkingCodeCitation: "Roanoke Zoning Ordinance, Section 36.2-652 — Parking." },
  { code: "charlottesville_metro", slug: "charlottesville", shortName: "Charlottesville", longName: "Charlottesville MSA", state: "VA", signals: 297, namedPct: 98.0, aadtPct: 95.3, liveSource: null, aadtSource: "VDOT 2024 Traffic Volume", dotName: "Charlottesville Public Works Department", planningOfficeName: "Charlottesville Department of Neighborhood Development Services", parkingCodeCitation: "Charlottesville Zoning Ordinance, Article 8 — Parking and Loading." },
  // MO (2)
  { code: "springfield_mo_metro", slug: "springfield-mo", shortName: "Springfield (MO)", longName: "Springfield (MO) MSA", state: "MO", signals: 525, namedPct: 97.7, aadtPct: 28.8, liveSource: "MoDOT WZDx", aadtSource: "MoDOT Directional AADT (state highways)", dotName: "Springfield Public Works Department", planningOfficeName: "Springfield-Greene County Planning Department", parkingCodeCitation: "Springfield Land Development Code, Article VI — Off-Street Parking." },
  { code: "columbia_mo_metro", slug: "columbia-mo", shortName: "Columbia (MO)", longName: "Columbia (MO) MSA", state: "MO", signals: 175, namedPct: 97.7, aadtPct: 38.9, liveSource: "MoDOT WZDx", aadtSource: "MoDOT Directional AADT (state highways)", dotName: "Columbia Public Works Department", planningOfficeName: "Columbia Community Development Department", parkingCodeCitation: "Columbia Code of Ordinances, Section 29-32 — Off-Street Parking." },
  // IA (1)
  { code: "cedar_rapids_metro", slug: "cedar-rapids", shortName: "Cedar Rapids", longName: "Cedar Rapids MSA", state: "IA", signals: 363, namedPct: 97.2, aadtPct: 100.0, liveSource: null, aadtSource: "Iowa DOT RAMS AADT", dotName: "Cedar Rapids Public Works Department", planningOfficeName: "Cedar Rapids Community Development Department", parkingCodeCitation: "Cedar Rapids Municipal Code, Chapter 32 — Zoning, Article 5 — Off-Street Parking." },

  // ── Tier-8: Canada (10 metros, 7 provinces — signal counts pending extraction) ──
  { code: "toronto_metro", slug: "toronto", shortName: "Toronto", longName: "Toronto CMA", state: "ON", country: "CA", signals: 8427, namedPct: 99.3, aadtPct: 4.3, liveSource: null, aadtSource: "MTO Historical AADT 2019 (provincial highways)", dotName: "City of Toronto Transportation Services", planningOfficeName: "City Planning Division", parkingCodeCitation: "Toronto Zoning By-law 569-2013, Chapter 200 — Parking Space Regulations." },
  { code: "ottawa_metro", slug: "ottawa", shortName: "Ottawa", longName: "Ottawa CMA", state: "ON", country: "CA", signals: 2594, namedPct: 99.7, aadtPct: 5.0, liveSource: null, aadtSource: "MTO Historical AADT 2019 (provincial highways)", dotName: "City of Ottawa Transportation Services Department", planningOfficeName: "Planning, Real Estate and Economic Development (PRED)", parkingCodeCitation: "Ottawa Zoning By-law 2008-250, Section 100 — Parking Space Rates." },
  { code: "hamilton_metro", slug: "hamilton", shortName: "Hamilton", longName: "Hamilton CMA", state: "ON", country: "CA", signals: 1358, namedPct: 99.8, aadtPct: 6.5, liveSource: null, aadtSource: "MTO Historical AADT 2019 (provincial highways)", dotName: "City of Hamilton Public Works — Transportation Planning and Parking", planningOfficeName: "Hamilton Planning and Economic Development", parkingCodeCitation: "Hamilton Zoning By-law 05-200, Section 5 — Parking and Loading." },
  { code: "montreal_metro", slug: "montreal", shortName: "Montréal", longName: "Montréal CMM", state: "QC", country: "CA", signals: 23432, namedPct: 98.6, aadtPct: 0, liveSource: null, dotName: "Service de l'urbanisme et de la mobilité (Montréal)", planningOfficeName: "Service de l'urbanisme et de la mobilité", parkingCodeCitation: "Règlement d'urbanisme de la Ville de Montréal (RV 01-282), Section IV — Stationnement." },
  { code: "quebec_city_metro", slug: "quebec-city", shortName: "Québec City", longName: "Québec CMA", state: "QC", country: "CA", signals: 1969, namedPct: 98.6, aadtPct: 0, liveSource: null, dotName: "Service du transport et de la mobilité intelligente (Ville de Québec)", planningOfficeName: "Service de la planification de l'aménagement et de l'environnement", parkingCodeCitation: "Règlement de l'arrondissement de Québec sur l'urbanisme R.V.Q. 1400, Chapitre IV — Stationnement." },
  { code: "vancouver_metro", slug: "vancouver", shortName: "Vancouver", longName: "Metro Vancouver Regional District", state: "BC", country: "CA", signals: 8764, namedPct: 99.8, aadtPct: 0, liveSource: null, dotName: "City of Vancouver Engineering — Transportation Division", planningOfficeName: "City of Vancouver Planning, Urban Design and Sustainability", parkingCodeCitation: "Vancouver Parking By-law No. 6059, Sections 4-6 — Off-Street Parking." },
  { code: "calgary_metro", slug: "calgary", shortName: "Calgary", longName: "Calgary CMA", state: "AB", country: "CA", signals: 3804, namedPct: 99.3, aadtPct: 3.2, liveSource: null, aadtSource: "Alberta Transportation LoS 2021 (provincial highways)", dotName: "City of Calgary Transportation Department", planningOfficeName: "Calgary Planning and Development Services", parkingCodeCitation: "Calgary Land Use Bylaw 1P2007, Part 4, Division 5 — Motor Vehicle Parking." },
  { code: "edmonton_metro", slug: "edmonton", shortName: "Edmonton", longName: "Edmonton CMA", state: "AB", country: "CA", signals: 2630, namedPct: 99.8, aadtPct: 1.9, liveSource: null, aadtSource: "Alberta Transportation LoS 2021 (provincial highways)", dotName: "City of Edmonton Integrated Infrastructure Services — Transportation", planningOfficeName: "Edmonton Urban Planning and Economy", parkingCodeCitation: "Edmonton Zoning Bylaw 20001, Section 6.60 — Motor Vehicle Parking." },
  { code: "winnipeg_metro", slug: "winnipeg", shortName: "Winnipeg", longName: "Winnipeg CMA", state: "MB", country: "CA", signals: 1657, namedPct: 99.8, aadtPct: 0.0, liveSource: null, aadtSource: "MHTIS 2019 (provincial highways only — sparse in Winnipeg)", dotName: "City of Winnipeg Public Works — Transportation Division", planningOfficeName: "Winnipeg Planning, Property and Development Department", parkingCodeCitation: "Winnipeg Zoning By-law 200/2006, Part 5 — Off-Street Parking and Loading." },
  { code: "halifax_metro", slug: "halifax", shortName: "Halifax", longName: "Halifax CMA", state: "NS", country: "CA", signals: 666, namedPct: 99.1, aadtPct: 0, liveSource: null, dotName: "Halifax Regional Municipality Transportation and Public Works", planningOfficeName: "HRM Planning and Development", parkingCodeCitation: "Halifax Regional Municipality Land Use By-law (Centre Plan), Part 8 — Off-Street Parking." },
];

/** Look up by slug — used by the dynamic /cities/:slug route. */
export function metroBySlug(slug: string): MetroCoverage | undefined {
  return METROS.find((m) => m.slug === slug);
}

/** Sibling metros in the same state, excluding the input. */
export function siblingMetros(m: MetroCoverage): MetroCoverage[] {
  return METROS.filter((x) => x.state === m.state && x.code !== m.code);
}

/** Cutoff for "featured" coverage tier. */
export const TIER_A_AADT_CUTOFF = 75;

/** Helpers. */
export const TIER_A_METROS = METROS.filter((m) => m.aadtPct >= TIER_A_AADT_CUTOFF || m.code === "atlanta_metro");
export const TIER_B_METROS = METROS.filter((m) => m.aadtPct < TIER_A_AADT_CUTOFF && m.code !== "atlanta_metro");
export const TOTAL_SIGNALS = METROS.reduce((sum, m) => sum + m.signals, 0);
export const TOTAL_METROS = METROS.length;
export const STATES_COVERED = new Set(METROS.map((m) => m.state)).size;

/** Canonical state-code → full-name map. Single source of truth used by /cities,
 *  /cities/<slug>, the home page coverage grid — anywhere a state is rendered. */
export const STATE_NAMES: Record<MetroCoverage["state"], string> = {
  GA: "Georgia", NC: "North Carolina", TN: "Tennessee", FL: "Florida",
  AL: "Alabama", SC: "South Carolina", VA: "Virginia", KY: "Kentucky",
  LA: "Louisiana", DC: "District of Columbia", MD: "Maryland",
  PA: "Pennsylvania", NY: "New York", MA: "Massachusetts", IL: "Illinois",
  MI: "Michigan", MN: "Minnesota", OH: "Ohio", IN: "Indiana", MO: "Missouri",
  WI: "Wisconsin", TX: "Texas", CA: "California", OR: "Oregon",
  WA: "Washington", NV: "Nevada", AZ: "Arizona", CO: "Colorado", UT: "Utah",
  NM: "New Mexico", CT: "Connecticut", RI: "Rhode Island", NH: "New Hampshire",
  VT: "Vermont", ME: "Maine", NJ: "New Jersey", WV: "West Virginia",
  MS: "Mississippi", AR: "Arkansas", OK: "Oklahoma", IA: "Iowa", NE: "Nebraska",
  KS: "Kansas", ND: "North Dakota", SD: "South Dakota", ID: "Idaho",
  MT: "Montana", WY: "Wyoming", AK: "Alaska", HI: "Hawaii",
  // Canadian provinces (Tier-8)
  ON: "Ontario", QC: "Québec", BC: "British Columbia", AB: "Alberta",
  MB: "Manitoba", NS: "Nova Scotia",
};

/** Comparator: sort metros by full state name alphabetically, then by AADT%
 *  desc within state (so Tier-A leads its state). */
export function compareByStateThenAadt(a: MetroCoverage, b: MetroCoverage): number {
  const cmp = STATE_NAMES[a.state].localeCompare(STATE_NAMES[b.state]);
  if (cmp !== 0) return cmp;
  return b.aadtPct - a.aadtPct;
}
