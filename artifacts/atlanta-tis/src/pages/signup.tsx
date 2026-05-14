/**
 * Firm signup. Phase-13 rewrite: email + password replaces the Replit
 * OIDC redirect. One form collects everything we need to create both a
 * user and a firm in a single submit; after that we either redirect to
 * Stripe Checkout (paid plan) or to /tis (free trial).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  ArrowLeft, Building2, ArrowRight, Loader2, ShieldCheck, AlertCircle,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

type Plan = "starter" | "growth" | "trial";
type Cadence = "monthly" | "annual";

const PLAN_LABEL: Record<Plan, string> = {
  starter: "Starter — $599/mo",
  growth: "Growth — $1,499/mo",
  trial: "Free trial",
};

function readPlanFromUrl(): { plan: Plan; cadence: Cadence } {
  const sp = new URLSearchParams(window.location.search);
  const rawPlan = sp.get("plan");
  const rawCadence = sp.get("cadence");
  const plan: Plan = rawPlan === "starter" || rawPlan === "growth" ? rawPlan : "trial";
  const cadence: Cadence = rawCadence === "annual" ? "annual" : "monthly";
  return { plan, cadence };
}

export default function SignupPage() {
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const [, navigate] = useLocation();
  const { plan, cadence } = useMemo(readPlanFromUrl, []);

  // Account fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  // Firm field
  const [firmName, setFirmName] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingFirm, setExistingFirm] = useState<{ id: string; name: string } | null>(null);
  const [checkingFirm, setCheckingFirm] = useState(false);

  // If already signed in, check whether a firm already exists for the
  // user so we can skip the create form and route them to checkout / app.
  useEffect(() => {
    if (!isAuthenticated) return;
    setCheckingFirm(true);
    fetch("/tis-api/firms/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.firm) setExistingFirm({ id: data.firm.id, name: data.firm.name });
      })
      .catch(() => {})
      .finally(() => setCheckingFirm(false));
  }, [isAuthenticated]);

  async function createFirmThenContinue() {
    const r = await fetch("/tis-api/firms", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: firmName.trim() }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error ?? "Could not create firm.");
    await goToNextStep();
  }

  async function goToNextStep() {
    if (plan === "trial") {
      window.location.href = "/tis";
      return;
    }
    const r = await fetch("/tis-api/billing/checkout-session", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, cadence }),
    });
    const data = await r.json();
    if (!r.ok || !data?.url) {
      throw new Error(data?.error ?? "Could not start checkout. You can upgrade later from billing.");
    }
    window.location.href = data.url;
  }

  /** Full signup flow for new visitors — account + firm in one submit. */
  async function handleNewAccountSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!acceptedTerms) {
      setError("Please review and accept the Terms, Privacy Policy, and Engineering Disclaimer.");
      return;
    }
    if (!firmName.trim()) {
      setError("Firm name is required.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/tis-api/auth/signup", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? "Signup failed.");
      // Account exists + session is set; now create the firm.
      await createFirmThenContinue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed.");
      setSubmitting(false);
    }
  }

  /** Flow for already-signed-in user without a firm yet. */
  async function handleFirmOnlySubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!acceptedTerms) {
      setError("Please review and accept the Terms, Privacy Policy, and Engineering Disclaimer.");
      return;
    }
    if (!firmName.trim()) {
      setError("Firm name is required.");
      return;
    }
    setSubmitting(true);
    try {
      await createFirmThenContinue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create firm.");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-10">
        <div>
          <Link href="/pricing" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to pricing
          </Link>
        </div>

        <section className="text-center space-y-3">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-600">
            <Building2 className="w-3.5 h-3.5" /> Start your firm trial
          </div>
          <h1 className="text-4xl font-bold leading-tight">Set up your firm account</h1>
          <p className="text-muted-foreground">
            Selected plan: <strong>{PLAN_LABEL[plan]}</strong>{" "}
            <Link href="/pricing" className="text-blue-600 hover:underline ml-1">change</Link>
          </p>
        </section>

        <section className="border rounded-xl p-8 space-y-6 bg-background">
          {authLoading || checkingFirm ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : isAuthenticated && existingFirm ? (
            <AlreadyHaveFirm
              firmName={existingFirm.name}
              plan={plan}
              onContinue={goToNextStep}
              submitting={submitting}
              setError={setError}
              setSubmitting={setSubmitting}
            />
          ) : isAuthenticated ? (
            <FirmOnlyForm
              firmName={firmName}
              setFirmName={setFirmName}
              acceptedTerms={acceptedTerms}
              setAcceptedTerms={setAcceptedTerms}
              onSubmit={handleFirmOnlySubmit}
              submitting={submitting}
              userName={user ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || (user.email ?? "") : ""}
              plan={plan}
            />
          ) : (
            <NewAccountForm
              email={email} setEmail={setEmail}
              password={password} setPassword={setPassword}
              firstName={firstName} setFirstName={setFirstName}
              lastName={lastName} setLastName={setLastName}
              firmName={firmName} setFirmName={setFirmName}
              acceptedTerms={acceptedTerms} setAcceptedTerms={setAcceptedTerms}
              onSubmit={handleNewAccountSubmit}
              submitting={submitting}
              plan={plan}
            />
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5" /> {error}
            </div>
          )}
        </section>

        <section className="grid md:grid-cols-3 gap-3 text-sm text-muted-foreground">
          <Reassurance icon={ShieldCheck} title="No card to start">
            We don't ask for payment until your trial ends.
          </Reassurance>
          <Reassurance icon={Building2} title="One firm, many engineers">
            Invite your team once the firm is created.
          </Reassurance>
          <Reassurance icon={ArrowRight} title="Cancel anytime">
            Keep access until the end of your billing period.
          </Reassurance>
        </section>
      </div>
      <SiteFooter />
    </div>
  );
}

// ---------- New-account form (most common entry point) ----------

function NewAccountForm({
  email, setEmail, password, setPassword,
  firstName, setFirstName, lastName, setLastName,
  firmName, setFirmName, acceptedTerms, setAcceptedTerms,
  onSubmit, submitting, plan,
}: {
  email: string; setEmail: (v: string) => void;
  password: string; setPassword: (v: string) => void;
  firstName: string; setFirstName: (v: string) => void;
  lastName: string; setLastName: (v: string) => void;
  firmName: string; setFirmName: (v: string) => void;
  acceptedTerms: boolean; setAcceptedTerms: (v: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
  plan: Plan;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="First name">
          <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" className="input" data-testid="input-signup-first" />
        </Field>
        <Field label="Last name">
          <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" className="input" data-testid="input-signup-last" />
        </Field>
      </div>
      <Field label="Work email">
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" className="input" data-testid="input-signup-email" />
      </Field>
      <Field label="Password">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} autoComplete="new-password" className="input" data-testid="input-signup-password" />
        <span className="text-xs text-muted-foreground">At least 10 characters.</span>
      </Field>
      <Field label="Firm name">
        <input
          type="text" value={firmName} onChange={(e) => setFirmName(e.target.value)}
          placeholder="e.g. Croy Engineering" required maxLength={120}
          className="input"
          data-testid="input-signup-firm"
        />
        <span className="text-xs text-muted-foreground">Appears on your white-labeled PDFs. You can change it later.</span>
      </Field>
      <TermsCheckbox accepted={acceptedTerms} setAccepted={setAcceptedTerms} />
      <button
        type="submit"
        disabled={submitting || !acceptedTerms}
        className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        data-testid="button-signup-submit"
      >
        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
        {plan === "trial" ? "Create account & start" : "Create account & continue to checkout"}
        <ArrowRight className="w-4 h-4" />
      </button>
      <p className="text-xs text-muted-foreground">
        Already have an account? <Link href="/login" className="text-blue-600 hover:underline">Sign in</Link>
      </p>

      <style>{`.input { width: 100%; border-radius: 0.375rem; border: 1px solid hsl(var(--input)); background: var(--background); padding: 0.5rem 0.75rem; font-size: 0.875rem; }
      .input:focus { outline: 2px solid #2563eb; outline-offset: 1px; }`}</style>
    </form>
  );
}

// ---------- Already-signed-in but no firm yet ----------

function FirmOnlyForm({
  firmName, setFirmName, acceptedTerms, setAcceptedTerms, onSubmit, submitting, userName, plan,
}: {
  firmName: string; setFirmName: (v: string) => void;
  acceptedTerms: boolean; setAcceptedTerms: (v: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
  userName: string;
  plan: Plan;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="text-sm">
        Signed in as <strong>{userName}</strong>. Just need a firm name and you're in.
      </div>
      <Field label="Firm name">
        <input
          type="text" value={firmName} onChange={(e) => setFirmName(e.target.value)}
          placeholder="e.g. Croy Engineering" required maxLength={120}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          data-testid="input-firm-name"
        />
      </Field>
      <TermsCheckbox accepted={acceptedTerms} setAccepted={setAcceptedTerms} />
      <button
        type="submit"
        disabled={submitting || !acceptedTerms}
        className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        data-testid="button-create-firm"
      >
        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
        {plan === "trial" ? "Create firm & start" : "Create firm & continue to checkout"}
        <ArrowRight className="w-4 h-4" />
      </button>
    </form>
  );
}

// ---------- Already-signed-in WITH firm ----------

function AlreadyHaveFirm({
  firmName, plan, onContinue, submitting, setError, setSubmitting,
}: {
  firmName: string;
  plan: Plan;
  onContinue: () => Promise<void>;
  submitting: boolean;
  setError: (s: string | null) => void;
  setSubmitting: (b: boolean) => void;
}) {
  async function go() {
    setError(null);
    setSubmitting(true);
    try {
      await onContinue();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't continue.");
      setSubmitting(false);
    }
  }
  if (plan === "trial") {
    return (
      <div className="space-y-3 text-center">
        <h2 className="text-xl font-semibold">You're all set</h2>
        <p className="text-muted-foreground text-sm">
          Firm <strong>{firmName}</strong>. Head to the generator to run your first study.
        </p>
        <Link href="/tis" className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700">
          Go to TIS generator <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-3 text-center">
      <h2 className="text-xl font-semibold">You already have a firm</h2>
      <p className="text-muted-foreground text-sm">
        <strong>{firmName}</strong>. Continue to start the {PLAN_LABEL[plan]} subscription.
      </p>
      <button
        type="button" onClick={go} disabled={submitting}
        className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
        Continue to checkout <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ---------- Shared bits ----------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5 block">
      <div className="text-sm font-medium">{label}</div>
      {children}
    </label>
  );
}

function TermsCheckbox({
  accepted, setAccepted,
}: { accepted: boolean; setAccepted: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm cursor-pointer">
      <input
        type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)}
        required className="mt-1"
        data-testid="check-accept-legal"
      />
      <span className="text-muted-foreground leading-relaxed">
        I have read and agree to the{" "}
        <Link href="/legal/terms" className="text-blue-600 hover:underline">Terms of Service</Link>,{" "}
        <Link href="/legal/privacy" className="text-blue-600 hover:underline">Privacy Policy</Link>, and{" "}
        <Link href="/legal/disclaimer" className="text-blue-600 hover:underline">Engineering Disclaimer</Link>.
        I confirm I'm a credentialed engineering professional or am acting on behalf of a licensed engineering firm.
      </span>
    </label>
  );
}

function Reassurance({
  icon: Icon, title, children,
}: { icon: typeof ShieldCheck; title: string; children: React.ReactNode }) {
  return (
    <div className="border rounded-lg p-4">
      <Icon className="w-4 h-4 text-blue-600 mb-1.5" />
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="text-xs">{children}</div>
    </div>
  );
}
