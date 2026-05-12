/**
 * Privacy Policy — TEMPLATE. Requires attorney review.
 */
import { LegalLayout } from "../components/legal-layout";

export default function LegalPrivacyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="May 11, 2026">
      <p>
        This Privacy Policy describes how Atlanta TIS ("we," "us") collects,
        uses, and discloses information when you use the Atlanta TIS web
        application (the "Service"). By using the Service you agree to the
        collection and use of information in accordance with this policy.
      </p>

      <h2>1. Information We Collect</h2>
      <p>
        <strong>Account information.</strong> When you sign up we collect
        your name, email, profile image (if provided via OIDC), and the
        Firm you are associated with. Authentication is handled by Replit
        Auth; we receive the claims that the OIDC flow returns.
      </p>
      <p>
        <strong>Firm and project content.</strong> Inputs you submit to the
        Service — project name, site coordinates, ITE land-use codes,
        sizes, hourly volume profiles, crash counts, and any other
        engineering parameters — are stored so you can re-open past
        studies. Generated outputs (the structured report payload) are
        stored alongside the inputs.
      </p>
      <p>
        <strong>Billing information.</strong> When you start a paid plan,
        we share your Firm name, contact email, and billing address with
        Stripe, which processes the payment. We do not store your card
        number or full payment details on our systems; Stripe handles those
        per its own policy and PCI standards.
      </p>
      <p>
        <strong>Usage and telemetry.</strong> We collect server-side logs
        of API requests (route, status code, response time), IP address
        (truncated where feasible), browser type, and the actions you take
        within the Service. We use this for security, debugging, and
        product analytics.
      </p>
      <p>
        <strong>Cookies and sessions.</strong> We set a session cookie
        (HTTP-only, secure) to keep you signed in. We do not currently use
        third-party advertising or cross-site tracking cookies.
      </p>

      <h2>2. How We Use Information</h2>
      <ul>
        <li>To provide, maintain, and improve the Service.</li>
        <li>To process subscriptions, send receipts, and handle billing.</li>
        <li>To respond to support requests and notify you about Service-relevant updates.</li>
        <li>To improve engine calibration (anonymized, aggregated only).</li>
        <li>To detect, investigate, and prevent fraud, abuse, or violations of our Terms.</li>
        <li>To comply with legal obligations.</li>
      </ul>

      <h2>3. Third-Party Services</h2>
      <p>The Service relies on third-party providers, each with their own privacy practices:</p>
      <ul>
        <li><strong>Replit</strong> — application hosting, OIDC authentication, and (when configured) object storage for firm logos.</li>
        <li><strong>Stripe</strong> — payment processing, invoicing, and the customer billing portal.</li>
        <li><strong>Resend</strong> — transactional email delivery for member invites and account notifications.</li>
        <li><strong>Georgia DOT (511 NaviGAtor)</strong> — live incident, alert, and camera data ingested into the Service. We do not send your project data to GDOT.</li>
      </ul>
      <p>
        Each of these providers receives only the data necessary for the
        function it performs. We do not sell personal data to advertising
        networks or data brokers.
      </p>

      <h2>4. Data Retention</h2>
      <ul>
        <li>Account information is retained as long as your Firm has an active or recently-closed account.</li>
        <li>Project data is retained for the life of your Firm; when a Firm closes its account we will delete or anonymize project data within 90 days unless you request earlier deletion.</li>
        <li>Server logs are retained for up to 12 months.</li>
        <li>Billing records are retained as required by tax and accounting law (typically 7 years).</li>
      </ul>

      <h2>5. Your Rights</h2>
      <p>
        Depending on your jurisdiction you may have rights to access,
        correct, delete, or port your personal information; to object to
        certain processing; or to lodge a complaint with a supervisory
        authority. To exercise any of these rights, email the address in
        the footer.
      </p>

      <h2>6. Security</h2>
      <p>
        We use industry-standard measures to protect your information:
        HTTPS transport, hashed session identifiers, server-side
        rate-limiting, role-based access control, and least-privilege
        secrets management. No system is perfectly secure, however, and
        we cannot guarantee absolute protection.
      </p>

      <h2>7. Children</h2>
      <p>
        The Service is for licensed engineering firms and is not directed
        at children under 13. We do not knowingly collect personal
        information from anyone under 13.
      </p>

      <h2>8. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material
        changes will be notified by email to the contact on file for your
        Firm. The "Last updated" date at the top reflects the most recent
        revision.
      </p>

      <h2>9. Contact</h2>
      <p>
        Privacy questions can be sent to the email listed in the site
        footer.
      </p>
    </LegalLayout>
  );
}
