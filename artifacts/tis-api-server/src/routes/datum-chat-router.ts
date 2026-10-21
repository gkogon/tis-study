/**
 * The Datum chat's two routes (docs/superpowers/specs/2026-10-20-datum-chat-design.md, "Routes"):
 *
 *   GET  /projects/:id/datum            the thread, the change log and where this version sits in its lineage
 *   POST /projects/:id/datum/messages   one engineer message; Datum's reply comes back as server-sent events
 *
 * Every piece of I/O is a dep, so verify-datum-chat.mjs mounts this factory on a real express app with
 * compression() and drives it over HTTP with fakes. ./datum-chat.ts hands it the real modules. This file imports
 * express and the datum-chat modules only (each by its explicit .ts path, so it loads under plain node): no db, no
 * store, no logger, no SDK. It logs through `req.log`, the request's redacting logger.
 *
 * Access works like GET /projects/:id: signed out is 401, and an id that is not a uuid or names another firm's
 * project is 404.
 *
 * The POST, in order: the limiter; sign-in; the id; the body (400); the chat switch (503); the project within the
 * firm (404); the firm's 24-hour reply cap (429); the focused finding, which must be one this engineer may see
 * (404). Then the thread is read, the grounding pack and the history are built and the model client is fetched,
 * all before anything is written, so a failure up to here leaves no orphan message. Then the engineer's message
 * is saved, the stream's headers go out, the tool loop runs, Datum's message is saved, and `done` ends the stream.
 *
 * It never answers 409 (R19). A re-run happens mid-stream, after the 200 has gone out, so a user who already has
 * one going is told so through the tool result, and Datum says it.
 *
 * While the stream is open, an SSE comment (`: ping`) goes out every 15 seconds so that no proxy drops a quiet
 * connection (R20). It is stopped when the engineer leaves and when the stream ends.
 *
 * The engineer closing the tab: `res.on("close")` before the response has ended. (Not `req.on("close")`: Node
 * fires that as soon as the request body has been read.) It aborts the loop, which stops the model and sends
 * nothing more, and lets a re-run that has begun finish. The route still saves Datum's message from the result:
 * the text so far with " (reply cut off)", the revision if one was made, the model and the tokens.
 *
 * Nothing of a failure's cause reaches the engineer or a saved message. `result.error` (R13), the re-run's own
 * failures (R15) and anything thrown here are passed to req.log.error and nowhere else.
 */
import { Router } from "express";
import type { IRouter, Request, RequestHandler } from "express";
import { DATUM_LIMITS, DatumChatPostBody } from "../lib/datum-chat/contract.ts";
import type { DatumChatReadResponse, DatumMessage, DatumRevision, DatumStreamEvent, RerunToolInput } from "../lib/datum-chat/contract.ts";
import { buildGroundingPack, readStudyPath } from "../lib/datum-chat/context.ts";
import type { VisibleFinding } from "../lib/datum-chat/context.ts";
import { buildHistory, buildSystem } from "../lib/datum-chat/prompt.ts";
import { runDatumTurn } from "../lib/datum-chat/run.ts";
import type { DatumClient, TurnResult } from "../lib/datum-chat/run.ts";
import type { ReviseResult } from "../lib/datum-chat/revise.ts";

// ---------------------------------------------------------------------------
// The deps
// ---------------------------------------------------------------------------

/** The signed-in user, as authMiddleware sets req.user. */
export type ChatUser = { id: string; email: string | null; firstName: string | null; lastName: string | null };

/** The study version, as getProject returns it, as far as the chat reads it. */
export type ChatProject = { id: string; requestPayload: unknown; resultPayload: unknown };

/** A row for insertMessage (lib/datum-chat/store.ts). */
export type ChatMessageRow = {
  projectId: string;
  firmId: string;
  /** The engineer; null for Datum. */
  userId: string | null;
  role: "engineer" | "datum";
  content: string;
  findingId?: string | null;
  revisionId?: string | null;
  model?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  stopReason?: string | null;
};

/** What the route hands the re-run besides the positional arguments. */
export type ReviseExtras = {
  /** The clause of the finding passed as `findingId` (R17); undefined when there is none. */
  clauseId: string | undefined;
  /** Where the re-run logs a failure's cause (R15): req.log.error. */
  log: (err: unknown, ctx: Record<string, unknown>) => void;
};

/** A re-run that worked carries the id of its study_revisions row, which Datum's message records. */
export type ChatReviseResult = ReviseResult & { revisionId?: string };

export type DatumChatDeps<Firm extends { id: string }> = {
  /** The model key is set. */
  isEnabled(): boolean;
  /** The model client, or null when there is none to be had. */
  getClient(): DatumClient | null | Promise<DatumClient | null>;
  /** The user's firm (getOrCreateFirmForUser). */
  resolveFirm(user: ChatUser): Promise<Firm>;
  /** The project within the firm, or null. */
  getProject(firmId: string, id: string): Promise<ChatProject | null>;
  /** The findings and decisions this engineer may see on the study's newest proofread run. */
  loadVisible(firmId: string, projectId: string): Promise<{ findings: VisibleFinding[]; dispositions: unknown[] }>;
  listMessages(firmId: string, projectId: string): Promise<DatumMessage[]>;
  insertMessage(row: ChatMessageRow): Promise<{ id: string }>;
  listRevisions(firmId: string, projectId: string): Promise<DatumRevision[]>;
  lineageFor(firmId: string, projectId: string): Promise<DatumChatReadResponse["lineage"]>;
  firmRepliesLast24h(firmId: string): Promise<number>;
  /**
   * The re-run, as reviseStudy runs it. `findingId` is the finding the route resolved against the visible set
   * (R17), never the model's word unchecked. It answers, and never throws.
   */
  revise(
    firm: Firm,
    user: ChatUser,
    parentId: string,
    input: RerunToolInput,
    messageId: string,
    findingId: string | undefined,
    extras: ReviseExtras,
  ): Promise<ChatReviseResult>;
  /** datumChatLimiter: run first on the POST. */
  limiter: RequestHandler;
  /** How often the open stream sends its keep-alive comment (R20). Defaults to KEEP_ALIVE_MS; the check uses less. */
  keepAliveMs?: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Canonical form only, as routes/proofread.ts: a looser pattern admits strings Postgres rejects as a 500.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SIGN_IN = "Sign in to use the Datum chat.";
const NOT_FOUND = "Project not found.";
const FINDING_NOT_FOUND = "Finding not found.";
const MESSAGE_LENGTH = `Write a message of 1 to ${DATUM_LIMITS.messageChars} characters.`;
const INVALID_BODY = "That message could not be read. Reload the page and try again.";
const CHAT_OFF = "Datum chat is off.";
const FIRM_CAP = `Datum has answered ${DATUM_LIMITS.firmRepliesPer24h} questions for your firm today. It picks up again within 24 hours.`;
const READ_FAILED = "Failed to load the Datum chat.";
const POST_FAILED = "Datum couldn't take that message just now. Try again in a moment.";
/** The stream's last event when something failed after the headers had gone out. */
const STREAM_FAILED = "Datum's reply could not be saved. Reload the page to see the thread as it was saved.";
const CUT_OFF = "(reply cut off)";

/**
 * R20: while the stream is open it sends an SSE comment frame this often. A reply can go quiet for 30 to 60
 * seconds (the engine waits on the analyzer, the road and transit fetches and the calibration map; the model's
 * thinking sends no text), and proxies between the engineer and the server drop idle connections after 30 to 120.
 * A comment is not an event: a reader skips it (the web parser must, as the check's does).
 */
const KEEP_ALIVE_MS = 15_000;
const KEEP_ALIVE_FRAME = ": ping\n\n";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function userOf(req: Request): ChatUser {
  const u = req.user!;
  return { id: u.id, email: u.email ?? null, firstName: u.firstName ?? null, lastName: u.lastName ?? null };
}

/**
 * The visible finding with this id, matched in any case: Postgres renders a uuid in lowercase, and the body and the
 * model may not. Undefined for an id this engineer may not see.
 */
function findVisible(findings: readonly VisibleFinding[], id: string | undefined): VisibleFinding | undefined {
  if (id === undefined) return undefined;
  const wanted = id.toLowerCase();
  return findings.find((f) => f.id.toLowerCase() === wanted);
}

/** What Datum's message saves: the reply, with the note when the engineer left before it was finished. */
function savedText(result: TurnResult): string {
  if (!result.cutOff) return result.text;
  const sofar = result.text.trimEnd();
  return sofar === "" ? CUT_OFF : `${sofar} ${CUT_OFF}`;
}

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

export function makeDatumChatRouter<Firm extends { id: string }>(deps: DatumChatDeps<Firm>): IRouter {
  const router: IRouter = Router();

  router.get("/projects/:id/datum", async (req, res): Promise<void> => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: SIGN_IN });
      return;
    }
    const id = String(req.params.id).toLowerCase();
    if (!UUID.test(id)) {
      res.status(404).json({ error: NOT_FOUND });
      return;
    }
    try {
      const firm = await deps.resolveFirm(userOf(req));
      if ((await deps.getProject(firm.id, id)) === null) {
        res.status(404).json({ error: NOT_FOUND });
        return;
      }
      // The lineage is served with the chat off too: the project page shows the version line either way.
      const lineage = await deps.lineageFor(firm.id, id);
      if (!deps.isEnabled()) {
        const off: DatumChatReadResponse = { enabled: false, messages: [], revisions: [], lineage };
        res.json(off);
        return;
      }
      const [messages, revisions] = await Promise.all([deps.listMessages(firm.id, id), deps.listRevisions(firm.id, id)]);
      const read: DatumChatReadResponse = { enabled: true, messages, revisions, lineage };
      res.json(read);
    } catch (err) {
      req.log.error({ err, projectId: id }, "datum-chat.read_failed");
      res.status(500).json({ error: READ_FAILED });
    }
  });

  router.post("/projects/:id/datum/messages", deps.limiter, async (req, res): Promise<void> => {
    if (!req.isAuthenticated()) {
      res.status(401).json({ error: SIGN_IN });
      return;
    }
    const id = String(req.params.id).toLowerCase();
    if (!UUID.test(id)) {
      res.status(404).json({ error: NOT_FOUND });
      return;
    }
    const parsed = DatumChatPostBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      const aboutContent = parsed.error.issues.some((i) => i.path[0] === "content");
      res.status(400).json({ error: aboutContent ? MESSAGE_LENGTH : INVALID_BODY });
      return;
    }
    if (!deps.isEnabled()) {
      res.status(503).json({ error: CHAT_OFF });
      return;
    }

    // The engineer can leave at any point from here. Before the engineer's message is saved, that means nothing is
    // done at all; after, the loop is told and the reply so far is saved.
    const left = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) left.abort();
    });

    const user = userOf(req);
    const log = (err: unknown, ctx: Record<string, unknown>, msg: string): void => {
      try {
        req.log.error({ err, projectId: id, ...ctx }, msg);
      } catch {
        // A logger that fails must not end the stream.
      }
    };

    try {
      const firm = await deps.resolveFirm(user);
      const project = await deps.getProject(firm.id, id);
      if (project === null) {
        res.status(404).json({ error: NOT_FOUND });
        return;
      }
      if ((await deps.firmRepliesLast24h(firm.id)) >= DATUM_LIMITS.firmRepliesPer24h) {
        res.status(429).json({ error: FIRM_CAP });
        return;
      }
      const visible = await deps.loadVisible(firm.id, id);
      const focus = findVisible(visible.findings, parsed.data.findingId);
      if (parsed.data.findingId !== undefined && focus === undefined) {
        res.status(404).json({ error: FINDING_NOT_FOUND });
        return;
      }

      // R12: the thread as it stands, without the message being answered; buildHistory adds that one itself.
      const earlier = await deps.listMessages(firm.id, id);
      const content = parsed.data.content;
      const stored = { request: project.requestPayload, result: project.resultPayload };
      const pack = buildGroundingPack({
        ...stored,
        findings: visible.findings,
        dispositions: visible.dispositions,
        ...(focus === undefined ? {} : { focusFindingId: focus.id }),
      });
      const system = buildSystem(pack.text);
      const messages = buildHistory(earlier, focus === undefined ? { content } : { content, focus });
      const client = await deps.getClient();
      if (client === null) {
        res.status(503).json({ error: CHAT_OFF });
        return;
      }
      // Gone before anything was saved: nothing is done. The response is ended all the same, so a request is never
      // left open.
      if (left.signal.aborted) {
        if (!res.writableEnded) res.end();
        return;
      }

      const asked = await deps.insertMessage({ projectId: id, firmId: firm.id, userId: user.id, role: "engineer", content, findingId: focus?.id ?? null });

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      const gone = (): boolean => left.signal.aborted || res.writableEnded || res.destroyed;
      /** The loop's sink. It throws once the engineer has gone, which the loop reads as a disconnect. */
      const emit = (event: DatumStreamEvent): void => {
        if (gone()) throw new Error("The engineer has left the chat.");
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        // compression() adds flush(); `no-transform` already keeps it from compressing this, so this is the
        // second guard against the reply arriving all at once.
        res.flush?.();
      };
      /** The route's own last events: dropped quietly once the engineer has gone. */
      const finish = (event: DatumStreamEvent): void => {
        try {
          emit(event);
        } catch {
          // Gone: there is no one to tell.
        }
      };

      // R20: the keep-alive. Stopped when the engineer leaves and in the finally below, and it never writes to a
      // response that has ended or lost its client.
      const keepAlive = setInterval(() => {
        if (gone()) {
          clearInterval(keepAlive);
          return;
        }
        try {
          res.write(KEEP_ALIVE_FRAME);
          res.flush?.();
        } catch {
          // A throw here would be uncaught, in a timer; stop instead.
          clearInterval(keepAlive);
        }
      }, deps.keepAliveMs ?? KEEP_ALIVE_MS);
      const stopKeepAlive = (): void => clearInterval(keepAlive);
      // An abort that already happened fires no event, so a client gone by now stops it here.
      if (left.signal.aborted) stopKeepAlive();
      else left.signal.addEventListener("abort", stopKeepAlive, { once: true });

      try {
        let revisionId: string | null = null;
        const revise = async (input: RerunToolInput): Promise<ReviseResult> => {
          // R17: the model's finding only if this engineer may see it, else the one they asked about, else none.
          const named = findVisible(visible.findings, input.findingId) ?? focus;
          try {
            const outcome = await deps.revise(firm, user, id, input, asked.id, named?.id, {
              clauseId: named?.clauseId,
              log: (err, ctx) => log(err, ctx, "datum-chat.revise_failed"),
            });
            if (outcome.ok && typeof outcome.revisionId === "string") revisionId = outcome.revisionId;
            return outcome;
          } catch (err) {
            // reviseStudy never throws; this is the wiring's own failure. The loop answers it generically.
            log(err, {}, "datum-chat.revise_threw");
            throw err;
          }
        };
        const readPath = (path: string): string => {
          try {
            return readStudyPath(stored, path);
          } catch (err) {
            log(err, { path }, "datum-chat.read_path_failed");
            throw err;
          }
        };

        const result = await runDatumTurn({ client, revise, readPath, emit, signal: left.signal }, { system, messages });
        // R13: the cause goes to the redacting logger only, never into a row or an event.
        if ("error" in result) log(result.error, { stopReason: result.stopReason }, "datum-chat.turn_failed");

        const saved = await deps.insertMessage({
          projectId: id,
          firmId: firm.id,
          userId: null,
          role: "datum",
          content: savedText(result),
          revisionId: result.revision === null ? null : revisionId,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          stopReason: result.stopReason,
        });
        finish({ type: "done", messageId: saved.id });
      } catch (err) {
        log(err, {}, "datum-chat.stream_failed");
        finish({ type: "error", message: STREAM_FAILED });
      } finally {
        stopKeepAlive();
        left.signal.removeEventListener("abort", stopKeepAlive);
        if (!res.writableEnded) res.end();
      }
    } catch (err) {
      log(err, {}, "datum-chat.post_failed");
      if (!res.headersSent) res.status(500).json({ error: POST_FAILED });
      else if (!res.writableEnded) res.end();
    }
  });

  return router;
}
