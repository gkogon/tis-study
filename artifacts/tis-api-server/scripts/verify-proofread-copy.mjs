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
 *     presented as an alarm". A scan for `status === "none"` proves the characters
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
const runOf = (status, o = {}) => ({ status, runId: "run-uuid", coverage: [], findings: [], dispositions: [], ...o });
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
    ok(triage === (expected ? 8 : 0), `${status}: ${expected ? "offers" : "offers no"} triage controls (${triage} buttons)`);
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
    labels.join("|") === "Run again|Fixed|Disclosed in the deliverable|Withdrawn on a source|Bug filed",
    `the only controls are re-run and four that record a decision (${labels.join(" | ")})`,
  );
  ok(!/ACCEPTED_RISK|CONTESTED_PE|accepted risk|sealing/i.test(html), "the panel does not offer the two decisions only the sealing engineer may record");
  ok(!/<a\b|<form\b|<input\b|<select\b|<textarea\b/.test(html), "no link, form or field on the panel: nothing to navigate to or to edit with");
});

await group("a finding type this client does not know", () => {
  const html = keep(view(runOf("rules_ready", { findings: [mk("n1", "NOTE"), mk("z1", "SOMETHING_NEW")] })));
  ok(findingOrder(html).join(",") === "z1,n1", "an unclassified finding is shown, and first — not buried and not a crash");
  ok(/SOMETHING_NEW/.test(text(html)), "an unclassified finding is labelled with its own type");
  ok(/to resolve before/.test(summaryOf(html) ?? ""), "an unclassified finding is counted with what needs a look");
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

// ─── 3. THE CLIENT MODULE ───────────────────────────────────────────────────────────
await group("client module", async () => {
  ok(
    typeof lib.isPending === "function" && typeof lib.isFinished === "function" && typeof lib.dispositionBody === "function",
    "lib/proofread.ts exports isPending, isFinished and dispositionBody",
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
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ─── 4. WIRING (source text — the weak kind; see the header) ─────────────────────────
await group("wiring", () => {
  ok(/\}, \[projectId, nonce\]\);/.test(panel), "WIRING: the poll effect depends on nonce, so a re-run re-arms it");
  ok(/await requestProofread\(projectId\);\s*setError\(null\);\s*setNonce\(/.test(panel), "WIRING: a successful re-run request bumps the nonce");
  ok(/recordDisposition\(projectId, run\.runId, f\.id, body\)/.test(panel) && !/recordDisposition\([^)]*revision/.test(panel), "WIRING: a decision is recorded against the run's uuid, not its revision");
  ok(/dispositionBody\(/.test(panel), "WIRING: the panel builds the decision body with dispositionBody");
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
