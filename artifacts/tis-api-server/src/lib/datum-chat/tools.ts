/**
 * What Datum may do to a study, in code: the merge that turns an engineer's
 * allowed changes into a new request, and the two tools the model calls.
 *
 * Pure, like lib/proofread/: no db, logger, fetch or SDK, and importable under
 * plain `node` (Node strips the types). Two consequences of that:
 *   - Relative imports carry an explicit `.ts`.
 *   - The contract is reached through "./contract.ts", not through
 *     "@workspace/tis-api-zod" (whose index plain node cannot resolve) and not
 *     by a path of its own. contract.ts is the one place the lib/tis-api-zod
 *     paths are written down.
 *
 * The tool schemas are strict-mode schemas, so they carry no min, max, length,
 * count or pattern limits and no unions. Each bound is written into the
 * field's description in words, read off the request schema so the two cannot
 * drift. The real check is `applyRevisionChanges`, which parses the merged
 * request with GenerateTisBody.
 */
import {
  DATUM_LIMITS,
  GenerateTisBody,
  METHOD_FIELDS,
  REVISABLE_FIELDS,
  RerunToolInput,
  generateTisBodySignalTimingOverridesMax,
} from "./contract.ts";
import type { DatumChange, RevisableField } from "./contract.ts";
import { GROWTH_FALLBACK_WORDS } from "./clause-guide.ts";

// ---------------------------------------------------------------------------
// The merge
// ---------------------------------------------------------------------------

/** A request as the generator takes it: the parse of GenerateTisBody, defaults filled in. */
export type TisRequestLike = ReturnType<(typeof GenerateTisBody)["parse"]>;

export type ApplyRevisionResult =
  | { ok: true; request: TisRequestLike; changes: DatumChange[] }
  | { ok: false; error: string; field?: string };

const REVISABLE: ReadonlySet<string> = new Set(REVISABLE_FIELDS);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** JSON equality, key order aside. Both sides are request values, so JSON is all they hold. */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((k) => Object.hasOwn(right, k) && sameJson(left[k], right[k]));
}

/** `a.b[0].c` for a zod issue path. */
function pathText(path: ReadonlyArray<string | number>): string {
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? p : `.${p}`)).join("");
}

/**
 * The saved request fails today's schema at a field the engineer did not change.
 * No change the chat could make clears it, so the re-run is refused and the
 * engineer is pointed to the generator. Nothing has run.
 */
function savedInputsRefusal(field: string | undefined, where: string, why: string): ApplyRevisionResult {
  return {
    ok: false,
    ...(field === undefined ? {} : { field }),
    error: `The saved inputs for this study no longer pass the generator's checks (${where}: ${why}). Nothing was re-run and the original is unchanged; start a new study in the generator.`,
  };
}

/** The engineer's own value is outside the request schema's bounds. */
function boundsRefusal(field: string, where: string, why: string): ApplyRevisionResult {
  return { ok: false, field, error: `${where} is not allowed: ${why}. Nothing was re-run.` };
}

type TimingConversion = { ok: true; records: Array<Record<string, unknown>> } | { ok: false; error: string };

/**
 * The timing sheet as the tool takes it (lists of pairs) to the request's
 * records (keyed by movement and by phase). A movement or phase listed twice is
 * refused: a keyed record cannot hold both, and the later one winning would
 * apply a number nobody chose.
 */
function toTimingRecords(list: unknown): TimingConversion {
  if (!Array.isArray(list)) return { ok: false, error: "signalTimingOverrides must be a list of timing records." };
  const records: Array<Record<string, unknown>> = [];
  for (const [i, item] of list.entries()) {
    if (!isObject(item) || !Array.isArray(item.phases) || !Array.isArray(item.splits)) {
      return { ok: false, error: `signalTimingOverrides[${i}] must be a record with a phases list and a splits list.` };
    }
    const label = typeof item.intersectionName === "string" ? `"${item.intersectionName}"` : `record ${i}`;
    const phaseByMovement = new Map<string, unknown>();
    for (const p of item.phases) {
      const entry = isObject(p) ? p : {};
      const movement = String(entry.movement);
      if (phaseByMovement.has(movement)) {
        return { ok: false, error: `Timing for ${label} lists movement ${movement} twice; give each movement one phase.` };
      }
      phaseByMovement.set(movement, entry.phase);
    }
    const splitSByPhase = new Map<string, unknown>();
    for (const s of item.splits) {
      const entry = isObject(s) ? s : {};
      const key = String(entry.phase);
      if (splitSByPhase.has(key)) {
        return { ok: false, error: `Timing for ${label} gives phase ${key} two splits; give each phase one split.` };
      }
      splitSByPhase.set(key, entry.seconds);
    }
    records.push({
      latitude: item.latitude,
      longitude: item.longitude,
      name: item.intersectionName,
      cycleLenSec: item.cycleLenSec,
      phaseByMovement: Object.fromEntries(phaseByMovement),
      splitSByPhase: Object.fromEntries(splitSByPhase),
    });
  }
  return { ok: true, records };
}

/**
 * Merge an engineer's allowed changes onto the original study's request, and
 * check the result against the request schema.
 *
 * Only the names in REVISABLE_FIELDS are read from `input.changes`; every other
 * field of the parent is carried over untouched, and the parent itself is never
 * modified. A change whose value equals the parent's is skipped. `from` is the
 * parent's value, or null when the parent has none.
 *
 * The merged request is parsed with GenerateTisBody and the parse is what
 * comes back, so it is exactly what the generator will run. When the parse
 * fails:
 *   - at a field the engineer did not change, the saved inputs no longer pass
 *     today's schema (a legacy request) and the re-run is refused, pointing to
 *     the generator;
 *   - otherwise the engineer's value is out of bounds, and that is said.
 */
export function applyRevisionChanges(parentRequest: unknown, input: RerunToolInput): ApplyRevisionResult {
  // The type says input is a parsed RerunToolInput; the allowlist holds even if a caller skipped that parse.
  const asked = (input as { changes?: unknown } | null | undefined)?.changes;
  if (!isObject(asked)) return { ok: false, field: "changes", error: "changes must be an object naming the fields to change." };
  const stranger = Object.keys(asked).find((k) => !REVISABLE.has(k));
  if (stranger !== undefined) {
    return {
      ok: false,
      field: stranger,
      error: `${stranger} is not a field this chat may change. It may change only: ${REVISABLE_FIELDS.join(", ")}.`,
    };
  }
  const has = (f: RevisableField): boolean => Object.hasOwn(asked, f) && asked[f] !== undefined;
  if (has("growthRatePct") && has("removeGrowthOverride")) {
    return {
      ok: false,
      field: "growthRatePct",
      error: "Pick one: set a new rate with growthRatePct, or drop the override with removeGrowthOverride. Both together is not a change anyone asked for.",
    };
  }

  if (!isObject(parentRequest)) return savedInputsRefusal(undefined, "the request", "it is not a request object");
  const parent = parentRequest;
  let merged: Record<string, unknown>;
  try {
    merged = structuredClone(parentRequest);
  } catch {
    return savedInputsRefusal(undefined, "the request", "it could not be copied");
  }

  const changes: DatumChange[] = [];
  /** The GenerateTisBody keys this call actually changed. */
  const touched = new Set<string>();
  const was = (key: string): unknown => (Object.hasOwn(parent, key) && parent[key] !== undefined ? parent[key] : undefined);

  for (const field of REVISABLE_FIELDS) {
    if (!has(field)) continue;
    if (field === "removeGrowthOverride") {
      if (asked[field] !== true) return { ok: false, field, error: "removeGrowthOverride can only be true." };
      const from = was("growthRatePct");
      if (from === undefined) continue;
      delete merged.growthRatePct;
      touched.add("growthRatePct");
      changes.push({ field: "growthRatePct", from: structuredClone(from), to: null });
      continue;
    }
    let to: unknown = asked[field];
    if (field === "signalTimingOverrides") {
      const converted = toTimingRecords(to);
      if (!converted.ok) return { ok: false, field, error: converted.error };
      to = converted.records;
    }
    const from = was(field);
    if (sameJson(from, to)) continue;
    merged[field] = structuredClone(to);
    touched.add(field);
    changes.push({ field, from: from === undefined ? null : structuredClone(from), to: structuredClone(to) });
  }

  const parsed = GenerateTisBody.safeParse(merged);
  if (parsed.success) return { ok: true, request: parsed.data, changes };

  // A fault the engineer did not touch comes first: no change fixes it, so it is the answer however the rest reads.
  const issues = parsed.error.issues;
  const field = (i: (typeof issues)[number]): string | undefined => (typeof i.path[0] === "string" ? i.path[0] : undefined);
  const legacy = issues.find((i) => {
    const f = field(i);
    return f === undefined || !touched.has(f);
  });
  if (legacy !== undefined) return savedInputsRefusal(field(legacy), pathText(legacy.path) || "the request", legacy.message);
  const first = issues[0]!;
  return boundsRefusal(field(first)!, pathText(first.path), first.message);
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

/** The Anthropic tool shape, described locally so this module needs no SDK types. */
export type DatumTool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  strict: true;
};

/** Freezes in place and returns the same object, so a request cannot edit the schema every request sends. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

type Bounded = { minValue: number | null; maxValue: number | null };

/** "Allowed range: 0 to 6." from the schema's own bounds, since strict mode cannot carry minimum and maximum. */
function range(n: Bounded): string {
  if (n.minValue !== null && n.maxValue !== null) return `Allowed range: ${n.minValue} to ${n.maxValue}.`;
  if (n.minValue !== null) return `Allowed minimum: ${n.minValue}.`;
  if (n.maxValue !== null) return `Allowed maximum: ${n.maxValue}.`;
  return "";
}

const CHANGES = RerunToolInput.shape.changes.shape;
const TIMING = CHANGES.signalTimingOverrides.unwrap().element.shape;
const MOVEMENT = TIMING.phases.element.shape.movement;
const PHASE = TIMING.phases.element.shape.phase;

const object = (properties: Record<string, unknown>, required?: string[], description?: string) => ({
  type: "object" as const,
  ...(description === undefined ? {} : { description }),
  properties,
  ...(required === undefined ? {} : { required }),
  additionalProperties: false as const,
});

/** One schema per name in REVISABLE_FIELDS; the type makes a missing or extra name a compile error. */
const CHANGE_PROPERTIES: Record<RevisableField, unknown> = {
  growthRatePct: {
    type: "number",
    description: `Annual background growth, in percent per year, replacing the study's growth override. ${range(CHANGES.growthRatePct.unwrap())} Use a rate the engineer gave. Never send it together with removeGrowthOverride.`,
  },
  removeGrowthOverride: {
    type: "boolean",
    const: true,
    description: `Send true to drop the growth override, so the engine uses ${GROWTH_FALLBACK_WORDS}. Never send it together with growthRatePct.`,
  },
  openingYear: {
    type: "integer",
    description: `Opening year of the project, a whole year. ${range(CHANGES.openingYear.unwrap())}`,
  },
  analysisPeriods: {
    type: "array",
    items: { type: "string", enum: [...CHANGES.analysisPeriods.unwrap().element.options] },
    description: "The periods to analyze. Replaces the study's list; give every period to keep, not only the ones to add.",
  },
  passByPct: {
    type: "number",
    description: `Pass-by share of project trips at the PM peak, in percent, replacing the land-use default. ${range(CHANGES.passByPct.unwrap())}`,
  },
  internalCapturePct: {
    type: "number",
    description: `Internal-capture share of project trips at the PM peak, in percent, replacing the land-use default. ${range(CHANGES.internalCapturePct.unwrap())}`,
  },
  weather: {
    type: "string",
    enum: [...CHANGES.weather.unwrap().options],
    description: "The weather condition the capacity factor is taken for.",
  },
  scopeStudyIntersections: {
    type: "boolean",
    description: "true trims the study to the materially impacted intersections; false analyzes every signalized intersection inside the study radius. A method choice.",
  },
  signalTiming: {
    type: "string",
    enum: [...CHANGES.signalTiming.unwrap().options],
    description: "Signal timing basis. computed gives each study intersection its own cycle length and green splits; screening is the legacy flat cycle. A method choice.",
  },
  legVolumes: {
    type: "string",
    enum: [...CHANGES.legVolumes.unwrap().options],
    description: "Background volume basis per intersection. network gives each leg its own volume; screening is the legacy fixed approach split. A method choice.",
  },
  realLaneGeometry: {
    type: "boolean",
    description: "true sizes capacity with real through-lane counts; false pins the one-lane legacy basis. A method choice.",
  },
  conservedAssignment: {
    type: "boolean",
    description: "true routes project trips through the road network so flow is conserved between adjacent intersections; false is the legacy assignment. A method choice.",
  },
  signalTimingOverrides: {
    type: "array",
    description: `The engineer's timing sheet, one record per signal, up to ${generateTisBodySignalTimingOverridesMax}. Send complete records only, with latitude and longitude copied from the study's own row for that signal. The list replaces the study's existing timing records as a whole.`,
    items: object(
      {
        intersectionName: { type: "string", description: "The intersection's name as the study row gives it." },
        latitude: { type: "number", description: `Latitude copied from the study's row for this signal. ${range(TIMING.latitude)}` },
        longitude: { type: "number", description: `Longitude copied from the study's row for this signal. ${range(TIMING.longitude)}` },
        cycleLenSec: { type: "number", description: `Cycle length in seconds. ${range(TIMING.cycleLenSec)}` },
        phases: {
          type: "array",
          description: "The phase number serving each movement, one entry per movement and at most twelve, for example NBT served by phase 2. A left whose phase differs from its through's is protected.",
          items: object(
            {
              movement: { type: "string", enum: [...MOVEMENT.options], description: "The movement." },
              phase: { type: "integer", description: `The phase number serving it. ${range(PHASE)}` },
            },
            ["movement", "phase"],
          ),
        },
        splits: {
          type: "array",
          description: "The split (maximum green) in seconds for each phase, one entry per phase.",
          items: object(
            {
              phase: { type: "integer", description: `The phase number. ${range(PHASE)}` },
              seconds: { type: "number", description: `The split in seconds. ${range(TIMING.splits.element.shape.seconds)}` },
            },
            ["phase", "seconds"],
          ),
        },
      },
      ["intersectionName", "latitude", "longitude", "cycleLenSec", "phases", "splits"],
    ),
  },
};

/** Re-run the study as a new version with the engineer's changes. Input is `RerunToolInput`. */
export const RERUN_TOOL: DatumTool = deepFreeze({
  name: "rerun_study_with_changes",
  description: [
    "Re-run this study on the current engine as a new version, with the corrections the engineer asked for.",
    "The original study is never changed; the re-run is saved as a new version the engineer opens from the thread.",
    "Call it only when the engineer's latest message asks for a change, and at most once per message.",
    "`changes` names only the fields to change. Every field it leaves out keeps the original's value, and an empty `changes` re-runs the same inputs on the current engine.",
    `Take every number from the engineer. You may choose a value yourself only for the method fields (${METHOD_FIELDS.join(", ")}), and only when asked to fix a finding.`,
    "Location, land use, size, project name, driveways and imported signal data cannot be changed here.",
    "A value outside its allowed range is refused with the reason, and nothing is re-run.",
  ].join(" "),
  input_schema: object(
    {
      changes: object(
        Object.fromEntries(REVISABLE_FIELDS.map((f) => [f, CHANGE_PROPERTIES[f]])),
        undefined,
        "The fields to change. Name only the ones the engineer wants changed; an empty object re-runs the same inputs on the current engine.",
      ),
      reason: {
        type: "string",
        description: `One or two sentences on why, in the engineer's terms. At most ${RerunToolInput.shape.reason.maxLength} characters.`,
      },
      sourceLabel: {
        type: "string",
        description: `Where the engineer's numbers came from, for example a county letter or a timing sheet. At most ${RerunToolInput.shape.sourceLabel.unwrap().maxLength} characters.`,
      },
      findingId: {
        type: "string",
        format: "uuid",
        description: "The id of the finding the engineer asked about, when the change answers one.",
      },
    },
    ["changes", "reason"],
  ),
  strict: true,
});

/** Read one value from the stored study. Input is `{ path }`; the answer is built by `readStudyPath`. */
export const READ_PATH_TOOL: DatumTool = deepFreeze({
  name: "read_study_path",
  description: [
    "Read one value from this study's stored request or result when the grounding pack does not hold it.",
    "The path starts with request. or result. and continues with dotted names and [index] positions, for example request.growthRatePct or result.growthSource.",
    `Read-only: it changes nothing. The answer is JSON text cut off at ${DATUM_LIMITS.readPathBytes} bytes, or a note that nothing is stored at that path.`,
  ].join(" "),
  input_schema: object(
    {
      path: {
        type: "string",
        description: "The path to read, starting with request. or result.",
      },
    },
    ["path"],
  ),
  strict: true,
});
