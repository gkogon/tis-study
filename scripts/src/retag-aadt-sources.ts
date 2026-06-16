/**
 * One-shot retag pass for the `<slug>-aadt.json` per-signal AADT
 * files. Fixes a long-standing metadata bug introduced when
 * fetch-aadt-by-signal.ts added the polyline_bbox / point_bbox
 * generic handlers: the `PolylineBboxConfig.sourceTag` / `PointBboxConfig.
 * sourceTag` enums were locked to `"fdot" | "ncdot"`, so every new
 * state DOT wired through those generic handlers silently labeled
 * its output records `source: "fdot"` (or "ncdot") regardless of the
 * actual underlying DOT. Benign at runtime (regional-intersections
 * .ts never branched on `source`), misleading for any data-
 * provenance audit.
 *
 * This script walks every `<slug>-aadt.json` under
 * artifacts/api-server/src/data/ and rewrites records whose `source`
 * is the WRONG tag for the metro's actual DOT. Records that already
 * carry a meaningful source (synthetic_osm_class, fhwa_hpms_2018,
 * cdot_adt_portal, mlit_census_r3_2021, paris_opendata, etc.) are
 * left alone — they were never mistagged.
 *
 * Canonical source slugs align with `dataSourceId` in
 * artifacts/tis-api-server/src/lib/regions.ts and with the
 * sourceLabel adjacent to each polylineConfig in fetch-aadt-by-
 * signal.ts. So `chicago` now writes `source: "idot"`, `detroit`
 * writes `source: "mdot_mi"`, `new-york` writes `source: "nysdot"`,
 * etc.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/retag-aadt-sources.ts [--dry]
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const DATA_DIR = path.resolve(REPO_ROOT, "artifacts/api-server/src/data");
const DRY = process.argv.includes("--dry");

/**
 * Slug → canonical DOT source tag the metro's AADT JSON should carry
 * for records pulled from the state DOT layer. Derived from the
 * sourceLabel adjacent to each per-region config in
 * fetch-aadt-by-signal.ts and mirrored against
 * artifacts/tis-api-server/src/lib/regions.ts `dataSourceId`.
 */
const SLUG_TO_DOT: Record<string, string> = {
  // FDOT (correctly tagged before; included for completeness)
  tampa: "fdot",
  orlando: "fdot",
  "miami-dade": "fdot",
  jacksonville: "fdot",
  pensacola: "fdot",
  "fort-lauderdale": "fdot",
  "west-palm-beach": "fdot",
  "daytona-beach": "fdot",
  lakeland: "fdot",
  tallahassee: "fdot",
  "fort-myers": "fdot",
  // NCDOT (correctly tagged before)
  charlotte: "ncdot",
  "raleigh-durham": "ncdot",
  asheville: "ncdot",
  wilmington: "ncdot",
  triad: "ncdot",
  fayetteville: "ncdot",
  "greenville-nc": "ncdot",
  // TDOT (correctly tagged before)
  nashville: "tdot",
  memphis: "tdot",
  knoxville: "tdot",
  chattanooga: "tdot",
  // VDOT
  "hampton-roads": "vdot",
  richmond: "vdot",
  roanoke: "vdot",
  // SCDOT
  "charleston-sc": "scdot",
  "columbia-sc": "scdot",
  "greenville-sc": "scdot",
  // ── mistagged metros below: all wrote "fdot" or "ncdot" pre-fix ──
  // TxDOT
  houston: "txdot",
  austin: "txdot",
  dallas: "txdot",
  "fort-worth": "txdot",
  "san-antonio": "txdot",
  "el-paso": "txdot",
  "corpus-christi": "txdot",
  lubbock: "txdot",
  mcallen: "txdot",
  // ODOT-OK
  "oklahoma-city": "odot_ok",
  tulsa: "odot_ok",
  // PennDOT
  philadelphia: "penndot",
  pittsburgh: "penndot",
  harrisburg: "penndot",
  scranton: "penndot",
  allentown: "penndot",
  // MassDOT
  boston: "massdot",
  worcester: "massdot",
  "springfield-ma": "massdot",
  // INDOT
  indianapolis: "indot",
  "fort-wayne": "indot",
  "south-bend": "indot",
  evansville: "indot",
  // MoDOT
  "st-louis": "modot",
  "kansas-city": "modot",
  "springfield-mo": "modot",
  "columbia-mo": "modot",
  // MDOT-SHA
  baltimore: "mdot_md",
  // DDOT
  "washington-dc": "ddot_dc",
  // Caltrans
  "los-angeles": "caltrans",
  "san-francisco": "caltrans",
  "san-diego": "caltrans",
  sacramento: "caltrans",
  "san-jose": "caltrans",
  oakland: "caltrans",
  "long-beach": "caltrans",
  anaheim: "caltrans",
  fresno: "caltrans",
  bakersfield: "caltrans",
  // NDOT
  "las-vegas": "nvdot",
  reno: "nvdot",
  // CDOT-CO
  denver: "cdot_co",
  "colorado-springs": "cdot_co",
  // ODOT-OR
  portland: "odot_or",
  // WSDOT
  seattle: "wsdot",
  tacoma: "wsdot",
  spokane: "wsdot",
  // UDOT
  "salt-lake-city": "udot",
  provo: "udot",
  // NMDOT
  albuquerque: "nmdot",
  "santa-fe": "nmdot",
  // Nebraska DOT
  omaha: "ndor",
  lincoln: "ndor",
  // NDDOT
  fargo: "nddot",
  bismarck: "nddot",
  // MDT
  billings: "mdt",
  "great-falls": "mdt",
  missoula: "mdt",
  // IDOT
  chicago: "idot",
  "springfield-il": "idot",
  rockford: "idot",
  peoria: "idot",
  champaign: "idot",
  // MDOT-MI
  detroit: "mdot_mi",
  "grand-rapids": "mdot_mi",
  lansing: "mdot_mi",
  "ann-arbor": "mdot_mi",
  // MnDOT
  "twin-cities": "mndot",
  duluth: "mndot",
  "rochester-mn": "mndot",
  // WisDOT
  milwaukee: "wisdot",
  madison: "wisdot",
  "green-bay": "wisdot",
  // NYSDOT
  "new-york": "nysdot",
  buffalo: "nysdot",
  "rochester-ny": "nysdot",
  albany: "nysdot",
  syracuse: "nysdot",
  // CTDOT
  hartford: "ctdot",
  "new-haven": "ctdot",
  bridgeport: "ctdot",
  // Small-state singletons
  manchester: "nhdot",
  "burlington-vt": "vtrans",
  "portland-me": "medot",
  trenton: "njdot",
  "charleston-wv": "wvdot",
  providence: "ridot",
  "des-moines": "iadot",
  "cedar-rapids": "iadot",
  wichita: "ksdot",
  "sioux-falls": "sddot",
  boise: "itd",
  anchorage: "akdot",
  honolulu: "hidot",
  cheyenne: "wydot",
  // LaDOTD / RPC
  "new-orleans": "ladotd",
  "lake-charles": "ladotd",
  "baton-rouge": "ladotd",
  // ALDOT
  birmingham: "aldot",
  mobile: "aldot",
  montgomery: "aldot",
  huntsville: "aldot",
  // GDOT (Atlanta wires through dedicated 511 path; non-ATL through generic GDOT layer)
  atlanta: "gdot_511",
  savannah: "gdot_511",
  augusta: "gdot_511",
  "columbus-ga": "gdot_511",
  macon: "gdot_511",
  // KYTC
  louisville: "kytc",
  lexington: "kytc",
  // ARDOT
  "little-rock": "ardot",
  // MDOT-MS
  jackson: "mdot_ms",
  // Canada
  toronto: "mto",
  hamilton: "mto",
  edmonton: "ab_transportation",
  calgary: "ab_transportation",
  winnipeg: "mb_infrastructure",
  // Mexico (SICT federal mirror)
  "mexico-city": "sict",
  guadalajara: "sict",
  monterrey: "sict",
  puebla: "sict",
  tijuana: "sict",
  // UK (DfT)
  london: "dft",
  "birmingham-uk": "dft",
  "manchester-uk": "dft",
  glasgow: "dft",
  edinburgh: "dft",
  leeds: "dft",
  bristol: "dft",
  // Ohio (ODOT)
  akron: "odot_oh",
  cincinnati: "odot_oh",
  cleveland: "odot_oh",
  "columbus-oh": "odot_oh",
  dayton: "odot_oh",
  toledo: "odot_oh",
  youngstown: "odot_oh",
  // More PennDOT
  erie: "penndot",
  // Combined-metro slugs
  "dallas-fort-worth": "txdot",
  charlottesville: "vdot",
  // ODOT-OR
  eugene: "odot_or",
  "salem-or": "odot_or",
  // MDOT-MI
  flint: "mdot_mi",
  // CDOT-CO
  "fort-collins": "cdot_co",
  // Caltrans
  "inland-empire": "caltrans",
  modesto: "caltrans",
  oxnard: "caltrans",
  "sf-bay": "caltrans",
  stockton: "caltrans",
  // UDOT
  ogden: "udot",
  // Mexico
  juarez: "sict",
  // ADOT (Arizona)
  phoenix: "adot",
  tucson: "adot",
  // Ontario MTO
  ottawa: "mto",
};

/** Sources that already carry correct, specific provenance. Never overwrite. */
const PRESERVE: ReadonlySet<string> = new Set([
  "synthetic_osm_class",
  "fhwa_hpms_2018",
  "cdot_adt_portal",
  "mlit_census_r3_2021",
  "paris_opendata",
  "berlin_senat",
  "madrid_ayto",
  "toulouse_opendata",
  "bordeaux_opendata",
  "cerema_tmja_rrnc_2024",
  "toronto_open_data_svc",
  "polyline_bbox",
  "point_bbox",
]);

type AadtRec = { aadt: number; year: number; kFactor: number; distM: number; source: string };

function isMistaggedDotSlug(s: string): boolean {
  // Only the two original-enum values that got applied to everything.
  // PRESERVE-list strings, real DOT slugs, region-specific tags, EU/JP
  // overlays — all left alone.
  return s === "fdot" || s === "ncdot";
}

function main(): void {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith("-aadt.json"));
  let totalRecordsRetagged = 0;
  let metrosTouched = 0;
  const report: Array<{ slug: string; retagged: number; expected: string; from: Record<string, number> }> = [];

  for (const f of files) {
    const slug = f.replace(/-aadt\.json$/, "");
    const expected = SLUG_TO_DOT[slug];
    const fullPath = path.join(DATA_DIR, f);
    const data = JSON.parse(readFileSync(fullPath, "utf8")) as Record<string, AadtRec>;

    if (!expected) {
      // Unknown slug — no canonical DOT mapping. Skip silently unless
      // it contains any of the mistagged values, in which case warn.
      const stillBad = Object.values(data).filter((v) => isMistaggedDotSlug(v.source));
      if (stillBad.length > 0) {
        console.log(`  ? ${slug}: ${stillBad.length} record(s) still tagged fdot/ncdot — no canonical mapping known, leaving alone`);
      }
      continue;
    }

    // For metros where the canonical DOT IS "fdot" / "ncdot" (i.e.
    // real FL or NC metros), nothing to fix — the original tag is
    // correct. Skip cleanly.
    if (expected === "fdot" || expected === "ncdot") {
      // Sanity check: are there any non-PRESERVE, non-expected tags
      // bleeding in from a wrong fetcher run? Log if so.
      const odd = Object.values(data).filter(
        (v) => !PRESERVE.has(v.source) && v.source !== expected,
      );
      if (odd.length > 0) {
        console.log(`  ? ${slug}: ${odd.length} record(s) with non-expected source (expected ${expected})`);
      }
      continue;
    }

    let retagged = 0;
    const fromCounts: Record<string, number> = {};
    for (const k of Object.keys(data)) {
      const rec = data[k];
      if (PRESERVE.has(rec.source)) continue;
      if (rec.source === expected) continue;
      if (!isMistaggedDotSlug(rec.source)) continue;
      fromCounts[rec.source] = (fromCounts[rec.source] ?? 0) + 1;
      data[k] = { ...rec, source: expected };
      retagged++;
    }

    if (retagged > 0) {
      report.push({ slug, retagged, expected, from: fromCounts });
      metrosTouched++;
      totalRecordsRetagged += retagged;
      if (!DRY) writeFileSync(fullPath, JSON.stringify(data));
    }
  }

  report.sort((a, b) => b.retagged - a.retagged);
  console.log(`\n=== Retag pass ${DRY ? "(dry run)" : ""} ===`);
  for (const r of report) {
    const fromStr = Object.entries(r.from).map(([k, n]) => `${k}=${n}`).join(", ");
    console.log(`  ${r.slug.padEnd(24)} → ${r.expected.padEnd(20)} ${r.retagged.toString().padStart(6)} records  (was: ${fromStr})`);
  }
  console.log(`\nMetros touched: ${metrosTouched}`);
  console.log(`Total records retagged: ${totalRecordsRetagged}`);
  if (DRY) console.log("(dry — nothing written)");
}

main();
