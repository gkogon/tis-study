/**
 * GDOT 511 NaviGAtor v2 camera inventory.
 *
 * Calls GET /api/v2/get/Cameras?key=... and filters to the Atlanta MSA
 * bounding box. Cached for 30 minutes — the inventory is essentially
 * static and we don't want to flood GDOT's API with repeated requests.
 *
 * Each camera carries one or more `Views` with image URLs pointed at
 * 511ga.org's CCTV viewer. The frontend can iframe or anchor-link to
 * the Url. Static-image snapshots aren't exposed on this key.
 */
import { logger } from "./logger";

const LIVE_BASE = "https://511ga.org";
const CACHE_TTL_MS = 30 * 60_000;

// Atlanta MSA bounding box used by the rest of the analyzer.
const METRO_LAT_MIN = 33.4;
const METRO_LAT_MAX = 34.2;
const METRO_LON_MIN = -84.9;
const METRO_LON_MAX = -83.9;

export type GdotCameraView = {
  id: number;
  url: string;
  description: string;
  enabled: boolean;
};

export type GdotCamera = {
  id: number;
  roadway: string;
  direction: string;
  location: string;
  latitude: number;
  longitude: number;
  views: GdotCameraView[];
};

export type GdotCameraBundle = {
  fetchedAt: string;
  cached: boolean;
  cacheAgeSeconds: number;
  totalStatewide: number;
  cameras: GdotCamera[];
};

type V2Camera = {
  Id: number;
  Source: string;
  SourceId: string;
  Roadway: string;
  Direction: string;
  Latitude: number;
  Longitude: number;
  Location: string;
  SortOrder: number;
  Views: Array<{
    Id: number;
    Url: string;
    Status: string;
    Description: string;
    SortId: number;
  }>;
  Name: string;
};

let cache: { at: number; bundle: GdotCameraBundle } | null = null;
let inflight: Promise<GdotCameraBundle> | null = null;

export async function getGdotCameras(force = false): Promise<GdotCameraBundle> {
  if (!force && cache) {
    const ageMs = Date.now() - cache.at;
    if (ageMs < CACHE_TTL_MS) {
      return { ...cache.bundle, cached: true, cacheAgeSeconds: Math.round(ageMs / 1000) };
    }
  }
  if (inflight) return inflight;
  inflight = (async (): Promise<GdotCameraBundle> => {
    try {
      return await refresh();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function refresh(): Promise<GdotCameraBundle> {
  const startedAt = Date.now();
  const apiKey = process.env.GDOT_511_API_KEY;
  if (!apiKey) {
    return {
      fetchedAt: new Date(startedAt).toISOString(),
      cached: false,
      cacheAgeSeconds: 0,
      totalStatewide: 0,
      cameras: [],
    };
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  let raw: V2Camera[];
  try {
    const r = await fetch(`${LIVE_BASE}/api/v2/get/Cameras?key=${apiKey}`, {
      headers: { "User-Agent": "atlanta-traffic-analyzer/1.0", Accept: "application/json" },
      signal: ctl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    raw = (await r.json()) as V2Camera[];
  } finally {
    clearTimeout(timer);
  }

  // Filter to Atlanta MSA and drop the ones missing coordinates (some
  // statewide cameras report 0,0 placeholder positions).
  const metro = raw.filter(
    (c) =>
      c.Latitude > 0 &&
      c.Longitude < 0 &&
      c.Latitude >= METRO_LAT_MIN &&
      c.Latitude <= METRO_LAT_MAX &&
      c.Longitude >= METRO_LON_MIN &&
      c.Longitude <= METRO_LON_MAX,
  );

  const cameras: GdotCamera[] = metro.map((c) => ({
    id: c.Id,
    roadway: c.Roadway || "",
    direction: c.Direction || "",
    location: c.Location || c.Name || "",
    latitude: c.Latitude,
    longitude: c.Longitude,
    views: (c.Views ?? []).map((v) => ({
      id: v.Id,
      url: v.Url || "",
      description: v.Description || "",
      enabled: v.Status === "Enabled",
    })),
  }));

  const bundle: GdotCameraBundle = {
    fetchedAt: new Date(startedAt).toISOString(),
    cached: false,
    cacheAgeSeconds: 0,
    totalStatewide: raw.length,
    cameras,
  };
  cache = { at: startedAt, bundle };
  logger.info(
    { statewide: raw.length, metro: cameras.length, ms: Date.now() - startedAt },
    "gdot-cameras: refreshed",
  );
  return bundle;
}
