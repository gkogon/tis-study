/**
 * Stripe billing operations: customer creation, checkout, customer portal.
 *
 * Customers are created lazily on first billing action and saved back to
 * `firms.stripeCustomerId`. Subscriptions are managed entirely through
 * Stripe Checkout + Customer Portal; we never call `subscriptions.create`
 * directly because Checkout handles SCA / 3DS / declines / receipts for
 * us.
 */
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db, firmsTable, type Firm } from "@workspace/db";
import {
  stripe,
  resolvePriceId,
  getPublicAppOrigin,
  type PaidPlanId,
  type BillingCadence,
} from "./stripe";
import { logger } from "./logger";

export class BillingDisabledError extends Error {
  constructor() {
    super("Billing is not configured on this environment.");
  }
}

function requireStripe(): Stripe {
  if (!stripe) throw new BillingDisabledError();
  return stripe;
}

/**
 * Get the firm's Stripe Customer ID, creating one if missing. Idempotent
 * but does take a write lock on the row (UPDATE) so two simultaneous
 * checkout starts don't create duplicate customers.
 */
export async function ensureStripeCustomer(
  firm: Firm,
  email: string | null,
): Promise<string> {
  if (firm.stripeCustomerId) return firm.stripeCustomerId;

  const s = requireStripe();
  const customer = await s.customers.create({
    name: firm.name,
    email: email ?? undefined,
    metadata: { firmId: firm.id, firmSlug: firm.slug },
  });

  await db
    .update(firmsTable)
    .set({ stripeCustomerId: customer.id })
    .where(eq(firmsTable.id, firm.id));

  logger.info({ firmId: firm.id, customerId: customer.id }, "billing.customer_created");
  return customer.id;
}

export type CheckoutSessionResult = { url: string };

export async function createCheckoutSession(args: {
  firm: Firm;
  email: string | null;
  plan: PaidPlanId;
  cadence?: BillingCadence;
}): Promise<CheckoutSessionResult> {
  const s = requireStripe();
  const cadence: BillingCadence = args.cadence ?? "monthly";
  const priceId = resolvePriceId(args.plan, cadence);
  if (!priceId) {
    throw new Error(
      `Plan "${args.plan}" (${cadence}) is not provisioned — set its Stripe Price ID env var.`,
    );
  }

  const customerId = await ensureStripeCustomer(args.firm, args.email);
  const origin = getPublicAppOrigin();

  const session = await s.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    // Lets a card stored in the firm's customer be reused for the
    // Customer Portal without re-prompting.
    payment_method_collection: "always",
    // 14-day free trial — matches the marketing copy on /pricing.
    subscription_data: {
      trial_period_days: 14,
      metadata: { firmId: args.firm.id, plan: args.plan, cadence },
    },
    metadata: { firmId: args.firm.id, plan: args.plan, cadence },
    success_url: `${origin}/settings/billing?checkout=success`,
    cancel_url: `${origin}/pricing?checkout=cancelled`,
  });

  if (!session.url) {
    throw new Error("Stripe returned a checkout session without a URL.");
  }
  return { url: session.url };
}

export async function createPortalSession(args: {
  firm: Firm;
  email: string | null;
}): Promise<{ url: string }> {
  const s = requireStripe();
  const customerId = await ensureStripeCustomer(args.firm, args.email);
  const origin = getPublicAppOrigin();
  const session = await s.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/settings/billing`,
  });
  return { url: session.url };
}
