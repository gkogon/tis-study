/**
 * build-national-taz.ts — build the national block-group "TAZ" layer.
 *
 * Produces one committed data asset covering every Census block group in the
 * United States (~240k zones), each carrying the socioeconomic attributes a
 * Traffic Analysis Zone needs: a population-weighted centroid plus the four
 * activity magnitudes used by the directional-distribution engine —
 *
 *   living    = resident population            (Census Centers of Population)
 *   shopping  = retail + accommodation/food jobs (LODES WAC CNS07 + CNS18)
 *   commerce  = office-type jobs                (LODES WAC CNS09–CNS14)
 *   working   = all other jobs (total − above) (LODES WAC C000 − shopping − commerce)
 *
 * Sources (public, free):
 *   1. Census 2020 Centers of Population, block-group national file — one
 *      ~10 MB download giving GEOID + population-weighted centroid + population.
 *   2. LEHD LODES8 Workplace Area Characteristics (WAC), per state — jobs by
 *      2-digit NAICS sector at the workplace block, aggregated to block group.
 *
 * Output: artifacts/tis-api-server/data/national-block-group-taz.json
 *   { meta: {...}, rows: [ [geoid, lat, lon, pop, jShop, jComm, jWork], ... ] }
 * plus a sibling .meta.json summary.
 *
 * Resumable: downloaded LODES files and per-state aggregates are cached under
 * a work dir; reruns skip completed states. Run from the repo root:
 *   npx esbuild scripts/src/build-national-taz.ts --bundle --platform=node \
 *       --format=esm --outfile=/tmp/build-taz.mjs && node /tmp/build-taz.mjs
 */

import {
  createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import * as path from "node:path";

const UA = "tis-study/1.0 (national TAZ builder; rossk@pullapart.com)";
const WORK = process.env["TAZ_WORK"] ?? "/tmp/taz-build";
const OUT = path.resolve(
  process.env["TAZ_OUT"] ?? "artifacts/tis-api-server/data/national-block-group-taz.json",
);
const CENPOP_URL =
  "https://www2.census.gov/geo/docs/reference/cenpop2020/blkgrp/CenPop2020_Mean_BG.txt";
const LODES_YEARS = [2022, 2021, 2020];

// FIPS → USPS for the 50 states + DC (LODES uses lowercase USPS in the path).
const STATES: Array<[string, string]> = [
  ["01","al"],["02","ak"],["04","az"],["05","ar"],["06","ca"],["08","co"],
  ["09","ct"],["10","de"],["11","dc"],["12","fl"],["13","ga"],["15","hi"],
  ["16","id"],["17","il"],["18","in"],["19","ia"],["20","ks"],["21","ky"],
  ["22","la"],["23","me"],["24","md"],["25","ma"],["26","mi"],["27","mn"],
  ["28","ms"],["29","mo"],["30","mt"],["31","ne"],["32","nv"],["33","nh"],
  ["34","nj"],["35","nm"],["36","ny"],["37","nc"],["38","nd"],["39","oh"],
  ["40","ok"],["41","or"],["42","pa"],["44","ri"],["45","sc"],["46","sd"],
  ["47","tn"],["48","tx"],["49","ut"],["50","vt"],["51","va"],["53","wa"],
  ["54","wv"],["55","wi"],["56","wy"],
];

type BgJobs = { jShop: number; jComm: number; jWork: number };

function log(msg: string) {
  // eslint-disable-next-line no-console
  console.log(`[taz] ${msg}`);
}

async function download(url: string, dest: string): Promise<boolean> {
  if (existsSync(dest)) return true;
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) return false;
  const buf = Buffer.from(await resp.arrayBuffer());
  writeFileSync(dest, buf);
  return true;
}

/** Parse the national block-group Centers of Population file → centroid+pop. */
async function loadCentroids(): Promise<Map<string, { lat: number; lon: number; pop: number }>> {
  const dest = path.join(WORK, "CenPop2020_Mean_BG.txt");
  if (!(await download(CENPOP_URL, dest))) throw new Error("Centers of Population download failed");
  const out = new Map<string, { lat: number; lon: number; pop: number }>();
  const rl = createInterface({ input: createReadStream(dest), crlfDelay: Infinity });
  let header = true;
  for await (const lineRaw of rl) {
    const line = lineRaw.replace(/^﻿/, "");
    if (header) { header = false; continue; }
    if (!line) continue;
    // STATEFP,COUNTYFP,TRACTCE,BLKGRPCE,POPULATION,LATITUDE,LONGITUDE
    const c = line.split(",");
    if (c.length < 7) continue;
    const geoid = c[0]! + c[1]! + c[2]! + c[3]!;
    const pop = Number(c[4]);
    const lat = Number(c[5]);
    const lon = Number(c[6]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.set(geoid, { lat, lon, pop: Number.isFinite(pop) ? pop : 0 });
  }
  return out;
}

/** Download + aggregate one state's LODES WAC to block-group job buckets. */
async function loadStateJobs(fips: string, usps: string): Promise<Map<string, BgJobs> | null> {
  const cache = path.join(WORK, `wac_${usps}.json`);
  if (existsSync(cache)) {
    return new Map(Object.entries(JSON.parse(readFileSync(cache, "utf8"))));
  }
  let gz: string | null = null;
  for (const year of LODES_YEARS) {
    const url = `https://lehd.ces.census.gov/data/lodes/LODES8/${usps}/wac/${usps}_wac_S000_JT00_${year}.csv.gz`;
    const dest = path.join(WORK, `${usps}_wac_${year}.csv.gz`);
    if (await download(url, dest)) { gz = dest; break; }
  }
  if (!gz) return null;

  const agg = new Map<string, BgJobs>();
  const rl = createInterface({ input: createReadStream(gz).pipe(createGunzip()), crlfDelay: Infinity });
  let idx: Record<string, number> | null = null;
  // Sectors → our buckets.
  const SHOP = ["CNS07", "CNS18"];                                  // retail + accommodation/food
  const COMM = ["CNS09", "CNS10", "CNS11", "CNS12", "CNS13", "CNS14"]; // info/finance/realestate/prof/mgmt/admin
  for await (const line of rl) {
    if (!line) continue;
    const cols = line.split(",");
    if (!idx) {
      idx = {};
      for (let i = 0; i < cols.length; i++) idx[cols[i]!.trim()] = i;
      continue;
    }
    const w = cols[idx["w_geocode"]!];
    if (!w) continue;
    const bg = w.slice(0, 12);
    const total = Number(cols[idx["C000"]!]) || 0;
    let shop = 0; for (const s of SHOP) shop += Number(cols[idx[s]!]) || 0;
    let comm = 0; for (const s of COMM) comm += Number(cols[idx[s]!]) || 0;
    const work = Math.max(0, total - shop - comm);
    let e = agg.get(bg);
    if (!e) { e = { jShop: 0, jComm: 0, jWork: 0 }; agg.set(bg, e); }
    e.jShop += shop; e.jComm += comm; e.jWork += work;
  }
  writeFileSync(cache, JSON.stringify(Object.fromEntries(agg)));
  return agg;
}

async function main() {
  mkdirSync(WORK, { recursive: true });
  log(`work dir ${WORK}`);
  log("loading block-group centroids…");
  const centroids = await loadCentroids();
  log(`centroids: ${centroids.size.toLocaleString()} block groups`);

  // Aggregate all jobs into one map keyed by BG geoid.
  const jobs = new Map<string, BgJobs>();
  let statesDone = 0, statesSkipped = 0;
  for (const [fips, usps] of STATES) {
    const m = await loadStateJobs(fips, usps);
    if (!m) { statesSkipped++; log(`  ${usps.toUpperCase()} (${fips}) — no LODES, skipped`); continue; }
    for (const [bg, e] of m) jobs.set(bg, e);
    statesDone++;
    log(`  ${usps.toUpperCase()} (${fips}) — ${m.size.toLocaleString()} block groups with jobs  [${statesDone}/${STATES.length}]`);
  }

  // Join centroids + jobs into the output rows.
  const rows: Array<[string, number, number, number, number, number, number]> = [];
  let withJobs = 0;
  for (const [geoid, c] of centroids) {
    const j = jobs.get(geoid);
    if (j) withJobs++;
    rows.push([
      geoid,
      Math.round(c.lat * 1e5) / 1e5,
      Math.round(c.lon * 1e5) / 1e5,
      Math.round(c.pop),
      Math.round(j?.jShop ?? 0),
      Math.round(j?.jComm ?? 0),
      Math.round(j?.jWork ?? 0),
    ]);
  }
  rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const meta = {
    generated: new Date().toISOString(),
    source: "Census 2020 Centers of Population (block group) + LEHD LODES8 WAC (S000 JT00)",
    schema: ["geoid", "lat", "lon", "population", "jobsShopping", "jobsCommerce", "jobsWorking"],
    blockGroups: rows.length,
    blockGroupsWithJobs: withJobs,
    statesWithJobs: statesDone,
    statesSkipped,
    lodesYearsTried: LODES_YEARS,
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ meta, rows }));
  writeFileSync(OUT.replace(/\.json$/, ".meta.json"), JSON.stringify(meta, null, 2));
  log(`WROTE ${OUT}`);
  log(`block groups: ${rows.length.toLocaleString()}  with jobs: ${withJobs.toLocaleString()}  states: ${statesDone}  skipped: ${statesSkipped}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
