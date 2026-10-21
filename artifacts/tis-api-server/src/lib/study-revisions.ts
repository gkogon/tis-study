/**
 * Study versions made by the Datum chat: the one place a new version of a study
 * is written (docs/superpowers/specs/2026-10-20-datum-chat-design.md, "Data").
 *
 * Insert-only. Nothing here updates or deletes a tis_projects or
 * study_revisions row: a fix is a new row, and the version it was made from
 * stays exactly as it was. The one statement that touches an existing study
 * row is the FOR UPDATE on the lineage's first version, which takes a row
 * lock and writes nothing to the row itself.
 *
 * Every read and write is firm-scoped, like tis-projects.ts. A project of
 * another firm and a project that does not exist are the same NotFound.
 */
import { and, desc, eq, or, sql } from "drizzle-orm";
import { db, studyRevisionsTable, tisProjectsTable, usersTable } from "@workspace/db";
import { DATUM_LIMITS } from "@workspace/tis-api-zod";
import type { DatumChange, DatumChatReadResponse, DatumRevision } from "@workspace/tis-api-zod";
import { authorNameOf } from "./datum-chat/store";
import { LineageCapReached } from "./datum-chat/revise.ts";
import type { CreateRevisionArgs } from "./datum-chat/revise.ts";

export { LineageCapReached };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The project is not this firm's, or does not exist. The route answers it as a 404. */
export class NotFound extends Error {
  constructor(message = "Project not found.") {
    super(message);
    this.name = "NotFound";
  }
}

/** The arguments, as the re-run (lib/datum-chat/revise.ts) builds them: one type, written there. */
export type { CreateRevisionArgs };

/**
 * Save a re-run as a new version, and log what changed, in one transaction.
 *
 *   1. Read the parent within the firm (not found: throw NotFound).
 *   2. root = the parent's root, or the parent itself when it is the original.
 *   3. Lock the root row (FOR UPDATE). Every version of a lineage is made under
 *      this lock, so two requests on the same lineage take turns from here on.
 *   4. version = 1 + the highest version in the lineage. The lock is taken
 *      before this read, and under READ COMMITTED each statement reads the
 *      latest committed rows, so the second of two concurrent requests sees the
 *      first one's version and takes the next number. The same read counts the
 *      lineage: at DATUM_LIMITS.versionsPerLineage or more it throws
 *      LineageCapReached and nothing is inserted. The re-run checks the cap
 *      before the engine runs, but only this count, under the lock, holds when
 *      two members save on the same lineage at once.
 *   5. Insert the new study: the parent's name, study type, land use and size,
 *      site, region and report format, with revisedFromProjectId = the parent
 *      and rootProjectId = the root.
 *   6. Insert its study_revisions row.
 */
export async function createRevision(args: CreateRevisionArgs): Promise<{ projectId: string; version: number; revisionId: string }> {
  if (!UUID.test(args.parentId) || !UUID.test(args.firmId)) throw new NotFound();
  return db.transaction(async (tx) => {
    const [parent] = await tx
      .select({
        id: tisProjectsTable.id,
        rootProjectId: tisProjectsTable.rootProjectId,
        studyType: tisProjectsTable.studyType,
        projectName: tisProjectsTable.projectName,
        landUseCode: tisProjectsTable.landUseCode,
        landUseSize: tisProjectsTable.landUseSize,
        siteLat: tisProjectsTable.siteLat,
        siteLon: tisProjectsTable.siteLon,
        regionCode: tisProjectsTable.regionCode,
        reportThemeId: tisProjectsTable.reportThemeId,
      })
      .from(tisProjectsTable)
      .where(and(eq(tisProjectsTable.id, args.parentId), eq(tisProjectsTable.firmId, args.firmId)))
      .limit(1);
    if (!parent) throw new NotFound();

    const root = parent.rootProjectId ?? parent.id;
    const lockedRoot = await tx
      .select({ id: tisProjectsTable.id })
      .from(tisProjectsTable)
      .where(and(eq(tisProjectsTable.id, root), eq(tisProjectsTable.firmId, args.firmId)))
      .for("update");
    // The root went between the two reads (its later versions' root_project_id is then null): the lineage this
    // version would join no longer exists as it was read, so nothing is written.
    if (lockedRoot.length === 0) throw new NotFound("The study's first version was deleted while this re-run was saved.");

    // One read, one set: the highest version and the number of versions, over the lineage the lock guards.
    const [{ highest, size }] = await tx
      .select({ highest: sql<number | null>`max(${tisProjectsTable.version})`, size: sql<number>`count(*)::int` })
      .from(tisProjectsTable)
      .where(or(eq(tisProjectsTable.id, root), eq(tisProjectsTable.rootProjectId, root)));
    if (Number(size) >= DATUM_LIMITS.versionsPerLineage) throw new LineageCapReached();
    const version = Number(highest ?? 0) + 1;

    const [study] = await tx
      .insert(tisProjectsTable)
      .values({
        userId: args.userId,
        firmId: args.firmId,
        studyType: parent.studyType,
        projectName: parent.projectName,
        landUseCode: parent.landUseCode,
        landUseSize: parent.landUseSize,
        siteLat: parent.siteLat,
        siteLon: parent.siteLon,
        regionCode: parent.regionCode,
        reportThemeId: parent.reportThemeId,
        revisedFromProjectId: parent.id,
        rootProjectId: root,
        requestPayload: args.request as object,
        resultPayload: args.result as object,
        version,
      })
      .returning({ id: tisProjectsTable.id });

    const [revision] = await tx
      .insert(studyRevisionsTable)
      .values({
        projectId: study!.id,
        fromProjectId: parent.id,
        rootProjectId: root,
        firmId: args.firmId,
        requestedByUserId: args.userId,
        messageId: args.messageId,
        findingId: args.findingId,
        clauseId: args.clauseId,
        changes: args.changes,
        reason: args.reason,
        sourceLabel: args.sourceLabel,
      })
      .returning({ id: studyRevisionsTable.id });

    return { projectId: study!.id, version, revisionId: revision!.id };
  });
}

/** The newest version of the lineage whose first version is `root`, within the firm. */
async function latestOfLineage(firmId: string, root: string): Promise<{ id: string; version: number } | null> {
  const [row] = await db
    .select({ id: tisProjectsTable.id, version: tisProjectsTable.version })
    .from(tisProjectsTable)
    .where(and(eq(tisProjectsTable.firmId, firmId), or(eq(tisProjectsTable.id, root), eq(tisProjectsTable.rootProjectId, root))))
    .orderBy(desc(tisProjectsTable.version), desc(tisProjectsTable.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Where this version sits in its lineage: the `lineage` object of
 * DatumChatReadResponse. A study generated from scratch is version 1 of its own
 * lineage, revised from nothing. Throws NotFound for a project outside the firm.
 *
 * A version whose parent was deleted has revisedFromProjectId null (the FK is
 * SET NULL), and one whose first version was deleted is the root of what is
 * left of its lineage.
 */
export async function lineageFor(firmId: string, projectId: string): Promise<DatumChatReadResponse["lineage"]> {
  if (!UUID.test(firmId) || !UUID.test(projectId)) throw new NotFound();
  const [row] = await db
    .select({
      id: tisProjectsTable.id,
      version: tisProjectsTable.version,
      revisedFromProjectId: tisProjectsTable.revisedFromProjectId,
      rootProjectId: tisProjectsTable.rootProjectId,
    })
    .from(tisProjectsTable)
    .where(and(eq(tisProjectsTable.id, projectId), eq(tisProjectsTable.firmId, firmId)))
    .limit(1);
  if (!row) throw new NotFound();

  let revisedFromVersion: number | null = null;
  if (row.revisedFromProjectId !== null) {
    const [parent] = await db
      .select({ version: tisProjectsTable.version })
      .from(tisProjectsTable)
      .where(and(eq(tisProjectsTable.id, row.revisedFromProjectId), eq(tisProjectsTable.firmId, firmId)))
      .limit(1);
    revisedFromVersion = parent?.version ?? null;
  }
  const latest = (await latestOfLineage(firmId, row.rootProjectId ?? row.id)) ?? { id: row.id, version: row.version };
  return {
    version: row.version,
    revisedFromProjectId: row.revisedFromProjectId,
    revisedFromVersion,
    latestVersionId: latest.id,
    latestVersion: latest.version,
  };
}

/** The stored changes as { field, from, to }, in that order: jsonb keeps an object's keys in an order of its own. */
function changesOf(stored: unknown): DatumChange[] {
  if (!Array.isArray(stored)) return [];
  return stored
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null && typeof (c as { field?: unknown }).field === "string")
    .map((c) => ({ field: c.field as DatumChange["field"], from: c.from ?? null, to: c.to ?? null }));
}

/**
 * The revisions made from this project or made into it, newest version first,
 * as the thread's change cards show them. Empty for a project outside the firm.
 *
 * Ordered by the new version's number, not by the log row's created_at: that is
 * the transaction's start time, so a save that waited on the lineage lock has
 * the higher version and the earlier created_at. created_at only breaks a tie.
 */
export async function listRevisions(firmId: string, projectId: string): Promise<DatumRevision[]> {
  if (!UUID.test(firmId) || !UUID.test(projectId)) return [];
  const rows = await db
    .select({
      id: studyRevisionsTable.id,
      projectId: studyRevisionsTable.projectId,
      fromProjectId: studyRevisionsTable.fromProjectId,
      version: tisProjectsTable.version,
      changes: studyRevisionsTable.changes,
      reason: studyRevisionsTable.reason,
      sourceLabel: studyRevisionsTable.sourceLabel,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
      findingId: studyRevisionsTable.findingId,
      clauseId: studyRevisionsTable.clauseId,
      createdAt: studyRevisionsTable.createdAt,
    })
    .from(studyRevisionsTable)
    .innerJoin(tisProjectsTable, eq(tisProjectsTable.id, studyRevisionsTable.projectId))
    .innerJoin(usersTable, eq(usersTable.id, studyRevisionsTable.requestedByUserId))
    .where(
      and(
        eq(studyRevisionsTable.firmId, firmId),
        or(eq(studyRevisionsTable.projectId, projectId), eq(studyRevisionsTable.fromProjectId, projectId)),
      ),
    )
    .orderBy(desc(tisProjectsTable.version), desc(studyRevisionsTable.createdAt));
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    fromProjectId: r.fromProjectId,
    version: r.version,
    changes: changesOf(r.changes),
    reason: r.reason,
    sourceLabel: r.sourceLabel,
    // requested_by_user_id cascades with the user, so the user is always there; a user with no name or email is
    // still someone of the firm.
    requestedBy: authorNameOf(r) ?? "A member of your firm",
    findingId: r.findingId,
    clauseId: r.clauseId,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** The versions in the lineage whose first version is `rootId`, the original included. 0 outside the firm. */
export async function countLineage(firmId: string, rootId: string): Promise<number> {
  if (!UUID.test(firmId) || !UUID.test(rootId)) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tisProjectsTable)
    .where(and(eq(tisProjectsTable.firmId, firmId), or(eq(tisProjectsTable.id, rootId), eq(tisProjectsTable.rootProjectId, rootId))));
  return Number(row?.n ?? 0);
}
