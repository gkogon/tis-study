/**
 * /settings/profile — user profile management. First/last name + email,
 * plus a separate change-password form.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  ArrowLeft, User, Mail, Lock, Loader2, CheckCircle2, AlertCircle,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

export default function ProfileSettingsPage() {
  const { isAuthenticated, isLoading, user, login } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileInfo, setProfileInfo] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPw, setChangingPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwInfo, setPwInfo] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName ?? "");
      setLastName(user.lastName ?? "");
      setEmail(user.email ?? "");
    }
  }, [user]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileError(null);
    setProfileInfo(null);
    setSavingProfile(true);
    try {
      const r = await fetch("/tis-api/auth/me", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim() || null,
          lastName: lastName.trim() || null,
          email: email.trim().toLowerCase(),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? "Save failed.");
      setProfileInfo("Profile updated.");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    setPwInfo(null);
    if (newPassword !== confirmPassword) {
      setPwError("Passwords don't match.");
      return;
    }
    if (newPassword.length < 10) {
      setPwError("Password must be at least 10 characters.");
      return;
    }
    setChangingPw(true);
    try {
      const r = await fetch("/tis-api/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? "Change failed.");
      setPwInfo("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Change failed.");
    } finally {
      setChangingPw(false);
    }
  }

  if (isLoading) return null;
  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center space-y-4">
        <h1 className="text-2xl font-bold">Sign in required</h1>
        <button
          onClick={login}
          className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
        >
          Sign in
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
        <div>
          <Link href="/projects" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to projects
          </Link>
        </div>

        <header className="space-y-2">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-600">
            <User className="w-3.5 h-3.5" /> Profile
          </div>
          <h1 className="text-3xl font-bold">Your account</h1>
        </header>

        <section className="border rounded-xl p-6 space-y-4 bg-background">
          <h2 className="text-lg font-semibold inline-flex items-center gap-2">
            <Mail className="w-4 h-4 text-blue-600" /> Profile
          </h2>
          <form onSubmit={saveProfile} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="First name">
                <input
                  type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name" maxLength={80} className="input"
                  data-testid="input-profile-first"
                />
              </Field>
              <Field label="Last name">
                <input
                  type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name" maxLength={80} className="input"
                  data-testid="input-profile-last"
                />
              </Field>
            </div>
            <Field label="Email">
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="email" required className="input"
                data-testid="input-profile-email"
              />
            </Field>
            <button
              type="submit"
              disabled={savingProfile}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              data-testid="button-save-profile"
            >
              {savingProfile && <Loader2 className="w-4 h-4 animate-spin" />}
              Save changes
            </button>
            <Status info={profileInfo} error={profileError} />
          </form>
        </section>

        <section className="border rounded-xl p-6 space-y-4 bg-background">
          <h2 className="text-lg font-semibold inline-flex items-center gap-2">
            <Lock className="w-4 h-4 text-blue-600" /> Change password
          </h2>
          <form onSubmit={changePassword} className="space-y-3">
            <Field label="Current password">
              <input
                type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password" className="input"
                data-testid="input-profile-currpw"
              />
            </Field>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="New password">
                <input
                  type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password" required minLength={10} className="input"
                  data-testid="input-profile-newpw"
                />
              </Field>
              <Field label="Confirm new password">
                <input
                  type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password" required minLength={10} className="input"
                  data-testid="input-profile-confirmpw"
                />
              </Field>
            </div>
            <button
              type="submit"
              disabled={changingPw}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              data-testid="button-change-password"
            >
              {changingPw && <Loader2 className="w-4 h-4 animate-spin" />}
              Update password
            </button>
            <Status info={pwInfo} error={pwError} />
          </form>
        </section>
      </div>
      <SiteFooter />

      <style>{`.input { width: 100%; border-radius: 0.375rem; border: 1px solid hsl(var(--input)); background: var(--background); padding: 0.5rem 0.75rem; font-size: 0.875rem; }
      .input:focus { outline: 2px solid #2563eb; outline-offset: 1px; }`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5 block">
      <div className="text-sm font-medium">{label}</div>
      {children}
    </label>
  );
}

function Status({ info, error }: { info: string | null; error: string | null }) {
  if (info) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 px-3 py-2 text-sm text-green-800 dark:text-green-200 flex gap-2">
        <CheckCircle2 className="w-4 h-4 mt-0.5" /> {info}
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex gap-2">
        <AlertCircle className="w-4 h-4 mt-0.5" /> {error}
      </div>
    );
  }
  return null;
}
