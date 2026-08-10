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
  | "511 Ontario" | "Québec 511" | "DriveBC" | "511 Alberta" | "Manitoba 511" | "511 NS"
  | "TfL Open Data" | "National Highways" | "TfGM" | "Traffic Scotland";

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
    | "ON" | "QC" | "BC" | "AB" | "MB" | "NS"  // Canadian provinces (Tier-8)
    | "CMX" | "JAL" | "NLE" | "PUE" | "BCN" | "MEX" | "GUA" | "CHH" | "QUE" | "YUC"  // Mexican estados (Tier-9)
    | "ENG" | "SCT"  // UK countries (Tier-9). SCT (not SC) — avoids US South Carolina clash.
    // Tier-10 global (ISO 3166-1 alpha-2, alpha-3 used when alpha-2 collides with a US state).
    | "DE" | "FR" | "IT" | "ES" | "NL" | "BE" | "CH" | "AT" | "PT" | "IE"
    | "PL" | "CZ" | "HU" | "RO" | "SE" | "NO" | "DK" | "FI" | "GR"
    | "JP" | "KR" | "IND" | "HK" | "SG" | "TW" | "TH" | "VN" | "PH"
    | "IDN" | "MY" | "PK" | "UZ"
    | "AE" | "SA" | "ISR" | "TR" | "QA" | "JO" | "LB"
    | "BR" | "ARG" | "CL" | "COL" | "PE" | "UY" | "EC"
    | "ZA" | "EG" | "NG" | "KE" | "MAR" | "GH"
    | "AU" | "NZ"
    | "UA"
    | "PAN" | "CR" | "CU"
    // Tier-11 global. TUN (not TN) — avoids US Tennessee clash.
    | "BD" | "ET" | "TZ" | "KZ" | "KW" | "OM" | "TUN" | "SN" | "RS" | "BG" | "HR" | "LT";
  /** Country defaults to US when omitted (back-compat for all pre-Tier-8 rows). */
  country?: "US" | "CA" | "MX" | "UK"
    // Tier-10 global countries (ISO 3166-1 alpha-2)
    | "DE" | "FR" | "IT" | "ES" | "NL" | "BE" | "CH" | "AT" | "PT" | "IE"
    | "PL" | "CZ" | "HU" | "RO" | "SE" | "NO" | "DK" | "FI" | "GR"
    | "JP" | "KR" | "IN" | "HK" | "SG" | "TW" | "TH" | "VN" | "PH"
    | "ID" | "MY" | "PK" | "UZ"
    | "AE" | "SA" | "IL" | "TR" | "QA" | "JO" | "LB"
    | "BR" | "AR" | "CL" | "CO" | "PE" | "UY" | "EC"
    | "ZA" | "EG" | "NG" | "KE" | "MA" | "GH"
    | "AU" | "NZ"
    | "UA"
    | "PA" | "CR" | "CU"
    | "BD" | "ET" | "TZ" | "KZ" | "KW" | "OM" | "TN" | "SN" | "RS" | "BG" | "HR" | "LT";
  signals: number;
  /** % of signals named via OSM roads or city dataset (vs "Signal #<id>" stub). */
  namedPct: number;
  /** % of signals snapped to AADT (either measured-DOT or synthetic-OSM-class).
   *  Read aadtQuality to know whether this is measured or modeled. */
  aadtPct: number;
  liveSource: LiveSource | null;
  /** Top-line AADT data source label, for the row hover. */
  aadtSource?: string;
  /** Provenance of the aadtPct number — defaults to "measured" for back-compat
   *  with all pre-Tier-10 entries that came from real DOT count integrations.
   *  "synthetic" = HCM road-class baseline keyed off OSM nearest-segment, used
   *  for Tier-10 global metros where no measured AADT layer is wired.
   *  Tier-A featured-coverage badge requires aadtQuality === "measured". */
  aadtQuality?: "measured" | "synthetic" | "none";
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
  { code: "macon_metro", slug: "macon", shortName: "Macon-Bibb", longName: "Macon-Bibb MSA", state: "GA", signals: 815, namedPct: 94.7, aadtPct: 97.9, liveSource: null, aadtSource: "GDOT AADT (state highways) + FHWA HPMS 2018",
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
  { code: "chattanooga_metro", slug: "chattanooga", shortName: "Chattanooga", longName: "Chattanooga MSA", state: "TN", signals: 523, namedPct: 95.8, aadtPct: 98.7, liveSource: null, aadtSource: "TDOT Traffic Points (state routes only) + FHWA HPMS 2018",
    dotName: "Chattanooga DOT", planningOfficeName: "Chattanooga Department of Transportation Planning",
    parkingCodeCitation: "City of Chattanooga Zoning Ordinance, Section 38 — Parking." },
  { code: "knoxville_metro", slug: "knoxville", shortName: "Knoxville", longName: "Knoxville MSA", state: "TN", signals: 1553, namedPct: 96.6, aadtPct: 98.4, liveSource: null, aadtSource: "TDOT Traffic Points (state routes only) + FHWA HPMS 2018",
    dotName: "Knoxville Engineering Department", planningOfficeName: "Knoxville-Knox County Planning",
    parkingCodeCitation: "City of Knoxville Zoning Ordinance, Article 12 — Parking." },
  { code: "memphis_metro", slug: "memphis", shortName: "Memphis", longName: "Memphis MSA", state: "TN", signals: 1280, namedPct: 98.3, aadtPct: 97.9, liveSource: null, aadtSource: "TDOT Traffic Points (state routes only) + FHWA HPMS 2018",
    dotName: "City of Memphis Division of Public Works", planningOfficeName: "Memphis & Shelby County Division of Planning and Development",
    parkingCodeCitation: "Memphis Unified Development Code, Article 4.5 — Parking." },
  { code: "nashville_metro", slug: "nashville", shortName: "Nashville", longName: "Nashville MSA", state: "TN", signals: 2685, namedPct: 96.9, aadtPct: 96.2, liveSource: null, aadtSource: "TDOT Traffic Points (state routes only) + FHWA HPMS 2018",
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
  { code: "orlando_metro", slug: "orlando", shortName: "Orlando", longName: "Orlando MSA", state: "FL", signals: 6850, namedPct: 96.5, aadtPct: 88.2, liveSource: "FDOT DIVAS", aadtSource: "FDOT AADT TDA + FHWA HPMS 2018",
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
  { code: "huntsville_metro", slug: "huntsville", shortName: "Huntsville", longName: "Huntsville MSA", state: "AL", signals: 968, namedPct: 98.2, aadtPct: 98.8, liveSource: null, aadtSource: "ALDOT TDM 2024-2025 AADT (state highways) + FHWA HPMS 2018",
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
  { code: "greenville_spartanburg_metro", slug: "greenville-spartanburg", shortName: "Greenville", longName: "Greenville-Spartanburg (SC)", state: "SC", signals: 1204, namedPct: 99.4, aadtPct: 70.8, liveSource: null, aadtSource: "SCDOT 2017 counts",
    dotName: "Greenville County Public Works", planningOfficeName: "Greenville-Pickens Area Transportation Study (GPATS)",
    parkingCodeCitation: "Greenville County Land Development Regulations, Article 9; County UDO Sec. 22.8 (TIS trigger)." },
  { code: "south_carolina_statewide", slug: "south-carolina-statewide", shortName: "SC statewide", longName: "South Carolina (statewide)", state: "SC", signals: 5780, namedPct: 98.8, aadtPct: 73.5, liveSource: null, aadtSource: "SCDOT 2017 counts",
    dotName: "South Carolina Department of Transportation (SCDOT)", planningOfficeName: "Controlling MPO/COG per site location",
    parkingCodeCitation: "Off-street parking per the controlling municipal or county zoning ordinance for the site." },
  { code: "georgia_statewide", slug: "georgia-statewide", shortName: "GA statewide", longName: "Georgia (statewide)", state: "GA", signals: 13289, namedPct: 97.9, aadtPct: 76.2, liveSource: null, aadtSource: "GDOT AADT (DeKalbGIS ingest)",
    dotName: "Georgia Department of Transportation (GDOT)", planningOfficeName: "Controlling MPO/RC per site location",
    parkingCodeCitation: "Off-street parking per the controlling municipal or county zoning ordinance for the site." },

  // VA
  { code: "hampton_roads_metro", slug: "hampton-roads", shortName: "Hampton Roads", longName: "Hampton Roads MSA", state: "VA", signals: 4676, namedPct: 99.6, aadtPct: 94.2, liveSource: null, aadtSource: "VDOT 2024 Bidirectional ADT",
    dotName: "Virginia DOT Hampton Roads District", planningOfficeName: "Hampton Roads Transportation Planning Organization",
    parkingCodeCitation: "Norfolk Zoning Ordinance, Chapter 14 — Parking and Loading (jurisdiction varies by city)." },
  { code: "richmond_metro", slug: "richmond", shortName: "Richmond", longName: "Richmond MSA", state: "VA", signals: 3522, namedPct: 100.0, aadtPct: 97.0, liveSource: null, aadtSource: "VDOT 2024 Bidirectional ADT",
    dotName: "Richmond Department of Public Works", planningOfficeName: "Richmond Department of Planning and Development Review",
    parkingCodeCitation: "Richmond Zoning Ordinance, Article VII — Off-Street Parking and Loading." },

  // KY
  { code: "lexington_metro", slug: "lexington", shortName: "Lexington", longName: "Lexington-Fayette MSA", state: "KY", signals: 978, namedPct: 99.9, aadtPct: 100, liveSource: null, aadtSource: "KYTC Traffic Section AADT (state highways) + FHWA HPMS 2018",
    dotName: "Lexington-Fayette Urban County Government Traffic Engineering", planningOfficeName: "Lexington Division of Planning",
    parkingCodeCitation: "Lexington-Fayette Urban County Government Zoning Ordinance, Article 16 — Parking." },
  { code: "louisville_metro", slug: "louisville", shortName: "Louisville", longName: "Louisville MSA", state: "KY", signals: 1461, namedPct: 98.6, aadtPct: 99.3, liveSource: "KYTC closures", aadtSource: "KYTC Traffic Section AADT (state-system; 0.3pp below Tier-A) + FHWA HPMS 2018",
    dotName: "Louisville Metro Department of Public Works", planningOfficeName: "Louisville Metro Office of Planning",
    parkingCodeCitation: "Louisville Metro Land Development Code, Chapter 9 — Parking." },

  // LA
  { code: "new_orleans_metro", slug: "new-orleans", shortName: "New Orleans", longName: "New Orleans MSA", state: "LA", signals: 1979, namedPct: 98.3, aadtPct: 95.6, liveSource: null, aadtSource: "RPC SE Louisiana (RPC + DOTD, state highways) + FHWA HPMS 2018",
    dotName: "New Orleans Department of Public Works", planningOfficeName: "Regional Planning Commission of Southeast Louisiana",
    parkingCodeCitation: "New Orleans Comprehensive Zoning Ordinance, Article 22 — Off-Street Parking." },

  // ── Tier-4: Coast + Midwest + Westward (signal counts pending extraction) ──
  // DC
  { code: "washington_dc_metro", slug: "washington-dc", shortName: "Washington DC", longName: "Washington-Arlington-Alexandria MSA", state: "DC", signals: 10752, namedPct: 99.6, aadtPct: 95.1, liveSource: null, aadtSource: "DDOT 2023 + VDOT + MDOT-SHA AADT",
    dotName: "District Department of Transportation (DDOT)", planningOfficeName: "DC Office of Planning",
    parkingCodeCitation: "DC Zoning Regulations, Subtitle C, Chapter 7 — Off-Street Parking." },
  // MD
  { code: "baltimore_metro", slug: "baltimore", shortName: "Baltimore", longName: "Baltimore-Columbia-Towson MSA", state: "MD", signals: 4770, namedPct: 99.7, aadtPct: 92.7, liveSource: "MD CHART", aadtSource: "MDOT-SHA 2023 AADT segments",
    dotName: "Baltimore City DOT", planningOfficeName: "Baltimore Department of Planning",
    parkingCodeCitation: "Baltimore City Zoning Code, Title 16 — Parking and Loading." },
  // PA
  { code: "philadelphia_metro", slug: "philadelphia", shortName: "Philadelphia", longName: "Philadelphia MSA", state: "PA", signals: 8924, namedPct: 96.7, aadtPct: 92.6, liveSource: null, aadtSource: "PennDOT RMS + NJDOT AADT",
    dotName: "Philadelphia Streets Department", planningOfficeName: "Philadelphia City Planning Commission",
    parkingCodeCitation: "Philadelphia Zoning Code, Chapter 14-800 — Parking and Loading." },
  { code: "pittsburgh_metro", slug: "pittsburgh", shortName: "Pittsburgh", longName: "Pittsburgh MSA", state: "PA", signals: 2973, namedPct: 99.2, aadtPct: 93.7, liveSource: null, aadtSource: "PennDOT RMS Traffic Volumes",
    dotName: "Pittsburgh Department of Mobility and Infrastructure (DOMI)", planningOfficeName: "Pittsburgh Department of City Planning",
    parkingCodeCitation: "Pittsburgh Zoning Code, Chapter 914 — Parking, Loading and Access." },
  // NY
  { code: "new_york_metro", slug: "new-york", shortName: "New York", longName: "New York-Newark-Jersey City MSA", state: "NY", signals: 30601, namedPct: 91.9, aadtPct: 82.1, liveSource: null,
    dotName: "New York City Department of Transportation (NYC DOT)", planningOfficeName: "NYC Department of City Planning",
    parkingCodeCitation: "NYC Zoning Resolution, Article I, Chapter 3 — Off-Street Parking.",
    aadtSource: "NYSDOT TDV + NJDOT AADT" },
  // MA
  { code: "boston_metro", slug: "boston", shortName: "Boston", longName: "Boston-Cambridge-Newton MSA", state: "MA", signals: 7815, namedPct: 99.8, aadtPct: 96.9, liveSource: null, aadtSource: "MassDOT 2024 Traffic Inventory",
    dotName: "Boston Transportation Department (BTD)", planningOfficeName: "Boston Planning & Development Agency (BPDA)",
    parkingCodeCitation: "Boston Zoning Code, Article 23 — Off-Street Parking and Loading." },
  // IL
  { code: "chicago_metro", slug: "chicago", shortName: "Chicago", longName: "Chicago-Naperville-Elgin MSA", state: "IL", signals: 13305, namedPct: 99.0, aadtPct: 97.4, liveSource: null,
    dotName: "Chicago Department of Transportation (CDOT)", planningOfficeName: "Chicago Department of Planning and Development",
    parkingCodeCitation: "Chicago Zoning Ordinance, Section 17-10 — Off-Street Parking and Loading.",
    aadtSource: "IDOT 2020 Annual Average Daily Traffic + CDOT ADT Portal" },
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
  { code: "st_louis_metro", slug: "st-louis", shortName: "St. Louis", longName: "St. Louis MSA", state: "MO", signals: 3581, namedPct: 97.6, aadtPct: 99.8, liveSource: "MoDOT WZDx", aadtSource: "MoDOT Directional AADT (state highways) + FHWA HPMS 2018",
    dotName: "St. Louis Streets Department", planningOfficeName: "St. Louis Planning and Urban Design Agency",
    parkingCodeCitation: "St. Louis Revised Code, Title 26, Chapter 26.68 — Off-Street Parking." },
  { code: "kansas_city_metro", slug: "kansas-city", shortName: "Kansas City", longName: "Kansas City MSA", state: "MO", signals: 2086, namedPct: 94.4, aadtPct: 97.8, liveSource: "MoDOT WZDx", aadtSource: "MoDOT Directional AADT (state highways) + FHWA HPMS 2018",
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
  { code: "los_angeles_metro", slug: "los-angeles", shortName: "Los Angeles", longName: "Los Angeles-Long Beach-Anaheim MSA", state: "CA", signals: 30933, namedPct: 99.9, aadtPct: 74.2, liveSource: null,
    dotName: "Los Angeles Department of Transportation (LADOT)", planningOfficeName: "Los Angeles Department of City Planning",
    parkingCodeCitation: "LA Municipal Code, Chapter 1, Article 2, Section 12.21-A — Off-Street Parking.",
    aadtSource: "Caltrans Traffic Census + FHWA HPMS 2018" },
  { code: "sf_bay_metro", slug: "sf-bay", shortName: "SF Bay", longName: "San Francisco-Oakland-San Jose CSA", state: "CA", signals: 15751, namedPct: 99.3, aadtPct: 80.3, liveSource: null,
    dotName: "San Francisco Municipal Transportation Agency (SFMTA)", planningOfficeName: "San Francisco Planning Department",
    parkingCodeCitation: "SF Planning Code, Article 1.5, Section 151 — Off-Street Parking and Loading.",
    aadtSource: "Caltrans Traffic Census + FHWA HPMS 2018" },
  { code: "san_diego_metro", slug: "san-diego", shortName: "San Diego", longName: "San Diego-Chula Vista-Carlsbad MSA", state: "CA", signals: 10246, namedPct: 99.9, aadtPct: 72.9, liveSource: null,
    dotName: "City of San Diego Transportation Department", planningOfficeName: "City of San Diego Planning Department",
    parkingCodeCitation: "San Diego Municipal Code, Chapter 14, Article 2, Division 5 — Parking Regulations.",
    aadtSource: "Caltrans Traffic Census + FHWA HPMS 2018" },
  { code: "sacramento_metro", slug: "sacramento", shortName: "Sacramento", longName: "Sacramento-Roseville-Folsom MSA", state: "CA", signals: 4428, namedPct: 99.5, aadtPct: 65.1, liveSource: null,
    dotName: "Sacramento Department of Public Works", planningOfficeName: "Sacramento Community Development Department",
    parkingCodeCitation: "Sacramento City Code, Title 17, Chapter 17.608 — Off-Street Parking.",
    aadtSource: "Caltrans Traffic Census + FHWA HPMS 2018" },
  { code: "inland_empire_metro", slug: "inland-empire", shortName: "Inland Empire", longName: "Riverside-San Bernardino-Ontario MSA", state: "CA", signals: 12141, namedPct: 99.9, aadtPct: 68.1, liveSource: null,
    dotName: "Riverside County Transportation / SB County Public Works", planningOfficeName: "Western Riverside COG (WRCOG) / SBCOG",
    parkingCodeCitation: "Riverside Municipal Code, Chapter 19.580 — Parking; SB Development Code, Chapter 83.11 — Parking.",
    aadtSource: "Caltrans Traffic Census + FHWA HPMS 2018" },
  { code: "fresno_metro", slug: "fresno", shortName: "Fresno", longName: "Fresno MSA", state: "CA", signals: 1887, namedPct: 100.0, aadtPct: 74.9, liveSource: null,
    dotName: "City of Fresno Public Works Department", planningOfficeName: "Fresno Development and Resource Management Department",
    parkingCodeCitation: "Fresno Municipal Code, Article 14 — Off-Street Parking and Loading.",
    aadtSource: "Caltrans Traffic Census + FHWA HPMS 2018" },
  // OR
  { code: "portland_metro", slug: "portland", shortName: "Portland", longName: "Portland-Vancouver-Hillsboro MSA", state: "OR", signals: 3333, namedPct: 99.1, aadtPct: 99.5, liveSource: "ODOT-OR TripCheck", aadtSource: "ODOT-OR 2024 Traffic Flow (state highways) + FHWA HPMS 2018",
    dotName: "Portland Bureau of Transportation (PBOT)", planningOfficeName: "Portland Bureau of Planning and Sustainability",
    parkingCodeCitation: "Portland Zoning Code, Chapter 33.266 — Parking and Loading." },
  // WA
  { code: "seattle_metro", slug: "seattle", shortName: "Seattle", longName: "Seattle-Tacoma-Bellevue MSA", state: "WA", signals: 4770, namedPct: 98.8, aadtPct: 113.2, liveSource: null, aadtSource: "WSDOT 2024 Traffic Sections (state highways) + FHWA HPMS 2018",
    dotName: "Seattle Department of Transportation (SDOT)", planningOfficeName: "Seattle Office of Planning and Community Development",
    parkingCodeCitation: "Seattle Municipal Code, Chapter 23.54 — Off-Street Parking." },
  // NV
  { code: "las_vegas_metro", slug: "las-vegas", shortName: "Las Vegas", longName: "Las Vegas-Henderson-Paradise MSA", state: "NV", signals: 5698, namedPct: 99.8, aadtPct: 98.3, liveSource: null, aadtSource: "NDOT TRINA 2024 AADT + FHWA HPMS 2018",
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
  { code: "denver_metro", slug: "denver", shortName: "Denver", longName: "Denver-Aurora-Centennial MSA", state: "CO", signals: 7700, namedPct: 99.3, aadtPct: 94.8, liveSource: null, aadtSource: "CDOT-CO OTIS 2024 (state highways) + FHWA HPMS 2018",
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
  { code: "jackson_ms_metro", slug: "jackson-ms", shortName: "Jackson (MS)", longName: "Jackson (MS) MSA", state: "MS", signals: 599, namedPct: 98.7, aadtPct: 99.7, liveSource: null,
    dotName: "Jackson Department of Public Works", planningOfficeName: "Jackson Department of Planning and Development",
    parkingCodeCitation: "Jackson Zoning Ordinance, Article 18 — Off-Street Parking and Loading." },
  // AR
  { code: "little_rock_metro", slug: "little-rock", shortName: "Little Rock", longName: "Little Rock-North Little Rock-Conway MSA", state: "AR", signals: 680, namedPct: 99.7, aadtPct: 98.8, liveSource: null,
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
  { code: "omaha_metro", slug: "omaha", shortName: "Omaha", longName: "Omaha-Council Bluffs MSA", state: "NE", signals: 2658, namedPct: 99.8, aadtPct: 99.6, liveSource: null, aadtSource: "Nebraska DOT AADT Points + FHWA HPMS 2018",
    dotName: "Omaha Public Works Department", planningOfficeName: "Omaha Planning Department",
    parkingCodeCitation: "Omaha Municipal Code, Chapter 55 — Zoning, Article XV — Parking and Loading." },
  // KS
  { code: "wichita_metro", slug: "wichita", shortName: "Wichita", longName: "Wichita MSA", state: "KS", signals: 766, namedPct: 100.0, aadtPct: 100, liveSource: null, aadtSource: "KSDOT AADT Flow Map (state system) + FHWA HPMS 2018",
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
  { code: "bakersfield_metro", slug: "bakersfield", shortName: "Bakersfield", longName: "Bakersfield MSA", state: "CA", signals: 1229, namedPct: 100.0, aadtPct: 74.2, liveSource: null, aadtSource: "Caltrans 2023 Traffic Census (state highways) + FHWA HPMS 2018", dotName: "Bakersfield Public Works Department", planningOfficeName: "Bakersfield Development Services Department", parkingCodeCitation: "Bakersfield Municipal Code, Chapter 17.58 — Off-Street Parking." },
  { code: "stockton_metro", slug: "stockton", shortName: "Stockton", longName: "Stockton-Lodi MSA", state: "CA", signals: 1017, namedPct: 99.4, aadtPct: 67.5, liveSource: null, aadtSource: "Caltrans 2023 Traffic Census (state highways) + FHWA HPMS 2018", dotName: "Stockton Public Works Department", planningOfficeName: "Stockton Community Development Department", parkingCodeCitation: "Stockton Municipal Code, Title 16, Chapter 16.64 — Parking." },
  { code: "modesto_metro", slug: "modesto", shortName: "Modesto", longName: "Modesto MSA", state: "CA", signals: 748, namedPct: 99.6, aadtPct: 83, liveSource: null, aadtSource: "Caltrans 2023 Traffic Census (state highways) + FHWA HPMS 2018", dotName: "Modesto Public Works Department", planningOfficeName: "Modesto Community and Economic Development Department", parkingCodeCitation: "Modesto Municipal Code, Title 10, Chapter 10-2.1407 — Parking." },
  { code: "oxnard_metro", slug: "oxnard", shortName: "Oxnard-Thousand Oaks", longName: "Oxnard-Thousand Oaks-Ventura MSA", state: "CA", signals: 2148, namedPct: 99.6, aadtPct: 76.5, liveSource: null, aadtSource: "Caltrans 2023 Traffic Census (state highways) + FHWA HPMS 2018", dotName: "Oxnard Public Works Department", planningOfficeName: "Oxnard Development Services Department", parkingCodeCitation: "Oxnard City Code, Chapter 16, Article 7 — Off-Street Parking." },
  // CO (2)
  { code: "colorado_springs_metro", slug: "colorado-springs", shortName: "Colorado Springs", longName: "Colorado Springs MSA", state: "CO", signals: 1336, namedPct: 99.5, aadtPct: 95.4, liveSource: null, aadtSource: "CDOT-CO OTIS (state highways) + FHWA HPMS 2018", dotName: "Colorado Springs Public Works Department", planningOfficeName: "Colorado Springs Planning and Community Development Department", parkingCodeCitation: "Colorado Springs City Code, Chapter 7, Article 4 — Parking." },
  { code: "fort_collins_metro", slug: "fort-collins", shortName: "Fort Collins", longName: "Fort Collins MSA", state: "CO", signals: 752, namedPct: 98.0, aadtPct: 98.3, liveSource: null, aadtSource: "CDOT-CO OTIS (state highways) + FHWA HPMS 2018", dotName: "Fort Collins Streets Department", planningOfficeName: "Fort Collins Community Development and Neighborhood Services", parkingCodeCitation: "Fort Collins Land Use Code, Article 3.2.2 — Access, Circulation and Parking." },
  // NV (1)
  { code: "reno_metro", slug: "reno", shortName: "Reno", longName: "Reno-Sparks MSA", state: "NV", signals: 900, namedPct: 100.0, aadtPct: 91.2, liveSource: null, aadtSource: "NDOT TRINA 2024 AADT", dotName: "Reno Public Works Department", planningOfficeName: "Reno Community Development Department", parkingCodeCitation: "Reno Municipal Code, Title 18.12, Section 18.12.1305 — Parking." },
  // WA (2)
  { code: "spokane_metro", slug: "spokane", shortName: "Spokane", longName: "Spokane-Spokane Valley MSA", state: "WA", signals: 584, namedPct: 99.7, aadtPct: 100, liveSource: null, aadtSource: "WSDOT 2024 Traffic Sections (state highways) + FHWA HPMS 2018", dotName: "Spokane Streets Department", planningOfficeName: "Spokane Planning Services Department", parkingCodeCitation: "Spokane Municipal Code, Chapter 17C.230 — Parking and Loading." },
  { code: "tacoma_metro", slug: "tacoma", shortName: "Tacoma", longName: "Tacoma-Pierce County", state: "WA", signals: 1351, namedPct: 97.5, aadtPct: 95.3, liveSource: null, aadtSource: "WSDOT 2024 Traffic Sections (state highways) + FHWA HPMS 2018", dotName: "Tacoma Public Works Department", planningOfficeName: "Tacoma Planning and Development Services", parkingCodeCitation: "Tacoma Municipal Code, Chapter 13.06.510 — Off-Street Parking." },
  // OR (2)
  { code: "eugene_metro", slug: "eugene", shortName: "Eugene", longName: "Eugene-Springfield MSA", state: "OR", signals: 399, namedPct: 100.0, aadtPct: 100, liveSource: "ODOT-OR TripCheck", aadtSource: "ODOT-OR 2024 Traffic Flow (state highways) + FHWA HPMS 2018", dotName: "Eugene Public Works Department", planningOfficeName: "Eugene Planning Division", parkingCodeCitation: "Eugene Code, Chapter 9.6400 — Parking and Loading Standards." },
  { code: "salem_or_metro", slug: "salem-or", shortName: "Salem (OR)", longName: "Salem (OR) MSA", state: "OR", signals: 298, namedPct: 100.0, aadtPct: 100, liveSource: "ODOT-OR TripCheck", aadtSource: "ODOT-OR 2024 Traffic Flow (state highways) + FHWA HPMS 2018", dotName: "Salem Public Works Department", planningOfficeName: "Salem Community Planning and Development Department", parkingCodeCitation: "Salem Revised Code, Title 12, Chapter 806 — Off-Street Parking." },
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
  { code: "sarasota_metro", slug: "sarasota", shortName: "Sarasota", longName: "North Port-Sarasota-Bradenton MSA", state: "FL", signals: 1347, namedPct: 99.0, aadtPct: 76.3, liveSource: "FDOT DIVAS", aadtSource: "FDOT AADT TDA", dotName: "Sarasota County Public Works — Transportation Planning Division", planningOfficeName: "Sarasota County Planning and Development Services", parkingCodeCitation: "City of Sarasota Zoning Code, Article VII, Division 2 — Off-Street Parking and Loading." },
  { code: "florida_statewide", slug: "florida-statewide", shortName: "FL statewide", longName: "Florida (statewide)", state: "FL", signals: 38628, namedPct: 97.6, aadtPct: 87.8, liveSource: null, aadtSource: "FDOT AADT TDA",
    dotName: "Florida Department of Transportation (FDOT)", planningOfficeName: "Controlling MPO/TPO per site location",
    parkingCodeCitation: "Off-street parking per the controlling municipal or county land development code for the site." },
  // VA (2)
  { code: "roanoke_metro", slug: "roanoke", shortName: "Roanoke", longName: "Roanoke MSA", state: "VA", signals: 482, namedPct: 100.0, aadtPct: 99.6, liveSource: null, aadtSource: "VDOT 2024 Traffic Volume", dotName: "Roanoke Transportation Division", planningOfficeName: "Roanoke Planning, Building, and Development Department", parkingCodeCitation: "Roanoke Zoning Ordinance, Section 36.2-652 — Parking." },
  { code: "charlottesville_metro", slug: "charlottesville", shortName: "Charlottesville", longName: "Charlottesville MSA", state: "VA", signals: 297, namedPct: 98.0, aadtPct: 95.3, liveSource: null, aadtSource: "VDOT 2024 Traffic Volume", dotName: "Charlottesville Public Works Department", planningOfficeName: "Charlottesville Department of Neighborhood Development Services", parkingCodeCitation: "Charlottesville Zoning Ordinance, Article 8 — Parking and Loading." },
  // MO (2)
  { code: "springfield_mo_metro", slug: "springfield-mo", shortName: "Springfield (MO)", longName: "Springfield (MO) MSA", state: "MO", signals: 525, namedPct: 97.7, aadtPct: 99.4, liveSource: "MoDOT WZDx", aadtSource: "MoDOT Directional AADT (state highways) + FHWA HPMS 2018", dotName: "Springfield Public Works Department", planningOfficeName: "Springfield-Greene County Planning Department", parkingCodeCitation: "Springfield Land Development Code, Article VI — Off-Street Parking." },
  { code: "columbia_mo_metro", slug: "columbia-mo", shortName: "Columbia (MO)", longName: "Columbia (MO) MSA", state: "MO", signals: 175, namedPct: 97.7, aadtPct: 98.3, liveSource: "MoDOT WZDx", aadtSource: "MoDOT Directional AADT (state highways) + FHWA HPMS 2018", dotName: "Columbia Public Works Department", planningOfficeName: "Columbia Community Development Department", parkingCodeCitation: "Columbia Code of Ordinances, Section 29-32 — Off-Street Parking." },
  // IA (1)
  { code: "cedar_rapids_metro", slug: "cedar-rapids", shortName: "Cedar Rapids", longName: "Cedar Rapids MSA", state: "IA", signals: 363, namedPct: 97.2, aadtPct: 100.0, liveSource: null, aadtSource: "Iowa DOT RAMS AADT", dotName: "Cedar Rapids Public Works Department", planningOfficeName: "Cedar Rapids Community Development Department", parkingCodeCitation: "Cedar Rapids Municipal Code, Chapter 32 — Zoning, Article 5 — Off-Street Parking." },

  // ── Tier-8: Canada (10 metros, 7 provinces — signal counts pending extraction) ──
  { code: "toronto_metro", slug: "toronto", shortName: "Toronto", longName: "Toronto CMA", state: "ON", country: "CA", signals: 8427, namedPct: 99.3, aadtPct: 99.8, liveSource: null, aadtSource: "Toronto SVC + TMC + Peel + Brampton + MTO + OSM-class synthetic", dotName: "City of Toronto Transportation Services", planningOfficeName: "City Planning Division", parkingCodeCitation: "Toronto Zoning By-law 569-2013, Chapter 200 — Parking Space Regulations." },
  { code: "ottawa_metro", slug: "ottawa", shortName: "Ottawa", longName: "Ottawa CMA", state: "ON", country: "CA", signals: 2594, namedPct: 99.7, aadtPct: 99.9, liveSource: null, aadtSource: "Ottawa Open Data Midblock Volumes 2022-2024 + MTO Historical AADT 2019 + OSM-class synthetic", dotName: "City of Ottawa Transportation Services Department", planningOfficeName: "Planning, Real Estate and Economic Development (PRED)", parkingCodeCitation: "Ottawa Zoning By-law 2008-250, Section 100 — Parking Space Rates." },
  { code: "hamilton_metro", slug: "hamilton", shortName: "Hamilton", longName: "Hamilton CMA", state: "ON", country: "CA", signals: 1358, namedPct: 99.8, aadtPct: 100.0, liveSource: null, aadtSource: "Hamilton Open Data Average Daily Traffic + MTO Historical AADT 2019 + OSM-class synthetic", dotName: "City of Hamilton Public Works — Transportation Planning and Parking", planningOfficeName: "Hamilton Planning and Economic Development", parkingCodeCitation: "Hamilton Zoning By-law 05-200, Section 5 — Parking and Loading." },
  { code: "montreal_metro", slug: "montreal", shortName: "Montréal", longName: "Montréal CMM", state: "QC", country: "CA", signals: 23432, namedPct: 98.6, aadtPct: 99.9, liveSource: null, aadtSource: "Montréal city intersection turning-movement counts + MTQ DJMA + OSM-class synthetic", dotName: "Service de l'urbanisme et de la mobilité (Montréal)", planningOfficeName: "Service de l'urbanisme et de la mobilité", parkingCodeCitation: "Règlement d'urbanisme de la Ville de Montréal (RV 01-282), Section IV — Stationnement." },
  { code: "quebec_city_metro", slug: "quebec-city", shortName: "Québec City", longName: "Québec CMA", state: "QC", country: "CA", signals: 1969, namedPct: 98.6, aadtPct: 99.7, liveSource: null, aadtSource: "MTQ DJMA (Débit Journalier Moyen Annuel, latest 2016-2025) + OSM-class synthetic", dotName: "Service du transport et de la mobilité intelligente (Ville de Québec)", planningOfficeName: "Service de la planification de l'aménagement et de l'environnement", parkingCodeCitation: "Règlement de l'arrondissement de Québec sur l'urbanisme R.V.Q. 1400, Chapitre IV — Stationnement." },
  { code: "vancouver_metro", slug: "vancouver", shortName: "Vancouver", longName: "Metro Vancouver Regional District", state: "BC", country: "CA", signals: 8764, namedPct: 99.8, aadtPct: 99.8, liveSource: null, aadtSource: "Vancouver Open Data Directional Segment Counts (2011-2024) + Permanent Vehicle Counts + OSM-class synthetic", aadtQuality: "synthetic", dotName: "City of Vancouver Engineering — Transportation Division", planningOfficeName: "City of Vancouver Planning, Urban Design and Sustainability", parkingCodeCitation: "Vancouver Parking By-law No. 6059, Sections 4-6 — Off-Street Parking." },
  { code: "calgary_metro", slug: "calgary", shortName: "Calgary", longName: "Calgary CMA", state: "AB", country: "CA", signals: 3804, namedPct: 99.3, aadtPct: 99.9, liveSource: null, aadtSource: "Calgary Open Data Traffic Volumes 2016-2024 + Alberta Transportation LoS 2021 + OSM-class synthetic", dotName: "City of Calgary Transportation Department", planningOfficeName: "Calgary Planning and Development Services", parkingCodeCitation: "Calgary Land Use Bylaw 1P2007, Part 4, Division 5 — Motor Vehicle Parking." },
  { code: "edmonton_metro", slug: "edmonton", shortName: "Edmonton", longName: "Edmonton CMA", state: "AB", country: "CA", signals: 2630, namedPct: 99.8, aadtPct: 99.9, liveSource: null, aadtSource: "Edmonton Open Data AAWDT 2011-2022 + Alberta Transportation LoS 2021 + OSM-class synthetic", dotName: "City of Edmonton Integrated Infrastructure Services — Transportation", planningOfficeName: "Edmonton Urban Planning and Economy", parkingCodeCitation: "Edmonton Zoning Bylaw 20001, Section 6.60 — Motor Vehicle Parking." },
  { code: "winnipeg_metro", slug: "winnipeg", shortName: "Winnipeg", longName: "Winnipeg CMA", state: "MB", country: "CA", signals: 1657, namedPct: 99.8, aadtPct: 100.0, liveSource: null, aadtSource: "Winnipeg Open Data Midblock Counts (aggregated) + MHTIS 2019 + OSM-class synthetic", dotName: "City of Winnipeg Public Works — Transportation Division", planningOfficeName: "Winnipeg Planning, Property and Development Department", parkingCodeCitation: "Winnipeg Zoning By-law 200/2006, Part 5 — Off-Street Parking and Loading." },
  { code: "halifax_metro", slug: "halifax", shortName: "Halifax", longName: "Halifax CMA", state: "NS", country: "CA", signals: 666, namedPct: 99.1, aadtPct: 99.5, liveSource: null, aadtSource: "HRM Open Data Traffic Studies (AAWT, 2023-2026) + OSM-class synthetic", dotName: "Halifax Regional Municipality Transportation and Public Works", planningOfficeName: "HRM Planning and Development", parkingCodeCitation: "Halifax Regional Municipality Land Use By-law (Centre Plan), Part 8 — Off-Street Parking." },

  // ── Tier-9: Mexico (10 metros, signal counts pending extraction) ──
  { code: "mexico_city_metro", slug: "mexico-city", shortName: "Ciudad de México", longName: "Ciudad de México (ZMVM)", state: "CMX", country: "MX", signals: 4765, namedPct: 99.0, aadtPct: 99, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Secretaría de Movilidad (SEMOVI) — Ciudad de México", planningOfficeName: "Secretaría de Desarrollo Urbano y Vivienda (SEDUVI)", parkingCodeCitation: "Reglamento de Construcciones para el Distrito Federal, Título Sexto, Capítulo III — Estacionamientos." },
  { code: "guadalajara_metro", slug: "guadalajara", shortName: "Guadalajara", longName: "Guadalajara ZM", state: "JAL", country: "MX", signals: 1529, namedPct: 90.3, aadtPct: 90.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Secretaría de Transporte del Gobierno de Jalisco", planningOfficeName: "Instituto Metropolitano de Planeación del AMG (IMEPLAN)", parkingCodeCitation: "Reglamento Estatal de Zonificación del Estado de Jalisco, Título III — Estacionamientos." },
  { code: "monterrey_metro", slug: "monterrey", shortName: "Monterrey", longName: "Monterrey ZM", state: "NLE", country: "MX", signals: 1567, namedPct: 100.0, aadtPct: 8.4, liveSource: null, aadtSource: "SICT TDPA 2022 (federal highways only)", dotName: "Secretaría de Movilidad y Planeación Urbana de Nuevo León", planningOfficeName: "Consejo Estatal de Transporte y Vialidad", parkingCodeCitation: "Ley de Asentamientos Humanos del Estado de Nuevo León, Capítulo VI — Estacionamientos." },
  { code: "puebla_metro", slug: "puebla", shortName: "Puebla", longName: "Puebla-Tlaxcala ZM", state: "PUE", country: "MX", signals: 455, namedPct: 96.9, aadtPct: 96.9, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Secretaría de Movilidad y Transporte del Estado de Puebla", planningOfficeName: "Secretaría de Desarrollo Urbano del Municipio de Puebla", parkingCodeCitation: "Reglamento de Tránsito, Movilidad y Seguridad Vial para el Municipio de Puebla, Título Sexto." },
  { code: "tijuana_metro", slug: "tijuana", shortName: "Tijuana", longName: "Tijuana ZM", state: "BCN", country: "MX", signals: 407, namedPct: 99.8, aadtPct: 99.8, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Secretaría de Movilidad Sustentable y Planeación Urbana de Baja California", planningOfficeName: "Instituto Metropolitano de Planeación de Tijuana (IMPLAN)", parkingCodeCitation: "Reglamento de Vialidad y Tránsito Municipal para el Municipio de Tijuana, Capítulo IX." },
  { code: "toluca_metro", slug: "toluca", shortName: "Toluca", longName: "Toluca ZM", state: "MEX", country: "MX", signals: 327, namedPct: 97.9, aadtPct: 97.9, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Secretaría de Movilidad del Estado de México (SEMOV)", planningOfficeName: "Secretaría de Desarrollo Urbano y Obra del Estado de México", parkingCodeCitation: "Código Administrativo del Estado de México, Libro Quinto — Ordenamiento Territorial." },
  { code: "leon_metro", slug: "leon", shortName: "León", longName: "León ZM", state: "GUA", country: "MX", signals: 448, namedPct: 99.6, aadtPct: 99.6, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Dirección General de Movilidad del Municipio de León", planningOfficeName: "Instituto Municipal de Planeación de León (IMPLAN León)", parkingCodeCitation: "Reglamento de los Servicios de Vialidad, Tránsito y Transporte del Municipio de León, Título IV." },
  { code: "juarez_metro", slug: "juarez", shortName: "Ciudad Juárez", longName: "Ciudad Juárez ZM", state: "CHH", country: "MX", signals: 772, namedPct: 100.0, aadtPct: 5.8, liveSource: null, aadtSource: "SICT TDPA 2022 (federal highways only)", dotName: "Dirección General de Tránsito Municipal de Juárez", planningOfficeName: "Instituto Municipal de Investigación y Planeación (IMIP Juárez)", parkingCodeCitation: "Reglamento de Vialidad y Tránsito del Municipio de Juárez, Capítulo XII." },
  { code: "queretaro_metro", slug: "queretaro", shortName: "Querétaro", longName: "Querétaro ZM", state: "QUE", country: "MX", signals: 563, namedPct: 99.3, aadtPct: 99.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Secretaría de Movilidad del Estado de Querétaro", planningOfficeName: "Instituto Municipal de Planeación de Querétaro (IMPLAN)", parkingCodeCitation: "Código Urbano del Estado de Querétaro, Título Sexto — Estacionamientos." },
  { code: "merida_metro", slug: "merida", shortName: "Mérida", longName: "Mérida ZM", state: "YUC", country: "MX", signals: 174, namedPct: 100.0, aadtPct: 100, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Agencia de Transporte del Estado de Yucatán (ATY)", planningOfficeName: "Instituto Municipal de Planeación de Mérida (IMPLAN Mérida)", parkingCodeCitation: "Reglamento de Construcciones del Municipio de Mérida, Título Tercero — Estacionamientos." },

  // ── Tier-9: United Kingdom (7 metros, signal counts pending extraction) ──
  { code: "london_metro", slug: "london", shortName: "London", longName: "Greater London", state: "ENG", country: "UK", signals: 15991, namedPct: 98.9, aadtPct: 72.8, liveSource: null, aadtSource: "DfT Road Traffic Statistics 2024 (major roads)", dotName: "Transport for London (TfL) — Streets", planningOfficeName: "Greater London Authority (GLA) — London Plan", parkingCodeCitation: "London Plan 2021, Policy T6 — Car parking. Plus each LPA's local plan (e.g. Westminster City Plan)." },
  { code: "manchester_uk_metro", slug: "manchester-uk", shortName: "Manchester (UK)", longName: "Greater Manchester", state: "ENG", country: "UK", signals: 4231, namedPct: 99.2, aadtPct: 67.1, liveSource: null, aadtSource: "DfT Road Traffic Statistics 2024 (major roads)", dotName: "Transport for Greater Manchester (TfGM)", planningOfficeName: "Greater Manchester Combined Authority — Places for Everyone", parkingCodeCitation: "Manchester Core Strategy DM3 — Parking Standards (and equivalents across the 10 GM boroughs)." },
  { code: "birmingham_uk_metro", slug: "birmingham-uk", shortName: "Birmingham (UK)", longName: "West Midlands (Birmingham)", state: "ENG", country: "UK", signals: 1993, namedPct: 98.2, aadtPct: 57.4, liveSource: null, aadtSource: "DfT Road Traffic Statistics 2024 (major roads)", dotName: "Transport for West Midlands (TfWM)", planningOfficeName: "West Midlands Combined Authority — Strategic Transport Plan", parkingCodeCitation: "Birmingham Development Plan 2031, TP44 — Car Parking Standards." },
  { code: "glasgow_metro", slug: "glasgow", shortName: "Glasgow", longName: "Glasgow City Region", state: "SCT", country: "UK", signals: 1651, namedPct: 96.5, aadtPct: 53.3, liveSource: null, aadtSource: "DfT Road Traffic Statistics 2024 (major roads)", dotName: "Strathclyde Partnership for Transport (SPT)", planningOfficeName: "Glasgow City Council Planning Authority", parkingCodeCitation: "Glasgow City Development Plan IPG 8 — Car Parking Standards." },
  { code: "edinburgh_metro", slug: "edinburgh", shortName: "Edinburgh", longName: "Edinburgh + Lothians", state: "SCT", country: "UK", signals: 759, namedPct: 95.9, aadtPct: 50.2, liveSource: null, aadtSource: "DfT Road Traffic Statistics 2024 (major roads)", dotName: "Edinburgh Council Place Directorate — Transport and Environment", planningOfficeName: "City of Edinburgh Council Planning Service", parkingCodeCitation: "Edinburgh City Plan 2030 Policy Tra 7 — Car parking standards." },
  { code: "leeds_metro", slug: "leeds", shortName: "Leeds", longName: "West Yorkshire (Leeds-Bradford)", state: "ENG", country: "UK", signals: 1904, namedPct: 97.0, aadtPct: 57.4, liveSource: null, aadtSource: "DfT Road Traffic Statistics 2024 (major roads)", dotName: "West Yorkshire Combined Authority — Transport", planningOfficeName: "Leeds City Council Local Plans Team", parkingCodeCitation: "Leeds Core Strategy Policy T2 — Parking and Highways Standards." },
  { code: "bristol_metro", slug: "bristol", shortName: "Bristol", longName: "Bristol (West of England)", state: "ENG", country: "UK", signals: 1308, namedPct: 96.0, aadtPct: 55.2, liveSource: null, aadtSource: "DfT Road Traffic Statistics 2024 (major roads)", dotName: "West of England Combined Authority — Transport", planningOfficeName: "Bristol City Council Strategic City Planning", parkingCodeCitation: "Bristol Local Plan Policy BCS10 — Transport and Access Improvements." },

  // ── Tier-10 global expansion (OSM signals + roads, no DOT AADT) ───────────
  // Signal counts are populated from artifacts/api-server/src/data/<slug>-signals.json
  // by scripts/src/sync-metro-counts.ts after each OSM fetch. aadtPct=0 since
  // there is no DOT AADT wire for these regions yet — they're "Tier B light".
  // Europe (50)
  { code: "berlin_metro", slug: "berlin", shortName: "Berlin", longName: "Berlin", state: "DE", country: "DE", signals: 9791, namedPct: 99.9, aadtPct: 4.6, liveSource: null, aadtSource: "Berlin Senat Verkehrsdetektion (hourly cross-section archive, 2024-10)", aadtQuality: "measured", dotName: "Senatsverwaltung für Mobilität, Verkehr, Klimaschutz und Umwelt (SenMVKU)", planningOfficeName: "Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen", parkingCodeCitation: "Bauordnung für Berlin (BauO Bln) § 49 — Stellplätze und Fahrradabstellplätze." },
  { code: "hamburg_metro", slug: "hamburg", shortName: "Hamburg", longName: "Hamburg", state: "DE", country: "DE", signals: 6413, namedPct: 99.7, aadtPct: 15.5, liveSource: null, aadtSource: "Hamburg Geoportal (BVM) — Verkehrsstärken DTV (IDW @150m, 326 pts)", aadtQuality: "measured", dotName: "Behörde für Verkehr und Mobilitätswende (BVM)", planningOfficeName: "Behörde für Stadtentwicklung und Wohnen", parkingCodeCitation: "Hamburgische Bauordnung (HBauO) § 48 — Stellplätze." },
  { code: "munich_metro", slug: "munich", shortName: "Munich", longName: "München (Munich)", state: "DE", country: "DE", signals: 3890, namedPct: 99.7, aadtPct: 2.3, liveSource: null, aadtSource: "Bayern BAYSIS — Straßenverkehrszählung SVZ 2021 (DTV Kfz) (IDW @150m, 119 pts)", aadtQuality: "measured", dotName: "Mobilitätsreferat der Landeshauptstadt München", planningOfficeName: "Referat für Stadtplanung und Bauordnung", parkingCodeCitation: "Stellplatzsatzung der Landeshauptstadt München." },
  { code: "cologne_metro", slug: "cologne", shortName: "Cologne", longName: "Köln (Cologne)", state: "DE", country: "DE", signals: 4895, namedPct: 99.7, aadtPct: 97.5, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Amt für Straßen und Verkehrstechnik der Stadt Köln", planningOfficeName: "Stadtplanungsamt Köln", parkingCodeCitation: "Stellplatzsatzung der Stadt Köln (StellplSa Köln)." },
  { code: "frankfurt_metro", slug: "frankfurt", shortName: "Frankfurt", longName: "Frankfurt am Main", state: "DE", country: "DE", signals: 3593, namedPct: 98.8, aadtPct: 92.8, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Straßenverkehrsamt Frankfurt am Main", planningOfficeName: "Stadtplanungsamt Frankfurt", parkingCodeCitation: "Stellplatzsatzung der Stadt Frankfurt am Main." },
  { code: "stuttgart_metro", slug: "stuttgart", shortName: "Stuttgart", longName: "Stuttgart", state: "DE", country: "DE", signals: 2340, namedPct: 97.3, aadtPct: 95.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Amt für öffentliche Ordnung — Verkehrsplanung Stuttgart", planningOfficeName: "Stadtplanungsamt Stuttgart", parkingCodeCitation: "Landesbauordnung Baden-Württemberg (LBO) § 37 — Stellplätze." },
  { code: "dusseldorf_metro", slug: "dusseldorf", shortName: "Düsseldorf", longName: "Düsseldorf", state: "DE", country: "DE", signals: 3067, namedPct: 100, aadtPct: 97.8, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Amt für Verkehrsmanagement Düsseldorf", planningOfficeName: "Stadtplanungsamt Düsseldorf", parkingCodeCitation: "Stellplatzsatzung der Landeshauptstadt Düsseldorf." },
  { code: "leipzig_metro", slug: "leipzig", shortName: "Leipzig", longName: "Leipzig", state: "DE", country: "DE", signals: 1273, namedPct: 99.5, aadtPct: 99.1, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Verkehrs- und Tiefbauamt Leipzig", planningOfficeName: "Stadtplanungsamt Leipzig", parkingCodeCitation: "Sächsische Bauordnung (SächsBO) § 49 — Stellplätze." },
  { code: "dortmund_metro", slug: "dortmund", shortName: "Dortmund", longName: "Dortmund", state: "DE", country: "DE", signals: 1934, namedPct: 99.9, aadtPct: 96.9, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Tiefbauamt Stadt Dortmund", planningOfficeName: "Stadtplanungs- und Bauordnungsamt Dortmund", parkingCodeCitation: "Landesbauordnung NRW (BauO NRW) § 48 — Stellplätze." },
  { code: "bremen_metro", slug: "bremen", shortName: "Bremen", longName: "Bremen", state: "DE", country: "DE", signals: 1311, namedPct: 99.9, aadtPct: 98.2, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Senator für Klimaschutz, Umwelt, Mobilität, Stadtentwicklung und Wohnungsbau", planningOfficeName: "Stadtplanungsamt Bremen", parkingCodeCitation: "Bremische Landesbauordnung (BremLBO) § 49 — Stellplätze." },
  { code: "hannover_metro", slug: "hannover", shortName: "Hannover", longName: "Hannover", state: "DE", country: "DE", signals: 1945, namedPct: 100, aadtPct: 95.5, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Fachbereich Tiefbau — Landeshauptstadt Hannover", planningOfficeName: "Stadtplanungsamt Hannover", parkingCodeCitation: "Niedersächsische Bauordnung (NBauO) § 47 — Einstellplätze." },
  { code: "paris_metro", slug: "paris", shortName: "Paris", longName: "Paris (Île-de-France)", state: "FR", country: "FR", signals: 11276, namedPct: 100, aadtPct: 30.9, liveSource: null, aadtSource: "Paris Open Data — capteurs permanents (IDW @ 150m, 1926 active counters)", aadtQuality: "measured", dotName: "Direction de la Voirie et des Déplacements — Ville de Paris", planningOfficeName: "Direction de l'Urbanisme — Ville de Paris", parkingCodeCitation: "Plan Local d'Urbanisme (PLU) de Paris — Stationnement." },
  { code: "marseille_metro", slug: "marseille", shortName: "Marseille", longName: "Marseille", state: "FR", country: "FR", signals: 2364, namedPct: 100, aadtPct: 92.9, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Direction des Mobilités — Ville de Marseille", planningOfficeName: "Direction de l'Urbanisme — Métropole Aix-Marseille-Provence", parkingCodeCitation: "Plan Local d'Urbanisme intercommunal (PLUi) — Stationnement." },
  { code: "lyon_metro", slug: "lyon", shortName: "Lyon", longName: "Lyon", state: "FR", country: "FR", signals: 4441, namedPct: 100, aadtPct: 74.3, liveSource: null, aadtSource: "Grand Lyon Métropole — Comptages tous véhicules (moyenne jour ouvrable) (IDW @150m, 2334 pts)", aadtQuality: "measured", dotName: "Direction de la Voirie — Métropole de Lyon", planningOfficeName: "Direction de l'Aménagement Urbain — Métropole de Lyon", parkingCodeCitation: "Plan Local d'Urbanisme et de l'Habitat (PLU-H) — Métropole de Lyon." },
  { code: "toulouse_metro", slug: "toulouse", shortName: "Toulouse", longName: "Toulouse", state: "FR", country: "FR", signals: 1804, namedPct: 100, aadtPct: 29.2, liveSource: null, aadtSource: "Toulouse Métropole Open Data — comptages tous véhicules TMJA (IDW @ 150m, 824 counters)", aadtQuality: "measured", dotName: "Direction de la Mobilité Gestion Réseaux — Toulouse Métropole", planningOfficeName: "Direction de l'Urbanisme — Toulouse Métropole", parkingCodeCitation: "Plan Local d'Urbanisme intercommunal-Habitat (PLUi-H) Toulouse Métropole." },
  { code: "nice_metro", slug: "nice", shortName: "Nice", longName: "Nice", state: "FR", country: "FR", signals: 1383, namedPct: 99.8, aadtPct: 98.4, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Direction Mobilité Déplacements — Métropole Nice Côte d'Azur", planningOfficeName: "Direction Aménagement Urbanisme — Métropole Nice Côte d'Azur", parkingCodeCitation: "Plan Local d'Urbanisme métropolitain (PLUm) — Stationnement." },
  { code: "nantes_metro", slug: "nantes", shortName: "Nantes", longName: "Nantes", state: "FR", country: "FR", signals: 753, namedPct: 99.7, aadtPct: 91.6, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Direction Mobilités — Nantes Métropole", planningOfficeName: "Direction Générale au Développement Urbain — Nantes Métropole", parkingCodeCitation: "Plan Local d'Urbanisme métropolitain (PLUm) — Stationnement." },
  { code: "bordeaux_metro", slug: "bordeaux", shortName: "Bordeaux", longName: "Bordeaux", state: "FR", country: "FR", signals: 1870, namedPct: 100, aadtPct: 45.5, liveSource: null, aadtSource: "Bordeaux Métropole Open Data — comptages routiers (mjo, IDW @ 150m, 351 counters)", aadtQuality: "measured", dotName: "Direction Mobilité — Bordeaux Métropole", planningOfficeName: "Direction Générale de l'Aménagement — Bordeaux Métropole", parkingCodeCitation: "Plan Local d'Urbanisme intercommunal (PLU 3.1) — Bordeaux Métropole." },
  { code: "strasbourg_metro", slug: "strasbourg", shortName: "Strasbourg", longName: "Strasbourg", state: "FR", country: "FR", signals: 1167, namedPct: 99.5, aadtPct: 90.9, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Direction de la Mobilité, Espaces publics et naturels — Eurométropole de Strasbourg", planningOfficeName: "Direction de l'Urbanisme et des Territoires — Eurométropole de Strasbourg", parkingCodeCitation: "Plan Local d'Urbanisme intercommunal (PLUi) — Eurométropole de Strasbourg." },
  { code: "rome_metro", slug: "rome", shortName: "Rome", longName: "Roma (Rome)", state: "IT", country: "IT", signals: 2141, namedPct: 100, aadtPct: 98.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Dipartimento Mobilità e Trasporti — Roma Capitale", planningOfficeName: "Dipartimento Programmazione e Attuazione Urbanistica — Roma Capitale", parkingCodeCitation: "Regolamento Edilizio del Comune di Roma — Standards parcheggio." },
  { code: "milan_metro", slug: "milan", shortName: "Milan", longName: "Milano (Milan)", state: "IT", country: "IT", signals: 3657, namedPct: 99.9, aadtPct: 91, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Area Pianificazione e Programmazione Mobilità — Comune di Milano", planningOfficeName: "Direzione Urbanistica — Comune di Milano", parkingCodeCitation: "Piano di Governo del Territorio (PGT) — Norme tecniche di attuazione." },
  { code: "naples_metro", slug: "naples", shortName: "Naples", longName: "Napoli (Naples)", state: "IT", country: "IT", signals: 240, namedPct: 99.2, aadtPct: 96.7, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Servizio Mobilità Sostenibile — Comune di Napoli", planningOfficeName: "Dipartimento Pianificazione Urbanistica — Comune di Napoli", parkingCodeCitation: "Regolamento Urbanistico Edilizio Comunale (RUEC) di Napoli." },
  { code: "turin_metro", slug: "turin", shortName: "Turin", longName: "Torino (Turin)", state: "IT", country: "IT", signals: 3775, namedPct: 100, aadtPct: 97.5, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Divisione Mobilità e Trasporti — Città di Torino", planningOfficeName: "Divisione Urbanistica — Città di Torino", parkingCodeCitation: "Piano Regolatore Generale (PRG) di Torino — Standard parcheggi." },
  { code: "palermo_metro", slug: "palermo", shortName: "Palermo", longName: "Palermo", state: "IT", country: "IT", signals: 299, namedPct: 100, aadtPct: 90.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Settore Mobilità Urbana — Comune di Palermo", planningOfficeName: "Settore Pianificazione Urbanistica — Comune di Palermo", parkingCodeCitation: "Piano Regolatore Generale di Palermo — Standard parcheggi." },
  { code: "bologna_metro", slug: "bologna", shortName: "Bologna", longName: "Bologna", state: "IT", country: "IT", signals: 1032, namedPct: 99.9, aadtPct: 86.8, liveSource: null, aadtSource: "Comune di Bologna — Rilevazione flusso veicoli (spire, 2024) (IDW @150m, 790 pts)", aadtQuality: "measured", dotName: "Settore Mobilità Sostenibile — Comune di Bologna", planningOfficeName: "Settore Piani e Progetti Urbanistici — Comune di Bologna", parkingCodeCitation: "Piano Urbanistico Generale (PUG) di Bologna — Disciplina parcheggi." },
  { code: "florence_metro", slug: "florence", shortName: "Florence", longName: "Firenze (Florence)", state: "IT", country: "IT", signals: 1379, namedPct: 100, aadtPct: 85, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Direzione Nuove Infrastrutture e Mobilità — Comune di Firenze", planningOfficeName: "Direzione Urbanistica — Comune di Firenze", parkingCodeCitation: "Piano Strutturale e Regolamento Urbanistico di Firenze — Standard parcheggi." },
  { code: "genoa_metro", slug: "genoa", shortName: "Genoa", longName: "Genova (Genoa)", state: "IT", country: "IT", signals: 515, namedPct: 99.8, aadtPct: 99, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Direzione Mobilità — Comune di Genova", planningOfficeName: "Direzione Urbanistica — Comune di Genova", parkingCodeCitation: "Piano Urbanistico Comunale (PUC) di Genova — Standard parcheggi." },
  { code: "madrid_metro", slug: "madrid", shortName: "Madrid", longName: "Madrid", state: "ES", country: "ES", signals: 7583, namedPct: 100, aadtPct: 82.8, liveSource: null, aadtSource: "Ayuntamiento de Madrid — Histórico de intensidades por puntos de medida (Feb 2020 snapshot)", aadtQuality: "measured", dotName: "Área de Gobierno de Obras y Equipamientos — Ayuntamiento de Madrid", planningOfficeName: "Área de Gobierno de Urbanismo, Medio Ambiente y Movilidad — Ayuntamiento de Madrid", parkingCodeCitation: "Plan General de Ordenación Urbana (PGOU) de Madrid — Normas zonales." },
  { code: "barcelona_metro", slug: "barcelona", shortName: "Barcelona", longName: "Barcelona", state: "ES", country: "ES", signals: 8092, namedPct: 100, aadtPct: 44.6, liveSource: null, aadtSource: "Open Data BCN — Aforaments de mobilitat (IMD laborables 2024) (IDW @150m, 838 pts)", aadtQuality: "measured", dotName: "Gerència de Mobilitat i Infraestructures — Ajuntament de Barcelona", planningOfficeName: "Gerència d'Urbanisme — Ajuntament de Barcelona", parkingCodeCitation: "Pla General Metropolità (PGM) — Normes urbanístiques d'aparcament." },
  { code: "valencia_metro", slug: "valencia", shortName: "Valencia", longName: "València (Valencia)", state: "ES", country: "ES", signals: 1269, namedPct: 99.9, aadtPct: 96.8, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Regidoria de Mobilitat Sostenible — Ajuntament de València", planningOfficeName: "Àrea d'Urbanisme — Ajuntament de València", parkingCodeCitation: "Pla General d'Ordenació Urbana de València — Normes d'aparcament." },
  { code: "seville_metro", slug: "seville", shortName: "Seville", longName: "Sevilla (Seville)", state: "ES", country: "ES", signals: 1341, namedPct: 99.9, aadtPct: 94.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Área de Movilidad — Ayuntamiento de Sevilla", planningOfficeName: "Gerencia de Urbanismo y Medio Ambiente — Ayuntamiento de Sevilla", parkingCodeCitation: "Plan General de Ordenación Urbanística (PGOU) de Sevilla — Aparcamientos." },
  { code: "zaragoza_metro", slug: "zaragoza", shortName: "Zaragoza", longName: "Zaragoza", state: "ES", country: "ES", signals: 1229, namedPct: 100, aadtPct: 97.5, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Servicio de Movilidad Urbana — Ayuntamiento de Zaragoza", planningOfficeName: "Servicio de Ordenación y Gestión Urbanística — Ayuntamiento de Zaragoza", parkingCodeCitation: "Plan General de Ordenación Urbana (PGOU) de Zaragoza." },
  { code: "malaga_metro", slug: "malaga", shortName: "Málaga", longName: "Málaga", state: "ES", country: "ES", signals: 788, namedPct: 100, aadtPct: 100, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Área de Movilidad — Ayuntamiento de Málaga", planningOfficeName: "Gerencia Municipal de Urbanismo, Obras e Infraestructuras — Málaga", parkingCodeCitation: "Plan General de Ordenación Urbanística (PGOU) de Málaga." },
  { code: "amsterdam_metro", slug: "amsterdam", shortName: "Amsterdam", longName: "Amsterdam", state: "NL", country: "NL", signals: 3352, namedPct: 99.9, aadtPct: 98.2, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Dienst Verkeer en Openbare Ruimte — Gemeente Amsterdam", planningOfficeName: "Dienst Ruimte en Duurzaamheid — Gemeente Amsterdam", parkingCodeCitation: "Nota Parkeernormen Auto — Gemeente Amsterdam." },
  { code: "rotterdam_metro", slug: "rotterdam", shortName: "Rotterdam", longName: "Rotterdam", state: "NL", country: "NL", signals: 2839, namedPct: 100, aadtPct: 3.2, liveSource: null, aadtSource: "Provincie Zuid-Holland — Verkeersintensiteit provinciale wegen (IDW @150m, 6866 pts)", aadtQuality: "measured", dotName: "Cluster Stadsontwikkeling — Verkeer en Vervoer — Gemeente Rotterdam", planningOfficeName: "Cluster Stadsontwikkeling — Gemeente Rotterdam", parkingCodeCitation: "Beleidsregeling Parkeernormen Auto en Fiets — Gemeente Rotterdam." },
  { code: "the_hague_metro", slug: "the-hague", shortName: "The Hague", longName: "Den Haag (The Hague)", state: "NL", country: "NL", signals: 2606, namedPct: 100, aadtPct: 98.9, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Dienst Stedelijke Ontwikkeling — Mobiliteit — Gemeente Den Haag", planningOfficeName: "Dienst Stedelijke Ontwikkeling — Gemeente Den Haag", parkingCodeCitation: "Nota Parkeernormen Den Haag." },
  { code: "brussels_metro", slug: "brussels", shortName: "Brussels", longName: "Bruxelles (Brussels)", state: "BE", country: "BE", signals: 3753, namedPct: 100, aadtPct: 98.2, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Bruxelles Mobilité — Service public régional de Bruxelles", planningOfficeName: "Bruxelles Urbanisme et Patrimoine (urban.brussels)", parkingCodeCitation: "Règlement Régional d'Urbanisme (RRU) — Titre VIII Normes de stationnement." },
  { code: "antwerp_metro", slug: "antwerp", shortName: "Antwerp", longName: "Antwerpen (Antwerp)", state: "BE", country: "BE", signals: 1541, namedPct: 99.9, aadtPct: 98.6, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Stadsontwikkeling — Mobiliteit — Stad Antwerpen", planningOfficeName: "Stadsontwikkeling — Ruimte — Stad Antwerpen", parkingCodeCitation: "Bouwcode Stad Antwerpen — Parkeernormen." },
  { code: "zurich_metro", slug: "zurich", shortName: "Zurich", longName: "Zürich (Zurich)", state: "CH", country: "CH", signals: 1686, namedPct: 99.9, aadtPct: 98, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Dienstabteilung Verkehr — Stadt Zürich", planningOfficeName: "Amt für Städtebau — Stadt Zürich", parkingCodeCitation: "Bau- und Zonenordnung Stadt Zürich (BZO) — Pflichtparkplätze." },
  { code: "geneva_metro", slug: "geneva", shortName: "Geneva", longName: "Genève (Geneva)", state: "CH", country: "CH", signals: 1731, namedPct: 100, aadtPct: 54.4, liveSource: null, aadtSource: "SITG Genève — Comptage du trafic routier (TJM) (IDW @150m, 409 pts)", aadtQuality: "measured", dotName: "Office cantonal des transports — République et canton de Genève", planningOfficeName: "Office de l'urbanisme — République et canton de Genève", parkingCodeCitation: "Règlement relatif aux places de stationnement (RPSFP) — canton de Genève." },
  { code: "vienna_metro", slug: "vienna", shortName: "Vienna", longName: "Wien (Vienna)", state: "AT", country: "AT", signals: 5261, namedPct: 100, aadtPct: 97.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Magistratsabteilung 46 (Verkehrsorganisation und technische Verkehrsangelegenheiten) — Stadt Wien", planningOfficeName: "Magistratsabteilung 21 (Stadtteilplanung und Flächennutzung) — Stadt Wien", parkingCodeCitation: "Wiener Garagengesetz 2008 (WGarG 2008) — Stellplatzverpflichtung." },
  { code: "lisbon_metro", slug: "lisbon", shortName: "Lisbon", longName: "Lisboa (Lisbon)", state: "PT", country: "PT", signals: 2599, namedPct: 100, aadtPct: 98.7, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Direção Municipal de Mobilidade — Câmara Municipal de Lisboa", planningOfficeName: "Direção Municipal de Urbanismo — Câmara Municipal de Lisboa", parkingCodeCitation: "Plano Diretor Municipal (PDM) de Lisboa — Regulamento de estacionamento." },
  { code: "porto_metro", slug: "porto", shortName: "Porto", longName: "Porto", state: "PT", country: "PT", signals: 1365, namedPct: 100, aadtPct: 98.2, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Departamento Municipal de Mobilidade e Transportes — Câmara Municipal do Porto", planningOfficeName: "Departamento Municipal de Planeamento Urbano — Câmara Municipal do Porto", parkingCodeCitation: "Plano Diretor Municipal do Porto — Áreas de estacionamento." },
  { code: "dublin_metro", slug: "dublin", shortName: "Dublin", longName: "Dublin", state: "IE", country: "IE", signals: 3136, namedPct: 99.9, aadtPct: 98.4, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Active Travel and Transportation — Dublin City Council", planningOfficeName: "Planning and Property Development Department — Dublin City Council", parkingCodeCitation: "Dublin City Development Plan 2022–2028 — Chapter 15 Standards: Car Parking." },
  { code: "warsaw_metro", slug: "warsaw", shortName: "Warsaw", longName: "Warszawa (Warsaw)", state: "PL", country: "PL", signals: 3472, namedPct: 99.9, aadtPct: 98.7, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Zarząd Dróg Miejskich w Warszawie (ZDM)", planningOfficeName: "Biuro Architektury i Planowania Przestrzennego — m.st. Warszawa", parkingCodeCitation: "Studium uwarunkowań i kierunków zagospodarowania przestrzennego m.st. Warszawy — wskaźniki miejsc postojowych." },
  { code: "krakow_metro", slug: "krakow", shortName: "Kraków", longName: "Kraków", state: "PL", country: "PL", signals: 860, namedPct: 100, aadtPct: 99.5, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Zarząd Dróg Miasta Krakowa (ZDMK)", planningOfficeName: "Biuro Planowania Przestrzennego Urzędu Miasta Krakowa", parkingCodeCitation: "Studium uwarunkowań i kierunków zagospodarowania przestrzennego Krakowa — standardy miejsc postojowych." },
  { code: "lodz_metro", slug: "lodz", shortName: "Łódź", longName: "Łódź", state: "PL", country: "PL", signals: 941, namedPct: 100, aadtPct: 99.6, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Zarząd Dróg i Transportu w Łodzi (ZDiT)", planningOfficeName: "Miejska Pracownia Urbanistyczna w Łodzi", parkingCodeCitation: "Studium uwarunkowań i kierunków zagospodarowania przestrzennego miasta Łodzi — wskaźniki parkingowe." },
  { code: "prague_metro", slug: "prague", shortName: "Prague", longName: "Praha (Prague)", state: "CZ", country: "CZ", signals: 2073, namedPct: 100, aadtPct: 98.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Technická správa komunikací hl. m. Prahy (TSK)", planningOfficeName: "Institut plánování a rozvoje hl. m. Prahy (IPR)", parkingCodeCitation: "Pražské stavební předpisy (PSP) — § 32 Stání pro vozidla." },
  { code: "budapest_metro", slug: "budapest", shortName: "Budapest", longName: "Budapest", state: "HU", country: "HU", signals: 2833, namedPct: 99.9, aadtPct: 97.9, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Budapest Közút Zrt. — Budapesti Közlekedési Központ (BKK)", planningOfficeName: "Főpolgármesteri Hivatal Várostervezési Főosztály — Budapest", parkingCodeCitation: "Budapesti Településszerkezeti Terv és Fővárosi Rendezési Szabályzat — parkolási normák." },
  { code: "bucharest_metro", slug: "bucharest", shortName: "Bucharest", longName: "București (Bucharest)", state: "RO", country: "RO", signals: 1386, namedPct: 100, aadtPct: 99.9, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Administrația Străzilor București (ASB)", planningOfficeName: "Direcția Urbanism — Primăria Municipiului București", parkingCodeCitation: "Planul Urbanistic General (PUG) al Municipiului București — Norme parcaje." },
  { code: "stockholm_metro", slug: "stockholm", shortName: "Stockholm", longName: "Stockholm", state: "SE", country: "SE", signals: 1770, namedPct: 100, aadtPct: 98, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Trafikkontoret — Stockholms stad", planningOfficeName: "Stadsbyggnadskontoret — Stockholms stad", parkingCodeCitation: "Stockholms stads parkeringstal — riktlinjer för bostads- och arbetsplatsparkering." },
  { code: "oslo_metro", slug: "oslo", shortName: "Oslo", longName: "Oslo", state: "NO", country: "NO", signals: 461, namedPct: 100, aadtPct: 29.3, liveSource: null, aadtSource: "Statens vegvesen — Trafikkdata ÅDT (IDW @150m, 195 pts)", aadtQuality: "measured", dotName: "Bymiljøetaten — Oslo kommune", planningOfficeName: "Plan- og bygningsetaten — Oslo kommune", parkingCodeCitation: "Kommuneplanens arealdel — Parkeringsnormer for Oslo." },
  { code: "copenhagen_metro", slug: "copenhagen", shortName: "Copenhagen", longName: "København (Copenhagen)", state: "DK", country: "DK", signals: 2115, namedPct: 100, aadtPct: 48.4, liveSource: null, aadtSource: "Københavns Kommune — Trafiktælling (AADT motorkøretøjer) (IDW @150m, 619 pts)", aadtQuality: "measured", dotName: "Teknik- og Miljøforvaltningen — Mobilitet — Københavns Kommune", planningOfficeName: "Teknik- og Miljøforvaltningen — Byplan — Københavns Kommune", parkingCodeCitation: "Kommuneplan København — parkeringsnormer." },
  { code: "helsinki_metro", slug: "helsinki", shortName: "Helsinki", longName: "Helsinki", state: "FI", country: "FI", signals: 1727, namedPct: 99.9, aadtPct: 92.9, liveSource: null, aadtSource: "Helsinki HRI — Ajoneuvoliikenteen liikennemäärät (autot/vrk) (IDW @150m, 55699 pts)", aadtQuality: "measured", dotName: "Kaupunkiympäristön toimiala — Liikenne- ja katusuunnittelu — Helsingin kaupunki", planningOfficeName: "Kaupunkiympäristön toimiala — Asemakaavoitus — Helsingin kaupunki", parkingCodeCitation: "Helsingin kaupungin pysäköintipaikkamääräykset." },
  { code: "athens_metro", slug: "athens", shortName: "Athens", longName: "Αθήνα (Athens)", state: "GR", country: "GR", signals: 3245, namedPct: 100, aadtPct: 99.4, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Διεύθυνση Μεταφορών — Δήμος Αθηναίων", planningOfficeName: "Διεύθυνση Σχεδίου Πόλεως — Δήμος Αθηναίων", parkingCodeCitation: "Νέος Οικοδομικός Κανονισμός (Ν.4067/2012) — Θέσεις στάθμευσης." },

  // Asia (35)
  { code: "tokyo_metro", slug: "tokyo", shortName: "Tokyo", longName: "Tokyo (東京)", state: "JP", country: "JP", signals: 16481, namedPct: 93.7, aadtPct: 56.8, liveSource: null, aadtSource: "MLIT 全国道路・街路交通情勢調査（道路交通センサス）令和3年度 — 24h observed volumes", aadtQuality: "measured", dotName: "Tokyo Metropolitan Bureau of Construction (東京都建設局)", planningOfficeName: "Tokyo Metropolitan Bureau of Urban Development (東京都都市整備局)", parkingCodeCitation: "Parking Place Act (駐車場法) and Tokyo Metropolitan Parking Ordinance." },
  { code: "osaka_metro", slug: "osaka", shortName: "Osaka", longName: "Osaka (大阪)", state: "JP", country: "JP", signals: 10099, namedPct: 88.1, aadtPct: 64.5, liveSource: null, aadtSource: "MLIT 全国道路・街路交通情勢調査（道路交通センサス）令和3年度 — 24h observed volumes", aadtQuality: "measured", dotName: "Osaka City Construction Bureau (大阪市建設局)", planningOfficeName: "Osaka City Planning Bureau (大阪市都市計画局)", parkingCodeCitation: "Osaka City Parking Ordinance and Parking Place Act." },
  { code: "yokohama_metro", slug: "yokohama", shortName: "Yokohama", longName: "Yokohama (横浜)", state: "JP", country: "JP", signals: 4867, namedPct: 92.5, aadtPct: 83.9, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Yokohama City Road and Highway Bureau (横浜市道路局)", planningOfficeName: "Yokohama City Housing and Architecture Bureau (横浜市建築局)", parkingCodeCitation: "Yokohama City Parking Ordinance." },
  { code: "nagoya_metro", slug: "nagoya", shortName: "Nagoya", longName: "Nagoya (名古屋)", state: "JP", country: "JP", signals: 4669, namedPct: 92.5, aadtPct: 86.1, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Nagoya City Bureau of Public Works (名古屋市緑政土木局)", planningOfficeName: "Nagoya City Housing and Urban Development Bureau (名古屋市住宅都市局)", parkingCodeCitation: "Nagoya City Parking Ordinance." },
  { code: "sapporo_metro", slug: "sapporo", shortName: "Sapporo", longName: "Sapporo (札幌)", state: "JP", country: "JP", signals: 3146, namedPct: 92.6, aadtPct: 92.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Sapporo City Construction Bureau (札幌市建設局)", planningOfficeName: "Sapporo City Urban Planning Bureau (札幌市都市計画局)", parkingCodeCitation: "Sapporo City Parking Place Ordinance." },
  { code: "fukuoka_metro", slug: "fukuoka", shortName: "Fukuoka", longName: "Fukuoka (福岡)", state: "JP", country: "JP", signals: 1955, namedPct: 90.8, aadtPct: 85.7, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Fukuoka City Road and Underground Improvement Bureau (福岡市道路下水道局)", planningOfficeName: "Fukuoka City Housing and Urban Development Bureau (福岡市住宅都市局)", parkingCodeCitation: "Fukuoka City Parking Ordinance." },
  { code: "seoul_metro", slug: "seoul", shortName: "Seoul", longName: "Seoul (서울)", state: "KR", country: "KR", signals: 2883, namedPct: 99.8, aadtPct: 96.8, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Seoul Metropolitan Government — Traffic Headquarters (서울특별시 도시교통실)", planningOfficeName: "Seoul Metropolitan Government — Urban Planning Bureau (서울특별시 도시계획국)", parkingCodeCitation: "Parking Lot Act (주차장법) and Seoul Metropolitan Parking Ordinance." },
  { code: "busan_metro", slug: "busan", shortName: "Busan", longName: "Busan (부산)", state: "KR", country: "KR", signals: 544, namedPct: 99.6, aadtPct: 98.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Busan Metropolitan City — Traffic Bureau (부산광역시 교통국)", planningOfficeName: "Busan Metropolitan City — Urban Planning Bureau (부산광역시 도시계획국)", parkingCodeCitation: "Busan Metropolitan Parking Ordinance." },
  { code: "incheon_metro", slug: "incheon", shortName: "Incheon", longName: "Incheon (인천)", state: "KR", country: "KR", signals: 316, namedPct: 96.2, aadtPct: 93.4, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Incheon Metropolitan City — Traffic Bureau (인천광역시 교통국)", planningOfficeName: "Incheon Metropolitan City — Urban Planning Bureau (인천광역시 도시계획국)", parkingCodeCitation: "Incheon Metropolitan Parking Ordinance." },
  { code: "mumbai_metro", slug: "mumbai", shortName: "Mumbai", longName: "Mumbai", state: "IND", country: "IN", signals: 1910, namedPct: 100, aadtPct: 99.8, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Brihanmumbai Municipal Corporation (BMC) — Traffic Engineering Department", planningOfficeName: "Mumbai Metropolitan Region Development Authority (MMRDA)", parkingCodeCitation: "Development Control and Promotion Regulations (DCPR) 2034 — Regulation 44 Parking Spaces." },
  { code: "delhi_metro", slug: "delhi", shortName: "Delhi", longName: "Delhi (NCT)", state: "IND", country: "IN", signals: 1283, namedPct: 97, aadtPct: 96.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Public Works Department — Government of NCT of Delhi", planningOfficeName: "Delhi Development Authority (DDA) — Planning Wing", parkingCodeCitation: "Master Plan for Delhi 2041 — Parking Standards." },
  { code: "bangalore_metro", slug: "bangalore", shortName: "Bengaluru", longName: "Bengaluru (Bangalore)", state: "IND", country: "IN", signals: 1366, namedPct: 100, aadtPct: 99.9, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Bruhat Bengaluru Mahanagara Palike (BBMP) — Traffic Engineering Cell", planningOfficeName: "Bangalore Development Authority (BDA)", parkingCodeCitation: "Revised Master Plan 2031 (Bengaluru) — Parking Regulations." },
  { code: "hyderabad_metro", slug: "hyderabad", shortName: "Hyderabad", longName: "Hyderabad", state: "IND", country: "IN", signals: 252, namedPct: 100, aadtPct: 100, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Greater Hyderabad Municipal Corporation (GHMC) — Town Planning Wing", planningOfficeName: "Hyderabad Metropolitan Development Authority (HMDA)", parkingCodeCitation: "GHMC Building Rules — Parking Provisions." },
  { code: "chennai_metro", slug: "chennai", shortName: "Chennai", longName: "Chennai", state: "IND", country: "IN", signals: 437, namedPct: 99.5, aadtPct: 99.1, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Greater Chennai Corporation — Traffic Engineering Department", planningOfficeName: "Chennai Metropolitan Development Authority (CMDA)", parkingCodeCitation: "Second Master Plan for Chennai Metropolitan Area — Parking Norms." },
  { code: "kolkata_metro", slug: "kolkata", shortName: "Kolkata", longName: "Kolkata", state: "IND", country: "IN", signals: 61, namedPct: 100, aadtPct: 100, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Kolkata Municipal Corporation (KMC) — Traffic Department", planningOfficeName: "Kolkata Metropolitan Development Authority (KMDA)", parkingCodeCitation: "KMC Building Rules 2009 — Parking Schedule." },
  { code: "pune_metro", slug: "pune", shortName: "Pune", longName: "Pune", state: "IND", country: "IN", signals: 505, namedPct: 100, aadtPct: 100, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Pune Municipal Corporation (PMC) — Road Department", planningOfficeName: "Pune Metropolitan Region Development Authority (PMRDA)", parkingCodeCitation: "PMC Development Plan — Parking Regulations." },
  { code: "ahmedabad_metro", slug: "ahmedabad", shortName: "Ahmedabad", longName: "Ahmedabad", state: "IND", country: "IN", signals: 66, namedPct: 95.5, aadtPct: 95.5, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Ahmedabad Municipal Corporation (AMC) — Roads & Buildings Department", planningOfficeName: "Ahmedabad Urban Development Authority (AUDA)", parkingCodeCitation: "Comprehensive General Development Control Regulations (CGDCR) — Parking." },
  { code: "hong_kong_metro", slug: "hong-kong", shortName: "Hong Kong", longName: "Hong Kong", state: "HK", country: "HK", signals: 4259, namedPct: 100, aadtPct: 99.4, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Transport Department — HKSAR Government", planningOfficeName: "Planning Department — HKSAR Government", parkingCodeCitation: "Hong Kong Planning Standards and Guidelines (HKPSG) — Chapter 8 Internal Transport Facilities." },
  { code: "singapore_metro", slug: "singapore", shortName: "Singapore", longName: "Singapore", state: "SG", country: "SG", signals: 5391, namedPct: 100, aadtPct: 93.5, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Land Transport Authority (LTA) — Singapore", planningOfficeName: "Urban Redevelopment Authority (URA) — Singapore", parkingCodeCitation: "Code of Practice on Vehicle Parking Provision in Development Proposals (LTA)." },
  { code: "taipei_metro", slug: "taipei", shortName: "Taipei", longName: "Taipei (台北)", state: "TW", country: "TW", signals: 7829, namedPct: 100, aadtPct: 94.6, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Taipei City Department of Transportation (臺北市政府交通局)", planningOfficeName: "Taipei City Department of Urban Development (臺北市政府都市發展局)", parkingCodeCitation: "Taipei City Parking Lot Self-Government Ordinance (臺北市停車場管理自治條例)." },
  { code: "kaohsiung_metro", slug: "kaohsiung", shortName: "Kaohsiung", longName: "Kaohsiung (高雄)", state: "TW", country: "TW", signals: 8267, namedPct: 99.9, aadtPct: 83.7, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Kaohsiung City Transportation Bureau (高雄市政府交通局)", planningOfficeName: "Kaohsiung City Urban Development Bureau (高雄市政府都市發展局)", parkingCodeCitation: "Kaohsiung City Parking Lot Self-Government Ordinance (高雄市停車場管理自治條例)." },
  { code: "bangkok_metro", slug: "bangkok", shortName: "Bangkok", longName: "Bangkok (กรุงเทพมหานคร)", state: "TH", country: "TH", signals: 793, namedPct: 98.5, aadtPct: 96.2, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Bangkok Metropolitan Administration (BMA) — Traffic and Transportation Department", planningOfficeName: "BMA — City Planning and Urban Development Department", parkingCodeCitation: "Bangkok Metropolitan Building Control Ordinance — Parking Provisions (พ.ร.บ. ควบคุมอาคาร)." },
  { code: "ho_chi_minh_metro", slug: "ho-chi-minh", shortName: "Ho Chi Minh City", longName: "Ho Chi Minh City (TP. Hồ Chí Minh)", state: "VN", country: "VN", signals: 2401, namedPct: 100, aadtPct: 99.5, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Department of Transport — Ho Chi Minh City (Sở Giao thông Vận tải TP.HCM)", planningOfficeName: "Department of Planning and Architecture — Ho Chi Minh City (Sở Quy hoạch — Kiến trúc TP.HCM)", parkingCodeCitation: "QCVN 01:2021/BXD — Vietnam Building Code: Regional and Urban Planning, Parking Requirements." },
  { code: "hanoi_metro", slug: "hanoi", shortName: "Hanoi", longName: "Hanoi (Hà Nội)", state: "VN", country: "VN", signals: 1180, namedPct: 99.4, aadtPct: 98.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Department of Transport — Hanoi (Sở Giao thông Vận tải Hà Nội)", planningOfficeName: "Department of Planning and Architecture — Hanoi (Sở Quy hoạch — Kiến trúc Hà Nội)", parkingCodeCitation: "QCVN 01:2021/BXD — Vietnam Building Code: Regional and Urban Planning, Parking Requirements." },
  { code: "manila_metro", slug: "manila", shortName: "Manila", longName: "Manila (Metro Manila)", state: "PH", country: "PH", signals: 1593, namedPct: 100, aadtPct: 98.4, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Metropolitan Manila Development Authority (MMDA) — Traffic Engineering Center", planningOfficeName: "MMDA — Planning Office", parkingCodeCitation: "National Building Code of the Philippines (P.D. 1096), Rule VII Section 707 — Parking Requirements." },
  { code: "jakarta_metro", slug: "jakarta", shortName: "Jakarta", longName: "Jakarta", state: "IDN", country: "ID", signals: 651, namedPct: 100, aadtPct: 99.8, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Dinas Perhubungan DKI Jakarta", planningOfficeName: "Dinas Cipta Karya, Tata Ruang dan Pertanahan DKI Jakarta", parkingCodeCitation: "Perda DKI Jakarta No. 5/2012 tentang Perparkiran." },
  { code: "surabaya_metro", slug: "surabaya", shortName: "Surabaya", longName: "Surabaya", state: "IDN", country: "ID", signals: 533, namedPct: 100, aadtPct: 100, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Dinas Perhubungan Kota Surabaya", planningOfficeName: "Dinas Penataan Ruang Kota Surabaya", parkingCodeCitation: "Perda Kota Surabaya tentang Penyelenggaraan Perparkiran." },
  { code: "kuala_lumpur_metro", slug: "kuala-lumpur", shortName: "Kuala Lumpur", longName: "Kuala Lumpur", state: "MY", country: "MY", signals: 2457, namedPct: 100, aadtPct: 97.4, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Dewan Bandaraya Kuala Lumpur (DBKL) — Department of Urban Transport", planningOfficeName: "DBKL — Department of Planning", parkingCodeCitation: "Kuala Lumpur City Plan 2040 — Parking Standards." },
  { code: "penang_metro", slug: "penang", shortName: "Penang", longName: "Penang (George Town)", state: "MY", country: "MY", signals: 642, namedPct: 100, aadtPct: 97.8, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Majlis Bandaraya Pulau Pinang (MBPP)", planningOfficeName: "Penang Island City Council — Planning Department", parkingCodeCitation: "MBPP Local Plan — Parking Standards." },
  { code: "karachi_metro", slug: "karachi", shortName: "Karachi", longName: "Karachi", state: "PK", country: "PK", signals: 208, namedPct: 99.5, aadtPct: 98.6, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Karachi Metropolitan Corporation (KMC) — Transport & Communications Department", planningOfficeName: "Karachi Development Authority (KDA)", parkingCodeCitation: "Karachi Building & Town Planning Regulations 2002 — Parking Provisions." },
  { code: "tashkent_metro", slug: "tashkent", shortName: "Tashkent", longName: "Toshkent (Tashkent)", state: "UZ", country: "UZ", signals: 1712, namedPct: 99.1, aadtPct: 98.8, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Toshkent shahar hokimiyati — Transport boshqarmasi (Tashkent City Transport Department)", planningOfficeName: "Toshkent shahar bosh me'morchiligi (Chief Architecture Office of Tashkent)", parkingCodeCitation: "O'zbekiston Respublikasi shaharsozlik me'yorlari (Uzbek Urban Planning Norms) — avtoturargoh standartlari." },

  // Middle East (8)
  { code: "dubai_metro", slug: "dubai", shortName: "Dubai", longName: "Dubai", state: "AE", country: "AE", signals: 2205, namedPct: 98.9, aadtPct: 96.5, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Roads and Transport Authority (RTA) — Dubai", planningOfficeName: "Dubai Municipality — Planning Department", parkingCodeCitation: "Dubai Municipality — Parking Standards for Buildings (Administrative Decision 5 of 2018)." },
  { code: "abu_dhabi_metro", slug: "abu-dhabi", shortName: "Abu Dhabi", longName: "Abu Dhabi", state: "AE", country: "AE", signals: 978, namedPct: 97.6, aadtPct: 95.7, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Integrated Transport Centre (ITC) — Department of Municipalities and Transport", planningOfficeName: "Department of Municipalities and Transport — Urban Planning", parkingCodeCitation: "Abu Dhabi Urban Planning Council — Parking Standards Manual." },
  { code: "riyadh_metro", slug: "riyadh", shortName: "Riyadh", longName: "Riyadh (الرياض)", state: "SA", country: "SA", signals: 534, namedPct: 100, aadtPct: 98.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Royal Commission for Riyadh City (RCRC)", planningOfficeName: "Riyadh Municipality (أمانة منطقة الرياض)", parkingCodeCitation: "Saudi Building Code (SBC 802) — Parking Requirements." },
  { code: "tel_aviv_metro", slug: "tel-aviv", shortName: "Tel Aviv", longName: "Tel Aviv (תל אביב)", state: "ISR", country: "IL", signals: 2383, namedPct: 99.9, aadtPct: 98.6, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Tel Aviv-Yafo Municipality — Transportation Department (אגף התנועה)", planningOfficeName: "Tel Aviv-Yafo Municipality — Urban Planning Department (אגף תכנון ובניין עיר)", parkingCodeCitation: "Israel Planning and Building Regulations — Parking Standards (תקנות התכנון והבנייה — חניה)." },
  { code: "istanbul_metro", slug: "istanbul", shortName: "Istanbul", longName: "Istanbul (İstanbul)", state: "TR", country: "TR", signals: 2946, namedPct: 99.8, aadtPct: 99.2, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "İstanbul Büyükşehir Belediyesi — Ulaşım Daire Başkanlığı", planningOfficeName: "İstanbul Büyükşehir Belediyesi — İmar ve Şehircilik Daire Başkanlığı", parkingCodeCitation: "İstanbul Otopark Yönetmeliği." },
  { code: "ankara_metro", slug: "ankara", shortName: "Ankara", longName: "Ankara", state: "TR", country: "TR", signals: 1482, namedPct: 100, aadtPct: 99.1, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Ankara Büyükşehir Belediyesi — Ulaşım Daire Başkanlığı", planningOfficeName: "Ankara Büyükşehir Belediyesi — İmar ve Şehircilik Daire Başkanlığı", parkingCodeCitation: "Otopark Yönetmeliği (Türkiye) — Bakanlık standartları." },
  { code: "doha_metro", slug: "doha", shortName: "Doha", longName: "Doha (الدوحة)", state: "QA", country: "QA", signals: 611, namedPct: 100, aadtPct: 97.1, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Ministry of Transport — Qatar", planningOfficeName: "Ministry of Municipality — Urban Planning Department", parkingCodeCitation: "Qatar Construction Specifications (QCS) — Parking Requirements." },
  { code: "amman_metro", slug: "amman", shortName: "Amman", longName: "Amman (عمّان)", state: "JO", country: "JO", signals: 462, namedPct: 97.6, aadtPct: 96.8, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Greater Amman Municipality (GAM) — Transportation Department", planningOfficeName: "Greater Amman Municipality — Urban Planning Department", parkingCodeCitation: "Jordan Building Regulations — Parking Provisions." },
  { code: "beirut_metro", slug: "beirut", shortName: "Beirut", longName: "Beirut (بيروت)", state: "LB", country: "LB", signals: 218, namedPct: 100, aadtPct: 99.5, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Ministry of Public Works and Transport (وزارة الأشغال العامة والنقل) — Lebanon", planningOfficeName: "Directorate General of Urban Planning (المديرية العامة للتنظيم المدني)", parkingCodeCitation: "Lebanese Building Code — Parking provisions (المرسوم 14969/2005)." },

  // South America (15)
  { code: "sao_paulo_metro", slug: "sao-paulo", shortName: "São Paulo", longName: "São Paulo", state: "BR", country: "BR", signals: 9357, namedPct: 100, aadtPct: 98.1, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Companhia de Engenharia de Tráfego (CET) — Prefeitura de São Paulo", planningOfficeName: "Secretaria Municipal de Urbanismo e Licenciamento — Prefeitura de São Paulo", parkingCodeCitation: "Lei de Parcelamento, Uso e Ocupação do Solo — São Paulo (Lei 16.402/2016)." },
  { code: "rio_de_janeiro_metro", slug: "rio-de-janeiro", shortName: "Rio de Janeiro", longName: "Rio de Janeiro", state: "BR", country: "BR", signals: 4297, namedPct: 100, aadtPct: 99.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Secretaria Municipal de Transportes — Prefeitura do Rio de Janeiro", planningOfficeName: "Secretaria Municipal de Planejamento Urbano — Prefeitura do Rio de Janeiro", parkingCodeCitation: "Plano Diretor de Desenvolvimento Urbano Sustentável do Município do Rio de Janeiro." },
  { code: "brasilia_metro", slug: "brasilia", shortName: "Brasília", longName: "Brasília", state: "BR", country: "BR", signals: 402, namedPct: 100, aadtPct: 99.8, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Departamento de Estradas de Rodagem do DF (DER-DF)", planningOfficeName: "Secretaria de Estado de Desenvolvimento Urbano e Habitação do DF (SEDUH)", parkingCodeCitation: "Plano Diretor de Ordenamento Territorial do Distrito Federal (PDOT)." },
  { code: "salvador_br_metro", slug: "salvador-br", shortName: "Salvador", longName: "Salvador (BA)", state: "BR", country: "BR", signals: 431, namedPct: 100, aadtPct: 100, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Superintendência de Trânsito do Salvador (Transalvador)", planningOfficeName: "Secretaria Municipal de Desenvolvimento e Urbanismo — Prefeitura de Salvador", parkingCodeCitation: "Plano Diretor de Desenvolvimento Urbano de Salvador (PDDU)." },
  { code: "fortaleza_metro", slug: "fortaleza", shortName: "Fortaleza", longName: "Fortaleza", state: "BR", country: "BR", signals: 2294, namedPct: 100, aadtPct: 98.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Autarquia Municipal de Trânsito e Cidadania (AMC) — Fortaleza", planningOfficeName: "Secretaria Municipal de Urbanismo e Meio Ambiente — Fortaleza", parkingCodeCitation: "Plano Diretor Participativo do Município de Fortaleza." },
  { code: "belo_horizonte_metro", slug: "belo-horizonte", shortName: "Belo Horizonte", longName: "Belo Horizonte", state: "BR", country: "BR", signals: 1216, namedPct: 100, aadtPct: 99.6, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "BHTrans (Empresa de Transportes e Trânsito de Belo Horizonte)", planningOfficeName: "Secretaria Municipal de Política Urbana — Belo Horizonte", parkingCodeCitation: "Lei de Parcelamento, Ocupação e Uso do Solo de Belo Horizonte." },
  { code: "buenos_aires_metro", slug: "buenos-aires", shortName: "Buenos Aires", longName: "Buenos Aires", state: "ARG", country: "AR", signals: 7604, namedPct: 100, aadtPct: 93.1, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Secretaría de Transporte y Obras Públicas — Gobierno de la Ciudad de Buenos Aires", planningOfficeName: "Subsecretaría de Registros, Interpretación y Catastro — GCBA", parkingCodeCitation: "Código Urbanístico de la Ciudad Autónoma de Buenos Aires (Ley 6099)." },
  { code: "cordoba_metro", slug: "cordoba", shortName: "Córdoba", longName: "Córdoba (AR)", state: "ARG", country: "AR", signals: 975, namedPct: 100, aadtPct: 99, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Secretaría de Movilidad Urbana — Municipalidad de Córdoba", planningOfficeName: "Secretaría de Planeamiento Urbano — Municipalidad de Córdoba", parkingCodeCitation: "Ordenanza de Ocupación del Suelo de la Ciudad de Córdoba." },
  { code: "rosario_metro", slug: "rosario", shortName: "Rosario", longName: "Rosario", state: "ARG", country: "AR", signals: 2131, namedPct: 100, aadtPct: 98.7, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Secretaría de Movilidad — Municipalidad de Rosario", planningOfficeName: "Secretaría de Planeamiento — Municipalidad de Rosario", parkingCodeCitation: "Código Urbano de Rosario." },
  { code: "santiago_cl_metro", slug: "santiago-cl", shortName: "Santiago", longName: "Santiago de Chile", state: "CL", country: "CL", signals: 9833, namedPct: 100, aadtPct: 99.9, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Ministerio de Transportes y Telecomunicaciones — Programa SECTRA", planningOfficeName: "Secretaría Regional Ministerial de Vivienda y Urbanismo (SEREMI MINVU) Región Metropolitana", parkingCodeCitation: "Plan Regulador Metropolitano de Santiago (PRMS)." },
  { code: "bogota_metro", slug: "bogota", shortName: "Bogotá", longName: "Bogotá", state: "COL", country: "CO", signals: 4917, namedPct: 100, aadtPct: 99.5, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Secretaría Distrital de Movilidad — Alcaldía Mayor de Bogotá", planningOfficeName: "Secretaría Distrital de Planeación — Alcaldía Mayor de Bogotá", parkingCodeCitation: "Plan de Ordenamiento Territorial (POT) de Bogotá — Decreto 555 de 2021." },
  { code: "medellin_metro", slug: "medellin", shortName: "Medellín", longName: "Medellín", state: "COL", country: "CO", signals: 1559, namedPct: 100, aadtPct: 99.6, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Secretaría de Movilidad de Medellín — Alcaldía de Medellín", planningOfficeName: "Departamento Administrativo de Planeación — Alcaldía de Medellín", parkingCodeCitation: "Plan de Ordenamiento Territorial (POT) de Medellín — Acuerdo 48 de 2014." },
  { code: "lima_metro", slug: "lima", shortName: "Lima", longName: "Lima", state: "PE", country: "PE", signals: 3662, namedPct: 100, aadtPct: 99.5, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Autoridad de Transporte Urbano para Lima y Callao (ATU)", planningOfficeName: "Instituto Metropolitano de Planificación — Municipalidad Metropolitana de Lima", parkingCodeCitation: "Reglamento Nacional de Edificaciones (Perú) — Norma A.010 / A.070 / A.080 Estacionamientos." },
  { code: "montevideo_metro", slug: "montevideo", shortName: "Montevideo", longName: "Montevideo", state: "UY", country: "UY", signals: 1435, namedPct: 100, aadtPct: 99.7, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "División Tránsito — Intendencia de Montevideo", planningOfficeName: "Departamento de Planificación — Intendencia de Montevideo", parkingCodeCitation: "Plan de Ordenamiento Territorial de Montevideo (POT) — Estacionamientos." },
  { code: "quito_metro", slug: "quito", shortName: "Quito", longName: "Quito", state: "EC", country: "EC", signals: 2825, namedPct: 100, aadtPct: 96, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Agencia Metropolitana de Tránsito — Municipio del Distrito Metropolitano de Quito", planningOfficeName: "Secretaría de Territorio, Hábitat y Vivienda — Quito", parkingCodeCitation: "Plan de Uso y Gestión del Suelo (PUGS) del Distrito Metropolitano de Quito." },

  // Africa (8)
  { code: "johannesburg_metro", slug: "johannesburg", shortName: "Johannesburg", longName: "Johannesburg", state: "ZA", country: "ZA", signals: 3061, namedPct: 99.9, aadtPct: 97.4, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Johannesburg Roads Agency (JRA)", planningOfficeName: "Department of Development Planning — City of Johannesburg", parkingCodeCitation: "City of Johannesburg Land Use Scheme 2018 — Parking Requirements." },
  { code: "cape_town_metro", slug: "cape-town", shortName: "Cape Town", longName: "Cape Town", state: "ZA", country: "ZA", signals: 3355, namedPct: 100, aadtPct: 99, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Transport Directorate — City of Cape Town", planningOfficeName: "Urban Planning and Design Department — City of Cape Town", parkingCodeCitation: "City of Cape Town Municipal Planning By-law — Parking and Loading Standards." },
  { code: "durban_metro", slug: "durban", shortName: "Durban", longName: "Durban (eThekwini)", state: "ZA", country: "ZA", signals: 1067, namedPct: 100, aadtPct: 99.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "eThekwini Transport Authority", planningOfficeName: "eThekwini Municipality — Development Planning, Environment and Management Unit", parkingCodeCitation: "eThekwini Town Planning Scheme — Parking Provisions." },
  { code: "cairo_metro", slug: "cairo", shortName: "Cairo", longName: "Cairo (القاهرة)", state: "EG", country: "EG", signals: 198, namedPct: 90.9, aadtPct: 90.9, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Cairo Governorate — Traffic Department", planningOfficeName: "General Organization for Physical Planning (GOPP) — Egypt", parkingCodeCitation: "Egyptian Building Code — Parking Requirements (Law 119 of 2008)." },
  { code: "lagos_metro", slug: "lagos", shortName: "Lagos", longName: "Lagos", state: "NG", country: "NG", signals: 150, namedPct: 100, aadtPct: 98.7, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Lagos State Traffic Management Authority (LASTMA)", planningOfficeName: "Lagos State Ministry of Physical Planning and Urban Development", parkingCodeCitation: "Lagos State Urban and Regional Planning and Development Law — Parking Requirements." },
  { code: "nairobi_metro", slug: "nairobi", shortName: "Nairobi", longName: "Nairobi", state: "KE", country: "KE", signals: 21, namedPct: 100, aadtPct: 90.5, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Nairobi Metropolitan Services (NMS) — Roads, Transport & Public Works", planningOfficeName: "Nairobi City County — Urban Planning Department", parkingCodeCitation: "Nairobi City County Integrated Development Plan — Parking Standards." },
  { code: "casablanca_metro", slug: "casablanca", shortName: "Casablanca", longName: "Casablanca (الدار البيضاء)", state: "MAR", country: "MA", signals: 803, namedPct: 99.5, aadtPct: 98, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Casa Transports — Commune Urbaine de Casablanca", planningOfficeName: "Agence Urbaine de Casablanca", parkingCodeCitation: "Plan d'Aménagement Unifié (PAU) — Casablanca, normes de stationnement." },
  { code: "accra_metro", slug: "accra", shortName: "Accra", longName: "Accra", state: "GH", country: "GH", signals: 145, namedPct: 100, aadtPct: 99.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Accra Metropolitan Assembly (AMA) — Transport Department", planningOfficeName: "Greater Accra Regional Coordinating Council — Town and Country Planning", parkingCodeCitation: "National Building Regulations LI 1630 — Parking Provisions (Ghana)." },

  // Oceania (6)
  { code: "sydney_metro", slug: "sydney", shortName: "Sydney", longName: "Sydney", state: "AU", country: "AU", signals: 9865, namedPct: 99.9, aadtPct: 98, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Transport for NSW (TfNSW)", planningOfficeName: "NSW Department of Planning, Housing and Infrastructure", parkingCodeCitation: "RTA Guide to Traffic Generating Developments (NSW) — parking provision rates." },
  { code: "melbourne_metro", slug: "melbourne", shortName: "Melbourne", longName: "Melbourne", state: "AU", country: "AU", signals: 8763, namedPct: 100, aadtPct: 99.6, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Department of Transport and Planning — Victoria", planningOfficeName: "Department of Transport and Planning — Victoria (Planning Division)", parkingCodeCitation: "Victoria Planning Provisions — Clause 52.06 Car Parking." },
  { code: "brisbane_metro", slug: "brisbane", shortName: "Brisbane", longName: "Brisbane", state: "AU", country: "AU", signals: 5194, namedPct: 100, aadtPct: 99.1, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Department of Transport and Main Roads (TMR) — Queensland", planningOfficeName: "Brisbane City Council — City Planning and Sustainability", parkingCodeCitation: "Brisbane City Plan 2014 — Transport, Access, Parking and Servicing Code." },
  { code: "perth_metro", slug: "perth", shortName: "Perth", longName: "Perth", state: "AU", country: "AU", signals: 2900, namedPct: 100, aadtPct: 99.9, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Main Roads Western Australia", planningOfficeName: "Department of Planning, Lands and Heritage — Western Australia", parkingCodeCitation: "State Planning Policy 4.2 (Activity Centres) and local planning schemes — Parking standards." },
  { code: "adelaide_metro", slug: "adelaide", shortName: "Adelaide", longName: "Adelaide", state: "AU", country: "AU", signals: 1885, namedPct: 100, aadtPct: 99.4, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Department for Infrastructure and Transport — South Australia", planningOfficeName: "Department for Trade and Investment — Planning and Land Use Services (SA)", parkingCodeCitation: "Planning and Design Code (SA) — Off-Street Car Parking Requirements." },
  { code: "auckland_metro", slug: "auckland", shortName: "Auckland", longName: "Auckland", state: "NZ", country: "NZ", signals: 3269, namedPct: 100, aadtPct: 99.8, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Auckland Transport (AT)", planningOfficeName: "Auckland Council — Plans and Places", parkingCodeCitation: "Auckland Unitary Plan — Chapter E27 Transport (Parking and Loading)." },
  { code: "wellington_metro", slug: "wellington", shortName: "Wellington", longName: "Wellington", state: "NZ", country: "NZ", signals: 354, namedPct: 100, aadtPct: 100, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Waka Kotahi NZ Transport Agency — Wellington region", planningOfficeName: "Wellington City Council — City Design and District Plan", parkingCodeCitation: "Wellington City District Plan — Transport rules: Parking, loading and access." },

  // Eastern Europe (1) — Russia removed.
  { code: "kyiv_metro", slug: "kyiv", shortName: "Kyiv", longName: "Kyiv (Київ)", state: "UA", country: "UA", signals: 1424, namedPct: 99.9, aadtPct: 98.1, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Kyiv City State Administration — Department of Transport Infrastructure (Департамент транспортної інфраструктури КМДА)", planningOfficeName: "Kyiv City State Administration — Department of Urban Planning and Architecture", parkingCodeCitation: "DBN B.2.3-5:2018 — Streets and Roads of Settlements (Ukrainian Building Norms) — Parking Standards." },

  // Central America / Caribbean (2) — Havana (Cuba) removed: OFAC-sanctioned / Stripe-prohibited.
  { code: "panama_city_metro", slug: "panama-city", shortName: "Panama City", longName: "Panama City", state: "PAN", country: "PA", signals: 264, namedPct: 99.6, aadtPct: 97.7, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Autoridad del Tránsito y Transporte Terrestre (ATTT) — Panamá", planningOfficeName: "Municipio de Panamá — Dirección de Planificación Urbana", parkingCodeCitation: "Reglamento de Urbanizaciones — Municipio de Panamá, Capítulo Estacionamientos." },
  { code: "san_jose_cr_metro", slug: "san-jose-cr", shortName: "San José", longName: "San José (CR)", state: "CR", country: "CR", signals: 523, namedPct: 100, aadtPct: 97.7, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Ministerio de Obras Públicas y Transportes (MOPT) — Costa Rica", planningOfficeName: "Instituto Nacional de Vivienda y Urbanismo (INVU) — Costa Rica", parkingCodeCitation: "Reglamento de Construcciones de Costa Rica — Estacionamientos." },
  { code: "dhaka_metro", slug: "dhaka", shortName: "Dhaka", longName: "Dhaka (ঢাকা)", state: "BD", country: "BD", signals: 95, namedPct: 100, aadtPct: 100, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Dhaka Transport Coordination Authority (DTCA) — ঢাকা পরিবহন সমন্বয় কর্তৃপক্ষ", planningOfficeName: "Rajdhani Unnayan Kartripakkha (RAJUK) — Capital Development Authority", parkingCodeCitation: "Dhaka Imarat Nirman Bidhimala 2008 (Dhaka Building Construction Rules) — off-street parking provisions." },
  { code: "addis_ababa_metro", slug: "addis-ababa", shortName: "Addis Ababa", longName: "Addis Ababa (አዲስ አበባ)", state: "ET", country: "ET", signals: 72, namedPct: 94.4, aadtPct: 94.4, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Addis Ababa Traffic Management Authority (AATMA) — የአዲስ አበባ ትራፊክ ማኔጅመንት ባለሥልጣን", planningOfficeName: "Addis Ababa Plan and Development Commission — City Planning", parkingCodeCitation: "Ethiopian Building Proclamation No. 624/2009 & Regulation No. 243/2011 — parking provisions." },
  { code: "dar_es_salaam_metro", slug: "dar-es-salaam", shortName: "Dar es Salaam", longName: "Dar es Salaam", state: "TZ", country: "TZ", signals: 52, namedPct: 100, aadtPct: 98.1, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Land Transport Regulatory Authority (LATRA) — Dar Rapid Transit Agency (DART)", planningOfficeName: "Dar es Salaam City Council — Department of Urban Planning", parkingCodeCitation: "Urban Planning (Planning and Space Standards) Regulations 2018 (GN No. 93) — off-street parking standards." },
  { code: "almaty_metro", slug: "almaty", shortName: "Almaty", longName: "Almaty (Алматы)", state: "KZ", country: "KZ", signals: 619, namedPct: 99.7, aadtPct: 99.4, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Almaty City Urban Mobility Department — Алматы қаласының Қалалық мобильділік басқармасы", planningOfficeName: "Almaty City Department of Urban Planning and Urbanism", parkingCodeCitation: "СП РК 3.01-101-2013 (Urban Planning code) & СН РК 3.03-05-2014 'Стоянки автомобилей' — parking-provision standards." },
  { code: "kuwait_city_metro", slug: "kuwait-city", shortName: "Kuwait City", longName: "Kuwait City (مدينة الكويت)", state: "KW", country: "KW", signals: 389, namedPct: 100, aadtPct: 100, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Kuwait Municipality (بلدية الكويت) — General Traffic Department (MOI)", planningOfficeName: "Supreme Council for Planning and Development (المجلس الأعلى للتخطيط والتنمية)", parkingCodeCitation: "Kuwait Municipality construction regulations — Ministerial Resolution No. 206/2009 (as amended) — parking provisions." },
  { code: "muscat_metro", slug: "muscat", shortName: "Muscat", longName: "Muscat (مسقط)", state: "OM", country: "OM", signals: 173, namedPct: 97.7, aadtPct: 97.7, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Muscat Municipality (بلدية مسقط)", planningOfficeName: "Ministry of Housing and Urban Planning (وزارة الإسكان والتخطيط العمراني)", parkingCodeCitation: "Local Order No. 23/92 (Building Regulations for Muscat) & Oman National Planning Standards 2023 — off-street parking." },
  { code: "tunis_metro", slug: "tunis", shortName: "Tunis", longName: "Tunis (تونس)", state: "TUN", country: "TN", signals: 63, namedPct: 100, aadtPct: 100, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Ministère du Transport — Direction Régionale du Transport / Transtu", planningOfficeName: "Agence d'Urbanisme du Grand Tunis (AUGT) — وكالة التعمير لتونس الكبرى", parkingCodeCitation: "Code de l'Aménagement du Territoire et de l'Urbanisme (Loi n°94-122) & PAU de Tunis — stationnement." },
  { code: "dakar_metro", slug: "dakar", shortName: "Dakar", longName: "Dakar", state: "SN", country: "SN", signals: 59, namedPct: 100, aadtPct: 98.3, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Conseil Exécutif des Transports Urbains Durables (CETUD)", planningOfficeName: "Direction de l'Urbanisme et de l'Architecture (DUA) — Ministère de l'Urbanisme", parkingCodeCitation: "Code de l'Urbanisme du Sénégal (Loi n°2008-43 & décret n°2009-1450) — Règlement, stationnement." },
  { code: "belgrade_metro", slug: "belgrade", shortName: "Belgrade", longName: "Belgrade (Београд)", state: "RS", country: "RS", signals: 1359, namedPct: 100, aadtPct: 98.7, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "City of Belgrade Secretariat for Transport — Секретаријат за саобраћај града Београда", planningOfficeName: "Secretariat for Urban Planning & Construction — Urban Planning Institute of Belgrade", parkingCodeCitation: "Pravilnik o opštim pravilima za parcelaciju, regulaciju i izgradnju (Sl. glasnik RS 22/2015) — parking-space provisions." },
  { code: "sofia_metro", slug: "sofia", shortName: "Sofia", longName: "Sofia (София)", state: "BG", country: "BG", signals: 1298, namedPct: 100, aadtPct: 99.6, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Sofia Municipality — Transport & Urban Mobility / Centre for Urban Mobility (ЦГМ)", planningOfficeName: "Sofia Municipality — Directorate for Architecture & Urban Planning (НАГ) / Sofiaplan", parkingCodeCitation: "Наредба № РД-02-20-2/2017 — Annex 6 to Art. 60 (required parking/garage spaces)." },
  { code: "zagreb_metro", slug: "zagreb", shortName: "Zagreb", longName: "Zagreb", state: "HR", country: "HR", signals: 949, namedPct: 100, aadtPct: 98.7, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "City of Zagreb — City Office for Spatial Planning, Construction & Transport", planningOfficeName: "Institute for Spatial Planning of the City of Zagreb (Zavod za prostorno uređenje Grada Zagreba)", parkingCodeCitation: "Generalni urbanistički plan grada Zagreba (GUP) — Odredbe za provođenje (Sl. glasnik Grada Zagreba 19/2024) — parking provision." },
  { code: "vilnius_metro", slug: "vilnius", shortName: "Vilnius", longName: "Vilnius", state: "LT", country: "LT", signals: 416, namedPct: 99.8, aadtPct: 98.1, liveSource: null, aadtSource: "Synthesized from OSM road class (regional calibration)", aadtQuality: "synthetic", dotName: "Vilnius City Municipality — Transport & Mobility administration (Susisiekimo paslaugos)", planningOfficeName: "Vilnius City Municipality — Office of the Chief City Architect (Vyriausiojo miesto architekto skyrius)", parkingCodeCitation: "STR 2.06.04:2014 'Gatvės ir vietinės reikšmės keliai' — minimum off-street parking spaces." },
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

/** Whether a metro counts as measured-AADT for Tier-A purposes.
 *  Synthetic OSM-class baselines do NOT qualify even at 100% snap rate —
 *  they're modeled, not measured, and the Tier-A featured badge promises
 *  real DOT counts behind the number. */
const isMeasuredAadt = (m: MetroCoverage): boolean =>
  (m.aadtQuality ?? "measured") === "measured";

/** Helpers. */
export const TIER_A_METROS = METROS.filter(
  (m) => (m.aadtPct >= TIER_A_AADT_CUTOFF && isMeasuredAadt(m)) || m.code === "atlanta_metro",
);
export const TIER_B_METROS = METROS.filter(
  (m) => !((m.aadtPct >= TIER_A_AADT_CUTOFF && isMeasuredAadt(m)) || m.code === "atlanta_metro"),
);
export const TOTAL_SIGNALS = METROS.reduce((sum, m) => sum + m.signals, 0);
export const TOTAL_METROS = METROS.length;

/** Country → continent for the geographic rollup tiles. Add new entries here
 *  when expanding to new countries. */
const COUNTRY_CONTINENT: Record<string, "North America" | "Europe" | "Asia" | "South America" | "Africa" | "Oceania"> = {
  US: "North America", CA: "North America", MX: "North America",
  PA: "North America", CR: "North America", CU: "North America",
  UK: "Europe", DE: "Europe", FR: "Europe", IT: "Europe", ES: "Europe",
  NL: "Europe", BE: "Europe", CH: "Europe", AT: "Europe", PT: "Europe",
  IE: "Europe", PL: "Europe", CZ: "Europe", HU: "Europe", RO: "Europe",
  SE: "Europe", NO: "Europe", DK: "Europe", FI: "Europe", GR: "Europe",
  RU: "Europe", UA: "Europe",
  JP: "Asia", KR: "Asia", IN: "Asia", HK: "Asia", SG: "Asia",
  TW: "Asia", TH: "Asia", VN: "Asia", PH: "Asia", ID: "Asia", MY: "Asia",
  PK: "Asia", UZ: "Asia",
  AE: "Asia", SA: "Asia", IL: "Asia", TR: "Asia", QA: "Asia", JO: "Asia", LB: "Asia",
  BR: "South America", AR: "South America", CL: "South America",
  CO: "South America", PE: "South America", UY: "South America", EC: "South America",
  ZA: "Africa", EG: "Africa", NG: "Africa", KE: "Africa", MA: "Africa", GH: "Africa",
  AU: "Oceania", NZ: "Oceania",
};
const metroCountry = (m: MetroCoverage): string => m.country ?? "US";

/** Distinct US states + DC actually covered (US-country metros only). */
export const US_STATES_COVERED = new Set(
  METROS.filter((m) => metroCountry(m) === "US").map((m) => m.state),
).size;
/** Distinct countries covered. */
export const COUNTRIES_COVERED = new Set(METROS.map(metroCountry)).size;
/** Distinct continents covered. */
export const CONTINENTS_COVERED = new Set(
  METROS.map((m) => COUNTRY_CONTINENT[metroCountry(m)] ?? "North America"),
).size;

/** Legacy alias — counts every state-level subdivision across all countries
 *  (US states + CA provinces + MX estados + UK constituents). Misleading on
 *  its own ("68 states" is not a thing); prefer US_STATES_COVERED / COUNTRIES_COVERED
 *  for new code. Kept so unmigrated call sites don't break. */
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
  // Mexican estados (Tier-9)
  CMX: "Ciudad de México", JAL: "Jalisco", NLE: "Nuevo León", PUE: "Puebla",
  BCN: "Baja California", MEX: "Estado de México", GUA: "Guanajuato",
  CHH: "Chihuahua", QUE: "Querétaro", YUC: "Yucatán",
  // UK constituent countries (Tier-9)
  ENG: "England", SCT: "Scotland",
  // Tier-10 global (country-level, using ISO 3166-1 alpha-2; alpha-3 for collisions)
  DE: "Germany", FR: "France", IT: "Italy", ES: "Spain", NL: "Netherlands",
  BE: "Belgium", CH: "Switzerland", AT: "Austria", PT: "Portugal", IE: "Ireland",
  PL: "Poland", CZ: "Czechia", HU: "Hungary", RO: "Romania",
  SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland", GR: "Greece",
  JP: "Japan", KR: "South Korea", IND: "India", HK: "Hong Kong",
  SG: "Singapore", TW: "Taiwan", TH: "Thailand", VN: "Vietnam", PH: "Philippines",
  IDN: "Indonesia", MY: "Malaysia", PK: "Pakistan", UZ: "Uzbekistan",
  AE: "United Arab Emirates", SA: "Saudi Arabia", ISR: "Israel", TR: "Türkiye",
  QA: "Qatar", JO: "Jordan", LB: "Lebanon",
  BR: "Brazil", ARG: "Argentina", CL: "Chile", COL: "Colombia",
  PE: "Peru", UY: "Uruguay", EC: "Ecuador",
  ZA: "South Africa", EG: "Egypt", NG: "Nigeria", KE: "Kenya",
  MAR: "Morocco", GH: "Ghana",
  AU: "Australia", NZ: "New Zealand",
  UA: "Ukraine",
  PAN: "Panama", CR: "Costa Rica", CU: "Cuba",
  // Tier-11 global. TUN (alpha-3) for Tunisia — avoids US Tennessee clash.
  BD: "Bangladesh", ET: "Ethiopia", TZ: "Tanzania", KZ: "Kazakhstan",
  KW: "Kuwait", OM: "Oman", TUN: "Tunisia", SN: "Senegal", RS: "Serbia",
  BG: "Bulgaria", HR: "Croatia", LT: "Lithuania",
};

/** Comparator: sort metros by full state name alphabetically, then by AADT%
 *  desc within state (so Tier-A leads its state). */
export function compareByStateThenAadt(a: MetroCoverage, b: MetroCoverage): number {
  const cmp = STATE_NAMES[a.state].localeCompare(STATE_NAMES[b.state]);
  if (cmp !== 0) return cmp;
  return b.aadtPct - a.aadtPct;
}
