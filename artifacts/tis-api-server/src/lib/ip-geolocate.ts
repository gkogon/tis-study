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

import { createBoundedCache } from "./bounded-cache";

const PROVIDER_URL = "http://ip-api.com/json";
const LOOKUP_TIMEOUT_MS = 1500;

export type IpLocation = {
  lat: number;
  lon: number;
  country: string;
  city?: string;
  /** Provider that produced the result, for telemetry. */
  source: "ip-api.com";
};

// The cache holds DEFINITIVE answers only: a location, or null for a success
// without usable coordinates or for a fail message ip-api documents (private
// range, reserved range, invalid query), each of which depends only on the
// IP. An HTTP error (a 429 throttle included), a body that is not JSON, an
// undocumented fail, a timeout or a network error is never stored. It used to
// be, for the full hour, so one blip or one throttled minute left that
// visitor's presets unlocalized for an hour. Bounded like
// network-assignment.ts's roadsMemo (bounded-cache.ts): expired entries are
// deleted (the old map only skipped them, growing by one entry per visitor IP
// for the life of the process), and at most IP_GEO_CACHE_MAX_ENTRIES are kept.
export const IP_GEO_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
export const IP_GEO_CACHE_MAX_ENTRIES = 5000;
const cache = createBoundedCache<IpLocation | null>(IP_GEO_CACHE_TTL_MS, IP_GEO_CACHE_MAX_ENTRIES);
const DEFINITIVE_FAILS = new Set(["private range", "reserved range", "invalid query"]);

/** Live entry count of the lookup cache. Test hook. */
export function ipGeoCacheSize(): number {
  return cache.size();
}

// ip-api.com throttles past 45 requests a minute from our server IP (HTTP
// 429) and bans a caller that keeps going for an hour. X-Rl counts the
// requests left in the window and X-Ttl the seconds until it resets: once a
// 429 arrives or X-Rl reaches 0, every lookup returns null without a request
// until the window resets. Nothing is cached per IP for it — the throttle
// says nothing about the visitor — and cached answers are still served.
let rateLimitedUntil = 0;

function noteRateLimit(res: Response): void {
  if (res.status !== 429 && res.headers.get("x-rl") !== "0") return;
  const ttlSec = Number.parseInt(res.headers.get("x-ttl") ?? "", 10);
  // The window is a minute; a missing or implausible X-Ttl waits it out.
  const waitSec = Number.isFinite(ttlSec) && ttlSec >= 0 ? Math.min(ttlSec, 60) : 60;
  rateLimitedUntil = Date.now() + waitSec * 1000;
}

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
  if (cached !== undefined) return cached;
  if (Date.now() < rateLimitedUntil) return null;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LOOKUP_TIMEOUT_MS);
  try {
    // `message` comes back only on a fail; it tells a documented fail from any other.
    const res = await fetch(`${PROVIDER_URL}/${encodeURIComponent(ip)}?fields=status,message,country,city,lat,lon`, {
      signal: ac.signal,
    });
    noteRateLimit(res);
    if (!res.ok) return null;
    const json = (await res.json()) as {
      status?: string;
      message?: string;
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
      if (json.status === "success" || (json.status === "fail" && DEFINITIVE_FAILS.has(json.message ?? ""))) {
        cache.set(ip, null);
      }
      return null;
    }
    const loc: IpLocation = {
      lat: json.lat,
      lon: json.lon,
      country: json.country,
      city: json.city,
      source: "ip-api.com",
    };
    cache.set(ip, loc);
    return loc;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
