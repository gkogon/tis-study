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
 * the building agent who Datum's findings reach; and the design spec's GET
 * row, which must name the keys of the read contract
 * (lib/tis-api-zod/src/proofread.ts, ProofreadReadResponse); and the runner's
 * PROTOCOL_VERSION reader (src/lib/proofread-run.ts), which must read the
 * protocol's one version line. Standalone node script (no test runner).
 *
 * Section 10 holds its checks in a table with ids and carries its own teeth:
 * each mutation edits one file's text in memory and must turn exactly the
 * checks that claim to protect it red, and only checks about that file or
 * checks that name it in `reads` (a check about one file read against another).
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
const spec = readFileSync(path.join(repo, "docs/superpowers/specs/2026-09-29-datum-in-product-design.md"), "utf8");
const contract = readFileSync(path.join(repo, "lib/tis-api-zod/src/proofread.ts"), "utf8");
const runner = readFileSync(path.join(repo, "artifacts/tis-api-server/src/lib/proofread-run.ts"), "utf8");

/** Collapse whitespace, so an 80-column wrap cannot hide a phrase. */
const flat = (s) => s.replace(/\s+/g, " ").trim();
/** Also fold hyphens and dashes, so "peer-review" reads as "peer review". */
const phraseForm = (s) => flat(s.replace(/[-‐-―]+/g, " ")).toLowerCase();
/**
 * HTML character references read as the character they render, so `&mdash;` is an em dash and
 * `&#47;` a slash: numeric (`&#8212;`, `&#x2014;`) and the named dashes (`&mdash;`, `&ndash;`,
 * `&minus;`, `&hyphen;`, `&dash;`). Markdown renders them, so a reader sees the dash.
 */
const NAMED_DASH = { mdash: "\u2014", ndash: "\u2013", minus: "\u2212", hyphen: "\u2010", dash: "\u2010" };
const decodeRefs = (s) =>
  s.replace(/&#(\d{1,7});|&#x([0-9a-f]{1,6});|&(mdash|ndash|minus|hyphen|dash);/gi, (m, d, h, n) => {
    if (n) return NAMED_DASH[n.toLowerCase()];
    const cp = d ? Number(d) : parseInt(h, 16);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
  });
/**
 * The banned customer-venue phrases, as the routes guard's BANNED_COPY spells them (any case;
 * "QA/QC", "QA / QC", "QA-QC", "QA\QC"; "audit" in any form), read on the phrase form of the text
 * with its character references decoded — so "peer‐review", "QA – QC" and "QA&mdash;QC" are read too.
 */
const BANNED_COPY = /independent[\s-]*review|second[\s-]*opinion|peer[\s-]*review|qa\s*[/\\-]?\s*qc|\baudit/i;
const hasBannedCopy = (p) => BANNED_COPY.test(phraseForm(decodeRefs(p)));
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

// 1. A version string exists, because §Logging requires one in every entry: section 10's
//    [protocol-version-is-the-runners] — exactly one line, well formed, and the one the runner reads.

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

// 3. Banned customer-venue phrasing: section 10's [protocol-banned-copy], [agent-banned-copy] and
//    [skill-banned-copy], per paragraph, with teeth. A paragraph is exempt only if it OPENS as a
//    statement about the ban; each exempting paragraph must still be there, or the exemption
//    silently widens as the prose moves.
const BAN_EXEMPT = {
  protocol: [/^\*\*Datum is a source-verification and traceability pass\./, /^\*\*Label it accordingly\./, /^The prohibition at §/],
  agent: [/^\*\*Redline\*\* is the other chain\./, /^\*\*Know what you are\.\*\*/],
  skill: [/^\*\*Do not oversell it\.\*\*/],
};
const bannedOnlyInTheBan = (text, file) => {
  const paras = paragraphs(text);
  const exempt = BAN_EXEMPT[file];
  return exempt.every((re) => paras.some((p) => re.test(p))) && paras.filter((p) => !exempt.some((re) => re.test(p))).every((p) => !hasBannedCopy(p));
};
const BANNED_MSG = "\"independent review\", \"second opinion\", \"peer review\", \"QA/QC\" and \"audit\" (any case; a space, hyphen, any dash or an HTML dash between the words; \"QA / QC\", \"QA-QC\"; \"audits\", \"auditor\")";
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
//     gate is read without its trigger phrase. Not read: a gate whose verb is not
//     in COMPLETION ("hand over", "file with the agency", "send", "approve"); one
//     whose condition names no type and no finding set FINDING_SET reads ("while
//     anything flagged is open", "until they are all decided" — a pronoun);
//     "issue", "release" or "stamp" after an article, a possessive, "engine" or
//     "rules" (read as the noun); and a gate split across two sentences.
//
//     `BLOCKER — unverified` is none of the six types, so it may appear in none of
//     the three files, in the spellings BLOCKER_UNVERIFIED reads; §5's criterion Datum
//     cannot locate in the agency document is a `BLOCKER`, spelled as one (2026-10-08).
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
 * reworded gate ("done when no `BLOCKER` is open", "ships once every finding has a disposition",
 * "may be submitted only when ...", "do not deliver while ...") is read without its author using
 * "complete only" or "may be called complete". The verbs a study leaves by: complete, finish, ship,
 * seal, sign off (or sign-off), submit, deliver, finalize/finalise, release, issue, stamp, go out.
 * "issue", "release" and "stamp" are nouns too ("record the issue or PR", "the engine stamp"): after
 * an article, a possessive or "engine"/"rules", they are read as the noun, not as completion.
 */
const COMPLETION =
  /\b(?:complete|completed|completion|done|finish|finished|ship|ships|shipped|shipping|seal|seals|sealed|sealable|sign(?:s|ed)?[\s-]*off|gate|submit|submits|submitted|submitting|submission|deliver|delivers|delivered|delivering|finali[sz](?:e|es|ed|ing)|released|releasing|issued|issuing|stamped|stamping|(?:go|goes|went|gone|going)\s+out)\b|(?<!\b(?:a|an|the|this|that|its|their|engine|rules)\s+)\b(?:release|releases|issue|issues|stamp|stamps)\b/i;
/**
 * A condition on the findings as a whole: "any / every / all / each / no (open, undisposed ...) finding / item";
 * a finding set led by its adjective ("undisposed findings", "Open items", "an outstanding item"); or "findings ...
 * disposed / open / resolved".
 */
const FINDING_SET =
  /\b(?:any|every|all|each|no)\s+(?:(?:open|undisposed|unresolved|outstanding|remaining|undecided)\s+)?(?:findings?|items?)\b|\b(?:open|undisposed|unresolved|outstanding|undecided)\s+(?:findings?|items?)\b|\b(?:findings?|items?)\b[^.]*\b(?:dispositions?|disposed|undisposed|dispositioned|open|closed|resolved|decided)\b/i;
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
  `${who}: no sentence but the gate sentence ties completion (complete, completion, done, finished, ship, seal, sign off or sign-off, gate, submit, deliver, finalize/finalise, release, issue, stamp, go out) to a set of finding types or to the findings as a whole (any / every / all / each / no finding or item; undisposed, open, unresolved, outstanding or undecided findings or items; findings ... disposed, open or resolved) — so no "any undisposed finding" gate, no BLOCKER-only gate and no gate over another type set, in any words`;
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
/**
 * `BLOCKER — unverified`, a compound that is none of the six types: any case, backticks or
 * emphasis around either word, and between them a hyphen, any Unicode dash, a minus sign, `--`,
 * an HTML dash (`&mdash;`, `&ndash;`, `&#8212;`, `&#x2014;` ... — decodeRefs), a colon or an
 * opening parenthesis, across a line wrap; or a slash before a lowercase or capitalised
 * "unverified" (`BLOCKER`/`unverified`). Not read as one: an enumeration ("`BLOCKER`,
 * `UNVERIFIED`"), and a slash before an all-caps `UNVERIFIED` — a list of two types, as
 * datum.md's "BLOCKER/DEFECT/..." frontmatter writes its list.
 */
const BLOCKER_UNVERIFIED = [
  /\bBLOCKER[`*_]*\s*(?:[-\u2010-\u2015\u2212]+|:|\()\s*[`*_]*unverified\b/i,
  /\b(?:BLOCKER|[Bb]locker)[`*_]*\s*\/\s*[`*_]*(?:unverified|Unverified)\b/,
];
const noBlockerUnverified = (text) => BLOCKER_UNVERIFIED.every((re) => !re.test(flat(decodeRefs(text))));
const COMPOUND_MSG = "in any case, with a hyphen, any dash, a minus, `--`, an HTML dash (`&mdash;`, `&ndash;`, `&#8212;`), a colon or a parenthesis between, across a wrap, or a slash before a lowercase \"unverified\" (`BLOCKER - unverified`, `BLOCKER – unverified`, `BLOCKER &mdash; unverified`, `BLOCKER: unverified`, `BLOCKER`/`unverified`)";
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
/**
 * The protocol's version lines: every line that opens, after whitespace or markup, with
 * PROTOCOL_VERSION in any case — the runner reads the first `^PROTOCOL_VERSION:` line, so a stray
 * line above the real one, malformed or not, is what every run would record.
 */
const versionLines = (text) => text.split("\n").filter((l) => /^[\s>*_`#-]*PROTOCOL_VERSION\b/i.test(l));
const VERSION_LINE = /^PROTOCOL_VERSION: (\d{4}-\d{2}-\d{2}\.\d+)$/;
/**
 * The regex the runner's PROTOCOL_VERSION reader runs over the protocol (proofread-run.ts, read
 * once at boot: `return /.../m.exec(readFileSync(file, "utf8"))?.[1] ?? "unknown";`), taken from its
 * source and built with the same flags. null when the reader is not in that shape — the check then
 * fails by name rather than vouching for a reader it did not read.
 */
const runnerVersionRegex = (src) => {
  const body = src.match(/const PROTOCOL_VERSION = \(\(\) => \{([\s\S]*?)\n\}\)\(\);/)?.[1] ?? "";
  const lit = body.match(/return (\/(?:\\.|[^/\n\\])+\/[a-z]*)\.exec\(readFileSync\(file, "utf8"\)\)\?\.\[1\] \?\? "unknown";/)?.[1];
  if (!lit) return null;
  const end = lit.lastIndexOf("/");
  try {
    return new RegExp(lit.slice(1, end), lit.slice(end + 1));
  } catch {
    return null;
  }
};
/** The spec's API table row for GET /projects/:id/proofread. */
const specGetRow = (text) => text.split("\n").find((l) => l.startsWith("| `GET /projects/:id/proofread` |")) ?? "";
/** The keys a backticked `{ a, b[], c: x }` list names, `[]` and values dropped. */
const keysOf = (list) => list.split(",").map((k) => k.trim().replace(/\[\]$/, "").replace(/:.*$/, "")).filter(Boolean);
/**
 * The top-level keys of the contract's ProofreadReadResponse, read from its source: each line at
 * exactly four spaces' indent opening `key: z` between `export const ProofreadReadResponse = z`
 * and its type export; a key is optional when its definition, up to the next such line, ends in
 * `.optional(),`. A reformatted contract reads as no keys, and the check fails by name.
 */
const contractReadKeys = (text) => {
  const body = text.split("export const ProofreadReadResponse = z")[1]?.split("export type ProofreadReadResponseT")[0] ?? "";
  const starts = [...body.matchAll(/^ {4}(\w+): z\b/gm)];
  const all = starts.map((m) => m[1]);
  const optional = starts.filter((m, i) => /\.optional\(\),\s*$/.test(body.slice(m.index, starts[i + 1]?.index ?? body.lastIndexOf(".strict()")))).map((m) => m[1]);
  return { all, required: all.filter((k) => !optional.includes(k)) };
};
const sameSet = (a, b) => a.length === new Set(a).size && [...a].sort().join(",") === [...b].sort().join(",");
/** Disagreement item `n`, flattened. */
const disagreementItem = (text, n) => flat(section(text, "Disagreement").match(new RegExp(`(?:^|\\n)${n}\\. ([\\s\\S]*?)(?=\\n[ \\t]*\\n|\\n\\d+\\. |$)`))?.[1] ?? "");
const disagreement6 = (text) => disagreementItem(text, 6);
/**
 * The withdrawn disposition has one name, `WITHDRAWN` (§Logging, the product's
 * ProofreadDisposition); `RESOLVED` was its second name (fix wave 2, m-2). Uppercase only:
 * "resolves" / "resolved" in prose are words, not the disposition.
 */
const RESOLVED_NAME = /\bRESOLVED\b/;
/** The protocol's Output format block: the first fenced text after "## Output format" (the last section, so section() cannot slice it). */
const outputBlock = (text) => (text.split(/^## Output format$/m)[1] ?? "").match(/```\n([\s\S]*?)\n```/)?.[1] ?? "";
/**
 * Its headings: every non-blank line at the left margin after the block's title line ("DATUM
 * FINDINGS — ..."), except the one dispositions line. Read by position, not by shape, so a
 * "RESOLVED:" or "WITHDRAWN —" heading is a heading too.
 */
const DISPOSITIONS_LINE = /^Dispositions recorded this pass\b.*:$/;
const outputMargin = (block) => block.split("\n").filter((l) => l.trim() !== "" && !/^\s/.test(l));
const outputHeadings = (block) => outputMargin(block).slice(1).filter((l) => !DISPOSITIONS_LINE.test(l));

const CHECKS = [
  {
    id: "protocol-version-is-the-runners",
    on: "protocol",
    reads: ["runner"],
    msg: "the protocol has exactly one PROTOCOL_VERSION line (a line opening with it, after any whitespace or markup, in any case), it reads `PROTOCOL_VERSION: YYYY-MM-DD.n`, and the runner's own reader (the regex in proofread-run.ts's PROTOCOL_VERSION, taken from its source) returns that version from the protocol — so every run records the version the protocol states",
    test: (t) => {
      const lines = versionLines(t.protocol);
      const v = lines.length === 1 ? VERSION_LINE.exec(lines[0])?.[1] : undefined;
      const re = runnerVersionRegex(t.runner);
      return v !== undefined && re !== null && re.exec(t.protocol)?.[1] === v;
    },
  },
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
    id: "protocol-withdrawn-is-the-one-name",
    on: "protocol",
    msg: "the protocol names the withdrawn disposition one way, `WITHDRAWN`: §Disagreement item 3 says Datum withdraws and \"logs the item `WITHDRAWN`\", §Logging lists `WITHDRAWN`, and `RESOLVED` (uppercase) appears nowhere",
    test: (t) =>
      /\bDatum withdraws\*\* and logs the item `WITHDRAWN`\./.test(disagreementItem(t.protocol, 3)) &&
      /^- `WITHDRAWN` — /m.test(section(t.protocol, "Logging")) &&
      !RESOLVED_NAME.test(t.protocol),
  },
  {
    id: "output-format-six-headings",
    on: "protocol",
    msg: `§Output format's block: after its "DATUM FINDINGS — " title, the lines at the left margin are exactly the six types in the protocol's order (${SIX.join(", ")}) and one last line "Dispositions recorded this pass ...:" — no seventh heading in any punctuation, no disposition as a heading — and \`WITHDRAWN\` appears only indented, under that line`,
    test: (t) => {
      const block = outputBlock(t.protocol);
      const margin = outputMargin(block);
      const [before, after = ""] = block.split(/^Dispositions recorded this pass\b.*:$/m);
      return (
        (margin[0] ?? "").startsWith("DATUM FINDINGS — ") &&
        outputHeadings(block).join(",") === SIX.join(",") &&
        margin.filter((l) => DISPOSITIONS_LINE.test(l)).length === 1 &&
        DISPOSITIONS_LINE.test(margin.at(-1) ?? "") &&
        !/\bWITHDRAWN\b/.test(before) &&
        /^ +WITHDRAWN\b/m.test(after)
      );
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
    msg: "rule 4: a source not in front of Datum makes the finding `UNVERIFIED` — not `BLOCKER — unverified` (a hyphen or an em dash between, within rule 4; every other spelling, anywhere: [protocol-no-blocker-unverified]), a type that does not exist",
    test: (t) => {
      const r = ruleOf(t.protocol, 4);
      return /the finding is `UNVERIFIED`\.$/.test(r) && !/BLOCKER\s*[—-]+\s*unverified/i.test(r);
    },
  },
  {
    id: "protocol-no-blocker-unverified",
    on: "protocol",
    msg: `the protocol spells no \`BLOCKER — unverified\` anywhere, ${COMPOUND_MSG}: it is none of the six types`,
    test: (t) => noBlockerUnverified(t.protocol),
  },
  {
    id: "criteria-unlocated-is-a-blocker",
    on: "protocol",
    msg: `§5: a criterion Datum could not locate in the agency document is a \`BLOCKER\` — the criterion is unverified, not an assumed absence — because the document is in front of Datum and the source the study cites is wrong or missing (rule 2); a document Datum could not reach is rule 4's \`UNVERIFIED\` — Datum, the agent, unable to reach a document the study cites; a document never supplied to the pass is neither: in the product, where no agency document is on file, the check is not run and the §5 clause reports that as coverage (\`not-run\` or a coverage note), never as a finding (spec: Non-goals; s5-criteria.ts CRITERIA_VALUES_NOTE); and the bullet nowhere denies the hold (${DENIES_MSG})`,
    test: (t) => {
      const b = criterionBullet(t.protocol);
      return (
        b.startsWith("- A criterion Datum could not locate in the agency document is a `BLOCKER`: the criterion is unverified, not an assumed absence.") &&
        /\bwrong or missing \(rule 2\)/.test(b) &&
        /\brule 4's `UNVERIFIED`/.test(b) &&
        b.includes("That is Datum, the agent, unable to reach a document the study cites.") &&
        b.includes(
          "A document never supplied to the pass is neither: in the product, where no agency document is on file, the check against it is not run, and the §5 clause reports that as coverage (`not-run`, or a coverage note that the criteria values were not checked), never as a finding (see What a Datum pass requires).",
        ) &&
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
    id: "logging-contested-pe-is-the-pes-ruling",
    on: "protocol",
    msg: "§Logging: `CONTESTED → PE` is the sealing PE's ruling on a `CONTESTED` item, `CONTESTED_PE` in the product, and only the sealing PE records it (as the contract's OFFERED_DISPOSITIONS comment and the route's PE_ONLY say) — not an escalation logged when the item is contested",
    test: (t) => {
      const b = itemsOf(section(t.protocol, "Logging")).find((x) => x.startsWith("- `CONTESTED → PE` —")) ?? "";
      return (
        b.startsWith("- `CONTESTED → PE` — the sealing PE's ruling on a `CONTESTED` item (`CONTESTED_PE` in the product).") &&
        /\bOnly the sealing PE records it\b/.test(b) &&
        !/\bescalat/i.test(b)
      );
    },
  },
  {
    id: "agent-unverified-is-a-type",
    on: "agent",
    msg: `datum.md: a source Datum cannot reach makes the finding \`UNVERIFIED\`; no sentence naming \`UNVERIFIED\` (uppercase) claims a hold (${HOLD_CLAIM_MSG}); nothing in the file is treated "as" or "like" a \`BLOCKER\`; and \`BLOCKER — unverified\` (a hyphen or an em dash between; every other spelling: [agent-no-blocker-unverified]) appears nowhere`,
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
    id: "agent-withdrawn-is-the-one-name",
    on: "agent",
    msg: "datum.md names the withdrawn disposition as the protocol does: \"withdraw the finding and log it `WITHDRAWN`\", and `RESOLVED` (uppercase) appears nowhere",
    test: (t) => /\bwithdraw the finding and log it `WITHDRAWN`\./.test(flat(t.agent)) && !RESOLVED_NAME.test(t.agent),
  },
  {
    id: "agent-no-blocker-unverified",
    on: "agent",
    msg: `datum.md spells no \`BLOCKER — unverified\` anywhere, ${COMPOUND_MSG}`,
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
    msg: `SKILL.md: the UNVERIFIED bullet says "A record to carry" and "not a hold" and has no "block"; no sentence naming \`UNVERIFIED\` (uppercase) claims a hold (${HOLD_CLAIM_MSG}); nothing in the file is treated "as" or "like" a \`BLOCKER\`; no \`BLOCKER — unverified\` (a hyphen or an em dash between; every other spelling: [skill-no-blocker-unverified])`,
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
    msg: `SKILL.md spells no \`BLOCKER — unverified\` anywhere, ${COMPOUND_MSG}`,
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
    id: "spec-get-row-is-the-contract",
    on: "spec",
    reads: ["contract"],
    msg: "the spec's GET /projects/:id/proofread row lists, in its `latest run: { ... }`, exactly the top-level keys of the contract's ProofreadReadResponse (a strict object, so a key it does not name — `questions[]` before phase three — is refused), and its no-run answer `{ status: \"none\", ... }` names exactly the keys the contract requires, with status \"none\", withheld 0 and rulesChanged false",
    test: (t) => {
      const row = specGetRow(t.spec);
      const { all, required } = contractReadKeys(t.contract);
      const listed = keysOf(row.match(/latest run: `\{ ([^}`]*) \}`/)?.[1] ?? "");
      const none = row.match(/A project with no run answers `\{ ([^}`]*) \}`/)?.[1] ?? "";
      return (
        all.length > 0 &&
        sameSet(listed, all) &&
        sameSet(keysOf(none), required) &&
        /\bstatus: "none"/.test(none) &&
        /\bwithheld: 0\b/.test(none) &&
        /\brulesChanged: false\b/.test(none)
      );
    },
  },
  {
    id: "protocol-banned-copy",
    on: "protocol",
    msg: `the protocol: ${BANNED_MSG} appear only in the paragraphs that state the ban (opening "**Datum is a source-verification and traceability pass.", "**Label it accordingly." or "The prohibition at §"), each still there`,
    test: (t) => bannedOnlyInTheBan(t.protocol, "protocol"),
  },
  {
    id: "agent-banned-copy",
    on: "agent",
    msg: `datum.md: ${BANNED_MSG} appear only in the paragraphs that state the ban (opening "**Redline** is the other chain." or "**Know what you are.**"), each still there`,
    test: (t) => bannedOnlyInTheBan(t.agent, "agent"),
  },
  {
    id: "skill-banned-copy",
    on: "skill",
    msg: `SKILL.md: ${BANNED_MSG} appear only in the paragraph that states the ban (opening "**Do not oversell it.**"), which is still there`,
    test: (t) => bannedOnlyInTheBan(t.skill, "skill"),
  },
];

const TEXTS = { protocol, agent, skill, redline, spec, contract, runner };
const ids = CHECKS.map((c) => c.id);
ok(new Set(ids).size === ids.length, "precondition: every section-10 check id is unique");
ok(/`DEFECT`/.test(GATE_SENTENCE) && /`BLOCKER`/.test(GATE_SENTENCE) && /`CONTESTED`/.test(GATE_SENTENCE), "precondition: the gate sentence names BLOCKER, DEFECT and CONTESTED");
const failingOf = (t) => CHECKS.filter((c) => !c.test(t)).map((c) => c.id);
const failing = failingOf(TEXTS);
for (const c of CHECKS) ok(!failing.includes(c.id), `[${c.id}] ${c.msg}`);

// Teeth. Each edit breaks one protected property in one file's text and must
// turn exactly the listed checks red, all of them about that file.
const edit = (file, from, to) => (t) => ({ ...t, [file]: t[file].replace(from, to) });
/** Fix wave 3, G3-1: gates the first reading of [*-no-other-gate] did not see. Each must go red in all four files. */
const G3_1_GATES = [
  "A study with undisposed findings is not complete.",
  "Undisposed findings bar completion.",
  "The study may be submitted to the agency only when no `BLOCKER` is open.",
  "Do not deliver a study while any finding is undisposed.",
  "Open items keep the study from completion.",
];
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
  { label: "§5: drop what the product records with no agency document on file", file: "protocol", flips: ["criteria-unlocated-is-a-blocker"], apply: edit("protocol", / A document never supplied to the pass is\n  neither:[\s\S]*?What a Datum pass requires\)\./, "") },
  { label: "§5: the product's missing document called UNVERIFIED", file: "protocol", flips: ["criteria-unlocated-is-a-blocker"], apply: edit("protocol", "(`not-run`, or a coverage note that the criteria values were not checked),\n  never as a finding", "(`UNVERIFIED`, or a coverage note that the criteria values were not checked),\n  never as a finding") },
  { label: "§5: the product's missing document reported as a finding", file: "protocol", flips: ["criteria-unlocated-is-a-blocker"], apply: edit("protocol", "never as a finding (see What a Datum pass requires).", "as a finding (see What a Datum pass requires).") },
  { label: "§5: drop whose UNVERIFIED rule 4's is", file: "protocol", flips: ["criteria-unlocated-is-a-blocker"], apply: edit("protocol", " That is Datum, the agent, unable to\n  reach a document the study cites.", "") },
  { label: "§5: the unlocated criterion is called a record to carry", file: "protocol", flips: ["criteria-unlocated-is-a-blocker"], apply: edit("protocol", "reach at all is rule 4's `UNVERIFIED`.", "reach at all is rule 4's `UNVERIFIED`. It is a record to carry.") },
  { label: "rule 6: the engineer is shown every DEFECT, wrapped", file: "protocol", flips: ["audience-engineer-told-only-the-count"], apply: edit("protocol", "the finding itself does not.", "the finding itself does not. The engineer is\n   shown every `DEFECT` in the app.") },
  // who records CONTESTED → PE (fix wave 2: m-3)
  { label: "§Logging: CONTESTED → PE back to an escalation", file: "protocol", flips: ["logging-contested-pe-is-the-pes-ruling"], apply: edit("protocol", /- `CONTESTED → PE` — [\s\S]*?an open `CONTESTED`\./, "- `CONTESTED → PE` — escalated; record the ruling when it comes.") },
  { label: "§Logging: the engineer records CONTESTED → PE", file: "protocol", flips: ["logging-contested-pe-is-the-pes-ruling"], apply: edit("protocol", "Only the sealing PE records it, with the\n  ruling;", "The engineer records it when the PE\n  rules;") },
  { label: "§Logging: CONTESTED → PE no longer named as the product's CONTESTED_PE", file: "protocol", flips: ["logging-contested-pe-is-the-pes-ruling"], apply: edit("protocol", "item\n  (`CONTESTED_PE` in the product).", "item.") },
  { label: "§Logging: CONTESTED → PE also logged when escalated", file: "protocol", flips: ["logging-contested-pe-is-the-pes-ruling"], apply: edit("protocol", "until then the item is an open `CONTESTED`.", "it is also logged when the item is escalated.") },
  // one name for the withdrawn disposition (fix wave 2: m-2)
  { label: "Disagreement 3: back to logging the item RESOLVED", file: "protocol", flips: ["protocol-withdrawn-is-the-one-name"], apply: edit("protocol", "logs the item\n   `WITHDRAWN`.", "logs the item\n   `RESOLVED`.") },
  { label: "Disagreement 3: Datum withdraws but logs nothing", file: "protocol", flips: ["protocol-withdrawn-is-the-one-name"], apply: edit("protocol", "and logs the item\n   `WITHDRAWN`.", "and moves on.") },
  { label: "§Logging: RESOLVED named as a second name for WITHDRAWN", file: "protocol", flips: ["protocol-withdrawn-is-the-one-name"], apply: edit("protocol", "- `WITHDRAWN` — Datum withdrew on a source Redline produced;", "- `WITHDRAWN` (or `RESOLVED`) — Datum withdrew on a source Redline produced;") },
  { label: "Output format: back to a RESOLVED heading", file: "protocol", flips: ["output-format-six-headings", "protocol-withdrawn-is-the-one-name"], apply: edit("protocol", /Dispositions recorded this pass [^\n]*:\n  WITHDRAWN  /, "RESOLVED\n  ") },
  { label: "Output format: WITHDRAWN as a seventh heading", file: "protocol", flips: ["output-format-six-headings"], apply: edit("protocol", /Dispositions recorded this pass [^\n]*:\n  WITHDRAWN  /, "WITHDRAWN\n  ") },
  { label: "Output format: a WITHDRAWN: heading with a colon", file: "protocol", flips: ["output-format-six-headings"], apply: edit("protocol", "CONTESTED\n  [§n] <finding>\n", "WITHDRAWN:\n  [§n] <finding> — on <source>\n\nCONTESTED\n  [§n] <finding>\n") },
  { label: "Output format: WITHDRAWN listed under CONTESTED", file: "protocol", flips: ["output-format-six-headings"], apply: edit("protocol", "      → PE ruling required.\n", "      → PE ruling required.\n  WITHDRAWN  [§n] <finding>\n") },
  { label: "Output format: NOTE and DISCLOSE headings swapped", file: "protocol", flips: ["output-format-six-headings"], apply: edit("protocol", "DISCLOSE\n  [§n] <finding> — <exact language to add>\n\nNOTE\n  [§n] <finding>\n", "NOTE\n  [§n] <finding>\n\nDISCLOSE\n  [§n] <finding> — <exact language to add>\n") },
  { label: "datum.md: back to logging it RESOLVED", file: "agent", flips: ["agent-withdrawn-is-the-one-name"], apply: edit("agent", "log it `WITHDRAWN`.", "log it `RESOLVED`.") },
  { label: "datum.md: RESOLVED in the Output section", file: "agent", flips: ["agent-withdrawn-is-the-one-name"], apply: edit("agent", "If a section produced nothing, say so in one line.", "If a section produced nothing, say so in one line. List withdrawn items under RESOLVED.") },
  // one PROTOCOL_VERSION line, the one the runner reads (fix wave 2: m-10)
  { label: "protocol: a malformed version line above the real one", file: "protocol", flips: ["protocol-version-is-the-runners"], apply: edit("protocol", /^PROTOCOL_VERSION: /m, "PROTOCOL_VERSION: draft\nPROTOCOL_VERSION: ") },
  { label: "protocol: a second well-formed version line, further down", file: "protocol", flips: ["protocol-version-is-the-runners"], apply: edit("protocol", "## Audience\n", "## Audience\n\nPROTOCOL_VERSION: 2026-01-01.1\n") },
  { label: "protocol: the version without its suffix", file: "protocol", flips: ["protocol-version-is-the-runners"], apply: edit("protocol", /^(PROTOCOL_VERSION: \d{4}-\d{2}-\d{2})\.\d+$/m, "$1") },
  { label: "protocol: a bulleted lowercase version line above (the runner would skip it)", file: "protocol", flips: ["protocol-version-is-the-runners"], apply: edit("protocol", /^PROTOCOL_VERSION: /m, "- protocol_version: old\n\nPROTOCOL_VERSION: ") },
  { label: "protocol: the version line removed", file: "protocol", flips: ["protocol-version-is-the-runners"], apply: edit("protocol", /^PROTOCOL_VERSION: .*\n/m, "") },
  { label: "runner: the reader keeps only the date", file: "runner", flips: ["protocol-version-is-the-runners"], apply: edit("runner", "/^PROTOCOL_VERSION:\\s*(\\S+)$/m.exec(", "/^PROTOCOL_VERSION:\\s*(\\d{4}-\\d{2}-\\d{2})/m.exec(") },
  { label: "runner: the reader reads another key", file: "runner", flips: ["protocol-version-is-the-runners"], apply: edit("runner", "/^PROTOCOL_VERSION:\\s*(\\S+)$/m.exec(", "/^VERSION:\\s*(\\S+)$/m.exec(") },
  { label: "runner: the reader no longer returns from the regex", file: "runner", flips: ["protocol-version-is-the-runners"], apply: edit("runner", "?.[1] ?? \"unknown\";", "?.[0] ?? \"unknown\";") },
  { label: "protocol: PROTOCOL_VERSION named mid-sentence in prose stays green", file: "protocol", flips: [], apply: edit("protocol", "Two roles.\n", "Two roles. Every log entry carries the PROTOCOL_VERSION above.\n") },
  // the spec's GET row names the read contract's keys (fix wave 2: m-7)
  { label: "spec: questions[] back in the GET row", file: "spec", flips: ["spec-get-row-is-the-contract"], apply: edit("spec", "findings[], dispositions[] }`, audience-filtered", "findings[], dispositions[], questions[] }`, audience-filtered") },
  { label: "spec: runId dropped from the GET row", file: "spec", flips: ["spec-get-row-is-the-contract"], apply: edit("spec", "latest run: `{ status, runId, revision,", "latest run: `{ status, revision,") },
  { label: "spec: the no-run answer drops rulesChanged", file: "spec", flips: ["spec-get-row-is-the-contract"], apply: edit("spec", "withheld: 0, rulesChanged: false, findings: []", "withheld: 0, findings: []") },
  { label: "spec: the no-run answer back to \"...\"", file: "spec", flips: ["spec-get-row-is-the-contract"], apply: edit("spec", "`{ status: \"none\", withheld: 0, rulesChanged: false, findings: [], coverage: [], dispositions: [] }`", "`{ status: \"none\", withheld: 0, ... }`") },
  { label: "contract: a questions key added to the read response", file: "contract", flips: ["spec-get-row-is-the-contract"], apply: edit("contract", "    rulesChanged: z.boolean(),\n", "    rulesChanged: z.boolean(),\n    questions: z.array(z.string()),\n") },
  { label: "contract: finishedAt made required", file: "contract", flips: ["spec-get-row-is-the-contract"], apply: edit("contract", "    finishedAt: z.string().nullable().optional(),", "    finishedAt: z.string().nullable(),") },
  { label: "contract: a key's definition wrapped across lines stays green", file: "contract", flips: [], apply: edit("contract", "    runId: z.string().uuid().optional(),", "    runId: z\n      .string()\n      .uuid()\n      .optional(),") },
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
  // Gates in words the first reading missed (fix wave 3, G3-1, G3-3): a finding set led by its adjective ("undisposed
  // findings", "Open items"), and completion said as submit, deliver, finalize/finalise, release, issue, sign-off,
  // stamp or "goes out". The five sentences in every file; each further word once.
  ...G3_1_GATES.flatMap((g) => [
    { label: `protocol: ${g}`, file: "protocol", flips: ["protocol-no-other-gate"], apply: edit("protocol", "## Logging\n\n", `## Logging\n\n${g}\n\n`) },
    { label: `datum.md: ${g}`, file: "agent", flips: ["agent-no-other-gate"], apply: edit("agent", "## Output\n", `## Output\n\n${g}\n`) },
    { label: `SKILL.md: ${g}`, file: "skill", flips: ["skill-no-other-gate"], apply: edit("skill", "Relay findings verbatim to the operator.", `${g} Relay findings verbatim to the operator.`) },
    { label: `redline.md: ${g}`, file: "redline", flips: ["redline-no-other-gate"], apply: edit("redline", "When you hand work to Datum:", `${g}\n\nWhen you hand work to Datum:`) },
  ]),
  { label: "protocol: finalize", file: "protocol", flips: ["protocol-no-other-gate"], apply: edit("protocol", "## Logging\n\n", "## Logging\n\nFinalize the study once every finding is disposed.\n\n") },
  { label: "datum.md: finalise, wrapped", file: "agent", flips: ["agent-no-other-gate"], apply: edit("agent", "## Output\n", "## Output\n\nThe engineer may finalise the study\nwhen no `CONTESTED` item is open.\n") },
  { label: "SKILL.md: released", file: "skill", flips: ["skill-no-other-gate"], apply: edit("skill", "Relay findings verbatim to the operator.", "A study is released with no outstanding findings. Relay findings verbatim to the operator.") },
  { label: "redline.md: issued", file: "redline", flips: ["redline-no-other-gate"], apply: edit("redline", "When you hand work to Datum:", "The letter is issued only when no `BLOCKER` is open.\n\nWhen you hand work to Datum:") },
  { label: "protocol: sign-off, hyphenated", file: "protocol", flips: ["protocol-no-other-gate"], apply: edit("protocol", "## Logging\n\n", "## Logging\n\nThe PE's sign-off waits until no `BLOCKER` is open.\n\n") },
  { label: "datum.md: stamped", file: "agent", flips: ["agent-no-other-gate"], apply: edit("agent", "## Output\n", "## Output\n\nA study is stamped once all findings are resolved.\n") },
  { label: "SKILL.md: goes out", file: "skill", flips: ["skill-no-other-gate"], apply: edit("skill", "Relay findings verbatim to the operator.", "The study goes out when no `DEFECT` is open. Relay findings verbatim to the operator.") },
  { label: "protocol: issue, the verb", file: "protocol", flips: ["protocol-no-other-gate"], apply: edit("protocol", "## Logging\n\n", "## Logging\n\nDo not issue the study while a `BLOCKER` is open.\n\n") },
  { label: "datum.md: release, the verb", file: "agent", flips: ["agent-no-other-gate"], apply: edit("agent", "## Output\n", "## Output\n\nRelease the study once no undecided items remain.\n") },
  { label: "redline.md: stamp, the verb", file: "redline", flips: ["redline-no-other-gate"], apply: edit("redline", "When you hand work to Datum:", "The PE may stamp the study when every finding is decided.\n\nWhen you hand work to Datum:") },
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
  // banned copy and the compound, in every spelling (fix wave 2: LAN-7, LAN-8, m-1)
  { label: "protocol: QA / QC, spaced, in §3", file: "protocol", flips: ["protocol-banned-copy"], apply: edit("protocol", "- Spot-check the signal list against the basemap.", "- Spot-check the signal list against the basemap as QA / QC.") },
  { label: "protocol: second&ndash;opinion in §4", file: "protocol", flips: ["protocol-banned-copy"], apply: edit("protocol", "letter is not defensible at that margin.", "letter is not defensible at that margin without a second&ndash;opinion.") },
  { label: "protocol: a ban-stating paragraph's opening reworded", file: "protocol", flips: ["protocol-banned-copy"], apply: edit("protocol", "**Label it accordingly.**", "**Label it so.**") },
  { label: "datum.md: QA-QC", file: "agent", flips: ["agent-banned-copy"], apply: edit("agent", "**You cannot edit.**", "**You cannot edit.** You are its QA-QC.") },
  { label: "datum.md: peer review, wrapped, with a Unicode hyphen", file: "agent", flips: ["agent-banned-copy"], apply: edit("agent", "Work the six sections in order:", "Work the six sections in order, as a peer\u2010\nreview would:") },
  { label: "datum.md: a ban-stating paragraph's opening reworded", file: "agent", flips: ["agent-banned-copy"], apply: edit("agent", "**Know what you are.**", "**Know yourself.**") },
  { label: "SKILL.md: QA-QC (no slash)", file: "skill", flips: ["skill-banned-copy"], apply: edit("skill", "- `DISCLOSE` — add the language to the deliverable.", "- `DISCLOSE` — add the language to the deliverable as QA-QC.") },
  { label: "SKILL.md: QA / QC, spaced", file: "skill", flips: ["skill-banned-copy"], apply: edit("skill", "Relay findings verbatim to the operator.", "Relay findings verbatim to the operator as QA / QC.") },
  { label: "SKILL.md: QA&mdash;QC", file: "skill", flips: ["skill-banned-copy"], apply: edit("skill", "Relay findings verbatim to the operator.", "Relay findings verbatim to the operator as QA&mdash;QC.") },
  { label: "protocol: audit in §3", file: "protocol", flips: ["protocol-banned-copy"], apply: edit("protocol", "- Spot-check the signal list against the basemap.", "- Spot-check the signal list against the basemap, as an audit would.") },
  { label: "datum.md: Auditor", file: "agent", flips: ["agent-banned-copy"], apply: edit("agent", "**You cannot edit.**", "**You cannot edit.** You are its Auditor.") },
  { label: "SKILL.md: audits", file: "skill", flips: ["skill-banned-copy"], apply: edit("skill", "Relay findings verbatim to the operator.", "Relay findings verbatim to the operator, as audits are.") },
  { label: "protocol: an &mdash; compound", file: "protocol", flips: ["protocol-no-blocker-unverified"], apply: edit("protocol", "## 6. Limitations disclosure", "Never a `BLOCKER` &mdash; `unverified`.\n\n## 6. Limitations disclosure") },
  { label: "protocol: a slash compound", file: "protocol", flips: ["protocol-no-blocker-unverified"], apply: edit("protocol", "- Spot-check the signal list against the basemap.", "- Spot-check the signal list against the basemap; a gap is `BLOCKER`/`unverified`.") },
  { label: "datum.md: a &#8212; compound", file: "agent", flips: ["agent-no-blocker-unverified"], apply: edit("agent", "Work the six sections in order:", "A gap is BLOCKER &#8212; unverified. Work the six sections in order:") },
  { label: "SKILL.md: a &#x2013; compound", file: "skill", flips: ["skill-no-blocker-unverified"], apply: edit("skill", "Relay findings verbatim to the operator.", "A gap is `BLOCKER` &#x2013; `unverified`. Relay findings verbatim to the operator.") },
  { label: "SKILL.md: a two-type list `BLOCKER`/`UNVERIFIED` stays green (not the compound)", file: "skill", flips: [], apply: edit("skill", "- `NOTE` — surface to the PE.", "- `NOTE` — surface to the PE; never a `BLOCKER`/`UNVERIFIED`.") },
  { label: "protocol: the permitted description restated stays green", file: "protocol", flips: [], apply: edit("protocol", "- Spot-check the signal list against the basemap.", "- Spot-check the signal list against the basemap: an internal consistency and traceability check.") },
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
  const wrong = now.filter((id) => teeth.get(id).on !== m.file && !(teeth.get(id).reads ?? []).includes(m.file));
  ok(wrong.length === 0, `teeth: "${m.label}" is caught only by checks about ${m.file} or reading it${wrong.length ? ` (also: ${wrong.join(", ")})` : ""}`);
}
const covered = new Set(MUTATIONS.flatMap((m) => m.flips));
const toothless = ids.filter((id) => !covered.has(id));
ok(toothless.length === 0, `every section-10 check has a mutation proving it has teeth${toothless.length ? ` (none for: ${toothless.join(", ")})` : ""}`);

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
