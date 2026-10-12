#!/usr/bin/env node
/**
 * Teeth for the Postgres harness: shows that run.mjs goes red when the code it pins is broken, so a green run
 * means something. Opt-in, like run.mjs, and NOT a `check:*` script.
 *
 *   node artifacts/tis-api-server/scripts/proofread-pg-harness/teeth.mjs [--root <dir>] [--pg-bin <dir>] [<break> ...]
 *
 * It exports HEAD's committed source (git archive: the server's src, lib/db, lib/tis-api-zod, lib/tis-engine-core,
 * the fixture and the protocol) into a temporary directory. Uncommitted edits in the checkout are not part of it,
 * and nothing in the checkout is ever edited. Then, for each entry of BREAKS, it copies that export, changes ONE
 * production line in the copy, runs run.mjs --tree on the copy (a cluster of its own each time), and requires the
 * named assertions to fail (exit 1) — or, for the two refusal breaks, the run to be refused before any cluster
 * exists (exit 2). The unbroken export must pass (exit 0). A break whose line no longer matches exactly once
 * fails by name: the production code moved, and the break must be re-aimed, not dropped.
 *
 * Every run must also have torn down: run.mjs printed its teardown line (cluster stopped or never started, socket
 * directory and run directory removed), and `ps` lists no postmaster on a data directory under this script's work
 * directory. A cluster a run left behind is stopped here, and that break FAILS. Nothing here removes a data
 * directory under a live postmaster: a cluster is stopped with pg_ctl, `ps` must then show its postmaster gone
 * (postmaster.mjs), and only then is the directory removed; if one cannot be confirmed gone, the work directory
 * is kept and its path printed.
 *
 * Exit 0: every break went red as expected, every run tore down, and the unbroken export passed. 1: otherwise.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { postmastersUnder, stopCluster } from "./postmaster.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const valueFlags = new Set(["--root", "--pg-bin"]);
const only = argv.filter((a, i) => !a.startsWith("--") && !valueFlags.has(argv[i - 1]));

const SRC = "artifacts/tis-api-server/src";
const ROUTES = `${SRC}/routes/proofread.ts`;
const STORE = `${SRC}/lib/proofread-store.ts`;
const RUNNER = `${SRC}/lib/proofread-run.ts`;
const SECURITY = `${SRC}/lib/security.ts`;

/** name -> { edit: [file, exact text, replacement], red: assertion-name prefixes that must FAIL } or { refused }. */
const BREAKS = {
  "withheld-count-is-zero": {
    edit: [ROUTES, `const withheld = findings.filter((f) => f.audience === "admin").length;`, `const withheld = 0;`],
    red: ["[FW-3 withheld] GET counts the admin-audience finding", "[FW-3 withheld] GET answers withheld: 1"],
  },
  "admin-findings-served": {
    edit: [ROUTES, `findings: visible.map((f) => ({`, `findings: findings.map((f) => ({`],
    red: ["[FW-3 withheld] the count is all that leaves the server", "[FW-3 withheld] nothing of that DEFECT leaves the server"],
  },
  "type-check-off": {
    edit: [ROUTES, `if (!decisionApplies(finding.type, parsed.data.disposition)) {`, `if (false) {`],
    red: ["[FW-5 422] DISCLOSED on a BLOCKER", "[FW-5 422] no decision a firm member can send applies to a CONTESTED finding"],
  },
  "latest-run-check-off": {
    edit: [ROUTES, `if (newest === null || newest.id !== runId || (newest.status !== "rules_ready" && newest.status !== "ready")) {`, `if (newest === null) {`],
    red: ["[FW-6 409] a fitting decision on a superseded revision", "[FW-6 409] while a newer revision is still running", "[M1] an uppercase id of a superseded revision is still 409"],
  },
  "carry-gate-reads-the-engine-stamp": {
    edit: [
      STORE,
      `.select({ id: studyProofreadRunsTable.id, rulesVersion: studyProofreadRunsTable.rulesVersion })`,
      `.select({ id: studyProofreadRunsTable.id, rulesVersion: studyProofreadRunsTable.engineStamp })`,
    ],
    red: ["[FW-1 carry] across the deploy"],
  },
  "carry-gate-always-true": {
    edit: [RUNNER, `prev.rulesVersion === RULES_VERSION`, `true`],
    red: ["[FW-1 carry] a revision whose predecessor ran under another rules version", "[RR-1] its predecessor ran under the older rules"],
  },
  "carried-date-dropped": {
    edit: [STORE, `      createdAt: prior[0].createdAt,\n`, ``],
    red: ["[FW-2 date]"],
  },
  "claim-rewrites-the-study-row": {
    edit: [
      STORE,
      `export async function loadStudyForRun(run: StudyProofreadRun) {\n`,
      "export async function loadStudyForRun(run: StudyProofreadRun) {\n  await db.update(tisProjectsTable).set({ projectName: sql`${tisProjectsTable.projectName}` }).where(eq(tisProjectsTable.id, run.projectId));\n",
    ],
    red: ["[claim] across that claimAndRunOne", "after every request above, tis_projects is byte-identical"],
  },
  // [RR-1] the run-time stamp, the carry's comparison of run-time values, and the mid-run rules check.
  "run-stamp-dropped": {
    edit: [RUNNER, `      stamp: { rulesVersion: RULES_VERSION, engineStamp: engineStamp(), protocolVersion: PROTOCOL_VERSION },\n`, ``],
    red: ["[RR-1] a run queued under older rules and claimed by this deploy is stamped", "[RR-1] a run queued under older rules after a revision"],
  },
  "carry-gate-compares-queue-time-rules": {
    edit: [RUNNER, `prev.rulesVersion === RULES_VERSION`, `prev.rulesVersion === run.rulesVersion`],
    red: ["[RR-1] its predecessor ran under the older rules", "[RR-1] a run queued under older rules after a revision"],
  },
  "mid-run-rules-check-off": {
    edit: [RUNNER, `if (run.rulesVersion !== RULES_VERSION && (await runHoldsFindings(run.id))) {`, `if (false) {`],
    red: ["[RR-1] a re-claimed run that already holds findings written under other rules"],
  },
  // [m-6] GET's rulesChanged, both ways.
  "rules-changed-always-false": {
    edit: [ROUTES, `const rulesChanged = previous !== null && previous.rulesVersion !== run.rulesVersion;`, `const rulesChanged = false;`],
    red: ["[m-6] that revision answers rulesChanged: true", "[m-6] GET on that revision answers rulesChanged: true"],
  },
  "rules-changed-ignores-the-rules": {
    edit: [ROUTES, `const rulesChanged = previous !== null && previous.rulesVersion !== run.rulesVersion;`, `const rulesChanged = previous !== null;`],
    red: ["[m-6] revision 2 ran under another deploy and the same rules", "[m-6] GET on that revision answers rulesChanged: false"],
  },
  // [M1] the uuid params in one spelling; [M2] 'ready' is finished, for the 409 and for the carry.
  "run-id-not-lowercased": {
    edit: [ROUTES, `const runId = urlRunId.toLowerCase();`, `const runId = urlRunId;`],
    red: ["[M1] the newest finished run's id in uppercase is that run", "[M1] project, run and finding ids all in uppercase"],
  },
  "ready-run-refused": {
    edit: [ROUTES, `(newest.status !== "rules_ready" && newest.status !== "ready")`, `newest.status !== "rules_ready"`],
    red: ["[M2] a decision on the project's newest run in 'ready' is accepted"],
  },
  "ready-run-not-a-carry-source": {
    edit: [STORE, `inArray(studyProofreadRunsTable.status, ["rules_ready", "ready"]),`, `inArray(studyProofreadRunsTable.status, ["rules_ready"]),`],
    red: ["[M2] the next revision carries the latest decision on each finding from the 'ready' run"],
  },
  // [append-only] an earlier decision rewritten before the new one is appended: once with other values (it names
  // another actor), once with the values it already had (only xmin changes).
  "log-rewrites-earlier-rows": {
    edit: [
      STORE,
      `  await db.insert(studyProofreadDispositionsTable).values({\n    findingId: args.findingId,\n`,
      "  await db.update(studyProofreadDispositionsTable).set({ actorUserId: args.actorUserId, note: sql`'(superseded) ' || coalesce(${studyProofreadDispositionsTable.note}, '')` }).where(eq(studyProofreadDispositionsTable.findingId, args.findingId));\n  await db.insert(studyProofreadDispositionsTable).values({\n    findingId: args.findingId,\n",
    ],
    red: ["[append-only] so far", "[append-only] across every POST and claim"],
  },
  "log-touches-earlier-rows": {
    edit: [
      STORE,
      `  await db.insert(studyProofreadDispositionsTable).values({\n    findingId: args.findingId,\n`,
      "  await db.update(studyProofreadDispositionsTable).set({ note: sql`${studyProofreadDispositionsTable.note}` }).where(eq(studyProofreadDispositionsTable.findingId, args.findingId));\n  await db.insert(studyProofreadDispositionsTable).values({\n    findingId: args.findingId,\n",
    ],
    red: ["[append-only] so far", "[append-only] across every POST and claim"],
  },
  // [limiter] the decision limiter's per-user key and its draft-7 headers.
  "decision-limiter-keyed-by-address": {
    edit: [
      SECURITY,
      `  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),\n  store: makeRateLimitStore("rl:proofread-disp:"),`,
      `  keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),\n  store: makeRateLimitStore("rl:proofread-disp:"),`,
    ],
    red: ["[limiter] the decision limiter is keyed per user"],
  },
  "decision-limiter-draft-6-headers": {
    edit: [
      SECURITY,
      `  standardHeaders: "draft-7",\n  legacyHeaders: false,\n  passOnStoreError: true,\n  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),\n  store: makeRateLimitStore("rl:proofread-disp:"),`,
      `  standardHeaders: "draft-6",\n  legacyHeaders: false,\n  passOnStoreError: true,\n  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? ""),\n  store: makeRateLimitStore("rl:proofread-disp:"),`,
    ],
    red: ["[limiter] the decision limiter's 429 uses draft-7 headers"],
  },
  // Teardown: the second server never boots (the restart is "a deploy of b2..."), so the driver stops part-way.
  // The run must still stop its server and its cluster and remove its directories (the per-run check below).
  "server-boot-fails-on-restart": {
    edit: [ROUTES, `const router: IRouter = Router();\n`, `const router: IRouter = Router();\nif ((process.env.GIT_SHA ?? "").startsWith("b2")) process.exit(3);\n`],
    red: ["driver completed"],
  },
  // The two refusals: a bundle that could take its database from the environment is never run.
  "store-imports-the-real-db-module": {
    edit: [STORE, `import { logger } from "./logger";\n`, `import { logger } from "./logger";\nimport "../../../../lib/db/src/index.ts";\n`],
    refused: "lib/db/src/index.ts",
  },
  "store-reads-the-environment-database": {
    edit: [STORE, `import { logger } from "./logger";\n`, `import { logger } from "./logger";\nif (process.env.DATABASE_URL) logger.info("database configured");\n`],
    refused: "DATABASE_URL",
  },
};

const work = mkdtempSync(path.join(path.resolve(opt("--root") ?? os.tmpdir()), "proofread-pg-teeth-"));
const runs = path.join(work, "runs");
mkdirSync(runs);
const pgBin = opt("--pg-bin") ?? null;
/** Socket directories the runs named, so one a run left behind can be removed once its cluster is gone. */
const socketDirs = new Set();
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" };
/** pg_ctl's directory: --pg-bin, else the one `ps` shows the postmaster was started from. */
const pgBinFor = (command) => pgBin ?? path.dirname(command.split(/\s+-D\s+/)[0]);
/**
 * Stop every postmaster on a data directory under `dir`, and confirm each is gone. Returns those that are not.
 * A data directory is never removed here; the caller removes only what is confirmed stopped.
 */
function stopClustersUnder(dir) {
  const left = [];
  for (const p of postmastersUnder(dir)) {
    const dataDir = p.command.split(/\s+-D\s+/)[1].split(/\s+/)[0];
    const r = stopCluster({ pgBin: pgBinFor(p.command), dataDir, env });
    if (!r.stopped) left.push(...r.left);
  }
  return left;
}
const verdicts = [];
const note = (name, ok, detail) => {
  verdicts.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
};
const harness = (tree) => {
  const args = [path.join(HERE, "run.mjs"), "--tree", tree, "--root", runs];
  if (pgBin) args.push("--pg-bin", pgBin);
  // SIGTERM on a timeout: run.mjs tears down on it.
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 300_000, killSignal: "SIGTERM" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const socketDir = /unix socket only, in (\S+);/.exec(out)?.[1];
  if (socketDir) socketDirs.add(socketDir);
  // Did this run clean up after itself? Its teardown line, and no postmaster left on anything under runs/.
  const teardownLine = out.split("\n").find((l) => l.startsWith("teardown: ")) ?? "(no teardown line)";
  const cleanLine = /^teardown: cluster on port \S+ (stopped|never started); socket dir (removed|never made); run directory removed$/.test(teardownLine);
  const leftRunning = postmastersUnder(runs);
  const notStopped = leftRunning.length ? stopClustersUnder(runs) : [];
  const leftDirs = readdirSync(runs);
  if (notStopped.length === 0) for (const d of leftDirs) rmSync(path.join(runs, d), { recursive: true, force: true });
  if (socketDir && existsSync(socketDir) && notStopped.length === 0) rmSync(socketDir, { recursive: true, force: true });
  const clean = cleanLine && leftRunning.length === 0 && leftDirs.length === 0;
  const cleanDetail = clean
    ? ""
    : `; DID NOT TEAR DOWN: ${teardownLine}${leftRunning.length ? `; left running: ${leftRunning.map((p) => p.pid).join(", ")}${notStopped.length ? " (could not be stopped)" : " (stopped here)"}` : ""}${leftDirs.length ? `; left in runs/: ${leftDirs.join(", ")}` : ""}`;
  return { status: r.status, out, clean, cleanDetail, reds: out.split("\n").filter((l) => l.startsWith("FAIL  ")).map((l) => l.slice(6)) };
};

try {
  const base = path.join(work, "base");
  mkdirSync(base);
  const paths = [SRC, "lib/db/src", "lib/tis-api-zod/src", "lib/tis-engine-core/src", "artifacts/atlanta-tis/scripts/fixtures/scenario-base.json", "TIS-PROOFREAD-PROTOCOL.md"];
  const archive = spawnSync("git", ["-C", REPO, "archive", "--format=tar", "HEAD", "--", ...paths], { maxBuffer: 1 << 30 });
  if (archive.status !== 0) throw new Error(`git archive failed: ${archive.stderr}`);
  const untar = spawnSync("tar", ["-x", "-C", base], { input: archive.stdout });
  if (untar.status !== 0) throw new Error(`tar failed: ${untar.stderr}`);
  console.log(`HEAD exported to ${base}`);

  if (only.length === 0) {
    const r = harness(base);
    note("the unbroken export passes (exit 0) and tears down", r.status === 0 && r.clean, r.status === 0 && r.clean ? "" : `exit ${r.status}; red: ${r.reds.join(" | ") || r.out.slice(-600)}${r.cleanDetail}`);
  }
  for (const [name, b] of Object.entries(BREAKS)) {
    if (only.length && !only.includes(name)) continue;
    const tree = path.join(work, name);
    cpSync(base, tree, { recursive: true });
    const [file, from, to] = b.edit;
    const text = readFileSync(path.join(tree, file), "utf8");
    const matches = text.split(from).length - 1;
    if (matches !== 1) {
      note(`${name}: the line to break matches exactly once in ${file}`, false, `found ${matches}; re-aim this break at the code as it now reads`);
      continue;
    }
    writeFileSync(path.join(tree, file), text.replace(from, () => to));
    const r = harness(tree);
    if (b.refused) {
      const refusal = r.out.split("\n").find((l) => l.startsWith("REFUSED")) ?? "";
      const neverStarted = /cluster on port \d+ never started/.test(r.out);
      note(`${name}: refused before any cluster exists (exit 2, names ${b.refused}), and tears down`, r.status === 2 && refusal.includes(b.refused) && neverStarted && r.clean, `${refusal || r.out.slice(-600)}${r.cleanDetail}`);
    } else {
      const missing = b.red.filter((prefix) => !r.reds.some((red) => red.startsWith(prefix)));
      note(
        `${name}: red (exit 1) on ${b.red.join(" + ")}, and tears down`,
        r.status === 1 && missing.length === 0 && r.clean,
        `exit ${r.status}; red: ${r.reds.join(" | ") || "none"}${missing.length ? `; NOT red: ${missing.join(" | ")}` : ""}${r.cleanDetail}`,
      );
    }
    rmSync(tree, { recursive: true, force: true });
  }
} catch (err) {
  note("teeth completed", false, err instanceof Error ? err.message : String(err));
} finally {
  // Stop, confirm gone, then remove: never a data directory under a live postmaster.
  let left = [];
  try {
    left = stopClustersUnder(work);
  } catch (err) {
    left = [{ pid: "unknown", command: `could not confirm: ${err instanceof Error ? err.message : String(err)}` }];
  }
  if (left.length) {
    note("every cluster under the work directory stopped", false, `still running: ${left.map((p) => `${p.pid} ${p.command}`).join("; ")}; ${work} is KEPT — stop each with pg_ctl -D <its data dir> stop, then delete it`);
  } else {
    rmSync(work, { recursive: true, force: true });
    for (const d of socketDirs) rmSync(d, { recursive: true, force: true });
    console.log(`removed ${work}${existsSync(work) ? " (STILL PRESENT)" : ""}`);
  }
}
const failed = verdicts.filter((v) => !v.ok);
console.log(`\n${verdicts.length - failed.length}/${verdicts.length} as expected`);
process.exit(failed.length ? 1 : 0);
