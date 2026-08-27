/**
 * Gatineau-side signal append for the Ottawa CMA inventory.
 *
 * Tier-8 built ottawa-signals.json from the Geofabrik *ontario* PBF, so the
 * Québec bank of the Ottawa River (Hull, Aylmer, central Gatineau — inside
 * the ottawa_metro bbox, latMax 45.5) shipped with ZERO signals. That leaves
 * the gatineau_open_data_debits deepfill source (7,384 approach counts,
 * registered in fetch-canada-aadt-deepfill.ts as ott-gatineau) with nothing
 * to snap to.
 *
 * This script queries Overpass for node[highway=traffic_signals] inside the
 * ottawa_metro bbox restricted to the Québec provincial area, and APPENDS
 * the result to ottawa-signals.json. Ottawa ids are sequential positional
 * ints (0..2593, Geofabrik pipeline re-keying) and ottawa-aadt.json is keyed
 * by them, so existing tuples must never shift or re-key — new signals get
 * ids continuing after the existing max. Candidates within 25 m of an
 * existing signal are dropped (belt-and-suspenders; the ontario/quebec
 * extracts should not overlap here).
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/fetch-gatineau-signals.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS } from "../../artifacts/tis-api-server/src/lib/regions";

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

type SignalTuple = [number, number, number, string | null, number];

function buildQuery(bbox: string): string {
  return `
[out:json][timeout:180];
area["ISO3166-2"="CA-QC"][admin_level="4"]->.qc;
node["highway"="traffic_signals"](area.qc)(${bbox});
out;
`.trim();
}

async function fetchQcSignals(bbox: string): Promise<OverpassResp> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        console.log(`[ottawa_metro/QC] bbox=${bbox} attempt=${attempt + 1} via ${url}`);
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

function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mLon;
  const dy = (lat2 - lat1) * mLat;
  return Math.sqrt(dx * dx + dy * dy);
}

async function main(): Promise<void> {
  const region = REGIONS.ottawa_metro;
  const { latMin, latMax, lonMin, lonMax } = region.bounds;
  const bbox = `${latMin},${lonMin},${latMax},${lonMax}`;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outPath = path.resolve(__dirname, "../../artifacts/api-server/src/data/ottawa-signals.json");
  const existing = JSON.parse(readFileSync(outPath, "utf8")) as SignalTuple[];
  const qcBefore = existing.filter((t) => t[1] > 45.46 && t[2] < -75.63).length;
  console.log(`Existing inventory: ${existing.length} signals (${qcBefore} on the Québec side)`);

  const resp = await fetchQcSignals(bbox);

  // Dedupe within the fetch (Overpass can return a node once per mirror
  // retry path) and against the existing Ontario-extract inventory.
  const seen = new Set<number>();
  let nextId = existing.reduce((m, t) => Math.max(m, t[0]), -1) + 1;
  const appended: SignalTuple[] = [];
  let dupDropped = 0;
  for (const n of resp.elements) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    const lat = Math.round(n.lat * 1e5) / 1e5;
    const lon = Math.round(n.lon * 1e5) / 1e5;
    const nearExisting = existing.some((t) => distM(lat, lon, t[1], t[2]) < 25);
    if (nearExisting) {
      dupDropped++;
      continue;
    }
    // Same compact tuple the Tier-8 pipeline wrote: roadClass placeholder 2,
    // real class/naming resolved at serve time (regional-intersections.ts).
    appended.push([nextId++, lat, lon, n.tags?.name ?? null, 2]);
  }

  const merged = [...existing, ...appended];
  writeFileSync(outPath, JSON.stringify(merged));

  const qcAfter = merged.filter((t) => t[1] > 45.46 && t[2] < -75.63).length;
  console.log(
    `✔ appended ${appended.length} Québec-side signals (${dupDropped} dropped within 25 m of existing) → ${merged.length} total`,
  );
  console.log(`  Québec-side check (lat>45.46 & lon<-75.63): ${qcBefore} → ${qcAfter}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
