/**
 * GDOT / ARC live-data adapter — Georgia equivalent of the FDOT TDA
 * adapter. Pulls per-intersection live AADT + functional classification
 * for the GA TIS renderer to anchor its existing-conditions narrative.
 *
 * Source landscape (more fragmented than FDOT):
 *
 *   - GDOT's official traffic-count portal is the Drakewell-hosted TADA
 *     app (https://gdottrafficdata.drakewell.com/) — a JS SPA with no
 *     documented public REST API. Bulk data ships as Excel exports.
 *
 *   - **Atlanta Regional Commission (ARC) Open Data** publishes the
 *     authoritative AADT layer for the 21-county metro at
 *     https://opendata.atlantaregional.com/, backed by an ArcGIS Online
 *     hosted FeatureServer. This adapter uses ARC for in-metro sites.
 *
 *   - Statewide outside the ARC footprint, no clean public REST endpoint
 *     exists today. The GA renderer's prose surfaces "verify against
 *     GDOT TADA" in that case — manual lookup is the documented path.
 *
 * Same fail-open contract as `fdot-live-data.ts`: errors / timeouts leave
 * intersections untouched, the renderer's existing prose stands.
 */

/**
 * Two source endpoints, tried in order. ARC's hosted layer is the
 * authoritative metro-Atlanta source (covers ~21 counties at higher
 * resolution); GDOT Open Data Hub publishes a statewide AADT layer
 * backed by the GDOT GIS team's hosted ArcGIS Online org. For sites
 * inside the ARC footprint we still prefer ARC because the metro
 * coverage is denser; ARC is queried first, then GDOT statewide is the
 * fallback. The returned `source` field discloses which won.
 *
 * GDOT statewide endpoint discovery: GDOT publishes traffic count data
 * via the "Traffic Counts" service in their Open Data Hub
 * (https://data-gdot.opendata.arcgis.com/). The endpoint URL changes
 * when GDOT republishes; we cache the most-recent verified URL but the
 * adapter is tolerant of a 404 here (just falls through to the
 * unavailable branch).
 */
const ARC_AADT_URL =
  "https://services1.arcgis.com/IkktFdUAcY3WrH25/arcgis/rest/services/Traffic_Counts/FeatureServer/0/query";
const GDOT_STATEWIDE_AADT_URL =
  "https://services1.arcgis.com/aRfeIYW6Y5KhCFGz/arcgis/rest/services/Traffic_Counts/FeatureServer/0/query";

const REQUEST_TIMEOUT_MS = 6_000;
const TOTAL_BUDGET_MS = 30_000;
const MAX_CONCURRENT = 4;
const DEFAULT_SEARCH_RADIUS_M = 80;
const PROGRESSIVE_RADII_M = [80, 200, 500];

export type GdotSegmentSnapshot = {
  /** AADT from the ARC Traffic Counts layer. */
  aadt: number | null;
  /** Reported count year. */
  aadtYear: number | null;
  /** Route name from the count station (e.g., "SR 400", "I-285"). */
  routeName: string | null;
  /** County (ARC field). */
  county: string | null;
  /** Source attribution — disclosed in renderer prose. */
  source: "arc_atlanta" | "gdot_statewide" | "unavailable";
  /** Which progressive radius (m) returned the match. */
  matchedRadiusM?: number;
};

type Intersection = {
  latitude?: number | string | null;
  longitude?: number | string | null;
  gdotSnapshot?: GdotSegmentSnapshot;
  existingAadt?: number | null;
  aadt?: number | null;
  aadtYear?: number | null;
};

type ArcGisFeature = { attributes?: Record<string, unknown> };

/**
 * Enrich each intersection with the closest ARC AADT count. Mutates in
 * place; returns count enriched.
 */
export async function enrichGdotIntersections(
  intersections: Intersection[],
): Promise<number> {
  if (!intersections.length) return 0;
  const start = Date.now();
  let enriched = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < intersections.length) {
      if (Date.now() - start > TOTAL_BUDGET_MS) return;
      const idx = cursor++;
      const it = intersections[idx];
      const lat = Number(it.latitude ?? NaN);
      const lon = Number(it.longitude ?? NaN);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      try {
        const snap = await fetchGdotProgressive(lat, lon);
        if (!snap) continue;
        it.gdotSnapshot = snap;
        if (snap.aadt != null && it.existingAadt == null) it.existingAadt = snap.aadt;
        if (snap.aadt != null && it.aadt == null) it.aadt = snap.aadt;
        if (snap.aadtYear != null && it.aadtYear == null) it.aadtYear = snap.aadtYear;
        enriched++;
      } catch {
        // fail-open
      }
    }
  };

  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, intersections.length) }, () => worker());
  await Promise.all(workers);
  return enriched;
}

/**
 * Site-level snapshot for the GA renderer §4 anchor.
 */
export async function fetchGdotSiteSnapshot(
  lat: number,
  lon: number,
): Promise<GdotSegmentSnapshot | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  try {
    return await fetchGdotProgressive(lat, lon);
  } catch {
    return null;
  }
}

/**
 * Try ARC first at each progressive radius, then GDOT statewide. Returns
 * the first non-empty hit. Statewide-fallback widens coverage to the 138
 * Georgia counties outside the ARC footprint that were previously a
 * documented gap.
 */
async function fetchGdotProgressive(
  lat: number,
  lon: number,
): Promise<GdotSegmentSnapshot | null> {
  for (const radius of PROGRESSIVE_RADII_M) {
    const arc = await fetchFromEndpoint(ARC_AADT_URL, lat, lon, radius, "arc_atlanta");
    if (arc) { arc.matchedRadiusM = radius; return arc; }
  }
  for (const radius of PROGRESSIVE_RADII_M) {
    const gdot = await fetchFromEndpoint(GDOT_STATEWIDE_AADT_URL, lat, lon, radius, "gdot_statewide");
    if (gdot) { gdot.matchedRadiusM = radius; return gdot; }
  }
  return null;
}

async function fetchFromEndpoint(
  endpoint: string,
  lat: number,
  lon: number,
  radiusM: number,
  source: "arc_atlanta" | "gdot_statewide",
): Promise<GdotSegmentSnapshot | null> {
  const params = new URLSearchParams({
    where: "1=1",
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    distance: String(radiusM),
    units: "esriSRUnit_Meter",
    outFields: "*",
    returnGeometry: "false",
    f: "json",
    resultRecordCount: "5",
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(`${endpoint}?${params.toString()}`, { signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) return null;
  let json: { features?: ArcGisFeature[]; error?: unknown };
  try {
    json = (await resp.json()) as { features?: ArcGisFeature[]; error?: unknown };
  } catch {
    return null;
  }
  if (json.error) return null;
  const features = json.features ?? [];
  if (features.length === 0) return null;

  let best = features[0]?.attributes ?? null;
  let bestAadt = asNum(best?.AADT ?? best?.aadt) ?? -1;
  for (let i = 1; i < features.length; i++) {
    const a = features[i].attributes ?? null;
    const v = asNum(a?.AADT ?? a?.aadt) ?? -1;
    if (v > bestAadt) { best = a; bestAadt = v; }
  }
  if (!best) return null;

  return {
    aadt: asNum(best.AADT ?? best.aadt),
    aadtYear: asNum(best.YEAR ?? best.YEAR_ ?? best.AADT_YEAR),
    routeName: asStr(best.ROUTE ?? best.ROADWAY ?? best.STREET ?? best.NAME),
    county: asStr(best.COUNTY ?? best.County),
    source,
  };
}

function asNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function asStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}
