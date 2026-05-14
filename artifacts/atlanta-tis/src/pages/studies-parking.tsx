/**
 * Parking Demand Study generator. Lets the engineer pick a land use,
 * enter project size + proposed supply (+ optional jurisdictional code
 * override and shared-use reduction), runs the engine, and renders:
 *   - the ITE-derived peak demand
 *   - the local code minimum
 *   - the governing comparison (which constraint binds) and surplus/deficit
 *   - a 24-hour weekday/Saturday profile
 *
 * Bare-bones UI on purpose — once the calc shape is proven we can swap
 * in the same level of polish as the TIS report (chart, exec summary,
 * citation footnotes).
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  ArrowLeft, ParkingCircle, Loader2, AlertCircle,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";
import { ParkingReport, type ParkingReportT } from "../components/parking-report";

type LandUse = {
  code: string;
  name: string;
  unit: string;
  unitShort: string;
  weekdayPeakRate: number;
  saturdayPeakRate: number;
  codeMinPerUnit: number;
};

export default function ParkingStudyPage() {
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();
  const [landUses, setLandUses] = useState<LandUse[] | null>(null);

  const [projectName, setProjectName] = useState("");
  const [landUseCode, setLandUseCode] = useState("");
  const [size, setSize] = useState("");
  const [proposedSpaces, setProposedSpaces] = useState("");
  const [codeOverride, setCodeOverride] = useState("");
  const [sharedReduction, setSharedReduction] = useState("");

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ParkingReportT | null>(null);

  useEffect(() => {
    fetch("/tis-api/parking/land-uses")
      .then((r) => r.json())
      .then((data: LandUse[]) => {
        setLandUses(data);
        if (data[0]) setLandUseCode(data[0].code);
      })
      .catch(() => setLandUses([]));
  }, []);

  const selectedLandUse = landUses?.find((lu) => lu.code === landUseCode) ?? null;

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setReport(null);
    if (!projectName.trim() || !landUseCode || !size || !proposedSpaces) {
      setError("Project name, land use, size, and proposed spaces are required.");
      return;
    }
    setRunning(true);
    try {
      const body: Record<string, unknown> = {
        projectName: projectName.trim(),
        landUseCode,
        size: Number(size),
        proposedSpaces: Number(proposedSpaces),
      };
      if (codeOverride) body.codeMinOverridePerUnit = Number(codeOverride);
      if (sharedReduction) body.sharedUseReductionPct = Number(sharedReduction);

      const r = await fetch("/tis-api/parking/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setReport(data as ParkingReportT);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run parking study.");
    } finally {
      setRunning(false);
    }
  }

  if (authLoading) return null;

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
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-700">
            <ParkingCircle className="w-3.5 h-3.5" />
            Parking Demand Study
          </div>
          <h1 className="text-3xl font-bold">Peak demand vs. code vs. proposed</h1>
          <p className="text-muted-foreground">
            ITE Parking Generation 5th Ed. rates applied to your land use & size,
            compared against the City of Atlanta minimum (or your jurisdictional
            override) and the proposed supply.
          </p>
        </header>

        {!isAuthenticated && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-sm text-amber-800 dark:text-amber-200 flex gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <div>
              You can preview the form, but generating a study requires sign-in. {" "}
              <button onClick={login} className="underline font-medium">Sign in</button>
            </div>
          </div>
        )}

        <section className="border rounded-xl p-6 space-y-4 bg-background">
          <form onSubmit={run} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Project name">
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="e.g. Midtown Mixed-Use"
                maxLength={120}
                required
                className="input"
                data-testid="input-parking-name"
              />
            </Field>
            <Field label="Land use (ITE)">
              <select
                value={landUseCode}
                onChange={(e) => setLandUseCode(e.target.value)}
                className="input"
                data-testid="select-parking-landuse"
              >
                {(landUses ?? []).map((lu) => (
                  <option key={lu.code} value={lu.code}>
                    {lu.code} — {lu.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`Size ${selectedLandUse ? `(${selectedLandUse.unitShort})` : ""}`}>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="e.g. 120"
                required
                className="input"
                data-testid="input-parking-size"
              />
            </Field>
            <Field label="Proposed parking spaces">
              <input
                type="number"
                min="0"
                step="1"
                value={proposedSpaces}
                onChange={(e) => setProposedSpaces(e.target.value)}
                placeholder="e.g. 180"
                required
                className="input"
                data-testid="input-parking-proposed"
              />
            </Field>
            <Field label="Code override per unit (optional)">
              <input
                type="number"
                min="0"
                max="20"
                step="0.1"
                value={codeOverride}
                onChange={(e) => setCodeOverride(e.target.value)}
                placeholder={selectedLandUse ? `default ${selectedLandUse.codeMinPerUnit}` : ""}
                className="input"
                data-testid="input-parking-override"
              />
            </Field>
            <Field label="Shared-use reduction % (optional)">
              <input
                type="number"
                min="0"
                max="40"
                step="1"
                value={sharedReduction}
                onChange={(e) => setSharedReduction(e.target.value)}
                placeholder="0–40%"
                className="input"
                data-testid="input-parking-shared"
              />
            </Field>

            <div className="md:col-span-2 flex items-center gap-3">
              <button
                type="submit"
                disabled={running || !isAuthenticated}
                className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50"
                data-testid="button-run-parking"
              >
                {running && <Loader2 className="w-4 h-4 animate-spin" />}
                Run parking study
              </button>
              {error && (
                <span className="text-sm text-red-600 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" /> {error}
                </span>
              )}
            </div>
          </form>
        </section>

        {report && <ParkingReport report={report} />}
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
