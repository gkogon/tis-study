# Datum Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A chat on the study page where the engineer asks Datum why a finding was flagged and how to fix it. When
asked, Datum re-runs the study with corrected inputs as a new version and keeps the original.

**Architecture:**
- Pure modules in `artifacts/tis-api-server/src/lib/datum-chat/` hold the logic: the allowlist and merge, the
  grounding pack, the prompt, and the model tool loop with an injected client. They are tested under plain node with
  fakes.
- Two DB modules hold the persistence. `lib/study-revisions.ts` is the only insert of a new version.
  `lib/datum-chat/store.ts` holds the messages.
- An Express router factory streams server-sent events, and a thin wiring file passes it the real dependencies.
- The web side adds a chat drawer to the proofread panel.

**Tech Stack:** Express 5, drizzle-orm/pg, zod, `@anthropic-ai/sdk` (model `claude-opus-5-5`), React/Vite (wouter).

**Spec:** `docs/superpowers/specs/2026-10-20-datum-chat-design.md` (read it first).

## Global Constraints

**Git and the owner's files**
- Work only in the worktree `/Users/geraldkogon/tis-study/.claude/worktrees/datum-chat`, on branch `feat/datum-chat`.
- Commit only the paths you name. Never `git add -A`, `git add .` or `git commit -a`. Never use a bare `git stash`.
- Do not push, open PRs, or touch `main`.

**Database safety**
- Never connect to the owner's database, and never print `DATABASE_URL`.
- Never run drizzle-kit, `migrate.mjs` or any migration against any `DATABASE_URL`.
- Never connect to or signal the owner's Homebrew Postgres (pid 1001, port 5432). The opt-in harness
  `scripts/proofread-pg-harness/run.mjs` starts its own throwaway cluster. That is the only Postgres you may use.

**The model and its key**
- No network calls to Anthropic in any check or test. Tests use a fake client.
- `ANTHROPIC_API_KEY` is never read in tests. With it unset, the feature reports `enabled: false`.
- Model call settings:
  - `model: "claude-opus-5-5"`, `max_tokens: 16000`
  - `thinking: { type: "adaptive" }`, `output_config: { effort: "medium" }`
  - `tool_choice: { type: "auto", disable_parallel_tool_use: true }`
  - no `budget_tokens`, no forced `tool_choice`, no `fallbacks`, no beta headers
- In the tool loop, pass `message.content` back unchanged, thinking blocks included.

**Copy**
- Never write "independent review", "second opinion", "peer review", "QA/QC" (any spacing or dash) or "audit" in UI
  copy, prompts' own wording, comments shown to users, or docs.
- The one exception is the single "never use" sentence in `prompt.ts`, which the copy scan excludes by exact match.

**Code**
- Pure modules (everything under `lib/datum-chat/` except `store.ts` and `client.ts`) use explicit `.ts` relative
  imports and import no db, logger or fetch. This matches `lib/proofread/`.
- These limits come from the spec, and every task uses `DATUM_LIMITS`:
  - `messageChars` 2000
  - `historyMessages` 20
  - `modelTurnsPerMessage` 4
  - `rerunsPerMessage` 1
  - `versionsPerLineage` 25
  - `firmRepliesPer24h` 300
  - `userMessagesPerHour` 40
  - `packBytes` 61440
  - `readPathBytes` 8192

**Existing checks**
- Every existing `check:*` script in both apps must stay green.
- If one goes red on a legitimate addition (a new router mount, limiter or importer), you may add the new name to
  that guard's own list. Weakening any assertion is not allowed. Say which guard and why in the commit message.
- If a guard still forbids the change, stop and report. Do not work around it.

**Commits**
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

These are inputs and conditions the spec implies but no happy-path test exercises. Each one's test lives in the
named task.

1. **The original's saved inputs fail today's schema.** For example, a legacy request has `studyRadiusMi: 7` (the
   bound is now 6.5), or lacks a field. Expected: the re-run is refused with a message naming that field and
   pointing to the generator. The engine is not run. (Task 2.)
2. **The engineer closes the tab mid-reply.** Expected: the model stream is aborted. A re-run already started still
   finishes, its version and log row are saved, and the Datum message is saved with the text so far plus
   " (reply cut off)". Nothing throws. (Task 5, Task 7.)
3. **Two firm members ask for a fix on the same study at once, or a fix is asked on v1 after v2 exists.** Expected:
   versions are unique and are max+1 within the lineage (v3, revised from v1), and the original row is byte-identical
   afterwards. (Task 6, PG harness.)
4. **A large study** (60 UTDF intersections, 12 driveways, a full trip profile, many findings). Expected: the pack is
   ≤ 61440 bytes and is never cut inside a JSON value. Every JSON section in it still parses, and the focused finding
   is always present. (Task 3.)
5. **The reply arrives all at once** because the app's `compression()` middleware buffers the stream. Expected: the
   first `text` event reaches the client before the fake model finishes. (Task 7.)

Also: engineer and Datum text is rendered as plain text, never as HTML or markdown (Task 8).

---

## File Structure

| Path | Responsibility |
|---|---|
| `lib/tis-api-zod/src/datum-chat.ts` (+ export in `index.ts`) | The hand-written strict contract: limits, allowlist, read response, post body, stream events, tool input. |
| `lib/db/src/schema/datum-chat.ts` (+ export in `schema/index.ts`) | Two tables: `study_revisions` and `study_datum_messages`. |
| `lib/db/src/schema/tis-projects.ts` | Two new columns: `revisedFromProjectId` and `rootProjectId`. |
| `lib/db/migrate.mjs` | Additive SQL for the above. |
| `artifacts/tis-api-server/src/lib/datum-chat/tools.ts` | The tool JSON schemas, `applyRevisionChanges`, and the timing-array conversion. Pure. |
| `artifacts/tis-api-server/src/lib/datum-chat/clause-guide.ts` | The static per-clause guide. Pure. |
| `artifacts/tis-api-server/src/lib/datum-chat/context.ts` | `buildGroundingPack`, `readStudyPath`. Pure. |
| `artifacts/tis-api-server/src/lib/datum-chat/prompt.ts` | `SYSTEM_PROMPT`, `buildSystem`, `buildHistory`. Pure. |
| `artifacts/tis-api-server/src/lib/datum-chat/run.ts` | `runDatumTurn`, the tool loop. Pure, with the client injected. |
| `artifacts/tis-api-server/src/lib/datum-chat/revise.ts` | `reviseStudy`: the gate, in-flight lock, version cap, engine run and save. Pure, with deps injected. |
| `artifacts/tis-api-server/src/lib/datum-chat/store.ts` | Message insert and list, the firm reply count, the visible-findings load. DB. |
| `artifacts/tis-api-server/src/lib/datum-chat/client.ts` | `getDatumClient()`: null without a key; lazy SDK import. |
| `artifacts/tis-api-server/src/lib/study-revisions.ts` | `createRevision`, `lineageFor`, `listRevisions`. DB; insert-only. |
| `artifacts/tis-api-server/src/routes/datum-chat-router.ts` | `makeDatumChatRouter(deps)`. No db imports. |
| `artifacts/tis-api-server/src/routes/datum-chat.ts` | Real deps wired into the factory. Default export router. |
| `artifacts/tis-api-server/src/lib/security.ts`, `src/routes/index.ts`, `package.json` | `datumChatLimiter`, the mount, the SDK dep, `check:datum-chat`. |
| `artifacts/tis-api-server/scripts/verify-datum-chat.mjs` | Every pure test plus the static guards. |
| `artifacts/tis-api-server/scripts/proofread-pg-harness/driver.mjs` | The DB assertions for the new tables. |
| `artifacts/tis-api-server/scripts/datum-chat-live-smoke.mjs` | Owner-run only, not in CI: one real call to confirm the API accepts the tools and system. |
| `artifacts/atlanta-tis/src/lib/datum-chat.ts` | Fetch, the stream parser, types. |
| `artifacts/atlanta-tis/src/components/datum-chat.tsx` | The drawer, the thread, the change card, the composer. |
| `artifacts/atlanta-tis/src/components/proofread-panel.tsx` | The "Ask about this" button, plus a top-of-panel "Ask Datum" box. |
| `artifacts/atlanta-tis/src/pages/project-detail.tsx`, project list page | The version line, the newer-version notice and the "v2" badge. |
| `artifacts/atlanta-tis/scripts/check-datum-chat.mjs` (+ `check:datum-chat` in its package.json) | Web pure tests. |
| `artifacts/tis-api-server/scripts/verify-proofread-copy.mjs` | Adds `datum-chat.tsx` and `prompt.ts` to the banned-copy scan. |
| `artifacts/tis-api-server/src/lib/proofread/types.ts`, `docs/superpowers/specs/2026-09-29-datum-in-product-design.md` | The header sentence and the addendum. |

---

### Task 1: Contract, tables, migrations

**Files:**
- Create: `lib/tis-api-zod/src/datum-chat.ts`, `lib/db/src/schema/datum-chat.ts`,
  `artifacts/tis-api-server/scripts/verify-datum-chat.mjs`
- Modify: `lib/tis-api-zod/src/index.ts`, `lib/db/src/schema/index.ts`, `lib/db/src/schema/tis-projects.ts`,
  `lib/db/migrate.mjs`, `artifacts/tis-api-server/package.json` (add `"check:datum-chat": "node
  ./scripts/verify-datum-chat.mjs"`)

**Interfaces (Produces), from `@workspace/tis-api-zod`:**

- `DATUM_LIMITS`: a frozen object with the values in Global Constraints.
- `REVISABLE_FIELDS`: a readonly tuple in exactly this order:
  - `growthRatePct`
  - `removeGrowthOverride`
  - `openingYear`
  - `analysisPeriods`
  - `passByPct`
  - `internalCapturePct`
  - `weather`
  - `scopeStudyIntersections`
  - `signalTiming`
  - `legVolumes`
  - `realLaneGeometry`
  - `conservedAssignment`
  - `signalTimingOverrides`
- `type RevisableField = typeof REVISABLE_FIELDS[number]`.
- `METHOD_FIELDS`: `["scopeStudyIntersections","signalTiming","legVolumes","realLaneGeometry","conservedAssignment"]`.
  These are the settings Datum may choose itself when asked to "fix it". Every other revisable field needs a value
  from the engineer.
- `LOCKED_FIELDS`: every other `GenerateTisBody` key. Derive it as `Object.keys(GenerateTisBody.shape)` minus the
  allowlist minus `removeGrowthOverride`.
- `DatumChatPostBody`: `z.object({ content: z.string().trim().min(1).max(2000), findingId:
  z.string().uuid().optional() }).strict()`.
- `DatumChange`: `{ field: RevisableField; from: unknown; to: unknown }`.
- `DatumMessage`, which has these keys:
  - `id`
  - `role`: `"engineer" | "datum"`
  - `content`
  - `authorName`: `string | null`
  - `findingId`: `string | null`
  - `revisionId`: `string | null`
  - `createdAt`: an ISO string
- `DatumRevision`, which has these keys:
  - `id`
  - `projectId`
  - `fromProjectId`
  - `version`
  - `changes`: `DatumChange[]`
  - `reason`
  - `sourceLabel`: `string | null`
  - `requestedBy`
  - `findingId`: `string | null`
  - `clauseId`: `string | null`
  - `createdAt`
- `DatumChatReadResponse` (strict), which has these keys:
  - `enabled`
  - `messages`
  - `revisions`
  - `lineage`: `{ version, revisedFromProjectId: string|null, revisedFromVersion: number|null, latestVersionId,
    latestVersion }`
- `DatumStreamEvent`, a zod discriminated union on `type`:
  - `text`: `{ delta }`
  - `status`: `{ message }`
  - `revision`: `{ projectId, version, changes }`
  - `done`: `{ messageId }`
  - `error`: `{ message }`
- `RerunToolInput` (strict zod), with these keys:
  - `changes`: a strict object with each revisable field optional:
    - `growthRatePct` and `passByPct` / `internalCapturePct` use the `GenerateTisBody` bounds
    - `removeGrowthOverride`: `z.literal(true)`
    - `analysisPeriods`: the `GenerateTisBody` enum array
    - `signalTimingOverrides`: an array (max 60) of `{ intersectionName, latitude, longitude, cycleLenSec, phases:
      [{movement, phase}], splits: [{phase, seconds}] }`
  - `reason`: 1–500 characters
  - `sourceLabel?`: ≤ 200
  - `findingId?`: a uuid

**Interfaces (Produces), from `@workspace/db`:**

- `studyRevisionsTable` and `studyDatumMessagesTable`, with the columns in the spec's Data section.
- `tisProjectsTable.revisedFromProjectId` and `tisProjectsTable.rootProjectId` (uuid, nullable).

- [ ] **Step 1: Write the failing tests** in `verify-datum-chat.mjs`, section `contract`. Use the same `ok(name, cond)`
  pattern as `verify-proofread.mjs`, and import the contract with `pathToFileURL`:
  - `REVISABLE_FIELDS` deep-equals the 13-name list above.
  - `LOCKED_FIELDS` includes `latitude`, `longitude`, `landUseCode`, `size`, `projectName`, `driveways` and
    `utdfIntersections`, and shares no name with `REVISABLE_FIELDS`.
  - `DatumChatPostBody.safeParse({content:"x".repeat(2001)}).success === false`.
  - `DatumChatPostBody.safeParse({content:"  "}).success === false`.
  - `DatumChatPostBody.safeParse({content:"why?", extra:1}).success === false`.
  - `RerunToolInput.safeParse({changes:{latitude:1}, reason:"r"}).success === false`.
  - `RerunToolInput.safeParse({changes:{growthRatePct:9}, reason:"r"}).success === false`.
  - `RerunToolInput.safeParse({changes:{}, reason:"re-run on the current engine"}).success === true`.
  - `DatumChatReadResponse` rejects an unknown top-level key.
  - Section `migrations` reads `lib/db/migrate.mjs` as text. It asserts ids `tis_projects.revised_from_project_id`,
    `tis_projects.root_project_id`, `tis_projects.idx_root`, `study_revisions.create`, `study_revisions.uq_project`,
    `study_datum_messages.create` and `study_datum_messages.idx_project`. It also asserts every new statement is
    `CREATE … IF NOT EXISTS` or `ADD COLUMN IF NOT EXISTS`, and that none contains `DROP` or `RENAME`.
- [ ] **Step 2: Run** `pnpm --filter @workspace/tis-api-server run check:datum-chat`. Expected: FAIL, because the
  contract module is not found.
- [ ] **Step 3: Implement** the contract, the schema file, the two columns and the migrate statements. The FKs are
  the ones the spec gives:
  - revisions `project_id` → tis_projects ON DELETE CASCADE, and unique
  - `finding_id` → study_proofread_findings ON DELETE SET NULL
  - messages `project_id` → tis_projects ON DELETE CASCADE
  - the two tis_projects columns → tis_projects ON DELETE SET NULL

  `user_id` columns are `varchar` FK → users, matching `tis_projects.user_id`. `study_revisions` has no
  `updated_at`.
- [ ] **Step 4: Run** `check:datum-chat` and `pnpm -r run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** the named files: `feat(datum-chat): contract, revision and message tables, additive
  migrations`.

### Task 2: The allowlist merge (`tools.ts`)

**Files:** Create `artifacts/tis-api-server/src/lib/datum-chat/tools.ts`. Test: `verify-datum-chat.mjs` section
`tools`.

**Interfaces:**
- Consumes: `RerunToolInput`, `REVISABLE_FIELDS`, `GenerateTisBody` (Task 1).
- Produces:
  - `RERUN_TOOL` and `READ_PATH_TOOL`, both `Anthropic.Tool`-shaped plain objects with `strict: true`. Every object
    level has `additionalProperties: false`. There are no `oneOf`/`anyOf` and no open records (timing is arrays,
    for this reason).
  - `applyRevisionChanges(parentRequest: unknown, input: RerunToolInput): { ok: true; request: TisRequestLike;
    changes: DatumChange[] } | { ok: false; error: string; field?: string }`.

- [ ] **Step 1: Write the failing tests:**
  - **Growth.** Parent `{growthRatePct: 2.1, …}` with changes `{growthRatePct: 1.0}` gives `ok`.
    `request.growthRatePct === 1.0` and `changes` deep-equals `[{field:"growthRatePct", from:2.1, to:1.0}]`.
  - **Remove the override.** `{removeGrowthOverride:true}` gives a request with no `growthRatePct` key, and changes
    `[{field:"growthRatePct", from:2.1, to:null}]`.
  - **Empty changes** give `ok`, `changes: []`, and a request deep-equal to the parent after a `GenerateTisBody`
    parse.
  - **Locked fields stay** byte-equal to the parent for every name in `LOCKED_FIELDS` present in the fixture. Use the
    real payload `artifacts/atlanta-tis/scripts/fixtures/scenario-base.json`'s request.
  - **Timing arrays.** `signalTimingOverrides:[{intersectionName:"A & B", latitude, longitude, cycleLenSec:120,
    phases:[{movement:"NBT",phase:2},{movement:"EBT",phase:4}], splits:[{phase:2,seconds:60},{phase:4,seconds:50}]}]`
    gives `request.signalTimingOverrides[0]` deep-equal to `{latitude, longitude, name:"A & B", cycleLenSec:120,
    phaseByMovement:{NBT:2,EBT:4}, splitSByPhase:{"2":60,"4":50}}`.
  - **Review Focus 1.** A parent with `studyRadiusMi: 7` and changes `{growthRatePct:1}` gives `ok:false` with
    `field === "studyRadiusMi"`. The error matches `/saved inputs.*no longer pass.*generator/i`.
  - **Bounds.** `{openingYear: 2051}` gives `ok:false` with `field === "openingYear"`.
  - **The tool schema.** `JSON.stringify(RERUN_TOOL.input_schema)` contains none of `oneOf`, `anyOf`, `"patternProperties"`.
    Every `"type":"object"` node has `additionalProperties:false`. The keys of `changes.properties` deep-equal
    `REVISABLE_FIELDS`.
- [ ] **Step 2: Run** `check:datum-chat`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Merge onto a structured clone of the parent. Apply `removeGrowthOverride` by deleting the
  key. Convert the timing arrays. Parse the whole merged object with `GenerateTisBody.safeParse`:
  - If the failing issue's path is a field the engineer did not change, return the "saved inputs no longer pass
    today's checks; start a new study in the generator" error with that field.
  - Otherwise, return the bounds error for that field.

  `from` is the parent value, or `null` if absent. Skip a change whose value equals the parent's.
- [ ] **Step 4: Run** `check:datum-chat`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(datum-chat): allowlisted input merge and strict tool schemas`.

### Task 3: Clause guide and grounding pack

**Files:** Create `lib/datum-chat/clause-guide.ts` and `lib/datum-chat/context.ts`. Test: section `context`.

**Interfaces:**
- Produces:
  - `CLAUSE_GUIDE: Record<string, { why: string; clears: string; inputs: RevisableField[] | []; fixable: "rerun" |
    "partial" | "explain" }>`. It has a key for each of the 11 engineer-visible clause ids, and none for
    `losMatchesDelay`. The content is the spec's "What can be fixed" table, plus the clause map in the spec's
    sources.
  - `buildGroundingPack(args: { request: unknown; result: unknown; findings: VisibleFinding[]; dispositions:
    unknown[]; focusFindingId?: string }): { text: string; bytes: number; sections: string[] }`.
  - `readStudyPath(record: { request: unknown; result: unknown }, path: string): string`. The return is JSON text
    capped at `readPathBytes`, or `"(no value at <path>)"`. The path is dotted or indexed, rooted at `request.` or
    `result.`.
  - `type VisibleFinding`: `{ id, clauseId, type, title, detail, sourceLabel, readPaths, remedy }`.

- [ ] **Step 1: Write the failing tests:**
  - **Guide keys.** `Object.keys(CLAUSE_GUIDE).sort()` deep-equals the `ALL_CLAUSES` ids from
    `src/lib/proofread/index.ts` minus `losMatchesDelay`. `CLAUSE_GUIDE.criteriaNamed.fixable === "explain"`, and
    `CLAUSE_GUIDE.rateReproducesTotal.fixable === "rerun"`.
  - **The focused finding.** With the `scenario-base.json` record and two findings, focused on the second, the pack's
    first section is `"## Focused finding"` and it contains the second finding's title. Each readPath's value appears.
  - **Withheld findings.** A finding with `audience:"admin"` passed in by mistake throws `"withheld finding passed to
    pack"`. The store filters; this asserts the contract.
  - **Review Focus 4.** Inflate the record: 60 utdfIntersections, 12 driveways, a 24+24 tripProfile, and 200 findings.
    Then `bytes <= 61440`, `"## Focused finding"` is still present, and every fenced ```json block in `text`
    `JSON.parse`s.
  - **Paths.** `readStudyPath(rec, "request.growthRatePct")` returns `"2.1"` on a fixture with that value.
    `readStudyPath(rec, "result.nope.x")` returns `"(no value at result.nope.x)"`. `readStudyPath(rec, "process.env")`
    returns the same "(no value …)" form. A 50 KB value returns ≤ 8192 bytes ending in `"…(truncated)"`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The section order is:
  1. focused finding
  2. clause guide entry for it
  3. readPath values
  4. other findings (one line each)
  5. request summary
  6. result summary

  The request summary replaces the arrays `utdfIntersections`, `driveways` and `tripProfile` with counts. The result
  summary has:
  - rows with any v/c > 2.5: name, period, v/c, LOS, delay
  - `growthSource`
  - `passByPctApplied`
  - coverage counts
  - jurisdiction `dotName`

  Trim from the end by whole sections, then by whole lines. Never cut inside a fenced block.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(datum-chat): clause guide and capped grounding pack`.

### Task 4: Prompt

**Files:** Create `lib/datum-chat/prompt.ts`. Test: section `prompt`.

**Interfaces:**
- Produces:
  - `SYSTEM_PROMPT: string`.
  - `NEVER_USE_SENTENCE: string`, the one sentence that lists the banned phrases.
  - `buildSystem(packText: string): Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }>`.
    It returns two blocks: the prompt with the full `CLAUSE_GUIDE`, then the pack.
  - `buildHistory(messages: DatumMessage[], latest: { content: string; focus?: VisibleFinding }):
    MessageParam[]`. It takes the last `historyMessages` messages, maps engineer to `user` and datum to `assistant`,
    and merges consecutive same-role messages with a blank line. It always starts with `user`.

- [ ] **Step 1: Write the failing tests.** `SYSTEM_PROMPT` contains each of these, as substrings:
  - `"Never choose a number"`
  - `"only when the engineer asks"`
  - `"at most one re-run"`
  - `"a new version"`
  - `"the original is never changed"`
  - `"measured counts"`
  - `"start a new study in the generator"`
  - `NEVER_USE_SENTENCE`

  With `NEVER_USE_SENTENCE` removed, the prompt contains no `/independent\s*review|second[\s–-]*opinion|peer[\s-]*review|QA\s*\/?\s*QC|\baudit/i`.

  `buildSystem("P")` gives `[1].text === "P"`, and both blocks carry `cache_control`.

  Twenty-five alternating messages through `buildHistory` give at most 21 entries, and the first has `role
  "user"`. A focus finding's title appears in the last user turn.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the prompt as plain directive prose, not "CRITICAL/MUST" capitals. It covers:
  - who Datum is: the study's proofreader, advising the engineer of record
  - answer from the pack, or `read_study_path`, citing the payload paths
  - say plainly when a finding cannot be cleared by an input
  - the method-field rule and the never-choose-a-number rule
  - call `rerun_study_with_changes` only when the engineer's latest message asks for a change, at most once
  - after a re-run, say what changed and that the new version's findings will show on its own page
  - plain text, no markdown tables
  - `NEVER_USE_SENTENCE`
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(datum-chat): system prompt, cached system blocks, history`.

### Task 5: The tool loop (`run.ts`)

**Files:** Create `lib/datum-chat/run.ts`. Test: section `run`, with a fake client.

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:

```ts
export type DatumClient = { messages: { stream(params: object): {
  on(ev: "text", cb: (delta: string) => void): unknown; abort(): void; finalMessage(): Promise<ModelMessage> } } };
export type ModelMessage = { content: Array<{ type: string; [k: string]: unknown }>; stop_reason: string;
  model: string; usage: { input_tokens: number; output_tokens: number } };
export type TurnDeps = {
  client: DatumClient;
  revise: (input: RerunToolInput) => Promise<{ ok: true; projectId: string; version: number; changes: DatumChange[] }
                                            | { ok: false; error: string }>;
  readPath: (path: string) => string;
  emit: (e: DatumStreamEvent) => void;          // may throw after a disconnect; the loop must survive it
  signal: AbortSignal;                          // aborted on client disconnect
};
export async function runDatumTurn(deps: TurnDeps, input: { system: ReturnType<typeof buildSystem>; messages: HistoryMessage[] }):
  Promise<{ text: string; revision: { projectId: string; version: number; changes: DatumChange[] } | null;
            stopReason: string; model: string | null; inputTokens: number; outputTokens: number; cutOff: boolean }>;
```

- [ ] **Step 1: Write the failing tests.** The fake client replays scripted turns, emitting `text` deltas with a
  `setImmediate` between them. It records every `params` it was given.
  - **Explain only:** one `end_turn` turn with text "Because…". The result's `text === "Because…"`, `revision === null`,
    and `emit` saw `text` events, then nothing else. The recorded params have:
    - `model === "claude-opus-5-5"`
    - `thinking.type === "adaptive"`
    - `output_config.effort === "medium"`
    - `tool_choice` deep-equal to `{type:"auto", disable_parallel_tool_use:true}`
    - no `budget_tokens`, no `fallbacks`
    - `tools` names `["read_study_path","rerun_study_with_changes"]`
  - **Re-run:**
    - Turn 1 is `tool_use` of `rerun_study_with_changes` with `{changes:{growthRatePct:1}, reason:"county adopted
      1.0%"}`. Turn 2 is `end_turn` text.
    - `revise` is called once with that input. The result's `revision.version === 2`.
    - `emit` saw a `status` matching `/Re-running/`, then `revision`.
    - Turn 2's params end with a `user` message holding a `tool_result` for that `tool_use_id`, and the assistant
      message before it is turn 1's `content` unchanged, including a `{type:"thinking"}` block placed in the
      fixture.
  - **A second re-run** in one message gets a `tool_result` with `is_error:true` and content matching `/one re-run per
    message/`. `revise` is called once.
  - **An invalid tool input** (`{changes:{latitude:1}}`) gets `is_error:true`, and `revise` is not called.
  - **A refusal** (`stop_reason:"refusal"`) gives text "Datum couldn't answer that just now." and no tool run.
  - **`max_tokens` with a `tool_use`** runs no tool, and the text ends with that same line.
  - **The cap:** five scripted `tool_use(read_study_path)` turns give exactly 4 `stream` calls, then a final line.
  - **Review Focus 2:**
    - `emit` throws after the first `text`, and `signal` aborts. The loop calls `abort()` on the stream and returns
      `cutOff:true`. It does not reject.
    - When the abort lands while `revise` is pending, `revise` still resolves and the result carries the revision.
  - **An SDK error:** a stream whose `finalMessage` rejects with `Object.assign(new Error("x"), {status: 529})` gives
    an `error` event and text "Datum couldn't answer that just now.".
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the manual streaming loop in the skill's pattern, `messages.stream()` then
  `finalMessage()`:
  - Validate each tool input with zod before running it.
  - Never run tools on `refusal` or `max_tokens`.
  - Wrap every `emit` in try/catch; on throw, mark cut off.
  - Sum usage across turns.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `feat(datum-chat): streaming tool loop with one re-run per message`.

### Task 6: Versions, messages, and the re-run orchestration

**Files:**
- Create: `src/lib/study-revisions.ts`, `src/lib/datum-chat/store.ts`, `src/lib/datum-chat/revise.ts`
- Modify: `scripts/proofread-pg-harness/driver.mjs`
- Test: section `revise` (pure) plus the PG harness

**Interfaces:**
- Produces, in `study-revisions.ts` (DB):
  - `createRevision(args: { parentId: string; firmId: string; userId: string; request: unknown; result: unknown;
    changes: DatumChange[]; reason: string; sourceLabel: string | null; messageId: string | null; findingId: string
    | null; clauseId: string | null }): Promise<{ projectId: string; version: number; revisionId: string }>`. One
    transaction:
    1. Read the parent within firm (404 → throw `NotFound`).
    2. `root = parent.rootProjectId ?? parent.id`.
    3. `SELECT … FROM tis_projects WHERE id = root FOR UPDATE`.
    4. `version = 1 + max(version)` over `id = root OR root_project_id = root`.
    5. Insert the project, copying name, studyType, landUse code and size, site lat/lon, regionCode and
       reportThemeId, with `revisedFromProjectId = parent.id` and `rootProjectId = root`.
    6. Insert the `study_revisions` row.
  - `lineageFor(firmId, projectId)`: the `lineage` object of `DatumChatReadResponse`.
  - `listRevisions(firmId, projectId)`: the revisions made from this project or made into it, newest first.
  - `countLineage(firmId, rootId): Promise<number>`.
- Produces, in `store.ts` (DB):
  - `insertMessage(row): Promise<{ id: string }>`
  - `listMessages(firmId, projectId): Promise<DatumMessage[]>` (joins users for `authorName`)
  - `firmRepliesLast24h(firmId): Promise<number>`
  - `loadVisible(firmId, projectId): Promise<{ findings: VisibleFinding[]; dispositions: unknown[] }>`. This uses
    `latestRunForProject` from `proofread-store.ts` and drops `audience === "admin"`, exactly as GET
    `/projects/:id/proofread` does.
- Produces, in `revise.ts` (pure):
  - `reviseStudy(deps: { getParent; firmGate; inFlight: Set<string>; countLineage; generate; parseResult;
    createRevision; enqueueProofread }, args: { firm; user; parentId; input: RerunToolInput; messageId; findingId?;
    clauseId? })`. The return is the `revise` result type from Task 5. In order, it:
    1. checks the gate (`firmMayRunUncharged`, so a gate failure gives "Your firm has no studies left…")
    2. checks in-flight per user ("A re-run is already going…")
    3. checks the lineage cap of 25 ("This study has 25 versions…")
    4. runs `applyRevisionChanges`
    5. runs `generate` with `runSensitivity` kept as the parent had it
    6. checks `coverageWarning` (`ok:false` with its message)
    7. runs `parseResult`
    8. runs `createRevision`
    9. runs `void enqueueProofread(...).catch(log)`

    It always removes the in-flight key in `finally`. It never calls `reserveStudySlot`.

- [ ] **Step 1: Write the failing pure tests (section `revise`):**
  - **The happy path.** `createRevision` is called with `changes` from the merge, and `enqueueProofread` gets the new
    id. The fake `generate` saw `growthRatePct: 1`.
  - **A delinquent firm** gets `ok:false` and `generate` is not called.
  - **A user in flight** gets `ok:false` "already going".
  - **A lineage count of 25** gets `ok:false` at the cap.
  - **A coverage warning** gets `ok:false` with that message, and no `createRevision`.
  - **Errors free the lock.** `generate` throws, then `ok:false` "The re-run failed", and the in-flight set is empty
    afterwards.
  - **The source never charges.** Static: `revise.ts` source contains no `reserveStudySlot`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the three modules.
- [ ] **Step 4: Run** `check:datum-chat`. Expected: PASS.
- [ ] **Step 5: Add the harness assertions** in `driver.mjs`, following its existing block style. They are:
  - **The migrations.** After the harness migrate, both new tables and both columns exist.
  - **Review Focus 3.** Two concurrent `createRevision` calls from v1 give versions `{2,3}` with no duplicate. A third
    from v1 gives 4 with `revised_from_project_id` = v1. The v1 row's `request_payload` and `result_payload` are
    byte-equal to before.
  - **The reply count.** `firmRepliesLast24h` counts only `role='datum'` rows of that firm within 24 h.
  - **Cross-firm.** `createRevision` with another firm's id throws NotFound.
  - **Cascades.** Deleting the parent project leaves v2 with `revised_from_project_id` NULL, and v2's messages
    cascade only with v2.
- [ ] **Step 6: Run** `node artifacts/tis-api-server/scripts/proofread-pg-harness/run.mjs`. Expected: all pass, with
  the total above the previous 97. Stop and remove every cluster afterwards, and show `ps` with no harness
  postmaster left.
- [ ] **Step 7: Commit:** `feat(datum-chat): insert-only versions, message store, uncharged re-run orchestration`.

### Task 7: Routes, client, limiter, SDK

**Files:**
- Create: `src/routes/datum-chat-router.ts`, `src/routes/datum-chat.ts`, `src/lib/datum-chat/client.ts`,
  `scripts/datum-chat-live-smoke.mjs`
- Modify: `src/lib/security.ts`, `src/routes/index.ts`, `artifacts/tis-api-server/package.json` (add
  `@anthropic-ai/sdk`, the latest published version, and update the lockfile with `pnpm install`),
  `.env.example`. The `.env.example` addition is the line `ANTHROPIC_API_KEY=` with a comment saying the chat is off
  when it is unset.
- Test: section `router`

**Interfaces:**
- Produces:
  - `makeDatumChatRouter(deps: { isEnabled(): boolean; getClient(): DatumClient | null; resolveFirm(user); getProject(firmId,
    id); loadVisible; listMessages; insertMessage; listRevisions; lineageFor; firmRepliesLast24h; revise(firm, user,
    parentId, input, messageId, findingId?); limiter: RequestHandler }): IRouter`.
  - `datumChatLimiter` in `security.ts`: 40 per hour, keyed per user, with the same `skip` and `passOnStoreError` as
    `proofreadRunLimiter`. The message is "Too many Datum messages this hour. Try again shortly.".
  - `getDatumClient(): DatumClient | null`. It returns null when `!process.env.ANTHROPIC_API_KEY`. Otherwise it does
    a lazy `await import("@anthropic-ai/sdk")` once and caches `new Anthropic()`.

**Routes (both 401 unauthenticated, 404 for a non-uuid id or a project outside the firm):**

- **`GET /projects/:id/datum`** returns `DatumChatReadResponse`. With the chat disabled it returns
  `{enabled:false, messages:[], revisions:[], lineage}`.
- **`POST /projects/:id/datum/messages`** runs these steps in order:
  1. limiter
  2. validate the body (400)
  3. disabled → 503 `{error:"Datum chat is off."}`
  4. firm replies ≥ 300 → 429 `{error:"Datum has answered 300 questions for your firm today. It picks up again within 24 hours."}`
  5. `findingId` not in the visible set → 404
  6. insert the engineer message
  7. headers `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform` and
     `X-Accel-Buffering: no`, then `res.flushHeaders()`
  8. `runDatumTurn`. Each event is written as `data: <json>\n\n`, followed by `res.flush?.()`. On `req.on("close")`
     it aborts.
  9. insert the Datum message (text plus " (reply cut off)" when `cutOff`, with `revisionId`, model and tokens)
  10. emit `done`, then `res.end()`

  An exception after the headers emits `error` and then ends.

- [ ] **Step 1: Write the failing tests.** Mount `makeDatumChatRouter(fakes)` on `express()` with `compression()`
  and `express.json()`, plus a fake auth middleware setting `req.isAuthenticated` / `req.user`. Listen on port 0 and
  use `fetch`.
  - **Signed out:** GET gives 401.
  - **Another firm:** GET on another firm's project gives 404, and so does `/projects/not-a-uuid/datum`.
  - **Disabled:** GET gives `enabled:false`, and POST gives 503.
  - **Bad bodies:** POST with `{content:""}` gives 400, and with a `findingId` not visible gives 404.
  - **The firm cap:** POST with `firmRepliesLast24h → 300` gives 429.
  - **The stream:** POST happy path with the fake client from Task 5 gives `content-type` starting
    `text/event-stream`, and the events parse as `DatumStreamEvent`, ending with `done`. `insertMessage` is called
    twice (engineer, then datum).
  - **Review Focus 5:** the fake model waits 300 ms after its first delta. The client's reader gets the first `text`
    event at least 200 ms before the stream ends.
  - **Review Focus 2:** the client aborts its fetch after the first event. The server still calls `insertMessage`
    for the Datum reply with content ending " (reply cut off)" and does not crash. The next request succeeds.
  - **The client switch:** `getDatumClient()` with the key unset returns null and does not import the SDK. Assert by
    stubbing `import` resolution: the module has no top-level import of `@anthropic-ai/sdk`. This is a static check.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the factory, the wiring (`datum-chat.ts` passes the real modules), the limiter and the
  mount `router.use(datumChatRouter)` after `proofreadRouter`. Write `datum-chat-live-smoke.mjs`: it exits 2 with a
  message when the key is unset. Otherwise it sends one real request with `RERUN_TOOL`, `READ_PATH_TOOL` and
  `buildSystem` over `scenario-base.json`, and prints the stop reason and token counts. It is not added to any
  `check:*`.
- [ ] **Step 4: Run** `check:datum-chat`, every `check:proofread*`, `typecheck`, and `pnpm --filter
  @workspace/tis-api-server run build`. Expected: all PASS.
- [ ] **Step 5: Commit:** `feat(datum-chat): streaming routes, per-user limiter, firm cap, SDK client`.

### Task 8: Web chat

**Files:**
- Create: `artifacts/atlanta-tis/src/lib/datum-chat.ts`, `src/components/datum-chat.tsx`,
  `artifacts/atlanta-tis/scripts/check-datum-chat.mjs`
- Modify:
  - `src/components/proofread-panel.tsx` (add an `onAsk?: (f) => void` prop to `ProofreadView`; when it is set,
    render an "Ask about this" button inside the finding card after the disposition buttons, with
    `data-testid="button-ask-datum"`; add an "Ask Datum" box at the top of the panel when chat is enabled)
  - `src/pages/project-detail.tsx`
  - the project list page (`grep -rn "listProjects\|/tis-api/projects\"" src/pages` to find it)
  - `artifacts/atlanta-tis/package.json` (`check:datum-chat`)
  - `artifacts/tis-api-server/scripts/verify-proofread-copy.mjs` (add `chat: "artifacts/atlanta-tis/src/components/datum-chat.tsx"`
    and `prompt: "artifacts/tis-api-server/src/lib/datum-chat/prompt.ts"` to its file list and banned scan, with
    `NEVER_USE_SENTENCE` excluded by exact match)

**Interfaces:**
- Produces, in `lib/datum-chat.ts`:
  - `fetchDatum(projectId): Promise<DatumRead>`
  - `sendDatum(projectId, body, onEvent: (e) => void, signal): Promise<void>`. It POSTs with
    `credentials:"include"`, reads `r.body.getReader()`, and splits on a blank line.
  - `parseSseChunk(buffer: string): { events: DatumStreamEventT[]; rest: string }`
  - types mirroring the contract. atlanta-tis does not depend on tis-api-zod, as `lib/proofread.ts` notes.
- `DatumChat` component props: `{ projectId: string; focus: ProofreadFindingT | null; onClose(): void }`.

- [ ] **Step 1: Write the failing tests** in `check-datum-chat.mjs`. Bundle with esbuild the way
  `verify-proofread-copy.mjs` renders `ProofreadView`.
  - **Parsing:**
    - `parseSseChunk('data: {"type":"text","delta":"a"}\n\ndata: {"ty')` gives one event, with
      `rest === 'data: {"ty'`.
    - A chunk with `\r\n\r\n` separators parses.
    - A malformed JSON event is dropped, not thrown.
  - **Rendering:**
    - With `onAsk` set, the rendered panel has one `button-ask-datum` per visible finding. Without it, it has none.
    - `DatumChat`'s pure `ThreadView({messages, revisions, streaming})` renders an engineer message containing
      `<img src=x onerror=alert(1)>` as escaped text: no `<img` in the HTML.
    - A revision card shows `growthRatePct: 2.1 → 1` and a link `href="/projects/<id>"` with text "Version 2".
  - **Disabled:** `enabled:false` renders no chat UI and no Ask buttons.
- [ ] **Step 2: Run** `pnpm --filter atlanta-tis run check:datum-chat`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - **Drawer.** A right-side drawer that matches the panel's Tailwind styling. Text renders with `whitespace-pre-wrap`
    and no markdown or `dangerouslySetInnerHTML`.
  - **Composer.** It counts down from 2000 characters and is disabled while streaming. The status line shows `status`
    events.
  - **Change card.** It lists the fields with "from → to", the reason, who asked, and the version link.
  - **Project page.** It shows "Version N · revised from Version N-1" (linked), and "A newer version exists:
    Version M" when `latestVersion > version`.
  - **Project list.** It shows a "vN" badge when `version > 1`.
- [ ] **Step 4: Run** `check:datum-chat` (web), `check:proofread-copy`, and web `typecheck` and `build`. Expected:
  PASS.
- [ ] **Step 5: Commit:** `feat(datum-chat): chat drawer, ask-about-this, version line`.

### Task 9: Boundary guards and docs

**Files:**
- Modify: `scripts/verify-datum-chat.mjs` (section `guards`), `src/lib/proofread/types.ts`,
  `docs/superpowers/specs/2026-09-29-datum-in-product-design.md` (the addendum)

- [ ] **Step 1: Write the failing guards.** Each one has a teeth mutation applied in memory, as the proofread
  guards do, and that mutation must turn the guard red by name:
  - `chat-never-mutates-studies`: no file under `src/lib/datum-chat/`, `src/routes/datum-chat*.ts` or
    `src/lib/study-revisions.ts` calls `db.update(`, `db.delete(`, or raw SQL `update`/`delete` on `tis_projects`,
    `study_revisions` or any `study_proofread_*` table. Teeth: an inserted
    `db.update(tisProjectsTable).set({projectName:"x"})`.
  - `only-study-revisions-inserts-projects`: `insert(tisProjectsTable` appears in `study-revisions.ts` and nowhere
    else in the chat files.
  - `allowlist-matches-spec`: parse the spec's "Fields the chat may change" paragraph for backticked names. They
    must equal `REVISABLE_FIELDS` minus `removeGrowthOverride`. Teeth: drop `weather` from the contract copy.
  - `revise-never-charges`: no `reserveStudySlot` and no `releaseStudySlot` in the chat files.
  - `client-lazy`: `client.ts` has no static import of `@anthropic-ai/sdk`.
  - `store-reads-proofread-only`: `store.ts` imports only `latestRunForProject` from `proofread-store`.
- [ ] **Step 2: Run.** Expected: FAIL only for the teeth runs. Before the docs change, also expect a red on
  `types-header-names-chat`, which asserts the new header sentence.
- [ ] **Step 3: Update the docs:**
  - Replace the `proofread/types.ts` header sentence with the spec's exact sentence: "Proofread advises and never
    writes. The Datum chat changes inputs only when the engineer asks, by making a new version; the original is never
    changed."
  - Append the addendum (five lines, linking the new spec) to the 2026-09-29 spec.
  - Run `check:proofread-protocol` to confirm the docs still pass the protocol guard.
- [ ] **Step 4: Run** every `check:*` in both apps, `typecheck` across the workspace, both builds, and the PG harness
  once more. Expected: all PASS. Paste the summary lines.
- [ ] **Step 5: Commit:** `test(datum-chat): boundary guards; docs name the chat as the only executor`.
