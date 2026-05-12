/**
 * Stripe client + plan registry.
 *
 * Plans are configured via env vars so we can use real Stripe Price IDs
 * without committing them to source. Each tier maps to:
 *   - Stripe Price ID (recurring monthly)
 *   - seat & study limits applied on subscription activation
 *
 * The webhook handler ([routes/stripe-webhook.ts]) translates Stripe
 * lifecycle events into firm state mutations. The checkout-session
 * endpoint ([routes/billing.ts]) creates Stripe Customers lazily on the
 * first billing action.
 */
import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  // Throwing here would crash the server in environments where billing
  // is not yet provisioned (local dev pre-Stripe-setup). Log a warning
  // and let billing routes return 503 on use.
  console.warn(
    "STRIPE_SECRET_KEY not set — billing endpoints will return 503.",
  );
}

export const stripe: Stripe | null = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      // Pin the API version so a Stripe-side change can't silently
      // break our webhook handling.
      apiVersion: "2024-12-18.acacia" as Stripe.LatestApiVersion,
    })
  : null;

export type PaidPlanId = "starter" | "growth";

export type PlanConfig = {
  id: PaidPlanId;
  name: string;
  priceEnv: string;
  seatLimit: number;
  studyLimit: number;
};

export const PLANS: Record<PaidPlanId, PlanConfig> = {
  starter: {
    id: "starter",
    name: "Starter",
    priceEnv: "STRIPE_PRICE_STARTER",
    seatLimit: 3,
    studyLimit: 10,
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceEnv: "STRIPE_PRICE_GROWTH",
    seatLimit: 10,
    studyLimit: 30,
  },
};

export function resolvePriceId(plan: PaidPlanId): string | null {
  return process.env[PLANS[plan].priceEnv] ?? null;
}

/**
 * Reverse lookup: given a Stripe Price ID from a webhook event, figure
 * out which plan it corresponds to. Returns null if the price doesn't
 * match any configured tier — protects us from honoring a stale or
 * misconfigured subscription.
 */
export function resolvePlanFromPriceId(priceId: string): PlanConfig | null {
  for (const plan of Object.values(PLANS)) {
    if (process.env[plan.priceEnv] === priceId) return plan;
  }
  return null;
}

export function getWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET ?? null;
}

export function getPublicAppOrigin(): string {
  // App origin for success/cancel return URLs and outbound email
  // links. Set `PUBLIC_APP_ORIGIN` in production (Railway / wherever)
  // to your real domain. Falls back to localhost for dev.
  return (process.env.PUBLIC_APP_ORIGIN ?? "http://localhost:5173").replace(/\/+$/, "");
}
