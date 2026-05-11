import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { firmsTable } from "./firms";

/**
 * Per-firm project history. Every successful TIS generation writes a row
 * here so the engineer can re-open, re-print, or compare past studies. This
 * is the primary switching-cost moat: once a firm has 50+ projects under
 * one account, leaving the platform means losing the audit trail.
 *
 * `requestPayload` is the exact validated TisRequest the engine ran with.
 * `resultPayload` is the full TisReport bundle returned to the client.
 * Re-rendering a project is just `JSON.parse(resultPayload)` — no engine
 * re-run needed.
 */
export const tisProjectsTable = pgTable(
  "tis_projects",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // Engineer who ran the study. Kept on the row for audit / attribution.
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // Billing/ownership scope. Nullable for backwards-compatibility with
    // legacy rows; a one-shot backfill (scripts/backfill-firm-id.ts)
    // populates it and a later migration will set NOT NULL.
    firmId: uuid("firm_id").references(() => firmsTable.id, {
      onDelete: "cascade",
    }),
    projectName: text("project_name").notNull(),
    landUseCode: varchar("land_use_code", { length: 16 }).notNull(),
    landUseSize: text("land_use_size"), // serialized number; nullable so we don't lose a row to bad data
    siteLat: text("site_lat"),
    siteLon: text("site_lon"),
    requestPayload: jsonb("request_payload").notNull(),
    resultPayload: jsonb("result_payload").notNull(),
    // Sequential per-user version counter so engineers can talk about
    // "project 17 v2 vs v3". Nullable because legacy reports won't have it.
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("IDX_tis_projects_user_created").on(table.userId, table.createdAt),
    index("IDX_tis_projects_firm_created").on(table.firmId, table.createdAt),
  ],
);

export type TisProject = typeof tisProjectsTable.$inferSelect;
export type InsertTisProject = typeof tisProjectsTable.$inferInsert;
