/**
 * Guard for the proofread protocol's product-facing contract
 * (docs/superpowers/specs/2026-09-29-datum-in-product-design.md § Prerequisite).
 *
 * What silently rots: the version string every log entry needs, the
 * customer-venue copy ban, the audience routing, the single completion gate,
 * source refs that moved into lib/tis-engine-core, and the signal-timing
 * disclosure — in the protocol, in .claude/agents/datum.md and in
 * .claude/skills/datum/SKILL.md, which the dev agent and the skill that
 * dispatches it each restate. Standalone node script (no test runner).
 *
 * Section 10 holds its checks in a table with ids and carries its own teeth:
 * each mutation edits one file's text in memory and must turn exactly the
 * checks that claim to protect it red, and only checks about that file.
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
const skill = readFileSync(path.join(repo, ".claude/skills/datum/SKILL.md"), "utf8");

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

// 6. One completion gate. The sentence itself, in all three files, is section 10's
//    (it names BLOCKER, DEFECT and CONTESTED since 2026-10-07); these are the
//    older gates that must stay gone, and the exemption that must stay.
ok(!/empty\s+`?BLOCKER`?\s+list/i.test(protocolFlat), "the old empty-BLOCKER-list gate is gone from the protocol");
ok((protocolFlat.match(/may be called complete/gi) ?? []).length === 1,
  "the protocol states 'may be called complete' exactly once");
ok(/undisposed\s+`?NOTE`?[^.]*not a bar to completion/i.test(protocolFlat),
  "the gate exempts an undisposed NOTE / DISCLOSE / UNVERIFIED by name");
ok(!/\bno\s+undisposed\b/i.test(protocolFlat), "the gate adds no third condition on undisposed findings");
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

// 10. The gate, the taxonomy and the audiences, in all three files — with teeth.
//     `on` is the file a check is ABOUT; the teeth pass holds every check to it.
//
//     The gate is one sentence, word for word, wherever a file states one
//     (TIS-PROOFREAD-PROTOCOL.md, datum.md, SKILL.md): two statements of a gate
//     are two gates, and before 2026-10-07 the three files held three. A
//     sentence "states a gate" when it says "complete only" or "may be called
//     complete"; each must BE the sentence below, and the old two-condition gate
//     may appear nowhere.
//
//     `BLOCKER — unverified` is none of the six types, so it may appear in none of
//     the three files, in any dash, case or punctuation; §5's criterion Datum cannot
//     locate in the agency document is a `BLOCKER`, spelled as one (2026-10-08).
//
//     A `DEFECT` holds the study until the software team resolves it: a fix to a
//     rule clears it on the next run, a fix to the engine needs the study generated
//     again (2026-10-08, fix wave 2, I-A). The old "until a re-run no longer raises
//     it" could never be met for a fault in the engine — a re-run judges the same
//     saved study — so it may appear in none of the files.
const GATE_SENTENCE = "A study may be called complete only with no open `BLOCKER`, no open `DEFECT` and no open `CONTESTED`.";
const SIX = ["BLOCKER", "DEFECT", "DISCLOSE", "NOTE", "UNVERIFIED", "CONTESTED"];
const OLD_GATE = /no\s+open\s+\**`?BLOCKER`?\**\s+and\s+no\s+open\s+\**`?CONTESTED`?/i;
/** Sentences, within blank-line paragraphs (a code fence or a heading never runs into the next sentence). */
const sentencesOf = (text) => paragraphs(text).flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z`*])/));
const gateSentences = (text) => sentencesOf(text).filter((x) => /\bcomplete only\b|\bmay be called complete\b/i.test(x));
const statesTheGate = (text, times) => {
  const all = gateSentences(text);
  const n = flat(text).split(GATE_SENTENCE).length - 1;
  return (times === undefined ? n >= 1 : n === times) && all.length === n && all.every((x) => x === GATE_SENTENCE) && !OLD_GATE.test(flat(text));
};
/** Numbered rule `n` of "Rules of the pass", flattened: from "n. " to the next rule or the next heading. */
const ruleOf = (text, n) => flat(text.match(new RegExp(`^${n}\\. ([\\s\\S]*?)(?=^\\d+\\. |^#)`, "m"))?.[1] ?? "");
/** The bullets of rule 2, each flattened, keyed by the type it opens with. */
const rule2Bullets = (text) => {
  const body = text.match(/^2\. ([\s\S]*?)(?=^3\. )/m)?.[1] ?? "";
  return body.split(/\n(?=\s*- `)/).slice(1).map(flat);
};
/** SKILL.md's "When findings come back" bullets, flattened. */
const skillBullets = (text) => {
  const body = text.match(/^When findings come back:\s*\n([\s\S]*?)\n[ \t]*\n/m)?.[1] ?? "";
  return body.split(/\n(?=- )/).map(flat).filter((b) => b.startsWith("- "));
};
const bulletFor2 = (list, type) => list.find((b) => b.startsWith(`- \`${type}\` —`)) ?? "";
const adminBulletOf = (text) => {
  const block = section(text, "Audience").split(/\n[ \t]*\n/).find((b) => /^- /.test(b.trim())) ?? "";
  return block.split(/\n(?=- )/).map(flat).find((b) => /^- \*\*Admin\b/.test(b)) ?? "";
};
const SKILL_EXEMPT = /^\*\*Do not oversell it\.\*\*/;
/**
 * `BLOCKER — unverified`, a compound that is none of the six types, in any spelling: any case,
 * backticks or emphasis around either word, and a hyphen, any Unicode dash, a minus sign, `--`,
 * a colon or an opening parenthesis between them, across a line wrap. An enumeration
 * ("`BLOCKER`, `UNVERIFIED`") is not one.
 */
const BLOCKER_UNVERIFIED = /\bBLOCKER[`*_]*\s*(?:[-\u2010-\u2015\u2212]+|:|\()\s*[`*_]*unverified\b/i;
const noBlockerUnverified = (text) => !BLOCKER_UNVERIFIED.test(flat(text));
/** §5's bullet on a criterion the agency document does not hold, flattened. */
const criterionBullet = (text) => paragraphs(section(text, "5\\. Criteria")).find((p) => p.startsWith("- A criterion Datum could not locate in the agency document")) ?? "";
/**
 * What clears a DEFECT (2026-10-08, fix wave 2, I-A). A re-run judges the same saved study row,
 * so it raises the same DEFECT every time unless the rule changed: the old "clears only when a
 * re-run no longer raises it" could never be met for a fault in the engine.
 */
const DEFECT_CLEARING = "until the software team resolves it: a fix to a rule clears it on the next run; a fix to the engine needs the study generated again";
/**
 * The replaced rule, in its spellings: a re-run that "no longer" raises / reports it, "until a
 * re-run", "clears only when / once a re-run". Read on the flattened text, so a wrap cannot hide it.
 */
const OLD_DEFECT_RULE = /\bre-?runs?\b[^.;:]*\bno longer\b|\buntil\s+(?:a|the|another|its)\s+(?:next\s+)?re-?run\b|\bclears?\s+(?:only\s+)?(?:when|once|after|on)\s+(?:a|the|another)\s+re-?run\b/i;
const noOldDefectRule = (text) => !OLD_DEFECT_RULE.test(flat(text));

const CHECKS = [
  {
    id: "protocol-gate-sentence",
    on: "protocol",
    msg: `the protocol states the gate exactly once, as "${GATE_SENTENCE}", states no other gate, and no longer holds the two-condition "no open BLOCKER and no open CONTESTED"`,
    test: (t) => statesTheGate(t.protocol, 1),
  },
  {
    id: "agent-gate-sentence",
    on: "agent",
    msg: "datum.md states the same gate, word for word, and no other",
    test: (t) => statesTheGate(t.agent),
  },
  {
    id: "skill-gate-sentence",
    on: "skill",
    msg: "SKILL.md states the same gate, word for word, and no other",
    test: (t) => statesTheGate(t.skill),
  },
  {
    id: "protocol-defect-held-until-resolved",
    on: "protocol",
    msg: `beside the gate, the protocol says a DEFECT is not disposed of by the engineer or the PE and holds the study "${DEFECT_CLEARING}", because a re-run judges the same saved study`,
    test: (t) => flat(t.protocol).includes(`A \`DEFECT\` is not disposed of by the engineer or the PE. It holds the study ${DEFECT_CLEARING}, because a re-run judges the same saved study.`),
  },
  {
    id: "protocol-old-defect-rule-gone",
    on: "protocol",
    msg: "the protocol nowhere says a DEFECT clears when a re-run no longer raises it (\"re-run ... no longer\", \"until a re-run\", \"clears only when a re-run\"): a re-run judges the same saved study",
    test: (t) => noOldDefectRule(t.protocol),
  },
  {
    id: "rule2-six-types",
    on: "protocol",
    msg: `rule 2 enumerates the six types — ${SIX.join(", ")} — in its opening sentence and as one bullet each, in that order`,
    test: (t) =>
      ruleOf(t.protocol, 2).startsWith(`Every finding is one of six types: ${SIX.map((x) => `\`${x}\``).join(" / ")}.`) &&
      rule2Bullets(t.protocol).map((b) => /^- `(\w+)` —/.exec(b)?.[1] ?? "?").join(",") === SIX.join(","),
  },
  {
    id: "rule2-defect-held-until-resolved",
    on: "protocol",
    msg: `rule 2's DEFECT bullet: it opens a bug and holds this study "${DEFECT_CLEARING}", and neither the engineer nor the PE disposes of it (not "it blocks this study", which read as a hold someone could clear)`,
    test: (t) => {
      const b = bulletFor2(rule2Bullets(t.protocol), "DEFECT");
      return b.includes(`It opens a bug and holds this study ${DEFECT_CLEARING}, because a re-run judges the same saved study.`) && /\bNeither the engineer nor the PE disposes of it\./.test(b) && !/\bblocks this study\b/.test(b);
    },
  },
  {
    id: "rule4-unverified",
    on: "protocol",
    msg: "rule 4: a source not in front of Datum makes the finding `UNVERIFIED` — not `BLOCKER — unverified`, a type that does not exist",
    test: (t) => {
      const r = ruleOf(t.protocol, 4);
      return /the finding is `UNVERIFIED`\.$/.test(r) && !/BLOCKER\s*[—-]+\s*unverified/i.test(r);
    },
  },
  {
    id: "protocol-no-blocker-unverified",
    on: "protocol",
    msg: "the protocol spells no `BLOCKER — unverified` anywhere, in any dash, case or punctuation (`BLOCKER - unverified`, `BLOCKER – unverified`, `BLOCKER: unverified`, across a wrap): it is none of the six types",
    test: (t) => noBlockerUnverified(t.protocol),
  },
  {
    id: "criteria-unlocated-is-a-blocker",
    on: "protocol",
    msg: "§5: a criterion Datum could not locate in the agency document is a `BLOCKER` — the criterion is unverified, not an assumed absence — because the document is in front of Datum and the source the study cites is wrong or missing (rule 2); a document Datum could not reach is rule 4's `UNVERIFIED`",
    test: (t) => {
      const b = criterionBullet(t.protocol);
      return (
        b.startsWith("- A criterion Datum could not locate in the agency document is a `BLOCKER`: the criterion is unverified, not an assumed absence.") &&
        /\bwrong or missing \(rule 2\)/.test(b) &&
        /\brule 4's `UNVERIFIED`/.test(b)
      );
    },
  },
  {
    id: "audience-engineer-told-only-the-count",
    on: "protocol",
    msg: "§Audience's admin bullet: admin alone sees DEFECT, and the engineer is told only how many their study carries, that each holds the study until the software team resolves it, and that a fix to the engine needs the study generated again",
    test: (t) =>
      /\balone sees\b[^.]*\bDEFECT\b/.test(adminBulletOf(t.protocol)) &&
      adminBulletOf(t.protocol).includes("The engineer is told only how many their study carries, that each holds the study until the software team resolves it, and that a fix to the engine needs the study generated again — nothing else about one."),
  },
  {
    id: "logging-bug-filed-does-not-clear",
    on: "protocol",
    msg: `§Logging: BUG FILED records the issue and does not clear the hold — a DEFECT holds the study "${DEFECT_CLEARING}"`,
    test: (t) => flat(section(t.protocol, "Logging")).includes(`\`BUG FILED\` — a \`DEFECT\`; record the issue or PR. It does not clear the hold. A \`DEFECT\` holds the study ${DEFECT_CLEARING}.`),
  },
  {
    id: "agent-unverified-is-a-type",
    on: "agent",
    msg: "datum.md: a source Datum cannot reach makes the finding `UNVERIFIED`, and `BLOCKER — unverified` appears nowhere",
    test: (t) => /If you cannot reach the source, the finding is `UNVERIFIED`\./.test(flat(t.agent)) && !/BLOCKER\s*[—-]+\s*unverified/i.test(t.agent),
  },
  {
    id: "agent-no-blocker-unverified",
    on: "agent",
    msg: "datum.md spells no `BLOCKER — unverified` anywhere, in any dash, case or punctuation",
    test: (t) => noBlockerUnverified(t.agent),
  },
  {
    id: "agent-old-defect-rule-gone",
    on: "agent",
    msg: "datum.md nowhere says a DEFECT clears when a re-run no longer raises it (\"re-run ... no longer\", \"until a re-run\", \"clears only when a re-run\")",
    test: (t) => noOldDefectRule(t.agent),
  },
  {
    id: "skill-six-types",
    on: "skill",
    msg: `SKILL.md's "When findings come back" gives one bullet to each of the six types, in the protocol's order (${SIX.join(", ")}), before the bullet on contesting`,
    test: (t) => skillBullets(t.skill).slice(0, 6).map((b) => /^- `(\w+)` —/.exec(b)?.[1] ?? "?").join(",") === SIX.join(","),
  },
  {
    id: "skill-unverified-is-a-record",
    on: "skill",
    msg: "SKILL.md: UNVERIFIED is a record to carry, not a hold — no \"treat as a blocker\", no `BLOCKER — unverified`",
    test: (t) => {
      const b = bulletFor2(skillBullets(t.skill), "UNVERIFIED");
      return /\bA record to carry\b/.test(b) && /\bnot a hold\b/.test(b) && !/\bblock/i.test(b) && !/UNVERIFIED[^.]{0,80}\bas a blocker\b/i.test(flat(t.skill)) && !/BLOCKER\s*[—-]+\s*unverified/i.test(t.skill);
    },
  },
  {
    id: "skill-audiences",
    on: "skill",
    msg: "SKILL.md names the protocol's three audiences — the engineer who ran the study, the sealing PE, admin alone for DEFECT — and makes no admin-side claim that findings never reach the customer",
    test: (t) => {
      const f = flat(t.skill);
      return (
        /\bThe engineer who ran the study sees every `BLOCKER`, `DISCLOSE`, `NOTE` and `UNVERIFIED`/.test(f) &&
        /\bThe sealing PE also sees every `CONTESTED` item\b/.test(f) &&
        /\bAdmin alone sees `DEFECT`/.test(f) &&
        !/admin[\s-]*side/i.test(f) &&
        !/never (go|goes|reach|reaches) (to )?the customer|not shown to the customer/i.test(f)
      );
    },
  },
  {
    id: "skill-no-blocker-unverified",
    on: "skill",
    msg: "SKILL.md spells no `BLOCKER — unverified` anywhere, in any dash, case or punctuation",
    test: (t) => noBlockerUnverified(t.skill),
  },
  {
    id: "skill-defect-held-until-resolved",
    on: "skill",
    msg: `SKILL.md's DEFECT bullet: it holds the study "${DEFECT_CLEARING}", and neither you nor the PE can dispose of it`,
    test: (t) => {
      const b = bulletFor2(skillBullets(t.skill), "DEFECT");
      return b.includes(`It holds the study ${DEFECT_CLEARING}.`) && /\bNeither you nor the PE can dispose of it\./.test(b);
    },
  },
  {
    id: "skill-old-defect-rule-gone",
    on: "skill",
    msg: "SKILL.md nowhere says a DEFECT clears when a re-run no longer raises it (\"re-run ... no longer\", \"until a re-run\", \"clears only when a re-run\")",
    test: (t) => noOldDefectRule(t.skill),
  },
  {
    id: "skill-banned-copy",
    on: "skill",
    msg: `SKILL.md: "independent review", "second opinion", "peer review" and "QA/QC" appear only in the paragraph that states the ban (opening "**Do not oversell it.**"), which is still there`,
    test: (t) => {
      const paras = paragraphs(t.skill);
      return (
        paras.some((p) => SKILL_EXEMPT.test(p)) &&
        paras.filter((p) => !SKILL_EXEMPT.test(p)).every((p) => BANNED.every((b) => !phraseForm(p).includes(phraseForm(b))))
      );
    },
  },
];

const TEXTS = { protocol, agent, skill };
const ids = CHECKS.map((c) => c.id);
ok(new Set(ids).size === ids.length, "precondition: every section-10 check id is unique");
ok(/`DEFECT`/.test(GATE_SENTENCE) && /`BLOCKER`/.test(GATE_SENTENCE) && /`CONTESTED`/.test(GATE_SENTENCE), "precondition: the gate sentence names BLOCKER, DEFECT and CONTESTED");
const failingOf = (t) => CHECKS.filter((c) => !c.test(t)).map((c) => c.id);
const failing = failingOf(TEXTS);
for (const c of CHECKS) ok(!failing.includes(c.id), `[${c.id}] ${c.msg}`);

// Teeth. Each edit breaks one protected property in one file's text and must
// turn exactly the listed checks red, all of them about that file.
const edit = (file, from, to) => (t) => ({ ...t, [file]: t[file].replace(from, to) });
const OLD_TWO_WAY = "A study may be called complete only with\n**no open BLOCKER and no open CONTESTED**.";
const MUTATIONS = [
  // protocol
  { label: "protocol: back to the two-condition gate", file: "protocol", flips: ["protocol-gate-sentence"], apply: edit("protocol", /A study may be called complete only with no open `BLOCKER`, no open `DEFECT`\nand no open `CONTESTED`\./, OLD_TWO_WAY) },
  { label: "protocol: drop DEFECT from the gate", file: "protocol", flips: ["protocol-gate-sentence"], apply: edit("protocol", "no open `BLOCKER`, no open `DEFECT`\nand no open `CONTESTED`.", "no open `BLOCKER` and no open\n`CONTESTED`.") },
  { label: "protocol: state the gate a second time, in other words", file: "protocol", flips: ["protocol-gate-sentence"], apply: edit("protocol", "6. A `CONTESTED` item is a licensed engineer's decision.", "6. A study is complete only with no open `BLOCKER`. A `CONTESTED` item is a licensed engineer's decision.") },
  { label: "protocol: state the gate sentence twice", file: "protocol", flips: ["protocol-gate-sentence"], apply: edit("protocol", "## Audience\n", `## Audience\n\n${GATE_SENTENCE}\n`) },
  { label: "protocol: let the engineer dispose of a DEFECT", file: "protocol", flips: ["protocol-defect-held-until-resolved"], apply: edit("protocol", "A\n`DEFECT` is not disposed of by the engineer or the PE. It holds", "A\n`DEFECT` is closed when the engineer records it. It holds") },
  { label: "gate paragraph: back to \"clears only when a re-run no longer raises it\"", file: "protocol", flips: ["protocol-defect-held-until-resolved", "protocol-old-defect-rule-gone"], apply: edit("protocol", /It holds the study until\nthe software team resolves it: [\s\S]*?saved study\.\n/, "It clears only when a\nre-run no longer raises it.\n") },
  { label: "gate paragraph: drop that an engine fix needs the study generated again", file: "protocol", flips: ["protocol-defect-held-until-resolved"], apply: edit("protocol", "a fix\nto the engine needs the study generated again, because a re-run judges the same\nsaved study.", "a fix\nto the engine clears it the same way.") },
  { label: "protocol: the old rule restated in §6, wrapped", file: "protocol", flips: ["protocol-old-defect-rule-gone"], apply: edit("protocol", "- **Reported delay is capped at 300 s.**", "- **Reported delay is capped at 300 s.** A `DEFECT` clears once a\n  re-run no longer reports it.") },
  { label: "protocol: \"until the next re-run\" in the Audience preamble", file: "protocol", flips: ["protocol-old-defect-rule-gone"], apply: edit("protocol", "A Datum pass has three audiences, and a finding carries exactly one.", "A Datum pass has three audiences, and a finding carries exactly one. A `DEFECT` waits until the next re-run.") },
  { label: "rule 2: back to four types", file: "protocol", flips: ["rule2-six-types"], apply: edit("protocol", "2. Every finding is one of six types: `BLOCKER` / `DEFECT` / `DISCLOSE` /\n   `NOTE` / `UNVERIFIED` / `CONTESTED`.", "2. Every finding is `BLOCKER` / `DEFECT` / `DISCLOSE` / `NOTE`.") },
  { label: "rule 2: drop the CONTESTED bullet", file: "protocol", flips: ["rule2-six-types"], apply: edit("protocol", /\n   - `CONTESTED` — [\s\S]*?rules\.\n/, "\n") },
  { label: "rule 2: drop the UNVERIFIED bullet", file: "protocol", flips: ["rule2-six-types"], apply: edit("protocol", /\n   - `UNVERIFIED` — [\s\S]*?not a hold\.\n/, "\n") },
  { label: "rule 2: a DEFECT blocks this study (the old text)", file: "protocol", flips: ["rule2-defect-held-until-resolved"], apply: edit("protocol", /It opens a\n     bug and holds this study [\s\S]*?saved study\./, "It blocks\n     this study and it opens a bug.") },
  { label: "rule 2: back to \"until a re-run no longer raises it\"", file: "protocol", flips: ["rule2-defect-held-until-resolved", "protocol-old-defect-rule-gone"], apply: edit("protocol", /It opens a\n     bug and holds this study [\s\S]*?saved study\./, "It holds\n     this study until a re-run no longer raises it, and it opens a bug.") },
  { label: "rule 2: a fix to the engine clears it on the next run too", file: "protocol", flips: ["rule2-defect-held-until-resolved"], apply: edit("protocol", "a fix to the engine needs the study\n     generated again, because", "a fix to the engine clears it the\n     same way, because") },
  { label: "rule 2: drop who may not dispose of a DEFECT", file: "protocol", flips: ["rule2-defect-held-until-resolved"], apply: edit("protocol", " Neither\n     the engineer nor the PE disposes of it.", "") },
  { label: "rule 4: back to BLOCKER — unverified", file: "protocol", flips: ["rule4-unverified", "protocol-no-blocker-unverified"], apply: edit("protocol", "the finding is `UNVERIFIED`.\n5.", "the finding is `BLOCKER — unverified`.\n5.") },
  { label: "§5: the unlocated criterion back to `BLOCKER — unverified`", file: "protocol", flips: ["protocol-no-blocker-unverified", "criteria-unlocated-is-a-blocker"], apply: edit("protocol", "is a\n  `BLOCKER`: the criterion is unverified, not an assumed absence.", "is\n  `BLOCKER — unverified`, not an assumed absence.") },
  { label: "§5: the unlocated criterion becomes UNVERIFIED (it would stop holding the study)", file: "protocol", flips: ["criteria-unlocated-is-a-blocker"], apply: edit("protocol", "is a\n  `BLOCKER`: the criterion is unverified", "is\n  `UNVERIFIED`: the criterion is unverified") },
  { label: "§5: drop why it is a BLOCKER and not rule 4's UNVERIFIED", file: "protocol", flips: ["criteria-unlocated-is-a-blocker"], apply: edit("protocol", / The\n  document was in front of Datum[\s\S]*?rule 4's `UNVERIFIED`\./, "") },
  { label: "§5: the reason no longer says the cited source is wrong or missing", file: "protocol", flips: ["criteria-unlocated-is-a-blocker"], apply: edit("protocol", "is wrong or missing (rule 2);", "is doubtful;") },
  { label: "§5: an unreachable document is no longer sent to rule 4", file: "protocol", flips: ["criteria-unlocated-is-a-blocker"], apply: edit("protocol", "reach at all is rule 4's `UNVERIFIED`.", "reach at all is the same.") },
  { label: "protocol: a hyphenated compound in rule 3", file: "protocol", flips: ["protocol-no-blocker-unverified"], apply: edit("protocol", "Silence is never a pass.", "Silence is never a pass; it is blocker-unverified.") },
  { label: "protocol: an en-dash compound in backticks, wrapped", file: "protocol", flips: ["protocol-no-blocker-unverified"], apply: edit("protocol", "Silence is never a pass.", "Silence is never a pass; it is `BLOCKER` –\n`unverified`.") },
  { label: "protocol: a colon compound", file: "protocol", flips: ["protocol-no-blocker-unverified"], apply: edit("protocol", "Silence is never a pass.", "Silence is never a pass; it is BLOCKER: unverified.") },
  { label: "§Audience: drop what the engineer is told", file: "protocol", flips: ["audience-engineer-told-only-the-count"], apply: edit("protocol", /\n  The engineer is told only how many their study carries, [\s\S]*?nothing else about one\./, "") },
  { label: "§Audience: the engineer is not told an engine fix needs the study generated again", file: "protocol", flips: ["audience-engineer-told-only-the-count"], apply: edit("protocol", "until the software team resolves it, and that a fix to the engine\n  needs the study generated again — nothing", "until the software team resolves it — nothing") },
  { label: "§Logging: BUG FILED clears the hold", file: "protocol", flips: ["logging-bug-filed-does-not-clear"], apply: edit("protocol", /It does not clear the\n  hold\. A `DEFECT` holds the study [\s\S]*?generated again\./, "It clears the hold.") },
  { label: "§Logging: back to \"clears only when a re-run no longer raises it\"", file: "protocol", flips: ["logging-bug-filed-does-not-clear", "protocol-old-defect-rule-gone"], apply: edit("protocol", /It does not clear the\n  hold\. A `DEFECT` holds the study [\s\S]*?generated again\./, "It does not clear the\n  hold: a `DEFECT` clears only when a re-run no longer raises it.") },
  // datum.md
  { label: "datum.md: back to the two-condition gate", file: "agent", flips: ["agent-gate-sentence"], apply: edit("agent", "A study may be called complete only with no open `BLOCKER`, no open `DEFECT`\nand no open `CONTESTED`.", "A study is complete only with no open `BLOCKER` and no open `CONTESTED`.") },
  { label: "datum.md: a second, BLOCKER-only gate", file: "agent", flips: ["agent-gate-sentence"], apply: edit("agent", "## Output\n", "## Output\n\nA study is complete only with no open `BLOCKER`.\n") },
  { label: "datum.md: the gate sentence removed", file: "agent", flips: ["agent-gate-sentence"], apply: edit("agent", "A study may be called complete only with no open `BLOCKER`, no open `DEFECT`\nand no open `CONTESTED`.", "") },
  { label: "datum.md: back to BLOCKER — unverified", file: "agent", flips: ["agent-unverified-is-a-type", "agent-no-blocker-unverified"], apply: edit("agent", "the finding is `UNVERIFIED`.", "the finding is `BLOCKER — unverified`.") },
  { label: "datum.md: an en-dash compound in backticks", file: "agent", flips: ["agent-no-blocker-unverified"], apply: edit("agent", "**You cannot edit.**", "**You cannot edit.** A gap is `BLOCKER` – `unverified`.") },
  { label: "datum.md: the old DEFECT clearing rule, wrapped", file: "agent", flips: ["agent-old-defect-rule-gone"], apply: edit("agent", "Name the `file:line`.", "Name the `file:line`. It holds the study until a\nre-run no longer raises it.") },
  // SKILL.md
  { label: "SKILL.md: a compound in parentheses", file: "skill", flips: ["skill-no-blocker-unverified"], apply: edit("skill", "- `NOTE` — surface to the PE.", "- `NOTE` — surface to the PE; a missing source is blocker (unverified).") },
  { label: "SKILL.md: the gate sentence removed", file: "skill", flips: ["skill-gate-sentence"], apply: edit("skill", "A study may be called complete only with no open `BLOCKER`, no open `DEFECT`\nand no open `CONTESTED`. ", "") },
  { label: "SKILL.md: the gate without DEFECT", file: "skill", flips: ["skill-gate-sentence"], apply: edit("skill", "no open `BLOCKER`, no open `DEFECT`\nand no open `CONTESTED`. An undisposed", "no open `BLOCKER` and no open\n`CONTESTED`. An undisposed") },
  { label: "SKILL.md: UNVERIFIED treated as a blocker again", file: "skill", flips: ["skill-unverified-is-a-record"], apply: edit("skill", /- `UNVERIFIED` — [\s\S]*?run Datum again\.\n/, "- `UNVERIFIED` — treat as a blocker until the source is reached.\n") },
  { label: "SKILL.md: UNVERIFIED a hold, in the bullet's own words", file: "skill", flips: ["skill-unverified-is-a-record"], apply: edit("skill", "A record to carry, in the\n  log and in the deliverable where it belongs — not a hold.", "It blocks the study until\n  the source is reached.") },
  { label: "SKILL.md: drop the CONTESTED bullet", file: "skill", flips: ["skill-six-types"], apply: edit("skill", /- `CONTESTED` — [\s\S]*?until the PE rules\.\n/, "") },
  { label: "SKILL.md: drop the DEFECT bullet", file: "skill", flips: ["skill-six-types", "skill-defect-held-until-resolved"], apply: edit("skill", /- `DEFECT` — [\s\S]*?can dispose of it\.\n/, "") },
  { label: "SKILL.md: the DEFECT bullet back to the old rule", file: "skill", flips: ["skill-defect-held-until-resolved", "skill-old-defect-rule-gone"], apply: edit("skill", /It holds the study\n  until the software team resolves it: [\s\S]*?generated again\./, "It holds the study\n  until a re-run no longer raises it.") },
  { label: "SKILL.md: drop that an engine fix needs the study generated again", file: "skill", flips: ["skill-defect-held-until-resolved"], apply: edit("skill", "a fix to the engine needs the study generated again.", "a fix to the engine clears it too.") },
  { label: "SKILL.md: you may dispose of a DEFECT", file: "skill", flips: ["skill-defect-held-until-resolved"], apply: edit("skill", "Neither you nor the\n  PE can dispose of it.", "You may dispose of it\n  once the fix ships.") },
  { label: "SKILL.md: the old rule restated beside the relay line", file: "skill", flips: ["skill-old-defect-rule-gone"], apply: edit("skill", "Relay findings verbatim to the operator.", "A `DEFECT` clears when a re-run stops raising it, and not until a re-run.\nRelay findings verbatim to the operator.") },
  { label: "SKILL.md: Datum is admin-side again", file: "skill", flips: ["skill-audiences"], apply: edit("skill", "**Who sees a finding** is set by the protocol's §Audience.", "**Datum is admin-side.** Findings never go to the customer. **Who sees a finding** is set by the protocol's §Audience.") },
  { label: "SKILL.md: drop the sealing PE", file: "skill", flips: ["skill-audiences"], apply: edit("skill", " The sealing PE also sees every `CONTESTED` item, with both\npositions and both sources, and is the only one who may rule on it.", "") },
  { label: "SKILL.md: banned phrase outside the ban paragraph", file: "skill", flips: ["skill-banned-copy"], apply: edit("skill", "Relay findings verbatim to the operator.", "Relay findings verbatim to the operator as a second opinion.") },
  { label: "SKILL.md: the ban paragraph removed", file: "skill", flips: ["skill-banned-copy"], apply: edit("skill", /\*\*Do not oversell it\.\*\*[\s\S]*?independent QA\.\n/, "") },
];
const teeth = new Map(CHECKS.map((c) => [c.id, c]));
for (const m of MUTATIONS) {
  const unknown = m.flips.filter((id) => !teeth.has(id));
  ok(unknown.length === 0, `teeth: "${m.label}" names only real checks${unknown.length ? ` (unknown: ${unknown.join(", ")})` : ""}`);
  const t = m.apply(TEXTS);
  ok(t[m.file] !== TEXTS[m.file], `teeth: "${m.label}" actually changes ${m.file}`);
  const now = failingOf(t).filter((id) => !failing.includes(id));
  const want = [...new Set(m.flips)].sort().join(", ");
  const got = now.sort().join(", ");
  ok(want === got, `teeth: "${m.label}" is caught by exactly the checks that claim to protect it${want === got ? "" : ` (expected red: ${want || "(none)"}; actually red: ${got || "(none)"})`}`);
  const wrong = now.filter((id) => teeth.get(id).on !== m.file);
  ok(wrong.length === 0, `teeth: "${m.label}" is caught only by checks about ${m.file}${wrong.length ? ` (also: ${wrong.join(", ")})` : ""}`);
}
const covered = new Set(MUTATIONS.flatMap((m) => m.flips));
const toothless = ids.filter((id) => !covered.has(id));
ok(toothless.length === 0, `every section-10 check has a mutation proving it has teeth${toothless.length ? ` (none for: ${toothless.join(", ")})` : ""}`);

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
