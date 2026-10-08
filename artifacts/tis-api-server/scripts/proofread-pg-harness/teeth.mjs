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
 * Exit 0: every break went red as expected and the unbroken export passed. 1: otherwise.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    edit: [ROUTES, `if (newest === null || newest.id !== runId || newest.status !== "rules_ready") {`, `if (newest === null) {`],
    red: ["[FW-6 409] a fitting decision on a superseded revision", "[FW-6 409] while a newer revision is still running"],
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
    edit: [RUNNER, `prev.rulesVersion === run.rulesVersion`, `true`],
    red: ["[FW-1 carry] a revision whose predecessor ran under another rules version"],
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
const verdicts = [];
const note = (name, ok, detail) => {
  verdicts.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `\n        ${detail}` : ""}`);
};
const harness = (tree) => {
  const args = [path.join(HERE, "run.mjs"), "--tree", tree, "--root", runs];
  if (opt("--pg-bin")) args.push("--pg-bin", opt("--pg-bin"));
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 300_000 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { status: r.status, out, reds: out.split("\n").filter((l) => l.startsWith("FAIL  ")).map((l) => l.slice(6)) };
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
    note("the unbroken export passes (exit 0)", r.status === 0, r.status === 0 ? "" : `exit ${r.status}; red: ${r.reds.join(" | ") || r.out.slice(-600)}`);
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
      note(`${name}: refused before any cluster exists (exit 2, names ${b.refused})`, r.status === 2 && refusal.includes(b.refused) && neverStarted, refusal || r.out.slice(-600));
    } else {
      const missing = b.red.filter((prefix) => !r.reds.some((red) => red.startsWith(prefix)));
      note(`${name}: red (exit 1) on ${b.red.join(" + ")}`, r.status === 1 && missing.length === 0, `exit ${r.status}; red: ${r.reds.join(" | ") || "none"}${missing.length ? `; NOT red: ${missing.join(" | ")}` : ""}`);
    }
    rmSync(tree, { recursive: true, force: true });
  }
} catch (err) {
  note("teeth completed", false, err instanceof Error ? err.message : String(err));
} finally {
  rmSync(work, { recursive: true, force: true });
  console.log(`removed ${work}${existsSync(work) ? " (STILL PRESENT)" : ""}`);
}
const failed = verdicts.filter((v) => !v.ok);
console.log(`\n${verdicts.length - failed.length}/${verdicts.length} as expected`);
process.exit(failed.length ? 1 : 0);
