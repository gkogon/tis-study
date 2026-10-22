/**
 * Guard for the proofread panel on the project page
 * (artifacts/atlanta-tis/src/components/proofread-panel.tsx) and its client module
 * (artifacts/atlanta-tis/src/lib/proofread.ts).
 *
 * Two kinds of assertion, and the second is the one that carries weight:
 *
 *  1. COPY (source text). The product surface is a customer venue, so
 *     TIS-PROOFREAD-PROTOCOL.md's ban on "independent review", "second opinion",
 *     "peer review" and "QA/QC" applies to it, and so does "audit". The permitted
 *     description is "an internal consistency and traceability check". A banned
 *     phrase is a property of the text, so a text scan is the right tool for it —
 *     the routes and protocol guards' BANNED_COPY over the text's phrase form
 *     (character references decoded, any run of hyphens, dashes and whitespace
 *     read as one space), so "peer-review", "QA / QC", "second–opinion" and
 *     "independent  review" are read — over the panel, the client module, the
 *     route file and the project page that mounts the panel, the Datum chat's
 *     drawer (datum-chat.tsx) and what Datum is told (lib/datum-chat/prompt.ts,
 *     less its one NEVER_USE_SENTENCE, taken out by exact match), and repeated over the
 *     RENDERED output of every status, because copy built at runtime never
 *     appears in the source.
 *
 *  2. BEHAVIOUR (rendered). The panel's claims are not strings: "a study that was
 *     never checked is not clean", "findings appear only for a finished run",
 *     "a clause that judged part of the record says so", "an ordinary study is not
 *     presented as an alarm", "a disclosed blocker is still open",
 *     "a study in which no clause could run says nothing was checked", "a run carrying a finding the server withheld
 *     (a DEFECT) is never a clear", "decisions a rules change reopened say why". A scan for `status === "none"` proves the characters
 *     exist, not that the branch runs before the empty-findings one. So the panel is
 *     bundled with the repo's own esbuild, ProofreadView is rendered with
 *     react-dom/server for each status, and the assertions read what a user would
 *     see. The pass that feeds the "ordinary study" and ordering cases is the REAL
 *     clause pass over a real engine payload, not hand-typed findings.
 *
 * What this cannot see is anything that needs an effect to run more than once, or a
 * person — the poll and its re-arm after "Run again", the busy window across the POST,
 * window.prompt. Those live in ProofreadPanel, not ProofreadView. The decision logic
 * they use (dispositionBody, isPending, isFinished) is pulled into lib/proofread.ts and
 * tested here; that wiring is pinned by the source-text assertions marked WIRING, which
 * are the weak kind and were checked in a real browser instead of trusted. One hand-off
 * is run rather than read: ProofreadPanel is called as a plain function under a minimal
 * hooks runtime (mountPanel: useState, useRef, useEffect — enough for its first load and
 * nothing more), its effect fetches a stubbed GET answer the contract accepts, and the
 * element it then returns must be ProofreadView holding exactly the run fetchProofread
 * made of that answer — the withheld count and the rules-changed flag included.
 *
 * TEETH. Every assertion has an id, printed on its line. MUTATIONS, at the end, edits
 * the panel, the client module, the route file or the project page IN MEMORY. For each
 * one the whole guard runs again, the panel and the module bundled from the edited
 * text, and the mutation must (a) change the code — compared after TypeScript's printer
 * has dropped every comment and runs of whitespace are collapsed, so an edit that lands
 * in a comment proves nothing — and (b) turn red exactly the checks it names (`flips`,
 * plus the ones it declares in `also`). A check no mutation flips fails the run. A
 * `threw:` line or a bundle failure is a broken guard, not a caught mutation: it is red
 * under an id no mutation names, so the mutation that caused it fails, and so does an
 * edit whose anchor is missing or found more than once. Ids that start with `pre-` are
 * about this guard's own fixtures (the real clause pass, the key walker, how many states
 * were rendered, TypeScript's printer), not about the panel, and need no mutation. There
 * is no per-file rule like the routes guard's: the view calls the module, so an edit to
 * either is seen through both. React, react-dom/server and the icons are bundled once and
 * shared by every one of those bundles; only the panel and the module are rebuilt.
 * Run: `pnpm run check:proofread-copy`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const atlanta = path.join(repo, "artifacts/atlanta-tis");
/** Every file this guard reads, by the name a mutation uses. */
const FILES = {
  panel: "artifacts/atlanta-tis/src/components/proofread-panel.tsx",
  lib: "artifacts/atlanta-tis/src/lib/proofread.ts",
  route: "artifacts/tis-api-server/src/routes/proofread.ts",
  page: "artifacts/atlanta-tis/src/pages/project-detail.tsx",
  // The Datum chat's drawer, which opens from the panel, and what Datum is told. Read for banned copy only: the
  // chat's own behaviour is check:datum-chat's (atlanta-tis) and the prompt's is check:datum-chat's (this package).
  chat: "artifacts/atlanta-tis/src/components/datum-chat.tsx",
  prompt: "artifacts/tis-api-server/src/lib/datum-chat/prompt.ts",
};
const SOURCES = Object.freeze(Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, readFileSync(path.join(repo, rel), "utf8")])));
const PANEL_ABS = path.join(repo, FILES.panel);
const LIB_ABS = path.join(repo, FILES.lib);

let fails = 0;
const report = (id, pass, msg) => {
  console.log(`${pass ? "PASS" : "FAIL"}  [${id}] ${msg}`);
  if (!pass) fails++;
};

// ─── the bundle, from the text under test ──────────────────────────────────────────
const BUILD = {
  absWorkingDir: atlanta,
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "node22",
  jsx: "automatic",
  tsconfigRaw: "{}",
  // The dev build of React is the one that warns (duplicate keys, bad nesting); pin it whatever NODE_ENV the caller has.
  define: { "process.env.NODE_ENV": '"development"' },
  alias: { "@": path.join(atlanta, "src") },
  // react-dom/server is CJS and requires node builtins; an ESM bundle has no `require`.
  banner: { js: `import { createRequire as __cr } from "node:module"; const require = __cr(${JSON.stringify(import.meta.url)});` },
  logLevel: "silent",
};
const importText = (code) => import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

// React, its JSX runtime, react-dom/server and the icon set are bundled ONCE, and every panel
// bundle below reads them from that one copy: the teeth pass bundles the panel again for each
// mutation, and these are nearly all of the bytes. One copy is also one React for the panel,
// the icons and the renderer alike.
const SHARED_KEY = "__proofreadCopyGuardReact";
const SHARED = { react: "react", "react/jsx-runtime": "jsxRuntime", "react-dom/server": "server", "lucide-react": "icons" };
let shared;
try {
  const out = await build({
    ...BUILD,
    stdin: {
      contents: Object.entries(SHARED).map(([spec, name]) => `export * as ${name} from ${JSON.stringify(spec)};`).join("\n"),
      resolveDir: atlanta,
      sourcefile: "proofread-react.ts",
      loader: "ts",
    },
  });
  shared = await importText(out.outputFiles[0].text);
  globalThis[SHARED_KEY] = shared;
} catch (e) {
  report("bundles", false, `React and react-dom/server bundle with esbuild: ${(e.errors ?? []).map((x) => x.text).join("; ") || e.message}`);
  console.log(`\n${fails} CHECK(S) FAILED`);
  process.exit(1);
}
/** A module that hands out one of the shared React modules' exports. */
const sharedModule = (spec) => {
  const name = SHARED[spec];
  const keys = Object.keys(shared[name]).filter((k) => k !== "default" && /^[A-Za-z_$][\w$]*$/.test(k));
  return [`const m = globalThis.${SHARED_KEY}.${name};`, "export default m.default ?? m;", ...keys.map((k) => `export const ${k} = m.${k};`)].join("\n");
};

// ProofreadPanel's own `react` import goes to a module that forwards the three hooks it
// uses to the runtime mountPanel installs, and to React when none is installed.
const HOOKS_KEY = "__proofreadCopyGuardHooks";
const HOOKS_SHIM = `
import * as React from "react";
export * from "react";
const own = () => globalThis.${HOOKS_KEY};
export const useState = (...a) => (own() ?? React).useState(...a);
export const useRef = (...a) => (own() ?? React).useRef(...a);
export const useEffect = (...a) => (own() ?? React).useEffect(...a);
`;

// The panel and the client module are loaded from the text handed in, never from disk,
// so a mutation reaches the bundle; `bundles` fails if either was not.
const ENTRY = `
export { ProofreadView, ProofreadPanel } from "@/components/proofread-panel";
export * as lib from "@/lib/proofread";
export { createElement } from "react";
export { renderToStaticMarkup } from "react-dom/server";
`;
async function bundle(src) {
  const loaded = { panel: 0, lib: 0 };
  const out = await build({
    ...BUILD,
    stdin: { contents: ENTRY, resolveDir: atlanta, sourcefile: "proofread-entry.ts", loader: "ts" },
    plugins: [
      {
        name: "proofread-text-under-test",
        setup(b) {
          b.onLoad({ filter: /proofread-panel\.tsx$/ }, (a) => (a.path === PANEL_ABS ? (loaded.panel++, { contents: src.panel, loader: "tsx" }) : undefined));
          b.onLoad({ filter: /proofread\.ts$/ }, (a) => (a.path === LIB_ABS ? (loaded.lib++, { contents: src.lib, loader: "ts" }) : undefined));
          b.onResolve({ filter: /^react$/ }, (a) => (a.importer === PANEL_ABS ? { path: "react", namespace: "panel-hooks" } : undefined));
          b.onLoad({ filter: /.*/, namespace: "panel-hooks" }, () => ({ contents: HOOKS_SHIM, loader: "js", resolveDir: atlanta }));
          b.onResolve({ filter: /^(react|react\/jsx-runtime|react-dom\/server|lucide-react)$/ }, (a) => ({ path: a.path, namespace: "shared-react" }));
          b.onLoad({ filter: /.*/, namespace: "shared-react" }, (a) => ({ contents: sharedModule(a.path), loader: "js" }));
        },
      },
    ],
  });
  if (loaded.panel !== 1 || loaded.lib !== 1) throw new Error(`the panel and the module must each be read from the text under test once (panel ${loaded.panel}, module ${loaded.lib})`);
  return importText(out.outputFiles[0].text);
}

// ─── helpers that read rendered markup (pure) ───────────────────────────────────────
const text = (html) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const findingOrder = (html) => [...html.matchAll(/data-testid="finding-([^"]+)"/g)].map((m) => m[1]);
const buttons = (html) =>
  [...html.matchAll(/<button\b([^>]*)>(.*?)<\/button>/g)].map((m) => ({
    attrs: m[1],
    inner: m[2],
    label: text(m[2]),
    disabled: /\sdisabled(=""|\s|$)/.test(m[1]),
    testid: /data-testid="([^"]+)"/.exec(m[1])?.[1],
  }));
const RED = /text-red-/;
const summaryTag = (html) => /<p\b([^>]*data-testid="proofread-summary"[^>]*)>([^<]*)<\/p>/.exec(html);
const summaryOf = (html) => summaryTag(html)?.[2] ?? null;
const summaryRed = (html) => RED.test(summaryTag(html)?.[1] ?? "");
/**
 * Sibling keys that collide, found by walking the element tree ProofreadView returns (it has no hooks, so it can be
 * called as a function). Server rendering never reports a duplicate key — only the client reconciler does — so the
 * render alone cannot see this.
 */
const duplicateKeys = (root) => {
  const dupes = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      const seen = new Set();
      for (const c of n) {
        if (c && typeof c === "object" && !Array.isArray(c) && c.key != null) {
          if (seen.has(c.key)) dupes.push(String(c.key));
          seen.add(c.key);
        }
        walk(c);
      }
      return;
    }
    if (n.props) walk(n.props.children);
  };
  walk(root);
  return dupes;
};
/** The markup of one finding's card. */
const card = (html, clauseId) => {
  const at = html.indexOf(`data-testid="finding-${clauseId}"`);
  if (at < 0) return "";
  const next = html.indexOf('data-testid="finding-', at + 10);
  return html.slice(at, next < 0 ? undefined : next);
};

// A finding as the GET route sends it.
const mk = (clauseId, type, o = {}) => ({
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
// Coverage defaults to one clause that ran and judged all of its record. An EMPTY coverage is not the neutral choice:
// it means no clause ran, and the panel must say nothing was checked (see "nothing was checked" below).
const FULL_COVERAGE = [{ clauseId: "growthOverrideDisclosed", section: 1, status: "ran" }];
// `withheld: 0` as the route sends it: the count of findings it did not send (a DEFECT, audience admin).
const runOf = (status, o = {}) => ({ status, runId: "run-uuid", coverage: FULL_COVERAGE, findings: [], dispositions: [], withheld: 0, ...o });
const FINISHED = ["rules_ready", "ready"];
const PENDING = ["queued", "running"];
const ALL_STATUSES = ["none", "queued", "running", "rules_ready", "ready", "failed"];
/** Collapse whitespace, and fold every run of hyphens and dashes into it, so "peer-review" reads as "peer review". */
const phraseForm = (s) => s.replace(/[-\u2010-\u2015]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
/**
 * HTML character references read as the character they render: numeric (`&#8212;`, `&#x2014;`) and the named dashes
 * (`&mdash;`, `&ndash;`, `&minus;`, `&hyphen;`, `&dash;`), as the protocol guard reads them.
 */
const NAMED_DASH = { mdash: "\u2014", ndash: "\u2013", minus: "\u2212", hyphen: "\u2010", dash: "\u2010" };
const decodeRefs = (s) =>
  s.replace(/&#(\d{1,7});|&#x([0-9a-f]{1,6});|&(mdash|ndash|minus|hyphen|dash);/gi, (m, d, h, n) => {
    if (n) return NAMED_DASH[n.toLowerCase()];
    const cp = d ? Number(d) : parseInt(h, 16);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
/**
 * The banned customer-venue phrases, spelled as the routes and protocol guards' BANNED_COPY spells them (any case;
 * "QA/QC", "QA / QC", "QA-QC", "QA\QC"), with "audit" in any form ("audits", "auditor", "Audit log"). Read on the
 * phrase form of the text with its character references decoded, never as a substring of the raw text.
 */
const BANNED_COPY = /independent[\s-]*review|second[\s-]*opinion|peer[\s-]*review|qa\s*[/\\-]?\s*qc|\baudit/i;
const BANNED_MSG = '"independent review", "second opinion", "peer review", "QA/QC" and "audit" (any case; spaced, hyphenated, dashed or run together)';
/** The banned phrase `text` holds, as found in its phrase form, or null. */
const bannedIn = (text) => BANNED_COPY.exec(phraseForm(decodeRefs(text)))?.[0] ?? null;

// ─── fixtures read once: the real pass, and the server's contract ───────────────────
const { runClauses, ALL_CLAUSES, findingFingerprint } = await import(
  pathToFileURL(path.join(here, "../src/lib/proofread/index.ts")).href
);
const realPayload = JSON.parse(readFileSync(path.join(atlanta, "scripts/fixtures/scenario-base.json"), "utf8"));
const pass = runClauses({ request: realPayload.request, result: realPayload }, ALL_CLAUSES);
const asRoute = (f, i) => ({
  id: `real-${i}`,
  clauseId: f.clauseId,
  section: f.section,
  type: f.type,
  title: f.title,
  detail: f.detail,
  sourceLabel: f.sourceLabel,
  readPaths: f.readPaths,
  remedy: f.remedy,
  fingerprint: findingFingerprint(f),
});
const realFindings = pass.findings.map(asRoute);
const clause = (id) => realFindings.filter((f) => f.clauseId === id);
const ordinary = [...clause("screeningClampDisclosed"), ...clause("scopeNoteConsistent")];
report(
  "pre-real-pass-ordinary-pair",
  ordinary.length === 2 && ordinary[0].type === "DISCLOSE" && ordinary[1].type === "NOTE",
  "precondition: the real pass over scenario-base yields the ordinary pair (one DISCLOSE, one NOTE) — fixture or clause changed if red",
);
// Since #250 built the intersection row from its approaches (the 2026-10-02 re-pin, artifacts/atlanta-tis/scripts/
// fixtures/README.md), scenario-base no longer carries an implausible no-project v/c, so its pass has no BLOCKER of its
// own. scenario-network-utdf still does (an approach above the 2.5 ceiling), so the ordering case below is handed both
// real passes, each finding with an id of its own.
const utdfPayload = JSON.parse(readFileSync(path.join(atlanta, "scripts/fixtures/scenario-network-utdf.json"), "utf8"));
const utdfFindings = runClauses({ request: utdfPayload.request, result: utdfPayload }, ALL_CLAUSES).findings.map((f, i) => ({
  ...asRoute(f, i),
  id: `real-utdf-${i}`,
}));
report(
  "pre-real-pass-blocker",
  utdfFindings.some((f) => f.type === "BLOCKER"),
  "precondition: the real pass over scenario-network-utdf yields a BLOCKER, so the ordering case below has one to put first",
);
const orderingFindings = [...realFindings, ...utdfFindings];
const contract = await import(pathToFileURL(path.join(repo, "lib/tis-api-zod/src/proofread.ts")).href);
// The one sentence in prompt.ts allowed to name the banned phrases: it tells Datum never to write them. Taken from
// the module itself, so the scan removes exactly that sentence, by exact match, and nothing else: a reworded or
// stretched copy of it in the text under test is no longer the sentence, and is scanned like any other text.
const { NEVER_USE_SENTENCE } = await import(pathToFileURL(path.join(repo, FILES.prompt)).href);
report(
  "pre-never-use-sentence-found",
  typeof NEVER_USE_SENTENCE === "string" && NEVER_USE_SENTENCE.length > 20 && bannedIn(NEVER_USE_SENTENCE) !== null && SOURCES.prompt.split(NEVER_USE_SENTENCE).length === 2,
  "precondition: prompt.ts exports NEVER_USE_SENTENCE, it names banned phrases, and it is written out once in the file, so the exclusion below takes out something real",
);
/** A file's text as the copy scan reads it: prompt.ts without its never-use sentence, every other file whole. */
const scannedText = (file, s) => (file === "prompt" && typeof NEVER_USE_SENTENCE === "string" && NEVER_USE_SENTENCE.length > 0 ? s.split(NEVER_USE_SENTENCE).join(" ") : s);

// What is offered per type, and what closes it.
// Written out by hand here, deliberately NOT read from the module: this is the claim, the module is the thing under test.
// Offered and closing are the same list today; they are two tables here so a drift in either is reported on its own.
const DECISIONS = ["FIXED", "DISCLOSED", "WITHDRAWN", "BUG_FILED", "ACCEPTED_RISK", "CONTESTED_PE"];
const DECISION_LABEL = { FIXED: "Fixed", DISCLOSED: "Disclosed in the deliverable", WITHDRAWN: "Withdrawn on a source" };
const OFFERED = {
  BLOCKER: ["FIXED", "WITHDRAWN"],
  DISCLOSE: ["DISCLOSED", "FIXED", "WITHDRAWN"],
  NOTE: ["DISCLOSED", "FIXED", "WITHDRAWN"],
  UNVERIFIED: ["DISCLOSED", "FIXED", "WITHDRAWN"],
  CONTESTED: [],
  DEFECT: [],
  SOMETHING_NEW: ["FIXED", "WITHDRAWN"],
};
const CLOSED_BY = {
  BLOCKER: ["FIXED", "WITHDRAWN"],
  DISCLOSE: ["DISCLOSED", "FIXED", "WITHDRAWN"],
  NOTE: ["DISCLOSED", "FIXED", "WITHDRAWN"],
  UNVERIFIED: ["DISCLOSED", "FIXED", "WITHDRAWN"],
  CONTESTED: [],
  DEFECT: [],
  SOMETHING_NEW: ["FIXED", "WITHDRAWN"],
};
const HOLDING = new Set(["BLOCKER", "CONTESTED", "DEFECT", "SOMETHING_NEW"]);
const recorded = (id, disposition, createdAt = "2026-10-06T12:00:00Z") => ({ findingId: id, disposition, note: null, sourceLabel: null, createdAt });
/** Freeze a fixture all the way down, so code that writes into what it was handed throws instead of hiding the change. */
const deepFreeze = (o) => {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

/**
 * Just enough of React's hooks to call ProofreadPanel as a plain function and read the element it returns:
 * useState (a value or an updater), useRef, and useEffect, which runs when `commit` is called after the render that
 * scheduled it (again only when its deps change) and whose cleanup runs on `unmount`. Setting state does not render;
 * the caller renders again to read it. Nothing else of React is imitated, and nothing here is asserted about React.
 */
const mountPanel = (Panel, props) => {
  const slots = [];
  let queued = [];
  let at = 0;
  const hooks = {
    useState(init) {
      const i = at++;
      if (!(i in slots)) slots[i] = { value: typeof init === "function" ? init() : init };
      const slot = slots[i];
      return [slot.value, (next) => (slot.value = typeof next === "function" ? next(slot.value) : next)];
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
  return {
    render() {
      at = 0;
      globalThis[HOOKS_KEY] = hooks;
      try {
        return Panel(props);
      } finally {
        delete globalThis[HOOKS_KEY];
      }
    },
    commit() {
      const run = queued;
      queued = [];
      for (const f of run) f();
    },
    unmount() {
      for (const slot of slots) if (typeof slot?.cleanup === "function") slot.cleanup();
    },
  };
};

// GET answers as the route sends them for a finished run: visible findings beside withheld ones and the rules-changed
// flag — the case the fetch tests above (empty findings) never reach — and nothing visible beside a withheld one, and
// a 'ready' run whose rules changed. Each is checked against the
// contract's own ProofreadReadResponse first, so the stub is a real answer and not a convenient one.
const READ_FINDING = (id, clauseId, type) => ({
  id,
  clauseId,
  section: 4,
  type,
  title: `${clauseId} title`,
  detail: `${clauseId} detail`,
  sourceLabel: `${clauseId} source`,
  readPaths: [{ path: "result.x", value: 1 }],
  remedy: `${clauseId} remedy`,
  fingerprint: `fp-${clauseId}`,
});
const READ_ANSWERS = [
  {
    status: "rules_ready",
    runId: "7c2d4a1e-3b5f-4e8a-9c1d-2f6b8a0e4d31",
    revision: 2,
    protocolVersion: "2026-10-07.1",
    rulesVersion: "rules-2",
    engineStamp: "stamp-2",
    inputManifest: { "result.affectedIntersections": true },
    coverage: [{ clauseId: "screeningClampDisclosed", section: 4, status: "ran" }],
    findings: [READ_FINDING("2a9f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", "screeningClampDisclosed", "DISCLOSE")],
    dispositions: [{ findingId: "2a9f3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", disposition: "DISCLOSED", note: null, sourceLabel: null, createdAt: "2026-10-07T09:00:00.000Z" }],
    withheld: 1,
    rulesChanged: true,
    createdAt: "2026-10-07T08:59:00.000Z",
    finishedAt: "2026-10-07T08:59:02.000Z",
  },
  {
    status: "ready",
    runId: "0e4b6c8d-1f2a-4b3c-8d5e-6f7a8b9c0d1e",
    revision: 5,
    protocolVersion: "2026-10-07.1",
    rulesVersion: "rules-2",
    engineStamp: "stamp-5",
    inputManifest: {},
    coverage: [
      { clauseId: "screeningClampDisclosed", section: 4, status: "ran", note: "3 of 4 judged" },
      { clauseId: "criteriaNamed", section: 3, status: "not-run", reason: "no agencies on the record" },
    ],
    findings: [READ_FINDING("3b0a4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", "scopeNoteConsistent", "NOTE"), READ_FINDING("4c1b5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f", "screeningClampDisclosed", "DISCLOSE")],
    dispositions: [],
    withheld: 2,
    rulesChanged: false,
    createdAt: "2026-10-07T10:00:00.000Z",
    finishedAt: null,
  },
  // Fix wave 3, G2-2: the halves the two above leave open. Nothing visible and one withheld — a count zeroed when
  // nothing is visible would show "Nothing flagged" over a DEFECT; and a 'ready' run whose rules changed — a flag
  // dropped for 'ready' would hide why decisions were reopened.
  {
    status: "rules_ready",
    runId: "5d2c6f7a-8b9c-4d0e-9f1a-3b4c5d6e7f80",
    revision: 3,
    protocolVersion: "2026-10-07.1",
    rulesVersion: "rules-2",
    engineStamp: "stamp-3",
    inputManifest: {},
    coverage: [{ clauseId: "screeningClampDisclosed", section: 4, status: "ran" }],
    findings: [],
    dispositions: [],
    withheld: 1,
    rulesChanged: false,
    createdAt: "2026-10-07T11:00:00.000Z",
    finishedAt: "2026-10-07T11:00:02.000Z",
  },
  {
    status: "ready",
    runId: "6e3d7a8b-9c0d-4e1f-8a2b-4c5d6e7f8091",
    revision: 4,
    protocolVersion: "2026-10-07.1",
    rulesVersion: "rules-3",
    engineStamp: "stamp-4",
    inputManifest: {},
    coverage: [{ clauseId: "scopeNoteConsistent", section: 4, status: "ran" }],
    findings: [READ_FINDING("5d2c6f7a-0e1f-4a2b-9c3d-4e5f6a7b8c9d", "scopeNoteConsistent", "NOTE")],
    dispositions: [],
    withheld: 1,
    rulesChanged: true,
    createdAt: "2026-10-07T12:00:00.000Z",
    finishedAt: "2026-10-07T12:00:02.000Z",
  },
];
for (const [i, answer] of READ_ANSWERS.entries()) {
  const parsed = contract.ProofreadReadResponse?.safeParse?.(answer);
  report(`pre-read-answer-is-a-contract-answer`, parsed?.success === true, `precondition: stubbed GET answer ${i + 1} is one the contract's ProofreadReadResponse accepts${parsed?.success ? "" : ` (${JSON.stringify(parsed?.error?.issues?.[0] ?? "no schema")})`}`);
}

/**
 * Every check, run against one set of source texts. Returns [{ id, pass, msg }] in order; prints nothing. The real
 * files are one call; each mutation is another.
 */
async function suite(src) {
  const results = [];
  const ok = (id, cond, msg) => results.push({ id, pass: !!cond, msg });
  /** A group that throws is a FAIL that says so, never a silent pass or a crash that hides the rest. */
  const group = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      ok(`threw:${name}`, false, `${name} threw: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const panel = src.panel;

  // ─── 1. COPY ──────────────────────────────────────────────────────────────────────
  for (const file of ["panel", "lib", "route", "page", "chat", "prompt"]) {
    const hit = bannedIn(scannedText(file, src[file]));
    ok(`${file}-avoids-banned-copy`, src[file].length > 0 && hit === null, `${FILES[file]}: avoids ${BANNED_MSG}${hit === null ? "" : ` — found ${JSON.stringify(hit)}`}`);
  }
  ok("source-permitted-description", /internal consistency and traceability check/i.test(panel), "the panel uses the permitted description verbatim");
  ok("source-names-never-checked", /status === "none"/.test(panel), "the panel names the never-checked status (the BRANCH is asserted below, by rendering)");
  ok("source-no-study-changing-control", !/\bapply\b|\bfix it\b|\bauto-?fix\b/i.test(panel), "the panel offers no control that changes the study");

  // ─── 2. BEHAVIOUR ─────────────────────────────────────────────────────────────────
  let mod;
  try {
    mod = await bundle(src);
  } catch (e) {
    ok("bundles", false, `the panel bundles with esbuild (a broken panel, not a caught mutation): ${(e.errors ?? []).map((x) => x.text).join("; ") || e.message}`);
    return results;
  }
  ok("bundles", true, "the panel and the client module bundle with esbuild, each read from the text under test");
  const { ProofreadView, ProofreadPanel, createElement, renderToStaticMarkup, lib } = mod;

  const warnings = [];
  const realError = console.error;
  const realFetch = globalThis.fetch;
  console.error = (...a) => warnings.push(a.map(String).join(" ").slice(0, 200));
  const view = (run, o = {}) =>
    renderToStaticMarkup(createElement(ProofreadView, { run, error: null, busy: false, onRerun() {}, onTriage() {}, ...o }));
  const everyHtml = [];
  const keep = (html) => (everyHtml.push(html), html);

  try {
    await group("never-checked is not clean", () => {
      const html = keep(view(runOf("none")));
      const t = text(html);
      ok("none-says-not-checked", /has not been checked yet/.test(t), "none: says the study has not been checked");
      ok("none-not-nothing-flagged", !/Nothing flagged/i.test(t), "none: does NOT say nothing was flagged (the empty-findings branch is not reached)");
      ok("none-no-green-check", !/emerald/.test(html), "none: no green check anywhere");
      ok("none-not-in-progress", !/Checking this study/.test(t), "none: is not shown as in progress either");
      ok("none-offers-run-the-check", /Run the check/.test(t) && !/Run again/.test(t), "none: the button offers to run the check, not to run it again");
    });

    await group("findings only for a finished run", () => {
      const withFindings = [mk("a", "DISCLOSE"), mk("b", "NOTE")];
      for (const status of ALL_STATUSES) {
        const html = keep(view(runOf(status, { findings: withFindings })));
        const shown = findingOrder(html).length;
        const expected = FINISHED.includes(status) ? 2 : 0;
        ok("findings-only-when-finished", shown === expected, `${status}: renders ${expected} of 2 stored findings (rendered ${shown})`);
        const triage = buttons(html).filter((b) => b.testid?.startsWith("button-disposition-")).length;
        // A DISCLOSE and a NOTE are each offered three decisions.
        ok("triage-only-when-finished", triage === (expected ? 6 : 0), `${status}: ${expected ? "offers" : "offers no"} triage controls (${triage} buttons)`);
        // The header is the completion gate as a sentence. Over a DISCLOSE and a NOTE it reads "No open blocker or contested
        // item", which on a run that never finished, with no card beneath it, is a false clear.
        const header = summaryOf(html);
        ok(
          "header-only-when-finished",
          FINISHED.includes(status) ? header !== null : header === null,
          `${status}: ${FINISHED.includes(status) ? "has" : "has NO"} header summary over a stored DISCLOSE + NOTE (${JSON.stringify(header)})`,
        );
      }
      for (const status of PENDING) {
        const t = text(view(runOf(status, { findings: withFindings })));
        ok("pending-says-in-progress", /Checking this study/.test(t), `${status}: says the check is in progress`);
        ok("pending-empty-not-nothing-flagged", !/Nothing flagged/i.test(text(view(runOf(status)))), `${status}: an empty pending run is not "nothing flagged"`);
      }
      const failed = text(keep(view(runOf("failed", { findings: withFindings }))));
      ok("failed-says-did-not-finish", /did not finish/.test(failed), "failed: says the check did not finish");
      ok("failed-empty-not-nothing-flagged", !/Nothing flagged/i.test(text(view(runOf("failed")))), "failed: an empty failed run is not 'nothing flagged'");
    });

    await group("partial coverage is shown, not hidden", () => {
      const coverage = [
        { clauseId: "screeningClampDisclosed", section: 4, status: "ran", note: "37 of 40 reported delay fields judged" },
        { clauseId: "growthOverrideDisclosed", section: 1, status: "ran" },
        { clauseId: "criteriaNamed", section: 3, status: "not-run", reason: "no agencies on the record" },
      ];
      // With no findings: the case where "nothing found" and "nothing found in the part I could read" differ.
      const empty = keep(view(runOf("rules_ready", { coverage })));
      const t = text(empty);
      ok("partial-note-shown", /screeningClampDisclosed — 37 of 40 reported delay fields judged/.test(t), "a clause that judged part of the record: its note is rendered beside the result");
      ok("full-clause-adds-no-note", !/growthOverrideDisclosed/.test(t), "a clause that judged all of the record adds no note");
      ok("not-run-listed-with-reason", /1 clause could not run on this study/.test(t) && /criteriaNamed — no agencies on the record/.test(t), "a clause that could not run is listed with its reason");
      ok("empty-run-sentence-scoped", /Nothing flagged in the clauses that could run/.test(t), "empty finished run: the scoped sentence, not an unqualified all-clear");
      ok("partial-empty-no-green-check", !/emerald/.test(empty), "empty run with partial coverage: no green check (a check mark claims more than was judged)");
      // The partial-only case, isolated: one clause judged part of the record, no clause was skipped.
      const onlyPartial = [{ clauseId: "screeningClampDisclosed", section: 4, status: "ran", note: "37 of 40 reported delay fields judged" }];
      const po = keep(view(runOf("rules_ready", { coverage: onlyPartial })));
      ok("partial-only-no-green-scoped", !/emerald/.test(po) && /Nothing flagged in the clauses that could run/.test(text(po)), "partial coverage and no skipped clause: no green check, and the sentence stays scoped");
      const poH = summaryOf(view(runOf("rules_ready", { coverage: onlyPartial, findings: ordinary }))) ?? "";
      ok("partial-only-header-scoped", /No open blocker or contested item in the clauses that ran\./.test(poH), `partial coverage and no skipped clause: the header says "in the clauses that ran" (${JSON.stringify(poH)})`);
      const full = keep(view(runOf("rules_ready", { coverage: [{ clauseId: "a", section: 1, status: "ran" }] })));
      ok("full-empty-green-earned", /emerald/.test(full) && /Nothing flagged/.test(text(full)), "empty run where every clause judged everything: the green check is earned");
      // With findings: the note still rides along.
      const withF = text(keep(view(runOf("rules_ready", { coverage, findings: [mk("a", "NOTE")] }))));
      ok("partial-note-beside-findings", /37 of 40 reported delay fields judged/.test(withF), "partial note is shown beside findings too");
      // Not for a run that is not finished.
      for (const status of [...PENDING, "failed", "none"]) {
        const tt = text(view(runOf(status, { coverage })));
        ok("unfinished-coverage-not-shown", !/37 of 40/.test(tt) && !/could not run/.test(tt), `${status}: a coverage note from an unfinished run is not shown as a result`);
      }
    });

    await group("nothing was checked is not nothing found", () => {
      const NOTHING = /No clause could run on this study, so nothing was checked\./;
      const twelve = Array.from({ length: 12 }, (_, i) => ({ clauseId: `clause${i}`, section: 1, status: "not-run", reason: "payload predates the field" }));
      for (const [name, coverage] of [["no coverage at all", []], ["every clause not-run (12 of 12)", twelve]]) {
        for (const status of FINISHED) {
          const h = keep(view(runOf(status, { coverage })));
          const t = text(h);
          ok("nothing-checked-says-so", NOTHING.test(t), `${status}, ${name}: says nothing was checked`);
          ok("nothing-checked-not-nothing-flagged", !/Nothing flagged/i.test(t), `${status}, ${name}: does NOT say nothing was flagged`);
          ok("nothing-checked-no-green-check", !/emerald/.test(h), `${status}, ${name}: no green check`);
        }
      }
      ok("nothing-checked-lists-why", /12 clauses could not run on this study/.test(text(view(runOf("rules_ready", { coverage: twelve })))), "12 of 12 not-run: the list of why is still there");
      // Only for a finished run. runOf's default coverage is a clause that ran, so these use the empty and the all-not-run
      // coverage explicitly: that is the coverage a never-checked, queued, running or failed row actually carries.
      for (const status of ["none", ...PENDING, "failed"]) {
        for (const [name, coverage] of [["no coverage", []], ["12 of 12 not-run", twelve]]) {
          const t = text(keep(view(runOf(status, { coverage }))));
          ok(
            "nothing-checked-finished-only",
            !NOTHING.test(t),
            `${status}, ${name}: the nothing-checked sentence is for a finished run only (rendered: ${JSON.stringify(t.slice(t.indexOf("Run ")).slice(0, 110))})`,
          );
        }
      }
      ok("none-empty-coverage-not-checked-yet", /has not been checked yet/.test(text(view(runOf("none", { coverage: [] })))), "none, no coverage: still says it has not been checked yet");
      // The header, were there anything under it, is scoped too.
      ok("nothing-checked-header-scoped", /in the clauses that ran/.test(summaryOf(view(runOf("rules_ready", { coverage: [], findings: ordinary }))) ?? ""), "no coverage: a header over findings is scoped to the clauses that ran");
      // A run in which something did run keeps the old wording.
      ok("one-ran-is-not-nothing-checked", !NOTHING.test(text(view(runOf("rules_ready", { coverage: [...twelve, { clauseId: "x", section: 1, status: "ran" }] })))), "one clause ran: it is not 'nothing was checked'");
    });

    // ─── a finding the server withheld ────────────────────────────────────────────────
    // GET never sends a finding whose audience is admin (a DEFECT: a software fault, routed to
    // the software team) and says only how many there are (`withheld`). A DEFECT holds the study
    // until the software team resolves it, so a run carrying one is never read as clear: before
    // this, a run whose only finding was a DEFECT rendered "Nothing flagged" under a green check.
    // The line says what clears it. A re-run judges the same saved study and raises the same
    // DEFECT, so "until a re-run no longer raises it" could never be met for a fault in the
    // engine: that fix reaches a study only when the study is generated again.
    await group("a finding routed to the software team is never a clear", async () => {
      const ROUTED_1 =
        "1 item on this study was routed to the software team. Hold the study until they resolve it. If the fix is to the engine, generate the study again once it ships.";
      const ROUTED_2 =
        "2 items on this study were routed to the software team. Hold the study until they resolve them. If the fix is to the engine, generate the study again once it ships.";
      const routedOf = (html) => /<p\b[^>]*data-testid="proofread-withheld"[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? null;
      for (const status of FINISHED) {
        // The case that was a false clear: nothing visible, full coverage, one withheld.
        const h = keep(view(runOf(status, { withheld: 1 })));
        const t = text(h);
        ok("withheld-not-nothing-flagged", !/Nothing flagged/i.test(t), `${status}, 1 withheld and nothing visible: does NOT say nothing was flagged`);
        ok("withheld-no-green-check", !/emerald/.test(h), `${status}, 1 withheld and nothing visible: no green check`);
        ok("withheld-not-nothing-checked", !/nothing was checked/.test(t), `${status}, 1 withheld and nothing visible: does not say nothing was checked either (a clause ran, and raised it)`);
        ok(
          "withheld-routed-line-red",
          routedOf(h) === ROUTED_1 && RED.test(/<p\b[^>]*data-testid="proofread-withheld"[^>]*>/.exec(h)?.[0] ?? ""),
          `${status}, 1 withheld: says, in red, that it was routed to the software team and holds the study (${JSON.stringify(routedOf(h))})`,
        );
        const s1 = summaryOf(h) ?? "";
        ok(
          "withheld-header-holds",
          /^1 open item to resolve before this study is called complete\.$/.test(s1) && summaryRed(h),
          `${status}, 1 withheld and nothing visible: the header counts it as an open hold, in red (${JSON.stringify(s1)})`,
        );
      }
      // Nothing withheld: exactly the panel a run without the field draws.
      for (const [name, o] of [
        ["full coverage", {}],
        ["partial coverage", { coverage: [{ clauseId: "a", section: 4, status: "ran", note: "3 of 4 judged" }] }],
        ["no clause ran", { coverage: [] }],
        ["an ordinary DISCLOSE + NOTE", { findings: ordinary }],
      ]) {
        const zero = keep(view(runOf("rules_ready", { ...o, withheld: 0 })));
        const absent = view({ ...runOf("rules_ready", o), withheld: undefined });
        ok("withheld-zero-unchanged", zero === absent && routedOf(zero) === null && !/software team/.test(text(zero)), `withheld 0, ${name}: the panel is unchanged — the same markup as a run that carries no count, and no routed line`);
      }
      ok(
        "withheld-zero-green-earned",
        /emerald/.test(view(runOf("rules_ready", { withheld: 0 }))) && /Nothing flagged/.test(text(view(runOf("rules_ready", { withheld: 0 })))),
        "withheld 0, full coverage, nothing found: the green check is still earned",
      );

      const two = keep(view(runOf("rules_ready", { withheld: 2 })));
      ok("withheld-two-line-plural", routedOf(two) === ROUTED_2, `2 withheld: the line is plural (${JSON.stringify(routedOf(two))})`);
      ok("withheld-two-header-counts", /^2 open items to resolve before this study is called complete\.$/.test(summaryOf(two) ?? ""), `2 withheld: the header counts both (${JSON.stringify(summaryOf(two))})`);

      // Every visible item decided: never "Every item has a recorded decision" over a withheld one.
      const decided = keep(view(runOf("rules_ready", { withheld: 1, findings: [mk("d1", "DISCLOSE")], dispositions: [{ findingId: "f-d1", disposition: "DISCLOSED", note: null, sourceLabel: null, createdAt: "2026-10-06T12:00:00Z" }] })));
      const ds = summaryOf(decided) ?? "";
      ok(
        "withheld-decided-header-holds",
        !/Every item has a recorded decision/.test(ds) && /^1 open item to resolve before this study is called complete\.$/.test(ds) && summaryRed(decided),
        `every visible item decided, 1 withheld: the header does not say every item has a recorded decision (${JSON.stringify(ds)})`,
      );
      ok("withheld-decided-finding-and-line", routedOf(decided) === ROUTED_1 && findingOrder(decided).join(",") === "d1", "every visible item decided, 1 withheld: the visible finding is still shown, and the routed line beside it");

      // An ordinary study with a withheld item is not "No open blocker or contested item".
      const ord = keep(view(runOf("rules_ready", { withheld: 1, findings: ordinary })));
      const os = summaryOf(ord) ?? "";
      ok(
        "withheld-ordinary-header-holds",
        !/No open blocker/.test(os) && /^1 open item to resolve before this study is called complete\. Also: 1 to state in the deliverable, 1 note\.$/.test(os),
        `an ordinary DISCLOSE + NOTE and 1 withheld: the header is the hold, not the quiet sentence (${JSON.stringify(os)})`,
      );

      // Scoped coverage does not turn a withheld item back into a clear or into "nothing checked".
      for (const [name, coverage] of [
        ["partial coverage", [{ clauseId: "a", section: 4, status: "ran", note: "3 of 4 judged" }]],
        ["a clause that could not run", [...FULL_COVERAGE, { clauseId: "b", section: 5, status: "not-run", reason: "r" }]],
        ["no coverage recorded", []],
      ]) {
        const h = keep(view(runOf("rules_ready", { withheld: 1, coverage })));
        const t = text(h);
        ok(
          "withheld-scoped-coverage-not-clear",
          !/Nothing flagged|nothing was checked/.test(t) && !/emerald/.test(h) && routedOf(h) === ROUTED_1,
          `1 withheld, ${name}: neither "nothing flagged" nor "nothing was checked", no green check, and the routed line`,
        );
      }
      // Only a finished run's result is shown.
      for (const status of ["none", ...PENDING, "failed"]) {
        const h = keep(view(runOf(status, { withheld: 1 })));
        ok("withheld-unfinished-shows-nothing", routedOf(h) === null && summaryOf(h) === null, `${status}, 1 withheld: no routed line and no header (an unfinished run shows no result)`);
      }

      // The client module: summarizeOpen counts withheld as holds; fetchProofread carries the count.
      const sw = lib.summarizeOpen([], [], 1);
      ok("summarize-counts-withheld", sw.total === 1 && sw.open === 1 && sw.holds === 1 && sw.withheld === 1, `summarizeOpen([], [], 1) counts the withheld finding as an open hold (got ${JSON.stringify(sw)})`);
      const s0 = lib.summarizeOpen([mk("a", "NOTE")], []);
      ok("summarize-without-count-unchanged", s0.total === 1 && s0.open === 1 && s0.holds === 0 && s0.withheld === 0 && s0.note === 1, `summarizeOpen without a count is unchanged (got ${JSON.stringify(s0)})`);
      ok("summarize-ignores-bad-count", [-1, 1.5, NaN, undefined].every((w) => lib.summarizeOpen([], [], w).holds === 0), "summarizeOpen ignores a count that is not a whole number above 0");
      ok("withheld-line-pluralised", typeof lib.withheldLine === "function" && lib.withheldLine(1) === ROUTED_1 && lib.withheldLine(2) === ROUTED_2, "withheldLine says it once, pluralised");
      {
        // The panel, the client module (its comments included, read with each line break, and the `*` or `//` that
        // opens the next comment line, folded into one space, so a wrapped sentence is still one sentence) and every
        // routed line drawn above.
        const OLD_RULE = /re-?run no longer raises/i;
        const flatText = (t) => t.replace(/\s*\n\s*(?:\*(?!\/)|\/\/)?/g, " ").replace(/\s+/g, " ");
        const stillSaid = [
          ...["panel", "lib"].filter((f) => OLD_RULE.test(flatText(src[f]))).map((f) => FILES[f]),
          ...[1, 2, 3].filter((n) => OLD_RULE.test(lib.withheldLine(n))).map((n) => `withheldLine(${n})`),
          ...(everyHtml.some((h) => OLD_RULE.test(text(h))) ? ["a rendered state"] : []),
        ];
        ok(
          "withheld-old-clearing-rule-gone",
          stillSaid.length === 0,
          `no one is told to hold the study "until a re-run no longer raises it" — a re-run judges the same saved study and raises the same DEFECT${stillSaid.length ? ` (still said in: ${stillSaid.join(", ")})` : ""}`,
        );
      }
      try {
        const got = [];
        for (const w of [3, 0, undefined, "1", -2, 1.5, null]) {
          globalThis.fetch = async () => new Response(JSON.stringify({ status: "rules_ready", runId: "r", coverage: [], findings: [], dispositions: [], ...(w === undefined ? {} : { withheld: w }) }), { status: 200 });
          got.push((await lib.fetchProofread("proj-1")).withheld);
        }
        ok("fetch-carries-withheld", JSON.stringify(got) === "[3,0,0,0,0,0,0]", `fetchProofread carries the server's count, and anything that is not a whole number above 0 is 0 (got ${JSON.stringify(got)})`);
      } finally {
        globalThis.fetch = realFetch;
      }
    });

    // ─── decisions reopened by a rules change ─────────────────────────────────────────
    // A RULES_VERSION change reopens every recorded decision on purpose: the carry-forward stops at it.
    // GET says when the revision this run carried from ran under other rules (`rulesChanged`), and the
    // panel gives that reason in one line on a finished run, so the reopened items are not a mystery.
    await group("a rules change says why the earlier decisions reopened", async () => {
      const RULES_CHANGED = "The check's rules changed since the last run, so earlier decisions were not carried over.";
      const lineOf = (html) => {
        const m = /<p\b[^>]*data-testid="proofread-rules-changed"[^>]*>([^<]*)<\/p>/.exec(html);
        return m ? text(m[1]) : null;
      };
      const times = (html) => text(html).split(RULES_CHANGED).length - 1;
      ok("rules-changed-line-is-the-sentence", lib.RULES_CHANGED_LINE === RULES_CHANGED, `the client module's RULES_CHANGED_LINE is the sentence (${JSON.stringify(lib.RULES_CHANGED_LINE)})`);
      for (const status of FINISHED) {
        const h = keep(view(runOf(status, { rulesChanged: true, findings: ordinary })));
        ok("rules-changed-says-once", lineOf(h) === RULES_CHANGED && times(h) === 1, `${status}, rulesChanged: says once that the rules changed and earlier decisions were not carried over (${JSON.stringify(lineOf(h))})`);
        const empty = keep(view(runOf(status, { rulesChanged: true })));
        ok("rules-changed-empty-run-says-it", lineOf(empty) === RULES_CHANGED, `${status}, rulesChanged and nothing found: the line is still there`);
      }
      for (const status of ALL_STATUSES.filter((st) => !FINISHED.includes(st))) {
        const h = keep(view(runOf(status, { rulesChanged: true })));
        ok("rules-changed-unfinished-no-line", lineOf(h) === null && times(h) === 0, `${status}, rulesChanged: no line (an unfinished run shows no result)`);
      }
      for (const status of FINISHED) {
        const no = keep(view(runOf(status, { rulesChanged: false, findings: ordinary })));
        ok("rules-unchanged-no-line", no === view(runOf(status, { findings: ordinary })) && lineOf(no) === null && times(no) === 0, `${status}, rulesChanged false: no line, and the same markup as a run that carries no flag`);
      }
      try {
        const got = [];
        for (const v of [true, false, undefined, "true", 1, null]) {
          globalThis.fetch = async () =>
            new Response(JSON.stringify({ status: "rules_ready", runId: "r", coverage: [], findings: [], dispositions: [], withheld: 0, ...(v === undefined ? {} : { rulesChanged: v }) }), { status: 200 });
          got.push((await lib.fetchProofread("proj-1")).rulesChanged);
        }
        ok("fetch-carries-rules-changed", JSON.stringify(got) === "[true,false,false,false,false,false]", `fetchProofread carries rulesChanged: true only for the boolean true, false for anything else (got ${JSON.stringify(got)})`);
      } finally {
        globalThis.fetch = realFetch;
      }
    });

    // ─── a whole answer, findings and all ──────────────────────────────────────────────
    // The fetch tests above send `findings: []`. A fetchProofread that read the count only when nothing was visible,
    // or dropped the flag when something was, passed all of them: here the answer carries visible findings too, and
    // what fetchProofread hands the panel is compared with the run written out by hand, field by field.
    await group("fetchProofread carries a whole answer", async () => {
      const wantOf = (a) => ({
        status: a.status,
        runId: a.runId,
        revision: a.revision,
        protocolVersion: a.protocolVersion,
        engineStamp: a.engineStamp,
        coverage: a.coverage,
        findings: a.findings,
        dispositions: a.dispositions,
        withheld: a.withheld,
        rulesChanged: a.rulesChanged,
        createdAt: a.createdAt,
        finishedAt: a.finishedAt,
      });
      try {
        for (const [i, answer] of READ_ANSWERS.entries()) {
          globalThis.fetch = async () => new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
          const got = await lib.fetchProofread("proj-1");
          ok(
            "fetch-carries-a-full-answer",
            isDeepStrictEqual(got, wantOf(answer)),
            `answer ${i + 1} (${answer.findings.length} visible, withheld ${answer.withheld}, rulesChanged ${answer.rulesChanged}): fetchProofread hands the panel every field it reads, as sent (got withheld ${got?.withheld}, rulesChanged ${got?.rulesChanged}, ${got?.findings?.length} findings)`,
          );
        }
      } finally {
        globalThis.fetch = realFetch;
      }
    });

    await group("order and tone: an ordinary study is not an alarm", () => {
      // The server order is by clause; the panel must not trust it.
      const shuffled = [mk("n1", "NOTE"), mk("u1", "UNVERIFIED"), mk("d1", "DISCLOSE"), mk("c1", "CONTESTED"), mk("b1", "BLOCKER"), mk("n2", "NOTE"), mk("d2", "DISCLOSE")];
      const order = findingOrder(keep(view(runOf("rules_ready", { findings: shuffled }))));
      ok(
        "order-holds-first",
        order.join(",") === "c1,b1,d1,d2,n1,n2,u1",
        `BLOCKER and CONTESTED first (one tier, server order kept: c1 was sent before b1), then DISCLOSE, then NOTE, UNVERIFIED last (got ${order.join(",")})`,
      );
      // Each real pass arrives in clause order (base: DISCLOSE, NOTE; network-utdf: BLOCKER, NOTE), so hand both over reversed.
      const real = findingOrder(keep(view(runOf("rules_ready", { findings: [...orderingFindings].reverse() }))));
      const types = real.map((id) => orderingFindings.find((f) => f.clauseId === id).type);
      ok("order-real-pass-by-severity", types.join(" > ") === "BLOCKER > DISCLOSE > NOTE > NOTE", `the real passes over scenario-base and scenario-network-utdf, handed over reversed, render in severity order (${types.join(" > ")})`);

      const html = keep(view(runOf("rules_ready", { findings: ordinary })));
      const t = text(html);
      const s = summaryOf(html);
      ok("ordinary-shows-both", findingOrder(html).length === 2, "ordinary study: both findings are still shown (nothing is suppressed)");
      ok("ordinary-nothing-red", !RED.test(html), "ordinary study (one DISCLOSE, one NOTE): nothing on the panel is red");
      ok("ordinary-header-no-open-blocker", s !== null && /No open blocker or contested item/.test(s), `ordinary study: the header says no blocker or contested item is open (${JSON.stringify(s)})`);
      ok("ordinary-header-counts", s !== null && /1 to state in the deliverable/.test(s) && /1 note\b/.test(s), "ordinary study: the header counts what is to be said and what is to be carried");
      ok(
        "ordinary-card-colours",
        /text-amber-600/.test(card(html, "screeningClampDisclosed")) && /text-yellow-600/.test(card(html, "scopeNoteConsistent")),
        "ordinary study: the DISCLOSE card is amber and the NOTE card yellow — the 'moderate' and 'minor' severity colours",
      );
      ok("blocker-card-red", /text-red-600/.test(card(view(runOf("rules_ready", { findings: [mk("b1", "BLOCKER")] })), "b1")), "a BLOCKER card is red — the 'major' colour is kept for what holds the study");
      ok("ordinary-nothing-to-resolve", !/to resolve before/.test(t), "ordinary study: nothing is described as to be resolved before completion");

      const hedged = summaryOf(view(runOf("rules_ready", { findings: ordinary, coverage: [{ clauseId: "x", section: 1, status: "not-run", reason: "r" }] })));
      ok("hedged-header-scoped", hedged !== null && /No open blocker or contested item in the clauses that ran\./.test(hedged), "a study some clauses could not judge: 'no open blocker' is scoped to the clauses that ran");
      ok("full-header-not-hedged", !/in the clauses that ran/.test(s ?? ""), "a study every clause judged: the header is not hedged");

      const hold = keep(view(runOf("rules_ready", { findings: [mk("b1", "BLOCKER"), mk("d1", "DISCLOSE")] })));
      const hs = summaryOf(hold);
      ok("blocker-header-red", hs !== null && /1 open item to resolve before this study is called complete/.test(hs) && summaryRed(hold), `a BLOCKER open: the header says so, in red (${JSON.stringify(hs)})`);
      ok("ordinary-header-not-red", !summaryRed(html), "ordinary study: the header itself is not red");
      const cont = summaryOf(view(runOf("rules_ready", { findings: [mk("c1", "CONTESTED")] })));
      ok("contested-counts-as-hold", cont !== null && /1 open item to resolve/.test(cont), "a CONTESTED item open counts the same as a BLOCKER");

      const decided = view(
        runOf("rules_ready", {
          findings: [mk("b1", "BLOCKER"), mk("d1", "DISCLOSE")],
          dispositions: [{ findingId: "f-b1", disposition: "FIXED", note: null, sourceLabel: null, createdAt: "2026-10-06T12:00:00Z" }],
        }),
      );
      const ds = summaryOf(decided);
      ok("decided-blocker-not-open", ds !== null && /No open blocker or contested item/.test(ds) && /1 to state/.test(ds), `a BLOCKER with a recorded decision is no longer open (${JSON.stringify(ds)})`);
      ok("decided-shows-record", /Recorded:/.test(text(decided)) && /FIXED/.test(text(decided)), "a decided finding shows what was recorded");
      const allDecided = summaryOf(
        view(runOf("rules_ready", { findings: [mk("d1", "DISCLOSE")], dispositions: [{ findingId: "f-d1", disposition: "DISCLOSED", note: null, sourceLabel: null, createdAt: "2026-10-06T12:00:00Z" }] })),
      );
      ok("every-decided-header", allDecided !== null && /Every item has a recorded decision/.test(allDecided), "every item decided: the header says so");
      ok("no-header-empty-or-pending", summaryOf(view(runOf("rules_ready"))) === null && summaryOf(view(runOf("queued", { findings: ordinary }))) === null, "no header summary for an empty run or a run in progress");
    });

    await group("what each finding reads, and the only controls", () => {
      const f = mk("a", "DISCLOSE", {
        readPaths: Array.from({ length: 8 }, (_, i) => ({ path: `result.rows[${i}].delay`, value: 300 })),
      });
      // Two reads of the same path (two scenarios, two periods) are two lines, not one and a key collision.
      const dupRun = runOf("rules_ready", { findings: [mk("t", "NOTE", { readPaths: [{ path: "result.dup", value: 1 }, { path: "result.dup", value: 2 }] })] });
      const twice = text(keep(view(dupRun)));
      ok("same-path-reads-both-shown", /result\.dup = 1/.test(twice) && /result\.dup = 2/.test(twice), "two reads of the same path are both shown");
      const dupes = duplicateKeys(ProofreadView({ run: dupRun, error: null, busy: false, onRerun() {}, onTriage() {} }));
      ok("same-path-reads-no-key-collision", dupes.length === 0, `two reads of the same path do not collide on a React key${dupes.length ? ` (${dupes.join(", ")})` : ""}`);
      ok("pre-key-walker", duplicateKeys([createElement("i", { key: "a" }), createElement("i", { key: "a" })]).length === 1, "precondition: the key walker does report a collision when there is one");
      const html = keep(view(runOf("rules_ready", { findings: [f] })));
      const t = text(html);
      ok("names-checked-against", /Checked against: a source/.test(t), "a finding names the source it was checked against");
      ok("first-six-values", /result\.rows\[5\]\.delay = 300/.test(t) && !/result\.rows\[6\]\.delay/.test(t) && /and 2 more values/.test(t), "a finding shows the first six values it read and counts the rest");
      const labels = buttons(html).map((b) => b.label);
      ok(
        "disclose-only-controls",
        labels.join("|") === "Run again|Disclosed in the deliverable|Fixed|Withdrawn on a source",
        `the only controls on a DISCLOSE are re-run and three that record a decision (${labels.join(" | ")})`,
      );
      ok("no-sealing-decisions", !/ACCEPTED_RISK|CONTESTED_PE|accepted risk|sealing/i.test(html), "the panel does not offer the two decisions only the sealing engineer may record");
      ok("no-link-form-field", !/<a\b|<form\b|<input\b|<select\b|<textarea\b/.test(html), "no link, form or field on the panel: nothing to navigate to or to edit with");
    });

    await group("a finding type this client does not know", () => {
      const html = keep(view(runOf("rules_ready", { findings: [mk("n1", "NOTE"), mk("z1", "SOMETHING_NEW")] })));
      ok("unknown-type-shown-first", findingOrder(html).join(",") === "z1,n1", "an unclassified finding is shown, and first — not buried and not a crash");
      ok("unknown-type-labelled", /SOMETHING_NEW/.test(text(html)), "an unclassified finding is labelled with its own type");
      ok("unknown-type-counted", /to resolve before/.test(summaryOf(html) ?? ""), "an unclassified finding is counted with what needs a look");
      ok(
        "unknown-type-strictest-set",
        buttons(card(html, "z1")).map((b) => b.label).join("|") === "Fixed|Withdrawn on a source",
        "an unclassified finding is offered the strictest set (what a BLOCKER is offered), not none and not the loosest",
      );
    });

    await group("decisions offered per finding type", () => {
      const everyLabel = [];
      for (const type of Object.keys(OFFERED)) {
        const html = keep(view(runOf("rules_ready", { findings: [mk("x", type)] })));
        const labels = buttons(card(html, "x")).map((b) => b.label);
        everyLabel.push(...labels);
        ok(
          "offered-per-type",
          labels.join("|") === OFFERED[type].map((d) => DECISION_LABEL[d]).join("|"),
          `${type}: offered ${OFFERED[type].length ? OFFERED[type].map((d) => DECISION_LABEL[d]).join(", ") : "no decisions"} (got ${labels.join(", ") || "none"})`,
        );
      }
      ok("no-bug-filed-label", !everyLabel.some((l) => /bug/i.test(l)), "no finding type is offered 'Bug filed': that is a DEFECT's decision and a DEFECT never reaches an engineer");
      const all = everyHtml.join("\n");
      ok("no-reserved-decision-control", !/button-disposition-(bug_filed|accepted_risk|contested_pe)/.test(all), "no rendered state carries a BUG_FILED, ACCEPTED_RISK or CONTESTED_PE control");
      const contested = text(card(view(runOf("rules_ready", { findings: [mk("x", "CONTESTED")] })), "x"));
      ok("contested-awaits-engineer", /Awaiting the sealing engineer's ruling/.test(contested), "a CONTESTED item says it awaits the sealing engineer's ruling, in place of buttons");
      ok("only-contested-awaits", !/Awaiting/.test(text(card(view(runOf("rules_ready", { findings: [mk("x", "BLOCKER")] })), "x"))), "only a CONTESTED item says that");
    });

    await group("what closes a finding, as the header and the card read it", () => {
      const bad = [];
      for (const type of Object.keys(CLOSED_BY)) {
        const wrong = [];
        for (const d of [null, ...DECISIONS]) {
          const closed = d !== null && CLOSED_BY[type].includes(d);
          const html = view(runOf("rules_ready", { findings: [mk("x", type)], dispositions: d ? [recorded("f-x", d)] : [] }));
          const s = summaryOf(html) ?? "";
          const reads = /^Every item has a recorded decision\.$/.test(s)
            ? "closed"
            : /^1 open item to resolve before this study is called complete\./.test(s) && summaryRed(html)
              ? "holds"
              : /^No open blocker or contested item/.test(s) && !summaryRed(html)
                ? "open-quiet"
                : `unreadable(${s})`;
          const want = closed ? "closed" : HOLDING.has(type) ? "holds" : "open-quiet";
          if (reads !== want) wrong.push(`${d ?? "no decision"}: header says ${reads}, should say ${want}`);
          // The card agrees with the header: a closing decision removes the controls, a non-closing one keeps them.
          const labels = buttons(card(html, "x")).map((b) => b.label);
          const wantLabels = closed ? [] : OFFERED[type].map((x) => DECISION_LABEL[x]);
          if (labels.join("|") !== wantLabels.join("|")) wrong.push(`${d ?? "no decision"}: card offers [${labels}], should offer [${wantLabels}]`);
        }
        ok("closes-header-card-agree", wrong.length === 0, `${type}: the header and the card agree on what the 7 possible records mean${wrong.length ? ` — ${wrong.join("; ")}` : ""}`);
        if (wrong.length) bad.push(type);
      }
      // The case that matters, named: a disclosed wrong number is still a wrong number.
      const disclosed = keep(view(runOf("rules_ready", { findings: [mk("x", "BLOCKER")], dispositions: [recorded("f-x", "DISCLOSED")] })));
      const ds = summaryOf(disclosed) ?? "";
      ok("disclosed-blocker-open", /^1 open item to resolve before this study is called complete\./.test(ds) && !/No open blocker/.test(ds), `a BLOCKER marked Disclosed still reads as open (${JSON.stringify(ds)})`);
      const dc = text(card(disclosed, "x"));
      ok("disclosed-blocker-card-says", /Recorded: DISCLOSED/.test(dc) && /does not close a blocker/.test(dc), "its card shows what was recorded and says that does not close a blocker");
      ok("disclosed-blocker-still-offered", buttons(card(disclosed, "x")).map((b) => b.label).join("|") === "Fixed|Withdrawn on a source", "and it is still offered the two decisions that do");
      const fixed = keep(view(runOf("rules_ready", { findings: [mk("x", "BLOCKER")], dispositions: [recorded("f-x", "FIXED")] })));
      ok("fixed-blocker-closed", /^Every item has a recorded decision\.$/.test(summaryOf(fixed) ?? "") && buttons(card(fixed, "x")).length === 0, "a BLOCKER marked Fixed is closed: the header says so and its controls go");
      // The latest decision rules, wherever it sits in the list.
      const latest = (list) => summaryOf(view(runOf("rules_ready", { findings: [mk("x", "BLOCKER")], dispositions: list }))) ?? "";
      const FIXED_OLD = recorded("f-x", "FIXED", "2026-10-06T10:00:00Z");
      const DISC_NEW = recorded("f-x", "DISCLOSED", "2026-10-06T11:00:00Z");
      ok("later-decision-rules-open", /^1 open item to resolve/.test(latest([FIXED_OLD, DISC_NEW])) && /^1 open item to resolve/.test(latest([DISC_NEW, FIXED_OLD])), "BLOCKER fixed, then disclosed: the later decision rules, in either list order, and it is open");
      const DISC_OLD = recorded("f-x", "DISCLOSED", "2026-10-06T10:00:00Z");
      const FIXED_NEW = recorded("f-x", "FIXED", "2026-10-06T11:00:00Z");
      ok(
        "later-decision-rules-closed",
        /^Every item has a recorded decision\.$/.test(latest([DISC_OLD, FIXED_NEW])) && /^Every item has a recorded decision\.$/.test(latest([FIXED_NEW, DISC_OLD])),
        "BLOCKER disclosed, then fixed: the later decision rules, in either list order, and it is closed",
      );
      // Two findings: one closed does not close the other.
      const two = summaryOf(view(runOf("rules_ready", { findings: [mk("a", "BLOCKER"), mk("b", "BLOCKER")], dispositions: [recorded("f-a", "FIXED"), recorded("f-b", "DISCLOSED")] }))) ?? "";
      ok("one-closed-not-the-other", /^1 open item to resolve/.test(two), `one blocker fixed and one disclosed leaves one open (${JSON.stringify(two)})`);
      ok("every-type-consistent", bad.length === 0, "every type reads consistently");
    });

    await group("busy", () => {
      const run = runOf("rules_ready", { findings: [mk("a", "NOTE")] });
      const idle = buttons(view(run));
      const busy = view(run, { busy: true });
      const bb = buttons(busy);
      ok("idle-controls-enabled", idle.every((b) => !b.disabled), "idle: every control is enabled");
      ok("busy-controls-disabled", bb.length === idle.length && bb.every((b) => b.disabled), "busy: the re-run button AND every triage button are disabled (a second press cannot fire)");
      ok("busy-shows-progress", /animate-spin/.test(bb.find((b) => b.testid === "button-proofread-rerun").inner), "busy: the re-run button shows progress");
      ok("idle-no-progress", !/animate-spin/.test(idle.find((b) => b.testid === "button-proofread-rerun").inner), "idle: the re-run button shows no progress");
    });

    await group("a load that failed is not an absent panel", () => {
      ok("loading-draws-nothing", view(null) === "", "still loading: nothing is drawn");
      const html = keep(view(null, { error: "HTTP 500" }));
      ok("first-load-failed-drawn", /HTTP 500/.test(text(html)) && /Consistency check/.test(text(html)), "first load failed: the panel is drawn and says why (a vanished panel looks like no check exists)");
      ok("first-load-failed-no-claim", !/Nothing flagged|has not been checked/.test(text(html)), "first load failed: it does not claim a result either way");
      const later = text(view(runOf("rules_ready", { findings: [mk("a", "NOTE")] }), { error: "HTTP 429" }));
      ok("later-error-shown", /HTTP 429/.test(later), "an error after a successful load is shown above the last result");
    });

    await group("the decision shown at once is the decision recorded", () => {
      ok("exports-with-recorded-decision", typeof lib.withRecordedDecision === "function", "lib/proofread.ts exports withRecordedDecision");
      // The line above is the red for a missing export; the rest would only add a TypeError (the other three are the client module group's).
      if (![lib.withRecordedDecision, lib.dispositionBody, lib.latestDisposition, lib.closes].every((f) => typeof f === "function")) return;
      const NOW = new Date("2026-10-06T15:00:00Z");
      // x already carries an OLDER, non-closing record (a carried-forward disclosure). y is a second BLOCKER, OPEN — its
      // own record is a disclosure, which does not close a blocker — and must be left exactly as it was. It is open on
      // purpose: a closed finding dropped from the run is invisible in the header, an open blocker dropped from it turns
      // "1 open item" into "Every item has a recorded decision" over a blocker nobody decided.
      const older = recorded("f-x", "DISCLOSED", "2026-10-06T10:00:00Z");
      const other = recorded("f-y", "DISCLOSED", "2026-10-06T12:00:00Z");
      // Frozen all the way down: a withRecordedDecision that wrote into the run it was handed (pushed onto its list,
      // re-stamped a record, re-sorted the findings) throws here instead of passing with the change hidden in `base`.
      const base = deepFreeze(runOf("rules_ready", { runId: "run-A", findings: [mk("x", "BLOCKER"), mk("y", "BLOCKER")], dispositions: [older, other] }));
      const finding = base.findings[0];
      /** The run with its dispositions taken out: everything withRecordedDecision must hand back untouched. */
      const rest = (run) => ({ ...run, dispositions: "(compared on their own)" });
      ok(
        "recorded-before-two-open",
        /^2 open items to resolve before this study is called complete\./.test(summaryOf(view(base)) ?? ""),
        `precondition: before the decision both blockers are open — an older Disclosed closes neither (${JSON.stringify(summaryOf(view(base)))})`,
      );
      for (const [name, body, wantSource] of [
        ["Fixed", { disposition: "FIXED" }, null],
        // The body the panel really builds: the prompt's answer arrives padded and leaves trimmed.
        ["Withdrawn on a named source", lib.dispositionBody("WITHDRAWN", () => "  HCM 7th ed.  "), "HCM 7th ed."],
      ]) {
        let after;
        let threw = null;
        try {
          after = lib.withRecordedDecision(base, "run-A", finding, body, NOW);
        } catch (e) {
          threw = e;
        }
        ok(
          "recorded-leaves-input-alone",
          threw === null,
          `${name}: withRecordedDecision leaves the run it was handed alone${threw ? ` (it threw on the frozen run: ${threw instanceof Error ? threw.message : threw})` : ""}`,
        );
        if (threw) continue;
        ok(
          "recorded-run-otherwise-same",
          isDeepStrictEqual(rest(after), rest(base)),
          `${name}: apart from its dispositions, the run handed back IS the run handed in — every finding (the other open blocker included), its status, its id, its coverage`,
        );
        const latest = lib.latestDisposition(after.dispositions, finding.id);
        // Not read back through latestDisposition(finding.id): that can only ever return a record of that finding, so a record
        // written against the wrong one would go unseen (the older record would answer instead).
        const added = after.dispositions.filter((d) => !base.dispositions.includes(d));
        ok("recorded-one-record-on-pressed", added.length === 1 && added[0].findingId === finding.id, `${name}: exactly one record was added, on the finding that was pressed (got ${added.map((d) => d.findingId).join(", ") || "none"})`);
        ok("recorded-is-the-decision", latest?.disposition === body.disposition, `${name}: the record is the decision that was recorded, not another (got ${latest?.disposition})`);
        ok("recorded-carries-source", latest?.sourceLabel === wantSource, `${name}: the record carries the source named, or none (got ${JSON.stringify(latest?.sourceLabel)})`);
        ok("recorded-stamped-now", latest?.createdAt === NOW.toISOString(), `${name}: the record is stamped now, so it is the latest and beats the older one (got ${latest?.createdAt})`);
        ok("recorded-no-note", latest?.note === null, `${name}: the record carries no note`);
        ok("recorded-closes", lib.closes(finding.type, latest?.disposition), `${name}: it closes the blocker`);
        ok("recorded-others-kept", after.dispositions.includes(older) && after.dispositions.includes(other) && after.dispositions.length === 3, `${name}: the other records are kept`);
        ok("recorded-input-unchanged", base.dispositions.length === 2 && after !== base, `${name}: the run it was handed is not changed`);
        const html = keep(view(after));
        const c = text(card(html, "x"));
        ok(
          "recorded-card-shows",
          buttons(card(html, "x")).length === 0 && new RegExp(`Recorded: ${body.disposition}`).test(c),
          `${name}: rendered, the card shows Recorded: ${body.disposition} and no controls (${JSON.stringify(c.slice(-60))})`,
        );
        ok("recorded-card-names-source", !wantSource || c.includes(wantSource), `${name}: rendered, the card names the source`);
        ok(
          "recorded-header-moves",
          /^1 open item to resolve before this study is called complete\./.test(summaryOf(html) ?? "") && summaryRed(html),
          `${name}: rendered, the header has moved from two open blockers to one, in red — never "Every item has a recorded decision" while the other blocker is open (${JSON.stringify(summaryOf(html))})`,
        );
        ok(
          "recorded-other-blocker-kept",
          buttons(card(html, "y")).map((b) => b.label).join("|") === "Fixed|Withdrawn on a source" && /Recorded: DISCLOSED/.test(text(card(html, "y"))),
          `${name}: rendered, the other blocker keeps its record and both its controls`,
        );
      }
      // Not this run's business: the run comes back as the same object, unchanged. A different run (the previous
      // project's, or a newer revision that took over mid-flight); a run with no id (a project never checked); and a
      // decision with no run id, which no run can be the run of — even one that has no id either.
      const untouched = (run, runId) => {
        try {
          return lib.withRecordedDecision(run, runId, finding, { disposition: "FIXED" }, NOW) === run;
        } catch {
          return false;
        }
      };
      ok("other-run-untouched", untouched(base, "run-B"), "a decision recorded on another run does not touch this one (the previous project's run, or a newer revision)");
      const neverChecked = deepFreeze(runOf("none", { runId: undefined, coverage: [] }));
      ok("no-id-run-untouched", untouched(neverChecked, "run-A"), "a decision recorded on run-A does not touch a run with no id (the next project, never checked)");
      for (const noId of [undefined, null, ""]) {
        ok(
          "no-run-id-touches-nothing",
          untouched(base, noId) && untouched(neverChecked, noId),
          `a decision with no run id (${JSON.stringify(noId)}) touches no run — not run-A, and not a run that has no id either`,
        );
      }
    });

    // ─── 3. THE CLIENT MODULE ─────────────────────────────────────────────────────────
    await group("client module", async () => {
      ok(
        "exports-pending-finished-body",
        typeof lib.isPending === "function" && typeof lib.isFinished === "function" && typeof lib.dispositionBody === "function",
        "lib/proofread.ts exports isPending, isFinished and dispositionBody",
      );
      ok(
        "exports-offered-closes-latest",
        typeof lib.closes === "function" && typeof lib.offeredFor === "function" && typeof lib.latestDisposition === "function",
        "lib/proofread.ts exports offeredFor, closes and latestDisposition",
      );
      // The two lines above are the red for a missing export; the rest would only add a TypeError.
      if (![lib.isPending, lib.isFinished, lib.dispositionBody, lib.closes, lib.offeredFor, lib.latestDisposition].every((f) => typeof f === "function")) return;
      for (const type of Object.keys(OFFERED)) {
        ok("offered-for-per-type", JSON.stringify(lib.offeredFor(type)) === JSON.stringify(OFFERED[type]), `offeredFor(${type}) is [${OFFERED[type]}]`);
        const closing = DECISIONS.filter((d) => lib.closes(type, d));
        ok(
          "closes-per-type",
          JSON.stringify(closing) === JSON.stringify(DECISIONS.filter((d) => CLOSED_BY[type].includes(d))),
          `closes(${type}, ·) is true for exactly [${CLOSED_BY[type]}] (got [${closing}])`,
        );
      }
      ok("closes-nothing-on-empty", lib.closes("BLOCKER", undefined) === false && lib.closes("NOTE", "") === false && lib.closes("NOTE", "nonsense") === false, "closes: no decision, an empty one and an unknown one close nothing");
      ok(
        "latest-by-time",
        lib.latestDisposition([recorded("a", "FIXED", "2026-10-06T10:00:00Z"), recorded("a", "DISCLOSED", "2026-10-06T11:00:00Z"), recorded("b", "WITHDRAWN")], "a")?.disposition === "DISCLOSED" &&
          lib.latestDisposition([], "a") === undefined,
        "latestDisposition picks the newest by time for that finding, not by position",
      );
      for (const s of ALL_STATUSES) {
        ok("is-pending-per-status", lib.isPending(s) === PENDING.includes(s), `isPending(${s}) is ${PENDING.includes(s)}`);
        ok("is-finished-per-status", lib.isFinished(s) === FINISHED.includes(s), `isFinished(${s}) is ${FINISHED.includes(s)}`);
      }
      // The Task 7 hand-off: an empty sourceLabel on a non-WITHDRAWN disposition is a 400, so none is sent;
      // WITHDRAWN with nothing named records nothing.
      let asked = 0;
      const ask = (v) => () => (asked++, v);
      for (const d of ["FIXED", "DISCLOSED", "BUG_FILED"]) {
        asked = 0;
        const body = lib.dispositionBody(d, ask("should never be read"));
        ok("body-no-source-no-prompt", body && body.disposition === d && !("sourceLabel" in body) && asked === 0, `${d}: sends no sourceLabel at all and never prompts`);
        ok("body-json-is-disposition", JSON.stringify(body) === `{"disposition":"${d}"}`, `${d}: the JSON body is the disposition alone`);
      }
      ok("withdrawn-cancelled-records-nothing", lib.dispositionBody("WITHDRAWN", ask(null)) === null, "WITHDRAWN, prompt cancelled: records nothing");
      ok("withdrawn-no-answer-records-nothing", lib.dispositionBody("WITHDRAWN", ask(undefined)) === null, "WITHDRAWN, no answer: records nothing");
      ok("withdrawn-empty-records-nothing", lib.dispositionBody("WITHDRAWN", ask("")) === null, "WITHDRAWN, empty answer: records nothing");
      ok("withdrawn-blank-records-nothing", lib.dispositionBody("WITHDRAWN", ask("   ")) === null, "WITHDRAWN, blank answer: records nothing");
      const w = lib.dispositionBody("WITHDRAWN", ask("  HCM 7th ed. Ch. 19  "));
      ok("withdrawn-named-source-trimmed", w && w.disposition === "WITHDRAWN" && w.sourceLabel === "HCM 7th ed. Ch. 19", "WITHDRAWN with a named source: sends it, trimmed");

      const calls = [];
      globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify({ ok: true, status: "none" }), { status: 200, headers: { "Content-Type": "application/json" } });
      };
      try {
        const RUN = "0b1f6c2e-8f4d-4c1e-9a55-6f1d2f9a7c10";
        const FID = "5d1c3f5e-0a52-4a6a-8d0c-3b7e2b0e9f11";
        let refused = null;
        try {
          await lib.recordDisposition("proj-1", RUN, FID, lib.dispositionBody("FIXED", ask("x")));
        } catch (e) {
          refused = e;
        }
        const c = calls[0];
        ok(
          "disposition-url",
          refused === null && c?.url === `/tis-api/projects/proj-1/proofread/${RUN}/findings/${FID}/dispositions`,
          `a disposition posts to the run's uuid and the finding's id, and the 200 it is answered with is not a refusal${refused ? ` (refused: ${refused.message})` : ""}`,
        );
        ok("disposition-body-no-source-key", c?.init?.method === "POST" && c?.init?.body === '{"disposition":"FIXED"}', "a disposition body has no sourceLabel key");
        const got = await lib.fetchProofread("proj-1");
        ok("fetch-defaults-lists", got.status === "none" && Array.isArray(got.coverage) && Array.isArray(got.findings), "fetchProofread defaults a missing list to []");
        globalThis.fetch = async () => new Response("{}", { status: 200 });
        ok("fetch-no-status-is-none", (await lib.fetchProofread("proj-1")).status === "none", "fetchProofread: a response with no status is 'none', never a result");
        globalThis.fetch = async () =>
          new Response(JSON.stringify({ status: "rules_ready", runId: RUN, revision: 3, coverage: { oops: 1 }, findings: null }), { status: 200 });
        const odd = await lib.fetchProofread("proj-1");
        ok("fetch-keeps-run-id-and-arrays", odd.runId === RUN && Array.isArray(odd.coverage) && odd.coverage.length === 0 && Array.isArray(odd.findings) && odd.findings.length === 0, "fetchProofread carries the run's uuid and never hands the panel a non-array");
        // Rendered inside a try so that a run the panel cannot read fails THIS line instead of ending the group.
        let rendered = "(the panel threw)";
        try {
          rendered = text(view(odd));
        } catch (e) {
          rendered = `(the panel threw: ${e instanceof Error ? e.message : e})`;
        }
        ok("odd-run-renders-nothing-checked", /No clause could run on this study, so nothing was checked\./.test(rendered) && !/Nothing flagged/.test(rendered), "a finished run the server sent with no usable coverage renders as nothing checked, end to end");
      } finally {
        globalThis.fetch = realFetch;
      }
    });

    // ─── a decision on a run that has been superseded ─────────────────────────────────
    // The route answers 409 when the run on screen is no longer the project's newest finished run
    // (the check was run again). Nothing was recorded, so the panel must not keep showing the old
    // run as if it were current: it refetches and says why the decision did not stick. The refetch
    // is the stateful wrapper's (pinned under WIRING); what a 409 IS, and what the panel then says,
    // is decided here, in the client module, and tested by behaviour.
    await group("a decision refused because the check was run again", async () => {
      ok(
        "exports-superseded",
        typeof lib.isSuperseded === "function" && typeof lib.ProofreadRequestError === "function" && typeof lib.SUPERSEDED_NOTICE === "string",
        "lib/proofread.ts exports isSuperseded, ProofreadRequestError and SUPERSEDED_NOTICE",
      );
      if (typeof lib.isSuperseded !== "function") return; // the line above is the red; the rest would only add a TypeError
      const refusal = async (status, body) => {
        globalThis.fetch = async () => new Response(body === undefined ? "not json" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
        try {
          await lib.recordDisposition("proj-1", "run-1", "f-1", { disposition: "FIXED" });
          return null;
        } catch (e) {
          return e;
        } finally {
          globalThis.fetch = realFetch;
        }
      };
      const SERVER_409 = "This check has been run again. Refresh to see the latest.";
      const e409 = await refusal(409, { error: SERVER_409 });
      ok("superseded-409-recognised", e409 !== null && lib.isSuperseded(e409) === true, "a 409 from the disposition route is recognised as a superseded run");
      ok("refusal-carries-status-message", e409?.status === 409 && e409?.message === SERVER_409, `the refusal carries its status and the server's sentence (got ${e409?.status}, ${JSON.stringify(e409?.message)})`);
      for (const [status, body, want] of [
        [422, { error: "This decision does not apply to this finding." }, "This decision does not apply to this finding."],
        [404, { error: "Finding not found." }, "Finding not found."],
        [500, undefined, "HTTP 500"],
        [429, { error: "Too many decisions recorded." }, "Too many decisions recorded."],
      ]) {
        const e = await refusal(status, body);
        ok(
          "other-refusals-not-superseded",
          e !== null && lib.isSuperseded(e) === false && e.status === status && e.message === want,
          `a ${status} is a refusal, NOT a superseded run, and keeps its message (got ${e?.status}, ${JSON.stringify(e?.message)})`,
        );
      }
      ok("ok-is-not-refusal", (await refusal(200, { ok: true })) === null, "a 200 is not a refusal");
      ok(
        "only-client-409-counts",
        [new Error("HTTP 409"), { status: 409 }, null, undefined, "409", 409].every((x) => lib.isSuperseded(x) === false),
        "only a refusal the client itself built from a 409 counts: an Error whose text says 409, a bare { status: 409 }, a string or a number do not",
      );
      const html = keep(view(runOf("rules_ready", { findings: [mk("a", "NOTE")] }), { error: lib.SUPERSEDED_NOTICE }));
      const t = text(html);
      ok("superseded-notice-rendered", t.includes(lib.SUPERSEDED_NOTICE) && /not recorded/.test(lib.SUPERSEDED_NOTICE), `rendered, the panel says the decision was not recorded and why (${JSON.stringify(lib.SUPERSEDED_NOTICE)})`);
      const hit = bannedIn(t) ?? bannedIn(html);
      ok("superseded-notice-copy-clean", hit === null, `that state's rendered copy avoids ${BANNED_MSG}${hit === null ? "" : ` — found ${JSON.stringify(hit)}`}`);
    });

    // ─── the panel offers exactly what the server accepts ─────────────────────────────
    // The disposition route refuses, with a 422, a decision the finding's type is not offered in
    // the contract's OFFERED_DISPOSITIONS (lib/tis-api-zod/src/proofread.ts). The panel does not
    // import that module — atlanta-tis does not depend on @workspace/tis-api-zod, and the panel
    // bundle stays free of zod — so it keeps its own OFFERED, and this pins the two equal: a button
    // the server would refuse, or a decision the server takes that no button offers, is a drift.
    await group("the panel offers exactly what the server accepts", async () => {
      const server = contract.OFFERED_DISPOSITIONS;
      const mine = lib.OFFERED;
      ok("offered-maps-exported", !!server && typeof server === "object" && !!mine && typeof mine === "object", "the contract exports OFFERED_DISPOSITIONS and lib/proofread.ts exports OFFERED");
      const keys = (m) => Object.keys(m ?? {}).sort().join(",");
      ok("offered-same-six-types", keys(server) === keys(mine) && Object.keys(server ?? {}).length === 6, `the panel and the server name the same six finding types (panel: ${keys(mine)}; server: ${keys(server)})`);
      for (const t of new Set([...Object.keys(server ?? {}), ...Object.keys(mine ?? {})])) {
        const a = [...(mine?.[t] ?? [])].sort().join(",");
        const b = [...(server?.[t] ?? [])].sort().join(",");
        ok("offered-equals-accepted", a === b && (mine?.[t] ?? []).length === (server?.[t] ?? []).length, `${t}: the panel offers [${a}] and the server accepts [${b}]`);
      }
    });

    // Last of the rendered groups, so "every state" is every state this guard drew.
    await group("rendered copy", () => {
      ok("pre-rendered-states", everyHtml.length >= 15, `rendered ${everyHtml.length} states (a guard that rendered nothing proves nothing)`);
      ok(
        "rendered-permitted-description",
        everyHtml.every((h) => /internal consistency and traceability check/.test(text(h))),
        "every rendered state describes the check as 'an internal consistency and traceability check' (the source line above can be satisfied by a comment)",
      );
      // Each state read twice: as the words a user sees (tags dropped) and as markup (attributes such as a title or an
      // aria-label are copy too).
      const hits = everyHtml.map((h) => bannedIn(text(h)) ?? bannedIn(h)).filter((h) => h !== null);
      ok("rendered-avoids-banned-copy", hits.length === 0, `rendered output of every state avoids ${BANNED_MSG}${hits.length ? ` — found ${JSON.stringify(hits[0])} in ${hits.length} state(s)` : ""}`);
      ok("rendered-no-study-changing-control", !/\bapply\b|\bfix it\b|\bauto-?fix\b/i.test(text(everyHtml.join("\n"))), "rendered output offers no apply / fix-it / auto-fix control");
      ok("no-react-warnings", warnings.length === 0, `rendering raised no React warnings${warnings.length ? `: ${warnings[0]}` : ""}`);
    });

    // ─── 4. WIRING (source text — the weak kind; see the header) ───────────────────────
    await group("wiring", () => {
      ok("wiring-poll-depends-on-nonce", /\}, \[projectId, nonce\]\);/.test(panel), "WIRING: the poll effect depends on nonce, so a re-run re-arms it");
      ok("wiring-rerun-bumps-nonce", /await requestProofread\(projectId\);\s*setError\(null\);\s*setNonce\(/.test(panel), "WIRING: a successful re-run request bumps the nonce");
      ok(
        "wiring-decision-on-run-uuid",
        /const runId = run\.runId;/.test(panel) && /recordDisposition\(projectId, runId, f\.id, body\)/.test(panel) && !/recordDisposition\([^)]*revision/.test(panel),
        "WIRING: a decision is recorded against the run's uuid, not its revision",
      );
      ok("wiring-uses-disposition-body", /dispositionBody\(/.test(panel), "WIRING: the panel builds the decision body with dispositionBody");
      ok(
        "wiring-decision-refetches-via-effect",
        /await recordDisposition\(projectId, runId, f\.id, body\);[\s\S]*?setNonce\(/.test(panel) && !/setRun\(await fetchProofread/.test(panel),
        "WIRING: a recorded decision refetches through the effect (setNonce), not a one-off fetch that bypasses the poll and its cancellation",
      );
      ok(
        "wiring-decision-shown-at-once",
        /await recordDisposition\([^;]*;[\s\S]*?setRun\(\(prev\) => \(prev \? withRecordedDecision\(prev, runId, f, body, new Date\(\)\) : prev\)\);[\s\S]*?setNonce\(/.test(panel),
        "WIRING: after the POST succeeds, a recorded decision is shown at once through withRecordedDecision, before the refetch (two presses in the window before it landed both reached the server)",
      );
      ok(
        "wiring-reads-offered-latest-closes",
        /offeredFor\(f\.type\)/.test(panel) && /latestDisposition\(run\.dispositions, f\.id\)/.test(panel) && /closes\(f\.type,/.test(panel),
        "WIRING: the card reads offeredFor, latestDisposition and closes from the client module, not a table of its own",
      );
      {
        const from = panel.indexOf("const triage = async");
        const triageText = from < 0 ? "" : panel.slice(from, panel.indexOf("\n  };\n", from));
        ok(
          "wiring-409-refetches",
          /\} catch \(e\) \{[^}]*?if \(isSuperseded\(e\)\) \{\s*setNotice\(SUPERSEDED_NOTICE\);\s*setNonce\(\(v\) => v \+ 1\);\s*\} else \{\s*setError\(e instanceof Error \? e\.message : String\(e\)\);\s*\}\s*\} finally \{/.test(triageText),
          "WIRING: a decision refused because the check was run again (isSuperseded: a 409) refetches through the effect (setNonce, which re-arms the poll) and shows SUPERSEDED_NOTICE; any other refusal shows its own message",
        );
        ok(
          "wiring-notice-own-state",
          /const \[notice, setNotice\] = useState<string \| null>\(null\);/.test(panel) && /error=\{error \?\? notice\}/.test(panel),
          "WIRING: the notice is its own state, drawn where an error is — the refetch it triggers clears `error` the moment it lands, and would wipe the explanation with it",
        );
        ok(
          "wiring-notice-cleared-on-next-action",
          (panel.match(/setNotice\(null\);/g) ?? []).length === 2 &&
            /const rerun = async \(\) => \{\s*if \(inFlight\.current\) return;\s*inFlight\.current = true;\s*setBusy\(true\);\s*setNotice\(null\);/.test(panel) &&
            /if \(!body\) return;[^\n]*\n\s*inFlight\.current = true;\s*setBusy\(true\);\s*setNotice\(null\);/.test(triageText),
          "WIRING: the notice is cleared when the next re-run or decision starts, and nowhere else",
        );
      }
      ok("wiring-no-decision-table", !/BUG_FILED|Bug filed|DISPOSITIONS/.test(panel), "WIRING: the panel holds no decision table of its own and never names BUG_FILED");
      ok(
        "wiring-single-flight",
        /const rerun = async \(\) => \{\s*if \(inFlight\.current\) return;\s*inFlight\.current = true;/.test(panel) &&
          /const triage = async [^{]*\{\s*if \(inFlight\.current \|\| !run\?\.runId\) return;/.test(panel) &&
          (panel.match(/inFlight\.current = false;/g) ?? []).length === 2,
        "WIRING: a re-run and a decision each refuse a second press while one is in flight, and release on both outcomes",
      );
      // The mount carries the Datum chat's hand-off (`chat`, undefined while the chat is off), pinned as written.
      ok("wiring-page-mounts-for-tis", /studyType === "tis" && <ProofreadPanel projectId=\{project\.id\} chat=\{chat\} \/>/.test(src.page), "WIRING: the project page mounts the panel for TIS studies only");
    });

    // ─── WIRING, run: the panel hands the view the run it fetched ──────────────────────
    // The one hand-off the rendered groups cannot see: everything above renders ProofreadView with a run written by
    // hand, so `run={run && { ...run, withheld: 0 }}` in the wrapper, or a setRun that rewrote what it fetched, brought
    // back "Nothing flagged" over a DEFECT with every line green. Here the wrapper itself runs (see mountPanel).
    await group("the panel hands the view the run it fetched", async () => {
      const routedOf = (html) => /<p\b[^>]*data-testid="proofread-withheld"[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? null;
      const rulesLineOf = (html) => /<p\b[^>]*data-testid="proofread-rules-changed"[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? null;
      for (const [i, answer] of READ_ANSWERS.entries()) {
        const asked = [];
        globalThis.fetch = async (url) => (asked.push(String(url)), new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } }));
        const fetched = await lib.fetchProofread("proj-1");
        asked.length = 0;
        const panelRun = mountPanel(ProofreadPanel, { projectId: "proj-1" });
        try {
          const first = panelRun.render();
          panelRun.commit();
          let el = first;
          for (let tick = 0; tick < 50 && !el?.props?.run; tick++) {
            await new Promise((r) => setImmediate(r));
            el = panelRun.render();
          }
          ok(
            "wiring-panel-hands-view-the-fetched-run",
            first?.type === ProofreadView &&
              first.props.run === null &&
              el?.type === ProofreadView &&
              asked.length === 1 &&
              asked[0] === "/tis-api/projects/proj-1/proofread" &&
              isDeepStrictEqual(el.props.run, fetched) &&
              el.props.run.withheld === answer.withheld &&
              el.props.run.rulesChanged === answer.rulesChanged,
            `WIRING (run): answer ${i + 1} — ProofreadPanel fetches its project once and hands ProofreadView exactly the run fetchProofread made of it (view got withheld ${el?.props?.run?.withheld}, rulesChanged ${el?.props?.run?.rulesChanged}; fetched ${asked.length}x)`,
          );
          const html = el?.type === ProofreadView ? renderToStaticMarkup(el) : "";
          const routed = routedOf(html);
          ok(
            "wiring-panel-shows-the-fetched-hold",
            routed !== null && routed === lib.withheldLine(answer.withheld) && (rulesLineOf(html) !== null) === answer.rulesChanged && !/Nothing flagged|Every item has a recorded decision|No open blocker/.test(text(html)),
            `WIRING (run): answer ${i + 1} — the panel as mounted shows the routed line for ${answer.withheld} withheld, ${answer.rulesChanged ? "and" : "and no"} rules-changed line, and no clear (${JSON.stringify(summaryOf(html))})`,
          );
        } finally {
          panelRun.unmount();
          globalThis.fetch = realFetch;
        }
      }
    });
  } finally {
    console.error = realError;
    globalThis.fetch = realFetch;
  }
  return results;
}

// ─── the real files ─────────────────────────────────────────────────────────────────
const baseline = await suite(SOURCES);
for (const r of baseline) report(r.id, r.pass, r.msg);
/** The ids red in a run, each once. */
const redIds = (results) => [...new Set(results.filter((r) => !r.pass).map((r) => r.id))];
const failing = redIds(baseline);
const ids = [...new Set(baseline.map((r) => r.id))];

// ─── TEETH ──────────────────────────────────────────────────────────────────────────
let ts = null;
try {
  ts = (await import("typescript")).default;
} catch {
  ts = null;
}
/** A file's code as a check sees it: TypeScript's printer drops every comment, and runs of whitespace collapse. */
const codeOf = (file, text) => {
  const kind = /\.tsx$/.test(FILES[file]) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path.basename(FILES[file]), text, ts.ScriptTarget.Latest, false, kind);
  return ts.createPrinter({ removeComments: true }).printFile(sf).replace(/\s+/g, " ").trim();
};
let tsUsable = false;
try {
  tsUsable = codeOf("lib", "// gone\nconst a = 1; /* gone */ const b = `// kept`;\n") === "const a = 1; const b = `// kept`;";
} catch {
  tsUsable = false;
}
report("pre-typescript-printer", tsUsable, "precondition: typescript resolves, and its printer drops comments and keeps code (a template that holds // included)");

const baseCodes = new Map();
const baseCode = (file) => (baseCodes.has(file) ? baseCodes.get(file) : (baseCodes.set(file, codeOf(file, SOURCES[file])), baseCodes.get(file)));

/** Replace the one occurrence of `from` in `file`; an anchor that is missing or not unique is a broken mutation. */
const edit = (file, from, to) => (s) => {
  const n = s[file].split(from).length - 1;
  if (n !== 1) throw new Error(`the anchor ${JSON.stringify(from.slice(0, 60))} occurs ${n} times in ${file}`);
  return { ...s, [file]: s[file].replace(from, () => to) };
};
const chain = (...fns) => (s) => fns.reduce((acc, f) => f(acc), s);

const MUTATIONS = [
  // ---- 1. copy, read from the source text -----------------------------------------
  { label: "banned copy in a string the panel never renders", file: "panel", flips: ["panel-avoids-banned-copy"], apply: edit("panel", "const POLL_MS = 60_000;", 'const POLL_MS = 60_000;\nexport const PANEL_KIND = "peer review";') },
  { label: "banned copy in a string the client module exports", file: "lib", flips: ["lib-avoids-banned-copy"], apply: edit("lib", "export const RULES_CHANGED_LINE =", 'export const CHECK_KIND = "QA/QC";\n\nexport const RULES_CHANGED_LINE =') },
  { label: "banned copy in the route file", file: "route", flips: ["route-avoids-banned-copy"], apply: edit("route", "const router: IRouter = Router();", 'const router: IRouter = Router();\nconst CHECK_KIND = "independent review";\nvoid CHECK_KIND;') },
  {
    label: "the permitted words leave the panel, its opening comment included",
    file: "panel",
    flips: ["source-permitted-description", "rendered-permitted-description"],
    apply: chain(
      edit("panel", " * The study's internal consistency and traceability check, on the project page.", " * The study's consistency pass, on the project page."),
      edit("panel", "An internal consistency and traceability check over this saved study", "A consistency pass over this saved study"),
    ),
  },
  {
    label: "the never-checked status is tested through a list, not by name",
    file: "panel",
    flips: ["source-names-never-checked"],
    apply: chain(edit("panel", '{run.status === "none" ? "Run the check"', '{["none"].includes(run.status) ? "Run the check"'), edit("panel", '{run.status === "none" && (', '{["none"].includes(run.status) && (')),
  },
  { label: "the panel source names an apply action it never renders", file: "panel", flips: ["source-no-study-changing-control"], apply: edit("panel", "const POLL_MS = 60_000;", 'const POLL_MS = 60_000;\nexport const NEXT_STEP = "apply";') },
  { label: "a finding's remedy is labelled as something to apply", file: "panel", flips: ["source-no-study-changing-control", "rendered-no-study-changing-control"], apply: edit("panel", "<li>Suggested: {f.remedy}</li>", "<li>Apply: {f.remedy}</li>") },
  { label: "a finding's remedy line says peer review", file: "panel", flips: ["panel-avoids-banned-copy", "rendered-avoids-banned-copy"], also: ["superseded-notice-copy-clean"], apply: edit("panel", "<li>Suggested: {f.remedy}</li>", "<li>Suggested for peer review: {f.remedy}</li>") },
  // The banned phrase in the spellings a substring match missed (fix wave 3, G2-1): hyphenated, spaced around the
  // slash, joined by an en dash, run with two spaces, and on the project page, which mounts the panel.
  { label: "banned copy, hyphenated, in a string the panel never renders", file: "panel", flips: ["panel-avoids-banned-copy"], apply: edit("panel", "const POLL_MS = 60_000;", 'const POLL_MS = 60_000;\nexport const PANEL_KIND = "peer-review";') },
  { label: "banned copy, spaced around the slash, in a string the client module exports", file: "lib", flips: ["lib-avoids-banned-copy"], apply: edit("lib", "export const RULES_CHANGED_LINE =", 'export const CHECK_KIND = "QA / QC";\n\nexport const RULES_CHANGED_LINE =') },
  { label: "banned copy with two spaces in the route file", file: "route", flips: ["route-avoids-banned-copy"], apply: edit("route", "const router: IRouter = Router();", 'const router: IRouter = Router();\nconst CHECK_KIND = "independent  review";\nvoid CHECK_KIND;') },
  { label: "the notice says second\u2013opinion (an en dash)", file: "lib", flips: ["superseded-notice-copy-clean", "lib-avoids-banned-copy", "rendered-avoids-banned-copy"], apply: edit("lib", "The latest run is shown.", "The latest second\u2013opinion run is shown.") },
  { label: "a finding's remedy line says peer-review", file: "panel", flips: ["panel-avoids-banned-copy", "rendered-avoids-banned-copy"], also: ["superseded-notice-copy-clean"], apply: edit("panel", "<li>Suggested: {f.remedy}</li>", "<li>Suggested for peer-review: {f.remedy}</li>") },
  { label: "a finding's remedy line says independent  review (two spaces)", file: "panel", flips: ["panel-avoids-banned-copy", "rendered-avoids-banned-copy"], also: ["superseded-notice-copy-clean"], apply: edit("panel", "<li>Suggested: {f.remedy}</li>", "<li>Suggested for independent  review: {f.remedy}</li>") },
  { label: "the panel names an Audit log it never renders", file: "panel", flips: ["panel-avoids-banned-copy"], apply: edit("panel", "const POLL_MS = 60_000;", 'const POLL_MS = 60_000;\nexport const LOG_KIND = "Audit log";') },
  { label: "the project page's UTDF tooltip says QA / QC", file: "page", flips: ["page-avoids-banned-copy"], apply: edit("page", 'title="Synchro-importable CSV scaffold (Build scenario).', 'title="Synchro-importable CSV scaffold for QA / QC (Build scenario).') },
  // The Datum chat's drawer and its prompt. The prompt's one never-use sentence is excluded by exact match, so a
  // banned phrase anywhere else in prompt.ts is read, and so is the sentence once it is reworded or carries more.
  { label: "banned copy in a string the chat drawer never renders", file: "chat", flips: ["chat-avoids-banned-copy"], apply: edit("chat", 'export const DEFAULT_QUESTION = "Why was this flagged, and how do I fix it?";', 'export const DEFAULT_QUESTION = "Why was this flagged, and how do I fix it?";\nexport const CHAT_KIND = "second opinion";') },
  { label: "the chat drawer's note says second-opinion", file: "chat", flips: ["chat-avoids-banned-copy"], apply: edit("chat", "Ask why something was flagged and how to fix it.", "Ask for a second-opinion on why something was flagged.") },
  { label: "banned copy in prompt.ts outside the never-use sentence", file: "prompt", flips: ["prompt-avoids-banned-copy"], apply: edit("prompt", "const joinAnd = ", 'const CHECK_KIND = "audit";\nvoid CHECK_KIND;\nconst joinAnd = ') },
  { label: "the never-use sentence reworded, so the exact match no longer takes it out", file: "prompt", flips: ["prompt-avoids-banned-copy"], apply: edit("prompt", '"second opinion", "peer review"', '"second opinion" or "peer review"') },
  { label: "the never-use sentence carries one more sentence", file: "prompt", flips: ["prompt-avoids-banned-copy"], apply: edit("prompt", "even if the engineer uses one of those words.", "even if the engineer uses one of those words. Call the check an audit.") },

  // ---- never checked ---------------------------------------------------------------
  {
    label: "a never-checked study does not say it has not been checked",
    file: "panel",
    flips: ["none-says-not-checked", "none-empty-coverage-not-checked-yet"],
    apply: edit("panel", "This study has not been checked yet. Run the check", "Run the check"),
  },
  { label: "a never-checked study with nothing recorded says nothing", file: "panel", flips: ["none-empty-coverage-not-checked-yet"], apply: edit("panel", '{run.status === "none" && (', '{run.status === "none" && run.coverage.length > 0 && (') },
  {
    label: "'Nothing flagged' is drawn for any run, finished or not",
    file: "panel",
    flips: ["none-not-nothing-flagged", "none-no-green-check", "pending-empty-not-nothing-flagged", "failed-empty-not-nothing-flagged"],
    apply: edit("panel", "{finished && run.findings.length === 0 && withheld === 0 && ran.length > 0 && (", "{run.findings.length === 0 && withheld === 0 && ran.length > 0 && ("),
  },
  { label: "isPending counts 'none' as in progress", file: "lib", flips: ["none-not-in-progress", "is-pending-per-status"], apply: edit("lib", 'return status === "queued" || status === "running";', 'return status === "queued" || status === "running" || status === "none";') },
  { label: "the button always says Run again", file: "panel", flips: ["none-offers-run-the-check"], apply: edit("panel", '{run.status === "none" ? "Run the check" : "Run again"}', '{run.status === "none" ? "Run again" : "Run again"}') },

  // ---- findings only for a finished run ----------------------------------------------
  { label: "findings are drawn for any run that is not pending", file: "panel", flips: ["findings-only-when-finished", "triage-only-when-finished"], apply: edit("panel", "{finished && orderFindings(run.findings).map((f) => {", "{!isPending(run.status) && orderFindings(run.findings).map((f) => {") },
  { label: "the header is drawn for any run but a never-checked one", file: "panel", flips: ["header-only-when-finished"], also: ["no-header-empty-or-pending", "withheld-unfinished-shows-nothing"], apply: edit("panel", "const summary = finished ? summaryLine(", 'const summary = run.status !== "none" ? summaryLine(') },
  { label: "a pending run does not say it is being checked", file: "panel", flips: ["pending-says-in-progress"], apply: edit("panel", "Checking this study…", "Working…") },
  { label: "'Nothing flagged' is drawn for a pending run too", file: "panel", flips: ["pending-empty-not-nothing-flagged"], apply: edit("panel", "{finished && run.findings.length === 0 && withheld === 0 && ran.length > 0 && (", "{(finished || isPending(run.status)) && run.findings.length === 0 && withheld === 0 && ran.length > 0 && (") },
  { label: "a failed run does not say it did not finish", file: "panel", flips: ["failed-says-did-not-finish"], apply: edit("panel", "The check did not finish.", "The check stopped.") },
  { label: "'Nothing flagged' is drawn for a failed run too", file: "panel", flips: ["failed-empty-not-nothing-flagged"], apply: edit("panel", "{finished && run.findings.length === 0 && withheld === 0 && ran.length > 0 && (", '{(finished || run.status === "failed") && run.findings.length === 0 && withheld === 0 && ran.length > 0 && (') },

  // ---- partial coverage --------------------------------------------------------------
  { label: "a clause that judged part of the record is listed without its note", file: "panel", flips: ["partial-note-shown", "partial-note-beside-findings"], apply: edit("panel", "§{c.section} {c.clauseId} — {c.note}", "§{c.section} {c.clauseId}") },
  { label: "every clause that ran is listed as checked in part", file: "panel", flips: ["full-clause-adds-no-note"], apply: edit("panel", "{partial.map((c) => (", "{ran.map((c) => (") },
  { label: "a clause that could not run is listed without its reason", file: "panel", flips: ["not-run-listed-with-reason"], apply: edit("panel", "§{c.section} {c.clauseId} — {c.reason}", "§{c.section} {c.clauseId}") },
  { label: "the empty-run sentence is not scoped to the clauses that could run", file: "panel", flips: ["empty-run-sentence-scoped", "partial-only-no-green-scoped"], apply: edit("panel", "Nothing flagged in the clauses that could run.", "Nothing flagged.") },
  { label: "the green check is drawn however much was judged", file: "panel", flips: ["partial-empty-no-green-check", "partial-only-no-green-scoped"], apply: edit("panel", "{incomplete ? (", "{false ? (") },
  {
    label: "a clause that judged part of the record does not make the run incomplete",
    file: "panel",
    flips: ["partial-only-no-green-scoped", "partial-only-header-scoped"],
    apply: edit("panel", "const incomplete = ran.length === 0 || notRun.length > 0 || partial.length > 0;", "const incomplete = ran.length === 0 || notRun.length > 0;"),
  },
  { label: "the earned check mark is not the green one", file: "panel", flips: ["full-empty-green-earned", "withheld-zero-green-earned"], apply: edit("panel", '<CheckCircle2 className="w-4 h-4 text-emerald-600" />', '<CheckCircle2 className="w-4 h-4 text-sky-600" />') },
  { label: "the partial list is dropped when there are findings", file: "panel", flips: ["partial-note-beside-findings"], apply: edit("panel", "{finished && partial.length > 0 && (", "{finished && partial.length > 0 && run.findings.length === 0 && (") },
  { label: "the clauses that could not run are listed for an unfinished run too", file: "panel", flips: ["unfinished-coverage-not-shown"], apply: edit("panel", "{finished && notRun.length > 0 && (", "{notRun.length > 0 && (") },

  // ---- nothing was checked -----------------------------------------------------------
  { label: "nothing-checked does not say nothing was checked", file: "panel", flips: ["nothing-checked-says-so", "odd-run-renders-nothing-checked"], apply: edit("panel", "No clause could run on this study, so nothing was checked.", "No clause could run on this study.") },
  { label: "'Nothing flagged' is drawn when no clause ran", file: "panel", flips: ["nothing-checked-not-nothing-flagged", "odd-run-renders-nothing-checked"], apply: edit("panel", "{finished && run.findings.length === 0 && withheld === 0 && ran.length > 0 && (", "{finished && run.findings.length === 0 && withheld === 0 && (") },
  {
    label: "nothing-checked carries the green check",
    file: "panel",
    flips: ["nothing-checked-no-green-check"],
    apply: edit("panel", '<HelpCircle className="w-4 h-4" />\n            No clause could run', '<CheckCircle2 className="w-4 h-4 text-emerald-600" />\n            No clause could run'),
  },
  { label: "the count of clauses that could not run is not given", file: "panel", flips: ["nothing-checked-lists-why"], apply: edit("panel", '{notRun.length} clause{notRun.length === 1 ? "" : "s"} could not run', '{notRun.length === 1 ? "1 clause" : "Some clauses"} could not run') },
  { label: "nothing-checked is drawn for a run that did not finish", file: "panel", flips: ["nothing-checked-finished-only"], apply: edit("panel", "{finished && run.findings.length === 0 && withheld === 0 && ran.length === 0 && (", "{run.findings.length === 0 && withheld === 0 && ran.length === 0 && (") },
  { label: "a header over findings is hedged only for skipped or partial clauses", file: "panel", flips: ["nothing-checked-header-scoped"], apply: edit("panel", "summarizeOpen(run.findings, run.dispositions, withheld), incomplete)", "summarizeOpen(run.findings, run.dispositions, withheld), notRun.length > 0 || partial.length > 0)") },
  { label: "twelve clauses that could not run read as nothing checked though one ran", file: "panel", flips: ["one-ran-is-not-nothing-checked"], apply: edit("panel", "withheld === 0 && ran.length === 0 && (", "withheld === 0 && (ran.length === 0 || notRun.length >= 12) && (") },

  // ---- a finding the server withheld (FW-3) -----------------------------------------
  { label: "'Nothing flagged' is not held back by a withheld finding", file: "panel", flips: ["withheld-not-nothing-flagged", "withheld-no-green-check"], also: ["withheld-scoped-coverage-not-clear", "wiring-panel-shows-the-fetched-hold"], apply: edit("panel", "{finished && run.findings.length === 0 && withheld === 0 && ran.length > 0 && (", "{finished && run.findings.length === 0 && ran.length > 0 && (") },
  {
    label: "a green check is drawn beside a withheld finding",
    file: "panel",
    flips: ["withheld-no-green-check", "withheld-scoped-coverage-not-clear"],
    apply: edit("panel", "        {/* A RULES_VERSION change stops", '        {finished && withheld > 0 && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}\n\n        {/* A RULES_VERSION change stops'),
  },
  { label: "a withheld finding reads as nothing checked", file: "panel", flips: ["withheld-not-nothing-checked"], also: ["withheld-scoped-coverage-not-clear"], apply: edit("panel", "withheld === 0 && ran.length === 0 && (", "(withheld > 0 || (withheld === 0 && ran.length === 0)) && (") },
  { label: "the routed line is not red", file: "panel", flips: ["withheld-routed-line-red"], apply: edit("panel", '<p className="text-sm text-red-600" data-testid="proofread-withheld">', '<p className="text-sm text-amber-700" data-testid="proofread-withheld">') },
  {
    label: "the header is counted without the withheld findings",
    file: "panel",
    flips: ["withheld-header-holds", "withheld-two-header-counts", "withheld-decided-header-holds", "withheld-ordinary-header-holds"],
    also: ["wiring-panel-shows-the-fetched-hold"], apply: edit("panel", "summarizeOpen(run.findings, run.dispositions, withheld)", "summarizeOpen(run.findings, run.dispositions)"),
  },
  { label: "a run that carries no count is read as one withheld", file: "panel", flips: ["withheld-zero-unchanged"], apply: edit("panel", "const withheld = run.withheld > 0 ? run.withheld : 0;", "const withheld = run.withheld === undefined ? 1 : run.withheld > 0 ? run.withheld : 0;") },
  { label: "'Nothing flagged' is never drawn", file: "panel", flips: ["withheld-zero-green-earned", "full-empty-green-earned"], also: ["empty-run-sentence-scoped", "partial-only-no-green-scoped"], apply: edit("panel", "{finished && run.findings.length === 0 && withheld === 0 && ran.length > 0 && (", "{finished && run.findings.length === 0 && withheld < 0 && ran.length > 0 && (") },
  { label: "withheldLine says one item whatever the count", file: "lib", flips: ["withheld-two-line-plural", "withheld-line-pluralised"], apply: edit("lib", "return n === 1\n", "return n >= 1\n") },
  { label: "summarizeOpen counts at most one withheld finding as a hold", file: "lib", flips: ["withheld-two-header-counts"], apply: edit("lib", "open: w, holds: w,", "open: w, holds: Math.min(w, 1),") },
  { label: "the header says every item is decided once the visible ones are", file: "panel", flips: ["withheld-decided-header-holds", "withheld-header-holds", "withheld-two-header-counts"], also: ["wiring-panel-shows-the-fetched-hold"], apply: edit("panel", "if (s.open === 0) return", "if (s.open - s.withheld === 0) return") },
  { label: "the routed line is dropped when a finding is visible", file: "panel", flips: ["withheld-decided-finding-and-line"], also: ["wiring-panel-shows-the-fetched-hold"], apply: edit("panel", "{finished && withheld > 0 && (", "{finished && withheld > 0 && run.findings.length === 0 && (") },
  { label: "the quiet sentence wins over a withheld hold when there is something to state", file: "panel", flips: ["withheld-ordinary-header-holds"], also: ["wiring-panel-shows-the-fetched-hold"], apply: edit("panel", "if (s.holds > 0) {", "if (s.holds > s.withheld || (s.holds > 0 && rest.length === 0)) {") },
  { label: "nothing-checked is drawn over a withheld finding", file: "panel", flips: ["withheld-scoped-coverage-not-clear"], apply: edit("panel", "{finished && run.findings.length === 0 && withheld === 0 && ran.length === 0 && (", "{finished && run.findings.length === 0 && ran.length === 0 && (") },
  { label: "the routed line is drawn for a run that did not finish", file: "panel", flips: ["withheld-unfinished-shows-nothing"], apply: edit("panel", "{finished && withheld > 0 && (", "{withheld > 0 && (") },
  { label: "summarizeOpen leaves withheld findings out of the total", file: "lib", flips: ["summarize-counts-withheld"], also: ["withheld-header-holds", "withheld-two-header-counts"], apply: edit("lib", "total: findings.length + w,", "total: findings.length,") },
  { label: "summarizeOpen without a count assumes one", file: "lib", flips: ["summarize-without-count-unchanged"], also: ["summarize-ignores-bad-count"], apply: edit("lib", "dispositions: DispositionT[], withheld = 0): OpenSummary", "dispositions: DispositionT[], withheld = 1): OpenSummary") },
  { label: "summarizeOpen takes a fractional count", file: "lib", flips: ["summarize-ignores-bad-count"], apply: edit("lib", "const w = Number.isInteger(withheld) && withheld > 0 ? withheld : 0;", "const w = withheld > 0 ? withheld : 0;") },
  {
    label: "fetchProofread coerces the count with Number()",
    file: "lib",
    flips: ["fetch-carries-withheld"],
    apply: edit("lib", 'withheld: typeof data.withheld === "number" && Number.isInteger(data.withheld) && data.withheld > 0 ? data.withheld : 0,', "withheld: Number(data.withheld) || 0,"),
  },

  // ---- what clears a withheld finding (I-A) ------------------------------------------
  {
    label: "the singular line goes back to the old clearing rule",
    file: "lib",
    flips: ["withheld-old-clearing-rule-gone", "withheld-routed-line-red", "withheld-line-pluralised"],
    also: ["withheld-decided-finding-and-line", "withheld-scoped-coverage-not-clear"],
    apply: edit("lib", "Hold the study until they resolve it. ${ships}`", "Hold the study until a re-run no longer raises it.`"),
  },
  {
    label: "the plural line goes back to the old clearing rule",
    file: "lib",
    flips: ["withheld-old-clearing-rule-gone", "withheld-two-line-plural", "withheld-line-pluralised"],
    apply: edit("lib", "Hold the study until they resolve them. ${ships}`", "Hold the study until a re-run no longer raises them.`"),
  },
  {
    label: "the line no longer says to generate the study again after an engine fix",
    file: "lib",
    flips: ["withheld-routed-line-red", "withheld-two-line-plural", "withheld-line-pluralised"],
    also: ["withheld-decided-finding-and-line", "withheld-scoped-coverage-not-clear"],
    apply: edit("lib", 'const ships = "If the fix is to the engine, generate the study again once it ships.";', 'const ships = "Run the check again once it ships.";'),
  },
  { label: "the module keeps the old clearing rule in a string it never shows", file: "lib", flips: ["withheld-old-clearing-rule-gone"], apply: edit("lib", "export const RULES_CHANGED_LINE =", 'export const CLEARS_WHEN = "a re-run no longer raises it";\n\nexport const RULES_CHANGED_LINE =') },
  { label: "the module keeps the old rule in a template wrapped across lines", file: "lib", flips: ["withheld-old-clearing-rule-gone"], apply: edit("lib", "export const RULES_CHANGED_LINE =", 'export const CLEARS_WHEN = `until a re-run no\n  // longer raises it`;\n\nexport const RULES_CHANGED_LINE =') },
  { label: "the panel keeps the old clearing rule in a string it never shows", file: "panel", flips: ["withheld-old-clearing-rule-gone"], apply: edit("panel", "const POLL_MS = 60_000;", 'const POLL_MS = 60_000;\nexport const CLEARS_WHEN = "until a rerun no longer raises it";') },

  // ---- a rules change (G1 m-6) ----------------------------------------------------
  { label: "RULES_CHANGED_LINE is reworded", file: "lib", flips: ["rules-changed-line-is-the-sentence", "rules-changed-says-once", "rules-changed-empty-run-says-it"], apply: edit("lib", "so earlier decisions were not carried over.", "so earlier decisions were reset.") },
  { label: "the rules-changed line is drawn a second time under the findings", file: "panel", flips: ["rules-changed-says-once"], apply: edit("panel", "{finished && partial.length > 0 && (", '{finished && run.rulesChanged === true && run.findings.length > 0 && <p className="text-xs">{RULES_CHANGED_LINE}</p>}\n\n        {finished && partial.length > 0 && (') },
  { label: "the rules-changed line is dropped when nothing was found", file: "panel", flips: ["rules-changed-empty-run-says-it"], apply: edit("panel", "{finished && run.rulesChanged === true && (", "{finished && run.rulesChanged === true && run.findings.length > 0 && (") },
  { label: "the rules-changed line is drawn for a run that did not finish", file: "panel", flips: ["rules-changed-unfinished-no-line"], apply: edit("panel", "{finished && run.rulesChanged === true && (", "{run.rulesChanged === true && (") },
  { label: "the rules-changed line is drawn whenever the flag is present", file: "panel", flips: ["rules-unchanged-no-line"], also: ["wiring-panel-shows-the-fetched-hold"], apply: edit("panel", "{finished && run.rulesChanged === true && (", "{finished && run.rulesChanged !== undefined && (") },
  { label: "fetchProofread reads rulesChanged with Boolean()", file: "lib", flips: ["fetch-carries-rules-changed"], apply: edit("lib", "rulesChanged: data.rulesChanged === true,", "rulesChanged: Boolean(data.rulesChanged),") },

  // ---- order and tone ------------------------------------------------------------
  { label: "the order is reversed", file: "lib", flips: ["order-holds-first", "order-real-pass-by-severity", "unknown-type-shown-first"], apply: edit("lib", "sort((a, b) => rankOf(a.type) - rankOf(b.type))", "sort((a, b) => rankOf(b.type) - rankOf(a.type))") },
  { label: "the findings are not sorted at all", file: "lib", flips: ["order-real-pass-by-severity", "order-holds-first", "unknown-type-shown-first"], apply: edit("lib", "return [...findings].sort((a, b) => rankOf(a.type) - rankOf(b.type));", "return [...findings];") },
  { label: "NOTE cards are hidden", file: "panel", flips: ["ordinary-shows-both"], also: ["closes-header-card-agree", "every-type-consistent", "findings-only-when-finished", "offered-per-type", "order-holds-first", "order-real-pass-by-severity", "ordinary-card-colours", "same-path-reads-both-shown", "triage-only-when-finished", "unknown-type-shown-first"], apply: edit("panel", "{finished && orderFindings(run.findings).map((f) => {", '{finished && orderFindings(run.findings).filter((f) => f.type !== "NOTE").map((f) => {') },
  { label: "a NOTE is drawn red", file: "panel", flips: ["ordinary-nothing-red", "ordinary-card-colours"], apply: edit("panel", 'NOTE: { label: "Note", color: "text-yellow-600"', 'NOTE: { label: "Note", color: "text-red-600"') },
  { label: "the quiet header does not say no blocker is open", file: "panel", flips: ["ordinary-header-no-open-blocker"], also: ["closes-header-card-agree", "decided-blocker-not-open", "every-type-consistent", "hedged-header-scoped", "partial-only-header-scoped"], apply: edit("panel", "`No open blocker or contested item${", "`Nothing holds this study${") },
  { label: "the quiet header does not say what is to be stated in the deliverable", file: "panel", flips: ["ordinary-header-counts"], also: ["decided-blocker-not-open", "withheld-ordinary-header-holds"], apply: edit("panel", "rest.push(`${s.disclose} to state in the deliverable`);", "rest.push(`${s.disclose} to disclose`);") },
  { label: "a DISCLOSE card is orange", file: "panel", flips: ["ordinary-card-colours"], apply: edit("panel", 'DISCLOSE: { label: "Disclose", color: "text-amber-600"', 'DISCLOSE: { label: "Disclose", color: "text-orange-600"') },
  { label: "a BLOCKER card is rose", file: "panel", flips: ["blocker-card-red"], apply: edit("panel", 'BLOCKER: { label: "Blocker", color: "text-red-600"', 'BLOCKER: { label: "Blocker", color: "text-rose-600"') },
  { label: "the quiet header says there is something to resolve before completion", file: "panel", flips: ["ordinary-nothing-to-resolve"], apply: edit("panel", "`For the deliverable and the record: ${rest.join", "`For the deliverable, to resolve before completion: ${rest.join") },
  { label: "the header is hedged only for a partial clause", file: "panel", flips: ["hedged-header-scoped", "nothing-checked-header-scoped"], apply: edit("panel", "summarizeOpen(run.findings, run.dispositions, withheld), incomplete)", "summarizeOpen(run.findings, run.dispositions, withheld), partial.length > 0)") },
  { label: "the header is always hedged", file: "panel", flips: ["full-header-not-hedged"], apply: edit("panel", '${incomplete ? " in the clauses that ran" : ""}', '${incomplete ? " in the clauses that ran" : " in the clauses that ran"}') },
  { label: "the hold header is not red", file: "panel", flips: ["blocker-header-red"], also: ["closes-header-card-agree", "every-type-consistent", "recorded-header-moves", "withheld-decided-header-holds", "withheld-header-holds"], apply: edit("panel", '"text-red-600 font-medium"', '"text-amber-700 font-medium"') },
  { label: "the quiet header is drawn as an alarm", file: "panel", flips: ["ordinary-header-not-red"], also: ["closes-header-card-agree", "every-type-consistent", "ordinary-nothing-red"], apply: edit("panel", "      `For the deliverable and the record: ${rest.join(\", \")}.`,\n    alarm: false,", "      `For the deliverable and the record: ${rest.join(\", \")}.`,\n    alarm: true,") },
  { label: "a CONTESTED item is ranked with UNVERIFIED", file: "lib", flips: ["contested-counts-as-hold", "order-holds-first"], also: ["closes-header-card-agree", "every-type-consistent"], apply: edit("lib", "{ BLOCKER: 0, CONTESTED: 0, DEFECT: 0,", "{ BLOCKER: 0, CONTESTED: 3, DEFECT: 0,") },
  { label: "no recorded decision closes anything", file: "lib", flips: ["decided-blocker-not-open", "every-decided-header"], also: ["closes-header-card-agree", "every-type-consistent", "fixed-blocker-closed", "later-decision-rules-closed", "one-closed-not-the-other", "recorded-header-moves", "withheld-decided-header-holds"], apply: edit("lib", "    if (closes(f.type, latestDisposition(dispositions, f.id)?.disposition)) continue;\n", "") },
  { label: "a decided card says Decided, not Recorded", file: "panel", flips: ["decided-shows-record", "recorded-card-shows"], also: ["disclosed-blocker-card-says", "recorded-other-blocker-kept"], apply: edit("panel", "Recorded: <span", "Decided: <span") },
  { label: "every item decided reads 'Every item is decided'", file: "panel", flips: ["every-decided-header"], also: ["closes-header-card-agree", "every-type-consistent", "fixed-blocker-closed", "later-decision-rules-closed"], apply: edit("panel", '"Every item has a recorded decision."', '"Every item is decided."') },
  { label: "an empty run gets a header", file: "panel", flips: ["no-header-empty-or-pending"], apply: edit("panel", "if (s.total === 0) return null;", 'if (s.total === 0) return { text: "Nothing open.", alarm: false };') },

  // ---- what each finding reads, and the only controls ------------------------------
  { label: "two reads of the same path collapse into one", file: "panel", flips: ["same-path-reads-both-shown"], apply: edit("panel", "{f.readPaths.slice(0, 6).map((p, i) => (", "{[...new Map(f.readPaths.map((p) => [p.path, p])).values()].slice(0, 6).map((p, i) => (") },
  { label: "a read is keyed by its path alone", file: "panel", flips: ["same-path-reads-no-key-collision"], apply: edit("panel", "<li key={`${p.path}:${i}`}>", "<li key={p.path}>") },
  { label: "a finding does not say what it was checked against", file: "panel", flips: ["names-checked-against"], apply: edit("panel", "<li>Checked against: {f.sourceLabel}</li>", "<li>Source: {f.sourceLabel}</li>") },
  { label: "a finding shows seven values", file: "panel", flips: ["first-six-values"], apply: edit("panel", "f.readPaths.slice(0, 6)", "f.readPaths.slice(0, 7)") },
  {
    label: "a second control in the header",
    file: "panel",
    flips: ["disclose-only-controls"],
    apply: edit("panel", "      </PanelHeader>\n\n      <div", '        <button data-testid="button-proofread-export" disabled={busy}>Export</button>\n      </PanelHeader>\n\n      <div'),
  },
  { label: "a remedy offers the sealing engineer's decision", file: "panel", flips: ["no-sealing-decisions"], apply: edit("panel", "<li>Suggested: {f.remedy}</li>", "<li>Suggested: {f.remedy} (or accepted risk)</li>") },
  { label: "the source is a link", file: "panel", flips: ["no-link-form-field"], apply: edit("panel", "<li>Checked against: {f.sourceLabel}</li>", '<li>Checked against: <a href="#source">{f.sourceLabel}</a></li>') },

  // ---- a finding type this client does not know -------------------------------------
  { label: "an unknown type is ranked last", file: "lib", flips: ["unknown-type-shown-first", "unknown-type-counted"], also: ["closes-header-card-agree", "every-type-consistent"], apply: edit("lib", "SEVERITY_RANK[type] ?? 0;", "SEVERITY_RANK[type] ?? 9;") },
  { label: "an unknown type is labelled Other", file: "panel", flips: ["unknown-type-labelled"], apply: edit("panel", "?? { label: f.type, color:", '?? { label: "Other", color:') },
  { label: "an unknown type is not counted as a hold", file: "lib", flips: ["unknown-type-counted"], also: ["closes-header-card-agree", "every-type-consistent"], apply: edit("lib", "if (rankOf(f.type) === 0) s.holds++;", "if (f.type in SEVERITY_RANK && rankOf(f.type) === 0) s.holds++;") },
  { label: "an unknown type is offered a NOTE's decisions", file: "lib", flips: ["unknown-type-strictest-set"], also: ["closes-header-card-agree", "closes-per-type", "every-type-consistent", "offered-for-per-type", "offered-per-type"], apply: edit("lib", "?? OFFERED.BLOCKER;", "?? OFFERED.NOTE;") },

  // ---- decisions offered, and what closes ------------------------------------------
  { label: "the decisions are offered in reverse", file: "panel", flips: ["offered-per-type"], also: ["closes-header-card-agree", "disclose-only-controls", "disclosed-blocker-still-offered", "every-type-consistent", "recorded-other-blocker-kept", "unknown-type-strictest-set"], apply: edit("panel", "{offered.map((d) => (", "{[...offered].reverse().map((d) => (") },
  { label: "the Fixed button is labelled as filing a bug", file: "panel", flips: ["no-bug-filed-label"], also: ["closes-header-card-agree", "disclose-only-controls", "disclosed-blocker-still-offered", "every-type-consistent", "offered-per-type", "recorded-other-blocker-kept", "unknown-type-strictest-set"], apply: edit("panel", "{DECISION_LABEL[d]}", '{DECISION_LABEL[d] === "Fixed" ? "Fixed (bug)" : DECISION_LABEL[d]}') },
  { label: "the Fixed button carries a BUG_FILED test id", file: "panel", flips: ["no-reserved-decision-control"], apply: edit("panel", "data-testid={`button-disposition-${d.toLowerCase()}`}", 'data-testid={`button-disposition-${d === "FIXED" ? "bug_filed" : d.toLowerCase()}`}') },
  { label: "a CONTESTED item does not name the sealing engineer", file: "panel", flips: ["contested-awaits-engineer"], apply: edit("panel", "Awaiting the sealing engineer's ruling.", "Awaiting a ruling.") },
  { label: "a BLOCKER also says it awaits the sealing engineer", file: "panel", flips: ["only-contested-awaits"], apply: edit("panel", '{f.type === "CONTESTED" && (', '{(f.type === "CONTESTED" || f.type === "BLOCKER") && (') },
  { label: "BUG_FILED closes any finding", file: "lib", flips: ["closes-header-card-agree", "every-type-consistent", "closes-per-type"], apply: edit("lib", "(offeredFor(type) as string[]).includes(disposition);", '((offeredFor(type) as string[]).includes(disposition) || disposition === "BUG_FILED");') },
  { label: "a BLOCKER is closed by a disclosure", file: "lib", flips: ["disclosed-blocker-open", "recorded-before-two-open", "one-closed-not-the-other"], also: ["closes-header-card-agree", "closes-per-type", "disclosed-blocker-card-says", "disclosed-blocker-still-offered", "every-type-consistent", "later-decision-rules-open", "offered-equals-accepted", "offered-for-per-type", "offered-per-type", "recorded-header-moves", "recorded-other-blocker-kept", "unknown-type-strictest-set"], apply: edit("lib", '  BLOCKER: ["FIXED", "WITHDRAWN"],\n  DISCLOSE:', '  BLOCKER: ["FIXED", "WITHDRAWN", "DISCLOSED"],\n  DISCLOSE:') },
  { label: "a non-closing record does not say the item stays open", file: "panel", flips: ["disclosed-blocker-card-says"], apply: edit("panel", "{!closed && `. That does not close a ${noun}; it stays open.`}", "{!closed && `. It stays open.`}") },
  { label: "any record hides the controls", file: "panel", flips: ["disclosed-blocker-still-offered"], also: ["closes-header-card-agree", "every-type-consistent", "recorded-other-blocker-kept"], apply: edit("panel", "{!closed && offered.length > 0 && (", "{!disposed && offered.length > 0 && (") },
  { label: "a closed finding keeps its controls", file: "panel", flips: ["fixed-blocker-closed"], also: ["closes-header-card-agree", "every-type-consistent", "recorded-card-shows"], apply: edit("panel", "{!closed && offered.length > 0 && (", "{offered.length > 0 && (") },
  { label: "latestDisposition keeps the first record it meets", file: "lib", flips: ["later-decision-rules-open", "later-decision-rules-closed", "latest-by-time"], apply: edit("lib", "if (latest === undefined || (Number.isFinite(t) ? t : -Infinity) > at) {", "if (latest === undefined) {") },
  { label: "summarizeOpen stops counting at the first closed finding", file: "lib", flips: ["one-closed-not-the-other"], also: ["decided-blocker-not-open", "recorded-header-moves"], apply: edit("lib", "if (closes(f.type, latestDisposition(dispositions, f.id)?.disposition)) continue;", "if (closes(f.type, latestDisposition(dispositions, f.id)?.disposition)) break;") },

  // ---- busy ---------------------------------------------------------------------
  { label: "the re-run button is disabled on a finished run", file: "panel", flips: ["idle-controls-enabled"], apply: edit("panel", "onClick={onRerun}\n          disabled={busy}", 'onClick={onRerun}\n          disabled={busy || run.status === "rules_ready"}') },
  { label: "a triage button stays enabled while busy", file: "panel", flips: ["busy-controls-disabled"], apply: edit("panel", "onClick={() => onTriage(f, d)}\n                      disabled={busy}", "onClick={() => onTriage(f, d)}\n                      disabled={false}") },
  { label: "the busy spinner does not spin", file: "panel", flips: ["busy-shows-progress"], apply: edit("panel", '<Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw', '<Loader2 className="w-3.5 h-3.5 animate-pulse" /> : <RefreshCw') },
  { label: "the idle icon spins", file: "panel", flips: ["idle-no-progress"], apply: edit("panel", '<RefreshCw className="w-3.5 h-3.5" />', '<RefreshCw className="w-3.5 h-3.5 animate-spin" />') },

  // ---- a load that failed ----------------------------------------------------------
  { label: "an empty frame is drawn while loading", file: "panel", flips: ["loading-draws-nothing"], apply: edit("panel", "if (!error) return null;", 'if (!error) return <section data-testid="panel-proofread" />;') },
  { label: "a failed first load does not say why", file: "panel", flips: ["first-load-failed-drawn"], apply: edit("panel", "Could not load the check ({error}).", "Could not load the check.") },
  { label: "a failed first load claims a result", file: "panel", flips: ["first-load-failed-no-claim"], apply: edit("panel", "Trying again every minute.", "Nothing flagged so far. Trying again every minute.") },
  { label: "an error is not shown above findings", file: "panel", flips: ["later-error-shown", "superseded-notice-rendered"], apply: edit("panel", "{error && <div", "{error && run.findings.length === 0 && <div") },

  // ---- rendered copy ---------------------------------------------------------------
  {
    label: "the permitted description stays in the source but is not rendered",
    file: "panel",
    flips: ["rendered-permitted-description"],
    apply: chain(
      edit("panel", "An internal consistency and traceability check over this saved study", "A check over this saved study"),
      edit("panel", "const POLL_MS = 60_000;", 'const POLL_MS = 60_000;\nexport const KIND = "an internal consistency and traceability check";'),
    ),
  },
  { label: "a DOM attribute React warns about", file: "panel", flips: ["no-react-warnings"], apply: edit("panel", '<header className="flex items-start', '<header class="flex items-start') },

  // ---- the decision shown at once (FW-9) -------------------------------------------
  {
    label: "the module renames withRecordedDecision (the panel follows)",
    file: ["lib", "panel"],
    flips: ["exports-with-recorded-decision"],
    apply: chain(
      edit("lib", "export function withRecordedDecision(", "export function withDecisionShown("),
      edit("panel", "  withRecordedDecision,\n", "  withDecisionShown as withRecordedDecision,\n"),
    ),
  },
  { label: "withRecordedDecision writes into the run it was handed", file: "lib", flips: ["recorded-leaves-input-alone"], apply: edit("lib", "return { ...run, dispositions: [recorded, ...run.dispositions] };", "run.dispositions.unshift(recorded);\n  return { ...run };") },
  {
    label: "withRecordedDecision drops the other findings",
    file: "lib",
    flips: ["recorded-run-otherwise-same", "recorded-header-moves", "recorded-other-blocker-kept"],
    apply: edit("lib", "return { ...run, dispositions: [recorded, ...run.dispositions] };", "return { ...run, findings: run.findings.slice(0, 1), dispositions: [recorded, ...run.dispositions] };"),
  },
  { label: "the record is written against the last finding", file: "lib", flips: ["recorded-one-record-on-pressed"], also: ["recorded-card-names-source", "recorded-card-shows", "recorded-carries-source", "recorded-closes", "recorded-is-the-decision", "recorded-other-blocker-kept", "recorded-stamped-now"], apply: edit("lib", "    findingId: finding.id,\n", "    findingId: run.findings[run.findings.length - 1]?.id ?? finding.id,\n") },
  { label: "the record is always FIXED", file: "lib", flips: ["recorded-is-the-decision"], also: ["recorded-card-shows"], apply: edit("lib", "    disposition: body.disposition,\n", '    disposition: "FIXED",\n') },
  { label: "the record drops the source", file: "lib", flips: ["recorded-carries-source", "recorded-card-names-source"], apply: edit("lib", "sourceLabel: body.sourceLabel ?? null,", "sourceLabel: null,") },
  { label: "the record is stamped a second late", file: "lib", flips: ["recorded-stamped-now"], apply: edit("lib", "createdAt: now.toISOString(),", "createdAt: new Date(now.getTime() + 1000).toISOString(),") },
  { label: "the record carries an empty note", file: "lib", flips: ["recorded-no-note"], apply: edit("lib", "    note: null,\n    sourceLabel: body.sourceLabel ?? null,", '    note: "",\n    sourceLabel: body.sourceLabel ?? null,') },
  { label: "the record's decision is lower-cased", file: "lib", flips: ["recorded-closes", "recorded-is-the-decision", "recorded-card-shows"], also: ["recorded-header-moves"], apply: edit("lib", "    disposition: body.disposition,\n", "    disposition: body.disposition.toLowerCase(),\n") },
  { label: "the finding's earlier records are dropped", file: "lib", flips: ["recorded-others-kept"], apply: edit("lib", "dispositions: [recorded, ...run.dispositions] };", "dispositions: [recorded, ...run.dispositions.filter((d) => d.findingId !== finding.id)] };") },
  { label: "a decision on a BLOCKER hands back the run unchanged", file: "lib", flips: ["recorded-input-unchanged"], also: ["recorded-card-names-source", "recorded-card-shows", "recorded-carries-source", "recorded-closes", "recorded-header-moves", "recorded-is-the-decision", "recorded-one-record-on-pressed", "recorded-others-kept", "recorded-stamped-now"], apply: edit("lib", "if (!runId || run.runId !== runId) return run;", 'if (!runId || run.runId !== runId || finding.type === "BLOCKER") return run;') },
  { label: "a decision on another run is applied to this one", file: "lib", flips: ["other-run-untouched", "no-id-run-untouched"], apply: edit("lib", "if (!runId || run.runId !== runId) return run;", "if (!runId) return run;") },
  { label: "a run with no id takes any decision", file: "lib", flips: ["no-id-run-untouched"], apply: edit("lib", "if (!runId || run.runId !== runId) return run;", "if (!runId || (run.runId !== undefined && run.runId !== runId)) return run;") },
  { label: "a decision with no run id is applied to a run with no id", file: "lib", flips: ["no-run-id-touches-nothing"], apply: edit("lib", "if (!runId || run.runId !== runId) return run;", "if (run.runId !== runId) return run;") },

  // ---- the client module -------------------------------------------------------
  {
    label: "the module renames isFinished (the panel follows)",
    file: ["lib", "panel"],
    flips: ["exports-pending-finished-body"],
    apply: chain(edit("lib", "export function isFinished(", "export function isShowable("), edit("panel", "  isFinished,\n", "  isShowable as isFinished,\n")),
  },
  {
    label: "the module renames offeredFor (the panel follows)",
    file: ["lib", "panel"],
    flips: ["exports-offered-closes-latest"],
    apply: chain(edit("lib", "export function offeredFor(", "export function offeredForType("), edit("lib", "!!disposition && (offeredFor(type)", "!!disposition && (offeredForType(type)"), edit("panel", "  offeredFor,\n", "  offeredForType as offeredFor,\n")),
  },
  { label: "a NOTE is offered its decisions in another order", file: "lib", flips: ["offered-for-per-type", "offered-per-type"], also: ["closes-header-card-agree", "every-type-consistent"], apply: edit("lib", '  NOTE: ["DISCLOSED", "FIXED", "WITHDRAWN"],', '  NOTE: ["FIXED", "DISCLOSED", "WITHDRAWN"],') },
  { label: "a decision that is not an upper-case name closes", file: "lib", flips: ["closes-nothing-on-empty"], apply: edit("lib", "(offeredFor(type) as string[]).includes(disposition);", "((offeredFor(type) as string[]).includes(disposition) || !/^[A-Z_]+$/.test(disposition));") },
  { label: "isFinished drops 'ready'", file: "lib", flips: ["is-finished-per-status"], also: ["wiring-panel-shows-the-fetched-hold", "findings-only-when-finished", "header-only-when-finished", "nothing-checked-says-so", "rules-changed-empty-run-says-it", "rules-changed-says-once", "triage-only-when-finished", "withheld-header-holds", "withheld-routed-line-red"], apply: edit("lib", 'return status === "rules_ready" || status === "ready";', 'return status === "rules_ready";') },
  { label: "dispositionBody sends a sourceLabel key on FIXED", file: "lib", flips: ["body-no-source-no-prompt"], apply: edit("lib", 'if (disposition !== "WITHDRAWN") return { disposition };', 'if (disposition !== "WITHDRAWN") return { disposition, sourceLabel: undefined };') },
  { label: "dispositionBody adds a note", file: "lib", flips: ["body-json-is-disposition", "disposition-body-no-source-key"], apply: edit("lib", 'if (disposition !== "WITHDRAWN") return { disposition };', 'if (disposition !== "WITHDRAWN") return { disposition, note: null };') },
  { label: "a cancelled prompt is read as the text 'null'", file: "lib", flips: ["withdrawn-cancelled-records-nothing", "withdrawn-no-answer-records-nothing"], apply: edit("lib", '(askSource() ?? "").trim()', "String(askSource()).trim()") },
  { label: "an unanswered prompt is read as the text 'undefined'", file: "lib", flips: ["withdrawn-no-answer-records-nothing"], apply: edit("lib", '(askSource() ?? "").trim()', '((a) => (a === null ? "" : String(a)))(askSource()).trim()') },
  { label: "an empty answer is read as a space", file: "lib", flips: ["withdrawn-empty-records-nothing"], apply: edit("lib", '(askSource() ?? "").trim()', '((a) => (a === "" ? " " : (a ?? "").trim()))(askSource())') },
  { label: "the answer is not trimmed", file: "lib", flips: ["withdrawn-blank-records-nothing", "withdrawn-named-source-trimmed", "recorded-carries-source"], apply: edit("lib", '(askSource() ?? "").trim()', '(askSource() ?? "")') },
  { label: "the answer is trimmed at the start only", file: "lib", flips: ["withdrawn-named-source-trimmed", "recorded-carries-source"], apply: edit("lib", '(askSource() ?? "").trim()', '(askSource() ?? "").trimStart()') },
  { label: "the decision posts to /disposition", file: "lib", flips: ["disposition-url"], apply: edit("lib", "/findings/${encodeURIComponent(findingId)}/dispositions`", "/findings/${encodeURIComponent(findingId)}/disposition`") },
  { label: "the decision body gains an empty sourceLabel", file: "lib", flips: ["disposition-body-no-source-key"], apply: edit("lib", "body: JSON.stringify(body) },", 'body: JSON.stringify({ sourceLabel: "", ...body }) },') },
  { label: "fetchProofread passes a missing findings list through", file: "lib", flips: ["fetch-defaults-lists", "fetch-keeps-run-id-and-arrays", "odd-run-renders-nothing-checked"], apply: edit("lib", "findings: Array.isArray(data.findings) ? data.findings : [],", "findings: data.findings as ProofreadFindingT[],") },
  { label: "a response with no status reads as finished", file: "lib", flips: ["fetch-no-status-is-none"], apply: edit("lib", 'status: data.status ?? "none",', 'status: data.status ?? "rules_ready",') },
  { label: "the revision is sent as the run id", file: "lib", flips: ["fetch-keeps-run-id-and-arrays"], also: ["fetch-carries-a-full-answer"], apply: edit("lib", "    runId: data.runId,\n", "    runId: data.revision !== undefined ? String(data.revision) : data.runId,\n") },

  // ---- a decision on a superseded run (FW-6) -------------------------------------
  {
    label: "the module renames isSuperseded (the panel follows)",
    file: ["lib", "panel"],
    flips: ["exports-superseded"],
    apply: chain(edit("lib", "export function isSuperseded(", "export function isStale("), edit("panel", "  isSuperseded,\n", "  isStale as isSuperseded,\n")),
  },
  { label: "a 410, not a 409, is read as superseded", file: "lib", flips: ["superseded-409-recognised"], apply: edit("lib", "e instanceof ProofreadRequestError && e.status === 409", "e instanceof ProofreadRequestError && e.status === 410") },
  { label: "a refusal drops the server's sentence", file: "lib", flips: ["refusal-carries-status-message", "other-refusals-not-superseded"], apply: edit("lib", "throw new ProofreadRequestError(message, r.status);", "throw new ProofreadRequestError(`HTTP ${r.status}`, r.status);") },
  { label: "any refusal is read as superseded", file: "lib", flips: ["other-refusals-not-superseded"], apply: edit("lib", "e instanceof ProofreadRequestError && e.status === 409", "e instanceof ProofreadRequestError && e.status >= 400") },
  { label: "only a 201 is accepted", file: "lib", flips: ["ok-is-not-refusal", "disposition-url"], apply: edit("lib", "  if (!r.ok) {\n    const message", "  if (r.status !== 201) {\n    const message") },
  { label: "any object with status 409 is read as superseded", file: "lib", flips: ["only-client-409-counts"], apply: edit("lib", "return e instanceof ProofreadRequestError && e.status === 409;", 'return typeof e === "object" && e !== null && (e as { status?: unknown }).status === 409;') },
  { label: "the notice does not say the decision was not recorded", file: "lib", flips: ["superseded-notice-rendered"], apply: edit("lib", "so that decision was not recorded. The latest run is shown.", "so the latest run is shown.") },
  { label: "the notice says QA/QC", file: "lib", flips: ["superseded-notice-copy-clean", "lib-avoids-banned-copy", "rendered-avoids-banned-copy"], apply: edit("lib", "The latest run is shown.", "The latest QA/QC run is shown.") },

  // ---- the panel offers what the server accepts (FW-5) ----------------------------
  { label: "the module stops exporting OFFERED", file: "lib", flips: ["offered-maps-exported", "offered-same-six-types", "offered-equals-accepted"], apply: edit("lib", "export const OFFERED: Record<", "const OFFERED: Record<") },
  { label: "the module's map names a seventh type", file: "lib", flips: ["offered-same-six-types"], apply: edit("lib", "  DEFECT: [],\n};", "  DEFECT: [],\n  OBSERVATION: [],\n};") },
  {
    label: "the panel offers a NOTE no withdrawal",
    file: "lib",
    flips: ["offered-equals-accepted", "offered-per-type", "offered-for-per-type", "closes-per-type", "closes-header-card-agree", "every-type-consistent"],
    also: ["triage-only-when-finished"], apply: edit("lib", '  NOTE: ["DISCLOSED", "FIXED", "WITHDRAWN"],', '  NOTE: ["DISCLOSED", "FIXED"],'),
  },

  // ---- a whole answer, and the panel's hand-off of it (LAN-4) ---------------------
  {
    label: "fetchProofread reads the count only when nothing is visible",
    file: "lib",
    flips: ["fetch-carries-a-full-answer"],
    also: ["wiring-panel-hands-view-the-fetched-run", "wiring-panel-shows-the-fetched-hold"],
    apply: edit("lib", "    withheld: typeof data.withheld", "    withheld: Array.isArray(data.findings) && data.findings.length > 0 ? 0 : typeof data.withheld"),
  },
  {
    label: "fetchProofread drops the rules-changed flag when something is visible",
    file: "lib",
    flips: ["fetch-carries-a-full-answer"],
    also: ["wiring-panel-hands-view-the-fetched-run", "wiring-panel-shows-the-fetched-hold"],
    apply: edit("lib", "rulesChanged: data.rulesChanged === true,", "rulesChanged: data.rulesChanged === true && !(Array.isArray(data.findings) && data.findings.length > 0),"),
  },
  { label: "fetchProofread drops the run's createdAt", file: "lib", flips: ["fetch-carries-a-full-answer"], apply: edit("lib", "    createdAt: data.createdAt,\n", "    createdAt: undefined,\n") },
  // The other two halves (fix wave 3, G2-2): a count zeroed when nothing is visible, a flag dropped for a 'ready' run.
  {
    label: "fetchProofread zeroes the count when nothing is visible",
    file: "lib",
    flips: ["fetch-carries-a-full-answer"],
    also: ["fetch-carries-withheld", "wiring-panel-hands-view-the-fetched-run", "wiring-panel-shows-the-fetched-hold"],
    apply: edit("lib", "    withheld: typeof data.withheld", "    withheld: Array.isArray(data.findings) && data.findings.length === 0 ? 0 : typeof data.withheld"),
  },
  {
    label: "fetchProofread drops the rules-changed flag for a 'ready' run",
    file: "lib",
    flips: ["fetch-carries-a-full-answer"],
    also: ["wiring-panel-hands-view-the-fetched-run", "wiring-panel-shows-the-fetched-hold"],
    apply: edit("lib", "rulesChanged: data.rulesChanged === true,", 'rulesChanged: data.rulesChanged === true && data.status !== "ready",'),
  },
  {
    label: "the wrapper hands the view the run with its count zeroed",
    file: "panel",
    flips: ["wiring-panel-hands-view-the-fetched-run", "wiring-panel-shows-the-fetched-hold"],
    apply: edit("panel", "      run={run}\n", "      run={run && { ...run, withheld: 0 }}\n"),
  },
  {
    label: "the wrapper stores the fetched run with its flag cleared",
    file: "panel",
    flips: ["wiring-panel-hands-view-the-fetched-run", "wiring-panel-shows-the-fetched-hold"],
    apply: edit("panel", "        setRun(next);\n", "        setRun({ ...next, rulesChanged: false });\n"),
  },
  {
    label: "the wrapper zeroes the count when nothing is visible",
    file: "panel",
    flips: ["wiring-panel-hands-view-the-fetched-run", "wiring-panel-shows-the-fetched-hold"],
    apply: edit("panel", "      run={run}\n", "      run={run && (run.findings.length > 0 ? run : { ...run, withheld: 0 })}\n"),
  },
  {
    label: "the wrapper stores a 'ready' run with its flag cleared",
    file: "panel",
    flips: ["wiring-panel-hands-view-the-fetched-run", "wiring-panel-shows-the-fetched-hold"],
    apply: edit("panel", "        setRun(next);\n", '        setRun(next.status === "ready" ? { ...next, rulesChanged: false } : next);\n'),
  },
  { label: "the wrapper fetches twice when it mounts", file: "panel", flips: ["wiring-panel-hands-view-the-fetched-run"], apply: edit("panel", "    void load();\n", "    void load();\n    void load();\n") },

  // ---- WIRING (text) -----------------------------------------------------------
  { label: "the poll effect no longer depends on nonce", file: "panel", flips: ["wiring-poll-depends-on-nonce"], apply: edit("panel", "}, [projectId, nonce]);", "}, [projectId]);") },
  { label: "a re-run refetches once instead of bumping the nonce", file: "panel", flips: ["wiring-rerun-bumps-nonce"], apply: edit("panel", "setNonce((v) => v + 1); // re-arms the poll and refetches", "void fetchProofread(projectId).then(setRun);") },
  { label: "a decision is recorded against the revision", file: "panel", flips: ["wiring-decision-on-run-uuid", "wiring-decision-refetches-via-effect"], apply: edit("panel", "await recordDisposition(projectId, runId, f.id, body);", "await recordDisposition(projectId, String(run.revision), f.id, body);") },
  { label: "the panel builds the body itself", file: "panel", flips: ["wiring-uses-disposition-body"], apply: edit("panel", 'const body = dispositionBody(disposition, () => window.prompt("Name the source this is withdrawn on:"));', 'const body = disposition === "WITHDRAWN" ? null : { disposition };') },
  { label: "a recorded decision refetches with a one-off fetch", file: "panel", flips: ["wiring-decision-refetches-via-effect"], apply: edit("panel", "      setRun((prev) => (prev ? withRecordedDecision(prev, runId, f, body, new Date()) : prev));\n", "      setRun((prev) => (prev ? withRecordedDecision(prev, runId, f, body, new Date()) : prev));\n      setRun(await fetchProofread(projectId));\n") },
  { label: "a recorded decision is not shown before the refetch", file: "panel", flips: ["wiring-decision-shown-at-once"], apply: edit("panel", "      setRun((prev) => (prev ? withRecordedDecision(prev, runId, f, body, new Date()) : prev));\n", "") },
  { label: "the card's offered list is read through a cast", file: "panel", flips: ["wiring-reads-offered-latest-closes"], apply: edit("panel", "const offered = offeredFor(f.type);", "const offered = offeredFor(String(f.type));") },
  { label: "a 409 shows the notice but does not refetch", file: "panel", flips: ["wiring-409-refetches"], apply: edit("panel", "        setNotice(SUPERSEDED_NOTICE);\n        setNonce((v) => v + 1);\n", "        setNotice(SUPERSEDED_NOTICE);\n") },
  { label: "an error hides the notice", file: "panel", flips: ["wiring-notice-own-state"], apply: edit("panel", "error={error ?? notice}", "error={notice ?? error}") },
  { label: "a re-run does not clear the notice", file: "panel", flips: ["wiring-notice-cleared-on-next-action"], apply: edit("panel", "    setBusy(true);\n    setNotice(null);\n    try {\n      await requestProofread", "    setBusy(true);\n    try {\n      await requestProofread") },
  { label: "the panel keeps a decision list of its own", file: "panel", flips: ["wiring-no-decision-table"], apply: edit("panel", "const POLL_MS = 60_000;", 'const POLL_MS = 60_000;\nexport const DISPOSITIONS = ["FIXED"] as const;') },
  { label: "a re-run does not refuse a second press", file: "panel", flips: ["wiring-single-flight", "wiring-notice-cleared-on-next-action"], apply: edit("panel", "  const rerun = async () => {\n    if (inFlight.current) return;\n", "  const rerun = async () => {\n") },
  { label: "the project page mounts the panel for every study", file: "page", flips: ["wiring-page-mounts-for-tis"], apply: edit("page", '{project.studyType === "tis" && <ProofreadPanel projectId={project.id} chat={chat} />}', "{<ProofreadPanel projectId={project.id} chat={chat} />}") },
];

const teeth = new Set(ids);
for (const m of MUTATIONS) {
  const unknown = [...m.flips, ...(m.also ?? [])].filter((id) => !teeth.has(id));
  report("teeth", unknown.length === 0, `teeth: "${m.label}" names only real checks${unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""}`);
  let mutated;
  try {
    mutated = m.apply(SOURCES);
  } catch (e) {
    report("teeth", false, `teeth: "${m.label}" applies (${e instanceof Error ? e.message : e})`);
    continue;
  }
  // Every file the mutation says it edits must change, and no other.
  const named = [m.file].flat();
  const edited = Object.keys(FILES).filter((f) => mutated[f] !== SOURCES[f]);
  const unchanged = named.filter((f) => !tsUsable || baseCode(f) === codeOf(f, mutated[f]));
  report(
    "teeth",
    unchanged.length === 0 && edited.every((f) => named.includes(f)),
    `teeth: "${m.label}" actually changes the code of ${named.join(" and ")}, and nothing else (an edit that applied to nothing, or only to a comment, would prove nothing)${unchanged.length ? ` — unchanged: ${unchanged.join(", ")}` : ""}`,
  );
  const now = redIds(await suite(mutated)).filter((id) => !failing.includes(id));
  const want = [...new Set([...m.flips, ...(m.also ?? [])])].sort().join(", ");
  const got = [...now].sort().join(", ");
  report("teeth", want === got, `teeth: "${m.label}" is caught by exactly the checks that claim to protect it${want === got ? "" : ` (expected red: ${want || "(none)"}; actually red: ${got || "(none)"})`}`);
}
const covered = new Set(MUTATIONS.flatMap((m) => m.flips));
const toothless = ids.filter((id) => !id.startsWith("pre-") && !id.startsWith("threw:") && id !== "bundles" && !covered.has(id));
report("teeth", toothless.length === 0, `every check has a mutation proving it has teeth${toothless.length ? ` (none for: ${toothless.join(", ")})` : ""}`);

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
