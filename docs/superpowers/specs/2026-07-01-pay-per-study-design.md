# Pay-per-study credits — design spec (2026-07-01)

## Problem
Pre-revenue. Pricing is monthly-subscription only, which forces a project-based
buyer (solo PE / small firm) to pay while idle → high friction, poor fit. We need
a low-friction paid path that matches how the work actually arrives (per project),
while steering volume users toward the recurring subscription.

## Pricing model (dollar amounts live in Stripe env vars — retune without a deploy)
- **Free trial: unchanged.** Protects the free-first-study outbound wedge.
- **After trial → pay-per-study**, one study at a time:
  - First 5 *purchased* studies (lifetime): **intro rate** (`STRIPE_PRICE_STUDY_INTRO`, ~$150).
  - 6th purchased onward: **standard rate** (`STRIPE_PRICE_STUDY_STANDARD`, ~$350).
- **Monthly subscription = the discount path** (existing tiers). The $350 standard
  rate is the anchor that makes subscribing the rational choice for volume users.

## Data model (new columns on `firms`)
- `study_credits_remaining INTEGER NOT NULL DEFAULT 0` — banked prepaid studies.
  Permanent; never reset by billing periods; stacks on top of any plan/trial.
- `studies_purchased_lifetime INTEGER NOT NULL DEFAULT 0` — decides intro vs
  standard rate at checkout.

Applied in three places (established pattern): Drizzle schema
`lib/db/src/schema/firms.ts`, the deploy migration `lib/db/migrate.mjs`
(`ALTER TABLE firms ADD COLUMN IF NOT EXISTS ...`), and the local mirror
`scripts/local-schema.sql`.

## Purchase flow
`POST /billing/study-purchase-session` (owner/admin only) → `createStudyPurchaseCheckout()`:
- rate = `firm.studiesPurchasedLifetime < STUDY_INTRO_THRESHOLD (5)` ? intro : standard
- Stripe Checkout **`mode: "payment"`** (one-time, NOT subscription), quantity 1,
  metadata `{ firmId, kind: "study_purchase", credits: "1", rate }`.
- Works for trial firms (no subscription required) — the trial→paid path.

## Grant (webhook)
`onCheckoutCompleted` splits by `session.mode`:
- `"subscription"` → existing logic, untouched.
- `"payment"` → `study_credits_remaining += credits`,
  `studies_purchased_lifetime += credits`, link customer only.
  **MUST NOT touch `stripeSubscriptionId`** (the existing handler would null it —
  the one real bug this design routes around).
- Idempotency: the global event-id dedup already prevents double-granting on replay.

## Spend (`reserveStudySlot`) — perishable bucket first
```
unlimited?                    -> ok (source: "unlimited")
not delinquent & period slot? -> charge period quota (source: "period")
credits > 0?                  -> consume 1 credit    (source: "credit")  [works even if delinquent]
else                          -> 402 (delinquent ? subscription_delinquent : quota_exceeded)
```
Rationale: period quota is use-it-or-lose-it, so burn it first and preserve the
permanent prepaid credits. Purchased credits remain spendable even if a
subscription lapses — they're prepaid, not subscription access.

## Refund correctness
`QuotaCheck` gains `source: "unlimited" | "period" | "credit"`. `releaseStudySlot`
refunds the bucket that was charged, so a generation failure after a **credit** was
spent returns the credit — a paying customer never loses a study to a server error.
The 5 engine routes pass `source` from the reservation into the release call.

## Surface
- `/billing/summary` returns `studyCreditsRemaining`, `studiesPurchasedLifetime`,
  and the current `nextStudyRate` so the UI shows the right price.
- `settings-billing.tsx`: isolated "Buy a study" card (current rate + credit
  balance + "subscribe monthly to save" nudge). Kept self-contained to avoid
  colliding with the unmerged `feat/pricing-display-sweep` branch.

## Out of scope (YAGNI until customers exist)
Usage metering, credit expiry/refunds, multi-study cart (mixed intro/standard
math), gifting, annual auto-refill.

## Rollout
Branch `feat/pay-per-study` off `origin/main`. Build + typecheck locally. Before
prod: create the 2 one-time Stripe Prices (test mode), set env vars, verify a test
purchase grants a credit and a generation consumes it, THEN merge. Keys never leave
the user's Stripe account; Price IDs are env vars.

## Env vars to add
```
STRIPE_PRICE_STUDY_INTRO      # one-time Price, ~$150
STRIPE_PRICE_STUDY_STANDARD   # one-time Price, ~$350
```
