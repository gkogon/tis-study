// Regression check for trip-generation rate AUDITABILITY.
//
// Why this exists: the report printed trip TOTALS and a provenance TAG
// ("Public data — SANDAG 2002 …") but never the rate itself, so a reviewing PE
// could not perform the first check a review desk performs — does rate × size
// equal the trips you claim? An unreproducible number reads as an inaccurate
// number, which is how an auditability gap gets reported as an accuracy gap.
//
// Under test:
//   1. appliedRateRows() emits rate × size rows plus the source citation.
//   2. It emits NOTHING for payloads stored before the rates were carried —
//      stored studies re-render through the same path (/projects/:id/pdf) and
//      must not sprout blank rows.
//   3. The new fields SURVIVE GenerateTisResponse validation. This is the
//      PR #74 trap: a field absent from openapi.yaml is silently stripped by
//      the generated zod parse layer, which is exactly how the LOS-F-with-
//      0-delay bug shipped. If codegen was not re-run, this assert fails.
//   4. The land-use list endpoint's response schema carries provenance, so the
//      picker can show where a rate comes from.
//
// Run: node ./scripts/verify-rate-auditability.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const { appliedRateRows } = await import(path.resolve(here, "../src/lib/trip-rate-rows.ts"));
const { GenerateTisResponse, ListTisLandUsesResponse } = await import(
  path.resolve(here, "../../../lib/tis-api-zod/src/generated/api.ts")
);

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };
const label = (rows, name) => rows.find((r) => r[0] === name)?.[1];

// --- 1. Rates present → auditable rows -----------------------------------
{
  const tg = {
    size: 280, unit: "dwelling units", unitShort: "du",
    dailyRate: 7.32, amRate: 0.46, pmRate: 0.56,
    variableSource: "SANDAG 2002 vehicular traffic generation guide",
  };
  const rows = appliedRateRows(tg);
  ok(rows.length === 4, `four rows emitted (3 rates + source), got ${rows.length}`);
  ok(label(rows, "Daily rate applied") === "7.32 trips per du × 280 du",
    `daily row spells out rate × size: ${label(rows, "Daily rate applied")}`);
  ok(label(rows, "PM peak rate applied") === "0.56 trips per du × 280 du",
    `pm row spells out rate × size: ${label(rows, "PM peak rate applied")}`);
  ok(label(rows, "Rate source") === "SANDAG 2002 vehicular traffic generation guide",
    "source citation is carried verbatim");

  // The whole point: a reviewer can reproduce the total from the printed row.
  const reproduced = Math.round(tg.pmRate * tg.size);
  ok(reproduced === 157, `rate × size reproduces the PM total by hand (${reproduced})`);
}

// --- 2. Legacy payloads stay byte-identical -------------------------------
{
  const legacy = { size: 280, unitShort: "du", variableConfidence: "sandag_2002" };
  ok(appliedRateRows(legacy).length === 0,
    "pre-change payload (no rates) emits zero rows — stored studies re-render unchanged");
  ok(appliedRateRows({}).length === 0, "empty payload emits zero rows");
  ok(appliedRateRows(undefined).length === 0, "undefined payload emits zero rows");
}

// --- 3. Partial payloads degrade gracefully -------------------------------
{
  const partial = { size: 12, unitShort: "ksf", pmRate: 3.81 };
  const rows = appliedRateRows(partial);
  ok(rows.length === 1 && label(rows, "PM peak rate applied") === "3.81 trips per ksf × 12 ksf",
    "only the rates actually present are emitted");
  const noSize = appliedRateRows({ unitShort: "ksf", pmRate: 3.81 });
  ok(noSize.length === 1 && noSize[0][1] === "3.81 trips per ksf",
    "missing size → rate alone, no '× NaN'");
}

// --- 4. Fields survive the generated zod parse (the PR #74 trap) ----------
{
  const payload = {
    tripGeneration: {
      landUseCode: "221", landUseName: "Multifamily Housing (Mid-Rise)",
      size: 280, unit: "dwelling units", unitShort: "du",
      variableConfidence: "sandag_2002",
      dailyRate: 7.32, amRate: 0.46, pmRate: 0.56,
      variableSource: "SANDAG 2002 vehicular traffic generation guide",
      dailyTrips: 2050, amPeakTrips: 129, pmPeakTrips: 157,
      amIn: 32, amOut: 97, pmIn: 98, pmOut: 59,
    },
  };
  const parsed = GenerateTisResponse.partial().parse(payload);
  const tg = parsed.tripGeneration ?? {};
  ok(tg.dailyRate === 7.32, "dailyRate survives GenerateTisResponse validation (not stripped)");
  ok(tg.amRate === 0.46, "amRate survives GenerateTisResponse validation (not stripped)");
  ok(tg.pmRate === 0.56, "pmRate survives GenerateTisResponse validation (not stripped)");
  ok(tg.variableSource === "SANDAG 2002 vehicular traffic generation guide",
    "variableSource survives GenerateTisResponse validation (not stripped)");
}

// --- 5. Land-use list carries provenance to the picker -------------------
{
  const list = ListTisLandUsesResponse.parse([{
    code: "221", name: "Multifamily Housing (Mid-Rise)",
    unit: "dwelling units", unitShort: "du",
    dailyRate: 7.32, amRate: 0.46, pmRate: 0.56,
    confidence: "sandag_2002",
    source: "SANDAG 2002 vehicular traffic generation guide",
  }]);
  ok(list[0]?.source === "SANDAG 2002 vehicular traffic generation guide",
    "list endpoint response keeps `source` (was projected away)");
  ok(list[0]?.confidence === "sandag_2002", "list endpoint response keeps `confidence`");
}

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
