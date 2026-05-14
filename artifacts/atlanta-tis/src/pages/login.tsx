/**
 * Email + password sign-in page. Replaces the Replit OIDC redirect flow
 * removed in Phase 13. After successful login, the page navigates to
 * the `returnTo` query param (if present and same-origin) or the
 * default authenticated landing (/tis).
 */
import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowLeft, Building2, Loader2, AlertCircle, ArrowRight,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

function safeReturnTo(): string {
  try {
    const sp = new URLSearchParams(window.location.search);
    const raw = sp.get("returnTo");
    if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  } catch {}
  return "/tis";
}

export default function LoginPage() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/tis-api/auth/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? "Sign in failed.");
      // Hard reload on the destination so useAuth re-fetches the session.
      window.location.href = safeReturnTo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="max-w-md mx-auto px-4 py-12 space-y-6">
        <div>
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to home
          </Link>
        </div>

        <header className="space-y-2 text-center">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-700">
            <Building2 className="w-3.5 h-3.5" /> Sign in
          </div>
          <h1 className="text-3xl font-bold">Welcome back</h1>
          <p className="text-sm text-muted-foreground">
            Don't have an account yet? <Link href="/signup" className="text-blue-700 hover:underline">Start a firm trial</Link>
          </p>
        </header>

        <section className="border rounded-xl p-6 space-y-4 bg-background">
          <form onSubmit={onSubmit} className="space-y-3">
            <label className="space-y-1 block">
              <span className="text-sm font-medium">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                data-testid="input-login-email"
              />
            </label>
            <label className="space-y-1 block">
              <span className="text-sm font-medium">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                data-testid="input-login-password"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-sm font-semibold rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50"
              data-testid="button-login-submit"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Sign in <ArrowRight className="w-4 h-4" />
            </button>
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5" /> {error}
              </div>
            )}
          </form>
          <div className="pt-2 border-t text-sm flex items-center justify-between">
            <Link href="/auth/forgot" className="text-blue-700 hover:underline">
              Forgot password?
            </Link>
          </div>
        </section>
      </div>
      <SiteFooter />
    </div>
  );
}
