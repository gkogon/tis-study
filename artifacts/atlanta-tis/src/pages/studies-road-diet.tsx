/**
 * Road-Diet Feasibility generator.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { ArrowLeft, Loader2, AlertCircle, ChevronRight } from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { RoadDietReport, type RoadDietReportT } from "../components/road-diet-report";

type Config = "4_lane_undivided" | "4_lane_divided" | "5_lane_with_twltl" | "3_lane_with_twltl" | "2_lane";

const CONFIG_OPTIONS: { value: Config; label: string }[] = [
  { value: "4_lane_undivided", label: "4-lane undivided" },
  { value: "4_lane_divided", label: "4-lane divided" },
  { value: "5_lane_with_twltl", label: "5-lane with TWLTL" },
  { value: "3_lane_with_twltl", label: "3-lane with TWLTL" },
  { value: "2_lane", label: "2-lane" },
];

export default function RoadDietStudyPage() {
  const { isAuthenticated, isLoading, login } = useAuth();

  const [projectName, setProjectName] = useState("");
  const [corridorName, setCorridorName] = useState("");
  const [currentConfig, setCurrentConfig] = useState<Config>("4_lane_undivided");
  const [proposedConfig, setProposedConfig] = useState<Config>("3_lane_with_twltl");
  const [adt, setAdt] = useState("");
  const [peakVph, setPeakVph] = useState("");
  const [speed, setSpeed] = useState("35");
  const [crashes, setCrashes] = useState("");
  const [hasParking, setHasParking] = useState(false);
  const [hasBike, setHasBike] = useState(false);
  const [hasFreight, setHasFreight] = useState(false);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<RoadDietReportT | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setReport(null);
    if (!projectName.trim()) { setError("Project name required."); return; }
    setRunning(true);
    try {
      const body: Record<string, unknown> = {
        projectName: projectName.trim(),
        corridorName: corridorName.trim() || undefined,
        currentConfig, proposedConfig,
        adt: Number(adt),
        postedSpeedMph: Number(speed),
        hasOnstreetParking: hasParking,
        hasBikeAccommodations: hasBike,
        hasFreightRoute: hasFreight,
      };
      if (peakVph) body.peakHourVph = Number(peakVph);
      if (crashes) body.crashCount12mo = Number(crashes);

      const r = await fetch("/tis-api/road-diet/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setReport(data as RoadDietReportT);
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
            <ChevronRight className="w-3.5 h-3.5" /> Road-Diet Feasibility
          </div>
          <h1 className="text-3xl font-bold">FHWA screening: 4→3 / 5→3 lane conversion</h1>
          <p className="text-muted-foreground">
            Tests capacity headroom of the proposed cross-section against ADT + peak demand
            and reports the FHWA-documented mean crash reduction and multimodal benefits.
            Above 25,000 ADT, a full corridor study is required regardless of the screening.
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
                <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)} required maxLength={120} className="input" data-testid="input-rd-project" />
              </Field>
              <Field label="Corridor name (optional)">
                <input type="text" value={corridorName} onChange={(e) => setCorridorName(e.target.value)} maxLength={120} className="input" data-testid="input-rd-corridor" />
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Current configuration">
                <select value={currentConfig} onChange={(e) => setCurrentConfig(e.target.value as Config)} className="input" data-testid="select-rd-current">
                  {CONFIG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Proposed configuration">
                <select value={proposedConfig} onChange={(e) => setProposedConfig(e.target.value as Config)} className="input" data-testid="select-rd-proposed">
                  {CONFIG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="ADT (vehicles/day)">
                <input type="number" min="500" max="80000" value={adt} onChange={(e) => setAdt(e.target.value)} required className="input" data-testid="input-rd-adt" />
              </Field>
              <Field label="Peak-hour volume (vph, optional)">
                <input type="number" min="50" max="8000" value={peakVph} onChange={(e) => setPeakVph(e.target.value)} placeholder="auto (8.5% of ADT)" className="input" data-testid="input-rd-peak" />
              </Field>
              <Field label="Posted speed (mph)">
                <input type="number" min="15" max="60" value={speed} onChange={(e) => setSpeed(e.target.value)} className="input" data-testid="input-rd-speed" />
              </Field>
            </div>

            <Field label="Crashes in last 12 months (optional)">
              <input type="number" min="0" max="500" value={crashes} onChange={(e) => setCrashes(e.target.value)} placeholder="for absolute reduction estimate" className="input" data-testid="input-rd-crashes" />
            </Field>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={hasParking} onChange={(e) => setHasParking(e.target.checked)} data-testid="check-rd-parking" />
                On-street parking
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={hasBike} onChange={(e) => setHasBike(e.target.checked)} data-testid="check-rd-bike" />
                Existing bike accommodations
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={hasFreight} onChange={(e) => setHasFreight(e.target.checked)} data-testid="check-rd-freight" />
                Designated freight route
              </label>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button type="submit" disabled={running || !isAuthenticated} className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50" data-testid="button-run-road-diet">
                {running && <Loader2 className="w-4 h-4 animate-spin" />}
                Run feasibility screening
              </button>
              {error && <span className="text-sm text-red-600 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> {error}</span>}
            </div>
          </form>
        </section>

        {report && <RoadDietReport report={report} />}
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
