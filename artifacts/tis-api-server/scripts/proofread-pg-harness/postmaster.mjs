/**
 * Stopping a throwaway cluster, for run.mjs and teeth.mjs. One rule: a data directory is removed only after its
 * postmaster is confirmed gone — pg_ctl stop (fast, then immediate), then `ps` must list no `postgres -D <that
 * directory>` process. A data directory removed under a live postmaster leaves a cluster that `pg_ctl -D` can no
 * longer stop.
 *
 * Nothing here signals a process itself or connects to anything. pg_ctl signals the pid in postmaster.pid, so it is
 * run only when `ps` shows that pid is a postgres whose data directory is the one being stopped: a stale file whose
 * pid now belongs to some other process is never acted on.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** The pid on the first line of <dataDir>/postmaster.pid, or null when there is none. */
export function postmasterPidOf(dataDir) {
  try {
    const pid = Number(readFileSync(path.join(dataDir, "postmaster.pid"), "utf8").split("\n")[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Every `postgres -D <d>` process (a postmaster) whose <d> is `dir` or under it, `dir` as given or as its real path. */
export function postmastersUnder(dir) {
  const roots = new Set([path.resolve(dir)]);
  try {
    roots.add(realpathSync(dir));
  } catch {}
  const ps = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  if (ps.status !== 0) throw new Error(`ps failed: ${ps.stderr}`);
  const found = [];
  for (const line of ps.stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\S*postgres)\s+-D\s+(\S+)/.exec(line);
    if (!m) continue;
    const d = path.resolve(m[3]);
    if ([...roots].some((r) => d === r || d.startsWith(r + path.sep))) found.push({ pid: Number(m[1]), command: line.trim().replace(/^\d+\s+/, "") });
  }
  return found;
}

/**
 * Stop the cluster on `dataDir` and wait (up to `waitMs`) until no postmaster runs on it. Returns the pids that were
 * running and whether they are all gone. Safe to call when nothing runs there: it then returns at once.
 */
export function stopCluster({ pgBin, dataDir, env, waitMs = 15_000 }) {
  const live = () => postmastersUnder(dataDir);
  const before = live();
  const filePid = postmasterPidOf(dataDir);
  if (before.length > 0 && filePid !== null && before.some((p) => p.pid === filePid)) {
    const pgCtl = path.join(pgBin, "pg_ctl");
    const fast = spawnSync(pgCtl, ["-D", dataDir, "-m", "fast", "-w", "-t", "60", "stop"], { env, encoding: "utf8" });
    if (fast.status !== 0) spawnSync(pgCtl, ["-D", dataDir, "-m", "immediate", "-w", "-t", "30", "stop"], { env, encoding: "utf8" });
  }
  const deadline = Date.now() + waitMs;
  let left = live();
  while (left.length > 0 && Date.now() < deadline) {
    sleepSync(100);
    left = live();
  }
  return { pids: before.map((p) => p.pid), stopped: left.length === 0, left };
}
