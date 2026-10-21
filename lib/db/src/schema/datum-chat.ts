import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";
import { firmsTable } from "./firms";
import { studyProofreadFindingsTable } from "./study-proofread";
import { tisProjectsTable } from "./tis-projects";

/**
 * One row per study version the chat made
 * (docs/superpowers/specs/2026-10-20-datum-chat-design.md, "Data"). Append-only:
 * a version is never edited once written, so there is no updated_at, and the
 * log of who asked for what, and why, stays as it was.
 *
 * `projectId` is the NEW version and is unique: a version has at most one
 * revision row, and the unique index is also what stops two requests from
 * logging the same version. `fromProjectId` and `rootProjectId` are plain
 * uuids with no FK on purpose: they are history, and deleting an earlier
 * version must not delete (cascade) or blank (set null) the record of the
 * version made from it. The live pointers are on tis_projects.
 */
export const studyRevisionsTable = pgTable(
  "study_revisions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // The new version. A revision means nothing without its study, so it dies with it.
    projectId: uuid("project_id")
      .notNull()
      .references(() => tisProjectsTable.id, { onDelete: "cascade" }),
    fromProjectId: uuid("from_project_id").notNull(),
    rootProjectId: uuid("root_project_id").notNull(),
    // Derivable from the project, carried anyway: every read is firm-scoped,
    // and tis_projects.firmId is nullable on legacy rows.
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    // The engineer who asked; the new version's tis_projects.user_id is the same user.
    requestedByUserId: varchar("requested_by_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // The engineer's message that asked for it. No FK: the message and the
    // revision reference each other, and the message is written first.
    messageId: uuid("message_id"),
    // The finding the engineer asked about, if any. The finding can go; the log stays.
    findingId: uuid("finding_id").references(() => studyProofreadFindingsTable.id, { onDelete: "set null" }),
    clauseId: varchar("clause_id", { length: 64 }),
    // [{ field, from, to }]
    changes: jsonb("changes").notNull(),
    reason: text("reason").notNull(),
    sourceLabel: text("source_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [uniqueIndex("UQ_study_revisions_project").on(table.projectId)],
);

export type StudyRevision = typeof studyRevisionsTable.$inferSelect;
export type InsertStudyRevision = typeof studyRevisionsTable.$inferInsert;

/**
 * The chat thread, one per study version, shared by every firm member who can
 * open the study. `userId` is null for Datum's own messages (role 'datum').
 * Token counts and the stop reason are stored on every reply, so the firm's
 * 24-hour reply count and its spend can be read from this table alone.
 */
export const studyDatumMessagesTable = pgTable(
  "study_datum_messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => tisProjectsTable.id, { onDelete: "cascade" }),
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    // Null for Datum. If the user is deleted the message stays, unnamed.
    userId: varchar("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    // engineer | datum
    role: varchar("role", { length: 12 }).notNull(),
    content: text("content").notNull(),
    findingId: uuid("finding_id").references(() => studyProofreadFindingsTable.id, { onDelete: "set null" }),
    // Set on the Datum message that reports a re-run. No FK, for the reason on messageId above.
    revisionId: uuid("revision_id"),
    model: varchar("model", { length: 64 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    stopReason: varchar("stop_reason", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index("IDX_study_datum_messages_project").on(table.projectId, table.createdAt)],
);

export type StudyDatumMessage = typeof studyDatumMessagesTable.$inferSelect;
export type InsertStudyDatumMessage = typeof studyDatumMessagesTable.$inferInsert;
