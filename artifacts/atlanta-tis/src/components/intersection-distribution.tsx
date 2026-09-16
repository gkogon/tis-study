/**
 * DistributionSection — §01a of the intersection study: the project's trips
 * through THIS junction.
 *
 *   1. the turning-movement diagram (turning-movement-diagram.tsx) with the
 *      period tabs (every period report that carries rows — AM, PM) and,
 *      when the studio's re-solve differs for this signal, a base / scenario
 *      toggle; beside it the twelve cells as a table with per-approach
 *      totals and the inbound / outbound split;
 *   2. "share of the study": carries N of the project's M peak trips — x % —
 *      ranked k of n, with a ranked bar per studied row (this one lit);
 *   3. "where they go next": for a path row the ledger's exit octants (and
 *      the octants inbound trips arrive from) — unless the scenario's ledgers
 *      are the browser's approximation (`scenarioLedgerSynthesised`), which
 *      is said instead; for every row the OTHER studied intersections whose
 *      site→row route comes within 60 m of this junction — the map's own
 *      client-side routes, labelled as such, carrying the trips of the
 *      period and view on show;
 *   4. the provenance sentences the model wrote for what it drew.
 *
 * Everything here is `distributionForRow` / `routeContinuationForRow`
 * (lib/intersection-study-model.ts); nothing is computed in the view beyond
 * layout. The period and view chosen here drive every readout below the
 * tabs, the continuation list included.
 */
import { useEffect, useMemo, useState } from "react";
import type { TisReport, TisAffectedIntersection, TisPeriodReport } from "@workspace/tis-api-client-react";
import { bearingDeg as engineBearingDeg } from "@workspace/tis-engine-core";
import { TurningMovementDiagram, INBOUND_COLOR, OUTBOUND_COLOR } from "@/components/turning-movement-diagram";
import {
  distributionForRow, routeContinuationForRow, printedPeriodTrips, printedShareFraction, ROUTE_CONTINUATION_LABEL,
  type DistributionPeriodModel, type DistributionModel,
} from "@/lib/intersection-study-model";
import { DIRECTIONS, MOVEMENTS, type IntersectionPlan } from "@/lib/intersection-geometry";
import type { Route } from "@/lib/study-map-sim";

export type DistributionSectionProps = {
  report: TisReport;
  /** The base PM row for the studied signal. */
  row: TisAffectedIntersection;
  /** The studio's re-solve of the whole report when it has client edits; null otherwise. */
  scenarioReport?: TisReport | null;
  /** The scenario's PM row alone, when the page has no whole re-solve to hand over (the PM tab still pairs). */
  scenarioRow?: TisAffectedIntersection | null;
  /** True when the scenario row's turn ledgers were synthesised by the browser (a pre-E2 path row; scenario-solve
   *  rowFallbacks "pathLedger"): the scenario's split is labelled approximated and no exits / origins are read. */
  scenarioLedgerSynthesised?: boolean;
  /** True when the study decided the scenario differs for this signal (the base / scenario toggle appears). */
  scenarioDiffers: boolean;
  plan: IntersectionPlan;
  /** Site→row routes the study map built (StudyMapAlive onRoutes); null before the map has routed. */
  routesBySignalId?: ReadonlyMap<string, Route> | null;
  /** The page opens another signal's study. */
  onOpenSignal?: (signalId: string) => void;
};

const pct = (f: number | null) => (f === null ? "—" : `${(100 * f).toFixed(1)} %`);

/** The period reports that carry rows, in report order — the tabs. */
function periodsWithRows(report: TisReport): TisPeriodReport[] {
  return (report.periodReports ?? []).filter((p) => Array.isArray(p.affectedIntersections) && p.affectedIntersections.length > 0);
}

export function DistributionSection({ report, row, scenarioReport, scenarioRow: scenarioPmRow, scenarioLedgerSynthesised = false, scenarioDiffers, plan, routesBySignalId, onOpenSignal }: DistributionSectionProps) {
  const periods = useMemo(() => periodsWithRows(report), [report]);
  const tabs = useMemo(() => {
    const t = periods.map((p) => ({ key: p.period, label: p.period === "am_peak" ? "AM peak" : p.period === "pm_peak" ? "PM peak" : p.periodLabel || p.period }));
    // A report without period reports still has its PM rows at the top level.
    return t.length ? t : [{ key: "pm_peak", label: "PM peak" }];
  }, [periods]);
  const [periodKey, setPeriodKey] = useState<string>(tabs.some((t) => t.key === "pm_peak") ? "pm_peak" : tabs[0]!.key);
  const [view, setView] = useState<"base" | "scenario">("scenario");
  // A new signal or report keeps the PM tab and the scenario view when they exist.
  useEffect(() => { setPeriodKey(tabs.some((t) => t.key === "pm_peak") ? "pm_peak" : tabs[0]!.key); }, [row.signalId, tabs]);
  useEffect(() => { if (!scenarioDiffers) setView("scenario"); }, [scenarioDiffers]);

  // One model per period: the row of THAT period (the top-level row is the
  // PM's), paired with the scenario report's row for the same period.
  const models = useMemo(() => {
    const out = new Map<string, DistributionModel>();
    for (const t of tabs) {
      const period = periods.find((p) => p.period === t.key) ?? null;
      const baseRow = (period?.affectedIntersections ?? []).find((r) => r.signalId === row.signalId) ?? (t.key === "pm_peak" ? row : null);
      if (!baseRow) continue;
      const scenarioPeriod = scenarioReport?.periodReports?.find((p) => p.period === t.key) ?? null;
      const scenarioRow = scenarioDiffers
        ? (scenarioPeriod?.affectedIntersections ?? scenarioReport?.affectedIntersections ?? (t.key === "pm_peak" && scenarioPmRow ? [scenarioPmRow] : [])).find((r) => r.signalId === row.signalId) ?? null
        : null;
      out.set(t.key, distributionForRow(baseRow, period, report, scenarioRow, scenarioPeriod, { scenarioLedgerSynthesised }));
    }
    return out;
  }, [tabs, periods, row, report, scenarioReport, scenarioPmRow, scenarioLedgerSynthesised, scenarioDiffers]);

  const activeKey = models.has(periodKey) ? periodKey : tabs[0]!.key;
  const dm = models.get(activeKey) ?? null;
  const hasScenario = !!dm?.scenario;
  const scenarioShown = hasScenario && view === "scenario";
  const model: DistributionPeriodModel | null = dm ? (scenarioShown && dm.scenario ? dm.scenario : dm.base) : null;
  const other: DistributionPeriodModel | null = dm && dm.scenario ? (view === "scenario" ? dm.base : dm.scenario) : null;

  // The continuation list carries the trips of the period and view on show:
  // the selected period's rows, from the scenario report in scenario view.
  // (The routes themselves are the same for every period — built on the
  // signals' positions alone.)
  const continuationRows = useMemo(() => {
    const rowsOf = (R: TisReport): TisAffectedIntersection[] | null => {
      const p = (R.periodReports ?? []).find((x) => x.period === activeKey);
      if (p && Array.isArray(p.affectedIntersections) && p.affectedIntersections.length > 0) return p.affectedIntersections;
      return activeKey === "pm_peak" ? R.affectedIntersections : null; // the top-level rows are the PM's
    };
    return (scenarioShown && scenarioReport ? rowsOf(scenarioReport) : null) ?? rowsOf(report) ?? report.affectedIntersections;
  }, [report, scenarioReport, scenarioShown, activeKey]);
  const continuation = useMemo(
    () => routeContinuationForRow(row, continuationRows, routesBySignalId ?? null),
    [row, continuationRows, routesBySignalId],
  );
  const siteBearing = engineBearingDeg({ lat: row.latitude, lon: row.longitude }, { lat: report.request.latitude, lon: report.request.longitude });

  if (!model) {
    return <div className="text-xs text-muted-foreground" data-testid="study-distribution-none">This signal has no row in any period report.</div>;
  }

  const s = model.share;
  const hasSplit = model.cellDirectionBasis !== "none";
  const rankMax = Math.max(1, ...s.ranked.map((r) => r.trips));

  return (
    <div className="space-y-6" data-testid="study-distribution" data-period={model.period} data-view={hasScenario ? view : "base"}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start">
        <TurningMovementDiagram
          model={model}
          plan={plan}
          siteBearingDeg={siteBearing}
          siteDistanceMi={row.distanceMi}
          tabs={tabs}
          activeTab={periodKey}
          onTab={setPeriodKey}
          {...(hasScenario ? { view, onView: setView } : {})}
        />
        <div className="space-y-4 min-w-0">
          {/* The twelve cells with approach totals and the split. */}
          <div className="space-y-1" data-testid="study-distribution-table">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Project trips by movement · {model.periodLabel}{hasScenario ? (view === "scenario" ? " · scenario" : " · base") : ""}
            </div>
            <div className="overflow-x-auto">
              <table className="text-xs tabular-nums w-full">
                <thead>
                  <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="text-left py-1 pr-2 font-medium">Approach</th>
                    {MOVEMENTS.map((m) => <th key={m} className="text-right py-1 px-2 font-medium font-mono">{m}</th>)}
                    <th className="text-right py-1 px-2 font-medium">Σ</th>
                    <th className="text-right py-1 px-2 font-medium">exact</th>
                    {hasSplit && <th className="text-right py-1 px-2 font-medium" style={{ color: INBOUND_COLOR }}>in</th>}
                    {hasSplit && <th className="text-right py-1 pl-2 font-medium" style={{ color: OUTBOUND_COLOR }}>out</th>}
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {DIRECTIONS.map((d) => {
                    const a = model.approaches[d];
                    const o = other?.approaches[d];
                    return (
                      <tr key={d} className="border-b last:border-0" data-testid={`study-distribution-approach-${d}`}>
                        <td className="py-1 pr-2 font-semibold">{d}</td>
                        {MOVEMENTS.map((m) => {
                          const c = model.cells.find((x) => x.approach === d && x.movement === m)!;
                          const oc = other?.cells.find((x) => x.approach === d && x.movement === m);
                          return (
                            <td key={m} className={`py-1 px-2 text-right ${c.trips === 0 ? "text-muted-foreground/60" : ""}`} title={`exact ${c.exact.toFixed(3)}${hasSplit ? ` · ${c.inbound.toFixed(2)} in / ${c.outbound.toFixed(2)} out` : ""}`}>
                              {oc && oc.trips !== c.trips && <span className="text-muted-foreground">{oc.trips} → </span>}{c.trips}
                            </td>
                          );
                        })}
                        <td className="py-1 px-2 text-right font-semibold">{o && o.trips !== a.trips && <span className="text-muted-foreground font-normal">{o.trips} → </span>}{a.trips}</td>
                        <td className="py-1 px-2 text-right text-muted-foreground">{a.exact.toFixed(2)}</td>
                        {hasSplit && <td className="py-1 px-2 text-right" style={{ color: INBOUND_COLOR }}>{a.inbound.toFixed(1)}</td>}
                        {hasSplit && <td className="py-1 pl-2 text-right" style={{ color: OUTBOUND_COLOR }}>{a.outbound.toFixed(1)}</td>}
                      </tr>
                    );
                  })}
                  <tr className="border-t">
                    <td className="py-1 pr-2 text-muted-foreground">Σ</td>
                    {MOVEMENTS.map((m) => <td key={m} className="py-1 px-2 text-right text-muted-foreground">{model.cells.filter((c) => c.movement === m).reduce((t, c) => t + c.trips, 0)}</td>)}
                    <td className="py-1 px-2 text-right font-semibold" data-testid="study-distribution-total">{model.total.trips}</td>
                    <td className="py-1 px-2 text-right text-muted-foreground">{model.total.exact.toFixed(2)}</td>
                    {hasSplit && <td className="py-1 px-2 text-right font-semibold" style={{ color: INBOUND_COLOR }}>{model.total.inbound.toFixed(1)}</td>}
                    {hasSplit && <td className="py-1 pl-2 text-right font-semibold" style={{ color: OUTBOUND_COLOR }}>{model.total.outbound.toFixed(1)}</td>}
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="text-[11px] text-muted-foreground leading-snug" data-testid="study-distribution-split">
              {model.splitBasis === "ledger" && model.inboundShare !== null && model.inFraction !== null && !model.ledgerRecorded ? (
                <span data-testid="study-distribution-split-approximated">Inbound share at this junction <span className="font-mono tabular-nums text-foreground">{pct(model.inboundShare)}</span> — <span className="text-foreground">approximated — no recorded ledger on this report</span>: the scenario's turn ledgers were solved by the browser from the printed movement tables, against the period's inFraction {pct(model.inFraction)}; the cells cross-foot, but this is not the engine's blend.</span>
              ) : model.splitBasis === "ledger" && model.inboundShare !== null && model.inFraction !== null ? (
                <>Inbound share at this junction <span className="font-mono tabular-nums text-foreground">{pct(model.inboundShare)}</span> — from the row's turn ledgers ({model.share.ledgerBlend !== null ? "outbound and recorded inbound sides" : "the outbound ledger and its mirror"}), against the period's inFraction {pct(model.inFraction)}{model.share.ledgerBlend !== null
                  ? (Math.abs(model.inboundShare - model.inFraction) > 5e-4 ? "; the recorded inbound ledger makes the two differ, exactly as the engine blends them" : " — the two coincide here because both ledgers carry the same share of the project")
                  : " — identical by construction on a mirrored ledger"}.</>
              ) : model.splitBasis === "inFraction" && model.inFraction !== null ? (
                <>Inbound share <span className="font-mono tabular-nums text-foreground">{pct(model.inboundShare)}</span> = the period's inFraction applied to the row's trips{model.cellDirectionBasis === "octant-recomputed" ? "; each movement's side is the engine's octant model re-run on this row's bearing and the report's distribution" : model.cellDirectionBasis === "proportional" ? "; every movement split alike (no ledger, no distribution to place it)" : ""}.</>
              ) : (
                <>No period report on this signal — no inbound / outbound split is claimed.</>
              )}
            </div>
          </div>

          {/* Share of the study. */}
          <div className="space-y-2" data-testid="study-distribution-share">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Share of the study · {model.periodLabel}</div>
            {s.periodTrips !== null && s.rank !== null ? (
              <p className="text-sm leading-snug" data-testid="study-distribution-share-line">
                Carries <span className="font-mono font-semibold tabular-nums">{model.total.trips}</span> of the project's{" "}
                <span className="font-mono font-semibold tabular-nums">{printedPeriodTrips(s)}</span> {model.period === "am_peak" ? "AM-peak" : model.period === "pm_peak" ? "PM-peak" : model.periodLabel} trips
                {" — "}<span className="font-mono font-semibold tabular-nums">{pct(printedShareFraction(model.total.trips, printedPeriodTrips(s)))}</span>{" — "}
                ranked <span className="font-mono font-semibold tabular-nums">{s.rank}</span> of {s.of} studied intersections
                {other && other.share.rank !== null && (other.share.rank !== s.rank || other.total.trips !== model.total.trips) && (
                  <span className="text-muted-foreground"> ({view === "scenario" ? "base" : "scenario"}: {other.total.trips} trips, rank {other.share.rank})</span>
                )}.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">No period report carries this row, so its share of the study cannot be stated.</p>
            )}
            <div className="text-[11px] text-muted-foreground font-mono tabular-nums" data-testid="study-distribution-share-exact">
              {s.fraction !== null && s.periodTrips !== null && <>exact share {(100 * s.fraction).toFixed(2)} % ({model.total.exact.toFixed(3)} ÷ {s.periodTrips.toFixed(3)}{s.periodTripsExact ? "" : ", rounded — no exact figure on this report"}) — the sentence's percentage is of its two printed integers</>}
              {s.loadWeight !== null && <> · loadWeight {s.loadWeight.toFixed(4)}</>}
              {s.ledgerBlend !== null && <> · ledger blend {s.ledgerBlend.toFixed(4)}{s.loadWeight !== null && Math.abs(s.ledgerBlend - s.loadWeight) > 1e-9 ? (model.ledgerRecorded ? " (the recorded inbound ledger re-derives it)" : " (from the browser's approximated ledgers)") : ""}</>}
            </div>
            {s.ranked.length > 0 && (
              <RankedBars ranked={s.ranked} signalId={row.signalId} max={rankMax} onOpen={onOpenSignal} />
            )}
          </div>
        </div>
      </div>

      {/* Where they go next. */}
      <div className="grid gap-6 lg:grid-cols-2 items-start border-t pt-4" data-testid="study-distribution-next">
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Where they go next · from the turn ledgers</div>
          {model.movementSource === "path" && !model.ledgerRecorded ? (
            <div className="text-xs text-muted-foreground" data-testid="study-distribution-exits-approximated">
              Approximated — no recorded ledger on this report. The scenario row's turn ledgers were solved by the browser from the printed movement tables and carry no recorded exit or entry bearings, so no direction is read off them. Toggle to the base row for the engine's, where it printed one.
            </div>
          ) : model.movementSource === "path" ? (
            <div className="grid gap-3 sm:grid-cols-2 text-xs">
              <OctantList title="Leaving this junction toward" list={model.exits} color={OUTBOUND_COLOR} empty="The outbound paths do not pass this junction (only the inbound ledger does)." testId="study-distribution-exits" />
              <OctantList title={`Arriving at this junction from${model.originsMirrored ? " (mirror of the outbound ledger)" : ""}`} list={model.origins} color={INBOUND_COLOR} empty="The inbound paths do not pass this junction (only the outbound ledger does)." testId="study-distribution-origins" />
            </div>
          ) : (
            <div className="text-xs text-muted-foreground" data-testid="study-distribution-exits-none">
              This row's movements come from the geometric octant model, not a routed path — the engine carries no turn ledger for it, so no exit direction can be read off the report. The client routes on the right are the only continuation available.
            </div>
          )}
          <div className="text-[11px] text-muted-foreground leading-snug">
            Octants are the compass direction of the next link out of (or into) this junction, quantised to the eight sectors the distribution uses — not the destination zone.
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Other studied intersections on routes through here · {model.periodLabel}{hasScenario ? (scenarioShown ? " · scenario" : " · base") : ""}</div>
          {!continuation.available ? (
            <div className="text-xs text-muted-foreground" data-testid="study-distribution-routes-pending">The study map has not routed yet — open this study from a report with the map on screen.</div>
          ) : continuation.through.length === 0 ? (
            <div className="text-xs text-muted-foreground" data-testid="study-distribution-routes-none">No other studied intersection's site→row route comes within {continuation.withinM} m of this junction — on the map's routing, trips to this junction end here.</div>
          ) : (
            <ul className="text-xs divide-y rounded-md border" data-testid="study-distribution-routes">
              {continuation.through.map((t) => (
                <li key={t.signalId} className="flex items-center justify-between gap-2 px-2 py-1">
                  <span className="min-w-0">
                    {onOpenSignal ? (
                      <button type="button" className="truncate text-left hover:underline max-w-full" onClick={() => onOpenSignal(t.signalId)} title={`Open ${t.name} as its own study`} data-testid={`study-distribution-route-${t.signalId}`}>{t.name}</button>
                    ) : <span className="truncate">{t.name}</span>}
                    <span className="block font-mono text-[10px] text-muted-foreground">{t.signalId} · {t.distanceMi.toFixed(2)} mi from the site · route passes {t.distanceM.toFixed(0)} m from here</span>
                  </span>
                  <span className="font-mono tabular-nums shrink-0">+{t.trips}</span>
                </li>
              ))}
            </ul>
          )}
          {continuation.available && continuation.through.length > 0 && (
            <div className="text-[11px] font-mono tabular-nums text-muted-foreground" data-testid="study-distribution-routes-sum">
              Σ {continuation.throughTrips} {model.periodLabel} trips bound for {continuation.through.length} other signal{continuation.through.length === 1 ? "" : "s"} ride routes that come within {continuation.withinM} m of this junction — a point-to-polyline test on the map's routes, so a route that ends nearby or passes on a neighbouring carriageway counts{!continuation.onOwnRoute ? ` (this junction's own route ends at the road network's nearest node, more than ${continuation.withinM} m away — the map's network has no node at this signal)` : ""}.
            </div>
          )}
          <div className="text-[11px] text-muted-foreground leading-snug italic">{ROUTE_CONTINUATION_LABEL}: the study map's shortest paths from the site to each studied signal, tested within {continuation.withinM} m of this junction.</div>
        </div>
      </div>

      <div className="text-[11px] text-muted-foreground leading-snug space-y-0.5" data-testid="study-distribution-sources">
        <div className="text-[10px] uppercase tracking-wider font-semibold">Sources</div>
        <ol className="list-decimal list-inside space-y-0.5">
          {model.sources.map((x, i) => <li key={i}>{x}</li>)}
        </ol>
      </div>
    </div>
  );
}

function OctantList({ title, list, color, empty, testId }: { title: string; list: DistributionPeriodModel["exits"]; color: string; empty: string; testId: string }) {
  return (
    <div data-testid={testId}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{title}</div>
      {!list || list.length === 0 ? (
        <div className="text-muted-foreground">{empty}</div>
      ) : (
        <ul className="space-y-1">
          {list.map((e) => (
            <li key={e.octant} className="flex items-center gap-2">
              <span className="font-mono w-9">{e.octant}</span>
              <span className="flex-1 h-1.5 bg-muted rounded-sm overflow-hidden"><span className="block h-full" style={{ width: `${(100 * e.fraction).toFixed(1)}%`, background: color }} /></span>
              <span className="font-mono tabular-nums w-14 text-right">{(100 * e.fraction).toFixed(0)} %</span>
              {e.trips !== null && <span className="font-mono tabular-nums text-muted-foreground w-14 text-right">{e.trips.toFixed(1)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One bar per studied row, heaviest first, this row lit. */
function RankedBars({ ranked, signalId, max, onOpen }: { ranked: DistributionPeriodModel["share"]["ranked"]; signalId: string; max: number; onOpen?: (id: string) => void }) {
  const n = ranked.length;
  const W = 400, H = 56, gap = 1.5;
  const bw = Math.max(2, (W - gap * (n - 1)) / n);
  return (
    <div data-testid="study-distribution-rank-chart">
      <svg viewBox={`0 0 ${W} ${H + 12}`} width="100%" style={{ maxHeight: 90, display: "block" }} role="img" aria-label={`Project trips at each of the ${n} studied intersections, heaviest first; this intersection is highlighted.`} className="font-mono text-[9px]">
        {ranked.map((r, i) => {
          const h = Math.max(1, (H * r.trips) / max);
          const mine = r.signalId === signalId;
          return (
            <g key={r.signalId} transform={`translate(${(i * (bw + gap)).toFixed(2)} 0)`} className={onOpen && !mine ? "cursor-pointer" : ""} onClick={onOpen && !mine ? () => onOpen(r.signalId) : undefined}>
              <title>{`#${r.rank} ${r.name} · ${r.trips} trips`}</title>
              <rect x={0} y={H - h} width={bw} height={h} rx={1} className={mine ? "fill-blue-600 dark:fill-blue-400" : "fill-muted-foreground/35 hover:fill-muted-foreground/60"} data-testid={mine ? "study-distribution-rank-mine" : undefined} />
              {mine && <text x={bw / 2} y={H + 10} textAnchor="middle" className="fill-foreground font-semibold">#{r.rank}</text>}
            </g>
          );
        })}
      </svg>
      <div className="text-[10px] text-muted-foreground">Heaviest first, bars to the busiest signal's trips{onOpen ? " — click a bar to open that intersection" : ""}.</div>
    </div>
  );
}
