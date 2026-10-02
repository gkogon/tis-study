# Scenario-solver fixtures

All three files are REAL engine output — `generateTisReport` on this branch
(Track E2's exact re-solve fields) against the live analyzer at
`https://simpleimpactstudies.com`, each at its own `generatedAt`. No engine
value in them is hand-written; the one hand-written INPUT is C's Synchro
record (its volumes are made up, as any client import's are).

A and B are pinned from a 2026-09-11 run, before rows carried
`legEstimateExact` (their rows reproduce through the legacy screening path).
C was generated after `legVolumes: network` shipped: 39 of its 40 rows carry
`legEstimateExact` and reproduce through the fed-back estimate.

**Re-pinned 2026-10-02 for the intersection-from-approaches change.** The
intersection row's v/c, delay and LOS are now built from its approaches
(`intersectionFromApproaches` in lib/tis-engine-core/src/row-math.ts), so
every row's intersection values moved. All three files were re-pinned in place
from their own printed exact inputs, not regenerated: each row was rebuilt by
the engine's `buildAffectedRow` through `solveScenarioDetailed(file, EMPTY)`
with zero fallbacks, and the write was refused if any field outside the
row-derived set changed. The fields that moved are the intersection-level
`*Vc` / `*DelaySec` / `*Los`, `losChanged`, `mitigation` /
`mitigationSeverity`, the LOS-drop / LOS E–F / worst-delay counts, and
`mitigationSummary`. Every input (`request`, volumes, approaches, movements,
path ledgers, `legEstimateExact`, timing) is byte-identical to the pinned run.
The prose fields (`findings`, `methodology`) are left as pinned; the checks do
not compare them. Regenerating instead would have replaced the 09-11 / 09-17
network state these checks' assertions are written against.

| file | what |
| --- | --- |
| `scenario-base.json` | The Peachtree Multifamily request, verbatim. |
| `scenario-overrides.json` | The same request + two `signalTimingOverrides` (one longer cycle, one protected NS left) + `size` x1.5. |
| `scenario-network-utdf.json` | The same request + ONE `utdfIntersections` record 40 m from the nearest studied signal and inside the 0.35 mi snap radius of others: the engine attaches it to that nearest signal only (`utdf_tmc`, `utdfRecordIndex` 0); the neighbours stay `network_estimate`. |

`scripts/check-scenario-solve.mjs` asserts `solveScenario(base, EMPTY)`
reproduces `scenario-base.json` on every printed row field with NO tolerance,
that `solveScenario(base, <that same scenario state>)` reproduces
`scenario-overrides.json` the same way, and that `solveScenario(C, EMPTY)`
reproduces `scenario-network-utdf.json` with NO `utdfAttach` fallback — the
client must not re-attach the record to a network-estimated neighbour.

Regenerate: `node ../tis-api-server/scripts/make-scenario-fixtures.mjs
--only=network-utdf` (from `artifacts/tis-api-server`) rewrites C alone;
without the flag A and B are rewritten too — see the script header for why
they are currently left pinned. The overrides in B are built by the client's
own `toWhatIfRequest`, so B is exactly what the studio would POST. A fixture
over the 1 MB budget is written as compact JSON and, if still over, trimmed
to the am_peak/pm_peak periods; no row is ever rounded or cut.
