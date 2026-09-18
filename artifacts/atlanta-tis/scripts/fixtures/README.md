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
