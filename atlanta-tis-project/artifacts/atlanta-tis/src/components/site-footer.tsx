/**
 * Shared site footer. Appears on every public marketing page and on the
 * authenticated app shell. Keep links short — anything not pointing to a
 * real page should be removed, not stubbed.
 */
import { Link } from "wouter";
import { Building2 } from "lucide-react";

export function SiteFooter() {
  return (
    <footer className="border-t border-border mt-24">
      <div className="max-w-6xl mx-auto px-4 py-12 grid grid-cols-2 md:grid-cols-5 gap-8 text-sm">
        <div className="col-span-2 md:col-span-1 space-y-2">
          <div className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <Building2 className="w-4 h-4 text-blue-600" />
            Atlanta TIS
          </div>
          <p className="text-muted-foreground leading-relaxed">
            Screening-level Traffic Impact Studies for the Atlanta MSA. Built
            for engineering firms.
          </p>
        </div>
        <FooterCol heading="Product">
          <FooterLink href="/studies">Studies hub</FooterLink>
          <FooterLink href="/tis">TIS generator</FooterLink>
          <FooterLink href="/studies/parking">Parking Demand</FooterLink>
          <FooterLink href="/monitoring">Post-build monitoring</FooterLink>
          <FooterLink href="/projects">Project history</FooterLink>
          <FooterLink href="/pricing">Pricing</FooterLink>
        </FooterCol>
        <FooterCol heading="Firms">
          <FooterLink href="/for-firms">For engineering firms</FooterLink>
          <FooterLink href="/signup">Start a firm trial</FooterLink>
          <FooterLink href="/settings/firm">Firm settings</FooterLink>
        </FooterCol>
        <FooterCol heading="Account">
          <FooterLink href="/settings/billing">Billing</FooterLink>
          <FooterLink href="/projects">My projects</FooterLink>
        </FooterCol>
        <FooterCol heading="Legal">
          <FooterLink href="/legal/terms">Terms of Service</FooterLink>
          <FooterLink href="/legal/privacy">Privacy Policy</FooterLink>
          <FooterLink href="/legal/disclaimer">Engineering Disclaimer</FooterLink>
        </FooterCol>
      </div>
      <div className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div>© {new Date().getFullYear()} Atlanta TIS. Cites HCM 6th Ed., ITE 11th Ed., MUTCD.</div>
          <div>Built in Atlanta · Data: GDOT</div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </div>
      <ul className="space-y-1.5">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="hover:text-foreground transition-colors">
        {children}
      </Link>
    </li>
  );
}
