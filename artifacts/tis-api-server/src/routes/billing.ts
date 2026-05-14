/**
 * Authenticated billing endpoints.
 *
 *   POST /billing/checkout-session
 *     body: { plan: "starter" | "growth", cadence?: "monthly" | "annual" }
 *     Resolves the user's firm, creates a Stripe Checkout Session for
 *     the chosen plan + cadence, returns the redirect URL. Defaults to
 *     monthly when cadence is omitted (back-compat for older callers).
 *
 *   POST /billing/portal-session
 *     Opens the Stripe Customer Portal so the firm can manage cards,
 *     invoices, and cancellations without leaving Stripe's UI.
 *
 *   GET  /billing/summary
 *     Lightweight snapshot for the /settings/billing page — plan, status,
 *     period dates, study usage. Avoids a round trip to Stripe on every
 *     page load.
 */
import { Router, type IRouter } from "express";
import { getOrCreateFirmForUser, getMembership } from "../lib/firms";
import {
  createCheckoutSession,
  createPortalSession,
  BillingDisabledError,
} from "../lib/billing";
import { PLANS, type PaidPlanId, type BillingCadence } from "../lib/stripe";

const router: IRouter = Router();

function isPaidPlanId(v: unknown): v is PaidPlanId {
  return typeof v === "string" && v in PLANS;
}

function isBillingCadence(v: unknown): v is BillingCadence {
  return v === "monthly" || v === "annual";
}

router.post("/billing/checkout-session", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to start checkout." });
    return;
  }
  const user = req.user!;
  const body = (req.body as { plan?: unknown; cadence?: unknown }) ?? {};
  const plan = body.plan;
  if (!isPaidPlanId(plan)) {
    res.status(400).json({ error: "Unknown plan." });
    return;
  }
  const cadence: BillingCadence = isBillingCadence(body.cadence) ? body.cadence : "monthly";
  try {
    const { firm, role } = await getOrCreateFirmForUser(user.id, {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    if (role !== "owner" && role !== "admin") {
      res.status(403).json({ error: "Only firm owners or admins can manage billing." });
      return;
    }
    const session = await createCheckoutSession({ firm, email: user.email, plan, cadence });
    res.json(session);
  } catch (err) {
    if (err instanceof BillingDisabledError) {
      res.status(503).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "billing.checkout_failed");
    res.status(500).json({ error: "Failed to start checkout." });
  }
});

router.post("/billing/portal-session", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to manage billing." });
    return;
  }
  const user = req.user!;
  try {
    const { firm, role } = await getOrCreateFirmForUser(user.id, {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    if (role !== "owner" && role !== "admin") {
      res.status(403).json({ error: "Only firm owners or admins can manage billing." });
      return;
    }
    if (!firm.stripeCustomerId) {
      res.status(400).json({
        error: "No active subscription yet — start one from the pricing page first.",
      });
      return;
    }
    const session = await createPortalSession({ firm, email: user.email });
    res.json(session);
  } catch (err) {
    if (err instanceof BillingDisabledError) {
      res.status(503).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "billing.portal_failed");
    res.status(500).json({ error: "Failed to open billing portal." });
  }
});

router.get("/billing/summary", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to view billing." });
    return;
  }
  const user = req.user!;
  try {
    const { firm } = await getOrCreateFirmForUser(user.id, {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    const membership = await getMembership(firm.id, user.id);
    res.json({
      firm: {
        id: firm.id,
        name: firm.name,
        slug: firm.slug,
        planTier: firm.planTier,
        subscriptionStatus: firm.subscriptionStatus,
        seatLimit: firm.seatLimit,
        studyLimit: firm.studyLimit,
        studiesUsedThisPeriod: firm.studiesUsedThisPeriod,
        currentPeriodEnd: firm.currentPeriodEnd?.toISOString() ?? null,
        currentPeriodStart: firm.currentPeriodStart?.toISOString() ?? null,
        hasStripeCustomer: !!firm.stripeCustomerId,
      },
      role: membership?.role ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "billing.summary_failed");
    res.status(500).json({ error: "Failed to load billing summary." });
  }
});

export default router;
