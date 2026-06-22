/**
 * Region road-network loader for the bounded /roads endpoint.
 *
 * The TIS engine's four-step route-assignment step needs the local road
 * graph around a project site. The full per-region `<slug>-roads.json`
 * files are large (tens of thousands of OSM ways), so this module loads
 * one (cached per slug) and returns only the segments within a small
 * radius of the site — a payload the engine can build a graph from in
 * milliseconds. Fails soft (returns null) when a region has no road file.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { regionCodeToSlug } from "./regional-intersections";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findData(filename: string): string | null {
  const candidates = [
    resolve(__dirname, `data/${filename}`),
    resolve(__dirname, `../data/${filename}`),
    resolve(process.cwd(), "artifacts/api-server/dist/data/" + filename),
    resolve(process.cwd(), "artifacts/api-server/src/data/" + filename),
  ];
  for (const path of candidates) {
    try { readFileSync(path, "utf8").length; return path; } catch { /* next */ }
  }
  return null;
}

type RoadWay = [number, Array<[number, number]>, (number | null)?, (number | null)?];
type RoadFile = { classes: string[]; ways: RoadWay[] };

const cache = new Map<string, RoadFile | null>();

function loadRoadFile(slug: string): RoadFile | null {
  if (cache.has(slug)) return cache.get(slug) ?? null;
  const path = findData(`${slug}-roads.json`);
  if (!path) { cache.set(slug, null); return null; }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as RoadFile;
    cache.set(slug, parsed);
    return parsed;
  } catch {
    cache.set(slug, null);
    return null;
  }
}

/** Compact directionless segment: [classCode, aLat, aLon, bLat, bLon, lanes, maxspeed]. */
export type RoadSegment = [number, number, number, number, number, number | null, number | null];

function distMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Road segments within `radiusMi` of (lat,lon) for a region. Returns null
 * when no road data exists for the region. Caps the returned set so a
 * pathological radius can't produce an unbounded payload.
 */
export function roadSegmentsNear(
  regionCode: string,
  lat: number,
  lon: number,
  radiusMi: number,
  cap = 8000,
): RoadSegment[] | null {
  const slug = regionCodeToSlug(regionCode);
  const road = loadRoadFile(slug);
  if (!road || !Array.isArray(road.ways)) return null;
  const r = Math.max(0.1, Math.min(8, radiusMi));
  const out: RoadSegment[] = [];
  for (const way of road.ways) {
    const cls = typeof way[0] === "number" ? way[0] : 99;
    const pts = way[1];
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const lanes = typeof way[2] === "number" ? way[2] : null;
    const maxspeed = typeof way[3] === "number" ? way[3] : null;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      // Keep the segment if either endpoint is within the radius.
      if (distMi(lat, lon, a[0], a[1]) <= r || distMi(lat, lon, b[0], b[1]) <= r) {
        out.push([cls, a[0], a[1], b[0], b[1], lanes, maxspeed]);
        if (out.length >= cap) return out;
      }
    }
  }
  return out;
}
