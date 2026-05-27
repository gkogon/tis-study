/**
 * Neighborhood polygon → zone-label lookup for non-Atlanta regions.
 *
 * Atlanta has a hand-curated list of named polygons in atlanta-data.ts.
 * For new regions (currently Nashville + Orlando) we ship the city's own
 * neighborhood polygons from open data and do point-in-polygon lookup at
 * serve time.
 *
 * Regions without a `<slug>-neighborhoods.geojson` file fall back to the
 * compass-quadrant zone label that regional-intersections.ts computes.
 *
 * Implementation: coarse 0.01°-grid spatial index over polygon bounding
 * boxes so each lookup only ray-casts against the few polygons whose bbox
 * could contain the point. Single point-in-polygon = standard ray casting
 * (no dependencies).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Polygon = {
  name: string;
  /** Outer ring (first ring of coordinates). Holes ignored — neighborhoods rarely have them. */
  ring: Array<[number, number]>; // [lon, lat]
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number };
};

type Index = {
  polygons: Polygon[];
  grid: Map<string, number[]>; // cell key → polygon indices whose bbox overlaps the cell
};

const CELL_DEG = 0.01;
const __dirname = dirname(fileURLToPath(import.meta.url));

function findData(filename: string): string | null {
  const candidates = [
    resolve(__dirname, `data/${filename}`),
    resolve(__dirname, `../data/${filename}`),
    resolve(process.cwd(), `artifacts/api-server/dist/data/${filename}`),
    resolve(process.cwd(), `artifacts/api-server/src/data/${filename}`),
  ];
  for (const p of candidates) {
    try { readFileSync(p, "utf8").length; return p; } catch { /* next */ }
  }
  return null;
}

function regionCodeToSlug(regionCode: string): string {
  return regionCode.replace(/_metro$/, "").replace(/_/g, "-");
}

function bboxOf(ring: Array<[number, number]>): Polygon["bbox"] {
  let latMin = Infinity, latMax = -Infinity, lonMin = Infinity, lonMax = -Infinity;
  for (const [lon, lat] of ring) {
    if (lat < latMin) latMin = lat;
    if (lat > latMax) latMax = lat;
    if (lon < lonMin) lonMin = lon;
    if (lon > lonMax) lonMax = lon;
  }
  return { latMin, latMax, lonMin, lonMax };
}

function buildIndex(geojson: { features: Array<{ properties: { name: string }; geometry: { type: string; coordinates: number[][][] | number[][][][] } }> }): Index {
  const polygons: Polygon[] = [];
  for (const f of geojson.features) {
    const name = f.properties?.name;
    if (!name) continue;
    const geom = f.geometry;
    if (!geom) continue;
    // Accept Polygon (coords = number[][][]) and MultiPolygon (coords = number[][][][]).
    const rings: Array<Array<[number, number]>> = [];
    if (geom.type === "Polygon") {
      rings.push((geom.coordinates as number[][][])[0]! as Array<[number, number]>);
    } else if (geom.type === "MultiPolygon") {
      for (const poly of geom.coordinates as number[][][][]) {
        rings.push((poly[0]!) as Array<[number, number]>);
      }
    } else {
      continue;
    }
    for (const ring of rings) {
      if (ring.length < 3) continue;
      polygons.push({ name, ring, bbox: bboxOf(ring) });
    }
  }
  const grid = new Map<string, number[]>();
  for (let i = 0; i < polygons.length; i++) {
    const b = polygons[i]!.bbox;
    const latCellMin = Math.floor(b.latMin / CELL_DEG);
    const latCellMax = Math.floor(b.latMax / CELL_DEG);
    const lonCellMin = Math.floor(b.lonMin / CELL_DEG);
    const lonCellMax = Math.floor(b.lonMax / CELL_DEG);
    for (let li = latCellMin; li <= latCellMax; li++) {
      for (let lo = lonCellMin; lo <= lonCellMax; lo++) {
        const k = `${li}_${lo}`;
        let bucket = grid.get(k);
        if (!bucket) { bucket = []; grid.set(k, bucket); }
        bucket.push(i);
      }
    }
  }
  return { polygons, grid };
}

/** Standard ray-casting point-in-polygon over the outer ring. */
function pointInRing(lat: number, lon: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!; // [lon, lat]
    const [xj, yj] = ring[j]!;
    const intersect =
      ((yi > lat) !== (yj > lat)) &&
      (lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

const indexCache = new Map<string, Index | null>();

function getIndex(regionCode: string): Index | null {
  if (indexCache.has(regionCode)) return indexCache.get(regionCode)!;
  const slug = regionCodeToSlug(regionCode);
  const p = findData(`${slug}-neighborhoods.geojson`);
  if (!p) {
    indexCache.set(regionCode, null);
    return null;
  }
  const geojson = JSON.parse(readFileSync(p, "utf8"));
  const idx = buildIndex(geojson);
  indexCache.set(regionCode, idx);
  return idx;
}

/** Return the neighborhood name at (lat, lon) for a region, or null if the
 *  region has no neighborhood data or the point isn't inside any polygon
 *  (e.g. signal sits outside city limits in a suburb). */
export function neighborhoodFor(regionCode: string, lat: number, lon: number): string | null {
  const idx = getIndex(regionCode);
  if (!idx) return null;
  const latCell = Math.floor(lat / CELL_DEG);
  const lonCell = Math.floor(lon / CELL_DEG);
  const bucket = idx.grid.get(`${latCell}_${lonCell}`);
  if (!bucket) return null;
  for (const i of bucket) {
    const poly = idx.polygons[i]!;
    const b = poly.bbox;
    if (lat < b.latMin || lat > b.latMax || lon < b.lonMin || lon > b.lonMax) continue;
    if (pointInRing(lat, lon, poly.ring)) return poly.name;
  }
  return null;
}

/** Reset cache — used by tests. */
export function _clearZonesCache(): void {
  indexCache.clear();
}
