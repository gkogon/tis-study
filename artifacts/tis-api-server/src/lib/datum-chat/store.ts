/**
 * The Datum chat's reads and writes: the thread, the firm's reply count, and
 * the findings the chat may talk about. One of the two modules under
 * lib/datum-chat/ that do I/O (client.ts is the other); everything else here is
 * pure.
 *
 * Every read is firm-scoped. The thread is append-only: a message is inserted
 * and never edited.
 */
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db, studyDatumMessagesTable, usersTable } from "@workspace/db";
import type { DatumMessage } from "@workspace/tis-api-zod";
import { latestRunForProject } from "../proofread-store";
import type { VisibleFinding } from "./context.ts";
import type { ReadPath } from "../proofread/types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The name the thread shows for an engineer: first and last name, else the email, else null. */
export function authorNameOf(u: { firstName: string | null; lastName: string | null; email: string | null } | null): string | null {
  if (u === null) return null;
  const name = [u.firstName, u.lastName]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .join(" ");
  return name || (typeof u.email === "string" && u.email.trim() ? u.email.trim() : null);
}

export type InsertDatumMessage = {
  projectId: string;
  firmId: string;
  /** The engineer; null for Datum. */
  userId: string | null;
  role: "engineer" | "datum";
  content: string;
  findingId?: string | null;
  /** On the Datum message that reports a re-run: the revision it made. */
  revisionId?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  stopReason?: string | null;
};

export async function insertMessage(row: InsertDatumMessage): Promise<{ id: string }> {
  const [inserted] = await db
    .insert(studyDatumMessagesTable)
    .values({
      projectId: row.projectId,
      firmId: row.firmId,
      userId: row.userId,
      role: row.role,
      content: row.content,
      findingId: row.findingId ?? null,
      revisionId: row.revisionId ?? null,
      model: row.model ?? null,
      inputTokens: row.inputTokens ?? null,
      outputTokens: row.outputTokens ?? null,
      stopReason: row.stopReason ?? null,
    })
    .returning({ id: studyDatumMessagesTable.id });
  return { id: inserted!.id };
}

/** The study's thread, oldest first, with each engineer's name joined at read time. Empty outside the firm. */
export async function listMessages(firmId: string, projectId: string): Promise<DatumMessage[]> {
  if (!UUID.test(firmId) || !UUID.test(projectId)) return [];
  const rows = await db
    .select({
      id: studyDatumMessagesTable.id,
      role: studyDatumMessagesTable.role,
      content: studyDatumMessagesTable.content,
      findingId: studyDatumMessagesTable.findingId,
      revisionId: studyDatumMessagesTable.revisionId,
      createdAt: studyDatumMessagesTable.createdAt,
      userId: usersTable.id,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      email: usersTable.email,
    })
    .from(studyDatumMessagesTable)
    .leftJoin(usersTable, eq(usersTable.id, studyDatumMessagesTable.userId))
    .where(and(eq(studyDatumMessagesTable.firmId, firmId), eq(studyDatumMessagesTable.projectId, projectId)))
    .orderBy(asc(studyDatumMessagesTable.createdAt), asc(studyDatumMessagesTable.id));
  return rows.map((r) => ({
    id: r.id,
    role: r.role === "datum" ? "datum" : "engineer",
    content: r.content,
    // Datum has no name; an engineer who has since been deleted is shown unnamed.
    authorName: r.role === "datum" || r.userId === null ? null : authorNameOf(r),
    findingId: r.findingId,
    revisionId: r.revisionId,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Datum's replies to this firm in the last 24 hours, counted from the thread itself (the firm's daily cap). */
export async function firmRepliesLast24h(firmId: string): Promise<number> {
  if (!UUID.test(firmId)) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(studyDatumMessagesTable)
    .where(
      and(
        eq(studyDatumMessagesTable.firmId, firmId),
        eq(studyDatumMessagesTable.role, "datum"),
        gt(studyDatumMessagesTable.createdAt, sql`now() - interval '24 hours'`),
      ),
    );
  return Number(row?.n ?? 0);
}

/** A decision as the panel's read serves it, and as the grounding pack reads it. */
export type VisibleDisposition = {
  findingId: string;
  disposition: string;
  note: string | null;
  sourceLabel: string | null;
  createdAt: string;
};

/**
 * The findings and decisions this engineer may see on the study's newest
 * proofread run: exactly what GET /projects/:id/proofread serves. Admin-audience
 * findings (DEFECT) are dropped, and so is every decision on one, so the chat
 * never learns a withheld finding's id. Decisions are newest first, as the
 * store reads them. Nothing yet: empty lists.
 */
export async function loadVisible(firmId: string, projectId: string): Promise<{ findings: VisibleFinding[]; dispositions: VisibleDisposition[] }> {
  if (!UUID.test(firmId) || !UUID.test(projectId)) return { findings: [], dispositions: [] };
  const latest = await latestRunForProject(firmId, projectId);
  if (!latest) return { findings: [], dispositions: [] };
  const visible = latest.findings.filter((f) => f.audience !== "admin");
  const visibleIds = new Set(visible.map((f) => f.id));
  return {
    findings: visible.map((f) => ({
      id: f.id,
      clauseId: f.clauseId,
      type: f.type,
      title: f.title,
      detail: f.detail,
      sourceLabel: f.sourceLabel,
      readPaths: f.readPaths as ReadPath[],
      remedy: f.remedy,
    })),
    dispositions: latest.dispositions
      .filter((d) => visibleIds.has(d.findingId))
      .map((d) => ({
        findingId: d.findingId,
        disposition: d.disposition,
        note: d.note,
        sourceLabel: d.sourceLabel,
        createdAt: d.createdAt.toISOString(),
      })),
  };
}
