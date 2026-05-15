/**
 * Public /demo page. Lets a non-signed-in prospect pick from 4
 * curated Atlanta presets (Multifamily / Office / Retail / Drive-
 * Thru), run a REAL screening-level TIS against live GDOT data, and
 * see the deliverable inline — all in ~30 seconds without giving us
 * their email.
 *
 * The conversion goal isn't "complete the demo and leave" — it's
 * "feel the workflow, then sign up because the friction to keep
 * going is lower than the friction to leave." The post-run UI
 * leans heavily into the signup CTA.
 *
 * Backed by POST /tis-api/demo/generate with the demoRateLimiter
 * (3/day/IP).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import {
  Sparkles, Building2, Briefcase, ShoppingBag, Coffee,
  Loader2, ArrowRight, AlertCircle, MapPin, FileCheck2, ChevronRight,
  Hourglass, ShieldCheck,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

type Preset = { id: string; label: string };

type DemoReport = {
  generatedAt: string;
  studyRadiusMi: number;
  tripGeneration: {
    landUseName: string;
    size: number;
    unit: string;
    dailyTrips: number;
    amPeakTrips: number;
    pmPeakTrips: number;
    pmIn: number;
    pmOut: number;
  };
  intersectionsStudied: number;
  intersectionsWithLosDrop: number;
  intersectionsAtLosEf: number;
  worstDelayDeltaSec: number;
  findings: string[];
  methodology: string[];
  affectedIntersections: Array<{
    name: string;
    distanceMi: number;
    addedTripsPmPeak: number;
    existingLos: string;
    futureLos: string;
    existingDelaySec: number;
    futureDelaySec: number;
    losChanged: boolean;
    mitigation: string;
    mitigationSeverity: string;
  }>;
  sensitivity?: {
    iterations: number;
    worstDelayDeltaMean: number;
    probAnyLosDrop: number;
    probAnyLosEf: number;
  };
};

type DemoResponse = {
  presetId: string;
  presetLabel: string;
  report: DemoReport;
};

const ICONS: Record<string, typeof Building2> = {
  multifamily: Building2,
  office: Briefcase,
  retail: ShoppingBag,
  drivethrough: Coffee,
};

const LOS_CHIP: Record<string, string> = {
  A: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  B: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  C: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  D: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  E: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
  F: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
};

export default function DemoPage() {
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [response, setResponse] = useState<DemoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/tis-api/demo/presets")
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setPresets(data.presets ?? []); })
      .catch(() => { if (!cancelled) setPresets([]); });
    return () => { cancelled = true; };
  }, []);

  async function run(presetId: string) {
    setLoading(true);
    setError(null);
    setActivePreset(presetId);
    setResponse(null);
    try {
      const r = await fetch("/tis-api/demo/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setResponse(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setResponse(null);
    setActivePreset(null);
    setError(null);
  }

  return (
    <div className="overflow-x-hidden">
      {!response && (
        <div className="relative">
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 -z-10 h-[500px] bg-gradient-to-b from-slate-100/80 via-background to-background dark:from-slate-900/30"
          />
          <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-16 sm:pt-20 pb-12 space-y-6 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 dark:bg-slate-100 border border-slate-900 dark:border-slate-100 text-xs font-medium text-white dark:text-slate-900">
              <Sparkles className="w-3.5 h-3.5" />
              Live demo · no signup required
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold leading-[1.05] tracking-tight text-slate-900 dark:text-slate-50 max-w-3xl mx-auto">
              Run a real screening TIS
              <br />
              <span className="bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-600 bg-clip-text text-transparent">
                in the next 30 seconds.
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
              Pick a curated Atlanta project below. We'll generate a full TIS
              against live GDOT data — same engine, same methodology, same
              output a paying customer gets. No email required.
            </p>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
        {!response && !loading && (
          <PresetGrid presets={presets} onPick={run} />
        )}

        {loading && <LoadingState presetId={activePreset} />}

        {error && !loading && (
          <ErrorState message={error} onReset={reset} />
        )}

        {response && (
          <ResultView response={response} onReset={reset} />
        )}

        {!response && !loading && (
          <FooterTrust />
        )}
      </div>

      <SiteFooter />
    </div>
  );
}

function PresetGrid({
  presets, onPick,
}: { presets: Preset[] | null; onPick: (id: string) => void }) {
  if (!presets) {
    return (
      <div className="grid sm:grid-cols-2 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-border bg-background p-6 h-32 animate-pulse" />
        ))}
      </div>
    );
  }
  if (presets.length === 0) {
    return (
      <div className="rounded-2xl border border-border p-8 text-center text-sm text-muted-foreground">
        Demo presets are temporarily unavailable.{" "}
        <Link href="/signup" className="text-blue-700 hover:underline">Sign up free</Link> and run a real study instead.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="text-center max-w-xl mx-auto">
        <div className="text-xs font-semibold uppercase tracking-widest text-blue-700 mb-2">
          Step 1
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Pick a project type.
        </h2>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {presets.map((p) => {
          const Icon = ICONS[p.id] ?? Building2;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p.id)}
              className="group text-left rounded-2xl border border-border bg-background p-6 space-y-3 hover:border-foreground/30 hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1 group-hover:text-blue-700 transition-colors">
                  Run demo <ChevronRight className="w-3.5 h-3.5" />
                </span>
              </div>
              <div className="font-semibold text-base tracking-tight">{p.label}</div>
              <div className="text-xs text-muted-foreground">
                Real Atlanta site · live GDOT data · ~30s
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LoadingState({ presetId }: { presetId: string | null }) {
  const stages = useMemo(
    () => [
      "Pulling live GDOT signal data",
      "Calculating ITE-11th-Ed. trip generation",
      "Running HCM 6th-Ed. capacity analysis",
      "Computing Monte-Carlo sensitivity",
      "Drafting findings + methodology",
    ],
    [],
  );
  const [stageIdx, setStageIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setStageIdx((i) => Math.min(stages.length - 1, i + 1));
    }, 4500);
    return () => clearInterval(t);
  }, [stages.length]);
  return (
    <div className="rounded-2xl border border-border bg-gradient-to-br from-slate-50 to-background dark:from-slate-950/40 p-10 sm:p-14 text-center space-y-6">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 mx-auto">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
      <div className="space-y-2 max-w-md mx-auto">
        <h2 className="text-2xl font-bold tracking-tight">Generating your study…</h2>
        <p className="text-sm text-muted-foreground">
          Running the same screening pipeline a paying customer's study runs
          through. This usually takes 20–60 seconds.
        </p>
      </div>
      <ol className="space-y-1.5 max-w-md mx-auto text-left">
        {stages.map((s, i) => (
          <li
            key={s}
            className={
              "flex items-center gap-2 text-sm transition-colors " +
              (i < stageIdx
                ? "text-foreground"
                : i === stageIdx
                  ? "text-foreground font-medium"
                  : "text-muted-foreground/60")
            }
          >
            <span className={
              "inline-flex items-center justify-center w-4 h-4 rounded-full shrink-0 " +
              (i < stageIdx
                ? "bg-blue-700 text-white"
                : i === stageIdx
                  ? "bg-blue-700/20 text-blue-700"
                  : "bg-muted text-muted-foreground")
            }>
              {i < stageIdx ? "✓" : i === stageIdx ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : ""}
            </span>
            {s}
          </li>
        ))}
      </ol>
      <div className="text-[11px] text-muted-foreground pt-2 font-mono">
        Preset: {presetId}
      </div>
    </div>
  );
}

function ErrorState({ message, onReset }: { message: string; onReset: () => void }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900 p-8 text-center space-y-4">
      <AlertCircle className="w-8 h-8 text-red-700 mx-auto" />
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight">Demo didn't complete</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">{message}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={onReset}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md border hover:bg-accent transition-colors"
        >
          Try another preset
        </button>
        <Link
          href="/signup?plan=trial"
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-foreground text-background hover:bg-foreground/90 transition-all"
        >
          Sign up to run a real study <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}

function ResultView({ response, onReset }: { response: DemoResponse; onReset: () => void }) {
  const r = response.report;
  const tg = r.tripGeneration;
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          ← Run a different preset
        </button>
        <div className="text-xs font-semibold uppercase tracking-widest text-blue-700">
          Your demo result
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
          {response.presetLabel}
        </h1>
        <p className="text-sm text-muted-foreground">
          Generated against live GDOT data · ITE 11th Ed. · HCM 6th Ed. · MUTCD
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-background overflow-hidden shadow-sm">
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border">
          <BigMetric value={String(r.intersectionsStudied)} label="Intersections" />
          <BigMetric value={String(r.intersectionsWithLosDrop)} label="LOS drops" tone={r.intersectionsWithLosDrop > 0 ? "warn" : "good"} />
          <BigMetric value={String(r.intersectionsAtLosEf)} label="At LOS E/F" tone={r.intersectionsAtLosEf > 0 ? "warn" : "good"} />
          <BigMetric value={`+${r.worstDelayDeltaSec.toFixed(1)}s`} label="Worst Δ delay" />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-background p-6 sm:p-8 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          PM Peak Trip Generation
        </div>
        <div className="grid sm:grid-cols-3 gap-4">
          <Stat label="Daily trips" value={tg.dailyTrips.toLocaleString()} />
          <Stat label="AM peak" value={String(tg.amPeakTrips)} />
          <Stat label={`PM peak (${tg.pmIn} in / ${tg.pmOut} out)`} value={String(tg.pmPeakTrips)} />
        </div>
        <div className="text-xs text-muted-foreground pt-1">
          {tg.landUseName} · {tg.size} {tg.unit}
        </div>
      </div>

      {r.affectedIntersections.length > 0 && (
        <div className="rounded-2xl border border-border bg-background overflow-hidden">
          <div className="px-6 py-4 border-b border-border bg-slate-50 dark:bg-slate-950/40 flex items-center justify-between flex-wrap gap-2">
            <div className="font-semibold tracking-tight">
              Affected intersections ({r.affectedIntersections.length})
            </div>
            <div className="text-xs text-muted-foreground">
              Sorted by distance from site
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Signal</th>
                  <th className="text-right px-4 py-2 font-medium">Dist (mi)</th>
                  <th className="text-right px-4 py-2 font-medium">+ Trips</th>
                  <th className="text-center px-4 py-2 font-medium">Existing</th>
                  <th className="text-center px-4 py-2 font-medium">Future</th>
                  <th className="text-right px-4 py-2 font-medium">Δ delay</th>
                </tr>
              </thead>
              <tbody>
                {r.affectedIntersections.slice(0, 12).map((it, idx) => {
                  const delta = it.futureDelaySec - it.existingDelaySec;
                  return (
                    <tr key={idx} className="border-t border-border">
                      <td className="px-4 py-2 font-medium">{it.name}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{it.distanceMi.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{Math.round(it.addedTripsPmPeak)}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${LOS_CHIP[it.existingLos] ?? ""}`}>
                          {it.existingLos}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${LOS_CHIP[it.futureLos] ?? ""}`}>
                          {it.losChanged ? "▲ " : ""}{it.futureLos}
                        </span>
                      </td>
                      <td className={`px-4 py-2 text-right tabular-nums ${delta > 5 ? "text-red-700 font-medium" : "text-muted-foreground"}`}>
                        +{delta.toFixed(1)}s
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {r.affectedIntersections.length > 12 && (
            <div className="px-4 py-2 text-xs text-muted-foreground text-center border-t border-border bg-muted/20">
              Showing first 12 of {r.affectedIntersections.length}. Full report (with approach-level v/c, queues, and mitigations) ships in the signed-in version.
            </div>
          )}
        </div>
      )}

      {r.findings.length > 0 && (
        <div className="rounded-2xl border border-border bg-background p-6 sm:p-8 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Key findings
          </div>
          <ul className="space-y-2 text-sm leading-relaxed">
            {r.findings.slice(0, 4).map((f, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="text-blue-700 mt-1">•</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Conversion section — strong CTA to sign up */}
      <div className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white px-6 sm:px-12 py-10 sm:py-14 overflow-hidden relative">
        <div
          aria-hidden
          className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-blue-600/20 blur-3xl pointer-events-none"
        />
        <div className="relative space-y-5">
          <div className="text-xs font-semibold uppercase tracking-widest text-blue-300">
            You just ran a real screening study
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight max-w-2xl">
            Save it, white-label it, run more.
            <br />
            <span className="text-blue-300">10 free studies on signup.</span>
          </h2>
          <p className="text-slate-300 leading-relaxed max-w-2xl">
            Sign up free and the full deliverable — cover page with your firm
            logo, methodology + limitations appendices, PE stamp box,
            approach-level v/c + queues, mitigation recommendations sized to
            the impact — is yours to download as a PDF. No credit card.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/signup?plan=trial"
              className="group inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg bg-white text-slate-900 hover:bg-slate-100 transition-all shadow-sm"
            >
              Sign up free <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <a
              href="/sample-tis-report.pdf"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold rounded-lg border border-white/20 hover:bg-white/10 transition-colors"
            >
              <FileCheck2 className="w-4 h-4" /> Download a sample PDF
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function BigMetric({
  value, label, tone,
}: { value: string; label: string; tone?: "warn" | "good" }) {
  const valueColor =
    tone === "warn" ? "text-amber-600" :
    tone === "good" ? "text-green-700" :
    "text-foreground";
  return (
    <div className="px-4 py-5 text-center">
      <div className={`text-3xl sm:text-4xl font-bold tabular-nums tracking-tight ${valueColor}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
        {label}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-bold tabular-nums tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function FooterTrust() {
  return (
    <div className="border-t border-border pt-8 mt-8 space-y-6">
      <div className="text-center max-w-2xl mx-auto space-y-2">
        <div className="text-xs font-semibold uppercase tracking-widest text-blue-700">
          What you'll get
        </div>
        <h3 className="text-xl font-bold tracking-tight">A real study, not a marketing demo.</h3>
      </div>
      <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
        <TrustTile
          icon={Hourglass}
          label="~30 seconds"
          body="From button click to results, end-to-end."
        />
        <TrustTile
          icon={MapPin}
          label="Live GDOT data"
          body="49 indexed metro signals, 2,589 cameras."
        />
        <TrustTile
          icon={ShieldCheck}
          label="HCM 6th Ed. capacity"
          body="Same methodology a real TIS submittal cites."
        />
      </div>
      <div className="text-xs text-muted-foreground text-center pt-2">
        Demo is rate-limited to 3 runs/day per IP. Sign up for the full
        deliverable + unlimited runs on Growth.
      </div>
    </div>
  );
}

function TrustTile({
  icon: Icon, label, body,
}: { icon: typeof Hourglass; label: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-2">
      <Icon className="w-5 h-5 text-blue-700" />
      <div className="font-semibold text-sm">{label}</div>
      <div className="text-xs text-muted-foreground leading-relaxed">{body}</div>
    </div>
  );
}
