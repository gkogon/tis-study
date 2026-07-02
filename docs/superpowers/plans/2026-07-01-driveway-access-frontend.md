# Driveway Access Modeling — Phase 2 (Auto-detect + Map UX) Implementation Plan

> Builds on Phase 1 (backend routing, PR #62). Design in `docs/superpowers/specs/2026-07-01-driveway-access-modeling-design.md` §B (auto-detect) and §E (frontend). Branch: `feat/tis-driveway-frontend` (off `feat/tis-driveway-access`).

**Goal:** Let the user auto-detect candidate driveways on the fronting streets near a site, then select / reposition / edit each driveway's access type on an interactive map, and submit them with the TIS request.

**Constraints (carried from Phase 1):** opt-in (no driveways ⇒ unchanged); driveway cap ≤ 12; `round4` coords; presets `full`/`riro`/`three_quarter`/`entrance_only`/`exit_only` + `custom`; schema-is-source-of-truth (openapi → codegen). Backend logic node-testable; frontend verified via `tsc` + frontend build + preview screenshots.

## Tasks

### Task 1 — `findDrivewayCandidates` (pure, TDD)
- **File:** `artifacts/tis-api-server/src/lib/driveways.ts` (+ `scripts/verify-driveways.mjs`).
- Reuse `buildGraph` + `nearestLinkPoint` (Phase 1, exported from `network-assignment.ts`).
- Signature: `findDrivewayCandidates(segments: RoadSegment[], site: {lat,lon}, opts?: {maxCandidates?: number; maxDistMi?: number; minSepMi?: number}): Driveway[]`.
- Algorithm: snap the site to the nearest point on every segment within `maxDistMi` (default 0.12), sort by distance, greedily accept a candidate only if it's ≥ `minSepMi` (default 0.04) from every already-accepted candidate (so we don't return several points on one street), cap at `maxCandidates` (default 4). Each candidate: `{ id: "dw-<i>", latitude: round4(pt.lat), longitude: round4(pt.lon), label: "Driveway <A/B/C…>", accessType: "full", movements: all-true }`.
- Tests: empty segments ⇒ []; a single street ⇒ 1 candidate at the nearest point; two roads on different sides ⇒ 2 candidates; many colinear segments ⇒ deduped to 1 by `minSep`; cap respected.

### Task 2 — `/demo/driveway-candidates` route
- **File:** `artifacts/tis-api-server/src/routes/demo.ts` (mirror the `/demo/geocode` pattern; add a rate limiter or reuse `geocodeRateLimiter`).
- Body `{ latitude, longitude, radiusMi? }` → validate bounds → `regionForCoordinate` → `fetchLocalRoads(region.code, lat, lon, radiusMi ?? 0.15)` → `findDrivewayCandidates(segs, {lat,lon})` → `res.json({ candidates })`. Roads unavailable / none found ⇒ `res.json({ candidates: [] })` (never 500 — the UI falls back to manual placement).
- Verify: a small node harness (bundled like the Phase-1 E2E) hitting the route with a stub `/api/roads`, OR a direct unit call of the handler; assert candidates shape. Minimum: `tsc` + the pure-function tests from Task 1.

### Task 3 — Frontend: interactive driveway map in the form
- **File:** `artifacts/atlanta-tis/src/pages/tis.tsx`.
- Add a `DrivewayEditor` section to `TisFormSection` (shown once the site has coords): a `MapContainer` centered on the site (site marker + OSM tiles), an **"Auto-detect driveways"** button (POST `/tis-api/demo/driveway-candidates`, drop returned markers), **draggable** `Marker`s for each driveway, click-on-map to add, a delete control per driveway, and a per-driveway panel with an access-type `<select>` (presets) + an "Advanced" expand with the four movement checkboxes (shown/editable for `custom`, read-only preview for presets). Store `driveways` in form state; `round4` coords on drag-end.
- Follows existing form patterns; first use of `useMapEvents` + draggable markers (standard react-leaflet).
- Verify: `pnpm --filter @workspace/atlanta-tis build` + `tsc`; preview the `/tis` page, screenshot the map with auto-detected + dragged driveways and the access-type panel.

### Task 4 — Wire driveways into the request + results map
- Attach `form.driveways` to the `onGenerate` payload (already typed via Phase-1 codegen). Render driveway markers on the results `MapCard` too (distinct icon). Show the returned `report.driveways` reroute count if present.
- Verify: preview an end-to-end generate with a RIRO driveway; confirm the request carries `driveways` and the report renders.

## Notes
- Street names aren't in the `/roads` segment data, so candidate labels are generic ("Driveway A/B/…") — the user edits them.
- Keep the editor opt-in/collapsible so users who don't need driveways aren't burdened.
