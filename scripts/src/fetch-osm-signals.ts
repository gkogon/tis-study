/**
 * Generic OSM traffic-signal fetcher, keyed off a region in the registry.
 *
 * For a given region code, queries OpenStreetMap (Overpass API) for every
 * `node[highway=traffic_signals]` inside the region's bounding box, and
 * writes the result as `<slug>-signals.json` in the api-server data dir.
 *
 * Output schema matches the existing atlanta-signals.json (compact tuple):
 *   [osm_id, lat, lon, name|null, roadClass]
 *
 * `roadClass` is set to 2 (primary) as a placeholder. The real cross-street
 * naming happens at API serve time in api-server/src/lib/<region>-signal-
 * naming.ts via the corresponding roads dataset.
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-osm-signals.ts charlotte_metro
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-osm-signals.ts --all
 */

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REGIONS,
  type Region,
  type RegionCode,
} from "../../artifacts/tis-api-server/src/lib/regions";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type OverpassNode = {
  type: "node";
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
};
type OverpassResp = { elements: OverpassNode[] };

/**
 * Build N latitude strips of ~0.07° each — halved from the original 0.14°
 * because Overpass mirrors have been timing out (504s) on the larger
 * payloads during the 2026-05-27 expansion run. Smaller strips = faster
 * per-query response + less likely to hit endpoint memory limits.
 * Output strings are "latMin,lonMin,latMax,lonMax" per Overpass convention.
 */
function bboxStrips(region: Region, stripDegLat = 0.07): string[] {
  const { latMin, latMax, lonMin, lonMax } = region.bounds;
  const out: string[] = [];
  let s = latMin;
  while (s < latMax) {
    const e = Math.min(s + stripDegLat, latMax);
    out.push(`${s.toFixed(2)},${lonMin.toFixed(2)},${e.toFixed(2)},${lonMax.toFixed(2)}`);
    s = e;
  }
  return out;
}

function buildQuery(bbox: string): string {
  return `
[out:json][timeout:180];
node["highway"="traffic_signals"](${bbox});
out;
`.trim();
}

async function fetchOneStrip(bbox: string, regionCode: string): Promise<OverpassResp> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        console.log(`[${regionCode}] bbox=${bbox} attempt=${attempt + 1} via ${url}`);
        const res = await fetch(url, {
          method: "POST",
          body: `data=${encodeURIComponent(buildQuery(bbox))}`,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "tis-study/1.0 (signals-fetch)",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(200_000),
        });
        if (res.status === 429 || res.status === 504) {
          const wait = 12_000 + attempt * 10_000;
          console.warn(`  ↳ ${res.status}, backing off ${wait / 1000}s`);
          await sleep(wait);
          continue;
        }
        if (!res.ok) {
          console.warn(`  ↳ ${res.status} ${res.statusText}`);
          continue;
        }
        const json = (await res.json()) as OverpassResp;
        console.log(`  → ${json.elements.length} signals`);
        return json;
      } catch (err) {
        console.warn(`  ↳ failed: ${(err as Error).message}`);
        lastErr = err;
      }
    }
    if (attempt < 3) {
      const wait = 20_000 + attempt * 10_000;
      console.log(`  … all endpoints exhausted on attempt ${attempt + 1}, waiting ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw new Error(`bbox ${bbox} failed: ${(lastErr as Error)?.message ?? "exhausted"}`);
}

/** Convert region code → slug for filename. atlanta_metro → atlanta. */
function regionSlug(code: RegionCode): string {
  return code.replace(/_metro$/, "").replace(/_/g, "-");
}

async function fetchOneRegion(regionCode: RegionCode): Promise<{
  region: Region;
  outPath: string;
  count: number;
}> {
  const region = REGIONS[regionCode];
  if (!region) throw new Error(`Unknown region: ${regionCode}`);
  if (region.bounds.latMin === 0 && region.bounds.latMax === 0) {
    throw new Error(`Region ${regionCode} has placeholder bounds (0,0,0,0); fill in regions.ts first`);
  }

  const strips = bboxStrips(region);
  console.log(`\n=== ${regionCode} (${region.displayName}) — ${strips.length} strips ===`);

  const all: OverpassNode[] = [];
  const seen = new Set<number>();
  for (const bbox of strips) {
    const resp = await fetchOneStrip(bbox, regionCode);
    for (const el of resp.elements) {
      if (seen.has(el.id)) continue;
      seen.add(el.id);
      all.push(el);
    }
    await sleep(5_000);
  }

  // Compact tuple format: [osm_id, lat, lon, name|null, roadClass]
  // roadClass placeholder = 2 (primary). Real class is computed at
  // serve time when the signal is named against the roads dataset.
  const tuples = all.map((n) => {
    const lat = Math.round(n.lat * 1e5) / 1e5;
    const lon = Math.round(n.lon * 1e5) / 1e5;
    const name = n.tags?.name ?? null;
    return [n.id, lat, lon, name, 2];
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const slug = regionSlug(regionCode);
  const dataDir = path.resolve(__dirname, "../../artifacts/api-server/src/data");
  mkdirSync(dataDir, { recursive: true });
  const outPath = path.resolve(dataDir, `${slug}-signals.json`);
  writeFileSync(outPath, JSON.stringify(tuples));

  console.log(`✔ ${regionCode}: ${tuples.length} signals → ${outPath}`);
  return { region, outPath, count: tuples.length };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantAll = args.includes("--all");
  const codes: RegionCode[] = wantAll
    ? (Object.keys(REGIONS) as RegionCode[]).filter((c) => REGIONS[c].active && c !== "atlanta_metro")
    : (args.filter((a) => !a.startsWith("--")) as RegionCode[]);

  if (codes.length === 0) {
    console.error("Usage: tsx src/fetch-osm-signals.ts <region_code> [<region_code>...]");
    console.error("       tsx src/fetch-osm-signals.ts --all");
    console.error(`Active regions: ${Object.keys(REGIONS).filter((c) => REGIONS[c as RegionCode].active).join(", ")}`);
    process.exit(2);
  }

  const summary: Array<{ code: string; count: number; path: string }> = [];
  for (const code of codes) {
    try {
      const { count, outPath } = await fetchOneRegion(code);
      summary.push({ code, count, path: outPath });
    } catch (err) {
      console.error(`✗ ${code}: ${(err as Error).message}`);
      summary.push({ code, count: -1, path: "" });
    }
  }

  console.log(`\n=== Summary ===`);
  for (const s of summary) {
    console.log(`  ${s.code}: ${s.count >= 0 ? `${s.count} signals` : "FAILED"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
