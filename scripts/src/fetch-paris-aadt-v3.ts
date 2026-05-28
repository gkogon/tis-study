/**
 * Paris AADT v3 — calibrate snap radius experimentally + weighted-avg
 * across multiple nearby counters.
 *
 * v1 used 100m strict-nearest snap → 25.6% measured. v3:
 *
 *   1. Test snap radii 80 / 120 / 150 / 200 / 250m and report
 *      coverage at each level (no writes — just discovery).
 *   2. At the chosen radius (150m by default), use inverse-distance
 *      weighted average across all counters within range, not just
 *      the nearest. This averages out per-counter noise and produces
 *      a more stable AADT for signals at intersection clusters.
 *   3. Re-write paris-aadt.json with the upgraded entries plus the
 *      existing synthetic fallback for unsnapped signals.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-paris-aadt-v3.ts
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

const PARIS_BBOX = { latMin: 48.78, latMax: 48.95, lonMin: 2.20, lonMax: 2.50 };

const REF_URL =
  "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/referentiel-comptages-routiers/records";
const FLOW_URL =
  "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/comptages-routiers-permanents/records";

type CounterRef = { iu_ac: string; geo_point_2d: { lat: number; lon: number } };
type CounterAadt = { iu_ac: string; aadt: number; hourCount: number };

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
    if (offset > 50_000) break;
  }
  return out;
}

async function fetchActiveCounters(): Promise<Array<CounterRef & { aadt: number }>> {
  console.log("Fetching counter referential...");
  const refs = await fetchAllPaged<CounterRef>(REF_URL, { select: "iu_ac,geo_point_2d" });
  const inBbox = refs.filter(
    (r) =>
      r.geo_point_2d &&
      r.geo_point_2d.lat >= PARIS_BBOX.latMin &&
      r.geo_point_2d.lat <= PARIS_BBOX.latMax &&
      r.geo_point_2d.lon >= PARIS_BBOX.lonMin &&
      r.geo_point_2d.lon <= PARIS_BBOX.lonMax,
  );
  const byId = new Map<string, CounterRef>();
  for (const r of inBbox) if (!byId.has(r.iu_ac)) byId.set(r.iu_ac, r);
  console.log(`  ${byId.size} distinct counter IDs in Paris bbox`);

  console.log("Fetching counter AADT aggregates...");
  const rangeRes = await fetch(`${FLOW_URL}?limit=1&select=MIN(t_1h)%20as%20mn,MAX(t_1h)%20as%20mx`);
  const range = (await rangeRes.json()) as { results: Array<{ mn: string; mx: string }> };
  const mx = new Date(range.results[0]!.mx);
  const mn = new Date(range.results[0]!.mn);
  const oneYearBack = new Date(mx.getTime() - 365 * 24 * 60 * 60 * 1000);
  const startDate = oneYearBack > mn ? oneYearBack : mn;
  const where = `t_1h>='${startDate.toISOString()}' AND t_1h<='${mx.toISOString()}'`;
  const aggs = await fetchAllPaged<{ iu_ac: string; s: number; n: number }>(FLOW_URL, {
    select: "iu_ac,SUM(q) as s,COUNT(*) as n",
    where,
    group_by: "iu_ac",
  });

  const aadtById = new Map<string, number>();
  for (const a of aggs) {
    if (!a.iu_ac || a.iu_ac === "*" || a.s <= 0 || a.n <= 0) continue;
    aadtById.set(a.iu_ac, Math.round((a.s / a.n) * 24));
  }
  console.log(`  ${aadtById.size} counters with non-zero data`);

  const out: Array<CounterRef & { aadt: number }> = [];
  for (const r of byId.values()) {
    const a = aadtById.get(r.iu_ac);
    if (a == null) continue;
    out.push({ ...r, aadt: a });
  }
  console.log(`  ${out.length} counters with both geometry + AADT`);
  return out;
}

function distMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mLon;
  const dy = (lat2 - lat1) * mLat;
  return Math.sqrt(dx * dx + dy * dy);
}

function snapAtRadius(
  counters: Array<CounterRef & { aadt: number }>,
  signals: Array<[number, number, number]>,
  radius: number,
  weighted = true,
): Record<string, { aadt: number; year: number; kFactor: number; distM: number; source: string }> {
  const out: Record<string, { aadt: number; year: number; kFactor: number; distM: number; source: string }> = {};
  for (const [osmId, sLat, sLon] of signals) {
    const within: Array<{ aadt: number; d: number }> = [];
    for (const c of counters) {
      const d = distMeters(sLat, sLon, c.geo_point_2d.lat, c.geo_point_2d.lon);
      if (d <= radius) within.push({ aadt: c.aadt, d });
    }
    if (within.length === 0) continue;
    let aadt: number;
    let bestD: number;
    if (!weighted || within.length === 1) {
      within.sort((a, b) => a.d - b.d);
      aadt = within[0]!.aadt;
      bestD = within[0]!.d;
    } else {
      // Inverse-distance squared weighting; floor distance at 5m to avoid division blowups
      let wSum = 0;
      let weightTotal = 0;
      for (const w of within) {
        const eff = Math.max(w.d, 5);
        const wt = 1 / (eff * eff);
        wSum += w.aadt * wt;
        weightTotal += wt;
      }
      aadt = Math.round(wSum / weightTotal);
      within.sort((a, b) => a.d - b.d);
      bestD = within[0]!.d;
    }
    out[String(osmId)] = {
      aadt,
      year: new Date().getUTCFullYear(),
      kFactor: 9,
      distM: Math.round(bestD),
      source: "paris_opendata",
    };
  }
  return out;
}

async function main(): Promise<void> {
  const slug = "paris";
  const signals = (JSON.parse(readFileSync(path.resolve(DATA_DIR, `${slug}-signals.json`), "utf8")) as Array<
    [number, number, number, string | null, number]
  >).map(([id, lat, lon]) => [id, lat, lon] as [number, number, number]);

  const counters = await fetchActiveCounters();

  console.log("\n=== Radius sweep (nearest-only) ===");
  for (const r of [80, 100, 120, 150, 200, 250]) {
    const m = snapAtRadius(counters, signals, r, false);
    const pct = ((Object.keys(m).length / signals.length) * 100).toFixed(1);
    console.log(`  r=${r}m  → ${Object.keys(m).length} / ${signals.length} = ${pct}%`);
  }

  console.log("\n=== Writing final at r=150m, inverse-distance weighted ===");
  const measured = snapAtRadius(counters, signals, 150, true);
  const measuredPct = Math.round((Object.keys(measured).length / signals.length) * 1000) / 10;

  // Merge: keep synthetic for unsnapped signals
  const existing = JSON.parse(readFileSync(path.resolve(DATA_DIR, `${slug}-aadt.json`), "utf8"));
  const syntheticOnly: typeof measured = {};
  for (const [k, v] of Object.entries(existing as typeof measured)) {
    if ((v as { source: string }).source === "synthetic_osm_class") syntheticOnly[k] = v as typeof measured[string];
  }
  const merged: typeof measured = { ...syntheticOnly, ...measured };

  const outPath = path.resolve(DATA_DIR, `${slug}-aadt.json`);
  writeFileSync(outPath, JSON.stringify(merged));
  console.log(`paris-aadt.json: ${Object.keys(merged).length} total (measured: ${Object.keys(measured).length}, synthetic kept: ${Object.keys(merged).length - Object.keys(measured).length})`);
  console.log(`measuredPct: ${measuredPct}%`);

  let coverage = readFileSync(COVERAGE_PATH, "utf8");
  const pattern = /(\{ code: "paris_metro",[^}]*?)aadtPct:\s*[0-9.]+,([^}]*?)aadtSource:\s*"[^"]*",/;
  if (pattern.test(coverage)) {
    coverage = coverage.replace(
      pattern,
      `$1aadtPct: ${measuredPct},$2aadtSource: "Paris Open Data — capteurs permanents (IDW @ 150m, ${counters.length} active counters)",`,
    );
    writeFileSync(COVERAGE_PATH, coverage);
    console.log(`Updated paris_metro: aadtPct=${measuredPct}%`);
  } else {
    console.log("! pattern miss");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
