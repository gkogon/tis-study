// GDOT 511 Dynamic Message Signs (DMS) — real-time speed readings.
//
// Calls GET /api/v2/get/MessageSigns?key=... which returns the full
// statewide DMS list. Many boards in the Atlanta metro display real
// measured average speeds (e.g. "I-85 AVG SPEED 60-65 MPH"). We parse
// those messages and expose the speed readings for blending into the
// live traffic flow map.

import { logger } from "./logger";

const LIVE_BASE = "https://www.511ga.org";
const BBOX = { minLat: 33.0, maxLat: 34.5, minLon: -85.2, maxLon: -83.5 };
const CACHE_TTL_MS = 90_000;

export type DmsSpeedReading = {
  id: string;
  name: string;
  roadway: string;
  direction: string;
  latitude: number;
  longitude: number;
  speedMph: number;
  rawMessage: string;
  lastUpdated: string | null;
};

export type DmsSpeedBundle = {
  fetchedAt: string;
  cached: boolean;
  cacheAgeSeconds: number;
  totalSigns: number;
  metroSigns: number;
  speedReadings: DmsSpeedReading[];
};

type V2MessageSign = {
  Id: string;
  Name: string;
  Roadway: string;
  DirectionOfTravel: string;
  Messages: string[];
  Latitude: number;
  Longitude: number;
  LastUpdated: number;
  DeviceDescription: string;
};

const SPEED_PATTERNS = [
  /(\d{1,3})\s*-\s*(\d{1,3})\s*MPH/i,
  /SPEED:\s*(\d{1,3})\s*MPH/i,
  /(\d{1,3})\s*MPH/i,
];

function parseSpeedFromMessages(messages: string[]): { speedMph: number; rawMessage: string } | null {
  for (const msg of messages) {
    for (const pat of SPEED_PATTERNS) {
      const m = msg.match(pat);
      if (m) {
        if (m[2]) {
          const lo = parseInt(m[1]!, 10);
          const hi = parseInt(m[2]!, 10);
          if (lo > 0 && lo <= 120 && hi > 0 && hi <= 120) {
            return { speedMph: Math.round((lo + hi) / 2), rawMessage: msg.replace(/\n/g, " ") };
          }
        } else if (m[1]) {
          const spd = parseInt(m[1]!, 10);
          if (spd > 0 && spd <= 120) {
            return { speedMph: spd, rawMessage: msg.replace(/\n/g, " ") };
          }
        }
      }
    }
  }
  return null;
}

let cache: { at: number; bundle: DmsSpeedBundle } | null = null;
let inflight: Promise<DmsSpeedBundle> | null = null;

export async function getDmsSpeedReadings(force = false): Promise<DmsSpeedBundle> {
  if (!force && cache) {
    const ageMs = Date.now() - cache.at;
    if (ageMs < CACHE_TTL_MS) {
      return { ...cache.bundle, cached: true, cacheAgeSeconds: Math.round(ageMs / 1000) };
    }
  }
  if (inflight) return inflight;
  inflight = (async (): Promise<DmsSpeedBundle> => {
    try {
      return await refreshDmsSpeeds();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function refreshDmsSpeeds(): Promise<DmsSpeedBundle> {
  const startedAt = Date.now();
  const apiKey = process.env.GDOT_511_API_KEY;
  if (!apiKey) {
    const empty: DmsSpeedBundle = {
      fetchedAt: new Date(startedAt).toISOString(),
      cached: false, cacheAgeSeconds: 0,
      totalSigns: 0, metroSigns: 0, speedReadings: [],
    };
    return empty;
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  let signs: V2MessageSign[];
  try {
    const r = await fetch(
      `${LIVE_BASE}/api/v2/get/MessageSigns?key=${apiKey}`,
      {
        headers: { "User-Agent": "atlanta-traffic-analyzer/1.0", Accept: "application/json" },
        signal: ctl.signal,
      },
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    signs = (await r.json()) as V2MessageSign[];
  } finally {
    clearTimeout(timer);
  }

  const totalSigns = signs.length;
  const metro = signs.filter(
    (s) =>
      typeof s.Latitude === "number" && typeof s.Longitude === "number" &&
      s.Latitude >= BBOX.minLat && s.Latitude <= BBOX.maxLat &&
      s.Longitude >= BBOX.minLon && s.Longitude <= BBOX.maxLon,
  );
  const metroSigns = metro.length;

  const speedReadings: DmsSpeedReading[] = [];
  for (const s of metro) {
    if (!s.Messages || !s.Messages.length) continue;
    const parsed = parseSpeedFromMessages(s.Messages);
    if (!parsed) continue;
    speedReadings.push({
      id: s.Id,
      name: s.Name,
      roadway: s.Roadway,
      direction: s.DirectionOfTravel,
      latitude: s.Latitude,
      longitude: s.Longitude,
      speedMph: parsed.speedMph,
      rawMessage: parsed.rawMessage,
      lastUpdated: s.LastUpdated
        ? new Date(s.LastUpdated * 1000).toISOString()
        : null,
    });
  }

  const bundle: DmsSpeedBundle = {
    fetchedAt: new Date(startedAt).toISOString(),
    cached: false,
    cacheAgeSeconds: 0,
    totalSigns,
    metroSigns,
    speedReadings,
  };
  cache = { at: startedAt, bundle };
  logger.info(
    { totalSigns, metroSigns, speedReadings: speedReadings.length, ms: Date.now() - startedAt },
    "dms-speeds: refreshed",
  );
  return bundle;
}
