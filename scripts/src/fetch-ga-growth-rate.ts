/**
 * Per-GA-metro measured background-traffic growth rate from the
 * Atlanta Regional Commission Open Data Hub re-publication of GDOT
 * AADT 2008–2017.
 *
 * Why this exists: GDOT does NOT publish a multi-year historical
 * AADT layer through their public ArcGIS REST endpoint — only
 * current-year (the GDOT_AADT service used by fetch-aadt-by-signal.ts
 * for the Atlanta region). The ARC Open Data Hub republished a
 * single feature service that carries per-station AADT for every
 * year 2008 through 2017 as separate columns, plus a stable
 * Station_ID — exactly the shape needed for per-station CAGR
 * without per-year tile fetching. Trade-off: data ends at 2017.
 * A 9-year window centered on the late-2010s captures pre-COVID
 * Atlanta-metro growth dynamics; for projects entitled in 2026+,
 * that's a more representative trend than the COVID-distorted
 * 2020–2025 window IDOT uses for IL.
 *
 * Source: ARC Open Data — GDOT Traffic Counts (AADT and Truck
 *   Percent) 2008 to 2017
 *   https://services5.arcgis.com/buITjRsK0rZsAXbQ/arcgis/rest/
 *     services/GDOT_AADT_and_TruckPct_2008to2017/FeatureServer/0
 * Each row has Station_ID + Lat + Long + AADT_2008 .. AADT_2017.
 *
 * Methodology: for each station, compute CAGR from earliest non-
 * null + non-zero AADT to the latest non-null + non-zero AADT in
 * the 2008–2017 window. Require ≥5 years between the two
 * endpoints. Drop |CAGR| > 20%/yr outliers (one of the snapshots
 * is bad). Per-metro median + IQR.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-ga-growth-rate.ts
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");

const URL_BASE =
  "https://services5.arcgis.com/buITjRsK0rZsAXbQ/arcgis/rest/services/GDOT_AADT_and_TruckPct_2008to2017/FeatureServer/0/query";
const PAGE = 2000;
const YEARS = [2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017] as const;
const MIN_SPAN = 5; // ≥5yr between early and late observations

type Bbox = { latMin: number; latMax: number; lonMin: number; lonMax: number };

// GA metros that have measured GDOT stations. Bounds mirror regions.ts.
const METROS: Array<{ code: string; name: string; bbox: Bbox }> = [
  { code: "atlanta_metro",     name: "Atlanta MSA",      bbox: { latMin: 33.4, latMax: 34.2, lonMin: -84.9, lonMax: -83.9 } },
  { code: "savannah_metro",    name: "Savannah MSA",     bbox: { latMin: 31.7, latMax: 32.5, lonMin: -81.6, lonMax: -80.7 } },
  { code: "augusta_metro",     name: "Augusta MSA",      bbox: { latMin: 33.3, latMax: 33.8, lonMin: -82.2, lonMax: -81.7 } },
  { code: "columbus_ga_metro", name: "Columbus (GA) MSA", bbox: { latMin: 32.3, latMax: 32.7, lonMin: -85.1, lonMax: -84.7 } },
  { code: "macon_metro",       name: "Macon MSA",        bbox: { latMin: 32.7, latMax: 33.1, lonMin: -83.9, lonMax: -83.4 } },
];

type Attrs = { Station_ID: string | null; Lat: number | null; Long: number | null } & Record<`AADT_${number}`, number | null>;
type Feature = { attributes: Attrs };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchStations(bbox: Bbox): Promise<Feature[]> {
  const out: Feature[] = [];
  const outFields = ["Station_ID", "Lat", "Long", ...YEARS.map((y) => `AADT_${y}`)].join(",");
  for (let offset = 0; offset < 60_000; offset += PAGE) {
    const url = new URL(URL_BASE);
    url.searchParams.set("where", "AADT_2017 > 0 OR AADT_2016 > 0 OR AADT_2015 > 0");
    url.searchParams.set("geometry", `${bbox.lonMin},${bbox.latMin},${bbox.lonMax},${bbox.latMax}`);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("outFields", outFields);
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(PAGE));
    url.searchParams.set("f", "json");
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`GDOT @${offset}: ${res.status}`);
    const j = (await res.json()) as { features?: Feature[]; exceededTransferLimit?: boolean };
    const feats = j.features ?? [];
    out.push(...feats);
    if (!j.exceededTransferLimit || feats.length === 0) break;
    await sleep(200);
  }
  return out;
}

function stationCAGR(a: Attrs): number | null {
  // Find earliest and latest non-null + > 0 AADT in the 2008-2017 window.
  let earliestYr = -1, earliestAadt = 0;
  let latestYr = -1, latestAadt = 0;
  for (const yr of YEARS) {
    const v = a[`AADT_${yr}` as keyof Attrs] as number | null;
    if (!v || v <= 0) continue;
    if (earliestYr < 0) { earliestYr = yr; earliestAadt = v; }
    latestYr = yr; latestAadt = v;
  }
  if (earliestYr < 0 || latestYr - earliestYr < MIN_SPAN) return null;
  const cagr = Math.pow(latestAadt / earliestAadt, 1 / (latestYr - earliestYr)) - 1;
  if (!Number.isFinite(cagr) || cagr < -0.2 || cagr > 0.2) return null;
  return cagr;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

type GrowthRow = {
  growthPct: number;
  yearFrom: number;
  yearTo: number;
  stations: number;
  p25Pct: number;
  p75Pct: number;
};

async function main(): Promise<void> {
  console.log(`ARC / GDOT Historical AADT 2008-2017 — ${METROS.length} GA metros\n`);
  const out: Record<string, GrowthRow> = {};

  for (const m of METROS) {
    console.log(`${m.code} (${m.name})`);
    const stations = await fetchStations(m.bbox);
    console.log(`  raw: ${stations.length} stations in bbox`);
    const cagrs: number[] = [];
    for (const s of stations) {
      const c = stationCAGR(s.attributes);
      if (c != null) cagrs.push(c);
    }
    if (cagrs.length === 0) {
      console.log(`  ! no stations met ≥${MIN_SPAN}yr-span filter — skipping\n`);
      continue;
    }
    const medianPct = median(cagrs) * 100;
    const p25 = pct(cagrs, 0.25) * 100;
    const p75 = pct(cagrs, 0.75) * 100;
    out[m.code] = {
      growthPct: Math.round(medianPct * 100) / 100,
      yearFrom: 2008,
      yearTo: 2017,
      stations: cagrs.length,
      p25Pct: Math.round(p25 * 100) / 100,
      p75Pct: Math.round(p75 * 100) / 100,
    };
    console.log(`  matched: ${cagrs.length} stations`);
    console.log(`  median CAGR: ${medianPct.toFixed(2)}%/yr  |  P25 ${p25.toFixed(2)} | P75 ${p75.toFixed(2)}\n`);
  }

  const outPath = path.resolve(DATA_DIR, "ga-growth-rates.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`\n=== Summary ===`);
  for (const [code, row] of Object.entries(out)) {
    console.log(`  ${code.padEnd(24)} ${row.growthPct.toFixed(2)}%/yr  (n=${row.stations}, IQR ${row.p25Pct.toFixed(2)} … ${row.p75Pct.toFixed(2)})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
