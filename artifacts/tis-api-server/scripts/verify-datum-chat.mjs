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

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
