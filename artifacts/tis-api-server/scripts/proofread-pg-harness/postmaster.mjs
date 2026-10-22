/**
 * Stopping a throwaway cluster, for run.mjs and teeth.mjs. One rule: a data directory is removed only after its
 * postmaster is confirmed gone — pg_ctl stop (fast, then immediate), then `ps` must list no postmaster on that
 * directory. A data directory removed under a live postmaster leaves a cluster that `pg_ctl -D` can no longer stop.
 *
 * Which process is the postmaster on a data directory is read from `ps` by the END of its command line, never by
 * splitting it on whitespace: pg_ctl starts it as `<bin>/postgres -D <data directory>`, and a directory may hold a
 * space, so a command is that postmaster only when it is a program named postgres followed by exactly
 * ` -D <data directory>` (the directory as given, or its real path) and nothing after it.
 *
 * Nothing here signals a process itself or connects to anything. pg_ctl signals the pid in postmaster.pid, so it is
 * run only when `ps -p <that pid>` shows a postgres whose command ends with ` -D <this data directory>`. A pid file
 * that names a LIVE process `ps` does not show that way — a stale file whose pid now belongs to another process, a
 * postgres on another data directory, a command this cannot read — is "not confirmed stopped": pg_ctl is not run
 * (it would signal that pid), and the caller keeps the data directory. A pid file naming no live process is stale,
 * and does not hold the directory.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Where initdb and pg_ctl are: `given`, else PATH, then the usual Homebrew/Postgres.app places; null when not found. */
export function findPgBin(given) {
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

/** The pid on the first line of <dataDir>/postmaster.pid, or null when there is none. */
export function postmasterPidOf(dataDir) {
  try {
    const pid = Number(readFileSync(path.join(dataDir, "postmaster.pid"), "utf8").split("\n")[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** `dir` as given (resolved) and as its real path, when it has one. */
function forms(dir) {
  const out = new Set([path.resolve(dir)]);
  try {
    out.add(realpathSync(dir));
  } catch {}
  return [...out];
}

/** The program part of `command` when it is `<program> -D <dataDir>` exactly and the program is named postgres. */
const programOn = (command, dataDir) => {
  const tail = ` -D ${dataDir}`;
  if (!command.endsWith(tail)) return null;
  const program = command.slice(0, -tail.length);
  return /(^|\/)postgres$/.test(program) ? program : null;
};

/** Is `command` (a `ps` command line) a postmaster on exactly `dataDir`, as given or as its real path? */
export function isPostmasterOn(command, dataDir) {
  return forms(dataDir).some((d) => programOn(command, d) !== null);
}

/**
 * What `ps` shows for `pid`: its command line, or null when no process has that pid. Throws when `ps` cannot say,
 * so a caller never reads "could not look" as "gone".
 */
export function commandOf(pid) {
  const ps = spawnSync("ps", ["-o", "pid=,command=", "-p", String(pid)], { encoding: "utf8" });
  const line = (ps.stdout ?? "").split("\n").find((l) => l.trim().split(/\s+/)[0] === String(pid));
  if (line !== undefined) return line.replace(/^\s*\d+\s/, "");
  if (ps.status === 1 && !(ps.stdout ?? "").trim() && !(ps.stderr ?? "").trim()) return null;
  throw new Error(`ps -p ${pid} could not say whether that pid runs (status ${ps.status ?? ps.signal}: ${(ps.stderr ?? "").trim()})`);
}

/**
 * The postmasters in `psText` (`ps -axo pid=,command=` output) whose data directory is one of `roots` or under one:
 * each command read as `<program named postgres> -D <directory>` to the end of the line, so a directory holding a
 * space is read whole. Pure, so teeth.mjs can hold it to a command line no real cluster has.
 */
export function postmastersIn(psText, roots) {
  const found = [];
  for (const line of psText.split("\n")) {
    const m = /^\s*(\d+)\s(.*)$/.exec(line);
    if (!m) continue;
    const command = m[2].replace(/^\s+/, "");
    for (const r of roots) {
      let at = -1;
      let hit = null;
      while ((at = command.indexOf(` -D ${r}`, at + 1)) >= 0) {
        const dataDir = command.slice(at + 4);
        const after = dataDir.slice(r.length);
        if ((after === "" || after.startsWith(path.sep)) && /(^|\/)postgres$/.test(command.slice(0, at))) hit = { pid: Number(m[1]), command, program: command.slice(0, at), dataDir };
      }
      if (hit) {
        found.push(hit);
        break;
      }
    }
  }
  return found;
}

/** Every postmaster `ps` lists whose data directory is `dir` or under it, `dir` as given or as its real path. */
export function postmastersUnder(dir) {
  const ps = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  if (ps.status !== 0) throw new Error(`ps failed: ${ps.stderr}`);
  return postmastersIn(ps.stdout, forms(dir));
}

/**
 * Stop the cluster on `dataDir` and wait (up to `waitMs`) until no postmaster runs on it. Returns the pids that were
 * running, whether they are all gone, what is left, and — when postmaster.pid names a live process that is not a
 * postgres on this directory — that process as `unmatched` (pg_ctl was not run: it would have signalled it). Safe to
 * call when nothing runs there: it then returns at once. Throws when `ps` cannot say; the caller treats that as not
 * confirmed stopped.
 */
export function stopCluster({ pgBin, dataDir, env, waitMs = 15_000 }) {
  const filePid = postmasterPidOf(dataDir);
  const fileCommand = filePid === null ? null : commandOf(filePid);
  const before = postmastersUnder(dataDir);
  if (fileCommand !== null && !isPostmasterOn(fileCommand, dataDir)) {
    const unmatched = { pid: filePid, command: fileCommand };
    return { pids: [filePid, ...before.map((p) => p.pid).filter((p) => p !== filePid)], stopped: false, left: [unmatched, ...before.filter((p) => p.pid !== filePid)], unmatched };
  }
  const ours = fileCommand !== null;
  if (ours) {
    const pgCtl = path.join(pgBin, "pg_ctl");
    const fast = spawnSync(pgCtl, ["-D", dataDir, "-m", "fast", "-w", "-t", "60", "stop"], { env, encoding: "utf8" });
    if (fast.status !== 0) spawnSync(pgCtl, ["-D", dataDir, "-m", "immediate", "-w", "-t", "30", "stop"], { env, encoding: "utf8" });
  }
  // Gone means: the pid file's postgres no longer runs (any process on that pid is held to be it), and ps lists no
  // postmaster on the directory.
  const live = () => {
    const left = postmastersUnder(dataDir);
    if (ours && !left.some((p) => p.pid === filePid)) {
      const now = commandOf(filePid);
      if (now !== null) left.unshift({ pid: filePid, command: now });
    }
    return left;
  };
  const deadline = Date.now() + waitMs;
  let left = live();
  while (left.length > 0 && Date.now() < deadline) {
    sleepSync(100);
    left = live();
  }
  const pids = [...new Set([...(ours ? [filePid] : []), ...before.map((p) => p.pid)])];
  return { pids, stopped: left.length === 0, left };
}
