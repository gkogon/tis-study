/**
 * Firm settings: name, logo URL (for white-labeled PDFs), and member
 * management. Owners can do everything; admins can edit firm details
 * and invite members; members can only view.
 *
 * Invites: the admin sends an invite email outside the app for now —
 * the dashboard shows the accept link they can paste into their own
 * email until we add transactional email.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import {
  ArrowLeft, Building2, Users, Mail, Copy, Trash2, Loader2,
  CheckCircle2, AlertCircle, Image as ImageIcon, Upload,
} from "lucide-react";
import { SiteFooter } from "../components/site-footer";

type Firm = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  planTier: string;
  seatLimit: number;
};

type Member = {
  userId: string;
  role: string;
  joinedAt: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
};

type Invite = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
  token: string;
};

export default function SettingsFirmPage() {
  const { isAuthenticated, isLoading: authLoading, user, login } = useAuth();
  const [firm, setFirm] = useState<Firm | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsName, setDetailsName] = useState("");
  const [detailsLogo, setDetailsLogo] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    Promise.all([
      fetch("/tis-api/firms/me", { credentials: "include" }).then((r) => r.json()),
      fetch("/tis-api/firms/members", { credentials: "include" }).then((r) => r.json()),
    ])
      .then(([me, mem]) => {
        if (cancelled) return;
        if (me?.firm) {
          setFirm(me.firm);
          setRole(me.role);
          setDetailsName(me.firm.name);
          setDetailsLogo(me.firm.logoUrl ?? "");
        }
        setMembers(mem.members ?? []);
        setInvites(mem.pendingInvites ?? []);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  const canEdit = role === "owner" || role === "admin";
  const isOwner = role === "owner";

  async function uploadLogoFile(file: File) {
    setError(null);
    setInfo(null);
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/tis-api/firms/logo", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setFirm(data.firm);
      setDetailsLogo(data.firm?.logoUrl ?? "");
      setInfo(
        data.backend === "replit_object_storage"
          ? "Logo uploaded to Replit Object Storage."
          : "Logo stored locally (object storage not configured).",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploadingLogo(false);
    }
  }

  async function saveDetails(e: React.FormEvent) {
    e.preventDefault();
    setSavingDetails(true);
    setError(null);
    setInfo(null);
    try {
      const r = await fetch("/tis-api/firms", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: detailsName, logoUrl: detailsLogo || null }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setFirm(data.firm);
      setInfo("Firm details saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSavingDetails(false);
    }
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setError(null);
    setInfo(null);
    try {
      const r = await fetch("/tis-api/firms/invites", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setInvites((prev) => [data.invite, ...prev]);
      setInviteEmail("");
      setInfo("Invite created — share the link with them below.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed.");
    } finally {
      setInviting(false);
    }
  }

  async function removeMember(userId: string) {
    if (!confirm("Remove this engineer from the firm?")) return;
    setError(null);
    try {
      const r = await fetch(`/tis-api/firms/members/${encodeURIComponent(userId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed.");
    }
  }

  function copyInviteLink(token: string) {
    const origin = window.location.origin;
    const base = (import.meta.env.BASE_URL ?? "/").replace(/\/+$/, "");
    const url = `${origin}${base}/invites/accept?token=${encodeURIComponent(token)}`;
    void navigator.clipboard.writeText(url);
    setInfo("Invite link copied to clipboard.");
  }

  if (authLoading) return <CenteredLoader label="Loading…" />;
  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 text-center space-y-4">
        <h1 className="text-2xl font-bold">Sign in required</h1>
        <p className="text-muted-foreground">Sign in to manage your firm.</p>
        <button
          type="button"
          onClick={login}
          className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700"
        >
          Sign in
        </button>
      </div>
    );
  }
  if (!firm) return <CenteredLoader label="Loading firm…" />;

  return (
    <div>
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <div>
          <Link
            href="/projects"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to projects
          </Link>
        </div>

        <header className="space-y-2">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-blue-600">
            <Building2 className="w-3.5 h-3.5" />
            Firm settings
          </div>
          <h1 className="text-3xl font-bold">{firm.name}</h1>
          <p className="text-muted-foreground">
            Your role: <strong>{role}</strong> ·{" "}
            <Link href="/settings/billing" className="text-blue-600 hover:underline">
              billing & plan
            </Link>
          </p>
        </header>

        {info && (
          <div className="rounded-md border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 px-3 py-2 text-sm text-green-800 dark:text-green-200 flex gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5" /> {info}
          </div>
        )}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-900 px-3 py-2 text-sm text-red-700 dark:text-red-300 flex gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5" /> {error}
          </div>
        )}

        <section className="border rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-blue-600" />
            <h2 className="text-lg font-semibold">Branding</h2>
          </div>
          <form onSubmit={saveDetails} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Firm name</label>
              <input
                type="text"
                value={detailsName}
                onChange={(e) => setDetailsName(e.target.value)}
                disabled={!canEdit}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60"
                maxLength={120}
                data-testid="input-firm-name-edit"
              />
              <p className="text-xs text-muted-foreground">
                Appears on every white-labeled PDF.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Logo</label>
              {detailsLogo && (
                <div className="border rounded-md p-3 bg-muted/20 inline-flex items-center gap-3">
                  <img src={detailsLogo} alt="Firm logo preview" className="h-12 w-auto max-w-[160px] object-contain" />
                  <span className="text-xs text-muted-foreground truncate max-w-[200px]">{detailsLogo.startsWith("data:") ? "Stored locally (data URL)" : detailsLogo}</span>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <label className={"inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border " + (canEdit ? "hover:bg-accent cursor-pointer" : "opacity-50 cursor-not-allowed")}>
                  <Upload className="w-3.5 h-3.5" />
                  {uploadingLogo ? "Uploading…" : "Upload logo"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    disabled={!canEdit || uploadingLogo}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogoFile(f); e.currentTarget.value = ""; }}
                    className="hidden"
                    data-testid="input-firm-logo-file"
                  />
                </label>
                <span className="text-xs text-muted-foreground">or paste a public URL:</span>
              </div>
              <input
                type="url"
                value={detailsLogo}
                onChange={(e) => setDetailsLogo(e.target.value)}
                disabled={!canEdit}
                placeholder="https://your-firm.com/logo.png"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60"
                maxLength={2048}
                data-testid="input-firm-logo"
              />
              <p className="text-xs text-muted-foreground">
                PNG, JPG, SVG, or WEBP — up to 2 MB. Appears on the cover page of every white-labeled PDF.
              </p>
            </div>
            <button
              type="submit"
              disabled={!canEdit || savingDetails}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              data-testid="button-save-firm-details"
            >
              {savingDetails && <Loader2 className="w-4 h-4 animate-spin" />}
              Save changes
            </button>
            {!canEdit && (
              <p className="text-xs text-muted-foreground">
                Members can't edit firm details. Ask an owner or admin.
              </p>
            )}
          </form>
        </section>

        <section className="border rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-600" />
            <h2 className="text-lg font-semibold">Members ({members.length} / {firm.seatLimit})</h2>
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2">Engineer</th>
                <th className="text-left py-2">Role</th>
                <th className="text-left py-2">Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const displayName =
                  [m.firstName, m.lastName].filter(Boolean).join(" ").trim() ||
                  m.email ||
                  m.userId;
                const isSelf = m.userId === user?.id;
                return (
                  <tr key={m.userId} className="border-b last:border-b-0">
                    <td className="py-3">
                      <div className="font-medium">{displayName}{isSelf && <span className="text-xs text-muted-foreground"> (you)</span>}</div>
                      <div className="text-xs text-muted-foreground">{m.email}</div>
                    </td>
                    <td className="py-3 capitalize">{m.role}</td>
                    <td className="py-3 text-muted-foreground">
                      {new Date(m.joinedAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 text-right">
                      {isOwner && !isSelf && (
                        <button
                          type="button"
                          onClick={() => removeMember(m.userId)}
                          className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700"
                          data-testid={`button-remove-member-${m.userId}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {canEdit && (
          <section className="border rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-blue-600" />
              <h2 className="text-lg font-semibold">Invite an engineer</h2>
            </div>
            <form onSubmit={sendInvite} className="flex flex-wrap gap-2 items-end">
              <div className="flex-1 min-w-[200px] space-y-1.5">
                <label className="text-sm font-medium">Email</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="engineer@firm.com"
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                  data-testid="input-invite-email"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "member" | "admin")}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={inviting}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                data-testid="button-send-invite"
              >
                {inviting && <Loader2 className="w-4 h-4 animate-spin" />}
                Create invite
              </button>
            </form>
            <p className="text-xs text-muted-foreground">
              We'll add email delivery soon. For now, copy the invite link and email it yourself.
            </p>

            {invites.length > 0 && (
              <div className="pt-4 border-t space-y-2">
                <div className="text-sm font-semibold">Pending invites</div>
                <ul className="space-y-1.5 text-sm">
                  {invites.map((inv) => (
                    <li key={inv.id} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{inv.email}</span>
                      <span className="text-xs text-muted-foreground">({inv.role})</span>
                      <span className="text-xs text-muted-foreground">
                        expires {new Date(inv.expiresAt).toLocaleDateString()}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyInviteLink(inv.token)}
                        className="ml-auto inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                        data-testid={`button-copy-invite-${inv.id}`}
                      >
                        <Copy className="w-3.5 h-3.5" /> Copy link
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}

function CenteredLoader({ label }: { label: string }) {
  return (
    <div className="max-w-3xl mx-auto px-4 py-24 flex items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="w-4 h-4 animate-spin" /> {label}
    </div>
  );
}
