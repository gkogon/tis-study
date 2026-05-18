/**
 * Shared top navigation. Sits on every page; collapses to a hamburger
 * on mobile. Knows the current sign-in state via useAuth and renders
 * either the "Sign in / Start trial" pair or the signed-in user
 * dropdown.
 *
 * Visual goals: a polished SaaS feel inspired by Stripe / Linear —
 * subtle backdrop blur, tight typography, a brand wordmark that looks
 * like a real product (not a placeholder).
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  Menu, X, ChevronDown, LogOut, User, CreditCard, FolderOpen,
  Activity, ArrowRight, Building2,
} from "lucide-react";

type Item = { href: string; label: string };

const PUBLIC_NAV: Item[] = [
  { href: "/demo", label: "Demo" },
  { href: "/for-firms", label: "For firms" },
  { href: "/pricing", label: "Pricing" },
  { href: "/compare", label: "Compare" },
  { href: "/about", label: "About" },
];

const AUTHED_NAV: Item[] = [
  { href: "/studies", label: "Run a study" },
  { href: "/projects", label: "My projects" },
  { href: "/monitoring", label: "Monitoring" },
];

/**
 * Brand wordmark. Used in nav + footer so the brand identity is
 * consistent across every surface. The icon is a stylized intersection
 * / four-way grid — abstract enough not to look childish, recognizable
 * enough to read as "traffic" to an engineer.
 */
export function BrandMark({ size = "sm" }: { size?: "sm" | "lg" }) {
  const wordmarkClass = size === "lg" ? "text-base" : "text-sm";
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <span
        aria-hidden
        className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-blue-600 text-white relative overflow-hidden shrink-0"
      >
        {/* Stylized intersection: two crossed lines + a center dot.
            Pure CSS to keep the bundle small and avoid an icon file. */}
        <span className="absolute inset-x-1 top-1/2 -translate-y-1/2 h-[2px] bg-white/90" />
        <span className="absolute inset-y-1 left-1/2 -translate-x-1/2 w-[2px] bg-white/90" />
        <span className="absolute w-1 h-1 rounded-full bg-white" />
      </span>
      <span className={`font-display ${wordmarkClass}`}>
        Simple Impact Studies
      </span>
    </span>
  );
}

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

  function isActive(href: string): boolean {
    if (href === "/") return location === "/";
    return location === href || location.startsWith(href + "/");
  }

  return (
    <header className="sticky top-0 z-40 bg-background/75 backdrop-blur-md border-b border-border/60">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-6">
        <Link href="/" className="shrink-0 hover:opacity-80 transition-opacity">
          <BrandMark />
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-sm">
          {navItems.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className={
                "relative px-3 py-1.5 rounded-md transition-colors " +
                (isActive(it.href)
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {it.label}
              {isActive(it.href) && (
                <span className="absolute left-3 right-3 -bottom-[17px] h-[2px] bg-blue-600 rounded-full" />
              )}
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
                className="inline-flex items-center gap-2 px-2.5 py-1.5 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                data-testid="button-user-menu"
              >
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 text-white text-[11px] font-bold inline-flex items-center justify-center shadow-sm">
                  {(user?.firstName?.[0] ?? user?.email?.[0] ?? "U").toUpperCase()}
                </span>
                <span className="max-w-[140px] truncate">{displayName}</span>
                <ChevronDown className="w-3.5 h-3.5 opacity-60" />
              </button>
              {menuOpen && <UserMenu onLogout={logout} />}
            </div>
          ) : (
            <>
              <Link
                href="/login"
                className="px-3 py-1.5 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                data-testid="link-nav-signin"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded-md bg-foreground text-background hover:bg-foreground/85 transition-colors shadow-sm"
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
          className="md:hidden p-2 rounded-md hover:bg-accent transition-colors"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-background">
          <nav className="px-4 py-3 flex flex-col gap-0.5 text-sm">
            {navItems.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className={
                  "px-3 py-2.5 rounded-md transition-colors " +
                  (isActive(it.href)
                    ? "bg-accent font-medium"
                    : "hover:bg-accent text-muted-foreground")
                }
              >
                {it.label}
              </Link>
            ))}
            <div className="border-t border-border pt-2 mt-2">
              {isAuthenticated ? (
                <>
                  <Link href="/settings/profile" className="px-3 py-2.5 rounded-md hover:bg-accent flex items-center gap-2">
                    <User className="w-4 h-4" /> Profile
                  </Link>
                  <Link href="/settings/billing" className="px-3 py-2.5 rounded-md hover:bg-accent flex items-center gap-2">
                    <CreditCard className="w-4 h-4" /> Billing
                  </Link>
                  <Link href="/settings/firm" className="px-3 py-2.5 rounded-md hover:bg-accent flex items-center gap-2">
                    <Building2 className="w-4 h-4" /> Firm settings
                  </Link>
                  <button
                    type="button"
                    onClick={logout}
                    className="w-full text-left px-3 py-2.5 rounded-md hover:bg-accent text-red-600 flex items-center gap-2"
                  >
                    <LogOut className="w-4 h-4" /> Sign out
                  </button>
                </>
              ) : (
                <div className="grid gap-2 pt-1">
                  <Link href="/login" className="px-3 py-2.5 rounded-md hover:bg-accent text-center">Sign in</Link>
                  <Link href="/signup" className="px-3 py-2.5 rounded-md bg-foreground text-background text-center font-semibold">
                    Start trial
                  </Link>
                </div>
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
      className="absolute right-0 mt-2 w-56 bg-background border border-border rounded-lg shadow-xl overflow-hidden text-sm"
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
        className="w-full text-left px-3 py-2.5 hover:bg-accent text-red-600 inline-flex items-center gap-2 border-t border-border transition-colors"
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
      className="px-3 py-2.5 hover:bg-accent inline-flex items-center gap-2 w-full transition-colors"
    >
      <Icon className="w-4 h-4 text-muted-foreground" />
      {children}
    </Link>
  );
}
