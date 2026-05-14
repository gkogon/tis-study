/**
 * Public pricing page. Four tiers — Free Trial, Starter, Growth,
 * Enterprise — targeted at Atlanta engineering firms. CTAs route to
 * /signup with the plan + cadence preselected; the signup page hands
 * off to Stripe Checkout once the firm record exists.
 *
 * Monthly/annual toggle drives both the displayed prices and the
 * cadence query param attached to the upgrade CTAs. Annual is priced
 * at "2 months free" (~16.7% off) to lock in ARR.
 *
 * Enterprise is metered ($75/study) and not yet wired through Stripe
 * Checkout — its CTA is a mailto: to sales. The full metered-billing
 * implementation is tracked separately.
 */
import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Check, Building2, Copy, Check as CheckIcon } from "lucide-react";
import { SiteFooter } from "../components/site-footer";

const ENTERPRISE_EMAIL = "gkogon@simpleimpactstudies.com";

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
      "Full HCM / ITE / MUTCD citations",
      "White-labeled PDF",
    ],
  },
  {
    id: "starter",
    name: "Starter",
    blurb: "For solo PEs and small firms running occasional screening TIS.",
    prices: {
      monthly: { primary: "$599", cadence: "/month" },
      annual:  { primary: "$5,990", cadence: "/year", subtitle: "Save $1,198 — 2 months free" },
    },
    cta: (c) => ({ label: "Start 14-day trial", href: `/signup?plan=starter&cadence=${c}` }),
    features: [
      "3 seats",
      "10 studies / month",
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
      monthly: { primary: "$2,499", cadence: "/month" },
      annual:  { primary: "$24,990", cadence: "/year", subtitle: "Save $4,998 — 2 months free" },
    },
    cta: (c) => ({ label: "Start 14-day trial", href: `/signup?plan=growth&cadence=${c}` }),
    highlight: true,
    features: [
      "Unlimited seats",
      "30 studies / month",
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
      monthly: { primary: "$75", cadence: "/study", subtitle: "≈ $13K/mo at 170 studies" },
      annual:  { primary: "$10K", cadence: "/yr commit", subtitle: "+ $75/study overage" },
    },
    cta: () => ({ label: "Contact sales", href: "mailto:gkogon@simpleimpactstudies.com?subject=Enterprise%20plan%20inquiry" }),
    features: [
      "Unlimited seats",
      "Unlimited studies — metered $75/study",
      "Annual commit option (volume discount)",
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
    <div>
      <div className="max-w-6xl mx-auto px-4 py-8 space-y-12">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to home
          </Link>
        </div>

        <section className="text-center max-w-3xl mx-auto space-y-4">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-700">
            <Building2 className="w-3.5 h-3.5" />
            Pricing
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-tight">
            One subscription per firm.
            <br />
            <span className="text-blue-700">Every engineer included.</span>
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground">
            14-day trial on Starter & Growth. No credit card to start.
            Cancel anytime — you keep access until the end of your billing
            period. Annual billing saves about <strong>17%</strong>.
          </p>
          <div className="flex justify-center pt-2">
            <CadenceToggle value={cadence} onChange={setCadence} />
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-stretch">
          {TIERS.map((t) => (
            <TierCard key={t.id} tier={t} cadence={cadence} />
          ))}
        </section>

        <section className="border rounded-xl p-8 grid md:grid-cols-2 gap-6 bg-muted/30">
          <div>
            <h2 className="text-2xl font-bold mb-2">What counts as a study?</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Every successful run of any generator (TIS, Parking, Warrants,
              Sight Distance, Queuing, Road-Diet) counts as one study —
              regardless of how many times you re-open or re-print the PDF.
              Re-prints are free. If a generation errors out (bad coordinate,
              upstream timeout), it doesn't count.
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-2">What if we hit our cap?</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Generation is blocked until the next billing period or you
              upgrade. We show a warning before your last study and a clear
              block message after. Upgrade to the next tier from
              Settings → Billing and the new cap takes effect immediately.
              No surprise overage fees on Starter or Growth.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold text-center">Common questions</h2>
          <div className="space-y-2 max-w-2xl mx-auto">
            {FAQ.map((f) => (
              <details key={f.q} className="border rounded-lg p-4 group">
                <summary className="cursor-pointer font-semibold list-none flex items-center justify-between">
                  <span>{f.q}</span>
                  <span className="text-muted-foreground text-lg group-open:rotate-45 transition-transform">+</span>
                </summary>
                <div className="text-sm text-muted-foreground leading-relaxed mt-3">{f.a}</div>
              </details>
            ))}
          </div>
        </section>

        <section className="text-center space-y-4">
          <h2 className="text-2xl font-bold">Not sure which tier?</h2>
          <p className="text-muted-foreground">
            Start the Growth trial — it's our default for engineering firms.
            You can downgrade before the trial ends if it's more than you need.
          </p>
          <Link
            href={`/signup?plan=growth&cadence=${cadence}`}
            className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
            data-testid="link-default-trial"
          >
            Start 14-day Growth trial
          </Link>
        </section>
      </div>
      <SiteFooter />
    </div>
  );
}

const FAQ: { q: string; a: React.ReactNode }[] = [
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
    a: "Growth is a flat $2,499/mo with a 30-study cap. Enterprise removes the cap entirely and bills $75 per study (with an annual commitment option for finance teams that need a predictable budget number). If you're regularly running more than 30 screenings/month, Enterprise is the move — for sub-30 firms Growth is cheaper.",
  },
  {
    q: "What citations are included in every report?",
    a: "HCM 6th Ed., ITE Trip Generation 11th Ed., ITE Parking Generation 5th Ed., MUTCD 2009/2024, AASHTO Green Book 7th Ed., FHWA. Every figure on every page is footnoted to the specific table or equation it derives from.",
  },
  {
    q: "What happens if we run out of studies in a billing period?",
    a: "On Starter and Growth, generation is blocked until the next period or you upgrade — no surprise overage fees. On Enterprise, there's no cap; you just keep generating and the next invoice reflects the count.",
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
    <div className="inline-flex rounded-lg border bg-background p-1 text-sm">
      <button
        type="button"
        onClick={() => onChange("monthly")}
        className={
          "px-4 py-1.5 rounded-md transition-colors font-medium " +
          (value === "monthly" ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-muted-foreground hover:text-foreground")
        }
      >
        Monthly
      </button>
      <button
        type="button"
        onClick={() => onChange("annual")}
        className={
          "px-4 py-1.5 rounded-md transition-colors font-medium " +
          (value === "annual" ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900" : "text-muted-foreground hover:text-foreground")
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
  const ctaProps: any = isMailto ? { href: cta.href } : { href: cta.href };

  return (
    <div
      className={
        "rounded-xl p-6 flex flex-col space-y-4 " +
        (tier.highlight
          ? "border-2 border-slate-900 dark:border-slate-100 shadow-md"
          : "border border-border bg-background")
      }
      data-testid={`tier-card-${tier.id}`}
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold">{tier.name}</h3>
          {tier.highlight && (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
              Most popular
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed min-h-[40px]">{tier.blurb}</p>
      </div>
      <div>
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-bold">{price.primary}</span>
          {price.cadence && (
            <span className="text-muted-foreground text-sm">{price.cadence}</span>
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
        {...ctaProps}
        className={
          "inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-md transition-colors " +
          (tier.highlight
            ? "bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
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
 * handler (very common on Chrome/Edge where the user uses Gmail in
 * the browser instead of Outlook/Mail). Surfacing the address as
 * text + a copy button guarantees the prospect can always reach us,
 * regardless of OS / browser / mail-client config.
 */
function EnterpriseEmailFallback() {
  const [copied, setCopied] = useState(false);
  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(ENTERPRISE_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers without clipboard API: select a
      // hidden input. Cheap enough to inline.
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
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground border-t pt-3 mt-1">
      <span className="font-mono truncate">{ENTERPRISE_EMAIL}</span>
      <button
        type="button"
        onClick={copyEmail}
        className="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs hover:bg-accent shrink-0"
        aria-label="Copy email address"
      >
        {copied ? <CheckIcon className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
