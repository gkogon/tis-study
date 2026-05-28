/**
 * Sync Tier-10 (global) metro signal counts from JSON data files
 * into artifacts/atlanta-tis/src/data/metro-coverage.ts.
 *
 * For each Tier-10 region (osm_only data source), reads
 * artifacts/api-server/src/data/<slug>-signals.json, counts entries,
 * and updates the `signals: <n>` field in the matching METROS row.
 *
 * Idempotent — re-running over partial fetches just updates whatever
 * the data dir currently contains.
 *
 * Run:  pnpm --filter @workspace/scripts exec tsx src/sync-tier10-counts.ts
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS } from "../../artifacts/tis-api-server/src/lib/regions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const COVERAGE_PATH = path.resolve(REPO_ROOT, "artifacts/atlanta-tis/src/data/metro-coverage.ts");

function regionSlug(code: string): string {
  return code.replace(/_metro$/, "").replace(/_/g, "-");
}

function countSignalsFor(slug: string): number | null {
  const file = path.resolve(DATA_DIR, `${slug}-signals.json`);
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data.length;
    return null;
  } catch {
    return null;
  }
}

function namedPctFor(slug: string): number {
  const file = path.resolve(DATA_DIR, `${slug}-signals.json`);
  if (!existsSync(file)) return 0;
  try {
    const raw = readFileSync(file, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data) || data.length === 0) return 0;
    const named = data.filter((row) => Array.isArray(row) && row[3] != null).length;
    return Math.round((named / data.length) * 1000) / 10;
  } catch {
    return 0;
  }
}

function main(): void {
  const tier10 = Object.values(REGIONS).filter((r) => r.dataSourceId === "osm_only");
  console.log(`Tier-10 regions: ${tier10.length}`);

  let coverage = readFileSync(COVERAGE_PATH, "utf8");
  let updated = 0;
  let withData = 0;

  for (const region of tier10) {
    const slug = regionSlug(region.code);
    const signals = countSignalsFor(slug);
    if (signals === null) {
      console.log(`  - ${region.code}: no data file yet`);
      continue;
    }
    withData++;
    const named = namedPctFor(slug);

    // Match the one-liner row for this code and update signals + namedPct.
    const pattern = new RegExp(
      `(\\{ code: "${region.code}",[^}]*?signals:\\s*)(\\d+)(,\\s*namedPct:\\s*)([0-9.]+)`,
    );
    if (!pattern.test(coverage)) {
      console.log(`  ! ${region.code}: pattern miss (regex didn't match)`);
      continue;
    }
    const before = coverage;
    coverage = coverage.replace(pattern, `$1${signals}$3${named}`);
    if (coverage !== before) {
      updated++;
      console.log(`  ✓ ${region.code}: signals=${signals} named=${named}%`);
    } else {
      console.log(`  = ${region.code}: signals=${signals} named=${named}% (already current)`);
    }
  }

  writeFileSync(COVERAGE_PATH, coverage);
  console.log(`\n=== Synced ${updated} of ${withData} Tier-10 metros (of ${tier10.length} total) ===`);
}

main();
