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
 * is kept and its path printed. A data directory whose postmaster.pid names a live process — any process, once
 * every postmaster ps lists there is stopped — is not removed either: that is run.mjs's own rule (postmaster.mjs).
 *
 * Before the breaks, SAFETY holds the teardown's own rules, each by name: a postmaster is the process whose command
 * ENDS in ` -D <its data directory>` (a directory with a space in it included); a postmaster.pid naming a live
 * process that is not a postgres on that directory is never handed to pg_ctl and is "not confirmed stopped"; a live
 * cluster whose data directory has a space is stopped and confirmed gone; run.mjs refuses (exit 2, nothing made) a
 * --root or a TMPDIR with whitespace in it; a SIGINT that stops a setup step (sent to the run's process group while
 * an initdb that traps it runs, or to the initdb alone) exits 130 after tearing down. The cluster SAFETY starts is this script's own (unix socket only, a port
 * in 54400-54999), and a pid file naming another process is pointed at that cluster's postmaster or at a `sleep`
 * this script started, with a pg_ctl that only logs — never at a process this script did not start.
 *
 * A --root or a TMPDIR with whitespace in it is refused here too (exit 2), before anything is made.
 *
 * Exit 0: every safety check held, every break went red as expected, every run tore down, and the unbroken export
 * passed. 1: otherwise. 2: refused.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commandOf, findPgBin, isPostmasterOn, postmasterPidOf, postmastersIn, postmastersUnder, stopCluster } from "./postmaster.mjs";

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

// The same refusal as run.mjs's, for the same reason, before anything is made: every run's --root is under this one.
const ROOT_BASE = path.resolve(opt("--root") ?? os.tmpdir());
for (const dir of [ROOT_BASE, path.resolve(os.tmpdir())]) {
  let real = null;
  try {
    real = realpathSync(dir);
  } catch {}
  const spaced = [dir, real].filter((p) => p && /\s/.test(p));
  if (spaced.length) {
    console.error(`REFUSED: ${JSON.stringify(spaced[0])} (--root or TMPDIR) contains whitespace; pass a --root (and a TMPDIR) without any. Nothing was made.`);
    process.exit(2);
  }
}
const work = mkdtempSync(path.join(ROOT_BASE, "proofread-pg-teeth-"));
const runs = path.join(work, "runs");
mkdirSync(runs);
const pgBin = opt("--pg-bin") ?? null;
/** Socket directories the runs named, so one a run left behind can be removed once its cluster is gone. */
const socketDirs = new Set();
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" };
/**
 * Stop every postmaster on a data directory under `dir`, and confirm each is gone. Returns those that are not.
 * pg_ctl's directory is --pg-bin, else the one `ps` shows the postmaster was started from (postmaster.mjs reads the
 * program and the data directory from the end of the command line, so a space in either is read whole).
 * A data directory is never removed here; the caller removes only what is confirmed stopped.
 */
function stopClustersUnder(dir) {
  const left = [];
  for (const p of postmastersUnder(dir)) {
    const r = stopCluster({ pgBin: pgBin ?? path.dirname(p.program), dataDir: p.dataDir, env });
    if (!r.stopped) left.push(...r.left);
  }
  return left;
}
/**
 * Every postmaster.pid at most `depth` directories below `dir` that names a live process (any process). Called once
 * the postmasters ps lists are stopped, so each one found holds its directory: it is never removed.
 */
function livePidFilesUnder(dir, depth = 3) {
  const found = [];
  const walk = (d, n) => {
    if (existsSync(path.join(d, "postmaster.pid"))) {
      const pid = postmasterPidOf(d);
      let command = null;
      try {
        command = pid === null ? null : commandOf(pid);
      } catch (err) {
        command = `(ps could not say: ${err instanceof Error ? err.message : String(err)})`;
      }
      if (command !== null) found.push({ pid, command, dataDir: d });
    }
    if (n === 0) return;
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {}
    for (const e of entries) if (e.isDirectory() && e.name !== "node_modules") walk(path.join(d, e.name), n - 1);
  };
  walk(dir, depth);
  return found;
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
  const socketDir = /unix socket only, in (.+?); tree under test /.exec(out)?.[1];
  if (socketDir) socketDirs.add(socketDir);
  // Did this run clean up after itself? Its teardown line, and no postmaster left on anything under runs/.
  const teardownLine = out.split("\n").find((l) => l.startsWith("teardown: ")) ?? "(no teardown line)";
  const cleanLine = /^teardown: cluster on port \S+ (stopped|never started); socket dir (removed|never made); run directory removed$/.test(teardownLine);
  const leftRunning = postmastersUnder(runs);
  const notStopped = [...(leftRunning.length ? stopClustersUnder(runs) : []), ...livePidFilesUnder(runs)];
  const leftDirs = readdirSync(runs);
  if (notStopped.length === 0) for (const d of leftDirs) rmSync(path.join(runs, d), { recursive: true, force: true });
  if (socketDir && existsSync(socketDir) && notStopped.length === 0) rmSync(socketDir, { recursive: true, force: true });
  const clean = cleanLine && leftRunning.length === 0 && notStopped.length === 0 && leftDirs.length === 0;
  const cleanDetail = clean
    ? ""
    : `; DID NOT TEAR DOWN: ${teardownLine}${leftRunning.length ? `; left running: ${leftRunning.map((p) => p.pid).join(", ")}${notStopped.length ? " (could not be stopped)" : " (stopped here)"}` : ""}${notStopped.length ? `; held (kept): ${notStopped.map((p) => `${p.pid} ${p.command}`).join("; ")}` : ""}${leftDirs.length ? `; left in runs/: ${leftDirs.join(", ")}` : ""}`;
  return { status: r.status, out, clean, cleanDetail, reds: out.split("\n").filter((l) => l.startsWith("FAIL  ")).map((l) => l.slice(6)) };
};

// ---- SAFETY: the teardown's own rules (postmaster.mjs, and run.mjs's refusal), each a verdict by name -----------
const safetyDir = path.join(work, "safety");
/** A pg_ctl and an initdb that only log their arguments: the checks that must never reach a real one get these. */
const fakeBin = path.join(safetyDir, "fakebin");
const fakeCalls = path.join(fakeBin, "calls.log");
const freshFakeBin = () => {
  mkdirSync(fakeBin, { recursive: true });
  for (const tool of ["pg_ctl", "initdb"]) {
    writeFileSync(path.join(fakeBin, tool), `#!/bin/sh\necho "${tool} $*" >> '${fakeCalls}'\nexit 0\n`);
    chmodSync(path.join(fakeBin, tool), 0o755);
  }
  rmSync(fakeCalls, { force: true });
};
const fakeCallsSoFar = () => (existsSync(fakeCalls) ? readFileSync(fakeCalls, "utf8").trim() : "");
/** run.mjs on the unbroken export with these arguments and TMPDIR; it must refuse before it makes anything. */
const runRefusal = (base, root, tmpdir) => {
  const args = [path.join(HERE, "run.mjs"), "--tree", base, "--root", root];
  if (pgBin) args.push("--pg-bin", pgBin);
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 120_000, killSignal: "SIGTERM", env: { ...process.env, TMPDIR: tmpdir } });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { status: r.status, out, refusal: out.split("\n").find((l) => l.startsWith("REFUSED")) ?? "" };
};
/**
 * This script's own throwaway cluster, in a data directory with a space in its path: unix socket only (no TCP), a
 * port in 54400-54999 naming the socket, the socket in a short directory of its own. Started once, by whichever
 * check needs it first; stopped by the last one, or by the final cleanup.
 */
let cluster = null;
function spacedCluster() {
  if (cluster) return cluster;
  const bin = pgBin ?? findPgBin();
  if (!bin) throw new Error("PostgreSQL server binaries (initdb, pg_ctl) were not found; pass --pg-bin <dir>");
  const dataDir = path.join(safetyDir, "sp ace", "data");
  mkdirSync(path.dirname(dataDir), { recursive: true });
  const port = 54400 + Math.floor(Math.random() * 600);
  const sockBase = [os.tmpdir(), "/tmp"].find((b) => existsSync(b) && Buffer.byteLength(path.join(b, "pgh-XXXXXX", `.s.PGSQL.${port}`)) <= 100);
  if (!sockBase) throw new Error("no temp directory short enough for a unix socket path");
  const sock = mkdtempSync(path.join(sockBase, "pgh-"));
  socketDirs.add(sock);
  const init = spawnSync(path.join(bin, "initdb"), ["-D", dataDir, "-U", "proofread_teeth", "--auth=trust", "--no-locale", "-E", "UTF8"], { env, encoding: "utf8", timeout: 120_000 });
  if (init.status !== 0) throw new Error(`initdb exited ${init.status ?? init.signal}: ${(init.stderr ?? "").slice(-300)}`);
  appendFileSync(path.join(dataDir, "postgresql.conf"), `\nlisten_addresses = ''\nport = ${port}\nunix_socket_directories = '${sock}'\nfsync = off\n`);
  const start = spawnSync(path.join(bin, "pg_ctl"), ["-D", dataDir, "-l", path.join(path.dirname(dataDir), "postgres.log"), "-w", "-t", "60", "start"], { env, encoding: "utf8", timeout: 120_000 });
  cluster = { bin, dataDir, sock, pid: postmasterPidOf(dataDir) };
  if (start.status !== 0) throw new Error(`pg_ctl start exited ${start.status ?? start.signal}: ${(start.stderr ?? "").slice(-300)}`);
  return cluster;
}
/**
 * run.mjs on the unbroken export with an initdb that writes its pid and sleeps (`trap`: it traps SIGINT and exits 1,
 * as the real initdb does; `exec`: SIGINT kills it), stopped with SIGINT sent to run.mjs's process group or to that
 * initdb alone. run.mjs is spawned in a process group of its own, so the signal reaches nothing of this script.
 */
const sigBin = path.join(safetyDir, "sigbin");
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function runSignalled(base, mode, target) {
  mkdirSync(sigBin, { recursive: true });
  const pidFile = path.join(sigBin, "initdb.pid");
  rmSync(pidFile, { force: true });
  const initdb =
    mode === "trap"
      ? `#!/bin/sh\necho $$ > '${pidFile}'\ntrap 'exit 1' INT\n/bin/sleep 3 &\nwait $!\nexit 0\n`
      : `#!/bin/sh\necho $$ > '${pidFile}'\nexec /bin/sleep 5\n`;
  writeFileSync(path.join(sigBin, "initdb"), initdb);
  writeFileSync(path.join(sigBin, "pg_ctl"), `#!/bin/sh\necho "pg_ctl $*" >> '${path.join(sigBin, "calls.log")}'\nexit 0\n`);
  for (const tool of ["initdb", "pg_ctl"]) chmodSync(path.join(sigBin, tool), 0o755);
  const root = path.join(safetyDir, `sig-${mode}-${target}`);
  mkdirSync(root, { recursive: true });
  const child = spawn(process.execPath, [path.join(HERE, "run.mjs"), "--tree", base, "--root", root, "--pg-bin", sigBin], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const exited = new Promise((done) => child.on("exit", (code, signal) => done(code ?? signal)));
  const deadline = Date.now() + 60_000;
  while (!existsSync(pidFile) && child.exitCode === null && Date.now() < deadline) await pause(20);
  let sent = "nothing (initdb never started)";
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    process.kill(target === "group" ? -child.pid : pid, "SIGINT");
    sent = target === "group" ? `SIGINT to run.mjs's process group` : `SIGINT to initdb (pid ${pid}) alone`;
  }
  const code = await Promise.race([exited, pause(60_000).then(() => "timeout")]);
  if (code === "timeout") {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }
  const teardownLine = out.split("\n").find((l) => l.startsWith("teardown: ")) ?? "(no teardown line)";
  const made = readdirSync(root);
  const ok = code === 130 && /^teardown: cluster on port \S+ never started; socket dir (removed|never made); run directory removed$/.test(teardownLine) && made.length === 0;
  return { ok, detail: `${sent}: exit ${code}; ${out.split("\n").filter((l) => /^(SIG|HARNESS ERROR|REFUSED)/.test(l)).join(" / ") || "(no signal or error line)"}; ${teardownLine}; left under its root: ${made.join(", ") || "nothing"}` };
}
const SAFETY = {
  "safety-postmaster-matched-by-the-end-of-its-command": {
    what: "a postmaster is the process whose command ENDS in -D <its data directory>, a space in it included",
    check: () => {
      const dir = "/w/sp ace/run-1/data";
      const ps = [
        `  101 /opt/pg/bin/postgres -D ${dir}`,
        `  102 /opt/pg/bin/postgres -D /w/sp ace/run-1/data-other`,
        `  103 /opt/pg/bin/pg_ctl -D ${dir} -m fast -w stop`,
        `  104 /opt/pg/bin/postgres -D /w/sp`,
        `  105 /Applications/Postgres App/bin/postgres -D /w/sp ace/run-2/data`,
        `  106 postgres: proofread_harness proofread_harness [local] idle`,
      ].join("\n");
      const read = (roots) => postmastersIn(ps, roots).map((p) => `${p.pid} ${p.dataDir}`);
      const wantUnder = [`101 ${dir}`, "102 /w/sp ace/run-1/data-other", "105 /w/sp ace/run-2/data"];
      const wantOn = [`101 ${dir}`];
      const cases = [
        [`/opt/pg/bin/postgres -D ${dir}`, true],
        [`/Applications/Postgres App/bin/postgres -D ${dir}`, true],
        [`/opt/pg/bin/postgres -D /w/sp`, false],
        [`/opt/pg/bin/postgres -D ${dir}-other`, false],
        [`/opt/pg/bin/postgres -D ${dir} -c port=1`, false],
        [`/opt/pg/bin/pg_ctl -D ${dir}`, false],
        ["/opt/homebrew/opt/postgresql@16/bin/postgres -D /opt/homebrew/var/postgresql@16", false],
      ];
      const wrong = cases.filter(([c, want]) => isPostmasterOn(c, dir) !== want).map(([c, want]) => `isPostmasterOn ${want ? "missed" : "took"} ${JSON.stringify(c)}`);
      const under = read(["/w/sp ace"]);
      const on = read([dir]);
      const ok = JSON.stringify(under) === JSON.stringify(wantUnder) && JSON.stringify(on) === JSON.stringify(wantOn) && wrong.length === 0;
      return { ok, detail: `under "/w/sp ace": ${JSON.stringify(under)}, want ${JSON.stringify(wantUnder)}; on ${dir}: ${JSON.stringify(on)}, want ${JSON.stringify(wantOn)}; ${wrong.join("; ") || "isPostmasterOn right"}` };
    },
  },
  "safety-pid-file-naming-a-sleep": {
    what: "a postmaster.pid naming a live process that is not a postgres (a sleep) is not confirmed stopped and never reaches pg_ctl",
    check: () => {
      freshFakeBin();
      const dataDir = path.join(safetyDir, "names-a-sleep", "data");
      mkdirSync(dataDir, { recursive: true });
      const sleeper = spawn("/bin/sleep", ["120"], { stdio: "ignore" });
      try {
        writeFileSync(path.join(dataDir, "postmaster.pid"), `${sleeper.pid}\n${dataDir}\n`);
        const r = stopCluster({ pgBin: fakeBin, dataDir, env, waitMs: 1000 });
        const calls = fakeCallsSoFar();
        const ok = r.stopped === false && r.unmatched?.pid === sleeper.pid && calls === "";
        return { ok, detail: `stopCluster -> stopped ${r.stopped}, unmatched ${JSON.stringify(r.unmatched ?? null)}; pg_ctl calls: ${calls || "none"}` };
      } finally {
        sleeper.kill();
        rmSync(path.dirname(dataDir), { recursive: true, force: true });
      }
    },
  },
  "safety-pid-file-naming-a-postgres-elsewhere": {
    what: "a postmaster.pid naming a live postgres on ANOTHER data directory is not confirmed stopped and never reaches pg_ctl",
    check: () => {
      const c = spacedCluster();
      freshFakeBin();
      const dataDir = path.join(safetyDir, "names-a-postgres-elsewhere", "data");
      mkdirSync(dataDir, { recursive: true });
      try {
        writeFileSync(path.join(dataDir, "postmaster.pid"), `${c.pid}\n${dataDir}\n`);
        const r = stopCluster({ pgBin: fakeBin, dataDir, env, waitMs: 1000 });
        const calls = fakeCallsSoFar();
        const still = commandOf(c.pid);
        const ok = r.stopped === false && r.unmatched?.pid === c.pid && calls === "" && still !== null && isPostmasterOn(still, c.dataDir);
        return { ok, detail: `stopCluster -> stopped ${r.stopped}, unmatched ${JSON.stringify(r.unmatched ?? null)}; pg_ctl calls: ${calls || "none"}; the other postgres ${still === null ? "IS GONE" : "still runs"}` };
      } finally {
        rmSync(path.dirname(dataDir), { recursive: true, force: true });
      }
    },
  },
  "safety-live-cluster-with-a-space-is-stopped": {
    what: "a live cluster whose data directory has a space is stopped, and ps confirms its postmaster gone",
    check: () => {
      const c = spacedCluster();
      const before = commandOf(c.pid);
      const r = stopCluster({ pgBin: c.bin, dataDir: c.dataDir, env });
      const after = commandOf(c.pid);
      const ok = before !== null && r.stopped === true && r.pids.includes(c.pid) && after === null && existsSync(path.join(c.dataDir, "PG_VERSION"));
      if (r.stopped && after === null) {
        rmSync(path.dirname(c.dataDir), { recursive: true, force: true });
        rmSync(c.sock, { recursive: true, force: true });
      }
      return { ok, detail: `postmaster ${c.pid} on ${JSON.stringify(c.dataDir)} ${before === null ? "was not running" : "was running"}; stopCluster -> stopped ${r.stopped}, pids ${JSON.stringify(r.pids)}; afterwards ${after === null ? "gone" : `STILL RUNNING: ${after}`}` };
    },
  },
  "safety-sigint-to-the-run-while-initdb-traps-it-exits-130": {
    what: "SIGINT to run.mjs's process group while a setup step (an initdb that traps it and exits 1) runs: exit 130, torn down",
    check: (base) => runSignalled(base, "trap", "group"),
  },
  "safety-a-setup-step-killed-by-sigint-exits-130": {
    what: "a setup step (initdb) stopped by SIGINT sent to it alone: exit 130, torn down",
    check: (base) => runSignalled(base, "exec", "initdb"),
  },
  "safety-run-refuses-a-root-with-whitespace": {
    what: "run.mjs refuses a --root with whitespace in it (exit 2, nothing made)",
    check: (base) => {
      const root = path.join(safetyDir, "sp ace root");
      mkdirSync(root, { recursive: true });
      const r = runRefusal(base, root, os.tmpdir());
      const made = readdirSync(root);
      const ok = r.status === 2 && /whitespace/.test(r.refusal) && r.refusal.includes(root) && made.length === 0 && !/^cluster: /m.test(r.out);
      return { ok, detail: `exit ${r.status}; ${r.refusal || r.out.split("\n").filter((l) => /^\d+\/\d+ passed|^teardown: |^HARNESS ERROR/.test(l)).join(" / ") || r.out.slice(-300)}; made under it: ${made.join(", ") || "nothing"}` };
    },
  },
  "safety-run-refuses-a-tmpdir-with-whitespace": {
    what: "run.mjs refuses a TMPDIR with whitespace in it (exit 2, nothing made)",
    check: (base) => {
      const root = path.join(safetyDir, "plain-root");
      const tmp = path.join(safetyDir, "t mp");
      mkdirSync(root, { recursive: true });
      mkdirSync(tmp, { recursive: true });
      const r = runRefusal(base, root, tmp);
      const made = [...readdirSync(root), ...readdirSync(tmp)];
      const ok = r.status === 2 && /TMPDIR/.test(r.refusal) && /whitespace/.test(r.refusal) && made.length === 0 && !/^cluster: /m.test(r.out);
      return { ok, detail: `exit ${r.status}; ${r.refusal || r.out.split("\n").filter((l) => /^\d+\/\d+ passed|^teardown: |^HARNESS ERROR/.test(l)).join(" / ") || r.out.slice(-300)}; made: ${made.join(", ") || "nothing"}` };
    },
  },
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

  for (const [name, { what, check }] of Object.entries(SAFETY)) {
    if (only.length && !only.includes(name)) continue;
    let verdict;
    try {
      verdict = await check(base);
    } catch (err) {
      verdict = { ok: false, detail: `threw: ${err instanceof Error ? err.message : String(err)}` };
    }
    note(`${name}: ${what}`, verdict.ok, verdict.ok ? "" : verdict.detail);
  }

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
    left = [...stopClustersUnder(work), ...livePidFilesUnder(work)];
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
