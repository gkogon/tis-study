// Regression check for background-growth PROVENANCE.
//
// Why this exists: a Datum proofread pass found a metro-Atlanta study grown at
// 1.5%/yr while the engine held a measured 0.92%/yr for that metro. Two
// separate defects made that invisible to a reviewer:
//
//   1. `measuredRate` was set to undefined whenever `req.growthRatePct` was
//      supplied, and `growthSource` was only emitted when `measuredRate` was
//      set. An overridden study therefore printed its growth figure with NO
//      provenance at all, while the engine held a cited rate it had not used.
//
//   2. `growthSource` was never in openapi.yaml, so the generated
//      GenerateTisResponse (a plain zod.object, unknownKeys "strip") dropped it
//      from EVERY response. Every `if (r.growthSource)` branch in every
//      renderer was dead code on the served path — no study had ever printed
//      growth provenance, measured or otherwise. This is the PR #74 trap:
//      a field absent from the spec is silently stripped by the zod layer.
//
// Under test:
//   1. growthSource SURVIVES GenerateTisResponse validation. If codegen was
//      not re-run after editing openapi.yaml, this assert fails.
//   2. It is OPTIONAL — payloads stored before the field existed re-render
//      through the same path and must not fail validation.
//   3. isGrowthOverride() identifies an overridden rate and only an overridden
//      rate.
//   4. The engine resolves the measured rate UNCONDITIONALLY, so an override
//      can name what it displaced.
//   5. No renderer claims a rate was "derived from measured" data without
//      first branching on isGrowthOverride — the measured wording is false for
//      an overridden rate, and printing it is worse than printing nothing.
//
// Run: node ./scripts/verify-growth-provenance.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);

const { GROWTH_OVERRIDE_PREFIX, isGrowthOverride } = await import(
  path.resolve(here, "../src/lib/regional-growth-rates.ts")
);
const { GenerateTisResponse } = await import(
  path.resolve(here, "../../../lib/tis-api-zod/src/generated/api.ts")
);

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// --- 1 + 2. growthSource survives validation, and is optional -------------
{
  const shape = GenerateTisResponse._def.shape ? GenerateTisResponse._def.shape() : GenerateTisResponse.shape;
  ok("growthSource" in shape, "growthSource is present in GenerateTisResponse (not stripped by the zod layer)");
  ok(shape.growthSource?.isOptional?.() === true,
    "growthSource is OPTIONAL — pre-existing stored payloads still validate");
}

// --- 3. The override predicate -------------------------------------------
{
  ok(isGrowthOverride(`${GROWTH_OVERRIDE_PREFIX} — 1.50%/yr was supplied with the request.`),
    "isGrowthOverride() is true for an override citation");
  ok(!isGrowthOverride("Atlanta Regional Commission Open Data Hub — GDOT Traffic Counts — median per-segment CAGR"),
    "isGrowthOverride() is false for a measured citation");
  ok(!isGrowthOverride(undefined) && !isGrowthOverride(null) && !isGrowthOverride(""),
    "isGrowthOverride() is false for absent provenance");
}

// --- 4. The engine resolves the measured rate unconditionally ------------
{
  const tis = readFileSync(path.resolve(here, "../src/lib/tis.ts"), "utf8");
  ok(/const measuredRate = getMeasuredGrowthRate\(region\.code\);/.test(tis),
    "engine resolves the measured rate unconditionally");
  ok(!/const measuredRate = req\.growthRatePct === undefined \?/.test(tis),
    "engine no longer suppresses the measured rate when an override is supplied");
  ok(/growthIsOverride/.test(tis) && tis.includes("GROWTH_OVERRIDE_PREFIX"),
    "engine emits an override-tagged growthSource");
}

// --- 5. No renderer claims "measured" without guarding on the override ----
{
  const files = ["pdf-export.ts", "pdf-export-states.ts", "pdf-export-ny.ts", "pdf-export-carolinas.ts"];
  for (const f of files) {
    const src = readFileSync(path.resolve(here, "../src/lib", f), "utf8");
    const claims = [...src.matchAll(/derived from (?:the )?measured per-segment compound annual growth/g)];
    let unguarded = 0;
    for (const m of claims) {
      // The claim must sit inside an isGrowthOverride(...) ternary. Look back
      // far enough to cover the guard plus the override branch that precedes it.
      if (!src.slice(Math.max(0, m.index - 1400), m.index).includes("isGrowthOverride(")) unguarded++;
    }
    ok(unguarded === 0,
      `${f}: ${claims.length} measured-derivation claim(s), ${unguarded} unguarded by isGrowthOverride()`);
  }
}

console.log(fails === 0 ? "\nPASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
