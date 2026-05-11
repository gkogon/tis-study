/**
 * Per-firm TIS project history. Each successful generation is persisted so the
 * engineer can reopen, re-print, or compare past studies. Primary switching-cost
 * moat: once a firm has 50+ projects under one account, leaving the platform
 * means losing the audit trail.
 *
 * Reads and writes are scoped by `firmId`, not `userId`, so any engineer at the
 * firm can see the firm's full history. We retain `userId` on each row for
 * attribution ("who ran study #42?").
 */
import { and, desc, eq } from "drizzle-orm";
import { db, tisProjectsTable, type TisProject } from "@workspace/db";
import { logger } from "./logger";

export type SaveProjectArgs = {
  userId: string;
  firmId: string;
  projectName: string;
  landUseCode: string;
  landUseSize: number;
  siteLat: number;
  siteLon: number;
  request: unknown;
  result: unknown;
};

export async function saveProject(args: SaveProjectArgs): Promise<TisProject | null> {
  try {
    const [row] = await db
      .insert(tisProjectsTable)
      .values({
        userId: args.userId,
        firmId: args.firmId,
        projectName: args.projectName.slice(0, 200),
        landUseCode: args.landUseCode,
        landUseSize: String(args.landUseSize),
        siteLat: String(args.siteLat),
        siteLon: String(args.siteLon),
        requestPayload: args.request as object,
        resultPayload: args.result as object,
        version: 1,
      })
      .returning();
    return row ?? null;
  } catch (err) {
    // Persistence failure must not break the user's response.
    logger.error(
      { err, userId: args.userId, firmId: args.firmId },
      "tis-projects.save_failed",
    );
    return null;
  }
}

export type ProjectListItem = {
  id: string;
  projectName: string;
  landUseCode: string;
  siteLat: string | null;
  siteLon: string | null;
  version: number;
  createdAt: string;
};

export async function listProjects(firmId: string): Promise<ProjectListItem[]> {
  const rows = await db
    .select({
      id: tisProjectsTable.id,
      projectName: tisProjectsTable.projectName,
      landUseCode: tisProjectsTable.landUseCode,
      siteLat: tisProjectsTable.siteLat,
      siteLon: tisProjectsTable.siteLon,
      version: tisProjectsTable.version,
      createdAt: tisProjectsTable.createdAt,
    })
    .from(tisProjectsTable)
    .where(eq(tisProjectsTable.firmId, firmId))
    .orderBy(desc(tisProjectsTable.createdAt))
    .limit(200);

  return rows.map((r) => ({
    id: r.id,
    projectName: r.projectName,
    landUseCode: r.landUseCode,
    siteLat: r.siteLat,
    siteLon: r.siteLon,
    version: r.version,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getProject(
  firmId: string,
  id: string,
): Promise<TisProject | null> {
  const [row] = await db
    .select()
    .from(tisProjectsTable)
    .where(and(eq(tisProjectsTable.id, id), eq(tisProjectsTable.firmId, firmId)))
    .limit(1);
  return row ?? null;
}
