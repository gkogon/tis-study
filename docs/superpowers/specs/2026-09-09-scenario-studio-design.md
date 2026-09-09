# Scenario studio — interactive, engine-exact what-ifs on the live study map

**Date:** 2026-09-09 · **Status:** approved (Gerald, "proceed with that 2 day workload") · **Owner:** Claude session

## 1. Goal

Let an engineer change a study on the live map — each signal's timing, the project's trips, the driveways — and see the result recompute **with the engine's own code**, instantly for what the browser can solve alone, and through a real engine run for what needs the road network. Also: Atlanta signals get their real cross-street names everywhere.

Non-goals: new capacity models; Monte-Carlo in what-ifs; editing the distribution model itself.

## 2. Findings that shape the design (from the code, cited in the research bundle)

- **Names.** `api-server/src/lib/atlanta-signal-naming.ts:55` rejects every road because it requires 3-element way tuples; the roads file has been 6-element since #126 (2026-08-21). The regional resolver uses `way.length < 3` (`regional-signal-naming.ts:50`). Simulated fix names 7,946 / 7,958 Atlanta signals, byte-identical to the regional algorithm. Every consumer (engine, app, PDF, `/atlanta/intersections/:id`) reads through `getIntersectionSummaries()`, so the fix lights up everywhere with no id/zone/volume change.
- **Purity.** `signal-delay.ts`, `webster-timing.ts`, `movement-assignment.ts`, `trip-loading.ts`, `land-uses.ts`, `regional-growth-rates.ts`, `utdf-import.ts`, `volume-plausibility.ts` are dependency-free. Inside `tis.ts`, `buildAffectedRow`, `resolveTimingForRow`, `throughLanesByApproach`, `laneGroupsForApproach`, `approachVolumeShares` (+ `hash32`/`mulberry32`), `verdictForHorizon`/`recommendMitigation`, `periodRawTrips`/`periodDirectionalIn`, `WEATHER_FACTOR`, `PERIOD_VOLUME_FACTOR`, `round1/2/3` are pure but unexported.
- **What the report lacks for exact re-solve.** Unrounded design-hour volume (`sig.totalVolume`), the per-row load weight (or turn ledgers), which UTDF record attached, unrounded g/C, `mainThroughLanes/minorThroughLanes` (stripped by the schema), `designYear`, per-period volume factor and inbound fraction, exact external trips, region strings for text builders, unrounded calibration multiplier.
- **Trip scaling is linear** in external trips given fixed weights/ledgers/octants; only `byDirection` drifts (BPR feedback) with PM trip magnitude. Timing is resolved from no-build volumes only.
- **Timing-only overrides don't exist.** `attachUtdfData` drops any record without positive volumes (`tis.ts:1245-1249`); an attached record also replaces the AADT baseline at that signal.
- **/generate** charges a slot, saves a project, logs a funnel event, shares a 10/hr/IP limiter with six study endpoints. Not usable for iteration.

## 3. Architecture

### 3.1 `lib/tis-engine-core` (new workspace package, pure)
Moves the pure modules above out of `tis-api-server` verbatim (`exports: {".": "./src/index.ts"}` like the other libs) and extracts the pure `tis.ts` pieces into `row-math.ts` (`buildAffectedRow` + helpers + constants), `mitigation.ts`, `trips.ts` (`periodRawTrips`, credits, `periodDirectionalIn`). `tis.ts` imports from the package; behaviour byte-identical — `check:conserved-assignment`'s legacy baseline and every other check stay green without re-pinning. `movementSource:'path'` rows keep `pathMovementLoadsExact` in core.

### 3.2 Report additions (OpenAPI + codegen), all additive
On `TisAffectedIntersection`: `designHourVolumeVph` (unrounded), `loadWeight` (exact effective weight), `pathTurns` / `pathTurnsIn` (share ledgers, when conserved), `movementsExact`, `mainThroughLanes`, `minorThroughLanes`, `mainThroughLanesMeasured`, `utdfRecordIndex`, `signalTiming.{gOverCnsExact,gOverCewExact,gOverCnsLeftExact,gOverCewLeftExact}`, `calibration.delayMultiplierExact`. On `TisPeriodReport`: `periodVolumeFactor`, `inFraction`, `externalTripsExact`, `existingUseCreditExact`. Top level: `designYear`, `designYearHorizonYears`, `regionCode`, `jurisdiction{dotName,planningOfficeName}`, `autoModeShareSource`, `weatherFactorExact`. The legacy baseline fixture is re-pinned once with a key-level diff proving only additions.

### 3.3 Request addition: `signalTimingOverrides[]`
`{ latitude, longitude, name?, cycleLenSec, phaseByMovement, splitSByPhase }`, snapped by the same 0.35-mi / name rules as UTDF records, consumed **only** as the first provider in `resolveTimingForRow` (before Synchro, before Webster). Volumes untouched. Rows stamp `signalTiming.source: "override"`. Always surface a match summary on the response (`timingOverrideSummary`).

### 3.4 `POST /tis-api/whatif`
Body = `TisRequest`. Signed-in only. Keeps validation, coverage guard, driveway validation, `TisReport` shape. Skips slot reservation, `saveProject`, funnel events; forces `runSensitivity:false`; read-only firm gate (`firmMayRunUncharged`: unlimited ∨ (not delinquent ∧ period quota left) ∨ credits) → 402; own per-user limiter `whatIfRateLimiter` 60/hr (`req.user.id`, `ipKeyGenerator` fallback, Redis prefix `rl:whatif:`, fail-open, admin/dev skip); one in flight per user → 409. Memoize `fetchLocalRoads` per `(region,lat,lon,radius)` with a 10-min TTL.

### 3.5 Browser: `scenario-solve.ts`
`solveScenario(report, state): TisReport` reconstructs each row's candidate (`sig` from `designHourVolumeVph`, lanes, name, coords; `utdf` from `request.utdfIntersections[utdfRecordIndex]`; calibration exact) and `params` (period factors, growth multipliers from `growthAppliedPct`/`growthYears`/horizon, weather exact, `externalTripsExact × tripScale`, `inFraction`, octants = `tripDistribution.byDirection`, ledgers), applies overrides (per-signal timing → provider; trip scale; growth; weather; pass-by/IC recomputed through the real credit chain), and calls the **real** `buildAffectedRow` for AM and PM. Recounts `intersectionsWithLosDrop`, `intersectionsAtLosEf`, `worstDelayDeltaSec`, `mitigationSummary` (real `buildSummaryMitigations` with region strings). `byDirection` and ledgers are held fixed and the UI discloses "distribution held at base" when trips change.

**Exactness gate:** `scripts/check-scenario-solve.mjs` loads a real report fixture and asserts `solveScenario(report, EMPTY) ` reproduces every printed row field byte-for-byte, then checks monotonic sanity for edits (longer cycle ⇒ ≥ delay at flat splits; more trips ⇒ ≥ v/c) and that a server what-if with the same overrides matches the client solve (parity fixture produced by the engine harness).

### 3.6 UI
- `tis-report-bits.tsx`: `LOS_COLORS`, `LosBadge`, `SEVERITY_CONFIG`, `ApproachDetailTable`, `DELAY_CONFIDENCE_FRAC` exported; `tis.tsx` imports them.
- `StudyMapAlive` gains `scenarioReport`, `selectedSignalId`, `onSelectSignal`; keeps the sim when the id set is unchanged and updates flow rates in place (normalised to the **base** max); selection ring + "changed vs base" dashed ring; canvas `onClick` via extracted `hitTest`; hover resolves the row at render time.
- `ScenarioStudio` rail inside the map card at `lg:` (three columns: stage/stats · canvas · rail); below `lg` it stacks. Tabs: **Site** (size, pass-by %, internal capture %, growth %/yr, weather; "distribution held at base" note), **Signal** (selected signal: name, base → scenario LOS/delay, cycle 30–300 step 5, NS/EW split, protected-left toggles, ped minimum, "Webster optimum" reset, provenance line, the scenario's `ApproachDetailTable`), **Access** (DrivewayEditor on a copy of `request.driveways` + "Re-run with the engine" → `/whatif`; hidden when no server). An "Apply to report" switch feeds the derived report to `ScenarioStripCard`, `ImpactSummaryCard`, `PeriodTabsCard`, `MapCard`, `IntersectionTable`, `MitigationsCard`; cover/header/trip-gen/distribution/methodology stay on the base. A "Send to engine" button posts `{...request, signalTimingOverrides, size, passByPct, internalCapturePct, growthRatePct, weather, driveways}` to `/whatif` and swaps in the server's report (with a diff line vs the client solve — should read 0.0). Print/PDF always use the base report while a scenario is applied (watermark on screen).
- Gallery: adds the studio section (client-side only; re-run hidden), `TooltipProvider`, CSS rebuilt.

## 4. Data flow
report (server) → `scenarioReport = solveScenario(report, state)` (memo, per edit) → map + cards. "Send to engine" → `/whatif` → new base report (state reset, overrides preserved as the new base's request). Driveway edits only via `/whatif`.

## 5. Error handling
402/409/429 from `/whatif` shown inline in the rail (QuotaBanner for 402). Override records that fail to snap are listed from `timingOverrideSummary`. Client solve never throws on a row: a row it cannot reconstruct (missing new fields on an old saved report) is passed through unchanged and flagged "base only".

## 6. Testing
- `lib/tis-engine-core`: existing server checks green unchanged (behaviour move), plus `check:engine-core-exports`.
- `check:conserved-assignment` baseline re-pin with key-level additive diff (script prints added keys only).
- `check:signal-timing-overrides` (engine harness): override changes that row's timing and nothing else; volumes untouched; summary lists snapped/unsnapped.
- `check:whatif-gate`, `check:whatif-limiter` (pure helper + throwaway express).
- `check:atlanta-naming`: ≥ 99 % of Atlanta summaries are "A & B"/"Near X", 0 "of CBD".
- `check:scenario-solve` (frontend): exactness gate + parity + monotonic sanity.
- Manual: `/tis` run → edit → send to engine → diff 0; gallery.

## 7. Delivery (PRs, in merge order)
1. **N** `fix(analyzer): Atlanta cross-street names` (+ namedPct refresh).
2. **E1** `refactor(engine): lib/tis-engine-core` (pure move, no behaviour change).
3. **E2** `feat(api): report inputs for exact re-solve, signalTimingOverrides, POST /whatif`.
4. **U** `feat(tis): scenario studio` (solver + rail + map changes + gallery).
