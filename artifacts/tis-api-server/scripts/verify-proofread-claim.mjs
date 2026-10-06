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
 * Reads as text and imports only lifecycle.ts, which is pure; it never imports
 * the store, the runner or @workspace/db, and so never opens a connection.
 *
 * Run: `pnpm run check:proofread-claim`
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

const count = (s, needle) => s.split(needle).length - 1;
const UNIT_MS = { millisecond: 1, second: 1000, minute: 60_000, hour: 3_600_000 };

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
    id: "carry-forward-requires-same-engine",
    on: "store",
    msg: "carryForwardDispositions carries nothing when the engine stamp changed: a disposition was made against one engine's numbers",
    test: (s) => /if \(!sameEngine\) return 0;/.test(body(s.store, "carryForwardDispositions")),
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
      /\.values\(\{ findingId: nf\.id, disposition: prior\[0\]\.disposition, note: prior\[0\]\.note, sourceLabel: prior\[0\]\.sourceLabel, actorUserId: prior\[0\]\.actorUserId, \}\)/.test(
        norm(body(s.store, "carryForwardDispositions")),
      ),
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
    id: "previous-run-is-rules-ready",
    on: "store",
    msg: "previousRunForProject looks one revision back among runs that finished their clause pass — a failed revision would carry nothing and strand the one before it",
    test: (s) => /eq\(studyProofreadRunsTable\.status, "rules_ready"\)/.test(body(s.store, "previousRunForProject")),
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
        /prev\.engineStamp === run\.engineStamp/.test(b) &&
        // the flip is its own call and writes no coverage, so it cannot undo
        // what the first half recorded
        /await completeRun\(\{ runId: run\.id, status: "rules_ready", findings: \[\] \}\);/.test(b)
      );
    },
  },
  {
    id: "pass-writes-findings-and-coverage",
    on: "runner",
    msg: "the FIRST completeRun call — the only place a pass's findings are ever written, since the flip is pinned to findings: [] — carries the pass's coverage, its input manifest and its findings; without them a run reaches rules_ready having recorded nothing",
    test: (s) =>
      /await completeRun\(\{ runId: run\.id, status: "running", coverage, inputManifest: buildInputManifest\(rec\), findings, \}\);/.test(
        norm(body(s.runner, "claimAndRunOne")),
      ),
  },
  {
    id: "enqueue-fails-open",
    on: "runner",
    msg: "enqueueProofread fails open: a row it could not insert is logged and returned from, never thrown — a proofread that cannot run must not affect the study",
    test: (s) => {
      const b = body(s.runner, "enqueueProofread");
      return b.length > 0 && /if \(!run\) \{[\s\S]*?logger\.warn\([\s\S]*?return;[\s\S]*?\}/.test(b) && !/throw /.test(b);
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
    label: "carry dispositions forward across an engine change",
    file: "store",
    flips: ["carry-forward-requires-same-engine"],
    apply: edit("store", "if (!sameEngine) return 0;", ""),
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
    flips: ["previous-run-is-rules-ready"],
    apply: edit("store", /\n *eq\(studyProofreadRunsTable\.status, "rules_ready"\),/, ""),
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
    also: ["pass-writes-findings-and-coverage"],
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
    also: ["pass-writes-findings-and-coverage"],
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
      const moved = b.replace(carry[0], "").replace("    try {", `    try {${carry[0]}`);
      return { ...s, runner: s.runner.replace(b, moved) };
    },
  },
  {
    label: "throw out of enqueueProofread when the row could not be inserted",
    file: "runner",
    flips: ["enqueue-fails-open"],
    apply: edit("runner", /if \(!run\) \{[\s\S]*?\n  \}/, 'if (!run) throw new Error("enqueue failed");'),
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

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
