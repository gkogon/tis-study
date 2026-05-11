// GDOT 511 Alerts — metro-wide closure notices and event advisories.

import { logger } from "./logger";

const LIVE_BASE = "https://www.511ga.org";
const CACHE_TTL_MS = 5 * 60_000;

export type GdotAlert = {
  id: number;
  message: string;
  notes: string;
  startTime: string | null;
  endTime: string | null;
  lastUpdated: string | null;
  highImportance: boolean;
};

export type GdotAlertsBundle = {
  fetchedAt: string;
  cached: boolean;
  cacheAgeSeconds: number;
  alerts: GdotAlert[];
};

type V2Alert = {
  Id: number;
  Message: string;
  Notes: string;
  StartTime: number | null;
  EndTime: number | null;
  LastUpdated: number | null;
  HighImportance: boolean;
  SendNotification: boolean;
  Regions: string[];
};

function epochToIso(epoch: number | null | undefined): string | null {
  if (!epoch) return null;
  try { return new Date(epoch * 1000).toISOString(); } catch { return null; }
}

let cache: { at: number; bundle: GdotAlertsBundle } | null = null;
let inflight: Promise<GdotAlertsBundle> | null = null;

export async function getGdotAlerts(force = false): Promise<GdotAlertsBundle> {
  if (!force && cache) {
    const ageMs = Date.now() - cache.at;
    if (ageMs < CACHE_TTL_MS) {
      return { ...cache.bundle, cached: true, cacheAgeSeconds: Math.round(ageMs / 1000) };
    }
  }
  if (inflight) return inflight;
  inflight = (async (): Promise<GdotAlertsBundle> => {
    try {
      return await refreshAlerts();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function refreshAlerts(): Promise<GdotAlertsBundle> {
  const startedAt = Date.now();
  const apiKey = process.env.GDOT_511_API_KEY;
  if (!apiKey) {
    const empty: GdotAlertsBundle = {
      fetchedAt: new Date(startedAt).toISOString(),
      cached: false, cacheAgeSeconds: 0, alerts: [],
    };
    return empty;
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  let raw: V2Alert[];
  try {
    const r = await fetch(
      `${LIVE_BASE}/api/v2/get/Alerts?key=${apiKey}`,
      {
        headers: { "User-Agent": "atlanta-traffic-analyzer/1.0", Accept: "application/json" },
        signal: ctl.signal,
      },
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    raw = (await r.json()) as V2Alert[];
  } finally {
    clearTimeout(timer);
  }

  const alerts: GdotAlert[] = raw.map((a) => ({
    id: a.Id,
    message: a.Message || "",
    notes: (a.Notes || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    startTime: epochToIso(a.StartTime),
    endTime: epochToIso(a.EndTime),
    lastUpdated: epochToIso(a.LastUpdated),
    highImportance: !!a.HighImportance,
  }));

  const bundle: GdotAlertsBundle = {
    fetchedAt: new Date(startedAt).toISOString(),
    cached: false,
    cacheAgeSeconds: 0,
    alerts,
  };
  cache = { at: startedAt, bundle };
  logger.info(
    { count: alerts.length, ms: Date.now() - startedAt },
    "gdot-alerts: refreshed",
  );
  return bundle;
}
