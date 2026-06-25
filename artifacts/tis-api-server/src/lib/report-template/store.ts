/**
 * Per-firm template store.
 *
 * A firm uploads one example report (see the upload route) → it's ingested into
 * a `ReportTemplate` and saved here keyed by firm id. At render time the firm's
 * stored template wins over the region default, so every study a firm runs comes
 * out in their own imported format.
 *
 * Filesystem-backed by default (one JSON per firm); point `TEMPLATE_STORE_DIR`
 * at a persistent volume in production.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { ReportTemplate } from "./engine";
import { validateTemplate } from "./registry";

const STORE_DIR = process.env.TEMPLATE_STORE_DIR ?? path.resolve(process.cwd(), "data", "templates");

function fileFor(firmId: string): string {
  const safe = String(firmId).replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(STORE_DIR, `${safe}.json`);
}

export function saveFirmTemplate(firmId: string, tpl: ReportTemplate): void {
  validateTemplate(tpl);
  mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(fileFor(firmId), JSON.stringify(tpl, null, 2), "utf8");
}

export function loadFirmTemplate(firmId: string): ReportTemplate | null {
  try {
    const f = fileFor(firmId);
    if (!existsSync(f)) return null;
    return validateTemplate(JSON.parse(readFileSync(f, "utf8")));
  } catch {
    return null;
  }
}

export function hasFirmTemplate(firmId: string): boolean {
  return existsSync(fileFor(firmId));
}

export function listFirmTemplates(): string[] {
  try {
    return readdirSync(STORE_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}
