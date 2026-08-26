// Precompute the signal-naming pass into committed sidecar files.
//
// getSignalNamesForRegion() is a pure function of two committed inputs
// (<slug>-roads.json[.gz] + <slug>-signals.json), but computing it live
// parses the whole road file and grid-scans every signal. For metro regions
// that is tens of ms–seconds; for the statewide files it is fatal — georgia
// took ~140s and >1GB of Segment allocations post-residential-refetch, while
// the TIS engine's inventory fetch gives the analyzer 30s. First-touch
// studies at rural (statewide-region) sites therefore failed outright.
//
// This script runs the exact same pass offline and writes
// <slug>-signal-names.json, which getSignalNamesForRegion() prefers when
// present. REGENERATE the sidecar whenever a region's roads or signals file
// is refetched (the roads refetch runbook is the usual trigger).
//
// Usage:
//   node ./scripts/generate-signal-names.mjs florida_statewide georgia_statewide south_carolina_statewide
//   node ./scripts/generate-signal-names.mjs --all-existing   # refresh every region that already has a sidecar
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "../../tis-api-server/scripts/ts-loader.mjs")).href, import.meta.url);

const naming = await import(path.resolve(here, "../src/lib/regional-signal-naming.ts"));
const dataDir = path.resolve(here, "../src/data");

const slugFor = (code) => code.replace(/_metro$/, "").replace(/_/g, "-");

let codes = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (process.argv.includes("--all-existing")) {
  const suffix = "-signal-names.json";
  codes = readdirSync(dataDir)
    .filter((f) => f.endsWith(suffix))
    .map((f) => f.slice(0, -suffix.length).replace(/-/g, "_") + "_metro")
    .map((c) => (c.endsWith("_statewide_metro") ? c.replace(/_metro$/, "") : c));
}
if (codes.length === 0) {
  console.error("Usage: node ./scripts/generate-signal-names.mjs <region_code>... | --all-existing");
  process.exit(2);
}

for (const code of codes) {
  const slug = slugFor(code);
  const out = path.join(dataDir, `${slug}-signal-names.json`);
  const t0 = Date.now();
  // computeSignalNamesForRegion is sidecar-blind: always the live pass, so
  // regeneration can never freeze a stale sidecar's names back into itself.
  const names = naming.computeSignalNamesForRegion(code);
  const rows = [...names.entries()].map(([id, r]) => [id, r.name, r.roadClassCode]);
  rows.sort((a, b) => a[0] - b[0]);
  writeFileSync(out, JSON.stringify({ region: code, names: rows }), "utf8");
  console.log(`${code}: ${rows.length} names in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${path.basename(out)}`);
}
