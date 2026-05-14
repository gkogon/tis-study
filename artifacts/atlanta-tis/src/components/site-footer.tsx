/**
 * Shared site footer. Appears on every public marketing page and on
 * the authenticated app shell. Keep links short — anything not pointing
 * to a real page should be removed, not stubbed.
 */
import { Link } from "wouter";
import { BrandMark } from "./site-nav";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60 mt-24 bg-muted/20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 grid grid-cols-2 md:grid-cols-6 gap-10 text-sm">
        <div className="col-span-2 space-y-3">
          <BrandMark />
          <p className="text-muted-foreground leading-relaxed max-w-xs">
            Screening-level traffic engineering studies. Footnoted to HCM,
            ITE, and the MUTCD. Built for engineering firms that ship.
          </p>
          <div className="text-xs text-muted-foreground pt-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Live GDOT data flowing
            </span>
          </div>
        </div>
        <FooterCol heading="Product">
          <FooterLink href="/studies">Studies hub</FooterLink>
          <FooterLink href="/tis">TIS generator</FooterLink>
          <FooterLink href="/studies/parking">Parking demand</FooterLink>
          <FooterLink href="/monitoring">Post-build monitoring</FooterLink>
          <FooterLink href="/projects">Project history</FooterLink>
          <FooterLink href="/pricing">Pricing</FooterLink>
        </FooterCol>
        <FooterCol heading="Company">
          <FooterLink href="/for-firms">For firms</FooterLink>
          <FooterLink href="/compare">Compare</FooterLink>
          <FooterLink href="/about">About</FooterLink>
          <FooterLink href="/contact">Contact</FooterLink>
          <FooterLink href="/security">Security</FooterLink>
          <FooterLink href="/help">Help & docs</FooterLink>
        </FooterCol>
        <FooterCol heading="Account">
          <FooterLink href="/login">Sign in</FooterLink>
          <FooterLink href="/signup">Start trial</FooterLink>
          <FooterLink href="/settings/billing">Billing</FooterLink>
          <FooterLink href="/projects">My projects</FooterLink>
        </FooterCol>
        <FooterCol heading="Legal">
          <FooterLink href="/legal/terms">Terms</FooterLink>
          <FooterLink href="/legal/privacy">Privacy</FooterLink>
          <FooterLink href="/legal/disclaimer">Engineering disclaimer</FooterLink>
          <FooterLink href="/unsubscribe">Unsubscribe</FooterLink>
        </FooterCol>
      </div>
      <div className="border-t border-border/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div>© {new Date().getFullYear()} Simple Impact Studies. Cites HCM 6th Ed., ITE 11th Ed., MUTCD 2009/2024.</div>
          <div>Built in Atlanta · Data: GDOT 511 NaviGAtor</div>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {heading}
      </div>
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="text-muted-foreground hover:text-foreground transition-colors">
        {children}
      </Link>
    </li>
  );
}
