/**
 * The model tool loop: streams one Datum reply, runs at most one re-run, and
 * survives an engineer who closes the tab.
 *
 * Pure, like the rest of lib/datum-chat/ apart from store.ts and client.ts: no
 * db, logger, fetch or SDK, and importable under plain `node`. The model
 * client, the re-run, the stored-study reader, the event sink and the abort
 * signal are all handed in, so the route supplies the real ones and the check
 * script supplies fakes. The client type below is the part of the SDK's
 * `messages.stream()` this loop uses, described locally for that reason.
 *
 * What a caller can rely on:
 *   - It never rejects. A model failure, an unexpected exception and a
 *     disconnect all come back as a result, because a re-run may already be
 *     saved and the route still has to save the Datum message that reports it.
 *   - It emits `text`, `status`, `revision` and `error` events. `done` is the
 *     route's, sent after it saves the message.
 *   - Tools run only on a turn that stopped with `tool_use`, never on a
 *     refusal or a reply cut off at max_tokens, and `revise` runs only after
 *     the input passes RerunToolInput. Every tool input is parsed first.
 *   - Disconnect: when `emit` throws or `signal` aborts, the model stream is
 *     aborted and the loop stops asking the model for more. A re-run whose
 *     `revise` call has begun is awaited to the end and comes back in the
 *     result. One that has not begun is not started. `cutOff` is true.
 *
 * Within one engineer message each assistant turn's `content` goes back to the
 * model exactly as it came, thinking blocks included.
 */
import { z } from "zod";
import { DATUM_LIMITS, RerunToolInput } from "./contract.ts";
import type { DatumChange, DatumStreamEvent } from "./contract.ts";
import { READ_PATH_TOOL, RERUN_TOOL } from "./tools.ts";
import type { HistoryMessage, buildSystem } from "./prompt.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelBlock = { type: string; [k: string]: unknown };

/** The finished message `finalMessage()` resolves with, as far as this loop reads it. */
export type ModelMessage = {
  content: ModelBlock[];
  stop_reason: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
};

export type ModelStream = {
  on(ev: "text", cb: (delta: string) => void): unknown;
  abort(): void;
  finalMessage(): Promise<ModelMessage>;
};

/** `client.messages.stream(params)` of the SDK, and nothing else of it. */
export type DatumClient = { messages: { stream(params: object): ModelStream } };

export type TurnDeps = {
  client: DatumClient;
  revise: (
    input: RerunToolInput,
  ) => Promise<{ ok: true; projectId: string; version: number; changes: DatumChange[] } | { ok: false; error: string }>;
  readPath: (path: string) => string;
  /** May throw after a disconnect; the loop survives it and stops. */
  emit: (e: DatumStreamEvent) => void;
  /** Aborted on client disconnect. */
  signal: AbortSignal;
};

export type TurnResult = {
  /** Everything the engineer was shown, in order: what the route saves as the Datum message. */
  text: string;
  revision: { projectId: string; version: number; changes: DatumChange[] } | null;
  /**
   * The last turn's stop_reason, or: "turn_cap" when the model was still asking
   * for tools at its last allowed turn, "error" when the model call failed, and
   * "aborted" when the engineer left.
   */
  stopReason: string;
  /** The model that answered the last completed turn; null when none completed. */
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  /** The engineer left before the reply was finished. The route adds " (reply cut off)". */
  cutOff: boolean;
};

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/** The line for every turn that ends without an answer: a refusal, a cut-off model reply, the turn cap, a model error. */
export const DATUM_COULDNT_ANSWER = "Datum couldn't answer that just now.";

const MODEL = "claude-opus-5-5";
const MAX_TOKENS = 16000;

/** The same array, in the same order, on every call: the tools sit ahead of `system` in the cached prefix. */
const TOOLS = Object.freeze([READ_PATH_TOOL, RERUN_TOOL]);

/** Fresh objects on every call, so nothing the client does to one reaches the next. */
function callParams(system: ReturnType<typeof buildSystem>, messages: HistoryMessage[]): object {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    tool_choice: { type: "auto", disable_parallel_tool_use: true },
    tools: TOOLS,
    system,
    messages,
  };
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

const ReadPathInput = z.object({ path: z.string() }).strict();

type ToolUse = { id: string; name: string; input: unknown };
type ToolResult = { type: "tool_result"; tool_use_id: string; content: string; is_error?: true };

const LIMIT_REACHED =
  "Only one re-run per message is allowed, and this message has already used it. Nothing was re-run. Tell the engineer, and do not call this tool again in this message.";
const LEFT_MESSAGE = "Not run: the engineer has left the chat.";

/** At most the first few problems, so a bad input costs the model a line, not a page. */
function issueText(error: { issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }> }): string {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.length > 0 ? i.path.join(".") : "input"}: ${i.message}`)
    .join("; ")
    .slice(0, 700);
}

const SHORT_VALUE_CHARS = 40;

/** `growthRatePct = 1` for a plain value, and just the field name for a list or an object. */
function changeLabel([field, value]: [string, unknown]): string {
  if (typeof value === "number" || typeof value === "boolean") return `${field} = ${value}`;
  if (typeof value === "string" && value.length <= SHORT_VALUE_CHARS && !/[\r\n]/.test(value)) return `${field} = ${value}`;
  return field;
}

/** The status line before a re-run: the fields being changed. It does not know the old values. */
function rerunStatus(changes: object): string {
  const labels = Object.entries(changes)
    .filter(([, v]) => v !== undefined)
    .map(changeLabel);
  return labels.length === 0
    ? "Re-running the study on the current engine with the same inputs…"
    : `Re-running the study with ${labels.join(", ")}…`;
}

const MAX_ECHO_JSON_CHARS = 1000;

/** A value in the tool_result: as it is, unless it is long (a timing sheet), when the model is told its size instead. */
function echoValue(v: unknown): unknown {
  if (v === undefined) return null;
  const json = JSON.stringify(v);
  if (json !== undefined && json.length <= MAX_ECHO_JSON_CHARS) return v;
  return Array.isArray(v) ? `(a list of ${v.length} items, not shown)` : "(a long value, not shown)";
}

const count = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? n : 0);

const toolUsesOf = (message: ModelMessage): ToolUse[] =>
  (Array.isArray(message.content) ? message.content : [])
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ id: String(b.id), name: String(b.name), input: b.input }));

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

export async function runDatumTurn(
  deps: TurnDeps,
  input: { system: ReturnType<typeof buildSystem>; messages: HistoryMessage[] },
): Promise<TurnResult> {
  const { client, revise, readPath, emit, signal } = deps;
  /** The caller's history is never edited: this is the conversation as the model sees it, growing by two messages per tool round trip. */
  const convo: HistoryMessage[] = [...input.messages];

  let text = "";
  let revision: TurnResult["revision"] = null;
  let stopReason = "";
  let model: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cutOff = false;
  let reruns = 0;
  let live: { stream: ModelStream; aborted: boolean } | null = null;

  // `cutOff` is written from callbacks, so the loop reads it through this, not as a plain variable.
  const isCutOff = (): boolean => cutOff;

  const abortStream = (): void => {
    if (live === null || live.aborted) return;
    live.aborted = true;
    try {
      live.stream.abort();
    } catch {
      // The stream has already finished or failed; there is nothing left to cancel.
    }
  };
  const leave = (): void => {
    cutOff = true;
    abortStream();
  };

  /** Once the engineer has gone nothing more is sent: the sink would only throw again. */
  const send = (event: DatumStreamEvent): void => {
    if (cutOff) return;
    try {
      emit(event);
    } catch {
      leave();
    }
  };

  /** What goes between the text so far and a new piece of the reply: a blank line, or what is still missing of one. */
  const joiner = (): string => (text === "" || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n");
  const addText = (delta: string): void => {
    text += delta;
    send({ type: "text", delta });
  };
  const addLine = (): void => {
    if (!cutOff) addText(`${joiner()}${DATUM_COULDNT_ANSWER}`);
  };

  const streamTurn = async (): Promise<ModelMessage> => {
    const stream = client.messages.stream(callParams(input.system, [...convo]));
    live = { stream, aborted: false };
    let first = true;
    // Handlers go on before the first await, or the first deltas could be missed.
    stream.on("text", (delta) => {
      if (cutOff || delta === "") return;
      const lead = first ? joiner() : "";
      first = false;
      addText(`${lead}${delta}`);
    });
    try {
      return await stream.finalMessage();
    } finally {
      live = null;
    }
  };

  const runTool = async (use: ToolUse): Promise<ToolResult> => {
    const done = (content: string): ToolResult => ({ type: "tool_result", tool_use_id: use.id, content });
    const failed = (content: string): ToolResult => ({ type: "tool_result", tool_use_id: use.id, content, is_error: true });

    // The engineer left while an earlier tool in this reply was running: nothing more is started.
    if (cutOff) return failed(LEFT_MESSAGE);

    if (use.name === READ_PATH_TOOL.name) {
      const parsed = ReadPathInput.safeParse(use.input);
      if (!parsed.success) {
        return failed(`The input is not valid, so nothing was read (${issueText(parsed.error)}). ${READ_PATH_TOOL.name} takes {"path": "request.… or result.…"}.`);
      }
      try {
        const answer = String(readPath(parsed.data.path));
        return done(answer === "" ? "(nothing)" : answer);
      } catch {
        return failed("That path could not be read. Answer from the grounding pack, or tell the engineer you could not look it up.");
      }
    }

    if (use.name === RERUN_TOOL.name) {
      if (reruns >= DATUM_LIMITS.rerunsPerMessage) return failed(LIMIT_REACHED);
      // The merge relies on this parse for the timing-sheet constraints (movement names, phase numbers): revise sees only what passed it.
      const parsed = RerunToolInput.safeParse(use.input);
      if (!parsed.success) {
        return failed(`The re-run input is not valid, so nothing was re-run (${issueText(parsed.error)}). Correct it to match the tool's schema and what the engineer asked, or tell the engineer what you could not apply.`);
      }
      send({ type: "status", message: rerunStatus(parsed.data.changes) });
      // A re-run that has begun runs to the end; one the engineer left before is not begun.
      if (cutOff) return failed(LEFT_MESSAGE);
      reruns += 1;
      let outcome: Awaited<ReturnType<TurnDeps["revise"]>>;
      try {
        outcome = await revise(parsed.data);
      } catch {
        return failed("The re-run failed because of an internal error, so there is no new version to open. Tell the engineer, and that they can try again.");
      }
      if (!outcome.ok) return failed(outcome.error);
      revision = { projectId: outcome.projectId, version: outcome.version, changes: outcome.changes };
      send({ type: "revision", ...revision });
      return done(
        JSON.stringify({
          ok: true,
          version: outcome.version,
          changes: outcome.changes.map((c) => ({ field: c.field, from: echoValue(c.from), to: echoValue(c.to) })),
        }),
      );
    }

    return failed(`There is no tool named "${use.name.slice(0, 80)}". The tools are ${READ_PATH_TOOL.name} and ${RERUN_TOOL.name}. Nothing was run.`);
  };

  /** One tool_result per tool_use, in order, matched by id. Parallel calls are off, but a reply that holds two still gets both answered. */
  const runTools = async (uses: ToolUse[]): Promise<ToolResult[]> => {
    const results: ToolResult[] = [];
    for (const use of uses) results.push(await runTool(use));
    return results;
  };

  const onAbort = (): void => leave();
  if (signal.aborted) cutOff = true;
  else signal.addEventListener("abort", onAbort, { once: true });

  try {
    for (let turn = 1; turn <= DATUM_LIMITS.modelTurnsPerMessage && !isCutOff(); turn++) {
      const message = await streamTurn();
      inputTokens += count(message.usage?.input_tokens);
      outputTokens += count(message.usage?.output_tokens);
      model = message.model;
      // The engineer left during this turn. Even if the stream finished anyway, its tool_use is not run.
      if (isCutOff()) break;
      stopReason = message.stop_reason;

      const uses = toolUsesOf(message);
      if (message.stop_reason === "tool_use" && uses.length > 0) {
        // The model could not read the result of a tool run on its last turn, so none is run.
        if (turn === DATUM_LIMITS.modelTurnsPerMessage) {
          stopReason = "turn_cap";
          addLine();
          break;
        }
        convo.push({ role: "assistant", content: message.content });
        convo.push({ role: "user", content: await runTools(uses) });
        continue;
      }

      // A refusal, a reply cut off at max_tokens and a tool_use that did not stop the turn run nothing.
      const withheld = message.stop_reason === "refusal" || message.stop_reason === "max_tokens" || (uses.length > 0 && message.stop_reason !== "end_turn");
      if (withheld || text.trim() === "") addLine();
      break;
    }
  } catch {
    // finalMessage() rejects when the stream is aborted, and on an API error. Any other exception lands here too:
    // either way the result must still be returned, because a re-run may already be saved.
    if (!isCutOff()) {
      stopReason = "error";
      addLine();
      send({ type: "error", message: DATUM_COULDNT_ANSWER });
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }

  if (isCutOff()) stopReason = "aborted";
  return { text, revision, stopReason, model, inputTokens, outputTokens, cutOff: isCutOff() };
}
