/**
 * Shared wrapper for legal pages — consistent typography, a back link,
 * a "Last updated" line, and the site footer.
 *
 * Legal-page copy is intentionally in plain TSX (not Markdown) so the
 * pages can be edited without touching a markdown pipeline; a lawyer
 * reviewing this just edits the page file. The copy is template-quality
 * — you must have a licensed attorney review before relying on it in
 * a paying-customer context.
 */
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { SiteFooter } from "./site-footer";

export function LegalLayout({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-6">
        <div>
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to home
          </Link>
        </div>
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="text-sm text-muted-foreground">
            Last updated: {lastUpdated}
          </p>
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            <strong>Template notice:</strong> this document is a template provided
            for engineering-firm SaaS use. Final language must be reviewed and
            customized by a licensed attorney for your jurisdiction before any
            paying customer relies on it.
          </div>
        </header>
        <article className="prose prose-sm dark:prose-invert max-w-none [&>h2]:mt-6 [&>h2]:font-semibold [&>h2]:text-lg [&>p]:my-2 [&>ul]:my-2 [&>ul]:list-disc [&>ul]:pl-6 [&_li]:my-0.5">
          {children}
        </article>
      </div>
      <SiteFooter />
    </div>
  );
}
