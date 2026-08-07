/**
 * Per-FL-metro measured background-traffic growth rate from FDOT's
 * Annual_Average_Daily_Traffic_Historical_TDA layer.
 *
 * Same pattern as `fetch-il-growth-rate.ts`: pull the same source
 * twice (once for the early year, once for the late year), match
 * segments by their stable ID (`COSITE` — county + site composite),
 * compute per-segment CAGR, drop |CAGR| > 20% outliers, report the
 * median + IQR per metro.
 *
 * Source: FDOT TDA Annual_Average_Daily_Traffic_Historical
 *   https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/
 *     services/Annual_Average_Daily_Traffic_Historical_TDA/
 *     FeatureServer/0
 * Each polyline row carries YEAR_, COSITE, AADT, ROADWAY, COUNTY.
 * Filtering YEAR_ = N restricts to that year's annual snapshot.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-fl-growth-rate.ts
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");

const URL_BASE =
  "https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Annual_Average_Daily_Traffic_Historical_TDA/FeatureServer/0/query";
const PAGE = 2000;
const YEAR_EARLY = 2021;
const YEAR_LATE = 2025;
// FDOT TDA Historical layer covers 2021-2025 (probed 2026-06-12).

type Bbox = { latMin: number; latMax: number; lonMin: number; lonMax: number };

// Bounding boxes mirror regions.ts. Florida metros only.
const METROS: Array<{ code: string; name: string; bbox: Bbox }> = [
  { code: "tampa_metro",          name: "Tampa MSA",                 bbox: { latMin: 27.5, latMax: 28.7, lonMin: -83.0, lonMax: -82.0 } },
  { code: "orlando_metro",        name: "Orlando MSA",               bbox: { latMin: 28.2, latMax: 29.0, lonMin: -81.7, lonMax: -80.7 } },
  { code: "miami_dade_metro",     name: "Miami-Dade County",         bbox: { latMin: 25.1, latMax: 26.0, lonMin: -80.9, lonMax: -80.1 } },
  { code: "jacksonville_metro",   name: "Jacksonville MSA",          bbox: { latMin: 30.0, latMax: 30.9, lonMin: -82.2, lonMax: -81.3 } },
  { code: "fort_lauderdale_metro", name: "Fort Lauderdale (Broward)", bbox: { latMin: 26.0, latMax: 26.4, lonMin: -80.4, lonMax: -80.0 } },
  { code: "west_palm_beach_metro", name: "West Palm Beach (PBC)",     bbox: { latMin: 26.4, latMax: 26.9, lonMin: -80.4, lonMax: -80.0 } },
  { code: "daytona_beach_metro",  name: "Deltona-Daytona MSA",       bbox: { latMin: 29.0, latMax: 29.4, lonMin: -81.3, lonMax: -80.9 } },
  { code: "lakeland_metro",       name: "Lakeland-Winter Haven MSA", bbox: { latMin: 27.9, latMax: 28.2, lonMin: -82.1, lonMax: -81.7 } },
  { code: "tallahassee_metro",    name: "Tallahassee MSA",           bbox: { latMin: 30.2, latMax: 30.7, lonMin: -84.5, lonMax: -84.0 } },
  { code: "fort_myers_metro",     name: "Cape Coral-Fort Myers MSA", bbox: { latMin: 26.4, latMax: 26.8, lonMin: -82.1, lonMax: -81.7 } },
  { code: "pensacola_metro",      name: "Pensacola MSA",             bbox: { latMin: 30.3, latMax: 30.7, lonMin: -87.5, lonMax: -86.9 } },
  { code: "sarasota_metro",       name: "North Port-Sarasota-Bradenton MSA", bbox: { latMin: 26.95, latMax: 27.60, lonMin: -82.80, lonMax: -82.05 } },
];

type Feature = {
  attributes: { YEAR_: number | null; COSITE: string | null; AADT: number | null };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchYearLayer(year: number, bbox: Bbox): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let offset = 0; offset < 60_000; offset += PAGE) {
    const url = new URL(URL_BASE);
    url.searchParams.set("where", `AADT > 0 AND YEAR_ = ${year}`);
    url.searchParams.set("geometry", `${bbox.lonMin},${bbox.latMin},${bbox.lonMax},${bbox.latMax}`);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("outFields", "YEAR_,COSITE,AADT");
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(PAGE));
    url.searchParams.set("f", "json");
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`FDOT @${offset}: ${res.status}`);
    const j = (await res.json()) as { features?: Feature[]; exceededTransferLimit?: boolean };
    const feats = j.features ?? [];
    for (const f of feats) {
      const cosite = f.attributes.COSITE;
      const aadt = f.attributes.AADT;
      if (!cosite || !aadt || aadt <= 0) continue;
      if (!out.has(cosite)) out.set(cosite, aadt);
    }
    if (!j.exceededTransferLimit || feats.length === 0) break;
    await sleep(250);
  }
  return out;
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
  console.log(`FDOT TDA Historical AADT — pulling ${YEAR_EARLY} and ${YEAR_LATE} for ${METROS.length} FL metros\n`);
  const dy = YEAR_LATE - YEAR_EARLY;
  const out: Record<string, GrowthRow> = {};

  for (const m of METROS) {
    console.log(`${m.code} (${m.name})`);
    const early = await fetchYearLayer(YEAR_EARLY, m.bbox);
    console.log(`  ${YEAR_EARLY}: ${early.size} sites`);
    const late = await fetchYearLayer(YEAR_LATE, m.bbox);
    console.log(`  ${YEAR_LATE}: ${late.size} sites`);

    const cagrs: number[] = [];
    for (const [cosite, lateAadt] of late.entries()) {
      const earlyAadt = early.get(cosite);
      if (!earlyAadt || lateAadt <= 0 || earlyAadt <= 0) continue;
      const cagr = Math.pow(lateAadt / earlyAadt, 1 / dy) - 1;
      if (!Number.isFinite(cagr) || cagr < -0.2 || cagr > 0.2) continue;
      cagrs.push(cagr);
    }
    if (cagrs.length === 0) {
      console.log(`  ! no matched sites — skipping\n`);
      continue;
    }
    const medianPct = median(cagrs) * 100;
    const p25 = pct(cagrs, 0.25) * 100;
    const p75 = pct(cagrs, 0.75) * 100;
    out[m.code] = {
      growthPct: Math.round(medianPct * 100) / 100,
      yearFrom: YEAR_EARLY,
      yearTo: YEAR_LATE,
      stations: cagrs.length,
      p25Pct: Math.round(p25 * 100) / 100,
      p75Pct: Math.round(p75 * 100) / 100,
    };
    console.log(`  matched: ${cagrs.length} sites`);
    console.log(`  median CAGR: ${medianPct.toFixed(2)}%/yr  |  P25 ${p25.toFixed(2)} | P75 ${p75.toFixed(2)}\n`);
  }

  const outPath = path.resolve(DATA_DIR, "fl-growth-rates.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`\n=== Summary ===`);
  for (const [code, row] of Object.entries(out)) {
    console.log(`  ${code.padEnd(28)} ${row.growthPct.toFixed(2)}%/yr  (n=${row.stations}, IQR ${row.p25Pct.toFixed(2)} … ${row.p75Pct.toFixed(2)})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
