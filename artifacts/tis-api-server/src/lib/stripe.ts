/**
 * Stripe client + plan registry.
 *
 * Plans are configured via env vars so we can use real Stripe Price IDs
 * without committing them to source. Each paid tier has both a monthly
 * and an annual price; the annual one is sold at "2 months free"
 * (~16.7% discount) to lock in ARR.
 *
 * Tier limits applied on subscription activation:
 *   - Starter: 3 seats, 10 studies / month
 *   - Growth:  unlimited seats, 30 studies / month
 *
 * Enterprise is metered (per-study) and not represented in this
 * registry — it's wired separately because it doesn't fit a fixed
 * "Price ID → limits" mapping.
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
export type BillingCadence = "monthly" | "annual";

// 999 is the "unlimited" sentinel for seat caps — high enough that no
// real firm bumps into it, low enough that quota math doesn't overflow.
export const SEAT_UNLIMITED = 999;

export type PlanConfig = {
  id: PaidPlanId;
  name: string;
  // Env-var names for the two cadences. The optional legacyMonthly
  // entry lets us keep honoring the older STRIPE_PRICE_STARTER /
  // STRIPE_PRICE_GROWTH names without forcing a same-day Railway env
  // change — useful during the price migration.
  priceEnvs: {
    monthly: string;
    annual: string;
    legacyMonthly?: string;
  };
  seatLimit: number;
  studyLimit: number;
};

export const PLANS: Record<PaidPlanId, PlanConfig> = {
  starter: {
    id: "starter",
    name: "Starter",
    priceEnvs: {
      monthly: "STRIPE_PRICE_STARTER_MONTHLY",
      annual: "STRIPE_PRICE_STARTER_ANNUAL",
      legacyMonthly: "STRIPE_PRICE_STARTER",
    },
    seatLimit: 3,
    studyLimit: 10,
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceEnvs: {
      monthly: "STRIPE_PRICE_GROWTH_MONTHLY",
      annual: "STRIPE_PRICE_GROWTH_ANNUAL",
      legacyMonthly: "STRIPE_PRICE_GROWTH",
    },
    seatLimit: SEAT_UNLIMITED,
    studyLimit: 30,
  },
};

/**
 * Pick the Stripe Price ID for {plan, cadence}. Falls back to the
 * legacy monthly env var when the new `*_MONTHLY` one isn't set yet
 * (so the existing Starter/Growth products stay live until the user
 * provisions the new ones).
 */
export function resolvePriceId(
  plan: PaidPlanId,
  cadence: BillingCadence = "monthly",
): string | null {
  const p = PLANS[plan];
  if (cadence === "annual") {
    return process.env[p.priceEnvs.annual] ?? null;
  }
  const monthly = process.env[p.priceEnvs.monthly];
  if (monthly) return monthly;
  if (p.priceEnvs.legacyMonthly) {
    return process.env[p.priceEnvs.legacyMonthly] ?? null;
  }
  return null;
}

/**
 * Reverse lookup: given a Stripe Price ID from a webhook event, figure
 * out which plan it corresponds to. Returns null if the price doesn't
 * match any configured tier — protects us from honoring a stale or
 * misconfigured subscription. Checks every env var (monthly, annual,
 * legacy) so customers on either cadence get correctly mapped.
 */
export function resolvePlanFromPriceId(priceId: string): PlanConfig | null {
  for (const plan of Object.values(PLANS)) {
    const envNames: string[] = [
      plan.priceEnvs.monthly,
      plan.priceEnvs.annual,
      ...(plan.priceEnvs.legacyMonthly ? [plan.priceEnvs.legacyMonthly] : []),
    ];
    for (const name of envNames) {
      if (process.env[name] === priceId) return plan;
    }
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

/**
 * Email address shown on the Enterprise CTA + "Contact Sales" links.
 * Configurable so we can route enterprise leads to a dedicated alias
 * later without a code push.
 */
export function getEnterpriseContactEmail(): string {
  return process.env.ENTERPRISE_CONTACT_EMAIL ?? "sales@simpleimpactstudies.com";
}
