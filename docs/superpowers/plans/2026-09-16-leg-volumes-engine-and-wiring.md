# Leg Volumes + Movement Estimation (engine and wiring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-signal 30/25/25/20 approach split and the flat 15/70/15 turn shares with per-leg volumes (main-road legs from the signal's counted design hour, minor legs from the road-class baseline) and turning movements balanced by Furness/IPF — on by default, with a `legVolumes: "screening"` escape hatch that is byte-identical to today.

**Architecture:** A pure engine-core module (`leg-volumes.ts`) assigns a junction's incident links to approach directions, resolves entering/exiting volume per leg with a source label, and balances a 4×4 movement matrix against them. Row-math consumes the estimate through the branch a measured Synchro record already uses (approach shares, L/T/R lane groups, `leftVph` for the protected-left inference) under a new `volumeSource`. `tis.ts` builds the legs from the conserved-assignment graph the study already constructs, and the renderer prints a presence-gated provenance line, the balanced matrix, and a resolved methodology clause.

**Tech Stack:** TypeScript (ESM, `.ts` imports), pnpm workspace; engine core at `lib/tis-engine-core`; Express API at `artifacts/tis-api-server`; PDFKit renderer; OpenAPI → orval-generated zod (`lib/tis-api-spec` → `lib/tis-api-zod`); React UI at `artifacts/atlanta-tis`; checks are standalone `node ./scripts/verify-*.mjs` scripts registered as `check:*` in `artifacts/tis-api-server/package.json` and run by CI (`.github/workflows/checks.yml`).

**Spec:** `docs/superpowers/specs/2026-09-16-leg-volumes-and-movement-estimation-design.md` (§4.2 is amended by this plan: the data is per-signal, not per-segment — see Global Constraints).

## Global Constraints

- **Data reality (amends spec §4.2 step 3):** the AADT join is **per signal** (`artifacts/api-server/src/data/<slug>-aadt.json`, keyed by signal index: `{aadt, year, kFactor, distM, source}`), and `AnalyzerIntersection.totalVolume` is already the **design hour in vph** (AADT × K/100, class-gated; `regional-intersections.ts:20-33`). There is no per-segment AADT. Network mode therefore means: **the two main-road legs carry the signal's design hour, half per direction; the other legs carry the road-class baseline `{0: 2500, 1: 2000, 2: 1500, 3: 1000, 4: 700}` vph two-way (the analyzer's `VOLUME_BY_CLASS`, `regional-intersections.ts:106`), half per direction, labeled `class_default`.**
- `legVolumes: "screening"` (or absent) ⇒ every row byte-identical to today. Stored payloads without the new fields ⇒ renderer output byte-identical (all new renderer elements presence-gated). `check:theme-default-identity` must pass **without** re-pinning.
- A measured UTDF / Synchro record on a junction wins outright over the estimate; never blended.
- No new external calls, no new data assets.
- Direction convention (spec §4.2 step 1 / §4.3): a leg whose far end lies **north** of the node is the **SB approach** (origin bearing 0°); east → WB (90°); south → NB (180°); west → EB (270°). With the approach's origin bearing β, through exits at β+180°, **left at β+90°**, right at β−90°.
- IPF tolerance 0.5 vph, cap 50 iterations; exits normalized to entering when `|Σexit − Σenter| / Σenter > 0.05` and every present leg has an exit volume.
- Commit messages follow the repo's `type(scope): summary` + body convention and end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Run every command from the worktree root `/Users/geraldkogon/tis-study/.claude/worktrees/leg-volumes` (plain commands; the harness refuses computed `cd` targets).

---

## File map

| File | Responsibility |
|---|---|
| `lib/tis-engine-core/src/leg-volumes.ts` (create) | Pure: types, class ladder, `assignLegsToApproaches`, `resolveLegVolumes`, `estimateMovements`, `buildLegEstimate` |
| `lib/tis-engine-core/src/index.ts` (modify) | `export * from "./leg-volumes.ts"` |
| `artifacts/tis-api-server/scripts/verify-leg-volumes.mjs` (create) | The engine check (`check:leg-volumes`): spec §9 items 1–9 + row-math screening identity |
| `artifacts/tis-api-server/package.json` (modify) | register `check:leg-volumes`, `check:leg-volumes-render` |
| `lib/tis-engine-core/src/row-math.ts` (modify) | `ScenarioParams.legVolumes`, `RowCandidate.legEstimate`, `laneGroupsForApproach` shares alternative, consumption in `buildAffectedRow`, new row fields |
| `artifacts/tis-api-server/src/lib/junction-legs.ts` (create) | Server-side: `Graph` + node → `JunctionLeg[]` |
| `artifacts/tis-api-server/src/lib/tis.ts` (modify) | compute `legEstimate` per candidate from the conserved graph; `params.legVolumes`; methodology clause swap |
| `lib/tis-api-spec/openapi.yaml` (modify) + codegen | request `legVolumes`; response `volumeSource` enum, `legVolumes`, `movementEstimate` |
| `artifacts/tis-api-server/src/lib/pdf-export.ts` (modify) | worksheet provenance line, diagram shares, matrix table, appendix-intro variant |
| `artifacts/tis-api-server/scripts/verify-leg-volumes-render.mjs` (create) | renderer check: injected fields print; legacy fixture prints nothing new |
| `artifacts/atlanta-tis/src/pages/tis.tsx` (modify) | "Leg volumes" select |
| `artifacts/atlanta-tis/src/lib/intersection-geometry.ts` (modify) | `legSource` per approach for the explorer |

---

### Task 1: Engine-core module skeleton — types, ladder, `assignLegsToApproaches`

**Files:**
- Create: `lib/tis-engine-core/src/leg-volumes.ts`
- Modify: `lib/tis-engine-core/src/index.ts`
- Create: `artifacts/tis-api-server/scripts/verify-leg-volumes.mjs`
- Modify: `artifacts/tis-api-server/package.json` (scripts)

**Interfaces:**
- Consumes: `Direction` from `./webster-timing.ts`.
- Produces (used by Tasks 2–6):
  ```ts
  export type LegSource = "csv" | "signal_aadt" | "class_default";
  export type JunctionLeg = { bearingDeg: number; cls: number; oneWay: "in" | "out" | null };
  export type LegVolume = { dir: Direction; enteringVph: number; exitingVph: number | null; oneWay: "in" | "out" | null; source: LegSource; cls: number };
  export type LegVolumes = Record<Direction, LegVolume | null>;
  export const MINOR_LEG_DESIGN_HOUR_VPH_BY_CLASS: Record<number, number>;
  export function assignLegsToApproaches(legs: JunctionLeg[]): { byDir: Partial<Record<Direction, JunctionLeg>>; dropped: number };
  ```

- [ ] **Step 1: Write the failing check (skeleton with the first assertions)**

Create `artifacts/tis-api-server/scripts/verify-leg-volumes.mjs`:

```js
// Leg volumes + movement estimation (lib/tis-engine-core/src/leg-volumes.ts).
// Pins: leg → approach assignment, per-leg resolution (main road / class
// default / one-way), IPF balancing invariants, and — via row-math — that
// legVolumes:"screening" and an absent estimate are byte-identical to the
// pre-change row. Spec: docs/superpowers/specs/2026-09-16-leg-volumes-and-movement-estimation-design.md
//
// Run: node ./scripts/verify-leg-volumes.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);
const core = await import("@workspace/tis-engine-core");

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };
const close = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
const DIRS = ["NB", "SB", "EB", "WB"];

// ---- 1. leg → approach assignment (spec §4.2 step 1, §9 item 9) ----
{
  const legs = [
    { bearingDeg: 2, cls: 2, oneWay: null },    // far end north  → SB approach
    { bearingDeg: 91, cls: 3, oneWay: null },   // far end east   → WB approach
    { bearingDeg: 181, cls: 2, oneWay: null },  // far end south  → NB approach
    { bearingDeg: 268, cls: 3, oneWay: null },  // far end west   → EB approach
  ];
  const { byDir, dropped } = core.assignLegsToApproaches(legs);
  ok(byDir.SB?.bearingDeg === 2 && byDir.WB?.bearingDeg === 91 && byDir.NB?.bearingDeg === 181 && byDir.EB?.bearingDeg === 268,
    "assign: N/E/S/W far ends map to SB/WB/NB/EB approaches");
  ok(dropped === 0, "assign: four distinct legs, none dropped");
}
{
  // Five-leg: two legs quantize to EB; keep the higher class (lower cls), drop the other (§9 item 8).
  const legs = [
    { bearingDeg: 0, cls: 2, oneWay: null }, { bearingDeg: 90, cls: 2, oneWay: null },
    { bearingDeg: 180, cls: 2, oneWay: null }, { bearingDeg: 260, cls: 4, oneWay: null }, { bearingDeg: 280, cls: 2, oneWay: null },
  ];
  const { byDir, dropped } = core.assignLegsToApproaches(legs);
  ok(dropped === 1 && byDir.EB?.cls === 2 && byDir.EB?.bearingDeg === 280, "assign: five-leg keeps the higher-class EB leg, dropped = 1");
}
{
  const { byDir } = core.assignLegsToApproaches([{ bearingDeg: 44, cls: 3, oneWay: null }, { bearingDeg: 46, cls: 3, oneWay: null }]);
  ok(byDir.SB !== undefined && byDir.WB !== undefined, "assign: 44° → SB (north), 46° → WB (east) — nearest-cardinal quantization");
}
{
  ok(core.MINOR_LEG_DESIGN_HOUR_VPH_BY_CLASS[4] === 700 && core.MINOR_LEG_DESIGN_HOUR_VPH_BY_CLASS[0] === 2500,
    "ladder mirrors the analyzer's VOLUME_BY_CLASS (tertiary 700 … motorway 2500)");
}

console.log(fails === 0 ? "\nOVERALL: PASS" : `\nOVERALL: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd artifacts/tis-api-server && node ./scripts/verify-leg-volumes.mjs`
Expected: throws `TypeError: core.assignLegsToApproaches is not a function` (module not yet exported).

- [ ] **Step 3: Create the module with types, ladder, and `assignLegsToApproaches`**

Create `lib/tis-engine-core/src/leg-volumes.ts`:

```ts
/**
 * Leg volumes and turning-movement estimation.
 *
 * WHY. A study intersection has received ONE background volume — the design
 * hour (AADT × K) of the count nearest the signal, i.e. the main road's —
 * split across the four approaches by a seeded ±15% jitter on a 30/25/25/20
 * base (row-math.ts approachVolumeShares), then 15/70/15 within each
 * approach for the diagrams and 10/80/10 for the protected-left inference.
 * The minor street was carrying a quarter of the main road's volume no
 * matter what it carries; the main-road approaches were carrying 25–30% of
 * a design hour that is really ~50% per direction.
 *
 * WHAT. Three modes, one resolver:
 *   network   (default) main-road legs = the signal's counted design hour,
 *             half per direction; other legs = the road-class baseline the
 *             analyzer itself falls back to (VOLUME_BY_CLASS), half per
 *             direction, labeled class_default; a client link count (CSV)
 *             overrides either on its leg.
 *   screening today's shares — the engine simply does not consult this
 *             module (row-math), so the row is byte-identical.
 * Movements are then BALANCED against the exit legs by iterative
 * proportional fitting (Furness) from a geometry seed — the method behind
 * NCHRP 255 / NCHRP 765 project-level refinement — so Σin = Σout holds at
 * the node and a reviewer can check it by hand.
 *
 * DATA REALITY. The AADT join is per signal (one nearest count, class-gated),
 * not per segment; `totalVolume` is already vph. So "network" is honest
 * about what is counted (the main road) and what is a baseline (the rest),
 * and every leg carries its source.
 *
 * Pure: no I/O, no DB, no clock. Spec:
 * docs/superpowers/specs/2026-09-16-leg-volumes-and-movement-estimation-design.md
 */
import type { Direction, Movement } from "./webster-timing.ts";

export type LegSource = "csv" | "signal_aadt" | "class_default";

/** One incident link at a junction, as the routing graph knows it. */
export type JunctionLeg = {
  /** Compass bearing (deg, 0 = north, clockwise) from the node to the link's far end. */
  bearingDeg: number;
  /** OSM class code 0 (motorway) … 4 (tertiary); lower = higher class. */
  cls: number;
  /** "in": travel only toward the node; "out": only away; null: two-way. */
  oneWay: "in" | "out" | null;
};

export type LegVolume = {
  dir: Direction;
  /** Toward the junction (the approach volume). */
  enteringVph: number;
  /** Away from the junction; null = unknown. */
  exitingVph: number | null;
  oneWay: "in" | "out" | null;
  source: LegSource;
  cls: number;
};

/** null on a side with no leg (a T-intersection). */
export type LegVolumes = Record<Direction, LegVolume | null>;

/**
 * Two-way design-hour baseline by OSM class code — the analyzer's
 * VOLUME_BY_CLASS ladder (artifacts/api-server/src/lib/regional-intersections.ts),
 * mirrored here so an uncounted minor leg gets the same number the analyzer
 * would have given a signal on that road. Half per direction.
 */
export const MINOR_LEG_DESIGN_HOUR_VPH_BY_CLASS: Record<number, number> = {
  0: 2500, // motorway
  1: 2000, // trunk
  2: 1500, // primary
  3: 1000, // secondary
  4: 700,  // tertiary
};
const DEFAULT_MINOR_LEG_VPH = 1000;

export const DIRS: Direction[] = ["NB", "SB", "EB", "WB"];

/**
 * Bearing from the node to where each approach's traffic COMES FROM. An
 * approach is named by its direction of travel: NB traffic arrives from the
 * south leg (180°). Mirrors row-math APPROACH_ORIGIN_BEARING.
 */
export const ORIGIN_BEARING: Record<Direction, number> = { NB: 180, SB: 0, EB: 270, WB: 90 };
const DIR_AT_ORIGIN: Record<number, Direction> = { 0: "SB", 90: "WB", 180: "NB", 270: "EB" };

/** The approach whose leg a movement from `from` exits through (spec §4.3). */
export const EXIT_LEG: Record<Direction, Record<Movement, Direction>> = {
  NB: { T: "SB", L: "EB", R: "WB" },
  SB: { T: "NB", L: "WB", R: "EB" },
  EB: { T: "WB", L: "NB", R: "SB" },
  WB: { T: "EB", L: "SB", R: "NB" },
};

/**
 * Quantize each incident link to the nearest cardinal and name the approach
 * that arrives along it. Two links on one cardinal (a skewed five-leg): keep
 * the higher class (lower cls; tie → first seen) and count the other as
 * dropped — a 4×4 matrix cannot carry a fifth leg and pretending otherwise
 * would fabricate a movement.
 */
export function assignLegsToApproaches(legs: JunctionLeg[]): {
  byDir: Partial<Record<Direction, JunctionLeg>>;
  dropped: number;
} {
  const byDir: Partial<Record<Direction, JunctionLeg>> = {};
  let dropped = 0;
  for (const leg of legs) {
    if (!Number.isFinite(leg.bearingDeg)) { dropped++; continue; }
    const b = ((leg.bearingDeg % 360) + 360) % 360;
    const cardinal = (Math.round(b / 90) * 90) % 360;
    const dir = DIR_AT_ORIGIN[cardinal]!;
    const cur = byDir[dir];
    if (!cur) { byDir[dir] = leg; continue; }
    dropped++;
    if (leg.cls < cur.cls) byDir[dir] = leg;
  }
  return { byDir, dropped };
}
```

Then add the export to `lib/tis-engine-core/src/index.ts` after the `utdf-import` line:

```ts
export * from "./leg-volumes.ts";
```

- [ ] **Step 4: Register the check and run it**

In `artifacts/tis-api-server/package.json`, after the `"check:signal-timing-overrides"` line add:

```json
    "check:leg-volumes": "node ./scripts/verify-leg-volumes.mjs",
```

Run: `cd artifacts/tis-api-server && pnpm run check:leg-volumes`
Expected: 5 PASS lines, `OVERALL: PASS`.

- [ ] **Step 5: Typecheck the engine core**

Run: `pnpm run typecheck:libs`
Expected: clean (no output besides tsc build).

- [ ] **Step 6: Commit**

```bash
git add lib/tis-engine-core/src/leg-volumes.ts lib/tis-engine-core/src/index.ts artifacts/tis-api-server/scripts/verify-leg-volumes.mjs artifacts/tis-api-server/package.json
git commit -m "feat(engine): leg-volumes module — types, class ladder, leg→approach assignment

First leaf of the leg-volume / movement-estimation work (spec
2026-09-16). Wired to nothing; adds check:leg-volumes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `resolveLegVolumes` — main road, class default, one-way, CSV override

**Files:**
- Modify: `lib/tis-engine-core/src/leg-volumes.ts`
- Modify: `artifacts/tis-api-server/scripts/verify-leg-volumes.mjs`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  ```ts
  export type LegVolumeInputs = {
    /** The signal's design hour (vph) — AnalyzerIntersection.totalVolume. */
    signalDesignHourVph: number;
    /** Client link counts already snapped to this junction's legs (PR 3 fills this; empty until then). */
    csv?: Partial<Record<Direction, { enteringVph?: number; exitingVph?: number }>>;
  };
  export function resolveLegVolumes(byDir: Partial<Record<Direction, JunctionLeg>>, inputs: LegVolumeInputs): LegVolumes;
  ```

- [ ] **Step 1: Add the failing assertions**

Append to `verify-leg-volumes.mjs` before the `OVERALL` line:

```js
// ---- 2. per-leg resolution (spec §4.2 steps 2–4, amended: per-signal data) ----
{
  // Four-leg: NB/SB on a primary (cls 2), EB/WB on a tertiary (cls 4). Design hour 2700.
  const byDir = {
    NB: { bearingDeg: 180, cls: 2, oneWay: null }, SB: { bearingDeg: 0, cls: 2, oneWay: null },
    EB: { bearingDeg: 270, cls: 4, oneWay: null }, WB: { bearingDeg: 90, cls: 4, oneWay: null },
  };
  const legs = core.resolveLegVolumes(byDir, { signalDesignHourVph: 2700 });
  ok(legs.NB.source === "signal_aadt" && legs.SB.source === "signal_aadt", "resolve: the two highest-class legs are the main road");
  ok(close(legs.NB.enteringVph, 1350) && close(legs.NB.exitingVph, 1350) && close(legs.SB.enteringVph, 1350), "resolve: main road = design hour / 2 each way, each leg");
  ok(legs.EB.source === "class_default" && close(legs.EB.enteringVph, 350) && close(legs.EB.exitingVph, 350), "resolve: tertiary minor leg = 700 two-way baseline / 2");
  ok(DIRS.every((d) => legs[d].cls === byDir[d].cls), "resolve: each leg carries its class");
}
{
  // Tie on class among three legs: the most opposite pair is the main road.
  const byDir = {
    NB: { bearingDeg: 180, cls: 3, oneWay: null }, SB: { bearingDeg: 0, cls: 3, oneWay: null },
    EB: { bearingDeg: 270, cls: 3, oneWay: null }, WB: { bearingDeg: 90, cls: 4, oneWay: null },
  };
  const legs = core.resolveLegVolumes(byDir, { signalDesignHourVph: 1000 });
  ok(legs.NB.source === "signal_aadt" && legs.SB.source === "signal_aadt" && legs.EB.source === "class_default",
    "resolve: class tie breaks toward the opposite pair (NB/SB), not the third leg");
}
{
  // T-intersection: no WB leg.
  const byDir = {
    NB: { bearingDeg: 180, cls: 2, oneWay: null }, SB: { bearingDeg: 0, cls: 2, oneWay: null },
    EB: { bearingDeg: 270, cls: 4, oneWay: null },
  };
  const legs = core.resolveLegVolumes(byDir, { signalDesignHourVph: 2000 });
  ok(legs.WB === null, "resolve: absent leg is null");
  ok(legs.EB.source === "class_default", "resolve: T stem is the minor leg");
}
{
  // One-way main road: SB leg carries traffic INTO the node only, NB leg OUT only.
  const byDir = {
    NB: { bearingDeg: 180, cls: 2, oneWay: "out" }, SB: { bearingDeg: 0, cls: 2, oneWay: "in" },
    EB: { bearingDeg: 270, cls: 4, oneWay: null }, WB: { bearingDeg: 90, cls: 4, oneWay: null },
  };
  const legs = core.resolveLegVolumes(byDir, { signalDesignHourVph: 1800 });
  ok(close(legs.SB.enteringVph, 1800) && legs.SB.exitingVph === 0, "resolve: one-way-in main leg takes the whole design hour entering, 0 exiting");
  ok(legs.NB.enteringVph === 0 && close(legs.NB.exitingVph, 1800), "resolve: one-way-out main leg takes it all exiting, 0 entering");
}
{
  // CSV override wins on its leg; other legs unchanged.
  const byDir = {
    NB: { bearingDeg: 180, cls: 2, oneWay: null }, SB: { bearingDeg: 0, cls: 2, oneWay: null },
    EB: { bearingDeg: 270, cls: 4, oneWay: null }, WB: { bearingDeg: 90, cls: 4, oneWay: null },
  };
  const legs = core.resolveLegVolumes(byDir, { signalDesignHourVph: 2700, csv: { EB: { enteringVph: 520, exitingVph: 480 } } });
  ok(legs.EB.source === "csv" && legs.EB.enteringVph === 520 && legs.EB.exitingVph === 480, "resolve: csv leg overrides the class default");
  ok(legs.WB.source === "class_default" && close(legs.WB.enteringVph, 350), "resolve: csv on one leg leaves the others alone");
  const half = core.resolveLegVolumes(byDir, { signalDesignHourVph: 2700, csv: { EB: { enteringVph: 520 } } });
  ok(half.EB.source === "csv" && half.EB.enteringVph === 520 && half.EB.exitingVph === null, "resolve: csv entering-only leaves exiting unknown (null), never invented");
}
{
  const legs = core.resolveLegVolumes({ NB: { bearingDeg: 180, cls: 2, oneWay: null }, SB: { bearingDeg: 0, cls: 2, oneWay: null } }, { signalDesignHourVph: 0 });
  ok(legs.NB.enteringVph === 0 && legs.NB.exitingVph === 0 && !Number.isNaN(legs.NB.enteringVph), "resolve: zero design hour → zero, never NaN");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd artifacts/tis-api-server && pnpm run check:leg-volumes`
Expected: `TypeError: core.resolveLegVolumes is not a function`.

- [ ] **Step 3: Implement `resolveLegVolumes`**

Append to `leg-volumes.ts`:

```ts
export type LegVolumeInputs = {
  /** The signal's design hour (vph) — AnalyzerIntersection.totalVolume (AADT × K, or the analyzer's class baseline). */
  signalDesignHourVph: number;
  /** Client link counts already snapped to this junction's legs. Empty until the CSV importer ships. */
  csv?: Partial<Record<Direction, { enteringVph?: number; exitingVph?: number }>>;
};

const pos = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
const angDiff = (a: number, b: number): number => { const d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };

/** Split a two-way volume onto one leg's two directions, honoring one-way. */
function splitLeg(twoWayVph: number, oneWay: "in" | "out" | null): { entering: number; exiting: number } {
  if (oneWay === "in") return { entering: twoWayVph, exiting: 0 };
  if (oneWay === "out") return { entering: 0, exiting: twoWayVph };
  return { entering: twoWayVph / 2, exiting: twoWayVph / 2 };
}

/**
 * Which two legs are the main road: the two highest-class legs (lowest cls);
 * among more than two tied at the best class, the pair closest to opposite
 * (a through road), so a same-class stem never displaces a through leg.
 */
export function mainRoadLegs(byDir: Partial<Record<Direction, JunctionLeg>>): Direction[] {
  const present = DIRS.filter((d) => byDir[d]);
  if (present.length <= 2) return present;
  const best = Math.min(...present.map((d) => byDir[d]!.cls));
  const tied = present.filter((d) => byDir[d]!.cls === best);
  if (tied.length <= 2) {
    if (tied.length === 2) return tied;
    // One best leg: pair it with the closest-to-opposite among the rest, preferring class.
    const a = tied[0]!;
    const rest = present.filter((d) => d !== a).sort((x, y) =>
      (byDir[x]!.cls - byDir[y]!.cls) || (angDiff(byDir[a]!.bearingDeg, byDir[y]!.bearingDeg) - angDiff(byDir[a]!.bearingDeg, byDir[x]!.bearingDeg)));
    return [a, rest[0]!];
  }
  let bestPair: Direction[] = [tied[0]!, tied[1]!];
  let bestOpp = -1;
  for (let i = 0; i < tied.length; i++) for (let j = i + 1; j < tied.length; j++) {
    const opp = angDiff(byDir[tied[i]!]!.bearingDeg, byDir[tied[j]!]!.bearingDeg);
    if (opp > bestOpp) { bestOpp = opp; bestPair = [tied[i]!, tied[j]!]; }
  }
  return bestPair;
}

/**
 * Per-leg entering / exiting volume with a source label (spec §4.2, amended
 * for per-signal data): csv → signal design hour on the main road → class
 * baseline on the rest. Absent legs are null. Never NaN.
 */
export function resolveLegVolumes(
  byDir: Partial<Record<Direction, JunctionLeg>>,
  inputs: LegVolumeInputs,
): LegVolumes {
  const out: LegVolumes = { NB: null, SB: null, EB: null, WB: null };
  const main = new Set(mainRoadLegs(byDir));
  const designHour = pos(inputs.signalDesignHourVph);
  for (const d of DIRS) {
    const leg = byDir[d];
    if (!leg) continue;
    const csv = inputs.csv?.[d];
    const csvIn = csv && typeof csv.enteringVph === "number" && Number.isFinite(csv.enteringVph) && csv.enteringVph >= 0 ? csv.enteringVph : undefined;
    const csvOut = csv && typeof csv.exitingVph === "number" && Number.isFinite(csv.exitingVph) && csv.exitingVph >= 0 ? csv.exitingVph : undefined;
    if (csvIn !== undefined || csvOut !== undefined) {
      // A count on this leg. Whichever direction the client did not count
      // stays unknown (null) rather than being filled from a baseline — the
      // worksheet says "csv" for this leg and must not mix sources inside it.
      out[d] = { dir: d, enteringVph: csvIn ?? 0, exitingVph: csvOut ?? null, oneWay: leg.oneWay, source: "csv", cls: leg.cls };
      continue;
    }
    const twoWay = main.has(d) ? designHour : (MINOR_LEG_DESIGN_HOUR_VPH_BY_CLASS[leg.cls] ?? DEFAULT_MINOR_LEG_VPH);
    const { entering, exiting } = splitLeg(twoWay, leg.oneWay);
    out[d] = { dir: d, enteringVph: entering, exitingVph: exiting, oneWay: leg.oneWay, source: main.has(d) ? "signal_aadt" : "class_default", cls: leg.cls };
  }
  return out;
}
```

- [ ] **Step 4: Run the check**

Run: `cd artifacts/tis-api-server && pnpm run check:leg-volumes`
Expected: all PASS, `OVERALL: PASS`.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm run typecheck:libs` → clean.

```bash
git add lib/tis-engine-core/src/leg-volumes.ts artifacts/tis-api-server/scripts/verify-leg-volumes.mjs
git commit -m "feat(engine): resolveLegVolumes — main road from the signal's design hour, class baseline on minor legs, csv override

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `estimateMovements` — geometry seed + Furness/IPF + shares

**Files:**
- Modify: `lib/tis-engine-core/src/leg-volumes.ts`
- Modify: `artifacts/tis-api-server/scripts/verify-leg-volumes.mjs`

**Interfaces:**
- Consumes: `LegVolumes`, `EXIT_LEG`, `DIRS`.
- Produces:
  ```ts
  export type MovementEstimate = {
    matrix: Record<Direction, Record<Direction, number>>;   // [from approach][exit leg's approach], vph
    shares: Record<Direction, Record<Movement, number>>;     // per approach, Σ = 1
    leftVph: Record<Direction, number>;
    enteringShares: Record<Direction, number>;               // leg entering / total, Σ = 1 (0 on absent legs)
    totalEnteringVph: number;
    diagnostics: { method: "ipf" | "seed_only"; iterations: number; maxResidualVph: number; imbalancePct: number; exitsNormalized: boolean; constrainedExits: number };
  };
  export function estimateMovements(legs: LegVolumes): MovementEstimate;
  export const IPF_TOLERANCE_VPH = 0.5; export const IPF_MAX_ITER = 50; export const EXIT_IMBALANCE_NORMALIZE_PCT = 0.05;
  ```

- [ ] **Step 1: Add the failing assertions**

Append before `OVERALL`:

```js
// ---- 3. movement estimation (spec §4.3, §9 items 1–7) ----
const legsFrom = (spec) => {
  const out = { NB: null, SB: null, EB: null, WB: null };
  for (const d of DIRS) {
    const s = spec[d]; if (!s) continue;
    out[d] = { dir: d, enteringVph: s.in, exitingVph: s.out === undefined ? null : s.out, oneWay: s.oneWay ?? null, source: "signal_aadt", cls: 2 };
  }
  return out;
};
const rowSum = (m, d) => DIRS.reduce((s, t) => s + m[d][t], 0);
const colSum = (m, t) => DIRS.reduce((s, d) => s + m[d][t], 0);
{
  // 1. Reference four-leg: entering (600, 400, 300, 200) exiting (550, 450, 280, 220). Σ both = 1500.
  //    Seed 15/70/15 → IPF with the exact row-then-column order and the final
  //    row pass of the implementation. Reference values from an independent
  //    Python run of the same algorithm (13 iterations, final residual 0.318):
  //      NB→SB 398.9  NB→EB 130.6  NB→WB  70.5   | 600.0
  //      SB→NB 353.4  SB→EB  30.2  SB→WB  16.3   | 400.0
  //      EB→NB 132.3  EB→SB  34.6  EB→WB 133.1   | 300.0
  //      WB→NB  64.0  WB→SB  16.7  WB→EB 119.3   | 200.0
  //      cols  549.7        450.3        280.1        220.0
  const est = core.estimateMovements(legsFrom({ NB: { in: 600, out: 550 }, SB: { in: 400, out: 450 }, EB: { in: 300, out: 280 }, WB: { in: 200, out: 220 } }));
  ok(est.diagnostics.method === "ipf" && est.diagnostics.constrainedExits === 4, "ipf: four constrained exit columns");
  ok(DIRS.every((d) => close(rowSum(est.matrix, d), { NB: 600, SB: 400, EB: 300, WB: 200 }[d])), "ipf: every row sums to its entering volume ±0.5");
  ok(DIRS.every((t) => close(colSum(est.matrix, t), { NB: 550, SB: 450, EB: 280, WB: 220 }[t])), "ipf: every column sums to its exiting volume ±0.5");
  ok(DIRS.every((d) => est.matrix[d][d] === 0), "ipf: diagonal (U-turn) is 0");
  ok(close(est.matrix.NB.SB, 398.9, 0.3) && close(est.matrix.SB.NB, 353.4, 0.3) && close(est.matrix.EB.WB, 133.1, 0.3) && close(est.matrix.WB.EB, 119.3, 0.3),
    "ipf: reproduces the reference through cells within 0.3 vph");
  ok(close(est.matrix.NB.EB, 130.6, 0.3) && close(est.matrix.SB.WB, 16.3, 0.3), "ipf: reproduces the reference turn cells within 0.3 vph");
  ok(est.diagnostics.iterations === 13 && close(est.diagnostics.maxResidualVph, 0.318, 0.01), "ipf: 13 iterations, final residual 0.318 — the exact reference trajectory");
  ok(est.diagnostics.maxResidualVph <= 0.5 && est.diagnostics.iterations <= 50, "ipf: converged within tolerance and the iteration cap");
  ok(DIRS.every((d) => close(est.shares[d].L + est.shares[d].T + est.shares[d].R, 1, 1e-9)), "ipf: shares sum to 1 per approach");
  ok(close(est.leftVph.NB, est.matrix.NB.EB, 1e-9), "ipf: NB left exits through the EB approach's leg (west), β+90°");
  ok(close(est.totalEnteringVph, 1500, 1e-9) && close(est.enteringShares.NB, 0.4, 1e-9), "ipf: total and entering shares");
}
{
  // 2. T-intersection: no WB leg. NB/SB through road, EB stem.
  const est = core.estimateMovements(legsFrom({ NB: { in: 500, out: 480 }, SB: { in: 450, out: 470 }, EB: { in: 200, out: 200 } }));
  ok(est.matrix.EB.WB === 0 && est.matrix.EB.SB > 0 && est.matrix.EB.NB > 0, "T: stem row has no through, only L and R");
  ok(DIRS.every((d) => est.matrix[d].WB === 0) && DIRS.every((t) => est.matrix.WB[t] === 0), "T: absent leg's row and column are all-zero");
  ok(close(est.shares.EB.T, 0, 1e-9) && close(est.shares.EB.L + est.shares.EB.R, 1, 1e-9), "T: stem shares are L+R = 1");
  ok(close(rowSum(est.matrix, "NB"), 500) && close(colSum(est.matrix, "EB"), 200), "T: rows and constrained columns balance");
}
{
  // 3. One-way main road: the SB leg only enters (in 600, out 0), the NB leg only exits (in 0, out 600) —
  //    exactly what resolveLegVolumes produces for a one-way pair. Reference: 6 iterations, residual 0.140.
  const est = core.estimateMovements(legsFrom({ NB: { in: 0, out: 600, oneWay: "out" }, SB: { in: 600, out: 0, oneWay: "in" }, EB: { in: 200, out: 250 }, WB: { in: 250, out: 200 } }));
  ok(DIRS.every((d) => est.matrix[d].SB === 0), "one-way: nothing exits through a one-way-in leg");
  ok(close(rowSum(est.matrix, "SB"), 600) && rowSum(est.matrix, "NB") === 0, "one-way: one-way-out leg has an empty row, one-way-in row balances");
  ok(close(colSum(est.matrix, "NB"), 600), "one-way: everything exiting north goes through the one-way-out leg");
}
{
  // 4. Missing exits on two legs: those columns unconstrained; constrained ones hit target; rows exact.
  //    Reference: 17 iterations; the final row pass leaves the constrained columns at 549.5 / 449.9.
  const est = core.estimateMovements(legsFrom({ NB: { in: 600, out: 550 }, SB: { in: 400, out: 450 }, EB: { in: 300 }, WB: { in: 200 } }));
  ok(est.diagnostics.constrainedExits === 2, "missing exits: two constrained columns");
  ok(close(colSum(est.matrix, "NB"), 550, 1.0) && close(colSum(est.matrix, "SB"), 450, 1.0), "missing exits: constrained columns within 1 vph of target after the final row pass");
  ok(DIRS.every((d) => close(rowSum(est.matrix, d), { NB: 600, SB: 400, EB: 300, WB: 200 }[d], 1e-6)), "missing exits: rows exact (the final pass lands on entering)");
}
{
  // 5. Imbalance > 5%: exits (1800) vs entering (1500) → normalized to 1500, flagged; rows exact.
  const est = core.estimateMovements(legsFrom({ NB: { in: 600, out: 660 }, SB: { in: 400, out: 540 }, EB: { in: 300, out: 336 }, WB: { in: 200, out: 264 } }));
  ok(est.diagnostics.exitsNormalized === true && close(est.diagnostics.imbalancePct, 0.2, 1e-6), "imbalance: exits normalized, 20% recorded");
  ok(close(colSum(est.matrix, "NB"), 550) && DIRS.every((d) => close(rowSum(est.matrix, d), { NB: 600, SB: 400, EB: 300, WB: 200 }[d])), "imbalance: columns scaled to entering, rows exact");
}
{
  // 6. Pathological: exits concentrated on a leg the seed barely feeds. Terminates, finite, no NaN.
  const est = core.estimateMovements(legsFrom({ NB: { in: 1000, out: 10 }, SB: { in: 10, out: 10 }, EB: { in: 10, out: 1000 }, WB: { in: 10, out: 10 } }));
  ok(est.diagnostics.iterations <= 50 && Number.isFinite(est.diagnostics.maxResidualVph), "pathological: terminates at the cap with a finite residual");
  ok(DIRS.every((d) => DIRS.every((t) => Number.isFinite(est.matrix[d][t]))), "pathological: no NaN anywhere in the matrix");
}
{
  // 7. No exit volumes at all → seed only: 15/70/15 on a four-leg.
  const est = core.estimateMovements(legsFrom({ NB: { in: 600 }, SB: { in: 400 }, EB: { in: 300 }, WB: { in: 200 } }));
  ok(est.diagnostics.method === "seed_only" && close(est.shares.NB.T, 0.70, 1e-9) && close(est.shares.NB.L, 0.15, 1e-9), "seed_only: no constraints → 15/70/15 prior");
}
{
  // Zero-entering approach keeps finite default shares so downstream never divides by zero.
  const est = core.estimateMovements(legsFrom({ NB: { in: 0, out: 100 }, SB: { in: 300, out: 100 }, EB: { in: 100, out: 100 }, WB: { in: 100, out: 200 } }));
  ok(close(est.shares.NB.L + est.shares.NB.T + est.shares.NB.R, 1, 1e-9) && est.leftVph.NB === 0, "zero entering: shares finite (seed), left 0");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd artifacts/tis-api-server && pnpm run check:leg-volumes`
Expected: `TypeError: core.estimateMovements is not a function`.

- [ ] **Step 3: Implement `estimateMovements`**

Append to `leg-volumes.ts`:

```ts
export const IPF_TOLERANCE_VPH = 0.5;
export const IPF_MAX_ITER = 50;
export const EXIT_IMBALANCE_NORMALIZE_PCT = 0.05;

/** Four-leg prior — today's 15/70/15, now only a seed. */
const SEED_SHARE: Record<Movement, number> = { L: 0.15, T: 0.70, R: 0.15 };
/** Through-road approach at a T (one turn possible): 85/15. */
const SEED_T_THROUGH = 0.85;

export type MovementEstimate = {
  /** matrix[from][to] in vph — `to` is the approach whose leg the movement exits through. Diagonal always 0. */
  matrix: Record<Direction, Record<Direction, number>>;
  /** Per-approach L/T/R shares, Σ = 1 (finite even on a zero or absent approach). */
  shares: Record<Direction, Record<Movement, number>>;
  leftVph: Record<Direction, number>;
  /** Each leg's entering volume over the total, Σ = 1; 0 on absent legs. */
  enteringShares: Record<Direction, number>;
  totalEnteringVph: number;
  diagnostics: {
    method: "ipf" | "seed_only";
    iterations: number;
    maxResidualVph: number;
    imbalancePct: number;
    exitsNormalized: boolean;
    constrainedExits: number;
  };
};

const zeroMatrix = (): Record<Direction, Record<Direction, number>> => ({
  NB: { NB: 0, SB: 0, EB: 0, WB: 0 }, SB: { NB: 0, SB: 0, EB: 0, WB: 0 },
  EB: { NB: 0, SB: 0, EB: 0, WB: 0 }, WB: { NB: 0, SB: 0, EB: 0, WB: 0 },
});

/** Seed shares for one approach, respecting which exits physically exist. */
function seedRow(from: Direction, legs: LegVolumes): Record<Movement, number> {
  const fromLeg = legs[from];
  const can = (m: Movement): boolean => {
    const to = legs[EXIT_LEG[from][m]];
    return !!fromLeg && fromLeg.oneWay !== "out" && !!to && to.oneWay !== "in";
  };
  const avail: Movement[] = (["L", "T", "R"] as const).filter(can);
  const w: Record<Movement, number> = { L: 0, T: 0, R: 0 };
  if (avail.length === 0) return w;
  if (avail.length === 3) { w.L = SEED_SHARE.L; w.T = SEED_SHARE.T; w.R = SEED_SHARE.R; return w; }
  if (!avail.includes("T")) { for (const m of avail) w[m] = 1 / avail.length; return w; }   // a stem: L/R only
  w.T = avail.length === 1 ? 1 : SEED_T_THROUGH;                                              // through road at a T
  for (const m of avail) if (m !== "T") w[m] = (1 - w.T) / (avail.length - 1);
  return w;
}

/**
 * Balance the movements against the legs (spec §4.3): seed by geometry, then
 * Furness/IPF — rows to entering, constrained columns to exiting — until the
 * largest residual is ≤ 0.5 vph or 50 iterations. Never NaN.
 */
export function estimateMovements(legs: LegVolumes): MovementEstimate {
  const entering: Record<Direction, number> = { NB: 0, SB: 0, EB: 0, WB: 0 };
  const exiting: Record<Direction, number | null> = { NB: null, SB: null, EB: null, WB: null };
  for (const d of DIRS) {
    const l = legs[d];
    if (!l) continue;
    entering[d] = pos(l.enteringVph);
    exiting[d] = l.exitingVph === null ? null : pos(l.exitingVph);
  }
  const totalEnteringVph = DIRS.reduce((s, d) => s + entering[d], 0);

  // Seed matrix in vph.
  const seedShares: Record<Direction, Record<Movement, number>> = { NB: seedRow("NB", legs), SB: seedRow("SB", legs), EB: seedRow("EB", legs), WB: seedRow("WB", legs) };
  const m = zeroMatrix();
  for (const from of DIRS) for (const mv of ["L", "T", "R"] as const) m[from][EXIT_LEG[from][mv]] = entering[from] * seedShares[from][mv];

  // Column targets: only legs with a known exit volume constrain.
  const present = DIRS.filter((d) => legs[d]);
  const constrained = present.filter((d) => exiting[d] !== null);
  const sumExit = constrained.reduce((s, d) => s + (exiting[d] as number), 0);
  const allConstrained = constrained.length === present.length && present.length > 0;
  const imbalancePct = allConstrained && totalEnteringVph > 0 ? Math.abs(sumExit - totalEnteringVph) / totalEnteringVph : 0;
  let exitsNormalized = false;
  const target: Record<Direction, number | null> = { ...exiting };
  if (allConstrained && imbalancePct > EXIT_IMBALANCE_NORMALIZE_PCT && sumExit > 0) {
    const k = totalEnteringVph / sumExit;
    for (const d of constrained) target[d] = (exiting[d] as number) * k;
    exitsNormalized = true;
  }

  let iterations = 0;
  let maxResidualVph = 0;
  const residual = (): number => {
    let r = 0;
    for (const d of DIRS) r = Math.max(r, Math.abs(DIRS.reduce((s, t) => s + m[d][t], 0) - entering[d]));
    for (const t of constrained) r = Math.max(r, Math.abs(DIRS.reduce((s, d) => s + m[d][t], 0) - (target[t] as number)));
    return r;
  };
  if (constrained.length > 0) {
    for (iterations = 1; iterations <= IPF_MAX_ITER; iterations++) {
      for (const d of DIRS) {
        const rs = DIRS.reduce((s, t) => s + m[d][t], 0);
        if (rs > 0) { const k = entering[d] / rs; for (const t of DIRS) m[d][t] *= k; }
      }
      for (const t of constrained) {
        const cs = DIRS.reduce((s, d) => s + m[d][t], 0);
        if (cs > 0) { const k = (target[t] as number) / cs; for (const d of DIRS) m[d][t] *= k; }
      }
      maxResidualVph = residual();
      if (maxResidualVph <= IPF_TOLERANCE_VPH) break;
    }
    if (iterations > IPF_MAX_ITER) iterations = IPF_MAX_ITER;
    // Rows are what capacity consumes: land on them exactly after the last column pass.
    for (const d of DIRS) {
      const rs = DIRS.reduce((s, t) => s + m[d][t], 0);
      if (rs > 0) { const k = entering[d] / rs; for (const t of DIRS) m[d][t] *= k; }
    }
    maxResidualVph = residual();
  }

  const shares: Record<Direction, Record<Movement, number>> = { NB: { L: 0, T: 0, R: 0 }, SB: { L: 0, T: 0, R: 0 }, EB: { L: 0, T: 0, R: 0 }, WB: { L: 0, T: 0, R: 0 } };
  const leftVph: Record<Direction, number> = { NB: 0, SB: 0, EB: 0, WB: 0 };
  const enteringShares: Record<Direction, number> = { NB: 0, SB: 0, EB: 0, WB: 0 };
  for (const from of DIRS) {
    const rs = DIRS.reduce((s, t) => s + m[from][t], 0);
    const seedSum = seedShares[from].L + seedShares[from].T + seedShares[from].R;
    for (const mv of ["L", "T", "R"] as const) {
      shares[from][mv] = rs > 0
        ? m[from][EXIT_LEG[from][mv]] / rs
        : seedSum > 0 ? seedShares[from][mv] / seedSum : SEED_SHARE[mv];   // zero/absent approach: finite prior
    }
    leftVph[from] = m[from][EXIT_LEG[from].L];
    enteringShares[from] = totalEnteringVph > 0 ? entering[from] / totalEnteringVph : 0;
  }
  for (const d of DIRS) for (const t of DIRS) if (!Number.isFinite(m[d][t])) m[d][t] = 0;

  return {
    matrix: m, shares, leftVph, enteringShares, totalEnteringVph,
    diagnostics: { method: constrained.length > 0 ? "ipf" : "seed_only", iterations, maxResidualVph, imbalancePct, exitsNormalized, constrainedExits: constrained.length },
  };
}

/** One call for the server: legs → estimate, or undefined when nothing is present. */
export type LegEstimate = { legs: LegVolumes; movements: MovementEstimate; legsDropped: number; anyCsv: boolean };
export function buildLegEstimate(junctionLegs: JunctionLeg[], inputs: LegVolumeInputs): LegEstimate | undefined {
  const { byDir, dropped } = assignLegsToApproaches(junctionLegs);
  if (DIRS.every((d) => !byDir[d])) return undefined;
  const legs = resolveLegVolumes(byDir, inputs);
  const movements = estimateMovements(legs);
  const anyCsv = DIRS.some((d) => legs[d]?.source === "csv");
  return { legs, movements, legsDropped: dropped, anyCsv };
}
```

- [ ] **Step 4: Run the check**

Run: `cd artifacts/tis-api-server && pnpm run check:leg-volumes`
Expected: all PASS, `OVERALL: PASS`. The reference cells and iteration counts come from an independent implementation of the same algorithm (row pass, constrained-column pass, break on residual ≤ 0.5, then one final row pass); a miss means the implementation's pass order or break condition differs from the one written in Step 3 — fix the implementation, never the reference or the tolerance.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm run typecheck:libs` → clean.

```bash
git add lib/tis-engine-core/src/leg-volumes.ts artifacts/tis-api-server/scripts/verify-leg-volumes.mjs
git commit -m "feat(engine): estimateMovements — geometry seed + Furness/IPF balancing with diagnostics

Rows land on entering, constrained columns on exiting (normalized to
entering above 5% imbalance), 0.5 vph / 50 iterations; T, one-way and
missing-exit geometries pinned; never NaN.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Row-math consumption under `legVolumes: "network"`, byte-identical otherwise

**Files:**
- Modify: `lib/tis-engine-core/src/row-math.ts` (`ScenarioParams` ~685, `RowCandidate` ~269, `laneGroupsForApproach` ~576, `resolveTimingForRow` ~773, `buildAffectedRow` ~822–1310, `AffectedIntersection` ~343)
- Modify: `artifacts/tis-api-server/scripts/verify-leg-volumes.mjs`

**Interfaces:**
- Consumes: `LegEstimate`, `MovementEstimate` from Task 3.
- Produces: `ScenarioParams.legVolumes?: "network" | "screening"`; `RowCandidate.legEstimate?: LegEstimate`; on `AffectedIntersection`: `volumeSource?: "utdf_tmc" | "synchro_pdf_tmc" | "network_estimate" | "link_csv"`, `legVolumes?: Array<{ direction: Direction; enteringVph: number; exitingVph: number | null; source: LegSource; oneWay: "in" | "out" | null }>`, `movementEstimate?: { method; iterations; maxResidualVph; imbalancePct; exitsNormalized; constrainedExits; legsDropped: number; matrix: Record<Direction, Record<Direction, number>>; shares: Record<Direction, Record<Movement, number>> }`.

- [ ] **Step 1: Write the failing row-math assertions**

Append before `OVERALL` in `verify-leg-volumes.mjs`:

```js
// ---- 4. row-math consumption: screening/absent byte-identical; network uses the estimate; measured wins ----
{
  // 1200 vph design hour (not the McKnight-scale 2700): with one lane per
  // direction the leg volumes must keep the critical flow ratio under the
  // Webster saturation guard (Y ≥ 0.85 → basis "screening-default"), or the
  // timing assertion below would be testing the guard, not the estimate.
  const sig = { id: "sig-1", name: "Main St & Oak Ave", zone: "Z", latitude: 40.5, longitude: -80.0, totalVolume: 1200 };
  const project = { lat: 40.51, lon: -80.01 };
  // distributionOctants so project trips get per-movement rows — without it the
  // lane-group allocator has no movement basis and (correctly) prints none.
  const octants = { NNE: 12.5, ENE: 12.5, ESE: 12.5, SSE: 12.5, SSW: 12.5, WSW: 12.5, WNW: 12.5, NNW: 12.5 };
  const base = { growthMultiplier: 1.05, capacityVph: 3240, approachCapacityVph: 810, externalTrips: 120, inFraction: 0.6, signalTiming: "computed", weatherFactor: 1, distributionOctants: octants };
  const junction = [
    { bearingDeg: 180, cls: 2, oneWay: null }, { bearingDeg: 0, cls: 2, oneWay: null },
    { bearingDeg: 270, cls: 4, oneWay: null }, { bearingDeg: 90, cls: 4, oneWay: null },
  ];
  const estimate = core.buildLegEstimate(junction, { signalDesignHourVph: 1200 });
  const cand = (extra) => ({ sig, distanceMi: 0.4, ...extra });

  const legacy = core.buildAffectedRow(cand({}), 0.5, project, base);
  const screening = core.buildAffectedRow(cand({ legEstimate: estimate }), 0.5, project, { ...base, legVolumes: "screening" });
  const absent = core.buildAffectedRow(cand({}), 0.5, project, { ...base, legVolumes: "network" });
  ok(JSON.stringify(screening) === JSON.stringify(legacy), "row: legVolumes:screening with an estimate attached is byte-identical to today");
  ok(JSON.stringify(absent) === JSON.stringify(legacy), "row: legVolumes:network with NO estimate is byte-identical to today");

  const network = core.buildAffectedRow(cand({ legEstimate: estimate }), 0.5, project, { ...base, legVolumes: "network" });
  ok(network.volumeSource === "network_estimate", "row: network mode labels volumeSource network_estimate");
  ok(close(network.designHourVolumeVph, 1200 + 700, 1e-6), "row: design hour = Σ entering (main 2×600 + minor 2×350)");
  const nb = network.approaches.find((a) => a.direction === "NB");
  const eb = network.approaches.find((a) => a.direction === "EB");
  ok(close(nb.existingVolumeVph, 600 * 1.05, 0.2) && close(eb.existingVolumeVph, 350 * 1.05, 0.2), "row: approach no-build volumes are the leg volumes grown");
  ok(Array.isArray(network.legVolumes) && network.legVolumes.length === 4 && network.legVolumes.find((l) => l.direction === "EB").source === "class_default", "row: legVolumes provenance rides the row");
  ok(network.movementEstimate && network.movementEstimate.method === "ipf" && network.movementEstimate.matrix.NB.NB === 0, "row: movementEstimate diagnostics + matrix ride the row");
  ok(Array.isArray(nb.laneGroups) && nb.laneGroups.length === 3, "row: lane groups (L/T/R) exist without a UTDF record");
  ok(network.signalTiming && network.signalTiming.basis === "webster", "row: timing still resolves (Webster) from the leg volumes");

  // Measured UTDF record wins outright over the estimate.
  const utdf = { latitude: 40.5, longitude: -80.0, volumes: { NBL: 100, NBT: 800, NBR: 100, SBL: 90, SBT: 700, SBR: 90, EBL: 40, EBT: 200, EBR: 40, WBL: 30, WBT: 150, WBR: 30 } };
  const measured = core.buildAffectedRow(cand({ utdf, legEstimate: estimate }), 0.5, project, { ...base, legVolumes: "network" });
  ok(measured.volumeSource === "utdf_tmc" && measured.legVolumes === undefined, "row: a measured record wins outright; no estimate fields printed");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd artifacts/tis-api-server && pnpm run check:leg-volumes`
Expected: FAIL lines for `network mode labels volumeSource network_estimate` (and the following network assertions); the two byte-identical lines PASS.

- [ ] **Step 3: Extend the types**

In `row-math.ts`, add to the imports at the top (next to the `webster-timing` import):

```ts
import type { LegEstimate, LegSource } from "./leg-volumes.ts";
```

In `ScenarioParams` (after `signalTiming?: "computed" | "screening";`):

```ts
  /** Mirrors TisRequest.legVolumes. "network" consumes the candidate's
   *  legEstimate (per-leg volumes + balanced movements); "screening" or
   *  absent ignores it and keeps the 30/25/25/20 + 15/70/15 basis, byte for
   *  byte. */
  legVolumes?: "network" | "screening";
```

In `RowCandidate` (after `timingOverride?`):

```ts
  /** Per-leg volumes + balanced movements for this junction (buildLegEstimate),
   *  computed by the server from the routing graph. Consumed only under
   *  params.legVolumes === "network" and only when no measured record is
   *  attached. */
  legEstimate?: LegEstimate;
```

In `AffectedIntersection`, change the `volumeSource` line to:

```ts
  volumeSource?: "utdf_tmc" | "synchro_pdf_tmc" | "network_estimate" | "link_csv";
  /** Per-leg background volumes and where each came from (legVolumes: network). */
  legVolumes?: Array<{ direction: Direction; enteringVph: number; exitingVph: number | null; source: LegSource; oneWay: "in" | "out" | null }>;
  /** Balanced turning-movement estimate and its diagnostics (legVolumes: network). */
  movementEstimate?: {
    method: "ipf" | "seed_only";
    iterations: number;
    maxResidualVph: number;
    imbalancePct: number;
    exitsNormalized: boolean;
    constrainedExits: number;
    legsDropped: number;
    matrix: Record<Direction, Record<Direction, number>>;
    shares: Record<Direction, Record<Movement, number>>;
  };
```

- [ ] **Step 4: Let `laneGroupsForApproach` take shares without a record**

Change the option `utdf: UtdfIntersectionInput;` to:

```ts
  /** Measured record; when absent, `shares` supplies the background L/T/R split. */
  utdf?: UtdfIntersectionInput;
  /** Background L/T/R shares from the movement estimate (Σ = 1). Used only when `utdf` is absent. */
  shares?: Record<Movement, number>;
```

And replace the first lines of the body

```ts
  const { approach, utdf, approachVolumeVph, addedExactByMovement } = opts;
  const vols = utdf.volumes ?? {};
  const measured: Record<Movement, number> = { L: 0, T: 0, R: 0 };
  let measuredApproachTotal = 0;
  for (const m of ["L", "T", "R"] as const) {
    const v = vols[`${approach}${m}` as UtdfMovement];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      measured[m] = v;
      measuredApproachTotal += v;
    }
  }
```

with

```ts
  const { approach, utdf, approachVolumeVph, addedExactByMovement } = opts;
  const vols = utdf?.volumes ?? {};
  const measured: Record<Movement, number> = { L: 0, T: 0, R: 0 };
  let measuredApproachTotal = 0;
  if (utdf) {
    for (const m of ["L", "T", "R"] as const) {
      const v = vols[`${approach}${m}` as UtdfMovement];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        measured[m] = v;
        measuredApproachTotal += v;
      }
    }
  } else if (opts.shares) {
    for (const m of ["L", "T", "R"] as const) {
      const v = opts.shares[m];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        measured[m] = v;
        measuredApproachTotal += v;
      }
    }
  }
```

Further down in the same function, `const storage = utdf.storageFt ?? {};` and `const laneCounts = utdf.lanes ?? {};` become `utdf?.storageFt ?? {}` and `utdf?.lanes ?? {}`.

- [ ] **Step 5: Consume the estimate in `buildAffectedRow`**

Right after `const measured = c.utdf ? utdfMeasuredTotals(c.utdf) : undefined;` add:

```ts
  // Per-leg volumes + balanced movements (legVolumes: network). A measured
  // record wins outright — never blended — and "screening" / absent ignores
  // the estimate entirely so the row stays byte-identical to today.
  const est = !measured && params.legVolumes === "network" && c.legEstimate && c.legEstimate.movements.totalEnteringVph > 0
    ? c.legEstimate
    : undefined;
```

Change `const baseVolume = (measured ? measured.totalVph : c.sig.totalVolume) * (params.periodVolumeFactor ?? 1);` to:

```ts
  const baseVolume = (measured ? measured.totalVph : est ? est.movements.totalEnteringVph : c.sig.totalVolume) * (params.periodVolumeFactor ?? 1);
```

Change `const volShares = measured ? measured.shares : approachVolumeShares(c.sig.id);` to:

```ts
  const volShares = measured ? measured.shares : est ? est.movements.enteringShares : approachVolumeShares(c.sig.id);
```

Change the `resolveTimingForRow(c, measured, utdfCycleLenS, noBuildByApproach, lanesPerDir, params)` call to pass the estimate:

```ts
  const timing = resolveTimingForRow(c, measured, utdfCycleLenS, noBuildByApproach, lanesPerDir, params, est);
```

and extend `resolveTimingForRow`'s signature with a trailing optional parameter `est?: LegEstimate`, replacing the `leftVph` block with:

```ts
  let leftVph: Partial<Record<Direction, number>> | undefined;
  const vols = measured && c.utdf ? c.utdf.volumes : undefined;
  if (vols) {
    leftVph = {};
    for (const d of DIRECTIONS) {
      const l = vols[`${d}L` as UtdfMovement], t = vols[`${d}T` as UtdfMovement], r = vols[`${d}R` as UtdfMovement];
      const posv = (v: number | undefined): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
      const tot: number = posv(l) + posv(t) + posv(r);
      if (tot > 0 && typeof l === "number" && Number.isFinite(l) && l >= 0) leftVph[d] = approachVph[d] * (l / tot);
    }
  } else if (est) {
    // Estimated left share, applied to the same no-build approach volume.
    leftVph = {};
    for (const d of DIRECTIONS) leftVph[d] = approachVph[d] * est.movements.shares[d].L;
  }
```

In the lane-groups IIFE, change `if (!c.utdf) return {};` to `if (!c.utdf && !est) return {};` and the `laneGroupsForApproach({ approach: d, utdf: c.utdf, ...` call to:

```ts
        const laneGroups = laneGroupsForApproach({
          approach: d,
          ...(c.utdf ? { utdf: c.utdf } : { shares: est!.movements.shares[d] }),
          approachVolumeVph: baseVol,
```

Change `designHourVolumeVph: measured ? measured.totalVph : c.sig.totalVolume,` (~line 1207) to:

```ts
    designHourVolumeVph: measured ? measured.totalVph : est ? est.movements.totalEnteringVph : c.sig.totalVolume,
```

In the row's provenance spread, after the existing `...(measured ? { volumeSource: ... } : {})` block add:

```ts
    // Leg-volume provenance, presence-gated on the estimate having been
    // consumed, so screening-mode and legacy rows carry no new field.
    ...(est
      ? {
          volumeSource: (est.anyCsv ? "link_csv" : "network_estimate") as "link_csv" | "network_estimate",
          legVolumes: DIRECTIONS.flatMap((d) => {
            const l = est.legs[d];
            return l ? [{ direction: d, enteringVph: round1(l.enteringVph), exitingVph: l.exitingVph === null ? null : round1(l.exitingVph), source: l.source, oneWay: l.oneWay }] : [];
          }),
          movementEstimate: {
            method: est.movements.diagnostics.method,
            iterations: est.movements.diagnostics.iterations,
            maxResidualVph: round2(est.movements.diagnostics.maxResidualVph),
            imbalancePct: round3(est.movements.diagnostics.imbalancePct),
            exitsNormalized: est.movements.diagnostics.exitsNormalized,
            constrainedExits: est.movements.diagnostics.constrainedExits,
            legsDropped: est.legsDropped,
            matrix: Object.fromEntries(DIRECTIONS.map((d) => [d, Object.fromEntries(DIRECTIONS.map((t) => [t, round1(est.movements.matrix[d][t])]))])) as Record<Direction, Record<Direction, number>>,
            shares: Object.fromEntries(DIRECTIONS.map((d) => [d, { L: round3(est.movements.shares[d].L), T: round3(est.movements.shares[d].T), R: round3(est.movements.shares[d].R) }])) as Record<Direction, Record<Movement, number>>,
          },
        }
      : {}),
```

- [ ] **Step 6: Run the check and the whole engine check set**

Run: `cd artifacts/tis-api-server && pnpm run check:leg-volumes`
Expected: all PASS.

Run the engine checks that pin row-math output (they must not change):
`pnpm run check:movement-loading && pnpm run check:signal-timing-overrides && pnpm run check:vc-plausibility-guard && pnpm run check:conserved-assignment && pnpm run check:trip-loading`
Expected: each ends in its PASS line.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm run typecheck` (workspace) → every package `Done`.

```bash
git add lib/tis-engine-core/src/row-math.ts artifacts/tis-api-server/scripts/verify-leg-volumes.mjs
git commit -m "feat(engine): rows consume the leg estimate under legVolumes:network — approach shares, L/T/R lane groups, estimated lefts for timing

A measured record wins outright; screening or an absent estimate is
byte-identical to today (pinned in check:leg-volumes).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Server wiring — junction legs from the conserved graph, request field, methodology clause

**Files:**
- Create: `artifacts/tis-api-server/src/lib/junction-legs.ts`
- Modify: `artifacts/tis-api-server/src/lib/tis.ts` (~1756–1892 conserved block; params at ~1954 and ~2254; `tisMethodologyForRegion` ~1230 and `TIS_METHODOLOGY` ~1212)
- Modify: `lib/tis-api-spec/openapi.yaml`, then codegen

**Interfaces:**
- Consumes: `Graph`, `Link` from `./network-assignment`; `JunctionSnap` from `./cordon-gateways`; `buildLegEstimate`, `JunctionLeg` from `@workspace/tis-engine-core`.
- Produces: `incidentLinks(g: Graph): Map<number, number[]>`; `junctionLegsAtNode(g: Graph, node: number, incidence: Map<number, number[]>): JunctionLeg[]`; `StudyCandidate.legEstimate?: LegEstimate`; request `legVolumes?: "network" | "screening"`.

- [ ] **Step 1: Write the failing check for `junctionLegsAtNode`**

Create the check inline in `verify-leg-volumes.mjs` (before `OVERALL`):

```js
// ---- 5. server: incident links → JunctionLeg[] (bearing, class, one-way sense) ----
{
  const { buildGraph } = await import(path.resolve(here, "../src/lib/network-assignment.ts"));
  const { junctionLegsAtNode, incidentLinks } = await import(path.resolve(here, "../src/lib/junction-legs.ts"));
  // RoadSegment tuple: [cls, lat1, lon1, lat2, lon2, lanes|null, maxspeed|null, name?, oneway?]
  // (oneway: 1 = a→b only, -1 = b→a only, 0 = two-way). Cross at (40.5, -80.0):
  // N and S legs primary two-way; E leg tertiary one-way b→a i.e. INTO the node; W leg tertiary two-way.
  const segs = [
    [2, 40.5, -80.0, 40.51, -80.0, null, null, "Main St", 0],
    [2, 40.49, -80.0, 40.5, -80.0, null, null, "Main St", 0],
    [4, 40.5, -80.0, 40.5, -79.99, null, null, "Oak Ave", -1],   // a = node, b = east; b→a only = travel toward the node
    [4, 40.5, -80.01, 40.5, -80.0, null, null, "Oak Ave", 0],    // a = west, b = node
  ];
  const g = buildGraph(segs);
  const node = g.nodeOf(40.5, -80.0);
  const legs = junctionLegsAtNode(g, node, incidentLinks(g));
  ok(legs.length === 4, "legs: four incident links — including the one-way link INTO the node that routing adjacency omits");
  const byCard = Object.fromEntries(legs.map((l) => [Math.round(l.bearingDeg / 90) * 90 % 360, l]));
  ok(byCard[0]?.cls === 2 && byCard[180]?.cls === 2 && byCard[90]?.cls === 4 && byCard[270]?.cls === 4, "legs: bearing and class per leg");
  ok(byCard[90]?.oneWay === "in" && byCard[0]?.oneWay === null && byCard[270]?.oneWay === null, "legs: one-way sense is relative to the node (east leg enters only)");
  ok(g.adj[node].length === 3, "legs: (sanity) routing adjacency at the node has only 3 links — why incidentLinks() exists");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd artifacts/tis-api-server && pnpm run check:leg-volumes`
Expected: `Cannot find module '.../src/lib/junction-legs.ts'`.

- [ ] **Step 3: Implement `junction-legs.ts`**

```ts
/**
 * Incident links at a routing-graph node, described the way the leg-volume
 * resolver wants them: bearing from the node to the far end, OSM class, and
 * the one-way sense RELATIVE TO THE NODE ("in" = traffic can only travel
 * toward it). Link.dir is stored a→b (+1), b→a (-1), two-way (0), so the
 * sense flips depending on which end the node is.
 *
 * NOT built from Graph.adj: that is the ROUTING adjacency, and a one-way link
 * is deliberately listed at only the node it can be traversed FROM
 * (network-assignment.ts buildGraph), so a one-way link INTO a junction is
 * absent from adj[junction]. A leg you can only arrive by is still a leg.
 * incidentLinks() scans link endpoints once per graph instead.
 */
import type { JunctionLeg } from "@workspace/tis-engine-core";
import type { Graph } from "./network-assignment";

function bearingDeg(la1: number, lo1: number, la2: number, lo2: number): number {
  const p = Math.PI / 180;
  const y = Math.sin((lo2 - lo1) * p) * Math.cos(la2 * p);
  const x = Math.cos(la1 * p) * Math.sin(la2 * p) - Math.sin(la1 * p) * Math.cos(la2 * p) * Math.cos((lo2 - lo1) * p);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** node → indices of every link touching it, regardless of direction. Build once per graph. */
export function incidentLinks(g: Graph): Map<number, number[]> {
  const m = new Map<number, number[]>();
  const add = (n: number, li: number) => { const arr = m.get(n); if (arr) arr.push(li); else m.set(n, [li]); };
  g.links.forEach((lk, li) => { if (lk.a !== lk.b) { add(lk.a, li); add(lk.b, li); } });
  return m;
}

export function junctionLegsAtNode(g: Graph, node: number, incidence: Map<number, number[]>): JunctionLeg[] {
  const out: JunctionLeg[] = [];
  for (const li of incidence.get(node) ?? []) {
    const lk = g.links[li];
    if (!lk) continue;
    const far = lk.a === node ? lk.b : lk.a;
    const oneWay: JunctionLeg["oneWay"] =
      lk.dir === 0 ? null
      : lk.a === node ? (lk.dir === 1 ? "out" : "in")
      : (lk.dir === 1 ? "in" : "out");
    out.push({
      bearingDeg: bearingDeg(g.nodeLat[node]!, g.nodeLon[node]!, g.nodeLat[far]!, g.nodeLon[far]!),
      cls: lk.cls,
      oneWay,
    });
  }
  return out;
}
```

Run the check → the four `legs:` lines PASS.

- [ ] **Step 4: Add `legVolumes` to the OpenAPI request and response, regenerate**

In `lib/tis-api-spec/openapi.yaml`, directly after the `signalTiming:` request property block (~line 953–970) add:

```yaml
        legVolumes:
          type: string
          enum: [network, screening]
          default: network
          description: >-
            Background volume basis per study intersection (default network).
            `network`: each leg carries its own volume — the signal's counted
            design hour on the two main-road legs (half per direction), the
            road-class baseline on uncounted minor legs, a client link count
            where supplied — and turning movements are balanced against the
            exit legs by iterative proportional fitting (NCHRP 255/765
            refinement). `screening`: the legacy 30/25/25/20 approach split
            and 15/70/15 turn shares, byte-identical to the pre-change output.
            A measured Synchro/UTDF record on a junction wins over either.
```

In the AffectedIntersection response schema, change `volumeSource` to:

```yaml
        volumeSource:
          type: string
          enum: [utdf_tmc, synchro_pdf_tmc, network_estimate, link_csv]
        legVolumes:
          type: array
          description: Per-leg background volumes and their source (legVolumes:network rows only).
          items:
            type: object
            required: [direction, enteringVph, exitingVph, source, oneWay]
            properties:
              direction: { type: string, enum: [NB, SB, EB, WB] }
              enteringVph: { type: number }
              exitingVph: { type: number, nullable: true }
              source: { type: string, enum: [csv, signal_aadt, class_default] }
              oneWay: { type: string, enum: ["in", "out"], nullable: true }
        movementEstimate:
          type: object
          description: Balanced turning-movement estimate and diagnostics (legVolumes:network rows only).
          required: [method, iterations, maxResidualVph, imbalancePct, exitsNormalized, constrainedExits, legsDropped, matrix, shares]
          properties:
            method: { type: string, enum: [ipf, seed_only] }
            iterations: { type: integer }
            maxResidualVph: { type: number }
            imbalancePct: { type: number }
            exitsNormalized: { type: boolean }
            constrainedExits: { type: integer }
            legsDropped: { type: integer }
            matrix:
              type: object
              additionalProperties:
                type: object
                additionalProperties: { type: number }
            shares:
              type: object
              additionalProperties:
                type: object
                properties:
                  L: { type: number }
                  T: { type: number }
                  R: { type: number }
```

Run: `pnpm --filter @workspace/tis-api-spec run codegen`
Expected: orval regenerates `lib/tis-api-zod/src/generated/**` (a new `tisRequestLegVolumes.ts` appears) and `typecheck:libs` passes.

- [ ] **Step 5: Wire `tis.ts`**

Add imports near the other engine-core / lib imports at the top of `tis.ts`:

```ts
import { buildLegEstimate, type LegEstimate } from "@workspace/tis-engine-core";
import { incidentLinks, junctionLegsAtNode } from "./junction-legs";
```

`candidates` are `StudyCandidate`s (`tis.ts:699`) and the same objects flow into `buildAffectedRow`, so add the field to that type, after `utdfIndex?`:

```ts
  /** Per-leg volumes + balanced movements for this junction (buildLegEstimate),
   *  computed from the conserved-assignment graph once the signal resolved to
   *  a node. Consumed by buildAffectedRow under legVolumes: network only. */
  legEstimate?: LegEstimate;
```

Inside the conserved block, immediately after `const snaps = snapSignalsToJunctions(cg, candidates.map(...));` (~line 1827) add:

```ts
        // Per-leg background volumes + balanced movements for every resolved
        // junction (legVolumes: network). Computed here because this is the
        // one place the study holds the routing graph and each signal's node.
        // Unresolved signals get no estimate and keep the screening split,
        // labeled — never a blend. Pure and cheap (a 4×4 IPF per signal).
        if (req.legVolumes !== "screening") {
          const incidence = incidentLinks(cg);
          for (let i = 0; i < candidates.length; i++) {
            const snap = snaps[i]!;
            if (snap.node < 0) continue;
            const c = candidates[i]!;
            const est = buildLegEstimate(junctionLegsAtNode(cg, snap.node, incidence), { signalDesignHourVph: c.sig.totalVolume });
            if (est) c.legEstimate = est;
          }
        }
```

Add `legVolumes` to BOTH `ScenarioParams` constructions — the per-period one (~line 1959) and the PM one in `synthesizePmReport` (~line 2254) — right after their `signalTiming:` entries:

```ts
      legVolumes: req.legVolumes === "screening" ? "screening" : "network",
```

Methodology clause swap. Next to `FLAT_SIGNAL_CLAUSE` (~line 1226) add:

```ts
const FLAT_LEG_CLAUSE = "(deterministic per-signal allocation perturbed ±15% from a 30/25/25/20 base)";
const RESOLVED_LEG_CLAUSE =
  "(each leg from its own volume: the signal's counted design hour on the two main-road legs, half per direction; the road-class baseline on uncounted minor legs; a client link count where supplied — each worksheet states the source per leg. Turning movements are then balanced to the exit legs by iterative proportional fitting from a geometry seed, the refinement method of NCHRP Report 255 / NCHRP Report 765, so entries equal exits at every resolved junction; a junction that does not resolve to the road network keeps the screening allocation and says so)";
```

Change the signature to `function tisMethodologyForRegion(region: Region, signalTiming: "computed" | "screening" = "computed", legVolumes: "network" | "screening" = "network"): string[]` and make `base`:

```ts
  const base = TIS_METHODOLOGY.map((m) => {
    let s = m;
    if (signalTiming === "computed" && s.includes(FLAT_SIGNAL_CLAUSE)) s = s.replace(FLAT_SIGNAL_CLAUSE, RESOLVED_SIGNAL_CLAUSE);
    if (legVolumes === "network" && s.includes(FLAT_LEG_CLAUSE)) s = s.replace(FLAT_LEG_CLAUSE, RESOLVED_LEG_CLAUSE);
    return s;
  });
```

Verify `TIS_METHODOLOGY[…]` (line 1212) contains the exact string `(deterministic per-signal allocation perturbed ±15% from a 30/25/25/20 base)` — it does today; if the sentence has drifted, set `FLAT_LEG_CLAUSE` to the current parenthetical verbatim. Update the call site (~line 2166) to:

```ts
      ...tisMethodologyForRegion(region, req.signalTiming === "screening" ? "screening" : "computed", req.legVolumes === "screening" ? "screening" : "network"),
```

- [ ] **Step 6: Typecheck, run the checks, commit**

Run: `pnpm run typecheck` → all `Done`.
Run: `cd artifacts/tis-api-server && pnpm run check:leg-volumes && pnpm run check:conserved-assignment && pnpm run check:cordon-gateways` → PASS.

```bash
git add artifacts/tis-api-server/src/lib/junction-legs.ts artifacts/tis-api-server/src/lib/tis.ts lib/tis-api-spec/openapi.yaml lib/tis-api-zod/src/generated artifacts/tis-api-server/scripts/verify-leg-volumes.mjs
git commit -m "feat(api): legVolumes request field — junction legs from the conserved graph feed the estimate; methodology clause resolves

Default network; screening keeps the legacy allocation byte for byte.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Renderer — provenance line, estimated diagram splits, balanced matrix, appendix-intro variant

**Files:**
- Modify: `artifacts/tis-api-server/src/lib/pdf-export.ts` (`drawTurningMovementDiagram` ~9040–9050; `renderCapacityAppendix` intro ~9325–9340 and worksheet body after the `rows(...)` block ~9415)
- Create: `artifacts/tis-api-server/scripts/verify-leg-volumes-render.mjs`
- Modify: `artifacts/tis-api-server/package.json`

**Interfaces:**
- Consumes: row fields `legVolumes`, `movementEstimate`, `volumeSource` from Task 4 (read as `any` in the renderer, like every other row field there).

- [ ] **Step 1: Write the failing render check**

Create `artifacts/tis-api-server/scripts/verify-leg-volumes-render.mjs`:

```js
// Renderer side of leg volumes: a row carrying legVolumes/movementEstimate
// prints the provenance line, the balanced matrix and the resolved appendix
// wording; a legacy row prints none of it (byte-identity is pinned by
// check:theme-default-identity, which must keep passing WITHOUT re-pinning).
// Run: node ./scripts/verify-leg-volumes-render.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs");

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };

async function text(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out += tc.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  await doc.destroy();
  return out.replace(/\s+/g, " ");
}

const { mod, cleanup } = await loadRendererBundle();
try {
  const fx = loadFixture("ny");
  const legacy = await text(await mod.renderStudyPdf(projectFromFixture(fx), { name: "Leg Render Check", logoUrl: null }));
  ok(!legacy.includes("Leg volumes:"), "legacy fixture prints no provenance line");
  ok(!legacy.includes("balanced to the exit legs"), "legacy fixture keeps the screening appendix wording");

  const injected = JSON.parse(JSON.stringify(fx));
  const row = injected.report.affectedIntersections[0];
  row.volumeSource = "network_estimate";
  row.legVolumes = [
    { direction: "NB", enteringVph: 1350, exitingVph: 1350, source: "signal_aadt", oneWay: null },
    { direction: "SB", enteringVph: 1350, exitingVph: 1350, source: "signal_aadt", oneWay: null },
    { direction: "EB", enteringVph: 350, exitingVph: 350, source: "class_default", oneWay: null },
    { direction: "WB", enteringVph: 350, exitingVph: 350, source: "class_default", oneWay: null },
  ];
  row.movementEstimate = {
    method: "ipf", iterations: 6, maxResidualVph: 0.3, imbalancePct: 0, exitsNormalized: false, constrainedExits: 4, legsDropped: 0,
    matrix: { NB: { NB: 0, SB: 1000, EB: 200, WB: 150 }, SB: { NB: 1000, SB: 0, EB: 150, WB: 200 }, EB: { NB: 100, SB: 50, EB: 0, WB: 200 }, WB: { NB: 50, SB: 100, EB: 200, WB: 0 } },
    shares: { NB: { L: 0.148, T: 0.741, R: 0.111 }, SB: { L: 0.148, T: 0.741, R: 0.111 }, EB: { L: 0.286, T: 0.571, R: 0.143 }, WB: { L: 0.286, T: 0.571, R: 0.143 } },
  };
  const t = await text(await mod.renderStudyPdf(projectFromFixture(injected), { name: "Leg Render Check", logoUrl: null }));
  ok(t.includes("Leg volumes: 2 of 4 from the signal's counted design hour"), "injected row prints the leg provenance line");
  ok(t.includes("balanced estimate (Furness/IPF, 6 iterations, residual 0.3 vph)"), "injected row prints the movement diagnostics");
  ok(t.includes("Balanced turning movements (vph)"), "injected row prints the 4×4 matrix table");
  ok(t.includes("balanced to the exit legs"), "appendix intro switches to the resolved wording when any row carries an estimate");
} finally {
  await cleanup();
}
console.log(fails === 0 ? "\nOVERALL: PASS" : `\nOVERALL: FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
```

Register in `package.json` after `check:leg-volumes`:

```json
    "check:leg-volumes-render": "node ./scripts/verify-leg-volumes-render.mjs",
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd artifacts/tis-api-server && pnpm run check:leg-volumes-render`
Expected: the two `legacy` lines PASS, the four `injected` lines FAIL.

- [ ] **Step 3: Diagram splits from the estimate**

In `drawTurningMovementDiagram`, replace

```ts
  const split = (v: number) => { const l = Math.round(v * 0.15), r = Math.round(v * 0.15); return { l, t: v - l - r, r }; };
```

with

```ts
  // Background L/T/R: the balanced estimate's shares when the row carries
  // one (legVolumes: network), else the screening 15/70/15 the appendix
  // intro discloses. Left and right round; through takes the remainder so
  // the three always sum to the approach total.
  const estShares: Record<string, { L: number; T: number; R: number }> | undefined =
    ix.movementEstimate && ix.movementEstimate.shares ? ix.movementEstimate.shares : undefined;
  const split = (v: number, dir: string) => {
    const s = estShares?.[dir];
    const lS = s && Number.isFinite(s.L) ? s.L : 0.15;
    const rS = s && Number.isFinite(s.R) ? s.R : 0.15;
    const l = Math.round(v * lS), r = Math.round(v * rS);
    return { l, t: v - l - r, r };
  };
```

and in `block`, change `const m = split(volOf(a));` to `const m = split(volOf(a), dir);`.

- [ ] **Step 4: Worksheet provenance line + matrix table**

In `renderCapacityAppendix`'s per-intersection loop, immediately after the UTDF provenance `if (ix.volumeSource === "utdf_tmc") { … }` block (and its `synchro_pdf_tmc` sibling if present) and before the diagrams, add:

```ts
    // Leg-volume provenance (legVolumes: network). Presence-gated on the
    // fields the row carries, so screening-mode and legacy payloads print
    // nothing here and stay byte-identical.
    if (Array.isArray(ix.legVolumes) && ix.legVolumes.length > 0 && ix.movementEstimate) {
      const legs: any[] = ix.legVolumes;
      const n = legs.length;
      const count = (src: string) => legs.filter((l) => l.source === src).length;
      const parts: string[] = [];
      if (count("csv") > 0) parts.push(`${count("csv")} of ${n} from client link counts (CSV)`);
      if (count("signal_aadt") > 0) parts.push(`${count("signal_aadt")} of ${n} from the signal's counted design hour (half per direction)`);
      if (count("class_default") > 0) parts.push(`${count("class_default")} of ${n} from the road-class baseline (no count on that leg)`);
      const me = ix.movementEstimate;
      const mv = me.method === "ipf"
        ? `balanced estimate (Furness/IPF, ${me.iterations} iterations, residual ${Number(me.maxResidualVph).toFixed(1)} vph${me.exitsNormalized ? `; exits scaled to entries, ${(Number(me.imbalancePct) * 100).toFixed(0)}% imbalance` : ""})`
        : "geometry seed only (no exit volume to balance against)";
      doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
        `Leg volumes: ${parts.join("; ")}. Turning movements: ${mv}.${me.legsDropped > 0 ? ` ${me.legsDropped} extra leg not carried (4×4 matrix).` : ""}`,
        { paragraphGap: 4 },
      );
      doc.fillColor("black");
    }
```

Then, after the diagrams' caption block (the `if (multiPeriod) { … }` that ends with `doc.moveDown(0.2);`) and before `const approaches: any[] = …`, add the matrix table:

```ts
    // The balanced 4×4 in vph so a reviewer can check Σin = Σout by hand.
    if (ix.movementEstimate && ix.movementEstimate.matrix) {
      const mx: Record<string, Record<string, number>> = ix.movementEstimate.matrix;
      const dirs = ["NB", "SB", "EB", "WB"];
      const present = dirs.filter((d) => dirs.some((t) => (mx[d]?.[t] ?? 0) > 0) || dirs.some((f) => (mx[f]?.[d] ?? 0) > 0));
      const rowsOut = present.map((d) => [
        `${d} approach`,
        ...present.map((t) => (t === d ? "—" : fmtNum(mx[d]?.[t] ?? 0))),
        fmtNum(present.reduce((s, t) => s + (mx[d]?.[t] ?? 0), 0)),
      ]);
      rowsOut.push(["Σ exiting", ...present.map((t) => fmtNum(present.reduce((s, d) => s + (mx[d]?.[t] ?? 0), 0))), ""]);
      const spec: TableSpec = {
        headers: ["Balanced turning movements (vph)", ...present.map((t) => `→ ${t} leg`), "Σ entering"],
        widths: [150, ...present.map(() => 66), 70],
        align: ["left", ...present.map(() => "right" as const), "right"],
        rows: rowsOut,
      };
      keepHeadingWith(doc, "Balanced turning movements (vph)", 0, tableHeight(doc, spec));
      table(doc, spec);
      doc.font("body").fontSize(8).fillColor(TEXT_GRAY).text(
        "Columns are the leg each movement exits through; the diagonal (U-turn) is folded into the left turn. Entries equal exits at this junction within the stated residual.",
        { paragraphGap: 4 },
      );
      doc.fillColor("black");
    }
```

(`keepHeadingWith`, `tableHeight`, `table`, `TableSpec`, `fmtNum`, `TEXT_GRAY` already exist in this file.)

- [ ] **Step 5: Appendix-intro variant**

In `renderCapacityAppendix`, the amber paragraph currently begins `"Background turning-movement volumes in the diagrams are distributed from each approach total using an " + "estimated 15/70/15 (Left/Through/Right) split. …"`. Wrap it:

```ts
  const anyLegEstimate = Array.isArray(intersections) && intersections.some((x: any) => Array.isArray(x?.legVolumes) && x?.movementEstimate);
  doc.font("body").fontSize(9).fillColor("#b45309").text(
    anyLegEstimate
      ? "Background approach volumes are resolved per leg — the signal's counted design hour on the main road, the road-class baseline on uncounted legs, client link counts where supplied — and the background turning movements in the diagrams are balanced to the exit legs by iterative proportional fitting (NCHRP 255/765 refinement) from a geometry seed; each worksheet states its leg sources and residual. Project-trip movements are assigned geometrically from the study's directional trip distribution (see each worksheet's Affected movements table). Replace both with measured turning-movement counts (TMCs) before a formal submittal."
      : "Background turning-movement volumes in the diagrams are distributed from each approach total using an "
        + "estimated 15/70/15 (Left/Through/Right) split. Project-trip movements are assigned geometrically from "
        + "the study's directional trip distribution (see each worksheet's Affected movements table). Replace both "
        + "with measured turning-movement counts (TMCs) before a formal submittal.",
    { paragraphGap: 8 },
  );
```

(Keep the legacy string byte-for-byte — it is part of the pinned identity output.)

- [ ] **Step 6: Run the render check, the identity guard (no re-pin), and the pagination check**

Run: `cd artifacts/tis-api-server && pnpm run check:leg-volumes-render` → all PASS.
Run: `pnpm run check:theme-default-identity` → `ALL PASS` **without** `--pin`. If any family fails, a legacy path changed — find the un-gated edit and gate it; do not re-pin.
Run: `pnpm run check:appendix-worksheet-pages` → PASS (the matrix table is inside the keep-together budget).
Run: `pnpm run check:theme-render` → ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/tis-api-server/src/lib/pdf-export.ts artifacts/tis-api-server/scripts/verify-leg-volumes-render.mjs artifacts/tis-api-server/package.json
git commit -m "feat(pdf): worksheets print leg-volume provenance, estimated diagram splits and the balanced 4×4; appendix intro resolves

Presence-gated on the row's legVolumes/movementEstimate; legacy and
screening payloads byte-identical (identity guard unchanged).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: UI — "Leg volumes" select on `/tis`; explorer leg source

**Files:**
- Modify: `artifacts/atlanta-tis/src/pages/tis.tsx` (form, next to the Weather select ~line 704)
- Modify: `artifacts/atlanta-tis/src/lib/intersection-geometry.ts` (`ApproachPlan` ~97, `planFromRow`)

**Interfaces:**
- Consumes: generated `TisRequest["legVolumes"]` from Task 5's codegen; row `legVolumes` from Task 4.

- [ ] **Step 1: Add the select**

In `tis.tsx`, after the Weather `<label>…</label>` block add:

```tsx
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Leg volumes
                </span>
                <select
                  className="w-full px-3 py-2 rounded-md border bg-background text-sm"
                  value={form.legVolumes ?? "network"}
                  onChange={(e) => setForm({ ...form, legVolumes: e.target.value as NonNullable<TisRequest["legVolumes"]> })}
                  data-testid="select-leg-volumes"
                >
                  <option value="network">Network estimate — each leg its own volume, movements balanced (default)</option>
                  <option value="screening">Screening split — 30/25/25/20 and 15/70/15 (legacy)</option>
                </select>
              </label>
```

- [ ] **Step 2: Explorer — leg source per approach**

In `intersection-geometry.ts`, add to `ApproachPlan` (the `ApproachBase & { … }` type) a field:

```ts
  /** Where this approach's background volume came from (legVolumes: network rows). */
  legSource?: "csv" | "signal_aadt" | "class_default";
```

In `planFromRow`, where each approach's plan object is assembled from `row.approaches`, add:

```ts
    ...(() => {
      const leg = Array.isArray((row as any).legVolumes) ? (row as any).legVolumes.find((l: any) => l.direction === a.direction) : undefined;
      return leg?.source ? { legSource: leg.source } : {};
    })(),
```

and add a label helper next to `lanesSourceLabel`:

```ts
/** Human label for a leg-volume provenance. */
export function legSourceLabel(s: NonNullable<ApproachPlan["legSource"]>): string {
  switch (s) {
    case "csv": return "client link count";
    case "signal_aadt": return "signal's counted design hour";
    default: return "road-class baseline";
  }
}
```

Find the Lanes-tab render site with `grep -rn "lanesSourceLabel(" artifacts/atlanta-tis/src` (it is the one call site outside `intersection-geometry.ts`; the approach object there is the `ApproachPlan` — note its local variable name). Directly after that call's JSX, on the same line/element, append (same text style; substitute the local variable for `ap`):

```tsx
{ap.legSource ? <span className="text-muted-foreground"> · volume: {legSourceLabel(ap.legSource)}</span> : null}
```

and add `legSourceLabel` to that file's import from `../lib/intersection-geometry` alongside `lanesSourceLabel`.

- [ ] **Step 3: Typecheck the UI and run the UI's own checks**

Run: `pnpm --filter @workspace/atlanta-tis run typecheck` → Done.
Run: `pnpm --filter @workspace/atlanta-tis run check:distribution-alive` (and any other `check:*` script in `artifacts/atlanta-tis/package.json`) → PASS.

- [ ] **Step 4: Commit**

```bash
git add artifacts/atlanta-tis/src/pages/tis.tsx artifacts/atlanta-tis/src/lib/intersection-geometry.ts artifacts/atlanta-tis/src/components/intersection-plan.tsx
git commit -m "feat(ui): Leg volumes select on /tis; explorer Lanes tab shows each approach's volume source

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Full verification, PR

**Files:** none new.

- [ ] **Step 1: Workspace typecheck and the full check suite**

Run: `pnpm run typecheck` → every package `Done`.
Run in `artifacts/tis-api-server`: every `check:*` script (the CI workflow runs them all): `node -e "const s=require('./package.json').scripts; console.log(Object.keys(s).filter(k=>k.startsWith('check:')).join(' '))"` then `pnpm run <each>`; all must end in PASS. `check:theme-default-identity` must pass without re-pinning.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin worktree-leg-volumes
gh pr create --base main --title "feat(engine): leg volumes from the network, turning movements balanced by IPF (default), screening escape hatch" --body-file - <<'EOF'
## Summary
- Replaces the per-signal 30/25/25/20 approach split and flat 15/70/15 / 10/80/10 turn shares with per-leg volumes (main road = the signal's counted design hour, half per direction; minor legs = the road-class baseline, labeled) and turning movements balanced against the exit legs by Furness/IPF from a geometry seed (NCHRP 255/765 refinement). On by default (`legVolumes: "network"`); `"screening"` is byte-identical to today; a measured Synchro/UTDF record wins outright.
- Spec: `docs/superpowers/specs/2026-09-16-leg-volumes-and-movement-estimation-design.md` (§4.2 amended: the AADT join is per signal, not per segment).
- Worksheets print the leg sources, the diagnostics and the balanced 4×4; the appendix intro and methodology resolve; `/tis` gains a Leg volumes select. The CSV link-volume importer is the next PR.

## Test plan
- [ ] `check:leg-volumes` — assignment, resolution, IPF invariants, row-math identity (screening/absent) and consumption (network), measured-wins
- [ ] `check:leg-volumes-render` — provenance/matrix print on injected rows; legacy prints nothing new
- [ ] `check:theme-default-identity` passes **without** re-pin
- [ ] `check:appendix-worksheet-pages`, `check:theme-render`, `check:conserved-assignment`, `check:movement-loading`, `check:signal-timing-overrides` pass
- [ ] Workspace typecheck clean
- [ ] After deploy: one McKnight Road run; McKnight & Johnanna shows the provenance line and a junction total in the 3,300–3,500 vph range

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 3: After merge — regenerate the Allegheny sample (spec §10 step 4)**

Run one demo generation for the McKnight Road site (`private/sample-payloads/` gets `allegheny-<date>.json`), render with `scripts/src/render-county-sample.ts`, run `verify-appendix-worksheet-pages.mjs --pdf`, read the McKnight & Johnanna worksheet, and send the design partner one line saying the background volumes are now per leg and balanced, so the numbers moved. This step is manual and is not part of the code PR.
