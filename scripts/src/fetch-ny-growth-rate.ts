/**
 * Per-NY-metro measured background-traffic growth rate from NYSDOT's
 * Traffic Monitoring AADT FeatureServer.
 *
 * Sibling of `fetch-il-growth-rate.ts` (IL pattern, commit 2e7e727).
 * Same goal — replace the renderer's 1.5%/yr screening default with a
 * real measured trend per metro — different mechanic, because NYSDOT
 * publishes AADT differently from IDOT.
 *
 * IDOT publishes year-keyed layers (2015..2025) where each layer
 * contains a full snapshot of state-system AADT for that year. The IL
 * fetcher matches segments by INVENTORY across the 2020 and 2025
 * layers to compute the 5-year CAGR per segment, then takes the
 * per-metro median.
 *
 * NYSDOT publishes ONE active AADT layer at:
 *   https://gis.dot.ny.gov/hostingny/rest/services/Roadways/
 *     Traffic_Monitoring/FeatureServer/1
 * Each feature is a count station carrying the last 4 actual counts
 * as paired (AADTLastAct, YearLastAct), (AADT2LastAct, Year2LastAct),
 * (AADT3LastAct, Year3LastAct), (AADT4LastAct, Year4LastAct). No
 * INVENTORY-style cross-year matching needed — every station's own
 * rolling history is already on the feature.
 *
 * This script:
 *   1. For each NY metro (Buffalo, Rochester, Syracuse, Albany,
 *      Hudson Valley, Long Island, NYC five boroughs), fetches all
 *      stations within the metro bbox that have at least 2 actual
 *      counts in the rolling 4-year window.
 *   2. For each station, computes CAGR between the OLDEST and the
 *      NEWEST actual counts present (typically a 4-year span; the
 *      script handles 2-, 3-, and 4-year spans uniformly):
 *          CAGR = (newest / oldest)^(1 / Δyears) - 1
 *   3. Drops pairs with |CAGR| > 20%/yr (one of the counts is bad).
 *   4. Reports the metro's MEDIAN CAGR + station count + IQR.
 *   5. Writes ny-growth-rates.json to the data dir for the renderer
 *      to import inline (mirroring IL_MEASURED_GROWTH).
 *
 * Output JSON shape (matches IL):
 *   {
 *     "new_york_metro": {
 *       growthPct: 0.42,
 *       yearFrom: 2019,
 *       yearTo: 2024,
 *       stations: 1322,
 *       p25Pct: -1.18,
 *       p75Pct: 2.04,
 *       source: "NYSDOT Traffic_Monitoring FeatureServer layer 1 ..."
 *     },
 *     ...
 *   }
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/fetch-ny-growth-rate.ts
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");

const BASE = "https://gis.dot.ny.gov/hostingny/rest/services/Roadways/Traffic_Monitoring/FeatureServer/1";
const PAGE = 2000;
const CAGR_MAX = 0.2; // ±20%/yr — outside this, one count is bad

type Bbox = { latMin: number; latMax: number; lonMin: number; lonMax: number };

const METROS: Array<{ code: string; name: string; bbox: Bbox }> = [
  // NYSDOT Region 11 (NYC) + Region 10 (LI) + Region 8 (Hudson Valley).
  // Single bbox covers the full new_york_metro region used in the
  // engine; the renderer's nysdotRegion() further sub-divides at the
  // intersection level.
  {
    code: "new_york_metro",
    name: "New York City + Long Island + Hudson Valley",
    bbox: { latMin: 40.49, latMax: 41.51, lonMin: -74.27, lonMax: -71.85 },
  },
  {
    code: "albany_metro",
    name: "Capital District (Albany / Rensselaer / Saratoga / Schenectady)",
    bbox: { latMin: 42.55, latMax: 43.10, lonMin: -74.05, lonMax: -73.45 },
  },
  {
    code: "buffalo_metro",
    name: "Buffalo / Niagara",
    bbox: { latMin: 42.65, latMax: 43.20, lonMin: -79.15, lonMax: -78.60 },
  },
  {
    code: "rochester_ny_metro",
    name: "Rochester / Genesee Valley",
    bbox: { latMin: 42.95, latMax: 43.40, lonMin: -78.05, lonMax: -77.30 },
  },
  {
    code: "syracuse_metro",
    name: "Syracuse / Central New York",
    bbox: { latMin: 42.85, latMax: 43.30, lonMin: -76.50, lonMax: -75.85 },
  },
];

type Feature = {
  attributes: {
    AADTLastAct: number | null;
    YearLastAct: number | null;
    AADT2LastAct: number | null;
    Year2LastAct: number | null;
    AADT3LastAct: number | null;
    Year3LastAct: number | null;
    AADT4LastAct: number | null;
    Year4LastAct: number | null;
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchStations(bbox: Bbox): Promise<Feature[]> {
  const envelope = `${bbox.lonMin},${bbox.latMin},${bbox.lonMax},${bbox.latMax}`;
  const out: Feature[] = [];
  for (let offset = 0; offset < 100_000; offset += PAGE) {
    const url = new URL(`${BASE}/query`);
    url.searchParams.set("where", "AADTLastAct > 0 AND AADT2LastAct > 0");
    url.searchParams.set("geometry", envelope);
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set(
      "outFields",
      "AADTLastAct,YearLastAct,AADT2LastAct,Year2LastAct,AADT3LastAct,Year3LastAct,AADT4LastAct,Year4LastAct"
    );
    url.searchParams.set("returnGeometry", "false");
    url.searchParams.set("resultOffset", String(offset));
    url.searchParams.set("resultRecordCount", String(PAGE));
    url.searchParams.set("f", "json");
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`NYSDOT TDV @${offset}: ${res.status}`);
    const j = (await res.json()) as { features?: Feature[]; exceededTransferLimit?: boolean };
    const feats = j.features ?? [];
    out.push(...feats);
    if (!j.exceededTransferLimit || feats.length === 0) break;
    await sleep(250);
  }
  return out;
}

/**
 * From a station's rolling-4 history, find the oldest non-null actual
 * count and the newest non-null actual count. Returns null if fewer
 * than 2 actual counts are present or if the year span is zero.
 */
function oldestNewest(f: Feature): { oldY: number; oldA: number; newY: number; newA: number } | null {
  const a = f.attributes;
  const acts: Array<{ y: number; v: number }> = [];
  for (const pair of [
    { y: a.YearLastAct, v: a.AADTLastAct },
    { y: a.Year2LastAct, v: a.AADT2LastAct },
    { y: a.Year3LastAct, v: a.AADT3LastAct },
    { y: a.Year4LastAct, v: a.AADT4LastAct },
  ]) {
    if (typeof pair.y === "number" && typeof pair.v === "number" && pair.y > 1990 && pair.v > 0) {
      acts.push({ y: pair.y, v: pair.v });
    }
  }
  if (acts.length < 2) return null;
  acts.sort((x, y) => x.y - y.y);
  const oldest = acts[0];
  const newest = acts[acts.length - 1];
  if (newest.y - oldest.y < 1) return null;
  return { oldY: oldest.y, oldA: oldest.v, newY: newest.y, newA: newest.v };
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
  console.log(`Pulling NYSDOT Traffic_Monitoring AADT for ${METROS.length} NY metros\n`);

  const out: Record<string, GrowthRow> = {};

  for (const m of METROS) {
    console.log(`${m.code} (${m.name})`);
    const stations = await fetchStations(m.bbox);
    console.log(`  ${stations.length} stations in bbox`);

    const cagrs: number[] = [];
    let yearMin = Infinity;
    let yearMax = -Infinity;
    for (const f of stations) {
      const span = oldestNewest(f);
      if (!span) continue;
      const dy = span.newY - span.oldY;
      const cagr = Math.pow(span.newA / span.oldA, 1 / dy) - 1;
      if (!Number.isFinite(cagr) || cagr < -CAGR_MAX || cagr > CAGR_MAX) continue;
      cagrs.push(cagr);
      if (span.oldY < yearMin) yearMin = span.oldY;
      if (span.newY > yearMax) yearMax = span.newY;
    }
    if (cagrs.length === 0) {
      console.log(`  ! no usable stations — skipping\n`);
      continue;
    }
    const medianPct = median(cagrs) * 100;
    const p25 = pct(cagrs, 0.25) * 100;
    const p75 = pct(cagrs, 0.75) * 100;
    out[m.code] = {
      growthPct: Math.round(medianPct * 100) / 100,
      yearFrom: yearMin,
      yearTo: yearMax,
      stations: cagrs.length,
      p25Pct: Math.round(p25 * 100) / 100,
      p75Pct: Math.round(p75 * 100) / 100,
      source: `NYSDOT Traffic_Monitoring FeatureServer layer 1 (rolling 4-year actual-count history per station; CAGR between oldest and newest non-null actual counts; outliers |CAGR| > ${CAGR_MAX * 100}%/yr dropped)`,
    };
    console.log(`  usable stations: ${cagrs.length}`);
    console.log(`  year window: ${yearMin}-${yearMax}`);
    console.log(
      `  median CAGR: ${medianPct.toFixed(2)}%/yr  |  P25 ${p25.toFixed(2)}%/yr  |  P75 ${p75.toFixed(2)}%/yr\n`
    );
  }

  const outPath = path.resolve(DATA_DIR, "ny-growth-rates.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(`\n=== Summary ===`);
  for (const [code, row] of Object.entries(out)) {
    console.log(
      `  ${code.padEnd(24)} ${row.growthPct.toFixed(2)}%/yr  (n=${row.stations}, IQR ${row.p25Pct.toFixed(2)} … ${row.p75Pct.toFixed(2)}, ${row.yearFrom}-${row.yearTo})`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
