/**
 * Request a password-reset link. POSTs the email to
 * /tis-api/auth/password-reset and renders a generic
 * "if an account exists, we sent a link" confirmation regardless of
 * whether the email was registered.
 */
import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Mail, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { SiteFooter } from "../components/site-footer";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/tis-api/auth/password-reset", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
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
            <Mail className="w-3.5 h-3.5" /> Reset password
          </div>
          <h1 className="text-3xl font-bold">Forgot your password?</h1>
          <p className="text-sm text-muted-foreground">
            Enter your email and we'll send a reset link.
          </p>
        </header>

        {sent ? (
          <section className="border rounded-xl p-6 space-y-3 bg-background text-center">
            <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto" />
            <h2 className="font-semibold text-lg">Check your inbox</h2>
            <p className="text-sm text-muted-foreground">
              If an account exists for <strong>{email}</strong>, we've sent a password-reset link. The link expires in 1 hour.
            </p>
            <p className="text-xs text-muted-foreground pt-2">
              Didn't see it? Check spam, then{" "}
              <button onClick={() => setSent(false)} className="text-blue-600 hover:underline">try again</button>.
            </p>
          </section>
        ) : (
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
                  data-testid="input-forgot-email"
                />
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                data-testid="button-forgot-submit"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Send reset link
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
