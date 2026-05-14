/**
 * Queuing Analysis generator (HCM Ch. 31).
 */
import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { ArrowLeft, Activity, Loader2, AlertCircle } from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { QueuingReport, type QueuingReportT } from "../components/queuing-report";

type Movement = "through" | "left_turn" | "right_turn";

export default function QueuingStudyPage() {
  const { isAuthenticated, isLoading, login } = useAuth();

  const [projectName, setProjectName] = useState("");
  const [intersectionName, setIntersectionName] = useState("");
  const [approachStreet, setApproachStreet] = useState("");
  const [movement, setMovement] = useState<Movement>("left_turn");
  const [volume, setVolume] = useState("");
  const [lanes, setLanes] = useState("1");
  const [cycle, setCycle] = useState("90");
  const [green, setGreen] = useState("18");
  const [storage, setStorage] = useState("");
  const [sat, setSat] = useState("");
  const [spacing, setSpacing] = useState("");

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<QueuingReportT | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setReport(null);
    if (!projectName.trim() || !approachStreet.trim()) {
      setError("Project name and approach street are required.");
      return;
    }
    setRunning(true);
    try {
      const body: Record<string, unknown> = {
        projectName: projectName.trim(),
        intersectionName: intersectionName.trim() || undefined,
        approachStreet: approachStreet.trim(),
        movement,
        hourlyVolumeVph: Number(volume),
        laneCount: Number(lanes),
        cycleLengthSec: Number(cycle),
        effectiveGreenSec: Number(green),
      };
      if (storage) body.availableStorageFt = Number(storage);
      if (sat) body.saturationFlowVphpl = Number(sat);
      if (spacing) body.vehicleSpacingFt = Number(spacing);

      const r = await fetch("/tis-api/queuing/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setReport(data as QueuingReportT);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run.");
    } finally {
      setRunning(false);
    }
  }

  if (isLoading) return null;

  return (
    <div>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        <div>
          <Link href="/studies" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to studies
          </Link>
        </div>

        <header className="space-y-2">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-700">
            <Activity className="w-3.5 h-3.5" /> Queuing Analysis
          </div>
          <h1 className="text-3xl font-bold">HCM Ch. 31 — 95th-percentile back-of-queue</h1>
          <p className="text-muted-foreground">
            Tests whether an auxiliary-lane bay (left-turn, right-turn, or through) is long
            enough to contain the 95th-percentile back-of-queue at the analysis hour.
            Use the full HCM-grade analysis in HCS or Synchro for the final design package.
          </p>
        </header>

        {!isAuthenticated && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-sm text-amber-800 dark:text-amber-200 flex gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <div>Sign in to run the analysis. <button onClick={login} className="underline font-medium">Sign in</button></div>
          </div>
        )}

        <section className="border rounded-xl p-6 space-y-4 bg-background">
          <form onSubmit={run} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Project name">
                <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} required maxLength={120} className="input" data-testid="input-q-project" />
              </Field>
              <Field label="Intersection name (optional)">
                <input type="text" value={intersectionName} onChange={(e) => setIntersectionName(e.target.value)} maxLength={120} className="input" data-testid="input-q-intersection" />
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Approach street">
                <input type="text" value={approachStreet} onChange={(e) => setApproachStreet(e.target.value)} placeholder="e.g. Northbound Cobb Pkwy" required maxLength={120} className="input" data-testid="input-q-approach" />
              </Field>
              <Field label="Movement">
                <select value={movement} onChange={(e) => setMovement(e.target.value as Movement)} className="input" data-testid="select-q-movement">
                  <option value="left_turn">Left turn</option>
                  <option value="through">Through</option>
                  <option value="right_turn">Right turn</option>
                </select>
              </Field>
              <Field label="Number of lanes">
                <input type="number" min="1" max="6" value={lanes} onChange={(e) => setLanes(e.target.value)} className="input" data-testid="input-q-lanes" />
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Hourly volume (vph)">
                <input type="number" min="0" max="8000" value={volume} onChange={(e) => setVolume(e.target.value)} required className="input" data-testid="input-q-vol" />
              </Field>
              <Field label="Cycle length (sec)">
                <input type="number" min="30" max="240" value={cycle} onChange={(e) => setCycle(e.target.value)} className="input" data-testid="input-q-cycle" />
              </Field>
              <Field label="Effective green (sec)">
                <input type="number" min="5" max="180" value={green} onChange={(e) => setGreen(e.target.value)} className="input" data-testid="input-q-green" />
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Available storage (ft, optional)">
                <input type="number" min="0" max="2000" value={storage} onChange={(e) => setStorage(e.target.value)} placeholder="leave blank for required-only" className="input" data-testid="input-q-storage" />
              </Field>
              <Field label="Saturation flow (vphpl, optional)">
                <input type="number" min="800" max="2400" value={sat} onChange={(e) => setSat(e.target.value)} placeholder="HCM defaults" className="input" data-testid="input-q-sat" />
              </Field>
              <Field label="Vehicle spacing (ft, optional)">
                <input type="number" min="15" max="80" value={spacing} onChange={(e) => setSpacing(e.target.value)} placeholder="25" className="input" data-testid="input-q-spacing" />
              </Field>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button type="submit" disabled={running || !isAuthenticated} className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50" data-testid="button-run-queuing">
                {running && <Loader2 className="w-4 h-4 animate-spin" />}
                Run queuing analysis
              </button>
              {error && <span className="text-sm text-red-600 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> {error}</span>}
            </div>
          </form>
        </section>

        {report && <QueuingReport report={report} />}
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
