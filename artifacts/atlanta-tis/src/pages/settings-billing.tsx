/**
 * Firm billing settings. Shows the current plan, this period's study
 * usage, and the next billing date. Two main actions:
 *   - Upgrade / change plan → /billing/checkout-session
 *   - Manage card / invoices / cancel → /billing/portal-session
 *
 * Anyone in the firm can view; only owner/admin can act. The buttons
 * are disabled (with a tooltip) for members.
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  ArrowLeft, Building2, CreditCard, ExternalLink, Loader2,
  CheckCircle2, AlertCircle, BarChart3, Calendar,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

type Summary = {
  firm: {
    id: string;
    name: string;
    planTier: string;
    subscriptionStatus: string | null;
    seatLimit: number;
    studyLimit: number;
    studiesUsedThisPeriod: number;
    currentPeriodEnd: string | null;
    currentPeriodStart: string | null;
    hasStripeCustomer: boolean;
  };
  role: string | null;
};

const TIER_LABEL: Record<string, string> = {
  trial: "Trial",
  starter: "Starter",
  growth: "Growth",
  enterprise: "Enterprise",
};

export default function SettingsBillingPage() {
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();
  const [, navigate] = useLocation();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actioning, setActioning] = useState<"checkout" | "portal" | null>(null);
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("checkout") === "success") setShowSuccessBanner(true);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetch("/tis-api/billing/summary", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Summary>;
      })
      .then(setSummary)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [isAuthenticated]);

  async function startCheckout(plan: "starter" | "growth") {
    setError(null);
    setActioning("checkout");
    try {
      const r = await fetch("/tis-api/billing/checkout-session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await r.json();
      if (!r.ok || !data?.url) throw new Error(data?.error ?? `HTTP ${r.status}`);
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start checkout.");
      setActioning(null);
    }
  }

  async function openPortal() {
    setError(null);
    setActioning("portal");
    try {
      const r = await fetch("/tis-api/billing/portal-session", {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok || !data?.url) throw new Error(data?.error ?? `HTTP ${r.status}`);
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open portal.");
      setActioning(null);
    }
  }

  if (authLoading) return <CenteredLoader label="Loading…" />;
  if (!isAuthenticated) {
    return (
      <SignInWall onSignIn={login} body="Sign in to view your firm's billing." />
    );
  }
  if (error && !summary) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 space-y-4">
        <h1 className="text-2xl font-bold">Couldn't load billing</h1>
        <p className="text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (!summary) return <CenteredLoader label="Loading billing…" />;

  const firm = summary.firm;
  const canManage = summary.role === "owner" || summary.role === "admin";
  const usagePct = Math.min(
    100,
    Math.round((firm.studiesUsedThisPeriod / Math.max(1, firm.studyLimit)) * 100),
  );

  return (
    <div>
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <div>
          <Link
            href="/projects"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to projects
          </Link>
        </div>

        <header className="space-y-2">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-600">
            <CreditCard className="w-3.5 h-3.5" />
            Billing
          </div>
          <h1 className="text-3xl font-bold">Plan & billing</h1>
          <p className="text-muted-foreground">
            Firm <strong>{firm.name}</strong> ·{" "}
            <Link href="/settings/firm" className="text-blue-600 hover:underline">
              firm settings
            </Link>
          </p>
        </header>

        {showSuccessBanner && (
          <div className="rounded-md border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 px-4 py-3 text-sm flex gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-700 dark:text-green-300 mt-0.5" />
            <div>
              <div className="font-semibold text-green-800 dark:text-green-200">
                Subscription started.
              </div>
              <div className="text-green-700 dark:text-green-300 text-xs">
                It may take a few seconds for the plan to update below — refresh if needed.
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-4 py-3 text-sm flex gap-2">
            <AlertCircle className="w-4 h-4 text-red-700 dark:text-red-300 mt-0.5" />
            <div className="text-red-700 dark:text-red-300">{error}</div>
          </div>
        )}

        <section className="border rounded-xl p-6 space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Current plan
              </div>
              <div className="text-2xl font-bold">
                {TIER_LABEL[firm.planTier] ?? firm.planTier}
              </div>
              {firm.subscriptionStatus && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  Status: {firm.subscriptionStatus}
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {firm.hasStripeCustomer && (
                <button
                  type="button"
                  onClick={openPortal}
                  disabled={!canManage || actioning !== null}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-md border border-border hover:bg-accent disabled:opacity-50"
                  data-testid="button-open-portal"
                >
                  {actioning === "portal" && <Loader2 className="w-4 h-4 animate-spin" />}
                  Manage in Stripe <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t">
            <Stat icon={BarChart3} label="Studies this period">
              <span className="text-2xl font-bold">{firm.studiesUsedThisPeriod}</span>
              <span className="text-muted-foreground"> / {firm.studyLimit}</span>
              <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={
                    "h-full rounded-full transition-all " +
                    (usagePct >= 100 ? "bg-red-600" : usagePct >= 80 ? "bg-amber-500" : "bg-blue-600")
                  }
                  style={{ width: `${usagePct}%` }}
                />
              </div>
            </Stat>
            <Stat icon={Building2} label="Seat limit">
              <span className="text-2xl font-bold">{firm.seatLimit}</span>
              <div className="text-xs text-muted-foreground mt-2">
                Invite engineers from{" "}
                <Link href="/settings/firm" className="text-blue-600 hover:underline">
                  firm settings
                </Link>
              </div>
            </Stat>
            <Stat icon={Calendar} label="Next billing date">
              <span className="text-2xl font-bold">
                {firm.currentPeriodEnd
                  ? new Date(firm.currentPeriodEnd).toLocaleDateString()
                  : "—"}
              </span>
              <div className="text-xs text-muted-foreground mt-2">
                Period started{" "}
                {firm.currentPeriodStart
                  ? new Date(firm.currentPeriodStart).toLocaleDateString()
                  : "—"}
              </div>
            </Stat>
          </div>
        </section>

        {firm.planTier === "trial" && (
          <section className="border rounded-xl p-6 space-y-4 bg-muted/30">
            <h2 className="text-xl font-bold">Upgrade to a paid plan</h2>
            <p className="text-sm text-muted-foreground">
              You're on the trial. Pick a plan below — a 14-day free trial
              continues on the paid tier with no charge until day 15.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <UpgradeCard
                plan="starter"
                title="Starter — $499/mo"
                body="3 seats · 10 studies / month"
                onClick={() => startCheckout("starter")}
                disabled={!canManage || actioning !== null}
                actioning={actioning === "checkout"}
              />
              <UpgradeCard
                plan="growth"
                title="Growth — $1,299/mo"
                body="10 seats · 30 studies / month"
                primary
                onClick={() => startCheckout("growth")}
                disabled={!canManage || actioning !== null}
                actioning={actioning === "checkout"}
              />
            </div>
            {!canManage && (
              <p className="text-xs text-muted-foreground">
                Only the firm owner or an admin can change the plan.
              </p>
            )}
          </section>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}

function Stat({
  icon: Icon, label, children,
}: { icon: typeof BarChart3; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function UpgradeCard({
  title, body, primary, onClick, disabled, actioning,
}: {
  plan: string;
  title: string;
  body: string;
  primary?: boolean;
  onClick: () => void;
  disabled: boolean;
  actioning: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        "rounded-lg p-4 text-left transition-colors disabled:opacity-50 " +
        (primary
          ? "bg-blue-600 text-white hover:bg-blue-700"
          : "border border-border bg-background hover:bg-accent")
      }
    >
      <div className="font-semibold flex items-center gap-2">
        {actioning && <Loader2 className="w-4 h-4 animate-spin" />}
        {title}
      </div>
      <div className={"text-xs mt-0.5 " + (primary ? "text-white/80" : "text-muted-foreground")}>
        {body}
      </div>
    </button>
  );
}

function CenteredLoader({ label }: { label: string }) {
  return (
    <div className="max-w-3xl mx-auto px-4 py-24 flex items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" /> {label}
    </div>
  );
}

function SignInWall({ onSignIn, body }: { onSignIn: () => void; body: string }) {
  return (
    <div className="max-w-md mx-auto px-4 py-24 text-center space-y-4">
      <h1 className="text-2xl font-bold">Sign in required</h1>
      <p className="text-muted-foreground">{body}</p>
      <button
        type="button"
        onClick={onSignIn}
        className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
      >
        Sign in
      </button>
    </div>
  );
}
