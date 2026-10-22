/**
 * Stands in for lib/db/src/index.ts inside the harness bundle, and is the one place the bundled server's
 * connection comes from. The real module builds its pool from the environment; this one takes the throwaway
 * cluster's address, which run.mjs writes into the bundle at build time (esbuild `define`), so no code path in
 * the server reads the environment for a database. Otherwise the same: one pg Pool, one drizzle instance over
 * the real schema, and the schema re-exported.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@workspace/db/schema";

// eslint-disable-next-line no-undef -- replaced by run.mjs at build time
const connection = JSON.parse(__PROOFREAD_PG_HARNESS_CONNECTION__);

export const pool = new pg.Pool(connection);
export const db = drizzle(pool, { schema });

export * from "@workspace/db/schema";
