/**
 * Terms of Service — TEMPLATE. Requires attorney review before use
 * with paying customers.
 */
import { LegalLayout } from "../components/legal-layout";

export default function LegalTermsPage() {
  return (
    <LegalLayout title="Terms of Service" lastUpdated="May 11, 2026">
      <p>
        These Terms of Service ("Terms") govern access to and use of the
        Simple Impact Studies web application (the "Service") operated by Simple Impact Studies
        ("Simple Impact Studies," "we," "us"). By creating an account or using the
        Service you agree to these Terms.
      </p>

      <h2>1. The Service</h2>
      <p>
        The Service is a screening-level traffic-engineering toolset for
        licensed engineering firms operating in the Atlanta MSA. It
        generates outputs based on published industry references including
        but not limited to ITE Trip Generation Manual 11th Ed., ITE Parking
        Generation Manual 5th Ed., HCM 6th Ed., MUTCD 2009 (with 2024
        amendments), and AASHTO Green Book 7th Ed. The Service is a
        decision-support tool. Outputs are not stamped engineering
        deliverables and are not certified for submittal to any
        jurisdiction without independent verification by a licensed
        Professional Engineer. See our <a href="/legal/disclaimer">Engineering Disclaimer</a> for the full scope of what the Service does and does not provide.
      </p>

      <h2>2. Eligibility &amp; Accounts</h2>
      <ul>
        <li>You may use the Service only on behalf of a licensed engineering firm or as a credentialed transportation-engineering professional.</li>
        <li>You are responsible for keeping your account credentials secure and for all activity that occurs under your account.</li>
        <li>You will provide accurate, current, and complete information when registering, and update it as needed.</li>
        <li>You will not share account credentials with anyone outside your firm's authorized members.</li>
      </ul>

      <h2>3. Firms and Members</h2>
      <p>
        A "Firm" is a billing entity (e.g., an engineering company); a
        "Member" is an authorized user invited to that Firm. The Firm owner
        (the user who first created the Firm or to whom ownership was
        transferred) is responsible for managing membership, plan selection,
        and payment. Adding a Member counts against the Firm's seat limit
        for the active subscription tier.
      </p>

      <h2>4. Subscriptions &amp; Payment</h2>
      <ul>
        <li>Plans are billed monthly in advance via Stripe. Current pricing is published at <a href="/pricing">/pricing</a>.</li>
        <li>A 14-day free trial is provided on Starter and Growth tiers. You will not be charged until the trial ends.</li>
        <li>Plans include a monthly study quota across all study types. Studies generated in excess of the quota will be blocked until the next billing period or until you upgrade.</li>
        <li>You may cancel at any time from the billing portal. Cancellation takes effect at the end of the current billing period; we do not refund the unused portion of a paid month.</li>
        <li>We may change pricing on 30 days' notice for active subscribers; price changes apply to the next billing cycle after the notice period.</li>
      </ul>

      <h2>5. Acceptable Use</h2>
      <p>You will not, and will not permit any user to:</p>
      <ul>
        <li>Use the Service to generate outputs intended for submittal as a stamped engineering deliverable without independent verification.</li>
        <li>Reverse-engineer, decompile, scrape, or otherwise extract the engine models, calibration data, or land-use registry except to the extent expressly permitted by applicable law.</li>
        <li>Resell, sublicense, or otherwise commercialize access to the Service to third parties not employed by your Firm.</li>
        <li>Use the Service to violate any applicable law, regulation, or third-party right (including intellectual-property rights of ITE, AASHTO, FHWA, GDOT, or other publishers cited by the Service).</li>
        <li>Upload content that infringes any third-party right, contains malware, or attempts to interfere with the Service's operation.</li>
        <li>Attempt to defeat rate limits, authentication, or quota enforcement.</li>
      </ul>

      <h2>6. Intellectual Property</h2>
      <p>
        We retain all right, title, and interest in the Service, including
        the engine code, calibration corpus, land-use rate tables (as
        compiled), UI, and brand assets. You retain ownership of inputs you
        provide and of any reports the Service generates from those inputs.
        You grant us a limited license to process your inputs solely to
        operate the Service, improve calibration, and aggregate anonymized
        usage analytics. We will not publicly disclose individual projects
        or identifiable client data without your permission.
      </p>

      <h2>7. Disclaimer of Warranties</h2>
      <p>
        <strong>The Service is provided "as is" and "as available." We
        expressly disclaim all warranties, express or implied, including
        merchantability, fitness for a particular purpose, and
        non-infringement.</strong> Outputs are screening-level estimates
        and are not a substitute for licensed engineering judgment,
        full-rigor analytical software (e.g., HCS, Synchro, Vissim), or
        site-specific design verification.
      </p>
      <p>
        You assume sole responsibility for verifying any output before
        relying on it for a real engineering decision. See the{" "}
        <a href="/legal/disclaimer">Engineering Disclaimer</a> for further
        scope.
      </p>

      <h2>8. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, in no event will Simple Impact Studies,
        its officers, employees, contractors, or affiliates be liable for
        any indirect, incidental, consequential, special, exemplary, or
        punitive damages arising from or related to your use of the
        Service, including without limitation lost profits, lost data, or
        lost engineering fees, even if we have been advised of the
        possibility of such damages. Our aggregate liability for any
        direct damages arising from or related to these Terms or the
        Service will not exceed the greater of (a) the fees you paid us in
        the twelve months preceding the event giving rise to the claim, or
        (b) one hundred U.S. dollars.
      </p>

      <h2>9. Indemnification</h2>
      <p>
        You will defend, indemnify, and hold harmless Simple Impact Studies from any
        third-party claim, loss, or expense (including reasonable
        attorneys' fees) arising from (a) your or your Firm's use of the
        Service, (b) reliance on Service outputs without independent
        verification, (c) breach of these Terms, or (d) violation of any
        applicable law or third-party right.
      </p>

      <h2>10. Termination</h2>
      <p>
        You may close your account at any time. We may suspend or terminate
        your account if you breach these Terms, abuse the Service, or
        engage in conduct we determine in good faith creates risk to us or
        other users. We will give reasonable notice except where the breach
        is willful, harmful, or unlawful. Sections 6, 7, 8, 9, and 11–14
        survive termination.
      </p>

      <h2>11. Changes to the Service or Terms</h2>
      <p>
        We may change the Service or these Terms at any time. Material
        changes will be communicated by email and posted at this URL with
        an updated "Last updated" date. Continued use after the effective
        date of a change constitutes acceptance.
      </p>

      <h2>12. Governing Law &amp; Disputes</h2>
      <p>
        These Terms are governed by the laws of the State of Georgia,
        United States, without regard to its conflict-of-laws principles.
        Any dispute arising from or related to these Terms or the Service
        will be resolved exclusively in the state or federal courts located
        in Fulton County, Georgia. Each party waives any objection to
        venue or jurisdiction in those courts.
      </p>

      <h2>13. Miscellaneous</h2>
      <ul>
        <li>If any provision is held unenforceable, the remainder will remain in effect.</li>
        <li>Failure to enforce a provision is not a waiver of the right to enforce it later.</li>
        <li>You may not assign these Terms without our written consent. We may assign without consent in connection with a merger, acquisition, or asset sale.</li>
        <li>Notices to you may be sent to the email on file for your account; notices to us must be sent to the contact below.</li>
      </ul>

      <h2>14. Contact</h2>
      <p>
        Questions about these Terms can be sent to the address on file with
        your Firm or to the email listed in the footer of this page.
      </p>
    </LegalLayout>
  );
}
