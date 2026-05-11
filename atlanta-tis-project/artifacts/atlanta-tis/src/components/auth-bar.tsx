/**
 * Lightweight auth indicator that lives in the header of the TIS generator.
 * Shows sign-in CTA when anonymous, signed-in identity + sign-out when authed.
 */
import { useAuth } from "@workspace/replit-auth-web";
import { LogIn, LogOut, User as UserIcon } from "lucide-react";

export function AuthBar() {
  const { user, isAuthenticated, isLoading, login, logout } = useAuth();

  if (isLoading) return null;

  if (!isAuthenticated) {
    return (
      <button
        type="button"
        onClick={login}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-border hover:bg-accent"
        data-testid="button-sign-in"
      >
        <LogIn className="w-4 h-4" />
        Sign in to generate
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <UserIcon className="w-4 h-4" />
        {user?.email ?? user?.firstName ?? "Signed in"}
      </span>
      <button
        type="button"
        onClick={logout}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        data-testid="button-sign-out"
      >
        <LogOut className="w-3.5 h-3.5" />
        Sign out
      </button>
    </div>
  );
}
