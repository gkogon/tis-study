/**
 * Shared DB write path for every ATR count ingest, whatever the upstream API.
 *
 * Split out of atr-socrata.ts once a second transport arrived: FDOT publishes
 * hourly counts over ArcGIS, not Socrata. The pagination and row shape differ
 * per source; the dedupe and upsert do not.
 */
import { sql } from "drizzle-orm";
import { db, atrCountsTable, type InsertAtrCount } from "@workspace/db";

export const BATCH_INSERT_SIZE = 1_000;

/**
 * Dedupe within a batch. Postgres ON CONFLICT cannot resolve two rows that
 * collide with each other inside one INSERT ("cannot affect row a second
 * time"), and sources do publish overlapping sessions for the same
 * (segment, direction, timestamp). Last wins.
 */
export function dedupeBatch(rows: InsertAtrCount[]): InsertAtrCount[] {
  const seen = new Map<string, InsertAtrCount>();
  for (const r of rows) {
    const k = `${r.source}|${r.sourceSegmentId}|${r.direction}|${r.occurredAt.toISOString()}`;
    seen.set(k, r);
  }
  return Array.from(seen.values());
}

export async function upsertAtrBatch(rows: InsertAtrCount[], dry: boolean): Promise<void> {
  if (rows.length === 0 || dry) return;
  await db
    .insert(atrCountsTable)
    .values(dedupeBatch(rows))
    .onConflictDoUpdate({
      target: [
        atrCountsTable.source,
        atrCountsTable.sourceSegmentId,
        atrCountsTable.direction,
        atrCountsTable.occurredAt,
      ],
      // Sources republish corrected counts; the unique key means an update,
      // never a duplicate.
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

export function parseIngestArgs(argv: string[] = process.argv.slice(2)): {
  years: number;
  days: number | null;
  dry: boolean;
  county: string | null;
} {
  let years = 3;
  let days: number | null = null;
  let dry = false;
  let county: string | null = null;
  for (const a of argv) {
    if (a === "--dry") dry = true;
    else if (a.startsWith("--years=")) years = Math.max(1, Math.min(20, Number(a.slice(8))));
    else if (a.startsWith("--days=")) days = Math.max(1, Math.min(400, Number(a.slice(7))));
    else if (a.startsWith("--county=")) county = a.slice(9);
  }
  return { years, days, dry, county };
}
