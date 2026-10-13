// The study page's report text (Appendix A, Appendix B and the footer) must
// describe the study it is printed under, not Atlanta.
//
// Appendix B (src/components/tis-limitations.tsx), Appendix A
// (src/components/tis-methodology-appendix.tsx) and the report footer
// (src/components/tis-report-footer.tsx) are bundled with esbuild and rendered
// with react-dom/server for each fixture below, and the assertions read the
// text a reviewing engineer would see:
//
//   GA      scripts/fixtures/scenario-base.json, the REAL Atlanta engine output
//           (atlanta_metro; growth override 1.50%/yr with its source; no
//           pass-by or internal capture; a 22% non-auto mode share applied).
//   GA-0    GA with the mode share at 100% auto: every credit is zero.
//   UTDF    scripts/fixtures/scenario-network-utdf.json, REAL Atlanta engine
//           output with one imported turning-movement count.
//   PA      GA re-keyed to pittsburgh_metro as the engine writes it there:
//           the regions.ts jurisdiction (DOMI), a requested 2.00%/yr growth
//           with the engine's override text for a region with no measured
//           rate (asserted below against tis-engine-core), requested 10%
//           pass-by and 5% internal capture, and an applied auto share of
//           0.7312 (Pittsburgh's metro 0.75 after a site-density shift; the
//           value is illustrative, the 27% non-auto it implies is asserted).
//   PA-?    PA as an older payload: no regionCode, jurisdiction, growthSource,
//           autoModeShareApplied or autoModeShareSource. Wording must stay
//           neutral rather than guess.
//   SAV     GA re-keyed to savannah_metro (Georgia, not Atlanta), with the
//           measured rate and growthSource built from tis-engine-core the way
//           tis.ts builds them.
//
// The one place "GDOT" is allowed in a non-Georgia study is the LOS-bands
// bibliography entry, which lists GDOT among example state manuals that
// republish the bands; it is removed (exactly once) before the scan.
//
// TEETH: MUTATIONS edit the sources IN MEMORY, the suite runs again on the
// edited text, and each mutation must turn red exactly the checks it names.
// A check no mutation turns red fails the run.
//
// esbuild is not a dependency of this package; it is resolved through vite,
// which is (vite bundles the same esbuild the API server pins).
//
// Run: `pnpm run check:region-limitations`
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getMeasuredGrowthRate, getMeasuredGrowthSource, GROWTH_OVERRIDE_PREFIX } from "@workspace/tis-engine-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const atlanta = path.resolve(here, "..");
const viaVite = createRequire(createRequire(import.meta.url).resolve("vite/package.json"));
const { build } = viaVite("esbuild");

const FILES = {
  limitations: "src/components/tis-limitations.tsx",
  appendix: "src/components/tis-methodology-appendix.tsx",
  footer: "src/components/tis-report-footer.tsx",
  disclosures: "src/lib/study-disclosures.ts",
  page: "src/pages/tis.tsx",
};
const ABS = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, path.join(atlanta, rel)]));
const SOURCES = Object.freeze(
  Object.fromEntries(Object.entries(ABS).map(([k, abs]) => [k, existsSync(abs) ? readFileSync(abs, "utf8") : null])),
);
const BUNDLED = ["limitations", "appendix", "footer", "disclosures"];

const BANNED = ["independent review", "second opinion", "peer review", "QA/QC", "audit"];
const GEORGIA = /Atlanta|GDOT|Georgia/;
const LOS_BANDS_EXAMPLES = "(e.g. GDOT, Caltrans HDM, NYSDOT HDM)";

// ─── fixtures ────────────────────────────────────────────────────────────────
const load = (n) => JSON.parse(readFileSync(path.join(here, "fixtures", n), "utf8"));
const GA = load("scenario-base.json");
const UTDF = load("scenario-network-utdf.json");
const GA0 = { ...structuredClone(GA), autoModeShareApplied: 1 };
const PA_GROWTH_SOURCE =
  "Explicit override — 2.00%/yr was supplied with the request and applied in place of the engine's own rate. No measured growth rate is wired for this region, so there is no measured value to compare the override against. The applied rate is not derived from measured data; its basis must be stated by the preparer.";
const MODE_SOURCE = "ACS 5-Year Estimates Table B08301 (US) or national-stats equivalent";
const PA = (() => {
  const r = structuredClone(GA);
  r.request = {
    ...r.request,
    projectName: "Liberty Avenue Mixed Use",
    address: "1000 Liberty Ave, Pittsburgh, PA 15222",
    latitude: 40.4443,
    longitude: -79.996,
    growthRatePct: 2,
    passByPct: 10,
    internalCapturePct: 5,
  };
  r.regionCode = "pittsburgh_metro";
  r.jurisdiction = {
    dotName: "Pittsburgh Department of Mobility and Infrastructure (DOMI)",
    planningOfficeName: "Pittsburgh Department of City Planning",
  };
  r.growthAppliedPct = 2;
  r.growthSource = PA_GROWTH_SOURCE;
  r.passByPctApplied = 10;
  r.internalCapturePctApplied = 5;
  r.autoModeShareApplied = 0.7312;
  r.autoModeShareSource = MODE_SOURCE;
  r.findings = [];
  r.methodology = [];
  r.mitigationSummary = [];
  return r;
})();
const PA_OLD = (() => {
  const r = structuredClone(PA);
  for (const k of ["regionCode", "jurisdiction", "growthSource", "autoModeShareApplied", "autoModeShareSource"]) delete r[k];
  r.growthAppliedPct = 1.5;
  return r;
})();
// Savannah's measured rate and provenance, written the way tis.ts writes them.
const SAV_RATE = getMeasuredGrowthRate("savannah_metro");
const SAV = {
  ...structuredClone(GA),
  regionCode: "savannah_metro",
  jurisdiction: { dotName: "City of Savannah Traffic Engineering", planningOfficeName: "Chatham County-Savannah Metropolitan Planning Commission" },
  growthAppliedPct: SAV_RATE.growthPct,
  growthSource: `${getMeasuredGrowthSource("savannah_metro")} — median per-segment CAGR across ${SAV_RATE.stations} matched count stations within the Savannah MSA bounding box (${SAV_RATE.yearFrom} → ${SAV_RATE.yearTo})`,
};
const FIXTURES = { GA, "GA-0": GA0, UTDF, PA, "PA-?": PA_OLD, SAV };
const nonAutoPct = (r) => (Number.isFinite(r.autoModeShareApplied) ? Math.round((1 - r.autoModeShareApplied) * 100) : null);

// ─── the bundle, from the text under test ────────────────────────────────────
const ENTRY = `
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as limitations from "under-test:limitations";
import * as appendix from "under-test:appendix";
import * as footer from "under-test:footer";
export { createElement, renderToStaticMarkup, limitations, appendix, footer };
`;
const loaderFor = (abs) => (abs.endsWith(".tsx") ? "tsx" : "ts");
async function bundle(src) {
  const out = await build({
    absWorkingDir: atlanta,
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    jsx: "automatic",
    tsconfigRaw: "{}",
    define: { "process.env.NODE_ENV": '"development"' },
    alias: { "@": path.join(atlanta, "src") },
    banner: { js: `import { createRequire as __cr } from "node:module"; const require = __cr(${JSON.stringify(import.meta.url)});` },
    logLevel: "silent",
    stdin: { contents: ENTRY, resolveDir: atlanta, sourcefile: "region-limitations-entry.ts", loader: "ts" },
    plugins: [
      {
        name: "text-under-test",
        setup(b) {
          b.onResolve({ filter: /^under-test:/ }, (a) => {
            const key = a.path.slice("under-test:".length);
            return src[key] == null ? { path: key, namespace: "missing" } : { path: ABS[key] };
          });
          b.onLoad({ filter: /.*/, namespace: "missing" }, (a) => ({ contents: `export const MISSING = ${JSON.stringify(FILES[a.path])};`, loader: "js" }));
          for (const key of BUNDLED) {
            const abs = ABS[key];
            const re = new RegExp(`${abs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
            b.onLoad({ filter: re }, (a) => (a.path === abs && src[key] != null ? { contents: src[key], loader: loaderFor(abs), resolveDir: path.dirname(abs) } : undefined));
          }
        },
      },
    ],
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}

// ─── reading rendered markup ─────────────────────────────────────────────────
const INLINE = /<\/?(?:strong|em|b|i|span|sub|sup|a|code)\b[^>]*>/g;
const text = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(INLINE, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
const sentences = (t) => t.split(/(?<=[.;:])\s+/);
const NEGATION = /\b(no|not|without|none)\b/i;
const KINDS = {
  "pass-by": { applied: (r) => r.passByPctApplied > 0, word: /pass-by/i },
  "internal capture": { applied: (r) => r.internalCapturePctApplied > 0, word: /internal[- ]capture/i },
  "mode share": { applied: (r) => (nonAutoPct(r) ?? 0) > 0, word: /mode[- ]shifts?|mode[- ]share|transit \/ pedestrian/i },
};
/** Sentences that deny a credit the study applied. */
const deniedCredits = (r, t) =>
  Object.entries(KINDS)
    .filter(([, k]) => k.applied(r))
    .flatMap(([name, k]) => sentences(t).filter((s) => NEGATION.test(s) && k.word.test(s)).map((s) => `${name}: "${s}"`));
const georgiaIn = (t) => {
  const scrubbed = t.replace(LOS_BANDS_EXAMPLES, "");
  const m = GEORGIA.exec(scrubbed);
  return m ? scrubbed.slice(Math.max(0, m.index - 60), m.index + 40) : null;
};
const has = (t, s) => typeof t === "string" && t.includes(s);
const slice = (t, from, to) => {
  if (typeof t !== "string") return "";
  const a = t.indexOf(from);
  if (a < 0) return "";
  const b = to ? t.indexOf(to, a + from.length) : -1;
  return t.slice(a, b < 0 ? undefined : b);
};
const firm = (o = {}) => ({ firmName: "", firmAddress: "", firmPhone: "", logoDataUrl: "", preparedBy: "", peNumber: "", defaultClient: "", ...o });

// ─── the suite ───────────────────────────────────────────────────────────────
async function suite(src) {
  const out = [];
  const check = (id, pass, msg) => out.push({ id, pass: Boolean(pass), msg });
  let mod;
  try {
    mod = await bundle(src);
  } catch (e) {
    check("bundles", false, `the components bundle with esbuild: ${(e.errors ?? []).map((x) => x.text).join("; ") || e.message}`);
    return out;
  }
  check("bundles", true, "the components bundle with esbuild");
  const render = (m, name, props) => {
    if (m.MISSING) return { error: `${m.MISSING} does not exist` };
    if (typeof m[name] !== "function") return { error: `${name} is not exported` };
    try {
      return { text: text(mod.renderToStaticMarkup(mod.createElement(m[name], props))) };
    } catch (e) {
      return { error: `${name} threw: ${e instanceof Error ? e.message : e}` };
    }
  };
  const L = {};
  const A = {};
  for (const [k, r] of Object.entries(FIXTURES)) {
    L[k] = render(mod.limitations, "TisLimitations", { report: r });
    A[k] = render(mod.appendix, "TisMethodologyAppendix", { report: r });
  }
  const why = (...rs) => rs.map((x) => x.error).filter(Boolean).join("; ");
  const lt = (k) => L[k].text ?? "";
  const at = (k) => A[k].text ?? "";

  // ---- Pittsburgh ------------------------------------------------------------
  check("pa-region", has(lt("PA"), "traffic-signal nodes within the Pittsburgh MSA,"), `PA: Appendix B's signal inventory is the study's own region, "within the Pittsburgh MSA" ${why(L.PA)}`);
  {
    const hits = [["Appendix B", georgiaIn(lt("PA"))], ["Appendix A", georgiaIn(at("PA"))]].filter(([, h]) => h);
    const flat = [lt("PA"), at("PA")].some((t) => t.includes("1.0% per year"));
    check(
      "pa-no-georgia",
      !L.PA.error && !A.PA.error && hits.length === 0 && !flat,
      `PA: no "Atlanta", "GDOT" or "Georgia" in either appendix (outside the LOS-bands example list), and no "1.0% per year"${hits.length ? ` — ${hits.map(([w, h]) => `${w}: …${h}…`).join("; ")}` : ""}${flat ? " — says 1.0% per year" : ""} ${why(L.PA, A.PA)}`,
    );
  }
  check(
    "pa-growth",
    has(lt("PA"), "2.00% per year") && has(lt("PA"), PA_GROWTH_SOURCE.replace(/\.$/, "")),
    `PA: Appendix B states the growth actually applied (2.00% per year) and its source verbatim ${why(L.PA)}`,
  );
  {
    const want = ["10% pass-by", "5% internal capture", "27% non-auto"];
    const missL = [...want, MODE_SOURCE].filter((s) => !has(lt("PA"), s));
    const a1 = slice(at("PA"), "A.1", "A.2");
    const missA = want.filter((s) => !has(a1, s));
    check("pa-credits-limitations", missL.length === 0, `PA: Appendix B states the credits applied (10% pass-by, 5% internal capture, 27% non-auto per its source)${missL.length ? ` — missing: ${missL.join(", ")}` : ""} ${why(L.PA)}`);
    check("pa-credits-appendix", missA.length === 0, `PA: Appendix A §A.1 states the same credits${missA.length ? ` — missing: ${missA.join(", ")}` : ""} ${why(A.PA)}`);
  }
  {
    const a4 = slice(at("PA"), "A.4", "A.5");
    check("pa-road-owner", /approval by the road owner/.test(a4) && /permitting requirements/.test(a4), `PA: §A.4 still subjects mitigations to the road owner's permitting requirements, without a Georgia document ${why(A.PA)}`);
  }

  // ---- no fixture denies a credit it applied ----------------------------------
  {
    const bad = [];
    for (const k of Object.keys(FIXTURES)) {
      for (const [w, t] of [["Appendix B", L[k]], ["Appendix A", A[k]]]) {
        if (t.error) bad.push(`${k} ${w}: ${t.error}`);
        else for (const d of deniedCredits(FIXTURES[k], t.text)) bad.push(`${k} ${w} ${d}`);
      }
    }
    check("no-false-no-credits", bad.length === 0, `no fixture's text says a credit it applied was not applied${bad.length ? ` — ${bad.slice(0, 3).join(" | ")}` : ""}`);
  }

  // ---- Atlanta / Georgia --------------------------------------------------------
  check(
    "ga-zero-none",
    has(lt("GA-0"), "No internal capture, pass-by, or mode-shift credits have been applied to project trips.") &&
      has(at("GA-0"), "without internal capture credit, pass-by reductions, or transit / pedestrian mode shifts"),
    `GA with zero credits: both appendices still say no credits were applied ${why(L["GA-0"], A["GA-0"])}`,
  );
  {
    const need = ["traffic-signal nodes within the Atlanta MSA,", "GDOT 511", "GDOT Annual Average Daily Traffic series"].filter((s) => !has(lt("GA"), s));
    const a4 = slice(at("GA"), "A.4", "A.5");
    const refs = slice(at("GA"), "A.6");
    const ok = need.length === 0 && /per \[GDOT-RPM\] for state routes/.test(a4) && /\[GDOT-RPM\] Georgia Department of Transportation/.test(refs);
    check("ga-gdot-kept", ok, `GA (Atlanta): Appendix B keeps the Atlanta MSA and its GDOT text, and §A.4 / §A.6 keep [GDOT-RPM]${need.length ? ` — missing: ${need.join(", ")}` : ""} ${why(L.GA, A.GA)}`);
  }
  {
    const miss = ["1.50% per year", GA.growthSource.replace(/\.$/, ""), "22% non-auto", "No pass-by or internal-capture credit"].filter((s) => !has(lt("GA"), s));
    check("ga-applied-values", miss.length === 0, `GA (Atlanta): Appendix B states the growth applied (1.50% per year, its source verbatim) and the credits (22% non-auto; no pass-by or internal capture)${miss.length ? ` — missing: ${miss.map((s) => s.slice(0, 40)).join(", ")}` : ""} ${why(L.GA)}`);
  }
  {
    const t = lt("SAV");
    const ok = has(t, "traffic-signal nodes within the Savannah MSA,") && !has(t, "Atlanta MSA,") && !has(t, "GDOT 511") && has(t, "GDOT Annual Average Daily Traffic series") && /per \[GDOT-RPM\]/.test(at("SAV"));
    check("ga-other-metro", ok, `GA outside Atlanta (Savannah): its own region, not the Atlanta MSA or GDOT 511, and keeps the GDOT AADT and [GDOT-RPM] text (its growth source names the Atlanta Regional Commission, which hosts the GDOT counts) ${why(L.SAV, A.SAV)}`);
  }

  // ---- an older payload: neutral, not guessed ------------------------------------
  {
    const t = lt("PA-?");
    const g = georgiaIn(t) ?? georgiaIn(at("PA-?"));
    const ok = !g && has(t, "traffic-signal nodes within the study region,") && has(t, "1.50% per year") && /growth[^.]*not recorded|not record[^.]*growth|basis[^.]*not recorded/i.test(t) && /does not record the mode-share adjustment/.test(t);
    check("unknown-neutral", ok && !L["PA-?"].error, `a payload without regionCode / growthSource / autoModeShareApplied: no Georgia text, "the study region", the rate with an unrecorded basis, and an unrecorded mode-share adjustment${g ? ` — …${g}…` : ""} ${why(L["PA-?"], A["PA-?"])}`);
  }

  // ---- the model sentence matches the PDF's ---------------------------------------
  {
    const bad = Object.keys(FIXTURES).filter((k) => {
      const t = lt(k);
      return !(has(t, "Webster/Akçelik") && /superseded by those tools at submittal/.test(t) && /HCS and\/or Synchro/.test(t)) || has(t, "Highway Capacity Manual, 6th Edition, Chapter 19");
    });
    check("model-sentence", bad.length === 0, `every fixture: the capacity method is the Webster/Akçelik screening model, superseded by HCS and/or Synchro at submittal${bad.length ? ` — not in: ${bad.join(", ")}` : ""}`);
  }

  // ---- counts supplied with the study -----------------------------------------------
  {
    const u = lt("UTDF");
    const ok =
      has(u, "Counts supplied with this study (imported turning-movement counts) are used at 1 of the 40 study signals.") &&
      !has(u, "No measured tube counts") &&
      has(lt("GA"), "No measured tube counts, automated traffic recorder (ATR) counts, or video-derived counts were used.");
    check("supplied-counts", ok, `an imported turning-movement count is disclosed (1 of the 40 study signals) instead of "no measured counts were used"; a study without one keeps that sentence ${why(L.UTDF, L.GA)}`);
  }

  // ---- the footer ---------------------------------------------------------------------
  {
    const plain = render(mod.footer, "TisReportFooter", { firm: firm() });
    const branded = render(mod.footer, "TisReportFooter", { firm: firm({ firmName: "Ridge Engineering", preparedBy: "J. Smith, P.E." }) });
    const ok =
      has(plain.text, "Screening-level TIS generated by Simple Impact Studies.") &&
      !/Atlanta/.test(plain.text ?? "Atlanta") &&
      has(branded.text, "Prepared by Ridge Engineering") &&
      !has(branded.text, "generated by");
    check("footer-neutral", ok, `the footer without firm branding names the product, Simple Impact Studies, and no metro; with branding it names the firm ${why(plain, branded)}`);
  }
  {
    const p = src.page ?? "";
    const ok = p.includes("<TisLimitations report={report} />") && p.includes("<TisReportFooter firm={firm} />") && !p.includes("Atlanta Traffic Inefficiency Analyzer");
    check("page-wiring", ok, "the study page hands TisLimitations the report, renders TisReportFooter, and no longer names the Atlanta Traffic Inefficiency Analyzer");
  }

  // ---- copy ---------------------------------------------------------------------------
  {
    const texts = [
      ...Object.entries(L).map(([k, x]) => [`Appendix B ${k}`, x.text ?? ""]),
      ...Object.entries(A).map(([k, x]) => [`Appendix A ${k}`, x.text ?? ""]),
      ...BUNDLED.map((k) => [FILES[k], src[k] ?? ""]),
    ];
    const hits = texts.flatMap(([w, t]) => BANNED.filter((b) => t.toLowerCase().includes(b.toLowerCase())).map((b) => `${w}: "${b}"`));
    check("banned-copy", hits.length === 0, `no "independent review", "second opinion", "peer review", "QA/QC" or "audit" in the rendered text or the sources${hits.length ? ` — ${hits.join("; ")}` : ""}`);
  }
  return out;
}

// ─── run ─────────────────────────────────────────────────────────────────────────────
{
  const engineBranch = getMeasuredGrowthRate("pittsburgh_metro") === undefined && PA_GROWTH_SOURCE.startsWith(`${GROWTH_OVERRIDE_PREFIX} — 2.00%/yr`);
  console.log(`${engineBranch ? "PASS" : "FAIL"}  [pre-fixtures] the PA growth source is the engine's override text for a region with no measured rate`);
  if (!engineBranch) process.exit(1);
  const leaks = ["request", "growthSource", "autoModeShareSource", "jurisdiction", "tripGeneration", "tripDistribution"].filter((k) => GEORGIA.test(JSON.stringify(PA[k] ?? "")));
  console.log(`${leaks.length ? "FAIL" : "PASS"}  [pre-fixtures] the PA fixture carries no Georgia text in the fields the components read${leaks.length ? ` (${leaks.join(", ")})` : ""}`);
  if (leaks.length) process.exit(1);
}
const baseline = await suite(SOURCES);
let fails = 0;
for (const r of baseline) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  [${r.id}] ${r.msg.trim()}`);
  if (!r.pass) fails++;
}
const redIds = (results) => [...new Set(results.filter((r) => !r.pass).map((r) => r.id))];
const ids = [...new Set(baseline.map((r) => r.id))];

if (fails > 0) {
  console.log(`\n${fails} CHECK(S) FAILED (mutations not run: the suite is not green)`);
  process.exit(1);
}

// ─── TEETH ───────────────────────────────────────────────────────────────────────────
const ts = (await import("typescript")).default;
const codeOf = (file, t) => {
  const kind = /\.tsx$/.test(FILES[file]) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(path.basename(FILES[file]), t, ts.ScriptTarget.Latest, false, kind);
  return ts.createPrinter({ removeComments: true }).printFile(sf).replace(/\s+/g, " ").trim();
};
/** Replace the one occurrence of `from` in `file`; a missing or repeated anchor is a broken mutation. */
const edit = (file, from, to) => (s) => {
  const n = s[file].split(from).length - 1;
  if (n !== 1) throw new Error(`the anchor ${JSON.stringify(from.slice(0, 70))} occurs ${n} times in ${file}`);
  return { ...s, [file]: s[file].replace(from, () => to) };
};

const MUTATIONS = [
  // ---- Appendix B (tis-limitations.tsx) ----------------------------------------------
  { label: "Appendix B names the Atlanta MSA for every study", flips: ["pa-region", "pa-no-georgia", "unknown-neutral", "ga-other-metro"], apply: edit("limitations", "nodes within {region.phrase}, last refreshed", "nodes within the Atlanta MSA, last refreshed") },
  { label: "the growth rate reverts to a fixed 1.0% per year", flips: ["pa-no-georgia", "pa-growth", "ga-applied-values", "unknown-neutral"], apply: edit("limitations", "<strong>{growth.ratePct}% per year</strong>", "<strong>1.0% per year</strong>") },
  { label: "the growth source is not printed", flips: ["pa-growth", "ga-applied-values"], apply: edit("limitations", "<>Source: {growth.source}.</>", "<>Source: the engine.</>") },
  { label: "the GDOT AADT pointer prints for every study", flips: ["pa-no-georgia", "unknown-neutral"], apply: edit("limitations", "{region.isGeorgia\n", "{true\n") },
  { label: "the Atlanta GDOT 511 volume sentence prints for all of Georgia", flips: ["ga-other-metro"], apply: edit("limitations", "{region.isAtlanta ? (", "{region.isGeorgia ? (") },
  { label: "Atlanta loses its GDOT 511 volume sentence", flips: ["ga-gdot-kept"], apply: edit("limitations", "{region.isAtlanta ? (", "{false ? (") },
  { label: "Appendix B always says no credits were applied", flips: ["pa-credits-limitations", "no-false-no-credits", "ga-applied-values", "unknown-neutral"], apply: edit("limitations", "{credits.allZero ? (", "{true ? (") },
  { label: "the capacity sentence drops 'superseded by HCS and/or Synchro'", flips: ["model-sentence"], apply: edit("limitations", "screening model is superseded by those tools at submittal.", "screening model is used at submittal.") },
  { label: "counts supplied with the study are not disclosed", flips: ["supplied-counts"], apply: edit("limitations", "{supplied > 0 ? (", "{false ? (") },
  { label: "Appendix B says audit", flips: ["banned-copy"], apply: edit("limitations", "acting on any recommendation.", "acting on any recommendation or audit.") },
  // ---- the shared disclosures (study-disclosures.ts) ---------------------------------
  { label: "the non-auto share is always read as zero", flips: ["pa-credits-limitations", "pa-credits-appendix", "no-false-no-credits", "ga-applied-values"], apply: edit("disclosures", "nonAutoPct: share == null ? null : Math.max(0, Math.round((1 - share) * 100)),", "nonAutoPct: share == null ? null : 0,") },
  { label: "an absent autoModeShareApplied is guessed as 100% auto", flips: ["unknown-neutral"], apply: edit("disclosures", "const share = finite(report.autoModeShareApplied);", "const share = finite(report.autoModeShareApplied) ?? 1;") },
  { label: "no region is read as Georgia", flips: ["ga-gdot-kept", "ga-other-metro"], apply: edit("disclosures", 'isGeorgia: metro.state === "GA",', "isGeorgia: false,") },
  { label: "the region phrase loses its article", flips: ["pa-region", "ga-gdot-kept", "ga-other-metro"], apply: edit("disclosures", "return /\\b(MSA|CSA|CMA|CMM|ZM)$/.test(name) ? `the ${name}` : name;", "return name;") },
  { label: "all-zero credits are never recognised", flips: ["ga-zero-none"], apply: edit("disclosures", "const allZero = pb === 0 && ic === 0 && na === 0;", "const allZero = false;") },
  // ---- Appendix A (tis-methodology-appendix.tsx) -------------------------------------
  { label: "§A.1 always says the rates carry no credits", flips: ["pa-credits-appendix", "no-false-no-credits"], apply: edit("appendix", "{credits.allZero ? (", "{true ? (") },
  { label: "§A.4 cites GDOT-RPM for every study", flips: ["pa-no-georgia", "unknown-neutral", "pa-road-owner"], apply: edit("appendix", "{region.isGeorgia ? (", "{true ? (") },
  { label: "§A.6 lists GDOT-RPM for every study", flips: ["pa-no-georgia", "unknown-neutral"], apply: edit("appendix", '.filter(([key]) => key !== "GDOT_RPM" || region.isGeorgia)', ".filter(() => true)") },
  { label: "§A.4 drops the road owner's permitting requirements", flips: ["pa-road-owner"], apply: edit("appendix", "the road owner under its permitting requirements: the state highway agency's for", "the road owner: the state highway agency for") },
  // ---- the footer and the page --------------------------------------------------------
  { label: "the footer names the Atlanta analyzer again", flips: ["footer-neutral"], apply: edit("footer", "Screening-level TIS generated by {PRODUCT_NAME}.", "Screening-level TIS generated by Atlanta Traffic Inefficiency Analyzer.") },
  { label: "the footer ignores firm branding", flips: ["footer-neutral"], apply: edit("footer", "{isFirmConfigured(firm) ? (", "{false ? (") },
  { label: "the page renders TisLimitations without the report", flips: ["page-wiring"], apply: edit("page", "<TisLimitations report={report} />", "<TisLimitations />") },
  { label: "the page drops the footer component", flips: ["page-wiring"], apply: edit("page", "<TisReportFooter firm={firm} />", "") },
];

let teethFails = 0;
const teeth = (pass, msg) => {
  console.log(`${pass ? "PASS" : "FAIL"}  [teeth] ${msg}`);
  if (!pass) teethFails++;
};
for (const m of MUTATIONS) {
  const unknown = m.flips.filter((id) => !ids.includes(id));
  if (unknown.length) teeth(false, `"${m.label}" names unknown checks: ${unknown.join(", ")}`);
  let mutated;
  try {
    mutated = m.apply(SOURCES);
  } catch (e) {
    teeth(false, `"${m.label}" applies (${e instanceof Error ? e.message : e})`);
    continue;
  }
  const changed = Object.keys(FILES).filter((f) => mutated[f] !== SOURCES[f]);
  const codeChanged = changed.length > 0 && changed.every((f) => codeOf(f, mutated[f]) !== codeOf(f, SOURCES[f]));
  const now = redIds(await suite(mutated));
  const want = [...m.flips].sort().join(", ");
  const got = [...now].sort().join(", ");
  teeth(codeChanged && want === got, `"${m.label}" changes code in ${changed.join(", ") || "(nothing)"} and turns red exactly: ${want}${want === got ? "" : ` (actually red: ${got || "(none)"})`}`);
}
const covered = new Set(MUTATIONS.flatMap((m) => m.flips));
const toothless = ids.filter((id) => id !== "bundles" && !covered.has(id));
teeth(toothless.length === 0, `every check has a mutation that turns it red${toothless.length ? ` (none for: ${toothless.join(", ")})` : ""}`);

console.log(teethFails === 0 ? "\ncheck:region-limitations passed" : `\n${teethFails} TEETH CHECK(S) FAILED`);
process.exit(teethFails === 0 ? 0 : 1);
