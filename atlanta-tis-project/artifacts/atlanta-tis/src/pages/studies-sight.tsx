/**
 * Sight Distance Analysis generator (AASHTO Green Book 7th Ed.).
 *
 * Input: major/minor street, design speed, maneuver, optional measured
 * available SSD/ISD. Output: SSD + ISD verdicts with margin and notes.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { ArrowLeft, Eye, Loader2, AlertCircle } from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import {
  SightDistanceReport,
  type SightDistanceReportT,
} from "../components/sight-distance-report";

type Maneuver = "left_from_minor" | "right_from_minor" | "crossing_from_minor";
type VehicleClass = "passenger_car" | "single_unit_truck" | "combination_truck";

export default function SightDistanceStudyPage() {
  const { isAuthenticated, isLoading, login } = useAuth();

  const [projectName, setProjectName] = useState("");
  const [intersectionName, setIntersectionName] = useState("");
  const [majorName, setMajorName] = useState("");
  const [minorName, setMinorName] = useState("");
  const [designSpeed, setDesignSpeed] = useState("45");
  const [approachGrade, setApproachGrade] = useState("");
  const [maneuver, setManeuver] = useState<Maneuver>("left_from_minor");
  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("passenger_car");
  const [lanesToCross, setLanesToCross] = useState("");
  const [availableSsd, setAvailableSsd] = useState("");
  const [availableIsd, setAvailableIsd] = useState("");

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SightDistanceReportT | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setReport(null);
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
          designSpeedMph: Number(designSpeed),
        },
        minorStreet: { name: minorName.trim() },
        maneuver,
        vehicleClass,
      };
      if (approachGrade) (body.majorStreet as Record<string, unknown>).approachGradePct = Number(approachGrade);
      if (lanesToCross) (body.minorStreet as Record<string, unknown>).lanesToCross = Number(lanesToCross);
      if (availableSsd) body.availableSsdFt = Number(availableSsd);
      if (availableIsd) body.availableIsdFt = Number(availableIsd);

      const r = await fetch("/tis-api/sight-distance/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setReport(data as SightDistanceReportT);
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
            <Eye className="w-3.5 h-3.5" />
            Sight Distance Analysis
          </div>
          <h1 className="text-3xl font-bold">AASHTO Green Book — SSD &amp; ISD screening</h1>
          <p className="text-muted-foreground">
            Stopping Sight Distance and Intersection Sight Distance required at
            your candidate location, compared against the measured available
            distance. Output flags pass / marginal / fail per check, with
            recommended mitigations when a deficiency exists.
          </p>
        </header>

        {!isAuthenticated && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-sm text-amber-800 dark:text-amber-200 flex gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <div>
              Preview the form here; running the analysis requires sign-in.{" "}
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
                  placeholder="e.g. Driveway feasibility — Peachtree Industrial"
                  required maxLength={120} className="input"
                  data-testid="input-sd-project"
                />
              </Field>
              <Field label="Intersection name (optional)">
                <input
                  type="text" value={intersectionName}
                  onChange={(e) => setIntersectionName(e.target.value)}
                  maxLength={120} className="input"
                  data-testid="input-sd-intersection"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Major street name">
                <input
                  type="text" value={majorName}
                  onChange={(e) => setMajorName(e.target.value)}
                  required maxLength={120} className="input"
                  data-testid="input-sd-major-name"
                />
              </Field>
              <Field label="Design speed (mph)">
                <input
                  type="number" value={designSpeed}
                  onChange={(e) => setDesignSpeed(e.target.value)}
                  min="15" max="75" className="input"
                  data-testid="input-sd-speed"
                />
              </Field>
              <Field label="Approach grade % (optional)">
                <input
                  type="number" value={approachGrade}
                  onChange={(e) => setApproachGrade(e.target.value)}
                  min="-15" max="15" step="0.5" placeholder="0"
                  className="input"
                  data-testid="input-sd-grade"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Field label="Minor street name">
                <input
                  type="text" value={minorName}
                  onChange={(e) => setMinorName(e.target.value)}
                  required maxLength={120} className="input"
                  data-testid="input-sd-minor-name"
                />
              </Field>
              <Field label="Lanes to cross (optional)">
                <input
                  type="number" value={lanesToCross}
                  onChange={(e) => setLanesToCross(e.target.value)}
                  min="0" max="8" placeholder="0"
                  className="input"
                  data-testid="input-sd-lanes"
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Maneuver">
                  <select
                    value={maneuver}
                    onChange={(e) => setManeuver(e.target.value as Maneuver)}
                    className="input"
                    data-testid="select-sd-maneuver"
                  >
                    <option value="left_from_minor">Left from minor</option>
                    <option value="right_from_minor">Right from minor</option>
                    <option value="crossing_from_minor">Crossing</option>
                  </select>
                </Field>
                <Field label="Vehicle">
                  <select
                    value={vehicleClass}
                    onChange={(e) => setVehicleClass(e.target.value as VehicleClass)}
                    className="input"
                    data-testid="select-sd-vehicle"
                  >
                    <option value="passenger_car">Passenger car</option>
                    <option value="single_unit_truck">Single-unit truck</option>
                    <option value="combination_truck">Combination truck</option>
                  </select>
                </Field>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Available SSD measured (ft, optional)">
                <input
                  type="number" value={availableSsd}
                  onChange={(e) => setAvailableSsd(e.target.value)}
                  min="0" max="2000"
                  placeholder="from field measurement"
                  className="input"
                  data-testid="input-sd-avail-ssd"
                />
              </Field>
              <Field label="Available ISD measured (ft, optional)">
                <input
                  type="number" value={availableIsd}
                  onChange={(e) => setAvailableIsd(e.target.value)}
                  min="0" max="2000"
                  placeholder="from field measurement"
                  className="input"
                  data-testid="input-sd-avail-isd"
                />
              </Field>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="submit"
                disabled={running || !isAuthenticated}
                className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                data-testid="button-run-sight-distance"
              >
                {running && <Loader2 className="w-4 h-4 animate-spin" />}
                Run sight-distance analysis
              </button>
              {error && (
                <span className="text-sm text-red-600 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" /> {error}
                </span>
              )}
            </div>
          </form>
        </section>

        {report && <SightDistanceReport report={report} />}
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
