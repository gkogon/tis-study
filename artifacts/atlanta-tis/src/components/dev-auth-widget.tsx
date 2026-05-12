/**
 * Floating dev-mode sign-in widget. Shown only when the API reports
 * `devAuthEnabled: true` and no user is currently signed in.
 *
 * Posts to `/tis-api/dev-login`, which is gated server-side by the
 * `DEV_AUTH_ENABLED` env var, so this widget is harmless if it ever
 * accidentally renders against a production API — the endpoint will
 * 404.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { TestTube, X, Loader2 } from "lucide-react";

export function DevAuthWidget() {
  const { isAuthenticated, isLoading } = useAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("engineer@firm.test");
  const [firstName, setFirstName] = useState("Test");
  const [lastName, setLastName] = useState("Engineer");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedOutAt, setSignedOutAt] = useState(0);

  useEffect(() => {
    fetch("/tis-api/auth/config")
      .then((r) => r.json())
      .then((d: { devAuthEnabled?: boolean }) => setEnabled(!!d.devAuthEnabled))
      .catch(() => setEnabled(false));
  }, []);

  async function devLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch("/tis-api/dev-login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, firstName, lastName }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
      setSubmitting(false);
    }
  }

  async function devLogout() {
    try {
      await fetch("/tis-api/dev-logout", { method: "POST", credentials: "include" });
    } catch {
      // Ignore — we reload anyway.
    }
    setSignedOutAt(Date.now());
    window.location.reload();
  }

  if (enabled === null || enabled === false) return null;
  if (isLoading) return null;

  // Signed-in view: tiny badge in corner with a quick sign-out.
  if (isAuthenticated) {
    return (
      <div className="fixed bottom-4 right-4 z-50 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-xs font-medium shadow-md">
        <TestTube className="w-3.5 h-3.5" />
        Dev session
        <button
          type="button"
          onClick={devLogout}
          className="underline hover:no-underline"
          data-testid="button-dev-signout"
        >
          sign out
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500 text-white text-sm font-semibold shadow-lg hover:bg-amber-600"
          data-testid="button-open-dev-login"
        >
          <TestTube className="w-4 h-4" />
          Dev sign-in
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl bg-background border border-amber-300 shadow-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700">
          <TestTube className="w-3.5 h-3.5" /> Dev sign-in
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Skips Replit OIDC. Local development only. Each unique email becomes
        a separate user; re-use the same email to keep your firm + project
        history.
      </p>
      <form onSubmit={devLogin} className="space-y-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@firm.test"
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
          required
          data-testid="input-dev-email"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="First name"
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            data-testid="input-dev-firstname"
          />
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Last name"
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            data-testid="input-dev-lastname"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
          data-testid="button-dev-signin"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Sign in
        </button>
        {error && (
          <div className="text-xs text-red-600">{error}</div>
        )}
      </form>
    </div>
  );
}
