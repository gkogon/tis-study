/**
 * Engineering Disclaimer — TEMPLATE. Critical for limiting professional
 * liability exposure. Requires attorney review by counsel familiar with
 * engineering professional liability.
 */
import { LegalLayout } from "../components/legal-layout";

export default function LegalDisclaimerPage() {
  return (
    <LegalLayout title="Engineering Disclaimer" lastUpdated="May 11, 2026">
      <p>
        Simple Impact Studies provides screening-level traffic-engineering analyses
        intended to support — not replace — the professional engineering
        judgment of a licensed Professional Engineer (PE). This page sets
        out the scope of what the Service provides and, importantly, what
        it does <em>not</em> provide.
      </p>

      <h2>Screening fidelity, not signoff fidelity</h2>
      <p>
        Each engine in the Service reproduces the methodology of a published
        engineering reference at a screening-grade level of fidelity:
      </p>
      <ul>
        <li>The Traffic Impact Study engine implements Webster-style capacity analysis with HCM 6th Ed. delay tables, ITE 11th Ed. trip generation, and pass-by / internal-capture adjustments.</li>
        <li>The Parking Demand engine implements ITE Parking Generation 5th Ed. peak rates and Atlanta Article 10 code minimums.</li>
        <li>The Signal Warrants engine implements MUTCD Ch. 4C Warrants 1A, 1B, 3 (volume-only proxy), and 7 (crash-experience).</li>
        <li>The Sight Distance engine implements AASHTO Green Book SSD (Eq. 3-2) and ISD (Eq. 9-1) with maneuver- and vehicle-class adjustments.</li>
        <li>The Queuing Analysis engine implements an HCM Ch. 31 95th-percentile back-of-queue approximation with oversaturation queue growth.</li>
        <li>The Road-Diet Feasibility engine implements FHWA-SA-14-028 screening thresholds with capacity headroom and safety estimation.</li>
        <li>The Post-Build Verification engine compares observed GDOT 511 incident pressure against a one-year baseline at the project location.</li>
      </ul>
      <p>
        Screening-grade means:
      </p>
      <ul>
        <li>Closed-form approximations are used in place of iterative numeric solvers (HCS, Synchro, Vissim, microsimulation).</li>
        <li>Default parameters are published industry averages; site-specific calibration data may not be available for every location in the Atlanta MSA.</li>
        <li>Outputs are deterministic for a given set of inputs and do not perform stochastic sensitivity analyses unless explicitly requested.</li>
      </ul>

      <h2>Not for design submittal without verification</h2>
      <p>
        Outputs from the Service are <strong>not</strong> intended as
        finished engineering deliverables and <strong>must not be
        submitted to any reviewing jurisdiction</strong> (GDOT, City of
        Atlanta DOT, Fulton County, Cobb County, DeKalb County, or any
        other) as a stamped engineering work product without independent
        verification by a licensed PE using a full-rigor analysis
        workflow.
      </p>
      <p>
        Specifically, before relying on any Service output for a final
        design recommendation or jurisdiction submittal, a licensed PE
        should:
      </p>
      <ul>
        <li>Independently verify all numerical inputs (volumes, geometry, signal timing).</li>
        <li>Re-run the analysis in a full-rigor analytical package appropriate for the deliverable.</li>
        <li>Apply engineering judgment to local context not captured by the engine (e.g., unique geometry, special events, freight routes, ADA / multimodal considerations, jurisdiction-specific code variants).</li>
        <li>Stamp and sign the final deliverable in accordance with their licensing-board standards.</li>
      </ul>

      <h2>Land-use rate uncertainty</h2>
      <p>
        The Service ships with approximately 80 ITE land-use rate entries
        spanning residential, lodging, recreational, institutional, office,
        retail, services, and industrial categories. For commonly studied
        codes (e.g., 210, 220, 710, 820, 932, 934) the rates are
        transcribed directly from the published ITE Trip Generation Manual
        11th Ed. tables. For less-common codes, some rates are interpolated
        from published curves or fitted equations. Engineers using the
        Service for an unusual land use should verify the rate against
        the ITE manual before relying on the output.
      </p>

      <h2>Real-time data sources</h2>
      <p>
        The Service ingests live data from the Georgia DOT 511 NaviGAtor
        v2 API (incidents, alerts, dynamic message signs, cameras). This
        data is provided by GDOT on an "as available" basis and may be
        incomplete, delayed, or temporarily unavailable. Service outputs
        that reference live data degrade gracefully when the upstream
        feed is unavailable; we make no warranty as to the accuracy or
        completeness of GDOT's published data.
      </p>

      <h2>User qualifications</h2>
      <p>
        The Service is intended exclusively for use by licensed engineering
        firms and credentialed transportation-engineering professionals.
        Outputs are presented in technical form (HCM-style LOS, MUTCD
        warrant tables, AASHTO distance computations, etc.) and require
        professional context to interpret correctly.
      </p>

      <h2>No professional client relationship</h2>
      <p>
        Use of the Service does not create a client / professional-engineer
        relationship between you and Simple Impact Studies. Simple Impact Studies does not
        provide engineering services, does not stamp deliverables, and is
        not licensed to practice professional engineering in any
        jurisdiction.
      </p>

      <h2>Acknowledgment</h2>
      <p>
        By using the Service you acknowledge that you have read,
        understood, and agreed to this Engineering Disclaimer, and that
        you are responsible for the engineering judgment applied to any
        Service output before reliance.
      </p>
    </LegalLayout>
  );
}
