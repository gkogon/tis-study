# UK Trip-Distribution Methods (real Census OD) + UK Driveway/Access Framing

**Date:** 2026-07-07
**Status:** Approved design (user approved approach C + Greater-London-first + "fill the gaps today")
**Repo:** `tis-study` — `artifacts/tis-api-server` (engine) + `artifacts/atlanta-tis` (frontend `/trics`)
**Branch:** `feat/tis-uk-distribution` (worktree off `origin/main` @ 7992c04)

## Problem

The selectable trip-distribution system (**Gravity / Analogy / Surrogate**, shipped
for US reports in #65–#67) and the **driveway** access model (#62–#63) both run
region-agnostically in the engine, but the **UK path never surfaces them and is
not backed by UK data**:

1. `computeTripDistribution(method, ctx)` already runs for UK and drives UK
   loading→LOS, but `renderTisLondon` never calls `renderTripDistributionSection`
   — the UK PDF gets prose §6.11 (`volume × distance⁻¹·⁵`), never the method-aware
   directional table + per-zone worksheet US reports get.
2. The three methods cite **US sources** (NCHRP-716 gravity, ITE-family analogy,
   US Census-block-group TAZ surrogate). None reads as UK-standard, and the
   surrogate's TAZ asset is US-only (UK degrades to road-volume).
3. Driveways work end-to-end for UK, but are labelled with US "driveway" terms,
   not UK access terms (DMRB CD 123 priority/ghost-island/signalised; Manual for
   Streets).
4. The `/trics` page (public London-only TA generator) exposes **neither** the
   distribution-method dropdown **nor** the driveway editor. Its `/trics/generate`
   + `/trics/pdf` endpoints already use the full `GenerateTisBody` schema, so they
   **already accept** `distributionMethod` + `driveways` — the frontend just does
   not send them.

We want the `/trics` London surface (and, since it is the same renderer + engine,
the whole UK path) to offer the same selectable, method-driven distribution as the
US reports — **backed by genuine UK Census journey-to-work data** — plus driveways
framed to UK access standards.

## Decisions (locked with the user)

| Decision | Choice |
| --- | --- |
| Data depth | **Approach C — hybrid OD**: real Census OD flows drive the directional pattern; MSOA workplace mass is the fallback where flows are sparse |
| Geographic scope (v1) | **Greater London first** (matches the London-gated `/trics` surface); architected to extend to England & Wales |
| Census vintage | **2011** (WU03EW). 2021 travel-to-work is COVID-distorted and ONS flags it non-comparable; 2011 is the planner's pre-COVID convention — matches the existing `london-census-mtw-2011` provenance |
| Driveways | **UK access framing only** — relabel to site accesses / vehicular accesses (DMRB CD 123, Manual for Streets). **No routing/behaviour change** |
| Method labels (UK) | Gravity → WebTAG M2 / DMRB proximity gravity; Analogy → TRICS-comparable-site (cite-not-copy); Surrogate → **Census journey-to-work catchment** |
| Default method | **Gravity** — unset method ⇒ byte-identical to today |
| Timeline | Fill all gaps today; phased commits, PR opened (not merged — no autonomous deploy) |

## Non-goals (YAGNI)

- No TEMPro/NTEM trip-end ingestion in v1 (WU03 OD is the real-data spine).
- No embedding of TRICS rates/tables (licence forbids redistribution; analogy uses
  publicly-derivable Census-by-area-type patterns, cite-not-copy).
- No Scotland OD (NRS is a separate dataset) — Scottish/`non-London` UK regions
  degrade to gravity with a stated basis.
- No change to driveway routing, capacity math, or the US renderers.
- No out-of-London workplace destinations in v1 (London×London submatrix; a 0.8 km
  screening study network is intra-London, so nearby-MSOA flows carry the signal).

## Data sourcing (verified live 2026-07-07)

Both sources reachable from the build environment (HTTP 200; live JSON confirmed).

1. **WU03EW OD flows** — nomis `NM_1208_1`
   (*"WU03EW – Location of usual residence and place of work by method of travel to
   work (MSOA level)"*). Dimensions: `usual_residence`, `place_of_work`,
   `transport_powpew11` (same 12-mode codelist as `fetch-nomis-2011-mtw.ts`:
   0=all … 2=underground, 3=train, 4=bus, 7=car-driver, 8=car-passenger, 9=cycle,
   10=walk …), `measures=20100` (count). Fetch the **Greater-London × Greater-London
   submatrix** (residence London MSOAs → workplace London MSOAs). Column sums over
   all origins = **workplace-employment mass** per destination MSOA (the surrogate
   fallback); row vectors = the **directional OD pattern** for a residence MSOA.
2. **MSOA 2011 population-weighted centroids** — ONS Open Geography Portal
   FeatureServer `MSOA_Dec_2011_PWC_in_England_and_Wales_2022` (MSOA11CD + lat/lon).
   Needed to compute each zone's bearing + distance from the site.
3. **London MSOA membership** — MSOA (2011) → Region lookup, region London =
   `E12000007` (≈983 MSOAs). Derived from ONS lookup or nomis geography children of
   `E12000007` at MSOA type.

**Licence:** ONS Crown Copyright / Open Government Licence v3.0 — free, redistribution
permitted with attribution. Attribution string stored in the asset + printed in the
PDF basis line. (Contrast: TRICS is licensed — not embedded anywhere.)

**Fetcher:** `scripts/src/fetch-nomis-2011-wu03.ts`, mirroring
`fetch-nomis-2011-mtw.ts` (idempotent, pinned dataset id, writes the asset to the
api-server data dir). Produces:

`artifacts/tis-api-server/src/data/greater-london-msoa-od-2011.json`
```jsonc
{
  "source": "ONS 2011 Census WU03EW (nomis NM_1208_1), MSOA-level OD by method of travel; Greater London (E12000007)",
  "licence": "Open Government Licence v3.0 — © Crown copyright 2011",
  "year": 2011, "region": "E12000007", "fetchedAt": "2026-07-07",
  "modes": ["all","underground","train","bus","car_driver","car_passenger","cycle","walk", ...],
  "zones": [ { "msoa": "E02000001", "name": "City of London 001", "lat": 51.5155, "lon": -0.0922,
              "workplaceTotal": 356019, "residentWorkers": 5432 } , ... ],
  "flows": { "E02000001": { "E02000002": {"all": 12, "car_driver": 3, ...}, ... }, ... } // sparse
}
```
Size for Greater London stays well under the 12 MB US TAZ asset; lazy-parsed on
first UK-distribution call (mirrors `national-block-group-taz.ts`).

## Architecture

Reuse the unified layer from #65. `computeTripDistribution` already dispatches by
method; add a **UK data adapter** the strategies consult when the study region is
UK, alongside the existing US TAZ path. One region flag selects the data spine; the
`TripDistributionSummary` shape, the shared PDF renderer, and the request/response
contract are unchanged.

```
   req.distributionMethod ?? "gravity"      region.country === "UK"
                    │                                 │
   tis.ts ── builds DistributionContext ──────────────┤ (adds ukOd: UkOdSource)
                    ▼                                  ▼
   trip-distribution.ts  computeTripDistribution(method, ctx)
      ├─ gravity   → four-step proximity gravity   (basis: WebTAG M2 / DMRB, UK)
      ├─ analogy   → analogy-reference.ts pattern   (UK area-type rows, cite-not-copy)
      └─ surrogate → UK: WU03 OD row for site MSOA (directional) → weights[];
                        fallback = workplace-mass; US: existing TAZ path
                    ▼
   TripDistributionSummary (weights[], zones[], byDirection, sectors, provenance)
      ├─ weights[] → per-intersection loading (drives assignment → LOS/queues)
      └─ result.tripDistribution → renderTripDistributionSection in renderTisLondon
```

### New / changed units

1. **`scripts/src/fetch-nomis-2011-wu03.ts`** (new) — the fetcher (above). Run once
   to produce the asset; committed to the repo like the US TAZ asset.
2. **`artifacts/tis-api-server/src/lib/greater-london-msoa-od.ts`** (new) — loads +
   indexes the asset lazily; exposes:
   - `ukOdAvailable(): boolean`
   - `msoaAt(lat, lon): { msoa, name, lat, lon } | null` (nearest-centroid, radius-guarded)
   - `odRowFor(msoa): Record<destMsoa, ModeCounts> | null` (directional flows)
   - `workplaceMass(msoa): number` (surrogate fallback mass)
   Radius-scoped + indexed so a dense borough never scans all ~983 zones.
3. **`analogy-reference.ts`** (changed) — add UK area-type rows (CBD/urban/suburban
   split for London), each with a **cite-not-copy** basis string (publicly-derivable
   / Census-by-area-type, explicitly *not* TRICS data). Existing US rows untouched.
4. **`trip-distribution.ts`** (changed) — surrogate strategy: when `ctx.ukOd` is
   present, build `weights[]` from the site-MSOA OD row spread across candidates by
   bearing + distance-decay; mass fallback when the row is empty. Gravity/analogy
   basis strings become region-aware (UK vs US). `TripDistributionSummary` shape
   unchanged.
5. **`tis.ts`** (changed) — when `region.country === "UK"`, populate `ctx.ukOd` from
   `greater-london-msoa-od.ts` (only when the method needs it / London region).
   Non-London UK ⇒ no OD, strategies fall back with a stated basis.
6. **`pdf-export.ts` → `renderTisLondon`** (changed) — at §6.11 (London) / §5.9
   (non-London UK), call `renderTripDistributionSection(doc, r, { sectionLabel })`
   with UK method labels; keep the existing PT-mode distribution sub-sections
   (§6.12–6.14) as prose. Driveway figure/table block: relabel headings + note to
   UK access terms **only when `region.country === "UK"`** (US output byte-identical).
7. **`artifacts/atlanta-tis/src/pages/trics.tsx`** (changed) — add the
   distribution-method dropdown (UK labels) + `<DrivewayEditor>`; include
   `distributionMethod` + `driveways` in the `/trics/generate` + `/trics/pdf` bodies.
   Backend passthrough already exists.

## The three UK strategies

- **Gravity** — no math change (four-step proximity gravity). Basis reframed:
  *"WebTAG Unit M2 gravity assignment / DMRB proximity distribution; for a submitted
  TA the distribution is agreed in the scoping note with the LPA (and TfL in
  London)."*
- **Analogy** — `ComparableSource.find(family, areaType)` → directional
  `byDirection`; UK rows added, each basis stating a **publicly-derivable Census /
  screening pattern**, not TRICS. Provenance names the matched row + the cite-not-copy
  caveat.
- **Surrogate → Census journey-to-work catchment** — the real-data method. The
  site's MSOA OD row (residence→workplace flows) is projected onto candidate
  bearings; each candidate's share = Σ flows whose destination lies in its direction,
  distance-decayed → `weights[]`. Empty/sparse row ⇒ workplace-mass fallback ⇒
  road-volume fallback (non-London). Basis names WU03EW + the OGL attribution.

## Driveways — UK access framing (no behaviour change)

In `renderTisLondon`'s driveway block only (`region.country === "UK"`):
- Heading: *"Site Access — Driveways"* → *"Vehicular Access Arrangements"*.
- Column/label copy: "driveway" → "access"; access-type values mapped to UK terms
  (full movement → *all-movements / priority junction*; right-in/right-out etc. →
  *left-in/left-out (ghost-island / simple priority)* per DMRB CD 123; signalised).
- Reroute note framed as banned-turn access geometry per DMRB CD 123 + Manual for
  Streets access-spacing, feeding the junction LOS. Routing, counts, LOS unchanged.

US path keeps its exact current wording (guarded on `country === "UK"`).

## Error handling & edge cases

- **Non-London UK / no MSOA within guard radius** → OD absent; surrogate → mass →
  road-volume; gravity/analogy unaffected. Never throws.
- **Sparse/zero OD row** → workplace-mass fallback; basis states the fallback.
- **Asset missing at runtime** (`ukOdAvailable() === false`) → all UK methods behave
  exactly as today (gravity), no section regression.
- **Weights normalization** — all-zero mass ⇒ uniform weights, basis noted.
- **Determinism** — no `Date.now()`/`Math.random()`; stable sort by distance.
- **Empty candidate set** → distribution skipped (existing coverage-warning path).

## Testing

Engine can't run locally (needs the analyzer at `localhost:8080`); mirror the
existing check-script pattern:

- **`scripts/check:uk-distribution`** (`verify-uk-distribution.mjs`) — pure checks:
  surrogate UK weights (Σ≈1, non-negative, bearing mapping sane), OD-row → direction
  projection, mass + road-volume fallbacks, `byDirection` Σ=100 / `sectors` Σ=100,
  cite-not-copy basis present.
- **`pnpm --filter tis-api-server typecheck`** (+ regenerated zod/react-client if the
  spec changes — it should not; the fields already exist).
- **PDF smoke** (`smoke:distribution-pdf` extended to London): render a London TA per
  method; confirm the distribution section + UK-framed driveway block appear, no
  blank-page cascade, no throws.
- **Regression**: `distributionMethod` unset + no driveways ⇒ London report
  byte-identical to `origin/main` for a fixed fixture; **US reports byte-identical**
  (UK framing guarded on country).

## Build sequence (commits on `feat/tis-uk-distribution`; PR, not merge)

1. **Data** — fetcher + run it → `greater-london-msoa-od-2011.json` + loader
   `greater-london-msoa-od.ts` + unit check.
2. **Engine** — wire `ctx.ukOd` in `tis.ts`; UK surrogate + region-aware basis in
   `trip-distribution.ts`; UK analogy rows.
3. **Renderer** — distribution section in `renderTisLondon`; UK driveway framing.
4. **Frontend** — `/trics` method dropdown + `DrivewayEditor`.
5. **Verify** — typecheck + check script + London PDF smoke; open PR.

## Open risks

- **TRICS licence** — analogy UK rows must be publicly-derivable, not TRICS tables;
  each basis states its non-TRICS source (aligns `project_tis_ite_trb_licensing`).
- **OD matrix size / perf** — scoped to Greater London + lazy-parsed + indexed.
- **LOS shifts** — surrogate can move LOS vs gravity because it drives loading;
  default gravity preserves today's behaviour; changes are opt-in.
- **Nearest-centroid MSOA match** — guard radius so an offshore/edge coordinate does
  not snap to a distant MSOA; fall back to gravity if none within guard.

## Related memory / references

- `project_tis_trip_distribution_methods` — the US selectable-method system this extends.
- `project_tis_velocity_format` — the London TA (Velocity) renderer + TRICS/Census method.
- `project_tis_fl_caltran_renderer` — the FL gravity pattern the unified layer generalizes.
- `project_national_taz` — the US TAZ surrogate this mirrors for UK.
- `project_tis_ite_trb_licensing` — cite-not-copy constraint (TRICS not embedded).
- `reference_japan_census_aadt` / `fetch-nomis-2011-mtw.ts` — the idempotent census-fetcher pattern reused.
