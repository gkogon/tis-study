import { Link } from "wouter";
import { Compass, ArrowRight, Home, FolderOpen, Building2 } from "lucide-react";
import { SiteFooter } from "../components/site-footer";

export default function NotFound() {
  return (
    <div>
      <div className="max-w-2xl mx-auto px-4 py-16 text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 dark:bg-blue-950/40 mx-auto">
          <Compass className="w-7 h-7 text-blue-600" />
        </div>
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-widest text-blue-600">404</div>
          <h1 className="text-3xl font-bold">Page not found</h1>
          <p className="text-muted-foreground">
            That URL doesn't lead anywhere — yet. Try one of these:
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <ShortLink href="/" icon={Home} label="Home" />
          <ShortLink href="/studies" icon={FolderOpen} label="Studies" />
          <ShortLink href="/for-firms" icon={Building2} label="For Firms" />
        </div>
        <p className="text-xs text-muted-foreground pt-4">
          Looking for something specific? <Link href="/about" className="text-blue-600 hover:underline">About</Link>
          {" · "}
          <Link href="/pricing" className="text-blue-600 hover:underline">Pricing</Link>
          {" · "}
          <Link href="/legal/terms" className="text-blue-600 hover:underline">Terms</Link>
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}

function ShortLink({
  href, icon: Icon, label,
}: { href: string; icon: typeof Home; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-md border border-border hover:bg-accent transition-colors"
    >
      <Icon className="w-4 h-4 text-blue-600" />
      {label}
      <ArrowRight className="w-3.5 h-3.5 opacity-60" />
    </Link>
  );
}
