/**
 * Invite acceptance landing. Visitor clicks the link from an email →
 * /invites/accept?token=… → must sign in via Replit Auth → on click,
 * we POST the token to /firms/invites/accept and route them to /tis.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  Building2, ArrowRight, Loader2, AlertCircle, CheckCircle2,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

export default function InviteAcceptPage() {
  const { isAuthenticated, isLoading, login } = useAuth();
  const [, navigate] = useLocation();
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const token = useMemo(
    () => new URLSearchParams(window.location.search).get("token") ?? "",
    [],
  );

  useEffect(() => {
    if (!token) setError("This invite link is missing a token.");
  }, [token]);

  async function accept() {
    setAccepting(true);
    setError(null);
    try {
      const r = await fetch("/tis-api/firms/invites/accept", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setSuccess(true);
      setTimeout(() => navigate("/tis"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to accept invite.");
    } finally {
      setAccepting(false);
    }
  }

  return (
    <div>
      <div className="max-w-md mx-auto px-4 py-16 space-y-6 text-center">
        <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-600">
          <Building2 className="w-3.5 h-3.5" />
          Firm invitation
        </div>
        <h1 className="text-3xl font-bold leading-tight">
          You've been invited to join a firm.
        </h1>

        {!token ? (
          <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex gap-2 text-left">
            <AlertCircle className="w-4 h-4 mt-0.5" /> This invite link is missing a token. Ask the firm admin to send a fresh link.
          </div>
        ) : success ? (
          <div className="rounded-md border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 px-3 py-3 text-sm text-green-800 dark:text-green-200 flex gap-2 text-left">
            <CheckCircle2 className="w-4 h-4 mt-0.5" />
            <div>
              <div className="font-semibold">Welcome aboard.</div>
              <div className="text-xs">Redirecting to the generator…</div>
            </div>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking session…
          </div>
        ) : !isAuthenticated ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Sign in to accept. After sign-in we'll bring you back here automatically.
            </p>
            <button
              type="button"
              onClick={login}
              className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
              data-testid="button-invite-signin"
            >
              Sign in to accept
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <button
              type="button"
              onClick={accept}
              disabled={accepting}
              className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              data-testid="button-accept-invite"
            >
              {accepting && <Loader2 className="w-4 h-4 animate-spin" />}
              Accept invite
              <ArrowRight className="w-4 h-4" />
            </button>
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex gap-2 text-left">
                <AlertCircle className="w-4 h-4 mt-0.5" /> {error}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Not the right account? <Link href="/" className="text-blue-600 hover:underline">Go home</Link> and sign out from there.
            </p>
          </div>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
