/**
 * Guard for the proofread store and runner — above all for the CLAIM, which is
 * the only concurrent write in this feature and the one piece no other suite
 * can reach.
 *
 * scripts/verify-proofread.mjs pins lifecycle.ts's CLAIM_PREDICATE_SQL against
 * isReclaimable cell by cell, but it cannot see what production executes: the
 * claim runs through drizzle's query builder in proofread-store.ts. This guard
 * holds that builder to the four properties that have each already cost a run:
 *
 *   1. the predicate is the SHARED, pinned one (sql.raw(CLAIM_PREDICATE_SQL)),
 *      not a third restatement;
 *   2. the claim goes through the builder, never db.execute(sql.raw(...)) —
 *      `execute` passes no field map, so RETURNING * comes back keyed by the
 *      literal Postgres column names and every caller reads projectId as
 *      undefined (cf. src/lib/atr-counts.ts:408, which types its raw result in
 *      snake_case for exactly this reason);
 *   3. claimed_at is stamped with the DATABASE's now(), in the same .set() as
 *      the status, so a requeued row cannot keep an expired timestamp that the
 *      next sweep reads as a free row;
 *   4. the instance id is truncated to claimed_by's VARCHAR(64), or every claim
 *      throws 22001 and the catch in claimAndRunOne swallows it.
 *
 * It is a source-text guard, which is the weakest kind — so it carries its own
 * teeth: MUTATIONS below breaks each protected property in the source text and
 * asserts that exactly the checks which claim to protect it go red. A mutation
 * to one file may only flip checks declared about that file, which is how an
 * assertion pointed at the wrong file (asserting the instance-id truncation on
 * the store, where it does not live) fails loudly instead of passing forever.
 *
 * Reads the sources as text, and imports only lifecycle.ts (pure) and esbuild;
 * it never imports the real store or @workspace/db itself. The runner bundles
 * that BEHAVIOUR imports and runs are refused when esbuild resolves anything
 * into them but the runner, its stubs and lifecycle.ts, and the store bundles
 * that STORE BEHAVIOUR runs when they hold anything but the store, its stubs
 * and lifecycle.ts — what esbuild cannot resolve at bundle time (an import
 * whose specifier is computed at run time) is the named limit, set out at
 * BEHAVIOUR. DATABASE_URL is deleted from this process's environment before
 * any bundle is imported.
 *
 * BEHAVIOUR runs the runner itself: proofread-run.ts is bundled
 * with esbuild against an in-memory store, logger and clause registry, and its
 * two exported functions are driven through scenarios — which ids the
 * carry-forward is handed and what gates it, which store failures are caught
 * (every one after the run is queued) and which propagates (the insert's,
 * which POST run depends on), and what a finished run logs about a DEFECT
 * (run, project and clause, nothing from the finding). It has its own teeth: each edit
 * to the runner's text is bundled and RUN, and must turn exactly the behaviour
 * checks that claim to protect it red.
 *
 * The last part, STORE BEHAVIOUR, runs completeRun and insertQueuedRun against
 * a recording db and checks what they hand the query builder: one update of
 * the runs table whose .set() writes exactly the stamp handed in (or no
 * version column without one), and one insert whose .values() writes the
 * queued versions as given. What the database then does with that is SQL,
 * which only a database can execute; that is out of reach here (the opt-in
 * scripts/proofread-pg-harness/ runs it).
 *
 * Run: `pnpm run check:proofread-claim`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { build } from "esbuild";

// Nothing in this guard needs a database, and a bundle that reached @workspace/db by a
// route the refusal below cannot see (an import computed at run time) must not find one:
// without the variable, lib/db/src/index.ts throws at evaluation instead of making a pool.
delete process.env.DATABASE_URL;

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

const lifecyclePath = path.resolve(here, "../src/lib/proofread/lifecycle.ts");
const lifecycleMod = await import(lifecyclePath);

const sources = {
  store: read("../src/lib/proofread-store.ts"),
  runner: read("../src/lib/proofread-run.ts"),
  lifecycle: read("../src/lib/proofread/lifecycle.ts"),
  // lifecycle.ts's exported values, so the composition checks look at what the
  // module really evaluates to and not only at its text.
  vals: {
    CLAIM_SQL: lifecycleMod.CLAIM_SQL,
    CLAIM_PREDICATE_SQL: lifecycleMod.CLAIM_PREDICATE_SQL,
    LEASE_MS: lifecycleMod.LEASE_MS,
  },
};

ok(sources.store.length > 0, "src/lib/proofread-store.ts exists");
ok(sources.runner.length > 0, "src/lib/proofread-run.ts exists");
ok(sources.lifecycle.length > 0, "src/lib/proofread/lifecycle.ts exists");

// ---------------------------------------------------------------------------
// Text helpers. Both files are hand-written TypeScript with one top-level
// `export` per declaration, so a function body is the text from its own
// `export ... function NAME` to the next top-level `export`. Every helper
// returns "" when it cannot find what it was asked for, and every check that
// uses one also asserts the slice is non-empty — a body that silently came
// back empty would satisfy every negative assertion in this file.
// ---------------------------------------------------------------------------
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/**
 * Drop // and /* *\/ comments, leaving string and template literals intact.
 * Every check below reads the comment-stripped text, because these files
 * DESCRIBE the faults they avoid: `db.execute(sql.raw(...))` and "coverage"
 * both appear in prose, and a check that read the prose would pass on a file
 * whose code does the wrong thing. The one exception is the check about
 * lifecycle.ts's comments, which reads the raw text on purpose.
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

/** The sources a check sees: comments stripped from the code, plus the raw text. */
const derive = (s) => ({
  raw: s,
  vals: s.vals,
  store: stripComments(s.store),
  runner: stripComments(s.runner),
  lifecycle: stripComments(s.lifecycle),
});

function body(src, name) {
  const start = src.search(new RegExp(`export (async )?function ${name}\\b`));
  if (start < 0) return "";
  const rest = src.slice(start + 1);
  const end = rest.search(/\nexport /);
  return end < 0 ? rest : rest.slice(0, end);
}

/** The text of the first `.set({ ... })` object literal in `src`, braces matched. */
function setBlock(src) {
  const at = src.indexOf(".set({");
  if (at < 0) return "";
  let depth = 0;
  for (let i = at + 5; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(at + 5, i + 1);
    }
  }
  return "";
}

/** The text of the first `.values({ ... })` object literal in `src`, braces matched. */
function valuesBlock(src) {
  const at = src.indexOf(".values({");
  if (at < 0) return "";
  let depth = 0;
  for (let i = at + 8; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(at + 8, i + 1);
    }
  }
  return "";
}

/**
 * Every write to the binding `name`, or through it, in the comment-stripped, whitespace-folded text `src`: an
 * assignment, compound or not, to it or to a property or element of it (`args = `, `args.x = `, `args["x"] ??= `),
 * an increment or decrement of one, `delete` of one, and a call that writes through it as its first argument
 * (Object.assign / defineProperty / defineProperties / setPrototypeOf, Reflect.set / defineProperty /
 * deleteProperty / setPrototypeOf). Answered as the matched texts, in order. It reads the TEXT: a write through
 * another binding that holds the same object (`const a = args; a.x = ..`), a destructuring assignment, or a
 * helper handed the object is not one of these — what the code then hands the database is the store
 * behaviour checks' (STORE BEHAVIOUR, below), which run it.
 */
function writesTo(src, name) {
  const target = String.raw`(?<![\w$.])${name}(?:\s*\.\s*[\w$]+|\s*\[[^\]]*\])*`;
  const res = [
    new RegExp(String.raw`${target}\s*(?:\*\*|<<|>>>?|\?\?|&&|\|\||[-+*/%&|^])?=(?![=>])`, "g"),
    new RegExp(String.raw`(?:\+\+|--)\s*${target}|${target}\s*(?:\+\+|--)`, "g"),
    new RegExp(String.raw`\bdelete\s+${target}`, "g"),
    new RegExp(String.raw`\b(?:Object\s*\.\s*(?:assign|defineProperty|defineProperties|setPrototypeOf)|Reflect\s*\.\s*(?:set|defineProperty|deleteProperty|setPrototypeOf))\s*\(\s*${name}(?![\w$])`, "g"),
  ];
  return res.flatMap((re) => [...src.matchAll(re)].map((m) => ({ at: m.index, text: m[0].trim() }))).sort((a, b) => a.at - b.at).map((m) => m.text);
}

/** The three version columns a run row records: by the queuing deploy, then again by the deploy that runs it. */
const VERSION_COLS = ["protocolVersion", "rulesVersion", "engineStamp"];

/**
 * The `catch (...) { ... }` block of `src` that contains `needle`, braces
 * matched. claimAndRunOne has two catches — the claim's and the pass's — and a
 * helper that always returned the first would assert the failure policy
 * against the wrong one.
 */
function catchBlock(src, needle) {
  const re = /catch \([^)]*\) \{/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) {
          const block = src.slice(open, i + 1);
          if (block.includes(needle)) return block;
          break;
        }
      }
    }
  }
  return "";
}

/**
 * The text of `const INSTANCE_ID = <expr>;` — the expression only, braces,
 * parens and template literals matched, so it can be EVALUATED. Pinning the
 * expression's text would be satisfied by several wrong expressions (a host
 * sliced to 64 with no room for the pid is one of them); evaluating it pins
 * the property instead.
 */
function initializerOf(src, name) {
  const at = src.indexOf(`const ${name} =`);
  if (at < 0) return "";
  const start = src.indexOf("=", at) + 1;
  let depth = 0;
  let q = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === ";" && depth === 0) return src.slice(start, i).trim();
  }
  return "";
}

/**
 * Evaluate that expression against a stub `process`. Returns the value AND the
 * error, so a red caused by the expression throwing (a ReferenceError, a
 * renamed local) is reported as that — by instance-id-initializer-evaluates —
 * and never mistaken for the length/pid property failing.
 */
function instanceIdEval(src, env, pid) {
  const expr = initializerOf(src, "INSTANCE_ID");
  if (!expr) return { value: null, error: "no `const INSTANCE_ID = ...;` initializer found" };
  try {
    return { value: new Function("process", `return (${expr});`)({ env, pid }), error: null };
  } catch (err) {
    return { value: null, error: `${err?.name ?? "Error"}: ${err?.message ?? err}` };
  }
}

/**
 * The stubs. Linux pid_max reaches 4194304 (2^22), so a pid has up to 7
 * digits in practice; 8 is covered because it is cheap. A hard-coded host
 * slice tuned to a short pid (57 = 64 - 1 - 6) passes every stub below 7
 * digits and is 65 characters at 7.
 */
const INSTANCE_ID_CASES = [
  { label: "200-char HOSTNAME, 4-digit pid", env: { HOSTNAME: "h".repeat(200) }, pid: 4242 },
  { label: "short HOSTNAME, 1-digit pid", env: { HOSTNAME: "box1" }, pid: 7, exactly: "box1-7" },
  { label: "60-char HOSTNAME, 6-digit pid", env: { HOSTNAME: "e".repeat(60) }, pid: 123456 },
  { label: "200-char HOSTNAME, 7-digit pid (pid_max - 1)", env: { HOSTNAME: "h".repeat(200) }, pid: 4194303 },
  { label: "200-char HOSTNAME, 8-digit pid", env: { HOSTNAME: "h".repeat(200) }, pid: 99999999 },
  { label: "80-char RAILWAY_REPLICA_ID wins over HOSTNAME", env: { RAILWAY_REPLICA_ID: "r".repeat(80), HOSTNAME: "box1" }, pid: 9, startsWith: "r" },
  { label: "no env at all", env: {}, pid: 11, exactly: "local-11" },
];
const instanceIdResults = (src) => INSTANCE_ID_CASES.map((c) => ({ ...c, ...instanceIdEval(src, c.env, c.pid) }));

/**
 * Every call to `name(` in `src`, with its arguments split on their top-level
 * commas (parens, brackets, braces and string literals matched) and
 * whitespace-normalised, a trailing comma dropped. A text pin on the whole call
 * would also refuse a harmless reformat; this pins each argument by position,
 * which is what a swapped pair of ids gets wrong.
 */
function callsOf(src, name) {
  const out = [];
  const re = new RegExp(`(?<![\\w.])${name}\\(`, "g");
  let m;
  while ((m = re.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    const args = [];
    let depth = 0;
    let q = null;
    let start = open + 1;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (q) {
        if (c === "\\") i++;
        else if (c === q) q = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") q = c;
      else if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") {
        depth--;
        if (depth === 0) {
          args.push(src.slice(start, i));
          break;
        }
      } else if (c === "," && depth === 1) {
        args.push(src.slice(start, i));
        start = i + 1;
      }
    }
    const a = args.map(norm);
    if (a.length > 0 && a[a.length - 1] === "") a.pop();
    out.push({ at: m.index, args: a });
  }
  return out;
}

/**
 * The carry gate, in either operand order: the previous run's rules version (stamped when ITS clauses
 * ran) equals the RULES_VERSION of the code running this pass — not the claimed row's rules_version,
 * which holds the queuing deploy's value until this pass stamps it.
 */
const SAME_RULES = new Set(["prev.rulesVersion === RULES_VERSION", "RULES_VERSION === prev.rulesVersion"]);

const count = (s, needle) => s.split(needle).length - 1;

/** Index of the bracket that closes the one at `open` in `s`, skipping string and template literals; -1 when unbalanced. */
function closeOf(s, open) {
  let depth = 0;
  let q = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * A store read written as exactly two statements after the signature `sig` (the text after
 * `function `, whitespace-folded): `const [row] = await db.<link>(…).<link>(…)…;` and then
 * `return row ?? null;`, the function's last statement. Answers the chain's links as
 * { name, args } — every link a call, in order — or null when the body is anything else: a
 * statement before the read or between it and the return, a return that rebuilds or replaces
 * the row, a link that is not a call. A remapping link (`.then`, `.map`) is a call, so it comes
 * back by name and the caller refuses it. Reads the comment-stripped, whitespace-folded body.
 */
function rowRead(fnText, sig) {
  const s = norm(fnText);
  // body() starts one character into `export`: accept the text with or without its first letter.
  const head = `xport async function ${norm(sig)} { const [row] = await db`;
  const at = s.startsWith(head) ? head.length : s.startsWith(`e${head}`) ? head.length + 1 : -1;
  if (at < 0) return null;
  const links = [];
  let i = at;
  for (;;) {
    while (s[i] === " ") i++;
    if (s[i] === ";") break;
    const m = /^\.([A-Za-z_$][\w$]*)\(/.exec(s.slice(i));
    if (!m) return null;
    const open = i + m[0].length - 1;
    const close = closeOf(s, open);
    if (close < 0) return null;
    links.push({ name: m[1], args: s.slice(open + 1, close).trim() });
    i = close + 1;
  }
  return s.slice(i) === "; return row ?? null; }" ? links : null;
}
/** The signature previousRunForProject is read under (rowRead). */
const PREVIOUS_RUN_SIG = "previousRunForProject( projectId: string, beforeRevision: number, ): Promise<{ id: string; rulesVersion: string } | null>";

const UNIT_MS ={ millisecond: 1, second: 1000, minute: 60_000, hour: 3_600_000 };

// ---------------------------------------------------------------------------
// The checks. `on` is the file the check is ABOUT: the file whose breakage it
// must detect. The teeth pass holds every check to it.
// ---------------------------------------------------------------------------
const CHECKS = [
  // --- lifecycle.ts: one predicate string, composed into the statement ------
  {
    id: "predicate-exported",
    on: "lifecycle",
    msg: "lifecycle.ts exports CLAIM_PREDICATE_SQL, and it is the lease predicate (both statuses and the lease comparison)",
    test: (s) =>
      typeof s.vals.CLAIM_PREDICATE_SQL === "string" &&
      /status = 'queued'/.test(s.vals.CLAIM_PREDICATE_SQL) &&
      /status = 'running'/.test(s.vals.CLAIM_PREDICATE_SQL) &&
      /claimed_at < now\(\) - interval/.test(s.vals.CLAIM_PREDICATE_SQL),
  },
  {
    id: "claim-sql-composed",
    on: "lifecycle",
    msg: "CLAIM_SQL is composed FROM CLAIM_PREDICATE_SQL (it contains that exact text), so the pinned predicate and the stated statement cannot drift",
    test: (s) => norm(s.vals.CLAIM_PREDICATE_SQL).length > 20 && norm(s.vals.CLAIM_SQL).includes(norm(s.vals.CLAIM_PREDICATE_SQL)),
  },
  {
    id: "predicate-single-copy",
    on: "lifecycle",
    msg: "the predicate is written once in lifecycle.ts: `status = 'queued'` appears exactly once, so CLAIM_SQL carries no second copy to drift",
    test: (s) => count(s.lifecycle, "status = 'queued'") === 1,
  },
  {
    id: "predicate-lease-from-lease-ms",
    on: "lifecycle",
    msg: "the interval in CLAIM_PREDICATE_SQL is exactly LEASE_MS (derived, not a literal): a unit slip would lease for the wrong time",
    test: (s) => {
      const m = /interval '(\d+(?:\.\d+)?) (millisecond|second|minute|hour)s?'/.exec(String(s.vals.CLAIM_PREDICATE_SQL ?? ""));
      return m !== null && Number(m[1]) * UNIT_MS[m[2]] === s.vals.LEASE_MS;
    },
  },
  {
    id: "predicate-comments-corrected",
    on: "lifecycle",
    msg: "lifecycle.ts no longer claims CLAIM_SQL is 'the code that actually runs' or that the store restates it — the predicate it states is now the one the store executes",
    test: (s) =>
      !/code that actually runs/.test(s.raw.lifecycle) &&
      !/it is NOT what proofread-store\.ts/.test(s.raw.lifecycle) &&
      !/the store restates this/.test(s.raw.lifecycle) &&
      count(s.raw.lifecycle, "CLAIM_PREDICATE_SQL") >= 2,
  },

  // --- proofread-store.ts: the claim ---------------------------------------
  {
    id: "store-imports-predicate",
    on: "store",
    msg: "the store imports CLAIM_PREDICATE_SQL from ./proofread/lifecycle.ts (explicit .ts, as that directory requires)",
    test: (s) => /import \{[^}]*\bCLAIM_PREDICATE_SQL\b[^}]*\} from "\.\/proofread\/lifecycle\.ts"/.test(s.store),
  },
  {
    id: "store-no-local-predicate",
    on: "store",
    msg: "the store declares no CLAIM_PREDICATE_SQL of its own — a local copy would make sql.raw(CLAIM_PREDICATE_SQL) look shared while executing an unpinned string",
    test: (s) => !/(const|let|var) CLAIM_PREDICATE_SQL/.test(s.store),
  },
  {
    id: "claim-uses-shared-predicate",
    on: "store",
    msg: "the claim's subselect is `WHERE ${sql.raw(CLAIM_PREDICATE_SQL)}` — the pinned predicate rather than a restatement",
    test: (s) => {
      const b = body(s.store, "claimOneRun");
      return b.length > 0 && /WHERE \$\{sql\.raw\(CLAIM_PREDICATE_SQL\)\}/.test(b);
    },
  },
  {
    id: "claim-no-restated-lease",
    on: "store",
    msg: "the store restates neither the lease literal (interval '...') nor the old `claimed_at IS NOT NULL AND` handling that stranded an unstamped running row",
    test: (s) => !/interval '/.test(s.store) && !/IS NOT NULL AND/.test(s.store),
  },
  {
    id: "claim-stamps-db-clock",
    on: "store",
    msg: "the claim stamps claimedAt with the database's now(), the clock the lease is compared on — several instances claim from one table and their clocks disagree",
    test: (s) => /claimedAt: sql`now\(\)`/.test(setBlock(body(s.store, "claimOneRun"))),
  },
  {
    id: "claim-no-instance-clock",
    on: "store",
    msg: "the claim contains no new Date() — a lease measured against a skewed local clock expires early on one box and late on another",
    test: (s) => {
      const b = body(s.store, "claimOneRun");
      return b.length > 0 && !/new Date\(/.test(b);
    },
  },
  {
    id: "claim-set-is-atomic",
    on: "store",
    msg: "status, claimedAt, claimedBy and attempts move in ONE .set(): a refactor that passed claimedAt separately left a requeued row's expired timestamp in place, and the next sweep stole a live run",
    test: (s) => {
      const set = setBlock(body(s.store, "claimOneRun"));
      return (
        set.length > 0 &&
        /status: "running"/.test(set) &&
        /claimedAt:/.test(set) &&
        /claimedBy:/.test(set) &&
        /attempts: sql`.*attempts.* \+ 1`/.test(set)
      );
    },
  },
  {
    id: "store-never-executes-raw",
    on: "store",
    msg: "the store never calls db.execute(): it passes no field map, so RETURNING * comes back in snake_case and a cast to the camelCase row type hands every caller projectId: undefined",
    test: (s) => s.store.length > 0 && !/db\.execute\(/.test(s.store),
  },
  {
    id: "claim-returns-mapped-row",
    on: "store",
    msg: "the claim returns its row through .returning(), which maps the columns to the camelCase row type",
    test: (s) => /\.returning\(\)/.test(body(s.store, "claimOneRun")),
  },
  {
    id: "claim-takes-one-locked-row",
    on: "store",
    msg: "the claim's subselect locks the row it picks and skips rows another instance holds (FOR UPDATE SKIP LOCKED), oldest first, one per call",
    test: (s) => {
      const b = norm(body(s.store, "claimOneRun"));
      return /ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1/.test(b);
    },
  },
  {
    id: "revision-derived-in-sql",
    on: "store",
    msg: "the revision is derived inside the INSERT, so two quick re-runs cannot both read the same max and both write revision N",
    test: (s) => /revision: sql`\(SELECT coalesce\(max\(revision\), 0\) \+ 1 FROM study_proofread_runs WHERE project_id = \$\{/.test(body(s.store, "insertQueuedRun")),
  },
  {
    id: "queued-run-records-what-it-was-given",
    on: "store",
    msg: "insertQueuedRun writes each version column from its OWN argument, once (`protocolVersion: args.protocolVersion`, `rulesVersion: args.rulesVersion`, `engineStamp: args.engineStamp`), and nothing in its text writes to or through `args` (no assignment to it or to a property or element of it, no delete, ++ or --, no Object.assign / defineProperty / defineProperties / setPrototypeOf or Reflect.set / defineProperty / deleteProperty / setPrototypeOf on it, no `arguments`): all three are varchar, so `rulesVersion: args.engineStamp` — or `args = { ...args, rulesVersion: args.engineStamp }` ahead of the insert — type-checks and records every run's deploy-suffixed stamp as its rules version. These are the queuing deploy's values, and completeRun's stamp replaces them when the clauses run. The text; a write through another binding is not read here, and what the insert is handed for given arguments, however reached, is [runs-queued-run-records-what-it-was-given]'s, which runs it",
    test: (s) => {
      const b = norm(body(s.store, "insertQueuedRun"));
      const v = norm(valuesBlock(b));
      return v.length > 0 && VERSION_COLS.every((c) => count(v, `${c}:`) === 1 && v.includes(`${c}: args.${c},`)) && writesTo(b, "args").length === 0 && !/(?<![\w$.])arguments\b/.test(b);
    },
  },
  {
    id: "run-stamp-written-as-given",
    on: "store",
    msg: "completeRun's first .set({...}) writes the run-time stamp it is handed, each column from its own field, and only when one is handed (`...(args.stamp === undefined ? {} : { rulesVersion: args.stamp.rulesVersion, engineStamp: args.stamp.engineStamp, protocolVersion: args.stamp.protocolVersion })`), naming each column once: that rules_version is the one the next run's carry gate compares, so `rulesVersion: args.stamp.engineStamp` (varchar either way; tsc is silent) would reopen every decision after every deploy. The text of that object; that the one update of the runs table writes exactly the stamp handed in, whatever else completeRun does (a second update, a rebinding of args, an alias), is [runs-complete-run-writes-the-stamp-it-is-handed]'s, which runs it",
    test: (s) => {
      const set = norm(setBlock(body(s.store, "completeRun")));
      return (
        /\.\.\.\(args\.stamp === undefined \? \{\} : \{ rulesVersion: args\.stamp\.rulesVersion, engineStamp: args\.stamp\.engineStamp, protocolVersion: args\.stamp\.protocolVersion,? \}\),/.test(set) &&
        VERSION_COLS.every((c) => count(set, `${c}:`) === 1)
      );
    },
  },
  {
    id: "run-holds-findings-reads-this-run",
    on: "store",
    msg: "runHoldsFindings answers whether THIS run holds a finding (findings.run_id = runId, one row is enough), true exactly when a row came back — keyed on another column it answers about another run, and the runner then fails a run that holds nothing, or runs new rules over a run that holds old-rule findings",
    test: (s) =>
      /\.from\(studyProofreadFindingsTable\) \.where\(eq\(studyProofreadFindingsTable\.runId, runId\)\) \.limit\(1\); return row !== undefined; \}$/.test(norm(body(s.store, "runHoldsFindings"))),
  },
  {
    id: "complete-keeps-prior-coverage",
    on: "store",
    msg: "completeRun writes coverage only when it was given some: a requeue must not replace the successful pass's coverage with {}",
    test: (s) => {
      const b = body(s.store, "completeRun");
      return /args\.coverage === undefined \? \{\} : \{ coverage/.test(b) && /args\.inputManifest === undefined \? \{\} : \{ inputManifest/.test(b);
    },
  },
  {
    id: "findings-insert-idempotent",
    on: "store",
    msg: "the findings insert is onConflictDoNothing on (runId, fingerprint): a re-claimed run re-derives the same findings and must not duplicate them",
    test: (s) => {
      const b = body(s.store, "completeRun");
      return /onConflictDoNothing\(\{/.test(b) && /target: \[studyProofreadFindingsTable\.runId, studyProofreadFindingsTable\.fingerprint\]/.test(b);
    },
  },
  {
    id: "panel-read-is-firm-scoped",
    on: "store",
    msg: "latestRunForProject scopes by firm AND project in one conjunction — an `or` here, or a missing arm, serves another firm's findings for a project id it guessed",
    test: (s) =>
      /\.where\(and\(eq\(studyProofreadRunsTable\.firmId, firmId\), eq\(studyProofreadRunsTable\.projectId, projectId\)\)\)/.test(
        norm(body(s.store, "latestRunForProject")),
      ),
  },
  {
    id: "carry-forward-requires-same-rules",
    on: "store",
    msg: "carryForwardDispositions carries nothing when the RULES version changed: `if (!sameRules) return 0;` is the FIRST statement of its body, before any read or write — moved below the carry loop it returns 0 after every decision has already been appended. A RULES_VERSION bump is by definition a material change to what a clause judges, so it reopens every decision on purpose. A deploy alone is not such a change — the engine stamp is attribution, and the fingerprint already holds the exact values a finding read",
    test: (s) => /sameRules: boolean,? \): Promise<number> \{ if \(!sameRules\) return 0; /.test(norm(body(s.store, "carryForwardDispositions"))),
  },
  {
    id: "previous-run-reports-its-rules-version",
    on: "store",
    msg: "previousRunForProject is one read and the row it read: `const [row] = await db.select({ id: studyProofreadRunsTable.id, rulesVersion: studyProofreadRunsTable.rulesVersion }).from(studyProofreadRunsTable)` with no link but where / orderBy / limit, then `return row ?? null;` — no statement between them and no remap, so the rules version the carry gate compares is the one read from ITS rules_version column. Read from engine_stamp (the same varchar type, so tsc is silent), rewritten after the read, or rebuilt in the return, the gate would reopen every decision after every deploy, or carry every decision across a rules bump",
    test: (s) => {
      const links = rowRead(body(s.store, "previousRunForProject"), PREVIOUS_RUN_SIG);
      return (
        links !== null &&
        links.length >= 2 &&
        links[0].name === "select" &&
        links[0].args === "{ id: studyProofreadRunsTable.id, rulesVersion: studyProofreadRunsTable.rulesVersion }" &&
        links[1].name === "from" &&
        links[1].args === "studyProofreadRunsTable" &&
        links.slice(2).every((l) => ["where", "orderBy", "limit"].includes(l.name))
      );
    },
  },
  {
    id: "previous-run-is-the-newest-before",
    on: "store",
    msg: "previousRunForProject takes the NEWEST qualifying revision: its read is ordered `.orderBy(desc(studyProofreadRunsTable.revision)) .limit(1)`, with no other orderBy — ascending, or by created_at, or unordered, the carry source is the oldest (or any) finished revision, so a decision first recorded on a later revision reopens and a superseded older one is reinstated",
    test: (s) => {
      const b = norm(body(s.store, "previousRunForProject"));
      return count(b, ".orderBy(") === 1 && b.includes(".orderBy(desc(studyProofreadRunsTable.revision)) .limit(1)");
    },
  },
  {
    id: "carry-forward-idempotent",
    on: "store",
    msg: "the duplicate check is keyed on the NEW finding and the disposition being carried, both in one conjunction, and its result stops the insert — keyed on the old finding it never matches, and the carried row is appended again on every re-run",
    test: (s) => {
      const b = norm(body(s.store, "carryForwardDispositions"));
      return (
        /\.where\( and\( eq\(studyProofreadDispositionsTable\.findingId, nf\.id\), eq\(studyProofreadDispositionsTable\.disposition, prior\[0\]\.disposition\), \), \)/.test(b) &&
        /if \(already\) continue;/.test(b)
      );
    },
  },
  {
    id: "carry-forward-reads-the-newest",
    on: "store",
    msg: "the disposition carried is the LATEST on the old finding (order by created_at desc, limit 1): the oldest would carry an ACCEPTED_RISK that a later WITHDRAWN replaced",
    test: (s) =>
      /\.where\(eq\(studyProofreadDispositionsTable\.findingId, match\.id\)\) \.orderBy\(desc\(studyProofreadDispositionsTable\.createdAt\)\) \.limit\(1\)/.test(
        norm(body(s.store, "carryForwardDispositions")),
      ),
  },
  {
    id: "carry-forward-writes-the-new-finding",
    on: "store",
    msg: "the carried row is written against the NEW finding with the disposition that was carried — written against match.id it lands on the old revision again and the new one stays open",
    test: (s) =>
      // createdAt is the one field allowed after actorUserId, and its VALUE is
      // carry-forward-keeps-the-decision-date's to pin, not this check's.
      /\.values\(\{ findingId: nf\.id, disposition: prior\[0\]\.disposition, note: prior\[0\]\.note, sourceLabel: prior\[0\]\.sourceLabel, actorUserId: prior\[0\]\.actorUserId, (?:createdAt: [^,}]+, )?\}\)/.test(
        norm(body(s.store, "carryForwardDispositions")),
      ),
  },
  {
    id: "carry-forward-keeps-the-decision-date",
    on: "store",
    msg: "the carried row keeps the date the decision was MADE (`createdAt: prior[0].createdAt`): left to the column default it is stamped with the re-run, and the panel says \"Recorded: WITHDRAWN on <the day someone pressed Run again>\" about a decision nobody made that day — on an append-only log, permanently",
    test: (s) =>
      /\.insert\(studyProofreadDispositionsTable\)\.values\(\{[^}]*\bcreatedAt: prior\[0\]\.createdAt, [^}]*\}\)/.test(norm(body(s.store, "carryForwardDispositions"))),
  },
  {
    id: "previous-run-is-this-project",
    on: "store",
    msg: "previousRunForProject's conjunction is scoped to THIS project — without it the carry source is the newest rules_ready run of any firm below this revision, and that firm's dispositions (note, source, actor) are copied onto this project's findings by fingerprint",
    test: (s) => /\.where\( and\( eq\(studyProofreadRunsTable\.projectId, projectId\), /.test(norm(body(s.store, "previousRunForProject"))),
  },
  {
    id: "carry-forward-reads-old-then-new",
    on: "store",
    msg: "the carry reads the PREVIOUS run's findings as the source and the NEW run's as the target — swapped, every lookup lands on findings with no dispositions yet and nothing carries",
    test: (s) =>
      /const \[oldF, newF\] = await Promise\.all\(\[ db\.select\(\)\.from\(studyProofreadFindingsTable\)\.where\(eq\(studyProofreadFindingsTable\.runId, previousRunId\)\), db\.select\(\)\.from\(studyProofreadFindingsTable\)\.where\(eq\(studyProofreadFindingsTable\.runId, newRunId\)\), \]\);/.test(
        norm(body(s.store, "carryForwardDispositions")),
      ),
  },
  {
    id: "carry-forward-matches-by-fingerprint",
    on: "store",
    msg: "a new finding inherits from the old finding with the SAME fingerprint (===) — any other comparison hands one finding's ruling to a different finding",
    test: (s) => /const match = oldF\.find\(\(of\) => of\.fingerprint === nf\.fingerprint\);/.test(body(s.store, "carryForwardDispositions")),
  },
  {
    id: "previous-run-is-strictly-earlier",
    on: "store",
    msg: "previousRunForProject looks STRICTLY back (lt, not lte): `lte` returns the run itself, so nothing carries from the revision before it and a WITHDRAWN reopens",
    test: (s) => /lt\(studyProofreadRunsTable\.revision, beforeRevision\)/.test(body(s.store, "previousRunForProject")),
  },
  {
    id: "previous-run-is-finished",
    on: "store",
    msg: "previousRunForProject looks one revision back among FINISHED runs, exactly the two finished statuses (`inArray(studyProofreadRunsTable.status, [\"rules_ready\", \"ready\"])`, the pair the disposition route's 409 accepts and the panel's isFinished shows): a failed or unfinished revision would carry nothing and strand the one before it, and a 'ready' revision left out would strand every decision the route accepted on it",
    test: (s) => {
      const b = norm(body(s.store, "previousRunForProject"));
      return count(b, "studyProofreadRunsTable.status") === 1 && b.includes('inArray(studyProofreadRunsTable.status, ["rules_ready", "ready"])');
    },
  },
  {
    id: "finding-scope-is-one-query",
    on: "store",
    msg: "findingInFirmRun verifies firm → project → run → finding as ONE conjunction over the joined tables — one of TWO firm checks on the triage write path (findingAudienceForFirm is the other, pinned by `audience-lookup-is-firm-scoped` in verify-proofread-routes.mjs), and they back each other up: dropping the firm arm from either one alone is invisible through the route, and only dropping BOTH lets a firm write onto another firm's finding. So no route-level or cluster test can ever show either one weaken, and each text pin is load-bearing permanently — do not simplify one away on the strength of a green route test; `and` → `or` here would let any firm rule on another firm's finding",
    test: (s) => {
      const b = norm(body(s.store, "findingInFirmRun"));
      return (
        /innerJoin\(studyProofreadRunsTable, eq\(studyProofreadFindingsTable\.runId, studyProofreadRunsTable\.id\)\)/.test(b) &&
        /\.where\( and\( eq\(studyProofreadFindingsTable\.id, findingId\), eq\(studyProofreadRunsTable\.id, runId\), eq\(studyProofreadRunsTable\.projectId, projectId\), eq\(studyProofreadRunsTable\.firmId, firmId\), \), \)/.test(b)
      );
    },
  },

  // --- proofread-run.ts: the runner ----------------------------------------
  {
    id: "instance-id-initializer-evaluates",
    on: "runner",
    msg: "precondition: INSTANCE_ID's initializer is found and evaluates without throwing for every stub — so a red on the property below means the property failed, not that the expression could not run",
    test: (s) => instanceIdResults(s.runner).every((r) => r.error === null && typeof r.value === "string"),
    why: (s) =>
      instanceIdResults(s.runner)
        .filter((r) => r.error !== null || typeof r.value !== "string")
        .map((r) => `${r.label}: ${r.error ?? `returned ${typeof r.value}`}`)
        .join("; "),
  },
  {
    id: "instance-id-fits-claimed-by",
    on: "runner",
    msg: "the instance id built by proofread-run.ts fits claimed_by's VARCHAR(64) AND still ends with the pid, for 1- to 8-digit pids and hostnames up to 200 characters — an over-long id throws 22001 on every claim, and one that drops the pid collapses every process on a long-named host to a single claimed_by",
    test: (s) =>
      instanceIdResults(s.runner).every(
        (r) =>
          r.error === null &&
          typeof r.value === "string" &&
          r.value.length > 0 &&
          r.value.length <= 64 &&
          r.value.endsWith(`-${r.pid}`) &&
          (r.exactly === undefined || r.value === r.exactly) &&
          (r.startsWith === undefined || r.value.startsWith(r.startsWith)),
      ),
    why: (s) =>
      instanceIdResults(s.runner)
        .map((r) => `${r.label} → ${r.error ? `THREW ${r.error}` : `${String(r.value).length} chars, ends ${JSON.stringify(String(r.value).slice(-9))}`}`)
        .join("; "),
  },
  {
    id: "max-attempts-from-policy",
    on: "runner",
    msg: "the runner takes MAX_ATTEMPTS from lifecycle.ts and declares none of its own",
    test: (s) =>
      /import \{[^}]*\bMAX_ATTEMPTS\b[^}]*\} from "\.\/proofread\/lifecycle\.ts"/.test(s.runner) &&
      !/(const|let|var) MAX_ATTEMPTS/.test(s.runner),
  },
  {
    id: "exhausted-fails-without-running",
    on: "runner",
    msg: "a claimed row past its attempts budget is failed WITHOUT running (`attempts > MAX_ATTEMPTS`, before any runClauses): a pass that crashes the process would otherwise be re-claimed and re-crash forever",
    test: (s) => {
      const at = s.runner.search(/if \(run\.attempts > MAX_ATTEMPTS\)/);
      const clauses = s.runner.indexOf("runClauses(");
      if (at < 0 || clauses < 0 || at > clauses) return false;
      const branch = s.runner.slice(at, clauses);
      return /status: "failed"/.test(branch) && /return true;/.test(branch) && !/runClauses\(/.test(branch);
    },
  },
  {
    id: "exhausted-write-is-caught",
    on: "runner",
    msg: "the exhausted branch's one completeRun is the first statement of a `try`, whose catch logs at warn with `runId: run.id` and holds no `throw`, no `return` and no `Promise.reject` — the text; that claimAndRunOne then resolves rather than rejects is [runs-claim-and-run-never-rejects]'s, which runs it: the row claimed there is the oldest claimable one, not necessarily the run the caller just queued, so a throw out of it made POST run answer 500 \"Failed to start the check\" for a check that WAS queued. Nothing is lost by catching it — the row stays 'running', its lease expires, and the next claim lands here again",
    test: (s) => {
      // The branch is the if-block itself, braces matched: the slice up to
      // runClauses( would also take in the "study row not found" write.
      const at = s.runner.search(/run\.attempts > MAX_ATTEMPTS\) \{/);
      if (at < 0) return false;
      const open = s.runner.indexOf("{", at);
      let depth = 0;
      let close = -1;
      for (let i = open; i < s.runner.length; i++) {
        if (s.runner[i] === "{") depth++;
        else if (s.runner[i] === "}" && --depth === 0) {
          close = i;
          break;
        }
      }
      if (close < 0) return false;
      const branch = norm(s.runner.slice(open, close + 1));
      const tryAt = branch.indexOf("try { await completeRun({");
      const c = catchBlock(branch, "runId: run.id");
      return (
        tryAt >= 0 &&
        count(branch, "completeRun(") === 1 &&
        c.length > 0 &&
        branch.indexOf(c) > tryAt &&
        /logger\.warn\(\{[^}]*\brunId: run\.id\b[^}]*\}/.test(c) &&
        !/\bthrow\b/.test(c) &&
        !/\breturn\b/.test(c) &&
        !/Promise\.reject/.test(c)
      );
    },
  },
  {
    id: "failure-status-from-policy",
    on: "runner",
    msg: "a failed pass takes its next status from nextStatusAfterFailure, not from a literal: requeue while attempts remain, fail when they do not",
    test: (s) => /nextStatusAfterFailure\(\{ status: run\.status, claimedAt: run\.claimedAt, attempts: run\.attempts \}\)/.test(catchBlock(body(s.runner, "claimAndRunOne"), "completeRun")),
  },
  {
    id: "failure-keeps-prior-coverage",
    on: "runner",
    msg: "the failure path passes no coverage or inputManifest, so a requeue keeps what the successful part of the pass recorded instead of replacing it with {}",
    test: (s) => {
      const c = catchBlock(body(s.runner, "claimAndRunOne"), "completeRun");
      return c.length > 0 && /completeRun\(\{/.test(c) && !/coverage:/.test(c) && !/inputManifest:/.test(c);
    },
  },
  {
    id: "status-flips-after-the-carry",
    on: "runner",
    msg: "findings are written while the row is still 'running', the dispositions are carried, and only THEN does the status flip to 'rules_ready' — a flip before the carry lets a re-run claimed in that window take this revision as its source, find no dispositions, and lose the previous revision's WITHDRAWN permanently",
    test: (s) => {
      const b = body(s.runner, "claimAndRunOne");
      const write = b.indexOf('status: "running"');
      const prev = b.indexOf("previousRunForProject(");
      const carry = b.indexOf("carryForwardDispositions(");
      const flip = b.indexOf('status: "rules_ready"');
      return (
        write > 0 &&
        prev > write &&
        carry > prev &&
        flip > carry &&
        // the flip is its own call and writes no coverage, so it cannot undo
        // what the first half recorded
        /await completeRun\(\{ runId: run\.id, status: "rules_ready", findings: \[\] \}\);/.test(b)
      );
    },
  },
  {
    id: "carry-looks-back-from-this-run",
    on: "runner",
    msg: "the carry source is written `const prev = await previousRunForProject(run.projectId, run.revision)`, called once, where `run` is assigned once (`run = await claimOneRun(INSTANCE_ID);`) and nothing else in claimAndRunOne's text writes to or through `run` (no other assignment to it or to a property or element of it — run.projectId, run[\"revision\"] —, no delete, ++ or --, no Object.assign / defineProperty / defineProperties / setPrototypeOf or Reflect.set / defineProperty / deleteProperty / setPrototypeOf on it) — the text of the call; a write through another binding is not read here, and that the call reads the CLAIMED row's project and revision is [runs-carry-source-is-this-project-before-this-revision]'s, which runs it. run.id in the project slot matches no project and nothing ever carries; any other revision makes the run its own source or skips the one before it",
    test: (s) => {
      const b = norm(body(s.runner, "claimAndRunOne"));
      const calls = callsOf(b, "previousRunForProject");
      const runAssigned = b.match(/(?<![\w.$])run\s*=(?!=)/g) ?? [];
      return (
        calls.length === 1 &&
        calls[0].args.join(", ") === "run.projectId, run.revision" &&
        /const prev = await previousRunForProject\(/.test(b) &&
        runAssigned.length === 1 &&
        b.includes("run = await claimOneRun(INSTANCE_ID);") &&
        writesTo(b, "run").every((w) => w.replace(/\s+/g, "") === "run=") &&
        writesTo(b, "run").length === 1
      );
    },
  },
  {
    id: "carry-writes-this-run-from-prev",
    on: "runner",
    msg: "the carry is `if (prev) await carryForwardDispositions(run.id, prev.id, …)`: the NEW run first, the previous one second, made whenever a previous run exists — swapped, it reads this run's (still empty) decisions as the source and every recorded decision reopens; skipped or put behind any other condition, nothing carries",
    test: (s) => {
      const b = norm(body(s.runner, "claimAndRunOne"));
      const calls = callsOf(b, "carryForwardDispositions");
      return calls.length === 1 && calls[0].args[0] === "run.id" && calls[0].args[1] === "prev.id" && /if \(prev\) await carryForwardDispositions\(/.test(b);
    },
  },
  {
    id: "carry-gate-is-the-rules-version",
    on: "runner",
    msg: "the carry's third argument is `prev.rulesVersion === RULES_VERSION` (either operand order): the rules the previous run's clauses ran under against the rules this pass runs under, so decisions carry across a deploy and stop at a RULES_VERSION bump. Not `run.rulesVersion`: the claimed row holds the QUEUING deploy's value, and a run queued before a bump and claimed after it carried every decision across the bump. Not engineStamp, which ends in the deploy's commit: every \"Run again\" after any deploy reopened every WITHDRAWN, DISCLOSED and FIXED — the study row never changes, so nothing else could have moved",
    test: (s) => {
      const calls = callsOf(body(s.runner, "claimAndRunOne"), "carryForwardDispositions");
      return calls.length === 1 && calls[0].args.length === 3 && SAME_RULES.has(calls[0].args[2]);
    },
  },
  {
    id: "pass-writes-findings-and-coverage",
    on: "runner",
    msg: "the FIRST completeRun call — the only place a pass's findings are ever written, since the flip is pinned to findings: [] — carries the pass's coverage, its input manifest and its findings; without them a run reaches rules_ready having recorded nothing",
    test: (s) =>
      /await completeRun\(\{ runId: run\.id, status: "running", coverage, inputManifest: buildInputManifest\(rec\), findings, (?:stamp: \{[^}]*\}, )?\}\);/.test(
        norm(body(s.runner, "claimAndRunOne")),
      ),
  },
  {
    id: "pass-stamps-the-code-that-ran-it",
    on: "runner",
    msg: "the clause pass's write (the one completeRun with status \"running\") stamps the run with the code that RAN it — `stamp: { rulesVersion: RULES_VERSION, engineStamp: engineStamp(), protocolVersion: PROTOCOL_VERSION }` — and no other write in claimAndRunOne carries a stamp: a run queued before a deploy that bumps RULES_VERSION and claimed after it otherwise records the old rules beside new-rule findings, and the next run's carry gate reads that value",
    test: (s) => {
      const b = norm(body(s.runner, "claimAndRunOne"));
      const pass = callsOf(b, "completeRun").filter((c) => (c.args[0] ?? "").includes('status: "running"'));
      return (
        pass.length === 1 &&
        /stamp: \{ rulesVersion: RULES_VERSION, engineStamp: engineStamp\(\), protocolVersion: PROTOCOL_VERSION,? \}, \}$/.test(pass[0].args[0]) &&
        count(b, "stamp:") === 1
      );
    },
  },
  {
    id: "enqueue-no-row-returns-without-draining",
    on: "runner",
    msg: "enqueueProofread, when the insert yields NO row, logs at warn and returns without draining — its `if (!run) { … logger.warn(…) … return; }` comes before its one `await claimAndRunOne();` (the text; that nothing is claimed then is [runs-enqueue-without-a-row-claims-nothing]'s, which runs it) — and holds no `throw` of its own. That branch is defensive — .returning() on an insert that succeeded always yields its row — and it is NOT a fail-open: an insert ERROR propagates out of enqueueProofread, and must, because POST run (routes/proofread.ts) reads 23505 from it to answer a double-press with ok (pinned below by [runs-enqueue-insert-error-reaches-the-caller]). The fail-open that keeps a proofread from affecting a study is the hook's own .catch on `void enqueueProofread(...)` in routes/tis.ts, pinned by [enqueue-has-own-catch] in verify-proofread-hook.mjs (which prints it as \"the fire-and-forget call carries its OWN .catch …\")",
    test: (s) => {
      const b = body(s.runner, "enqueueProofread");
      const branch = b.search(/if \(!run\) \{[\s\S]*?logger\.warn\([\s\S]*?return;[\s\S]*?\}/);
      return b.length > 0 && branch >= 0 && count(b, "claimAndRunOne(") === 1 && b.indexOf("await claimAndRunOne();") > branch && !/throw /.test(b);
    },
  },
];

const ids = CHECKS.map((c) => c.id);
ok(new Set(ids).size === ids.length, "precondition: every check id is unique (a duplicate would hide one of them in the teeth pass)");

const run = (s) => {
  const d = derive(s);
  return CHECKS.filter((c) => !c.test(d)).map((c) => c.id);
};
const failing = run(sources);
for (const c of CHECKS) {
  const red = failing.includes(c.id);
  ok(!red, `[${c.id}] ${c.msg}`, red && c.why ? c.why(derive(sources)) : undefined);
}

// ---------------------------------------------------------------------------
// Teeth. Each mutation breaks one protected property in the real source text.
// `flips` names the checks that MUST notice it — that is the claim being
// proven. `also` documents the checks the same edit knocks over on the way
// (one predicate string feeds several checks), so that the red set is asserted
// EXACTLY and a mutation cannot quietly stop testing what it was written for.
// The last assertion of each mutation keeps it honest about its file: a store
// mutation that flips a check declared about the runner means that check is
// reading the wrong file.
// ---------------------------------------------------------------------------
const edit = (file, from, to) => (s) => ({ ...s, [file]: s[file].replace(from, to) });
// previousRunForProject's last line and the doc comment after it: the anchor that tells its
// `return row ?? null;` from the same line in the store's other one-row reads.
const PREVIOUS_RUN_END = "  return row ?? null;\n}\n\n/** Carry dispositions forward";

// The exhausted branch's write as the runner holds it, and as it was before it
// was caught (proofread-run.ts at 922ba4e) — the edit both teeth tables use.
const EXHAUSTED_TRY = `    try {
      await completeRun({
        runId: run.id,
        status: "failed",
        findings: [],
        error: \`attempts exhausted (\${run.attempts} > \${MAX_ATTEMPTS})\`,
      });
    } catch (err) {
      logger.warn({ err, runId: run.id }, "proofread.exhausted_write_failed");
    }
`;
const EXHAUSTED_BARE = `    await completeRun({
      runId: run.id,
      status: "failed",
      findings: [],
      error: \`attempts exhausted (\${run.attempts} > \${MAX_ATTEMPTS})\`,
    });
`;

const MUTATIONS = [
  // lifecycle.ts
  {
    label: "restate the predicate inside CLAIM_SQL instead of composing it",
    file: "lifecycle",
    flips: ["claim-sql-composed", "predicate-single-copy"],
    apply: (s) => ({
      ...s,
      lifecycle: s.lifecycle.replace("WHERE ${CLAIM_PREDICATE_SQL}", "WHERE status = 'queued' OR (status = 'running' AND claimed_at < now() - interval '900 seconds')"),
      // CLAIM_SQL literally contains the predicate while it is composed from it,
      // so replacing that text is exactly the "restate it instead" edit.
      vals: { ...s.vals, CLAIM_SQL: s.vals.CLAIM_SQL.replace(s.vals.CLAIM_PREDICATE_SQL, "status = 'queued' OR (status = 'running' AND claimed_at < now() - interval '900 seconds')") },
    }),
  },
  {
    label: "export a degenerate predicate (the queued arm alone)",
    file: "lifecycle",
    flips: ["predicate-exported"],
    also: ["claim-sql-composed", "predicate-lease-from-lease-ms"],
    apply: (s) => ({ ...s, vals: { ...s.vals, CLAIM_PREDICATE_SQL: "status = 'queued'" } }),
  },
  {
    label: "hard-code a 15-minute lease in the predicate",
    file: "lifecycle",
    flips: ["predicate-lease-from-lease-ms"],
    also: ["claim-sql-composed"],
    apply: (s) => ({ ...s, vals: { ...s.vals, CLAIM_PREDICATE_SQL: s.vals.CLAIM_PREDICATE_SQL.replace(/interval '\d+ seconds'/, "interval '900 seconds'") } }),
  },
  {
    label: "restore the stale 'the code that actually runs' comment",
    file: "lifecycle",
    flips: ["predicate-comments-corrected"],
    apply: edit("lifecycle", "Mirrors the WHERE clause of", "Mirrors the WHERE clause of CLAIM_SQL, which is the code that actually runs,"),
  },

  // proofread-store.ts
  {
    label: "give the store its own copy of the predicate",
    file: "store",
    flips: ["store-imports-predicate", "store-no-local-predicate", "claim-no-restated-lease"],
    apply: (s) => ({
      ...s,
      store: s.store
        .replace(/import \{ (CLAIM_PREDICATE_SQL[^}]*)\} from "\.\/proofread\/lifecycle\.ts";/, "const CLAIM_PREDICATE_SQL = `status = 'queued' OR (status = 'running' AND claimed_at < now() - interval '600 seconds')`;"),
    }),
  },
  {
    label: "restore the `claimed_at IS NOT NULL AND` handling in the claim",
    file: "store",
    flips: ["claim-uses-shared-predicate", "claim-no-restated-lease"],
    apply: edit("store", "WHERE ${sql.raw(CLAIM_PREDICATE_SQL)}", "WHERE status = 'queued' OR (status = 'running' AND claimed_at IS NOT NULL AND claimed_at < now() - interval '600 seconds')"),
  },
  {
    label: "stamp claimed_at from this instance's clock",
    file: "store",
    flips: ["claim-stamps-db-clock", "claim-no-instance-clock"],
    apply: edit("store", "claimedAt: sql`now()`", "claimedAt: new Date()"),
  },
  {
    label: "move claimedAt out of the claim's .set()",
    file: "store",
    flips: ["claim-stamps-db-clock", "claim-set-is-atomic"],
    apply: edit("store", /\n *claimedAt: sql`now\(\)`,/, ""),
  },
  {
    label: "stop counting the attempt in the claim",
    file: "store",
    flips: ["claim-set-is-atomic"],
    apply: edit("store", /\n *attempts: sql`\$\{studyProofreadRunsTable\.attempts\} \+ 1`,/, ""),
  },
  {
    label: "claim through db.execute(sql.raw(...)) with a cast",
    file: "store",
    flips: ["store-never-executes-raw", "claim-returns-mapped-row"],
    also: ["claim-stamps-db-clock", "claim-set-is-atomic", "claim-uses-shared-predicate", "claim-takes-one-locked-row"],
    apply: (s) => {
      const b = body(s.store, "claimOneRun");
      return { ...s, store: s.store.replace(b, 'export async function claimOneRun(instanceId: string): Promise<StudyProofreadRun | null> {\n  const res = await db.execute(sql.raw(CLAIM_SQL));\n  return (res.rows[0] as StudyProofreadRun) ?? null;\n}\n') };
    },
  },
  {
    label: "drop FOR UPDATE SKIP LOCKED from the claim's subselect",
    file: "store",
    flips: ["claim-takes-one-locked-row"],
    apply: edit("store", /\n *FOR UPDATE SKIP LOCKED/, ""),
  },
  {
    label: "read the max revision, then insert it",
    file: "store",
    flips: ["revision-derived-in-sql"],
    apply: edit("store", /revision: sql`\(SELECT coalesce\(max\(revision\), 0\) \+ 1 FROM study_proofread_runs WHERE project_id = \$\{args\.projectId\}\)`/, "revision: nextRevision"),
  },
  {
    label: "record the queuing deploy's engine stamp as the run's rules version (RR-2: varchar either way, tsc is silent)",
    file: "store",
    flips: ["queued-run-records-what-it-was-given"],
    apply: edit("store", "      rulesVersion: args.rulesVersion,", "      rulesVersion: args.engineStamp,"),
  },
  {
    label: "record a literal rules version at queue time",
    file: "store",
    flips: ["queued-run-records-what-it-was-given"],
    apply: edit("store", "      rulesVersion: args.rulesVersion,", '      rulesVersion: "2",'),
  },
  {
    label: "record the rules version as the engine stamp at queue time",
    file: "store",
    flips: ["queued-run-records-what-it-was-given"],
    apply: edit("store", "      engineStamp: args.engineStamp,\n      inputManifest: {},", "      engineStamp: args.rulesVersion,\n      inputManifest: {},"),
  },
  {
    label: "a second rulesVersion key after the first in the queued row (the later key wins)",
    file: "store",
    flips: ["queued-run-records-what-it-was-given"],
    apply: edit("store", "      requestedByUserId: args.userId,", "      requestedByUserId: args.userId,\n      rulesVersion: args.engineStamp,"),
  },
  {
    label: "rebind args with the engine stamp as the rules version at the top of insertQueuedRun (W2-G1-2, C1e)",
    file: "store",
    flips: ["queued-run-records-what-it-was-given"],
    apply: edit("store", "}): Promise<StudyProofreadRun | null> {\n", "}): Promise<StudyProofreadRun | null> {\n  args = { ...args, rulesVersion: args.engineStamp };\n"),
  },
  {
    label: "write the engine stamp over args.rulesVersion through Object.assign before the insert",
    file: "store",
    flips: ["queued-run-records-what-it-was-given"],
    apply: edit("store", "}): Promise<StudyProofreadRun | null> {\n", "}): Promise<StudyProofreadRun | null> {\n  Object.assign(args, { rulesVersion: args.engineStamp });\n"),
  },
  {
    label: "write the engine stamp over args[\"rulesVersion\"] by element access before the insert",
    file: "store",
    flips: ["queued-run-records-what-it-was-given"],
    apply: edit("store", "}): Promise<StudyProofreadRun | null> {\n", "}): Promise<StudyProofreadRun | null> {\n  args[\"rulesVersion\"] = args.engineStamp;\n"),
  },
  {
    label: "write the run-time engine stamp into rules_version (RR-2)",
    file: "store",
    flips: ["run-stamp-written-as-given"],
    apply: edit("store", "rulesVersion: args.stamp.rulesVersion,", "rulesVersion: args.stamp.engineStamp,"),
  },
  {
    label: "drop the run-time protocol version from the stamp",
    file: "store",
    flips: ["run-stamp-written-as-given"],
    apply: edit("store", /\n *protocolVersion: args\.stamp\.protocolVersion,/, ""),
  },
  {
    label: "never write the run-time stamp (the stamp spread removed)",
    file: "store",
    flips: ["run-stamp-written-as-given"],
    apply: edit("store", /\n *\.\.\.\(args\.stamp === undefined\n[\s\S]*?\}\),/, ""),
  },
  {
    label: "write the stamp only when none was handed (the condition inverted)",
    file: "store",
    flips: ["run-stamp-written-as-given"],
    apply: edit("store", "args.stamp === undefined", "args.stamp !== undefined"),
  },
  {
    label: "ask about the finding's own id instead of its run (another run's answer)",
    file: "store",
    flips: ["run-holds-findings-reads-this-run"],
    apply: edit("store", "    .where(eq(studyProofreadFindingsTable.runId, runId))\n    .limit(1);\n  return row !== undefined;", "    .where(eq(studyProofreadFindingsTable.id, runId))\n    .limit(1);\n  return row !== undefined;"),
  },
  {
    label: "answer that a run holds findings when none came back",
    file: "store",
    flips: ["run-holds-findings-reads-this-run"],
    apply: edit("store", "  return row !== undefined;", "  return row === undefined;"),
  },
  {
    label: "always write coverage in completeRun, even on a requeue",
    file: "store",
    flips: ["complete-keeps-prior-coverage"],
    apply: edit("store", /\.\.\.\(args\.coverage === undefined \? \{\} : \{ coverage: args\.coverage as object \}\),/, "coverage: (args.coverage ?? []) as object,"),
  },
  {
    label: "insert findings without onConflictDoNothing",
    file: "store",
    flips: ["findings-insert-idempotent"],
    apply: edit("store", /\.onConflictDoNothing\(\{[\s\S]*?\}\);/, ";"),
  },
  {
    label: "drop the firm scope from the panel read",
    file: "store",
    flips: ["panel-read-is-firm-scoped"],
    apply: edit("store", /and\(eq\(studyProofreadRunsTable\.firmId, firmId\), /, "and("),
  },
  {
    label: "carry dispositions forward across a rules-version change",
    file: "store",
    flips: ["carry-forward-requires-same-rules"],
    apply: edit("store", "if (!sameRules) return 0;", ""),
  },
  {
    label: "report the previous run's engine stamp as its rules version (same type; tsc is silent)",
    file: "store",
    flips: ["previous-run-reports-its-rules-version"],
    apply: edit("store", "rulesVersion: studyProofreadRunsTable.rulesVersion }", "rulesVersion: studyProofreadRunsTable.engineStamp }"),
  },
  {
    label: "move the rules-version return below the carry loop (every decision is appended, then 0 is returned)",
    file: "store",
    flips: ["carry-forward-requires-same-rules"],
    apply: (s) => ({ ...s, store: s.store.replace("  if (!sameRules) return 0;\n", "").replace("  if (carried) logger.info(", "  if (!sameRules) return 0;\n  if (carried) logger.info(") }),
  },
  {
    label: "read the previous run's findings before the rules-version return",
    file: "store",
    flips: ["carry-forward-requires-same-rules"],
    apply: edit("store", "  if (!sameRules) return 0;\n", "  const early = await db.select().from(studyProofreadFindingsTable).where(eq(studyProofreadFindingsTable.runId, previousRunId));\n  void early;\n  if (!sameRules) return 0;\n"),
  },
  {
    label: "invert the rules-version return (carry only across a bump)",
    file: "store",
    flips: ["carry-forward-requires-same-rules"],
    apply: edit("store", "  if (!sameRules) return 0;\n", "  if (sameRules) return 0;\n"),
  },
  {
    label: "rewrite the previous run's rules version after the read",
    file: "store",
    flips: ["previous-run-reports-its-rules-version"],
    apply: edit("store", PREVIOUS_RUN_END, `  if (row) row.rulesVersion = "2";\n${PREVIOUS_RUN_END}`),
  },
  {
    label: "rebuild the previous run in the return with a fixed rules version",
    file: "store",
    flips: ["previous-run-reports-its-rules-version"],
    apply: edit("store", PREVIOUS_RUN_END, PREVIOUS_RUN_END.replace("return row ?? null;", 'return row ? { id: row.id, rulesVersion: "2" } : null;')),
  },
  {
    label: "report the engine stamp, read by a second select, as the previous run's rules version",
    file: "store",
    flips: ["previous-run-reports-its-rules-version"],
    apply: edit(
      "store",
      PREVIOUS_RUN_END,
      `  const [s2] = await db.select({ e: studyProofreadRunsTable.engineStamp }).from(studyProofreadRunsTable).where(eq(studyProofreadRunsTable.id, row?.id ?? "")).limit(1);\n  if (row && s2) row.rulesVersion = s2.e;\n${PREVIOUS_RUN_END}`,
    ),
  },
  {
    label: "remap the previous run's rows inside the read's chain (.then)",
    file: "store",
    flips: ["previous-run-reports-its-rules-version"],
    apply: edit("store", `    .limit(1);\n${PREVIOUS_RUN_END}`, `    .limit(1)\n    .then((rs) => rs.map((r) => ({ ...r, rulesVersion: "2" })));\n${PREVIOUS_RUN_END}`),
  },
  {
    label: "take the OLDEST finished revision as the carry source (ascending order)",
    file: "store",
    flips: ["previous-run-is-the-newest-before"],
    apply: edit("store", `    .orderBy(desc(studyProofreadRunsTable.revision))\n    .limit(1);\n${PREVIOUS_RUN_END}`, `    .orderBy(studyProofreadRunsTable.revision)\n    .limit(1);\n${PREVIOUS_RUN_END}`),
  },
  {
    label: "order the carry source by creation time instead of revision",
    file: "store",
    flips: ["previous-run-is-the-newest-before"],
    apply: edit("store", `    .orderBy(desc(studyProofreadRunsTable.revision))\n    .limit(1);\n${PREVIOUS_RUN_END}`, `    .orderBy(desc(studyProofreadRunsTable.createdAt))\n    .limit(1);\n${PREVIOUS_RUN_END}`),
  },
  {
    label: "leave the carry source unordered (any finished revision)",
    file: "store",
    flips: ["previous-run-is-the-newest-before"],
    apply: edit("store", `    .orderBy(desc(studyProofreadRunsTable.revision))\n    .limit(1);\n${PREVIOUS_RUN_END}`, `    .limit(1);\n${PREVIOUS_RUN_END}`),
  },
  {
    label: "append the carried disposition without checking for one",
    file: "store",
    flips: ["carry-forward-idempotent"],
    apply: edit("store", "if (already) continue;", ""),
  },
  {
    label: "carry forward from the previous revision whatever its status",
    file: "store",
    flips: ["previous-run-is-finished"],
    apply: edit("store", /\n *inArray\(studyProofreadRunsTable\.status, \["rules_ready", "ready"\]\),/, ""),
  },
  {
    label: "carry only from a rules_ready revision (every decision accepted on a 'ready' run is stranded)",
    file: "store",
    flips: ["previous-run-is-finished"],
    apply: edit("store", 'inArray(studyProofreadRunsTable.status, ["rules_ready", "ready"])', 'eq(studyProofreadRunsTable.status, "rules_ready")'),
  },
  {
    label: "carry from a revision in any status but failed",
    file: "store",
    flips: ["previous-run-is-finished"],
    apply: edit("store", 'inArray(studyProofreadRunsTable.status, ["rules_ready", "ready"])', 'sql`${studyProofreadRunsTable.status} <> \'failed\'`'),
  },
  {
    label: "check the finding's run but not its firm",
    file: "store",
    flips: ["finding-scope-is-one-query"],
    apply: edit("store", /\n *eq\(studyProofreadRunsTable\.firmId, firmId\),/, ""),
  },

  {
    label: "key the duplicate check on the OLD finding (it never matches, so the carried row is appended on every re-run)",
    file: "store",
    flips: ["carry-forward-idempotent"],
    apply: edit("store", "eq(studyProofreadDispositionsTable.findingId, nf.id),", "eq(studyProofreadDispositionsTable.findingId, match.id),"),
  },
  {
    label: "carry the OLDEST disposition instead of the newest",
    file: "store",
    flips: ["carry-forward-reads-the-newest"],
    apply: edit(
      "store",
      ".where(eq(studyProofreadDispositionsTable.findingId, match.id))\n      .orderBy(desc(studyProofreadDispositionsTable.createdAt))",
      ".where(eq(studyProofreadDispositionsTable.findingId, match.id))\n      .orderBy(studyProofreadDispositionsTable.createdAt)",
    ),
  },
  {
    label: "drop the limit(1) from the prior-disposition lookup",
    file: "store",
    flips: ["carry-forward-reads-the-newest"],
    apply: edit(
      "store",
      ".orderBy(desc(studyProofreadDispositionsTable.createdAt))\n      .limit(1);\n    if (!prior[0]) continue;",
      ".orderBy(desc(studyProofreadDispositionsTable.createdAt));\n    if (!prior[0]) continue;",
    ),
  },
  {
    label: "let the carried row take the column default (now(): the re-run's date)",
    file: "store",
    flips: ["carry-forward-keeps-the-decision-date"],
    apply: edit("store", /\n *createdAt: prior\[0\]\.createdAt,/, ""),
  },
  {
    label: "stamp the carried row with this instance's clock",
    file: "store",
    flips: ["carry-forward-keeps-the-decision-date"],
    apply: edit("store", "createdAt: prior[0].createdAt,", "createdAt: new Date(),"),
  },
  {
    label: "date the carried row by the NEW finding (when the re-run wrote it)",
    file: "store",
    flips: ["carry-forward-keeps-the-decision-date"],
    apply: edit("store", "createdAt: prior[0].createdAt,", "createdAt: nf.createdAt,"),
  },
  {
    label: "date the carried row by the OLD finding (when the first run wrote it, not when it was decided)",
    file: "store",
    flips: ["carry-forward-keeps-the-decision-date"],
    apply: edit("store", "createdAt: prior[0].createdAt,", "createdAt: match.createdAt,"),
  },
  {
    label: "write the carried disposition against the OLD finding",
    file: "store",
    flips: ["carry-forward-writes-the-new-finding"],
    apply: edit("store", ".values({\n      findingId: nf.id,", ".values({\n      findingId: match.id,"),
  },
  {
    label: "look back with lte, which returns the run itself",
    file: "store",
    flips: ["previous-run-is-strictly-earlier"],
    apply: edit("store", "lt(studyProofreadRunsTable.revision, beforeRevision)", "lte(studyProofreadRunsTable.revision, beforeRevision)"),
  },
  {
    label: "make the panel read's firm and project scopes an `or`",
    file: "store",
    flips: ["panel-read-is-firm-scoped"],
    apply: edit(
      "store",
      ".where(and(eq(studyProofreadRunsTable.firmId, firmId), eq(studyProofreadRunsTable.projectId, projectId)))",
      ".where(or(eq(studyProofreadRunsTable.firmId, firmId), eq(studyProofreadRunsTable.projectId, projectId)))",
    ),
  },
  {
    label: "make the finding-scope check an `or` (one character; any firm could then rule on another firm's finding)",
    file: "store",
    flips: ["finding-scope-is-one-query"],
    apply: edit(
      "store",
      "      and(\n        eq(studyProofreadFindingsTable.id, findingId),",
      "      or(\n        eq(studyProofreadFindingsTable.id, findingId),",
    ),
  },

  {
    label: "drop the project scope from previousRunForProject (cross-tenant: any firm's run becomes the carry source)",
    file: "store",
    flips: ["previous-run-is-this-project"],
    apply: edit(
      "store",
      "        eq(studyProofreadRunsTable.projectId, projectId),\n        lt(studyProofreadRunsTable.revision, beforeRevision),",
      "        lt(studyProofreadRunsTable.revision, beforeRevision),",
    ),
  },
  {
    label: "swap previousRunId and newRunId in the carry's two finding reads",
    file: "store",
    flips: ["carry-forward-reads-old-then-new"],
    apply: edit(
      "store",
      "where(eq(studyProofreadFindingsTable.runId, previousRunId)),\n    db.select().from(studyProofreadFindingsTable).where(eq(studyProofreadFindingsTable.runId, newRunId)),",
      "where(eq(studyProofreadFindingsTable.runId, newRunId)),\n    db.select().from(studyProofreadFindingsTable).where(eq(studyProofreadFindingsTable.runId, previousRunId)),",
    ),
  },
  {
    label: "match old to new findings with !== instead of ===",
    file: "store",
    flips: ["carry-forward-matches-by-fingerprint"],
    apply: edit("store", "of.fingerprint === nf.fingerprint", "of.fingerprint !== nf.fingerprint"),
  },

  // proofread-run.ts
  {
    label: "slice the finished instance id instead of the host (M07: the pid falls off a long-named host)",
    file: "runner",
    flips: ["instance-id-fits-claimed-by"],
    apply: edit("runner", "return `${host.slice(0, 63 - pid.length)}-${pid}`;", "return `${host}-${pid}`.slice(0, 64);"),
  },
  {
    label: "slice the host to 64 with no room reserved for the pid",
    file: "runner",
    flips: ["instance-id-fits-claimed-by"],
    apply: edit("runner", "host.slice(0, 63 - pid.length)", "host.slice(0, 64)"),
  },
  {
    label: "do not truncate the host at all",
    file: "runner",
    flips: ["instance-id-fits-claimed-by"],
    apply: edit("runner", "host.slice(0, 63 - pid.length)", "host"),
  },
  {
    label: "hard-code the host slice for a 6-digit pid (57): 65 characters at 7 digits",
    file: "runner",
    flips: ["instance-id-fits-claimed-by"],
    apply: edit("runner", "host.slice(0, 63 - pid.length)", "host.slice(0, 57)"),
  },
  {
    label: "reference an undefined name in the initializer (a throw must be reported as a throw)",
    file: "runner",
    flips: ["instance-id-initializer-evaluates"],
    also: ["instance-id-fits-claimed-by"],
    apply: edit("runner", "const pid = String(process.pid);", "const pid = String(processPid);"),
  },
  {
    label: "drop findings from the first completeRun call",
    file: "runner",
    flips: ["pass-writes-findings-and-coverage"],
    apply: edit("runner", "      inputManifest: buildInputManifest(rec),\n      findings,\n", "      inputManifest: buildInputManifest(rec),\n"),
  },
  {
    label: "write findings: [] in the first completeRun call (type-checks, writes nothing)",
    file: "runner",
    flips: ["pass-writes-findings-and-coverage"],
    apply: edit("runner", "      inputManifest: buildInputManifest(rec),\n      findings,\n", "      inputManifest: buildInputManifest(rec),\n      findings: [],\n"),
  },
  {
    label: "drop coverage from the first completeRun call",
    file: "runner",
    flips: ["pass-writes-findings-and-coverage"],
    apply: edit("runner", '      status: "running",\n      coverage,\n', '      status: "running",\n'),
  },
  {
    label: "give the runner its own MAX_ATTEMPTS",
    file: "runner",
    flips: ["max-attempts-from-policy"],
    apply: (s) => ({
      ...s,
      runner: s.runner
        .replace(/import \{ MAX_ATTEMPTS, nextStatusAfterFailure \} from "\.\/proofread\/lifecycle\.ts";/, 'import { nextStatusAfterFailure } from "./proofread/lifecycle.ts";\nconst MAX_ATTEMPTS = 3;'),
    }),
  },
  {
    label: "let an exhausted row run the clauses before it is failed",
    file: "runner",
    flips: ["exhausted-fails-without-running"],
    apply: edit("runner", "if (run.attempts > MAX_ATTEMPTS)", "if (false && run.attempts > MAX_ATTEMPTS)"),
  },
  {
    label: "unwrap the exhausted branch's completeRun (final review: POST run answered 500 after queuing)",
    file: "runner",
    flips: ["exhausted-write-is-caught"],
    apply: (s) => ({ ...s, runner: s.runner.replace(EXHAUSTED_TRY, EXHAUSTED_BARE) }),
  },
  {
    label: "rethrow from the exhausted branch's catch",
    file: "runner",
    flips: ["exhausted-write-is-caught"],
    apply: edit("runner", '"proofread.exhausted_write_failed");\n', '"proofread.exhausted_write_failed");\n      throw err;\n'),
  },
  {
    label: "reject from the exhausted branch's catch without a throw (return Promise.reject)",
    file: "runner",
    flips: ["exhausted-write-is-caught"],
    apply: edit("runner", '"proofread.exhausted_write_failed");\n', '"proofread.exhausted_write_failed");\n      return Promise.reject(err);\n'),
  },
  {
    label: "return from the exhausted branch's catch (the run is never reported as worked)",
    file: "runner",
    flips: ["exhausted-write-is-caught"],
    apply: edit("runner", '"proofread.exhausted_write_failed");\n', '"proofread.exhausted_write_failed");\n      return false;\n'),
  },
  {
    label: "log the exhausted write's failure without the run id",
    file: "runner",
    flips: ["exhausted-write-is-caught"],
    apply: edit("runner", "logger.warn({ err, runId: run.id }, \"proofread.exhausted_write_failed\")", "logger.warn({ err }, \"proofread.exhausted_write_failed\")"),
  },
  {
    label: "keep the try, but write the failure a second time outside it",
    file: "runner",
    flips: ["exhausted-write-is-caught"],
    apply: edit("runner", '    logger.warn({ runId: run.id, attempts: run.attempts }, "proofread.attempts_exhausted");', '    await completeRun({ runId: run.id, status: "failed", findings: [] });\n    logger.warn({ runId: run.id, attempts: run.attempts }, "proofread.attempts_exhausted");'),
  },
  {
    label: "fail every failed pass terminally instead of asking the policy",
    file: "runner",
    flips: ["failure-status-from-policy"],
    apply: edit("runner", /const status = nextStatusAfterFailure\(\{[^}]*\}\);/, 'const status = "failed" as const;'),
  },
  {
    label: "wipe coverage on the failure path",
    file: "runner",
    flips: ["failure-keeps-prior-coverage"],
    apply: edit("runner", /(await completeRun\(\{\n *runId: run\.id,\n *status,)/, "$1\n      coverage: [],\n      inputManifest: {},"),
  },
  {
    label: "flip the status to rules_ready before the carry (m4: the window that loses a WITHDRAWN)",
    file: "runner",
    flips: ["status-flips-after-the-carry"],
    // the stamp check finds the clause pass's write by its status "running", and there is none
    also: ["pass-writes-findings-and-coverage", "pass-stamps-the-code-that-ran-it"],
    apply: (s) => ({
      ...s,
      runner: s.runner
        .replace('      status: "running",\n', '      status: "rules_ready",\n')
        .replace('    await completeRun({ runId: run.id, status: "rules_ready", findings: [] });\n', ""),
    }),
  },
  {
    label: "keep both calls but flip the status in the first one",
    file: "runner",
    flips: ["status-flips-after-the-carry"],
    also: ["pass-writes-findings-and-coverage", "pass-stamps-the-code-that-ran-it"],
    apply: edit("runner", '      status: "running",\n', '      status: "rules_ready",\n'),
  },
  {
    label: "carry dispositions forward before the findings are written",
    file: "runner",
    flips: ["status-flips-after-the-carry"],
    apply: (s) => {
      const b = body(s.runner, "claimAndRunOne");
      const carry = /\n *const prev = await previousRunForProject\([\s\S]*?\n *if \(prev\) await carryForwardDispositions\([^;]*;/.exec(b);
      if (!carry) return s;
      // Moved to just before the FIRST completeRun of the pass — the one that
      // writes the findings. (It used to be re-inserted after a 4-space
      // `    try {`, which this body does not contain, so the edit deleted the
      // carry instead of moving it; the carry's own call-site checks exposed it.)
      const first = '\n    await completeRun({\n      runId: run.id,\n      status: "running",';
      if (!b.includes(first)) return s;
      const moved = b.replace(carry[0], "").replace(first, `${carry[0]}${first}`);
      return { ...s, runner: s.runner.replace(b, moved) };
    },
  },
  {
    label: "swap the carry's two run ids (deferred item 0: every guard stayed green)",
    file: "runner",
    flips: ["carry-writes-this-run-from-prev"],
    apply: edit("runner", "carryForwardDispositions(run.id, prev.id,", "carryForwardDispositions(prev.id, run.id,"),
  },
  {
    label: "look the carry source up by run.id instead of run.projectId (deferred item 0)",
    file: "runner",
    flips: ["carry-looks-back-from-this-run"],
    apply: edit("runner", "previousRunForProject(run.projectId, run.revision)", "previousRunForProject(run.id, run.revision)"),
  },
  {
    label: "re-bind run with the run id as its project before the carry source is read",
    file: "runner",
    flips: ["carry-looks-back-from-this-run"],
    apply: edit("runner", "    const prev = await previousRunForProject(", "    run = { ...run, projectId: run.id };\n    const prev = await previousRunForProject("),
  },
  {
    label: "move the claimed run's project to its id through Object.assign before the carry source is read (W2-G1-2, C9e)",
    file: "runner",
    flips: ["carry-looks-back-from-this-run"],
    apply: edit("runner", "    const prev = await previousRunForProject(", "    Object.assign(run, { projectId: run.id });\n    const prev = await previousRunForProject("),
  },
  {
    label: "move the claimed run's revision on through Reflect.set before the carry source is read",
    file: "runner",
    flips: ["carry-looks-back-from-this-run"],
    apply: edit("runner", "    const prev = await previousRunForProject(", "    Reflect.set(run, \"revision\", run.revision + 1);\n    const prev = await previousRunForProject("),
  },
  {
    label: "move the claimed run's project to its id by element access before the carry source is read",
    file: "runner",
    flips: ["carry-looks-back-from-this-run"],
    apply: edit("runner", "    const prev = await previousRunForProject(", "    run[\"projectId\"] = run.id;\n    const prev = await previousRunForProject("),
  },
  {
    label: "move the claimed run's revision on before the carry source is read",
    file: "runner",
    flips: ["carry-looks-back-from-this-run"],
    apply: edit("runner", "    const prev = await previousRunForProject(", "    run.revision = run.revision + 1;\n    const prev = await previousRunForProject("),
  },
  {
    label: "look back from the revision after this one (the run becomes its own carry source)",
    file: "runner",
    flips: ["carry-looks-back-from-this-run"],
    apply: edit("runner", "previousRunForProject(run.projectId, run.revision)", "previousRunForProject(run.projectId, run.revision + 1)"),
  },
  {
    label: "gate the carry on the engine stamp, which ends in the deploy's commit (final review I-1)",
    file: "runner",
    flips: ["carry-gate-is-the-rules-version"],
    apply: edit("runner", "prev.rulesVersion === RULES_VERSION", "(prev as any).engineStamp === engineStamp()"),
  },
  {
    label: "carry whatever the rules version (the gate replaced with true)",
    file: "runner",
    flips: ["carry-gate-is-the-rules-version"],
    apply: edit("runner", "prev.rulesVersion === RULES_VERSION", "true"),
  },
  {
    label: "invert the gate (carry only across a rules bump)",
    file: "runner",
    flips: ["carry-gate-is-the-rules-version"],
    apply: edit("runner", "prev.rulesVersion === RULES_VERSION", "prev.rulesVersion !== RULES_VERSION"),
  },
  {
    label: "compare the previous run's rules version with itself (always true)",
    file: "runner",
    flips: ["carry-gate-is-the-rules-version"],
    apply: edit("runner", "prev.rulesVersion === RULES_VERSION", "prev.rulesVersion === prev.rulesVersion"),
  },
  {
    label: "gate the carry on the claimed row's rules version, written when it was QUEUED (RR-1: a run queued before a bump carried across it)",
    file: "runner",
    flips: ["carry-gate-is-the-rules-version"],
    apply: edit("runner", "prev.rulesVersion === RULES_VERSION", "prev.rulesVersion === run.rulesVersion"),
  },
  {
    label: "drop the stamp from the clause pass's write (the row keeps the queuing deploy's versions)",
    file: "runner",
    flips: ["pass-stamps-the-code-that-ran-it"],
    apply: edit("runner", "      stamp: { rulesVersion: RULES_VERSION, engineStamp: engineStamp(), protocolVersion: PROTOCOL_VERSION },\n", ""),
  },
  {
    label: "stamp the engine stamp as the run's rules version",
    file: "runner",
    flips: ["pass-stamps-the-code-that-ran-it"],
    apply: edit("runner", "stamp: { rulesVersion: RULES_VERSION,", "stamp: { rulesVersion: engineStamp(),"),
  },
  {
    label: "stamp the run with the claimed row's own (queue-time) values",
    file: "runner",
    flips: ["pass-stamps-the-code-that-ran-it"],
    apply: edit("runner", "stamp: { rulesVersion: RULES_VERSION, engineStamp: engineStamp(), protocolVersion: PROTOCOL_VERSION }", "stamp: { rulesVersion: run.rulesVersion, engineStamp: run.engineStamp, protocolVersion: run.protocolVersion }"),
  },
  {
    label: "also stamp the run when it fails because its rules changed mid-run",
    file: "runner",
    flips: ["pass-stamps-the-code-that-ran-it"],
    apply: edit("runner", 'error: "rules_changed_mid_run" });', 'error: "rules_changed_mid_run", stamp: { rulesVersion: RULES_VERSION, engineStamp: engineStamp(), protocolVersion: PROTOCOL_VERSION } });'),
  },
  {
    label: "never make the carry call (`if (false && prev)`)",
    file: "runner",
    flips: ["carry-writes-this-run-from-prev"],
    apply: edit("runner", "if (prev) await carryForwardDispositions(", "if (false && prev) await carryForwardDispositions("),
  },
  {
    label: "throw out of enqueueProofread when the insert yields no row",
    file: "runner",
    flips: ["enqueue-no-row-returns-without-draining"],
    apply: edit("runner", /if \(!run\) \{[\s\S]*?\n  \}/, 'if (!run) throw new Error("enqueue failed");'),
  },
  {
    label: "drain before the no-row branch is reached",
    file: "runner",
    flips: ["enqueue-no-row-returns-without-draining"],
    apply: (s) => ({ ...s, runner: s.runner.replace("  await claimAndRunOne();\n}", "}").replace("  if (!run) {\n    logger.warn({ projectId: args.projectId }", "  await claimAndRunOne();\n  if (!run) {\n    logger.warn({ projectId: args.projectId }") }),
  },
  {
    label: "drain even when the insert yielded no row",
    file: "runner",
    flips: ["enqueue-no-row-returns-without-draining"],
    apply: edit("runner", /\n  if \(!run\) \{[\s\S]*?\n  \}/, ""),
  },
];

const teeth = new Map(CHECKS.map((c) => [c.id, c]));
for (const m of MUTATIONS) {
  const unknown = m.flips.filter((id) => !teeth.has(id));
  ok(unknown.length === 0, `teeth: "${m.label}" names only real checks`, unknown.length ? `unknown check id(s): ${unknown.join(", ")}` : undefined);
  const mutated = m.apply(sources);
  const changed = ["store", "runner", "lifecycle"].some((f) => mutated[f] !== sources[f]) || JSON.stringify(mutated.vals) !== JSON.stringify(sources.vals);
  ok(changed, `teeth: "${m.label}" actually changes the source (a mutation that applied to nothing would prove nothing)`);
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
ok(toothless.length === 0, `every check has a mutation proving it has teeth`, toothless.length ? `no mutation breaks: ${toothless.join(", ")}` : undefined);

// Edits that must leave every check GREEN: the same code, written another way.
// Each must apply (an edit that matched nothing proves nothing) and turn
// nothing red — a pin that refused them would be pinning spelling, not meaning.
const STAYS_GREEN = [
  {
    label: "the carry gate with its operands swapped (RULES_VERSION === prev.rulesVersion) — the same comparison",
    file: "runner",
    apply: edit("runner", "prev.rulesVersion === RULES_VERSION", "RULES_VERSION === prev.rulesVersion"),
  },
];
for (const g of STAYS_GREEN) {
  const mutated = g.apply(sources);
  ok(mutated[g.file] !== sources[g.file], `stays green: "${g.label}" applies to the source`);
  const now = run(mutated).filter((id) => !failing.includes(id));
  ok(now.length === 0, `stays green: "${g.label}" — no check refuses it`, now.length ? `went red: ${now.join(", ")}` : undefined);
}

// ===========================================================================
// BEHAVIOUR. Everything above reads text; this part RUNS the runner.
//
// proofread-run.ts — the real file, or a mutated copy of its text — is bundled
// with esbuild, with three of its imports replaced by in-memory stubs:
// ./proofread-store (each function records its arguments and does what the
// scenario says, throwing included), ./logger (records every line) and
// ./proofread/index.ts (no clauses, a fixed RULES_VERSION and engineStamp, so
// the scenario controls everything the runner sees). ./proofread/lifecycle.ts
// is the real one. The runner's only import of @workspace/db is `import type`,
// which esbuild drops, and a bundle whose input list holds anything but the
// runner, the stubs and lifecycle.ts is refused before it is imported.
//
// That refusal sees what esbuild RESOLVES at bundle time: every static
// spelling of a store or db import, and an import() whose specifier is a
// literal. It does not see an import whose specifier is computed at run time
// (`import(someString)`): esbuild leaves it out of the input list, the bundle
// is accepted and run, and Node links whatever the string names. In this tree
// such an import of the real store stops at lib/db's directory import of
// ./schema, which Node's ESM loader refuses — an incidental barrier, not this
// guard's. And DATABASE_URL is deleted from this process's environment at the
// top of this file, so lib/db/src/index.ts, if it were ever linked that way,
// throws "DATABASE_URL must be set" at evaluation instead of making a pool.
//
// What this proves is what the RUNNER does with what the store hands it: which
// ids the carry is given, what gates it, what is caught and what propagates.
// It cannot prove what the store does with them — that is SQL, which only a
// database executes.
// ===========================================================================
const runnerDir = path.resolve(here, "../src/lib");
const STUB_SOURCES = {
  "./proofread-store": `
const st = () => globalThis.__proofreadRunnerStub;
const call = (name) => async (...args) => st().call(name, args);
export const insertQueuedRun = call("insertQueuedRun");
export const claimOneRun = call("claimOneRun");
export const completeRun = call("completeRun");
export const loadStudyForRun = call("loadStudyForRun");
export const previousRunForProject = call("previousRunForProject");
export const carryForwardDispositions = call("carryForwardDispositions");
export const runHoldsFindings = call("runHoldsFindings");
`,
  "./logger": `
const st = () => globalThis.__proofreadRunnerStub;
const line = (level) => (obj, msg) => st().log(level, obj, msg);
export const logger = { trace: line("trace"), debug: line("debug"), info: line("info"), warn: line("warn"), error: line("error"), fatal: line("fatal") };
`,
  "./proofread/index.ts": `
const st = () => globalThis.__proofreadRunnerStub;
export const ALL_CLAUSES = [];
export const RULES_VERSION = "rules-current";
export const engineStamp = () => "stamp-this-deploy";
export const runClauses = (...args) => st().call("runClauses", args) ?? { findings: [], coverage: [] };
`,
};

async function bundleRunner(text) {
  const out = await build({
    // A name no real file in src/lib has, so the input list can tell the
    // runner under test from anything it pulls in.
    stdin: { contents: text, resolveDir: runnerDir, sourcefile: "runner-under-test.ts", loader: "ts" },
    absWorkingDir: runnerDir,
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    tsconfigRaw: "{}",
    metafile: true,
    logLevel: "silent",
    plugins: [
      {
        name: "proofread-runner-stubs",
        setup(b) {
          // Only the runner's OWN imports are stubbed: a real module pulled in
          // some other way keeps its real imports, and is then refused below.
          b.onResolve({ filter: /^\.\/(proofread-store|logger|proofread\/index\.ts)$/ }, (a) =>
            a.importer === path.join(runnerDir, "runner-under-test.ts") ? { path: a.path, namespace: "runner-stub" } : undefined,
          );
          b.onLoad({ filter: /.*/, namespace: "runner-stub" }, (a) => ({ contents: STUB_SOURCES[a.path], loader: "js" }));
        },
      },
    ],
  });
  const inputs = Object.keys(out.metafile.inputs);
  // Checked BEFORE the bundle is imported, not after: a runner whose store
  // import escaped the stubs (a new spelling, say "./proofread-store.ts")
  // would bundle the real store and @workspace/db, and running its scenarios
  // would reach for a real database. Anything but the runner itself, the
  // stubs and lifecycle.ts is refused unloaded (node: builtins are external
  // and never listed here). Only what esbuild resolved is listed: a specifier
  // computed at run time is not (see the BEHAVIOUR header).
  const foreign = inputs.filter((p) => p !== "runner-under-test.ts" && !p.startsWith("runner-stub:") && !/(^|\/)proofread\/lifecycle\.ts$/.test(p));
  if (foreign.length > 0) throw new Error(`refused to load a runner bundle that pulls in ${foreign.join(", ")}`);
  const mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
  return { mod, inputs };
}

/** One scenario: install a fresh stub, call `fn(...args)` on the bundled runner, record what happened. */
async function drive(mod, fn, args, impl) {
  const st = { calls: [], logs: [] };
  st.call = (name, a) => {
    st.calls.push({ name, args: a });
    const f = impl[name];
    return f ? f(...a) : undefined;
  };
  st.log = (level, obj, msg) => st.logs.push({ level, obj, msg });
  st.to = (name) => st.calls.filter((c) => c.name === name);
  globalThis.__proofreadRunnerStub = st;
  try {
    return { st, value: await mod[fn](...args), threw: false, error: null };
  } catch (error) {
    return { st, value: undefined, threw: true, error };
  }
}

const claimed = (o = {}) => ({
  id: "run-3",
  projectId: "project-A",
  firmId: "firm-A",
  revision: 3,
  status: "running",
  attempts: 1,
  claimedAt: new Date(),
  rulesVersion: "rules-current",
  engineStamp: "stamp-this-deploy",
  ...o,
});
const STUDY = { request: {}, result: {} };
const ENQUEUE_ARGS = { projectId: "project-A", firmId: "firm-A", userId: "user-1" };
const reachedRulesReady = (r) => r.st.to("completeRun").some((c) => c.args[0]?.runId === "run-3" && c.args[0]?.status === "rules_ready");

/** Bundle `text` and run every scenario once; the behaviour checks read the result. */
async function observe(text) {
  let bundled;
  try {
    bundled = await bundleRunner(text);
  } catch (e) {
    return { error: `the runner did not bundle: ${(e.errors ?? []).map((x) => x.text).join("; ") || e.message}` };
  }
  const { mod, inputs } = bundled;
  // The previous run of the SAME rules recorded by an OLDER deploy: the store
  // returns what previousRunForProject selects — the id and the rules version.
  const acrossDeploy = await drive(mod, "claimAndRunOne", [], {
    claimOneRun: () => claimed({ engineStamp: "stamp-this-deploy" }),
    loadStudyForRun: () => STUDY,
    previousRunForProject: () => ({ id: "run-2", rulesVersion: "rules-current" }),
    carryForwardDispositions: () => 1,
  });
  const rulesBumped = await drive(mod, "claimAndRunOne", [], {
    claimOneRun: () => claimed(),
    loadStudyForRun: () => STUDY,
    previousRunForProject: () => ({ id: "run-2", rulesVersion: "rules-older" }),
    carryForwardDispositions: () => 0,
  });
  // RR-1: the claimed row was QUEUED by the previous deploy, so it still records that deploy's
  // rules version and stamp; this bundle's RULES_VERSION ("rules-current") is the code that runs it.
  const queuedBeforeBump = await drive(mod, "claimAndRunOne", [], {
    claimOneRun: () => claimed({ rulesVersion: "rules-older", engineStamp: "stamp-previous-deploy", protocolVersion: "protocol-previous" }),
    runHoldsFindings: () => false,
    loadStudyForRun: () => STUDY,
    previousRunForProject: () => ({ id: "run-2", rulesVersion: "rules-older" }),
    carryForwardDispositions: () => 1,
  });
  // The same queue-time row, whose predecessor ran under the rules this code runs.
  const queuedBeforeBumpPrevCurrent = await drive(mod, "claimAndRunOne", [], {
    claimOneRun: () => claimed({ rulesVersion: "rules-older", engineStamp: "stamp-previous-deploy" }),
    runHoldsFindings: () => false,
    loadStudyForRun: () => STUDY,
    previousRunForProject: () => ({ id: "run-2", rulesVersion: "rules-current" }),
    carryForwardDispositions: () => 1,
  });
  // A re-claimed run (attempt 2) whose first attempt wrote its findings under other rules.
  const midRunRulesChange = await drive(mod, "claimAndRunOne", [], {
    claimOneRun: () => claimed({ rulesVersion: "rules-older", attempts: 2 }),
    runHoldsFindings: () => true,
    loadStudyForRun: () => STUDY,
    previousRunForProject: () => ({ id: "run-2", rulesVersion: "rules-current" }),
    carryForwardDispositions: () => 1,
  });
  // The same re-claim under the SAME rules: the pass simply runs again (its findings insert is idempotent).
  const reclaimSameRules = await drive(mod, "claimAndRunOne", [], {
    claimOneRun: () => claimed({ attempts: 2 }),
    runHoldsFindings: () => true,
    loadStudyForRun: () => STUDY,
    previousRunForProject: () => ({ id: "run-2", rulesVersion: "rules-current" }),
    carryForwardDispositions: () => 1,
  });
  const enqueued = await drive(mod, "enqueueProofread", [ENQUEUE_ARGS], {
    insertQueuedRun: () => ({ id: "run-q" }),
    claimOneRun: () => null,
  });
  // A row past its attempts budget whose failing write throws.
  const writeFails = new Error("connection reset");
  const exhaustedWriteFails = await drive(mod, "claimAndRunOne", [], {
    claimOneRun: () => claimed({ id: "run-stale", attempts: lifecycleMod.MAX_ATTEMPTS + 1 }),
    completeRun: () => {
      throw writeFails;
    },
  });
  // POST run's path: queue run-q, then the drain claims an OLDER exhausted row.
  const postRun = await drive(mod, "enqueueProofread", [ENQUEUE_ARGS], {
    insertQueuedRun: () => ({ id: "run-q" }),
    claimOneRun: () => claimed({ id: "run-stale", attempts: lifecycleMod.MAX_ATTEMPTS + 1 }),
    completeRun: () => {
      throw new Error("connection reset");
    },
  });
  // Every point inside claimAndRunOne where the store (or the pass) can throw, one at a time.
  const thrower = (msg) => () => {
    throw new Error(msg);
  };
  const normal = {
    claimOneRun: () => claimed(),
    loadStudyForRun: () => STUDY,
    previousRunForProject: () => ({ id: "run-2", rulesVersion: "rules-current" }),
    carryForwardDispositions: () => 1,
  };
  const THROW_POINTS = [
    ["the claim", { claimOneRun: thrower("claim") }],
    ["loading the study", { ...normal, loadStudyForRun: thrower("load") }],
    ["the clause pass", { ...normal, runClauses: thrower("clauses") }],
    ["every completeRun", { ...normal, completeRun: thrower("complete") }],
    ["the carry-source lookup", { ...normal, previousRunForProject: thrower("previous") }],
    ["the carry", { ...normal, carryForwardDispositions: thrower("carry") }],
    ["the exhausted branch's completeRun", { claimOneRun: () => claimed({ id: "run-stale", attempts: lifecycleMod.MAX_ATTEMPTS + 1 }), completeRun: thrower("complete") }],
    ["the held-findings lookup", { ...normal, claimOneRun: () => claimed({ rulesVersion: "rules-older", attempts: 2 }), runHoldsFindings: thrower("held") }],
  ];
  const throwMatrix = [];
  for (const [label, impl] of THROW_POINTS) throwMatrix.push({ label, r: await drive(mod, "claimAndRunOne", [], impl) });
  // The insert itself fails: the error POST run must be able to read (a
  // unique violation on the revision key, as two quick presses produce).
  const conflict = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint: "UQ_study_proofread_runs_project_revision",
  });
  const insertFails = await drive(mod, "enqueueProofread", [ENQUEUE_ARGS], {
    insertQueuedRun: () => {
      throw conflict;
    },
  });
  const noRow = await drive(mod, "enqueueProofread", [ENQUEUE_ARGS], { insertQueuedRun: () => null });
  // A pass that raised two DEFECTs and a BLOCKER, every text field of each marked, so a
  // log line that carries any of it is visible. Once on a run that finishes, once on a
  // run whose flip to rules_ready throws (it never finishes, and is requeued).
  const defects = await drive(mod, "claimAndRunOne", [], { ...normal, runClauses: () => DEFECT_PASS });
  const defectsUnfinished = await drive(mod, "claimAndRunOne", [], {
    ...normal,
    runClauses: () => DEFECT_PASS,
    completeRun: (a) => {
      if (a?.status === "rules_ready") throw new Error("flip");
    },
  });
  return { inputs, acrossDeploy, rulesBumped, queuedBeforeBump, queuedBeforeBumpPrevCurrent, midRunRulesChange, reclaimSameRules, enqueued, writeFails, exhaustedWriteFails, postRun, throwMatrix, conflict, insertFails, noRow, defects, defectsUnfinished };
}

const marked = (clauseId, type) => ({
  clauseId,
  section: 4,
  type,
  title: `LEAK-title-${clauseId}`,
  detail: `LEAK-detail-${clauseId}`,
  sourceLabel: `LEAK-source-${clauseId}`,
  readPaths: [{ path: `LEAK-path-${clauseId}`, value: `LEAK-value-${clauseId}` }],
  remedy: `LEAK-remedy-${clauseId}`,
  audience: type === "DEFECT" ? "admin" : "engineer",
});
const DEFECT_PASS = {
  findings: [marked("losMatchesDelay", "DEFECT"), marked("growthOverrideDisclosed", "BLOCKER"), marked("anotherDefect", "DEFECT")],
  coverage: [],
};
/** The warn lines a run logged about a DEFECT: the ones that name a clause. */
const defectLines = (r) => r.st.logs.filter((l) => l.level === "warn" && l.obj && Object.hasOwn(l.obj, "clause"));
const describe = (r) => (r ? `${r.threw ? `threw ${r.error?.message ?? r.error}` : `returned ${JSON.stringify(r.value)}`}; calls: ${r.st.calls.map((c) => `${c.name}(${JSON.stringify(c.args).slice(1, -1)})`).join(", ") || "none"}` : "not run");

const BCHECKS = [
  {
    id: "runs-carry-source-is-this-project-before-this-revision",
    msg: "RUN: a claimed run (project-A, revision 3) asks previousRunForProject for exactly (\"project-A\", 3) — its own project, strictly before its own revision",
    test: (o) => JSON.stringify(o.acrossDeploy.st.to("previousRunForProject").map((c) => c.args)) === JSON.stringify([["project-A", 3]]),
    why: (o) => describe(o.acrossDeploy),
  },
  {
    id: "runs-carry-writes-this-run-from-the-previous-one",
    msg: "RUN: the carry is called once, as carryForwardDispositions(\"run-3\", \"run-2\", …) — the claimed run as the target and the previous run the store returned as the source",
    test: (o) => {
      const c = o.acrossDeploy.st.to("carryForwardDispositions");
      return c.length === 1 && c[0].args[0] === "run-3" && c[0].args[1] === "run-2";
    },
    why: (o) => describe(o.acrossDeploy),
  },
  {
    id: "runs-carry-crosses-a-deploy-under-the-same-rules",
    msg: "RUN: the previous run has the same rules version and was recorded by an older deploy — decisions carry (the gate is true). A new deploy is not a reason to reopen a WITHDRAWN",
    test: (o) => {
      const c = o.acrossDeploy.st.to("carryForwardDispositions");
      return c.length === 1 && c[0].args[2] === true;
    },
    why: (o) => describe(o.acrossDeploy),
  },
  {
    id: "runs-carry-stops-at-a-rules-bump",
    msg: "RUN: the previous run has an older rules version — the run still reaches rules_ready, and nothing carries (no carry call, or one gated false): a RULES_VERSION bump reopens every decision on purpose",
    test: (o) => {
      const c = o.rulesBumped.st.to("carryForwardDispositions");
      return !o.rulesBumped.threw && reachedRulesReady(o.rulesBumped) && (c.length === 0 || (c.length === 1 && c[0].args[2] === false));
    },
    why: (o) => describe(o.rulesBumped),
  },
  {
    id: "runs-carry-gate-is-this-codes-rules-version",
    msg: "RUN (RR-1): a row QUEUED by the previous deploy (it records rules-older) and claimed by this code (RULES_VERSION rules-current), whose predecessor ran under rules-older, reaches rules_ready and carries nothing (no carry call, or one gated false): the clauses that produced its findings ran under the new rules, so decisions recorded under the old ones reopen",
    test: (o) => {
      const r = o.queuedBeforeBump;
      const c = r.st.to("carryForwardDispositions");
      return !r.threw && reachedRulesReady(r) && (c.length === 0 || (c.length === 1 && c[0].args[2] === false));
    },
    why: (o) => describe(o.queuedBeforeBump),
  },
  {
    id: "runs-carry-crosses-a-queue-time-bump",
    msg: "RUN (RR-1): the same queue-time row, whose predecessor ran under rules-current — the rules this code runs — carries (one call, gated true): the gate compares the predecessor with the rules that run THIS pass, not with what the row recorded when it was queued",
    test: (o) => {
      const c = o.queuedBeforeBumpPrevCurrent.st.to("carryForwardDispositions");
      return reachedRulesReady(o.queuedBeforeBumpPrevCurrent) && c.length === 1 && c[0].args[2] === true;
    },
    why: (o) => describe(o.queuedBeforeBumpPrevCurrent),
  },
  {
    id: "runs-stamped-by-the-code-that-ran-it",
    msg: "RUN (RR-1, RR-2): that row's clause-pass write (completeRun, status running, the call that carries the findings) stamps it with this code's RULES_VERSION (rules-current), engineStamp() (stamp-this-deploy) and the PROTOCOL_VERSION the runner read (the value it also hands insertQueuedRun) — not rules-older, stamp-previous-deploy, protocol-previous, which the row held from its queuing deploy",
    test: (o) => {
      const pass = o.queuedBeforeBump.st.to("completeRun").filter((c) => c.args[0]?.status === "running");
      const queuedWith = o.enqueued.st.to("insertQueuedRun")[0]?.args[0]?.protocolVersion;
      const st = pass[0]?.args[0]?.stamp;
      return (
        pass.length === 1 &&
        Array.isArray(pass[0].args[0].findings) &&
        st !== undefined &&
        Object.keys(st).sort().join(",") === "engineStamp,protocolVersion,rulesVersion" &&
        st.rulesVersion === "rules-current" &&
        st.engineStamp === "stamp-this-deploy" &&
        typeof queuedWith === "string" &&
        queuedWith.length > 0 &&
        st.protocolVersion === queuedWith
      );
    },
    why: (o) => `${describe(o.queuedBeforeBump)}; insertQueuedRun got protocolVersion ${JSON.stringify(o.enqueued.st.to("insertQueuedRun")[0]?.args[0]?.protocolVersion)}`,
  },
  {
    id: "runs-rules-changed-mid-run-fails-the-run",
    msg: "RUN (RR-1): a re-claimed run whose earlier attempt wrote findings under other rules (runHoldsFindings(\"run-3\") is true, the row says rules-older) is failed with error \"rules_changed_mid_run\" in ONE completeRun (status failed, no findings, no coverage, manifest or stamp), with a warn naming the run, and nothing else is done: no study load, no clause pass, no carry lookup, no carry — new-rule findings would otherwise sit beside the old ones in one run, and the store never deletes",
    test: (o) => {
      const r = o.midRunRulesChange;
      const done = r.st.to("completeRun");
      const a = done[0]?.args[0] ?? {};
      return (
        !r.threw &&
        r.value === true &&
        JSON.stringify(r.st.to("runHoldsFindings").map((c) => c.args)) === JSON.stringify([["run-3"]]) &&
        done.length === 1 &&
        Object.keys(a).sort().join(",") === "error,findings,runId,status" &&
        a.runId === "run-3" &&
        a.status === "failed" &&
        a.error === "rules_changed_mid_run" &&
        Array.isArray(a.findings) &&
        a.findings.length === 0 &&
        ["loadStudyForRun", "runClauses", "previousRunForProject", "carryForwardDispositions"].every((n) => r.st.to(n).length === 0) &&
        r.st.logs.some((l) => l.level === "warn" && l.obj?.runId === "run-3")
      );
    },
    why: (o) => `${describe(o.midRunRulesChange)}; logs: ${JSON.stringify(o.midRunRulesChange.st.logs.map((l) => [l.level, l.msg, l.obj]))}`,
  },
  {
    id: "runs-same-rules-reclaim-runs-again",
    msg: "RUN: a re-claimed run that holds findings written under the rules this code runs is NOT failed: its pass runs again (the findings insert is idempotent) and it reaches rules_ready — only a change of rules in between makes a run unfinishable",
    test: (o) => !o.reclaimSameRules.threw && reachedRulesReady(o.reclaimSameRules) && o.reclaimSameRules.st.to("runClauses").length === 1,
    why: (o) => describe(o.reclaimSameRules),
  },
  {
    id: "runs-enqueue-records-the-current-rules-version",
    msg: "RUN: enqueueProofread queues the run with the caller's project, firm and user, the current RULES_VERSION and engineStamp() — the queuing deploy's values, which the run's clause pass replaces with its own (runs-stamped-by-the-code-that-ran-it)",
    test: (o) => {
      const c = o.enqueued.st.to("insertQueuedRun");
      const a = c[0]?.args[0] ?? {};
      return (
        c.length === 1 &&
        a.projectId === "project-A" &&
        a.firmId === "firm-A" &&
        a.userId === "user-1" &&
        a.rulesVersion === "rules-current" &&
        a.engineStamp === "stamp-this-deploy"
      );
    },
    why: (o) => describe(o.enqueued),
  },
  {
    id: "runs-claim-and-run-never-rejects",
    msg: "RUN: claimAndRunOne resolves whatever the store throws — at the claim, the study load, the clause pass, any completeRun, the carry lookup, the carry, the exhausted branch's write, and the held-findings lookup. It runs after a run has been queued, so nothing it does may surface to the caller as a failure to queue",
    test: (o) => o.throwMatrix.length === 8 && o.throwMatrix.every((t) => !t.r.threw),
    why: (o) => o.throwMatrix.filter((t) => t.r.threw).map((t) => `${t.label}: rejected with "${t.r.error?.message ?? t.r.error}"`).join("; "),
  },
  {
    id: "runs-exhausted-write-failure-is-logged-with-the-run",
    msg: "RUN: when the exhausted branch's write throws, a warn line carries that run's id and the error itself — caught is not the same as silent",
    test: (o) => o.exhaustedWriteFails.st.logs.some((l) => l.level === "warn" && l.obj?.runId === "run-stale" && l.obj?.err === o.writeFails),
    why: (o) => `logs: ${JSON.stringify(o.exhaustedWriteFails.st.logs.map((l) => [l.level, l.msg, Object.keys(l.obj ?? {})]))}; ${describe(o.exhaustedWriteFails)}`,
  },
  {
    id: "runs-enqueue-resolves-once-the-run-is-queued",
    msg: "RUN: POST run's path — enqueueProofread inserts its run, then the drain claims an OLDER exhausted row whose write throws, and enqueueProofread still resolves: the run it was asked to queue IS queued, so the route answers { ok: true }, not 500 \"Failed to start the check\"",
    test: (o) => !o.postRun.threw && o.postRun.st.to("insertQueuedRun").length === 1 && o.postRun.st.to("claimOneRun").length === 1,
    why: (o) => describe(o.postRun),
  },
  {
    id: "runs-exhausted-row-never-runs-clauses",
    msg: "RUN: a row past its attempts budget is written 'failed' without loading the study or running a clause — a pass that crashes the process would otherwise be re-claimed and re-crash forever",
    test: (o) => {
      const r = o.exhaustedWriteFails;
      return r.st.to("runClauses").length === 0 && r.st.to("loadStudyForRun").length === 0 && r.st.to("completeRun").some((c) => c.args[0]?.runId === "run-stale" && c.args[0]?.status === "failed");
    },
    why: (o) => describe(o.exhaustedWriteFails),
  },
  {
    id: "runs-enqueue-insert-error-reaches-the-caller",
    msg: "RUN: when the insert throws, enqueueProofread rejects and the insert's own error reaches the caller (itself, or on its .cause chain, which is how routes/proofread.ts's isRevisionConflict reads it), and nothing is drained — so enqueueProofread does NOT fail open, by design: POST run turns a 23505 on the revision key into { ok: true }, and the /generate hook's own .catch is what keeps a failure away from the study",
    test: (o) => {
      if (!o.insertFails.threw || o.insertFails.st.to("claimOneRun").length !== 0) return false;
      for (let e = o.insertFails.error, d = 0; e && d < 5; e = e.cause, d++) if (e === o.conflict) return true;
      return false;
    },
    why: (o) => describe(o.insertFails),
  },
  {
    id: "runs-defect-is-logged-with-run-project-and-clause",
    msg: "RUN: a pass that raised two DEFECTs and a BLOCKER, on a run that finishes, logs one warn per DEFECT, in the pass's order, each carrying exactly { runId, projectId, clause } (run-3, project-A, the clause id), and none for the BLOCKER — the engineer never sees a DEFECT, so this line is how the software team hears of one",
    test: (o) => {
      const lines = defectLines(o.defects);
      return (
        reachedRulesReady(o.defects) &&
        lines.length === 2 &&
        lines.every((l) => Object.keys(l.obj).sort().join(",") === "clause,projectId,runId" && l.obj.runId === "run-3" && l.obj.projectId === "project-A") &&
        lines.map((l) => l.obj.clause).join(",") === "losMatchesDelay,anotherDefect"
      );
    },
    why: (o) => `warn lines naming a clause: ${JSON.stringify(defectLines(o.defects).map((l) => l.obj))}; ${describe(o.defects)}`,
  },
  {
    id: "runs-defect-log-carries-nothing-from-the-finding",
    msg: "RUN: no line that run logs, at any level, carries a finding's title, detail, source, read paths or remedy — they quote the study, and the log is not where a study's values go",
    test: (o) => !/LEAK-/.test(JSON.stringify(o.defects.st.logs.map((l) => [l.obj, l.msg]))),
    why: (o) => `logged: ${JSON.stringify(o.defects.st.logs.filter((l) => /LEAK-/.test(JSON.stringify([l.obj, l.msg]))).map((l) => [l.level, l.msg, l.obj]))}`,
  },
  {
    id: "runs-defect-is-logged-once-the-run-is-finished",
    msg: "RUN: the same pass on a run whose flip to rules_ready throws (it never finishes, and is requeued) logs no DEFECT line — once per finished run, not once per attempt",
    test: (o) => o.defectsUnfinished.st.to("completeRun").some((c) => c.args[0]?.status === "rules_ready") && defectLines(o.defectsUnfinished).length === 0,
    why: (o) => `warn lines naming a clause: ${JSON.stringify(defectLines(o.defectsUnfinished).map((l) => l.obj))}; ${describe(o.defectsUnfinished)}`,
  },
  {
    id: "runs-enqueue-without-a-row-claims-nothing",
    msg: "RUN: when the insert returns no row, enqueueProofread resolves, logs a warn naming the project, and drains nothing",
    test: (o) =>
      !o.noRow.threw &&
      o.noRow.st.to("claimOneRun").length === 0 &&
      o.noRow.st.logs.some((l) => l.level === "warn" && l.obj?.projectId === "project-A"),
    why: (o) => `logs: ${JSON.stringify(o.noRow.st.logs.map((l) => [l.level, l.msg]))}; ${describe(o.noRow)}`,
  },
];

const BIDS = BCHECKS.map((c) => c.id);
ok(new Set([...BIDS, ...ids]).size === BIDS.length + ids.length, "precondition: every behaviour check id is unique, and none repeats a text check's id");

const brun = (o) => (o.error ? [...BIDS] : BCHECKS.filter((c) => !c.test(o)).map((c) => c.id));
const realObs = await observe(sources.runner);
ok(!realObs.error, "the real runner bundles with its store, logger and clause registry stubbed", realObs.error);
if (!realObs.error) {
  const real = realObs.inputs.filter((p) => !p.startsWith("runner-stub:"));
  const leaked = real.filter((p) => /proofread-store\.ts|logger\.ts|lib\/db\/|@workspace\/db|proofread\/index\.ts|drizzle|pino/.test(p));
  ok(
    leaked.length === 0 && real.some((p) => p.endsWith("proofread/lifecycle.ts")),
    "the bundle holds the runner and the real lifecycle.ts, and no store, db, logger or clause module — so nothing it runs can open a connection",
    leaked.length ? `in the bundle: ${leaked.join(", ")}` : `inputs: ${realObs.inputs.join(", ")}`,
  );
}
{
  // The refusal is what stands between a scenario and a real database, so it
  // is tested: the same runner with its store import spelled so it escapes the
  // stubs must come back refused, unloaded — never run.
  const escaped = sources.runner.replace('} from "./proofread-store";', '} from "./proofread-store.ts";');
  const o = escaped === sources.runner ? { error: "the store import was not found to respell" } : await observe(escaped);
  ok(
    typeof o.error === "string" && /refused to load a runner bundle that pulls in .*proofread-store\.ts/.test(o.error),
    "a runner whose store import escapes the stubs in a spelling esbuild resolves (\"./proofread-store.ts\") is refused before it is imported, never run (an import whose specifier is computed at run time is not seen: the limit named at BEHAVIOUR)",
    o.error ?? "it was loaded and run",
  );
}
const bfailing = brun(realObs);
for (const c of BCHECKS) {
  const red = bfailing.includes(c.id);
  ok(!red, `[${c.id}] ${c.msg}`, red ? (realObs.error ?? c.why(realObs)) : undefined);
}

// Behaviour teeth: each edit to the runner's text must turn exactly these
// behaviour checks red when the edited runner is bundled and RUN.
const BMUTATIONS = [
  {
    label: "swap the carry's two run ids",
    flips: ["runs-carry-writes-this-run-from-the-previous-one"],
    apply: (t) => t.replace("carryForwardDispositions(run.id, prev.id,", "carryForwardDispositions(prev.id, run.id,"),
  },
  {
    label: "look the carry source up by run.id instead of run.projectId",
    flips: ["runs-carry-source-is-this-project-before-this-revision"],
    apply: (t) => t.replace("previousRunForProject(run.projectId, run.revision)", "previousRunForProject(run.id, run.revision)"),
  },
  {
    label: "look back from the revision after this one",
    flips: ["runs-carry-source-is-this-project-before-this-revision"],
    apply: (t) => t.replace("previousRunForProject(run.projectId, run.revision)", "previousRunForProject(run.projectId, run.revision + 1)"),
  },
  {
    label: "gate the carry on the engine stamp",
    flips: ["runs-carry-crosses-a-deploy-under-the-same-rules", "runs-carry-crosses-a-queue-time-bump"],
    apply: (t) => t.replace("prev.rulesVersion === RULES_VERSION", "(prev as any).engineStamp === engineStamp()"),
  },
  {
    label: "carry whatever the rules version (true)",
    flips: ["runs-carry-stops-at-a-rules-bump", "runs-carry-gate-is-this-codes-rules-version"],
    apply: (t) => t.replace("prev.rulesVersion === RULES_VERSION", "true"),
  },
  {
    label: "invert the gate",
    flips: ["runs-carry-crosses-a-deploy-under-the-same-rules", "runs-carry-stops-at-a-rules-bump", "runs-carry-gate-is-this-codes-rules-version", "runs-carry-crosses-a-queue-time-bump"],
    apply: (t) => t.replace("prev.rulesVersion === RULES_VERSION", "prev.rulesVersion !== RULES_VERSION"),
  },
  {
    label: "compare the previous run's rules version with itself",
    flips: ["runs-carry-stops-at-a-rules-bump", "runs-carry-gate-is-this-codes-rules-version"],
    apply: (t) => t.replace("prev.rulesVersion === RULES_VERSION", "prev.rulesVersion === prev.rulesVersion"),
  },
  {
    label: "never make the carry call",
    flips: ["runs-carry-writes-this-run-from-the-previous-one", "runs-carry-crosses-a-deploy-under-the-same-rules", "runs-carry-crosses-a-queue-time-bump"],
    apply: (t) => t.replace("if (prev) await carryForwardDispositions(", "if (false && prev) await carryForwardDispositions("),
  },
  {
    label: "gate the carry on the claimed row's queue-time rules version (RR-1)",
    flips: ["runs-carry-gate-is-this-codes-rules-version", "runs-carry-crosses-a-queue-time-bump"],
    apply: (t) => t.replace("prev.rulesVersion === RULES_VERSION", "prev.rulesVersion === run.rulesVersion"),
  },
  {
    label: "drop the stamp from the clause pass's write",
    flips: ["runs-stamped-by-the-code-that-ran-it"],
    apply: (t) => t.replace("      stamp: { rulesVersion: RULES_VERSION, engineStamp: engineStamp(), protocolVersion: PROTOCOL_VERSION },\n", ""),
  },
  {
    label: "stamp the run with the claimed row's own (queue-time) values",
    flips: ["runs-stamped-by-the-code-that-ran-it"],
    apply: (t) => t.replace("stamp: { rulesVersion: RULES_VERSION, engineStamp: engineStamp(), protocolVersion: PROTOCOL_VERSION }", "stamp: { rulesVersion: run.rulesVersion, engineStamp: run.engineStamp, protocolVersion: run.protocolVersion }"),
  },
  {
    label: "stamp the engine stamp as the run's rules version",
    flips: ["runs-stamped-by-the-code-that-ran-it"],
    apply: (t) => t.replace("stamp: { rulesVersion: RULES_VERSION,", "stamp: { rulesVersion: engineStamp(),"),
  },
  {
    label: "never fail a run whose findings were written under other rules",
    flips: ["runs-rules-changed-mid-run-fails-the-run"],
    apply: (t) => t.replace("if (run.rulesVersion !== RULES_VERSION && (await runHoldsFindings(run.id)))", "if (false && run.rulesVersion !== RULES_VERSION && (await runHoldsFindings(run.id)))"),
  },
  {
    label: "fail every re-claimed run that holds findings, whatever its rules",
    flips: ["runs-same-rules-reclaim-runs-again"],
    apply: (t) => t.replace("if (run.rulesVersion !== RULES_VERSION && (await runHoldsFindings(run.id)))", "if (await runHoldsFindings(run.id))"),
  },
  {
    label: "ask whether ANOTHER run holds findings (the project's id)",
    flips: ["runs-rules-changed-mid-run-fails-the-run"],
    apply: (t) => t.replace("await runHoldsFindings(run.id)", "await runHoldsFindings(run.projectId)"),
  },
  {
    label: "requeue the run instead of failing it (it is re-claimed and refused forever)",
    flips: ["runs-rules-changed-mid-run-fails-the-run"],
    apply: (t) => t.replace('status: "failed", findings: [], error: "rules_changed_mid_run"', 'status: "queued", findings: [], error: "rules_changed_mid_run"'),
  },
  {
    label: "fail it without saying why",
    flips: ["runs-rules-changed-mid-run-fails-the-run"],
    apply: (t) => t.replace('error: "rules_changed_mid_run"', 'error: "failed"'),
  },
  {
    label: "fail it, then run the pass anyway (no return)",
    flips: ["runs-rules-changed-mid-run-fails-the-run"],
    apply: (t) => t.replace('"proofread.rules_changed_mid_run");\n      return true;\n', '"proofread.rules_changed_mid_run");\n'),
  },
  {
    label: "fail it silently (no warn)",
    flips: ["runs-rules-changed-mid-run-fails-the-run"],
    apply: (t) => t.replace(/\n *logger\.warn\(\{ runId: run\.id, rulesVersion: run\.rulesVersion, now: RULES_VERSION \}, "proofread\.rules_changed_mid_run"\);/, ""),
  },
  {
    label: "record the engine stamp as the run's rules version",
    flips: ["runs-enqueue-records-the-current-rules-version"],
    apply: (t) => t.replace("rulesVersion: RULES_VERSION,", "rulesVersion: engineStamp(),"),
  },
  {
    label: "unwrap the exhausted branch's completeRun",
    flips: ["runs-claim-and-run-never-rejects", "runs-exhausted-write-failure-is-logged-with-the-run", "runs-enqueue-resolves-once-the-run-is-queued"],
    apply: (t) => t.replace(EXHAUSTED_TRY, EXHAUSTED_BARE),
  },
  {
    label: "log, then rethrow, from the exhausted branch's catch",
    flips: ["runs-claim-and-run-never-rejects", "runs-enqueue-resolves-once-the-run-is-queued"],
    apply: (t) => t.replace('"proofread.exhausted_write_failed");\n', '"proofread.exhausted_write_failed");\n      throw err;\n'),
  },
  {
    label: "swallow the exhausted write's failure without a word",
    flips: ["runs-exhausted-write-failure-is-logged-with-the-run"],
    apply: (t) => t.replace('      logger.warn({ err, runId: run.id }, "proofread.exhausted_write_failed");\n', ""),
  },
  {
    label: "log the exhausted write's failure without the run id",
    flips: ["runs-exhausted-write-failure-is-logged-with-the-run"],
    apply: (t) => t.replace("logger.warn({ err, runId: run.id }, \"proofread.exhausted_write_failed\")", "logger.warn({ err }, \"proofread.exhausted_write_failed\")"),
  },
  {
    label: "let an exhausted row run the pass",
    flips: ["runs-exhausted-row-never-runs-clauses", "runs-exhausted-write-failure-is-logged-with-the-run"],
    apply: (t) => t.replace("if (run.attempts > MAX_ATTEMPTS)", "if (false && run.attempts > MAX_ATTEMPTS)"),
  },
  {
    label: "turn an insert error into \"no row\" (enqueue swallows it)",
    flips: ["runs-enqueue-insert-error-reaches-the-caller"],
    apply: (t) => t.replace("    engineStamp: engineStamp(),\n  });\n", "    engineStamp: engineStamp(),\n  }).catch(() => null);\n"),
  },
  {
    label: "rethrow an insert error as a new error that drops it (the 23505 never reaches the route)",
    flips: ["runs-enqueue-insert-error-reaches-the-caller"],
    apply: (t) => t.replace("    engineStamp: engineStamp(),\n  });\n", '    engineStamp: engineStamp(),\n  }).catch(() => {\n    throw new Error("enqueue failed");\n  });\n'),
  },
  {
    label: "log no DEFECT at all",
    flips: ["runs-defect-is-logged-with-run-project-and-clause"],
    apply: (t) => t.replace('if (f.type === "DEFECT") {', 'if (false && f.type === "DEFECT") {'),
  },
  {
    label: "log each DEFECT at info, not warn",
    flips: ["runs-defect-is-logged-with-run-project-and-clause"],
    apply: (t) => t.replace('logger.warn({ runId: run.id, projectId: run.projectId, clause: f.clauseId }, "proofread.defect_raised");', 'logger.info({ runId: run.id, projectId: run.projectId, clause: f.clauseId }, "proofread.defect_raised");'),
  },
  {
    label: "log every finding as a DEFECT",
    flips: ["runs-defect-is-logged-with-run-project-and-clause"],
    apply: (t) => t.replace('if (f.type === "DEFECT") {', "if (f) {"),
  },
  {
    label: "log a DEFECT without its project",
    flips: ["runs-defect-is-logged-with-run-project-and-clause"],
    apply: (t) => t.replace("{ runId: run.id, projectId: run.projectId, clause: f.clauseId }", "{ runId: run.id, clause: f.clauseId }"),
  },
  {
    label: "log a DEFECT with its detail",
    flips: ["runs-defect-is-logged-with-run-project-and-clause", "runs-defect-log-carries-nothing-from-the-finding"],
    apply: (t) => t.replace("{ runId: run.id, projectId: run.projectId, clause: f.clauseId }", "{ runId: run.id, projectId: run.projectId, clause: f.clauseId, detail: f.detail }"),
  },
  {
    label: "log the whole DEFECT finding in place of its clause",
    flips: ["runs-defect-is-logged-with-run-project-and-clause", "runs-defect-log-carries-nothing-from-the-finding"],
    apply: (t) => t.replace("{ runId: run.id, projectId: run.projectId, clause: f.clauseId }", "{ runId: run.id, projectId: run.projectId, finding: f }"),
  },
  {
    label: "put the findings' titles on the rules_ready line",
    flips: ["runs-defect-log-carries-nothing-from-the-finding"],
    apply: (t) => t.replace("logger.info({ runId: run.id, findings: findings.length }", "logger.info({ runId: run.id, findings: findings.length, titles: findings.map((x) => x.title) }"),
  },
  {
    label: "log the DEFECTs before the run is finished (once per attempt)",
    flips: ["runs-defect-is-logged-once-the-run-is-finished"],
    apply: (t) => {
      const from = t.indexOf("    for (const f of findings) {");
      const to = t.indexOf("    logger.info({ runId: run.id, findings: findings.length }");
      const anchor = '    await completeRun({\n      runId: run.id,\n      status: "running",';
      if (from < 0 || to < from || !t.includes(anchor)) return t;
      const loop = t.slice(from, to);
      return t.replace(loop, "").replace(anchor, `${loop}${anchor}`);
    },
  },
  {
    label: "drain even when the insert yielded no row",
    flips: ["runs-enqueue-without-a-row-claims-nothing"],
    apply: (t) => t.replace(/\n  if \(!run\) \{[\s\S]*?\n  \}/, ""),
  },
];
const BSTAYS_GREEN = [
  { label: "the carry gate with its operands swapped", apply: (t) => t.replace("prev.rulesVersion === RULES_VERSION", "RULES_VERSION === prev.rulesVersion") },
  {
    label: "an insert error rethrown with the original as its cause (isRevisionConflict walks .cause)",
    apply: (t) => t.replace("    engineStamp: engineStamp(),\n  });\n", '    engineStamp: engineStamp(),\n  }).catch((cause) => {\n    throw new Error("enqueue failed", { cause });\n  });\n'),
  },
];

const bteeth = new Set(BIDS);
for (const m of BMUTATIONS) {
  const unknown = m.flips.filter((id) => !bteeth.has(id));
  ok(unknown.length === 0, `behaviour teeth: "${m.label}" names only real behaviour checks`, unknown.length ? `unknown: ${unknown.join(", ")}` : undefined);
  const text = m.apply(sources.runner);
  ok(text !== sources.runner, `behaviour teeth: "${m.label}" actually changes the runner`);
  const o = await observe(text);
  const got = brun(o).filter((id) => !bfailing.includes(id)).sort().join(", ");
  const want = [...new Set(m.flips)].sort().join(", ");
  ok(
    !o.error && want === got,
    `behaviour teeth: "${m.label}" — the edited runner, RUN, is caught by exactly the behaviour checks that claim to protect it`,
    o.error ?? (want === got ? undefined : `expected red: ${want || "(none)"}; actually red: ${got || "(none)"}`),
  );
}
for (const g of BSTAYS_GREEN) {
  const text = g.apply(sources.runner);
  ok(text !== sources.runner, `behaviour stays green: "${g.label}" applies to the runner`);
  const o = await observe(text);
  const now = brun(o).filter((id) => !bfailing.includes(id));
  ok(!o.error && now.length === 0, `behaviour stays green: "${g.label}" — no behaviour check refuses it`, o.error ?? (now.length ? `went red: ${now.join(", ")}` : undefined));
}
const bcovered = new Set(BMUTATIONS.flatMap((m) => m.flips));
const btoothless = BIDS.filter((id) => !bcovered.has(id));
ok(btoothless.length === 0, "every behaviour check has a mutation proving it has teeth", btoothless.length ? `no mutation breaks: ${btoothless.join(", ")}` : undefined);

// ===========================================================================
// STORE BEHAVIOUR. The text checks above read completeRun's first .set({...}) and insertQueuedRun's
// .values({...}); this part RUNS both and records what reaches the query builder.
//
// proofread-store.ts — the real file, or a mutated copy of its text — is bundled with esbuild, with four of its
// imports replaced by in-memory stubs: @workspace/db (a `db` that records every call made on it — the method,
// the table it names, each chained call and its arguments — and answers [] when awaited, and the four tables as
// named objects), drizzle-orm (operators and sql that return inert tokens), ./logger and ./proofread/index.ts
// (findingFingerprint). ./proofread/lifecycle.ts is the real one. As with the runner, a bundle whose input list
// holds anything else is refused before it is imported, and DATABASE_URL is deleted at the top of this file.
//
// What this proves is what completeRun and insertQueuedRun hand the query builder for given arguments — every
// call they make on db, and the values of each .set() and .values() — however the code reaches them: a second
// update, a rebinding or mutation of args, an alias, a helper. It cannot prove the SQL drizzle renders from those
// calls or what Postgres does with it; scripts/proofread-pg-harness/ runs that against a throwaway database.
// ===========================================================================
const STORE_STUB_SOURCES = {
  "@workspace/db": `
const st = () => globalThis.__proofreadStoreStub;
const table = (name) => new Proxy({ __table: name }, { get: (t, k) => (k in t ? t[k] : { __column: name + "." + String(k) }) });
export const studyProofreadRunsTable = table("study_proofread_runs");
export const studyProofreadFindingsTable = table("study_proofread_findings");
export const studyProofreadDispositionsTable = table("study_proofread_dispositions");
export const tisProjectsTable = table("tis_projects");
const query = (method, args) => {
  const rec = { method, table: args[0]?.__table ?? null, args, links: [] };
  st().calls.push(rec);
  const chain = new Proxy({}, {
    get(_, k) {
      if (k === "then") return (ok, fail) => Promise.resolve([]).then(ok, fail);
      return (...a) => {
        rec.links.push({ name: String(k), args: a });
        return chain;
      };
    },
  });
  return chain;
};
export const db = new Proxy({}, { get: (_, k) => (...a) => query(String(k), a) });
`,
  "drizzle-orm": `
const tok = (op) => (...a) => ({ __op: op, a });
export const and = tok("and"), or = tok("or"), not = tok("not"), desc = tok("desc"), asc = tok("asc"), eq = tok("eq"), ne = tok("ne"), inArray = tok("inArray"), lt = tok("lt"), lte = tok("lte"), gt = tok("gt"), gte = tok("gte"), isNull = tok("isNull");
export const sql = Object.assign((strings, ...values) => ({ __op: "sql", strings: [...strings], values }), { raw: (s) => ({ __op: "sql.raw", s }), identifier: (s) => ({ __op: "sql.identifier", s }) });
`,
  "./logger": `
const no = () => undefined;
export const logger = { trace: no, debug: no, info: no, warn: no, error: no, fatal: no };
`,
  "./proofread/index.ts": `
export const findingFingerprint = (f) => "fp:" + f.clauseId;
`,
};

async function bundleStore(text) {
  const out = await build({
    stdin: { contents: text, resolveDir: runnerDir, sourcefile: "store-under-test.ts", loader: "ts" },
    absWorkingDir: runnerDir,
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    tsconfigRaw: "{}",
    metafile: true,
    logLevel: "silent",
    plugins: [
      {
        name: "proofread-store-stubs",
        setup(b) {
          // Only the store's OWN imports are stubbed; anything else it pulls in is refused below.
          b.onResolve({ filter: /^(?:@workspace\/db|drizzle-orm|\.\/logger|\.\/proofread\/index\.ts)$/ }, (a) =>
            a.importer === path.join(runnerDir, "store-under-test.ts") ? { path: a.path, namespace: "store-stub" } : undefined,
          );
          b.onLoad({ filter: /.*/, namespace: "store-stub" }, (a) => ({ contents: STORE_STUB_SOURCES[a.path], loader: "js" }));
        },
      },
    ],
  });
  const inputs = Object.keys(out.metafile.inputs);
  // Checked BEFORE the bundle is imported: a store that reached the real db or drizzle in a spelling the stubs
  // miss is refused unloaded (a specifier computed at run time is not listed: the limit named at BEHAVIOUR).
  const foreign = inputs.filter((p) => p !== "store-under-test.ts" && !p.startsWith("store-stub:") && !/(^|\/)proofread\/lifecycle\.ts$/.test(p));
  if (foreign.length > 0) throw new Error(`refused to load a store bundle that pulls in ${foreign.join(", ")}`);
  const mod = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
  return { mod, inputs };
}

/** One call of a store function against a fresh recording db. */
async function driveStore(mod, fn, args) {
  const st = { calls: [] };
  globalThis.__proofreadStoreStub = st;
  try {
    return { st, value: await mod[fn](...args), threw: false, error: null };
  } catch (error) {
    return { st, value: undefined, threw: true, error };
  }
}

const STAMP_HANDED = { rulesVersion: "rules-handed", engineStamp: "stamp-handed", protocolVersion: "protocol-handed" };
const QUEUE_HANDED = { projectId: "project-A", firmId: "firm-A", userId: "user-1", protocolVersion: "protocol-queued", rulesVersion: "rules-queued", engineStamp: "stamp-queued" };
const A_FINDING = { clauseId: "growthOverrideDisclosed", section: 4, type: "BLOCKER", title: "t", detail: "d", sourceLabel: "s", readPaths: [], remedy: "r", audience: "engineer" };

/** Bundle the store's text and make each call once, with fresh argument objects; the store behaviour checks read the result. */
async function observeStore(text) {
  let bundled;
  try {
    bundled = await bundleStore(text);
  } catch (e) {
    return { error: `the store did not bundle: ${(e.errors ?? []).map((x) => x.text).join("; ") || e.message}` };
  }
  const { mod, inputs } = bundled;
  // the clause pass's write, with a finding (so the whole body runs) and without one (the early return)
  const stamped = await driveStore(mod, "completeRun", [{ runId: "run-9", status: "running", coverage: [], inputManifest: {}, findings: [{ ...A_FINDING }], stamp: { ...STAMP_HANDED } }]);
  const stampedNoFindings = await driveStore(mod, "completeRun", [{ runId: "run-9", status: "running", coverage: [], inputManifest: {}, findings: [], stamp: { ...STAMP_HANDED } }]);
  // the flip, and a failure: no stamp
  const unstamped = await driveStore(mod, "completeRun", [{ runId: "run-9", status: "rules_ready", findings: [] }]);
  const unstampedFailed = await driveStore(mod, "completeRun", [{ runId: "run-9", status: "failed", findings: [], error: "x" }]);
  const queued = await driveStore(mod, "insertQueuedRun", [{ ...QUEUE_HANDED }]);
  return { inputs, stamped, stampedNoFindings, unstamped, unstampedFailed, queued };
}

/** The version columns an object written to the database names, with their values. */
const versionsIn = (o) => (o && typeof o === "object" ? Object.fromEntries(VERSION_COLS.filter((c) => Object.hasOwn(o, c)).map((c) => [c, o[c]])) : {});
/** Each call on db as `method:table` (table "-" when it names none), in order. */
const callShape = (r) => r.st.calls.map((c) => `${c.method}:${c.table ?? "-"}`);
/** The objects handed to one call's chained `name` links (`set`, `values`). */
const linkArgs = (c, name) => c.links.filter((l) => l.name === name).map((l) => l.args[0]);
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const describeStore = (r) => (r ? `${r.threw ? `threw ${r.error?.message ?? r.error}` : "returned"}; calls: ${r.st.calls.map((c) => `${c.method}(${c.table ?? ""})${c.links.map((l) => `.${l.name}(${JSON.stringify(l.args[0] ?? null)?.slice(0, 160)})`).join("")}`).join(" ; ") || "none"}` : "not run");
/** One update of the runs table and nothing else but `rest`, its one .set() naming exactly `versions`. */
const oneRunsUpdate = (r, versions, rest) => {
  if (!r || r.threw || !sameJson(callShape(r), ["update:study_proofread_runs", ...rest])) return false;
  const sets = linkArgs(r.st.calls[0], "set");
  // both sides read through versionsIn, so key order never matters
  return sets.length === 1 && sameJson(versionsIn(sets[0]), versionsIn(versions)) && r.st.calls[0].links.some((l) => l.name === "where");
};

const SCHECKS = [
  {
    id: "runs-complete-run-writes-the-stamp-it-is-handed",
    msg: "RUN: completeRun, handed a stamp, makes exactly one update of study_proofread_runs — whose one .set() writes rulesVersion, engineStamp and protocolVersion as the stamp's own fields — and no other call on db but the findings insert when it was handed findings (whose rows name no version column): a second update, a rebinding or mutation of args, an alias or a raw execute that writes rules_version from the engine stamp would reopen every decision after every deploy (I-1), and the text check reads only the first .set()",
    test: (o) =>
      oneRunsUpdate(o.stamped, STAMP_HANDED, ["insert:study_proofread_findings"]) &&
      linkArgs(o.stamped.st.calls[1], "values").every((rows) => Array.isArray(rows) && rows.length === 1 && rows.every((row) => sameJson(versionsIn(row), {}))) &&
      oneRunsUpdate(o.stampedNoFindings, STAMP_HANDED, []),
    why: (o) => `with a finding: ${describeStore(o.stamped)} || without: ${describeStore(o.stampedNoFindings)}`,
  },
  {
    id: "runs-complete-run-without-a-stamp-writes-no-version",
    msg: "RUN: completeRun handed no stamp (the flip to rules_ready, a failure) makes exactly one update of study_proofread_runs whose one .set() names no version column, and no other call on db: only the clause pass's write stamps a run, and any other write that names rules_version replaces the rules the findings were judged under",
    test: (o) => oneRunsUpdate(o.unstamped, {}, []) && oneRunsUpdate(o.unstampedFailed, {}, []),
    why: (o) => `flip: ${describeStore(o.unstamped)} || failed: ${describeStore(o.unstampedFailed)}`,
  },
  {
    id: "runs-queued-run-records-what-it-was-given",
    msg: "RUN: insertQueuedRun makes exactly one call on db, an insert into study_proofread_runs whose one .values() writes protocolVersion, rulesVersion and engineStamp as its own arguments of those names — however its text reaches them (a rebinding of args, an alias, a helper)",
    test: (o) => {
      const r = o.queued;
      if (!r || r.threw || !sameJson(callShape(r), ["insert:study_proofread_runs"])) return false;
      const values = linkArgs(r.st.calls[0], "values");
      return values.length === 1 && sameJson(versionsIn(values[0]), versionsIn(QUEUE_HANDED));
    },
    why: (o) => describeStore(o.queued),
  },
];
const SIDS = SCHECKS.map((c) => c.id);
ok(new Set([...SIDS, ...BIDS, ...ids]).size === SIDS.length + BIDS.length + ids.length, "precondition: every store behaviour check id is unique, and none repeats a text or runner behaviour check's id");

const srun = (o) => (o.error ? [...SIDS] : SCHECKS.filter((c) => !c.test(o)).map((c) => c.id));
const realStoreObs = await observeStore(sources.store);
ok(!realStoreObs.error, "the real store bundles with its db, drizzle, logger and clause imports stubbed", realStoreObs.error);
if (!realStoreObs.error) {
  const real = realStoreObs.inputs.filter((p) => !p.startsWith("store-stub:"));
  const leaked = real.filter((p) => /lib\/db\/|@workspace\/db|drizzle|logger\.ts|proofread\/index\.ts|pino|node_modules/.test(p));
  ok(
    leaked.length === 0 && real.some((p) => p.endsWith("proofread/lifecycle.ts")),
    "the store bundle holds the store and the real lifecycle.ts, and no db, drizzle, logger or clause module — so nothing it runs can open a connection",
    leaked.length ? `in the bundle: ${leaked.join(", ")}` : `inputs: ${realStoreObs.inputs.join(", ")}`,
  );
}
{
  // The refusal stands between a store call and a real database, so it is tested: the store with its db import
  // spelled so it escapes the stubs must come back refused, unloaded — never run.
  const escaped = sources.store.replace(/\} from "@workspace\/db";/, '} from "../../../../lib/db/src/index.ts";');
  const o = escaped === sources.store ? { error: "the db import was not found to respell" } : await observeStore(escaped);
  ok(
    typeof o.error === "string" && /refused to load a store bundle that pulls in .*lib\/db\/src\/index\.ts/.test(o.error),
    "a store whose db import escapes the stubs in a spelling esbuild resolves (a relative path to lib/db/src/index.ts) is refused before it is imported, never run",
    o.error ?? "it was loaded and run",
  );
}
const sfailing = srun(realStoreObs);
for (const c of SCHECKS) {
  const red = sfailing.includes(c.id);
  ok(!red, `[${c.id}] ${c.msg}`, red ? (realStoreObs.error ?? c.why(realStoreObs)) : undefined);
}

// Store behaviour teeth: each edit to the store's text must turn exactly these store behaviour checks red when
// the edited store is bundled and RUN.
const COMPLETE_ANCHOR = "  if (args.findings.length === 0) return;\n";
const COMPLETE_TOP = "  stamp?: { rulesVersion: string; engineStamp: string; protocolVersion: string };\n}): Promise<void> {\n";
const QUEUE_TOP = "}): Promise<StudyProofreadRun | null> {\n";
const SMUTATIONS = [
  {
    label: "write the run-time engine stamp into rules_version (RR-2)",
    flips: ["runs-complete-run-writes-the-stamp-it-is-handed"],
    apply: (t) => t.replace("rulesVersion: args.stamp.rulesVersion,", "rulesVersion: args.stamp.engineStamp,"),
  },
  {
    label: "a second update of the run that writes rules_version from the engine stamp (W2-G1-1, C2e)",
    flips: ["runs-complete-run-writes-the-stamp-it-is-handed"],
    apply: (t) => t.replace(COMPLETE_ANCHOR, `  if (args.stamp) await db.update(studyProofreadRunsTable).set({ rulesVersion: args.stamp.engineStamp }).where(eq(studyProofreadRunsTable.id, args.runId));\n${COMPLETE_ANCHOR}`),
  },
  {
    label: "rebind args with the engine stamp as the rules version before the update (W2-G1-1, C2f)",
    flips: ["runs-complete-run-writes-the-stamp-it-is-handed"],
    apply: (t) => t.replace(COMPLETE_TOP, `${COMPLETE_TOP}  if (args.stamp) args = { ...args, stamp: { ...args.stamp, rulesVersion: args.stamp.engineStamp } };\n`),
  },
  {
    label: "rewrite the handed stamp through an alias before the update",
    flips: ["runs-complete-run-writes-the-stamp-it-is-handed"],
    apply: (t) => t.replace(COMPLETE_TOP, `${COMPLETE_TOP}  const s = args.stamp;\n  if (s) s.rulesVersion = s.engineStamp;\n`),
  },
  {
    label: "a second update of the run after the early return, through a string-key element access",
    flips: ["runs-complete-run-writes-the-stamp-it-is-handed"],
    apply: (t) => t.replace(COMPLETE_ANCHOR, `${COMPLETE_ANCHOR}  if (args.stamp) await db["update"](studyProofreadRunsTable).set({ rulesVersion: args.stamp.engineStamp }).where(eq(studyProofreadRunsTable.id, args.runId));\n`),
  },
  {
    label: "rewrite rules_version in raw SQL after the update",
    flips: ["runs-complete-run-writes-the-stamp-it-is-handed"],
    apply: (t) => t.replace(COMPLETE_ANCHOR, `  if (args.stamp) await db.execute(sql\`update study_proofread_runs set rules_version = \${args.stamp.engineStamp} where id = \${args.runId}\`);\n${COMPLETE_ANCHOR}`),
  },
  {
    label: "write the stamp only when none was handed (the condition inverted)",
    flips: ["runs-complete-run-writes-the-stamp-it-is-handed", "runs-complete-run-without-a-stamp-writes-no-version"],
    apply: (t) => t.replace("args.stamp === undefined", "args.stamp !== undefined"),
  },
  {
    label: "write a rules version on every write, stamped or not",
    flips: ["runs-complete-run-without-a-stamp-writes-no-version"],
    apply: (t) => t.replace("      status: args.status,\n", '      status: args.status,\n      rulesVersion: args.stamp?.rulesVersion ?? "rules-unknown",\n'),
  },
  {
    label: "record the queuing deploy's engine stamp as the run's rules version (RR-2)",
    flips: ["runs-queued-run-records-what-it-was-given"],
    apply: (t) => t.replace("      rulesVersion: args.rulesVersion,", "      rulesVersion: args.engineStamp,"),
  },
  {
    label: "rebind args with the engine stamp as the rules version at the top of insertQueuedRun (W2-G1-2, C1e)",
    flips: ["runs-queued-run-records-what-it-was-given"],
    apply: (t) => t.replace(QUEUE_TOP, `${QUEUE_TOP}  args = { ...args, rulesVersion: args.engineStamp };\n`),
  },
  {
    label: "rewrite the queued rules version through an alias before the insert",
    flips: ["runs-queued-run-records-what-it-was-given"],
    apply: (t) => t.replace(QUEUE_TOP, `${QUEUE_TOP}  const a = args;\n  a.rulesVersion = a.engineStamp;\n`),
  },
];
const SSTAYS_GREEN = [
  {
    label: "the stamp's three fields written in another order",
    apply: (t) =>
      t.replace(
        "            rulesVersion: args.stamp.rulesVersion,\n            engineStamp: args.stamp.engineStamp,\n            protocolVersion: args.stamp.protocolVersion,\n",
        "            protocolVersion: args.stamp.protocolVersion,\n            engineStamp: args.stamp.engineStamp,\n            rulesVersion: args.stamp.rulesVersion,\n",
      ),
  },
];

const steeth = new Set(SIDS);
for (const m of SMUTATIONS) {
  const unknown = m.flips.filter((id) => !steeth.has(id));
  ok(unknown.length === 0, `store behaviour teeth: "${m.label}" names only real store behaviour checks`, unknown.length ? `unknown: ${unknown.join(", ")}` : undefined);
  const text = m.apply(sources.store);
  ok(text !== sources.store, `store behaviour teeth: "${m.label}" actually changes the store`);
  const o = await observeStore(text);
  const got = srun(o).filter((id) => !sfailing.includes(id)).sort().join(", ");
  const want = [...new Set(m.flips)].sort().join(", ");
  ok(
    !o.error && want === got,
    `store behaviour teeth: "${m.label}" — the edited store, RUN, is caught by exactly the store behaviour checks that claim to protect it`,
    o.error ?? (want === got ? undefined : `expected red: ${want || "(none)"}; actually red: ${got || "(none)"}`),
  );
}
for (const g of SSTAYS_GREEN) {
  const text = g.apply(sources.store);
  ok(text !== sources.store, `store behaviour stays green: "${g.label}" applies to the store`);
  const o = await observeStore(text);
  const now = srun(o).filter((id) => !sfailing.includes(id));
  ok(!o.error && now.length === 0, `store behaviour stays green: "${g.label}" — no store behaviour check refuses it`, o.error ?? (now.length ? `went red: ${now.join(", ")}` : undefined));
}
const scovered = new Set(SMUTATIONS.flatMap((m) => m.flips));
const stoothless = SIDS.filter((id) => !scovered.has(id));
ok(stoothless.length === 0, "every store behaviour check has a mutation proving it has teeth", stoothless.length ? `no mutation breaks: ${stoothless.join(", ")}` : undefined);

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
