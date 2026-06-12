/**
 * Per-IL-metro measured background-traffic growth rate from IDOT's
 * Historical AADT layers.
 *
 * Why this exists: every TIS renderer (GA, IL, TX, CA, London) prints
 * "background growth applied at X%/yr" where X is whatever screening
 * default the engine echoes — typically 1.5%/yr — and then has prose
 * that sheepishly admits "this is a screening default; re-calibrate
 * before submittal." The IL TIS spec is explicit about this: IDOT D8
 * Appendix A requires the consultant to derive and justify the rate,
 * and the standard derivation is the 5-year compound AADT growth at
 * the nearest count station. So the screening default is precisely
 * the value a reviewer flags first.
 *
 * IDOT publishes per-year AADT snapshots at
 *   https://gis1.dot.illinois.gov/arcgis/rest/services/
 *     AdministrativeData/AADT_Historical/FeatureServer/{year}
 * for layer IDs 2015..2025 (verified 2026-06-12). Each layer's
 * polyline features carry `INVENTORY` (segment ID, stable across
 * years), `AADT` (the snapshot value), and `AADT_YR` (the year the
 * underlying count was taken — may be older than the layer year for
 * sparse segments).
 *
 * This script:
 *   1. For each IL metro (Chicago, Springfield-IL, Rockford, Peoria,
 *      Champaign), fetches both the 2020 layer and the 2025 layer
 *      intersecting the metro's bbox.
 *   2. Matches segments by INVENTORY between the two snapshots,
 *      keeps only pairs where both AADT_YR values are within ±1 of
 *      the layer year (so we're comparing real measured 2020-vintage
 *      counts against real 2025-vintage counts, not IDOT-extrapolated
 *      values).
 *   3. Computes the per-segment 5-year compound annual growth rate
 *      CAGR = (a_2025 / a_2020)^(1/Δyears) - 1.
 *   4. Reports the metro's MEDIAN CAGR plus station count, year
 *      range, and 25/75 IQR — median is the right summary statistic
 *      because urban arterials have a long-tail distribution where a
 *      single newly-developed corridor can skew the mean.
 *   5. Writes `il-growth-rates.json` consumed by the IL TIS renderer
 *      to replace the screening-default prose with a real,
 *      measured-trend statement.
 *
 * Output JSON shape:
 *   {
 *     "chicago_metro": {
 *       growthPct: 0.82,
 *       yearFrom: 2020,
 *       yearTo: 2025,
 *       stations: 1422,
 *       p25Pct: -0.34,
 *       p75Pct: 2.18,
 *       source: "IDOT Historical AADT FeatureServer layers 2020 and 2025 (segment match by INVENTORY, AADT_YR within ±1 of layer year)"
 *     },
 *     ...
 *   }
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-il-growth-rate.ts
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");

const BASE = "https://gis1.dot.illinois.gov/arcgis/rest/services/AdministrativeData/AADT_Historical/FeatureServer";
const PAGE = 2000;
const YEAR_EARLY = 2020;
const YEAR_LATE = 2025;
const YEAR_SPAN = YEAR_LATE - YEAR_EARLY;
const VINTAGE_TOLERANCE = 1; // AADT_YR must be within ±1 of the layer year

type Bbox = { latMin: number; latMax: number; lonMin: number; lonMax: number };

const METROS: Array<{ code: string; name: string; bbox: Bbox }> = [
  { code: "chicago_metro", name: "Chicago-Naperville-Elgin MSA", bbox: { latMin: 41.5, latMax: 42.3, lonMin: -88.5, lonMax: -87.4 } },
  { code: "springfield_il_metro", name: "Springfield (IL) MSA", bbox: { latMin: 39.6, latMax: 39.9, lonMin: -89.8, lonMax: -89.5 } },
  { code: "rockford_metro", name: "Rockford MSA", bbox: { latMin: 42.1, latMax: 42.4, lonMin: -89.2, lonMax: -88.8 } },
  { code: "peoria_metro", name: "Peoria MSA", bbox: { latMin: 40.5, latMax: 40.9, lonMin: -89.8, lonMax: -89.3 } },
  { code: "champaign_metro", name: "Champaign-Urbana MSA", bbox: { latMin: 40.0, latMax: 40.2, lonMin: -88.4, lonMax: -88.1 } },
];

type Feature = {
  attributes: { INVENTORY: string | null; AADT: number | null; AADT_YR: number | null };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchYearLayer(year: number, bbox: Bbox): Promise<Map<string, { aadt: number; yr: number }>> {
  const envelope = `${bbox.lonMin},${bbox.latMin},${bbox.lonMax},${bbox.latMax}`;
  const out = new Map<string, { aadt: number; yr: number }>();
  for (let offset = 0; offset < 60_000; offset += PAGE) {
    const url = new URL(`${BASE}/${year}/query`);
    url.searchParams.set("where", `AADT > 0 AND AADT_YR >= ${year - VINTAGE_TOLERANCE} AND AADT_YR <= ${year + VINTAGE_TOLERANCE}`);
    url.searchParams.set("geometry", envelope);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("outFields", "INVENTORY,AADT,AADT_YR");
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(PAGE));
    url.searchParams.set("f", "json");
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`IDOT layer ${year} @${offset}: ${res.status}`);
    const j = (await res.json()) as { features?: Feature[]; exceededTransferLimit?: boolean };
    const feats = j.features ?? [];
    for (const f of feats) {
      const inv = f.attributes.INVENTORY;
      const aadt = f.attributes.AADT;
      const yr = f.attributes.AADT_YR;
      if (!inv || !aadt || aadt <= 0 || !yr) continue;
      // First record wins per INVENTORY — segments are uniquely keyed,
      // duplicates from page boundaries are no-ops.
      if (!out.has(inv)) out.set(inv, { aadt, yr });
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
  const idx = Math.min(s.length - 1, Math.floor(p * s.length));
  return s[idx];
}

type GrowthRow = {
  growthPct: number;
  yearFrom: number;
  yearTo: number;
  stations: number;
  p25Pct: number;
  p75Pct: number;
  source: string;
};

async function main(): Promise<void> {
  console.log(`Pulling IDOT Historical AADT layers ${YEAR_EARLY} and ${YEAR_LATE} for ${METROS.length} IL metros\n`);

  const out: Record<string, GrowthRow> = {};

  for (const m of METROS) {
    console.log(`${m.code} (${m.name})`);
    const earlyLayer = await fetchYearLayer(YEAR_EARLY, m.bbox);
    console.log(`  ${YEAR_EARLY}: ${earlyLayer.size} segments`);
    const lateLayer = await fetchYearLayer(YEAR_LATE, m.bbox);
    console.log(`  ${YEAR_LATE}: ${lateLayer.size} segments`);

    const cagrs: number[] = [];
    for (const [inv, late] of lateLayer.entries()) {
      const early = earlyLayer.get(inv);
      if (!early) continue;
      if (early.aadt <= 0 || late.aadt <= 0) continue;
      const dy = Math.max(1, late.yr - early.yr);
      const cagr = Math.pow(late.aadt / early.aadt, 1 / dy) - 1;
      // Drop obviously broken pairs: ±20%/yr is well outside any
      // realistic urban arterial trend; if we see it, one of the
      // two snapshots is bad. Better to drop than skew.
      if (!Number.isFinite(cagr) || cagr < -0.2 || cagr > 0.2) continue;
      cagrs.push(cagr);
    }
    if (cagrs.length === 0) {
      console.log(`  ! no matched segments — skipping`);
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
      source: `IDOT Historical AADT FeatureServer layers ${YEAR_EARLY} and ${YEAR_LATE} (segment match by INVENTORY, AADT_YR within ±${VINTAGE_TOLERANCE} of layer year)`,
    };
    console.log(`  matched: ${cagrs.length} segments`);
    console.log(`  median CAGR: ${medianPct.toFixed(2)}%/yr  |  P25 ${p25.toFixed(2)}%/yr  |  P75 ${p75.toFixed(2)}%/yr\n`);
  }

  const outPath = path.resolve(DATA_DIR, "il-growth-rates.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`\n=== Summary ===`);
  for (const [code, row] of Object.entries(out)) {
    console.log(`  ${code.padEnd(24)} ${row.growthPct.toFixed(2)}%/yr  (n=${row.stations}, IQR ${row.p25Pct.toFixed(2)} … ${row.p75Pct.toFixed(2)})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
