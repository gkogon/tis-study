/**
 * Fetch measured AADT for Paris from Paris Open Data (opendata.paris.fr).
 *
 * Source: "Comptage routier - Données trafic issues des capteurs permanents"
 * https://opendata.paris.fr/explore/dataset/comptages-routiers-permanents/
 *
 * Algorithm:
 *   1. Aggregate hourly flow (`q`) by counter id (`iu_ac`) over the most
 *      recent full 365-day window the dataset covers.
 *   2. Compute AADT = annual_q_sum / 365 for each counter.
 *   3. Pull counter geometry from the sibling "referentiel-comptages-routiers"
 *      dataset (WGS84 lat/lon).
 *   4. Snap each counter to the nearest Paris signal within SNAP_RADIUS_M.
 *   5. Write paris-aadt.json with source: "paris_opendata" — the runtime
 *      AADT loader will pick this up over the synthetic baseline since
 *      both files share the same path. This commit overwrites the
 *      synthetic file (which is fine — we want measured to win).
 *
 * Coverage: Paris has ~3,700 counter records in the referential, but a
 * smaller subset are currently active. Real-world snap rate to the
 * ~11,000 Paris signals tends to land at 5–15%; everything else falls
 * back to the engine's road-class baseline at serve time.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-paris-aadt.ts
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

const SNAP_RADIUS_M = 100;
const PARIS_BBOX = { latMin: 48.78, latMax: 48.95, lonMin: 2.20, lonMax: 2.50 };

const REF_URL =
  "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/referentiel-comptages-routiers/records";
const FLOW_URL =
  "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/comptages-routiers-permanents/records";

type CounterRef = {
  iu_ac: string;
  geo_point_2d: { lat: number; lon: number };
};
type CounterAadt = {
  iu_ac: string;
  aadt: number;
  hourCount: number;
};

async function fetchAllPaged<T>(
  url: string,
  params: Record<string, string>,
  pageSize = 100,
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const qs = new URLSearchParams({ ...params, limit: String(pageSize), offset: String(offset) });
    const res = await fetch(`${url}?${qs.toString()}`);
    if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
    const json = (await res.json()) as { total_count: number; results: T[] };
    out.push(...json.results);
    if (json.results.length < pageSize) break;
    offset += pageSize;
    if (offset > 50_000) break; // hard cap, sanity
  }
  return out;
}

async function fetchRef(): Promise<CounterRef[]> {
  console.log("Fetching counter referential...");
  const refs = await fetchAllPaged<CounterRef>(REF_URL, {
    select: "iu_ac,geo_point_2d",
  });
  const inBbox = refs.filter(
    (r) =>
      r.geo_point_2d &&
      r.geo_point_2d.lat >= PARIS_BBOX.latMin &&
      r.geo_point_2d.lat <= PARIS_BBOX.latMax &&
      r.geo_point_2d.lon >= PARIS_BBOX.lonMin &&
      r.geo_point_2d.lon <= PARIS_BBOX.lonMax,
  );
  console.log(`  ${refs.length} counters total, ${inBbox.length} inside Paris bbox`);
  // De-dupe by iu_ac (a counter can have multiple entries across history)
  const byId = new Map<string, CounterRef>();
  for (const r of inBbox) {
    if (!byId.has(r.iu_ac)) byId.set(r.iu_ac, r);
  }
  console.log(`  ${byId.size} distinct counter IDs`);
  return [...byId.values()];
}

async function fetchAadt(): Promise<CounterAadt[]> {
  console.log("Fetching counter AADT aggregates...");
  // Get the data range first, then aggregate over the most recent 365 days.
  const rangeRes = await fetch(
    `${FLOW_URL}?limit=1&select=MIN(t_1h)%20as%20mn,MAX(t_1h)%20as%20mx`,
  );
  const range = (await rangeRes.json()) as { results: Array<{ mn: string; mx: string }> };
  const mx = new Date(range.results[0]!.mx);
  const mn = new Date(range.results[0]!.mn);
  const oneYearBack = new Date(mx.getTime() - 365 * 24 * 60 * 60 * 1000);
  const startDate = oneYearBack > mn ? oneYearBack : mn;
  const startISO = startDate.toISOString();
  const endISO = mx.toISOString();
  const daysCovered = (mx.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);
  console.log(`  window: ${startISO.slice(0, 10)} → ${endISO.slice(0, 10)} (${daysCovered.toFixed(0)} days)`);

  const where = `t_1h>='${startISO}' AND t_1h<='${endISO}'`;
  const aggs = await fetchAllPaged<{ iu_ac: string; s: number; n: number }>(
    FLOW_URL,
    {
      select: "iu_ac,SUM(q) as s,COUNT(*) as n",
      where,
      group_by: "iu_ac",
    },
  );
  const out: CounterAadt[] = aggs
    .filter((a) => a.iu_ac && a.iu_ac !== "*" && a.s > 0 && a.n > 0)
    .map((a) => ({
      iu_ac: a.iu_ac,
      // AADT = annual veh-hours / days_covered. Each hour-record sums q over that hour.
      // s is sum of hourly q over the window, n is the # of hours observed.
      // AADT estimate = (s / n) * 24 (= avg hourly × 24)
      aadt: Math.round((a.s / a.n) * 24),
      hourCount: a.n,
    }));
  console.log(`  ${out.length} counters with non-zero data in window`);
  return out;
}

function loadSignals(slug: string): Array<[number, number, number]> {
  const sigPath = path.resolve(DATA_DIR, `${slug}-signals.json`);
  if (!existsSync(sigPath)) throw new Error(`missing ${sigPath}`);
  const data = JSON.parse(readFileSync(sigPath, "utf8")) as Array<[number, number, number, string | null, number]>;
  return data.map(([id, lat, lon]) => [id, lat, lon]);
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mLon;
  const dy = (lat2 - lat1) * mLat;
  return Math.sqrt(dx * dx + dy * dy);
}

function loadExistingAadt(slug: string): Record<string, { aadt: number; year: number; kFactor: number; distM: number; source: string }> {
  const p = path.resolve(DATA_DIR, `${slug}-aadt.json`);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function snapToSignals(
  counters: Array<CounterRef & { aadt: number }>,
  signals: Array<[number, number, number]>,
): Record<string, { aadt: number; year: number; kFactor: number; distM: number; source: string }> {
  // For each signal, find nearest counter within SNAP_RADIUS_M.
  // Multiple signals can share the same counter — that's fine; signalized
  // intersections close together typically experience similar through traffic.
  const out: Record<string, { aadt: number; year: number; kFactor: number; distM: number; source: string }> = {};
  let snapped = 0;
  for (const [osmId, sLat, sLon] of signals) {
    let best: { c: typeof counters[number]; d: number } | null = null;
    for (const c of counters) {
      const d = distanceMeters(sLat, sLon, c.geo_point_2d.lat, c.geo_point_2d.lon);
      if (d > SNAP_RADIUS_M) continue;
      if (best === null || d < best.d) best = { c, d };
    }
    if (best) {
      out[String(osmId)] = {
        aadt: best.c.aadt,
        year: new Date().getUTCFullYear(),
        kFactor: 9,
        distM: Math.round(best.d),
        source: "paris_opendata",
      };
      snapped++;
    }
  }
  console.log(`  snapped ${snapped} / ${signals.length} signals (${(snapped / signals.length * 100).toFixed(1)}%)`);
  return out;
}

async function main(): Promise<void> {
  const slug = "paris";
  const refs = await fetchRef();
  const aadts = await fetchAadt();
  const aadtById = new Map(aadts.map((a) => [a.iu_ac, a.aadt]));

  const counters: Array<CounterRef & { aadt: number }> = [];
  for (const r of refs) {
    const aadt = aadtById.get(r.iu_ac);
    if (aadt == null) continue;
    counters.push({ ...r, aadt });
  }
  console.log(`Counters with both geometry + AADT: ${counters.length}`);

  const signals = loadSignals(slug);
  const measured = snapToSignals(counters, signals);

  // Merge: keep synthetic for unsnapped signals, overwrite with measured.
  const existing = loadExistingAadt(slug);
  const merged: typeof measured = { ...existing };
  for (const [id, rec] of Object.entries(measured)) merged[id] = rec;

  const outPath = path.resolve(DATA_DIR, `${slug}-aadt.json`);
  writeFileSync(outPath, JSON.stringify(merged));
  console.log(`Wrote ${outPath}: ${Object.keys(merged).length} total signals (measured: ${Object.keys(measured).length}, synthetic kept: ${Object.keys(merged).length - Object.keys(measured).length})`);

  // Update metro-coverage.ts: aadtPct = % measured / total signals
  const measuredPct = Math.round((Object.keys(measured).length / signals.length) * 1000) / 10;
  let coverage = readFileSync(COVERAGE_PATH, "utf8");
  const pattern = /(\{ code: "paris_metro",[^}]*?)aadtPct:\s*[0-9.]+,([^}]*?)aadtSource:\s*"[^"]*",\s*aadtQuality:\s*"[^"]*",/;
  if (pattern.test(coverage)) {
    coverage = coverage.replace(pattern, `$1aadtPct: ${measuredPct},$2aadtSource: "Paris Open Data — capteurs permanents (annual hourly aggregate)", aadtQuality: "measured",`);
    writeFileSync(COVERAGE_PATH, coverage);
    console.log(`Updated paris_metro: aadtPct=${measuredPct}% (measured)`);
  } else {
    console.log(`! pattern miss — metro-coverage.ts not updated, edit manually`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
