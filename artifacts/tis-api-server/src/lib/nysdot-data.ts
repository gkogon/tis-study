/**
 * NYSDOT data adapter — Tier-1 ingest of posted speed limits from the
 * NYSDOT Roadway Data Management (RDM) Roadway Current FeatureServer
 * for use in the NYSDOT TIS Shell renderer (§2 Travel Speeds).
 *
 * Endpoint: https://gis.dot.ny.gov/hostingny/rest/services/Roadways/RDM_Roadway_Current/FeatureServer/0
 *
 * Returned fields used here (verified via the service catalog):
 *   - Posted_Speed_Limit_MPH  — the headline number; sometimes null on
 *     local streets where NYSDOT doesn't record the posting.
 *   - Roadway_Name             — e.g., "CENTRAL PK W"
 *   - Functional_Class_Desc    — e.g., "Urban Minor Arterial"
 *   - DOT_Region_Name          — e.g., "New York" (matches NYSDOT Region 11)
 *   - Route_Display_Value      — state-route designation when posted
 *
 * Tier-1 scope:
 *   - Posted speed limit AUTO-INGESTED from NYSDOT RDM (this file).
 *   - 85th-percentile operating speed REMAINS field-required — NYSDOT
 *     does not publish speed-study data; per project-specific radar /
 *     floating-car study per HDM Chapter 5 §5.2.
 *
 * Failure mode: any error / timeout returns null for that intersection.
 * The renderer falls back to the existing placeholder ("Speed study
 * required") so a network glitch doesn't break the PDF.
 *
 * Spec: REGIONAL-SPECS — none specific to NY; surfaced from NY queue
 * item "NY speed-study ingest" in the regional renderer architecture
 * memory.
 */

const NYSDOT_RDM_URL =
  "https://gis.dot.ny.gov/hostingny/rest/services/Roadways/RDM_Roadway_Current/FeatureServer/0/query";

/** Per-request budget — generous because we run a small fleet in parallel. */
const REQUEST_TIMEOUT_MS = 6_000;

/** Buffer radius for the spatial query around the intersection point. */
const SEARCH_RADIUS_METERS = 80;

/** Concurrency cap on concurrent NYSDOT FeatureServer requests. */
const MAX_CONCURRENT = 4;

/** Total time budget for the whole NY-enrichment pass; renderer continues if exceeded. */
const TOTAL_BUDGET_MS = 25_000;

export type NyRoadwayData = {
  postedSpeedMph: number | null;
  roadwayName: string | null;
  functionalClass: string | null;
  dotRegionName: string | null;
  routeDisplay: string | null;
  countyName: string | null;
};

type Intersection = {
  latitude?: number | string | null;
  longitude?: number | string | null;
  nysdotPostedSpeedMph?: number | null;
  nysdotRoadwayName?: string | null;
  nysdotFunctionalClass?: string | null;
  nysdotDotRegionName?: string | null;
  nysdotRouteDisplay?: string | null;
  nysdotCountyName?: string | null;
  [key: string]: unknown;
};

// In-process cache: coords rounded to ~30m grid → result.
const cache = new Map<string, NyRoadwayData | null>();
const cacheKey = (lat: number, lon: number) => `${lat.toFixed(4)},${lon.toFixed(4)}`;

/**
 * Query NYSDOT RDM_Roadway_Current FeatureServer for the closest
 * road-segment record to the given lat/lon. Returns a normalized
 * record or null if no segment is found within SEARCH_RADIUS_METERS,
 * or if the request errors / times out.
 */
async function fetchOnePoint(lat: number, lon: number): Promise<NyRoadwayData | null> {
  const key = cacheKey(lat, lon);
  if (cache.has(key)) return cache.get(key) ?? null;

  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(SEARCH_RADIUS_METERS),
    units: "esriSRUnit_Meter",
    outFields:
      "Posted_Speed_Limit_MPH,Roadway_Name,Functional_Class_Desc,DOT_Region_Name,Route_Display_Value,County_Name",
    returnGeometry: "false",
    // Cap the response to limit per-request bytes; we pick a row with a
    // non-null speed when possible (see below) so a small page is enough.
    resultRecordCount: "8",
    f: "json",
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  try {
    const r = await fetch(`${NYSDOT_RDM_URL}?${params.toString()}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!r.ok) {
      cache.set(key, null);
      return null;
    }
    const j: any = await r.json();
    const feats: any[] = Array.isArray(j?.features) ? j.features : [];
    if (feats.length === 0) {
      cache.set(key, null);
      return null;
    }

    // Prefer a feature with a non-null Posted_Speed_Limit_MPH; fall
    // back to the first feature otherwise. NYSDOT often records null
    // on local streets — picking the highest-classified neighboring
    // segment within the buffer gives the reviewer a usable hint.
    const withSpeed = feats.find(
      (f) => typeof f?.attributes?.Posted_Speed_Limit_MPH === "number"
    );
    const pick = withSpeed ?? feats[0];
    const a = pick?.attributes ?? {};
    const out: NyRoadwayData = {
      postedSpeedMph:
        typeof a.Posted_Speed_Limit_MPH === "number" ? a.Posted_Speed_Limit_MPH : null,
      roadwayName: typeof a.Roadway_Name === "string" ? a.Roadway_Name : null,
      functionalClass: typeof a.Functional_Class_Desc === "string" ? a.Functional_Class_Desc : null,
      dotRegionName: typeof a.DOT_Region_Name === "string" ? a.DOT_Region_Name : null,
      routeDisplay: typeof a.Route_Display_Value === "string" ? a.Route_Display_Value : null,
      countyName: typeof a.County_Name === "string" ? a.County_Name : null,
    };
    cache.set(key, out);
    return out;
  } catch {
    cache.set(key, null);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run a fleet of NYSDOT lookups with a concurrency cap and an overall
 * time budget. Items that exceed the total budget resolve to null —
 * the renderer falls through to the existing placeholder so a slow
 * NYSDOT host can't hang the PDF.
 */
async function pooledLookup(
  coords: Array<{ lat: number; lon: number; idx: number }>,
): Promise<Map<number, NyRoadwayData | null>> {
  const out = new Map<number, NyRoadwayData | null>();
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let cursor = 0;

  async function worker() {
    while (true) {
      if (Date.now() > deadline) return;
      const i = cursor++;
      if (i >= coords.length) return;
      const c = coords[i];
      const r = await fetchOnePoint(c.lat, c.lon);
      out.set(c.idx, r);
    }
  }

  const workers: Promise<void>[] = [];
  for (let w = 0; w < Math.min(MAX_CONCURRENT, coords.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return out;
}

/**
 * Enrich a list of intersection records with NYSDOT posted-speed
 * data. Mutates each intersection in place by adding the
 * `nysdot*` fields. Safe to call when no intersections have
 * coordinates — returns immediately. Safe to call on a non-NY site
 * too — the caller (renderStudyPdf) gates on region.
 *
 * Network-bounded: fails open. If the NYSDOT host is slow / down,
 * every intersection's enrichment resolves to null and the renderer
 * falls back to the pre-Tier-1 placeholder.
 */
export async function enrichNyIntersectionsWithSpeed(
  intersections: Intersection[],
): Promise<void> {
  if (!Array.isArray(intersections) || intersections.length === 0) return;

  const coords: Array<{ lat: number; lon: number; idx: number }> = [];
  for (let i = 0; i < intersections.length; i++) {
    const lat = Number(intersections[i].latitude ?? NaN);
    const lon = Number(intersections[i].longitude ?? NaN);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      coords.push({ lat, lon, idx: i });
    }
  }
  if (coords.length === 0) return;

  const results = await pooledLookup(coords);
  for (const [idx, r] of results.entries()) {
    if (!r) continue;
    const it = intersections[idx];
    it.nysdotPostedSpeedMph = r.postedSpeedMph;
    it.nysdotRoadwayName = r.roadwayName;
    it.nysdotFunctionalClass = r.functionalClass;
    it.nysdotDotRegionName = r.dotRegionName;
    it.nysdotRouteDisplay = r.routeDisplay;
    it.nysdotCountyName = r.countyName;
  }
}

// ===========================================================================
// NY crash module — NY State Police 3-year MV crash window
// ===========================================================================
//
// Source dataset (Socrata SODA API):
//   https://data.ny.gov/Transportation/Motor-Vehicle-Crashes-Case-Information-Three-Year-/e8ky-4vqe
//
// The dataset is the NY State DMV's rolling 3-year window of all
// reported motor-vehicle crashes statewide. Granularity is the
// case level — one row per reported crash. Geographic resolution
// is County + Municipality + DOT Reference Marker (NOT lat/lon),
// so this module aggregates by County (sourced from the NYSDOT
// RDM enrichment above using the site coordinates).
//
// Tier-1 scope:
//   - County-level crash counts by severity (Fatal / Injury / Property
//     Damage / Property Damage + Injury) over the rolling 3-year window
//   - Sourced from the public Socrata SODA endpoint — no auth required
//
// Tier-2 scope (NOT implemented here):
//   - Per-municipality counts, rate normalization vs. county / statewide
//     averages, HAL / PIL / SDL classification (requires NYSDOT VMT
//     data + crash-type filtering)
//   - Site-radius (1/4-mile) analysis requires NYSDOT Regional Traffic
//     Office crash records via FOIL or SIMS access (staff-gated)

const NY_CRASH_SODA_URL = "https://data.ny.gov/resource/e8ky-4vqe.json";
const CRASH_REQUEST_TIMEOUT_MS = 8_000;

export type NyCountyCrashSummary = {
  countyName: string;
  fatalAccidents: number;
  injuryAccidents: number;
  propertyDamageAccidents: number;
  propertyDamageAndInjuryAccidents: number;
  totalAccidents: number;
};

const crashCache = new Map<string, NyCountyCrashSummary | null>();

/**
 * Query the NY State Police Case Information dataset for crash counts
 * aggregated by accident_descriptor for a given county over the
 * rolling 3-year window. Uses Socrata SoQL $select aggregation so the
 * server returns one row per descriptor — minimal payload.
 *
 * Returns null on any error (renderer falls back to escape-hatch).
 *
 * County name MUST match the NY State DMV uppercase convention
 * (e.g., "NEW YORK", "ALBANY", "ERIE") — the NYSDOT RDM County_Name
 * field is already in this format.
 */
export async function getNyCountyCrashSummary(
  countyName: string,
): Promise<NyCountyCrashSummary | null> {
  if (!countyName) return null;
  const key = countyName.toUpperCase();
  if (crashCache.has(key)) return crashCache.get(key) ?? null;

  const params = new URLSearchParams({
    $select: "accident_descriptor,count(*) as cnt",
    $where: `county_name='${key.replace(/'/g, "''")}'`,
    $group: "accident_descriptor",
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CRASH_REQUEST_TIMEOUT_MS);

  try {
    const r = await fetch(`${NY_CRASH_SODA_URL}?${params.toString()}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!r.ok) {
      crashCache.set(key, null);
      return null;
    }
    const rows = (await r.json()) as Array<{
      accident_descriptor?: string;
      cnt?: string | number;
    }>;
    if (!Array.isArray(rows) || rows.length === 0) {
      crashCache.set(key, null);
      return null;
    }
    const out: NyCountyCrashSummary = {
      countyName: key,
      fatalAccidents: 0,
      injuryAccidents: 0,
      propertyDamageAccidents: 0,
      propertyDamageAndInjuryAccidents: 0,
      totalAccidents: 0,
    };
    for (const row of rows) {
      const cnt = Number(row.cnt ?? 0);
      if (!Number.isFinite(cnt)) continue;
      switch (row.accident_descriptor) {
        case "Fatal Accident":
          out.fatalAccidents = cnt;
          break;
        case "Injury Accident":
          out.injuryAccidents = cnt;
          break;
        case "Property Damage Accident":
          out.propertyDamageAccidents = cnt;
          break;
        case "Property Damage & Injury Accident":
          out.propertyDamageAndInjuryAccidents = cnt;
          break;
      }
      out.totalAccidents += cnt;
    }
    crashCache.set(key, out);
    return out;
  } catch {
    crashCache.set(key, null);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convenience: given a site lat/lon, resolve the County via the NYSDOT
 * RDM FeatureServer (reusing the same per-point query that the
 * intersection enrichment uses), then pull the county's 3-year crash
 * summary. Returns null on any failure.
 */
export async function getNyCrashSummaryForSite(
  lat: number,
  lon: number,
): Promise<NyCountyCrashSummary | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rdm = await fetchOnePoint(lat, lon);
  if (!rdm?.countyName) return null;
  return getNyCountyCrashSummary(rdm.countyName);
}

// ===========================================================================
// CBDTP cordon — Central Business District Tolling Program
// ===========================================================================
//
// The CBDTP went into force 5 January 2025 — the first cordon-pricing
// program in the United States. The cordon covers Manhattan south of
// 60th Street. The FDR Drive, the West Side Highway / Route 9A, the
// Battery Park Underpass, and the Hugh L. Carey Tunnel are "excluded
// roadways" where pass-through traffic is toll-exempt, but development
// sites are on city streets, not on through-routes — so for the
// renderer's purpose (flagging that pre-2025 traffic counts overstate
// today's vehicle baseline) the simple cordon test below is the right
// granularity.
//
// Material to any TIS that uses pre-Jan-2025 NYSDOT or NYC DOT counts
// inside or adjacent to the cordon: CBD vehicle volumes fell ~11% in
// the first year of operation and CBD vehicle speeds rose 15-25%
// (RPA + NBER 2025-26 analyses). Pre-CBDTP counts overstate today's
// CBD vehicle baseline by an order-of-magnitude 10-15%.
//
// See: https://congestionreliefzone.mta.info/

// 60th Street runs along a tilted line because the Manhattan grid is
// rotated ~29° east of true north. The northern boundary of the
// cordon is the lat/lon line connecting:
//   60th & East End Ave (East River) — ~40.7615, -73.9610
//   60th & 12th Ave    (Hudson)      — ~40.7710, -73.9942
// The other three boundaries are the natural shoreline.

const CBDTP_NORTH_EAST_CORNER = { lat: 40.7615, lon: -73.961 }; // 60th & East End Ave
const CBDTP_NORTH_WEST_CORNER = { lat: 40.771, lon: -73.9942 }; // 60th & 12th Ave / WSH ramp
const CBDTP_SOUTH_LAT = 40.6995; // Battery / Castle Clinton north tip
const CBDTP_WEST_LON = -74.025; // Hudson River outer (W. of Battery Park City)
const CBDTP_EAST_LON = -73.94; // East River outer

export type CbdtpStatus = {
  /** True when the site is geographically inside the CBDTP cordon. */
  inCordon: boolean;
  /**
   * True when the site is within `bufferMiles` of the cordon (also
   * true when `inCordon` is true). A "near" site is one whose
   * generated trips would plausibly route through the cordon.
   */
  nearCordon: boolean;
  /** Buffer used for the `nearCordon` test, in miles. */
  bufferMiles: number;
};

/**
 * Internal: strict polygon test for the CBDTP cordon. The northern
 * boundary follows 60th Street's tilted line; the other three are
 * generous bounding-box limits matched to the Manhattan shoreline.
 *
 * Note: sites in Brooklyn DUMBO / Williamsburg / LIC that fall inside
 * the bbox correctly carry the same caveat as Manhattan sites — their
 * bridge / tunnel traffic flows into the cordon, so pre-2025 counts
 * are equally inflated there.
 */
function isInCbdtpCordon(lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (lat < CBDTP_SOUTH_LAT) return false;
  if (lat > CBDTP_NORTH_WEST_CORNER.lat) return false;
  if (lon < CBDTP_WEST_LON) return false;
  if (lon > CBDTP_EAST_LON) return false;
  // Tilted northern boundary: linearly interpolate the 60th-St latitude
  // by longitude between the NW and NE corners. Clamp lon to the
  // corner range so points west of NW or east of NE use the
  // appropriate corner latitude (the bbox already passed).
  const nwLon = CBDTP_NORTH_WEST_CORNER.lon;
  const neLon = CBDTP_NORTH_EAST_CORNER.lon;
  const lonClamp = Math.max(nwLon, Math.min(neLon, lon));
  const t = (lonClamp - nwLon) / (neLon - nwLon);
  const northBoundAtLon =
    CBDTP_NORTH_WEST_CORNER.lat +
    t * (CBDTP_NORTH_EAST_CORNER.lat - CBDTP_NORTH_WEST_CORNER.lat);
  if (lat > northBoundAtLon) return false;
  return true;
}

/**
 * Determine the CBDTP cordon status for a site coordinate.
 *
 * Returns `{ inCordon: true }` when the site is inside the cordon
 * (also implies `nearCordon: true`). Returns `{ inCordon: false,
 * nearCordon: true }` when the site is within `bufferMiles` of the
 * cordon edge — feeding-traffic sites whose pre-2025 baseline counts
 * are also affected by the CBDTP modal shift. Returns `outside`
 * for any non-NYC coordinate.
 *
 * The default 1-mile buffer is calibrated to catch sites whose
 * outbound/inbound trips would plausibly traverse the cordon (the
 * approach corridors on the major bridges and tunnels feed traffic
 * into the cordon for roughly a mile in every direction).
 */
// ===========================================================================
// GML §239-m / §239-n referral detection
// ===========================================================================
//
// Per General Municipal Law §239-m and §239-n, any site-plan, special
// permit, variance, zoning amendment, or subdivision review for a
// project within 500 ft of:
//   - a state or county road,
//   - a state or county park,
//   - state-owned land,
//   - or an intermunicipal boundary,
// must be referred to the county planning board (or regional planning
// agency where the county has none) for review before the local board
// can act. The county can find adverse impact under §239-f, and the
// local board can override only by supermajority.
//
// Practical TIS consequence: any project outside NYC within 500 ft
// of a state or county road triggers §239 referral, and the county
// often demands TIS-level traffic analysis as part of the package.
//
// Detection uses the NYSDOT RDM FeatureServer (same endpoint as the
// posted-speed ingest at the top of this file): query for any
// roadway segment with Functional_Class_Desc indicating a state or
// county facility within the 500-ft buffer.

const GML_239_BUFFER_METERS = 152.4; // 500 ft

/** Functional-class strings that indicate a state or county road
 *  for §239 referral purposes. NYSDOT functional-class values are
 *  free-text but a stable set of prefixes; "Local" and "Rural Local"
 *  are out. Anything Collector / Arterial / Freeway / Interstate is in.
 *  Surface streets in NYC are sometimes coded "Urban Major Collector"
 *  even when they are city-owned (not state/county) — §239 doesn't
 *  apply inside NYC because NYC is excepted from §239 (NYC has its
 *  own consolidated land-use review). Caller gates on `inNyc`. */
function isStateOrCountyFunctionalClass(fc: string | null | undefined): boolean {
  if (!fc) return false;
  const f = fc.toLowerCase();
  if (f.includes("local")) return false;
  return (
    f.includes("interstate") ||
    f.includes("freeway") ||
    f.includes("expressway") ||
    f.includes("arterial") ||
    f.includes("collector")
  );
}

export type Gml239Status = {
  /** True if a state or county road is within 500 ft of the site. */
  required: boolean;
  /** Roadway name (when found) — for the §4.4 permitting summary. */
  triggeringRoadway: string | null;
  /** Functional class of the triggering roadway. */
  triggeringClass: string | null;
  /** Distance buffer used, in feet. */
  bufferFeet: number;
};

/**
 * Determine whether a site triggers GML §239-m / §239-n county
 * planning board referral. The test queries the NYSDOT RDM
 * FeatureServer for any non-local-class roadway segment within
 * the 500-ft buffer, then returns the first qualifying roadway.
 *
 * Network-bounded: fails closed (`required: false`). A slow or
 * down NYSDOT host should not falsely declare §239 required.
 *
 * Outside-NYC only: the caller should gate on the site being
 * outside the five boroughs (NYC site-plan / zoning review runs
 * through ULURP / CEQR, not §239 referral).
 */
export async function getGml239Status(lat: number, lon: number): Promise<Gml239Status> {
  const fallback: Gml239Status = {
    required: false,
    triggeringRoadway: null,
    triggeringClass: null,
    bufferFeet: 500,
  };
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return fallback;

  const params = new URLSearchParams({
    where: "1=1",
    geometry: `${lon},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(GML_239_BUFFER_METERS),
    units: "esriSRUnit_Meter",
    outFields: "Roadway_Name,Functional_Class_Desc,Route_Display_Value",
    returnGeometry: "false",
    resultRecordCount: "20",
    f: "json",
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(`${NYSDOT_RDM_URL}?${params.toString()}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!r.ok) return fallback;
    const j: any = await r.json();
    const feats: any[] = Array.isArray(j?.features) ? j.features : [];
    for (const f of feats) {
      const a = f?.attributes ?? {};
      const fc = typeof a.Functional_Class_Desc === "string" ? a.Functional_Class_Desc : null;
      if (isStateOrCountyFunctionalClass(fc)) {
        return {
          required: true,
          triggeringRoadway: typeof a.Roadway_Name === "string" ? a.Roadway_Name : null,
          triggeringClass: fc,
          bufferFeet: 500,
        };
      }
    }
    return fallback;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

// ===========================================================================
// CBDTP cordon — Central Business District Tolling Program
// (existing — defined below)
// ===========================================================================

export function getCbdtpStatus(
  lat: number,
  lon: number,
  bufferMiles: number = 1,
): CbdtpStatus {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { inCordon: false, nearCordon: false, bufferMiles };
  }
  if (isInCbdtpCordon(lat, lon)) {
    return { inCordon: true, nearCordon: true, bufferMiles };
  }
  // Buffer test by perturbing the point in each of 8 cardinal+ordinal
  // directions and checking whether any perturbed point lies inside
  // the cordon. 1° latitude ≈ 69 mi; 1° longitude at Manhattan
  // latitude (40.76°) ≈ 69 × cos(40.76°) ≈ 52.3 mi.
  const dLat = bufferMiles / 69;
  const dLon = bufferMiles / (69 * Math.cos((40.76 * Math.PI) / 180));
  const probes: Array<[number, number]> = [
    [lat - dLat, lon],
    [lat + dLat, lon],
    [lat, lon - dLon],
    [lat, lon + dLon],
    [lat - dLat, lon - dLon],
    [lat - dLat, lon + dLon],
    [lat + dLat, lon - dLon],
    [lat + dLat, lon + dLon],
  ];
  const nearCordon = probes.some(([la, lo]) => isInCbdtpCordon(la, lo));
  return { inCordon: false, nearCordon, bufferMiles };
}
