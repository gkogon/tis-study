// London Transport Assessment renderer — scaffold.
//
// This module is the planned extraction target for the London TA renderer
// per `REGIONAL-SPECS/london-ta-spec.md` §10 + §12. The actual rendering
// logic still lives in the monolithic `renderTisLondon()` in
// `../pdf-export.ts` (search for `function renderTisLondon`). This file
// exists to hold the migration once the renderer grows past the US-engine
// cross-reference shape it has today.
//
// Migration order (each step is a separate, reviewable commit):
//
//   1. Move `renderTisLondon`, `ldnSection`, `ldnSubsection` and any
//      London-only helpers verbatim into this module, re-export them
//      from here, and replace the original `pdf-export.ts` definitions
//      with thin re-export stubs (one commit, ~500 lines moved).
//
//   2. Add a `LondonTaInputs` type covering the additional inputs the
//      real renderer needs and the US engine does not currently
//      produce (per spec §12):
//        - PTAL band + Accessibility Index for the site centroid
//        - TRICS rate set (CSV upload or scoped+locked TRICS rank/filter
//          parameters captured from a TRICS PDF export, plus the
//          Calculation Reference, licensee TRICS licence number, and
//          Cross Test mean-vs-median variation %; per GPG §13.8, §14.8,
//          §22.7 and the 19 May 2026 licence-monitoring notice)
//        - Active Travel Zone polygon (WebCAT 20-minute cycle isochrone)
//        - Healthy Streets Check workbook scores (XLSX upload, 31
//          metrics × 10 indicators × existing-vs-proposed)
//        - Vision-Led factoring metadata, if any (raw-vs-factored
//          distinction required by GPG §10.7)
//        - SAM monitoring schedule if the scheme is S106-secured
//          (GPG §23; typically year 1 / 3 / 5)
//
//   3. Add input-validation + the dispatch-arm wire-up to route
//      `region.country === "GB"` schemes through the real renderer
//      instead of the cross-reference wrapper. Keep the wrapper behind
//      an `--cross-reference-only` flag for backward-compat.
//
//   4. Implement the new chapters/sections per the TfL Healthy Streets
//      TA TOC (spec §2.1) using the new inputs above. Sections to
//      drive from real data, in priority order:
//        - Ch 3.2 PTAL band + AI (from WebCAT lookup)
//        - Ch 5.1 TRICS multi-modal trip generation (replaces ITE
//          11th-edition rates; mode list per spec §3.1)
//        - Ch 4 Active Travel Zone (from WebCAT cycle isochrone)
//        - Ch 3.4 Healthy Streets Indicators check (from XLSX)
//        - Ch 3.7 Travel Plan template with SAM monitoring schedule
//
//   5. Remove the US-engine LOS / HCM / queue-95th-percentile output
//      from the London branch; the engine's underlying intersection
//      capacity is no longer surfaced once the TRICS + Junctions-11
//      inputs are available. The cross-reference text in §1.2 is
//      retained for any borough that still accepts the screening
//      shape.
//
// Until step (1) lands, do not import from this module in production
// code paths — the actual renderer is still `renderTisLondon` in
// `pdf-export.ts`. This module is intentionally empty other than the
// roadmap comment above; the export will be added when step (1)
// extracts the function here.

export {};
