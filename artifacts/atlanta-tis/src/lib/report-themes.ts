/**
 * Client for the firm's report-format library (`/tis-api/firms/report-themes`).
 * A "theme" is one of the firm's formats, extracted from a sample PDF; every
 * study renders in the project's theme, else the firm default, else the
 * region's standard format.
 */

/** Summary of one format as the API describes it (report-theme/theme.ts summarizeTheme). */
export type ThemeSummary = {
  pageSize: string;
  orientation: "portrait" | "landscape";
  margins: { top: number; right: number; bottom: number; left: number };
  fonts: Array<{ role: "body" | "heading"; requested: string; used: string; exact: boolean }>;
  palette: { primary: string; accent: string; text: string; muted: string; rule: string };
  header: string | null;
  footer: string | null;
  cover: "image" | "photo" | "color" | "plain";
  table: { headerFill: string | null; mode: "horizontal" | "grid" | "none" };
  numbering: string;
  figures: string;
  warnings: string[];
  extractedAt: string;
};

export type ThemeListItem = {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  summary: ThemeSummary;
};

export type ThemeList = { themes: ThemeListItem[]; legacy: boolean };

export async function fetchThemes(): Promise<ThemeList> {
  const r = await fetch("/tis-api/firms/report-themes", { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = (await r.json()) as { themes?: ThemeListItem[]; legacy?: boolean };
  return { themes: data.themes ?? [], legacy: !!data.legacy };
}

export async function uploadTheme(file: File, name?: string): Promise<ThemeListItem> {
  const fd = new FormData();
  fd.append("file", file);
  if (name?.trim()) fd.append("name", name.trim());
  const r = await fetch("/tis-api/firms/report-themes", { method: "POST", credentials: "include", body: fd });
  const data = (await r.json()) as { error?: string; theme?: ThemeListItem };
  if (!r.ok || !data.theme) throw new Error(data.error ?? `HTTP ${r.status}`);
  return data.theme;
}

export async function patchTheme(id: string, body: { name?: string; isDefault?: true }): Promise<void> {
  const r = await fetch(`/tis-api/firms/report-themes/${encodeURIComponent(id)}`, {
    method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${r.status}`);
}

export async function deleteTheme(id: string): Promise<void> {
  const r = await fetch(`/tis-api/firms/report-themes/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${r.status}`);
}

export function previewUrl(id: string): string {
  return `/tis-api/firms/report-themes/${encodeURIComponent(id)}/preview.pdf`;
}

/** The id a fresh study should default to: the firm default, else the standard format (""). */
export function defaultThemeId(list: ThemeList): string {
  return list.themes.find((t) => t.isDefault)?.id ?? "";
}

/** localStorage key for the dismissed first-run card. */
export const FORMAT_CARD_DISMISSED_KEY = "tis.format-card.dismissed";
