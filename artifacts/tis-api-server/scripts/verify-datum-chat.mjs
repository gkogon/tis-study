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
import { readFileSync } from "node:fs";
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
ok("each index comes after the table it indexes", at("study_revisions.uq_project") > at("study_revisions.create") && at("study_datum_messages.idx_project") > at("study_datum_messages.create"));
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
for (const [name, src] of [["clause-guide.ts", guideSrc], ["context.ts", contextSrc]]) {
  const code = stripComments(src);
  const rel = [...code.matchAll(/\bfrom\s+"(\.{1,2}\/[^"]*)"/g)].map((m) => m[1]);
  ok(`${name} imports no SDK, db or logger, reads no env and fetches nothing`, code.length > 0 && !/@anthropic-ai\/sdk|@workspace\/db|\blogger\b|process\.env|\bfetch\s*\(|\brequire\s*\(/.test(code));
  ok(`every relative import in ${name} carries an explicit .ts`, rel.length > 0 && rel.every((p) => p.endsWith(".ts")), rel.join(", "));
  ok(`pure datum-chat modules import the contract only via ./contract.ts: ${name} imports it there and names no tis-api-zod path`, rel.includes("./contract.ts") && !/tis-api-zod/.test(code), rel.join(", "));
}

// --- The scenario-base.json record -------------------------------------------------------
let FX = {};
try {
  FX = JSON.parse(read("artifacts/atlanta-tis/scripts/fixtures/scenario-base.json"));
} catch (e) {
  ok("precondition: scenario-base.json parses", false, e instanceof Error ? e.message : String(e));
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
t("it never walks the prototype chain: constructor, __proto__, toString and length are not values", () =>
  ["request.__proto__", "request.constructor", "request.constructor.name", "request.toString", "result.periodReports.constructor", "result.growthSource.length", "request.hasOwnProperty"].every((p) => X.readStudyPath(REC, p) === `(no value at ${p})`) &&
  X.readStudyPath(REC, "result.periodReports.length") === "(no value at result.periodReports.length)");
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

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
