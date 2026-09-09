// Regression check for MITIGATION VERDICT SCOPE and threshold attribution.
//
// Why this exists: a Datum proofread pass found a study whose verdict read
// "no mitigation required; threshold 5s" and whose headline read "worst delay
// delta 1.2 s" — while the same study printed a 2.0 s design-year delta that
// had never been tested against any threshold. Three defects:
//
//   1. recommendMitigation() was called with the OPENING-YEAR delta only
//      (afterDelay - beforeDelay). designBuild - designNoBuild was never
//      tested. The design-year delta is routinely the LARGER of the two,
//      because two decades of background growth sit underneath it.
//   2. The threshold was a hardcoded literal and the verdict text read
//      "below the City's 5-second TIS threshold" — naming a city that is
//      never resolved anywhere in the call path.
//   3. The headline aggregates were computed from the opening year and
//      reported unscoped, contradicting design-year values printed in the
//      same document.
//
// Under test:
//   1. recommendMitigation takes a LIST of horizons, not a single delta.
//   2. The call site passes the design year when one was analyzed.
//   3. Thresholds are named constants, not literals.
//   4. The no-mitigation verdict claims no agency attribution, and says the
//      screen runs no v/c test and no already-failing-approach clause.
//   5. No verdict text names "the City".
//   6. worstDelayDeltaDesignSec reaches the response (not stripped by zod)
//      and is documented as the design-year companion.
//
// Run: node ./scripts/verify-mitigation-scope.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);
const { GenerateTisResponse } = await import(
  path.resolve(here, "../../../lib/tis-api-zod/src/generated/api.ts")
);
const tis = readFileSync(path.resolve(here, "../src/lib/tis.ts"), "utf8");
const spec = readFileSync(path.resolve(here, "../../../lib/tis-api-spec/openapi.yaml"), "utf8");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// --- 1 + 2. Every analyzed horizon is tested -----------------------------
ok(/function recommendMitigation\(\s*horizons: MitigationHorizon\[\],/.test(tis),
  "recommendMitigation takes a list of horizons");
ok(!/recommendMitigation\(afterDelay - beforeDelay/.test(tis),
  "call site no longer passes the opening-year delta alone");
ok(/label: "design year", delta: designBuildDelay - designNoBuildDelay/.test(tis),
  "call site tests the design-year delta when a design year was analyzed");

// --- 3. Thresholds are named, not literal --------------------------------
ok(/export const SCREENING_DELAY_DELTA_MINOR_SEC = 5;/.test(tis)
  && /export const SCREENING_DELAY_DELTA_MODERATE_SEC = 15;/.test(tis),
  "screening thresholds are named constants");
ok(!/delayDelta >= 5 \|\|/.test(tis), "the 5-second literal is gone from the branch test");

// --- 4 + 5. Honest attribution -------------------------------------------
ok(!/the City's/.test(tis), "no verdict text names an unresolved \"City\"");
ok(/a screening default, not an agency criterion/.test(tis),
  "the no-mitigation verdict states it is a screening default, not an agency criterion");
ok(/v\/c test and a separate clause for approaches already failing in the no-build/.test(tis),
  "the verdict discloses the two criteria this screen does not run");

// --- 6. Headline is reconcilable -----------------------------------------
{
  const shape = GenerateTisResponse._def.shape ? GenerateTisResponse._def.shape() : GenerateTisResponse.shape;
  ok("worstDelayDeltaDesignSec" in shape,
    "worstDelayDeltaDesignSec survives GenerateTisResponse validation");
  ok(shape.worstDelayDeltaDesignSec?.isOptional?.() === true,
    "worstDelayDeltaDesignSec is optional — studies with no design year still validate");
  ok(/in the OPENING YEAR only\. Scoped, not absolute/.test(spec),
    "spec documents worstDelayDeltaSec as opening-year scoped");
  ok(/Largest projected delay change: /.test(tis),
    "the summary reconciles the opening-year and design-year headline figures");
}

console.log(fails === 0 ? "\nPASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
