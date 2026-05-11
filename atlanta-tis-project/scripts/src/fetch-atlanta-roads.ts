/**
 * Refetch the bundled Atlanta road network with broader highway classes so
 * we have enough named streets to label every signal with its two
 * cross-streets ("Roswell Rd & Mt Vernon Hwy").
 *
 * The previous file only included motorway/trunk/primary/secondary roads —
 * which means almost every neighborhood signal in Sandy Springs / Buckhead /
 * Decatur fell back to a coordinate label because its actual cross-streets
 * are tertiary or residential.
 *
 * Bbox covers all 7,393 bundled signals (33.30→34.40 lat, −84.95→−83.85 lon).
 *
 * Output schema (compact, matches the existing reader):
 *   {
 *     "classes": ["motorway","trunk","primary","secondary","tertiary","residential","unclassified"],
 *     "ways": [
 *       [classCode, "Way Name", [[lat,lon], ...]],   // named
 *       [classCode, [[lat,lon], ...]]                // unnamed (skipped on write)
 *     ]
 *   }
 *
 * Run: pnpm --filter @workspace/scripts run fetch-roads
 */

import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Full metro signal bbox split into 8 strips. Earlier 4-quadrant runs got
// 406'd by the main Overpass endpoint because some quadrants (esp. central
// Atlanta) returned too much. 8 lat-strips of ~0.14° each keeps every reply
// well within mirror limits.
const BBOX_STRIPS = [
  "33.30,-84.95,33.44,-83.85",
  "33.44,-84.95,33.58,-83.85",
  "33.58,-84.95,33.72,-83.85",
  "33.72,-84.95,33.85,-83.85",
  "33.85,-84.95,33.99,-83.85",
  "33.99,-84.95,34.13,-83.85",
  "34.13,-84.95,34.27,-83.85",
  "34.27,-84.95,34.40,-83.85",
];

// We keep the existing motorway/trunk/primary/secondary data and only fetch
// the missing `tertiary` class here, then merge. That single class is what
// covers most named arterials people recognize (Roswell Rd, Mt Vernon Hwy,
// Hammond Dr, Briarcliff, Northside Dr, etc.) and dramatically smaller queries
// keep us under public-endpoint limits. residential/unclassified are
// intentionally still excluded — too noisy and balloon the bundle.
const CLASSES = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
] as const;
const CLASS_CODE = new Map(CLASSES.map((c, i) => [c, i] as const));

// Only fetch tertiary; merge with the existing file's higher-class ways.
// Avoid `~` regex — the main Overpass mirror was 406'ing it. Two literal
// equality filters work everywhere and are no slower in practice.
function buildQuery(bbox: string): string {
  return `
[out:json][timeout:180];
(
  way["highway"="tertiary"]["name"](${bbox});
  way["highway"="tertiary_link"]["name"](${bbox});
);
out tags geom;
`.trim();
}

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

type OverpassWay = {
  type: "way";
  id: number;
  tags?: { highway?: string; name?: string };
  geometry?: Array<{ lat: number; lon: number }>;
};

type OverpassResp = {
  elements: OverpassWay[];
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchOneQuadrant(bbox: string): Promise<OverpassResp> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        console.log(`[roads] bbox=${bbox} attempt=${attempt + 1} via ${url}`);
        const res = await fetch(url, {
          method: "POST",
          body: `data=${encodeURIComponent(buildQuery(bbox))}`,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "atlanta-traffic-analyzer/1.0 (replit)",
            "Accept": "application/json",
          },
          signal: AbortSignal.timeout(200_000),
        });
        if (res.status === 429 || res.status === 504) {
          const wait = 12_000 + attempt * 10_000;
          console.warn(`  ↳ ${res.status}, backing off ${wait/1000}s`);
          await sleep(wait);
          continue;
        }
        if (!res.ok) {
          console.warn(`  ↳ ${res.status} ${res.statusText}`);
          continue;
        }
        const json = (await res.json()) as OverpassResp;
        console.log(`  → ${json.elements.length} elements`);
        return json;
      } catch (err) {
        console.warn(`  ↳ failed: ${(err as Error).message}`);
        lastErr = err;
      }
    }
    if (attempt < 3) {
      const wait = 20_000 + attempt * 10_000;
      console.log(`  … all endpoints exhausted on attempt ${attempt + 1}, waiting ${wait/1000}s`);
      await sleep(wait);
    }
  }
  throw new Error(`bbox ${bbox} failed: ${(lastErr as Error)?.message ?? "exhausted"}`);
}

async function fetchAll(): Promise<OverpassWay[]> {
  const all: OverpassWay[] = [];
  for (const bbox of BBOX_STRIPS) {
    const resp = await fetchOneQuadrant(bbox);
    all.push(...resp.elements);
    await sleep(5_000);
  }
  console.log(`[roads] Combined elements across strips: ${all.length}`);
  return all;
}

function loadExistingHigherClassWays(outPath: string): {
  ways: unknown[];
  byClass: Record<string, number>;
} {
  // Keep the previously bundled motorway/trunk/primary/secondary ways (codes
  // 0–3) since we're only fetching tertiary in this run.
  const existing = JSON.parse(readFileSync(outPath, "utf8")) as {
    classes: string[];
    ways: unknown[];
  };
  const byClass: Record<string, number> = {};
  const kept: unknown[] = [];
  for (const w of existing.ways) {
    const arr = w as unknown[];
    const code = arr[0] as number;
    if (code >= 0 && code <= 3) {
      kept.push(w);
      const className = existing.classes[code] ?? `code${code}`;
      byClass[className] = (byClass[className] ?? 0) + 1;
    }
  }
  console.log(`[roads] Carrying forward ${kept.length} existing higher-class ways`);
  return { ways: kept, byClass };
}

function main(): void {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.resolve(
    __dirname,
    "../../artifacts/api-server/src/data/atlanta-roads.json",
  );
  const carry = loadExistingHigherClassWays(outPath);

  // Preflight: bail before we overwrite the file if the prior dataset is
  // missing one of the higher classes. Otherwise a silent regression here
  // would degrade signal-naming coverage on the next API restart.
  for (const required of ["motorway", "trunk", "primary", "secondary"]) {
    if ((carry.byClass[required] ?? 0) === 0) {
      throw new Error(
        `Refusing to write: existing roads file has 0 '${required}' ways. ` +
          `That class would be lost on this run since we only re-fetch tertiary. ` +
          `Restore the prior file before re-running.`,
      );
    }
  }

  fetchAll().then((elements) => {
    const ways: unknown[] = [...carry.ways];
    let kept = 0;
    let skippedClass = 0;
    let skippedGeom = 0;
    let dupes = 0;
    const seenIds = new Set<number>();
    const byClass: Record<string, number> = { ...carry.byClass };

    for (const el of elements) {
      if (seenIds.has(el.id)) {
        dupes++;
        continue;
      }
      seenIds.add(el.id);
      const hw = el.tags?.highway;
      const name = el.tags?.name;
      if (!hw || !name) {
        skippedClass++;
        continue;
      }
      // _link subtypes get bucketed with their parent class.
      const baseClass = hw.endsWith("_link") ? hw.slice(0, -5) : hw;
      const code = CLASS_CODE.get(baseClass as (typeof CLASSES)[number]);
      if (code === undefined) {
        skippedClass++;
        continue;
      }
      const geom = el.geometry;
      if (!geom || geom.length < 2) {
        skippedGeom++;
        continue;
      }
      // Round to 5 decimals (≈1.1m precision) — saves ~30% on JSON size with
      // no visible effect on naming distance computations.
      const polyline = geom.map((p) => [
        Math.round(p.lat * 1e5) / 1e5,
        Math.round(p.lon * 1e5) / 1e5,
      ]);
      ways.push([code, name, polyline]);
      kept++;
      byClass[baseClass] = (byClass[baseClass] ?? 0) + 1;
    }

    const output = { classes: [...CLASSES], ways };
    writeFileSync(outPath, JSON.stringify(output));

    console.log("");
    console.log(`Total returned   : ${elements.length}`);
    console.log(`Duplicates merged: ${dupes}`);
    console.log(`Kept (named geom): ${kept}`);
    console.log(`Skipped (class)  : ${skippedClass}`);
    console.log(`Skipped (geom)   : ${skippedGeom}`);
    console.log(`By class         : ${JSON.stringify(byClass)}`);
    console.log(`✔ Wrote ${kept} ways → ${outPath}`);
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

main();
