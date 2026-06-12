/**
 * TfL PTAL lookup — auto-resolves the London Public Transport
 * Accessibility Level band for a (lat, lon) by point-in-polygon query
 * against the TfL GIS Open Data Hub PTAL 2023 100m grid.
 *
 * Why a live lookup vs. a shipped snapshot:
 *   - The grid is ~25 MB and refreshes ~annually with WebCAT updates;
 *     shipping a snapshot creates a maintenance burden and silent
 *     staleness when TfL ships a new WebCAT version.
 *   - One query per TIS render is fine — TIS generation already takes
 *     seconds end-to-end and a TfL FeatureServer query lands in
 *     ~200–500 ms. An in-memory cache amortises repeated coords to ~0.
 *   - Fails gracefully: out-of-extent (anywhere outside Greater London)
 *     and network failures both resolve to null, which the engine
 *     translates back to the flat 0.38 london_metro fallback — same as
 *     the pre-PTAL behavior, so the worst case is "no improvement"
 *     rather than "broken".
 *
 * Dataset:
 *   - PTAL 2023 Grid 100m × 100m (TfL), Open Government Licence v3.0.
 *   - FeatureServer layer 33; spatial reference EPSG:27700 (BNG); the
 *     server reprojects WGS84 inputs server-side so we pass lat/lon
 *     directly with inSR=4326.
 *   - Updated to WebCAT 3.0 scores (Elizabeth line, DLR upgrades, bus
 *     network changes).
 */

import { logger } from "./logger";
import type { PTALBand } from "./mode-share";

const PTAL_FEATURESERVER_QUERY_URL =
  "https://services1.arcgis.com/YswvgzOodUvqkoCN/arcgis/rest/services/PTAL_2023_Grid_100m_100m/FeatureServer/33/query";

// Greater London WGS84 bbox (approximate). Cheap pre-check so we don't
// burn a network round-trip on every non-London project. The PTAL grid
// extent in BNG is xmin 503 568, ymin 155 850, xmax 561 957, ymax 200 933;
// the WGS84 box below is a slightly-padded rectangle around that.
const LONDON_BBOX = {
  latMin: 51.27,
  latMax: 51.71,
  lonMin: -0.55,
  lonMax: 0.34,
};

const REQUEST_TIMEOUT_MS = 3500;

// Cache keyed by quantized lat/lon (4 decimal places ≈ 11 m, finer than
// the 100 m grid, so different snaps inside one cell collapse). Map is
// process-local; that's fine — TIS reports are deterministic per coord
// and the working set is tiny.
const cache = new Map<string, PtalLookupResult | null>();

export type PtalLookupResult = {
  band: PTALBand;
  ai: number;
};

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

function isLondonBand(s: string): s is PTALBand {
  return s === "0" || s === "1a" || s === "1b" || s === "2" || s === "3" ||
         s === "4" || s === "5" || s === "6a" || s === "6b";
}

/**
 * Look up the PTAL band and Accessibility Index for a coordinate.
 * Returns null when:
 *   - The coordinate is outside the Greater London bbox.
 *   - The FeatureServer returns no matching cell (point falls in a
 *     gap in the grid — e.g. inside a river polygon, or just outside
 *     the published grid extent).
 *   - The query times out or errors.
 *
 * Callers (the engine) MUST treat null as "no PTAL band — fall back to
 * the flat london_metro auto-mode share". Never throw on lookup failure.
 */
export async function lookupLondonPtal(
  lat: number,
  lon: number,
): Promise<PtalLookupResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < LONDON_BBOX.latMin || lat > LONDON_BBOX.latMax) return null;
  if (lon < LONDON_BBOX.lonMin || lon > LONDON_BBOX.lonMax) return null;

  const key = cacheKey(lat, lon);
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const geometry = JSON.stringify({
    x: lon,
    y: lat,
    spatialReference: { wkid: 4326 },
  });
  const params = new URLSearchParams({
    geometry,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    outFields: "PTAL_2023,AI",
    returnGeometry: "false",
    f: "json",
  });
  const url = `${PTAL_FEATURESERVER_QUERY_URL}?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      logger.warn(`TfL PTAL lookup HTTP ${resp.status} for (${lat}, ${lon})`);
      cache.set(key, null);
      return null;
    }
    const body = await resp.json() as {
      features?: Array<{ attributes?: { PTAL_2023?: string; AI?: number } }>;
      error?: { code: number; message: string };
    };
    if (body.error) {
      logger.warn(`TfL PTAL lookup error ${body.error.code} ${body.error.message}`);
      cache.set(key, null);
      return null;
    }
    const feature = body.features?.[0];
    const band = feature?.attributes?.PTAL_2023;
    const ai = feature?.attributes?.AI;
    if (!band || !isLondonBand(band) || typeof ai !== "number") {
      cache.set(key, null);
      return null;
    }
    const result: PtalLookupResult = { band, ai };
    cache.set(key, result);
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`TfL PTAL lookup failed for (${lat}, ${lon}): ${msg}`);
    cache.set(key, null);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Test-only — clear the in-memory cache. Production callers don't need
 * to invalidate; the cache is per-process and entries are cheap.
 */
export function _clearPtalCacheForTests(): void {
  cache.clear();
}
