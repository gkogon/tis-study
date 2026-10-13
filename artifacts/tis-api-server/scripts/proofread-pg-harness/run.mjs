#!/usr/bin/env node
/**
 * Proofread Postgres harness: the proofread routes, store, runner and limiters, run for real against a
 * Postgres this script creates, uses and deletes. Opt-in. NOT a `check:*` script and not registered in
 * package.json: CI has no Postgres yet, and the registered guards must run anywhere.
 *
 * Run (from the repo root; needs the PostgreSQL server binaries — initdb and pg_ctl, 13 or newer):
 *
 *   node artifacts/tis-api-server/scripts/proofread-pg-harness/run.mjs
 *     [--tree <dir>]    the source tree to bundle (default: this checkout). A copy with a deliberate break
 *                       in it is how the harness is shown to see a failure.
 *     [--root <dir>]    where the run directory (cluster data, logs, bundles) is created (default: os.tmpdir()).
 *                       A --root, or a temp directory (TMPDIR), with whitespace in it is refused (exit 2)
 *     [--pg-bin <dir>]  where initdb and pg_ctl are (default: PATH, then the usual Homebrew/Postgres.app places)
 *     [--keep]          leave the run directory (the cluster is still stopped)
 *
 * Exit 0: every assertion passed. 1: an assertion failed. 2: refused, could not set up (nothing was asserted), or
 * could not confirm the cluster stopped. 130: stopped by SIGINT or SIGTERM (after tearing down).
 *
 * What it does, in order:
 *   1. creates the run directory under --root, and only then picks a free port and a SHORT socket directory (macOS
 *      caps a unix socket path at 103 bytes); the cluster listens on that socket only, never on TCP. Everything from
 *      here on is inside the teardown's scope: a setup step that fails (a bad --root, no free port, no short enough
 *      temp directory) exits 2 and leaves nothing behind;
 *   2. bundles, with esbuild, the server (server-entry.mjs: the real router behind a stub session), the schema
 *      (lib/db/src/schema) and the read contract (lib/tis-api-zod/src/proofread.ts) from the tree under test.
 *      `@workspace/db` is replaced by db-shim.mjs, which holds the throwaway cluster's address, written in at
 *      build time. The run is REFUSED, before any cluster exists, if a bundle contains the module
 *      lib/db/src/index.ts (it builds its pool from DATABASE_URL) or the text DATABASE_URL anywhere. That is a match
 *      on what was bundled, not a proof that no code path can open a connection of its own: a `new pg.Client()` or
 *      `new pg.Pool()` with no address is not refused. Such a default client takes its address from libpq's
 *      variables, so the server's environment pins PGHOST (this run's socket directory), PGPORT, PGUSER and
 *      PGDATABASE to the throwaway cluster and carries no other PG* variable (no PGSERVICE, PGSERVICEFILE,
 *      PGPASSFILE, PGHOSTADDR or PGOPTIONS): a default client reaches this run's cluster, never localhost:5432. The
 *      server reports what a default client there would dial before it listens, and the run is REFUSED if that is
 *      not this run's socket, port, user and database. This script never reads DATABASE_URL, and every child
 *      process gets an environment built from a short allow-list, never a copy of this one;
 *   3. initdb into the run directory, pg_ctl start, create the database, and confirm that the server it is
 *      talking to reports the run directory as its data_directory before it writes anything;
 *   4. applies the schema as drizzle-kit would push it (drizzle-kit/api, generated from the same schema files);
 *   5. starts the server and runs driver.mjs: two firms, a second member of one, users for the rate limits,
 *      firms created by first requests the repo's way, assertions over HTTP and SQL;
 *   6. tears down, after a pass, a failed assertion, an error, a refusal, or SIGINT/SIGTERM: stops every server
 *      process it started (one stopped by a signal counts as stopped; each wait is bounded), ends its connections,
 *      stops the cluster and confirms with `ps` that its postmaster is gone (postmaster.mjs), and only then deletes
 *      the run directory and the socket directory. A cluster that cannot be confirmed stopped keeps its data
 *      directory, so `pg_ctl -D` can still stop it, and the run exits 2. A postmaster.pid that names a live process
 *      ps does not show as a postgres on this run's data directory is never signalled (pg_ctl is not run on it) and
 *      is not confirmed stopped: exit 2, the data directory kept, and the message says not to run pg_ctl -D on it.
 *      Teardown runs once, whichever path reaches it first.
 *
 * What it proves (driver.mjs names each assertion): firm scoping of every route (foreign and unknown ids answer
 * the same 404, nothing is enqueued or written under another firm); the disposition chain in order (401, 400,
 * PE-only 403, 404 for a malformed id, a foreign or unknown project/run/finding and an admin-audience finding,
 * 422 for a decision the finding's type is not offered, 409 for a decision on a run that is not the project's
 * newest finished one, 'rules_ready' or 'ready'); an uppercase spelling of the newest run's id is accepted; the
 * actor is the session user; the log is append-only (before and after every POST and claim the driver makes,
 * every disposition row already seen hashes the same, row text and xmin, so a rewrite of an earlier decision,
 * even to identical values, or a delete is seen); GET withholds admin-audience findings and answers only how many
 * (`withheld`), and a real DEFECT raised by the clause pass is logged by the runner with the run, project and
 * clause alone; a re-run under a different deploy (engine stamp) and the same rules version carries the latest
 * decision forward with the date it was made, and a different rules version carries nothing, and GET says which
 * (`rulesChanged`); a run is stamped with the rules version, engine stamp and protocol version of the deploy that
 * ran its clauses, not the one that queued it, and the carry compares run-time values; a re-claimed run that
 * already holds findings written under other rules fails `rules_changed_mid_run` and the next run starts clean; a
 * decision on a 'ready' run carries into the next revision; claimAndRunOne, and every request the driver makes,
 * leaves every tis_projects row's text and xmin unchanged (the hash is shown to change on a value-identical
 * UPDATE); the run, decision and read limiters each answer 429 past their own limit with draft-7 headers naming
 * it (RateLimit-Policy and RateLimit, no X-RateLimit-*), are keyed per user (another user at the same address is
 * still served) and do not share a budget; every GET answer parses under the read contract.
 *
 * That a green run means something is shown by teeth.mjs beside this file: it breaks one production line per
 * family in a copy of HEAD (never in this checkout) and requires the named assertions to go red, a bundle that
 * could read the environment's database to be refused, and every run to have torn down.
 *
 * Only SIGKILL skips the teardown. The cluster then keeps running: the run directory is printed at the start, and
 * `pg_ctl -D <run dir>/data stop` stops it.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { drive } from "./driver.mjs";
import { findPgBin, postmasterPidOf, postmastersUnder, stopCluster } from "./postmaster.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The checkout this script lives in. Third-party packages always resolve from here; source comes from --tree. */
const REPO = path.resolve(HERE, "../../../..");
const SERVER_PKG = path.join(REPO, "artifacts/tis-api-server");

// ---- arguments -------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
if (argv.includes("--help")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
  process.exit(0);
}
const TREE = path.resolve(opt("--tree") ?? REPO);
const ROOT_BASE = path.resolve(opt("--root") ?? os.tmpdir());
const KEEP = argv.includes("--keep");

const refuse = (why) => {
  console.error(`REFUSED: ${why}`);
  return 2;
};

// ---- the pieces a run needs ------------------------------------------------------------------------------
/**
 * The directories a run's paths are made under — --root (the data directory's parent) and the temp directory (the
 * socket directory's, and the default root) — as given and as their real paths, each with whitespace in it. A run
 * there is refused: postmaster.mjs matches a postmaster by the end of its `ps` command line and can read a space,
 * but nothing that names this run's directories in a log, a hint or postgresql.conf is held to that.
 */
function whitespaceIn() {
  const bad = [];
  for (const [label, dir] of [
    ["--root", ROOT_BASE],
    ["the temp directory (TMPDIR)", path.resolve(os.tmpdir())],
  ]) {
    let real = null;
    try {
      real = realpathSync(dir);
    } catch {}
    for (const p of new Set([dir, real].filter(Boolean))) if (/\s/.test(p)) bad.push(`${label} ${JSON.stringify(p)}`);
  }
  return bad;
}

/** The only environment a child process gets: enough to find binaries and agree on a locale and a clock. */
const childEnv = (extra = {}) => ({ PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", ...extra });

/**
 * The server's environment: the allow-list, plus libpq's address variables pinned to this run's cluster, so a pg
 * client built with no address (`new pg.Client()`) reaches the throwaway cluster and nothing else — never the
 * default localhost:5432. Every other PG* variable is removed (PGSERVICE, PGSERVICEFILE, PGPASSFILE, PGHOSTADDR,
 * PGOPTIONS and the rest): the allow-list carries none today, and this keeps it so if the list ever grows.
 */
const SERVER_PG_ENV = ["PGHOST", "PGPORT", "PGUSER", "PGDATABASE"];
const serverEnv = (connection, extra) => {
  const env = childEnv({ ...extra, PGHOST: connection.host, PGPORT: String(connection.port), PGUSER: connection.user, PGDATABASE: connection.database });
  for (const k of Object.keys(env)) if (k.startsWith("PG") && !SERVER_PG_ENV.includes(k)) delete env[k];
  return env;
};

const portIsFree = (port) =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
  });

/** A unix socket path is capped at 103 bytes on macOS; the socket directory goes wherever it fits. */
function makeSocketDir(port) {
  const socketName = `.s.PGSQL.${port}`;
  for (const base of [os.tmpdir(), "/tmp"]) {
    const probe = path.join(base, "pgh-XXXXXX", socketName);
    if (Buffer.byteLength(probe) <= 100 && existsSync(base)) return mkdtempSync(path.join(base, "pgh-"));
  }
  throw new Error("no temp directory short enough for a unix socket path");
}

async function pickPort() {
  for (let i = 0; i < 40; i++) {
    const port = 54400 + Math.floor(Math.random() * 600);
    if (await portIsFree(port)) return port;
  }
  throw new Error("no free port in 54400-54999");
}

const resolveTs = (p) => (existsSync(`${p}.ts`) ? `${p}.ts` : existsSync(path.join(p, "index.ts")) ? path.join(p, "index.ts") : p);

/** Workspace packages come from the tree under test; `@workspace/db` is the shim. Anything else is an error. */
const workspacePlugin = {
  name: "proofread-pg-harness",
  setup(b) {
    b.onResolve({ filter: /^harness-tree:/ }, (a) => ({
      path: resolveTs(path.join(TREE, "artifacts/tis-api-server/src", a.path.slice("harness-tree:".length))),
    }));
    b.onResolve({ filter: /^@workspace\// }, (a) => {
      const map = {
        "@workspace/db": path.join(HERE, "db-shim.mjs"),
        "@workspace/db/schema": path.join(TREE, "lib/db/src/schema/index.ts"),
        "@workspace/tis-api-zod": path.join(TREE, "lib/tis-api-zod/src/index.ts"),
        "@workspace/tis-engine-core": path.join(TREE, "lib/tis-engine-core/src/index.ts"),
      };
      if (map[a.path]) return { path: map[a.path] };
      return { errors: [{ text: `proofread-pg-harness does not map the workspace import ${a.path}; add it to run.mjs` }] };
    });
  },
};

async function bundle(esbuild, label, entry, outfile, connection) {
  const result = await esbuild.build({
    entryPoints: [entry],
    outfile,
    absWorkingDir: REPO,
    bundle: true,
    platform: "node",
    format: "esm",
    logLevel: "error",
    metafile: true,
    nodePaths: ["artifacts/tis-api-server/node_modules", "lib/db/node_modules", "lib/tis-api-zod/node_modules", "node_modules"].map((p) =>
      path.join(REPO, p),
    ),
    external: ["pg-native", "*.node"],
    define: { __PROOFREAD_PG_HARNESS_CONNECTION__: JSON.stringify(JSON.stringify(connection)) },
    plugins: [workspacePlugin],
    banner: { js: "import { createRequire as __harnessRequire } from 'node:module'; const require = __harnessRequire(import.meta.url);" },
  });
  const inputs = Object.keys(result.metafile.inputs).map((p) => path.resolve(REPO, p));
  // Refusals, checked on what was actually bundled. Either one means a code path in this bundle could take
  // its database from the environment instead of from the shim.
  const realDbIndex = path.join(TREE, "lib/db/src/index.ts");
  if (inputs.includes(realDbIndex) || inputs.includes(path.join(REPO, "lib/db/src/index.ts"))) {
    return { refused: `the ${label} bundle contains lib/db/src/index.ts, which builds its pool from the environment` };
  }
  if (readFileSync(outfile, "utf8").includes("DATABASE_URL")) {
    const from = inputs.filter((f) => existsSync(f) && statSync(f).isFile() && readFileSync(f, "utf8").includes("DATABASE_URL"));
    return { refused: `the ${label} bundle contains the text DATABASE_URL (inputs whose text names it, comments included: ${from.join(", ") || "none found"})` };
  }
  // Source comes from the tree under test and nowhere else: a run against a copy must not quietly bundle the
  // live checkout's code, or a break in the copy would prove nothing.
  if (TREE !== REPO) {
    const live = inputs.filter((f) => !f.includes(`${path.sep}node_modules${path.sep}`) && !f.startsWith(HERE) && !f.startsWith(TREE + path.sep));
    if (live.length) return { refused: `the ${label} bundle took source from outside --tree: ${live.slice(0, 5).join(", ")}` };
  }
  return { inputs };
}

/**
 * Run a setup step to completion. A step stopped by SIGINT or SIGTERM was stopped by a signal sent to this run's
 * process group (Ctrl-C reaches initdb and this script alike): the error carries that signal, and main treats the run
 * as signalled (exit 130), not as a setup failure.
 */
const run = (cmd, args, log) => {
  const r = spawnSync(cmd, args, { env: childEnv(), encoding: "utf8", timeout: 120_000 });
  appendFileSync(log, `$ ${path.basename(cmd)} ${args.join(" ")}\n${r.stdout ?? ""}${r.stderr ?? ""}\n`);
  if (r.status !== 0) {
    const err = new Error(`${path.basename(cmd)} exited ${r.status ?? r.signal}; see ${log}`);
    if (r.signal === "SIGINT" || r.signal === "SIGTERM") err.signal = r.signal;
    throw err;
  }
};

// ---- main ------------------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bounded = (promise, ms) => Promise.race([promise, sleep(ms)]);

async function main() {
  const spaced = whitespaceIn();
  if (spaced.length) return refuse(`${spaced.join(" and ")} contains whitespace; pass a --root (and a TMPDIR) without any. Nothing was started.`);
  const pgBin = findPgBin(opt("--pg-bin"));
  if (!pgBin) {
    const where = opt("--pg-bin") ? `in ${opt("--pg-bin")}` : "on PATH or in the usual places";
    return refuse(`PostgreSQL server binaries (initdb, pg_ctl) were not found ${where}; install PostgreSQL 13+ or pass --pg-bin <dir>. Nothing was started.`);
  }
  for (const rel of ["artifacts/tis-api-server/src/routes/proofread.ts", "lib/db/src/schema/index.ts", "lib/tis-api-zod/src/proofread.ts"]) {
    if (!existsSync(path.join(TREE, rel))) return refuse(`--tree ${TREE} has no ${rel}`);
  }

  // The run directory first: if it cannot be made, nothing else has been.
  let rootDir;
  try {
    rootDir = mkdtempSync(path.join(ROOT_BASE, "proofread-pg-harness-"));
  } catch (err) {
    return refuse(`could not create the run directory under ${ROOT_BASE}: ${err instanceof Error ? err.message : String(err)}. Nothing was started.`);
  }
  const dataDir = path.join(rootDir, "data");
  const log = path.join(rootDir, "harness.log");
  const USER = "proofread_harness";
  const DATABASE = "proofread_harness";
  console.log(`run directory ${rootDir}`);

  const pg = createRequire(path.join(REPO, "lib/db/package.json"))("pg");
  let port = null;
  let socketDir = null;
  /** Every server process this run started and that has not exited yet (an 'exit' listener added at spawn removes it). */
  const children = new Set();
  let server = null;
  let clusterStarted = false;
  let clusterEverStarted = false;
  const pools = [];
  let exitCode = 2;

  /** Resolves once `child` has exited: at once if it already has (an exit code OR a signal), else SIGTERM, then SIGKILL. */
  const stopChild = (child) =>
    new Promise((done) => {
      if (!children.has(child) || child.exitCode !== null || child.signalCode !== null) return done();
      const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
      // Bounded whatever happens: a promise nothing settles would let the event loop drain mid-teardown.
      const giveUp = setTimeout(finish, 10_000);
      function finish() {
        clearTimeout(kill);
        clearTimeout(giveUp);
        done();
      }
      child.once("exit", finish);
      child.kill("SIGTERM");
    });

  let tearing = null;
  /** Set when the teardown starts: from then on no server is started, so the set of children it stops is all of them. */
  let closing = false;
  /** Runs once; every caller (the finally below, a signal) waits on the same teardown. */
  const teardown = () =>
    (tearing ??= (async () => {
      closing = true;
      server = null;
      await Promise.all([...children].map(stopChild));
      for (const p of pools) await bounded(p.end().catch(() => undefined), 5000);
      // Also when pg_ctl start failed part-way: a postmaster.pid, or a postgres on this data dir, means something may
      // be running on it. The data directory is removed only once stopCluster confirms no postmaster on it — and a
      // postmaster.pid naming a live process that is not a postgres on it is never confirmed (postmaster.mjs).
      let clusterLeft = [];
      let unmatched = null;
      let unconfirmed = false;
      try {
        if (clusterStarted || existsSync(path.join(dataDir, "postmaster.pid")) || postmastersUnder(dataDir).length > 0) {
          const stop = stopCluster({ pgBin, dataDir, env: childEnv() });
          clusterEverStarted = true;
          clusterLeft = stop.left;
          unmatched = stop.unmatched ?? null;
          clusterStarted = !stop.stopped;
        }
      } catch (err) {
        // Not confirmed stopped is treated as running: the data directory stays.
        console.error(`could not confirm the cluster stopped: ${err instanceof Error ? err.message : String(err)}`);
        clusterEverStarted = true;
        clusterStarted = true;
        unconfirmed = true;
      }
      const toDelete = `${rootDir}${socketDir ? ` and ${socketDir}` : ""}`;
      if (unmatched) {
        // pg_ctl signals the pid postmaster.pid names, and that pid is not this run's postmaster: never advise it.
        console.error(
          `the cluster is NOT confirmed stopped: ${path.join(dataDir, "postmaster.pid")} names pid ${unmatched.pid}, which ps shows running ${JSON.stringify(unmatched.command)} — not a postgres on this data directory, so nothing was signalled. Do not run pg_ctl -D on it (pg_ctl would signal pid ${unmatched.pid}). Look in ps for a postgres -D ${dataDir}; once none runs, delete ${toDelete}`,
        );
      } else if (unconfirmed) {
        console.error(
          `the cluster is NOT confirmed stopped. Before any pg_ctl -D ${dataDir} stop -m immediate, check with ps that the pid in its postmaster.pid is a postgres -D ${dataDir} (pg_ctl signals that pid); once none runs, delete ${toDelete}`,
        );
      } else if (clusterStarted) {
        console.error(`the cluster did not stop (still running: ${clusterLeft.map((p) => p.pid).join(", ")}): pg_ctl -D ${dataDir} stop -m immediate, then delete ${toDelete}`);
      } else {
        if (socketDir) rmSync(socketDir, { recursive: true, force: true });
        if (!KEEP) rmSync(rootDir, { recursive: true, force: true });
      }
      console.log(
        `teardown: cluster on port ${port ?? "(none picked)"} ${clusterStarted ? (unmatched || unconfirmed ? "NOT CONFIRMED STOPPED" : "STILL RUNNING") : clusterEverStarted ? "stopped" : "never started"}; ` +
          `socket dir ${socketDir === null ? "never made" : existsSync(socketDir) ? "STILL PRESENT" : "removed"}; ` +
          `run directory ${KEEP && existsSync(rootDir) ? `kept at ${rootDir}` : existsSync(rootDir) ? "STILL PRESENT" : "removed"}`,
      );
      return !clusterStarted;
    })());
  let signalled = null;
  const onSignal = (sig) => {
    if (signalled) {
      console.error(`${sig}: already tearing down`);
      return;
    }
    signalled = sig;
    console.error(`${sig}: tearing down`);
    teardown().finally(() => process.exit(130));
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  // Once the teardown has started, setup makes nothing more: what it has not seen, it cannot remove or stop.
  const notClosing = () => {
    if (closing) throw new Error("tearing down: setup stops here");
  };
  try {
    port = await pickPort();
    notClosing();
    socketDir = makeSocketDir(port);
    // Every connection, the server's and this script's, is this object and nothing else.
    const connection = { host: socketDir, port, user: USER, database: DATABASE, ssl: false, max: 10 };
    console.log(`cluster: port ${port}, unix socket only, in ${socketDir}; tree under test ${TREE}`);

    // ---- bundles first: a refusal leaves no cluster behind --------------------------------------------
    const esbuild = createRequire(path.join(SERVER_PKG, "package.json"))("esbuild");
    const serverOut = path.join(rootDir, "server.mjs");
    const builds = [
      ["server", path.join(HERE, "server-entry.mjs"), serverOut],
      ["schema", path.join(TREE, "lib/db/src/schema/index.ts"), path.join(rootDir, "schema.mjs")],
      ["contract", path.join(TREE, "lib/tis-api-zod/src/proofread.ts"), path.join(rootDir, "contract.mjs")],
    ];
    let serverInputs = [];
    for (const [label, entry, out] of builds) {
      const b = await bundle(esbuild, label, entry, out, connection);
      if (b.refused) return (exitCode = refuse(b.refused));
      if (label === "server") serverInputs = b.inputs;
    }
    const mustBundle = ["routes/proofread.ts", "lib/proofread-store.ts", "lib/proofread-run.ts", "lib/tis-projects.ts", "lib/firms.ts", "lib/security.ts"];
    const missing = mustBundle.filter((rel) => !serverInputs.includes(path.join(TREE, "artifacts/tis-api-server/src", rel)));
    if (missing.length) return (exitCode = refuse(`the server bundle does not hold the tree's ${missing.join(", ")}`));
    console.log(`bundled ${serverInputs.filter((f) => !f.includes("node_modules")).length} source files from the tree`);

    // ---- the throwaway cluster ------------------------------------------------------------------------
    notClosing();
    run(path.join(pgBin, "initdb"), ["-D", dataDir, "-U", USER, "--auth=trust", "--no-locale", "-E", "UTF8"], log);
    appendFileSync(
      path.join(dataDir, "postgresql.conf"),
      [
        "",
        "# proofread-pg-harness: socket only, in a short directory; durability off (the cluster is deleted after the run)",
        "listen_addresses = ''",
        `port = ${port}`,
        `unix_socket_directories = '${socketDir}'`,
        "fsync = off",
        "synchronous_commit = off",
        "full_page_writes = off",
        "max_connections = 60",
        "",
      ].join("\n"),
    );
    notClosing();
    clusterStarted = true; // set before the start: a start that fails part-way may still leave a postmaster
    run(path.join(pgBin, "pg_ctl"), ["-D", dataDir, "-l", path.join(rootDir, "postgres.log"), "-w", "-t", "60", "start"], log);
    clusterEverStarted = true;
    console.log(`cluster started: postmaster pid ${postmasterPidOf(dataDir)}`);
    const admin = new pg.Pool({ ...connection, database: "postgres", max: 1 });
    pools.push(admin);
    // Before anything is written: the server on the other end of this socket is the one this run created.
    const [{ data_directory: served }] = (await admin.query("select current_setting('data_directory') as data_directory")).rows;
    if (realpathSync(served) !== realpathSync(dataDir)) return (exitCode = refuse(`the server on ${socketDir} serves ${served}, not this run's ${dataDir}`));
    await admin.query(`create database ${DATABASE}`);
    notClosing();
    const db = new pg.Pool(connection);
    pools.push(db);
    const q = async (sql, params = []) => (await db.query(sql, params)).rows;

    // ---- schema: what drizzle-kit push would create, from the tree's schema files --------------------
    const kit = createRequire(path.join(REPO, "lib/db/package.json"))("drizzle-kit/api");
    const schema = await import(pathToFileURL(path.join(rootDir, "schema.mjs")).href);
    const ddl = await kit.generateMigration(kit.generateDrizzleJson({}), kit.generateDrizzleJson(schema));
    const client = await db.connect();
    try {
      await client.query("begin");
      for (const stmt of ddl) await client.query(stmt);
      await client.query("commit");
    } finally {
      client.release();
    }
    console.log(`schema applied: ${ddl.length} statements`);

    // ---- the server, restartable under another deploy's commit ----------------------------------------
    const allLines = [];
    const expectDefault = { host: socketDir, port, user: USER, database: DATABASE };
    const startServer = (sha) =>
      new Promise((resolve, reject) => {
        // A restart that was waiting on the old server when a signal started the teardown must not leave a new one
        // behind it.
        if (closing) return reject(new Error("tearing down: no server is started"));
        const child = spawn(process.execPath, [serverOut], {
          cwd: TREE,
          env: serverEnv(connection, { NODE_ENV: "production", LOG_LEVEL: "warn", GIT_SHA: sha }),
          stdio: ["ignore", "pipe", "pipe"],
        });
        children.add(child);
        let buf = "";
        let ready = false;
        let defaultClient = null;
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("server did not listen within 30 s"));
        }, 30_000);
        // First, so the set is right before any other listener runs: a child that has exited (by code or by signal) is
        // never waited on again.
        child.once("exit", (code, signal) => {
          children.delete(child);
          clearTimeout(timer);
          if (!ready) reject(new Error(`server exited ${code ?? signal} before listening:\n${allLines.slice(-20).join("\n")}`));
        });
        const onData = (d) => {
          buf += d;
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            allLines.push(line);
            const dc = /^DEFAULT_PG_CLIENT (.*)$/.exec(line);
            if (dc) defaultClient = JSON.parse(dc[1]);
            const m = /^LISTENING (\d+)$/.exec(line);
            if (m && !ready) {
              ready = true;
              clearTimeout(timer);
              const stop = () => stopChild(child);
              // What a pg client built with no address would dial inside this server: this run's cluster, or no run.
              const wrong = Object.keys(expectDefault).filter((k) => String(defaultClient?.[k]) !== String(expectDefault[k]));
              if (wrong.length) {
                const err = new Error(
                  `a default-config pg client in the server would dial ${JSON.stringify(defaultClient)}, not this run's cluster ${JSON.stringify(expectDefault)}`,
                );
                err.refused = true;
                reject(err);
                return;
              }
              resolve({ port: Number(m[1]), stop });
            }
          }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
      });

    server = await startServer(SHA_A);
    const call = async (method, p, { user, body } = {}) => {
      const res = await fetch(`http://127.0.0.1:${server.port}/tis-api${p}`, {
        method,
        headers: { "content-type": "application/json", ...(user ? { "x-user": user } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json = null;
      try {
        json = await res.json();
      } catch {}
      return { status: res.status, body: json, headers: res.headers };
    };
    const claimOne = async () => (await fetch(`http://127.0.0.1:${server.port}/__harness/claim-one`, { method: "POST" })).json();
    // No handle to the old server survives: if the new one never listens, `server` is null and the old child is gone.
    const restart = async (sha) => {
      const old = server;
      server = null;
      await old.stop();
      server = await startServer(sha);
    };
    const contract = await import(pathToFileURL(path.join(rootDir, "contract.mjs")).href);
    const fixture = JSON.parse(readFileSync(path.join(TREE, "artifacts/atlanta-tis/scripts/fixtures/scenario-base.json"), "utf8"));

    const results = await drive({ call, q, claimOne, restart, contract, fixture, serverLines: () => allLines, SHA_A, SHA_B });
    const failed = results.filter((r) => !r.ok);
    const routeErrors = allLines.filter((l) => l.includes("harnessRouteError"));
    if (routeErrors.length) console.log(`server route errors (${routeErrors.length}):\n${routeErrors.slice(0, 5).join("\n")}`);
    console.log(
      `\n${results.length - failed.length}/${results.length} passed${failed.length ? `; FAILED:\n  ${failed.map((f) => f.name).join("\n  ")}` : ""}`,
    );
    exitCode = failed.length ? 1 : 0;
  } catch (err) {
    // spawnSync blocks the event loop, so a signal that reached this process while a setup step ran has not been
    // handed to onSignal yet (a step that traps it — initdb does — exits 1, not by the signal). Two turns of the loop
    // deliver it before the error is read as a failure: this code may be running inside the poll phase, after this
    // turn's poll has already looked at the signal pipe, so the first setImmediate can fire before it is read.
    for (let turn = 0; turn < 2; turn++) await new Promise((r) => setImmediate(r));
    if (signalled || err?.signal) {
      signalled ??= err.signal;
      console.error(`${signalled}: setup stopped (${err instanceof Error ? err.message : String(err)}); tearing down`);
    } else if (err?.refused) {
      exitCode = refuse(err.message);
    } else {
      console.error("HARNESS ERROR", err);
      exitCode = 2;
    }
  } finally {
    // A cluster that could not be confirmed stopped is a run that did not clean up: never 0 or 1.
    if (!(await teardown())) exitCode = 2;
  }
  return signalled ? 130 : exitCode;
}

/** Two deploys: the engine stamp ends in the commit, so a restart under SHA_B is "Run again after a deploy". */
const SHA_A = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const SHA_B = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";

process.exit(await main());
