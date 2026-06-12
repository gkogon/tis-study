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
