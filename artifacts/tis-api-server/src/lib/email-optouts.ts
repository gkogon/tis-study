/**
 * Email opt-out helper.
 *
 * Outbound marketing emails (cold outreach, drip campaigns) must
 * filter against this list before sending — CAN-SPAM requires
 * honoring opt-outs within 10 business days, but we honor them
 * immediately. Transactional emails (password reset, billing, firm
 * invite) are exempt and ignore this list.
 */
import { eq } from "drizzle-orm";
import { db, emailOptoutsTable } from "@workspace/db";
import { logger } from "./logger";

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Idempotent. Returns true if a new row was inserted, false if the
 * address was already opted out (an OK outcome — the caller still
 * shows the same "you've been unsubscribed" UI).
 */
export async function optOutEmail(
  email: string,
  opts?: { source?: string; reason?: string },
): Promise<{ alreadyOpted: boolean }> {
  const lower = normalize(email);
  try {
    const inserted = await db
      .insert(emailOptoutsTable)
      .values({
        email: lower,
        source: opts?.source ?? null,
        reason: opts?.reason?.slice(0, 500) ?? null,
      })
      .onConflictDoNothing({ target: emailOptoutsTable.email })
      .returning();
    const alreadyOpted = inserted.length === 0;
    logger.info({ email: lower, alreadyOpted, source: opts?.source }, "email.opt_out");
    return { alreadyOpted };
  } catch (err) {
    logger.error({ err, email: lower }, "email.opt_out_failed");
    throw err;
  }
}

export async function isOptedOut(email: string): Promise<boolean> {
  if (!email) return false;
  const lower = normalize(email);
  const [row] = await db
    .select({ email: emailOptoutsTable.email })
    .from(emailOptoutsTable)
    .where(eq(emailOptoutsTable.email, lower))
    .limit(1);
  return !!row;
}
