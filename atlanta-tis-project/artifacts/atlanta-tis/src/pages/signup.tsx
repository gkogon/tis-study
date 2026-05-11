/**
 * Firm signup / onboarding. Three states:
 *   1. Not signed in → invite to sign in via Replit Auth, plan preserved
 *      via the `plan` query param across the round trip.
 *   2. Signed in but no firm yet → form to name the firm; submitting
 *      POSTs to /firms which creates the firm and a `firm_members` row
 *      with role=owner. If a paid plan was selected, redirect to
 *      Stripe Checkout; otherwise drop them on /tis.
 *   3. Signed in with an existing firm → skip the form, route them to
 *      their next-step destination (checkout or app).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  ArrowLeft, Building2, ArrowRight, Loader2, ShieldCheck,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

type Plan = "starter" | "growth" | "trial";

const PLAN_LABEL: Record<Plan, string> = {
  starter: "Starter — $499/mo",
  growth: "Growth — $1,299/mo",
  trial: "Free trial",
};

function readPlanFromUrl(): Plan {
  const sp = new URLSearchParams(window.location.search);
  const raw = sp.get("plan");
  if (raw === "starter" || raw === "growth") return raw;
  return "trial";
}

export default function SignupPage() {
  const { isAuthenticated, isLoading: authLoading, user, login } = useAuth();
  const [, navigate] = useLocation();
  const plan = useMemo(readPlanFromUrl, []);

  const [firmName, setFirmName] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingFirm, setExistingFirm] = useState<{ id: string; name: string } | null>(null);
  const [checkingFirm, setCheckingFirm] = useState(false);

  // If already signed in, see if they already have a firm — if so, skip
  // the create form and go straight to next step.
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

  async function startCheckout(planId: Plan) {
    if (planId === "trial") {
      navigate("/tis");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/tis-api/billing/checkout-session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId }),
      });
      const data = await r.json();
      if (!r.ok || !data?.url) {
        throw new Error(data?.error ?? "Failed to start checkout.");
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout.");
      setSubmitting(false);
    }
  }

  async function handleCreateFirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const name = firmName.trim();
    if (!name) {
      setError("Firm name is required.");
      return;
    }
    if (!acceptedTerms) {
      setError("Please review and accept the Terms, Privacy Policy, and Engineering Disclaimer.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/tis-api/firms", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `Signup failed (HTTP ${r.status}).`);
      await startCheckout(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed.");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-10">
        <div>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to pricing
          </Link>
        </div>

        <section className="text-center space-y-3">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-600">
            <Building2 className="w-3.5 h-3.5" />
            Start your firm trial
          </div>
          <h1 className="text-4xl font-bold leading-tight">
            Set up your firm account
          </h1>
          <p className="text-muted-foreground">
            Selected plan: <strong>{PLAN_LABEL[plan]}</strong>{" "}
            <Link href="/pricing" className="text-blue-600 hover:underline ml-1">change</Link>
          </p>
        </section>

        <section className="border rounded-xl p-8 space-y-6 bg-background">
          {authLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking session…
            </div>
          ) : !isAuthenticated ? (
            <SignInStep onSignIn={login} />
          ) : checkingFirm ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading your firm…
            </div>
          ) : existingFirm ? (
            <AlreadyHaveFirmStep
              firmName={existingFirm.name}
              plan={plan}
              onCheckout={() => startCheckout(plan)}
              submitting={submitting}
            />
          ) : (
            <CreateFirmStep
              user={user}
              firmName={firmName}
              setFirmName={setFirmName}
              acceptedTerms={acceptedTerms}
              setAcceptedTerms={setAcceptedTerms}
              onSubmit={handleCreateFirm}
              submitting={submitting}
              plan={plan}
            />
          )}

          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 dark:bg-red-950/30 dark:border-red-900 dark:text-red-300 px-3 py-2 text-sm">
              {error}
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

function SignInStep({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="space-y-4 text-center">
      <h2 className="text-xl font-semibold">Sign in to continue</h2>
      <p className="text-muted-foreground text-sm">
        We use Replit Auth so you don't have to manage another password.
        After sign-in we'll bring you right back here to name your firm.
      </p>
      <button
        type="button"
        onClick={onSignIn}
        className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
        data-testid="button-signup-signin"
      >
        Sign in
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}

function CreateFirmStep({
  user, firmName, setFirmName, acceptedTerms, setAcceptedTerms, onSubmit, submitting, plan,
}: {
  user: { firstName: string | null; lastName: string | null; email: string | null } | null;
  firmName: string;
  setFirmName: (v: string) => void;
  acceptedTerms: boolean;
  setAcceptedTerms: (v: boolean) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting: boolean;
  plan: Plan;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Signed in as
        </div>
        <div className="text-sm">
          {user?.firstName} {user?.lastName} ({user?.email})
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor="firm-name" className="text-sm font-medium">
          Firm name
        </label>
        <input
          id="firm-name"
          type="text"
          value={firmName}
          onChange={(e) => setFirmName(e.target.value)}
          placeholder="e.g. Croy Engineering"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
          maxLength={120}
          required
          data-testid="input-firm-name"
        />
        <p className="text-xs text-muted-foreground">
          This is what shows on your white-labeled PDFs. You can change it later.
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={acceptedTerms}
          onChange={(e) => setAcceptedTerms(e.target.checked)}
          required
          className="mt-1"
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
      <button
        type="submit"
        disabled={submitting || !acceptedTerms}
        className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        data-testid="button-create-firm"
      >
        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
        {plan === "trial" ? "Create firm & start" : `Create firm & continue to checkout`}
        <ArrowRight className="w-4 h-4" />
      </button>
    </form>
  );
}

function AlreadyHaveFirmStep({
  firmName, plan, onCheckout, submitting,
}: {
  firmName: string; plan: Plan; onCheckout: () => void; submitting: boolean;
}) {
  if (plan === "trial") {
    return (
      <div className="space-y-3 text-center">
        <h2 className="text-xl font-semibold">You're all set</h2>
        <p className="text-muted-foreground text-sm">
          Your firm <strong>{firmName}</strong> is ready. Head to the generator
          to run your first study.
        </p>
        <Link
          href="/tis"
          className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
          data-testid="link-signup-go-tis"
        >
          Go to TIS generator <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-3 text-center">
      <h2 className="text-xl font-semibold">You already have a firm</h2>
      <p className="text-muted-foreground text-sm">
        <strong>{firmName}</strong>. Click below to start the {PLAN_LABEL[plan]} subscription.
      </p>
      <button
        type="button"
        onClick={onCheckout}
        disabled={submitting}
        className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        data-testid="button-existing-firm-checkout"
      >
        {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
        Continue to checkout <ArrowRight className="w-4 h-4" />
      </button>
    </div>
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
