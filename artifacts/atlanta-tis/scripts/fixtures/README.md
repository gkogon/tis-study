# Scenario-solver fixtures

Both files are REAL engine output — `generateTisReport` on this branch (Track
E2's exact re-solve fields) against the live analyzer at
`https://simpleimpactstudies.com`. No value in them is hand-written.

| file | what |
| --- | --- |
| `scenario-base.json` | The Peachtree Multifamily request, verbatim. |
| `scenario-overrides.json` | The same request + two `signalTimingOverrides` (one longer cycle, one protected NS left) + `size` x1.5. |

`scripts/check-scenario-solve.mjs` asserts `solveScenario(base, EMPTY)`
reproduces `scenario-base.json` on every printed row field with NO tolerance,
and that `solveScenario(base, <that same scenario state>)` reproduces
`scenario-overrides.json` the same way.

Regenerate: `node ../tis-api-server/scripts/make-scenario-fixtures.mjs`
(from `artifacts/tis-api-server`). The overrides in B are built by the
client's own `toWhatIfRequest`, so B is exactly what the studio would POST.
