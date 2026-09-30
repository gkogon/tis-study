/**
 * Guard for the proofread protocol's product-facing contract
 * (docs/superpowers/specs/2026-09-29-datum-in-product-design.md § Prerequisite).
 *
 * Three things silently rot: the version string every log entry needs, the
 * customer-venue copy ban, and source refs that moved into
 * lib/tis-engine-core. Standalone node script (no test runner).
 * Run: `pnpm run check:proofread-protocol`
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const protocol = readFileSync(path.join(repo, "TIS-PROOFREAD-PROTOCOL.md"), "utf8");
const agent = readFileSync(path.join(repo, ".claude/agents/datum.md"), "utf8");

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

// 1. A version string exists, because §Logging requires one in every entry.
ok(/^PROTOCOL_VERSION:\s*\d{4}-\d{2}-\d{2}\.\d+$/m.test(protocol), "protocol declares a PROTOCOL_VERSION line");

// 2. The audience section exists and names all three audiences.
ok(/^## Audience$/m.test(protocol), "protocol has an ## Audience section");
for (const who of ["engineer", "sealing PE", "admin"]) {
  ok(new RegExp(who, "i").test(protocol.split("## Audience")[1] ?? ""), `Audience section names the ${who}`);
}

// 3. Banned customer-venue phrasing appears nowhere in either file except as
//    an explicit prohibition line (which starts with "NEVER").
const BANNED = ["independent review", "second opinion", "peer review", "QA/QC"];
for (const file of [["protocol", protocol], ["datum.md", agent]]) {
  for (const phrase of BANNED) {
    // A line that is ABOUT the ban may name the phrases; a line that uses one
    // as a description of the pass may not.
    const offending = file[1]
      .split("\n")
      .filter((l) => l.toLowerCase().includes(phrase.toLowerCase()))
      .filter((l) => !/prohibit|NEVER|banned|permitted|never say/i.test(l));
    ok(offending.length === 0, `${file[0]}: "${phrase}" appears only where the ban is stated (${offending.length} stray)`);
  }
}

// 4. Source refs point at the real modules, not the api-server re-export shims.
for (const stale of [
  "artifacts/tis-api-server/src/lib/land-uses.ts",
  "artifacts/tis-api-server/src/lib/signal-delay.ts",
  "artifacts/tis-api-server/src/lib/regional-growth-rates.ts",
]) {
  ok(!protocol.includes(stale) && !agent.includes(stale), `no stale shim ref: ${stale}`);
}
ok(protocol.includes("lib/tis-engine-core/src/"), "protocol cites lib/tis-engine-core/src/");

// 5. The payload field name is queue95thFt; LOS_THRESHOLDS cannot be imported.
ok(!/\bqueue95Ft\b\s*(field|payload)/.test(protocol), "protocol does not call queue95Ft a payload field");
ok(!protocol.includes("LOS_THRESHOLDS"), "protocol does not reference the module-private LOS_THRESHOLDS");

// 6. One completion gate, stated once, requiring BOTH lists empty.
ok(/empty\s+`?BLOCKER`?\s+list\s+\*\*and\*\*\s+an?\s+empty\s+`?CONTESTED`?/i.test(protocol)
  || /no open BLOCKER and no open CONTESTED/i.test(protocol),
  "completion gate requires empty BLOCKER and empty CONTESTED");
ok(!/BLOCKER list is empty\s*$/im.test(agent), "datum.md no longer states a BLOCKER-only gate");

// 7. The taxonomy includes DEFECT in the agent's frontmatter description.
const fm = agent.split("---")[1] ?? "";
ok(/DEFECT/.test(fm), "datum.md frontmatter description lists DEFECT");

// 8. The flat-timing standing note is retargeted to signalTiming.basis.
ok(!/g\/C\s*(of\s*)?0\.45\b[^\n]*applied flat/i.test(protocol), "stale flat-g/C standing note is gone");
ok(/signalTiming\.basis/.test(protocol), "protocol cites each row's signalTiming.basis");

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
