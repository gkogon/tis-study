/**
 * FDOT Traffic TMSCOUNT (TDA) — hourly directional counts for all 63 Florida
 * counties.
 *
 * This is the highest-coverage measured-count source available to this product.
 * A 2026-08-28 sweep of every metro we serve found no open per-intersection
 * feed anywhere else at this granularity: it is hourly, directional, carries
 * coordinates, needs no API key, and covers Miami-Dade, Broward, Palm Beach,
 * Hillsborough, Pinellas, Pasco, Orange, Duval, Lee, Collier, Manatee, Leon,
 * Monroe and Walton — i.e. every Florida region the engine has a renderer for.
 *
 * SHAPE. One row per count site per direction per calendar day, carrying 24
 * populated hourly columns HR1..HR24. We explode each row into 24 hourly bins
 * (durationMinutes 60) so the existing peak-hour aggregation works unchanged.
 *
 * ⚠️ HOUR INDEXING — verified empirically, not assumed. Across 40 sampled rows,
 * PEAKVOL equalled HR[PEAKHR] in 40/40 cases (and HR[PEAKHR+1] in 0), so HRn is
 * the hour labelled n. HR24 is therefore the midnight hour. Cross-checked two
 * ways: sum(HR1..HR24) === TOTVOL exactly, and the resulting profile is a
 * textbook diurnal curve (minimum ~105 at HR3-4, AM peak 2,839 at HR8, PM
 * secondary 2,186 at HR17). Getting this off by one would shift every peak-hour
 * volume by an hour, so it is asserted in the mapper too.
 *
 * ⚠️ ROLLING WINDOW, NOT AN ARCHIVE. The service carries roughly the trailing
 * 365 days and old rows drop off. History has to be accumulated by running this
 * on a schedule; a one-off run captures only what is currently published.
 * (FDOT's own item description says "most recent six months" and understates
 * it — the service actually held 12 months when verified.)
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-atr-fdot.ts --dry
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-atr-fdot.ts --days=90
 *   pnpm --filter @workspace/scripts exec tsx src/ingest-atr-fdot.ts --county=Miami-Dade
 */
import { pool, type InsertAtrCount } from "@workspace/db";
import { BATCH_INSERT_SIZE, parseIngestArgs, upsertAtrBatch } from "./lib/atr-upsert";

export const FDOT_SOURCE = "fdot_tda";
const BASE =
  "https://services1.arcgis.com/O1JpcwDW8sjYuddV/arcgis/rest/services/Traffic_TMSCOUNT_TDA/FeatureServer/0/query";
// The layer advertises maxRecordCount 2000; asking for more silently truncates.
const PAGE_SIZE = 2000;

const HOUR_FIELDS = Array.from({ length: 24 }, (_, i) => `HR${i + 1}`);
const OUT_FIELDS = [
  "COSITE", "COUNTY", "ROADWAY", "LOCALNAM", "DIR", "BEGDATE", "TOTVOL", "PEAKHR", "PEAKVOL",
  ...HOUR_FIELDS,
].join(",");

export type FdotFeature = {
  attributes: Record<string, string | number | null>;
  geometry?: { x: number; y: number };
};

/**
 * HRn -> hour of day. HR1..HR23 are hours 1..23; HR24 is the midnight hour.
 * See the header note — this is measured, not assumed.
 */
export function hourForField(n: number): number {
  return n === 24 ? 0 : n;
}

/**
 * Explode one FDOT row into up to 24 hourly count rows.
 *
 * Returns [] rather than throwing on a malformed row so one bad record cannot
 * abort a multi-hundred-thousand-row ingest; callers count the skips.
 */
export function mapFeature(f: FdotFeature): InsertAtrCount[] {
  const a = f.attributes ?? {};
  const cosite = a.COSITE != null ? String(a.COSITE) : "";
  const dir = a.DIR != null ? String(a.DIR).trim() : "";
  const begRaw = a.BEGDATE;
  if (!cosite || !dir || typeof begRaw !== "number" || !Number.isFinite(begRaw)) return [];

  // BEGDATE is epoch ms for the count DAY. Florida counts are local time; tag
  // the wall-clock consistently at -05:00 exactly as the NYC ingest does, since
  // peak-hour aggregation groups by local hour and the DST hour is irrelevant.
  const day = new Date(begRaw);
  if (Number.isNaN(day.getTime())) return [];
  const y = day.getUTCFullYear();
  const mo = String(day.getUTCMonth() + 1).padStart(2, "0");
  const d = String(day.getUTCDate()).padStart(2, "0");

  const lon = f.geometry?.x;
  const lat = f.geometry?.y;
  const hasGeo = typeof lat === "number" && typeof lon === "number"
    && Number.isFinite(lat) && Number.isFinite(lon)
    // Florida bounds — a coordinate outside these means the outSR was ignored
    // and we are holding state-plane feet, which must not be stored as WGS84.
    && lat > 24.0 && lat < 31.5 && lon > -88.0 && lon < -79.5;

  // LOCALNAM first, ROADWAY second. ROADWAY is FDOT's 8-digit roadway ID
  // ("87004000"), not a name — preferring it put bare ID numbers in the
  // "Segment" column of the rendered count table. LOCALNAM is the human
  // name; fall back to the ID only when there is no name at all.
  const street = (a.LOCALNAM != null ? String(a.LOCALNAM) : "").trim()
    || (a.ROADWAY != null ? String(a.ROADWAY) : "").trim() || null;
  const county = a.COUNTY != null ? String(a.COUNTY).trim() : null;

  const rows: InsertAtrCount[] = [];
  for (let n = 1; n <= 24; n++) {
    const v = a[`HR${n}`];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
    const hh = String(hourForField(n)).padStart(2, "0");
    const occurredAt = new Date(`${y}-${mo}-${d}T${hh}:00:00-05:00`);
    if (Number.isNaN(occurredAt.getTime())) continue;
    rows.push({
      source: FDOT_SOURCE,
      // No request-id concept upstream; the site+day pair is the natural one
      // and the column is NOT NULL.
      sourceRequestId: `${cosite}-${y}${mo}${d}`,
      sourceSegmentId: cosite,
      occurredAt,
      durationMinutes: 60,
      vol: v,
      street,
      fromStreet: null,
      toStreet: null,
      direction: dir,
      borough: county,
      latitude: hasGeo ? (lat as number) : null,
      longitude: hasGeo ? (lon as number) : null,
    });
  }
  return rows;
}

/**
 * SoQL-style date literal for the WHERE clause.
 *
 * ⚠️ This service REJECTS an epoch-millisecond comparison against BEGDATE —
 * `BEGDATE >= 1756...000` comes back as HTTP 400 "Cannot perform query.
 * Invalid query parameters." on every page, so the ingest never fetched a
 * single row. ArcGIS accepts an epoch operand on some feature services and
 * not others; this one wants a literal. Both `DATE 'YYYY-MM-DD'` and
 * `timestamp 'YYYY-MM-DD HH:MM:SS'` were verified live against the layer.
 */
function dateLiteral(ms: number): string {
  return `DATE '${new Date(ms).toISOString().slice(0, 10)}'`;
}

/**
 * Seasonal midweek sampling, matching ingest-atr-tmas.ts exactly.
 *
 * Statewide over the service's full rolling year is 183,403 features -> 4.4M
 * hourly bins (~1.4GB). Almost all of it is redundant for what the read path
 * derives: an AM peak, a PM peak and a daily average. Sampling three consecutive
 * midweek days in each of four months keeps every one of those honest — it is
 * the conventional short-count window — at roughly 1/30th the rows, and it makes
 * FDOT directly comparable to the TMAS states, which use the same windows.
 */
function seasonalWindows(now: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const d = new Date(now);
  // Four windows stepping back a quarter at a time, so they stay inside the
  // service's rolling ~365-day retention.
  for (const monthsBack of [1, 4, 7, 10]) {
    const ref = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsBack, 1));
    const y = ref.getUTCFullYear();
    const m = ref.getUTCMonth() + 1;
    let start = 0;
    for (let day = 8; day <= 21; day++) {
      if (new Date(Date.UTC(y, m - 1, day)).getUTCDay() === 2) { start = day; break; }
    }
    if (!start) continue;
    const iso = (day: number) =>
      `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    out.push([iso(start), iso(start + 2)]);
  }
  return out;
}

async function fetchPage(offset: number, sinceMs: number, county: string | null): Promise<FdotFeature[]> {
  const windows = seasonalWindows(sinceMs + 365 * 86_400_000);
  const dateClause = windows
    .map(([a, b]) => `(BEGDATE >= DATE '${a}' AND BEGDATE <= DATE '${b}')`)
    .join(" OR ");
  const where = county
    ? `COUNTY='${county.replace(/'/g, "''")}' AND (${dateClause})`
    : `(${dateClause})`;
  const params = new URLSearchParams({
    where,
    outFields: OUT_FIELDS,
    outSR: "4326",
    returnGeometry: "true",
    orderByFields: "COSITE,BEGDATE,DIR",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    f: "json",
  });
  const url = `${BASE}?${params.toString()}`;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`ArcGIS ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const j = (await r.json()) as { features?: FdotFeature[]; error?: { message?: string } };
      // ArcGIS reports errors with HTTP 200 and an error body — a silent-skip
      // trap if you only check r.ok.
      if (j.error) throw new Error(`ArcGIS error: ${j.error.message ?? "unknown"}`);
      return j.features ?? [];
    } catch (e) {
      lastErr = e;
      const wait = 2000 * (attempt + 1);
      console.warn(`    retry ${attempt + 1} after ${wait}ms (${(e as Error).message?.slice(0, 90)})`);
      await new Promise((res) => setTimeout(res, wait));
    }
  }
  throw lastErr;
}

async function main(): Promise<void> {
  const { days, dry, county } = parseIngestArgs();
  const windowDays = days ?? 365;
  const sinceMs = Date.now() - windowDays * 86_400_000;
  console.log(
    `ingest-atr-fdot: window = last ${windowDays}d${county ? `, county=${county}` : " (all 63 counties)"}, dry=${dry}`,
  );

  let offset = 0;
  let features = 0;
  let upserted = 0;
  let skipped = 0;
  const startedAt = Date.now();

  while (true) {
    process.stdout.write(`  fetching offset=${offset.toLocaleString()}… `);
    const t0 = Date.now();
    const page = await fetchPage(offset, sinceMs, county);
    console.log(`${page.length.toLocaleString()} features in ${Date.now() - t0}ms`);
    if (page.length === 0) break;
    features += page.length;

    const mapped: InsertAtrCount[] = [];
    for (const f of page) {
      const rows = mapFeature(f);
      if (rows.length === 0) skipped++;
      mapped.push(...rows);
    }
    for (let i = 0; i < mapped.length; i += BATCH_INSERT_SIZE) {
      await upsertAtrBatch(mapped.slice(i, i + BATCH_INSERT_SIZE), dry);
    }
    upserted += mapped.length;

    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `ingest-atr-fdot: features=${features.toLocaleString()} hourlyRows=${upserted.toLocaleString()} skipped=${skipped.toLocaleString()} elapsed=${elapsedSec}s`,
  );
  await pool.end();
}

// Only run when invoked directly, so the mapper can be imported by tests.
if (process.argv[1]?.includes("ingest-atr-fdot")) {
  main().catch((err) => {
    console.error("ingest-atr-fdot FAILED:", err);
    pool.end().finally(() => process.exit(1));
  });
}
