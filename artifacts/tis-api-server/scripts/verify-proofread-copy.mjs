/**
 * Guard for the proofread panel on the project page
 * (artifacts/atlanta-tis/src/components/proofread-panel.tsx).
 *
 * Two kinds of assertion, and the second is the one that carries weight:
 *
 *  1. COPY (source text). The product surface is a customer venue, so
 *     TIS-PROOFREAD-PROTOCOL.md's ban on "independent review", "second opinion",
 *     "peer review" and "QA/QC" applies to it. The permitted description is
 *     "an internal consistency and traceability check". A banned phrase is a
 *     property of the text, so a text scan is the right tool for it — and it is
 *     repeated over the RENDERED output of every status, because copy built at
 *     runtime never appears in the source.
 *
 *  2. BEHAVIOUR (rendered). The panel's claims are not strings: "a study that was
 *     never checked is not clean", "findings appear only for a finished run",
 *     "a clause that judged part of the record says so", "an ordinary study is not
 *     presented as an alarm", "a disclosed blocker is still open",
 *     "a study in which no clause could run says nothing was checked", "a run carrying a finding the server withheld
 *     (a DEFECT) is never a clear". A scan for `status === "none"` proves the characters
 *     exist, not that the branch runs before the empty-findings one. So the panel is
 *     bundled with the repo's own esbuild, ProofreadView is rendered with
 *     react-dom/server for each status, and the assertions read what a user would
 *     see. The pass that feeds the "ordinary study" and ordering cases is the REAL
 *     clause pass over a real engine payload, not hand-typed findings.
 *
 * What this cannot see is anything that needs an effect to run — the poll and its
 * re-arm after "Run again", the busy window across the POST, window.prompt. Those
 * live in ProofreadPanel, not ProofreadView. The decision logic they use
 * (dispositionBody, isPending, isFinished) is pulled into lib/proofread.ts and tested
 * here; the wiring itself is pinned by the few source-text assertions marked WIRING,
 * which are the weak kind and were checked in a real browser instead of trusted.
 *
 * Every assertion has been mutation-checked: for each there is a one-line break of the
 * panel or the client module that turns exactly that assertion red. A `threw:` line or a
 * bundle failure is a broken guard, not a caught mutation.
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
const files = [
  "artifacts/atlanta-tis/src/components/proofread-panel.tsx",
  "artifacts/atlanta-tis/src/lib/proofread.ts",
  "artifacts/tis-api-server/src/routes/proofread.ts",
];

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};
/** A group that throws is a FAIL that says so, never a silent pass or a crash that hides the rest. */
const group = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(false, `${name} threw: ${e instanceof Error ? e.message : String(e)}`);
  }
};

// ─── 1. COPY ────────────────────────────────────────────────────────────────────────
const BANNED = ["independent review", "second opinion", "peer review", "QA/QC", "audit"];
for (const rel of files) {
  const txt = readFileSync(path.join(repo, rel), "utf8").toLowerCase();
  for (const phrase of BANNED) ok(!txt.includes(phrase.toLowerCase()), `${rel}: avoids "${phrase}"`);
}

const panel = readFileSync(path.join(repo, files[0]), "utf8");
ok(/internal consistency and traceability check/i.test(panel), "the panel uses the permitted description verbatim");
ok(/status === "none"/.test(panel), "the panel names the never-checked status (the BRANCH is asserted below, by rendering)");
ok(!/\bapply\b|\bfix it\b|\bauto-?fix\b/i.test(panel), "the panel offers no control that changes the study");

// ─── 2. BEHAVIOUR ───────────────────────────────────────────────────────────────────
const ENTRY = `
export { ProofreadView } from "@/components/proofread-panel";
export { createElement } from "react";
export { renderToStaticMarkup } from "react-dom/server";
`;
let bundled;
try {
  bundled = await build({
    stdin: { contents: ENTRY, resolveDir: atlanta, sourcefile: "proofread-entry.ts", loader: "ts" },
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
  });
} catch (e) {
  ok(false, `the panel bundles with esbuild (a broken panel, not a caught mutation): ${(e.errors ?? []).map((x) => x.text).join("; ") || e.message}`);
  console.log(`\n${fails} CHECK(S) FAILED`);
  process.exit(1);
}
const code = bundled.outputFiles[0].text;
const { ProofreadView, createElement, renderToStaticMarkup } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
const lib = await import(pathToFileURL(path.join(atlanta, "src/lib/proofread.ts")).href);

const warnings = [];
const realError = console.error;
console.error = (...a) => warnings.push(a.map(String).join(" ").slice(0, 200));
const view = (run, o = {}) =>
  renderToStaticMarkup(createElement(ProofreadView, { run, error: null, busy: false, onRerun() {}, onTriage() {}, ...o }));

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
const summaryTag = (html) => /<p\b([^>]*data-testid="proofread-summary"[^>]*)>([^<]*)<\/p>/.exec(html);
const summaryOf = (html) => summaryTag(html)?.[2] ?? null;
const summaryRed = (html) => RED.test(summaryTag(html)?.[1] ?? "");
const RED = /text-red-/;
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

// The real pass, over the real engine payload the other proofread guards use.
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
const everyHtml = [];
const keep = (html) => (everyHtml.push(html), html);

await group("precondition", () => {
  ok(
    ordinary.length === 2 && ordinary[0].type === "DISCLOSE" && ordinary[1].type === "NOTE",
    "precondition: the real pass over scenario-base yields the ordinary pair (one DISCLOSE, one NOTE) — fixture or clause changed if red",
  );
  ok(
    realFindings.some((f) => f.type === "BLOCKER"),
    "precondition: the real pass over scenario-base also yields a BLOCKER, so the ordering case below has one to put first",
  );
});

await group("never-checked is not clean", () => {
  const html = keep(view(runOf("none")));
  const t = text(html);
  ok(/has not been checked yet/.test(t), "none: says the study has not been checked");
  ok(!/Nothing flagged/i.test(t), "none: does NOT say nothing was flagged (the empty-findings branch is not reached)");
  ok(!/emerald/.test(html), "none: no green check anywhere");
  ok(!/Checking this study/.test(t), "none: is not shown as in progress either");
  ok(/Run the check/.test(t) && !/Run again/.test(t), "none: the button offers to run the check, not to run it again");
});

await group("findings only for a finished run", () => {
  const withFindings = [mk("a", "DISCLOSE"), mk("b", "NOTE")];
  for (const status of ALL_STATUSES) {
    const html = keep(view(runOf(status, { findings: withFindings })));
    const shown = findingOrder(html).length;
    const expected = FINISHED.includes(status) ? 2 : 0;
    ok(shown === expected, `${status}: renders ${expected} of 2 stored findings (rendered ${shown})`);
    const triage = buttons(html).filter((b) => b.testid?.startsWith("button-disposition-")).length;
    // A DISCLOSE and a NOTE are each offered three decisions.
    ok(triage === (expected ? 6 : 0), `${status}: ${expected ? "offers" : "offers no"} triage controls (${triage} buttons)`);
    // The header is the completion gate as a sentence. Over a DISCLOSE and a NOTE it reads "No open blocker or contested
    // item", which on a run that never finished, with no card beneath it, is a false clear.
    const header = summaryOf(html);
    ok(
      FINISHED.includes(status) ? header !== null : header === null,
      `${status}: ${FINISHED.includes(status) ? "has" : "has NO"} header summary over a stored DISCLOSE + NOTE (${JSON.stringify(header)})`,
    );
  }
  for (const status of PENDING) {
    const t = text(view(runOf(status, { findings: withFindings })));
    ok(/Checking this study/.test(t), `${status}: says the check is in progress`);
    ok(!/Nothing flagged/i.test(text(view(runOf(status)))), `${status}: an empty pending run is not "nothing flagged"`);
  }
  const failed = text(keep(view(runOf("failed", { findings: withFindings }))));
  ok(/did not finish/.test(failed), "failed: says the check did not finish");
  ok(!/Nothing flagged/i.test(text(view(runOf("failed")))), "failed: an empty failed run is not 'nothing flagged'");
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
  ok(/screeningClampDisclosed — 37 of 40 reported delay fields judged/.test(t), "a clause that judged part of the record: its note is rendered beside the result");
  ok(!/growthOverrideDisclosed/.test(t), "a clause that judged all of the record adds no note");
  ok(/1 clause could not run on this study/.test(t) && /criteriaNamed — no agencies on the record/.test(t), "a clause that could not run is listed with its reason");
  ok(/Nothing flagged in the clauses that could run/.test(t), "empty finished run: the scoped sentence, not an unqualified all-clear");
  ok(!/emerald/.test(empty), "empty run with partial coverage: no green check (a check mark claims more than was judged)");
  // The partial-only case, isolated: one clause judged part of the record, no clause was skipped.
  const onlyPartial = [{ clauseId: "screeningClampDisclosed", section: 4, status: "ran", note: "37 of 40 reported delay fields judged" }];
  const po = keep(view(runOf("rules_ready", { coverage: onlyPartial })));
  ok(!/emerald/.test(po) && /Nothing flagged in the clauses that could run/.test(text(po)), "partial coverage and no skipped clause: no green check, and the sentence stays scoped");
  const poH = summaryOf(view(runOf("rules_ready", { coverage: onlyPartial, findings: ordinary }))) ?? "";
  ok(/No open blocker or contested item in the clauses that ran\./.test(poH), `partial coverage and no skipped clause: the header says "in the clauses that ran" (${JSON.stringify(poH)})`);
  const full = keep(view(runOf("rules_ready", { coverage: [{ clauseId: "a", section: 1, status: "ran" }] })));
  ok(/emerald/.test(full) && /Nothing flagged/.test(text(full)), "empty run where every clause judged everything: the green check is earned");
  // With findings: the note still rides along.
  const withF = text(keep(view(runOf("rules_ready", { coverage, findings: [mk("a", "NOTE")] }))));
  ok(/37 of 40 reported delay fields judged/.test(withF), "partial note is shown beside findings too");
  // Not for a run that is not finished.
  for (const status of [...PENDING, "failed", "none"]) {
    const tt = text(view(runOf(status, { coverage })));
    ok(!/37 of 40/.test(tt) && !/could not run/.test(tt), `${status}: a coverage note from an unfinished run is not shown as a result`);
  }
});

await group("nothing was checked is not nothing found", () => {
  const NOTHING = /No clause could run on this study, so nothing was checked\./;
  const twelve = Array.from({ length: 12 }, (_, i) => ({ clauseId: `clause${i}`, section: 1, status: "not-run", reason: "payload predates the field" }));
  for (const [name, coverage] of [["no coverage at all", []], ["every clause not-run (12 of 12)", twelve]]) {
    for (const status of FINISHED) {
      const h = keep(view(runOf(status, { coverage })));
      const t = text(h);
      ok(NOTHING.test(t), `${status}, ${name}: says nothing was checked`);
      ok(!/Nothing flagged/i.test(t), `${status}, ${name}: does NOT say nothing was flagged`);
      ok(!/emerald/.test(h), `${status}, ${name}: no green check`);
    }
  }
  ok(/12 clauses could not run on this study/.test(text(view(runOf("rules_ready", { coverage: twelve })))), "12 of 12 not-run: the list of why is still there");
  // Only for a finished run. runOf's default coverage is a clause that ran, so these use the empty and the all-not-run
  // coverage explicitly: that is the coverage a never-checked, queued, running or failed row actually carries.
  for (const status of ["none", ...PENDING, "failed"]) {
    for (const [name, coverage] of [["no coverage", []], ["12 of 12 not-run", twelve]]) {
      const t = text(keep(view(runOf(status, { coverage }))));
      ok(!NOTHING.test(t), `${status}, ${name}: the nothing-checked sentence is for a finished run only (rendered: ${JSON.stringify(t.slice(t.indexOf("Run ")).slice(0, 110))})`);
    }
  }
  ok(/has not been checked yet/.test(text(view(runOf("none", { coverage: [] })))), "none, no coverage: still says it has not been checked yet");
  // The header, were there anything under it, is scoped too.
  ok(/in the clauses that ran/.test(summaryOf(view(runOf("rules_ready", { coverage: [], findings: ordinary }))) ?? ""), "no coverage: a header over findings is scoped to the clauses that ran");
  // A run in which something did run keeps the old wording.
  ok(!NOTHING.test(text(view(runOf("rules_ready", { coverage: [...twelve, { clauseId: "x", section: 1, status: "ran" }] })))), "one clause ran: it is not 'nothing was checked'");
});

// ─── a finding the server withheld ──────────────────────────────────────────────────
// GET never sends a finding whose audience is admin (a DEFECT: a software fault, routed to
// the software team) and says only how many there are (`withheld`). A DEFECT holds the study
// until a re-run no longer raises it, so a run carrying one is never read as clear: before this,
// a run whose only finding was a DEFECT rendered "Nothing flagged" under a green check.
await group("a finding routed to the software team is never a clear", async () => {
  const ROUTED_1 = "1 item on this study was routed to the software team. Hold the study until a re-run no longer raises it.";
  const ROUTED_2 = "2 items on this study were routed to the software team. Hold the study until a re-run no longer raises them.";
  const routedOf = (html) => /<p\b[^>]*data-testid="proofread-withheld"[^>]*>([^<]*)<\/p>/.exec(html)?.[1] ?? null;
  for (const status of FINISHED) {
    // The case that was a false clear: nothing visible, full coverage, one withheld.
    const h = keep(view(runOf(status, { withheld: 1 })));
    const t = text(h);
    ok(!/Nothing flagged/i.test(t), `${status}, 1 withheld and nothing visible: does NOT say nothing was flagged`);
    ok(!/emerald/.test(h), `${status}, 1 withheld and nothing visible: no green check`);
    ok(!/nothing was checked/.test(t), `${status}, 1 withheld and nothing visible: does not say nothing was checked either (a clause ran, and raised it)`);
    ok(routedOf(h) === ROUTED_1 && RED.test(/<p\b[^>]*data-testid="proofread-withheld"[^>]*>/.exec(h)?.[0] ?? ""), `${status}, 1 withheld: says, in red, that it was routed to the software team and holds the study (${JSON.stringify(routedOf(h))})`);
    const s1 = summaryOf(h) ?? "";
    ok(
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
    ok(zero === absent && routedOf(zero) === null && !/software team/.test(text(zero)), `withheld 0, ${name}: the panel is unchanged — the same markup as a run that carries no count, and no routed line`);
  }
  ok(/emerald/.test(view(runOf("rules_ready", { withheld: 0 }))) && /Nothing flagged/.test(text(view(runOf("rules_ready", { withheld: 0 })))), "withheld 0, full coverage, nothing found: the green check is still earned");

  const two = keep(view(runOf("rules_ready", { withheld: 2 })));
  ok(routedOf(two) === ROUTED_2, `2 withheld: the line is plural (${JSON.stringify(routedOf(two))})`);
  ok(/^2 open items to resolve before this study is called complete\.$/.test(summaryOf(two) ?? ""), `2 withheld: the header counts both (${JSON.stringify(summaryOf(two))})`);

  // Every visible item decided: never "Every item has a recorded decision" over a withheld one.
  const decided = keep(view(runOf("rules_ready", { withheld: 1, findings: [mk("d1", "DISCLOSE")], dispositions: [{ findingId: "f-d1", disposition: "DISCLOSED", note: null, sourceLabel: null, createdAt: "2026-10-06T12:00:00Z" }] })));
  const ds = summaryOf(decided) ?? "";
  ok(!/Every item has a recorded decision/.test(ds) && /^1 open item to resolve before this study is called complete\.$/.test(ds) && summaryRed(decided), `every visible item decided, 1 withheld: the header does not say every item has a recorded decision (${JSON.stringify(ds)})`);
  ok(routedOf(decided) === ROUTED_1 && findingOrder(decided).join(",") === "d1", "every visible item decided, 1 withheld: the visible finding is still shown, and the routed line beside it");

  // An ordinary study with a withheld item is not "No open blocker or contested item".
  const ord = keep(view(runOf("rules_ready", { withheld: 1, findings: ordinary })));
  const os = summaryOf(ord) ?? "";
  ok(!/No open blocker/.test(os) && /^1 open item to resolve before this study is called complete\. Also: 1 to state in the deliverable, 1 note\.$/.test(os), `an ordinary DISCLOSE + NOTE and 1 withheld: the header is the hold, not the quiet sentence (${JSON.stringify(os)})`);

  // Scoped coverage does not turn a withheld item back into a clear or into "nothing checked".
  for (const [name, coverage] of [
    ["partial coverage", [{ clauseId: "a", section: 4, status: "ran", note: "3 of 4 judged" }]],
    ["a clause that could not run", [...FULL_COVERAGE, { clauseId: "b", section: 5, status: "not-run", reason: "r" }]],
    ["no coverage recorded", []],
  ]) {
    const h = keep(view(runOf("rules_ready", { withheld: 1, coverage })));
    const t = text(h);
    ok(!/Nothing flagged|nothing was checked/.test(t) && !/emerald/.test(h) && routedOf(h) === ROUTED_1, `1 withheld, ${name}: neither "nothing flagged" nor "nothing was checked", no green check, and the routed line`);
  }
  // Only a finished run's result is shown.
  for (const status of ["none", ...PENDING, "failed"]) {
    const h = keep(view(runOf(status, { withheld: 1 })));
    ok(routedOf(h) === null && summaryOf(h) === null, `${status}, 1 withheld: no routed line and no header (an unfinished run shows no result)`);
  }

  // The client module: summarizeOpen counts withheld as holds; fetchProofread carries the count.
  const sw = lib.summarizeOpen([], [], 1);
  ok(sw.total === 1 && sw.open === 1 && sw.holds === 1 && sw.withheld === 1, `summarizeOpen([], [], 1) counts the withheld finding as an open hold (got ${JSON.stringify(sw)})`);
  const s0 = lib.summarizeOpen([mk("a", "NOTE")], []);
  ok(s0.total === 1 && s0.open === 1 && s0.holds === 0 && s0.withheld === 0 && s0.note === 1, `summarizeOpen without a count is unchanged (got ${JSON.stringify(s0)})`);
  ok([-1, 1.5, NaN, undefined].every((w) => lib.summarizeOpen([], [], w).holds === 0), "summarizeOpen ignores a count that is not a whole number above 0");
  ok(typeof lib.withheldLine === "function" && lib.withheldLine(1) === ROUTED_1 && lib.withheldLine(2) === ROUTED_2, "withheldLine says it once, pluralised");
  const realFetch = globalThis.fetch;
  try {
    const got = [];
    for (const w of [3, 0, undefined, "1", -2, 1.5, null]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ status: "rules_ready", runId: "r", coverage: [], findings: [], dispositions: [], ...(w === undefined ? {} : { withheld: w }) }), { status: 200 });
      got.push((await lib.fetchProofread("proj-1")).withheld);
    }
    ok(JSON.stringify(got) === "[3,0,0,0,0,0,0]", `fetchProofread carries the server's count, and anything that is not a whole number above 0 is 0 (got ${JSON.stringify(got)})`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await group("order and tone: an ordinary study is not an alarm", () => {
  // The server order is by clause; the panel must not trust it.
  const shuffled = [
    mk("n1", "NOTE"),
    mk("u1", "UNVERIFIED"),
    mk("d1", "DISCLOSE"),
    mk("c1", "CONTESTED"),
    mk("b1", "BLOCKER"),
    mk("n2", "NOTE"),
    mk("d2", "DISCLOSE"),
  ];
  const order = findingOrder(keep(view(runOf("rules_ready", { findings: shuffled }))));
  ok(
    order.join(",") === "c1,b1,d1,d2,n1,n2,u1",
    `BLOCKER and CONTESTED first (one tier, server order kept: c1 was sent before b1), then DISCLOSE, then NOTE, UNVERIFIED last (got ${order.join(",")})`,
  );
  // The real pass happens to arrive in severity order already, so hand it over reversed.
  const real = findingOrder(keep(view(runOf("rules_ready", { findings: [...realFindings].reverse() }))));
  const types = real.map((id) => realFindings.find((f) => f.clauseId === id).type);
  ok(
    types.join(" > ") === "BLOCKER > BLOCKER > DISCLOSE > NOTE",
    `the real pass, handed over reversed, renders in severity order (${types.join(" > ")})`,
  );

  const html = keep(view(runOf("rules_ready", { findings: ordinary })));
  const t = text(html);
  const s = summaryOf(html);
  ok(findingOrder(html).length === 2, "ordinary study: both findings are still shown (nothing is suppressed)");
  ok(!RED.test(html), "ordinary study (one DISCLOSE, one NOTE): nothing on the panel is red");
  ok(s !== null && /No open blocker or contested item/.test(s), `ordinary study: the header says no blocker or contested item is open (${JSON.stringify(s)})`);
  ok(s !== null && /1 to state in the deliverable/.test(s) && /1 note\b/.test(s), "ordinary study: the header counts what is to be said and what is to be carried");
  ok(
    /text-amber-600/.test(card(html, "screeningClampDisclosed")) && /text-yellow-600/.test(card(html, "scopeNoteConsistent")),
    "ordinary study: the DISCLOSE card is amber and the NOTE card yellow — the 'moderate' and 'minor' severity colours",
  );
  ok(
    /text-red-600/.test(card(view(runOf("rules_ready", { findings: [mk("b1", "BLOCKER")] })), "b1")),
    "a BLOCKER card is red — the 'major' colour is kept for what holds the study",
  );
  ok(!/to resolve before/.test(t), "ordinary study: nothing is described as to be resolved before completion");

  const hedged = summaryOf(view(runOf("rules_ready", { findings: ordinary, coverage: [{ clauseId: "x", section: 1, status: "not-run", reason: "r" }] })));
  ok(hedged !== null && /No open blocker or contested item in the clauses that ran\./.test(hedged), "a study some clauses could not judge: 'no open blocker' is scoped to the clauses that ran");
  ok(!/in the clauses that ran/.test(s ?? ""), "a study every clause judged: the header is not hedged");

  const hold = keep(view(runOf("rules_ready", { findings: [mk("b1", "BLOCKER"), mk("d1", "DISCLOSE")] })));
  const hs = summaryOf(hold);
  ok(hs !== null && /1 open item to resolve before this study is called complete/.test(hs) && summaryRed(hold), `a BLOCKER open: the header says so, in red (${JSON.stringify(hs)})`);
  ok(!summaryRed(html), "ordinary study: the header itself is not red");
  const cont = summaryOf(view(runOf("rules_ready", { findings: [mk("c1", "CONTESTED")] })));
  ok(cont !== null && /1 open item to resolve/.test(cont), "a CONTESTED item open counts the same as a BLOCKER");

  const decided = view(
    runOf("rules_ready", {
      findings: [mk("b1", "BLOCKER"), mk("d1", "DISCLOSE")],
      dispositions: [{ findingId: "f-b1", disposition: "FIXED", note: null, sourceLabel: null, createdAt: "2026-10-06T12:00:00Z" }],
    }),
  );
  const ds = summaryOf(decided);
  ok(ds !== null && /No open blocker or contested item/.test(ds) && /1 to state/.test(ds), `a BLOCKER with a recorded decision is no longer open (${JSON.stringify(ds)})`);
  ok(/Recorded:/.test(text(decided)) && /FIXED/.test(text(decided)), "a decided finding shows what was recorded");
  const allDecided = summaryOf(
    view(runOf("rules_ready", { findings: [mk("d1", "DISCLOSE")], dispositions: [{ findingId: "f-d1", disposition: "DISCLOSED", note: null, sourceLabel: null, createdAt: "2026-10-06T12:00:00Z" }] })),
  );
  ok(allDecided !== null && /Every item has a recorded decision/.test(allDecided), "every item decided: the header says so");
  ok(summaryOf(view(runOf("rules_ready"))) === null && summaryOf(view(runOf("queued", { findings: ordinary }))) === null, "no header summary for an empty run or a run in progress");
});

await group("what each finding reads, and the only controls", () => {
  const f = mk("a", "DISCLOSE", {
    readPaths: Array.from({ length: 8 }, (_, i) => ({ path: `result.rows[${i}].delay`, value: 300 })),
  });
  // Two reads of the same path (two scenarios, two periods) are two lines, not one and a key collision.
  const dupRun = runOf("rules_ready", { findings: [mk("t", "NOTE", { readPaths: [{ path: "result.dup", value: 1 }, { path: "result.dup", value: 2 }] })] });
  const twice = text(keep(view(dupRun)));
  ok(/result\.dup = 1/.test(twice) && /result\.dup = 2/.test(twice), "two reads of the same path are both shown");
  const dupes = duplicateKeys(ProofreadView({ run: dupRun, error: null, busy: false, onRerun() {}, onTriage() {} }));
  ok(dupes.length === 0, `two reads of the same path do not collide on a React key${dupes.length ? ` (${dupes.join(", ")})` : ""}`);
  ok(duplicateKeys([createElement("i", { key: "a" }), createElement("i", { key: "a" })]).length === 1, "precondition: the key walker does report a collision when there is one");
  const html = keep(view(runOf("rules_ready", { findings: [f] })));
  const t = text(html);
  ok(/Checked against: a source/.test(t), "a finding names the source it was checked against");
  ok(/result\.rows\[5\]\.delay = 300/.test(t) && !/result\.rows\[6\]\.delay/.test(t) && /and 2 more values/.test(t), "a finding shows the first six values it read and counts the rest");
  const labels = buttons(html).map((b) => b.label);
  ok(
    labels.join("|") === "Run again|Disclosed in the deliverable|Fixed|Withdrawn on a source",
    `the only controls on a DISCLOSE are re-run and three that record a decision (${labels.join(" | ")})`,
  );
  ok(!/ACCEPTED_RISK|CONTESTED_PE|accepted risk|sealing/i.test(html), "the panel does not offer the two decisions only the sealing engineer may record");
  ok(!/<a\b|<form\b|<input\b|<select\b|<textarea\b/.test(html), "no link, form or field on the panel: nothing to navigate to or to edit with");
});

await group("a finding type this client does not know", () => {
  const html = keep(view(runOf("rules_ready", { findings: [mk("n1", "NOTE"), mk("z1", "SOMETHING_NEW")] })));
  ok(findingOrder(html).join(",") === "z1,n1", "an unclassified finding is shown, and first — not buried and not a crash");
  ok(/SOMETHING_NEW/.test(text(html)), "an unclassified finding is labelled with its own type");
  ok(/to resolve before/.test(summaryOf(html) ?? ""), "an unclassified finding is counted with what needs a look");
  ok(
    buttons(card(html, "z1")).map((b) => b.label).join("|") === "Fixed|Withdrawn on a source",
    "an unclassified finding is offered the strictest set (what a BLOCKER is offered), not none and not the loosest",
  );
});

// ─── what is offered per type, and what closes it ───────────────────────────────────
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

await group("decisions offered per finding type", () => {
  const everyLabel = [];
  for (const type of Object.keys(OFFERED)) {
    const html = keep(view(runOf("rules_ready", { findings: [mk("x", type)] })));
    const labels = buttons(card(html, "x")).map((b) => b.label);
    everyLabel.push(...labels);
    ok(
      labels.join("|") === OFFERED[type].map((d) => DECISION_LABEL[d]).join("|"),
      `${type}: offered ${OFFERED[type].length ? OFFERED[type].map((d) => DECISION_LABEL[d]).join(", ") : "no decisions"} (got ${labels.join(", ") || "none"})`,
    );
  }
  ok(!everyLabel.some((l) => /bug/i.test(l)), "no finding type is offered 'Bug filed': that is a DEFECT's decision and a DEFECT never reaches an engineer");
  const all = everyHtml.join("\n");
  ok(!/button-disposition-(bug_filed|accepted_risk|contested_pe)/.test(all), "no rendered state carries a BUG_FILED, ACCEPTED_RISK or CONTESTED_PE control");
  const contested = text(card(view(runOf("rules_ready", { findings: [mk("x", "CONTESTED")] })), "x"));
  ok(/Awaiting the sealing engineer's ruling/.test(contested), "a CONTESTED item says it awaits the sealing engineer's ruling, in place of buttons");
  ok(!/Awaiting/.test(text(card(view(runOf("rules_ready", { findings: [mk("x", "BLOCKER")] })), "x"))), "only a CONTESTED item says that");
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
    ok(wrong.length === 0, `${type}: the header and the card agree on what the 7 possible records mean${wrong.length ? ` — ${wrong.join("; ")}` : ""}`);
    if (wrong.length) bad.push(type);
  }
  // The case that matters, named: a disclosed wrong number is still a wrong number.
  const disclosed = keep(view(runOf("rules_ready", { findings: [mk("x", "BLOCKER")], dispositions: [recorded("f-x", "DISCLOSED")] })));
  const ds = summaryOf(disclosed) ?? "";
  ok(/^1 open item to resolve before this study is called complete\./.test(ds) && !/No open blocker/.test(ds), `a BLOCKER marked Disclosed still reads as open (${JSON.stringify(ds)})`);
  const dc = text(card(disclosed, "x"));
  ok(/Recorded: DISCLOSED/.test(dc) && /does not close a blocker/.test(dc), "its card shows what was recorded and says that does not close a blocker");
  ok(buttons(card(disclosed, "x")).map((b) => b.label).join("|") === "Fixed|Withdrawn on a source", "and it is still offered the two decisions that do");
  const fixed = keep(view(runOf("rules_ready", { findings: [mk("x", "BLOCKER")], dispositions: [recorded("f-x", "FIXED")] })));
  ok(/^Every item has a recorded decision\.$/.test(summaryOf(fixed) ?? "") && buttons(card(fixed, "x")).length === 0, "a BLOCKER marked Fixed is closed: the header says so and its controls go");
  // The latest decision rules, wherever it sits in the list.
  const latest = (list) => summaryOf(view(runOf("rules_ready", { findings: [mk("x", "BLOCKER")], dispositions: list }))) ?? "";
  const FIXED_OLD = recorded("f-x", "FIXED", "2026-10-06T10:00:00Z");
  const DISC_NEW = recorded("f-x", "DISCLOSED", "2026-10-06T11:00:00Z");
  ok(/^1 open item to resolve/.test(latest([FIXED_OLD, DISC_NEW])) && /^1 open item to resolve/.test(latest([DISC_NEW, FIXED_OLD])), "BLOCKER fixed, then disclosed: the later decision rules, in either list order, and it is open");
  const DISC_OLD = recorded("f-x", "DISCLOSED", "2026-10-06T10:00:00Z");
  const FIXED_NEW = recorded("f-x", "FIXED", "2026-10-06T11:00:00Z");
  ok(/^Every item has a recorded decision\.$/.test(latest([DISC_OLD, FIXED_NEW])) && /^Every item has a recorded decision\.$/.test(latest([FIXED_NEW, DISC_OLD])), "BLOCKER disclosed, then fixed: the later decision rules, in either list order, and it is closed");
  // Two findings: one closed does not close the other.
  const two = summaryOf(view(runOf("rules_ready", { findings: [mk("a", "BLOCKER"), mk("b", "BLOCKER")], dispositions: [recorded("f-a", "FIXED"), recorded("f-b", "DISCLOSED")] }))) ?? "";
  ok(/^1 open item to resolve/.test(two), `one blocker fixed and one disclosed leaves one open (${JSON.stringify(two)})`);
  ok(bad.length === 0, "every type reads consistently");
});

await group("busy", () => {
  const run = runOf("rules_ready", { findings: [mk("a", "NOTE")] });
  const idle = buttons(view(run));
  const busy = view(run, { busy: true });
  const bb = buttons(busy);
  ok(idle.every((b) => !b.disabled), "idle: every control is enabled");
  ok(bb.length === idle.length && bb.every((b) => b.disabled), "busy: the re-run button AND every triage button are disabled (a second press cannot fire)");
  ok(/animate-spin/.test(bb.find((b) => b.testid === "button-proofread-rerun").inner), "busy: the re-run button shows progress");
  ok(!/animate-spin/.test(idle.find((b) => b.testid === "button-proofread-rerun").inner), "idle: the re-run button shows no progress");
});

await group("a load that failed is not an absent panel", () => {
  ok(view(null) === "", "still loading: nothing is drawn");
  const html = keep(view(null, { error: "HTTP 500" }));
  ok(/HTTP 500/.test(text(html)) && /Consistency check/.test(text(html)), "first load failed: the panel is drawn and says why (a vanished panel looks like no check exists)");
  ok(!/Nothing flagged|has not been checked/.test(text(html)), "first load failed: it does not claim a result either way");
  const later = text(view(runOf("rules_ready", { findings: [mk("a", "NOTE")] }), { error: "HTTP 429" }));
  ok(/HTTP 429/.test(later), "an error after a successful load is shown above the last result");
});

await group("rendered copy", () => {
  const all = everyHtml.join("\n").toLowerCase();
  ok(everyHtml.length >= 15, `rendered ${everyHtml.length} states (a guard that rendered nothing proves nothing)`);
  ok(
    everyHtml.every((h) => /internal consistency and traceability check/.test(text(h))),
    "every rendered state describes the check as 'an internal consistency and traceability check' (the source line above can be satisfied by a comment)",
  );
  for (const phrase of BANNED) ok(!all.includes(phrase.toLowerCase()), `rendered output of every state avoids "${phrase}"`);
  ok(!/\bapply\b|\bfix it\b|\bauto-?fix\b/i.test(text(everyHtml.join("\n"))), "rendered output offers no apply / fix-it / auto-fix control");
  ok(warnings.length === 0, `rendering raised no React warnings${warnings.length ? `: ${warnings[0]}` : ""}`);
});

await group("the decision shown at once is the decision recorded", () => {
  ok(typeof lib.withRecordedDecision === "function", "lib/proofread.ts exports withRecordedDecision");
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
    /^2 open items to resolve before this study is called complete\./.test(summaryOf(view(base)) ?? ""),
    `precondition: before the decision both blockers are open — an older Disclosed closes neither (${JSON.stringify(summaryOf(view(base)))})`,
  );
  for (const [name, body, wantSource] of [
    ["Fixed", { disposition: "FIXED" }, null],
    // The body the panel really builds: the prompt's answer arrives padded and leaves trimmed.
    ["Withdrawn on a named source", lib.dispositionBody("WITHDRAWN", () => "  HCM 7th ed.  "), "HCM 7th ed."],
  ]) {
    let after;
    try {
      after = lib.withRecordedDecision(base, "run-A", finding, body, NOW);
    } catch (e) {
      ok(false, `${name}: withRecordedDecision leaves the run it was handed alone (it threw on the frozen run: ${e instanceof Error ? e.message : e})`);
      continue;
    }
    ok(
      isDeepStrictEqual(rest(after), rest(base)),
      `${name}: apart from its dispositions, the run handed back IS the run handed in — every finding (the other open blocker included), its status, its id, its coverage`,
    );
    const latest = lib.latestDisposition(after.dispositions, finding.id);
    // Not read back through latestDisposition(finding.id): that can only ever return a record of that finding, so a record
    // written against the wrong one would go unseen (the older record would answer instead).
    const added = after.dispositions.filter((d) => !base.dispositions.includes(d));
    ok(added.length === 1 && added[0].findingId === finding.id, `${name}: exactly one record was added, on the finding that was pressed (got ${added.map((d) => d.findingId).join(", ") || "none"})`);
    ok(latest?.disposition === body.disposition, `${name}: the record is the decision that was recorded, not another (got ${latest?.disposition})`);
    ok(latest?.sourceLabel === wantSource, `${name}: the record carries the source named, or none (got ${JSON.stringify(latest?.sourceLabel)})`);
    ok(latest?.createdAt === NOW.toISOString(), `${name}: the record is stamped now, so it is the latest and beats the older one (got ${latest?.createdAt})`);
    ok(latest?.note === null, `${name}: the record carries no note`);
    ok(lib.closes(finding.type, latest?.disposition), `${name}: it closes the blocker`);
    ok(after.dispositions.includes(older) && after.dispositions.includes(other) && after.dispositions.length === 3, `${name}: the other records are kept`);
    ok(base.dispositions.length === 2 && after !== base, `${name}: the run it was handed is not changed`);
    const html = keep(view(after));
    const c = text(card(html, "x"));
    ok(buttons(card(html, "x")).length === 0 && new RegExp(`Recorded: ${body.disposition}`).test(c), `${name}: rendered, the card shows Recorded: ${body.disposition} and no controls (${JSON.stringify(c.slice(-60))})`);
    ok(!wantSource || c.includes(wantSource), `${name}: rendered, the card names the source`);
    ok(
      /^1 open item to resolve before this study is called complete\./.test(summaryOf(html) ?? "") && summaryRed(html),
      `${name}: rendered, the header has moved from two open blockers to one, in red — never "Every item has a recorded decision" while the other blocker is open (${JSON.stringify(summaryOf(html))})`,
    );
    ok(
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
  ok(untouched(base, "run-B"), "a decision recorded on another run does not touch this one (the previous project's run, or a newer revision)");
  const neverChecked = deepFreeze(runOf("none", { runId: undefined, coverage: [] }));
  ok(untouched(neverChecked, "run-A"), "a decision recorded on run-A does not touch a run with no id (the next project, never checked)");
  for (const noId of [undefined, null, ""]) {
    ok(
      untouched(base, noId) && untouched(neverChecked, noId),
      `a decision with no run id (${JSON.stringify(noId)}) touches no run — not run-A, and not a run that has no id either`,
    );
  }
});

// ─── 3. THE CLIENT MODULE ───────────────────────────────────────────────────────────
await group("client module", async () => {
  ok(
    typeof lib.isPending === "function" && typeof lib.isFinished === "function" && typeof lib.dispositionBody === "function",
    "lib/proofread.ts exports isPending, isFinished and dispositionBody",
  );
  ok(
    typeof lib.closes === "function" && typeof lib.offeredFor === "function" && typeof lib.latestDisposition === "function",
    "lib/proofread.ts exports offeredFor, closes and latestDisposition",
  );
  for (const type of Object.keys(OFFERED)) {
    ok(JSON.stringify(lib.offeredFor(type)) === JSON.stringify(OFFERED[type]), `offeredFor(${type}) is [${OFFERED[type]}]`);
    const closing = DECISIONS.filter((d) => lib.closes(type, d));
    ok(JSON.stringify(closing) === JSON.stringify(DECISIONS.filter((d) => CLOSED_BY[type].includes(d))), `closes(${type}, ·) is true for exactly [${CLOSED_BY[type]}] (got [${closing}])`);
  }
  ok(lib.closes("BLOCKER", undefined) === false && lib.closes("NOTE", "") === false && lib.closes("NOTE", "nonsense") === false, "closes: no decision, an empty one and an unknown one close nothing");
  ok(
    lib.latestDisposition([recorded("a", "FIXED", "2026-10-06T10:00:00Z"), recorded("a", "DISCLOSED", "2026-10-06T11:00:00Z"), recorded("b", "WITHDRAWN")], "a")?.disposition === "DISCLOSED" &&
      lib.latestDisposition([], "a") === undefined,
    "latestDisposition picks the newest by time for that finding, not by position",
  );
  for (const s of ALL_STATUSES) {
    ok(lib.isPending(s) === PENDING.includes(s), `isPending(${s}) is ${PENDING.includes(s)}`);
    ok(lib.isFinished(s) === FINISHED.includes(s), `isFinished(${s}) is ${FINISHED.includes(s)}`);
  }
  // The Task 7 hand-off: an empty sourceLabel on a non-WITHDRAWN disposition is a 400, so none is sent;
  // WITHDRAWN with nothing named records nothing.
  let asked = 0;
  const ask = (v) => () => (asked++, v);
  for (const d of ["FIXED", "DISCLOSED", "BUG_FILED"]) {
    asked = 0;
    const body = lib.dispositionBody(d, ask("should never be read"));
    ok(body && body.disposition === d && !("sourceLabel" in body) && asked === 0, `${d}: sends no sourceLabel at all and never prompts`);
    ok(JSON.stringify(body) === `{"disposition":"${d}"}`, `${d}: the JSON body is the disposition alone`);
  }
  ok(lib.dispositionBody("WITHDRAWN", ask(null)) === null, "WITHDRAWN, prompt cancelled: records nothing");
  ok(lib.dispositionBody("WITHDRAWN", ask(undefined)) === null, "WITHDRAWN, no answer: records nothing");
  ok(lib.dispositionBody("WITHDRAWN", ask("")) === null, "WITHDRAWN, empty answer: records nothing");
  ok(lib.dispositionBody("WITHDRAWN", ask("   ")) === null, "WITHDRAWN, blank answer: records nothing");
  const w = lib.dispositionBody("WITHDRAWN", ask("  HCM 7th ed. Ch. 19  "));
  ok(w && w.disposition === "WITHDRAWN" && w.sourceLabel === "HCM 7th ed. Ch. 19", "WITHDRAWN with a named source: sends it, trimmed");

  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ ok: true, status: "none" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const RUN = "0b1f6c2e-8f4d-4c1e-9a55-6f1d2f9a7c10";
    const FID = "5d1c3f5e-0a52-4a6a-8d0c-3b7e2b0e9f11";
    await lib.recordDisposition("proj-1", RUN, FID, lib.dispositionBody("FIXED", ask("x")));
    const c = calls[0];
    ok(c.url === `/tis-api/projects/proj-1/proofread/${RUN}/findings/${FID}/dispositions`, "a disposition posts to the run's uuid and the finding's id");
    ok(c.init.method === "POST" && c.init.body === '{"disposition":"FIXED"}', "a disposition body has no sourceLabel key");
    const got = await lib.fetchProofread("proj-1");
    ok(got.status === "none" && Array.isArray(got.coverage) && Array.isArray(got.findings), "fetchProofread defaults a missing list to []");
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    ok((await lib.fetchProofread("proj-1")).status === "none", "fetchProofread: a response with no status is 'none', never a result");
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ status: "rules_ready", runId: RUN, revision: 3, coverage: { oops: 1 }, findings: null }), { status: 200 });
    const odd = await lib.fetchProofread("proj-1");
    ok(odd.runId === RUN && Array.isArray(odd.coverage) && odd.coverage.length === 0 && odd.findings.length === 0, "fetchProofread carries the run's uuid and never hands the panel a non-array");
    // Rendered inside a try so that a run the panel cannot read fails THIS line instead of ending the group.
    let rendered = "(the panel threw)";
    try {
      rendered = text(view(odd));
    } catch (e) {
      rendered = `(the panel threw: ${e instanceof Error ? e.message : e})`;
    }
    ok(/No clause could run on this study, so nothing was checked\./.test(rendered) && !/Nothing flagged/.test(rendered), "a finished run the server sent with no usable coverage renders as nothing checked, end to end");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ─── a decision on a run that has been superseded ───────────────────────────────────
// The route answers 409 when the run on screen is no longer the project's newest finished run
// (the check was run again). Nothing was recorded, so the panel must not keep showing the old
// run as if it were current: it refetches and says why the decision did not stick. The refetch
// is the stateful wrapper's (pinned under WIRING); what a 409 IS, and what the panel then says,
// is decided here, in the client module, and tested by behaviour.
await group("a decision refused because the check was run again", async () => {
  ok(
    typeof lib.isSuperseded === "function" && typeof lib.ProofreadRequestError === "function" && typeof lib.SUPERSEDED_NOTICE === "string",
    "lib/proofread.ts exports isSuperseded, ProofreadRequestError and SUPERSEDED_NOTICE",
  );
  if (typeof lib.isSuperseded !== "function") return; // the line above is the red; the rest would only add a TypeError
  const realFetch = globalThis.fetch;
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
  ok(e409 !== null && lib.isSuperseded(e409) === true, "a 409 from the disposition route is recognised as a superseded run");
  ok(e409?.status === 409 && e409?.message === SERVER_409, `the refusal carries its status and the server's sentence (got ${e409?.status}, ${JSON.stringify(e409?.message)})`);
  for (const [status, body, want] of [
    [422, { error: "This decision does not apply to this finding." }, "This decision does not apply to this finding."],
    [404, { error: "Finding not found." }, "Finding not found."],
    [500, undefined, "HTTP 500"],
    [429, { error: "Too many decisions recorded." }, "Too many decisions recorded."],
  ]) {
    const e = await refusal(status, body);
    ok(e !== null && lib.isSuperseded(e) === false && e.status === status && e.message === want, `a ${status} is a refusal, NOT a superseded run, and keeps its message (got ${e?.status}, ${JSON.stringify(e?.message)})`);
  }
  ok((await refusal(200, { ok: true })) === null, "a 200 is not a refusal");
  ok(
    [new Error("HTTP 409"), { status: 409 }, null, undefined, "409", 409].every((x) => lib.isSuperseded(x) === false),
    "only a refusal the client itself built from a 409 counts: an Error whose text says 409, a bare { status: 409 }, a string or a number do not",
  );
  const html = keep(view(runOf("rules_ready", { findings: [mk("a", "NOTE")] }), { error: lib.SUPERSEDED_NOTICE }));
  const t = text(html);
  ok(t.includes(lib.SUPERSEDED_NOTICE) && /not recorded/.test(lib.SUPERSEDED_NOTICE), `rendered, the panel says the decision was not recorded and why (${JSON.stringify(lib.SUPERSEDED_NOTICE)})`);
  ok(BANNED.every((p) => !t.toLowerCase().includes(p.toLowerCase())), "that state's rendered copy avoids the banned phrases");
});

// ─── the panel offers exactly what the server accepts ───────────────────────────────
// The disposition route refuses, with a 422, a decision the finding's type is not offered in
// the contract's OFFERED_DISPOSITIONS (lib/tis-api-zod/src/proofread.ts). The panel does not
// import that module — atlanta-tis does not depend on @workspace/tis-api-zod, and the panel
// bundle stays free of zod — so it keeps its own OFFERED, and this pins the two equal: a button
// the server would refuse, or a decision the server takes that no button offers, is a drift.
await group("the panel offers exactly what the server accepts", async () => {
  const contract = await import(pathToFileURL(path.join(repo, "lib/tis-api-zod/src/proofread.ts")).href);
  const server = contract.OFFERED_DISPOSITIONS;
  const mine = lib.OFFERED;
  ok(!!server && typeof server === "object" && !!mine && typeof mine === "object", "the contract exports OFFERED_DISPOSITIONS and lib/proofread.ts exports OFFERED");
  const keys = (m) => Object.keys(m ?? {}).sort().join(",");
  ok(keys(server) === keys(mine) && Object.keys(server ?? {}).length === 6, `the panel and the server name the same six finding types (panel: ${keys(mine)}; server: ${keys(server)})`);
  for (const t of new Set([...Object.keys(server ?? {}), ...Object.keys(mine ?? {})])) {
    const a = [...(mine?.[t] ?? [])].sort().join(",");
    const b = [...(server?.[t] ?? [])].sort().join(",");
    ok(a === b && (mine?.[t] ?? []).length === (server?.[t] ?? []).length, `${t}: the panel offers [${a}] and the server accepts [${b}]`);
  }
});

// ─── 4. WIRING (source text — the weak kind; see the header) ─────────────────────────
await group("wiring", () => {
  ok(/\}, \[projectId, nonce\]\);/.test(panel), "WIRING: the poll effect depends on nonce, so a re-run re-arms it");
  ok(/await requestProofread\(projectId\);\s*setError\(null\);\s*setNonce\(/.test(panel), "WIRING: a successful re-run request bumps the nonce");
  ok(/const runId = run\.runId;/.test(panel) && /recordDisposition\(projectId, runId, f\.id, body\)/.test(panel) && !/recordDisposition\([^)]*revision/.test(panel), "WIRING: a decision is recorded against the run's uuid, not its revision");
  ok(/dispositionBody\(/.test(panel), "WIRING: the panel builds the decision body with dispositionBody");
  ok(
    /await recordDisposition\(projectId, runId, f\.id, body\);[\s\S]*?setNonce\(/.test(panel) && !/setRun\(await fetchProofread/.test(panel),
    "WIRING: a recorded decision refetches through the effect (setNonce), not a one-off fetch that bypasses the poll and its cancellation",
  );
  ok(
    /await recordDisposition\([^;]*;[\s\S]*?setRun\(\(prev\) => \(prev \? withRecordedDecision\(prev, runId, f, body, new Date\(\)\) : prev\)\);[\s\S]*?setNonce\(/.test(panel),
    "WIRING: after the POST succeeds, a recorded decision is shown at once through withRecordedDecision, before the refetch (two presses in the window before it landed both reached the server)",
  );
  ok(/offeredFor\(f\.type\)/.test(panel) && /latestDisposition\(run\.dispositions, f\.id\)/.test(panel) && /closes\(f\.type,/.test(panel), "WIRING: the card reads offeredFor, latestDisposition and closes from the client module, not a table of its own");
  {
    const from = panel.indexOf("const triage = async");
    const triageText = from < 0 ? "" : panel.slice(from, panel.indexOf("\n  };\n", from));
    ok(
      /\} catch \(e\) \{[^}]*?if \(isSuperseded\(e\)\) \{\s*setNotice\(SUPERSEDED_NOTICE\);\s*setNonce\(\(v\) => v \+ 1\);\s*\} else \{\s*setError\(e instanceof Error \? e\.message : String\(e\)\);\s*\}\s*\} finally \{/.test(triageText),
      "WIRING: a decision refused because the check was run again (isSuperseded: a 409) refetches through the effect (setNonce, which re-arms the poll) and shows SUPERSEDED_NOTICE; any other refusal shows its own message",
    );
    ok(
      /const \[notice, setNotice\] = useState<string \| null>\(null\);/.test(panel) && /error=\{error \?\? notice\}/.test(panel),
      "WIRING: the notice is its own state, drawn where an error is — the refetch it triggers clears `error` the moment it lands, and would wipe the explanation with it",
    );
    ok(
      (panel.match(/setNotice\(null\);/g) ?? []).length === 2 &&
        /const rerun = async \(\) => \{\s*if \(inFlight\.current\) return;\s*inFlight\.current = true;\s*setBusy\(true\);\s*setNotice\(null\);/.test(panel) &&
        /if \(!body\) return;[^\n]*\n\s*inFlight\.current = true;\s*setBusy\(true\);\s*setNotice\(null\);/.test(triageText),
      "WIRING: the notice is cleared when the next re-run or decision starts, and nowhere else",
    );
  }
  ok(!/BUG_FILED|Bug filed|DISPOSITIONS/.test(panel), "WIRING: the panel holds no decision table of its own and never names BUG_FILED");
  ok(
    /const rerun = async \(\) => \{\s*if \(inFlight\.current\) return;\s*inFlight\.current = true;/.test(panel) &&
      /const triage = async [^{]*\{\s*if \(inFlight\.current \|\| !run\?\.runId\) return;/.test(panel) &&
      (panel.match(/inFlight\.current = false;/g) ?? []).length === 2,
    "WIRING: a re-run and a decision each refuse a second press while one is in flight, and release on both outcomes",
  );
  const page = readFileSync(path.join(repo, "artifacts/atlanta-tis/src/pages/project-detail.tsx"), "utf8");
  ok(/studyType === "tis" && <ProofreadPanel projectId=\{project\.id\} \/>/.test(page), "WIRING: the project page mounts the panel for TIS studies only");
});

console.error = realError;
console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
