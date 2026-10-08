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
 *     [--root <dir>]    where the run directory (cluster data, logs, bundles) is created (default: os.tmpdir())
 *     [--pg-bin <dir>]  where initdb and pg_ctl are (default: PATH, then the usual Homebrew/Postgres.app places)
 *     [--keep]          leave the run directory (the cluster is still stopped)
 *
 * Exit 0: every assertion passed. 1: an assertion failed. 2: refused or could not set up (nothing was asserted).
 *
 * What it does, in order:
 *   1. picks a free port and a SHORT socket directory (macOS caps a unix socket path at 103 bytes); the cluster
 *      listens on that socket only, never on TCP;
 *   2. bundles, with esbuild, the server (server-entry.mjs: the real router behind a stub session), the schema
 *      (lib/db/src/schema) and the read contract (lib/tis-api-zod/src/proofread.ts) from the tree under test.
 *      `@workspace/db` is replaced by db-shim.mjs, which holds the throwaway cluster's address, written in at
 *      build time. The run is REFUSED, before any cluster exists, if a bundle contains lib/db/src/index.ts or
 *      the text DATABASE_URL anywhere — that is, if any code path in it could reach for the environment's
 *      database. This script never reads that variable, and every child process gets an environment built
 *      from a short allow-list, never a copy of this one;
 *   3. initdb into the run directory, pg_ctl start, create the database, and confirm that the server it is
 *      talking to reports the run directory as its data_directory before it writes anything;
 *   4. applies the schema as drizzle-kit would push it (drizzle-kit/api, generated from the same schema files);
 *   5. starts the server and runs driver.mjs: two firms, a second member of one, users for the rate limits,
 *      firms created by first requests the repo's way, assertions over HTTP and SQL;
 *   6. stops the server and the cluster and deletes the run directory and the socket directory, whatever happened.
 *
 * What it proves (driver.mjs names each assertion): firm scoping of every route (foreign and unknown ids answer
 * the same 404, nothing is enqueued or written under another firm); the disposition chain in order (401, 400,
 * PE-only 403, 404 for a malformed id, a foreign or unknown project/run/finding and an admin-audience finding,
 * 422 for a decision the finding's type is not offered, 409 for a decision on a run that is not the project's
 * newest finished one); the actor is the session user; the log is append-only; GET withholds admin-audience
 * findings and answers only how many (`withheld`), and a real DEFECT raised by the clause pass is logged by the
 * runner with the run, project and clause alone; a re-run under a different deploy (engine stamp) and the same
 * rules version carries the latest decision forward with the date it was made, and a different rules version
 * carries nothing; claimAndRunOne, and every request the driver makes, leaves every tis_projects row's text and
 * xmin unchanged (the hash is shown to change on a value-identical UPDATE); the run, decision and read limiters
 * have separate per-user budgets and draft-7 headers; every GET answer parses under the read contract.
 *
 * That a green run means something is shown by teeth.mjs beside this file: it breaks one production line per
 * family in a copy of HEAD (never in this checkout) and requires the named assertions to go red, and a bundle
 * that could read the environment's database to be refused.
 *
 * If the harness is killed before its cleanup runs, the cluster keeps running: the run directory is printed at
 * the start, and `pg_ctl -D <run dir>/data stop` stops it.
 */
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { drive } from "./driver.mjs";

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
function findPgBin() {
  const given = opt("--pg-bin");
  const candidates = given
    ? [given]
    : [
        ...(process.env.PATH ?? "").split(path.delimiter),
        "/opt/homebrew/opt/postgresql@16/bin",
        "/opt/homebrew/opt/postgresql@17/bin",
        "/usr/local/opt/postgresql@16/bin",
        "/Applications/Postgres.app/Contents/Versions/latest/bin",
        "/usr/lib/postgresql/16/bin",
      ];
  return candidates.find((d) => d && existsSync(path.join(d, "initdb")) && existsSync(path.join(d, "pg_ctl"))) ?? null;
}

/** The only environment a child process gets: enough to find binaries and agree on a locale and a clock. */
const childEnv = (extra = {}) => ({ PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC", ...extra });

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

const run = (cmd, args, log) => {
  const r = spawnSync(cmd, args, { env: childEnv(), encoding: "utf8", timeout: 120_000 });
  appendFileSync(log, `$ ${path.basename(cmd)} ${args.join(" ")}\n${r.stdout ?? ""}${r.stderr ?? ""}\n`);
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} exited ${r.status ?? r.signal}; see ${log}`);
};

// ---- main ------------------------------------------------------------------------------------------------
async function main() {
  const pgBin = findPgBin();
  if (!pgBin) {
    const where = opt("--pg-bin") ? `in ${opt("--pg-bin")}` : "on PATH or in the usual places";
    return refuse(`PostgreSQL server binaries (initdb, pg_ctl) were not found ${where}; install PostgreSQL 13+ or pass --pg-bin <dir>. Nothing was started.`);
  }
  for (const rel of ["artifacts/tis-api-server/src/routes/proofread.ts", "lib/db/src/schema/index.ts", "lib/tis-api-zod/src/proofread.ts"]) {
    if (!existsSync(path.join(TREE, rel))) return refuse(`--tree ${TREE} has no ${rel}`);
  }

  const port = await pickPort();
  const socketDir = makeSocketDir(port);
  const rootDir = mkdtempSync(path.join(ROOT_BASE, "proofread-pg-harness-"));
  const dataDir = path.join(rootDir, "data");
  const log = path.join(rootDir, "harness.log");
  const USER = "proofread_harness";
  const DATABASE = "proofread_harness";
  // Every connection, the server's and this script's, is this object and nothing else.
  const connection = { host: socketDir, port, user: USER, database: DATABASE, ssl: false, max: 10 };
  console.log(`run directory ${rootDir}`);
  console.log(`cluster: port ${port}, unix socket only, in ${socketDir}; tree under test ${TREE}`);

  const pg = createRequire(path.join(REPO, "lib/db/package.json"))("pg");
  let server = null;
  let clusterStarted = false;
  let clusterEverStarted = false;
  const pools = [];
  let exitCode = 2;
  const teardown = async () => {
    if (server) await server.stop();
    for (const p of pools) await p.end().catch(() => undefined);
    // Also when pg_ctl start failed part-way: a postmaster.pid means something may be running on this data dir.
    if (clusterStarted || existsSync(path.join(dataDir, "postmaster.pid"))) {
      const stop = spawnSync(path.join(pgBin, "pg_ctl"), ["-D", dataDir, "-m", "fast", "-w", "-t", "60", "stop"], { env: childEnv(), encoding: "utf8" });
      if (stop.status !== 0) spawnSync(path.join(pgBin, "pg_ctl"), ["-D", dataDir, "-m", "immediate", "-w", "stop"], { env: childEnv() });
      clusterEverStarted = true;
      clusterStarted = existsSync(path.join(dataDir, "postmaster.pid"));
    }
    // A cluster that would not stop keeps its data directory, so `pg_ctl -D` can still stop it.
    if (clusterStarted) {
      console.error(`the cluster did not stop: pg_ctl -D ${dataDir} stop -m immediate, then delete ${rootDir} and ${socketDir}`);
    } else {
      rmSync(socketDir, { recursive: true, force: true });
      if (!KEEP) rmSync(rootDir, { recursive: true, force: true });
    }
    console.log(
      `teardown: cluster on port ${port} ${clusterStarted ? "STILL RUNNING" : clusterEverStarted ? "stopped" : "never started"}; socket dir ${existsSync(socketDir) ? "STILL PRESENT" : "removed"}; ` +
        `run directory ${KEEP ? `kept at ${rootDir}` : existsSync(rootDir) ? "STILL PRESENT" : "removed"}`,
    );
  };
  const onSignal = async (sig) => {
    console.error(`${sig}: tearing down`);
    await teardown();
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
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
      if (b.refused) return refuse(b.refused);
      if (label === "server") serverInputs = b.inputs;
    }
    const mustBundle = ["routes/proofread.ts", "lib/proofread-store.ts", "lib/proofread-run.ts", "lib/tis-projects.ts", "lib/firms.ts", "lib/security.ts"];
    const missing = mustBundle.filter((rel) => !serverInputs.includes(path.join(TREE, "artifacts/tis-api-server/src", rel)));
    if (missing.length) return refuse(`the server bundle does not hold the tree's ${missing.join(", ")}`);
    console.log(`bundled ${serverInputs.filter((f) => !f.includes("node_modules")).length} source files from the tree`);

    // ---- the throwaway cluster ------------------------------------------------------------------------
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
    run(path.join(pgBin, "pg_ctl"), ["-D", dataDir, "-l", path.join(rootDir, "postgres.log"), "-w", "-t", "60", "start"], log);
    clusterStarted = true;
    clusterEverStarted = true;
    const admin = new pg.Pool({ ...connection, database: "postgres", max: 1 });
    pools.push(admin);
    // Before anything is written: the server on the other end of this socket is the one this run created.
    const [{ data_directory: served }] = (await admin.query("select current_setting('data_directory') as data_directory")).rows;
    if (realpathSync(served) !== realpathSync(dataDir)) return refuse(`the server on ${socketDir} serves ${served}, not this run's ${dataDir}`);
    await admin.query(`create database ${DATABASE}`);
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
    const startServer = (sha) =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [serverOut], {
          cwd: TREE,
          env: childEnv({ NODE_ENV: "production", LOG_LEVEL: "warn", GIT_SHA: sha }),
          stdio: ["ignore", "pipe", "pipe"],
        });
        let buf = "";
        let ready = false;
        const onData = (d) => {
          buf += d;
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl);
            buf = buf.slice(nl + 1);
            allLines.push(line);
            const m = /^LISTENING (\d+)$/.exec(line);
            if (m && !ready) {
              ready = true;
              clearTimeout(timer);
              resolve({
                port: Number(m[1]),
                stop: () =>
                  new Promise((done) => {
                    if (child.exitCode !== null) return done();
                    const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
                    child.once("exit", () => {
                      clearTimeout(kill);
                      done();
                    });
                    child.kill("SIGTERM");
                  }),
              });
            }
          }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.once("exit", (code) => {
          if (!ready) reject(new Error(`server exited ${code} before listening:\n${allLines.slice(-20).join("\n")}`));
        });
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("server did not listen within 30 s"));
        }, 30_000);
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
    const restart = async (sha) => {
      await server.stop();
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
    console.error("HARNESS ERROR", err);
    exitCode = 2;
  } finally {
    await teardown();
  }
  return exitCode;
}

/** Two deploys: the engine stamp ends in the commit, so a restart under SHA_B is "Run again after a deploy". */
const SHA_A = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const SHA_B = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";

process.exit(await main());
