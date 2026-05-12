/**
 * Confirm a password reset by redeeming the token from the email link
 * and setting a new password.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Lock, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { SiteFooter } from "../components/site-footer";

export default function ResetPasswordPage() {
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get("token") ?? "",
    [],
  );
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 10) {
      setError("Password must be at least 10 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await fetch("/tis-api/auth/password-confirm", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? "Reset failed.");
      setDone(true);
      // The reset endpoint signs them in; small delay for the
      // user to see the success state, then redirect.
      setTimeout(() => { window.location.href = "/tis"; }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="max-w-md mx-auto px-4 py-12 space-y-6">
        <div>
          <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to sign in
          </Link>
        </div>

        <header className="space-y-2 text-center">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-600">
            <Lock className="w-3.5 h-3.5" /> Set a new password
          </div>
          <h1 className="text-3xl font-bold">Choose a new password</h1>
        </header>

        {!token ? (
          <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-3 text-sm text-red-700 dark:text-red-300 flex gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <div>This link is missing a token. Request a fresh reset from <Link href="/auth/forgot" className="underline font-medium">forgot password</Link>.</div>
          </div>
        ) : done ? (
          <section className="border rounded-xl p-6 space-y-3 bg-background text-center">
            <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto" />
            <h2 className="font-semibold text-lg">Password updated</h2>
            <p className="text-sm text-muted-foreground">Signing you in…</p>
          </section>
        ) : (
          <section className="border rounded-xl p-6 space-y-4 bg-background">
            <form onSubmit={onSubmit} className="space-y-3">
              <label className="space-y-1 block">
                <span className="text-sm font-medium">New password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required minLength={10} autoComplete="new-password"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  data-testid="input-reset-password"
                />
                <span className="text-xs text-muted-foreground">At least 10 characters.</span>
              </label>
              <label className="space-y-1 block">
                <span className="text-sm font-medium">Confirm new password</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required minLength={10} autoComplete="new-password"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  data-testid="input-reset-confirm"
                />
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                data-testid="button-reset-submit"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Set new password
              </button>
              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5" /> {error}
                </div>
              )}
            </form>
          </section>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
