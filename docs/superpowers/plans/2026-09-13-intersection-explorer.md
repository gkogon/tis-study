# Plan — Intersection explorer (spec: docs/superpowers/specs/2026-09-13-intersection-explorer-design.md)

Branch from `origin/main` (#215 merged). Every PR: typecheck 0 in atlanta-tis / tis-api-server / api-server, `pnpm -C artifacts/atlanta-tis build`, all `check:*` green, commit trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`, PR body What / How / Test plan ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Never merge.

## D — live distribution (`feat/distribution-alive`)
1. `src/components/trip-distribution-alive.tsx`: SVG rose per spec 3.1; props `{ report, onHoverOctant? }`.
2. `trip-distribution-card.tsx`: render the rose above the existing octant bars/zone table (keep the table).
3. `study-map-alive.tsx`: `highlightOctant?: string | null` prop; dim rows/flows whose site→row bearing is outside the octant's 45° sector (use the octant order NNE…NNW clockwise from north, as `trip-distribution-card.tsx` does).
4. `tis.tsx`: wire `onHoverOctant` → `highlightOctant`.
5. `scripts/check-distribution-alive.mjs` (`check:distribution-alive`): a pure `roseGeometry(byDirection, zones)` helper in `src/lib/distribution-rose.ts` — shares sum, wedge angles, zone radii monotone.

## X — explorer: Analysis + Lanes (`feat/intersection-explorer`, after D)
1. `src/lib/intersection-geometry.ts` (pure): from a row → per-approach lanes, left-bay presence, storage, queue ft, base/scenario values; `check:intersection-geometry` covers a row with laneGroups and one without.
2. `src/components/intersection-plan.tsx` (SVG plan view) and `src/components/intersection-explorer.tsx` (panel + tabs Analysis / Lanes / Simulate placeholder).
3. `tis-report-bits.tsx`: export a `MovementsGrid`; `IntersectionTable` gains `onSelect?(signalId)`.
4. `tis.tsx`: explorer under the map card, bound to `scenario.selectedSignalId`; table row click selects; scenario-aware rows.

## S — simulation (`feat/intersection-sim`, after X)
1. `src/lib/intersection-sim.ts` per spec 3.3, reusing constants from `study-alive-sim.ts` (extract shared car-following into `src/lib/car-following.ts` if cleaner; keep the opener byte-identical — `check:study-alive-sim` must still pass).
2. `scripts/check-intersection-sim.mjs` (`check:intersection-sim`) per spec §4.
3. `src/components/intersection-sim-view.tsx`; explorer's Simulate tab.

## P — placements (`feat/explorer-placements`, after S)
1. `demo.tsx` `ResultView`: live map (report phase) + explorer + live distribution above the tables.
2. Gallery: sections for the rose and the explorer (base fixture); rebuild; do not publish.

## Review
Three-lens review (correctness/exactness, honesty of what is shown vs what the report carries, regressions/UI state) per PR before merge; merge order D → X → S → P.
