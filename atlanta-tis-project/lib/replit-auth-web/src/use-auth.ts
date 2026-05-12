/**
 * Auth hook for the web UI.
 *
 * History: this lib was originally named `replit-auth-web` because it
 * proxied Replit OIDC. As of Phase 13 the OIDC backend was replaced
 * with email + password, and this hook now redirects `login()` to the
 * /login page (where the email/password form lives) and POSTs to
 * /auth/logout. The package name is unchanged to avoid a workspace-wide
 * rename; treat it as the generic "web auth hook" for the app.
 */
import { useState, useEffect, useCallback } from "react";

declare global {
  interface ImportMeta {
    env: { BASE_URL: string };
  }
}

export interface AuthUser {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  /** Navigates to /login so the user can enter their email + password. */
  login: () => void;
  /** Clears the session server-side and reloads to the home page. */
  logout: () => void;
}

const AUTH_BASE = "/tis-api";

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${AUTH_BASE}/auth/user`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ user: AuthUser | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setUser(data.user ?? null);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(() => {
    const base = import.meta.env.BASE_URL.replace(/\/+$/, "") || "";
    const returnTo = encodeURIComponent(window.location.pathname || "/");
    window.location.href = `${base}/login?returnTo=${returnTo}`;
  }, []);

  const logout = useCallback(() => {
    void fetch(`${AUTH_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).finally(() => {
      const base = import.meta.env.BASE_URL.replace(/\/+$/, "") || "";
      window.location.href = `${base}/`;
    });
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
  };
}
