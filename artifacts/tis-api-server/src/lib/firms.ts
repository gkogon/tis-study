/**
 * Firm-account helpers. A firm is the billing unit; every signed-in user
 * resolves to exactly one active firm via `getOrCreateFirmForUser`.
 * First-time users get a personal firm auto-created so the rest of the
 * app (quota check, project save, settings) always has a `firmId` to
 * scope against — even before the user has gone through onboarding.
 */
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  firmsTable,
  firmMembersTable,
  type Firm,
  type FirmMember,
} from "@workspace/db";
import { logger } from "./logger";
import { isAdminEmail } from "./auth";

export type FirmWithRole = {
  firm: Firm;
  role: FirmMember["role"];
};

/**
 * Trial defaults — applied to any firm with no active subscription.
 * 3 studies wasn't enough for a PE to actually feel the workflow
 * change (induced-demand argument: power users run 40-80 studies/mo
 * once they internalize the tool). 10 lets a trial firm run a few
 * iterations on multiple sites — strong enough signal for conversion
 * without giving away production-volume usage.
 */
export const TRIAL_SEAT_LIMIT = 3;
export const TRIAL_STUDY_LIMIT = 10;

function slugifyFirmName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  // Random suffix guarantees uniqueness without a conflict-retry loop.
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || "firm"}-${suffix}`;
}

export async function getActiveFirmForUser(
  userId: string,
): Promise<FirmWithRole | null> {
  const [row] = await db
    .select({ firm: firmsTable, role: firmMembersTable.role })
    .from(firmMembersTable)
    .innerJoin(firmsTable, eq(firmMembersTable.firmId, firmsTable.id))
    .where(eq(firmMembersTable.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Resolve a user to their firm, creating a personal firm on first call.
 * The personal firm is owned by the user and starts in trial state.
 * Engineering firms that want a real firm name can rename later from
 * /settings/firm.
 */
export async function getOrCreateFirmForUser(
  userId: string,
  hint?: { email?: string | null; firstName?: string | null; lastName?: string | null },
): Promise<FirmWithRole> {
  const existing = await getActiveFirmForUser(userId);
  if (existing) return existing;

  const fallbackName =
    [hint?.firstName, hint?.lastName].filter(Boolean).join(" ").trim() ||
    hint?.email?.split("@")[0] ||
    "My Firm";

  try {
    const [firm] = await db
      .insert(firmsTable)
      .values({
        name: fallbackName,
        slug: slugifyFirmName(fallbackName),
        planTier: "trial",
        seatLimit: TRIAL_SEAT_LIMIT,
        studyLimit: TRIAL_STUDY_LIMIT,
        studiesUsedThisPeriod: 0,
      })
      .returning();

    if (!firm) {
      throw new Error("Firm insert returned no row");
    }

    await db.insert(firmMembersTable).values({
      firmId: firm.id,
      userId,
      role: "owner",
    });

    logger.info(
      { userId, firmId: firm.id, name: firm.name },
      "firms.personal_firm_created",
    );
    return { firm, role: "owner" };
  } catch (err) {
    // Possible race: another concurrent request created the firm. Re-read.
    const after = await getActiveFirmForUser(userId);
    if (after) return after;
    logger.error({ err, userId }, "firms.create_failed");
    throw err;
  }
}

export type QuotaCheck =
  | { ok: true; firmId: string; remaining: number; unlimited: boolean }
  | {
      ok: false;
      reason: "quota_exceeded" | "subscription_delinquent";
      firmId: string;
      limit: number;
    };

/**
 * Returns true when a firm/user should never be metered against the study
 * cap. Cases:
 *   - Dev-auth environments (`DEV_AUTH_ENABLED=true`): the sign-in bypass
 *     trusts any email and there's no billing, so the study quota is pure
 *     friction. Every dev account is unlimited. (This is never set in prod
 *     per the .env contract, so it can't leak a free tier to real users.)
 *   - `studyLimit <= 0` is the documented "unlimited" sentinel (enterprise
 *     / comped firms). The quota banner already self-hides on it; this
 *     makes the actual generation gate honor the same convention. Without
 *     this, an unlimited firm (limit 0) was HARD BLOCKED on every run,
 *     because `studiesUsedThisPeriod (0) >= studyLimit (0)` is true.
 *   - admin/operator emails (ADMIN_EMAILS) are always unlimited regardless
 *     of the firm row, so the operator's own account is never blocked.
 */
export function isUnlimitedStudies(
  firm: Pick<Firm, "studyLimit">,
  email?: string | null,
): boolean {
  if (process.env.DEV_AUTH_ENABLED === "true") return true;
  return firm.studyLimit <= 0 || isAdminEmail(email);
}

/**
 * Stripe subscription statuses that HARD-BLOCK paid study generation,
 * independent of remaining quota. These are the states where the firm is
 * no longer paying for the access it has:
 *   - 'unpaid'             — Stripe exhausted its dunning retries; this
 *                            period's invoice was never paid.
 *   - 'incomplete_expired' — the first payment never completed and the
 *                            subscription was abandoned.
 *   - 'canceled'           — the subscription has ended.
 *
 * 'past_due' is deliberately EXCLUDED: during past_due Stripe is still
 * retrying the charge (smart retries / dunning), so we honor that as a
 * grace period and keep the firm working until the status resolves to
 * 'active' (payment recovered) or to one of the blocking states above.
 * Trial firms have a NULL status and are never delinquent — they keep
 * running on their trial quota.
 *
 * This Set is the single source of truth for "is this firm paying for what
 * it's using." Tighten it (add 'past_due') or loosen it per billing policy.
 */
const DELINQUENT_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "unpaid",
  "incomplete_expired",
  "canceled",
]);

export function isSubscriptionDelinquent(
  firm: Pick<Firm, "subscriptionStatus">,
): boolean {
  const status = firm.subscriptionStatus;
  return status != null && DELINQUENT_SUBSCRIPTION_STATUSES.has(status);
}

/**
 * Check whether the firm can run another TIS this billing period.
 * Returns `ok: true` and the new remaining count if so. The caller is
 * responsible for calling `incrementStudyUsage` after a successful run.
 *
 * Pass the signed-in user's email so admin/operator accounts (and the
 * unlimited sentinel) are never blocked.
 */
export function canGenerateStudy(
  firm: Firm,
  opts?: { email?: string | null },
): QuotaCheck {
  if (isUnlimitedStudies(firm, opts?.email)) {
    return {
      ok: true,
      firmId: firm.id,
      remaining: Number.POSITIVE_INFINITY,
      unlimited: true,
    };
  }
  // Revenue integrity: a firm whose subscription has definitively lapsed
  // (payment failed after retries, first payment never completed, or
  // canceled) must not keep drawing down the paid study quota it's no
  // longer paying for. Checked AFTER the unlimited short-circuit so
  // admin / dev / comped accounts are never gated, and BEFORE the
  // per-period counter so it can't be sidestepped by a quota reset.
  //
  // NOTE (PR #32): when the atomic `reserveStudySlot` replaces this
  // read-then-write path, fold `isSubscriptionDelinquent` into its WHERE
  // clause (or guard the call site) so this gate survives that refactor —
  // otherwise the revenue hole silently reopens.
  if (isSubscriptionDelinquent(firm)) {
    return {
      ok: false,
      reason: "subscription_delinquent",
      firmId: firm.id,
      limit: firm.studyLimit,
    };
  }
  if (firm.studiesUsedThisPeriod >= firm.studyLimit) {
    return {
      ok: false,
      reason: "quota_exceeded",
      firmId: firm.id,
      limit: firm.studyLimit,
    };
  }
  return {
    ok: true,
    firmId: firm.id,
    remaining: firm.studyLimit - firm.studiesUsedThisPeriod - 1,
    unlimited: false,
  };
}

export async function incrementStudyUsage(firmId: string): Promise<void> {
  try {
    // SQL expression avoids the read-then-write race when two engineers
    // generate concurrently.
    await db
      .update(firmsTable)
      .set({
        studiesUsedThisPeriod: sql`${firmsTable.studiesUsedThisPeriod} + 1`,
      })
      .where(eq(firmsTable.id, firmId));
  } catch (err) {
    // Generation already succeeded; usage tracking failure is non-fatal.
    logger.error({ err, firmId }, "firms.increment_failed");
  }
}

export async function listFirmMembers(firmId: string) {
  return db
    .select()
    .from(firmMembersTable)
    .where(eq(firmMembersTable.firmId, firmId));
}

export async function getMembership(
  firmId: string,
  userId: string,
): Promise<FirmMember | null> {
  const [row] = await db
    .select()
    .from(firmMembersTable)
    .where(
      and(
        eq(firmMembersTable.firmId, firmId),
        eq(firmMembersTable.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}
