/**
 * Guard for the Datum chat feature
 * (docs/superpowers/specs/2026-10-20-datum-chat-design.md,
 *  docs/superpowers/plans/2026-10-20-datum-chat.md).
 *
 * Plain `node`, no env, no db: this file reads source text and imports the one
 * pure contract module, so it can never reach a database. Run:
 * `pnpm run check:datum-chat`.
 *
 * Sections, in file order (later tasks append their own):
 *   contract    lib/tis-api-zod/src/datum-chat.ts, imported under plain node.
 *   migrations  lib/db/migrate.mjs and the two drizzle files, read as text.
 *   tools       lib/datum-chat/tools.ts: the allowlist merge and the two strict tool schemas;
 *               lib/datum-chat/contract.ts, the one door the pure modules reach lib/tis-api-zod through.
 *   context     lib/datum-chat/clause-guide.ts and context.ts: the per-clause guide, the capped grounding
 *               pack, and the read-only path reader.
 *   prompt      lib/datum-chat/prompt.ts: the system prompt, the two cached system blocks (prompt with the
 *               full clause guide, then the pack), and the history builder.
 *   run         lib/datum-chat/run.ts: the model tool loop, driven by a fake client (no network, no SDK): one
 *               streamed reply, at most one re-run, four model calls at most, and a client that disconnects.
 *   revise      lib/datum-chat/revise.ts: the re-run orchestration, every dep a fake: the uncharged gate, one
 *               re-run per user, the 25-version cap, the merge, the engine, the coverage warning, the save and the
 *               proofread of the new version, in that order; a failure is logged and answered, never thrown.
 *               The DB side (study-revisions.ts, datum-chat/store.ts) is proved against a real throwaway
 *               Postgres by scripts/proofread-pg-harness, not here.
 *   router      routes/datum-chat-router.ts over real HTTP (express, compression, a fake auth, port 0, fetch),
 *               every dep a fake and the model the run section's fake: 401/404/400/429/503, the stream, the
 *               R12 history, R13/R15 logging, R17 finding ids, Review Focus 2 and 5, the R20 keep-alive (with
 *               a reader that skips comment frames). Then lib/datum-chat/client.ts
 *               (no key: null, and the SDK's name is never resolved, watched by a module resolve hook that
 *               answers it with a stub), the limiter in security.ts, the mount, the wiring and the smoke script,
 *               read as text. The process's ANTHROPIC_API_KEY is deleted first; the check never uses one.
 *   guards      the boundary guards that keep the chat from ever mutating a study: chat-never-mutates-studies,
 *               only-study-revisions-inserts-projects, allowlist-matches-spec, revise-never-charges, client-lazy,
 *               store-reads-proofread-only, and the two docs guards (types-header-names-chat,
 *               spec-addendum-names-chat). Source-text guards read with TypeScript's parser; each has teeth
 *               (a mutation applied in memory that must turn it red by name) and negative controls (code that
 *               must stay allowed, with no guard red).
 *
 * The contract is imported by file URL with no loader: Node strips the types.
 * That works only while datum-chat.ts reaches GenerateTisBody through an explicit
 * `.ts` path, so the import itself is part of what this file checks.
 *
 * Two pitfalls this file is built against, both paid for in verify-proofread*.mjs:
 *   - a helper that silently ignores its argument, so an assertion passes against
 *     input nobody edited; and
 *   - a module that fails to load turning every assertion into a TypeError. Here a
 *     load failure is one named FAIL, and each assertion after it fails by name.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
/** A missing file is a named FAIL and an empty string, so the assertions after it still run and fail by name. */
const read = (rel) => {
  try {
    return readFileSync(path.join(repo, rel), "utf8");
  } catch (e) {
    ok(`precondition: ${rel} is readable`, false, e instanceof Error ? e.message : String(e));
    return "";
  }
};

let fails = 0;
const ok = (name, cond, why) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
  if (!cond) {
    fails++;
    if (why) console.log(`        ${why}`);
  }
};
/** An assertion that throws is a FAIL with the reason, never a crash that hides the rest. */
const t = (name, fn) => {
  try {
    const r = fn();
    ok(name, r === true, r === true || r === false ? undefined : `expected true, got ${JSON.stringify(r)}`);
  } catch (e) {
    ok(name, false, `threw: ${e instanceof Error ? e.message : String(e)}`);
  }
};
const section = (name) => console.log(`\n== ${name}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameSet = (a, b) => same([...a].sort(), [...b].sort());
/** Object.isFrozen(undefined) is true, so a missing export would pass a bare isFrozen. */
const frozen = (v) => typeof v === "object" && v !== null && Object.isFrozen(v);
const accepts = (schema, v) => schema.safeParse(v).success === true;
const rejects = (schema, v) => schema.safeParse(v).success === false;

// ===========================================================================
// contract
// ===========================================================================
section("contract");

const importByUrl = async (rel) => {
  try {
    return { mod: await import(pathToFileURL(path.join(repo, rel)).href), error: null };
  } catch (e) {
    return { mod: {}, error: e instanceof Error ? e.message : String(e) };
  }
};

const { mod: C, error: contractError } = await importByUrl("lib/tis-api-zod/src/datum-chat.ts");
ok("the contract module loads under plain node (no loader)", contractError === null, contractError ?? undefined);
const { mod: G, error: generatedError } = await importByUrl("lib/tis-api-zod/src/generated/api.ts");
ok("precondition: the generated request schema loads, so the contract can be compared with it", generatedError === null, generatedError ?? undefined);

const EXPECTED_REVISABLE = [
  "growthRatePct",
  "removeGrowthOverride",
  "openingYear",
  "analysisPeriods",
  "passByPct",
  "internalCapturePct",
  "weather",
  "scopeStudyIntersections",
  "signalTiming",
  "legVolumes",
  "realLaneGeometry",
  "conservedAssignment",
  "signalTimingOverrides",
];
const EXPECTED_METHOD = ["scopeStudyIntersections", "signalTiming", "legVolumes", "realLaneGeometry", "conservedAssignment"];
const EXPECTED_LIMITS = {
  messageChars: 2000,
  historyMessages: 20,
  modelTurnsPerMessage: 4,
  rerunsPerMessage: 1,
  versionsPerLineage: 25,
  firmRepliesPer24h: 300,
  userMessagesPerHour: 40,
  packBytes: 61440,
  readPathBytes: 8192,
};

t("DATUM_LIMITS holds the spec's nine limits exactly", () => same(Object.entries(C.DATUM_LIMITS).sort(), Object.entries(EXPECTED_LIMITS).sort()));
t("DATUM_LIMITS is frozen", () => frozen(C.DATUM_LIMITS));

t("REVISABLE_FIELDS deep-equals the 13 allowlisted names, in order", () => same(C.REVISABLE_FIELDS, EXPECTED_REVISABLE));
t("REVISABLE_FIELDS is frozen", () => frozen(C.REVISABLE_FIELDS));
t("METHOD_FIELDS deep-equals the five method choices, in order", () => same(C.METHOD_FIELDS, EXPECTED_METHOD));
t("METHOD_FIELDS is frozen", () => frozen(C.METHOD_FIELDS));
t("every METHOD_FIELDS name is a REVISABLE_FIELDS name", () => C.METHOD_FIELDS.every((f) => C.REVISABLE_FIELDS.includes(f)));
t("no field that needs a value from the engineer is a method field", () =>
  ["growthRatePct", "removeGrowthOverride", "openingYear", "analysisPeriods", "passByPct", "internalCapturePct", "weather", "signalTimingOverrides"].every(
    (f) => !C.METHOD_FIELDS.includes(f),
  ));

const bodyKeys = Object.keys(G.GenerateTisBody?.shape ?? {});
t("precondition: GenerateTisBody exposes its keys (a zod object)", () => bodyKeys.length > 20);
t("LOCKED_FIELDS includes latitude, longitude, landUseCode, size, projectName, driveways and utdfIntersections", () =>
  ["latitude", "longitude", "landUseCode", "size", "projectName", "driveways", "utdfIntersections"].every((f) => C.LOCKED_FIELDS.includes(f)));
t("LOCKED_FIELDS shares no name with REVISABLE_FIELDS", () => C.LOCKED_FIELDS.every((f) => !C.REVISABLE_FIELDS.includes(f)));
t("LOCKED_FIELDS is every GenerateTisBody key outside the allowlist, no more and no fewer", () =>
  sameSet(C.LOCKED_FIELDS, bodyKeys.filter((k) => !EXPECTED_REVISABLE.includes(k))));
t("every revisable field but removeGrowthOverride is a GenerateTisBody key, and removeGrowthOverride is not one", () =>
  EXPECTED_REVISABLE.filter((f) => f !== "removeGrowthOverride").every((f) => bodyKeys.includes(f)) && !bodyKeys.includes("removeGrowthOverride"));
t("LOCKED_FIELDS is frozen", () => frozen(C.LOCKED_FIELDS));

// --- DatumChatPostBody -------------------------------------------------------
t("DatumChatPostBody rejects 2001 characters", () => C.DatumChatPostBody.safeParse({ content: "x".repeat(2001) }).success === false);
t("DatumChatPostBody accepts exactly 2000 characters", () => accepts(C.DatumChatPostBody, { content: "x".repeat(2000) }));
t("DatumChatPostBody rejects a blank message", () => C.DatumChatPostBody.safeParse({ content: "  " }).success === false);
t("DatumChatPostBody rejects an unknown key", () => C.DatumChatPostBody.safeParse({ content: "why?", extra: 1 }).success === false);
t("DatumChatPostBody trims the message", () => C.DatumChatPostBody.parse({ content: "  why?  " }).content === "why?");
t("DatumChatPostBody counts the length after trimming", () => accepts(C.DatumChatPostBody, { content: `  ${"x".repeat(2000)}  ` }));
t("DatumChatPostBody takes a finding id only if it is a uuid", () =>
  accepts(C.DatumChatPostBody, { content: "why?", findingId: randomUUID() }) && rejects(C.DatumChatPostBody, { content: "why?", findingId: "not-a-uuid" }));
t("DatumChatPostBody carries no actor, firm or project: they come from the session and the URL", () =>
  rejects(C.DatumChatPostBody, { content: "why?", userId: "u" }) &&
  rejects(C.DatumChatPostBody, { content: "why?", firmId: randomUUID() }) &&
  rejects(C.DatumChatPostBody, { content: "why?", projectId: randomUUID() }));

// --- RerunToolInput ----------------------------------------------------------
const rerun = (changes, extra = {}) => ({ changes, reason: "r", ...extra });
const OVERRIDE = {
  intersectionName: "Main St & 1st Ave",
  latitude: 33.7,
  longitude: -84.4,
  cycleLenSec: 120,
  phases: [
    { movement: "NBT", phase: 2 },
    { movement: "SBT", phase: 6 },
    { movement: "EBT", phase: 4 },
    { movement: "WBT", phase: 8 },
  ],
  splits: [
    { phase: 2, seconds: 40 },
    { phase: 6, seconds: 40 },
    { phase: 4, seconds: 30 },
    { phase: 8, seconds: 30 },
  ],
};
t("RerunToolInput rejects a locked field (latitude)", () => C.RerunToolInput.safeParse({ changes: { latitude: 1 }, reason: "r" }).success === false);
t("RerunToolInput refuses a locked field because the key is unknown to changes, not for some other reason", () => {
  const r = C.RerunToolInput.safeParse(rerun({ latitude: 1 }));
  return r.success === false && r.error.issues.length === 1 && r.error.issues[0].code === "unrecognized_keys" && same(r.error.issues[0].path, ["changes"]);
});
t("RerunToolInput rejects every locked field, not just latitude", () => C.LOCKED_FIELDS.every((f) => rejects(C.RerunToolInput, rerun({ [f]: 1 }))));
t("RerunToolInput rejects growthRatePct 9 (the bound is 6)", () => C.RerunToolInput.safeParse({ changes: { growthRatePct: 9 }, reason: "r" }).success === false);
t("RerunToolInput accepts an empty change set: re-run on the current engine", () =>
  C.RerunToolInput.safeParse({ changes: {}, reason: "re-run on the current engine" }).success === true);
t("RerunToolInput does not inject a default into an empty change set", () => same(C.RerunToolInput.parse(rerun({})).changes, {}));
t("RerunToolInput does not inject a default when only one field is given", () => same(C.RerunToolInput.parse(rerun({ weather: "light_rain" })).changes, { weather: "light_rain" }));
t("RerunToolInput changes carries exactly the 13 revisable fields as keys", () => sameSet(Object.keys(C.RerunToolInput.shape.changes.shape), EXPECTED_REVISABLE));
t("RerunToolInput accepts a value for each revisable field", () =>
  accepts(
    C.RerunToolInput,
    rerun({
      growthRatePct: 1,
      openingYear: 2028,
      analysisPeriods: ["am_peak", "pm_peak"],
      passByPct: 10,
      internalCapturePct: 5,
      weather: "clear",
      scopeStudyIntersections: false,
      signalTiming: "computed",
      legVolumes: "network",
      realLaneGeometry: true,
      conservedAssignment: true,
      signalTimingOverrides: [OVERRIDE],
    }),
  ));
t("RerunToolInput accepts removeGrowthOverride: true, and nothing else for that field", () =>
  accepts(C.RerunToolInput, rerun({ removeGrowthOverride: true })) &&
  rejects(C.RerunToolInput, rerun({ removeGrowthOverride: false })) &&
  rejects(C.RerunToolInput, rerun({ removeGrowthOverride: "yes" })));
t("RerunToolInput takes GenerateTisBody's bounds, probed at and around every edge", () => {
  const probes = [-1, 0, 0.5, 1, 5.99, 6, 6.01, 49.99, 50, 50.01, 69.99, 70, 70.01, 2023, 2024, 2050, 2051];
  return ["growthRatePct", "passByPct", "internalCapturePct", "openingYear"].every((f) =>
    probes.every((v) => G.GenerateTisBody.shape[f].safeParse(v).success === C.RerunToolInput.safeParse(rerun({ [f]: v })).success),
  );
});
t("RerunToolInput refuses the edges just past the bounds: growth 6.01, pass-by 71, capture 51, year 2051", () =>
  rejects(C.RerunToolInput, rerun({ growthRatePct: 6.01 })) &&
  rejects(C.RerunToolInput, rerun({ passByPct: 71 })) &&
  rejects(C.RerunToolInput, rerun({ internalCapturePct: 51 })) &&
  rejects(C.RerunToolInput, rerun({ openingYear: 2051 })) &&
  accepts(C.RerunToolInput, rerun({ growthRatePct: 6, passByPct: 70, internalCapturePct: 50, openingYear: 2050 })));
t("RerunToolInput takes the analysis-period enum array and no other period", () =>
  accepts(C.RerunToolInput, rerun({ analysisPeriods: ["am_peak", "pm_peak", "saturday_midday", "daily"] })) &&
  rejects(C.RerunToolInput, rerun({ analysisPeriods: ["night"] })));
t("RerunToolInput refuses a weather, timing basis or volume basis the request schema does not have", () =>
  rejects(C.RerunToolInput, rerun({ weather: "hail" })) &&
  rejects(C.RerunToolInput, rerun({ signalTiming: "measured" })) &&
  rejects(C.RerunToolInput, rerun({ legVolumes: "counted" })));
t("RerunToolInput refuses an unknown key inside changes, and at the top level", () =>
  rejects(C.RerunToolInput, rerun({ growthRate: 1 })) && rejects(C.RerunToolInput, { ...rerun({}), extra: 1 }));
t("RerunToolInput needs a reason of 1 to 500 characters", () =>
  rejects(C.RerunToolInput, { changes: {} }) &&
  rejects(C.RerunToolInput, { changes: {}, reason: "" }) &&
  rejects(C.RerunToolInput, { changes: {}, reason: "   " }) &&
  accepts(C.RerunToolInput, { changes: {}, reason: "x".repeat(500) }) &&
  rejects(C.RerunToolInput, { changes: {}, reason: "x".repeat(501) }));
t("RerunToolInput needs a changes object", () => rejects(C.RerunToolInput, { reason: "r" }));
t("RerunToolInput sourceLabel is at most 200 characters, and findingId must be a uuid", () =>
  accepts(C.RerunToolInput, rerun({}, { sourceLabel: "x".repeat(200) })) &&
  rejects(C.RerunToolInput, rerun({}, { sourceLabel: "x".repeat(201) })) &&
  accepts(C.RerunToolInput, rerun({}, { findingId: randomUUID() })) &&
  rejects(C.RerunToolInput, rerun({}, { findingId: "nope" })));
t("RerunToolInput signalTimingOverrides: a full record is accepted", () => accepts(C.RerunToolInput, rerun({ signalTimingOverrides: [OVERRIDE] })));
t("RerunToolInput signalTimingOverrides: 60 records are accepted and 61 are not", () =>
  accepts(C.RerunToolInput, rerun({ signalTimingOverrides: Array.from({ length: 60 }, () => OVERRIDE) })) &&
  rejects(C.RerunToolInput, rerun({ signalTimingOverrides: Array.from({ length: 61 }, () => OVERRIDE) })));
t("RerunToolInput signalTimingOverrides: every key of a record is required", () =>
  Object.keys(OVERRIDE).every((k) => {
    const { [k]: _gone, ...rest } = OVERRIDE;
    return rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [rest] }));
  }));
t("RerunToolInput signalTimingOverrides: an unknown key in a record is refused", () => rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, cycle: 90 }] })));
t("RerunToolInput signalTimingOverrides: coordinates and cycle length take the request schema's bounds", () =>
  rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, latitude: 91 }] })) &&
  rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, longitude: -181 }] })) &&
  rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, cycleLenSec: 29 }] })) &&
  rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, cycleLenSec: 301 }] })) &&
  accepts(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, cycleLenSec: 30 }] })) &&
  accepts(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, cycleLenSec: 300 }] })));
t("RerunToolInput signalTimingOverrides: phase numbers are whole numbers 1 to 16 and splits are 1 to 300 seconds", () =>
  rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, phases: [{ movement: "NBT", phase: 0 }] }] })) &&
  rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, phases: [{ movement: "NBT", phase: 17 }] }] })) &&
  rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, phases: [{ movement: "NBT", phase: 2.5 }] }] })) &&
  rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, splits: [{ phase: 2, seconds: 0 }] }] })) &&
  rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, splits: [{ phase: 2, seconds: 301 }] }] })) &&
  rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, splits: [{ phase: 17, seconds: 30 }] }] })) &&
  accepts(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, phases: [{ movement: "NBT", phase: 16 }], splits: [{ phase: 16, seconds: 300 }] }] })));
t("RerunToolInput signalTimingOverrides: a movement must be one of the twelve standard ones", () =>
  ["NBL", "NBT", "NBR", "SBL", "SBT", "SBR", "EBL", "EBT", "EBR", "WBL", "WBT", "WBR"].every((m) =>
    accepts(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, phases: [{ movement: m, phase: 2 }] }] })),
  ) &&
    ["NB", "nbl", "XXX", "NBU", ""].every((m) => rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, phases: [{ movement: m, phase: 2 }] }] }))));
t("RerunToolInput signalTimingOverrides: a record needs at least one phase and one split, and no more than twelve phases or sixteen splits", () => {
  const pad = (n, mk) => Array.from({ length: n }, (_, i) => mk(i));
  const twelve = pad(12, (i) => ({ movement: ["NBL", "NBT", "NBR", "SBL", "SBT", "SBR", "EBL", "EBT", "EBR", "WBL", "WBT", "WBR"][i], phase: 2 }));
  const sixteen = pad(16, (i) => ({ phase: i + 1, seconds: 10 }));
  return (
    rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, phases: [] }] })) &&
    rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, splits: [] }] })) &&
    accepts(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, phases: twelve, splits: sixteen }] })) &&
    rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, phases: [...twelve, { movement: "NBL", phase: 2 }] }] })) &&
    rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, splits: [...sixteen, { phase: 1, seconds: 10 }] }] }))
  );
});
t("RerunToolInput signalTimingOverrides: an unnamed intersection is refused", () =>
  rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, intersectionName: "" }] })));
t("RerunToolInput signalTimingOverrides: a phase or split entry takes no unknown key", () =>
  rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, phases: [{ movement: "NBT", phase: 2, lag: 1 }] }] })) &&
  rejects(C.RerunToolInput, rerun({ signalTimingOverrides: [{ ...OVERRIDE, splits: [{ phase: 2, seconds: 30, lag: 1 }] }] })));

// --- Reads and events --------------------------------------------------------
const ids = Object.fromEntries(["m", "r", "p1", "p2", "f", "u"].map((k) => [k, randomUUID()]));
const MESSAGE = {
  id: ids.m,
  role: "engineer",
  content: "Why was this flagged?",
  authorName: "Pat Doe",
  findingId: ids.f,
  revisionId: null,
  createdAt: "2026-10-20T12:00:00.000Z",
};
const CHANGE = { field: "growthRatePct", from: 2.1, to: 1 };
const REVISION = {
  id: ids.r,
  projectId: ids.p2,
  fromProjectId: ids.p1,
  version: 2,
  changes: [CHANGE],
  reason: "Growth override dropped to the documented rate.",
  sourceLabel: null,
  requestedBy: "Pat Doe",
  findingId: null,
  clauseId: null,
  createdAt: "2026-10-20T12:01:00.000Z",
};
const READ = {
  enabled: true,
  messages: [MESSAGE, { ...MESSAGE, id: randomUUID(), role: "datum", authorName: null, findingId: null, revisionId: ids.r }],
  revisions: [REVISION],
  lineage: { version: 2, revisedFromProjectId: ids.p1, revisedFromVersion: 1, latestVersionId: ids.p2, latestVersion: 2 },
};
t("DatumChatReadResponse accepts a full answer", () => accepts(C.DatumChatReadResponse, READ));
t("DatumChatReadResponse accepts the disabled, empty answer for a first version", () =>
  accepts(C.DatumChatReadResponse, {
    enabled: false,
    messages: [],
    revisions: [],
    lineage: { version: 1, revisedFromProjectId: null, revisedFromVersion: null, latestVersionId: ids.p1, latestVersion: 1 },
  }));
t("DatumChatReadResponse rejects an unknown top-level key", () => C.DatumChatReadResponse.safeParse({ ...READ, extra: 1 }).success === false);
t("DatumChatReadResponse rejects an unknown key in lineage, a message and a revision", () =>
  rejects(C.DatumChatReadResponse, { ...READ, lineage: { ...READ.lineage, extra: 1 } }) &&
  rejects(C.DatumChatReadResponse, { ...READ, messages: [{ ...MESSAGE, userId: "u" }] }) &&
  rejects(C.DatumChatReadResponse, { ...READ, revisions: [{ ...REVISION, firmId: ids.u }] }));
t("DatumChatReadResponse needs all four keys", () => ["enabled", "messages", "revisions", "lineage"].every((k) => {
  const { [k]: _gone, ...rest } = READ;
  return rejects(C.DatumChatReadResponse, rest);
}));
t("DatumChatReadResponse lineage needs all five keys", () => Object.keys(READ.lineage).every((k) => {
  const { [k]: _gone, ...rest } = READ.lineage;
  return rejects(C.DatumChatReadResponse, { ...READ, lineage: rest });
}));
t("a message role is engineer or datum, nothing else", () =>
  rejects(C.DatumMessage, { ...MESSAGE, role: "system" }) && accepts(C.DatumMessage, { ...MESSAGE, role: "datum" }) && accepts(C.DatumMessage, MESSAGE));
t("a message carries its author's name, not the user id", () => rejects(C.DatumMessage, { ...MESSAGE, userId: "u" }));
t("a message createdAt is a string (a Date object is not)", () => accepts(C.DatumMessage, MESSAGE) && rejects(C.DatumMessage, { ...MESSAGE, createdAt: new Date() }));
t("every id in a message, a revision, the lineage and the events must be a uuid: all ids are uuid", () => {
  const bad = "not-a-uuid";
  const ids_in = (schema, base, keys) => keys.every((k) => rejects(schema, { ...base, [k]: bad }));
  return (
    ids_in(C.DatumMessage, MESSAGE, ["id", "findingId"]) &&
    rejects(C.DatumMessage, { ...MESSAGE, revisionId: bad }) &&
    ids_in(C.DatumRevision, REVISION, ["id", "projectId", "fromProjectId"]) &&
    rejects(C.DatumRevision, { ...REVISION, findingId: bad }) &&
    ["revisedFromProjectId", "latestVersionId"].every((k) => rejects(C.DatumChatReadResponse, { ...READ, lineage: { ...READ.lineage, [k]: bad } })) &&
    rejects(C.DatumStreamEvent, { type: "done", messageId: bad }) &&
    rejects(C.DatumStreamEvent, { type: "revision", projectId: bad, version: 2, changes: [] })
  );
});
t("a message needs every one of its seven keys", () => Object.keys(MESSAGE).every((k) => {
  const { [k]: _gone, ...rest } = MESSAGE;
  return rejects(C.DatumMessage, rest);
}));
t("a revision needs every one of its eleven keys", () => Object.keys(REVISION).every((k) => {
  const { [k]: _gone, ...rest } = REVISION;
  return rejects(C.DatumRevision, rest);
}));
t("a revision's change names a revisable field, and only one", () =>
  accepts(C.DatumRevision, REVISION) &&
  rejects(C.DatumRevision, { ...REVISION, changes: [{ field: "latitude", from: 1, to: 2 }] }) &&
  accepts(C.DatumChange, { field: "removeGrowthOverride", from: 2.1, to: true }) &&
  rejects(C.DatumChange, { field: "growthRatePct", from: 1, to: 2, extra: 1 }));
t("a revision change may carry an absent original as null", () => accepts(C.DatumChange, { field: "passByPct", from: null, to: 0 }));

const EVENTS = [
  { type: "text", delta: "Hello" },
  { type: "status", message: "Re-running with growth 1.0% (was 2.1%)..." },
  { type: "revision", projectId: ids.p2, version: 2, changes: [CHANGE] },
  { type: "done", messageId: ids.m },
  { type: "error", message: "Something went wrong." },
];
t("DatumStreamEvent accepts each of its five events", () => EVENTS.every((e) => accepts(C.DatumStreamEvent, e)));
t("DatumStreamEvent discriminates on type, and an unknown type is refused", () =>
  rejects(C.DatumStreamEvent, { type: "thinking", delta: "x" }) && rejects(C.DatumStreamEvent, { delta: "x" }));
t("DatumStreamEvent refuses an event with a key its type does not carry", () =>
  EVENTS.every((e) => rejects(C.DatumStreamEvent, { ...e, extra: 1 })) && rejects(C.DatumStreamEvent, { type: "text", message: "x" }));
t("DatumStreamEvent needs each event's own keys", () =>
  EVENTS.every((e) => Object.keys(e).filter((k) => k !== "type").every((k) => {
    const { [k]: _gone, ...rest } = e;
    return rejects(C.DatumStreamEvent, rest);
  })));

// --- Where it is exported ----------------------------------------------------
const zodIndex = read("lib/tis-api-zod/src/index.ts");
ok("the package index re-exports ./datum-chat", /^export \* from "\.\/datum-chat";$/m.test(zodIndex));
const contractSrc = read("lib/tis-api-zod/src/datum-chat.ts");
ok("the contract reaches GenerateTisBody through an explicit .ts path, the form plain node can load", /from "\.\/generated\/api\.ts"/.test(contractSrc));
ok("the contract reads GenerateTisBody's bounds from the schema and does not restate them as constants", !/\bconst\s+generateTisBody[A-Za-z]+\s*=\s*-?\d/.test(contractSrc));

// ===========================================================================
// migrations
// ===========================================================================
section("migrations");

const migrateSrc = read("lib/db/migrate.mjs");
const arrayStart = migrateSrc.indexOf("const SQL_STATEMENTS = [");
const arrayEnd = arrayStart < 0 ? -1 : migrateSrc.indexOf("\n];", arrayStart);
let statements = [];
try {
  if (arrayStart < 0 || arrayEnd < 0) throw new Error("could not find the SQL_STATEMENTS array");
  statements = new Function(`return ${migrateSrc.slice(arrayStart + "const SQL_STATEMENTS = ".length, arrayEnd + 2)}`)();
  ok("migrate.mjs SQL_STATEMENTS evaluates as a plain array literal", Array.isArray(statements) && statements.every((s) => typeof s?.id === "string" && typeof s?.sql === "string"));
} catch (e) {
  ok("migrate.mjs SQL_STATEMENTS evaluates as a plain array literal", false, e instanceof Error ? e.message : String(e));
}

const NEW_IDS = [
  "tis_projects.revised_from_project_id",
  "tis_projects.root_project_id",
  "tis_projects.idx_root",
  "study_revisions.create",
  "study_revisions.uq_project",
  "study_datum_messages.create",
  "study_datum_messages.idx_project",
  "study_datum_messages.idx_firm_created",
];
const idCount = (id) => statements.filter((s) => s.id === id).length;
const sqlOf = (id) => (statements.find((s) => s.id === id)?.sql ?? "").replace(/\s+/g, " ").trim();
for (const id of NEW_IDS) ok(`migrate.mjs has the statement ${id}, once`, idCount(id) === 1);

const NEW = statements.filter((s) => NEW_IDS.includes(s.id));
const CREATE_OR_ADD = /^(?:CREATE TABLE IF NOT EXISTS \w+ \(|CREATE (?:UNIQUE )?INDEX IF NOT EXISTS "[^"]+" ON \w+ \(|ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS \w+ )/;
for (const s of NEW) {
  const sql = s.sql.replace(/\s+/g, " ").trim();
  ok(`${s.id}: is CREATE ... IF NOT EXISTS or ADD COLUMN IF NOT EXISTS, so a re-run on every boot is a no-op`, CREATE_OR_ADD.test(sql), `got: ${sql.slice(0, 80)}`);
  ok(`${s.id}: exactly one statement, ending in a single ;`, (sql.match(/;/g) ?? []).length === 1 && sql.endsWith(";"));
  // ON DELETE is a referential action, not a DELETE: read it out before looking for the verbs.
  ok(`${s.id}: no DROP, RENAME, TRUNCATE or ADD CONSTRAINT`, !/\b(DROP|RENAME|TRUNCATE)\b|ADD\s+CONSTRAINT/i.test(sql.replace(/ON DELETE (?:CASCADE|SET NULL)/g, "")));
}
ok("none of the new statements is a destructive one, read as a whole", NEW.length === NEW_IDS.length && NEW.every((s) => !/\b(DROP|RENAME)\b/i.test(s.sql)));

// The runner has no ledger and skips "relation does not exist", so a statement
// whose table or referent is created later is skipped, silently, on a first boot.
const at = (id) => statements.findIndex((s) => s.id === id);
ok("the new statements come after the proofread tables they reference", at("study_revisions.create") > at("study_proofread_findings.create") && at("study_datum_messages.create") > at("study_proofread_findings.create"));
ok(
  "each index comes after the table it indexes",
  at("study_revisions.uq_project") > at("study_revisions.create") &&
    at("study_datum_messages.idx_project") > at("study_datum_messages.create") &&
    at("study_datum_messages.idx_firm_created") > at("study_datum_messages.create"),
);
ok("the root index comes after its column", at("tis_projects.idx_root") > at("tis_projects.root_project_id"));

// tis_projects: two nullable uuid columns that point back at tis_projects, SET NULL.
for (const [id, col] of [
  ["tis_projects.revised_from_project_id", "revised_from_project_id"],
  ["tis_projects.root_project_id", "root_project_id"],
]) {
  ok(
    `${id}: a nullable UUID column referencing tis_projects(id) ON DELETE SET NULL`,
    sqlOf(id) === `ALTER TABLE tis_projects ADD COLUMN IF NOT EXISTS ${col} UUID REFERENCES tis_projects(id) ON DELETE SET NULL;`,
    sqlOf(id),
  );
}
ok(
  "tis_projects.idx_root: an index on tis_projects(root_project_id)",
  /^CREATE INDEX IF NOT EXISTS "IDX_tis_projects_root" ON tis_projects \(root_project_id\);$/.test(sqlOf("tis_projects.idx_root")),
  sqlOf("tis_projects.idx_root"),
);
ok(
  "study_revisions.uq_project: UNIQUE on project_id, so a version has at most one revision row",
  /^CREATE UNIQUE INDEX IF NOT EXISTS "UQ_study_revisions_project" ON study_revisions \(project_id\);$/.test(sqlOf("study_revisions.uq_project")),
  sqlOf("study_revisions.uq_project"),
);
ok(
  "study_datum_messages.idx_project: an index on (project_id, created_at), the thread read",
  /^CREATE INDEX IF NOT EXISTS "IDX_study_datum_messages_project" ON study_datum_messages \(project_id, created_at\);$/.test(sqlOf("study_datum_messages.idx_project")),
  sqlOf("study_datum_messages.idx_project"),
);
ok(
  "study_datum_messages.idx_firm_created: an index on (firm_id, created_at), the firm's 24-hour reply count",
  /^CREATE INDEX IF NOT EXISTS "IDX_study_datum_messages_firm_created" ON study_datum_messages \(firm_id, created_at\);$/.test(sqlOf("study_datum_messages.idx_firm_created")),
  sqlOf("study_datum_messages.idx_firm_created"),
);

/** `CREATE TABLE IF NOT EXISTS name (col defs);` -> Map(column -> definition text), splitting on top-level commas. */
function sqlColumns(sql) {
  const m = /^CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*)\);$/.exec(sql.replace(/\s+/g, " ").trim());
  if (!m) return null;
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const c of m[2]) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return { name: m[1], columns: new Map(parts.map((p) => [p.split(" ")[0], p])) };
}
const refs = (def) => [...def.matchAll(/REFERENCES (\w+)\((\w+)\) ON DELETE (CASCADE|SET NULL)/g)].map((r) => `${r[1]}.${r[2]}:${r[3]}`);

const REVISION_COLS = ["id", "project_id", "from_project_id", "root_project_id", "firm_id", "requested_by_user_id", "message_id", "finding_id", "clause_id", "changes", "reason", "source_label", "created_at"];
const MESSAGE_COLS = ["id", "project_id", "firm_id", "user_id", "role", "content", "finding_id", "revision_id", "model", "input_tokens", "output_tokens", "stop_reason", "created_at"];
const rev = sqlColumns(sqlOf("study_revisions.create"));
const msg = sqlColumns(sqlOf("study_datum_messages.create"));
ok("study_revisions.create parses as a CREATE TABLE IF NOT EXISTS study_revisions", rev?.name === "study_revisions");
ok("study_datum_messages.create parses as a CREATE TABLE IF NOT EXISTS study_datum_messages", msg?.name === "study_datum_messages");
ok("study_revisions has the spec's columns, no more and no fewer", rev !== null && sameSet([...rev.columns.keys()], REVISION_COLS), rev ? [...rev.columns.keys()].join(", ") : "no table");
ok("study_datum_messages has the spec's columns, no more and no fewer", msg !== null && sameSet([...msg.columns.keys()], MESSAGE_COLS), msg ? [...msg.columns.keys()].join(", ") : "no table");

const def = (tbl, col) => tbl?.columns.get(col) ?? "";
const nn = (tbl, col) => /\bNOT NULL\b/.test(def(tbl, col));
/** Nullable means the column exists and is not NOT NULL: a missing table must not pass this. */
const nullable = (tbl, col) => (tbl?.columns.has(col) ?? false) && !nn(tbl, col);
const rf = (tbl, col) => refs(def(tbl, col));
// study_revisions
ok("study_revisions.id is a UUID primary key defaulting to gen_random_uuid()", /^id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)$/.test(def(rev, "id")), def(rev, "id"));
ok("study_revisions.project_id is NOT NULL, references tis_projects(id) ON DELETE CASCADE", /^project_id UUID\b/.test(def(rev, "project_id")) && nn(rev, "project_id") && same(rf(rev, "project_id"), ["tis_projects.id:CASCADE"]), def(rev, "project_id"));
ok("study_revisions.finding_id is nullable and references study_proofread_findings(id) ON DELETE SET NULL", /^finding_id UUID\b/.test(def(rev, "finding_id")) && nullable(rev, "finding_id") && same(rf(rev, "finding_id"), ["study_proofread_findings.id:SET NULL"]), def(rev, "finding_id"));
ok("study_revisions.requested_by_user_id is NOT NULL varchar referencing users(id), like tis_projects.user_id", /^requested_by_user_id VARCHAR\b/.test(def(rev, "requested_by_user_id")) && nn(rev, "requested_by_user_id") && same(rf(rev, "requested_by_user_id").map((r) => r.split(":")[0]), ["users.id"]), def(rev, "requested_by_user_id"));
ok("study_revisions.firm_id is NOT NULL and references firms(id)", /^firm_id UUID\b/.test(def(rev, "firm_id")) && nn(rev, "firm_id") && same(rf(rev, "firm_id").map((r) => r.split(":")[0]), ["firms.id"]), def(rev, "firm_id"));
ok("study_revisions.from_project_id and root_project_id are NOT NULL uuids", ["from_project_id", "root_project_id"].every((c) => new RegExp(`^${c} UUID\\b`).test(def(rev, c)) && nn(rev, c)));
ok("study_revisions.changes is NOT NULL JSONB and reason is NOT NULL TEXT", /^changes JSONB\b/.test(def(rev, "changes")) && nn(rev, "changes") && /^reason TEXT\b/.test(def(rev, "reason")) && nn(rev, "reason"));
ok("study_revisions.message_id, clause_id and source_label are nullable", ["message_id", "clause_id", "source_label"].every((c) => nullable(rev, c)));
ok("study_revisions.created_at is TIMESTAMPTZ NOT NULL DEFAULT now(), and there is no updated_at: the log is append-only", /^created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)$/.test(def(rev, "created_at")) && !rev?.columns.has("updated_at"));
// study_datum_messages
ok("study_datum_messages.id is a UUID primary key defaulting to gen_random_uuid()", /^id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)$/.test(def(msg, "id")), def(msg, "id"));
ok("study_datum_messages.project_id is NOT NULL, references tis_projects(id) ON DELETE CASCADE", /^project_id UUID\b/.test(def(msg, "project_id")) && nn(msg, "project_id") && same(rf(msg, "project_id"), ["tis_projects.id:CASCADE"]), def(msg, "project_id"));
ok("study_datum_messages.finding_id is nullable and references study_proofread_findings(id) ON DELETE SET NULL", /^finding_id UUID\b/.test(def(msg, "finding_id")) && nullable(msg, "finding_id") && same(rf(msg, "finding_id"), ["study_proofread_findings.id:SET NULL"]), def(msg, "finding_id"));
ok("study_datum_messages.user_id is a nullable varchar referencing users(id): null is Datum", /^user_id VARCHAR\b/.test(def(msg, "user_id")) && nullable(msg, "user_id") && same(rf(msg, "user_id").map((r) => r.split(":")[0]), ["users.id"]), def(msg, "user_id"));
ok("study_datum_messages.firm_id is NOT NULL and references firms(id)", /^firm_id UUID\b/.test(def(msg, "firm_id")) && nn(msg, "firm_id") && same(rf(msg, "firm_id").map((r) => r.split(":")[0]), ["firms.id"]), def(msg, "firm_id"));
ok("study_datum_messages.role and content are NOT NULL", nn(msg, "role") && nn(msg, "content"));
ok("study_datum_messages.revision_id, model, token counts and stop_reason are nullable", ["revision_id", "model", "input_tokens", "output_tokens", "stop_reason"].every((c) => nullable(msg, c)));
ok("study_datum_messages.created_at is TIMESTAMPTZ NOT NULL DEFAULT now()", /^created_at TIMESTAMPTZ NOT NULL DEFAULT now\(\)$/.test(def(msg, "created_at")));
ok(
  "every FK in the two new tables names ON DELETE CASCADE or SET NULL: nothing blocks a delete",
  rev !== null && msg !== null && [rev, msg].every((tbl) => [...tbl.columns.values()].every((d) => refs(d).length === (d.match(/REFERENCES/g) ?? []).length)),
);

// ---------------------------------------------------------------------------
// The drizzle declaration agrees with the migration, so drizzle-kit push on a
// dev database and migrate.mjs on Railway build the same tables.
// ---------------------------------------------------------------------------
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const dzSrc = stripComments(read("lib/db/src/schema/datum-chat.ts"));
const barrel = stripComments(read("lib/db/src/schema/index.ts"));
const projectsSrc = stripComments(read("lib/db/src/schema/tis-projects.ts"));
ok("the schema barrel re-exports datum-chat", /export \* from "\.\/datum-chat";/.test(barrel));
// The version column's own comment, which engineers read: the number within a lineage (createRevision in
// artifacts/tis-api-server/src/lib/study-revisions.ts takes 1 + the lineage's highest), not a per-user counter.
{
  const raw = read("lib/db/src/schema/tis-projects.ts");
  const at = raw.search(/\n\s*version: integer\("version"\)/);
  const above = at < 0 ? [] : raw.slice(0, at).split("\n").reverse();
  const end = above.findIndex((line) => !/^\s*\/\//.test(line));
  const comment = above.slice(0, end < 0 ? above.length : end).reverse().join(" ");
  ok(
    "the version column's comment says it is the number within a lineage: 1 for an original, max + 1 for a version Datum made",
    comment.length > 0 && !/per-user/i.test(comment) && /lineage/i.test(comment) && /\b1\b/.test(comment) && /highest|max/i.test(comment) && /study-revisions/.test(comment),
    `comment above version: ${JSON.stringify(comment)}`,
  );
}

const TABLE_VARS = { tisProjectsTable: "tis_projects", firmsTable: "firms", usersTable: "users", studyProofreadFindingsTable: "study_proofread_findings" };
/** The text of one drizzle column expression: from `uuid("col")` to the first comma at bracket depth 0. */
function columnExpr(src, col) {
  const start = src.search(new RegExp(`\\b(?:uuid|varchar|text|integer|jsonb|timestamp|smallint)\\("${col}"`));
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    if (c === ")" || c === "}" || c === "]") depth--;
    if (depth < 0 || (c === "," && depth === 0)) return src.slice(start, i);
  }
  return src.slice(start);
}
/** The declaration of one drizzle table: its column names, their expressions, and its FKs as `table.col:RULE`. */
function dzTable(src, name) {
  const start = src.search(new RegExp(`pgTable\\(\\s*"${name}"`));
  if (start < 0) return null;
  const next = src.indexOf("pgTable(", start + 10);
  const body = src.slice(start, next < 0 ? undefined : next);
  const cols = [...body.matchAll(/\b(?:uuid|varchar|text|integer|jsonb|timestamp|smallint)\("([a-z_]+)"/g)].map((m) => m[1]);
  const exprs = new Map(cols.map((c) => [c, columnExpr(body, c) ?? ""]));
  const fks = [...body.matchAll(/references\(\s*\(\)\s*=>\s*(\w+)\.(\w+),\s*\{\s*onDelete:\s*"(cascade|set null)"\s*,?\s*\}\s*\)/g)].map(
    (m) => `${TABLE_VARS[m[1]] ?? m[1]}.${m[2]}:${m[3].toUpperCase()}`,
  );
  return { cols, exprs, fks, body };
}
const dzRev = dzTable(dzSrc, "study_revisions");
const dzMsg = dzTable(dzSrc, "study_datum_messages");
ok("the drizzle file declares study_revisions and study_datum_messages", dzRev !== null && dzMsg !== null);
ok("drizzle study_revisions has the same columns as the migration", dzRev !== null && sameSet(dzRev.cols, REVISION_COLS), dzRev ? dzRev.cols.join(", ") : "no table");
ok("drizzle study_datum_messages has the same columns as the migration", dzMsg !== null && sameSet(dzMsg.cols, MESSAGE_COLS), dzMsg ? dzMsg.cols.join(", ") : "no table");
const sqlFks = (tbl) => [...tbl.columns.values()].flatMap((d) => refs(d));
ok("drizzle study_revisions has the same FKs and delete rules as the migration", dzRev !== null && rev !== null && sameSet(dzRev.fks, sqlFks(rev)), `drizzle ${dzRev?.fks.join(" | ")} / sql ${rev && sqlFks(rev).join(" | ")}`);
ok("drizzle study_datum_messages has the same FKs and delete rules as the migration", dzMsg !== null && msg !== null && sameSet(dzMsg.fks, sqlFks(msg)), `drizzle ${dzMsg?.fks.join(" | ")} / sql ${msg && sqlFks(msg).join(" | ")}`);
// Nullability, column by column: the drizzle side says notNull() or primaryKey(), the SQL side NOT NULL or PRIMARY KEY.
for (const [label, dz, tbl] of [["study_revisions", dzRev, rev], ["study_datum_messages", dzMsg, msg]]) {
  const disagree = dz && tbl ? dz.cols.filter((c) => /\.notNull\(\)|\.primaryKey\(\)/.test(dz.exprs.get(c) ?? "") !== /\bNOT NULL\b|\bPRIMARY KEY\b/.test(def(tbl, c))) : ["(no table)"];
  ok(`drizzle ${label} agrees with the migration on which columns are NOT NULL`, disagree.length === 0, `disagree on: ${disagree.join(", ")}`);
}
ok("drizzle declares the unique index on study_revisions.project_id under the migration's name", dzRev !== null && /uniqueIndex\("UQ_study_revisions_project"\)\s*\.on\(table\.projectId\)/.test(dzRev.body));
ok("drizzle declares the thread index (project_id, created_at) under the migration's name", dzMsg !== null && /index\("IDX_study_datum_messages_project"\)\s*\.on\(table\.projectId,\s*table\.createdAt\)/.test(dzMsg.body));
ok("drizzle declares the firm reply-count index (firm_id, created_at) under the migration's name", dzMsg !== null && /index\("IDX_study_datum_messages_firm_created"\)\s*\.on\(table\.firmId,\s*table\.createdAt\)/.test(dzMsg.body));
ok("drizzle study_revisions has no updated_at", dzRev !== null && !/updated_at/.test(dzRev.body));
ok("both new drizzle tables use uuid ids that default to gen_random_uuid()", [dzRev, dzMsg].every((d) => d !== null && /id:\s*uuid\("id"\)\.primaryKey\(\)\.default\(sql`gen_random_uuid\(\)`\)/.test(d.body)));
ok("drizzle exports studyRevisionsTable and studyDatumMessagesTable", /export const studyRevisionsTable\s*=\s*pgTable\(/.test(dzSrc) && /export const studyDatumMessagesTable\s*=\s*pgTable\(/.test(dzSrc));

for (const [col, prop] of [["revised_from_project_id", "revisedFromProjectId"], ["root_project_id", "rootProjectId"]]) {
  const expr = columnExpr(projectsSrc, col) ?? "";
  ok(
    `tis_projects (drizzle) declares ${prop} as a nullable uuid referencing tis_projects(id) ON DELETE SET NULL`,
    new RegExp(`\\b${prop}:\\s*uuid\\("${col}"\\)`).test(projectsSrc) &&
      !/\.notNull\(\)/.test(expr) &&
      /references\(\s*\(\)\s*(?::\s*\w+\s*)?=>\s*tisProjectsTable\.id,\s*\{\s*onDelete:\s*"set null"\s*,?\s*\}\s*\)/.test(expr),
    expr || "column not declared",
  );
}
ok("tis_projects (drizzle) declares IDX_tis_projects_root on root_project_id", /index\("IDX_tis_projects_root"\)\s*\.on\(table\.rootProjectId\)/.test(projectsSrc));

// ===========================================================================
// tools
// ===========================================================================
section("tools");

const TOOLS_REL = "artifacts/tis-api-server/src/lib/datum-chat/tools.ts";
const { mod: T, error: toolsError } = await importByUrl(TOOLS_REL);
ok("the tools module loads under plain node (no loader)", toolsError === null, toolsError ?? undefined);
const toolsSrc = read(TOOLS_REL);

// --- Pure, like lib/proofread/ --------------------------------------------------
const toolsCode = stripComments(toolsSrc);
ok(
  "tools.ts imports no SDK, db or logger, reads no env and fetches nothing",
  toolsCode.length > 0 && !/@anthropic-ai\/sdk|@workspace\/db|\blogger\b|process\.env|\bfetch\s*\(|\brequire\s*\(/.test(toolsCode),
);
const toolsRelImports = [...toolsCode.matchAll(/\bfrom\s+"(\.{1,2}\/[^"]*)"/g)].map((m) => m[1]);
ok("tools.ts imports the contract through ./contract.ts", toolsRelImports.includes("./contract.ts"), toolsRelImports.join(", "));
ok("every relative import in tools.ts carries an explicit .ts", toolsRelImports.length > 0 && toolsRelImports.every((p) => p.endsWith(".ts")), toolsRelImports.join(", "));
ok("pure datum-chat modules import the contract only via ./contract.ts: tools.ts names no tis-api-zod path", !/tis-api-zod/.test(toolsCode), toolsRelImports.join(", "));

// --- contract.ts: the one door to lib/tis-api-zod for the pure modules, so none names a path of its own ---
const CONTRACT_REL = "artifacts/tis-api-server/src/lib/datum-chat/contract.ts";
const { mod: K, error: facadeError } = await importByUrl(CONTRACT_REL);
ok("contract.ts loads under plain node (no loader)", facadeError === null, facadeError ?? undefined);
const facadeCode = stripComments(read(CONTRACT_REL));
const facadeFroms = [...facadeCode.matchAll(/\bfrom\s+"([^"]*)"/g)].map((m) => m[1]);
ok(
  "contract.ts re-exports only from the two explicit relative .ts paths: datum-chat.ts and generated/api.ts",
  sameSet(facadeFroms, [
    "../../../../../lib/tis-api-zod/src/datum-chat.ts",
    "../../../../../lib/tis-api-zod/src/generated/api.ts",
  ]),
  facadeFroms.join(", "),
);
t("contract.ts exposes everything datum-chat.ts exports, and the request schema", () =>
  Object.keys(C).length > 0 && Object.keys(C).every((k) => K[k] === C[k]) && K.GenerateTisBody === G.GenerateTisBody);
t("contract.ts exposes the signal-timing-overrides bound tools.ts reads", () => K.generateTisBodySignalTimingOverridesMax === G.generateTisBodySignalTimingOverridesMax && typeof K.generateTisBodySignalTimingOverridesMax === "number");

// --- The parent: scenario-base.json's request ------------------------------------
let fixtureRequest = {};
try {
  fixtureRequest = JSON.parse(read("artifacts/atlanta-tis/scripts/fixtures/scenario-base.json")).request;
} catch (e) {
  ok("precondition: scenario-base.json holds a request", false, e instanceof Error ? e.message : String(e));
}
t("precondition: the fixture's request parses under GenerateTisBody as it stands", () => accepts(G.GenerateTisBody, fixtureRequest));
/** The fixture's request, growth 2.1: raw, so it lacks the three defaults a stored (parsed) request carries. */
const PARENT = { ...fixtureRequest, growthRatePct: 2.1 };
/** What the generate route stores as requestPayload: the parse of the request. */
const STORED = accepts(G.GenerateTisBody, PARENT) ? G.GenerateTisBody.parse(PARENT) : {};
t("precondition: the parent has growth 2.1, no pass-by override and a study radius", () => PARENT.growthRatePct === 2.1 && !("passByPct" in PARENT) && typeof PARENT.studyRadiusMi === "number");
t("precondition: the stored form carries the three defaults the raw fixture lacks", () =>
  ["conservedAssignment", "signalTiming", "legVolumes"].every((k) => !(k in PARENT) && k in STORED));
const PARENT_JSON = JSON.stringify(PARENT);
const apply = (parent, changes, extra = {}) => T.applyRevisionChanges(parent, { changes, reason: "r", ...extra });
const refused = (r) => r.ok === false && typeof r.error === "string" && r.error.length > 0 && !("request" in r);

// --- Growth ----------------------------------------------------------------------
t("growthRatePct 2.1 -> 1.0 is ok, sets the rate, and records the change", () => {
  const r = apply(PARENT, { growthRatePct: 1.0 });
  return r.ok === true && r.request.growthRatePct === 1.0 && isDeepStrictEqual(r.changes, [{ field: "growthRatePct", from: 2.1, to: 1.0 }]);
});
t("the parent object is not changed by a merge, and the result does not alias it", () => {
  const parent = structuredClone(PARENT);
  const r = apply(parent, { growthRatePct: 1.0, signalTimingOverrides: [OVERRIDE] });
  r.request.projectName = "mutated";
  r.request.signalTimingOverrides[0].name = "mutated";
  return JSON.stringify(parent) === PARENT_JSON;
});
t("removeGrowthOverride gives a request with no growthRatePct key, and the change reads 2.1 -> null", () => {
  const r = apply(PARENT, { removeGrowthOverride: true });
  return r.ok === true && !("growthRatePct" in r.request) && isDeepStrictEqual(r.changes, [{ field: "growthRatePct", from: 2.1, to: null }]);
});
t("removeGrowthOverride on a study with no override changes nothing", () => {
  const { growthRatePct: _drop, ...noGrowth } = PARENT;
  const r = apply(noGrowth, { removeGrowthOverride: true });
  return r.ok === true && r.changes.length === 0 && !("growthRatePct" in r.request);
});
t("removeGrowthOverride can only be true: false is refused by name", () => {
  const r = apply(PARENT, { removeGrowthOverride: false });
  return refused(r) && r.field === "removeGrowthOverride";
});
t("growthRatePct together with removeGrowthOverride is refused, naming growthRatePct and saying to pick one", () => {
  const r = apply(PARENT, { growthRatePct: 1, removeGrowthOverride: true });
  return refused(r) && r.field === "growthRatePct" && /pick one/i.test(r.error) && /new rate/i.test(r.error) && /remov/i.test(r.error);
});
t("that refusal comes before anything else, even when the saved inputs are also bad", () => {
  const r = apply({ ...PARENT, studyRadiusMi: 7 }, { growthRatePct: 1, removeGrowthOverride: true });
  return refused(r) && r.field === "growthRatePct" && /pick one/i.test(r.error);
});

// --- Empty changes, and a change that changes nothing ------------------------------
t("empty changes give ok, no changes, and the parent's own request after a GenerateTisBody parse", () => {
  const r = apply(PARENT, {});
  return r.ok === true && isDeepStrictEqual(r.changes, []) && isDeepStrictEqual(r.request, G.GenerateTisBody.parse(PARENT));
});
t("the request a merge returns is the generator's own parse of the merged request (defaults filled, nothing else added)", () => {
  const r = apply(PARENT, { growthRatePct: 1 });
  return r.ok === true && isDeepStrictEqual(r.request, G.GenerateTisBody.parse({ ...PARENT, growthRatePct: 1 }));
});
t("a change equal to the parent's value is skipped; one that differs is kept", () => {
  const r = apply(PARENT, { growthRatePct: 2.1, openingYear: PARENT.openingYear, weather: PARENT.weather, passByPct: 10 });
  return r.ok === true && isDeepStrictEqual(r.changes, [{ field: "passByPct", from: null, to: 10 }]) && r.request.passByPct === 10;
});
t("an analysisPeriods list equal to the parent's is skipped; a reordered or shorter list is a change", () => {
  const same = apply(PARENT, { analysisPeriods: [...PARENT.analysisPeriods] });
  const shorter = apply(PARENT, { analysisPeriods: ["pm_peak"] });
  return same.ok === true && same.changes.length === 0 && shorter.ok === true && isDeepStrictEqual(shorter.changes, [{ field: "analysisPeriods", from: PARENT.analysisPeriods, to: ["pm_peak"] }]);
});
t("from is the parent's value, or null when the parent has none", () => {
  const r = apply(PARENT, { openingYear: 2029, passByPct: 5, internalCapturePct: 3, weather: "light_snow" });
  const by = Object.fromEntries(r.changes.map((c) => [c.field, c.from]));
  return r.ok === true && by.openingYear === PARENT.openingYear && by.weather === PARENT.weather && by.passByPct === null && by.internalCapturePct === null;
});

// --- Every field, in the allowlist's order ------------------------------------------
const ALL = {
  growthRatePct: 1,
  openingYear: 2029,
  analysisPeriods: ["pm_peak"],
  passByPct: 10,
  internalCapturePct: 5,
  weather: "light_rain",
  scopeStudyIntersections: true,
  signalTiming: "screening",
  legVolumes: "screening",
  realLaneGeometry: false,
  conservedAssignment: false,
  signalTimingOverrides: [OVERRIDE],
};
t("all twelve value fields at once are ok and land in the request", () => {
  const r = apply(STORED, ALL);
  return (
    r.ok === true &&
    Object.entries(ALL).every(([k, v]) => k === "signalTimingOverrides" || isDeepStrictEqual(r.request[k], v)) &&
    r.request.signalTimingOverrides.length === 1
  );
});
t("the changes list is in REVISABLE_FIELDS order whatever order the input names them in", () => {
  const shuffled = Object.fromEntries(Object.entries(ALL).reverse());
  const r = apply(STORED, shuffled);
  const want = C.REVISABLE_FIELDS.filter((f) => f in ALL);
  return r.ok === true && same(r.changes.map((c) => c.field), want) && want.length === 12;
});
t("against a stored (parsed) parent, from carries the defaults the parse filled in", () => {
  const r = apply(STORED, ALL);
  const by = Object.fromEntries(r.changes.map((c) => [c.field, c.from]));
  return r.ok === true && by.signalTiming === "computed" && by.legVolumes === "network" && by.conservedAssignment === true && by.realLaneGeometry === null && by.signalTimingOverrides === null;
});
t("every change carries exactly field, from and to, and a field that REVISABLE_FIELDS names", () => {
  const r = apply(STORED, ALL);
  return r.ok === true && r.changes.every((c) => same(Object.keys(c), ["field", "from", "to"]) && C.REVISABLE_FIELDS.includes(c.field));
});
t("the merge accepts what RerunToolInput parses (no default is injected on the way)", () => {
  const input = C.RerunToolInput.parse({ changes: { weather: "heavy_rain" }, reason: "county asked" });
  const r = T.applyRevisionChanges(STORED, input);
  return r.ok === true && isDeepStrictEqual(r.changes, [{ field: "weather", from: STORED.weather, to: "heavy_rain" }]) && r.request.signalTiming === STORED.signalTiming;
});

// --- Locked fields stay byte-equal ---------------------------------------------------
const RICH = (() => {
  const volumes = Object.fromEntries(["NBL", "NBT", "NBR", "SBL", "SBT", "SBR", "EBL", "EBT", "EBR", "WBL", "WBT", "WBR"].map((m) => [m, 100]));
  const rich = {
    ...PARENT,
    independentVariable: "KSF",
    tripProfile: { arrivals: Array.from({ length: 24 }, (_, i) => i), departures: Array.from({ length: 24 }, (_, i) => 24 - i), source: "client" },
    studyIntersectionIds: ["sig-1", "sig-2"],
    additionalStudyPoints: [{ latitude: 33.78, longitude: -84.38 }],
    utdfIntersections: [{ name: "Main St & 1st Ave", latitude: 33.78, longitude: -84.38, cycleLenSec: 100, volumes }],
    driveways: [{ id: "d1", latitude: 33.7861, longitude: -84.3853, accessType: "full", movements: { inLeft: true, inRight: true, outLeft: true, outRight: true } }],
    distributionMethod: "gravity",
    existingLandUseCode: "110",
    existingSize: 10,
  };
  return accepts(G.GenerateTisBody, rich) ? G.GenerateTisBody.parse(rich) : {};
})();
t("precondition: the rich parent carries driveways, UTDF records and a trip profile", () => ["driveways", "utdfIntersections", "tripProfile"].every((k) => k in RICH));
t("every LOCKED_FIELDS name the fixture carries is byte-equal in the result, with all twelve value fields changed", () => {
  const present = C.LOCKED_FIELDS.filter((f) => f in PARENT);
  const r = apply(PARENT, ALL);
  return present.length >= 8 && r.ok === true && present.every((f) => JSON.stringify(r.request[f]) === JSON.stringify(PARENT[f]));
});
t("every LOCKED_FIELDS name a rich parent carries (UTDF, driveways, trip profile, scope ids) is byte-equal in the result", () => {
  const present = C.LOCKED_FIELDS.filter((f) => f in RICH);
  const r = apply(RICH, ALL);
  return present.length >= 15 && r.ok === true && present.every((f) => JSON.stringify(r.request[f]) === JSON.stringify(RICH[f]));
});
t("a locked field in changes is refused by name, and the request is not returned", () =>
  C.LOCKED_FIELDS.every((f) => {
    const r = apply(PARENT, { [f]: 1 });
    return refused(r) && r.field === f;
  }));
t("a key that is no field at all is refused, and a __proto__ key pollutes nothing", () => {
  const evil = JSON.parse('{"__proto__": {"polluted": true}}');
  const r = apply(PARENT, evil);
  const r2 = apply(PARENT, { growthRate: 1 });
  return refused(r) && refused(r2) && r2.field === "growthRate" && ({}).polluted === undefined;
});
t("a changes value that is not an object is refused", () => [null, "x", 3, [], undefined].every((c) => refused(T.applyRevisionChanges(PARENT, { changes: c, reason: "r" }))));

// --- Signal timing: arrays become the request's records ------------------------------
const TIMING = {
  intersectionName: "A & B",
  latitude: 33.7861,
  longitude: -84.3853,
  cycleLenSec: 120,
  phases: [
    { movement: "NBT", phase: 2 },
    { movement: "EBT", phase: 4 },
  ],
  splits: [
    { phase: 2, seconds: 60 },
    { phase: 4, seconds: 50 },
  ],
};
const TIMING_RECORD = { latitude: 33.7861, longitude: -84.3853, name: "A & B", cycleLenSec: 120, phaseByMovement: { NBT: 2, EBT: 4 }, splitSByPhase: { 2: 60, 4: 50 } };
t("signalTimingOverrides arrays become phaseByMovement and splitSByPhase records, the name carried as name", () => {
  const r = apply(PARENT, { signalTimingOverrides: [TIMING] });
  return r.ok === true && isDeepStrictEqual(r.request.signalTimingOverrides[0], TIMING_RECORD) && same(Object.keys(r.request.signalTimingOverrides[0].splitSByPhase), ["2", "4"]);
});
t("the timing change reads absent -> the converted records", () => {
  const r = apply(PARENT, { signalTimingOverrides: [TIMING] });
  return r.ok === true && isDeepStrictEqual(r.changes, [{ field: "signalTimingOverrides", from: null, to: [TIMING_RECORD] }]);
});
t("a timing sheet equal to the parent's records is skipped", () => {
  const withTiming = apply(PARENT, { signalTimingOverrides: [TIMING] }).request;
  const again = apply(withTiming, { signalTimingOverrides: [TIMING] });
  return again.ok === true && again.changes.length === 0 && isDeepStrictEqual(again.request.signalTimingOverrides, [TIMING_RECORD]);
});
t("a timing sheet replaces the parent's records as a whole", () => {
  const withTiming = apply(PARENT, { signalTimingOverrides: [TIMING] }).request;
  const other = { ...TIMING, intersectionName: "C & D", cycleLenSec: 90 };
  const r = apply(withTiming, { signalTimingOverrides: [other] });
  return r.ok === true && r.request.signalTimingOverrides.length === 1 && r.request.signalTimingOverrides[0].name === "C & D" && isDeepStrictEqual(r.changes[0].from, [TIMING_RECORD]);
});
t("an empty timing list clears the parent's records", () => {
  const withTiming = apply(PARENT, { signalTimingOverrides: [TIMING] }).request;
  const r = apply(withTiming, { signalTimingOverrides: [] });
  return r.ok === true && isDeepStrictEqual(r.request.signalTimingOverrides, []) && isDeepStrictEqual(r.changes, [{ field: "signalTimingOverrides", from: [TIMING_RECORD], to: [] }]);
});
t("a movement listed twice, or a phase given two splits, is refused rather than resolved by order", () => {
  const dupMove = apply(PARENT, { signalTimingOverrides: [{ ...TIMING, phases: [...TIMING.phases, { movement: "NBT", phase: 6 }] }] });
  const dupPhase = apply(PARENT, { signalTimingOverrides: [{ ...TIMING, splits: [...TIMING.splits, { phase: 2, seconds: 30 }] }] });
  return refused(dupMove) && dupMove.field === "signalTimingOverrides" && /NBT/.test(dupMove.error) && refused(dupPhase) && dupPhase.field === "signalTimingOverrides" && /phase 2/i.test(dupPhase.error);
});
t("an out-of-bounds timing value is refused as a bounds error naming signalTimingOverrides", () => {
  const r = apply(PARENT, { signalTimingOverrides: [{ ...TIMING, cycleLenSec: 301 }] });
  return refused(r) && r.field === "signalTimingOverrides" && !/saved inputs/i.test(r.error);
});

// --- Review Focus 1: the original's saved inputs fail today's schema -------------------
const SAVED_INPUTS = /saved inputs.*no longer pass.*generator/i;
t("a parent with studyRadiusMi 7 is refused with field studyRadiusMi and the saved-inputs message", () => {
  const r = apply({ ...PARENT, studyRadiusMi: 7 }, { growthRatePct: 1 });
  return refused(r) && r.field === "studyRadiusMi" && SAVED_INPUTS.test(r.error);
});
t("the saved-inputs message names the field and points to the generator", () => {
  const r = apply({ ...PARENT, studyRadiusMi: 7 }, { growthRatePct: 1 });
  return /studyRadiusMi/.test(r.error) && /start a new study in the generator/.test(r.error) && !/\n/.test(r.error);
});
t("an empty change set on a parent the schema no longer accepts is refused too", () => {
  const r = apply({ ...PARENT, studyRadiusMi: 7 }, {});
  return refused(r) && r.field === "studyRadiusMi" && SAVED_INPUTS.test(r.error);
});
t("a parent missing a required field is refused naming that field", () => {
  const { landUseCode: _drop, ...legacy } = PARENT;
  const r = apply(legacy, { growthRatePct: 1 });
  return refused(r) && r.field === "landUseCode" && SAVED_INPUTS.test(r.error);
});
t("a parent that fails on a field the engineer did not change is refused even when the engineer's own change is also out of bounds", () => {
  const r = apply({ ...PARENT, studyRadiusMi: 7 }, { openingYear: 2051 });
  return refused(r) && r.field === "studyRadiusMi" && SAVED_INPUTS.test(r.error);
});
t("a parent whose bad field is the very one the engineer corrects is ok", () => {
  const r = apply({ ...PARENT, growthRatePct: 9 }, { growthRatePct: 1 });
  const dropped = apply({ ...PARENT, growthRatePct: 9 }, { removeGrowthOverride: true });
  return r.ok === true && r.request.growthRatePct === 1 && dropped.ok === true && !("growthRatePct" in dropped.request);
});
t("a parent that is bad at a growth rate the engineer leaves alone is refused as a saved-inputs error", () => {
  const r = apply({ ...PARENT, growthRatePct: 9 }, { passByPct: 10 });
  return refused(r) && r.field === "growthRatePct" && SAVED_INPUTS.test(r.error);
});
t("a parent that is not an object is refused, not thrown on", () =>
  [null, undefined, "x", 3, [], true].every((p) => {
    const r = apply(p, {});
    return refused(r) && SAVED_INPUTS.test(r.error);
  }));

// --- Bounds: GenerateTisBody's own, on the merged request ------------------------------
t("openingYear 2051 is refused with field openingYear, as a bounds error and not a saved-inputs one", () => {
  const r = apply(PARENT, { openingYear: 2051 });
  return refused(r) && r.field === "openingYear" && !/saved inputs/i.test(r.error) && /2050/.test(r.error);
});
t("the edges just past each bound are refused by field, and the edges themselves are ok", () => {
  const past = { growthRatePct: 6.01, passByPct: 70.01, internalCapturePct: 50.01, openingYear: 2023 };
  const edge = { growthRatePct: 6, passByPct: 70, internalCapturePct: 50, openingYear: 2050 };
  return (
    Object.entries(past).every(([f, v]) => {
      const r = apply(PARENT, { [f]: v });
      return refused(r) && r.field === f;
    }) && Object.entries(edge).every(([f, v]) => apply(PARENT, { [f]: v }).ok === true)
  );
});
t("a value of the wrong type or kind is refused by field", () =>
  [["weather", "hail"], ["signalTiming", "measured"], ["legVolumes", "counted"], ["analysisPeriods", ["night"]], ["realLaneGeometry", "yes"]].every(([f, v]) => {
    const r = apply(PARENT, { [f]: v });
    return refused(r) && r.field === f;
  }));

// --- The tool schemas ------------------------------------------------------------------
const TOOLS = [T.RERUN_TOOL, T.READ_PATH_TOOL];
const objectNodes = (node, at = "$") => {
  if (node === null || typeof node !== "object") return [];
  const own = !Array.isArray(node) && node.type === "object" ? [[at, node]] : [];
  return [...own, ...Object.entries(node).flatMap(([k, v]) => objectNodes(v, `${at}.${k}`))];
};
/** Every keyword a node of these schemas may carry: the strict-mode subset, and the ones the test validator below checks. */
const ALLOWED_KEYWORDS = ["type", "properties", "required", "additionalProperties", "enum", "const", "items", "description", "format"];
/** The keywords of a schema node and of every node under it (the names inside `properties` are not keywords). */
const keywordsOf = (node) => {
  if (node === null || typeof node !== "object") return [];
  return [...Object.keys(node), ...Object.values(node.properties ?? {}).flatMap(keywordsOf), ...keywordsOf(node.items)];
};
/** A small validator for exactly the keywords above: a schema typo shows up as a valid input it refuses. */
function schemaErrors(schema, v, at = "$") {
  const kind = (k) =>
    k === "object" ? v !== null && typeof v === "object" && !Array.isArray(v)
    : k === "array" ? Array.isArray(v)
    : k === "string" ? typeof v === "string"
    : k === "number" ? typeof v === "number" && Number.isFinite(v)
    : k === "integer" ? Number.isInteger(v)
    : k === "boolean" ? typeof v === "boolean"
    : false;
  if (schema.type !== undefined && !kind(schema.type)) return [`${at}: not a ${schema.type}`];
  const errs = [];
  if ("const" in schema && v !== schema.const) errs.push(`${at}: not ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(v)) errs.push(`${at}: not one of ${schema.enum.join("|")}`);
  if (schema.type === "object") {
    for (const k of schema.required ?? []) if (!(k in v)) errs.push(`${at}.${k}: missing`);
    for (const k of Object.keys(v)) {
      if (schema.properties?.[k]) errs.push(...schemaErrors(schema.properties[k], v[k], `${at}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${at}.${k}: unknown key`);
    }
  }
  if (schema.type === "array" && schema.items) v.forEach((x, i) => errs.push(...schemaErrors(schema.items, x, `${at}[${i}]`)));
  return errs;
}
const fits = (schema, v) => schemaErrors(schema, v).length === 0;

t("the tools are named read_study_path and rerun_study_with_changes (R1)", () => T.READ_PATH_TOOL.name === "read_study_path" && T.RERUN_TOOL.name === "rerun_study_with_changes");
t("each tool has the Anthropic tool shape: name, description, input_schema and strict: true, and nothing else", () =>
  TOOLS.every(
    (tool) =>
      same(Object.keys(tool).sort(), ["description", "input_schema", "name", "strict"]) &&
      tool.strict === true &&
      typeof tool.description === "string" &&
      tool.description.length > 40 &&
      tool.input_schema.type === "object",
  ));
t("both tools are frozen all the way down, so a caller cannot edit the schema every request sends", () => {
  const deep = (v) => v === null || typeof v !== "object" || (Object.isFrozen(v) && Object.values(v).every(deep));
  return TOOLS.every((tool) => typeof tool === "object" && tool !== null && deep(tool));
});
t("RERUN_TOOL.input_schema has no oneOf, anyOf or patternProperties", () => {
  const s = JSON.stringify(T.RERUN_TOOL.input_schema);
  return s.length > 200 && !/oneOf|anyOf|"patternProperties"/.test(s);
});
t("every object node of both tools has additionalProperties: false, and there are at least five in RERUN_TOOL", () =>
  TOOLS.every((tool) => objectNodes(tool.input_schema).every(([, node]) => node.additionalProperties === false)) && objectNodes(T.RERUN_TOOL.input_schema).length >= 5);
t("no node carries a keyword outside the strict subset (no min/max, length, count or pattern limits)", () => {
  const used = new Set(TOOLS.flatMap((tool) => keywordsOf(tool.input_schema)));
  return used.size > 3 && [...used].every((k) => ALLOWED_KEYWORDS.includes(k));
});
t("the keys of changes.properties deep-equal REVISABLE_FIELDS, in order", () => same(Object.keys(T.RERUN_TOOL.input_schema.properties.changes.properties), C.REVISABLE_FIELDS));
t("changes requires nothing: every field is optional", () => {
  const c = T.RERUN_TOOL.input_schema.properties.changes;
  return c.required === undefined || c.required.length === 0;
});
t("the top level has RerunToolInput's keys, and requires the ones RerunToolInput requires", () => {
  const shape = C.RerunToolInput.shape;
  const required = Object.keys(shape).filter((k) => !shape[k].isOptional());
  return sameSet(Object.keys(T.RERUN_TOOL.input_schema.properties), Object.keys(shape)) && sameSet(T.RERUN_TOOL.input_schema.required ?? [], required) && required.length === 2;
});
t("every property carries a type and a description, so the model is told what each field is", () =>
  [T.RERUN_TOOL.input_schema, T.RERUN_TOOL.input_schema.properties.changes].every((o) =>
    Object.values(o.properties).every((p) => typeof p.type === "string" && typeof p.description === "string" && p.description.length > 15),
  ));
t("the enums are the contract's own: weather, timing basis, volume basis, periods and the twelve movements", () => {
  const ch = T.RERUN_TOOL.input_schema.properties.changes.properties;
  const shape = C.RerunToolInput.shape.changes.shape;
  const el = shape.signalTimingOverrides.unwrap().element.shape;
  const item = ch.signalTimingOverrides.items.properties;
  return (
    same(ch.weather.enum, shape.weather.unwrap().options) &&
    same(ch.signalTiming.enum, shape.signalTiming.unwrap().options) &&
    same(ch.legVolumes.enum, shape.legVolumes.unwrap().options) &&
    same(ch.analysisPeriods.items.enum, shape.analysisPeriods.unwrap().element.options) &&
    same(item.phases.items.properties.movement.enum, el.phases.element.shape.movement.options) &&
    item.phases.items.properties.movement.enum.length === 12
  );
});
t("the enums also match GenerateTisBody's, so the tool cannot offer a value the generator refuses", () => {
  const ch = T.RERUN_TOOL.input_schema.properties.changes.properties;
  const body = G.GenerateTisBody.shape;
  return (
    same(ch.weather.enum, body.weather.unwrap().options) &&
    same(ch.signalTiming.enum, body.signalTiming.removeDefault().options) &&
    same(ch.legVolumes.enum, body.legVolumes.removeDefault().options) &&
    same(ch.analysisPeriods.items.enum, body.analysisPeriods.unwrap().element.options)
  );
});
t("the numeric fields say their bounds in words, read off GenerateTisBody, because strict mode cannot carry min or max", () => {
  const ch = T.RERUN_TOOL.input_schema.properties.changes.properties;
  const body = G.GenerateTisBody.shape;
  const says = (f, schema) => ch[f].description.includes(`${schema.minValue} to ${schema.maxValue}`);
  return (
    says("growthRatePct", body.growthRatePct.unwrap()) &&
    says("openingYear", body.openingYear) &&
    says("passByPct", body.passByPct.unwrap()) &&
    says("internalCapturePct", body.internalCapturePct.unwrap()) &&
    ch.growthRatePct.description.includes("0 to 6") &&
    ch.openingYear.description.includes("2024 to 2050")
  );
});
t("the schema accepts a full input: all twelve value fields, a timing sheet, a reason, a source label and a finding", () =>
  fits(T.RERUN_TOOL.input_schema, { changes: ALL, reason: "r", sourceLabel: "county letter", findingId: randomUUID() }) &&
  fits(T.RERUN_TOOL.input_schema, { changes: { removeGrowthOverride: true }, reason: "r" }) &&
  fits(T.RERUN_TOOL.input_schema, { changes: {}, reason: "re-run on the current engine" }));
t("what the schema accepts, RerunToolInput accepts, field by field", () => {
  const inputs = [
    { changes: ALL, reason: "r" },
    { changes: { removeGrowthOverride: true }, reason: "r" },
    { changes: { signalTimingOverrides: [TIMING] }, reason: "r", findingId: randomUUID(), sourceLabel: "s" },
  ];
  return inputs.every((i) => fits(T.RERUN_TOOL.input_schema, i) && accepts(C.RerunToolInput, i));
});
t("the schema refuses a locked field, an unknown key, a missing reason and a wrong type", () => {
  const s = T.RERUN_TOOL.input_schema;
  return (
    !fits(s, { changes: { latitude: 1 }, reason: "r" }) &&
    !fits(s, { changes: {}, reason: "r", extra: 1 }) &&
    !fits(s, { changes: {} }) &&
    !fits(s, { reason: "r" }) &&
    !fits(s, { changes: { growthRatePct: "1" }, reason: "r" }) &&
    !fits(s, { changes: { removeGrowthOverride: false }, reason: "r" }) &&
    !fits(s, { changes: { weather: "hail" }, reason: "r" }) &&
    !fits(s, { changes: { signalTimingOverrides: [{ ...TIMING, cycleLenSec: undefined }] }, reason: "r" }) &&
    !fits(s, { changes: { signalTimingOverrides: [{ ...TIMING, extra: 1 }] }, reason: "r" }) &&
    !fits(s, { changes: { signalTimingOverrides: [{ ...TIMING, phases: [{ movement: "NB", phase: 2 }] }] }, reason: "r" })
  );
});
t("every field of a timing record is required, and phases and splits are arrays of pairs, not keyed records", () => {
  const rec = T.RERUN_TOOL.input_schema.properties.changes.properties.signalTimingOverrides;
  return (
    rec.type === "array" &&
    sameSet(rec.items.required, ["intersectionName", "latitude", "longitude", "cycleLenSec", "phases", "splits"]) &&
    rec.items.properties.phases.type === "array" &&
    sameSet(rec.items.properties.phases.items.required, ["movement", "phase"]) &&
    rec.items.properties.splits.type === "array" &&
    sameSet(rec.items.properties.splits.items.required, ["phase", "seconds"])
  );
});
t("the description tells the model the method fields it may choose and that the original is never changed", () => {
  const d = T.RERUN_TOOL.description;
  return C.METHOD_FIELDS.every((f) => d.includes(f)) && /original/i.test(d) && /new version/i.test(d);
});
t("READ_PATH_TOOL takes one required string, path, and nothing else, and names its byte cap", () => {
  const s = T.READ_PATH_TOOL.input_schema;
  return same(Object.keys(s.properties), ["path"]) && s.properties.path.type === "string" && same(s.required, ["path"]) && s.additionalProperties === false && T.READ_PATH_TOOL.description.includes(String(C.DATUM_LIMITS.readPathBytes)) && /read-only/i.test(T.READ_PATH_TOOL.description);
});
t("READ_PATH_TOOL's schema takes a path and refuses anything else", () => {
  const s = T.READ_PATH_TOOL.input_schema;
  return fits(s, { path: "request.growthRatePct" }) && !fits(s, {}) && !fits(s, { path: 3 }) && !fits(s, { path: "request.x", extra: 1 });
});
t("no banned phrase appears in either tool or in tools.ts", () => {
  const BANNED = /independent[\s-]*review|second[\s-]*opinion|peer[\s-]*review|qa\s*[/\\-]?\s*qc|\baudit/i;
  return toolsSrc.length > 0 && !BANNED.test(JSON.stringify(TOOLS)) && !BANNED.test(toolsSrc);
});

// ===========================================================================
// context
// ===========================================================================
section("context");

const GUIDE_REL = "artifacts/tis-api-server/src/lib/datum-chat/clause-guide.ts";
const CONTEXT_REL = "artifacts/tis-api-server/src/lib/datum-chat/context.ts";
const { mod: GU, error: guideError } = await importByUrl(GUIDE_REL);
ok("the clause guide loads under plain node (no loader)", guideError === null, guideError ?? undefined);
const { mod: X, error: contextError } = await importByUrl(CONTEXT_REL);
ok("the context module loads under plain node (no loader)", contextError === null, contextError ?? undefined);
const { mod: PF, error: proofreadError } = await importByUrl("artifacts/tis-api-server/src/lib/proofread/index.ts");
ok("precondition: the proofread registry loads, so the guide can be compared with it", proofreadError === null, proofreadError ?? undefined);
const guideSrc = read(GUIDE_REL);
const contextSrc = read(CONTEXT_REL);

// --- Pure, like lib/proofread/, and the contract only through ./contract.ts ------------------
/** The pin every pure datum-chat module carries; the prompt section runs it on prompt.ts as well. */
const pinPure = (name, src) => {
  const code = stripComments(src);
  const rel = [...code.matchAll(/\bfrom\s+"(\.{1,2}\/[^"]*)"/g)].map((m) => m[1]);
  ok(`${name} imports no SDK, db or logger, reads no env and fetches nothing`, code.length > 0 && !/@anthropic-ai\/sdk|@workspace\/db|\blogger\b|process\.env|\bfetch\s*\(|\brequire\s*\(/.test(code));
  ok(`every relative import in ${name} carries an explicit .ts`, rel.length > 0 && rel.every((p) => p.endsWith(".ts")), rel.join(", "));
  ok(`pure datum-chat modules import the contract only via ./contract.ts: ${name} imports it there and names no tis-api-zod path`, rel.includes("./contract.ts") && !/tis-api-zod/.test(code), rel.join(", "));
};
for (const [name, src] of [["clause-guide.ts", guideSrc], ["context.ts", contextSrc]]) pinPure(name, src);

// --- The scenario-base.json record -------------------------------------------------------
let FX = {};
try {
  FX = JSON.parse(read("artifacts/atlanta-tis/scripts/fixtures/scenario-base.json"));
} catch (e) {
  ok("precondition: scenario-base.json parses", false, e instanceof Error ? e.message : String(e));
}
// One deliberate break. Since #250 built the intersection row from its approaches (the 2026-10-02 re-pin,
// artifacts/atlanta-tis/scripts/fixtures/README.md) the payload has no v/c above the 2.5 ceiling and no intersection
// delay at the 300 s clamp; a study saved before #250 printed this network's row 36 (Signal 2.3mi N of CBD) at v/c 2.68
// and at the clamp. Row 36 is put back over the ceiling (v/c 2.7) and at the clamp (300 s, LOS F) in every scenario it
// carries, in the top-level block and in every period, so the summary's rowsOverCeiling and the real clauses (two
// BLOCKERs, a DISCLOSE and a NOTE, as before the re-pin) have something to find. Every test below reads this record.
for (const rows of [FX.affectedIntersections, ...(Array.isArray(FX.periodReports) ? FX.periodReports.map((p) => p?.affectedIntersections) : [])]) {
  const r = Array.isArray(rows) ? rows[36] : undefined;
  if (!r) continue;
  for (const s of ["current", "existing", "future", "designNoBuild", "designBuild"]) {
    if (typeof r[`${s}Vc`] !== "number") continue;
    r[`${s}Vc`] = 2.7;
    r[`${s}DelaySec`] = 300;
    r[`${s}Los`] = "F";
  }
}
const { request: FX_REQUEST, ...FX_RESULT } = FX;
/** The stored form: the fixture's request (growth set to 2.1) and its result payload, which is the fixture without its echoed `request`. */
const REC = { request: { ...FX_REQUEST, growthRatePct: 2.1 }, result: FX_RESULT };
t("precondition: the fixture has three period reports (40 rows each for AM and PM, none for daily) and a v/c above 2.5", () =>
  Array.isArray(FX_RESULT.periodReports) && same(FX_RESULT.periodReports.map((p) => [p.period, p.affectedIntersections.length]), [["am_peak", 40], ["pm_peak", 40], ["daily", 0]]) &&
  FX_RESULT.periodReports.some((p) => p.affectedIntersections.some((r) => r.existingVc > 2.5)));

/** A visible finding as the store will hand one over: the proofread finding without its section or audience, plus an id. */
const visible = (f) => ({ id: randomUUID(), clauseId: f.clauseId, type: f.type, title: f.title, detail: f.detail, sourceLabel: f.sourceLabel, readPaths: f.readPaths, remedy: f.remedy });
const REAL = PF.runClauses ? PF.runClauses(REC).findings.filter((f) => f.audience !== "admin").map(visible) : [];
t("precondition: the real clauses give at least two engineer-visible findings on the fixture", () => REAL.length >= 2 && REAL[0].readPaths.length > 0 && REAL[1].readPaths.length > 0);

const jsonBlocks = (text) => [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);
const fenceLines = (text) => text.split("\n").filter((l) => l.startsWith("```"));
/** Every fence opens with ```json and closes with ```, in pairs: nothing was cut inside a block. */
const fencesPair = (text) => {
  const f = fenceLines(text);
  // Every ``` in the text is a fence line: none sits inside a value or in the middle of a line.
  return (text.match(/```/g) ?? []).length === f.length && f.length % 2 === 0 && f.every((l, i) => (i % 2 === 0 ? l === "```json" : l === "```"));
};
const jsonBlocksParse = (text) => jsonBlocks(text).every((b) => { try { JSON.parse(b); return true; } catch { return false; } });
const headingsOf = (text) => text.split("\n").filter((l) => l.startsWith("## "));
const sectionOf = (text, heading) => { const i = text.indexOf(`${heading}\n`); if (i < 0) return ""; const rest = text.slice(i); const j = rest.indexOf("\n## ", 1); return j < 0 ? rest : rest.slice(0, j); };
const blockIn = (text, heading) => { const b = jsonBlocks(sectionOf(text, heading)); return b.length ? JSON.parse(b[0]) : undefined; };
const FULL_HEADINGS = ["## Focused finding", "## Clause guide entry", "## Values at the read paths", "## Other findings", "## Request", "## Result summary"];
const pack = (over = {}, cap) => X.buildGroundingPack({ request: REC.request, result: REC.result, findings: REAL.slice(0, 2), dispositions: [], focusFindingId: REAL[1]?.id, ...over }, cap);

// --- The clause guide ----------------------------------------------------------------------
const GUIDE = GU.CLAUSE_GUIDE ?? {};
const ALL_IDS = Array.isArray(PF.ALL_CLAUSES) ? PF.ALL_CLAUSES.map((c) => c.id) : [];
t("CLAUSE_GUIDE has a key for each engineer-visible clause in ALL_CLAUSES, and none for losMatchesDelay", () =>
  ALL_IDS.length === 12 && same(Object.keys(GUIDE).sort(), ALL_IDS.filter((id) => id !== "losMatchesDelay").sort()) && !("losMatchesDelay" in GUIDE) && Object.keys(GUIDE).length === 11);
t("criteriaNamed is explain-only and rateReproducesTotal is a re-run", () => GUIDE.criteriaNamed?.fixable === "explain" && GUIDE.rateReproducesTotal?.fixable === "rerun");
t("fixable follows the clause map: five re-run, five partial, one explain", () => {
  const by = (v) => Object.keys(GUIDE).filter((k) => GUIDE[k].fixable === v);
  return (
    sameSet(by("rerun"), ["growthOverrideDisclosed", "growthMultiplierReproduces", "rateReproducesTotal", "passByBasisNamed", "periodScopeDisclosed"]) &&
    sameSet(by("partial"), ["vcPlausibilityIntersection", "vcPlausibilityApproach", "vcPlausibilityDesignYear", "screeningClampDisclosed", "scopeNoteConsistent"]) &&
    sameSet(by("explain"), ["criteriaNamed"])
  );
});
t("every entry has non-empty why and clears text, a fixable value, and inputs drawn from REVISABLE_FIELDS without repeats", () =>
  Object.values(GUIDE).length === 11 &&
  Object.values(GUIDE).every(
    (e) =>
      typeof e.why === "string" && e.why.length > 40 && typeof e.clears === "string" && e.clears.length > 40 &&
      ["rerun", "partial", "explain"].includes(e.fixable) && Array.isArray(e.inputs) &&
      e.inputs.every((f) => C.REVISABLE_FIELDS.includes(f)) && new Set(e.inputs).size === e.inputs.length,
  ));
t("inputs follow the clause map: none for the three engine-side clauses, the named field for the single-input clauses", () =>
  ["growthMultiplierReproduces", "rateReproducesTotal", "criteriaNamed"].every((k) => same(GUIDE[k]?.inputs, [])) &&
  same(GUIDE.passByBasisNamed?.inputs, ["passByPct"]) &&
  same(GUIDE.periodScopeDisclosed?.inputs, ["analysisPeriods"]) &&
  same(GUIDE.scopeNoteConsistent?.inputs, ["scopeStudyIntersections"]) &&
  sameSet(GUIDE.growthOverrideDisclosed?.inputs ?? [], ["growthRatePct", "removeGrowthOverride"]));
t("the v/c, design-year and clamp clauses list every capacity input; growth and opening year only where the map puts them", () => {
  const CAP = ["signalTimingOverrides", "signalTiming", "realLaneGeometry", "legVolumes", "weather"];
  const has = (k, fields) => fields.every((f) => GUIDE[k]?.inputs.includes(f));
  const lacks = (k, fields) => fields.every((f) => !GUIDE[k]?.inputs.includes(f));
  return (
    ["vcPlausibilityIntersection", "vcPlausibilityApproach", "vcPlausibilityDesignYear", "screeningClampDisclosed"].every((k) => has(k, CAP)) &&
    ["vcPlausibilityIntersection", "vcPlausibilityApproach", "vcPlausibilityDesignYear"].every((k) => has(k, ["growthRatePct", "openingYear"])) &&
    has("vcPlausibilityDesignYear", ["passByPct", "internalCapturePct"]) &&
    lacks("screeningClampDisclosed", ["growthRatePct", "openingYear", "passByPct"]) &&
    lacks("vcPlausibilityIntersection", ["passByPct", "internalCapturePct"])
  );
});
t("the guide says plainly that measured counts cannot be brought in through the chat, on the v/c clauses", () =>
  ["vcPlausibilityIntersection", "vcPlausibilityApproach", "vcPlausibilityDesignYear"].every((k) => /UTDF|Synchro/.test(GUIDE[k]?.clears ?? "") && /cannot/i.test(GUIDE[k]?.clears ?? "")));
t("CLAUSE_GUIDE and its entries are frozen, and FIXABLE_MEANING explains each fixable value", () =>
  frozen(GUIDE) && Object.values(GUIDE).length === 11 && Object.values(GUIDE).every((e) => frozen(e) && frozen(e.inputs)) &&
  sameSet(Object.keys(GU.FIXABLE_MEANING ?? {}), ["rerun", "partial", "explain"]) && Object.values(GU.FIXABLE_MEANING).every((m) => typeof m === "string" && m.length > 20));

// --- The focused finding ---------------------------------------------------------------------
t("with two findings focused on the second, the first section is \"## Focused finding\" and it holds the second's title", () => {
  const p = pack();
  return p.sections[0] === "## Focused finding" && p.text.startsWith("## Focused finding\n") && sectionOf(p.text, "## Focused finding").includes(REAL[1].title) && !sectionOf(p.text, "## Focused finding").includes(REAL[0].title);
});
t("the sections come in the plan's order, the headings in the text are exactly the sections returned, and bytes is the text's UTF-8 length", () => {
  const p = pack();
  return same(p.sections, FULL_HEADINGS) && same(headingsOf(p.text), p.sections) && p.bytes === Buffer.byteLength(p.text, "utf8") && p.bytes <= C.DATUM_LIMITS.packBytes;
});
t("the focused section carries the id, clause, type, source label, detail and remedy in full", () => {
  const s = sectionOf(pack().text, "## Focused finding");
  const f = REAL[1];
  return [f.id, f.clauseId, f.type, f.title, f.sourceLabel, f.detail, f.remedy].every((v) => s.includes(v));
});
t("the focused finding's clause guide entry follows it: why, what clears it, the inputs, and what fixable means", () => {
  const s = sectionOf(pack().text, "## Clause guide entry");
  const g = GUIDE[REAL[1].clauseId];
  return g !== undefined && s.includes(REAL[1].clauseId) && s.includes(g.why) && s.includes(g.clears) && g.inputs.every((f) => s.includes(f)) && s.includes(g.fixable) && s.includes(GU.FIXABLE_MEANING[g.fixable]);
});
t("a clause with no inputs says so in its guide entry", () => {
  const f = { ...REAL[0], clauseId: "criteriaNamed" };
  const s = sectionOf(pack({ findings: [f, REAL[1]], focusFindingId: f.id }).text, "## Clause guide entry");
  return /none/i.test(s) && s.includes(GUIDE.criteriaNamed.why) && s.includes("explain");
});
t("every readPath's value appears, as the value stored at that path now", () => {
  const f = REAL[1];
  const block = blockIn(pack().text, "## Values at the read paths");
  return Array.isArray(block) && block.length === f.readPaths.length && f.readPaths.every((rp, i) => block[i].path === rp.path && block[i].value === rp.value);
});
t("a readPath whose stored value differs from the one the clause saw shows both; one that resolves to nothing says so", () => {
  const f = { ...REAL[0], readPaths: [{ path: "request.growthRatePct", value: 1.5 }, { path: "result.nope.x", value: 9 }, { path: "request.projectName", value: "Peachtree Multifamily" }] };
  const block = blockIn(pack({ findings: [f, REAL[1]], focusFindingId: f.id }).text, "## Values at the read paths");
  return (
    Array.isArray(block) && block.length === 3 &&
    block[0].path === "request.growthRatePct" && block[0].value === 2.1 && block[0].recorded === 1.5 &&
    block[1].path === "result.nope.x" && block[1].value === null && block[1].recorded === 9 && /no value/i.test(block[1].note ?? "") &&
    block[2].value === "Peachtree Multifamily" && !("recorded" in block[2])
  );
});
t("a path that is not rooted at request. or result. is never read, even if a finding cites it", () => {
  const f = { ...REAL[0], readPaths: [{ path: "process.env.HOME", value: "x" }] };
  const p = pack({ findings: [f], focusFindingId: f.id });
  const block = blockIn(p.text, "## Values at the read paths");
  return Array.isArray(block) && block[0].value === null && !p.text.includes(process.env.HOME ?? "\u0000none");
});
t("the other findings are one line each, with their id, clause, type and title, and the focused one is not repeated there", () => {
  const s = sectionOf(pack().text, "## Other findings");
  const lines = s.split("\n").filter((l) => l.startsWith("- "));
  return lines.length === 1 && lines[0].includes(REAL[0].id) && lines[0].includes(REAL[0].clauseId) && lines[0].includes(REAL[0].title) && !s.includes(REAL[1].id);
});
t("the latest decision on the focused finding is shown there, and on other findings in their line; older ones are not", () => {
  const d = (findingId, disposition, createdAt, extra = {}) => ({ findingId, disposition, note: null, sourceLabel: null, createdAt, ...extra });
  const dispositions = [
    d(REAL[1].id, "BUG_FILED", "2026-09-01T00:00:00.000Z"),
    d(REAL[1].id, "DISCLOSED", "2026-10-01T00:00:00.000Z", { note: "Stated in the limitations section", sourceLabel: "County letter 2026-09-30" }),
    d(REAL[0].id, "FIXED", "2026-10-02T00:00:00.000Z"),
    { garbage: true },
    null,
  ];
  const a = pack({ dispositions }).text;
  const b = pack({ dispositions: [...dispositions].reverse() }).text;
  const focused = sectionOf(a, "## Focused finding");
  const other = sectionOf(a, "## Other findings");
  return (
    focused.includes("DISCLOSED") && focused.includes("Stated in the limitations section") && focused.includes("County letter 2026-09-30") && !focused.includes("BUG_FILED") &&
    other.includes("FIXED") && a === b
  );
});
t("with no decision recorded the focused section says so", () => /Decision: none recorded/.test(sectionOf(pack().text, "## Focused finding")));
t("without a focused finding, or with an id that is not among the findings, the pack opens with the findings and has no focus or guide section", () =>
  [undefined, randomUUID()].every((id) => {
    const p = pack({ focusFindingId: id });
    return same(p.sections, ["## Findings", "## Request", "## Result summary"]) && p.text.startsWith("## Findings\n") && !p.text.includes("## Focused finding") && sectionOf(p.text, "## Findings").split("\n").filter((l) => l.startsWith("- ")).length === 2;
  }));
t("with no findings at all the pack says none are visible, and still holds the request and the result summary", () => {
  const p = pack({ findings: [], focusFindingId: undefined });
  return same(p.sections, ["## Findings", "## Request", "## Result summary"]) && /no findings are visible/.test(sectionOf(p.text, "## Findings")) && jsonBlocksParse(p.text);
});
t("a focused finding that is the only one leaves no \"Other findings\" section to read", () => {
  const p = pack({ findings: [REAL[1]] });
  return same(p.sections, FULL_HEADINGS.filter((h) => h !== "## Other findings"));
});

// --- Withheld findings ---------------------------------------------------------------------
const throwsWithheld = (fn) => { try { fn(); return false; } catch (e) { return e instanceof Error && e.message === "withheld finding passed to pack"; } };
t("a finding with audience admin passed in by mistake throws \"withheld finding passed to pack\", focused or not", () =>
  throwsWithheld(() => pack({ findings: [{ ...REAL[0], audience: "admin" }, REAL[1]] })) &&
  throwsWithheld(() => pack({ findings: [REAL[0], { ...REAL[1], audience: "admin" }] })) &&
  throwsWithheld(() => pack({ findings: [REAL[0], { ...REAL[1], audience: "admin" }], focusFindingId: undefined })));
t("a finding whose audience is engineer or pe is accepted, and a finding without an audience field is the normal case", () => {
  const p = pack({ findings: [{ ...REAL[0], audience: "engineer" }, { ...REAL[1], audience: "pe" }] });
  return p.sections[0] === "## Focused finding" && pack().sections[0] === "## Focused finding";
});
t("losMatchesDelay is never packed even when its audience was dropped along the way", () =>
  throwsWithheld(() => pack({ findings: [REAL[0], { ...REAL[1], clauseId: "losMatchesDelay" }] })));

// --- The request summary -------------------------------------------------------------------
t("the request summary holds the study's scalar inputs as stored", () => {
  const b = blockIn(pack().text, "## Request");
  return b !== undefined && b.projectName === REC.request.projectName && b.openingYear === REC.request.openingYear && b.growthRatePct === 2.1 && b.landUseCode === REC.request.landUseCode && b.size === REC.request.size && same(b.analysisPeriods, REC.request.analysisPeriods);
});
const inflate = (rec) => {
  const big = structuredClone(rec);
  const movements = ["NBL", "NBT", "NBR", "SBL", "SBT", "SBR", "EBL", "EBT", "EBR", "WBL", "WBT", "WBR"];
  big.request.utdfIntersections = Array.from({ length: 60 }, (_, i) => ({
    intId: i, name: `Peachtree St & ${i}th St`, source: "utdf", latitude: 33.78 + i / 1e4, longitude: -84.38,
    volumes: Object.fromEntries(movements.map((m) => [m, 100 + i])), phf: 0.92, hvPct: 2,
    storageFt: Object.fromEntries(movements.map((m) => [m, 150])), lanes: Object.fromEntries(movements.map((m) => [m, 1])),
    cycleLenSec: 90, phaseByMovement: Object.fromEntries(movements.map((m) => [m, 2])), splitSByPhase: { 2: 40, 4: 30 },
  }));
  big.request.driveways = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, latitude: 33.78, longitude: -84.38, label: `Driveway ${i}`, accessType: "full", movements: { inLeft: true, inRight: true, outLeft: true, outRight: true } }));
  big.request.tripProfile = { arrivals: Array.from({ length: 24 }, (_, i) => i / 276), departures: Array.from({ length: 24 }, (_, i) => i / 276), source: "Site survey, May 2026" };
  big.request.studyIntersectionIds = Array.from({ length: 60 }, (_, i) => `ATL-${69421271 + i}`);
  big.request.signalTimingOverrides = Array.from({ length: 60 }, (_, i) => ({ latitude: 33.78, longitude: -84.38, name: `Signal ${i}`, cycleLenSec: 90, phaseByMovement: Object.fromEntries(movements.map((m) => [m, 2])), splitSByPhase: { 2: 40, 4: 30 } }));
  // Every row of every period breaches the ceiling in three scenarios.
  for (const p of big.result.periodReports) for (const r of p.affectedIntersections) { r.currentVc = 3.1; r.existingVc = 3.4; r.designNoBuildVc = 4.2; }
  big.result.growthSource = `Explicit override. ${"The measured rate is the median of many stations. ".repeat(200)}`;
  return big;
};
const BIG = inflate(REC);
t("the arrays utdfIntersections and driveways and the tripProfile are replaced by counts, and the rest of the request is kept", () => {
  const b = blockIn(pack({ request: BIG.request, result: BIG.result }).text, "## Request");
  return (
    b !== undefined &&
    same(b.utdfIntersections, { count: 60 }) && same(b.driveways, { count: 12 }) &&
    same(b.tripProfile?.arrivals, { count: 24 }) && same(b.tripProfile?.departures, { count: 24 }) && b.tripProfile?.source === "Site survey, May 2026" &&
    b.projectName === REC.request.projectName && b.growthRatePct === 2.1
  );
});
t("any other field too large to include is replaced by a count or a size, and a short list is kept whole", () => {
  const req = { ...BIG.request, note: "n".repeat(5000), extra: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i])) };
  const b = blockIn(pack({ request: req, result: BIG.result }).text, "## Request");
  return (
    same(b.signalTimingOverrides, { count: 60 }) && same(b.note, { chars: 5000 }) && b.extra.keys === 200 && b.extra.characters > 1500 &&
    same(b.studyIntersectionIds, BIG.request.studyIntersectionIds) && JSON.stringify(b).length < 4000
  );
});
t("a small list in the request, such as analysisPeriods, is kept whole", () => same(blockIn(pack().text, "## Request").analysisPeriods, REC.request.analysisPeriods));

// --- The result summary --------------------------------------------------------------------
/** The rows over the ceiling, worked out from the raw periodReports and nothing the module computed. */
const expectedOver = FX_RESULT.periodReports.flatMap((p) => p.affectedIntersections.filter((r) => ["currentVc", "existingVc", "futureVc", "designNoBuildVc", "designBuildVc"].some((k) => r[k] > 2.5)).map((r) => ({ period: p.period, name: r.name })));
t("precondition: the fixture has rows over the ceiling to find", () => expectedOver.length > 0);
t("the result summary lists the rows with a v/c above 2.5: name, period, v/c, LOS and delay, with the path to read", () => {
  const SCENARIOS = ["current", "existing", "future", "designNoBuild", "designBuild"];
  const rs = blockIn(pack().text, "## Result summary");
  const rows = rs?.rowsOverCeiling?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const first = rows[0];
  const src = FX_RESULT.periodReports.find((p) => p.period === first.period).affectedIntersections.find((r) => r.name === first.name);
  const worst = first.over[0];
  return (
    rs.rowsOverCeiling.count === expectedOver.length &&
    rows.length === Math.min(expectedOver.length, 20) &&
    rows.every((r) => expectedOver.some((e) => e.period === r.period && e.name === r.name) && r.over.length > 0 && r.over.every((o) => SCENARIOS.includes(o.scenario) && o.vc > 2.5 && typeof o.los === "string" && typeof o.delaySec === "number")) &&
    worst.vc === Math.max(...SCENARIOS.map((k) => src[`${k}Vc`] ?? 0)) &&
    worst.los === src[`${worst.scenario}Los`] && worst.delaySec === src[`${worst.scenario}DelaySec`] &&
    /^result\.periodReports\[\d+\]\.affectedIntersections\[\d+\]$/.test(first.path)
  );
});
t("the rows over the ceiling are worst first, and a row's path reads back that row's name", () => {
  const rs = blockIn(pack().text, "## Result summary");
  const rows = rs.rowsOverCeiling.rows;
  const peak = (r) => r.over[0].vc;
  const sorted = rows.every((r, i) => i === 0 || peak(rows[i - 1]) >= peak(r));
  const back = rows.every((r) => JSON.parse(X.readStudyPath(REC, `${r.path}.name`)) === r.name);
  return sorted && back;
});
t("the result summary carries growthSource, passByPctApplied, the coverage counts and the DOT name as the result states them", () => {
  const rs = blockIn(pack().text, "## Result summary");
  return (
    rs.growthSource === FX_RESULT.growthSource && rs.passByPctApplied === FX_RESULT.passByPctApplied &&
    rs.coverage?.intersectionsInStudyArea === FX_RESULT.intersectionsInStudyArea && rs.coverage?.intersectionsStudied === FX_RESULT.intersectionsStudied &&
    rs.coverage?.intersectionsMergedAsDuplicates === FX_RESULT.intersectionsMergedAsDuplicates &&
    rs.coverage?.intersectionsWithLosDrop === FX_RESULT.intersectionsWithLosDrop && rs.coverage?.intersectionsAtLosEf === FX_RESULT.intersectionsAtLosEf &&
    rs.jurisdiction?.dotName === FX_RESULT.jurisdiction.dotName && rs.regionCode === FX_RESULT.regionCode
  );
});
t("the result summary gives each reported period's LOS drops, LOS E/F count and worst delay change", () => {
  const rs = blockIn(pack().text, "## Result summary");
  return (
    Array.isArray(rs.periods) && rs.periods.length === FX_RESULT.periodReports.length &&
    FX_RESULT.periodReports.every((p, i) => rs.periods[i].period === p.period && rs.periods[i].intersectionsWithLosDrop === p.intersectionsWithLosDrop && rs.periods[i].intersectionsAtLosEf === p.intersectionsAtLosEf && rs.periods[i].worstDelayDeltaSec === p.worstDelayDeltaSec)
  );
});
t("the 2.5 ceiling in the summary is the engine's own PLAUSIBLE_MAX_INTERSECTION_VC", () => {
  const src = read("lib/tis-engine-core/src/signal-delay.ts");
  const m = /export const PLAUSIBLE_MAX_INTERSECTION_VC\s*=\s*([\d.]+)/.exec(src);
  return m !== null && Number(m[1]) === blockIn(pack().text, "## Result summary").vcCeiling;
});
t("a result with none of those fields still gives a summary, and a record that is not an object does not throw", () => {
  const a = pack({ request: {}, result: {} });
  const b = pack({ request: null, result: "nope" });
  return [a, b].every((p) => jsonBlocksParse(p.text) && p.sections.includes("## Result summary") && p.sections.includes("## Request")) && blockIn(a.text, "## Result summary").rowsOverCeiling.count === 0;
});

// --- Review Focus 4: a large study --------------------------------------------------------
const IDS = Object.keys(GUIDE);
const BIG_FINDINGS = Array.from({ length: 200 }, (_, i) => ({
  id: randomUUID(), clauseId: IDS[i % IDS.length], type: i % 3 === 0 ? "BLOCKER" : "DISCLOSE",
  title: `Finding ${i} ${"title words ".repeat(60)}`, detail: `Detail ${i}. ${"The intersection is over the ceiling. ".repeat(300)}`,
  sourceLabel: `Source ${i} ${"x".repeat(900)}`,
  readPaths: Array.from({ length: 300 }, (_, k) => ({ path: `result.periodReports[${k % 3}].affectedIntersections[${k % 40}].designNoBuildVc`, value: 4.2 })),
  remedy: `Remedy ${i}. ${"Obtain measured counts. ".repeat(150)}`,
}));
const bigPack = (cap, focusIndex = 149) => X.buildGroundingPack({ request: BIG.request, result: BIG.result, findings: BIG_FINDINGS, dispositions: [], focusFindingId: BIG_FINDINGS[focusIndex].id }, cap);
t("a large study (60 UTDF intersections, 12 driveways, a 24+24 trip profile, 200 findings) packs within 61440 bytes", () => {
  const p = bigPack();
  return p.bytes <= C.DATUM_LIMITS.packBytes && p.bytes === Buffer.byteLength(p.text, "utf8") && p.bytes > 5000;
});
t("on the large study the focused finding is still the first section, whole as far as it is bounded, and its title is there", () => {
  const p = bigPack();
  return p.sections[0] === "## Focused finding" && p.text.startsWith("## Focused finding\n") && sectionOf(p.text, "## Focused finding").includes(`Finding 149 `) && sectionOf(p.text, "## Focused finding").includes(BIG_FINDINGS[149].id);
});
t("on the large study the lists are bounded and say so: 100 of 300 read paths, 60 of the 199 other findings", () => {
  const p = bigPack();
  const vals = sectionOf(p.text, "## Values at the read paths");
  const others = sectionOf(p.text, "## Other findings");
  return (
    blockIn(p.text, "## Values at the read paths").length === 100 && vals.includes("Showing the first 100 of 300") &&
    others.split("\n").filter((l) => l.startsWith("- ")).length === 60 && others.includes("(139 more findings not shown)")
  );
});
t("on the large study every fenced json block parses and every fence is paired", () => {
  const p = bigPack();
  return jsonBlocks(p.text).length >= 2 && jsonBlocksParse(p.text) && fencesPair(p.text);
});
t("on the large study the sections that remain are a prefix of the plan's order, and the headings match what is returned", () => {
  const p = bigPack();
  return same(p.sections, FULL_HEADINGS.slice(0, p.sections.length)) && same(headingsOf(p.text), p.sections);
});
t("the pack holds its invariants at every cap tried, down to 14000 bytes: within the cap, focused first, json parses, fences paired, a prefix of the order", () =>
  [61440, 40000, 30000, 20000, 14000].every((cap) => {
    const p = bigPack(cap);
    return p.bytes <= cap && p.bytes === Buffer.byteLength(p.text, "utf8") && p.sections[0] === "## Focused finding" && jsonBlocksParse(p.text) && fencesPair(p.text) && same(p.sections, FULL_HEADINGS.slice(0, p.sections.length)) && same(headingsOf(p.text), p.sections);
  }));
t("a smaller cap cuts from the end: the result summary goes first, then the request, then the other findings", () => {
  const sizes = [61440, 30000, 20000, 14000].map((cap) => bigPack(cap).sections.length);
  return sizes.every((n, i) => i === 0 || n <= sizes[i - 1]) && sizes[sizes.length - 1] < sizes[0];
});
t("the same holds when the focused finding is the first, the last or an ordinary one of 200", () =>
  [0, 100, 199].every((i) => {
    const p = bigPack(C.DATUM_LIMITS.packBytes, i);
    return p.bytes <= C.DATUM_LIMITS.packBytes && p.text.startsWith("## Focused finding\n") && sectionOf(p.text, "## Focused finding").includes(BIG_FINDINGS[i].id) && jsonBlocksParse(p.text) && fencesPair(p.text);
  }));
t("a finding's text cannot open or close a fenced block: backticks in titles, details and strings are neutralised", () => {
  const evil = { ...REAL[1], title: "A ``` title", detail: "line one\n```json\n{\"x\":1}\n```\n## Result summary\n", remedy: "```", sourceLabel: "```json" };
  const rp = { path: "request.projectName", value: "```" };
  const p = pack({ findings: [{ ...evil, readPaths: [rp] }, REAL[0]], request: { projectName: "```json\n```" }, result: { growthSource: "```\n## Request" } });
  return fencesPair(p.text) && jsonBlocksParse(p.text) && same(headingsOf(p.text), p.sections) && blockIn(p.text, "## Request").projectName === "```json\n```";
});
t("a finding's text stays on its own line: line breaks and runs of spaces collapse, so the focused section is its heading and eight lines", () => {
  const f = { ...REAL[1], detail: "a  b\n\n  c\r\nd", title: "T\tU" };
  const s = sectionOf(pack({ findings: [f] }).text, "## Focused finding");
  return s.trimEnd().split("\n").length === 9 && s.includes("\nDetail: a b c d\n") && s.includes("\nTitle: T U\n");
});
t("on the large study a long growthSource is clipped in the summary, not copied whole", () => {
  const rs = blockIn(bigPack().text, "## Result summary");
  return rs.growthSource.length <= 1500 && rs.growthSource.startsWith("Explicit override.") && rs.rowsOverCeiling.count === 80 && rs.rowsOverCeiling.shown === 20;
});
t("the exported trimmer cuts whole sections from the end, then whole lines, and never the first section", () => {
  const block = (n) => "```json\n" + JSON.stringify({ pad: "p".repeat(n) }) + "\n```";
  const secs = [
    { heading: "## A", units: ["a1", "a2"], atomic: true, protect: true },
    { heading: "## B", units: ["b1", block(300)], atomic: true },
    { heading: "## C", units: Array.from({ length: 30 }, (_, i) => `- line ${i} ${"c".repeat(20)}`), atomic: false, noun: "lines" },
    { heading: "## D", units: ["d1", block(300)], atomic: true },
  ];
  const render = (r) => X.renderSections(r);
  const size = (r) => Buffer.byteLength(render(r), "utf8");
  const full = X.trimSections(secs, 1e9);
  const noD = X.trimSections(secs, size(full) - 1);
  const cLines = X.trimSections(secs, size(noD) - 1);
  const small = X.trimSections(secs, 100);
  return (
    full.length === 4 && same(noD.map((s) => s.heading), ["## A", "## B", "## C"]) && noD[2].units.length === 30 &&
    same(cLines.map((s) => s.heading), ["## A", "## B", "## C"]) && cLines[2].units.length < 30 && cLines[2].units.length > 0 &&
    size(cLines) <= size(noD) - 1 && cLines[2].units.every((u) => !u.includes("```")) && /\d+ more lines/.test(render(cLines)) &&
    small[0].heading === "## A" && small.length >= 1 && jsonBlocksParse(render(small)) && fencesPair(render(small)) &&
    secs[2].units.length === 30
  );
});
t("the trimmer keeps the protected first section even when it alone exceeds the cap, shortening it by whole lines", () => {
  const secs = [{ heading: "## A", units: Array.from({ length: 20 }, (_, i) => `line ${i} ${"z".repeat(40)}`), atomic: false, protect: true }, { heading: "## B", units: ["b"], atomic: true }];
  const out = X.trimSections(secs, 300);
  const text = X.renderSections(out);
  return out.length === 1 && out[0].heading === "## A" && Buffer.byteLength(text, "utf8") <= 300 && out[0].units.length >= 3 && out[0].units.length < 20 && out[0].units.every((u, i) => u === secs[0].units[i]);
});

// --- readStudyPath -------------------------------------------------------------------------
t("readStudyPath(record, \"request.growthRatePct\") returns \"2.1\"", () => X.readStudyPath(REC, "request.growthRatePct") === "2.1");
t("a string value comes back as JSON text, an object as compact JSON", () =>
  X.readStudyPath(REC, "request.projectName") === JSON.stringify(REC.request.projectName) && X.readStudyPath(REC, "result.jurisdiction") === JSON.stringify(FX_RESULT.jurisdiction));
t("dotted and indexed segments both work, and they reach the same value", () => {
  const a = X.readStudyPath(REC, "result.periodReports[1].affectedIntersections[36].existingVc");
  const b = X.readStudyPath(REC, "result.periodReports.1.affectedIntersections.36.existingVc");
  return a === String(FX_RESULT.periodReports[1].affectedIntersections[36].existingVc) && a === b;
});
t("every readPath the real clauses emit resolves with readStudyPath to the value the clause recorded", () => {
  const paths = REAL.flatMap((f) => f.readPaths);
  return paths.length > 10 && paths.every((rp) => X.readStudyPath(REC, rp.path) === JSON.stringify(rp.value));
});
t("a path with nothing stored at it answers \"(no value at <path>)\"", () =>
  X.readStudyPath(REC, "result.nope.x") === "(no value at result.nope.x)" &&
  X.readStudyPath(REC, "result.periodReports[9].period") === "(no value at result.periodReports[9].period)" &&
  X.readStudyPath(REC, "request.studyRadiusMiles") === "(no value at request.studyRadiusMiles)");
t("a path outside request. and result. answers the same way, and reads nothing", () =>
  ["process.env", "process.env.HOME", "globalThis", "require('fs')", "", "request", "result", "request.", "request..x", "request[abc]", "../request.size", "constructor.name", "__proto__"].every((p) => X.readStudyPath(REC, p) === `(no value at ${p})`));
t("it never walks the prototype chain: constructor, __proto__, toString and the like are not values, and neither is the length of a string", () =>
  ["request.__proto__", "request.constructor", "request.constructor.name", "request.toString", "result.periodReports.constructor", "result.periodReports.toString", "result.periodReports.map", "result.growthSource.length", "request.hasOwnProperty", "request.length"].every((p) => X.readStudyPath(REC, p) === `(no value at ${p})`));
t("the length of an array is a value, as the real clauses cite it: a terminal .length on an array and nowhere else", () =>
  X.readStudyPath(REC, "result.periodReports.length") === "3" &&
  X.readStudyPath(REC, "result.affectedIntersections.length") === "40" &&
  X.readStudyPath(REC, "result.findings.length") === String(FX_RESULT.findings.length) &&
  X.readStudyPath(REC, "request.analysisPeriods.length") === "3" &&
  X.readStudyPath(REC, "result.periodReports[0].affectedIntersections.length") === "40" &&
  X.readStudyPath({ request: { a: [] }, result: {} }, "request.a.length") === "0" &&
  // not a member of anything but an array, and not something to walk on from
  X.readStudyPath(REC, "result.periodReports.length.toFixed") === "(no value at result.periodReports.length.toFixed)" &&
  X.readStudyPath(REC, "result.periodReports.length.length") === "(no value at result.periodReports.length.length)" &&
  X.readStudyPath(REC, "result.periodReports[0].length") === "(no value at result.periodReports[0].length)" &&
  X.readStudyPath(REC, "result.jurisdiction.length") === "(no value at result.jurisdiction.length)" &&
  X.readStudyPath(REC, "result.periodReports[length]") === "(no value at result.periodReports[length])" &&
  X.readStudyPath({ request: { o: { length: 7 } }, result: {} }, "request.o.length") === "7");

// --- The clauses whose readPaths end in .length (the scenario-base fixture fires none of them) ------------------
const LENGTH_PATHS = ["result.affectedIntersections.length", "result.findings.length", "result.periodReports.length"];
/** criteriaNamed: a governing DOT that the findings never name. */
const REC_CRITERIA = { request: REC.request, result: { ...FX_RESULT, findings: ["Project will generate 1,440 new daily vehicle trips, with 130 during the PM peak hour."] } };
/** periodScopeDisclosed with period reports: saturday_midday was asked for and is neither reported nor disclosed. */
const REC_PERIODS = { request: { ...REC.request, analysisPeriods: ["am_peak", "pm_peak", "saturday_midday"] }, result: FX_RESULT };
/** periodScopeDisclosed on a record that predates periodReports: only the top-level PM block is there. */
const REC_NO_REPORTS = (() => {
  const { periodReports: _drop, ...rest } = FX_RESULT;
  return { request: { ...REC.request, analysisPeriods: ["am_peak", "pm_peak"] }, result: rest };
})();
const firing = (rec, clauseId) => PF.runClauses(rec).findings.filter((f) => f.clauseId === clauseId).map(visible);
const LENGTH_CASES = [
  ["criteriaNamed", REC_CRITERIA, "result.findings.length"],
  ["periodScopeDisclosed with period reports", REC_PERIODS, "result.periodReports.length"],
  ["periodScopeDisclosed without period reports", REC_NO_REPORTS, "result.affectedIntersections.length"],
].map(([name, rec, path]) => ({ name, rec, path, found: firing(rec, name.split(" ")[0]) }));
t("precondition: criteriaNamed and periodScopeDisclosed fire on those records and cite the three .length paths between them", () =>
  LENGTH_CASES.every((c) => c.found.length === 1 && c.found[0].readPaths.some((rp) => rp.path === c.path && typeof rp.value === "number")) &&
  sameSet(LENGTH_CASES.flatMap((c) => c.found.flatMap((f) => f.readPaths.map((rp) => rp.path))).filter((p) => p.endsWith(".length")), LENGTH_PATHS));
t("every readPath those clauses emit, .length included, resolves with readStudyPath to the value the clause recorded", () =>
  LENGTH_CASES.every((c) => c.found.length === 1 && c.found[0].readPaths.length > 1 && c.found[0].readPaths.every((rp) => X.readStudyPath(c.rec, rp.path) === JSON.stringify(rp.value))));
t("in the pack the same readPaths show the stored value, with no \"recorded\" and no \"no value\" note", () =>
  LENGTH_CASES.every((c) => {
    const f = c.found[0];
    const block = blockIn(X.buildGroundingPack({ request: c.rec.request, result: c.rec.result, findings: [f], dispositions: [], focusFindingId: f.id }).text, "## Values at the read paths");
    return Array.isArray(block) && block.length === f.readPaths.length && f.readPaths.every((rp, i) => block[i].path === rp.path && block[i].value === rp.value && !("recorded" in block[i]) && !("note" in block[i]));
  }));
t("null is a value and answers \"null\"; a record that is not an object answers (no value …) without throwing", () =>
  X.readStudyPath({ request: { a: null }, result: {} }, "request.a") === "null" &&
  X.readStudyPath({ request: null, result: undefined }, "request.a") === "(no value at request.a)" &&
  X.readStudyPath({ request: [1, 2], result: "s" }, "request[1]") === "2");
t("a 50 KB value comes back within 8192 bytes, ending in \"…(truncated)\"", () => {
  const rec = { request: { big: "x".repeat(50 * 1024) }, result: { list: Array.from({ length: 5000 }, (_, i) => ({ i, t: "row" })) } };
  return ["request.big", "result.list"].every((p) => {
    const out = X.readStudyPath(rec, p);
    return Buffer.byteLength(out, "utf8") <= C.DATUM_LIMITS.readPathBytes && out.endsWith("…(truncated)") && out.length > 1000;
  });
});
t("the cap is in bytes, not characters, and a multi-byte character is never split", () => {
  // The last two are short in characters (under 8192) and long in bytes, so only a byte count catches them.
  const rec = { request: { s: "é".repeat(20000), e: "𝄞".repeat(10000), s2: "é".repeat(5000), e2: "𝄞".repeat(3000) }, result: {} };
  return ["request.s", "request.e", "request.s2", "request.e2"].every((p) => {
    const out = X.readStudyPath(rec, p);
    return Buffer.byteLength(out, "utf8") <= C.DATUM_LIMITS.readPathBytes && out.endsWith("…(truncated)") && !out.includes("�");
  });
});
t("a value exactly at the cap is returned whole; one byte over is truncated", () => {
  const cap = C.DATUM_LIMITS.readPathBytes;
  const exact = "a".repeat(cap - 2); // two quote bytes
  const over = "a".repeat(cap - 1);
  const rec = { request: { exact, over }, result: {} };
  return X.readStudyPath(rec, "request.exact") === JSON.stringify(exact) && X.readStudyPath(rec, "request.over").endsWith("…(truncated)") && Buffer.byteLength(X.readStudyPath(rec, "request.over"), "utf8") <= cap;
});
t("readStudyPath does not change the record", () => {
  const before = JSON.stringify(REC);
  X.readStudyPath(REC, "result.periodReports[0]");
  X.readStudyPath(REC, "request");
  return JSON.stringify(REC) === before;
});

// --- Copy and the cap's source -----------------------------------------------------------------
t("neither new module, the guide, nor a pack built from it uses a phrase the product forbids", () => {
  const BANNED = /independent[\s-]*review|second[\s-]*opinion|peer[\s-]*review|qa\s*[/\\-]?\s*qc|\baudit/i;
  const texts = [guideSrc, contextSrc, JSON.stringify(GUIDE), JSON.stringify(GU.FIXABLE_MEANING), ...FULL_HEADINGS.length ? [pack().text] : []];
  return guideSrc.length > 0 && contextSrc.length > 0 && texts.every((x) => !BANNED.test(x));
});
t("the pack's cap is DATUM_LIMITS.packBytes and the path cap is DATUM_LIMITS.readPathBytes, read from the contract, not copied", () => {
  const code = stripComments(contextSrc);
  return /DATUM_LIMITS\.packBytes/.test(code) && /DATUM_LIMITS\.readPathBytes/.test(code) && !/\b61440\b|\b8192\b/.test(code);
});

// ===========================================================================
// prompt
// ===========================================================================
section("prompt");

const PROMPT_REL = "artifacts/tis-api-server/src/lib/datum-chat/prompt.ts";
const { mod: PR, error: promptError } = await importByUrl(PROMPT_REL);
ok("the prompt module loads under plain node (no loader)", promptError === null, promptError ?? undefined);
const promptSrc = read(PROMPT_REL);
pinPure("prompt.ts", promptSrc);

const SYSTEM_PROMPT = typeof PR.SYSTEM_PROMPT === "string" ? PR.SYSTEM_PROMPT : "";
const NEVER_USE = typeof PR.NEVER_USE_SENTENCE === "string" ? PR.NEVER_USE_SENTENCE : "";
/** The plan's pattern, and the pattern the other copy guards use: a hit on either is a hit. */
const BANNED_FORMS = [
  /independent\s*review|second[\s–-]*opinion|peer[\s-]*review|QA\s*\/?\s*QC|\baudit/i,
  /independent[\s-]*review|second[\s-]*opinion|peer[\s-]*review|qa\s*[/\\-]?\s*qc|\baudit/i,
];
const bannedFree = (text) => BANNED_FORMS.every((re) => !re.test(text));
const without = (text, sentence) => text.split(sentence).join("");

// --- The prompt states the rules ----------------------------------------------------------------
t("precondition: SYSTEM_PROMPT and NEVER_USE_SENTENCE are non-empty strings", () => SYSTEM_PROMPT.length > 500 && NEVER_USE.length > 20);
for (const phrase of [
  "Never choose a number",
  "only when the engineer asks",
  "at most one re-run",
  "a new version",
  "the original is never changed",
  "measured counts",
  "start a new study in the generator",
]) {
  t(`SYSTEM_PROMPT says "${phrase}"`, () => SYSTEM_PROMPT.includes(phrase));
}
t("SYSTEM_PROMPT contains NEVER_USE_SENTENCE, once", () => NEVER_USE.length > 0 && SYSTEM_PROMPT.split(NEVER_USE).length === 2);
t("precondition: the wording of the one rule says re-run is limited to one per message (the limit it states is DATUM_LIMITS.rerunsPerMessage)", () => C.DATUM_LIMITS.rerunsPerMessage === 1);

// --- The copy rule: the one sentence lists the phrases, and nothing else in the prompt does -------
t("NEVER_USE_SENTENCE names all five phrases the product forbids", () =>
  [/independent review/, /second opinion/, /peer review/, /QA\/QC/, /\baudit\b/].every((re) => re.test(NEVER_USE)));
t("NEVER_USE_SENTENCE is one sentence on one line", () => !/\n/.test(NEVER_USE) && NEVER_USE.trim() === NEVER_USE && /[.]$/.test(NEVER_USE) && (NEVER_USE.match(/[.!?](\s|$)/g) ?? []).length === 1);
t("the scan is not vacuous: the sentence itself trips both patterns, and the prompt does while the sentence is in it", () =>
  BANNED_FORMS.every((re) => re.test(NEVER_USE) && re.test(SYSTEM_PROMPT)));
t("with NEVER_USE_SENTENCE removed, the prompt contains no banned phrase", () => without(SYSTEM_PROMPT, NEVER_USE).length > 500 && bannedFree(without(SYSTEM_PROMPT, NEVER_USE)));
t("with NEVER_USE_SENTENCE removed, prompt.ts (code and comments) contains no banned phrase", () => NEVER_USE.length > 20 && promptSrc.length > 1000 && promptSrc.includes(NEVER_USE) && bannedFree(without(promptSrc, NEVER_USE)));
t("the sentence is written plainly in prompt.ts, so removing it from the source by exact match finds it", () => NEVER_USE.length > 20 && promptSrc.split(NEVER_USE).length === 2);

// --- Style: directive prose, not capitals --------------------------------------------------------
t("the prompt uses no shouting words (CRITICAL, MUST, ALWAYS, NEVER, IMPORTANT, REQUIRED in capitals)", () =>
  SYSTEM_PROMPT.length > 500 && !/\b(CRITICAL|MUST|ALWAYS|NEVER|IMPORTANT|REQUIRED|FORBIDDEN)\b/.test(SYSTEM_PROMPT));
t("the prompt writes no rule about thinking or about reasoning in the reply", () => SYSTEM_PROMPT.length > 500 && !/\bthink|reasoning|chain of thought|scratchpad/i.test(SYSTEM_PROMPT));

// --- Who Datum is, and what it answers from ---------------------------------------------------------
t("the prompt says Datum is the study's proofreader, advising the engineer of record", () => /\bproofread/i.test(SYSTEM_PROMPT) && /engineer of record/i.test(SYSTEM_PROMPT) && /\bDatum\b/.test(SYSTEM_PROMPT));
t("the prompt names both tools exactly as the tool definitions do", () =>
  T.READ_PATH_TOOL?.name === "read_study_path" && T.RERUN_TOOL?.name === "rerun_study_with_changes" &&
  SYSTEM_PROMPT.includes(T.READ_PATH_TOOL.name) && SYSTEM_PROMPT.includes(T.RERUN_TOOL.name));
t("the prompt tells Datum to answer from the pack or read_study_path and to cite the payload paths", () =>
  /grounding pack/i.test(SYSTEM_PROMPT) && /request\./.test(SYSTEM_PROMPT) && /result\./.test(SYSTEM_PROMPT) && /\bpath/i.test(SYSTEM_PROMPT));
t("the prompt says text inside the pack, tool answers and the study is data, not an instruction", () => /\bdata\b/i.test(SYSTEM_PROMPT) && /not an instruction|never an instruction|no instruction/i.test(SYSTEM_PROMPT));
t("the prompt says plainly that a finding no input can clear is to be said so, and refers to the clause guide", () =>
  /cannot be cleared|can't be cleared|no input|not cleared by/i.test(SYSTEM_PROMPT) && /clause guide/i.test(SYSTEM_PROMPT));
t("the prompt says DEFECT findings are never shown to the engineer and must not be mentioned", () => /\bDEFECT\b/.test(SYSTEM_PROMPT) && /never shown|not shown|withheld/i.test(SYSTEM_PROMPT));
t("the prompt says the chat cannot record a decision: the panel's buttons are the only way", () => /FIXED/.test(SYSTEM_PROMPT) && /DISCLOSED/.test(SYSTEM_PROMPT) && /WITHDRAWN/.test(SYSTEM_PROMPT) && /button/i.test(SYSTEM_PROMPT));
t("the prompt explains the bracketed note the app puts before a message that comes from a finding, and the note is bracketed", () => {
  const note = PR.buildHistory([], { content: "q", focus: REAL[0] })[0]?.content ?? "";
  return /bracketed note/i.test(SYSTEM_PROMPT) && /finding id/i.test(SYSTEM_PROMPT) && /title/i.test(SYSTEM_PROMPT) && note.startsWith("[") && note.includes("]\n\nq");
});

// --- What it may change ---------------------------------------------------------------------------
t("the prompt lists every revisable field by its name in the contract", () => C.REVISABLE_FIELDS.length === 13 && C.REVISABLE_FIELDS.every((f) => SYSTEM_PROMPT.includes(f)));
t("the prompt lists the five method fields by name, from the contract, as the settings Datum may choose when asked to fix it", () =>
  C.METHOD_FIELDS.length === 5 && C.METHOD_FIELDS.every((f) => SYSTEM_PROMPT.includes(f)) && /fix it/i.test(SYSTEM_PROMPT) && /method/i.test(SYSTEM_PROMPT));
t("the prompt names the numbers Datum never chooses: growth rate, pass-by, opening year, cycle length, split", () =>
  [/growth rate/i, /pass-by/i, /opening year/i, /cycle length/i, /\bsplit/i].every((re) => re.test(SYSTEM_PROMPT)));
t("the prompt says to apply the engineer's value rather than refuse it, to pass its source in sourceLabel and never to invent one", () =>
  /sourceLabel/.test(SYSTEM_PROMPT) && /source/i.test(SYSTEM_PROMPT) && /no source given/i.test(SYSTEM_PROMPT) && /invent/i.test(SYSTEM_PROMPT));
t("the prompt says the locked inputs are the site, land use, size, project name, driveways and measured counts", () =>
  [/\bsite\b/i, /land use/i, /\bsize\b/i, /project name/i, /driveways/i, /measured counts/i].every((re) => re.test(SYSTEM_PROMPT)));
t("the prompt points to the generator's UTDF or Synchro import for measured counts", () => /UTDF/.test(SYSTEM_PROMPT) && /Synchro/.test(SYSTEM_PROMPT));

// --- When to call the re-run tool, and what to say after ---------------------------------------
t("the prompt says to call the re-run tool only for the latest message, and to treat earlier requests as already answered", () =>
  /latest message/i.test(SYSTEM_PROMPT) && /earlier/i.test(SYSTEM_PROMPT) && /already/i.test(SYSTEM_PROMPT));
t("the prompt says there is no confirm step once the engineer has asked", () => /confirm/i.test(SYSTEM_PROMPT) && /without asking|no need to ask|do not ask|don't ask|at once/i.test(SYSTEM_PROMPT));
t("the prompt says a question about how to fix something is a question, not a request to change it", () => /how (do|would|can|should) /i.test(SYSTEM_PROMPT) && /question/i.test(SYSTEM_PROMPT));
t("the prompt says that after a re-run Datum states what changed and tells the engineer to open the new version to see its findings", () =>
  /what changed/i.test(SYSTEM_PROMPT) && /open Version/i.test(SYSTEM_PROMPT) && /its (own )?findings|own page/i.test(SYSTEM_PROMPT));
t("the prompt says not to claim a finding cleared, since the new version's proofread has not been seen", () => /cleared|clear/i.test(SYSTEM_PROMPT) && /not seen|have not seen|haven't seen|has not been seen|cannot see|can't see/i.test(SYSTEM_PROMPT));
t("the prompt says a refused re-run is reported with its reason and is not retried with a value Datum picks", () =>
  /refus/i.test(SYSTEM_PROMPT) && /nothing was re-run|nothing is re-run|nothing ran/i.test(SYSTEM_PROMPT) && /do not retry|don't retry|not retry/i.test(SYSTEM_PROMPT));
// run.ts counts a re-run (reruns += 1) only after RerunToolInput.safeParse passes, and before revise answers. So a
// refusal from revise (a re-run already going, the version limit, the firm's allowance, saved inputs the generator's
// checks reject) leaves the message no second re-run (LIMIT_REACHED), and the changes the engineer asked for beside
// the refused one are not made in this message. A call the schema rejects does not use the re-run, and its tool answer
// invites a corrected call.
const REFUSAL_PARAGRAPH = SYSTEM_PROMPT.split("\n").find((line) => line.startsWith("If the tool refuses")) ?? "";
t("the prompt's refusal paragraph says only a refusal from the re-run itself uses the message's one re-run, so Datum tells the engineer to send their other changes again", () =>
  REFUSAL_PARAGRAPH.includes("When the re-run itself is refused (a re-run already going, the version limit, the firm's allowance, or saved inputs that no longer pass the generator's checks), it still uses this message's one re-run, so if the engineer also asked for other changes, tell them to send those again in a new message."));
t("the prompt's refusal paragraph says to correct a call the tool rejects for its own input, and no longer claims every refusal spends the re-run", () =>
  REFUSAL_PARAGRAPH.includes("When the tool rejects the call's own input instead, correct the call if the engineer gave you what you need, and otherwise say what is wrong.") &&
  !REFUSAL_PARAGRAPH.includes("A refused re-run still uses this message's one re-run"));

// --- What dropping the growth override really does (fix round 1) -----------------------------------------
// The engine: growth = override ?? measured regional rate ?? screening default (tis.ts), and the measured
// rate exists only for the regions wired in lib/tis-engine-core/src/regional-growth-rates.ts. Three texts the
// model reads state what removeGrowthOverride does: the prompt, the growthOverrideDisclosed guide entry and the
// tool's property description. All three must say it with the same words, and the figure must be the engine's.
const ENGINE_TIS_REL = "artifacts/tis-api-server/src/lib/tis.ts";
const engineTis = read(ENGINE_TIS_REL);
const growthPrecedence = /growthOverridePct \?\? measuredRate\?\.growthPct \?\? (\d+(?:\.\d+)?)/.exec(engineTis);
const ENGINE_GROWTH_DEFAULT = growthPrecedence?.[1] ?? "";
const { mod: GR, error: growthRatesError } = await importByUrl("lib/tis-engine-core/src/regional-growth-rates.ts");
ok("precondition: the engine's measured growth rates load, so the wording can be compared with them", growthRatesError === null, growthRatesError ?? undefined);
t("precondition: tis.ts resolves growth as override, then measured regional rate, then a screening default, and the default is read from that source", () =>
  growthPrecedence !== null && Number.isFinite(Number(ENGINE_GROWTH_DEFAULT)) && Number(ENGINE_GROWTH_DEFAULT) > 0);
t("precondition: a measured rate is wired for some regions (atlanta_metro) and not for others (houston_metro, a real region), so both halves of the wording are true", () =>
  GR.getMeasuredGrowthRate?.("atlanta_metro")?.growthPct !== undefined &&
  GR.getMeasuredGrowthRate?.("houston_metro") === undefined &&
  /code:\s*"houston_metro"/.test(read("artifacts/tis-api-server/src/lib/regions.ts")));
t("precondition: the engine's override growthSource says whether a measured rate is wired, in the two sentences the prompt cites", () =>
  engineTis.includes("The measured rate for this region is") && engineTis.includes("No measured growth rate is wired for this region"));

const FALLBACK_WORDS = typeof GU.GROWTH_FALLBACK_WORDS === "string" ? GU.GROWTH_FALLBACK_WORDS : "";
const removeGrowthTool = T.RERUN_TOOL?.input_schema?.properties?.changes?.properties?.removeGrowthOverride?.description ?? "";
const growthGuideClears = GU.CLAUSE_GUIDE?.growthOverrideDisclosed?.clears ?? "";
t("GROWTH_FALLBACK_WORDS says the measured regional rate where one exists for the region and the engine's own screening default where it does not", () =>
  FALLBACK_WORDS.includes("measured regional rate") && FALLBACK_WORDS.includes("where one exists for the region") && FALLBACK_WORDS.includes("where it does not") &&
  FALLBACK_WORDS.includes("screening default") && ENGINE_GROWTH_DEFAULT !== "" && FALLBACK_WORDS.includes(`${ENGINE_GROWTH_DEFAULT}%`));
t("the figure in GROWTH_FALLBACK_WORDS is the only percentage in it, so no other number can drift from the engine", () =>
  (FALLBACK_WORDS.match(/\d+(?:\.\d+)?/g) ?? []).join(",") === ENGINE_GROWTH_DEFAULT);
t("the prompt says it, with the same words", () => FALLBACK_WORDS.length > 40 && SYSTEM_PROMPT.includes(FALLBACK_WORDS));
t("the growthOverrideDisclosed guide entry says it, with the same words", () => FALLBACK_WORDS.length > 40 && growthGuideClears.includes(FALLBACK_WORDS));
t("the removeGrowthOverride tool description says it, with the same words", () => FALLBACK_WORDS.length > 40 && removeGrowthTool.includes(FALLBACK_WORDS));
t("the first system block, which holds the prompt and the guide, carries the words twice", () => FALLBACK_WORDS.length > 40 && PR.buildSystem("P")[0].text.split(FALLBACK_WORDS).length === 3);
t("none of the three texts claims the measured rate without the qualifier once the shared words are taken out", () => {
  const unqualified = /(uses|use|falls back to|fall back to) (its|the engine's own|the engine's|the) measured( regional)? rate/i;
  return FALLBACK_WORDS.length > 40 && [SYSTEM_PROMPT, growthGuideClears, removeGrowthTool].every((x) => x.length > 100 && !unqualified.test(without(x, FALLBACK_WORDS)));
});
t("no source line in tools.ts, clause-guide.ts or prompt.ts still states the unqualified claim", () =>
  [toolsSrc, guideSrc, promptSrc].every((src) => src.length > 1000 && !/own measured rate|uses its measured regional rate|so the engine uses its measured/.test(src)));
t("the prompt sends Datum to result.growthSource for which one applies, names the engine's two sentences, and says not to assert when it says neither", () =>
  SYSTEM_PROMPT.includes("result.growthSource") && SYSTEM_PROMPT.includes("The measured rate for this region is") && SYSTEM_PROMPT.includes("No measured growth rate is wired for this region") &&
  /cannot tell|can't tell/i.test(SYSTEM_PROMPT) && /do not assert|don't assert|not assert/i.test(SYSTEM_PROMPT));

// --- How to write ---------------------------------------------------------------------------------------
t("the prompt asks for plain text and rules out markdown tables", () => /plain text/i.test(SYSTEM_PROMPT) && /\btables?\b/i.test(SYSTEM_PROMPT));

// --- buildSystem -------------------------------------------------------------------------------------------
const SYS = typeof PR.buildSystem === "function" ? PR.buildSystem("P") : [];
t("buildSystem(\"P\") returns two text blocks, the second being exactly the pack", () =>
  Array.isArray(SYS) && SYS.length === 2 && SYS.every((b) => b.type === "text" && typeof b.text === "string") && SYS[1].text === "P");
t("both blocks carry cache_control: ephemeral, and nothing else beyond type, text and cache_control", () =>
  SYS.length === 2 && SYS.every((b) => same(b.cache_control, { type: "ephemeral" }) && sameSet(Object.keys(b), ["type", "text", "cache_control"])));
t("the first block opens with the whole of SYSTEM_PROMPT", () => SYS.length === 2 && SYS[0].text.startsWith(SYSTEM_PROMPT) && SYSTEM_PROMPT.length > 500);
const guideEntries = Object.entries(GU.CLAUSE_GUIDE ?? {});
t("the first block carries all 11 clauses of the guide: id, why, what clears it, inputs and fixability", () =>
  SYS.length === 2 && guideEntries.length === 11 &&
  guideEntries.every(([id, e]) =>
    SYS[0].text.includes(id) && SYS[0].text.includes(e.why) && SYS[0].text.includes(e.clears) && e.inputs.every((f) => SYS[0].text.includes(f)) && SYS[0].text.includes(e.fixable)));
t("the first block says what rerun, partial and explain mean, in the guide's own words", () =>
  SYS.length === 2 && Object.values(GU.FIXABLE_MEANING).every((m) => SYS[0].text.includes(m)));
t("the first block lists the clauses in the guide's order", () => {
  if (SYS.length !== 2) return false;
  const at = guideEntries.map(([id]) => SYS[0].text.indexOf(`Clause: ${id}\n`));
  return at.every((n, i) => n > SYS[0].text.indexOf("Clause guide") && (i === 0 || n > at[i - 1]));
});
t("a clause with no inputs says so in the first block", () => SYS.length === 2 && /Clause: criteriaNamed\n[\s\S]*?Inputs that matter: none/.test(SYS[0].text));
t("the first block does not depend on the pack, and is byte-identical across calls (it is the cached prefix)", () => {
  const a = PR.buildSystem("one pack");
  const b = PR.buildSystem("a completely different pack, much longer ".repeat(50));
  return a[0].text === b[0].text && a[0].text === PR.buildSystem("P")[0].text && Buffer.from(a[0].text).equals(Buffer.from(b[0].text));
});
t("buildSystem returns fresh blocks each call: editing one does not change the next", () => {
  const a = PR.buildSystem("P");
  a[0].text = "edited";
  a[0].cache_control.type = "other";
  a[1].cache_control.type = "other";
  const b = PR.buildSystem("P");
  return b[0].text.startsWith(SYSTEM_PROMPT) && b[0].cache_control.type === "ephemeral" && b[1].cache_control.type === "ephemeral";
});
t("the second block is the real pack, byte for byte", () => {
  const p = pack();
  return PR.buildSystem(p.text)[1].text === p.text && p.text.length > 1000;
});
t("the guide names no withheld clause: losMatchesDelay appears in neither block", () => SYS.length === 2 && SYSTEM_PROMPT.length > 500 && !/losMatchesDelay/.test(SYS[0].text) && !/losMatchesDelay/.test(SYSTEM_PROMPT));
t("with NEVER_USE_SENTENCE removed, the first block (prompt and guide) contains no banned phrase", () => SYS.length === 2 && NEVER_USE.length > 20 && SYS[0].text.length > 8000 && bannedFree(without(SYS[0].text, NEVER_USE)));
t("the first block is large enough to be worth caching, and is reported (bytes)", () => {
  if (SYS.length !== 2) return false;
  const bytes = Buffer.byteLength(SYS[0].text, "utf8");
  console.log(`        first block: ${bytes} bytes, ${SYS[0].text.length} characters, about ${Math.round(bytes / 4)} tokens`);
  return bytes > 8000;
});

// --- buildHistory ----------------------------------------------------------------------------------------------
const turn = (i, role, over = {}) => ({
  id: randomUUID(),
  role,
  content: `${role} ${i}`,
  authorName: role === "engineer" ? "Ada Lovelace" : null,
  findingId: null,
  revisionId: null,
  createdAt: new Date(1_800_000_000_000 + i * 1000).toISOString(),
  ...over,
});
/** n messages, alternating, starting with `first`. */
const thread = (n, first = "engineer") => Array.from({ length: n }, (_, i) => turn(i, (i % 2 === 0) === (first === "engineer") ? "engineer" : "datum"));
const roles = (h) => h.map((m) => m.role);
const alternates = (h) => h.every((m, i) => i === 0 || m.role !== h[i - 1].role);
const hist = (messages, latest) => PR.buildHistory(messages, latest);

t("25 alternating messages give at most 21 entries, the first of role user", () => {
  const h = hist(thread(25), { content: "latest question" });
  return h.length <= 21 && h.length > 1 && h[0].role === "user";
});
t("25 alternating messages that start with Datum give exactly 21 entries: the last 20, then the latest", () => {
  const h = hist(thread(25, "datum"), { content: "latest question" });
  return h.length === 21 && h[0].role === "user" && h[0].content === "engineer 5" && h[19].content === "datum 24" && h[20].content === "latest question";
});
t("25 messages that start with the engineer: the last 20 start with Datum's reply, which is dropped so the history opens with the engineer", () => {
  const h = hist(thread(25), { content: "latest question" });
  return h.length === 19 && h[0].role === "user" && h[0].content === "engineer 6" && !h.some((m) => String(m.content).includes("datum 5"));
});
t("the oldest messages are left out: only the last DATUM_LIMITS.historyMessages are read", () => {
  const h = hist(thread(25), { content: "latest question" });
  const text = h.map((m) => m.content).join("\n");
  return ["engineer 0", "datum 1", "engineer 4", "datum 5"].every((c) => !text.split("\n").includes(c));
});
t("the history alternates user and assistant, ends on the user's latest turn, and every content is a non-empty string", () => {
  const h = hist(thread(25), { content: "latest question" });
  return alternates(h) && h.at(-1).role === "user" && h.at(-1).content.endsWith("latest question") && h.every((m) => ["user", "assistant"].includes(m.role) && typeof m.content === "string" && m.content.trim() !== "");
});
t("engineer maps to user and datum to assistant", () => same(roles(hist([turn(0, "engineer"), turn(1, "datum")], { content: "q" })), ["user", "assistant", "user"]));
t("consecutive messages of one role are joined with a blank line", () => {
  const h = hist([turn(0, "engineer", { content: "a" }), turn(1, "engineer", { content: "b" }), turn(2, "datum", { content: "c" }), turn(3, "datum", { content: "d" })], { content: "e" });
  return same(h, [{ role: "user", content: "a\n\nb" }, { role: "assistant", content: "c\n\nd" }, { role: "user", content: "e" }]);
});
t("a trailing engineer message and the latest are one user turn, joined with a blank line", () => {
  const h = hist([turn(0, "engineer", { content: "a" }), turn(1, "datum", { content: "b" }), turn(2, "engineer", { content: "c" })], { content: "d" });
  return same(h, [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c\n\nd" }]);
});
t("an empty thread gives the latest message alone, unchanged", () => same(hist([], { content: "why was this flagged?" }), [{ role: "user", content: "why was this flagged?" }]));
t("a thread of Datum replies only still opens with the user's turn", () => {
  const h = hist([turn(0, "datum"), turn(1, "datum")], { content: "q" });
  return same(h, [{ role: "user", content: "q" }]);
});
t("a message with no text is skipped, not sent as an empty block", () => {
  const h = hist([turn(0, "engineer", { content: "x" }), turn(1, "datum", { content: "   " }), turn(2, "engineer", { content: "y" })], { content: "z" });
  return same(h, [{ role: "user", content: "x\n\ny\n\nz" }]);
});
t("a focus finding's title, id and clause are in the last user turn, ahead of the engineer's words", () => {
  const f = REAL[0];
  const h = hist(thread(4), { content: "why was this flagged?", focus: f });
  const last = h.at(-1);
  return last.role === "user" && last.content.includes(f.title) && last.content.includes(f.id) && last.content.includes(f.clauseId) && last.content.endsWith("why was this flagged?") && last.content.indexOf(f.title) < last.content.indexOf("why was this flagged?");
});
t("a focus finding with no thread is the only turn", () => {
  const f = REAL[1];
  const h = hist([], { content: "fix it", focus: f });
  return h.length === 1 && h[0].role === "user" && h[0].content.includes(f.title) && h[0].content.endsWith("fix it");
});
t("with no focus, the latest message carries no note", () => hist(thread(2), { content: "plain question" }).at(-1).content === "plain question");
t("a title with line breaks and a long title are shown on one line and clipped", () => {
  const f = { ...REAL[0], title: `Line one\nline two\t${"x".repeat(2000)}` };
  const c = hist([], { content: "q", focus: f })[0].content;
  const noteLine = c.split("\n\n")[0];
  return !noteLine.includes("\n") && noteLine.includes("Line one line two") && c.length < 1000;
});
t("buildHistory does not change the messages or the focus finding it is given", () => {
  const messages = thread(25);
  const f = { ...REAL[0] };
  const before = JSON.stringify([messages, f]);
  hist(messages, { content: "q", focus: f });
  return JSON.stringify([messages, f]) === before;
});
t("buildHistory returns fresh entries: editing the result does not change the next call", () => {
  const messages = thread(4);
  const a = hist(messages, { content: "q" });
  a[0].content = "edited";
  return hist(messages, { content: "q" })[0].content === "engineer 0";
});
t("the window is DATUM_LIMITS.historyMessages, read from the contract, not copied", () => {
  const code = stripComments(promptSrc);
  return /DATUM_LIMITS\.historyMessages/.test(code) && !/slice\(\s*-\s*20\s*\)/.test(code);
});
t("the engineer's words and the model's earlier replies reach the history as the thread stored them, not reworded", () => {
  const e = turn(0, "engineer", { content: "Use 1.0% growth. County letter, 2026-03-02." });
  const d = turn(1, "datum", { content: "Re-ran with growth 1.0% (was 2.1%). Open Version 2 to see its findings." });
  return same(hist([e, d], { content: "thanks" }), [{ role: "user", content: e.content }, { role: "assistant", content: d.content }, { role: "user", content: "thanks" }]);
});

// ===========================================================================
// run
// ===========================================================================
section("run");

const RUN_REL = "artifacts/tis-api-server/src/lib/datum-chat/run.ts";
const { mod: RUN, error: runError } = await importByUrl(RUN_REL);
ok("the run module loads under plain node (no loader)", runError === null, runError ?? undefined);
const runSrc = read(RUN_REL);
pinPure("run.ts", runSrc);
const runCode = stripComments(runSrc);

// --- The fake model --------------------------------------------------------------------------------------
// Replays scripted turns. Each turn delivers its text deltas a setImmediate apart (so an abort can land between
// them), then resolves finalMessage() with the scripted message, or rejects with `reject`. A turn with `waitMs`
// is silent that long before its first delta, and one with `pauseMs` waits that long after its first delta (the
// router section's slow models). It records every `params`
// by reference and how many times abort() was called on each stream. Honouring abort is the default; a fake that
// ignores it and resolves anyway checks that the loop does not trust the stream to stop.
const tick = () => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MODEL = "claude-opus-5-5";
const LINE = "Datum couldn't answer that just now.";
const block = {
  text: (text) => ({ type: "text", text }),
  thinking: () => ({ type: "thinking", thinking: "", signature: "opaque-signature-1" }),
  use: (id, name, input) => ({ type: "tool_use", id, name, input }),
};
const modelMsg = (content, stop = "end_turn", usage = { input_tokens: 100, output_tokens: 20 }) => ({ content, stop_reason: stop, model: MODEL, usage });
/** One scripted turn: the deltas the stream delivers, then the message finalMessage() resolves with. */
const turnOf = (deltas, message, extra = {}) => ({ deltas, message, ...extra });

function fakeModel(turns, { ignoreAbort = false } = {}) {
  const calls = [];
  const streams = [];
  const client = {
    messages: {
      stream(params) {
        calls.push(params);
        const turn = turns[streams.length];
        const rec = { aborts: 0 };
        streams.push(rec);
        if (turn === undefined) throw new Error(`fake model: no scripted turn ${streams.length}`);
        if (turn.throwOnCreate) throw turn.throwOnCreate;
        const listeners = [];
        const stopped = () => rec.aborts > 0 && !ignoreAbort;
        const gone = () => Object.assign(new Error("Request was aborted."), { name: "APIUserAbortError" });
        const done = (async () => {
          await tick();
          if (turn.waitMs) await sleep(turn.waitMs);
          for (const [i, d] of (turn.deltas ?? []).entries()) {
            if (stopped()) throw gone();
            for (const cb of listeners) cb(d);
            await tick();
            if (i === 0 && turn.pauseMs) await sleep(turn.pauseMs);
          }
          if (stopped()) throw gone();
          if (turn.reject) throw turn.reject;
          return turn.message;
        })();
        done.catch(() => {});
        const handle = {
          on(ev, cb) {
            if (ev === "text") listeners.push(cb);
            return handle;
          },
          abort() {
            rec.aborts += 1;
          },
          finalMessage: () => done,
        };
        return handle;
      },
    },
  };
  return { client, calls, streams };
}

const REVISION_ID = randomUUID();
/** What the route's revise gives back for a re-run that worked: version 2, with the growth change spelled out. */
const okRevision = (input) => ({
  ok: true,
  projectId: REVISION_ID,
  version: 2,
  changes: Object.entries(input.changes).map(([field, to]) => ({ field, from: field === "growthRatePct" ? 2.1 : null, to })),
});
const HISTORY = [{ role: "user", content: "why was this flagged?" }];
const SYSTEM = PR.buildSystem?.("PACK") ?? [];

/**
 * Runs one turn against a fake model. `emit` is the test's hook, called after the event is recorded with the event and
 * its 1-based count (it may throw, like a closed socket). `revise` and `readPath` are recorded and may be replaced.
 */
async function drive(turns, over = {}) {
  const fm = fakeModel(turns, over.model);
  const events = [];
  const rev = [];
  const reads = [];
  const controller = over.controller ?? new AbortController();
  const deps = {
    client: fm.client,
    revise: async (input) => {
      rev.push(input);
      return over.revise ? over.revise(input, controller) : okRevision(input);
    },
    readPath: (p) => {
      reads.push(p);
      if (over.readPath) return over.readPath(p);
      return "2.1";
    },
    emit: (e) => {
      events.push(e);
      if (over.emit) over.emit(e, events.length, controller);
    },
    signal: controller.signal,
  };
  let res = null;
  let threw = null;
  try {
    res = await RUN.runDatumTurn(deps, { system: SYSTEM, messages: over.messages ?? HISTORY });
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  return { res, threw, events, calls: fm.calls, streams: fm.streams, rev, reads, controller };
}

const GROW = { changes: { growthRatePct: 1 }, reason: "county adopted 1.0%" };
const RERUN_NAME = "rerun_study_with_changes";
const READ_NAME = "read_study_path";
const rerunUse = (id, input = GROW) => block.use(id, RERUN_NAME, input);
const readUse = (id, path = "request.growthRatePct") => block.use(id, READ_NAME, { path });
/** The tool_result blocks the model was given on the last user message of a call. */
const resultsOf = (call) => (Array.isArray(call?.messages?.at(-1)?.content) ? call.messages.at(-1).content : []);
const resultFor = (call, id) => resultsOf(call).find((b) => b.tool_use_id === id);
const eventTypes = (events) => events.map((e) => e.type);
const joinedDeltas = (events) => events.filter((e) => e.type === "text").map((e) => e.delta).join("");

t("precondition: the harness runs the real prompt builder, and the re-run limit the line speaks of is one", () =>
  SYSTEM.length === 2 && SYSTEM[1].text === "PACK" && C.DATUM_LIMITS.rerunsPerMessage === 1 && C.DATUM_LIMITS.modelTurnsPerMessage === 4);
t("run.ts exports runDatumTurn and the one line it uses when it cannot answer", () => typeof RUN.runDatumTurn === "function" && RUN.DATUM_COULDNT_ANSWER === LINE);

// --- Explain only ---------------------------------------------------------------------------------------
{
  const r = await drive([turnOf(["Because ", "the growth rate ", "was 2.1%."], modelMsg([block.thinking(), block.text("Because the growth rate was 2.1%.")]))]);
  const p = r.calls[0] ?? {};
  t("explain only: the loop does not reject", () => r.threw === null && r.res !== null);
  t("explain only: the result is the reply, no revision, and the turn's stop reason, model and tokens", () =>
    r.res.text === "Because the growth rate was 2.1%." && r.res.revision === null && r.res.stopReason === "end_turn" && r.res.model === MODEL &&
    r.res.inputTokens === 100 && r.res.outputTokens === 20 && r.res.cutOff === false);
  t("explain only: emit saw the text deltas as they came, then nothing else", () =>
    same(r.events, [{ type: "text", delta: "Because " }, { type: "text", delta: "the growth rate " }, { type: "text", delta: "was 2.1%." }]));
  t("explain only: exactly one model call", () => r.calls.length === 1);
  t("the call's model is claude-opus-5-5 and max_tokens is 16000", () => p.model === "claude-opus-5-5" && p.max_tokens === 16000);
  t("the call asks for adaptive thinking at medium effort", () => same(p.thinking, { type: "adaptive" }) && same(p.output_config, { effort: "medium" }));
  t("the call's tool_choice is auto with parallel tool use disabled", () => same(p.tool_choice, { type: "auto", disable_parallel_tool_use: true }));
  t("the call carries no budget_tokens, no fallbacks and no beta list", () =>
    typeof p.model === "string" && !("budget_tokens" in p) && !("budget_tokens" in (p.thinking ?? {})) && !("fallbacks" in p) && !("betas" in p) && !("fallbacks" in (p.output_config ?? {})));
  t("the call's tools are read_study_path then rerun_study_with_changes, the very objects tools.ts exports", () =>
    same((p.tools ?? []).map((x) => x.name), ["read_study_path", "rerun_study_with_changes"]) && p.tools[0] === T.READ_PATH_TOOL && p.tools[1] === T.RERUN_TOOL);
  t("the call passes the system blocks and the history it was given", () => p.system === SYSTEM && same(p.messages, HISTORY));
}

// --- A re-run ---------------------------------------------------------------------------------------------
{
  const think = block.thinking();
  const turn1 = modelMsg([think, rerunUse("toolu_1")], "tool_use", { input_tokens: 300, output_tokens: 50 });
  const turn2 = modelMsg([block.text("I re-ran it at 1.0%. Open Version 2 to see its findings.")], "end_turn", { input_tokens: 400, output_tokens: 80 });
  const r = await drive([turnOf([], turn1), turnOf(["I re-ran it at 1.0%. ", "Open Version 2 to see its findings."], turn2)]);
  const [c1, c2] = r.calls;
  const types = eventTypes(r.events);
  const statusAt = types.indexOf("status");
  const revisionAt = types.indexOf("revision");
  t("re-run: the loop does not reject, and makes two model calls", () => r.threw === null && r.calls.length === 2);
  t("re-run: revise is called once, with the tool's input", () => r.rev.length === 1 && same(r.rev[0], GROW));
  t("re-run: the result carries the revision (version 2, the project, the change) and the closing text", () =>
    r.res.revision?.version === 2 && r.res.revision.projectId === REVISION_ID && same(r.res.revision.changes, [{ field: "growthRatePct", from: 2.1, to: 1 }]) &&
    r.res.text === "I re-ran it at 1.0%. Open Version 2 to see its findings." && r.res.cutOff === false);
  t("re-run: the stop reason and model are the last turn's, and tokens are summed across both turns", () =>
    r.res.stopReason === "end_turn" && r.res.model === MODEL && r.res.inputTokens === 700 && r.res.outputTokens === 130);
  t("re-run: emit saw a status naming the re-run, then the revision, then the closing text", () =>
    statusAt >= 0 && revisionAt > statusAt && /Re-running/.test(r.events[statusAt].message) && types.slice(revisionAt + 1).every((x) => x === "text") && types.length > revisionAt + 1);
  t("re-run: the status line says the change in plain words, as the spec shows it (without the old value, which the loop does not know)", () =>
    r.events[statusAt]?.message === "Re-running with growth 1.0%…");
  t("re-run: the revision event carries the project, version and changes, and parses as a DatumStreamEvent", () =>
    r.events[revisionAt]?.projectId === REVISION_ID && r.events[revisionAt].version === 2 && same(r.events[revisionAt].changes, r.res.revision.changes) && accepts(C.DatumStreamEvent, r.events[revisionAt]));
  t("re-run: the second call's last message is a user message holding the tool_result for that tool_use_id, not flagged as an error", () => {
    const last = c2.messages.at(-1);
    const tr = resultFor(c2, "toolu_1");
    return last.role === "user" && resultsOf(c2).length === 1 && tr?.type === "tool_result" && tr.is_error === undefined && typeof tr.content === "string";
  });
  t("re-run: the tool_result tells the model the new version number and the changes as field, from, to", () => {
    const body = JSON.parse(resultFor(c2, "toolu_1")?.content ?? "null");
    return body?.version === 2 && same(body.changes, [{ field: "growthRatePct", from: 2.1, to: 1 }]);
  });
  t("re-run: the assistant message before the tool_result is turn 1's content, unchanged, thinking block included", () => {
    const before = c2.messages.at(-2);
    return before.role === "assistant" && before.content === turn1.content && isDeepStrictEqual(before.content, [think, rerunUse("toolu_1")]) && before.content[0].type === "thinking";
  });
  t("re-run: the history before those two messages is the same history", () => same(c2.messages.slice(0, HISTORY.length), HISTORY) && c2.messages.length === HISTORY.length + 2);
  t("re-run: each call gets its own messages array: turn 1's call still holds only the history", () => c1.messages !== c2.messages && c1.messages.length === HISTORY.length);
  t("re-run: the tools array and the system blocks are the same objects on every call (the cached prefix)", () => c1.tools === c2.tools && c1.system === c2.system);
  t("re-run: every event parses as a DatumStreamEvent, and the loop emits no done (the route does)", () =>
    r.events.length > 3 && r.events.every((e) => accepts(C.DatumStreamEvent, e)) && !types.includes("done"));
}

// --- The status line is copy the engineer reads: plain labels, never field names -----------------------------------------
{
  const NAME = OVERRIDE.intersectionName;
  const LABELS = [
    ["growthRatePct", 1, "growth 1.0%"],
    ["growthRatePct", 1.25, "growth 1.25%"],
    ["removeGrowthOverride", true, "growth override removed"],
    ["openingYear", 2028, "opening year 2028"],
    ["analysisPeriods", ["am_peak", "pm_peak"], "periods AM peak, PM peak"],
    ["analysisPeriods", ["saturday_midday", "daily"], "periods Saturday midday, daily"],
    ["passByPct", 25, "pass-by 25%"],
    ["internalCapturePct", 10, "internal capture 10%"],
    ["weather", "light_rain", "weather light rain"],
    ["scopeStudyIntersections", true, "study scope: impacted intersections only"],
    ["scopeStudyIntersections", false, "study scope: every signalized intersection"],
    ["signalTiming", "computed", "computed signal timing"],
    ["signalTiming", "screening", "screening signal timing"],
    ["legVolumes", "network", "network leg volumes"],
    ["legVolumes", "screening", "screening leg volumes"],
    ["realLaneGeometry", true, "real lane geometry on"],
    ["realLaneGeometry", false, "real lane geometry off"],
    ["conservedAssignment", true, "conserved path assignment on"],
    ["conservedAssignment", false, "conserved path assignment off"],
    ["signalTimingOverrides", [OVERRIDE], `timing sheet for ${NAME}`],
  ];
  /** The status line a re-run with these changes shows, or null if none was emitted. */
  const statusOf = async (changes) => {
    const r = await drive([turnOf([], modelMsg([rerunUse("toolu_1", rerun(changes))], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))]);
    return { message: r.events.find((e) => e.type === "status")?.message ?? null, revised: r.rev.length === 1 };
  };
  // "weather" is a field name and an English word; the test is for the camelCase names, and for any camelCase word.
  const rawName = (text) => C.REVISABLE_FIELDS.filter((f) => /[A-Z]/.test(f)).some((f) => text.includes(f)) || /[a-z][A-Z]/.test(text);

  t("precondition: the label table covers every revisable field", () => sameSet([...new Set(LABELS.map(([f]) => f))], C.REVISABLE_FIELDS));
  t("precondition: the raw-name test is not vacuous: it flags a status line written with a field name", () =>
    rawName("Re-running with growthRatePct = 1…") && rawName("Re-running with passByPct") && !rawName("Re-running with growth 1.0%…"));
  for (const [field, value, label] of LABELS) {
    const got = await statusOf({ [field]: value });
    t(`status for ${field} = ${JSON.stringify(value).slice(0, 60)}: "Re-running with ${label}…"`, () => got.revised && got.message === `Re-running with ${label}…`);
    t(`status for ${field} = ${JSON.stringify(value).slice(0, 60)}: matches /Re-running/ and holds no raw field name or camelCase word`, () => /Re-running/.test(got.message ?? "") && !rawName(got.message ?? ""));
  }
  {
    // Every field at once: allowlist order, one label per field, "; " between them.
    const all = {};
    // Keys given in reverse, so the order the engineer reads is the allowlist's and not the model's.
    for (const f of [...C.REVISABLE_FIELDS].reverse()) all[f] = LABELS.find(([name]) => name === f)[1];
    const got = await statusOf(all);
    const expected = `Re-running with ${C.REVISABLE_FIELDS.map((f) => LABELS.find(([name]) => name === f)[2]).join("; ")}…`;
    t("all 13 fields at once: the labels come in the allowlist's order, joined by semicolons", () => got.revised && got.message === expected);
    t("all 13 fields at once: no status line contains a raw field name or a camelCase word", () => got.message !== null && got.message.length > 100 && !rawName(got.message));
  }
  {
    const got = await statusOf({});
    t("an empty change set: \"Re-running the study on the current engine with the same inputs…\"", () => got.message === "Re-running the study on the current engine with the same inputs…");
  }
  {
    const sheets = (names) => names.map((n) => ({ ...OVERRIDE, intersectionName: n }));
    const two = await statusOf({ signalTimingOverrides: sheets(["Main St & 1st Ave", "Oak St & 2nd Ave"]) });
    const five = await statusOf({ signalTimingOverrides: sheets(["A St & 1st", "B St & 1st", "C St & 1st", "D St & 1st", "E St & 1st"]) });
    const long = await statusOf({ signalTimingOverrides: sheets([`  ${"Very Long Street ".repeat(10)}  `]) });
    t("timing sheets: two are named with 'and'", () => two.message === "Re-running with timing sheets for Main St & 1st Ave and Oak St & 2nd Ave…");
    t("timing sheets: five name the first three and count the rest", () => five.message === "Re-running with timing sheets for A St & 1st, B St & 1st, C St & 1st and 2 more…");
    t("timing sheets: a very long intersection name is clipped to one line", () => long.message !== null && long.message.length < 120 && long.message.includes("Very Long Street") && long.message.endsWith("…") && !/\s{2,}/.test(long.message));
  }
  {
    const got = await statusOf({ growthRatePct: 1, passByPct: 25 });
    t("the status never says an old value: no \"(was\" and no \"from\"", () => got.message !== null && !/\bwas\b|\bfrom\b/i.test(got.message));
  }
  t("run.ts keys its status labels by every revisable field, so a field without a label does not compile", () =>
    /CHANGE_LABELS:\s*Record<RevisableField,/.test(runCode) && !/\$\{field\}\s*=/.test(runCode));
}

// --- Text across turns, and an empty reply ---------------------------------------------------------------------
{
  const r = await drive([
    turnOf(["Checking the stored value."], modelMsg([block.text("Checking the stored value."), readUse("toolu_1")], "tool_use")),
    turnOf(["It is 2.1%."], modelMsg([block.text("It is 2.1%.")])),
  ]);
  t("text from two turns is joined with a blank line, and the events carry exactly the result text", () =>
    r.res.text === "Checking the stored value.\n\nIt is 2.1%." && joinedDeltas(r.events) === r.res.text);
}
{
  const r = await drive([turnOf([], modelMsg([block.thinking()], "end_turn"))]);
  t("a turn that ends with no text at all gives the engineer the line instead of an empty reply", () => r.res.text === LINE && joinedDeltas(r.events) === LINE && r.res.stopReason === "end_turn" && !eventTypes(r.events).includes("error"));
}

// --- A second re-run -------------------------------------------------------------------------------------------
{
  const other = { changes: { passByPct: 10 }, reason: "second ask" };
  const r = await drive([
    turnOf([], modelMsg([rerunUse("toolu_1")], "tool_use")),
    turnOf([], modelMsg([rerunUse("toolu_2", other)], "tool_use")),
    turnOf(["Done."], modelMsg([block.text("Done.")])),
  ]);
  const tr = resultFor(r.calls[2], "toolu_2");
  t("a second re-run in one message: revise is called once, with the first input", () => r.rev.length === 1 && same(r.rev[0], GROW));
  t("a second re-run gets an is_error tool_result saying one re-run per message", () => tr?.type === "tool_result" && tr.is_error === true && /one re-run per message/.test(tr.content));
  t("a second re-run: the first one's revision stands, and the model is called again to finish", () => r.res.revision?.version === 2 && r.calls.length === 3 && r.res.text === "Done.");
  t("a second re-run: no second status or revision event", () => eventTypes(r.events).filter((x) => x === "status").length === 1 && eventTypes(r.events).filter((x) => x === "revision").length === 1);
}
{
  const other = { changes: { passByPct: 10 }, reason: "second ask" };
  const r = await drive([
    turnOf([], modelMsg([rerunUse("toolu_a"), rerunUse("toolu_b", other)], "tool_use")),
    turnOf(["Done."], modelMsg([block.text("Done.")])),
  ]);
  const results = resultsOf(r.calls[1]);
  t("two re-runs in one turn: one tool_result per tool_use in order, the first ran and the second is refused", () =>
    results.length === 2 && results[0].tool_use_id === "toolu_a" && results[0].is_error === undefined && results[1].tool_use_id === "toolu_b" && results[1].is_error === true && /one re-run per message/.test(results[1].content));
  t("two re-runs in one turn: revise is called once", () => r.rev.length === 1 && same(r.rev[0], GROW));
}

// --- Invalid tool input ---------------------------------------------------------------------------------------------
{
  const r = await drive([
    turnOf([], modelMsg([rerunUse("toolu_1", { changes: { latitude: 1 } })], "tool_use")),
    turnOf(["I can't change the site's location here."], modelMsg([block.text("I can't change the site's location here.")])),
  ]);
  const tr = resultFor(r.calls[1], "toolu_1");
  t("an invalid re-run input ({changes:{latitude:1}}) gets an is_error tool_result and revise is not called", () => tr?.is_error === true && typeof tr.content === "string" && tr.content.length > 0 && r.rev.length === 0);
  t("an invalid re-run input: no status, no revision, and the model is called again to answer", () => r.res.revision === null && !eventTypes(r.events).includes("status") && !eventTypes(r.events).includes("revision") && r.calls.length === 2);
  t("an invalid re-run input: the tool_result says nothing was re-run and names what was wrong", () => /nothing was re-run/i.test(tr?.content ?? "") && /latitude/.test(tr?.content ?? ""));
}
{
  // R11: the merge relies on this parse for the timing-sheet constraints, so the loop must run it before revise.
  const badSheet = rerun({ signalTimingOverrides: [{ ...OVERRIDE, phases: [{ movement: "XX", phase: 2 }] }] });
  const r = await drive([turnOf([], modelMsg([rerunUse("toolu_1", badSheet)], "tool_use")), turnOf(["Sorry."], modelMsg([block.text("Sorry.")]))]);
  t("R11: a timing sheet with an unknown movement name (XX) is refused by the parse, and revise is not called", () =>
    r.rev.length === 0 && resultFor(r.calls[1], "toolu_1")?.is_error === true && r.res.revision === null);
  }
{
  const goodSheet = rerun({ signalTimingOverrides: [OVERRIDE] });
  const r = await drive([turnOf([], modelMsg([rerunUse("toolu_1", goodSheet)], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))]);
  t("precondition for R11: a timing sheet with real movement names passes the parse and reaches revise", () => r.rev.length === 1 && r.res.revision?.version === 2);
}
{
  const r = await drive([
    turnOf([], modelMsg([rerunUse("toolu_1", { reason: "no changes object" })], "tool_use")),
    turnOf([], modelMsg([rerunUse("toolu_2")], "tool_use")),
    turnOf(["Done."], modelMsg([block.text("Done.")])),
  ]);
  t("a re-run input that fails the parse does not use up the one re-run: a corrected call goes through", () => r.rev.length === 1 && r.res.revision?.version === 2 && resultFor(r.calls[1], "toolu_1")?.is_error === true && resultFor(r.calls[2], "toolu_2")?.is_error === undefined);
}
{
  const r = await drive([turnOf([], modelMsg([block.use("toolu_1", RERUN_NAME, undefined)], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))]);
  t("a re-run tool_use with no input at all is refused, not run", () => r.rev.length === 0 && resultFor(r.calls[1], "toolu_1")?.is_error === true);
}
{
  const r = await drive(
    [turnOf([], modelMsg([rerunUse("toolu_1")], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))],
    { revise: () => ({ ok: false, error: "growthRatePct 9 is not allowed: it must be at most 6. Nothing was re-run." }) },
  );
  const tr = resultFor(r.calls[1], "toolu_1");
  t("a refused re-run gives the model the refusal's error text as an is_error tool_result", () => tr?.is_error === true && tr.content === "growthRatePct 9 is not allowed: it must be at most 6. Nothing was re-run.");
  t("a refused re-run: the result has no revision and emit saw a status but no revision", () => r.res.revision === null && eventTypes(r.events).includes("status") && !eventTypes(r.events).includes("revision"));
  }
{
  const r = await drive(
    [turnOf([], modelMsg([rerunUse("toolu_1")], "tool_use")), turnOf([], modelMsg([rerunUse("toolu_2")], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))],
    { revise: () => ({ ok: false, error: "refused" }) },
  );
  t("the one re-run is spent by a call that reached revise, even if revise refused: the next call is refused with the limit", () =>
    r.rev.length === 1 && resultFor(r.calls[2], "toolu_2")?.is_error === true && /one re-run per message/.test(resultFor(r.calls[2], "toolu_2").content));
}
{
  const r = await drive(
    [turnOf([], modelMsg([rerunUse("toolu_1")], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))],
    { revise: () => { throw new Error("connection to db-internal-7 lost"); } },
  );
  const tr = resultFor(r.calls[1], "toolu_1");
  t("a revise that throws does not reject the loop: the model gets an is_error tool_result that does not leak the exception", () =>
    r.threw === null && tr?.is_error === true && !/db-internal/.test(tr.content) && r.res.revision === null && r.res.text === "Done.");
}

// --- read_study_path ---------------------------------------------------------------------------------------------
{
  const r = await drive(
    [turnOf([], modelMsg([readUse("toolu_1", "request.growthRatePct")], "tool_use")), turnOf(["It is 2.1%."], modelMsg([block.text("It is 2.1%.")]))],
    { readPath: () => "2.1" },
  );
  const tr = resultFor(r.calls[1], "toolu_1");
  t("read_study_path: readPath is called with the path and its answer comes back as the tool_result", () => same(r.reads, ["request.growthRatePct"]) && tr?.type === "tool_result" && tr.content === "2.1" && tr.is_error === undefined);
  t("read_study_path: no re-run, no status event, and the reply is the closing text", () => r.rev.length === 0 && r.res.revision === null && !eventTypes(r.events).includes("status") && r.res.text === "It is 2.1%.");
}
for (const [label, input] of [["a number", { path: 5 }], ["no path", {}], ["an extra key", { path: "request.x", extra: 1 }], ["no input", undefined], ["a string", "request.x"]]) {
  const r = await drive([turnOf([], modelMsg([block.use("toolu_1", READ_NAME, input)], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))]);
  t(`read_study_path with ${label} as its input: is_error, and readPath is not called`, () => r.reads.length === 0 && resultFor(r.calls[1], "toolu_1")?.is_error === true);
}
{
  const r = await drive(
    [turnOf([], modelMsg([readUse("toolu_1")], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))],
    { readPath: () => { throw new Error("secret internal failure"); } },
  );
  const tr = resultFor(r.calls[1], "toolu_1");
  t("a readPath that throws does not reject the loop: is_error tool_result, no leak, the model answers", () => r.threw === null && tr?.is_error === true && !/secret internal/.test(tr.content) && r.res.text === "Done.");
}
{
  const r = await drive([turnOf([], modelMsg([block.use("toolu_1", "delete_the_study", { id: 1 })], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))]);
  t("a tool the loop does not offer gets an is_error tool_result and runs nothing", () => resultFor(r.calls[1], "toolu_1")?.is_error === true && r.rev.length === 0 && r.reads.length === 0);
}
{
  const input = [{ role: "user", content: "q" }];
  const before = JSON.stringify(input);
  const r = await drive([turnOf([], modelMsg([readUse("toolu_1")], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))], { messages: input });
  t("the loop does not change the history array it is given", () => r.threw === null && JSON.stringify(input) === before && input.length === 1);
}

// --- Refusal and max_tokens: no tool is ever run ------------------------------------------------------------------
{
  const r = await drive([turnOf([], modelMsg([block.thinking(), rerunUse("toolu_1")], "refusal"))]);
  t("a refusal gives the text \"Datum couldn't answer that just now.\"", () => r.res.text === LINE && r.res.stopReason === "refusal" && r.res.cutOff === false);
  t("a refusal runs no tool, even when its content has a tool_use, and makes no second call", () => r.rev.length === 0 && r.reads.length === 0 && r.calls.length === 1 && r.res.revision === null);
  t("a refusal shows the line as a text event and emits no error event", () => same(r.events, [{ type: "text", delta: LINE }]));
}
{
  const r = await drive([turnOf(["Partial answer"], modelMsg([block.text("Partial answer")], "refusal"))]);
  t("a refusal after some text keeps the text and ends with the line on its own paragraph", () => r.res.text === `Partial answer\n\n${LINE}` && joinedDeltas(r.events) === r.res.text);
}
{
  const r = await drive([turnOf(["Let me ch"], modelMsg([block.text("Let me ch"), rerunUse("toolu_1")], "max_tokens"))]);
  t("max_tokens with a tool_use runs no tool and the text ends with the same line", () =>
    r.rev.length === 0 && r.reads.length === 0 && r.calls.length === 1 && r.res.text.endsWith(LINE) && r.res.text === `Let me ch\n\n${LINE}` && r.res.stopReason === "max_tokens");
  t("max_tokens with a tool_use: the status event for a re-run is never sent", () => r.events.length > 0 && !eventTypes(r.events).includes("status") && !eventTypes(r.events).includes("revision"));
}
{
  const r = await drive([turnOf([], modelMsg([readUse("toolu_1")], "max_tokens"))]);
  t("max_tokens with a read_study_path tool_use runs no read either", () => r.reads.length === 0 && r.res.text === LINE && r.calls.length === 1);
}
{
  const r = await drive([turnOf(["A long answer that was cut"], modelMsg([block.text("A long answer that was cut")], "max_tokens"))]);
  t("max_tokens with no tool_use keeps the cut text and ends with the line", () => r.res.text === `A long answer that was cut\n\n${LINE}` && r.res.stopReason === "max_tokens");
}
{
  const r = await drive([turnOf(["Paused."], modelMsg([block.text("Paused.")], "pause_turn"))]);
  t("any other terminal stop (pause_turn) ends the loop with the text as it is, no second call", () => r.calls.length === 1 && r.res.text === "Paused." && r.res.stopReason === "pause_turn");
}

// --- The cap -------------------------------------------------------------------------------------------------------
{
  const r = await drive(Array.from({ length: 5 }, (_, i) => turnOf([], modelMsg([readUse(`toolu_${i + 1}`)], "tool_use"))));
  t("the cap: five scripted tool_use turns give exactly 4 stream calls", () => r.threw === null && r.calls.length === C.DATUM_LIMITS.modelTurnsPerMessage && r.calls.length === 4);
  t("the cap: then a final line, and the fourth turn's tool is not run", () => r.res.text === LINE && r.reads.length === 3 && r.res.stopReason === "turn_cap" && r.res.cutOff === false);
  t("the cap: the fourth call carries the three earlier round trips", () => r.calls[3].messages.length === HISTORY.length + 6);
}
{
  const r = await drive([
    turnOf([], modelMsg([readUse("toolu_1")], "tool_use")),
    turnOf([], modelMsg([readUse("toolu_2")], "tool_use")),
    turnOf([], modelMsg([readUse("toolu_3")], "tool_use")),
    turnOf([], modelMsg([rerunUse("toolu_4")], "tool_use")),
  ]);
  t("the cap: a re-run asked for on the last allowed turn is not run, since the model could not report it", () => r.rev.length === 0 && r.res.revision === null && r.res.text === LINE && r.calls.length === 4);
}
{
  const r = await drive([
    turnOf([], modelMsg([readUse("toolu_1")], "tool_use")),
    turnOf([], modelMsg([readUse("toolu_2")], "tool_use")),
    turnOf([], modelMsg([rerunUse("toolu_3")], "tool_use")),
    turnOf(["Done."], modelMsg([block.text("Done.")])),
  ]);
  t("four turns can hold two reads, a re-run and the closing reply", () => r.calls.length === 4 && r.res.revision?.version === 2 && r.res.text === "Done." && r.reads.length === 2);
}

// --- Review Focus 2: the engineer closes the tab mid-reply ---------------------------------------------------------------
const longReply = () => [turnOf(["Because ", "the ", "growth ", "rate."], modelMsg([block.text("Because the growth rate.")]))];
{
  const r = await drive(longReply(), { emit: (e, n) => { if (n === 2) throw new Error("write after end"); } });
  t("emit throws after the first text: the loop does not reject, aborts the stream once, and returns cutOff", () => r.threw === null && r.res.cutOff === true && r.streams.length === 1 && r.streams[0].aborts === 1);
  t("emit throws: the text so far comes back (up to the delta that could not be sent), nothing more", () => r.res.text === "Because the " && r.res.stopReason === "aborted");
  t("emit throws: emit is not called again after it throws, and no error event or line is added for a client that is gone", () => r.events.length === 2 && eventTypes(r.events).every((x) => x === "text") && r.res.text.indexOf(LINE) === -1);
}
{
  const r = await drive(longReply(), { emit: (e, n, ac) => { if (n === 2) { ac.abort(); throw new Error("write after end"); } } });
  t("emit throws and the signal aborts (the disconnect itself): abort() is called on the stream, cutOff is true, no rejection", () =>
    r.threw === null && r.res.cutOff === true && r.streams[0].aborts >= 1 && r.calls.length === 1 && r.res.text === "Because the ");
  t("emit throws and the signal aborts: the stream is aborted once, not once for each cause", () => r.streams[0].aborts === 1);
}
{
  const r = await drive(longReply(), { emit: (e, n, ac) => { if (n === 1) ac.abort(); } });
  t("the signal aborts mid-stream with emit still working: the stream is aborted, cutOff is true, and deltas after the abort are not taken", () =>
    r.threw === null && r.res.cutOff === true && r.streams[0].aborts === 1 && r.res.text === "Because " && r.events.length === 1);
}
{
  const turns = [turnOf(["Let me re-run that. ", "One moment."], modelMsg([block.text("Let me re-run that. One moment."), rerunUse("toolu_1")], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))];
  const r = await drive(turns, { model: { ignoreAbort: true }, emit: (e, n) => { if (n === 1) throw new Error("socket closed"); } });
  t("a stream that ignores abort() and resolves anyway: its tool_use is still not run, and no second call is made", () =>
    r.threw === null && r.res.cutOff === true && r.rev.length === 0 && r.calls.length === 1 && r.res.revision === null);
}
{
  const r = await drive(longReply(), { model: { ignoreAbort: true }, emit: (e, n) => { if (n === 2) throw new Error("write after end"); } });
  t("a stream that ignores abort() keeps delivering deltas: the ones after the engineer left are not taken into the text", () =>
    r.threw === null && r.res.cutOff === true && r.res.text === "Because the " && r.events.length === 2);
}
{
  const turns = [turnOf(["Looking that up."], modelMsg([block.text("Looking that up."), readUse("toolu_1")], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))];
  const r = await drive(turns, { model: { ignoreAbort: true }, emit: (e, n) => { if (n === 1) throw new Error("socket closed"); } });
  t("a stream that ignores abort() and resolves with a read_study_path tool_use: the read is not run either", () =>
    r.threw === null && r.res.cutOff === true && r.reads.length === 0 && r.calls.length === 1);
}
{
  const controller = new AbortController();
  controller.abort();
  const r = await drive(longReply(), { controller });
  t("a signal already aborted when the loop starts: no model call, empty text, cutOff, no rejection", () => r.threw === null && r.calls.length === 0 && r.res.cutOff === true && r.res.text === "" && r.events.length === 0);
}
{
  const r = await drive(longReply(), { emit: () => { throw new Error("broken pipe"); } });
  t("emit that throws on every call: the loop returns cutOff and does not reject", () => r.threw === null && r.res.cutOff === true && r.events.length === 1);
}
{
  // The abort lands while revise is pending: the re-run still finishes, and the result carries it.
  const r = await drive(
    [turnOf([], modelMsg([rerunUse("toolu_1")], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))],
    {
      revise: async (input, ac) => {
        ac.abort();
        await tick();
        await tick();
        return okRevision(input);
      },
    },
  );
  t("the abort lands while revise is pending: revise still resolves and the result carries the revision", () =>
    r.threw === null && r.rev.length === 1 && r.res.revision?.version === 2 && r.res.revision.projectId === REVISION_ID && r.res.cutOff === true);
  t("the abort lands while revise is pending: no further model call is made", () => r.calls.length === 1);
}
{
  // A reply that holds a re-run and then a read: the engineer leaves while the re-run runs, so the read is not started.
  const r = await drive(
    [turnOf([], modelMsg([rerunUse("toolu_1"), readUse("toolu_2")], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))],
    { revise: async (input, ac) => { ac.abort(); await tick(); return okRevision(input); } },
  );
  t("the abort lands while revise is pending and the same reply holds a read: the re-run finishes, the read is not started", () =>
    r.threw === null && r.res.revision?.version === 2 && r.reads.length === 0 && r.calls.length === 1 && r.res.cutOff === true);
}
{
  const r = await drive(
    [turnOf([], modelMsg([rerunUse("toolu_1")], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))],
    { emit: (e) => { if (e.type === "revision") throw new Error("socket closed"); } },
  );
  t("emit throws on the revision event: the re-run is already saved, so the result still carries it, cutOff, no second call", () =>
    r.threw === null && r.res.revision?.version === 2 && r.res.cutOff === true && r.calls.length === 1);
}
{
  const r = await drive(
    [turnOf([], modelMsg([rerunUse("toolu_1")], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))],
    { emit: (e) => { if (e.type === "status") throw new Error("socket closed"); } },
  );
  t("emit throws on the status event: the engineer is gone before the re-run starts, so it is not started", () =>
    r.threw === null && r.rev.length === 0 && r.res.revision === null && r.res.cutOff === true && r.calls.length === 1);
}
{
  const r = await drive(
    [turnOf([], modelMsg([rerunUse("toolu_1")], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))],
    { emit: (e, n, ac) => { if (e.type === "status") ac.abort(); } },
  );
  t("the signal aborts at the status event, before revise is called: the re-run is not started", () => r.threw === null && r.rev.length === 0 && r.res.cutOff === true && r.calls.length === 1);
}

// --- An SDK error --------------------------------------------------------------------------------------------------------
{
  const err = Object.assign(new Error("overloaded_error req_abc123 for org acme"), { status: 529 });
  const r = await drive([turnOf([], null, { reject: err })]);
  t("an SDK error (finalMessage rejects with status 529): the loop does not reject, and the text is the line", () => r.threw === null && r.res.text === LINE && r.res.cutOff === false && r.res.stopReason === "error");
  t("an SDK error: emit saw the line as text, then an error event, and the loop reports no revision, model or tokens", () =>
    same(r.events, [{ type: "text", delta: LINE }, { type: "error", message: LINE }]) && r.res.revision === null && r.res.model === null && r.res.inputTokens === 0 && r.res.outputTokens === 0);
  t("an SDK error: nothing from the SDK's error (message, request id) reaches the engineer", () => !JSON.stringify(r.events).includes("req_abc123") && !r.res.text.includes("acme"));
  t("an SDK error: the error event parses as a DatumStreamEvent", () => r.events.length === 2 && r.events.every((e) => accepts(C.DatumStreamEvent, e)));
}
{
  const r = await drive([turnOf(["The growth rate "], null, { reject: Object.assign(new Error("x"), { status: 529 }) })]);
  t("an SDK error after some text keeps the text and puts the line on its own paragraph", () => r.res.text === `The growth rate \n\n${LINE}` && joinedDeltas(r.events) === r.res.text && eventTypes(r.events).at(-1) === "error");
}
{
  // The cause goes to the route (result.error) and never into an event or the text.
  const err = Object.assign(new Error("overloaded_error req_abc123 for org acme"), { status: 529 });
  const r = await drive([turnOf([], null, { reject: err })]);
  t("a model failure: result.error holds the very value that was thrown, so the route can log its status and message", () => r.res.error === err && r.res.error.status === 529);
  t("a model failure: no event and not the text contain the cause's message", () => r.events.length === 2 && !JSON.stringify(r.events).includes("req_abc123") && !JSON.stringify(r.events).includes("overloaded") && !r.res.text.includes("req_abc123"));
}
{
  // A bug in the loop's own code: revise answers something that is not a result (null), so reading `.ok` throws a TypeError.
  const r = await drive(
    [turnOf([], modelMsg([rerunUse("toolu_1")], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))],
    { revise: () => null },
  );
  t("a failure inside the loop: it does not reject, the text is the line, an error event is emitted, and the stop reason is error", () =>
    r.threw === null && r.res.text === LINE && r.res.stopReason === "error" && eventTypes(r.events).at(-1) === "error" && r.res.revision === null);
  t("a failure inside the loop: result.error holds the TypeError that was thrown", () => r.res.error instanceof TypeError && /null/.test(r.res.error.message));
  t("a failure inside the loop: no event and not the text contain the exception's message", () =>
    !JSON.stringify(r.events).includes(r.res.error?.message ?? "\u0000") && !r.res.text.includes(r.res.error?.message ?? "\u0000") && r.events.every((e) => accepts(C.DatumStreamEvent, e)));
}
{
  // The engineer leaves, and then the loop's own code throws: the cause is still reported, but nothing is sent to a client that is gone.
  const r = await drive(
    [turnOf([], modelMsg([rerunUse("toolu_1")], "tool_use")), turnOf(["Done."], modelMsg([block.text("Done.")]))],
    { revise: async (input, ac) => { ac.abort(); await tick(); return null; } },
  );
  t("a failure inside the loop after the engineer left: result.error is still set, cutOff is true, and no error event or line is sent", () =>
    r.threw === null && r.res.error instanceof TypeError && r.res.cutOff === true && !eventTypes(r.events).includes("error") && !r.res.text.includes(LINE));
}
{
  const r = await drive(longReply(), { emit: (e, n) => { if (n === 2) throw new Error("write after end"); } });
  t("a disconnect is not a failure: the abort the loop asked for leaves result.error absent", () => r.res.cutOff === true && !("error" in r.res));
}
{
  const r = await drive([turnOf(["Because "], modelMsg([block.text("Because ")]))]);
  const refused = await drive([turnOf([], modelMsg([block.text("")], "refusal"))]);
  const capped = await drive(Array.from({ length: 4 }, (_, i) => turnOf([], modelMsg([readUse(`toolu_${i + 1}`)], "tool_use"))));
  t("endings that are not failures (an answer, a refusal, the turn cap) carry no result.error", () =>
    r.res !== null && refused.res !== null && capped.res !== null && ![r.res, refused.res, capped.res].some((x) => "error" in x));
}
{
  const r = await drive([turnOf([], null, { throwOnCreate: Object.assign(new Error("x"), { status: 401 }) })]);
  t("stream() itself throwing is handled like any SDK error, and its cause is in result.error", () =>
    r.threw === null && r.res.text === LINE && eventTypes(r.events).includes("error") && r.res.error?.status === 401);
}
{
  const r = await drive([turnOf([], modelMsg([rerunUse("toolu_1")], "tool_use", { input_tokens: 300, output_tokens: 50 })), turnOf([], null, { reject: Object.assign(new Error("x"), { status: 529 }) })]);
  t("an SDK error after a re-run: the saved revision is kept in the result, with the line as the text, and tokens so far", () =>
    r.threw === null && r.res.revision?.version === 2 && r.res.text === LINE && r.res.inputTokens === 300 && r.res.outputTokens === 50 && r.res.stopReason === "error");
}

// --- What the source says ---------------------------------------------------------------------------------------------
t("run.ts takes the model-turn cap and the re-run cap from DATUM_LIMITS, not from literals", () =>
  /DATUM_LIMITS\.modelTurnsPerMessage/.test(runCode) && /DATUM_LIMITS\.rerunsPerMessage/.test(runCode));
t("run.ts parses the re-run input with RerunToolInput.safeParse", () => /RerunToolInput\.safeParse\(/.test(runCode));
t("run.ts passes no budget_tokens, no fallbacks and no betas, and never forces a tool", () =>
  runCode.length > 0 && !/budget_tokens|fallbacks|betas/.test(runCode) && !/tool_choice[^}]*type:\s*"(tool|any)"/.test(runCode));
t("run.ts names the model once, as claude-opus-5-5", () => runCode.split("claude-opus-5-5").length === 2);
t("run.ts contains none of the phrases the product never writes", () => runSrc.length > 1000 && bannedFree(runSrc));
t("run.ts imports its tools from tools.ts and nothing from the SDK, db, logger or network", () => /from\s+"\.\/tools\.ts"/.test(runCode) && !/@anthropic-ai\/sdk/.test(runCode));

// ===========================================================================
// revise
// ===========================================================================
section("revise");

const REVISE_REL = "artifacts/tis-api-server/src/lib/datum-chat/revise.ts";
const { mod: RV, error: reviseError } = await importByUrl(REVISE_REL);
ok("the revise module loads under plain node (no loader)", reviseError === null, reviseError ?? undefined);
const reviseSrc = read(REVISE_REL);
pinPure("revise.ts", reviseSrc);
const reviseCode = stripComments(reviseSrc);
const reviseStudy = typeof RV.reviseStudy === "function" ? RV.reviseStudy : async () => ({ ok: false, error: "reviseStudy is not exported" });

// --- The fakes -------------------------------------------------------------------------------------
// Each dep records its arguments and answers what a working server would; a test replaces the one it is about.
const RV_FIRM = { id: randomUUID(), studyLimit: 10, studiesUsedThisPeriod: 3, studyCreditsRemaining: 0, subscriptionStatus: "active" };
const RV_USER = { id: "user-rv", email: "rv@example.test" };
const RV_PARENT_ID = randomUUID();
const RV_NEW_ID = randomUUID();
const RV_REVISION_ID = randomUUID();
const RV_MESSAGE_ID = randomUUID();
const RV_FINDING_ID = randomUUID();
/** The parent as getProject returns it: the stored (parsed) request, sensitivity on, a study generated from scratch (its own root). */
const RV_STORED = { ...STORED, runSensitivity: true };
const rvParent = (over = {}) => ({ id: RV_PARENT_ID, firmId: RV_FIRM.id, rootProjectId: null, version: 1, requestPayload: structuredClone(RV_STORED), resultPayload: { marker: "parent" }, ...over });
const RV_REPORT = { marker: "engine report", coverageWarning: undefined };
const RV_COVERAGE = { code: "no_signals_in_radius", message: "No signalized intersection was found within the study radius of this site." };
const RV_INPUT = { changes: { growthRatePct: 1 }, reason: "The county's letter gives 1% a year.", sourceLabel: "  County letter, 2026-09-14  " };

function reviseFakes(over = {}) {
  const calls = { getParent: [], firmGate: [], countLineage: [], generate: [], parseResult: [], createRevision: [], enqueueProofread: [], log: [] };
  const deps = {
    getParent: async (firmId, id) => {
      calls.getParent.push([firmId, id]);
      return rvParent();
    },
    firmGate: (firm, email) => {
      calls.firmGate.push([firm, email]);
      return { ok: true };
    },
    inFlight: new Set(),
    countLineage: async (firmId, rootId) => {
      calls.countLineage.push([firmId, rootId]);
      return 1;
    },
    generate: async (request) => {
      calls.generate.push({ request: structuredClone(request), heldLock: deps.inFlight.has(RV_USER.id) });
      return { ...RV_REPORT };
    },
    parseResult: (report) => {
      calls.parseResult.push(report);
      return { ...report, parsed: true };
    },
    createRevision: async (args) => {
      calls.createRevision.push(args);
      return { projectId: RV_NEW_ID, version: 2, revisionId: RV_REVISION_ID };
    },
    enqueueProofread: async (args) => {
      calls.enqueueProofread.push(args);
    },
    log: (err, ctx) => {
      calls.log.push({ err, ctx });
    },
  };
  for (const [k, v] of Object.entries(over)) deps[k] = typeof v === "function" && k in calls ? (...a) => (calls[k].push(a), v(...a)) : v;
  return { deps, calls };
}
const rvArgs = (over = {}) => ({ firm: RV_FIRM, user: RV_USER, parentId: RV_PARENT_ID, input: structuredClone(RV_INPUT), messageId: RV_MESSAGE_ID, findingId: RV_FINDING_ID, clauseId: "growthOverride", ...over });
/** reviseStudy, with what it threw (it must not) kept apart from what it answered. */
async function revise(deps, args = rvArgs()) {
  try {
    return { res: await reviseStudy(deps, args), threw: null };
  } catch (e) {
    return { res: null, threw: e };
  }
}
const refusedWith = (r, re) => r.threw === null && r.res?.ok === false && typeof r.res.error === "string" && re.test(r.res.error) && !("projectId" in r.res);

// --- The happy path --------------------------------------------------------------------------------
{
  const { deps, calls } = reviseFakes();
  const r = await revise(deps);
  const merged = T.applyRevisionChanges?.(rvParent().requestPayload, RV_INPUT) ?? {};
  t("the happy path: ok, with the new version's id and number and the changes made", () =>
    r.threw === null && r.res?.ok === true && r.res.projectId === RV_NEW_ID && r.res.version === 2 && isDeepStrictEqual(r.res.changes, [{ field: "growthRatePct", from: 2.1, to: 1 }]));
  t("the happy path: the result has exactly the shape run.ts's revise returns (ok, projectId, version, changes)", () => sameSet(Object.keys(r.res ?? {}), ["ok", "projectId", "version", "changes"]));
  t("the happy path: the fake generate saw growthRatePct: 1, once", () => calls.generate.length === 1 && calls.generate[0].request.growthRatePct === 1);
  t("the happy path: generate ran the merge's request, so every other field is the parent's", () => merged.ok === true && isDeepStrictEqual(calls.generate[0].request, merged.request));
  t("runSensitivity is kept as the parent had it (on here), not forced off the way /whatif forces it", () => calls.generate[0]?.request.runSensitivity === true);
  t("the happy path: the gate was asked about this firm and this user's email", () => calls.firmGate.length === 1 && calls.firmGate[0][0] === RV_FIRM && calls.firmGate[0][1] === RV_USER.email);
  t("the happy path: the parent was read within the firm", () => calls.getParent.length === 1 && calls.getParent[0][0] === RV_FIRM.id && calls.getParent[0][1] === RV_PARENT_ID);
  t("the happy path: the lineage was counted from the parent, which is its own root", () => calls.countLineage.length === 1 && calls.countLineage[0][0] === RV_FIRM.id && calls.countLineage[0][1] === RV_PARENT_ID);
  t("the happy path: parseResult got generate's report", () => calls.parseResult.length === 1 && calls.parseResult[0].marker === RV_REPORT.marker);
  const cr = calls.createRevision[0] ?? {};
  t("the happy path: createRevision is called once, with the changes from the merge", () => calls.createRevision.length === 1 && merged.ok === true && isDeepStrictEqual(cr.changes, merged.changes));
  t("the happy path: createRevision gets the parent, the firm, the user who asked, the request generate ran and the parsed result", () =>
    cr.parentId === RV_PARENT_ID && cr.firmId === RV_FIRM.id && cr.userId === RV_USER.id && isDeepStrictEqual(cr.request, calls.generate[0]?.request) && cr.result?.parsed === true && cr.result.marker === RV_REPORT.marker);
  t("the happy path: createRevision gets the reason, the trimmed source, the message, the finding and the clause", () =>
    cr.reason === RV_INPUT.reason && cr.sourceLabel === "County letter, 2026-09-14" && cr.messageId === RV_MESSAGE_ID && cr.findingId === RV_FINDING_ID && cr.clauseId === "growthOverride");
  t("the happy path: createRevision gets exactly the arguments its signature names", () =>
    sameSet(Object.keys(cr), ["parentId", "firmId", "userId", "request", "result", "changes", "reason", "sourceLabel", "messageId", "findingId", "clauseId"]));
  t("the happy path: enqueueProofread gets the new version's id, the firm and the user, once", () =>
    calls.enqueueProofread.length === 1 && isDeepStrictEqual(calls.enqueueProofread[0], { projectId: RV_NEW_ID, firmId: RV_FIRM.id, userId: RV_USER.id }));
  t("the happy path: the lock was held while the engine ran, and is gone afterwards", () => calls.generate[0]?.heldLock === true && deps.inFlight.size === 0);
  t("the happy path: nothing was logged", () => calls.log.length === 0);
}
{
  const parent = rvParent();
  const before = JSON.stringify(parent.requestPayload);
  const { deps } = reviseFakes({ getParent: async () => parent });
  await revise(deps);
  t("the parent row getParent returned is left as it was (the merge works on a copy)", () => JSON.stringify(parent.requestPayload) === before);
}
{
  const ROOT = randomUUID();
  const { deps, calls } = reviseFakes({ getParent: async () => rvParent({ rootProjectId: ROOT, version: 3 }) });
  await revise(deps);
  t("a parent that is a later version counts its lineage by the root it names, not by its own id", () => calls.countLineage.length === 1 && calls.countLineage[0][1] === ROOT);
}

// --- The source and the finding ---------------------------------------------------------------------
for (const [label, sourceLabel] of [["left out", undefined], ["blank", "   "]]) {
  const input = { ...structuredClone(RV_INPUT), sourceLabel };
  if (sourceLabel === undefined) delete input.sourceLabel;
  const { deps, calls } = reviseFakes();
  const r = await revise(deps, rvArgs({ input }));
  t(`a source ${label}: createRevision gets sourceLabel null, so the log says no source was given (the string is never stored)`, () =>
    r.res?.ok === true && calls.createRevision[0]?.sourceLabel === null);
}
{
  const { deps, calls } = reviseFakes();
  const r = await revise(deps, rvArgs({ findingId: undefined, clauseId: undefined, input: { ...structuredClone(RV_INPUT), findingId: randomUUID() } }));
  t("a finding id only the model named (not the caller) is not written: findingId and clauseId are null", () =>
    r.res?.ok === true && calls.createRevision[0]?.findingId === null && calls.createRevision[0]?.clauseId === null);
}
{
  const { deps, calls } = reviseFakes();
  const r = await revise(deps, rvArgs({ messageId: null }));
  t("a null messageId is passed on as null", () => r.res?.ok === true && calls.createRevision[0]?.messageId === null);
}

// --- Refusals before the engine runs ------------------------------------------------------------------
{
  const { deps, calls } = reviseFakes({ firmGate: () => ({ ok: false, reason: "subscription_delinquent" }) });
  const r = await revise(deps);
  t("a delinquent firm: ok:false, 'Your firm has no studies left…'", () => refusedWith(r, /^Your firm has no studies left/));
  t("a delinquent firm: generate is not called, nothing is read, saved or queued", () =>
    calls.generate.length === 0 && calls.getParent.length === 0 && calls.countLineage.length === 0 && calls.createRevision.length === 0 && calls.enqueueProofread.length === 0);
  t("a delinquent firm: the in-flight set is left empty", () => deps.inFlight.size === 0);
}
{
  const { deps, calls } = reviseFakes({ firmGate: () => ({ ok: false, reason: "quota_exceeded" }) });
  const r = await revise(deps);
  t("a firm at its quota with no credits: the same refusal, and generate is not called", () => refusedWith(r, /^Your firm has no studies left/) && calls.generate.length === 0);
}
{
  const { deps, calls } = reviseFakes();
  deps.inFlight.add(RV_USER.id);
  const r = await revise(deps);
  t("a user in flight: ok:false, 'A re-run is already going…'", () => refusedWith(r, /^A re-run is already going/));
  t("a user in flight: generate is not called, and the lineage is not counted", () => calls.generate.length === 0 && calls.countLineage.length === 0 && calls.createRevision.length === 0);
  t("a user in flight: the other re-run's lock is not released by this refusal", () => deps.inFlight.has(RV_USER.id) && deps.inFlight.size === 1);
}
{
  const { deps } = reviseFakes({ firmGate: () => ({ ok: false, reason: "quota_exceeded" }) });
  deps.inFlight.add(RV_USER.id);
  const r = await revise(deps);
  t("the gate is checked before the in-flight lock: a delinquent firm's user in flight hears about the firm", () => refusedWith(r, /^Your firm has no studies left/));
}
{
  const { deps, calls } = reviseFakes({ countLineage: async () => 25 });
  const r = await revise(deps);
  t("a lineage count of 25: ok:false at the cap, 'This study has 25 versions…'", () => refusedWith(r, /^This study has 25 versions/));
  t("at the cap: generate is not called and nothing is saved", () => calls.generate.length === 0 && calls.createRevision.length === 0 && calls.enqueueProofread.length === 0);
  t("at the cap: the lock is released", () => deps.inFlight.size === 0);
}
{
  const { deps, calls } = reviseFakes({ countLineage: async () => 24 });
  const r = await revise(deps);
  t("a lineage count of 24: the re-run makes the 25th version", () => r.res?.ok === true && calls.generate.length === 1);
}
{
  const { deps, calls } = reviseFakes({ countLineage: async () => 40 });
  const r = await revise(deps);
  t("a lineage already past the cap (made before it existed) is refused the same way", () => refusedWith(r, /^This study has 25 versions/) && calls.generate.length === 0);
}
{
  const { deps, calls } = reviseFakes({ getParent: async () => null });
  const r = await revise(deps);
  t("a parent outside the firm (getParent null): ok:false, nothing run, the lock released", () =>
    refusedWith(r, /not found/i) && calls.countLineage.length === 0 && calls.generate.length === 0 && deps.inFlight.size === 0);
}
{
  const { deps, calls } = reviseFakes();
  const r = await revise(deps, rvArgs({ input: { changes: { growthRatePct: 99 }, reason: "r" } }));
  const direct = T.applyRevisionChanges?.(rvParent().requestPayload, { changes: { growthRatePct: 99 }, reason: "r" });
  t("a change the merge refuses: ok:false with the merge's own message, and generate is not called", () =>
    direct?.ok === false && r.res?.ok === false && r.res.error === direct.error && calls.generate.length === 0 && calls.createRevision.length === 0);
  t("a change the merge refuses: the lock is released", () => deps.inFlight.size === 0);
}
{
  const { deps, calls } = reviseFakes({ getParent: async () => rvParent({ requestPayload: { ...structuredClone(RV_STORED), studyRadiusMi: 7 } }) });
  const r = await revise(deps);
  t("saved inputs that fail today's schema: refused pointing to the generator, and the engine is not run", () =>
    refusedWith(r, /saved inputs.*no longer pass.*generator/i) && /studyRadiusMi/.test(r.res?.error ?? "") && calls.generate.length === 0);
}

// --- After the engine runs -------------------------------------------------------------------------
{
  const { deps, calls } = reviseFakes({ generate: async () => ({ ...RV_REPORT, coverageWarning: RV_COVERAGE }) });
  const r = await revise(deps);
  t("a coverage warning: ok:false with that message", () => r.threw === null && r.res?.ok === false && r.res.error === RV_COVERAGE.message);
  t("a coverage warning: no createRevision, no parse, nothing queued", () => calls.createRevision.length === 0 && calls.parseResult.length === 0 && calls.enqueueProofread.length === 0);
  t("a coverage warning: the lock is released", () => deps.inFlight.size === 0);
}

// --- Errors free the lock, and are logged, never thrown ----------------------------------------------
for (const [dep, make] of [
  ["generate", () => async () => { throw new Error("engine exploded 7c1d"); }],
  ["parseResult", () => () => { throw new Error("parse exploded 7c1d"); }],
  ["createRevision", () => async () => { throw new Error("insert exploded 7c1d"); }],
  ["getParent", () => async () => { throw new Error("read exploded 7c1d"); }],
  ["countLineage", () => async () => { throw new Error("count exploded 7c1d"); }],
  ["firmGate", () => () => { throw new Error("gate exploded 7c1d"); }],
]) {
  const { deps, calls } = reviseFakes({ [dep]: make() });
  const r = await revise(deps);
  t(`${dep} throws: ok:false 'The re-run failed', and reviseStudy does not throw`, () => refusedWith(r, /^The re-run failed/));
  t(`${dep} throws: the in-flight set is empty afterwards`, () => deps.inFlight.size === 0);
  t(`${dep} throws: log gets the very error and a context naming the firm, the user and the parent`, () =>
    calls.log.length === 1 && calls.log[0].err instanceof Error && /exploded 7c1d/.test(calls.log[0].err.message) && calls.log[0].ctx?.firmId === RV_FIRM.id && calls.log[0].ctx?.userId === RV_USER.id && calls.log[0].ctx?.parentId === RV_PARENT_ID);
  t(`${dep} throws: the engineer-facing error carries nothing of the cause`, () => !/7c1d|exploded/.test(r.res?.error ?? "7c1d"));
  if (dep !== "createRevision") t(`${dep} throws: nothing is saved or queued`, () => calls.createRevision.length === 0 && calls.enqueueProofread.length === 0);
}
{
  const { deps } = reviseFakes({ generate: async () => { throw new Error("x"); } });
  delete deps.log;
  const r = await revise(deps);
  t("with no log dep, a failure is still ok:false and the lock is still released", () => refusedWith(r, /^The re-run failed/) && deps.inFlight.size === 0);
}
{
  const { deps } = reviseFakes({ generate: async () => { throw new Error("x"); }, log: () => { throw new Error("the log itself broke"); } });
  const r = await revise(deps);
  t("a log that throws does not make reviseStudy throw", () => refusedWith(r, /^The re-run failed/) && deps.inFlight.size === 0);
}

// --- The cap, enforced again under the lock (R16) ------------------------------------------------------
const LineageCapReached = typeof RV.LineageCapReached === "function" ? RV.LineageCapReached : null;
t("revise.ts exports LineageCapReached, an Error whose name says what it is", () => {
  if (LineageCapReached === null) return false;
  const e = new LineageCapReached();
  return e instanceof Error && e instanceof LineageCapReached && e.name === "LineageCapReached";
});
{
  const { deps, calls } = reviseFakes({ createRevision: async () => { throw LineageCapReached ? new LineageCapReached() : new Error("no LineageCapReached"); } });
  const r = await revise(deps);
  t("createRevision throwing LineageCapReached (another save took the 25th version under the lock): ok:false with the cap refusal", () => refusedWith(r, /^This study has 25 versions/));
  t("createRevision throwing LineageCapReached: the lock is released", () => deps.inFlight.size === 0);
  t("createRevision throwing LineageCapReached: it is a refusal, not a failure, so nothing is logged and nothing is queued", () => calls.log.length === 0 && calls.enqueueProofread.length === 0);
}
{
  const { deps, calls } = reviseFakes({ createRevision: async () => { const e = new Error("not the cap"); e.name = "LineageCapReached"; throw e; } });
  const r = await revise(deps);
  t("an error merely NAMED LineageCapReached is not the cap: it is the generic failure, and logged", () => refusedWith(r, /^The re-run failed/) && calls.log.length === 1);
}

// --- Malformed args are answered, never thrown (R15) ------------------------------------------------------
for (const [label, args] of [
  ["user undefined", { ...rvArgs(), user: undefined }],
  ["firm undefined", { ...rvArgs(), firm: undefined }],
  ["args null", null],
  ["args undefined", undefined],
]) {
  const { deps, calls } = reviseFakes();
  let threw = null;
  let res = null;
  try {
    res = await reviseStudy(deps, args);
  } catch (e) {
    threw = e;
  }
  t(`malformed args (${label}): ok:false 'The re-run failed', and reviseStudy does not throw`, () => threw === null && res?.ok === false && /^The re-run failed/.test(res.error));
  t(`malformed args (${label}): log gets the TypeError, and nothing ran or was locked`, () =>
    calls.log.length === 1 && calls.log[0].err instanceof TypeError && calls.generate.length === 0 && calls.createRevision.length === 0 && deps.inFlight.size === 0);
}
{
  const { deps, calls } = reviseFakes();
  const r = await revise(deps, { ...rvArgs(), user: undefined, firm: { id: RV_FIRM.id } });
  t("malformed args: log's context still names what it could read (the firm and the parent)", () =>
    refusedWith(r, /^The re-run failed/) && calls.log[0]?.ctx?.firmId === RV_FIRM.id && calls.log[0]?.ctx?.parentId === RV_PARENT_ID);
}

// --- The proofread of the new version is fire-and-forget -----------------------------------------
{
  let rejected = null;
  const { deps, calls } = reviseFakes({ enqueueProofread: () => { rejected = Promise.reject(new Error("queue down 5e2a")); return rejected; } });
  const r = await revise(deps);
  await tick();
  t("enqueueProofread rejecting: the re-run is still ok (the version is saved), and the rejection is logged, not left unhandled", () =>
    r.res?.ok === true && r.res.projectId === RV_NEW_ID && calls.log.some((l) => /queue down 5e2a/.test(l.err?.message ?? "") && l.ctx?.projectId === RV_NEW_ID));
}
{
  const { deps, calls } = reviseFakes({ enqueueProofread: () => { throw new Error("sync queue failure 9b3f"); } });
  const r = await revise(deps);
  t("enqueueProofread throwing synchronously: still ok, and logged", () => r.res?.ok === true && calls.log.some((l) => /9b3f/.test(l.err?.message ?? "")));
}
{
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const { deps, calls } = reviseFakes({ enqueueProofread: () => gate });
  const r = await Promise.race([revise(deps), new Promise((resolve) => setTimeout(() => resolve("waited"), 200))]);
  release();
  t("reviseStudy does not wait for the proofread pass (enqueueProofread is not awaited)", () => r !== "waited" && r.res?.ok === true && calls.enqueueProofread.length === 1);
}

// --- One at a time per user ----------------------------------------------------------------------
{
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const { deps, calls } = reviseFakes({ generate: async () => { await held; return { ...RV_REPORT }; } });
  const first = revise(deps);
  await tick();
  const second = await revise(deps);
  const other = await (async () => {
    const userB = { id: "user-rv-b", email: "b@example.test" };
    const { deps: d2 } = reviseFakes();
    d2.inFlight = deps.inFlight;
    return revise(d2, rvArgs({ user: userB }));
  })();
  release();
  const firstDone = await first;
  t("a second re-run by the same user while the first is running is refused 'already going'", () => refusedWith(second, /^A re-run is already going/));
  t("another user of the same firm is not held up by that lock", () => other.res?.ok === true);
  t("the first re-run still finishes, and every lock is released afterwards", () => firstDone.res?.ok === true && deps.inFlight.size === 0 && calls.createRevision.length === 1);
}

// --- What the source says --------------------------------------------------------------------------
t("the source never charges: revise.ts contains no reserveStudySlot", () => reviseSrc.length > 500 && !/reserveStudySlot/.test(reviseSrc));
t("revise.ts releases no slot and saves no project the charged way (no releaseStudySlot, no saveProject)", () => reviseSrc.length > 500 && !/releaseStudySlot|saveProject/.test(reviseSrc));
t("revise.ts takes the cap from DATUM_LIMITS.versionsPerLineage, not from a literal", () => /DATUM_LIMITS\.versionsPerLineage/.test(reviseCode) && !/\b25\b/.test(reviseCode));
t("revise.ts calls applyRevisionChanges from tools.ts", () => /from\s+"\.\/tools\.ts"/.test(reviseCode) && /applyRevisionChanges\(/.test(reviseCode));
t("revise.ts removes the in-flight key in a finally", () => /finally\s*\{[^}]*inFlight\.delete\(/.test(reviseCode));
t("revise.ts contains none of the phrases the product never writes", () => reviseSrc.length > 500 && bannedFree(reviseSrc));

// ===========================================================================
// router
// ===========================================================================
section("router");

const ROUTER_REL = "artifacts/tis-api-server/src/routes/datum-chat-router.ts";
const WIRING_REL = "artifacts/tis-api-server/src/routes/datum-chat.ts";
const CLIENT_REL = "artifacts/tis-api-server/src/lib/datum-chat/client.ts";
const SECURITY_REL = "artifacts/tis-api-server/src/lib/security.ts";
const ROUTES_INDEX_REL = "artifacts/tis-api-server/src/routes/index.ts";
const SMOKE_REL = "artifacts/tis-api-server/scripts/datum-chat-live-smoke.mjs";
const SERVER_PACKAGE_REL = "artifacts/tis-api-server/package.json";

// No model key in this process, whatever the shell that runs the check holds: nothing below may reach the model, and
// the client module has to show that by answering null. Removing the variable is all the check does with it.
delete process.env.ANTHROPIC_API_KEY;

// The SDK never loads in this check. Every resolution of its name, from any module, is recorded and answered with a
// stub that throws if it is ever constructed, so "the client did not import the SDK" is something the check can see.
const SDK_NAME = "@anthropic-ai/sdk";
const sdkResolutions = [];
const SDK_STUB = `data:text/javascript,${encodeURIComponent('export default class Anthropic { constructor() { throw new Error("the check never builds the real SDK client"); } }')}`;
let sdkHooked = false;
try {
  const { registerHooks } = await import("node:module");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === SDK_NAME || specifier.startsWith(`${SDK_NAME}/`)) {
        sdkResolutions.push({ specifier, parent: context.parentURL });
        return { url: SDK_STUB, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  sdkHooked = true;
} catch (e) {
  ok("precondition: node:module registerHooks is available to watch the SDK's name", false, e instanceof Error ? e.message : String(e));
}

const { mod: RT, error: routerError } = await importByUrl(ROUTER_REL);
ok("the router module loads under plain node (no loader)", routerError === null, routerError ?? undefined);
const { mod: CL, error: clientError } = await importByUrl(CLIENT_REL);
ok("the client module loads under plain node (no loader)", clientError === null, clientError ?? undefined);
t("loading the router and the client resolved @anthropic-ai/sdk nowhere", () => sdkHooked && routerError === null && clientError === null && sdkResolutions.length === 0);

let express = null;
let compression = null;
try {
  express = (await import("express")).default;
  compression = (await import("compression")).default;
} catch (e) {
  ok("precondition: express and compression load for the test app", false, e instanceof Error ? e.message : String(e));
}

/** An async block's value, or why it threw, so one failure is a named FAIL and the assertions after it still run. */
const settle = async (fn) => {
  try {
    return { r: await fn(), err: null };
  } catch (e) {
    return { r: null, err: e instanceof Error ? e.message : String(e) };
  }
};
const must = (x) => {
  if (x.err !== null) throw new Error(x.err);
  return x.r;
};
const until = async (cond, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await sleep(10);
  }
  return cond();
};
/** Every key of `expected` has that value in `row` (deep), so a row may carry other keys. */
const has = (row, expected) => typeof row === "object" && row !== null && Object.entries(expected).every(([k, v]) => isDeepStrictEqual(row[k], v));

// --- The source -----------------------------------------------------------------------------------
const routerSrc = read(ROUTER_REL);
const routerCode = stripComments(routerSrc);
{
  const specs = [...routerCode.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]);
  t("the router imports express and the datum-chat modules only, each by an explicit .ts path: no db, store, logger or SDK", () =>
    specs.length > 0 && specs.every((s) => s === "express" || /^\.\.\/lib\/datum-chat\/(contract|context|prompt|run|revise)\.ts$/.test(s)));
  t("the router reads no env, fetches nothing, and names no SDK, db or logger", () =>
    routerCode.length > 0 && !/process\.env|\bfetch\s*\(|@anthropic-ai\/sdk|@workspace\/db|\blogger\b|\brequire\s*\(/.test(routerCode));
}
t('a disconnect is res.on("close") with !res.writableEnded, never req.on("close") (Node fires that once the body is read)', () =>
  /res\.on\("close"/.test(routerCode) && /!res\.writableEnded/.test(routerCode) && !/req\.on\("close"/.test(routerCode));
t("the stream's headers are set verbatim, then flushed", () =>
  /"Content-Type",\s*"text\/event-stream"/.test(routerCode) &&
  /"Cache-Control",\s*"no-cache, no-transform"/.test(routerCode) &&
  /"X-Accel-Buffering",\s*"no"/.test(routerCode) &&
  /res\.flushHeaders\(\)/.test(routerCode));
t("each event is written as `data: <json>` and a blank line, then flushed past compression", () =>
  /res\.write\(`data: \$\{JSON\.stringify\(\w+\)\}\\n\\n`\)/.test(routerCode) && /res\.flush\?\.\(\)/.test(routerCode));
t("the router never answers 409: a re-run already going is refused through the tool result (R19)", () => routerCode.length > 0 && !/\b409\b/.test(routerCode));
t("the router takes the firm cap from DATUM_LIMITS.firmRepliesPer24h, not from a literal", () => /DATUM_LIMITS\.firmRepliesPer24h/.test(routerCode) && !/\b300\b/.test(routerCode));

const securitySrc = read(SECURITY_REL);
const limiterBlockOf = (src, name) => {
  const i = src.indexOf(`export const ${name} = rateLimit({`);
  if (i < 0) return "";
  const j = src.indexOf("\n});", i);
  return j < 0 ? "" : src.slice(i, j + 4);
};
const squash = (s) => stripComments(s).replace(/\s+/g, " ");
const datumLimiter = squash(limiterBlockOf(securitySrc, "datumChatLimiter"));
const runLimiter = squash(limiterBlockOf(securitySrc, "proofreadRunLimiter"));
const skipOf = (b) => /skip: \(req\) => \{.*?\},/.exec(b)?.[0] ?? null;
t("security.ts exports datumChatLimiter as rateLimit({ ... })", () => datumLimiter.length > 0);
t("datumChatLimiter allows DATUM_LIMITS.userMessagesPerHour (40) an hour", () =>
  /windowMs: 60 \* 60 \* 1000,/.test(datumLimiter) && /limit: DATUM_LIMITS\.userMessagesPerHour,/.test(datumLimiter) && C.DATUM_LIMITS?.userMessagesPerHour === 40);
t("security.ts takes DATUM_LIMITS from @workspace/tis-api-zod", () => /import \{[^}]*\bDATUM_LIMITS\b[^}]*\} from "@workspace\/tis-api-zod";/.test(securitySrc));
t('datumChatLimiter is keyed per user, falling back to ipKeyGenerator(req.ip ?? "")', () =>
  datumLimiter.includes('keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),'));
t("datumChatLimiter has proofreadRunLimiter's skip (dev auth and admin emails), word for word", () => skipOf(datumLimiter) !== null && skipOf(datumLimiter) === skipOf(runLimiter));
t('datumChatLimiter fails open like proofreadRunLimiter, and pins standardHeaders "draft-7" with no legacy headers', () =>
  datumLimiter.includes("passOnStoreError: true,") && datumLimiter.includes('standardHeaders: "draft-7",') && datumLimiter.includes("legacyHeaders: false,"));
t('datumChatLimiter\'s message is "Too many Datum messages this hour. Try again shortly."', () =>
  datumLimiter.includes('message: { error: "Too many Datum messages this hour. Try again shortly." }'));
t("datumChatLimiter has its own Redis prefix, used by no other limiter", () => {
  const prefix = /makeRateLimitStore\("([^"]+)"\)/.exec(datumLimiter)?.[1];
  const all = [...securitySrc.matchAll(/makeRateLimitStore\("([^"]+)"\)/g)].map((m) => m[1]);
  return prefix === "rl:datum-chat:" && all.filter((p) => p === prefix).length === 1;
});

const routesIndexSrc = read(ROUTES_INDEX_REL);
t("routes/index.ts imports the chat router from ./datum-chat and mounts it once, after proofreadRouter", () => {
  const p = routesIndexSrc.indexOf("router.use(proofreadRouter);");
  const d = routesIndexSrc.indexOf("router.use(datumChatRouter);");
  return routesIndexSrc.includes('import datumChatRouter from "./datum-chat";') && p >= 0 && d > p && routesIndexSrc.split("router.use(datumChatRouter);").length === 2;
});

const wiringSrc = read(WIRING_REL);
const wiringCode = stripComments(wiringSrc);
t("the wiring keeps one module-level Set<string> of the users with a chat re-run going, its own and not /whatif's", () => {
  const sets = [...wiringCode.matchAll(/^const (\w+) = new Set<string>\(\);$/gm)];
  return sets.length === 1 && (wiringCode.match(/new Set\b/g) ?? []).length === 1 && !/whatIfInFlight/.test(wiringCode) && new RegExp(`\\binFlight: ${sets[0][1]}\\b`).test(wiringCode);
});
t("the wiring hands the factory the real modules", () =>
  [
    /from "\.\/datum-chat-router(\.ts)?"/,
    /makeDatumChatRouter(<[^>()]*>)?\(/,
    /\bdatumChatLimiter\b/,
    /\bgetDatumClient\b/,
    /\bdatumChatEnabled\b/,
    /reviseStudy(<[^>()]*>)?\(/,
    /\bfirmMayRunUncharged\b/,
    /\bgenerateTisReport\b/,
    /GenerateTisResponse\.parse\(/,
    /\benqueueProofread\b/,
    /createRevision\(/,
    /\bcountLineage\b/,
    /\bgetProject\b/,
    /getOrCreateFirmForUser\(/,
    /from "\.\.\/lib\/datum-chat\/store(\.ts)?"/,
    /\blineageFor\b/,
    /\blistRevisions\b/,
    /\bfirmRepliesLast24h\b/,
    /\bloadVisible\b/,
    /\blistMessages\b/,
    /\binsertMessage\b/,
  ].every((re) => re.test(wiringCode)));
t("the wiring charges nothing: no reserveStudySlot, releaseStudySlot or saveProject", () => wiringCode.length > 0 && !/reserveStudySlot|releaseStudySlot|saveProject/.test(wiringCode));
t("the wiring default-exports the router", () => /^export default router;$/m.test(wiringCode));

// --- The client switch ---------------------------------------------------------------------------
const clientSrc = read(CLIENT_REL);
const clientCode = stripComments(clientSrc);
// The static half of "the client never loads the SDK with no key" is the `client-lazy` guard in the guards section, with its teeth.
t('client.ts loads the SDK in one place, with import("@anthropic-ai/sdk")', () => (clientCode.match(/\bimport\("@anthropic-ai\/sdk"\)/g) ?? []).length === 1);
t("client.ts decides by process.env.ANTHROPIC_API_KEY", () => /process\.env\.ANTHROPIC_API_KEY/.test(clientCode));
{
  const x = await settle(async () => ({ client: await CL.getDatumClient(), enabled: CL.datumChatEnabled() }));
  t("with the key unset, getDatumClient() answers null and datumChatEnabled() is false", () => {
    const r = must(x);
    return r.client === null && r.enabled === false;
  });
  t("and nothing resolved @anthropic-ai/sdk: the SDK was not imported", () => must(x) !== null && sdkHooked && sdkResolutions.length === 0);
}

/** A stand-in for the SDK's module: a client whose messages.stream() records what it is given and replays `deltas`. */
const fakeSdk = (message, deltas = ["Hello ", "there."]) => {
  const rec = { made: 0, args: [], params: [], aborts: 0 };
  class Anthropic {
    constructor(...args) {
      rec.made += 1;
      rec.args.push(args);
      this.messages = {
        stream: (params, ...more) => {
          rec.params.push({ params, more });
          const listeners = [];
          let snapshot = "";
          const handle = {
            on(ev, cb) {
              if (ev === "text") listeners.push(cb);
              return handle;
            },
            abort() {
              rec.aborts += 1;
            },
            async finalMessage() {
              await tick();
              for (const d of deltas) {
                snapshot += d;
                for (const cb of listeners) cb(d, snapshot);
              }
              return message;
            },
          };
          return handle;
        },
      };
    }
  }
  return { rec, module: { default: Anthropic } };
};
const SDK_MESSAGE = {
  id: "msg_check_1",
  type: "message",
  role: "assistant",
  model: MODEL,
  content: [
    { type: "thinking", thinking: "", signature: "opaque-signature-sdk" },
    { type: "text", text: "Hello there.", citations: null },
  ],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 120, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 18000, server_tool_use: null, service_tier: "standard" },
};
{
  const x = await settle(async () => {
    const sdk = fakeSdk(SDK_MESSAGE);
    let loads = 0;
    let key = false;
    const get = CL.makeDatumClientGetter({ hasKey: () => key, load: async () => ((loads += 1), sdk.module) });
    const off = await get();
    const loadsWhileOff = loads;
    key = true;
    const [a, b] = await Promise.all([get(), get()]);
    const c = await get();
    return { off, loadsWhileOff, a, b, c, loads, made: sdk.rec.made, args: sdk.rec.args };
  });
  t("makeDatumClientGetter: no key, null, and the SDK is not loaded", () => {
    const r = must(x);
    return r.off === null && r.loadsWhileOff === 0;
  });
  t("with a key: one load and one client for every call after, concurrent calls included", () => {
    const r = must(x);
    return r.a !== null && typeof r.a?.messages?.stream === "function" && r.a === r.b && r.b === r.c && r.loads === 1 && r.made === 1;
  });
  t("the client is built with no arguments: the SDK reads its own key from the environment", () => same(must(x).args, [[]]));
}
{
  const x = await settle(async () => {
    const sdk = fakeSdk(SDK_MESSAGE);
    let loads = 0;
    const get = CL.makeDatumClientGetter({
      hasKey: () => true,
      load: async () => {
        loads += 1;
        if (loads === 1) throw new Error("load failed");
        return sdk.module;
      },
    });
    let first = null;
    try {
      await get();
    } catch (e) {
      first = e instanceof Error ? e.message : String(e);
    }
    return { first, second: await get(), loads };
  });
  t("a failed SDK load rejects that call and is tried again on the next, not kept as a failure", () => {
    const r = must(x);
    return r.first === "load failed" && r.second !== null && r.loads === 2;
  });
}
{
  const x = await settle(async () => {
    const sdk = fakeSdk({ ...SDK_MESSAGE, stop_reason: null });
    const client = CL.adaptAnthropic(new sdk.module.default());
    const params = { model: MODEL, messages: [] };
    const stream = client.messages.stream(params);
    const got = [];
    stream.on("text", (...a) => got.push(a));
    stream.abort();
    const m = await stream.finalMessage();
    const kept = await CL.adaptAnthropic(new (fakeSdk(SDK_MESSAGE).module.default)()).messages.stream({}).finalMessage();
    return { m, kept, got, rec: sdk.rec, params };
  });
  t("adaptAnthropic: stream(params) gives the SDK the same params object, and nothing else", () => {
    const r = must(x);
    return r.rec.params.length === 1 && r.rec.params[0].params === r.params && r.rec.params[0].more.length === 0;
  });
  t("adaptAnthropic: the text listener gets the delta alone, not the SDK's snapshot", () => same(must(x).got, [["Hello "], ["there."]]));
  t("adaptAnthropic: abort() reaches the SDK stream", () => must(x).rec.aborts === 1);
  t("adaptAnthropic: the content blocks are the SDK's own objects, unchanged (the thinking block's signature included)", () => {
    const r = must(x);
    return r.m.content.length === 2 && r.m.content[0] === SDK_MESSAGE.content[0] && r.m.content[1] === SDK_MESSAGE.content[1];
  });
  t("adaptAnthropic: usage is the input and output tokens only, and the model is as given", () => {
    const r = must(x);
    return same(r.m.usage, { input_tokens: 120, output_tokens: 30 }) && r.m.model === MODEL;
  });
  t("adaptAnthropic: a stop_reason is kept as given, and a null one becomes a string the loop can store", () => {
    const r = must(x);
    return r.kept.stop_reason === "end_turn" && typeof r.m.stop_reason === "string" && r.m.stop_reason !== "" && r.m.stop_reason !== "end_turn" && r.m.stop_reason !== "tool_use";
  });
}
{
  const x = await settle(async () => {
    const sdk = fakeSdk(SDK_MESSAGE);
    const events = [];
    const res = await RUN.runDatumTurn(
      {
        client: CL.adaptAnthropic(new sdk.module.default()),
        revise: async () => ({ ok: false, error: "not in this test" }),
        readPath: () => "",
        emit: (e) => events.push(e),
        signal: new AbortController().signal,
      },
      { system: SYSTEM, messages: HISTORY },
    );
    return { res, events, rec: sdk.rec };
  });
  t("the adapted client drives runDatumTurn: the reply streams, and the SDK is given the loop's own params", () => {
    const r = must(x);
    const p = r.rec.params[0]?.params ?? {};
    return (
      r.res.text === "Hello there." &&
      r.res.stopReason === "end_turn" &&
      r.res.inputTokens === 120 &&
      r.res.outputTokens === 30 &&
      same(r.events, [{ type: "text", delta: "Hello " }, { type: "text", delta: "there." }]) &&
      p.model === MODEL &&
      same(p.thinking, { type: "adaptive" }) &&
      p.tools?.[0]?.name === READ_NAME &&
      p.tools?.[1]?.name === RERUN_NAME
    );
  });
}

// --- The test app ----------------------------------------------------------------------------------
// makeDatumChatRouter(fakes) on express() with compression() and express.json(), as app.ts mounts them, and a fake
// auth that sets req.isAuthenticated / req.user (signed out when the request says so) and a recording req.log.
const RT_FIRM = { id: randomUUID(), name: "Firm A" };
const RT_USER = { id: "user-rt", email: "rt@example.test", firstName: "Rae", lastName: "Tan", profileImageUrl: null };
const RT_PROJECT = randomUUID();
const RT_FOREIGN = randomUUID();
const RT_NEW = randomUUID();
const RT_REVISION_ROW = randomUUID();
const RT_HIDDEN = randomUUID();
const RT_VISIBLE = REAL.slice(0, 2);
const [RT_F0, RT_F1] = RT_VISIBLE;
const RT_LINEAGE = { version: 1, revisedFromProjectId: null, revisedFromVersion: null, latestVersionId: RT_PROJECT, latestVersion: 1 };
const RT_EARLIER = [
  { id: randomUUID(), role: "engineer", content: "What does the growth finding mean?", authorName: "Rae Tan", findingId: null, revisionId: null, createdAt: "2026-10-20T10:00:00.000Z" },
  { id: randomUUID(), role: "datum", content: "It means the study grew the counts at 2.1% a year.", authorName: null, findingId: null, revisionId: null, createdAt: "2026-10-20T10:00:05.000Z" },
];
const RT_CHANGES = [{ field: "growthRatePct", from: 2.1, to: 1 }];
const RT_REVISIONS = [
  { id: RT_REVISION_ROW, projectId: RT_NEW, fromProjectId: RT_PROJECT, version: 2, changes: RT_CHANGES, reason: "county letter", sourceLabel: null, requestedBy: "Rae Tan", findingId: null, clauseId: null, createdAt: "2026-10-20T10:01:00.000Z" },
];
const RT_STORED = { id: RT_PROJECT, firmId: RT_FIRM.id, rootProjectId: null, version: 1, requestPayload: REC.request, resultPayload: REC.result };
const CAP_LINE = "Datum has answered 300 questions for your firm today. It picks up again within 24 hours.";
const explainTurn = () => turnOf(["Because ", "the growth rate ", "was 2.1%."], modelMsg([block.thinking(), block.text("Because the growth rate was 2.1%.")]));
const rerunTurns = (input = GROW, reply = "Done: Version 2 uses growth 1.0%.") => [
  turnOf([], modelMsg([block.thinking(), rerunUse("tu_rt_1", input)], "tool_use")),
  turnOf([reply], modelMsg([block.text(reply)])),
];

/**
 * Fakes for every dep, each recording its calls (and `order`, the sequence the route read and wrote in). Knobs:
 * enabled, client (null for none), replies, visible, insertThrows (a role whose insert throws), revise, limiter, turns,
 * project (the stored study getProject gives back), lineageThrows (an error lineageFor throws) and keepAliveMs.
 */
function routerFakes(over = {}) {
  const calls = { order: [], resolveFirm: [], getProject: [], loadVisible: [], listMessages: [], insertMessage: [], listRevisions: [], lineageFor: [], firmRepliesLast24h: [], revise: [], getClient: 0, limiter: 0 };
  const model = fakeModel(over.turns ?? [explainTurn()]);
  const ids = [];
  const deps = {
    isEnabled: () => over.enabled ?? true,
    getClient: async () => {
      calls.getClient += 1;
      return over.client === null ? null : model.client;
    },
    resolveFirm: async (user) => {
      calls.order.push("resolveFirm");
      calls.resolveFirm.push(user);
      return RT_FIRM;
    },
    getProject: async (firmId, id) => {
      calls.order.push("getProject");
      calls.getProject.push([firmId, id]);
      return firmId === RT_FIRM.id && id === RT_PROJECT ? (over.project ?? RT_STORED) : null;
    },
    loadVisible: async (firmId, id) => {
      calls.order.push("loadVisible");
      calls.loadVisible.push([firmId, id]);
      return { findings: over.visible ?? RT_VISIBLE, dispositions: [] };
    },
    listMessages: async (firmId, id) => {
      calls.order.push("listMessages");
      calls.listMessages.push([firmId, id]);
      return structuredClone(RT_EARLIER);
    },
    insertMessage: async (row) => {
      calls.order.push(`insert:${row.role}`);
      calls.insertMessage.push(structuredClone(row));
      if (over.insertThrows === row.role) throw new Error(`insert of the ${row.role} message failed (check)`);
      const id = randomUUID();
      ids.push(id);
      return { id };
    },
    listRevisions: async (firmId, id) => {
      calls.listRevisions.push([firmId, id]);
      return structuredClone(RT_REVISIONS);
    },
    lineageFor: async (firmId, id) => {
      calls.lineageFor.push([firmId, id]);
      if (over.lineageThrows) throw over.lineageThrows;
      return { ...RT_LINEAGE };
    },
    firmRepliesLast24h: async (firmId) => {
      calls.order.push("firmReplies");
      calls.firmRepliesLast24h.push(firmId);
      return over.replies ?? 0;
    },
    revise: async (firm, user, parentId, input, messageId, findingId, extras) => {
      calls.revise.push({ firm, user, parentId, input: structuredClone(input), messageId, findingId, extras });
      if (over.revise) return over.revise(firm, user, parentId, input, messageId, findingId, extras);
      return { ok: true, projectId: RT_NEW, version: 2, changes: RT_CHANGES, revisionId: RT_REVISION_ROW };
    },
    limiter:
      over.limiter ??
      ((_req, _res, next) => {
        calls.limiter += 1;
        next();
      }),
  };
  if (over.keepAliveMs !== undefined) deps.keepAliveMs = over.keepAliveMs;
  return { deps, calls, model, ids };
}

/**
 * Runs `fn` against a fresh server on port 0. `tamper` is middleware mounted right after compression(). A block that
 * has not finished in ROUTER_BLOCK_MS fails by name (a route that never answers would otherwise hang the check), and
 * the server's sockets are destroyed either way, so a hung fetch rejects.
 */
const ROUTER_BLOCK_MS = 10000;
async function withServer(deps, fn, { tamper } = {}) {
  const logs = [];
  const escaped = [];
  const app = express();
  app.use(compression());
  if (tamper) app.use(tamper);
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = req.header("x-test-signed-out") === "1" ? undefined : RT_USER;
    req.isAuthenticated = function isAuthenticated() {
      return this.user != null;
    };
    const at = (level) => (obj, msg) => logs.push({ level, obj, msg });
    req.log = { error: at("error"), warn: at("warn"), info: at("info"), debug: at("debug") };
    next();
  });
  app.use(RT.makeDatumChatRouter(deps));
  // The check's own net: an error the router let reach Express would otherwise be a bare 500 with no reason.
  app.use((err, _req, res, _next) => {
    escaped.push(err);
    if (!res.headersSent) res.status(599).end();
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`the block did not finish in ${ROUTER_BLOCK_MS} ms (a response that never ends?)`)), ROUTER_BLOCK_MS);
  });
  try {
    return await Promise.race([fn({ base, logs, escaped }), timeout]);
  } finally {
    clearTimeout(timer);
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

const getThread = (base, id = RT_PROJECT, headers = {}) => fetch(`${base}/projects/${id}/datum`, { headers });
const postMessage = (base, body, { id = RT_PROJECT, headers = {}, signal } = {}) =>
  fetch(`${base}/projects/${id}/datum/messages`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
const jsonOf = async (r) => {
  try {
    return await r.json();
  } catch {
    return null;
  }
};

/**
 * Reads a server-sent event stream to its end, or until `stopAfter(event, n)` is true, when it aborts `controller`
 * (the engineer closing the tab). Each event is kept with the time it arrived. A frame of comment lines only (the
 * keep-alive, `: ping`) is not an event: it is skipped, as the browser's parser must skip it, and kept apart in
 * `comments`. `order` is the sequence of both, "comment" or the event's type.
 */
async function readStream(r, { stopAfter, controller } = {}) {
  const events = [];
  const at = [];
  const comments = [];
  const order = [];
  let raw = "";
  let buf = "";
  let failed = null;
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      buf += chunk;
      for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const lines = frame.split("\n");
        const dataLines = lines.filter((l) => l.startsWith("data: "));
        if (dataLines.length === 0 && lines.every((l) => l.startsWith(":"))) {
          comments.push({ text: lines.map((l) => l.slice(1).trim()).join("\n"), at: performance.now() });
          order.push("comment");
          continue;
        }
        const data = dataLines.map((l) => l.slice(6)).join("\n");
        let event;
        try {
          event = JSON.parse(data);
        } catch {
          event = { unparsable: frame };
        }
        events.push(event);
        at.push(performance.now());
        order.push(event?.type ?? "unparsable");
        if (stopAfter?.(event, events.length)) {
          controller?.abort();
          await reader.cancel().catch(() => undefined);
          return { events, at, comments, order, raw, rest: buf, endedAt: null, stopped: true, failed };
        }
      }
    }
  } catch (e) {
    failed = e instanceof Error ? e.message : String(e);
  }
  return { events, at, comments, order, raw, rest: buf, endedAt: performance.now(), stopped: false, failed };
}
const parsesAsEvents = (events) => events.length > 0 && events.every((e) => C.DatumStreamEvent?.safeParse(e).success === true);
const datumRows = (calls) => calls.insertMessage.filter((r) => r.role === "datum");
const errorLogs = (logs) => logs.filter((l) => l.level === "error");

// --- Signed out -------------------------------------------------------------------------------------
{
  const f = routerFakes();
  const x = await settle(() =>
    withServer(f.deps, async ({ base }) => {
      const g = await getThread(base, RT_PROJECT, { "x-test-signed-out": "1" });
      const p = await postMessage(base, { content: "hi" }, { headers: { "x-test-signed-out": "1" } });
      return { g: g.status, gb: await jsonOf(g), p: p.status, pb: await jsonOf(p) };
    }),
  );
  t("signed out: GET is 401 with an error", () => {
    const r = must(x);
    return r.g === 401 && typeof r.gb?.error === "string";
  });
  t("signed out: POST is 401, and nothing was read or written", () => {
    const r = must(x);
    return r.p === 401 && typeof r.pb?.error === "string" && f.calls.resolveFirm.length === 0 && f.calls.insertMessage.length === 0 && f.model.calls.length === 0;
  });
}

// --- Another firm, and an id that is not a uuid ----------------------------------------------------------
{
  const f = routerFakes();
  const x = await settle(() =>
    withServer(f.deps, async ({ base }) => {
      const foreign = await getThread(base, RT_FOREIGN);
      const firmReadsAfterForeign = f.calls.resolveFirm.length;
      const notUuid = await getThread(base, "not-a-uuid");
      const firmReadsAfterNotUuid = f.calls.resolveFirm.length;
      const postForeign = await postMessage(base, { content: "hi" }, { id: RT_FOREIGN });
      const postNotUuid = await postMessage(base, { content: "hi" }, { id: "not-a-uuid" });
      return {
        foreign: foreign.status,
        foreignBody: await jsonOf(foreign),
        notUuid: notUuid.status,
        postForeign: postForeign.status,
        postNotUuid: postNotUuid.status,
        firmReadsAfterForeign,
        firmReadsAfterNotUuid,
      };
    }),
  );
  t("another firm: GET on another firm's project is 404, the project read within the user's own firm", () => {
    const r = must(x);
    return r.foreign === 404 && typeof r.foreignBody?.error === "string" && same(f.calls.getProject[0], [RT_FIRM.id, RT_FOREIGN]) && r.firmReadsAfterForeign === 1;
  });
  t("GET /projects/not-a-uuid/datum is 404 before anything is read", () => {
    const r = must(x);
    return r.notUuid === 404 && r.firmReadsAfterNotUuid === 1;
  });
  t("POST on another firm's project, or on an id that is not a uuid, is 404 and writes nothing", () => {
    const r = must(x);
    return r.postForeign === 404 && r.postNotUuid === 404 && f.calls.insertMessage.length === 0 && f.model.calls.length === 0;
  });
}

// --- The read ------------------------------------------------------------------------------------------
{
  const f = routerFakes();
  const x = await settle(() =>
    withServer(f.deps, async ({ base }) => {
      const g = await getThread(base);
      return { status: g.status, body: await jsonOf(g) };
    }),
  );
  t("GET answers DatumChatReadResponse: enabled, the thread, the revisions and the lineage, all read within the firm", () => {
    const r = must(x);
    return (
      r.status === 200 &&
      C.DatumChatReadResponse?.safeParse(r.body).success === true &&
      same(r.body, { enabled: true, messages: RT_EARLIER, revisions: RT_REVISIONS, lineage: RT_LINEAGE }) &&
      same(f.calls.listMessages, [[RT_FIRM.id, RT_PROJECT]]) &&
      same(f.calls.listRevisions, [[RT_FIRM.id, RT_PROJECT]]) &&
      same(f.calls.lineageFor, [[RT_FIRM.id, RT_PROJECT]])
    );
  });
  t("GET spends nothing of the message budget: the limiter is the POST's", () => must(x) !== null && f.calls.limiter === 0);
}

// --- Disabled ----------------------------------------------------------------------------------------
{
  const f = routerFakes({ enabled: false });
  const x = await settle(() =>
    withServer(f.deps, async ({ base }) => {
      const g = await getThread(base);
      const p = await postMessage(base, { content: "Why was this flagged?" });
      return { g: g.status, gb: await jsonOf(g), p: p.status, pb: await jsonOf(p) };
    }),
  );
  t("disabled: GET is { enabled: false, messages: [], revisions: [], lineage }, and the thread is not read", () => {
    const r = must(x);
    return (
      r.g === 200 &&
      same(r.gb, { enabled: false, messages: [], revisions: [], lineage: RT_LINEAGE }) &&
      C.DatumChatReadResponse?.safeParse(r.gb).success === true &&
      f.calls.listMessages.length === 0 &&
      f.calls.listRevisions.length === 0
    );
  });
  t('disabled: POST is 503 { error: "Datum chat is off." }, with no client asked for and nothing written', () => {
    const r = must(x);
    return r.p === 503 && same(r.pb, { error: "Datum chat is off." }) && f.calls.getClient === 0 && f.calls.insertMessage.length === 0;
  });
}
{
  const f = routerFakes({ client: null });
  const x = await settle(() =>
    withServer(f.deps, async ({ base }) => {
      const p = await postMessage(base, { content: "Why was this flagged?" });
      return { p: p.status, pb: await jsonOf(p) };
    }),
  );
  t("no client although the chat says it is on: POST is 503, and the engineer's message is not saved", () => {
    const r = must(x);
    return r.p === 503 && same(r.pb, { error: "Datum chat is off." }) && f.calls.getClient === 1 && f.calls.insertMessage.length === 0;
  });
}

// --- Bad bodies ------------------------------------------------------------------------------------------
{
  const f = routerFakes();
  const x = await settle(() =>
    withServer(f.deps, async ({ base }) => {
      const out = {};
      for (const [name, body] of [
        ["empty", { content: "" }],
        ["blank", { content: "   " }],
        ["long", { content: "x".repeat(C.DATUM_LIMITS?.messageChars + 1) }],
        ["extra", { content: "ok", projectId: RT_PROJECT }],
        ["badFinding", { content: "ok", findingId: "not-a-uuid" }],
      ]) {
        const r = await postMessage(base, body);
        out[name] = { status: r.status, body: await jsonOf(r) };
      }
      const hidden = await postMessage(base, { content: "Why?", findingId: RT_HIDDEN });
      out.hidden = { status: hidden.status, body: await jsonOf(hidden) };
      return out;
    }),
  );
  t('bad bodies: { content: "" } is 400', () => must(x).empty.status === 400 && typeof must(x).empty.body?.error === "string");
  t("bad bodies: blank content, content over the limit, an unknown key and a findingId that is no uuid are each 400", () => {
    const r = must(x);
    return ["blank", "long", "extra", "badFinding"].every((k) => r[k].status === 400);
  });
  t("a findingId that is not in the visible set is 404, and nothing is written or asked of the model", () => {
    const r = must(x);
    return r.hidden.status === 404 && typeof r.hidden.body?.error === "string" && f.calls.insertMessage.length === 0 && f.model.calls.length === 0;
  });
}

// --- The firm cap, and the limiter first -------------------------------------------------------------------
{
  const atCap = routerFakes({ replies: 300 });
  const under = routerFakes({ replies: 299 });
  const x = await settle(async () => {
    const capped = await withServer(atCap.deps, async ({ base }) => {
      const p = await postMessage(base, { content: "Why?" });
      return { status: p.status, body: await jsonOf(p) };
    });
    const below = await withServer(under.deps, async ({ base }) => {
      const p = await postMessage(base, { content: "Why?" });
      return { status: p.status, s: await readStream(p) };
    });
    return { capped, below };
  });
  t(`the firm cap: firmRepliesLast24h at 300 is 429 "${CAP_LINE}", counted for the firm, and nothing is written`, () => {
    const r = must(x);
    return r.capped.status === 429 && same(r.capped.body, { error: CAP_LINE }) && same(atCap.calls.firmRepliesLast24h, [RT_FIRM.id]) && atCap.calls.insertMessage.length === 0;
  });
  t("299 replies is under the cap: the message is answered", () => {
    const r = must(x);
    return r.below.status === 200 && r.below.s.events.at(-1)?.type === "done";
  });
}
{
  const f = routerFakes({
    limiter: (_req, res) => {
      f.calls.limiter += 1;
      res.status(429).json({ error: "limited (check)" });
    },
  });
  const x = await settle(() =>
    withServer(f.deps, async ({ base }) => {
      const signedIn = await postMessage(base, { content: "Why?" });
      const signedOut = await postMessage(base, { content: "" }, { headers: { "x-test-signed-out": "1" } });
      return { a: signedIn.status, ab: await jsonOf(signedIn), b: signedOut.status };
    }),
  );
  t("the limiter runs first: a limited POST is answered by the limiter, before sign-in, the body or any read", () => {
    const r = must(x);
    return r.a === 429 && same(r.ab, { error: "limited (check)" }) && r.b === 429 && f.calls.limiter === 2 && f.calls.resolveFirm.length === 0;
  });
}

// --- The stream ------------------------------------------------------------------------------------------
{
  const f = routerFakes();
  const x = await settle(() =>
    withServer(f.deps, async ({ base, logs, escaped }) => {
      const p = await postMessage(base, { content: "  Why was growth flagged?  " });
      const headers = { type: p.headers.get("content-type"), cache: p.headers.get("cache-control"), accel: p.headers.get("x-accel-buffering"), encoding: p.headers.get("content-encoding") };
      return { status: p.status, headers, s: await readStream(p), logs, escaped };
    }),
  );
  t("the stream: 200 with content-type text/event-stream, no-cache, no-transform, X-Accel-Buffering: no, and not compressed", () => {
    const r = must(x);
    return r.status === 200 && /^text\/event-stream/.test(r.headers.type ?? "") && r.headers.cache === "no-cache, no-transform" && r.headers.accel === "no" && r.headers.encoding === null;
  });
  t("the stream: every event parses as DatumStreamEvent, the reply's deltas in order, ending with done", () => {
    const r = must(x);
    return parsesAsEvents(r.s.events) && same(eventTypes(r.s.events), ["text", "text", "text", "done"]) && joinedDeltas(r.s.events) === "Because the growth rate was 2.1%." && r.s.rest === "";
  });
  t("the stream: insertMessage is called twice, the engineer's message (trimmed) and then Datum's, both under the firm resolved for the project", () => {
    const [engineer, datum] = f.calls.insertMessage;
    return (
      must(x) !== null &&
      f.calls.insertMessage.length === 2 &&
      has(engineer, { projectId: RT_PROJECT, firmId: RT_FIRM.id, userId: RT_USER.id, role: "engineer", content: "Why was growth flagged?", findingId: null }) &&
      has(datum, { projectId: RT_PROJECT, firmId: RT_FIRM.id, userId: null, role: "datum", content: "Because the growth rate was 2.1%.", revisionId: null, model: MODEL, inputTokens: 100, outputTokens: 20, stopReason: "end_turn" })
    );
  });
  t("the stream: done carries the id of the saved Datum message", () => {
    const r = must(x);
    return f.ids.length === 2 && same(r.s.events.at(-1), { type: "done", messageId: f.ids[1] });
  });
  t("R12: the thread is read before the engineer's message is saved, and the model gets that thread plus the new message once", () => {
    must(x);
    const order = f.calls.order;
    const call = f.model.calls[0] ?? {};
    const sent = JSON.stringify(call.messages ?? []);
    return (
      order.indexOf("listMessages") >= 0 &&
      order.indexOf("listMessages") < order.indexOf("insert:engineer") &&
      same(call.messages, PR.buildHistory(RT_EARLIER, { content: "Why was growth flagged?" })) &&
      sent.split("Why was growth flagged?").length === 2
    );
  });
  t("the system is buildSystem over the pack built from the stored study and the visible findings, with none in focus", () => {
    must(x);
    const packText = X.buildGroundingPack({ request: REC.request, result: REC.result, findings: RT_VISIBLE, dispositions: [] }).text;
    return same(f.model.calls[0]?.system, PR.buildSystem(packText));
  });
  t("the stream: nothing was logged as an error and nothing escaped to Express", () => {
    const r = must(x);
    return errorLogs(r.logs).length === 0 && r.escaped.length === 0;
  });
}

// --- A finding in focus ----------------------------------------------------------------------------------
{
  const f = routerFakes();
  const x = await settle(() =>
    withServer(f.deps, async ({ base }) => {
      const p = await postMessage(base, { content: "Why?", findingId: RT_F1.id.toUpperCase() });
      return { status: p.status, s: await readStream(p) };
    }),
  );
  t("focus: the body's findingId is matched in any case and saved as the visible finding's own id", () => {
    const r = must(x);
    return r.status === 200 && f.calls.insertMessage[0]?.findingId === RT_F1.id;
  });
  t("R12: with a findingId, buildHistory gets that VisibleFinding as focus, and the pack the same finding as focusFindingId", () => {
    must(x);
    const call = f.model.calls[0] ?? {};
    const packText = X.buildGroundingPack({ request: REC.request, result: REC.result, findings: RT_VISIBLE, dispositions: [], focusFindingId: RT_F1.id }).text;
    return same(call.messages, PR.buildHistory(RT_EARLIER, { content: "Why?", focus: RT_F1 })) && same(call.system, PR.buildSystem(packText));
  });
}

// --- A re-run ------------------------------------------------------------------------------------------------
{
  const f = routerFakes({ turns: rerunTurns() });
  const x = await settle(() =>
    withServer(f.deps, async ({ base, logs }) => {
      const p = await postMessage(base, { content: "Use the county's 1.0% (County letter).", findingId: RT_F0.id });
      return { status: p.status, s: await readStream(p), logs };
    }),
  );
  t("a re-run: status, revision, the reply and done, every event a DatumStreamEvent", () => {
    const r = must(x);
    return (
      parsesAsEvents(r.s.events) &&
      same(eventTypes(r.s.events), ["status", "revision", "text", "done"]) &&
      same(r.s.events[1], { type: "revision", projectId: RT_NEW, version: 2, changes: RT_CHANGES })
    );
  });
  t("a re-run: revise gets the resolved firm, the user, this project as the parent, the parsed input and the engineer's message id", () => {
    must(x);
    const c = f.calls.revise[0] ?? {};
    return (
      f.calls.revise.length === 1 &&
      c.firm === RT_FIRM &&
      c.user?.id === RT_USER.id &&
      c.user?.email === RT_USER.email &&
      c.parentId === RT_PROJECT &&
      same(c.input, GROW) &&
      c.messageId === f.ids[0] &&
      typeof c.extras?.log === "function"
    );
  });
  t("a re-run: the Datum message is saved with the revision's id", () => {
    must(x);
    const [datum] = datumRows(f.calls);
    return has(datum, { revisionId: RT_REVISION_ROW, content: "Done: Version 2 uses growth 1.0%.", stopReason: "end_turn" });
  });
}

// --- R17: which finding the log row names ------------------------------------------------------------------
/** Runs one re-run with the body's findingId and the model's, and gives back what revise was told. */
async function rerunNaming(bodyFinding, modelFinding) {
  const input = modelFinding === undefined ? GROW : { ...GROW, findingId: modelFinding };
  const f = routerFakes({ turns: rerunTurns(input) });
  await withServer(f.deps, async ({ base }) => {
    const body = bodyFinding === undefined ? { content: "Use 1.0%." } : { content: "Use 1.0%.", findingId: bodyFinding };
    const p = await postMessage(base, body);
    await readStream(p);
  });
  const c = f.calls.revise[0];
  return c === undefined ? null : { findingId: c.findingId ?? null, clauseId: c.extras?.clauseId ?? null };
}
{
  const x = await settle(async () => ({
    modelVisible: await rerunNaming(RT_F0.id, RT_F1.id),
    modelVisibleUpper: await rerunNaming(undefined, RT_F1.id.toUpperCase()),
    modelHidden: await rerunNaming(RT_F0.id, RT_HIDDEN),
    modelHiddenNoBody: await rerunNaming(undefined, RT_HIDDEN),
    bodyOnly: await rerunNaming(RT_F0.id, undefined),
    neither: await rerunNaming(undefined, undefined),
  }));
  t("R17: the model's findingId is recorded when it is in the visible set, with that finding's clause", () => {
    const r = must(x);
    return same(r.modelVisible, { findingId: RT_F1.id, clauseId: RT_F1.clauseId }) && same(r.modelVisibleUpper, { findingId: RT_F1.id, clauseId: RT_F1.clauseId });
  });
  t("R17: a findingId the model made up or may not see is never recorded: the body's finding is, or none", () => {
    const r = must(x);
    return same(r.modelHidden, { findingId: RT_F0.id, clauseId: RT_F0.clauseId }) && same(r.modelHiddenNoBody, { findingId: null, clauseId: null });
  });
  t("R17: with no findingId from the model, the body's finding is recorded; with neither, none", () => {
    const r = must(x);
    return same(r.bodyOnly, { findingId: RT_F0.id, clauseId: RT_F0.clauseId }) && same(r.neither, { findingId: null, clauseId: null });
  });
}

// --- R15: the re-run's log goes to the request's logger ---------------------------------------------------------
{
  const cause = new Error("engine failed (check)");
  const f = routerFakes({
    turns: rerunTurns(GROW, "The re-run failed; nothing new to open."),
    revise: async (_firm, _user, _parent, _input, _message, _finding, extras) => {
      extras.log(cause, { step: "generate", parentId: RT_PROJECT });
      return { ok: false, error: "The re-run failed, so there is no new version to open." };
    },
  });
  const x = await settle(() =>
    withServer(f.deps, async ({ base, logs }) => {
      const p = await postMessage(base, { content: "Use 1.0%." });
      return { s: await readStream(p), logs };
    }),
  );
  t("R15: the log revise is given writes through req.log.error, with the cause and its context", () => {
    const r = must(x);
    return errorLogs(r.logs).some((l) => l.obj?.err === cause && l.obj?.step === "generate" && l.obj?.parentId === RT_PROJECT && typeof l.msg === "string");
  });
  t("R15: a refused re-run saves the Datum message with no revision", () => {
    const r = must(x);
    return r.s.events.at(-1)?.type === "done" && has(datumRows(f.calls)[0], { revisionId: null });
  });
}

// --- R13: a model failure is logged, and goes nowhere else --------------------------------------------------
{
  const secret = Object.assign(new Error("401 authentication_error: invalid x-api-key sk-ant-check-not-a-key"), { status: 401, headers: { "request-id": "req_check_secret" } });
  const f = routerFakes({ turns: [turnOf([], null, { reject: secret })] });
  const x = await settle(() =>
    withServer(f.deps, async ({ base, logs, escaped }) => {
      const p = await postMessage(base, { content: "Why?" });
      return { s: await readStream(p), logs, escaped };
    }),
  );
  t("R13: result.error is logged through req.log.error, as the error object itself", () => {
    const r = must(x);
    return errorLogs(r.logs).some((l) => l.obj?.err === secret && typeof l.msg === "string");
  });
  t("R13: the engineer gets the plain line and the error event, and the message is saved with stop reason error", () => {
    const r = must(x);
    return (
      parsesAsEvents(r.s.events) &&
      same(eventTypes(r.s.events), ["text", "error", "done"]) &&
      has(datumRows(f.calls)[0], { content: LINE, stopReason: "error", revisionId: null })
    );
  });
  t("R13: nothing of the error reaches the stream or a saved message", () => {
    const r = must(x);
    const saved = JSON.stringify(f.calls.insertMessage);
    return !/sk-ant|x-api-key|authentication_error|req_check_secret/.test(r.s.raw) && !/sk-ant|x-api-key|authentication_error|req_check_secret|"error":/.test(saved) && r.escaped.length === 0;
  });
}

// --- An exception after the headers ----------------------------------------------------------------------------
{
  const f = routerFakes({ insertThrows: "datum" });
  const x = await settle(() =>
    withServer(f.deps, async ({ base, logs, escaped }) => {
      const p = await postMessage(base, { content: "Why?" });
      return { status: p.status, s: await readStream(p), logs, escaped };
    }),
  );
  t("an exception after the headers: the stream sends error, then ends, with no done", () => {
    const r = must(x);
    const types = eventTypes(r.s.events);
    return r.status === 200 && parsesAsEvents(r.s.events) && types.at(-1) === "error" && !types.includes("done") && r.s.failed === null && r.s.endedAt !== null;
  });
  t("an exception after the headers is logged, and its message is not sent", () => {
    const r = must(x);
    return errorLogs(r.logs).some((l) => l.obj?.err instanceof Error && /insert of the datum message failed/.test(l.obj.err.message)) && !/insert of the datum/.test(r.s.raw) && r.escaped.length === 0;
  });
}

// --- Review Focus 5: compression must not hold the reply back ----------------------------------------------------
{
  const slowTurn = () => turnOf(["First words. ", "The rest."], modelMsg([block.text("First words. The rest.")]), { pauseMs: 300 });
  const timing = (s) => {
    const first = s.events.findIndex((e) => e.type === "text");
    return first < 0 || s.endedAt === null ? null : s.endedAt - s.at[first];
  };
  const live = routerFakes({ turns: [slowTurn()] });
  // The control strips both defences, no-transform and the per-event flush, to show the harness sees buffering at all.
  const held = routerFakes({ turns: [slowTurn()] });
  const stripDefences = (_req, res, next) => {
    const setHeader = res.setHeader.bind(res);
    res.setHeader = (name, value) => setHeader(name, String(name).toLowerCase() === "cache-control" ? "no-cache" : value);
    res.flush = () => undefined;
    next();
  };
  const x = await settle(async () => {
    const a = await withServer(live.deps, async ({ base }) => {
      const p = await postMessage(base, { content: "Why?" });
      return { s: await readStream(p), encoding: p.headers.get("content-encoding") };
    });
    const b = await withServer(
      held.deps,
      async ({ base }) => {
        const p = await postMessage(base, { content: "Why?" });
        return { s: await readStream(p), encoding: p.headers.get("content-encoding") };
      },
      { tamper: stripDefences },
    );
    return { live: { ...a, gap: timing(a.s) }, held: { ...b, gap: timing(b.s) } };
  });
  t("Review Focus 5: the first text event reaches the client at least 200 ms before the stream ends (the model pauses 300 ms)", () => {
    const r = must(x);
    return r.live.gap !== null && r.live.gap >= 200 && r.live.s.events.at(-1)?.type === "done";
  });
  t("Review Focus 5 control: with no-transform and the flush both removed, compression gzips the stream and holds the reply to the end", () => {
    const r = must(x);
    return r.held.encoding === "gzip" && r.held.gap !== null && r.held.gap < 100 && r.held.s.events.at(-1)?.type === "done";
  });
}

// --- Review Focus 2: the engineer closes the tab mid-reply ----------------------------------------------------------
{
  const f = routerFakes({
    turns: [turnOf(["Partial ", "answer, ", "then the rest."], modelMsg([block.text("Partial answer, then the rest.")]), { pauseMs: 300 }), explainTurn()],
  });
  const x = await settle(() =>
    withServer(f.deps, async ({ base, logs, escaped }) => {
      const controller = new AbortController();
      const p = await postMessage(base, { content: "Why?" }, { signal: controller.signal });
      const s = await readStream(p, { controller, stopAfter: (_e, n) => n === 1 });
      const saved = await until(() => datumRows(f.calls).length === 1);
      const next = await postMessage(base, { content: "And now?" });
      return { s, saved, nextStatus: next.status, next: await readStream(next), logs, escaped };
    }),
  );
  t("Review Focus 2: the client aborts after the first event, and the server still saves Datum's reply, ending \" (reply cut off)\"", () => {
    const r = must(x);
    const [datum] = datumRows(f.calls);
    // The text so far is "Partial "; its trailing space is not doubled before the note.
    return r.s.stopped && r.saved && has(datum, { content: "Partial (reply cut off)", stopReason: "aborted", revisionId: null, firmId: RT_FIRM.id }) && datum.content.endsWith(" (reply cut off)");
  });
  t("Review Focus 2: the model stream was aborted, and no further model call was made for that message", () => {
    must(x);
    return f.model.streams[0]?.aborts >= 1 && f.model.calls.length === 2;
  });
  t("Review Focus 2: the server does not crash, logs no error and lets nothing escape, and the next request succeeds", () => {
    const r = must(x);
    return errorLogs(r.logs).length === 0 && r.escaped.length === 0 && r.nextStatus === 200 && r.next.events.at(-1)?.type === "done" && datumRows(f.calls).length === 2;
  });
}
{
  // A re-run already started when the tab closes still finishes, and its revision is on the saved message.
  const f = routerFakes({
    turns: rerunTurns(),
    revise: async () => {
      await sleep(300);
      return { ok: true, projectId: RT_NEW, version: 2, changes: RT_CHANGES, revisionId: RT_REVISION_ROW };
    },
  });
  const x = await settle(() =>
    withServer(f.deps, async ({ base, escaped }) => {
      const controller = new AbortController();
      const p = await postMessage(base, { content: "Use 1.0%." }, { signal: controller.signal });
      const s = await readStream(p, { controller, stopAfter: (e) => e.type === "status" });
      const saved = await until(() => datumRows(f.calls).length === 1);
      return { s, saved, escaped };
    }),
  );
  t("Review Focus 2: a re-run begun before the tab closed finishes, and the saved reply carries its revision and the cut-off note", () => {
    const r = must(x);
    const [datum] = datumRows(f.calls);
    // No text had come before the tool call, so the saved reply is the note alone.
    return r.s.stopped && r.saved && f.calls.revise.length === 1 && has(datum, { revisionId: RT_REVISION_ROW, stopReason: "aborted", content: "(reply cut off)" }) && f.model.calls.length === 1 && r.escaped.length === 0;
  });
}

// --- R20: the keep-alive ---------------------------------------------------------------------------------------------
// A reply can go quiet for 30 to 60 s (the engine's network waits, the model's thinking), and proxies drop idle
// connections. The stream sends `: ping` every 15 s; the check runs it every KA_MS.
const KA_MS = 40;
// An interval that cannot fire during a test, so the keep-alive is only cleared by the route's own stops (on leaving,
// and in its finally), never by its own tick finding the stream gone.
const KA_NEVER_MS = 60_000;

/** Records every setInterval of `ms` (only the keep-alive asks for that interval here) and when each is cleared. */
function spyIntervals(ms) {
  const real = { set: globalThis.setInterval, clear: globalThis.clearInterval };
  const made = [];
  globalThis.setInterval = function setIntervalSpy(fn, delay, ...rest) {
    const handle = real.set.call(this, fn, delay, ...rest);
    if (delay === ms) made.push({ handle, at: performance.now(), clearedAt: null });
    return handle;
  };
  globalThis.clearInterval = function clearIntervalSpy(handle) {
    const m = made.find((x) => x.handle === handle);
    if (m && m.clearedAt === null) m.clearedAt = performance.now();
    return real.clear.call(this, handle);
  };
  return {
    made,
    restore() {
      globalThis.setInterval = real.set;
      globalThis.clearInterval = real.clear;
    },
  };
}

/** Middleware (mounted as `tamper`) that records every write to the response, and any made after it closed or ended. */
function watchWrites() {
  const w = { frames: [], closed: false, afterClose: 0, afterEnd: 0 };
  const mw = (_req, res, next) => {
    let ended = false;
    res.on("close", () => {
      w.closed = true;
    });
    const write = res.write;
    const end = res.end;
    res.write = function watchedWrite(chunk, ...rest) {
      if (w.closed) w.afterClose += 1;
      if (ended) w.afterEnd += 1;
      w.frames.push(String(chunk));
      return write.call(this, chunk, ...rest);
    };
    res.end = function watchedEnd(...rest) {
      ended = true;
      return end.apply(this, rest);
    };
    next();
  };
  return { w, mw };
}

t("the keep-alive goes out every 15 s by default (KEEP_ALIVE_MS), as the SSE comment frame `: ping`", () =>
  /const KEEP_ALIVE_MS = 15_?000;/.test(routerCode) && /const KEEP_ALIVE_FRAME = ": ping\\n\\n";/.test(routerCode) && /deps\.keepAliveMs \?\? KEEP_ALIVE_MS/.test(routerCode));
t("the wiring leaves the keep-alive at its default", () => wiringCode.length > 0 && !/keepAliveMs/.test(wiringCode));
{
  const x = await settle(async () => {
    const a = { type: "text", delta: "Hi" };
    const b = { type: "done", messageId: RT_NEW };
    const body = `: ping\n\ndata: ${JSON.stringify(a)}\n\n: ping\n\n: two\n: lines\n\ndata: ${JSON.stringify(b)}\n\n`;
    return { a, b, s: await readStream(new Response(body)) };
  });
  t("the check's SSE reader skips comment frames, as the browser's must: only data frames are events", () => {
    const r = must(x);
    return (
      same(r.s.events, [r.a, r.b]) &&
      same(r.s.order, ["comment", "text", "comment", "comment", "done"]) &&
      same(
        r.s.comments.map((c) => c.text),
        ["ping", "ping", "two\nlines"],
      ) &&
      r.s.failed === null &&
      r.s.rest === ""
    );
  });
}
{
  const f = routerFakes({
    keepAliveMs: KA_MS,
    turns: [turnOf(["Because ", "the growth rate ", "was 2.1%."], modelMsg([block.thinking(), block.text("Because the growth rate was 2.1%.")]), { waitMs: 8 * KA_MS })],
  });
  const x = await settle(() =>
    withServer(f.deps, async ({ base }) => {
      const p = await postMessage(base, { content: "Why?" });
      return { s: await readStream(p) };
    }),
  );
  t("R20: a model silent for several keep-alive intervals: `: ping` comment frames arrive before its first text event", () => {
    const r = must(x);
    const firstText = r.s.order.indexOf("text");
    return firstText >= 1 && r.s.order.slice(0, firstText).every((k) => k === "comment") && r.s.comments.length >= 2 && r.s.comments.every((c) => c.text === "ping") && r.s.raw.includes(": ping\n\n");
  });
  t("R20: with the pings skipped, the stream parses into the same DatumStreamEvent sequence as without them", () => {
    const r = must(x);
    return (
      parsesAsEvents(r.s.events) &&
      same(eventTypes(r.s.events), ["text", "text", "text", "done"]) &&
      joinedDeltas(r.s.events) === "Because the growth rate was 2.1%." &&
      same(r.s.events.at(-1), { type: "done", messageId: f.ids[1] }) &&
      r.s.rest === ""
    );
  });
}
{
  const spy = spyIntervals(KA_MS);
  const watch = watchWrites();
  const f = routerFakes({ keepAliveMs: KA_MS, turns: [turnOf(["Slow ", "reply."], modelMsg([block.text("Slow reply.")]), { pauseMs: 6 * KA_MS })] });
  const x = await settle(async () => {
    try {
      return await withServer(
        f.deps,
        async ({ base }) => {
          const p = await postMessage(base, { content: "Why?" });
          const s = await readStream(p);
          // Long enough for a keep-alive left running to fire several times.
          await sleep(5 * KA_MS);
          return { s };
        },
        { tamper: watch.mw },
      );
    } finally {
      spy.restore();
    }
  });
  t("R20: pings go out between the events while a reply is slow", () => {
    const r = must(x);
    return r.s.order.slice(r.s.order.indexOf("text"), r.s.order.lastIndexOf("text")).includes("comment");
  });
  t("R20: nothing is written after done, not even a ping", () => {
    const r = must(x);
    const doneFrame = watch.w.frames.findIndex((fr) => fr.startsWith("data: ") && fr.includes('"type":"done"'));
    return r.s.order.at(-1) === "done" && doneFrame >= 0 && doneFrame === watch.w.frames.length - 1 && watch.w.afterEnd === 0 && spy.made.length === 1;
  });
}
{
  const spy = spyIntervals(KA_NEVER_MS);
  const f = routerFakes({ keepAliveMs: KA_NEVER_MS });
  const x = await settle(async () => {
    try {
      return await withServer(f.deps, async ({ base }) => {
        const p = await postMessage(base, { content: "Why?" });
        const s = await readStream(p);
        return { s, endedAt: performance.now() };
      });
    } finally {
      spy.restore();
    }
  });
  t("R20: the keep-alive is cleared by the route when the stream ends, not left to find the stream gone on its next tick", () => {
    const r = must(x);
    return r.s.order.at(-1) === "done" && spy.made.length === 1 && spy.made[0].clearedAt !== null && spy.made[0].clearedAt <= r.endedAt;
  });
}
{
  const spy = spyIntervals(KA_NEVER_MS);
  let reviseDoneAt = null;
  const f = routerFakes({
    keepAliveMs: KA_NEVER_MS,
    turns: rerunTurns(),
    revise: async () => {
      await sleep(8 * KA_MS);
      reviseDoneAt = performance.now();
      return { ok: true, projectId: RT_NEW, version: 2, changes: RT_CHANGES, revisionId: RT_REVISION_ROW };
    },
  });
  const x = await settle(async () => {
    try {
      return await withServer(
        f.deps,
        async ({ base, escaped }) => {
          const controller = new AbortController();
          const p = await postMessage(base, { content: "Use 1.0%." }, { signal: controller.signal });
          const s = await readStream(p, { controller, stopAfter: (e) => e.type === "status" });
          const saved = await until(() => datumRows(f.calls).length === 1);
          return { s, saved, escaped };
        },
      );
    } finally {
      spy.restore();
    }
  });
  t("R20: the keep-alive is cleared when the engineer leaves, while the re-run in flight is still running", () => {
    const r = must(x);
    return r.s.stopped && r.saved && spy.made.length === 1 && spy.made[0].clearedAt !== null && reviseDoneAt !== null && spy.made[0].clearedAt < reviseDoneAt && r.escaped.length === 0;
  });
}
{
  // The same leaving, with pings going out every KA_MS while the re-run runs on.
  const watch = watchWrites();
  const f = routerFakes({
    keepAliveMs: KA_MS,
    turns: rerunTurns(),
    revise: async () => {
      await sleep(8 * KA_MS);
      return { ok: true, projectId: RT_NEW, version: 2, changes: RT_CHANGES, revisionId: RT_REVISION_ROW };
    },
  });
  const x = await settle(() =>
    withServer(
      f.deps,
      async ({ base, escaped }) => {
        const controller = new AbortController();
        const p = await postMessage(base, { content: "Use 1.0%." }, { signal: controller.signal });
        const s = await readStream(p, { controller, stopAfter: (e) => e.type === "status" });
        const saved = await until(() => datumRows(f.calls).length === 1);
        await sleep(5 * KA_MS);
        return { s, saved, escaped };
      },
      { tamper: watch.mw },
    ),
  );
  t("R20: nothing is written to the response after the client has gone, though the re-run and the keep-alive's interval ran on", () => {
    const r = must(x);
    return r.s.stopped && r.saved && watch.w.closed && watch.w.afterClose === 0 && r.escaped.length === 0;
  });
}

// --- R13: the route's own wrappers log, and the pre-header failures are a generic 500 ---------------------------------
const POST_FAILED_LINE = "Datum couldn't take that message just now. Try again in a moment.";
const READ_FAILED_LINE = "Failed to load the Datum chat.";
/** Nothing of a thrown value's message in the stream, the saved rows or what the model was sent. */
const leaksNothing = (re, { s, f }) =>
  !re.test(s?.raw ?? "") && !re.test(JSON.stringify(f.calls.insertMessage)) && f.model.calls.every((c) => !re.test(JSON.stringify(c.messages ?? [])));
{
  // read_study_path throws inside the route's readPath wrapper: a getter on a result key the pack never reads.
  const trap = new Error("read trap (check): stored-path-secret");
  const trapped = { ...REC.result };
  Object.defineProperty(trapped, "checkTrap", {
    enumerable: true,
    get() {
      throw trap;
    },
  });
  const f = routerFakes({
    project: { ...RT_STORED, resultPayload: trapped },
    turns: [
      turnOf([], modelMsg([block.thinking(), readUse("tu_read_trap", "result.checkTrap")], "tool_use")),
      turnOf(["I could not read that value."], modelMsg([block.text("I could not read that value.")])),
    ],
  });
  const x = await settle(() =>
    withServer(f.deps, async ({ base, logs, escaped }) => {
      const p = await postMessage(base, { content: "What is stored there?" });
      return { s: await readStream(p), logs, escaped };
    }),
  );
  t("R13: a read_study_path that throws is logged by the route's readPath wrapper as datum-chat.read_path_failed, with the thrown value", () => {
    const r = must(x);
    return errorLogs(r.logs).some((l) => l.msg === "datum-chat.read_path_failed" && l.obj?.err === trap && l.obj?.path === "result.checkTrap");
  });
  t("R13: the model is answered with an is_error tool_result, and the thrown message reaches no event, saved row or model message", () => {
    const r = must(x);
    return (
      resultFor(f.model.calls[1], "tu_read_trap")?.is_error === true &&
      r.s.events.at(-1)?.type === "done" &&
      leaksNothing(/stored-path-secret|read trap/, { s: r.s, f }) &&
      r.escaped.length === 0
    );
  });
}
{
  const boom = new Error("revise wiring broke (check): internal-secret");
  const f = routerFakes({
    turns: rerunTurns(GROW, "The re-run did not go through."),
    revise: async () => {
      throw boom;
    },
  });
  const x = await settle(() =>
    withServer(f.deps, async ({ base, logs, escaped }) => {
      const p = await postMessage(base, { content: "Use 1.0%." });
      return { s: await readStream(p), logs, escaped };
    }),
  );
  t("R13: a revise dep that throws is logged by the route's revise wrapper as datum-chat.revise_threw, with the thrown value", () => {
    const r = must(x);
    return f.calls.revise.length === 1 && errorLogs(r.logs).some((l) => l.msg === "datum-chat.revise_threw" && l.obj?.err === boom);
  });
  t("R13: the model gets an is_error tool_result, no revision is sent or saved, and the thrown message reaches no event, saved row or model message", () => {
    const r = must(x);
    return (
      resultFor(f.model.calls[1], "tu_rt_1")?.is_error === true &&
      !eventTypes(r.s.events).includes("revision") &&
      r.s.events.at(-1)?.type === "done" &&
      has(datumRows(f.calls)[0], { revisionId: null }) &&
      leaksNothing(/internal-secret|wiring broke/, { s: r.s, f }) &&
      r.escaped.length === 0
    );
  });
}
{
  const f = routerFakes({ insertThrows: "engineer" });
  const x = await settle(() =>
    withServer(f.deps, async ({ base, logs, escaped }) => {
      const p = await postMessage(base, { content: "Why?" });
      return { status: p.status, type: p.headers.get("content-type"), body: await jsonOf(p), logs, escaped };
    }),
  );
  t("a failure before the headers (the engineer's message cannot be saved) is a 500 with the generic line, as JSON, not a stream", () => {
    const r = must(x);
    return r.status === 500 && /^application\/json/.test(r.type ?? "") && same(r.body, { error: POST_FAILED_LINE }) && r.escaped.length === 0;
  });
  t("that failure is logged as datum-chat.post_failed with the thrown error, and nothing went to the model or was saved as Datum's", () => {
    const r = must(x);
    return (
      errorLogs(r.logs).some((l) => l.msg === "datum-chat.post_failed" && l.obj?.err instanceof Error && /insert of the engineer message failed/.test(l.obj.err.message)) &&
      f.model.calls.length === 0 &&
      datumRows(f.calls).length === 0
    );
  });
}
{
  const cause = new Error("lineage read failed (check): db-secret");
  const f = routerFakes({ lineageThrows: cause });
  const x = await settle(() =>
    withServer(f.deps, async ({ base, logs, escaped }) => {
      const g = await getThread(base);
      return { status: g.status, body: await jsonOf(g), logs, escaped };
    }),
  );
  t("a GET that fails is a 500 with the generic line, logged as datum-chat.read_failed with the thrown value", () => {
    const r = must(x);
    return (
      r.status === 500 &&
      same(r.body, { error: READ_FAILED_LINE }) &&
      errorLogs(r.logs).some((l) => l.msg === "datum-chat.read_failed" && l.obj?.err === cause) &&
      !/db-secret/.test(JSON.stringify(r.body)) &&
      r.escaped.length === 0
    );
  });
}

// --- The owner's live smoke script, the env example and the dependency ------------------------------------------------
const smokeSrc = read(SMOKE_REL);
const serverPackage = (() => {
  try {
    return JSON.parse(read(SERVER_PACKAGE_REL));
  } catch {
    return {};
  }
})();
t("@anthropic-ai/sdk is a dependency of tis-api-server", () => typeof serverPackage.dependencies?.["@anthropic-ai/sdk"] === "string");
t("datum-chat-live-smoke.mjs is in no package script, so no check ever runs it", () => smokeSrc.length > 0 && Object.values(serverPackage.scripts ?? {}).every((s) => !String(s).includes("datum-chat-live-smoke")));
t("the smoke script exits 2 with a message when the key is unset, before anything loads the SDK", () => {
  const code = stripComments(smokeSrc);
  const guard = code.search(/if \(!process\.env\.ANTHROPIC_API_KEY\) \{/);
  const exit = code.indexOf("process.exit(2)");
  const load = code.search(/import\("@anthropic-ai\/sdk"\)|getDatumClient\(|client\.ts/);
  return guard >= 0 && exit > guard && load > exit && /console\.error\(/.test(code.slice(guard, exit));
});
t("the smoke script sends the real tools and the real system over scenario-base.json, and prints the stop reason and token counts", () =>
  [/RERUN_TOOL/, /READ_PATH_TOOL/, /buildSystem/, /scenario-base\.json/, /stop reason/i, /input tokens/i, /output tokens/i].every((re) => re.test(smokeSrc)));
const envExample = read(".env.example");
t(".env.example has the line ANTHROPIC_API_KEY= under a comment saying the chat is off when it is unset", () => {
  const lines = envExample.split("\n");
  const i = lines.indexOf("ANTHROPIC_API_KEY=");
  const comment = [];
  for (let j = i - 1; j >= 0 && lines[j].startsWith("#"); j--) comment.unshift(lines[j]);
  const text = comment.join(" ");
  return i > 0 && /\boff\b/i.test(text) && /\bunset\b/i.test(text);
});
t("the router, the wiring, the client and the smoke script contain none of the phrases the product never writes", () =>
  [routerSrc, wiringSrc, clientSrc, smokeSrc].every((s) => s.length > 0 && bannedFree(s)));

// ===========================================================================
// guards
// ===========================================================================
section("guards");

// The boundary guards. The chat is the one thing in the product that executes, and it may do exactly one thing to a
// study: add a version. These are the static checks that keep it so. They are source-text guards, the weakest kind, so
// each carries its own teeth, as verify-proofread-routes.mjs does: a mutation applied to the in-memory source must turn
// that guard red by name, and a negative control (code that must stay allowed) must leave every guard green. A guard
// no mutation can turn red fails the run.
//
// The TypeScript parser (the parser only, never the type checker) reads the chat files, so a comment, a Set's
// `delete` and the FOR UPDATE row lock are never mistaken for a write, and a write split over lines, aliased or
// destructured is not missed. `typescript` is a root devDependency and resolves from scripts/.
{
  const TYPES_REL = "artifacts/tis-api-server/src/lib/proofread/types.ts";
  const CHAT_SPEC_REL = "docs/superpowers/specs/2026-10-20-datum-chat-design.md";
  const PRODUCT_SPEC_REL = "docs/superpowers/specs/2026-09-29-datum-in-product-design.md";
  const LIB_DIR_REL = "artifacts/tis-api-server/src/lib/datum-chat";
  const ROUTES_DIR_REL = "artifacts/tis-api-server/src/routes";
  const REVISIONS_REL = "artifacts/tis-api-server/src/lib/study-revisions.ts";
  const STORE_REL = `${LIB_DIR_REL}/store.ts`;
  const REVISE_FILE_REL = `${LIB_DIR_REL}/revise.ts`;

  let TS = null;
  try {
    TS = (await import("typescript")).default;
  } catch (e) {
    ok("precondition: typescript resolves from scripts/ under plain node, so the guards read syntax, not text", false, e instanceof Error ? e.message : String(e));
  }
  const parse = (rel, text) => {
    if (TS === null) throw new Error("typescript did not load");
    return TS.createSourceFile(rel, text, TS.ScriptTarget.ES2022, true, TS.ScriptKind.TS);
  };
  const walk = (node, visit) => {
    visit(node);
    TS.forEachChild(node, (child) => walk(child, visit));
  };
  const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  /** The chat files: everything under lib/datum-chat/, routes/datum-chat*.ts, and lib/study-revisions.ts. */
  const listTs = (dirRel, { recursive, keep }) => {
    try {
      return readdirSync(path.join(repo, dirRel), { recursive })
        .map(String)
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && keep(f))
        .sort()
        .map((f) => `${dirRel}/${f}`);
    } catch (e) {
      ok(`precondition: ${dirRel} is listable`, false, e instanceof Error ? e.message : String(e));
      return [];
    }
  };
  const CHAT_FILE_RELS = [
    ...listTs(LIB_DIR_REL, { recursive: true, keep: () => true }),
    ...listTs(ROUTES_DIR_REL, { recursive: false, keep: (f) => f.startsWith("datum-chat") }),
    REVISIONS_REL,
  ];
  const EXPECTED_CHAT_FILES = [
    ...["contract", "tools", "clause-guide", "context", "prompt", "run", "revise", "store", "client"].map((n) => `${LIB_DIR_REL}/${n}.ts`),
    ROUTER_REL,
    WIRING_REL,
    REVISIONS_REL,
  ];
  ok(
    "precondition: the chat file set holds all twelve known files, so no guard runs over an empty glob",
    EXPECTED_CHAT_FILES.every((f) => CHAT_FILE_RELS.includes(f)),
    `missing: ${EXPECTED_CHAT_FILES.filter((f) => !CHAT_FILE_RELS.includes(f)).join(", ")}`,
  );

  const world = {
    chat: new Map(CHAT_FILE_RELS.map((rel) => [rel, read(rel)])),
    chatSpec: read(CHAT_SPEC_REL),
    productSpec: read(PRODUCT_SPEC_REL),
    types: read(TYPES_REL),
    /** The contract's allowlist, as lib/tis-api-zod exports it. */
    revisable: Array.isArray(C.REVISABLE_FIELDS) ? [...C.REVISABLE_FIELDS] : [],
  };

  // --- Expression helpers --------------------------------------------------------------------------------
  const peel = (e) => {
    while (e && (TS.isParenthesizedExpression(e) || TS.isNonNullExpression(e) || TS.isAsExpression(e) || TS.isAwaitExpression(e) || TS.isSatisfiesExpression(e) || TS.isTypeAssertionExpression(e))) e = e.expression;
    return e;
  };
  /** The leftmost identifier of `a.b[c](d).e`, or null (`this`, a literal, `new X()`). */
  const rootName = (e) => {
    e = peel(e);
    while (e) {
      if (TS.isIdentifier(e)) return e.text;
      if (TS.isPropertyAccessExpression(e) || TS.isElementAccessExpression(e) || TS.isCallExpression(e)) e = peel(e.expression);
      else return null;
    }
    return null;
  };
  const lastName = (e) => {
    e = peel(e);
    if (TS.isIdentifier(e)) return e.text;
    if (TS.isPropertyAccessExpression(e)) return e.name.text;
    return null;
  };
  /** `x.name` and `x["name"]`: the member's name, or null for a computed one. */
  const memberName = (n) => {
    if (TS.isPropertyAccessExpression(n)) return n.name.text;
    if (TS.isElementAccessExpression(n) && n.argumentExpression && (TS.isStringLiteral(n.argumentExpression) || TS.isNoSubstitutionTemplateLiteral(n.argumentExpression))) return n.argumentExpression.text;
    return null;
  };
  /** A call's method: `recv.name(...)`. */
  const methodOf = (call) => {
    const callee = peel(call.expression);
    const name = TS.isPropertyAccessExpression(callee) || TS.isElementAccessExpression(callee) ? memberName(callee) : null;
    return name === null ? null : { name, recv: callee.expression };
  };

  /**
   * What holds a database handle, and what is a study table, in one file. Handles: whatever the file imports from
   * @workspace/db that is not a table (`db`), the parameters of a `.transaction(...)` callback (`tx`), and a
   * variable assigned straight from a handle (`const h = tx`). `isHandleLike` also answers true for a member named
   * db, tx, trx, txn or database (`deps.db`), because a handle that arrives by injection is imported nowhere.
   * Tables: the names this repo gives the study tables, wherever they are imported from or aliased to. An in-memory
   * Set or Map named anything else is neither, so `inFlight.delete(key)` is not a database write.
   */
  const HANDLE_NAMES = new Set(["db", "tx", "trx", "txn", "database"]);
  const STUDY_TABLE_IDENT = /^(?:tisProjectsTable|studyRevisionsTable|studyProofread\w*Table)$/;
  function dbInfo(sf) {
    const handles = new Set();
    const namespaces = new Set();
    /** local name -> the table's own name */
    const tables = new Map();
    walk(sf, (n) => {
      if (!(TS.isImportDeclaration(n) && TS.isStringLiteral(n.moduleSpecifier) && n.importClause)) return;
      const c = n.importClause;
      const fromDb = n.moduleSpecifier.text.startsWith("@workspace/db");
      if (fromDb && c.name) handles.add(c.name.text);
      if (!c.namedBindings) return;
      if (TS.isNamespaceImport(c.namedBindings)) {
        if (fromDb) {
          handles.add(c.namedBindings.name.text);
          namespaces.add(c.namedBindings.name.text);
        }
        return;
      }
      for (const el of c.namedBindings.elements) {
        const imported = (el.propertyName ?? el.name).text;
        if (STUDY_TABLE_IDENT.test(imported)) tables.set(el.name.text, imported);
        else if (fromDb && !/Table$/.test(imported)) handles.add(el.name.text);
      }
    });
    const isHandleLike = (e) => {
      const root = rootName(e);
      const last = lastName(e);
      return (root !== null && handles.has(root)) || (last !== null && HANDLE_NAMES.has(last));
    };
    const tableOf = (e) => {
      e = peel(e);
      if (TS.isIdentifier(e)) return tables.get(e.text) ?? (STUDY_TABLE_IDENT.test(e.text) ? e.text : null);
      if (TS.isPropertyAccessExpression(e)) {
        const r = peel(e.expression);
        if (STUDY_TABLE_IDENT.test(e.name.text) || (TS.isIdentifier(r) && namespaces.has(r.text))) return e.name.text;
      }
      return null;
    };
    for (let round = 0; round < 4; round++) {
      let grew = false;
      walk(sf, (n) => {
        if (TS.isCallExpression(n)) {
          const m = methodOf(n);
          if (m && m.name === "transaction" && isHandleLike(m.recv)) {
            for (const a of n.arguments) {
              if (!(TS.isArrowFunction(a) || TS.isFunctionExpression(a))) continue;
              for (const p of a.parameters) {
                if (TS.isIdentifier(p.name) && !handles.has(p.name.text)) {
                  handles.add(p.name.text);
                  grew = true;
                }
              }
            }
          }
        }
        if (TS.isVariableDeclaration(n) && TS.isIdentifier(n.name) && n.initializer) {
          const init = peel(n.initializer);
          if (!(TS.isIdentifier(init) || TS.isPropertyAccessExpression(init))) return;
          if (isHandleLike(init) && !handles.has(n.name.text)) {
            handles.add(n.name.text);
            grew = true;
          }
          const table = tableOf(init);
          if (table !== null && !tables.has(n.name.text)) {
            tables.set(n.name.text, table);
            grew = true;
          }
        }
      });
      if (!grew) break;
    }
    return { isHandleLike, tableOf };
  }

  /** Every string and template in a file, with each `${expr}` kept as written, so `update ${tisProjectsTable}` reads as SQL. */
  function sqlTexts(sf) {
    const out = [];
    walk(sf, (n) => {
      if (TS.isStringLiteral(n) || TS.isNoSubstitutionTemplateLiteral(n)) out.push({ text: n.text, node: n });
      else if (TS.isTemplateExpression(n)) {
        let s = n.head.text;
        for (const span of n.templateSpans) s += ` \${${span.expression.getText(sf)}} ${span.literal.text}`;
        out.push({ text: s, node: n });
      }
    });
    return out;
  }
  /** A study table by its SQL name, or an interpolation (whose target the guard cannot read, so it does not trust). */
  const STUDY_SQL_TABLE = String.raw`(?:only\s+)?(?:"?public"?\.)?(?:"?(?:tis_projects|study_revisions|study_proofread_[a-z_]+)\b|\$\{)`;
  const RAW_WRITE = new RegExp(String.raw`\b(?:update|delete\s+from|truncate(?:\s+table)?)\s+${STUDY_SQL_TABLE}`, "i");

  /** Run `fn(rel, sf, flag)` over every file; `flag(node, what)` records `rel:line what`. A file that will not parse is a violation. */
  const eachChatFile = (files, fn) => {
    const out = [];
    for (const [rel, text] of files) {
      let sf;
      try {
        sf = parse(rel, text);
      } catch (e) {
        out.push(`${rel}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      fn(rel, sf, (node, what) => out.push(`${rel}:${lineOf(sf, node)} ${what}`));
    }
    return out;
  };

  // --- chat-never-mutates-studies ---------------------------------------------------------------------------
  // The chat adds versions and never edits or removes a row. Drizzle: an `update` or `delete` member of a database
  // handle (called, passed on, or taken off it by destructuring), an `update(...)`/`delete(...)` call on a study
  // table, and an insert that rewrites on conflict. Raw SQL: update, delete from or truncate on tis_projects,
  // study_revisions or a study_proofread_* table, or on a target the guard cannot read (an interpolation). The row
  // lock (`.for("update")`, `for update`), count/max reads, and a Set's or Map's own `delete` are none of those.
  function chatMutations(files) {
    return eachChatFile(files, (rel, sf, flag) => {
      const { isHandleLike, tableOf } = dbInfo(sf);
      const flagged = new Set();
      const once = (node, what) => {
        const at = node.getStart(sf);
        if (flagged.has(at)) return;
        flagged.add(at);
        flag(node, what);
      };
      walk(sf, (n) => {
        if (TS.isPropertyAccessExpression(n) || TS.isElementAccessExpression(n)) {
          const name = memberName(n);
          if ((name === "update" || name === "delete") && isHandleLike(n.expression)) once(n, `${flat(n.getText(sf))} is a write on a database handle`);
          if (name === "onConflictDoUpdate" || name === "onDuplicateKeyUpdate") once(n, `${name} rewrites a row`);
        }
        if (TS.isCallExpression(n)) {
          const m = methodOf(n);
          if (m && (m.name === "update" || m.name === "delete") && n.arguments.length > 0 && tableOf(n.arguments[0]) !== null) {
            once(peel(n.expression), `.${m.name}(${flat(n.arguments[0].getText(sf))}) writes a study table`);
          }
        }
        if (TS.isVariableDeclaration(n) && TS.isObjectBindingPattern(n.name) && n.initializer && isHandleLike(n.initializer)) {
          for (const el of n.name.elements) {
            const key = el.propertyName ?? el.name;
            const k = TS.isIdentifier(key) || TS.isStringLiteral(key) ? key.text : null;
            if (k === "update" || k === "delete") once(el, `${k} is taken off a database handle`);
          }
        }
      });
      for (const { text, node } of sqlTexts(sf)) if (RAW_WRITE.test(text)) once(node, `raw SQL writes a study table: ${flat(text).slice(0, 70)}`);
    });
  }

  // --- only-study-revisions-inserts-projects ----------------------------------------------------------------
  // The one place a version is made. An insert into tis_projects (through the table, an alias or a renamed import,
  // or raw SQL) may appear in lib/study-revisions.ts and in no other chat file, and must appear there, or the guard
  // would pass with no version-maker at all.
  const RAW_PROJECT_INSERT_HIT = /\binsert\s+into\s+(?:only\s+)?(?:"?public"?\.)?(?:"?tis_projects\b|\$\{\s*tisProjectsTable\s*\})/i;
  function projectInserts(files) {
    let inRevisions = 0;
    const out = eachChatFile(files, (rel, sf, flag) => {
      const { tableOf } = dbInfo(sf);
      const hit = (node, what) => {
        if (rel === REVISIONS_REL) inRevisions++;
        else flag(node, what);
      };
      walk(sf, (n) => {
        if (!TS.isCallExpression(n)) return;
        const m = methodOf(n);
        if (m && m.name === "insert" && n.arguments.length > 0 && tableOf(n.arguments[0]) === "tisProjectsTable") hit(n, "inserts into tis_projects");
      });
      for (const { text, node } of sqlTexts(sf)) if (RAW_PROJECT_INSERT_HIT.test(text)) hit(node, `raw SQL inserts into tis_projects: ${flat(text).slice(0, 60)}`);
    });
    if (inRevisions === 0) out.push(`${REVISIONS_REL} does not insert into tis_projects, so the one place a version is made is gone`);
    return out;
  }

  // --- allowlist-matches-spec -------------------------------------------------------------------------------
  // Only the paragraph that starts `**Fields the chat may change**` and runs to the next blank line is read: the
  // paragraph after it backticks GenerateTisBody and names no field.
  function allowlistDiff(w) {
    const lines = w.chatSpec.split("\n");
    const starts = lines.flatMap((l, i) => (l.startsWith("**Fields the chat may change**") ? [i] : []));
    if (starts.length !== 1) return [`the chat spec has ${starts.length} paragraphs that start with "**Fields the chat may change**", wanted 1`];
    let end = starts[0];
    while (end < lines.length && lines[end].trim() !== "") end++;
    const paragraph = lines.slice(starts[0], end).join(" ");
    const inSpec = new Set([...paragraph.matchAll(/`([^`]+)`/g)].map((m) => m[1]));
    const inContract = new Set(w.revisable.filter((f) => f !== "removeGrowthOverride"));
    const out = [];
    if (inSpec.size === 0) out.push("the spec's paragraph names no field");
    const onlySpec = [...inSpec].filter((f) => !inContract.has(f));
    const onlyContract = [...inContract].filter((f) => !inSpec.has(f));
    if (onlySpec.length) out.push(`in the spec's paragraph, not in REVISABLE_FIELDS: ${onlySpec.join(", ")}`);
    if (onlyContract.length) out.push(`in REVISABLE_FIELDS, not in the spec's paragraph: ${onlyContract.join(", ")}`);
    return out;
  }

  // --- revise-never-charges -------------------------------------------------------------------------------
  // A version is the same study revised (the site, land use and size are locked), so it takes no study slot.
  // Identifiers and strings are read, never comments.
  const CHARGE_NAMES = ["reserveStudySlot", "releaseStudySlot"];
  function chargesFound(files) {
    return eachChatFile(files, (rel, sf, flag) => {
      walk(sf, (n) => {
        if (TS.isIdentifier(n) && CHARGE_NAMES.includes(n.text)) flag(n, `names ${n.text}`);
      });
      for (const { text, node } of sqlTexts(sf)) if (CHARGE_NAMES.some((c) => text.includes(c))) flag(node, "names a slot function in a string");
    });
  }

  // --- client-lazy ------------------------------------------------------------------------------------------
  // Task 7's static check on client.ts (ruling R4), now named and with teeth; its runtime twin is in the router
  // section, which loads the client with the SDK's name hooked and sees it never resolved. With no key nothing may
  // load the SDK, so the only static import of it is `import type` (every compiler erases it) and the one real load
  // is a dynamic import inside a function. A value import, a bare import, a re-export, a require() and a dynamic
  // import that runs at module load are each an eager load.
  const SDK_PACKAGE = "@anthropic-ai/sdk";
  const isSdk = (spec) => spec === SDK_PACKAGE || spec.startsWith(`${SDK_PACKAGE}/`);
  const insideFunction = (n) => {
    for (let p = n.parent; p; p = p.parent) if (TS.isFunctionLike(p)) return true;
    return false;
  };
  function clientEagerSdk(files) {
    const text = files.get(CLIENT_REL);
    if (typeof text !== "string" || text.length === 0) return [`${CLIENT_REL} is missing`];
    const sf = parse(CLIENT_REL, text);
    const out = [];
    const bad = (node, what) => out.push(`line ${lineOf(sf, node)}: ${what}`);
    walk(sf, (n) => {
      if (TS.isImportDeclaration(n) && TS.isStringLiteral(n.moduleSpecifier) && isSdk(n.moduleSpecifier.text) && n.importClause?.isTypeOnly !== true) bad(n, "a value import of the SDK");
      if (TS.isExportDeclaration(n) && n.moduleSpecifier && TS.isStringLiteral(n.moduleSpecifier) && isSdk(n.moduleSpecifier.text) && !n.isTypeOnly) bad(n, "a re-export of the SDK");
      if (TS.isImportEqualsDeclaration(n) && TS.isExternalModuleReference(n.moduleReference) && TS.isStringLiteral(n.moduleReference.expression) && isSdk(n.moduleReference.expression.text) && !n.isTypeOnly) bad(n, "an import = require() of the SDK");
      if (TS.isCallExpression(n)) {
        if (TS.isIdentifier(n.expression) && n.expression.text === "require") bad(n, "a require() call");
        const arg = n.arguments[0];
        if (n.expression.kind === TS.SyntaxKind.ImportKeyword && arg && TS.isStringLiteral(arg) && isSdk(arg.text) && !insideFunction(n)) bad(n, "a dynamic import of the SDK that runs when the module loads");
      }
    });
    return out;
  }

  // --- store-reads-proofread-only ---------------------------------------------------------------------------
  // store.ts reaches the proofread's data through one reader, latestRunForProject, and through nothing else that
  // could write it: one import declaration from proofread-store, by name, of that name alone; no value import of any
  // other proofread module (a type import is erased); no proofread table from the db; no dynamic import or require
  // of a proofread module.
  const PROOFREAD_STORE = /(?:^|\/)proofread-store(?:\.ts)?$/;
  const PROOFREAD_MODULE = /(?:^|\/)proofread[^/]*(?:\/|$)/;
  function storeImports(files) {
    const text = files.get(STORE_REL);
    if (typeof text !== "string" || text.length === 0) return [`${STORE_REL} is missing`];
    const sf = parse(STORE_REL, text);
    const out = [];
    const names = [];
    let fromStore = 0;
    const bad = (node, what) => out.push(`line ${lineOf(sf, node)}: ${what}`);
    const literal = (n) => n && (TS.isStringLiteral(n) || TS.isNoSubstitutionTemplateLiteral(n));
    walk(sf, (n) => {
      if (TS.isImportDeclaration(n) && TS.isStringLiteral(n.moduleSpecifier)) {
        const spec = n.moduleSpecifier.text;
        const c = n.importClause;
        if (PROOFREAD_STORE.test(spec)) {
          fromStore++;
          const nb = c?.namedBindings;
          if (!c || c.name || !nb || TS.isNamespaceImport(nb)) bad(n, "proofread-store is imported other than by name");
          else names.push(...nb.elements.map((el) => (el.propertyName ?? el.name).text));
        } else if (PROOFREAD_MODULE.test(spec) && c?.isTypeOnly !== true) {
          bad(n, `a value import of ${spec}`);
        }
        if (spec.startsWith("@workspace/db") && c?.namedBindings && TS.isNamedImports(c.namedBindings)) {
          for (const el of c.namedBindings.elements) {
            const imported = (el.propertyName ?? el.name).text;
            if (/^studyProofread/.test(imported)) bad(el, `${imported} is imported from the db, so the store would reach the proofread's rows itself`);
          }
        }
      }
      if (TS.isCallExpression(n) && (n.expression.kind === TS.SyntaxKind.ImportKeyword || (TS.isIdentifier(n.expression) && n.expression.text === "require")) && literal(n.arguments[0]) && PROOFREAD_MODULE.test(n.arguments[0].text)) {
        bad(n, `${n.arguments[0].text} is loaded by import() or require()`);
      }
    });
    if (fromStore !== 1) out.push(`store.ts has ${fromStore} import declarations from proofread-store, wanted 1`);
    if (!same(names, ["latestRunForProject"])) out.push(`store.ts imports [${names.join(", ")}] from proofread-store, wanted [latestRunForProject]`);
    return out;
  }

  // --- types-header-names-chat and spec-addendum-names-chat ---------------------------------------------------
  const flat = (s) => s.replace(/\s+/g, " ").trim();
  /** The spec's exact sentence (Docs, in the chat spec), which is also the header of proofread/types.ts. */
  const HEADER_SENTENCE = "Proofread advises and never writes. The Datum chat changes inputs only when the engineer asks, by making a new version; the original is never changed.";
  const OLD_HEADER_SENTENCE = "Datum advises; it never executes.";
  function typesHeader(w) {
    const out = [];
    const block = w.types.match(/^\s*\/\*\*[\s\S]*?\*\//);
    if (!block) return ["proofread/types.ts has no leading doc comment"];
    const header = flat(block[0].split("\n").map((l) => l.replace(/^\s*(?:\/\*\*|\*\/|\*)\s?/, "")).join(" "));
    if (!header.includes(HEADER_SENTENCE)) out.push("the leading comment of proofread/types.ts does not carry the spec's sentence");
    if (header.includes(OLD_HEADER_SENTENCE)) out.push(`the leading comment of proofread/types.ts still says "${OLD_HEADER_SENTENCE}"`);
    if (!flat(w.chatSpec).includes(HEADER_SENTENCE)) out.push("the chat spec's own sentence for the header is not the one this guard pins");
    return out;
  }
  const CHAT_SPEC_FILE = "2026-10-20-datum-chat-design.md";
  function productSpecAddendum(spec) {
    const at = spec.lastIndexOf("\n## Addendum");
    if (at < 0) return ["the 2026-09-29 spec has no Addendum section"];
    const body = spec.slice(at);
    const out = [];
    if (spec.indexOf("\n## ", at + 1) >= 0) out.push("the Addendum is not the spec's last section");
    if (!body.includes(CHAT_SPEC_FILE)) out.push(`the Addendum does not link ${CHAT_SPEC_FILE}`);
    if (!/only executor/i.test(flat(body))) out.push('the Addendum does not say the Datum chat is the "only executor"');
    if (!bannedFree(body)) out.push("the Addendum uses a phrase the product never writes");
    return out;
  }

  // --- The table -----------------------------------------------------------------------------------------
  const GUARDS = [
    { id: "chat-never-mutates-studies", says: "no chat file calls update or delete on a database handle or study table, and none writes raw SQL update/delete/truncate on tis_projects, study_revisions or a study_proofread_* table", check: (w) => chatMutations(w.chat) },
    { id: "only-study-revisions-inserts-projects", says: "insert(tisProjectsTable) appears in lib/study-revisions.ts and nowhere else in the chat files", check: (w) => projectInserts(w.chat) },
    { id: "allowlist-matches-spec", says: "the backticked names in the spec's \"Fields the chat may change\" paragraph equal REVISABLE_FIELDS minus removeGrowthOverride", check: (w) => allowlistDiff(w) },
    { id: "revise-never-charges", says: "no chat file names reserveStudySlot or releaseStudySlot", check: (w) => chargesFound(w.chat) },
    { id: "client-lazy", says: "client.ts has no top-level value import of @anthropic-ai/sdk: a static import of it is `import type` (erased), and the one dynamic import sits inside a function", check: (w) => clientEagerSdk(w.chat) },
    { id: "store-reads-proofread-only", says: "store.ts imports only latestRunForProject from proofread-store, and nothing else that writes proofread", check: (w) => storeImports(w.chat) },
    { id: "types-header-names-chat", says: "the header of proofread/types.ts carries the chat spec's sentence: the proofread never writes, the chat changes inputs only when asked, by making a new version", check: (w) => typesHeader(w) },
    { id: "spec-addendum-names-chat", says: "the 2026-09-29 spec ends with an Addendum that links the chat spec and names the chat as the only executor", check: (w) => productSpecAddendum(w.productSpec) },
  ];
  const verdicts = (w) =>
    GUARDS.map((g) => {
      try {
        return { id: g.id, bad: g.check(w) };
      } catch (e) {
        return { id: g.id, bad: [`threw: ${e instanceof Error ? e.message : String(e)}`] };
      }
    });
  const redOf = (w) => verdicts(w).filter((v) => v.bad.length > 0).map((v) => v.id);

  for (const v of verdicts(world)) ok(`guard ${v.id}: ${GUARDS.find((g) => g.id === v.id).says}`, v.bad.length === 0, v.bad.join(" | "));

  // --- Teeth and negative controls -------------------------------------------------------------------------
  const edit = (rel, fn) => (w) => {
    if (!w.chat.has(rel)) throw new Error(`${rel} is not a chat file`);
    return { ...w, chat: new Map([...w.chat].map(([r, text]) => [r, r === rel ? fn(text) : text])) };
  };
  const editKey = (key, fn) => (w) => ({ ...w, [key]: fn(w[key]) });
  /** Replace the first `needle`; an anchor that is not there is an error, never a silent no-op. */
  const swap = (needle, replacement) => (text) => {
    if (!text.includes(needle)) throw new Error(`the anchor is not in the file: ${needle}`);
    return text.replace(needle, () => replacement);
  };
  const swapRe = (re, replacement) => (text) => {
    if (!re.test(text)) throw new Error(`the anchor is not in the file: ${re}`);
    return text.replace(re, () => replacement);
  };
  const append = (code) => (text) => `${text}\n${code}\n`;
  const prepend = (code) => (text) => `${code}\n${text}`;
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /** A sentence as it is wrapped in a block comment: any run of spaces, newlines and asterisks between words. */
  const wrapped = (sentence) => new RegExp(sentence.split(" ").map(escapeRe).join("(?:\\s|\\*)+"));

  const UPDATE_STUDY = 'await db.update(tisProjectsTable).set({ projectName: "x" });';
  const TEETH = [
    // chat-never-mutates-studies
    { label: "db.update(tisProjectsTable).set({projectName}) inserted in store.ts", flips: ["chat-never-mutates-studies"], apply: edit(STORE_REL, append(`export async function mutate() { ${UPDATE_STUDY} }`)) },
    { label: "tx.delete(studyRevisionsTable) inserted in study-revisions.ts's transaction", flips: ["chat-never-mutates-studies"], apply: edit(REVISIONS_REL, swap("return { projectId: study!.id, version, revisionId: revision!.id };", "await tx.delete(studyRevisionsTable);\n    return { projectId: study!.id, version, revisionId: revision!.id };")) },
    { label: "a transaction handle aliased (const h = tx) and then h.update(studyProofreadRunsTable)", flips: ["chat-never-mutates-studies"], apply: edit(REVISIONS_REL, swap("return { projectId: study!.id, version, revisionId: revision!.id };", "const h = tx;\n    await h.update(studyProofreadRunsTable).set({});\n    return { projectId: study!.id, version, revisionId: revision!.id };")) },
    { label: "an injected handle: deps.db.delete(...) in revise.ts, which imports no db", flips: ["chat-never-mutates-studies"], apply: edit(REVISE_FILE_REL, append("export async function mutate(deps: { db: { delete(t: unknown): unknown } }) { await deps.db.delete(studyProofreadRunsTable); }")) },
    { label: 'db["delete"](tisProjectsTable): the method named by a string', flips: ["chat-never-mutates-studies"], apply: edit(STORE_REL, append('export async function mutate() { await db["delete"](tisProjectsTable); }')) },
    { label: "const { update } = db: the method taken off the handle", flips: ["chat-never-mutates-studies"], apply: edit(STORE_REL, append("export const { update } = db;")) },
    { label: "an insert into study_revisions that rewrites a row (onConflictDoUpdate)", flips: ["chat-never-mutates-studies"], apply: edit(STORE_REL, append("export async function mutate() { await db.insert(studyRevisionsTable).values({}).onConflictDoUpdate({ target: studyRevisionsTable.id, set: {} }); }")) },
    { label: "raw SQL: sql`update tis_projects set ...` in study-revisions.ts", flips: ["chat-never-mutates-studies"], apply: edit(REVISIONS_REL, append("export const bad = sql`update tis_projects set project_name = 'x'`;")) },
    { label: 'raw SQL, quoted, schema-qualified and upper-case: "DELETE FROM public.\\"study_proofread_findings\\"" in store.ts', flips: ["chat-never-mutates-studies"], apply: edit(STORE_REL, append('export const bad = "DELETE FROM public.\\"study_proofread_findings\\" WHERE true";')) },
    { label: "raw SQL against an interpolated table: sql`update ${tisProjectsTable} set ...`", flips: ["chat-never-mutates-studies"], apply: edit(REVISIONS_REL, append("export const bad = sql`update ${tisProjectsTable} set project_name = 'x'`;")) },
    // only-study-revisions-inserts-projects
    { label: "db.insert(tisProjectsTable) inserted in store.ts", flips: ["only-study-revisions-inserts-projects"], apply: edit(STORE_REL, append("export async function mutate() { await db.insert(tisProjectsTable).values({}); }")) },
    { label: "an insert split over lines in routes/datum-chat.ts", flips: ["only-study-revisions-inserts-projects"], apply: edit(WIRING_REL, append("export async function mutate() {\n  await db\n    .insert(\n      tisProjectsTable,\n    )\n    .values({});\n}")) },
    { label: "an insert through an alias (const projects = tisProjectsTable) in run.ts", flips: ["only-study-revisions-inserts-projects"], apply: edit(`${LIB_DIR_REL}/run.ts`, append("const projects = tisProjectsTable;\nexport async function mutate() { await db.insert(projects).values({}); }")) },
    { label: "an insert through a renamed import (tisProjectsTable as projects) in context.ts", flips: ["only-study-revisions-inserts-projects"], apply: edit(`${LIB_DIR_REL}/context.ts`, append('import { tisProjectsTable as projects } from "@workspace/db";\nexport async function mutate() { await db.insert(projects).values({}); }')) },
    { label: "raw SQL: insert into tis_projects in store.ts", flips: ["only-study-revisions-inserts-projects"], apply: edit(STORE_REL, append('export const bad = "INSERT INTO tis_projects (id) VALUES (1)";')) },
    { label: "study-revisions.ts stops inserting into tis_projects (it inserts into study_revisions twice)", flips: ["only-study-revisions-inserts-projects"], apply: edit(REVISIONS_REL, swap(".insert(tisProjectsTable)", ".insert(studyRevisionsTable)")) },
    // allowlist-matches-spec
    { label: "weather dropped from the contract copy", flips: ["allowlist-matches-spec"], apply: (w) => ({ ...w, revisable: w.revisable.filter((f) => f !== "weather") }) },
    { label: "a locked field (projectName) added to the contract copy", flips: ["allowlist-matches-spec"], apply: (w) => ({ ...w, revisable: [...w.revisable, "projectName"] }) },
    { label: "a field (studyRadiusMi) added to the spec's paragraph", flips: ["allowlist-matches-spec"], apply: editKey("chatSpec", swap("`realLaneGeometry`,", "`realLaneGeometry`, `studyRadiusMi`,")) },
    { label: "the spec's paragraph no longer starts with its bold lead", flips: ["allowlist-matches-spec"], apply: editKey("chatSpec", swap("**Fields the chat may change** (the allowlist)", "**Fields it may change** (the allowlist)")) },
    // revise-never-charges
    { label: "reserveStudySlot called in revise.ts", flips: ["revise-never-charges"], apply: edit(REVISE_FILE_REL, append("export async function charge(firmId: string) { return reserveStudySlot(firmId); }")) },
    { label: "releaseStudySlot imported in study-revisions.ts", flips: ["revise-never-charges"], apply: edit(REVISIONS_REL, prepend('import { releaseStudySlot } from "./firms";')) },
    { label: "reserveStudySlot reached through a string key in routes/datum-chat.ts", flips: ["revise-never-charges"], apply: edit(WIRING_REL, append('export const slot = firmsModule["reserveStudySlot"];')) },
    // client-lazy
    { label: 'import Anthropic from "@anthropic-ai/sdk" at the top of client.ts', flips: ["client-lazy"], apply: edit(CLIENT_REL, prepend('import Anthropic from "@anthropic-ai/sdk";')) },
    { label: 'import { type Message } from "@anthropic-ai/sdk" (an inline type is not an erased import)', flips: ["client-lazy"], apply: edit(CLIENT_REL, prepend('import { type Message } from "@anthropic-ai/sdk";')) },
    { label: 'a bare import "@anthropic-ai/sdk"', flips: ["client-lazy"], apply: edit(CLIENT_REL, prepend('import "@anthropic-ai/sdk";')) },
    { label: 'require("@anthropic-ai/sdk")', flips: ["client-lazy"], apply: edit(CLIENT_REL, append('export const sdk = require("@anthropic-ai/sdk");')) },
    { label: 'a re-export: export { default } from "@anthropic-ai/sdk"', flips: ["client-lazy"], apply: edit(CLIENT_REL, append('export { default } from "@anthropic-ai/sdk";')) },
    { label: 'a top-level await import("@anthropic-ai/sdk"), which runs at load', flips: ["client-lazy"], apply: edit(CLIENT_REL, append('export const sdk = await import("@anthropic-ai/sdk");')) },
    // store-reads-proofread-only
    { label: "store.ts imports a second name from proofread-store", flips: ["store-reads-proofread-only"], apply: edit(STORE_REL, swap('import { latestRunForProject } from "../proofread-store";', 'import { latestRunForProject, recordDisposition } from "../proofread-store";')) },
    { label: "store.ts imports from proofread-run", flips: ["store-reads-proofread-only"], apply: edit(STORE_REL, prepend('import { enqueueProofread } from "../proofread-run";')) },
    { label: "store.ts imports proofread-store a second time", flips: ["store-reads-proofread-only"], apply: edit(STORE_REL, prepend('import { findingInFirmRun } from "../proofread-store";')) },
    { label: "store.ts imports proofread-store as a namespace", flips: ["store-reads-proofread-only"], apply: edit(STORE_REL, swap('import { latestRunForProject } from "../proofread-store";', 'import * as proofreadStore from "../proofread-store";')) },
    { label: "store.ts loads proofread-store with a dynamic import", flips: ["store-reads-proofread-only"], apply: edit(STORE_REL, append('export const lazy = () => import("../proofread-store");')) },
    { label: "store.ts reads a proofread table itself (studyProofreadFindingsTable)", flips: ["store-reads-proofread-only"], apply: edit(STORE_REL, swap('import { db, studyDatumMessagesTable, usersTable } from "@workspace/db";', 'import { db, studyDatumMessagesTable, studyProofreadFindingsTable, usersTable } from "@workspace/db";')) },
    { label: "store.ts stops importing latestRunForProject", flips: ["store-reads-proofread-only"], apply: edit(STORE_REL, swap('import { latestRunForProject } from "../proofread-store";', "")) },
    // types-header-names-chat
    { label: "the header of proofread/types.ts goes back to the old sentence", flips: ["types-header-names-chat"], apply: editKey("types", swapRe(wrapped(HEADER_SENTENCE), OLD_HEADER_SENTENCE)) },
    { label: "the sentence moves out of the header into the code below it", flips: ["types-header-names-chat"], apply: editKey("types", (t) => `${t.replace(/^\s*\/\*\*[\s\S]*?\*\//, "/** Proofread clause contract. */")}\n// ${HEADER_SENTENCE}\n`) },
    { label: "the chat spec's sentence for the header drifts from the pinned one", flips: ["types-header-names-chat"], apply: editKey("chatSpec", swapRe(/the original is never\s+changed\./, "the original may be changed.")) },
    // spec-addendum-names-chat
    { label: "the 2026-09-29 spec loses its Addendum", flips: ["spec-addendum-names-chat"], apply: editKey("productSpec", (t) => (t.lastIndexOf("\n## Addendum") < 0 ? t : `${t.slice(0, t.lastIndexOf("\n## Addendum"))}\n`)) },
    { label: "the Addendum no longer links the chat spec", flips: ["spec-addendum-names-chat"], apply: editKey("productSpec", (t) => t.split(CHAT_SPEC_FILE).join("the-chat-spec.md")) },
    { label: "the Addendum stops calling the chat the only executor", flips: ["spec-addendum-names-chat"], apply: editKey("productSpec", (t) => t.replace(/only executor/gi, "an executor")) },
    // negative controls: code that must stay allowed, with no guard red
    { label: "NEGATIVE CONTROL: Set.delete, Map.delete and an object's own update() in store.ts", flips: [], apply: edit(STORE_REL, append('const seen = new Set<string>();\nseen.delete("a");\nconst cache = new Map<string, number>();\ncache.delete("k");\nconst counter = { update(n: number) { return n; } };\ncounter.update(1);\nexport const inFlight = new Set<string>();\nexport const release = (key: string) => inFlight.delete(key);')) },
    { label: "NEGATIVE CONTROL: reads and the row lock in raw SQL, and prose that says update", flips: [], apply: edit(STORE_REL, append("export const reads = sql`select id from tis_projects where id = ${id} for update`;\nexport const count = sql`select count(*) from study_revisions`;\nexport const prose = \"Datum does not update the study or delete the original.\";")) },
    { label: "NEGATIVE CONTROL: a comment in revise.ts that names the slot functions", flips: [], apply: edit(REVISE_FILE_REL, append("// reserveStudySlot and releaseStudySlot are never called here; db.update(tisProjectsTable) is never called either.")) },
    { label: "NEGATIVE CONTROL: another type-only import of the SDK in client.ts", flips: [], apply: edit(CLIENT_REL, prepend('import type { Message } from "@anthropic-ai/sdk";\nimport type { Tool } from "@anthropic-ai/sdk/resources/messages";')) },
    { label: "NEGATIVE CONTROL: a type-only import from the proofread directory in store.ts", flips: [], apply: edit(STORE_REL, prepend('import type { ProofreadFinding } from "../proofread/types.ts";')) },
    { label: "NEGATIVE CONTROL: a backticked name in the paragraph after the allowlist (GenerateTisBody's is already there)", flips: [], apply: editKey("chatSpec", swap("**Every other field** is copied", "**Every other field** (not `studyRadiusMi`) is copied")) },
  ];

  // A teeth run reads what the mutation turned red: the guards red after it that were not red before. A guard that is
  // already red on the real files shows up once, above, and cannot also show its teeth.
  const baselineRed = new Set(redOf(world));
  const newlyRed = (w) => redOf(w).filter((id) => !baselineRed.has(id));
  for (const m of TEETH) {
    let mutated;
    try {
      mutated = m.apply(world);
    } catch (e) {
      ok(`teeth: ${m.label}`, false, `the mutation could not be applied: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const red = newlyRed(mutated);
    const blind = m.flips.filter((id) => baselineRed.has(id));
    ok(
      `teeth: ${m.label} -> red: ${m.flips.length ? m.flips.join(", ") : "nothing"}`,
      blind.length === 0 && sameSet(red, m.flips),
      blind.length ? `${blind.join(", ")} is already red on the real files, so the mutation cannot show it` : `actually red: ${red.length ? red.join(", ") : "nothing"}`,
    );
  }
  {
    // The update guard covers every file of the set, not just the ones named above.
    const missed = [];
    for (const rel of CHAT_FILE_RELS) {
      const red = newlyRed(edit(rel, append(`export async function mutate() { ${UPDATE_STUDY} }`))(world));
      if (!sameSet(red, ["chat-never-mutates-studies"])) missed.push(`${rel} (red: ${red.join(", ") || "nothing"})`);
    }
    ok(`teeth: db.update(tisProjectsTable) turns chat-never-mutates-studies red in each of the ${CHAT_FILE_RELS.length} chat files`, CHAT_FILE_RELS.length >= 12 && missed.length === 0, missed.join("; "));
  }
  {
    const covered = new Set(TEETH.filter((m) => m.flips.length > 0).flatMap((m) => m.flips));
    const toothless = GUARDS.filter((g) => !covered.has(g.id)).map((g) => g.id);
    ok("every guard has a mutation that turns it red", toothless.length === 0, `none for: ${toothless.join(", ")}`);
  }
  {
    // The live negative controls: the real files already hold the code the guards must not mistake for a write.
    const revise = stripComments(world.chat.get(REVISE_FILE_REL) ?? "");
    const revisions = stripComments(world.chat.get(REVISIONS_REL) ?? "");
    const only = (rel) => new Map([[rel, world.chat.get(rel) ?? ""]]);
    ok(
      "negative control, live: revise.ts really calls inFlight.delete(...) on its in-memory Set, and the update guard is green on that file",
      /\binFlight\.delete\(/.test(revise) && chatMutations(only(REVISE_FILE_REL)).length === 0,
    );
    ok(
      'negative control, live: study-revisions.ts really holds the .for("update") row lock and the count/max reads, and the update guard is green on that file',
      /\.for\("update"\)/.test(revisions) && /max\(\$\{tisProjectsTable\.version\}\)/.test(revisions) && /count\(\*\)/.test(revisions) && chatMutations(only(REVISIONS_REL)).length === 0,
    );
  }
}

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
