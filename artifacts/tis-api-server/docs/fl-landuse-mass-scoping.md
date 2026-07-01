# Scoping: Replace Caltran FL Gravity "Through-Volume" Mass with True Land-Use Mass

> **Status:** Deferred — decision-ready scope, not yet planned into work.
> **Date:** 2026-07-01 · **Related:** PR #61 (the shipped Caltran FL gravity model; `caltran-gravity.ts` + FL wiring in `tis.ts`).
> **TL;DR:** The mass swap itself is one line, but it depends on the orphaned national Census block-group subsystem (code + a 12 MB asset deliberately untracked off `main` in PR #15). Recommended path is **Approach A** (zone stays = study intersection; mass = nearest block group's population + LODES jobs, no dwelling-units term), gated on a **Phase 0** that re-tracks and correctly ships that subsystem. For the median FL site the fidelity gain is marginal (through-volume already correlates with activity); the real win is **defensibility** (mass traceable to Census/LODES). If the 12 MB asset pipeline isn't worth owning, staying on the through-volume proxy is the correct call.

## 1. The gap in one paragraph

Today each study intersection's gravity mass is `c.sig.totalVolume` (AADT × K-factor) — a measure of how much traffic *already flows through* the node, not what land use *sits near* it. The Caltran worksheet literally specifies `M = (population + employment + dwelling units) × net-developable fraction`, i.e. a land-use *demand* signal. Be honest: through-volume is already a decent proxy — heavy traffic usually means nearby activity, so for the median FL site the two are correlated and the distribution barely moves. The gap bites in specific, nameable cases where flow and land use **decouple**: (a) a high-volume arterial or freeway on-ramp fronting parking lots / low-density land pulls share toward itself despite attracting nothing; (b) a lower-volume node next to dense employment or housing is under-weighted; (c) a large approved-but-unbuilt development that has land-use mass in the pipeline but no current through-volume; (d) a park-and-ride or transit node where roadway flow understates the true trip pull; (e) employment-vs-residential asymmetry (a site with a freeway to the west but the CBD/mall to the east — proxy sends trips west, land-use mass sends them east). The fidelity win is primarily a **defensibility** win — a reviewer can trace the number to Census/LODES instead of an AADT heuristic — not a dramatically different LOS outcome. Trip totals and the intersection set don't change; only the *relative* directional re-weighting does.

## 2. What the parked subsystem can / can't provide

| Question | Answer | Source |
|---|---|---|
| Per-zone raw land-use mass with centroids? | **Yes** — `blockGroupsWithin(lat,lon,radiusMi)` returns each Census block group as `{geoid, lat, lon, population, jobsShopping, jobsCommerce, jobsWorking, distanceMi}`, population-weighted centroid, sorted by distance | `national-block-group-taz.ts:160` |
| Population? | Yes — resident count (Census 2020) | `:48-56` |
| Employment? | Yes — 3 job classes (LODES8 WAC): shopping (CNS07+CNS18), commerce (CNS09-14), working (residual C000) | `build-national-taz.ts:9-12,117-136` |
| Dwelling units? | **No field.** Must be **derived** = population / avg household size (~2.5 ACS). No household-size field in asset either | grep returns nothing for dwelling/housing/HU |
| Adopted Miami-Dade LRTP = raw mass or %? | **% only** (8-wedge `pct` record). `totalTrips` exists but is origin *productions*, not attraction mass. **No centroid, no lat/lon, no site→TAZ resolver** across all 3,040 rows — cannot serve as spatial gravity mass | `fl-lrtp-directional-distribution.ts:49-51,72,81` |
| Coverage | **US-only** (50 states + DC; 1 state skipped for jobs). Miami-Dade LRTP = **one county only**. **Nothing global** | `build-national-taz.ts:47-57`; meta.json |
| Zone resolution | Nearest population-weighted **centroid** within radius, **not** point-in-polygon containment | `:12-17,128-131` |
| Mass provenance honesty | Modeled/synthetic, custom NAICS→bucket mapping, **not** ITE codes, **not** an adopted TAZ layer | `directional-distribution.ts:99` |
| **Ship blocker** | Code + **12 MB JSON asset** + builder are **UNTRACKED** and were *deliberately* untracked off main in PR #15 (commit 5374eec). `build.mjs` ships them nowhere the loader reads → subsystem silently `existsSync`-gates to null in prod | git status; `build.mjs:19-23`; `national-block-group-taz.ts:42-44` |

## 3. Approaches

All three require committing the orphaned national-TAZ subsystem (~10 files / ~5,091 LOC + 12 MB blob + a `build.mjs` asset-shipping fix). None is free of that cost.

| | **A — per-intersection catchment mass** | **B — land-use zones, direction-projected** | **C — adopted-LRTP-first hybrid** |
|---|---|---|---|
| **Score** | **6/10** | 5/10 | 5/10 |
| **Effort** | M | L | L |
| **Zone model** | Zone stays = study intersection. Each node's mass = Σ land-use mass of block groups within a small catchment (~0.25–0.5 mi), or nearest-BG if empty | Zones = block groups (real centroids + mass). Gravity → 8-wedge directional split → re-projected onto intersections by bearing | Two branches: Miami-Dade → adopted LRTP % directly; rest of FL → block-group Census gravity. Both collapse to an 8-wedge % re-projected onto intersections |
| **Code change** | **One line** at `tis.ts:1337` (+ massBasis + a catchment loop). Positional `weights[i]↔candidates[i]` contract **untouched** | Two zone sets; add `projectDirectionOntoTargets` helper; mass on the **directional rail only** | Refactor `directionalMultipliers` to accept external `byDir`; dual presentation (adopted table vs gravity worksheet); needs SERPM TAZ shapefile that **doesn't exist in repo** |
| **Scope-collapse risk** | **None** (zone set unchanged) | Avoided *only if* mass feeds `byDirection`→mean-1 mult and `weights[]` stays intersection-anchored | Must re-prove per branch |
| **Orphan-commit cost** | Yes | Yes | Yes — **plus** LRTP branching on top; does not save the subsystem cost |
| **Biggest catch** | DU double-counts residents (pop + pop/2.5 both enter mass) — drop DU term; empty-catchment sparse sites revert to fallback | Larger blast radius; joins two un-merged bodies of work | LRTP is %-only (can't fill a gravity mass column); one county; two provenance stories in one PR |

## 4. Recommendation + phasing

**Ship Approach A, scored down to its minimal form. Do B/C later, if ever.**

Rationale: A is the only option that makes the mass genuinely land-use-based while touching **one line** and preserving the mean-1 directional model that already dodges scope-collapse. It buys the entire "mass = land use, traceable to Census/LODES" defensibility story — which is the actual prize — without rebuilding the zone/assignment plumbing. B and C chase *directional* fidelity that, per every fidelity note above, moves LOS only second-order, at multiples of the risk and blast radius. C additionally needs a SERPM TAZ shapefile the repo does not have, so its headline (adopted-LRTP) branch is not even buildable today.

**Phasing:**

- **Phase 0 (blocker, unavoidable): land the subsystem.** Re-track `national-block-group-taz.ts`, `build-national-taz.ts`, the 12 MB JSON + meta. Decide storage: **Git LFS or build-on-deploy fetch** — do not casually commit a 12 MB blob into main history (it already sits in `origin/turbo-national-taz`). Fix `build.mjs` to copy `data/` to where the loader reads (`dist/../data`, or set `NATIONAL_TAZ_PATH`). Verify `nationalTazAvailable()` returns true in a clean build. **Without this, everything else silently no-ops in prod.**
- **Phase 1 (smallest useful step): single-nearest-BG mass, not catchment.** Replace `tis.ts:1337` mass with `blockGroupAt(c.sig.latitude, c.sig.longitude)` → `mass = population + jobsShopping + jobsCommerce + jobsWorking` (**no DU term** — see guardrails). Fall back to `FALLBACK_VOLUME` only when the asset/BG is absent. Update `massBasis` (`tis.ts:1363`) to: *"land-use mass (Census 2020 pop + LODES8 jobs); modeled, not an adopted TAZ layer."* This is the true 1-line mass swap, captures most of the fidelity, and needs no catchment-radius tuning knob.
- **Phase 2 (optional): catchment sum + Voronoi de-dup.** Upgrade nearest-BG to `blockGroupsWithin(..., CATCHMENT_MI)` summed, with each BG assigned to its nearest candidate (avoid double-count). Only worth it if Phase 1 shows nearest-BG is too coarse on real FL sites. Add empty-catchment nearest-BG fallback.
- **Phase 3 (defer indefinitely): B's directional re-projection / C's adopted-LRTP branch.** Only if a customer/PE reviewer *specifically challenges* the directional split, and (for C) only after a SERPM TAZ shapefile exists.

**Do NOT do yet / out of scope:**
- Do **not** set `weights[i]` to a block-group gravity share — that spreads trips to distant BG centroids and reintroduces the exact scope-collapse regression the memory warns about.
- Do **not** decouple the zone set from `candidates[]` (that's B/C; needs the bearing re-projection bridge).
- Do **not** include a derived dwelling-units term in the mass sum (double-counts residents).
- Do **not** wire the LRTP layer as gravity mass — it's %-only, no centroids, no resolver.
- Do **not** commit the raw 12 MB blob without an LFS / build-fetch decision.
- Do **not** treat this as a global feature — it's US-only; keep it strictly behind the existing `isFloridaRegion` gate.

## 5. Risks & guardrails

- **Scope-collapse regression (highest priority).** The mass swap must stay on the *mass-of-intersection-zones* rail (Phase 1) or the *directional* rail (B). The instant a block-group share becomes `weights[i]`, near-site loading collapses. Guardrail: keep zone set = `candidates[]`; `weights[]` stays the existing intersection-anchored distance-decay/gravity product. Verify near-site LOS on a known site before/after.
- **Orphaned-subsystem ownership.** ~10 files / 5,091 LOC + 12 MB asset, deliberately untracked in PR #15. This turns a self-contained mergeable change into a two-body merge. Guardrail: Phase 0 is a discrete, tested PR of its own (re-track + LFS/build-fetch + `build.mjs` fix + `nationalTazAvailable()` green in clean build) *before* the mass swap. Verify against **all** branches (fleet junk-drawer caveat), not just origin/main.
- **Silent prod no-op.** Loader reads `dist/../data`; `build.mjs` copies non-existent `src/data`. If unfixed, mass silently reverts to `FALLBACK_VOLUME` → degenerate uniform shares, **no error**. Guardrail: assert asset presence in a smoke test on the deployed artifact.
- **Dwelling-units.** No field exists. Deriving DU = pop/2.5 and adding it to a sum that *already contains population* double-counts residents ~1.4×. Guardrail: **mass = population + jobs, drop the DU term entirely**, and say so in `massBasis`. This is the honest core.
- **US-only vs global-first.** Census/LODES cannot back a global mass. This locks in an FL-only divergent code path. Guardrail: gate strictly on `isFloridaRegion` + `nationalTazAvailable()`; every non-US and asset-missing path falls back to the current through-volume proxy. Do not let this leak into the global default.
- **Sparse sites.** Nearest-centroid, not point-in-polygon. A far-edge/offshore FL coord may catch zero BGs → fallback. Guardrail: `blockGroupAt` nearest-BG fallback (Phase 1 already uses nearest, so this is inherent) before `FALLBACK_VOLUME`.
- **Provenance honesty.** Custom NAICS→bucket residual, modeled/synthetic. Guardrail: `massBasis` string and `FlGravityZone.mass` reporting must state "modeled land-use, not adopted TAZ" or the report overclaims.

## 6. Effort estimate

| Phase | Size | What it is | Verification |
|---|---|---|---|
| **0 — land subsystem** | **M** | Re-track 3 files + asset; LFS or build-fetch decision; fix `build.mjs` copy step | Clean checkout + build; `nationalTazAvailable()` true; smoke test that asset resolves in the deployed artifact (not just dev tree) |
| **1 — nearest-BG mass swap** | **S** | One-line mass source at `tis.ts:1337` + `massBasis` + asset-absent fallback | E2E render on 3–5 real FL sites (incl. one sparse/edge coord); confirm shares shift sanely, totals unchanged, no scope-collapse; diff massBasis prose |
| **2 — catchment + Voronoi** | **M** | `blockGroupsWithin` sum, nearest-candidate assignment, empty-catchment fallback, `CATCHMENT_MI` sensitivity | Sensitivity sweep on catchment radius (shares must not flatten to uniform); double-count check; sparse-site fallback exercised |
| **3 — B/C directional / adopted-LRTP** | **L** | Zone-set decoupling + bearing re-projection (B); `directionalMultipliers` refactor + SERPM shapefile + dual presentation (C) | Prove mean-1 re-projection preserves near-site loading floor; verify LRTP data-table provenance against source PDF; Miami-Dade reviewer-facing sign-off |

**Bottom line:** For the *median* FL site the fidelity gain is marginal — through-volume already correlates with activity, and only the directional re-weighting moves, not trip totals or LOS in any dramatic way. The real, bankable win is **defensibility** (mass traceable to Census/LODES, matches the literal worksheet). That win is fully captured by Phase 1 (Approach A, one line) once Phase 0 lands the subsystem. Everything beyond Phase 1 is deferrable until a reviewer specifically challenges the directional split. If you are **not** willing to own the 12 MB asset + its build pipeline (Phase 0), do not start — staying on the through-volume proxy is the correct call, and A's score drops to ~3.