// Every map on the website must draw real basemap tiles.
//
// On 2026-10-13 CARTO's basemaps (rastertiles/voyager and dark_all) began
// answering every request without an API key, production's referer included,
// with a watermark tile reading "API KEY REQUIRED", so every map on the site
// showed watermarks. OpenStreetMap's own tile server is not a substitute: it
// answers this site 418 "Access blocked", and its usage policy excludes
// production apps. The basemaps now come from Esri's keyless ArcGIS Online
// Canvas services, and they come from ONE place:
//
//   src/lib/basemap.ts                 every tile URL, attribution and zoom range
//   src/components/basemap-layers.tsx  the one component that renders a TileLayer
//
// The checks read the source with the TypeScript compiler (so a comment or a
// string is read as one) and evaluate src/lib/basemap.ts itself:
//
//   no-carto-osm           no file under src/ names cartocdn or tile.openstreetmap.org
//   tile-layers-shared     react-leaflet's TileLayer and L.tileLayer appear only in
//                          basemap-layers.tsx, and tile URL templates only in basemap.ts
//   layer-props-wired      BasemapLayers renders one TileLayer per BASEMAPS[kind] layer,
//                          with url, attribution, maxNativeZoom and maxZoom all taken
//                          from that layer
//   stale-levels-dropped   each TileLayer's load handler, after the 200 ms fade, runs two
//                          opacity passes so Leaflet drops the previous zoom level; without
//                          it a slow page keeps that level, and the transparent labels
//                          layer shows the old labels, scaled up, behind the new ones
//   every-map-has-basemap  every <MapContainer> under src/ renders <BasemapLayers> with
//                          a kind that BASEMAPS defines
//   esri-zyx               every URL is an https://server.arcgisonline.com MapServer
//                          tile URL ending /tile/{z}/{y}/{x}: Esri's order is row
//                          ({y}) before column ({x}), unlike CARTO's and OSM's
//   attribution            every basemap's base layer credits Esri; the Canvas layers
//                          say "Powered by Esri" (Esri linked to esri.com) and carry the
//                          services' copyrightText: Esri, HERE, Garmin, (c) OpenStreetMap
//                          contributors (linked to its copyright page), and the GIS
//                          user community
//   canvas-layers          light and dark are a Canvas base with its own Reference
//                          (labels) layer on top, maxNativeZoom 16 (Canvas answers
//                          z17+ with a "Map data not yet available" tile, so Leaflet
//                          must upscale z16) and maxZoom 20
//   satellite-unchanged    satellite is still World_Imagery under World_Boundaries_and_Places
//                          at maxNativeZoom 19, with the imagery credit it always had
//
// --live also fetches a z10 tile over Atlanta from every layer, with the
// production referer, and requires 200 image/* (not run in CI: no network).
//
// TEETH: MUTATIONS edit the sources IN MEMORY, the suite runs again on the
// edited text, and each mutation must turn red exactly the checks it names.
// A check no mutation turns red fails the run.
//
// Run: `pnpm run check:basemap-tiles` (add `-- --live` for the network probe)
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ts = (await import("typescript")).default;

const here = path.dirname(fileURLToPath(import.meta.url));
const atlanta = path.resolve(here, "..");
const LIVE = process.argv.includes("--live");

const MODULE = "src/lib/basemap.ts";
const COMPONENT = "src/components/basemap-layers.tsx";
const CODE_EXT = /\.(?:[cm]?[jt]sx?)$/;

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}
const SOURCES = Object.fromEntries(
  listFiles(path.join(atlanta, "src")).map((p) => [path.relative(atlanta, p).split(path.sep).join("/"), readFileSync(p, "utf8")]),
);

// ---- helpers -----------------------------------------------------------------------
function parse(file, text) {
  const kind = /x$/.test(file) ? ts.ScriptKind.TSX : file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}
function walk(node, fn) {
  fn(node);
  node.forEachChild((c) => walk(c, fn));
}
const jsxTag = (n) => (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n) ? n.tagName.getText() : null);
const jsxAttr = (el, name) => el.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText() === name);
const stringish = (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n);
const TILE_TEMPLATE = /\{[zxy]\}/;

// basemap.ts is transpiled and imported from a data: URL, so a mutated copy is
// evaluated exactly as the real one is, and the real file is never rewritten.
let importSeq = 0;
async function loadBasemaps(sources) {
  const text = sources[MODULE];
  if (text == null) return { error: `${MODULE} is missing` };
  const js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  try {
    const mod = await import(`data:text/javascript;charset=utf-8,${encodeURIComponent(`${js}\n// ${importSeq++}`)}`);
    if (!mod.BASEMAPS || typeof mod.BASEMAPS !== "object") return { error: `${MODULE} does not export BASEMAPS` };
    return { basemaps: mod.BASEMAPS };
  } catch (e) {
    return { error: `${MODULE} does not evaluate (${e instanceof Error ? e.message : e})` };
  }
}

const ESRI_TILE_URL = /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\/[A-Za-z0-9_/]+\/MapServer\/tile\/\{z\}\/\{y\}\/\{x\}$/;
const CANVAS = {
  light: { base: "/Canvas/World_Light_Gray_Base/MapServer/", labels: "/Canvas/World_Light_Gray_Reference/MapServer/" },
  dark: { base: "/Canvas/World_Dark_Gray_Base/MapServer/", labels: "/Canvas/World_Dark_Gray_Reference/MapServer/" },
};
const SATELLITE = {
  imagery: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  labels: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics",
};

// ---- the suite ---------------------------------------------------------------------
async function suite(sources) {
  const results = [];
  const check = (id, pass, msg) => results.push({ id, pass: !!pass, msg });
  const files = Object.keys(sources).sort();
  const code = files.filter((f) => CODE_EXT.test(f));
  const asts = Object.fromEntries(code.map((f) => [f, parse(f, sources[f])]));
  const loaded = await loadBasemaps(sources);
  const B = loaded.basemaps;

  // no-carto-osm: the raw text, comments included.
  {
    const hits = files.filter((f) => /cartocdn|tile\.openstreetmap\.org/i.test(sources[f]));
    check("no-carto-osm", hits.length === 0, `no file under src/ names cartocdn or tile.openstreetmap.org${hits.length ? ` (found in: ${hits.join(", ")})` : ""}`);
  }

  // tile-layers-shared
  {
    const bad = [];
    for (const f of code) {
      walk(asts[f], (n) => {
        const where = () => `${f}:${asts[f].getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
        if (f !== COMPONENT) {
          if (jsxTag(n) === "TileLayer") bad.push(`<TileLayer> at ${where()}`);
          if (ts.isImportSpecifier(n) && (n.propertyName ?? n.name).getText() === "TileLayer") bad.push(`TileLayer imported at ${where()}`);
          if (ts.isPropertyAccessExpression(n) && /^(?:tileLayer|TileLayer)$/.test(n.name.getText())) bad.push(`${n.getText()} at ${where()}`);
        }
        if (f !== MODULE && stringish(n) && TILE_TEMPLATE.test(n.text)) bad.push(`tile URL template ${JSON.stringify(n.text)} at ${where()}`);
      });
    }
    if (!asts[COMPONENT]) bad.push(`${COMPONENT} is missing`);
    if (!asts[MODULE]) bad.push(`${MODULE} is missing`);
    check("tile-layers-shared", bad.length === 0, `TileLayer is rendered only in ${COMPONENT} and tile URLs live only in ${MODULE}${bad.length ? ` (${bad.join("; ")})` : ""}`);
  }

  // layer-props-wired
  {
    const problems = [];
    const ast = asts[COMPONENT];
    if (!ast) problems.push(`${COMPONENT} is missing`);
    else {
      const tiles = [];
      let importsBasemaps = false;
      let exportsComponent = false;
      walk(ast, (n) => {
        if (jsxTag(n) === "TileLayer") tiles.push(n);
        if (ts.isImportDeclaration(n) && /(?:^|\/)lib\/basemap(?:\.ts)?$/.test(n.moduleSpecifier.text) && n.importClause?.namedBindings?.elements?.some((e) => e.name.getText() === "BASEMAPS")) importsBasemaps = true;
        if (ts.isFunctionDeclaration(n) && n.name?.getText() === "BasemapLayers" && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) exportsComponent = true;
      });
      if (!importsBasemaps) problems.push("does not import BASEMAPS from lib/basemap");
      if (!exportsComponent) problems.push("does not export function BasemapLayers");
      if (tiles.length !== 1) problems.push(`renders ${tiles.length} TileLayer elements (want exactly 1, mapped over the layers)`);
      for (const el of tiles) {
        let fn = el.parent;
        while (fn && !ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) fn = fn.parent;
        const call = fn?.parent;
        const mapped =
          call && ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && call.expression.name.getText() === "map" &&
          ts.isElementAccessExpression(call.expression.expression) && call.expression.expression.expression.getText() === "BASEMAPS";
        if (!mapped) { problems.push("its TileLayer is not inside BASEMAPS[kind].map(...)"); continue; }
        const param = fn.parameters[0]?.name.getText();
        for (const prop of ["url", "attribution", "maxNativeZoom", "maxZoom"]) {
          const a = jsxAttr(el, prop);
          const expr = a?.initializer && ts.isJsxExpression(a.initializer) ? a.initializer.expression : null;
          if (!expr || expr.getText() !== `${param}.${prop}`) problems.push(`TileLayer ${prop} is ${a ? a.initializer?.getText() ?? "(bare)" : "missing"}, not {${param}.${prop}}`);
        }
      }
    }
    check("layer-props-wired", problems.length === 0, `BasemapLayers renders BASEMAPS[kind]'s layers with their own url, attribution and zoom range${problems.length ? ` (${problems.join("; ")})` : ""}`);
  }

  // stale-levels-dropped: <TileLayer eventHandlers={E}>, E = { load: H }, and H
  // calls setTimeout(fn, >= 200) where fn calls .setOpacity( at least twice.
  {
    const problems = [];
    const ast = asts[COMPONENT];
    if (!ast) problems.push(`${COMPONENT} is missing`);
    else {
      const decls = new Map();
      walk(ast, (n) => {
        if (ts.isVariableDeclaration(n) && n.initializer) decls.set(n.name.getText(), n.initializer);
        if (ts.isFunctionDeclaration(n) && n.name) decls.set(n.name.getText(), n);
      });
      const resolve = (n) => (n && ts.isIdentifier(n) ? decls.get(n.text) : n);
      const tiles = [];
      walk(ast, (n) => { if (jsxTag(n) === "TileLayer") tiles.push(n); });
      for (const el of tiles) {
        const a = jsxAttr(el, "eventHandlers");
        const events = resolve(a?.initializer && ts.isJsxExpression(a.initializer) ? a.initializer.expression : null);
        if (!events || !ts.isObjectLiteralExpression(events)) { problems.push("its TileLayer has no eventHandlers object"); continue; }
        const load = events.properties.find((p) => p.name?.getText() === "load");
        const handler = resolve(load && (ts.isPropertyAssignment(load) ? load.initializer : ts.isShorthandPropertyAssignment(load) ? load.name : load));
        if (!handler) { problems.push("its eventHandlers has no load handler"); continue; }
        let ok = false;
        walk(handler, (n) => {
          if (!ts.isCallExpression(n) || !/^(?:window\.)?setTimeout$/.test(n.expression.getText())) return;
          const [fn, delay] = n.arguments;
          const opacityCalls = [];
          if (fn) walk(fn, (d) => { if (ts.isCallExpression(d) && ts.isPropertyAccessExpression(d.expression) && d.expression.name.getText() === "setOpacity") opacityCalls.push(d); });
          if (delay && ts.isNumericLiteral(delay) && Number(delay.text) >= 200 && opacityCalls.length >= 2) ok = true;
        });
        if (!ok) problems.push("its load handler does not run two setOpacity passes in a setTimeout of at least 200 ms");
      }
      if (tiles.length === 0) problems.push("no TileLayer found");
    }
    check("stale-levels-dropped", problems.length === 0, `each basemap TileLayer drops the previous zoom level once its tiles have faded in${problems.length ? ` (${problems.join("; ")})` : ""}`);
  }

  // every-map-has-basemap
  {
    const problems = [];
    let maps = 0;
    const kinds = B ? Object.keys(B) : [];
    for (const f of code) {
      walk(asts[f], (n) => {
        if (!ts.isJsxElement(n) || n.openingElement.tagName.getText() !== "MapContainer") return;
        maps++;
        const where = `${f}:${asts[f].getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
        const layers = [];
        walk(n, (d) => { if (jsxTag(d) === "BasemapLayers") layers.push(d); });
        if (layers.length !== 1) { problems.push(`the map at ${where} renders ${layers.length} <BasemapLayers> (want 1)`); return; }
        const kind = jsxAttr(layers[0], "kind");
        let expr = kind?.initializer && (ts.isStringLiteral(kind.initializer) ? kind.initializer : ts.isJsxExpression(kind.initializer) ? kind.initializer.expression : null);
        while (expr && ts.isParenthesizedExpression(expr)) expr = expr.expression;
        if (!expr) { problems.push(`the map at ${where} gives BasemapLayers no kind`); return; }
        // A kind is a string literal, or a choice between two (the editors' satellite / street toggle).
        const choices = ts.isConditionalExpression(expr) ? [expr.whenTrue, expr.whenFalse] : [expr];
        if (!choices.every(ts.isStringLiteral)) { problems.push(`the map at ${where} gives BasemapLayers a kind that is not a string literal or a choice between two`); return; }
        for (const k of choices.map((s) => s.text)) if (!kinds.includes(k)) problems.push(`the map at ${where} asks for kind "${k}", which BASEMAPS does not define`);
      });
    }
    if (maps === 0) problems.push("no <MapContainer> found under src/ (the check would pass vacuously)");
    check("every-map-has-basemap", problems.length === 0, `each of the ${maps} <MapContainer> under src/ renders <BasemapLayers> with a kind BASEMAPS defines${problems.length ? ` (${problems.join("; ")})` : ""}`);
  }

  // The rest read the evaluated BASEMAPS.
  const all = B ? Object.entries(B).flatMap(([kind, layers]) => (Array.isArray(layers) ? layers.map((l, i) => ({ kind, i, ...l })) : [])) : [];
  const shape = !B ? loaded.error : ["light", "dark", "satellite"].filter((k) => !Array.isArray(B[k]) || B[k].length === 0).map((k) => `BASEMAPS.${k} is not a non-empty array`).join("; ");

  {
    const bad = all.filter((l) => typeof l.url !== "string" || !ESRI_TILE_URL.test(l.url)).map((l) => `${l.kind}[${l.i}] ${l.url}`);
    check("esri-zyx", !shape && bad.length === 0, `every basemap URL is an Esri MapServer tile URL ending /tile/{z}/{y}/{x}${shape ? ` (${shape})` : bad.length ? ` (not: ${bad.join("; ")})` : ""}`);
  }
  {
    const problems = [];
    if (shape) problems.push(shape);
    else {
      for (const [kind, layers] of Object.entries(B)) {
        if (!/Esri/.test(layers[0]?.attribution ?? "")) problems.push(`${kind}'s base layer does not credit Esri`);
      }
      for (const kind of ["light", "dark"]) {
        const a = B[kind][0]?.attribution ?? "";
        const need = [
          [/Powered by <a href="https:\/\/www\.esri\.com\/?"[^>]*>Esri<\/a>/, '"Powered by Esri" with Esri linked to esri.com'],
          [/\bHERE\b/, "HERE"],
          [/\bGarmin\b/, "Garmin"],
          [/(?:&copy;|©|\(c\))\s*<a href="https:\/\/www\.openstreetmap\.org\/copyright"[^>]*>OpenStreetMap<\/a> contributors/, "© OpenStreetMap contributors linked to openstreetmap.org/copyright"],
          [/the GIS user community/, "the GIS user community"],
        ];
        for (const [re, what] of need) if (!re.test(a)) problems.push(`${kind}'s attribution lacks ${what}`);
      }
    }
    check("attribution", problems.length === 0, `every basemap credits Esri, and the Canvas basemaps carry "Powered by Esri" and the services' data credits${problems.length ? ` (${problems.join("; ")})` : ""}`);
  }
  {
    const problems = [];
    if (shape) problems.push(shape);
    else {
      for (const [kind, want] of Object.entries(CANVAS)) {
        const [base, labels, ...extra] = B[kind];
        if (!base?.url?.includes(want.base)) problems.push(`${kind}[0] is not ${want.base}`);
        if (!labels?.url?.includes(want.labels)) problems.push(`${kind}[1] is not its labels layer ${want.labels}`);
        if (extra.length) problems.push(`${kind} has ${extra.length} extra layer(s)`);
        for (const [i, l] of [base, labels].entries()) {
          if (!l) continue;
          if (l.maxNativeZoom !== 16) problems.push(`${kind}[${i}] maxNativeZoom is ${l.maxNativeZoom}, not 16`);
          if (l.maxZoom !== 20) problems.push(`${kind}[${i}] maxZoom is ${l.maxZoom}, not 20`);
        }
      }
    }
    check("canvas-layers", problems.length === 0, `light and dark are an Esri Canvas base with its Reference labels on top, real tiles to z16, upscaled to z20${problems.length ? ` (${problems.join("; ")})` : ""}`);
  }
  {
    const problems = [];
    if (shape) problems.push(shape);
    else {
      const [img, lab, ...extra] = B.satellite;
      if (img?.url !== SATELLITE.imagery) problems.push(`satellite[0] is ${img?.url}`);
      if (lab?.url !== SATELLITE.labels) problems.push(`satellite[1] is ${lab?.url}`);
      if (extra.length) problems.push(`${extra.length} extra layer(s)`);
      if (img?.attribution !== SATELLITE.attribution) problems.push(`the imagery credit is ${JSON.stringify(img?.attribution)}`);
      for (const [i, l] of [img, lab].entries()) {
        if (l && (l.maxNativeZoom !== 19 || l.maxZoom !== 20)) problems.push(`satellite[${i}] zooms ${l.maxNativeZoom}/${l.maxZoom}, not 19/20`);
      }
    }
    check("satellite-unchanged", problems.length === 0, `satellite is still World_Imagery under World_Boundaries_and_Places, native to z19${problems.length ? ` (${problems.join("; ")})` : ""}`);
  }
  return results;
}

const redIds = (results) => results.filter((r) => !r.pass).map((r) => r.id);

// ---- baseline ----------------------------------------------------------------------
const base = await suite(SOURCES);
const ids = base.map((r) => r.id);
for (const r of base) console.log(`${r.pass ? "PASS" : "FAIL"}  [${r.id}] ${r.msg}`);
const baseFails = redIds(base).length;

let liveFails = 0;
if (LIVE && baseFails === 0) {
  const { basemaps } = await loadBasemaps(SOURCES);
  // z10 over downtown Atlanta (33.749, -84.388): column 271, row 409.
  const [z, x, y] = [10, 271, 409];
  for (const [kind, layers] of Object.entries(basemaps)) {
    for (const [i, l] of layers.entries()) {
      const url = l.url.replace("{z}", z).replace("{x}", x).replace("{y}", y);
      let status = "error";
      let type = "";
      try {
        const res = await fetch(url, { headers: { Referer: "https://simpleimpactstudies.com/" }, signal: AbortSignal.timeout(20000) });
        status = res.status;
        type = res.headers.get("content-type") ?? "";
        await res.arrayBuffer();
      } catch (e) {
        type = e instanceof Error ? e.message : String(e);
      }
      const ok = status === 200 && type.startsWith("image/");
      if (!ok) liveFails++;
      console.log(`${ok ? "PASS" : "FAIL"}  [live] ${kind}[${i}] ${url} -> ${status} ${type}`);
    }
  }
}

if (baseFails > 0) {
  console.log(`\n${baseFails} CHECK(S) FAILED (teeth not run on a red baseline)`);
  process.exit(1);
}

// ---- teeth -------------------------------------------------------------------------
function edit(file, from, to) {
  return (sources) => {
    const text = sources[file];
    if (text == null) throw new Error(`${file} is missing`);
    const at = text.indexOf(from);
    if (at < 0) throw new Error(`${file} does not contain ${JSON.stringify(from)}`);
    if (text.indexOf(from, at + 1) >= 0) throw new Error(`${file} contains ${JSON.stringify(from)} more than once`);
    return { ...sources, [file]: text.slice(0, at) + to + text.slice(at + from.length) };
  };
}
const MUTATIONS = [
  { label: "the /cities map goes back to CARTO dark_all", flips: ["no-carto-osm", "tile-layers-shared", "every-map-has-basemap"], apply: edit("src/components/metro-map.tsx", '<BasemapLayers kind="dark" />', '<TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" subdomains="abcd" />') },
  { label: "the study map inlines its own Esri TileLayer", flips: ["tile-layers-shared", "every-map-has-basemap"], apply: edit("src/pages/tis.tsx", '<BasemapLayers kind="light" />', '<TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}" />') },
  { label: "the metro signal map renders no basemap", flips: ["every-map-has-basemap"], apply: edit("src/components/metro-signal-map.tsx", '<BasemapLayers kind="dark" />', "") },
  { label: "the driveway editor's street view asks for a basemap BASEMAPS does not define", flips: ["every-map-has-basemap"], apply: edit("src/components/driveway-editor.tsx", '<BasemapLayers kind={basemap === "satellite" ? "satellite" : "light"} />', '<BasemapLayers kind={basemap === "satellite" ? "satellite" : "voyager"} />') },
  { label: "the light base layer is asked for in CARTO's {z}/{x}/{y} order", flips: ["esri-zyx"], apply: edit(MODULE, "World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", "World_Light_Gray_Base/MapServer/tile/{z}/{x}/{y}") },
  { label: "the Canvas credit drops OpenStreetMap", flips: ["attribution"], apply: edit(MODULE, ' &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors,', "") },
  { label: "the Canvas credit drops 'Powered by Esri'", flips: ["attribution"], apply: edit(MODULE, 'Powered by <a href="https://www.esri.com/">Esri</a>', "Tiles &copy; Esri") },
  { label: "the dark basemap loses its labels layer", flips: ["canvas-layers"], apply: edit(MODULE, '    canvas("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"),\n', "") },
  { label: "the Canvas layers ask Esri for z17+ (its 'Map data not yet available' tile)", flips: ["canvas-layers"], apply: edit(MODULE, "const CANVAS_NATIVE_MAX_ZOOM = 16;", "const CANVAS_NATIVE_MAX_ZOOM = 19;") },
  { label: "the satellite imagery is swapped for Esri's street map", flips: ["satellite-unchanged"], apply: edit(MODULE, "services/World_Imagery/MapServer", "services/World_Street_Map/MapServer") },
  { label: "BasemapLayers stops passing maxNativeZoom", flips: ["layer-props-wired"], apply: edit(COMPONENT, " maxNativeZoom={layer.maxNativeZoom}", "") },
  { label: "BasemapLayers hard-codes an empty attribution", flips: ["layer-props-wired"], apply: edit(COMPONENT, "attribution={layer.attribution}", 'attribution=""') },
  { label: "BasemapLayers stops dropping stale zoom levels", flips: ["stale-levels-dropped"], apply: edit(COMPONENT, " eventHandlers={TILE_EVENTS}", "") },
  { label: "the stale-level drop runs one opacity pass (it only marks tiles active)", flips: ["stale-levels-dropped"], apply: edit(COMPONENT, "    layer.setOpacity(opacity);\n    layer.setOpacity(opacity);\n", "    layer.setOpacity(opacity);\n") },
  { label: "the stale-level drop runs before the 200 ms fade is over", flips: ["stale-levels-dropped"], apply: edit(COMPONENT, "  }, 250);", "  }, 0);") },
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
  const now = redIds(await suite(mutated));
  const want = [...m.flips].sort().join(", ");
  const got = [...now].sort().join(", ");
  teeth(want === got, `"${m.label}" turns red exactly: ${want}${want === got ? "" : ` (actually red: ${got || "(none)"})`}`);
}
const covered = new Set(MUTATIONS.flatMap((m) => m.flips));
const toothless = ids.filter((id) => !covered.has(id));
teeth(toothless.length === 0, `every check has a mutation that turns it red${toothless.length ? ` (none for: ${toothless.join(", ")})` : ""}`);

const failed = teethFails + liveFails;
console.log(failed === 0 ? "\ncheck:basemap-tiles passed" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
