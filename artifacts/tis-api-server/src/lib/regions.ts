/**
 * Region registry.
 *
 * The product is engineered to expand from the Atlanta MSA out across
 * the Southeast and eventually nationwide. Three categories of
 * region-specific data exist:
 *
 *   1. **Geographic bounds** — the lat/lon box that limits where a
 *      firm can place a project site.
 *   2. **Jurisdictional guidance** — copy that appears in PDF
 *      methodology + findings ("per City of Atlanta DOT TIS guidance"),
 *      parking-code citations, mitigation language.
 *   3. **Live traffic data source** — which DOT API the analyzer
 *      service queries (GDOT 511, NCDOT, FDOT, etc.).
 *
 * This module owns categories 1 and 2 — pure data, no I/O — so the
 * core engine can stay region-agnostic. The analyzer integration
 * (category 3) is wired separately in artifacts/api-server because it
 * involves outbound HTTP and credentials.
 *
 * Adding a new region:
 *
 *   1. Append a new `Region` const here with bounds + jurisdiction
 *      copy.
 *   2. In artifacts/api-server, add the DOT-specific fetcher and map
 *      it to the region code.
 *   3. (Later) Add a region column to firms + tis_projects, default
 *      to 'atlanta_metro' for back-compat. For now every project is
 *      implicitly Atlanta.
 *
 * See REGIONS.md at the repo root for the full expansion playbook.
 */

export type RegionCode =
  | "atlanta_metro"
  // Tier-0 (first expansion wave — already shipping).
  | "charlotte_metro"
  | "nashville_metro"
  | "tampa_metro"
  | "orlando_metro"
  | "raleigh_durham_metro"
  | "miami_dade_metro"
  // Tier-1 (use existing state DOTs we already wired — GDOT/NCDOT/TDOT/FDOT).
  | "jacksonville_metro"
  | "memphis_metro"
  | "knoxville_metro"
  | "chattanooga_metro"
  | "savannah_metro"
  | "asheville_metro"
  | "wilmington_metro"
  | "triad_metro"
  // Tier-2 (new state-DOT integrations: ALDOT, VDOT, SCDOT, KYTC, LADOTD).
  | "birmingham_metro"
  | "hampton_roads_metro"
  | "richmond_metro"
  | "charleston_sc_metro"
  | "columbia_sc_metro"
  | "louisville_metro"
  | "new_orleans_metro"
  // Tier-3 (smaller markets, all reuse existing state DOTs).
  | "lexington_metro"
  | "mobile_metro"
  | "huntsville_metro"
  | "pensacola_metro"
  | "fayetteville_metro"
  | "greenville_nc_metro"
  | "augusta_metro"
  | "macon_metro"
  // Tier-4 (Coast + Midwest + Westward expansion — 13 new states).
  | "washington_dc_metro"
  | "baltimore_metro"
  | "philadelphia_metro"
  | "pittsburgh_metro"
  | "new_york_metro"
  | "boston_metro"
  | "chicago_metro"
  | "detroit_metro"
  | "twin_cities_metro"
  | "cleveland_metro"
  | "columbus_oh_metro"
  | "cincinnati_metro"
  | "indianapolis_metro"
  | "st_louis_metro"
  | "kansas_city_metro"
  | "milwaukee_metro"
  | "houston_metro"
  | "dallas_fort_worth_metro"
  | "austin_metro"
  | "san_antonio_metro"
  // Tier-5 (West Coast + Mountain West expansion — 8 new states).
  | "los_angeles_metro"
  | "sf_bay_metro"
  | "san_diego_metro"
  | "sacramento_metro"
  | "inland_empire_metro"
  | "fresno_metro"
  | "portland_metro"
  | "seattle_metro"
  | "las_vegas_metro"
  | "phoenix_metro"
  | "tucson_metro"
  | "denver_metro"
  | "salt_lake_city_metro"
  | "albuquerque_metro"
  // Tier-6 (50-state coverage — 20 new states for the "all 50" claim).
  | "hartford_metro"
  | "providence_metro"
  | "manchester_metro"
  | "burlington_vt_metro"
  | "portland_me_metro"
  | "trenton_metro"
  | "charleston_wv_metro"
  | "jackson_ms_metro"
  | "little_rock_metro"
  | "oklahoma_city_metro"
  | "tulsa_metro"
  | "des_moines_metro"
  | "omaha_metro"
  | "wichita_metro"
  | "fargo_metro"
  | "sioux_falls_metro"
  | "boise_metro"
  | "billings_metro"
  | "cheyenne_metro"
  | "anchorage_metro"
  | "honolulu_metro"
  // Tier-8 (Canada — 10 metros across 7 provinces).
  | "toronto_metro"
  | "montreal_metro"
  | "vancouver_metro"
  | "calgary_metro"
  | "ottawa_metro"
  | "edmonton_metro"
  | "winnipeg_metro"
  | "quebec_city_metro"
  | "hamilton_metro"
  | "halifax_metro"
  // Tier-9 (Mexico — 10 metros across 10 estados).
  | "mexico_city_metro"
  | "guadalajara_metro"
  | "monterrey_metro"
  | "puebla_metro"
  | "tijuana_metro"
  | "toluca_metro"
  | "leon_metro"
  | "juarez_metro"
  | "queretaro_metro"
  | "merida_metro"
  // Tier-9 (United Kingdom — 7 metros across England + Scotland).
  | "london_metro"
  | "manchester_uk_metro"
  | "birmingham_uk_metro"
  | "glasgow_metro"
  | "edinburgh_metro"
  | "leeds_metro"
  | "bristol_metro"
  // Tier-7 (50+ secondary metros in already-wired states — depth push).
  | "rochester_ny_metro" | "buffalo_metro" | "syracuse_metro" | "albany_metro"
  | "toledo_metro" | "akron_metro" | "dayton_metro" | "youngstown_metro"
  | "grand_rapids_metro" | "lansing_metro" | "ann_arbor_metro" | "flint_metro"
  | "allentown_metro" | "harrisburg_metro" | "scranton_metro" | "erie_metro"
  | "worcester_metro" | "springfield_ma_metro"
  | "new_haven_metro" | "bridgeport_metro"
  | "fort_wayne_metro" | "south_bend_metro" | "evansville_metro"
  | "madison_metro" | "green_bay_metro"
  | "springfield_il_metro" | "rockford_metro" | "peoria_metro" | "champaign_metro"
  | "el_paso_metro" | "corpus_christi_metro" | "lubbock_metro" | "mcallen_metro"
  | "bakersfield_metro" | "stockton_metro" | "modesto_metro" | "oxnard_metro"
  | "colorado_springs_metro" | "fort_collins_metro"
  | "reno_metro"
  | "spokane_metro" | "tacoma_metro"
  | "eugene_metro" | "salem_or_metro"
  | "provo_metro" | "ogden_metro"
  | "rochester_mn_metro" | "duluth_metro"
  | "fort_lauderdale_metro" | "west_palm_beach_metro" | "daytona_beach_metro"
  | "lakeland_metro" | "tallahassee_metro" | "fort_myers_metro"
  | "roanoke_metro" | "charlottesville_metro"
  | "springfield_mo_metro" | "columbia_mo_metro"
  | "cedar_rapids_metro"
  // Tier-10 (global expansion — 129 net-new metros across 58 countries on 6 continents).
  // Europe continental (50)
  | "berlin_metro" | "hamburg_metro" | "munich_metro" | "cologne_metro" | "frankfurt_metro"
  | "stuttgart_metro" | "dusseldorf_metro" | "leipzig_metro" | "dortmund_metro" | "bremen_metro"
  | "hannover_metro"
  | "paris_metro" | "marseille_metro" | "lyon_metro" | "toulouse_metro" | "nice_metro"
  | "nantes_metro" | "bordeaux_metro" | "strasbourg_metro"
  | "rome_metro" | "milan_metro" | "naples_metro" | "turin_metro" | "palermo_metro"
  | "bologna_metro" | "florence_metro" | "genoa_metro"
  | "madrid_metro" | "barcelona_metro" | "valencia_metro" | "seville_metro" | "zaragoza_metro"
  | "malaga_metro"
  | "amsterdam_metro" | "rotterdam_metro" | "the_hague_metro"
  | "brussels_metro" | "antwerp_metro"
  | "zurich_metro" | "geneva_metro"
  | "vienna_metro"
  | "lisbon_metro" | "porto_metro"
  | "dublin_metro"
  | "warsaw_metro" | "krakow_metro" | "lodz_metro"
  | "prague_metro"
  | "budapest_metro"
  | "bucharest_metro"
  | "stockholm_metro"
  | "oslo_metro"
  | "copenhagen_metro"
  | "helsinki_metro"
  | "athens_metro"
  // Asia (35) — China replaced by other Asian/EU markets due to OSM GCJ-02 coordinate
  // shifting (~500m offset) making snap-to-road unreliable for TIS use.
  | "tokyo_metro" | "osaka_metro" | "yokohama_metro" | "nagoya_metro" | "sapporo_metro"
  | "fukuoka_metro"
  | "seoul_metro" | "busan_metro" | "incheon_metro"
  | "mumbai_metro" | "delhi_metro" | "bangalore_metro" | "hyderabad_metro" | "chennai_metro"
  | "kolkata_metro" | "pune_metro" | "ahmedabad_metro"
  | "hong_kong_metro"
  | "singapore_metro"
  | "taipei_metro" | "kaohsiung_metro"
  | "bangkok_metro"
  | "ho_chi_minh_metro" | "hanoi_metro"
  | "manila_metro"
  | "jakarta_metro" | "surabaya_metro"
  | "kuala_lumpur_metro" | "penang_metro"
  | "karachi_metro"
  | "tashkent_metro"
  // Middle East (8)
  | "dubai_metro" | "abu_dhabi_metro"
  | "riyadh_metro"
  | "tel_aviv_metro"
  | "istanbul_metro" | "ankara_metro"
  | "doha_metro"
  | "amman_metro"
  | "beirut_metro"
  // South America (15)
  | "sao_paulo_metro" | "rio_de_janeiro_metro" | "brasilia_metro" | "salvador_br_metro"
  | "fortaleza_metro" | "belo_horizonte_metro"
  | "buenos_aires_metro" | "cordoba_metro" | "rosario_metro"
  | "santiago_cl_metro"
  | "bogota_metro" | "medellin_metro"
  | "lima_metro"
  | "montevideo_metro"
  | "quito_metro"
  // Africa (8)
  | "johannesburg_metro" | "cape_town_metro" | "durban_metro"
  | "cairo_metro"
  | "lagos_metro"
  | "nairobi_metro"
  | "casablanca_metro"
  | "accra_metro"
  // Oceania (6)
  | "sydney_metro" | "melbourne_metro" | "brisbane_metro" | "perth_metro" | "adelaide_metro"
  | "auckland_metro" | "wellington_metro"
  // Eastern Europe (1) — Russia removed (censorship + non-trivial customer-go-to-market risk).
  | "kyiv_metro"
  // Central America / Caribbean (3)
  | "panama_city_metro" | "san_jose_cr_metro" | "havana_metro"
  // Reserved (planned but not yet wired).
  | "greenville_metro";

export type LatLonBox = {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
};

export type Region = {
  code: RegionCode;
  /** Human-readable name for UI + PDF copy. */
  displayName: string;
  /** Geographic bounding box for project-site coordinates. */
  bounds: LatLonBox;
  /** State the metro is in — drives DOT lookup. */
  stateCode: "GA" | "NC" | "TN" | "AL" | "FL" | "SC" | "VA" | "KY" | "LA"
    | "DC" | "MD" | "PA" | "NY" | "MA" | "IL" | "MI" | "MN" | "OH"
    | "IN" | "MO" | "WI" | "TX"
    | "CA" | "OR" | "WA" | "NV" | "AZ" | "CO" | "UT" | "NM"
    | "CT" | "RI" | "NH" | "VT" | "ME" | "NJ" | "WV" | "MS" | "AR" | "OK"
    | "IA" | "NE" | "KS" | "ND" | "SD" | "ID" | "MT" | "WY" | "AK" | "HI"
    | "ON" | "QC" | "BC" | "AB" | "MB" | "NS"  // Canadian provinces (Tier-8)
    | "CMX" | "JAL" | "NLE" | "PUE" | "BCN" | "MEX" | "GUA" | "CHH" | "QUE" | "YUC"  // Mexican estados (Tier-9)
    | "ENG" | "SCT"  // UK countries (Tier-9). SCT used instead of SC to avoid SC=South Carolina clash.
    // Tier-10 global (ISO 3166-1 alpha-2, with alpha-3 fallback for any code that collides
    // with a US-state two-letter code: COL/IDN/ISR/IND/MAR/PAN).
    | "DE" | "FR" | "IT" | "ES" | "NL" | "BE" | "CH" | "AT" | "PT" | "IE"
    | "PL" | "CZ" | "HU" | "RO" | "SE" | "NO" | "DK" | "FI" | "GR"
    | "JP" | "KR" | "IND" | "HK" | "SG" | "TW" | "TH" | "VN" | "PH"
    | "IDN" | "MY" | "PK" | "UZ"
    | "AE" | "SA" | "ISR" | "TR" | "QA" | "JO" | "LB"
    | "BR" | "ARG" | "CL" | "COL" | "PE" | "UY" | "EC"
    | "ZA" | "EG" | "NG" | "KE" | "MAR" | "GH"
    | "AU" | "NZ"
    | "UA"
    | "PAN" | "CR" | "CU";
  /** Country — defaults to "US" when omitted (back-compat for all pre-Tier-8 regions). */
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
    | "PA" | "CR" | "CU";
  /** Jurisdictional copy that gets substituted into methodology/findings strings. */
  jurisdiction: {
    /** "City of Atlanta DOT" — used in TIS-mitigation findings. */
    dotName: string;
    /** "Office of Mobility Planning" — used in major-mitigation language. */
    planningOfficeName: string;
    /** "City of Atlanta Zoning Ordinance, Article 10 — Off-Street Parking and Loading." — parking citation. */
    parkingCodeCitation: string;
  };
  /** Identifier the analyzer service uses to pick the right DOT fetcher. */
  dataSourceId: "gdot_511" | "ncdot" | "tdot" | "aldot" | "fdot" | "scdot" | "vdot" | "kytc" | "ladotd"
    | "ddot_dc" | "mdot_md" | "penndot" | "nysdot" | "massdot"
    | "idot" | "mdot_mi" | "mndot" | "odot_oh" | "indot" | "modot" | "wisdot" | "txdot"
    | "caltrans" | "odot_or" | "wsdot" | "nvdot" | "adot" | "cdot_co" | "udot" | "nmdot"
    | "ctdot" | "ridot" | "nhdot" | "vtrans" | "medot" | "njdot" | "wvdot" | "mdot_ms"
    | "ardot" | "odot_ok" | "iadot" | "ndor" | "ksdot" | "nddot" | "sddot"
    | "itd" | "mdt" | "wydot" | "akdot" | "hidot"
    | "mto" | "mtq" | "moti_bc" | "ab_transportation" | "mb_infrastructure" | "ns_public_works"
    | "sict" | "dft"  // Tier-9: SICT Mexico federal, DfT UK national
    | "osm_only";  // Tier-10: no DOT integration — OSM signals + roads only (no AADT).
  /** Whether this region is currently shipping (false = reserved/planned only). */
  active: boolean;
};

export const ATLANTA_METRO: Region = {
  code: "atlanta_metro",
  displayName: "Atlanta MSA",
  bounds: {
    latMin: 33.4,
    latMax: 34.2,
    lonMin: -84.9,
    lonMax: -83.9,
  },
  stateCode: "GA",
  jurisdiction: {
    dotName: "City of Atlanta DOT",
    planningOfficeName: "City of Atlanta Office of Mobility Planning",
    parkingCodeCitation:
      "City of Atlanta Zoning Ordinance, Article 10 — Off-Street Parking and Loading.",
  },
  dataSourceId: "gdot_511",
  active: true,
};

/**
 * Registry of all regions, indexed by code. Inactive entries are
 * placeholders for the Southeast-expansion roadmap and not yet
 * exposed to the product.
 */
export const REGIONS: Record<RegionCode, Region> = {
  atlanta_metro: ATLANTA_METRO,
  // Below are scaffolds only — bounds + DOT integration to be filled
  // when each metro gets greenlit. Marked inactive so any code path
  // that iterates REGIONS can filter them out.
  charlotte_metro: {
    code: "charlotte_metro",
    displayName: "Charlotte MSA",
    // Charlotte-Concord-Gastonia MSA spans NC + SC. Bounds cover the
    // 10-county area (Mecklenburg + surrounding NC + York/Lancaster SC).
    bounds: { latMin: 34.5, latMax: 35.7, lonMin: -81.4, lonMax: -80.3 },
    stateCode: "NC",
    jurisdiction: {
      dotName: "Charlotte DOT (CDOT)",
      planningOfficeName: "Charlotte-Mecklenburg Planning Department",
      parkingCodeCitation:
        "Charlotte Unified Development Ordinance (UDO), Article 19 — Parking.",
    },
    dataSourceId: "ncdot",
    active: true,
  },
  nashville_metro: {
    code: "nashville_metro",
    displayName: "Nashville MSA",
    // Nashville-Davidson-Murfreesboro-Franklin MSA. Covers Davidson +
    // 13 surrounding counties.
    bounds: { latMin: 35.7, latMax: 36.7, lonMin: -87.5, lonMax: -85.9 },
    stateCode: "TN",
    jurisdiction: {
      dotName: "Nashville DOT (NDOT)",
      planningOfficeName: "Metro Nashville Planning Department",
      parkingCodeCitation:
        "Metropolitan Nashville Zoning Code, Title 17 — Parking and Loading.",
    },
    dataSourceId: "tdot",
    active: true,
  },
  tampa_metro: {
    code: "tampa_metro",
    displayName: "Tampa MSA",
    // Tampa-St. Petersburg-Clearwater MSA: Hillsborough, Pinellas,
    // Pasco, Hernando counties.
    bounds: { latMin: 27.5, latMax: 28.7, lonMin: -83.0, lonMax: -82.0 },
    stateCode: "FL",
    jurisdiction: {
      dotName: "City of Tampa Transportation Division",
      planningOfficeName: "Tampa Planning Commission",
      parkingCodeCitation:
        "City of Tampa Land Development Code, Chapter 27 — Off-Street Parking.",
    },
    dataSourceId: "fdot",
    active: true,
  },
  orlando_metro: {
    code: "orlando_metro",
    displayName: "Orlando MSA",
    // Orlando-Kissimmee-Sanford MSA: Orange, Seminole, Lake, Osceola.
    // South-west edges tightened to avoid catching Lakeland (28.04, -81.95).
    bounds: { latMin: 28.2, latMax: 29.0, lonMin: -81.7, lonMax: -80.7 },
    stateCode: "FL",
    jurisdiction: {
      dotName: "City of Orlando Transportation Engineering Division",
      planningOfficeName: "City of Orlando Planning Division",
      parkingCodeCitation:
        "Orlando Land Development Code, Chapter 61 — Off-Street Parking and Loading.",
    },
    dataSourceId: "fdot",
    active: true,
  },
  raleigh_durham_metro: {
    code: "raleigh_durham_metro",
    displayName: "Raleigh-Durham CSA",
    // Raleigh-Durham-Cary CSA: Wake, Durham, Orange, Chatham, Franklin,
    // Johnston, Granville, Person, Vance counties.
    bounds: { latMin: 35.4, latMax: 36.5, lonMin: -79.2, lonMax: -78.0 },
    stateCode: "NC",
    jurisdiction: {
      // Raleigh is the dominant jurisdiction across the CSA. Per-project
      // routing to Durham/Chapel Hill is handled downstream from
      // the city's planning office, not here.
      dotName: "Raleigh Department of Transportation",
      planningOfficeName: "Raleigh Department of City Planning",
      parkingCodeCitation:
        "Raleigh Unified Development Ordinance (UDO), Article 7.1 — Parking.",
    },
    dataSourceId: "ncdot",
    active: true,
  },
  miami_dade_metro: {
    code: "miami_dade_metro",
    displayName: "Miami-Dade County",
    // Bounds cover Miami-Dade county. Broward + Palm Beach (full
    // South Florida MSA) are deliberately excluded; ship them as
    // separate regions if customer signal warrants.
    bounds: { latMin: 25.1, latMax: 26.0, lonMin: -80.9, lonMax: -80.1 },
    stateCode: "FL",
    jurisdiction: {
      dotName: "Miami-Dade Department of Transportation and Public Works",
      planningOfficeName:
        "Miami-Dade Regulatory and Economic Resources Department",
      parkingCodeCitation:
        "Miami-Dade County Code, Chapter 33 — Zoning, Article XXVII — Off-Street Parking.",
    },
    dataSourceId: "fdot",
    active: true,
  },
  // ── Tier-1: existing state DOTs (GDOT/NCDOT/TDOT/FDOT already wired) ──
  jacksonville_metro: {
    code: "jacksonville_metro",
    displayName: "Jacksonville MSA",
    // Jacksonville-St. Marys MSA: Duval, St. Johns, Clay, Nassau, Baker counties.
    bounds: { latMin: 30.0, latMax: 30.9, lonMin: -82.2, lonMax: -81.3 },
    stateCode: "FL",
    jurisdiction: {
      dotName: "Jacksonville Public Works",
      planningOfficeName: "Jacksonville Planning and Development Dept.",
      parkingCodeCitation:
        "City of Jacksonville Zoning Code, Part 4 — Off-Street Parking.",
    },
    dataSourceId: "fdot",
    active: true,
  },
  memphis_metro: {
    code: "memphis_metro",
    displayName: "Memphis MSA",
    // Memphis MSA: Shelby + Fayette + Tipton (TN), plus DeSoto, Marshall,
    // Tate, Tunica (MS), Crittenden (AR). We bound the TN+MS+AR sweep.
    bounds: { latMin: 34.5, latMax: 35.6, lonMin: -90.5, lonMax: -89.2 },
    stateCode: "TN",
    jurisdiction: {
      dotName: "City of Memphis Division of Public Works",
      planningOfficeName:
        "Memphis & Shelby County Division of Planning and Development",
      parkingCodeCitation:
        "Memphis Unified Development Code, Article 4.5 — Parking.",
    },
    dataSourceId: "tdot",
    active: true,
  },
  knoxville_metro: {
    code: "knoxville_metro",
    displayName: "Knoxville MSA",
    // Knoxville MSA: Knox, Anderson, Blount, Loudon, Roane, Union, Grainger,
    // Campbell, Morgan, Sevier.
    bounds: { latMin: 35.5, latMax: 36.5, lonMin: -84.7, lonMax: -83.4 },
    stateCode: "TN",
    jurisdiction: {
      dotName: "Knoxville Engineering Department",
      planningOfficeName: "Knoxville-Knox County Planning",
      parkingCodeCitation:
        "City of Knoxville Zoning Ordinance, Article 12 — Parking.",
    },
    dataSourceId: "tdot",
    active: true,
  },
  chattanooga_metro: {
    code: "chattanooga_metro",
    displayName: "Chattanooga MSA",
    // Chattanooga MSA spans TN + GA: Hamilton, Marion, Sequatchie (TN)
    // + Catoosa, Dade, Walker (GA).
    bounds: { latMin: 34.7, latMax: 35.4, lonMin: -85.8, lonMax: -84.7 },
    stateCode: "TN",
    jurisdiction: {
      dotName: "Chattanooga DOT",
      planningOfficeName: "Chattanooga Department of Transportation Planning",
      parkingCodeCitation:
        "City of Chattanooga Zoning Ordinance, Section 38 — Parking.",
    },
    dataSourceId: "tdot",
    active: true,
  },
  savannah_metro: {
    code: "savannah_metro",
    displayName: "Savannah MSA",
    // Savannah MSA: Chatham, Bryan, Effingham counties.
    bounds: { latMin: 31.7, latMax: 32.5, lonMin: -81.6, lonMax: -80.7 },
    stateCode: "GA",
    jurisdiction: {
      dotName: "City of Savannah Traffic Engineering",
      planningOfficeName: "Chatham County-Savannah Metropolitan Planning Commission",
      parkingCodeCitation:
        "Savannah Zoning Ordinance, Article 9 — Off-Street Parking.",
    },
    dataSourceId: "gdot_511",
    active: true,
  },
  asheville_metro: {
    code: "asheville_metro",
    displayName: "Asheville MSA",
    // Asheville MSA: Buncombe, Henderson, Haywood, Madison counties.
    bounds: { latMin: 35.2, latMax: 36.0, lonMin: -83.2, lonMax: -82.1 },
    stateCode: "NC",
    jurisdiction: {
      dotName: "City of Asheville Transportation Department",
      planningOfficeName: "City of Asheville Planning & Urban Design",
      parkingCodeCitation:
        "Asheville Unified Development Ordinance, Section 7-11 — Parking.",
    },
    dataSourceId: "ncdot",
    active: true,
  },
  wilmington_metro: {
    code: "wilmington_metro",
    displayName: "Wilmington MSA",
    // Wilmington MSA: New Hanover, Brunswick, Pender counties.
    bounds: { latMin: 33.7, latMax: 34.7, lonMin: -78.4, lonMax: -77.5 },
    stateCode: "NC",
    jurisdiction: {
      dotName: "City of Wilmington Traffic Engineering",
      planningOfficeName: "City of Wilmington Planning, Development & Transportation",
      parkingCodeCitation:
        "Wilmington Land Development Code, Section 18-301 — Parking.",
    },
    dataSourceId: "ncdot",
    active: true,
  },
  triad_metro: {
    code: "triad_metro",
    displayName: "Piedmont Triad CSA",
    // Greensboro-Winston-Salem-High Point CSA: Guilford, Forsyth, Davidson,
    // Davie, Randolph, Rockingham, Stokes, Yadkin, Surry counties.
    bounds: { latMin: 35.6, latMax: 36.6, lonMin: -80.8, lonMax: -79.4 },
    stateCode: "NC",
    jurisdiction: {
      dotName: "Greensboro DOT / Winston-Salem DOT",
      planningOfficeName: "Piedmont Authority for Regional Transportation (PART)",
      parkingCodeCitation:
        "Greensboro LDO, Section 30-9 — Parking; Winston-Salem UDO, Chapter B, Article VI — Parking.",
    },
    dataSourceId: "ncdot",
    active: true,
  },

  // ── Tier-2: new state-DOT integrations ────────────────────────────────
  birmingham_metro: {
    code: "birmingham_metro",
    displayName: "Birmingham MSA",
    // Birmingham-Hoover MSA: Jefferson, Shelby, St. Clair, Blount, Walker,
    // Bibb, Chilton.
    bounds: { latMin: 33.0, latMax: 34.0, lonMin: -87.4, lonMax: -86.0 },
    stateCode: "AL",
    jurisdiction: {
      dotName: "City of Birmingham Department of Transportation",
      planningOfficeName: "Birmingham Department of Planning, Engineering & Permits",
      parkingCodeCitation:
        "Birmingham Zoning Ordinance, Article 5 — Off-Street Parking and Loading.",
    },
    dataSourceId: "aldot",
    active: true,
  },
  hampton_roads_metro: {
    code: "hampton_roads_metro",
    displayName: "Hampton Roads MSA",
    // Virginia Beach-Norfolk-Newport News MSA: cities of Norfolk,
    // Virginia Beach, Newport News, Hampton, Chesapeake, Portsmouth,
    // Suffolk, Williamsburg + James City, York, Gloucester, Isle of Wight.
    bounds: { latMin: 36.5, latMax: 37.6, lonMin: -77.1, lonMax: -75.9 },
    stateCode: "VA",
    jurisdiction: {
      dotName: "Virginia DOT Hampton Roads District",
      planningOfficeName: "Hampton Roads Transportation Planning Organization",
      parkingCodeCitation:
        "Norfolk Zoning Ordinance, Chapter 14 — Parking and Loading (jurisdiction varies by city).",
    },
    dataSourceId: "vdot",
    active: true,
  },
  richmond_metro: {
    code: "richmond_metro",
    displayName: "Richmond MSA",
    // Richmond MSA: City of Richmond + Henrico, Chesterfield, Hanover,
    // Powhatan, New Kent, Charles City, Goochland.
    bounds: { latMin: 37.2, latMax: 38.0, lonMin: -78.1, lonMax: -77.0 },
    stateCode: "VA",
    jurisdiction: {
      dotName: "Richmond Department of Public Works",
      planningOfficeName: "Richmond Department of Planning and Development Review",
      parkingCodeCitation:
        "Richmond Zoning Ordinance, Article VII — Off-Street Parking and Loading.",
    },
    dataSourceId: "vdot",
    active: true,
  },
  charleston_sc_metro: {
    code: "charleston_sc_metro",
    displayName: "Charleston (SC) MSA",
    // Charleston-North Charleston MSA: Charleston, Berkeley, Dorchester counties.
    bounds: { latMin: 32.4, latMax: 33.2, lonMin: -80.4, lonMax: -79.5 },
    stateCode: "SC",
    jurisdiction: {
      dotName: "City of Charleston Department of Traffic and Transportation",
      planningOfficeName: "Berkeley-Charleston-Dorchester Council of Governments (BCDCOG)",
      parkingCodeCitation:
        "Charleston Zoning Ordinance, Article 8 — Off-Street Parking and Loading.",
    },
    dataSourceId: "scdot",
    active: true,
  },
  columbia_sc_metro: {
    code: "columbia_sc_metro",
    displayName: "Columbia (SC) MSA",
    // Columbia MSA: Richland, Lexington, Calhoun, Fairfield, Kershaw, Saluda.
    bounds: { latMin: 33.6, latMax: 34.5, lonMin: -81.5, lonMax: -80.5 },
    stateCode: "SC",
    jurisdiction: {
      dotName: "City of Columbia Engineering Services",
      planningOfficeName: "Central Midlands Council of Governments (CMCOG)",
      parkingCodeCitation:
        "Columbia Land Development Code, Section 17-265 — Parking.",
    },
    dataSourceId: "scdot",
    active: true,
  },
  louisville_metro: {
    code: "louisville_metro",
    displayName: "Louisville MSA",
    // Louisville/Jefferson County MSA: Jefferson, Bullitt, Oldham, Shelby,
    // Henry, Spencer, Trimble (KY) + Clark, Floyd, Harrison, Washington,
    // Scott (IN). Bounds span both sides of the Ohio River.
    bounds: { latMin: 37.9, latMax: 38.5, lonMin: -86.1, lonMax: -85.3 },
    stateCode: "KY",
    jurisdiction: {
      dotName: "Louisville Metro Department of Public Works",
      planningOfficeName: "Louisville Metro Office of Planning",
      parkingCodeCitation:
        "Louisville Metro Land Development Code, Chapter 9 — Parking.",
    },
    dataSourceId: "kytc",
    active: true,
  },
  new_orleans_metro: {
    code: "new_orleans_metro",
    displayName: "New Orleans MSA",
    // New Orleans-Metairie MSA: Orleans, Jefferson, St. Bernard,
    // Plaquemines, St. Charles, St. John the Baptist, St. Tammany.
    bounds: { latMin: 29.6, latMax: 30.6, lonMin: -90.7, lonMax: -89.3 },
    stateCode: "LA",
    jurisdiction: {
      dotName: "New Orleans Department of Public Works",
      planningOfficeName: "Regional Planning Commission of Southeast Louisiana",
      parkingCodeCitation:
        "New Orleans Comprehensive Zoning Ordinance, Article 22 — Off-Street Parking.",
    },
    dataSourceId: "ladotd",
    active: true,
  },

  // ── Tier-3: smaller metros, existing state DOTs ──────────────────────
  lexington_metro: {
    code: "lexington_metro",
    displayName: "Lexington-Fayette MSA",
    // Lexington-Fayette MSA: Fayette, Jessamine, Bourbon, Clark, Scott, Woodford counties.
    bounds: { latMin: 37.7, latMax: 38.3, lonMin: -84.9, lonMax: -84.1 },
    stateCode: "KY",
    jurisdiction: {
      dotName: "Lexington-Fayette Urban County Government Traffic Engineering",
      planningOfficeName: "Lexington Division of Planning",
      parkingCodeCitation:
        "Lexington-Fayette Urban County Government Zoning Ordinance, Article 16 — Parking.",
    },
    dataSourceId: "kytc",
    active: true,
  },
  mobile_metro: {
    code: "mobile_metro",
    displayName: "Mobile MSA",
    // Mobile MSA: Mobile County (AL).
    bounds: { latMin: 30.2, latMax: 31.2, lonMin: -88.5, lonMax: -87.7 },
    stateCode: "AL",
    jurisdiction: {
      dotName: "City of Mobile Public Works",
      planningOfficeName: "Mobile City Planning Department",
      parkingCodeCitation:
        "Mobile Zoning Ordinance, Section 64-9 — Off-Street Parking.",
    },
    dataSourceId: "aldot",
    active: true,
  },
  huntsville_metro: {
    code: "huntsville_metro",
    displayName: "Huntsville MSA",
    // Huntsville MSA: Madison + Limestone counties (AL).
    bounds: { latMin: 34.4, latMax: 35.1, lonMin: -87.0, lonMax: -86.2 },
    stateCode: "AL",
    jurisdiction: {
      dotName: "Huntsville Traffic Engineering Department",
      planningOfficeName: "Huntsville City Planning Division",
      parkingCodeCitation:
        "Huntsville Zoning Ordinance, Article 7 — Off-Street Parking and Loading.",
    },
    dataSourceId: "aldot",
    active: true,
  },
  pensacola_metro: {
    code: "pensacola_metro",
    displayName: "Pensacola MSA",
    // Pensacola-Ferry Pass-Brent MSA: Escambia + Santa Rosa counties (FL).
    bounds: { latMin: 30.3, latMax: 31.0, lonMin: -87.7, lonMax: -86.7 },
    stateCode: "FL",
    jurisdiction: {
      dotName: "Escambia County Engineering / City of Pensacola Public Works",
      planningOfficeName: "Florida-Alabama TPO (FL-AL TPO)",
      parkingCodeCitation:
        "Escambia County Land Development Code, Chapter 4 — Off-Street Parking.",
    },
    dataSourceId: "fdot",
    active: true,
  },
  fayetteville_metro: {
    code: "fayetteville_metro",
    displayName: "Fayetteville (NC) MSA",
    // Fayetteville-Sanford MSA: Cumberland + Harnett + Hoke counties (NC).
    bounds: { latMin: 34.7, latMax: 35.6, lonMin: -79.5, lonMax: -78.6 },
    stateCode: "NC",
    jurisdiction: {
      dotName: "Fayetteville Engineering & Infrastructure Department",
      planningOfficeName: "Fayetteville Planning Department",
      parkingCodeCitation:
        "Fayetteville Unified Development Ordinance, Article 30-5 — Parking.",
    },
    dataSourceId: "ncdot",
    active: true,
  },
  greenville_nc_metro: {
    code: "greenville_nc_metro",
    displayName: "Greenville (NC) MSA",
    // Greenville MSA: Pitt County (NC).
    bounds: { latMin: 35.4, latMax: 35.9, lonMin: -77.6, lonMax: -77.0 },
    stateCode: "NC",
    jurisdiction: {
      dotName: "Greenville Engineering Department",
      planningOfficeName: "Greenville Planning Division",
      parkingCodeCitation:
        "Greenville Zoning Ordinance, Title 9 — Off-Street Parking.",
    },
    dataSourceId: "ncdot",
    active: true,
  },
  augusta_metro: {
    code: "augusta_metro",
    displayName: "Augusta MSA",
    // Augusta-Richmond County MSA: Richmond, Columbia, Burke (GA) + Aiken, Edgefield (SC).
    bounds: { latMin: 33.2, latMax: 33.8, lonMin: -82.4, lonMax: -81.7 },
    stateCode: "GA",
    jurisdiction: {
      dotName: "Augusta Engineering Department",
      planningOfficeName: "Augusta Planning and Development Department",
      parkingCodeCitation:
        "Augusta Comprehensive Zoning Ordinance, Section 4-2 — Off-Street Parking.",
    },
    dataSourceId: "gdot_511",
    active: true,
  },
  macon_metro: {
    code: "macon_metro",
    displayName: "Macon-Bibb MSA",
    // Macon MSA: Bibb + Crawford + Jones + Monroe + Twiggs (GA).
    bounds: { latMin: 32.4, latMax: 33.1, lonMin: -83.9, lonMax: -83.2 },
    stateCode: "GA",
    jurisdiction: {
      dotName: "Macon-Bibb County Engineering Department",
      planningOfficeName: "Macon-Bibb County Planning & Zoning Commission",
      parkingCodeCitation:
        "Macon-Bibb County Land Development Code, Article 6 — Parking.",
    },
    dataSourceId: "gdot_511",
    active: true,
  },

  // ── Tier-4: Coast + Midwest + Westward expansion ─────────────────────
  washington_dc_metro: {
    code: "washington_dc_metro",
    displayName: "Washington-Arlington-Alexandria MSA",
    // DC + surrounding NoVA/MD. Bbox crosses DC/VA/MD; we use DC PBF + VA
    // PBF; MD coverage comes from a separate MD pull.
    bounds: { latMin: 38.6, latMax: 39.2, lonMin: -77.6, lonMax: -76.7 },
    stateCode: "DC",
    jurisdiction: {
      dotName: "District Department of Transportation (DDOT)",
      planningOfficeName: "DC Office of Planning",
      parkingCodeCitation: "DC Zoning Regulations, Subtitle C, Chapter 7 — Off-Street Parking.",
    },
    dataSourceId: "ddot_dc",
    active: true,
  },
  baltimore_metro: {
    code: "baltimore_metro",
    displayName: "Baltimore-Columbia-Towson MSA",
    bounds: { latMin: 39.0, latMax: 39.7, lonMin: -77.0, lonMax: -76.2 },
    stateCode: "MD",
    jurisdiction: {
      dotName: "Baltimore City DOT",
      planningOfficeName: "Baltimore Department of Planning",
      parkingCodeCitation: "Baltimore City Zoning Code, Title 16 — Parking and Loading.",
    },
    dataSourceId: "mdot_md",
    active: true,
  },
  philadelphia_metro: {
    code: "philadelphia_metro",
    displayName: "Philadelphia MSA",
    // Philadelphia-Camden-Wilmington — primary state PA (Camden NJ + Wilmington DE
    // edges underserved until we pull those PBFs). East edge clipped at -74.95
    // to avoid overlapping Trenton MSA (Trenton starts at -74.9).
    bounds: { latMin: 39.7, latMax: 40.4, lonMin: -75.5, lonMax: -74.95 },
    stateCode: "PA",
    jurisdiction: {
      dotName: "Philadelphia Streets Department",
      planningOfficeName: "Philadelphia City Planning Commission",
      parkingCodeCitation: "Philadelphia Zoning Code, Chapter 14-800 — Parking and Loading.",
    },
    dataSourceId: "penndot",
    active: true,
  },
  pittsburgh_metro: {
    code: "pittsburgh_metro",
    displayName: "Pittsburgh MSA",
    bounds: { latMin: 40.2, latMax: 40.7, lonMin: -80.4, lonMax: -79.6 },
    stateCode: "PA",
    jurisdiction: {
      dotName: "Pittsburgh Department of Mobility and Infrastructure (DOMI)",
      planningOfficeName: "Pittsburgh Department of City Planning",
      parkingCodeCitation: "Pittsburgh Zoning Code, Chapter 914 — Parking, Loading and Access.",
    },
    dataSourceId: "penndot",
    active: true,
  },
  new_york_metro: {
    code: "new_york_metro",
    displayName: "New York-Newark-Jersey City MSA",
    // NYC core within NY-only PBF. NJ/CT portions come up underserved until
    // we pull those PBFs separately.
    bounds: { latMin: 40.5, latMax: 41.2, lonMin: -74.3, lonMax: -73.4 },
    stateCode: "NY",
    jurisdiction: {
      dotName: "New York City Department of Transportation (NYC DOT)",
      planningOfficeName: "NYC Department of City Planning",
      parkingCodeCitation: "NYC Zoning Resolution, Article I, Chapter 3 — Off-Street Parking.",
    },
    dataSourceId: "nysdot",
    active: true,
  },
  boston_metro: {
    code: "boston_metro",
    displayName: "Boston-Cambridge-Newton MSA",
    bounds: { latMin: 42.1, latMax: 42.7, lonMin: -71.5, lonMax: -70.7 },
    stateCode: "MA",
    jurisdiction: {
      dotName: "Boston Transportation Department (BTD)",
      planningOfficeName: "Boston Planning & Development Agency (BPDA)",
      parkingCodeCitation: "Boston Zoning Code, Article 23 — Off-Street Parking and Loading.",
    },
    dataSourceId: "massdot",
    active: true,
  },
  chicago_metro: {
    code: "chicago_metro",
    displayName: "Chicago-Naperville-Elgin MSA",
    bounds: { latMin: 41.4, latMax: 42.3, lonMin: -88.5, lonMax: -87.3 },
    stateCode: "IL",
    jurisdiction: {
      dotName: "Chicago Department of Transportation (CDOT)",
      planningOfficeName: "Chicago Department of Planning and Development",
      parkingCodeCitation: "Chicago Zoning Ordinance, Section 17-10 — Off-Street Parking and Loading.",
    },
    dataSourceId: "idot",
    active: true,
  },
  detroit_metro: {
    code: "detroit_metro",
    displayName: "Detroit-Warren-Dearborn MSA",
    bounds: { latMin: 42.0, latMax: 42.8, lonMin: -83.7, lonMax: -82.6 },
    stateCode: "MI",
    jurisdiction: {
      dotName: "Detroit Department of Public Works",
      planningOfficeName: "Detroit Planning and Development Department",
      parkingCodeCitation: "Detroit Zoning Ordinance, Chapter 61, Article XIV — Parking.",
    },
    dataSourceId: "mdot_mi",
    active: true,
  },
  twin_cities_metro: {
    code: "twin_cities_metro",
    displayName: "Minneapolis-St. Paul-Bloomington MSA",
    bounds: { latMin: 44.6, latMax: 45.4, lonMin: -93.8, lonMax: -92.7 },
    stateCode: "MN",
    jurisdiction: {
      dotName: "Minneapolis Department of Public Works / St. Paul Public Works",
      planningOfficeName: "Metropolitan Council (Twin Cities regional planning)",
      parkingCodeCitation: "Minneapolis Code of Ordinances, Title 20, Chapter 541 — Off-Street Parking.",
    },
    dataSourceId: "mndot",
    active: true,
  },
  cleveland_metro: {
    code: "cleveland_metro",
    displayName: "Cleveland-Elyria MSA",
    bounds: { latMin: 41.2, latMax: 41.8, lonMin: -82.1, lonMax: -81.3 },
    stateCode: "OH",
    jurisdiction: {
      dotName: "Cleveland Division of Traffic Engineering",
      planningOfficeName: "Cleveland City Planning Commission",
      parkingCodeCitation: "Cleveland Codified Ordinances, Title VII, Chapter 349 — Off-Street Parking.",
    },
    dataSourceId: "odot_oh",
    active: true,
  },
  columbus_oh_metro: {
    code: "columbus_oh_metro",
    displayName: "Columbus (OH) MSA",
    bounds: { latMin: 39.7, latMax: 40.3, lonMin: -83.3, lonMax: -82.5 },
    stateCode: "OH",
    jurisdiction: {
      dotName: "Columbus Division of Traffic Management",
      planningOfficeName: "Columbus Department of Development, Planning Division",
      parkingCodeCitation: "Columbus City Codes, Chapter 3312 — Off-Street Parking and Loading.",
    },
    dataSourceId: "odot_oh",
    active: true,
  },
  cincinnati_metro: {
    code: "cincinnati_metro",
    displayName: "Cincinnati MSA",
    // Cincinnati MSA crosses OH/KY/IN; we cover OH portion here. KY +
    // IN edges are picked up by louisville/indianapolis pulls.
    bounds: { latMin: 38.9, latMax: 39.4, lonMin: -85.0, lonMax: -84.0 },
    stateCode: "OH",
    jurisdiction: {
      dotName: "Cincinnati Department of Transportation and Engineering (DOTE)",
      planningOfficeName: "Cincinnati City Planning Commission",
      parkingCodeCitation: "Cincinnati Zoning Code, Chapter 1425 — Off-Street Parking.",
    },
    dataSourceId: "odot_oh",
    active: true,
  },
  indianapolis_metro: {
    code: "indianapolis_metro",
    displayName: "Indianapolis-Carmel-Anderson MSA",
    bounds: { latMin: 39.5, latMax: 40.1, lonMin: -86.6, lonMax: -85.7 },
    stateCode: "IN",
    jurisdiction: {
      dotName: "Indianapolis Department of Public Works",
      planningOfficeName: "Indianapolis Department of Metropolitan Development",
      parkingCodeCitation: "Indianapolis-Marion County Code, Chapter 743 — Off-Street Parking.",
    },
    dataSourceId: "indot",
    active: true,
  },
  st_louis_metro: {
    code: "st_louis_metro",
    displayName: "St. Louis MSA",
    // St. Louis MSA crosses MO/IL. We pull MO; IL edges (East St. Louis)
    // underserved.
    bounds: { latMin: 38.4, latMax: 39.0, lonMin: -90.7, lonMax: -89.9 },
    stateCode: "MO",
    jurisdiction: {
      dotName: "St. Louis Streets Department",
      planningOfficeName: "St. Louis Planning and Urban Design Agency",
      parkingCodeCitation: "St. Louis Revised Code, Title 26, Chapter 26.68 — Off-Street Parking.",
    },
    dataSourceId: "modot",
    active: true,
  },
  kansas_city_metro: {
    code: "kansas_city_metro",
    displayName: "Kansas City MSA",
    // KC MSA crosses MO/KS. We pull MO; KS edges underserved.
    bounds: { latMin: 38.8, latMax: 39.4, lonMin: -94.9, lonMax: -94.2 },
    stateCode: "MO",
    jurisdiction: {
      dotName: "Kansas City Public Works Department",
      planningOfficeName: "Kansas City Department of City Planning & Development",
      parkingCodeCitation: "Kansas City Code of Ordinances, Chapter 88-420 — Off-Street Parking.",
    },
    dataSourceId: "modot",
    active: true,
  },
  milwaukee_metro: {
    code: "milwaukee_metro",
    displayName: "Milwaukee-Waukesha MSA",
    bounds: { latMin: 42.8, latMax: 43.4, lonMin: -88.3, lonMax: -87.7 },
    stateCode: "WI",
    jurisdiction: {
      dotName: "Milwaukee Department of Public Works",
      planningOfficeName: "Milwaukee Department of City Development",
      parkingCodeCitation: "Milwaukee Code of Ordinances, Chapter 295-403 — Off-Street Parking and Loading.",
    },
    dataSourceId: "wisdot",
    active: true,
  },
  houston_metro: {
    code: "houston_metro",
    displayName: "Houston-The Woodlands-Sugar Land MSA",
    bounds: { latMin: 29.3, latMax: 30.3, lonMin: -95.9, lonMax: -94.8 },
    stateCode: "TX",
    jurisdiction: {
      dotName: "Houston Public Works (Traffic Operations)",
      planningOfficeName: "Houston Planning & Development Department",
      parkingCodeCitation: "Houston Code of Ordinances, Chapter 26, Article VIII — Off-Street Parking.",
    },
    dataSourceId: "txdot",
    active: true,
  },
  dallas_fort_worth_metro: {
    code: "dallas_fort_worth_metro",
    displayName: "Dallas-Fort Worth-Arlington MSA",
    bounds: { latMin: 32.4, latMax: 33.4, lonMin: -97.6, lonMax: -96.4 },
    stateCode: "TX",
    jurisdiction: {
      dotName: "Dallas Department of Transportation / Fort Worth Transportation & Public Works",
      planningOfficeName: "North Central Texas Council of Governments (NCTCOG)",
      parkingCodeCitation: "Dallas Development Code, Article VIII, Division 51A-4.300 — Off-Street Parking.",
    },
    dataSourceId: "txdot",
    active: true,
  },
  austin_metro: {
    code: "austin_metro",
    displayName: "Austin-Round Rock-Georgetown MSA",
    bounds: { latMin: 30.0, latMax: 30.7, lonMin: -98.1, lonMax: -97.3 },
    stateCode: "TX",
    jurisdiction: {
      dotName: "Austin Transportation and Public Works (TPW)",
      planningOfficeName: "Austin Planning Department",
      parkingCodeCitation: "Austin Land Development Code, Chapter 25-6 — Transportation, Subchapter D — Parking.",
    },
    dataSourceId: "txdot",
    active: true,
  },
  san_antonio_metro: {
    code: "san_antonio_metro",
    displayName: "San Antonio-New Braunfels MSA",
    bounds: { latMin: 29.2, latMax: 29.8, lonMin: -98.8, lonMax: -98.2 },
    stateCode: "TX",
    jurisdiction: {
      dotName: "San Antonio Public Works Department",
      planningOfficeName: "San Antonio Planning Department",
      parkingCodeCitation: "San Antonio Unified Development Code, Article V, Section 35-526 — Off-Street Parking.",
    },
    dataSourceId: "txdot",
    active: true,
  },

  // ── Tier-5: West Coast + Mountain West expansion ──────────────────────
  // 14 metros across 8 new states (CA/OR/WA/NV/AZ/CO/UT/NM). LA + Inland
  // Empire are split at -117.7 W to avoid double-resolution; LA covers LA +
  // Orange counties, IE covers Riverside + San Bernardino.
  los_angeles_metro: {
    code: "los_angeles_metro",
    displayName: "Los Angeles-Long Beach-Anaheim MSA",
    bounds: { latMin: 33.4, latMax: 34.5, lonMin: -118.95, lonMax: -117.7 },
    stateCode: "CA",
    jurisdiction: {
      dotName: "Los Angeles Department of Transportation (LADOT)",
      planningOfficeName: "Los Angeles Department of City Planning",
      parkingCodeCitation: "LA Municipal Code, Chapter 1, Article 2, Section 12.21-A — Off-Street Parking.",
    },
    dataSourceId: "caltrans",
    active: true,
  },
  sf_bay_metro: {
    code: "sf_bay_metro",
    displayName: "San Francisco-Oakland-San Jose CSA",
    // Bay Area combined: SF + Alameda + Contra Costa + San Mateo + Santa Clara.
    bounds: { latMin: 37.2, latMax: 38.1, lonMin: -122.6, lonMax: -121.6 },
    stateCode: "CA",
    jurisdiction: {
      dotName: "San Francisco Municipal Transportation Agency (SFMTA)",
      planningOfficeName: "San Francisco Planning Department",
      parkingCodeCitation: "SF Planning Code, Article 1.5, Section 151 — Off-Street Parking and Loading.",
    },
    dataSourceId: "caltrans",
    active: true,
  },
  san_diego_metro: {
    code: "san_diego_metro",
    displayName: "San Diego-Chula Vista-Carlsbad MSA",
    // South edge clipped at 32.54 to avoid US-Mexico border overlap with Tijuana.
    bounds: { latMin: 32.54, latMax: 33.5, lonMin: -117.6, lonMax: -116.6 },
    stateCode: "CA",
    jurisdiction: {
      dotName: "City of San Diego Transportation Department",
      planningOfficeName: "City of San Diego Planning Department",
      parkingCodeCitation: "San Diego Municipal Code, Chapter 14, Article 2, Division 5 — Parking Regulations.",
    },
    dataSourceId: "caltrans",
    active: true,
  },
  sacramento_metro: {
    code: "sacramento_metro",
    displayName: "Sacramento-Roseville-Folsom MSA",
    bounds: { latMin: 38.3, latMax: 39.0, lonMin: -121.8, lonMax: -120.9 },
    stateCode: "CA",
    jurisdiction: {
      dotName: "Sacramento Department of Public Works",
      planningOfficeName: "Sacramento Community Development Department",
      parkingCodeCitation: "Sacramento City Code, Title 17, Chapter 17.608 — Off-Street Parking.",
    },
    dataSourceId: "caltrans",
    active: true,
  },
  inland_empire_metro: {
    code: "inland_empire_metro",
    displayName: "Riverside-San Bernardino-Ontario MSA",
    // Inland Empire: Riverside + San Bernardino counties. East edge clipped
    // at -116.0 (desert area beyond has near-zero signal density).
    bounds: { latMin: 33.4, latMax: 34.5, lonMin: -117.7, lonMax: -116.0 },
    stateCode: "CA",
    jurisdiction: {
      dotName: "Riverside County Transportation Department / San Bernardino County Public Works",
      planningOfficeName: "Western Riverside Council of Governments (WRCOG) / SBCOG",
      parkingCodeCitation: "Riverside Municipal Code, Chapter 19.580 — Parking; SB Development Code, Chapter 83.11 — Parking.",
    },
    dataSourceId: "caltrans",
    active: true,
  },
  fresno_metro: {
    code: "fresno_metro",
    displayName: "Fresno MSA",
    bounds: { latMin: 36.5, latMax: 37.1, lonMin: -120.0, lonMax: -119.2 },
    stateCode: "CA",
    jurisdiction: {
      dotName: "City of Fresno Public Works Department",
      planningOfficeName: "Fresno Development and Resource Management Department",
      parkingCodeCitation: "Fresno Municipal Code, Article 14 — Off-Street Parking and Loading.",
    },
    dataSourceId: "caltrans",
    active: true,
  },
  portland_metro: {
    code: "portland_metro",
    displayName: "Portland-Vancouver-Hillsboro MSA",
    // Portland MSA spans OR + WA (Clark County, WA). Bounds cover both
    // sides of the Columbia River.
    bounds: { latMin: 45.2, latMax: 45.8, lonMin: -123.1, lonMax: -122.3 },
    stateCode: "OR",
    jurisdiction: {
      dotName: "Portland Bureau of Transportation (PBOT)",
      planningOfficeName: "Portland Bureau of Planning and Sustainability",
      parkingCodeCitation: "Portland Zoning Code, Chapter 33.266 — Parking and Loading.",
    },
    dataSourceId: "odot_or",
    active: true,
  },
  seattle_metro: {
    code: "seattle_metro",
    displayName: "Seattle-Tacoma-Bellevue MSA",
    // South edge tightened to 47.35 to avoid catching Tacoma (47.25), which
    // is now its own Tier-7 metro covering Pierce County.
    bounds: { latMin: 47.35, latMax: 47.9, lonMin: -122.6, lonMax: -121.8 },
    stateCode: "WA",
    jurisdiction: {
      dotName: "Seattle Department of Transportation (SDOT)",
      planningOfficeName: "Seattle Office of Planning and Community Development",
      parkingCodeCitation: "Seattle Municipal Code, Chapter 23.54 — Quantity and Design Standards for Access and Off-Street Parking.",
    },
    dataSourceId: "wsdot",
    active: true,
  },
  las_vegas_metro: {
    code: "las_vegas_metro",
    displayName: "Las Vegas-Henderson-Paradise MSA",
    bounds: { latMin: 35.9, latMax: 36.4, lonMin: -115.5, lonMax: -114.9 },
    stateCode: "NV",
    jurisdiction: {
      dotName: "City of Las Vegas Department of Public Works",
      planningOfficeName: "City of Las Vegas Department of Planning",
      parkingCodeCitation: "Las Vegas Municipal Code, Title 19.08 — Off-Street Parking and Loading.",
    },
    dataSourceId: "nvdot",
    active: true,
  },
  phoenix_metro: {
    code: "phoenix_metro",
    displayName: "Phoenix-Mesa-Chandler MSA",
    bounds: { latMin: 33.2, latMax: 33.9, lonMin: -112.6, lonMax: -111.5 },
    stateCode: "AZ",
    jurisdiction: {
      dotName: "City of Phoenix Street Transportation Department",
      planningOfficeName: "City of Phoenix Planning and Development Department",
      parkingCodeCitation: "Phoenix Zoning Ordinance, Section 702 — Off-Street Parking Requirements.",
    },
    dataSourceId: "adot",
    active: true,
  },
  tucson_metro: {
    code: "tucson_metro",
    displayName: "Tucson MSA",
    bounds: { latMin: 31.9, latMax: 32.5, lonMin: -111.2, lonMax: -110.6 },
    stateCode: "AZ",
    jurisdiction: {
      dotName: "City of Tucson Department of Transportation and Mobility",
      planningOfficeName: "Tucson Planning and Development Services Department",
      parkingCodeCitation: "Tucson Unified Development Code, Section 7.4.4 — Vehicle Parking and Loading.",
    },
    dataSourceId: "adot",
    active: true,
  },
  denver_metro: {
    code: "denver_metro",
    displayName: "Denver-Aurora-Centennial MSA",
    bounds: { latMin: 39.4, latMax: 40.0, lonMin: -105.4, lonMax: -104.6 },
    stateCode: "CO",
    jurisdiction: {
      dotName: "Denver Department of Transportation and Infrastructure (DOTI)",
      planningOfficeName: "Denver Community Planning and Development",
      parkingCodeCitation: "Denver Zoning Code, Article 10 — Parking and Loading.",
    },
    dataSourceId: "cdot_co",
    active: true,
  },
  salt_lake_city_metro: {
    code: "salt_lake_city_metro",
    displayName: "Salt Lake City-West Valley City-Murray MSA",
    bounds: { latMin: 40.4, latMax: 41.0, lonMin: -112.2, lonMax: -111.6 },
    stateCode: "UT",
    jurisdiction: {
      dotName: "Salt Lake City Transportation Division",
      planningOfficeName: "Salt Lake City Planning Division",
      parkingCodeCitation: "Salt Lake City Zoning Ordinance, Section 21A.44 — Off-Street Parking, Mobility, and Loading.",
    },
    dataSourceId: "udot",
    active: true,
  },
  albuquerque_metro: {
    code: "albuquerque_metro",
    displayName: "Albuquerque MSA",
    bounds: { latMin: 34.9, latMax: 35.4, lonMin: -107.0, lonMax: -106.3 },
    stateCode: "NM",
    jurisdiction: {
      dotName: "Albuquerque Department of Municipal Development (Transportation)",
      planningOfficeName: "Albuquerque Planning Department",
      parkingCodeCitation: "Albuquerque Integrated Development Ordinance (IDO), Section 14-16-5-5 — Parking and Loading.",
    },
    dataSourceId: "nmdot",
    active: true,
  },

  // ── Tier-6: 50-state coverage push (20 new states, one major metro each) ──
  // Sized to hit every US state at least once. Many of these are small MSAs;
  // ROI per metro is lower than Tier-0/1 but completes the "all 50" claim.
  hartford_metro: {
    code: "hartford_metro",
    displayName: "Hartford-East Hartford-Middletown MSA",
    bounds: { latMin: 41.6, latMax: 42.0, lonMin: -73.0, lonMax: -72.5 },
    stateCode: "CT",
    jurisdiction: {
      dotName: "Hartford Department of Public Works",
      planningOfficeName: "Hartford Department of Development Services",
      parkingCodeCitation: "Hartford Zoning Regulations, Article 7 — Off-Street Parking and Loading.",
    },
    dataSourceId: "ctdot",
    active: true,
  },
  providence_metro: {
    code: "providence_metro",
    displayName: "Providence-Warwick MSA",
    bounds: { latMin: 41.6, latMax: 42.0, lonMin: -71.7, lonMax: -71.1 },
    stateCode: "RI",
    jurisdiction: {
      dotName: "Providence Department of Public Works",
      planningOfficeName: "Providence Department of Planning and Development",
      parkingCodeCitation: "Providence Zoning Ordinance, Article 14 — Parking and Loading.",
    },
    dataSourceId: "ridot",
    active: true,
  },
  manchester_metro: {
    code: "manchester_metro",
    displayName: "Manchester-Nashua MSA",
    bounds: { latMin: 42.7, latMax: 43.2, lonMin: -71.7, lonMax: -71.3 },
    stateCode: "NH",
    jurisdiction: {
      dotName: "City of Manchester Highway Department",
      planningOfficeName: "Manchester Planning and Community Development Department",
      parkingCodeCitation: "Manchester Zoning Ordinance, Article 8 — Parking and Loading.",
    },
    dataSourceId: "nhdot",
    active: true,
  },
  burlington_vt_metro: {
    code: "burlington_vt_metro",
    displayName: "Burlington-South Burlington MSA",
    bounds: { latMin: 44.3, latMax: 44.6, lonMin: -73.4, lonMax: -73.1 },
    stateCode: "VT",
    jurisdiction: {
      dotName: "Burlington Department of Public Works",
      planningOfficeName: "Burlington Planning and Zoning Department",
      parkingCodeCitation: "Burlington Comprehensive Development Ordinance, Article 8 — Parking and Transportation Demand Management.",
    },
    dataSourceId: "vtrans",
    active: true,
  },
  portland_me_metro: {
    code: "portland_me_metro",
    displayName: "Portland-South Portland MSA",
    bounds: { latMin: 43.5, latMax: 43.9, lonMin: -70.5, lonMax: -70.0 },
    stateCode: "ME",
    jurisdiction: {
      dotName: "City of Portland Department of Public Works",
      planningOfficeName: "Portland Department of Planning and Urban Development",
      parkingCodeCitation: "Portland Land Use Ordinance, Chapter 14, Section 14-332 — Off-Street Parking.",
    },
    dataSourceId: "medot",
    active: true,
  },
  trenton_metro: {
    code: "trenton_metro",
    displayName: "Trenton-Princeton MSA",
    // NJ note: Newark/Jersey City are inside new_york_metro bounds (NYC MSA).
    // Trenton is the state capital and gives us a distinct NJ region without
    // overlap. West of NYC's -74.5 lonMin.
    bounds: { latMin: 40.1, latMax: 40.5, lonMin: -74.9, lonMax: -74.5 },
    stateCode: "NJ",
    jurisdiction: {
      dotName: "Trenton Department of Public Works",
      planningOfficeName: "Trenton Department of Housing and Economic Development",
      parkingCodeCitation: "Trenton Land Development Ordinance, Chapter 315 — Parking, Loading and Driveways.",
    },
    dataSourceId: "njdot",
    active: true,
  },
  charleston_wv_metro: {
    code: "charleston_wv_metro",
    displayName: "Charleston (WV) MSA",
    bounds: { latMin: 38.2, latMax: 38.5, lonMin: -81.8, lonMax: -81.4 },
    stateCode: "WV",
    jurisdiction: {
      dotName: "Charleston Department of Public Works",
      planningOfficeName: "Charleston Planning Department",
      parkingCodeCitation: "Charleston Zoning Ordinance, Article 1135 — Off-Street Parking.",
    },
    dataSourceId: "wvdot",
    active: true,
  },
  jackson_ms_metro: {
    code: "jackson_ms_metro",
    displayName: "Jackson (MS) MSA",
    bounds: { latMin: 32.1, latMax: 32.5, lonMin: -90.4, lonMax: -89.9 },
    stateCode: "MS",
    jurisdiction: {
      dotName: "Jackson Department of Public Works",
      planningOfficeName: "Jackson Department of Planning and Development",
      parkingCodeCitation: "Jackson Zoning Ordinance, Article 18 — Off-Street Parking and Loading.",
    },
    dataSourceId: "mdot_ms",
    active: true,
  },
  little_rock_metro: {
    code: "little_rock_metro",
    displayName: "Little Rock-North Little Rock-Conway MSA",
    bounds: { latMin: 34.5, latMax: 35.0, lonMin: -92.6, lonMax: -92.0 },
    stateCode: "AR",
    jurisdiction: {
      dotName: "Little Rock Department of Public Works",
      planningOfficeName: "Little Rock Department of Planning and Development",
      parkingCodeCitation: "Little Rock Zoning Ordinance, Section 36 — Off-Street Parking.",
    },
    dataSourceId: "ardot",
    active: true,
  },
  oklahoma_city_metro: {
    code: "oklahoma_city_metro",
    displayName: "Oklahoma City MSA",
    bounds: { latMin: 35.2, latMax: 35.7, lonMin: -97.8, lonMax: -97.2 },
    stateCode: "OK",
    jurisdiction: {
      dotName: "Oklahoma City Public Works Department",
      planningOfficeName: "Oklahoma City Planning Department",
      parkingCodeCitation: "Oklahoma City Municipal Code, Title 25, Chapter 59 — Off-Street Parking and Loading.",
    },
    dataSourceId: "odot_ok",
    active: true,
  },
  tulsa_metro: {
    code: "tulsa_metro",
    displayName: "Tulsa MSA",
    bounds: { latMin: 35.9, latMax: 36.3, lonMin: -96.2, lonMax: -95.7 },
    stateCode: "OK",
    jurisdiction: {
      dotName: "City of Tulsa Engineering Services",
      planningOfficeName: "Tulsa Planning Office",
      parkingCodeCitation: "Tulsa Zoning Code, Chapter 65 — Off-Street Parking.",
    },
    dataSourceId: "odot_ok",
    active: true,
  },
  des_moines_metro: {
    code: "des_moines_metro",
    displayName: "Des Moines-West Des Moines MSA",
    bounds: { latMin: 41.4, latMax: 41.8, lonMin: -94.0, lonMax: -93.4 },
    stateCode: "IA",
    jurisdiction: {
      dotName: "Des Moines Public Works Department",
      planningOfficeName: "Des Moines Department of Development Services",
      parkingCodeCitation: "Des Moines Municipal Code, Chapter 134 — Zoning, Article XV — Parking and Loading.",
    },
    dataSourceId: "iadot",
    active: true,
  },
  omaha_metro: {
    code: "omaha_metro",
    displayName: "Omaha-Council Bluffs MSA",
    bounds: { latMin: 41.0, latMax: 41.5, lonMin: -96.3, lonMax: -95.7 },
    stateCode: "NE",
    jurisdiction: {
      dotName: "Omaha Public Works Department",
      planningOfficeName: "Omaha Planning Department",
      parkingCodeCitation: "Omaha Municipal Code, Chapter 55 — Zoning, Article XV — Parking and Loading.",
    },
    dataSourceId: "ndor",
    active: true,
  },
  wichita_metro: {
    code: "wichita_metro",
    displayName: "Wichita MSA",
    bounds: { latMin: 37.5, latMax: 37.9, lonMin: -97.6, lonMax: -97.0 },
    stateCode: "KS",
    jurisdiction: {
      dotName: "Wichita Department of Public Works",
      planningOfficeName: "Wichita-Sedgwick County Metropolitan Area Planning Department",
      parkingCodeCitation: "Wichita-Sedgwick County Unified Zoning Code, Section IV-A — Off-Street Parking and Loading.",
    },
    dataSourceId: "ksdot",
    active: true,
  },
  fargo_metro: {
    code: "fargo_metro",
    displayName: "Fargo MSA",
    bounds: { latMin: 46.7, latMax: 47.1, lonMin: -97.1, lonMax: -96.7 },
    stateCode: "ND",
    jurisdiction: {
      dotName: "Fargo Engineering Department",
      planningOfficeName: "Fargo Planning and Development Department",
      parkingCodeCitation: "Fargo Land Development Code, Article 20-0700 — Parking and Loading.",
    },
    dataSourceId: "nddot",
    active: true,
  },
  sioux_falls_metro: {
    code: "sioux_falls_metro",
    displayName: "Sioux Falls MSA",
    bounds: { latMin: 43.4, latMax: 43.7, lonMin: -96.9, lonMax: -96.5 },
    stateCode: "SD",
    jurisdiction: {
      dotName: "Sioux Falls Public Works Department",
      planningOfficeName: "Sioux Falls Planning and Development Services",
      parkingCodeCitation: "Sioux Falls Shape Places Zoning Ordinance, Section 161.083 — Parking and Loading.",
    },
    dataSourceId: "sddot",
    active: true,
  },
  boise_metro: {
    code: "boise_metro",
    displayName: "Boise City MSA",
    // Note: Boise's roads are managed by Ada County Highway District (ACHD)
    // — unusual structure where county controls streets within city limits.
    bounds: { latMin: 43.4, latMax: 43.8, lonMin: -116.5, lonMax: -115.9 },
    stateCode: "ID",
    jurisdiction: {
      dotName: "Ada County Highway District (ACHD)",
      planningOfficeName: "Boise Planning and Development Services",
      parkingCodeCitation: "Boise City Code, Title 11, Chapter 11-04 — Off-Street Parking.",
    },
    dataSourceId: "itd",
    active: true,
  },
  billings_metro: {
    code: "billings_metro",
    displayName: "Billings MT MSA",
    bounds: { latMin: 45.6, latMax: 45.9, lonMin: -108.7, lonMax: -108.3 },
    stateCode: "MT",
    jurisdiction: {
      dotName: "Billings Public Works Department",
      planningOfficeName: "Billings Community Planning and Community Services",
      parkingCodeCitation: "Billings City Code, Chapter 27, Article XIII — Off-Street Parking.",
    },
    dataSourceId: "mdt",
    active: true,
  },
  cheyenne_metro: {
    code: "cheyenne_metro",
    displayName: "Cheyenne MSA",
    bounds: { latMin: 41.0, latMax: 41.3, lonMin: -104.9, lonMax: -104.7 },
    stateCode: "WY",
    jurisdiction: {
      dotName: "Cheyenne Public Works Department",
      planningOfficeName: "Cheyenne Planning and Development Office",
      parkingCodeCitation: "Cheyenne Unified Development Code, Section 5-8 — Off-Street Parking.",
    },
    dataSourceId: "wydot",
    active: true,
  },
  anchorage_metro: {
    code: "anchorage_metro",
    displayName: "Anchorage Municipality",
    bounds: { latMin: 61.1, latMax: 61.3, lonMin: -150.0, lonMax: -149.5 },
    stateCode: "AK",
    jurisdiction: {
      dotName: "Anchorage Department of Public Works — Project Management & Engineering",
      planningOfficeName: "Anchorage Planning Department",
      parkingCodeCitation: "Anchorage Municipal Code, Title 21, Chapter 21.07.090 — Off-Street Parking.",
    },
    dataSourceId: "akdot",
    active: true,
  },
  honolulu_metro: {
    code: "honolulu_metro",
    displayName: "Urban Honolulu MSA (City and County of Honolulu)",
    bounds: { latMin: 21.2, latMax: 21.5, lonMin: -158.0, lonMax: -157.7 },
    stateCode: "HI",
    jurisdiction: {
      dotName: "Honolulu Department of Transportation Services",
      planningOfficeName: "Honolulu Department of Planning and Permitting",
      parkingCodeCitation: "Honolulu Land Use Ordinance, Chapter 21, Article 6 — Off-Street Parking and Loading.",
    },
    dataSourceId: "hidot",
    active: true,
  },

  // ── Tier-8: Canada (10 metros across 7 provinces) ──
  // Bounds tightened to CMA cores (Census Metropolitan Areas). Jurisdiction
  // copy references municipal transportation services + by-laws (not
  // "ordinances") + TAC-aligned parking standards.
  toronto_metro: {
    code: "toronto_metro",
    displayName: "Toronto CMA",
    bounds: { latMin: 43.5, latMax: 44.0, lonMin: -79.7, lonMax: -79.0 },
    stateCode: "ON",
    country: "CA",
    jurisdiction: {
      dotName: "City of Toronto Transportation Services",
      planningOfficeName: "City Planning Division",
      parkingCodeCitation: "Toronto Zoning By-law 569-2013, Chapter 200 — Parking Space Regulations.",
    },
    dataSourceId: "mto",
    active: true,
  },
  montreal_metro: {
    code: "montreal_metro",
    displayName: "Montréal CMM",
    bounds: { latMin: 45.4, latMax: 45.7, lonMin: -73.8, lonMax: -73.4 },
    stateCode: "QC",
    country: "CA",
    jurisdiction: {
      dotName: "Service de l'urbanisme et de la mobilité (Montréal)",
      planningOfficeName: "Service de l'urbanisme et de la mobilité",
      parkingCodeCitation: "Règlement d'urbanisme de la Ville de Montréal (RV 01-282), Section IV — Stationnement.",
    },
    dataSourceId: "mtq",
    active: true,
  },
  vancouver_metro: {
    code: "vancouver_metro",
    displayName: "Metro Vancouver Regional District",
    bounds: { latMin: 49.1, latMax: 49.4, lonMin: -123.3, lonMax: -122.5 },
    stateCode: "BC",
    country: "CA",
    jurisdiction: {
      dotName: "City of Vancouver Engineering — Transportation Division",
      planningOfficeName: "City of Vancouver Planning, Urban Design and Sustainability",
      parkingCodeCitation: "Vancouver Parking By-law No. 6059, Sections 4-6 — Off-Street Parking.",
    },
    dataSourceId: "moti_bc",
    active: true,
  },
  calgary_metro: {
    code: "calgary_metro",
    displayName: "Calgary CMA",
    bounds: { latMin: 50.8, latMax: 51.2, lonMin: -114.3, lonMax: -113.8 },
    stateCode: "AB",
    country: "CA",
    jurisdiction: {
      dotName: "City of Calgary Transportation Department",
      planningOfficeName: "Calgary Planning and Development Services",
      parkingCodeCitation: "Calgary Land Use Bylaw 1P2007, Part 4, Division 5 — Motor Vehicle Parking.",
    },
    dataSourceId: "ab_transportation",
    active: true,
  },
  ottawa_metro: {
    code: "ottawa_metro",
    displayName: "Ottawa CMA",
    bounds: { latMin: 45.2, latMax: 45.5, lonMin: -76.0, lonMax: -75.4 },
    stateCode: "ON",
    country: "CA",
    jurisdiction: {
      dotName: "City of Ottawa Transportation Services Department",
      planningOfficeName: "Planning, Real Estate and Economic Development (PRED)",
      parkingCodeCitation: "Ottawa Zoning By-law 2008-250, Section 100 — Parking Space Rates.",
    },
    dataSourceId: "mto",
    active: true,
  },
  edmonton_metro: {
    code: "edmonton_metro",
    displayName: "Edmonton CMA",
    bounds: { latMin: 53.4, latMax: 53.7, lonMin: -113.7, lonMax: -113.3 },
    stateCode: "AB",
    country: "CA",
    jurisdiction: {
      dotName: "City of Edmonton Integrated Infrastructure Services — Transportation",
      planningOfficeName: "Edmonton Urban Planning and Economy",
      parkingCodeCitation: "Edmonton Zoning Bylaw 20001, Section 6.60 — Motor Vehicle Parking.",
    },
    dataSourceId: "ab_transportation",
    active: true,
  },
  winnipeg_metro: {
    code: "winnipeg_metro",
    displayName: "Winnipeg CMA",
    bounds: { latMin: 49.7, latMax: 50.0, lonMin: -97.3, lonMax: -96.9 },
    stateCode: "MB",
    country: "CA",
    jurisdiction: {
      dotName: "City of Winnipeg Public Works — Transportation Division",
      planningOfficeName: "Winnipeg Planning, Property and Development Department",
      parkingCodeCitation: "Winnipeg Zoning By-law 200/2006, Part 5 — Off-Street Parking and Loading.",
    },
    dataSourceId: "mb_infrastructure",
    active: true,
  },
  quebec_city_metro: {
    code: "quebec_city_metro",
    displayName: "Québec CMA",
    bounds: { latMin: 46.7, latMax: 47.0, lonMin: -71.4, lonMax: -71.1 },
    stateCode: "QC",
    country: "CA",
    jurisdiction: {
      dotName: "Service du transport et de la mobilité intelligente (Ville de Québec)",
      planningOfficeName: "Service de la planification de l'aménagement et de l'environnement",
      parkingCodeCitation: "Règlement de l'arrondissement de Québec sur l'urbanisme R.V.Q. 1400, Chapitre IV — Stationnement.",
    },
    dataSourceId: "mtq",
    active: true,
  },
  hamilton_metro: {
    code: "hamilton_metro",
    displayName: "Hamilton CMA",
    bounds: { latMin: 43.1, latMax: 43.4, lonMin: -80.0, lonMax: -79.7 },
    stateCode: "ON",
    country: "CA",
    jurisdiction: {
      dotName: "City of Hamilton Public Works — Transportation Planning and Parking",
      planningOfficeName: "Hamilton Planning and Economic Development",
      parkingCodeCitation: "Hamilton Zoning By-law 05-200, Section 5 — Parking and Loading.",
    },
    dataSourceId: "mto",
    active: true,
  },
  halifax_metro: {
    code: "halifax_metro",
    displayName: "Halifax CMA",
    bounds: { latMin: 44.5, latMax: 44.8, lonMin: -63.8, lonMax: -63.4 },
    stateCode: "NS",
    country: "CA",
    jurisdiction: {
      dotName: "Halifax Regional Municipality Transportation and Public Works",
      planningOfficeName: "HRM Planning and Development",
      parkingCodeCitation: "Halifax Regional Municipality Land Use By-law (Centre Plan), Part 8 — Off-Street Parking.",
    },
    dataSourceId: "ns_public_works",
    active: true,
  },

  // ── Tier-9: Mexico (10 metros across 10 estados) ──
  // Parking citations reference the relevant Reglamento de Construcciones or
  // Reglamento de Tránsito at the municipal / state level. Jurisdictional
  // names kept in Spanish where the entity has no canonical English form.
  mexico_city_metro: {
    code: "mexico_city_metro",
    displayName: "Ciudad de México (ZMVM)",
    bounds: { latMin: 19.2, latMax: 19.6, lonMin: -99.3, lonMax: -98.9 },
    stateCode: "CMX",
    country: "MX",
    jurisdiction: {
      dotName: "Secretaría de Movilidad (SEMOVI) — Ciudad de México",
      planningOfficeName: "Secretaría de Desarrollo Urbano y Vivienda (SEDUVI)",
      parkingCodeCitation: "Reglamento de Construcciones para el Distrito Federal, Título Sexto, Capítulo III — Estacionamientos.",
    },
    dataSourceId: "sict",
    active: true,
  },
  guadalajara_metro: {
    code: "guadalajara_metro",
    displayName: "Guadalajara ZM",
    bounds: { latMin: 20.5, latMax: 20.8, lonMin: -103.5, lonMax: -103.2 },
    stateCode: "JAL",
    country: "MX",
    jurisdiction: {
      dotName: "Secretaría de Transporte del Gobierno de Jalisco / Servicios Públicos Municipales",
      planningOfficeName: "Instituto Metropolitano de Planeación del AMG (IMEPLAN)",
      parkingCodeCitation: "Reglamento Estatal de Zonificación del Estado de Jalisco, Título III — Estacionamientos.",
    },
    dataSourceId: "sict",
    active: true,
  },
  monterrey_metro: {
    code: "monterrey_metro",
    displayName: "Monterrey ZM",
    bounds: { latMin: 25.5, latMax: 25.9, lonMin: -100.5, lonMax: -100.1 },
    stateCode: "NLE",
    country: "MX",
    jurisdiction: {
      dotName: "Secretaría de Movilidad y Planeación Urbana de Nuevo León",
      planningOfficeName: "Consejo Estatal de Transporte y Vialidad",
      parkingCodeCitation: "Ley de Asentamientos Humanos del Estado de Nuevo León, Capítulo VI — Estacionamientos.",
    },
    dataSourceId: "sict",
    active: true,
  },
  puebla_metro: {
    code: "puebla_metro",
    displayName: "Puebla-Tlaxcala ZM",
    bounds: { latMin: 18.9, latMax: 19.2, lonMin: -98.3, lonMax: -98.0 },
    stateCode: "PUE",
    country: "MX",
    jurisdiction: {
      dotName: "Secretaría de Movilidad y Transporte del Estado de Puebla",
      planningOfficeName: "Secretaría de Desarrollo Urbano del Municipio de Puebla",
      parkingCodeCitation: "Reglamento de Tránsito, Movilidad y Seguridad Vial para el Municipio de Puebla, Título Sexto.",
    },
    dataSourceId: "sict",
    active: true,
  },
  tijuana_metro: {
    code: "tijuana_metro",
    displayName: "Tijuana ZM",
    // North edge clipped at 32.53 — the US-Mexico border south of San Diego.
    // Tijuana sits south of the border line; San Diego covers everything north.
    bounds: { latMin: 32.4, latMax: 32.53, lonMin: -117.1, lonMax: -116.8 },
    stateCode: "BCN",
    country: "MX",
    jurisdiction: {
      dotName: "Secretaría de Movilidad Sustentable y Planeación Urbana de Baja California",
      planningOfficeName: "Instituto Metropolitano de Planeación de Tijuana (IMPLAN)",
      parkingCodeCitation: "Reglamento de Vialidad y Tránsito Municipal para el Municipio de Tijuana, Capítulo IX.",
    },
    dataSourceId: "sict",
    active: true,
  },
  toluca_metro: {
    code: "toluca_metro",
    displayName: "Toluca ZM",
    bounds: { latMin: 19.2, latMax: 19.4, lonMin: -99.8, lonMax: -99.5 },
    stateCode: "MEX",
    country: "MX",
    jurisdiction: {
      dotName: "Secretaría de Movilidad del Estado de México (SEMOV)",
      planningOfficeName: "Secretaría de Desarrollo Urbano y Obra del Estado de México",
      parkingCodeCitation: "Código Administrativo del Estado de México, Libro Quinto — Ordenamiento Territorial.",
    },
    dataSourceId: "sict",
    active: true,
  },
  leon_metro: {
    code: "leon_metro",
    displayName: "León ZM",
    bounds: { latMin: 21.0, latMax: 21.2, lonMin: -101.8, lonMax: -101.5 },
    stateCode: "GUA",
    country: "MX",
    jurisdiction: {
      dotName: "Dirección General de Movilidad del Municipio de León",
      planningOfficeName: "Instituto Municipal de Planeación de León (IMPLAN León)",
      parkingCodeCitation: "Reglamento de los Servicios de Vialidad, Tránsito y Transporte del Municipio de León, Título IV.",
    },
    dataSourceId: "sict",
    active: true,
  },
  juarez_metro: {
    code: "juarez_metro",
    displayName: "Ciudad Juárez ZM",
    // North edge clipped at 31.75 — the Rio Grande forms the US-Mexico
    // border south of El Paso. Juárez sits south of the river, El Paso north.
    bounds: { latMin: 31.5, latMax: 31.75, lonMin: -106.6, lonMax: -106.3 },
    stateCode: "CHH",
    country: "MX",
    jurisdiction: {
      dotName: "Dirección General de Tránsito Municipal de Juárez",
      planningOfficeName: "Instituto Municipal de Investigación y Planeación (IMIP Juárez)",
      parkingCodeCitation: "Reglamento de Vialidad y Tránsito del Municipio de Juárez, Capítulo XII.",
    },
    dataSourceId: "sict",
    active: true,
  },
  queretaro_metro: {
    code: "queretaro_metro",
    displayName: "Querétaro ZM",
    bounds: { latMin: 20.5, latMax: 20.7, lonMin: -100.5, lonMax: -100.3 },
    stateCode: "QUE",
    country: "MX",
    jurisdiction: {
      dotName: "Secretaría de Movilidad del Estado de Querétaro",
      planningOfficeName: "Instituto Municipal de Planeación de Querétaro (IMPLAN)",
      parkingCodeCitation: "Código Urbano del Estado de Querétaro, Título Sexto — Estacionamientos.",
    },
    dataSourceId: "sict",
    active: true,
  },
  merida_metro: {
    code: "merida_metro",
    displayName: "Mérida ZM",
    bounds: { latMin: 20.9, latMax: 21.1, lonMin: -89.7, lonMax: -89.5 },
    stateCode: "YUC",
    country: "MX",
    jurisdiction: {
      dotName: "Agencia de Transporte del Estado de Yucatán (ATY)",
      planningOfficeName: "Instituto Municipal de Planeación de Mérida (IMPLAN Mérida)",
      parkingCodeCitation: "Reglamento de Construcciones del Municipio de Mérida, Título Tercero — Estacionamientos.",
    },
    dataSourceId: "sict",
    active: true,
  },

  // ── Tier-9: United Kingdom (7 metros across England + Scotland) ──
  // Parking citations reference local planning policy (Local Plans + national
  // PPG13/NPPF). Engineering would actually use DMRB (Design Manual for
  // Roads and Bridges) — tracked as a follow-up engine citation fork.
  london_metro: {
    code: "london_metro",
    displayName: "Greater London",
    bounds: { latMin: 51.28, latMax: 51.69, lonMin: -0.51, lonMax: 0.33 },
    stateCode: "ENG",
    country: "UK",
    jurisdiction: {
      dotName: "Transport for London (TfL) — Streets",
      planningOfficeName: "Greater London Authority (GLA) — London Plan",
      parkingCodeCitation: "London Plan 2021, Policy T6 — Car parking. Plus each LPA's local plan (e.g. Westminster City Plan).",
    },
    dataSourceId: "dft",
    active: true,
  },
  manchester_uk_metro: {
    code: "manchester_uk_metro",
    displayName: "Greater Manchester",
    bounds: { latMin: 53.35, latMax: 53.60, lonMin: -2.42, lonMax: -2.05 },
    stateCode: "ENG",
    country: "UK",
    jurisdiction: {
      dotName: "Transport for Greater Manchester (TfGM)",
      planningOfficeName: "Greater Manchester Combined Authority — Places for Everyone",
      parkingCodeCitation: "Manchester Core Strategy DM3 — Parking Standards (and equivalents across the 10 GM boroughs).",
    },
    dataSourceId: "dft",
    active: true,
  },
  birmingham_uk_metro: {
    code: "birmingham_uk_metro",
    displayName: "West Midlands (Birmingham)",
    bounds: { latMin: 52.40, latMax: 52.58, lonMin: -2.02, lonMax: -1.70 },
    stateCode: "ENG",
    country: "UK",
    jurisdiction: {
      dotName: "Transport for West Midlands (TfWM)",
      planningOfficeName: "West Midlands Combined Authority — Strategic Transport Plan",
      parkingCodeCitation: "Birmingham Development Plan 2031, TP44 — Car Parking Standards.",
    },
    dataSourceId: "dft",
    active: true,
  },
  glasgow_metro: {
    code: "glasgow_metro",
    displayName: "Glasgow City Region",
    bounds: { latMin: 55.78, latMax: 55.95, lonMin: -4.42, lonMax: -4.10 },
    stateCode: "SCT",
    country: "UK",
    jurisdiction: {
      dotName: "Strathclyde Partnership for Transport (SPT)",
      planningOfficeName: "Glasgow City Council Planning Authority",
      parkingCodeCitation: "Glasgow City Development Plan IPG 8 — Car Parking Standards.",
    },
    dataSourceId: "dft",
    active: true,
  },
  edinburgh_metro: {
    code: "edinburgh_metro",
    displayName: "Edinburgh + Lothians",
    bounds: { latMin: 55.88, latMax: 56.00, lonMin: -3.40, lonMax: -3.00 },
    stateCode: "SCT",
    country: "UK",
    jurisdiction: {
      dotName: "Edinburgh Council Place Directorate — Transport and Environment",
      planningOfficeName: "City of Edinburgh Council Planning Service",
      parkingCodeCitation: "Edinburgh City Plan 2030 Policy Tra 7 — Car parking standards.",
    },
    dataSourceId: "dft",
    active: true,
  },
  leeds_metro: {
    code: "leeds_metro",
    displayName: "West Yorkshire (Leeds-Bradford)",
    bounds: { latMin: 53.70, latMax: 53.90, lonMin: -1.72, lonMax: -1.40 },
    stateCode: "ENG",
    country: "UK",
    jurisdiction: {
      dotName: "West Yorkshire Combined Authority — Transport",
      planningOfficeName: "Leeds City Council Local Plans Team",
      parkingCodeCitation: "Leeds Core Strategy Policy T2 — Parking and Highways Standards.",
    },
    dataSourceId: "dft",
    active: true,
  },
  bristol_metro: {
    code: "bristol_metro",
    displayName: "Bristol (West of England)",
    bounds: { latMin: 51.40, latMax: 51.55, lonMin: -2.70, lonMax: -2.40 },
    stateCode: "ENG",
    country: "UK",
    jurisdiction: {
      dotName: "West of England Combined Authority — Transport",
      planningOfficeName: "Bristol City Council Strategic City Planning",
      parkingCodeCitation: "Bristol Local Plan Policy BCS10 — Transport and Access Improvements.",
    },
    dataSourceId: "dft",
    active: true,
  },

  // ── Tier-7: depth push (55 secondary metros in already-wired states) ──
  // NY (4) — all NYSDOT
  rochester_ny_metro: { code: "rochester_ny_metro", displayName: "Rochester (NY) MSA", bounds: { latMin: 43.0, latMax: 43.3, lonMin: -78.0, lonMax: -77.4 }, stateCode: "NY", jurisdiction: { dotName: "Rochester Department of Environmental Services", planningOfficeName: "Rochester Bureau of Planning and Zoning", parkingCodeCitation: "Rochester City Code, Chapter 120, Article XII — Off-Street Parking." }, dataSourceId: "nysdot", active: true },
  buffalo_metro: { code: "buffalo_metro", displayName: "Buffalo-Cheektowaga-Niagara Falls MSA", bounds: { latMin: 42.7, latMax: 43.1, lonMin: -79.0, lonMax: -78.5 }, stateCode: "NY", jurisdiction: { dotName: "Buffalo Department of Public Works", planningOfficeName: "Buffalo Office of Strategic Planning", parkingCodeCitation: "Buffalo Unified Development Ordinance, Section 9.3 — Off-Street Parking." }, dataSourceId: "nysdot", active: true },
  syracuse_metro: { code: "syracuse_metro", displayName: "Syracuse MSA", bounds: { latMin: 42.9, latMax: 43.2, lonMin: -76.3, lonMax: -75.9 }, stateCode: "NY", jurisdiction: { dotName: "Syracuse Department of Public Works", planningOfficeName: "Syracuse Bureau of Planning and Sustainability", parkingCodeCitation: "Syracuse Zoning Rules and Regulations, Section IV.D — Parking." }, dataSourceId: "nysdot", active: true },
  albany_metro: { code: "albany_metro", displayName: "Albany-Schenectady-Troy MSA", bounds: { latMin: 42.5, latMax: 42.9, lonMin: -74.0, lonMax: -73.6 }, stateCode: "NY", jurisdiction: { dotName: "Albany Department of General Services", planningOfficeName: "Albany Department of Planning and Development", parkingCodeCitation: "Albany Unified Sustainable Development Ordinance, Article III — Parking." }, dataSourceId: "nysdot", active: true },
  // OH (4) — all ODOT
  toledo_metro: { code: "toledo_metro", displayName: "Toledo MSA", bounds: { latMin: 41.5, latMax: 41.8, lonMin: -84.0, lonMax: -83.4 }, stateCode: "OH", jurisdiction: { dotName: "Toledo Division of Transportation", planningOfficeName: "Toledo Plan Commission", parkingCodeCitation: "Toledo Municipal Code, Chapter 1107 — Off-Street Parking." }, dataSourceId: "odot_oh", active: true },
  akron_metro: { code: "akron_metro", displayName: "Akron MSA", bounds: { latMin: 41.0, latMax: 41.2, lonMin: -81.7, lonMax: -81.3 }, stateCode: "OH", jurisdiction: { dotName: "Akron Engineering Bureau", planningOfficeName: "Akron Planning Department", parkingCodeCitation: "Akron Codified Ordinances, Title 1, Chapter 153 — Off-Street Parking." }, dataSourceId: "odot_oh", active: true },
  dayton_metro: { code: "dayton_metro", displayName: "Dayton-Kettering MSA", bounds: { latMin: 39.6, latMax: 40.0, lonMin: -84.3, lonMax: -83.9 }, stateCode: "OH", jurisdiction: { dotName: "Dayton Department of Public Works", planningOfficeName: "Dayton Department of Planning, Neighborhoods, and Development", parkingCodeCitation: "Dayton Land Development Code, Chapter 150-322 — Off-Street Parking." }, dataSourceId: "odot_oh", active: true },
  youngstown_metro: { code: "youngstown_metro", displayName: "Youngstown-Warren-Boardman MSA", bounds: { latMin: 41.0, latMax: 41.3, lonMin: -80.9, lonMax: -80.5 }, stateCode: "OH", jurisdiction: { dotName: "Youngstown Public Works Department", planningOfficeName: "Youngstown City Planning Commission", parkingCodeCitation: "Youngstown Zoning Code, Chapter 1163 — Off-Street Parking." }, dataSourceId: "odot_oh", active: true },
  // MI (4) — all MDOT-MI
  grand_rapids_metro: { code: "grand_rapids_metro", displayName: "Grand Rapids-Kentwood MSA", bounds: { latMin: 42.8, latMax: 43.1, lonMin: -85.9, lonMax: -85.4 }, stateCode: "MI", jurisdiction: { dotName: "Grand Rapids Engineering Department", planningOfficeName: "Grand Rapids Planning Department", parkingCodeCitation: "Grand Rapids Zoning Ordinance, Chapter 61 — Off-Street Parking." }, dataSourceId: "mdot_mi", active: true },
  lansing_metro: { code: "lansing_metro", displayName: "Lansing-East Lansing MSA", bounds: { latMin: 42.6, latMax: 42.9, lonMin: -84.7, lonMax: -84.3 }, stateCode: "MI", jurisdiction: { dotName: "Lansing Department of Public Service", planningOfficeName: "Lansing Planning Office", parkingCodeCitation: "Lansing Zoning Ordinance, Chapter 1290 — Parking." }, dataSourceId: "mdot_mi", active: true },
  ann_arbor_metro: { code: "ann_arbor_metro", displayName: "Ann Arbor MSA", bounds: { latMin: 42.2, latMax: 42.4, lonMin: -83.9, lonMax: -83.6 }, stateCode: "MI", jurisdiction: { dotName: "Ann Arbor Public Services Department", planningOfficeName: "Ann Arbor Planning Services", parkingCodeCitation: "Ann Arbor Unified Development Code, Section 5.16 — Parking." }, dataSourceId: "mdot_mi", active: true },
  flint_metro: { code: "flint_metro", displayName: "Flint MSA", bounds: { latMin: 42.9, latMax: 43.2, lonMin: -83.9, lonMax: -83.5 }, stateCode: "MI", jurisdiction: { dotName: "Flint Department of Public Works", planningOfficeName: "Flint Department of Planning and Development", parkingCodeCitation: "Flint Zoning Ordinance, Article 50-22 — Off-Street Parking." }, dataSourceId: "mdot_mi", active: true },
  // PA (4) — all PennDOT
  allentown_metro: { code: "allentown_metro", displayName: "Allentown-Bethlehem-Easton MSA", bounds: { latMin: 40.5, latMax: 40.8, lonMin: -75.7, lonMax: -75.2 }, stateCode: "PA", jurisdiction: { dotName: "Allentown Public Works Department", planningOfficeName: "Allentown Planning Bureau", parkingCodeCitation: "Allentown Zoning Ordinance, Article 13 — Off-Street Parking." }, dataSourceId: "penndot", active: true },
  harrisburg_metro: { code: "harrisburg_metro", displayName: "Harrisburg-Carlisle MSA", bounds: { latMin: 40.1, latMax: 40.4, lonMin: -77.0, lonMax: -76.6 }, stateCode: "PA", jurisdiction: { dotName: "Harrisburg Department of Public Works", planningOfficeName: "Harrisburg Bureau of Planning", parkingCodeCitation: "Harrisburg Zoning Code, Chapter 7-329 — Off-Street Parking." }, dataSourceId: "penndot", active: true },
  scranton_metro: { code: "scranton_metro", displayName: "Scranton-Wilkes-Barre MSA", bounds: { latMin: 41.3, latMax: 41.6, lonMin: -75.9, lonMax: -75.4 }, stateCode: "PA", jurisdiction: { dotName: "Scranton Department of Public Works", planningOfficeName: "Scranton Office of Economic and Community Development", parkingCodeCitation: "Scranton Zoning Ordinance, Article VII — Off-Street Parking." }, dataSourceId: "penndot", active: true },
  erie_metro: { code: "erie_metro", displayName: "Erie MSA", bounds: { latMin: 42.0, latMax: 42.2, lonMin: -80.3, lonMax: -79.9 }, stateCode: "PA", jurisdiction: { dotName: "Erie Department of Public Works", planningOfficeName: "Erie Department of Planning", parkingCodeCitation: "Erie Zoning Ordinance, Section 209-71 — Off-Street Parking." }, dataSourceId: "penndot", active: true },
  // MA (2) — MassDOT
  worcester_metro: { code: "worcester_metro", displayName: "Worcester MSA", bounds: { latMin: 42.1, latMax: 42.5, lonMin: -72.0, lonMax: -71.6 }, stateCode: "MA", jurisdiction: { dotName: "Worcester Department of Public Works and Parks", planningOfficeName: "Worcester Division of Planning and Regulatory Services", parkingCodeCitation: "Worcester Zoning Ordinance, Article IV — Parking and Loading." }, dataSourceId: "massdot", active: true },
  springfield_ma_metro: { code: "springfield_ma_metro", displayName: "Springfield (MA) MSA", bounds: { latMin: 42.0, latMax: 42.2, lonMin: -72.8, lonMax: -72.4 }, stateCode: "MA", jurisdiction: { dotName: "Springfield Department of Public Works", planningOfficeName: "Springfield Office of Planning and Economic Development", parkingCodeCitation: "Springfield Zoning Ordinance, Article 7 — Off-Street Parking." }, dataSourceId: "massdot", active: true },
  // CT (2) — CTDOT
  new_haven_metro: { code: "new_haven_metro", displayName: "New Haven-Milford MSA", bounds: { latMin: 41.2, latMax: 41.4, lonMin: -73.1, lonMax: -72.8 }, stateCode: "CT", jurisdiction: { dotName: "New Haven Department of Public Works", planningOfficeName: "New Haven City Plan Department", parkingCodeCitation: "New Haven Zoning Ordinance, Article V, Section 29 — Off-Street Parking." }, dataSourceId: "ctdot", active: true },
  bridgeport_metro: { code: "bridgeport_metro", displayName: "Bridgeport-Stamford-Norwalk MSA", bounds: { latMin: 41.0, latMax: 41.3, lonMin: -73.6, lonMax: -73.0 }, stateCode: "CT", jurisdiction: { dotName: "Bridgeport Department of Public Facilities", planningOfficeName: "Bridgeport Planning and Economic Development Department", parkingCodeCitation: "Bridgeport Zoning Regulations, Section 12 — Off-Street Parking." }, dataSourceId: "ctdot", active: true },
  // IN (3) — INDOT
  fort_wayne_metro: { code: "fort_wayne_metro", displayName: "Fort Wayne MSA", bounds: { latMin: 40.9, latMax: 41.2, lonMin: -85.4, lonMax: -85.0 }, stateCode: "IN", jurisdiction: { dotName: "Fort Wayne Public Works Division", planningOfficeName: "Fort Wayne Department of Planning Services", parkingCodeCitation: "Fort Wayne Unified Development Ordinance, Section 6.4 — Parking." }, dataSourceId: "indot", active: true },
  south_bend_metro: { code: "south_bend_metro", displayName: "South Bend-Mishawaka MSA", bounds: { latMin: 41.5, latMax: 41.8, lonMin: -86.4, lonMax: -86.0 }, stateCode: "IN", jurisdiction: { dotName: "South Bend Department of Public Works", planningOfficeName: "South Bend Department of Community Investment", parkingCodeCitation: "South Bend Zoning Ordinance, Chapter 21-08 — Parking." }, dataSourceId: "indot", active: true },
  evansville_metro: { code: "evansville_metro", displayName: "Evansville MSA", bounds: { latMin: 37.8, latMax: 38.2, lonMin: -87.8, lonMax: -87.3 }, stateCode: "IN", jurisdiction: { dotName: "Evansville Department of Transportation and Services", planningOfficeName: "Evansville Area Plan Commission", parkingCodeCitation: "Evansville Zoning Code, Chapter 18.155 — Off-Street Parking." }, dataSourceId: "indot", active: true },
  // WI (2) — WisDOT
  madison_metro: { code: "madison_metro", displayName: "Madison MSA", bounds: { latMin: 43.0, latMax: 43.2, lonMin: -89.6, lonMax: -89.2 }, stateCode: "WI", jurisdiction: { dotName: "Madison Traffic Engineering Division", planningOfficeName: "Madison Department of Planning, Community and Economic Development", parkingCodeCitation: "Madison General Ordinances, Section 28.141 — Parking." }, dataSourceId: "wisdot", active: true },
  green_bay_metro: { code: "green_bay_metro", displayName: "Green Bay MSA", bounds: { latMin: 44.4, latMax: 44.6, lonMin: -88.2, lonMax: -87.8 }, stateCode: "WI", jurisdiction: { dotName: "Green Bay Department of Public Works", planningOfficeName: "Green Bay Department of Community and Economic Development", parkingCodeCitation: "Green Bay Zoning Ordinance, Section 13-1903 — Off-Street Parking." }, dataSourceId: "wisdot", active: true },
  // IL (4) — IDOT
  springfield_il_metro: { code: "springfield_il_metro", displayName: "Springfield (IL) MSA", bounds: { latMin: 39.6, latMax: 39.9, lonMin: -89.8, lonMax: -89.5 }, stateCode: "IL", jurisdiction: { dotName: "Springfield Department of Public Works", planningOfficeName: "Springfield-Sangamon County Regional Planning Commission", parkingCodeCitation: "Springfield Zoning Ordinance, Chapter 155.103 — Off-Street Parking." }, dataSourceId: "idot", active: true },
  rockford_metro: { code: "rockford_metro", displayName: "Rockford MSA", bounds: { latMin: 42.1, latMax: 42.4, lonMin: -89.2, lonMax: -88.8 }, stateCode: "IL", jurisdiction: { dotName: "Rockford Department of Public Works", planningOfficeName: "Rockford Community and Economic Development Department", parkingCodeCitation: "Rockford Zoning Ordinance, Article 9 — Off-Street Parking." }, dataSourceId: "idot", active: true },
  peoria_metro: { code: "peoria_metro", displayName: "Peoria MSA", bounds: { latMin: 40.5, latMax: 40.9, lonMin: -89.8, lonMax: -89.3 }, stateCode: "IL", jurisdiction: { dotName: "Peoria Public Works Department", planningOfficeName: "Peoria Community Development Department", parkingCodeCitation: "Peoria Code of Ordinances, Appendix B, Section 6.5 — Off-Street Parking." }, dataSourceId: "idot", active: true },
  champaign_metro: { code: "champaign_metro", displayName: "Champaign-Urbana MSA", bounds: { latMin: 40.0, latMax: 40.2, lonMin: -88.4, lonMax: -88.1 }, stateCode: "IL", jurisdiction: { dotName: "Champaign Public Works Department", planningOfficeName: "Champaign Planning and Development Department", parkingCodeCitation: "Champaign Zoning Ordinance, Article VII — Off-Street Parking." }, dataSourceId: "idot", active: true },
  // TX (4) — TxDOT
  el_paso_metro: { code: "el_paso_metro", displayName: "El Paso MSA", bounds: { latMin: 31.75, latMax: 31.95, lonMin: -106.6, lonMax: -106.2 }, stateCode: "TX", jurisdiction: { dotName: "El Paso Streets and Maintenance Department", planningOfficeName: "El Paso Planning and Inspections Department", parkingCodeCitation: "El Paso City Code, Chapter 20.18 — Off-Street Parking." }, dataSourceId: "txdot", active: true },
  corpus_christi_metro: { code: "corpus_christi_metro", displayName: "Corpus Christi MSA", bounds: { latMin: 27.6, latMax: 28.0, lonMin: -97.6, lonMax: -97.2 }, stateCode: "TX", jurisdiction: { dotName: "Corpus Christi Engineering Services Department", planningOfficeName: "Corpus Christi Development Services Department", parkingCodeCitation: "Corpus Christi Unified Development Code, Article 7 — Parking." }, dataSourceId: "txdot", active: true },
  lubbock_metro: { code: "lubbock_metro", displayName: "Lubbock MSA", bounds: { latMin: 33.4, latMax: 33.7, lonMin: -102.0, lonMax: -101.7 }, stateCode: "TX", jurisdiction: { dotName: "Lubbock Public Works Department", planningOfficeName: "Lubbock Planning Department", parkingCodeCitation: "Lubbock Code of Ordinances, Chapter 40 — Off-Street Parking." }, dataSourceId: "txdot", active: true },
  mcallen_metro: { code: "mcallen_metro", displayName: "McAllen-Edinburg-Mission MSA", bounds: { latMin: 26.0, latMax: 26.4, lonMin: -98.4, lonMax: -97.9 }, stateCode: "TX", jurisdiction: { dotName: "McAllen Public Works Department", planningOfficeName: "McAllen Planning Department", parkingCodeCitation: "McAllen Code of Ordinances, Chapter 138 — Off-Street Parking." }, dataSourceId: "txdot", active: true },
  // CA (4) — Caltrans (Tier-B expected; state highways only)
  bakersfield_metro: { code: "bakersfield_metro", displayName: "Bakersfield MSA", bounds: { latMin: 35.2, latMax: 35.5, lonMin: -119.2, lonMax: -118.9 }, stateCode: "CA", jurisdiction: { dotName: "Bakersfield Public Works Department", planningOfficeName: "Bakersfield Development Services Department", parkingCodeCitation: "Bakersfield Municipal Code, Chapter 17.58 — Off-Street Parking." }, dataSourceId: "caltrans", active: true },
  stockton_metro: { code: "stockton_metro", displayName: "Stockton-Lodi MSA", bounds: { latMin: 37.8, latMax: 38.2, lonMin: -121.5, lonMax: -121.1 }, stateCode: "CA", jurisdiction: { dotName: "Stockton Public Works Department", planningOfficeName: "Stockton Community Development Department", parkingCodeCitation: "Stockton Municipal Code, Title 16, Chapter 16.64 — Parking." }, dataSourceId: "caltrans", active: true },
  modesto_metro: { code: "modesto_metro", displayName: "Modesto MSA", bounds: { latMin: 37.5, latMax: 37.8, lonMin: -121.2, lonMax: -120.8 }, stateCode: "CA", jurisdiction: { dotName: "Modesto Public Works Department", planningOfficeName: "Modesto Community and Economic Development Department", parkingCodeCitation: "Modesto Municipal Code, Title 10, Chapter 10-2.1407 — Parking." }, dataSourceId: "caltrans", active: true },
  oxnard_metro: { code: "oxnard_metro", displayName: "Oxnard-Thousand Oaks-Ventura MSA", bounds: { latMin: 34.1, latMax: 34.5, lonMin: -119.5, lonMax: -118.7 }, stateCode: "CA", jurisdiction: { dotName: "Oxnard Public Works Department", planningOfficeName: "Oxnard Development Services Department", parkingCodeCitation: "Oxnard City Code, Chapter 16, Article 7 — Off-Street Parking." }, dataSourceId: "caltrans", active: true },
  // CO (2) — CDOT-CO
  colorado_springs_metro: { code: "colorado_springs_metro", displayName: "Colorado Springs MSA", bounds: { latMin: 38.7, latMax: 39.0, lonMin: -104.9, lonMax: -104.6 }, stateCode: "CO", jurisdiction: { dotName: "Colorado Springs Public Works Department", planningOfficeName: "Colorado Springs Planning and Community Development Department", parkingCodeCitation: "Colorado Springs City Code, Chapter 7, Article 4 — Parking." }, dataSourceId: "cdot_co", active: true },
  fort_collins_metro: { code: "fort_collins_metro", displayName: "Fort Collins MSA", bounds: { latMin: 40.4, latMax: 40.7, lonMin: -105.2, lonMax: -104.9 }, stateCode: "CO", jurisdiction: { dotName: "Fort Collins Streets Department", planningOfficeName: "Fort Collins Community Development and Neighborhood Services", parkingCodeCitation: "Fort Collins Land Use Code, Article 3.2.2 — Access, Circulation and Parking." }, dataSourceId: "cdot_co", active: true },
  // NV (1) — NDOT-NV
  reno_metro: { code: "reno_metro", displayName: "Reno-Sparks MSA", bounds: { latMin: 39.4, latMax: 39.7, lonMin: -119.9, lonMax: -119.6 }, stateCode: "NV", jurisdiction: { dotName: "Reno Public Works Department", planningOfficeName: "Reno Community Development Department", parkingCodeCitation: "Reno Municipal Code, Title 18.12, Section 18.12.1305 — Parking." }, dataSourceId: "nvdot", active: true },
  // WA (2) — WSDOT
  spokane_metro: { code: "spokane_metro", displayName: "Spokane-Spokane Valley MSA", bounds: { latMin: 47.5, latMax: 47.8, lonMin: -117.6, lonMax: -117.2 }, stateCode: "WA", jurisdiction: { dotName: "Spokane Streets Department", planningOfficeName: "Spokane Planning Services Department", parkingCodeCitation: "Spokane Municipal Code, Chapter 17C.230 — Parking and Loading." }, dataSourceId: "wsdot", active: true },
  tacoma_metro: { code: "tacoma_metro", displayName: "Tacoma-Pierce County (sub-MSA)", bounds: { latMin: 47.0, latMax: 47.4, lonMin: -122.7, lonMax: -122.2 }, stateCode: "WA", jurisdiction: { dotName: "Tacoma Public Works Department", planningOfficeName: "Tacoma Planning and Development Services", parkingCodeCitation: "Tacoma Municipal Code, Chapter 13.06.510 — Off-Street Parking." }, dataSourceId: "wsdot", active: true },
  // OR (2) — ODOT-OR
  eugene_metro: { code: "eugene_metro", displayName: "Eugene-Springfield MSA", bounds: { latMin: 43.9, latMax: 44.2, lonMin: -123.3, lonMax: -122.9 }, stateCode: "OR", jurisdiction: { dotName: "Eugene Public Works Department", planningOfficeName: "Eugene Planning Division", parkingCodeCitation: "Eugene Code, Chapter 9.6400 — Parking and Loading Standards." }, dataSourceId: "odot_or", active: true },
  salem_or_metro: { code: "salem_or_metro", displayName: "Salem (OR) MSA", bounds: { latMin: 44.8, latMax: 45.1, lonMin: -123.2, lonMax: -122.8 }, stateCode: "OR", jurisdiction: { dotName: "Salem Public Works Department", planningOfficeName: "Salem Community Planning and Development Department", parkingCodeCitation: "Salem Revised Code, Title 12, Chapter 806 — Off-Street Parking." }, dataSourceId: "odot_or", active: true },
  // UT (2) — UDOT
  provo_metro: { code: "provo_metro", displayName: "Provo-Orem MSA", bounds: { latMin: 40.1, latMax: 40.4, lonMin: -111.8, lonMax: -111.5 }, stateCode: "UT", jurisdiction: { dotName: "Provo Public Works Department", planningOfficeName: "Provo Community Development Department", parkingCodeCitation: "Provo City Code, Title 14, Chapter 37 — Parking and Loading." }, dataSourceId: "udot", active: true },
  ogden_metro: { code: "ogden_metro", displayName: "Ogden-Clearfield MSA", bounds: { latMin: 41.1, latMax: 41.4, lonMin: -112.2, lonMax: -111.8 }, stateCode: "UT", jurisdiction: { dotName: "Ogden Public Services Department", planningOfficeName: "Ogden Community and Economic Development Department", parkingCodeCitation: "Ogden Municipal Code, Title 15, Chapter 27 — Off-Street Parking." }, dataSourceId: "udot", active: true },
  // MN (2) — MnDOT
  rochester_mn_metro: { code: "rochester_mn_metro", displayName: "Rochester (MN) MSA", bounds: { latMin: 43.9, latMax: 44.2, lonMin: -92.6, lonMax: -92.3 }, stateCode: "MN", jurisdiction: { dotName: "Rochester Department of Public Works", planningOfficeName: "Rochester-Olmsted Planning Department", parkingCodeCitation: "Rochester Code of Ordinances, Section 63.290 — Off-Street Parking." }, dataSourceId: "mndot", active: true },
  duluth_metro: { code: "duluth_metro", displayName: "Duluth MSA", bounds: { latMin: 46.6, latMax: 46.9, lonMin: -92.3, lonMax: -92.0 }, stateCode: "MN", jurisdiction: { dotName: "Duluth Engineering Division", planningOfficeName: "Duluth Planning and Construction Services Division", parkingCodeCitation: "Duluth City Code, Chapter 50, Article VII — Off-Street Parking." }, dataSourceId: "mndot", active: true },
  // FL (6) — FDOT
  fort_lauderdale_metro: { code: "fort_lauderdale_metro", displayName: "Fort Lauderdale (Broward County)", bounds: { latMin: 26.0, latMax: 26.4, lonMin: -80.4, lonMax: -80.0 }, stateCode: "FL", jurisdiction: { dotName: "Fort Lauderdale Transportation and Mobility Department", planningOfficeName: "Broward County Planning Council", parkingCodeCitation: "Fort Lauderdale Unified Land Development Regulations, Section 47-20 — Parking." }, dataSourceId: "fdot", active: true },
  west_palm_beach_metro: { code: "west_palm_beach_metro", displayName: "West Palm Beach (Palm Beach County)", bounds: { latMin: 26.4, latMax: 26.9, lonMin: -80.4, lonMax: -80.0 }, stateCode: "FL", jurisdiction: { dotName: "West Palm Beach Engineering Services Department", planningOfficeName: "Palm Beach County Planning, Zoning and Building Department", parkingCodeCitation: "West Palm Beach Code of Ordinances, Chapter 94 — Zoning, Article XII — Off-Street Parking." }, dataSourceId: "fdot", active: true },
  daytona_beach_metro: { code: "daytona_beach_metro", displayName: "Deltona-Daytona Beach-Ormond Beach MSA", bounds: { latMin: 29.0, latMax: 29.4, lonMin: -81.3, lonMax: -80.9 }, stateCode: "FL", jurisdiction: { dotName: "Daytona Beach Public Works Department", planningOfficeName: "Volusia County Growth and Resource Management", parkingCodeCitation: "Daytona Beach Land Development Code, Article 8 — Off-Street Parking." }, dataSourceId: "fdot", active: true },
  lakeland_metro: { code: "lakeland_metro", displayName: "Lakeland-Winter Haven MSA", bounds: { latMin: 27.9, latMax: 28.2, lonMin: -82.1, lonMax: -81.7 }, stateCode: "FL", jurisdiction: { dotName: "Lakeland Public Works Department", planningOfficeName: "Polk County Land Development Division", parkingCodeCitation: "Lakeland Land Development Code, Article 7 — Off-Street Parking." }, dataSourceId: "fdot", active: true },
  tallahassee_metro: { code: "tallahassee_metro", displayName: "Tallahassee MSA", bounds: { latMin: 30.2, latMax: 30.7, lonMin: -84.5, lonMax: -84.0 }, stateCode: "FL", jurisdiction: { dotName: "Tallahassee Underground Utilities and Public Infrastructure", planningOfficeName: "Tallahassee-Leon County Planning Department", parkingCodeCitation: "Tallahassee Land Development Code, Chapter 10, Section 10-256 — Parking." }, dataSourceId: "fdot", active: true },
  fort_myers_metro: { code: "fort_myers_metro", displayName: "Cape Coral-Fort Myers MSA", bounds: { latMin: 26.4, latMax: 26.8, lonMin: -82.1, lonMax: -81.7 }, stateCode: "FL", jurisdiction: { dotName: "Fort Myers Public Works Department", planningOfficeName: "Lee County Department of Community Development", parkingCodeCitation: "Fort Myers Land Development Code, Section 86-191 — Off-Street Parking." }, dataSourceId: "fdot", active: true },
  // VA (2) — VDOT
  roanoke_metro: { code: "roanoke_metro", displayName: "Roanoke MSA", bounds: { latMin: 37.1, latMax: 37.4, lonMin: -80.1, lonMax: -79.7 }, stateCode: "VA", jurisdiction: { dotName: "Roanoke Transportation Division", planningOfficeName: "Roanoke Planning, Building, and Development Department", parkingCodeCitation: "Roanoke Zoning Ordinance, Section 36.2-652 — Parking." }, dataSourceId: "vdot", active: true },
  charlottesville_metro: { code: "charlottesville_metro", displayName: "Charlottesville MSA", bounds: { latMin: 37.9, latMax: 38.2, lonMin: -78.6, lonMax: -78.3 }, stateCode: "VA", jurisdiction: { dotName: "Charlottesville Public Works Department", planningOfficeName: "Charlottesville Department of Neighborhood Development Services", parkingCodeCitation: "Charlottesville Zoning Ordinance, Article 8 — Parking and Loading." }, dataSourceId: "vdot", active: true },
  // MO (2) — MoDOT
  springfield_mo_metro: { code: "springfield_mo_metro", displayName: "Springfield (MO) MSA", bounds: { latMin: 37.0, latMax: 37.3, lonMin: -93.4, lonMax: -93.1 }, stateCode: "MO", jurisdiction: { dotName: "Springfield Public Works Department", planningOfficeName: "Springfield-Greene County Planning Department", parkingCodeCitation: "Springfield Land Development Code, Article VI — Off-Street Parking." }, dataSourceId: "modot", active: true },
  columbia_mo_metro: { code: "columbia_mo_metro", displayName: "Columbia (MO) MSA", bounds: { latMin: 38.8, latMax: 39.1, lonMin: -92.5, lonMax: -92.1 }, stateCode: "MO", jurisdiction: { dotName: "Columbia Public Works Department", planningOfficeName: "Columbia Community Development Department", parkingCodeCitation: "Columbia Code of Ordinances, Section 29-32 — Off-Street Parking." }, dataSourceId: "modot", active: true },
  // IA (1) — Iowa DOT
  cedar_rapids_metro: { code: "cedar_rapids_metro", displayName: "Cedar Rapids MSA", bounds: { latMin: 41.9, latMax: 42.1, lonMin: -91.8, lonMax: -91.5 }, stateCode: "IA", jurisdiction: { dotName: "Cedar Rapids Public Works Department", planningOfficeName: "Cedar Rapids Community Development Department", parkingCodeCitation: "Cedar Rapids Municipal Code, Chapter 32 — Zoning, Article 5 — Off-Street Parking." }, dataSourceId: "iadot", active: true },

  // ── Reserved (not yet wired) ────────────────────────────────────────
  greenville_metro: {
    code: "greenville_metro",
    displayName: "Greenville MSA",
    bounds: { latMin: 34.5, latMax: 35.3, lonMin: -82.7, lonMax: -82.0 },
    stateCode: "SC",
    jurisdiction: {
      dotName: "City of Greenville Public Works",
      planningOfficeName: "Greenville Planning Department",
      parkingCodeCitation:
        "City of Greenville Land Management Ordinance, Article 19 — Parking.",
    },
    dataSourceId: "scdot",
    active: false,
  },

  // ── Tier-10 global expansion (OSM-only — signals + roads, no DOT AADT) ────
  // Europe (50)
  berlin_metro: { code: "berlin_metro", displayName: "Berlin", bounds: { latMin: 52.34, latMax: 52.68, lonMin: 13.08, lonMax: 13.76 }, stateCode: "DE", country: "DE", jurisdiction: { dotName: "Senatsverwaltung für Mobilität, Verkehr, Klimaschutz und Umwelt (SenMVKU)", planningOfficeName: "Senatsverwaltung für Stadtentwicklung, Bauen und Wohnen", parkingCodeCitation: "Bauordnung für Berlin (BauO Bln) § 49 — Stellplätze und Fahrradabstellplätze." }, dataSourceId: "osm_only", active: true },
  hamburg_metro: { code: "hamburg_metro", displayName: "Hamburg", bounds: { latMin: 53.39, latMax: 53.74, lonMin: 9.73, lonMax: 10.32 }, stateCode: "DE", country: "DE", jurisdiction: { dotName: "Behörde für Verkehr und Mobilitätswende (BVM)", planningOfficeName: "Behörde für Stadtentwicklung und Wohnen", parkingCodeCitation: "Hamburgische Bauordnung (HBauO) § 48 — Stellplätze." }, dataSourceId: "osm_only", active: true },
  munich_metro: { code: "munich_metro", displayName: "München (Munich)", bounds: { latMin: 48.06, latMax: 48.25, lonMin: 11.36, lonMax: 11.72 }, stateCode: "DE", country: "DE", jurisdiction: { dotName: "Mobilitätsreferat der Landeshauptstadt München", planningOfficeName: "Referat für Stadtplanung und Bauordnung", parkingCodeCitation: "Stellplatzsatzung der Landeshauptstadt München." }, dataSourceId: "osm_only", active: true },
  cologne_metro: { code: "cologne_metro", displayName: "Köln (Cologne)", bounds: { latMin: 50.83, latMax: 51.08, lonMin: 6.77, lonMax: 7.16 }, stateCode: "DE", country: "DE", jurisdiction: { dotName: "Amt für Straßen und Verkehrstechnik der Stadt Köln", planningOfficeName: "Stadtplanungsamt Köln", parkingCodeCitation: "Stellplatzsatzung der Stadt Köln (StellplSa Köln)." }, dataSourceId: "osm_only", active: true },
  frankfurt_metro: { code: "frankfurt_metro", displayName: "Frankfurt am Main", bounds: { latMin: 50.02, latMax: 50.22, lonMin: 8.50, lonMax: 8.80 }, stateCode: "DE", country: "DE", jurisdiction: { dotName: "Straßenverkehrsamt Frankfurt am Main", planningOfficeName: "Stadtplanungsamt Frankfurt", parkingCodeCitation: "Stellplatzsatzung der Stadt Frankfurt am Main." }, dataSourceId: "osm_only", active: true },
  stuttgart_metro: { code: "stuttgart_metro", displayName: "Stuttgart", bounds: { latMin: 48.69, latMax: 48.87, lonMin: 9.04, lonMax: 9.32 }, stateCode: "DE", country: "DE", jurisdiction: { dotName: "Amt für öffentliche Ordnung — Verkehrsplanung Stuttgart", planningOfficeName: "Stadtplanungsamt Stuttgart", parkingCodeCitation: "Landesbauordnung Baden-Württemberg (LBO) § 37 — Stellplätze." }, dataSourceId: "osm_only", active: true },
  dusseldorf_metro: { code: "dusseldorf_metro", displayName: "Düsseldorf", bounds: { latMin: 51.16, latMax: 51.32, lonMin: 6.69, lonMax: 6.92 }, stateCode: "DE", country: "DE", jurisdiction: { dotName: "Amt für Verkehrsmanagement Düsseldorf", planningOfficeName: "Stadtplanungsamt Düsseldorf", parkingCodeCitation: "Stellplatzsatzung der Landeshauptstadt Düsseldorf." }, dataSourceId: "osm_only", active: true },
  leipzig_metro: { code: "leipzig_metro", displayName: "Leipzig", bounds: { latMin: 51.27, latMax: 51.42, lonMin: 12.28, lonMax: 12.50 }, stateCode: "DE", country: "DE", jurisdiction: { dotName: "Verkehrs- und Tiefbauamt Leipzig", planningOfficeName: "Stadtplanungsamt Leipzig", parkingCodeCitation: "Sächsische Bauordnung (SächsBO) § 49 — Stellplätze." }, dataSourceId: "osm_only", active: true },
  dortmund_metro: { code: "dortmund_metro", displayName: "Dortmund", bounds: { latMin: 51.44, latMax: 51.60, lonMin: 7.32, lonMax: 7.62 }, stateCode: "DE", country: "DE", jurisdiction: { dotName: "Tiefbauamt Stadt Dortmund", planningOfficeName: "Stadtplanungs- und Bauordnungsamt Dortmund", parkingCodeCitation: "Landesbauordnung NRW (BauO NRW) § 48 — Stellplätze." }, dataSourceId: "osm_only", active: true },
  bremen_metro: { code: "bremen_metro", displayName: "Bremen", bounds: { latMin: 53.00, latMax: 53.21, lonMin: 8.66, lonMax: 8.98 }, stateCode: "DE", country: "DE", jurisdiction: { dotName: "Senator für Klimaschutz, Umwelt, Mobilität, Stadtentwicklung und Wohnungsbau", planningOfficeName: "Stadtplanungsamt Bremen", parkingCodeCitation: "Bremische Landesbauordnung (BremLBO) § 49 — Stellplätze." }, dataSourceId: "osm_only", active: true },
  hannover_metro: { code: "hannover_metro", displayName: "Hannover", bounds: { latMin: 52.30, latMax: 52.45, lonMin: 9.65, lonMax: 9.85 }, stateCode: "DE", country: "DE", jurisdiction: { dotName: "Fachbereich Tiefbau — Landeshauptstadt Hannover", planningOfficeName: "Stadtplanungsamt Hannover", parkingCodeCitation: "Niedersächsische Bauordnung (NBauO) § 47 — Einstellplätze." }, dataSourceId: "osm_only", active: true },
  paris_metro: { code: "paris_metro", displayName: "Paris (Île-de-France)", bounds: { latMin: 48.78, latMax: 48.95, lonMin: 2.20, lonMax: 2.50 }, stateCode: "FR", country: "FR", jurisdiction: { dotName: "Direction de la Voirie et des Déplacements — Ville de Paris", planningOfficeName: "Direction de l'Urbanisme — Ville de Paris", parkingCodeCitation: "Plan Local d'Urbanisme (PLU) de Paris — Stationnement." }, dataSourceId: "osm_only", active: true },
  marseille_metro: { code: "marseille_metro", displayName: "Marseille", bounds: { latMin: 43.20, latMax: 43.40, lonMin: 5.30, lonMax: 5.55 }, stateCode: "FR", country: "FR", jurisdiction: { dotName: "Direction des Mobilités — Ville de Marseille", planningOfficeName: "Direction de l'Urbanisme — Métropole Aix-Marseille-Provence", parkingCodeCitation: "Plan Local d'Urbanisme intercommunal (PLUi) — Stationnement." }, dataSourceId: "osm_only", active: true },
  lyon_metro: { code: "lyon_metro", displayName: "Lyon", bounds: { latMin: 45.66, latMax: 45.83, lonMin: 4.74, lonMax: 4.95 }, stateCode: "FR", country: "FR", jurisdiction: { dotName: "Direction de la Voirie — Métropole de Lyon", planningOfficeName: "Direction de l'Aménagement Urbain — Métropole de Lyon", parkingCodeCitation: "Plan Local d'Urbanisme et de l'Habitat (PLU-H) — Métropole de Lyon." }, dataSourceId: "osm_only", active: true },
  toulouse_metro: { code: "toulouse_metro", displayName: "Toulouse", bounds: { latMin: 43.51, latMax: 43.69, lonMin: 1.34, lonMax: 1.55 }, stateCode: "FR", country: "FR", jurisdiction: { dotName: "Direction de la Mobilité Gestion Réseaux — Toulouse Métropole", planningOfficeName: "Direction de l'Urbanisme — Toulouse Métropole", parkingCodeCitation: "Plan Local d'Urbanisme intercommunal-Habitat (PLUi-H) Toulouse Métropole." }, dataSourceId: "osm_only", active: true },
  nice_metro: { code: "nice_metro", displayName: "Nice", bounds: { latMin: 43.65, latMax: 43.78, lonMin: 7.18, lonMax: 7.34 }, stateCode: "FR", country: "FR", jurisdiction: { dotName: "Direction Mobilité Déplacements — Métropole Nice Côte d'Azur", planningOfficeName: "Direction Aménagement Urbanisme — Métropole Nice Côte d'Azur", parkingCodeCitation: "Plan Local d'Urbanisme métropolitain (PLUm) — Stationnement." }, dataSourceId: "osm_only", active: true },
  nantes_metro: { code: "nantes_metro", displayName: "Nantes", bounds: { latMin: 47.16, latMax: 47.31, lonMin: -1.65, lonMax: -1.45 }, stateCode: "FR", country: "FR", jurisdiction: { dotName: "Direction Mobilités — Nantes Métropole", planningOfficeName: "Direction Générale au Développement Urbain — Nantes Métropole", parkingCodeCitation: "Plan Local d'Urbanisme métropolitain (PLUm) — Stationnement." }, dataSourceId: "osm_only", active: true },
  bordeaux_metro: { code: "bordeaux_metro", displayName: "Bordeaux", bounds: { latMin: 44.78, latMax: 44.93, lonMin: -0.66, lonMax: -0.51 }, stateCode: "FR", country: "FR", jurisdiction: { dotName: "Direction Mobilité — Bordeaux Métropole", planningOfficeName: "Direction Générale de l'Aménagement — Bordeaux Métropole", parkingCodeCitation: "Plan Local d'Urbanisme intercommunal (PLU 3.1) — Bordeaux Métropole." }, dataSourceId: "osm_only", active: true },
  strasbourg_metro: { code: "strasbourg_metro", displayName: "Strasbourg", bounds: { latMin: 48.50, latMax: 48.65, lonMin: 7.66, lonMax: 7.83 }, stateCode: "FR", country: "FR", jurisdiction: { dotName: "Direction de la Mobilité, Espaces publics et naturels — Eurométropole de Strasbourg", planningOfficeName: "Direction de l'Urbanisme et des Territoires — Eurométropole de Strasbourg", parkingCodeCitation: "Plan Local d'Urbanisme intercommunal (PLUi) — Eurométropole de Strasbourg." }, dataSourceId: "osm_only", active: true },
  rome_metro: { code: "rome_metro", displayName: "Roma (Rome)", bounds: { latMin: 41.78, latMax: 42.00, lonMin: 12.36, lonMax: 12.62 }, stateCode: "IT", country: "IT", jurisdiction: { dotName: "Dipartimento Mobilità e Trasporti — Roma Capitale", planningOfficeName: "Dipartimento Programmazione e Attuazione Urbanistica — Roma Capitale", parkingCodeCitation: "Regolamento Edilizio del Comune di Roma — Standards parcheggio." }, dataSourceId: "osm_only", active: true },
  milan_metro: { code: "milan_metro", displayName: "Milano (Milan)", bounds: { latMin: 45.39, latMax: 45.55, lonMin: 9.07, lonMax: 9.30 }, stateCode: "IT", country: "IT", jurisdiction: { dotName: "Area Pianificazione e Programmazione Mobilità — Comune di Milano", planningOfficeName: "Direzione Urbanistica — Comune di Milano", parkingCodeCitation: "Piano di Governo del Territorio (PGT) — Norme tecniche di attuazione." }, dataSourceId: "osm_only", active: true },
  naples_metro: { code: "naples_metro", displayName: "Napoli (Naples)", bounds: { latMin: 40.78, latMax: 40.92, lonMin: 14.14, lonMax: 14.32 }, stateCode: "IT", country: "IT", jurisdiction: { dotName: "Servizio Mobilità Sostenibile — Comune di Napoli", planningOfficeName: "Dipartimento Pianificazione Urbanistica — Comune di Napoli", parkingCodeCitation: "Regolamento Urbanistico Edilizio Comunale (RUEC) di Napoli." }, dataSourceId: "osm_only", active: true },
  turin_metro: { code: "turin_metro", displayName: "Torino (Turin)", bounds: { latMin: 45.00, latMax: 45.13, lonMin: 7.59, lonMax: 7.74 }, stateCode: "IT", country: "IT", jurisdiction: { dotName: "Divisione Mobilità e Trasporti — Città di Torino", planningOfficeName: "Divisione Urbanistica — Città di Torino", parkingCodeCitation: "Piano Regolatore Generale (PRG) di Torino — Standard parcheggi." }, dataSourceId: "osm_only", active: true },
  palermo_metro: { code: "palermo_metro", displayName: "Palermo", bounds: { latMin: 38.07, latMax: 38.21, lonMin: 13.27, lonMax: 13.46 }, stateCode: "IT", country: "IT", jurisdiction: { dotName: "Settore Mobilità Urbana — Comune di Palermo", planningOfficeName: "Settore Pianificazione Urbanistica — Comune di Palermo", parkingCodeCitation: "Piano Regolatore Generale di Palermo — Standard parcheggi." }, dataSourceId: "osm_only", active: true },
  bologna_metro: { code: "bologna_metro", displayName: "Bologna", bounds: { latMin: 44.42, latMax: 44.55, lonMin: 11.27, lonMax: 11.42 }, stateCode: "IT", country: "IT", jurisdiction: { dotName: "Settore Mobilità Sostenibile — Comune di Bologna", planningOfficeName: "Settore Piani e Progetti Urbanistici — Comune di Bologna", parkingCodeCitation: "Piano Urbanistico Generale (PUG) di Bologna — Disciplina parcheggi." }, dataSourceId: "osm_only", active: true },
  florence_metro: { code: "florence_metro", displayName: "Firenze (Florence)", bounds: { latMin: 43.74, latMax: 43.84, lonMin: 11.17, lonMax: 11.32 }, stateCode: "IT", country: "IT", jurisdiction: { dotName: "Direzione Nuove Infrastrutture e Mobilità — Comune di Firenze", planningOfficeName: "Direzione Urbanistica — Comune di Firenze", parkingCodeCitation: "Piano Strutturale e Regolamento Urbanistico di Firenze — Standard parcheggi." }, dataSourceId: "osm_only", active: true },
  genoa_metro: { code: "genoa_metro", displayName: "Genova (Genoa)", bounds: { latMin: 44.36, latMax: 44.48, lonMin: 8.83, lonMax: 9.04 }, stateCode: "IT", country: "IT", jurisdiction: { dotName: "Direzione Mobilità — Comune di Genova", planningOfficeName: "Direzione Urbanistica — Comune di Genova", parkingCodeCitation: "Piano Urbanistico Comunale (PUC) di Genova — Standard parcheggi." }, dataSourceId: "osm_only", active: true },
  madrid_metro: { code: "madrid_metro", displayName: "Madrid", bounds: { latMin: 40.32, latMax: 40.55, lonMin: -3.85, lonMax: -3.55 }, stateCode: "ES", country: "ES", jurisdiction: { dotName: "Área de Gobierno de Obras y Equipamientos — Ayuntamiento de Madrid", planningOfficeName: "Área de Gobierno de Urbanismo, Medio Ambiente y Movilidad — Ayuntamiento de Madrid", parkingCodeCitation: "Plan General de Ordenación Urbana (PGOU) de Madrid — Normas zonales." }, dataSourceId: "osm_only", active: true },
  barcelona_metro: { code: "barcelona_metro", displayName: "Barcelona", bounds: { latMin: 41.32, latMax: 41.46, lonMin: 2.06, lonMax: 2.25 }, stateCode: "ES", country: "ES", jurisdiction: { dotName: "Gerència de Mobilitat i Infraestructures — Ajuntament de Barcelona", planningOfficeName: "Gerència d'Urbanisme — Ajuntament de Barcelona", parkingCodeCitation: "Pla General Metropolità (PGM) — Normes urbanístiques d'aparcament." }, dataSourceId: "osm_only", active: true },
  valencia_metro: { code: "valencia_metro", displayName: "València (Valencia)", bounds: { latMin: 39.40, latMax: 39.55, lonMin: -0.47, lonMax: -0.30 }, stateCode: "ES", country: "ES", jurisdiction: { dotName: "Regidoria de Mobilitat Sostenible — Ajuntament de València", planningOfficeName: "Àrea d'Urbanisme — Ajuntament de València", parkingCodeCitation: "Pla General d'Ordenació Urbana de València — Normes d'aparcament." }, dataSourceId: "osm_only", active: true },
  seville_metro: { code: "seville_metro", displayName: "Sevilla (Seville)", bounds: { latMin: 37.32, latMax: 37.47, lonMin: -6.06, lonMax: -5.86 }, stateCode: "ES", country: "ES", jurisdiction: { dotName: "Área de Movilidad — Ayuntamiento de Sevilla", planningOfficeName: "Gerencia de Urbanismo y Medio Ambiente — Ayuntamiento de Sevilla", parkingCodeCitation: "Plan General de Ordenación Urbanística (PGOU) de Sevilla — Aparcamientos." }, dataSourceId: "osm_only", active: true },
  zaragoza_metro: { code: "zaragoza_metro", displayName: "Zaragoza", bounds: { latMin: 41.59, latMax: 41.72, lonMin: -0.97, lonMax: -0.79 }, stateCode: "ES", country: "ES", jurisdiction: { dotName: "Servicio de Movilidad Urbana — Ayuntamiento de Zaragoza", planningOfficeName: "Servicio de Ordenación y Gestión Urbanística — Ayuntamiento de Zaragoza", parkingCodeCitation: "Plan General de Ordenación Urbana (PGOU) de Zaragoza." }, dataSourceId: "osm_only", active: true },
  malaga_metro: { code: "malaga_metro", displayName: "Málaga", bounds: { latMin: 36.65, latMax: 36.78, lonMin: -4.55, lonMax: -4.35 }, stateCode: "ES", country: "ES", jurisdiction: { dotName: "Área de Movilidad — Ayuntamiento de Málaga", planningOfficeName: "Gerencia Municipal de Urbanismo, Obras e Infraestructuras — Málaga", parkingCodeCitation: "Plan General de Ordenación Urbanística (PGOU) de Málaga." }, dataSourceId: "osm_only", active: true },
  amsterdam_metro: { code: "amsterdam_metro", displayName: "Amsterdam", bounds: { latMin: 52.30, latMax: 52.43, lonMin: 4.78, lonMax: 4.99 }, stateCode: "NL", country: "NL", jurisdiction: { dotName: "Dienst Verkeer en Openbare Ruimte — Gemeente Amsterdam", planningOfficeName: "Dienst Ruimte en Duurzaamheid — Gemeente Amsterdam", parkingCodeCitation: "Nota Parkeernormen Auto — Gemeente Amsterdam." }, dataSourceId: "osm_only", active: true },
  rotterdam_metro: { code: "rotterdam_metro", displayName: "Rotterdam", bounds: { latMin: 51.86, latMax: 51.98, lonMin: 4.36, lonMax: 4.59 }, stateCode: "NL", country: "NL", jurisdiction: { dotName: "Cluster Stadsontwikkeling — Verkeer en Vervoer — Gemeente Rotterdam", planningOfficeName: "Cluster Stadsontwikkeling — Gemeente Rotterdam", parkingCodeCitation: "Beleidsregeling Parkeernormen Auto en Fiets — Gemeente Rotterdam." }, dataSourceId: "osm_only", active: true },
  the_hague_metro: { code: "the_hague_metro", displayName: "Den Haag (The Hague)", bounds: { latMin: 52.03, latMax: 52.13, lonMin: 4.21, lonMax: 4.40 }, stateCode: "NL", country: "NL", jurisdiction: { dotName: "Dienst Stedelijke Ontwikkeling — Mobiliteit — Gemeente Den Haag", planningOfficeName: "Dienst Stedelijke Ontwikkeling — Gemeente Den Haag", parkingCodeCitation: "Nota Parkeernormen Den Haag." }, dataSourceId: "osm_only", active: true },
  brussels_metro: { code: "brussels_metro", displayName: "Bruxelles (Brussels)", bounds: { latMin: 50.78, latMax: 50.93, lonMin: 4.27, lonMax: 4.48 }, stateCode: "BE", country: "BE", jurisdiction: { dotName: "Bruxelles Mobilité — Service public régional de Bruxelles", planningOfficeName: "Bruxelles Urbanisme et Patrimoine (urban.brussels)", parkingCodeCitation: "Règlement Régional d'Urbanisme (RRU) — Titre VIII Normes de stationnement." }, dataSourceId: "osm_only", active: true },
  antwerp_metro: { code: "antwerp_metro", displayName: "Antwerpen (Antwerp)", bounds: { latMin: 51.16, latMax: 51.30, lonMin: 4.32, lonMax: 4.50 }, stateCode: "BE", country: "BE", jurisdiction: { dotName: "Stadsontwikkeling — Mobiliteit — Stad Antwerpen", planningOfficeName: "Stadsontwikkeling — Ruimte — Stad Antwerpen", parkingCodeCitation: "Bouwcode Stad Antwerpen — Parkeernormen." }, dataSourceId: "osm_only", active: true },
  zurich_metro: { code: "zurich_metro", displayName: "Zürich (Zurich)", bounds: { latMin: 47.32, latMax: 47.45, lonMin: 8.45, lonMax: 8.62 }, stateCode: "CH", country: "CH", jurisdiction: { dotName: "Dienstabteilung Verkehr — Stadt Zürich", planningOfficeName: "Amt für Städtebau — Stadt Zürich", parkingCodeCitation: "Bau- und Zonenordnung Stadt Zürich (BZO) — Pflichtparkplätze." }, dataSourceId: "osm_only", active: true },
  geneva_metro: { code: "geneva_metro", displayName: "Genève (Geneva)", bounds: { latMin: 46.16, latMax: 46.27, lonMin: 6.07, lonMax: 6.22 }, stateCode: "CH", country: "CH", jurisdiction: { dotName: "Office cantonal des transports — République et canton de Genève", planningOfficeName: "Office de l'urbanisme — République et canton de Genève", parkingCodeCitation: "Règlement relatif aux places de stationnement (RPSFP) — canton de Genève." }, dataSourceId: "osm_only", active: true },
  vienna_metro: { code: "vienna_metro", displayName: "Wien (Vienna)", bounds: { latMin: 48.13, latMax: 48.32, lonMin: 16.18, lonMax: 16.50 }, stateCode: "AT", country: "AT", jurisdiction: { dotName: "Magistratsabteilung 46 (Verkehrsorganisation und technische Verkehrsangelegenheiten) — Stadt Wien", planningOfficeName: "Magistratsabteilung 21 (Stadtteilplanung und Flächennutzung) — Stadt Wien", parkingCodeCitation: "Wiener Garagengesetz 2008 (WGarG 2008) — Stellplatzverpflichtung." }, dataSourceId: "osm_only", active: true },
  lisbon_metro: { code: "lisbon_metro", displayName: "Lisboa (Lisbon)", bounds: { latMin: 38.66, latMax: 38.83, lonMin: -9.27, lonMax: -9.08 }, stateCode: "PT", country: "PT", jurisdiction: { dotName: "Direção Municipal de Mobilidade — Câmara Municipal de Lisboa", planningOfficeName: "Direção Municipal de Urbanismo — Câmara Municipal de Lisboa", parkingCodeCitation: "Plano Diretor Municipal (PDM) de Lisboa — Regulamento de estacionamento." }, dataSourceId: "osm_only", active: true },
  porto_metro: { code: "porto_metro", displayName: "Porto", bounds: { latMin: 41.07, latMax: 41.21, lonMin: -8.72, lonMax: -8.55 }, stateCode: "PT", country: "PT", jurisdiction: { dotName: "Departamento Municipal de Mobilidade e Transportes — Câmara Municipal do Porto", planningOfficeName: "Departamento Municipal de Planeamento Urbano — Câmara Municipal do Porto", parkingCodeCitation: "Plano Diretor Municipal do Porto — Áreas de estacionamento." }, dataSourceId: "osm_only", active: true },
  dublin_metro: { code: "dublin_metro", displayName: "Dublin", bounds: { latMin: 53.27, latMax: 53.42, lonMin: -6.40, lonMax: -6.10 }, stateCode: "IE", country: "IE", jurisdiction: { dotName: "Active Travel and Transportation — Dublin City Council", planningOfficeName: "Planning and Property Development Department — Dublin City Council", parkingCodeCitation: "Dublin City Development Plan 2022–2028 — Chapter 15 Standards: Car Parking." }, dataSourceId: "osm_only", active: true },
  warsaw_metro: { code: "warsaw_metro", displayName: "Warszawa (Warsaw)", bounds: { latMin: 52.13, latMax: 52.35, lonMin: 20.85, lonMax: 21.18 }, stateCode: "PL", country: "PL", jurisdiction: { dotName: "Zarząd Dróg Miejskich w Warszawie (ZDM)", planningOfficeName: "Biuro Architektury i Planowania Przestrzennego — m.st. Warszawa", parkingCodeCitation: "Studium uwarunkowań i kierunków zagospodarowania przestrzennego m.st. Warszawy — wskaźniki miejsc postojowych." }, dataSourceId: "osm_only", active: true },
  krakow_metro: { code: "krakow_metro", displayName: "Kraków", bounds: { latMin: 50.00, latMax: 50.13, lonMin: 19.83, lonMax: 20.05 }, stateCode: "PL", country: "PL", jurisdiction: { dotName: "Zarząd Dróg Miasta Krakowa (ZDMK)", planningOfficeName: "Biuro Planowania Przestrzennego Urzędu Miasta Krakowa", parkingCodeCitation: "Studium uwarunkowań i kierunków zagospodarowania przestrzennego Krakowa — standardy miejsc postojowych." }, dataSourceId: "osm_only", active: true },
  lodz_metro: { code: "lodz_metro", displayName: "Łódź", bounds: { latMin: 51.70, latMax: 51.83, lonMin: 19.35, lonMax: 19.55 }, stateCode: "PL", country: "PL", jurisdiction: { dotName: "Zarząd Dróg i Transportu w Łodzi (ZDiT)", planningOfficeName: "Miejska Pracownia Urbanistyczna w Łodzi", parkingCodeCitation: "Studium uwarunkowań i kierunków zagospodarowania przestrzennego miasta Łodzi — wskaźniki parkingowe." }, dataSourceId: "osm_only", active: true },
  prague_metro: { code: "prague_metro", displayName: "Praha (Prague)", bounds: { latMin: 49.97, latMax: 50.16, lonMin: 14.30, lonMax: 14.62 }, stateCode: "CZ", country: "CZ", jurisdiction: { dotName: "Technická správa komunikací hl. m. Prahy (TSK)", planningOfficeName: "Institut plánování a rozvoje hl. m. Prahy (IPR)", parkingCodeCitation: "Pražské stavební předpisy (PSP) — § 32 Stání pro vozidla." }, dataSourceId: "osm_only", active: true },
  budapest_metro: { code: "budapest_metro", displayName: "Budapest", bounds: { latMin: 47.40, latMax: 47.58, lonMin: 18.95, lonMax: 19.22 }, stateCode: "HU", country: "HU", jurisdiction: { dotName: "Budapest Közút Zrt. — Budapesti Közlekedési Központ (BKK)", planningOfficeName: "Főpolgármesteri Hivatal Várostervezési Főosztály — Budapest", parkingCodeCitation: "Budapesti Településszerkezeti Terv és Fővárosi Rendezési Szabályzat — parkolási normák." }, dataSourceId: "osm_only", active: true },
  bucharest_metro: { code: "bucharest_metro", displayName: "București (Bucharest)", bounds: { latMin: 44.36, latMax: 44.55, lonMin: 25.97, lonMax: 26.20 }, stateCode: "RO", country: "RO", jurisdiction: { dotName: "Administrația Străzilor București (ASB)", planningOfficeName: "Direcția Urbanism — Primăria Municipiului București", parkingCodeCitation: "Planul Urbanistic General (PUG) al Municipiului București — Norme parcaje." }, dataSourceId: "osm_only", active: true },
  stockholm_metro: { code: "stockholm_metro", displayName: "Stockholm", bounds: { latMin: 59.25, latMax: 59.40, lonMin: 17.85, lonMax: 18.18 }, stateCode: "SE", country: "SE", jurisdiction: { dotName: "Trafikkontoret — Stockholms stad", planningOfficeName: "Stadsbyggnadskontoret — Stockholms stad", parkingCodeCitation: "Stockholms stads parkeringstal — riktlinjer för bostads- och arbetsplatsparkering." }, dataSourceId: "osm_only", active: true },
  oslo_metro: { code: "oslo_metro", displayName: "Oslo", bounds: { latMin: 59.83, latMax: 60.00, lonMin: 10.65, lonMax: 10.85 }, stateCode: "NO", country: "NO", jurisdiction: { dotName: "Bymiljøetaten — Oslo kommune", planningOfficeName: "Plan- og bygningsetaten — Oslo kommune", parkingCodeCitation: "Kommuneplanens arealdel — Parkeringsnormer for Oslo." }, dataSourceId: "osm_only", active: true },
  copenhagen_metro: { code: "copenhagen_metro", displayName: "København (Copenhagen)", bounds: { latMin: 55.60, latMax: 55.75, lonMin: 12.45, lonMax: 12.66 }, stateCode: "DK", country: "DK", jurisdiction: { dotName: "Teknik- og Miljøforvaltningen — Mobilitet — Københavns Kommune", planningOfficeName: "Teknik- og Miljøforvaltningen — Byplan — Københavns Kommune", parkingCodeCitation: "Kommuneplan København — parkeringsnormer." }, dataSourceId: "osm_only", active: true },
  helsinki_metro: { code: "helsinki_metro", displayName: "Helsinki", bounds: { latMin: 60.13, latMax: 60.27, lonMin: 24.83, lonMax: 25.15 }, stateCode: "FI", country: "FI", jurisdiction: { dotName: "Kaupunkiympäristön toimiala — Liikenne- ja katusuunnittelu — Helsingin kaupunki", planningOfficeName: "Kaupunkiympäristön toimiala — Asemakaavoitus — Helsingin kaupunki", parkingCodeCitation: "Helsingin kaupungin pysäköintipaikkamääräykset." }, dataSourceId: "osm_only", active: true },
  athens_metro: { code: "athens_metro", displayName: "Αθήνα (Athens)", bounds: { latMin: 37.92, latMax: 38.05, lonMin: 23.66, lonMax: 23.83 }, stateCode: "GR", country: "GR", jurisdiction: { dotName: "Διεύθυνση Μεταφορών — Δήμος Αθηναίων", planningOfficeName: "Διεύθυνση Σχεδίου Πόλεως — Δήμος Αθηναίων", parkingCodeCitation: "Νέος Οικοδομικός Κανονισμός (Ν.4067/2012) — Θέσεις στάθμευσης." }, dataSourceId: "osm_only", active: true },

  // Asia (35)
  tokyo_metro: { code: "tokyo_metro", displayName: "Tokyo (東京)", bounds: { latMin: 35.55, latMax: 35.83, lonMin: 139.55, lonMax: 139.90 }, stateCode: "JP", country: "JP", jurisdiction: { dotName: "Tokyo Metropolitan Bureau of Construction (東京都建設局)", planningOfficeName: "Tokyo Metropolitan Bureau of Urban Development (東京都都市整備局)", parkingCodeCitation: "Parking Place Act (駐車場法) and Tokyo Metropolitan Parking Ordinance." }, dataSourceId: "osm_only", active: true },
  osaka_metro: { code: "osaka_metro", displayName: "Osaka (大阪)", bounds: { latMin: 34.55, latMax: 34.78, lonMin: 135.35, lonMax: 135.62 }, stateCode: "JP", country: "JP", jurisdiction: { dotName: "Osaka City Construction Bureau (大阪市建設局)", planningOfficeName: "Osaka City Planning Bureau (大阪市都市計画局)", parkingCodeCitation: "Osaka City Parking Ordinance and Parking Place Act." }, dataSourceId: "osm_only", active: true },
  yokohama_metro: { code: "yokohama_metro", displayName: "Yokohama (横浜)", bounds: { latMin: 35.32, latMax: 35.55, lonMin: 139.50, lonMax: 139.72 }, stateCode: "JP", country: "JP", jurisdiction: { dotName: "Yokohama City Road and Highway Bureau (横浜市道路局)", planningOfficeName: "Yokohama City Housing and Architecture Bureau (横浜市建築局)", parkingCodeCitation: "Yokohama City Parking Ordinance." }, dataSourceId: "osm_only", active: true },
  nagoya_metro: { code: "nagoya_metro", displayName: "Nagoya (名古屋)", bounds: { latMin: 35.06, latMax: 35.24, lonMin: 136.83, lonMax: 137.05 }, stateCode: "JP", country: "JP", jurisdiction: { dotName: "Nagoya City Bureau of Public Works (名古屋市緑政土木局)", planningOfficeName: "Nagoya City Housing and Urban Development Bureau (名古屋市住宅都市局)", parkingCodeCitation: "Nagoya City Parking Ordinance." }, dataSourceId: "osm_only", active: true },
  sapporo_metro: { code: "sapporo_metro", displayName: "Sapporo (札幌)", bounds: { latMin: 43.00, latMax: 43.20, lonMin: 141.20, lonMax: 141.50 }, stateCode: "JP", country: "JP", jurisdiction: { dotName: "Sapporo City Construction Bureau (札幌市建設局)", planningOfficeName: "Sapporo City Urban Planning Bureau (札幌市都市計画局)", parkingCodeCitation: "Sapporo City Parking Place Ordinance." }, dataSourceId: "osm_only", active: true },
  fukuoka_metro: { code: "fukuoka_metro", displayName: "Fukuoka (福岡)", bounds: { latMin: 33.50, latMax: 33.70, lonMin: 130.30, lonMax: 130.55 }, stateCode: "JP", country: "JP", jurisdiction: { dotName: "Fukuoka City Road and Underground Improvement Bureau (福岡市道路下水道局)", planningOfficeName: "Fukuoka City Housing and Urban Development Bureau (福岡市住宅都市局)", parkingCodeCitation: "Fukuoka City Parking Ordinance." }, dataSourceId: "osm_only", active: true },
  seoul_metro: { code: "seoul_metro", displayName: "Seoul (서울)", bounds: { latMin: 37.40, latMax: 37.70, lonMin: 126.78, lonMax: 127.18 }, stateCode: "KR", country: "KR", jurisdiction: { dotName: "Seoul Metropolitan Government — Traffic Headquarters (서울특별시 도시교통실)", planningOfficeName: "Seoul Metropolitan Government — Urban Planning Bureau (서울특별시 도시계획국)", parkingCodeCitation: "Parking Lot Act (주차장법) and Seoul Metropolitan Parking Ordinance." }, dataSourceId: "osm_only", active: true },
  busan_metro: { code: "busan_metro", displayName: "Busan (부산)", bounds: { latMin: 35.05, latMax: 35.27, lonMin: 128.96, lonMax: 129.22 }, stateCode: "KR", country: "KR", jurisdiction: { dotName: "Busan Metropolitan City — Traffic Bureau (부산광역시 교통국)", planningOfficeName: "Busan Metropolitan City — Urban Planning Bureau (부산광역시 도시계획국)", parkingCodeCitation: "Busan Metropolitan Parking Ordinance." }, dataSourceId: "osm_only", active: true },
  incheon_metro: { code: "incheon_metro", displayName: "Incheon (인천)", bounds: { latMin: 37.32, latMax: 37.55, lonMin: 126.55, lonMax: 126.78 }, stateCode: "KR", country: "KR", jurisdiction: { dotName: "Incheon Metropolitan City — Traffic Bureau (인천광역시 교통국)", planningOfficeName: "Incheon Metropolitan City — Urban Planning Bureau (인천광역시 도시계획국)", parkingCodeCitation: "Incheon Metropolitan Parking Ordinance." }, dataSourceId: "osm_only", active: true },
  mumbai_metro: { code: "mumbai_metro", displayName: "Mumbai", bounds: { latMin: 18.85, latMax: 19.30, lonMin: 72.75, lonMax: 73.00 }, stateCode: "IND", country: "IN", jurisdiction: { dotName: "Brihanmumbai Municipal Corporation (BMC) — Traffic Engineering Department", planningOfficeName: "Mumbai Metropolitan Region Development Authority (MMRDA)", parkingCodeCitation: "Development Control and Promotion Regulations (DCPR) 2034 — Regulation 44 Parking Spaces." }, dataSourceId: "osm_only", active: true },
  delhi_metro: { code: "delhi_metro", displayName: "Delhi (NCT)", bounds: { latMin: 28.40, latMax: 28.83, lonMin: 76.85, lonMax: 77.40 }, stateCode: "IND", country: "IN", jurisdiction: { dotName: "Public Works Department — Government of NCT of Delhi", planningOfficeName: "Delhi Development Authority (DDA) — Planning Wing", parkingCodeCitation: "Master Plan for Delhi 2041 — Parking Standards." }, dataSourceId: "osm_only", active: true },
  bangalore_metro: { code: "bangalore_metro", displayName: "Bengaluru (Bangalore)", bounds: { latMin: 12.85, latMax: 13.13, lonMin: 77.45, lonMax: 77.78 }, stateCode: "IND", country: "IN", jurisdiction: { dotName: "Bruhat Bengaluru Mahanagara Palike (BBMP) — Traffic Engineering Cell", planningOfficeName: "Bangalore Development Authority (BDA)", parkingCodeCitation: "Revised Master Plan 2031 (Bengaluru) — Parking Regulations." }, dataSourceId: "osm_only", active: true },
  hyderabad_metro: { code: "hyderabad_metro", displayName: "Hyderabad", bounds: { latMin: 17.28, latMax: 17.55, lonMin: 78.30, lonMax: 78.62 }, stateCode: "IND", country: "IN", jurisdiction: { dotName: "Greater Hyderabad Municipal Corporation (GHMC) — Town Planning Wing", planningOfficeName: "Hyderabad Metropolitan Development Authority (HMDA)", parkingCodeCitation: "GHMC Building Rules — Parking Provisions." }, dataSourceId: "osm_only", active: true },
  chennai_metro: { code: "chennai_metro", displayName: "Chennai", bounds: { latMin: 12.85, latMax: 13.20, lonMin: 80.13, lonMax: 80.32 }, stateCode: "IND", country: "IN", jurisdiction: { dotName: "Greater Chennai Corporation — Traffic Engineering Department", planningOfficeName: "Chennai Metropolitan Development Authority (CMDA)", parkingCodeCitation: "Second Master Plan for Chennai Metropolitan Area — Parking Norms." }, dataSourceId: "osm_only", active: true },
  kolkata_metro: { code: "kolkata_metro", displayName: "Kolkata", bounds: { latMin: 22.45, latMax: 22.70, lonMin: 88.27, lonMax: 88.45 }, stateCode: "IND", country: "IN", jurisdiction: { dotName: "Kolkata Municipal Corporation (KMC) — Traffic Department", planningOfficeName: "Kolkata Metropolitan Development Authority (KMDA)", parkingCodeCitation: "KMC Building Rules 2009 — Parking Schedule." }, dataSourceId: "osm_only", active: true },
  pune_metro: { code: "pune_metro", displayName: "Pune", bounds: { latMin: 18.40, latMax: 18.62, lonMin: 73.72, lonMax: 74.00 }, stateCode: "IND", country: "IN", jurisdiction: { dotName: "Pune Municipal Corporation (PMC) — Road Department", planningOfficeName: "Pune Metropolitan Region Development Authority (PMRDA)", parkingCodeCitation: "PMC Development Plan — Parking Regulations." }, dataSourceId: "osm_only", active: true },
  ahmedabad_metro: { code: "ahmedabad_metro", displayName: "Ahmedabad", bounds: { latMin: 22.95, latMax: 23.13, lonMin: 72.45, lonMax: 72.70 }, stateCode: "IND", country: "IN", jurisdiction: { dotName: "Ahmedabad Municipal Corporation (AMC) — Roads & Buildings Department", planningOfficeName: "Ahmedabad Urban Development Authority (AUDA)", parkingCodeCitation: "Comprehensive General Development Control Regulations (CGDCR) — Parking." }, dataSourceId: "osm_only", active: true },
  hong_kong_metro: { code: "hong_kong_metro", displayName: "Hong Kong", bounds: { latMin: 22.18, latMax: 22.40, lonMin: 113.95, lonMax: 114.32 }, stateCode: "HK", country: "HK", jurisdiction: { dotName: "Transport Department — HKSAR Government", planningOfficeName: "Planning Department — HKSAR Government", parkingCodeCitation: "Hong Kong Planning Standards and Guidelines (HKPSG) — Chapter 8 Internal Transport Facilities." }, dataSourceId: "osm_only", active: true },
  singapore_metro: { code: "singapore_metro", displayName: "Singapore", bounds: { latMin: 1.22, latMax: 1.48, lonMin: 103.60, lonMax: 104.05 }, stateCode: "SG", country: "SG", jurisdiction: { dotName: "Land Transport Authority (LTA) — Singapore", planningOfficeName: "Urban Redevelopment Authority (URA) — Singapore", parkingCodeCitation: "Code of Practice on Vehicle Parking Provision in Development Proposals (LTA)." }, dataSourceId: "osm_only", active: true },
  taipei_metro: { code: "taipei_metro", displayName: "Taipei (台北)", bounds: { latMin: 24.95, latMax: 25.18, lonMin: 121.42, lonMax: 121.65 }, stateCode: "TW", country: "TW", jurisdiction: { dotName: "Taipei City Department of Transportation (臺北市政府交通局)", planningOfficeName: "Taipei City Department of Urban Development (臺北市政府都市發展局)", parkingCodeCitation: "Taipei City Parking Lot Self-Government Ordinance (臺北市停車場管理自治條例)." }, dataSourceId: "osm_only", active: true },
  kaohsiung_metro: { code: "kaohsiung_metro", displayName: "Kaohsiung (高雄)", bounds: { latMin: 22.55, latMax: 22.78, lonMin: 120.20, lonMax: 120.42 }, stateCode: "TW", country: "TW", jurisdiction: { dotName: "Kaohsiung City Transportation Bureau (高雄市政府交通局)", planningOfficeName: "Kaohsiung City Urban Development Bureau (高雄市政府都市發展局)", parkingCodeCitation: "Kaohsiung City Parking Lot Self-Government Ordinance (高雄市停車場管理自治條例)." }, dataSourceId: "osm_only", active: true },
  bangkok_metro: { code: "bangkok_metro", displayName: "Bangkok (กรุงเทพมหานคร)", bounds: { latMin: 13.55, latMax: 14.00, lonMin: 100.32, lonMax: 100.78 }, stateCode: "TH", country: "TH", jurisdiction: { dotName: "Bangkok Metropolitan Administration (BMA) — Traffic and Transportation Department", planningOfficeName: "BMA — City Planning and Urban Development Department", parkingCodeCitation: "Bangkok Metropolitan Building Control Ordinance — Parking Provisions (พ.ร.บ. ควบคุมอาคาร)." }, dataSourceId: "osm_only", active: true },
  ho_chi_minh_metro: { code: "ho_chi_minh_metro", displayName: "Ho Chi Minh City (TP. Hồ Chí Minh)", bounds: { latMin: 10.65, latMax: 10.90, lonMin: 106.55, lonMax: 106.85 }, stateCode: "VN", country: "VN", jurisdiction: { dotName: "Department of Transport — Ho Chi Minh City (Sở Giao thông Vận tải TP.HCM)", planningOfficeName: "Department of Planning and Architecture — Ho Chi Minh City (Sở Quy hoạch — Kiến trúc TP.HCM)", parkingCodeCitation: "QCVN 01:2021/BXD — Vietnam Building Code: Regional and Urban Planning, Parking Requirements." }, dataSourceId: "osm_only", active: true },
  hanoi_metro: { code: "hanoi_metro", displayName: "Hanoi (Hà Nội)", bounds: { latMin: 20.95, latMax: 21.13, lonMin: 105.72, lonMax: 105.95 }, stateCode: "VN", country: "VN", jurisdiction: { dotName: "Department of Transport — Hanoi (Sở Giao thông Vận tải Hà Nội)", planningOfficeName: "Department of Planning and Architecture — Hanoi (Sở Quy hoạch — Kiến trúc Hà Nội)", parkingCodeCitation: "QCVN 01:2021/BXD — Vietnam Building Code: Regional and Urban Planning, Parking Requirements." }, dataSourceId: "osm_only", active: true },
  manila_metro: { code: "manila_metro", displayName: "Manila (Metro Manila)", bounds: { latMin: 14.50, latMax: 14.78, lonMin: 120.92, lonMax: 121.13 }, stateCode: "PH", country: "PH", jurisdiction: { dotName: "Metropolitan Manila Development Authority (MMDA) — Traffic Engineering Center", planningOfficeName: "MMDA — Planning Office", parkingCodeCitation: "National Building Code of the Philippines (P.D. 1096), Rule VII Section 707 — Parking Requirements." }, dataSourceId: "osm_only", active: true },
  jakarta_metro: { code: "jakarta_metro", displayName: "Jakarta", bounds: { latMin: -6.40, latMax: -6.05, lonMin: 106.65, lonMax: 107.00 }, stateCode: "IDN", country: "ID", jurisdiction: { dotName: "Dinas Perhubungan DKI Jakarta", planningOfficeName: "Dinas Cipta Karya, Tata Ruang dan Pertanahan DKI Jakarta", parkingCodeCitation: "Perda DKI Jakarta No. 5/2012 tentang Perparkiran." }, dataSourceId: "osm_only", active: true },
  surabaya_metro: { code: "surabaya_metro", displayName: "Surabaya", bounds: { latMin: -7.40, latMax: -7.15, lonMin: 112.62, lonMax: 112.85 }, stateCode: "IDN", country: "ID", jurisdiction: { dotName: "Dinas Perhubungan Kota Surabaya", planningOfficeName: "Dinas Penataan Ruang Kota Surabaya", parkingCodeCitation: "Perda Kota Surabaya tentang Penyelenggaraan Perparkiran." }, dataSourceId: "osm_only", active: true },
  kuala_lumpur_metro: { code: "kuala_lumpur_metro", displayName: "Kuala Lumpur", bounds: { latMin: 3.05, latMax: 3.27, lonMin: 101.55, lonMax: 101.82 }, stateCode: "MY", country: "MY", jurisdiction: { dotName: "Dewan Bandaraya Kuala Lumpur (DBKL) — Department of Urban Transport", planningOfficeName: "DBKL — Department of Planning", parkingCodeCitation: "Kuala Lumpur City Plan 2040 — Parking Standards." }, dataSourceId: "osm_only", active: true },
  penang_metro: { code: "penang_metro", displayName: "Penang (George Town)", bounds: { latMin: 5.27, latMax: 5.50, lonMin: 100.18, lonMax: 100.40 }, stateCode: "MY", country: "MY", jurisdiction: { dotName: "Majlis Bandaraya Pulau Pinang (MBPP)", planningOfficeName: "Penang Island City Council — Planning Department", parkingCodeCitation: "MBPP Local Plan — Parking Standards." }, dataSourceId: "osm_only", active: true },
  karachi_metro: { code: "karachi_metro", displayName: "Karachi", bounds: { latMin: 24.78, latMax: 25.20, lonMin: 66.90, lonMax: 67.30 }, stateCode: "PK", country: "PK", jurisdiction: { dotName: "Karachi Metropolitan Corporation (KMC) — Transport & Communications Department", planningOfficeName: "Karachi Development Authority (KDA)", parkingCodeCitation: "Karachi Building & Town Planning Regulations 2002 — Parking Provisions." }, dataSourceId: "osm_only", active: true },
  tashkent_metro: { code: "tashkent_metro", displayName: "Toshkent (Tashkent)", bounds: { latMin: 41.20, latMax: 41.40, lonMin: 69.18, lonMax: 69.42 }, stateCode: "UZ", country: "UZ", jurisdiction: { dotName: "Toshkent shahar hokimiyati — Transport boshqarmasi (Tashkent City Transport Department)", planningOfficeName: "Toshkent shahar bosh me'morchiligi (Chief Architecture Office of Tashkent)", parkingCodeCitation: "O'zbekiston Respublikasi shaharsozlik me'yorlari (Uzbek Urban Planning Norms) — avtoturargoh standartlari." }, dataSourceId: "osm_only", active: true },

  // Middle East (8)
  dubai_metro: { code: "dubai_metro", displayName: "Dubai", bounds: { latMin: 25.05, latMax: 25.30, lonMin: 55.10, lonMax: 55.50 }, stateCode: "AE", country: "AE", jurisdiction: { dotName: "Roads and Transport Authority (RTA) — Dubai", planningOfficeName: "Dubai Municipality — Planning Department", parkingCodeCitation: "Dubai Municipality — Parking Standards for Buildings (Administrative Decision 5 of 2018)." }, dataSourceId: "osm_only", active: true },
  abu_dhabi_metro: { code: "abu_dhabi_metro", displayName: "Abu Dhabi", bounds: { latMin: 24.30, latMax: 24.55, lonMin: 54.27, lonMax: 54.62 }, stateCode: "AE", country: "AE", jurisdiction: { dotName: "Integrated Transport Centre (ITC) — Department of Municipalities and Transport", planningOfficeName: "Department of Municipalities and Transport — Urban Planning", parkingCodeCitation: "Abu Dhabi Urban Planning Council — Parking Standards Manual." }, dataSourceId: "osm_only", active: true },
  riyadh_metro: { code: "riyadh_metro", displayName: "Riyadh (الرياض)", bounds: { latMin: 24.55, latMax: 24.85, lonMin: 46.55, lonMax: 46.85 }, stateCode: "SA", country: "SA", jurisdiction: { dotName: "Royal Commission for Riyadh City (RCRC)", planningOfficeName: "Riyadh Municipality (أمانة منطقة الرياض)", parkingCodeCitation: "Saudi Building Code (SBC 802) — Parking Requirements." }, dataSourceId: "osm_only", active: true },
  tel_aviv_metro: { code: "tel_aviv_metro", displayName: "Tel Aviv (תל אביב)", bounds: { latMin: 32.00, latMax: 32.20, lonMin: 34.72, lonMax: 34.85 }, stateCode: "ISR", country: "IL", jurisdiction: { dotName: "Tel Aviv-Yafo Municipality — Transportation Department (אגף התנועה)", planningOfficeName: "Tel Aviv-Yafo Municipality — Urban Planning Department (אגף תכנון ובניין עיר)", parkingCodeCitation: "Israel Planning and Building Regulations — Parking Standards (תקנות התכנון והבנייה — חניה)." }, dataSourceId: "osm_only", active: true },
  istanbul_metro: { code: "istanbul_metro", displayName: "Istanbul (İstanbul)", bounds: { latMin: 40.85, latMax: 41.20, lonMin: 28.65, lonMax: 29.27 }, stateCode: "TR", country: "TR", jurisdiction: { dotName: "İstanbul Büyükşehir Belediyesi — Ulaşım Daire Başkanlığı", planningOfficeName: "İstanbul Büyükşehir Belediyesi — İmar ve Şehircilik Daire Başkanlığı", parkingCodeCitation: "İstanbul Otopark Yönetmeliği." }, dataSourceId: "osm_only", active: true },
  ankara_metro: { code: "ankara_metro", displayName: "Ankara", bounds: { latMin: 39.83, latMax: 40.05, lonMin: 32.62, lonMax: 32.92 }, stateCode: "TR", country: "TR", jurisdiction: { dotName: "Ankara Büyükşehir Belediyesi — Ulaşım Daire Başkanlığı", planningOfficeName: "Ankara Büyükşehir Belediyesi — İmar ve Şehircilik Daire Başkanlığı", parkingCodeCitation: "Otopark Yönetmeliği (Türkiye) — Bakanlık standartları." }, dataSourceId: "osm_only", active: true },
  doha_metro: { code: "doha_metro", displayName: "Doha (الدوحة)", bounds: { latMin: 25.20, latMax: 25.40, lonMin: 51.45, lonMax: 51.65 }, stateCode: "QA", country: "QA", jurisdiction: { dotName: "Ministry of Transport — Qatar", planningOfficeName: "Ministry of Municipality — Urban Planning Department", parkingCodeCitation: "Qatar Construction Specifications (QCS) — Parking Requirements." }, dataSourceId: "osm_only", active: true },
  amman_metro: { code: "amman_metro", displayName: "Amman (عمّان)", bounds: { latMin: 31.83, latMax: 32.05, lonMin: 35.78, lonMax: 36.05 }, stateCode: "JO", country: "JO", jurisdiction: { dotName: "Greater Amman Municipality (GAM) — Transportation Department", planningOfficeName: "Greater Amman Municipality — Urban Planning Department", parkingCodeCitation: "Jordan Building Regulations — Parking Provisions." }, dataSourceId: "osm_only", active: true },
  beirut_metro: { code: "beirut_metro", displayName: "Beirut (بيروت)", bounds: { latMin: 33.85, latMax: 33.93, lonMin: 35.45, lonMax: 35.58 }, stateCode: "LB", country: "LB", jurisdiction: { dotName: "Ministry of Public Works and Transport (وزارة الأشغال العامة والنقل) — Lebanon", planningOfficeName: "Directorate General of Urban Planning (المديرية العامة للتنظيم المدني)", parkingCodeCitation: "Lebanese Building Code — Parking provisions (المرسوم 14969/2005)." }, dataSourceId: "osm_only", active: true },

  // South America (15)
  sao_paulo_metro: { code: "sao_paulo_metro", displayName: "São Paulo", bounds: { latMin: -23.78, latMax: -23.40, lonMin: -46.85, lonMax: -46.35 }, stateCode: "BR", country: "BR", jurisdiction: { dotName: "Companhia de Engenharia de Tráfego (CET) — Prefeitura de São Paulo", planningOfficeName: "Secretaria Municipal de Urbanismo e Licenciamento — Prefeitura de São Paulo", parkingCodeCitation: "Lei de Parcelamento, Uso e Ocupação do Solo — São Paulo (Lei 16.402/2016)." }, dataSourceId: "osm_only", active: true },
  rio_de_janeiro_metro: { code: "rio_de_janeiro_metro", displayName: "Rio de Janeiro", bounds: { latMin: -23.07, latMax: -22.75, lonMin: -43.85, lonMax: -43.10 }, stateCode: "BR", country: "BR", jurisdiction: { dotName: "Secretaria Municipal de Transportes — Prefeitura do Rio de Janeiro", planningOfficeName: "Secretaria Municipal de Planejamento Urbano — Prefeitura do Rio de Janeiro", parkingCodeCitation: "Plano Diretor de Desenvolvimento Urbano Sustentável do Município do Rio de Janeiro." }, dataSourceId: "osm_only", active: true },
  brasilia_metro: { code: "brasilia_metro", displayName: "Brasília", bounds: { latMin: -16.05, latMax: -15.65, lonMin: -48.10, lonMax: -47.75 }, stateCode: "BR", country: "BR", jurisdiction: { dotName: "Departamento de Estradas de Rodagem do DF (DER-DF)", planningOfficeName: "Secretaria de Estado de Desenvolvimento Urbano e Habitação do DF (SEDUH)", parkingCodeCitation: "Plano Diretor de Ordenamento Territorial do Distrito Federal (PDOT)." }, dataSourceId: "osm_only", active: true },
  salvador_br_metro: { code: "salvador_br_metro", displayName: "Salvador (BA)", bounds: { latMin: -13.05, latMax: -12.85, lonMin: -38.55, lonMax: -38.35 }, stateCode: "BR", country: "BR", jurisdiction: { dotName: "Superintendência de Trânsito do Salvador (Transalvador)", planningOfficeName: "Secretaria Municipal de Desenvolvimento e Urbanismo — Prefeitura de Salvador", parkingCodeCitation: "Plano Diretor de Desenvolvimento Urbano de Salvador (PDDU)." }, dataSourceId: "osm_only", active: true },
  fortaleza_metro: { code: "fortaleza_metro", displayName: "Fortaleza", bounds: { latMin: -3.85, latMax: -3.65, lonMin: -38.65, lonMax: -38.40 }, stateCode: "BR", country: "BR", jurisdiction: { dotName: "Autarquia Municipal de Trânsito e Cidadania (AMC) — Fortaleza", planningOfficeName: "Secretaria Municipal de Urbanismo e Meio Ambiente — Fortaleza", parkingCodeCitation: "Plano Diretor Participativo do Município de Fortaleza." }, dataSourceId: "osm_only", active: true },
  belo_horizonte_metro: { code: "belo_horizonte_metro", displayName: "Belo Horizonte", bounds: { latMin: -20.05, latMax: -19.78, lonMin: -44.05, lonMax: -43.83 }, stateCode: "BR", country: "BR", jurisdiction: { dotName: "BHTrans (Empresa de Transportes e Trânsito de Belo Horizonte)", planningOfficeName: "Secretaria Municipal de Política Urbana — Belo Horizonte", parkingCodeCitation: "Lei de Parcelamento, Ocupação e Uso do Solo de Belo Horizonte." }, dataSourceId: "osm_only", active: true },
  buenos_aires_metro: { code: "buenos_aires_metro", displayName: "Buenos Aires", bounds: { latMin: -34.72, latMax: -34.45, lonMin: -58.55, lonMax: -58.30 }, stateCode: "ARG", country: "AR", jurisdiction: { dotName: "Secretaría de Transporte y Obras Públicas — Gobierno de la Ciudad de Buenos Aires", planningOfficeName: "Subsecretaría de Registros, Interpretación y Catastro — GCBA", parkingCodeCitation: "Código Urbanístico de la Ciudad Autónoma de Buenos Aires (Ley 6099)." }, dataSourceId: "osm_only", active: true },
  cordoba_metro: { code: "cordoba_metro", displayName: "Córdoba (AR)", bounds: { latMin: -31.50, latMax: -31.30, lonMin: -64.30, lonMax: -64.10 }, stateCode: "ARG", country: "AR", jurisdiction: { dotName: "Secretaría de Movilidad Urbana — Municipalidad de Córdoba", planningOfficeName: "Secretaría de Planeamiento Urbano — Municipalidad de Córdoba", parkingCodeCitation: "Ordenanza de Ocupación del Suelo de la Ciudad de Córdoba." }, dataSourceId: "osm_only", active: true },
  rosario_metro: { code: "rosario_metro", displayName: "Rosario", bounds: { latMin: -33.05, latMax: -32.85, lonMin: -60.78, lonMax: -60.55 }, stateCode: "ARG", country: "AR", jurisdiction: { dotName: "Secretaría de Movilidad — Municipalidad de Rosario", planningOfficeName: "Secretaría de Planeamiento — Municipalidad de Rosario", parkingCodeCitation: "Código Urbano de Rosario." }, dataSourceId: "osm_only", active: true },
  santiago_cl_metro: { code: "santiago_cl_metro", displayName: "Santiago de Chile", bounds: { latMin: -33.65, latMax: -33.30, lonMin: -70.85, lonMax: -70.45 }, stateCode: "CL", country: "CL", jurisdiction: { dotName: "Ministerio de Transportes y Telecomunicaciones — Programa SECTRA", planningOfficeName: "Secretaría Regional Ministerial de Vivienda y Urbanismo (SEREMI MINVU) Región Metropolitana", parkingCodeCitation: "Plan Regulador Metropolitano de Santiago (PRMS)." }, dataSourceId: "osm_only", active: true },
  bogota_metro: { code: "bogota_metro", displayName: "Bogotá", bounds: { latMin: 4.45, latMax: 4.85, lonMin: -74.27, lonMax: -73.95 }, stateCode: "COL", country: "CO", jurisdiction: { dotName: "Secretaría Distrital de Movilidad — Alcaldía Mayor de Bogotá", planningOfficeName: "Secretaría Distrital de Planeación — Alcaldía Mayor de Bogotá", parkingCodeCitation: "Plan de Ordenamiento Territorial (POT) de Bogotá — Decreto 555 de 2021." }, dataSourceId: "osm_only", active: true },
  medellin_metro: { code: "medellin_metro", displayName: "Medellín", bounds: { latMin: 6.13, latMax: 6.35, lonMin: -75.70, lonMax: -75.45 }, stateCode: "COL", country: "CO", jurisdiction: { dotName: "Secretaría de Movilidad de Medellín — Alcaldía de Medellín", planningOfficeName: "Departamento Administrativo de Planeación — Alcaldía de Medellín", parkingCodeCitation: "Plan de Ordenamiento Territorial (POT) de Medellín — Acuerdo 48 de 2014." }, dataSourceId: "osm_only", active: true },
  lima_metro: { code: "lima_metro", displayName: "Lima", bounds: { latMin: -12.20, latMax: -11.85, lonMin: -77.20, lonMax: -76.85 }, stateCode: "PE", country: "PE", jurisdiction: { dotName: "Autoridad de Transporte Urbano para Lima y Callao (ATU)", planningOfficeName: "Instituto Metropolitano de Planificación — Municipalidad Metropolitana de Lima", parkingCodeCitation: "Reglamento Nacional de Edificaciones (Perú) — Norma A.010 / A.070 / A.080 Estacionamientos." }, dataSourceId: "osm_only", active: true },
  montevideo_metro: { code: "montevideo_metro", displayName: "Montevideo", bounds: { latMin: -34.95, latMax: -34.78, lonMin: -56.30, lonMax: -56.05 }, stateCode: "UY", country: "UY", jurisdiction: { dotName: "División Tránsito — Intendencia de Montevideo", planningOfficeName: "Departamento de Planificación — Intendencia de Montevideo", parkingCodeCitation: "Plan de Ordenamiento Territorial de Montevideo (POT) — Estacionamientos." }, dataSourceId: "osm_only", active: true },
  quito_metro: { code: "quito_metro", displayName: "Quito", bounds: { latMin: -0.40, latMax: -0.05, lonMin: -78.62, lonMax: -78.40 }, stateCode: "EC", country: "EC", jurisdiction: { dotName: "Agencia Metropolitana de Tránsito — Municipio del Distrito Metropolitano de Quito", planningOfficeName: "Secretaría de Territorio, Hábitat y Vivienda — Quito", parkingCodeCitation: "Plan de Uso y Gestión del Suelo (PUGS) del Distrito Metropolitano de Quito." }, dataSourceId: "osm_only", active: true },

  // Africa (8)
  johannesburg_metro: { code: "johannesburg_metro", displayName: "Johannesburg", bounds: { latMin: -26.30, latMax: -26.05, lonMin: 27.85, lonMax: 28.20 }, stateCode: "ZA", country: "ZA", jurisdiction: { dotName: "Johannesburg Roads Agency (JRA)", planningOfficeName: "Department of Development Planning — City of Johannesburg", parkingCodeCitation: "City of Johannesburg Land Use Scheme 2018 — Parking Requirements." }, dataSourceId: "osm_only", active: true },
  cape_town_metro: { code: "cape_town_metro", displayName: "Cape Town", bounds: { latMin: -34.10, latMax: -33.85, lonMin: 18.35, lonMax: 18.75 }, stateCode: "ZA", country: "ZA", jurisdiction: { dotName: "Transport Directorate — City of Cape Town", planningOfficeName: "Urban Planning and Design Department — City of Cape Town", parkingCodeCitation: "City of Cape Town Municipal Planning By-law — Parking and Loading Standards." }, dataSourceId: "osm_only", active: true },
  durban_metro: { code: "durban_metro", displayName: "Durban (eThekwini)", bounds: { latMin: -29.95, latMax: -29.72, lonMin: 30.92, lonMax: 31.10 }, stateCode: "ZA", country: "ZA", jurisdiction: { dotName: "eThekwini Transport Authority", planningOfficeName: "eThekwini Municipality — Development Planning, Environment and Management Unit", parkingCodeCitation: "eThekwini Town Planning Scheme — Parking Provisions." }, dataSourceId: "osm_only", active: true },
  cairo_metro: { code: "cairo_metro", displayName: "Cairo (القاهرة)", bounds: { latMin: 29.92, latMax: 30.20, lonMin: 31.13, lonMax: 31.50 }, stateCode: "EG", country: "EG", jurisdiction: { dotName: "Cairo Governorate — Traffic Department", planningOfficeName: "General Organization for Physical Planning (GOPP) — Egypt", parkingCodeCitation: "Egyptian Building Code — Parking Requirements (Law 119 of 2008)." }, dataSourceId: "osm_only", active: true },
  lagos_metro: { code: "lagos_metro", displayName: "Lagos", bounds: { latMin: 6.30, latMax: 6.65, lonMin: 3.20, lonMax: 3.50 }, stateCode: "NG", country: "NG", jurisdiction: { dotName: "Lagos State Traffic Management Authority (LASTMA)", planningOfficeName: "Lagos State Ministry of Physical Planning and Urban Development", parkingCodeCitation: "Lagos State Urban and Regional Planning and Development Law — Parking Requirements." }, dataSourceId: "osm_only", active: true },
  nairobi_metro: { code: "nairobi_metro", displayName: "Nairobi", bounds: { latMin: -1.40, latMax: -1.15, lonMin: 36.65, lonMax: 36.95 }, stateCode: "KE", country: "KE", jurisdiction: { dotName: "Nairobi Metropolitan Services (NMS) — Roads, Transport & Public Works", planningOfficeName: "Nairobi City County — Urban Planning Department", parkingCodeCitation: "Nairobi City County Integrated Development Plan — Parking Standards." }, dataSourceId: "osm_only", active: true },
  casablanca_metro: { code: "casablanca_metro", displayName: "Casablanca (الدار البيضاء)", bounds: { latMin: 33.50, latMax: 33.65, lonMin: -7.72, lonMax: -7.50 }, stateCode: "MAR", country: "MA", jurisdiction: { dotName: "Casa Transports — Commune Urbaine de Casablanca", planningOfficeName: "Agence Urbaine de Casablanca", parkingCodeCitation: "Plan d'Aménagement Unifié (PAU) — Casablanca, normes de stationnement." }, dataSourceId: "osm_only", active: true },
  accra_metro: { code: "accra_metro", displayName: "Accra", bounds: { latMin: 5.50, latMax: 5.70, lonMin: -0.30, lonMax: -0.05 }, stateCode: "GH", country: "GH", jurisdiction: { dotName: "Accra Metropolitan Assembly (AMA) — Transport Department", planningOfficeName: "Greater Accra Regional Coordinating Council — Town and Country Planning", parkingCodeCitation: "National Building Regulations LI 1630 — Parking Provisions (Ghana)." }, dataSourceId: "osm_only", active: true },

  // Oceania (6)
  sydney_metro: { code: "sydney_metro", displayName: "Sydney", bounds: { latMin: -33.95, latMax: -33.60, lonMin: 150.85, lonMax: 151.32 }, stateCode: "AU", country: "AU", jurisdiction: { dotName: "Transport for NSW (TfNSW)", planningOfficeName: "NSW Department of Planning, Housing and Infrastructure", parkingCodeCitation: "RTA Guide to Traffic Generating Developments (NSW) — Parking Generation Rates." }, dataSourceId: "osm_only", active: true },
  melbourne_metro: { code: "melbourne_metro", displayName: "Melbourne", bounds: { latMin: -38.05, latMax: -37.65, lonMin: 144.75, lonMax: 145.27 }, stateCode: "AU", country: "AU", jurisdiction: { dotName: "Department of Transport and Planning — Victoria", planningOfficeName: "Department of Transport and Planning — Victoria (Planning Division)", parkingCodeCitation: "Victoria Planning Provisions — Clause 52.06 Car Parking." }, dataSourceId: "osm_only", active: true },
  brisbane_metro: { code: "brisbane_metro", displayName: "Brisbane", bounds: { latMin: -27.65, latMax: -27.30, lonMin: 152.85, lonMax: 153.20 }, stateCode: "AU", country: "AU", jurisdiction: { dotName: "Department of Transport and Main Roads (TMR) — Queensland", planningOfficeName: "Brisbane City Council — City Planning and Sustainability", parkingCodeCitation: "Brisbane City Plan 2014 — Transport, Access, Parking and Servicing Code." }, dataSourceId: "osm_only", active: true },
  perth_metro: { code: "perth_metro", displayName: "Perth", bounds: { latMin: -32.10, latMax: -31.78, lonMin: 115.70, lonMax: 116.05 }, stateCode: "AU", country: "AU", jurisdiction: { dotName: "Main Roads Western Australia", planningOfficeName: "Department of Planning, Lands and Heritage — Western Australia", parkingCodeCitation: "State Planning Policy 4.2 (Activity Centres) and local planning schemes — Parking standards." }, dataSourceId: "osm_only", active: true },
  adelaide_metro: { code: "adelaide_metro", displayName: "Adelaide", bounds: { latMin: -35.05, latMax: -34.80, lonMin: 138.45, lonMax: 138.78 }, stateCode: "AU", country: "AU", jurisdiction: { dotName: "Department for Infrastructure and Transport — South Australia", planningOfficeName: "Department for Trade and Investment — Planning and Land Use Services (SA)", parkingCodeCitation: "Planning and Design Code (SA) — Off-Street Car Parking Requirements." }, dataSourceId: "osm_only", active: true },
  auckland_metro: { code: "auckland_metro", displayName: "Auckland", bounds: { latMin: -37.05, latMax: -36.70, lonMin: 174.55, lonMax: 174.95 }, stateCode: "NZ", country: "NZ", jurisdiction: { dotName: "Auckland Transport (AT)", planningOfficeName: "Auckland Council — Plans and Places", parkingCodeCitation: "Auckland Unitary Plan — Chapter E27 Transport (Parking and Loading)." }, dataSourceId: "osm_only", active: true },
  wellington_metro: { code: "wellington_metro", displayName: "Wellington", bounds: { latMin: -41.35, latMax: -41.18, lonMin: 174.72, lonMax: 174.92 }, stateCode: "NZ", country: "NZ", jurisdiction: { dotName: "Waka Kotahi NZ Transport Agency — Wellington region", planningOfficeName: "Wellington City Council — City Design and District Plan", parkingCodeCitation: "Wellington City District Plan — Transport rules: Parking, loading and access." }, dataSourceId: "osm_only", active: true },

  // Eastern Europe (1) — Russia removed.
  kyiv_metro: { code: "kyiv_metro", displayName: "Kyiv (Київ)", bounds: { latMin: 50.30, latMax: 50.55, lonMin: 30.30, lonMax: 30.78 }, stateCode: "UA", country: "UA", jurisdiction: { dotName: "Kyiv City State Administration — Department of Transport Infrastructure (Департамент транспортної інфраструктури КМДА)", planningOfficeName: "Kyiv City State Administration — Department of Urban Planning and Architecture", parkingCodeCitation: "DBN B.2.3-5:2018 — Streets and Roads of Settlements (Ukrainian Building Norms) — Parking Standards." }, dataSourceId: "osm_only", active: true },

  // Central America / Caribbean (3)
  panama_city_metro: { code: "panama_city_metro", displayName: "Panama City", bounds: { latMin: 8.85, latMax: 9.10, lonMin: -79.65, lonMax: -79.40 }, stateCode: "PAN", country: "PA", jurisdiction: { dotName: "Autoridad del Tránsito y Transporte Terrestre (ATTT) — Panamá", planningOfficeName: "Municipio de Panamá — Dirección de Planificación Urbana", parkingCodeCitation: "Reglamento de Urbanizaciones — Municipio de Panamá, Capítulo Estacionamientos." }, dataSourceId: "osm_only", active: true },
  san_jose_cr_metro: { code: "san_jose_cr_metro", displayName: "San José (CR)", bounds: { latMin: 9.85, latMax: 10.05, lonMin: -84.20, lonMax: -83.95 }, stateCode: "CR", country: "CR", jurisdiction: { dotName: "Ministerio de Obras Públicas y Transportes (MOPT) — Costa Rica", planningOfficeName: "Instituto Nacional de Vivienda y Urbanismo (INVU) — Costa Rica", parkingCodeCitation: "Reglamento de Construcciones de Costa Rica — Estacionamientos." }, dataSourceId: "osm_only", active: true },
  havana_metro: { code: "havana_metro", displayName: "La Habana (Havana)", bounds: { latMin: 22.95, latMax: 23.20, lonMin: -82.55, lonMax: -82.27 }, stateCode: "CU", country: "CU", jurisdiction: { dotName: "Dirección Provincial de Transporte de La Habana", planningOfficeName: "Dirección Provincial de Planificación Física — La Habana", parkingCodeCitation: "Regulaciones urbanísticas de La Habana — Provisiones de estacionamiento." }, dataSourceId: "osm_only", active: true },
};

/**
 * Resolve the active region.
 *
 * - With no argument, returns Atlanta (back-compat with the pre-multi-region
 *   call sites — they didn't have a region context to pass).
 * - With a `regionCode`, returns that region if registered AND active.
 *   Unknown / inactive codes fall back to Atlanta with a console warning,
 *   so a stale `regionCode` on a `firms` or `tis_projects` row never
 *   crashes report generation.
 *
 * Preferred call pattern: at the request handler, derive the region once
 * from `regionForCoordinate(lat, lon)` (or look up `firms.region_code`),
 * then pass the resolved `Region` down into the report-generation
 * pipeline. Avoid calling `getActiveRegion()` deep in compute helpers.
 */
export function getActiveRegion(regionCode?: RegionCode | string | null): Region {
  if (!regionCode) return ATLANTA_METRO;
  const region = (REGIONS as Record<string, Region | undefined>)[regionCode];
  if (!region) {
    console.warn(`getActiveRegion: unknown region code "${regionCode}", falling back to Atlanta`);
    return ATLANTA_METRO;
  }
  if (!region.active) {
    console.warn(`getActiveRegion: region "${regionCode}" is registered but inactive, falling back to Atlanta`);
    return ATLANTA_METRO;
  }
  return region;
}

/**
 * Test whether a coordinate falls inside an active region. Used by
 * route handlers as a runtime check on top of the schema-level lat/lon
 * bounds. Returns the matching region, or null if outside every
 * active region.
 */
export function regionForCoordinate(
  lat: number,
  lon: number,
): Region | null {
  for (const region of Object.values(REGIONS)) {
    if (!region.active) continue;
    const b = region.bounds;
    if (lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax) {
      return region;
    }
  }
  return null;
}

/**
 * Find the active region whose bounding-box centroid is closest to
 * (lat, lon). Returns null only if there are zero active regions.
 *
 * Used by /demo/presets to localize the demo to the visitor's nearest
 * covered metro when IP geolocation lands them outside any specific
 * region bbox (e.g. visitor in a small French city near Paris but not
 * inside Paris's bbox).
 *
 * Distance is computed in equirectangular projection — accurate enough
 * for "which metro is closer" decisions at any latitude, way cheaper
 * than haversine, and consistent with how the engine handles short-
 * range bbox math elsewhere.
 */
export function nearestRegionForCoordinate(lat: number, lon: number): Region | null {
  let best: { region: Region; d2: number } | null = null;
  for (const region of Object.values(REGIONS)) {
    if (!region.active) continue;
    const b = region.bounds;
    const cLat = (b.latMin + b.latMax) / 2;
    const cLon = (b.lonMin + b.lonMax) / 2;
    const dLat = lat - cLat;
    // Compress longitude difference by cos(lat) so a degree east-west
    // is comparable to a degree north-south. Using the centroid lat
    // is good enough for ranking — we're not measuring absolute
    // distance, just picking the closest centroid.
    const dLon = (lon - cLon) * Math.cos((cLat * Math.PI) / 180);
    const d2 = dLat * dLat + dLon * dLon;
    if (best === null || d2 < best.d2) best = { region, d2 };
  }
  return best?.region ?? null;
}
