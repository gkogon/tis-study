/**
 * Admin-only leads dashboard. The server gates by ADMIN_EMAILS allow-list,
 * but the UI also hides itself for unauthenticated/non-admin users so we
 * don't show a confusing "loading…" forever.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { LogIn } from "lucide-react";

interface Lead {
  id: string;
  name: string;
  email: string;
  organization: string;
  city: string;
  role: string | null;
  message: string | null;
  productInterest: string | null;
  source: string;
  createdAt: string;
}

export default function AdminPage() {
  const { isAuthenticated, isLoading, login, user } = useAuth();
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetch("/tis-api/leads/list", { credentials: "include" })
      .then(async (r) => {
        if (r.status === 403) throw new Error("Not authorized");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as Lead[];
      })
      .then(setLeads)
      .catch((e: Error) => setError(e.message));
  }, [isAuthenticated]);

  if (isLoading) {
    return <div className="max-w-5xl mx-auto px-4 py-12 text-muted-foreground">Loading…</div>;
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center space-y-4">
        <h1 className="text-2xl font-bold">Admin sign-in required</h1>
        <p className="text-muted-foreground">
          This page is restricted to operators. Sign in to continue.
        </p>
        <button
          type="button"
          onClick={login}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
          data-testid="button-admin-sign-in"
        >
          <LogIn className="w-4 h-4" />
          Sign in
        </button>
      </div>
    );
  }

  if (error === "Not authorized") {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center space-y-3">
        <h1 className="text-2xl font-bold">Not authorized</h1>
        <p className="text-muted-foreground">
          Signed in as <strong>{user?.email}</strong>, but that email is not on the admin allow-list.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-12 space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-bold">Captured leads</h1>
        <div className="text-sm text-muted-foreground">
          {leads ? `${leads.length} total` : "Loading…"}
        </div>
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      {leads && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Firm</th>
                <th className="px-3 py-2">City</th>
                <th className="px-3 py-2">Tier</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-t border-border align-top" data-testid={`row-lead-${l.id}`}>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {new Date(l.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">{l.name}</td>
                  <td className="px-3 py-2">
                    <a className="text-blue-600 hover:underline" href={`mailto:${l.email}`}>{l.email}</a>
                  </td>
                  <td className="px-3 py-2">{l.organization}</td>
                  <td className="px-3 py-2">{l.city}</td>
                  <td className="px-3 py-2">{l.productInterest ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{l.source}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap max-w-sm">
                    {l.message ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
