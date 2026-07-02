# Trip Distribution Methods + Gravity Model in Generated PDFs

**Date:** 2026-07-02
**Status:** Approved design (pending user review of this spec)
**Repo:** `tis-study` — `artifacts/tis-api-server` (engine) + `artifacts/atlanta-tis` (frontend)

## Problem

Every generated TIS already computes a trip distribution (NCHRP‑716 gamma‑friction
gravity via `four-step-model.ts`; a Caltran mass/distance gravity for Florida via
`caltran-gravity.ts`). But the **quantitative distribution worksheet + directional
table only renders for Florida** (`renderTisFlorida` §6.1/§6.2, driven by
`result.flGravity`). Every other regional renderer (GA, CA, IL, TX, NY, generic
US) documents distribution as prose "engineering judgment," with only the generic
Four‑Step methodology appendix showing a distribution table.

We want to (1) surface the trip‑distribution / gravity model in **all** the
generated (non‑UK) reports, and (2) let the user **select the distribution method**
among three: **Gravity**, **Analogy**, and **Surrogate (market‑area)**. The
selected method must **drive the actual per‑intersection loading** (and therefore
the LOS/queue outputs), not just the write‑up.

## Decisions (locked with the user)

| Decision | Choice |
| --- | --- |
| The three methods | **Gravity / Analogy / Surrogate** (TIS practitioner trio) |
| Analogy "comparable" source | **Curated reference library now, stored‑studies DB later** — via a `ComparableSource` interface |
| Surrogate data source | **Blended**: population + employment (Census block‑group TAZ) **and** road through‑volumes |
| Effect of selection | **Drives the real assignment** → can change LOS/queue results |
| Default method | **Gravity** — existing reports stay byte‑identical unless changed |
| UK / London | **Out of scope** — US‑only selector; London keeps its native TRICS + Census method‑of‑travel distribution |
| Sequencing | **Phased, 3 PRs** (gravity‑everywhere → analogy → surrogate) |

## Non‑goals (YAGNI)

- No new O‑D survey ingestion, Fratar/Furness, or intervening‑opportunities model.
- No stored‑past‑studies database in this work (only the interface seam for it).
- No change to UK/London distribution methodology.
- No manual directional‑split entry UI (analogy is auto‑matched).

## Architecture

A single **unified distribution layer** replaces the FL‑only special case. One
function computes the split for any method and returns one region‑agnostic
summary; one shared PDF renderer draws it in every US regional report.

```
                          req.distributionMethod ?? "gravity"
                                     │
   tis.ts  ── builds DistributionContext (candidates+bearings, four-step result,
                                     │      areaType, market-area data)
                                     ▼
        trip-distribution.ts  computeTripDistribution(method, ctx)
             ├─ gravity   → wraps four-step-model.ts (Caltran for FL)
             ├─ analogy   → analogy-reference.ts  (ComparableSource → pattern)
             └─ surrogate → blend(pop+emp TAZ, road volumes)
                                     │
                                     ▼
                     TripDistributionSummary  (weights[], zones[], byDirection, sectors)
                                     │
              ┌──────────────────────┴───────────────────────┐
              ▼                                               ▼
   result.tripDistribution                     weights[] → per-intersection loading
   (rendered by shared section)                 (drives assignment → LOS/queues)
```

### New/changed units

1. **`lib/trip-distribution.ts`** (new) — the distribution layer.
   - `type DistributionMethod = "gravity" | "analogy" | "surrogate"`
   - `type TripDistributionSummary` — generalizes today's `FlGravitySummary`:
     - `method: DistributionMethod`, `methodLabel: string`, `basis: string`
     - `weights: number[]` (Σ≈1, one per candidate — **drives loading**)
     - `zones: DistZone[]` — `{ id, name, distanceMi, bearingDeg, cardinal, mass, term, weight, sharePct }`
     - `byDirection: Record<CardinalDir, number>` (8 wedges, Σ=100)
     - `sectors: Record<string, number>` (4 quadrant pairs, Σ=100)
     - `provenance?: { source: string; matched?: string; blendWeights?: {...} }`
   - `computeTripDistribution(method, ctx): TripDistributionSummary`
   - Pure and deterministic; strategy functions unit‑testable in isolation.
   - **Depends on:** `four-step-model.ts`, `caltran-gravity.ts`, `analogy-reference.ts`,
     the market‑area lookup (`national-block-group-taz.ts`), `cardinal-directions.ts`.

2. **`lib/analogy-reference.ts`** (new) — the comparable‑pattern matcher.
   - `interface ComparableSource { find(landUseFamily, areaType): ComparablePattern | null }`
   - `REFERENCE_LIBRARY: ComparableSource` — curated table
     `landUseFamily → areaType → directional pattern`, each row with a `basis`
     provenance string. Patterns are **publicly‑derivable / typical screening
     patterns, not ITE copyrighted tables** (cite‑not‑copy).
   - `landUseFamily(landUseCode)` reuses the existing land‑use catalog to bucket
     codes into families (retail, office, residential, industrial, medical, hotel,
     restaurant, …).
   - `areaType(densityIndex)` → CBD / urban / suburban / rural, using the density
     index the engine already computes.
   - Structured so a future DB‑backed `ComparableSource` queries first and falls
     back to the library — the "library now, DB later" seam.

3. **Market‑area lookup** — wire `lib/national-block-group-taz.ts` (242k Census
   block groups w/ Centers of Population + LODES employment; currently unused by
   the engine) into a small helper that returns pop+emp mass for block groups
   within the study radius. **US‑only**; non‑US → surrogate falls back to
   road‑volume‑only.

4. **`lib/tis.ts`** (changed) — integration.
   - Add `distributionMethod?: DistributionMethod` to `TisRequest` (default `"gravity"`).
   - Build `DistributionContext`, call `computeTripDistribution`, use `.weights` for
     per‑intersection loading (the current FL directional‑multiplier path
     generalizes to all regions), set `result.tripDistribution`.
   - Fold the FL Caltran branch into the gravity strategy; the internal `flGravity`
     field is **replaced** by `tripDistribution` (it was never in the API spec, so
     this is an internal‑only rename with FL fed through the same summary).

5. **`lib/pdf-export-distribution.ts`** (new) — shared renderer
   `renderTripDistributionSection(doc, result, { sectionLabel })`:
   method + basis narrative, directional table (4 sector pairs), per‑zone
   worksheet (top‑N: name, direction, distance, mass/term/weight, share%), and an
   assignment note. Kept in its own file to avoid growing the ~8.7k‑line
   `pdf-export.ts`.
   - Called from each **US** regional renderer at its native section number
     (FL §6.1/§6.2 refactored onto it; GA §1.4; TX §4.2; CA/IL/NY/generic gain a
     section they lack today). The generic Four‑Step appendix stays.

6. **API + codegen** — add `distributionMethod` (enum) to
   `lib/tis-api-spec/openapi.yaml` `TisRequest`; add optional `tripDistribution` to
   `TisReport` so it survives the JSON response (the "add fields to api‑spec or zod
   strips them" gotcha). Run `cd lib/tis-api-spec && npm run codegen` to regenerate
   zod + react‑client.

7. **Frontend** — `artifacts/atlanta-tis/src/pages/tis.tsx`: a distribution‑method
   dropdown (default **Gravity**), passed to the generate call.

## Data flow (method selection → LOS)

1. Request carries `distributionMethod` (default gravity).
2. Engine builds candidates (already nearest‑first, with distance + bearing +
   through‑volume) and the four‑step result.
3. `computeTripDistribution` returns `weights[]` + directional summary for the
   chosen method.
4. `weights[]` feed the existing distance‑decay + directional re‑orientation
   loading path → per‑intersection added trips → capacity/LOS/queue analysis.
5. `result.tripDistribution` is rendered by the shared section in the regional PDF.

## The three strategies

- **Gravity** — no math change; wraps `distributeAndAssign` (NCHRP‑716) for most
  regions and `caltranGravityShares` for FL. Re‑homed into the shared summary.
- **Analogy** — `ComparableSource.find(family, areaType)` → a directional pattern
  (`byDirection`). Each direction's share is spread across the candidates that lie
  in that direction by distance‑decay → `weights[]`. Provenance names the matched
  reference row.
- **Surrogate** — for each zone/candidate: `attraction = w_pop·(pop+emp mass) +
  w_vol·(road through‑volume)`, distance‑decayed, normalized → `weights[]`.
  Default blend `w_pop = w_vol = 0.5` (tunable constant). US‑only pop/emp; non‑US
  degrades to road‑volume‑only with a stated basis.

## Error handling & edge cases

- **Unknown/empty market‑area data** (non‑US or no BGs in radius) → surrogate uses
  road‑volume‑only, `basis` states the fallback. Never throws.
- **No analogy match** for a rare land use → fall back to the closest family or to
  gravity, with `basis` noting the fallback. Never throws.
- **Empty candidate set** (already handled upstream by the coverage warning / 422
  path) → distribution is skipped; no section rendered.
- **Weights normalization** — guard against all‑zero mass (Σ=0) → uniform weights,
  basis noted.
- **Determinism** — no `Date.now()`/`Math.random()`; stable sort by distance.

## Testing

Engine can't run locally (needs the analyzer at `localhost:8080`), so verification
mirrors the existing `verify-caltran-gravity.mjs` pattern:

- **Pure unit tests / check scripts** for: each strategy's `weights` (sum≈1,
  non‑negative, sane direction mapping), the analogy matcher (family + areaType →
  expected row; fallbacks), the surrogate blend (pop/emp+volume, zero‑mass
  fallback), and `TripDistributionSummary` invariants (byDirection Σ=100, sectors
  Σ=100).
- **Typecheck** the `tis-api-server` package (+ regenerated zod/react‑client).
- **PDF smoke**: render a report per US region with each method and confirm the
  section appears with a populated table (no throws, no blank cascade).
- **Regression**: with `distributionMethod` unset, gravity output + loading are
  unchanged vs `origin/main` (byte‑identical report for a fixed fixture).

## Build sequence (three PRs, each off `origin/main` per the git workflow)

1. **PR1 — Unified layer + gravity everywhere.** `trip-distribution.ts` (gravity
   strategy only) + `TripDistributionSummary`; refactor FL §6.1/§6.2 onto the
   shared renderer; add `renderTripDistributionSection` to all US renderers; add
   the `distributionMethod` request option + frontend selector (analogy/surrogate
   present but not yet implemented — selecting them errors or falls back to gravity
   with a note). *Delivers "gravity model in all the unique PDFs."*
2. **PR2 — Analogy.** `analogy-reference.ts` + `ComparableSource` + matcher, wired
   to drive assignment.
3. **PR3 — Surrogate.** Market‑area TAZ wiring + road‑volume blend, wired to drive
   assignment.

## Open risks

- **Analogy provenance/licensing** — patterns must be defensibly non‑ITE‑copyright;
  state each row's basis. Screening‑grade caption on the worksheet.
- **Surrogate perf** — block‑group lookup must be radius‑scoped and indexed so a
  dense metro doesn't scan all 242k BGs.
- **LOS shifts** — because the method drives loading, analogy/surrogate can move
  LOS vs gravity. Default gravity keeps existing behavior; changes are opt‑in.

## Related memory / references

- `project_tis_fl_caltran_renderer` — the FL §6.1/§6.2 gravity pattern this generalizes.
- `project_national_taz` — the Census BG TAZ subsystem the surrogate method wires in.
- `project_tis_ite_trb_licensing` — cite‑not‑copy constraint for analogy patterns.
- `project_tis_regional_renderer_architecture` — the renderer dispatch this extends.
- `feedback_radius_all_intersections` — distribution runs over all candidates.
