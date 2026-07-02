# Trip Distribution Methods (PR1 — Unified Layer + Gravity Everywhere) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a region-agnostic trip-distribution layer (`trip-distribution.ts`) that fully implements the `gravity` strategy (wrapping today's four-step / Caltran logic), stubs `analogy`/`surrogate` to fall back to gravity, wires it into `tis.ts` so the returned `weights[]` / `loadMultipliers[]` / `flGravity` drive per-intersection loading in ALL regions, renders a shared trip-distribution PDF section in every US regional renderer, and exposes a `distributionMethod` request option end-to-end (OpenAPI → codegen → engine type → frontend dropdown). The key design decision that makes byte-identity provable: **`tis.ts` builds the exact `demandZones` / `gravityZones` it builds today (including `refVolume` and the `clamp(mass/refVolume, 0.05, 1.0)` `baseVoverC`) and passes the pre-built zones into the leaf module — the leaf never re-derives `refVolume`/`baseVoverC`.**

**Architecture:** A single unified distribution layer replaces the FL-only special case. `computeTripDistribution(method, ctx)` returns one `TripDistributionSummary` (generalizing `FlGravitySummary`). `ctx` carries the **already-built** `demandZones: DemandZone[]` and `gravityZones` so the leaf calls `distributeAndAssign(demandZones, pmExternalAutoTrips, {gamma})` (non-FL) and `caltranGravityShares(gravityZones)` + `directionalMultipliers(gravityZones)` (FL) with byte-identical inputs → byte-identical weights. `tis.ts` reassigns the existing `weights` / `flLoadMultiplier` / `flGravity` locals from the returned summary so all downstream consumers (`loadWeights`, route assignment, `buildAffectedRow`, sensitivity) keep working verbatim. A new `pdf-export-distribution.ts` (Path A: self-contained, duplicates primitives per repo convention) renders the section; FL §6.1/§6.2 refactors onto it **reproducing FL's exact prose + captions + `doc.moveDown(0.2)` spacing**, and every US renderer gains a call at its native section anchor. London/UK is excluded.

**Tech Stack:** TypeScript (Node v26 native TS stripping), pnpm workspaces, `pdfkit` for PDF, `orval` for codegen (zod + react-query client), React + Vite frontend. No test runner — verification = pure-node `.mjs` check-scripts (mirroring `verify-caltran-gravity.mjs`) + `tsc --noEmit` typecheck + codegen diff + PDF smoke.

## Global Constraints

- **Baseline framing (confirmed git facts).** `origin/main` (`9ac286a`) is **AHEAD** of this branch: it carries the driveways PR #62 merge and other commits that this branch deliberately lacks (origin/main's `tis.ts` is 1733 lines vs this worktree's 1659; `pdf-export.ts` also diverges). This worktree HEAD is `026a26d` (docs-only design-spec, 1 file / 212 insertions). Its parent — the fork point / merge-base with `origin/main` — is **`612cdbc`**. The **byte-identical baseline for PR1 is the fork point `612cdbc`** (this worktree's engine + PDF tree), NOT `origin/main`. Do NOT assert `HEAD == origin/main`, and do NOT run `git diff --stat origin/main..HEAD` expecting a docs-only result (it will show the whole driveways divergence). Verify the lead commit is docs-only with `git show --stat 026a26d` (expect 1 file under `docs/superpowers/`). The final scope gate (Task 11) compares against the fork point `612cdbc`, not `origin/main`.
- Branch off the current worktree HEAD onto `feat/trip-distribution-methods` (it already exists — check it out, do not recreate).
- Stage EXPLICIT paths only, never `git add -A`.
- Deploy = squash-merge PR (do not merge in this plan; PR creation is out of scope for PR1 execution unless the user asks).
- **Byte-identical invariant (precise, three clauses):**
  - **(i) Numeric identity, all regions.** With `distributionMethod` unset, the **LOADING** (`weights[]`, `loadWeights[]`, `flLoadMultiplier[]`), the **per-intersection added trips**, **LOS**, and **queue** numbers must be byte-identical to origin/main for every region. This is guaranteed by construction: `tis.ts` builds `demandZones`/`gravityZones`/`refVolume` exactly as today and the leaf module consumes them without re-derivation.
  - **(ii) FL PDF identity.** FL's §6.1/§6.2 PDF output — prose, captions (including the FDOT TAH §2.7 caption), table columns/widths/alignments, and every `doc.moveDown(...)` spacing call — must be byte-identical after the refactor **for any FL study with ≥1 study-area zone** (i.e. every real report). The shared `renderTripDistributionSection` MUST parameterize narrative/caption strings and, when rendering FL, reproduce FL's exact prose + `doc.moveDown(0.2)` calls. KNOWN BENIGN EDGE: the shared renderer early-returns on an empty zone set, whereas origin/main would still emit a bare "§6.2 Project Trip Assignment" heading with no table. This path is unreachable for rendered FL reports because a zero-signal study returns HTTP 422 (coverage warning, PR #53) BEFORE PDF render, so no empty-zone FL report is ever produced — the divergence cannot occur in practice. Do not add code to reproduce the bare-heading case.
  - **(iii) Non-FL US reports INTENTIONALLY gain the new section.** GA/TX/CA/IL/NY/generic reports gain the trip-distribution section they lack today. This is the feature, NOT a regression — clause (i) applies to the loading/LOS *numbers*, not to the presence of the new PDF section.
- London/UK is EXCLUDED — never add the shared distribution section to `renderTisLondon` (span **[3357, 4919]**; next fn `renderTisTexasWorksheet` at 4920).
- No ITE-copyright content — PR1 only re-homes existing gravity math; no ITE tables introduced.
- The engine's full `analyze()` is NOT runnable locally (no analyzer at `localhost:8080`) — verification = pure-node check scripts + typecheck + PDF smoke render only. Do NOT write `pnpm test` (none exists).
- `trip-distribution.ts` MUST stay an import-free-of-http leaf (import only `four-step-model.ts`, `caltran-gravity.ts`) so it loads under Node's native TS stripping in a `.mjs` check-script.
- The `analogy` and `surrogate` methods are STUBS in PR1: they fall back to gravity and set `basis` noting "not yet implemented (PR2/PR3)". No `analogy-reference.ts`, no `national-block-group-taz.ts` wiring in PR1.
- **Ordering contract:** `summary.weights[]` and `summary.loadMultipliers[]` are **candidate-ordered** (aligned 1:1 to the input `ctx.candidates` / `demandZones` order). `summary.zones[]` is **share-sorted** (descending `sharePct`, matching origin/main FL `flGravity.zones`). ALL consumers must key by `id`, never by index, when crossing between the two. This is asserted in the check-script.

---

## Task 1 — Bootstrap branch (origin/main is AHEAD; baseline is the fork point 612cdbc)

**Files:** none (git only).

**Interfaces:** Consumes / Produces — none.

- [ ] 1.1 Confirm the worktree is clean: `git -C /Users/geraldkogon/tis-wt-tripdist status --porcelain`. Expect EMPTY output. If not clean, STOP and report.
- [ ] 1.2 Confirm the pre-existing lead commit is docs-only — and understand that `origin/main` is AHEAD, not behind. `origin/main` (`9ac286a`) carries the driveways PR #62 merge that this branch lacks; HEAD (`026a26d`) parent = the fork point `612cdbc`. Therefore `git diff --stat origin/main..HEAD` would show the entire driveways divergence (heavy engine/PDF/openapi deltas) — do NOT run that check and do NOT treat those deltas as a violation. Instead verify the lead commit alone is docs-only: `git -C /Users/geraldkogon/tis-wt-tripdist show --stat 026a26d`. Expected: exactly 1 file under `docs/superpowers/` (212 insertions). Optionally confirm the fork point with `git -C /Users/geraldkogon/tis-wt-tripdist rev-parse 026a26d^` (== `612cdbc`) and `git -C /Users/geraldkogon/tis-wt-tripdist merge-base origin/main HEAD` (== `612cdbc`). If `026a26d` touches engine or PDF code, STOP and report — the byte-identical baseline assumption (fork point `612cdbc`) is violated.
- [ ] 1.3 Check out the feature branch: `git -C /Users/geraldkogon/tis-wt-tripdist checkout feat/trip-distribution-methods`. If it does not exist, create it at current HEAD: `git -C /Users/geraldkogon/tis-wt-tripdist checkout -b feat/trip-distribution-methods`. Do NOT run `merge --ff-only origin/main` (origin/main is ahead by the driveways merge #62; fast-forwarding onto it would pull in changes this PR does not own — reconciliation with origin/main is deferred to Task 11's final "Reconcile" step).

---

## Task 2 — TDD: pure trip-distribution leaf module (gravity + stubs), zones pre-built by caller

**Files:**
- Create `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/scripts/verify-trip-distribution.mjs`
- Create `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/src/lib/trip-distribution.ts`
- Modify `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/package.json` (scripts block, after the `check:caltran-gravity` entry)

**Interfaces:**
- Consumes (from `./four-step-model`): `distributeAndAssign(zones: DemandZone[], productions: number, params?): FourStepDistribution` (returns `{ weights: number[]; zones: ZoneShare[]; params }`), `GAMMA_FRICTION`, `type DemandZone` (`{ id; attraction; distanceMi; baseVoverC }`).
- Consumes (from `./caltran-gravity`): `caltranGravityShares(zones): GravityShare[]` (each with `.id .mass .distanceMi .bearingDeg .term .share .sharePct`), `directionalMultipliers(zones): { multiplier }[]`, `rollupByCardinal(shares: GravityShare[]): Record<CardinalDir, number>`, `sectorPairs(byDir): Record<string, number>`, `bearingToCardinal(bearingDeg): CardinalDir`, `CALTRAN_GRAVITY_BETA` (= 1), `type CardinalDir`, `type GravityShare`.
- Produces:
  - `type DistributionMethod = "gravity" | "analogy" | "surrogate"`
  - `type DistZone = { id; name; distanceMi; bearingDeg; cardinal: CardinalDir; mass; term; weight; sharePct }`
  - `type TripDistributionSummary` — see step 2.4 for exact shape (adds `method`, `methodLabel`, `basis`, `betaExponent`, `massBasis`, candidate-ordered `weights`/`loadMultipliers`, share-sorted `zones`, `byDirection`, `sectors`, optional `provenance`).
  - `type GravityZoneInput = { id: string; mass: number; distanceMi: number; bearingDeg: number }`
  - `type DistributionCandidateMeta = { id: string; name: string; distanceMi: number; bearingDeg: number; mass: number }`
  - `type TripDistributionCtx = { meta: DistributionCandidateMeta[]; demandZones: DemandZone[]; gravityZones: GravityZoneInput[]; pmExternalAutoTrips: number; isFlorida: boolean }` — **all zones pre-built by the caller.**
  - `computeTripDistribution(method: DistributionMethod | undefined, ctx: TripDistributionCtx): TripDistributionSummary`

- [ ] 2.1 Write the failing check-script `verify-trip-distribution.mjs` FIRST. Its equivalence test reconstructs `demandZones` and `refVolume` **the same way tis.ts does** (recon2 tis.ts:1292–1304), so the assertion genuinely proves equivalence rather than being self-fulfilling. Full content:

```js
// Standalone node script (no test runner). Verifies trip-distribution.ts pure logic.
// Run: pnpm run check:trip-distribution   (or: node ./scripts/verify-trip-distribution.mjs)
//
// The equivalence assertions reconstruct demandZones + refVolume EXACTLY as
// tis.ts does (refVolume = max(FALLBACK, max totalVolumes); baseVoverC =
// clamp(mass/refVolume, 0.05, 1.0)) so a green run genuinely proves the
// byte-identical-to-origin/main path, not a matching-but-wrong formula.
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const m = await import(path.resolve(here, "../src/lib/trip-distribution.ts"));
const fs = await import(path.resolve(here, "../src/lib/four-step-model.ts"));
const cg = await import(path.resolve(here, "../src/lib/caltran-gravity.ts"));
const { computeTripDistribution } = m;

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };
const close = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

const FALLBACK_VOLUME = 5000;

// Raw analyzer-shaped candidates (mirrors { sig: AnalyzerIntersection, distanceMi }).
const raw = [
  { id: "A", name: "Main & 1st", distanceMi: 0.10, totalVolume: 20000, bearingDeg: 30 },
  { id: "B", name: "Main & 2nd", distanceMi: 0.25, totalVolume: 15000, bearingDeg: 120 },
  { id: "C", name: "Main & 3rd", distanceMi: 0.40, totalVolume: 30000, bearingDeg: 210 },
  { id: "D", name: "Main & 4th", distanceMi: 0.30, totalVolume: 10000, bearingDeg: 300 },
];
const pmExternalAutoTrips = 500;

// Build refVolume + demandZones + gravityZones EXACTLY as tis.ts:1292-1335.
function buildCtx(candidates, isFlorida) {
  const refVolume = Math.max(
    FALLBACK_VOLUME,
    ...candidates.map((c) => (c.totalVolume > 0 ? c.totalVolume : 0)),
  );
  const demandZones = candidates.map((c) => ({
    id: c.id,
    attraction: c.totalVolume > 0 ? c.totalVolume : FALLBACK_VOLUME,
    distanceMi: c.distanceMi,
    baseVoverC: clamp((c.totalVolume > 0 ? c.totalVolume : FALLBACK_VOLUME) / refVolume, 0.05, 1.0),
  }));
  const gravityZones = candidates.map((c) => ({
    id: c.id,
    mass: c.totalVolume > 0 ? c.totalVolume : FALLBACK_VOLUME,
    distanceMi: c.distanceMi,
    bearingDeg: c.bearingDeg,
  }));
  const meta = candidates.map((c) => ({
    id: c.id,
    name: c.name,
    distanceMi: c.distanceMi,
    bearingDeg: c.bearingDeg,
    mass: c.totalVolume > 0 ? c.totalVolume : FALLBACK_VOLUME,
  }));
  return { meta, demandZones, gravityZones, pmExternalAutoTrips, isFlorida };
}

const ctx = buildCtx(raw, false);

// --- gravity (non-FL, four-step) ---
const g = computeTripDistribution("gravity", ctx);
ok(g.method === "gravity", "method is gravity");
ok(g.weights.length === raw.length, "one weight per candidate");
ok(g.weights.every((w) => w >= 0), "all weights non-negative");
ok(close(g.weights.reduce((s, w) => s + w, 0), 1, 1e-6), "weights sum to 1");
ok(g.loadMultipliers.length === raw.length, "one loadMultiplier per candidate");
ok(g.loadMultipliers.every((x) => x === 1), "non-FL loadMultipliers all 1 (byte-identical loading)");
ok(close(Object.values(g.byDirection).reduce((s, v) => s + v, 0), 100, 0.5), "byDirection sums to 100");
ok(close(Object.values(g.sectors).reduce((s, v) => s + v, 0), 100, 0.5), "sectors sum to 100");
ok(g.zones.length === raw.length, "one zone per candidate");
ok(close(g.zones.reduce((s, z) => s + z.sharePct, 0), 100, 0.5), "zone sharePct sums to 100");

// --- ordering contract: weights are candidate-ordered, zones are share-sorted ---
ok(g.weights.every((w, i) => w === g.zones.find((z) => z.id === ctx.meta[i].id).weight),
   "weights[i] keyed by candidate id equals matching zone.weight (candidate-ordered)");
ok(g.zones.every((z, i) => i === 0 || g.zones[i - 1].sharePct >= z.sharePct - 1e-12),
   "zones sorted by sharePct descending");

// --- gravity equivalence to origin/main non-FL path (reconstructed as tis.ts does) ---
const refWeights = fs.distributeAndAssign(
  ctx.demandZones, pmExternalAutoTrips, { gamma: fs.GAMMA_FRICTION.hbw },
).weights;
ok(g.weights.every((w, i) => close(w, refWeights[i])), "gravity weights byte-match origin/main four-step (real demandZones)");

// --- FL gravity (Caltran) ---
const flCtx = buildCtx(raw, true);
const fl = computeTripDistribution("gravity", flCtx);
ok(fl.method === "gravity", "FL method is gravity");
ok(close(fl.weights.reduce((s, w) => s + w, 0), 1, 1e-6), "FL weights sum to 1");
ok(close(fl.loadMultipliers.reduce((s, x) => s + x, 0), flCtx.meta.length, 0.01), "FL loadMultipliers are mean-1");
const refShares = cg.caltranGravityShares(flCtx.gravityZones).map((s) => s.share);
ok(fl.weights.every((w, i) => close(w, refShares[i])), "FL gravity weights byte-match caltranGravityShares (real gravityZones)");
const refMults = cg.directionalMultipliers(flCtx.gravityZones).map((s) => s.multiplier);
ok(fl.loadMultipliers.every((x, i) => close(x, refMults[i])), "FL loadMultipliers byte-match directionalMultipliers");
// FL zones share-sorted, matching origin/main flGravity.zones sort.
ok(fl.zones.every((z, i) => i === 0 || fl.zones[i - 1].sharePct >= z.sharePct - 1e-12),
   "FL zones sorted by sharePct descending (matches origin/main flGravity.zones)");

// --- stubs fall back to gravity ---
for (const method of ["analogy", "surrogate"]) {
  const s = computeTripDistribution(method, ctx);
  ok(s.weights.every((w, i) => close(w, g.weights[i])), `${method} stub weights fall back to gravity`);
  ok(/not yet implemented/i.test(s.basis), `${method} stub basis notes not-yet-implemented`);
  ok(s.method === method, `${method} stub preserves requested method label`);
}

// --- default (undefined) resolves gravity for non-FL, Caltran for FL ---
const def = computeTripDistribution(undefined, ctx);
ok(def.weights.every((w, i) => close(w, g.weights[i])), "undefined method == gravity (non-FL)");
const defFl = computeTripDistribution(undefined, flCtx);
ok(defFl.weights.every((w, i) => close(w, fl.weights[i])), "undefined method == Caltran (FL)");

// --- zero-mass guard: uniform weights, still finite ---
const zeroRaw = raw.map((c) => ({ ...c, totalVolume: 0 }));
const zeroCtx = buildCtx(zeroRaw, false);
const z = computeTripDistribution("gravity", zeroCtx);
ok(z.weights.every((w) => Number.isFinite(w) && w >= 0), "zero-mass weights finite non-negative");
ok(close(z.weights.reduce((s, w) => s + w, 0), 1, 0.01) || z.weights.every((w) => w === 0),
   "zero-mass weights sum to 1 (or degenerate-safe)");

// --- empty candidate set: no throw, empty arrays ---
const empty = computeTripDistribution("gravity", { meta: [], demandZones: [], gravityZones: [], pmExternalAutoTrips: 0, isFlorida: false });
ok(empty.weights.length === 0 && empty.zones.length === 0, "empty ctx yields empty summary, no throw");

console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] 2.2 Register the check-script in `package.json`. Read `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/package.json` to confirm the `check:caltran-gravity` line, then add immediately after it:

```json
    "check:trip-distribution": "node ./scripts/verify-trip-distribution.mjs",
```

- [ ] 2.3 Run it to confirm RED: `cd /Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server && pnpm run check:trip-distribution`. Expected: FAIL (module not found / `computeTripDistribution` undefined). Proves the test runs and currently fails.

- [ ] 2.4 Create `trip-distribution.ts` with the full gravity strategy + stubs. **The leaf module does NOT compute `refVolume` or `baseVoverC` — it consumes the pre-built `demandZones`/`gravityZones` directly.** Full content:

```ts
// Region-agnostic trip-distribution layer.
// PR1: fully implements the "gravity" strategy (wrapping four-step for most
// regions and Caltran mass/distance for Florida). "analogy" and "surrogate"
// are stubs that fall back to gravity (built in PR2/PR3).
//
// BYTE-IDENTITY CONTRACT: the caller (tis.ts) builds the EXACT demandZones and
// gravityZones it builds today — including refVolume and the
// clamp(mass/refVolume, 0.05, 1.0) baseVoverC. This module NEVER re-derives
// refVolume/baseVoverC; it passes the pre-built zones straight to
// distributeAndAssign / caltranGravityShares so weights are byte-identical to
// origin/main.
//
// Pure leaf module: imports ONLY other pure libs so it loads under Node's
// native TS stripping in the verify-*.mjs check-scripts.
import {
  distributeAndAssign,
  GAMMA_FRICTION,
  type DemandZone,
} from "./four-step-model";
import {
  caltranGravityShares,
  directionalMultipliers,
  rollupByCardinal,
  sectorPairs,
  bearingToCardinal,
  CALTRAN_GRAVITY_BETA,
  type CardinalDir,
  type GravityShare,
} from "./caltran-gravity";

export type DistributionMethod = "gravity" | "analogy" | "surrogate";

export type DistZone = {
  id: string;
  name: string;
  distanceMi: number;
  bearingDeg: number;
  cardinal: CardinalDir;
  mass: number; // gross attraction proxy M
  term: number; // un-normalized pull M/(d^β · d_site)
  weight: number; // Σ = 1 spatial distribution weight
  sharePct: number; // Σ = 100
};

export type TripDistributionSummary = {
  method: DistributionMethod;
  methodLabel: string;
  basis: string;
  betaExponent: number;
  massBasis: string;
  /** Candidate-ordered (aligned 1:1 to ctx.meta / demandZones). Σ ≈ 1. */
  weights: number[];
  /** Candidate-ordered; mean-1; all-1 except FL Caltran directional. */
  loadMultipliers: number[];
  /** SHARE-SORTED (descending sharePct) — matches origin/main flGravity.zones. */
  zones: DistZone[];
  byDirection: Record<CardinalDir, number>; // Σ = 100
  sectors: Record<string, number>; // 4 quadrant pairs, Σ = 100
  provenance?: {
    source: string;
    matched?: string;
    blendWeights?: Record<string, number>;
  };
};

/** Pre-built Caltran gravity zone (mirrors tis.ts gravityZones exactly). */
export type GravityZoneInput = {
  id: string;
  mass: number;
  distanceMi: number;
  bearingDeg: number;
};

/** Display metadata per candidate, candidate-ordered. */
export type DistributionCandidateMeta = {
  id: string;
  name: string;
  distanceMi: number;
  bearingDeg: number;
  mass: number;
};

export type TripDistributionCtx = {
  /** Candidate-ordered display metadata. */
  meta: DistributionCandidateMeta[];
  /** Pre-built by the caller EXACTLY as tis.ts does (with clamped baseVoverC). */
  demandZones: DemandZone[];
  /** Pre-built by the caller EXACTLY as tis.ts does. */
  gravityZones: GravityZoneInput[];
  pmExternalAutoTrips: number;
  isFlorida: boolean;
};

const METHOD_LABEL: Record<DistributionMethod, string> = {
  gravity: "Gravity Model",
  analogy: "Analogous-Site Distribution",
  surrogate: "Surrogate (Market-Area) Distribution",
};

const GRAVITY_MASS_BASIS =
  "intersection through-volume (AADT × K-factor) as the destination-activity attraction proxy";

// Build the region-neutral zone rows + directional rollups.
// weights/terms/masses are CANDIDATE-ORDERED (aligned to ctx.meta). The returned
// zones[] is SHARE-SORTED.
function buildZones(
  ctx: TripDistributionCtx,
  weights: number[],
  terms: number[],
  masses: number[],
): {
  zones: DistZone[];
  byDirection: Record<CardinalDir, number>;
  sectors: Record<string, number>;
} {
  const zones: DistZone[] = ctx.meta.map((c, i) => ({
    id: c.id,
    name: c.name,
    distanceMi: c.distanceMi,
    bearingDeg: c.bearingDeg,
    cardinal: bearingToCardinal(c.bearingDeg),
    mass: masses[i] ?? 0,
    term: terms[i] ?? 0,
    weight: weights[i] ?? 0,
    sharePct: (weights[i] ?? 0) * 100,
  }));
  zones.sort((a, b) => b.sharePct - a.sharePct);

  // Reuse Caltran rollups by expressing each zone as a GravityShare-shaped row.
  const shareRows: GravityShare[] = zones.map((z) => ({
    id: z.id,
    mass: z.mass,
    distanceMi: z.distanceMi,
    bearingDeg: z.bearingDeg,
    term: z.term,
    share: z.weight,
    sharePct: z.sharePct,
  }));
  const byDirection = rollupByCardinal(shareRows);
  const sectors = sectorPairs(byDirection);
  return { zones, byDirection, sectors };
}

// Pure gravity: four-step for non-FL, Caltran mass/distance for FL.
// Consumes the caller's pre-built demandZones/gravityZones — no re-derivation.
function gravityCore(ctx: TripDistributionCtx): {
  weights: number[];
  loadMultipliers: number[];
  terms: number[];
  masses: number[];
  betaExponent: number;
  massBasis: string;
} {
  const n = ctx.meta.length;
  const masses = ctx.meta.map((c) => c.mass);

  if (ctx.isFlorida) {
    const gShares = caltranGravityShares(ctx.gravityZones);
    const gMults = directionalMultipliers(ctx.gravityZones);
    const loadMultipliers = new Array<number>(n).fill(1);
    for (let i = 0; i < gMults.length; i++) {
      loadMultipliers[i] = gMults[i]!.multiplier;
    }
    return {
      weights: gShares.map((s) => s.share),
      loadMultipliers,
      terms: gShares.map((s) => s.term),
      masses,
      betaExponent: CALTRAN_GRAVITY_BETA,
      massBasis: GRAVITY_MASS_BASIS,
    };
  }

  if (n === 0) {
    return { weights: [], loadMultipliers: [], terms: [], masses, betaExponent: 1, massBasis: GRAVITY_MASS_BASIS };
  }

  const fourStep = distributeAndAssign(ctx.demandZones, ctx.pmExternalAutoTrips, {
    gamma: GAMMA_FRICTION.hbw,
  });
  // Zero-mass guard: if four-step produced a degenerate all-zero split, fall to uniform.
  // NOTE: unreachable for n>0 — distributeAndAssign always returns a normalized split
  // (Σ=1, or its own 1/n fallback), so this never fires and never diverges from
  // origin/main's direct `weights = fourStep.weights`. Kept as a defensive net only.
  let weights = fourStep.weights;
  const sum = weights.reduce((s, w) => s + (Number.isFinite(w) ? w : 0), 0);
  if (!(sum > 0)) {
    weights = new Array<number>(n).fill(n > 0 ? 1 / n : 0);
  }
  // Terms are not surfaced by four-step; use weight as the display term proxy.
  return {
    weights,
    loadMultipliers: new Array<number>(n).fill(1),
    terms: weights.map((w) => w),
    masses,
    betaExponent: 1,
    massBasis: GRAVITY_MASS_BASIS,
  };
}

export function computeTripDistribution(
  method: DistributionMethod | undefined,
  ctx: TripDistributionCtx,
): TripDistributionSummary {
  const requested: DistributionMethod = method ?? "gravity";
  const core = gravityCore(ctx);
  const { zones, byDirection, sectors } = buildZones(
    ctx,
    core.weights,
    core.terms,
    core.masses,
  );

  let basis: string;
  if (requested === "gravity") {
    basis = ctx.isFlorida
      ? "Caltran mass/distance gravity model over study-area attraction zones."
      : "NCHRP-716 gamma-friction gravity model (production-constrained) over study-area attraction zones.";
  } else {
    basis =
      `${METHOD_LABEL[requested]} is not yet implemented (PR2/PR3); ` +
      `falling back to the gravity model for this study.`;
  }

  return {
    method: requested,
    methodLabel: METHOD_LABEL[requested],
    basis,
    betaExponent: core.betaExponent,
    massBasis: core.massBasis,
    weights: core.weights,
    loadMultipliers: core.loadMultipliers,
    zones,
    byDirection,
    sectors,
  };
}
```

- [ ] 2.5 Run to confirm GREEN: `cd /Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server && pnpm run check:trip-distribution`. Expected: `ALL PASS`, exit 0. If the `rollupByCardinal(shareRows)` line rejects the `GravityShare[]` shape, read `caltran-gravity.ts` lines 146–163 to confirm `rollupByCardinal`'s parameter type and adjust the `shareRows` field set to match (do NOT change the numeric result; keep the type import rather than falling back to `as never`).

- [ ] 2.6 Typecheck the package: `cd /Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server && pnpm run typecheck`. Expected: no errors.

- [ ] 2.7 Commit (explicit paths only):
```
git -C /Users/geraldkogon/tis-wt-tripdist add artifacts/tis-api-server/src/lib/trip-distribution.ts artifacts/tis-api-server/scripts/verify-trip-distribution.mjs artifacts/tis-api-server/package.json
git -C /Users/geraldkogon/tis-wt-tripdist commit -m "$(cat <<'EOF'
Add trip-distribution.ts unified layer (gravity strategy + analogy/surrogate stubs)

Leaf consumes caller-built demandZones/gravityZones so gravity weights are
byte-identical to origin/main. Check-script reconstructs refVolume + baseVoverC
exactly as tis.ts to prove equivalence.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Add `distributionMethod` to OpenAPI + optional `tripDistribution` on `TisReport`, run codegen

**Files:**
- Modify `/Users/geraldkogon/tis-wt-tripdist/lib/tis-api-spec/openapi.yaml` (add `TisDistributionMethod` + `TisTripDistribution*` schemas near the other `Tis*` schemas; add `distributionMethod` to `TisRequest.properties`; add `tripDistribution` to `TisReport.properties`)
- Regenerates (do NOT hand-edit): `/Users/geraldkogon/tis-wt-tripdist/lib/tis-api-zod/src/generated/**`, `/Users/geraldkogon/tis-wt-tripdist/lib/tis-api-client-react/src/generated/**`

**Interfaces:**
- Produces (spec): `TisDistributionMethod` string enum `[gravity, analogy, surrogate]`; optional `TisRequest.distributionMethod` ($ref); optional `TisReport.tripDistribution` ($ref to `TisTripDistribution`).
- Produces (generated): `TisDistributionMethod` enum-as-const + `TisRequest.distributionMethod?` + `TisReport.tripDistribution?` in `api.schemas.ts` and zod `types/`.

- [ ] 3.1 Locate the anchors by symbol (line numbers may have drifted): `git -C /Users/geraldkogon/tis-wt-tripdist grep -n "TisWeather:" -- lib/tis-api-spec/openapi.yaml`, `git -C /Users/geraldkogon/tis-wt-tripdist grep -n "TisRequest:" -- lib/tis-api-spec/openapi.yaml`, `git -C /Users/geraldkogon/tis-wt-tripdist grep -n "TisReport:" -- lib/tis-api-spec/openapi.yaml`. Then Read the `TisRequest` properties block, the `TisReport` properties block, and a nearby `Tis*` schema (e.g. `TisWeather`) to match indentation exactly.

- [ ] 3.2 Add the `TisDistributionMethod` enum schema immediately after the `TisWeather` schema block (match its 4-space `Tis*` schema indentation):

```yaml
    TisDistributionMethod:
      type: string
      enum: [gravity, analogy, surrogate]
      description: >-
        Directional trip-distribution method. gravity = mass/distance or
        gamma-friction gravity model; analogy = analogous-site distribution
        (PR2); surrogate = market-area (pop+emp+volume) distribution (PR3).
        Defaults to gravity.
```

- [ ] 3.3 Add the optional `distributionMethod` field inside `TisRequest.properties` (place it after the `weather` `$ref` property; do NOT add it to the `required:` list). Match the surrounding property indentation:

```yaml
        distributionMethod:
          $ref: "#/components/schemas/TisDistributionMethod"
```

- [ ] 3.4 Add the `TisTripDistributionZone` + `TisTripDistribution` object schemas right after the new `TisDistributionMethod` schema from 3.2:

```yaml
    TisTripDistributionZone:
      type: object
      properties:
        id: { type: string }
        name: { type: string }
        distanceMi: { type: number }
        bearingDeg: { type: number }
        cardinal: { type: string }
        mass: { type: number }
        term: { type: number }
        weight: { type: number }
        sharePct: { type: number }
      required: [id, name, distanceMi, bearingDeg, cardinal, mass, term, weight, sharePct]
    TisTripDistribution:
      type: object
      description: Region-agnostic trip-distribution summary for the study.
      properties:
        method: { $ref: "#/components/schemas/TisDistributionMethod" }
        methodLabel: { type: string }
        basis: { type: string }
        betaExponent: { type: number }
        massBasis: { type: string }
        weights:
          type: array
          items: { type: number }
        loadMultipliers:
          type: array
          items: { type: number }
        byDirection:
          type: object
          additionalProperties: { type: number }
        sectors:
          type: object
          additionalProperties: { type: number }
        zones:
          type: array
          items: { $ref: "#/components/schemas/TisTripDistributionZone" }
      required: [method, methodLabel, basis, betaExponent, massBasis, weights, loadMultipliers, byDirection, sectors, zones]
```

- [ ] 3.5 Add the optional `tripDistribution` field inside `TisReport.properties` (place it near the other report sub-object fields, e.g. after `routeAssignment`; do NOT add to `required`):

```yaml
        tripDistribution:
          $ref: "#/components/schemas/TisTripDistribution"
```

- [ ] 3.6 Run codegen from the spec package: `cd /Users/geraldkogon/tis-wt-tripdist/lib/tis-api-spec && pnpm --filter @workspace/tis-api-spec run codegen`. Expected: orval regenerates, then `typecheck:libs` (or the package's codegen post-step) passes with exit 0. If the exact script name differs, Read `lib/tis-api-spec/package.json` `scripts` to find the codegen entry and run that.

- [ ] 3.7 Verify the generated artifacts changed as expected (codegen diff gate):
```
git -C /Users/geraldkogon/tis-wt-tripdist diff --stat lib/tis-api-zod/src/generated lib/tis-api-client-react/src/generated
git -C /Users/geraldkogon/tis-wt-tripdist grep -n "distributionMethod" -- lib/tis-api-client-react/src/generated/api.schemas.ts
git -C /Users/geraldkogon/tis-wt-tripdist grep -n "TisDistributionMethod" -- lib/tis-api-client-react/src/generated/api.schemas.ts
git -C /Users/geraldkogon/tis-wt-tripdist grep -n "tripDistribution" -- lib/tis-api-client-react/src/generated/api.schemas.ts
```
Expected: `distributionMethod?` present on the generated `TisRequest`; a `TisDistributionMethod` enum-as-const object exists; `tripDistribution?` present on generated `TisReport`.

- [ ] 3.8 Commit (explicit paths — include the regenerated dirs):
```
git -C /Users/geraldkogon/tis-wt-tripdist add lib/tis-api-spec/openapi.yaml lib/tis-api-zod/src/generated lib/tis-api-client-react/src/generated
git -C /Users/geraldkogon/tis-wt-tripdist commit -m "$(cat <<'EOF'
Add distributionMethod request enum + tripDistribution report field; regen zod/react-client

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — Wire `computeTripDistribution` into `tis.ts` (byte-identical default)

**Files:**
- Modify `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/src/lib/tis.ts`:
  - import (after line 57, `import { intersectionLoadFraction } from "./trip-loading";`)
  - `TisRequest.distributionMethod?` field (after `scopeStudyIntersections?`)
  - `DistributionMethod` re-export (after the `StudyTier` type definition)
  - `TisReport.tripDistribution?` field (after `flGravity?: FlGravitySummary;` at 581)
  - replace the inline distribution + FL block by SYMBOL boundaries (not raw line numbers) — **keep `refVolume` AND the `pmRawForAssign…pmExternalAutoForAssign` block, build `demandZones`/`gravityZones` verbatim, pass them into the leaf** (see 4.6)
  - return literal `tripDistribution: dist` (after `...(flGravity ? { flGravity } : {})` at 1576)

**Interfaces:**
- Consumes: `computeTripDistribution`, `type TripDistributionSummary`, `type DistributionMethod`, `type TripDistributionCtx`, `type GravityZoneInput`, `type DistributionCandidateMeta` from `./trip-distribution`; existing locals `candidates` (`Array<{ sig: AnalyzerIntersection; distanceMi: number }>`), `pmExternalAutoForAssign`, `FALLBACK_VOLUME`, `refVolume`, `region`, `req`, `clamp`, `bearingDeg`, `isFloridaRegion`, `FlGravitySummary`.
- Produces: reassigned locals `weights`, `flLoadMultiplier`, `flGravity`; new local `dist: TripDistributionSummary`; `result.tripDistribution`.

- [ ] 4.1 Read the exact block to replace: Read `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/src/lib/tis.ts` lines 1290–1405. Confirm against recon2: `FALLBACK_VOLUME` at 1292, `refVolume` at 1293–1296, `demandZones` at 1297–1305, `distributeAndAssign` at 1312, `let weights = fourStep.weights;` at 1321, `flGravity`/`flLoadMultiplier` init 1322–1323, FL block 1324–1360, `loadWeights` at 1365–1367. Also confirm the candidate field names: `c.sig.id`, `c.sig.name`, `c.sig.totalVolume`, `c.sig.latitude`, `c.sig.longitude`, `c.distanceMi`, and site coords `req.latitude` / `req.longitude`.

- [ ] 4.2 Add the import after line 57:

```ts
import {
  computeTripDistribution,
  type DistributionMethod,
  type TripDistributionSummary,
  type TripDistributionCtx,
  type GravityZoneInput,
  type DistributionCandidateMeta,
} from "./trip-distribution";
```

- [ ] 4.3 Add the `distributionMethod` field to `TisRequest`. Locate `scopeStudyIntersections?: boolean;` (`git -C /Users/geraldkogon/tis-wt-tripdist grep -n "scopeStudyIntersections?: boolean;" -- artifacts/tis-api-server/src/lib/tis.ts`) and insert immediately after it:

```ts
  distributionMethod?: DistributionMethod;
```

- [ ] 4.4 Re-export the `DistributionMethod` type for callers that import from `tis.ts`. Insert after the `StudyTier` **type definition** (`export type StudyTier = …`, ~line 375–376):

```ts
export type { DistributionMethod } from "./trip-distribution";
```

- [ ] 4.5 Add the optional `tripDistribution` field to `TisReport`. Insert immediately after `flGravity?: FlGravitySummary;` (line 581):

```ts
  /** Region-agnostic trip-distribution summary (all regions). */
  tripDistribution?: TripDistributionSummary;
```

- [ ] 4.6 Replace the inline distribution + FL block **by symbol boundaries, NOT by raw line range** (line numbers below are advisory — relocate by the named symbols). **CRITICAL:** the old block interleaves a PM-trip computation (`const pmRawForAssign …` / `const pmPassByForAssign …` / `const pmInternalForAssign …` / `const pmExternalAutoForAssign = …`, ~1306–1311) that has LIVE downstream consumers — at ~1377 (`selectStudyIntersectionIdx`) and ~1393 (route-assignment: `(weights[i] ?? 0) * pmExternalAutoForAssign`). That block MUST survive. Perform the edit as three precise operations:
  - **(a)** DELETE the old `const demandZones = candidates.map(( … ))` block (from `const demandZones: DemandZone[] = candidates.map((c) => ({` through its closing `}));`).
  - **(b)** KEEP the `const pmRawForAssign … const pmExternalAutoForAssign = …` computation intact — do NOT delete it.
  - **(c)** DELETE the old `const fourStep = distributeAndAssign(...)` line, the `let weights = fourStep.weights;` init, and the entire FL `flGravity`/`flLoadMultiplier` block (through the closing `}` of the FL `flGravity = {...}` assignment).
  - **(d)** INSERT the following NEW `demandZones`/`gravityZones` rebuild + `distMeta` + `distCtx` + `const dist = computeTripDistribution(...)` + `weights`/`flLoadMultiplier`/`flGravity` derivation **AFTER the `const pmExternalAutoForAssign = …` line** so `pmExternalAutoForAssign` is in scope for `distCtx` and still resolves at ~1377 and ~1393.

The inserted code keeps `refVolume` intact above it and builds `demandZones`/`gravityZones` verbatim as before so weights are byte-identical:

```ts
    // Build the four-step demand zones EXACTLY as before (refVolume-normalized
    // baseVoverC) so the unified layer reproduces origin/main weights byte-for-byte.
    const demandZones: DemandZone[] = candidates.map((c) => ({
      id: c.sig.id,
      attraction: c.sig.totalVolume > 0 ? c.sig.totalVolume : FALLBACK_VOLUME,
      distanceMi: c.distanceMi,
      baseVoverC: clamp((c.sig.totalVolume > 0 ? c.sig.totalVolume : FALLBACK_VOLUME) / refVolume, 0.05, 1.0),
    }));
    // Caltran gravity zones (mass + bearing) built exactly as the FL branch did.
    const gravityZones: GravityZoneInput[] = candidates.map((c) => ({
      id: c.sig.id,
      mass: c.sig.totalVolume > 0 ? c.sig.totalVolume : FALLBACK_VOLUME,
      distanceMi: c.distanceMi,
      bearingDeg: bearingDeg(
        { lat: req.latitude, lon: req.longitude },
        { lat: c.sig.latitude, lon: c.sig.longitude },
      ),
    }));
    const distMeta: DistributionCandidateMeta[] = candidates.map((c, i) => ({
      id: c.sig.id,
      name: c.sig.name,
      distanceMi: c.distanceMi,
      bearingDeg: gravityZones[i]!.bearingDeg,
      mass: gravityZones[i]!.mass,
    }));
    // Unified trip-distribution layer. Default (unset method) resolves to the
    // gravity strategy — four-step for most regions, Caltran mass/distance for
    // FL — producing byte-identical weights/loadMultipliers/flGravity to the
    // prior inline path (the leaf consumes the pre-built zones above).
    const distCtx: TripDistributionCtx = {
      meta: distMeta,
      demandZones,
      gravityZones,
      pmExternalAutoTrips: pmExternalAutoForAssign,
      isFlorida: isFloridaRegion(region),
    };
    const dist = computeTripDistribution(req.distributionMethod, distCtx);
    let weights = dist.weights;
    const flLoadMultiplier = dist.loadMultipliers;
    // Preserve the FL renderer's flGravity contract from the unified summary
    // (share-sorted zones, matching origin/main).
    const flGravity: FlGravitySummary | undefined = isFloridaRegion(region)
      ? {
          betaExponent: dist.betaExponent,
          massBasis: dist.massBasis,
          zones: dist.zones.map((z) => ({
            id: z.id,
            name: z.name,
            distanceMi: z.distanceMi,
            bearingDeg: z.bearingDeg,
            cardinal: z.cardinal,
            mass: z.mass,
            term: z.term,
            sharePct: z.sharePct,
          })),
          byDirection: dist.byDirection,
          sectors: dist.sectors,
        }
      : undefined;
```

**IMPORTANT — declaration keywords.** The recon shows origin/main declared `let weights = fourStep.weights;` (reassigned in the FL branch) and `let flGravity` / `const flLoadMultiplier`. In the replacement above, `weights` stays `let` (route assignment reads it at 1393; the FL reassignment is now internal to the leaf so nothing else reassigns `weights` — if `pnpm run typecheck` reports `weights` "is never reassigned", change it to `const`). `flLoadMultiplier` and `flGravity` are now `const`. Verify the original `const DemandZone` import (tis.ts:28 `import { distributeAndAssign, modeChoiceLogit, GAMMA_FRICTION, type DemandZone }`) is still present — `DemandZone` is still used by the `demandZones` type annotation above; `distributeAndAssign`/`GAMMA_FRICTION` may become unused after this task. If typecheck flags them unused, remove only the now-unused named imports from line 28 (keep `modeChoiceLogit` and any still-used symbol) and keep `type DemandZone`. Likewise the Caltran imports at 29–36 (`caltranGravityShares`, `directionalMultipliers`, `rollupByCardinal`, `sectorPairs`, `bearingToCardinal`, `CALTRAN_GRAVITY_BETA`) are now only used inside the leaf — if typecheck flags them unused in tis.ts, remove the now-unused ones but KEEP `bearingToCardinal` if it is used elsewhere and KEEP any type still referenced (e.g. `CardinalDir` via `FlGravityZone`). Do a targeted `git grep -n <symbol> -- artifacts/tis-api-server/src/lib/tis.ts` before removing each.

- [ ] 4.6a **Post-edit verification (pmExternalAutoForAssign survived).** Run `git -C /Users/geraldkogon/tis-wt-tripdist grep -n "pmExternalAutoForAssign" -- artifacts/tis-api-server/src/lib/tis.ts`. Expected: EXACTLY ONE definition (`const pmExternalAutoForAssign = …`) plus its two downstream consumers still present — one in the `selectStudyIntersectionIdx` region (~1377) and one in the route-assignment expression `(weights[i] ?? 0) * pmExternalAutoForAssign` (~1393) — AND its new use inside `distCtx` (`pmExternalAutoTrips: pmExternalAutoForAssign`). If the definition is missing (deleted by mistake) or appears more than once (accidentally re-declared), STOP and fix before typechecking. Remember line numbers are advisory — confirm by the surrounding symbols, not the raw line.

- [ ] 4.7 Confirm the `loadWeights` / `studyLoads` block (1361–1379) is UNCHANGED and still reads `flLoadMultiplier[i]`. Read `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/src/lib/tis.ts` around the (now line-shifted) `loadWeights` definition to verify no edit is needed there. It must still be `clamp(intersectionLoadFraction(c.distanceMi) * flLoadMultiplier[i]!, 0, 1)`.

- [ ] 4.8 Add `tripDistribution` to the return literal. Locate `...(flGravity ? { flGravity } : {}),` (`git -C /Users/geraldkogon/tis-wt-tripdist grep -n "flGravity ? { flGravity }" -- artifacts/tis-api-server/src/lib/tis.ts`) and insert immediately after it:

```ts
        tripDistribution: dist,
```

- [ ] 4.9 Typecheck the package: `cd /Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server && pnpm run typecheck`. Expected: no errors. If errors reference removed block-locals (`fourStep`, `gShares`, `gMults`, `byDirection`, `zones` from the deleted FL block), grep to confirm they had no consumers outside the deleted block (recon says they were block-local); if any do have outside consumers, STOP and re-inspect.

- [ ] 4.10 Re-run the leaf check for no regression: `cd /Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server && pnpm run check:trip-distribution`. Expected `ALL PASS`.

- [ ] 4.11 Commit:
```
git -C /Users/geraldkogon/tis-wt-tripdist add artifacts/tis-api-server/src/lib/tis.ts
git -C /Users/geraldkogon/tis-wt-tripdist commit -m "$(cat <<'EOF'
Wire computeTripDistribution into tis.ts; zones pre-built in tis.ts for byte-identity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Shared renderer `pdf-export-distribution.ts` (Path A: self-contained), FL prose reproduced exactly

**Files:**
- Create `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/src/lib/pdf-export-distribution.ts`

**Interfaces:**
- Consumes: `result.tripDistribution` (`TripDistributionSummary`), `result.affectedIntersections` (rows with `name`/`signalId`, `distanceMi`, `addedTripsPmPeak`), `result.periodReports` (for AM column). Structural `any`-typed `result` per repo convention.
- Produces: `export function renderTripDistributionSection(doc, result, opts): void` where `opts = { subsectionNumber; assignmentNumber?; headingFn: (doc, title) => void; cap?; intersections?; periods?; flavor?: "fl" | "generic" }`.

Path A rationale (from recon): `pdf-export.ts` exports only `renderStudyPdf`; sibling renderers deliberately re-declare primitives to stay merge-safe. This file follows that convention — duplicate the primitives `table()` closes over. **`headingFn` convention: 2-arg `(doc, title) => void`** — matching `gaSubsection`/`caSubsection`/`nySubsection`. The generic-state `stateSub`/`stateSection` are 1-arg closures; Task 7.3 wraps them.

**Complete list of module-level symbols `table()` closes over (from recon2), all copied inline here:** `PAGE_MARGIN` (=50), `velocityPaletteActive` (hardcode `false` — the shared section is never used in London), `VELOCITY_FILL` (=`"#ECF5E9"`), `VELOCITY_GREEN` (=`"#8EC57C"`). `PADX`/`PADY` are local to `table()` (=4 each). `TEXT_GRAY` (=`"#6b7280"`) and `fmtNum` are needed by the captions/cells, not by `table()` itself. Hardcoded literals inside `table()`: `"#f3f4f6"`, `"#e5e7eb"`, `13`, `40`.

- [ ] 5.1 Re-read the reference blocks to copy verbatim: Read `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/src/lib/pdf-export.ts` lines 7759–7853 (FL §6.1/§6.2 — the exact prose, captions, `moveDown(0.2)` calls) and lines 8870–8964 (`TableSpec` + `table()`) and 8990–8994 (`fmtNum`). The `table()` and `fmtNum` bodies must be pasted byte-for-byte.

- [ ] 5.2 Create `pdf-export-distribution.ts`. Full content — the `table()` body is the verbatim recon2 implementation; the FL prose/caption strings are reproduced verbatim so `flavor: "fl"` is byte-identical to origin/main:

```ts
// Shared trip-distribution PDF section, rendered in every US regional renderer.
// Self-contained (Path A): re-declares the tiny primitives it needs so it stays
// free of cross-file coupling that breaks under merge conflicts — same
// convention as pdf-export-ny.ts / pdf-export-states.ts.
//
// FL byte-identity: when opts.flavor === "fl" this emits Florida's exact §6.1/§6.2
// prose, captions (incl. FDOT TAH §2.7), and doc.moveDown(0.2) spacing so the
// refactored FL section is byte-identical to origin/main.
import type { TripDistributionSummary } from "./trip-distribution";

// ---- primitives table() closes over (copied per Path A) ----
const PAGE_MARGIN = 50;
// The shared section is NEVER used in London, so the Velocity palette is off.
const velocityPaletteActive = false as boolean;
const VELOCITY_FILL = "#ECF5E9";
const VELOCITY_GREEN = "#8EC57C";
const TEXT_GRAY = "#6b7280";

type TableSpec = {
  headers: string[];
  widths: number[];
  align?: Array<"left" | "right" | "center">;
  rows: string[][];
};

// ---- fmtNum: VERBATIM from pdf-export.ts:8990 ----
function fmtNum(n: any, decimals: number = 0): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const num = Number(n);
  return decimals > 0 ? num.toFixed(decimals) : Math.round(num).toLocaleString();
}

// ---- table: VERBATIM from pdf-export.ts:8881 ----
function table(doc: PDFKit.PDFDocument, spec: TableSpec) {
  const { headers, widths, rows: dataRows } = spec;
  const align = spec.align ?? headers.map(() => "left" as const);
  const startX = PAGE_MARGIN;
  const totalW = widths.reduce((s, w) => s + w, 0);
  const PADX = 4;
  const PADY = 4;
  const velo = velocityPaletteActive;
  const headerFill = velo ? VELOCITY_FILL : "#f3f4f6";
  const headerText = velo ? VELOCITY_GREEN : "black";
  const sepColor = velo ? VELOCITY_GREEN : "#e5e7eb";

  const measureRow = (cells: string[], isHeader: boolean): number => {
    doc.font(isHeader ? "bold" : "body").fontSize(9);
    let maxH = 0;
    for (let i = 0; i < cells.length; i++) {
      const w = (widths[i] ?? 60) - PADX * 2;
      const h = doc.heightOfString(cells[i] ?? "", { width: w, align: align[i] ?? "left" });
      if (h > maxH) maxH = h;
    }
    return Math.max(13, maxH) + PADY * 2;
  };

  const drawRow = (cells: string[], y: number, isHeader: boolean, h: number) => {
    if (isHeader) {
      doc.rect(startX, y, totalW, h).fill(headerFill);
      if (velo) {
        doc.save().strokeColor(VELOCITY_GREEN).lineWidth(0.75)
          .moveTo(startX, y + h).lineTo(startX + totalW, y + h).stroke().restore();
      }
    }
    let x = startX;
    doc.font(isHeader ? "bold" : "body").fontSize(9).fillColor(isHeader ? headerText : "black");
    for (let i = 0; i < cells.length; i++) {
      const w = widths[i] ?? 60;
      doc.text(cells[i] ?? "", x + PADX, y + PADY, {
        width: w - PADX * 2,
        align: align[i] ?? "left",
      });
      x += w;
    }
  };

  let y = doc.y;
  const headerH = measureRow(headers, true);
  const firstRowH = dataRows.length > 0 ? measureRow(dataRows[0], false) : 0;
  if (y + headerH + firstRowH > doc.page.height - PAGE_MARGIN - 40) {
    doc.addPage();
    y = doc.y;
  }
  drawRow(headers, y, true, headerH);
  y += headerH;

  for (const r of dataRows) {
    const rh = measureRow(r, false);
    if (y + rh > doc.page.height - PAGE_MARGIN - 40) {
      doc.addPage();
      y = doc.y;
      const hh = measureRow(headers, true);
      drawRow(headers, y, true, hh);
      y += hh;
    }
    drawRow(r, y, false, rh);
    doc.strokeColor(sepColor).lineWidth(0.5)
      .moveTo(startX, y + rh).lineTo(startX + totalW, y + rh).stroke();
    y += rh;
  }
  doc.y = y + 4;
  doc.x = PAGE_MARGIN;
}

const QUADRANT_LABEL: Record<string, string> = {
  "NNE+ENE": "Northeast (NNE + ENE)",
  "ESE+SSE": "Southeast (ESE + SSE)",
  "SSW+WSW": "Southwest (SSW + WSW)",
  "WNW+NNW": "Northwest (WNW + NNW)",
};

const WORKSHEET_CAP = 20;

export type TripDistributionSectionOpts = {
  /** e.g. "6.1", "5.1", "4.3" — the distribution subsection number. */
  subsectionNumber: string;
  /** e.g. "6.2", "5.2" — the assignment subsection number. Omit to skip the
   *  assignment sub-block entirely (used where the renderer has its own). */
  assignmentNumber?: string;
  /** Renderer-native subsection heading fn (gaSubsection/caSubsection/nySubsection). */
  headingFn: (doc: PDFKit.PDFDocument, title: string) => void;
  /** Worksheet row cap (default 20). */
  cap?: number;
  /** affectedIntersections rows for the assignment table (PM). */
  intersections?: any[];
  /** periodReports, to pull the am_peak column. */
  periods?: any[];
  /** "fl" → reproduce Florida's exact prose/captions/spacing (byte-identical);
   *  "generic" (default) → the region-neutral wording for the new sections. */
  flavor?: "fl" | "generic";
};

// -- FL VERBATIM narrative (pdf-export.ts:7770), templated on the summary fields
//    the original read off flg (betaExponent, massBasis). --
function flDistributionNarrative(td: TripDistributionSummary): string {
  return (
    `Project trips are distributed to the surrounding study-area zones with the gravity model used in the Caltran Engineering HCA Westside reference TIS, adopted here as the Florida distribution standard. Each zone attracts trips in proportion to its mass and inversely with its distance from the site — term = M / (d^${td.betaExponent} · d_site) — normalized so the zone shares sum to 100%. Zone mass M is the ${td.massBasis}; d_site (the site zone's own distance normalizer) is 1. The resulting shares set the directional distribution below and drive the project-trip assignment in §6.2.`
  );
}

// -- FL VERBATIM worksheet caption (pdf-export.ts:7807). --
function flWorksheetCaption(td: TripDistributionSummary, cap: number): string {
  const n = td.zones.length;
  return (
    `Screening-grade gravity distribution over ${n} study-area zone${n === 1 ? "" : "s"}${n > cap ? ` (top ${cap} by trip share shown)` : ""}. For formal submittal the adopted regional MPO/TPO travel-demand-model distribution and the run identifier are confirmed at the methodology meeting per FDOT TAH §2.7; this gravity worksheet documents the screening basis.`
  );
}

// -- FL VERBATIM assignment caption (pdf-export.ts:7847). --
const FL_ASSIGNMENT_CAPTION =
  "AM- and PM-peak project trips assigned to each study intersection from the §6.1 gravity distribution: the directional shares orient the loading toward the high-share sectors, while distance-decay from the site sets the magnitude that passes through each intersection. Entering/exiting splits at each intersection follow the site's period directional split.";

export function renderTripDistributionSection(
  doc: PDFKit.PDFDocument,
  result: any,
  opts: TripDistributionSectionOpts,
): void {
  const td = result?.tripDistribution as TripDistributionSummary | undefined;
  if (!td || !Array.isArray(td.zones) || td.zones.length === 0) return;

  const cap = opts.cap ?? WORKSHEET_CAP;
  const isFl = opts.flavor === "fl";

  // --- Distribution heading + method/basis narrative ---
  opts.headingFn(
    doc,
    isFl
      ? `${opts.subsectionNumber} Trip Distribution — Gravity Model`
      : `${opts.subsectionNumber} Trip Distribution — ${td.methodLabel}`,
  );
  doc.font("body").fontSize(10).fillColor("black").text(
    isFl
      ? flDistributionNarrative(td)
      : `The trip distribution uses the ${td.methodLabel.toLowerCase()} ` +
          `(term = M / (d^${td.betaExponent} · d_site); mass basis: ${td.massBasis}). ` +
          `Shares are normalized to 100% of project trips and drive the trip ` +
          `assignment below. Basis: ${td.basis}`,
    { paragraphGap: 6 },
  );

  // --- Directional (4 sector-pair) table ---
  const sectorRows: string[][] = Object.entries(td.sectors ?? {}).map(
    ([k, v]) => [QUADRANT_LABEL[k] ?? k, `${(Number(v) || 0).toFixed(0)}%`],
  );
  if (sectorRows.length > 0) {
    table(doc, {
      headers: ["Directional sector", "Share of project trips"],
      widths: [300, 180],
      align: ["left", "right"],
      rows: sectorRows,
    });
    doc.moveDown(0.2);
  }

  // --- Gravity worksheet table (top-N by share) ---
  const wsZones = td.zones.slice(0, cap);
  table(doc, {
    headers: ["Study-area zone", "Dir.", "Distance (mi)", "Mass (M)", "Gravity term", "Trip share"],
    widths: [190, 45, 75, 75, 75, 65],
    align: ["left", "center", "right", "right", "right", "right"],
    rows: wsZones.map((z) => [
      z.name ?? z.id ?? "—",
      String(z.cardinal ?? "—"),
      fmtNum(z.distanceMi, 2),
      fmtNum(Math.round(Number(z.mass) || 0)),
      fmtNum(Number(z.term) || 0, 1),
      `${(Number(z.sharePct) || 0).toFixed(2)}%`,
    ]),
  });
  doc.moveDown(0.2);

  // --- Worksheet caption ---
  doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
    isFl
      ? flWorksheetCaption(td, cap)
      : `${td.zones.length} study-area zone(s)` +
          (td.zones.length > cap ? ` (top ${cap} by trip share shown)` : "") +
          ". Screening-grade distribution; not a calibrated regional model.",
    { paragraphGap: 6 },
  );
  doc.fillColor("black");

  // --- Assignment sub-block (only when assignmentNumber is provided) ---
  const intersections: any[] = opts.intersections ?? result?.affectedIntersections ?? [];
  const assignRows = intersections.filter((it) => Number.isFinite(Number(it?.addedTripsPmPeak)));
  // FL byte-identity: origin/main (pdf-export.ts:7814) emits the "6.2 Project
  // Trip Assignment" heading UNCONDITIONALLY (outside the assignRows guard), then
  // only the table when rows exist. For flavor "fl" reproduce that: emit the
  // heading whenever assignmentNumber is set, and gate ONLY the table + caption
  // on assignRows.length > 0. For the generic flavor, keep the combined guard.
  if (isFl && opts.assignmentNumber) {
    opts.headingFn(doc, `${opts.assignmentNumber} Project Trip Assignment`);
  }
  if (opts.assignmentNumber && assignRows.length > 0) {
    if (!isFl) {
      opts.headingFn(doc, `${opts.assignmentNumber} Project Trip Assignment`);
    }
    const totalPm = assignRows.reduce((s, it) => s + (Number(it.addedTripsPmPeak) || 0), 0) || 1;
    const periods: any[] = opts.periods ?? result?.periodReports ?? [];
    const amRep = periods.find((p) => p?.period === "am_peak");
    const amBySig = new Map<string, number>(
      (Array.isArray(amRep?.affectedIntersections) ? amRep.affectedIntersections : []).map(
        (it: any) => [String(it.signalId), Number(it.addedTripsPmPeak) || 0],
      ),
    );
    const dirBySig = new Map<string, string>(
      td.zones.map((z) => [String(z.id), String(z.cardinal ?? "—")]),
    );
    table(doc, {
      headers: ["Study intersection", "Dir.", "Distance (mi)", "AM trips", "PM trips", "Share of project"],
      widths: [190, 45, 75, 65, 65, 80],
      align: ["left", "center", "right", "right", "right", "right"],
      rows: assignRows.map((it: any) => {
        const pm = Number(it.addedTripsPmPeak) || 0;
        const am = amBySig.get(String(it.signalId));
        return [
          it.name ?? it.signalId ?? "—",
          dirBySig.get(String(it.signalId)) ?? "—",
          fmtNum(it.distanceMi, 2),
          am == null ? "—" : fmtNum(am),
          fmtNum(pm),
          `${((pm / totalPm) * 100).toFixed(1)}%`,
        ];
      }),
    });
    doc.moveDown(0.2);
    doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
      isFl
        ? FL_ASSIGNMENT_CAPTION
        : "Project trips assigned to each study intersection from the distribution shares above: the directional shares orient the loading toward the high-share sectors, distance-decayed to each approach.",
      { paragraphGap: 6 },
    );
    doc.fillColor("black");
  }
}
```

- [ ] 5.3 Isolated typecheck of the new file: `cd /Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server && npx tsc --noEmit --skipLibCheck src/lib/pdf-export-distribution.ts` (if this errors on the `PDFKit` global namespace not being in scope for a single-file compile, fall back to the package typecheck in 5.4 and note the global-type dependency). Then the package typecheck: `pnpm run typecheck`. Expected: no errors.

- [ ] 5.4 Commit:
```
git -C /Users/geraldkogon/tis-wt-tripdist add artifacts/tis-api-server/src/lib/pdf-export-distribution.ts
git -C /Users/geraldkogon/tis-wt-tripdist commit -m "$(cat <<'EOF'
Add shared renderTripDistributionSection (self-contained; FL flavor byte-identical)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Refactor FL §6.1/§6.2 onto the shared renderer (byte-identical)

**Files:**
- Modify `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/src/lib/pdf-export.ts`:
  - import (next to the `renderDiurnalCharts` import ~line 33)
  - `renderTisFlorida` §6.1/§6.2 block (7759–7852)

**Interfaces:**
- Consumes: `renderTripDistributionSection` from `./pdf-export-distribution`; existing FL locals `r`, `intersections` (7253), `periods` (7254), `gaSubsection` (3251).
- Produces: FL distribution section rendered via the shared fn with `flavor: "fl"`; `renderDiurnalCharts(doc, r)` at 7853 preserved.

- [ ] 6.1 Read `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/src/lib/pdf-export.ts` lines 7755–7856 to confirm the exact block boundaries: §6.1 starts at the `const flg = r.flGravity;` comment/line 7759–7760, §6.2 assignment caption ends at 7850, and `renderDiurnalCharts(doc, r);` is at 7853.

- [ ] 6.2 Add the import near line 33 (next to the `renderDiurnalCharts` import):

```ts
import { renderTripDistributionSection } from "./pdf-export-distribution";
```

- [ ] 6.3 Replace the entire §6.1 + §6.2 block — from the `// --- 6.1 Trip Distribution` comment / `const flg = r.flGravity;` (7759–7760) through the end of the §6.2 assignment caption `doc.fillColor("black");` at 7852, but NOT the `renderDiurnalCharts(doc, r);` at 7853 — with:

```ts
    // §6.1/§6.2 Trip Distribution + Assignment via the shared unified renderer.
    // flavor "fl" reproduces Florida's exact prose, captions (FDOT TAH §2.7),
    // and moveDown spacing so the section is byte-identical to origin/main.
    renderTripDistributionSection(doc, r as any, {
      subsectionNumber: "6.1",
      assignmentNumber: "6.2",
      headingFn: gaSubsection,
      cap: 20,
      intersections,
      periods,
      flavor: "fl",
    });
```

NOTE on the removed origin/main fallback: origin/main used §6.1 for assignment when `flg` was absent (`gaSubsection(doc, flg ? "6.2 …" : "6.1 …")` at 7814). Now that `tripDistribution` is populated for all regions in Task 4, FL always has the gravity worksheet, so §6.1=distribution / §6.2=assignment is always correct. This is intended and matches the design goal ("gravity model in all reports"). Confirm no other code in `renderTisFlorida` references the removed local `flg` after 7852 (grep: `git -C /Users/geraldkogon/tis-wt-tripdist grep -n "flg" -- artifacts/tis-api-server/src/lib/pdf-export.ts`, restricting attention to the `renderTisFlorida` body). If any later reference exists, leave it reading `r.flGravity` (still populated for FL).

- [ ] 6.4 Confirm `renderDiurnalCharts(doc, r);` remains immediately after the replaced block. Read the surrounding 15 lines to verify.

- [ ] 6.5 Typecheck: `cd /Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server && pnpm run typecheck`. Expected: no errors.

- [ ] 6.6 Commit:
```
git -C /Users/geraldkogon/tis-wt-tripdist add artifacts/tis-api-server/src/lib/pdf-export.ts
git -C /Users/geraldkogon/tis-wt-tripdist commit -m "$(cat <<'EOF'
Refactor FL 6.1/6.2 onto shared renderTripDistributionSection (byte-identical)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Add the shared section to GA, TX, and generic `renderTisState` (renumber-free)

**Files:**
- Modify `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/src/lib/pdf-export.ts` (`renderTisGeorgia` §5.0 anchor ~1582; `renderTisTexas` §5.2 anchor ~5606)
- Modify `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/src/lib/pdf-export-states.ts` (`renderTisState` §6.0 anchor ~1327, closures `stateSection`@1083 / `stateSub`@1090)

**Interfaces:**
- Consumes: `renderTripDistributionSection`; heading fns `gaSubsection` (GA/TX, arity 2), `stateSub` (generic state, arity 1 — wrapped); FL/GA/TX locals `r`, `intersections`, `periods`; states local `r` (pdf-export-states.ts:1064) + its intersections/periods.
- Produces: distribution section inserted at each native anchor. GA/TX/states already own a distribution chapter → NO downstream renumbering. All use `flavor: "generic"` (default).

- [ ] 7.1 GA: Locate the anchor by symbol — `git -C /Users/geraldkogon/tis-wt-tripdist grep -n 'gaSection(doc, "5.0 TRIP DISTRIBUTION AND ASSIGNMENT")' -- artifacts/tis-api-server/src/lib/pdf-export.ts` (recon: ~1582). Read the 12 lines after it to find where the §5.0 intro prose block ends (its closing `);`) and where §6.0 begins. Confirm the local names GA uses for the affected-intersection rows and period reports (grep within `renderTisGeorgia` for `intersections` / `periods`; recon shows FL names them `intersections`/`periods` off `r`). Insert after the §5.0 intro block (before §6.0):

```ts
    renderTripDistributionSection(doc, r as any, {
      subsectionNumber: "5.1",
      assignmentNumber: "5.2",
      headingFn: gaSubsection,
      cap: 20,
      intersections,
      periods,
    });
```

If GA lacks locals named `intersections`/`periods`, OMIT those two opts (the shared fn falls back to `result.affectedIntersections` / `result.periodReports`).

- [ ] 7.2 TX: First map the FULL native §5 chain so the shared section does not collide. TX (`renderTisTexas`) already prints, in order: `gaSubsection(doc, "5.1 Site-Generated Traffic")`, `"5.2 Trip Distribution"` (~5606), `"5.3 Trip Assignment"` (~5612), **`"5.4 Non-Site Traffic"` (~5618)**, and **`"5.5 Total Traffic"` (~5636)**, then §6.0. So §5.2–§5.5 are ALL taken — the shared section must be **`5.6`**, placed AFTER the existing §5.5 "Total Traffic" block, immediately before the §6.0 heading. Verify the chain and the insertion point: `git -C /Users/geraldkogon/tis-wt-tripdist grep -n 'gaSubsection(doc, "5.5 Total Traffic")' -- artifacts/tis-api-server/src/lib/pdf-export.ts` (~5636), then read from there to the next `gaSection(doc, "6.` heading — insert the call at the end of the §5.5 block, before §6.0. OMIT `assignmentNumber` (TX already has a native §5.3 assignment; the shared fn then skips its assignment sub-block, avoiding a duplicate assignment):

```ts
    renderTripDistributionSection(doc, r as any, {
      subsectionNumber: "5.6",
      headingFn: gaSubsection,
      cap: 20,
      intersections,
      periods,
    });
```

This renders as "5.6 Trip Distribution — Gravity Model (Screening)"-style heading (the shared fn's generic heading is `"5.6 Trip Distribution — ${methodLabel}"`), a distinct number that does not collide with the existing §5.2/§5.3/§5.4/§5.5. Do NOT reuse §5.2 or §5.4. (The assignment guard is already `if (opts.assignmentNumber && assignRows.length > 0)` in Task 5, so omitting `assignmentNumber` suppresses the assignment sub-block. No edit to the shared fn is needed here.) NOTE: TX already documents distribution (§5.2) and assignment (§5.3) natively; this §5.6 section adds the quantitative gravity worksheet + directional table. If `intersections`/`periods` locals are absent in `renderTisTexas`, OMIT those opts (the shared fn falls back to `r.affectedIntersections`/`r.periodReports`).

- [ ] 7.3 Generic states: Read `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/src/lib/pdf-export-states.ts` around `renderTisState` (starts line 1063), the `stateSection` closure (1083) and `stateSub` closure (1090), and the existing `stateSection("6.0 TRIP DISTRIBUTION AND ASSIGNMENT")` at 1327 (block 1326–1334, ending with a `note(...)` at ~1333 and `doc.moveDown(0.8)` at ~1334). NOTE: `renderTisState`'s report local is named **`r`** (`pdf-export-states.ts:1064` `r: any`), NOT `result` — use `r` in the call below. `renderTisState` also has local `intersections`/`periods` (~1072–1073) that could be passed explicitly, but omitting them lets the shared fn fall back to `r.affectedIntersections`/`r.periodReports` equivalently. Add the import at the top of `pdf-export-states.ts` (near its other cross-file imports):

```ts
import { renderTripDistributionSection } from "./pdf-export-distribution";
```

Then insert after the §6.0 directional `note(...)` (line ~1333), before `doc.moveDown(0.8)` (line ~1334). Because `stateSub` is a **1-arg** closure `(title) => void`, wrap it so it matches the shared fn's 2-arg `headingFn` contract:

```ts
    renderTripDistributionSection(doc, r as any, {
      subsectionNumber: "6.1",
      assignmentNumber: "6.2",
      headingFn: (_doc, title) => stateSub(title),
      cap: 20,
    });
```

(Omitting `intersections`/`periods` lets the shared fn read them off `r.affectedIntersections`/`r.periodReports`.)

- [ ] 7.4 Typecheck: `cd /Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server && pnpm run typecheck`. Expected: no errors.

- [ ] 7.5 Commit:
```
git -C /Users/geraldkogon/tis-wt-tripdist add artifacts/tis-api-server/src/lib/pdf-export.ts artifacts/tis-api-server/src/lib/pdf-export-states.ts
git -C /Users/geraldkogon/tis-wt-tripdist commit -m "$(cat <<'EOF'
Add shared trip-distribution section to GA, TX, generic state renderers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — Add the shared section to CA, IL, NY (with downstream renumbering)

**Files:**
- Modify `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/src/lib/pdf-export.ts` (`renderTisCalifornia` §4.x under NON-CEQA; `renderTisIllinois` §4.0/§5.0)
- Modify `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/src/lib/pdf-export-ny.ts` (`renderTisNewYork` §3.x under CAPACITY ANALYSIS + TOC)

**Interfaces:**
- Consumes: `renderTripDistributionSection`; heading fns `caSubsection` (CA, arity 2), `gaSubsection`/`gaSection` (IL reuses GA helpers, arity 2), `nySubsection` (NY, arity 2); locals `r`, `intersections`/`periods` (verify per fn).
- Produces: a NEW distribution section in each; downstream subsection/chapter numbers renumbered per recon. All `flavor: "generic"`.

### CA (recon: caSubsection@2609; §4.2 Trip Generation@2419; dynamic §4.3@2470; §4.4@2529)

- [ ] 8.1 CA insert: `git -C /Users/geraldkogon/tis-wt-tripdist grep -n 'caSubsection(doc, "4.2 Trip Generation")' -- artifacts/tis-api-server/src/lib/pdf-export.ts` (recon ~2419). Read from there through the dynamic `"4.3 Affected Intersections — …"` (recon ~2470) to find the end of the §4.2 block. Insert after the §4.2 block, before the dynamic §4.3:

```ts
    renderTripDistributionSection(doc, r as any, {
      subsectionNumber: "4.3",
      assignmentNumber: "4.4",
      headingFn: caSubsection,
      cap: 20,
      intersections,
      periods,
    });
```

If CA lacks locals `intersections`/`periods`, omit them.

- [ ] 8.2 CA renumber — dynamic §4.3 heading → §4.5. Read the exact dynamic heading expression at recon ~2470 (it is a ternary producing `"4.3 Affected Intersections — …"`). Edit its literal `"4.3 Affected Intersections` prefix → `"4.5 Affected Intersections`. Old/new must match the read exactly.

- [ ] 8.3 CA renumber — §4.4 heading → §4.6. `git -C /Users/geraldkogon/tis-wt-tripdist grep -n 'caSubsection(doc, "4.4 Recommended Operational Improvements (Non-CEQA)")' -- artifacts/tis-api-server/src/lib/pdf-export.ts` (recon ~2529). Edit exact old → new:
  - old: `caSubsection(doc, "4.4 Recommended Operational Improvements (Non-CEQA)");`
  - new: `caSubsection(doc, "4.6 Recommended Operational Improvements (Non-CEQA)");`

- [ ] 8.4 CA grep-verify contiguity: `git -C /Users/geraldkogon/tis-wt-tripdist grep -n 'caSubsection(doc, "4\.' -- artifacts/tis-api-server/src/lib/pdf-export.ts`. Confirm the CA §4 sequence reads 4.1, 4.2, 4.3 (new distribution), 4.4 (new assignment), 4.5 (Affected Intersections), 4.6 (Recommended Improvements) with no gaps or duplicates. Also grep for any in-prose `"4.3"`/`"4.4"` cross-references in the CA body and bump each to the new number.

### IL (recon: reuses gaSection/gaSubsection; §4.0 TRIP GENERATION@6252; §5.0 BACKGROUND GROWTH@6306; §6.0 FUTURE CONDITIONS ANALYSIS@6327). Low-blast: add distribution as a `gaSubsection` under §4.0 to avoid any chapter renumbering.

- [ ] 8.5 IL insert: **The grep `gaSection(doc, "4.0 TRIP GENERATION")` is NON-UNIQUE — it matches BOTH GA (line ~1527, inside `renderTisGeorgia`) and IL (line ~6252, inside `renderTisIllinois`).** You MUST select the IL occurrence and NOT accidentally edit GA (GA already gets its distribution section via Task 7.1; editing GA here would double-insert). Disambiguation step: run `git -C /Users/geraldkogon/tis-wt-tripdist grep -n 'gaSection(doc, "4.0 TRIP GENERATION")' -- artifacts/tis-api-server/src/lib/pdf-export.ts`, then pick the match that lies inside the `renderTisIllinois` body — the function starts ~6029 and ends before `renderTisIllinoisCdotWorksheet` (~6498), so the correct hit is the ~6252 one, NOT the ~1527 GA one. CONFIRM the chosen match is IL by verifying the FOLLOWING section heading is IL's `gaSection(doc, "5.0 BACKGROUND GROWTH")` (~6306) — NOT GA's `gaSection(doc, "5.0 TRIP DISTRIBUTION AND ASSIGNMENT")` (~1582). Read from the chosen ~6252 line to the `gaSection(doc, "5.0 BACKGROUND GROWTH")` (~6306) to find the end of the §4.0 block. Insert at the end of the §4.0 block, before §5.0, as trip-distribution subsections under §4 (NO chapter renumbering needed):

```ts
    renderTripDistributionSection(doc, r as any, {
      subsectionNumber: "4.1",
      assignmentNumber: "4.2",
      headingFn: gaSubsection,
      cap: 20,
      intersections,
      periods,
    });
```

If IL lacks `intersections`/`periods` locals, omit them. If §4.0 already emits its own `4.1`/`4.2` subsections, read them first and choose the next free decimals (e.g. `4.3`/`4.4`) so numbering stays contiguous — grep `git -C /Users/geraldkogon/tis-wt-tripdist grep -n 'gaSubsection(doc, "4\.' -- artifacts/tis-api-server/src/lib/pdf-export.ts` within the IL body before choosing.

- [ ] 8.6 IL grep-verify: `git -C /Users/geraldkogon/tis-wt-tripdist grep -n 'gaSection(doc, "' -- artifacts/tis-api-server/src/lib/pdf-export.ts` — because `gaSection`/`gaSubsection` are shared across the GA and IL bodies, restrict your review to the matches inside the `renderTisIllinois` body range ([~6029, ~6498], ending before `renderTisIllinoisCdotWorksheet`) and confirm the IL chapter sequence is unchanged (3.0, 4.0, 5.0, 6.0, …) and the new subsection numbers under §4 are contiguous. Do NOT count GA's matches (~1527/~1582) as IL. No chapter renumber should have occurred.

### NY (recon: nySubsection@58, arity 2; §3.0 CAPACITY ANALYSIS@542; §3.2 Existing AADT and DHV@590; §3.3 Traffic Control Device Data@724; §3.4@750; §3.5@778; §3.6@830; §4.0 CRASH ANALYSIS@853; TOC lines 317–320). Low-blast: append as the LAST §3.x (§3.7) before §4.0 — one TOC line, no renumbering.

- [ ] 8.7 NY insert: add the import at the top of `pdf-export-ny.ts` (near its cross-file imports):

```ts
import { renderTripDistributionSection } from "./pdf-export-distribution";
```

`git -C /Users/geraldkogon/tis-wt-tripdist grep -n 'nySubsection(doc, "3.6 Capacity Improvement Measures")' -- artifacts/tis-api-server/src/lib/pdf-export-ny.ts` (recon ~830). Read from there to `nySection(doc, "4.0 SUMMARY OF TRAFFIC IMPACTS"` is wrong — the real §4.0 is `nySection(doc, "4.0 CRASH ANALYSIS")` (recon @853). Insert at the end of the §3.6 block, before §4.0 CRASH ANALYSIS:

```ts
    renderTripDistributionSection(doc, r as any, {
      subsectionNumber: "3.7",
      assignmentNumber: "3.8",
      headingFn: nySubsection,
      cap: 20,
    });
```

(Omitting `intersections`/`periods` → shared fn reads them off the report. Confirm NY's report local name — grep the `renderTisNewYork` head for the `r`/`result` binding; use whichever it is in the `as any` arg.)

- [ ] 8.8 NY TOC: Read `pdf-export-ny.ts` lines 315–322 to confirm the §3.x TOC array entries (recon shows 3.3–3.6 at 317–320). Add two contiguous TOC lines after the `"       3.6  Capacity Improvement Measures"` entry, matching the exact indentation/format of the surrounding array literals:

```ts
    ["       3.7  Trip Distribution and Assignment", ""],
    ["       3.8  Project Trip Assignment", ""],
```

If the assignment sub-block is not desired as a separate TOC line (the shared fn only emits §3.8 if `assignmentNumber` is set and there are PM rows), keep both lines but verify against the rendered output in Task 9; remove the §3.8 TOC line if the smoke shows no §3.8 heading for NY. (Simplest: keep `assignmentNumber: "3.8"` and both TOC lines — they will render.)

- [ ] 8.9 NY grep-verify: `git -C /Users/geraldkogon/tis-wt-tripdist grep -n 'nySubsection(doc, "3\.' -- artifacts/tis-api-server/src/lib/pdf-export-ny.ts` — confirm a contiguous 3.1 … 3.8 sequence, and that §4.0 CRASH ANALYSIS is untouched. No existing NY heading was renumbered.

- [ ] 8.10 Confirm London is untouched: `git -C /Users/geraldkogon/tis-wt-tripdist grep -n "renderTripDistributionSection" -- artifacts/tis-api-server/src/lib/pdf-export.ts`. Every matched line MUST fall OUTSIDE the `renderTisLondon` span [3357, 4919] (next fn `renderTisTexasWorksheet` @4920). Cross-check: `git -C /Users/geraldkogon/tis-wt-tripdist grep -n "function renderTisLondon\|function renderTisTexasWorksheet" -- artifacts/tis-api-server/src/lib/pdf-export.ts` and confirm no distribution-section call number lies between those two line numbers. If any landed there, remove it.

- [ ] 8.11 Typecheck: `cd /Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server && pnpm run typecheck`. Expected: no errors.

- [ ] 8.12 Commit:
```
git -C /Users/geraldkogon/tis-wt-tripdist add artifacts/tis-api-server/src/lib/pdf-export.ts artifacts/tis-api-server/src/lib/pdf-export-ny.ts
git -C /Users/geraldkogon/tis-wt-tripdist commit -m "$(cat <<'EOF'
Add trip-distribution section to CA/IL/NY renderers (contiguous numbering + NY TOC)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — PDF smoke render (all US regions, gravity default) via `renderStudyPdf`

**Files:**
- Create `/Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server/scripts/smoke-distribution-pdf.mjs`

**Interfaces:**
- Consumes: `renderStudyPdf(project: StoredProject, firm: FirmStamp): Promise<Buffer>` — the sole export of `pdf-export.ts`. Region is resolved from `project.siteLat`/`project.siteLon` via `regionForCoordinate`; the report is read from `project.resultPayload`. Does NOT hit the analyzer. It DOES issue best-effort/null-safe network fetches: logo + StreetView for all regions, AND — for a `studyType:'tis'` project at an NY coordinate — a NYSDOT `RDM_Roadway_Current` FeatureServer enrichment fetch (pdf-export.ts:316+). All of these fail open with bounded timeouts; in an offline sandbox they return null/placeholders, so the section still renders. If network is unavailable, run the smoke with a short overall timeout, or drop the NY fixture from the region list to avoid a slow run waiting on the NYSDOT timeout.
- Produces: one PDF Buffer per US region; asserts non-empty, no throw, and contains the string "Trip Distribution".

**StoredProject / FirmStamp shapes (recon2 pdf-export.ts:56–78):**
- `StoredProject = { id; studyType; projectName; landUseCode; siteLat: string|null; siteLon: string|null; version; createdAt: Date; requestPayload; resultPayload }`
- `FirmStamp = { name; logoUrl: string|null; brandColor?; addressLine?; phone?; website?; firmId? }` — minimal = `{ name, logoUrl: null }`.
- Region resolves from coordinates: set `siteLat`/`siteLon` inside each target region's bounds so `regionForCoordinate` returns GA/TX/CA/IL/NY/FL/generic. `studyType: "tis"`.

- [ ] 9.1 **Leaf-safety pre-check.** Verify `renderStudyPdf` can be imported under Node native TS stripping standalone: `cd /Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server && node -e 'import("./src/lib/pdf-export.ts").then(m => console.log(typeof m.renderStudyPdf)).catch(e => { console.error(e); process.exit(1); })'`. Expected: prints `function`. If it throws (transitive non-strippable import, top-level http, missing font files at import time), STOP the full-render approach and use the **fallback in 9.7** (drive only `pdf-export-distribution.ts` with a mock `PDFDocument`).

- [ ] 9.2 Read `renderStudyPdf` (pdf-export.ts:258–307) + `detectRegion` (1108–1113) + `selectRegionalTisRenderer` (1048–1106) to confirm: it reads `project.resultPayload`, resolves region from `siteLat`/`siteLon`, and that `resolveTemplate(project, firm)` returns falsy for a plain `studyType:"tis"` project (so it does NOT divert to the template engine). If `resolveTemplate` would divert, ensure the fixture has no `firmId` and no firm template so `tplSel` is null.

- [ ] 9.3 Find in-bounds coordinates for each region: `git -C /Users/geraldkogon/tis-wt-tripdist grep -n "regionForCoordinate" -- artifacts/tis-api-server/src/lib` then Read the region-bounds data/source to pick one lat/lon per region code (GA/TX/CA/IL/NY/FL + a generic-US coord that resolves to `renderTisState`, e.g. an Ohio point). Record the chosen coordinates in the script comments.

- [ ] 9.4 Create `smoke-distribution-pdf.mjs`. Full content (coordinates filled from 9.3):

```js
// Standalone node script (no test runner). PDF smoke for the shared
// trip-distribution section across US regional renderers. No analyzer needed;
// renderStudyPdf's network fetches (logo + StreetView all regions; NYSDOT
// RDM_Roadway_Current FeatureServer for the NY fixture, pdf-export.ts:316+) are
// all best-effort/null-safe with bounded timeouts — offline they return
// null/placeholders. If network is unavailable, drop the NY fixture to avoid
// waiting on the NYSDOT timeout.
// Run: node ./scripts/smoke-distribution-pdf.mjs
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const pe = await import(path.resolve(here, "../src/lib/pdf-export.ts"));
const { renderStudyPdf } = pe;

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };

const CARDINALS = ["NNE", "ENE", "ESE", "SSE", "SSW", "WSW", "WNW", "NNW"];
function fixtureTripDistribution() {
  const zones = Array.from({ length: 6 }, (_, i) => ({
    id: `S${i}`, name: `Main St & ${i + 1}th Ave`, distanceMi: 0.1 + i * 0.05,
    bearingDeg: i * 45, cardinal: CARDINALS[i % 8], mass: 30000 - i * 3000,
    term: 1 / (i + 1), weight: 0, sharePct: 0,
  }));
  const total = zones.reduce((s, z) => s + z.term, 0);
  for (const z of zones) { z.weight = z.term / total; z.sharePct = z.weight * 100; }
  zones.sort((a, b) => b.sharePct - a.sharePct);
  const byDirection = Object.fromEntries(CARDINALS.map((c) => [c, 12.5]));
  const sectors = { "NNE+ENE": 25, "ESE+SSE": 25, "SSW+WSW": 25, "WNW+NNW": 25 };
  return {
    method: "gravity", methodLabel: "Gravity Model",
    basis: "Gravity model over study-area attraction zones.",
    betaExponent: 1, massBasis: "intersection through-volume (AADT × K-factor) proxy",
    weights: zones.map((z) => z.weight),
    loadMultipliers: zones.map(() => 1),
    zones, byDirection, sectors,
  };
}

function resultPayload(lat, lon) {
  const affected = Array.from({ length: 6 }, (_, i) => ({
    signalId: `S${i}`, name: `Main St & ${i + 1}th Ave`,
    distanceMi: 0.1 + i * 0.05, addedTripsPmPeak: 40 - i * 5,
  }));
  return {
    tripGeneration: { externalTrips: 210, netNewExternalTrips: 210 },
    affectedIntersections: affected,
    periodReports: [
      { period: "pm_peak", affectedIntersections: affected },
      { period: "am_peak", affectedIntersections: affected.map((a) => ({ ...a, addedTripsPmPeak: a.addedTripsPmPeak - 5 })) },
    ],
    tripDistribution: fixtureTripDistribution(),
    request: { latitude: lat, longitude: lon, distributionMethod: "gravity" },
    // flGravity kept in sync for the FL path (renderTisFlorida may still read r.flGravity):
    flGravity: (() => {
      const td = fixtureTripDistribution();
      return { betaExponent: td.betaExponent, massBasis: td.massBasis, zones: td.zones.map((z) => ({
        id: z.id, name: z.name, distanceMi: z.distanceMi, bearingDeg: z.bearingDeg,
        cardinal: z.cardinal, mass: z.mass, term: z.term, sharePct: z.sharePct })),
        byDirection: td.byDirection, sectors: td.sectors };
    })(),
  };
}

function project(label, lat, lon) {
  return {
    id: `smoke-${label}`,
    studyType: "tis",
    projectName: `Smoke ${label}`,
    landUseCode: "820", // shopping center; a valid catalog code
    siteLat: String(lat),
    siteLon: String(lon),
    version: 1,
    createdAt: new Date(),
    requestPayload: { latitude: lat, longitude: lon, size: 100, landUseCode: "820", distributionMethod: "gravity" },
    resultPayload: resultPayload(lat, lon),
  };
}

const firm = { name: "Smoke Test Engineering", logoUrl: null };

// Coordinates chosen (step 9.3) to land inside each region's bounds:
const REGIONS = [
  ["GA", 33.7490, -84.3880],   // Atlanta
  ["TX", 30.2672, -97.7431],   // Austin
  ["CA", 34.0522, -118.2437],  // Los Angeles
  ["IL", 41.8781, -87.6298],   // Chicago
  ["NY", 40.7128, -74.0060],   // NYC
  ["FL", 25.7617, -80.1918],   // Miami
  ["OH", 39.9612, -82.9988],   // Columbus (generic renderTisState)
];

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tis-dist-smoke-"));
for (const [label, lat, lon] of REGIONS) {
  try {
    const buf = await renderStudyPdf(project(label, lat, lon), firm);
    const text = buf.toString("latin1");
    ok(buf.length > 1000, `${label}: non-empty PDF (${buf.length} bytes)`);
    ok(/Trip Distribution/.test(text), `${label}: contains "Trip Distribution"`);
    fs.writeFileSync(path.join(outDir, `${label}.pdf`), buf);
  } catch (e) {
    ok(false, `${label}: threw ${e && e.stack ? e.stack : e}`);
  }
}
console.log(`PDFs in ${outDir}`);
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] 9.5 Register the smoke script in `package.json` after the `check:trip-distribution` entry:

```json
    "smoke:distribution-pdf": "node ./scripts/smoke-distribution-pdf.mjs",
```

- [ ] 9.6 Run it: `cd /Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server && pnpm run smoke:distribution-pdf`. Expected: `ALL PASS` — every US region renders a non-empty PDF containing "Trip Distribution", no throws. If a region throws on a missing report field, add that field minimally to `resultPayload` (do NOT stub the section away). Debug via superpowers:systematic-debugging.

- [ ] 9.7 **Fallback (only if 9.1 fails).** If `renderStudyPdf` cannot import under node TS-strip, replace the smoke with a section-level driver: import ONLY `renderTripDistributionSection` from `./pdf-export-distribution.ts`, construct a real `pdfkit` `PDFDocument` (register the `body` + `bold` fonts as `renderStudyPdf` does at 296–298 — that block registers three fonts, body (`FONT_REGULAR`) / bold (`FONT_BOLD`) / mono (`FONT_MONO`), but the distribution section uses only body+bold so registering those two is sufficient; use the repo's font paths — grep `FONT_REGULAR`/`FONT_BOLD` in pdf-export.ts), call the section with a `flavor:"generic"` and a `flavor:"fl"` fixture + a stub 2-arg `headingFn`, collect the stream to a Buffer, and assert the buffer is non-empty and contains "Trip Distribution". Document in the script header that this is the scoped fallback because full `renderStudyPdf` is not node-TS-strip importable, and note the spec's "render a report per US region" requirement is therefore met at the section-renderer level. Register/run/commit the same way.

- [ ] 9.8 Commit:
```
git -C /Users/geraldkogon/tis-wt-tripdist add artifacts/tis-api-server/scripts/smoke-distribution-pdf.mjs artifacts/tis-api-server/package.json
git -C /Users/geraldkogon/tis-wt-tripdist commit -m "$(cat <<'EOF'
Add PDF smoke script for the shared trip-distribution section across US regions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10 — Frontend: distribution-method dropdown

**Files:**
- Modify `/Users/geraldkogon/tis-wt-tripdist/artifacts/atlanta-tis/src/pages/tis.tsx` (generated-client type import; options const near `WEATHER_OPTIONS`; `<select>` in the advanced block near the weather select)

**Interfaces:**
- Consumes: generated `type TisDistributionMethod`; existing `form`/`setForm` state; `submit()` spreads `...form` (no change needed there).
- Produces: a `<select>` bound to `form.distributionMethod`, default "gravity".

- [ ] 10.1 Read `/Users/geraldkogon/tis-wt-tripdist/artifacts/atlanta-tis/src/pages/tis.tsx` lines 1–20, and locate the anchors by symbol: `git -C /Users/geraldkogon/tis-wt-tripdist grep -n "WEATHER_OPTIONS\|type TisWeather\|weather" -- artifacts/atlanta-tis/src/pages/tis.tsx`. Read the `WEATHER_OPTIONS` const and the weather `<select>` block to mirror.

- [ ] 10.2 Add `type TisDistributionMethod` to the generated-client type import (mirror where `type TisWeather` is imported from `@workspace/tis-api-client-react`):

```ts
  type TisDistributionMethod,
```

- [ ] 10.3 Add the options const next to `WEATHER_OPTIONS`:

```ts
const DISTRIBUTION_METHOD_OPTIONS: Array<{ value: TisDistributionMethod; label: string }> = [
  { value: "gravity", label: "Gravity model (mass / distance)" },
  { value: "analogy", label: "Analogous-site distribution (coming soon)" },
  { value: "surrogate", label: "Surrogate / market-area (coming soon)" },
];
```

- [ ] 10.4 Add the dropdown in the advanced block near the weather `<select>`, mirroring the weather control's markup (adjust classNames/label wrapper to match the actual weather control read in 10.1). Either `setForm` style compiles and behaves identically for a single-field write — tis.tsx uses both the functional updater (`setForm((f) => ({ ...f, … }))`, lines 262/330) and the direct spread (`setForm({ ...form, … })`, the adjacent weather `<select>` at ~612). Use the functional-updater form below (safe under concurrent updates):

```tsx
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Trip-distribution method
                </span>
                <select
                  className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                  value={form.distributionMethod ?? "gravity"}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, distributionMethod: e.target.value as TisDistributionMethod }))
                  }
                  data-testid="select-distribution-method"
                >
                  {DISTRIBUTION_METHOD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
```

- [ ] 10.5 Typecheck the frontend + whole repo: `cd /Users/geraldkogon/tis-wt-tripdist && pnpm run typecheck`. Expected: no errors (compiles atlanta-tis against the regenerated client types). `submit()` needs no change — it spreads `...form`, so `distributionMethod` flows into the mutation body automatically. Confirm `form`'s type admits `distributionMethod?` (it derives from the generated `TisRequest`); if `form` is a hand-typed local, add `distributionMethod?: TisDistributionMethod` to that type.

- [ ] 10.6 Commit:
```
git -C /Users/geraldkogon/tis-wt-tripdist add artifacts/atlanta-tis/src/pages/tis.tsx
git -C /Users/geraldkogon/tis-wt-tripdist commit -m "$(cat <<'EOF'
Add trip-distribution-method dropdown to the TIS form (default Gravity)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11 — Full verification gate (byte-identical default + green build)

**Files:** none (verification only).

**Interfaces:** Consumes all prior artifacts.

- [ ] 11.1 Leaf check (proves gravity == origin/main four-step + Caltran equivalence + ordering + zero-mass invariants, using the real refVolume/baseVoverC reconstruction): `cd /Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server && pnpm run check:trip-distribution`. Expected `ALL PASS`.

- [ ] 11.2 Existing Caltran check (no regression to FL math): `cd /Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server && pnpm run check:caltran-gravity`. Expected `ALL PASS`.

- [ ] 11.3 PDF smoke: `cd /Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server && pnpm run smoke:distribution-pdf`. Expected `ALL PASS` — every US region renders a non-empty PDF containing "Trip Distribution", no throws.

- [ ] 11.4 Full-repo typecheck: `cd /Users/geraldkogon/tis-wt-tripdist && pnpm run typecheck`. Expected: no errors.

- [ ] 11.5 Codegen drift check (idempotent generated files): `cd /Users/geraldkogon/tis-wt-tripdist/lib/tis-api-spec && pnpm --filter @workspace/tis-api-spec run codegen && git -C /Users/geraldkogon/tis-wt-tripdist status --porcelain lib/tis-api-zod lib/tis-api-client-react`. Expected: empty output (generated files already committed, codegen is idempotent).

- [ ] 11.6 Byte-identical default gate (documentary): The invariant is enforced by construction — `tis.ts` builds `demandZones`/`gravityZones`/`refVolume` verbatim (Task 4.6) and the leaf consumes them without re-derivation, and the check-script's `"gravity weights byte-match origin/main four-step (real demandZones)"` + `"FL gravity weights byte-match caltranGravityShares (real gravityZones)"` + `"FL loadMultipliers byte-match directionalMultipliers"` assertions reconstruct the exact tis.ts formula. FL PDF byte-identity is guaranteed by `flavor:"fl"` reproducing the verbatim prose/captions/`moveDown(0.2)` calls. State in the PR description that the engine's full `analyze()` byte-diff cannot run locally (no analyzer at localhost:8080); equivalence is proven at the distribution-layer boundary plus untouched `loadWeights`/route-assignment lines (Task 4 preserved them verbatim).

- [ ] 11.7 Diff review for scope + no `git add -A` leakage. **Compare against the FORK POINT (`612cdbc`), NOT `origin/main`.** `origin/main` (`9ac286a`) is ahead by the driveways PR #62 and other commits absent from this branch; diffing `origin/main..HEAD` would falsely surface the entire driveways divergence (driveways.ts, network-assignment.ts, routes/tis.ts, tsconfig.json, generated driveway types, the pre-existing openapi/tis.ts driveway deltas) and flag it as `git add -A` leakage. Diff against the merge-base instead:
```
git -C /Users/geraldkogon/tis-wt-tripdist log --oneline 612cdbc..HEAD
git -C /Users/geraldkogon/tis-wt-tripdist diff --stat 612cdbc..HEAD
```
(`612cdbc` == `026a26d^` == `git merge-base origin/main HEAD`; you may substitute `$(git -C /Users/geraldkogon/tis-wt-tripdist merge-base origin/main HEAD)` if you prefer to compute it.) Expected: the log shows `026a26d` (docs-only) plus the Task 2–10 feature commits. The diff-stat's ONLY non-`docs/` changes are: `trip-distribution.ts`, `pdf-export-distribution.ts`, `tis.ts`, `pdf-export.ts`, `pdf-export-ny.ts`, `pdf-export-states.ts`, `openapi.yaml`, generated zod/react-client dirs, `tis.tsx`, `verify-trip-distribution.mjs`, `smoke-distribution-pdf.mjs`, and `package.json`. Confirm NO London file/section touched (`renderTisLondon` body unchanged) and NO `national-block-group-taz` / `analogy-reference` files created (PR1 scope). The `docs/superpowers/**` delta from `026a26d` is expected and excluded from the byte-identical-engine claim. Do NOT gate scope on `origin/main` while `origin/main` carries commits absent from HEAD.

- [ ] 11.8 **Reconcile with current origin/main before PR.** At PR time, `origin/main` (`9ac286a`) carries the driveways PR #62 changes to `artifacts/tis-api-server/src/lib/tis.ts` (1733 vs 1659 lines) and `pdf-export.ts` that OVERLAP the loading/assignment region this PR edits (Task 4's demandZones/gravityZones/weights block, Task 6's FL §6.1/§6.2 refactor). Rebase or merge the feature branch onto current `origin/main`, resolve the conflicts in `tis.ts` / `pdf-export.ts` (preserving BOTH the driveways logic already on main AND this PR's unified-distribution wiring — the byte-identity contract is now measured against the reconciled tree, not the fork point), then RE-RUN the verification gate against the reconciled tree to reconfirm the invariants:
```
cd /Users/geraldkogon/tis-wt-tripdist/artifacts/tis-api-server && pnpm run check:trip-distribution && pnpm run check:caltran-gravity && pnpm run smoke:distribution-pdf
cd /Users/geraldkogon/tis-wt-tripdist && pnpm run typecheck
```
Expected: all check-scripts `ALL PASS`, `tsc --noEmit` clean, PDF smoke green. **All line anchors in this plan will have shifted after the rebase — relocate every edit by its named symbol, never by the raw line number.** If a conflict resolution changes the `demandZones`/`gravityZones`/`refVolume` construction, re-verify byte-identity via the leaf check-script's reconstruction before opening the PR.

---

## Notes for the executor

- **Highest-risk edit is Task 4.6.** It must keep `refVolume` (tis.ts:1292–1296) above the deletion and build `demandZones`/`gravityZones` with the EXACT expressions from recon2 (attraction = `totalVolume>0?totalVolume:FALLBACK_VOLUME`; `baseVoverC = clamp(that/refVolume, 0.05, 1.0)`; `bearingDeg({lat:req.latitude,lon:req.longitude},{lat:c.sig.latitude,lon:c.sig.longitude})`; `name = c.sig.name`). Any deviation breaks the byte-identical invariant. The leaf NEVER recomputes these.
- **Field names are real (recon2):** candidates are `Array<{ sig: AnalyzerIntersection; distanceMi }>`; use `c.sig.id`, `c.sig.name`, `c.sig.totalVolume`, `c.sig.latitude`, `c.sig.longitude`, and site coords `req.latitude`/`req.longitude`. There is no `c.throughVolume`, `c.baseVoverC`, `c.sig.lat`, or `c.sig.lon`.
- **headingFn arity is 2** `(doc, title)`. `gaSubsection`/`caSubsection`/`nySubsection` are true 2-arg module functions — pass directly. `stateSub`/`stateSection` are 1-arg closures — wrap as `(_doc, title) => stateSub(title)` (Task 7.3).
- **Ordering:** `weights[]`/`loadMultipliers[]` are candidate-ordered; `zones[]` is share-sorted. Never index-align across the two — key by `id` (the shared renderer's `dirBySig`/`amBySig` already do). The check-script asserts this.
- If any recon line anchor has drifted, re-locate by the named symbol (`gaSection(doc, "5.0 TRIP DISTRIBUTION AND ASSIGNMENT")`, `const flg = r.flGravity;`, `caltranGravityShares`, etc.) rather than trusting the raw line number.
- Path A (self-contained `pdf-export-distribution.ts`) is chosen per the repo's documented no-cross-file-coupling convention. Do not add exports to `pdf-export.ts`. All symbols `table()` closes over are copied inline (`PAGE_MARGIN`, `velocityPaletteActive=false`, `VELOCITY_FILL`, `VELOCITY_GREEN`; `PADX`/`PADY` local; `TEXT_GRAY`/`fmtNum` for captions/cells).