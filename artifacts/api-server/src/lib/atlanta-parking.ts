/**
 * Atlanta parking demand modeling.
 *
 * Pipeline:
 *   1. Load real OSM-derived parking inventory (atlanta-parking.json).
 *   2. Estimate per-lot effective capacity (use OSM capacity tag when present,
 *      otherwise a kind-based default that's transparent and defensible).
 *   3. Classify each lot's demand archetype (commercial/office/event/p&r/mixed)
 *      from name + kind + proximity to known venue clusters. Deterministic.
 *   4. Compute current fill % from a per-archetype 24h curve, day-of-week
 *      multiplier, and weather drag.
 *   5. Apply event-driven surge near major venues when an event window is
 *      active for the current hour.
 *   6. Project hour-by-hour fill for the next 12 hours and report
 *      first-hour-it-fills as ETA-to-full.
 *
 * NOTE: This is a *modeled* product, not live sensor data. We surface the
 * source explicitly in API responses so consumers know it.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tuple shape (kept short): [id, lat, lon, name|null, kind, capacity|null, fee, accessCode]
export type ParkingTuple = [
  number,
  number,
  number,
  string | null,
  number,
  number | null,
  number,
  number,
];

export const KIND_LABELS: Record<number, string> = {
  0: "surface",
  1: "garage",
  2: "multi-storey",
  3: "underground",
  4: "street",
  5: "other",
};

export const FEE_LABELS: Record<number, string> = {
  0: "free",
  1: "paid",
  2: "unknown",
};

export const ACCESS_LABELS: Record<number, string> = {
  0: "public",
  1: "customers",
  2: "permit",
  3: "private",
  4: "unknown",
};

export const ARCHETYPE_LABELS = [
  "commercial",
  "office",
  "event",
  "park_and_ride",
  "university",
  "airport",
  "mixed",
] as const;
export type Archetype = (typeof ARCHETYPE_LABELS)[number];

/** Kind-based capacity fallback when OSM has no `capacity=` tag. */
const KIND_DEFAULT_CAPACITY: Record<number, number> = {
  0: 90,   // surface
  1: 380,  // garage
  2: 520,  // multi-storey
  3: 280,  // underground
  4: 18,   // street_side / on_street
  5: 70,   // other
};

/**
 * Major Atlanta venues that drive demand surges. Lots within `radiusKm` get
 * an event-window surge multiplier on their baseline demand.
 */
interface Venue {
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  /** Demand archetype to assign nearby unnamed lots when nothing else matches. */
  archetype: Archetype;
  /** Hours-of-day when an event is typically active (24h, local). */
  eventHours: number[];
  /** Multiplier applied to baseline during eventHours. */
  surge: number;
  /** Days of week (0=Sun..6=Sat) the event runs. Empty = all days. */
  eventDays?: number[];
}

// Sandy Springs anchor venues — these are the demand-generators that drive
// every visible surge on the map. Coordinates are real and inside the bbox the
// fetch script uses for the inventory dump.
const VENUES: Venue[] = [
  { name: "Perimeter Mall",                lat: 33.9234, lon: -84.3413, radiusKm: 0.9, archetype: "commercial", eventHours: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20], surge: 2.0 },
  { name: "City Springs Performing Arts",  lat: 33.9305, lon: -84.3733, radiusKm: 0.5, archetype: "event",      eventHours: [18, 19, 20, 21, 22],                       surge: 3.6, eventDays: [4, 5, 6] },
  { name: "Heritage Green / Sandy Springs",lat: 33.9275, lon: -84.3737, radiusKm: 0.4, archetype: "event",      eventHours: [10, 11, 12, 13, 14, 15, 16, 17],           surge: 2.4, eventDays: [0, 6] },
  { name: "Northside Hospital",            lat: 33.9226, lon: -84.3527, radiusKm: 0.6, archetype: "office",     eventHours: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16],      surge: 1.8, eventDays: [1, 2, 3, 4, 5] },
  { name: "Concourse Corporate Center",    lat: 33.9226, lon: -84.3514, radiusKm: 0.5, archetype: "office",     eventHours: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17],     surge: 1.9, eventDays: [1, 2, 3, 4, 5] },
  { name: "Mercedes-Benz USA HQ",          lat: 33.9248, lon: -84.3498, radiusKm: 0.4, archetype: "office",     eventHours: [8, 9, 10, 11, 12, 13, 14, 15, 16, 17],     surge: 1.7, eventDays: [1, 2, 3, 4, 5] },
  { name: "The Prado",                     lat: 33.9180, lon: -84.3780, radiusKm: 0.4, archetype: "commercial", eventHours: [11, 12, 13, 17, 18, 19, 20],               surge: 1.6 },
  { name: "Hammond Park",                  lat: 33.9251, lon: -84.3611, radiusKm: 0.5, archetype: "event",      eventHours: [9, 10, 11, 12, 13, 14, 15, 16, 17],        surge: 1.8, eventDays: [0, 6] },
];

/** 24-hour baseline occupancy curves (0..1) per archetype. */
const HOURLY_CURVES: Record<Archetype, number[]> = {
  // commercial retail: midday + early evening peaks
  commercial:    [0.05,0.04,0.03,0.03,0.04,0.06,0.10,0.18,0.28,0.40,0.55,0.68,0.78,0.82,0.80,0.78,0.82,0.88,0.85,0.72,0.55,0.38,0.22,0.12],
  // office: 9-5 ramp
  office:        [0.06,0.05,0.05,0.05,0.06,0.10,0.22,0.45,0.72,0.90,0.95,0.93,0.85,0.88,0.92,0.90,0.78,0.55,0.32,0.20,0.14,0.10,0.08,0.07],
  // event venue: empty until evening
  event:         [0.02,0.02,0.02,0.02,0.03,0.04,0.05,0.06,0.06,0.07,0.08,0.10,0.12,0.14,0.16,0.18,0.22,0.30,0.42,0.55,0.50,0.32,0.18,0.08],
  // park-and-ride: AM commute peak, holds, slight PM dip
  park_and_ride: [0.10,0.10,0.10,0.12,0.18,0.35,0.62,0.85,0.92,0.94,0.95,0.95,0.94,0.93,0.92,0.88,0.78,0.55,0.32,0.22,0.18,0.15,0.12,0.10],
  // university: weekday mid-morning to mid-afternoon
  university:    [0.08,0.06,0.05,0.05,0.06,0.10,0.20,0.40,0.65,0.82,0.90,0.92,0.88,0.85,0.78,0.65,0.48,0.32,0.22,0.18,0.15,0.13,0.11,0.10],
  // airport: bimodal (morning departures + afternoon returns)
  airport:       [0.45,0.42,0.40,0.42,0.55,0.68,0.78,0.82,0.80,0.78,0.78,0.80,0.82,0.85,0.88,0.90,0.88,0.82,0.72,0.62,0.55,0.52,0.50,0.48],
  // mixed-use: smooth midday hump
  mixed:         [0.10,0.08,0.07,0.07,0.08,0.12,0.22,0.38,0.55,0.65,0.72,0.76,0.78,0.78,0.76,0.74,0.72,0.68,0.58,0.42,0.30,0.22,0.16,0.12],
};

/** Per-archetype day-of-week multiplier (0=Sun..6=Sat). */
const DOW_MULT: Record<Archetype, number[]> = {
  commercial:    [0.85, 0.78, 0.82, 0.85, 0.92, 1.10, 1.20],
  office:        [0.18, 1.00, 1.05, 1.05, 1.05, 0.95, 0.22],
  event:         [1.20, 0.65, 0.70, 0.75, 0.85, 1.10, 1.30],
  park_and_ride: [0.20, 1.05, 1.05, 1.05, 1.05, 0.95, 0.30],
  university:    [0.20, 1.05, 1.05, 1.05, 1.05, 0.85, 0.35],
  airport:       [1.00, 0.95, 0.92, 0.94, 1.00, 1.10, 1.05],
  mixed:         [0.78, 0.92, 0.95, 0.95, 1.00, 1.05, 1.00],
};

// ─────────────────────────────────────────────────────────────────────────
// Data loading
// ─────────────────────────────────────────────────────────────────────────

function findData(filename: string): string {
  const candidates = [
    path.resolve(__dirname, `data/${filename}`),
    path.resolve(__dirname, `../data/${filename}`),
    path.resolve(process.cwd(), `artifacts/api-server/dist/data/${filename}`),
    path.resolve(process.cwd(), `artifacts/api-server/src/data/${filename}`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(`${filename} not found in any candidate path`);
}

let cachedLots: ParkingTuple[] | null = null;

export function loadParkingLots(): ParkingTuple[] {
  if (cachedLots) return cachedLots;
  const text = readFileSync(findData("atlanta-parking.json"), "utf8");
  cachedLots = JSON.parse(text) as ParkingTuple[];
  return cachedLots;
}

// ─────────────────────────────────────────────────────────────────────────
// Per-lot derived attributes
// ─────────────────────────────────────────────────────────────────────────

/**
 * Approximate haversine in km. Plenty accurate for "is this lot near a venue"
 * checks at metro scale.
 */
function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Stable PRNG seeded from osm id. Same approach used by atlanta-analysis. */
function seedHash(id: number): number {
  let h = id | 0;
  h = (h ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000;
}

interface Derived {
  capacity: number;
  archetype: Archetype;
  baseline: number;     // multiplier on the curve (0.6..1.3)
  nearestVenue: { name: string; distanceKm: number } | null;
}

const derivedCache = new Map<number, Derived>();

function deriveAttrs(t: ParkingTuple): Derived {
  const id = t[0];
  const cached = derivedCache.get(id);
  if (cached) return cached;

  const [, lat, lon, name, kind, osmCapacity] = t;
  const r = seedHash(id);

  // Capacity: trust OSM if present, else kind-default with ±25% jitter.
  const capacity =
    osmCapacity ??
    Math.max(6, Math.round(KIND_DEFAULT_CAPACITY[kind] * (0.75 + r * 0.5)));

  // Archetype classification
  let archetype: Archetype = "mixed";
  let nearestVenue: Derived["nearestVenue"] = null;
  let bestDist = Infinity;
  for (const v of VENUES) {
    const d = distanceKm(lat, lon, v.lat, v.lon);
    if (d < bestDist) {
      bestDist = d;
      nearestVenue = { name: v.name, distanceKm: d };
    }
    if (d <= v.radiusKm) {
      archetype = v.archetype;
      // First hit wins (venues are listed in priority order).
      break;
    }
  }

  // Name-based hints override venue proximity for unambiguous cases.
  const lname = (name ?? "").toLowerCase();
  if (lname) {
    if (/marta|park\s*&\s*ride|park\s*and\s*ride|kiss\s*&\s*ride|transit/.test(lname)) {
      archetype = "park_and_ride";
    } else if (/airport|hartsfield|jackson intl|park[' ]?n[' ]?fly/.test(lname)) {
      archetype = "airport";
    } else if (/stadium|arena|amphitheater|coliseum|world congress|convention/.test(lname)) {
      archetype = "event";
    } else if (/university|college|emory|tech|gsu|kennesaw|spelman|morehouse/.test(lname)) {
      archetype = "university";
    } else if (/office|tower|plaza|corporate|center parkway|complex/.test(lname) && archetype === "mixed") {
      archetype = "office";
    } else if (/mall|market|shop|store|target|walmart|kroger|publix/.test(lname) && archetype === "mixed") {
      archetype = "commercial";
    }
  }

  // Per-lot baseline jitter (0.7..1.25) so identical archetypes don't all
  // peak at exactly the same value — keeps the map visually varied.
  const baseline = 0.7 + r * 0.55;

  const out: Derived = { capacity, archetype, baseline, nearestVenue };
  derivedCache.set(id, out);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Occupancy modeling
// ─────────────────────────────────────────────────────────────────────────

export interface OccupancyContext {
  hour: number;          // 0..23
  dow: number;           // 0..6 (Sun..Sat)
  weather: "clear" | "light_rain" | "heavy_rain" | "snow";
  /** Manually-injected event surge override, e.g. "force a Falcons game now". */
  forceEventSurge?: boolean;
}

function weatherDrag(w: OccupancyContext["weather"], a: Archetype): number {
  // Bad weather *increases* parking demand at airports and offices (people drive
  // instead of bike/walk) and *decreases* it at retail/event archetypes.
  switch (w) {
    case "clear":      return 1.0;
    case "light_rain": return a === "commercial" || a === "event" ? 0.92 : 1.04;
    case "heavy_rain": return a === "commercial" || a === "event" ? 0.78 : 1.10;
    case "snow":       return a === "commercial" || a === "event" ? 0.55 : 0.85;
  }
}

function venueSurge(t: ParkingTuple, ctx: OccupancyContext): { mult: number; venue: string | null } {
  const [, lat, lon] = t;
  let bestMult = 1;
  let venueName: string | null = null;
  for (const v of VENUES) {
    if (v.eventDays && !v.eventDays.includes(ctx.dow)) continue;
    if (!ctx.forceEventSurge && !v.eventHours.includes(ctx.hour)) continue;
    const d = distanceKm(lat, lon, v.lat, v.lon);
    if (d > v.radiusKm) continue;
    // Falloff with distance from venue center.
    const falloff = Math.max(0.4, 1 - d / v.radiusKm);
    const mult = 1 + (v.surge - 1) * falloff;
    if (mult > bestMult) {
      bestMult = mult;
      venueName = v.name;
    }
  }
  return { mult: bestMult, venue: venueName };
}

export interface LotOccupancy {
  capacity: number;
  fillPct: number;       // 0..100
  spacesFree: number;
  archetype: Archetype;
  surgeFromVenue: string | null;
  drivers: string[];     // human-readable bullets explaining the value
}

export function modelLotOccupancy(t: ParkingTuple, ctx: OccupancyContext): LotOccupancy {
  const d = deriveAttrs(t);
  const curve = HOURLY_CURVES[d.archetype];
  const dow = DOW_MULT[d.archetype];

  const baseRaw = curve[ctx.hour] * dow[ctx.dow] * d.baseline;
  const wMult = weatherDrag(ctx.weather, d.archetype);
  const { mult: vMult, venue } = venueSurge(t, ctx);

  let occ = baseRaw * wMult * vMult;
  // Soft-cap at 1.0 with a smooth "runs over"-handling so high-demand lots
  // are visibly maxed without going non-physical.
  if (occ > 1) occ = 1 - Math.exp(-(occ - 1)) + 1; // approaches 2, but we clamp
  occ = Math.max(0, Math.min(1, occ));

  const fillPct = Math.round(occ * 1000) / 10;
  const spacesFree = Math.max(0, Math.round(d.capacity * (1 - occ)));

  const drivers: string[] = [];
  drivers.push(`${d.archetype} archetype, ${nthHourLabel(ctx.hour)} on ${dowName(ctx.dow)}`);
  if (vMult > 1.05 && venue) drivers.push(`event surge from ${venue} (×${vMult.toFixed(2)})`);
  if (wMult < 0.95) drivers.push(`weather drag (${ctx.weather}, ×${wMult.toFixed(2)})`);
  if (wMult > 1.03) drivers.push(`weather lift (${ctx.weather}, ×${wMult.toFixed(2)})`);
  if (occ >= 0.95) drivers.push("at or near capacity");

  return {
    capacity: d.capacity,
    fillPct,
    spacesFree,
    archetype: d.archetype,
    surgeFromVenue: venue,
    drivers,
  };
}

function nthHourLabel(h: number): string {
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}
function dowName(d: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d] ?? "?";
}

// ─────────────────────────────────────────────────────────────────────────
// Forecast & ETA-to-full
// ─────────────────────────────────────────────────────────────────────────

export interface ForecastHour {
  hour: number;
  label: string;
  fillPct: number;
  spacesFree: number;
}

export function forecastLot(
  t: ParkingTuple,
  startCtx: OccupancyContext,
  hoursAhead = 12,
): ForecastHour[] {
  const out: ForecastHour[] = [];
  for (let i = 0; i < hoursAhead; i++) {
    const h = (startCtx.hour + i) % 24;
    const dayShift = Math.floor((startCtx.hour + i) / 24);
    const dow = (startCtx.dow + dayShift) % 7;
    const occ = modelLotOccupancy(t, { ...startCtx, hour: h, dow });
    out.push({
      hour: h,
      label: nthHourLabel(h),
      fillPct: occ.fillPct,
      spacesFree: occ.spacesFree,
    });
  }
  return out;
}

/**
 * Returns minutes until the lot first hits the FULL_THRESHOLD (default 95%),
 * or null if it doesn't fill within `hoursAhead`. Linear interpolation between
 * hourly forecast points keeps the answer smooth.
 */
const FULL_THRESHOLD = 95;

export function etaToFullMinutes(
  t: ParkingTuple,
  startCtx: OccupancyContext,
  hoursAhead = 12,
): number | null {
  const series = forecastLot(t, startCtx, hoursAhead + 1);
  // If we're already full, ETA is 0.
  if (series[0].fillPct >= FULL_THRESHOLD) return 0;
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].fillPct;
    const cur = series[i].fillPct;
    if (cur >= FULL_THRESHOLD && prev < FULL_THRESHOLD) {
      // Linear interp inside this hour
      const frac = (FULL_THRESHOLD - prev) / (cur - prev);
      return Math.round((i - 1 + frac) * 60);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Aggregate views
// ─────────────────────────────────────────────────────────────────────────

export interface ParkingSummaryView {
  asOf: string;
  totalLots: number;
  totalCapacity: number;
  occupiedSpaces: number;
  fillPct: number;
  fullLots: number;
  nearFullLots: number;
  surgeEvents: ParkingSurgeView[];
  byArchetype: Record<string, { lots: number; capacity: number; fillPct: number }>;
  sourceNote: string;
}

export interface ParkingSurgeView {
  venue: string;
  lat: number;
  lon: number;
  affectedLots: number;
  affectedCapacity: number;
  fillPct: number;
}

export interface ParkingLotView {
  id: string;
  lat: number;
  lon: number;
  name: string | null;
  kind: string;
  fee: string;
  access: string;
  capacity: number;
  fillPct: number;
  spacesFree: number;
  etaMinutes: number | null;
  archetype: string;
  surgeFromVenue: string | null;
}

export interface ParkingLotDetailView extends ParkingLotView {
  hourly: ForecastHour[];
  drivers: string[];
  nearestVenue: { name: string; distanceKm: number } | null;
}

function nowContext(forceSurge = false): OccupancyContext {
  const now = new Date();
  return {
    hour: now.getHours(),
    dow: now.getDay(),
    weather: "clear",
    forceEventSurge: forceSurge,
  };
}

function tupleToView(t: ParkingTuple, ctx: OccupancyContext, eta: number | null): ParkingLotView {
  const occ = modelLotOccupancy(t, ctx);
  return {
    id: String(t[0]),
    lat: t[1],
    lon: t[2],
    name: t[3],
    kind: KIND_LABELS[t[4]] ?? "other",
    fee: FEE_LABELS[t[6]] ?? "unknown",
    access: ACCESS_LABELS[t[7]] ?? "unknown",
    capacity: occ.capacity,
    fillPct: occ.fillPct,
    spacesFree: occ.spacesFree,
    etaMinutes: eta,
    archetype: occ.archetype,
    surgeFromVenue: occ.surgeFromVenue,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Snapshot cache
//
// Every public read (summary, lots, single-lot detail) reads from the same
// per-minute snapshot. Building a snapshot is the only place we iterate the
// 13.8K-lot inventory + per-lot 12h forecast, and that work is amortized
// across every request inside a 60-second window. This keeps unauthenticated
// public endpoints from triggering O(N×H) compute on every hit, satisfying
// the "bounded compute" guarantee in threat_model.md.
// ─────────────────────────────────────────────────────────────────────────

interface Snapshot {
  computedAtMin: number;
  asOf: string;
  lotsList: ParkingLotView[];
  byId: Map<number, ParkingLotView>;
  summary: ParkingSummaryView;
}

let snapshotNormal: Snapshot | null = null;
let snapshotSurge: Snapshot | null = null;

function buildSnapshot(forceSurge: boolean): Snapshot {
  const ctx = nowContext(forceSurge);
  const tuples = loadParkingLots();
  const lotsList: ParkingLotView[] = new Array(tuples.length);
  const byId = new Map<number, ParkingLotView>();

  let totalCapacity = 0;
  let occupiedSpaces = 0;
  let fullLots = 0;
  let nearFullLots = 0;

  const archetypeRoll: Record<string, { lots: number; capacity: number; occ: number }> = {};
  for (const a of ARCHETYPE_LABELS) archetypeRoll[a] = { lots: 0, capacity: 0, occ: 0 };
  const venueRoll: Record<string, { affectedLots: number; affectedCapacity: number; occSum: number }> = {};

  for (let i = 0; i < tuples.length; i++) {
    const t = tuples[i];
    const occ = modelLotOccupancy(t, ctx);
    const eta = occ.fillPct >= FULL_THRESHOLD ? 0 : etaToFullMinutes(t, ctx);
    const view = tupleToView(t, ctx, eta);
    lotsList[i] = view;
    byId.set(t[0], view);

    totalCapacity += occ.capacity;
    occupiedSpaces += Math.round(occ.capacity * occ.fillPct / 100);
    if (occ.fillPct >= 99) fullLots++;
    else if (occ.fillPct >= 90) nearFullLots++;

    const a = archetypeRoll[occ.archetype];
    if (a) { a.lots++; a.capacity += occ.capacity; a.occ += occ.capacity * occ.fillPct / 100; }

    if (occ.surgeFromVenue) {
      const v = (venueRoll[occ.surgeFromVenue] ??= { affectedLots: 0, affectedCapacity: 0, occSum: 0 });
      v.affectedLots++;
      v.affectedCapacity += occ.capacity;
      v.occSum += occ.capacity * occ.fillPct / 100;
    }
  }

  const surgeEvents: ParkingSurgeView[] = Object.entries(venueRoll)
    .map(([venue, v]) => {
      const meta = VENUES.find((vv) => vv.name === venue)!;
      return {
        venue,
        lat: meta.lat,
        lon: meta.lon,
        affectedLots: v.affectedLots,
        affectedCapacity: v.affectedCapacity,
        fillPct: v.affectedCapacity > 0
          ? Math.round((v.occSum / v.affectedCapacity) * 1000) / 10
          : 0,
      };
    })
    .sort((a, b) => b.affectedCapacity - a.affectedCapacity);

  const byArchetype: ParkingSummaryView["byArchetype"] = {};
  for (const [k, v] of Object.entries(archetypeRoll)) {
    byArchetype[k] = {
      lots: v.lots,
      capacity: v.capacity,
      fillPct: v.capacity > 0 ? Math.round((v.occ / v.capacity) * 1000) / 10 : 0,
    };
  }

  const asOf = new Date().toISOString();
  const summary: ParkingSummaryView = {
    asOf,
    totalLots: tuples.length,
    totalCapacity,
    occupiedSpaces,
    fillPct: totalCapacity > 0 ? Math.round((occupiedSpaces / totalCapacity) * 1000) / 10 : 0,
    fullLots,
    nearFullLots,
    surgeEvents,
    byArchetype,
    sourceNote:
      "Lots: OpenStreetMap amenity=parking (Sandy Springs, GA). Names default to the nearest restaurant within ~250m. Capacity: OSM tag where available, kind-based default otherwise. Occupancy: modeled from per-archetype 24h curves + day-of-week + weather + venue-event surges. Source is modeled, not live sensors.",
  };

  return {
    computedAtMin: Math.floor(Date.now() / 60_000),
    asOf,
    lotsList,
    byId,
    summary,
  };
}

function getSnapshot(forceSurge: boolean): Snapshot {
  const minNow = Math.floor(Date.now() / 60_000);
  const cur = forceSurge ? snapshotSurge : snapshotNormal;
  if (cur && cur.computedAtMin === minNow) return cur;
  const built = buildSnapshot(forceSurge);
  if (forceSurge) snapshotSurge = built;
  else snapshotNormal = built;
  return built;
}

export function getAllLotsView(forceSurge = false): ParkingLotView[] {
  return getSnapshot(forceSurge).lotsList;
}

export function getParkingSummaryView(forceSurge = false): ParkingSummaryView {
  return getSnapshot(forceSurge).summary;
}

export function getLotByIdView(id: string, forceSurge = false): ParkingLotDetailView | null {
  const numId = Number(id);
  if (!Number.isFinite(numId)) return null;
  const snap = getSnapshot(forceSurge);
  const base = snap.byId.get(numId);
  if (!base) return null;

  // 12h forecast and driver bullets are computed on demand for the single
  // lot — bounded work (24 occupancy evaluations per request) so it's safe
  // to keep outside the snapshot.
  const t = loadParkingLots().find((row) => row[0] === numId);
  if (!t) return null;
  const d = deriveAttrs(t);
  const ctx = nowContext(forceSurge);
  return {
    ...base,
    hourly: forecastLot(t, ctx, 12),
    drivers: modelLotOccupancy(t, ctx).drivers,
    nearestVenue: d.nearestVenue,
  };
}
