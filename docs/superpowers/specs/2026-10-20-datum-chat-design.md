# Datum chat: ask why a finding was flagged, and have Datum make the fix

Date: 2026-10-20. Branch `feat/datum-chat`, stacked on `feat/datum-in-product` (gkogon/tis-study#262). It ships with that PR.

## Intent

Phase 1 put Datum's findings on the study page. An engineer can read them and record a decision, but they cannot ask
anything. The owner wants the engineer to be able to talk to Datum about the study:

- **"Why was this flagged, and how do I fix it?"** That is the main question (owner's words).
- **"Make the fix."** When the engineer asks, Datum applies it straight away, with no confirm step (owner: "make the
  fix", "proceed").

Datum was built as an advisor that never executes "unless told to be one". The chat is where the engineer tells it to.
The proofread itself stays advisory and unchanged. Only the chat executes, and only when the engineer asks.

## Goals

1. A chat on the study page. Each finding card gets an **Ask about this** button that opens the chat on that finding.
   A box at the top of the panel takes questions about the study as a whole.
2. Answers are grounded in this study: the finding, the values it read, the inputs, and the result. They are not
   general traffic advice.
3. When the engineer asks for a change, Datum re-runs the study with the corrected inputs and saves it as a **new
   version**. The original is never changed.
4. Every change is logged: who asked, which finding it was for, each field's old and new value, and the reason or
   source the engineer gave.
5. The new version is proofread automatically. The chat reports whether the finding cleared.

## Non-goals (v1)

- Changing the site, land use, size, project name, driveways, measured counts, or study intersections. For any of
  those, the chat points the engineer to the generator and does not run anything.
- Recording dispositions (FIXED, DISCLOSED, WITHDRAWN) from the chat. The panel's buttons stay the only way.
- Model-written findings (the spec's phase-2 model pass) and the spec's phase-3 EXPLAIN/CONTEST channel. The chat
  replaces EXPLAIN for now. CONTEST stays unbuilt.
- PDF changes and email notifications.

## Anti-goals

This would be a failure even if it technically worked:

- **Datum tuning an assumption until a check passes.** Datum never picks a number: no growth rate, pass-by %,
  opening year, cycle length, or split. Numbers come from the engineer, and the log keeps the source they give. If
  they give no source, the log says "no source given". Datum applies the engineer's value rather than refusing it,
  but it never proposes a value to make a finding go away.
- **Losing or changing the original study.** A fix always creates a new version. Nothing ever updates or deletes an
  existing study row.
- **A change nobody asked for.** Datum applies a change only in reply to an engineer message that asks for one. It
  makes at most one re-run per message.
- **Showing the engineer a withheld finding.** The chat sees exactly what the panel shows that user. DEFECT findings
  stay withheld.
- **Banned copy.** Never "independent review", "second opinion", "peer review", "QA/QC" or "audit", in the UI or in
  Datum's replies.

## What can be fixed

This is the honest picture on the current engine (from the clause-to-input map, 2026-10-20). Most findings that fire
today are not cleared by retyping an input. The chat has to say so plainly instead of pretending.

| Finding | What the chat does |
|---|---|
| growthOverrideDisclosed, growthMultiplierReproduces, rateReproducesTotal, passByBasisNamed, periodScopeDisclosed | These fire on older saved studies. Fix: **re-run on the current engine with the same inputs**, which needs no new value. Also possible: drop the growth override, set pass-by to 0, or narrow the periods, if the engineer asks. |
| vcPlausibility (Intersection / Approach / DesignYear) | Explain which row and what drives its capacity. The real remedy is measured counts and timing. Datum can switch the engine to its fuller methods when asked to "fix it" (computed timing, network leg volumes, real lane geometry). Those are method choices, not numbers. It applies the engineer's timing sheet (cycle, phases, splits) as a signal-timing override, taking the signal's coordinates from the study's own row. It cannot bring in measured counts (non-goal). It says so and points to the generator's UTDF/Synchro import. |
| screeningClampDisclosed | Same as v/c: more capacity or better timing lowers the delays. No text can clear it. |
| scopeNoteConsistent | Explain the merge or trim. If the trim comes from scoped intersections, Datum can turn the scope option off when asked. |
| criteriaNamed | Explain only. It is engine-side, because the DOT name is region-derived. |
| losMatchesDelay (DEFECT) | Never shown to the engineer, so never in the chat. |

**Fields the chat may change** (the allowlist): `growthRatePct` (or remove it), `openingYear`, `analysisPeriods`,
`passByPct`, `internalCapturePct`, `weather`, `scopeStudyIntersections`, `signalTiming`, `legVolumes`,
`realLaneGeometry`, `conservedAssignment`, and `signalTimingOverrides`. The overrides must be full records from the
engineer, with coordinates copied from the study row. An empty change set means "re-run on the current engine".

**Every other field** is copied from the original unchanged. Each value is checked against the request schema's own
bounds (`GenerateTisBody`) after the merge. A value outside them is refused, and Datum tells the engineer why.

## How it behaves

1. The engineer clicks **Ask about this** on a finding, or types in the box.
2. The browser posts the message. The server streams Datum's reply back as it is written.
3. Datum answers from a grounding pack the server builds (see Grounding below).
4. If the engineer asked for a change, Datum calls its re-run tool. The panel shows "Re-running with growth 1.0% (was
   2.1%)…".
5. The engine runs and a new version is saved and proofread.
6. A change card appears in the thread. It shows the changed fields with old and new values, the reason, who asked, and
   a link to **Version N**.
7. When the new version's proofread finishes, its own panel shows whether the finding cleared. The chat on the old
   version says "Open Version N to see its findings". It does not poll on the old page.

There is one thread per study version, saved. Every firm member who can open the study sees the thread and who asked
what. The new version starts its own thread, which opens with a "Revised from Version N-1: <changes>" header.

## Grounding

The server builds the pack. It is capped at about 60 KB, the size the spec planned. It contains:

- **The visible findings** of the latest proofread run for this user, from the same set the panel GET returns. The
  focused finding comes first, in full: clause, title, detail, readPaths, remedy, source label and decision.
- **A static clause guide**: for each of the 11 engineer-visible clauses, why it fires, what clears it, and which
  inputs matter. It is written once, from the clause-to-input map, and lives beside the clauses.
- **The values at each focused readPath**, read from the stored request and result.
- **The request**, with the large arrays summarized (UTDF, driveways, trip profile).
- **A result summary**: rows with v/c over 2.5, LOS and delay by period, growth source, pass-by applied, coverage,
  and region / DOT.
- **A read-only tool** to fetch any other path from the stored request or result, capped at 8 KB per call.

The system prompt and the clause guide are cached (prompt caching). History sends the last 20 messages.

## The model call

- `@anthropic-ai/sdk` in `tis-api-server` only, with model `claude-opus-5-5`.
- Adaptive thinking, effort `medium`, streaming, and `max_tokens` around 4k.
- Tool choice `auto`, with strict schemas.
- Tools:
  - `read_study_path(path)`, which is read-only.
  - `rerun_study_with_changes({changes, reason, sourceLabel?, findingId?})`, where the `changes` keys are the
    allowlist only.
- A server-side tool loop, capped at 4 model turns per engineer message and one re-run.
- No refusal fallback (my call). The skill documents server-side fallbacks as a Fable 5.1 default, and a fallback to
  an older Opus drops this model's thinking. A `refusal` stop reason ends the turn with a plain line, and so do typed
  SDK errors: "Datum couldn't answer that just now."
- **No `ANTHROPIC_API_KEY` means the chat is off.** The panel looks exactly as it does today, and the routes answer
  `{enabled: false}`. CI never calls the model. The tests use a fake client.

## Data

These are additive changes in `lib/db/migrate.mjs`, using CREATE/ADD IF NOT EXISTS, as phase 1 did.

**`tis_projects`** gets two new columns:
- `revised_from_project_id uuid null` FK → tis_projects(id) ON DELETE SET NULL
- `root_project_id uuid null` FK → tis_projects(id) ON DELETE SET NULL, plus an index

On a new version:
- version = 1 + the max version in that lineage
- name, region code and report theme are copied
- the user is the engineer who asked
- the firm is the project's firm

**`study_revisions`** is append-only, one row per version the chat made. Columns:
- id
- project_id (the new version; unique; FK cascade)
- from_project_id
- root_project_id
- firm_id
- requested_by_user_id
- message_id
- finding_id (null; FK set null)
- clause_id
- changes jsonb `[{field, from, to}]`
- reason
- source_label
- created_at

**`study_datum_messages`** has these columns:
- id
- project_id (FK cascade)
- firm_id
- user_id (null for Datum)
- role `engineer` | `datum`
- content
- finding_id (null; FK set null)
- revision_id (null)
- model
- input_tokens
- output_tokens
- stop_reason
- created_at

All ids are uuid. The production uuid check that PR #262 needs before merge covers these FKs too.

## Limits and cost

- **No study slot is charged for a version** (owner may override). The site, land use and size are locked, so it is
  the same study revised, not a new one.
- `firmMayRunUncharged` gates re-runs, so a delinquent firm with nothing left cannot run them. This is the same gate
  /whatif uses.
- One re-run at a time per user (409), and a cap of 25 versions per lineage.
- A new `datumChat` limiter allows 40 messages per hour per user. Engineer messages are capped at 2,000 characters.
- Each firm gets 300 Datum replies per rolling 24 hours, counted from `study_datum_messages`, so it needs no new
  counter column. Past that, the chat says it is resting until tomorrow.
- Token counts are stored on every reply.

## Routes

These are new, in `routes/datum-chat.ts`. Access works like GET `/projects/:id`, and a study the user cannot open is a
404.

- **GET `/projects/:id/datum`** returns `{enabled, messages[], revisions[], lineage: {version, revisedFrom?,
  latestVersionId}}`.
- **POST `/projects/:id/datum/messages`** takes `{content, findingId?}` and answers with a server-sent event stream.
  The events are:
  - `text` (a delta)
  - `status` (a re-running line)
  - `revision` (`{projectId, version, changes}`)
  - `done` (`{messageId}`)
  - `error` (`{message}`)

## Where it lives

Server (`artifacts/tis-api-server/src/`):
- `lib/datum-chat/`:
  - `context.ts` (the pack)
  - `clause-guide.ts`
  - `prompt.ts`
  - `tools.ts` (the allowlist, merge and validation)
  - `run.ts` (the loop, with the client injected)
  - `store.ts` (messages)
- `lib/study-revisions.ts` is the only code that inserts a version and its log row. It is one transaction, and it
  never updates or deletes.
- `routes/datum-chat.ts`, and the new limiter in `security.ts`.

The proofread files (`lib/proofread*`, `routes/proofread.ts`) do not change. Their guards still hold.

Web (`artifacts/atlanta-tis/src/`):
- `components/datum-chat.tsx` (the drawer, the change card and streaming text)
- `lib/datum-chat.ts`, which reads the stream with fetch, not EventSource, because the stream comes from a POST
- the **Ask about this** button in the proofread panel's finding card
- a version line on the project page ("Version 2 · revised from Version 1"), and a "v2" badge in the project list

Contract: `lib/tis-api-zod/src/datum-chat.ts`. It is hand-written and strict, like `proofread.ts`.

Docs: a short addendum to `2026-09-29-datum-in-product-design.md`, and the `proofread/types.ts` header becomes:
"Proofread advises and never writes. The Datum chat changes inputs only when the engineer asks, by making a new
version; the original is never changed."

## Checks (new `check:datum-chat`, run in CI)

The check verifies that:
- The allowlist equals the one in this document, the tool schema's keys are a subset of it, and no locked field
  appears.
- The chat code never updates or deletes `tis_projects`, `study_revisions` or any proofread table. Only
  `study-revisions.ts` inserts.
- With the key unset, the routes report disabled and nothing is imported at call time.
- The system prompt states the rules: no numbers chosen by Datum, one re-run per message, the banned copy, and DEFECT
  withheld.
- The copy guard's banned-phrase scan covers `datum-chat.tsx` and the prompt.

**Behaviour tests with a fake model client:**
- An explain-only answer.
- A change, which produces a new version, a log row, and an untouched original.
- A locked field, which is refused.
- A value out of bounds, which is refused.
- A second re-run in one message, which is refused.
- A delinquent firm, which gets 402.
- A concurrent re-run, which gets 409.
- The firm cap.
- A user from another firm, who gets 404.

The opt-in Postgres harness gets the three schema additions.

## Owner actions before it works in production

1. Add `ANTHROPIC_API_KEY` to the Railway **web** service.
2. Merge main into #262 and run the production uuid check (already pending).

## Left to the builder

- Wording of the chat UI, within the copy rules.
- Exact pack trimming.
- Visual styling, matching the proofread panel.
- How the lineage list renders.
