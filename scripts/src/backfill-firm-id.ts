/**
 * One-shot backfill: every legacy `tis_projects` row had only a `userId`.
 * Phase-1 of the firm-accounts refactor added a nullable `firmId` column.
 * This script:
 *   1. For each distinct legacy userId with no firm membership, creates
 *      a personal firm owned by that user.
 *   2. Sets `firmId` on all of that user's existing projects.
 *
 * Idempotent: running it again is a no-op once every row has a firmId.
 * Run on Replit after applying the schema migration:
 *   pnpm --filter @workspace/scripts exec tsx src/backfill-firm-id.ts
 *
 * Once verified, a follow-up migration can make `tis_projects.firmId`
 * NOT NULL.
 */
import { eq, isNull, sql } from "drizzle-orm";
import {
  db,
  pool,
  firmsTable,
  firmMembersTable,
  tisProjectsTable,
  usersTable,
} from "@workspace/db";

function slugifyFirmName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || "firm"}-${suffix}`;
}

async function main(): Promise<void> {
  // Find distinct userIds on projects that have no firmId yet.
  const rows = await db
    .selectDistinct({ userId: tisProjectsTable.userId })
    .from(tisProjectsTable)
    .where(isNull(tisProjectsTable.firmId));

  if (rows.length === 0) {
    console.log("backfill: no legacy rows to migrate.");
    return;
  }

  console.log(`backfill: ${rows.length} user(s) need personal firms.`);

  for (const { userId } of rows) {
    // Does this user already belong to a firm? (e.g. they signed in
    // after the schema change and got a personal firm auto-created.)
    const [existingMembership] = await db
      .select()
      .from(firmMembersTable)
      .where(eq(firmMembersTable.userId, userId))
      .limit(1);

    let firmId: string;

    if (existingMembership) {
      firmId = existingMembership.firmId;
      console.log(`  user=${userId} reusing firm=${firmId}`);
    } else {
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      const fallbackName =
        [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
        user?.email?.split("@")[0] ||
        "Legacy Firm";

      const [firm] = await db
        .insert(firmsTable)
        .values({
          name: fallbackName,
          slug: slugifyFirmName(fallbackName),
          planTier: "trial",
        })
        .returning();

      if (!firm) throw new Error(`Failed to create firm for user=${userId}`);
      firmId = firm.id;

      await db.insert(firmMembersTable).values({
        firmId,
        userId,
        role: "owner",
      });
      console.log(`  user=${userId} → new firm=${firmId} (${fallbackName})`);
    }

    const result = await db
      .update(tisProjectsTable)
      .set({ firmId })
      .where(
        sql`${tisProjectsTable.userId} = ${userId} AND ${tisProjectsTable.firmId} IS NULL`,
      );

    console.log(`  → updated projects for user=${userId}`, result);
  }

  console.log("backfill: done.");
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error("backfill failed:", err);
    pool.end();
    process.exit(1);
  });
