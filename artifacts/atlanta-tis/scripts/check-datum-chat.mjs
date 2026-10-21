/**
 * Check for the Datum chat on the study page: the client and its stream parser
 * (src/lib/datum-chat.ts), the drawer, the change card and the version line
 * (src/components/datum-chat.tsx), and the "Ask about this" button the proofread
 * panel's finding card carries when the chat is on (src/components/proofread-panel.tsx).
 *
 * The components are bundled with esbuild (the copy vite itself runs on, so this
 * package needs no bundler of its own) and rendered with react-dom/server, the way
 * verify-proofread-copy.mjs renders ProofreadView: the assertions read what a user
 * would see. The stream parser and the client are driven with stubbed fetch answers
 * shaped as the server sends them (artifacts/tis-api-server/src/routes/datum-chat-router.ts):
 * `data: <json>` frames, `: ping` keep-alive comments (R20), CRLF line ends, and
 * chunks split anywhere, mid-JSON and mid-character included.
 *
 * DatumChat itself, the stateful drawer, is called as a plain function under a
 * minimal hooks runtime (useState, useRef, useEffect: the only hooks it may use),
 * and the DrawerView element it returns is read for what it hands the view and
 * rendered for what it shows. Its handlers are called the way the view would call them.
 *
 * Run: `pnpm --filter @workspace/atlanta-tis run check:datum-chat`
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const atlanta = path.resolve(here, "..");
const repo = path.resolve(atlanta, "../..");
const req = createRequire(import.meta.url);
// vite's own esbuild: this package depends on vite, and vite on esbuild.
const { build } = createRequire(req.resolve("vite/package.json"))("esbuild");

const FILES = {
  chat: "artifacts/atlanta-tis/src/components/datum-chat.tsx",
  lib: "artifacts/atlanta-tis/src/lib/datum-chat.ts",
  panel: "artifacts/atlanta-tis/src/components/proofread-panel.tsx",
  page: "artifacts/atlanta-tis/src/pages/project-detail.tsx",
  list: "artifacts/atlanta-tis/src/pages/projects.tsx",
};
const SRC = Object.fromEntries(
  Object.entries(FILES).map(([k, rel]) => {
    try {
      return [k, readFileSync(path.join(repo, rel), "utf8")];
    } catch {
      return [k, ""];
    }
  }),
);
const CHAT_ABS = path.join(repo, FILES.chat);

let fails = 0;
let passes = 0;
const ok = (id, cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  [${id}] ${msg}`);
  if (cond) passes++;
  else fails++;
};
const group = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`threw:${name}`, false, `${name} threw: ${e instanceof Error ? e.stack : String(e)}`);
  }
};

// ─── the bundle ─────────────────────────────────────────────────────────────────────
// DatumChat's own `react` import goes to a module that forwards its hooks to the runtime
// mountChat installs, and to React when none is installed (every other render below).
const HOOKS_KEY = "__datumChatCheckHooks";
const HOOKS_SHIM = `
import * as React from "react";
export * from "react";
export default React;
const own = () => globalThis.${HOOKS_KEY};
export const useState = (...a) => (own() ?? React).useState(...a);
export const useRef = (...a) => (own() ?? React).useRef(...a);
export const useEffect = (...a) => (own() ?? React).useEffect(...a);
`;
const ENTRY = `
export * as chat from "@/components/datum-chat";
export * as lib from "@/lib/datum-chat";
export { ProofreadView } from "@/components/proofread-panel";
export { createElement, Fragment } from "react";
export { renderToStaticMarkup } from "react-dom/server";
export { Router } from "wouter";
`;
let mod;
try {
  const out = await build({
    absWorkingDir: atlanta,
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    jsx: "automatic",
    tsconfigRaw: "{}",
    define: { "process.env.NODE_ENV": '"development"' },
    alias: { "@": path.join(atlanta, "src") },
    banner: { js: `import { createRequire as __cr } from "node:module"; const require = __cr(${JSON.stringify(import.meta.url)});` },
    logLevel: "silent",
    stdin: { contents: ENTRY, resolveDir: atlanta, sourcefile: "datum-chat-entry.ts", loader: "ts" },
    plugins: [
      {
        name: "datum-chat-hooks",
        setup(b) {
          b.onResolve({ filter: /^react$/ }, (a) => (a.importer === CHAT_ABS ? { path: "react", namespace: "chat-hooks" } : undefined));
          b.onLoad({ filter: /.*/, namespace: "chat-hooks" }, () => ({ contents: HOOKS_SHIM, loader: "js", resolveDir: atlanta }));
        },
      },
    ],
  });
  mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
  ok("bundles", true, "the chat, its client module and the proofread panel bundle with esbuild");
} catch (e) {
  ok("bundles", false, `the chat, its client module and the proofread panel bundle with esbuild: ${(e.errors ?? []).map((x) => x.text).join("; ") || e.message}`);
  console.log(`\n${fails} CHECK(S) FAILED`);
  process.exit(1);
}
const { chat, lib, ProofreadView, createElement, renderToStaticMarkup, Router } = mod;

// ─── helpers ────────────────────────────────────────────────────────────────────────
const text = (html) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
const count = (s, sub) => s.split(sub).length - 1;
const phraseForm = (s) => s.replace(/[-‐-―]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
const BANNED_COPY = /independent[\s-]*review|second[\s-]*opinion|peer[\s-]*review|qa\s*[/\\-]?\s*qc|\baudit/i;
const bannedIn = (s) => BANNED_COPY.exec(phraseForm(s))?.[0] ?? null;
/** Inside a router, so wouter's Link can render on the server. */
const render = (el, at = "/projects/x") => renderToStaticMarkup(createElement(Router, { ssrPath: at }, el));
const everyHtml = [];
const keep = (html) => (everyHtml.push(html), html);
const tick = () => new Promise((r) => setImmediate(r));

const warnings = [];
const realError = console.error;
console.error = (...a) => warnings.push(a.map(String).join(" ").slice(0, 300));
const realFetch = globalThis.fetch;

// Ids as Postgres renders them.
const V1 = "1a2b3c4d-0000-4000-8000-000000000001";
const V2 = "1a2b3c4d-0000-4000-8000-000000000002";
const V3 = "1a2b3c4d-0000-4000-8000-000000000003";
const R2 = "2b3c4d5e-0000-4000-8000-000000000002";
const R3 = "2b3c4d5e-0000-4000-8000-000000000003";
const M1 = "3c4d5e6f-0000-4000-8000-000000000001";
const M2 = "3c4d5e6f-0000-4000-8000-000000000002";
const M3 = "3c4d5e6f-0000-4000-8000-000000000003";
const F1 = "4d5e6f70-0000-4000-8000-000000000001";
const COULDNT = "Datum couldn't answer that just now.";
const FIRM_CAP = "Datum has answered 300 questions for your firm today. It picks up again within 24 hours.";
const STREAM_FAILED = "Datum's reply could not be saved. Reload the page to see the thread as it was saved.";

const msg = (id, role, content, o = {}) => ({
  id,
  role,
  content,
  authorName: role === "engineer" ? "Pat Engineer" : null,
  findingId: null,
  revisionId: null,
  createdAt: "2026-10-20T15:00:00.000Z",
  ...o,
});
const rev = (o = {}) => ({
  id: R2,
  projectId: V2,
  fromProjectId: V1,
  version: 2,
  changes: [{ field: "growthRatePct", from: 2.1, to: 1 }],
  reason: "The county's count program shows 1% a year on this corridor.",
  sourceLabel: null,
  requestedBy: "Pat Engineer",
  findingId: F1,
  clauseId: "growthOverrideDisclosed",
  createdAt: "2026-10-20T15:01:00.000Z",
  ...o,
});
const lineage = (o = {}) => ({ version: 1, revisedFromProjectId: null, revisedFromVersion: null, latestVersionId: V1, latestVersion: 1, ...o });
const readOf = (o = {}) => ({ enabled: true, messages: [], revisions: [], lineage: lineage(), ...o });
// A finding as the proofread GET sends it.
const finding = (clauseId, type, o = {}) => ({
  id: `f-${clauseId}`,
  clauseId,
  section: 4,
  type,
  title: `${clauseId} title`,
  detail: `${clauseId} detail`,
  sourceLabel: `${clauseId} source`,
  readPaths: [{ path: "result.x", value: 1 }],
  remedy: `${clauseId} remedy`,
  fingerprint: `fp-${clauseId}`,
  ...o,
});
const runOf = (status, o = {}) => ({
  status,
  runId: "run-uuid",
  coverage: [{ clauseId: "growthOverrideDisclosed", section: 1, status: "ran" }],
  findings: [],
  dispositions: [],
  withheld: 0,
  rulesChanged: false,
  ...o,
});
const FOUR = [
  finding("growthOverrideDisclosed", "BLOCKER"),
  finding("screeningClampDisclosed", "DISCLOSE"),
  finding("scopeNoteConsistent", "NOTE"),
  finding("vcPlausibility", "CONTESTED"),
];
// The NOTE has a decision that closes it: it is still a finding the engineer can ask about.
const FOUR_DECIDED = [{ findingId: "f-scopeNoteConsistent", disposition: "DISCLOSED", note: null, sourceLabel: null, createdAt: "2026-10-20T12:00:00Z" }];
const panelView = (run, o = {}) => createElement(ProofreadView, { run, error: null, busy: false, onRerun() {}, onTriage() {}, ...o });

/** The elements of a tree whose data-testid is `id` (the view is hook-free, so it can be called as a function). */
const byTestId = (root, id) => {
  const found = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.props) {
      if (n.props["data-testid"] === id) found.push(n);
      walk(n.props.children);
    }
  };
  walk(root);
  return found;
};

const enc = new TextEncoder();
/** A response body that hands over the given byte chunks, one per read. */
const bodyOf = (chunks) =>
  new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(typeof ch === "string" ? enc.encode(ch) : ch);
      c.close();
    },
  });
/** A response body the test writes into as it goes, and that errors with AbortError when `signal` aborts. */
const liveBody = (signal) => {
  let ctl;
  const stream = new ReadableStream({
    start(c) {
      ctl = c;
    },
  });
  signal?.addEventListener("abort", () => {
    try {
      ctl.error(new DOMException("The operation was aborted.", "AbortError"));
    } catch {
      // closed already
    }
  });
  return { stream, push: (s) => ctl.enqueue(enc.encode(s)), close: () => ctl.close() };
};
const frame = (e) => `data: ${JSON.stringify(e)}\n\n`;
/** Whether an opening tag's attributes carry the disabled attribute (not the disabled: variant in a class name). */
const hasDisabled = (attrs) => /(^|\s)disabled(=""|\s|$)/.test(attrs ?? "");
const tagOf = (html, testid) => new RegExp(`<[a-z]+\\b[^>]*data-testid="${testid}"[^>]*>`).exec(html)?.[0] ?? "";
const sse = (body) => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

try {
  // ─── 1. PARSING ────────────────────────────────────────────────────────────────────
  await group("parseSseChunk", () => {
    const p = lib.parseSseChunk;
    ok("exports-parse", typeof p === "function", "lib/datum-chat.ts exports parseSseChunk");
    if (typeof p !== "function") return;
    const a = p('data: {"type":"text","delta":"a"}\n\ndata: {"ty');
    ok(
      "parse-split-frame-kept",
      isDeepStrictEqual(a.events, [{ type: "text", delta: "a" }]) && a.rest === 'data: {"ty',
      `a complete frame and the start of the next: one event, and the start kept as rest (got ${JSON.stringify(a)})`,
    );
    const crlf = p(`data: {"type":"text","delta":"a"}\r\n\r\ndata: {"type":"done","messageId":"${M1}"}\r\n\r\n`);
    ok(
      "parse-crlf",
      isDeepStrictEqual(crlf.events, [{ type: "text", delta: "a" }, { type: "done", messageId: M1 }]) && crlf.rest === "",
      `frames separated by \\r\\n\\r\\n parse (got ${JSON.stringify(crlf)})`,
    );
    let threw = null;
    let bad;
    try {
      bad = p('data: {"type":"text","delta":"a"}\n\ndata: {not json\n\ndata: {"type":"text","delta":"b"}\n\n');
    } catch (e) {
      threw = e;
    }
    ok(
      "parse-malformed-dropped",
      threw === null && isDeepStrictEqual(bad?.events, [{ type: "text", delta: "a" }, { type: "text", delta: "b" }]),
      `a frame whose JSON is malformed is dropped, not thrown, and the frames around it are kept (got ${threw ? `a throw: ${threw.message}` : JSON.stringify(bad?.events)})`,
    );
    const ping = p(`: ping\n\ndata: {"type":"status","message":"Re-running…"}\n\n: ping\n\n`);
    ok("parse-ping-skipped", isDeepStrictEqual(ping.events, [{ type: "status", message: "Re-running…" }]) && ping.rest === "", `a keep-alive comment frame is not an event (got ${JSON.stringify(ping)})`);
    ok("parse-ping-alone", isDeepStrictEqual(p(": ping\n\n"), { events: [], rest: "" }), "a buffer holding only a keep-alive gives no event and no rest");
    ok(
      "parse-comment-line-in-frame",
      isDeepStrictEqual(p(': note\ndata: {"type":"text","delta":"x"}\n\n').events, [{ type: "text", delta: "x" }]),
      "a comment line inside a data frame is ignored and the frame still parses",
    );
    ok(
      "parse-data-lines-joined",
      isDeepStrictEqual(p('data: {"type":"text",\ndata: "delta":"y"}\n\n').events, [{ type: "text", delta: "y" }]),
      "a frame's data lines are joined with a newline before parsing, as the SSE format says",
    );
    ok("parse-no-space", isDeepStrictEqual(p('data:{"type":"text","delta":"z"}\n\n').events, [{ type: "text", delta: "z" }]), "a data line with no space after the colon parses");
    const shapes = p(
      [
        'data: {"type":"nonsense","delta":"a"}',
        'data: {"type":"text","delta":5}',
        'data: {"type":"revision","projectId":"x","version":"2","changes":[]}',
        'data: {"type":"done"}',
        "data: null",
        "data: [1,2]",
        'data: "text"',
        'event: message\ndata: {"type":"error","message":"m"}',
      ].join("\n\n") + "\n\n",
    );
    ok("parse-shape-checked", isDeepStrictEqual(shapes.events, [{ type: "error", message: "m" }]), `events of an unknown type or the wrong shape are dropped; an event: line is ignored (got ${JSON.stringify(shapes.events)})`);
    const revision = p(frame({ type: "revision", projectId: V2, version: 2, changes: [{ field: "growthRatePct", from: 2.1, to: 1 }] }));
    ok(
      "parse-revision",
      isDeepStrictEqual(revision.events, [{ type: "revision", projectId: V2, version: 2, changes: [{ field: "growthRatePct", from: 2.1, to: 1 }] }]),
      "a revision event parses with its changes",
    );

    // Fed as the stream arrives: every split point, CRLF and LF alike, gives exactly the events of the whole.
    const whole = [
      `: ping\n\n`,
      `data: {"type":"text","delta":"Growth → 1%"}\r\n\r\n`,
      `data: {"type":"status","message":"Re-running with growth 1.0%…"}\n\n`,
      `: ping\r\n\r\n`,
      frame({ type: "revision", projectId: V2, version: 2, changes: [{ field: "growthRatePct", from: 2.1, to: 1 }] }),
      `data: {"type":"text","delta":"done."}\r\n\r\n`,
      // One event over two data lines, CRLF between them: a split between that CR and LF is one line end.
      `data: {"type":"text",\r\ndata: "delta":" Two lines."}\r\n\r\n`,
      frame({ type: "done", messageId: M2 }),
    ].join("");
    const want = p(whole).events;
    const feed = (parts) => {
      const events = [];
      let buf = "";
      for (const part of parts) {
        const r = p(buf + part);
        events.push(...r.events);
        buf = r.rest;
      }
      return { events, rest: buf };
    };
    let broken = [];
    for (let i = 0; i <= whole.length; i++) {
      const got = feed([whole.slice(0, i), whole.slice(i)]);
      if (!isDeepStrictEqual(got.events, want) || got.rest !== "") broken.push(i);
    }
    ok("parse-whole-has-six", want.length === 6, `precondition: the whole stream holds six events and two keep-alives (got ${want.length})`);
    ok("parse-every-split", broken.length === 0, `fed in two chunks split at each of ${whole.length + 1} points, the parser gives exactly the events of the whole${broken.length ? ` (broken at ${broken.slice(0, 5).join(", ")})` : ""}`);
    const byChar = feed([...whole]);
    ok("parse-one-char-at-a-time", isDeepStrictEqual(byChar.events, want) && byChar.rest === "", "fed one character at a time, the parser gives exactly the events of the whole");
    ok(
      "parse-split-crlf-no-extra-frame",
      isDeepStrictEqual(feed(['data: {"type":"text","delta":"a"}\r', '\n\r', '\ndata: {"type":"text","delta":"b"}\r\n\r\n']).events, [
        { type: "text", delta: "a" },
        { type: "text", delta: "b" },
      ]),
      "a \\r\\n split across chunks is one line end, not two",
    );
    ok(
      "parse-split-crlf-inside-frame",
      isDeepStrictEqual(feed(['data: {"type":"text",\r', '\ndata: "delta":"y"}\r\n\r\n']).events, [{ type: "text", delta: "y" }]),
      "a \\r\\n split between a frame's two data lines does not end the frame there",
    );
  });

  // ─── 2. THE CLIENT ─────────────────────────────────────────────────────────────────
  await group("sendDatum", async () => {
    ok("exports-send", typeof lib.sendDatum === "function" && typeof lib.DatumRequestError === "function", "lib/datum-chat.ts exports sendDatum and DatumRequestError");
    if (typeof lib.sendDatum !== "function") return;
    const calls = [];
    // Split mid-JSON, mid-character (the arrow is three bytes) and mid-line-end, with keep-alives between.
    const bytes = enc.encode(
      [
        ": ping\n\n",
        'data: {"type":"text","delta":"Growth 2.1 → 1"}\r\n\r\n',
        frame({ type: "status", message: "Re-running with growth 1.0%…" }),
        frame({ type: "revision", projectId: V2, version: 2, changes: [{ field: "growthRatePct", from: 2.1, to: 1 }] }),
        ": ping\n\n",
        frame({ type: "done", messageId: M2 }),
      ].join(""),
    );
    const arrow = bytes.indexOf(0xe2);
    const cuts = [5, 30, arrow + 1, arrow + 2, 80, 81, 150, bytes.length - 3];
    const chunks = [];
    let from = 0;
    for (const c of cuts) {
      chunks.push(bytes.slice(from, c));
      from = c;
    }
    chunks.push(bytes.slice(from));
    const signal = new AbortController().signal;
    globalThis.fetch = async (url, init) => (calls.push({ url: String(url), init }), sse(bodyOf(chunks)));
    const got = [];
    await lib.sendDatum(V1, { content: "Why was this flagged?", findingId: F1 }, (e) => got.push(e), signal);
    ok(
      "send-events-in-order",
      isDeepStrictEqual(got, [
        { type: "text", delta: "Growth 2.1 → 1" },
        { type: "status", message: "Re-running with growth 1.0%…" },
        { type: "revision", projectId: V2, version: 2, changes: [{ field: "growthRatePct", from: 2.1, to: 1 }] },
        { type: "done", messageId: M2 },
      ]),
      `onEvent hears every event in order, keep-alives skipped, across chunks split mid-JSON and mid-character (got ${JSON.stringify(got)})`,
    );
    const c = calls[0];
    const headers = new Headers(c?.init?.headers ?? {});
    ok(
      "send-request",
      calls.length === 1 &&
        c.url === `/tis-api/projects/${V1}/datum/messages` &&
        c.init.method === "POST" &&
        c.init.credentials === "include" &&
        /application\/json/.test(headers.get("content-type") ?? "") &&
        c.init.signal === signal &&
        isDeepStrictEqual(JSON.parse(c.init.body), { content: "Why was this flagged?", findingId: F1 }),
      "it POSTs {content, findingId} as JSON to the messages route, with credentials and the caller's signal",
    );
    calls.length = 0;
    globalThis.fetch = async (url, init) => (calls.push({ url: String(url), init }), sse(bodyOf([frame({ type: "done", messageId: M2 })])));
    await lib.sendDatum(V1, { content: "About the study" }, () => {}, signal);
    ok("send-no-finding-key", calls[0]?.init?.body === '{"content":"About the study"}', `a question about the study as a whole sends no findingId key (sent ${calls[0]?.init?.body})`);

    // A frame the stream ended inside is not an event (the SSE format discards it).
    const tail = [];
    globalThis.fetch = async () => sse(bodyOf([frame({ type: "text", delta: "a" }), 'data: {"type":"text","delta":"b"}']));
    await lib.sendDatum(V1, { content: "q" }, (e) => tail.push(e), signal);
    ok("send-unfinished-frame-dropped", isDeepStrictEqual(tail, [{ type: "text", delta: "a" }]), `a frame cut off by the end of the stream is not an event (got ${JSON.stringify(tail)})`);

    for (const [status, body, want] of [
      [429, { error: FIRM_CAP }, FIRM_CAP],
      [429, { error: "Too many messages. Try again in a few minutes." }, "Too many messages. Try again in a few minutes."],
      [503, { error: "Datum chat is off." }, "Datum chat is off."],
      [404, { error: "Finding not found." }, "Finding not found."],
      [400, { error: "Write a message of 1 to 2000 characters." }, "Write a message of 1 to 2000 characters."],
      [500, undefined, "HTTP 500"],
    ]) {
      const heard = [];
      globalThis.fetch = async () => (body === undefined ? new Response("not json", { status }) : json(status, body));
      let e = null;
      try {
        await lib.sendDatum(V1, { content: "q" }, (x) => heard.push(x), signal);
      } catch (x) {
        e = x;
      }
      ok(
        "send-refusal-carries-server-text",
        e instanceof lib.DatumRequestError && e.status === status && e.message === want && heard.length === 0,
        `a ${status} before the stream is a DatumRequestError carrying the server's own sentence (got ${e?.status} ${JSON.stringify(e?.message)})`,
      );
    }
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch");
    };
    let offline = null;
    try {
      await lib.sendDatum(V1, { content: "q" }, () => {}, signal);
    } catch (x) {
      offline = x;
    }
    ok("send-unreachable-is-refusal", offline instanceof lib.DatumRequestError && offline.status === 0 && offline.message.length > 0, "a request that never reached the server is a refusal too, with a sentence to show");

    // Abort mid-stream: the promise rejects as an abort and nothing more is heard.
    const ac = new AbortController();
    const live = liveBody(ac.signal);
    globalThis.fetch = async () => sse(live.stream);
    const heard = [];
    const pending = lib.sendDatum(V1, { content: "q" }, (e) => heard.push(e), ac.signal).then(
      () => "resolved",
      (e) => e?.name,
    );
    live.push(frame({ type: "text", delta: "a" }));
    await tick();
    await tick();
    ac.abort();
    const outcome = await pending;
    ok("send-abort-rejects", outcome === "AbortError" && isDeepStrictEqual(heard, [{ type: "text", delta: "a" }]), `aborting mid-stream rejects with an AbortError after the events already heard (got ${outcome}, ${heard.length} events)`);
  });

  await group("fetchDatum", async () => {
    ok("exports-fetch", typeof lib.fetchDatum === "function", "lib/datum-chat.ts exports fetchDatum");
    if (typeof lib.fetchDatum !== "function") return;
    const calls = [];
    const off = { enabled: false, messages: [], revisions: [], lineage: lineage({ version: 2, revisedFromProjectId: V1, revisedFromVersion: 1, latestVersionId: V2, latestVersion: 2 }) };
    globalThis.fetch = async (url, init) => (calls.push({ url: String(url), init }), json(200, off));
    const got = await lib.fetchDatum(V2);
    ok("fetch-url", calls[0]?.url === `/tis-api/projects/${V2}/datum` && calls[0]?.init?.credentials === "include", "it GETs the project's datum route with credentials");
    ok("fetch-off-keeps-lineage", isDeepStrictEqual(got, off), `with the chat off it still carries the lineage, for the version line (got ${JSON.stringify(got)})`);
    const full = readOf({ messages: [msg(M1, "engineer", "q"), msg(M2, "datum", "a", { revisionId: R2 })], revisions: [rev()] });
    globalThis.fetch = async () => json(200, full);
    ok("fetch-whole-answer", isDeepStrictEqual(await lib.fetchDatum(V1), full), "a whole answer comes through as sent");
    globalThis.fetch = async () => json(200, { enabled: "true", messages: { x: 1 }, revisions: null, lineage: { version: "2" } });
    const odd = await lib.fetchDatum(V1);
    ok(
      "fetch-odd-answer-safe",
      odd.enabled === false && Array.isArray(odd.messages) && odd.messages.length === 0 && Array.isArray(odd.revisions) && odd.revisions.length === 0 && odd.lineage === null,
      `only the boolean true turns the chat on, lists are always lists, and a lineage that does not read is null (got ${JSON.stringify(odd)})`,
    );
    globalThis.fetch = async () => json(404, { error: "Project not found." });
    let e = null;
    try {
      await lib.fetchDatum(V1);
    } catch (x) {
      e = x;
    }
    ok("fetch-error-text", e instanceof Error && e.message === "Project not found.", `a refusal carries the server's sentence (got ${JSON.stringify(e?.message)})`);
  });

  await group("the streamed reply", () => {
    ok("exports-reducer", typeof lib.startStreaming === "function" && typeof lib.applyStreamEvent === "function", "lib/datum-chat.ts exports startStreaming and applyStreamEvent");
    if (typeof lib.applyStreamEvent !== "function") return;
    const run = (events) => events.reduce((s, e) => lib.applyStreamEvent(s, e), lib.startStreaming("Why?", F1));
    const s0 = lib.startStreaming("Why?", F1);
    ok("stream-start", s0.content === "Why?" && s0.findingId === F1 && s0.text === "" && s0.status === null && s0.revision === null && s0.error === null && s0.done === false, "a new reply starts empty");
    const once = run([{ type: "text", delta: `\n\n${COULDNT}` }, { type: "error", message: COULDNT }, { type: "done", messageId: M2 }]);
    ok("stream-couldnt-answer-once", once.error === null && count(once.text, COULDNT) === 1, `the model-failure line arrives as text and as an error: it is kept once (error ${JSON.stringify(once.error)})`);
    const other = run([{ type: "text", delta: "Partly written" }, { type: "error", message: STREAM_FAILED }]);
    ok("stream-other-error-kept", other.error === STREAM_FAILED && other.done === false, "an error the text does not already say is kept, to show");
    const rerun = run([
      { type: "text", delta: "I'll re-run it." },
      { type: "status", message: "Re-running with growth 1.0%…" },
    ]);
    ok("stream-status", rerun.status === "Re-running with growth 1.0%…", "a status event is the status line");
    const after = [
      { type: "revision", projectId: V2, version: 2, changes: [{ field: "growthRatePct", from: 2.1, to: 1 }] },
      { type: "text", delta: " Done." },
      { type: "done", messageId: M2 },
    ].reduce((s, e) => lib.applyStreamEvent(s, e), rerun);
    ok(
      "stream-revision",
      isDeepStrictEqual(after.revision, { projectId: V2, version: 2, changes: [{ field: "growthRatePct", from: 2.1, to: 1 }] }) && after.status === null && after.text === "I'll re-run it. Done." && after.done === true,
      "a revision is kept for its card and ends the status line; the text runs on; done is done",
    );
    const refused = [{ type: "text", delta: "That value is outside the bounds." }].reduce((s, e) => lib.applyStreamEvent(s, e), rerun);
    ok("stream-text-ends-status", refused.status === null, "text after a status (a re-run that was refused) ends the status line");
    ok("stream-pure", s0.text === "" && rerun.revision === null, "applyStreamEvent leaves the state it was handed alone");
    ok(
      "message-body",
      typeof lib.messageBody === "function" &&
        isDeepStrictEqual(lib.messageBody("  Why?  ", F1), { content: "Why?", findingId: F1 }) &&
        isDeepStrictEqual(lib.messageBody("Why?", null), { content: "Why?" }) &&
        lib.messageBody("   ", F1) === null &&
        lib.messageBody("x".repeat(2001), null) === null &&
        isDeepStrictEqual(lib.messageBody("x".repeat(2000), null), { content: "x".repeat(2000) }),
      "messageBody trims, carries the finding when there is one, and refuses an empty message or one over 2000 characters",
    );
    ok(
      "format-values",
      typeof lib.formatChangeValue === "function" &&
        lib.formatChangeValue(2.1) === "2.1" &&
        lib.formatChangeValue(1) === "1" &&
        lib.formatChangeValue(null) === "not set" &&
        lib.formatChangeValue(true) === "on" &&
        lib.formatChangeValue(false) === "off" &&
        lib.formatChangeValue("computed") === "computed" &&
        lib.formatChangeValue(["am_peak", "pm_peak"]) === "am_peak, pm_peak" &&
        lib.formatChangeValue([{ intersectionName: "Main St & 1st Ave", cycleLenSec: 120 }]) === "timing sheet for Main St & 1st Ave",
      "change values read plainly: numbers as written, null as not set, booleans as on and off, lists joined, timing sheets by name",
    );
  });

  // ─── 3. RENDERING ──────────────────────────────────────────────────────────────────
  await group("Ask about this on each finding", () => {
    const asked = [];
    const run = runOf("rules_ready", { findings: FOUR, dispositions: FOUR_DECIDED });
    const withAsk = keep(render(panelView(run, { onAsk: (f) => asked.push(f.id) })));
    const without = render(panelView(run));
    ok("ask-one-per-finding", count(withAsk, 'data-testid="button-ask-datum"') === 4, `with onAsk, one Ask button per visible finding, a decided and a contested one included (got ${count(withAsk, 'data-testid="button-ask-datum"')})`);
    ok("ask-none-without", count(without, 'data-testid="button-ask-datum"') === 0, "without onAsk, none");
    ok("ask-label", /Ask about this/.test(text(withAsk)), "the button reads Ask about this");
    const cards = FOUR.map((f) => {
      const at = withAsk.indexOf(`data-testid="finding-${f.clauseId}"`);
      const next = withAsk.indexOf('data-testid="finding-', at + 10);
      return withAsk.slice(at, next < 0 ? undefined : next);
    });
    ok("ask-one-in-each-card", cards.every((c) => count(c, 'data-testid="button-ask-datum"') === 1), "each card carries exactly one");
    ok(
      "ask-after-dispositions",
      cards.every((c) => c.lastIndexOf('data-testid="button-disposition-') < c.indexOf('data-testid="button-ask-datum"')),
      "in each card the Ask button comes after the decision buttons",
    );
    const els = byTestId(ProofreadView({ run, error: null, busy: false, onRerun() {}, onTriage() {}, onAsk: (f) => asked.push(f.id) }), "button-ask-datum");
    for (const el of els) el.props.onClick();
    ok("ask-hands-the-finding", isDeepStrictEqual(asked, ["f-growthOverrideDisclosed", "f-vcPlausibility", "f-screeningClampDisclosed", "f-scopeNoteConsistent"]), `each button hands onAsk its own finding, in the order shown (got ${asked.join(", ")})`);
    for (const status of ["none", "queued", "running", "failed"]) {
      ok("ask-only-on-shown-findings", count(render(panelView(runOf(status, { findings: FOUR }), { onAsk() {} })), 'data-testid="button-ask-datum"') === 0, `${status}: no Ask button, as no finding is shown`);
    }
    const busyHtml = render(panelView(run, { onAsk() {}, busy: true }));
    ok("pre-busy-holds-decisions", hasDisabled(tagOf(busyHtml, "button-proofread-rerun").slice(7, -1)), "precondition: busy disables the panel's own buttons, and hasDisabled sees it");
    ok("ask-busy-still-enabled", [...busyHtml.matchAll(/<button\b([^>]*)data-testid="button-ask-datum"([^>]*)>/g)].every((m) => !hasDisabled(m[1]) && !hasDisabled(m[2])), "asking is not held by a decision in flight");
  });

  await group("the Ask Datum box", () => {
    ok("exports-box", typeof chat.AskDatumBox === "function" && typeof chat.chatForPanel === "function", "datum-chat.tsx exports AskDatumBox and chatForPanel");
    if (typeof chat.chatForPanel !== "function") return;
    const run = runOf("rules_ready", { findings: FOUR });
    const box = createElement(chat.AskDatumBox, { onAsk() {} });
    const html = keep(render(panelView(run, { askBox: box })));
    const at = html.indexOf('data-testid="box-ask-datum"');
    ok("box-at-top", at > 0 && at < html.indexOf('data-testid="finding-'), "the box is drawn at the top of the panel, above the findings");
    ok("box-is-a-field", /<input\b[^>]*data-testid="input-ask-datum"|<textarea\b[^>]*data-testid="input-ask-datum"/.test(html) && /Ask Datum/.test(text(html)), "it is a field to type a question in, named Ask Datum");
    ok("box-none-without", !/box-ask-datum/.test(render(panelView(run))), "without askBox, no box");
    ok("box-on-unchecked-study", /box-ask-datum/.test(render(panelView(runOf("none"), { askBox: box }))), "a study not yet checked can still be asked about");

    const handlers = { onAsk() {}, onAskStudy() {} };
    const on = chat.chatForPanel(readOf(), handlers);
    ok("chat-for-panel-on", !!on && typeof on.onAsk === "function" && !!on.askBox, "with the chat on, the panel gets onAsk and the box");
    const onHtml = keep(render(panelView(run, on ?? {})));
    ok("chat-on-renders-both", count(onHtml, 'data-testid="button-ask-datum"') === 4 && /box-ask-datum/.test(onHtml), "and the panel then draws the box and an Ask button per finding");
  });

  await group("disabled", () => {
    if (typeof chat.chatForPanel !== "function") return;
    const run = runOf("rules_ready", { findings: FOUR });
    const off = chat.chatForPanel(readOf({ enabled: false }), { onAsk() {}, onAskStudy() {} });
    ok("chat-off-nothing", off === undefined, "with the chat off, the panel is handed nothing");
    ok("chat-not-loaded-nothing", chat.chatForPanel(null, { onAsk() {}, onAskStudy() {} }) === undefined, "nor before the chat has loaded, or when it could not be");
    const html = render(panelView(run, off ?? {}));
    ok("chat-off-panel-as-today", html === render(panelView(run)) && !/ask-datum|Ask Datum|Ask about this/i.test(html), "the panel draws exactly what it draws without the chat: no box and no Ask button");
    if (typeof chat.DrawerView !== "function") return ok("exports-drawer", false, "datum-chat.tsx exports DrawerView");
    const drawer = keep(render(createElement(chat.DrawerView, drawerProps({ read: readOf({ enabled: false }) }))));
    ok("drawer-off-no-composer", !/<textarea\b|<input\b/.test(drawer) && /Datum chat is off/.test(text(drawer)), "a drawer opened on a chat that is off says so and has nothing to type in");
  });

  await group("the thread is plain text", () => {
    ok("exports-thread", typeof chat.ThreadView === "function", "datum-chat.tsx exports ThreadView");
    if (typeof chat.ThreadView !== "function") return;
    const html = keep(
      render(
        createElement(chat.ThreadView, {
          projectId: V1,
          revisedFromVersion: null,
          messages: [msg(M1, "engineer", "<img src=x onerror=alert(1)>"), msg(M2, "datum", "**Bold** and <b>tags</b> stay as typed.\n\n- a list line\n<script>alert(1)</script>")],
          revisions: [],
          streaming: null,
        }),
      ),
    );
    ok("thread-no-img", !/<img/i.test(html), "an engineer message holding <img src=x onerror=alert(1)> renders no <img");
    ok("thread-escaped", html.includes("&lt;img src=x onerror=alert(1)&gt;"), "it renders as the escaped text the engineer typed");
    ok("thread-no-markup-from-text", !/<script|<b>/i.test(html) && html.includes("**Bold**") && html.includes("&lt;b&gt;tags&lt;/b&gt;"), "Datum's text is not read as markdown or HTML: the asterisks and the tags stay as typed");
    ok("thread-pre-wrap", /<[^>]*whitespace-pre-wrap[^>]*>&lt;img/.test(html) && /<[^>]*whitespace-pre-wrap[^>]*>\*\*Bold\*\*/.test(html), "both messages keep their line breaks (whitespace-pre-wrap)");
    ok("thread-author", /Pat Engineer/.test(text(html)) && /Datum/.test(text(html)), "each message says who wrote it");
    const gone = render(createElement(chat.ThreadView, { projectId: V1, revisedFromVersion: null, messages: [msg(M1, "engineer", "q", { authorName: null })], revisions: [], streaming: null }));
    ok("thread-author-gone", /A member of your firm/.test(text(gone)), "an engineer whose name is gone is still someone of the firm");
    const empty = keep(render(createElement(chat.ThreadView, { projectId: V1, revisedFromVersion: null, messages: [], revisions: [], streaming: null })));
    ok("thread-empty", /No questions yet/.test(text(empty)), "an empty thread says so");
    for (const [label, src] of [
      ["datum-chat.tsx", SRC.chat],
      ["lib/datum-chat.ts", SRC.lib],
    ]) {
      ok("source-no-inner-html", src.length > 0 && !/dangerouslySetInnerHTML|\.innerHTML\b|outerHTML|insertAdjacentHTML/.test(src), `${label}: never sets HTML from a string`);
      ok("source-no-markdown", src.length > 0 && !/from\s+["'](react-markdown|marked|markdown-it|remark[^"']*|rehype[^"']*|micromark|showdown)["']/.test(src), `${label}: imports no markdown library`);
    }
  });

  await group("the change card", () => {
    if (typeof chat.ThreadView !== "function") return;
    const thread = (o) =>
      keep(
        render(
          createElement(chat.ThreadView, {
            projectId: V1,
            revisedFromVersion: null,
            messages: [msg(M1, "engineer", "Use 1% growth, per the county."), msg(M2, "datum", "Re-ran it as Version 2.", { revisionId: R2 }), msg(M3, "engineer", "Thanks.")],
            revisions: [rev(o)],
            streaming: null,
          }),
        ),
      );
    const html = thread();
    const t = text(html);
    const at = html.indexOf('data-testid="datum-change-card"');
    ok("card-shown", count(html, 'data-testid="datum-change-card"') === 1, "a version made from this one draws one change card");
    ok("card-field-from-to", t.includes("growthRatePct: 2.1 → 1"), `it shows growthRatePct: 2.1 → 1 (got ${JSON.stringify(t.slice(t.indexOf("growth") - 5, t.indexOf("growth") + 40))})`);
    ok("card-version-link", new RegExp(`<a\\b[^>]*href="/projects/${V2}"[^>]*>Version 2</a>`).test(html), "and a link to /projects/<new id> reading Version 2");
    ok("card-open-to-see", /Open Version 2 to see its findings/.test(t), "it says to open Version 2 to see its findings, and does not wait for them here");
    ok("card-reason", t.includes("The county's count program shows 1% a year on this corridor."), "it shows the reason");
    ok("card-who", /Asked by Pat Engineer/.test(t), "and who asked");
    ok("card-no-source", /no source given/.test(t), "a change with no source says no source given");
    const sourced = text(thread({ sourceLabel: "County count program, 2025" }));
    ok("card-source", sourced.includes("County count program, 2025") && !/no source given/.test(sourced), "a change with a source names it");
    ok("card-after-its-message", at > html.indexOf("Re-ran it as Version 2.") && at < html.indexOf("Thanks."), "the card sits under the message that made it");
    const two = text(thread({ changes: [{ field: "passByPct", from: null, to: 10 }, { field: "growthRatePct", from: 2.1, to: null }, { field: "realLaneGeometry", from: false, to: true }] }));
    ok("card-every-field", two.includes("passByPct: not set → 10") && two.includes("growthRatePct: 2.1 → not set") && two.includes("realLaneGeometry: off → on"), "every changed field is listed, from → to");
    const none = text(thread({ changes: [] }));
    ok("card-no-changes", /current engine with the same inputs/.test(none), "a re-run with no changes says it ran on the current engine with the same inputs");
    // A version made from this one that no message names is still shown, never dropped.
    const orphan = keep(render(createElement(chat.ThreadView, { projectId: V1, revisedFromVersion: null, messages: [], revisions: [rev()], streaming: null })));
    ok("card-orphan-shown", count(orphan, 'data-testid="datum-change-card"') === 1, "a change no message names is still shown");
  });

  await group("the thread header", () => {
    if (typeof chat.ThreadView !== "function") return;
    const html = keep(
      render(
        createElement(chat.ThreadView, {
          projectId: V2,
          revisedFromVersion: 1,
          messages: [],
          revisions: [rev(), rev({ id: R3, projectId: V3, fromProjectId: V2, version: 3, changes: [{ field: "passByPct", from: null, to: 10 }] })],
          streaming: null,
        }),
      ),
    );
    const head = /<div\b[^>]*data-testid="datum-thread-header"[\s\S]*?(?=<div\b[^>]*data-testid="datum-change-card"|$)/.exec(html)?.[0] ?? "";
    ok("header-revised-from", /Revised from Version 1/.test(text(head)) && new RegExp(`href="/projects/${V1}"`).test(head), `the version's own revision opens the thread: Revised from Version 1, linked (got ${JSON.stringify(text(head).slice(0, 80))})`);
    ok("header-changes", text(head).includes("growthRatePct: 2.1 → 1") && /Asked by Pat Engineer/.test(text(head)) && /no source given/.test(text(head)), "with its changes, who asked and the source");
    ok("header-before-thread", html.indexOf('data-testid="datum-thread-header"') < html.indexOf('data-testid="datum-change-card"'), "above the thread");
    ok("header-not-a-card", count(html, 'data-testid="datum-change-card"') === 1, "it is not also drawn as a change card; the version made from this one is");
    const v3 = text(render(createElement(chat.ThreadView, { projectId: V3, revisedFromVersion: 1, messages: [], revisions: [rev({ id: R3, projectId: V3, fromProjectId: V1, version: 3 })], streaming: null })));
    ok("header-from-version-not-minus-one", /Revised from Version 1/.test(v3) && !/Version 2/.test(v3), "Version 3 revised from Version 1 says Version 1, not Version 2");
    const none = render(createElement(chat.ThreadView, { projectId: V1, revisedFromVersion: null, messages: [], revisions: [], streaming: null }));
    ok("header-none-on-original", !/datum-thread-header|Revised from/.test(none), "an original version has no header");
  });

  await group("streaming", () => {
    if (typeof chat.ThreadView !== "function" || typeof lib.applyStreamEvent !== "function") return;
    const view = (events) =>
      keep(
        render(
          createElement(chat.ThreadView, {
            projectId: V1,
            revisedFromVersion: null,
            messages: [],
            revisions: [],
            streaming: events.reduce((s, e) => lib.applyStreamEvent(s, e), lib.startStreaming("Use 1% growth.", F1)),
          }),
        ),
      );
    const going = view([{ type: "text", delta: "I'll re-run it." }, { type: "status", message: "Re-running with growth 1.0%…" }]);
    ok("streaming-question-shown", /Use 1% growth\./.test(text(going)) && /I'll re-run it\./.test(text(going)), "the question and the reply so far are shown while it streams");
    ok("streaming-status-line", /<[^>]*data-testid="datum-status"[^>]*>[\s\S]*Re-running with growth 1\.0%…/.test(going), "the status line shows the status event");
    const card = view([{ type: "revision", projectId: V2, version: 2, changes: [{ field: "growthRatePct", from: 2.1, to: 1 }] }]);
    ok("streaming-card", text(card).includes("growthRatePct: 2.1 → 1") && new RegExp(`<a\\b[^>]*href="/projects/${V2}"[^>]*>Version 2</a>`).test(card) && !/datum-status/.test(card), "a revision event draws its card at once, linked, and the status line goes");
    const failed = view([{ type: "text", delta: `\n\n${COULDNT}` }, { type: "error", message: COULDNT }]);
    ok("streaming-couldnt-once", count(text(failed), COULDNT) === 1, `the model-failure line is shown once, not twice (shown ${count(text(failed), COULDNT)} times)`);
    const lost = view([{ type: "text", delta: "Partly" }, { type: "error", message: STREAM_FAILED }]);
    ok("streaming-error-shown", count(text(lost), STREAM_FAILED) === 1 && /text-red-600/.test(lost), "another error is shown, once, in red");
  });

  await group("the composer", () => {
    if (typeof chat.DrawerView !== "function") return;
    const html = (o) => keep(render(createElement(chat.DrawerView, drawerProps(o))));
    const idle = html({ draft: "" });
    ok("composer-counts-from-2000", /2000 characters left/.test(text(idle)), "an empty composer counts down from 2000 characters");
    ok("composer-maxlength", /<textarea\b[^>]*maxLength="2000"|<textarea\b[^>]*maxlength="2000"/i.test(idle), "the field takes no more than 2000");
    ok("composer-counts-down", /10 characters left/.test(text(html({ draft: "x".repeat(1990) }))), "it counts what is left");
    const send = (h) => tagOf(h, "button-datum-send").slice(7, -1);
    const field = (h) => tagOf(h, "input-datum-message").slice(9, -1);
    ok("composer-empty-cannot-send", hasDisabled(send(idle)) && !hasDisabled(field(idle)), "nothing to send: Send is disabled, the field is not");
    ok("composer-can-send", send(html({ draft: "Why?" })) !== "" && !hasDisabled(send(html({ draft: "Why?" }))), "a question: Send is enabled");
    const busy = html({ draft: "Why?", streaming: lib.startStreaming("Why?", null) });
    ok("composer-disabled-while-streaming", hasDisabled(field(busy)) && hasDisabled(send(busy)), "while a reply streams, the field and Send are disabled");
    const ended = html({ draft: "Next?", streaming: { ...lib.startStreaming("Why?", null), text: "Because.", done: true } });
    ok("composer-free-when-done", !hasDisabled(field(ended)) && !hasDisabled(send(ended)), "once the reply is done, the next question can be written and sent");
    const focused = html({ focus: FOUR[0], draft: chat.DEFAULT_QUESTION });
    ok("composer-focus", /growthOverrideDisclosed title/.test(text(focused)), "asking about a finding names it above the field");
    ok("default-question", chat.DEFAULT_QUESTION === "Why was this flagged, and how do I fix it?", "the question a finding's Ask button starts with is the owner's");
    const refused = html({ sendError: FIRM_CAP, draft: "Why?" });
    ok("composer-refusal-shown", text(refused).includes(FIRM_CAP), "a refusal shows the server's own sentence");
    const notice = html({ notice: STREAM_FAILED });
    ok("drawer-notice-shown", text(notice).includes(STREAM_FAILED), "what the stream ended on is shown");
    const loading = html({ read: null });
    ok("drawer-loading", /Loading/.test(text(loading)) && !/<textarea/.test(loading), "while the thread loads, there is nothing to type in yet");
    const failedLoad = html({ read: null, loadError: "Failed to load the Datum chat." });
    ok("drawer-load-error", /Failed to load the Datum chat\./.test(text(failedLoad)), "a thread that could not load says why");
    ok("drawer-close", /data-testid="button-datum-close"/.test(idle), "the drawer can be closed");
    ok("drawer-is-side", /data-testid="drawer-datum"[^>]*class="[^"]*fixed[^"]*right-0|class="[^"]*fixed[^"]*right-0[^"]*"[^>]*data-testid="drawer-datum"/.test(idle), "it is a drawer on the right");
  });

  await group("the version line and badge", () => {
    ok("exports-version", typeof chat.VersionLine === "function" && typeof chat.VersionBadge === "function", "datum-chat.tsx exports VersionLine and VersionBadge");
    if (typeof chat.VersionLine !== "function") return;
    const line = (l) => keep(render(createElement(chat.VersionLine, { lineage: l })));
    const v2 = line(lineage({ version: 2, revisedFromProjectId: V1, revisedFromVersion: 1, latestVersionId: V2, latestVersion: 2 }));
    ok("version-line-revised-from", /Version 2 · revised from Version 1/.test(text(v2)) && new RegExp(`<a\\b[^>]*href="/projects/${V1}"[^>]*>Version 1</a>`).test(v2), `Version 2 · revised from Version 1, linked (got ${JSON.stringify(text(v2))})`);
    ok("version-line-no-newer", !/newer version/.test(text(v2)), "no newer version: nothing about one");
    const newer = line(lineage({ version: 2, revisedFromProjectId: V1, revisedFromVersion: 1, latestVersionId: V3, latestVersion: 3 }));
    ok("version-line-newer", /A newer version exists: Version 3/.test(text(newer)) && new RegExp(`<a\\b[^>]*href="/projects/${V3}"[^>]*>Version 3</a>`).test(newer), "a newer version: A newer version exists: Version 3, linked");
    const orig = line(lineage({ latestVersionId: V2, latestVersion: 2 }));
    ok("version-line-original-newer", /Version 1/.test(text(orig)) && /A newer version exists: Version 2/.test(text(orig)) && !/revised from/.test(text(orig)), "an original with a newer version says so, and not that it was revised");
    ok("version-line-original-alone", line(lineage()) === "" && line(null) === "", "an original nobody revised, or no lineage, draws nothing: the page is as it was");
    const gone = text(line(lineage({ version: 2, revisedFromProjectId: null, revisedFromVersion: null, latestVersionId: V2, latestVersion: 2 })));
    ok("version-line-parent-gone", /^Version 2$/.test(gone), `a version whose original is gone still says which it is (got ${JSON.stringify(gone)})`);
    const badge = (v) => render(createElement(chat.VersionBadge, { version: v }));
    ok("version-badge", text(badge(2)) === "v2" && text(badge(12)) === "v12" && badge(1) === "", "the list's badge reads v2 for a version past the first, and nothing for the first");
    ok("list-uses-badge", /<VersionBadge version=\{p\.version\} \/>/.test(SRC.list), "WIRING: the project list draws the badge from each row's version");
    ok("page-uses-version-line", /<VersionLine lineage=\{/.test(SRC.page), "WIRING: the project page draws the version line");
  });

  // ─── 4. THE DRAWER, MOUNTED ────────────────────────────────────────────────────────
  await group("the drawer, mounted", async () => {
    if (typeof chat.DatumChat !== "function" || typeof chat.DrawerView !== "function") return ok("exports-datum-chat", false, "datum-chat.tsx exports DatumChat and DrawerView");
    const focus = FOUR[1];
    const saved = readOf({
      messages: [msg(M1, "engineer", chat.DEFAULT_QUESTION, { findingId: focus.id }), msg(M2, "datum", "Re-ran it as Version 2.", { revisionId: R2 })],
      revisions: [rev()],
    });

    // 1. Mount, load, ask, stream, settle.
    {
      const { calls, server } = fakeServer();
      server.reads.push(readOf(), saved);
      const live = { current: null };
      server.posts.push((init) => ((live.current = liveBody(init.signal)), sse(live.current.stream)));
      let revised = 0;
      const m = mountChat({ projectId: V1, focus, onClose() {}, onRevised: () => revised++ });
      let el = m.render();
      ok("mount-returns-drawer", el?.type === chat.DrawerView, "DatumChat returns the DrawerView element, to be read");
      ok("mount-starts-loading", el?.props?.read === null && el?.props?.draft === chat.DEFAULT_QUESTION && el?.props?.focus === focus, "it starts loading, with the finding named and the owner's question ready to send");
      el = await m.settle();
      ok("mount-loads-once", calls.filter((c) => c.method === "GET").length === 1 && isDeepStrictEqual(el.props.read, readOf()), "it loads the thread once");
      el.props.onSend();
      el = await m.settle();
      const post = calls.find((c) => c.method === "POST");
      ok("mount-posts", !!post && post.url === `/tis-api/projects/${V1}/datum/messages` && isDeepStrictEqual(JSON.parse(post.body), { content: chat.DEFAULT_QUESTION, findingId: focus.id }), "Send posts the question with the finding's id");
      ok("mount-streaming-shown", el.props.streaming?.content === chat.DEFAULT_QUESTION && el.props.draft === "", "the question moves into the thread while the reply streams");
      live.current.push(frame({ type: "text", delta: "I'll re-run it." }));
      live.current.push(frame({ type: "status", message: "Re-running with growth 1.0%…" }));
      el = await m.settle();
      ok("mount-status", el.props.streaming?.status === "Re-running with growth 1.0%…" && hasDisabled(tagOf(render(el), "input-datum-message").slice(9, -1)), "the status line shows, and the field is disabled while it streams");
      live.current.push(frame({ type: "revision", projectId: V2, version: 2, changes: [{ field: "growthRatePct", from: 2.1, to: 1 }] }));
      el = await m.settle();
      ok("mount-revised-at-once", revised === 1, "the page hears of the new version as soon as it exists, so its version line can say so");
      live.current.push(frame({ type: "text", delta: " Re-ran it as Version 2." }));
      live.current.push(frame({ type: "done", messageId: M2 }));
      live.current.close();
      el = await m.settle();
      ok(
        "mount-settles-on-saved-thread",
        el.props.streaming === null && isDeepStrictEqual(el.props.read, saved) && el.props.notice === null && calls.filter((c) => c.method === "GET").length === 2,
        "when the reply is done the thread is read again, and the saved thread replaces what was streamed",
      );
      ok("mount-revised-once", revised === 1, "the page hears of it once");
      const html = text(render(el));
      ok("mount-saved-card", html.includes("growthRatePct: 2.1 → 1") && /Asked by Pat Engineer/.test(html), "the saved change card shows, with who asked");
      m.unmount();
    }

    // 2. The model failed: the line is shown once, during the stream and after.
    {
      const { server } = fakeServer();
      const failedThread = readOf({ messages: [msg(M1, "engineer", "Why?"), msg(M2, "datum", COULDNT)] });
      server.reads.push(readOf(), failedThread);
      const live = { current: null };
      server.posts.push((init) => ((live.current = liveBody(init.signal)), sse(live.current.stream)));
      const m = mountChat({ projectId: V1, focus: null, onClose() {} });
      let el = await m.settle();
      el.props.onDraft("Why?");
      el = m.render();
      el.props.onSend();
      await m.settle();
      live.current.push(frame({ type: "text", delta: COULDNT }));
      live.current.push(frame({ type: "error", message: COULDNT }));
      el = await m.settle();
      ok("mount-couldnt-once-streaming", count(text(render(el)), COULDNT) === 1, "while streaming, the model-failure line shows once");
      live.current.push(frame({ type: "done", messageId: M2 }));
      live.current.close();
      el = await m.settle();
      ok("mount-couldnt-once-saved", el.props.notice === null && count(text(render(el)), COULDNT) === 1, "after, it shows once: in the saved message, with no notice beside it");
      m.unmount();
    }

    // 3. Refused before the stream: the server's sentence, and the question back in the box.
    {
      const { calls, server } = fakeServer();
      server.reads.push(readOf());
      server.posts.push(() => json(429, { error: FIRM_CAP }));
      const m = mountChat({ projectId: V1, focus: null, onClose() {} });
      let el = await m.settle();
      el.props.onDraft("Is the growth rate sourced?");
      el = m.render();
      el.props.onSend();
      el = await m.settle();
      ok("mount-refusal", el.props.sendError === FIRM_CAP && el.props.draft === "Is the growth rate sourced?" && el.props.streaming === null, "a refusal shows the server's sentence and puts the question back in the field");
      ok("mount-refusal-no-reload", calls.filter((c) => c.method === "GET").length === 1, "nothing was saved, so the thread is not read again");
      m.unmount();
    }

    // 4. A question typed in the panel's box is sent once, about the study as a whole.
    {
      const { calls, server } = fakeServer();
      server.reads.push(readOf(), readOf());
      server.posts.push(() => sse(bodyOf([frame({ type: "text", delta: "It is." }), frame({ type: "done", messageId: M2 })])));
      const m = mountChat({ projectId: V1, focus: null, ask: { text: "Is the growth rate sourced?", seq: 1 }, onClose() {} });
      await m.settle();
      await m.settle();
      const posts = calls.filter((c) => c.method === "POST");
      ok("mount-ask-sent-once", posts.length === 1 && isDeepStrictEqual(JSON.parse(posts[0].body), { content: "Is the growth rate sourced?" }), `the box's question is sent once, with no finding (sent ${posts.length})`);
      m.unmount();
    }

    // 5. Closing the drawer mid-reply stops the request.
    {
      const { server } = fakeServer();
      server.reads.push(readOf());
      let signal = null;
      server.posts.push((init) => ((signal = init.signal), sse(liveBody(init.signal).stream)));
      const m = mountChat({ projectId: V1, focus: null, ask: { text: "Why?", seq: 1 }, onClose() {} });
      await m.settle();
      await m.settle();
      ok("pre-mount-abort-posted", signal !== null && signal.aborted === false, "precondition: the reply is streaming");
      m.unmount();
      await tick();
      ok("mount-close-aborts", signal?.aborted === true, "closing the drawer aborts the request (the server saves what was written)");
    }

    // 6. A stream that ends without done, or on the server's own error.
    for (const [label, events, want] of [
      ["the connection closed", [frame({ type: "text", delta: "Partly" })], /connection closed before Datum finished/i],
      ["the server's error", [frame({ type: "text", delta: "Partly" }), frame({ type: "error", message: STREAM_FAILED })], new RegExp(STREAM_FAILED.replace(/[.']/g, "."))],
    ]) {
      const { server } = fakeServer();
      server.reads.push(readOf(), readOf({ messages: [msg(M1, "engineer", "Why?")] }));
      server.posts.push(() => sse(bodyOf(events)));
      const m = mountChat({ projectId: V1, focus: null, ask: { text: "Why?", seq: 1 }, onClose() {} });
      await m.settle();
      const el = await m.settle();
      ok("mount-stream-end-notice", want.test(el.props.notice ?? "") && el.props.streaming === null, `${label}: the drawer says so (${JSON.stringify(el.props.notice)})`);
      m.unmount();
    }

    // 7. A chat that is off sends nothing.
    {
      const { calls, server } = fakeServer();
      server.reads.push(readOf({ enabled: false }));
      const m = mountChat({ projectId: V1, focus: null, ask: { text: "Why?", seq: 1 }, onClose() {} });
      await m.settle();
      const el = await m.settle();
      ok("mount-off-sends-nothing", calls.every((c) => c.method === "GET") && !/<textarea/.test(render(el)), "a chat that turns out to be off sends nothing and has nothing to type in");
      m.unmount();
    }
  });

  // ─── 5. COPY ───────────────────────────────────────────────────────────────────────
  await group("copy", () => {
    ok("pre-rendered-states", everyHtml.length >= 25, `rendered ${everyHtml.length} states (a check that rendered nothing proves nothing)`);
    const hits = everyHtml.map((h) => bannedIn(text(h)) ?? bannedIn(h)).filter((h) => h !== null);
    ok("rendered-avoids-banned-copy", hits.length === 0, `no rendered chat state says independent review, second opinion, peer review, QA/QC or audit${hits.length ? ` (found ${JSON.stringify(hits[0])})` : ""}`);
    for (const [label, src] of Object.entries({ "datum-chat.tsx": SRC.chat, "lib/datum-chat.ts": SRC.lib })) {
      const hit = bannedIn(src);
      ok("source-avoids-banned-copy", src.length > 0 && hit === null, `${label} avoids the banned phrases, comments included${hit ? ` (found ${JSON.stringify(hit)})` : ""}`);
    }
    ok("no-react-warnings", warnings.length === 0, `rendering raised no React warnings${warnings.length ? `: ${warnings[0]}` : ""}`);
  });
} finally {
  console.error = realError;
  globalThis.fetch = realFetch;
}

console.log(fails === 0 ? `\nALL ${passes} CHECKS PASSED` : `\n${fails} CHECK(S) FAILED (${passes} passed)`);
process.exit(fails === 0 ? 0 : 1);

// ─── fixtures that need the bundle ──────────────────────────────────────────────────
function drawerProps(o = {}) {
  return {
    projectId: V1,
    read: readOf(),
    loadError: null,
    focus: null,
    draft: "",
    streaming: null,
    notice: null,
    sendError: null,
    onDraft() {},
    onSend() {},
    onClearFocus() {},
    onClose() {},
    ...o,
  };
}

/**
 * A stub server: GETs of the datum route answer the next of `reads`, POSTs the next of `posts` (each a function of
 * the request's init). Every call is recorded.
 */
function fakeServer() {
  const calls = [];
  const server = { reads: [], posts: [] };
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url: String(url), method, body: init.body, signal: init.signal });
    if (method === "GET") {
      const next = server.reads.shift();
      return next === undefined ? json(500, { error: "no read stubbed" }) : json(200, next);
    }
    const next = server.posts.shift();
    return next === undefined ? json(500, { error: "no post stubbed" }) : next(init);
  };
  return { calls, server };
}

/**
 * Just enough of React's hooks to call DatumChat as a plain function and read the element it returns: useState (a
 * value or an updater), useRef, and useEffect, which runs on `commit` after the render that scheduled it (again only
 * when its deps change), with its cleanup on `unmount`. `settle` renders and commits until nothing changes, letting
 * the stubbed fetches and streams run in between.
 */
function mountChat(props) {
  const slots = [];
  let queued = [];
  let at = 0;
  let dirty = false;
  const hooks = {
    useState(init) {
      const i = at++;
      if (!(i in slots)) slots[i] = { value: typeof init === "function" ? init() : init };
      const slot = slots[i];
      return [
        slot.value,
        (next) => {
          const v = typeof next === "function" ? next(slot.value) : next;
          if (!Object.is(v, slot.value)) dirty = true;
          slot.value = v;
        },
      ];
    },
    useRef(init) {
      const i = at++;
      if (!(i in slots)) slots[i] = { current: init };
      return slots[i];
    },
    useEffect(effect, deps) {
      const i = at++;
      const prev = slots[i];
      if (prev && deps && prev.deps && deps.length === prev.deps.length && deps.every((d, j) => Object.is(d, prev.deps[j]))) return;
      queued.push(() => {
        if (typeof prev?.cleanup === "function") prev.cleanup();
        slots[i] = { deps, cleanup: effect() };
      });
    },
  };
  const render = () => {
    at = 0;
    queued = [];
    globalThis[HOOKS_KEY] = hooks;
    try {
      return chat.DatumChat(props);
    } finally {
      delete globalThis[HOOKS_KEY];
    }
  };
  const commit = () => {
    const run = queued;
    queued = [];
    for (const f of run) f();
  };
  return {
    render,
    async settle() {
      let el = render();
      commit();
      for (let i = 0; i < 40; i++) {
        await tick();
        if (dirty || queued.length) {
          dirty = false;
          el = render();
          commit();
        }
      }
      return render();
    },
    unmount() {
      for (const slot of slots) if (typeof slot?.cleanup === "function") slot.cleanup();
    },
  };
}
