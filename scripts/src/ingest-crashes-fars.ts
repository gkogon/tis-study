/**
 * Ingest NHTSA FARS (Fatality Analysis Reporting System) fatal-crash
 * records into the `crashes` table. Universal public source — covers
 * every US state with precise lat/lon. Solves the problem that nearly
 * every state's per-crash data is gated behind agency login (GEARS,
 * SWITRS, CRIS, etc.) by providing a uniform K-severity layer that
 * works for every renderer.
 *
 * Source: BTS GeoData ArcGIS FeatureServer
 *   services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/
 *     FARS_Fatal_Crashes_2017_2022/FeatureServer/0
 *
 * 217K fatal crashes 2017-2022. Schema is minimal: year, crash_id,
 * state, city, county, fatalities, lat, lon, lightcond. No CRASH_DATE,
 * no CRASH_TIME, no manner-of-collision, no ped/cyclist flags. The
 * row therefore stamps `occurredAt` as Jan 1 of the crash year UTC —
 * the renderer prose discloses this so an engineer doesn't infer a
 * time-of-day pattern from data the source didn't publish.
 *
 * Idempotent ingest via (source, sourceRecordId) where
 * sourceRecordId = `${year}_${crash_id}` (crash_id is unique within a
 * FARS year, not across years).
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-crashes-fars.ts
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-crashes-fars.ts --year=2022
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-crashes-fars.ts --dry
 */
import { sql } from "drizzle-orm";
import { db, pool, crashesTable, type InsertCrash } from "@workspace/db";

const LAYER_URL =
  "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/FARS_Fatal_Crashes_2017_2022/FeatureServer/0/query";
const PAGE_SIZE = 2000;
const BATCH_INSERT_SIZE = 1000;
const DEFAULT_YEARS = [2020, 2021, 2022];

type FarsAttrs = {
  year: string;
  crash_id: string;
  state?: string;
  city?: string;
  county?: string;
  fatalities?: string;
  lat?: string;
  lon?: string;
};

function parseArgs(): { years: number[]; dry: boolean } {
  let years = DEFAULT_YEARS;
  let dry = false;
  for (const a of process.argv.slice(2)) {
    if (a === "--dry") dry = true;
    else if (a.startsWith("--year=")) {
      const y = Number(a.slice(7));
      if (Number.isFinite(y)) years = [y];
    } else if (a.startsWith("--years=")) {
      years = a.slice(8).split(",").map(Number).filter((n) => Number.isFinite(n));
    }
  }
  return { years, dry };
}

function mapRow(a: FarsAttrs): InsertCrash | null {
  if (!a.crash_id || !a.year) return null;
  const lat = Number(a.lat);
  const lon = Number(a.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Continental US + AK/HI sanity bounds.
  if (lat < 17 || lat > 72 || lon < -180 || lon > -65) return null;
  const yr = Number(a.year);
  if (!Number.isFinite(yr)) return null;
  // FARS layer doesn't publish crash date — stamp as Jan 1 UTC of the
  // crash year. Renderer prose discloses this.
  const occurredAt = new Date(`${yr}-01-01T00:00:00Z`);
  // Strip "(NN)" suffix from county labels ("MARICOPA (13)" → "MARICOPA").
  const county = a.county ? a.county.replace(/\s*\(\d+\)\s*$/, "").trim() : null;
  return {
    source: "nhtsa_fars",
    sourceRecordId: `${a.year}_${a.crash_id}`,
    occurredAt,
    severity: "K", // FARS is fatal-only by definition.
    latitude: lat,
    longitude: lon,
    locationPrecision: "precise",
    municipality: a.city?.trim() || null,
    county,
    onStreet: null,
    crossStreet: null,
    mannerOfCollision: null,
    lighting: null,
    weather: null,
    surface: null,
    numVehicles: null,
    pedestrianInvolved: false,
    cyclistInvolved: false,
  };
}

async function fetchPage(year: number, offset: number): Promise<FarsAttrs[]> {
  const params = new URLSearchParams({
    where: `year='${year}'`,
    outFields: "year,crash_id,state,city,county,fatalities,lat,lon",
    returnGeometry: "false",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    orderByFields: "FID ASC",
    f: "json",
  });
  let last: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`${LAYER_URL}?${params.toString()}`);
      if (!r.ok) throw new Error(`ArcGIS ${r.status}`);
      const j = (await r.json()) as { features?: { attributes: FarsAttrs }[]; error?: unknown };
      if (j.error) throw new Error(`ArcGIS error: ${JSON.stringify(j.error).slice(0, 200)}`);
      return (j.features ?? []).map((f) => f.attributes);
    } catch (e) {
      last = e;
      const wait = 2000 * (attempt + 1);
      console.warn(`    retry ${attempt + 1} after ${wait}ms`);
      await new Promise((res) => setTimeout(res, wait));
    }
  }
  throw last;
}

async function upsertBatch(rows: InsertCrash[], dry: boolean): Promise<void> {
  if (rows.length === 0 || dry) return;
  const seen = new Map<string, InsertCrash>();
  for (const r of rows) seen.set(`${r.source}|${r.sourceRecordId}`, r);
  await db
    .insert(crashesTable)
    .values(Array.from(seen.values()))
    .onConflictDoUpdate({
      target: [crashesTable.source, crashesTable.sourceRecordId],
      set: {
        latitude: sql`EXCLUDED.latitude`,
        longitude: sql`EXCLUDED.longitude`,
        municipality: sql`EXCLUDED.municipality`,
        county: sql`EXCLUDED.county`,
      },
    });
}

async function ingestYear(year: number, dry: boolean): Promise<{ fetched: number; upserted: number }> {
  let offset = 0;
  let fetched = 0;
  let upserted = 0;
  while (true) {
    process.stdout.write(`  year=${year} offset=${offset.toLocaleString()}… `);
    const t0 = Date.now();
    const page = await fetchPage(year, offset);
    console.log(`${page.length.toLocaleString()} in ${Date.now() - t0}ms`);
    if (page.length === 0) break;
    fetched += page.length;
    const mapped: InsertCrash[] = [];
    for (const a of page) {
      const m = mapRow(a);
      if (m) mapped.push(m);
    }
    for (let i = 0; i < mapped.length; i += BATCH_INSERT_SIZE) {
      await upsertBatch(mapped.slice(i, i + BATCH_INSERT_SIZE), dry);
    }
    upserted += mapped.length;
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return { fetched, upserted };
}

async function main(): Promise<void> {
  const { years, dry } = parseArgs();
  console.log(`ingest-crashes-fars: years=${years.join(",")} dry=${dry}`);
  const startedAt = Date.now();
  let totalFetched = 0;
  let totalUpserted = 0;
  for (const y of years) {
    const { fetched, upserted } = await ingestYear(y, dry);
    totalFetched += fetched;
    totalUpserted += upserted;
  }
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`ingest-crashes-fars: fetched=${totalFetched.toLocaleString()} upserted=${totalUpserted.toLocaleString()} elapsed=${elapsedSec}s`);
  await pool.end();
}

main().catch((err) => {
  console.error("ingest-crashes-fars FAILED:", err);
  pool.end().finally(() => process.exit(1));
});
