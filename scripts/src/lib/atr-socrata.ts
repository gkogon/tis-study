/**
 * Source-agnostic Socrata ingest for ATR (Automated Traffic Recorder) counts.
 *
 * `ingest-atr-nyc.ts` was the first and only count ingest, and every piece of it
 * except ~40 lines of row-mapping was generic: paginate a Socrata resource,
 * map rows, dedupe within the batch, upsert idempotently. The `atr_counts`
 * schema was already built for many sources — it carries a `source` column and
 * a configurable `durationMinutes`, and normalizes every location to WGS84 at
 * ingest precisely so sources with different native projections can coexist.
 *
 * So adding a metro should be a mapper, not a script. This is that split: the
 * loop lives here, each city supplies an `AtrSocrataSource`.
 *
 * The behaviour here is a faithful extraction of the NYC script — same page
 * size, same 3-attempt backoff, same within-batch dedupe (Postgres cannot
 * resolve two conflicting rows in one INSERT), same ON CONFLICT update set.
 * Nothing about NYC's output changes.
 */
import { type InsertAtrCount } from "@workspace/db";
import { BATCH_INSERT_SIZE, dedupeBatch, upsertAtrBatch } from "./atr-upsert";

export const DEFAULT_PAGE_SIZE = 50_000;
export { BATCH_INSERT_SIZE, dedupeBatch };

export type AtrSocrataSource<Raw> = {
  /** Value written to the `source` column. Stable — it is part of the
   *  idempotency key, so changing it re-ingests rather than updates. */
  id: string;
  /** Human label for logs. */
  label: string;
  /** e.g. "data.cityofnewyork.us" */
  host: string;
  /** Socrata 4x4 resource id, e.g. "7ym2-wayt". */
  dataset: string;
  /** SoQL $where for the requested year window. Sources differ: some carry a
   *  numeric `yr` column, others a real date. */
  whereForYears: (sinceYear: number) => string;
  /** SoQL $order. Must be a stable total order or offset paging skips rows. */
  order: string;
  /** Raw Socrata row -> insert row, or null to skip (counted, never silent). */
  mapRow: (raw: Raw) => InsertAtrCount | null;
  pageSize?: number;
};

export type IngestStats = {
  fetched: number;
  upserted: number;
  skipped: number;
  elapsedSec: string;
};

export { parseIngestArgs } from "./atr-upsert";

async function fetchPage<Raw>(
  src: AtrSocrataSource<Raw>,
  offset: number,
  sinceYear: number,
): Promise<Raw[]> {
  const pageSize = src.pageSize ?? DEFAULT_PAGE_SIZE;
  const params = new URLSearchParams({
    $where: src.whereForYears(sinceYear),
    $order: src.order,
    $limit: String(pageSize),
    $offset: String(offset),
  });
  const headers: Record<string, string> = {};
  if (process.env.SOCRATA_APP_TOKEN) headers["X-App-Token"] = process.env.SOCRATA_APP_TOKEN;

  // Socrata routinely resets long-running connections under load; three
  // attempts with linear backoff has proven sufficient at these dataset sizes.
  const url = `https://${src.host}/resource/${src.dataset}.json?${params.toString()}`;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) {
        throw new Error(`Socrata ${r.status}: ${await r.text().then((t) => t.slice(0, 200))}`);
      }
      return (await r.json()) as Raw[];
    } catch (e) {
      lastErr = e;
      const wait = 2000 * (attempt + 1);
      console.warn(`    retry ${attempt + 1} after ${wait}ms (${(e as Error).message?.slice(0, 80)})`);
      await new Promise((res) => setTimeout(res, wait));
    }
  }
  throw lastErr;
}

export async function runAtrIngest<Raw>(
  src: AtrSocrataSource<Raw>,
  opts: { years: number; dry: boolean },
): Promise<IngestStats> {
  const pageSize = src.pageSize ?? DEFAULT_PAGE_SIZE;
  const sinceYear = new Date().getUTCFullYear() - opts.years;
  console.log(
    `${src.label}: window = ${src.whereForYears(sinceYear)} (last ${opts.years}y), dry=${opts.dry}`,
  );

  let offset = 0;
  let fetched = 0;
  let upserted = 0;
  let skipped = 0;
  const startedAt = Date.now();

  while (true) {
    process.stdout.write(`  fetching offset=${offset.toLocaleString()}… `);
    const t0 = Date.now();
    const page = await fetchPage(src, offset, sinceYear);
    console.log(`${page.length.toLocaleString()} rows in ${Date.now() - t0}ms`);
    if (page.length === 0) break;
    fetched += page.length;

    const mapped: InsertAtrCount[] = [];
    for (const r of page) {
      const m = src.mapRow(r);
      if (m) mapped.push(m);
      else skipped++;
    }
    for (let i = 0; i < mapped.length; i += BATCH_INSERT_SIZE) {
      await upsertAtrBatch(mapped.slice(i, i + BATCH_INSERT_SIZE), opts.dry);
    }
    upserted += mapped.length;

    if (page.length < pageSize) break;
    offset += pageSize;
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `${src.label}: fetched=${fetched.toLocaleString()} upserted=${upserted.toLocaleString()} skipped=${skipped.toLocaleString()} elapsed=${elapsedSec}s`,
  );
  return { fetched, upserted, skipped, elapsedSec };
}
