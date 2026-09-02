// Regression check for SCENARIO LABEL INTEGRITY.
//
// Why this exists: the engine's field names do not mean what they say.
//   current*  = Existing — current-year volumes, NO growth applied
//   existing* = Opening-year NO-BUILD — existing volumes grown to opening year
//   future*   = Opening-year BUILD
//
// A Datum proofread pass reported a study whose "Existing" row read
// LOS B / 19.6 s / v/c 0.49 — which is the GROWN value. The PDF renderers
// were in fact correct (they read `currentLos ?? existingLos` for the
// Existing column). The mislabel was on two other surfaces:
//
//   1. The web UI printed `existingLos` / `existingVc` under headers reading
//      "Existing", "LOS now", and "Exist LOS" — no current* anywhere.
//   2. The API itself. The convention lived in a YAML `#` comment, which does
//      not reach the generated types or any consumer reading the schema. A
//      caller trusting the field name reads the opening-year no-build as
//      counted traffic — which is exactly what happened.
//
// This is the baseline every project impact is measured against, so a
// mislabel here is not cosmetic.
//
// Under test:
//   1. The spec DESCRIBES the convention on both existing* and current*, at
//      approach and intersection level.
//   2. The descriptions reached the generated types (i.e. codegen was re-run).
//   3. Every PDF renderer that prints a scenario LOS table reads current*, so
//      the Existing column cannot collapse to No-Build values.
//   4. No UI table header labels a scenario column "Existing"/"Exist".
//
// Run: node ./scripts/verify-scenario-labels.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.resolve(here, p), "utf8");

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// --- 1. The spec states the convention -----------------------------------
{
  const spec = read("../../../lib/tis-api-spec/openapi.yaml");
  const nb = (spec.match(/Opening-year NO-BUILD/g) ?? []).length;
  const ex = (spec.match(/True current-year baseline: existing volumes with NO growth/g) ?? []).length;
  ok(nb >= 5, `spec documents existing* as opening-year No-Build (${nb} field descriptions)`);
  ok(ex >= 2, `spec documents current* as the true Existing baseline (${ex} field descriptions)`);
  ok(/Renderers must label this "No-Build", never "Existing"/.test(spec),
    "spec states the labeling rule explicitly");
}

// --- 2. Codegen was re-run — descriptions reached the types --------------
{
  for (const f of ["tisAffectedIntersection.ts", "tisApproachImpact.ts"]) {
    const p = `../../../lib/tis-api-zod/src/generated/types/${f}`;
    ok(existsSync(path.resolve(here, p)) && /Opening-year NO-BUILD/.test(read(p)),
      `${f} carries the No-Build warning as JSDoc (codegen re-run)`);
  }
}

// --- 3. PDF renderers read current* for the Existing column --------------
{
  for (const f of ["pdf-export.ts", "pdf-export-states.ts", "pdf-export-ny.ts", "pdf-export-carolinas.ts"]) {
    const src = read(`../src/lib/${f}`);
    const usesCurrent = /\bcurrent(Los|DelaySec|Vc|VolumeVph)\b/.test(src);
    ok(usesCurrent, `${f} reads current* — the Existing column cannot collapse to No-Build`);
  }
}

// --- 4. No UI header labels a scenario column "Existing" -----------------
{
  const badHeader = /<th[^>]*>\s*(?:Existing|Exist)(?:\s+(?:vph|v\/c|LOS))?\s*<\/th>/g;
  for (const f of ["project-detail.tsx", "demo.tsx", "tis.tsx"]) {
    const p = `../../atlanta-tis/src/pages/${f}`;
    if (!existsSync(path.resolve(here, p))) { ok(false, `${f} not found`); continue; }
    const hits = [...read(p).matchAll(badHeader)].map((m) => m[0]);
    ok(hits.length === 0, `${f}: no scenario column headed "Existing"${hits.length ? ` — found ${JSON.stringify(hits)}` : ""}`);
  }
}

console.log(fails === 0 ? "\nPASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
