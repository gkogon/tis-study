/**
 * A firm's library of report formats ("themes") and the one resolver every
 * PDF render goes through.
 *
 * Rows live in `firm_report_themes` (lib/db/src/schema/firms.ts); the firm
 * default is `firms.default_report_theme_id`; a project may pin another
 * theme in `tis_projects.report_theme_id`. `resolveProjectTheme` turns those
 * into the StoredTheme a render uses — the project's, else the firm
 * default, else null (the region's standard format). A stale or foreign
 * id is ignored rather than refused: a study must never fail to render
 * because a format was deleted from another tab.
 */
import { and, asc, eq } from "drizzle-orm";
import { db, firmReportThemesTable, firmsTable, tisProjectsTable } from "@workspace/db";
import { logger } from "./logger";
import { classifyStoredTemplate, parseStoredTheme, type StoredTheme } from "./report-theme/theme";

export type ThemeRow = { id: string; name: string; isDefault: boolean; createdAt: string; stored: StoredTheme };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RE.test(s);
}

async function firmDefaultId(firmId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: firmsTable.defaultReportThemeId })
    .from(firmsTable)
    .where(eq(firmsTable.id, firmId))
    .limit(1);
  return row?.id ?? null;
}

/** Every theme of the firm, oldest first; `legacy` when the firm has none but a V1 row in `firms.report_template`. */
export async function listFirmThemes(firmId: string): Promise<{ themes: ThemeRow[]; legacy: boolean }> {
  const [firm] = await db
    .select({ defaultId: firmsTable.defaultReportThemeId, legacyRow: firmsTable.reportTemplate })
    .from(firmsTable)
    .where(eq(firmsTable.id, firmId))
    .limit(1);
  const rows = await db
    .select({ id: firmReportThemesTable.id, name: firmReportThemesTable.name, createdAt: firmReportThemesTable.createdAt, stored: firmReportThemesTable.stored })
    .from(firmReportThemesTable)
    .where(eq(firmReportThemesTable.firmId, firmId))
    .orderBy(asc(firmReportThemesTable.createdAt));
  const themes: ThemeRow[] = [];
  for (const r of rows) {
    const stored = parseStoredTheme(r.stored);
    // A row that no longer parses (schema moved on) is skipped, not fatal — the
    // listing must always load so the firm can delete or replace it.
    if (!stored) { logger.warn({ firmId, themeId: r.id }, "report_themes.row_invalid"); continue; }
    themes.push({ id: r.id, name: r.name, isDefault: r.id === firm?.defaultId, createdAt: r.createdAt.toISOString(), stored });
  }
  const legacy = themes.length === 0 && classifyStoredTemplate(firm?.legacyRow) === "legacy";
  return { themes, legacy };
}

export async function getFirmTheme(firmId: string, id: string): Promise<ThemeRow | null> {
  if (!isUuid(id)) return null;
  const [r] = await db
    .select({ id: firmReportThemesTable.id, name: firmReportThemesTable.name, createdAt: firmReportThemesTable.createdAt, stored: firmReportThemesTable.stored })
    .from(firmReportThemesTable)
    .where(and(eq(firmReportThemesTable.firmId, firmId), eq(firmReportThemesTable.id, id)))
    .limit(1);
  if (!r) return null;
  const stored = parseStoredTheme(r.stored);
  if (!stored) return null;
  return { id: r.id, name: r.name, isDefault: (await firmDefaultId(firmId)) === r.id, createdAt: r.createdAt.toISOString(), stored };
}

/** Insert a theme; the firm's first theme becomes its default. */
export async function createFirmTheme(firmId: string, name: string, stored: StoredTheme): Promise<ThemeRow> {
  const [row] = await db
    .insert(firmReportThemesTable)
    .values({ firmId, name, stored })
    .returning({ id: firmReportThemesTable.id, name: firmReportThemesTable.name, createdAt: firmReportThemesTable.createdAt });
  if (!row) throw new Error("theme insert returned no row");
  let isDefault = false;
  if ((await firmDefaultId(firmId)) === null) {
    await db.update(firmsTable).set({ defaultReportThemeId: row.id }).where(eq(firmsTable.id, firmId));
    isDefault = true;
  }
  return { id: row.id, name: row.name, isDefault, createdAt: row.createdAt.toISOString(), stored };
}

export async function renameFirmTheme(firmId: string, id: string, name: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db
    .update(firmReportThemesTable)
    .set({ name })
    .where(and(eq(firmReportThemesTable.firmId, firmId), eq(firmReportThemesTable.id, id)))
    .returning({ id: firmReportThemesTable.id });
  return rows.length > 0;
}

export async function setDefaultFirmTheme(firmId: string, id: string): Promise<boolean> {
  if (!(await getFirmTheme(firmId, id))) return false;
  await db.update(firmsTable).set({ defaultReportThemeId: id }).where(eq(firmsTable.id, firmId));
  return true;
}

/**
 * Delete a theme. The FKs are SET NULL on production (migrate.mjs declares
 * them), but a database pushed straight from the drizzle schema has plain
 * uuid columns, so the references are cleared explicitly as well.
 */
export async function deleteFirmTheme(firmId: string, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  return db.transaction(async (tx) => {
    const rows = await tx
      .delete(firmReportThemesTable)
      .where(and(eq(firmReportThemesTable.firmId, firmId), eq(firmReportThemesTable.id, id)))
      .returning({ id: firmReportThemesTable.id });
    if (rows.length === 0) return false;
    await tx.update(tisProjectsTable).set({ reportThemeId: null }).where(and(eq(tisProjectsTable.firmId, firmId), eq(tisProjectsTable.reportThemeId, id)));
    await tx.update(firmsTable).set({ defaultReportThemeId: null }).where(and(eq(firmsTable.id, firmId), eq(firmsTable.defaultReportThemeId, id)));
    return true;
  });
}

/** The theme a render should use: the project's, else the firm default, else null. */
export async function resolveProjectTheme(firmId: string, projectThemeId: string | null | undefined): Promise<StoredTheme | null> {
  if (isUuid(projectThemeId)) {
    const own = await getFirmTheme(firmId, projectThemeId);
    if (own) return own.stored;
    logger.warn({ firmId, themeId: projectThemeId }, "report_themes.project_theme_missing");
  }
  const defaultId = await firmDefaultId(firmId);
  if (!defaultId) return null;
  const def = await getFirmTheme(firmId, defaultId);
  return def?.stored ?? null;
}
