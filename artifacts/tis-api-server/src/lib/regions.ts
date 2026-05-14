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
  // Reserved codes for the Southeastern expansion plan — wire them up
  // when there's customer signal in that metro.
  | "charlotte_metro"
  | "nashville_metro"
  | "birmingham_metro"
  | "jacksonville_metro"
  | "knoxville_metro"
  | "greenville_metro"
  | "chattanooga_metro";

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
  stateCode: "GA" | "NC" | "TN" | "AL" | "FL" | "SC";
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
  dataSourceId: "gdot_511" | "ncdot" | "tdot" | "aldot" | "fdot" | "scdot";
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
    bounds: { latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 },
    stateCode: "NC",
    jurisdiction: {
      dotName: "Charlotte DOT (CDOT)",
      planningOfficeName: "Charlotte Department of Transportation Planning",
      parkingCodeCitation:
        "Charlotte Unified Development Ordinance (UDO), Article 19 — Parking.",
    },
    dataSourceId: "ncdot",
    active: false,
  },
  nashville_metro: {
    code: "nashville_metro",
    displayName: "Nashville MSA",
    bounds: { latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 },
    stateCode: "TN",
    jurisdiction: {
      dotName: "Nashville DOT (NDOT)",
      planningOfficeName: "Nashville Metro Public Works Traffic Engineering",
      parkingCodeCitation:
        "Metropolitan Nashville Zoning Code, Title 17 — Parking and Loading.",
    },
    dataSourceId: "tdot",
    active: false,
  },
  birmingham_metro: {
    code: "birmingham_metro",
    displayName: "Birmingham MSA",
    bounds: { latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 },
    stateCode: "AL",
    jurisdiction: {
      dotName: "City of Birmingham DOT",
      planningOfficeName: "Birmingham Department of Transportation Planning",
      parkingCodeCitation:
        "City of Birmingham Zoning Code, Chapter 4 — Parking and Loading.",
    },
    dataSourceId: "aldot",
    active: false,
  },
  jacksonville_metro: {
    code: "jacksonville_metro",
    displayName: "Jacksonville MSA",
    bounds: { latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 },
    stateCode: "FL",
    jurisdiction: {
      dotName: "Jacksonville Public Works",
      planningOfficeName: "Jacksonville Planning and Development",
      parkingCodeCitation:
        "City of Jacksonville Zoning Code, Part 4 — Off-Street Parking.",
    },
    dataSourceId: "fdot",
    active: false,
  },
  knoxville_metro: {
    code: "knoxville_metro",
    displayName: "Knoxville MSA",
    bounds: { latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 },
    stateCode: "TN",
    jurisdiction: {
      dotName: "Knoxville Engineering Department",
      planningOfficeName: "Knoxville-Knox County Planning",
      parkingCodeCitation:
        "City of Knoxville Zoning Ordinance, Article 12 — Parking.",
    },
    dataSourceId: "tdot",
    active: false,
  },
  greenville_metro: {
    code: "greenville_metro",
    displayName: "Greenville MSA",
    bounds: { latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 },
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
  chattanooga_metro: {
    code: "chattanooga_metro",
    displayName: "Chattanooga MSA",
    bounds: { latMin: 0, latMax: 0, lonMin: 0, lonMax: 0 },
    stateCode: "TN",
    jurisdiction: {
      dotName: "Chattanooga DOT",
      planningOfficeName: "Chattanooga Department of Transportation Planning",
      parkingCodeCitation:
        "City of Chattanooga Zoning Ordinance, Section 38 — Parking.",
    },
    dataSourceId: "tdot",
    active: false,
  },
};

/**
 * Resolve a project's active region. Currently always Atlanta because
 * every firm in the DB implicitly serves the Atlanta MSA. When the
 * schema grows a `region_code` column on firms or tis_projects, this
 * function becomes the single place to consult it.
 */
export function getActiveRegion(): Region {
  return ATLANTA_METRO;
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
