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
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db, firmsTable } from "@workspace/db";
import { stripe, getWebhookSecret, resolvePlanFromPriceId } from "../lib/stripe";
import { logger } from "../lib/logger";

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

    try {
      await handleEvent(event);
      res.json({ received: true });
    } catch (err) {
      logger.error({ err, eventType: event.type }, "stripe-webhook.handler_failed");
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
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : null;

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
  // The follow-up `customer.subscription.created` event will set plan
  // tier, limits, and status — keep that logic in one place.
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
