// @workspace/tis-engine-core — the pure, dependency-free core of the TIS engine.
//
// Every module here runs under plain `node` (Node 26 type-stripping) and in the
// browser: no logger, db, fetch, fs or process.env. artifacts/tis-api-server's
// tis.ts imports from this package and keeps the impure orchestration (network
// fetches, calibration lookup, region resolution, distribution assets).
//
// Relative imports carry the .ts extension on purpose so the package index
// resolves under Node without the server's ts-loader hook (the check scripts
// import leaf modules with plain `node`).
export * from "./signal-delay.ts";
export * from "./webster-timing.ts";
export * from "./movement-assignment.ts";
export * from "./trip-loading.ts";
export * from "./land-uses.ts";
export * from "./regional-growth-rates.ts";
export * from "./utdf-import.ts";
export * from "./volume-plausibility.ts";
export * from "./turbo-lane.ts";
export * from "./row-math.ts";
export * from "./mitigation.ts";
export * from "./trips.ts";
// webster-timing.ts and movement-assignment.ts both declare `Movement`
// ("L" | "T" | "R"); the engine has always imported it from movement-assignment.
export type { Movement } from "./movement-assignment.ts";
