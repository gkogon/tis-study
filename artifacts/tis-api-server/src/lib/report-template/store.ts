/**
 * Per-firm theme store (filesystem mirror of `firms.report_template`).
 * The DB column is authoritative; this exists for DB-less local dev.
 * Point `TEMPLATE_STORE_DIR` at a persistent volume if you rely on it.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseStoredTheme, StoredThemeSchema, type StoredTheme } from "../report-theme/theme";

const STORE_DIR = process.env.TEMPLATE_STORE_DIR ?? path.resolve(process.cwd(), "data", "templates");

function fileFor(firmId: string): string {
  const safe = String(firmId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(STORE_DIR, `${safe}.json`);
}

export function saveFirmTheme(firmId: string, stored: StoredTheme): void {
  StoredThemeSchema.parse(stored);
  mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(fileFor(firmId), JSON.stringify(stored), "utf8");
}

export function loadFirmTheme(firmId: string): StoredTheme | null {
  try {
    const f = fileFor(firmId);
    if (!existsSync(f)) return null;
    return parseStoredTheme(JSON.parse(readFileSync(f, "utf8")));
  } catch {
    return null;
  }
}

export function clearFirmTheme(firmId: string): void {
  try { rmSync(fileFor(firmId), { force: true }); } catch { /* best effort */ }
}
