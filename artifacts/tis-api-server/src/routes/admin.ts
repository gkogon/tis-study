/**
 * Admin / dev routes. Auth-gated by the ADMIN_EMAILS env var
 * (comma-separated allowlist). Returns 403 for any signed-in user not
 * on the list, 401 if not signed in at all.
 *
 *   GET /admin/usage    Per-user / per-firm usage rollup. Powers the
 *                       /admin/usage panel — lifetime study count,
 *                       current-period usage vs. limit, plan tier, last
 *                       activity.
 *   GET /admin/funnel   Acquisition-funnel event counts (demo_run →
 *                       signup → study_generated → checkout_started)
 *                       over today / 7d / 30d windows.
 *
 * Designed to be cheap on small datasets (single-digit firm count). If
 * we ever scale past a few hundred firms this should grow filtering /
 * pagination instead of the current "ship everything" shape.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { desc, eq, sql } from "drizzle-orm";
import {
  db,
  firmsTable,
  firmMembersTable,
  tisProjectsTable,
  usersTable,
  eventsTable,
} from "@workspace/db";
import { isAdminEmail } from "../lib/auth";

const router: IRouter = Router();

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated || !req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in." });
    return;
  }
  if (!isAdminEmail(req.user?.email)) {
    res.status(403).json({ error: "Admin only." });
    return;
  }
  next();
}

router.get("/admin/usage", requireAdmin, async (_req, res): Promise<void> => {
  // Lifetime study counts + last study timestamp per firm.
  const lifetimeRows = await db
    .select({
      firmId: tisProjectsTable.firmId,
      lifetimeStudyCount: sql<number>`count(*)::int`.as("lifetime"),
      lastStudyAt: sql<Date | null>`max(${tisProjectsTable.createdAt})`.as("last_study_at"),
    })
    .from(tisProjectsTable)
    .groupBy(tisProjectsTable.firmId);
  const lifetimeByFirm = new Map<string, { lifetime: number; lastStudyAt: Date | null }>();
  for (const r of lifetimeRows) {
    if (!r.firmId) continue;
    lifetimeByFirm.set(r.firmId, {
      lifetime: Number(r.lifetimeStudyCount ?? 0),
      lastStudyAt: r.lastStudyAt,
    });
  }

  // Per-user lifetime study counts (some users may belong to a firm but
  // not have personally generated any studies).
  const userLifetimeRows = await db
    .select({
      userId: tisProjectsTable.userId,
      lifetimeStudyCount: sql<number>`count(*)::int`.as("lifetime"),
      lastStudyAt: sql<Date | null>`max(${tisProjectsTable.createdAt})`.as("last_study_at"),
    })
    .from(tisProjectsTable)
    .groupBy(tisProjectsTable.userId);
  const lifetimeByUser = new Map<string, { lifetime: number; lastStudyAt: Date | null }>();
  for (const r of userLifetimeRows) {
    if (!r.userId) continue;
    lifetimeByUser.set(r.userId, {
      lifetime: Number(r.lifetimeStudyCount ?? 0),
      lastStudyAt: r.lastStudyAt,
    });
  }

  // Users joined to their firm membership + firm. LEFT JOIN so users
  // without a firm row still appear (shouldn't happen post-Phase 13
  // but cheap to keep visible).
  const rows = await db
    .select({
      userId: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      userCreatedAt: usersTable.createdAt,
      firmId: firmsTable.id,
      firmName: firmsTable.name,
      planTier: firmsTable.planTier,
      subscriptionStatus: firmsTable.subscriptionStatus,
      seatLimit: firmsTable.seatLimit,
      studyLimit: firmsTable.studyLimit,
      studiesUsedThisPeriod: firmsTable.studiesUsedThisPeriod,
      currentPeriodStart: firmsTable.currentPeriodStart,
      currentPeriodEnd: firmsTable.currentPeriodEnd,
      role: firmMembersTable.role,
      firmCreatedAt: firmsTable.createdAt,
    })
    .from(usersTable)
    .leftJoin(firmMembersTable, eq(firmMembersTable.userId, usersTable.id))
    .leftJoin(firmsTable, eq(firmsTable.id, firmMembersTable.firmId))
    .orderBy(desc(usersTable.createdAt));

  // Shape: one row per (user, firm) pair, with usage snapshots.
  const out = rows.map((r) => {
    const firmStats = r.firmId ? lifetimeByFirm.get(r.firmId) : undefined;
    const userStats = lifetimeByUser.get(r.userId);
    return {
      userId: r.userId,
      email: r.email,
      firstName: r.firstName,
      lastName: r.lastName,
      userCreatedAt: r.userCreatedAt,
      userLifetimeStudyCount: userStats?.lifetime ?? 0,
      userLastStudyAt: userStats?.lastStudyAt ?? null,
      firm: r.firmId
        ? {
            firmId: r.firmId,
            name: r.firmName,
            role: r.role,
            planTier: r.planTier,
            subscriptionStatus: r.subscriptionStatus,
            seatLimit: r.seatLimit,
            studyLimit: r.studyLimit,
            studiesUsedThisPeriod: r.studiesUsedThisPeriod,
            currentPeriodStart: r.currentPeriodStart,
            currentPeriodEnd: r.currentPeriodEnd,
            firmLifetimeStudyCount: firmStats?.lifetime ?? 0,
            firmLastStudyAt: firmStats?.lastStudyAt ?? null,
            firmCreatedAt: r.firmCreatedAt,
          }
        : null,
    };
  });

  res.json({
    generatedAt: new Date().toISOString(),
    userCount: new Set(out.map((u) => u.userId)).size,
    rows: out,
  });
});

/**
 * Acquisition-funnel counts. For each tracked event type, returns the
 * count in the last 24h / 7d / 30d. The funnel is meant to be read
 * top-to-bottom: demo_run → signup → study_generated → checkout_started.
 * quota_hit is a side-signal (firms hitting their cap = upgrade
 * pressure).
 */
const FUNNEL_EVENTS = [
  "demo_run",
  "signup",
  "study_generated",
  "checkout_started",
  "quota_hit",
] as const;

router.get("/admin/funnel", requireAdmin, async (req, res): Promise<void> => {
  // One grouped query per window. Each returns rows of {event_type, n}.
  const windowQuery = (interval: string) =>
    db
      .select({
        eventType: eventsTable.eventType,
        n: sql<number>`count(*)::int`,
      })
      .from(eventsTable)
      .where(sql`${eventsTable.createdAt} > now() - ${sql.raw(`interval '${interval}'`)}`)
      .groupBy(eventsTable.eventType);

  try {
    const [day, week, month] = await Promise.all([
      windowQuery("24 hours"),
      windowQuery("7 days"),
      windowQuery("30 days"),
    ]);

    const toMap = (rows: Array<{ eventType: string; n: number }>) => {
      const m: Record<string, number> = {};
      for (const r of rows) m[r.eventType] = r.n;
      return m;
    };
    const dayMap = toMap(day);
    const weekMap = toMap(week);
    const monthMap = toMap(month);

    res.json({
      generatedAt: new Date().toISOString(),
      funnel: FUNNEL_EVENTS.map((ev) => ({
        eventType: ev,
        last24h: dayMap[ev] ?? 0,
        last7d: weekMap[ev] ?? 0,
        last30d: monthMap[ev] ?? 0,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "admin.funnel_failed");
    res.status(500).json({ error: "Failed to load funnel." });
  }
});

export default router;
