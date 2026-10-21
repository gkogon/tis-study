/**
 * The Datum chat on the study page (docs/superpowers/specs/2026-10-20-datum-chat-design.md,
 * "How it behaves"): a drawer on the right where an engineer asks Datum why a
 * finding was flagged and how to fix it. When the engineer asks for a change,
 * Datum re-runs the study with the corrected inputs as a new saved version; the
 * version on screen is never changed. The drawer shows that version as a change
 * card (each field from → to, the reason, the source, who asked) with a link to
 * it, and does not wait for the new version's own check: that version's page shows it.
 *
 * Everything the engineer and Datum wrote is rendered as plain text: React escapes
 * it, `whitespace-pre-wrap` keeps its line breaks, and nothing here reads it as
 * markdown or sets HTML from it.
 *
 * DatumChat holds the state and the requests; DrawerView, ThreadView and the
 * pieces under them draw it and hold none, so check-datum-chat.mjs renders them
 * for each state. useProjectDatum is the project page's part: whether the chat is
 * on, which drawer is open, and the box's question, consumed once. DatumChat and
 * useProjectDatum may use useState, useRef and useEffect only: the check calls them
 * under a runtime that has those three.
 *
 * The drawer sits beside the page rather than over it, so the engineer can read a
 * finding, or press another finding's "Ask about this", while it is open. It is
 * therefore not modal (aria-modal false), but it takes focus when it opens,
 * gives it back to what opened it when it closes, and closes on Escape from
 * anywhere on the page.
 *
 * Also here, because they read the same lineage: the version line on the project
 * page, and the version badge in the project list.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { Link } from "wouter";
import { Loader2, MessageSquare, Send, X } from "lucide-react";
import type { ProofreadFindingT } from "@/lib/proofread";
import {
  applyStreamEvent,
  changeLine,
  DATUM_MESSAGE_CHARS,
  DatumRequestError,
  endNotice,
  fetchDatum,
  messageBody,
  sendDatum,
  startStreaming,
  type DatumChangeT,
  type DatumLineageT,
  type DatumMessageT,
  type DatumRead,
  type DatumRevisionT,
  type DatumStreamingT,
} from "@/lib/datum-chat";

/** What "Ask about this" puts in the field: the owner's question. The engineer can change it before sending. */
export const DEFAULT_QUESTION = "Why was this flagged, and how do I fix it?";

const DRAWER_NOTE =
  "Ask why something was flagged and how to fix it. When you ask for a change, Datum re-runs the study as a new version. This version is never changed.";
const RELOAD_FAILED = "The chat could not be read again. Reload the page to see the thread as saved.";

const versionHref = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;
const sameId = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const when = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString() : "";
};

// ─── the stateful drawer ──────────────────────────────────────────────────────────

export type DatumChatProps = {
  projectId: string;
  /** The finding the engineer pressed "Ask about this" on, or null for the study as a whole. */
  focus: ProofreadFindingT | null;
  onClose(): void;
  /** A question typed in the panel's Ask Datum box: sent once, about the study as a whole, when it arrives. */
  ask?: { text: string; seq: number } | null;
  /**
   * Called with the box question's seq as soon as the drawer has taken it (sent it, or put it in the field), so
   * the page drops it: a drawer mounted again later, after a version link or Back, must not send it a second time.
   */
  onAskTaken?(seq: number): void;
  /** Called when a re-run has made a new version, so the page's version line can say so. */
  onRevised?(): void;
};

export function DatumChat({ projectId, focus, onClose, ask = null, onAskTaken, onRevised }: DatumChatProps) {
  const [read, setRead] = useState<DatumRead | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [about, setAbout] = useState<ProofreadFindingT | null>(focus);
  const [draft, setDraft] = useState(focus ? DEFAULT_QUESTION : "");
  const [streaming, setStreaming] = useState<DatumStreamingT | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  // The reply being written, if any: one at a time, and stopped when the drawer closes.
  const inFlight = useRef<AbortController | null>(null);
  const askedSeq = useRef<number | null>(null);
  const shownFocus = useRef<ProofreadFindingT | null>(focus);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  // The page's latest callbacks, for handlers that outlive the render that made them.
  const revised = useRef(onRevised);
  revised.current = onRevised;
  const close = useRef(onClose);
  close.current = onClose;
  const taken = useRef(onAskTaken);
  taken.current = onAskTaken;

  // Open: remember what opened the drawer, take focus, and close on Escape from anywhere on the page.
  // Closed: give focus back to what opened it.
  useEffect(() => {
    const active = document.activeElement;
    const opener = isFocusable(active) ? active : null;
    drawerRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener && opener.isConnected && opener !== document.body) opener.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchDatum(projectId).then(
      (r) => {
        if (!cancelled) setRead(r);
      },
      (e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Closing the drawer stops a reply still being written. The server saves what was written, and a re-run
  // already started still finishes.
  useEffect(() => () => inFlight.current?.abort(), []);

  // "Ask about this" on another finding while the drawer is open: name it, and offer the question.
  useEffect(() => {
    if (focus === shownFocus.current) return;
    shownFocus.current = focus;
    setAbout(focus);
    if (focus) setDraft((d) => (d.trim() === "" || d === DEFAULT_QUESTION ? DEFAULT_QUESTION : d));
  }, [focus]);

  // The field takes focus once there is one to type in, and again for each "Ask about this", so Enter sends the
  // question rather than pressing the button again. When a reply ends (the field was disabled while it streamed)
  // it takes focus back only if focus has not gone somewhere else on the page meanwhile.
  const enabled = read?.enabled === true;
  const busy = streaming !== null && !streaming.done;
  const focusField = (onlyIfFree: boolean): void => {
    const field = fieldRef.current;
    if (!field) return;
    const active = document.activeElement;
    if (onlyIfFree && active && active !== document.body && !drawerRef.current?.contains(active)) return;
    field.focus();
  };
  useEffect(() => {
    if (enabled && !busy) focusField(false);
  }, [enabled, focus]);
  useEffect(() => {
    if (enabled && !busy) focusField(true);
  }, [busy]);

  const messageCount = read?.messages.length ?? 0;
  const streamedChars = streaming?.text.length ?? -1;
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messageCount, streamedChars, streaming?.status, streaming?.revision]);

  const send = async (text: string, findingId: string | null): Promise<void> => {
    if (inFlight.current) return;
    const body = messageBody(text, findingId);
    if (!body) return;
    const controller = new AbortController();
    inFlight.current = controller;
    let reply = startStreaming(body.content, body.findingId ?? null);
    setStreaming(reply);
    setDraft("");
    setSendError(null);
    setNotice(null);
    try {
      await sendDatum(
        projectId,
        body,
        (e) => {
          reply = applyStreamEvent(reply, e);
          setStreaming(reply);
          // The new version exists from this event on.
          if (e.type === "revision") revised.current?.();
        },
        controller.signal,
      );
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof DatumRequestError) {
        // Refused before anything was saved: say why, and put the question back in the field.
        inFlight.current = null;
        setStreaming(null);
        setDraft(text);
        setSendError(e.message);
        return;
      }
      // The stream broke after the message was saved. endNotice says so below.
    }
    if (controller.signal.aborted) return;
    // The thread as saved replaces what was streamed.
    try {
      const next = await fetchDatum(projectId);
      setRead(next);
      setStreaming(null);
      setNotice(endNotice(reply));
    } catch {
      setStreaming({ ...reply, done: true });
      setNotice(endNotice(reply) ?? RELOAD_FAILED);
    } finally {
      inFlight.current = null;
    }
  };

  // A question from the panel's box, once the thread is loaded and the chat is on.
  useEffect(() => {
    if (!ask || askedSeq.current === ask.seq || read?.enabled !== true) return;
    askedSeq.current = ask.seq;
    taken.current?.(ask.seq);
    setAbout(null);
    // A reply is still being written: the question waits in the field.
    if (inFlight.current) setDraft(ask.text);
    else void send(ask.text, null);
  }, [ask, read]);

  return (
    <DrawerView
      projectId={projectId}
      read={read}
      loadError={loadError}
      focus={about}
      draft={draft}
      streaming={streaming}
      notice={notice}
      sendError={sendError}
      onDraft={setDraft}
      onSend={() => void send(draft, about?.id ?? null)}
      onClearFocus={() => {
        setAbout(null);
        setDraft((d) => (d === DEFAULT_QUESTION ? "" : d));
      }}
      onClose={onClose}
      scrollRef={scrollRef}
      drawerRef={drawerRef}
      fieldRef={fieldRef}
    />
  );
}

/** What has a focus method and can say whether it is still on the page: an element, in the browser. */
function isFocusable(v: unknown): v is HTMLElement {
  return typeof v === "object" && v !== null && typeof (v as HTMLElement).focus === "function" && "isConnected" in v;
}

// ─── what it draws ─────────────────────────────────────────────────────────────────

export type DrawerViewProps = {
  projectId: string;
  read: DatumRead | null;
  loadError: string | null;
  focus: ProofreadFindingT | null;
  draft: string;
  streaming: DatumStreamingT | null;
  /** What the last reply's stream ended on, shown under the thread. */
  notice: string | null;
  /** Why the server refused the last message. */
  sendError: string | null;
  onDraft(text: string): void;
  onSend(): void;
  onClearFocus(): void;
  onClose(): void;
  scrollRef?: Ref<HTMLDivElement>;
  /** The drawer itself, which takes focus when it opens. */
  drawerRef?: Ref<HTMLElement>;
  /** The message field, which takes focus once it is there. */
  fieldRef?: Ref<HTMLTextAreaElement>;
};

const TITLE_ID = "datum-drawer-title";

export function DrawerView(p: DrawerViewProps) {
  const enabled = p.read?.enabled === true;
  return (
    <aside
      ref={p.drawerRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={TITLE_ID}
      tabIndex={-1}
      className="fixed inset-y-0 right-0 z-50 w-full sm:w-[28rem] flex flex-col bg-background border-l shadow-xl outline-none"
      data-testid="drawer-datum"
    >
      <header className="flex items-start justify-between gap-3 p-4 border-b">
        <div>
          <h2 id={TITLE_ID} className="text-sm font-semibold">
            Ask Datum
          </h2>
          <p className="text-xs text-muted-foreground">{DRAWER_NOTE}</p>
        </div>
        <button type="button" onClick={p.onClose} aria-label="Close the chat" className="p-1 rounded-md hover:bg-muted" data-testid="button-datum-close">
          <X className="w-4 h-4" />
        </button>
      </header>

      <div ref={p.scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {!p.read ? (
          p.loadError ? (
            <div className="text-xs text-red-600">Could not load the chat: {p.loadError}</div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading the chat…
            </div>
          )
        ) : !enabled ? (
          <div className="text-sm text-muted-foreground">Datum chat is off.</div>
        ) : (
          <ThreadView
            projectId={p.projectId}
            revisedFromVersion={p.read.lineage?.revisedFromVersion ?? null}
            messages={p.read.messages}
            revisions={p.read.revisions}
            streaming={p.streaming}
          />
        )}
        {p.notice && (
          <div className="text-xs text-amber-700" data-testid="datum-notice">
            {p.notice}
          </div>
        )}
      </div>

      {enabled && (
        <Composer
          focus={p.focus}
          draft={p.draft}
          busy={p.streaming !== null && !p.streaming.done}
          sendError={p.sendError}
          onDraft={p.onDraft}
          onSend={p.onSend}
          onClearFocus={p.onClearFocus}
          fieldRef={p.fieldRef}
        />
      )}
    </aside>
  );
}

export function Composer({
  focus,
  draft,
  busy,
  sendError,
  onDraft,
  onSend,
  onClearFocus,
  fieldRef,
}: {
  focus: ProofreadFindingT | null;
  draft: string;
  /** A reply is being written: nothing more can be sent until it ends. */
  busy: boolean;
  sendError: string | null;
  onDraft(text: string): void;
  onSend(): void;
  onClearFocus(): void;
  fieldRef?: Ref<HTMLTextAreaElement>;
}) {
  const left = DATUM_MESSAGE_CHARS - draft.length;
  const canSend = !busy && messageBody(draft, null) !== null;
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter is a new line. Not while an input method is composing a character.
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (canSend) onSend();
  };
  return (
    <form
      className="border-t p-3 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
      data-testid="form-datum"
    >
      {focus && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground" data-testid="datum-focus">
          <span className="truncate">
            About: <span className="font-medium text-foreground">{focus.title}</span>
          </span>
          <button
            type="button"
            onClick={onClearFocus}
            aria-label="Ask about the study as a whole instead"
            className="shrink-0 p-0.5 rounded hover:bg-muted"
            data-testid="button-datum-clear-focus"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {sendError && (
        <div className="text-xs text-red-600" data-testid="datum-send-error">
          {sendError}
        </div>
      )}
      <textarea
        ref={fieldRef}
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={onKeyDown}
        maxLength={DATUM_MESSAGE_CHARS}
        rows={3}
        disabled={busy}
        placeholder="Ask why something was flagged, or ask for a change"
        aria-label="Your message to Datum"
        className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
        data-testid="input-datum-message"
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground" data-testid="datum-chars-left">
          {left >= 0 ? `${left} characters left` : `${-left} characters over the limit`}
        </span>
        <button
          type="submit"
          disabled={!canSend}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border hover:bg-muted disabled:opacity-50"
          data-testid="button-datum-send"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Send
        </button>
      </div>
    </form>
  );
}

/**
 * The thread of one study version: the revision that made it, if any, as a
 * header; every message, each Datum message that made a version followed by
 * that version's change card; and the reply being written.
 */
export function ThreadView({
  projectId,
  revisedFromVersion,
  messages,
  revisions,
  streaming,
}: {
  projectId: string;
  /** The version this one was revised from (lineage.revisedFromVersion): not always this one minus one. */
  revisedFromVersion: number | null;
  messages: DatumMessageT[];
  revisions: DatumRevisionT[];
  streaming: DatumStreamingT | null;
}) {
  const header = revisions.find((r) => sameId(r.projectId, projectId)) ?? null;
  const made = revisions.filter((r) => sameId(r.fromProjectId, projectId) && !sameId(r.projectId, projectId));
  const byId = new Map(made.map((r) => [r.id.toLowerCase(), r]));
  const named = new Set(messages.map((m) => m.revisionId?.toLowerCase()).filter((id): id is string => !!id && byId.has(id)));
  // A version no message names is still shown, never dropped.
  const unnamed = made.filter((r) => !named.has(r.id.toLowerCase()));
  return (
    <div className="space-y-3" data-testid="datum-thread">
      {header && <ThreadHeader revision={header} fromVersion={revisedFromVersion} />}
      {messages.length === 0 && !streaming && unnamed.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No questions yet. Ask about a finding with its Ask about this button, or about the study as a whole.
        </p>
      )}
      {messages.map((m) => {
        const r = m.revisionId ? byId.get(m.revisionId.toLowerCase()) : undefined;
        return (
          <div key={m.id} className="space-y-3">
            <MessageBubble
              role={m.role}
              who={m.role === "datum" ? "Datum" : (m.authorName ?? "A member of your firm")}
              at={when(m.createdAt)}
              content={m.content}
            />
            {r && <ChangeCard projectId={r.projectId} version={r.version} changes={r.changes} meta={r} />}
          </div>
        );
      })}
      {unnamed.map((r) => (
        <ChangeCard key={r.id} projectId={r.projectId} version={r.version} changes={r.changes} meta={r} />
      ))}
      {streaming && <StreamingView s={streaming} />}
    </div>
  );
}

function MessageBubble({ role, who, at, content }: { role: "engineer" | "datum"; who: string; at: string; content: string }) {
  return (
    <div className={`rounded-lg border p-3 ${role === "engineer" ? "bg-muted/30" : ""}`} data-testid={`datum-message-${role}`}>
      <div className="text-xs text-muted-foreground mb-1">{at ? `${who} · ${at}` : who}</div>
      <p className="text-sm whitespace-pre-wrap break-words">{content}</p>
    </div>
  );
}

function StreamingView({ s }: { s: DatumStreamingT }) {
  return (
    <>
      <MessageBubble role="engineer" who="You" at="" content={s.content} />
      <div className="rounded-lg border p-3" data-testid="datum-streaming">
        <div className="text-xs text-muted-foreground mb-1">Datum</div>
        {s.text !== "" ? (
          <p className="text-sm whitespace-pre-wrap break-words">{s.text}</p>
        ) : !s.done && s.error === null ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Datum is writing…
          </p>
        ) : null}
      </div>
      {s.status && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="datum-status">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          {s.status}
        </div>
      )}
      {s.revision && <ChangeCard projectId={s.revision.projectId} version={s.revision.version} changes={s.revision.changes} />}
      {s.error && (
        <div className="text-xs text-red-600" data-testid="datum-stream-error">
          {s.error}
        </div>
      )}
    </>
  );
}

function ChangeLines({ changes }: { changes: DatumChangeT[] }) {
  if (changes.length === 0) {
    return <p className="text-xs">No inputs changed: the study was re-run on the current engine with the same inputs.</p>;
  }
  return (
    <ul className="text-xs space-y-0.5">
      {changes.map((c, i) => (
        <li key={`${c.field}:${i}`} className="break-words">
          {changeLine(c)}
        </li>
      ))}
    </ul>
  );
}

/** The log row's own words: why, on what source, and who asked. */
function RevisionMeta({ reason, sourceLabel, requestedBy, createdAt }: Pick<DatumRevisionT, "reason" | "sourceLabel" | "requestedBy" | "createdAt">) {
  const at = when(createdAt);
  return (
    <>
      <p className="text-xs whitespace-pre-wrap break-words">
        <span className="text-muted-foreground">Reason: </span>
        {reason}
      </p>
      <p className="text-xs whitespace-pre-wrap break-words">
        <span className="text-muted-foreground">Source: </span>
        {sourceLabel ?? "no source given"}
      </p>
      <p className="text-xs text-muted-foreground">{at ? `Asked by ${requestedBy} · ${at}` : `Asked by ${requestedBy}`}</p>
    </>
  );
}

/**
 * A version a re-run made from this one. Drawn from the stream as soon as the
 * version exists (its changes and its link), and from the saved log row after
 * (with the reason, the source and who asked).
 */
export function ChangeCard({
  projectId,
  version,
  changes,
  meta,
}: {
  projectId: string;
  version: number;
  changes: DatumChangeT[];
  meta?: Pick<DatumRevisionT, "reason" | "sourceLabel" | "requestedBy" | "createdAt">;
}) {
  return (
    <div className="border rounded-lg p-3 space-y-2 bg-blue-50/60 dark:bg-blue-950/20" data-testid="datum-change-card">
      <div className="text-xs font-semibold">{`Re-run saved as Version ${version}`}</div>
      <ChangeLines changes={changes} />
      {meta && <RevisionMeta reason={meta.reason} sourceLabel={meta.sourceLabel} requestedBy={meta.requestedBy} createdAt={meta.createdAt} />}
      <p className="text-xs">
        Open{" "}
        <Link href={versionHref(projectId)} className="font-medium text-blue-700 hover:underline" data-testid="link-datum-version">
          {`Version ${version}`}
        </Link>{" "}
        to see its findings.
      </p>
    </div>
  );
}

/** The top of a revised version's own thread: what it was revised from, and how. */
function ThreadHeader({ revision, fromVersion }: { revision: DatumRevisionT; fromVersion: number | null }) {
  return (
    <div className="border rounded-lg p-3 space-y-2 bg-muted/30" data-testid="datum-thread-header">
      <div className="text-xs font-semibold">
        Revised from{" "}
        {fromVersion !== null ? (
          <Link href={versionHref(revision.fromProjectId)} className="text-blue-700 hover:underline">
            {`Version ${fromVersion}`}
          </Link>
        ) : (
          "an earlier version"
        )}
      </div>
      <ChangeLines changes={revision.changes} />
      <RevisionMeta reason={revision.reason} sourceLabel={revision.sourceLabel} requestedBy={revision.requestedBy} createdAt={revision.createdAt} />
    </div>
  );
}

// ─── on the proofread panel ──────────────────────────────────────────────────────────

/** The box at the top of the proofread panel, for a question about the study as a whole. */
export function AskDatumBox({ onAsk }: { onAsk(text: string): void }) {
  const [text, setText] = useState("");
  const submit = () => {
    const question = text.trim();
    if (question === "") return;
    onAsk(question);
    setText("");
  };
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      data-testid="box-ask-datum"
    >
      <MessageSquare className="w-4 h-4 shrink-0 text-muted-foreground" />
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={DATUM_MESSAGE_CHARS}
        placeholder="Ask Datum about this study"
        aria-label="Ask Datum about this study"
        className="flex-1 min-w-0 px-3 py-1.5 text-sm rounded-md border bg-background"
        data-testid="input-ask-datum"
      />
      <button
        type="submit"
        disabled={text.trim() === ""}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border hover:bg-muted disabled:opacity-50"
        data-testid="button-ask-datum-study"
      >
        Ask Datum
      </button>
    </form>
  );
}

/** What the proofread panel is handed when the chat is on: an Ask button on each card, and the box. */
export type PanelChat = { onAsk: (f: ProofreadFindingT) => void; askBox: ReactNode };

/**
 * The panel's part of the chat, or undefined while the chat is off, not yet
 * loaded, or could not be loaded: the panel then looks exactly as it does
 * without the chat.
 */
export function chatForPanel(
  read: DatumRead | null,
  handlers: { onAsk(f: ProofreadFindingT): void; onAskStudy(text: string): void },
): PanelChat | undefined {
  if (read?.enabled !== true) return undefined;
  return { onAsk: handlers.onAsk, askBox: <AskDatumBox onAsk={handlers.onAskStudy} /> };
}

// ─── on the project page ─────────────────────────────────────────────────────────────

type OpenDrawer = { projectId: string; focus: ProofreadFindingT | null; ask: { text: string; seq: number } | null };

/**
 * The project page's part of the chat, for the TIS study `projectId` (null for
 * any other study, or while the page is between versions): the read (its lineage
 * is the version line), what the proofread panel is handed, and the drawer.
 *
 * Moving to another version (a version link, Back) closes the drawer, and a
 * question from the box is dropped as soon as the drawer has taken it. The page
 * component stays mounted across versions (one route for every /projects/:id), so
 * without both, coming back to a version would mount the drawer again with the
 * old question and send it again under the engineer's name.
 */
export function useProjectDatum(projectId: string | null): { read: DatumRead | null; chat: PanelChat | undefined; drawer: ReactNode } {
  const [datum, setDatum] = useState<{ projectId: string; read: DatumRead } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [open, setOpen] = useState<OpenDrawer | null>(null);
  const askSeq = useRef(0);
  // The last box question a drawer took. A drawer is never handed it, or an older one, again.
  const takenSeq = useRef(0);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchDatum(projectId).then(
      (read) => {
        if (!cancelled) setDatum({ projectId, read });
      },
      () => {
        // Left out: no version line and no chat, and the page is as it was.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId, nonce]);

  // Another version, or none: the drawer closes, and nothing it was opened with carries over.
  useEffect(() => {
    setOpen((o) => (o && o.projectId !== projectId ? null : o));
  }, [projectId]);

  if (!projectId) return { read: null, chat: undefined, drawer: null };
  const id = projectId;
  const read = datum && datum.projectId === id ? datum.read : null;
  const shown = open && open.projectId === id ? open : null;
  const chat = chatForPanel(read, {
    // A box question not yet taken is kept: it is still on its way.
    onAsk: (f) => setOpen((o) => ({ projectId: id, focus: f, ask: o && o.projectId === id ? o.ask : null })),
    onAskStudy: (text) => setOpen({ projectId: id, focus: null, ask: { text, seq: ++askSeq.current } }),
  });
  const ask = shown?.ask && shown.ask.seq > takenSeq.current ? shown.ask : null;
  const drawer = shown ? (
    <DatumChat
      key={id}
      projectId={id}
      focus={shown.focus}
      ask={ask}
      onAskTaken={(seq) => {
        takenSeq.current = Math.max(takenSeq.current, seq);
        setOpen((o) => (o && o.ask?.seq === seq ? { ...o, ask: null } : o));
      }}
      onClose={() => setOpen(null)}
      onRevised={() => setNonce((n) => n + 1)}
    />
  ) : null;
  return { read, chat, drawer };
}

// ─── versions ───────────────────────────────────────────────────────────────────────

/**
 * "Version 2 · revised from Version 1", and "A newer version exists: Version 3"
 * when there is one, each linked. Nothing for an original nobody has revised.
 */
export function VersionLine({ lineage }: { lineage: DatumLineageT | null }) {
  if (!lineage) return null;
  const newer = lineage.latestVersion > lineage.version;
  if (lineage.version <= 1 && !newer) return null;
  return (
    <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap" data-testid="project-version-line">
      <span className="font-medium text-foreground">{`Version ${lineage.version}`}</span>
      {lineage.revisedFromProjectId !== null && lineage.revisedFromVersion !== null && (
        <span>
          {" · revised from "}
          <Link href={versionHref(lineage.revisedFromProjectId)} className="text-blue-700 hover:underline" data-testid="link-revised-from">
            {`Version ${lineage.revisedFromVersion}`}
          </Link>
        </span>
      )}
      {newer && (
        <span>
          {" · A newer version exists: "}
          <Link href={versionHref(lineage.latestVersionId)} className="text-blue-700 hover:underline" data-testid="link-latest-version">
            {`Version ${lineage.latestVersion}`}
          </Link>
        </span>
      )}
    </div>
  );
}

/** The project list's "v2" beside a version past the first. */
export function VersionBadge({ version }: { version: number }) {
  if (!Number.isInteger(version) || version <= 1) return null;
  return (
    <span
      className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-muted text-muted-foreground"
      title={`Version ${version}`}
      data-testid="badge-project-version"
    >
      {`v${version}`}
    </span>
  );
}
