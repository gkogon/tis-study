/**
 * Trip Distribution — the web view of the report's §6.1.
 *
 * The engine has computed a full directional distribution since June (gravity
 * with NCHRP-716 gamma friction; Caltran mass/distance in Florida; analogy /
 * surrogate as opt-in methods), and the PDF has always printed it — but the
 * web results never rendered any of it. An engineer who ran a study in the
 * app and looked for "the distributions" found nothing, which reads as the
 * engine not doing distribution at all. Everything shown here comes straight
 * from `report.tripDistribution`; no numbers are derived client-side beyond
 * row percentages.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Compass } from "lucide-react";
import type { TisReport } from "@workspace/tis-api-client-react";

// Octant display order: clockwise from north, matching the PDF's convention
// and caltran-gravity's CARDINALS.
const OCTANTS = ["NNE", "ENE", "ESE", "SSE", "SSW", "WSW", "WNW", "NNW"] as const;

// How many destination zones to list. The engine may carry 50+; the report
// table leads with the heaviest and says how many more there are.
const MAX_ZONE_ROWS = 10;

export function TripDistributionCard({ report }: { report: TisReport }) {
  const td = report.tripDistribution;
  if (!td) return null;

  const byDir = td.byDirection ?? {};
  const zones = [...(td.zones ?? [])].sort((a, b) => b.sharePct - a.sharePct);
  const shown = zones.slice(0, MAX_ZONE_ROWS);
  const maxPct = Math.max(1, ...OCTANTS.map((o) => Number(byDir[o]) || 0));

  return (
    <Card className="break-inside-avoid">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-base">Trip distribution</CardTitle>
        </div>
        <CardDescription>
          {td.methodLabel} — {td.basis}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Directional shares: the eight compass octants, Σ = 100%. */}
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
            Directional distribution
          </div>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-x-4 gap-y-2">
            {OCTANTS.map((o) => {
              const pct = Number(byDir[o]) || 0;
              return (
                <div key={o} data-testid={`dist-octant-${o}`}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-mono text-muted-foreground">{o}</span>
                    <span className="text-sm font-semibold tabular-nums">{pct.toFixed(1)}%</span>
                  </div>
                  {/* Hairline bar, scaled to the largest octant. */}
                  <div className="mt-1 h-1 bg-muted rounded-sm overflow-hidden">
                    <div
                      className="h-full bg-foreground/70"
                      style={{ width: `${(100 * pct) / maxPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Destination zones, heaviest first. */}
        {shown.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
              Top destination zones
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="dist-zone-table">
                <thead>
                  <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="text-left py-1.5 pr-3 font-medium">Zone</th>
                    <th className="text-right py-1.5 px-3 font-medium">Dist (mi)</th>
                    <th className="text-right py-1.5 px-3 font-medium">Bearing</th>
                    <th className="text-right py-1.5 pl-3 font-medium">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((z) => (
                    <tr key={z.id} className="border-b border-border/50 last:border-0">
                      <td className="py-1.5 pr-3">{z.name || z.id}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{z.distanceMi.toFixed(2)}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums font-mono text-xs">{z.cardinal}</td>
                      <td className="py-1.5 pl-3 text-right tabular-nums font-semibold">{z.sharePct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {zones.length > shown.length && (
              <p className="text-xs text-muted-foreground mt-1.5">
                + {zones.length - shown.length} more zones in the report PDF's distribution table.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
