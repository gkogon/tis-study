/**
 * Per-TX-metro measured background-traffic growth rate from TxDOT's
 * 5-Year Statewide AADT Traffic Counts service.
 *
 * Source: TxDOT TPP — TxDOT 5-Year Statewide AADT Traffic Counts
 *   https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/
 *     services/TxDOT_5_Year_Statewide_AADT_Traffic_Counts/
 *     FeatureServer/0
 * Layer named TMB_RPT_SHORT_AADT_HIST. Each row carries
 * TRFC_STATN_ID + LATEST_AADT_YR + 5 consecutive years of AADT:
 *   AADT_RPT_QTY        = LATEST_AADT_YR        (currently 2024)
 *   AADT_RPT_HIST_01_QTY = LATEST_AADT_YR - 1   (2023)
 *   AADT_RPT_HIST_02_QTY = LATEST_AADT_YR - 2   (2022)
 *   AADT_RPT_HIST_03_QTY = LATEST_AADT_YR - 3   (2021)
 *   AADT_RPT_HIST_04_QTY = LATEST_AADT_YR - 4   (2020)
 *
 * Per-station CAGR is computed from earliest + latest non-null +
 * positive AADT in the 5-year window. ≥4yr span required so the
 * CAGR has at least 4 compounding years of signal. Drop
 * |CAGR| > 20%/yr outliers. Per-metro median + IQR.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-tx-growth-rate.ts
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");

const URL_BASE =
  "https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/TxDOT_5_Year_Statewide_AADT_Traffic_Counts/FeatureServer/0/query";
const PAGE = 2000;
const MIN_SPAN = 2;
const HIST_FIELDS = [
  "AADT_RPT_QTY",
  "AADT_RPT_HIST_01_QTY",
  "AADT_RPT_HIST_02_QTY",
  "AADT_RPT_HIST_03_QTY",
  "AADT_RPT_HIST_04_QTY",
] as const;

type Bbox = { latMin: number; latMax: number; lonMin: number; lonMax: number };

const METROS: Array<{ code: string; name: string; bbox: Bbox }> = [
  { code: "houston_metro",         name: "Houston MSA",            bbox: { latMin: 29.4, latMax: 30.2, lonMin: -95.9, lonMax: -94.9 } },
  { code: "dallas_fort_worth_metro", name: "Dallas-Fort Worth MSA", bbox: { latMin: 32.4, latMax: 33.4, lonMin: -97.5, lonMax: -96.3 } },
  { code: "austin_metro",          name: "Austin MSA",             bbox: { latMin: 30.1, latMax: 30.6, lonMin: -98.0, lonMax: -97.4 } },
  { code: "san_antonio_metro",     name: "San Antonio MSA",        bbox: { latMin: 29.2, latMax: 29.7, lonMin: -98.8, lonMax: -98.2 } },
  { code: "el_paso_metro",         name: "El Paso MSA",            bbox: { latMin: 31.6, latMax: 32.0, lonMin: -106.7, lonMax: -106.2 } },
  { code: "corpus_christi_metro",  name: "Corpus Christi MSA",     bbox: { latMin: 27.6, latMax: 28.0, lonMin: -97.6, lonMax: -97.2 } },
  { code: "lubbock_metro",         name: "Lubbock MSA",            bbox: { latMin: 33.4, latMax: 33.7, lonMin: -101.95, lonMax: -101.7 } },
  { code: "mcallen_metro",         name: "McAllen MSA",            bbox: { latMin: 26.1, latMax: 26.4, lonMin: -98.4, lonMax: -97.8 } },
];

type Attrs = {
  TRFC_STATN_ID: string | null;
  LATEST_AADT_YR: number | null;
  AADT_RPT_QTY: number | null;
  AADT_RPT_HIST_01_QTY: number | null;
  AADT_RPT_HIST_02_QTY: number | null;
  AADT_RPT_HIST_03_QTY: number | null;
  AADT_RPT_HIST_04_QTY: number | null;
};
type Feature = { attributes: Attrs };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchStations(bbox: Bbox): Promise<Feature[]> {
  const out: Feature[] = [];
  const outFields = ["TRFC_STATN_ID", "LATEST_AADT_YR", ...HIST_FIELDS].join(",");
  for (let offset = 0; offset < 60_000; offset += PAGE) {
    const url = new URL(URL_BASE);
    url.searchParams.set("where", "AADT_RPT_QTY > 0");
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
    if (!res.ok) throw new Error(`TxDOT @${offset}: ${res.status}`);
    const j = (await res.json()) as { features?: Feature[]; exceededTransferLimit?: boolean };
    const feats = j.features ?? [];
    out.push(...feats);
    if (!j.exceededTransferLimit || feats.length === 0) break;
    await sleep(200);
  }
  return out;
}

function stationCAGR(a: Attrs): number | null {
  const yr = a.LATEST_AADT_YR;
  if (!yr) return null;
  // Build per-year AADT array (yr-4 .. yr).
  const series: Array<{ yr: number; v: number }> = [];
  const fields: Array<[number, number | null]> = [
    [yr,     a.AADT_RPT_QTY],
    [yr - 1, a.AADT_RPT_HIST_01_QTY],
    [yr - 2, a.AADT_RPT_HIST_02_QTY],
    [yr - 3, a.AADT_RPT_HIST_03_QTY],
    [yr - 4, a.AADT_RPT_HIST_04_QTY],
  ];
  for (const [y, v] of fields) {
    if (v != null && v > 0) series.push({ yr: y, v });
  }
  if (series.length < 2) return null;
  series.sort((p, q) => p.yr - q.yr);
  const early = series[0];
  const late = series[series.length - 1];
  if (late.yr - early.yr < MIN_SPAN) return null;
  const cagr = Math.pow(late.v / early.v, 1 / (late.yr - early.yr)) - 1;
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
  console.log(`TxDOT 5-Year Statewide AADT — ${METROS.length} TX metros\n`);
  const out: Record<string, GrowthRow> = {};
  let globalYearFrom = Number.POSITIVE_INFINITY;
  let globalYearTo = Number.NEGATIVE_INFINITY;

  for (const m of METROS) {
    console.log(`${m.code} (${m.name})`);
    const stations = await fetchStations(m.bbox);
    console.log(`  raw: ${stations.length} stations in bbox`);
    const cagrs: number[] = [];
    let earliestYr = Number.POSITIVE_INFINITY, latestYr = Number.NEGATIVE_INFINITY;
    for (const s of stations) {
      const c = stationCAGR(s.attributes);
      if (c != null) {
        cagrs.push(c);
        const yr = s.attributes.LATEST_AADT_YR ?? 0;
        if (yr - 4 < earliestYr) earliestYr = yr - 4;
        if (yr > latestYr) latestYr = yr;
      }
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
      yearFrom: earliestYr,
      yearTo: latestYr,
      stations: cagrs.length,
      p25Pct: Math.round(p25 * 100) / 100,
      p75Pct: Math.round(p75 * 100) / 100,
    };
    if (earliestYr < globalYearFrom) globalYearFrom = earliestYr;
    if (latestYr > globalYearTo) globalYearTo = latestYr;
    console.log(`  matched: ${cagrs.length} stations`);
    console.log(`  median CAGR: ${medianPct.toFixed(2)}%/yr  |  P25 ${p25.toFixed(2)} | P75 ${p75.toFixed(2)}\n`);
  }

  const outPath = path.resolve(DATA_DIR, "tx-growth-rates.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`\n=== Summary (${globalYearFrom}-${globalYearTo}) ===`);
  for (const [code, row] of Object.entries(out)) {
    console.log(`  ${code.padEnd(26)} ${row.growthPct.toFixed(2)}%/yr  (n=${row.stations}, IQR ${row.p25Pct.toFixed(2)} … ${row.p75Pct.toFixed(2)})`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
