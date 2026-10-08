/**
 * Persistence for proofread runs. Separate from src/lib/proofread/, which must
 * stay importable under plain node — this module imports @workspace/db, which
 * throws at module evaluation when DATABASE_URL is unset.
 *
 * Every read is firm-scoped in its WHERE clause; there is no middleware that
 * does it, and a findings read by project id alone would leak across firms.
 */
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  db,
  studyProofreadDispositionsTable,
  studyProofreadFindingsTable,
  studyProofreadRunsTable,
  tisProjectsTable,
  type StudyProofreadRun,
} from "@workspace/db";
import { logger } from "./logger";
import { CLAIM_PREDICATE_SQL } from "./proofread/lifecycle.ts";
import type { ProofreadFinding } from "./proofread/index.ts";
import { findingFingerprint } from "./proofread/index.ts";

export async function insertQueuedRun(args: {
  projectId: string;
  firmId: string;
  userId: string;
  protocolVersion: string;
  rulesVersion: string;
  engineStamp: string;
}): Promise<StudyProofreadRun | null> {
  // The revision is derived inside the INSERT so the read and the write are one
  // statement. Read-then-insert would let two quick presses of "Run again" both
  // read the same max and both write revision N; the (project_id, revision)
  // unique key then rejects the loser instead of silently duplicating it.
  const [row] = await db
    .insert(studyProofreadRunsTable)
    .values({
      projectId: args.projectId,
      firmId: args.firmId,
      revision: sql`(SELECT coalesce(max(revision), 0) + 1 FROM study_proofread_runs WHERE project_id = ${args.projectId})`,
      status: "queued",
      protocolVersion: args.protocolVersion,
      rulesVersion: args.rulesVersion,
      engineStamp: args.engineStamp,
      inputManifest: {},
      coverage: [],
      requestedByUserId: args.userId,
    })
    .returning();
  return row ?? null;
}

/**
 * Claim one queued or lease-expired row for this instance. Null when there is
 * nothing to do.
 *
 * Goes through the query builder, NOT `db.execute(sql.raw(...))`: `execute`
 * passes no field map (drizzle pg-core `db.js` → `prepareQuery(builtQuery,
 * void 0, ...)`), so a raw `RETURNING *` comes back keyed by the literal
 * Postgres column names. The repo's only other raw query types its result in
 * snake_case for exactly that reason (`src/lib/atr-counts.ts:408`). A cast to
 * the camelCase `$inferSelect` shape would type-check and then hand every
 * caller `projectId: undefined`. `.returning()` maps the columns properly, and
 * binding `claimedBy` as a parameter also removes the string interpolation the
 * raw form needed.
 *
 * The predicate is CLAIM_PREDICATE_SQL, interpolated verbatim: a queued row, or
 * a running row whose lease has expired.
 */
export async function claimOneRun(instanceId: string): Promise<StudyProofreadRun | null> {
  const [row] = await db
    .update(studyProofreadRunsTable)
    .set({
      status: "running",
      // The DATABASE's clock, not this instance's. Several instances claim from
      // one table and their clocks do not agree; a lease measured against a
      // skewed local clock expires early on one box and late on another. It is
      // set in the SAME .set() as the status, so a requeued row can never keep
      // an expired timestamp beside a fresh status for the next sweep to steal.
      claimedAt: sql`now()`,
      claimedBy: instanceId,
      attempts: sql`${studyProofreadRunsTable.attempts} + 1`,
    })
    .where(
      // The predicate is NOT restated here. `CLAIM_PREDICATE_SQL` is exported by
      // lifecycle.ts, `CLAIM_SQL` is composed from it, and the clause suite pins
      // it against `isReclaimable` — so using it here makes the pinned predicate
      // and the production predicate the same text by construction. Three copies
      // with two of them pinned is how a lease silently diverges.
      sql`${studyProofreadRunsTable.id} = (
        SELECT id FROM study_proofread_runs
         WHERE ${sql.raw(CLAIM_PREDICATE_SQL)}
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )`,
    )
    .returning();
  return row ?? null;
}

export async function loadStudyForRun(run: StudyProofreadRun) {
  const [row] = await db
    .select({ request: tisProjectsTable.requestPayload, result: tisProjectsTable.resultPayload })
    .from(tisProjectsTable)
    .where(and(eq(tisProjectsTable.id, run.projectId), eq(tisProjectsTable.firmId, run.firmId)))
    .limit(1);
  return row ?? null;
}

/**
 * Write a run's outcome. Safe to call twice for the same run: a requeue after
 * a partial success must not duplicate findings, and must not erase the
 * coverage the successful clause pass already recorded.
 *
 * `status: "running"` is the first half of a two-step finish: it writes what
 * the pass produced — coverage, manifest, findings — and LEAVES the row
 * claimed, so the carry-forward can run before any other instance can see this
 * revision as the newest 'rules_ready' one. Flipping the status first opens a
 * window in which a re-run claimed inside it picks THIS revision as its
 * `previous`, finds no dispositions on it yet, and loses the previous
 * revision's WITHDRAWN permanently — on an append-only log there is no
 * recovering it. The runner flips the status in a second call, after the carry.
 */
export async function completeRun(args: {
  runId: string;
  status: "running" | "rules_ready" | "failed" | "queued";
  coverage?: unknown;
  inputManifest?: unknown;
  findings: ProofreadFinding[];
  error?: string;
}): Promise<void> {
  await db
    .update(studyProofreadRunsTable)
    .set({
      status: args.status,
      // Omitted on a requeue: the previous attempt's coverage is better than {}.
      ...(args.coverage === undefined ? {} : { coverage: args.coverage as object }),
      ...(args.inputManifest === undefined ? {} : { inputManifest: args.inputManifest as object }),
      error: args.error ?? null,
      // Only a terminal status finishes the row: a requeue clears it, and the
      // first half of the two-step finish has not finished anything yet.
      finishedAt: args.status === "rules_ready" || args.status === "failed" ? new Date() : null,
    })
    .where(eq(studyProofreadRunsTable.id, args.runId));
  if (args.findings.length === 0) return;
  await db
    .insert(studyProofreadFindingsTable)
    .values(
      args.findings.map((f) => ({
        runId: args.runId,
        clauseId: f.clauseId,
        section: f.section,
        type: f.type,
        origin: "rule" as const,
        title: f.title,
        detail: f.detail,
        sourceLabel: f.sourceLabel,
        readPaths: f.readPaths as unknown as object,
        remedy: f.remedy,
        audience: f.audience,
        fingerprint: findingFingerprint(f),
      })),
    )
    .onConflictDoNothing({
      target: [studyProofreadFindingsTable.runId, studyProofreadFindingsTable.fingerprint],
    });
}

export async function latestRunForProject(firmId: string, projectId: string) {
  const [run] = await db
    .select()
    .from(studyProofreadRunsTable)
    .where(and(eq(studyProofreadRunsTable.firmId, firmId), eq(studyProofreadRunsTable.projectId, projectId)))
    .orderBy(desc(studyProofreadRunsTable.revision))
    .limit(1);
  if (!run) return null;
  const findings = await db
    .select()
    .from(studyProofreadFindingsTable)
    .where(eq(studyProofreadFindingsTable.runId, run.id));
  // Scoped in SQL, not filtered in JS: this is the read the panel polls, and
  // an unbounded select over every firm's triage rows grows with the table.
  // Uses the (finding_id, created_at) index.
  const dispositions = findings.length
    ? await db
        .select()
        .from(studyProofreadDispositionsTable)
        .where(
          inArray(
            studyProofreadDispositionsTable.findingId,
            findings.map((f) => f.id),
          ),
        )
        .orderBy(desc(studyProofreadDispositionsTable.createdAt))
    : [];
  return { run, findings, dispositions };
}

/** The run before `revision` on this project, with the rules version it ran under — the source of a carry-forward. */
export async function previousRunForProject(
  projectId: string,
  beforeRevision: number,
): Promise<{ id: string; rulesVersion: string } | null> {
  const [row] = await db
    .select({ id: studyProofreadRunsTable.id, rulesVersion: studyProofreadRunsTable.rulesVersion })
    .from(studyProofreadRunsTable)
    .where(
      and(
        eq(studyProofreadRunsTable.projectId, projectId),
        lt(studyProofreadRunsTable.revision, beforeRevision),
        // Only a run that finished its clause pass holds dispositions worth
        // carrying. A failed or still-queued revision would carry nothing and,
        // because this looks exactly one revision back, would strand the
        // dispositions recorded on the revision before it.
        eq(studyProofreadRunsTable.status, "rules_ready"),
      ),
    )
    .orderBy(desc(studyProofreadRunsTable.revision))
    .limit(1);
  return row ?? null;
}

/** Carry dispositions forward to a new run by fingerprint, when both runs ran under the same rules version. */
export async function carryForwardDispositions(
  newRunId: string,
  previousRunId: string,
  sameRules: boolean,
): Promise<number> {
  if (!sameRules) return 0;
  const [oldF, newF] = await Promise.all([
    db.select().from(studyProofreadFindingsTable).where(eq(studyProofreadFindingsTable.runId, previousRunId)),
    db.select().from(studyProofreadFindingsTable).where(eq(studyProofreadFindingsTable.runId, newRunId)),
  ]);
  let carried = 0;
  for (const nf of newF) {
    const match = oldF.find((of) => of.fingerprint === nf.fingerprint);
    if (!match) continue;
    const prior = await db
      .select()
      .from(studyProofreadDispositionsTable)
      .where(eq(studyProofreadDispositionsTable.findingId, match.id))
      .orderBy(desc(studyProofreadDispositionsTable.createdAt))
      .limit(1);
    if (!prior[0]) continue;
    // Idempotent: a re-claimed run re-derives the same findings, and this would
    // otherwise append the carried disposition again on every pass. An
    // append-only log makes a duplicate permanent.
    const [already] = await db
      .select({ id: studyProofreadDispositionsTable.id })
      .from(studyProofreadDispositionsTable)
      .where(
        and(
          eq(studyProofreadDispositionsTable.findingId, nf.id),
          eq(studyProofreadDispositionsTable.disposition, prior[0].disposition),
        ),
      )
      .limit(1);
    if (already) continue;
    // The decision keeps the date it was MADE. Left to the column default, a
    // carried row is dated by the re-run, and the panel reports a decision on
    // a day nobody made it — permanently, on an append-only log.
    await db.insert(studyProofreadDispositionsTable).values({
      findingId: nf.id,
      disposition: prior[0].disposition,
      note: prior[0].note,
      sourceLabel: prior[0].sourceLabel,
      actorUserId: prior[0].actorUserId,
      createdAt: prior[0].createdAt,
    });
    carried++;
  }
  if (carried) logger.info({ newRunId, previousRunId, carried }, "proofread.dispositions_carried");
  return carried;
}

export async function insertDisposition(args: {
  findingId: string;
  disposition: string;
  note?: string;
  sourceLabel?: string;
  actorUserId: string;
}): Promise<void> {
  await db.insert(studyProofreadDispositionsTable).values({
    findingId: args.findingId,
    disposition: args.disposition,
    note: args.note ?? null,
    sourceLabel: args.sourceLabel ?? null,
    actorUserId: args.actorUserId,
  });
}

/** The URL asserts firm → project → run → finding; verify all of it in one query. */
export async function findingInFirmRun(
  firmId: string,
  projectId: string,
  runId: string,
  findingId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: studyProofreadFindingsTable.id })
    .from(studyProofreadFindingsTable)
    .innerJoin(studyProofreadRunsTable, eq(studyProofreadFindingsTable.runId, studyProofreadRunsTable.id))
    .where(
      and(
        eq(studyProofreadFindingsTable.id, findingId),
        eq(studyProofreadRunsTable.id, runId),
        eq(studyProofreadRunsTable.projectId, projectId),
        eq(studyProofreadRunsTable.firmId, firmId),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * The audience of a finding (engineer | pe | admin), scoped to the firm that
 * owns its run. Null when the finding is not the firm's or does not exist.
 *
 * Deliberately NOT a condition inside findingInFirmRun. That function answers
 * "does this finding belong to this firm's run of this project" — the
 * cross-tenant barrier — and this one answers "may the caller act on it", a
 * different question. A DEFECT is a software fault routed to the code queue;
 * a person outside admin cannot rule on one, so the write path asks this
 * after the chain has been verified. It returns null, never a default
 * audience: a default of 'engineer' would let an unknown finding pass the
 * test that exists to refuse the hidden ones.
 */
export async function findingAudienceForFirm(firmId: string, findingId: string): Promise<string | null> {
  const [row] = await db
    .select({ audience: studyProofreadFindingsTable.audience })
    .from(studyProofreadFindingsTable)
    .innerJoin(studyProofreadRunsTable, eq(studyProofreadFindingsTable.runId, studyProofreadRunsTable.id))
    .where(and(eq(studyProofreadFindingsTable.id, findingId), eq(studyProofreadRunsTable.firmId, firmId)))
    .limit(1);
  return row?.audience ?? null;
}
