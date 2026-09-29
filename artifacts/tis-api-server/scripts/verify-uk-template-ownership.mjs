// UK template ownership: the Velocity TA format is Velocity's own house style,
// so only Velocity's firm account may render in it. Every other UK study —
// another firm's, or an anonymous render — gets the neutral UK TA under the
// requesting firm's own name, and must carry no Velocity identity anywhere
// (text, PDF metadata, palette, cover furniture or figure colours) and no
// Velocity wording (no shared sentence, no shared 7-word run; see (E)). It
// prints for every UK nation, so London-only and England-only guidance is
// always qualified (and never named in a heading, in any capitalisation), and
// every signed-in route that renders a study must say whose study it is
// (firmId). Its Confidence Grades and Standards section prints only its
// approved wording, no sentence anywhere claims a complete set of standards or
// sources, and no heading names persons or sits over a figure of another unit.
// Velocity's template is kept exactly as it is (V): its render is pinned
// byte-identical to the pre-ownership output (origin/main 388e8e4) for
// London, Manchester, Glasgow and Edinburgh, each as a vehicular retail, a
// vehicular office (LU 710) and a pedestrian study. What the neutral TA does
// differently for a nation (its standards table lists only the entries that
// apply in the site's home nation) lives in its own providers and never in the
// shared registry Velocity's template prints.
// Renders the FL fixture relocated to those four places (the City of London
// as check:theme-default-identity does) with `fetch` stubbed offline.
// Run: node ./scripts/verify-uk-template-ownership.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";
import { pdfHash } from "./lib/pdf-norm.mjs";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs");
const ts = require("typescript");
const here = path.dirname(fileURLToPath(import.meta.url));

// Production firms.id of Velocity's account (firms table, name "Velocity").
const VELOCITY_FIRM_ID = "8dbb7a24-ba2b-46a5-a764-8892657bff68";
// (V) pdfHash of every Velocity render, recorded on origin/main 388e8e4 (UK
// template selection not yet firm-aware), with `fetch` stubbed offline. The
// owner's instruction is to keep Velocity's template as it is, so none of
// these may move: a change meant for the neutral TA that moves one belongs in
// the neutral TA's own template or providers instead.
const VELOCITY_PINS = {
  "London/retail": "774ee235ac584f1e7e5e00ce51db55e8011ebbc08ef26934089f03448867ce9b",
  "London/office": "424c1d5b0bb9a21b96af80d62c68d982fbf679bfa40789b1ee97018eaddd4dd2",
  "London/pedestrian": "6606ffa61bf6eb32f5ba64d454c912c45a3e85c76e1b34eaefbb534479b17b9b",
  "Manchester/retail": "61b2396558bc6da157a5e53b9b78484340d40819f5c459c895037ac408a28753",
  "Manchester/office": "df7c04ddc3dbd672c2dcdff1f45ea355a82aa1cfc377c3bf7f13d0f52c99e6ea",
  "Manchester/pedestrian": "57c35b7189fbf7db7fb62555f01186d628b889d23a7b7efa7cb9dd15d0d2bf6e",
  "Glasgow/retail": "61b2396558bc6da157a5e53b9b78484340d40819f5c459c895037ac408a28753",
  "Glasgow/office": "df7c04ddc3dbd672c2dcdff1f45ea355a82aa1cfc377c3bf7f13d0f52c99e6ea",
  "Glasgow/pedestrian": "57c35b7189fbf7db7fb62555f01186d628b889d23a7b7efa7cb9dd15d0d2bf6e",
  "Edinburgh/retail": "61b2396558bc6da157a5e53b9b78484340d40819f5c459c895037ac408a28753",
  "Edinburgh/office": "df7c04ddc3dbd672c2dcdff1f45ea355a82aa1cfc377c3bf7f13d0f52c99e6ea",
  "Edinburgh/pedestrian": "57c35b7189fbf7db7fb62555f01186d628b889d23a7b7efa7cb9dd15d0d2bf6e",
};
// (V) The same commit's Velocity template object (sha256 of its JSON) and
// CHART_COLORS, the colours sampled from Velocity's filed TA.
const VELOCITY_TEMPLATE_SHA256 = "db8f1b871b128a8c11f76fd5334d0ee96bcf21445dc9806557a6b9b23e541c78";
const CHART_COLORS_PIN = '{"inbound":"#FC8460","outbound":"#60C09C","caption":"#6FA840","line":"#5A8FBf","grid":"#D9D9D9","axis":"#595959","baseline":"#9CA3AF"}';
const VELOCITY_FIRM = { name: "Velocity", logoUrl: null, firmId: VELOCITY_FIRM_ID };
const OTHER_FIRM = { name: "Harbour Street Transport Ltd", logoUrl: null, firmId: "0f2c9a4e-6b1d-4c8e-9f3a-5d7e1b2c4a60", website: "www.harbourstreet.example" };
const ANON_FIRM = { name: "Ownership Check Firm", logoUrl: null };
const CLIENT_NAME = "Aldgate Estates Ltd";
const CITY_OF_LONDON = { siteLat: "51.5136", siteLon: "-0.0866" };
const MANCHESTER = { siteLat: "53.4808", siteLon: "-2.2426" };
const GLASGOW = { siteLat: "55.8609", siteLon: "-4.2514" };
const EDINBURGH = { siteLat: "55.9533", siteLon: "-3.1883" };
/** Every UK place rendered, with its home nation. */
const SITES = {
  London: { coords: CITY_OF_LONDON, nation: "ENG" },
  Manchester: { coords: MANCHESTER, nation: "ENG" },
  Glasgow: { coords: GLASGOW, nation: "SCT" },
  Edinburgh: { coords: EDINBURGH, nation: "SCT" },
};
const IDENTITY_RE = /velocity|velocity-tp|gracechurch/gi;
const BANNED_RE = /\b(HCM|Highway Capacity Manual|ITE|validated|accurate|AI)\b/i;
// Wording the neutral TA must never print, in any branch or anywhere in a
// render: Chapter 4 describes the pedestrian-comfort method (PCL in London;
// elsewhere whatever the highway or roads authority accepts) but sets none out
// for Manchester, Glasgow or Edinburgh, so nothing is "assessed in" it and no
// method is "set out" there; when the request supplies a consultant profile
// the figure's profile is not the use-class default; and the standards table
// is not every standard the screening applies, nor every source the report
// cites (the two earlier lead-ins). The standards section as a whole is also
// held to its approved wording (CONF_SECTION_BLOCKS, confidenceSectionShape),
// and no other sentence may claim a complete set (COMPLETE_SET_RE).
const FALSE_PHRASES = [
  "assessed in Chapter 4", "method is set out here", "method set out in Chapter 4",
  "within-day profile for this use class",
  "standards this screening applies", "sources this report cites",
];
// The only two things the neutral TA may print between the confidence-grades
// table and the next chapter, word for word: the lead-in above the standards
// table (it prints only above one, and says the table is not complete), or the
// note that stands in for both when the register holds nothing for the site's
// nation and study type (a Scottish pedestrian study).
const REG_TABLE_HEADER = "Code Standard Edition Effective";
const APPROVED_REG_LEAD_IN = "The table below gives the edition of the policy, guidance and data sources recorded for the site's location and this type of study. It is not a complete list of the documents this report names.";
const APPROVED_REG_NONE_NOTE = "No edition table is given for the site's location and this type of study; the policy, guidance and data sources that apply, and their editions, are confirmed at submittal.";
// The whole "Confidence Grades and Standards" section, from its heading to the
// next chapter: its opening prose, the three metric tiles, the confidence
// table, then either the lead-in, the standards table and the register's
// status rows, or the no-table note. Nothing else: no other sentence, note,
// figure or table, before, between or after them. Pinned block for block in
// the template (every branch) and segment for segment in every render.
const CONF_HEADING = "Confidence Grades and Standards";
const APPROVED_CONF_INTRO = "The table below grades the main inputs to this screening for confidence and gives the basis for each grade. The report is written for review and sign-off by a chartered engineer; where the For submittal column names further evidence, that evidence is needed before the assessment is submitted.";
const CONF_TABLE_HEADER = "Component Confidence Basis For submittal";
const CONF_SECTION_BLOCKS = [
  { kind: "prose", text: APPROVED_CONF_INTRO },
  { kind: "metrics", provider: "accuracyOverallByNation" },
  { kind: "table", provider: "accuracy" },
  {
    kind: "if",
    flag: "hasRegulationsByNation",
    then: [
      { kind: "prose", text: APPROVED_REG_LEAD_IN },
      { kind: "table", provider: "regulationsByNation" },
      { kind: "keyvalue", provider: "regulationStatus" },
    ],
    else: [{ kind: "note", text: APPROVED_REG_NONE_NOTE }],
  },
];
// The metric tiles' labels (8pt, letter-spaced) and the regulationStatus rows as printed.
const CONF_METRIC_LABELS = "STUDYCONFIDENCESTUDYTYPESTANDARDSASOF";
const REG_STATUS_RE = /^Standards verified [A-Z][a-z]+ \d{4} Next review due [A-Z][a-z]+ \d{4} Currency (Current|Review overdue — verify editions)$/;
// A sentence claiming the report lists a complete set of standards, sources or
// documents. The approved texts above are the only ones allowed to talk about
// the set at all (and say it is not complete); anywhere else in a render or the
// template, such a sentence fails.
const COMPLETE_SET_RE = /\b(standards?|sources?|documents?)\b[^.;]*\b(listed|lists|complete|every|all|full|entire|exhaustive|comprehensive)\b|\b(listed|lists|complete|every|all|full|entire|exhaustive|comprehensive)\b[^.;]*\b(standards?|sources?|documents?)\b/i;
const APPROVED_SET_TEXTS = [APPROVED_CONF_INTRO, APPROVED_REG_LEAD_IN, APPROVED_REG_NONE_NOTE];
/** Sentences of `text`, less the approved texts, that claim a complete set. */
const completeSetClaims = (text) => APPROVED_SET_TEXTS.reduce((acc, a) => acc.split(a).join(" \n "), text)
  .split(/(?<=[.!?])\s+|\n/).filter((s) => COMPLETE_SET_RE.test(s));
// 6.2: the figure plots vehicles on site for a vehicular study and pedestrians
// for a pedestrian one, so the heading names neither; the figure's title, axis
// label and caption, or (with no within-day profile) the note, name the one
// the study counts.
const SEC62_HEADING = "6.2 Accumulation on Site Through the Day";
const SEC62 = {
  vehicular: {
    unit: "vehicles",
    figure: "Figure: Daily Vehicle-Trip Accumulation",
    note: "The number of vehicles on site through the day is estimated at submittal from the within-day profile described in Section 2.1.",
  },
  pedestrian: {
    unit: "pedestrians",
    figure: "Figure: On-Site Pedestrian Accumulation",
    note: "The number of pedestrians on site through the day is estimated at submittal from the within-day profile described in Section 2.1.",
  },
};
// No heading of the neutral TA names persons: its only accumulation figure
// plots vehicles in a vehicular study (Velocity's "Daily Person Accumulation"
// heading is theirs), and a heading prints for every study type.
const PERSON_HEADING_RE = /\bpersons?\b|person accumulation|daily person/i;
// A figure's unit (from its caption) and the units a section heading above it
// may not name: a vehicle figure under a heading about persons, people or
// pedestrians, or a pedestrian figure under one about vehicles, is mislabelled.
const FIGURE_UNITS = [
  { caption: /\bvehicles?\b|\bvehicle-trip/i, heading: /\b(persons?|people|pedestrians?)\b/i },
  { caption: /\bpedestrians?\b|\bpersons?\b/i, heading: /\bvehicles?\b|\bvehicle-trip|\btraffic\b/i },
];
// London-only guidance, bodies and places: every sentence naming one must say
// it applies in London. (Not "GLA": it also prints as the retail floor-area
// unit, gross leasable area.) Case-insensitive: a heading prints in capitals,
// and "Transport For London" is still TfL.
const LONDON_ONLY_RE = /\b(TfL|Transport for London|TLRN|Greater London Authority|Mayor of London|Mayor's Transport Strategy|London Plan|London Borough|City of London|Healthy Streets|Active Travel Zone|ATZ|Pedestrian Comfort Level|Pedestrian Comfort Guidance|PCL|WebCAT|PTAL|Public Transport Access(ibility)? Level|Londoners|ULEZ|Ultra Low Emission Zone|London Underground|London Overground|Docklands Light Railway|DLR|Elizabeth line)\b/i;
const LONDON_QUALIFIER_RE = /\b(in|for sites in) (Greater )?London\b/i;
// England-only policy and instruments: Scotland, Wales and Northern Ireland set
// their own national planning policy and have their own planning and highway
// agreements, so every sentence naming one must say where it applies.
const ENGLAND_ONLY_RE = /\b(NPPF|National Planning Policy Framework|PPG|Planning Practice Guidance|Section 106|Section 278|S106|S278|Local Plan)\b/i;
const ENGLAND_QUALIFIER_RE = /\bin England\b|\bor the local equivalent\b/i;
// The copyright line the neutral TA prints on its Document Control Sheet (brand.copyright).
const NEUTRAL_COPYRIGHT = (firm) => `© ${firm}. All rights reserved.`;

let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };

/**
 * Page texts (items joined in content-stream order), the Info dictionary,
 * every RGB colour the content streams set (fill or stroke, lower-case hex:
 * pdfjs resolves PDFKit's `r g b scn` / `SCN` under DeviceRGB to these ops),
 * and the body text items of every page in order with their font size, less
 * blank items and the page footers (7.5pt, set inside the 50pt bottom margin:
 * a 7.5pt figure caption above it is kept).
 */
async function readPdf(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true }).promise;
  const { info, metadata } = await doc.getMetadata();
  const pages = [];
  const colours = new Set();
  const items = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ").trim());
    for (const it of tc.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const size = Math.round(Math.hypot(it.transform[2], it.transform[3]) * 100) / 100;
      if (!(size === 7.5 && it.transform[5] < 50)) items.push({ str: it.str, size });
    }
    const ol = await page.getOperatorList();
    ol.fnArray.forEach((fn, k) => {
      if (fn === pdfjs.OPS.setFillRGBColor || fn === pdfjs.OPS.setStrokeRGBColor) colours.add(String(ol.argsArray[k][0]).toLowerCase());
    });
  }
  await doc.destroy();
  return { pages, text: pages.join("\n"), items, info, colours, meta: JSON.stringify(info) + (metadata ? JSON.stringify(metadata.getAll()) : "") };
}

const joinItems = (xs) => xs.map((x) => x.str).join(" ").replace(/\s+/g, " ").trim();

/**
 * What the render prints after the confidence-grades table (9pt cells under
 * the bold "Component Confidence Basis For submittal" header) and before the
 * next 9pt table or 17pt chapter heading: exactly the standards lead-in or the
 * note in its place. `next` says which follows ("table" / "heading").
 */
function standardsLeadIn(pdf) {
  const xs = pdf.items;
  const start = xs.findIndex((x, k) => x.size === 9 && x.str === "Component" && xs[k + 1]?.str === "Confidence" && xs[k + 2]?.str === "Basis");
  if (start < 0) return null;
  let k = start;
  while (k < xs.length && xs[k].size === 9) k++;
  const run = [];
  while (k < xs.length && xs[k].size !== 9 && xs[k].size !== 17) run.push(xs[k++]);
  const next = xs[k]?.size === 9 ? "table" : xs[k]?.size === 17 ? "heading" : "end";
  return { text: joinItems(run), next, after: joinItems(xs.slice(k, k + 4)) };
}

/**
 * A section as printed, from its 11.5pt heading `title` to the next chapter
 * heading (17pt "N.0"), as runs of one kind of item: "metric" (a tile: its
 * value, drawn at up to 19pt, then its 8pt label), "table" (9pt cells),
 * "prose" (10pt: prose, bullets and key/value rows), "note" (9.5pt: notes and
 * figure captions) and "other" (anything else, e.g. a heading or a chart's
 * axis text). Each run has its text; a metric run also its labels and values.
 */
function sectionRuns(pdf, title) {
  const xs = pdf.items;
  const start = xs.findIndex((x) => x.size === 11.5 && x.str === title);
  if (start < 0) return null;
  const runs = [];
  for (let k = start + 1; k < xs.length && !(xs[k].size === 17 && /^\d+\.0$/.test(xs[k].str)); k++) {
    const x = xs[k];
    const kind = x.size === 8 || xs[k + 1]?.size === 8 ? "metric" : x.size === 9 ? "table" : x.size === 10 ? "prose" : x.size === 9.5 ? "note" : "other";
    const last = runs[runs.length - 1];
    if (last?.kind === kind) last.items.push(x);
    else runs.push({ kind, items: [x] });
  }
  return runs.map(({ kind, items }) => ({
    kind,
    text: joinItems(items),
    ...(kind === "metric" ? { labels: items.filter((x) => x.size === 8).map((x) => x.str).join("").replace(/\s/g, ""), values: items.filter((x) => x.size !== 8).length } : {}),
  }));
}

/**
 * Whether the Confidence Grades and Standards section is exactly its approved
 * shape: opening prose, three metric tiles, the confidence table, then (with a
 * standards table) the lead-in, the table and the register's status rows, or
 * (without one) the no-table note. Returns the runs as printed when it is not.
 */
function confidenceSectionShape(pdf, withTable, title = CONF_HEADING) {
  const runs = sectionRuns(pdf, title);
  const want = [
    (r) => r.kind === "prose" && r.text === APPROVED_CONF_INTRO,
    (r) => r.kind === "metric" && r.labels === CONF_METRIC_LABELS && r.values === 3,
    (r) => r.kind === "table" && r.text.startsWith(`${CONF_TABLE_HEADER} `),
    ...(withTable
      ? [
          (r) => r.kind === "prose" && r.text === APPROVED_REG_LEAD_IN,
          (r) => r.kind === "table" && r.text.startsWith(`${REG_TABLE_HEADER} `),
          (r) => r.kind === "prose" && REG_STATUS_RE.test(r.text),
        ]
      : [(r) => r.kind === "note" && r.text === APPROVED_REG_NONE_NOTE]),
  ];
  const good = runs !== null && runs.length === want.length && want.every((f, i) => f(runs[i]));
  return { good, runs };
}

/** Every section (11.5pt) and chapter (17pt, less metric values) heading a render prints. */
function headingsOf(pdf) {
  const xs = pdf.items;
  const out = [];
  for (let k = 0; k < xs.length; k++) {
    const size = xs[k].size;
    if (!(size === 11.5 || (size === 17 && xs[k + 1]?.size !== 8))) continue;
    const run = [];
    let j = k;
    while (j < xs.length && xs[j].size === size && xs[j + 1]?.size !== 8) run.push(xs[j++]);
    if (run.length) { out.push(joinItems(run)); k = j - 1; }
  }
  return out;
}

/** Each figure caption ("Figure: …") with the section heading (11.5pt) it sits under. */
function figuresUnderHeadings(pdf) {
  const xs = pdf.items;
  const out = [];
  let heading = null;
  for (let k = 0; k < xs.length; k++) {
    if (xs[k].size === 11.5) {
      const run = [];
      while (k < xs.length && xs[k].size === 11.5) run.push(xs[k++]);
      k--;
      heading = joinItems(run);
    } else if (xs[k].size === 17 && /^\d+\.0$/.test(xs[k].str)) heading = null;
    else if (xs[k].str.startsWith("Figure:")) out.push({ heading, figure: xs[k].str });
  }
  return out;
}

/** Figures whose section heading names a unit the figure does not plot. */
const mislabelledFigures = (pdf) => figuresUnderHeadings(pdf).filter(({ heading, figure }) =>
  FIGURE_UNITS.some((u) => u.caption.test(figure) && u.heading.test(heading ?? "")));

/** Section 6.2 as printed: its 11.5pt heading, and everything up to the 6.3 heading. */
function section62(pdf) {
  const xs = pdf.items;
  const start = xs.findIndex((x) => x.size === 11.5 && /^6\.2\b/.test(x.str));
  if (start < 0) return null;
  let k = start;
  while (k < xs.length && xs[k].size === 11.5) k++;
  const heading = joinItems(xs.slice(start, k));
  const body = [];
  while (k < xs.length && !(xs[k].size === 11.5 && /^6\.3\b/.test(xs[k].str))) body.push(xs[k++]);
  return { heading, body: joinItems(body) };
}

/** Sentences of a render's text (split after . ! or ?) that name `re` without matching `qualifier`. */
const unqualifiedIn = (text, re, qualifier) => text.split(/(?<=[.!?])\s+/).filter((x) => re.test(x) && !qualifier.test(x));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hits = (s) => [...s.matchAll(IDENTITY_RE)].map((m) => m[0]);
const hex = (c) => String(c).toLowerCase();

/** The FL fixture as an office (LU 710) study with no consultant profile — the case the UK office curve serves. */
function officeVariant(p) {
  const r = JSON.parse(JSON.stringify(p.resultPayload));
  r.tripGeneration = { ...r.tripGeneration, landUseCode: "710", landUseName: "General Office Building" };
  if (r.request) delete r.request.tripProfile;
  return { ...p, landUseCode: "710", requestPayload: r.request, resultPayload: r };
}

/** The same study as a pedestrian study (request.focus, which detectStudyType reads). */
function pedestrianVariant(p) {
  const r = JSON.parse(JSON.stringify(p.resultPayload));
  r.request = { ...r.request, focus: "pedestrian" };
  return { ...p, requestPayload: r.request, resultPayload: r };
}

/** The same study with the request naming its client (the field the themed renderer's tok.client reads). */
const withClient = (p, clientName) => ({ ...p, requestPayload: { ...p.requestPayload, clientName } });

/** Every chapter and section title of a template. */
const titlesOf = (t) => t.chapters.flatMap((c) => [c.title, ...c.sections.map((s) => s.title)]).filter(Boolean);

/** Every string anywhere in a value (a template: its text, titles and brand furniture). */
const allStrings = (o, out = []) => {
  if (typeof o === "string") out.push(o);
  else if (Array.isArray(o)) o.forEach((x) => allStrings(x, out));
  else if (o && typeof o === "object") Object.values(o).forEach((x) => allStrings(x, out));
  return out;
};

// ── (E) Copied-text guard ─────────────────────────────────────────────────
// Text is compared as lower-case words; a `{{path|fmt}}` token is one word
// (it prints the same value in either template), punctuation is dropped.
const detok = (s) => String(s).replace(/\{\{\s*([\w.]+)[^}]*\}\}/g, (_m, p) => ` tok_${p.replace(/\./g, "_")} `);
const words = (s) => detok(s).toLowerCase().match(/[a-z0-9_]+/g) ?? [];
/** Sentences (split on . ! ? ; : before a space or the end) of at least five words, normalised. */
const sentencesOf = (strs) => strs.flatMap((s) => detok(s).split(/[.!?;:](?=\s|$)/)).map((x) => words(x).join(" ")).filter((x) => x.split(" ").length >= 5);
const GRAM = 7;
const gramsOf = (s) => { const w = words(s); const g = []; for (let i = 0; i + GRAM <= w.length; i++) g.push(w.slice(i, i + GRAM).join(" ")); return g; };

/**
 * String literals in a source file's named functions and VELOCITY_* consts —
 * the Velocity furniture the hand-coded renderer and the engine draw. Each
 * template-literal part is its own string, so a run never bridges a `${…}`.
 */
function furnitureStrings(file, fnNames, fnPrefix) {
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = [];
  const found = new Set();
  const lits = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text);
    ts.forEachChild(node, lits);
  };
  const visit = (node) => {
    const fn = ts.isFunctionDeclaration(node) && node.name ? node.name.text : null;
    const vr = ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) ? node.name.text : null;
    if (fn && (fnNames.includes(fn) || (fnPrefix && fn.startsWith(fnPrefix)))) { found.add(fn); lits(node); return; }
    if (vr && vr.startsWith("VELOCITY_")) { found.add(vr); if (node.initializer) lits(node.initializer); return; }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { strings: out, found };
}

/** Every prose / note string of a template, with each `if` branch included (the fixture renders only some). */
function templateTexts(t) {
  const out = [];
  const blocks = (bs) => { for (const b of bs ?? []) { if (b.kind === "prose" || b.kind === "note") out.push(b.text); if (b.kind === "bullets") out.push(...b.items); if (b.kind === "if") { blocks(b.then); blocks(b.else); } } };
  for (const ch of t.chapters) { if (ch.intro) out.push(ch.intro); for (const s of ch.sections) blocks(s.blocks); }
  return out;
}

/**
 * Assert a UK render is the neutral TA, fully under `firm`'s name, with no
 * Velocity identity; `client` is the client name the request supplied, if any;
 * `kind` the study type ("vehicular" / "pedestrian"), `nation` the site's home
 * nation ("ENG" / "SCT") and `london` whether the site is in London.
 */
async function assertNeutral(label, buf, firm, { client = null, chartColours, kind = "vehicular", nation = "ENG", london = true } = {}) {
  const pdf = await readPdf(buf);
  const { pages, text, info, meta } = pdf;
  const n = esc(firm.name);
  ok(hits(text).length === 0, `${label}: no velocity / velocity-tp / Gracechurch in the text (${hits(text).length}${hits(text).length ? `: ${hits(text).slice(0, 3).join(", ")}` : ""})`);
  ok(hits(meta).length === 0, `${label}: no velocity / velocity-tp / Gracechurch in the PDF metadata (${hits(meta).length})`);
  ok(info.Author === firm.name, `${label}: PDF Author is the requesting firm (${info.Author})`);
  ok(new RegExp(`PREPARED BY ${n}`).test(pages[0]), `${label}: cover PREPARED BY names the firm`);
  ok(new RegExp(`Prepared By ${n}`).test(text), `${label}: Document Control Sheet Prepared By names the firm`);
  ok(text.includes(NEUTRAL_COPYRIGHT(firm.name)), `${label}: (B) the © line is the neutral TA's own, under the firm's name`);
  ok(!/may be reproduced/i.test(text), `${label}: (B) no Velocity reproduction notice ("may be reproduced") anywhere`);
  const body = pages.slice(2);
  ok(body.length > 0 && body.every((p) => new RegExp(`${n} · Transport Assessment · .* · Page \\d+`).test(p)), `${label}: every numbered page's footer names the firm`);
  if (firm.website) ok(pages[0].includes(firm.website), `${label}: cover prints the firm's own website`);
  else ok(pages[0].endsWith(firm.name), `${label}: no URL on the cover when the firm has none`);

  // (c) The preparing firm is never also printed as the client; a supplied
  // client is; with none supplied there is no Client row at all.
  const dcs = pages.find((p) => p.startsWith("Document Control Sheet")) ?? "";
  ok(dcs !== "", `${label}: the Document Control Sheet is present`);
  ok(!new RegExp(`CLIENT ${n}`).test(pages[0]) && !new RegExp(`Client ${n}`).test(dcs), `${label}: (c) the Client row never shows the preparing firm's own name`);
  if (client) {
    ok(new RegExp(`CLIENT ${esc(client)} PREPARED BY`).test(pages[0]), `${label}: (c) cover CLIENT row shows the supplied client "${client}"`);
    ok(new RegExp(`Client ${esc(client)}`).test(dcs), `${label}: (c) Document Control Sheet Client row shows the supplied client`);
  } else {
    ok(!/\bCLIENT\b/.test(pages[0]) && !/\bClient\b/.test(dcs), `${label}: (c) no client supplied, so no Client row on the cover or the Document Control Sheet`);
  }

  // (e) The false sentences the neutral TA used to print.
  for (const p of FALSE_PHRASES) ok(!text.includes(p), `${label}: (e) the render does not say "${p}"`);

  // The standards lead-in is one of the two approved texts, word for word:
  // above a table, the lead-in (and the table's header follows it); with no
  // table, the note (and the next chapter follows it). Any other wording, any
  // extra sentence, or a lead-in with no table under it fails.
  const lead = standardsLeadIn(pdf);
  const hasTable = text.includes(REG_TABLE_HEADER);
  const leadOk = lead !== null && (hasTable
    ? lead.next === "table" && lead.after === REG_TABLE_HEADER && lead.text === APPROVED_REG_LEAD_IN
    : lead.next === "heading" && lead.text === APPROVED_REG_NONE_NOTE);
  ok(leadOk, `${label}: the standards ${hasTable ? "lead-in is the approved lead-in, above the table" : "note is the approved no-table note"}${leadOk ? "" : ` (printed: ${JSON.stringify(lead)})`}`);
  // The whole Confidence Grades and Standards section, heading to next
  // chapter, is the approved prose plus the metric tiles and the tables: a
  // false sentence before the metrics, after the standards table or anywhere
  // else in it fails.
  const conf = confidenceSectionShape(pdf, hasTable);
  ok(conf.good, `${label}: the ${CONF_HEADING} section prints only its approved prose, the three metric tiles and the ${hasTable ? "confidence and standards tables (with the register's status rows)" : "confidence table, then the no-table note"}${conf.good ? "" : ` (printed: ${JSON.stringify(conf.runs?.map((r) => `${r.kind}: ${r.text.slice(0, 70)}`))})`}`);
  // Nowhere else does a sentence claim the report lists every standard or source.
  const claims = completeSetClaims(text);
  ok(claims.length === 0, `${label}: no sentence outside the approved lead-in claims a listed or complete set of standards, sources or documents${claims.length ? ` (found: "${claims[0].slice(0, 90)}…")` : ""}`);

  // Headings: none names London-only or England-only guidance (a heading
  // carries no qualifier), or persons; and no figure sits under a heading that
  // names a unit it does not plot.
  const heads = headingsOf(pdf);
  const badHeads = heads.filter((h) => LONDON_ONLY_RE.test(h) || ENGLAND_ONLY_RE.test(h) || PERSON_HEADING_RE.test(h));
  ok(heads.length > 10 && badHeads.length === 0, `${label}: no printed heading (of ${heads.length}) names London-only or England-only guidance, or persons${badHeads.length ? ` (found: ${badHeads.map((h) => `"${h}"`).join(", ")})` : ""}`);
  ok(!/person accumulation|daily person/i.test(text), `${label}: the render never says "person accumulation"`);
  const figs = figuresUnderHeadings(pdf);
  const misfit = mislabelledFigures(pdf);
  ok(misfit.length === 0, `${label}: no figure (of ${figs.length}) sits under a heading naming a unit it does not plot${misfit.length ? ` (found: ${misfit.map((m) => `"${m.heading}" over "${m.figure}"`).join("; ")})` : ""}`);

  // 6.2: the approved heading; under it, the figure or the note for the study's own unit.
  const s62 = section62(pdf);
  const want = SEC62[kind];
  const other = SEC62[kind === "vehicular" ? "pedestrian" : "vehicular"];
  const s62Ok = s62 !== null && s62.heading === SEC62_HEADING && (s62.body === want.note
    || (s62.body.startsWith(`${want.figure} `) && s62.body.includes(`${want.unit} on site (est.)`) && new RegExp(`Peak ~[\\d,]+ ${want.unit} at \\d\\d:00`).test(s62.body)))
    && !s62.body.includes(other.unit) && !/person/i.test(s62.heading + s62.body);
  ok(s62Ok, `${label}: 6.2 is headed "${SEC62_HEADING}" and its ${s62?.body.startsWith("Figure:") ? "figure" : "note"} counts ${want.unit} (a ${kind} study)${s62Ok ? "" : ` (printed: ${JSON.stringify(s62)})`}`);

  // Outside London, every sentence naming London-only guidance, bodies or
  // places says it applies in London; outside England, every sentence naming
  // England-only policy says so, or names the local equivalent.
  if (!london) {
    const u = unqualifiedIn(text, LONDON_ONLY_RE, LONDON_QUALIFIER_RE);
    ok(u.length === 0, `${label}: every printed sentence naming London-only guidance says it applies in London${u.length ? ` (unqualified: "${u[0].slice(0, 90)}…")` : ""}`);
  }
  if (nation !== "ENG") {
    const u = unqualifiedIn(text, ENGLAND_ONLY_RE, ENGLAND_QUALIFIER_RE);
    ok(u.length === 0, `${label}: every printed sentence naming England-only policy says it applies in England${u.length ? ` (unqualified: "${u[0].slice(0, 90)}…")` : ""}`);
  }

  // (b) No Velocity-sampled chart colour is set anywhere in the content streams.
  const found = [...chartColours.velocity].filter((c) => pdf.colours.has(c));
  ok(found.length === 0, `${label}: (b) no CHART_COLORS value (sampled from Velocity's TA) in any fill/stroke colour op${found.length ? ` (found ${found.join(", ")})` : ""}`);
  return pdf;
}

/**
 * (d) Static: every renderStudyPdf call in src/routes whose firm stamp is
 * built where a firm record is in scope (a signed-in request) passes
 * `firmId: firm.id` — without it Velocity's own account would silently render
 * in the neutral format. Stamps built with no firm in scope are the anonymous
 * demo-preview renders, for which the neutral format is correct. A stamp the
 * check cannot see into (a call, a spread, a variable assigned anything other
 * than object literals) fails: pass the stamp as a literal.
 */
function checkRouteFirmIds() {
  const dir = path.resolve(here, "../src/routes");
  const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const bindsFirm = (name) =>
    (ts.isIdentifier(name) && name.text === "firm") ||
    ((ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) && name.elements.some((e) => !ts.isOmittedExpression(e) && bindsFirm(e.name)));
  /** A `firm` binding declared in an enclosing block, or a parameter of an enclosing function. */
  const firmInScope = (node) => {
    for (let a = node.parent; a; a = a.parent) {
      if ((ts.isBlock(a) || ts.isSourceFile(a)) && a.statements.some((s) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => bindsFirm(d.name)))) return true;
      if (ts.isFunctionLike(a) && a.parameters?.some((p) => bindsFirm(p.name))) return true;
    }
    return false;
  };
  const usesFirm = (node) => { let u = false; const v = (x) => { if (ts.isPropertyAccessExpression(x) && ts.isIdentifier(x.expression) && x.expression.text === "firm") u = true; ts.forEachChild(x, v); }; v(node); return u; };
  const enclosingFn = (node) => { let a = node.parent; while (a && !ts.isFunctionLike(a)) a = a.parent; return a; };
  const propInit = (lit, key) => {
    const p = lit.properties.find((q) => ts.isPropertyAssignment(q) && (ts.isIdentifier(q.name) || ts.isStringLiteral(q.name)) && q.name.text === key);
    return p ? p.initializer.getText() : null;
  };

  let authed = 0, anon = 0, calls = 0;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts")).sort()) {
    const sf = ts.createSourceFile(f, readFileSync(path.join(dir, f), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const sites = [];
    const find = (node) => { if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "renderStudyPdf") sites.push(node); ts.forEachChild(node, find); };
    find(sf);
    for (const call of sites) {
      calls++;
      const where = `src/routes/${f}:${lineOf(sf, call)}`;
      const arg = call.arguments[1];
      const literals = [];
      const opaque = [];
      if (arg && ts.isObjectLiteralExpression(arg)) literals.push(arg);
      else if (arg && ts.isIdentifier(arg)) {
        const scan = (x) => {
          if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(x.left) && x.left.text === arg.text) (ts.isObjectLiteralExpression(x.right) ? literals : opaque).push(x.right);
          if (ts.isVariableDeclaration(x) && ts.isIdentifier(x.name) && x.name.text === arg.text && x.initializer) (ts.isObjectLiteralExpression(x.initializer) ? literals : opaque).push(x.initializer);
          ts.forEachChild(x, scan);
        };
        const fn = enclosingFn(call);
        if (fn) scan(fn);
        if (!literals.length) opaque.push(arg);
      } else opaque.push(arg ?? call);
      for (const o of opaque) ok(false, `(d) ${where}: the firm stamp is not an object literal the check can read (${o.getText(sf).slice(0, 60)})`);
      for (const lit of literals) {
        const at = `src/routes/${f}:${lineOf(sf, lit)}`;
        const signedIn = firmInScope(lit) || usesFirm(lit);
        if (!signedIn) {
          anon++;
          ok(propInit(lit, "firmId") === null, `(d) ${at}: anonymous stamp (no firm in scope) carries no firmId, so it renders the neutral format`);
          continue;
        }
        authed++;
        const hidden = lit.properties.some((p) => ts.isSpreadAssignment(p) || ts.isShorthandPropertyAssignment(p));
        ok(propInit(lit, "firmId") === "firm.id" && !hidden, `(d) ${at}: signed-in stamp passes firmId: firm.id${propInit(lit, "firmId") === null ? " (MISSING — Velocity's account would drop to the neutral format)" : ""}`);
      }
    }
  }
  ok(calls > 0 && authed > 0, `(d) found ${calls} renderStudyPdf call(s) in src/routes: ${authed} signed-in stamp(s), ${anon} anonymous`);
}

const { mod, cleanup } = await loadRendererBundle([
  `export { TEMPLATE_OWNERS, ukTemplateIdForFirm, loadTemplate, validateTemplate } from "./report-template/registry";`,
  `export { applicableRegulations, REGULATIONS } from "./report-template/regulations";`,
  `export { nationScopedRegulations, UK_NATION_SCOPE } from "./report-template/uk-nations";`,
  `export { buildProviders } from "./report-template/providers";`,
  `export { REGIONS } from "./regions";`,
  `export { velocityTemplate } from "./report-template/templates/velocity";`,
  `export { paletteChartColors } from "./report-template/engine";`,
  `export { CHART_COLORS } from "./pdf-charts";`,
].join("\n"));
const realFetch = globalThis.fetch;
globalThis.fetch = () => Promise.reject(new Error("uk-template-ownership check: network disabled"));
try {
  const uk = { ...projectFromFixture(loadFixture("fl")), ...CITY_OF_LONDON };
  /** The study variants rendered at every site: [variant of the London study, study type]. */
  const VARIANTS = {
    retail: [(p) => p, "vehicular"],
    office: [officeVariant, "vehicular"],
    pedestrian: [pedestrianVariant, "pedestrian"],
    // An office study with no within-day profile under the neutral TA, as a pedestrian study (the 6.2 note's other branch).
    "office, pedestrian": [(p) => pedestrianVariant(officeVariant(p)), "pedestrian"],
  };
  const at = (site, variant) => VARIANTS[variant][0]({ ...uk, ...SITES[site].coords });

  // The ownership map is the single source of truth for who may render in Velocity's format.
  ok(mod.TEMPLATE_OWNERS["velocity-ta"] === VELOCITY_FIRM_ID, "registry: velocity-ta is owned by Velocity's firm account");
  ok(mod.ukTemplateIdForFirm(VELOCITY_FIRM_ID) === "velocity-ta", "registry: Velocity's firm id selects velocity-ta");
  for (const id of [OTHER_FIRM.firmId, null, undefined, ""]) ok(mod.ukTemplateIdForFirm(id) === "uk-ta", `registry: firm id ${JSON.stringify(id)} selects the neutral uk-ta`);

  // The neutral template's own words, every branch (the fixture exercises only some).
  const neutral = mod.loadTemplate("uk-ta");
  const vel = mod.velocityTemplate;
  const tplText = JSON.stringify(neutral);
  ok(hits(tplText).length === 0, "uk-ta: no Velocity identity in any block of the template");
  ok(!BANNED_RE.test(tplText), `uk-ta: template text avoids the banned report terms${BANNED_RE.test(tplText) ? ` (found "${tplText.match(BANNED_RE)[0]}")` : ""}`);
  // (e) at template level too: the 6.4 else-note is only drawn for a
  // non-vehicular study, so a vehicular render alone could not catch it.
  for (const p of FALSE_PHRASES) ok(!tplText.includes(p), `uk-ta: (e) no branch of the template says "${p}"`);
  // London-only guidance names London as where it applies (the TA prints for
  // Manchester, Birmingham, Leeds, Bristol, Glasgow and Edinburgh too).
  const sentences = templateTexts(neutral).flatMap((t) => t.split(/(?<=\.)\s+/));
  const unqualified = sentences.filter((s) => LONDON_ONLY_RE.test(s) && !LONDON_QUALIFIER_RE.test(s));
  ok(unqualified.length === 0, `uk-ta: every sentence naming London-only guidance says it applies in London${unqualified.length ? ` (unqualified: "${unqualified[0].slice(0, 90)}…")` : ""}`);
  // (C) Likewise England-only policy (NPPF, PPG, Section 106 / 278, Local Plan).
  const unqualifiedEng = sentences.filter((s) => ENGLAND_ONLY_RE.test(s) && !ENGLAND_QUALIFIER_RE.test(s));
  ok(unqualifiedEng.length === 0, `uk-ta: (C) every sentence naming England-only policy says it applies in England, or names the local equivalent${unqualifiedEng.length ? ` (unqualified: "${unqualifiedEng[0].slice(0, 90)}…")` : ""}`);
  // (D) A heading cannot carry a qualifier, so no title (nor the document
  // type or template name) may name London-only or England-only guidance, in
  // any capitalisation; and none names persons (see PERSON_HEADING_RE).
  const headingTexts = [neutral.name, neutral.documentType, ...titlesOf(neutral)];
  const regionalTitles = headingTexts.filter((x) => LONDON_ONLY_RE.test(x) || ENGLAND_ONLY_RE.test(x));
  ok(regionalTitles.length === 0, `uk-ta: (D) no chapter or section title names London-only or England-only guidance${regionalTitles.length ? ` (found: ${regionalTitles.map((x) => `"${x}"`).join(", ")})` : ""}`);
  const personTitles = headingTexts.filter((x) => PERSON_HEADING_RE.test(x));
  ok(personTitles.length === 0, `uk-ta: no chapter or section title names persons (the accumulation figure plots vehicles in a vehicular study)${personTitles.length ? ` (found: ${personTitles.map((x) => `"${x}"`).join(", ")})` : ""}`);
  // The London-only pattern knows the spelled-out names, in any capitalisation,
  // so a sentence or heading written that way is held to it too.
  const londonNames = ["Transport for London", "Transport For London", "TRANSPORT FOR LONDON", "Greater London Authority", "Mayor of London", "TLRN", "PTAL", "Pedestrian Comfort Guidance", "ULEZ", "London Underground", "Elizabeth line", "Elizabeth Line", "Tfl"];
  const englandNames = ["NPPF", "National Planning Policy Framework", "NATIONAL PLANNING POLICY FRAMEWORK", "Section 106", "SECTION 278", "Local Plan"];
  ok(londonNames.every((x) => LONDON_ONLY_RE.test(`The site is served by ${x}.`)) && !LONDON_ONLY_RE.test("85 1,000 sqft GLA"), `uk-ta: the London-only pattern matches the spelled-out names in any capitalisation (${londonNames.join(", ")}), and not the GLA floor-area unit`);
  ok(englandNames.every((x) => ENGLAND_ONLY_RE.test(`Under ${x}.`)), `uk-ta: the England-only pattern matches in any capitalisation (${englandNames.join(", ")})`);
  // The Confidence Grades and Standards section is its approved blocks, every
  // branch, word for word (the render-level shape check covers what prints).
  const canon = (o) => JSON.stringify(o, (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
  const confSections = neutral.chapters.flatMap((c) => c.sections).filter((s) => s.title === CONF_HEADING);
  ok(confSections.length === 1 && canon(confSections[0].blocks) === canon(CONF_SECTION_BLOCKS), `uk-ta: the ${CONF_HEADING} section is exactly its approved blocks: opening prose, metrics, confidence table, then the lead-in, standards table and status rows or the no-table note${confSections.length === 1 ? "" : ` (${confSections.length} sections so titled)`}`);
  // No sentence of any branch, outside the approved texts, claims a listed or complete set of standards or sources.
  const tplClaims = templateTexts(neutral).flatMap(completeSetClaims);
  ok(tplClaims.length === 0, `uk-ta: no sentence of any branch outside the approved lead-in claims a listed or complete set of standards, sources or documents${tplClaims.length ? ` (found: "${tplClaims[0].slice(0, 90)}…")` : ""}`);
  ok(COMPLETE_SET_RE.test("The standards this screening applies are listed below, each at its current edition.") && COMPLETE_SET_RE.test("It is the complete list of the documents this report names.") && COMPLETE_SET_RE.test("A full list of the sources is given below.") && completeSetClaims(`${APPROVED_REG_LEAD_IN} ${APPROVED_REG_NONE_NOTE}`).length === 0,
    "uk-ta: the complete-set pattern catches the earlier false lead-ins, and passes the approved texts");

  // Every provider and flag either template binds exists: the engine draws
  // nothing for an unknown provider and takes an unknown flag as false, so a
  // misspelt id would silently drop a table or pick the wrong branch.
  const reg = mod.buildProviders({ locale: "us" });
  const KIND_MAP = { table: "tables", metrics: "metrics", keyvalue: "keyvalues", chart: "charts" };
  const bindings = (t) => {
    const out = [];
    const walk = (bs) => { for (const b of bs ?? []) { if (KIND_MAP[b.kind]) out.push([KIND_MAP[b.kind], b.provider]); if (b.kind === "if") { out.push(["flags", b.flag]); walk(b.then); walk(b.else); } } };
    for (const ch of t.chapters) for (const s of ch.sections) walk(s.blocks);
    return out;
  };
  for (const [name, t] of [["uk-ta", neutral], ["velocity-ta", vel]]) {
    const missing = bindings(t).filter(([k, id]) => typeof reg[k]?.[id] !== "function");
    ok(missing.length === 0, `${name}: every provider and flag it binds exists${missing.length ? ` (missing: ${missing.map(([k, id]) => `${k}.${id}`).join(", ")})` : ""}`);
  }
  // (V) The nation filter is the neutral TA's own: it binds the *ByNation
  // standards providers and never the shared ones, and Velocity's template
  // binds none of them.
  const neutralIds = bindings(neutral).map(([, id]) => id);
  const STANDARDS_ID = /^(regulations|accuracyOverall|hasRegulations)/;
  const velIds = bindings(vel).map(([, id]) => id);
  ok(["accuracyOverallByNation", "regulationsByNation", "hasRegulationsByNation"].every((id) => neutralIds.includes(id)) && !neutralIds.some((id) => ["regulations", "accuracyOverall", "hasRegulations"].includes(id)),
    `uk-ta: (V) its standards table, "as of" date and lead-in flag are the nation-filtered providers (${neutralIds.filter((id) => STANDARDS_ID.test(id)).join(", ")})`);
  ok(!velIds.some((id) => /ByNation$/.test(id)), `velocity-ta: (V) binds no nation-filtered provider (${velIds.filter((id) => STANDARDS_ID.test(id)).join(", ")})`);

  // (C) The neutral TA's standards table lists the NPPF and PPG for English regions only.
  const ukRegions = Object.values(mod.REGIONS).filter((r) => r.country === "UK");
  const NATIONS = new Set(["ENG", "SCT", "WLS", "NIR"]);
  ok(ukRegions.length > 0 && ukRegions.every((r) => NATIONS.has(r.stateCode)), `regions: (C) every UK region names its home nation (${ukRegions.map((r) => `${r.code}=${r.stateCode}`).join(", ")})`);
  const regMisfit = ukRegions.filter((r) => {
    const codes = mod.nationScopedRegulations(r, "vehicular").map((x) => x.code);
    const eng = r.stateCode === "ENG";
    return codes.includes("NPPF") !== eng || codes.includes("PPG") !== eng;
  });
  ok(ukRegions.some((r) => r.stateCode === "SCT") && regMisfit.length === 0, `uk-ta standards: (C) NPPF and PPG are listed for every English UK region and for no other${regMisfit.length ? ` (wrong for: ${regMisfit.map((r) => r.code).join(", ")})` : ""}`);
  // Census WU03EW is the England-and-Wales table: listed for English and Welsh
  // regions, for no Scottish or Northern Irish one. No Welsh or NI region is
  // defined yet, so those two nations are checked on a stand-in region.
  const standIns = [{ code: "wls_check", displayName: "Cardiff", country: "UK", stateCode: "WLS" }, { code: "nir_check", displayName: "Belfast", country: "UK", stateCode: "NIR" }];
  const censusMisfit = [...ukRegions, ...standIns].flatMap((r) => ["vehicular", "pedestrian"].map((k) => [r, k])).filter(([r, k]) => {
    const listed = mod.nationScopedRegulations(r, k).some((x) => x.code === "Census WU03EW");
    return listed !== (r.stateCode === "ENG" || r.stateCode === "WLS");
  });
  ok(censusMisfit.length === 0, `uk-ta standards: Census WU03EW is listed for English and Welsh regions only, vehicular and pedestrian${censusMisfit.length ? ` (wrong for: ${censusMisfit.map(([r, k]) => `${r.code}/${k}`).join(", ")})` : ""}`);
  const cardiff = mod.nationScopedRegulations(standIns[0], "vehicular").map((x) => x.code);
  ok(!cardiff.includes("NPPF") && !cardiff.includes("PPG"), `uk-ta standards: (C) a Welsh region lists neither the NPPF nor the PPG (${cardiff.join(", ")})`);
  // The filter only ever removes entries (never adds or reorders), and only UK ones.
  const onlyRemoves = [...ukRegions, ...standIns].every((r) => ["vehicular", "pedestrian"].every((k) => {
    const all = mod.applicableRegulations(r, k).map((x) => x.code);
    const kept = mod.nationScopedRegulations(r, k).map((x) => x.code);
    return JSON.stringify(all.filter((c) => kept.includes(c))) === JSON.stringify(kept);
  }));
  ok(onlyRemoves, "uk-ta standards: the nation filter only drops entries from the shared list, in the shared order");
  // (V) The shared registry Velocity's template prints is left as it is:
  // NPPF, PPG and Census WU03EW keep their UK-wide tag, so a Scottish Velocity
  // study lists them exactly as before (the pins below hold the bytes).
  const tagOf = (code) => mod.REGULATIONS.find((r) => r.code === code)?.jurisdiction;
  ok(["NPPF", "PPG", "Census WU03EW"].every((c) => tagOf(c) === "UK") && Object.keys(mod.UK_NATION_SCOPE).every((c) => tagOf(c) !== undefined),
    `regulations: (V) the shared registry keeps NPPF, PPG and Census WU03EW tagged "UK" (${["NPPF", "PPG", "Census WU03EW"].map((c) => `${c}=${tagOf(c)}`).join(", ")}), and every nation-scoped code is a registry entry`);

  // (B) brand.copyright: the neutral TA supplies its own line; a non-string one is refused.
  ok(neutral.brand.copyright === NEUTRAL_COPYRIGHT("{{firm.name}}"), `uk-ta: (B) brand.copyright is the neutral TA's own line (${JSON.stringify(neutral.brand.copyright)})`);
  let refused = false;
  try { mod.validateTemplate({ ...neutral, brand: { ...neutral.brand, copyright: 7 } }); } catch { refused = true; }
  ok(refused, "registry: (B) validateTemplate refuses a non-string brand.copyright");

  // (E)(i) No sentence of five or more words is the same in both templates.
  const velSentences = new Set(sentencesOf(allStrings(vel)));
  const sameSentences = sentencesOf(allStrings(neutral)).filter((x) => velSentences.has(x));
  ok(velSentences.size > 0 && sameSentences.length === 0, `uk-ta: (E)(i) no sentence of 5+ words is identical to a sentence of velocity.ts${sameSentences.length ? ` (${sameSentences.length}: "${sameSentences.slice(0, 3).join('", "')}")` : ""}`);

  // (a) Brand furniture: nothing of Velocity's. White text on the primary
  // band is the one value both palettes hold; it is no one's identity (the
  // engine itself gives any dark themed primary "#ffffff" text,
  // applyThemeToTemplate), so onPrimary may be white and nothing else may match.
  const velValues = new Set(Object.values(vel.brand.palette).map(hex));
  const shared = Object.entries(neutral.brand.palette).filter(([k, v]) => velValues.has(hex(v)) && !(k === "onPrimary" && hex(v) === "#ffffff"));
  ok(shared.length === 0, `uk-ta: (a) palette shares no colour with Velocity's palette (onPrimary white aside)${shared.length ? ` (shared: ${shared.map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}`);
  ok(neutral.brand.cover.style !== "gradient", `uk-ta: (a) cover style is not Velocity's gradient (${neutral.brand.cover.style})`);
  ok(neutral.brand.cover.wordmark === undefined && neutral.brand.cover.tagline === undefined, "uk-ta: (a) cover has no wordmark and no tagline");
  ok(neutral.brand.logo === undefined, "uk-ta: (a) brand.logo is undefined");

  // (b) Figure colours. Two levels: the template opts into its own palette
  // and the colours derived from it share nothing with CHART_COLORS; then, in
  // assertNeutral, the rendered content streams set none of CHART_COLORS. The
  // content streams are the authority — they show what was actually drawn, so
  // a provider or draw primitive that bypasses chartColors() (a hard-coded
  // Velocity hex) is caught — while the template level covers the
  // derivation for every series, drawn by the fixture or not.
  const velocityChart = new Set(Object.values(mod.CHART_COLORS).map(hex));
  const own = mod.paletteChartColors(neutral.brand.palette);
  ok(neutral.brand.charts === "palette", `uk-ta: (b) figures are drawn from the template's own palette (brand.charts = ${JSON.stringify(neutral.brand.charts)})`);
  const clash = Object.entries(own).filter(([, v]) => velocityChart.has(hex(v)));
  ok(clash.length === 0, `uk-ta: (b) no palette-derived chart colour equals a CHART_COLORS value${clash.length ? ` (${clash.map(([k, v]) => `${k} ${v}`).join(", ")})` : ""}`);
  const chartColours = { velocity: velocityChart };

  // (a) Another firm's UK study: the neutral format under its own name, at
  // every site, for every study variant.
  const neutralRenders = {};
  for (const [site, { nation }] of Object.entries(SITES)) {
    for (const [variant, [, kind]] of Object.entries(VARIANTS)) {
      neutralRenders[`${site}/${variant}`] = await assertNeutral(`(a) other firm, ${site}, ${variant}`, await mod.renderStudyPdf(at(site, variant), OTHER_FIRM), OTHER_FIRM, { chartColours, kind, nation, london: site === "London" });
    }
  }
  const other = neutralRenders["London/retail"];
  ok(other.colours.has(hex(own.inbound)), `(a) other firm: (b) the figures are drawn, in the palette-derived inbound colour ${own.inbound} (so the absence above is not vacuous)`);
  // Each 6.2 branch is exercised for each study type, so its assertion is not vacuous.
  const s62Seen = Object.entries(neutralRenders).map(([k, pdf]) => `${VARIANTS[k.split("/")[1]][1]}:${section62(pdf)?.body.startsWith("Figure:") ? "figure" : "note"}`);
  ok(["vehicular:figure", "vehicular:note", "pedestrian:figure", "pedestrian:note"].every((x) => s62Seen.includes(x)), `6.2: the renders cover the figure and the note for vehicular and pedestrian studies (${[...new Set(s62Seen)].join(", ")})`);
  // (C) The standards table: NPPF and PPG rows in England only; Census WU03EW in England (and Wales) only.
  const NPPF_ROW = /NPPF National Planning Policy Framework December 2024|PPG Planning Practice Guidance —/;
  const WU03EW_ROW = /Census WU03EW ONS 2011 Census/;
  for (const [key, pdf] of Object.entries(neutralRenders)) {
    const eng = SITES[key.split("/")[0]].nation === "ENG";
    ok(NPPF_ROW.test(pdf.text) === eng && WU03EW_ROW.test(pdf.text) === eng, `(C) ${key}: the standards table ${eng ? "lists" : "lists neither"} the NPPF/PPG ${eng ? "and" : "nor"} Census WU03EW (${SITES[key.split("/")[0]].nation})`);
  }
  const scot = neutralRenders["Glasgow/retail"];
  ok(scot.text.includes(REG_TABLE_HEADER) && /DMRB Design Manual/.test(scot.text), "Glasgow, vehicular: the standards table is still drawn (DMRB), under its lead-in");
  // A Scottish pedestrian study: the register holds nothing for it, so no
  // table (and no lead-in); 6.4 says what Chapter 4 describes, not that a
  // method is set out there.
  for (const site of ["Glasgow", "Edinburgh"]) {
    const ped = neutralRenders[`${site}/pedestrian`];
    ok(!ped.text.includes(REG_TABLE_HEADER) && standardsLeadIn(ped)?.text === APPROVED_REG_NONE_NOTE, `${site}, pedestrian: no standards table, and the approved note in its place`);
  }
  const scotPed = neutralRenders["Glasgow/pedestrian"];
  ok(scotPed.text.includes("using the method described in Chapter 4 (in London, TfL's PCL; elsewhere, a method the highway or roads authority accepts)"), "Glasgow, pedestrian: 6.4 names the method Chapter 4 describes for London and for elsewhere (so the render's false-phrase negatives cover the pedestrian branch)");
  ok(scotPed.text.includes("The method is confirmed with that authority, and the survey inputs supplied, at submittal."), "Glasgow, pedestrian: 4.1 says the method is confirmed with the authority at submittal");

  // (E)(ii) No 7-word run is shared between the neutral TA (its template
  // strings plus the furniture it actually prints: cover, Document Control
  // Sheet with the © line, footer) and Velocity's wording (velocity.ts plus
  // the Velocity furniture in engine.ts and pdf-export.ts). No title is
  // excluded: every title the two templates share is four words or fewer.
  const libDir = path.resolve(here, "../src/lib");
  const engineFurniture = furnitureStrings(path.join(libDir, "report-template/engine.ts"), ["drawCover", "drawDocControl", "stampFooters"], null);
  const exportFurniture = furnitureStrings(path.join(libDir, "pdf-export.ts"), ["velocityDocMeta"], "drawVelocity");
  const expectFound = [["engine.ts", engineFurniture, ["drawCover", "drawDocControl", "stampFooters"]], ["pdf-export.ts", exportFurniture, ["velocityDocMeta", "drawVelocityCover", "drawVelocityDocControlSheet", "drawVelocityPageFooter", "VELOCITY_NAME", "VELOCITY_NAME_LIMITED", "VELOCITY_WEB"]]];
  for (const [f, fu, names] of expectFound) {
    const missing = names.filter((x) => !fu.found.has(x));
    ok(missing.length === 0, `(E) the guard reads the Velocity furniture in ${f} (${missing.length ? `MISSING ${missing.join(", ")}` : [...fu.found].join(", ")})`);
  }
  const velGramSource = new Map();
  for (const [src, strs] of [["velocity.ts", allStrings(vel)], ["engine.ts", engineFurniture.strings], ["pdf-export.ts", exportFurniture.strings]]) {
    for (const s of strs) for (const g of gramsOf(s)) if (!velGramSource.has(g)) velGramSource.set(g, src);
  }
  // Each source contributes runs, so an empty match below is a real negative.
  const SENTINELS = [
    ["velocity.ts", "who substitutes field collected data and a"],
    ["engine.ts", "extracts may be reproduced provided the source"],
    ["pdf-export.ts", "extracts may be reproduced provided that the"],
    ["pdf-export.ts", "the named reviewers and the client are"],
  ];
  for (const [src, g] of SENTINELS) ok(velGramSource.get(g) === src, `(E) Velocity's run "${g}" is read from ${src}`);
  const dcsPage = other.pages.find((p) => p.startsWith("Document Control Sheet")) ?? "";
  const footerLine = (other.pages[2].match(new RegExp(`${esc(OTHER_FIRM.name)} · Transport Assessment · .* · Page \\d+`)) ?? [""])[0];
  ok(dcsPage !== "" && footerLine !== "", "(E) the neutral render's Document Control Sheet and footer are read");
  const neutralSide = [...allStrings(neutral), other.pages[0], dcsPage, footerLine];
  const sharedRuns = [];
  for (const s of neutralSide) for (const g of gramsOf(s)) if (velGramSource.has(g)) sharedRuns.push(`"${g}" (${velGramSource.get(g)}; neutral: "${String(s).slice(0, 50)}…")`);
  ok(sharedRuns.length === 0, `uk-ta: (E)(ii) no 7-word run shared with Velocity's wording${sharedRuns.length ? ` (${sharedRuns.length}: ${sharedRuns.slice(0, 4).join("; ")})` : ""}`);
  // (c) A request that names its client prints it; a blank one prints no row.
  await assertNeutral("(a) other firm, client supplied", await mod.renderStudyPdf(withClient(uk, CLIENT_NAME), OTHER_FIRM), OTHER_FIRM, { client: CLIENT_NAME, chartColours });
  await assertNeutral("(a) other firm, blank client", await mod.renderStudyPdf(withClient(uk, "   "), OTHER_FIRM), OTHER_FIRM, { chartColours });

  // (V) Velocity's own account keeps its house format exactly as it is: every
  // site and study type reproduces origin/main's bytes, and its template
  // object and CHART_COLORS are unchanged.
  ok(createHash("sha256").update(JSON.stringify(vel)).digest("hex") === VELOCITY_TEMPLATE_SHA256, "(V) Velocity: the velocity-ta template object is unchanged (sha256 of its JSON)");
  ok(JSON.stringify(mod.CHART_COLORS) === CHART_COLORS_PIN, `(V) Velocity: CHART_COLORS is unchanged (${JSON.stringify(mod.CHART_COLORS)})`);
  const VEL_VARIANTS = ["retail", "office", "pedestrian"];
  const velBufs = {};
  for (const site of Object.keys(SITES)) {
    for (const variant of VEL_VARIANTS) {
      const key = `${site}/${variant}`;
      const buf = await mod.renderStudyPdf(at(site, variant), VELOCITY_FIRM);
      velBufs[key] = buf;
      ok(pdfHash(buf) === VELOCITY_PINS[key], `(V) Velocity, ${site}, ${variant}: pdfHash matches origin/main (${pdfHash(buf).slice(0, 12)}… vs pinned ${String(VELOCITY_PINS[key]).slice(0, 12)}…)`);
    }
  }
  ok(Object.keys(velBufs).length === 12 && Object.keys(VELOCITY_PINS).every((k) => k in velBufs), `(V) all 12 pinned Velocity renders were made (${Object.keys(velBufs).length})`);
  const velPdf = await readPdf(velBufs["London/retail"]);
  ok(velPdf.info.Author === "Velocity Transport Planning Ltd", `(b) Velocity: PDF Author is Velocity (${velPdf.info.Author})`);
  ok(/^VELOCITY Transport Planning/.test(velPdf.pages[0]) && velPdf.pages[0].includes("www.velocity-tp.com"), "(b) Velocity: cover carries the VELOCITY wordmark and velocity-tp.com");
  ok(/PREPARED BY Velocity Transport Planning Ltd/.test(velPdf.pages[0]), "(b) Velocity: cover PREPARED BY is Velocity Transport Planning Ltd");
  ok(velPdf.text.includes("© Velocity Transport Planning Ltd — extracts may be reproduced provided the source is acknowledged."), "(b) Velocity: its Document Control Sheet keeps its own © line (no brand.copyright)");
  // The colour-op reader does see CHART_COLORS where they are drawn, so the
  // neutral renders' "none found" is a real negative.
  const velSeen = ["inbound", "outbound", "caption"].filter((k) => velPdf.colours.has(hex(mod.CHART_COLORS[k])));
  ok(velSeen.length === 3, `(b) Velocity: its figures still use CHART_COLORS inbound/outbound/caption (${velSeen.join(", ") || "none"} found)`);
  // Sanity for the office negative in (a): under Velocity's own template the
  // office use does draw the curve digitised from their TA.
  const velOffice = (await readPdf(velBufs["London/office"])).text;
  ok(/Gracechurch/.test(velOffice), "(b) Velocity, office use: their digitised office curve still renders (so (a)'s office negative is not vacuous)");
  // Sanity for the standards lead-in reader: on Velocity's Glasgow pedestrian
  // render (the shared registry, as it stands) it finds Velocity's own
  // lead-in above a table, which is not an approved neutral text.
  const velScotPed = await readPdf(velBufs["Glasgow/pedestrian"]);
  const velLead = standardsLeadIn(velScotPed);
  ok(velLead?.next === "table" && velLead.after === REG_TABLE_HEADER && velLead.text !== "" && velLead.text !== APPROVED_REG_LEAD_IN && /NPPF National Planning Policy Framework/.test(velScotPed.text),
    `(V) Velocity, Glasgow, pedestrian: its standards table is still drawn under its own lead-in (${JSON.stringify(velLead?.text?.slice(0, 60))}…), and the reader tells it from the neutral one`);
  // The same for the section-wide reader: it parses Velocity's standards
  // section (another title, the same blocks) into the same runs, and rejects
  // it only for its wording.
  const velConf = confidenceSectionShape(velScotPed, true, "Accuracy and Applicable Standards");
  const velKinds = velConf.runs?.map((r) => r.kind).join(",");
  ok(!velConf.good && velKinds === "prose,metric,table,prose,table,prose" && velConf.runs[1].labels === CONF_METRIC_LABELS && velConf.runs[1].values === 3 && velConf.runs[3].text === velLead.text && REG_STATUS_RE.test(velConf.runs[5].text),
    `(V) Velocity, Glasgow, pedestrian: the section reader finds its prose, three metric tiles, both tables and the status rows (${velKinds}), and rejects its wording`);
  // And the heading readers: Velocity's own headings name London-only
  // guidance in capitals ("PEDESTRIAN COMFORT LEVEL ANALYSIS") and persons
  // ("Daily Person Accumulation", over a vehicle figure), which the neutral
  // TA's may not.
  const velHeads = headingsOf(velPdf);
  const velMisfit = mislabelledFigures(velPdf).map((m) => m.heading);
  ok(velHeads.includes("4.0 PEDESTRIAN COMFORT LEVEL ANALYSIS") && velHeads.some((h) => LONDON_ONLY_RE.test(h) && h === h.toUpperCase()) && velHeads.some((h) => PERSON_HEADING_RE.test(h)) && velMisfit.includes("6.2 Daily Person Accumulation"),
    `(V) Velocity, London, retail: the heading readers see its capitalised London-only chapter heading and its "Daily Person Accumulation" over a vehicle figure (mislabelled: ${velMisfit.join(", ")})`);

  // (c) No firm id (anonymous / demo render): the neutral format, the same bytes a non-Velocity firm id gets.
  const anonBuf = await mod.renderStudyPdf(uk, ANON_FIRM);
  await assertNeutral("(c) no firm id", anonBuf, ANON_FIRM, { chartColours });
  ok(pdfHash(anonBuf) === pdfHash(await mod.renderStudyPdf(uk, { ...ANON_FIRM, firmId: OTHER_FIRM.firmId })), "(c) no firm id renders exactly what a non-Velocity firm id renders");

  checkRouteFirmIds();
} finally {
  globalThis.fetch = realFetch;
  await cleanup();
}
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
