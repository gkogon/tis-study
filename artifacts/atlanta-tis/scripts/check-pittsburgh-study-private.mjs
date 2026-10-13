// Headless check for the private Pittsburgh sample-study page
// (/pittsburgh-study-private, pages/pittsburgh-study-private.tsx).
//
// Pins what the page promises to whoever it is screen-shared with:
//   1. the route exists, is lazy (React.lazy + dynamic import — no static
//      import of the page anywhere), and nothing in src links to it;
//   2. robots.txt disallows it, the sitemap omits it, and the page installs
//      <meta name="robots" content="noindex, nofollow"> while mounted (the
//      helper is exercised against a fake document, and the page is checked
//      to call it from an effect);
//   3. the static payload under public/samples parses and carries every
//      field the page reads;
//   4. the page's pure helpers (lib/pittsburgh-study.ts) produce the
//      report's own numbers — headline tiles, LOS distributions for the
//      three scenarios, per-period trip waterfalls, mitigation counts,
//      top-delay / top-queue rows, and the "Method and limits" copy;
//   5. no Atlanta / GDOT wording and none of the banned review phrases in
//      the page, its helpers, or the report text it renders;
//   6. when a production build is present (dist/public), the page's code is
//      in a separate chunk, not the entry bundle.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, relative } from "node:path";

let failed = 0;
const ok = (c, m) => { if (c) console.log("  ok  " + m); else { failed++; console.log("  FAIL " + m); } };
const near = (a, b, eps = 1e-9) => typeof a === "number" && Math.abs(a - b) <= eps;
const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const src = join(root, "src");
const ROUTE = "/pittsburgh-study-private";
const PAGE_FILE = join(src, "pages", "pittsburgh-study-private.tsx");
const LIB_FILE = join(src, "lib", "pittsburgh-study.ts");
const JSON_FILE = join(root, "public", "samples", "pittsburgh-mcknight-2026-10-05.json");

// ---- 1. route: registered, lazy, unlinked ----
console.log("route");
const app = read(join(src, "App.tsx")) ?? "";
ok(new RegExp(`<Route\\s+path="${ROUTE}"`).test(app), `App.tsx registers <Route path="${ROUTE}">`);
ok(/lazy\(\s*\(\)\s*=>\s*import\(\s*["']@\/pages\/pittsburgh-study-private["']\s*\)\s*\)/.test(app), "the page is React.lazy(() => import(\"@/pages/pittsburgh-study-private\"))");
ok(/<Suspense\b/.test(app), "App.tsx wraps the lazy page in <Suspense>");
const pageImportRe = /^\s*import\s+[^;]*?from\s+["'][^"']*pages\/pittsburgh-study-private["']/m;
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(tsx?|jsx?|mjs)$/.test(name)) out.push(p);
  }
  return out;
}
const srcFiles = walk(src);
const staticImporters = srcFiles.filter((f) => pageImportRe.test(readFileSync(f, "utf8")));
ok(staticImporters.length === 0, `no static import of the page anywhere in src${staticImporters.length ? ` (found in ${staticImporters.map((f) => relative(root, f)).join(", ")})` : ""}`);
const linkers = srcFiles
  .filter((f) => f !== PAGE_FILE && f !== LIB_FILE && !f.endsWith(join("src", "App.tsx")))
  .filter((f) => readFileSync(f, "utf8").includes(ROUTE));
ok(linkers.length === 0, `nothing else in src names the route (unlisted)${linkers.length ? ` — ${linkers.map((f) => relative(root, f)).join(", ")}` : ""}`);
ok(!new RegExp(`href=["'\`]${ROUTE}`).test(app), "App.tsx carries no link to the route (only the <Route>)");

// ---- 2. crawl / index controls ----
console.log("crawl and index");
const robots = read(join(root, "public", "robots.txt")) ?? "";
ok(robots.split(/\r?\n/).some((l) => l.trim() === `Disallow: ${ROUTE}`), `robots.txt has "Disallow: ${ROUTE}"`);
const sitemap = read(join(root, "public", "sitemap.xml")) ?? "";
ok(sitemap.length > 0 && !sitemap.includes("pittsburgh-study-private"), "sitemap.xml omits the page");
const page = read(PAGE_FILE);
ok(page !== null, "pages/pittsburgh-study-private.tsx exists");
ok(page !== null && /useEffect\(\s*\(\)\s*=>\s*installRobotsNoIndex\(document\)/.test(page), "the page installs the noindex meta from an effect (and returns its cleanup)");

let lib = null;
try { lib = await import(pathToFileURL(LIB_FILE).href); } catch (e) { console.log(`  (lib import failed: ${e?.message ?? e})`); }
ok(lib !== null, "lib/pittsburgh-study.ts loads under node");

if (lib) {
  // A fake <head> with the four calls the helper makes.
  const fakeDoc = () => {
    const kids = [];
    const mk = (tag) => {
      const attrs = new Map();
      const el = {
        tagName: tag.toUpperCase(),
        setAttribute: (k, v) => attrs.set(k, String(v)),
        getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
        removeAttribute: (k) => attrs.delete(k),
        remove: () => { const i = kids.indexOf(el); if (i >= 0) kids.splice(i, 1); },
      };
      return el;
    };
    const head = {
      appendChild: (el) => { kids.push(el); return el; },
      querySelector: (sel) => (sel === 'meta[name="robots"]' ? kids.find((k) => k.tagName === "META" && k.getAttribute("name") === "robots") ?? null : null),
    };
    return { head, createElement: mk, kids, mk };
  };
  const d1 = fakeDoc();
  const undo1 = lib.installRobotsNoIndex(d1);
  const m1 = d1.head.querySelector('meta[name="robots"]');
  ok(m1 && m1.getAttribute("content") === "noindex, nofollow", "installRobotsNoIndex adds <meta name=robots content=\"noindex, nofollow\">");
  undo1();
  ok(d1.head.querySelector('meta[name="robots"]') === null, "its cleanup removes the meta it added");
  const d2 = fakeDoc();
  const pre = d2.mk("meta"); pre.setAttribute("name", "robots"); pre.setAttribute("content", "index, follow"); d2.head.appendChild(pre);
  const undo2 = lib.installRobotsNoIndex(d2);
  ok(pre.getAttribute("content") === "noindex, nofollow" && d2.kids.length === 1, "an existing robots meta is overridden in place, not duplicated");
  undo2();
  ok(pre.getAttribute("content") === "index, follow", "and restored on cleanup");
}

// ---- 3. the static payload ----
console.log("payload");
let payload = null;
try { payload = JSON.parse(read(JSON_FILE) ?? "null"); } catch (e) { console.log(`  (parse failed: ${e?.message ?? e})`); }
ok(payload !== null && typeof payload === "object", `public/samples/${JSON_FILE.split("/").pop()} parses`);
if (lib && payload) {
  const problems = lib.payloadProblems(payload);
  ok(problems.length === 0, `payload carries every field the page reads${problems.length ? ` — missing/invalid: ${problems.slice(0, 8).join(", ")}` : ""}`);
  ok(lib.payloadProblems({ ...payload, report: { ...payload.report, periodReports: undefined } }).some((p) => p.includes("periodReports")), "payloadProblems names a missing report.periodReports (it is not a rubber stamp)");
  ok(lib.payloadProblems(null).length > 0, "payloadProblems rejects null");
}

// ---- 4. helpers on the real report ----
if (lib && payload) {
  const r = payload.report;
  const rows = r.affectedIntersections;
  console.log("headline");
  const h = lib.headlineStats(payload);
  ok(h.dailyTrips === 16000 && h.dailyTrips === r.tripGeneration.dailyTrips, `daily trips 16,000 (${h.dailyTrips})`);
  ok(h.pmGross === 1600 && h.pmNetExternal === 860, `PM peak 1,600 gross → 860 net external (${h.pmGross} → ${h.pmNetExternal})`);
  ok(h.intersections === 36 && h.intersections === r.intersectionsStudied, `36 signalized intersections studied (${h.intersections})`);
  ok(h.losDrops === 8 && h.losDrops === r.intersectionsWithLosDrop, `8 LOS drops — the report's own field (${h.losDrops})`);
  ok(h.atLosEf === 8 && h.atLosEf === r.intersectionsAtLosEf, `8 at LOS E/F under Build — the report's own field (${h.atLosEf})`);
  ok(near(h.worstDelta, 58.9, 1e-6) && h.worstRow?.name === "Perrysville Avenue & West View Avenue", `worst Δ delay +58.9 s at Perrysville Avenue & West View Avenue (${h.worstDelta} at ${h.worstRow?.name})`);
  ok(lib.countLosDrops(rows) === r.intersectionsWithLosDrop, `counting rows whose Build LOS is worse than No-Build reproduces intersectionsWithLosDrop (${lib.countLosDrops(rows)})`);
  ok(lib.countAtLosEf(rows, "build") === r.intersectionsAtLosEf, `counting Build E/F rows reproduces intersectionsAtLosEf (${lib.countAtLosEf(rows, "build")})`);

  console.log("LOS by scenario (existing / no-build / build)");
  const dist = (sc) => lib.LOS_GRADES.map((g) => lib.losDistribution(rows, sc)[g]);
  ok(JSON.stringify(dist("existing")) === "[3,11,13,8,0,1]", `existing-year A–F counts 3/11/13/8/0/1 (${dist("existing").join("/")})`);
  ok(JSON.stringify(dist("noBuild")) === "[3,11,13,6,2,1]", `opening-year No-Build A–F counts 3/11/13/6/2/1 (${dist("noBuild").join("/")})`);
  ok(JSON.stringify(dist("build")) === "[3,11,10,4,7,1]", `opening-year Build A–F counts 3/11/10/4/7/1 (${dist("build").join("/")})`);
  ok(["existing", "noBuild", "build"].every((sc) => dist(sc).reduce((s, n) => s + n, 0) === rows.length), "every scenario's counts sum to the 36 studied rows");
  ok(lib.rowLos(rows[0], "existing") === rows[0].currentLos && lib.rowLos(rows[0], "noBuild") === rows[0].existingLos && lib.rowLos(rows[0], "build") === rows[0].futureLos, "rowLos maps existing→currentLos, No-Build→existingLos, Build→futureLos (the PDF's §8.1 columns)");
  ok(lib.existingYear(r) === 2026 && lib.existingYear(r) === r.request.openingYear - r.growthYears, `existing year 2026 = opening 2028 − ${r.growthYears} growth years (${lib.existingYear(r)})`);
  ok(near(lib.growthMultiplier(r), 1.030225, 1e-9) && near(lib.growthMultiplier(r), r.growthMultiplierExact, 1e-9), `growth multiplier ×1.030225 equals the report's growthMultiplierExact (${lib.growthMultiplier(r)})`);

  console.log("trip generation waterfalls");
  const want = {
    am_peak: [640, 48, 0, 137, 455, 277, 178],
    pm_peak: [1600, 480, 0, 260, 860, 413, 447],
    saturday_midday: [1760, 132, 0, 378, 1250, 625, 625],
    daily: [16000, 1200, 0, 3436, 11364, 5682, 5682],
  };
  for (const p of r.periodReports) {
    const w = lib.periodWaterfall(p);
    const got = [w.gross, w.passBy, w.internalCapture, w.nonAuto, w.external, w.inTrips, w.outTrips];
    ok(JSON.stringify(got) === JSON.stringify(want[p.period]), `${p.period}: gross/pass-by/internal/non-auto/external/in/out = ${want[p.period].join("/")} (${got.join("/")})`);
    ok(w.gross - w.passBy - w.internalCapture - w.nonAuto === w.external && w.inTrips + w.outTrips === w.external, `${p.period}: the waterfall closes (gross − credits − non-auto = external = in + out)`);
  }
  const pm = lib.periodWaterfall(r.periodReports.find((p) => p.period === "pm_peak"));
  const am = lib.periodWaterfall(r.periodReports.find((p) => p.period === "am_peak"));
  ok(near(pm.passByPct, 30) && near(am.passByPct, 7.5), `pass-by share 30% at the PM peak, 7.5% at the AM peak (${pm.passByPct}%, ${am.passByPct}%)`);
  ok(lib.isGradedPeriod("pm_peak") && !lib.isGradedPeriod("am_peak") && !lib.isGradedPeriod("saturday_midday") && !lib.isGradedPeriod("daily"), "only the weekday PM peak is graded (as the PDF's §3.3 says)");

  console.log("delay, queues, mitigation");
  const top = lib.topByDelayDelta(rows, 3).map((x) => x.name);
  ok(JSON.stringify(top) === JSON.stringify(["Perrysville Avenue & West View Avenue", "Perrysville Avenue & Nelson Run Road", "Cemetery Lane & Babcock Boulevard"]), `top delay changes: ${top.join("; ")}`);
  ok(near(lib.delayDelta(rows.find((x) => x.name === "Perrysville Avenue & Nelson Run Road")), 32.1, 1e-6), "delayDelta is Build − No-Build delay (Perrysville & Nelson Run +32.1 s)");
  const q = lib.topByQueue(rows, 10);
  ok(q.length === 10 && near(q[0].queue95thFt, 1303.2, 1e-9) && q.every((x, i) => i === 0 || q[i - 1].queue95thFt >= x.queue95thFt), `top-10 queues sorted, longest 1,303 ft (${q[0]?.queue95thFt})`);
  ok(lib.criticalApproach(q[0]) === "WB" && q.every((x) => { const d = lib.criticalApproach(x); return d && near(x.approaches.find((a) => a.direction === d).queue95thFt, x.queue95thFt, 1e-9); }), `the critical approach carries the row's queue (longest: ${q[0]?.name} ${lib.criticalApproach(q[0])})`);
  ok(lib.queueVehicles(1303.2) === 52,`a 1,303 ft queue is 52 vehicles at 25 ft each (${lib.queueVehicles(1303.2)})`);
  const sev = lib.severityCounts(rows);
  ok(sev.major === 17 && sev.moderate === 4 && sev.minor === 2 && sev.none === 13, `mitigation severity counts 17 major / 4 moderate / 2 minor / 13 none (${sev.major}/${sev.moderate}/${sev.minor}/${sev.none})`);
  const split = lib.splitMitigation(h.worstRow.mitigation);
  ok(split.verdict.startsWith("Major:") && split.horizon === "opening year (opening year +58.9s, design year +2.4s)", `splitMitigation separates the verdict from its governing horizon ("${split.horizon}")`);
  ok(lib.splitMitigation("No mitigation indicated.").horizon === null, "a verdict with no governing horizon keeps horizon null");

  console.log("formatting");
  ok(lib.fmtInt(16000) === "16,000" && lib.fmtInt(1303.2) === "1,303", "fmtInt groups thousands and rounds");
  ok(lib.fmtSignedSec(58.9) === "+58.9 s" && lib.fmtSignedSec(-1.25) === "−1.3 s" && lib.fmtSignedSec(0) === "+0.0 s", "fmtSignedSec signs and rounds to 0.1 s");

  console.log("method and limits");
  const facts = lib.methodFacts(payload);
  const text = facts.map((f) => `${f.label}: ${f.text}`).join("\n");
  for (const needle of [
    "Pittsburgh MSA, Pennsylvania",
    "1.50%/yr",
    "over 2 years",
    "×1.030",
    "2026 to 2028",
    r.growthSource,
    "30% at the PM peak",
    "7.5% at the AM peak",
    "Internal capture 0%",
    "76.8%",
    r.autoModeShareSource,
    "weekday PM peak hour only",
    "Webster/Akçelik",
    "HCS or Synchro",
    "within 2 miles",
    "36 signalized intersections",
  ]) ok(text.includes(needle), `method copy says "${needle.length > 70 ? needle.slice(0, 70) + "…" : needle}"`);
  ok(lib.SCREENING_NOTE === "Screening estimate — not for design submittal without verification by a licensed PE.", "the screening note is the agreed sentence");
}

// ---- 5. wording ----
console.log("wording");
const BANNED = /independent review|second opinion|peer review|qa\/qc|\baudit|atlanta|gdot/i;
const pageSrc = page ?? "";
const libSrc = read(LIB_FILE) ?? "";
const m1 = pageSrc.match(BANNED), m2 = libSrc.match(BANNED);
ok(pageSrc.length > 0 && !m1, `page source has no banned / Atlanta wording${m1 ? ` ("${m1[0]}")` : ""}`);
ok(libSrc.length > 0 && !m2, `helper source has no banned / Atlanta wording${m2 ? ` ("${m2[0]}")` : ""}`);
if (payload) {
  const m3 = JSON.stringify(payload).match(BANNED);
  ok(!m3, `the report text the page renders has no banned / Atlanta wording${m3 ? ` ("${m3[0]}")` : ""}`);
}
if (lib && payload) {
  const m4 = lib.methodFacts(payload).map((f) => f.label + " " + f.text).join(" ").match(BANNED);
  ok(!m4, "the generated method copy has no banned wording");
}

// ---- 6. code-split (only when a build is present) ----
console.log("bundle");
const dist = join(root, "dist", "public");
const indexHtml = read(join(dist, "index.html"));
if (!indexHtml) {
  console.log("  skip no dist/public — run the vite build to check the code split");
} else {
  const entry = (indexHtml.match(/src="\/?(assets\/index-[^"]+\.js)"/) ?? [])[1];
  const assets = readdirSync(join(dist, "assets")).filter((f) => f.endsWith(".js"));
  const MARK = "pgh-study-private-root";
  const entrySrc = entry ? readFileSync(join(dist, entry), "utf8") : "";
  const holders = assets.filter((f) => readFileSync(join(dist, "assets", f), "utf8").includes(MARK));
  ok(!!entry && !entrySrc.includes(MARK), `the entry bundle (${entry ?? "?"}) does not carry the page`);
  ok(holders.length === 1 && `assets/${holders[0]}` !== entry, `the page lives in its own chunk (${holders.join(", ") || "none"})`);
  ok(existsSync(join(dist, "samples", "pittsburgh-mcknight-2026-10-05.json")), "the payload ships as a static file in the build");
  ok(!entrySrc.includes("McKnight Road Retail Development"), "the payload is not inlined into the entry bundle");
}

if (failed) { console.log(`\ncheck:pittsburgh-study-private FAILED (${failed})`); process.exit(1); }
console.log("\ncheck:pittsburgh-study-private passed");
