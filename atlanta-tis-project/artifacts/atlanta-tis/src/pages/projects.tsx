/**
 * Per-firm project history. Lists every study (any type) the firm has
 * generated, most recent first. Filter chips narrow by study type;
 * each row links to the study-type-aware detail view.
 *
 * Switching-cost moat: once a firm has 50+ studies under one account,
 * leaving the platform means losing the audit trail.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  FileText, MapPin, ArrowLeft, Loader2, MapIcon, ParkingCircle, ChevronRight, Eye,
} from "lucide-react";

interface ProjectListItem {
  id: string;
  studyType: string;
  projectName: string;
  landUseCode: string;
  siteLat: string | null;
  siteLon: string | null;
  version: number;
  createdAt: string;
}

type Filter = "all" | "tis" | "parking" | "warrants" | "sight_distance";

const STUDY_META: Record<string, { label: string; icon: typeof FileText; tint: string }> = {
  tis: { label: "TIS", icon: MapIcon, tint: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  parking: { label: "Parking", icon: ParkingCircle, tint: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300" },
  warrants: { label: "Warrants", icon: ChevronRight, tint: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  sight_distance: { label: "Sight", icon: Eye, tint: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" },
};

export default function ProjectsPage() {
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();
  const [items, setItems] = useState<ProjectListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

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

  const counts = useMemo(() => {
    const c = { all: 0, tis: 0, parking: 0, warrants: 0, sight_distance: 0 };
    for (const p of items ?? []) {
      c.all++;
      const t = (p.studyType ?? "tis") as Filter;
      if (t in c) (c as Record<Filter, number>)[t]++;
    }
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return null;
    if (filter === "all") return items;
    return items.filter((p) => (p.studyType ?? "tis") === filter);
  }, [items, filter]);

  if (authLoading) return null;

  if (!isAuthenticated) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center space-y-5">
        <h1 className="text-3xl font-semibold">Project history</h1>
        <p className="text-muted-foreground">
          Sign in to see every study your firm has generated. Past reports stay
          tied to your firm so any engineer can reopen them at any time.
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
            href="/studies"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2"
            data-testid="link-back-to-studies"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to studies
          </Link>
          <h1 className="text-3xl font-semibold">Project history</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Every study your firm has generated. Reopen to view, re-print, or
            duplicate inputs into a new study.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          All <span className="text-muted-foreground">({counts.all})</span>
        </Chip>
        <Chip active={filter === "tis"} onClick={() => setFilter("tis")}>
          TIS <span className="text-muted-foreground">({counts.tis})</span>
        </Chip>
        <Chip active={filter === "parking"} onClick={() => setFilter("parking")}>
          Parking <span className="text-muted-foreground">({counts.parking})</span>
        </Chip>
        <Chip active={filter === "warrants"} onClick={() => setFilter("warrants")}>
          Warrants <span className="text-muted-foreground">({counts.warrants})</span>
        </Chip>
        <Chip active={filter === "sight_distance"} onClick={() => setFilter("sight_distance")}>
          Sight <span className="text-muted-foreground">({counts.sight_distance})</span>
        </Chip>
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

      {filtered && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center space-y-3">
          <FileText className="w-8 h-8 text-muted-foreground mx-auto" />
          <div className="text-base font-medium">
            {filter === "all" ? "No projects yet" : `No ${filter} studies yet`}
          </div>
          <div className="text-sm text-muted-foreground">
            {filter === "all"
              ? "Generate your first study and it will be saved here automatically."
              : "Run one and it'll show up here."}
          </div>
          <Link
            href="/studies"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
            data-testid="link-generate-first"
          >
            Pick a study to run
          </Link>
        </div>
      )}

      {filtered && filtered.length > 0 && (
        <div className="rounded-lg border border-border divide-y divide-border">
          {filtered.map((p) => {
            const meta = STUDY_META[p.studyType ?? "tis"] ?? STUDY_META.tis;
            const Icon = meta.icon;
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/40"
                data-testid={`row-project-${p.id}`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className={"shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider " + meta.tint}>
                    <Icon className="w-3 h-3" /> {meta.label}
                  </span>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{p.projectName}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-3 mt-0.5">
                      <span>{p.studyType === "warrants" ? `Lane config ${p.landUseCode}` : `ITE ${p.landUseCode}`}</span>
                      {p.siteLat && p.siteLon && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {Number(p.siteLat).toFixed(4)}, {Number(p.siteLon).toFixed(4)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">
                  {new Date(p.createdAt).toLocaleString()}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "text-xs font-semibold px-3 py-1.5 rounded-full transition-colors " +
        (active
          ? "bg-blue-600 text-white"
          : "border border-border hover:bg-accent")
      }
    >
      {children}
    </button>
  );
}
