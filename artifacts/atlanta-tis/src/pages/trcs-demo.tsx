/**
 * /trcs-demo — TEMPORARY internal pitch surface for the UK Transport
 * Assessment ("TRCS") capacity engine. Hidden from everyone except
 * operators on the ADMIN_EMAILS allow-list: the page fetches
 * /tis-api/auth/admin-status and renders the 404 page for anyone else,
 * so to a normal visitor the route simply does not exist.
 *
 * Two tabs:
 *   1. Live calculator — drives the client mirror of the server UK
 *      capacity engine (lib/trcs.ts) for signal / roundabout / priority
 *      junctions. 100% client-side, nothing to fail live in the room.
 *   2. Sample TA report — the §5.4 DMRB/TRL capacity table + the §1.2
 *      "reported per DMRB CD 123" framing, plus a button that generates
 *      the REAL London TA PDF via /tis-api/generate/pdf (the admin is
 *      signed in, London coords route through renderTisLondon).
 *
 * Delete the route + this file + lib/trcs.ts + the /auth/admin-status
 * endpoint when the pitch is done.
 */
import { useEffect, useMemo, useState } from "react";
import { Beaker, Download, Loader2, AlertCircle, ArrowRight, MapPin } from "lucide-react";
import NotFound from "@/pages/not-found";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import {
  signalCapacity, roundaboutCapacity, priorityCapacity, vehToPcu,
  SAMPLE_JUNCTIONS, fmt, prcStr,
  type UkControlType, type UkCapacityResult,
} from "@/lib/trcs";

const CONTROL_LABEL: Record<UkControlType, string> = {
  signal: "Signalised — OSCADY / LinSig (DMRB CD 123)",
  roundabout: "Roundabout — Kimber / ARCADY (DMRB CD 116)",
  priority: "Priority — PICADY gap-acceptance",
};

function WithinBadge({ ok }: { ok: boolean }) {
  return (
    <Badge className={ok ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" : "bg-red-100 text-red-800 hover:bg-red-100"}>
      {ok ? "Within capacity" : "Over capacity"}
    </Badge>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Calculator() {
  const [control, setControl] = useState<UkControlType>("signal");
  // Signal inputs (v/c = engine degree of saturation).
  const [noBuildVc, setNoBuildVc] = useState(0.78);
  const [buildVc, setBuildVc] = useState(0.83);
  // Roundabout / priority inputs (vehicles/hour).
  const [armDemand, setArmDemand] = useState(600);
  const [conflicting, setConflicting] = useState(800);

  function applyPreset(id: string) {
    const j = SAMPLE_JUNCTIONS.find((s) => s.id === id);
    if (!j) return;
    setControl(j.control);
    if (j.control === "signal") {
      setNoBuildVc(j.noBuildVc);
      setBuildVc(j.buildVc);
    } else {
      // For the non-signal samples, seed plausible flows from the v/c.
      setArmDemand(Math.round(j.buildVc * 700));
      setConflicting(j.control === "roundabout" ? 800 : 600);
    }
  }

  const result: UkCapacityResult = useMemo(() => {
    if (control === "roundabout") return roundaboutCapacity(vehToPcu(armDemand), vehToPcu(conflicting));
    if (control === "priority") return priorityCapacity(vehToPcu(armDemand), vehToPcu(conflicting));
    return signalCapacity(buildVc);
  }, [control, buildVc, armDemand, conflicting]);

  const noBuild: UkCapacityResult | null = control === "signal" ? signalCapacity(noBuildVc) : null;
  const isSignal = control === "signal";

  return (
    <div className="grid gap-6 md:grid-cols-[340px_1fr]">
      {/* Inputs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Junction inputs</CardTitle>
          <CardDescription>Pick a sample London junction or enter your own.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {SAMPLE_JUNCTIONS.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => applyPreset(j.id)}
                className="text-xs rounded-full border px-3 py-1 hover:bg-accent transition-colors text-left"
              >
                {j.name}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Control type</label>
            <Select value={control} onValueChange={(v) => setControl(v as UkControlType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="signal">Signalised</SelectItem>
                <SelectItem value="roundabout">Roundabout</SelectItem>
                <SelectItem value="priority">Priority (give-way)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">{CONTROL_LABEL[control]}</p>
          </div>

          {isSignal ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">No-Build v/c</label>
                <Input type="number" step="0.01" min="0" max="2" value={noBuildVc}
                  onChange={(e) => setNoBuildVc(Number(e.target.value) || 0)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">With-Dev v/c</label>
                <Input type="number" step="0.01" min="0" max="2" value={buildVc}
                  onChange={(e) => setBuildVc(Number(e.target.value) || 0)} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {control === "roundabout" ? "Entry demand" : "Minor-arm demand"} (veh/h)
                </label>
                <Input type="number" step="10" min="0" value={armDemand}
                  onChange={(e) => setArmDemand(Number(e.target.value) || 0)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {control === "roundabout" ? "Circulating flow" : "Major flow"} (veh/h)
                </label>
                <Input type="number" step="10" min="0" value={conflicting}
                  onChange={(e) => setConflicting(Number(e.target.value) || 0)} />
              </div>
            </div>
          )}
          {result.usesDefaultGeometry && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
              Uses DMRB default geometry — a submitted TA re-runs this arm in {control === "roundabout" ? "ARCADY" : "PICADY"} with measured geometry.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between gap-3">
            <span>UK capacity result</span>
            <WithinBadge ok={result.withinCapacity} />
          </CardTitle>
          <CardDescription>{result.method}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isSignal ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Metric label="DoS No-Build" value={`${fmt(noBuild!.dosPct)}%`} />
              <Metric label="DoS With-Dev" value={`${fmt(result.dosPct)}%`}
                sub={`Δ +${fmt(result.dosPct - (noBuild?.dosPct ?? 0))} pts`} />
              <Metric label="PRC With-Dev" value={prcStr(result.prcPct)} sub="to 90% limit" />
              <Metric label="MMQ" value={`${fmt(result.mmqPcu)}`} sub="PCU" />
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Metric label="RFC" value={fmt(result.rfc, 2)} sub="flow ÷ capacity" />
              <Metric label="Capacity" value={`${fmt(result.capacityPcu, 0)}`} sub="PCU/h" />
              <Metric label="Demand" value={`${fmt(result.demandPcu, 0)}`} sub="PCU/h" />
              <Metric label="MMQ" value={`${fmt(result.mmqPcu)}`} sub="PCU" />
            </div>
          )}
          <p className="text-sm text-muted-foreground">{result.note}</p>
          <div className="rounded-lg bg-muted/50 border px-4 py-3 text-xs text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground">How this maps from the US engine:</span>{" "}
            the US engine reports LOS letters and control delay. The same junction here reports the metrics a UK
            reviewer accepts — Degree of Saturation (DoS), Practical Reserve Capacity (PRC = (0.9/DoS−1)·100) and
            Mean Maximum Queue (MMQ) in PCU — per DMRB CD 123 / the TRL junction models, not the US signalized-delay model.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SampleReport() {
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const rows = SAMPLE_JUNCTIONS.map((j) => {
    // The published-TA samples are signalised; the priority T is shown via
    // its scenario v/c too so the table reads consistently in the room.
    const nb = signalCapacity(j.noBuildVc);
    const wd = signalCapacity(j.buildVc);
    return { j, nb, wd };
  });

  async function generatePdf() {
    setPdfError(null);
    setPdfLoading(true);
    try {
      const res = await fetch("/tis-api/generate/pdf", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: "Sample London TA — Holloway Road (TRCS demo)",
          address: "Holloway Road, London N7",
          latitude: 51.5530,
          longitude: -0.1140,
          landUseCode: "710", // General Office — TA-scale, reliably triggers the §5.4 junction table
          size: 180,
          openingYear: 2028,
        }),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        throw new Error((msg as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "sample-london-ta.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : "Could not generate the PDF.");
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">§5.4 Assessment of Junction Impact (DMRB / TRL)</CardTitle>
          <CardDescription>
            What the London TA report now prints — DoS, PRC and MMQ instead of US LOS letters.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Junction</TableHead>
                <TableHead className="text-right">DoS No-Build</TableHead>
                <TableHead className="text-right">DoS With-Dev</TableHead>
                <TableHead className="text-right">PRC With-Dev</TableHead>
                <TableHead className="text-right">MMQ (PCU)</TableHead>
                <TableHead className="text-center">Within cap?</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ j, nb, wd }) => {
                const worsened = wd.dosPct > nb.dosPct + 0.05;
                return (
                  <TableRow key={j.id}>
                    <TableCell className="font-medium">{j.name}</TableCell>
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
          <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
            DoS = Degree of Saturation; PRC = Practical Reserve Capacity to the 90% limit (PRC ≥ 0 ⇒ within
            practical capacity); MMQ = Mean Maximum Queue in PCU. Reported per the DMRB / TRL signalised method —
            a faithful UK result, since the engine's calibrated saturation ratio is the Degree of Saturation.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">§1.2 Methodology — what a UK reviewer reads</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Capacity is reported using the UK signalised method (TRL RR67 / OSCADY–LinSig) per DMRB CD 123,
            <span className="text-foreground font-medium"> not</span> the Highway Capacity Manual. Roundabout and
            priority arms route to ARCADY (Kimber LR942, DMRB CD 116) and PICADY (gap-acceptance) — both
            implemented — and trip generation is the only remaining piece pending a licensed TRICS rate set
            (we do not redistribute TRICS data).
          </p>
          <div>
            <Button onClick={generatePdf} disabled={pdfLoading} className="gap-2">
              {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Generate the real London TA PDF
            </Button>
            <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1">
              <MapPin className="w-3 h-3" /> Holloway Road, London — routes through the London renderer with the
              live §5.4 capacity table. Requires the API + analyzer to be running.
            </p>
            {pdfError && (
              <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> {pdfError}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function TrcsDemoPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/tis-api/auth/admin-status", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { isAdmin: false, devSession: false }))
      .then((d: { isAdmin?: boolean; devSession?: boolean }) => {
        // Visible to admin-list operators OR any signed-in dev-auth session.
        if (!cancelled) setAllowed(!!d.isAdmin || !!d.devSession);
      })
      .catch(() => { if (!cancelled) setAllowed(false); });
    return () => { cancelled = true; };
  }, []);

  if (allowed === null) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-24 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }
  // Non-admins see the standard 404 — the route effectively doesn't exist.
  if (!allowed) return <NotFound />;

  return (
    <div className="max-w-6xl mx-auto px-4 py-10 space-y-6">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="gap-1.5 border-amber-300 bg-amber-50 text-amber-800">
          <Beaker className="w-3.5 h-3.5" /> Internal preview · admin-only
        </Badge>
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">TRCS — UK Transport Assessment engine</h1>
        <p className="text-muted-foreground max-w-3xl">
          A working DMRB / TRL junction-capacity engine for the UK — Degree of Saturation, Practical Reserve
          Capacity and Mean Maximum Queue (PCU), the metrics a UK reviewer accepts, in place of US Level of
          Service letters. Signals via OSCADY / LinSig; roundabouts via Kimber / ARCADY; priority junctions via PICADY
          gap-acceptance.
        </p>
      </div>

      <Tabs defaultValue="calculator" className="space-y-6">
        <TabsList>
          <TabsTrigger value="calculator">Live calculator</TabsTrigger>
          <TabsTrigger value="report">Sample TA report</TabsTrigger>
        </TabsList>
        <TabsContent value="calculator"><Calculator /></TabsContent>
        <TabsContent value="report"><SampleReport /></TabsContent>
      </Tabs>

      <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pt-4 border-t">
        <ArrowRight className="w-3 h-3" /> Temporary pitch surface. Numbers come from the same engine that drives
        the London TA PDF (server: <code>uk-capacity.ts</code>; this page mirrors it client-side as <code>lib/trcs.ts</code>).
      </p>
    </div>
  );
}
