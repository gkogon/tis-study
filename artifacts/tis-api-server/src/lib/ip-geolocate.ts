/**
 * Server-side IP → (lat, lon, country) lookup for personalizing the
 * /demo presets to the visitor's nearest covered metro.
 *
 * Provider: ip-api.com — free, no key required, 45 req/min per source
 * IP. Returns JSON with lat/lon/country/regionName. We send our server
 * IP as the lookup source so the 45 req/min bucket is per-instance,
 * not per-visitor (way more than enough for normal traffic).
 *
 * Cache: in-memory Map keyed by client IP, ~1 hour TTL. Most visitors
 * only hit /demo/presets once or twice per session, so the cache
 * primarily protects against repeat lookups within a single session
 * and from polling clients that re-fetch on focus.
 *
 * Fallback: any failure (timeout, rate limit, missing geo data,
 * localhost/private IP) returns null and the caller falls through to
 * the static preset list. Geolocation is purely additive — never
 * blocks a demo run.
 */

const PROVIDER_URL = "http://ip-api.com/json";
const LOOKUP_TIMEOUT_MS = 1500;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export type IpLocation = {
  lat: number;
  lon: number;
  country: string;
  city?: string;
  /** Provider that produced the result, for telemetry. */
  source: "ip-api.com";
};

type CacheEntry = { value: IpLocation | null; expires: number };

const cache = new Map<string, CacheEntry>();

const PRIVATE_RX = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.|169\.254\.|fc|fd|::1|0:0:0:0:0:0:0:1)/i;

/**
 * Extract the most likely visitor IP from an Express-style request.
 * Honors X-Forwarded-For (Railway sets this) but takes the LEFT-most
 * entry (the original client) rather than the right-most (the last
 * proxy hop). Falls back to req.ip if no forwarding header is present.
 */
export function clientIpFromRequest(headers: Record<string, string | string[] | undefined>, fallbackIp?: string): string | null {
  const xff = headers["x-forwarded-for"];
  const xffStr = Array.isArray(xff) ? xff[0] : xff;
  if (xffStr) {
    const first = xffStr.split(",")[0]?.trim();
    if (first) return first;
  }
  return fallbackIp ?? null;
}

function isPrivateIp(ip: string): boolean {
  return PRIVATE_RX.test(ip);
}

export async function geolocateIp(ip: string | null): Promise<IpLocation | null> {
  if (!ip || isPrivateIp(ip)) return null;
  const cached = cache.get(ip);
  if (cached && cached.expires > Date.now()) return cached.value;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(`${PROVIDER_URL}/${encodeURIComponent(ip)}?fields=status,country,city,lat,lon`, {
      signal: ac.signal,
    });
    if (!res.ok) {
      cache.set(ip, { value: null, expires: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const json = (await res.json()) as {
      status?: string;
      country?: string;
      city?: string;
      lat?: number;
      lon?: number;
    };
    if (
      json.status !== "success" ||
      typeof json.lat !== "number" ||
      typeof json.lon !== "number" ||
      !json.country
    ) {
      cache.set(ip, { value: null, expires: Date.now() + CACHE_TTL_MS });
      return null;
    }
    const loc: IpLocation = {
      lat: json.lat,
      lon: json.lon,
      country: json.country,
      city: json.city,
      source: "ip-api.com",
    };
    cache.set(ip, { value: loc, expires: Date.now() + CACHE_TTL_MS });
    return loc;
  } catch {
    cache.set(ip, { value: null, expires: Date.now() + CACHE_TTL_MS });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
