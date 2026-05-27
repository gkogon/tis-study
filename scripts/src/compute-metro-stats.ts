/**
 * Compute `signals` and `namedPct` per metro by running the same
 * regional-signal-naming pass that the API server uses at request time.
 *
 * Output goes to stdout as a JSON record keyed by slug; pipe to
 * tee /tmp/metro-stats.json to capture. Used to refresh the
 * `signals`/`namedPct` columns in atlanta-tis/src/data/metro-coverage.ts
 * after a Geofabrik-PBF re-ingestion.
 */

import { getSignalNamesForRegion } from "../../artifacts/api-server/src/lib/regional-signal-naming";
import { REGIONS, type RegionCode } from "../../artifacts/tis-api-server/src/lib/regions";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../../artifacts/api-server/src/data");

function slugOf(regionCode: string): string {
  return regionCode.replace(/_metro$/, "").replace(/_/g, "-");
}

const targets = (process.argv.slice(2) as RegionCode[]).filter((c) => REGIONS[c]);
const codes: RegionCode[] = targets.length > 0 ? targets : (Object.keys(REGIONS) as RegionCode[]);

const out: Record<string, { signals: number; namedPct: number }> = {};
for (const code of codes) {
  const slug = slugOf(code);
  const signalsPath = resolve(DATA_DIR, `${slug}-signals.json`);
  let signals: Array<[number, number, number, string | null, number]>;
  try {
    signals = JSON.parse(readFileSync(signalsPath, "utf8"));
  } catch {
    console.error(`! ${slug}: no signals file`);
    continue;
  }
  const names = getSignalNamesForRegion(code);
  let named = 0;
  for (const [osmId, , , embeddedName] of signals) {
    if (embeddedName && embeddedName.trim() !== "") {
      named++;
      continue;
    }
    if (osmId < 0) continue;
    if (names.has(osmId)) named++;
  }
  const total = signals.length;
  const namedPct = total === 0 ? 0 : Math.round((named / total) * 1000) / 10;
  out[slug] = { signals: total, namedPct };
  console.error(`${slug.padEnd(20)} signals=${String(total).padStart(6)} namedPct=${namedPct.toFixed(1)}`);
}

process.stdout.write(JSON.stringify(out, null, 2) + "\n");
