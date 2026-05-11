/**
 * Per-firm project history page. Lists every TIS the signed-in user has
 * generated (most recent first); clicking opens the report in a new tab.
 *
 * This is the switching-cost moat: once a firm has accumulated 50+ projects
 * here, leaving the platform means losing the audit trail.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { FileText, MapPin, ArrowLeft, Loader2 } from "lucide-react";

interface ProjectListItem {
  id: string;
  projectName: string;
  landUseCode: string;
  siteLat: string | null;
  siteLon: string | null;
  version: number;
  createdAt: string;
}

export default function ProjectsPage() {
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();
  const [items, setItems] = useState<ProjectListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setItems(null);
      return;
    }
    let cancelled = false;
    fetch("/tis-api/projects", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { items: ProjectListItem[] }) => {
        if (!cancelled) setItems(data.items ?? []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  if (authLoading) return null;

  if (!isAuthenticated) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-5">
        <h1 className="text-3xl font-semibold">Project history</h1>
        <p className="text-muted-foreground">
          Sign in to see every TIS you've generated. Past reports stay tied
          to your account so you can reopen them at any time.
        </p>
        <button
          type="button"
          onClick={login}
          className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
          data-testid="button-projects-sign-in"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/tis"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
            data-testid="link-back-to-tis"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to generator
          </Link>
          <h1 className="text-3xl font-semibold">Project history</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every TIS your account has generated. Reopen to view, re-print, or
            duplicate inputs into a new study.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-200">
          Failed to load projects: {error}
        </div>
      )}

      {items === null && !error && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading projects…
        </div>
      )}

      {items && items.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center space-y-3">
          <FileText className="w-8 h-8 text-muted-foreground mx-auto" />
          <div className="text-base font-medium">No projects yet</div>
          <div className="text-sm text-muted-foreground">
            Generate your first TIS and it will be saved here automatically.
          </div>
          <Link
            href="/tis"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
            data-testid="link-generate-first"
          >
            Open generator
          </Link>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="rounded-lg border border-border divide-y divide-border">
          {items.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/40"
              data-testid={`row-project-${p.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{p.projectName}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-3 mt-0.5">
                  <span>ITE {p.landUseCode}</span>
                  {p.siteLat && p.siteLon && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {Number(p.siteLat).toFixed(4)}, {Number(p.siteLon).toFixed(4)}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-xs text-muted-foreground shrink-0">
                {new Date(p.createdAt).toLocaleString()}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
