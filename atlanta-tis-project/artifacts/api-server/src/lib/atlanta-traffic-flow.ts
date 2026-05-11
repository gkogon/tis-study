// Live Atlanta-metro traffic flow synthesis (Apple-Maps-style coloring).
//
// GDOT does NOT publish a keyless real-time speed/flow feed: only the public
// 511 incident list (which we already pull) is available without an API key.
// To still give the user a meaningful Apple-Maps-style colored road map, we
// SYNTHESIZE per-segment congestion from the data we already have:
//
//   1) The full predictDay() output for today (per-signal hourly stress 0..100,
//      already incorporating live weather + day-of-week + events + the
//      recent-activity feedback loop derived from past 7 days of live
//      incidents). We sample the current local hour.
//   2) The live GDOT incident list. Any segment whose midpoint is within
//      INCIDENT_PARTIAL_RADIUS_M of a partial incident gets a +20 boost; a
//      full closure within INCIDENT_FULL_RADIUS_M force-clamps the segment
//      to "closed".
//   3) The OSM road network we ship in atlanta-roads.json (motorways +
//      trunks + primaries by default, ~30k ways). Each way's midpoint is
//      scored from the closest few signals via inverse-distance weighting.
//
// The output is intentionally labeled as "estimated congestion derived from
// live conditions + the prediction model" — never as measured GPS speeds.

import { logger } from "./logger";
import { loadRoadNetwork } from "./atlanta-data";
import {
  predictDay,
  getIntersectionSummaries,
  getIntersectionById,
  getRecommendationFor,
  getAccidentRiskBundle,
  type RiskTier,
} from "./atlanta-analysis";
import { getLiveWeather } from "./atlanta-weather";
import { getLiveIncidents, type LiveIncident } from "./atlanta-live";
import { getDmsSpeedReadings, type DmsSpeedReading } from "./atlanta-dms";
import { recordCalibrationSnapshot, getCalibrationFactors } from "./atlanta-history";

export type FlowLevel = "free" | "light" | "heavy" | "severe" | "closed";

export type LiveTrafficSegment = {
  rc: number;
  name: string | null;
  level: FlowLevel;
  score: number;
  polyline: number[]; // flat [lat0, lon0, lat1, lon1, ...] for compactness
};

export type LiveTrafficFlowBundle = {
  fetchedAt: string;
  source: string;
  cached: boolean;
  cacheAgeSeconds: number;
  currentHourLocal: number;
  hourLabel: string;
  dayOfWeek: string;
  weather: "clear" | "light_rain" | "heavy_rain" | "snow";
  weatherSummary: string;
  activeIncidents: number;
  fullClosures: number;
  counts: { free: number; light: number; heavy: number; severe: number; closed: number };
  avgCongestion: number;
  classesIncluded: number[];
  segments: LiveTrafficSegment[];
  incidents: LiveIncident[];
  dmsSpeedCount: number;
  sourceNote: string;
};

const CACHE_TTL_MS = 60_000;
const SIGNAL_CELL = 0.01;          // ~1.1 km grid for signal lookup
const SEARCH_RING = 2;             // 5x5 cell neighborhood around the way midpoint
const MAX_SIGNAL_DIST_M = 1800;
const NEAREST_K = 5;               // up to 5 nearest signals for IDW
const INCIDENT_FULL_RADIUS_M = 800;
const INCIDENT_PARTIAL_RADIUS_M = 500;

const cache = new Map<string, { at: number; bundle: LiveTrafficFlowBundle }>();
const inflight = new Map<string, Promise<LiveTrafficFlowBundle>>();

export async function getLiveTrafficFlow(opts?: {
  classes?: number[];
  force?: boolean;
}): Promise<LiveTrafficFlowBundle> {
  const classes = uniqSort(opts?.classes ?? [0, 1, 2]);
  const key = classes.join(",");
  if (!opts?.force) {
    const c = cache.get(key);
    if (c) {
      const ageMs = Date.now() - c.at;
      if (ageMs < CACHE_TTL_MS) {
        return { ...c.bundle, cached: true, cacheAgeSeconds: Math.round(ageMs / 1000) };
      }
    }
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = (async (): Promise<LiveTrafficFlowBundle> => {
    try {
      return await refreshFlow(classes);
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

async function refreshFlow(classes: number[]): Promise<LiveTrafficFlowBundle> {
  const t0 = Date.now();

  // 1) Live weather (graceful fallback to clear).
  let weather: LiveTrafficFlowBundle["weather"] = "clear";
  let weatherSummary = "clear (weather feed unavailable)";
  try {
    const wx = await getLiveWeather();
    weather = wx.condition;
    weatherSummary = wx.summary;
  } catch (e) {
    logger.warn({ err: e }, "live-traffic-flow: weather fetch failed; defaulting to clear");
  }

  // 2) Live incidents (graceful fallback to empty list).
  let incidents: LiveIncident[] = [];
  try {
    const bundle = await getLiveIncidents();
    incidents = bundle.incidents;
  } catch (e) {
    logger.warn({ err: e }, "live-traffic-flow: incidents fetch failed; using empty list");
  }
  const fullClosures = incidents.filter((i) => i.isFullClosure).length;

  // 2b) DMS measured speed readings (graceful fallback to empty).
  let dmsReadings: DmsSpeedReading[] = [];
  try {
    const dms = await getDmsSpeedReadings();
    dmsReadings = dms.speedReadings;
  } catch (e) {
    logger.warn({ err: e }, "live-traffic-flow: DMS fetch failed; using model-only scores");
  }

  // 3) Today's full per-signal predictions for the current local hour.
  const todayDate = todayInAtlanta();
  const dow = new Date(`${todayDate}T12:00:00Z`).getUTCDay();
  const isWeekday = dow >= 1 && dow <= 5;
  const hour = currentHourInAtlanta();
  const prediction = predictDay({
    date: todayDate,
    weather,
    events: { schoolDay: isWeekday },
  });
  const dayOfWeek = prediction.meta.dayOfWeek;

  // 4) Build a spatial signal index keyed by ~1km cells, holding the
  //    current-hour stress score per signal.
  type SigPt = { lat: number; lon: number; score: number };
  const grid = new Map<string, SigPt[]>();
  const signalsList = getIntersectionSummaries();
  // Map osm id -> hourly score from prediction
  const hourScoreById = new Map<string, number>();
  for (const s of prediction.signals) {
    hourScoreById.set(s.id, s.hourly[hour] ?? 0);
  }
  for (const sig of signalsList) {
    const score = hourScoreById.get(sig.id) ?? 0;
    const k = cellKey(sig.latitude, sig.longitude);
    let bucket = grid.get(k);
    if (!bucket) {
      bucket = [];
      grid.set(k, bucket);
    }
    bucket.push({ lat: sig.latitude, lon: sig.longitude, score });
  }

  // 5) Pre-bucket incidents into the same grid for O(1) proximity lookups.
  type IncPt = { lat: number; lon: number; full: boolean };
  const incGrid = new Map<string, IncPt[]>();
  for (const inc of incidents) {
    if (typeof inc.latitude !== "number" || typeof inc.longitude !== "number") continue;
    const k = cellKey(inc.latitude, inc.longitude);
    let bucket = incGrid.get(k);
    if (!bucket) {
      bucket = [];
      incGrid.set(k, bucket);
    }
    bucket.push({ lat: inc.latitude, lon: inc.longitude, full: inc.isFullClosure });
  }

  // 5b) Pre-bucket DMS readings into a grid for O(1) proximity lookups.
  //     We'll blend DMS-derived scores into highway segments within range.
  const DMS_BLEND_RADIUS_M = 1500;
  type DmsPt = { lat: number; lon: number; speedMph: number };
  const dmsGrid = new Map<string, DmsPt[]>();
  for (const d of dmsReadings) {
    const k = cellKey(d.latitude, d.longitude);
    let bucket = dmsGrid.get(k);
    if (!bucket) { bucket = []; dmsGrid.set(k, bucket); }
    bucket.push({ lat: d.latitude, lon: d.longitude, speedMph: d.speedMph });
  }

  // 6) Walk the road network and color each way.
  const road = loadRoadNetwork();
  const segments: LiveTrafficSegment[] = [];
  const counts = { free: 0, light: 0, heavy: 0, severe: 0, closed: 0 };
  let totalScore = 0;

  type CalibAcc = { sumPred: number; sumActual: number; n: number };
  const calibAcc = new Map<string, CalibAcc>();

  for (const wayUnknown of road.ways) {
    const way = wayUnknown as
      | [number, [number, number][]]
      | [number, string, [number, number][]];
    const rc = way[0];
    if (!classes.includes(rc)) continue;
    const name: string | null = typeof way[1] === "string" ? way[1] : null;
    const coords = (typeof way[1] === "string" ? way[2] : way[1]) as [number, number][];
    if (!coords || coords.length < 2) continue;

    const mid = midOfCoords(coords);
    const baseStress = sampleStressAt(mid.lat, mid.lon, grid);

    // Incident proximity boost (or hard-clamp to closed).
    const inc = nearestIncidentInfluence(mid.lat, mid.lon, incGrid);
    let score = baseStress;
    let level: FlowLevel;
    if (inc.fullWithin) {
      score = 100;
      level = "closed";
    } else {
      score = Math.min(100, baseStress + inc.partialBoost);

      // Blend DMS measured speed on highways (rc 0 or 1) when a DMS is
      // within DMS_BLEND_RADIUS_M. Speed→score: 65+ mph → free (0-10),
      // 45-65 → light (10-35), 25-45 → heavy (35-65), <25 → severe (65+).
      if ((rc === 0 || rc === 1) && dmsReadings.length > 0) {
        const dmsScore = sampleDmsAt(mid.lat, mid.lon, dmsGrid, DMS_BLEND_RADIUS_M);
        if (dmsScore !== null) {
          score = 0.6 * dmsScore + 0.4 * score;
        }
      }

      level = levelFromScore(score, rc);
    }

    counts[level]++;
    totalScore += score;

    if (!inc.fullWithin && inc.partialBoost < 15) {
      const ck = cellKey(mid.lat, mid.lon);
      const ca = calibAcc.get(ck);
      if (ca) { ca.sumPred += baseStress; ca.sumActual += score; ca.n++; }
      else calibAcc.set(ck, { sumPred: baseStress, sumActual: score, n: 1 });
    }

    segments.push({
      rc,
      name,
      level,
      score: Math.round(score * 10) / 10,
      polyline: flattenCoords(coords),
    });
  }

  const avgCongestion = segments.length
    ? Math.round((totalScore / segments.length) * 10) / 10
    : 0;

  const calibCells: Record<string, { predicted: number; actual: number; n: number }> = {};
  for (const [key, acc] of calibAcc) {
    calibCells[key] = {
      predicted: Math.round((acc.sumPred / acc.n) * 10) / 10,
      actual: Math.round((acc.sumActual / acc.n) * 10) / 10,
      n: acc.n,
    };
  }
  try {
    recordCalibrationSnapshot({
      date: todayDate,
      hour,
      capturedAt: new Date().toISOString(),
      cells: calibCells,
    });
  } catch (e) {
    logger.warn({ err: e }, "live-traffic-flow: calibration snapshot failed");
  }

  const hasDms = dmsReadings.length > 0;
  const bundle: LiveTrafficFlowBundle = {
    fetchedAt: new Date(t0).toISOString(),
    source: hasDms
      ? "GDOT 511 v2 API (incidents + DMS speeds) + per-signal stress model"
      : "GDOT 511 NaviGAtor (incidents) + per-signal stress model",
    cached: false,
    cacheAgeSeconds: 0,
    currentHourLocal: hour,
    hourLabel: hourLabel(hour),
    dayOfWeek,
    weather,
    weatherSummary,
    activeIncidents: incidents.length,
    fullClosures,
    counts,
    avgCongestion,
    classesIncluded: classes,
    segments,
    incidents,
    dmsSpeedCount: dmsReadings.length,
    sourceNote: hasDms
      ? "Apple-Maps-style colors blend GDOT DMS measured speeds (60% weight " +
        "on interstates/highways near a DMS board) with our per-signal stress " +
        "model (live weather, day-of-week, events, recent-activity feedback). " +
        "Segments away from DMS boards remain model-estimated."
      : "Apple-Maps-style colors are ESTIMATED — synthesized from live GDOT " +
        "incidents and our per-signal stress model (live weather, day-of-week, " +
        "events, recent-activity feedback). They are not direct GPS speed " +
        "measurements; a measured speed feed would require the GDOT 511 API key.",
  };
  cache.set(classes.join(","), { at: t0, bundle });
  logger.info(
    { ms: Date.now() - t0, segments: segments.length, classes, hour, weather, incidents: incidents.length, dms: dmsReadings.length },
    "live-traffic-flow: refreshed",
  );
  return bundle;
}

// ---------- DMS speed → congestion score ----------

function speedToScore(mph: number): number {
  if (mph >= 65) return Math.max(0, 10 - (mph - 65) * 0.5);
  if (mph >= 45) return 10 + (65 - mph) * (25 / 20);
  if (mph >= 25) return 35 + (45 - mph) * (30 / 20);
  return Math.min(100, 65 + (25 - mph) * (35 / 25));
}

function sampleDmsAt(
  lat: number,
  lon: number,
  dmsGrid: Map<string, { lat: number; lon: number; speedMph: number }[]>,
  radiusM: number,
): number | null {
  const cy = Math.floor(lat / SIGNAL_CELL);
  const cx = Math.floor(lon / SIGNAL_CELL);
  let bestD = radiusM;
  let bestSpeed: number | null = null;
  for (let dy = -SEARCH_RING; dy <= SEARCH_RING; dy++) {
    for (let dx = -SEARCH_RING; dx <= SEARCH_RING; dx++) {
      const bucket = dmsGrid.get(`${cy + dy}|${cx + dx}`);
      if (!bucket) continue;
      for (const d of bucket) {
        const dist = distM(lat, lon, d.lat, d.lon);
        if (dist < bestD) {
          bestD = dist;
          bestSpeed = d.speedMph;
        }
      }
    }
  }
  return bestSpeed !== null ? speedToScore(bestSpeed) : null;
}

// ---------- scoring helpers ----------

function levelFromScore(score: number, rc: number): FlowLevel {
  // Highways carry more volume so the same v/c-driven score reads as more
  // congested in human terms; nudge thresholds slightly tighter for class 0/1.
  const t = rc <= 1
    ? { light: 25, heavy: 45, severe: 65 }
    : { light: 30, heavy: 50, severe: 70 };
  if (score >= t.severe) return "severe";
  if (score >= t.heavy) return "heavy";
  if (score >= t.light) return "light";
  return "free";
}

// Map the OSM-style string road class on Intersection objects to the same
// numeric index (0..3) the segment renderer and `levelFromScore` use.
// Anything below "secondary" gets bucketed as 3 so its threshold matches
// non-arterial behavior.
function roadClassToIndex(rc: string): number {
  switch (rc) {
    case "motorway":
    case "motorway_link":
      return 0;
    case "trunk":
    case "trunk_link":
      return 1;
    case "primary":
    case "primary_link":
      return 2;
    default:
      return 3;
  }
}

// Inverse-distance-weighted average of the K nearest signals' current-hour
// stress, restricted to the 5x5 cell neighborhood of the midpoint.
function sampleStressAt(
  lat: number,
  lon: number,
  grid: Map<string, { lat: number; lon: number; score: number }[]>,
): number {
  const cy = Math.floor(lat / SIGNAL_CELL);
  const cx = Math.floor(lon / SIGNAL_CELL);
  const candidates: { d: number; score: number }[] = [];
  for (let dy = -SEARCH_RING; dy <= SEARCH_RING; dy++) {
    for (let dx = -SEARCH_RING; dx <= SEARCH_RING; dx++) {
      const bucket = grid.get(`${cy + dy}|${cx + dx}`);
      if (!bucket) continue;
      for (const s of bucket) {
        const d = distM(lat, lon, s.lat, s.lon);
        if (d <= MAX_SIGNAL_DIST_M) candidates.push({ d, score: s.score });
      }
    }
  }
  if (!candidates.length) return 0;
  candidates.sort((a, b) => a.d - b.d);
  const top = candidates.slice(0, NEAREST_K);
  let wSum = 0;
  let wScoreSum = 0;
  for (const c of top) {
    // IDW with a small offset so a coincident signal doesn't blow up.
    const w = 1 / Math.pow(Math.max(50, c.d), 2);
    wSum += w;
    wScoreSum += w * c.score;
  }
  return wScoreSum / wSum;
}

function nearestIncidentInfluence(
  lat: number,
  lon: number,
  incGrid: Map<string, { lat: number; lon: number; full: boolean }[]>,
): { fullWithin: boolean; partialBoost: number } {
  const cy = Math.floor(lat / SIGNAL_CELL);
  const cx = Math.floor(lon / SIGNAL_CELL);
  let fullWithin = false;
  let partialBoost = 0;
  for (let dy = -SEARCH_RING; dy <= SEARCH_RING; dy++) {
    for (let dx = -SEARCH_RING; dx <= SEARCH_RING; dx++) {
      const bucket = incGrid.get(`${cy + dy}|${cx + dx}`);
      if (!bucket) continue;
      for (const i of bucket) {
        const d = distM(lat, lon, i.lat, i.lon);
        if (i.full && d <= INCIDENT_FULL_RADIUS_M) {
          fullWithin = true;
        }
        if (!i.full && d <= INCIDENT_PARTIAL_RADIUS_M) {
          // Linear falloff: 25 at 0m -> 0 at the radius edge.
          const boost = 25 * (1 - d / INCIDENT_PARTIAL_RADIUS_M);
          if (boost > partialBoost) partialBoost = boost;
        }
      }
    }
  }
  return { fullWithin, partialBoost };
}

// ---------- geo / utility helpers ----------

function midOfCoords(coords: [number, number][]): { lat: number; lon: number } {
  // Walk to the cumulative-half-length point (more representative than the
  // arithmetic midpoint for long diagonal ways).
  if (coords.length === 2) {
    const a = coords[0]!;
    const b = coords[1]!;
    return { lat: (a[0] + b[0]) / 2, lon: (a[1] + b[1]) / 2 };
  }
  let total = 0;
  const segLens: number[] = [];
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const d = distM(a[0], a[1], b[0], b[1]);
    segLens.push(d);
    total += d;
  }
  const half = total / 2;
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1]!;
    const b = coords[i]!;
    const d = segLens[i - 1]!;
    if (acc + d >= half) {
      const t = d === 0 ? 0 : (half - acc) / d;
      return { lat: a[0] + (b[0] - a[0]) * t, lon: a[1] + (b[1] - a[1]) * t };
    }
    acc += d;
  }
  // Fallback (shouldn't be reached).
  const last = coords[coords.length - 1]!;
  return { lat: last[0], lon: last[1] };
}

function flattenCoords(coords: [number, number][]): number[] {
  const out: number[] = new Array(coords.length * 2);
  for (let i = 0; i < coords.length; i++) {
    out[i * 2] = coords[i]![0];
    out[i * 2 + 1] = coords[i]![1];
  }
  return out;
}

function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat / SIGNAL_CELL)}|${Math.floor(lon / SIGNAL_CELL)}`;
}

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function uniqSort(a: number[]): number[] {
  return Array.from(new Set(a)).sort((x, y) => x - y);
}

function currentHourInAtlanta(): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const h = parts.find((p) => p.type === "hour")?.value;
  const n = h ? Number(h) : new Date().getHours();
  return ((n % 24) + 24) % 24;
}

function todayInAtlanta(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

function hourLabel(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

// ---------------------------------------------------------------------------
// Predicted traffic flow (tomorrow's hour-by-hour road-network segment colors)
// ---------------------------------------------------------------------------

export type PredictedCriticalSignal = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  score: number;
  severity: string;
  roadClass: string;
  crashRiskTier: string;
  crashSurgePct: number;
};

export type PredictedHourAggregate = {
  hour: number;
  label: string;
  avgScore: number;
  criticalCount: number;
  highCount: number;
};

export type PredictedTrafficFlowBundle = {
  date: string;
  hour: number;
  hourLabel: string;
  dayOfWeek: string;
  weather: "clear" | "light_rain" | "heavy_rain" | "snow";
  counts: { free: number; light: number; heavy: number; severe: number; closed: number };
  avgCongestion: number;
  segments: LiveTrafficSegment[];
  criticalSignals: PredictedCriticalSignal[];
  allHours: PredictedHourAggregate[];
  sourceNote: string;
};

const predFlowCache = new Map<string, { at: number; bundle: PredictedTrafficFlowBundle }>();
const PRED_FLOW_CACHE_TTL_MS = 300_000;

export function getPredictedTrafficFlow(opts: {
  date: string;
  weather?: "clear" | "light_rain" | "heavy_rain" | "snow";
  events?: {
    schoolDay?: boolean;
    falconsHome?: boolean;
    hawksHome?: boolean;
    bravesHome?: boolean;
    gtFootball?: boolean;
    holiday?: boolean;
  };
  hour: number;
  classes?: number[];
  hourlyWeatherMults?: number[];
}): PredictedTrafficFlowBundle {
  const weather = opts.weather ?? "clear";
  const ev = opts.events ?? {};
  const classes = uniqSort(opts.classes ?? [0, 1, 2]);
  const hour = Math.max(0, Math.min(23, Math.trunc(opts.hour)));
  const evKey = [
    ev.schoolDay ? "S" : "",
    ev.falconsHome ? "F" : "",
    ev.hawksHome ? "H" : "",
    ev.bravesHome ? "B" : "",
    ev.gtFootball ? "G" : "",
    ev.holiday ? "X" : "",
  ].join("");
  // Continuous-weather signature: fingerprint ALL 24 multipliers (rounded
  // to 2 decimals) so different hourly profiles with the same daily
  // average don't collide on the same cache entry. Two profiles where one
  // is rainy AM / clear PM vs. clear AM / rainy PM would otherwise produce
  // different segment maps but be served the same cached bundle.
  const hwmKey = opts.hourlyWeatherMults && opts.hourlyWeatherMults.length === 24
    ? `~${opts.hourlyWeatherMults.map((v) => v.toFixed(2)).join(",")}`
    : "";
  const cacheKey = `${opts.date}|${weather}${hwmKey}|${evKey}|${hour}|${classes.join(",")}`;

  const cached = predFlowCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PRED_FLOW_CACHE_TTL_MS) {
    return cached.bundle;
  }

  const t0 = Date.now();
  const prediction = predictDay({
    date: opts.date,
    weather,
    events: ev,
    hourlyWeatherMults: opts.hourlyWeatherMults,
  });

  type SigPt = { lat: number; lon: number; score: number };
  const grid = new Map<string, SigPt[]>();
  const signalsList = getIntersectionSummaries();
  const hourScoreById = new Map<string, number>();
  for (const s of prediction.signals) {
    hourScoreById.set(s.id, s.hourly[hour] ?? 0);
  }
  for (const sig of signalsList) {
    const score = hourScoreById.get(sig.id) ?? 0;
    const k = cellKey(sig.latitude, sig.longitude);
    let bucket = grid.get(k);
    if (!bucket) { bucket = []; grid.set(k, bucket); }
    bucket.push({ lat: sig.latitude, lon: sig.longitude, score });
  }

  const road = loadRoadNetwork();
  const calibFactors = getCalibrationFactors();
  const segments: LiveTrafficSegment[] = [];
  const counts = { free: 0, light: 0, heavy: 0, severe: 0, closed: 0 };
  let totalScore = 0;

  for (const wayUnknown of road.ways) {
    const way = wayUnknown as
      | [number, [number, number][]]
      | [number, string, [number, number][]];
    const rc = way[0];
    if (!classes.includes(rc)) continue;
    const name: string | null = typeof way[1] === "string" ? way[1] : null;
    const coords = (typeof way[1] === "string" ? way[2] : way[1]) as [number, number][];
    if (!coords || coords.length < 2) continue;

    const mid = midOfCoords(coords);
    let score = sampleStressAt(mid.lat, mid.lon, grid);
    const cf = calibFactors.get(cellKey(mid.lat, mid.lon));
    if (cf !== undefined) score = Math.min(100, score * cf);
    const level = levelFromScore(score, rc);

    counts[level]++;
    totalScore += score;
    segments.push({
      rc,
      name,
      level,
      score: Math.round(score * 10) / 10,
      polyline: flattenCoords(coords),
    });
  }

  const avgCongestion = segments.length
    ? Math.round((totalScore / segments.length) * 10) / 10
    : 0;

  const sortedSignals = [...prediction.signals].sort(
    (a, b) => (b.hourly[hour] ?? 0) - (a.hourly[hour] ?? 0),
  );
  const criticals: PredictedCriticalSignal[] = [];
  const seenIds = new Set<string>();
  for (const s of sortedSignals) {
    if (seenIds.has(s.id)) continue;
    seenIds.add(s.id);
    const score = s.hourly[hour] ?? 0;
    if (score < 50) break;
    criticals.push({
      id: s.id,
      name: s.name,
      lat: s.latitude,
      lon: s.longitude,
      score: Math.round(score * 10) / 10,
      severity: s.predictedSeverity,
      roadClass: s.roadClass,
      crashRiskTier: s.crashRiskTier,
      crashSurgePct: s.crashSurgePct,
    });
    if (criticals.length >= 20) break;
  }

  const allHours: PredictedHourAggregate[] = prediction.hourly.map((h) => ({
    hour: h.hour,
    label: h.label,
    avgScore: Math.round(h.avgPredictedScore * 10) / 10,
    criticalCount: h.criticalCount,
    highCount: h.highCount,
  }));

  const bundle: PredictedTrafficFlowBundle = {
    date: opts.date,
    hour,
    hourLabel: hourLabel(hour),
    dayOfWeek: prediction.meta.dayOfWeek,
    weather,
    counts,
    avgCongestion,
    segments,
    criticalSignals: criticals,
    allHours,
    sourceNote:
      "Predicted congestion from the per-signal stress model " +
      "(day-of-week, hour, weather, events, crash history). " +
      "This is a forecast, not live measured data.",
  };

  predFlowCache.set(cacheKey, { at: t0, bundle });
  logger.info(
    {
      ms: Date.now() - t0,
      segments: segments.length,
      criticals: criticals.length,
      date: opts.date,
      hour,
      weather,
    },
    "predicted-traffic-flow: computed",
  );
  return bundle;
}

// ---------------------------------------------------------------------------
// Live hotspot signal-timing fixes
// ---------------------------------------------------------------------------
//
// Identifies signals that are SIMULTANEOUSLY (a) currently in heavy/severe
// live congestion and (b) sit on top of a crash-prone intersection (high or
// severe historical-risk tier). For each, we run the same `getRecommendationFor`
// engine the dashboard uses to suggest a concrete signal-timing change. The
// goal is to give an operator the highest-leverage, life-safety-relevant
// timing tweaks for RIGHT NOW.

export type LiveHotspotFix = {
  intersectionId: string;
  intersectionName: string;
  latitude: number;
  longitude: number;
  // Live status
  currentScore: number;          // current-hour predicted stress 0..100
  currentLevel: FlowLevel;       // banded the same way road segments are
  hasNearbyIncident: boolean;    // active GDOT incident within ~600m
  nearestIncidentMeters: number | null;
  // Crash history (from ARC 2019-2023)
  crashes: number;
  fatal: number;
  seriousInjuries: number;
  riskTier: RiskTier;
  // Concrete timing recommendation (mirrors /atlanta/recommendations shape)
  targetPhase: "Protected Left" | "N/S Green" | "E/W Green";
  targetMovement: string;
  currentPhaseSeconds: number;
  suggestedPhaseSeconds: number;
  currentCycleLength: number;
  suggestedCycleLength: number;
  estimatedDelayReductionSeconds: number;
  rationale: string;
  // Combined hotspot impact score for sorting (0..100)
  hotspotScore: number;
};

export type LiveHotspotFixesBundle = {
  fetchedAt: string;
  currentHourLocal: number;
  hourLabel: string;
  totalCandidates: number;       // signals matching congestion + crash filters
  fixes: LiveHotspotFix[];
  note: string;
};

const HOTSPOT_INCIDENT_RADIUS_M = 600;
const HOTSPOT_MIN_STRESS = 50;   // heavy or worse
const HOTSPOT_LIMIT = 12;
const HOTSPOT_CACHE_TTL_MS = 60_000;
let hotspotCache: { at: number; bundle: LiveHotspotFixesBundle } | null = null;

export async function getLiveHotspotFixes(): Promise<LiveHotspotFixesBundle> {
  if (hotspotCache && Date.now() - hotspotCache.at < HOTSPOT_CACHE_TTL_MS) {
    return hotspotCache.bundle;
  }
  const t0 = Date.now();

  // Live incidents (graceful fallback) — used to flag intersections whose
  // suggested fix is reinforced by a real, present-tense event nearby.
  let incidents: LiveIncident[] = [];
  try {
    const bundle = await getLiveIncidents();
    incidents = bundle.incidents;
  } catch (e) {
    logger.warn({ err: e }, "live-hotspot-fixes: incidents fetch failed; continuing without incident proximity");
  }

  // Today's current-hour stress per signal.
  const todayDate = todayInAtlanta();
  const dow = new Date(`${todayDate}T12:00:00Z`).getUTCDay();
  const isWeekday = dow >= 1 && dow <= 5;
  const hour = currentHourInAtlanta();
  let weather: LiveTrafficFlowBundle["weather"] = "clear";
  try {
    weather = (await getLiveWeather()).condition;
  } catch {
    /* default to clear */
  }
  const prediction = predictDay({
    date: todayDate,
    weather,
    events: { schoolDay: isWeekday },
  });
  const stressById = new Map<string, number>();
  for (const s of prediction.signals) {
    stressById.set(s.id, s.hourly[hour] ?? 0);
  }

  // Accident risk lookup.
  const accidentBundle = getAccidentRiskBundle();
  const riskById = new Map<string, (typeof accidentBundle.perSignal)[number]>();
  for (const r of accidentBundle.perSignal) riskById.set(r.id, r);

  // Pre-bucket incidents into the same spatial grid we already use, for fast
  // "is there an incident within 600m of this signal?" lookups.
  type IncPt = { lat: number; lon: number; id: string };
  const incGrid = new Map<string, IncPt[]>();
  for (const inc of incidents) {
    if (typeof inc.latitude !== "number" || typeof inc.longitude !== "number") continue;
    const k = cellKey(inc.latitude, inc.longitude);
    let bucket = incGrid.get(k);
    if (!bucket) { bucket = []; incGrid.set(k, bucket); }
    bucket.push({ lat: inc.latitude, lon: inc.longitude, id: inc.id });
  }

  // Candidate filter: heavy+ congestion AND high+ crash tier.
  type Candidate = {
    id: string;
    score: number;
    risk: NonNullable<ReturnType<typeof riskById.get>>;
  };
  const candidates: Candidate[] = [];
  for (const sig of getIntersectionSummaries()) {
    const score = stressById.get(sig.id) ?? 0;
    if (score < HOTSPOT_MIN_STRESS) continue;
    const risk = riskById.get(sig.id);
    if (!risk) continue;
    if (risk.riskTier !== "high" && risk.riskTier !== "severe") continue;
    candidates.push({ id: sig.id, score, risk });
  }

  // For each candidate, run the recommendation engine and combine into a
  // hotspot-impact score so the most life-safety-relevant fixes float up.
  const fixes: LiveHotspotFix[] = [];
  for (const c of candidates) {
    const inter = getIntersectionById(c.id);
    if (!inter) continue;
    const rec = getRecommendationFor(inter);

    // Skip "no action" recommendations — they have nothing to suggest.
    if (rec.suggestedPhaseSeconds <= rec.currentPhaseSeconds) continue;

    // Nearest active incident (if any) within HOTSPOT_INCIDENT_RADIUS_M.
    const nearest = nearestIncidentMeters(inter.latitude, inter.longitude, incGrid);
    const hasNearbyIncident = nearest !== null && nearest <= HOTSPOT_INCIDENT_RADIUS_M;

    // Combined hotspot score: weighted sum of normalized current stress,
    // crash severity, fatality bonus, and a small bump if a live incident is
    // currently within the radius. Capped at 100.
    const stressN = c.score / 100;                       // 0..1
    const crashN = Math.min(1, c.risk.crashes / 100);    // 0..1 (100+ crashes = 1.0)
    const fatalBonus = Math.min(0.2, c.risk.fatal * 0.05);
    const incidentBonus = hasNearbyIncident ? 0.1 : 0;
    const hotspotScore = Math.round(
      Math.min(1, stressN * 0.55 + crashN * 0.25 + fatalBonus + incidentBonus) * 1000,
    ) / 10;

    fixes.push({
      intersectionId: rec.intersectionId,
      intersectionName: rec.intersectionName,
      latitude: inter.latitude,
      longitude: inter.longitude,
      currentScore: Math.round(c.score * 10) / 10,
      // Intersection.roadClass is a string ("motorway"/"trunk"/"primary"/...)
      // but levelFromScore expects the numeric class index used by the
      // segment renderer (0=motorway,1=trunk,2=primary,3=secondary). Map it.
      currentLevel: levelFromScore(c.score, roadClassToIndex(inter.roadClass)),
      hasNearbyIncident,
      nearestIncidentMeters: nearest === null ? null : Math.round(nearest),
      crashes: c.risk.crashes,
      fatal: c.risk.fatal,
      seriousInjuries: c.risk.seriousInjuries,
      riskTier: c.risk.riskTier,
      targetPhase: rec.targetPhase,
      targetMovement: rec.targetMovement,
      currentPhaseSeconds: rec.currentPhaseSeconds,
      suggestedPhaseSeconds: rec.suggestedPhaseSeconds,
      currentCycleLength: rec.currentCycleLength,
      suggestedCycleLength: rec.suggestedCycleLength,
      estimatedDelayReductionSeconds: rec.estimatedDelayReductionSeconds,
      rationale: rec.rationale,
      hotspotScore,
    });
  }

  fixes.sort((a, b) => b.hotspotScore - a.hotspotScore);
  const top = fixes.slice(0, HOTSPOT_LIMIT);

  const bundle: LiveHotspotFixesBundle = {
    fetchedAt: new Date(t0).toISOString(),
    currentHourLocal: hour,
    hourLabel: hourLabel(hour),
    totalCandidates: candidates.length,
    fixes: top,
    note:
      "Signals shown are operating in heavy or worse congestion right now AND " +
      "sit on a high or severe historical-crash intersection. Suggested phase " +
      "extensions come from the same Webster's-delay-driven engine the main " +
      "dashboard uses; they are advisory and assume an operator-in-the-loop " +
      "review before deployment.",
  };
  hotspotCache = { at: Date.now(), bundle };
  logger.info(
    { ms: Date.now() - t0, candidates: candidates.length, fixes: top.length, hour },
    "live-hotspot-fixes: refreshed",
  );
  return bundle;
}

function nearestIncidentMeters(
  lat: number,
  lon: number,
  incGrid: Map<string, { lat: number; lon: number }[]>,
): number | null {
  const cy = Math.floor(lat / SIGNAL_CELL);
  const cx = Math.floor(lon / SIGNAL_CELL);
  let best: number | null = null;
  for (let dy = -SEARCH_RING; dy <= SEARCH_RING; dy++) {
    for (let dx = -SEARCH_RING; dx <= SEARCH_RING; dx++) {
      const bucket = incGrid.get(`${cy + dy}|${cx + dx}`);
      if (!bucket) continue;
      for (const i of bucket) {
        const d = distM(lat, lon, i.lat, i.lon);
        if (best === null || d < best) best = d;
      }
    }
  }
  return best;
}
