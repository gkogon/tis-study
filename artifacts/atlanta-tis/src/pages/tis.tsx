import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  useListTisLandUses,
  useGenerateTis,
  type TisRequest,
  type TisReport,
  type TisAffectedIntersection,
  type TisApproachImpact,
  type TisPeriodReport,
  type TisAnalysisPeriod,
  type TisWeather,
  type TisLandUse,
} from "@workspace/tis-api-client-react";
import { MapContainer, TileLayer, CircleMarker, Marker, Tooltip as LeafletTooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft, Printer, Building2, MapPin, Car, Activity, ChevronDown, ChevronRight,
  CheckCircle2, AlertTriangle, AlertCircle, FileText, Info, Calculator, Settings,
  CloudRain, TrendingUp, Sliders, Sparkles, BarChart3,
} from "lucide-react";
import { CitationRef } from "@/components/citation-ref";
import { QuotaBanner } from "@/components/quota-banner";
import { FirmSettingsModal } from "@/components/firm-settings-modal";
import { AuthBar } from "@/components/auth-bar";
import { TisCoverPage } from "@/components/tis-cover-page";
import { TisMethodologyAppendix } from "@/components/tis-methodology-appendix";
import { TisLimitations } from "@/components/tis-limitations";
import {
  loadFirmBranding,
  loadProjectMetadata,
  saveProjectMetadata,
  isFirmConfigured,
  projectKey,
  type FirmBranding,
  type ProjectMetadata,
  emptyProjectMetadata,
} from "@/lib/firm-branding";

// ±15% confidence band on delay-delta projections at the 80% confidence
// level. Mirrors the calibration RMSE disclosure in the methodology appendix.
const DELAY_CONFIDENCE_FRAC = 0.15;
function delayBand(delta: number): { lo: number; hi: number } {
  const half = Math.abs(delta) * DELAY_CONFIDENCE_FRAC;
  return { lo: delta - half, hi: delta + half };
}

type ProjectTemplate = {
  category: "Residential" | "Office" | "Retail" | "Hospitality" | "Other";
  description: string;
  request: TisRequest;
};

const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    category: "Residential",
    description: "Mid-rise apartments, ~280 DU. Typical Midtown multifamily.",
    request: {
      projectName: "Midtown Multifamily",
      address: "1100 Peachtree St NE, Atlanta, GA 30309",
      latitude: 33.7861, longitude: -84.3853,
      landUseCode: "221", size: 280, openingYear: 2027, studyRadiusMi: 0.5,
      analysisPeriods: ["am_peak", "pm_peak", "saturday_midday", "daily"],
      growthRatePct: 1.5, weather: "clear", runSensitivity: true,
    },
  },
  {
    category: "Residential",
    description: "Suburban single-family subdivision, 60 homes.",
    request: {
      projectName: "Suburban SFD Subdivision",
      address: "Sandy Springs, GA",
      latitude: 33.9304, longitude: -84.3733,
      landUseCode: "210", size: 60, openingYear: 2027, studyRadiusMi: 0.5,
      analysisPeriods: ["am_peak", "pm_peak", "daily"],
      growthRatePct: 2.0, weather: "clear", runSensitivity: false,
    },
  },
  {
    category: "Office",
    description: "Class-A office, 220 ksf GFA. Buckhead-tier project.",
    request: {
      projectName: "Buckhead Office Building",
      address: "3344 Peachtree Rd NE, Atlanta, GA 30326",
      latitude: 33.8454, longitude: -84.3651,
      landUseCode: "710", size: 220, openingYear: 2027, studyRadiusMi: 0.5,
      analysisPeriods: ["am_peak", "pm_peak", "daily"],
      growthRatePct: 1.5, weather: "clear", runSensitivity: true,
    },
  },
  {
    category: "Office",
    description: "Medical/dental office building, 50 ksf GFA.",
    request: {
      projectName: "Medical Office Building",
      address: "Atlanta, GA",
      latitude: 33.7929, longitude: -84.3909,
      landUseCode: "720", size: 50, openingYear: 2027, studyRadiusMi: 0.5,
      analysisPeriods: ["am_peak", "pm_peak", "daily"],
      growthRatePct: 1.5, weather: "clear", runSensitivity: false,
    },
  },
  {
    category: "Retail",
    description: "Neighborhood shopping center, 75 ksf GLA. Includes pass-by credit.",
    request: {
      projectName: "Westside Shopping Center",
      address: "1198 Howell Mill Rd NW, Atlanta, GA 30318",
      latitude: 33.7867, longitude: -84.4145,
      landUseCode: "820", size: 75, openingYear: 2027, studyRadiusMi: 0.5,
      analysisPeriods: ["am_peak", "pm_peak", "saturday_midday", "daily"],
      growthRatePct: 1.5, weather: "clear", passByPct: 25, runSensitivity: true,
    },
  },
  {
    category: "Retail",
    description: "Fast-food w/ drive-through, 4 ksf. High-pass-by retail.",
    request: {
      projectName: "Fast-Food Drive-Through",
      address: "Atlanta, GA",
      latitude: 33.7501, longitude: -84.3885,
      landUseCode: "934", size: 4, openingYear: 2027, studyRadiusMi: 0.5,
      analysisPeriods: ["am_peak", "pm_peak", "saturday_midday", "daily"],
      growthRatePct: 1.5, weather: "clear", passByPct: 40, runSensitivity: false,
    },
  },
  {
    category: "Retail",
    description: "Sit-down restaurant, 6 ksf. Saturday-midday peak.",
    request: {
      projectName: "Casual Restaurant",
      address: "Atlanta, GA",
      latitude: 33.7741, longitude: -84.3960,
      landUseCode: "932", size: 6, openingYear: 2027, studyRadiusMi: 0.5,
      analysisPeriods: ["pm_peak", "saturday_midday", "daily"],
      growthRatePct: 1.5, weather: "clear", passByPct: 35, runSensitivity: false,
    },
  },
  {
    category: "Hospitality",
    description: "Mid-scale hotel, 150 rooms. Saturday peak driver.",
    request: {
      projectName: "Downtown Hotel",
      address: "Atlanta, GA",
      latitude: 33.7565, longitude: -84.3859,
      landUseCode: "310", size: 150, openingYear: 2027, studyRadiusMi: 0.5,
      analysisPeriods: ["am_peak", "pm_peak", "saturday_midday", "daily"],
      growthRatePct: 1.5, weather: "clear", runSensitivity: false,
    },
  },
];

const LOS_COLORS: Record<string, { bg: string; fg: string; border: string; map: string }> = {
  A: { bg: "bg-emerald-100 dark:bg-emerald-950/40", fg: "text-emerald-800 dark:text-emerald-200", border: "border-emerald-300", map: "#10b981" },
  B: { bg: "bg-emerald-100 dark:bg-emerald-950/40", fg: "text-emerald-800 dark:text-emerald-200", border: "border-emerald-300", map: "#22c55e" },
  C: { bg: "bg-yellow-100 dark:bg-yellow-950/40", fg: "text-yellow-800 dark:text-yellow-200", border: "border-yellow-300", map: "#eab308" },
  D: { bg: "bg-amber-100 dark:bg-amber-950/40", fg: "text-amber-800 dark:text-amber-200", border: "border-amber-300", map: "#f59e0b" },
  E: { bg: "bg-orange-100 dark:bg-orange-950/40", fg: "text-orange-800 dark:text-orange-200", border: "border-orange-300", map: "#f97316" },
  F: { bg: "bg-red-100 dark:bg-red-950/40", fg: "text-red-800 dark:text-red-200", border: "border-red-300", map: "#dc2626" },
};

const SEVERITY_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  none: { label: "No mitigation", color: "text-emerald-600", icon: CheckCircle2 },
  minor: { label: "Minor", color: "text-yellow-600", icon: Info },
  moderate: { label: "Moderate", color: "text-amber-600", icon: AlertTriangle },
  major: { label: "Major", color: "text-red-600", icon: AlertCircle },
};

function siteIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    html: `<div style="
      width:24px;height:24px;border-radius:50% 50% 50% 0;
      background:#0079F2;border:2px solid #fff;
      transform:rotate(-45deg) translate(4px, 4px);
      box-shadow:0 2px 5px rgba(0,0,0,0.4);
    "></div>`,
  });
}

function LosBadge({ los }: { los: string }) {
  const c = LOS_COLORS[los] ?? LOS_COLORS.A!;
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded font-bold text-sm border ${c.bg} ${c.fg} ${c.border}`}>
      {los}
    </span>
  );
}

const ALL_PERIODS: TisAnalysisPeriod[] = ["am_peak", "pm_peak", "saturday_midday", "daily"];
const PERIOD_SHORT: Record<TisAnalysisPeriod, string> = {
  am_peak: "AM",
  pm_peak: "PM",
  saturday_midday: "Sat",
  daily: "Daily",
};
const PERIOD_LONG: Record<TisAnalysisPeriod, string> = {
  am_peak: "AM Peak",
  pm_peak: "PM Peak",
  saturday_midday: "Saturday Midday",
  daily: "Daily Total",
};
const WEATHER_OPTIONS: Array<{ value: TisWeather; label: string; cap: number }> = [
  { value: "clear", label: "Clear", cap: 1.0 },
  { value: "light_rain", label: "Light rain", cap: 0.95 },
  { value: "heavy_rain", label: "Heavy rain", cap: 0.86 },
  { value: "light_snow", label: "Light snow", cap: 0.86 },
  { value: "heavy_snow", label: "Heavy snow", cap: 0.70 },
];

function TisFormSection({
  landUses, onGenerate, busy,
}: {
  landUses: TisLandUse[];
  onGenerate: (req: TisRequest) => void;
  busy: boolean;
}) {
  const [form, setForm] = useState<TisRequest>(PROJECT_TEMPLATES[0]!.request);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const lu = useMemo(() => landUses.find((l) => l.code === form.landUseCode), [landUses, form.landUseCode]);

  function loadSample(s: TisRequest) {
    setForm(s);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onGenerate(form);
  }

  const periods = form.analysisPeriods ?? ALL_PERIODS;
  function togglePeriod(p: TisAnalysisPeriod) {
    const has = periods.includes(p);
    const next = has ? periods.filter((x) => x !== p) : [...periods, p];
    setForm({ ...form, analysisPeriods: next.length > 0 ? next : [p] });
  }

  const templatesByCategory = useMemo(() => {
    const m: Record<string, ProjectTemplate[]> = {};
    for (const t of PROJECT_TEMPLATES) {
      (m[t.category] ??= []).push(t);
    }
    return m;
  }, []);

  return (
    <Card className="print:hidden">
      <CardHeader>
        <CardTitle className="text-base">Project inputs</CardTitle>
        <CardDescription>
          Provide the candidate site and the deployed land use. We'll estimate trip generation
          (ITE 11th Edition) and run a screening-level capacity analysis on every signalized
          intersection within the study radius.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Project name</span>
            <input
              type="text" required
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
              value={form.projectName}
              onChange={(e) => setForm({ ...form, projectName: e.target.value })}
              data-testid="input-project-name"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Address</span>
            <input
              type="text" required
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              data-testid="input-address"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Latitude</span>
            <input
              type="number" step="0.0001" required min={33.4} max={34.2}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm font-mono"
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: Number(e.target.value) })}
              data-testid="input-lat"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Longitude</span>
            <input
              type="number" step="0.0001" required min={-84.9} max={-83.9}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm font-mono"
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: Number(e.target.value) })}
              data-testid="input-lon"
            />
          </label>
          <label className="space-y-1 md:col-span-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">ITE land-use code</span>
            <select
              required
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
              value={form.landUseCode}
              onChange={(e) => setForm({ ...form, landUseCode: e.target.value })}
              data-testid="select-land-use"
            >
              {landUses.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.code} — {l.name} ({l.dailyRate} trips/{l.unitShort}/day)
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Size {lu ? `(${lu.unit})` : ""}
            </span>
            <input
              type="number" step="1" required min={1}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
              value={form.size}
              onChange={(e) => setForm({ ...form, size: Number(e.target.value) })}
              data-testid="input-size"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Opening year</span>
            <input
              type="number" step="1" required min={2024} max={2050}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
              value={form.openingYear}
              onChange={(e) => setForm({ ...form, openingYear: Number(e.target.value) })}
              data-testid="input-year"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Study radius (mi)</span>
            <input
              type="number" step="0.05" required min={0.1} max={6.5}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
              value={form.studyRadiusMi ?? 0.5}
              onChange={(e) => setForm({ ...form, studyRadiusMi: Number(e.target.value) })}
              data-testid="input-radius"
            />
          </label>
          <div className="md:col-span-2 border-t pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              data-testid="button-toggle-advanced"
            >
              {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              <Sliders className="w-3.5 h-3.5" />
              Advanced analysis settings
            </button>
          </div>
          {showAdvanced && (
            <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <div className="space-y-1 md:col-span-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Analysis periods</span>
                <div className="flex flex-wrap gap-2">
                  {ALL_PERIODS.map((p) => {
                    const on = periods.includes(p);
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => togglePeriod(p)}
                        className={`text-xs px-2.5 py-1 rounded border transition-colors ${on ? "bg-foreground text-background border-foreground" : "hover:bg-muted"}`}
                        data-testid={`button-period-${p}`}
                      >
                        {PERIOD_LONG[p]}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Background growth (%/yr)
                </span>
                <input
                  type="number" step="0.1" min={0} max={6}
                  className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                  value={form.growthRatePct ?? 1.5}
                  onChange={(e) => setForm({ ...form, growthRatePct: Number(e.target.value) })}
                  data-testid="input-growth"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <CloudRain className="w-3 h-3" /> Weather scenario
                </span>
                <select
                  className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                  value={form.weather ?? "clear"}
                  onChange={(e) => setForm({ ...form, weather: e.target.value as TisWeather })}
                  data-testid="select-weather"
                >
                  {WEATHER_OPTIONS.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.label} (capacity ×{w.cap.toFixed(2)})
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Pass-by % {lu && (lu.passByPctPm ?? 0) > 0 ? `(default ${lu.passByPctPm}%)` : ""}
                </span>
                <input
                  type="number" step="1" min={0} max={70}
                  className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                  value={form.passByPct ?? lu?.passByPctPm ?? 0}
                  onChange={(e) => setForm({ ...form, passByPct: Number(e.target.value) })}
                  data-testid="input-passby"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Internal capture %
                </span>
                <input
                  type="number" step="1" min={0} max={50}
                  className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                  value={form.internalCapturePct ?? lu?.internalCapturePctPm ?? 0}
                  onChange={(e) => setForm({ ...form, internalCapturePct: Number(e.target.value) })}
                  data-testid="input-internal-cap"
                />
              </label>
              <label className="md:col-span-2 flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  checked={!!form.runSensitivity}
                  onChange={(e) => setForm({ ...form, runSensitivity: e.target.checked })}
                  data-testid="checkbox-sensitivity"
                />
                <span className="text-sm flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  Run Monte-Carlo sensitivity (100 iterations, ±10% trip-rate / ±15% existing-volume)
                </span>
              </label>
            </div>
          )}
          <div className="md:col-span-2 flex flex-wrap items-center gap-2 pt-2 border-t">
            <button
              type="submit" disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-50"
              data-testid="button-generate"
            >
              <Calculator className="w-4 h-4" />
              {busy ? "Generating…" : "Generate TIS"}
            </button>
            <span className="text-xs text-muted-foreground">
              {periods.length} period{periods.length === 1 ? "" : "s"}
              {form.runSensitivity ? " · sensitivity ON" : ""}
              {form.weather && form.weather !== "clear" ? ` · ${form.weather.replace("_", " ")}` : ""}
            </span>
          </div>
          <div className="md:col-span-2 pt-2 border-t">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              Project templates
            </div>
            <div className="space-y-2">
              {Object.entries(templatesByCategory).map(([cat, items]) => (
                <div key={cat}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">{cat}</div>
                  <div className="flex flex-wrap gap-2">
                    {items.map((t) => (
                      <button
                        key={t.request.projectName}
                        type="button"
                        onClick={() => loadSample(t.request)}
                        className="text-xs px-2.5 py-1.5 rounded border hover:bg-muted transition-colors text-left max-w-[260px]"
                        title={t.description}
                        data-testid={`button-template-${t.request.landUseCode}`}
                      >
                        <div className="font-medium">{t.request.projectName}</div>
                        <div className="text-[10px] text-muted-foreground line-clamp-1">{t.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ResultHeader({ report }: { report: TisReport }) {
  return (
    <header className="border-b pb-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Building2 className="w-4 h-4 text-blue-600" />
        <span className="font-medium uppercase tracking-wide text-xs">Traffic Impact Study — Screening Report</span>
      </div>
      <h1 className="text-3xl md:text-4xl font-bold mt-2">{report.request.projectName}</h1>
      <p className="text-muted-foreground mt-1 flex items-center gap-1.5">
        <MapPin className="w-4 h-4" />
        {report.request.address}
      </p>
      <div className="flex flex-wrap items-center gap-2 mt-4 text-xs text-muted-foreground">
        <Badge variant="outline" className="font-mono">
          ITE {report.tripGeneration.landUseCode} · {report.tripGeneration.landUseName}
        </Badge>
        <Badge variant="outline" className="font-mono">
          {report.tripGeneration.size} {report.tripGeneration.unit}
        </Badge>
        <Badge variant="outline" className="font-mono">
          Opening {report.request.openingYear}
        </Badge>
        <Badge variant="outline" className="font-mono">
          Radius {report.studyRadiusMi} mi
        </Badge>
        <Badge variant="outline" className="font-mono">
          Generated {new Date(report.generatedAt).toLocaleString()}
        </Badge>
      </div>
    </header>
  );
}

function TripGenCard({ report }: { report: TisReport }) {
  const tg = report.tripGeneration;
  return (
    <Card className="break-inside-avoid">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Car className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-base">
            Trip generation<CitationRef tags={["ITE_TG_11", "ITE_TG_11_LU"]} />
          </CardTitle>
        </div>
        <CardDescription>ITE Trip Generation Manual 11th Edition average weekday rates.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Daily trips</div>
            <div className="text-2xl font-bold tabular-nums">{tg.dailyTrips.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">AM peak hour</div>
            <div className="text-2xl font-bold tabular-nums">{tg.amPeakTrips.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">PM peak hour</div>
            <div className="text-2xl font-bold tabular-nums">{tg.pmPeakTrips.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {tg.pmIn} in / {tg.pmOut} out
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Land-use rate</div>
            <div className="text-2xl font-bold tabular-nums">
              {(tg.dailyTrips / Math.max(1, tg.size)).toFixed(2)}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">trips per {tg.unit.replace(/^1,000 /, "k").replace("Dwelling Units", "DU")} per day</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ImpactSummaryCard({ report }: { report: TisReport }) {
  const losDropPct = report.intersectionsStudied > 0
    ? Math.round((report.intersectionsWithLosDrop / report.intersectionsStudied) * 100)
    : 0;
  const worstBand = delayBand(report.worstDelayDeltaSec);
  return (
    <Card className="break-inside-avoid">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-base">
            Off-site impact summary<CitationRef tags={["HCM_19", "HCM_19_LOS"]} />
          </CardTitle>
        </div>
        <CardDescription>
          What changes at nearby signalized intersections after build-out. Delay deltas reported
          with ±{Math.round(DELAY_CONFIDENCE_FRAC * 100)}% confidence band at 80% CL.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Intersections studied</div>
            <div className="text-2xl font-bold tabular-nums">{report.intersectionsStudied}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">LOS drops</div>
            <div className="text-2xl font-bold tabular-nums">
              {report.intersectionsWithLosDrop}
              <span className="text-sm font-normal text-muted-foreground ml-1">({losDropPct}%)</span>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">At LOS E or F</div>
            <div className={`text-2xl font-bold tabular-nums ${report.intersectionsAtLosEf > 0 ? "text-red-600" : ""}`}>
              {report.intersectionsAtLosEf}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Worst delay Δ</div>
            <div className={`text-2xl font-bold tabular-nums ${report.worstDelayDeltaSec >= 5 ? "text-amber-600" : ""}`}>
              +{report.worstDelayDeltaSec.toFixed(1)}s
            </div>
            <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
              80% CI: +{worstBand.lo.toFixed(1)} to +{worstBand.hi.toFixed(1)}s
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FindingsCard({ report }: { report: TisReport }) {
  return (
    <Card className="bg-muted/30 border-l-4 border-l-blue-500 break-inside-avoid">
      <CardHeader>
        <CardTitle className="text-base">Plain-English findings</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm leading-relaxed">
          {report.findings.map((f, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-blue-600 font-bold">•</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function MapCard({ report }: { report: TisReport }) {
  const center: [number, number] = [report.request.latitude, report.request.longitude];
  return (
    <Card className="break-inside-avoid">
      <CardHeader>
        <CardTitle className="text-base">Affected intersections — map</CardTitle>
        <CardDescription>
          Site marker (blue pin) plus every signalized intersection within the study radius. Marker color
          encodes the post-build LOS.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-80 rounded overflow-hidden border" style={{ background: "#f5f5f5" }}>
          <MapContainer
            center={center}
            zoom={15}
            scrollWheelZoom={false}
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              attribution='&copy; OpenStreetMap'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={center} icon={siteIcon()}>
              <LeafletTooltip permanent direction="top" offset={[0, -32]}>
                <div className="text-xs font-semibold">{report.request.projectName}</div>
              </LeafletTooltip>
            </Marker>
            {report.affectedIntersections.map((r) => (
              <CircleMarker
                key={r.signalId}
                center={[r.latitude, r.longitude]}
                radius={r.losChanged ? 9 : 6}
                pathOptions={{
                  fillColor: LOS_COLORS[r.futureLos]?.map ?? "#94a3b8",
                  fillOpacity: 0.85,
                  color: "#fff",
                  weight: 1.5,
                }}
              >
                <LeafletTooltip>
                  <div className="text-xs">
                    <div className="font-semibold">{r.name}</div>
                    <div>LOS {r.existingLos} → {r.futureLos} ({r.existingDelaySec.toFixed(1)}s → {r.futureDelaySec.toFixed(1)}s)</div>
                    <div className="text-muted-foreground">+{r.addedTripsPmPeak} PM peak trips · {r.distanceMi.toFixed(2)} mi</div>
                  </div>
                </LeafletTooltip>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function IntersectionTable({ report }: { report: TisReport }) {
  // Sort by impact severity — losChanged first, then by delay delta.
  const sorted = [...report.affectedIntersections].sort((a, b) => {
    if (a.losChanged !== b.losChanged) return a.losChanged ? -1 : 1;
    return (b.futureDelaySec - b.existingDelaySec) - (a.futureDelaySec - a.existingDelaySec);
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <Card className="break-inside-avoid">
      <CardHeader>
        <CardTitle className="text-base">
          Affected intersections — capacity table<CitationRef tags={["HCM_19", "HCM_19_8"]} />
        </CardTitle>
        <CardDescription>
          Per-intersection LOS before vs after build-out (PM peak). Click any row to expand
          NB/SB/EB/WB approach detail with v/c, delay, LOS and 95th-percentile back-of-queue.
          Rows are sorted by impact severity.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                <th className="w-6"></th>
                <th className="text-left py-2 pr-2 font-medium">Intersection</th>
                <th className="text-left py-2 px-2 font-medium">Zone</th>
                <th className="text-right py-2 px-2 font-medium">Dist (mi)</th>
                <th className="text-right py-2 px-2 font-medium">+Trips PM</th>
                <th className="text-center py-2 px-2 font-medium">LOS now</th>
                <th className="text-center py-2 px-2 font-medium">LOS after</th>
                <th className="text-right py-2 px-2 font-medium">Delay Δ</th>
                <th className="text-right py-2 px-2 font-medium">Q95 (ft)</th>
                <th className="text-center py-2 pl-2 font-medium">Mitigation</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-6 text-muted-foreground text-sm">
                    No signalized intersections within the study radius.
                  </td>
                </tr>
              )}
              {sorted.map((r: TisAffectedIntersection) => {
                const sev = SEVERITY_CONFIG[r.mitigationSeverity] ?? SEVERITY_CONFIG.none!;
                const SevIcon = sev.icon;
                const delta = r.futureDelaySec - r.existingDelaySec;
                const isOpen = expanded.has(r.signalId);
                return (
                  <Fragment key={r.signalId}>
                  <tr className="border-b last:border-0 hover:bg-muted/30 align-middle cursor-pointer" onClick={() => toggle(r.signalId)} data-testid={`row-intersection-${r.signalId}`}>
                    <td className="py-2 pr-1 text-muted-foreground">
                      {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </td>
                    <td className="py-2 pr-2">
                      <div className="font-medium truncate max-w-[200px] flex items-center gap-1.5">
                        {r.name}
                        {r.calibration && r.calibration.sampleCount > 0 && (
                          <span
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900"
                            title={`HCM delay calibrated against ${r.calibration.sampleCount} observed sample${r.calibration.sampleCount === 1 ? "" : "s"} (multiplier ×${r.calibration.delayMultiplier.toFixed(2)})`}
                            data-testid={`badge-calibrated-${r.signalId}`}
                          >
                            Calibrated
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">{r.signalId}</div>
                    </td>
                    <td className="py-2 px-2 text-muted-foreground text-xs">{r.zone}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{r.distanceMi.toFixed(2)}</td>
                    <td className="py-2 px-2 text-right tabular-nums">{r.addedTripsPmPeak}</td>
                    <td className="py-2 px-2 text-center"><LosBadge los={r.existingLos} /></td>
                    <td className="py-2 px-2 text-center"><LosBadge los={r.futureLos} /></td>
                    <td className={`py-2 px-2 text-right tabular-nums ${delta >= 15 ? "text-red-600 font-semibold" : delta >= 5 ? "text-amber-600 font-semibold" : ""}`}>
                      {delta >= 0 ? "+" : ""}{delta.toFixed(1)}s
                      {Math.abs(delta) >= 1 && (
                        <div className="text-[9px] text-muted-foreground font-normal">
                          ±{(Math.abs(delta) * DELAY_CONFIDENCE_FRAC).toFixed(1)}s
                        </div>
                      )}
                    </td>
                    <td className={`py-2 px-2 text-right tabular-nums ${r.queue95thFt >= 400 ? "text-red-600 font-semibold" : r.queue95thFt >= 250 ? "text-amber-600" : ""}`}>
                      {r.queue95thFt.toFixed(0)}
                    </td>
                    <td className="py-2 pl-2 text-center">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium ${sev.color}`} title={r.mitigation}>
                        <SevIcon className="w-3.5 h-3.5" />
                        {sev.label}
                      </span>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b last:border-0 bg-muted/20">
                      <td colSpan={10} className="py-3 px-3">
                        <ApproachDetailTable approaches={r.approaches} />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ApproachDetailTable({ approaches }: { approaches: TisApproachImpact[] }) {
  if (!approaches || approaches.length === 0) {
    return <div className="text-xs text-muted-foreground">No approach detail.</div>;
  }
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
        Approach detail (HCM signalized intersection, weather-adjusted)
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="text-left py-1 pr-2 font-medium">Approach</th>
            <th className="text-right py-1 px-2 font-medium">Existing vph</th>
            <th className="text-right py-1 px-2 font-medium">+Trips</th>
            <th className="text-right py-1 px-2 font-medium">Future vph</th>
            <th className="text-right py-1 px-2 font-medium">v/c (now → after)</th>
            <th className="text-right py-1 px-2 font-medium">Delay (now → after)</th>
            <th className="text-center py-1 px-2 font-medium">LOS (now → after)</th>
            <th className="text-right py-1 pl-2 font-medium">Q95 (ft)</th>
          </tr>
        </thead>
        <tbody>
          {approaches.map((a) => (
            <tr key={a.direction} className="border-b last:border-0">
              <td className="py-1 pr-2 font-mono font-semibold">{a.direction}</td>
              <td className="py-1 px-2 text-right tabular-nums">{a.existingVolumeVph.toFixed(0)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{a.addedTripsPeak}</td>
              <td className="py-1 px-2 text-right tabular-nums">{a.futureVolumeVph.toFixed(0)}</td>
              <td className="py-1 px-2 text-right tabular-nums">{a.existingVc.toFixed(2)} → <span className={a.futureVc >= 0.95 ? "text-red-600 font-semibold" : a.futureVc >= 0.85 ? "text-amber-600" : ""}>{a.futureVc.toFixed(2)}</span></td>
              <td className="py-1 px-2 text-right tabular-nums">{a.existingDelaySec.toFixed(1)}s → {a.futureDelaySec.toFixed(1)}s</td>
              <td className="py-1 px-2 text-center"><LosBadge los={a.existingLos} /> → <LosBadge los={a.futureLos} /></td>
              <td className={`py-1 pl-2 text-right tabular-nums ${a.queue95thFt >= 400 ? "text-red-600 font-semibold" : a.queue95thFt >= 250 ? "text-amber-600" : ""}`}>
                {a.queue95thFt.toFixed(0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PeriodTabsCard({ report }: { report: TisReport }) {
  const periods = report.periodReports;
  const periodKeys = periods.map((p) => p.period).join("|");
  const [active, setActive] = useState<TisAnalysisPeriod>(
    () => periods.find((p) => p.period === "pm_peak")?.period ?? periods[0]?.period ?? "pm_peak",
  );
  // If the user regenerates with a different period set, reset `active` to a
  // period that exists in the new report — otherwise every panel renders
  // hidden and the card looks blank.
  useEffect(() => {
    if (!periods.find((p) => p.period === active)) {
      setActive(periods.find((p) => p.period === "pm_peak")?.period ?? periods[0]?.period ?? "pm_peak");
    }
  }, [periodKeys, active, periods]);
  const cur = periods.find((p) => p.period === active) ?? periods[0];
  if (!cur) return null;
  return (
    <Card className="break-inside-avoid">
      <CardHeader>
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-blue-600" />
          <CardTitle className="text-base">Multi-period analysis</CardTitle>
        </div>
        <CardDescription>
          Trip generation and intersection impact by analysis period. Saturday-midday rates use
          published industry multipliers of the PM peak by land-use category.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 print:hidden">
          {periods.map((p) => (
            <button
              key={p.period}
              type="button"
              onClick={() => setActive(p.period)}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${active === p.period ? "bg-foreground text-background border-foreground" : "hover:bg-muted"}`}
              data-testid={`button-tab-period-${p.period}`}
            >
              {PERIOD_LONG[p.period]}
            </button>
          ))}
        </div>
        {periods.map((p) => (
          <div
            key={p.period}
            className={p.period === active ? "block" : "hidden print:block"}
          >
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-2 hidden print:block">
              {PERIOD_LONG[p.period]}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <PeriodStat label="Raw trips" value={p.tripGeneration.rawTrips.toLocaleString()} />
              <PeriodStat
                label="Pass-by credit"
                value={p.tripGeneration.passByCredit > 0 ? `−${p.tripGeneration.passByCredit}` : "—"}
              />
              <PeriodStat
                label="Internal capture"
                value={p.tripGeneration.internalCaptureCredit > 0 ? `−${p.tripGeneration.internalCaptureCredit}` : "—"}
              />
              <PeriodStat
                label="External trips"
                value={`${p.tripGeneration.externalTrips} (${p.tripGeneration.inTrips}↓ / ${p.tripGeneration.outTrips}↑)`}
                highlight
              />
            </div>
            {p.period !== "daily" && (
              <div className="grid grid-cols-3 gap-3 text-sm mt-3">
                <PeriodStat
                  label="Intersections w/ LOS drop"
                  value={`${p.intersectionsWithLosDrop} / ${p.affectedIntersections.length}`}
                />
                <PeriodStat
                  label="Intersections at LOS E/F"
                  value={String(p.intersectionsAtLosEf)}
                />
                <PeriodStat
                  label="Worst delay Δ"
                  value={`+${p.worstDelayDeltaSec.toFixed(1)}s`}
                  highlight={p.worstDelayDeltaSec >= 5}
                />
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PeriodStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</div>
      <div className={`tabular-nums font-mono ${highlight ? "text-base font-bold text-blue-700 dark:text-blue-400" : ""}`}>{value}</div>
    </div>
  );
}

function SensitivityCard({ report }: { report: TisReport }) {
  const s = report.sensitivity;
  if (!s) return null;
  const dropPct = Math.round(s.probAnyLosDrop * 100);
  const efPct = Math.round(s.probAnyLosEf * 100);
  return (
    <Card className="break-inside-avoid">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-600" />
          <CardTitle className="text-base">Monte-Carlo sensitivity ({s.iterations} iterations)</CardTitle>
        </div>
        <CardDescription>
          Trip rate perturbed by N(1, 0.10) and existing volumes by N(1, 0.15). Reports the
          distribution of worst-case PM peak delay change and probability of LOS impact.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <PeriodStat label="Worst Δ — mean" value={`+${s.worstDelayDeltaMean.toFixed(1)}s`} />
          <PeriodStat
            label="Worst Δ — 80% range"
            value={`+${s.worstDelayDeltaP10.toFixed(1)} to +${s.worstDelayDeltaP90.toFixed(1)}s`}
            highlight
          />
          <PeriodStat label="P(any LOS drop)" value={`${dropPct}%`} highlight={dropPct >= 50} />
          <PeriodStat label="P(any LOS E/F)" value={`${efPct}%`} highlight={efPct >= 25} />
        </div>
        <div className="mt-4 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Distribution of worst-case delay change (P10 / P50 / P90)
          </div>
          <SensitivityBar p10={s.worstDelayDeltaP10} p50={s.worstDelayDeltaP50} p90={s.worstDelayDeltaP90} />
        </div>
        <div className="mt-3 text-xs text-muted-foreground">
          Expected number of intersections with a LOS drop per iteration:{" "}
          <span className="font-semibold text-foreground tabular-nums">{s.expectedLosDrops.toFixed(1)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function SensitivityBar({ p10, p50, p90 }: { p10: number; p50: number; p90: number }) {
  const max = Math.max(1, p90, p50, p10);
  const w = (v: number) => `${Math.max(2, (v / max) * 100)}%`;
  return (
    <div className="space-y-1">
      {[
        { label: "P10", v: p10, color: "bg-emerald-400" },
        { label: "P50", v: p50, color: "bg-blue-500" },
        { label: "P90", v: p90, color: "bg-amber-500" },
      ].map((row) => (
        <div key={row.label} className="flex items-center gap-2 text-xs">
          <span className="w-8 font-mono font-semibold text-muted-foreground">{row.label}</span>
          <div className="flex-1 bg-muted rounded h-3 overflow-hidden">
            <div className={`${row.color} h-full`} style={{ width: w(row.v) }} />
          </div>
          <span className="w-16 text-right tabular-nums">+{row.v.toFixed(1)}s</span>
        </div>
      ))}
    </div>
  );
}

function ScenarioStripCard({ report }: { report: TisReport }) {
  return (
    <Card className="print:hidden">
      <CardContent className="p-3">
        <div className="flex flex-wrap gap-3 items-center text-xs">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded border bg-muted/50">
            <TrendingUp className="w-3 h-3 text-blue-600" />
            Growth: {report.growthAppliedPct.toFixed(2)}%/yr × {report.growthYears}yr
            {report.growthYears > 0 && (
              <span className="text-muted-foreground">
                (×{Math.pow(1 + report.growthAppliedPct / 100, report.growthYears).toFixed(2)})
              </span>
            )}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded border bg-muted/50">
            <CloudRain className="w-3 h-3 text-blue-600" />
            Weather: {report.weather.replace("_", " ")} (cap ×{report.weatherCapacityFactor.toFixed(2)})
          </span>
          {report.passByPctApplied > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded border bg-muted/50">
              Pass-by: {report.passByPctApplied.toFixed(0)}%
            </span>
          )}
          {report.internalCapturePctApplied > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded border bg-muted/50">
              Internal cap.: {report.internalCapturePctApplied.toFixed(0)}%
            </span>
          )}
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded border bg-muted/50">
            Periods: {report.periodReports.map((p) => PERIOD_SHORT[p.period]).join(" · ")}
          </span>
          {report.sensitivity && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded border bg-amber-50 dark:bg-amber-950/30 border-amber-300">
              <Sparkles className="w-3 h-3 text-amber-600" />
              Monte-Carlo: {report.sensitivity.iterations} iter
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MitigationsCard({ report }: { report: TisReport }) {
  const detailed = report.affectedIntersections.filter((r) => r.mitigationSeverity !== "none");
  return (
    <Card className="break-inside-avoid">
      <CardHeader>
        <CardTitle className="text-base">Recommended mitigations</CardTitle>
        <CardDescription>
          Screening-level engineering remedies sized to the projected LOS impact at each intersection.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {report.mitigationSummary.map((m, i) => (
            <div key={i} className="flex gap-2 text-sm">
              <span className="text-blue-600 font-bold">•</span>
              <span>{m}</span>
            </div>
          ))}
        </div>
        {detailed.length > 0 && (
          <div className="border-t pt-4 space-y-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
              Per-intersection detail ({detailed.length})
            </div>
            {detailed.map((r) => {
              const sev = SEVERITY_CONFIG[r.mitigationSeverity] ?? SEVERITY_CONFIG.none!;
              const SevIcon = sev.icon;
              return (
                <div key={r.signalId} className="flex gap-3 text-sm py-2 border-b last:border-0 break-inside-avoid">
                  <SevIcon className={`w-4 h-4 mt-0.5 shrink-0 ${sev.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{r.name}</div>
                    <div className="text-xs text-muted-foreground mb-1">
                      LOS {r.existingLos} → {r.futureLos} · +{(r.futureDelaySec - r.existingDelaySec).toFixed(1)}s delay · {r.addedTripsPmPeak} added PM peak trips
                    </div>
                    <div className="text-xs text-muted-foreground">{r.mitigation}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MethodologyCard({ report }: { report: TisReport }) {
  return (
    <Card className="break-inside-avoid">
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-base">Methodology &amp; assumptions</CardTitle>
        </div>
        <CardDescription>How every number on this page was computed.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3 text-sm leading-relaxed text-muted-foreground list-decimal list-inside">
          {report.methodology.map((p, i) => (
            <li key={i} className="pl-1">{p}</li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function ProjectMetadataSection({
  meta, setMeta, firm,
}: {
  meta: ProjectMetadata;
  setMeta: (m: ProjectMetadata) => void;
  firm: FirmBranding;
}) {
  const configured = isFirmConfigured(firm);
  return (
    <Card className="print:hidden border-l-4 border-l-blue-500">
      <CardHeader>
        <CardTitle className="text-base">Report metadata</CardTitle>
        <CardDescription>
          Renders on the branded cover page.
          {!configured && (
            <span className="block mt-1 text-amber-700 dark:text-amber-400 font-medium">
              Configure firm branding (top-right) to add your logo &amp; PE info to the cover.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <MetaField label="Project number">
            <input
              type="text" placeholder="23-0481"
              className="w-full px-3 py-2 rounded-md border bg-background text-sm font-mono"
              value={meta.projectNumber}
              onChange={(e) => setMeta({ ...meta, projectNumber: e.target.value })}
              data-testid="input-project-number"
            />
          </MetaField>
          <MetaField label="Client">
            <input
              type="text" placeholder="Developer / property owner"
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
              value={meta.client}
              onChange={(e) => setMeta({ ...meta, client: e.target.value })}
              data-testid="input-client"
            />
          </MetaField>
          <MetaField label="Prepared for">
            <input
              type="text" placeholder="City of Atlanta DOT, GDOT, etc."
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
              value={meta.preparedFor}
              onChange={(e) => setMeta({ ...meta, preparedFor: e.target.value })}
              data-testid="input-prepared-for"
            />
          </MetaField>
          <MetaField label="PE reviewer">
            <input
              type="text" placeholder={firm.preparedBy || "Jane Smith, P.E."}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
              value={meta.reviewerName}
              onChange={(e) => setMeta({ ...meta, reviewerName: e.target.value })}
            />
          </MetaField>
          <MetaField label="Study date">
            <input
              type="date"
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
              value={meta.studyDate}
              onChange={(e) => setMeta({ ...meta, studyDate: e.target.value })}
            />
          </MetaField>
          <MetaField label="Revision">
            <select
              className="w-full px-3 py-2 rounded-md border bg-background text-sm"
              value={meta.revisionNumber}
              onChange={(e) => setMeta({ ...meta, revisionNumber: e.target.value })}
            >
              <option>Draft</option>
              <option>Rev 1</option>
              <option>Rev 2</option>
              <option>Rev 3</option>
              <option>Final</option>
            </select>
          </MetaField>
        </div>
      </CardContent>
    </Card>
  );
}

function MetaField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export default function TisPage() {
  const { data: landUses, isLoading: luLoading } = useListTisLandUses();
  const generate = useGenerateTis();
  const [report, setReport] = useState<TisReport | null>(null);
  const [firm, setFirm] = useState<FirmBranding>(() =>
    typeof window === "undefined" ? loadFirmBranding() : loadFirmBranding(),
  );
  const [firmModalOpen, setFirmModalOpen] = useState(false);
  const [meta, setMeta] = useState<ProjectMetadata>(() => emptyProjectMetadata(firm));
  // Tracks which project key `meta` was last hydrated from. The save effect
  // refuses to write until this matches the current project — without this
  // gate, the save effect would fire on the same render as the hydrate
  // effect (when `report` changes) and clobber the new project's stored
  // metadata with the previous project's values.
  const hydratedKey = useRef<string | null>(null);

  // When a report is generated, hydrate per-project metadata from localStorage
  // so the engineer can come back to the same project and reprint with the
  // same numbers without retyping.
  useEffect(() => {
    if (!report) {
      hydratedKey.current = null;
      return;
    }
    const key = projectKey(report.request.projectName, report.request.latitude, report.request.longitude);
    setMeta(loadProjectMetadata(key, firm));
    hydratedKey.current = key;
  }, [report?.request.projectName, report?.request.latitude, report?.request.longitude]);

  // Persist any edits to project metadata against the active project key —
  // but only once we've hydrated for that key (see `hydratedKey` above).
  useEffect(() => {
    if (!report) return;
    const key = projectKey(report.request.projectName, report.request.latitude, report.request.longitude);
    if (hydratedKey.current !== key) return;
    saveProjectMetadata(key, meta);
  }, [meta, report?.request.projectName, report?.request.latitude, report?.request.longitude]);

  function handleGenerate(req: TisRequest) {
    generate.mutate(
      { data: req },
      {
        onSuccess: (data) => setReport(data),
      },
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6 print:py-0 print:max-w-none print:px-0">
      <div className="print:hidden">
        <QuotaBanner />
      </div>
      <div className="flex items-center justify-between print:hidden">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          data-testid="link-home"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to dashboard
        </Link>
        <div className="flex items-center gap-3 flex-wrap justify-end">
          <AuthBar />
          <Link
            href="/projects"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border hover:bg-muted transition-colors"
            data-testid="link-projects"
          >
            <FileText className="w-4 h-4" />
            My Projects
          </Link>
          <button
            onClick={() => setFirmModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border hover:bg-muted transition-colors"
            data-testid="button-firm-settings"
          >
            <Settings className="w-4 h-4" />
            {isFirmConfigured(firm) ? firm.firmName : "Firm branding"}
          </button>
          {report && (
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md bg-foreground text-background hover:opacity-90 transition-opacity"
              data-testid="button-print"
            >
              <Printer className="w-4 h-4" />
              Print TIS / Save as PDF
            </button>
          )}
        </div>
      </div>

      {!report && (
        <div className="space-y-1 print:hidden">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="w-4 h-4 text-blue-600" />
            <span className="font-medium uppercase tracking-wide text-xs">TIS-in-a-box</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold">Traffic Impact Study generator</h1>
          <p className="text-muted-foreground max-w-3xl">
            Enter a candidate site and we'll produce a screening-level Traffic Impact Study —
            ITE trip generation, affected-intersection capacity analysis, LOS before/after, and
            mitigation recommendations — in under five seconds. Print to PDF for a branded,
            PE-stampable deliverable with full methodology &amp; references appendix.
          </p>
          <div className="flex items-center gap-3 pt-3 text-sm">
            <Link href="/for-firms" className="text-blue-600 hover:underline" data-testid="link-for-firms">
              For engineering firms →
            </Link>
          </div>
        </div>
      )}

      <TisFormSection
        landUses={landUses ?? []}
        onGenerate={handleGenerate}
        busy={luLoading || generate.isPending}
      />

      {generate.error && (
        <Card className="border-red-300 bg-red-50 dark:bg-red-950/20 print:hidden">
          <CardContent className="p-4 text-sm text-red-700 dark:text-red-300 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Could not generate TIS</div>
              <div className="text-xs">{generate.error instanceof Error ? generate.error.message : "Unknown error"}</div>
            </div>
          </CardContent>
        </Card>
      )}

      {report && (
        <>
          <ProjectMetadataSection meta={meta} setMeta={setMeta} firm={firm} />
          <TisCoverPage report={report} firm={firm} meta={meta} />
          <ResultHeader report={report} />
          <ScenarioStripCard report={report} />
          <TripGenCard report={report} />
          <ImpactSummaryCard report={report} />
          <PeriodTabsCard report={report} />
          {report.sensitivity && <SensitivityCard report={report} />}
          <FindingsCard report={report} />
          <MapCard report={report} />
          <IntersectionTable report={report} />
          <MitigationsCard report={report} />
          <MethodologyCard report={report} />
          <TisMethodologyAppendix report={report} />
          <TisLimitations />
          <footer className="text-xs text-muted-foreground text-center pt-4 border-t">
            {isFirmConfigured(firm) ? (
              <>
                Prepared by <span className="font-semibold">{firm.firmName}</span>
                {firm.preparedBy && <> · {firm.preparedBy}</>}
                {firm.peNumber && <> · {firm.peNumber}</>}
              </>
            ) : (
              <>
                Screening-level TIS generated by Atlanta Traffic Inefficiency Analyzer.
                A formal submittal requires Synchro/SimTraffic validation with measured turning-movement counts.
              </>
            )}
          </footer>
        </>
      )}

      <FirmSettingsModal
        open={firmModalOpen}
        onClose={() => setFirmModalOpen(false)}
        onSaved={(b) => setFirm(b)}
      />

      <style>{`
        @media print {
          @page { size: Letter portrait; margin: 0.5in; }
          body { background: white !important; }
          .print\\:hidden { display: none !important; }
          .break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
          .leaflet-container { max-height: 4in !important; }
          .print\\:break-after-page { page-break-after: always; break-after: page; }
          .print\\:break-before-page { page-break-before: always; break-before: page; }
        }
      `}</style>
    </div>
  );
}
