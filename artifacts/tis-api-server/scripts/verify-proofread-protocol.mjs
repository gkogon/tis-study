/**
 * Guard for the proofread protocol's product-facing contract
 * (docs/superpowers/specs/2026-09-29-datum-in-product-design.md § Prerequisite).
 *
 * What silently rots: the version string every log entry needs, the
 * customer-venue copy ban, the audience routing, the single completion gate,
 * source refs that moved into lib/tis-engine-core, and the signal-timing
 * disclosure — in the protocol, in .claude/agents/datum.md and in
 * .claude/skills/datum/SKILL.md, which the dev agent and the skill that
 * dispatches it each restate, and in .claude/agents/redline.md, which tells
 * the building agent who Datum's findings reach. Standalone node script (no
 * test runner).
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
const redline = readFileSync(path.join(repo, ".claude/agents/redline.md"), "utf8");

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
//     are two gates, and before 2026-10-07 the three files held three. Two reads:
//     a sentence saying "complete only" or "may be called complete" must BE the
//     sentence below ([*-gate-sentence]); and, in all four files (redline.md
//     too), any sentence that ties a completion word (COMPLETION) to a set of
//     types or to the findings as a whole (FINDING_SET) must be that sentence or
//     one of the named non-gate sentences ([*-no-other-gate]) — so a reworded
//     gate is read without its trigger phrase. A gate written with neither a
//     completion word nor a type ("a study holds only on ...") is not read.
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
/**
 * Units of prose: each blank-line paragraph, split into its list items (a line opening "- ", "* "
 * or "n. "), each flattened and split into sentences. A bullet never runs into the next one, so a
 * sentence about one type cannot borrow the next bullet's words.
 */
const itemsOf = (text) =>
  text
    .split(/\n[ \t]*\n/)
    .flatMap((p) => p.split(/\n(?=[ \t]*(?:[-*]|\d+\.)[ \t])/))
    .map(flat)
    .filter(Boolean);
const unitsOf = (text) => itemsOf(text).flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z`*])/));
/** The list items of a file that open with the type in backticks ("- `UNVERIFIED` — ..."), whole. */
const itemsOpening = (text, type) => itemsOf(text).filter((b) => b.startsWith(`- \`${type}\` —`));
/** The finding types a unit names (uppercase, with or without backticks). */
const typesIn = (u) => [...new Set([...u.matchAll(/\b(BLOCKER|DEFECT|DISCLOSE|NOTE|UNVERIFIED|CONTESTED)\b/g)].map((m) => m[1]))];
/**
 * Words that name completion. A gate is a sentence that ties one of these to a condition, so a
 * reworded gate ("done when no `BLOCKER` is open", "ships once every finding has a disposition")
 * is read without its author using "complete only" or "may be called complete".
 */
const COMPLETION = /\b(?:complete|completed|completion|done|finish|finished|ship|ships|shipped|shipping|seal|seals|sealed|sealable|sign(?:s|ed)?\s+off|gate)\b/i;
/** A condition on the findings as a whole: "any / every / all / each / no (open, undisposed ...) finding / item", or "findings ... disposed / open / resolved". */
const FINDING_SET = /\b(?:any|every|all|each|no)\s+(?:(?:open|undisposed|unresolved|outstanding|remaining|undecided)\s+)?(?:findings?|items?)\b|\b(?:findings?|items?)\b[^.]*\b(?:dispositions?|disposed|undisposed|dispositioned|open|closed|resolved|decided)\b/i;
/**
 * The sentences, per file, that name completion beside a type and are NOT gates: the record-not-
 * a-bar exemption and Disagreement 6's CONTESTED hold. Exact text; each must still be there.
 */
const GATE_EXEMPT = {
  protocol: [
    "That is the whole gate: an undisposed `NOTE`, `DISCLOSE` or `UNVERIFIED` is a record to carry, not a bar to completion.",
    "It blocks completion the same as a `BLOCKER` until the PE rules on it.",
  ],
  agent: [],
  skill: ["An undisposed `NOTE`, `DISCLOSE` or `UNVERIFIED` is a record to carry, not a bar to completion."],
  redline: [],
};
/** Every sentence of `text` that states a gate other than GATE_SENTENCE (see COMPLETION / FINDING_SET). */
const otherGates = (text, file) =>
  unitsOf(text).filter(
    (u) => COMPLETION.test(u) && (typesIn(u).length > 0 || FINDING_SET.test(u)) && u !== GATE_SENTENCE && !GATE_EXEMPT[file].includes(u),
  );
const statesNoOtherGate = (text, file) => {
  const units = unitsOf(text);
  return otherGates(text, file).length === 0 && GATE_EXEMPT[file].every((x) => units.includes(x));
};
const NO_OTHER_GATE_MSG = (who) =>
  `${who}: no sentence but the gate sentence ties completion (complete, completion, done, finished, ship, seal, sign off, gate) to a set of finding types or to the findings as a whole (any / every / all / each / no finding or item; findings ... disposed, open or resolved) — so no "any undisposed finding" gate, no BLOCKER-only gate and no gate over another type set, in any words`;
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
/**
 * A claim that findings stay with admin or never reach the engineer or the customer — the rule
 * amendment 1 replaced. Its spellings: "admin-only", "not user-facing" (or customer- / engineer- /
 * client-facing), "stays / remains / is internal", "admin-side", "never shown / sent / seen /
 * visible / reach / go / leave ... engineer(s) / customer(s) / user(s) / client(s)" within one
 * sentence, and "not shown / sent / visible / given to the engineer / customer". Read on the
 * flattened text. `allowed` names exact phrases a file may keep (where the log lives, the
 * protocol naming the rule it replaced); each is cut out before the test.
 */
const INTERNAL_ONLY = [
  /\badmin[\s-]*only\b/i,
  /\bnot\s+(?:user|customer|engineer|client)[\s-]*facing\b/i,
  /\b(?:stays?|remains?|kept|keeps?|is|are)\s+internal\b/i,
  /\badmin[\s-]*side\b/i,
  /\bnever\b[^.]*\b(?:shown|show|sent|seen|visible|reach|reaches|go|goes|leaves?)\b[^.]*\b(?:engineers?|customers?|users?|clients?)\b/i,
  /\bnot\s+(?:be\s+)?(?:shown|sent|visible|given)\s+to\s+(?:the\s+)?(?:engineers?|customers?|users?|clients?)\b/i,
];
const noInternalOnlyClaim = (text, allowed = []) => {
  let f = flat(text);
  for (const a of allowed) f = f.split(a).join(" ");
  return INTERNAL_ONLY.every((re) => !re.test(f));
};
/** What INTERNAL_ONLY refuses, for the messages. "internal" alone is not refused: the permitted description is "an internal consistency and traceability check". */
const INTERNAL_ONLY_MSG =
  "admin-only, not user- / customer- / engineer- / client-facing, \"is / are / stays / remains / kept internal\", admin-side, \"never shown / sent / seen / visible / reach / go / leave ... engineer / customer / user / client\" within a sentence, or \"not shown / sent / visible / given to the engineer / customer / user / client\"";
/**
 * The engineer sees more of a DEFECT than the count: "engineer ... sees / is told / shown / gets /
 * reads / receives / is given ... DEFECT", or "DEFECT ... shown / sent / given / visible / routed to
 * the engineer", within one sentence and no semicolon. Cut first, because each names what the
 * engineer is NOT given: "admin alone sees `DEFECT`" (who does see one) and "how many `DEFECT`s"
 * (the count, which the engineer is told).
 */
const ENGINEER_SEES_DEFECT = /\bengineer\b[^.;]*\b(?:sees?|seen|told|shown|gets?|reads?|receives?|given)\b[^.;]*\bdefects?\b|\bdefects?\b[^.;]*\b(?:shown|sent|given|visible|routed)\s+to\s+the\s+engineer\b/i;
const ENGINEER_SEES_DEFECT_CUTS = [/\balone sees\s+`?DEFECT`?/gi, /\bhow many\s+`?DEFECT`?s?\b/gi];
const engineerSeesNoDefect = (text) =>
  unitsOf(text).every((u) => !ENGINEER_SEES_DEFECT.test(ENGINEER_SEES_DEFECT_CUTS.reduce((s, re) => s.replace(re, " "), u)));
const ENGINEER_SEES_DEFECT_MSG =
  "no sentence says the engineer sees / is told / is shown / gets / reads / receives / is given a defect, or that a defect is shown / sent / given / visible / routed to the engineer (\"admin alone sees `DEFECT`\" and \"how many `DEFECT`s\" cut first)";
/**
 * Holds. NOT_A_HOLD is cut out first: "not a hold", "not a bar to completion", "does not / never
 * hold / block the study". HOLD_CLAIM is then a claim that something holds the study: "hold(s)
 * the / this study", "hold(s) (it) until", "block(s/ed) the / this / a / it / completion / shipping",
 * "blocking", "nothing ships", "bar(s) completion" / "bar to completion", and "as / like / is / are /
 * becomes / stays / remains / counts as a BLOCKER" (any case). Read where a type is NAMED in
 * uppercase: a sentence naming the type only by a pronoun ("treat it as a hold") outside the type's
 * own bullet is not read, and neither is a lowercase "unverified" (§5 uses it as a description of a
 * `BLOCKER`).
 */
const NOT_A_HOLD = /\bnot an?\s+(?:hold|bar to completion)\b|\b(?:does not|doesn't|never)\s+(?:hold|block)s?\s+(?:the|this)\s+study\b/gi;
const HOLD_CLAIM = /\bhold(?:s|ing)?\s+(?:the|this|a|that|their|your)\s+study\b|\bhold(?:s|ing)?\s+(?:it\s+)?until\b|\bblock(?:s|ed)?\s+(?:the|this|a|that|it|completion|shipping|sealing)\b|\bblocking\b|\bnothing\s+ships\b|\bbars?\s+completion\b|\bbar to completion\b|\b(?:as|like|is|are|becomes?|stays?|remains?|counts?\s+as)\s+an?\s+`?BLOCKER`?/i;
const HOLD_CLAIM_MSG = "holds the study, holds until, blocks, blocking, nothing ships, bars completion, as / like / is / becomes / stays / counts as a BLOCKER";
const claimsAHold = (s) => HOLD_CLAIM.test(s.replace(NOT_A_HOLD, " "));
/** A holding type's statement denied: "not a hold", "not a bar to completion", "does not / never hold / block the study", "a record to carry". */
const deniesTheHold = (s) => new RegExp(`${NOT_A_HOLD.source}|\\ba record to carry\\b`, "i").test(s);
const DENIES_MSG = "not a hold, not a bar to completion, does not / never hold / block the study, a record to carry";
/** Every sentence naming `UNVERIFIED`, and the whole `UNVERIFIED` list item, claims no hold. */
const unverifiedHoldsNothing = (text) =>
  unitsOf(text).filter((u) => /\bUNVERIFIED\b/.test(u)).every((u) => !claimsAHold(u)) && itemsOpening(text, "UNVERIFIED").every((b) => !claimsAHold(b));
/**
 * Anything treated "as" or "like" a BLOCKER, in datum.md and SKILL.md, which hold no such sentence
 * (the protocol's §3 and Disagreement 6 do, and rightly). Read file-wide, so "treat an unreachable
 * source as a `BLOCKER`" is refused though it names no type but BLOCKER. Cost: a true "report X as a
 * BLOCKER" written into either file is refused too, and belongs in the protocol, which they defer to.
 */
const AS_A_BLOCKER = /\b(?:as|like)\s+an?\s+`?BLOCKER`?/i;
/**
 * A DEFECT cleared other than by the software team: "the engineer / PE / you / firm / admin ...
 * may / can / will / should / must ... clear / close / dispose / resolve / lift / dismiss",
 * "clear(ed) ... by recording / logging / marking / filing", a disposition (`BUG FILED`, `FIXED`,
 * `WITHDRAWN`, `DISCLOSED`, `ACCEPTED RISK`, uppercase) ... "clears / closes / lifts / ends /
 * resolves / disposes", or a merge that clears it. Read in every sentence naming a defect and in
 * the whole `DEFECT` and `BUG FILED` list items, after cutting the denials the files make
 * ("neither ... nor ... disposes", "is not disposed of by ...", "does not clear ...").
 */
const DEFECT_DENIALS = /\bneither\b[^.;]*?\bnor\b[^.;]*?\bdispos\w*(?:\s+of\s+it)?|\bis not disposed of by\b[^.;]*|\bdoes not clear\b[^.;]*/gi;
const CLEARS_A_DEFECT = [
  /\b(?:engineer|PE|you|firm|admin|anyone|reviewer)\b[^.;]*\b(?:may|can|could|will|should|must)\b[^.;]*\b(?:clear|close|dispose|resolve|lift|release|dismiss)\w*/i,
  /\b(?:clear|close|dispose|resolve|lift|release|dismiss)\w*\b[^.;]*\bby\s+(?:recording|logging|marking|filing)\b/i,
  /`?(?:BUG[ _]FILED|FIXED|WITHDRAWN|DISCLOSED|ACCEPTED[ _]RISK)`?[^.;]*\b(?:clears?|cleared|closes?|closed|lifts?|lifted|ends?|ended|releases?|released|resolves?|resolved|disposes?|disposed)\b/,
  /\bmerg(?:e|es|ed|ing)\b[^.;]*\b(?:clears?|cleared|clos\w*|lift\w*)\b|\b(?:clears?|cleared|clos\w*|lift\w*)\b[^.;]*\bmerg(?:e|es|ed|ing)\b/i,
];
const nothingElseClearsADefect = (text) =>
  [...unitsOf(text).filter((u) => /\bdefects?\b/i.test(u)), ...itemsOpening(text, "DEFECT"), ...itemsOpening(text, "BUG FILED")]
    .map((u) => u.replace(DEFECT_DENIALS, " "))
    .every((u) => CLEARS_A_DEFECT.every((re) => !re.test(u)));
const CLEARS_MSG =
  "says the engineer, the PE, you, the firm, admin or anyone may / can / will / should / must clear / close / dispose of / resolve / lift / dismiss it, that it is cleared by recording / logging / marking / filing, that a disposition (`BUG FILED`, `FIXED`, `WITHDRAWN`, `DISCLOSED`, `ACCEPTED RISK`) clears / closes / lifts / ends / resolves it, or that a merge clears it — within one sentence and no semicolon, after the files' own denials are cut (\"neither ... nor ... disposes\", \"is not disposed of by\", \"does not clear\")";
/** Each type's hold statement, as rule 2 and SKILL.md state it: BLOCKER, DEFECT and CONTESTED hold; DISCLOSE, NOTE and UNVERIFIED do not. */
const HOLDS_IN = {
  rule2: { BLOCKER: /\bNothing ships\./, DEFECT: /\bholds this study until\b/, CONTESTED: /\bholds the study until the PE rules\b/ },
  skill: { BLOCKER: /\bNothing ships\./, DEFECT: /\bholds the study until\b/, CONTESTED: /\bholds the study until the PE rules\b/ },
};
const holdsPerType = (list, holds, recordsSay) =>
  SIX.every((type) => {
    const b = bulletFor2(list, type);
    if (b === "") return false;
    if (holds[type]) return holds[type].test(b) && !deniesTheHold(b);
    return (recordsSay === undefined || recordsSay.test(b)) && !claimsAHold(b);
  });
/** Disagreement item 6, flattened. */
const disagreement6 = (text) => flat(section(text, "Disagreement").match(/(?:^|\n)6\. ([\s\S]*?)(?=\n[ \t]*\n|\n\d+\. |$)/)?.[1] ?? "");

const CHECKS = [
  {
    id: "protocol-gate-sentence",
    on: "protocol",
    msg: `the protocol states the gate sentence "${GATE_SENTENCE}" exactly once, every sentence saying "complete only" or "may be called complete" is that sentence, and the two-condition "no open BLOCKER and no open CONTESTED" appears nowhere (a gate in other words: [protocol-no-other-gate])`,
    test: (t) => statesTheGate(t.protocol, 1),
  },
  {
    id: "protocol-no-other-gate",
    on: "protocol",
    msg: `${NO_OTHER_GATE_MSG("the protocol")}; the two non-gate sentences it names (the NOTE / DISCLOSE / UNVERIFIED record-not-a-bar sentence and Disagreement 6's CONTESTED hold) are still there word for word`,
    test: (t) => statesNoOtherGate(t.protocol, "protocol"),
  },
  {
    id: "agent-gate-sentence",
    on: "agent",
    msg: "datum.md states the gate sentence word for word, every sentence saying \"complete only\" or \"may be called complete\" is that sentence, and the two-condition gate appears nowhere (a gate in other words: [agent-no-other-gate])",
    test: (t) => statesTheGate(t.agent),
  },
  {
    id: "agent-no-other-gate",
    on: "agent",
    msg: NO_OTHER_GATE_MSG("datum.md"),
    test: (t) => statesNoOtherGate(t.agent, "agent"),
  },
  {
    id: "skill-gate-sentence",
    on: "skill",
    msg: "SKILL.md states the gate sentence word for word, every sentence saying \"complete only\" or \"may be called complete\" is that sentence, and the two-condition gate appears nowhere (a gate in other words: [skill-no-other-gate])",
    test: (t) => statesTheGate(t.skill),
  },
  {
    id: "skill-no-other-gate",
    on: "skill",
    msg: `${NO_OTHER_GATE_MSG("SKILL.md")}; its record-not-a-bar sentence on NOTE / DISCLOSE / UNVERIFIED is still there word for word`,
    test: (t) => statesNoOtherGate(t.skill, "skill"),
  },
  {
    id: "redline-no-other-gate",
    on: "redline",
    msg: `${NO_OTHER_GATE_MSG("redline.md")}; a sentence saying "complete only" or "may be called complete" there is the gate sentence, and the two-condition gate appears nowhere`,
    test: (t) => statesNoOtherGate(t.redline, "redline") && gateSentences(t.redline).every((x) => x === GATE_SENTENCE) && !OLD_GATE.test(flat(t.redline)),
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
    id: "rule2-hold-per-type",
    on: "protocol",
    msg: `rule 2 says per type whether it holds the study, as the gate does: the BLOCKER bullet says "Nothing ships.", DEFECT "holds this study until", CONTESTED "holds the study until the PE rules", and none of the three denies it (${DENIES_MSG}); the DISCLOSE, NOTE and UNVERIFIED bullets each say "not a hold" and claim none (${HOLD_CLAIM_MSG}, once "not a hold" / "not a bar to completion" are cut)`,
    test: (t) => holdsPerType(rule2Bullets(t.protocol), HOLDS_IN.rule2, /\bnot a hold\b/i),
  },
  {
    id: "disagreement6-contested-holds",
    on: "protocol",
    msg: `§Disagreement item 6: a CONTESTED item "blocks completion the same as a \`BLOCKER\` until the PE rules on it", and the item nowhere denies it (${DENIES_MSG}, does not / never block)`,
    test: (t) => {
      const d = disagreement6(t.protocol);
      return d.includes("It blocks completion the same as a `BLOCKER` until the PE rules on it.") && !deniesTheHold(d) && !/\b(?:does not|doesn't|never)\s+block\b/i.test(d);
    },
  },
  {
    id: "protocol-unverified-not-a-hold",
    on: "protocol",
    msg: `the protocol: no sentence naming \`UNVERIFIED\` (uppercase), and nothing in rule 2's UNVERIFIED bullet, claims a hold (${HOLD_CLAIM_MSG}, once "not a hold" / "not a bar to completion" are cut)`,
    test: (t) => unverifiedHoldsNothing(t.protocol),
  },
  {
    id: "protocol-no-internal-only-claim",
    on: "protocol",
    msg: `the protocol says nowhere ${INTERNAL_ONLY_MSG} — except "logged admin-side" (where the log lives) and "This replaces the earlier admin-side-only rule" (§Audience naming the rule it replaced)`,
    test: (t) => noInternalOnlyClaim(t.protocol, ["logged admin-side", "This replaces the earlier admin-side-only rule"]),
  },
  {
    id: "protocol-nothing-else-clears-a-defect",
    on: "protocol",
    msg: `the protocol: no sentence naming a defect, and nothing in rule 2's DEFECT item or §Logging's BUG FILED item, ${CLEARS_MSG}`,
    test: (t) => nothingElseClearsADefect(t.protocol),
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
    msg: `§5: a criterion Datum could not locate in the agency document is a \`BLOCKER\` — the criterion is unverified, not an assumed absence — because the document is in front of Datum and the source the study cites is wrong or missing (rule 2); a document Datum could not reach is rule 4's \`UNVERIFIED\`; and the bullet nowhere denies the hold (${DENIES_MSG})`,
    test: (t) => {
      const b = criterionBullet(t.protocol);
      return (
        b.startsWith("- A criterion Datum could not locate in the agency document is a `BLOCKER`: the criterion is unverified, not an assumed absence.") &&
        /\bwrong or missing \(rule 2\)/.test(b) &&
        /\brule 4's `UNVERIFIED`/.test(b) &&
        !deniesTheHold(b)
      );
    },
  },
  {
    id: "audience-engineer-told-only-the-count",
    on: "protocol",
    msg: `§Audience's admin bullet: admin alone sees DEFECT, and the engineer is told only how many their study carries, that each holds the study until the software team resolves it, and that a fix to the engine needs the study generated again; and, protocol-wide, ${ENGINEER_SEES_DEFECT_MSG}`,
    test: (t) =>
      /\balone sees\b[^.]*\bDEFECT\b/.test(adminBulletOf(t.protocol)) &&
      adminBulletOf(t.protocol).includes("The engineer is told only how many their study carries, that each holds the study until the software team resolves it, and that a fix to the engine needs the study generated again — nothing else about one.") &&
      engineerSeesNoDefect(t.protocol),
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
    msg: `datum.md: a source Datum cannot reach makes the finding \`UNVERIFIED\`; no sentence naming \`UNVERIFIED\` (uppercase) claims a hold (${HOLD_CLAIM_MSG}); nothing in the file is treated "as" or "like" a \`BLOCKER\`; and \`BLOCKER — unverified\` (a hyphen or a dash between) appears nowhere`,
    test: (t) =>
      /If you cannot reach the source, the finding is `UNVERIFIED`\./.test(flat(t.agent)) &&
      unverifiedHoldsNothing(t.agent) &&
      !AS_A_BLOCKER.test(flat(t.agent)) &&
      !/BLOCKER\s*[—-]+\s*unverified/i.test(t.agent),
  },
  {
    id: "agent-audiences",
    on: "agent",
    msg: `datum.md: who reads Datum's findings is set by the protocol's Audience section and findings now reach the engineer who ran the study; it says nowhere ${INTERNAL_ONLY_MSG} — except "logged admin-side" (where the log lives); and ${ENGINEER_SEES_DEFECT_MSG}`,
    test: (t) => {
      const f = flat(t.agent);
      return (
        /\bWho reads your findings, and which findings each reader sees, is set by the protocol's Audience section\./.test(f) &&
        /\bFindings now reach the engineer who ran the study\b/.test(f) &&
        noInternalOnlyClaim(t.agent, ["logged admin-side"]) &&
        engineerSeesNoDefect(t.agent)
      );
    },
  },
  {
    id: "agent-nothing-else-clears-a-defect",
    on: "agent",
    msg: `datum.md: no sentence naming a defect, and no \`DEFECT\` or \`BUG FILED\` list item, ${CLEARS_MSG}`,
    test: (t) => nothingElseClearsADefect(t.agent),
  },
  {
    id: "agent-six-types",
    on: "agent",
    msg: "datum.md names the six types in both its lists, in the protocol's order: the frontmatter's \"BLOCKER/DEFECT/DISCLOSE/NOTE/UNVERIFIED/CONTESTED findings list\" and §Output's \"`BLOCKER`, `DEFECT`, `DISCLOSE`, `NOTE`, `UNVERIFIED`, `CONTESTED`, each tagged\"",
    test: (t) => {
      const fm = t.agent.split("---")[1] ?? "";
      const output = t.agent.split(/^## Output$/m)[1] ?? "";
      return flat(fm).includes(`${SIX.join("/")} findings list`) && flat(output).includes(`${SIX.map((x) => `\`${x}\``).join(", ")}, each tagged`);
    },
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
    msg: `SKILL.md's "When findings come back" opens with one bullet to each of the six types, in the protocol's order (${SIX.join(", ")}), and no other of its bullets opens with a backticked word (no seventh type)`,
    test: (t) => {
      const list = skillBullets(t.skill);
      const typed = list.filter((b) => /^- `[^`]+` —/.test(b)).map((b) => /^- `([^`]+)` —/.exec(b)[1]);
      return list.slice(0, 6).map((b) => /^- `(\w+)` —/.exec(b)?.[1] ?? "?").join(",") === SIX.join(",") && typed.join(",") === SIX.join(",");
    },
  },
  {
    id: "skill-unverified-is-a-record",
    on: "skill",
    msg: `SKILL.md: the UNVERIFIED bullet says "A record to carry" and "not a hold" and has no "block"; no sentence naming \`UNVERIFIED\` (uppercase) claims a hold (${HOLD_CLAIM_MSG}); nothing in the file is treated "as" or "like" a \`BLOCKER\`; no \`BLOCKER — unverified\` (a hyphen or a dash between)`,
    test: (t) => {
      const b = bulletFor2(skillBullets(t.skill), "UNVERIFIED");
      return /\bA record to carry\b/.test(b) && /\bnot a hold\b/.test(b) && !/\bblock/i.test(b) && unverifiedHoldsNothing(t.skill) && !AS_A_BLOCKER.test(flat(t.skill)) && !/BLOCKER\s*[—-]+\s*unverified/i.test(t.skill);
    },
  },
  {
    id: "skill-audiences",
    on: "skill",
    msg: `SKILL.md names the protocol's three audiences — the engineer who ran the study, the sealing PE, admin alone for DEFECT; says nowhere ${INTERNAL_ONLY_MSG}; and ${ENGINEER_SEES_DEFECT_MSG}`,
    test: (t) => {
      const f = flat(t.skill);
      return (
        /\bThe engineer who ran the study sees every `BLOCKER`, `DISCLOSE`, `NOTE` and `UNVERIFIED`/.test(f) &&
        /\bThe sealing PE also sees every `CONTESTED` item\b/.test(f) &&
        /\bAdmin alone sees `DEFECT`/.test(f) &&
        noInternalOnlyClaim(t.skill) &&
        engineerSeesNoDefect(t.skill)
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
    id: "skill-hold-per-type",
    on: "skill",
    msg: `SKILL.md's type bullets say per type whether it holds the study, as the gate does: BLOCKER "Nothing ships.", DEFECT "holds the study until", CONTESTED "holds the study until the PE rules", none of the three denying it (${DENIES_MSG}); the DISCLOSE, NOTE and UNVERIFIED bullets claim no hold (${HOLD_CLAIM_MSG}, once "not a hold" / "not a bar to completion" are cut)`,
    test: (t) => holdsPerType(skillBullets(t.skill), HOLDS_IN.skill),
  },
  {
    id: "skill-nothing-else-clears-a-defect",
    on: "skill",
    msg: `SKILL.md: no sentence naming a defect, and nothing in the DEFECT bullet, ${CLEARS_MSG}`,
    test: (t) => nothingElseClearsADefect(t.skill),
  },
  {
    id: "skill-old-defect-rule-gone",
    on: "skill",
    msg: "SKILL.md nowhere says a DEFECT clears when a re-run no longer raises it (\"re-run ... no longer\", \"until a re-run\", \"clears only when a re-run\")",
    test: (t) => noOldDefectRule(t.skill),
  },
  {
    id: "redline-audiences",
    on: "redline",
    msg: `redline.md: Datum's findings are set by the protocol's §Audience — the engineer who ran the study sees every BLOCKER, DISCLOSE, NOTE and UNVERIFIED, the sealing PE also every CONTESTED, admin alone DEFECT — and it says nowhere ${INTERNAL_ONLY_MSG}; and ${ENGINEER_SEES_DEFECT_MSG}`,
    test: (t) => {
      const f = flat(t.redline);
      return (
        /\bWho reads its findings is set by the protocol's §Audience\b/.test(f) &&
        /\bthe engineer who ran the study sees every `BLOCKER`, `DISCLOSE`, `NOTE` and `UNVERIFIED`/.test(f) &&
        /\bthe sealing PE also sees every `CONTESTED` item\b/.test(f) &&
        /\badmin alone sees `DEFECT`/.test(f) &&
        noInternalOnlyClaim(t.redline) &&
        engineerSeesNoDefect(t.redline)
      );
    },
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

const TEXTS = { protocol, agent, skill, redline };
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
  { label: "protocol: back to the two-condition gate", file: "protocol", flips: ["protocol-gate-sentence", "protocol-no-other-gate"], apply: edit("protocol", /A study may be called complete only with no open `BLOCKER`, no open `DEFECT`\nand no open `CONTESTED`\./, OLD_TWO_WAY) },
  { label: "protocol: drop DEFECT from the gate", file: "protocol", flips: ["protocol-gate-sentence", "protocol-no-other-gate"], apply: edit("protocol", "no open `BLOCKER`, no open `DEFECT`\nand no open `CONTESTED`.", "no open `BLOCKER` and no open\n`CONTESTED`.") },
  { label: "protocol: state the gate a second time, with \"complete only\"", file: "protocol", flips: ["protocol-gate-sentence", "protocol-no-other-gate"], apply: edit("protocol", "6. A `CONTESTED` item is a licensed engineer's decision.", "6. A study is complete only with no open `BLOCKER`. A `CONTESTED` item is a licensed engineer's decision.") },
  { label: "protocol: state the gate sentence twice", file: "protocol", flips: ["protocol-gate-sentence"], apply: edit("protocol", "## Audience\n", `## Audience\n\n${GATE_SENTENCE}\n`) },
  { label: "protocol: a BLOCKER-only gate in other words (done when)", file: "protocol", flips: ["protocol-no-other-gate"], apply: edit("protocol", "not a bar to completion. A\n", "not a bar to completion. In practice a study is done when no `BLOCKER` is open. A\n") },
  { label: "protocol: an every-finding gate in other words (ships once ... dispositioned)", file: "protocol", flips: ["protocol-no-other-gate"], apply: edit("protocol", "Neither role outranks the other.", "A study ships once each item has been dispositioned. Neither role outranks the other.") },
  { label: "protocol: a gate over another type set (UNVERIFIED), wrapped", file: "protocol", flips: ["protocol-no-other-gate"], apply: edit("protocol", "## Logging\n\n", "## Logging\n\nThe gate also needs no open\n`UNVERIFIED`.\n\n") },
  { label: "protocol: a seal gate on undisposed findings", file: "protocol", flips: ["protocol-no-other-gate"], apply: edit("protocol", "It cannot edit the study even if it wanted to.", "It cannot edit the study even if it wanted to. The PE seals only with no undisposed finding.") },
  { label: "protocol: the record-not-a-bar sentence reworded", file: "protocol", flips: ["protocol-no-other-gate"], apply: edit("protocol", "is a record to carry, not a bar to completion. A\n", "is a record to carry until completion. A\n") },
  { label: "protocol: let the engineer dispose of a DEFECT", file: "protocol", flips: ["protocol-defect-held-until-resolved"], apply: edit("protocol", "A\n`DEFECT` is not disposed of by the engineer or the PE. It holds", "A\n`DEFECT` is closed when the engineer records it. It holds") },
  { label: "gate paragraph: back to \"clears only when a re-run no longer raises it\"", file: "protocol", flips: ["protocol-defect-held-until-resolved", "protocol-old-defect-rule-gone"], apply: edit("protocol", /It holds the study until\nthe software team resolves it: [\s\S]*?saved study\.\n/, "It clears only when a\nre-run no longer raises it.\n") },
  { label: "gate paragraph: drop that an engine fix needs the study generated again", file: "protocol", flips: ["protocol-defect-held-until-resolved"], apply: edit("protocol", "a fix\nto the engine needs the study generated again, because a re-run judges the same\nsaved study.", "a fix\nto the engine clears it the same way.") },
  { label: "protocol: the old rule restated in §6, wrapped", file: "protocol", flips: ["protocol-old-defect-rule-gone"], apply: edit("protocol", "- **Reported delay is capped at 300 s.**", "- **Reported delay is capped at 300 s.** A `DEFECT` clears once a\n  re-run no longer reports it.") },
  { label: "protocol: \"until the next re-run\" in the Audience preamble", file: "protocol", flips: ["protocol-old-defect-rule-gone"], apply: edit("protocol", "A Datum pass has three audiences, and a finding carries exactly one.", "A Datum pass has three audiences, and a finding carries exactly one. A `DEFECT` waits until the next re-run.") },
  { label: "rule 2: back to four types", file: "protocol", flips: ["rule2-six-types"], apply: edit("protocol", "2. Every finding is one of six types: `BLOCKER` / `DEFECT` / `DISCLOSE` /\n   `NOTE` / `UNVERIFIED` / `CONTESTED`.", "2. Every finding is `BLOCKER` / `DEFECT` / `DISCLOSE` / `NOTE`.") },
  { label: "rule 2: drop the CONTESTED bullet", file: "protocol", flips: ["rule2-six-types", "rule2-hold-per-type"], apply: edit("protocol", /\n   - `CONTESTED` — [\s\S]*?rules\.\n/, "\n") },
  { label: "rule 2: drop the UNVERIFIED bullet", file: "protocol", flips: ["rule2-six-types", "rule2-hold-per-type"], apply: edit("protocol", /\n   - `UNVERIFIED` — [\s\S]*?not a hold\.\n/, "\n") },
  { label: "rule 2: a DEFECT blocks this study (the old text)", file: "protocol", flips: ["rule2-defect-held-until-resolved", "rule2-hold-per-type"], apply: edit("protocol", /It opens a\n     bug and holds this study [\s\S]*?saved study\./, "It blocks\n     this study and it opens a bug.") },
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
  // protocol: what each type does to the study, and who may clear a DEFECT (fix wave 2: I-D, LAN-6, m-1)
  { label: "rule 2: NOTE holds the study until the PE has read it", file: "protocol", flips: ["rule2-hold-per-type"], apply: edit("protocol", "- `NOTE` — worth the PE's attention, not a hold.", "- `NOTE` — worth the PE's attention, and it holds the study until the PE has read it.") },
  { label: "rule 2: BLOCKER becomes a record to carry", file: "protocol", flips: ["rule2-hold-per-type"], apply: edit("protocol", "or a missing input. Nothing ships.", "or a missing input. A record to carry.") },
  { label: "rule 2: DISCLOSE no longer says it is not a hold", file: "protocol", flips: ["rule2-hold-per-type"], apply: edit("protocol", "say so out loud.\n     A record to carry, not a hold.\n", "say so out loud.\n") },
  { label: "rule 2: CONTESTED holds, then is called not a bar to completion", file: "protocol", flips: ["rule2-hold-per-type"], apply: edit("protocol", "holds the study until the PE\n     rules.", "holds the study until the PE\n     rules, though it is not a bar to completion.") },
  { label: "Disagreement 6: the CONTESTED hold denied in the next sentence", file: "protocol", flips: ["disagreement6-contested-holds"], apply: edit("protocol", "until the PE rules on it.\n", "until the PE rules on it. Until then it does not hold the\n   study.\n") },
  { label: "Disagreement 6: the CONTESTED hold replaced", file: "protocol", flips: ["disagreement6-contested-holds", "protocol-no-other-gate"], apply: edit("protocol", "It blocks completion\n   the same as a `BLOCKER` until the PE rules on it.", "The PE settles\n   it when convenient.") },
  { label: "protocol: an UNVERIFIED counts as a BLOCKER, wrapped (§What Datum is)", file: "protocol", flips: ["protocol-unverified-not-a-hold"], apply: edit("protocol", "protect a wrong number from a source check.", "protect a wrong number from a source check. An `UNVERIFIED`\ncounts as a `BLOCKER` until its source is reached.") },
  { label: "rule 2: the UNVERIFIED bullet blocks the study", file: "protocol", flips: ["protocol-unverified-not-a-hold", "rule2-hold-per-type"], apply: edit("protocol", "(rules 3 and 4). A record to carry, not a hold.", "(rules 3 and 4). It blocks the study until the source is reached.") },
  { label: "protocol: the pass remains internal (rule 6)", file: "protocol", flips: ["protocol-no-internal-only-claim"], apply: edit("protocol", "the finding itself does not.", "the finding itself does not.\n   The pass itself remains internal.") },
  { label: "protocol: findings never go out to the customer (§Logging)", file: "protocol", flips: ["protocol-no-internal-only-claim"], apply: edit("protocol", "The log is never part of the\ndeliverable.", "The log is never part of the\ndeliverable. Findings never go\nout to the customer.") },
  { label: "protocol: not engineer-facing (§Audience preamble)", file: "protocol", flips: ["protocol-no-internal-only-claim"], apply: edit("protocol", "and a finding carries exactly one.", "and a finding carries exactly one. A `DEFECT` is not engineer-facing.") },
  { label: "§Audience: the engineer can dismiss a DEFECT once it is filed", file: "protocol", flips: ["protocol-nothing-else-clears-a-defect"], apply: edit("protocol", "— nothing else about one.", "— nothing else about one. The engineer can dismiss a\n  `DEFECT` once it is filed.") },
  { label: "§Logging: recording FIXED on a DEFECT lifts the hold", file: "protocol", flips: ["protocol-nothing-else-clears-a-defect"], apply: edit("protocol", "- `FIXED` — the study changed.", "- `FIXED` — the study changed, and recording it on a `DEFECT` lifts the hold.") },
  { label: "rule 2's DEFECT item: merging the fix clears it (no 'defect' in the sentence)", file: "protocol", flips: ["protocol-nothing-else-clears-a-defect"], apply: edit("protocol", "the engineer nor the PE disposes of it.", "the engineer nor the PE disposes of it. Merging the fix clears it.") },
  { label: "§5: the unlocated criterion is called a record to carry", file: "protocol", flips: ["criteria-unlocated-is-a-blocker"], apply: edit("protocol", "reach at all is rule 4's `UNVERIFIED`.", "reach at all is rule 4's `UNVERIFIED`. It is a record to carry.") },
  { label: "rule 6: the engineer is shown every DEFECT, wrapped", file: "protocol", flips: ["audience-engineer-told-only-the-count"], apply: edit("protocol", "the finding itself does not.", "the finding itself does not. The engineer is\n   shown every `DEFECT` in the app.") },
  // datum.md
  { label: "datum.md: back to the two-condition gate", file: "agent", flips: ["agent-gate-sentence", "agent-no-other-gate"], apply: edit("agent", "A study may be called complete only with no open `BLOCKER`, no open `DEFECT`\nand no open `CONTESTED`.", "A study is complete only with no open `BLOCKER` and no open `CONTESTED`.") },
  { label: "datum.md: a second, BLOCKER-only gate", file: "agent", flips: ["agent-gate-sentence", "agent-no-other-gate"], apply: edit("agent", "## Output\n", "## Output\n\nA study is complete only with no open `BLOCKER`.\n") },
  { label: "datum.md: the gate sentence removed", file: "agent", flips: ["agent-gate-sentence"], apply: edit("agent", "A study may be called complete only with no open `BLOCKER`, no open `DEFECT`\nand no open `CONTESTED`.", "") },
  { label: "datum.md: a BLOCKER-only gate in other words (finished when)", file: "agent", flips: ["agent-no-other-gate"], apply: edit("agent", "## Output\n", "## Output\n\nCall a study finished when no `BLOCKER` is open.\n") },
  { label: "datum.md: a no-open-finding seal gate, wrapped", file: "agent", flips: ["agent-no-other-gate"], apply: edit("agent", "Name the `file:line`.", "Name the `file:line`. A study is sealed once no\nfinding is open.") },
  { label: "datum.md: back to BLOCKER — unverified", file: "agent", flips: ["agent-unverified-is-a-type", "agent-no-blocker-unverified"], apply: edit("agent", "the finding is `UNVERIFIED`.", "the finding is `BLOCKER — unverified`.") },
  { label: "datum.md: an en-dash compound in backticks", file: "agent", flips: ["agent-no-blocker-unverified"], apply: edit("agent", "**You cannot edit.**", "**You cannot edit.** A gap is `BLOCKER` – `unverified`.") },
  { label: "datum.md: the old DEFECT clearing rule, wrapped", file: "agent", flips: ["agent-old-defect-rule-gone"], apply: edit("agent", "Name the `file:line`.", "Name the `file:line`. It holds the study until a\nre-run no longer raises it.") },
  { label: "datum.md: the pass is kept internal", file: "agent", flips: ["agent-audiences"], apply: edit("agent", "so write each one to be read by them.", "so write each one to be read by them. The pass is kept internal to admin.") },
  { label: "datum.md: the engineer reads every DEFECT in full", file: "agent", flips: ["agent-audiences"], apply: edit("agent", "Name the `file:line`.", "Name the `file:line`; the engineer reads every `DEFECT` in full.") },
  { label: "datum.md: no pointer to the Audience section", file: "agent", flips: ["agent-audiences"], apply: edit("agent", /Who reads your findings, and which findings each reader sees, is set by the\nprotocol's Audience section\./, "Findings go to admin.") },
  { label: "datum.md: the PE may close a defect once the bug is filed, wrapped", file: "agent", flips: ["agent-nothing-else-clears-a-defect"], apply: edit("agent", "cannot rule on a software bug.", "cannot rule on a software bug. The PE may close a defect\nonce the bug is filed.") },
  { label: "datum.md: the frontmatter list drops UNVERIFIED", file: "agent", flips: ["agent-six-types"], apply: edit("agent", "BLOCKER/DEFECT/DISCLOSE/NOTE/UNVERIFIED/CONTESTED findings list", "BLOCKER/DEFECT/DISCLOSE/NOTE/CONTESTED findings list") },
  { label: "datum.md: the Output list out of the protocol's order", file: "agent", flips: ["agent-six-types"], apply: edit("agent", "`DISCLOSE`, `NOTE`, `UNVERIFIED`", "`NOTE`, `DISCLOSE`, `UNVERIFIED`") },
  { label: "datum.md: a missing count reported like a BLOCKER", file: "agent", flips: ["agent-unverified-is-a-type"], apply: edit("agent", "**You cannot edit.**", "**You cannot edit.** Report a missing count like a `BLOCKER`.") },
  { label: "datum.md: an UNVERIFIED stays a BLOCKER until the source is found", file: "agent", flips: ["agent-unverified-is-a-type"], apply: edit("agent", "the finding is `UNVERIFIED`. Writing down", "the finding is `UNVERIFIED`. An `UNVERIFIED` stays a `BLOCKER` until the source is found. Writing down") },
  // SKILL.md
  { label: "SKILL.md: a compound in parentheses", file: "skill", flips: ["skill-no-blocker-unverified"], apply: edit("skill", "- `NOTE` — surface to the PE.", "- `NOTE` — surface to the PE; a missing source is blocker (unverified).") },
  { label: "SKILL.md: the gate sentence removed", file: "skill", flips: ["skill-gate-sentence"], apply: edit("skill", "A study may be called complete only with no open `BLOCKER`, no open `DEFECT`\nand no open `CONTESTED`. ", "") },
  { label: "SKILL.md: the gate without DEFECT", file: "skill", flips: ["skill-gate-sentence", "skill-no-other-gate"], apply: edit("skill", "no open `BLOCKER`, no open `DEFECT`\nand no open `CONTESTED`. An undisposed", "no open `BLOCKER` and no open\n`CONTESTED`. An undisposed") },
  { label: "SKILL.md: a BLOCKER-only gate in other words (can be called complete once)", file: "skill", flips: ["skill-no-other-gate"], apply: edit("skill", "Relay findings verbatim to the operator.", "A study can be called complete once no `BLOCKER` is open. Relay findings verbatim to the operator.") },
  { label: "SKILL.md: an any-finding gate in other words", file: "skill", flips: ["skill-no-other-gate"], apply: edit("skill", "Relay findings verbatim to the operator.", "Do not call a study complete while any finding is open. Relay findings verbatim to the operator.") },
  { label: "SKILL.md: the record-not-a-bar sentence dropped", file: "skill", flips: ["skill-no-other-gate"], apply: edit("skill", " An undisposed `NOTE`, `DISCLOSE` or `UNVERIFIED` is a\nrecord to carry, not a bar to completion.", "") },
  { label: "SKILL.md: UNVERIFIED treated as a blocker again", file: "skill", flips: ["skill-unverified-is-a-record", "skill-hold-per-type"], apply: edit("skill", /- `UNVERIFIED` — [\s\S]*?run Datum again\.\n/, "- `UNVERIFIED` — treat as a blocker until the source is reached.\n") },
  { label: "SKILL.md: UNVERIFIED a hold, in the bullet's own words", file: "skill", flips: ["skill-unverified-is-a-record", "skill-hold-per-type"], apply: edit("skill", "A record to carry, in the\n  log and in the deliverable where it belongs — not a hold.", "It blocks the study until\n  the source is reached.") },
  { label: "SKILL.md: drop the CONTESTED bullet", file: "skill", flips: ["skill-six-types", "skill-hold-per-type"], apply: edit("skill", /- `CONTESTED` — [\s\S]*?until the PE rules\.\n/, "") },
  { label: "SKILL.md: drop the DEFECT bullet", file: "skill", flips: ["skill-six-types", "skill-defect-held-until-resolved", "skill-hold-per-type"], apply: edit("skill", /- `DEFECT` — [\s\S]*?can dispose of it\.\n/, "") },
  { label: "SKILL.md: the DEFECT bullet back to the old rule", file: "skill", flips: ["skill-defect-held-until-resolved", "skill-old-defect-rule-gone"], apply: edit("skill", /It holds the study\n  until the software team resolves it: [\s\S]*?generated again\./, "It holds the study\n  until a re-run no longer raises it.") },
  { label: "SKILL.md: drop that an engine fix needs the study generated again", file: "skill", flips: ["skill-defect-held-until-resolved"], apply: edit("skill", "a fix to the engine needs the study generated again.", "a fix to the engine clears it too.") },
  { label: "SKILL.md: you may dispose of a DEFECT", file: "skill", flips: ["skill-defect-held-until-resolved", "skill-nothing-else-clears-a-defect"], apply: edit("skill", "Neither you nor the\n  PE can dispose of it.", "You may dispose of it\n  once the fix ships.") },
  { label: "SKILL.md: the old rule restated beside the relay line", file: "skill", flips: ["skill-old-defect-rule-gone"], apply: edit("skill", "Relay findings verbatim to the operator.", "A `DEFECT` clears when a re-run stops raising it, and not until a re-run.\nRelay findings verbatim to the operator.") },
  { label: "SKILL.md: Datum is admin-side again", file: "skill", flips: ["skill-audiences"], apply: edit("skill", "**Who sees a finding** is set by the protocol's §Audience.", "**Datum is admin-side.** Findings never go to the customer. **Who sees a finding** is set by the protocol's §Audience.") },
  { label: "SKILL.md: drop the sealing PE", file: "skill", flips: ["skill-audiences"], apply: edit("skill", " The sealing PE also sees every `CONTESTED` item, with both\npositions and both sources, and is the only one who may rule on it.", "") },
  // redline.md
  { label: "redline.md: a BLOCKER-only gate (ships once)", file: "redline", flips: ["redline-no-other-gate"], apply: edit("redline", "When you hand work to Datum:", "A study ships once no `BLOCKER` is open.\n\nWhen you hand work to Datum:") },
  { label: "redline.md: an every-finding seal gate", file: "redline", flips: ["redline-no-other-gate"], apply: edit("redline", "When you hand work to Datum:", "The PE may seal once every finding is disposed of.\n\nWhen you hand work to Datum:") },
  { label: "redline.md: a \"complete only\" sentence that is not the gate", file: "redline", flips: ["redline-no-other-gate"], apply: edit("redline", "When you hand work to Datum:", "A study is complete only once Datum signs.\n\nWhen you hand work to Datum:") },
  { label: "redline.md: back to admin-only, not user-facing", file: "redline", flips: ["redline-audiences"], apply: edit("redline", /\*\*Datum\*\* is the proofreader\.[\s\S]*?alone sees `DEFECT`\./, "**Datum** is the proofreader — admin-only, not user-facing. `TIS-PROOFREAD-\nPROTOCOL.md` at the repo root is the protocol; read it before handing work over.") },
  { label: "redline.md: findings stay internal", file: "redline", flips: ["redline-audiences"], apply: edit("redline", "When you hand work to Datum:", "Datum's findings stay internal.\n\nWhen you hand work to Datum:") },
  { label: "redline.md: findings never shown to the engineer, wrapped", file: "redline", flips: ["redline-audiences"], apply: edit("redline", "When you hand work to Datum:", "Its findings are never\nshown to the engineer.\n\nWhen you hand work to Datum:") },
  { label: "redline.md: Datum is admin-side", file: "redline", flips: ["redline-audiences"], apply: edit("redline", "When you hand work to Datum:", "Datum is an admin side pass.\n\nWhen you hand work to Datum:") },
  { label: "redline.md: the engineer no longer named", file: "redline", flips: ["redline-audiences"], apply: edit("redline", "the engineer who ran the study sees every", "the firm sees every") },
  { label: "redline.md: no pointer to §Audience", file: "redline", flips: ["redline-audiences"], apply: edit("redline", "Who reads its findings is set by\nthe protocol's §Audience:", "Its findings go to") },
  { label: "SKILL.md: BLOCKER no longer says nothing ships", file: "skill", flips: ["skill-hold-per-type"], apply: edit("skill", "- `BLOCKER` — fix it. Nothing ships.", "- `BLOCKER` — fix it before the PE reads the study.") },
  { label: "SKILL.md: DISCLOSE holds the study until you do", file: "skill", flips: ["skill-hold-per-type"], apply: edit("skill", "- `DISCLOSE` — add the language to the deliverable.", "- `DISCLOSE` — add the language to the deliverable. It holds the study until you do.") },
  { label: "SKILL.md: CONTESTED holds, then is called not a hold", file: "skill", flips: ["skill-hold-per-type"], apply: edit("skill", "holds the study until the PE rules.", "holds the study until the PE rules, though it is not a hold for you.") },
  { label: "SKILL.md: a DEFECT is closed by recording BUG FILED (beside the relay line)", file: "skill", flips: ["skill-nothing-else-clears-a-defect"], apply: edit("skill", "Relay findings verbatim to the operator.", "A `DEFECT` is closed by recording `BUG FILED`. Relay findings verbatim to the operator.") },
  { label: "SKILL.md: a seventh, WITHDRAWN bullet", file: "skill", flips: ["skill-six-types"], apply: edit("skill", "- To contest a finding you believe is wrong,", "- `WITHDRAWN` — the finding was withdrawn on a source.\n- To contest a finding you believe is wrong,") },
  { label: "SKILL.md: an UNVERIFIED remains a BLOCKER (outside its bullet)", file: "skill", flips: ["skill-unverified-is-a-record"], apply: edit("skill", "Relay findings verbatim to the operator.", "An `UNVERIFIED` remains a `BLOCKER` for the operator. Relay findings verbatim to the operator.") },
  { label: "SKILL.md: what was not supplied is reported as a BLOCKER", file: "skill", flips: ["skill-unverified-is-a-record"], apply: edit("skill", "so absence is reportable.", "so absence is reportable, as a `BLOCKER`.") },
  { label: "SKILL.md: the pass remains internal", file: "skill", flips: ["skill-audiences"], apply: edit("skill", "No finding appears in the deliverable —", "No finding appears in the deliverable, and the pass remains internal —") },
  { label: "SKILL.md: the engineer is told each DEFECT's clause, wrapped", file: "skill", flips: ["skill-audiences"], apply: edit("skill", "and the engineer is\ntold only how many their study carries.", "and the engineer is\ntold each `DEFECT`'s clause and how many their study carries.") },
  { label: "redline.md: the engineer gets each DEFECT as well", file: "redline", flips: ["redline-audiences"], apply: edit("redline", "admin alone sees `DEFECT`.", "admin alone sees `DEFECT`. The engineer gets each `DEFECT` as well.") },
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
