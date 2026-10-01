# Datum Proofread — Phase 1 (deterministic clauses) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a study is generated, an async proofread run produces deterministic findings the engineer reads, questions-free, on the project page — and can triage with a recorded disposition. No model call, no API key, no per-study cost.

**Architecture:** Pure clause functions read the saved `(requestPayload, resultPayload)` and return finding records; a runner claims a queued row from Postgres with a lease, persists findings and a per-clause coverage manifest, and read/triage routes expose them firm-scoped. Datum is an advisor: nothing in this plan writes to a study.

**Tech Stack:** Express 5, drizzle-orm/pg, zod (hand-written contract module), React/Vite, standalone node check scripts (`scripts/verify-*.mjs`, Node 26 type-stripping).

**Spec:** `docs/superpowers/specs/2026-09-29-datum-in-product-design.md`

**Out of scope (later plans):** the judgment model call (phase 2), the questions channel (phase 3), the PE role and seal gate (phase 4).

## Global Constraints

- **Advisor boundary.** No code in this plan writes `tis_projects.request_payload` or `result_payload`, and no column is added to `tis_projects`. Clause functions return records only — no patch, no replacement value. The only writes are to the three new `study_proofread_*` tables.
- **Permitted copy.** Product-visible strings never say "independent review", "second opinion", "peer review" or "QA/QC" (`TIS-PROOFREAD-PROTOCOL.md:38-42`). The permitted phrase, verbatim: **"an internal consistency and traceability check."**
- **Scenario field names invert their plain reading.** `current*` = Existing (counted, no growth); `existing*` = opening-year **No-Build** (grown); `future*` = opening-year Build; `designNoBuild*`/`designBuild*` = design year.
- **Relative imports inside `src/lib/proofread/` carry an explicit `.ts` extension** (`from "./types.ts"`), matching `lib/tis-engine-core/src/index.ts`, so the check script can `await import` the module under plain `node`. esbuild resolves these specifiers too.
- **`proofread/` stays pure:** no `@workspace/db`, no `./logger`, no `fetch`. Importing `@workspace/db` throws at module evaluation when `DATABASE_URL` is unset (`lib/db/src/index.ts:7-11`), which would break the check script. Persistence lives in `src/lib/proofread-store.ts`, outside `proofread/`.
- **Add no new export to `@workspace/tis-engine-core`.** Clauses only *import* existing exports. Any new engine-core export requires editing the `EXPECTED` array in `scripts/verify-engine-core-exports.mjs:19-64` (it asserts `extra.length === 0` and an exact count) — avoid the coupling entirely.
- **Migrations are additive and idempotent** in `lib/db/migrate.mjs`: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, never DROP, rename or `ADD CONSTRAINT`. The file has no ledger; every statement re-runs each boot. Mixed-case index names stay double-quoted.
- **No new npm dependencies** in phase 1.
- **Check-script convention:** `scripts/verify-*.mjs` printing `PASS`/`FAIL` lines, non-zero exit on failure, registered as a `check:*` key in `artifacts/tis-api-server/package.json` (CI discovers them with `jq`; no workflow edit needed).
- **Commit after each task**, message style `type(scope): summary`, trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Protocol amendments + a guard that keeps them true

The protocol as written forbids this feature (`:9-11`, admin-side only) and contradicts itself on the completion gate and the taxonomy. These edits are a prerequisite, not documentation polish.

**Files:**
- Modify: `TIS-PROOFREAD-PROTOCOL.md`
- Modify: `.claude/agents/datum.md`
- Create: `artifacts/tis-api-server/scripts/verify-proofread-protocol.mjs`
- Modify: `artifacts/tis-api-server/package.json` (register `check:proofread-protocol`)

**Interfaces:**
- Produces: `PROTOCOL_VERSION: 2026-09-30.1` as a line in `TIS-PROOFREAD-PROTOCOL.md`, read by Task 6's runner and asserted by this task's guard.

- [ ] **Step 1: Write the failing guard**

Create `artifacts/tis-api-server/scripts/verify-proofread-protocol.mjs`:

```js
/**
 * Guard for the proofread protocol's product-facing contract
 * (docs/superpowers/specs/2026-09-29-datum-in-product-design.md § Prerequisite).
 *
 * Three things silently rot: the version string every log entry needs, the
 * customer-venue copy ban, and source refs that moved into
 * lib/tis-engine-core. Standalone node script (no test runner).
 * Run: `pnpm run check:proofread-protocol`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const protocol = readFileSync(path.join(repo, "TIS-PROOFREAD-PROTOCOL.md"), "utf8");
const agent = readFileSync(path.join(repo, ".claude/agents/datum.md"), "utf8");

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

// 1. A version string exists, because §Logging requires one in every entry.
ok(/^PROTOCOL_VERSION:\s*\d{4}-\d{2}-\d{2}\.\d+$/m.test(protocol), "protocol declares a PROTOCOL_VERSION line");

// 2. The audience section exists and names all three audiences.
ok(/^## Audience$/m.test(protocol), "protocol has an ## Audience section");
for (const who of ["engineer", "sealing PE", "admin"]) {
  ok(new RegExp(who, "i").test(protocol.split("## Audience")[1] ?? ""), `Audience section names the ${who}`);
}

// 3. Banned customer-venue phrasing appears nowhere in either file except as
//    an explicit prohibition line (which starts with "NEVER").
const BANNED = ["independent review", "second opinion", "peer review", "QA/QC"];
for (const file of [["protocol", protocol], ["datum.md", agent]]) {
  for (const phrase of BANNED) {
    // A line that is ABOUT the ban may name the phrases; a line that uses one
    // as a description of the pass may not.
    const offending = file[1]
      .split("\n")
      .filter((l) => l.toLowerCase().includes(phrase.toLowerCase()))
      .filter((l) => !/prohibit|NEVER|banned|permitted|never say/i.test(l));
    ok(offending.length === 0, `${file[0]}: "${phrase}" appears only where the ban is stated (${offending.length} stray)`);
  }
}

// 4. Source refs point at the real modules, not the api-server re-export shims.
for (const stale of [
  "artifacts/tis-api-server/src/lib/land-uses.ts",
  "artifacts/tis-api-server/src/lib/signal-delay.ts",
  "artifacts/tis-api-server/src/lib/regional-growth-rates.ts",
]) {
  ok(!protocol.includes(stale) && !agent.includes(stale), `no stale shim ref: ${stale}`);
}
ok(protocol.includes("lib/tis-engine-core/src/"), "protocol cites lib/tis-engine-core/src/");

// 5. The payload field name is queue95thFt; LOS_THRESHOLDS cannot be imported.
ok(!/\bqueue95Ft\b\s*(field|payload)/.test(protocol), "protocol does not call queue95Ft a payload field");
ok(!protocol.includes("LOS_THRESHOLDS"), "protocol does not reference the module-private LOS_THRESHOLDS");

// 6. One completion gate, stated once, requiring BOTH lists empty.
// \s+ throughout: the replacement text wraps across lines, so a literal space
// would fail against correctly-amended markdown.
ok(
  /no\s+open\s+`?BLOCKER`?\s+and\s+no\s+open\s+`?CONTESTED`?/i.test(protocol),
  "completion gate requires empty BLOCKER and empty CONTESTED",
);
// Assert against the sentence that is actually there, and positively — the
// earlier form (/BLOCKER list is empty$/) matched neither the old text nor the
// new one, so it passed vacuously.
ok(
  !/empty\s+`?BLOCKER`?\s+list\s+is\s+the\s+only\s+condition/i.test(agent),
  "datum.md no longer states a BLOCKER-only gate",
);
ok(
  /no\s+open\s+`?BLOCKER`?\s+and\s+no\s+open\s+`?CONTESTED`?/i.test(agent),
  "datum.md states the two-way gate",
);

// 7. The taxonomy includes DEFECT in the agent's frontmatter description.
const fm = agent.split("---")[1] ?? "";
ok(/DEFECT/.test(fm), "datum.md frontmatter description lists DEFECT");

// 8. The flat-timing standing note is retargeted to signalTiming.basis.
ok(!/g\/C\s*(of\s*)?0\.45\b[^\n]*applied flat/i.test(protocol), "stale flat-g/C standing note is gone");
ok(/signalTiming\.basis/.test(protocol), "protocol cites each row's signalTiming.basis");

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 2: Register it and run it to watch it fail**

In `artifacts/tis-api-server/package.json`, after `"check:nyc-transit-disclosure"`, add:

```json
    "check:proofread-protocol": "node ./scripts/verify-proofread-protocol.mjs"
```

Run: `pnpm --filter @workspace/tis-api-server run check:proofread-protocol`
Expected: FAIL on the PROTOCOL_VERSION line, the missing `## Audience` section, the stale shim refs, and the flat-g/C note.

- [ ] **Step 3: Amend `TIS-PROOFREAD-PROTOCOL.md`**

Add directly under the title:

```markdown
PROTOCOL_VERSION: 2026-09-30.1
```

Add a new section after "What Datum is, and is not":

```markdown
## Audience

A Datum pass has three audiences, and a finding carries exactly one.

- **The engineer who ran the study** sees every `BLOCKER`, `DISCLOSE`, `NOTE`
  and `UNVERIFIED` on their own study, in the app. This replaces the earlier
  admin-side-only rule: findings now reach the customer, so they are written
  to be read by one — plainly, naming the field and the source, with no
  characterization of the engineer's work.
- **The sealing PE** additionally sees every `CONTESTED` item with both
  positions and both sources quoted verbatim, and is the only role that may
  rule on one or record `ACCEPTED RISK`.
- **Admin (Simple Impact Studies)** alone sees `DEFECT`. A defect is a software
  fault: route it to the code queue, never to the PE, and fan it out to a
  study-population query, because every study that engine produced carries it.

The prohibition at §"What Datum is, and is not" on the phrases "independent
review", "second opinion", "peer review" and "QA/QC by a separate reviewer"
applies in full to every product surface, which is a customer venue. The
permitted description, verbatim: "an internal consistency and traceability
check."
```

Replace the four-way completion gate with one statement at the end of the document:

```markdown
A study may be called complete only with **no open BLOCKER and no open
CONTESTED**. That is the whole gate: an undisposed `NOTE`, `DISCLOSE` or
`UNVERIFIED` is a record to carry, not a bar to completion.
```

In §1 and §4, retarget the constant refs from `artifacts/tis-api-server/src/lib/...` to `lib/tis-engine-core/src/land-uses.ts`, `lib/tis-engine-core/src/signal-delay.ts` and `lib/tis-engine-core/src/regional-growth-rates.ts`; change `queue95Ft` to the payload field `queue95thFt`; drop the `LOS_THRESHOLDS` reference in favour of the exported `delayToLos`.

Replace the standing note on the flat g/C with:

```markdown
### Standing note on signal timing

`signalTiming` defaults to `computed` (`lib/tis-api-spec/openapi.yaml`), and
`resolveTimingForRow` (`lib/tis-engine-core/src/row-math.ts`) is the default
path: each row reports its own basis in `signalTiming.basis` — `measured`,
`measured-cycle`, `webster` or `screening-default`. Check the basis the row
actually reports. A finding asserting a flat 90 s cycle and g/C 0.45 is wrong
on every default-run study, and per-row `leftPhasingNs` / `leftPhasingEw`
contradict any claim that no left-turn phasing is modeled.
```

- [ ] **Step 4: Amend `.claude/agents/datum.md`**

- Frontmatter `description`: add `DEFECT` to the finding list so a dispatcher matches on it.
- Line 13: replace "the independent pass that stands between Redline's output and a sealed document" with "the traceability pass that stands between Redline's output and a sealed document" — the original is itself prohibited copy.
- The BLOCKER-only completion sentence: replace with "no open `BLOCKER` and no open `CONTESTED`".
- Source-file list: retarget to `lib/tis-engine-core/src/`.

- [ ] **Step 5: Run the guard to verify it passes**

Run: `pnpm --filter @workspace/tis-api-server run check:proofread-protocol`
Expected: `ALL CHECKS PASSED`

- [ ] **Step 6: Commit**

```bash
git add TIS-PROOFREAD-PROTOCOL.md .claude/agents/datum.md \
  artifacts/tis-api-server/scripts/verify-proofread-protocol.mjs \
  artifacts/tis-api-server/package.json
git commit -m "docs(datum): protocol amendments for a customer-visible pass, guarded by check:proofread-protocol"
```

---

### Task 2: Clause framework + the three v/c clauses

**Files:**
- Create: `artifacts/tis-api-server/src/lib/proofread/types.ts`
- Create: `artifacts/tis-api-server/src/lib/proofread/fingerprint.ts`
- Create: `artifacts/tis-api-server/src/lib/proofread/s4-results.ts`
- Create: `artifacts/tis-api-server/src/lib/proofread/index.ts`
- Create: `artifacts/tis-api-server/scripts/fixtures/proofread/wake-pre-230.json`
- Create: `artifacts/tis-api-server/scripts/fixtures/proofread/wake-current.json`
- Create: `artifacts/tis-api-server/scripts/verify-proofread.mjs`
- Modify: `artifacts/tis-api-server/package.json` (register `check:proofread`)
- Modify: `docs/superpowers/specs/2026-09-29-datum-in-product-design.md` (§Where the code lives)

**Interfaces:**
- Produces: `ProofreadFinding`, `ProofreadType`, `ProofreadSection`, `ProofreadAudience`, `ReadPath`, `StudyRecord`, `ClauseOutcome`, `Clause`, `CoverageEntry`, `ClauseRunResult` (types); `runClauses(rec: StudyRecord, clauses?: Clause[]): ClauseRunResult`; `ALL_CLAUSES: Clause[]`; `findingFingerprint(f: ProofreadFinding): string`; `engineStamp(): string`; clauses `vcPlausibilityIntersection`, `vcPlausibilityApproach`, `vcPlausibilityDesignYear`.

- [ ] **Step 1: Write the failing test**

Create `artifacts/tis-api-server/scripts/verify-proofread.mjs`:

```js
/**
 * Guard for the deterministic proofread clauses
 * (docs/superpowers/plans/2026-09-30-datum-proofread-phase-1.md).
 *
 * The clauses are pure functions over a saved study record, so they test under
 * plain `node` with no env and no db — the posture of verify-screening-clamp.mjs.
 * Run: `pnpm run check:proofread`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const { runClauses, ALL_CLAUSES, findingFingerprint } = await import(
  path.resolve(here, "../src/lib/proofread/index.ts")
);
const fixture = (name) =>
  JSON.parse(readFileSync(path.resolve(here, `./fixtures/proofread/${name}.json`), "utf8"));

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};
const byClause = (res, id) => res.findings.filter((f) => f.clauseId === id);

// --- every clause obeys the finding contract -------------------------------
{
  const res = runClauses(fixture("wake-pre-230"));
  ok(res.findings.length > 0, `pre-#230 Wake produces findings (${res.findings.length})`);
  for (const f of res.findings) {
    ok(typeof f.sourceLabel === "string" && f.sourceLabel.length > 0, `${f.clauseId}: names a source`);
    ok(Array.isArray(f.readPaths) && f.readPaths.length > 0, `${f.clauseId}: records what it read`);
    ok(!("patch" in f) && !("replacement" in f), `${f.clauseId}: advisor only — no patch field`);
    ok(["BLOCKER", "DEFECT", "DISCLOSE", "NOTE", "UNVERIFIED", "CONTESTED"].includes(f.type), `${f.clauseId}: known type`);
  }
  ok(res.coverage.length === ALL_CLAUSES.length, `coverage has one entry per clause (${res.coverage.length})`);
  for (const c of res.coverage) {
    ok(c.status === "ran" || (c.status === "not-run" && !!c.reason), `${c.clauseId}: not-run carries a reason`);
  }
}

// --- §4 intersection-level v/c (the Wake failure mode) --------------------
{
  const res = runClauses(fixture("wake-pre-230"));
  const hits = byClause(res, "vcPlausibilityIntersection");
  ok(hits.length === 1, `intersection v/c fires once with all offenders (${hits.length})`);
  ok(hits[0].type === "BLOCKER", "implausible background v/c is a BLOCKER");
  // The clause reports max(currentVc, existingVc) — the same basis as the engine
  // guard — so row 1 surfaces as 2.90 (not its currentVc 2.84) and row 3 as 3.94.
  ok(/2\.90|3\.94/.test(hits[0].detail), "detail names the offending values");
  ok(hits[0].readPaths.length >= 5, `readPaths cover the offending rows (${hits[0].readPaths.length})`);
}

// --- the silent-NaN case: existingVc high, currentVc absent ---------------
{
  const rec = {
    request: {},
    result: {
      affectedIntersections: [{ signalId: "s1", name: "X", existingVc: 8.68, futureVc: 8.7, approaches: [] }],
      periodReports: [],
    },
  };
  const hits = byClause(runClauses(rec), "vcPlausibilityIntersection");
  ok(hits.length === 1, "a row with existingVc 8.68 and no currentVc still fires (Math.max NaN trap)");
}

// --- §4 approach and design-year: silent today, must fire ----------------
{
  const res = runClauses(fixture("wake-current"));
  ok(byClause(res, "vcPlausibilityIntersection").length === 0, "current Wake is clean at intersection level (max 1.87)");
  const appr = byClause(res, "vcPlausibilityApproach");
  ok(appr.length === 1, "approach-level v/c fires on the current Wake sample");
  ok(/3\.3[0-9]|3\.2[0-9]/.test(appr[0].detail), "approach detail names the NB values above the ceiling");
  const dy = byClause(res, "vcPlausibilityDesignYear");
  ok(dy.length === 1, "design-year v/c fires on the current Wake sample (designBuildVc 2.54)");
}

// --- fingerprints are stable and discriminating ---------------------------
{
  const a = runClauses(fixture("wake-current"));
  const b = runClauses(fixture("wake-current"));
  ok(
    a.findings.map(findingFingerprint).join(",") === b.findings.map(findingFingerprint).join(","),
    "fingerprints are stable across runs on the same record",
  );
  const c = runClauses(fixture("wake-pre-230"));
  const overlap = a.findings.map(findingFingerprint).filter((fp) => c.findings.map(findingFingerprint).includes(fp));
  ok(overlap.length === 0, "different records produce different fingerprints");
}

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 2: Write the fixtures**

`artifacts/tis-api-server/scripts/fixtures/proofread/wake-pre-230.json` — the five pre-#230 rows (from the archived PDF; `private/sample-payloads/` is gitignored, so these are committed trimmed records):

```json
{
  "request": { "latitude": 35.8794, "longitude": -78.5897, "landUseCode": "820", "size": 150 },
  "result": {
    "studyRadiusMi": 1,
    "intersectionsStudied": 20,
    "findings": ["PM peak trip generation: 150 KSF retail."],
    "methodology": [],
    "growthAppliedPct": 1.4,
    "growthYears": 2,
    "affectedIntersections": [
      { "signalId": "raleigh-durham-6571106900", "name": "Spring Forest Road & Capital Boulevard", "currentVc": 2.84, "existingVc": 2.9, "futureVc": 2.92, "futureDelaySec": 300, "futureLos": "F", "queue95thFt": 4200, "approaches": [] },
      { "signalId": "raleigh-durham-6561885220", "name": "Oak Forest Drive & Capital Boulevard", "currentVc": 2.94, "existingVc": 2.98, "futureVc": 3.0, "futureDelaySec": 300, "futureLos": "F", "queue95thFt": 4300, "approaches": [] },
      { "signalId": "raleigh-durham-195473089", "name": "Fox Rd. & Old Wake Forest", "currentVc": 3.93, "existingVc": 3.94, "futureVc": 3.95, "futureDelaySec": 300, "futureLos": "F", "queue95thFt": 5100, "approaches": [] },
      { "signalId": "raleigh-durham-195473090", "name": "Sumner Boulevard & Capital Boulevard", "currentVc": 2.61, "existingVc": 2.64, "futureVc": 2.66, "futureDelaySec": 300, "futureLos": "F", "queue95thFt": 3900, "approaches": [] },
      { "signalId": "raleigh-durham-195473091", "name": "Highwoods Boulevard & Capital Boulevard", "currentVc": 3.27, "existingVc": 3.3, "futureVc": 3.32, "futureDelaySec": 300, "futureLos": "F", "queue95thFt": 4600, "approaches": [] }
    ],
    "periodReports": []
  }
}
```

`artifacts/tis-api-server/scripts/fixtures/proofread/wake-current.json` — the shipped sample, where the intersection guard is silent but approaches and the design year are not:

```json
{
  "request": { "latitude": 35.8794, "longitude": -78.5897, "landUseCode": "820", "size": 150, "analysisPeriods": ["am_peak", "pm_peak"] },
  "result": {
    "studyRadiusMi": 1,
    "intersectionsStudied": 20,
    "intersectionsInStudyArea": 22,
    "intersectionsMergedAsDuplicates": 2,
    "findings": ["PM peak trip generation: 150 KSF retail."],
    "methodology": [],
    "growthAppliedPct": 1.4,
    "growthYears": 2,
    "growthMultiplierExact": 1.028196,
    "affectedIntersections": [
      {
        "signalId": "raleigh-durham-6571106900",
        "name": "Spring Forest Road & Capital Boulevard",
        "currentVc": 1.81, "existingVc": 1.87, "futureVc": 1.9,
        "futureDelaySec": 300, "futureLos": "F", "queue95thFt": 2100,
        "designBuildVc": 2.54, "designNoBuildVc": 2.49,
        "approaches": [
          { "direction": "NB", "currentVc": 3.11, "existingVc": 3.16, "futureVc": 3.18, "futureDelaySec": 300, "futureLos": "F", "queue95thFt": 3100, "throughLanes": 3, "lanesSource": "osm" },
          { "direction": "SB", "currentVc": 0.82, "existingVc": 0.84, "futureVc": 0.86, "futureDelaySec": 41, "futureLos": "D", "queue95thFt": 220, "throughLanes": 3, "lanesSource": "osm" }
        ]
      },
      {
        "signalId": "raleigh-durham-6561885220",
        "name": "Oak Forest Drive & Capital Boulevard",
        "currentVc": 1.72, "existingVc": 1.78, "futureVc": 1.8,
        "futureDelaySec": 300, "futureLos": "F", "queue95thFt": 1950,
        "designBuildVc": 2.41, "designNoBuildVc": 2.37,
        "approaches": [
          { "direction": "NB", "currentVc": 3.22, "existingVc": 3.27, "futureVc": 3.34, "futureDelaySec": 300, "futureLos": "F", "queue95thFt": 3250, "throughLanes": 3, "lanesSource": "osm" }
        ]
      }
    ],
    "periodReports": []
  }
}
```

- [ ] **Step 3: Run the test to verify it fails**

First register the key in `artifacts/tis-api-server/package.json` so the step can actually run:

```json
    "check:proofread": "node ./scripts/verify-proofread.mjs"
```

Run: `pnpm --filter @workspace/tis-api-server run check:proofread`
Expected: FAIL — `Cannot find module .../src/lib/proofread/index.ts`

- [ ] **Step 4: Write `types.ts`**

```ts
/**
 * Proofread clause contract.
 *
 * A clause reads a SAVED study record and returns either findings or a declared
 * reason it could not run. Two properties are load-bearing and encoded in the
 * types rather than asked for in prose:
 *
 *   - `sourceLabel` and `readPaths` are non-optional, because a finding with no
 *     named source is an opinion, not a finding (TIS-PROOFREAD-PROTOCOL.md).
 *   - there is no patch, replacement value, or write path anywhere in the
 *     result. Datum advises; it never executes.
 *
 * Relative imports in this directory carry an explicit .ts extension so
 * scripts/verify-proofread.mjs can import the module under plain node.
 */
import type { TisReport, TisRequest } from "@workspace/tis-api-zod";

export type ProofreadSection = 1 | 2 | 3 | 4 | 5 | 6;

/** The protocol's taxonomy. A clause may emit any of these; the phase-2 model call may not emit BLOCKER or DEFECT. */
export type ProofreadType = "BLOCKER" | "DEFECT" | "DISCLOSE" | "NOTE" | "UNVERIFIED" | "CONTESTED";

export type ProofreadAudience = "engineer" | "pe" | "admin";

/** A payload path the clause actually read, with the value it saw. */
export type ReadPath = { path: string; value: string | number | boolean | null };

export type ProofreadFinding = {
  clauseId: string;
  section: ProofreadSection;
  type: ProofreadType;
  title: string;
  detail: string;
  sourceLabel: string;
  readPaths: ReadPath[];
  /** Prose advice for a person. Never machine-applicable. */
  remedy: string;
  audience: ProofreadAudience;
};

export type StudyRecord = {
  request: Partial<TisRequest> & Record<string, unknown>;
  result: Partial<TisReport> & Record<string, unknown>;
};

export type ClauseOutcome =
  | { status: "ran"; findings: ProofreadFinding[] }
  /** The clause did not run because a declared input was absent. NOT a finding, and never rendered as coverage. */
  | { status: "not-run"; reason: string };

export type Clause = {
  id: string;
  section: ProofreadSection;
  title: string;
  run: (rec: StudyRecord) => ClauseOutcome;
};

export type CoverageEntry = {
  clauseId: string;
  section: ProofreadSection;
  status: "ran" | "not-run";
  reason?: string;
};

export type ClauseRunResult = { findings: ProofreadFinding[]; coverage: CoverageEntry[] };

/**
 * Every period bucket of rows a record carries.
 *
 * `result.affectedIntersections` is NOT a separate set: the engine assigns it
 * `pmReport.affectedIntersections` (`tis.ts:2178`, declared "PM peak
 * (back-compat)" at `:514`), so on a real study it is the same array as the
 * pm_peak period report. Counting both would list every PM offender twice and
 * inflate the "N of M" in every finding. So the top-level array is scanned only
 * when periodReports carries no pm_peak entry — which is the case for a trimmed
 * fixture, and for a legacy payload saved before periodReports existed.
 */
export function rowBuckets(rec: StudyRecord): Array<{ period: string; rows: any[] }> {
  const out: Array<{ period: string; rows: any[] }> = [];
  const periods = rec.result.periodReports;
  const reports: any[] = Array.isArray(periods) ? (periods as any[]) : [];
  const pmReported = reports.some((p) => p?.period === "pm_peak" && Array.isArray(p?.affectedIntersections));
  const top = rec.result.affectedIntersections;
  if (Array.isArray(top) && !pmReported) out.push({ period: "pm_peak", rows: top });
  for (const p of reports) {
    if (Array.isArray(p?.affectedIntersections)) out.push({ period: String(p.period ?? "unknown"), rows: p.affectedIntersections });
  }
  return out;
}
```

- [ ] **Step 5: Write `fingerprint.ts`**

```ts
/**
 * Finding identity and engine identity.
 *
 * A fingerprint is the key a triage disposition carries forward across a
 * re-run: same clause, same section, same values read → same finding, so a
 * WITHDRAWN item never silently reopens and an ACCEPTED RISK keeps its named
 * person. An engine stamp says which engine produced the study the finding is
 * about — nothing in the payload records that (the only version-ish field is
 * generatedAt), which is why the same Wake request produced v/c 2.61-3.93
 * before #227 and 0.71-1.87 after.
 */
import {
  hash32,
  APPROACH_CAPACITY_VPH,
  CYCLE_LEN,
  DESIGN_YEAR_HORIZON_DEFAULT,
  G_OVER_C,
  LAND_USES,
  PLAUSIBLE_MAX_INTERSECTION_VC,
  SATURATION_FLOW_VPH,
  SCREENING_MAX_DELAY_SEC,
} from "@workspace/tis-engine-core";
import type { ProofreadFinding } from "./types.ts";

const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, "0");

export function findingFingerprint(f: ProofreadFinding): string {
  const canon = [
    f.clauseId,
    String(f.section),
    ...f.readPaths.map((p) => `${p.path}=${String(p.value)}`).sort(),
  ].join("|");
  return hex(hash32(canon));
}

/** Rule-relevant engine constants, plus the deploy's commit when the platform provides one. */
export function engineStamp(): string {
  const constants = JSON.stringify({
    PLAUSIBLE_MAX_INTERSECTION_VC,
    SCREENING_MAX_DELAY_SEC,
    CYCLE_LEN,
    G_OVER_C,
    SATURATION_FLOW_VPH,
    APPROACH_CAPACITY_VPH,
    DESIGN_YEAR_HORIZON_DEFAULT,
    landUseCount: LAND_USES.length,
  });
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? "";
  return sha ? `${hex(hash32(constants))}-${sha.slice(0, 7)}` : hex(hash32(constants));
}

export const RULES_VERSION = "1";
```

- [ ] **Step 6: Write `s4-results.ts` (the three v/c clauses) and `index.ts`**

`s4-results.ts`:

```ts
/**
 * §4 Results — the plausibility ceiling, in the three places it can be breached.
 *
 * implausibleVolumeDisclosures (lib/tis-engine-core/src/volume-plausibility.ts)
 * judges INTERSECTION rows only, and its Math.max drops a row whose currentVc
 * is absent (Math.max(undefined, 8.68) is NaN) — so a legacy record reports
 * clean at any v/c. These clauses normalize at the boundary and add the two
 * scopes the guard never covered: per-approach and design-year.
 */
import { PLAUSIBLE_MAX_INTERSECTION_VC } from "@workspace/tis-engine-core";
import type { Clause, ProofreadFinding, ReadPath, StudyRecord } from "./types.ts";
import { rowBuckets } from "./types.ts";

const SOURCE = "lib/tis-engine-core/src/signal-delay.ts — PLAUSIBLE_MAX_INTERSECTION_VC = 2.5";
const REMEDY =
  "Obtain measured turning-movement counts for these locations and analyze them with observed lane geometry and signal timing (HCS/Synchro) rather than the screening capacity used here.";
const CEIL = PLAUSIBLE_MAX_INTERSECTION_VC;

/** Highest no-project v/c on a row, tolerating either scenario field being absent. */
const noProjectVc = (r: any): number => Math.max(Number(r?.currentVc ?? 0), Number(r?.existingVc ?? 0));

function finding(
  clauseId: string,
  title: string,
  scope: string,
  offenders: Array<{ label: string; vc: number; path: string }>,
  total: number,
): ProofreadFinding {
  const named = offenders.slice(0, 5).map((o) => `${o.label} (v/c ${o.vc.toFixed(2)})`).join("; ");
  const more = offenders.length > 5 ? `, and ${offenders.length - 5} more` : "";
  const readPaths: ReadPath[] = offenders.map((o) => ({ path: o.path, value: o.vc }));
  return {
    clauseId,
    section: 4,
    type: "BLOCKER",
    title,
    detail:
      `${offenders.length} of ${total} ${scope} report a no-project v/c above ${CEIL.toFixed(1)}, ` +
      `which no at-grade signalized ${scope.endsWith("es") ? "location" : "location"} can operate at: ${named}${more}. ` +
      `Either the background volume is a limited-access count matched to a surface street, or the volume is a ` +
      `legitimately high arterial volume the screening capacity understates. The delay, LOS and queue values ` +
      `reported here are not defensible under either cause.`,
    sourceLabel: SOURCE,
    readPaths,
    remedy: REMEDY,
    audience: "engineer",
  };
}

export const vcPlausibilityIntersection: Clause = {
  id: "vcPlausibilityIntersection",
  section: 4,
  title: "Intersection no-project v/c within the plausibility ceiling",
  run(rec: StudyRecord) {
    const buckets = rowBuckets(rec);
    if (buckets.length === 0) return { status: "not-run", reason: "no affectedIntersections on the record" };
    const offenders: Array<{ label: string; vc: number; path: string }> = [];
    let total = 0;
    for (const b of buckets) {
      b.rows.forEach((r: any, i: number) => {
        total++;
        const vc = noProjectVc(r);
        if (Number.isFinite(vc) && vc > CEIL) {
          offenders.push({ label: `${r.name} [${b.period}]`, vc, path: `result.${b.period}.affectedIntersections[${i}]` });
        }
      });
    }
    if (offenders.length === 0) return { status: "ran", findings: [] };
    offenders.sort((a, b) => b.vc - a.vc);
    return {
      status: "ran",
      findings: [finding("vcPlausibilityIntersection", "Implausible background volume at study intersections", "study intersections", offenders, total)],
    };
  },
};

export const vcPlausibilityApproach: Clause = {
  id: "vcPlausibilityApproach",
  section: 4,
  title: "Approach no-project v/c within the plausibility ceiling",
  run(rec: StudyRecord) {
    const buckets = rowBuckets(rec);
    const withApproaches = buckets.filter((b) => b.rows.some((r: any) => Array.isArray(r?.approaches) && r.approaches.length > 0));
    if (withApproaches.length === 0) return { status: "not-run", reason: "no approach detail on the record" };
    const offenders: Array<{ label: string; vc: number; path: string }> = [];
    let total = 0;
    for (const b of withApproaches) {
      b.rows.forEach((r: any, i: number) => {
        (r.approaches ?? []).forEach((a: any, j: number) => {
          total++;
          const vc = noProjectVc(a);
          if (Number.isFinite(vc) && vc > CEIL) {
            offenders.push({
              label: `${r.name} ${a.direction} [${b.period}]`,
              vc,
              path: `result.${b.period}.affectedIntersections[${i}].approaches[${j}]`,
            });
          }
        });
      });
    }
    if (offenders.length === 0) return { status: "ran", findings: [] };
    offenders.sort((a, b) => b.vc - a.vc);
    return {
      status: "ran",
      findings: [finding("vcPlausibilityApproach", "Implausible background volume on study approaches", "study approaches", offenders, total)],
    };
  },
};

export const vcPlausibilityDesignYear: Clause = {
  id: "vcPlausibilityDesignYear",
  section: 4,
  title: "Design-year v/c within the plausibility ceiling",
  run(rec: StudyRecord) {
    const buckets = rowBuckets(rec);
    const hasDesign = buckets.some((b) => b.rows.some((r: any) => r?.designNoBuildVc !== undefined || r?.designBuildVc !== undefined));
    if (!hasDesign) return { status: "not-run", reason: "record carries no design-year scenario" };
    const offenders: Array<{ label: string; vc: number; path: string }> = [];
    let total = 0;
    for (const b of buckets) {
      b.rows.forEach((r: any, i: number) => {
        for (const field of ["designNoBuildVc", "designBuildVc"] as const) {
          const vc = Number(r?.[field]);
          if (!Number.isFinite(vc)) continue;
          total++;
          if (vc > CEIL) {
            offenders.push({
              label: `${r.name} ${field === "designBuildVc" ? "Design Build" : "Design No-Build"} [${b.period}]`,
              vc,
              path: `result.${b.period}.affectedIntersections[${i}].${field}`,
            });
          }
        }
      });
    }
    if (offenders.length === 0) return { status: "ran", findings: [] };
    offenders.sort((a, b) => b.vc - a.vc);
    return {
      status: "ran",
      findings: [finding("vcPlausibilityDesignYear", "Implausible design-year volume", "design-year scenarios", offenders, total)],
    };
  },
};
```

`index.ts`:

```ts
/**
 * The proofread clause registry and runner.
 *
 * Pure: no db, no logger, no fetch, so scripts/verify-proofread.mjs imports it
 * under plain node. Persistence lives in ../proofread-store.ts.
 */
import type { Clause, ClauseRunResult, CoverageEntry, ProofreadFinding, StudyRecord } from "./types.ts";
import { vcPlausibilityApproach, vcPlausibilityDesignYear, vcPlausibilityIntersection } from "./s4-results.ts";

export * from "./types.ts";
export { findingFingerprint, engineStamp, RULES_VERSION } from "./fingerprint.ts";

export const ALL_CLAUSES: Clause[] = [
  vcPlausibilityIntersection,
  vcPlausibilityApproach,
  vcPlausibilityDesignYear,
];

export function runClauses(rec: StudyRecord, clauses: Clause[] = ALL_CLAUSES): ClauseRunResult {
  const findings: ProofreadFinding[] = [];
  const coverage: CoverageEntry[] = [];
  for (const c of clauses) {
    let outcome;
    try {
      outcome = c.run(rec);
    } catch (err) {
      // A clause that throws is coverage we did not get, never a finding.
      outcome = { status: "not-run" as const, reason: `clause threw: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (outcome.status === "ran") {
      findings.push(...outcome.findings);
      coverage.push({ clauseId: c.id, section: c.section, status: "ran" });
    } else {
      coverage.push({ clauseId: c.id, section: c.section, status: "not-run", reason: outcome.reason });
    }
  }
  return { findings, coverage };
}
```

Register the check script in `artifacts/tis-api-server/package.json`:

```json
    "check:proofread": "node ./scripts/verify-proofread.mjs"
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @workspace/tis-api-server run check:proofread`
Expected: `ALL CHECKS PASSED`

- [ ] **Step 8: Correct the spec's code-location table**

In `docs/superpowers/specs/2026-09-29-datum-in-product-design.md` § Where the code lives, change the "Pure clause functions" row from `lib/tis-engine-core/src/proofread/` to `artifacts/tis-api-server/src/lib/proofread/`, and add the reason: keeping the clauses out of engine-core avoids touching the hand-maintained `EXPECTED` array in `verify-engine-core-exports.mjs` (which asserts an exact export count), while `await import` of a `src/lib/*.ts` module under plain node is already the pattern `verify-screening-clamp.mjs` uses.

- [ ] **Step 9: Commit**

```bash
git add artifacts/tis-api-server/src/lib/proofread artifacts/tis-api-server/scripts/verify-proofread.mjs \
  artifacts/tis-api-server/scripts/fixtures/proofread artifacts/tis-api-server/package.json \
  docs/superpowers/specs/2026-09-29-datum-in-product-design.md
git commit -m "feat(proofread): clause framework and the three v/c plausibility clauses"
```

---

### Task 3: The remaining nine clauses

**Files:**
- Create: `artifacts/tis-api-server/src/lib/proofread/s1-inputs.ts`
- Create: `artifacts/tis-api-server/src/lib/proofread/s2-trip-gen.ts`
- Create: `artifacts/tis-api-server/src/lib/proofread/s5-criteria.ts`
- Create: `artifacts/tis-api-server/src/lib/proofread/s6-limitations.ts`
- Modify: `artifacts/tis-api-server/src/lib/proofread/s4-results.ts` (add `losMatchesDelay`, `screeningClampDisclosed`)
- Modify: `artifacts/tis-api-server/src/lib/proofread/index.ts` (registry)
- Modify: `artifacts/tis-api-server/scripts/verify-proofread.mjs`
- Create: `artifacts/tis-api-server/scripts/fixtures/proofread/legacy-minimal.json`

**Interfaces:**
- Consumes: `Clause`, `StudyRecord`, `ProofreadFinding`, `rowBuckets` from Task 2.
- Produces: clauses `growthOverrideDisclosed`, `growthMultiplierReproduces`, `rateReproducesTotal`, `passByBasisNamed`, `losMatchesDelay`, `screeningClampDisclosed`, `criteriaNamed`, `periodScopeDisclosed`, `scopeNoteConsistent` — all added to `ALL_CLAUSES`.

- [ ] **Step 1: Write the failing tests**

Append to `artifacts/tis-api-server/scripts/verify-proofread.mjs`, before the final summary lines:

```js
// --- §1 growth ------------------------------------------------------------
{
  const overrideNoSource = { request: { growthRatePct: 3 }, result: { growthAppliedPct: 3, growthYears: 2, affectedIntersections: [], periodReports: [] } };
  const hits = byClause(runClauses(overrideNoSource), "growthOverrideDisclosed");
  ok(hits.length === 1 && hits[0].type === "BLOCKER", "an override with no growthSource is a BLOCKER");

  const withSource = { request: { growthRatePct: 3 }, result: { growthAppliedPct: 3, growthYears: 2, growthSource: "Explicit override: 3.0%/yr applied, displacing the measured 1.4%/yr (NCDOT)", affectedIntersections: [], periodReports: [] } };
  ok(byClause(runClauses(withSource), "growthOverrideDisclosed").length === 0, "a tagged override passes");

  const badMultiplier = { request: {}, result: { growthAppliedPct: 1.4, growthYears: 2, growthMultiplierExact: 1.5, affectedIntersections: [], periodReports: [] } };
  ok(byClause(runClauses(badMultiplier), "growthMultiplierReproduces").length === 1, "a multiplier that does not reproduce is a finding");
  ok(byClause(runClauses(fixture("wake-current")), "growthMultiplierReproduces").length === 0, "Wake's 1.028196 reproduces from 1.4%/2yr");
}

// --- §2 trip generation ---------------------------------------------------
{
  const mismatch = { request: { size: 150 }, result: { tripGeneration: { landUseCode: "820", size: 150, pmRate: 3.4, pmPeakTrips: 999, dailyRate: 37.75, dailyTrips: 5663, amRate: 0.94, amPeakTrips: 141, variableSource: "SANDAG 2002" }, affectedIntersections: [], periodReports: [] } };
  const hits = byClause(runClauses(mismatch), "rateReproducesTotal");
  ok(hits.length >= 1, "a PM total that does not reproduce from rate x size is a finding");
  ok(/3\.4/.test(hits[0].detail) && /999/.test(hits[0].detail), "detail shows the rate and the printed total");

  const legacy = runClauses(fixture("legacy-minimal"));
  const cov = legacy.coverage.find((c) => c.clauseId === "rateReproducesTotal");
  ok(cov.status === "not-run" && /rate/i.test(cov.reason), "a legacy payload without rate fields is not-run, not UNVERIFIED");
}

// --- §4 LOS/delay agreement and the screening clamp -----------------------
{
  const losF = { request: {}, result: { affectedIntersections: [{ signalId: "s", name: "N", currentVc: 0.9, existingVc: 0.92, futureDelaySec: 0, futureLos: "F", queue95thFt: 10, approaches: [] }], periodReports: [] } };
  const hits = byClause(runClauses(losF), "losMatchesDelay");
  ok(hits.length === 1 && hits[0].type === "DEFECT", "LOS F with 0 s delay is a DEFECT (engine fault, admin audience)");
  ok(hits[0].audience === "admin", "a DEFECT routes to admin, never to the PE");

  const capped = { request: {}, result: { findings: [], methodology: [], affectedIntersections: [{ signalId: "s", name: "N", currentVc: 1.9, existingVc: 1.95, futureDelaySec: 300, futureLos: "F", queue95thFt: 900, approaches: [] }], periodReports: [] } };
  ok(byClause(runClauses(capped), "screeningClampDisclosed").length === 1, "an undisclosed clamped delay is a DISCLOSE");
}

// --- §5 criteria ----------------------------------------------------------
{
  const cov = runClauses(fixture("legacy-minimal")).coverage.find((c) => c.clauseId === "criteriaNamed");
  ok(cov.status === "not-run" && /agenc/i.test(cov.reason), "criteria clause is not-run when the record names no agency");
}

// --- §6 limitations -------------------------------------------------------
{
  const twoAsked = {
    request: { analysisPeriods: ["am_peak", "pm_peak"] },
    result: { findings: [], methodology: [], periodReports: [{ period: "pm_peak", affectedIntersections: [] }], affectedIntersections: [] },
  };
  const hits = byClause(runClauses(twoAsked), "periodScopeDisclosed");
  ok(hits.length === 1 && /am_peak/.test(hits[0].detail), "a requested period with no report must be disclosed");

  const scope = {
    request: {},
    result: { studyRadiusMi: 1, intersectionsStudied: 20, intersectionsInStudyArea: 22, intersectionsMergedAsDuplicates: 2, findings: [], methodology: [], affectedIntersections: [], periodReports: [] },
  };
  ok(byClause(runClauses(scope), "scopeNoteConsistent").length === 1, "a merged-duplicate gap with no scope note is a DISCLOSE");
}

// --- coverage is per clause, and never claims a section passed ------------
{
  const res = runClauses(fixture("legacy-minimal"));
  ok(res.coverage.length === ALL_CLAUSES.length, `coverage covers all ${ALL_CLAUSES.length} clauses`);
  ok(res.coverage.some((c) => c.status === "not-run"), "a legacy record reports real not-run coverage");
  ok(!("sections" in res), "the result exposes no per-section pass/fail");
}
```

Create `artifacts/tis-api-server/scripts/fixtures/proofread/legacy-minimal.json` — a pre-feature payload with the optional fields genuinely absent:

```json
{
  "request": { "latitude": 33.749, "longitude": -84.388, "landUseCode": "220", "size": 300 },
  "result": {
    "studyRadiusMi": 1,
    "intersectionsStudied": 8,
    "findings": ["PM peak trip generation: 300 units multifamily."],
    "methodology": [],
    "growthAppliedPct": 1.2,
    "growthYears": 2,
    "tripGeneration": { "landUseCode": "220", "landUseName": "Multifamily Housing (Mid-Rise)", "size": 300, "unit": "dwelling units", "dailyTrips": 1629, "amPeakTrips": 102, "pmPeakTrips": 123, "pmIn": 74, "pmOut": 49 },
    "affectedIntersections": [
      { "signalId": "atl-1", "name": "Peachtree St & 10th St", "existingVc": 0.81, "futureVc": 0.84, "existingDelaySec": 28, "futureDelaySec": 31, "existingLos": "C", "futureLos": "C", "losChanged": false, "mitigation": "None required", "mitigationSeverity": "none", "queue95thFt": 180, "addedTripsPmPeak": 12, "approaches": [] }
    ],
    "periodReports": []
  }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @workspace/tis-api-server run check:proofread`
Expected: FAIL — every new clause id returns no findings because no clause with that id is registered.

- [ ] **Step 3: Write `s1-inputs.ts`**

```ts
/**
 * §1 Inputs — growth provenance and the multiplier the engine actually applied.
 *
 * growthSource is the payload's own provenance string: when the request
 * supplied growthRatePct, the engine tags the source as an explicit override
 * naming the measured rate it displaced (GROWTH_OVERRIDE_PREFIX). An override
 * with no such tag is an undisclosed input, which is the §1 BLOCKER.
 */
import { isGrowthOverride } from "@workspace/tis-engine-core";
import type { Clause, StudyRecord } from "./types.ts";

export const growthOverrideDisclosed: Clause = {
  id: "growthOverrideDisclosed",
  section: 1,
  title: "An explicit growth override is disclosed with the rate it displaced",
  run(rec: StudyRecord) {
    const override = rec.request.growthRatePct;
    if (override === undefined || override === null) return { status: "not-run", reason: "request supplied no growthRatePct override" };
    const source = rec.result.growthSource as string | undefined;
    if (source && isGrowthOverride(source)) return { status: "ran", findings: [] };
    return {
      status: "ran",
      findings: [
        {
          clauseId: "growthOverrideDisclosed",
          section: 1,
          type: "BLOCKER",
          title: "Growth rate overridden without disclosure",
          detail:
            `The request supplied growthRatePct ${override}, but the study's growthSource ` +
            `${source ? `reads "${source}", which is not tagged as an override` : "is absent"}. ` +
            `A reviewer cannot tell that the applied rate displaced the measured regional rate.`,
          sourceLabel: "lib/tis-engine-core/src/regional-growth-rates.ts — isGrowthOverride / GROWTH_OVERRIDE_PREFIX",
          readPaths: [
            { path: "request.growthRatePct", value: Number(override) },
            { path: "result.growthSource", value: source ?? null },
          ],
          remedy: "State the override and its basis in the deliverable, naming the measured rate it replaced.",
          audience: "engineer",
        },
      ],
    };
  },
};

export const growthMultiplierReproduces: Clause = {
  id: "growthMultiplierReproduces",
  section: 1,
  title: "The applied growth multiplier reproduces from the rate and the years",
  run(rec: StudyRecord) {
    const pct = Number(rec.result.growthAppliedPct);
    const years = Number(rec.result.growthYears);
    const exact = rec.result.growthMultiplierExact as number | undefined;
    if (exact === undefined) return { status: "not-run", reason: "payload predates growthMultiplierExact" };
    if (!Number.isFinite(pct) || !Number.isFinite(years)) return { status: "not-run", reason: "growthAppliedPct or growthYears absent" };
    const expected = Math.pow(1 + pct / 100, years);
    if (Math.abs(expected - exact) <= 1e-6) return { status: "ran", findings: [] };
    return {
      status: "ran",
      findings: [
        {
          clauseId: "growthMultiplierReproduces",
          section: 1,
          type: "BLOCKER",
          title: "Growth multiplier does not reproduce from the stated rate",
          detail:
            `The study reports ${pct}%/yr over ${years} year(s), which is a multiplier of ` +
            `${expected.toFixed(6)}, but the applied multiplier is ${exact}. Every grown volume in the ` +
            `study rests on this number, so a disagreement here propagates to every scenario.`,
          sourceLabel: "result.growthAppliedPct and result.growthYears, compounded — (1 + pct/100) ^ years",
          readPaths: [
            { path: "result.growthAppliedPct", value: pct },
            { path: "result.growthYears", value: years },
            { path: "result.growthMultiplierExact", value: exact },
          ],
          remedy: "Reconcile the printed rate and horizon with the multiplier the engine applied before submitting.",
          audience: "engineer",
        },
      ],
    };
  },
};
```

- [ ] **Step 4: Write `s2-trip-gen.ts`**

```ts
/**
 * §2 Trip generation — the printed rate must reproduce the printed total, and
 * the pass-by basis must be named.
 *
 * §2a stands: never verify a rate against ITE Trip Generation. There is no
 * license. The only source for a rate is the tagged `source` string on the
 * land use in LAND_USES, which is what variableSource prints.
 */
import { LAND_USES } from "@workspace/tis-engine-core";
import type { Clause, ProofreadFinding, StudyRecord } from "./types.ts";

const TOLERANCE = 1.0; // trips; the payload rounds totals

export const rateReproducesTotal: Clause = {
  id: "rateReproducesTotal",
  section: 2,
  title: "Printed rates reproduce the printed trip totals",
  run(rec: StudyRecord) {
    const tg = rec.result.tripGeneration as any;
    if (!tg) return { status: "not-run", reason: "no tripGeneration on the record" };
    const pairs: Array<[string, string, string]> = [
      ["pmRate", "pmPeakTrips", "PM peak"],
      ["amRate", "amPeakTrips", "AM peak"],
      ["dailyRate", "dailyTrips", "Daily"],
    ];
    const present = pairs.filter(([rate]) => Number.isFinite(Number(tg[rate])));
    if (present.length === 0) return { status: "not-run", reason: "payload carries no rate fields (pre-2026 record)" };
    const size = Number(tg.size);
    if (!Number.isFinite(size)) return { status: "not-run", reason: "tripGeneration.size absent" };
    const findings: ProofreadFinding[] = [];
    for (const [rateKey, totalKey, label] of present) {
      const rate = Number(tg[rateKey]);
      const printed = Number(tg[totalKey]);
      const expected = rate * size;
      if (!Number.isFinite(printed) || Math.abs(expected - printed) <= TOLERANCE + 0.5) continue;
      findings.push({
        clauseId: "rateReproducesTotal",
        section: 2,
        type: "BLOCKER",
        title: `${label} trips do not reproduce from the printed rate`,
        detail:
          `${label}: rate ${rate} x size ${size} is ${expected.toFixed(1)} trips, but the study prints ` +
          `${printed}. One of the two is wrong, and a reviewer will recompute this line first.`,
        sourceLabel: `result.tripGeneration.variableSource — ${String(tg.variableSource ?? "(absent)")}`,
        readPaths: [
          { path: `result.tripGeneration.${rateKey}`, value: rate },
          { path: "result.tripGeneration.size", value: size },
          { path: `result.tripGeneration.${totalKey}`, value: printed },
        ],
        remedy: "Reconcile the rate, the size and the total. Verify the rate against the tagged source string, never against ITE.",
        audience: "engineer",
      });
    }
    return { status: "ran", findings };
  },
};

export const passByBasisNamed: Clause = {
  id: "passByBasisNamed",
  section: 2,
  title: "A pass-by reduction states its basis",
  run(rec: StudyRecord) {
    const code = String((rec.result.tripGeneration as any)?.landUseCode ?? rec.request.landUseCode ?? "");
    const lu = LAND_USES.find((l) => l.code === code);
    if (!lu) return { status: "not-run", reason: `land use ${code || "(absent)"} not in the registry` };
    const requested = rec.request.passByPct;
    const applied = requested === undefined || requested === null ? lu.passByPctPm : Number(requested);
    if (!applied) return { status: "ran", findings: [] };
    const prose = [...((rec.result.findings as string[]) ?? []), ...((rec.result.methodology as string[]) ?? [])].join(" ");
    if (/pass-?by/i.test(prose)) return { status: "ran", findings: [] };
    return {
      status: "ran",
      findings: [
        {
          clauseId: "passByBasisNamed",
          section: 2,
          type: "DISCLOSE",
          title: "Pass-by reduction applied without stating it",
          detail:
            `A pass-by reduction of ${applied}% is in effect for land use ${code}` +
            `${requested === undefined ? " (the land-use default)" : " (supplied by the request)"}, ` +
            `but neither findings nor methodology mentions pass-by. A trip reduction the reader cannot see is a trip reduction a reviewer will disallow.`,
          sourceLabel: `lib/tis-engine-core/src/land-uses.ts — ${lu.code} passByPctPm ${lu.passByPctPm}, source "${lu.source}"`,
          readPaths: [
            { path: "request.passByPct", value: requested === undefined ? null : Number(requested) },
            { path: `LAND_USES[${code}].passByPctPm`, value: lu.passByPctPm },
          ],
          remedy: "State the pass-by percentage and its source in the trip-generation section.",
          audience: "engineer",
        },
      ],
    };
  },
};
```

Note for the implementer: there is deliberately **no** internal-capture counterpart. `internalCapturePctPm` is 0 on all 51 land uses, so a "matches the land-use default" clause would be vacuously true on every study in existence.

- [ ] **Step 5: Add the two §4 clauses to `s4-results.ts`**

```ts
import { delayToLos, SCREENING_MAX_DELAY_SEC } from "@workspace/tis-engine-core";

/** A row's LOS letter must be the letter its own delay maps to. */
export const losMatchesDelay: Clause = {
  id: "losMatchesDelay",
  section: 4,
  title: "Each reported LOS letter matches its reported delay",
  run(rec: StudyRecord) {
    const buckets = rowBuckets(rec);
    if (buckets.length === 0) return { status: "not-run", reason: "no affectedIntersections on the record" };
    const findings: ProofreadFinding[] = [];
    const pairs: Array<[string, string]> = [
      ["currentDelaySec", "currentLos"],
      ["existingDelaySec", "existingLos"],
      ["futureDelaySec", "futureLos"],
      ["designNoBuildDelaySec", "designNoBuildLos"],
      ["designBuildDelaySec", "designBuildLos"],
    ];
    for (const b of buckets) {
      b.rows.forEach((r: any, i: number) => {
        for (const [delayKey, losKey] of pairs) {
          const delay = Number(r?.[delayKey]);
          const los = r?.[losKey];
          if (!Number.isFinite(delay) || typeof los !== "string") continue;
          const expected = delayToLos(delay);
          if (expected === los) continue;
          findings.push({
            clauseId: "losMatchesDelay",
            section: 4,
            type: "DEFECT",
            title: "Reported LOS does not match reported delay",
            detail:
              `${r.name} [${b.period}]: ${delayKey} ${delay} s maps to LOS ${expected}, but the row reports ` +
              `${losKey} ${los}. A letter that disagrees with its own delay means the value was lost or ` +
              `overwritten between computation and response, so every study this engine produced may carry it.`,
            sourceLabel: "lib/tis-engine-core/src/signal-delay.ts — delayToLos",
            readPaths: [
              { path: `result.${b.period}.affectedIntersections[${i}].${delayKey}`, value: delay },
              { path: `result.${b.period}.affectedIntersections[${i}].${losKey}`, value: los },
            ],
            remedy: "File against the engine: the LOS letter and the delay are computed from one value and must not diverge.",
            audience: "admin",
          });
        }
      });
    }
    return { status: "ran", findings };
  },
};

/**
 * A delay at the screening ceiling is a clamp, not a measurement. The
 * calibration multiplier is applied AFTER the clamp at every call site, so the
 * maximum printable delay is SCREENING_MAX_DELAY_SEC x calMul — test with >=,
 * never === 300.
 */
export const screeningClampDisclosed: Clause = {
  id: "screeningClampDisclosed",
  section: 4,
  title: "Delays reported at the screening ceiling are disclosed as clamped",
  run(rec: StudyRecord) {
    const buckets = rowBuckets(rec);
    if (buckets.length === 0) return { status: "not-run", reason: "no affectedIntersections on the record" };
    const clamped: Array<{ label: string; delay: number; path: string }> = [];
    for (const b of buckets) {
      b.rows.forEach((r: any, i: number) => {
        for (const key of ["currentDelaySec", "existingDelaySec", "futureDelaySec", "designNoBuildDelaySec", "designBuildDelaySec"]) {
          const d = Number(r?.[key]);
          if (Number.isFinite(d) && d >= SCREENING_MAX_DELAY_SEC) {
            clamped.push({ label: `${r.name} ${key} [${b.period}]`, delay: d, path: `result.${b.period}.affectedIntersections[${i}].${key}` });
          }
        }
      });
    }
    if (clamped.length === 0) return { status: "ran", findings: [] };
    const prose = [...((rec.result.findings as string[]) ?? []), ...((rec.result.methodology as string[]) ?? [])].join(" ");
    if (/clamp|ceiling|capped/i.test(prose)) return { status: "ran", findings: [] };
    return {
      status: "ran",
      findings: [
        {
          clauseId: "screeningClampDisclosed",
          section: 4,
          type: "DISCLOSE",
          title: "Delays sit at the screening ceiling without disclosure",
          detail:
            `${clamped.length} reported delay(s) are at or above the ${SCREENING_MAX_DELAY_SEC} s screening ceiling ` +
            `(${clamped.slice(0, 3).map((c) => `${c.label} ${c.delay} s`).join("; ")}). At the ceiling the number is a cap, ` +
            `not an estimate, and the deliverable does not say so.`,
          sourceLabel: "lib/tis-engine-core/src/signal-delay.ts — SCREENING_MAX_DELAY_SEC = 300 (times the regional calibration multiplier)",
          readPaths: clamped.map((c) => ({ path: c.path, value: c.delay })),
          remedy: "State in the results section that delays at the ceiling are capped screening values, not estimates of actual delay.",
          audience: "engineer",
        },
      ],
    };
  },
};
```

- [ ] **Step 6: Write `s5-criteria.ts`**

```ts
/**
 * §5 Criteria — the study must name the criteria it was judged against, and
 * their source.
 *
 * This repo stores no agency document, so nothing can verify a threshold
 * against the agency's own published PDF. That is a standing gap, reported as
 * not-run coverage rather than an assumed pass — and never as UNVERIFIED,
 * which is reserved for a source that was reachable in principle.
 */
import type { Clause, StudyRecord } from "./types.ts";

export const criteriaNamed: Clause = {
  id: "criteriaNamed",
  section: 5,
  title: "The governing agency and its criteria are named with a source",
  run(rec: StudyRecord) {
    const agencies = rec.result.agencies as string[] | undefined;
    if (!agencies || agencies.length === 0) {
      return { status: "not-run", reason: "record names no governing agency (result.agencies absent); no agency document is stored anywhere in this system" };
    }
    const prose = [...((rec.result.findings as string[]) ?? []), ...((rec.result.methodology as string[]) ?? [])].join(" ");
    const named = agencies.filter((a) => prose.includes(a));
    if (named.length === agencies.length) return { status: "ran", findings: [] };
    const missing = agencies.filter((a) => !prose.includes(a));
    return {
      status: "ran",
      findings: [
        {
          clauseId: "criteriaNamed",
          section: 5,
          type: "UNVERIFIED",
          title: "Governing criteria are not named in the deliverable text",
          detail:
            `The record names ${agencies.join(", ")} as the governing agency(ies), but ` +
            `${missing.join(", ")} appears nowhere in findings or methodology. Which standard the LOS ` +
            `verdicts were judged against cannot be established from this study.`,
          sourceLabel: "result.agencies, compared against result.findings and result.methodology",
          readPaths: [
            { path: "result.agencies", value: agencies.join("; ") },
            { path: "result.findings.length", value: ((rec.result.findings as string[]) ?? []).length },
          ],
          remedy: "Name the governing agency and the criteria applied, with the published document and section they come from.",
          audience: "engineer",
        },
      ],
    };
  },
};
```

- [ ] **Step 7: Write `s6-limitations.ts`**

```ts
/**
 * §6 Limitations disclosure — what the study did NOT analyze has to be said
 * out loud.
 *
 * Two clauses with no build-time ancestor. The period one enforces the
 * protocol's multifamily-AM-peak example, which nothing enforces today; the
 * scope one recomputes the inputs buildStudyScopeNote reads, honouring that
 * force-included signals come from outside the radius so analyzed may
 * legitimately exceed the in-radius count.
 */
import type { Clause, StudyRecord } from "./types.ts";

const DEFAULT_PERIODS = ["am_peak", "pm_peak", "saturday_midday", "daily"];

export const periodScopeDisclosed: Clause = {
  id: "periodScopeDisclosed",
  section: 6,
  title: "Every requested analysis period is reported, or its absence disclosed",
  run(rec: StudyRecord) {
    const asked = (rec.request.analysisPeriods as string[] | undefined) ?? DEFAULT_PERIODS;
    const reports = (rec.result.periodReports as any[] | undefined) ?? [];
    const reported = new Set<string>(reports.map((p) => String(p.period)));
    if (reported.size === 0 && Array.isArray(rec.result.affectedIntersections)) reported.add("pm_peak");
    const missing = asked.filter((p) => !reported.has(p));
    if (missing.length === 0) return { status: "ran", findings: [] };
    const prose = [...((rec.result.findings as string[]) ?? []), ...((rec.result.methodology as string[]) ?? [])].join(" ");
    const undisclosed = missing.filter((p) => !prose.includes(p) && !prose.toLowerCase().includes(p.replace("_", " ")));
    if (undisclosed.length === 0) return { status: "ran", findings: [] };
    return {
      status: "ran",
      findings: [
        {
          clauseId: "periodScopeDisclosed",
          section: 6,
          type: "DISCLOSE",
          title: "A requested analysis period is neither reported nor disclosed",
          detail:
            `The request asked for ${asked.join(", ")}, the study reports ${[...reported].join(", ") || "none"}, ` +
            `and ${undisclosed.join(", ")} is missing without a word about it. A reader cannot tell whether the ` +
            `peak that governs this land use was analyzed.`,
          sourceLabel: "request.analysisPeriods, compared against result.periodReports[].period",
          readPaths: [
            { path: "request.analysisPeriods", value: asked.join(";") },
            { path: "result.periodReports[].period", value: [...reported].join(";") },
          ],
          remedy: "State which periods were analyzed and why the others were not, in the limitations section.",
          audience: "engineer",
        },
      ],
    };
  },
};

export const scopeNoteConsistent: Clause = {
  id: "scopeNoteConsistent",
  section: 6,
  title: "A study area narrower than its radius is disclosed",
  run(rec: StudyRecord) {
    const inArea = rec.result.intersectionsInStudyArea as number | undefined;
    const merged = rec.result.intersectionsMergedAsDuplicates as number | undefined;
    const studied = Number(rec.result.intersectionsStudied);
    if (inArea === undefined || merged === undefined) return { status: "not-run", reason: "payload predates intersectionsInStudyArea / intersectionsMergedAsDuplicates" };
    if (!Number.isFinite(studied)) return { status: "not-run", reason: "intersectionsStudied absent" };
    // Force-included signals come from outside the radius, so studied > inArea is legitimate.
    if (merged === 0 && studied >= inArea) return { status: "ran", findings: [] };
    const prose = [...((rec.result.findings as string[]) ?? []), ...((rec.result.methodology as string[]) ?? [])].join(" ");
    if (/merged|duplicate|study area/i.test(prose)) return { status: "ran", findings: [] };
    return {
      status: "ran",
      findings: [
        {
          clauseId: "scopeNoteConsistent",
          section: 6,
          type: "DISCLOSE",
          title: "The set analyzed is not the set in the study radius",
          detail:
            `The inventory holds ${inArea} signalized intersection(s) within the ${rec.result.studyRadiusMi} mi radius, ` +
            `${merged} were absorbed as duplicate records of a junction already kept, and ${studied} were analyzed. ` +
            `Merges above 45 m rest on name equality, so this is a prompt to verify, not proof of duplication — and the ` +
            `deliverable says nothing about it.`,
          sourceLabel: "artifacts/tis-api-server/src/lib/study-scope-note.ts — buildStudyScopeNote inputs",
          readPaths: [
            { path: "result.intersectionsInStudyArea", value: inArea },
            { path: "result.intersectionsMergedAsDuplicates", value: merged },
            { path: "result.intersectionsStudied", value: studied },
          ],
          remedy: "Carry the study-scope note into the deliverable, stating the radius population, the merges, and the set analyzed.",
          audience: "engineer",
        },
      ],
    };
  },
};
```

- [ ] **Step 8: Register all nine in `index.ts`**

```ts
import { growthMultiplierReproduces, growthOverrideDisclosed } from "./s1-inputs.ts";
import { passByBasisNamed, rateReproducesTotal } from "./s2-trip-gen.ts";
import {
  losMatchesDelay,
  screeningClampDisclosed,
  vcPlausibilityApproach,
  vcPlausibilityDesignYear,
  vcPlausibilityIntersection,
} from "./s4-results.ts";
import { criteriaNamed } from "./s5-criteria.ts";
import { periodScopeDisclosed, scopeNoteConsistent } from "./s6-limitations.ts";

export const ALL_CLAUSES: Clause[] = [
  growthOverrideDisclosed,
  growthMultiplierReproduces,
  rateReproducesTotal,
  passByBasisNamed,
  vcPlausibilityIntersection,
  vcPlausibilityApproach,
  vcPlausibilityDesignYear,
  losMatchesDelay,
  screeningClampDisclosed,
  criteriaNamed,
  periodScopeDisclosed,
  scopeNoteConsistent,
];
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm --filter @workspace/tis-api-server run check:proofread`
Expected: `ALL CHECKS PASSED`

- [ ] **Step 10: Commit**

```bash
git add artifacts/tis-api-server/src/lib/proofread artifacts/tis-api-server/scripts/verify-proofread.mjs \
  artifacts/tis-api-server/scripts/fixtures/proofread
git commit -m "feat(proofread): the §1, §2, §4, §5 and §6 clauses with per-clause coverage"
```

---

### Task 4: Schema + migration

**Files:**
- Create: `lib/db/src/schema/study-proofread.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `lib/db/migrate.mjs`
- Create: `artifacts/tis-api-server/scripts/verify-proofread-schema.mjs`
- Modify: `artifacts/tis-api-server/package.json`

**Interfaces:**
- Produces: `studyProofreadRunsTable`, `studyProofreadFindingsTable`, `studyProofreadDispositionsTable`, and types `StudyProofreadRun`, `InsertStudyProofreadRun`, `StudyProofreadFinding`, `InsertStudyProofreadFinding`, `StudyProofreadDisposition`, `InsertStudyProofreadDisposition`, all exported from `@workspace/db`.

- [ ] **Step 1: Write the failing test**

Create `artifacts/tis-api-server/scripts/verify-proofread-schema.mjs`:

```js
/**
 * Guard for the proofread tables: the drizzle declaration and the raw
 * migration must agree, and every statement must be idempotent because
 * lib/db/migrate.mjs has no ledger and re-runs on every boot.
 * Run: `pnpm run check:proofread-schema`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const schema = readFileSync(path.join(repo, "lib/db/src/schema/study-proofread.ts"), "utf8");
const barrel = readFileSync(path.join(repo, "lib/db/src/schema/index.ts"), "utf8");
const migrate = readFileSync(path.join(repo, "lib/db/migrate.mjs"), "utf8");

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

ok(/export \* from "\.\/study-proofread"/.test(barrel), "schema barrel re-exports study-proofread");

for (const table of ["study_proofread_runs", "study_proofread_findings", "study_proofread_dispositions"]) {
  ok(schema.includes(`"${table}"`), `drizzle declares ${table}`);
  ok(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`).test(migrate), `migrate creates ${table} idempotently`);
}

// Columns the runner and the routes depend on.
for (const col of ["project_id", "firm_id", "revision", "status", "protocol_version", "rules_version", "engine_stamp", "input_manifest", "coverage", "attempts", "claimed_at", "claimed_by", "error", "requested_by_user_id"]) {
  ok(schema.includes(`"${col}"`), `runs table declares ${col}`);
}
for (const col of ["clause_id", "section", "type", "origin", "source_label", "read_paths", "remedy", "audience", "fingerprint"]) {
  ok(schema.includes(`"${col}"`), `findings table declares ${col}`);
}
for (const col of ["disposition", "note", "actor_user_id"]) {
  ok(schema.includes(`"${col}"`), `dispositions table declares ${col}`);
}

// The advisor boundary, enforced at the schema level.
ok(!/tisProjectsTable\s*,?\s*{[^}]*proofread/i.test(schema), "no proofread column is added to tis_projects");
ok(!/ALTER TABLE tis_projects[^;]*proofread/i.test(migrate), "no migration alters tis_projects for proofread");

// source_label is NOT NULL: a finding with no named source is an opinion.
ok(/sourceLabel[\s\S]{0,120}notNull\(\)/.test(schema), "source_label is NOT NULL");
ok(/readPaths[\s\S]{0,120}notNull\(\)/.test(schema), "read_paths is NOT NULL");

// Every new statement is idempotent and nothing destructive slipped in.
const stmts = [...migrate.matchAll(/id: "(study_proofread[^"]+)",\s*sql: `([^`]+)`/g)];
ok(stmts.length >= 8, `migrate has the proofread statements (${stmts.length})`);
// Idempotency of the findings insert rests on this key existing.
ok(/UQ_study_proofread_findings_run_fp/.test(migrate) && /UQ_study_proofread_findings_run_fp/.test(schema),
  "the (run_id, fingerprint) unique key exists in both the schema and the migration");
ok(/UQ_study_proofread_runs_project_revision/.test(migrate), "the (project_id, revision) unique key exists in the migration");
for (const [, id, sql] of stmts) {
  ok(/IF NOT EXISTS/.test(sql), `${id}: idempotent (IF NOT EXISTS)`);
  ok(!/\bDROP\b|\bRENAME\b|ADD CONSTRAINT/.test(sql), `${id}: no DROP / RENAME / ADD CONSTRAINT`);
  if (/CREATE (UNIQUE )?INDEX/.test(sql)) ok(/"(IDX|UQ)_/.test(sql), `${id}: mixed-case index name is quoted`);
}

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
```

Register it:

```json
    "check:proofread-schema": "node ./scripts/verify-proofread-schema.mjs"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workspace/tis-api-server run check:proofread-schema`
Expected: FAIL — `ENOENT lib/db/src/schema/study-proofread.ts`

- [ ] **Step 3: Write `lib/db/src/schema/study-proofread.ts`**

```ts
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { firmsTable } from "./firms";
import { tisProjectsTable } from "./tis-projects";

/**
 * One proofread pass over one saved study
 * (docs/superpowers/specs/2026-09-29-datum-in-product-design.md).
 *
 * A run is a pure function of the tis_projects row it points at, so it is
 * re-runnable and auditable without the engine. Nothing here writes back to
 * the study: Datum advises, it never edits. A re-run is a new revision, so an
 * earlier pass stays readable.
 */
export const studyProofreadRunsTable = pgTable(
  "study_proofread_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    // Findings only mean something against one study snapshot, so they die with it.
    projectId: uuid("project_id")
      .notNull()
      .references(() => tisProjectsTable.id, { onDelete: "cascade" }),
    // Derivable from the project, carried anyway: every read is firm-scoped,
    // and tis_projects.firmId is nullable on legacy rows.
    firmId: uuid("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    // 'queued' → claimed → 'running' → 'rules_ready' (deterministic clauses done;
    // the terminal state in phase 1) → 'ready' (phase 2 judgment pass done) |
    // 'failed' (attempts exhausted).
    status: varchar("status", { length: 16 }).notNull().default("queued"),
    protocolVersion: varchar("protocol_version", { length: 32 }).notNull(),
    rulesVersion: varchar("rules_version", { length: 32 }).notNull(),
    // Which engine produced the study this run judged. Nothing in the payload
    // records it, so a finding could not otherwise be attributed.
    engineStamp: varchar("engine_stamp", { length: 64 }).notNull(),
    // Which declared inputs were present on the record, so partial coverage on
    // a historical study is a stated fact rather than a silent pass.
    inputManifest: jsonb("input_manifest").notNull(),
    // Per-clause ran / not-run + reason. Never per-section: only two of the six
    // protocol sections are fully checkable from a saved record.
    coverage: jsonb("coverage").notNull(),
    model: varchar("model", { length: 64 }),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    attempts: integer("attempts").notNull().default(0),
    // A claim is a lease: a row whose claim is older than the lease is
    // reclaimable, which is what recovers a container recycled mid-run.
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimedBy: varchar("claimed_by", { length: 64 }),
    error: text("error"),
    requestedByUserId: varchar("requested_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    // UNIQUE, not a plain index: the revision is derived in SQL (see
    // insertQueuedRun) and two concurrent re-run requests must not both land
    // revision N — a duplicate would make `orderBy(desc(revision)).limit(1)`
    // nondeterministic and split one study's findings across two rows.
    uniqueIndex("UQ_study_proofread_runs_project_revision").on(table.projectId, table.revision),
    index("IDX_study_proofread_runs_status").on(table.status, table.createdAt),
  ],
);

export type StudyProofreadRun = typeof studyProofreadRunsTable.$inferSelect;
export type InsertStudyProofreadRun = typeof studyProofreadRunsTable.$inferInsert;

/**
 * One finding. `sourceLabel` and `readPaths` are NOT NULL on purpose: a finding
 * with no named source is an opinion, not a finding. There is no patch column —
 * `remedy` is prose for a person to act on.
 */
export const studyProofreadFindingsTable = pgTable(
  "study_proofread_findings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    runId: uuid("run_id")
      .notNull()
      .references(() => studyProofreadRunsTable.id, { onDelete: "cascade" }),
    clauseId: varchar("clause_id", { length: 64 }).notNull(),
    section: smallint("section").notNull(),
    // BLOCKER | DEFECT | DISCLOSE | NOTE | UNVERIFIED | CONTESTED
    type: varchar("type", { length: 12 }).notNull(),
    // 'rule' in phase 1; 'model' once the judgment pass ships.
    origin: varchar("origin", { length: 8 }).notNull().default("rule"),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    sourceLabel: text("source_label").notNull(),
    readPaths: jsonb("read_paths").notNull(),
    remedy: text("remedy").notNull(),
    // engineer | pe | admin. DEFECT is admin: a PE cannot rule on a software fault.
    audience: varchar("audience", { length: 12 }).notNull().default("engineer"),
    // hash32(clauseId | section | sorted readPaths) — the key a disposition
    // carries forward across a re-run.
    fingerprint: varchar("fingerprint", { length: 32 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [
    index("IDX_study_proofread_findings_run").on(table.runId),
    index("IDX_study_proofread_findings_fingerprint").on(table.fingerprint),
    // A retried run re-derives the same findings. The unique key plus
    // onConflictDoNothing makes the insert idempotent instead of duplicating
    // every finding on the second attempt.
    uniqueIndex("UQ_study_proofread_findings_run_fp").on(table.runId, table.fingerprint),
  ],
);

export type StudyProofreadFinding = typeof studyProofreadFindingsTable.$inferSelect;
export type InsertStudyProofreadFinding = typeof studyProofreadFindingsTable.$inferInsert;

/**
 * Append-only triage log. The current disposition of a finding is its latest
 * row. Append-only because ACCEPTED_RISK has to record who accepted it and
 * when — a mutable status column loses exactly that.
 */
export const studyProofreadDispositionsTable = pgTable(
  "study_proofread_dispositions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    findingId: uuid("finding_id")
      .notNull()
      .references(() => studyProofreadFindingsTable.id, { onDelete: "cascade" }),
    // FIXED | BUG_FILED | DISCLOSED | WITHDRAWN | CONTESTED_PE | ACCEPTED_RISK
    disposition: varchar("disposition", { length: 16 }).notNull(),
    note: text("note"),
    // Required for WITHDRAWN: Datum withdraws on a source, never on an argument.
    sourceLabel: text("source_label"),
    actorUserId: varchar("actor_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => [index("IDX_study_proofread_dispositions_finding").on(table.findingId, table.createdAt)],
);

export type StudyProofreadDisposition = typeof studyProofreadDispositionsTable.$inferSelect;
export type InsertStudyProofreadDisposition = typeof studyProofreadDispositionsTable.$inferInsert;
```

- [ ] **Step 4: Register in the barrel**

Append to `lib/db/src/schema/index.ts`:

```ts
export * from "./study-proofread";
```

- [ ] **Step 5: Add the migration statements**

Append to `SQL_STATEMENTS` in `lib/db/migrate.mjs`, after the theme backfill entries:

```js
  // Proofread runs (docs/superpowers/specs/2026-09-29-datum-in-product-design.md):
  // one pass over one saved study, its findings, and an append-only triage log.
  // Nothing here writes back to tis_projects — Datum advises, never edits.
  { id: "study_proofread_runs.create", sql: `CREATE TABLE IF NOT EXISTS study_proofread_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES tis_projects(id) ON DELETE CASCADE,
      firm_id UUID NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 1,
      status VARCHAR(16) NOT NULL DEFAULT 'queued',
      protocol_version VARCHAR(32) NOT NULL,
      rules_version VARCHAR(32) NOT NULL,
      engine_stamp VARCHAR(64) NOT NULL,
      input_manifest JSONB NOT NULL,
      coverage JSONB NOT NULL,
      model VARCHAR(64),
      input_tokens INTEGER,
      output_tokens INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      claimed_at TIMESTAMPTZ,
      claimed_by VARCHAR(64),
      error TEXT,
      requested_by_user_id VARCHAR,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    );` },
  { id: "study_proofread_runs.uq_project_revision", sql: `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_study_proofread_runs_project_revision" ON study_proofread_runs (project_id, revision);` },
  { id: "study_proofread_runs.idx_status",  sql: `CREATE INDEX IF NOT EXISTS "IDX_study_proofread_runs_status" ON study_proofread_runs (status, created_at);` },
  { id: "study_proofread_findings.create", sql: `CREATE TABLE IF NOT EXISTS study_proofread_findings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      run_id UUID NOT NULL REFERENCES study_proofread_runs(id) ON DELETE CASCADE,
      clause_id VARCHAR(64) NOT NULL,
      section SMALLINT NOT NULL,
      type VARCHAR(12) NOT NULL,
      origin VARCHAR(8) NOT NULL DEFAULT 'rule',
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      source_label TEXT NOT NULL,
      read_paths JSONB NOT NULL,
      remedy TEXT NOT NULL,
      audience VARCHAR(12) NOT NULL DEFAULT 'engineer',
      fingerprint VARCHAR(32) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );` },
  { id: "study_proofread_findings.idx_run", sql: `CREATE INDEX IF NOT EXISTS "IDX_study_proofread_findings_run" ON study_proofread_findings (run_id);` },
  { id: "study_proofread_findings.idx_fp",  sql: `CREATE INDEX IF NOT EXISTS "IDX_study_proofread_findings_fingerprint" ON study_proofread_findings (fingerprint);` },
  { id: "study_proofread_findings.uq_run_fp", sql: `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_study_proofread_findings_run_fp" ON study_proofread_findings (run_id, fingerprint);` },
  { id: "study_proofread_dispositions.create", sql: `CREATE TABLE IF NOT EXISTS study_proofread_dispositions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      finding_id UUID NOT NULL REFERENCES study_proofread_findings(id) ON DELETE CASCADE,
      disposition VARCHAR(16) NOT NULL,
      note TEXT,
      source_label TEXT,
      actor_user_id VARCHAR NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );` },
  { id: "study_proofread_dispositions.idx_finding", sql: `CREATE INDEX IF NOT EXISTS "IDX_study_proofread_dispositions_finding" ON study_proofread_dispositions (finding_id, created_at);` },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @workspace/tis-api-server run check:proofread-schema`
Expected: `ALL CHECKS PASSED`

- [ ] **Step 7: Typecheck the workspace libs**

Run: `pnpm run typecheck:libs`
Expected: no errors (drizzle types resolve, barrel export compiles).

- [ ] **Step 8: Commit**

```bash
git add lib/db/src/schema/study-proofread.ts lib/db/src/schema/index.ts lib/db/migrate.mjs \
  artifacts/tis-api-server/scripts/verify-proofread-schema.mjs artifacts/tis-api-server/package.json
git commit -m "feat(proofread): study_proofread_runs, findings and an append-only disposition log"
```

---

### Task 5: Run lifecycle (claim lease, attempts, transitions)

The repo has no jobs table, no scheduler, and no locking primitive — `pg_advisory`, `FOR UPDATE` and `SKIP LOCKED` appear zero times — while the process is multi-instance by design. The decision logic is extracted as a pure module so it can be tested without a database.

**Files:**
- Create: `artifacts/tis-api-server/src/lib/proofread/lifecycle.ts`
- Modify: `artifacts/tis-api-server/scripts/verify-proofread.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `LEASE_MS = 600_000`, `MAX_ATTEMPTS = 3`, `RunRowState = { status: string; claimedAt: Date | null; attempts: number }`, `isReclaimable(row: RunRowState, now: Date): boolean`, `nextStatusAfterFailure(row: RunRowState): "queued" | "failed"`, `CLAIM_SQL: string`.

- [ ] **Step 1: Write the failing test**

Append to `artifacts/tis-api-server/scripts/verify-proofread.mjs`:

```js
// --- run lifecycle --------------------------------------------------------
{
  const { isReclaimable, nextStatusAfterFailure, LEASE_MS, MAX_ATTEMPTS, CLAIM_SQL } = await import(
    path.resolve(here, "../src/lib/proofread/lifecycle.ts")
  );
  const now = new Date("2026-09-30T12:00:00Z");
  const ago = (ms) => new Date(now.getTime() - ms);

  ok(isReclaimable({ status: "queued", claimedAt: null, attempts: 0 }, now), "a queued row is claimable");
  ok(!isReclaimable({ status: "running", claimedAt: ago(60_000), attempts: 1 }, now), "a fresh claim is not stolen");
  ok(isReclaimable({ status: "running", claimedAt: ago(LEASE_MS + 1), attempts: 1 }, now), "an expired lease is reclaimable");
  ok(!isReclaimable({ status: "rules_ready", claimedAt: ago(LEASE_MS + 1), attempts: 1 }, now), "a finished row is never reclaimed");
  ok(!isReclaimable({ status: "failed", claimedAt: null, attempts: 3 }, now), "a failed row is never reclaimed");
  ok(!isReclaimable({ status: "running", claimedAt: null, attempts: 1 }, now), "a running row with no claim time is left alone");

  ok(nextStatusAfterFailure({ status: "running", claimedAt: now, attempts: 1 }) === "queued", "attempt 1 failure requeues");
  ok(nextStatusAfterFailure({ status: "running", claimedAt: now, attempts: MAX_ATTEMPTS }) === "failed", "the last attempt fails terminally");

  ok(/SKIP LOCKED/.test(CLAIM_SQL), "the claim uses SKIP LOCKED so two instances cannot take one row");
  ok(/FOR UPDATE/.test(CLAIM_SQL), "the claim locks the row it selects");
  ok(/LIMIT 1/.test(CLAIM_SQL), "the claim takes one row per call");
  ok(/RETURNING/.test(CLAIM_SQL), "the claim returns the row it took");
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workspace/tis-api-server run check:proofread`
Expected: FAIL — cannot resolve `lifecycle.ts`

- [ ] **Step 3: Write `lifecycle.ts`**

```ts
/**
 * Run-claim policy, as pure predicates.
 *
 * This service runs on several instances (lib/redis.ts:5-9, .replit
 * deploymentTarget="autoscale") and the repo has no jobs table, no scheduler
 * and no locking primitive, so this is the first one. Two rules do the work:
 *
 *   - A claim is a LEASE. A row claimed longer ago than the lease is
 *     reclaimable, which is what recovers a container recycled mid-run.
 *   - Redis is never load-bearing: REDIS_URL is optional and unset in dev, and
 *     every existing use fails open. The claim is a Postgres row.
 *
 * There is no scheduler, so the sweep is opportunistic — attempted on enqueue
 * and on each read, one claim per call.
 */
export const LEASE_MS = 600_000; // 10 minutes
export const MAX_ATTEMPTS = 3;

export type RunRowState = { status: string; claimedAt: Date | null; attempts: number };

export function isReclaimable(row: RunRowState, now: Date): boolean {
  if (row.status === "queued") return true;
  if (row.status !== "running") return false;
  if (!row.claimedAt) return false; // mid-write; leave it for the next sweep
  return now.getTime() - row.claimedAt.getTime() > LEASE_MS;
}

export function nextStatusAfterFailure(row: RunRowState): "queued" | "failed" {
  return row.attempts >= MAX_ATTEMPTS ? "failed" : "queued";
}

/**
 * Claim one row for this instance. $1 is the instance id. Parameterized and
 * executed through drizzle's sql`` in proofread-store.ts; kept here as one
 * string so the policy and its SQL live together and the guard can assert it.
 */
export const CLAIM_SQL = `
UPDATE study_proofread_runs
   SET status = 'running', claimed_at = now(), claimed_by = $1, attempts = attempts + 1
 WHERE id = (
   SELECT id FROM study_proofread_runs
    WHERE status = 'queued'
       OR (status = 'running' AND claimed_at IS NOT NULL AND claimed_at < now() - interval '10 minutes')
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
 )
RETURNING *;`;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/tis-api-server run check:proofread`
Expected: `ALL CHECKS PASSED`

- [ ] **Step 5: Commit**

```bash
git add artifacts/tis-api-server/src/lib/proofread/lifecycle.ts artifacts/tis-api-server/scripts/verify-proofread.mjs
git commit -m "feat(proofread): lease-based claim policy for a multi-instance deploy"
```

---

### Task 6: Store + runner + the enqueue hook

**Files:**
- Create: `artifacts/tis-api-server/src/lib/proofread-store.ts`
- Create: `artifacts/tis-api-server/src/lib/proofread-run.ts`
- Modify: `artifacts/tis-api-server/src/routes/tis.ts` (between the `if (!saved)` branch and `res.json`)
- Modify: `lib/tis-api-spec/openapi.yaml` (`projectId` on the generate response)
- Create: `artifacts/tis-api-server/scripts/verify-proofread-hook.mjs`
- Modify: `artifacts/tis-api-server/package.json`

**Interfaces:**
- Consumes: `runClauses`, `ALL_CLAUSES`, `findingFingerprint`, `engineStamp`, `RULES_VERSION` (Task 2/3); `CLAIM_SQL`, `nextStatusAfterFailure` (Task 5); the three tables (Task 4).
- Produces: `enqueueProofread(args: { projectId: string; firmId: string; userId: string }): Promise<void>`; `claimAndRunOne(): Promise<boolean>`; `insertQueuedRun(...)`; `claimOneRun(instanceId: string)`; `loadStudyForRun(run)`; `completeRun(...)`; `latestRunForProject(firmId: string, projectId: string)`; `previousRunForProject(projectId: string, beforeRevision: number)`; `carryForwardDispositions(newRunId: string, previousRunId: string, sameEngine: boolean): Promise<number>`; `insertDisposition(...)`; `findingBelongsToFirm(firmId, findingId)`; `buildInputManifest(rec: StudyRecord): Record<string, boolean>`.

- [ ] **Step 1: Write the failing test**

Create `artifacts/tis-api-server/scripts/verify-proofread-hook.mjs`:

```js
/**
 * Guard for the enqueue hook's placement and the generate response contract.
 *
 * The hook has exactly one safe window: after the `if (!saved)` refund branch
 * and before `res.json(validated)`. After res.json it would sit inside the
 * handler's catch, which calls releaseStudySlot and res.status().json() — a
 * throw there refunds quota spuriously and writes to a sent response. Inside
 * saveProject is wrong too: it swallows every error and returns null by
 * contract. Source-text guard, in the style of verify-vc-plausibility-guard.mjs.
 * Run: `pnpm run check:proofread-hook`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(path.resolve(here, p), "utf8");
const tis = src("../src/routes/tis.ts");
const store = src("../src/lib/tis-projects.ts");

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

const lines = tis.split("\n");
const idx = (needle) => lines.findIndex((l) => l.includes(needle));
const enqueue = idx("enqueueProofread(");
const refund = idx("if (!saved)");
// Anchor on the POST-edit text. `res.json(validated)` no longer exists in the
// generate handler after Step 5, and findIndex would silently match the
// /whatif handler's identical line further down the file.
const respond = lines.findIndex((l) => /res\.json\(\{\s*\.\.\.validated,\s*projectId/.test(l));

ok(enqueue > 0, "the generate handler enqueues a proofread");
ok(enqueue > refund, "the enqueue sits after the !saved refund branch");
ok(respond > 0, "the generate handler responds with the merged payload");
ok(enqueue < respond, "the enqueue sits before the response");
ok(respond - enqueue < 12, "the enqueue is adjacent to the response, not stranded elsewhere in the handler");
ok(/void enqueueProofread\(/.test(tis), "the enqueue is fire-and-forget (void), like the adjacent logEvent");
ok(/enqueueProofread\([^)]*\)[\s\S]{0,200}?\.catch\(/.test(tis), "the fire-and-forget call has its own .catch");
ok(!/await enqueueProofread/.test(tis), "the enqueue never delays the engineer's response");
ok(!/enqueueProofread/.test(store), "saveProject does not enqueue (it swallows errors by contract)");

// A re-run must carry dispositions forward, or a WITHDRAWN item silently reopens.
const runner = src("../src/lib/proofread-run.ts");
ok(/carryForwardDispositions\(/.test(runner), "the runner carries dispositions forward after a run");
ok(/previousRunForProject\(/.test(runner), "the carry-forward looks up the previous revision");
ok(/engineStamp === run\.engineStamp/.test(runner), "carry-forward only applies under an unchanged engine stamp");

// The response must carry the id the panel polls with, merged AFTER the parse:
// GenerateTisResponse is a strip-unknown-keys zod object.
ok(/res\.json\(\{\s*\.\.\.validated,\s*projectId: saved\.id\s*\}\)/.test(tis), "the response merges projectId after the zod parse");

const spec = src("../../../lib/tis-api-spec/openapi.yaml");
ok(/projectId/.test(spec), "openapi.yaml documents projectId on the generate response");

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
```

Register:

```json
    "check:proofread-hook": "node ./scripts/verify-proofread-hook.mjs"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workspace/tis-api-server run check:proofread-hook`
Expected: FAIL — no `enqueueProofread` in `tis.ts`, no `projectId` merge.

- [ ] **Step 3: Write `proofread-store.ts`**

```ts
/**
 * Persistence for proofread runs. Separate from src/lib/proofread/, which must
 * stay importable under plain node — this module imports @workspace/db, which
 * throws at module evaluation when DATABASE_URL is unset.
 *
 * Every read is firm-scoped in its WHERE clause; there is no middleware that
 * does it, and a findings read by project id alone would leak across firms.
 */
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  db,
  studyProofreadDispositionsTable,
  studyProofreadFindingsTable,
  studyProofreadRunsTable,
  tisProjectsTable,
  type StudyProofreadRun,
} from "@workspace/db";
import { logger } from "./logger";
import { CLAIM_SQL } from "./proofread/lifecycle.ts";
import type { ProofreadFinding } from "./proofread/index.ts";
import { findingFingerprint } from "./proofread/index.ts";

export async function insertQueuedRun(args: {
  projectId: string;
  firmId: string;
  userId: string;
  protocolVersion: string;
  rulesVersion: string;
  engineStamp: string;
}): Promise<StudyProofreadRun | null> {
  // The revision is derived inside the INSERT so the read and the write are one
  // statement. Read-then-insert would let two quick presses of "Run again" both
  // read the same max and both write revision N; the (project_id, revision)
  // unique key then rejects the loser instead of silently duplicating it.
  const [row] = await db
    .insert(studyProofreadRunsTable)
    .values({
      projectId: args.projectId,
      firmId: args.firmId,
      revision: sql`(SELECT coalesce(max(revision), 0) + 1 FROM study_proofread_runs WHERE project_id = ${args.projectId})`,
      status: "queued",
      protocolVersion: args.protocolVersion,
      rulesVersion: args.rulesVersion,
      engineStamp: args.engineStamp,
      inputManifest: {},
      coverage: [],
      requestedByUserId: args.userId,
    })
    .returning();
  return row ?? null;
}

/**
 * Claim one queued or lease-expired row for this instance. Null when there is
 * nothing to do.
 *
 * Goes through the query builder, NOT `db.execute(sql.raw(...))`: `execute`
 * passes no field map (drizzle pg-core `db.js` → `prepareQuery(builtQuery,
 * void 0, ...)`), so a raw `RETURNING *` comes back keyed by the literal
 * Postgres column names. The repo's only other raw query types its result in
 * snake_case for exactly that reason (`src/lib/atr-counts.ts:408`). A cast to
 * the camelCase `$inferSelect` shape would type-check and then hand every
 * caller `projectId: undefined`. `.returning()` maps the columns properly, and
 * binding `claimedBy` as a parameter also removes the string interpolation the
 * raw form needed.
 *
 * The predicate is the one in CLAIM_SQL: a queued row, or a running row whose
 * lease has expired.
 */
export async function claimOneRun(instanceId: string): Promise<StudyProofreadRun | null> {
  const [row] = await db
    .update(studyProofreadRunsTable)
    .set({
      status: "running",
      claimedAt: new Date(),
      claimedBy: instanceId,
      attempts: sql`${studyProofreadRunsTable.attempts} + 1`,
    })
    .where(
      sql`${studyProofreadRunsTable.id} = (
        SELECT id FROM study_proofread_runs
         WHERE status = 'queued'
            OR (status = 'running' AND claimed_at IS NOT NULL AND claimed_at < now() - interval '10 minutes')
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
      )`,
    )
    .returning();
  return row ?? null;
}

export async function loadStudyForRun(run: StudyProofreadRun) {
  const [row] = await db
    .select({ request: tisProjectsTable.requestPayload, result: tisProjectsTable.resultPayload })
    .from(tisProjectsTable)
    .where(and(eq(tisProjectsTable.id, run.projectId), eq(tisProjectsTable.firmId, run.firmId)))
    .limit(1);
  return row ?? null;
}

/**
 * Write a run's outcome. Safe to call twice for the same run: a requeue after
 * a partial success must not duplicate findings, and must not erase the
 * coverage the successful clause pass already recorded.
 */
export async function completeRun(args: {
  runId: string;
  status: "rules_ready" | "failed" | "queued";
  coverage?: unknown;
  inputManifest?: unknown;
  findings: ProofreadFinding[];
  error?: string;
}): Promise<void> {
  await db
    .update(studyProofreadRunsTable)
    .set({
      status: args.status,
      // Omitted on a requeue: the previous attempt's coverage is better than {}.
      ...(args.coverage === undefined ? {} : { coverage: args.coverage as object }),
      ...(args.inputManifest === undefined ? {} : { inputManifest: args.inputManifest as object }),
      error: args.error ?? null,
      finishedAt: args.status === "queued" ? null : new Date(),
    })
    .where(eq(studyProofreadRunsTable.id, args.runId));
  if (args.findings.length === 0) return;
  await db.insert(studyProofreadFindingsTable).values(
    args.findings.map((f) => ({
      runId: args.runId,
      clauseId: f.clauseId,
      section: f.section,
      type: f.type,
      origin: "rule" as const,
      title: f.title,
      detail: f.detail,
      sourceLabel: f.sourceLabel,
      readPaths: f.readPaths as unknown as object,
      remedy: f.remedy,
      audience: f.audience,
      fingerprint: findingFingerprint(f),
    })),
  ).onConflictDoNothing({
    target: [studyProofreadFindingsTable.runId, studyProofreadFindingsTable.fingerprint],
  });
}

export async function latestRunForProject(firmId: string, projectId: string) {
  const [run] = await db
    .select()
    .from(studyProofreadRunsTable)
    .where(and(eq(studyProofreadRunsTable.firmId, firmId), eq(studyProofreadRunsTable.projectId, projectId)))
    .orderBy(desc(studyProofreadRunsTable.revision))
    .limit(1);
  if (!run) return null;
  const findings = await db
    .select()
    .from(studyProofreadFindingsTable)
    .where(eq(studyProofreadFindingsTable.runId, run.id));
  // Scoped in SQL, not filtered in JS: this is the read the panel polls, and
  // an unbounded select over every firm's triage rows grows with the table.
  // Uses the (finding_id, created_at) index.
  const dispositions = findings.length
    ? await db
        .select()
        .from(studyProofreadDispositionsTable)
        .where(inArray(studyProofreadDispositionsTable.findingId, findings.map((f) => f.id)))
        .orderBy(desc(studyProofreadDispositionsTable.createdAt))
    : [];
  return { run, findings, dispositions };
}

/** The run before `revision` on this project, with the engine it judged — the source of a carry-forward. */
export async function previousRunForProject(
  projectId: string,
  beforeRevision: number,
): Promise<{ id: string; engineStamp: string } | null> {
  const [row] = await db
    .select({ id: studyProofreadRunsTable.id, engineStamp: studyProofreadRunsTable.engineStamp })
    .from(studyProofreadRunsTable)
    .where(
      and(
        eq(studyProofreadRunsTable.projectId, projectId),
        lt(studyProofreadRunsTable.revision, beforeRevision),
        // Only a run that finished its clause pass holds dispositions worth
        // carrying. A failed or still-queued revision would carry nothing and,
        // because this looks exactly one revision back, would strand the
        // dispositions recorded on the revision before it.
        eq(studyProofreadRunsTable.status, "rules_ready"),
      ),
    )
    .orderBy(desc(studyProofreadRunsTable.revision))
    .limit(1);
  return row ?? null;
}

/** Carry dispositions forward to a new run by fingerprint, under the same engine stamp. */
export async function carryForwardDispositions(newRunId: string, previousRunId: string, sameEngine: boolean): Promise<number> {
  if (!sameEngine) return 0;
  const [oldF, newF] = await Promise.all([
    db.select().from(studyProofreadFindingsTable).where(eq(studyProofreadFindingsTable.runId, previousRunId)),
    db.select().from(studyProofreadFindingsTable).where(eq(studyProofreadFindingsTable.runId, newRunId)),
  ]);
  let carried = 0;
  for (const nf of newF) {
    const match = oldF.find((of) => of.fingerprint === nf.fingerprint);
    if (!match) continue;
    const prior = await db
      .select()
      .from(studyProofreadDispositionsTable)
      .where(eq(studyProofreadDispositionsTable.findingId, match.id))
      .orderBy(desc(studyProofreadDispositionsTable.createdAt))
      .limit(1);
    if (!prior[0]) continue;
    await db.insert(studyProofreadDispositionsTable).values({
      findingId: nf.id,
      disposition: prior[0].disposition,
      note: prior[0].note,
      sourceLabel: prior[0].sourceLabel,
      actorUserId: prior[0].actorUserId,
    });
    carried++;
  }
  if (carried) logger.info({ newRunId, previousRunId, carried }, "proofread.dispositions_carried");
  return carried;
}

export async function insertDisposition(args: {
  findingId: string;
  disposition: string;
  note?: string;
  sourceLabel?: string;
  actorUserId: string;
}): Promise<void> {
  await db.insert(studyProofreadDispositionsTable).values({
    findingId: args.findingId,
    disposition: args.disposition,
    note: args.note ?? null,
    sourceLabel: args.sourceLabel ?? null,
    actorUserId: args.actorUserId,
  });
}

/** The URL asserts firm → project → run → finding; verify all of it in one query. */
export async function findingInFirmRun(
  firmId: string,
  projectId: string,
  runId: string,
  findingId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: studyProofreadFindingsTable.id })
    .from(studyProofreadFindingsTable)
    .innerJoin(studyProofreadRunsTable, eq(studyProofreadFindingsTable.runId, studyProofreadRunsTable.id))
    .where(
      and(
        eq(studyProofreadFindingsTable.id, findingId),
        eq(studyProofreadRunsTable.id, runId),
        eq(studyProofreadRunsTable.projectId, projectId),
        eq(studyProofreadRunsTable.firmId, firmId),
      ),
    )
    .limit(1);
  return !!row;
}
```

- [ ] **Step 4: Write `proofread-run.ts`**

```ts
/**
 * The proofread runner: enqueue, then claim-and-run.
 *
 * Fail-open throughout. A proofread that cannot run never affects the study —
 * the same contract saveProject holds. Phase 1 ends at 'rules_ready'; the
 * judgment pass will take it to 'ready'.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { logger } from "./logger";
import { ALL_CLAUSES, engineStamp, RULES_VERSION, runClauses, type StudyRecord } from "./proofread/index.ts";
import { nextStatusAfterFailure } from "./proofread/lifecycle.ts";
import {
  carryForwardDispositions,
  claimOneRun,
  completeRun,
  insertQueuedRun,
  loadStudyForRun,
  previousRunForProject,
} from "./proofread-store";

const INSTANCE_ID = `${process.env.RAILWAY_REPLICA_ID ?? process.env.HOSTNAME ?? "local"}-${process.pid}`;

/** Read once at boot: the protocol version every run record must carry (§Logging). */
const PROTOCOL_VERSION = (() => {
  try {
    const txt = readFileSync(path.resolve(process.cwd(), "TIS-PROOFREAD-PROTOCOL.md"), "utf8");
    return /^PROTOCOL_VERSION:\s*(\S+)$/m.exec(txt)?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
})();

/** Which declared inputs the record actually carries, so partial coverage is a stated fact. */
export function buildInputManifest(rec: StudyRecord): Record<string, boolean> {
  const r = rec.result as Record<string, any>;
  const rows: any[] = Array.isArray(r.affectedIntersections) ? r.affectedIntersections : [];
  return {
    currentVc: rows.some((x) => x?.currentVc !== undefined),
    designYear: rows.some((x) => x?.designBuildVc !== undefined || x?.designNoBuildVc !== undefined),
    approaches: rows.some((x) => Array.isArray(x?.approaches) && x.approaches.length > 0),
    signalTiming: rows.some((x) => x?.signalTiming !== undefined),
    tripGenRates: r.tripGeneration?.pmRate !== undefined,
    growthMultiplier: r.growthMultiplierExact !== undefined,
    scopeCounts: r.intersectionsInStudyArea !== undefined && r.intersectionsMergedAsDuplicates !== undefined,
    agencies: Array.isArray(r.agencies) && r.agencies.length > 0,
    periodReports: Array.isArray(r.periodReports) && r.periodReports.length > 0,
  };
}

/** Queue a run, then opportunistically drain one — there is no scheduler in this service. */
export async function enqueueProofread(args: { projectId: string; firmId: string; userId: string }): Promise<void> {
  const run = await insertQueuedRun({
    ...args,
    protocolVersion: PROTOCOL_VERSION,
    rulesVersion: RULES_VERSION,
    engineStamp: engineStamp(),
  });
  if (!run) {
    logger.warn({ projectId: args.projectId }, "proofread.enqueue_failed");
    return;
  }
  await claimAndRunOne();
}

/** Claim at most one run and execute the clauses. Returns whether work was done. */
export async function claimAndRunOne(): Promise<boolean> {
  let run;
  try {
    run = await claimOneRun(INSTANCE_ID);
  } catch (err) {
    logger.error({ err }, "proofread.claim_failed");
    return false;
  }
  if (!run) return false;
  try {
    const study = await loadStudyForRun(run);
    if (!study) {
      await completeRun({ runId: run.id, status: "failed", coverage: [], inputManifest: {}, findings: [], error: "study row not found" });
      return true;
    }
    const rec: StudyRecord = { request: (study.request ?? {}) as any, result: (study.result ?? {}) as any };
    const { findings, coverage } = runClauses(rec, ALL_CLAUSES);
    await completeRun({
      runId: run.id,
      status: "rules_ready",
      coverage,
      inputManifest: buildInputManifest(rec),
      findings,
    });
    // A re-run must not reopen a WITHDRAWN item or lose an ACCEPTED RISK with
    // its named person. Dispositions carry forward by fingerprint, and only
    // when the engine that produced the study has not changed underneath them.
    const prev = await previousRunForProject(run.projectId, run.revision);
    if (prev) await carryForwardDispositions(run.id, prev.id, prev.engineStamp === run.engineStamp);
    logger.info({ runId: run.id, findings: findings.length }, "proofread.rules_ready");
    return true;
  } catch (err) {
    const status = nextStatusAfterFailure({ status: run.status, claimedAt: run.claimedAt, attempts: run.attempts });
    await completeRun({
      runId: run.id,
      status,
      coverage: [],
      inputManifest: {},
      findings: [],
      error: err instanceof Error ? err.message : String(err),
    }).catch(() => undefined);
    logger.error({ err, runId: run.id, status }, "proofread.run_failed");
    return true;
  }
}
```

- [ ] **Step 5: Add the hook and the response id in `routes/tis.ts`**

Add to the imports:

```ts
import { enqueueProofread } from "../lib/proofread-run";
```

Replace the `logEvent(...)` + `res.json(validated)` tail of the `/generate` handler with:

```ts
    logEvent("study_generated", {
      firmId: firm.id,
      userId: user.id,
      metadata: { studyType: "tis", landUseCode: parsed.data.landUseCode },
    });
    // Queue the proofread pass. Fire-and-forget, before the response is sent:
    // anything after res.json() sits inside this handler's catch, which
    // refunds the quota slot and writes to an already-sent response.
    void enqueueProofread({ projectId: saved.id, firmId: firm.id, userId: user.id }).catch((err) => {
      req.log.error({ err, projectId: saved.id }, "proofread.enqueue_error");
    });
    // projectId is merged AFTER the parse: GenerateTisResponse is a
    // strip-unknown-keys zod object, so an id attached to `report` is dropped.
    res.json({ ...validated, projectId: saved.id });
```

- [ ] **Step 6: Document `projectId` in the spec and regenerate**

`/generate`'s 200 is `$ref: "#/components/schemas/TisReport"`, and that same `TisReport` is also `/whatif`'s 200 and `TisProjectDetail.result` — so adding the property to `TisReport` would document a project id on an endpoint that saves nothing and on a stored result that has no such field. Add a new schema beside `TisReport` instead, and repoint only `/generate`:

```yaml
    TisGenerateResponse:
      allOf:
        - $ref: "#/components/schemas/TisReport"
        - type: object
          properties:
            projectId:
              type: string
              format: uuid
              description: The saved project this study was persisted as. Poll GET /projects/{id}/proofread with it.
```

Then change `/generate`'s 200 `$ref` to `#/components/schemas/TisGenerateResponse`, leaving `/whatif` and `TisProjectDetail.result` pointed at `TisReport`.

Run: `pnpm --filter @workspace/tis-api-spec run codegen`
Note: `clean: true` wipes both generated trees, so never hand-edit anything under `generated/`.

- [ ] **Step 7: Run the guards**

Run: `pnpm --filter @workspace/tis-api-server run check:proofread-hook`
Expected: `ALL CHECKS PASSED`

Run: `pnpm run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add artifacts/tis-api-server/src/lib/proofread-store.ts artifacts/tis-api-server/src/lib/proofread-run.ts \
  artifacts/tis-api-server/src/routes/tis.ts lib/tis-api-spec/openapi.yaml lib/tis-api-zod lib/tis-api-client-react \
  artifacts/tis-api-server/scripts/verify-proofread-hook.mjs artifacts/tis-api-server/package.json
git commit -m "feat(proofread): runner, lease claim, and the post-save enqueue that never delays the response"
```

---

### Task 7: Routes + contract module

**Files:**
- Create: `lib/tis-api-zod/src/proofread.ts`
- Modify: `lib/tis-api-zod/src/index.ts`
- Create: `artifacts/tis-api-server/src/routes/proofread.ts`
- Modify: `artifacts/tis-api-server/src/routes/index.ts`
- Modify: `artifacts/tis-api-server/src/lib/security.ts`
- Create: `artifacts/tis-api-server/scripts/verify-proofread-routes.mjs`
- Modify: `artifacts/tis-api-server/package.json`

**Interfaces:**
- Consumes: `latestRunForProject`, `insertDisposition`, `findingBelongsToFirm`, `insertQueuedRun` (Task 6); `claimAndRunOne` (Task 6).
- Produces: `ProofreadDispositionBody` (zod); routes `GET /projects/:id/proofread`, `POST /projects/:id/proofread`, `POST /projects/:id/proofread/:runId/findings/:findingId/dispositions`; limiters `proofreadReadLimiter`, `proofreadRunLimiter`, `proofreadDispositionLimiter`; `projectExistsForFirm(firmId, id)` in `src/lib/tis-projects.ts`; `findingInFirmRun(firmId, projectId, runId, findingId)` replacing `findingBelongsToFirm`.

- [ ] **Step 1: Write the failing test**

Create `artifacts/tis-api-server/scripts/verify-proofread-routes.mjs`:

```js
/**
 * Guard for the proofread routes' contract: firm scoping, the advisor
 * boundary, and the disposition rules the protocol sets.
 * Run: `pnpm run check:proofread-routes`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(path.resolve(here, p), "utf8");
const routes = src("../src/routes/proofread.ts");
const index = src("../src/routes/index.ts");
const security = src("../src/lib/security.ts");
const contract = src("../../../lib/tis-api-zod/src/proofread.ts");
const store = src("../src/lib/proofread-store.ts");

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

ok(/proofreadRouter/.test(index), "the router is registered in routes/index.ts");
ok(/req\.isAuthenticated\(\)/.test(routes), "every handler checks authentication");
ok(/getOrCreateFirmForUser/.test(routes), "handlers resolve the firm the repo way");
ok(/Project not found\./.test(routes), "a foreign id 404s rather than 403s, per convention");

// The advisor boundary, in the route surface itself.
ok(!/requestPayload|resultPayload/.test(routes), "no route touches request_payload or result_payload");
ok(!/tisProjectsTable/.test(routes), "no route writes tis_projects");
ok(!/\.update\(/.test(routes), "routes record dispositions by insert, never by mutation");
// The store is where writes actually live, so the advisor boundary is asserted there too.
ok(
  !/\.update\(\s*tisProjectsTable/.test(store) &&
    !/\.insert\(\s*tisProjectsTable/.test(store) &&
    !/\.delete\(\s*tisProjectsTable/.test(store),
  "the store never writes tis_projects",
);
ok(/db\.update\(studyProofread/.test(store), "the store does write its own run table (the assertion above is not vacuous)");

// Disposition rules from the protocol.
ok(/WITHDRAWN/.test(contract) && /sourceLabel/.test(contract), "the contract knows WITHDRAWN needs a source");
ok(/ACCEPTED_RISK/.test(contract), "ACCEPTED_RISK is a recognized disposition");
ok(/refine|superRefine/.test(contract), "the contract refines WITHDRAWN-requires-sourceLabel");
ok(/PE_ONLY|pe-only|phase 4/i.test(routes), "PE-only dispositions are explicitly gated or deferred with a reason");

// Its own limiters — generateRateLimiter is per-IP 10/hr and shared by seven engine routes.
ok(/proofreadRunLimiter/.test(security), "a dedicated run limiter exists");
ok(/proofreadDispositionLimiter/.test(security), "triage has its own limiter, separate from the run budget");
ok(!/standardHeaders: true/.test(security), 'new limiters pin standardHeaders: "draft-7" like every existing one');
ok(/rl:proofread:/.test(security), "the limiter has its own Redis key prefix");
ok(!/generateRateLimiter/.test(routes), "the proofread routes do not reuse the engine limiter");
ok(/ipKeyGenerator/.test(security), "custom keyGenerators use ipKeyGenerator (express-rate-limit v8)");

// Permitted copy.
for (const banned of ["independent review", "second opinion", "peer review", "QA/QC"]) {
  ok(!routes.toLowerCase().includes(banned.toLowerCase()), `route copy avoids "${banned}"`);
}

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
```

Register:

```json
    "check:proofread-routes": "node ./scripts/verify-proofread-routes.mjs"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workspace/tis-api-server run check:proofread-routes`
Expected: FAIL — `ENOENT src/routes/proofread.ts`

- [ ] **Step 3: Write the contract module**

`lib/tis-api-zod/src/proofread.ts`:

```ts
/**
 * Hand-written contract for the proofread surface. The documented escape hatch
 * while the finding shape is still moving: nothing under generated/ may be
 * hand-edited (orval runs with clean: true). Promote to openapi.yaml once the
 * shape settles.
 */
import { z } from "zod";

export const ProofreadType = z.enum(["BLOCKER", "DEFECT", "DISCLOSE", "NOTE", "UNVERIFIED", "CONTESTED"]);

export const ProofreadDisposition = z.enum([
  "FIXED",
  "BUG_FILED",
  "DISCLOSED",
  "WITHDRAWN",
  "CONTESTED_PE",
  "ACCEPTED_RISK",
]);

/** A disposition a firm member records against one finding. */
export const ProofreadDispositionBody = z
  .object({
    disposition: ProofreadDisposition,
    note: z.string().max(2000).optional(),
    /** Required for WITHDRAWN: Datum withdraws on a source, never on an argument. */
    sourceLabel: z.string().min(1).max(500).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.disposition === "WITHDRAWN" && !val.sourceLabel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceLabel"],
        message: "WITHDRAWN requires the source the finding was withdrawn on.",
      });
    }
  });

export type ProofreadDispositionBodyT = z.infer<typeof ProofreadDispositionBody>;
```

Append to `lib/tis-api-zod/src/index.ts`:

```ts
export * from "./proofread";
```

- [ ] **Step 4: Add the limiters**

In `artifacts/tis-api-server/src/lib/security.ts`, alongside the existing limiters:

```ts
/**
 * Proofread limiters. Deliberately NOT generateRateLimiter: that one is per-IP
 * 10/hr and shared by seven engine routes, so a re-run would lock an engineer
 * out of generating studies. Keyed per user like whatIfRateLimiter.
 */
export const proofreadRunLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  passOnStoreError: true,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
  store: makeRateLimitStore("rl:proofread:"),
  // Same exemption every compute limiter in this file carries, so demoing the
  // feature does not 429 the operator.
  skip: (req) => {
    if (process.env.DEV_AUTH_ENABLED === "true") return true;
    const email = req.user?.email;
    return !!email && isAdminEmail(email);
  },
  message: { error: "Too many proofread runs this hour. Try again shortly." },
});

export const proofreadDispositionLimiter = rateLimit({
  // Triage must not share the re-run budget: twelve clauses over a
  // per-intersection payload routinely produce more findings than the run
  // limit, and an engineer recording decisions would lock themselves out of
  // re-running.
  windowMs: 60 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  passOnStoreError: true,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
  store: makeRateLimitStore("rl:proofread-disp:"),
  skip: (req) => {
    if (process.env.DEV_AUTH_ENABLED === "true") return true;
    const email = req.user?.email;
    return !!email && isAdminEmail(email);
  },
  message: { error: "Too many requests. Try again shortly." },
});

export const proofreadReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  passOnStoreError: true,
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),
  store: makeRateLimitStore("rl:proofread-read:"),
  message: { error: "Too many requests. Try again shortly." },
});
```

- [ ] **Step 5: Write the routes**

`artifacts/tis-api-server/src/routes/proofread.ts`:

```ts
/**
 * Proofread surface: read a run, request a run, record a triage decision.
 *
 * That is the whole API on purpose. Datum is an advisor — there is no endpoint
 * that changes a study, and no handler here touches request_payload or
 * result_payload. Firm scoping is in every query's WHERE clause; there is no
 * middleware that does it.
 */
import { Router, type IRouter } from "express";
import { ProofreadDispositionBody } from "@workspace/tis-api-zod";
import { getOrCreateFirmForUser } from "../lib/firms";
import { projectExistsForFirm } from "../lib/tis-projects";
import { proofreadDispositionLimiter, proofreadReadLimiter, proofreadRunLimiter } from "../lib/security";
import { claimAndRunOne, enqueueProofread } from "../lib/proofread-run";
import { findingInFirmRun, insertDisposition, latestRunForProject } from "../lib/proofread-store";

const router: IRouter = Router();

const UUID = /^[0-9a-f-]{36}$/i;

/** Dispositions only the sealing PE may record. Phase 4 adds the `pe` role and gates these; until then they are refused. */
const PE_ONLY = new Set(["ACCEPTED_RISK", "CONTESTED_PE"]);

router.get("/projects/:id/proofread", proofreadReadLimiter, async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in to view this check." });
    return;
  }
  const id = String(req.params.id);
  if (!UUID.test(id)) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  try {
    const user = req.user!;
    const { firm } = await getOrCreateFirmForUser(user.id, {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    // Existence only — getProject would pull both large jsonb study payloads
    // out of Postgres on every poll just to discard them.
    if (!(await projectExistsForFirm(firm.id, id))) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    // No scheduler in this service: every read gets one opportunistic sweep.
    void claimAndRunOne().catch(() => undefined);
    const latest = await latestRunForProject(firm.id, id);
    if (!latest) {
      res.json({ status: "none", findings: [], coverage: [], dispositions: [] });
      return;
    }
    const { run, findings, dispositions } = latest;
    res.json({
      status: run.status,
      runId: run.id,
      revision: run.revision,
      protocolVersion: run.protocolVersion,
      rulesVersion: run.rulesVersion,
      engineStamp: run.engineStamp,
      inputManifest: run.inputManifest,
      coverage: run.coverage,
      createdAt: run.createdAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      // DEFECT is admin-side: a software fault is not the engineer's to rule on.
      findings: findings
        .filter((f) => f.audience !== "admin")
        .map((f) => ({
          id: f.id,
          clauseId: f.clauseId,
          section: f.section,
          type: f.type,
          title: f.title,
          detail: f.detail,
          sourceLabel: f.sourceLabel,
          readPaths: f.readPaths,
          remedy: f.remedy,
          fingerprint: f.fingerprint,
        })),
      dispositions: dispositions.map((d) => ({
        findingId: d.findingId,
        disposition: d.disposition,
        note: d.note,
        sourceLabel: d.sourceLabel,
        createdAt: d.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "proofread.get_failed");
    res.status(500).json({ error: "Failed to load the check." });
  }
});

router.post("/projects/:id/proofread", proofreadRunLimiter, async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  const id = String(req.params.id);
  if (!UUID.test(id)) {
    res.status(404).json({ error: "Project not found." });
    return;
  }
  try {
    const user = req.user!;
    const { firm } = await getOrCreateFirmForUser(user.id, {
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    // Existence only — getProject would pull both large jsonb study payloads
    // out of Postgres on every poll just to discard them.
    if (!(await projectExistsForFirm(firm.id, id))) {
      res.status(404).json({ error: "Project not found." });
      return;
    }
    await enqueueProofread({ projectId: id, firmId: firm.id, userId: user.id });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "proofread.request_failed");
    res.status(500).json({ error: "Failed to start the check." });
  }
});

router.post(
  "/projects/:id/proofread/:runId/findings/:findingId/dispositions",
  proofreadDispositionLimiter,
  async (req, res): Promise<void> => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    const parsed = ProofreadDispositionBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid disposition." });
      return;
    }
    if (PE_ONLY.has(parsed.data.disposition)) {
      res.status(403).json({
        error: "Only the sealing engineer can record this decision, and that role ships with the next release.",
      });
      return;
    }
    const projectId = String(req.params.id);
    const runId = String(req.params.runId);
    const findingId = String(req.params.findingId);
    if (!UUID.test(projectId) || !UUID.test(runId) || !UUID.test(findingId)) {
      res.status(404).json({ error: "Finding not found." });
      return;
    }
    try {
      const user = req.user!;
      const { firm } = await getOrCreateFirmForUser(user.id, {
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      });
      // Verifies the whole chain the URL asserts — firm owns the run, the run
      // belongs to this project, the finding belongs to that run — so a
      // disposition cannot be recorded under an unrelated project or run id.
      if (!(await findingInFirmRun(firm.id, projectId, runId, findingId))) {
        res.status(404).json({ error: "Finding not found." });
        return;
      }
      await insertDisposition({
        findingId,
        disposition: parsed.data.disposition,
        note: parsed.data.note,
        sourceLabel: parsed.data.sourceLabel,
        actorUserId: user.id,
      });
      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "proofread.disposition_failed");
      res.status(500).json({ error: "Failed to record the decision." });
    }
  },
);

export default router;
```

Register in `artifacts/tis-api-server/src/routes/index.ts`:

```ts
import proofreadRouter from "./proofread";
// ...
router.use(proofreadRouter);
```

- [ ] **Step 6: Run the guard and typecheck**

Run: `pnpm --filter @workspace/tis-api-server run check:proofread-routes`
Expected: `ALL CHECKS PASSED`

Run: `pnpm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/tis-api-zod/src/proofread.ts lib/tis-api-zod/src/index.ts \
  artifacts/tis-api-server/src/routes/proofread.ts artifacts/tis-api-server/src/routes/index.ts \
  artifacts/tis-api-server/src/lib/security.ts artifacts/tis-api-server/scripts/verify-proofread-routes.mjs \
  artifacts/tis-api-server/package.json
git commit -m "feat(proofread): read, request-a-run and record-a-disposition routes"
```

---

### Task 8: The project-page panel

**Files:**
- Create: `artifacts/atlanta-tis/src/lib/proofread.ts`
- Create: `artifacts/atlanta-tis/src/components/proofread-panel.tsx`
- Modify: `artifacts/atlanta-tis/src/pages/project-detail.tsx`
- Create: `artifacts/tis-api-server/scripts/verify-proofread-copy.mjs`
- Modify: `artifacts/tis-api-server/package.json`

**Interfaces:**
- Consumes: the three routes from Task 7.
- Produces: `fetchProofread(projectId): Promise<ProofreadRun>`, `requestProofread(projectId): Promise<void>`, `recordDisposition(projectId, runId, findingId, body): Promise<void>`, types `ProofreadRun`, `ProofreadFindingT`, `CoverageEntryT`; component `<ProofreadPanel projectId={string} />`.

- [ ] **Step 1: Write the failing copy guard**

Create `artifacts/tis-api-server/scripts/verify-proofread-copy.mjs`:

```js
/**
 * The product surface is a customer venue, so TIS-PROOFREAD-PROTOCOL.md's ban
 * on "independent review", "second opinion", "peer review" and "QA/QC" applies
 * to it. The permitted description is "an internal consistency and
 * traceability check".
 * Run: `pnpm run check:proofread-copy`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const files = [
  "artifacts/atlanta-tis/src/components/proofread-panel.tsx",
  "artifacts/atlanta-tis/src/lib/proofread.ts",
  "artifacts/tis-api-server/src/routes/proofread.ts",
];

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

const BANNED = ["independent review", "second opinion", "peer review", "QA/QC", "audit"];
for (const rel of files) {
  const txt = readFileSync(path.join(repo, rel), "utf8").toLowerCase();
  for (const phrase of BANNED) ok(!txt.includes(phrase.toLowerCase()), `${rel}: avoids "${phrase}"`);
}

const panel = readFileSync(path.join(repo, files[0]), "utf8");
ok(/internal consistency and traceability check/i.test(panel), "the panel uses the permitted description verbatim");
ok(/status === "none"/.test(panel), "the panel distinguishes never-checked from nothing-found");
ok(!/\bapply\b|\bfix it\b|\bauto-?fix\b/i.test(panel), "the panel offers no control that changes the study");

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
```

Register:

```json
    "check:proofread-copy": "node ./scripts/verify-proofread-copy.mjs"
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workspace/tis-api-server run check:proofread-copy`
Expected: FAIL — `ENOENT proofread-panel.tsx`

- [ ] **Step 3: Write the client module**

`artifacts/atlanta-tis/src/lib/proofread.ts`, copying the shape of `src/lib/report-themes.ts`:

```ts
/**
 * Client for a study's proofread run (`/tis-api/projects/:id/proofread`) — an
 * internal consistency and traceability check over the saved study. Read-only
 * plus two writes that record a decision; nothing here changes a study.
 */
export type ProofreadFindingT = {
  id: string;
  clauseId: string;
  section: number;
  type: "BLOCKER" | "DEFECT" | "DISCLOSE" | "NOTE" | "UNVERIFIED" | "CONTESTED";
  title: string;
  detail: string;
  sourceLabel: string;
  readPaths: Array<{ path: string; value: string | number | boolean | null }>;
  remedy: string;
  fingerprint: string;
};

export type CoverageEntryT = { clauseId: string; section: number; status: "ran" | "not-run"; reason?: string };

export type DispositionT = {
  findingId: string;
  disposition: string;
  note: string | null;
  sourceLabel: string | null;
  createdAt: string;
};

export type ProofreadRun = {
  status: "none" | "queued" | "running" | "rules_ready" | "ready" | "failed";
  /** The run's uuid. The disposition route validates it, so the panel must send the real id, not the revision. */
  runId?: string;
  revision?: number;
  protocolVersion?: string;
  engineStamp?: string;
  coverage: CoverageEntryT[];
  findings: ProofreadFindingT[];
  dispositions: DispositionT[];
  createdAt?: string;
  finishedAt?: string | null;
};

export async function fetchProofread(projectId: string): Promise<ProofreadRun> {
  const r = await fetch(`/tis-api/projects/${encodeURIComponent(projectId)}/proofread`, { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = (await r.json()) as Partial<ProofreadRun>;
  return {
    status: data.status ?? "none",
    runId: data.runId,
    revision: data.revision,
    protocolVersion: data.protocolVersion,
    engineStamp: data.engineStamp,
    coverage: data.coverage ?? [],
    findings: data.findings ?? [],
    dispositions: data.dispositions ?? [],
    createdAt: data.createdAt,
    finishedAt: data.finishedAt ?? null,
  };
}

export async function requestProofread(projectId: string): Promise<void> {
  const r = await fetch(`/tis-api/projects/${encodeURIComponent(projectId)}/proofread`, {
    method: "POST",
    credentials: "include",
  });
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${r.status}`);
}

export async function recordDisposition(
  projectId: string,
  runId: string,
  findingId: string,
  body: { disposition: string; note?: string; sourceLabel?: string },
): Promise<void> {
  const r = await fetch(
    `/tis-api/projects/${encodeURIComponent(projectId)}/proofread/${encodeURIComponent(runId)}/findings/${encodeURIComponent(findingId)}/dispositions`,
    { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `HTTP ${r.status}`);
}
```

- [ ] **Step 4: Write the panel**

`artifacts/atlanta-tis/src/components/proofread-panel.tsx`:

```tsx
/**
 * The study's internal consistency and traceability check, on the project page.
 *
 * Read-only by construction: the panel renders findings, what each one read,
 * and the source it was checked against, plus controls that RECORD a decision.
 * It offers nothing that edits the study.
 *
 * Polling, not streaming: this codebase has no SSE anywhere and compression is
 * mounted globally, so a terminal status stops a 60 s interval — the cadence
 * atlanta-live-status.tsx uses.
 */
import { useEffect, useRef, useState } from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, HelpCircle, Info, Loader2, RefreshCw, Scale } from "lucide-react";
import {
  fetchProofread,
  recordDisposition,
  requestProofread,
  type ProofreadFindingT,
  type ProofreadRun,
} from "@/lib/proofread";

const TYPE_CONFIG: Record<ProofreadFindingT["type"], { label: string; color: string; icon: typeof CheckCircle2 }> = {
  BLOCKER: { label: "Blocker", color: "text-red-600", icon: AlertCircle },
  DEFECT: { label: "Defect", color: "text-red-600", icon: AlertCircle },
  DISCLOSE: { label: "Disclose", color: "text-amber-600", icon: AlertTriangle },
  NOTE: { label: "Note", color: "text-yellow-600", icon: Info },
  UNVERIFIED: { label: "Unverified", color: "text-slate-600", icon: HelpCircle },
  CONTESTED: { label: "Contested", color: "text-purple-600", icon: Scale },
};

const DISPOSITIONS = [
  { value: "FIXED", label: "Fixed" },
  { value: "DISCLOSED", label: "Disclosed in the deliverable" },
  { value: "WITHDRAWN", label: "Withdrawn on a source" },
  { value: "BUG_FILED", label: "Bug filed" },
] as const;

const POLL_MS = 60_000;
const PENDING = new Set(["queued", "running"]);

export function ProofreadPanel({ projectId }: { projectId: string }) {
  const [run, setRun] = useState<ProofreadRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumping this re-runs the effect, which re-arms the interval. The effect
  // clears its own timer on a terminal status, so without this a re-run would
  // refetch exactly once and then never poll again.
  const [nonce, setNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const next = await fetchProofread(projectId);
        if (cancelled) return;
        setRun(next);
        setError(null);
        if (!PENDING.has(next.status) && timer.current) {
          clearInterval(timer.current);
          timer.current = null;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    timer.current = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [projectId, nonce]);

  const rerun = async () => {
    setBusy(true);
    try {
      await requestProofread(projectId);
      setError(null);
      setNonce((v) => v + 1); // re-arms the poll and refetches
      return;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const triage = async (f: ProofreadFindingT, disposition: string) => {
    if (!run?.runId) return;
    const sourceLabel =
      disposition === "WITHDRAWN" ? (window.prompt("Name the source this is withdrawn on:") ?? "").trim() : undefined;
    if (disposition === "WITHDRAWN" && !sourceLabel) return;
    setBusy(true);
    try {
      await recordDisposition(projectId, run.runId, f.id, { disposition, sourceLabel });
      setRun(await fetchProofread(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!run) return null;

  const latestFor = (id: string) => run.dispositions.find((d) => d.findingId === id);
  const notRun = run.coverage.filter((c) => c.status === "not-run");

  return (
    <section className="border rounded-lg" data-testid="panel-proofread">
      <header className="flex items-start justify-between gap-3 flex-wrap p-4 border-b">
        <div>
          <h2 className="text-sm font-semibold">Consistency check</h2>
          <p className="text-xs text-muted-foreground max-w-prose">
            An internal consistency and traceability check over this saved study: each item names the
            values it read and the source it was checked against. It does not change the study.
          </p>
        </div>
        <button
          onClick={() => void rerun()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border hover:bg-muted disabled:opacity-50"
          data-testid="button-proofread-rerun"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Run again
        </button>
      </header>

      <div className="p-4 space-y-3">
        {error && <div className="text-xs text-red-600">{error}</div>}

        {PENDING.has(run.status) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking this study…
          </div>
        )}

        {run.status === "failed" && (
          <div className="text-xs text-amber-700">
            The check did not finish. The study itself is unaffected — run it again when convenient.
          </div>
        )}

        {/* A study that was never checked must not render as clean. "none" is
            not a result; conflating it with "nothing found" is the false-coverage
            failure the protocol forbids. */}
        {run.status === "none" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <HelpCircle className="w-4 h-4" />
            This study has not been checked yet. Run the check to see what can be verified from the saved record.
          </div>
        )}

        {run.status !== "none" && run.findings.length === 0 && !PENDING.has(run.status) && (
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            Nothing flagged in the clauses that could run.
          </div>
        )}

        {run.findings.map((f) => {
          const cfg = TYPE_CONFIG[f.type];
          const Icon = cfg.icon;
          const disposed = latestFor(f.id);
          return (
            <div key={f.id} className="border rounded-lg p-4 space-y-3" data-testid={`finding-${f.clauseId}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <Icon className={`w-4 h-4 mt-0.5 ${cfg.color}`} />
                  <div>
                    <div className="text-sm font-semibold">{f.title}</div>
                    <div className="text-xs text-muted-foreground">§{f.section} · {f.clauseId}</div>
                  </div>
                </div>
                <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
              </div>

              <p className="text-sm">{f.detail}</p>

              <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                <li>Checked against: {f.sourceLabel}</li>
                {f.readPaths.slice(0, 6).map((p) => (
                  <li key={p.path}>
                    {p.path} = {String(p.value)}
                  </li>
                ))}
                {f.readPaths.length > 6 && <li>and {f.readPaths.length - 6} more values</li>}
                <li>Suggested: {f.remedy}</li>
              </ul>

              {disposed ? (
                <div className="text-xs text-muted-foreground">
                  Recorded: <span className="font-medium">{disposed.disposition}</span>
                  {disposed.sourceLabel ? ` — ${disposed.sourceLabel}` : ""} on{" "}
                  {new Date(disposed.createdAt).toLocaleString()}
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  {DISPOSITIONS.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => void triage(f, d.value)}
                      disabled={busy}
                      className="px-2 py-1 text-xs rounded-md border hover:bg-muted disabled:opacity-50"
                      data-testid={`button-disposition-${d.value.toLowerCase()}`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {notRun.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">
              {notRun.length} clause{notRun.length === 1 ? "" : "s"} could not run on this study
            </summary>
            <ul className="list-disc pl-5 mt-2 space-y-0.5">
              {notRun.map((c) => (
                <li key={c.clauseId}>
                  §{c.section} {c.clauseId} — {c.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Mount it**

In `artifacts/atlanta-tis/src/pages/project-detail.tsx`, add the import:

```tsx
import { ProofreadPanel } from "../components/proofread-panel";
```

and insert between `<ResultRenderer project={project} />` and the read-only footnote `<div>`:

```tsx
      {project.studyType === "tis" && <ProofreadPanel projectId={project.id} />}
```

- [ ] **Step 6: Run the guards and build**

Run: `pnpm --filter @workspace/tis-api-server run check:proofread-copy`
Expected: `ALL CHECKS PASSED`

Run: `pnpm run typecheck`
Expected: no errors.

Run: `pnpm --filter @workspace/atlanta-tis run build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add artifacts/atlanta-tis/src/lib/proofread.ts artifacts/atlanta-tis/src/components/proofread-panel.tsx \
  artifacts/atlanta-tis/src/pages/project-detail.tsx \
  artifacts/tis-api-server/scripts/verify-proofread-copy.mjs artifacts/tis-api-server/package.json
git commit -m "feat(proofread): the consistency-check panel on the project page"
```

---

### Task 9: Close the two unguarded invariants this work depends on

`verify-existing-use-credit.mjs` and `verify-intersection-delay-fields.mjs` are on disk but absent from `package.json`, so neither runs. The second guards the "LOS F with no delay" response-boundary strip — the exact class Task 3's `losMatchesDelay` clause reports, so shipping the clause while the build-time guard stays dark would report a defect CI could have caught.

**Files:**
- Modify: `artifacts/tis-api-server/package.json`

- [ ] **Step 1: Run the two scripts directly to see their current state**

```bash
node artifacts/tis-api-server/scripts/verify-existing-use-credit.mjs; echo "exit=$?"
node artifacts/tis-api-server/scripts/verify-intersection-delay-fields.mjs; echo "exit=$?"
```

Expected: both exit 0. If either fails, stop and report — that is a live defect, not a registration problem, and it belongs in its own fix before this plan continues.

- [ ] **Step 2: Register both**

```json
    "check:existing-use-credit": "node ./scripts/verify-existing-use-credit.mjs",
    "check:intersection-delay-fields": "node ./scripts/verify-intersection-delay-fields.mjs"
```

- [ ] **Step 3: Verify every proofread check is green together**

```bash
cd artifacts/tis-api-server
for k in proofread proofread-protocol proofread-schema proofread-hook proofread-routes proofread-copy \
         existing-use-credit intersection-delay-fields; do
  pnpm run "check:$k" >/dev/null 2>&1 && echo "ok   check:$k" || echo "FAIL check:$k"
done
```

Expected: eight `ok` lines.

- [ ] **Step 4: Commit**

```bash
git add artifacts/tis-api-server/package.json
git commit -m "chore(checks): register the two verify scripts that were never wired into CI"
```

---

## Self-review notes

- **CI does not typecheck.** `.github/workflows/checks.yml` runs only `check:*` keys, and Netlify runs `vite build`. This plan's tasks each run `pnpm run typecheck` by hand. Adding `"check:typecheck": "tsc -p tsconfig.json --noEmit"` would close it permanently; deliberately left out of scope, flagged here.
- **`claimOneRun` interpolates the instance id** into `CLAIM_SQL` because `sql.raw` takes no parameters. The id comes from `RAILWAY_REPLICA_ID`/`HOSTNAME`/`process.pid`, never from a request, and the quote-strip keeps it inert. An implementer who prefers drizzle's `sql` template with a bound parameter should use it and keep `CLAIM_SQL` as the single source of the predicate.
- **`runId` in the disposition path** is carried as the run's `revision` by the panel; the server authorizes on the finding id and the firm, so the segment is informational. If a later phase needs the run's uuid client-side, add it to the `GET` response rather than inferring it.
- **No backfill.** Studies saved before this ships have no run until someone presses "Run again", and then the input manifest and per-clause coverage state exactly what could not be checked.
- **One clause is renamed from the spec.** The spec's `passByExplicitVsOmitted` ships as `passByBasisNamed`, because what is observable from a saved record is whether the applied pass-by is *stated in the deliverable*, not whether a zero was explicit or omitted. Same section, same intent, narrower claim. Update the spec's clause table when this lands.
- **Protocol amendment 8 (defining the PE) is deliberately not in Task 1.** It is the one amendment with no phase-1 consumer: nothing in this plan needs to know who the PE is, and inventing a licensure concept before phase 4 needs it would be guesswork. Task 7 therefore refuses `ACCEPTED_RISK` and `CONTESTED_PE` with an explicit message rather than letting any firm member record them. Amendments 1-7 are all in Task 1 and are guarded by `check:proofread-protocol`.
