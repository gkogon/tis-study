/**
 * /trics — PRIVATE, UNLIMITED, London-only TA generator.
 *
 * Generates UK Transport Assessment reports in the London ("TRICS")
 * format with no rate limit and no quota, for live/repeat demos. Locked
 * down hard: the page fetches /tis-api/auth/admin-status and renders the
 * 404 page for anyone who is neither an ADMIN_EMAILS operator nor a
 * signed-in dev-auth session — so to the public the route does not exist.
 * The backing endpoints (/tis-api/trics/generate, /tis-api/trics/pdf)
 * enforce the SAME gate server-side and return a bare 404 to anyone else,
 * and reject any coordinate outside Greater London. Nothing here is
 * reachable or abusable by the public even if the URL leaks.
 *
 * Temporary pitch surface — delete this file, the /trics route in
 * App.tsx, and the /trics/* endpoints in tis-api-server/src/routes/tis.ts
 * when no longer needed.
 */
import { useEffect, useMemo, useState } from "react";
import { Beaker, Loader2, Download, AlertCircle, MapPin, Play } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { signalCapacity, fmt, prcStr } from "@/lib/trcs";

type LondonSite = { id: string; label: string; lat: number; lon: number };
const LONDON_SITES: LondonSite[] = [
  { id: "holloway", label: "Holloway Road, Islington", lat: 51.5530, lon: -0.1140 },
  { id: "stratford", label: "Stratford, Newham", lat: 51.5416, lon: -0.0042 },
  { id: "croydon", label: "Croydon town centre", lat: 51.3762, lon: -0.0982 },
  { id: "wembley", label: "Wembley, Brent", lat: 51.5560, lon: -0.2795 },
  { id: "canarywharf", label: "Canary Wharf, Tower Hamlets", lat: 51.5054, lon: -0.0235 },
  { id: "hammersmith", label: "Hammersmith & Fulham", lat: 51.4927, lon: -0.2240 },
];

type LandUse = { code: string; name: string };

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
  // only by typing /trics directly — but it is NOT access-controlled. The
  // backing /trics/* endpoints are public + rate-limited (see tis.ts).
  return <Generator />;
}

function Generator() {
  const [landUses, setLandUses] = useState<LandUse[]>([]);
  const [siteId, setSiteId] = useState<string>(LONDON_SITES[0]!.id);
  const [landUseCode, setLandUseCode] = useState<string>("710");
  const [size, setSize] = useState<number>(180);
  const [openingYear, setOpeningYear] = useState<number>(2028);

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

  const site = useMemo(() => LONDON_SITES.find((s) => s.id === siteId) ?? LONDON_SITES[0]!, [siteId]);
  const landUseName = landUses.find((l) => l.code === landUseCode)?.name ?? landUseCode;

  function payload() {
    return {
      projectName: `${landUseName} — ${site.label} (TRICS demo)`,
      address: site.label,
      latitude: site.lat,
      longitude: site.lon,
      landUseCode,
      size,
      openingYear,
    };
  }

  async function generate() {
    setError(null);
    setLoading(true);
    setReport(null);
    try {
      const res = await fetch("/tis-api/trics/generate", {
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
      const res = await fetch("/tis-api/trics/pdf", {
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
        <h1 className="text-3xl font-bold tracking-tight">TRICS — London TA generator</h1>
        <p className="text-muted-foreground max-w-3xl">
          Generate a UK Transport Assessment (London "TRICS" format) for any Greater London site, as many times as
          you like — no quota, no rate limit. DMRB / TRL capacity (DoS, PRC, MMQ) on-screen, full TA as a PDF.
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
              <label className="text-xs font-medium text-muted-foreground">London site</label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LONDON_SITES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {site.lat.toFixed(4)}, {site.lon.toFixed(4)}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Land use (ITE proxy)</label>
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
                <label className="text-xs font-medium text-muted-foreground">Size</label>
                <Input type="number" min="1" step="10" value={size}
                  onChange={(e) => setSize(Number(e.target.value) || 0)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Opening year</label>
                <Input type="number" min="2024" max="2060" step="1" value={openingYear}
                  onChange={(e) => setOpeningYear(Number(e.target.value) || 2028)} />
              </div>
            </div>

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
              {report ? `${report.tripGeneration?.landUseName ?? landUseName} · ${site.label}` : "Generate to see DoS / PRC / MMQ and download the TA PDF."}
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
        Public preview — London-only, rate-limited (10 reports/hour). Numbers come from the live engine
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
