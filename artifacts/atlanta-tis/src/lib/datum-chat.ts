/**
 * Client for the Datum chat on a study (`/tis-api/projects/:id/datum`): the
 * engineer asks Datum why a finding was flagged and how to fix it, and Datum can
 * re-run the study with corrected inputs as a new saved version. The original is
 * never changed.
 *
 * The types mirror the hand-written contract, lib/tis-api-zod/src/datum-chat.ts.
 * This app does not depend on that package (see lib/proofread.ts), so they are
 * restated here, as loosely as the drawer can afford: a field name is a string,
 * not the allowlist's union, because the drawer only shows it.
 *
 * The reply comes back as server-sent events on a POST, so it is read with fetch
 * and a stream reader, not EventSource (which only GETs). The server writes
 * `data: <json>` frames and, every 15 seconds while it works, a `: ping` comment
 * frame so no proxy drops the quiet connection. A comment is not an event.
 */

/** An engineer's message, in characters (DATUM_LIMITS.messageChars). */
export const DATUM_MESSAGE_CHARS = 2000;

export type DatumChangeT = { field: string; from: unknown; to: unknown };

export type DatumMessageT = {
  id: string;
  role: "engineer" | "datum";
  content: string;
  /** The engineer's display name. Null for Datum, and for a user who is gone. */
  authorName: string | null;
  findingId: string | null;
  /** Set on the Datum message that reports a re-run: the revision it made. */
  revisionId: string | null;
  createdAt: string;
};

export type DatumRevisionT = {
  id: string;
  /** The new version. */
  projectId: string;
  /** The version it was revised from. */
  fromProjectId: string;
  /** The new version's number. */
  version: number;
  changes: DatumChangeT[];
  reason: string;
  /** Null when the engineer gave no source. */
  sourceLabel: string | null;
  /** Who asked. */
  requestedBy: string;
  findingId: string | null;
  clauseId: string | null;
  createdAt: string;
};

export type DatumLineageT = {
  version: number;
  revisedFromProjectId: string | null;
  revisedFromVersion: number | null;
  latestVersionId: string;
  latestVersion: number;
};

export type DatumRead = {
  /** False when the server has no model key: nothing to ask, and the panel looks as it always has. */
  enabled: boolean;
  messages: DatumMessageT[];
  /** The revision that made this version, if any, and the versions made from it, newest first. */
  revisions: DatumRevisionT[];
  /** Where this version sits. Sent with the chat off too; null only when an answer could not be read. */
  lineage: DatumLineageT | null;
};

export type DatumStreamEventT =
  | { type: "text"; delta: string }
  | { type: "status"; message: string }
  | { type: "revision"; projectId: string; version: number; changes: DatumChangeT[] }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string };

export type DatumPostBody = { content: string; findingId?: string };

/** A request the server refused before any reply began (or one that never reached it: status 0). */
export class DatumRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DatumRequestError";
    this.status = status;
  }
}

const UNREACHABLE = "Could not reach Datum. Check your connection and try again.";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const isChange = (v: unknown): v is DatumChangeT => isRecord(v) && isStr(v.field) && "from" in v && "to" in v;
const isChanges = (v: unknown): v is DatumChangeT[] => Array.isArray(v) && v.every(isChange);

function isMessage(v: unknown): v is DatumMessageT {
  return (
    isRecord(v) &&
    isStr(v.id) &&
    (v.role === "engineer" || v.role === "datum") &&
    isStr(v.content) &&
    isStrOrNull(v.authorName) &&
    isStrOrNull(v.findingId) &&
    isStrOrNull(v.revisionId) &&
    isStr(v.createdAt)
  );
}

function isRevision(v: unknown): v is DatumRevisionT {
  return (
    isRecord(v) &&
    isStr(v.id) &&
    isStr(v.projectId) &&
    isStr(v.fromProjectId) &&
    isPosInt(v.version) &&
    isChanges(v.changes) &&
    isStr(v.reason) &&
    isStrOrNull(v.sourceLabel) &&
    isStr(v.requestedBy) &&
    isStrOrNull(v.findingId) &&
    isStrOrNull(v.clauseId) &&
    isStr(v.createdAt)
  );
}

function lineageOf(v: unknown): DatumLineageT | null {
  if (!isRecord(v)) return null;
  const { version, revisedFromProjectId, revisedFromVersion, latestVersionId, latestVersion } = v;
  if (!isPosInt(version) || !isStr(latestVersionId) || !isPosInt(latestVersion) || !isStrOrNull(revisedFromProjectId)) return null;
  if (revisedFromVersion !== null && !isPosInt(revisedFromVersion)) return null;
  return { version, revisedFromProjectId, revisedFromVersion, latestVersionId, latestVersion };
}

async function errorText(r: Response): Promise<string> {
  const body = (await r.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" && body.error !== "" ? body.error : `HTTP ${r.status}`;
}

/**
 * The thread, its change log and where this version sits in its lineage. A
 * message or revision that does not read is left out rather than taking the
 * drawer down; the lineage is null when it does not read.
 */
export async function fetchDatum(projectId: string): Promise<DatumRead> {
  const r = await fetch(`/tis-api/projects/${encodeURIComponent(projectId)}/datum`, { credentials: "include" });
  if (!r.ok) throw new DatumRequestError(await errorText(r), r.status);
  const data = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  return {
    // Only the boolean true turns the chat on.
    enabled: data?.enabled === true,
    messages: list(data?.messages).filter(isMessage),
    revisions: list(data?.revisions).filter(isRevision),
    lineage: lineageOf(data?.lineage),
  };
}

/** One event, if `v` is one this client knows, in the shape the contract gives it. */
function eventOf(v: unknown): DatumStreamEventT | null {
  if (!isRecord(v)) return null;
  switch (v.type) {
    case "text":
      return isStr(v.delta) ? { type: "text", delta: v.delta } : null;
    case "status":
      return isStr(v.message) ? { type: "status", message: v.message } : null;
    case "revision":
      return isStr(v.projectId) && isPosInt(v.version) && isChanges(v.changes)
        ? { type: "revision", projectId: v.projectId, version: v.version, changes: v.changes }
        : null;
    case "done":
      return isStr(v.messageId) ? { type: "done", messageId: v.messageId } : null;
    case "error":
      return isStr(v.message) ? { type: "error", message: v.message } : null;
    default:
      return null;
  }
}

/**
 * The events in `buffer` up to its last complete frame, and what is left of it
 * for the next chunk. A frame ends at a blank line. Line ends may be CRLF, LF or
 * CR; a CR at the very end is held back in `rest`, since the LF that would make
 * it one CRLF may be the next chunk's first byte. A frame of comment lines only
 * (`: ping`) is not an event; a frame whose data is not JSON, or not an event
 * this client knows, is dropped. Nothing here throws.
 */
export function parseSseChunk(buffer: string): { events: DatumStreamEventT[]; rest: string } {
  let held = "";
  let src = buffer;
  if (src.endsWith("\r")) {
    held = "\r";
    src = src.slice(0, -1);
  }
  const lines = src.replace(/\r\n|\r/g, "\n");
  const events: DatumStreamEventT[] = [];
  let from = 0;
  for (let end = lines.indexOf("\n\n", from); end >= 0; end = lines.indexOf("\n\n", from)) {
    const frame = lines.slice(from, end);
    from = end + 2;
    const data: string[] = [];
    for (const line of frame.split("\n")) {
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      if (field !== "data") continue;
      const value = colon < 0 ? "" : line.slice(colon + 1);
      data.push(value.startsWith(" ") ? value.slice(1) : value);
    }
    if (data.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.join("\n"));
    } catch {
      continue;
    }
    const event = eventOf(parsed);
    if (event) events.push(event);
  }
  return { events, rest: lines.slice(from) + held };
}

/**
 * Posts one message and hands each event of Datum's reply to `onEvent` as it
 * arrives. A refusal before the reply begins (400, 404, 429, 503, or no answer
 * at all) is a DatumRequestError carrying the server's own sentence. Aborting
 * `signal` stops the request; the promise then rejects with an AbortError. A
 * frame the stream ends inside is not an event.
 */
export async function sendDatum(
  projectId: string,
  body: DatumPostBody,
  onEvent: (e: DatumStreamEventT) => void,
  signal: AbortSignal,
): Promise<void> {
  let r: Response;
  try {
    r = await fetch(`/tis-api/projects/${encodeURIComponent(projectId)}/datum/messages`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal.aborted || (e instanceof Error && e.name === "AbortError")) throw e;
    throw new DatumRequestError(UNREACHABLE, 0);
  }
  if (!r.ok) throw new DatumRequestError(await errorText(r), r.status);
  if (!r.body) throw new DatumRequestError(`HTTP ${r.status}`, r.status);

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const { events, rest } = parseSseChunk(buffer + decoder.decode(value, { stream: true }));
      buffer = rest;
      for (const e of events) onEvent(e);
    }
    const { events } = parseSseChunk(buffer + decoder.decode());
    for (const e of events) onEvent(e);
  } finally {
    reader.releaseLock();
  }
}

/** The reply being written, as the drawer shows it until the saved thread replaces it. */
export type DatumStreamingT = {
  /** The engineer's message. */
  content: string;
  findingId: string | null;
  /** Datum's reply so far. */
  text: string;
  /** The re-running line, while a re-run runs. */
  status: string | null;
  /** The version the re-run made, as the stream names it. */
  revision: { projectId: string; version: number; changes: DatumChangeT[] } | null;
  /** An error to show beside the reply, when the reply does not already say it. */
  error: string | null;
  done: boolean;
};

export function startStreaming(content: string, findingId: string | null): DatumStreamingT {
  return { content, findingId, text: "", status: null, revision: null, error: null, done: false };
}

/**
 * The reply once `e` has arrived. Text after a status line ends it (a re-run
 * that was refused goes straight back to text), and so does the revision a
 * re-run made. When the model fails the server sends its line as text and then
 * the same line as an error: it is shown once, in the text.
 */
export function applyStreamEvent(s: DatumStreamingT, e: DatumStreamEventT): DatumStreamingT {
  switch (e.type) {
    case "text":
      return { ...s, text: s.text + e.delta, status: null };
    case "status":
      return { ...s, status: e.message };
    case "revision":
      return { ...s, revision: { projectId: e.projectId, version: e.version, changes: e.changes }, status: null };
    case "done":
      return { ...s, done: true, status: null };
    case "error": {
      const said = e.message.trim() !== "" && s.text.trimEnd().endsWith(e.message.trim());
      return said ? s : { ...s, error: e.message };
    }
    default:
      return s;
  }
}

/** The line for a reply whose stream ended before Datum said it was done. */
export const CONNECTION_CLOSED = "The connection closed before Datum finished. Reload the page to see what was saved.";

/** What the drawer says once a reply's stream has ended, beside the saved thread, or null for nothing. */
export function endNotice(s: DatumStreamingT): string | null {
  if (s.error !== null) return s.error;
  return s.done ? null : CONNECTION_CLOSED;
}

/** The body for a message, or null when there is nothing to send or too much. */
export function messageBody(draft: string, findingId: string | null): DatumPostBody | null {
  const content = draft.trim();
  if (content === "" || content.length > DATUM_MESSAGE_CHARS) return null;
  return findingId ? { content, findingId } : { content };
}

const JSON_CHARS = 120;

/** A changed field's value, read plainly on the change card. */
export function formatChangeValue(v: unknown): string {
  if (v === null || v === undefined) return "not set";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "number" || typeof v === "string") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "none";
    if (v.every((x) => typeof x === "string" || typeof x === "number")) return v.join(", ");
    const names = v.map((x) => (isRecord(x) && isStr(x.intersectionName) ? x.intersectionName.trim() : "")).filter((n) => n !== "");
    if (names.length === v.length) return `${v.length === 1 ? "timing sheet" : "timing sheets"} for ${names.join(", ")}`;
  }
  let json: string;
  try {
    json = JSON.stringify(v) ?? String(v);
  } catch {
    json = String(v);
  }
  return json.length > JSON_CHARS ? `${json.slice(0, JSON_CHARS - 1)}…` : json;
}
