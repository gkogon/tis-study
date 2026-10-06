/**
 * Guard for the proofread enqueue hook and the generate response's project id,
 * as they sit in routes/tis.ts.
 *
 * The hook has exactly one safe window in the /generate handler: after the
 * `if (!saved)` refund branch and before the response.
 *
 *   - NOT after res.json: that is still inside the handler's try, so a throw
 *     there reaches the catch, which calls releaseStudySlot (a spurious quota
 *     refund to a firm that kept its study) and res.status().json() (a write to
 *     a response that was already sent).
 *   - NOT inside saveProject: it swallows every error and returns null by
 *     contract, and build-time check scripts exercise it.
 *
 * enqueueProofread awaits the WHOLE clause pass (it enqueues, then drains one
 * run). So the `void ... .catch(...)` wrapper is load-bearing, not decoration:
 * without `void` the engineer waits for the proofread, and without `.catch` a
 * proofread failure is an unhandled rejection, which Node escalates to a
 * process crash (or, if awaited, a failed study).
 *
 * The response id is merged AFTER GenerateTisResponse.parse(): the id does not
 * exist until saveProject returns, and saveProject is handed `validated` — the
 * payload it stores as the result must not carry its own project's id. (Against
 * a schema that does not declare projectId the parse would also strip an id
 * attached earlier, silently.)
 *
 * It is a source-text guard, which is the weakest kind, so it carries its own
 * teeth. MUTATIONS at the bottom breaks each protected property in the source
 * text and asserts that EXACTLY the checks that claim to protect it go red, and
 * that a mutation to one file only flips checks declared about that file — so a
 * check pointed at the wrong file (the instance-id truncation asserted on the
 * store, where it does not live) fails here instead of passing forever.
 *
 * Every check below also asserts that its anchor was FOUND. An anchor that is
 * not found reads as "nothing to object to" to every negative assertion: the
 * original form of this guard anchored on `res.json(validated)`, a line the
 * edit removes, and findIndex quietly matched the /whatif handler further down
 * the same file.
 *
 * Reads as text and imports nothing from the server, so it never opens a
 * connection (importing @workspace/db throws without DATABASE_URL).
 *
 * The runner's and the store's own properties (the claim, the carry-forward,
 * the instance-id truncation) belong to verify-proofread-claim.mjs, which holds
 * them against the files that can break them.
 *
 * Run: `pnpm run check:proofread-hook`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => {
  try {
    return readFileSync(path.resolve(here, p), "utf8");
  } catch {
    return "";
  }
};

let fails = 0;
const ok = (cond, msg, why) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) {
    fails++;
    if (why) console.log(`        ${why}`);
  }
};

const sources = {
  tis: read("../src/routes/tis.ts"),
  projects: read("../src/lib/tis-projects.ts"),
};

ok(sources.tis.length > 0, "src/routes/tis.ts exists");
ok(sources.projects.length > 0, "src/lib/tis-projects.ts exists");

// ---------------------------------------------------------------------------
// Text helpers. Each returns null/"" when it cannot find what it was asked
// for, and every check that uses one asserts the result is non-empty.
// ---------------------------------------------------------------------------

/**
 * Drop // and /* *\/ comments from TypeScript, leaving string and template
 * literals intact. The route file DESCRIBES the faults it avoids ("res.json",
 * "await enqueueProofread" both appear in prose), and a check that read the
 * prose would pass on a file whose code does the wrong thing.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  let q = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (q) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 2;
        continue;
      }
      if (c === q) q = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      q = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Index of the bracket that closes the one at `openIdx`, skipping string contents; -1 if unbalanced. */
function matchClose(src, openIdx) {
  const pairs = { "(": ")", "{": "}", "[": "]" };
  const stack = [];
  let q = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      q = c;
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ")" || c === "}" || c === "]") {
      if (stack.pop() !== c) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const count = (s, needle) => s.split(needle).length - 1;

/**
 * The /generate handler: from the `{` that opens its arrow body to the matching
 * `}`. `router.post("/generate",` with the comma, because "/generate/pdf" shares
 * the prefix. Returns { text, start } with `start` the offset in `code`.
 */
function generateHandler(code) {
  const m = /router\.post\(\s*"\/generate"\s*,/.exec(code);
  if (!m) return null;
  const arrow = code.indexOf("=>", m.index);
  if (arrow < 0) return null;
  const open = code.indexOf("{", arrow);
  if (open < 0) return null;
  const close = matchClose(code, open);
  if (close < 0) return null;
  return { text: code.slice(open, close + 1), start: open };
}

/** The `if (!saved) { ... }` refund branch inside the handler body: { open, close } offsets in `body`. */
function refundBranch(body) {
  const m = /if \(!saved\) \{/.exec(body);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchClose(body, open);
  return close < 0 ? null : { open, close };
}

/** The handler's own `catch (e) { ... }`, identified by the quota refund it makes. */
function handlerCatch(body) {
  const re = /catch \(\w+\) \{/g;
  let m;
  let found = null;
  while ((m = re.exec(body)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchClose(body, open);
    if (close >= 0 && body.slice(open, close + 1).includes("releaseStudySlot(")) found = { open, close };
  }
  return found;
}

/**
 * The enqueue call inside the handler body, paren-matched (the argument list
 * can hold nested parens, which `[^)]*` cannot): offsets of the call, its
 * argument list, and what follows it.
 */
function enqueueCall(body) {
  const at = body.indexOf("enqueueProofread(");
  if (at < 0) return null;
  const open = at + "enqueueProofread".length;
  const close = matchClose(body, open);
  if (close < 0) return null;
  return { at, open, close, args: body.slice(open + 1, close), after: body.slice(close + 1) };
}

/**
 * The offset just past the enqueue STATEMENT: past the chained `.catch(...)` and
 * its `;` when there is one, otherwise past the next `;`. Independent of the
 * catch so that deleting the catch moves one check and not two.
 */
function statementEnd(call, body) {
  const chain = chainedCatch(call, body);
  if (chain) return chain.end;
  const semi = body.indexOf(";", call.close);
  return semi < 0 ? call.close + 1 : semi + 1;
}

/** `.catch(<callback>)` straight after the call; returns the callback text and the offset of the statement's end. */
function chainedCatch(call, body) {
  const m = /^\s*\.catch\(/.exec(call.after);
  if (!m) return null;
  const open = call.close + 1 + m[0].length - 1;
  const close = matchClose(body, open);
  if (close < 0) return null;
  const rest = body.slice(close + 1);
  const semi = /^\s*;/.exec(rest);
  return { callback: body.slice(open + 1, close), end: semi ? close + 1 + semi[0].length : close + 1, terminated: semi !== null };
}

const RESPONSE = /res\.json\(\{\s*\.\.\.validated,\s*projectId: saved\.id\s*\}\)/;

/** The sources a check sees: comments stripped from the TypeScript, raw text for the rest. */
const derive = (s) => {
  const code = stripComments(s.tis);
  const handler = generateHandler(code);
  return {
    raw: s,
    tis: code,
    handler,
    body: handler?.text ?? "",
    projects: stripComments(s.projects),
  };
};

// ---------------------------------------------------------------------------
// The checks. `on` is the file the check is ABOUT: the file whose breakage it
// must detect. The teeth pass holds every check to it.
// ---------------------------------------------------------------------------
const CHECKS = [
  // --- routes/tis.ts: the hook ---------------------------------------------
  {
    id: "handler-anchors-found",
    on: "tis",
    msg: "the /generate handler is found, with the anchors every placement check measures from: the zod parse, saveProject, the `if (!saved)` refund branch (which refunds the slot), the handler's own catch, and the response",
    test: (d) => {
      const refund = refundBranch(d.body);
      return (
        d.body.length > 0 &&
        d.body.includes("GenerateTisResponse.parse(") &&
        d.body.includes("saveProject(") &&
        refund !== null &&
        d.body.slice(refund.open, refund.close + 1).includes("releaseStudySlot(") &&
        handlerCatch(d.body) !== null &&
        d.body.includes("res.json(")
      );
    },
  },
  {
    id: "enqueue-imported",
    on: "tis",
    msg: 'routes/tis.ts imports enqueueProofread from "../lib/proofread-run"',
    test: (d) => /import \{[^}]*\benqueueProofread\b[^}]*\} from "\.\.\/lib\/proofread-run"/.test(d.tis),
  },
  {
    id: "enqueue-single-call-site",
    on: "tis",
    msg: "enqueueProofread is called exactly once in routes/tis.ts, and from the /generate handler: /whatif saves nothing, so it has no project to proofread",
    test: (d) => d.body.length > 0 && count(d.tis, "enqueueProofread(") === 1 && count(d.body, "enqueueProofread(") === 1,
  },
  {
    id: "enqueue-after-refund-branch",
    on: "tis",
    msg: "the enqueue sits AFTER the `if (!saved)` branch has closed — not merely after its first line, which an enqueue inside the refund branch would also satisfy — and the refund branch itself holds no enqueue",
    test: (d) => {
      const refund = refundBranch(d.body);
      const call = enqueueCall(d.body);
      return refund !== null && call !== null && call.at > refund.close && !d.body.slice(refund.open, refund.close + 1).includes("enqueueProofread");
    },
  },
  {
    id: "enqueue-before-response",
    on: "tis",
    msg: "the enqueue sits BEFORE the response, anchored on the post-edit merged `res.json({ ...validated, projectId: saved.id })` (the old `res.json(validated)` is gone from this handler, and findIndex on it would land in /whatif)",
    test: (d) => {
      const call = enqueueCall(d.body);
      const resp = RESPONSE.exec(d.body);
      return call !== null && resp !== null && call.at < resp.index;
    },
  },
  {
    id: "enqueue-adjacent-to-response",
    on: "tis",
    msg: "nothing but whitespace-and-a-short-statement separates the end of the enqueue from the response, and the whole window from the refund branch to the response is short: a hook stranded elsewhere in the handler is not in the safe window",
    test: (d) => {
      const refund = refundBranch(d.body);
      const call = enqueueCall(d.body);
      const resp = RESPONSE.exec(d.body);
      if (!refund || !call || !resp) return false;
      const end = statementEnd(call, d.body);
      const gap = d.body.slice(end, resp.index);
      const window = d.body.slice(refund.close + 1, resp.index);
      return end <= resp.index && norm(gap).length < 120 && norm(window).length < 700;
    },
  },
  {
    id: "enqueue-not-in-catch",
    on: "tis",
    msg: "the handler's catch (the one that calls releaseStudySlot) holds no enqueue: a throw from the hook must never reach a catch that refunds the firm's quota and writes to the response",
    test: (d) => {
      const c = handlerCatch(d.body);
      return c !== null && !d.body.slice(c.open, c.close + 1).includes("enqueueProofread");
    },
  },
  {
    id: "enqueue-is-void",
    on: "tis",
    msg: "the call is `void enqueueProofread(...)`: fire-and-forget, in the style of the adjacent logEvent — enqueueProofread awaits the whole clause pass, so anything else adds seconds to every study",
    test: (d) => {
      const call = enqueueCall(d.body);
      return call !== null && /\bvoid\s+$/.test(d.body.slice(0, call.at));
    },
  },
  {
    id: "enqueue-never-awaited",
    on: "tis",
    msg: "the enqueue is never awaited or returned, anywhere in the file",
    test: (d) => d.tis.includes("enqueueProofread(") && !/\b(await|return)\s+(void\s+)?enqueueProofread\(/.test(d.tis) && !/\bawait\s+void\b/.test(d.tis),
  },
  {
    id: "enqueue-has-own-catch",
    on: "tis",
    msg: "the fire-and-forget call carries its OWN .catch, ends its statement there, logs through req.log.error, and does not rethrow: a rejection out of a `void`ed promise is unhandled, and Node ends the process on one",
    test: (d) => {
      const call = enqueueCall(d.body);
      if (!call) return false;
      const chain = chainedCatch(call, d.body);
      return chain !== null && chain.terminated && /req\.log\.error\(/.test(chain.callback) && !/\bthrow\b/.test(chain.callback);
    },
  },
  {
    id: "enqueue-args-scoped",
    on: "tis",
    msg: "the enqueue is scoped to the saved project and the firm that ran the study: `projectId: saved.id`, `firmId: firm.id`, `userId: user.id` — every proofread read is firm-scoped, so a wrong firm here files the run where its owner cannot see it",
    test: (d) => {
      const call = enqueueCall(d.body);
      return call !== null && /projectId: saved\.id\b/.test(call.args) && /firmId: firm\.id\b/.test(call.args) && /userId: user\.id\b/.test(call.args);
    },
  },

  // --- routes/tis.ts: the response id --------------------------------------
  {
    id: "response-carries-project-id",
    on: "tis",
    msg: "the /generate success response is `res.json({ ...validated, projectId: saved.id })`, and the handler has no bare `res.json(validated)` left that would drop the id",
    test: (d) => d.body.length > 0 && count(d.body, "res.json(") === 1 && RESPONSE.test(d.body) && !/res\.json\(validated\)/.test(d.body),
  },
  {
    id: "id-merged-after-parse",
    on: "tis",
    msg: "the id is merged AFTER GenerateTisResponse.parse(report): the parse is handed `report` unchanged and no projectId appears before it ends, so `validated` — which saveProject stores as the result payload — never carries its own project's id; the response comes after the parse",
    test: (d) => {
      const at = d.body.indexOf("GenerateTisResponse.parse(");
      if (at < 0) return false;
      const open = at + "GenerateTisResponse.parse".length;
      const close = matchClose(d.body, open);
      const resp = RESPONSE.exec(d.body);
      if (close < 0 || !resp) return false;
      return norm(d.body.slice(open + 1, close)) === "report" && !d.body.slice(0, close).includes("projectId") && resp.index > close;
    },
  },

  // --- lib/tis-projects.ts --------------------------------------------------
  {
    id: "save-project-does-not-enqueue",
    on: "projects",
    msg: "saveProject neither imports nor calls the proofread runner: it swallows every error and returns null by contract, and build-time check scripts exercise it",
    test: (d) => /export async function saveProject\b/.test(d.projects) && !/enqueueProofread|proofread-run/.test(d.projects),
  },
];

const ids = CHECKS.map((c) => c.id);
ok(new Set(ids).size === ids.length, "precondition: every check id is unique (a duplicate would hide one of them in the teeth pass)");

const run = (s) => {
  const d = derive(s);
  return CHECKS.filter((c) => !c.test(d)).map((c) => c.id);
};
const failing = run(sources);
for (const c of CHECKS) ok(!failing.includes(c.id), c.msg);

// ---------------------------------------------------------------------------
// Teeth. Each mutation breaks one protected property in the real source text.
// `flips` names the checks that MUST notice it — that is the claim being
// proven. `also` documents the checks the same edit knocks over on the way
// (one wrong placement is several wrong properties), so the red set is asserted
// EXACTLY and a mutation cannot quietly stop testing what it was written for.
// The last assertion of each mutation keeps it honest about its file.
// ---------------------------------------------------------------------------
const HOOK = /\n( *)void enqueueProofread\([\s\S]*?\n\1\}\);\n/;
const RESPONSE_LINE = /\n *res\.json\(\{ \.\.\.validated, projectId: saved\.id \}\);\n/;
const edit = (file, from, to) => (s) => ({ ...s, [file]: s[file].replace(from, to) });
/** Remove the hook statement from the route and put it back at `where(text)`. */
const moveHook = (where) => (s) => {
  const m = HOOK.exec(s.tis);
  if (!m) return s;
  const without = s.tis.replace(HOOK, "\n");
  return { ...s, tis: where(without, m[0]) };
};
/** The offset of the generate handler's own catch, in raw text. */
const generateCatchAt = (tis) => {
  const handlerAt = tis.indexOf('router.post("/generate",');
  return tis.indexOf("} catch (e) {", handlerAt);
};

const MUTATIONS = [
  // routes/tis.ts — the anchors
  {
    label: "the refund branch stops refunding (the anchor the window is measured from is not the real one)",
    file: "tis",
    flips: ["handler-anchors-found"],
    apply: edit("tis", /(if \(!saved\) \{\n\s*)await releaseStudySlot\([^;]*;\n/, "$1"),
  },

  // routes/tis.ts — the hook's window
  {
    label: "move the enqueue after the response",
    file: "tis",
    flips: ["enqueue-before-response"],
    also: ["enqueue-adjacent-to-response"],
    apply: moveHook((without, hook) => without.replace(RESPONSE_LINE, (r) => `${r}${hook.slice(1)}`)),
  },
  {
    label: "move the enqueue into the handler's catch",
    file: "tis",
    flips: ["enqueue-not-in-catch"],
    also: ["enqueue-before-response", "enqueue-adjacent-to-response"],
    apply: moveHook((without, hook) => {
      const at = generateCatchAt(without);
      const eol = without.indexOf("\n", at);
      return `${without.slice(0, eol)}${hook}${without.slice(eol + 1)}`;
    }),
  },
  {
    label: "move the enqueue ahead of the save, above the refund branch",
    file: "tis",
    flips: ["enqueue-after-refund-branch"],
    also: ["enqueue-adjacent-to-response"],
    apply: moveHook((without, hook) => without.replace(/\n( *)const saved = await saveProject\(/, (m) => `${hook}${m.slice(1)}`.replace(/^/, "\n"))),
  },
  {
    label: "put the enqueue inside the refund branch, before its return",
    file: "tis",
    flips: ["enqueue-after-refund-branch"],
    also: ["enqueue-adjacent-to-response"],
    apply: moveHook((without, hook) => without.replace(/(if \(!saved\) \{\n)/, `$1${hook.slice(1)}`)),
  },
  {
    label: "strand the enqueue far above the response with a long statement between",
    file: "tis",
    flips: ["enqueue-adjacent-to-response"],
    apply: edit("tis", RESPONSE_LINE, (r) => `\n    const strandedPadding = [${Array.from({ length: 30 }, (_, i) => `"padding-${i}"`).join(", ")}].length;${r}`),
  },
  {
    label: "also enqueue from the /whatif handler",
    file: "tis",
    flips: ["enqueue-single-call-site"],
    apply: (s) => {
      const at = s.tis.lastIndexOf("res.json(validated);");
      if (at < 0) return s;
      const inject = 'void enqueueProofread({ projectId: "x", firmId: "y", userId: "z" }).catch(() => undefined);\n    ';
      return { ...s, tis: s.tis.slice(0, at) + inject + s.tis.slice(at) };
    },
  },
  {
    label: "drop the import",
    file: "tis",
    flips: ["enqueue-imported"],
    apply: edit("tis", /import \{ enqueueProofread \} from "\.\.\/lib\/proofread-run";\n/, ""),
  },

  // routes/tis.ts — fire and forget
  {
    label: "drop the `void`",
    file: "tis",
    flips: ["enqueue-is-void"],
    apply: edit("tis", "void enqueueProofread(", "enqueueProofread("),
  },
  {
    label: "await the enqueue (the response now waits for the whole clause pass)",
    file: "tis",
    flips: ["enqueue-is-void", "enqueue-never-awaited"],
    apply: edit("tis", "void enqueueProofread(", "await enqueueProofread("),
  },
  {
    label: "keep the `void` but await inside it",
    file: "tis",
    flips: ["enqueue-never-awaited"],
    also: ["enqueue-is-void"],
    apply: edit("tis", "void enqueueProofread(", "void await enqueueProofread("),
  },
  {
    label: "return the enqueue's promise from the handler",
    file: "tis",
    flips: ["enqueue-is-void", "enqueue-never-awaited"],
    apply: edit("tis", "void enqueueProofread(", "return enqueueProofread("),
  },
  {
    label: "drop the .catch",
    file: "tis",
    flips: ["enqueue-has-own-catch"],
    apply: edit("tis", /(void enqueueProofread\([^)]*\))\.catch\(\(err\) => \{[\s\S]*?\n *\}\);/, "$1;"),
  },
  {
    label: "swallow the failure silently in the .catch",
    file: "tis",
    flips: ["enqueue-has-own-catch"],
    apply: edit("tis", /req\.log\.error\(\{ err, projectId: saved\.id \}, "proofread\.enqueue_error"\);/, "void err;"),
  },
  {
    label: "rethrow from the .catch",
    file: "tis",
    flips: ["enqueue-has-own-catch"],
    apply: edit("tis", /req\.log\.error\(\{ err, projectId: saved\.id \}, "proofread\.enqueue_error"\);/, 'req.log.error({ err }, "proofread.enqueue_error");\n      throw err;'),
  },
  {
    label: "enqueue under the wrong firm",
    file: "tis",
    flips: ["enqueue-args-scoped"],
    apply: edit("tis", /(void enqueueProofread\(\{[^}]*)firmId: firm\.id/, "$1firmId: user.id"),
  },

  // routes/tis.ts — the response id
  {
    label: "respond with the bare parsed payload (the id is dropped)",
    file: "tis",
    flips: ["response-carries-project-id"],
    also: ["enqueue-before-response", "enqueue-adjacent-to-response", "id-merged-after-parse"],
    apply: edit("tis", RESPONSE_LINE, "\n    res.json(validated);\n"),
  },
  {
    label: "add a second, bare success response alongside the merged one",
    file: "tis",
    flips: ["response-carries-project-id"],
    apply: edit("tis", RESPONSE_LINE, (r) => `\n    if (false) res.json(validated);${r}`),
  },
  {
    label: "hand the id to the parse by attaching it to the report first",
    file: "tis",
    flips: ["id-merged-after-parse"],
    apply: edit("tis", "GenerateTisResponse.parse(report)", "GenerateTisResponse.parse({ ...report, projectId: saved.id })"),
  },
  {
    label: "respond before the parse",
    file: "tis",
    flips: ["id-merged-after-parse"],
    also: ["enqueue-before-response", "enqueue-adjacent-to-response"],
    apply: (s) => {
      const m = RESPONSE_LINE.exec(s.tis);
      if (!m) return s;
      const without = s.tis.replace(RESPONSE_LINE, "\n");
      return { ...s, tis: without.replace(/\n( *)const validated = GenerateTisResponse\.parse\(report\);/, (p) => `${m[0].slice(0, -1)}${p}`) };
    },
  },

  // lib/tis-projects.ts
  {
    label: "enqueue from inside saveProject",
    file: "projects",
    flips: ["save-project-does-not-enqueue"],
    apply: edit("projects", /export async function saveProject\([^)]*\)[^{]*\{/, (m) => `${m}\n  void enqueueProofread({ projectId: "x", firmId: "y", userId: "z" });`),
  },
];

const teeth = new Map(CHECKS.map((c) => [c.id, c]));
for (const m of MUTATIONS) {
  const unknown = [...m.flips, ...(m.also ?? [])].filter((id) => !teeth.has(id));
  ok(unknown.length === 0, `teeth: "${m.label}" names only real checks`, unknown.length ? `unknown check id(s): ${unknown.join(", ")}` : undefined);
  const mutated = m.apply(sources);
  const changed = Object.keys(sources).some((f) => mutated[f] !== sources[f]);
  ok(changed, `teeth: "${m.label}" actually changes the source (a mutation that applied to nothing would prove nothing)`);
  const touchedOther = Object.keys(sources).filter((f) => f !== m.file && mutated[f] !== sources[f]);
  ok(touchedOther.length === 0, `teeth: "${m.label}" edits only ${m.file}`, touchedOther.length ? `also edited: ${touchedOther.join(", ")}` : undefined);
  const now = run(mutated).filter((id) => !failing.includes(id));
  const want = [...new Set([...m.flips, ...(m.also ?? [])])].sort().join(", ");
  const got = [...now].sort().join(", ");
  ok(
    want === got,
    `teeth: "${m.label}" is caught by exactly the checks that claim to protect it`,
    want === got ? undefined : `expected red: ${want || "(none)"}; actually red: ${got || "(none)"}`,
  );
  const wrongFile = now.filter((id) => teeth.get(id).on !== m.file);
  ok(
    wrongFile.length === 0,
    `teeth: "${m.label}" (${m.file}) is caught only by checks declared about ${m.file} — an assertion pointed at the wrong file passes forever`,
    wrongFile.length ? `checks about another file went red: ${wrongFile.map((id) => `${id} (about ${teeth.get(id).on})`).join(", ")}` : undefined,
  );
}

const covered = new Set(MUTATIONS.flatMap((m) => m.flips));
const toothless = ids.filter((id) => !covered.has(id));
ok(toothless.length === 0, "every check has a mutation proving it has teeth", toothless.length ? `no mutation breaks: ${toothless.join(", ")}` : undefined);

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
