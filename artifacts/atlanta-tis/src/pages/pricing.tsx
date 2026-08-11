/**
 * Public pricing page. Pay-per-study is the headline offer (single-study
 * credits bought from Settings → Billing after signup); the four
 * subscription tiers — Free Trial, Starter, Growth, Enterprise — sit
 * below it as the volume-discount option. CTAs route to /signup with
 * the plan + cadence preselected; the signup page hands off to Stripe
 * Checkout once the firm record exists.
 *
 * Monthly/annual toggle drives both the displayed prices and the
 * cadence query param attached to the upgrade CTAs. Annual is priced
 * at "2 months free" (~16.7% off) to lock in ARR.
 *
 * All four tiers — including Enterprise, now a flat $10K/mo tier — route
 * through the same /signup → Stripe Checkout flow.
 *
 * Pay-per-study dollar labels MUST match the amounts configured on
 * STRIPE_PRICE_STUDY_INTRO / STRIPE_PRICE_STUDY_STANDARD (same
 * convention as settings-billing.tsx); the intro count mirrors
 * STUDY_INTRO_THRESHOLD in the API's stripe.ts.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Check, Copy, Check as CheckIcon } from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { Marker } from "../components/section-marker";

const ENTERPRISE_EMAIL = "gkogon@simpleimpactstudies.com";

// Pay-per-study rates. Keep in sync with the Stripe Prices behind
// STRIPE_PRICE_STUDY_INTRO / STRIPE_PRICE_STUDY_STANDARD and with
// STUDY_INTRO_THRESHOLD in the API's stripe.ts.
const STUDY_INTRO_PRICE = "$150";
const STUDY_STANDARD_PRICE = "$350";
const STUDY_INTRO_COUNT = 5;

type TierId = "trial" | "starter" | "growth" | "enterprise";
type Cadence = "monthly" | "annual";

type PriceLabel = { primary: string; cadence: string; subtitle?: string };

type Tier = {
  id: TierId;
  name: string;
  blurb: string;
  prices: Record<Cadence, PriceLabel>;
  cta: (c: Cadence) => { label: string; href: string };
  highlight?: boolean;
  features: string[];
};

const TIERS: Tier[] = [
  {
    id: "trial",
    name: "Free trial",
    blurb: "Run ten studies on the house — no credit card.",
    prices: {
      monthly: { primary: "$0", cadence: "" },
      annual:  { primary: "$0", cadence: "" },
    },
    cta: () => ({ label: "Start free", href: "/signup?plan=trial" }),
    features: [
      "10 studies, total",
      "1 seat",
      "All 6 study types",
      "Full HCM / NHTS / MUTCD citations",
      "White-labeled PDF",
    ],
  },
  {
    id: "starter",
    name: "Starter",
    blurb: "For solo PEs and small firms running occasional screening TIS.",
    prices: {
      monthly: { primary: "$1,500", cadence: "/month" },
      annual:  { primary: "$15,000", cadence: "/year", subtitle: "Save $3,000 — 2 months free" },
    },
    cta: (c) => ({ label: "Start 14-day trial", href: `/signup?plan=starter&cadence=${c}` }),
    features: [
      "3 seats",
      "5 studies / month",
      "All 6 study types",
      "White-labeled PDFs + firm logo",
      "Project history & re-print",
      "Email support",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    blurb: "The default for traffic engineering firms shipping studies every week.",
    prices: {
      monthly: { primary: "$5,000", cadence: "/month" },
      annual:  { primary: "$50,000", cadence: "/year", subtitle: "Save $10,000 — 2 months free" },
    },
    cta: (c) => ({ label: "Start 14-day trial", href: `/signup?plan=growth&cadence=${c}` }),
    highlight: true,
    features: [
      "Unlimited seats",
      "15 studies / month",
      "Everything in Starter",
      "Post-build Verification (Monitoring) included",
      "Firm-wide project library",
      "Member roles & invites",
      "Priority email support",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    blurb: "For multi-state firms and DOTs with high screening volume.",
    prices: {
      monthly: { primary: "$10,000", cadence: "/month" },
      annual:  { primary: "$100,000", cadence: "/year", subtitle: "Save $20,000 — 2 months free" },
    },
    cta: (c) => ({ label: "Start Enterprise", href: `/signup?plan=enterprise&cadence=${c}` }),
    features: [
      "Unlimited seats",
      "Unlimited studies — no cap",
      "Annual commitment option (2 months free)",
      "SSO (Okta, Azure AD)",
      "DPA & MSA on request",
      "Custom API / data integrations",
      "Quarterly business review",
      "Named technical contact",
    ],
  },
];

export default function PricingPage() {
  const [cadence, setCadence] = useState<Cadence>("monthly");

  return (
    <div className="overflow-x-hidden">
      <div className="relative">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 -z-10 h-[360px] bg-gradient-to-b from-slate-100/80 via-background to-background dark:from-slate-900/30"
        />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-10">
          <section className="max-w-3xl space-y-6">
            <div className="space-y-2">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Pricing
              </div>
              <div className="h-px w-full bg-border" />
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.04] text-slate-900 dark:text-slate-50">
              Pay per study. Your first {STUDY_INTRO_COUNT} are {STUDY_INTRO_PRICE} each.
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed">
              Sign up free and run ten studies on the house — no credit card.
              After that, buy exactly as many as the project needs:
              {" "}{STUDY_STANDARD_PRICE} a study, credits never expire, no
              subscription required. Firms shipping studies every week can
              subscribe below and bring the per-study cost down.
            </p>
          </section>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pb-20 space-y-20">
        <section>
          <div className="border border-border">
            <div className="p-6 sm:p-8 space-y-3 border-b border-border">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Buy studies one at a time.
              </h2>
              <p className="text-muted-foreground leading-relaxed max-w-2xl">
                One Stripe checkout per study, no monthly commitment. Every
                study is the full deliverable — same PDF, same citations, no
                tier gating. Buy from Settings&nbsp;→&nbsp;Billing once
                you're signed in.
              </p>
            </div>
            <div className="grid sm:grid-cols-3 gap-px bg-border">
              <div className="bg-background p-6 sm:p-8 space-y-2">
                <div className="flex items-baseline gap-1">
                  <span className="font-mono text-5xl sm:text-6xl font-bold tabular-nums tracking-tight">{STUDY_INTRO_PRICE}</span>
                  <span className="text-muted-foreground text-sm font-mono">/study</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Intro rate — your first {STUDY_INTRO_COUNT} studies, ever.
                </p>
              </div>
              <div className="bg-background p-6 sm:p-8 space-y-2">
                <div className="flex items-baseline gap-1">
                  <span className="font-mono text-5xl sm:text-6xl font-bold tabular-nums tracking-tight">{STUDY_STANDARD_PRICE}</span>
                  <span className="text-muted-foreground text-sm font-mono">/study</span>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  After that — flat, forever. No subscription required.
                </p>
              </div>
              <div className="bg-background p-6 sm:p-8 flex flex-col justify-between gap-4">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Credits never expire and stay spendable with no active
                  subscription. On a plan, they're used automatically once the
                  month's studies run out.
                </p>
                <Link
                  href="/signup?plan=trial"
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
                  data-testid="link-cta-pay-per-study"
                >
                  Start free, buy as you go
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section>
          <Marker n="01" label="Volume plans" />
          <div className="space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="space-y-3 max-w-2xl">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  Shipping studies every week? Subscribe.
                </h2>
                <p className="text-muted-foreground leading-relaxed">
                  Pay-per-study is how you start; a plan is the volume
                  discount once the math says so — on Starter a study works
                  out to $300, on Growth $333, and every engineer at the firm
                  is included. 14-day trial on Starter and Growth. Cancel
                  anytime — you keep access until the end of your billing
                  period. Annual billing saves about 17%.
                </p>
              </div>
              <CadenceToggle value={cadence} onChange={setCadence} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-border border border-border items-stretch">
              {TIERS.map((t) => (
                <TierCard key={t.id} tier={t} cadence={cadence} />
              ))}
            </div>
          </div>
        </section>

        <section>
          <Marker n="02" label="Fair use" />
          <div className="grid sm:grid-cols-2 gap-px bg-border border border-border">
            <div className="bg-background p-6 space-y-2">
              <h2 className="text-lg font-bold tracking-tight">What counts as a study?</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Every successful run of any generator (TIS, Parking,
                Warrants, Sight Distance, Queuing, Road-Diet) counts as one
                study — regardless of how many times you re-open or re-print
                the PDF. Re-prints are free. If a generation errors out (bad
                coordinate, upstream timeout), it doesn't count.
              </p>
            </div>
            <div className="bg-background p-6 space-y-2">
              <h2 className="text-lg font-bold tracking-tight">What if we hit our cap?</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Any pay-per-study credits on the account are used
                automatically. No credits? Buy one from Settings → Billing,
                upgrade (the new cap takes effect immediately), or wait for
                the next billing period. We show a warning before your last
                study and a clear message after — never a surprise overage
                fee.
              </p>
            </div>
          </div>
        </section>

        <section>
          <Marker n="03" label="Common questions" />
          <div className="divide-y divide-border border-y border-border">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-4">
                <summary className="cursor-pointer font-semibold list-none flex items-center justify-between gap-4">
                  <span>{f.q}</span>
                  <span className="text-muted-foreground text-lg group-open:rotate-45 transition-transform shrink-0">+</span>
                </summary>
                <div className="text-sm text-muted-foreground leading-relaxed mt-3">{f.a}</div>
              </details>
            ))}
          </div>
        </section>

        <section className="border border-border bg-slate-50 dark:bg-slate-950/40 px-6 sm:px-10 py-10 space-y-4">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Not sure where to start?</h2>
          <p className="text-muted-foreground leading-relaxed max-w-xl">
            Start free and pay per study — your first {STUDY_INTRO_COUNT} are
            {" "}{STUDY_INTRO_PRICE} each, and the volume math will tell you
            when a plan makes sense. Firms already shipping studies every week
            can jump straight to the 14-day Growth trial.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/signup?plan=trial"
              className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-lg bg-foreground text-background hover:bg-foreground/90 transition-all"
              data-testid="link-pay-per-study-fallback"
            >
              Start free, pay per study
            </Link>
            <Link
              href={`/signup?plan=growth&cadence=${cadence}`}
              className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-lg border border-border hover:bg-accent transition-colors"
              data-testid="link-default-trial"
            >
              Start 14-day Growth trial
            </Link>
          </div>
        </section>
      </div>
      <SiteFooter />
    </div>
  );
}

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Do we need a subscription?",
    a: `No — pay-per-study is the default. After the free trial, buy studies one at a time from Settings → Billing: ${STUDY_INTRO_PRICE} each for your first ${STUDY_INTRO_COUNT} purchases, then ${STUDY_STANDARD_PRICE} each. Each purchase is a credit on your firm — credits never expire and keep working even if you never subscribe or a subscription lapses. If you're running several studies a month, a volume plan is cheaper per study.`,
  },
  {
    q: "Is this a substitute for a stamped engineering deliverable?",
    a: <>No. Outputs are screening-grade and meant to support — not replace — a licensed PE's analytical workflow. See the <a href="/legal/disclaimer" className="text-blue-700 hover:underline">Engineering Disclaimer</a> for the full scope.</>,
  },
  {
    q: "Can multiple engineers in my firm use one account?",
    a: "Yes — that's the firm-account model. Starter includes 3 seats; Growth and Enterprise both include unlimited seats. Each seat is a separate sign-in for one of your engineers; all projects roll up to the firm.",
  },
  {
    q: "How does annual billing work?",
    a: "Same plan, billed once per year instead of monthly. The annual price is about 17% lower than 12 × the monthly price — that's roughly two free months. You can switch between monthly and annual at renewal time from Settings → Billing.",
  },
  {
    q: "What's the difference between Enterprise and Growth?",
    a: "Growth is a flat $5,000/mo with a 15-study cap. Enterprise is a flat $10,000/mo (or $100K/yr) with no cap, and adds SSO, a DPA/MSA, custom integrations, and a named contact. If you regularly run more than 15 screenings/month — or you need SSO and a signed contract — Enterprise is the move; otherwise Growth is cheaper.",
  },
  {
    q: "What citations are included in every report?",
    a: "HCM 6th Ed., public trip-generation data (NHTS 2017 / SANDAG 2002 / NCHRP 716), MUTCD 2009/2024, AASHTO Green Book 7th Ed., FHWA. Every figure on every page is footnoted to the specific table or equation it derives from.",
  },
  {
    q: "What happens if we run out of studies in a billing period?",
    a: "On Starter and Growth, any pay-per-study credits on the account are used automatically; with no credits, generation pauses until you buy one, upgrade, or the next period starts — no surprise overage fees. On Enterprise, there's no cap — it's flat monthly, so you just keep generating.",
  },
  {
    q: "Can we cancel anytime?",
    a: "Yes. From Settings → Billing you can cancel at any time. You keep access until the end of the billing period you've already paid for; then the account drops back to trial mode.",
  },
  {
    q: "Do you offer SSO?",
    a: "Enterprise tier only. Okta and Azure AD via OIDC.",
  },
  {
    q: "What about data privacy?",
    a: <>Project inputs and outputs stay private to your firm. We don't share them with third parties or use them to train external models. See the <a href="/legal/privacy" className="text-blue-700 hover:underline">Privacy Policy</a>.</>,
  },
];

function CadenceToggle({
  value, onChange,
}: { value: Cadence; onChange: (v: Cadence) => void }) {
  return (
    <div className="inline-flex border border-border bg-background p-1 text-sm">
      <button
        type="button"
        onClick={() => onChange("monthly")}
        className={
          "px-4 py-1.5 transition-colors font-medium " +
          (value === "monthly" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")
        }
      >
        Monthly
      </button>
      <button
        type="button"
        onClick={() => onChange("annual")}
        className={
          "px-4 py-1.5 transition-colors font-medium " +
          (value === "annual" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")
        }
      >
        Annual <span className="opacity-80 font-normal">· save 17%</span>
      </button>
    </div>
  );
}

function TierCard({ tier, cadence }: { tier: Tier; cadence: Cadence }) {
  const price = tier.prices[cadence];
  const cta = tier.cta(cadence);
  const isMailto = cta.href.startsWith("mailto:");
  const CtaTag: any = isMailto ? "a" : Link;

  return (
    <div
      className={
        "p-6 flex flex-col space-y-4 " +
        (tier.highlight
          ? "bg-blue-50/50 dark:bg-blue-950/20 ring-1 ring-inset ring-blue-700"
          : "bg-background")
      }
      data-testid={`tier-card-${tier.id}`}
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xl font-bold tracking-tight">{tier.name}</h3>
          {tier.highlight && (
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-700">
              Most popular
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed min-h-[40px]">{tier.blurb}</p>
      </div>
      <div>
        <div className="flex items-baseline gap-1">
          <span className="font-mono text-4xl font-bold tabular-nums tracking-tight">{price.primary}</span>
          {price.cadence && (
            <span className="text-muted-foreground text-sm font-mono">{price.cadence}</span>
          )}
        </div>
        {price.subtitle && (
          <div className="text-xs text-blue-700 font-medium mt-1">{price.subtitle}</div>
        )}
      </div>
      <ul className="space-y-2 text-sm flex-1">
        {tier.features.map((f) => (
          <li key={f} className="flex gap-2 items-start">
            <Check className="w-4 h-4 text-blue-700 mt-0.5 shrink-0" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <CtaTag
        href={cta.href}
        className={
          "inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-lg transition-colors " +
          (tier.highlight
            ? "bg-foreground text-background hover:bg-foreground/90"
            : "border border-border hover:bg-accent")
        }
        data-testid={`link-cta-${tier.id}`}
      >
        {cta.label}
      </CtaTag>
      {tier.id === "enterprise" && <EnterpriseEmailFallback />}
    </div>
  );
}

/**
 * Visible copyable email under the Enterprise CTA. The plain mailto:
 * link silently fails on desktop browsers without a registered mail
 * handler (common on Chrome/Edge). Surfacing the address as text + a
 * copy button guarantees the prospect can always reach us.
 */
function EnterpriseEmailFallback() {
  const [copied, setCopied] = useState(false);
  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(ENTERPRISE_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement("input");
      input.value = ENTERPRISE_EMAIL;
      document.body.appendChild(input);
      input.select();
      try { document.execCommand("copy"); } catch { /* swallow */ }
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground border-t border-border pt-3 mt-1">
      <span className="font-mono truncate">{ENTERPRISE_EMAIL}</span>
      <button
        type="button"
        onClick={copyEmail}
        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border text-xs hover:bg-accent shrink-0"
        aria-label="Copy email address"
      >
        {copied ? <CheckIcon className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
