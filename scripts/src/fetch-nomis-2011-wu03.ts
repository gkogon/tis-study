/**
 * ONS 2011 Census WU03EW → Greater-London MSOA origin-destination asset.
 *
 * WU03EW ("Location of usual residence and place of work by method of travel to
 * work", MSOA level) is the genuine UK trip-distribution spine: for every
 * residence MSOA it gives the commuter counts to every workplace MSOA, split by
 * method of travel. A UK Transport Assessment distributes development trips using
 * exactly this Census journey-to-work catchment (agreed in the scoping note),
 * rather than the US NCHRP/ITE screening patterns.
 *
 * 2011, not 2021: the 2021 Census was taken mid-COVID lockdown; ONS flags the
 * 2021 travel-to-work tables as not comparable to prior censuses. 2011 is the
 * planner's stable pre-COVID baseline — the same rationale as the existing
 * london-census-mtw-2011 asset.
 *
 * Datasets (pinned, verified live 2026-07-07):
 *   • nomis NM_1208_1 (WU03EW), dims usual_residence / place_of_work /
 *     transport_powpew11 / measures=20100. Greater-London submatrix selected via
 *     place_of_work=E12000007TYPE297 (all MSOAs in the London region).
 *   • ONS Open Geography Portal FeatureServer
 *     MSOA_Dec_2011_PWC_in_England_and_Wales_2022 — 2011 population-weighted
 *     centroids (reprojected to WGS84 via outSR=4326).
 *
 * Licence: ONS Crown Copyright / Open Government Licence v3.0 (free, attribution).
 *
 * Output (committed, lazy-loaded by greater-london-msoa-od.ts):
 *   artifacts/tis-api-server/data/greater-london-msoa-od-2011.json
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-nomis-2011-wu03.ts
 * Idempotent; re-runs overwrite the asset.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const OUT_DIR = resolve(REPO_ROOT, "artifacts/tis-api-server/data");
const OUT_FILE = resolve(OUT_DIR, "greater-london-msoa-od-2011.json");

const NM = "NM_1208_1"; // WU03EW (MSOA level)
const LONDON = "E12000007"; // London region GSS
const MSOA_TYPE = "TYPE297"; // 2011 MSOA geography type in nomis
const LONDON_MSOAS = `${LONDON}${MSOA_TYPE}`;
const PWC =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/ArcGIS/rest/services/MSOA_Dec_2011_PWC_in_England_and_Wales_2022/FeatureServer/0/query";

// transport_powpew11 cell codes (2001 spec order, same as fetch-nomis-2011-mtw).
const MODE_ALL = 0;
const MODE_CAR_DRIVER = 7;
const MODE_CAR_PASSENGER = 8;

// Keep at most this many destination MSOAs per origin. The long tail of tiny
// flows does not change the directional distribution materially and keeps the
// asset lean. 80 captures the full catchment shape for every London MSOA.
const TOP_K_DEST = 80;
const CONCURRENCY = 6;

type Roster = { code: string; name: string }[];

async function getJson(url: string, tries = 4): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

/** London MSOA roster (code + name), harvested from the OD destination list. */
async function fetchRoster(): Promise<Roster> {
  // Any single London origin returns a row for every London workplace MSOA.
  const url =
    `https://www.nomisweb.co.uk/api/v01/dataset/${NM}.data.json` +
    `?usual_residence=E02000001&place_of_work=${LONDON_MSOAS}` +
    `&transport_powpew11=${MODE_ALL}&measures=20100` +
    `&select=place_of_work_code,place_of_work_name,obs_value`;
  const d = await getJson(url);
  const obs: any[] = d?.obs ?? [];
  const seen = new Set<string>();
  const roster: Roster = [];
  for (const o of obs) {
    const code = o.place_of_work.value as string;
    if (seen.has(code)) continue;
    seen.add(code);
    roster.push({ code, name: o.place_of_work.description as string });
  }
  return roster;
}

/** MSOA 2011 population-weighted centroids (WGS84) for the London roster. */
async function fetchCentroids(codes: Set<string>): Promise<Map<string, { lat: number; lon: number }>> {
  const out = new Map<string, { lat: number; lon: number }>();
  let offset = 0;
  const PAGE = 2000;
  // Page through all E&W PWC and keep the London subset (robust; the layer has
  // no region attribute to filter on server-side).
  for (;;) {
    const url =
      `${PWC}?where=1%3D1&outFields=msoa11cd&returnGeometry=true&outSR=4326&f=json` +
      `&resultOffset=${offset}&resultRecordCount=${PAGE}`;
    const d = await getJson(url);
    const feats: any[] = d?.features ?? [];
    if (feats.length === 0) break;
    for (const f of feats) {
      const code = f.attributes?.msoa11cd as string;
      if (code && codes.has(code) && f.geometry) {
        out.set(code, { lat: f.geometry.y, lon: f.geometry.x });
      }
    }
    if (feats.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

type OriginFlows = { origin: string; residentWorkers: number; dest: Map<string, { all: number; car: number }> };

/** Per-origin OD flows to all London workplace MSOAs (all-mode + car). */
async function fetchOrigin(origin: string): Promise<OriginFlows> {
  const url =
    `https://www.nomisweb.co.uk/api/v01/dataset/${NM}.data.json` +
    `?usual_residence=${origin}&place_of_work=${LONDON_MSOAS}` +
    `&transport_powpew11=${MODE_ALL},${MODE_CAR_DRIVER},${MODE_CAR_PASSENGER}` +
    `&measures=20100&select=place_of_work_code,transport_powpew11_code,obs_value`;
  const d = await getJson(url);
  const obs: any[] = d?.obs ?? [];
  const dest = new Map<string, { all: number; car: number }>();
  let residentWorkers = 0;
  for (const o of obs) {
    const dcode = o.place_of_work.value as string;
    const mode = Number(o.transport_powpew11.value);
    // nomis returns obs_value as a nested { value, description } object.
    const v = Number(o.obs_value?.value ?? o.obs_value) || 0;
    if (v <= 0) continue;
    let rec = dest.get(dcode);
    if (!rec) {
      rec = { all: 0, car: 0 };
      dest.set(dcode, rec);
    }
    if (mode === MODE_ALL) {
      rec.all += v;
      residentWorkers += v;
    } else {
      rec.car += v; // driver + passenger
    }
  }
  return { origin, residentWorkers, dest };
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
      if (i % 100 === 0) process.stderr.write(`  …${i}/${items.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

async function main() {
  process.stderr.write("WU03EW → Greater-London MSOA OD asset\n");
  process.stderr.write("1/4 roster…\n");
  const roster = await fetchRoster();
  const codes = new Set(roster.map((r) => r.code));
  process.stderr.write(`   ${roster.length} London MSOAs\n`);

  process.stderr.write("2/4 centroids…\n");
  const centroids = await fetchCentroids(codes);
  process.stderr.write(`   ${centroids.size}/${roster.length} centroids matched\n`);

  process.stderr.write(`3/4 OD flows (${roster.length} origins, ${CONCURRENCY}-way)…\n`);
  const flows = await pool(roster.map((r) => r.code), CONCURRENCY, fetchOrigin);

  // Workplace-employment mass = column sum of all-mode inflow across origins.
  const workplaceTotal = new Map<string, number>();
  for (const f of flows) {
    for (const [dcode, rec] of f.dest) {
      workplaceTotal.set(dcode, (workplaceTotal.get(dcode) ?? 0) + rec.all);
    }
  }

  process.stderr.write("4/4 assemble + write…\n");
  // Zones: index-stable array; flows reference zones by index for compactness.
  const zoneIndex = new Map<string, number>();
  const zones = roster
    .filter((r) => centroids.has(r.code))
    .map((r, i) => {
      zoneIndex.set(r.code, i);
      const c = centroids.get(r.code)!;
      return {
        msoa: r.code,
        name: r.name,
        lat: Math.round(c.lat * 1e5) / 1e5,
        lon: Math.round(c.lon * 1e5) / 1e5,
        workplaceTotal: Math.round(workplaceTotal.get(r.code) ?? 0),
      };
    });

  // OUTBOUND — flows[originMsoa] = [[destZoneIdx, allTrips, carTrips], …] top-K by
  // all-mode. This is the commute direction for a RESIDENTIAL site (residents of
  // the site MSOA travelling to their workplaces).
  const flowsOut: Record<string, [number, number, number][]> = {};
  const residentWorkers: Record<string, number> = {};
  // INBOUND — inflows[workplaceMsoa] = [[originZoneIdx, allTrips, carTrips], …]
  // top-K by all-mode. This is the commute direction for an EMPLOYMENT site
  // (office/retail: workers arriving FROM their home MSOAs). Built from the same
  // per-origin data already fetched — no extra API calls.
  const inbound = new Map<string, { o: string; all: number; car: number }[]>();
  for (const f of flows) {
    if (!zoneIndex.has(f.origin)) continue;
    residentWorkers[f.origin] = Math.round(f.residentWorkers);
    const rows: [number, number, number][] = [];
    for (const [dcode, rec] of f.dest) {
      const di = zoneIndex.get(dcode);
      if (di === undefined) continue;
      rows.push([di, Math.round(rec.all), Math.round(rec.car)]);
      if (!inbound.has(dcode)) inbound.set(dcode, []);
      inbound.get(dcode)!.push({ o: f.origin, all: rec.all, car: rec.car });
    }
    rows.sort((a, b) => b[1] - a[1]);
    flowsOut[f.origin] = rows.slice(0, TOP_K_DEST);
  }
  const inflowsOut: Record<string, [number, number, number][]> = {};
  for (const [dcode, arr] of inbound) {
    const di = zoneIndex.get(dcode);
    if (di === undefined) continue;
    arr.sort((a, b) => b.all - a.all);
    inflowsOut[dcode] = arr
      .slice(0, TOP_K_DEST)
      .map((x): [number, number, number] | null => {
        const oi = zoneIndex.get(x.o);
        return oi === undefined ? null : [oi, Math.round(x.all), Math.round(x.car)];
      })
      .filter((r): r is [number, number, number] => r !== null);
  }

  const asset = {
    source:
      "ONS 2011 Census WU03EW (nomis NM_1208_1), MSOA-level origin-destination by method of travel; Greater London (E12000007)",
    licence: "Open Government Licence v3.0 — © Crown copyright 2011 (ONS)",
    datasetId: NM,
    table: "WU03EW",
    region: LONDON,
    year: 2011,
    fetchedAt: new Date().toISOString().slice(0, 10),
    modes: { all: MODE_ALL, carDriver: MODE_CAR_DRIVER, carPassenger: MODE_CAR_PASSENGER },
    topKDest: TOP_K_DEST,
    note:
      "flows[originMsoa] (OUTBOUND, residential sites) + inflows[workplaceMsoa] (INBOUND, employment sites) = " +
      "[[zoneIdx, allModeTrips, carTrips], …] top-80 by all-mode volume. " +
      "zone.workplaceTotal = all-mode commuters working in that MSOA (column sum). Car = driver + passenger.",
    zones,
    residentWorkers,
    flows: flowsOut,
    inflows: inflowsOut,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(asset));
  const kb = Math.round(Buffer.byteLength(JSON.stringify(asset)) / 1024);
  process.stderr.write(`✓ wrote ${OUT_FILE} (${zones.length} zones, ${kb} KB)\n`);
}

main().catch((e) => {
  process.stderr.write(`FAILED: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
