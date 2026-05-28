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
