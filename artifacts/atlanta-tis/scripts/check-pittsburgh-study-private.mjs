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
//      in a separate chunk, not the entry bundle — and so is the opener;
//   7. the scroll-driven opener (components/pittsburgh-alive-opener.tsx):
//      every number it narrates is a field of openerStory(payload), derived
//      here independently from the payload and compared; none of those
//      numbers is typed into the opener's (or its sim's) source; the featured
//      signal is McKnight Road & McKnight Circle and never a Perrysville /
//      West View / "Near …" row; a reduced-motion path exists; the opener and
//      its sim are imported by the page only (so they stay in its lazy
//      chunk); and the sim, run headless on the real rows, puts every signal
//      where its coordinates say and runs each on its own cycle;
//   8. the page wires the opener, the "Watch it live" section (the featured
//      signal's micro-simulation) and the LOS map's one-time auto-play.
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
const OPENER_FILE = join(src, "components", "pittsburgh-alive-opener.tsx");
const SIM_FILE = join(src, "lib", "pittsburgh-alive-sim.ts");

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

// ---- 7. the opener: narrated numbers, featured signal, reduced motion, lazy ----
console.log("opener");
const openerSrc = read(OPENER_FILE);
const simSrc = read(SIM_FILE);
ok(openerSrc !== null, "components/pittsburgh-alive-opener.tsx exists");
ok(simSrc !== null, "lib/pittsburgh-alive-sim.ts exists");
const storyApi = !!lib && ["openerStory", "featuredSignal", "isPresentableSignal"].every((k) => typeof lib[k] === "function");
ok(storyApi, "lib/pittsburgh-study.ts exports openerStory, featuredSignal and isPresentableSignal");
if (lib && payload && storyApi) {
  const r = payload.report;
  const rows = r.affectedIntersections;
  const BAD = /perrysville|west view|^\s*near\b/i;
  ok(lib.FEATURED_SIGNAL_ID === "pittsburgh-2402", `the featured signal id is pittsburgh-2402 (${lib.FEATURED_SIGNAL_ID})`);
  const feat = lib.featuredSignal(r);
  ok(feat?.name === "McKnight Road & McKnight Circle", `featuredSignal() is McKnight Road & McKnight Circle (${feat?.name})`);
  ok(!!feat && !BAD.test(feat.name) && /McKnight Road/.test(feat.name), "the featured signal is on McKnight Road and not a Perrysville / West View / \"Near …\" row");
  const badRows = rows.filter((x) => BAD.test(x.name));
  ok(badRows.length >= 5 && badRows.every((x) => !lib.isPresentableSignal(x)), `isPresentableSignal rejects every Perrysville / West View / "Near …" row (${badRows.length} rows)`);
  // even if the pinned id vanished, the fallback never lands on one of them
  const noPin = { ...r, affectedIntersections: rows.filter((x) => x.signalId !== lib.FEATURED_SIGNAL_ID) };
  const fb = lib.featuredSignal(noPin);
  ok(!!fb && !BAD.test(fb.name) && /McKnight Road/.test(fb.name), `without the pinned row the fallback is still a clean McKnight Road signal (${fb?.name})`);

  const story = lib.openerStory(payload);
  // derive every narrated number independently from the payload
  const pm = r.periodReports.find((p) => p.period === "pm_peak").tripGeneration;
  const tg = r.tripGeneration;
  const want = {
    daily: tg.dailyTrips, gross: tg.pmPeakTrips, passBy: Math.round(pm.passByCredit), net: Math.round(pm.externalTrips),
    nonAuto: Math.round(pm.rawTrips) - Math.round(pm.passByCredit) - Math.round(pm.internalCaptureCredit) - Math.round(pm.externalTrips),
    in: Math.round(pm.inTrips), out: Math.round(pm.outTrips),
  };
  ok(story.site.dailyTrips === want.daily && want.daily === 16000, `act 1 daily trips = tripGeneration.dailyTrips (${story.site.dailyTrips})`);
  ok(story.site.pmGross === want.gross && want.gross === 1600, `act 1 PM gross = tripGeneration.pmPeakTrips (${story.site.pmGross})`);
  ok(story.site.pmPassBy === want.passBy && want.passBy === 480 && story.site.passByPct === 30, `act 1 pass-by = the PM period's passByCredit, 30% (${story.site.pmPassBy}, ${story.site.passByPct}%)`);
  ok(story.site.pmNonAuto === want.nonAuto && want.nonAuto === 260, `act 1 transit/walk/bike = gross − credits − external (${story.site.pmNonAuto})`);
  ok(story.site.pmNet === want.net && want.net === 860, `act 1 net new = the PM period's externalTrips (${story.site.pmNet})`);
  ok(story.site.pmIn === want.in && story.site.pmOut === want.out && want.in + want.out === want.net, `act 1 in / out = ${want.in} / ${want.out} (${story.site.pmIn} / ${story.site.pmOut})`);
  ok(near(story.site.autoSharePct, Math.round(r.autoModeShareApplied * 1000) / 10) && near(100 - story.site.autoSharePct, 23.2, 1e-9), `act 1 mode-share credit = 100 − auto share (${(100 - story.site.autoSharePct).toFixed(1)}%)`);
  ok(story.site.sizeLabel === "200,000 sq ft GLA" && story.site.landUseCode === tg.landUseCode && story.site.pmRate === tg.pmRate, `act 1 size / land use / rate from tripGeneration (${story.site.sizeLabel}, LU ${story.site.landUseCode}, ${story.site.pmRate}/ksf)`);
  ok(story.site.rateSource === "SANDAG 2002" && tg.variableSource.startsWith(story.site.rateSource), `act 1 names the rate source from tripGeneration.variableSource (${story.site.rateSource})`);

  const sg = story.signal;
  ok(!!sg && sg.id === feat?.signalId, "act 2 narrates the featured row");
  if (sg && feat) {
    const loaded = feat.approaches.filter((a) => (a.currentVolumeVph ?? 0) > 0 || a.existingVolumeVph > 0 || a.futureVolumeVph > 0);
    ok(JSON.stringify(sg.approaches.map((a) => a.dir)) === JSON.stringify(loaded.map((a) => a.direction)) && sg.approaches.length === 2, `act 2 lists the row's loaded approaches only (${sg.approaches.map((a) => a.dir).join(", ")})`);
    for (const a of sg.approaches) {
      const src = feat.approaches.find((x) => x.direction === a.dir);
      ok(near(a.existing, src.currentVolumeVph) && near(a.noBuild, src.existingVolumeVph) && near(a.build, src.futureVolumeVph) && a.added === src.addedTripsPeak,
        `act 2 ${a.dir}: Existing / No-Build / Build = current / existing / futureVolumeVph, +${a.added} = addedTripsPeak (${a.existing} / ${a.noBuild} / ${a.build})`);
    }
    const sb = sg.approaches.find((a) => a.dir === "SB");
    ok(sb && sb.existing === 809 && sb.noBuild === 833.5 && near(sb.build, 947.9) && sb.added === 114, "act 2 SB reads 809 → 833.5 → 947.9 vph, +114 project");
    ok(sg.approaches.find((a) => a.dir === "WB")?.source === "road-class default" && sb?.source === "AADT design hour", "act 2 tags each approach's volume source from legVolumes (SB AADT design hour, WB road-class default)");
    ok(sg.cycleSec === feat.signalTiming.cycleLenSec && sg.cycleSec === 60 && sg.gNs === feat.signalTiming.gOverCns && sg.gEw === feat.signalTiming.gOverCew && feat.signalTiming.basis === "webster", `act 2 timing = signalTiming (Webster, ${sg.cycleSec} s, g/C ${sg.gNs} / ${sg.gEw})`);
    ok(sg.delay.existing === feat.currentDelaySec && sg.delay.noBuild === feat.existingDelaySec && sg.delay.build === feat.futureDelaySec, `act 2 delay = current / existing / futureDelaySec (${sg.delay.existing} / ${sg.delay.noBuild} / ${sg.delay.build})`);
    ok(sg.los.existing === feat.currentLos && sg.los.noBuild === feat.existingLos && sg.los.build === feat.futureLos && [sg.los.existing, sg.los.noBuild, sg.los.build].join("") === "CCC", "act 2 LOS = current / existing / futureLos (C, C, C)");
    ok(near(sg.distanceMi, feat.distanceMi) && sg.compass === "north" && sg.addedTrips === feat.addedTripsPmPeak, `act 2 says ${sg.distanceMi} mi ${sg.compass} of the site, +${sg.addedTrips} project trips`);
  }
  const efCount = (field) => rows.filter((x) => x[field] === "E" || x[field] === "F").length;
  const drops = rows.filter((x) => "ABCDEF".indexOf(x.futureLos) > "ABCDEF".indexOf(x.existingLos)).length;
  ok(story.area.signals === r.intersectionsStudied && story.area.signals === 36, `act 3 signals = intersectionsStudied (${story.area.signals})`);
  ok(story.area.losDrops === r.intersectionsWithLosDrop && story.area.losDrops === drops && drops === 8, `act 3 grade drops = intersectionsWithLosDrop = counted rows (${story.area.losDrops})`);
  ok(story.area.ef.noBuild === efCount("existingLos") && story.area.ef.build === efCount("futureLos") && story.area.ef.build === r.intersectionsAtLosEf && story.area.ef.noBuild === 3 && story.area.ef.build === 8, `act 3 E/F No-Build → Build = counted rows (${story.area.ef.noBuild} → ${story.area.ef.build})`);
  ok(story.area.radiusMi === r.studyRadiusMi && story.area.openingYear === r.request.openingYear && story.area.existingYear === r.request.openingYear - r.growthYears && story.area.netPmTrips === want.net, "act 3 radius / years / net trips from the report");

  // none of the narrated numbers is typed into the opener or its sim
  if (openerSrc && simSrc) {
    const nums = new Set();
    const add = (n) => { if (typeof n !== "number" || !Number.isFinite(n)) return; for (const v of [String(n), n.toFixed(1), n.toFixed(2), Math.round(n).toLocaleString("en-US"), String(Math.round(n))]) nums.add(v); };
    for (const v of Object.values(story.site)) add(v);
    if (sg) { for (const a of sg.approaches) { add(a.existing); add(a.noBuild); add(a.build); add(a.added); } add(sg.cycleSec); add(sg.gNs); add(sg.gEw); add(sg.distanceMi); add(sg.addedTrips); for (const v of Object.values(sg.delay)) add(v); }
    add(story.area.signals); add(story.area.openingYear); add(story.area.existingYear); add(story.area.netPmTrips);
    // only distinctive values: three or more significant characters, not a bare small integer
    const distinctive = [...nums].filter((v) => v.replace(/[^0-9]/g, "").length >= 3 && !/^(100|1000)$/.test(v));
    const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const hits = [];
    for (const v of distinctive) if (new RegExp(`(?<![0-9.,])${esc(v)}(?![0-9])`).test(strip(openerSrc))) hits.push(v);
    ok(distinctive.length >= 20 && hits.length === 0, `no narrated number is typed into the opener (${distinctive.length} values checked${hits.length ? `; typed: ${hits.join(", ")}` : ""})`);
    // the sim only draws; the words it paints come from the opener (SceneState labels)
    const simText = strip(simSrc).match(/fillText\(\s*["'`][^"'`]*/g) ?? [];
    ok(simText.length === 0 && /fillText\(st\.siteLabel/.test(simSrc) && /fillText\(st\.featuredLabel/.test(simSrc), `the sim paints no text of its own — only the labels the opener hands it${simText.length ? ` (found ${simText.join(" | ")})` : ""}`);
    ok(/openerStory\(payload\)/.test(openerSrc), "the opener narrates from openerStory(payload)");
    ok(!/Perrysville|West View/i.test(openerSrc + simSrc), "the opener and its sim never name a Perrysville / West View signal");
  }
}
if (openerSrc) {
  ok(/matchMedia\(\s*["']\(prefers-reduced-motion: reduce\)["']\s*\)/.test(openerSrc) && /data-testid="pgh-opener-static"/.test(openerSrc) && /reduced\s*\?\s*<OpenerStatic/.test(openerSrc), "the opener has a reduced-motion path: no pinned scroll, one still frame and the final values (pgh-opener-static)");
  ok(/IntersectionObserver/.test(openerSrc) && /cancelAnimationFrame/.test(openerSrc), "the opener's loop stops while the scene is off screen");
  ok(/aria-hidden/.test(openerSrc) && /data-testid="pgh-opener-illustrative"/.test(openerSrc) && /Illustrative scene; numbers from the study/.test(openerSrc), "the canvas is aria-hidden and the HUD says the scene is illustrative and the numbers the study's");
}
{
  const importers = srcFiles.filter((f) => /from\s+["'][^"']*(components\/pittsburgh-alive-opener|lib\/pittsburgh-alive-sim)["']/.test(readFileSync(f, "utf8")));
  const rel = importers.map((f) => relative(src, f)).sort();
  ok(JSON.stringify(rel) === JSON.stringify(["components/pittsburgh-alive-opener.tsx", "pages/pittsburgh-study-private.tsx"]), `only the page (and the opener, for its sim) import the opener and its sim — they ride the page's lazy chunk (${rel.join(", ")})`);
}

// the sim, headless on the real rows
let sim = null;
try { sim = await import(pathToFileURL(SIM_FILE).href); } catch (e) { console.log(`  (sim import failed: ${e?.message ?? e})`); }
ok(sim !== null, "lib/pittsburgh-alive-sim.ts loads under node");
if (sim && payload && lib && storyApi) {
  const r = payload.report;
  const world = new sim.PghAliveSim({ site: { lat: r.request.latitude, lon: r.request.longitude }, radiusMi: r.studyRadiusMi, rows: r.affectedIntersections, featuredId: lib.FEATURED_SIGNAL_ID, footprintFt: Math.sqrt(r.tripGeneration.size * 1000), pmIn: 413, pmOut: 447 });
  ok(world.sigs.length === r.affectedIntersections.length, `every studied row is a signal in the scene (${world.sigs.length})`);
  const worst = Math.max(...world.sigs.map((s) => Math.abs(Math.hypot(s.x, s.y) / 5280 - r.affectedIntersections.find((x) => x.signalId === s.id).distanceMi)));
  ok(worst < 0.01, `each signal sits at its row's distance from the site, to 0.01 mi (worst ${worst.toFixed(4)} mi)`);
  const f = world.featured;
  ok(f && f.id === lib.FEATURED_SIGNAL_ID && f.y < 0 && Math.abs(f.x) < 200, "the featured signal is drawn north of the site, where its coordinates put it");
  ok(world.sigs.every((s) => { const row = r.affectedIntersections.find((x) => x.signalId === s.id); return s.C === (row.signalTiming?.cycleLenSec ?? 90) && s.losNoBuild === row.existingLos && s.losBuild === row.futureLos; }), "each signal runs its row's own cycle and carries its row's No-Build / Build LOS");
  ok(world.sigs.filter((s) => s.drop).length === r.intersectionsWithLosDrop, `the rings drawn as grade drops are the report's ${r.intersectionsWithLosDrop}`);
  // the featured signal's lights follow its g/C: NS green for gNs × C of every cycle
  let green = 0; const N = 600;
  for (let i = 0; i < N; i++) if (world.light(f, 0, (i / N) * f.C) === "G") green++;
  ok(Math.abs(green / N - f.gNs) < 0.01, `the featured signal's NS green share is its g/C (${(green / N).toFixed(3)} vs ${f.gNs})`);
  // a tiny synthetic network: a north–south road through the featured signal with the site to the south
  const k = 1 / 364000, kl = 1 / (364000 * Math.cos((r.request.latitude * Math.PI) / 180));
  const segs = [];
  const lonF = r.request.longitude + f.x * kl;
  for (let i = -8; i < 30; i++) {
    const a = r.request.latitude - (i * 300) * k, b = r.request.latitude - ((i + 1) * 300) * k;
    segs.push([1, Math.max(a, b), lonF, Math.min(a, b), lonF, 2, 64, "Test Road", 0]);
  }
  segs.push([4, r.request.latitude, r.request.longitude, r.request.latitude, lonF, 1, null, "Site Drive", 0]);
  world.setRoads(segs);
  world.demand = 1; world.projMul = 1;
  let stoppedAtRed = 0, nan = false;
  for (let i = 0; i < 2400; i++) {
    world.step(0.25);
    for (const fl of world.flows) for (const c of fl.cars) { if (!Number.isFinite(c.s) || !Number.isFinite(c.v)) nan = true; }
    if (world.light(f, 0) === "R") stoppedAtRed = Math.max(stoppedAtRed, world.carCount().stopped);
  }
  const cc = world.carCount();
  ok(world.flows.length > 0 && cc.total > 0 && !nan, `the sim runs on a network without NaN (${world.flows.length} flows, ${cc.total} cars)`);
  ok(stoppedAtRed > 0, `cars queue at the featured signal on its red (${stoppedAtRed} stopped)`);
}

// ---- 5. wording ----
console.log("wording");
const BANNED = /independent review|second opinion|peer review|qa\/qc|\baudit|atlanta|gdot/i;
const pageSrc = page ?? "";
const libSrc = read(LIB_FILE) ?? "";
const m1 = pageSrc.match(BANNED), m2 = libSrc.match(BANNED);
for (const [label, text] of [["opener", openerSrc ?? ""], ["opener sim", simSrc ?? ""]]) {
  const m = text.match(BANNED);
  ok(text.length > 0 && !m, `${label} source has no banned / Atlanta wording${m ? ` ("${m[0]}")` : ""}`);
}
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

// ---- 8. page wiring: opener, watch it live, LOS auto-play ----
console.log("page wiring");
ok(page !== null && /<PittsburghAliveOpener\b[^>]*payload=\{payload\}/.test(page), "the page renders the opener first, fed the payload");
ok(page !== null && /id="study-glance"/.test(page) && /<Hero\b/.test(page), "the opener lands on the header's metric strip (#study-glance)");
ok(page !== null && /function WatchLiveSection/.test(page) && /featuredSignal\(report\)/.test(page) && /<IntersectionSimView\s+sim=\{model\.sim\}/.test(page) && /data-testid="pgh-watch-live"/.test(page), "Watch it live embeds the featured signal's micro-simulation (No-build / Build toggle is the sim view's own)");
ok(page !== null && /id="live"/.test(page) && /\{ id: "live", n: "04a"/.test(page), "Watch it live is §04a in the section nav");
ok(page !== null && /mapInView/.test(page) && /setPlaying\(true\)/.test(page) && /touched\.current/.test(page) && /data-testid="button-los-play"/.test(page), "the LOS map auto-plays once on first view, and its Play button stays");
ok(page !== null && /if \(!mapInView \|\| reduced/.test(page), "the LOS auto-play is skipped under reduced motion");

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
  const OPENER_MARK = "pgh-opener-illustrative";
  const openerHolders = assets.filter((f) => readFileSync(join(dist, "assets", f), "utf8").includes(OPENER_MARK));
  ok(openerHolders.length === 1 && openerHolders[0] === holders[0], `the opener ships in the page's lazy chunk only (${openerHolders.join(", ") || "none"})`);
  const SIM_MARK = "Road drawing bins";
  ok(!entrySrc.includes("pgh-opener") && !entrySrc.includes("pgh-watch-live"), "the entry bundle carries neither the opener nor the Watch it live section");
  void SIM_MARK;
}

if (failed) { console.log(`\ncheck:pittsburgh-study-private FAILED (${failed})`); process.exit(1); }
console.log("\ncheck:pittsburgh-study-private passed");
