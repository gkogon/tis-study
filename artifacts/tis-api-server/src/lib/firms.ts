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

/**
 * Which bucket a reserved study was charged against, so a later
 * `releaseStudySlot` refunds the correct one:
 *   - "unlimited" — never charged (dev-auth / sentinel / admin); release no-ops.
 *   - "period"    — the per-billing-period subscription/trial quota.
 *   - "credit"    — a purchased pay-per-study credit.
 */
export type QuotaSource = "unlimited" | "period" | "credit";

export type QuotaCheck =
  | {
      ok: true;
      firmId: string;
      remaining: number;
      unlimited: boolean;
      source: QuotaSource;
    }
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
 * Atomically reserve one study against the firm's period quota.
 *
 * This REPLACES the old check-then-charge pair (canGenerateStudy +
 * incrementStudyUsage). Those raced: two concurrent generations could both
 * read `used < limit` against a stale firm row and both proceed, letting a
 * firm exceed its plan by (concurrency − 1) studies per period. Here the cap
 * is enforced by the database in a single `UPDATE … WHERE used < limit`, so
 * the row lock — not an in-memory read — decides who gets the last slot.
 *
 * Returns `ok: true` with the post-charge remaining count when a slot was
 * reserved, or `ok: false` — `quota_exceeded` at the cap, or
 * `subscription_delinquent` when the subscription has lapsed (PR #33 gate,
 * folded in below). Unlimited firms (dev-auth, the studyLimit<=0 sentinel,
 * or admin emails) are never metered and never have their counter touched.
 *
 * The caller MUST release the slot via `releaseStudySlot` if the run later
 * fails (generation error or save failure) — see the engine routes — so a
 * failed attempt never counts, honoring the pricing-page promise.
 *
 * Pass the signed-in user's email so admin/operator accounts (and the
 * unlimited sentinel) are never blocked.
 */
export async function reserveStudySlot(
  firm: Firm,
  opts?: { email?: string | null },
): Promise<QuotaCheck> {
  if (isUnlimitedStudies(firm, opts?.email)) {
    return {
      ok: true,
      firmId: firm.id,
      remaining: Number.POSITIVE_INFINITY,
      unlimited: true,
      source: "unlimited",
    };
  }

  // (1) Period quota first — it's use-it-or-lose-it, so spend it before the
  // permanent purchased credits. Revenue-integrity gate (PR #33): a firm whose
  // subscription has definitively lapsed (payment failed after retries, first
  // payment never completed, or canceled) may NOT draw down paid period quota.
  // It can still spend prepaid credits, though (step 2) — those aren't
  // subscription access. Conditional increment: the WHERE is re-evaluated under
  // the row lock, so only one of N concurrent callers at `used = limit − 1`
  // gets a row back; the rest see zero rows updated and fall through.
  const delinquent = isSubscriptionDelinquent(firm);
  if (!delinquent) {
    const [row] = await db
      .update(firmsTable)
      .set({
        studiesUsedThisPeriod: sql`${firmsTable.studiesUsedThisPeriod} + 1`,
      })
      .where(
        and(
          eq(firmsTable.id, firm.id),
          sql`${firmsTable.studiesUsedThisPeriod} < ${firmsTable.studyLimit}`,
        ),
      )
      .returning({ used: firmsTable.studiesUsedThisPeriod });
    if (row) {
      return {
        ok: true,
        firmId: firm.id,
        remaining: Math.max(firm.studyLimit - row.used, 0),
        unlimited: false,
        source: "period",
      };
    }
  }

  // (2) Fall back to a purchased pay-per-study credit. Same atomic conditional
  // pattern as the period quota: only one concurrent caller can claim the last
  // credit. Spendable even when the subscription is delinquent.
  const [creditRow] = await db
    .update(firmsTable)
    .set({
      studyCreditsRemaining: sql`${firmsTable.studyCreditsRemaining} - 1`,
    })
    .where(
      and(
        eq(firmsTable.id, firm.id),
        sql`${firmsTable.studyCreditsRemaining} > 0`,
      ),
    )
    .returning({ credits: firmsTable.studyCreditsRemaining });
  if (creditRow) {
    return {
      ok: true,
      firmId: firm.id,
      remaining: creditRow.credits,
      unlimited: false,
      source: "credit",
    };
  }

  // (3) Nothing left. Delinquency takes precedence in the reason so the UI can
  // prompt "update your card" rather than "buy more studies".
  return delinquent
    ? {
        ok: false,
        reason: "subscription_delinquent",
        firmId: firm.id,
        limit: firm.studyLimit,
      }
    : {
        ok: false,
        reason: "quota_exceeded",
        firmId: firm.id,
        limit: firm.studyLimit,
      };
}

/**
 * Return a previously reserved slot to the pool when a run fails after
 * `reserveStudySlot` already charged it. No-ops for unlimited firms (their
 * counter is never charged) and floors at zero so a stray double-release
 * can't drive usage negative. Best-effort: a refund failure is logged, not
 * thrown — the caller is already on an error path.
 */
export async function releaseStudySlot(
  firm: Firm,
  opts?: { email?: string | null; source?: QuotaSource },
): Promise<void> {
  if (isUnlimitedStudies(firm, opts?.email)) return;
  // Nothing was charged for an unlimited reservation.
  if (opts?.source === "unlimited") return;
  try {
    if (opts?.source === "credit") {
      // Return the purchased credit that was consumed. Note we do NOT touch
      // studiesPurchasedLifetime — the purchase genuinely happened; only the
      // spend is being reversed, so the intro/standard rate is unaffected.
      await db
        .update(firmsTable)
        .set({
          studyCreditsRemaining: sql`${firmsTable.studyCreditsRemaining} + 1`,
        })
        .where(eq(firmsTable.id, firm.id));
      return;
    }
    // Default (and explicit "period"): refund the per-period counter. GREATEST
    // floors at zero so a stray double-release can't drive usage negative.
    await db
      .update(firmsTable)
      .set({
        studiesUsedThisPeriod: sql`GREATEST(${firmsTable.studiesUsedThisPeriod} - 1, 0)`,
      })
      .where(eq(firmsTable.id, firm.id));
  } catch (err) {
    logger.error({ err, firmId: firm.id }, "firms.release_failed");
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
