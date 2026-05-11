/**
 * Public pricing page. Three tiers — Starter, Growth, Enterprise —
 * targeted at Atlanta engineering firms. CTAs route to /signup with the
 * plan preselected; the signup page hands off to Stripe Checkout once
 * the firm record exists.
 */
import { Link } from "wouter";
import { ArrowLeft, Check, Building2 } from "lucide-react";
import { SiteFooter } from "../components/site-footer";

type Tier = {
  id: "starter" | "growth" | "enterprise";
  name: string;
  blurb: string;
  priceLabel: string;
  cadence: string;
  cta: { label: string; href: string };
  highlight?: boolean;
  features: string[];
};

const TIERS: Tier[] = [
  {
    id: "starter",
    name: "Starter",
    blurb: "For solo PEs and small firms running occasional screening TIS.",
    priceLabel: "$499",
    cadence: "/month",
    cta: { label: "Start free trial", href: "/signup?plan=starter" },
    features: [
      "3 seats",
      "10 studies / month — any type",
      "Traffic Impact + Parking Demand studies",
      "White-labeled PDFs",
      "Full HCM / ITE / MUTCD citations",
      "Project history & re-print",
      "Email support",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    blurb: "The default for traffic engineering firms shipping studies every week.",
    priceLabel: "$1,299",
    cadence: "/month",
    cta: { label: "Start free trial", href: "/signup?plan=growth" },
    highlight: true,
    features: [
      "10 seats",
      "30 studies / month — any type",
      "Traffic Impact + Parking + Signal Warrants (soon)",
      "Everything in Starter",
      "Firm-wide project library",
      "Member roles & invites",
      "Priority email support",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    blurb: "For large firms with multi-office practices, SSO, and volume needs.",
    priceLabel: "Custom",
    cadence: "",
    cta: { label: "Talk to us", href: "/for-firms#contact" },
    features: [
      "Unlimited seats",
      "Custom study volume & overage",
      "SSO (Okta, Azure AD)",
      "DPA & MSA on request",
      "Onboarding for each office",
      "Named technical contact",
    ],
  },
];

export default function PricingPage() {
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
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-600">
            <Building2 className="w-3.5 h-3.5" />
            Pricing
          </div>
          <h1 className="text-5xl font-bold leading-tight">
            One subscription per firm.
            <br />
            <span className="text-blue-600">Every engineer included.</span>
          </h1>
          <p className="text-lg text-muted-foreground">
            14-day trial on Starter & Growth. No credit card to start. Cancel anytime —
            you keep access until the end of your billing period.
          </p>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
          {TIERS.map((t) => (
            <TierCard key={t.id} tier={t} />
          ))}
        </section>

        <section className="border rounded-xl p-8 grid md:grid-cols-2 gap-6 bg-muted/30">
          <div>
            <h2 className="text-2xl font-bold mb-2">What counts as a study?</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Every successful run of the TIS generator counts as one study —
              regardless of how many times you re-open or re-print the PDF.
              Re-prints are free. If a generation errors out (bad coordinate,
              upstream timeout), it doesn't count.
            </p>
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-2">What if we hit our cap?</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You'll see a soft block before your last study, and a hard block
              if you try to run another. Upgrade to the next tier from
              Settings → Billing and the new cap takes effect immediately.
              No overage fees, no surprise invoices.
            </p>
          </div>
        </section>

        <section className="text-center space-y-4">
          <h2 className="text-2xl font-bold">Not sure which tier?</h2>
          <p className="text-muted-foreground">
            Start the Growth trial — it's our default for engineering firms.
            You can downgrade before the trial ends if it's more than you need.
          </p>
          <Link
            href="/signup?plan=growth"
            className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
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

function TierCard({ tier }: { tier: Tier }) {
  return (
    <div
      className={
        "rounded-xl p-6 flex flex-col space-y-4 " +
        (tier.highlight
          ? "border-2 border-blue-600 bg-blue-50/40 dark:bg-blue-950/20 shadow-md"
          : "border border-border bg-background")
      }
      data-testid={`tier-card-${tier.id}`}
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-bold">{tier.name}</h3>
          {tier.highlight && (
            <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-600 text-white">
              Most popular
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">{tier.blurb}</p>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-4xl font-bold">{tier.priceLabel}</span>
        {tier.cadence && (
          <span className="text-muted-foreground text-sm">{tier.cadence}</span>
        )}
      </div>
      <ul className="space-y-2 text-sm flex-1">
        {tier.features.map((f) => (
          <li key={f} className="flex gap-2 items-start">
            <Check className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link
        href={tier.cta.href}
        className={
          "inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-md transition-colors " +
          (tier.highlight
            ? "bg-blue-600 text-white hover:bg-blue-700"
            : "border border-border hover:bg-accent")
        }
        data-testid={`link-cta-${tier.id}`}
      >
        {tier.cta.label}
      </Link>
    </div>
  );
}
