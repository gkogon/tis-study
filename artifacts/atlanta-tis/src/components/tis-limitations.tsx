/**
 * Appendix B — Limitations &amp; Assumptions.
 *
 * Mandatory disclosures for a screening-level TIS deliverable. This is the
 * single most important page for shielding the firm legally: it explicitly
 * states what data sources were used, what was assumed, what is NOT covered,
 * and the conditions under which the report is no longer valid.
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";

export function TisLimitations() {
  return (
    <Card className="break-inside-avoid print:break-before-page border-l-4 border-l-amber-500">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-600" />
          <CardTitle className="text-base">Appendix B — Limitations &amp; Assumptions</CardTitle>
        </div>
        <CardDescription>
          Conditions under which the conclusions of this report are valid. Read before
          acting on any recommendation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm leading-relaxed">

        <Block heading="Scope of analysis">
          This is a <strong>screening-level</strong> Traffic Impact Study. Its purpose is to
          identify whether a proposed development warrants a formal traffic impact analysis
          and, if so, where mitigation is most likely to be required. It is{" "}
          <strong>not</strong> a substitute for a full TIS prepared with measured turning-
          movement counts, microsimulation (Synchro / SimTraffic / VISSIM), and signal
          warrants analysis where geometric or signal changes are recommended.
        </Block>

        <Block heading="Data sources">
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              Signalized intersection inventory: derived from OpenStreetMap (OSM) traffic-signal
              nodes within the Atlanta MSA, last refreshed at the date shown on the cover page.
            </li>
            <li>
              Existing volumes and turning-movement splits: deterministically modeled from
              zone-level demand patterns calibrated to GDOT 511 incident-rate observations.
              No measured tube counts, automated traffic recorder (ATR) counts, or video-derived
              counts were used.
            </li>
            <li>
              Trip generation: ITE Trip Generation Manual, 11th Edition, average weekday rates.
            </li>
            <li>
              Capacity analysis: Highway Capacity Manual, 6th Edition, Chapter 19 (signalized
              intersections).
            </li>
          </ul>
        </Block>

        <Block heading="Assumptions">
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>
              Build-out occurs in a single phase at the opening year shown on the cover page.
              Phased build-out is not modeled.
            </li>
            <li>
              Background growth in non-project traffic is assumed at <strong>1.0% per year</strong>{" "}
              compounded between the analysis date and the opening year. Adjust for local
              corridor-specific growth observed in the GDOT Annual Average Daily Traffic series.
            </li>
            <li>
              No internal capture, pass-by, or mode-shift credits have been applied to project
              trips. A formal TIS should apply ITE-recommended credits where land-use mix and
              proximity to transit support them.
            </li>
            <li>
              All affected intersections are assumed to operate under their existing signal
              timing plans. Signal timing is not re-optimized as part of this baseline.
            </li>
            <li>
              Geometric improvements recommended in Section "Recommended mitigations" are
              conceptual only. Right-of-way availability has not been verified.
            </li>
          </ul>
        </Block>

        <Block heading="Confidence">
          Per-intersection delay deltas are reported with a <strong>±15% band at the 80%
          confidence level</strong>. This band reflects calibration uncertainty in the underlying
          model and does not encompass scenario-level uncertainty (e.g., approval of a competing
          nearby development, opening or closure of a major adjacent generator, pandemic-era
          travel-pattern shifts, etc.). The reviewing engineer should widen this band where
          such scenario uncertainty is material.
        </Block>

        <Block heading="When this report is no longer valid">
          This report should be re-run when any of the following occur:
          <ul className="list-disc list-inside space-y-1 ml-2 mt-1">
            <li>The proposed land use or development size changes by more than 10%.</li>
            <li>The opening year shifts by more than one year.</li>
            <li>
              A new signalized intersection is added within the study radius, or an existing
              one is removed.
            </li>
            <li>
              The road network within the study radius is materially altered (new lane,
              new connection, closure, or reclassification).
            </li>
            <li>
              The OSM signal inventory is more than 12 months out of date relative to the
              study date.
            </li>
          </ul>
        </Block>

        <Block heading="Limitation of liability">
          This screening-level study is provided to support early-stage feasibility decisions
          and to scope a subsequent formal TIS. The signing engineer's professional opinion
          is limited to the conclusions explicitly stated herein and is conditioned on the
          assumptions enumerated above. No warranty is made as to the suitability of these
          conclusions for permit submittal, construction documentation, or post-construction
          performance.
        </Block>

      </CardContent>
    </Card>
  );
}

function Block({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground mb-1">
        {heading}
      </h3>
      <div className="text-sm">{children}</div>
    </section>
  );
}
