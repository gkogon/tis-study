/**
 * Reusable trial / demo request form. Captures firm details and intended
 * tier, then POSTs to the existing /api/atlanta/leads endpoint. Designed to
 * be embedded in the pricing page and the for-firms landing page.
 */
import { useEffect, useState } from "react";
import { useCreateLead } from "@workspace/tis-api-client-react";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface Props {
  defaultTier?: "solo" | "practice" | "enterprise";
  source: "pricing_page" | "for_firms_page" | "trial_request";
  heading?: string;
  subheading?: string;
  ctaLabel?: string;
}

const TIER_LABELS: Record<string, string> = {
  solo: "Solo / Trial — $199/mo",
  practice: "Practice — $1,500/mo",
  enterprise: "Enterprise — Contact for pricing",
};

export function TrialRequestForm({
  defaultTier = "practice",
  source,
  heading = "Start a 14-day trial",
  subheading = "Tell us about your firm and we'll reply within one business day with a trial link.",
  ctaLabel = "Request trial",
}: Props) {
  const create = useCreateLead();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [city, setCity] = useState("");
  const [role, setRole] = useState("");
  const [tier, setTier] = useState(defaultTier);
  // Sync tier when the parent changes defaultTier (e.g., user clicks a
  // different plan CTA on the pricing page). Without this, useState's
  // initial-value-only behavior would freeze the tier at first mount.
  useEffect(() => {
    setTier(defaultTier);
  }, [defaultTier]);
  const [studiesPerMonth, setStudiesPerMonth] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  // Honeypot — must stay empty. Real users never see or fill this.
  const [website, setWebsite] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Encode the structured fields the OpenAPI Lead schema doesn't natively
    // model into the free-text `message` field — see the leads endpoint.
    const enrichedMessage = [
      `Tier requested: ${TIER_LABELS[tier] ?? tier}`,
      studiesPerMonth ? `Studies/month: ${studiesPerMonth}` : null,
      message ? `\nNotes:\n${message}` : null,
    ].filter(Boolean).join("\n");

    create.mutate(
      {
        data: {
          name,
          email,
          organization,
          city,
          role: role || undefined,
          message: enrichedMessage,
          productInterest: tier,
          source,
          website: website || undefined,
        },
      },
      {
        onSuccess: () => setSubmitted(true),
      },
    );
  }

  if (submitted) {
    return (
      <div
        className="rounded-lg border-2 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-6 text-center"
        data-testid="trial-request-success"
      >
        <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
        <h3 className="text-lg font-semibold text-emerald-900 dark:text-emerald-100">
          Request received
        </h3>
        <p className="text-sm text-emerald-800 dark:text-emerald-200 mt-1">
          We'll email you within one business day with a trial link and onboarding details.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border bg-background p-6 shadow-sm"
      data-testid="trial-request-form"
    >
      <div>
        <h3 className="text-lg font-semibold">{heading}</h3>
        <p className="text-sm text-muted-foreground mt-0.5">{subheading}</p>
      </div>

      {/* Honeypot — visually hidden, off the tab order. Bots tend to fill every
          field; legit users never see this and never submit a value. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", height: 0, width: 0, overflow: "hidden" }}>
        <label>
          Website
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Your name *">
          <input
            required
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            data-testid="input-trial-name"
          />
        </Field>
        <Field label="Work email *">
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
            data-testid="input-trial-email"
          />
        </Field>
        <Field label="Firm / company *">
          <input
            required
            type="text"
            placeholder="e.g. Croy Engineering"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            className="input"
            data-testid="input-trial-org"
          />
        </Field>
        <Field label="City *">
          <input
            required
            type="text"
            placeholder="Atlanta, GA"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="input"
            data-testid="input-trial-city"
          />
        </Field>
        <Field label="Your role">
          <input
            type="text"
            placeholder="Practice Lead, Sr. Engineer, etc."
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="input"
          />
        </Field>
        <Field label="TIS studies / month">
          <input
            type="text"
            placeholder="e.g. ~12"
            value={studiesPerMonth}
            onChange={(e) => setStudiesPerMonth(e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Plan of interest" className="md:col-span-2">
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as typeof tier)}
            className="input"
            data-testid="select-trial-tier"
          >
            <option value="solo">Solo / Trial — $199/mo</option>
            <option value="practice">Practice — $1,500/mo</option>
            <option value="enterprise">Enterprise — Contact for pricing</option>
          </select>
        </Field>
        <Field label="Anything else?" className="md:col-span-2">
          <textarea
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="input resize-none"
            placeholder="Optional — current pain points, integrations needed, etc."
          />
        </Field>
      </div>

      {create.error && (
        <div className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/30 border border-red-200 rounded p-3">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {create.error instanceof Error ? create.error.message : "Something went wrong submitting your request."}
          </span>
        </div>
      )}

      <button
        type="submit"
        disabled={create.isPending}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        data-testid="button-submit-trial"
      >
        {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
        {create.isPending ? "Submitting…" : ctaLabel}
      </button>

      <p className="text-[10px] text-muted-foreground text-center">
        We'll only use your information to set up your trial. No marketing emails, ever.
      </p>

      <style>{`
        .input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border-radius: 0.375rem;
          border: 1px solid hsl(var(--border));
          background: hsl(var(--background));
          font-size: 0.875rem;
        }
        .input:focus {
          outline: 2px solid #2563eb;
          outline-offset: 1px;
        }
      `}</style>
    </form>
  );
}

function Field({
  label, children, className = "",
}: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`space-y-1 ${className}`}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
