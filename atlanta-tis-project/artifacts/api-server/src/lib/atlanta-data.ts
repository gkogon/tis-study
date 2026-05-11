import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// SignalTuple v2: [osm_id, lat, lon, name|null, roadClass]
// roadClass: 0=motorway, 1=trunk, 2=primary, 3=secondary, 4=other
export type SignalTuple = [number, number, number, string | null, number];

export type RoadNetwork = {
  classes: string[];
  ways: unknown[];
};

const __dirname = dirname(fileURLToPath(import.meta.url));

function findData(filename: string): string {
  // In dev (tsx) __dirname = src/lib, so ../data hits src/data.
  // In prod (esbuild bundled dist/index.mjs) __dirname = dist/, so data/
  // is the sibling we copy from build.mjs.
  const candidates = [
    resolve(__dirname, `data/${filename}`),
    resolve(__dirname, `../data/${filename}`),
    resolve(process.cwd(), `artifacts/api-server/dist/data/${filename}`),
    resolve(process.cwd(), `artifacts/api-server/src/data/${filename}`),
  ];
  for (const path of candidates) {
    try {
      // existence probe — caller will read it for real anyway, but we want to
      // surface clear errors here rather than half-decoded JSON downstream.
      readFileSync(path, "utf8").length;
      return path;
    } catch {
      // try next
    }
  }
  throw new Error(`${filename} not found in any candidate path`);
}

let cachedSignals: SignalTuple[] | null = null;

export function loadSignals(): SignalTuple[] {
  if (cachedSignals) return cachedSignals;
  const text = readFileSync(findData("atlanta-signals.json"), "utf8");
  cachedSignals = JSON.parse(text) as SignalTuple[];
  return cachedSignals;
}

let cachedRoads: RoadNetwork | null = null;

export function loadRoadNetwork(): RoadNetwork {
  if (cachedRoads) return cachedRoads;
  const text = readFileSync(findData("atlanta-roads.json"), "utf8");
  cachedRoads = JSON.parse(text) as RoadNetwork;
  return cachedRoads;
}

// Per-signal accident aggregate as a tuple to keep the JSON compact:
// [totalCrashes, fatal, seriousInjuries, severityScoreSum]
export type AccidentTuple = [number, number, number, number];

export type AccidentDataset = {
  meta: {
    fetchedAt: string;
    sourceCollisions: string;
    sourceFARS: string;
    totalCrashes: number;
    snappedCrashes: number;
    snappedPct: number;
    unsnappedCrashes: number;
    badCoords: number;
    signalsWithData: number;
    snapRadiusMeters: number;
    dateRange: string;
    farsRecords: number;
  };
  perSignal: Record<string, AccidentTuple>;
  hourly: number[]; // 24
  dow: number[];    // 7 (Sun..Sat)
  monthly: number[]; // 12
};

let cachedAccidents: AccidentDataset | null = null;
let accidentsLoadAttempted = false;

// Returns null if the preprocess script hasn't been run yet (atlanta-accidents.json
// doesn't exist). Callers should treat null as "no historical data available".
export function loadAccidents(): AccidentDataset | null {
  if (cachedAccidents) return cachedAccidents;
  if (accidentsLoadAttempted) return null;
  accidentsLoadAttempted = true;
  try {
    const text = readFileSync(findData("atlanta-accidents.json"), "utf8");
    cachedAccidents = JSON.parse(text) as AccidentDataset;
    return cachedAccidents;
  } catch {
    return null;
  }
}

export const ROAD_CLASS_NAMES = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "other",
] as const;

// Zone definitions (axis-aligned bounding boxes). Order matters: first match wins.
type Zone = { name: string; latMin: number; latMax: number; lonMin: number; lonMax: number };

const ZONES: Zone[] = [
  { name: "Downtown", latMin: 33.745, latMax: 33.770, lonMin: -84.405, lonMax: -84.378 },
  { name: "Midtown", latMin: 33.770, latMax: 33.805, lonMin: -84.405 , lonMax: -84.370 },
  { name: "Buckhead", latMin: 33.825, latMax: 33.880, lonMin: -84.405, lonMax: -84.345 },
  { name: "West Midtown", latMin: 33.770, latMax: 33.825, lonMin: -84.450, lonMax: -84.405 },
  { name: "Decatur", latMin: 33.755, latMax: 33.800, lonMin: -84.320, lonMax: -84.265 },
  { name: "East Atlanta", latMin: 33.715, latMax: 33.760, lonMin: -84.370, lonMax: -84.300 },
  { name: "South Atlanta", latMin: 33.680, latMax: 33.745, lonMin: -84.450, lonMax: -84.345 },
  { name: "Sandy Springs", latMin: 33.880, latMax: 33.965, lonMin: -84.410, lonMax: -84.330 },
  { name: "Dunwoody", latMin: 33.920, latMax: 33.975, lonMin: -84.370, lonMax: -84.275 },
  { name: "Smyrna", latMin: 33.835, latMax: 33.900, lonMin: -84.560, lonMax: -84.460 },
  { name: "Marietta / Cobb", latMin: 33.870, latMax: 34.080, lonMin: -84.700, lonMax: -84.430 },
  { name: "Roswell / Alpharetta", latMin: 33.965, latMax: 34.150, lonMin: -84.420, lonMax: -84.230 },
  { name: "Norcross / Gwinnett", latMin: 33.940, latMax: 34.180, lonMin: -84.250, lonMax: -83.900 },
  { name: "Stone Mountain / DeKalb", latMin: 33.755, latMax: 33.940, lonMin: -84.265, lonMax: -84.000 },
  { name: "Douglas / West", latMin: 33.600, latMax: 34.000, lonMin: -84.950, lonMax: -84.700 },
  { name: "Cherokee / Forsyth", latMin: 34.080, latMax: 34.400, lonMin: -84.700, lonMax: -84.000 },
  { name: "Clayton / South", latMin: 33.300, latMax: 33.680, lonMin: -84.500, lonMax: -84.250 },
  { name: "Henry / Southeast", latMin: 33.300, latMax: 33.680, lonMin: -84.250, lonMax: -83.900 },
];

export function zoneFor(lat: number, lon: number): string {
  for (const z of ZONES) {
    if (lat >= z.latMin && lat <= z.latMax && lon >= z.lonMin && lon <= z.lonMax) {
      return z.name;
    }
  }
  return "Outer Metro";
}

export function listZones(): string[] {
  return [...ZONES.map((z) => z.name), "Outer Metro"];
}

// Atlanta CBD center (Five Points)
export const ATL_CENTER_LAT = 33.7490;
export const ATL_CENTER_LON = -84.3880;

// Approximate haversine distance in miles between two lat/lon points.
export function distanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Deterministic PRNG seeded by signal id, so every value is stable across reloads.
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
