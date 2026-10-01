/**
 * Guard for the proofread protocol's product-facing contract
 * (docs/superpowers/specs/2026-09-29-datum-in-product-design.md § Prerequisite).
 *
 * What silently rots: the version string every log entry needs, the
 * customer-venue copy ban, the audience routing, the single completion gate,
 * source refs that moved into lib/tis-engine-core, and the signal-timing
 * disclosure. Standalone node script (no test runner).
 * Run: `pnpm run check:proofread-protocol`
 *
 * Matching rules, because both files are hard-wrapped at 80 columns:
 *   - `flat()` collapses runs of whitespace, so a sentence that wraps across
 *     lines still matches as one string. Every prose assertion runs against a
 *     flattened form, never against raw lines — a line-based check cannot see
 *     "peer\nreview", and will report coverage it does not have.
 *   - the banned-phrase check matches per PARAGRAPH and exempts a paragraph
 *     only by an anchored opening. Exempting anything that merely contains the
 *     word "never" exempts most of the document.
 *   - section checks slice to the next heading. An unscoped slice (everything
 *     after "## Audience") lets a later section satisfy an assertion about
 *     this one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const protocol = readFileSync(path.join(repo, "TIS-PROOFREAD-PROTOCOL.md"), "utf8");
const agent = readFileSync(path.join(repo, ".claude/agents/datum.md"), "utf8");

/** Collapse whitespace, so an 80-column wrap cannot hide a phrase. */
const flat = (s) => s.replace(/\s+/g, " ").trim();
/** Also fold hyphens and dashes, so "peer-review" reads as "peer review". */
const phraseForm = (s) => flat(s.replace(/[-‐-―]+/g, " ")).toLowerCase();
/** Blank-line separated blocks, each flattened. */
const paragraphs = (s) => s.split(/\n[ \t]*\n/).map(flat).filter(Boolean);
/** The body of a `## ` section, up to the next `## ` heading or `---` rule. */
const section = (s, heading) =>
  s.match(new RegExp(`^## ${heading}$([\\s\\S]*?)(?=^## |^---$)`, "m"))?.[1] ?? "";

const protocolFlat = flat(protocol);
const agentFlat = flat(agent);

let fails = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) fails++;
};

// 1. A version string exists, because §Logging requires one in every entry.
ok(/^PROTOCOL_VERSION:\s*\d{4}-\d{2}-\d{2}\.\d+$/m.test(protocol), "protocol declares a PROTOCOL_VERSION line");

// 2. The Audience section exists, is scoped to its own heading, names all
//    three audiences, and routes each finding type to exactly one of them.
const audience = section(protocol, "Audience");
ok(audience.length > 0, "protocol has an ## Audience section closed by the next heading");
for (const who of ["engineer", "sealing PE", "admin"]) {
  ok(new RegExp(who, "i").test(flat(audience)), `Audience section names the ${who}`);
}
const bulletBlock = audience.split(/\n[ \t]*\n/).find((b) => /^- /.test(b.trim())) ?? "";
const bullets = bulletBlock.split(/\n(?=- )/).map(flat).filter((b) => b.startsWith("- "));
const bulletFor = (re) => bullets.find((b) => re.test(b)) ?? "";
const engineerBullet = bulletFor(/^- \*\*The engineer who ran the study\*\*/);
const peBullet = bulletFor(/^- \*\*The sealing PE\*\*/);
const adminBullet = bulletFor(/^- \*\*Admin\b/);
ok(engineerBullet !== "", "Audience gives the engineer who ran the study their own bullet");
ok(peBullet !== "", "Audience gives the sealing PE their own bullet");
ok(adminBullet !== "", "Audience gives admin its own bullet");
// Routing, not just role names: the amendment turns on WHICH type each role sees.
ok(/BLOCKER/.test(engineerBullet) && /UNVERIFIED/.test(engineerBullet),
  "the engineer's bullet carries BLOCKER through UNVERIFIED");
ok(/CONTESTED/.test(peBullet), "the sealing PE's bullet carries CONTESTED");
ok(/\balone sees\b[^.]*\bDEFECT\b/.test(adminBullet), "admin alone sees DEFECT");
ok(!/DEFECT/.test(engineerBullet) && !/DEFECT/.test(peBullet),
  "DEFECT is routed to neither the engineer nor the PE");

// 3. Banned customer-venue phrasing. Per paragraph, on a whitespace- and
//    hyphen-folded form. A paragraph is exempt only if it OPENS as a
//    statement about the ban.
const BANNED = ["independent review", "second opinion", "peer review", "QA/QC"];
const EXEMPT = {
  protocol: [
    /^\*\*Datum is a source-verification and traceability pass\./,
    /^\*\*Label it accordingly\./,
    /^The prohibition at §/,
  ],
  "datum.md": [
    /^\*\*Redline\*\* is the other chain\./,
    /^\*\*Know what you are\.\*\*/,
  ],
};
for (const [label, text] of [["protocol", protocol], ["datum.md", agent]]) {
  const exempt = EXEMPT[label];
  const paras = paragraphs(text);
  // Each exempting paragraph must still exist, or the exemption list silently
  // widens as the prose moves.
  for (const re of exempt) {
    ok(paras.some((p) => re.test(p)), `${label}: the ban-stating paragraph matching ${re} is still present`);
  }
  for (const phrase of BANNED) {
    const offending = paras
      .filter((p) => !exempt.some((re) => re.test(p)))
      .filter((p) => phraseForm(p).includes(phraseForm(phrase)));
    ok(offending.length === 0,
      `${label}: "${phrase}" appears only in the paragraphs that state the ban (${offending.length} stray)`);
    for (const p of offending) console.log(`        -> stray: ${p.slice(0, 140)}`);
  }
}
// The one permitted description. Nothing asserted this before.
ok(protocolFlat.includes("an internal consistency and traceability check"),
  "protocol states the permitted description verbatim");

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
//    Asserting the new name AND the absence of the old one — a regex requiring
//    `queue95Ft` to be followed by "field" or "payload" passed against the
//    stale text, which wrote it as "(`queue95Ft`)".
ok(protocol.includes("queue95thFt") && !/\bqueue95Ft\b/.test(protocol),
  "protocol names the payload field queue95thFt and nowhere says queue95Ft");
ok(!protocol.includes("LOS_THRESHOLDS"), "protocol does not reference the module-private LOS_THRESHOLDS");

// 6. One completion gate, stated once, requiring BOTH lists clear. The old
//    disjunction's first alternative matched the PRE-amendment two-way
//    sentence, so the amendment was unguarded.
const GATE = /no\s+open\s+`?BLOCKER`?\s+and\s+no\s+open\s+`?CONTESTED`?/i;
ok(GATE.test(protocolFlat), "protocol's completion gate requires no open BLOCKER and no open CONTESTED");
ok(!/empty\s+`?BLOCKER`?\s+list/i.test(protocolFlat), "the old empty-BLOCKER-list gate is gone from the protocol");
ok((protocolFlat.match(/may be called complete/gi) ?? []).length === 1,
  "the protocol states 'may be called complete' exactly once");
ok(/undisposed\s+`?NOTE`?[^.]*not a bar to completion/i.test(protocolFlat),
  "the gate exempts an undisposed NOTE / DISCLOSE / UNVERIFIED by name");
ok(!/\bno\s+undisposed\b/i.test(protocolFlat), "the gate adds no third condition on undisposed findings");
ok(GATE.test(agentFlat), "datum.md states the same two-condition gate");
ok(!/empty\s+`?BLOCKER`?\s+list\s+is\s+the\s+only\s+condition/i.test(agentFlat),
  "datum.md no longer states a BLOCKER-only gate");

// 7. The taxonomy includes DEFECT in the agent's frontmatter description.
const fm = agent.split("---")[1] ?? "";
ok(/DEFECT/.test(fm), "datum.md frontmatter description lists DEFECT");

// 8. §6 discloses the basis each row actually used. The standing note in the
//    same section calls a flat 90 s / g/C 0.45 finding "wrong on every
//    default-run study", so §6 must not order that disclosure either.
ok(!/Standing note on the flat g\/C/.test(protocol), "the stale 'Standing note on the flat g/C' heading is gone");
ok(!/applied flat/i.test(protocolFlat), "no 'applied flat' timing claim survives anywhere in the protocol");
ok(/signalTiming\.basis/.test(protocol), "protocol cites each row's signalTiming.basis");
const standingNote = protocol.match(/^### Standing note on signal timing$([\s\S]*?)(?=^---$)/m)?.[1] ?? "";
ok(/signalTiming\.basis/.test(standingNote),
  "the standing note on signal timing is the one keyed to signalTiming.basis");
const limitations = protocol.match(/^## 6\. Limitations disclosure$([\s\S]*?)(?=^### )/m)?.[1] ?? "";
ok(limitations.length > 0, "protocol has a §6 Limitations disclosure list ahead of the standing note");
ok(/signalTiming\.basis/.test(limitations),
  "§6 requires the basis each row reports, not a fixed cycle length and g/C");
ok(!/applied flat/i.test(flat(limitations)), "§6 no longer orders a flat-at-every-signal timing disclosure");

// 9. §Logging treats an undisposed finding as an open FINDING. The gate at the
//    end of the document is the only gate; "an open finding is an open study"
//    contradicts it.
const logging = section(protocol, "Logging");
ok(logging.length > 0, "protocol has a §Logging section");
ok(!/an open finding is an open study/i.test(protocolFlat),
  "§Logging no longer equates an open finding with an open study");
ok(/open\s+\*\*finding\*\*/.test(flat(logging)), "§Logging calls an undisposed finding an open **finding**");
ok(/not by itself an open study/i.test(flat(logging)),
  "§Logging says an undisposed finding is not by itself an open study");

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
