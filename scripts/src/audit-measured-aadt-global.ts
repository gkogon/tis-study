/**
 * Audit measured AADT coverage globally.
 *
 * For every <slug>-aadt.json, tally records by source. Output one row per
 * metro: total signals, measured count, measured %, distinct sources. Drives
 * the per-metro calibration plan: ≥50 measured signals on ≥2 OSM road classes
 * gets DIRECT calibration; everything else gets EXTRAPOLATED from a country
 * anchor or scaled region-group baseline.
 *
 * Read-only. Writes audit JSON to artifacts/api-server/src/data/per-metro-audit.json.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/audit-measured-aadt-global.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REGIONS } from "../../artifacts/tis-api-server/src/lib/regions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../artifacts/api-server/src/data");

const regionSlug = (code: string) => code.replace(/_metro$/, "").replace(/_/g, "-");

type AadtRec = { aadt: number; source: string };
type Audit = {
  code: string;
  slug: string;
  country: string | null;
  dataSourceId: string;
  total: number;
  measured: number;
  measuredPct: number;
  synthetic: number;
  sourceCounts: Record<string, number>;
};

function auditMetro(code: string, country: string | null, dataSourceId: string): Audit | null {
  const slug = regionSlug(code);
  const aadtPath = path.resolve(DATA_DIR, `${slug}-aadt.json`);
  if (!existsSync(aadtPath)) return null;
  let aadt: Record<string, AadtRec>;
  try {
    aadt = JSON.parse(readFileSync(aadtPath, "utf8"));
  } catch {
    return null;
  }
  const sourceCounts: Record<string, number> = {};
  let measured = 0, synthetic = 0;
  for (const rec of Object.values(aadt)) {
    if (!rec || typeof rec.source !== "string") continue;
    sourceCounts[rec.source] = (sourceCounts[rec.source] ?? 0) + 1;
    if (rec.source === "synthetic_osm_class") synthetic++;
    else measured++;
  }
  const total = measured + synthetic;
  return {
    code,
    slug,
    country,
    dataSourceId,
    total,
    measured,
    measuredPct: total ? Math.round((measured / total) * 1000) / 10 : 0,
    synthetic,
    sourceCounts,
  };
}

function main(): void {
  const audits: Audit[] = [];
  for (const region of Object.values(REGIONS)) {
    const a = auditMetro(region.code, region.country ?? null, region.dataSourceId ?? "?");
    if (a) audits.push(a);
  }

  // Also scan any -aadt.json file not bound to a region (shouldn't be, but log).
  const known = new Set(audits.map((a) => a.slug));
  const orphans: string[] = [];
  for (const f of readdirSync(DATA_DIR)) {
    if (!f.endsWith("-aadt.json")) continue;
    const slug = f.replace(/-aadt\.json$/, "");
    if (!known.has(slug)) orphans.push(slug);
  }
  if (orphans.length) console.log(`⚠ ${orphans.length} -aadt.json files without a region: ${orphans.slice(0, 10).join(", ")}${orphans.length > 10 ? "…" : ""}`);

  audits.sort((a, b) => a.measuredPct - b.measuredPct);

  // Buckets per the calibration plan.
  const under85 = audits.filter((a) => a.measuredPct < 85);
  const measuredEnough = audits.filter((a) => a.measured >= 50);
  const dryUnder85 = audits.filter((a) => a.measuredPct < 85 && a.measured < 50);
  const overlay = audits.filter((a) => a.measured > 0 && a.dataSourceId === "osm_only");

  console.log(`\n=== Global AADT audit (${audits.length} regions with -aadt.json) ===`);
  console.log(`  ${under85.length} regions under 85% measured`);
  console.log(`  ${measuredEnough.length} regions with ≥50 measured signals (direct-calibration candidates)`);
  console.log(`  ${dryUnder85.length} regions under 85% AND <50 measured (extrapolation needed)`);
  console.log(`  ${overlay.length} osm_only regions with a measured overlay (partial direct calibration)`);

  console.log(`\n=== Bottom 30 by measured% ===`);
  console.log(`code                                  country  ds          total   meas  meas%  sources`);
  for (const a of audits.slice(0, 30)) {
    const srcs = Object.keys(a.sourceCounts).filter((s) => s !== "synthetic_osm_class").slice(0, 2).join(",") || "—";
    console.log(`  ${a.code.padEnd(35)} ${(a.country ?? "—").padEnd(6)}  ${a.dataSourceId.padEnd(10)}  ${String(a.total).padStart(5)}  ${String(a.measured).padStart(5)}  ${String(a.measuredPct).padStart(5)}%  ${srcs}`);
  }

  console.log(`\n=== Direct-calibration candidates (≥50 measured) by measured% ascending ===`);
  console.log(`code                                  country  meas    meas%`);
  for (const a of measuredEnough.sort((x, y) => x.measuredPct - y.measuredPct).slice(0, 25)) {
    console.log(`  ${a.code.padEnd(35)} ${(a.country ?? "—").padEnd(6)}  ${String(a.measured).padStart(6)}  ${String(a.measuredPct).padStart(5)}%`);
  }

  writeFileSync(
    path.resolve(DATA_DIR, "per-metro-audit.json"),
    JSON.stringify(audits, null, 2),
  );
  console.log(`\nWrote audit to per-metro-audit.json (${audits.length} regions).`);
}

main();
