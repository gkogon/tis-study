/**
 * Signal Warrant Analysis generator (MUTCD Ch. 4C).
 *
 * Input: intersection name + major/minor street config, hourly volumes
 * (24-value paste for each approach), optional crash count. Output: a
 * per-warrant verdict for 1A, 1B, 3, and 7 with hour-by-hour breakdown.
 *
 * The volume input is two textareas accepting comma-separated values.
 * A "Load sample" button pre-fills with a realistic Atlanta-corridor
 * profile so the engineer can play with the engine before pasting real
 * counts.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  ArrowLeft, ChevronRight, Loader2, AlertCircle,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { WarrantsReport, type WarrantsReportT } from "../components/warrants-report";

type LaneCount = "1" | "2+";

// Realistic Atlanta minor-arterial profile, taken from a typical Buford
// Hwy section count for demo purposes. Engineers will paste real data.
const SAMPLE_MAJOR = [85, 60, 45, 40, 55, 120, 380, 720, 950, 720, 580, 540, 600, 620, 640, 720, 880, 950, 760, 540, 380, 260, 180, 120];
const SAMPLE_MINOR = [22, 18, 14, 12, 16, 35, 95, 175, 220, 165, 130, 125, 145, 150, 155, 175, 215, 225, 180, 130, 90, 60, 42, 28];

function parseCsv(s: string): number[] {
  return s
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => Number(t))
    .filter((n) => Number.isFinite(n));
}

export default function WarrantsStudyPage() {
  const { isAuthenticated, isLoading, login } = useAuth();

  const [projectName, setProjectName] = useState("");
  const [intersectionName, setIntersectionName] = useState("");
  const [majorName, setMajorName] = useState("");
  const [minorName, setMinorName] = useState("");
  const [majorLanes, setMajorLanes] = useState<LaneCount>("2+");
  const [minorLanes, setMinorLanes] = useState<LaneCount>("1");
  const [speed85, setSpeed85] = useState("40");
  const [applyReduction, setApplyReduction] = useState(false);
  const [crashCount, setCrashCount] = useState("");
  const [majorVolumes, setMajorVolumes] = useState("");
  const [minorVolumes, setMinorVolumes] = useState("");

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<WarrantsReportT | null>(null);

  function loadSample() {
    setProjectName(projectName || "Buford Hwy @ Sample Drive");
    setIntersectionName(intersectionName || "Buford Hwy @ Sample Drive");
    setMajorName(majorName || "Buford Hwy");
    setMinorName(minorName || "Sample Drive");
    setMajorVolumes(SAMPLE_MAJOR.join(", "));
    setMinorVolumes(SAMPLE_MINOR.join(", "));
    setCrashCount(crashCount || "6");
  }

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setReport(null);
    const major = parseCsv(majorVolumes);
    const minor = parseCsv(minorVolumes);
    if (major.length !== 24 || minor.length !== 24) {
      setError(
        `Major has ${major.length} values, minor has ${minor.length}. Each must have exactly 24 hourly values.`,
      );
      return;
    }
    if (!projectName.trim() || !majorName.trim() || !minorName.trim()) {
      setError("Project name and both street names are required.");
      return;
    }

    setRunning(true);
    try {
      const body: Record<string, unknown> = {
        projectName: projectName.trim(),
        intersectionName: intersectionName.trim() || undefined,
        majorStreet: {
          name: majorName.trim(),
          lanesEachDirection: majorLanes,
          speed85thMph: Number(speed85),
        },
        minorStreet: { name: minorName.trim(), lanesEachDirection: minorLanes },
        applyReductionFactor: applyReduction,
        hourlyVolumesMajor: major,
        hourlyVolumesMinor: minor,
      };
      if (crashCount) body.crashCount12mo = Number(crashCount);

      const r = await fetch("/tis-api/warrants/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setReport(data as WarrantsReportT);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run analysis.");
    } finally {
      setRunning(false);
    }
  }

  if (isLoading) return null;

  return (
    <div>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        <div>
          <Link
            href="/studies"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to studies
          </Link>
        </div>

        <header className="space-y-2">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-600">
            <ChevronRight className="w-3.5 h-3.5" />
            Signal Warrant Analysis
          </div>
          <h1 className="text-3xl font-bold">MUTCD Ch. 4C — screening evaluation</h1>
          <p className="text-muted-foreground">
            Tests Warrants 1A, 1B, 3, and 7 against your candidate intersection's
            24-hour volume profile and crash count. Output is a defensible
            per-warrant verdict your PE can carry into a formal study.
          </p>
        </header>

        {!isAuthenticated && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-sm text-amber-800 dark:text-amber-200 flex gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <div>
              You can preview the form, but running the analysis requires sign-in. {" "}
              <button onClick={login} className="underline font-medium">Sign in</button>
            </div>
          </div>
        )}

        <section className="border rounded-xl p-6 space-y-4 bg-background">
          <form onSubmit={run} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Project name">
                <input
                  type="text" value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g. Buford Hwy @ Sample Drive Signal Study"
                  required maxLength={120} className="input"
                  data-testid="input-warrants-project"
                />
              </Field>
              <Field label="Intersection name (optional)">
                <input
                  type="text" value={intersectionName}
                  onChange={(e) => setIntersectionName(e.target.value)}
                  maxLength={120} className="input"
                  data-testid="input-warrants-intersection"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Field label="Major street name">
                <input
                  type="text" value={majorName}
                  onChange={(e) => setMajorName(e.target.value)}
                  required maxLength={120} className="input"
                  data-testid="input-warrants-major-name"
                />
              </Field>
              <Field label="Lanes / direction (major)">
                <select
                  value={majorLanes} onChange={(e) => setMajorLanes(e.target.value as LaneCount)}
                  className="input"
                  data-testid="select-warrants-major-lanes"
                >
                  <option value="1">1 lane</option>
                  <option value="2+">2 or more</option>
                </select>
              </Field>
              <Field label="Minor street name">
                <input
                  type="text" value={minorName}
                  onChange={(e) => setMinorName(e.target.value)}
                  required maxLength={120} className="input"
                  data-testid="input-warrants-minor-name"
                />
              </Field>
              <Field label="Lanes / direction (minor)">
                <select
                  value={minorLanes} onChange={(e) => setMinorLanes(e.target.value as LaneCount)}
                  className="input"
                  data-testid="select-warrants-minor-lanes"
                >
                  <option value="1">1 lane</option>
                  <option value="2+">2 or more</option>
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Major 85th-%ile speed (mph)">
                <input
                  type="number" value={speed85}
                  onChange={(e) => setSpeed85(e.target.value)}
                  min="15" max="75" className="input"
                  data-testid="input-warrants-speed"
                />
              </Field>
              <Field label="Crashes in last 12 months (optional)">
                <input
                  type="number" value={crashCount}
                  onChange={(e) => setCrashCount(e.target.value)}
                  min="0" placeholder="for Warrant 7"
                  className="input"
                  data-testid="input-warrants-crashes"
                />
              </Field>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={applyReduction}
                    onChange={(e) => setApplyReduction(e.target.checked)}
                    data-testid="check-warrants-reduction"
                  />
                  Force 70% thresholds
                  <span className="text-xs text-muted-foreground">(auto-applied if speed &gt; 40)</span>
                </label>
              </div>
            </div>

            <Field label="Major-street hourly volumes (24 values, 0–23h, comma or space-separated)">
              <textarea
                value={majorVolumes}
                onChange={(e) => setMajorVolumes(e.target.value)}
                rows={2}
                placeholder="e.g. 85, 60, 45, 40, 55, 120, 380, 720, 950, …"
                className="input font-mono text-xs"
                data-testid="textarea-warrants-major"
              />
            </Field>
            <Field label="Minor-approach hourly volumes (24 values, higher direction)">
              <textarea
                value={minorVolumes}
                onChange={(e) => setMinorVolumes(e.target.value)}
                rows={2}
                placeholder="e.g. 22, 18, 14, 12, 16, 35, 95, 175, …"
                className="input font-mono text-xs"
                data-testid="textarea-warrants-minor"
              />
            </Field>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="submit"
                disabled={running || !isAuthenticated}
                className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                data-testid="button-run-warrants"
              >
                {running && <Loader2 className="w-4 h-4 animate-spin" />}
                Run warrant analysis
              </button>
              <button
                type="button"
                onClick={loadSample}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-md border border-border hover:bg-accent"
                data-testid="button-load-sample"
              >
                Load Atlanta sample
              </button>
              {error && (
                <span className="text-sm text-red-600 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" /> {error}
                </span>
              )}
            </div>
          </form>
        </section>

        {report && <WarrantsReport report={report} />}
      </div>
      <SiteFooter />

      <style>{`.input { width: 100%; border-radius: 0.375rem; border: 1px solid hsl(var(--input)); background: var(--background); padding: 0.5rem 0.75rem; font-size: 0.875rem; }
      .input:focus { outline: 2px solid #2563eb; outline-offset: 1px; }`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5 block">
      <div className="text-sm font-medium">{label}</div>
      {children}
    </label>
  );
}
