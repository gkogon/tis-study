/**
 * Shared top navigation. Sits on every page; collapses to a hamburger
 * on mobile. Knows the current sign-in state via useAuth and renders
 * either the "Sign in / Start trial" pair or the signed-in user
 * dropdown.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  Building2, Menu, X, ChevronDown, LogOut, User, CreditCard, FolderOpen,
  Activity, ArrowRight,
} from "lucide-react";

type Item = { href: string; label: string };

const PUBLIC_NAV: Item[] = [
  { href: "/studies", label: "Studies" },
  { href: "/for-firms", label: "For Firms" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

const AUTHED_NAV: Item[] = [
  { href: "/studies", label: "Run a study" },
  { href: "/projects", label: "My projects" },
  { href: "/monitoring", label: "Monitoring" },
];

export function SiteNav() {
  const { isAuthenticated, user, logout } = useAuth();
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the user menu when clicking outside.
  useEffect(() => {
    if (!menuOpen) return;
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => { setMobileOpen(false); }, [location]);

  const navItems = isAuthenticated ? AUTHED_NAV : PUBLIC_NAV;
  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
    user?.email ||
    "Account";

  return (
    <header className="sticky top-0 z-40 bg-background/85 backdrop-blur border-b border-border">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-6">
        <Link href="/" className="inline-flex items-center gap-2 font-semibold text-sm shrink-0">
          <Building2 className="w-4 h-4 text-blue-600" />
          <span>Atlanta TIS</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-sm">
          {navItems.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className={
                "px-3 py-1.5 rounded-md hover:bg-accent transition-colors " +
                (location === it.href || location.startsWith(it.href + "/")
                  ? "text-foreground font-medium"
                  : "text-muted-foreground")
              }
            >
              {it.label}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        <div className="hidden md:flex items-center gap-2">
          {isAuthenticated ? (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md hover:bg-accent"
                data-testid="button-user-menu"
              >
                <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-[10px] font-bold inline-flex items-center justify-center">
                  {(user?.firstName?.[0] ?? user?.email?.[0] ?? "U").toUpperCase()}
                </span>
                <span className="max-w-[120px] truncate">{displayName}</span>
                <ChevronDown className="w-3.5 h-3.5 opacity-60" />
              </button>
              {menuOpen && <UserMenu onLogout={logout} />}
            </div>
          ) : (
            <>
              <Link
                href="/login"
                className="px-3 py-1.5 text-sm font-medium rounded-md hover:bg-accent"
                data-testid="link-nav-signin"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
                data-testid="link-nav-signup"
              >
                Start trial <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="md:hidden p-1.5 rounded-md hover:bg-accent"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-background">
          <nav className="px-4 py-3 flex flex-col gap-1 text-sm">
            {navItems.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className="px-3 py-2 rounded-md hover:bg-accent"
              >
                {it.label}
              </Link>
            ))}
            <div className="border-t border-border pt-2 mt-2">
              {isAuthenticated ? (
                <>
                  <Link href="/settings/profile" className="px-3 py-2 rounded-md hover:bg-accent flex items-center gap-2">
                    <User className="w-4 h-4" /> Profile
                  </Link>
                  <Link href="/settings/billing" className="px-3 py-2 rounded-md hover:bg-accent flex items-center gap-2">
                    <CreditCard className="w-4 h-4" /> Billing
                  </Link>
                  <Link href="/settings/firm" className="px-3 py-2 rounded-md hover:bg-accent flex items-center gap-2">
                    <Building2 className="w-4 h-4" /> Firm settings
                  </Link>
                  <button
                    type="button"
                    onClick={logout}
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-accent text-red-600 flex items-center gap-2"
                  >
                    <LogOut className="w-4 h-4" /> Sign out
                  </button>
                </>
              ) : (
                <>
                  <Link href="/login" className="px-3 py-2 rounded-md hover:bg-accent">Sign in</Link>
                  <Link href="/signup" className="px-3 py-2 rounded-md bg-blue-600 text-white text-center font-semibold">
                    Start trial
                  </Link>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

function UserMenu({ onLogout }: { onLogout: () => void }) {
  return (
    <div
      className="absolute right-0 mt-1 w-56 bg-background border border-border rounded-md shadow-lg overflow-hidden text-sm"
      data-testid="menu-user"
    >
      <MenuLink href="/settings/profile" icon={User}>Profile</MenuLink>
      <MenuLink href="/projects" icon={FolderOpen}>My projects</MenuLink>
      <MenuLink href="/monitoring" icon={Activity}>Monitoring</MenuLink>
      <MenuLink href="/settings/firm" icon={Building2}>Firm settings</MenuLink>
      <MenuLink href="/settings/billing" icon={CreditCard}>Billing</MenuLink>
      <button
        type="button"
        onClick={onLogout}
        className="w-full text-left px-3 py-2 hover:bg-accent text-red-600 inline-flex items-center gap-2 border-t border-border"
        data-testid="button-logout"
      >
        <LogOut className="w-4 h-4" /> Sign out
      </button>
    </div>
  );
}

function MenuLink({
  href, icon: Icon, children,
}: { href: string; icon: typeof User; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-2 hover:bg-accent inline-flex items-center gap-2 w-full"
    >
      <Icon className="w-4 h-4 text-muted-foreground" />
      {children}
    </Link>
  );
}
