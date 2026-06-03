/**
 * Bordeaux AADT — measured overlay from Bordeaux Métropole Open Data.
 *
 * Source: opendata.bordeaux-metropole.fr (Opendatasoft). Two datasets joined
 * on the sensor id `ident` (e.g. "Z11CT10"):
 *   - `comptage_trafic_2022` — per-sensor `mjo_val` (moyenne journalière,
 *     veh/day ≈ AADT); NO geometry.
 *   - `pc_capte_p` — per-sensor `geo_point_2d` {lat,lon}; the locations.
 * Join ident → (geo, mjo_val), then IDW-snap to signals at 150m, merge over
 * synthetic, rewrite metro-coverage.ts. Mirrors fetch-paris-aadt-v3.ts.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-bordeaux-aadt.ts
 */

import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

const SLUG = "bordeaux";
const BBOX = { latMin: 44.78, latMax: 44.93, lonMin: -0.66, lonMax: -0.51 };
const BASE = "https://opendata.bordeaux-metropole.fr/api/explore/v2.1/catalog/datasets";
const VOL_URL = `${BASE}/comptage_trafic_2022/records`;
const LOC_URL = `${BASE}/pc_capte_p/records`;

type AnyRec = Record<string, unknown>;

async function fetchAllPaged(url: string, params: Record<string, string>, pageSize = 100): Promise<AnyRec[]> {
  const out: AnyRec[] = [];
  let offset = 0;
  for (;;) {
    const qs = new URLSearchParams({ ...params, limit: String(pageSize), offset: String(offset) });
    const res = await fetch(`${url}?${qs.toString()}`);
    if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
    const json = (await res.json()) as { total_count: number; results: AnyRec[] };
    out.push(...json.results);
    if (json.results.length < pageSize) break;
    offset += pageSize;
    if (offset > 50_000) break;
  }
  return out;
}

function distMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const mLat = 111_320;
  const mLon = 111_320 * Math.cos((lat1 * Math.PI) / 180);
  const dx = (lon2 - lon1) * mLon;
  const dy = (lat2 - lat1) * mLat;
  return Math.sqrt(dx * dx + dy * dy);
}

type Counter = { lat: number; lon: number; aadt: number };

function snapAtRadius(
  counters: Counter[],
  signals: Array<[number, number, number]>,
  radius: number,
  weighted = true,
): Record<string, { aadt: number; year: number; kFactor: number; distM: number; source: string }> {
  const out: Record<string, { aadt: number; year: number; kFactor: number; distM: number; source: string }> = {};
  for (const [osmId, sLat, sLon] of signals) {
    const within: Array<{ aadt: number; d: number }> = [];
    for (const c of counters) {
      const d = distMeters(sLat, sLon, c.lat, c.lon);
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
    out[String(osmId)] = { aadt, year: new Date().getUTCFullYear(), kFactor: 9, distM: Math.round(bestD), source: "bordeaux_opendata" };
  }
  return out;
}

async function main(): Promise<void> {
  console.log("Fetching Bordeaux comptage_trafic_2022 (mjo_val) ...");
  const vols = await fetchAllPaged(VOL_URL, { select: "ident,mjo_val" });
  const volById = new Map<string, number>();
  for (const r of vols) {
    const ident = r.ident == null ? null : String(r.ident);
    const v = typeof r.mjo_val === "number" ? r.mjo_val : Number(r.mjo_val);
    if (!ident || !Number.isFinite(v) || v <= 0) continue;
    volById.set(ident, Math.round(v));
  }
  console.log(`  ${vols.length} vol records → ${volById.size} sensors with positive mjo_val`);

  console.log("Fetching Bordeaux pc_capte_p (locations) ...");
  const locs = await fetchAllPaged(LOC_URL, { select: "ident,geo_point_2d" });
  const counters: Counter[] = [];
  let joined = 0;
  for (const r of locs) {
    const ident = r.ident == null ? null : String(r.ident);
    const g = r.geo_point_2d as { lat: number; lon: number } | null | undefined;
    if (!ident || !g) continue;
    if (g.lat < BBOX.latMin || g.lat > BBOX.latMax || g.lon < BBOX.lonMin || g.lon > BBOX.lonMax) continue;
    const aadt = volById.get(ident);
    if (aadt == null) continue;
    counters.push({ lat: g.lat, lon: g.lon, aadt });
    joined++;
  }
  console.log(`  ${locs.length} location records → ${joined} counters joined (geo + mjo_val) in bbox`);

  const signals = (
    JSON.parse(readFileSync(path.resolve(DATA_DIR, `${SLUG}-signals.json`), "utf8")) as Array<
      [number, number, number, string | null, number]
    >
  ).map(([id, lat, lon]) => [id, lat, lon] as [number, number, number]);

  console.log("\n=== Radius sweep (nearest-only) ===");
  for (const r of [80, 100, 120, 150, 200, 250]) {
    const m = snapAtRadius(counters, signals, r, false);
    const pct = ((Object.keys(m).length / signals.length) * 100).toFixed(1);
    console.log(`  r=${r}m  → ${Object.keys(m).length} / ${signals.length} = ${pct}%`);
  }

  console.log("\n=== Writing final at r=150m, inverse-distance weighted ===");
  const measured = snapAtRadius(counters, signals, 150, true);
  const measuredPct = Math.round((Object.keys(measured).length / signals.length) * 1000) / 10;

  const existing = JSON.parse(readFileSync(path.resolve(DATA_DIR, `${SLUG}-aadt.json`), "utf8")) as Record<
    string,
    { source: string }
  >;
  const syntheticOnly: typeof measured = {};
  for (const [k, v] of Object.entries(existing)) {
    if (v.source === "synthetic_osm_class") syntheticOnly[k] = v as (typeof measured)[string];
  }
  const merged = { ...syntheticOnly, ...measured };

  writeFileSync(path.resolve(DATA_DIR, `${SLUG}-aadt.json`), JSON.stringify(merged));
  console.log(
    `${SLUG}-aadt.json: ${Object.keys(merged).length} total (measured ${Object.keys(measured).length}, synthetic kept ${
      Object.keys(merged).length - Object.keys(measured).length
    })`,
  );
  console.log(`measuredPct: ${measuredPct}%`);

  let coverage = readFileSync(COVERAGE_PATH, "utf8");
  const pattern =
    /(\{ code: "bordeaux_metro",[^}]*?)aadtPct:\s*[0-9.]+,([^}]*?)aadtSource:\s*"[^"]*",([^}]*?)aadtQuality:\s*"[^"]*",/;
  if (pattern.test(coverage)) {
    coverage = coverage.replace(
      pattern,
      `$1aadtPct: ${measuredPct},$2aadtSource: "Bordeaux Métropole Open Data — comptages routiers (mjo, IDW @ 150m, ${counters.length} counters)",$3aadtQuality: "measured",`,
    );
    writeFileSync(COVERAGE_PATH, coverage);
    console.log(`Updated bordeaux_metro: aadtPct=${measuredPct}% quality=measured`);
  } else {
    console.log("! coverage pattern miss — update metro-coverage.ts manually");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
