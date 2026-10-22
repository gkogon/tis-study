/**
 * Hand-written contract for the Datum chat surface
 * (docs/superpowers/specs/2026-10-20-datum-chat-design.md): an engineer asks
 * Datum why a finding was flagged, and Datum can re-run the study with
 * corrected inputs as a new version. Nothing under generated/ may be
 * hand-edited (orval runs with clean: true), so this lives beside it, like
 * proofread.ts.
 *
 * The one import from generated/ carries an explicit `.ts` extension on
 * purpose. verify-datum-chat.mjs imports this file under plain `node` with no
 * loader (Node strips the types), and node does not resolve an extensionless
 * relative path. tsc accepts the extension because this package's tsconfig
 * sets allowImportingTsExtensions (it emits declarations only, which that flag
 * requires). Do not turn it back into `./generated/api`.
 *
 * Plain, erasable TypeScript only (no enums, no parameter properties): the same
 * reason.
 */
import { z } from "zod";
import {
  GenerateTisBody,
  generateTisBodySignalTimingOverridesItemPhaseByMovementMaxOne,
  generateTisBodySignalTimingOverridesMax,
} from "./generated/api.ts";

/**
 * Every limit the chat enforces, in one place so no route, prompt or panel
 * carries its own copy of a number. The spec's "Limits and cost" section is
 * where each one comes from.
 */
export const DATUM_LIMITS = Object.freeze({
  /** An engineer's message, in characters. */
  messageChars: 2000,
  /** Prior messages sent back to the model with a new one. */
  historyMessages: 20,
  /** Model calls one engineer message may cause, tool round trips included. */
  modelTurnsPerMessage: 4,
  /** Re-runs one engineer message may cause. */
  rerunsPerMessage: 1,
  /** Versions in one lineage, the original included. */
  versionsPerLineage: 25,
  /** Datum replies a firm gets in any rolling 24 hours. */
  firmRepliesPer24h: 300,
  /** Messages one user may post in an hour. */
  userMessagesPerHour: 40,
  /** The grounding pack's size, in bytes. */
  packBytes: 61440,
  /** The most one read of a path in the stored study may return, in bytes. */
  readPathBytes: 8192,
} as const);

/**
 * The fields the chat may change, in the spec's order ("Fields the chat may
 * change"). `removeGrowthOverride` is not a GenerateTisBody key: it is the
 * chat's way to say "drop the growth override", which the request schema
 * expresses by leaving growthRatePct out. Every other name is a
 * GenerateTisBody key.
 */
export const REVISABLE_FIELDS = Object.freeze([
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
] as const);

export type RevisableField = (typeof REVISABLE_FIELDS)[number];

/**
 * The settings Datum may choose itself when asked to "fix it": method choices,
 * not numbers. Every other revisable field needs a value from the engineer.
 */
export const METHOD_FIELDS = Object.freeze([
  "scopeStudyIntersections",
  "signalTiming",
  "legVolumes",
  "realLaneGeometry",
  "conservedAssignment",
] as const);

export type MethodField = (typeof METHOD_FIELDS)[number];

const BODY_SHAPE = GenerateTisBody.shape;

/**
 * Every other request field: copied from the original study unchanged, and
 * never accepted from the chat. Derived from GenerateTisBody, so a field added
 * to the request schema is locked until someone decides otherwise.
 */
export type LockedField = Exclude<keyof typeof BODY_SHAPE, RevisableField>;
export const LOCKED_FIELDS: readonly LockedField[] = Object.freeze(
  Object.keys(BODY_SHAPE).filter((k) => !(REVISABLE_FIELDS as readonly string[]).includes(k)) as LockedField[],
);

/**
 * What the browser posts. Carries no actor, firm or project: those come from
 * the session and the URL. Strict, so a key it does not name is an error, not
 * silently dropped.
 */
export const DatumChatPostBody = z
  .object({
    content: z.string().trim().min(1).max(DATUM_LIMITS.messageChars),
    /** The finding the engineer clicked "Ask about this" on. */
    findingId: z.string().uuid().optional(),
  })
  .strict();
export type DatumChatPostBody = z.infer<typeof DatumChatPostBody>;

/**
 * One field's change, as logged and as shown on the change card. `from` is
 * null when the original study had no value for the field.
 */
export type DatumChange = { field: RevisableField; from: unknown; to: unknown };
export const DatumChange = z
  .object({ field: z.enum(REVISABLE_FIELDS), from: z.unknown(), to: z.unknown() })
  .strict() as unknown as z.ZodType<DatumChange>;

export const DatumMessage = z
  .object({
    id: z.string().uuid(),
    role: z.enum(["engineer", "datum"]),
    content: z.string(),
    /** The engineer's display name, joined at read time. Null for Datum, and for a user who is gone. */
    authorName: z.string().nullable(),
    findingId: z.string().uuid().nullable(),
    /** Set on the Datum message that reports a re-run: the revision it made. */
    revisionId: z.string().uuid().nullable(),
    /** ISO 8601. */
    createdAt: z.string(),
  })
  .strict();
export type DatumMessage = z.infer<typeof DatumMessage>;

export const DatumRevision = z
  .object({
    id: z.string().uuid(),
    /** The new version. */
    projectId: z.string().uuid(),
    /** The version it was revised from. */
    fromProjectId: z.string().uuid(),
    version: z.number().int().positive(),
    changes: z.array(DatumChange),
    reason: z.string(),
    sourceLabel: z.string().nullable(),
    /** The display name of the engineer who asked. */
    requestedBy: z.string(),
    findingId: z.string().uuid().nullable(),
    clauseId: z.string().nullable(),
    /** ISO 8601. */
    createdAt: z.string(),
  })
  .strict();
export type DatumRevision = z.infer<typeof DatumRevision>;

/**
 * What GET /projects/:id/datum answers. `enabled` is false when the server has
 * no model key, and the panel then shows nothing to ask. Strict, like the
 * proofread read: a key not named here is not part of the answer.
 */
export const DatumChatReadResponse = z
  .object({
    enabled: z.boolean(),
    messages: z.array(DatumMessage),
    revisions: z.array(DatumRevision),
    lineage: z
      .object({
        version: z.number().int().positive(),
        revisedFromProjectId: z.string().uuid().nullable(),
        revisedFromVersion: z.number().int().positive().nullable(),
        latestVersionId: z.string().uuid(),
        latestVersion: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export type DatumChatReadResponse = z.infer<typeof DatumChatReadResponse>;

/** The events of the POST /projects/:id/datum/messages stream, discriminated on `type`. */
export const DatumStreamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), delta: z.string() }).strict(),
  z.object({ type: z.literal("status"), message: z.string() }).strict(),
  z
    .object({
      type: z.literal("revision"),
      projectId: z.string().uuid(),
      version: z.number().int().positive(),
      changes: z.array(DatumChange),
    })
    .strict(),
  z.object({ type: z.literal("done"), messageId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("error"), message: z.string() }).strict(),
]);
export type DatumStreamEvent = z.infer<typeof DatumStreamEvent>;

/**
 * One signal's timing, as the engineer's timing sheet gives it. The coordinates
 * are copied from the study's own row for that signal. Phases and splits are
 * lists of pairs, where the request schema keys a record by movement and by
 * phase; the merge turns them into that shape.
 *
 * Every bound is the request schema's own (read off GenerateTisBody, not
 * restated), so the two cannot drift. The movement names are the twelve
 * standard ones the request schema documents; it types the key as any string.
 */
const REQUEST_OVERRIDE = BODY_SHAPE.signalTimingOverrides.unwrap().element.shape;
const DATUM_MOVEMENTS = Object.freeze([
  "NBL",
  "NBT",
  "NBR",
  "SBL",
  "SBT",
  "SBR",
  "EBL",
  "EBT",
  "EBR",
  "WBL",
  "WBT",
  "WBR",
] as const);
const PHASE_NUMBER = REQUEST_OVERRIDE.phaseByMovement.valueSchema.int();
const SignalTimingOverrideInput = z
  .object({
    intersectionName: z.string().trim().min(1).max(200),
    latitude: REQUEST_OVERRIDE.latitude,
    longitude: REQUEST_OVERRIDE.longitude,
    cycleLenSec: REQUEST_OVERRIDE.cycleLenSec,
    phases: z
      .array(z.object({ movement: z.enum(DATUM_MOVEMENTS), phase: PHASE_NUMBER }).strict())
      .min(1)
      .max(DATUM_MOVEMENTS.length),
    splits: z
      .array(z.object({ phase: PHASE_NUMBER, seconds: REQUEST_OVERRIDE.splitSByPhase.valueSchema }).strict())
      .min(1)
      .max(generateTisBodySignalTimingOverridesItemPhaseByMovementMaxOne),
  })
  .strict();

/**
 * The input of the re-run tool: a strict set of changes, each field optional
 * and bounded exactly as GenerateTisBody bounds it, plus why. An empty
 * `changes` means "re-run on the current engine with the same inputs". A field
 * outside REVISABLE_FIELDS is an unknown key and is refused.
 *
 * The defaults GenerateTisBody carries (conservedAssignment, signalTiming,
 * legVolumes) are removed here: a field the model left out must stay out of
 * the parsed object, or a default would be written over the original study's
 * own value.
 */
export const RerunToolInput = z
  .object({
    changes: z
      .object({
        growthRatePct: BODY_SHAPE.growthRatePct,
        removeGrowthOverride: z.literal(true).optional(),
        openingYear: BODY_SHAPE.openingYear.optional(),
        analysisPeriods: BODY_SHAPE.analysisPeriods,
        passByPct: BODY_SHAPE.passByPct,
        internalCapturePct: BODY_SHAPE.internalCapturePct,
        weather: BODY_SHAPE.weather,
        scopeStudyIntersections: BODY_SHAPE.scopeStudyIntersections,
        signalTiming: BODY_SHAPE.signalTiming.removeDefault().optional(),
        legVolumes: BODY_SHAPE.legVolumes.removeDefault().optional(),
        realLaneGeometry: BODY_SHAPE.realLaneGeometry,
        conservedAssignment: BODY_SHAPE.conservedAssignment.removeDefault().optional(),
        signalTimingOverrides: z.array(SignalTimingOverrideInput).max(generateTisBodySignalTimingOverridesMax).optional(),
      })
      .strict(),
    reason: z.string().trim().min(1).max(500),
    sourceLabel: z.string().max(200).optional(),
    findingId: z.string().uuid().optional(),
  })
  .strict();
export type RerunToolInput = z.infer<typeof RerunToolInput>;
