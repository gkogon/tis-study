/**
 * Generic OSM road-network fetcher, keyed off a region in the registry.
 *
 * For a given region code, queries OpenStreetMap (Overpass API) for every
 * highway way in CLASSES (motorway through unclassified, plus _link
 * subtypes) inside the region's bounding box — named or not. Output mirrors
 * atlanta-roads.json:
 *
 *   {
 *     "classes": ["motorway","trunk","primary","secondary","tertiary",
 *                 "residential","unclassified"],
 *     "ways": [
 *       [classCode, "Way Name", [[lat,lon], ...], lanes|null, maxspeedKmh|null, oneway],
 *     ]
 *   }
 *
 * The roads file backs cross-street naming (e.g. "Roswell Rd & Mt Vernon Hwy")
 * for signals in that region. Without it, signals show as "Signal #<osmId>".
 *
 * Trailing `lanes` + `maxspeedKmh` (both null when untagged in OSM) feed the
 * per-road AADT modulation in precompute-tier10-synthetic-aadt.ts, and `oneway`
 * feeds route assignment. Readers that only need geometry/name (runtime naming,
 * the naming precompute) ignore the trailing fields — they read indices 0..2 and
 * tolerate any tuple length >= 3.
 *
 * NOTE: files shipped before 2026-08 carry only 5 classes and no `oneway`;
 * roadSegmentsNear tolerates both vintages, so regions can be re-fetched
 * incrementally rather than in one flag day.
 *
 * OUTPUT FORMAT: written as `<slug>-roads.json.gz` (gzip -9). The
 * residential refetch grows the raw corpus to a projected ~3.4GB —
 * florida-statewide alone would blow GitHub's 100MB per-file hard limit —
 * so raw JSON must never land on disk for new fetches. Every reader
 * resolves .json.gz first with a .json fallback (api-server data-files.ts,
 * scripts road-file-io.ts), so old raw files keep working; a stale raw twin
 * of a re-fetched region is deleted so it can't shadow-confuse tooling.
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-osm-roads.ts charlotte_metro
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-osm-roads.ts --all
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-osm-roads.ts --osm-only
 */

import { writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipJson } from "./road-file-io";
import {
  REGIONS,
  type Region,
  type RegionCode,
} from "../../artifacts/tis-api-server/src/lib/regions";

const CLASSES = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
  "unclassified",
] as const;
const CLASS_CODE = new Map(CLASSES.map((c, i) => [c, i] as const));

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type OverpassWay = {
  type: "way";
  id: number;
  tags?: { highway?: string; name?: string; lanes?: string; maxspeed?: string; oneway?: string };
  geometry?: Array<{ lat: number; lon: number }>;
};
type OverpassResp = { elements: OverpassWay[] };

/**
 * One-way direction relative to the way's own node order:
 *   1  traffic flows first-node -> last-node
 *  -1  traffic flows last-node -> first-node ("oneway=-1")
 *   0  two-way
 *
 * Nothing downstream captured this before, so the router treated every link as
 * bidirectional and would happily route a left turn against traffic on a
 * one-way pair - visibly wrong to any reviewing engineer. Measured on the
 * NW 7 Ave corridor, 21% of named ways carry a one-way tag.
 *
 * "reversible" and "alternating" are rare and not one-way in the static sense,
 * so they fall through to 0.
 */
function parseOneway(raw: string | undefined): number {
  if (!raw) return 0;
  const v = raw.trim().toLowerCase();
  if (v === "yes" || v === "true" || v === "1") return 1;
  if (v === "-1" || v === "reverse") return -1;
  return 0;
}

/** OSM `lanes` is total both-directions; values like "2", "3", "2;3" occur.
 *  Take the max of any ;-separated list. Returns null when untagged/unparseable. */
function parseLanes(raw: string | undefined): number | null {
  if (!raw) return null;
  let best: number | null = null;
  for (const part of raw.split(";")) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n > 0 && n < 30 && (best === null || n > best)) best = n;
  }
  return best;
}

/** OSM `maxspeed` → km/h. Handles "50", "50 mph", "50 km/h"; null for zone
 *  refs ("RU:urban"), "none", "walk", or anything non-numeric. */
function parseMaxspeedKmh(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh|kph)?$/);
  if (!m) return null;
  const val = Number.parseFloat(m[1]!);
  if (!Number.isFinite(val) || val <= 0) return null;
  const kmh = m[2] === "mph" ? val * 1.60934 : val;
  return Math.round(kmh);
}

/** Tile the bbox into ~0.14°×0.14° cells. Tiling BOTH axes (not just latitude
 *  strips) keeps every Overpass query small even for metros that are wide in
 *  longitude — a full-width strip across a wide bbox 504s/times out on the
 *  mirrors. Cross-cell duplicate ways are deduped by OSM id downstream. */
function bboxStrips(region: Region, cellDeg = 0.14): string[] {
  const { latMin, latMax, lonMin, lonMax } = region.bounds;
  const out: string[] = [];
  for (let s = latMin; s < latMax; s += cellDeg) {
    const e = Math.min(s + cellDeg, latMax);
    for (let w = lonMin; w < lonMax; w += cellDeg) {
      const x = Math.min(w + cellDeg, lonMax);
      out.push(`${s.toFixed(2)},${w.toFixed(2)},${e.toFixed(2)},${x.toFixed(2)}`);
    }
  }
  return out;
}

/** Avoid regex (~"=~) — the main Overpass mirror sometimes 406s on it.
 *  Literal equality filters for each class+link are slower-looking but
 *  actually faster in practice and work everywhere. */
function buildQuery(bbox: string): string {
  const queries: string[] = [];
  for (const c of CLASSES) {
    queries.push(`way["highway"="${c}"](${bbox});`);
    queries.push(`way["highway"="${c}_link"](${bbox});`);
  }
  return `
[out:json][timeout:180];
(
${queries.join("\n")}
);
out tags geom;
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
            "User-Agent": "tis-study/1.0 (roads-fetch)",
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
        console.log(`  → ${json.elements.length} ways`);
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

function regionSlug(code: RegionCode): string {
  return code.replace(/_metro$/, "").replace(/_/g, "-");
}

async function fetchOneRegion(regionCode: RegionCode): Promise<{
  region: Region;
  outPath: string;
  kept: number;
  byClass: Record<string, number>;
}> {
  const region = REGIONS[regionCode];
  if (!region) throw new Error(`Unknown region: ${regionCode}`);
  if (region.bounds.latMin === 0 && region.bounds.latMax === 0) {
    throw new Error(`Region ${regionCode} has placeholder bounds; fill in regions.ts first`);
  }

  const strips = bboxStrips(region);
  console.log(`\n=== ${regionCode} (${region.displayName}) — ${strips.length} strips ===`);

  const seenIds = new Set<number>();
  const ways: unknown[] = [];
  let dupes = 0;
  let skippedClass = 0;
  let skippedGeom = 0;
  const byClass: Record<string, number> = {};

  for (const bbox of strips) {
    const resp = await fetchOneStrip(bbox, regionCode);
    for (const el of resp.elements) {
      if (seenIds.has(el.id)) { dupes++; continue; }
      seenIds.add(el.id);

      const hw = el.tags?.highway;
      // Unnamed ways kept with name = null (Option A, 2026-08-25) — ramps
      // and no-street-name-country residential grids feed the router.
      const name = el.tags?.name?.trim() || null;
      if (!hw) { skippedClass++; continue; }
      const baseClass = hw.endsWith("_link") ? hw.slice(0, -5) : hw;
      const code = CLASS_CODE.get(baseClass as (typeof CLASSES)[number]);
      if (code === undefined) { skippedClass++; continue; }

      const geom = el.geometry;
      if (!geom || geom.length < 2) { skippedGeom++; continue; }

      // 5-decimal rounding (~1.1m precision) — ~30% bundle reduction
      // with no visible effect on naming distance computations.
      const polyline = geom.map((p) => [
        Math.round(p.lat * 1e5) / 1e5,
        Math.round(p.lon * 1e5) / 1e5,
      ]);
      const lanes = parseLanes(el.tags?.lanes);
      const maxspeed = parseMaxspeedKmh(el.tags?.maxspeed);
      const oneway = parseOneway(el.tags?.oneway);
      ways.push([code, name, polyline, lanes, maxspeed, oneway]);
      byClass[baseClass] = (byClass[baseClass] ?? 0) + 1;
    }
    await sleep(5_000);
  }

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const slug = regionSlug(regionCode);
  const dataDir = path.resolve(__dirname, "../../artifacts/api-server/src/data");
  mkdirSync(dataDir, { recursive: true });
  const outPath = path.resolve(dataDir, `${slug}-roads.json.gz`);
  writeFileSync(outPath, gzipJson(JSON.stringify({ classes: [...CLASSES], ways })));
  // A leftover raw twin would waste ~4x the bytes and risk being committed;
  // readers prefer .gz anyway, so the raw file is pure liability once the
  // gz exists.
  const rawTwin = path.resolve(dataDir, `${slug}-roads.json`);
  if (existsSync(rawTwin)) {
    rmSync(rawTwin);
    console.log(`  (removed stale raw twin ${rawTwin})`);
  }

  console.log(`✔ ${regionCode}: ${ways.length} ways (${JSON.stringify(byClass)}) [dupes=${dupes} skipped_class=${skippedClass} skipped_geom=${skippedGeom}] → ${outPath}`);
  return { region, outPath, kept: ways.length, byClass };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const wantAll = args.includes("--all");
  const wantOsmOnly = args.includes("--osm-only");
  const codes: RegionCode[] = wantOsmOnly
    ? (Object.keys(REGIONS) as RegionCode[]).filter(
        (c) => REGIONS[c].active && REGIONS[c].dataSourceId === "osm_only",
      )
    : wantAll
      ? (Object.keys(REGIONS) as RegionCode[]).filter((c) => REGIONS[c].active && c !== "atlanta_metro")
      : (args.filter((a) => !a.startsWith("--")) as RegionCode[]);

  if (codes.length === 0) {
    console.error("Usage: tsx src/fetch-osm-roads.ts <region_code> [<region_code>...]");
    console.error("       tsx src/fetch-osm-roads.ts --all");
    console.error(`Active regions: ${Object.keys(REGIONS).filter((c) => REGIONS[c as RegionCode].active).join(", ")}`);
    process.exit(2);
  }

  const summary: Array<{ code: string; kept: number }> = [];
  for (const code of codes) {
    try {
      const { kept } = await fetchOneRegion(code);
      summary.push({ code, kept });
    } catch (err) {
      console.error(`✗ ${code}: ${(err as Error).message}`);
      summary.push({ code, kept: -1 });
    }
  }

  console.log(`\n=== Summary ===`);
  for (const s of summary) {
    console.log(`  ${s.code}: ${s.kept >= 0 ? `${s.kept} ways` : "FAILED"}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
