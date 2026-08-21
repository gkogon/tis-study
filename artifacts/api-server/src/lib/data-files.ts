/**
 * Shared on-disk access for the per-region datasets in src/data.
 *
 * Three modules (regional-roads.ts, regional-signal-naming.ts,
 * atlanta-data.ts) used to carry their own copy of the same 4-candidate
 * path probe. This module unifies them AND adds transparent gzip support:
 * for any `<name>.json` request, a `<name>.json.gz` twin in the same
 * candidate directory is preferred and gunzipped on read.
 *
 * Why gzip: the 316 `<slug>-roads.json` files dominate the repo/image at
 * ~1.06GB raw today and ~3.4GB after the residential refetch; gzip -9 holds
 * them at ~20-24% of raw and keeps the largest (florida-statewide) under
 * GitHub's 100MB per-file hard limit. Callers never see the difference —
 * they get parsed JSON either way.
 *
 * Preference order: directory priority FIRST (bundled dist data beats dev
 * src data, exactly as before), then .gz over .json within a directory.
 * A .gz in a lower-priority directory never shadows a .json in a
 * higher-priority one.
 */
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Candidate locations for a data file, in priority order.
 * In dev (tsx) __dirname = src/lib, so ../data hits src/data.
 * In prod (esbuild bundled dist/index.mjs) __dirname = dist/, so data/
 * is the sibling that build.mjs copies src/data into.
 */
function candidates(filename: string): string[] {
  return [
    resolve(__dirname, `data/${filename}`),
    resolve(__dirname, `../data/${filename}`),
    resolve(process.cwd(), `artifacts/api-server/dist/data/${filename}`),
    resolve(process.cwd(), `artifacts/api-server/src/data/${filename}`),
  ];
}

/**
 * Resolve `filename` (a .json name) to an on-disk path, preferring the
 * gzip twin `<filename>.gz` within each candidate directory. Returns null
 * when neither form exists anywhere.
 */
export function findDataFile(filename: string): string | null {
  for (const p of candidates(filename)) {
    const gz = `${p}.gz`;
    if (existsSync(gz)) return gz;
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Read + parse a JSON file that may be gzip-compressed (by extension).
 * Throws on unreadable/undecodable/unparseable input — callers that want
 * fail-soft behaviour keep their own try/catch, same as before.
 */
export function readJsonMaybeGz(filePath: string): unknown {
  const buf = readFileSync(filePath);
  const text = filePath.endsWith(".gz") ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
  return JSON.parse(text);
}

/**
 * Find and parse a data file in one step. Throws when the file exists in
 * no candidate location — matching the old throwing findData copies.
 */
export function readDataJson<T>(filename: string): T {
  const p = findDataFile(filename);
  if (!p) throw new Error(`Data file not found: ${filename}`);
  return readJsonMaybeGz(p) as T;
}
