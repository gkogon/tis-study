/**
 * Compute aadtPct (signals snapped to measured AADT) per metro from the
 * per-region `<slug>-aadt.json` files produced by fetch-aadt-by-signal.ts.
 *
 * Used to refresh the `aadtPct` column in atlanta-tis/src/data/metro-coverage.ts
 * after an AADT sweep.
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/compute-aadt-stats.ts > /tmp/aadt-stats.json
 *   pnpm --filter @workspace/scripts exec tsx src/compute-aadt-stats.ts <slug> [<slug>...]
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../../artifacts/api-server/src/data");

const args = process.argv.slice(2);

// Discover all metros from the signals files if no specific slugs given.
function discoverSlugs(): string[] {
  return readdirSync(DATA_DIR)
    .filter((f: string) => f.endsWith("-signals.json"))
    .map((f: string) => f.replace(/-signals\.json$/, ""))
    .sort();
}

const slugs = args.length > 0 ? args : discoverSlugs();

const out: Record<string, { signals: number; snapped: number; aadtPct: number }> = {};
for (const slug of slugs) {
  const signalsPath = resolve(DATA_DIR, `${slug}-signals.json`);
  const aadtPath = resolve(DATA_DIR, `${slug}-aadt.json`);
  if (!existsSync(signalsPath)) continue;
  const signals = JSON.parse(readFileSync(signalsPath, "utf8")) as unknown[];
  const total = signals.length;
  let snapped = 0;
  if (existsSync(aadtPath)) {
    const aadt = JSON.parse(readFileSync(aadtPath, "utf8")) as Record<string, unknown>;
    snapped = Object.keys(aadt).length;
  }
  const aadtPct = total === 0 ? 0 : Math.round((snapped / total) * 1000) / 10;
  out[slug] = { signals: total, snapped, aadtPct };
  console.error(`${slug.padEnd(22)} ${String(snapped).padStart(6)} / ${String(total).padStart(6)}  →  ${aadtPct.toFixed(1).padStart(5)}%`);
}

process.stdout.write(JSON.stringify(out, null, 2) + "\n");
