/**
 * Ingest NYC DOT Automated Traffic Recorder (ATR) hourly volumes from
 * NYC OpenData into the `atr_counts` table. Powers the §3 / §3.2
 * Existing Conditions volume tables in renderTisNewYork — replaces
 * inferred AADT × K-factor × D-factor with real measured directional
 * segment volumes.
 *
 * Source: data.cityofnewyork.us "Automated Traffic Volume Counts"
 *   dataset id 7ym2-wayt — 15-minute volume bins per (segment,
 *   direction), 2012-present. ~1.87M rows total; ~272K rows in the
 *   trailing 3-year window the TIS engine queries against.
 *
 * Spatial: source publishes wktgeom in NAD83 / New York Long Island
 * State Plane (EPSG:2263, US Survey Feet). Converted at ingest to
 * WGS84 lat/lon via proj4 so the runtime query path stays projection-
 * free.
 *
 * Idempotent. Re-running upserts on (source, source_segment_id,
 * direction, occurred_at).
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-atr-nyc.ts
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-atr-nyc.ts --years=5
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-atr-nyc.ts --dry
 */
import { sql } from "drizzle-orm";
import proj4 from "proj4";
import { db, pool, atrCountsTable, type InsertAtrCount } from "@workspace/db";

const DATASET = "7ym2-wayt";
const BASE_URL = `https://data.cityofnewyork.us/resource/${DATASET}.json`;
const PAGE_SIZE = 50_000;
const BATCH_INSERT_SIZE = 1_000;

// EPSG:2263 = NAD83 / New York Long Island, US Survey Feet.
// proj4 doesn't ship most EPSG definitions; we register the projection
// manually using the proj-string from the EPSG registry.
const NY_STATE_PLANE_LI =
  "+proj=lcc +lat_1=41.03333333333333 +lat_2=40.66666666666666 " +
  "+lat_0=40.16666666666666 +lon_0=-74 +x_0=300000 +y_0=0 " +
  "+ellps=GRS80 +datum=NAD83 +units=us-ft +no_defs";
proj4.defs("EPSG:2263", NY_STATE_PLANE_LI);

const stateplaneToWgs84 = proj4("EPSG:2263", "WGS84");

type SocrataAtr = {
  requestid: string;
  boro?: string;
  yr: string;
  m: string;
  d: string;
  hh: string;
  mm: string;
  vol: string;
  segmentid: string;
  wktgeom?: string;
  street?: string;
  fromst?: string;
  tost?: string;
  direction?: string;
};

function parseArgs(): { years: number; dry: boolean } {
  let years = 3;
  let dry = false;
  for (const a of process.argv.slice(2)) {
    if (a === "--dry") dry = true;
    else if (a.startsWith("--years=")) years = Math.max(1, Math.min(20, Number(a.slice(8))));
  }
  return { years, dry };
}

function parseWkt(wkt: string | undefined): { lon: number; lat: number } | null {
  if (!wkt) return null;
  const m = /POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i.exec(wkt);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const [lon, lat] = stateplaneToWgs84.forward([x, y]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Sanity check: NYC bounds are roughly 40.4-40.95 N, -74.3 to -73.7 W.
  // Anything outside indicates a projection / WKT parse bug we'd rather
  // discard than ingest as garbage.
  if (lat < 40.0 || lat > 41.5 || lon < -74.6 || lon > -73.3) return null;
  return { lon, lat };
}

function occurredAtFor(row: SocrataAtr): Date | null {
  const yr = Number(row.yr);
  const m = Number(row.m);
  const d = Number(row.d);
  const hh = Number(row.hh);
  const mm = Number(row.mm);
  if (!Number.isFinite(yr) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  // Local time — NYC ATR counts are timestamped in America/New_York.
  // Tag as -05:00 (EST) and let Postgres store as UTC; the +/- DST
  // hour offset is irrelevant for peak-hour aggregation (we group by
  // local hour anyway), and getting the wall-clock tagged consistently
  // avoids tz drift between record sets that span the spring-forward
  // boundary.
  const month = String(m).padStart(2, "0");
  const day = String(d).padStart(2, "0");
  const hour = String(hh).padStart(2, "0");
  const minute = String(mm).padStart(2, "0");
  const iso = `${yr}-${month}-${day}T${hour}:${minute}:00-05:00`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function mapRow(row: SocrataAtr): InsertAtrCount | null {
  if (!row.segmentid || !row.direction) return null;
  const occurred = occurredAtFor(row);
  if (!occurred) return null;
  const vol = Number(row.vol);
  if (!Number.isFinite(vol)) return null;
  const coords = parseWkt(row.wktgeom);
  return {
    source: "nyc_dot_atr",
    sourceRequestId: row.requestid,
    sourceSegmentId: row.segmentid,
    occurredAt: occurred,
    durationMinutes: 15,
    vol,
    street: row.street?.trim() || null,
    fromStreet: row.fromst?.trim() || null,
    toStreet: row.tost?.trim() || null,
    direction: row.direction,
    borough: row.boro ?? null,
    latitude: coords?.lat ?? null,
    longitude: coords?.lon ?? null,
  };
}

async function fetchPage(offset: number, sinceYear: number): Promise<SocrataAtr[]> {
  const params = new URLSearchParams({
    $where: `yr >= ${sinceYear}`,
    $order: "yr DESC, m DESC, d DESC, hh DESC, mm DESC",
    $limit: String(PAGE_SIZE),
    $offset: String(offset),
  });
  const headers: Record<string, string> = {};
  if (process.env.SOCRATA_APP_TOKEN) {
    headers["X-App-Token"] = process.env.SOCRATA_APP_TOKEN;
  }
  // Socrata routinely resets long-running connections under load.
  // Three attempts with exponential backoff has proven sufficient
  // for the dataset sizes we ingest here.
  const url = `${BASE_URL}?${params.toString()}`;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) throw new Error(`Socrata ${r.status}: ${await r.text().then(t => t.slice(0, 200))}`);
      return (await r.json()) as SocrataAtr[];
    } catch (e) {
      lastErr = e;
      const wait = 2000 * (attempt + 1);
      console.warn(`    retry ${attempt + 1} after ${wait}ms (${(e as Error).message?.slice(0, 80)})`);
      await new Promise((res) => setTimeout(res, wait));
    }
  }
  throw lastErr;
}

async function upsertBatch(rows: InsertAtrCount[], dry: boolean): Promise<void> {
  if (rows.length === 0) return;
  if (dry) return;
  // Postgres ON CONFLICT cannot resolve duplicates within a single
  // INSERT — the error reads "ON CONFLICT DO UPDATE command cannot
  // affect row a second time." Source publishes multiple count
  // sessions per (segment, direction, occurred_at) in some periods
  // (especially overlapping request ids on adjacent days), so dedupe
  // within the batch first. Last wins.
  const seen = new Map<string, InsertAtrCount>();
  for (const r of rows) {
    const k = `${r.source}|${r.sourceSegmentId}|${r.direction}|${r.occurredAt.toISOString()}`;
    seen.set(k, r);
  }
  const deduped = Array.from(seen.values());
  await db
    .insert(atrCountsTable)
    .values(deduped)
    .onConflictDoUpdate({
      target: [
        atrCountsTable.source,
        atrCountsTable.sourceSegmentId,
        atrCountsTable.direction,
        atrCountsTable.occurredAt,
      ],
      // On re-ingest, update vol + coords + street descriptors (NYC
      // occasionally republishes corrected counts; the unique key
      // ensures no duplicates).
      set: {
        vol: sql`EXCLUDED.vol`,
        latitude: sql`EXCLUDED.latitude`,
        longitude: sql`EXCLUDED.longitude`,
        street: sql`EXCLUDED.street`,
        fromStreet: sql`EXCLUDED.from_street`,
        toStreet: sql`EXCLUDED.to_street`,
        borough: sql`EXCLUDED.borough`,
      },
    });
}

async function main(): Promise<void> {
  const { years, dry } = parseArgs();
  const sinceYear = new Date().getUTCFullYear() - years;

  console.log(`ingest-atr-nyc: window = yr >= ${sinceYear} (last ${years}y), dry=${dry}`);

  let offset = 0;
  let totalFetched = 0;
  let totalUpserted = 0;
  let totalSkipped = 0;
  const startedAt = Date.now();

  while (true) {
    process.stdout.write(`  fetching offset=${offset.toLocaleString()}… `);
    const t0 = Date.now();
    const page = await fetchPage(offset, sinceYear);
    const dt = Date.now() - t0;
    console.log(`${page.length.toLocaleString()} rows in ${dt}ms`);
    if (page.length === 0) break;
    totalFetched += page.length;

    const mapped: InsertAtrCount[] = [];
    for (const r of page) {
      const m = mapRow(r);
      if (m) mapped.push(m);
      else totalSkipped++;
    }

    for (let i = 0; i < mapped.length; i += BATCH_INSERT_SIZE) {
      await upsertBatch(mapped.slice(i, i + BATCH_INSERT_SIZE), dry);
    }
    totalUpserted += mapped.length;

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `ingest-atr-nyc: fetched=${totalFetched.toLocaleString()} upserted=${totalUpserted.toLocaleString()} skipped=${totalSkipped.toLocaleString()} elapsed=${elapsedSec}s`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("ingest-atr-nyc FAILED:", err);
  pool.end().finally(() => process.exit(1));
});
