/**
 * Fetch measured AADT for Oslo from Statens vegvesen's public
 * "Trafikkdata" GraphQL API (https://trafikkdata-api.atlas.vegvesen.no/).
 *
 * Fully open, no auth key. Two queries per run:
 *
 *   1. trafficRegistrationPoints(searchQuery:{countyNumbers:[3]}) →
 *      counter id + WGS84 lat/lon for every point in Oslo county
 *      (county 3 = Oslo kommune).
 *   2. trafficData(trafficRegistrationPointId:<id>){volume{average{
 *      daily{byYear{year,total{volume{average}}}}}}} — issued via
 *      GraphQL aliasing in batches of ~40 points per POST so we hit
 *      the API ~7 times instead of ~278.
 *
 * We take each counter's most recent non-null byYear entry as its
 * ÅDT (årsdøgntrafikk = annual average daily traffic). For a point
 * with 2015-2019 + 2025 data (2020-2024 nulls), that's 2025.
 *
 * Snap: 150m radius, same as Paris/Berlin/Madrid. Merges with the
 * existing synthetic baseline in oslo-aadt.json.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-oslo-aadt.ts
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

const GRAPHQL_URL = "https://trafikkdata-api.atlas.vegvesen.no/";
const OSLO_COUNTY = 3;
const OSLO_BBOX = { latMin: 59.83, latMax: 60.00, lonMin: 10.65, lonMax: 10.85 };
const SNAP_RADIUS_M = 150;
const BATCH_SIZE = 40;

type CounterPoint = { id: string; lat: number; lon: number; name: string };
type AadtRec = { aadt: number; year: number; kFactor: number; distM: number; source: string };

async function gql<T = unknown>(query: string): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data as T;
}

async function fetchCounters(): Promise<CounterPoint[]> {
  console.log("Fetching Oslo counter list...");
  type Resp = {
    trafficRegistrationPoints: Array<{
      id: string;
      name: string;
      location: { coordinates: { latLon: { lat: number; lon: number } } };
    }>;
  };
  const data = await gql<Resp>(
    `{trafficRegistrationPoints(searchQuery:{roadCategoryIds:[E,R,F,K],countyNumbers:[${OSLO_COUNTY}]}){id,name,location{coordinates{latLon{lat,lon}}}}}`,
  );
  const pts = data.trafficRegistrationPoints
    .map((p) => ({
      id: p.id,
      name: p.name,
      lat: p.location.coordinates.latLon.lat,
      lon: p.location.coordinates.latLon.lon,
    }))
    .filter(
      (p) =>
        p.lat >= OSLO_BBOX.latMin &&
        p.lat <= OSLO_BBOX.latMax &&
        p.lon >= OSLO_BBOX.lonMin &&
        p.lon <= OSLO_BBOX.lonMax,
    );
  console.log(`  ${pts.length} counters inside Oslo bbox`);
  return pts;
}

async function fetchAadtBatch(ids: string[]): Promise<Map<string, { aadt: number; year: number }>> {
  // GraphQL aliasing: pt0:trafficData(...) { ... } pt1:trafficData(...) { ... }
  const inner = "volume{average{daily{byYear{year,total{volume{average}}}}}}";
  const q =
    "{" +
    ids
      .map((id, i) => `pt${i}:trafficData(trafficRegistrationPointId:${JSON.stringify(id)}){${inner}}`)
      .join(",") +
    "}";
  type Node = {
    volume: {
      average: {
        daily: {
          byYear: Array<{ year: number; total: { volume: { average: number } } | null }>;
        };
      };
    };
  };
  const data = await gql<Record<string, Node | null>>(q);
  const out = new Map<string, { aadt: number; year: number }>();
  ids.forEach((id, i) => {
    const node = data[`pt${i}`];
    if (!node) return;
    const byYear = node.volume?.average?.daily?.byYear ?? [];
    // Take most recent year with a non-null total.
    const valid = byYear.filter((y) => y.total?.volume?.average != null);
    if (valid.length === 0) return;
    valid.sort((a, b) => b.year - a.year);
    const latest = valid[0]!;
    out.set(id, { aadt: Math.round(latest.total!.volume.average), year: latest.year });
  });
  return out;
}

function distMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mLon;
  const dy = (lat2 - lat1) * mLat;
  return Math.sqrt(dx * dx + dy * dy);
}

async function main(): Promise<void> {
  const slug = "oslo";
  const counters = await fetchCounters();

  console.log("Fetching AADT (batched)...");
  const withAadt: Array<CounterPoint & { aadt: number; year: number }> = [];
  for (let i = 0; i < counters.length; i += BATCH_SIZE) {
    const chunk = counters.slice(i, i + BATCH_SIZE);
    const aadtMap = await fetchAadtBatch(chunk.map((c) => c.id));
    for (const c of chunk) {
      const a = aadtMap.get(c.id);
      if (a) withAadt.push({ ...c, ...a });
    }
    console.log(`  batch ${i / BATCH_SIZE + 1}/${Math.ceil(counters.length / BATCH_SIZE)} → ${aadtMap.size}/${chunk.length} with data`);
  }
  console.log(`Counters with both geometry + AADT: ${withAadt.length}`);

  const sigPath = path.resolve(DATA_DIR, `${slug}-signals.json`);
  const aadtPath = path.resolve(DATA_DIR, `${slug}-aadt.json`);
  const signals = JSON.parse(readFileSync(sigPath, "utf8")) as Array<
    [number, number, number, string | null, number]
  >;
  const existing = existsSync(aadtPath)
    ? (JSON.parse(readFileSync(aadtPath, "utf8")) as Record<string, AadtRec>)
    : {};

  const measured: Record<string, AadtRec> = {};
  let snapped = 0;
  for (const [osmId, sLat, sLon] of signals) {
    let best: { c: typeof withAadt[number]; d: number } | null = null;
    for (const c of withAadt) {
      const d = distMeters(sLat, sLon, c.lat, c.lon);
      if (d > SNAP_RADIUS_M) continue;
      if (!best || d < best.d) best = { c, d };
    }
    if (best) {
      measured[String(osmId)] = {
        aadt: best.c.aadt,
        year: best.c.year,
        kFactor: 10,
        distM: Math.round(best.d),
        source: "vegvesen_trafikkdata",
      };
      snapped++;
    }
  }
  console.log(`Snapped ${snapped} / ${signals.length} = ${(snapped / signals.length * 100).toFixed(1)}%`);

  const merged: Record<string, AadtRec> = {};
  for (const [k, v] of Object.entries(existing)) {
    if (v.source === "synthetic_osm_class") merged[k] = v;
  }
  for (const [k, v] of Object.entries(measured)) merged[k] = v;
  writeFileSync(aadtPath, JSON.stringify(merged));
  console.log(`Wrote ${aadtPath} — ${Object.keys(merged).length} total (measured ${snapped})`);

  const measuredPct = Math.round((snapped / signals.length) * 1000) / 10;
  let coverage = readFileSync(COVERAGE_PATH, "utf8");
  const pattern = /(\{ code: "oslo_metro",[^}]*?)aadtPct:\s*[0-9.]+,([^}]*?)aadtSource:\s*"[^"]*",\s*aadtQuality:\s*"[^"]*",/;
  if (pattern.test(coverage)) {
    coverage = coverage.replace(
      pattern,
      `$1aadtPct: ${measuredPct},$2aadtSource: "Statens vegvesen Trafikkdata (ÅDT via public GraphQL, ${withAadt.length} counters)", aadtQuality: "measured",`,
    );
    writeFileSync(COVERAGE_PATH, coverage);
    console.log(`Updated oslo_metro: aadtPct=${measuredPct}%, quality=measured`);
  } else {
    console.log("! pattern miss — coverage.ts not updated (may need aadtSource/aadtQuality fields first)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
