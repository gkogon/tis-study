import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { firmsTable } from "./firms";
import { tisProjectsTable } from "./tis-projects";

/**
 * One proofread pass over one saved study
 * (docs/superpowers/specs/2026-09-29-datum-in-product-design.md).
 *
 * A run is a pure function of the tis_projects row it points at, so it is
 * re-runnable and auditable without the engine. Nothing here writes back to
 * the study: Datum advises, it never edits. A re-run is a new revision, so an
 * earlier pass stays readable.
 */
export const studyProofreadRunsTable = pgTable(
  "study_proofread_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // Findings only mean something against one study snapshot, so they die with it.
    projectId: uuid("project_id")
      .notNull()
      .references(() => tisProjectsTable.id, { onDelete: "cascade" }),
    // Derivable from the project, carried anyway: every read is firm-scoped,
    // and tis_projects.firmId is nullable on legacy rows.
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    // 'queued' → claimed → 'running' → 'rules_ready' (deterministic clauses done;
    // the terminal state in phase 1) → 'ready' (phase 2 judgment pass done) |
    // 'failed' (attempts exhausted).
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    protocolVersion: varchar("protocol_version", { length: 32 }).notNull(),
    rulesVersion: varchar("rules_version", { length: 32 }).notNull(),
    // Which engine produced the study this run judged. Nothing in the payload
    // records it, so a finding could not otherwise be attributed.
    engineStamp: varchar("engine_stamp", { length: 64 }).notNull(),
    // Which declared inputs were present on the record, so partial coverage on
    // a historical study is a stated fact rather than a silent pass.
    inputManifest: jsonb("input_manifest").notNull(),
    // Per-clause ran / not-run + reason. Never per-section: only two of the six
    // protocol sections are fully checkable from a saved record.
    coverage: jsonb("coverage").notNull(),
    model: varchar("model", { length: 64 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    attempts: integer("attempts").notNull().default(0),
    // A claim is a lease: a row whose claim is older than the lease is
    // reclaimable, which is what recovers a container recycled mid-run.
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimedBy: varchar("claimed_by", { length: 64 }),
    error: text("error"),
    requestedByUserId: varchar("requested_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    // UNIQUE, not a plain index: the revision is derived in SQL (see
    // insertQueuedRun) and two concurrent re-run requests must not both land
    // revision N — a duplicate would make `orderBy(desc(revision)).limit(1)`
    // nondeterministic and split one study's findings across two rows.
    uniqueIndex("UQ_study_proofread_runs_project_revision").on(table.projectId, table.revision),
    index("IDX_study_proofread_runs_status").on(table.status, table.createdAt),
  ],
);

export type StudyProofreadRun = typeof studyProofreadRunsTable.$inferSelect;
export type InsertStudyProofreadRun = typeof studyProofreadRunsTable.$inferInsert;

/**
 * One finding. `sourceLabel` and `readPaths` are NOT NULL on purpose: a finding
 * with no named source is an opinion, not a finding. There is no patch column —
 * `remedy` is prose for a person to act on.
 */
export const studyProofreadFindingsTable = pgTable(
  "study_proofread_findings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    runId: uuid("run_id")
      .notNull()
      .references(() => studyProofreadRunsTable.id, { onDelete: "cascade" }),
    clauseId: varchar("clause_id", { length: 64 }).notNull(),
    section: smallint("section").notNull(),
    // BLOCKER | DEFECT | DISCLOSE | NOTE | UNVERIFIED | CONTESTED
    type: varchar("type", { length: 12 }).notNull(),
    // 'rule' in phase 1; 'model' once the judgment pass ships.
    origin: varchar("origin", { length: 8 }).notNull().default("rule"),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    sourceLabel: text("source_label").notNull(),
    readPaths: jsonb("read_paths").notNull(),
    remedy: text("remedy").notNull(),
    // engineer | pe | admin. DEFECT is admin: a PE cannot rule on a software fault.
    audience: varchar("audience", { length: 12 }).notNull().default("engineer"),
    // hash32(clauseId | section | sorted readPaths) — the key a disposition
    // carries forward across a re-run.
    fingerprint: varchar("fingerprint", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("IDX_study_proofread_findings_run").on(table.runId),
    index("IDX_study_proofread_findings_fingerprint").on(table.fingerprint),
    // A retried run re-derives the same findings. The unique key plus
    // onConflictDoNothing makes the insert idempotent instead of duplicating
    // every finding on the second attempt.
    uniqueIndex("UQ_study_proofread_findings_run_fp").on(table.runId, table.fingerprint),
  ],
);

export type StudyProofreadFinding = typeof studyProofreadFindingsTable.$inferSelect;
export type InsertStudyProofreadFinding = typeof studyProofreadFindingsTable.$inferInsert;

/**
 * Append-only triage log. The current disposition of a finding is its latest
 * row. Append-only because ACCEPTED_RISK has to record who accepted it and
 * when — a mutable status column loses exactly that.
 */
export const studyProofreadDispositionsTable = pgTable(
  "study_proofread_dispositions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => studyProofreadFindingsTable.id, { onDelete: "cascade" }),
    // FIXED | BUG_FILED | DISCLOSED | WITHDRAWN | CONTESTED_PE | ACCEPTED_RISK
    disposition: varchar("disposition", { length: 16 }).notNull(),
    note: text("note"),
    // Required for WITHDRAWN: Datum withdraws on a source, never on an argument.
    sourceLabel: text("source_label"),
    actorUserId: varchar("actor_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index("IDX_study_proofread_dispositions_finding").on(table.findingId, table.createdAt)],
);

export type StudyProofreadDisposition = typeof studyProofreadDispositionsTable.$inferSelect;
export type InsertStudyProofreadDisposition = typeof studyProofreadDispositionsTable.$inferInsert;
