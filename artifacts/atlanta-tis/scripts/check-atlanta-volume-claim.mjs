// The site must not say Atlanta's volumes are counted.
//
// Atlanta design-hour volumes are modeled from road class x distance from
// downtown x a fixed per-signal factor (api-server/src/lib/atlanta-analysis.ts);
// no Atlanta signal is joined to an AADT count, and GDOT 511 incident reports
// feed only a per-signal delay multiplier. The coverage catalog used to give
// Atlanta `aadtPct: 100, aadtSource: "GDOT calibrated counts"` (quality
// defaulting to "measured"), so /cities/atlanta printed "100% of intersections
// calibrated to measured GDOT calibrated counts traffic counts" in its meta
// description and a "Measured AADT 100.0%" stat, and the coverage tables
// counted Atlanta as Tier-A measured AADT.
//
// What is rendered (esbuild bundle + react-dom/server, wouter ssrPath):
//   /cities/atlanta          the page text and the meta description it sets
//   /cities/augusta          the sibling row it prints for Atlanta
//   /cities                  the Atlanta row and the "With measured AADT" stat
//   CoverageGrid / MetroRow  the "Tier-A AADT" stat and Atlanta's AADT cell
//   metroTone(atlanta)       the /cities map tooltip label
// plus a static scan of src/, index.html and public/ for "GDOT calibrated counts".
//
// Atlanta keeps its flagship placement (the "Flagship" label); that is asserted
// too, so the fix cannot be "delete Atlanta".
//
// TEETH: MUTATIONS edit the sources IN MEMORY, the suite runs again on the
// edited text, and each mutation must turn red exactly the checks it names.
// A check no mutation turns red fails the run.
//
// Run: `pnpm run check:atlanta-volume-claim`
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const viaVite = createRequire(createRequire(import.meta.url).resolve("vite/package.json"));
const { build } = viaVite("esbuild");

const FILES = {
  data: "src/data/metro-coverage.ts",
  city: "src/pages/city-detail.tsx",
  cities: "src/pages/cities.tsx",
  grid: "src/components/coverage-grid.tsx",
  map: "src/components/metro-map.tsx",
};
const ABS = Object.fromEntries(Object.entries(FILES).map(([k, rel]) => [k, path.join(root, rel)]));
const SOURCES = Object.freeze(Object.fromEntries(Object.entries(ABS).map(([k, abs]) => [k, readFileSync(abs, "utf8")])));

const BANNED = ["independent review", "second opinion", "peer review", "QA/QC", "audit"];
const COUNT_CLAIMS = [/calibrated to measured/i, /GDOT calibrated counts/i, /calibrated to state-DOT counts/i];

// ─── the bundle, from the text under test ────────────────────────────────────
const ENTRY = `
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import CityDetailPage from "${ABS.city}";
import CitiesPage from "${ABS.cities}";
import * as grid from "${ABS.grid}";
import { metroTone } from "${ABS.map}";
import { METROS, TIER_A_AADT_CUTOFF } from "${ABS.data}";
const { CoverageGrid, MetroRow } = grid;
export { createElement, renderToStaticMarkup, Router, CityDetailPage, CitiesPage, CoverageGrid, MetroRow, metroTone, METROS, TIER_A_AADT_CUTOFF };
`;
const STUB_META = `export function usePageMeta(o) { (globalThis.__pageMeta ??= []).push(o); }`;
const STUB_NULL = `export function MetroSignalMap() { return null; }`;
const STUB_LEAFLET = `const N = () => null; export const MapContainer = N, CircleMarker = N, Tooltip = N, TileLayer = N, useMap = () => ({});`;

async function bundle(src) {
  const out = await build({
    absWorkingDir: root,
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    jsx: "automatic",
    tsconfigRaw: "{}",
    define: { "process.env.NODE_ENV": '"development"' },
    alias: { "@": path.join(root, "src") },
    banner: { js: `import { createRequire as __cr } from "node:module"; const require = __cr(${JSON.stringify(import.meta.url)});` },
    logLevel: "silent",
    stdin: { contents: ENTRY, resolveDir: root, sourcefile: "atlanta-volume-claim-entry.ts", loader: "ts" },
    plugins: [
      {
        name: "text-under-test",
        setup(b) {
          b.onResolve({ filter: /use-page-meta$/ }, () => ({ path: "meta", namespace: "stub" }));
          b.onResolve({ filter: /metro-signal-map$/ }, () => ({ path: "signal-map", namespace: "stub" }));
          b.onResolve({ filter: /^(react-leaflet|leaflet)$/ }, () => ({ path: "leaflet", namespace: "stub" }));
          b.onResolve({ filter: /\.css$/ }, () => ({ path: "css", namespace: "stub" }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
            contents: a.path === "meta" ? STUB_META : a.path === "signal-map" ? STUB_NULL : a.path === "leaflet" ? STUB_LEAFLET : "",
            loader: "js",
          }));
          for (const [key, abs] of Object.entries(ABS)) {
            const re = new RegExp(`${abs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
            b.onLoad({ filter: re }, (a) => (a.path === abs ? { contents: src[key], loader: abs.endsWith(".tsx") ? "tsx" : "ts", resolveDir: path.dirname(abs) } : undefined));
          }
        },
      },
    ],
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}

const INLINE = /<\/?(?:strong|em|b|i|span|sub|sup|a|code)\b[^>]*>/g;
const text = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(INLINE, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
const sentences = (t) => t.split(/(?<=[.;])\s+/);
/** The rendered <a data-testid=…> element's text. */
const testidText = (html, id) => {
  const i = html.indexOf(`data-testid="${id}"`);
  if (i < 0) return null;
  const end = html.indexOf("</a>", i);
  return text(html.slice(html.lastIndexOf("<", i), end));
};

// ─── static scan (src/, index.html, public/) ─────────────────────────────────
function staticHits(src) {
  const hits = [];
  const walk = (dir) => {
    for (const n of readdirSync(dir)) {
      const p = path.join(dir, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|html|xml|txt|json)$/.test(n)) {
        const key = Object.keys(ABS).find((k) => ABS[k] === p);
        const body = key ? src[key] : readFileSync(p, "utf8");
        if (/GDOT calibrated counts/i.test(body)) hits.push(path.relative(root, p));
      }
    }
  };
  walk(path.join(root, "src"));
  walk(path.join(root, "public"));
  if (/GDOT calibrated counts/i.test(readFileSync(path.join(root, "index.html"), "utf8"))) hits.push("index.html");
  return hits;
}

// ─── the suite ───────────────────────────────────────────────────────────────
async function suite(src) {
  const out = [];
  const check = (id, pass, msg) => out.push({ id, pass: !!pass, msg });
  let mod;
  try {
    mod = await bundle(src);
  } catch (e) {
    check("bundles", false, `the sources bundle (${e instanceof Error ? e.message.split("\n")[0] : e})`);
    return out;
  }
  check("bundles", true, "the sources bundle");
  const { createElement: h, renderToStaticMarkup, Router, CityDetailPage, CitiesPage, CoverageGrid, MetroRow, metroTone, METROS, TIER_A_AADT_CUTOFF } = mod;
  const page = (ssrPath, C) => {
    globalThis.__pageMeta = [];
    const html = renderToStaticMarkup(h(Router, { ssrPath }, h(C)));
    return { html, meta: globalThis.__pageMeta.at(-1) ?? {} };
  };
  const atl = METROS.find((m) => m.code === "atlanta_metro");
  // Independent of the site's own helpers: measured AADT at or above the cutoff.
  const measuredTierA = METROS.filter((m) => (m.aadtQuality ?? "measured") === "measured" && m.aadtPct >= TIER_A_AADT_CUTOFF).length;

  // data
  check("data", atl && atl.aadtQuality === "modeled" && atl.aadtPct === 0,
    `the Atlanta catalog entry is aadtQuality "modeled" with aadtPct 0 (got ${atl ? `${JSON.stringify(atl.aadtQuality)}, ${atl.aadtPct}` : "no entry"})`);

  // /cities/atlanta
  const city = page("/cities/atlanta", CityDetailPage);
  const desc = city.meta.description ?? "";
  const claimIn = (t) => COUNT_CLAIMS.filter((re) => re.test(t)).map(String);
  check("meta", claimIn(desc).length === 0 && /modeled from road class and distance from downtown, not counted/.test(desc),
    `the /cities/atlanta meta description says volumes are modeled, not counted, and makes no count claim${claimIn(desc).length ? ` (found ${claimIn(desc).join(", ")})` : ""} — "${desc}"`);
  const body = text(city.html);
  const bodyClaims = [...claimIn(body), ...(/Measured AADT/.test(body) ? ["Measured AADT stat"] : []), ...(/Tier-A coverage/.test(body) ? ["Tier-A coverage label"] : [])];
  check("page", bodyClaims.length === 0 && /Modeled, not counted\./.test(body) && /No signal in Atlanta MSA is joined to an AADT count/.test(body),
    `the /cities/atlanta page says "Modeled, not counted." with no signal joined to a count, and shows no count claim${bodyClaims.length ? ` (found ${bodyClaims.join(", ")})` : ""}`);
  // The site footer's data-source list ("Data: OpenStreetMap, state DOT and FHWA AADT, GDOT 511 incidents
  // (Atlanta)", reworded by #246) names GDOT 511 as an incident source, not a volume source; cut it before
  // reading, so "AADT" earlier in that list is not read as a claim about GDOT 511.
  const bodyNoFooter = body.replace(/Data: [^.]*?GDOT 511 incidents \(Atlanta\)/g, " ");
  const g511 = sentences(`${bodyNoFooter} ${desc}`).filter((s) => /GDOT 511/.test(s) && /count|AADT|calibrat/i.test(s));
  const g511Delay = /GDOT 511 incident reports are used only as a delay factor/.test(body);
  check("gdot-511-delay-only", g511.length === 0 && g511Delay,
    `GDOT 511 is described on /cities/atlanta only as a delay factor${g511.length ? ` — ${g511.map((s) => `"${s}"`).join("; ")}` : g511Delay ? "" : " (the delay-factor sentence is missing)"}`);
  check("flagship-kept", /· Flagship/.test(body), "/cities/atlanta keeps its Flagship label");

  // /cities/augusta: the Atlanta sibling row
  const aug = page("/cities/augusta", CityDetailPage);
  const sib = testidText(aug.html, "link-sibling-atlanta") ?? "";
  check("sibling", /modeled/.test(sib) && !/%/.test(sib), `the Atlanta sibling row on /cities/augusta reads "modeled", not a percentage — "${sib}"`);

  // /cities
  const cities = page("/cities", CitiesPage);
  const row = testidText(cities.html, "city-row-atlanta_metro") ?? "";
  const statM = text(cities.html).match(/(\d+) With measured AADT/);
  const statN = statM ? Number(statM[1]) : NaN;
  const rowBad = [...claimIn(row), ...(/Tier-A/.test(row) ? ["Tier-A"] : []), ...(/100\.0%/.test(row) ? ["100.0%"] : [])];
  check("cities", rowBad.length === 0 && /modeled/.test(row) && /Flagship/.test(row) && statN === measuredTierA,
    `/cities: the Atlanta row reads "modeled" (Flagship kept, no Tier-A or count claim) and "With measured AADT" is ${measuredTierA} (got ${statN})${rowBad.length ? ` — found ${rowBad.join(", ")}` : ""} — "${row}"`);

  // CoverageGrid
  const gridText = text(renderToStaticMarkup(h(Router, { ssrPath: "/" }, h(CoverageGrid))));
  const tierM = gridText.match(/(\d+) Tier-A AADT/);
  // MetroRow is exported for this check; before it was, the row is unreadable.
  const rowHtml = MetroRow ? renderToStaticMarkup(h(Router, { ssrPath: "/" }, h(MetroRow, { m: atl }))) : "(MetroRow is not exported)";
  const gridRow = text(rowHtml);
  check("grid", tierM && Number(tierM[1]) === measuredTierA && /modeled/.test(gridRow) && !/100\.0%/.test(gridRow) && /Flagship/.test(gridRow),
    `coverage grid: "Tier-A AADT" is ${measuredTierA} (got ${tierM ? tierM[1] : "none"}) and Atlanta's AADT cell reads "modeled", Flagship kept — "${gridRow}"`);

  // map tooltip label
  const tone = metroTone(atl).label;
  check("map", !/calibrat/i.test(tone) && /modeled, not counted/.test(tone), `the /cities map labels Atlanta without a calibration claim, volumes modeled — "${tone}"`);

  // static
  const hits = staticHits(src);
  check("static", hits.length === 0, `no "GDOT calibrated counts" in src/, index.html or public/${hits.length ? ` — ${hits.join(", ")}` : ""}`);

  // banned copy
  const all = [body, desc, sib, row, gridRow, tone].join(" ");
  const banned = BANNED.filter((w) => new RegExp(`\\b${w.replace(/[/]/g, "\\/")}\\b`, "i").test(all));
  check("banned-copy", banned.length === 0, `no ${BANNED.map((w) => `"${w}"`).join(", ")} in the Atlanta copy${banned.length ? ` — ${banned.join(", ")}` : ""}`);
  return out;
}

// ─── run ─────────────────────────────────────────────────────────────────────
const baseline = await suite(SOURCES);
let fails = 0;
for (const r of baseline) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  [${r.id}] ${r.msg.trim()}`);
  if (!r.pass) fails++;
}
if (fails > 0) {
  console.log(`\n${fails} CHECK(S) FAILED (mutations not run: the suite is not green)`);
  process.exit(1);
}
const ids = [...new Set(baseline.map((r) => r.id))];
const redIds = (results) => [...new Set(results.filter((r) => !r.pass).map((r) => r.id))];

// ─── TEETH ───────────────────────────────────────────────────────────────────
const edit = (file, from, to) => (s) => {
  const n = s[file].split(from).length - 1;
  if (n !== 1) throw new Error(`the anchor ${JSON.stringify(from.slice(0, 70))} occurs ${n} times in ${file}`);
  return { ...s, [file]: s[file].replace(from, () => to) };
};
const both = (...fs) => (s) => fs.reduce((acc, f) => f(acc), s);

const MUTATIONS = [
  {
    label: "the Atlanta catalog entry goes back to 100% \"GDOT calibrated counts\"",
    flips: ["data", "meta", "page", "gdot-511-delay-only", "sibling", "cities", "grid", "static"],
    apply: edit("data", 'aadtPct: 0, liveSource: "GDOT 511", aadtSource: "Modeled from road class and distance from downtown (no counts)", aadtQuality: "modeled",', 'aadtPct: 100, liveSource: "GDOT 511", aadtSource: "GDOT calibrated counts",'),
  },
  {
    label: "the meta description says calibrated to measured counts",
    flips: ["meta"],
    apply: edit("city", "` Volumes are modeled from road class and distance from downtown, not counted${", "` 100% of intersections calibrated to measured state-DOT traffic counts${"),
  },
  {
    label: "the stat is labelled Measured AADT",
    // the stat row reads "Measured AADT Modeled Live data feed GDOT 511": a
    // count claim beside GDOT 511, so the delay-only check turns red too
    flips: ["page", "gdot-511-delay-only"],
    apply: edit("city", 'label={isModeledVolumes ? "Volumes" :', 'label={isModeledVolumes ? "Measured AADT" :'),
  },
  {
    label: "the provenance row credits GDOT 511 with counts",
    flips: ["gdot-511-delay-only"],
    apply: edit("city", "factor, at signals with frequent incidents nearby; they do not\n                      supply volumes.", "factor, at signals with frequent incidents nearby, and as calibrated counts."),
  },
  {
    label: "the Flagship label is dropped from /cities/atlanta",
    flips: ["flagship-kept"],
    apply: edit("city", '<span className="text-emerald-700 dark:text-emerald-400">· Flagship</span>', "<span />"),
  },
  {
    label: "the sibling row prints the percentage",
    flips: ["sibling"],
    apply: edit("city", '{s.aadtQuality === "modeled" ? "modeled" : s.aadtPct > 0', "{s.aadtPct > 0"),
  },
  {
    label: "the /cities measured-AADT stat counts Atlanta",
    flips: ["cities"],
    apply: edit("cities", "const tierACount = TIER_A_METROS.length;", 'const tierACount = TIER_A_METROS.length + METROS.filter((m) => m.code === "atlanta_metro").length;'),
  },
  {
    label: "the coverage grid drops the modeled cell",
    flips: ["grid"],
    apply: edit("grid", ' modeled={m.aadtQuality === "modeled"} />', " />"),
  },
  {
    label: "Tier-A takes the flagship back",
    flips: ["cities", "grid"],
    apply: edit("data", "m.aadtPct >= TIER_A_AADT_CUTOFF && isMeasuredAadt(m);", 'm.aadtPct >= TIER_A_AADT_CUTOFF && isMeasuredAadt(m) || m.code === "atlanta_metro";'),
  },
  {
    label: "the map label goes back to full live calibration",
    flips: ["map"],
    apply: edit("map", '"Flagship — live GDOT 511 incidents; volumes modeled, not counted"', '"Flagship — full live calibration"'),
  },
  {
    label: "the provenance row says audit",
    flips: ["banned-copy"],
    apply: edit("city", "turning\n                  movements are modeled too.", "turning\n                  movements are modeled too, pending audit."),
  },
  {
    label: "the meta and the stat both regress",
    flips: ["meta", "page", "gdot-511-delay-only", "static"],
    apply: both(
      edit("city", "` Volumes are modeled from road class and distance from downtown, not counted${", "` Volumes are GDOT calibrated counts${"),
      edit("city", 'label={isModeledVolumes ? "Volumes" :', 'label={isModeledVolumes ? "Measured AADT" :'),
    ),
  },
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
  const got = redIds(await suite(mutated)).sort().join(", ");
  const want = [...m.flips].sort().join(", ");
  teeth(want === got, `"${m.label}" turns red exactly: ${want}${want === got ? "" : ` (actually red: ${got || "(none)"})`}`);
}
const covered = new Set(MUTATIONS.flatMap((m) => m.flips));
const toothless = ids.filter((id) => id !== "bundles" && !covered.has(id));
teeth(toothless.length === 0, `every check has a mutation that turns it red${toothless.length ? ` (none for: ${toothless.join(", ")})` : ""}`);

console.log(teethFails === 0 ? "\ncheck:atlanta-volume-claim passed" : `\n${teethFails} TEETH CHECK(S) FAILED`);
process.exit(teethFails === 0 ? 0 : 1);
