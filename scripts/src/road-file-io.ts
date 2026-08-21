/**
 * Gzip-aware access to the per-region road files in api-server/src/data.
 *
 * Road files exist in two on-disk forms: raw `<slug>-roads.json` and
 * gzip-compressed `<slug>-roads.json.gz`. The residential refetch grows the
 * corpus from ~1.06GB to a projected ~3.4GB raw — past GitHub's 100MB
 * per-file hard limit for the statewide regions — so new files land as .gz
 * (fetch-osm-roads.ts writes .gz natively; gzip-roads.ts converts existing
 * files). Every script that touches a road file must therefore resolve BOTH
 * extensions, .gz preferred, or gz-only regions silently look absent —
 * which for existsSync-gated pipelines means regions get skipped without a
 * single error line.
 *
 * Signals/AADT files are small and stay raw JSON; this module is only for
 * road files and generic maybe-gz JSON IO.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync, gunzipSync, constants as zlibConstants } from "node:zlib";
import path from "node:path";

/**
 * Resolve the on-disk road file for a slug: `<slug>-roads.json.gz` when it
 * exists, else `<slug>-roads.json`, else null.
 */
export function resolveRoadFile(dataDir: string, slug: string): string | null {
  const gz = path.resolve(dataDir, `${slug}-roads.json.gz`);
  if (existsSync(gz)) return gz;
  const raw = path.resolve(dataDir, `${slug}-roads.json`);
  if (existsSync(raw)) return raw;
  return null;
}

/** True when the region has a road file in either form. */
export function roadFileExists(dataDir: string, slug: string): boolean {
  return resolveRoadFile(dataDir, slug) !== null;
}

/** Read + parse a JSON file, gunzipping first when the path ends in .gz. */
export function readJsonMaybeGz<T>(filePath: string): T {
  const buf = readFileSync(filePath);
  const text = filePath.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  return JSON.parse(text) as T;
}

/**
 * Serialize + write JSON to `filePath`, gzip -9 when the path ends in .gz.
 * Used by read-modify-write flows (extend-region-coverage.ts) so a file is
 * always written back in the same format it was read from.
 */
export function writeJsonMaybeGz(filePath: string, value: unknown): void {
  const text = JSON.stringify(value);
  if (filePath.endsWith(".gz")) {
    writeFileSync(filePath, gzipSync(Buffer.from(text, "utf8"), { level: zlibConstants.Z_BEST_COMPRESSION }));
  } else {
    writeFileSync(filePath, text);
  }
}

/** gzip -9 equivalent for road JSON payloads. */
export function gzipJson(text: string | Buffer): Buffer {
  const buf = typeof text === "string" ? Buffer.from(text, "utf8") : text;
  return gzipSync(buf, { level: zlibConstants.Z_BEST_COMPRESSION });
}
