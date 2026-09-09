# Plan — Scenario studio (spec: docs/superpowers/specs/2026-09-09-scenario-studio-design.md)

Four PRs, built as parallel tracks where independent. Every track: branch from `origin/main`, `pnpm install --frozen-lockfile --prefer-offline`, `pnpm run typecheck:libs`, keep every existing `check:*` green, commit with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer, open a PR ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`, never merge.

## Track N — Atlanta names (small)
1. `api-server/src/lib/atlanta-signal-naming.ts:55` `!== 3` → `< 3`; fix the two stale comments (4-7, 52-54).
2. `api-server/scripts/verify-atlanta-naming.mjs` + `check:atlanta-naming`: load summaries via the module (ts loader convention used by other scripts), assert ≥99 % named, 0 "of CBD"/"Five Points", and print 5 samples incl. Peachtree & 14th.
3. Refresh `atlanta-tis/src/data/metro-coverage.ts` Atlanta `namedPct` using `scripts/src/compute-metro-stats.ts` (or set 99.8 with the script's number).
4. Note in the PR: cold start +~10 s on first Atlanta request; name-dedup now merges same-name signals within 150 m (intended; `check:name-dedup`).

## Track E1 — `lib/tis-engine-core`
1. Package `lib/tis-engine-core` (`package.json` mirroring `lib/tis-api-zod`: type module, exports `./src/index.ts`, workspace deps none; add to root `tsconfig` references if the libs are built with `tsc --build`).
2. Move verbatim: `signal-delay.ts`, `webster-timing.ts`, `movement-assignment.ts`, `trip-loading.ts`, `land-uses.ts`, `regional-growth-rates.ts`, `utdf-import.ts`, `volume-plausibility.ts`. Leave thin re-export shims at the old paths so imports keep working, then repoint `tis.ts`/routes to the package (`@workspace/tis-engine-core`).
3. Extract from `tis.ts` into core `row-math.ts`: `WEATHER_FACTOR`, `PERIOD_VOLUME_FACTOR`, `hash32`, `mulberry32`, `approachVolumeShares`, `approachAddedTripShares`, `bearingDeg`, `utdfApproachTotals`, `utdfMeasuredTotals`, `utdfGoverningStorage`, `laneGroupsForApproach`, `throughLanesByApproach`, `resolveTimingForRow`, `buildAffectedRow`, `oppositeDir`, `round1/2/3/clamp`; `mitigation.ts`: `SCREENING_DELAY_DELTA_*`, `verdictForHorizon`, `recommendMitigation`; `trips.ts`: `periodRawTrips`, `periodDirectionalIn`, credit chain as a function `externalTripsForPeriod(...)`. `buildAffectedRow` must take only plain data (candidate, params, calibration entry, ledgers) — no logger; move any `logger.warn` to the caller.
4. `turbo-lane.ts` repoints its imports to core's `signal-delay`.
5. Prove no behaviour change: all `check:*` in tis-api-server green with the baseline fixture untouched. Add `check:engine-core-exports` (imports the package under plain node and asserts the export list).

## Track E2 — report inputs, overrides, /whatif (after E1)
1. `openapi.yaml`: fields from spec §3.2; `signalTimingOverrides[]` (§3.3) with `maxItems: 60`; `timingOverrideSummary`; path `/whatif` (operationId `whatIfTis`). Run `pnpm --filter @workspace/tis-api-spec run codegen`; commit generated output.
2. Engine: emit every new field (unrounded values) in `buildAffectedRow` / period loop / report assembly; attach overrides (`attachTimingOverrides`, same snap rules, no volume effect) and consume them as the first provider in `resolveTimingForRow`; stamp `source: "override"`.
3. Route `/whatif` per spec §3.4 in `routes/tis.ts`; `whatIfRateLimiter` in `security.ts`; `firmMayRunUncharged` in `firms.ts`; `fetchLocalRoads` memo (10 min TTL, keyed by region/lat/lon/radius).
4. Re-pin `check:conserved-assignment` legacy baseline with `--write-legacy-baseline`, and add to that script a key-level diff mode that prints keys added/removed — the PR body must show only additions.
5. Checks: `check:signal-timing-overrides`, `check:whatif-gate`, `check:whatif-limiter`; extend `verify-signal-timing-engine.mjs` to assert the new exact fields survive zod (strip trap).

## Track U — studio (after E1; finalise on E2)
1. `atlanta-tis`: add `@workspace/tis-engine-core` to dependencies. `src/lib/scenario-solve.ts` per spec §3.5 with `ScenarioState`, `EMPTY_SCENARIO`, `solveScenario`, `toWhatIfRequest(report, state)`.
2. `scripts/check-scenario-solve.mjs` (`check:scenario-solve`): exactness gate on a real report fixture produced by the engine harness on the E2 branch (fixture committed under `atlanta-tis/scripts/fixtures/`), parity against a server what-if with overrides, monotonic sanity.
3. `src/components/tis-report-bits.tsx` extraction; `tis.tsx` imports.
4. `StudyMapAlive` changes (spec §3.6); `Flow.signalId`.
5. `src/components/scenario-studio.tsx` (Tabs Site/Signal/Access, Sliders, Switch, LosBadge, ApproachDetailTable); `tis.tsx` wiring incl. `useWhatIfTis`, "Apply to report", print guard, error branches (402/409/429).
6. Gallery: new section, `TooltipProvider`, rebuild bundle + CSS, republish (done by the session, not the agent).

## Review
Each PR gets an adversarial review pass (correctness, exactness, security for /whatif) before merge. Merge order N → E1 → E2 → U.
