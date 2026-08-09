/**
 * Snap state-DOT AADT data onto every signal in a region.
 *
 * Two data shapes handled:
 *   - FDOT: AADT on line *segments* (polyline along roads). Each signal gets
 *     the AADT of the nearest segment within 100m. K-factor (peak-hour
 *     fraction of daily traffic) is taken from the same segment.
 *   - NCDOT: AADT on point *stations*. Each signal gets the most recent
 *     non-empty AADT from the nearest station within 500m. K-factor falls
 *     back to the FHWA default of 9% (no per-station K in NCDOT data).
 *
 * Output: artifacts/api-server/src/data/<slug>-aadt.json — a JSON object
 * keyed by signal id (positive OSM id, or negative city/county id) with:
 *   { aadt: number, year: number, kFactor: number, distM: number, source: "fdot" | "ncdot" }
 *
 * regional-intersections.ts reads this file to replace the synthetic
 * 1200vph road-class baseline with measured per-signal volumes.
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-aadt-by-signal.ts tampa
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-aadt-by-signal.ts --all
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PAGE_SIZE = 2000;
// Snap radii: tuned upward from the initial tight values. FDOT segments are
// very dense (p50=2m at 100m), so we can comfortably extend to 200m for the
// long-tail signals near segment endpoints. NCDOT stations are sparser
// (p50=130m at 500m); 1000m catches more rural / suburban signals at the
// cost of occasional wrong-road snaps (acceptable trade-off — wrong-road
// AADT is still real measured traffic on a nearby major route).
const FDOT_SNAP_M = 200;
const NCDOT_SNAP_M = 1000;
const MDC_SNAP_M = 200; // Miami-Dade County local-road counts (denser than FDOT)
const DEFAULT_K_FACTOR_PCT = 9; // FHWA standard for urban arterials

type SignalTuple = [number, number, number, string | null, number];

/**
 * Per-signal AADT record persisted to <slug>-aadt.json. `source` is a
 * short DOT slug matching `dataSourceId` in artifacts/tis-api-server/
 * src/lib/regions.ts (idot / mdot_mi / nysdot / penndot / massdot /
 * caltrans / etc.) — so a downstream consumer can route a provenance
 * audit to the right source-system docs. Historically this was a
 * narrow `"fdot" | "ncdot"` enum, but new state wires kept getting
 * mis-tagged "fdot" because the type didn't admit anything else;
 * widened to a free string to make truthful provenance the easy path.
 */
type AadtRecord = {
  aadt: number;
  year: number;
  kFactor: number;
  distM: number;
  source: string;
};

// ── FDOT polyline shape ───────────────────────────────────────────────
type FdotFeature = {
  attributes: {
    YEAR_: number;
    AADT: number | null;
    KFCTR: number | null;
    COUNTY: string;
  };
  geometry?: { paths: Array<Array<[number, number]>> };
};

// ── NCDOT point-station shape ─────────────────────────────────────────
type NcdotFeature = {
  attributes: {
    LocationID: string;
    County: string;
    Active: number;
    [aadtYear: string]: unknown; // AADT_2002..AADT_2024
  };
  geometry?: { x: number; y: number };
};

// ── TDOT point-station shape ──────────────────────────────────────────
type TdotFeature = {
  attributes: {
    LOCAL_ID: string;
    COUNTY: string;
    ON_ROAD: string;
    FUNCTIONAL_CLASS: string;
    AADT: number | null;
    AADT_YEAR: number;
    TRUCK_PERCENTAGE: number | null;
  };
  geometry?: { x: number; y: number };
};

// ── MDC (Miami-Dade County) supplementary point shape ─────────────────
type MdcFeature = {
  attributes: {
    OBJECTID: number;
    MDSTA: number;
    AADT2019: number | null;
    LAT: number;
    LON: number;
  };
  geometry?: { x: number; y: number };
};

// ── VDOT polyline shape ───────────────────────────────────────────────
type VdotFeature = {
  attributes: {
    OBJECTID: number;
    DATA_DATE: number; // epoch ms
    ROUTE_NAME: string;
    ADT: number | null;
  };
  geometry?: { paths: Array<Array<[number, number]>> };
};

// ── SCDOT multipoint shape ────────────────────────────────────────────
type ScdotFeature = {
  attributes: {
    FID: number;
    Station_Nu: number;
    Factored_A: number | null; // AADT
    Factored_1: number;        // year (2017)
    County_Nam: string;
  };
  // Layer is MultiPoint — we use the first point of the geometry
  geometry?: { points?: Array<[number, number]>; x?: number; y?: number };
};

// ── Generic polyline AADT (bbox-filtered, per-state field mapping) ────
// Used for: TxDOT, ODOT-OH, PennDOT, MassDOT, INDOT, MoDOT, MDOT-SHA poly,
// DDOT, IDOT, MDOT-MI, MnDOT, WisDOT, NYSDOT. Each state DOT publishes a
// polyline FeatureServer/MapServer; the only per-state differences are URL,
// AADT field, year extractor, and snap radius. We funnel them all through
// one path keyed by config to avoid 800 lines of near-duplicate branches.
type PolylineFeature = {
  attributes: Record<string, unknown>;
  geometry?: { paths: Array<Array<[number, number]>> };
};

type YearExtractor =
  | { kind: "field_int"; field: string }       // attributes[field] is the year as int
  | { kind: "field_epoch_ms"; field: string }  // attributes[field] is epoch ms → year
  | { kind: "static"; year: number };          // year stamped at ingest

type PolylineBboxConfig = {
  url: string;
  /** Field name carrying the AADT value (number; we cast string→int if needed). */
  aadtField: string;
  yearExtractor: YearExtractor;
  /** Snap radius in meters. */
  snapM: number;
  /**
   * Provenance tag written into each AADT record's `source` field.
   * Use the short DOT slug matching `dataSourceId` in regions.ts
   * (idot / mdot_mi / nysdot / etc.). Previously locked to "fdot" /
   * "ncdot" which caused every state's polyline output to be silently
   * mis-tagged "fdot"; widened to free string.
   */
  sourceTag: string;
  /** Optional WHERE clause snippet ANDed with the AADT > 0 filter. */
  extraWhere?: string;
};

// ── Generic point AADT (Caltrans-style, bbox-filtered) ─────────────────
// Per-station with BACK_AADT / AHEAD_AADT (Caltrans) or a single AADT
// (NCDOT-style). Snap nearest within radius, prefer max(back, ahead) for
// bidirectional totals.
type PointBboxConfig = {
  url: string;
  /** Field name carrying primary AADT. */
  aadtField: string;
  /** Optional second AADT field (Caltrans BACK/AHEAD) — we take max. */
  aadtFieldAlt?: string;
  yearExtractor: YearExtractor;
  snapM: number;
  /** Same widened provenance tag — see PolylineBboxConfig.sourceTag. */
  sourceTag: string;
  extraWhere?: string;
};

type RegionConfig = {
  slug: string;
  /** State DOT data source. */
  source: "fdot" | "ncdot" | "tdot" | "vdot" | "scdot" | "polyline_bbox" | "point_bbox";
  /** Counties the region spans. Casing matches source's data convention.
   *  VDOT/generic bbox sources have no county field → spatial bbox is used. */
  counties: string[];
  /** Bbox for VDOT-style + generic sources lacking a county column. */
  bbox?: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  /** Per-state polyline-AADT config (required when source === "polyline_bbox"). */
  polylineConfig?: PolylineBboxConfig;
  /** Per-state point-AADT config (required when source === "point_bbox"). */
  pointConfig?: PointBboxConfig;
  /** Display label for log lines + DATA_SOURCES.md (e.g. "TxDOT 2025"). */
  sourceLabel?: string;
  /**
   * Supplement mode: load the existing `<slug>-aadt.json`, snap ONLY signals
   * that have no record yet, and merge on write. Used for multi-state metros
   * where a second DOT covers the out-of-state side of the bbox (NJDOT for
   * new_york/philadelphia NJ suburbs, VDOT + MDOT-SHA for washington-dc) —
   * the primary DOT's records stay byte-identical. Run via --supplement-only
   * so the primary full-rebuild configs for the same slug don't re-run.
   */
  supplement?: boolean;
};

const REGIONS: RegionConfig[] = [
  { slug: "tampa", source: "fdot", counties: ["HILLSBOROUGH", "PINELLAS", "PASCO", "HERNANDO"] },
  { slug: "orlando", source: "fdot", counties: ["ORANGE", "SEMINOLE", "LAKE", "OSCEOLA"] },
  { slug: "miami-dade", source: "fdot", counties: ["MIAMI-DADE"] },
  { slug: "sarasota", source: "fdot", counties: ["SARASOTA", "MANATEE"] },
  { slug: "charlotte", source: "ncdot", counties: ["Mecklenburg", "Union", "Cabarrus", "Iredell", "Gaston", "Lincoln", "Rowan"] },
  { slug: "raleigh-durham", source: "ncdot", counties: ["Wake", "Durham", "Orange", "Chatham", "Franklin", "Johnston", "Granville", "Person", "Vance"] },
  {
    slug: "nashville",
    source: "tdot",
    // Nashville-Davidson-Murfreesboro-Franklin MSA: 14 counties.
    counties: ["Davidson", "Sumner", "Williamson", "Wilson", "Rutherford", "Robertson", "Maury", "Cheatham", "Dickson", "Smith", "Macon", "Trousdale", "Hickman", "Cannon"],
  },
  // ── Tier-1 (existing state DOTs) ────────────────────────────────────
  { slug: "jacksonville", source: "fdot", counties: ["DUVAL", "ST. JOHNS", "CLAY", "NASSAU", "BAKER"] },
  { slug: "memphis", source: "tdot", counties: ["Shelby", "Fayette", "Tipton"] },
  { slug: "knoxville", source: "tdot", counties: ["Knox", "Anderson", "Blount", "Loudon", "Roane", "Union", "Grainger", "Campbell", "Morgan", "Sevier"] },
  { slug: "chattanooga", source: "tdot", counties: ["Hamilton", "Marion", "Sequatchie"] },
  // Savannah uses GDOT — not yet wired. Falls back to synthetic baseline.
  { slug: "asheville", source: "ncdot", counties: ["Buncombe", "Henderson", "Haywood", "Madison"] },
  { slug: "wilmington", source: "ncdot", counties: ["New Hanover", "Brunswick", "Pender"] },
  { slug: "triad", source: "ncdot", counties: ["Guilford", "Forsyth", "Davidson", "Davie", "Randolph", "Rockingham", "Stokes", "Yadkin", "Surry"] },

  // ── Tier-2 (new state DOTs we found public datasets for) ────────────
  {
    slug: "hampton-roads",
    source: "vdot",
    counties: [], // VDOT layer has no county field — use bbox
    bbox: { latMin: 36.5, latMax: 37.6, lonMin: -77.1, lonMax: -75.9 },
  },
  {
    slug: "richmond",
    source: "vdot",
    counties: [],
    bbox: { latMin: 37.2, latMax: 38.0, lonMin: -78.1, lonMax: -77.0 },
  },
  {
    slug: "charleston-sc",
    source: "scdot",
    counties: ["Charleston", "Berkeley", "Dorchester"],
  },
  {
    slug: "columbia-sc",
    source: "scdot",
    counties: ["Richland", "Lexington", "Calhoun", "Fairfield", "Kershaw", "Saluda"],
  },
  {
    slug: "greenville-spartanburg",
    source: "scdot",
    counties: ["Greenville", "Spartanburg", "Pickens"],
  },
  // ── Tier-3 (metros where the state DOT pull works) ─────────────────
  { slug: "pensacola", source: "fdot", counties: ["ESCAMBIA", "SANTA ROSA"] },
  { slug: "fayetteville", source: "ncdot", counties: ["Cumberland", "Harnett", "Hoke"] },
  { slug: "greenville-nc", source: "ncdot", counties: ["Pitt"] },
  // Birmingham/Louisville/New Orleans + Tier-3 (Mobile, Huntsville, Lexington,
  // Augusta, Macon): no public state-DOT AADT found in reasonable time.
  // Launch with synthetic road-class baseline. Future option: scrape PDF
  // state traffic reports.

  // ── Tier-4: 8 confirmed-public endpoints (2026-05-27 deep-probe) ─────
  // Each uses the generic polyline_bbox or point_bbox handler with a
  // per-state config. NY/IL/MI/MN/WI deferred until URL probes complete.

  // TxDOT — 4 metros, polyline, AADT_CUR field
  ...(["houston", "dallas-fort-worth", "austin", "san-antonio"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "houston": { latMin: 29.3, latMax: 30.3, lonMin: -95.9, lonMax: -94.8 },
      "dallas-fort-worth": { latMin: 32.4, latMax: 33.4, lonMin: -97.6, lonMax: -96.4 },
      "austin": { latMin: 30.0, latMax: 30.7, lonMin: -98.1, lonMax: -97.3 },
      "san-antonio": { latMin: 29.2, latMax: 29.8, lonMin: -98.8, lonMax: -98.2 },
    };
    return [{
      slug,
      source: "polyline_bbox",
      counties: [],
      bbox: bboxes[slug],
      sourceLabel: "TxDOT current AADT",
      polylineConfig: {
        url: "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_AADT/FeatureServer/0",
        aadtField: "AADT_CUR",
        yearExtractor: { kind: "static", year: 2025 },
        snapM: 200,
        sourceTag: "txdot",
      },
    } as RegionConfig];
  })),

  // ODOT-OH — Cleveland, Columbus-OH, Cincinnati, polyline, AADT_TOTAL field
  ...(["cleveland", "columbus-oh", "cincinnati"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "cleveland": { latMin: 41.2, latMax: 41.7, lonMin: -82.1, lonMax: -81.3 },
      "columbus-oh": { latMin: 39.7, latMax: 40.3, lonMin: -83.3, lonMax: -82.6 },
      "cincinnati": { latMin: 38.8, latMax: 39.4, lonMin: -85.0, lonMax: -84.0 },
    };
    return [{
      slug,
      source: "polyline_bbox",
      counties: [],
      bbox: bboxes[slug],
      sourceLabel: "ODOT 2024 traffic counts",
      polylineConfig: {
        url: "https://tims.dot.state.oh.us/ags/rest/services/Roadway_Information/Traffic_Count_Segments/MapServer/0",
        aadtField: "AADT_TOTAL",
        yearExtractor: { kind: "field_int", field: "AADT_YEAR" },
        snapM: 200,
        sourceTag: "odot_ok",
      },
    } as RegionConfig];
  })),

  // PennDOT — Philadelphia + Pittsburgh, polyline, CUR_AADT field
  ...(["philadelphia", "pittsburgh"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "philadelphia": { latMin: 39.7, latMax: 40.3, lonMin: -75.6, lonMax: -74.7 },
      "pittsburgh": { latMin: 40.2, latMax: 40.7, lonMin: -80.3, lonMax: -79.6 },
    };
    return [{
      slug,
      source: "polyline_bbox",
      counties: [],
      bbox: bboxes[slug],
      sourceLabel: "PennDOT RMS AADT",
      polylineConfig: {
        url: "https://gis.penndot.gov/arcgis/rest/services/opendata/roadwaytraffic/MapServer/0",
        aadtField: "CUR_AADT",
        yearExtractor: { kind: "field_int", field: "BASE_ADT_YR" },
        snapM: 200,
        sourceTag: "penndot",
      },
    } as RegionConfig];
  })),

  // MassDOT — Boston, polyline, AADT field (filter to >= 2018 fresh)
  {
    slug: "boston",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 42.0, latMax: 42.7, lonMin: -71.6, lonMax: -70.8 },
    sourceLabel: "MassDOT 2024 Traffic Inventory",
    polylineConfig: {
      url: "https://gis.massdot.state.ma.us/arcgis/rest/services/Roads/TrafficInventoryYearEnd/FeatureServer/1",
      aadtField: "AADT",
      yearExtractor: { kind: "field_int", field: "AADT_Year" },
      snapM: 200,
      sourceTag: "massdot",
      extraWhere: "AADT_Year >= 2018",
    },
  },

  // INDOT — Indianapolis, polyline, AADT field
  {
    slug: "indianapolis",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 39.5, latMax: 40.1, lonMin: -86.5, lonMax: -85.8 },
    sourceLabel: "INDOT 2021 AADT",
    polylineConfig: {
      url: "https://gis.indot.in.gov/ro/rest/services/DOT/RO_RandH_Organization_Default/FeatureServer/110",
      aadtField: "AADT",
      yearExtractor: { kind: "field_int", field: "HPMS_YEAR" },
      snapM: 200,
      sourceTag: "indot",
    },
  },

  // MoDOT — St Louis + Kansas City, polyline (using North-direction layer 1
  // since AADT field is direction-specific; segments are duplicated across
  // 4 directional sublayers but North alone gives full coverage for snapping).
  ...(["st-louis", "kansas-city"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "st-louis": { latMin: 38.4, latMax: 38.9, lonMin: -90.7, lonMax: -89.9 },
      "kansas-city": { latMin: 38.8, latMax: 39.5, lonMin: -94.9, lonMax: -94.3 },
    };
    return [{
      slug,
      source: "polyline_bbox",
      counties: [],
      bbox: bboxes[slug],
      sourceLabel: "MoDOT directional AADT",
      polylineConfig: {
        url: "https://mapping.modot.mo.gov/arcgis/rest/services/BusinessInt/TrafficInfoSegAADT/MapServer/1",
        aadtField: "AADT",
        yearExtractor: { kind: "field_int", field: "AADT_YEAR" },
        snapM: 200,
        sourceTag: "modot",
      },
    } as RegionConfig];
  })),

  // MDOT-SHA — Baltimore, polyline (Layer 1 has 10k+ segments with AADT)
  {
    slug: "baltimore",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 39.0, latMax: 39.6, lonMin: -77.0, lonMax: -76.3 },
    sourceLabel: "MDOT-SHA 2023 AADT segments",
    polylineConfig: {
      url: "https://services.arcgis.com/njFNhDsUCentVYJW/ArcGIS/rest/services/MDOT_SHA_Annual_Average_Daily_Traffic/FeatureServer/1",
      aadtField: "AADT",
      yearExtractor: { kind: "static", year: 2023 },
      snapM: 200,
      sourceTag: "mdot_md",
    },
  },

  // DDOT-DC — Washington DC, polyline (2023 layer = MapServer/4)
  {
    slug: "washington-dc",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 38.7, latMax: 39.1, lonMin: -77.4, lonMax: -76.8 },
    sourceLabel: "DDOT 2023 AADT",
    polylineConfig: {
      url: "https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Transportation_TrafficVolume_WebMercator/MapServer/4",
      aadtField: "AADT",
      yearExtractor: { kind: "field_int", field: "AADT_YEAR" },
      snapM: 200,
      sourceTag: "ddot_dc",
    },
  },

  // ── Tier-5: 8 confirmed-public endpoints ─────────────────────────────

  // Caltrans — 6 CA metros, point with BACK_AADT + AHEAD_AADT
  ...(["los-angeles", "sf-bay", "san-diego", "sacramento", "inland-empire", "fresno"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "los-angeles": { latMin: 33.4, latMax: 34.5, lonMin: -118.95, lonMax: -117.7 },
      "sf-bay": { latMin: 37.2, latMax: 38.1, lonMin: -122.6, lonMax: -121.6 },
      "san-diego": { latMin: 32.5, latMax: 33.5, lonMin: -117.6, lonMax: -116.6 },
      "sacramento": { latMin: 38.3, latMax: 39.0, lonMin: -121.8, lonMax: -120.9 },
      "inland-empire": { latMin: 33.4, latMax: 34.5, lonMin: -117.7, lonMax: -116.0 },
      "fresno": { latMin: 36.5, latMax: 37.1, lonMin: -120.0, lonMax: -119.2 },
    };
    return [{
      slug,
      source: "point_bbox",
      counties: [],
      bbox: bboxes[slug],
      sourceLabel: "Caltrans 2023 Traffic Census",
      pointConfig: {
        url: "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Traffic_AADT/FeatureServer/0",
        aadtField: "AHEAD_AADT",
        aadtFieldAlt: "BACK_AADT",
        yearExtractor: { kind: "static", year: 2023 },
        snapM: 400,  // postmile-anchored points are sparser than NCDOT stations
        sourceTag: "caltrans",
      },
    } as RegionConfig];
  })),

  // ODOT-OR — Portland, polyline layer 159 (Traffic Flow AADT)
  {
    slug: "portland",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 45.2, latMax: 45.8, lonMin: -123.1, lonMax: -122.3 },
    sourceLabel: "ODOT-OR 2024 Traffic Flow",
    polylineConfig: {
      url: "https://gis.odot.state.or.us/arcgis1006/rest/services/transgis/catalog/MapServer/159",
      aadtField: "AADT",
      yearExtractor: { kind: "static", year: 2024 },
      snapM: 200,
      sourceTag: "odot_or",
    },
  },

  // WSDOT — Seattle, polyline (Traffic Sections layer 1)
  {
    slug: "seattle",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 47.1, latMax: 47.9, lonMin: -122.6, lonMax: -121.8 },
    sourceLabel: "WSDOT 2024 Traffic Sections",
    polylineConfig: {
      url: "https://data.wsdot.wa.gov/arcgis/rest/services/Shared/TrafficData/FeatureServer/1",
      aadtField: "AADT",
      yearExtractor: { kind: "field_int", field: "ReportingYear" },
      snapM: 200,
      sourceTag: "wsdot",
    },
  },

  // NDOT-NV — Las Vegas, point stations with wide year cols
  {
    slug: "las-vegas",
    source: "point_bbox",
    counties: [],
    bbox: { latMin: 35.9, latMax: 36.4, lonMin: -115.5, lonMax: -114.9 },
    sourceLabel: "NDOT TRINA 2024 AADT",
    pointConfig: {
      url: "https://gis.dot.nv.gov/arcgis/rest/services/Applications/TRINA/FeatureServer/1",
      aadtField: "AADT_2024",
      yearExtractor: { kind: "static", year: 2024 },
      snapM: 500,
      sourceTag: "nvdot",
      extraWhere: "Visible = 'Y'",
    },
  },

  // ADOT — Phoenix + Tucson, polyline
  ...(["phoenix", "tucson"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "phoenix": { latMin: 33.2, latMax: 33.9, lonMin: -112.6, lonMax: -111.5 },
      "tucson": { latMin: 31.9, latMax: 32.5, lonMin: -111.2, lonMax: -110.6 },
    };
    return [{
      slug,
      source: "polyline_bbox",
      counties: [],
      bbox: bboxes[slug],
      sourceLabel: "ADOT 2024 AADT",
      polylineConfig: {
        url: "https://services6.arcgis.com/clPWQMwZfdWn4MQZ/arcgis/rest/services/ADOT_2024_Average_Annual_Daily_Traffic_(AADT)/FeatureServer/0",
        aadtField: "AADT",
        yearExtractor: { kind: "field_int", field: "SubmittalYear" },
        snapM: 200,
        sourceTag: "adot",
      },
    } as RegionConfig];
  })),

  // CDOT-CO — Denver, point stations
  {
    slug: "denver",
    source: "point_bbox",
    counties: [],
    bbox: { latMin: 39.4, latMax: 40.0, lonMin: -105.4, lonMax: -104.6 },
    sourceLabel: "CDOT-CO OTIS 2024 Traffic Stations",
    pointConfig: {
      url: "https://dtdapps.coloradodot.info/arcgis/rest/services/OTIS/TrafficExplorer/MapServer/0",
      aadtField: "AADT",
      yearExtractor: { kind: "field_int", field: "AADTYR" },
      snapM: 500,
      sourceTag: "cdot_co",
    },
  },

  // UDOT — Salt Lake City, polyline, wide year cols (use AADT2024)
  {
    slug: "salt-lake-city",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 40.4, latMax: 41.0, lonMin: -112.2, lonMax: -111.6 },
    sourceLabel: "UDOT 2024 AADT",
    polylineConfig: {
      url: "https://services.arcgis.com/pA2nEVnB6tquxgOW/arcgis/rest/services/AADT2024_Unrounded/FeatureServer/3",
      aadtField: "AADT2024",
      yearExtractor: { kind: "static", year: 2024 },
      snapM: 200,
      sourceTag: "udot",
    },
  },

  // NMDOT — Albuquerque, polyline (filter out LOC* county-average routes)
  {
    slug: "albuquerque",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 34.9, latMax: 35.4, lonMin: -107.0, lonMax: -106.3 },
    sourceLabel: "NMDOT 2024 HPMS Traffic Sections",
    polylineConfig: {
      url: "https://services.arcgis.com/hOpd7wfnKm16p9D9/arcgis/rest/services/Traffic_Section_HPMS_2025_Submittal_of_2024_Data/FeatureServer/0",
      aadtField: "AADT",
      yearExtractor: { kind: "field_int", field: "AADTYear" },
      snapM: 200,
      sourceTag: "nmdot",
      extraWhere: "RouteID NOT LIKE 'LOC%'",
    },
  },

  // ── Final Tier-4 batch (IL/MI/MN/WI/NY, probed 2026-05-27 second round) ──

  // IDOT — Chicago, polyline layer 2025 (current snapshot, mixed AADT_YR vintages)
  {
    slug: "chicago",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 41.5, latMax: 42.3, lonMin: -88.5, lonMax: -87.4 },
    sourceLabel: "IDOT 2025 AADT snapshot",
    polylineConfig: {
      url: "https://gis1.dot.illinois.gov/arcgis/rest/services/AdministrativeData/AADT_Historical/FeatureServer/2025",
      aadtField: "AADT",
      yearExtractor: { kind: "field_int", field: "AADT_YR" },
      snapM: 200,
      sourceTag: "idot",
    },
  },

  // MDOT-MI — Detroit, polyline (single layer, AADT + AadtCommercial cols)
  {
    slug: "detroit",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 42.0, latMax: 42.7, lonMin: -83.5, lonMax: -82.7 },
    sourceLabel: "MDOT-MI 2023 Traffic Volumes",
    polylineConfig: {
      url: "https://mdotgis.state.mi.us/arcgis/rest/services/DataAccess/MdotAadtCaadt2023/FeatureServer/0",
      aadtField: "Aadt",
      yearExtractor: { kind: "static", year: 2023 },
      snapM: 200,
      sourceTag: "mdot_mi",
    },
  },

  // MnDOT — Twin Cities, polyline (CURRENT_VOLUME + CURRENT_YEAR)
  {
    slug: "twin-cities",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 44.7, latMax: 45.3, lonMin: -93.7, lonMax: -92.8 },
    sourceLabel: "MnDOT current AADT segments",
    polylineConfig: {
      url: "https://webgis.dot.state.mn.us/65agsf1/rest/services/sdw_incdt/AADT_SEGMENT_CURRENT/FeatureServer/0",
      aadtField: "CURRENT_VOLUME",
      yearExtractor: { kind: "field_int", field: "CURRENT_YEAR" },
      snapM: 200,
      sourceTag: "mndot",
    },
  },

  // WisDOT — Milwaukee, point stations (mixed-vintage per AADT_RPTG_YR)
  {
    slug: "milwaukee",
    source: "point_bbox",
    counties: [],
    bbox: { latMin: 42.8, latMax: 43.4, lonMin: -88.3, lonMax: -87.7 },
    sourceLabel: "WisDOT Traffic Counts",
    pointConfig: {
      url: "https://dotmaps.wi.gov/arcgis/rest/services/agohub/TRAFFIC_COUNTS/MapServer/0",
      aadtField: "RDWY_AADT",
      yearExtractor: { kind: "field_int", field: "AADT_RPTG_YR" },
      snapM: 500,
      sourceTag: "wisdot",
    },
  },

  // NYSDOT — New York, polyline (use AADTLastAct + YearLastAct for per-segment freshness)
  {
    slug: "new-york",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 40.4, latMax: 41.3, lonMin: -74.5, lonMax: -73.4 },
    sourceLabel: "NYSDOT Traffic Monitoring (per-segment latest)",
    polylineConfig: {
      url: "https://gisportalny.dot.ny.gov/hostingny/rest/services/Roadways/Traffic_Monitoring/FeatureServer/1",
      aadtField: "AADTLastAct",
      yearExtractor: { kind: "field_int", field: "YearLastAct" },
      snapM: 200,
      sourceTag: "nysdot",
    },
  },

  // ── Tier-6 AADT wiring (16 of 21 metros — RI/MS/AR/WY are dark) ──

  // CTDOT — Hartford, polyline
  {
    slug: "hartford",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 41.6, latMax: 42.0, lonMin: -73.0, lonMax: -72.5 },
    sourceLabel: "CTDOT Traffic Monitoring AADT",
    polylineConfig: {
      url: "https://services1.arcgis.com/FCaUeJ5SOVtImake/arcgis/rest/services/CTDOT_Traffic_Monitoring_Data/FeatureServer/1",
      aadtField: "AADT_AADT_VALUE",
      yearExtractor: { kind: "field_int", field: "AADT_AADT_YEAR" },
      snapM: 200,
      sourceTag: "ctdot",
    },
  },

  // NHDOT — Manchester, polyline (HPMS 2024)
  {
    slug: "manchester",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 42.7, latMax: 43.2, lonMin: -71.7, lonMax: -71.3 },
    sourceLabel: "NHDOT HPMS 2024 AADT",
    polylineConfig: {
      url: "https://maps.dot.nh.gov/arcgis_server/rest/services/Highways/NHDOT_ROUTES_Annual/MapServer/2",
      aadtField: "AADT_FOR_SUMMARY",
      yearExtractor: { kind: "field_int", field: "AADT_YEAR" },
      snapM: 200,
      sourceTag: "nhdot",
    },
  },

  // VTrans — Burlington VT, polyline layer 1 (AADT Other, 2,572 features)
  {
    slug: "burlington-vt",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 44.3, latMax: 44.6, lonMin: -73.4, lonMax: -73.1 },
    sourceLabel: "VTrans 2024 AADT",
    polylineConfig: {
      url: "https://maps.vtrans.vermont.gov/arcgis/rest/services/Layers/AADT/FeatureServer/1",
      aadtField: "AADT",
      yearExtractor: { kind: "field_int", field: "Year" },
      snapM: 200,
      sourceTag: "vtrans",
    },
  },

  // MaineDOT — Portland ME, polyline (Dynamic MapServer layer 806)
  {
    slug: "portland-me",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 43.5, latMax: 43.9, lonMin: -70.5, lonMax: -70.0 },
    sourceLabel: "MaineDOT AADT",
    polylineConfig: {
      url: "https://arcgisserver.maine.gov/arcgis/rest/services/mdot/MaineDOT_Dynamic/MapServer/806",
      aadtField: "aadt",
      yearExtractor: { kind: "field_int", field: "aadtyrcnt" },
      snapM: 200,
      sourceTag: "medot",
    },
  },

  // NJDOT — Trenton, polyline (CURRENT_AA + CURRENT_YE)
  {
    slug: "trenton",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 40.1, latMax: 40.5, lonMin: -74.9, lonMax: -74.5 },
    sourceLabel: "NJDOT current AADT",
    polylineConfig: {
      url: "https://services.arcgis.com/HggmsDF7UJsNN1FK/arcgis/rest/services/New_jersey_Annual_Average_Daily_Traffic_2017/FeatureServer/0",
      aadtField: "CURRENT_AA",
      yearExtractor: { kind: "field_int", field: "CURRENT_YE" },
      snapM: 200,
      sourceTag: "njdot",
    },
  },

  // ── Multi-state metro SUPPLEMENTS (2026-07-30 northeast coverage fix) ──
  // These fill AADT for the out-of-state signals appended by
  // extend-region-signals.ts. Run with --supplement-only so the primary
  // full-rebuild configs for the same slugs don't re-run. Each pass only
  // touches signals with no existing record, so primary-DOT records stay
  // byte-identical and pass order (array order) fills gaps progressively.
  {
    // NJ side of the NYC MSA (Bergen/Essex/Union/Hudson/Middlesex/Monmouth).
    slug: "new-york",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 40.2, latMax: 41.2, lonMin: -74.5, lonMax: -73.4 },
    sourceLabel: "NJDOT current AADT (NYC-MSA supplement)",
    supplement: true,
    polylineConfig: {
      url: "https://services.arcgis.com/HggmsDF7UJsNN1FK/arcgis/rest/services/New_jersey_Annual_Average_Daily_Traffic_2017/FeatureServer/0",
      aadtField: "CURRENT_AA",
      yearExtractor: { kind: "field_int", field: "CURRENT_YE" },
      snapM: 200,
      sourceTag: "njdot",
    },
  },
  {
    // NY-side signals appended since the 2026-05 PBF snapshot (OSM churn).
    slug: "new-york",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 40.2, latMax: 41.2, lonMin: -74.5, lonMax: -73.4 },
    sourceLabel: "NYSDOT Traffic Monitoring (appended-signal supplement)",
    supplement: true,
    polylineConfig: {
      url: "https://gisportalny.dot.ny.gov/hostingny/rest/services/Roadways/Traffic_Monitoring/FeatureServer/1",
      aadtField: "AADTLastAct",
      yearExtractor: { kind: "field_int", field: "YearLastAct" },
      snapM: 200,
      sourceTag: "nysdot",
    },
  },
  {
    // South Jersey side of the Philadelphia MSA (Camden/Cherry Hill/Deptford).
    slug: "philadelphia",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 39.7, latMax: 40.4, lonMin: -75.5, lonMax: -74.95 },
    sourceLabel: "NJDOT current AADT (Philly-MSA supplement)",
    supplement: true,
    polylineConfig: {
      url: "https://services.arcgis.com/HggmsDF7UJsNN1FK/arcgis/rest/services/New_jersey_Annual_Average_Daily_Traffic_2017/FeatureServer/0",
      aadtField: "CURRENT_AA",
      yearExtractor: { kind: "field_int", field: "CURRENT_YE" },
      snapM: 200,
      sourceTag: "njdot",
    },
  },
  {
    // NoVA side of the DC MSA (Fairfax/Loudoun/Prince William). VDOT layer
    // only carries VA geometry, so the full DC bbox is safe.
    slug: "washington-dc",
    source: "vdot",
    counties: [],
    bbox: { latMin: 38.6, latMax: 39.2, lonMin: -77.6, lonMax: -76.7 },
    supplement: true,
  },
  {
    // Suburban-MD side of the DC MSA (Montgomery/PG). Same MDOT-SHA layer
    // as the baltimore config; runs after the VDOT pass (array order).
    slug: "washington-dc",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 38.6, latMax: 39.2, lonMin: -77.6, lonMax: -76.7 },
    sourceLabel: "MDOT-SHA 2023 AADT (DC-MSA supplement)",
    supplement: true,
    polylineConfig: {
      url: "https://services.arcgis.com/njFNhDsUCentVYJW/ArcGIS/rest/services/MDOT_SHA_Annual_Average_Daily_Traffic/FeatureServer/1",
      aadtField: "AADT",
      yearExtractor: { kind: "static", year: 2023 },
      snapM: 200,
      sourceTag: "mdot_md",
    },
  },

  // WVDOT — Charleston WV, polyline (layer 2 = Segment AADT, 41k features)
  {
    slug: "charleston-wv",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 38.2, latMax: 38.5, lonMin: -81.8, lonMax: -81.4 },
    sourceLabel: "WVDOT Segment AADT",
    polylineConfig: {
      url: "https://gis.transportation.wv.gov/arcgis/rest/services/Projects/AADT/FeatureServer/2",
      aadtField: "Value_Nume",
      yearExtractor: { kind: "field_int", field: "Year_Recor" },
      snapM: 200,
      sourceTag: "wvdot",
    },
  },

  // ODOT-OK — OKC + Tulsa, polyline AADT_Network
  ...(["oklahoma-city", "tulsa"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "oklahoma-city": { latMin: 35.2, latMax: 35.7, lonMin: -97.8, lonMax: -97.2 },
      "tulsa": { latMin: 35.9, latMax: 36.3, lonMin: -96.2, lonMax: -95.7 },
    };
    return [{
      slug,
      source: "polyline_bbox",
      counties: [],
      bbox: bboxes[slug],
      sourceLabel: "ODOT-OK AADT Network",
      polylineConfig: {
        url: "https://services6.arcgis.com/RBtoEUQ2lmN0K3GY/arcgis/rest/services/AADT_Network/FeatureServer/0",
        aadtField: "AADT",
        yearExtractor: { kind: "field_int", field: "AADT_YEAR" },
        snapM: 200,
        sourceTag: "odot_ok",
      },
    } as RegionConfig];
  })),

  // Iowa DOT — Des Moines, polyline (RAMS Road Network, 359k segments)
  {
    slug: "des-moines",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 41.4, latMax: 41.8, lonMin: -94.0, lonMax: -93.4 },
    sourceLabel: "Iowa DOT RAMS AADT",
    polylineConfig: {
      url: "https://gis.iowadot.gov/agshost/rest/services/RAMS/Road_Network/FeatureServer/0",
      aadtField: "AADT",
      yearExtractor: { kind: "field_int", field: "AADT_YEAR" },
      snapM: 200,
      sourceTag: "iadot",
    },
  },

  // Nebraska DOT — Omaha, point stations
  {
    slug: "omaha",
    source: "point_bbox",
    counties: [],
    bbox: { latMin: 41.0, latMax: 41.5, lonMin: -96.3, lonMax: -95.7 },
    sourceLabel: "Nebraska DOT AADT Points",
    pointConfig: {
      url: "https://gis.ne.gov/Enterprise/rest/services/AnnualAverageDailyTraffic/FeatureServer/0",
      aadtField: "ADJ_ADT_TOT_NUM",
      yearExtractor: { kind: "field_int", field: "ADT_YEAR" },
      snapM: 500,
      sourceTag: "ndor",
    },
  },

  // KSDOT — Wichita, polyline (state-system only; expect lower coverage)
  {
    slug: "wichita",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 37.5, latMax: 37.9, lonMin: -97.6, lonMax: -97.0 },
    sourceLabel: "KSDOT AADT Flow Map (state-system)",
    polylineConfig: {
      url: "https://kanplan.ksdot.gov/arcgis_web_adaptor/rest/services/Transportation/AADT_Flow_Map/FeatureServer/0",
      aadtField: "AADTCount",
      yearExtractor: { kind: "field_int", field: "AADTCountYear" },
      snapM: 200,
      sourceTag: "ksdot",
    },
  },

  // NDDOT — Fargo, point stations
  {
    slug: "fargo",
    source: "point_bbox",
    counties: [],
    bbox: { latMin: 46.7, latMax: 47.1, lonMin: -97.1, lonMax: -96.7 },
    sourceLabel: "NDDOT Traffic Counts",
    pointConfig: {
      url: "https://gis.dot.nd.gov/ArcGIS/rest/services/external/Public_TrafficCounts/FeatureServer/0",
      aadtField: "AVE_DAILY_TRAFFIC_1",
      yearExtractor: { kind: "field_int", field: "YEAR_COUNTED_1" },
      snapM: 500,
      sourceTag: "nddot",
    },
  },

  // SDDOT — Sioux Falls, polyline (state-trunk only; expect very low coverage)
  {
    slug: "sioux-falls",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 43.4, latMax: 43.7, lonMin: -96.9, lonMax: -96.5 },
    sourceLabel: "SDDOT State Trunk AADT (2021)",
    polylineConfig: {
      url: "https://sdgis.sd.gov/dot/rest/services/TIM/HR49_GisADT/FeatureServer/0",
      aadtField: "Adt01Nbr",
      yearExtractor: { kind: "static", year: 2021 },
      snapM: 200,
      sourceTag: "sddot",
    },
  },

  // ITD — Boise, polyline (LRS-based statewide AADT)
  {
    slug: "boise",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 43.4, latMax: 43.8, lonMin: -116.5, lonMax: -115.9 },
    sourceLabel: "ITD LRS AADT",
    polylineConfig: {
      url: "https://gisportalp.itd.idaho.gov/lrs/rest/services/RHGeneralService/FeatureServer/1",
      aadtField: "AADT",
      yearExtractor: { kind: "field_int", field: "AADTYear" },
      snapM: 200,
      sourceTag: "itd",
    },
  },

  // MDT — Billings, point stations (wide-year-cols: AADT_25 = 2025)
  {
    slug: "billings",
    source: "point_bbox",
    counties: [],
    bbox: { latMin: 45.6, latMax: 45.9, lonMin: -108.7, lonMax: -108.3 },
    sourceLabel: "MDT 2025 AADT Counts",
    pointConfig: {
      url: "https://gis.mtmdt.us/server/rest/services/MDTGIS/Traffic/MapServer/2",
      aadtField: "AADT_25",
      yearExtractor: { kind: "static", year: 2025 },
      snapM: 500,
      sourceTag: "mdt",
    },
  },

  // AKDOT&PF — Anchorage, polyline (TrafficLinks)
  {
    slug: "anchorage",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 61.1, latMax: 61.3, lonMin: -150.0, lonMax: -149.5 },
    sourceLabel: "AKDOT TrafficLinks AADT",
    polylineConfig: {
      url: "https://services.arcgis.com/r4A0V7UzH9fcLVvv/arcgis/rest/services/AKDOT_TrafficLinks_service/FeatureServer/0",
      aadtField: "AADT",
      yearExtractor: { kind: "field_int", field: "AADT_Year" },
      snapM: 200,
      sourceTag: "akdot",
    },
  },

  // HIDOT — Honolulu, polyline (HPMS 2024)
  {
    slug: "honolulu",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 21.2, latMax: 21.5, lonMin: -158.0, lonMax: -157.7 },
    sourceLabel: "HIDOT HPMS 2024 Traffic Volume",
    polylineConfig: {
      url: "https://services.arcgis.com/HQ0xoN0EzDPBOEci/arcgis/rest/services/Traffic_Volume_HPMS_2024/FeatureServer/0",
      aadtField: "aadt",
      yearExtractor: { kind: "field_int", field: "year_record" },
      snapM: 200,
      sourceTag: "hidot",
    },
  },

  // ── Tier-7 AADT wiring (55 secondary metros — reuse parent-state configs with new bboxes) ──

  // NYSDOT (4)
  ...(["rochester-ny", "buffalo", "syracuse", "albany"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "rochester-ny": { latMin: 43.0, latMax: 43.3, lonMin: -78.0, lonMax: -77.4 },
      "buffalo": { latMin: 42.7, latMax: 43.1, lonMin: -79.0, lonMax: -78.5 },
      "syracuse": { latMin: 42.9, latMax: 43.2, lonMin: -76.3, lonMax: -75.9 },
      "albany": { latMin: 42.5, latMax: 42.9, lonMin: -74.0, lonMax: -73.6 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "NYSDOT Traffic Monitoring", polylineConfig: { url: "https://gisportalny.dot.ny.gov/hostingny/rest/services/Roadways/Traffic_Monitoring/FeatureServer/1", aadtField: "AADTLastAct", yearExtractor: { kind: "field_int", field: "YearLastAct" }, snapM: 200, sourceTag: "nysdot" } } as RegionConfig];
  })),

  // ODOT-OH (4)
  ...(["toledo", "akron", "dayton", "youngstown"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "toledo": { latMin: 41.5, latMax: 41.8, lonMin: -84.0, lonMax: -83.4 },
      "akron": { latMin: 41.0, latMax: 41.2, lonMin: -81.7, lonMax: -81.3 },
      "dayton": { latMin: 39.6, latMax: 40.0, lonMin: -84.3, lonMax: -83.9 },
      "youngstown": { latMin: 41.0, latMax: 41.3, lonMin: -80.9, lonMax: -80.5 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "ODOT 2024 Traffic Count Segments", polylineConfig: { url: "https://tims.dot.state.oh.us/ags/rest/services/Roadway_Information/Traffic_Count_Segments/MapServer/0", aadtField: "AADT_TOTAL", yearExtractor: { kind: "field_int", field: "AADT_YEAR" }, snapM: 200, sourceTag: "odot_oh" } } as RegionConfig];
  })),

  // MDOT-MI (4)
  ...(["grand-rapids", "lansing", "ann-arbor", "flint"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "grand-rapids": { latMin: 42.8, latMax: 43.1, lonMin: -85.9, lonMax: -85.4 },
      "lansing": { latMin: 42.6, latMax: 42.9, lonMin: -84.7, lonMax: -84.3 },
      "ann-arbor": { latMin: 42.2, latMax: 42.4, lonMin: -83.9, lonMax: -83.6 },
      "flint": { latMin: 42.9, latMax: 43.2, lonMin: -83.9, lonMax: -83.5 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "MDOT-MI 2023 Traffic Volumes", polylineConfig: { url: "https://mdotgis.state.mi.us/arcgis/rest/services/DataAccess/MdotAadtCaadt2023/FeatureServer/0", aadtField: "Aadt", yearExtractor: { kind: "static", year: 2023 }, snapM: 200, sourceTag: "mdot_mi" } } as RegionConfig];
  })),

  // PennDOT (4)
  ...(["allentown", "harrisburg", "scranton", "erie"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "allentown": { latMin: 40.5, latMax: 40.8, lonMin: -75.7, lonMax: -75.2 },
      "harrisburg": { latMin: 40.1, latMax: 40.4, lonMin: -77.0, lonMax: -76.6 },
      "scranton": { latMin: 41.3, latMax: 41.6, lonMin: -75.9, lonMax: -75.4 },
      "erie": { latMin: 42.0, latMax: 42.2, lonMin: -80.3, lonMax: -79.9 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "PennDOT RMS Traffic Volumes", polylineConfig: { url: "https://gis.penndot.gov/arcgis/rest/services/opendata/roadwaytraffic/MapServer/0", aadtField: "CUR_AADT", yearExtractor: { kind: "field_int", field: "BASE_ADT_YR" }, snapM: 200, sourceTag: "penndot" } } as RegionConfig];
  })),

  // MassDOT (2)
  ...(["worcester", "springfield-ma"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "worcester": { latMin: 42.1, latMax: 42.5, lonMin: -72.0, lonMax: -71.6 },
      "springfield-ma": { latMin: 42.0, latMax: 42.2, lonMin: -72.8, lonMax: -72.4 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "MassDOT 2024 Traffic Inventory", polylineConfig: { url: "https://gis.massdot.state.ma.us/arcgis/rest/services/Roads/TrafficInventoryYearEnd/FeatureServer/1", aadtField: "AADT", yearExtractor: { kind: "field_int", field: "AADT_Year" }, snapM: 200, sourceTag: "massdot", extraWhere: "AADT_Year >= 2018" } } as RegionConfig];
  })),

  // CTDOT (2)
  ...(["new-haven", "bridgeport"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "new-haven": { latMin: 41.2, latMax: 41.4, lonMin: -73.1, lonMax: -72.8 },
      "bridgeport": { latMin: 41.0, latMax: 41.3, lonMin: -73.6, lonMax: -73.0 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "CTDOT Traffic Monitoring", polylineConfig: { url: "https://services1.arcgis.com/FCaUeJ5SOVtImake/arcgis/rest/services/CTDOT_Traffic_Monitoring_Data/FeatureServer/1", aadtField: "AADT_AADT_VALUE", yearExtractor: { kind: "field_int", field: "AADT_AADT_YEAR" }, snapM: 200, sourceTag: "ctdot" } } as RegionConfig];
  })),

  // INDOT (3)
  ...(["fort-wayne", "south-bend", "evansville"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "fort-wayne": { latMin: 40.9, latMax: 41.2, lonMin: -85.4, lonMax: -85.0 },
      "south-bend": { latMin: 41.5, latMax: 41.8, lonMin: -86.4, lonMax: -86.0 },
      "evansville": { latMin: 37.8, latMax: 38.2, lonMin: -87.8, lonMax: -87.3 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "INDOT 2021 AADT", polylineConfig: { url: "https://gis.indot.in.gov/ro/rest/services/DOT/RO_RandH_Organization_Default/FeatureServer/110", aadtField: "AADT", yearExtractor: { kind: "field_int", field: "HPMS_YEAR" }, snapM: 200, sourceTag: "indot" } } as RegionConfig];
  })),

  // WisDOT (2)
  ...(["madison", "green-bay"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "madison": { latMin: 43.0, latMax: 43.2, lonMin: -89.6, lonMax: -89.2 },
      "green-bay": { latMin: 44.4, latMax: 44.6, lonMin: -88.2, lonMax: -87.8 },
    };
    return [{ slug, source: "point_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "WisDOT Traffic Counts", pointConfig: { url: "https://dotmaps.wi.gov/arcgis/rest/services/agohub/TRAFFIC_COUNTS/MapServer/0", aadtField: "RDWY_AADT", yearExtractor: { kind: "field_int", field: "AADT_RPTG_YR" }, snapM: 500, sourceTag: "wisdot" } } as RegionConfig];
  })),

  // IDOT (4)
  ...(["springfield-il", "rockford", "peoria", "champaign"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "springfield-il": { latMin: 39.6, latMax: 39.9, lonMin: -89.8, lonMax: -89.5 },
      "rockford": { latMin: 42.1, latMax: 42.4, lonMin: -89.2, lonMax: -88.8 },
      "peoria": { latMin: 40.5, latMax: 40.9, lonMin: -89.8, lonMax: -89.3 },
      "champaign": { latMin: 40.0, latMax: 40.2, lonMin: -88.4, lonMax: -88.1 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "IDOT 2025 AADT", polylineConfig: { url: "https://gis1.dot.illinois.gov/arcgis/rest/services/AdministrativeData/AADT_Historical/FeatureServer/2025", aadtField: "AADT", yearExtractor: { kind: "field_int", field: "AADT_YR" }, snapM: 200, sourceTag: "idot" } } as RegionConfig];
  })),

  // TxDOT (4)
  ...(["el-paso", "corpus-christi", "lubbock", "mcallen"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "el-paso": { latMin: 31.6, latMax: 31.9, lonMin: -106.6, lonMax: -106.2 },
      "corpus-christi": { latMin: 27.6, latMax: 28.0, lonMin: -97.6, lonMax: -97.2 },
      "lubbock": { latMin: 33.4, latMax: 33.7, lonMin: -102.0, lonMax: -101.7 },
      "mcallen": { latMin: 26.0, latMax: 26.4, lonMin: -98.4, lonMax: -97.9 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "TxDOT current AADT", polylineConfig: { url: "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_AADT/FeatureServer/0", aadtField: "AADT_CUR", yearExtractor: { kind: "static", year: 2025 }, snapM: 200, sourceTag: "txdot" } } as RegionConfig];
  })),

  // Caltrans (4) — state highways only, expect ~20-30%
  ...(["bakersfield", "stockton", "modesto", "oxnard"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "bakersfield": { latMin: 35.2, latMax: 35.5, lonMin: -119.2, lonMax: -118.9 },
      "stockton": { latMin: 37.8, latMax: 38.2, lonMin: -121.5, lonMax: -121.1 },
      "modesto": { latMin: 37.5, latMax: 37.8, lonMin: -121.2, lonMax: -120.8 },
      "oxnard": { latMin: 34.1, latMax: 34.5, lonMin: -119.5, lonMax: -118.7 },
    };
    return [{ slug, source: "point_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "Caltrans 2023 Traffic Census", pointConfig: { url: "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Traffic_AADT/FeatureServer/0", aadtField: "AHEAD_AADT", aadtFieldAlt: "BACK_AADT", yearExtractor: { kind: "static", year: 2023 }, snapM: 400, sourceTag: "caltrans" } } as RegionConfig];
  })),

  // CDOT-CO (2)
  ...(["colorado-springs", "fort-collins"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "colorado-springs": { latMin: 38.7, latMax: 39.0, lonMin: -104.9, lonMax: -104.6 },
      "fort-collins": { latMin: 40.4, latMax: 40.7, lonMin: -105.2, lonMax: -104.9 },
    };
    return [{ slug, source: "point_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "CDOT-CO OTIS 2024 Traffic Stations", pointConfig: { url: "https://dtdapps.coloradodot.info/arcgis/rest/services/OTIS/TrafficExplorer/MapServer/0", aadtField: "AADT", yearExtractor: { kind: "field_int", field: "AADTYR" }, snapM: 500, sourceTag: "cdot_co" } } as RegionConfig];
  })),

  // NDOT-NV (1) — Reno
  {
    slug: "reno",
    source: "point_bbox",
    counties: [],
    bbox: { latMin: 39.4, latMax: 39.7, lonMin: -119.9, lonMax: -119.6 },
    sourceLabel: "NDOT TRINA 2024 AADT",
    pointConfig: { url: "https://gis.dot.nv.gov/arcgis/rest/services/Applications/TRINA/FeatureServer/1", aadtField: "AADT_2024", yearExtractor: { kind: "static", year: 2024 }, snapM: 500, sourceTag: "nvdot", extraWhere: "Visible = 'Y'" },
  },

  // WSDOT (2)
  ...(["spokane", "tacoma"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "spokane": { latMin: 47.5, latMax: 47.8, lonMin: -117.6, lonMax: -117.2 },
      "tacoma": { latMin: 47.0, latMax: 47.4, lonMin: -122.7, lonMax: -122.2 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "WSDOT 2024 Traffic Sections", polylineConfig: { url: "https://data.wsdot.wa.gov/arcgis/rest/services/Shared/TrafficData/FeatureServer/1", aadtField: "AADT", yearExtractor: { kind: "field_int", field: "ReportingYear" }, snapM: 200, sourceTag: "wsdot" } } as RegionConfig];
  })),

  // ODOT-OR (2)
  ...(["eugene", "salem-or"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "eugene": { latMin: 43.9, latMax: 44.2, lonMin: -123.3, lonMax: -122.9 },
      "salem-or": { latMin: 44.8, latMax: 45.1, lonMin: -123.2, lonMax: -122.8 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "ODOT-OR 2024 Traffic Flow", polylineConfig: { url: "https://gis.odot.state.or.us/arcgis1006/rest/services/transgis/catalog/MapServer/159", aadtField: "AADT", yearExtractor: { kind: "static", year: 2024 }, snapM: 200, sourceTag: "odot_or" } } as RegionConfig];
  })),

  // UDOT (2)
  ...(["provo", "ogden"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "provo": { latMin: 40.1, latMax: 40.4, lonMin: -111.8, lonMax: -111.5 },
      "ogden": { latMin: 41.1, latMax: 41.4, lonMin: -112.2, lonMax: -111.8 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "UDOT 2024 AADT", polylineConfig: { url: "https://services.arcgis.com/pA2nEVnB6tquxgOW/arcgis/rest/services/AADT2024_Unrounded/FeatureServer/3", aadtField: "AADT2024", yearExtractor: { kind: "static", year: 2024 }, snapM: 200, sourceTag: "udot" } } as RegionConfig];
  })),

  // MnDOT (2)
  ...(["rochester-mn", "duluth"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "rochester-mn": { latMin: 43.9, latMax: 44.2, lonMin: -92.6, lonMax: -92.3 },
      "duluth": { latMin: 46.6, latMax: 46.9, lonMin: -92.3, lonMax: -92.0 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "MnDOT current AADT segments", polylineConfig: { url: "https://webgis.dot.state.mn.us/65agsf1/rest/services/sdw_incdt/AADT_SEGMENT_CURRENT/FeatureServer/0", aadtField: "CURRENT_VOLUME", yearExtractor: { kind: "field_int", field: "CURRENT_YEAR" }, snapM: 200, sourceTag: "mndot" } } as RegionConfig];
  })),

  // FDOT (6) — fort-lauderdale uses point bbox via FDOT; the existing FDOT branch uses counties, so reuse the polyline_bbox generic path by pointing at the same TDA service
  ...(["fort-lauderdale", "west-palm-beach", "daytona-beach", "lakeland", "tallahassee", "fort-myers"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "fort-lauderdale": { latMin: 26.0, latMax: 26.4, lonMin: -80.4, lonMax: -80.0 },
      "west-palm-beach": { latMin: 26.4, latMax: 26.9, lonMin: -80.4, lonMax: -80.0 },
      "daytona-beach": { latMin: 29.0, latMax: 29.4, lonMin: -81.3, lonMax: -80.9 },
      "lakeland": { latMin: 27.9, latMax: 28.2, lonMin: -82.1, lonMax: -81.7 },
      "tallahassee": { latMin: 30.2, latMax: 30.7, lonMin: -84.5, lonMax: -84.0 },
      "fort-myers": { latMin: 26.4, latMax: 26.8, lonMin: -82.1, lonMax: -81.7 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "FDOT AADT TDA", polylineConfig: { url: "https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Annual_Average_Daily_Traffic_TDA/FeatureServer/0", aadtField: "AADT", yearExtractor: { kind: "field_int", field: "YEAR_" }, snapM: 200, sourceTag: "fdot" } } as RegionConfig];
  })),

  // VDOT (2)
  ...(["roanoke", "charlottesville"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "roanoke": { latMin: 37.1, latMax: 37.4, lonMin: -80.1, lonMax: -79.7 },
      "charlottesville": { latMin: 37.9, latMax: 38.2, lonMin: -78.6, lonMax: -78.3 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "VDOT 2024 Traffic Volume", polylineConfig: { url: "https://services.arcgis.com/p5v98VHDX9Atv3l7/arcgis/rest/services/VDOT_Traffic_Volume_2024/FeatureServer/0", aadtField: "ADT", yearExtractor: { kind: "field_epoch_ms", field: "DATA_DATE" }, snapM: 200, sourceTag: "vdot" } } as RegionConfig];
  })),

  // MoDOT (2)
  ...(["springfield-mo", "columbia-mo"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "springfield-mo": { latMin: 37.0, latMax: 37.3, lonMin: -93.4, lonMax: -93.1 },
      "columbia-mo": { latMin: 38.8, latMax: 39.1, lonMin: -92.5, lonMax: -92.1 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "MoDOT Directional AADT", polylineConfig: { url: "https://mapping.modot.mo.gov/arcgis/rest/services/BusinessInt/TrafficInfoSegAADT/MapServer/1", aadtField: "AADT", yearExtractor: { kind: "field_int", field: "AADT_YEAR" }, snapM: 200, sourceTag: "modot" } } as RegionConfig];
  })),

  // Iowa DOT (1) — Cedar Rapids
  {
    slug: "cedar-rapids",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 41.9, latMax: 42.1, lonMin: -91.8, lonMax: -91.5 },
    sourceLabel: "Iowa DOT RAMS AADT",
    polylineConfig: { url: "https://gis.iowadot.gov/agshost/rest/services/RAMS/Road_Network/FeatureServer/0", aadtField: "AADT", yearExtractor: { kind: "field_int", field: "AADT_YEAR" }, snapM: 200, sourceTag: "iadot" },
  },

  // ── Dark-state re-probe wins (2026-05-27 third pass) ──
  // ALDOT — Birmingham/Huntsville/Mobile, point stations (TDMPublic, 282k records, 2014-2025).
  // Filter to recent years for current AADT; supersedes the previously dark/Gulf-Coast-only path.
  ...(["birmingham", "huntsville", "mobile"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "birmingham": { latMin: 33.2, latMax: 33.9, lonMin: -87.3, lonMax: -86.4 },
      "huntsville": { latMin: 34.5, latMax: 34.9, lonMin: -86.8, lonMax: -86.4 },
      "mobile": { latMin: 30.5, latMax: 30.9, lonMin: -88.3, lonMax: -87.8 },
    };
    return [{ slug, source: "point_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "ALDOT TDM 2024-2025 AADT", pointConfig: { url: "https://aldotgis.dot.state.al.us/pubgis2/rest/services/EGISATDServices/TDMPublic/MapServer/0", aadtField: "AADT", yearExtractor: { kind: "field_int", field: "YearAADT" }, snapM: 500, sourceTag: "aldot", extraWhere: "YearAADT IN (2024, 2025) AND IsActive = 1" } } as RegionConfig];
  })),

  // GDOT non-Atlanta (3) — Savannah/Augusta/Macon, point stations via DeKalbGIS ingest of GDOT_AADT.
  // Not authoritative-direct (GDOT retired its REST endpoint) but updates monthly and covers all 159 GA counties.
  ...(["savannah", "augusta", "macon"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "savannah": { latMin: 31.9, latMax: 32.3, lonMin: -81.3, lonMax: -80.9 },
      "augusta": { latMin: 33.3, latMax: 33.6, lonMin: -82.1, lonMax: -81.8 },
      "macon": { latMin: 32.7, latMax: 33.0, lonMin: -83.8, lonMax: -83.5 },
    };
    return [{ slug, source: "point_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "GDOT AADT (DeKalbGIS ingest)", pointConfig: { url: "https://services2.arcgis.com/IxVN2oUE9EYLSnPE/arcgis/rest/services/GDOT_AADT/FeatureServer/1", aadtField: "aadt", yearExtractor: { kind: "static", year: 2024 }, snapM: 500, sourceTag: "gdot_511" } } as RegionConfig];
  })),

  // RIDOT — Providence, polyline (TRANS_Traffic_Counts_spf, 855 segments).
  // Stale (1999/2001 vintage in samples) but real statewide coverage.
  {
    slug: "providence",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 41.6, latMax: 42.0, lonMin: -71.7, lonMax: -71.1 },
    sourceLabel: "RIDOT Traffic Counts (statewide polyline)",
    polylineConfig: {
      url: "https://services2.arcgis.com/S8zZg9pg23JUEexQ/arcgis/rest/services/TRANS_Traffic_Counts_spf/FeatureServer/0",
      aadtField: "AADTYR",
      yearExtractor: { kind: "field_int", field: "YR" },
      snapM: 200,
      sourceTag: "ridot",
    },
  },

  // ── Tier-8 Canada AADT (where available) ──

  // Alberta Transportation — Calgary + Edmonton, polyline (Level of Service 2021,
  // WAADT_VOLUME field — Weighted AADT). Provincial-highway-only, expect ~30-50%.
  ...(["calgary", "edmonton"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "calgary": { latMin: 50.8, latMax: 51.2, lonMin: -114.3, lonMax: -113.8 },
      "edmonton": { latMin: 53.4, latMax: 53.7, lonMin: -113.7, lonMax: -113.3 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "Alberta Transportation LoS 2021 (WAADT)", polylineConfig: { url: "https://services3.arcgis.com/mSGO1HzZze9kkZcj/arcgis/rest/services/Level_of_Service_2021/FeatureServer/0", aadtField: "WAADT_VOLUME", yearExtractor: { kind: "field_int", field: "TRAFFIC_YEAR" }, snapM: 200, sourceTag: "ab_transportation" } } as RegionConfig];
  })),

  // SICT Mexico (via Jacobs Engineering AGOL mirror) — all 10 MX metros.
  // 576 polyline segments national-scale; federal-highway-only so urban-core
  // coverage will be very low. TDPA2022 stale but only public ArcGIS option.
  ...(["mexico-city", "guadalajara", "monterrey", "puebla", "tijuana", "toluca", "leon", "juarez", "queretaro", "merida"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "mexico-city": { latMin: 19.2, latMax: 19.6, lonMin: -99.3, lonMax: -98.9 },
      "guadalajara": { latMin: 20.5, latMax: 20.8, lonMin: -103.5, lonMax: -103.2 },
      "monterrey": { latMin: 25.5, latMax: 25.9, lonMin: -100.5, lonMax: -100.1 },
      "puebla": { latMin: 18.9, latMax: 19.2, lonMin: -98.3, lonMax: -98.0 },
      "tijuana": { latMin: 32.4, latMax: 32.53, lonMin: -117.1, lonMax: -116.8 },
      "toluca": { latMin: 19.2, latMax: 19.4, lonMin: -99.8, lonMax: -99.5 },
      "leon": { latMin: 21.0, latMax: 21.2, lonMin: -101.8, lonMax: -101.5 },
      "juarez": { latMin: 31.5, latMax: 31.75, lonMin: -106.6, lonMax: -106.3 },
      "queretaro": { latMin: 20.5, latMax: 20.7, lonMin: -100.5, lonMax: -100.3 },
      "merida": { latMin: 20.9, latMax: 21.1, lonMin: -89.7, lonMax: -89.5 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "SICT TDPA 2022 (federal highways, via Jacobs mirror)", polylineConfig: { url: "https://services9.arcgis.com/eNX73FDxjlKFtCtH/arcgis/rest/services/Mexico_Traffic_Data/FeatureServer/1", aadtField: "TDPA2022", yearExtractor: { kind: "static", year: 2022 }, snapM: 300, sourceTag: "sict" } } as RegionConfig];
  })),

  // MTO Ontario — Toronto/Ottawa/Hamilton, polyline (Historical AADT, AADT19 = 2019 latest).
  // Provincial-highway-only (1,844 segments statewide); expect low urban-core coverage.
  ...(["toronto", "ottawa", "hamilton"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "toronto": { latMin: 43.5, latMax: 44.0, lonMin: -79.7, lonMax: -79.0 },
      "ottawa": { latMin: 45.2, latMax: 45.5, lonMin: -76.0, lonMax: -75.4 },
      "hamilton": { latMin: 43.1, latMax: 43.4, lonMin: -80.0, lonMax: -79.7 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "MTO Historical AADT (2019)", polylineConfig: { url: "https://services.arcgis.com/6iGx1Dq91oKtcE7x/arcgis/rest/services/Historical_AADT/FeatureServer/0", aadtField: "AADT19", yearExtractor: { kind: "static", year: 2019 }, snapM: 200, sourceTag: "mto" } } as RegionConfig];
  })),

  // Manitoba Infrastructure (via UManitoba MHTIS) — Winnipeg, polyline. 2019 stale.
  {
    slug: "winnipeg",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 49.7, latMax: 50.0, lonMin: -97.3, lonMax: -96.9 },
    sourceLabel: "MHTIS Traffic Flow 2019 (provincial highways)",
    polylineConfig: {
      url: "https://services6.arcgis.com/HQUud09zgy3Asw9X/arcgis/rest/services/MHTIS_Traffic_Flow_2019/FeatureServer/0",
      aadtField: "AADT",
      yearExtractor: { kind: "static", year: 2019 },
      snapM: 200,
      sourceTag: "mb_infrastructure",
    },
  },

  // WYDOT — Cheyenne, polyline (ITSM_Data_Layers/MapServer/37, 53k segments, eff_year 2022).
  {
    slug: "cheyenne",
    source: "polyline_bbox",
    counties: [],
    bbox: { latMin: 41.0, latMax: 41.3, lonMin: -104.9, lonMax: -104.7 },
    sourceLabel: "WYDOT ITSM AADT (2022)",
    polylineConfig: {
      url: "https://gisservices.wyoroad.info/arcgis/rest/services/ITSM/ITSM_Data_Layers/MapServer/37",
      aadtField: "aadt",
      yearExtractor: { kind: "field_int", field: "eff_year" },
      snapM: 300,
      sourceTag: "wydot",
    },
  },

  // KYTC — Louisville + Lexington, polyline Traffic Section Middle Third.
  // LASTCNT = most recent AADT, LASTCNTYR = year. 20,526 polylines statewide.
  ...(["louisville", "lexington"].flatMap((slug) => {
    const bboxes: Record<string, RegionConfig["bbox"]> = {
      "louisville": { latMin: 38.0, latMax: 38.4, lonMin: -85.9, lonMax: -85.4 },
      "lexington": { latMin: 37.9, latMax: 38.2, lonMin: -84.7, lonMax: -84.3 },
    };
    return [{ slug, source: "polyline_bbox", counties: [], bbox: bboxes[slug], sourceLabel: "KYTC Traffic Section AADT", polylineConfig: { url: "https://services2.arcgis.com/CcI36Pduqd0OR4W9/arcgis/rest/services/Traffic_Section_Middle_Third/FeatureServer/0", aadtField: "LASTCNT", yearExtractor: { kind: "field_int", field: "LASTCNTYR" }, snapM: 200, sourceTag: "kytc" } } as RegionConfig];
  })),

  // New Orleans — RPC SE Louisiana point stations (4,597 records, merges RPC + DOTD AADT, 2022-2025).
  // Better than statewide LADOTD since LADOTD's REST is dead and RPC includes both MPO + state counts.
  {
    slug: "new-orleans",
    source: "point_bbox",
    counties: [],
    bbox: { latMin: 29.7, latMax: 30.2, lonMin: -90.4, lonMax: -89.5 },
    sourceLabel: "RPC SE Louisiana Traffic Counts (RPC+DOTD)",
    pointConfig: {
      url: "https://services2.arcgis.com/rojlIZfHqM460MaC/arcgis/rest/services/Traffic_Count_Locations_(RPC_2026)/FeatureServer/0",
      aadtField: "DOTD_AADT",
      aadtFieldAlt: "RPC_ADT",
      yearExtractor: { kind: "field_int", field: "COUNT_YEAR" },
      snapM: 500,
      sourceTag: "ladotd",
    },
  },
];

const FDOT_URL =
  "https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Annual_Average_Daily_Traffic_TDA/FeatureServer/0";
const NCDOT_URL =
  "https://services.arcgis.com/NuWFvHYDMVmmxMeM/arcgis/rest/services/NCDOT__2024_AADT_Stations_published_September_2025/FeatureServer/0";
const TDOT_URL =
  "https://services2.arcgis.com/nf3p7v7Zy4fTOh6M/arcgis/rest/services/Traffic_Points/FeatureServer/0";
const MDC_URL =
  "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services/MDCTrafficCountStation_gdb/FeatureServer/0";
const VDOT_URL =
  "https://services.arcgis.com/p5v98VHDX9Atv3l7/arcgis/rest/services/VDOT_Traffic_Volume_2024/FeatureServer/0";
const SCDOT_URL =
  "https://services1.arcgis.com/VaY7cY9pvUYUP1Lf/arcgis/rest/services/Traffic_Counts_2017/FeatureServer/0";

// New per-source snap distances:
const VDOT_SNAP_M = 200;  // polylines, similar to FDOT
const SCDOT_SNAP_M = 600; // older + sparser points than NCDOT

const M_PER_DEG_LAT = 111_320;

function mPerDegLonAt(lat: number): number {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

function pointDistMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const midLat = (lat1 + lat2) / 2;
  const mPerLon = mPerDegLonAt(midLat);
  return Math.sqrt(((lat1 - lat2) * M_PER_DEG_LAT) ** 2 + ((lon1 - lon2) * mPerLon) ** 2);
}

/** Closest distance (meters) from a signal to a polyline (array of [lon,lat] vertices). */
function pointToPolylineMeters(lat: number, lon: number, paths: Array<Array<[number, number]>>): number {
  const mPerLon = mPerDegLonAt(lat);
  let best = Infinity;
  for (const path of paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const [alon, alat] = path[i]!;
      const [blon, blat] = path[i + 1]!;
      const px = (lon - alon) * mPerLon;
      const py = (lat - alat) * M_PER_DEG_LAT;
      const bx = (blon - alon) * mPerLon;
      const by = (blat - alat) * M_PER_DEG_LAT;
      const len2 = bx * bx + by * by;
      let t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const dx = px - bx * t;
      const dy = py - by * t;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) best = d;
    }
  }
  return best;
}

async function fetchAll<T>(
  baseUrl: string,
  whereClause: string,
  outFields: string,
  geomType: "esriGeometryPolyline" | "esriGeometryPoint",
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  while (true) {
    const url =
      `${baseUrl}/query` +
      `?where=${encodeURIComponent(whereClause)}` +
      `&outFields=${encodeURIComponent(outFields)}` +
      `&outSR=4326` +
      `&returnGeometry=true` +
      `&resultRecordCount=${PAGE_SIZE}` +
      `&resultOffset=${offset}` +
      `&f=json`;
    const res = await fetch(url, { headers: { "User-Agent": "tis-study/1.0" } });
    if (!res.ok) throw new Error(`AADT query failed at offset ${offset}: ${res.status} ${res.statusText}`);
    const json = (await res.json()) as { features?: T[]; exceededTransferLimit?: boolean };
    const features = json.features ?? [];
    out.push(...features);
    if (!json.exceededTransferLimit || features.length === 0) break;
    offset += features.length;
    console.log(`    page offset=${offset}, total=${out.length}`);
  }
  return out;
}

/** Latest non-empty AADT year from an NCDOT station record. */
function latestNcdotAadt(attrs: NcdotFeature["attributes"]): { aadt: number; year: number } | null {
  for (let year = 2024; year >= 2002; year--) {
    const raw = attrs[`AADT_${year}`];
    if (raw === undefined || raw === null) continue;
    const s = String(raw).trim();
    if (!s || s === " ") continue;
    const n = parseInt(s.replace(/[^\d]/g, ""), 10);
    if (Number.isFinite(n) && n > 0) return { aadt: n, year };
  }
  return null;
}

/** Build a coarse 0.005°-grid spatial index for fast nearest-feature lookup. */
function buildGrid<F>(
  features: F[],
  getRepLatLon: (f: F) => { lat: number; lon: number } | null,
): Map<string, F[]> {
  const grid = new Map<string, F[]>();
  for (const f of features) {
    const rep = getRepLatLon(f);
    if (!rep) continue;
    const k = `${Math.floor(rep.lat / 0.005)}_${Math.floor(rep.lon / 0.005)}`;
    let bucket = grid.get(k);
    if (!bucket) { bucket = []; grid.set(k, bucket); }
    bucket.push(f);
  }
  return grid;
}

/** First-vertex lat/lon of a polyline (representative point for grid bucketing). */
function fdotRepPoint(f: FdotFeature): { lat: number; lon: number } | null {
  const first = f.geometry?.paths?.[0]?.[0];
  if (!first) return null;
  return { lat: first[1], lon: first[0] };
}

async function processRegion(cfg: RegionConfig): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = path.resolve(__dirname, "../../artifacts/api-server/src/data");
  const signalsPath = path.resolve(dataDir, `${cfg.slug}-signals.json`);
  if (!existsSync(signalsPath)) throw new Error(`Missing signals file at ${signalsPath}`);

  console.log(`\n=== ${cfg.slug} (${cfg.source}) ===`);
  const signals = JSON.parse(readFileSync(signalsPath, "utf8")) as SignalTuple[];
  console.log(`  Signals to snap: ${signals.length}`);

  // ── Existing AADT records that this run will *augment* rather than
  //    overwrite. For miami-dade, MDC supplements FDOT (fills in signals
  //    FDOT didn't snap). For everyone else, this is empty.
  const existingPath = path.resolve(dataDir, `${cfg.slug}-aadt.json`);
  let existing: Record<string, AadtRecord> = {};
  if (cfg.source === "fdot" && cfg.slug === "miami-dade" && existsSync(existingPath)) {
    // Don't load existing — FDOT pass starts fresh, MDC pass merges after.
  }
  if (cfg.supplement && existsSync(existingPath)) {
    existing = JSON.parse(readFileSync(existingPath, "utf8")) as Record<string, AadtRecord>;
    console.log(`  Supplement mode: ${Object.keys(existing).length} existing records kept as-is`);
  }

  // ── VDOT path (polyline AADT, no county field — use bbox filter) ────
  if (cfg.source === "vdot") {
    const b = cfg.bbox;
    if (!b) throw new Error(`VDOT region ${cfg.slug} needs bbox`);
    const where = `ADT IS NOT NULL AND ADT > 0`;
    const fields = "OBJECTID,DATA_DATE,ROUTE_NAME,ADT";
    // ArcGIS spatial query envelope
    const envelope = `${b.lonMin},${b.latMin},${b.lonMax},${b.latMax}`;
    console.log(`  Fetching VDOT ADT polylines for bbox ${envelope}...`);
    const out: VdotFeature[] = [];
    let offset = 0;
    while (true) {
      const url =
        `${VDOT_URL}/query` +
        `?where=${encodeURIComponent(where)}` +
        `&outFields=${encodeURIComponent(fields)}` +
        `&outSR=4326` +
        `&returnGeometry=true` +
        `&geometry=${encodeURIComponent(envelope)}` +
        `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects` +
        `&resultRecordCount=${PAGE_SIZE}` +
        `&resultOffset=${offset}` +
        `&f=json`;
      const res = await fetch(url, { headers: { "User-Agent": "tis-study/1.0" } });
      if (!res.ok) throw new Error(`VDOT query failed at offset ${offset}: ${res.status}`);
      const json = (await res.json()) as { features?: VdotFeature[]; exceededTransferLimit?: boolean };
      const features = json.features ?? [];
      out.push(...features);
      if (!json.exceededTransferLimit || features.length === 0) break;
      offset += features.length;
      console.log(`    page offset=${offset}, total=${out.length}`);
    }
    console.log(`  Fetched ${out.length} VDOT ADT polylines`);

    const grid = buildGrid<VdotFeature>(out, (f) => {
      const first = f.geometry?.paths?.[0]?.[0];
      if (!first) return null;
      return { lat: first[1], lon: first[0] };
    });
    const result: Record<string, AadtRecord> = {};
    let snapped = 0;
    const distances: number[] = [];
    for (const [sid, lat, lon] of signals) {
      if (existing[String(sid)]) continue; // supplement mode: primary DOT's record wins
      const latCell = Math.floor(lat / 0.005);
      const lonCell = Math.floor(lon / 0.005);
      let best: { f: VdotFeature; d: number } | null = null;
      for (let dlat = -3; dlat <= 3; dlat++) {
        for (let dlon = -3; dlon <= 3; dlon++) {
          const bucket = grid.get(`${latCell + dlat}_${lonCell + dlon}`);
          if (!bucket) continue;
          for (const f of bucket) {
            if (!f.geometry?.paths) continue;
            const d = pointToPolylineMeters(lat, lon, f.geometry.paths);
            if (d <= VDOT_SNAP_M && (best === null || d < best.d)) best = { f, d };
          }
        }
      }
      if (best && best.f.attributes.ADT) {
        const year = best.f.attributes.DATA_DATE ? new Date(best.f.attributes.DATA_DATE).getFullYear() : 2024;
        result[String(sid)] = {
          aadt: best.f.attributes.ADT,
          year,
          kFactor: DEFAULT_K_FACTOR_PCT,
          distM: Math.round(best.d),
          source: "vdot",
        };
        snapped++;
        distances.push(best.d);
      }
    }
    distances.sort((a, b) => a - b);
    const p50 = Math.round(distances[Math.floor(distances.length / 2)] ?? 0);
    const p90 = Math.round(distances[Math.floor(distances.length * 0.9)] ?? 0);
    const outPath = path.resolve(dataDir, `${cfg.slug}-aadt.json`);
    writeFileSync(outPath, JSON.stringify({ ...existing, ...result }));
    console.log(`  Snapped ${snapped} / ${signals.length} (${((snapped / signals.length) * 100).toFixed(1)}%) signals to VDOT ADT`);
    console.log(`  Snap distance p50=${p50}m p90=${p90}m`);
    console.log(`  → ${outPath}`);
    return;
  }

  // ── Generic polyline-bbox path (TxDOT/ODOT-OH/PennDOT/MassDOT/INDOT/MoDOT/MDOT/DDOT/IDOT/MDOT-MI/MnDOT/WisDOT/NYSDOT) ──
  if (cfg.source === "polyline_bbox") {
    const pc = cfg.polylineConfig;
    if (!pc) throw new Error(`${cfg.slug}: polylineConfig missing`);
    const b = cfg.bbox;
    if (!b) throw new Error(`${cfg.slug}: bbox required for polyline_bbox source`);
    const aadtClause = `${pc.aadtField} IS NOT NULL AND ${pc.aadtField} > 0`;
    const where = pc.extraWhere ? `${pc.extraWhere} AND ${aadtClause}` : aadtClause;
    const yearField = pc.yearExtractor.kind !== "static" ? pc.yearExtractor.field : null;
    // Skip OBJECTID — different services use different OID field names
    // (MoDOT uses SS_SEGMENT_ID, breaks if we hardcode OBJECTID). We don't
    // need the OID downstream anyway.
    const fields = [pc.aadtField, yearField].filter(Boolean).join(",");
    const envelope = `${b.lonMin},${b.latMin},${b.lonMax},${b.latMax}`;
    console.log(`  Fetching ${cfg.sourceLabel ?? cfg.slug} polylines for bbox ${envelope}...`);

    const out: PolylineFeature[] = [];
    let offset = 0;
    while (true) {
      const url =
        `${pc.url}/query` +
        `?where=${encodeURIComponent(where)}` +
        `&outFields=${encodeURIComponent(fields)}` +
        `&outSR=4326` +
        `&returnGeometry=true` +
        `&geometry=${encodeURIComponent(envelope)}` +
        `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects` +
        `&resultRecordCount=${PAGE_SIZE}` +
        `&resultOffset=${offset}` +
        `&f=json`;
      const res = await fetch(url, { headers: { "User-Agent": "tis-study/1.0" } });
      if (!res.ok) throw new Error(`${cfg.slug} query failed at offset ${offset}: ${res.status} ${res.statusText}`);
      const json = (await res.json()) as { features?: PolylineFeature[]; exceededTransferLimit?: boolean };
      const features = json.features ?? [];
      out.push(...features);
      if (!json.exceededTransferLimit || features.length === 0) break;
      offset += features.length;
      if (offset % 10000 === 0) console.log(`    page offset=${offset}, total=${out.length}`);
    }
    console.log(`  Fetched ${out.length} polylines`);

    const grid = buildGrid<PolylineFeature>(out, (f) => {
      const first = f.geometry?.paths?.[0]?.[0];
      if (!first) return null;
      return { lat: first[1], lon: first[0] };
    });

    const result: Record<string, AadtRecord> = {};
    let snapped = 0;
    const distances: number[] = [];
    for (const [sid, lat, lon] of signals) {
      if (existing[String(sid)]) continue; // supplement mode: primary DOT's record wins
      const latCell = Math.floor(lat / 0.005);
      const lonCell = Math.floor(lon / 0.005);
      let best: { f: PolylineFeature; d: number } | null = null;
      for (let dlat = -3; dlat <= 3; dlat++) {
        for (let dlon = -3; dlon <= 3; dlon++) {
          const bucket = grid.get(`${latCell + dlat}_${lonCell + dlon}`);
          if (!bucket) continue;
          for (const f of bucket) {
            if (!f.geometry?.paths) continue;
            const d = pointToPolylineMeters(lat, lon, f.geometry.paths);
            if (d <= pc.snapM && (best === null || d < best.d)) best = { f, d };
          }
        }
      }
      if (best) {
        const rawAadt = best.f.attributes[pc.aadtField];
        const aadtVal = typeof rawAadt === "number" ? rawAadt : parseInt(String(rawAadt).replace(/[^\d]/g, ""), 10);
        if (!Number.isFinite(aadtVal) || aadtVal <= 0) continue;
        let year: number;
        if (pc.yearExtractor.kind === "static") year = pc.yearExtractor.year;
        else if (pc.yearExtractor.kind === "field_int") {
          const raw = best.f.attributes[pc.yearExtractor.field];
          year = typeof raw === "number" ? raw : parseInt(String(raw), 10) || new Date().getFullYear();
        } else {
          const raw = best.f.attributes[pc.yearExtractor.field];
          const epoch = typeof raw === "number" ? raw : parseInt(String(raw), 10);
          year = Number.isFinite(epoch) ? new Date(epoch).getFullYear() : new Date().getFullYear();
        }
        result[String(sid)] = {
          aadt: aadtVal,
          year,
          kFactor: DEFAULT_K_FACTOR_PCT,
          distM: Math.round(best.d),
          source: pc.sourceTag,
        };
        snapped++;
        distances.push(best.d);
      }
    }
    distances.sort((a, b) => a - b);
    const p50 = Math.round(distances[Math.floor(distances.length / 2)] ?? 0);
    const p90 = Math.round(distances[Math.floor(distances.length * 0.9)] ?? 0);
    const outPath = path.resolve(dataDir, `${cfg.slug}-aadt.json`);
    writeFileSync(outPath, JSON.stringify({ ...existing, ...result }));
    console.log(`  Snapped ${snapped} / ${signals.length} (${((snapped / signals.length) * 100).toFixed(1)}%) signals to ${cfg.sourceLabel ?? cfg.slug}`);
    console.log(`  Snap distance p50=${p50}m p90=${p90}m`);
    console.log(`  → ${outPath}`);
    return;
  }

  // ── Generic point-bbox path (Caltrans BACK/AHEAD, WSDOT stations, CDOT-CO stations) ──
  if (cfg.source === "point_bbox") {
    const pc = cfg.pointConfig;
    if (!pc) throw new Error(`${cfg.slug}: pointConfig missing`);
    const b = cfg.bbox;
    if (!b) throw new Error(`${cfg.slug}: bbox required for point_bbox source`);
    // For dual-field sources (Caltrans), filter on EITHER being non-null.
    const aadtClause = pc.aadtFieldAlt
      ? `(${pc.aadtField} IS NOT NULL OR ${pc.aadtFieldAlt} IS NOT NULL)`
      : `${pc.aadtField} IS NOT NULL AND ${pc.aadtField} > 0`;
    const where = pc.extraWhere ? `${pc.extraWhere} AND ${aadtClause}` : aadtClause;
    const yearField = pc.yearExtractor.kind !== "static" ? pc.yearExtractor.field : null;
    // Skip OBJECTID — see polyline_bbox note.
    const fields = [pc.aadtField, pc.aadtFieldAlt, yearField].filter(Boolean).join(",");
    const envelope = `${b.lonMin},${b.latMin},${b.lonMax},${b.latMax}`;
    console.log(`  Fetching ${cfg.sourceLabel ?? cfg.slug} points for bbox ${envelope}...`);

    type Pt = { attributes: Record<string, unknown>; geometry?: { x: number; y: number } };
    const out: Pt[] = [];
    let offset = 0;
    while (true) {
      const url =
        `${pc.url}/query` +
        `?where=${encodeURIComponent(where)}` +
        `&outFields=${encodeURIComponent(fields)}` +
        `&outSR=4326` +
        `&returnGeometry=true` +
        `&geometry=${encodeURIComponent(envelope)}` +
        `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects` +
        `&resultRecordCount=${PAGE_SIZE}` +
        `&resultOffset=${offset}` +
        `&f=json`;
      const res = await fetch(url, { headers: { "User-Agent": "tis-study/1.0" } });
      if (!res.ok) throw new Error(`${cfg.slug} query failed at offset ${offset}: ${res.status} ${res.statusText}`);
      const json = (await res.json()) as { features?: Pt[]; exceededTransferLimit?: boolean };
      const features = json.features ?? [];
      out.push(...features);
      if (!json.exceededTransferLimit || features.length === 0) break;
      offset += features.length;
    }
    console.log(`  Fetched ${out.length} points`);

    const grid = buildGrid<Pt>(out, (f) =>
      f.geometry?.x !== undefined && f.geometry?.y !== undefined
        ? { lat: f.geometry.y, lon: f.geometry.x }
        : null
    );

    const parseAadt = (raw: unknown): number => {
      if (raw === null || raw === undefined) return 0;
      if (typeof raw === "number") return raw;
      const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
      return Number.isFinite(n) ? n : 0;
    };

    const result: Record<string, AadtRecord> = {};
    let snapped = 0;
    const distances: number[] = [];
    for (const [sid, lat, lon] of signals) {
      if (existing[String(sid)]) continue; // supplement mode: primary DOT's record wins
      const latCell = Math.floor(lat / 0.005);
      const lonCell = Math.floor(lon / 0.005);
      let best: { f: Pt; d: number } | null = null;
      for (let dlat = -3; dlat <= 3; dlat++) {
        for (let dlon = -3; dlon <= 3; dlon++) {
          const bucket = grid.get(`${latCell + dlat}_${lonCell + dlon}`);
          if (!bucket) continue;
          for (const f of bucket) {
            const flat = f.geometry?.y;
            const flon = f.geometry?.x;
            if (flat === undefined || flon === undefined) continue;
            const d = pointDistMeters(lat, lon, flat, flon);
            if (d <= pc.snapM && (best === null || d < best.d)) best = { f, d };
          }
        }
      }
      if (best) {
        const primary = parseAadt(best.f.attributes[pc.aadtField]);
        const alt = pc.aadtFieldAlt ? parseAadt(best.f.attributes[pc.aadtFieldAlt]) : 0;
        const aadtVal = Math.max(primary, alt);
        if (aadtVal <= 0) continue;
        let year: number;
        if (pc.yearExtractor.kind === "static") year = pc.yearExtractor.year;
        else if (pc.yearExtractor.kind === "field_int") {
          const raw = best.f.attributes[pc.yearExtractor.field];
          year = typeof raw === "number" ? raw : parseInt(String(raw), 10) || new Date().getFullYear();
        } else {
          const raw = best.f.attributes[pc.yearExtractor.field];
          const epoch = typeof raw === "number" ? raw : parseInt(String(raw), 10);
          year = Number.isFinite(epoch) ? new Date(epoch).getFullYear() : new Date().getFullYear();
        }
        result[String(sid)] = {
          aadt: aadtVal,
          year,
          kFactor: DEFAULT_K_FACTOR_PCT,
          distM: Math.round(best.d),
          source: pc.sourceTag,
        };
        snapped++;
        distances.push(best.d);
      }
    }
    distances.sort((a, b) => a - b);
    const p50 = Math.round(distances[Math.floor(distances.length / 2)] ?? 0);
    const p90 = Math.round(distances[Math.floor(distances.length * 0.9)] ?? 0);
    const outPath = path.resolve(dataDir, `${cfg.slug}-aadt.json`);
    writeFileSync(outPath, JSON.stringify({ ...existing, ...result }));
    console.log(`  Snapped ${snapped} / ${signals.length} (${((snapped / signals.length) * 100).toFixed(1)}%) signals to ${cfg.sourceLabel ?? cfg.slug}`);
    console.log(`  Snap distance p50=${p50}m p90=${p90}m`);
    console.log(`  → ${outPath}`);
    return;
  }

  // ── SCDOT path (multipoint AADT keyed by County_Nam) ─────────────────
  if (cfg.source === "scdot") {
    const countyClause = `County_Nam IN (${cfg.counties.map((c) => `'${c}'`).join(",")})`;
    const where = `${countyClause} AND Factored_A IS NOT NULL AND Factored_A > 0`;
    const fields = "FID,Station_Nu,Factored_A,Factored_1,County_Nam";
    console.log(`  Fetching SCDOT counts for ${cfg.counties.length} counties...`);
    const features = await fetchAll<ScdotFeature>(SCDOT_URL, where, fields, "esriGeometryPoint");
    console.log(`  Fetched ${features.length} SCDOT points`);

    const grid = buildGrid<ScdotFeature>(features, (f) => {
      // MultiPoint or Point — try both shapes
      const p = f.geometry?.points?.[0];
      if (p) return { lat: p[1], lon: p[0] };
      if (f.geometry?.x !== undefined && f.geometry?.y !== undefined) return { lat: f.geometry.y, lon: f.geometry.x };
      return null;
    });
    const result: Record<string, AadtRecord> = {};
    let snapped = 0;
    const distances: number[] = [];
    for (const [sid, lat, lon] of signals) {
      const latCell = Math.floor(lat / 0.005);
      const lonCell = Math.floor(lon / 0.005);
      let best: { d: number; aadt: number; year: number } | null = null;
      for (let dlat = -3; dlat <= 3; dlat++) {
        for (let dlon = -3; dlon <= 3; dlon++) {
          const bucket = grid.get(`${latCell + dlat}_${lonCell + dlon}`);
          if (!bucket) continue;
          for (const f of bucket) {
            const p = f.geometry?.points?.[0];
            const flat = p ? p[1] : f.geometry?.y;
            const flon = p ? p[0] : f.geometry?.x;
            if (flat === undefined || flon === undefined) continue;
            const d = pointDistMeters(lat, lon, flat, flon);
            if (d > SCDOT_SNAP_M) continue;
            if (best !== null && d >= best.d) continue;
            if (!f.attributes.Factored_A) continue;
            best = { d, aadt: f.attributes.Factored_A, year: f.attributes.Factored_1 };
          }
        }
      }
      if (best) {
        result[String(sid)] = {
          aadt: best.aadt,
          year: best.year,
          kFactor: DEFAULT_K_FACTOR_PCT,
          distM: Math.round(best.d),
          source: "ncdot", // reuse tag; consumer doesn't branch
        };
        snapped++;
        distances.push(best.d);
      }
    }
    distances.sort((a, b) => a - b);
    const p50 = Math.round(distances[Math.floor(distances.length / 2)] ?? 0);
    const p90 = Math.round(distances[Math.floor(distances.length * 0.9)] ?? 0);
    const outPath = path.resolve(dataDir, `${cfg.slug}-aadt.json`);
    writeFileSync(outPath, JSON.stringify(result));
    console.log(`  Snapped ${snapped} / ${signals.length} (${((snapped / signals.length) * 100).toFixed(1)}%) signals to SCDOT counts (2017)`);
    console.log(`  Snap distance p50=${p50}m p90=${p90}m`);
    console.log(`  → ${outPath}`);
    return;
  }

  // ── FDOT path ────────────────────────────────────────────────────────
  if (cfg.source === "fdot") {
    const countyClause = `COUNTY IN (${cfg.counties.map((c) => `'${c}'`).join(",")})`;
    // Only pull the LATEST year per segment (FDOT has historicals too — we want current).
    const where = `${countyClause} AND AADT IS NOT NULL AND AADT > 0`;
    const fields = "YEAR_,AADT,KFCTR,COUNTY";
    console.log(`  Fetching FDOT AADT segments for ${cfg.counties.length} counties...`);
    const features = await fetchAll<FdotFeature>(FDOT_URL, where, fields, "esriGeometryPolyline");
    console.log(`  Fetched ${features.length} AADT segments`);

    const grid = buildGrid<FdotFeature>(features, fdotRepPoint);
    const out: Record<string, AadtRecord> = {};
    let snapped = 0;
    let unsnapped = 0;
    let segDistances: number[] = [];

    for (const [sid, lat, lon] of signals) {
      const latCell = Math.floor(lat / 0.005);
      const lonCell = Math.floor(lon / 0.005);
      let best: { f: FdotFeature; d: number } | null = null;
      // Polylines can be long — scan a wider cell neighborhood (±3 cells ≈ 1.5km).
      for (let dlat = -3; dlat <= 3; dlat++) {
        for (let dlon = -3; dlon <= 3; dlon++) {
          const bucket = grid.get(`${latCell + dlat}_${lonCell + dlon}`);
          if (!bucket) continue;
          for (const f of bucket) {
            if (!f.geometry?.paths) continue;
            const d = pointToPolylineMeters(lat, lon, f.geometry.paths);
            if (d <= FDOT_SNAP_M && (best === null || d < best.d)) best = { f, d };
          }
        }
      }
      if (best && best.f.attributes.AADT) {
        const k = best.f.attributes.KFCTR ?? DEFAULT_K_FACTOR_PCT;
        out[String(sid)] = {
          aadt: best.f.attributes.AADT,
          year: best.f.attributes.YEAR_,
          kFactor: k > 0 ? k : DEFAULT_K_FACTOR_PCT,
          distM: Math.round(best.d),
          source: "fdot",
        };
        snapped++;
        segDistances.push(best.d);
      } else {
        unsnapped++;
      }
    }
    segDistances.sort((a, b) => a - b);
    const p50 = Math.round(segDistances[Math.floor(segDistances.length / 2)] ?? 0);
    const p90 = Math.round(segDistances[Math.floor(segDistances.length * 0.9)] ?? 0);
    const outPath = path.resolve(dataDir, `${cfg.slug}-aadt.json`);
    writeFileSync(outPath, JSON.stringify(out));
    console.log(`  Snapped ${snapped} / ${signals.length} (${((snapped / signals.length) * 100).toFixed(1)}%) signals to FDOT AADT`);
    console.log(`  Snap distance p50=${p50}m p90=${p90}m`);
    console.log(`  → ${outPath}`);
    return;
  }

  // ── TDOT path ────────────────────────────────────────────────────────
  if (cfg.source === "tdot") {
    const countyClause = `COUNTY IN (${cfg.counties.map((c) => `'${c}'`).join(",")})`;
    const where = `${countyClause} AND ACTIVE='True' AND AADT IS NOT NULL AND AADT > 0`;
    const fields = "LOCAL_ID,COUNTY,ON_ROAD,FUNCTIONAL_CLASS,AADT,AADT_YEAR,TRUCK_PERCENTAGE";
    console.log(`  Fetching TDOT AADT points for ${cfg.counties.length} counties...`);
    const features = await fetchAll<TdotFeature>(TDOT_URL, where, fields, "esriGeometryPoint");
    console.log(`  Fetched ${features.length} AADT points`);

    const grid = buildGrid<TdotFeature>(features, (f) => {
      if (f.geometry?.x !== undefined && f.geometry?.y !== undefined) {
        return { lat: f.geometry.y, lon: f.geometry.x };
      }
      return null;
    });
    const out: Record<string, AadtRecord> = {};
    let snapped = 0;
    let unsnapped = 0;
    const distances: number[] = [];
    // TDOT has 37K+ points in Davidson alone — much denser than NCDOT.
    // Tighter snap radius (200m) works since stations are dense.
    const TDOT_SNAP_M = 200;

    for (const [sid, lat, lon] of signals) {
      const latCell = Math.floor(lat / 0.005);
      const lonCell = Math.floor(lon / 0.005);
      let best: { d: number; aadt: number; year: number } | null = null;
      for (let dlat = -2; dlat <= 2; dlat++) {
        for (let dlon = -2; dlon <= 2; dlon++) {
          const bucket = grid.get(`${latCell + dlat}_${lonCell + dlon}`);
          if (!bucket) continue;
          for (const f of bucket) {
            const slat = f.geometry?.y;
            const slon = f.geometry?.x;
            if (slat === undefined || slon === undefined) continue;
            const d = pointDistMeters(lat, lon, slat, slon);
            if (d > TDOT_SNAP_M) continue;
            if (best !== null && d >= best.d) continue;
            if (!f.attributes.AADT) continue;
            best = { d, aadt: f.attributes.AADT, year: f.attributes.AADT_YEAR };
          }
        }
      }
      if (best) {
        out[String(sid)] = {
          aadt: best.aadt,
          year: best.year,
          kFactor: DEFAULT_K_FACTOR_PCT,
          distM: Math.round(best.d),
          source: "ncdot", // shared "ncdot" tag is fine for the consumer; only used to label provenance
        };
        snapped++;
        distances.push(best.d);
      } else {
        unsnapped++;
      }
    }
    distances.sort((a, b) => a - b);
    const p50 = Math.round(distances[Math.floor(distances.length / 2)] ?? 0);
    const p90 = Math.round(distances[Math.floor(distances.length * 0.9)] ?? 0);
    const outPath = path.resolve(dataDir, `${cfg.slug}-aadt.json`);
    writeFileSync(outPath, JSON.stringify(out));
    console.log(`  Snapped ${snapped} / ${signals.length} (${((snapped / signals.length) * 100).toFixed(1)}%) signals to TDOT AADT`);
    console.log(`  Snap distance p50=${p50}m p90=${p90}m`);
    console.log(`  → ${outPath}`);
    return;
  }

  // ── NCDOT path ───────────────────────────────────────────────────────
  const countyClause = `County IN (${cfg.counties.map((c) => `'${c}'`).join(",")})`;
  const where = `${countyClause} AND Active = 1`;
  // Pull all AADT_NNNN fields plus identity.
  const yearFields = Array.from({ length: 23 }, (_, i) => `AADT_${2002 + i}`).join(",");
  const fields = `LocationID,County,Active,Latitude,Longitude,${yearFields}`;
  console.log(`  Fetching NCDOT AADT stations for ${cfg.counties.length} counties...`);
  const features = await fetchAll<NcdotFeature>(NCDOT_URL, where, fields, "esriGeometryPoint");
  console.log(`  Fetched ${features.length} AADT stations`);

  const grid = buildGrid<NcdotFeature>(features, (f) => {
    if (f.geometry?.x !== undefined && f.geometry?.y !== undefined) {
      return { lat: f.geometry.y, lon: f.geometry.x };
    }
    return null;
  });
  const out: Record<string, AadtRecord> = {};
  let snapped = 0;
  let unsnapped = 0;
  const distances: number[] = [];

  for (const [sid, lat, lon] of signals) {
    const latCell = Math.floor(lat / 0.005);
    const lonCell = Math.floor(lon / 0.005);
    let best: { f: NcdotFeature; d: number; aadt: number; year: number } | null = null;
    // NCDOT stations are sparser — scan ±5 cells (~2.5km) but only keep if within snap radius.
    for (let dlat = -5; dlat <= 5; dlat++) {
      for (let dlon = -5; dlon <= 5; dlon++) {
        const bucket = grid.get(`${latCell + dlat}_${lonCell + dlon}`);
        if (!bucket) continue;
        for (const f of bucket) {
          const slat = f.geometry?.y;
          const slon = f.geometry?.x;
          if (slat === undefined || slon === undefined) continue;
          const d = pointDistMeters(lat, lon, slat, slon);
          if (d > NCDOT_SNAP_M) continue;
          if (best !== null && d >= best.d) continue;
          const aadt = latestNcdotAadt(f.attributes);
          if (!aadt) continue;
          best = { f, d, aadt: aadt.aadt, year: aadt.year };
        }
      }
    }
    if (best) {
      out[String(sid)] = {
        aadt: best.aadt,
        year: best.year,
        kFactor: DEFAULT_K_FACTOR_PCT,
        distM: Math.round(best.d),
        source: "ncdot",
      };
      snapped++;
      distances.push(best.d);
    } else {
      unsnapped++;
    }
  }
  distances.sort((a, b) => a - b);
  const p50 = Math.round(distances[Math.floor(distances.length / 2)] ?? 0);
  const p90 = Math.round(distances[Math.floor(distances.length * 0.9)] ?? 0);
  const outPath = path.resolve(dataDir, `${cfg.slug}-aadt.json`);
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`  Snapped ${snapped} / ${signals.length} (${((snapped / signals.length) * 100).toFixed(1)}%) signals to NCDOT AADT`);
  console.log(`  Snap distance p50=${p50}m p90=${p90}m`);
  console.log(`  → ${outPath}`);
}

/**
 * Miami-Dade County local-roads AADT supplement.
 *
 * Runs after the FDOT pass for miami-dade. FDOT only counts state-maintained
 * roads, so MDC's 424 county-maintained count stations fill in many local-
 * road signals FDOT missed. Per-signal data is from 2019 (MDC's last
 * publication) — older than FDOT 2025 but better than synthetic baseline.
 */
async function supplementWithMdc(): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const dataDir = path.resolve(__dirname, "../../artifacts/api-server/src/data");
  const signalsPath = path.resolve(dataDir, "miami-dade-signals.json");
  const aadtPath = path.resolve(dataDir, "miami-dade-aadt.json");
  if (!existsSync(signalsPath) || !existsSync(aadtPath)) {
    console.log("  (skipping MDC supplement — base files missing)");
    return;
  }
  console.log(`\n=== miami-dade MDC supplement ===`);
  const signals = JSON.parse(readFileSync(signalsPath, "utf8")) as SignalTuple[];
  const existing = JSON.parse(readFileSync(aadtPath, "utf8")) as Record<string, AadtRecord>;
  console.log(`  Existing FDOT snaps: ${Object.keys(existing).length} / ${signals.length}`);

  const url =
    `${MDC_URL}/query` +
    `?where=${encodeURIComponent("AADT2019 IS NOT NULL AND AADT2019 > 0")}` +
    `&outFields=OBJECTID,MDSTA,AADT2019,LAT,LON` +
    `&outSR=4326` +
    `&resultRecordCount=${PAGE_SIZE}` +
    `&resultOffset=0` +
    `&f=json`;
  const res = await fetch(url, { headers: { "User-Agent": "tis-study/1.0" } });
  if (!res.ok) throw new Error(`MDC query failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { features?: MdcFeature[] };
  const features = json.features ?? [];
  console.log(`  Fetched ${features.length} MDC stations`);

  const grid = buildGrid<MdcFeature>(features, (f) => {
    if (f.geometry?.x !== undefined && f.geometry?.y !== undefined) return { lat: f.geometry.y, lon: f.geometry.x };
    return null;
  });

  let added = 0;
  for (const [sid, lat, lon] of signals) {
    if (existing[String(sid)]) continue;
    const latCell = Math.floor(lat / 0.005);
    const lonCell = Math.floor(lon / 0.005);
    let best: { d: number; aadt: number } | null = null;
    for (let dlat = -1; dlat <= 1; dlat++) {
      for (let dlon = -1; dlon <= 1; dlon++) {
        const bucket = grid.get(`${latCell + dlat}_${lonCell + dlon}`);
        if (!bucket) continue;
        for (const f of bucket) {
          const flat = f.geometry?.y;
          const flon = f.geometry?.x;
          if (flat === undefined || flon === undefined) continue;
          const d = pointDistMeters(lat, lon, flat, flon);
          if (d > MDC_SNAP_M) continue;
          if (best !== null && d >= best.d) continue;
          if (!f.attributes.AADT2019) continue;
          best = { d, aadt: f.attributes.AADT2019 };
        }
      }
    }
    if (best) {
      existing[String(sid)] = {
        aadt: best.aadt,
        year: 2019,
        kFactor: DEFAULT_K_FACTOR_PCT,
        distM: Math.round(best.d),
        source: "fdot",
      };
      added++;
    }
  }

  writeFileSync(aadtPath, JSON.stringify(existing));
  console.log(`  MDC added ${added} previously-unsnapped signals`);
  console.log(`  Final coverage: ${Object.keys(existing).length} / ${signals.length} (${((Object.keys(existing).length / signals.length) * 100).toFixed(1)}%)`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantAll = args.includes("--all");
  const supplementOnly = args.includes("--supplement-only");
  const requested = args.filter((a) => !a.startsWith("--"));
  const regions = (wantAll ? REGIONS : REGIONS.filter((r) => requested.includes(r.slug)))
    .filter((r) => !supplementOnly || r.supplement === true)
    // Supplements must run AFTER any primary full-rebuild for the same slug
    // (a rebuild overwrites the file; a supplement only fills gaps). Stable
    // sort keeps declaration order within each group.
    .sort((a, b) => Number(a.supplement === true) - Number(b.supplement === true));
  if (regions.length === 0) {
    console.error("Usage: tsx src/fetch-aadt-by-signal.ts <slug> [<slug>...]");
    console.error("       tsx src/fetch-aadt-by-signal.ts --all");
    console.error("       tsx src/fetch-aadt-by-signal.ts --supplement-only <slug> [<slug>...]");
    console.error(`Available: ${REGIONS.map((r) => r.slug).join(", ")}`);
    process.exit(2);
  }
  for (const r of regions) {
    try { await processRegion(r); } catch (e) { console.error(`✗ ${r.slug}: ${(e as Error).message}`); }
    // After FDOT runs for miami-dade, run MDC supplement.
    if (r.slug === "miami-dade") {
      try { await supplementWithMdc(); } catch (e) { console.error(`✗ MDC supplement: ${(e as Error).message}`); }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
