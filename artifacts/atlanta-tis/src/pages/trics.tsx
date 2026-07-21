/**
 * /london-ta (legacy alias /trics) — PUBLIC-BY-URL, London-only TA
 * generator (pitch/demo surface).
 *
 * NOT access-controlled. The route is simply not linked anywhere in the
 * site nav, so it is reachable only by someone who knows the URL
 * ("unlisted public") — anyone with the link can run it. The backing
 * endpoints (/tis-api/london-ta/generate, /tis-api/london-ta/pdf; legacy
 * /tis-api/trics/* aliases kept for old links) save nothing,
 * charge no quota, hard-restrict coordinates to Greater London, and are
 * capped at 3 requests/day per IP (tricsRateLimiter, admins/dev-auth
 * exempt) so the deliverable can't be farmed. Anonymous PDF renders carry
 * a neutral "Demo Preview" stamp.
 *
 * NAMING: "TRICS" is TRICS Consortium Ltd's trademarked trip database.
 * We do not redistribute TRICS data and this product is not TRICS —
 * keep the mark out of product identity (titles, headings, filenames,
 * route names). Nominative references ("a submitted TA would use
 * licensed TRICS rates") are fine and intentional.
 *
 * NOTE: the client capacity math in @/lib/trcs ships in the public bundle
 * (the app has no code-splitting). It is published UK methodology
 * (Webster / Kimber-ARCADY / PICADY), NOT the proprietary engine — but the
 * clean long-term fix is to render server-computed results here and delete
 * @/lib/trcs so no capacity logic reaches the browser at all.
 *
 * Temporary pitch surface — delete this file, the /london-ta + /trics
 * routes in App.tsx, and the /london-ta/* + /trics/* endpoints in
 * tis-api-server/src/routes/tis.ts when no longer needed.
 */
import { useEffect, useState } from "react";
import { Beaker, Loader2, Download, AlertCircle, MapPin, Play, ChevronDown, ChevronRight, Sliders, TrendingUp, CloudRain, Search } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { signalCapacity, fmt, prcStr } from "@/lib/trcs";
import { DrivewayEditor } from "@/components/driveway-editor";
import type { Driveway, TisDistributionMethod } from "@workspace/tis-api-client-react";

type LondonSite = { id: string; label: string; lat: number; lon: number };
const LONDON_SITES: LondonSite[] = [
  { id: "holloway", label: "Holloway Road, Islington", lat: 51.5530, lon: -0.1140 },
  { id: "stratford", label: "Stratford, Newham", lat: 51.5416, lon: -0.0042 },
  { id: "croydon", label: "Croydon town centre", lat: 51.3762, lon: -0.0982 },
  { id: "wembley", label: "Wembley, Brent", lat: 51.5560, lon: -0.2795 },
  { id: "canarywharf", label: "Canary Wharf, Tower Hamlets", lat: 51.5054, lon: -0.0235 },
  { id: "hammersmith", label: "Hammersmith & Fulham", lat: 51.4927, lon: -0.2240 },
];

// The capacity engine reads coordinates at 4-decimal precision (~11 m); extra
// geocoder/paste digits are noise. Round every coordinate the form emits.
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
// london_metro region bounds (regions.ts) — Greater London + its metro / commuter
// belt. A geocoded address must land inside this box; the /london-ta endpoints reject
// anything outside london_metro, so we validate here for an immediate, friendly error.
const LONDON_METRO_BOUNDS = { latMin: 51.28, latMax: 51.69, lonMin: -0.51, lonMax: 0.33 };

type LandUse = { code: string; name: string; unit?: string };

const ALL_PERIODS: { id: string; label: string }[] = [
  { id: "am_peak", label: "AM peak" },
  { id: "pm_peak", label: "PM peak" },
  { id: "saturday_midday", label: "Sat midday" },
  { id: "daily", label: "Daily" },
];
const WEATHER_OPTIONS: { value: string; label: string; cap: number }[] = [
  { value: "clear", label: "Clear", cap: 1.0 },
  { value: "light_rain", label: "Light rain", cap: 0.95 },
  { value: "heavy_rain", label: "Heavy rain", cap: 0.86 },
  { value: "light_snow", label: "Light snow", cap: 0.86 },
  { value: "heavy_snow", label: "Heavy snow", cap: 0.70 },
];
// UK-flavoured labels for the three selectable distribution methods. Gravity is
// the default (byte-identical to today); "surrogate" is the genuine UK-data
// method — the 2011 Census WU03EW journey-to-work catchment for the site MSOA.
const UK_DISTRIBUTION_METHOD_OPTIONS: { value: TisDistributionMethod; label: string }[] = [
  { value: "gravity", label: "Gravity model (WebTAG M2 / DMRB)" },
  { value: "surrogate", label: "Census journey-to-work catchment (2011 WU03EW)" },
  { value: "analogy", label: "Analogous-site distribution" },
];

type TisReport = {
  studyRadiusMi?: number;
  intersectionsStudied?: number;
  tripGeneration?: { landUseName?: string; amPeakTrips?: number; pmPeakTrips?: number };
  affectedIntersections?: Array<{
    name?: string; signalId?: string;
    existingVc?: number; futureVc?: number; currentVc?: number;
  }>;
};

export default function TricsPage() {
  // Public-by-URL: not linked anywhere in the site nav, so it is reachable
  // only by typing /london-ta (or the legacy /trics alias) directly — but it
  // is NOT access-controlled. The backing /london-ta/* endpoints are public
  // + rate-limited (see tis.ts).
  return <Generator />;
}

function Generator() {
  const [landUses, setLandUses] = useState<LandUse[]>([]);
  const [siteId, setSiteId] = useState<string>(LONDON_SITES[0]!.id);
  // Site coordinates come from EITHER a quick-pick preset OR a geocoded address.
  const [lat, setLat] = useState<number>(LONDON_SITES[0]!.lat);
  const [lon, setLon] = useState<number>(LONDON_SITES[0]!.lon);
  const [siteLabel, setSiteLabel] = useState<string>(LONDON_SITES[0]!.label);
  const [address, setAddress] = useState<string>("");
  const [geocoding, setGeocoding] = useState<boolean>(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);
  const [landUseCode, setLandUseCode] = useState<string>("710");
  const [size, setSize] = useState<number>(180);
  const [openingYear, setOpeningYear] = useState<number>(2028);
  // Advanced analysis settings — mirrors the main /tis form's options.
  const [studyRadiusKm, setStudyRadiusKm] = useState<number>(0.8);
  const [growthRatePct, setGrowthRatePct] = useState<number>(1.5);
  const [periods, setPeriods] = useState<string[]>(["am_peak", "pm_peak"]);
  const [weather, setWeather] = useState<string>("clear");
  const [passByPct, setPassByPct] = useState<number>(0);
  const [internalCapturePct, setInternalCapturePct] = useState<number>(0);
  const [runSensitivity, setRunSensitivity] = useState<boolean>(false);
  const [distributionMethod, setDistributionMethod] = useState<TisDistributionMethod>("gravity");
  const [driveways, setDriveways] = useState<Driveway[]>([]);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  const [report, setReport] = useState<TisReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    fetch("/tis-api/land-uses")
      .then((r) => r.json())
      .then((d: LandUse[]) => {
        if (Array.isArray(d) && d.length) {
          setLandUses(d);
          if (!d.some((l) => l.code === "710")) setLandUseCode(d[0]!.code);
        }
      })
      .catch(() => { /* hardcoded default code still works */ });
  }, []);

  const landUseName = landUses.find((l) => l.code === landUseCode)?.name ?? landUseCode;
  const landUseUnit = landUses.find((l) => l.code === landUseCode)?.unit ?? "units";
  const togglePeriod = (p: string) =>
    setPeriods((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  // Quick-pick a preset London site → set the coordinates + label.
  function selectPreset(id: string) {
    const s = LONDON_SITES.find((x) => x.id === id);
    if (!s) return;
    setSiteId(id);
    setLat(s.lat);
    setLon(s.lon);
    setSiteLabel(s.label);
    setAddress("");
    setGeocodeError(null);
  }

  // Type any street/address → geocode to 4-decimal coordinates. Reuses the public
  // Nominatim-backed /demo/geocode endpoint, biased to London, and validated
  // against the london_metro box so anything outside London + metro is caught
  // here rather than as a 422 at generate time.
  async function resolveAddress() {
    const q = address.trim();
    if (q.length < 3) {
      setGeocodeError("Type at least a few characters of an address.");
      return;
    }
    setGeocoding(true);
    setGeocodeError(null);
    try {
      const biased = /london|england|united kingdom|\buk\b/i.test(q) ? q : `${q}, London, UK`;
      const r = await fetch("/tis-api/demo/geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: biased }),
      });
      const data = await r.json();
      if (!r.ok) {
        setGeocodeError(String(data?.error ?? "Couldn't look that up."));
        return;
      }
      const glat = round4(Number(data.latitude));
      const glon = round4(Number(data.longitude));
      const b = LONDON_METRO_BOUNDS;
      const inBox = Number.isFinite(glat) && Number.isFinite(glon)
        && glat >= b.latMin && glat <= b.latMax && glon >= b.lonMin && glon <= b.lonMax;
      if (!inBox) {
        setGeocodeError("That address is outside Greater London and its metro area — this tool is London-only.");
        return;
      }
      setLat(glat);
      setLon(glon);
      setSiteLabel(String(data.displayName ?? q).split(",").slice(0, 2).join(",").trim() || q);
      setSiteId(""); // custom coordinates — clear the preset selection
    } catch {
      setGeocodeError("Couldn't reach the address lookup. Try again or pick a site above.");
    } finally {
      setGeocoding(false);
    }
  }

  function payload() {
    return {
      projectName: `${landUseName} — ${siteLabel} (London TA demo)`,
      address: siteLabel,
      latitude: lat,
      longitude: lon,
      landUseCode,
      size,
      openingYear,
      studyRadiusMi: Math.round((studyRadiusKm / 1.609344) * 100) / 100,
      growthRatePct,
      analysisPeriods: periods.length ? periods : ["pm_peak"],
      weather,
      passByPct,
      internalCapturePct,
      runSensitivity,
      distributionMethod,
      ...(driveways.length > 0 ? { driveways } : {}),
    };
  }

  async function generate() {
    setError(null);
    setLoading(true);
    setReport(null);
    try {
      const res = await fetch("/tis-api/london-ta/generate", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      if (!res.ok) {
        const m = await res.json().catch(() => ({}));
        throw new Error((m as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setReport(await res.json());
      setCount((c) => c + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function downloadPdf() {
    setError(null);
    setPdfLoading(true);
    try {
      const res = await fetch("/tis-api/london-ta/pdf", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      if (!res.ok) {
        const m = await res.json().catch(() => ({}));
        throw new Error((m as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "london-ta.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate the PDF.");
    } finally {
      setPdfLoading(false);
    }
  }

  const intersections = report?.affectedIntersections ?? [];
  const radiusKm = report?.studyRadiusMi != null ? (report.studyRadiusMi * 1.609344).toFixed(2) : null;

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="gap-1.5 border-amber-300 bg-amber-50 text-amber-800">
          <Beaker className="w-3.5 h-3.5" /> London-only · public preview
        </Badge>
        {count > 0 && (
          <Badge variant="outline" className="text-muted-foreground">{count} generated this session</Badge>
        )}
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">London TA generator</h1>
        <p className="text-muted-foreground max-w-3xl">
          Generate a UK Transport Assessment (London TA format) for any Greater London site — DMRB / TRL
          capacity (DoS, PRC, MMQ) on-screen, full TA as a PDF. Public preview, limited to 3 free demo runs per day.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[340px_1fr]">
        {/* Inputs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Site & scheme</CardTitle>
            <CardDescription>London locations only.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Search any London / metro address</label>
              <div className="flex gap-2">
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); resolveAddress(); } }}
                  placeholder="e.g. 60 Gracechurch Street, EC3"
                  data-testid="input-trics-address"
                />
                <Button type="button" variant="outline" onClick={resolveAddress} disabled={geocoding} className="shrink-0 gap-1.5">
                  {geocoding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Find
                </Button>
              </div>
              {geocodeError && (
                <p className="text-[11px] text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {geocodeError}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Or quick-pick a London site</label>
              <Select value={siteId} onValueChange={selectPreset}>
                <SelectTrigger><SelectValue placeholder="Custom location" /></SelectTrigger>
                <SelectContent>
                  {LONDON_SITES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground flex items-start gap-1">
                <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
                <span><span className="tabular-nums">{lat.toFixed(4)}, {lon.toFixed(4)}</span> · <span className="text-foreground/70">{siteLabel}</span></span>
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Land use</label>
              <Select value={landUseCode} onValueChange={setLandUseCode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {(landUses.length ? landUses : [{ code: "710", name: "General Office" }]).map((l) => (
                    <SelectItem key={l.code} value={l.code}>{l.code} — {l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Size ({landUseUnit})</label>
                <Input type="number" min="1" step="10" value={size}
                  onChange={(e) => setSize(Number(e.target.value) || 0)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Opening year</label>
                <Input type="number" min="2024" max="2060" step="1" value={openingYear}
                  onChange={(e) => setOpeningYear(Number(e.target.value) || 2028)} />
              </div>
            </div>

            <button type="button" onClick={() => setShowAdvanced((v) => !v)}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
              {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              <Sliders className="w-3.5 h-3.5" /> Advanced analysis settings
            </button>

            {showAdvanced && (
              <div className="space-y-4 rounded-lg border bg-muted/30 p-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Analysis periods</label>
                  <div className="flex flex-wrap gap-2">
                    {ALL_PERIODS.map((p) => {
                      const on = periods.includes(p.id);
                      return (
                        <button key={p.id} type="button" onClick={() => togglePeriod(p.id)}
                          className={`text-xs px-2.5 py-1 rounded border transition-colors ${on ? "bg-foreground text-background border-foreground" : "hover:bg-accent"}`}>
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><TrendingUp className="w-3 h-3" /> Growth (%/yr)</label>
                    <Input type="number" min="0" max="6" step="0.1" value={growthRatePct}
                      onChange={(e) => setGrowthRatePct(Number(e.target.value) || 0)} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Study radius (km)</label>
                    <Input type="number" min="0.2" max="10" step="0.1" value={studyRadiusKm}
                      onChange={(e) => setStudyRadiusKm(Number(e.target.value) || 0.8)} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Pass-by %</label>
                    <Input type="number" min="0" max="70" step="1" value={passByPct}
                      onChange={(e) => setPassByPct(Number(e.target.value) || 0)} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Internal capture %</label>
                    <Input type="number" min="0" max="50" step="1" value={internalCapturePct}
                      onChange={(e) => setInternalCapturePct(Number(e.target.value) || 0)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1"><CloudRain className="w-3 h-3" /> Weather scenario</label>
                  <Select value={weather} onValueChange={setWeather}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WEATHER_OPTIONS.map((w) => (
                        <SelectItem key={w.value} value={w.value}>{w.label} (capacity ×{w.cap.toFixed(2)})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Trip-distribution method</label>
                  <Select value={distributionMethod} onValueChange={(v) => setDistributionMethod(v as TisDistributionMethod)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {UK_DISTRIBUTION_METHOD_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Drives the assignment onto the study junctions. Surrogate uses the site MSOA's 2011 Census journey-to-work flows (Greater London).
                  </p>
                </div>
                <div className="space-y-1.5 border-t pt-3">
                  <label className="text-xs font-medium text-muted-foreground">Vehicular accesses (optional)</label>
                  <DrivewayEditor
                    site={{ latitude: lat, longitude: lon }}
                    driveways={driveways}
                    onChange={setDriveways}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={runSensitivity} onChange={(e) => setRunSensitivity(e.target.checked)} />
                  Run Monte-Carlo sensitivity (100 iterations)
                </label>
              </div>
            )}

            <Button onClick={generate} disabled={loading} className="w-full gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {loading ? "Generating…" : "Generate London TA"}
            </Button>
            {error && (
              <p className="text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> {error}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Result */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Result</CardTitle>
            <CardDescription>
              {report ? `${report.tripGeneration?.landUseName ?? landUseName} · ${siteLabel}` : "Generate to see DoS / PRC / MMQ and download the TA PDF."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!report ? (
              <div className="text-sm text-muted-foreground py-12 text-center border rounded-lg border-dashed">
                No report yet — pick a London site and scheme, then Generate.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Metric label="Junctions" value={String(report.intersectionsStudied ?? intersections.length)} />
                  <Metric label="AM peak trips" value={fmt(report.tripGeneration?.amPeakTrips ?? 0, 0)} />
                  <Metric label="PM peak trips" value={fmt(report.tripGeneration?.pmPeakTrips ?? 0, 0)} />
                  <Metric label="Study radius" value={radiusKm ? `${radiusKm} km` : "—"} />
                </div>

                {intersections.length > 0 ? (
                  <div>
                    <div className="text-sm font-medium mb-2">§5.4 Junction impact (DMRB / TRL)</div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Junction</TableHead>
                          <TableHead className="text-right">DoS No-Build</TableHead>
                          <TableHead className="text-right">DoS With-Dev</TableHead>
                          <TableHead className="text-right">PRC</TableHead>
                          <TableHead className="text-right">MMQ (PCU)</TableHead>
                          <TableHead className="text-center">Within cap?</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {intersections.slice(0, 20).map((it, i) => {
                          const nb = signalCapacity(Number(it.existingVc ?? 0));
                          const wd = signalCapacity(Number(it.futureVc ?? 0));
                          const worsened = wd.dosPct > nb.dosPct + 0.05;
                          return (
                            <TableRow key={it.signalId ?? i}>
                              <TableCell className="font-medium">{it.name ?? it.signalId ?? "—"}</TableCell>
                              <TableCell className="text-right tabular-nums">{fmt(nb.dosPct)}%</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {worsened && <span className="text-amber-600">▲ </span>}{fmt(wd.dosPct)}%
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{prcStr(wd.prcPct)}</TableCell>
                              <TableCell className="text-right tabular-nums">{fmt(wd.mmqPcu)}</TableCell>
                              <TableCell className="text-center">
                                <span className={wd.withinCapacity ? "text-emerald-700" : "text-red-700 font-medium"}>
                                  {wd.withinCapacity ? "Yes" : "No"}
                                </span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    {intersections.length > 20 && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Showing 20 of {intersections.length} junctions — the PDF includes all of them.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No junctions met the impact threshold for this scheme (a sub-threshold London residential scheme
                    is reported as a trip-comparison TS). The PDF documents that determination.
                  </p>
                )}

                <Button onClick={downloadPdf} disabled={pdfLoading} variant="outline" className="gap-2">
                  {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  Download full London TA PDF
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-[11px] text-muted-foreground pt-4 border-t">
        Public preview — London-only, limited to 3 free demo runs per day. Numbers come from the live engine
        (<code>uk-capacity.ts</code>); on-screen capacity mirrors it via <code>lib/trcs.ts</code>.
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
