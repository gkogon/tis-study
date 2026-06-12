/**
 * Fetch IDOT state-route geometries within the Chicago bounding box,
 * densify to a point set, and write a compact JSON the IL renderer
 * uses to dispatch `chicago_idot` (IDOT/CDOT co-review) when a
 * project fronts a state-system route inside the city.
 *
 * Why: the IL TIS spec (REGIONAL-SPECS/illinois-tis-spec.md §8.1)
 * names ~400 mi of IDOT-jurisdiction roadway inside Chicago city
 * limits — US-41 (Lake Shore Drive), IL-50 (Cicero), IL-64 (North
 * Ave), IL-19 (Irving Park), IL-43 (Western), IL-1 (Halsted
 * portions), US-12/US-20/US-45, plus the expressway network. A TIS
 * site fronting one of those submits on IDOT BLR forms to District
 * 1 (Schaumburg) AND co-routes to CDOT PRC. Without this dispatch,
 * the renderer falls back to `chicago_cdot` for everything inside
 * the Chicago bbox — correct for CDOT-jurisdiction parcels, wrong
 * for parcels on a state route.
 *
 * Source: IDOT Historical AADT FeatureServer layer 2025
 *   https://gis1.dot.illinois.gov/arcgis/rest/services/
 *     AdministrativeData/AADT_Historical/FeatureServer/2025
 * filtered by MARKED_NAM IS NOT NULL within the Chicago bbox.
 * MARKED_NAM is IDOT's marked-route code: "I094" = Interstate 94,
 * "U041" = US Route 41, "S064" = IL State Route 64. Any segment
 * carrying a marked-route code is IDOT-system roadway.
 *
 * Each segment's polyline is densified to ~25m spacing (typical
 * Chicago grid block ~125m × 250m, so 25m spacing guarantees a
 * project parcel within frontage distance hits ≥1 point). The
 * output JSON is a flat array of {lat, lon, route} tuples.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-chicago-state-routes.ts
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
// chicago-state-routes.json is renderer-side dispatch data consumed
// by tis-api-server/src/lib/pdf-export.ts at module init, so it
// lives in the renderer's data dir (mirrors the fonts location).
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/tis-api-server/data");

// Same Chicago bbox the IL renderer's ilJurisdiction() uses to
// detect "inside Chicago" — slight buffer so we don't miss
// segments straddling the boundary.
const BBOX = { latMin: 41.60, latMax: 42.05, lonMin: -87.98, lonMax: -87.48 };
const URL_BASE = "https://gis1.dot.illinois.gov/arcgis/rest/services/AdministrativeData/AADT_Historical/FeatureServer/2025/query";
const PAGE = 2000;
const DENSIFY_M = 25;

type Feature = {
  attributes: { MARKED_NAM: string | null };
  geometry?: { paths?: Array<Array<[number, number]>> };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mLon;
  const dy = (lat2 - lat1) * mLat;
  return Math.hypot(dx, dy);
}

function densifyLine(coords: Array<[number, number]>, route: string, out: Point[]): void {
  for (let i = 0; i < coords.length; i++) {
    const [lon, lat] = coords[i];
    out.push({ lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, route });
    if (i === coords.length - 1) break;
    const [lon2, lat2] = coords[i + 1];
    const segLen = distM(lat, lon, lat2, lon2);
    const steps = Math.floor(segLen / DENSIFY_M);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push({
        lat: Math.round((lat + (lat2 - lat) * t) * 1e5) / 1e5,
        lon: Math.round((lon + (lon2 - lon) * t) * 1e5) / 1e5,
        route,
      });
    }
  }
}

type Point = { lat: number; lon: number; route: string };

/**
 * Map IDOT's marked-route code (e.g. "I094", "U041", "S064") to a
 * human-readable route string for the output ("I-94", "US-41",
 * "IL-64"). Lets the renderer cite the actual route name to the
 * reviewer.
 */
function humanRoute(code: string): string {
  const m = code.match(/^([IUS])(\d{3})$/);
  if (!m) return code;
  const [, prefix, num] = m;
  const n = String(Number(num)); // strip leading zeros
  return prefix === "I" ? `I-${n}` : prefix === "U" ? `US-${n}` : `IL-${n}`;
}

async function main(): Promise<void> {
  console.log(`Fetching Chicago state routes from IDOT AADT 2025 layer`);
  console.log(`  bbox: ${BBOX.lonMin},${BBOX.latMin},${BBOX.lonMax},${BBOX.latMax}`);

  const all: Point[] = [];
  const routeCounts = new Map<string, number>();
  let offset = 0;
  for (let page = 0; page < 100; page++) {
    const url = new URL(URL_BASE);
    url.searchParams.set("where", "MARKED_NAM IS NOT NULL AND MARKED_NAM <> ''");
    url.searchParams.set("geometry", `${BBOX.lonMin},${BBOX.latMin},${BBOX.lonMax},${BBOX.latMax}`);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("outSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("outFields", "MARKED_NAM");
    url.searchParams.set("returnGeometry", "true");
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(PAGE));
    url.searchParams.set("f", "json");
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`IDOT @${offset}: ${res.status}`);
    const j = (await res.json()) as { features?: Feature[]; exceededTransferLimit?: boolean };
    const feats = j.features ?? [];
    for (const f of feats) {
      const code = f.attributes.MARKED_NAM;
      if (!code) continue;
      const route = humanRoute(code);
      routeCounts.set(route, (routeCounts.get(route) ?? 0) + 1);
      if (!f.geometry?.paths) continue;
      for (const pathPts of f.geometry.paths) {
        densifyLine(pathPts, route, all);
      }
    }
    if (!j.exceededTransferLimit || feats.length === 0) break;
    offset += feats.length;
    await sleep(200);
  }

  console.log(`Segments by route:`);
  for (const [r, n] of [...routeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r.padEnd(8)} ${n}`);
  }

  // Dedup by (lat, lon) — adjacent segments produce overlapping
  // endpoint points that don't help spatial lookup. Quantized to 5
  // decimals (≈1m) so identical lat/lon collide cleanly.
  const seen = new Set<string>();
  const deduped: Point[] = [];
  for (const p of all) {
    const k = `${p.lat}|${p.lon}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(p);
  }

  console.log(`Densified points: ${all.length} → deduped ${deduped.length}`);

  const outPath = path.resolve(DATA_DIR, "chicago-state-routes.json");
  // Compact array form keeps the file small.
  const payload = {
    source: "IDOT Historical AADT FeatureServer layer 2025 (MARKED_NAM where not null, within Chicago bbox)",
    densifyM: DENSIFY_M,
    pointCount: deduped.length,
    routes: [...routeCounts.keys()].sort(),
    points: deduped.map((p) => [p.lat, p.lon, p.route]),
  };
  writeFileSync(outPath, JSON.stringify(payload));
  console.log(`Wrote ${outPath} — ${deduped.length} points across ${routeCounts.size} routes`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
