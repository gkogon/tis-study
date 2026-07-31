/**
 * US state boundary polygons — build the committed data asset.
 *
 * Why this exists: a metro's `Region.stateCode` is a single value for a
 * bounding box, and several metro bboxes deliberately straddle state lines —
 * new_york_metro covers Bergen/Hudson/Essex NJ, philadelphia_metro covers
 * Camden/Gloucester NJ, washington_dc_metro covers NoVA and suburban MD.
 * Using the metro's stateCode as a proxy for "what state is this site in"
 * hands a New Jersey site the NYSDOT HDM Chapter 5 shell, and a Fairfax
 * County site the DDOT / 24 DCMR citations. Those are jurisdictional and
 * legal claims, so they have to key off the site coordinate, not the metro.
 *
 * Source: Census TIGERweb State_County MapServer (layer 0 = states), the same
 * ArcGIS REST pattern the DOT fetchers already use. STUSAB is the two-letter
 * postal code, which is what Region.stateCode and the CONFIGS table are keyed
 * on, so no crosswalk is needed.
 *
 * maxAllowableOffset=0.0005 (~55 m) is a deliberate choice: unsimplified is
 * 20.4 MB for precision nobody needs, and 0.002 (~220 m) starts putting river
 * borders in the wrong state. At 0.0005 the asset is ~1.8 MB and resolves
 * Fort Lee NJ (Hudson) and Camden NJ (Delaware) correctly — both sit within
 * a kilometre of another state and both are real prospect territory.
 *
 * Run:  pnpm --filter @workspace/scripts exec tsx src/fetch-state-boundaries.ts
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.resolve(
  __dirname,
  "../../artifacts/tis-api-server/data/us-state-boundaries.json",
);

const ENDPOINT =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/0/query";

/** ~55 m. See header — do not coarsen without re-checking the river borders. */
const MAX_ALLOWABLE_OFFSET = 0.0005;

type Ring = [number, number][];
type StateRecord = {
  code: string;
  name: string;
  fips: string;
  /** [lonMin, latMin, lonMax, latMax] — prefilter before point-in-polygon. */
  bbox: [number, number, number, number];
  /** Polygons; each polygon is [outerRing, ...holes]. */
  polys: Ring[][];
};

function ringsOf(geometry: { type: string; coordinates: unknown }): Ring[][] {
  if (geometry.type === "Polygon") return [geometry.coordinates as Ring[]];
  if (geometry.type === "MultiPolygon") return geometry.coordinates as Ring[][];
  throw new Error(`unexpected geometry type: ${geometry.type}`);
}

function bboxOf(polys: Ring[][]): [number, number, number, number] {
  let lonMin = Infinity, latMin = Infinity, lonMax = -Infinity, latMax = -Infinity;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const [lon, lat] of ring) {
        if (lon < lonMin) lonMin = lon;
        if (lon > lonMax) lonMax = lon;
        if (lat < latMin) latMin = lat;
        if (lat > latMax) latMax = lat;
      }
    }
  }
  return [lonMin, latMin, lonMax, latMax];
}

async function main(): Promise<void> {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "STATE,NAME,STUSAB",
    returnGeometry: "true",
    geometryPrecision: "5",
    maxAllowableOffset: String(MAX_ALLOWABLE_OFFSET),
    f: "geojson",
  });

  console.log("→ fetching state boundaries from TIGERweb…");
  const res = await fetch(`${ENDPOINT}?${params}`);
  if (!res.ok) throw new Error(`TIGERweb ${res.status} ${res.statusText}`);
  const fc = (await res.json()) as {
    features?: {
      properties: { STATE: string; NAME: string; STUSAB: string };
      geometry: { type: string; coordinates: unknown } | null;
    }[];
    exceededTransferLimit?: boolean;
  };

  if (fc.exceededTransferLimit) {
    throw new Error("TIGERweb truncated the response — paginate before trusting this asset");
  }
  const features = fc.features ?? [];
  if (features.length < 51) {
    throw new Error(`expected >=51 features (50 states + DC), got ${features.length}`);
  }

  const states: StateRecord[] = [];
  let vertices = 0;
  for (const f of features) {
    if (!f.geometry) continue;
    const polys = ringsOf(f.geometry);
    for (const poly of polys) for (const ring of poly) vertices += ring.length;
    states.push({
      code: f.properties.STUSAB,
      name: f.properties.NAME,
      fips: f.properties.STATE,
      bbox: bboxOf(polys),
      polys,
    });
  }
  states.sort((a, b) => a.code.localeCompare(b.code));

  const asset = {
    meta: {
      generated: new Date().toISOString(),
      source: "Census TIGERweb State_County MapServer layer 0 (states)",
      endpoint: ENDPOINT,
      maxAllowableOffset: MAX_ALLOWABLE_OFFSET,
      approxPrecisionMeters: 55,
      states: states.length,
      vertices,
    },
    states,
  };

  writeFileSync(OUT_PATH, JSON.stringify(asset));
  const mb = (JSON.stringify(asset).length / 1e6).toFixed(2);
  console.log(`✓ ${states.length} states, ${vertices} vertices, ${mb} MB → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
