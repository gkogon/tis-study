/**
 * Read-only project detail. Dispatches the rendering by `studyType`:
 *   - tis      → original TIS summary (affected-intersection table + LOS stats)
 *   - parking  → <ParkingReport> from the generator
 *   - warrants → <WarrantsReport> from the generator
 *
 * Falls back to a JSON dump for unknown types so we never lose data.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { ArrowLeft, Download, Loader2, MapPin } from "lucide-react";
import type { TisReport, TisAffectedIntersection } from "@workspace/tis-api-client-react";
import { ParkingReport, type ParkingReportT } from "../components/parking-report";
import { WarrantsReport, type WarrantsReportT } from "../components/warrants-report";
import { SightDistanceReport, type SightDistanceReportT } from "../components/sight-distance-report";

interface ProjectDetail {
  id: string;
  studyType: string;
  projectName: string;
  landUseCode: string;
  siteLat: string | null;
  siteLon: string | null;
  version: number;
  createdAt: string;
  request: unknown;
  result: unknown;
}

const LOS_COLOR: Record<string, string> = {
  A: "bg-green-100 text-green-800",
  B: "bg-green-100 text-green-800",
  C: "bg-amber-100 text-amber-800",
  D: "bg-amber-100 text-amber-800",
  E: "bg-red-100 text-red-800",
  F: "bg-red-100 text-red-800",
};

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const { isAuthenticated, isLoading: authLoading, login } = useAuth();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !params.id) return;
    let cancelled = false;
    fetch(`/tis-api/projects/${encodeURIComponent(params.id)}`, {
      credentials: "include",
    })
      .then(async (r) => {
        if (r.status === 404) throw new Error("Project not found.");
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: ProjectDetail) => {
        if (!cancelled) setProject(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, params.id]);

  if (authLoading) return null;

  if (!isAuthenticated) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-4">
        <h1 className="text-2xl font-semibold">Sign in to view this project</h1>
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

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 space-y-4">
        <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to projects
        </Link>
        <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 p-4 text-red-700 dark:text-red-200">
          {error}
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-16 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading project…
      </div>
    );
  }

  const downloadHref =
    "data:application/json;charset=utf-8," +
    encodeURIComponent(JSON.stringify(project, null, 2));
  const downloadName = `${project.projectName.replace(/[^a-z0-9-_]+/gi, "_")}.json`;

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link href="/projects" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="w-3.5 h-3.5" /> Back to projects
          </Link>
          <div className="flex items-center gap-2 mb-1">
            <StudyTypeBadge type={project.studyType} />
            <h1 className="text-2xl font-semibold">{project.projectName}</h1>
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
            <span>
              {project.studyType === "warrants" ? "Lane config" : "ITE"} {project.landUseCode}
            </span>
            {project.siteLat && project.siteLon && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3 h-3" />
                {Number(project.siteLat).toFixed(4)}, {Number(project.siteLon).toFixed(4)}
              </span>
            )}
            <span>Generated {new Date(project.createdAt).toLocaleString()}</span>
          </div>
        </div>
        <a
          href={downloadHref}
          download={downloadName}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border hover:bg-muted"
          data-testid="link-download-json"
        >
          <Download className="w-4 h-4" /> Download JSON
        </a>
      </div>

      <ResultRenderer project={project} />

      <div className="text-xs text-muted-foreground">
        This is a read-only summary of the stored report. To re-print or modify
        inputs, open the generator and re-run with the same parameters.
      </div>
    </div>
  );
}

function ResultRenderer({ project }: { project: ProjectDetail }) {
  switch (project.studyType) {
    case "parking":
      return <ParkingReport report={project.result as ParkingReportT} />;
    case "warrants":
      return <WarrantsReport report={project.result as WarrantsReportT} />;
    case "sight_distance":
      return <SightDistanceReport report={project.result as SightDistanceReportT} />;
    case "tis":
      return <TisDetailSummary result={project.result as TisReport} />;
    default:
      // Unknown study type — dump the raw JSON so the engineer doesn't
      // lose information even if the UI doesn't know how to render.
      return (
        <pre className="text-xs bg-muted/20 border rounded-lg p-4 overflow-x-auto">
          {JSON.stringify(project.result, null, 2)}
        </pre>
      );
  }
}

function StudyTypeBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; tint: string }> = {
    tis: { label: "TIS", tint: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
    parking: { label: "Parking", tint: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300" },
    warrants: { label: "Warrants", tint: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
    sight_distance: { label: "Sight", tint: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" },
  };
  const m = map[type] ?? { label: type.toUpperCase(), tint: "bg-muted text-muted-foreground" };
  return (
    <span className={"text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full " + m.tint}>
      {m.label}
    </span>
  );
}

function TisDetailSummary({ result: r }: { result: TisReport }) {
  const losDrop = r.intersectionsWithLosDrop ?? 0;
  const losEf = r.intersectionsAtLosEf ?? 0;
  const worstDelta = r.worstDelayDeltaSec ?? 0;
  const studied = r.intersectionsStudied ?? r.affectedIntersections.length;
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Intersections studied" value={studied.toString()} />
        <Stat label="LOS drops" value={losDrop.toString()} tone={losDrop > 0 ? "warn" : "ok"} />
        <Stat label="At LOS E/F" value={losEf.toString()} tone={losEf > 0 ? "bad" : "ok"} />
        <Stat
          label="Worst Δ delay"
          value={`${worstDelta >= 0 ? "+" : ""}${worstDelta.toFixed(1)}s`}
          tone={worstDelta >= 15 ? "bad" : worstDelta >= 5 ? "warn" : "ok"}
        />
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/30 text-sm font-semibold">
          Affected intersections ({r.affectedIntersections.length})
        </div>
        {r.affectedIntersections.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground text-center">
            No intersections in study radius.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground bg-muted/10">
              <tr>
                <th className="text-left px-3 py-2">Signal</th>
                <th className="text-right px-3 py-2">Trips</th>
                <th className="text-center px-3 py-2">Existing</th>
                <th className="text-center px-3 py-2">Future</th>
                <th className="text-right px-3 py-2">Δ delay</th>
                <th className="text-right px-3 py-2">Q95 ft</th>
              </tr>
            </thead>
            <tbody>
              {r.affectedIntersections.map((ai: TisAffectedIntersection) => {
                const delta = ai.futureDelaySec - ai.existingDelaySec;
                return (
                  <tr key={ai.signalId} className="border-t" data-testid={`row-detail-${ai.signalId}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium flex items-center gap-1.5">
                        {ai.name}
                        {ai.calibration && ai.calibration.sampleCount > 0 && (
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase bg-emerald-50 text-emerald-700 border border-emerald-200"
                            title={`Calibrated against ${ai.calibration.sampleCount} sample${ai.calibration.sampleCount === 1 ? "" : "s"}`}
                          >
                            Calibrated
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-muted-foreground font-mono">{ai.signalId}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{ai.addedTripsPmPeak}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block px-1.5 py-0.5 text-xs font-semibold rounded ${LOS_COLOR[ai.existingLos] ?? ""}`}>
                        {ai.existingLos}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block px-1.5 py-0.5 text-xs font-semibold rounded ${LOS_COLOR[ai.futureLos] ?? ""}`}>
                        {ai.futureLos}
                      </span>
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${delta >= 15 ? "text-red-600 font-semibold" : delta >= 5 ? "text-amber-600 font-semibold" : ""}`}>
                      {delta >= 0 ? "+" : ""}{delta.toFixed(1)}s
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{ai.queue95thFt.toFixed(0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad";
}) {
  const toneCls =
    tone === "bad"
      ? "text-red-600"
      : tone === "warn"
      ? "text-amber-600"
      : "text-foreground";
  return (
    <div className="rounded-md border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}
