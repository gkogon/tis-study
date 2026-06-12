/**
 * NYC transit + active-mode context adapter — Tier-1 ingest for the
 * NYC CEQR overlay (renderCeqrNyc) and the NYSDOT TIS shell §1.4
 * transit context block (renderTisNewYork) when the site is in the
 * five boroughs.
 *
 * Two datasets:
 *
 *   1. MTA Subway Stations — data.ny.gov resource `39hk-dx4f`.
 *      Fields used: `stop_name`, `gtfs_latitude`, `gtfs_longitude`,
 *      `daytime_routes`, `borough`, `division`. Returns all stations
 *      within a configurable radius of the site (default 0.5 mi —
 *      CEQR Tech Manual Ch 16 typical walk-shed for transit
 *      accessibility analyses).
 *
 *   2. NYC DOT Bicycle Counters — data.cityofnewyork.us resource
 *      `smn3-rzf9`. Fields used: `name`, `latitude`, `longitude`,
 *      `domain`. Returns the nearest counter plus distance — useful
 *      to anchor the §C.3 pedestrian/bike LOS analysis to a real
 *      reference counter where one exists nearby.
 *
 * Network-bounded: both lookups time out at 8 seconds and fail open
 * (return empty arrays / null) — the renderer falls through to its
 * pre-Tier-1 placeholder. Concurrency cap shared with the other NY
 * pre-computes via Promise.all in renderStudyPdf.
 *
 * Spec backing: new-york-tis-spec.md §3.7 + §3.8 + §12 hook #7.
 * Pedestrian counts (data.cityofnewyork.us/resource/2de2-6x2h) were
 * investigated but the SODA endpoint returned empty JSON — the
 * dataset appears to be only published as shp/xlsx, not as a
 * queryable API. Skipped for this iteration.
 */

const MTA_SUBWAY_URL = "https://data.ny.gov/resource/39hk-dx4f.json";
const NYC_BIKE_COUNTERS_URL = "https://data.cityofnewyork.us/resource/smn3-rzf9.json";
const REQUEST_TIMEOUT_MS = 8_000;

// ===========================================================================
// Subway stations within walking distance
// ===========================================================================

export type NycSubwayStation = {
  name: string;
  routes: string;
  division: string;
  borough: string;
  latitude: number;
  longitude: number;
  distanceMi: number;
};

export type NycSubwayContext = {
  /** Stations within `radiusMi` of the site, ordered by distance ascending. */
  stations: NycSubwayStation[];
  /** Radius used for the lookup, in miles. */
  radiusMi: number;
  /** Unique daytime routes accessible from the catchment (e.g. "1,2,3,A,C,E"). */
  routesAvailable: string[];
};

const stationCache = new Map<string, NycSubwayContext | null>();
const stationCacheKey = (lat: number, lon: number, r: number) =>
  `${lat.toFixed(4)},${lon.toFixed(4)},${r.toFixed(2)}`;

/**
 * Haversine distance in miles between two lat/lon pairs. Approximate but
 * adequate for the half-mile catchment scale used here.
 */
function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8; // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Return MTA subway stations within `radiusMi` of the given coordinates,
 * sorted by distance ascending. Caches per (lat, lon, radius) to avoid
 * re-fetching the full dataset on repeated calls in the same process.
 *
 * Fails open on any error / timeout — returns an empty list.
 */
export async function getNycSubwayContext(
  lat: number,
  lon: number,
  radiusMi: number = 0.5,
): Promise<NycSubwayContext> {
  const fallback: NycSubwayContext = { stations: [], radiusMi, routesAvailable: [] };
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return fallback;
  const key = stationCacheKey(lat, lon, radiusMi);
  if (stationCache.has(key)) return stationCache.get(key) ?? fallback;

  // Roughly a ±0.0145°/mi at NYC latitude. We bbox-prefilter via SoQL
  // `within_box` to avoid pulling all 472 stations on every call.
  const latPad = radiusMi / 69;
  const lonPad = radiusMi / (69 * Math.cos((lat * Math.PI) / 180));
  const params = new URLSearchParams({
    $select: "stop_name,gtfs_latitude,gtfs_longitude,daytime_routes,division,borough",
    $where: `gtfs_latitude between ${lat - latPad} and ${lat + latPad} and gtfs_longitude between ${lon - lonPad} and ${lon + lonPad}`,
    $limit: "200",
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${MTA_SUBWAY_URL}?${params.toString()}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      stationCache.set(key, null);
      return fallback;
    }
    const rows = (await res.json()) as Array<{
      stop_name?: string;
      gtfs_latitude?: string | number;
      gtfs_longitude?: string | number;
      daytime_routes?: string;
      division?: string;
      borough?: string;
    }>;
    const stations: NycSubwayStation[] = [];
    for (const row of rows) {
      const sLat = Number(row.gtfs_latitude);
      const sLon = Number(row.gtfs_longitude);
      if (!Number.isFinite(sLat) || !Number.isFinite(sLon)) continue;
      const d = haversineMi(lat, lon, sLat, sLon);
      if (d > radiusMi) continue;
      stations.push({
        name: row.stop_name ?? "—",
        routes: row.daytime_routes ?? "",
        division: row.division ?? "",
        borough: row.borough ?? "",
        latitude: sLat,
        longitude: sLon,
        distanceMi: d,
      });
    }
    stations.sort((a, b) => a.distanceMi - b.distanceMi);
    // De-dup routes across all stations
    const routeSet = new Set<string>();
    for (const s of stations) {
      for (const r of s.routes.split(/\s+/)) {
        if (r) routeSet.add(r);
      }
    }
    const ctx: NycSubwayContext = {
      stations,
      radiusMi,
      routesAvailable: Array.from(routeSet).sort(),
    };
    stationCache.set(key, ctx);
    return ctx;
  } catch {
    stationCache.set(key, null);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

// ===========================================================================
// Bicycle counter proximity
// ===========================================================================

export type NycBikeCounter = {
  name: string;
  latitude: number;
  longitude: number;
  distanceMi: number;
};

export type NycBikeContext = {
  /** Nearest counter within `radiusMi`; null if none within radius. */
  nearest: NycBikeCounter | null;
  /** Total counters within the radius. */
  countWithin: number;
  /** Radius used for the lookup, in miles. */
  radiusMi: number;
};

const bikeCache = new Map<string, NycBikeContext | null>();

/**
 * Return the nearest NYC DOT bicycle counter within `radiusMi` of the
 * given coordinates plus the count of counters within that radius.
 * The bike-counter network is a single dataset (~50 counters
 * citywide), small enough to pull on every miss and filter locally.
 */
export async function getNycBikeContext(
  lat: number,
  lon: number,
  radiusMi: number = 1,
): Promise<NycBikeContext> {
  const fallback: NycBikeContext = { nearest: null, countWithin: 0, radiusMi };
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return fallback;
  const key = stationCacheKey(lat, lon, radiusMi);
  if (bikeCache.has(key)) return bikeCache.get(key) ?? fallback;

  const params = new URLSearchParams({
    $select: "name,latitude,longitude,domain",
    $limit: "200",
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${NYC_BIKE_COUNTERS_URL}?${params.toString()}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      bikeCache.set(key, null);
      return fallback;
    }
    const rows = (await res.json()) as Array<{
      name?: string;
      latitude?: string | number;
      longitude?: string | number;
      domain?: string;
    }>;
    let nearest: NycBikeCounter | null = null;
    let countWithin = 0;
    for (const row of rows) {
      const cLat = Number(row.latitude);
      const cLon = Number(row.longitude);
      if (!Number.isFinite(cLat) || !Number.isFinite(cLon)) continue;
      const d = haversineMi(lat, lon, cLat, cLon);
      if (d <= radiusMi) {
        countWithin++;
        if (!nearest || d < nearest.distanceMi) {
          nearest = {
            name: row.name ?? "—",
            latitude: cLat,
            longitude: cLon,
            distanceMi: d,
          };
        }
      }
    }
    const ctx: NycBikeContext = { nearest, countWithin, radiusMi };
    bikeCache.set(key, ctx);
    return ctx;
  } catch {
    bikeCache.set(key, null);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Combined transit + bike context — one function the renderer can call
 * (after the renderStudyPdf pre-compute has stashed the result).
 */
export type NycTransitContext = {
  subway: NycSubwayContext;
  bike: NycBikeContext;
};

export async function getNycTransitContext(
  lat: number,
  lon: number,
  subwayRadiusMi: number = 0.5,
  bikeRadiusMi: number = 1,
): Promise<NycTransitContext> {
  const [subway, bike] = await Promise.all([
    getNycSubwayContext(lat, lon, subwayRadiusMi),
    getNycBikeContext(lat, lon, bikeRadiusMi),
  ]);
  return { subway, bike };
}
