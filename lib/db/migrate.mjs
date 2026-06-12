/**
 * Minimal idempotent migration runner.
 *
 * Drizzle-kit is a dev dependency and isn't shipped in the Railway
 * runtime image, so `drizzle-kit push` can't run there. Instead this
 * script applies known-missing additive schema changes using `pg`
 * (which IS a runtime dep) and `ALTER TABLE ... ADD COLUMN IF NOT
 * EXISTS ...`, which is idempotent — re-running on an up-to-date
 * database is a no-op.
 *
 * Wired into the root `start` script so every Railway deploy applies
 * pending migrations before booting the web service. Failures are
 * intentionally fatal: the API will throw on the same queries during
 * normal operation if the schema is stale, so failing fast at startup
 * is preferable to a half-working deploy that 500s every request.
 *
 * Add new ALTER statements at the bottom as new columns/tables ship.
 * Keep everything ADD-IF-NOT-EXISTS or CREATE-IF-NOT-EXISTS — this
 * file should never DROP or rename in place. For schema reductions,
 * use the full drizzle-kit migration flow against a maintenance window.
 *
 * Plain .mjs (not .ts) so it runs via `node` directly without needing
 * tsx / esbuild in the Railway runtime image.
 *
 * Run: node lib/db/migrate.mjs
 */

import pg from "pg";

const { Pool } = pg;

const SQL_STATEMENTS = [
  {
    id: "firms.region_code",
    sql: `ALTER TABLE firms ADD COLUMN IF NOT EXISTS region_code VARCHAR(32) NOT NULL DEFAULT 'atlanta_metro';`,
  },
  {
    id: "tis_projects.region_code",
    sql: `ALTER TABLE tis_projects ADD COLUMN IF NOT EXISTS region_code VARCHAR(32) NOT NULL DEFAULT 'atlanta_metro';`,
  },
  // crashes — per-crash records ingested from public state/city open-data
  // feeds. Powers the §4/§5 crash-analysis section of state-specific TIS
  // PDFs. See lib/db/src/schema/crashes.ts for column documentation.
  {
    id: "crashes.create",
    sql: `CREATE TABLE IF NOT EXISTS crashes (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      severity TEXT NOT NULL,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      location_precision TEXT NOT NULL,
      municipality TEXT,
      county TEXT,
      on_street TEXT,
      cross_street TEXT,
      manner_of_collision TEXT,
      lighting TEXT,
      weather TEXT,
      surface TEXT,
      num_vehicles INTEGER,
      pedestrian_involved BOOLEAN NOT NULL DEFAULT FALSE,
      cyclist_involved BOOLEAN NOT NULL DEFAULT FALSE,
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT crashes_severity_valid CHECK (severity IN ('K','A','B','C','O','UNKNOWN')),
      CONSTRAINT crashes_location_precision_valid CHECK (location_precision IN ('precise','approximate','segment')),
      CONSTRAINT crashes_precise_has_coords CHECK (
        location_precision != 'precise' OR (latitude IS NOT NULL AND longitude IS NOT NULL)
      )
    );`,
  },
  { id: "crashes.idx_unique",   sql: `CREATE UNIQUE INDEX IF NOT EXISTS crashes_source_record_unique ON crashes (source, source_record_id);` },
  { id: "crashes.idx_spatial",  sql: `CREATE INDEX IF NOT EXISTS crashes_spatial ON crashes (latitude, longitude);` },
  { id: "crashes.idx_occurred", sql: `CREATE INDEX IF NOT EXISTS crashes_occurred ON crashes (occurred_at);` },
  { id: "crashes.idx_approx",   sql: `CREATE INDEX IF NOT EXISTS crashes_approx_match ON crashes (municipality, on_street);` },
  // atr_counts — per-15-min volume bins from Automated Traffic Recorder
  // (ATR) feeds. Replaces inferred AADT × K × D peak-hour estimation in
  // §3 / §3.2 of state TIS PDFs with measured directional segment
  // volumes. See lib/db/src/schema/atr-counts.ts for column docs.
  {
    id: "atr_counts.create",
    sql: `CREATE TABLE IF NOT EXISTS atr_counts (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      source_request_id TEXT NOT NULL,
      source_segment_id TEXT NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      duration_minutes INTEGER NOT NULL DEFAULT 15,
      vol INTEGER NOT NULL,
      street TEXT,
      from_street TEXT,
      to_street TEXT,
      direction TEXT,
      borough TEXT,
      latitude DOUBLE PRECISION,
      longitude DOUBLE PRECISION,
      ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`,
  },
  { id: "atr_counts.idx_uniq",    sql: `CREATE UNIQUE INDEX IF NOT EXISTS atr_counts_uniq ON atr_counts (source, source_segment_id, direction, occurred_at);` },
  { id: "atr_counts.idx_spatial", sql: `CREATE INDEX IF NOT EXISTS atr_counts_spatial ON atr_counts (latitude, longitude);` },
  { id: "atr_counts.idx_segment", sql: `CREATE INDEX IF NOT EXISTS atr_counts_segment ON atr_counts (source_segment_id, direction, occurred_at);` },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[migrate] DATABASE_URL not set — skipping migrations");
    return;
  }
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const stmt of SQL_STATEMENTS) {
      const start = Date.now();
      try {
        await pool.query(stmt.sql);
        console.log(`[migrate] ${stmt.id}: ok (${Date.now() - start}ms)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Tables can legitimately not exist on the very first deploy of
        // a fresh DB — log + skip rather than abort, since drizzle-orm
        // will create them via its own initialization on first connect.
        if (/relation .* does not exist/.test(msg)) {
          console.log(`[migrate] ${stmt.id}: target table missing, skipping (${msg})`);
          continue;
        }
        throw err;
      }
    }
    console.log("[migrate] all migrations applied");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] fatal:", err);
  process.exit(1);
});
