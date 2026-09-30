# Datum in the product — proofread runs on a saved study — design

Turns the dev-side proofreader (`.claude/agents/datum.md`, governed by `TIS-PROOFREAD-PROTOCOL.md`) into a product feature: after a study is generated, a **proofread run** produces findings the engineer — and later the sealing PE — reads, questions and triages in the app.

**Datum is an advisor, not an executor.** It reads, reports, and answers questions. It never writes to a study, never applies a change, never edits a deliverable. That boundary is structural here, not instructed, mirroring how the agent is constrained today by its tool list (`.claude/agents/datum.md:5`) rather than by a rule it is asked to obey:

- the clause functions are pure and return finding records only — no patch, no suggested replacement value, no write path;
- the API exposes **read**, **request-a-run**, and **record-a-triage-decision**, and nothing else. No route writes `tis_projects.request_payload` or `result_payload` (`lib/db/src/schema/tis-projects.ts:62-63`), and no column is added to `tis_projects`;
- the judgment model call gets **no tools** and an output schema containing no mutation verb and no numeric field.

An executor mode is out of scope. If one is ever granted it is a per-action, human-granted capability with its own spec — never a default, and never inferred from a finding.

## Goal

1. Every generated study gets a proofread automatically, asynchronously, without delaying the engineer's response.
2. The engineer sees the findings on the project page, can ask about one, and can record a disposition against it.
3. A re-run refreshes findings against the saved record without re-running the engine.
4. Later: the sealing PE rules on contested items, and a study's completion gate is visible.

## Non-goals

- **Datum editing anything** — including writing a disclosure into the deliverable. That is executor work; see the advisor boundary above.
- **A backfill over historical studies.** Four staleness traps land together on a pre-feature row (`currentVc` optional; `tripGeneration.dailyRate/amRate/pmRate/variableSource` optional per `openapi.yaml:1055-1073`; per-row `signalTiming` absent before the resolver shipped; `growthYears` derived from a module-private `CURRENT_YEAR` captured at import, `tis.ts:663`). A backfill would produce exactly the padded list `TIS-PROOFREAD-PROTOCOL.md:65-69` forbids. Old studies have no run until one is requested, and then a declared input manifest marks the unrunnable clauses `not-run`.
- **SSE / streaming.** The repo has zero precedent (no `text/event-stream`, `flushHeaders` or `res.write` outside generated bundles) and `compression()` is mounted globally at `artifacts/tis-api-server/src/app.ts:87`. The panel polls.
- **ITE verification.** Protocol §2a stands: no license. Rules verify a rate against the tagged `source` string on `LAND_USES`, never against ITE, and the model never produces an ITE figure.
- **Web retrieval server-side.** The dev agent has `WebFetch`/`WebSearch`; the run does not. Clauses needing the agency's published document (§5) or a basemap (§3.2) are `not-run`, not `UNVERIFIED` — and nothing in the repo stores an agency document, so that is a standing gap, not a per-study one.
- **Re-render-based text checks.** A render pulls in `./crashes` and `./atr-counts` (live Postgres) plus `./fdot-live-data`, `./nysdot-data`, `./nyc-transit-data`, `./streetview`, `./transit-routes` (live fetches), so a re-render is neither pure nor equal to the delivered document. Text clauses read payload strings only.
- **Writing a Datum disclosure into every PDF.** Noted as a later decision: `findings[]`/`methodology[]` do not reach `renderTisNorthCarolina`, `renderTisSouthCarolina`, `renderTisState`, `renderTisNewYork` or `renderCeqrNyc`; the working precedent for reaching every region is `buildStudyScopeNote` consumed by `renderCapacityAppendix` (`pdf-export.ts:1333-1336`). Either way it is a study-content change, not an advisor's.

## Prerequisite: protocol amendments (blocking)

The protocol is the text this design is read against, and it currently contradicts the product in ways no implementation can read around. These edits land **before** implementation:

1. **Audience.** `TIS-PROOFREAD-PROTOCOL.md:9-11` ("admin-side only … its findings are not shown to the customer"), restated at `.claude/agents/datum.md:29-30`, forbids this feature on its face. Amend to define three audiences: engineer, sealing PE, admin. `DEFECT` stays admin-side and routes to the code queue, never to the PE (`:51-53` — a PE cannot rule on a software defect), and fans out to a study-population query, since a DEFECT means every study the engine produced carries it.
2. **Permitted copy.** `:38-42` bans "independent review", "second opinion", "peer review" and "QA/QC by a separate reviewer" in any customer venue — and the product surface *is* a customer venue. Product copy uses the permitted phrasing verbatim from `:40`: **"an internal consistency and traceability check."** `.claude/agents/datum.md:13` is itself prohibited copy and gets fixed.
3. **One completion gate.** Four incompatible gates exist today: `:329-330` (empty BLOCKER **and** empty CONTESTED), `datum.md:112` (BLOCKER only), `:293-294` (any undisposed finding, which sweeps in NOTE and DISCLOSE), and the skill's blocking bare `UNVERIFIED`. Adopt `:329-330` and reconcile the other three to it.
4. **One taxonomy.** The types are enumerated four times with four memberships. Fix to six — `BLOCKER`, `DEFECT`, `DISCLOSE`, `NOTE`, `UNVERIFIED`, `CONTESTED` — with `RESOLVED`/`WITHDRAWN` unified as one *disposition*, not a type. Add `DEFECT` to `datum.md`'s frontmatter description (a dispatcher matches on that line).
5. **Stale source refs.** `:89-91` and `datum.md:56-61` point at `artifacts/tis-api-server/src/lib/{land-uses,signal-delay,regional-growth-rates}.ts`, which are two-line `export * from "@workspace/tis-engine-core"` shims. Retarget to `lib/tis-engine-core/src/*.ts`. Also: `queue95Ft` is the exported function, the payload field is `queue95thFt`; drop the `LOS_THRESHOLDS` reference (module-private at `signal-delay.ts:35`) in favour of the exported `delayToLos`.
6. **The flat-timing standing note (`:240-247`) is now false.** `signalTiming` defaults to `computed` (`openapi.yaml:955`) and `resolveTimingForRow` is the default path (`row-math.ts:832`, called `:951`, screening-only early return `:841`). Retarget the note to each row's `signalTiming.basis` ∈ {measured, measured-cycle, webster, screening-default}. **No rule may assert a flat 90 s / g/C 0.45 disclosure** — it would fire falsely on every default-run study.
7. **A protocol version string.** `:283` requires one in every log entry and none exists. Add `PROTOCOL_VERSION` (date-stamped, e.g. `2026-09-29.1`), recorded on every run.
8. **Define the PE** — which side of the customer boundary they sit on, and what authorizes them. Nothing in the repo answers this (see *Completion gate and the PE*).

## Naming

The word "findings" is taken: `TisReport.findings` is required (`openapi.yaml:1778`) and `FindingsCard` renders it (`pages/tis.tsx:1273`). Use **`ProofreadRun`** and **`ProofreadFinding`**, tables `study_proofread_*`, payload key `proofread.findings`, never a bare top-level `findings`.

## Where the code lives

| Layer | Path | Why |
|---|---|---|
| Pure clause functions | `lib/tis-engine-core/src/proofread/` | Testable under plain `node` with no env. Importing `@workspace/db` throws at module evaluation when `DATABASE_URL` is unset (`lib/db/src/index.ts:7-11`), so the check script must never reach the runner. |
| Runner, persistence, model call | `artifacts/tis-api-server/src/lib/proofread/` | Needs the db and the network. |
| Routes | `artifacts/tis-api-server/src/routes/proofread.ts`, registered in `routes/index.ts` | Mounts under `/tis-api` via `app.ts:123`; absolute paths inside the router, per convention. |
| Schema | `lib/db/src/schema/study-proofread.ts` + `export * from "./study-proofread"` in `schema/index.ts` | That one line covers the drizzle client, the `@workspace/db` barrel and drizzle-kit's entry. |
| Panel | `artifacts/atlanta-tis/src/components/proofread-panel.tsx` | One self-contained component. |

Clauses import `LAND_USES`, `resolveRatesForVariable`, `delayToLos`, `vcToDelay`, `queue95Ft`, `implausibleVolumeDisclosures`, `isGrowthOverride`, `getMeasuredGrowthRate`, `getMeasuredGrowthSource`, `DESIGN_YEAR_HORIZON_DEFAULT` and `hash32` (`row-math.ts:115`, re-exported at `index.ts:21`) from `@workspace/tis-engine-core`, and `./mode-share` relatively. `proofread/` must not import `artifacts/tis-api-server/src/lib/tis.ts` — the launch path imports the other way.

**Reuse the engine's exported functions; never restate a threshold.** Where a clause genuinely needs a module-private literal (`LOS_THRESHOLDS` `signal-delay.ts:35`; `T`/`k` in `vcToDelay` `:117-118`; the 1.65 Poisson factor in `queue95Ft` `:144`; `SANDAG_2002`/`NCHRP_716`/`SD_CITY_2003` `land-uses.ts:109-112`; `PER_REGION_AUTO_SHARE`/`FALLBACK_AUTO_SHARE`; `RATES`/`STATE_BY_METRO`/`SOURCE_BY_STATE`), export it and add the name to the `EXPECTED` array in `artifacts/tis-api-server/scripts/verify-engine-core-exports.mjs:19-64` **in the same commit** — it asserts `extra.length === 0` and an exact count, so the first PR fails CI otherwise. Duplicating the literal is the exact drift Datum exists to catch.

## Data model

Three tables, `gen_random_uuid()` primary keys, `firm_id uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE` carried on the run row (derivable, but it gives the firm-scoped read every route already performs and survives a parent whose `firmId` is a legacy `NULL`). New statements go in `lib/db/migrate.mjs` in the house style — one `CREATE TABLE IF NOT EXISTS` entry, then one-line `CREATE INDEX IF NOT EXISTS "IDX_..."` entries, copying the `firm_report_themes` block at `:139-147`. Mixed-case index names stay double-quoted. The file has no ledger: every statement re-runs each boot, nothing may DROP, rename, or `ADD CONSTRAINT`.

- **`study_proofread_runs`** — `project_id uuid NOT NULL REFERENCES tis_projects(id) ON DELETE CASCADE` (findings only mean something against one study snapshot), `firm_id`, `revision int`, `status varchar(16) NOT NULL DEFAULT 'queued'` ∈ {`queued`, `running`, `rules_ready`, `ready`, `failed`} with the values enumerated in a comment (the `monitoring_enrollments.status` precedent, `:47` — no `pgEnum` anywhere in this repo), `protocol_version`, `rules_version`, `engine_stamp`, `input_manifest jsonb`, `coverage jsonb`, `model varchar(64)`, token/cost columns, `attempts int`, `claimed_at`, `claimed_by`, `error text`, `requested_by_user_id varchar`, timestamps. Index on `(project_id, revision)` and on `status`.
- **`study_proofread_findings`** — a child table, not jsonb, because triage state is per finding: `run_id`, `clause_id varchar(64)`, `section smallint` (1–6), `type varchar(12)`, `origin varchar(8)` ∈ {`rule`, `model`}, `title text`, `detail text`, **`source_label text NOT NULL`**, **`read_paths jsonb NOT NULL`** (the exact payload paths and values the clause read), `remedy text` (prose advice — never a patch), `audience varchar(12)` ∈ {`engineer`, `pe`, `admin`}, `fingerprint text` (see below).
- **`study_proofread_dispositions`** — append-only: `finding_id`, `disposition varchar(16)` ∈ {`FIXED`, `BUG_FILED`, `DISCLOSED`, `WITHDRAWN`, `CONTESTED_PE`, `ACCEPTED_RISK`}, `note text`, `source_label text` (required for `WITHDRAWN` — the protocol withdraws only on a source), `actor_user_id varchar`, `created_at`. Current disposition is the latest row. Append-only because `:295-297` requires `ACCEPTED_RISK` to record **who** and **when**.
- **`study_proofread_questions`** — phase three; see *Questions channel*.

`source_label` is `NOT NULL` and the `Finding` type makes `source` non-optional, so "a finding with no named source is an opinion, not a finding" (`:255-256`) is a compile error rather than a habit.

**Finding identity.** `fingerprint = hash32(clause_id + section + canonical(read_paths))`. This is the key a disposition carries forward across a re-run; nothing in the repo had one. A finding whose fingerprint matches under the same `engine_stamp` keeps its dispositions; anything else is new and open. No `WITHDRAWN` item silently reopens, and no `ACCEPTED_RISK` with its named person is lost.

**Engine stamp.** No version stamp exists anywhere: the only version-ish field on a report is `generatedAt`, there is no `GIT_SHA`/`APP_VERSION` in the server, and `tis_projects.version` is hardcoded to 1 by `saveProject`. Add `engine_stamp = hash32(canonical(rule-relevant constants)) [+ commit sha env when present]`, recorded on the run. Without it, "what happens when the engine changes" has no answer — the live proof is Wake, where the same request produced intersection v/c 2.61–3.93 before #227 and 0.71–1.87 after, with nothing in either payload naming the engine.

## The run lifecycle

**Enqueue.** In `routes/tis.ts`, between the `if (!saved)` refund branch and `res.json(validated)` (`:463-469`), un-awaited, in the exact style of the adjacent `logEvent` at `:464`. **Not** after `res.json` — that sits inside the handler's try/catch whose catch calls `releaseStudySlot` and `res.status().json()`, so a throw there issues a spurious quota refund and writes to a sent response. **Not** inside `saveProject`, which already swallows all errors and returns `null` by contract and is exercised by build-time scripts. The other four generate routes (`road-diet.ts:62`, `warrants.ts:66`, `queuing.ts:62`, `sight-distance.ts:69`) already hold `saved` and get the same hook when their engines are in scope.

**Claim.** The process is multi-instance by explicit design statement (`lib/redis.ts:5-9`, `lib/signup-defense.ts:128-130`, `.replit` `deploymentTarget="autoscale"`), and there is no jobs table, no scheduler, and no locking primitive in the repo — `pg_advisory`, `FOR UPDATE` and `SKIP LOCKED` appear zero times. So this design introduces the first one, deliberately:

```
UPDATE study_proofread_runs SET status='running', claimed_at=now(), claimed_by=$1, attempts=attempts+1
WHERE id = (SELECT id FROM study_proofread_runs
            WHERE status='queued' OR (status='running' AND claimed_at < now() - interval '10 minutes')
            ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING *
```

A claim is a 10-minute lease, so a container recycled mid-flight leaves a row that the next claim reclaims. `attempts >= 3` → `failed` with the last error. Redis is **not** load-bearing: `REDIS_URL` is optional and unset in dev, and every existing use falls back to per-instance memory and fails open. There is no scheduler, so the sweep is opportunistic — attempted on each enqueue and on each `GET`, bounded to one claim per call. `whatIfInFlight` (`tis.ts:503`) is the wrong precedent: it guards per instance.

**Fail-open.** A failed run never affects the study. Rules run first and persist on their own, so a model outage leaves `rules_ready` with real findings; `ANTHROPIC_API_KEY` unset means every run ends at `rules_ready`, which is exactly phase one.

## Rule clauses — phase one

Pure functions over `(requestPayload, resultPayload)`. **Scenario field names invert their plain reading and this is permanent:** `current*` = Existing (counted, no growth), `existing*` = opening-year **No-Build** (grown), `future*` = opening-year Build, `designNoBuild*`/`designBuild*` = design year. A clause that reads `existingLos` as the counted condition reproduces the defect `verify-scenario-labels.mjs` exists for.

| Clause | § | What it checks |
|---|---|---|
| `growthOverrideDisclosed` | 1 | `requestPayload.growthRatePct` present ⇒ `growthSource` exists and `isGrowthOverride(growthSource)` |
| `growthMultiplierReproduces` | 1 | `growthMultiplierExact` vs `(1 + growthAppliedPct/100) ^ growthYears` |
| `rateReproducesTotal` | 2 | the printed rate × size reproduces the printed total; `not-run` on legacy payloads where the rate fields are absent |
| `passByBasisNamed` | 2 | an applied pass-by reduction is stated in the deliverable. **Only `passByPctPm`** (nonzero on 19 of 51 land uses); the same clause on `internalCapturePctPm` is vacuous — it is 0 on all 51, and internal capture is nonzero only when the request supplies it (`tis.ts:1364`) |
| `vcPlausibilityIntersection` | 4 | `implausibleVolumeDisclosures` over the saved rows against `PLAUSIBLE_MAX_INTERSECTION_VC` (`signal-delay.ts:98`) |
| `vcPlausibilityApproach` | 4 | **new** — per-approach v/c above the ceiling. Fires today on the shipped Wake sample (NB 3.11/3.16, 3.22/3.27/3.34, 2.86/2.90/2.97) where the intersection-level guard is silent at max 1.87 |
| `vcPlausibilityDesignYear` | 4 | **new** — design-year v/c above the ceiling. Fires today on Wake (`designBuildVc` 2.54) and Bexar (3.04), both silent |
| `losMatchesDelay` | 4 | `delayToLos(row.futureDelaySec) === row.futureLos` per scenario — the "LOS F with no delay" class, currently guarded only by `verify-intersection-delay-fields.mjs`, which is on disk but absent from `package.json` and therefore never runs |
| `screeningClampDisclosed` | 4 | a delay at the cap is disclosed. Test against `SCREENING_MAX_DELAY_SEC × calMul`, **not** `=== 300` — the calibration multiplier is applied after the clamp at every call site |
| `criteriaNamed` | 5 | the study names the controlling criteria with their tagged source, read from the in-engine tables — `standard-methodology.ts` (MTIASD baseline, `controllingImpactParadigm()`) and `study-tier.ts` (the published local deliverable tiers). **There is no agency-document store in this repo**, so any clause needing the agency's own published PDF is permanently `not-run` in v1, and the spec says so rather than implying an upload exists |
| `periodScopeDisclosed` | 6 | **new, no build-time ancestor** — `requestPayload.analysisPeriods` (or the four-period default) vs `resultPayload.periodReports[]`; every period not analyzed must be named. The protocol's multifamily-AM-peak example (`:236-238`) is unenforced anywhere today |
| `scopeNoteConsistent` | 6 | recompute `buildStudyScopeNote`'s inputs from `intersectionsInStudyArea` / `intersectionsMergedAsDuplicates` / `intersectionsStudied` / `studyRadiusMi`, honouring `study-scope-note.ts:69-73` (force-included signals come from outside the radius, so analyzed may legitimately exceed in-radius) |

`vcPlausibility*` clauses normalize at the boundary — `Math.max(row.currentVc ?? 0, row.existingVc ?? 0)`. Verified live: `implausibleVolumeDisclosures([{name:'X', existingVc:8.68}])` returns `[]`, because `Math.max(undefined, 8.68)` is `NaN` and the finite filter drops the row, while `currentVc: null` does fire. Un-normalized, every legacy study reports clean at any v/c.

Approach-level recomputation reads the row's own `throughLanes`/`lanesSource` and `signalTiming.gOverC*Exact`. `APPROACH_CAPACITY_VPH` (= `SATURATION_FLOW_VPH × G_OVER_C`, i.e. 810 on the default constants, `signal-delay.ts:53-54`) is the **screening-path** value only; `realLaneGeometry` is default-on, so a rule using 810 disagrees with the engine on any row where `throughLanes != 1`.

**Explicitly excluded, with reasons** (so they are never mistaken for coverage): coverage-warning checks — a tripped study is never persisted (`routes/tis.ts:424-436` returns 422 and refunds before `saveProject`, and `coverageWarning` is absent from `openapi.yaml` so zod would strip it); radius completeness, basemap spot-check and "was this merge correct" — the region inventory is a live analyzer fetch that is never saved, and `dedupCloseSignals`' `merged` array and `nameAbsorbedBeyond45m` are logged at WARN and explicitly not in the report (`tis.ts:1039-1057`); the turn ledger and conserved-assignment byte-identity contracts — live road graph and a bundled 5×-engine-run, neither acceptable per study; queue-vs-driveway-offset — `offset` appears nowhere in the schema.

## Coverage: `ran` / `not-run` / `UNVERIFIED`

Coverage is recorded **per clause, never per section**, and no section header is ever rendered as passed. Only two of the six sections are fully machine-checkable from a saved record, and presenting a section as checked is the failure `:65-69` names: a padded list "looks like coverage."

- **`ran`** — inputs present, clause evaluated (clean or fired).
- **`not-run`** — a declared input was absent (legacy payload, no agency document on file, field never persisted). Reported as absence of coverage, never as a finding.
- **`UNVERIFIED`** — inputs were present but the source could not be reached. This is the protocol's finding type and stays scarce.

## The judgment pass — phase two

One `claude-opus-5` call (adaptive thinking, `output_config: {effort: "high"}`, structured outputs, streamed via `.finalMessage()`), **no tools**, after the rules persist.

- **It may emit only `DISCLOSE`, `NOTE`, `UNVERIFIED`, `CONTESTED`.** `BLOCKER` and `DEFECT` come from rules only. A BLOCKER stops a study, and stopping power that can hallucinate is worse than none; a model finding that believes it is a blocker is emitted as `CONTESTED → PE`, which blocks completion identically under `:270-271` but routes to a human instead of asserting a fact.
- **The output schema has no numeric field for a traffic quantity and no mutation verb.** The model references values by their path in the pack. "Never supply a value from memory" becomes something the schema cannot represent.
- Every model finding carries `read_paths`; one that does not resolve against the pack is dropped before persisting, and the drop is logged and counted.
- **Evidence pack, capped.** `resultPayload` runs 126 KB (Palm Beach) to 900 KB (Allegheny) uncompressed, so the whole record is never sent. The pack is a declared field subset — exactly what the clauses read, plus the rule findings, plus the constants cited — capped (60 KB target) with the truncation rule declared in the manifest: per-row detail is kept for rows a finding references and summarized otherwise.
- **Caching.** `PROTOCOL_VERSION` text + clause catalogue + system prompt form a stable cached prefix (`cache_control: {type: "ephemeral"}`); the pack follows it, so phase-three questions re-read the protocol at cache-read rates.
- **First outbound model dependency in the repo.** Add `@anthropic-ai/sdk` to `artifacts/tis-api-server` only (its deps are Express/drizzle/pdfkit/stripe/resend/ioredis today), and document `ANTHROPIC_API_KEY` in `.env.example` with its failure mode: unset ⇒ runs end at `rules_ready`. A browser-side call is impossible anyway — CSP `connect-src 'self'` (`app.ts:57`).

## Questions channel — phase three

`POST /projects/:id/proofread/:runId/questions` stores a question and its answer; the panel polls. Two kinds, matching `:253-270`:

- **EXPLAIN** — "why is this a finding?" Answered from the pack and the finding's `read_paths`.
- **CONTEST** — must name a source; a contest with no `source_label` is rejected at the API boundary, because only a source moves a finding (`:256-258`). A valid contest does not close anything: it produces either a `WITHDRAWN` disposition (Datum withdraws on the named source) or a `CONTESTED_PE` escalation. Free prose is answered but can never close a finding.

That asymmetry is also what protects `:86-87` (a pass that receives Redline's reasoning is grading itself): questions are scoped to one finding and the pack, and no amount of prose changes a verdict.

Scope: one transcript per run, readable by the firm (consistent with every existing firm-scoped read), retained with the run, cascading on delete. The PE's questions and the engineer's are both visible — the protocol's disagreement procedure is a record, not a side channel.

## API

Absolute paths in `routes/proofread.ts`. Every handler copies the `projects.ts` shape literally: inline `if (!req.isAuthenticated())` → 401, `const user = req.user!`, `getOrCreateFirmForUser(...)`, then a data function taking `firmId` **first** and filtering on it. Firm scoping is enforced only by the `firmId` in the WHERE clause — there is no middleware — and a foreign id returns **404 "Project not found."**, not 403, per convention.

| Route | Notes |
|---|---|
| `GET /projects/:id/proofread` | latest run: `{ status, revision, protocolVersion, engineStamp, coverage, findings[], dispositions[], questions[] }`, audience-filtered. Opportunistic sweep. |
| `POST /projects/:id/proofread` | request a run (new revision). Own limiter. |
| `POST /projects/:id/proofread/:runId/findings/:findingId/dispositions` | record a disposition. `WITHDRAWN` requires `sourceLabel`; `ACCEPTED_RISK` and `CONTESTED_PE` ruling are PE-gated (phase four). |
| `POST /projects/:id/proofread/:runId/questions` | EXPLAIN / CONTEST (phase three). |

**Generate response change.** No generate route returns the project id: `tis.ts:469` responds `res.json(validated)` and `GenerateTisResponse` is a strip-unknown-keys `zod.object` (`lib/tis-api-zod/src/generated/api.ts:897`), so an id attached before the parse is dropped. Merge `projectId` **after** the parse, and add it to `lib/tis-api-spec/openapi.yaml` + re-run codegen (`clean: true` wipes both generated trees, so nothing under `generated/` may be hand-edited). Until then the client can only re-list `/projects`.

Contract shape: hand-written zod at `lib/tis-api-zod/src/proofread.ts`, re-exported from that package's index — the documented escape hatch while the finding shape moves. Promote to `openapi.yaml` + generated schemas once it stabilizes. `info.title` must stay exactly `Api`.

## Frontend

`proofread-panel.tsx`, mounted in `pages/project-detail.tsx` between `<ResultRenderer project={project} />` (`:217`) and the read-only footnote (`:219-222`), inheriting the container's `space-y-6` rhythm. Transport is a hand-written typed client `src/lib/proofread.ts` copying `src/lib/report-themes.ts` exactly (local types, one exported async function per operation, `credentials: "include"`). The app is not a react-query app in practice — 64 of ~68 API interactions are raw `fetch` in `useEffect` with a `cancelled` flag — so the panel follows that, with `clearInterval` cleanup and a poll interval no tighter than the 60 s used by `atlanta-live-status.tsx`, stopping on a terminal status.

Severities render through one `Record<Type, {label, icon, cls}>` mirroring `SEVERITY_CONFIG` (`components/tis-report-bits.tsx:34-39`), badges reusing `VerdictBadge` (`components/sight-distance-report.tsx:164-180`), each finding row shaped on `DistanceCard` (`:109-146`): border/rounded/padded, title and source left, severity badge right, `read_paths` and remedy as a small muted list. The panel renders **no control that edits the study** — the page already tells the engineer this is a read-only summary.

Copy uses the permitted phrasing: "internal consistency and traceability check."

## Spend and limits

- New limiters in `lib/security.ts` with their own `makeRateLimitStore("rl:proofread:")` prefix. Do **not** reuse `generateRateLimiter` — per-IP 10/hr, already shared by seven engine routes, so a re-run or a question would lock an engineer out of generating. Copy `whatIfRateLimiter` for a per-engineer key, including `keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? "")` (express-rate-limit v8 requires `ipKeyGenerator` for IPv6 bucketing).
- Model spend counters as `integer().notNull().default(0)` columns on `firmsTable` beside `studiesUsedThisPeriod`, charged with the atomic conditional-UPDATE idiom from `reserveStudySlot` (`lib/firms.ts:278-289`). Reset alongside `studiesUsedThisPeriod` at `routes/stripe-webhook.ts:328`; trial firms have `NULL` period bounds and never receive that webhook, so they need a stored `proofreadPeriodStart` of their own. Metering belongs in `lib/firms.ts`, not `lib/billing.ts` (Stripe surface only, no counters).
- A limiter guarding paid spend cannot simply fail open like the compute limiters or closed like the auth ones. Decision: the limiter fails open, and the **firm counter** — a Postgres row, not Redis — is the hard cap.
- There is no app-level error middleware, so every handler try/catches its own I/O, and the model path is wrapped so a failure marks the run `failed` rather than rejecting into Express's default HTML 500.

## Completion gate and the PE — phase four

The gate is the protocol's: **no open `BLOCKER` and no open `CONTESTED`**, evaluated against the latest run whose `engine_stamp` matches the current engine. Surfaced as advice — `sealable: true|false` with the open items — never as an enforcement that mutates a study.

Who the PE is cannot be read off the schema: `firm_members.role` is `varchar(16)` holding only `owner`/`admin`/`member`, typed as plain `string`, gated by the ad-hoc `requireRole` helper (`routes/firms.ts:79`), and `routes/projects.ts` applies no role check at all; staff access is an `ADMIN_EMAILS` allowlist, not a DB flag. So phase four **depends on protocol amendment 8** and then adds a `pe` role value plus `requireRole` gates on the two PE-only actions. No licensure claim is invented, and the client learns role from `GET /tis-api/firms/me` — `useAuth()` returns identity only. Three pages already re-fetch `/firms/me` independently; a fourth consumer justifies the app's first shared `use-firm.ts` hook, called out here as a deliberate small refactor. Note `getActiveFirmForUser` picks with `.limit(1)` and no ordering, so a user in two firms has a nondeterministic active firm — role-gating inherits that ambiguity.

## Testing and CI

There is **no test runner** in this repo. The only convention CI honours is a standalone `.mjs` under `artifacts/<pkg>/scripts/` that exits nonzero on failure, registered as a `check:*` key — `.github/workflows/checks.yml` discovers them with `jq` over each `package.json`, so no workflow edit is needed. Register `check:proofread` → `scripts/verify-proofread.mjs`, in the pure-function style (`verify-screening-clamp.mjs` runs in ~0.14 s with no env), never the render-bundling style.

Fixtures in `artifacts/tis-api-server/scripts/fixtures/proofread/`: trimmed current-engine records plus hand-written minimal row arrays. `artifacts/atlanta-tis/scripts/fixtures/scenario-network-utdf.json` is the only committed TisReport on the current leg-volume engine — note it is a **bare** TisReport (`request` at top level, not `report.request`); the six committed preview fixtures predate the leg-volume engine (zero `legEstimateExact`). The five named regenerated samples exist in-repo only as PDFs — their JSON lives in `private/sample-payloads/`, and `.gitignore:66` excludes `/private/` — so the Wake and Bexar regression rows must be committed as trimmed fixtures or CI cannot see them.

Regression targets:
1. **Wake, pre-#230** — five intersection rows above the ceiling (2.84/2.90, 2.94/2.98, 3.93/3.94, 2.61, 3.27). Note the commit message's "ten rows" is five rows each printing two values; a fixture expecting ten rows will not match.
2. **Wake, as shipped today** — must FAIL under the intersection-level clause alone (max 1.87) and pass once the approach and design-year clauses exist. The sharpest available target.
3. **`existingVc: 8.68` with `currentVc` absent** — the silent-`NaN` normalization case.
4. **LOS letter without matching delay** — the class `verify-intersection-delay-fields.mjs` guards.

Also in scope: register the two orphan scripts (`check:existing-use-credit`, `check:intersection-delay-fields`) so they actually run, and update `verify-vc-plausibility-guard.mjs:142-155`, whose three source-text regexes over `tis.ts` break when the call moves into a clause registry. **CI does not typecheck** (`checks.yml` runs only `check:*`; Netlify runs `vite build`): flagged, not fixed here — a `check:typecheck` wrapper is a one-line addition if wanted.

## Phases

1. **Rules only.** Protocol amendments, schema + migrations, runner with claim/lease/reaper, the clause set above, coverage manifest, `GET`/`POST` run routes, panel, dispositions, re-run, `check:proofread`, engine stamp, `projectId` on the generate response. No API key, no model, no cost.
2. **Judgment pass.** Evidence pack + caps, the model call, spend counters, `.env.example`.
3. **Questions.** EXPLAIN/CONTEST, transcript table, polling.
4. **PE and the gate.** `pe` role, PE-only actions, `sealable` advice, `use-firm.ts`.

## Known limitations

- Four of six protocol sections are only partly checkable from a saved record; the UI must never imply otherwise.
- A study that trips the coverage warning has no record at all, so nothing about geocode coverage is checkable per study.
- Findings about "what the deliverable says" are checked against payload strings, not the delivered PDF; five renderers drop `findings[]`/`methodology[]` entirely.
- Historical studies get partial coverage by construction, declared per clause.
- The opportunistic sweep means a queued run on an idle instance waits for the next request rather than a scheduler tick.
