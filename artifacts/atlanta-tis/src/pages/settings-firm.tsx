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
  brandColor: string | null;
  addressLine: string | null;
  phone: string | null;
  website: string | null;
  planTier: string;
  seatLimit: number;
};

/**
 * Summary of the firm's imported report format (GET /firms/report-template).
 * Summary only — the stored template carries the logo bytes and every section
 * of captured prose, which has no business on a settings page.
 */
type FirmTemplate = {
  id: string;
  name: string;
  documentType: string;
  chapters: number;
  sections: number;
  brand: { primary: string; hasLogo: boolean; cover: string };
};

const DEFAULT_BRAND_COLOR = "#7a1420";

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
  const [detailsBrandColor, setDetailsBrandColor] = useState(DEFAULT_BRAND_COLOR);
  const [detailsAddress, setDetailsAddress] = useState("");
  const [detailsPhone, setDetailsPhone] = useState("");
  const [detailsWebsite, setDetailsWebsite] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [template, setTemplate] = useState<FirmTemplate | null>(null);
  const [templateInvalid, setTemplateInvalid] = useState(false);
  const [uploadingTemplate, setUploadingTemplate] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;
    Promise.all([
      fetch("/tis-api/firms/me", { credentials: "include" }).then((r) => r.json()),
      fetch("/tis-api/firms/members", { credentials: "include" }).then((r) => r.json()),
      fetch("/tis-api/firms/report-template", { credentials: "include" }).then((r) => r.json()),
    ])
      .then(([me, mem, tpl]) => {
        if (cancelled) return;
        setTemplate(tpl?.template ?? null);
        setTemplateInvalid(!!tpl?.invalid);
        if (me?.firm) {
          setFirm(me.firm);
          setRole(me.role);
          setDetailsName(me.firm.name);
          setDetailsLogo(me.firm.logoUrl ?? "");
          setDetailsBrandColor(me.firm.brandColor ?? DEFAULT_BRAND_COLOR);
          setDetailsAddress(me.firm.addressLine ?? "");
          setDetailsPhone(me.firm.phone ?? "");
          setDetailsWebsite(me.firm.website ?? "");
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

  /**
   * Upload an example report PDF. The server ingests its structure, headings,
   * palette and logo into a template; from then on this firm's studies render
   * in that format instead of the region default.
   */
  async function uploadTemplateFile(file: File) {
    setError(null);
    setInfo(null);
    setUploadingTemplate(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/tis-api/firms/report-template", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      const next = await fetch("/tis-api/firms/report-template", { credentials: "include" }).then((x) => x.json());
      setTemplate(next?.template ?? null);
      setTemplateInvalid(!!next?.invalid);
      setInfo(
        `Format imported — ${data.chapters} chapters, ${data.sections} sections.` +
          (data.brand?.hasLogo ? " Logo and palette picked up from the cover." : " No logo found on the cover; the palette was still read."),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Template import failed.");
    } finally {
      setUploadingTemplate(false);
    }
  }

  /** Revert to the region's default format. */
  async function removeTemplate() {
    setError(null);
    setInfo(null);
    setUploadingTemplate(true);
    try {
      const r = await fetch("/tis-api/firms/report-template", {
        method: "DELETE",
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setTemplate(null);
      setTemplateInvalid(false);
      setInfo("Reverted to the standard format for each study's region.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the template.");
    } finally {
      setUploadingTemplate(false);
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
        body: JSON.stringify({
          name: detailsName,
          logoUrl: detailsLogo || null,
          brandColor: detailsBrandColor || null,
          addressLine: detailsAddress || null,
          phone: detailsPhone || null,
          website: detailsWebsite || null,
        }),
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
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Report format</label>
              {template ? (
                <div className="border rounded-md p-3 bg-muted/20 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="inline-block w-3 h-3 rounded-sm border"
                      style={{ backgroundColor: template.brand.primary }}
                      aria-hidden="true"
                    />
                    <span className="text-sm font-medium">{template.name}</span>
                    <span className="text-xs text-muted-foreground">{template.documentType}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {template.chapters} chapters · {template.sections} sections ·{" "}
                    {template.brand.hasLogo ? "logo imported" : "no logo found"} · {template.brand.cover} cover
                  </p>
                </div>
              ) : templateInvalid ? (
                <p className="text-xs text-amber-700">
                  A format was uploaded but can no longer be read, so studies are rendering in the
                  standard format. Re-upload the example report to fix it.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Studies render in the standard format for each site's region.
                </p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                <label className={"inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border " + (canEdit ? "hover:bg-accent cursor-pointer" : "opacity-50 cursor-not-allowed")}>
                  <Upload className="w-3.5 h-3.5" />
                  {uploadingTemplate ? "Reading…" : template ? "Replace example report" : "Upload example report"}
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={!canEdit || uploadingTemplate}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadTemplateFile(f); e.currentTarget.value = ""; }}
                    className="hidden"
                    data-testid="input-firm-template-file"
                  />
                </label>
                {template && canEdit && (
                  <button
                    type="button"
                    onClick={() => void removeTemplate()}
                    disabled={uploadingTemplate}
                    className="px-3 py-1.5 text-sm rounded-md border hover:bg-accent disabled:opacity-50"
                    data-testid="button-firm-template-remove"
                  >
                    Use standard format
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Upload one of your own finished studies as a PDF. We read its chapter structure,
                headings, colours and logo, and your future studies come out in that format. It needs a
                text layer — a scanned report won't import.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Brand color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(detailsBrandColor) ? detailsBrandColor : DEFAULT_BRAND_COLOR}
                  onChange={(e) => setDetailsBrandColor(e.target.value)}
                  disabled={!canEdit}
                  className="h-9 w-14 rounded-md border border-input bg-background p-1 disabled:opacity-60"
                  data-testid="input-firm-brand-color"
                  aria-label="Brand color"
                />
                <input
                  type="text"
                  value={detailsBrandColor}
                  onChange={(e) => setDetailsBrandColor(e.target.value)}
                  disabled={!canEdit}
                  placeholder="#7a1420"
                  className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60"
                  maxLength={7}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Drives the cover page's geometric design. Hex like <code>#7a1420</code>.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Office address</label>
                <input
                  type="text"
                  value={detailsAddress}
                  onChange={(e) => setDetailsAddress(e.target.value)}
                  disabled={!canEdit}
                  placeholder="410 S. Ware Blvd, Suite 1035, Tampa, FL 33619"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60"
                  maxLength={200}
                  data-testid="input-firm-address"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Phone</label>
                <input
                  type="text"
                  value={detailsPhone}
                  onChange={(e) => setDetailsPhone(e.target.value)}
                  disabled={!canEdit}
                  placeholder="786-456-7700"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60"
                  maxLength={40}
                  data-testid="input-firm-phone"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label className="text-sm font-medium">Website</label>
                <input
                  type="text"
                  value={detailsWebsite}
                  onChange={(e) => setDetailsWebsite(e.target.value)}
                  disabled={!canEdit}
                  placeholder="www.yourfirm.com"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60"
                  maxLength={255}
                  data-testid="input-firm-website"
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Address, phone, and website render in the cover's contact block.
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
