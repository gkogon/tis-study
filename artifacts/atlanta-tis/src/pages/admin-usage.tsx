/**
 * Admin / dev panel: per-user + per-firm usage rollup.
 *
 * Auth: gated server-side by ADMIN_EMAILS allowlist. The page itself
 * just calls /tis-api/admin/usage and renders whatever the server
 * returns; non-admin users see a "Not authorized" state.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { ArrowLeft, Loader2, Mail, RefreshCw } from "lucide-react";
import { SiteFooter } from "../components/site-footer";

type UsageRow = {
  userId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  userCreatedAt: string;
  userLifetimeStudyCount: number;
  userLastStudyAt: string | null;
  firm: {
    firmId: string;
    name: string | null;
    role: string | null;
    planTier: string | null;
    subscriptionStatus: string | null;
    seatLimit: number | null;
    studyLimit: number | null;
    studiesUsedThisPeriod: number | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    firmLifetimeStudyCount: number;
    firmLastStudyAt: string | null;
    firmCreatedAt: string;
  } | null;
};

type UsageResp = {
  generatedAt: string;
  userCount: number;
  rows: UsageRow[];
};

const PLAN_BADGE: Record<string, string> = {
  trial: "bg-gray-100 text-gray-700",
  starter: "bg-blue-100 text-blue-800",
  growth: "bg-purple-100 text-purple-800",
  enterprise: "bg-emerald-100 text-emerald-800",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const ms = Date.now() - d.getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  return `${mo}mo ago`;
}

export default function AdminUsagePage() {
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();
  const [data, setData] = useState<UsageResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchUsage() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/tis-api/admin/usage", { credentials: "include" });
      if (r.status === 401) throw new Error("Sign in to view this page.");
      if (r.status === 403) throw new Error("Your account is not on the admin allowlist.");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchUsage();
  }, [isAuthenticated]);

  if (authLoading) return null;

  if (!isAuthenticated) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <h1 className="text-2xl font-semibold">Sign in to view this page</h1>
        <button
          type="button"
          onClick={login}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
              <ArrowLeft className="w-4 h-4" /> Back to home
            </Link>
            <h1 className="text-2xl font-semibold">Usage panel</h1>
            <p className="text-sm text-muted-foreground">
              Per-user and per-firm study usage. Admin-only — gated by the <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">ADMIN_EMAILS</code> server allowlist.
            </p>
          </div>
          <button
            type="button"
            onClick={fetchUsage}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border bg-background hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {data && (
          <>
            <div className="text-xs text-muted-foreground">
              {data.userCount} user{data.userCount === 1 ? "" : "s"} · generated {fmtDate(data.generatedAt)}
            </div>

            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">User</th>
                    <th className="text-left px-3 py-2 font-medium">Joined</th>
                    <th className="text-left px-3 py-2 font-medium">Firm</th>
                    <th className="text-left px-3 py-2 font-medium">Plan</th>
                    <th className="text-right px-3 py-2 font-medium">This period</th>
                    <th className="text-right px-3 py-2 font-medium">Lifetime (firm)</th>
                    <th className="text-right px-3 py-2 font-medium">Lifetime (user)</th>
                    <th className="text-left px-3 py-2 font-medium">Last study</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-muted-foreground">No users yet.</td>
                    </tr>
                  )}
                  {data.rows.map((r) => {
                    const fullName = [r.firstName, r.lastName].filter(Boolean).join(" ").trim();
                    const tier = (r.firm?.planTier ?? "trial").toLowerCase();
                    const used = r.firm?.studiesUsedThisPeriod ?? 0;
                    const limit = r.firm?.studyLimit ?? 0;
                    const overQuota = limit > 0 && used >= limit;
                    return (
                      <tr key={r.userId + (r.firm?.firmId ?? "")} className="border-t hover:bg-gray-50">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                            <div>
                              <div className="font-mono text-xs">{r.email ?? "—"}</div>
                              {fullName && <div className="text-xs text-muted-foreground">{fullName}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground" title={fmtDate(r.userCreatedAt)}>
                          {relTime(r.userCreatedAt)}
                        </td>
                        <td className="px-3 py-2">
                          {r.firm ? (
                            <div>
                              <div>{r.firm.name ?? "—"}</div>
                              <div className="text-xs text-muted-foreground">{r.firm.role}</div>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${PLAN_BADGE[tier] ?? "bg-gray-100 text-gray-700"}`}>
                            {tier}
                          </span>
                          {r.firm?.subscriptionStatus && r.firm.subscriptionStatus !== "active" && (
                            <span className="ml-1 text-xs text-amber-700">{r.firm.subscriptionStatus}</span>
                          )}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums ${overQuota ? "text-red-700 font-medium" : ""}`}>
                          {r.firm ? `${used} / ${limit}` : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.firm ? r.firm.firmLifetimeStudyCount : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {r.userLifetimeStudyCount}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground" title={fmtDate(r.userLastStudyAt)}>
                          {relTime(r.userLastStudyAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-muted-foreground">
              "This period" resets on every successful Stripe <code>invoice.paid</code> webhook.
              Lifetime counts come straight from <code>tis_projects</code> row count.
            </p>
          </>
        )}

        {!data && !error && loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading usage…
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
