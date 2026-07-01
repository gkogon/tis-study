/**
 * Stripe webhook endpoint.
 *
 * Mounted on the app at `/tis-api/stripe/webhook` with a raw-body parser
 * so the signature verification matches Stripe's signed payload. Wired
 * BEFORE the JSON middleware in [app.ts] for that reason.
 *
 * Events we handle:
 *   - checkout.session.completed: a firm just finished Checkout — link
 *     the subscription to the firm by metadata.
 *   - customer.subscription.created / updated: refresh plan, seat/study
 *     limits, period dates, status.
 *   - customer.subscription.deleted: roll the firm back to trial state
 *     (preserves history; just stops new generations once limit hit).
 *   - invoice.paid: a new period started — reset studiesUsedThisPeriod.
 *
 * Anything else is acknowledged with 200 so Stripe doesn't retry.
 */
import { Router, type IRouter } from "express";
import express from "express";
import { eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { db, firmsTable, stripeWebhookEventsTable } from "@workspace/db";
import { stripe, getWebhookSecret, resolvePlanFromPriceId } from "../lib/stripe";
import { logger } from "../lib/logger";

/** Postgres unique_violation (SQLSTATE 23505), surfaced raw by drizzle/pg. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "23505"
  );
}

const router: IRouter = Router();

router.post(
  "/stripe/webhook",
  // Stripe signature verification needs the raw body bytes — JSON parsing
  // would alter whitespace and break the HMAC check.
  express.raw({ type: "application/json" }),
  async (req, res): Promise<void> => {
    if (!stripe) {
      res.status(503).json({ error: "Billing not configured." });
      return;
    }
    const secret = getWebhookSecret();
    if (!secret) {
      res.status(503).json({ error: "Webhook secret not configured." });
      return;
    }

    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string") {
      res.status(400).json({ error: "Missing stripe-signature header." });
      return;
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, signature, secret);
    } catch (err) {
      logger.warn({ err }, "stripe-webhook.signature_invalid");
      res.status(400).json({ error: "Invalid signature." });
      return;
    }

    // Idempotency — claim the event id before running any side effects.
    // Stripe delivers at-least-once (it retries on every non-2xx, and a
    // network blip can double-deliver), so without a dedup guard a replayed
    // `invoice.paid` re-grants a billing period's study quota (free
    // studies) and a replayed subscription event re-applies stale plan
    // state. The PK insert is atomic: a duplicate raises a unique violation,
    // which means we've already handled this event — ack 200 and stop.
    try {
      await db
        .insert(stripeWebhookEventsTable)
        .values({ id: event.id, type: event.type });
    } catch (err) {
      if (isUniqueViolation(err)) {
        logger.info(
          { eventId: event.id, eventType: event.type },
          "stripe-webhook.duplicate_ignored",
        );
        res.json({ received: true, duplicate: true });
        return;
      }
      // A transient DB error recording the claim — 500 so Stripe retries
      // rather than risk processing-without-a-claim or dropping the event.
      logger.error({ err, eventId: event.id }, "stripe-webhook.idempotency_failed");
      res.status(500).json({ error: "Webhook idempotency check failed." });
      return;
    }

    try {
      await handleEvent(event);
      res.json({ received: true });
    } catch (err) {
      logger.error({ err, eventType: event.type }, "stripe-webhook.handler_failed");
      // The handler failed AFTER we claimed the event. Release the claim so
      // Stripe's retry actually re-processes it — otherwise the claim row
      // would make us skip the retry as a "duplicate" and the event's side
      // effects would be lost permanently.
      await db
        .delete(stripeWebhookEventsTable)
        .where(eq(stripeWebhookEventsTable.id, event.id))
        .catch((delErr) => {
          logger.error(
            { err: delErr, eventId: event.id },
            "stripe-webhook.claim_release_failed",
          );
        });
      // 500 prompts Stripe to retry, which is what we want for a
      // transient DB error.
      res.status(500).json({ error: "Webhook handler error." });
    }
  },
);

export default router;

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await onSubscriptionChanged(event.data.object as Stripe.Subscription);
      return;
    case "customer.subscription.deleted":
      await onSubscriptionDeleted(event.data.object as Stripe.Subscription);
      return;
    case "invoice.paid":
      await onInvoicePaid(event.data.object as Stripe.Invoice);
      return;
    default:
      logger.debug({ eventType: event.type }, "stripe-webhook.unhandled");
  }
}

async function findFirmByStripeCustomerId(customerId: string) {
  const [row] = await db
    .select()
    .from(firmsTable)
    .where(eq(firmsTable.stripeCustomerId, customerId))
    .limit(1);
  return row ?? null;
}

async function findFirmByMetadataOrCustomer(args: {
  metadataFirmId?: string | null;
  customerId?: string | null;
}) {
  if (args.metadataFirmId) {
    const [row] = await db
      .select()
      .from(firmsTable)
      .where(eq(firmsTable.id, args.metadataFirmId))
      .limit(1);
    if (row) return row;
  }
  if (args.customerId) return findFirmByStripeCustomerId(args.customerId);
  return null;
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const firmId = (session.metadata?.firmId as string | undefined) ?? null;
  const customerId =
    typeof session.customer === "string" ? session.customer : null;

  const firm = await findFirmByMetadataOrCustomer({
    metadataFirmId: firmId,
    customerId,
  });
  if (!firm) {
    logger.warn(
      { firmId, customerId, sessionId: session.id },
      "stripe-webhook.checkout_no_firm",
    );
    return;
  }

  // A one-time pay-per-study purchase (mode: "payment"), NOT a subscription.
  // Bank the paid study credits and bump the lifetime counter (which selects
  // the intro vs standard rate on the next purchase). Critically this does
  // NOT touch stripeSubscriptionId — a study purchase must never clobber an
  // existing subscription. Double-granting on webhook replay is already
  // prevented by the event-id idempotency guard above.
  if (session.mode === "payment") {
    const credits = Number(session.metadata?.credits ?? 0);
    if (!Number.isFinite(credits) || credits <= 0) {
      logger.warn(
        { firmId: firm.id, sessionId: session.id, credits: session.metadata?.credits },
        "stripe-webhook.study_purchase_bad_credits",
      );
      return;
    }
    await db
      .update(firmsTable)
      .set({
        stripeCustomerId: customerId ?? firm.stripeCustomerId,
        studyCreditsRemaining: sql`${firmsTable.studyCreditsRemaining} + ${credits}`,
        studiesPurchasedLifetime: sql`${firmsTable.studiesPurchasedLifetime} + ${credits}`,
      })
      .where(eq(firmsTable.id, firm.id));

    logger.info(
      { firmId: firm.id, credits, sessionId: session.id },
      "stripe-webhook.study_purchase_granted",
    );
    return;
  }

  // Subscription checkout: link the subscription to the firm. The follow-up
  // `customer.subscription.created` event sets plan tier, limits, and status —
  // that logic stays in one place (onSubscriptionChanged).
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : null;
  await db
    .update(firmsTable)
    .set({
      stripeCustomerId: customerId ?? firm.stripeCustomerId,
      stripeSubscriptionId: subscriptionId,
    })
    .where(eq(firmsTable.id, firm.id));

  logger.info(
    { firmId: firm.id, subscriptionId, sessionId: session.id },
    "stripe-webhook.checkout_completed",
  );
}

async function onSubscriptionChanged(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : null;
  const firmId = (sub.metadata?.firmId as string | undefined) ?? null;
  const firm = await findFirmByMetadataOrCustomer({
    metadataFirmId: firmId,
    customerId,
  });
  if (!firm) {
    logger.warn(
      { firmId, customerId, subscriptionId: sub.id },
      "stripe-webhook.subscription_no_firm",
    );
    return;
  }

  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  const plan = priceId ? resolvePlanFromPriceId(priceId) : null;
  if (!plan) {
    logger.warn(
      { firmId: firm.id, priceId, subscriptionId: sub.id },
      "stripe-webhook.unknown_price",
    );
    return;
  }

  await db
    .update(firmsTable)
    .set({
      stripeSubscriptionId: sub.id,
      planTier: plan.id,
      subscriptionStatus: sub.status,
      seatLimit: plan.seatLimit,
      studyLimit: plan.studyLimit,
      currentPeriodStart: sub.current_period_start
        ? new Date(sub.current_period_start * 1000)
        : null,
      currentPeriodEnd: sub.current_period_end
        ? new Date(sub.current_period_end * 1000)
        : null,
    })
    .where(eq(firmsTable.id, firm.id));

  logger.info(
    { firmId: firm.id, plan: plan.id, status: sub.status },
    "stripe-webhook.subscription_updated",
  );
}

async function onSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  const customerId = typeof sub.customer === "string" ? sub.customer : null;
  const firm = await findFirmByMetadataOrCustomer({ customerId });
  if (!firm) return;

  await db
    .update(firmsTable)
    .set({
      planTier: "trial",
      subscriptionStatus: "canceled",
      seatLimit: 3,
      studyLimit: 3,
      stripeSubscriptionId: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
    })
    .where(eq(firmsTable.id, firm.id));

  logger.info({ firmId: firm.id }, "stripe-webhook.subscription_cancelled");
}

async function onInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : null;
  if (!customerId) return;
  const firm = await findFirmByStripeCustomerId(customerId);
  if (!firm) return;

  // New billing period → reset the per-period study counter.
  await db
    .update(firmsTable)
    .set({ studiesUsedThisPeriod: 0 })
    .where(eq(firmsTable.id, firm.id));

  logger.info(
    { firmId: firm.id, invoiceId: invoice.id },
    "stripe-webhook.invoice_paid_reset",
  );
}
