/**
 * Guard for the proofread routes: firm scoping, the advisor boundary, the
 * disposition rules the protocol sets, and the limiters.
 *
 * Two claims here are load-bearing for the whole feature, and both are easy to
 * assert against a file that cannot break them:
 *
 *   1. CROSS-TENANT. Firm scoping has no middleware; it exists only in each
 *      query's WHERE clause. The routes must (a) take the firm from the session
 *      and never from the request, (b) check that the project / the whole
 *      firm -> project -> run -> finding chain is the caller's BEFORE reading
 *      or writing anything, and (c) answer a foreign id with the same 404 as an
 *      unknown one. The store's findingInFirmRun is the one query that carries
 *      the chain; its WHERE is pinned in verify-proofread-claim.mjs, and this
 *      guard pins that the routes call it with its arguments in order.
 *
 *   2. ADVISOR BOUNDARY. Datum advises and never acts: no handler and no write
 *      in the store may touch tis_projects, request_payload or result_payload.
 *      The route file is asserted for that, and so is the STORE, because that
 *      is where writes actually live, and the runner the routes call into.
 *
 * It is a source-text guard, which is the weakest kind, so it carries its own
 * teeth, as verify-proofread-claim.mjs does: MUTATIONS below breaks each
 * protected property in the in-memory source and asserts that exactly the
 * checks that claim to protect it go red, and that no check declared about one
 * file goes red because of an edit to another. A check that no mutation can
 * flip fails the run. The contract module is not read as text alone: its zod
 * schemas are evaluated, so the WITHDRAWN-needs-a-source rule is exercised
 * rather than grepped for.
 *
 * The route, store and runner code is read with TypeScript's own parser (the
 * parser only, never the type checker): imports and module loaders, database
 * writes, the values that hold a database handle, and the SQL text in string
 * literals are found in the AST, because review walked real tis_projects writes
 * past regex versions of each. The schema files under lib/db/src/schema are
 * parsed the same way, for the table names the raw-SQL scan reads (schemaTablesIn).
 *
 * ADDITIVE TEXT SCANS. Beside those AST checks, several checks keep the substring
 * scans of comment-stripped text that earlier versions of this guard used, as
 * extra conjuncts: the routes' scan for tis_projects, tisProjectsTable, the four
 * payload names, `db`, `.update(` / `.insert(` / `.delete(` and @workspace/db; the
 * runner's for tisProjectsTable, the two camel-case payload names, those three
 * verbs and `db.`; the store's `.verb(Name` targets, tisProjectsTable and the
 * payload names outside the loader, onConflictDoUpdate, tis_projects, and
 * uppercase UPDATE / INSERT INTO / DELETE FROM. They were kept in round 3 so
 * that no input THOSE SCANS caught can pass this one, and they can only add
 * reds: a route string that merely says "db" or "x.update(y)" is refused, which
 * is their known cost. The raw-SQL scan beside them is not one of them and is not
 * additive: it reads SQL SHAPE, so prose that names a verb outside a SQL shape
 * ("update failed", "could not insert into the queue") passes where the word scan
 * it replaced refused it, prose in a SQL shape is refused (reword it), and what the
 * scan does not read is listed at rawSqlWrites.
 *
 * It is a tripwire against ordinary AND adversarially spelled imports and
 * writes, not a sandbox against runtime reflection: a specifier built at run time
 * reads as "<dynamic import>", which no whitelist allows, and reflection on a
 * value that holds a db handle (Reflect, Object.entries, computed keys, spread)
 * is refused rather than followed. Its named limits are listed at dbScan. What
 * survives every spelling is a test that observes the DATABASE (a row hash before
 * and after, on a real Postgres); this guard cannot be one, and that test is the
 * recommended addition once phase 1 ships.
 *
 * Reads files as text and never imports the routes, the store or
 * @workspace/db, so it never opens a connection.
 *
 * Run: `pnpm run check:proofread-routes`
 */
import { createRequire } from "node:module";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const at = (p) => path.resolve(here, p);
const read = (p) => {
  try {
    return readFileSync(at(p), "utf8");
  } catch {
    return "";
  }
};

let fails = 0;
const ok = (cond, msg, why) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) {
    fails++;
    // One indented line per item. The ten boundary checks (the store's import whitelist,
    // its three write scans and its raw-SQL scan; the runner's and the routes' write scans
    // and import whitelists; the clause directory's whitelist) name the file and line of
    // what fired, so the person a red stops can read the line rather than weaken the
    // check. The other checks pin one exact piece of text in one named function or block,
    // and their message names it.
    if (why) for (const l of [why].flat().join("\n").split("\n")) console.log(`        ${l}`);
  }
};

/** Where each guarded source lives, relative to artifacts/tis-api-server, for `file:line` in a failure. */
const PATHS = {
  routes: "src/routes/proofread.ts",
  routesIndex: "src/routes/index.ts",
  security: "src/lib/security.ts",
  contract: "../../lib/tis-api-zod/src/proofread.ts",
  zodIndex: "../../lib/tis-api-zod/src/index.ts",
  store: "src/lib/proofread-store.ts",
  runner: "src/lib/proofread-run.ts",
  tisProjects: "src/lib/tis-projects.ts",
  typesSrc: "src/lib/proofread/types.ts",
};
const pathOf = (file) => PATHS[file] ?? `src/lib/proofread/${file}`;
/** The 1-based line of an offset into a raw (not comment-stripped) source. */
const lineAt = (raw, off) => raw.slice(0, Math.max(0, off)).split("\n").length;

// The code is read with TypeScript's own parser (the text scans kept beside it are
// listed in the header). Two rounds of review showed a line-anchored regex parser can always be walked around by a
// spelling it did not anticipate (a block comment ahead of an import, single
// quotes, two statements on a line, an indented import, no whitespace at all,
// an ES2022 string-literal import name, a regex literal ending in `//` that a
// hand-rolled comment stripper takes for a comment), and TypeScript compiles
// every one of them. `typescript` is a root devDependency, so it resolves from
// this directory under plain node after `pnpm install`, like zod does below.
let ts = null;
try {
  ts = (await import("typescript")).default;
} catch {
  ts = null;
}
// Usable means every member of the compiler API this file names is there, not only that
// something named typescript resolved. The list is read from this file's own text at
// start-up (each function, enum and enum member it reaches through the typescript
// module), so it cannot fall behind the code: a hand-kept list caught 9 of 50 removed
// members, and the rest died with a TypeError or, for an enum member, passed. A smoke
// parse then exercises the node methods the guard calls (getChildren, getText,
// getStart, getFullStart, getEnd, positions to lines, comment ranges).
const OWN_TEXT = readFileSync(fileURLToPath(import.meta.url), "utf8");
const TS_API = [...new Set([...OWN_TEXT.matchAll(/(?<![\w$./-])ts\.([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?/g)].map((m) => (m[2] ? `${m[1]}.${m[2]}` : m[1])))].sort();
const tsMissing =
  ts === null
    ? ["the typescript package itself"]
    : TS_API.filter((name) => {
        const [a, b] = name.split(".");
        const v = ts[a];
        if (b === undefined) return /^[a-z]/.test(a) ? typeof v !== "function" : v === null || typeof v !== "object";
        return v === null || typeof v !== "object" || v[b] === undefined;
      });
let tsSmoke = false;
if (tsMissing.length === 0) {
  try {
    const sf0 = ts.createSourceFile("smoke.ts", "// c\nconst a = { b: 1 };\n", ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    const st = sf0.statements[0];
    tsSmoke =
      st.parent === sf0 &&
      st.getText(sf0) === "const a = { b: 1 };" &&
      st.getStart(sf0) === 5 &&
      st.getFullStart() === 0 &&
      st.getEnd() === 24 &&
      st.getChildren(sf0).length > 0 &&
      sf0.getLineAndCharacterOfPosition(st.getStart(sf0)).line === 1 &&
      (ts.getLeadingCommentRanges(sf0.text, 0) ?? []).length === 1;
  } catch {
    tsSmoke = false;
  }
}
const tsUsable = TS_API.length > 20 && tsMissing.length === 0 && tsSmoke;
ok(
  tsUsable,
  `precondition: typescript resolves from scripts/ under plain node and has every member of the compiler API this guard names (${TS_API.length}, read from the guard's own text), and a parsed node answers the methods the guard calls`,
  tsMissing.length ? `missing: ${tsMissing.join(", ")}` : tsSmoke ? undefined : "a smoke parse did not behave like TypeScript's",
);
if (!tsUsable) {
  console.log("\n1 CHECK(S) FAILED");
  process.exit(1);
}

const ZOD_SRC = "../../../lib/tis-api-zod/src";

/** Every name exported by any other module under lib/tis-api-zod/src, for the collision check. */
function otherExportNames() {
  const names = new Set();
  const walk = (dir) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".ts")) {
        if (dir === at(ZOD_SRC) && (e.name === "proofread.ts" || e.name === "index.ts")) continue;
        for (const n of exportNames(readFileSync(full, "utf8"))) names.add(n);
      }
    }
  };
  walk(at(ZOD_SRC));
  return names;
}

function exportNames(src) {
  const out = [];
  for (const m of src.matchAll(/^export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+(\w+)/gm)) out.push(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name) out.push(name.replace(/^type\s+/, ""));
    }
  }
  return out;
}

/** The drizzle schema, whose table names the raw-SQL scan reads (see schemaTablesIn). */
const SCHEMA_DIR = "../../../lib/db/src/schema";
const sources = {
  routes: read("../src/routes/proofread.ts"),
  routesIndex: read("../src/routes/index.ts"),
  security: read("../src/lib/security.ts"),
  contract: read(`${ZOD_SRC}/proofread.ts`),
  zodIndex: read(`${ZOD_SRC}/index.ts`),
  store: read("../src/lib/proofread-store.ts"),
  runner: read("../src/lib/proofread-run.ts"),
  tisProjects: read("../src/lib/tis-projects.ts"),
  typesSrc: read("../src/lib/proofread/types.ts"),
  // Every file of the pure clause directory, by name: the store and the runner
  // import it, so a write reached THROUGH it would not appear in either file.
  clauseDir: Object.fromEntries(
    (() => {
      try {
        return readdirSync(at("../src/lib/proofread")).filter((f) => f.endsWith(".ts")).map((f) => [f, read(`../src/lib/proofread/${f}`)]);
      } catch {
        return [];
      }
    })(),
  ),
  // Every .ts file under lib/db/src/schema at any depth, by path: the raw-SQL scan reads its table names from
  // these (schemaTablesIn), and the teeth below edit them in memory as they edit the other sources.
  schema: Object.fromEntries(schemaFiles(SCHEMA_DIR)),
  otherNames: [...otherExportNames()],
};

for (const [k, v] of Object.entries(sources)) {
  if (k === "otherNames" || k === "clauseDir" || k === "schema") continue;
  ok(v.length > 0, `precondition: the ${k} source exists and is not empty`);
}
ok(Object.keys(sources.clauseDir).length >= 8 && Object.values(sources.clauseDir).every((t) => t.length > 0), "precondition: the clause directory's files are all readable (src/lib/proofread/*.ts)");
ok(sources.otherNames.length > 20, "precondition: the collision check can see the other contract modules' exports", `saw ${sources.otherNames.length}`);

// ---------------------------------------------------------------------------
// Text helpers. Every check reads COMMENT-STRIPPED text: these files describe
// the faults they avoid ("never touches request_payload"), and a check that
// read the prose would pass on a file whose code does the wrong thing. Every
// helper that slices a source returns "" when it cannot find what it was asked
// for, and every check using one asserts the slice is non-empty — an empty
// slice would satisfy every negative assertion in this file.
// ---------------------------------------------------------------------------

/** The parsed form of a source text, cached: the teeth pass parses each mutated text once, not once per check. */
const parsedTexts = new Map();
function parse(text) {
  let sf = parsedTexts.get(text);
  if (!sf) {
    sf = ts.createSourceFile("guarded.ts", text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    parsedTexts.set(text, sf);
  }
  return sf;
}

/**
 * Drop // and block comments, leaving string, template and regex literals
 * intact. The comment ranges come from the parser, so `/\//; await import("x")`
 * keeps its import (the hand-rolled stripper this replaces read the `//` inside
 * the regex as the start of a comment and deleted the rest of the line). On
 * every file this guard reads it returns exactly what that stripper did.
 */
const strippedTexts = new Map();
function stripMapped(src) {
  let done = strippedTexts.get(src);
  if (done) return done;
  const sf = parse(src);
  const ranges = new Map();
  const add = (rs) => {
    for (const r of rs ?? []) ranges.set(r.pos, r.end);
  };
  const visit = (node) => {
    add(ts.getLeadingCommentRanges(src, node.getFullStart()));
    add(ts.getTrailingCommentRanges(src, node.getEnd()));
    for (const c of node.getChildren(sf)) if (!ts.isJSDoc(c)) visit(c);
  };
  visit(sf);
  let out = "";
  let at = 0;
  // [offset in the stripped text, offset in the source] at the start of each kept stretch,
  // so a text scan's hit can be reported at its line in the real file.
  const segs = [];
  for (const [pos, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (pos < at) continue;
    segs.push([out.length, at]);
    out += src.slice(at, pos);
    at = end;
  }
  segs.push([out.length, at]);
  done = { text: out + src.slice(at), segs };
  strippedTexts.set(src, done);
  return done;
}
function stripComments(src) {
  return stripMapped(src).text;
}
/** The 1-based line in `raw` of an offset into stripComments(raw). */
function rawLine(raw, strippedOffset) {
  let rawOff = strippedOffset;
  for (const [s, r] of stripMapped(raw).segs) {
    if (s > strippedOffset) break;
    rawOff = r + (strippedOffset - s);
  }
  return lineAt(raw, rawOff);
}
/** Every hit of `re` in the comment-stripped text of `raw`, as `file:line: text (text scan)`. */
function textHits(file, raw, re) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  return [...stripComments(raw).matchAll(g)].map((m) => `${pathOf(file)}:${rawLine(raw, m.index)}: ${JSON.stringify(m[0].slice(0, 70))} (text scan)`);
}

/**
 * Whitespace-insensitive form, with trailing commas before a closer removed, so
 * a needle survives a reformat and a multi-line call compares equal to its
 * one-line spelling. Both sides of every comparison go through it.
 */
const sq = (s) => String(s ?? "").replace(/,(?=\s*[)}\]])/g, "").replace(/\s+/g, "");
const has = (text, needle) => text.length > 0 && sq(text).includes(sq(needle));
const occ = (text, needle) => sq(text).split(sq(needle)).length - 1;
const sorted = (a) => [...a].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** True when every needle is found, each strictly after the one before it. */
function inOrder(text, needles) {
  const t = sq(text);
  if (!t) return false;
  let from = 0;
  for (const n of needles) {
    const i = t.indexOf(sq(n), from);
    if (i < 0) return false;
    from = i + 1;
  }
  return true;
}

/** Index of the bracket that closes the one at `open`, skipping string and template literals. */
function matchClose(src, open) {
  let depth = 0;
  let q = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `export const NAME = rateLimit({ ... })`, whole expression, or "". */
function limiterBlock(src, name) {
  const start = src.indexOf(`export const ${name} = rateLimit(`);
  if (start < 0) return "";
  const open = src.indexOf("(", start + `export const ${name} = rateLimit`.length - 1);
  const close = matchClose(src, open);
  return close < 0 ? "" : src.slice(start, close + 1);
}

/** A function's text: from its own `export ... function NAME` to the next top-level export. */
function body(src, name) {
  const start = src.search(new RegExp(`export (async )?function ${name}\\b`));
  if (start < 0) return "";
  const rest = src.slice(start + 1);
  const end = rest.search(/\nexport /);
  return end < 0 ? src.slice(start) : src.slice(start, start + 1 + end);
}

/**
 * A store read written as exactly two statements after the signature `sig` (the text after
 * `function `): `const [row] = await db.<link>(…).<link>(…)…;` and then `return row ?? null;`, the
 * function's last statement. Answers the chain's links as { name, args } (args whitespace-free),
 * every link a call, in order — or null when the body is anything else: a statement before the
 * read or between it and the return, a return that rebuilds or replaces the row, a link that is
 * not a call. A remapping link (`.then`, `.map`) is a call, so it comes back by name and the
 * caller refuses it. Reads the comment-stripped text with all whitespace removed (sq).
 */
function rowRead(fnText, sig) {
  const s = sq(fnText);
  const head = sq(`export async function ${sig} { const [row] = await db`);
  if (!s.startsWith(head)) return null;
  const links = [];
  let i = head.length;
  for (;;) {
    if (s[i] === ";") break;
    const m = /^\.([A-Za-z_$][\w$]*)\(/.exec(s.slice(i));
    if (!m) return null;
    const open = i + m[0].length - 1;
    const close = matchClose(s, open);
    if (close < 0) return null;
    links.push({ name: m[1], args: s.slice(open + 1, close) });
    i = close + 1;
  }
  return s.slice(i) === ";returnrow??null;}" ? links : null;
}
/** A one-row read whose links are exactly `names`, the first one `.select(<select>)` and the second `.from(<from>)`. */
const rowReadIs = (fnText, sig, names, select, from) => {
  const links = rowRead(fnText, sig);
  return (
    links !== null &&
    links.map((l) => l.name).join() === names.join() &&
    links[0].args === sq(select) &&
    links[1].args === sq(from)
  );
};

/** Every `router.<verb>(` registration in a route file, with the text up to the next one. */
function routeCalls(src) {
  const hits = [...src.matchAll(/\brouter\.(\w+)\(\s*(?:"([^"]*)")?/g)];
  return hits.map((m, i) => ({
    verb: m[1],
    path: m[2] ?? "",
    text: src.slice(m.index, i + 1 < hits.length ? hits[i + 1].index : src.length),
  }));
}
const routeBy = (src, verb, p) => routeCalls(src).find((c) => c.verb === verb && c.path === p)?.text ?? "";

const P_RUN = "/projects/:id/proofread";
const P_DISP = "/projects/:id/proofread/:runId/findings/:findingId/dispositions";
const getSeg = (d) => routeBy(d.routes, "get", P_RUN);
const runSeg = (d) => routeBy(d.routes, "post", P_RUN);
const dispSeg = (d) => routeBy(d.routes, "post", P_DISP);

/**
 * Every way a file can reach another module, as { module: [names...] }, read
 * from the AST so no spelling (quotes, comments, spacing, one-line, indented,
 * CRLF, attributes) changes what is seen.
 *
 * Names are the IMPORTED names with `type ` in front of a type-only one (a
 * statement-level `import type` or an inline `type` marker), and `imported as
 * local` whenever an alias changes the name: `import { "setProjectTheme" as sp }`
 * is `setProjectTheme as sp`, and a default import is `default as <local>`. An
 * alias is never reduced to the imported name, because the code that follows
 * uses the LOCAL one. The forms a list of
 * names cannot express are surfaced as pseudo-names that no whitelist contains:
 *   import "x" / import {} from "x"  -> <side-effect import> / (no names) under x
 *   import * as ns from "x"          -> <namespace import>
 *   export ... from "x"              -> <re-export> under x
 *   import x = require("x")          -> <import = require> under x
 *   import("x") / typeof import("x") -> <dynamic import> / <import type> under x
 *   require("x") / module.require    -> <require> under x
 *   a non-literal specifier          -> the pseudo-name itself is the module
 *   eval / Function / require used any other way -> <eval> / <require>
 *   createRequire / getBuiltinModule, however reached -> <createRequire> / <getBuiltinModule>
 *   x.constructor(...) or new x.constructor(...) with an argument -> <constructor call>
 *   any other read of .constructor (aliased, destructured, .call / .apply / .bind),
 *     except a read of its name: x.constructor.name, x.constructor["name"], and the
 *     same through parentheses or a cast, `(x.constructor as any).name` (calling
 *     that name, `x.constructor.name(..)`, is refused) -> <constructor>
 * A member reached by a string key (module["require"]) counts as the member.
 * It is a tripwire for reaching a write through the module graph by ordinary
 * means, not a sandbox: code that builds a specifier at run time can only be
 * seen as "<dynamic import>", which no whitelist allows.
 */
const importEntryCache = new Map();
/** importsOf as a list of { mod, name, line }; a statement that imports no names is one entry with name null. */
function importEntries(text) {
  if (importEntryCache.has(text)) return importEntryCache.get(text);
  const sf = parse(text);
  const entries = [];
  let at = sf;
  const add = (mod, names) => {
    const line = sf.getLineAndCharacterOfPosition(at.getStart(sf)).line + 1;
    if (names.length === 0) entries.push({ mod, name: null, line });
    for (const name of names) entries.push({ mod, name, line });
  };
  const lit = (e) => (e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : null);
  const keyOf = (e) => (ts.isPropertyAccessExpression(e) ? e.name.text : ts.isElementAccessExpression(e) ? lit(e.argumentExpression) : null);
  const visit = (n) => {
    at = n;
    if (ts.isImportDeclaration(n)) {
      const mod = lit(n.moduleSpecifier) ?? "<computed specifier>";
      const c = n.importClause;
      if (!c) add(mod, ["<side-effect import>"]);
      else {
        const names = [];
        const t = c.isTypeOnly ? "type " : "";
        // `imported as local` whenever the two differ, so no plain-name whitelist entry can
        // match an alias. The write scan and the whitelists read the LOCAL identifiers in the
        // code, so an import that renames one allowed name to another (`import { a as b, b as a }`)
        // would make every later `b(...)` a call to `a` and leave every check green. A default
        // import is `default as <local>`.
        if (c.name) names.push(`${t}default as ${c.name.text}`);
        const nb = c.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) names.push("<namespace import>");
        if (nb && ts.isNamedImports(nb)) {
          for (const e of nb.elements) {
            const imported = (e.propertyName ?? e.name).text;
            const local = e.name.text;
            names.push(`${c.isTypeOnly || e.isTypeOnly ? "type " : ""}${imported === local ? imported : `${imported} as ${local}`}`);
          }
        }
        add(mod, names);
      }
    } else if (ts.isExportDeclaration(n) && n.moduleSpecifier) {
      add(lit(n.moduleSpecifier) ?? "<computed specifier>", ["<re-export>"]);
    } else if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
      add(lit(n.moduleReference.expression) ?? "<computed specifier>", ["<import = require>"]);
    } else if (ts.isImportTypeNode(n)) {
      add(ts.isLiteralTypeNode(n.argument) ? (lit(n.argument.literal) ?? "<computed specifier>") : "<computed specifier>", ["<import type>"]);
    } else if (ts.isCallExpression(n)) {
      const e = n.expression;
      const via = lit(n.arguments[0]);
      if (e.kind === ts.SyntaxKind.ImportKeyword) add(via ?? "<dynamic import>", ["<dynamic import>"]);
      else if (keyOf(e) === "require") add(via ?? "<require>", ["<require>"]);
    }
    // A function built from a string, through any function's constructor:
    // (async () => 0).constructor("return import('./tis-projects')")() loads a module
    // with neither `import` nor `Function` in the code. With no argument it builds nothing.
    if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && (n.arguments?.length ?? 0) > 0) {
      let e = n.expression;
      while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) e = e.expression;
      if (keyOf(e) === "constructor") add("<eval>", ["<constructor call>"]);
    }
    // Node's own module loaders, which no import statement shows: createRequire, and
    // process.getBuiltinModule (Node 22.3+, so live under the production pin), which hands
    // back node:module and with it createRequire. A member named so with a string key counts.
    // Any read of a function's constructor is a way to build code from a string, however it is
    // then called (directly, aliased, .call / .apply / .bind, destructured): refused, except a
    // read of its `.name`, the class name — `x.constructor.name`, `x.constructor["name"]`, and
    // either through parentheses or a cast (`(x.constructor as any).name`). Calling that `.name`
    // is not a read of it and stays refused (an object's `constructor` may be anything).
    const ctorRead =
      ((ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) && keyOf(n) === "constructor") ||
      (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent) && (n.propertyName ? lit(n.propertyName) ?? (ts.isIdentifier(n.propertyName) ? n.propertyName.text : null) : ts.isIdentifier(n.name) ? n.name.text : null) === "constructor");
    const nameRead = (x) => {
      let p = x;
      while (p.parent && (ts.isParenthesizedExpression(p.parent) || ts.isAsExpression(p.parent) || ts.isNonNullExpression(p.parent) || ts.isTypeAssertionExpression(p.parent) || ts.isSatisfiesExpression(p.parent))) p = p.parent;
      const m = p.parent;
      const readsName = !!m && (ts.isPropertyAccessExpression(m) || ts.isElementAccessExpression(m)) && m.expression === p && keyOf(m) === "name";
      return readsName && !(ts.isCallExpression(m.parent) && m.parent.expression === m);
    };
    if (ctorRead && !nameRead(n)) add("<eval>", ["<constructor>"]);
    const named = ts.isIdentifier(n) ? n.text : ts.isElementAccessExpression(n) ? lit(n.argumentExpression) : null;
    if (named === "require") add("<require>", ["<require>"]);
    else if (named === "eval" || named === "Function") add("<eval>", ["<eval>"]);
    else if (named === "createRequire" || named === "getBuiltinModule") add("<module loader>", [`<${named}>`]);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  importEntryCache.set(text, entries);
  return entries;
}
function importsOf(text) {
  const out = {};
  for (const e of importEntries(text)) out[e.mod] = [...(out[e.mod] ?? []), ...(e.name === null ? [] : [e.name])];
  return out;
}
/** What differs between a file's imports and its whitelist, as `file:line: what`. */
function importDiff(file, text, want) {
  const pool = new Map(Object.entries(want).map(([m, ns]) => [m, [...ns]]));
  const where = [];
  for (const e of importEntries(text)) {
    if (e.name === null) {
      if (!pool.has(e.mod)) where.push(`${pathOf(file)}:${e.line}: an import of ${e.mod} (not on the list)`);
      continue;
    }
    const ns = pool.get(e.mod);
    const i = ns ? ns.indexOf(e.name) : -1;
    if (i >= 0) ns.splice(i, 1);
    else where.push(`${pathOf(file)}:${e.line}: ${e.name} from ${e.mod} (not on the list)`);
  }
  for (const [m, ns] of pool) for (const n of ns) where.push(`${pathOf(file)}: ${n} from ${m} is on the list but not imported`);
  return where;
}

/** True when `got` (from importsOf) is exactly `want`: the same modules, and for each the same names. */
function importsEqual(got, want) {
  const keys = Object.keys(want);
  return same(Object.keys(got), keys) && keys.every((k) => same(got[k], want[k]));
}

// The write verbs of drizzle's query builder, and the names that mean "a study".
const WRITE_VERBS = new Set(["update", "insert", "delete"]);
const STUDY_NAMES = new Set(["tisProjectsTable", "requestPayload", "resultPayload", "request_payload", "result_payload"]);
const DB_HANDLES = new Set(["db", "tx", "trx"]);

/**
 * What a file does to the database, read from the AST (TypeScript's parser, not
 * its type checker).
 *
 *   writes  every mention of a write verb (update / insert / delete) that is a
 *           member of something, whatever the receiver: `x.update(T)` and
 *           `x["update"](T)` are a "call" with the table named by their one
 *           argument (parentheses, `as`, `!` and `await` unwrapped; anything but a
 *           plain identifier is "<not a table identifier>"); every other way of
 *           getting at a verb is a form of its own that has no table and is never
 *           allowed: a bare reference (`db.update.call(...)`, `db.update.bind(db)`,
 *           `const u = db.update`), a destructured binding (`const { update } = db`,
 *           renamed, string or computed key), or an object-literal property of that
 *           name (assignment destructuring).
 *           So is each way of reaching a verb WITHOUT naming it, on a value that
 *           holds a database handle (below): a computed property access whose key
 *           is not a literal (numeric keys exempt), a computed destructuring key,
 *           a spread, for-in, Object.keys / values / entries / assign /
 *           fromEntries / getOwnProperty* / getPrototypeOf / defineProperty* or
 *           any Reflect.* taking one; and Reflect or Proxy in any use at all.
 *   study   every occurrence of tisProjectsTable / requestPayload / resultPayload
 *           (as an identifier or a string), with the function declaration it is
 *           in and whether it is only an import specifier
 *   dbIdents  every identifier called `db`, by name
 *   members   every property name, string-literal element-access name and
 *           destructured key
 * Each finding carries its line, so a failure can say where it fired.
 *
 * WHICH VALUES HOLD A HANDLE. Identifiers are resolved to their DECLARATION by a
 * lexical scope walk (function, block, for, catch and class scopes; parameters;
 * `var` hoisted to its function, approximately), and taint attaches to the
 * declaration: a same-named binding in another function is another variable, and a
 * `var` declared twice in one scope (`var h = 1; var h = db`), or a `var h` over a
 * parameter h, is one variable (a function declaration and a catch parameter are not
 * joined this way: see the limits below).
 * Seeds: the `db` import binding (renamed or not), a parameter called db, tx or trx,
 * an identifier called db, tx or trx that resolves to nothing in the file, a
 * property named `db` of anything (`globalThis.db`, `ns.db`, `o["db"]`), and a
 * destructuring key `db` (`const { db: h } = o`, `({ db: h } = o)`).
 * Derived: aliasing; property and element access; a conditional, a comma, `||` /
 * `&&` / `??`; an assignment expression (`=`, `||=`, `&&=`, `??=`, destructuring
 * assignment included); an object or array literal or spread holding one; any
 * destructuring of one, and a destructuring DEFAULT that is one (`const { h = db } =
 * {}`, `[h = db]`, `{ a: h = db }`, in a declaration, a parameter, a for-of or an
 * assignment); `new X(handle)`; `await` of a handle (db is not a thenable, so
 * `await db` is db); the loop variable of a for-of over one; a parameter whose
 * default is one; an object handed one in a property assignment (`box.h = db`); a
 * class property initialised or assigned from one, read back as `this.x`, `(this as
 * any).x`, `this!.x`, `this["x"]` (a literal key), `this.#x`, or, for a static, `C.x`
 * where C names a class DECLARATION; every
 * parameter of a function literal passed to a method of a handle
 * (`db.transaction(async (t) => ...)`, whatever the parameter is called; `[db].map((d)
 * => ...)`); and the result of such a call when the callback returns a handle
 * (`await db.transaction(async (x) => x)`, `x ? x : null`, `({ x })`) or a builder
 * inside an object or array literal (`({ q: x.insert(T) })`, `[x.insert(T)]`). A method
 * call on a handle yields a BUILDER (`db.insert(T).values(..)`), which still carries
 * write methods such as onConflictDoUpdate, so the rules above apply to it too.
 * NOT derived: `await` of a builder (a query's RESULT is data: `rows[i]`, `{ ...row }`,
 * `Object.keys(row)` and `[...rows].sort()` are ordinary code), including a builder a
 * transaction callback returns bare (`await db.transaction(async (tx) =>
 * tx.select().from(t))` hands back rows), and a call whose callee is not rooted at a
 * handle (`Object.fromEntries(rows.map(..))`).
 *
 * WHAT THIS IS NOT. It is a tripwire against ordinary and adversarially spelled
 * writes, not a sandbox against runtime reflection. Known limits, deliberately not
 * chased (the type checker would be needed, or they are runtime behaviour):
 *   - a handle RETURNED from a call other than the callback case above: an IIFE
 *     `(() => db)()`, `await Promise.resolve(db)`, `Promise.all([db])`, `new
 *     Promise((r) => r(db))`, a helper, a getter, a method, a generator's yield;
 *   - a helper that RECEIVES the handle as an argument, `w(db, tisProjectsTable)`,
 *     unless its parameter is called db, tx or trx; and a callback passed to
 *     db.transaction by name rather than written in place;
 *   - db.transaction reached through `.bind(db)` or `.apply(db, [cb])`: the bound or
 *     applied function is a builder, so the callback's parameter is not seeded;
 *   - a handle put into a container by a METHOD CALL and read back (`arr.push(db)`,
 *     `arr.unshift(db)`, `map.set(k, db)`, `set.add(db)`, `weakMap.set(o, db)`,
 *     `Array.from([db])`), or moved through `throw` and `catch`;
 *   - `this` beyond the class spellings above: `this.x` in an object-literal method,
 *     `const self = this`, `const { x } = this`, `this[k]` with a variable key (a
 *     computed access is refused on a value known to hold a handle, and `this` is not
 *     one), an inherited field, an instance's property read from outside (`new C().x`,
 *     or an instance handed in as a parameter), a constructor parameter property
 *     default `constructor(public x = db)`, a TypeScript namespace export `NS.x`;
 *   - a static read through anything but the class declaration's own name: a class
 *     EXPRESSION (`const K = class { static h = db }; K.h`) or an alias of a class
 *     (`const B = A; B.h`);
 *   - a name declared twice in one scope by two different kinds of declaration: inside
 *     a function body, a function declaration and then `var h = db` (`function h() {}
 *     var h = db; h[k]`), and a catch parameter written through a `var` of the same name
 *     inside the catch (`catch (h) { var h = db; h[k] }`): the two are kept as two
 *     variables, and the reads resolve to the one the handle was not written to;
 *   - E7: a binding that merely shares an allowed table's name (a function
 *     `f(studyProofreadRunsTable)` handed tis_projects by its caller) reads as
 *     that table, since table names are read as names;
 *   - a key or specifier built from runtime data: on a handle it is refused as a
 *     computed access, anywhere else it is not followed, and a specifier reads as
 *     "<dynamic import>";
 *   - false positives kept on purpose: the verb scan is receiver-agnostic, so
 *     `someMap.delete(k)`, `set.delete(x)` and an object key called insert /
 *     update / delete are refused in the store, the runner and the routes; a
 *     parameter called db, tx or trx is a handle even when it is an array.
 * The proof that survives every spelling is a test that observes the database, a
 * row hash before and after a request on a real Postgres; it is not part of this
 * guard (it needs a Postgres service in CI) and is the recommended addition once
 * phase 1 ships.
 */
const REFLECT_FNS = new Set(["keys", "values", "entries", "assign", "fromEntries", "getOwnPropertyNames", "getOwnPropertyDescriptor", "getOwnPropertyDescriptors", "getPrototypeOf", "setPrototypeOf", "defineProperty", "defineProperties"]);
const dbScanCache = new Map();
function dbScan(text) {
  if (dbScanCache.has(text)) return dbScanCache.get(text);
  const sf = parse(text);
  const writes = [];
  const study = [];
  const dbIdents = [];
  const members = new Set();
  const lit = (e) => (e && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : null);
  // Parentheses and type-only wrappers say nothing about the value. `await` does: it
  // turns a query into its rows, so it is not unwrapped for the handle rules below (the
  // table argument of a write is still read through it).
  const unwrapCast = (e) => {
    while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e))) e = e.expression;
    return e;
  };
  const unwrap = (e) => {
    while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e) || ts.isAwaitExpression(e))) e = e.expression;
    return e;
  };
  const fnOf = (n) => {
    for (let p = n.parent; p; p = p.parent) if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
    return null;
  };
  // The function a finding is in (for the loader rule) and its line (for the failure message).
  const loc = (n) => ({ fn: fnOf(n), line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 });
  const inImport = (n) => {
    for (let p = n.parent; p; p = p.parent) if (ts.isImportDeclaration(p)) return true;
    return false;
  };
  const keyText = (k) => (ts.isIdentifier(k) || ts.isPrivateIdentifier(k) || ts.isStringLiteral(k) || ts.isNoSubstitutionTemplateLiteral(k) ? k.text : ts.isComputedPropertyName(k) ? lit(k.expression) : null);

  // ---- Lexical scopes: every identifier resolves to the binding that declares it. ----
  const isFunctionLike = (n) =>
    ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);
  const isBlockScope = (n) => ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n) || ts.isCaseBlock(n) || ts.isForStatement(n) || ts.isForInStatement(n) || ts.isForOfStatement(n) || isFunctionLike(n);
  const nearest = (n, pred) => {
    for (let p = n.parent; p; p = p.parent) if (pred(p)) return p;
    return sf;
  };
  const bindingIds = (name) =>
    ts.isIdentifier(name) ? [name] : ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name) ? name.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : bindingIds(el.name))) : [];
  const scopes = new Map();
  // A name declared twice in one scope map (`var h = 1; var h = db`, or `var h` over a parameter h)
  // is ONE variable: every later declaring identifier maps to the first, so a taint written
  // through the second lands on the binding that references resolve to. Inside a function body, a
  // function declaration and a `var` of its name, or a catch parameter and a `var` inside the
  // catch, land in different scope maps here and are not joined (a named limit, in the comment
  // above dbScan).
  const canon = new Map();
  const declare = (scope, name) => {
    if (!scopes.has(scope)) scopes.set(scope, new Map());
    for (const id of bindingIds(name)) {
      if (!scopes.get(scope).has(id.text)) scopes.get(scope).set(id.text, id);
      else if (scopes.get(scope).get(id.text) !== id) canon.set(id, scopes.get(scope).get(id.text));
    }
  };
  const seeds = [];
  // identifiers written by an assignment destructuring that reads the key db (`({ db: h } = o)`)
  const seedRefs = [];
  const declareAll = (n) => {
    if (ts.isVariableDeclaration(n)) {
      const list = n.parent;
      if (ts.isCatchClause(list)) declare(list, n.name);
      // let / const are block scoped; var hoists to its function (an approximation that ignores TDZ)
      else declare(list.flags & ts.NodeFlags.BlockScoped ? nearest(n, isBlockScope) : nearest(n, (p) => isFunctionLike(p) || ts.isSourceFile(p)), n.name);
    } else if (ts.isParameter(n)) {
      declare(n.parent, n.name);
      // By convention a parameter called db, tx or trx IS a handle (a helper handed the
      // transaction): kept as a seed so the old name rule still holds for parameters.
      for (const id of bindingIds(n.name)) if (DB_HANDLES.has(id.text)) seeds.push(id);
    } else if ((ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) && n.name) declare(nearest(n, isBlockScope), n.name);
    else if ((ts.isFunctionExpression(n) || ts.isClassExpression(n)) && n.name) declare(n, n.name);
    else if (ts.isImportClause(n) && n.name) declare(sf, n.name);
    else if (ts.isImportSpecifier(n) || ts.isNamespaceImport(n) || ts.isImportEqualsDeclaration(n)) {
      declare(sf, n.name);
      // the database handle itself, however it is imported or renamed
      if (n.name.text === "db" || (ts.isImportSpecifier(n) && n.propertyName && keyText(n.propertyName) === "db")) seeds.push(n.name);
    }
    // a destructuring key called db reads a property named db, which is a seed like `x.db`:
    // `const { db: h } = globalThis`, `const { db } = o`
    if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent) && keyText(n.propertyName ?? n.name) === "db") seeds.push(...bindingIds(n.name));
    ts.forEachChild(n, declareAll);
  };
  declareAll(sf);
  const resolve = (id) => {
    for (let p = id.parent; p; p = p.parent) {
      const m = scopes.get(p);
      if (m && m.has(id.text)) return m.get(id.text);
    }
    return null;
  };

  // ---- Which values are, or hold, a database handle. ----
  // A HANDLE is db (as imported), an unresolved identifier called db / tx / trx, a parameter
  // called db / tx / trx, and anything derived from a handle by aliasing, property or element
  // access, a conditional, a comma, `||` / `&&` / `??`, an assignment expression, an object or
  // array literal or spread holding one, destructuring, `new X(handle)`, a for-of over one, a
  // parameter defaulting to one, a class property initialised from one (read back as this.x),
  // and a property named db of anything. A BUILDER is what a method call on a handle or a
  // builder returns (db.insert(T), db.insert(T).values(..)): it still carries write methods,
  // so the reflection rules apply to it too. Neither survives `await` (a query RESULT is
  // data: rows, a row, findings) nor a call whose callee is not rooted at a handle
  // (Promise.resolve(db), helper(rows)). Taint attaches to the declaring binding, so a
  // same-named binding in another function is a different variable.
  const RANK = { none: 0, builder: 1, handle: 2 };
  const max = (a, b) => (RANK[a] >= RANK[b] ? a : b);
  const tainted = new Map();
  const classProps = new Map();
  const classOf = (n) => {
    for (let p = n.parent; p; p = p.parent) if (ts.isClassDeclaration(p) || ts.isClassExpression(p)) return p;
    return null;
  };
  // The class whose property a member expression names: `this.x`, `(this as any).x`, `this!.x`,
  // `this["x"]`, `this.#x` (the enclosing class), and `C.x` for an identifier that resolves to a
  // class declaration (a static property). Null for anything else.
  const memberClass = (m) => {
    if (!(ts.isPropertyAccessExpression(m) || (ts.isElementAccessExpression(m) && lit(m.argumentExpression) !== null))) return null;
    const recv = unwrapCast(m.expression);
    if (!recv) return null;
    if (recv.kind === ts.SyntaxKind.ThisKeyword) return classOf(m);
    if (ts.isIdentifier(recv)) {
      const b = resolve(recv);
      return b && b.parent && ts.isClassDeclaration(b.parent) ? b.parent : null;
    }
    return null;
  };
  const memberName = (m) => (ts.isPropertyAccessExpression(m) ? m.name.text : lit(m.argumentExpression));
  const classPropKind = (m) => {
    const c = memberClass(m);
    return c ? (classProps.get(c)?.get(memberName(m)) ?? "none") : "none";
  };
  const kindOf = (e0) => {
    const e = unwrapCast(e0);
    if (!e) return "none";
    if (ts.isIdentifier(e)) {
      const b = resolve(e);
      return b ? (tainted.get(b) ?? "none") : DB_HANDLES.has(e.text) ? "handle" : "none";
    }
    if (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) {
      const k = classPropKind(e);
      if (k !== "none") return k;
      return memberName(e) === "db" ? "handle" : kindOf(e.expression);
    }
    // Awaiting a HANDLE yields the handle (it is not a thenable); awaiting a builder yields its rows.
    if (ts.isAwaitExpression(e)) return kindOf(e.expression) === "handle" ? "handle" : "none";
    if (ts.isCallExpression(e)) {
      const callee = kindOf(e.expression);
      if (callee === "none") return "none";
      // A method of a handle handed a callback that RETURNS a handle resolves to that handle:
      // `await db.transaction(async (x) => x)`.
      if (callee === "handle" && e.arguments.some((a) => { const f = fnArg(a); return f !== null && returnsHeld(f); })) return "handle";
      return "builder";
    }
    if (ts.isNewExpression(e)) return (e.arguments ?? []).reduce((k, a) => max(k, kindOf(a)), "none");
    if (ts.isConditionalExpression(e)) return max(kindOf(e.whenTrue), kindOf(e.whenFalse));
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.CommaToken || op === ts.SyntaxKind.EqualsToken) return kindOf(e.right);
      if ([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken].includes(op)) return max(kindOf(e.left), kindOf(e.right));
      return "none";
    }
    if (ts.isArrayLiteralExpression(e)) return e.elements.reduce((k, x) => max(k, kindOf(ts.isSpreadElement(x) ? x.expression : x)), "none");
    if (ts.isObjectLiteralExpression(e)) {
      return e.properties.reduce((k, p) => max(k, ts.isSpreadAssignment(p) ? kindOf(p.expression) : ts.isPropertyAssignment(p) ? kindOf(p.initializer) : ts.isShorthandPropertyAssignment(p) ? kindOf(p.name) : "none"), "none");
    }
    return "none";
  };
  const isHeld = (e) => kindOf(e) !== "none";

  // Every way a binding receives a value, collected once and run to a fixed point.
  const events = [];
  // The variables an assignment target writes: x, a destructuring pattern's names, and the
  // base variable of obj.x / obj[k] (an object that is handed a handle holds one).
  const targets = (t0) => {
    const t = unwrapCast(t0);
    if (!t) return [];
    if (ts.isIdentifier(t)) return [{ id: t }];
    if (memberClass(t)) return [{ prop: t }];
    if (ts.isPropertyAccessExpression(t) || ts.isElementAccessExpression(t)) return targets(t.expression);
    if (ts.isObjectLiteralExpression(t)) {
      return t.properties.flatMap((p) => (ts.isPropertyAssignment(p) ? targets(p.initializer) : ts.isShorthandPropertyAssignment(p) ? [{ id: p.name }] : ts.isSpreadAssignment(p) ? targets(p.expression) : []));
    }
    if (ts.isArrayLiteralExpression(t)) return t.elements.flatMap((x) => targets(ts.isSpreadElement(x) ? x.expression : x));
    if (ts.isBinaryExpression(t) && t.operatorToken.kind === ts.SyntaxKind.EqualsToken) return targets(t.left);
    return [];
  };
  const fnArg = (a) => {
    const u = unwrapCast(a);
    return u && (ts.isArrowFunction(u) || ts.isFunctionExpression(u)) ? u : null;
  };
  // Does a function literal hand a handle back to its caller? (its own returns, not those of nested
  // functions.) A returned HANDLE does; so does a BUILDER inside an object or array literal
  // (`({ q: x.insert(T) })`, `[x.insert(T)]`), which the caller can still call. A bare builder
  // does not: the transaction awaits it, and what comes back is its rows, which are data
  // (`await db.transaction(async (tx) => tx.select().from(t))`).
  const holds = (e) => {
    const k = kindOf(e);
    const u = unwrapCast(e);
    return k === "handle" || (k === "builder" && !!u && (ts.isObjectLiteralExpression(u) || ts.isArrayLiteralExpression(u)));
  };
  const returnsHeld = (f) => {
    if (!ts.isBlock(f.body)) return holds(f.body);
    let held = false;
    const v = (x) => {
      if (held || isFunctionLike(x)) return;
      if (ts.isReturnStatement(x) && x.expression && holds(x.expression)) held = true;
      ts.forEachChild(x, v);
    };
    ts.forEachChild(f.body, v);
    return held;
  };
  const collect = (n) => {
    if (ts.isVariableDeclaration(n)) {
      if (n.initializer) events.push({ ids: bindingIds(n.name), src: n.initializer });
      else if (ts.isVariableDeclarationList(n.parent) && ts.isForOfStatement(n.parent.parent)) events.push({ ids: bindingIds(n.name), src: n.parent.parent.expression });
    } else if (ts.isParameter(n) && n.initializer) events.push({ ids: bindingIds(n.name), src: n.initializer });
    // a destructuring default: `const { h = db } = {}`, `[h = db]`, `{ a: h = db }`, in a
    // declaration, a parameter or a for-of; and the assignment form `({ h = db } = {})`
    else if (ts.isBindingElement(n) && n.initializer) events.push({ ids: bindingIds(n.name), src: n.initializer });
    else if (ts.isShorthandPropertyAssignment(n) && n.objectAssignmentInitializer) events.push({ refs: [{ id: n.name }], src: n.objectAssignmentInitializer });
    else if (ts.isPropertyDeclaration(n) && n.initializer && n.name && keyText(n.name) !== null) events.push({ cls: n.parent, name: keyText(n.name), src: n.initializer });
    else if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken].includes(n.operatorToken.kind)) {
      events.push({ refs: targets(n.left), src: n.right });
      // `({ db: h } = o)` reads o.db into h, like `const { db: h } = o`
      const dbKeys = (t0) => {
        const t = unwrapCast(t0);
        if (!t || !ts.isObjectLiteralExpression(t)) return;
        for (const p of t.properties) {
          if (ts.isPropertyAssignment(p) && keyText(p.name) === "db") seedRefs.push(...targets(p.initializer).filter((r) => r.id).map((r) => r.id));
          else if (ts.isShorthandPropertyAssignment(p) && p.name.text === "db") seedRefs.push(p.name);
          else if (ts.isPropertyAssignment(p)) dbKeys(p.initializer);
        }
      };
      if (n.operatorToken.kind === ts.SyntaxKind.EqualsToken) dbKeys(n.left);
    } else if (ts.isForOfStatement(n) && !ts.isVariableDeclarationList(n.initializer)) events.push({ refs: targets(n.initializer), src: n.expression });
    else if (ts.isCallExpression(n)) {
      // a function literal handed to a method of a handle receives a handle: db.transaction(async (t) => ...)
      for (const a of n.arguments) {
        const f = fnArg(a);
        if (f) events.push({ callee: n.expression, params: f.parameters.flatMap((p) => bindingIds(p.name)) });
      }
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);
  let changed = true;
  const taint = (id0, k) => {
    const id = canon.get(id0) ?? id0;
    if (!id || k === "none") return;
    const cur = tainted.get(id) ?? "none";
    const next = max(cur, k);
    if (next !== cur) tainted.set(id, next), (changed = true);
  };
  for (const id of seeds) taint(id, "handle");
  for (const r of seedRefs) taint(resolve(r), "handle");
  while (changed) {
    changed = false;
    for (const ev of events) {
      if (ev.callee) {
        if (kindOf(ev.callee) === "handle") for (const id of ev.params) taint(id, "handle");
        continue;
      }
      const k = kindOf(ev.src);
      if (k === "none") continue;
      if (ev.ids) for (const id of ev.ids) taint(id, k);
      if (ev.cls) {
        if (!classProps.has(ev.cls)) classProps.set(ev.cls, new Map());
        const m = classProps.get(ev.cls);
        if (max(m.get(ev.name) ?? "none", k) !== (m.get(ev.name) ?? "none")) m.set(ev.name, max(m.get(ev.name) ?? "none", k)), (changed = true);
      }
      if (ev.refs) {
        for (const r of ev.refs) {
          if (r.id) taint(resolve(r.id), k);
          else if (r.prop) {
            const c = memberClass(r.prop);
            const name = memberName(r.prop);
            if (!c || name === null) continue;
            if (!classProps.has(c)) classProps.set(c, new Map());
            const m = classProps.get(c);
            const cur = m.get(name) ?? "none";
            if (max(cur, k) !== cur) m.set(name, max(cur, k)), (changed = true);
          }
        }
      }
    }
  }
  const heldBinding = (name) => bindingIds(name).some((id) => tainted.has(canon.get(id) ?? id));
  const computedKeyIn = (pattern) => {
    let found = false;
    const v = (x) => {
      if (ts.isPropertyAssignment(x) && ts.isComputedPropertyName(x.name) && lit(x.name.expression) === null) found = true;
      ts.forEachChild(x, v);
    };
    v(pattern);
    return found;
  };

  const visit = (n) => {
    let verb = null;
    if (ts.isPropertyAccessExpression(n)) {
      members.add(n.name.text);
      if (WRITE_VERBS.has(n.name.text)) verb = n.name.text;
    } else if (ts.isElementAccessExpression(n)) {
      const key = lit(n.argumentExpression);
      if (key !== null) {
        members.add(key);
        if (WRITE_VERBS.has(key)) verb = key;
      } else if (!ts.isNumericLiteral(n.argumentExpression) && isHeld(n.expression)) {
        writes.push({ form: "computed access on a db handle or a value derived from one", ...loc(n.argumentExpression) });
      }
    }
    if (verb !== null) {
      const parent = n.parent;
      if (ts.isCallExpression(parent) && parent.expression === n) {
        const a = parent.arguments.length === 1 ? unwrap(parent.arguments[0]) : null;
        writes.push({ verb, form: "call", table: a && ts.isIdentifier(a) ? a.text : "<not a table identifier>", ...loc(ts.isPropertyAccessExpression(n) ? n.name : n) });
      } else writes.push({ verb, form: "reference", ...loc(ts.isPropertyAccessExpression(n) ? n.name : n) });
    }
    if (ts.isBindingElement(n) && ts.isObjectBindingPattern(n.parent)) {
      const k = keyText(n.propertyName ?? n.name);
      if (k !== null) members.add(k);
      if (k !== null && WRITE_VERBS.has(k)) writes.push({ verb: k, form: "destructured", ...loc(n) });
      if (n.propertyName && ts.isComputedPropertyName(n.propertyName) && k === null && heldBinding(n.name)) writes.push({ form: "computed destructuring key on a db-derived value", ...loc(n) });
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isObjectLiteralExpression(unwrapCast(n.left)) && isHeld(n.right) && computedKeyIn(n.left)) {
      writes.push({ form: "computed destructuring key on a db-derived value", ...loc(n) });
    }
    if (ts.isShorthandPropertyAssignment(n) || ts.isPropertyAssignment(n)) {
      const k = keyText(n.name);
      if (k !== null && WRITE_VERBS.has(k)) writes.push({ verb: k, form: "object property", ...loc(n) });
    }
    if ((ts.isSpreadAssignment(n) || ts.isSpreadElement(n)) && isHeld(n.expression)) writes.push({ form: "spread of a db-derived value", ...loc(n) });
    if (ts.isForInStatement(n) && isHeld(n.expression)) writes.push({ form: "for-in over a db-derived value", ...loc(n) });
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && ((e.expression.text === "Object" && REFLECT_FNS.has(e.name.text)) || e.expression.text === "Reflect") && n.arguments.some(isHeld)) {
        writes.push({ form: "reflection on a db-derived value", ...loc(n) });
      }
    }
    if (ts.isIdentifier(n)) {
      if (n.text === "Reflect" || n.text === "Proxy") writes.push({ form: "Reflect or Proxy", ...loc(n) });
      if (STUDY_NAMES.has(n.text)) study.push({ name: n.text, ...loc(n), inImport: inImport(n) });
      if (n.text === "db") dbIdents.push({ ...loc(n) });
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (STUDY_NAMES.has(n.text)) study.push({ name: n.text, ...loc(n), inImport: false });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const result = { writes, study, dbIdents, members };
  dbScanCache.set(text, result);
  return result;
}

/** A dbScan write, as `file:line: what`. */
const fmtWrite = (file, w) => `${pathOf(file)}:${w.line}: ${w.form === "call" ? `${w.verb}(${w.table})` : `${w.verb ? `${w.verb}: ` : ""}${w.form}`}${w.fn ? ` in ${w.fn}` : ""}`;
const fmtAt = (file, x, what) => `${pathOf(file)}:${x.line}: ${what}`;

/**
 * What the store may write, verb by table, exactly as its code does today:
 * insertQueuedRun inserts a run, claimOneRun and completeRun update one,
 * completeRun inserts findings, and carryForwardDispositions and
 * insertDisposition insert dispositions. Nothing is deleted. The schema makes
 * runs -> findings -> dispositions ON DELETE CASCADE, so deleting a run or a
 * finding erases the disposition rows under it: a delete of ANY of the three
 * is a delete from the append-only log by another name. A Map, so a table
 * spelled like an Object.prototype member is just an unknown table.
 */
const STORE_WRITES = new Map([
  ["studyProofreadRunsTable", ["insert", "update"]],
  ["studyProofreadFindingsTable", ["insert"]],
  ["studyProofreadDispositionsTable", ["insert"]],
]);
const storeMayWrite = (verb, table) => STORE_WRITES.has(table) && STORE_WRITES.get(table).includes(verb);

/**
 * Raw SQL that writes, in any letter case, read for its SQL SHAPE:
 *   UPDATE ... SET                  (`FOR UPDATE` and `FOR NO KEY UPDATE` row locks are exempt)
 *   UPDATE [ONLY] <t>               with <t> reading like a table (below), so a SET that sits in
 *                                    a substitution or another literal is still read
 *                                    (`update ${tbl} ${set}`, `update firms ${set}`)
 *   INSERT INTO <t>                 then `(`, VALUES, SELECT, DEFAULT, OVERRIDING or WITH,
 *                                    or <t> reads like a table
 *   DELETE FROM <t>                 then WHERE, USING, RETURNING, `;`, `)` or the end
 *                                    (also after `AS alias`), or <t> reads like a table
 *   COPY <t> FROM                   with PROGRAM / STDIN / a quoted path, or <t> reads like a table
 *   SELECT ... INTO <t>             with <t> reading like a table or followed by FROM
 *   TRUNCATE, MERGE INTO, ON CONFLICT ... DO UPDATE, DROP TABLE / SCHEMA / OWNED,
 *   ALTER TABLE                     anywhere, as words
 * A verb, and ONLY, is followed by whitespace or, before a quoted name or a substitution, by
 * nothing at all: Postgres reads `delete from"firms"` as `delete from "firms"`, and drizzle renders
 * a table substitution as a quoted name, so sql`delete from${t}` and sql`update${t} ${set}` reach
 * it as `delete from"t"` and `update"t" ..` and are read as writes.
 * A target READS LIKE A TABLE when it is quoted (`"t"`, or Unicode-escaped, `U&"t"`), interpolated
 * (`${...}`), schema-qualified (a dot with a name right after it or whitespace before it:
 * `public.t`, `public .t`, `public . t`), snake_case, or, after any qualifier, the name of a table
 * this schema declares. The last is read from the schema itself (SCHEMA_TABLES: the first argument
 * of every pgTable call in every .ts file under lib/db/src/schema at any depth, read with TypeScript's
 * parser, see schemaTablesIn), because not every table is snake_case: crashes, events, firms, sessions
 * and users have neither an underscore nor a dot, so by spelling alone `delete from firms f where ..`
 * reads like prose. A table added to the schema later is read the same way without an edit here,
 * however its pgTable call is spelled; one declared in a way the reader cannot name (a name that is not
 * a string literal, pgTable used other than by a direct call, pgSchema, pgTableCreator) fails
 * schema-tables-are-read. What the reader neither reads nor refuses is listed at schemaTablesIn.
 * Postgres reads a comment as whitespace, so each text is read as written, with its comments
 * blanked the way Postgres lexes them (a block comment nests; a line comment ends at CR or LF),
 * and with only the comments outside quoted strings blanked: a `--` inside a quoted string would
 * hide a write from the second read alone, which the first keeps, and a quoted `'--'` ahead of a
 * write whose words a comment splits would hide it from both, which the third reads (see
 * blankSqlComments). The text is every string literal and template (a substitution counts as a
 * target: `update ${tisProjectsTable} set`) and every `+` chain of them (`"update " + "tis_" +
 * "projects"`; an operand that is not a literal reads as a substitution), both cooked and as
 * written; as written, a template's text includes the source of its substitutions, so
 * `${sql.raw("update")} t set` is read; and once more with each substitution that is literal
 * text written in place inlined as that text (a string literal, a template, sql`..`, a `+` of
 * them, or a call of one such argument: sql.raw("delete from"), sql.identifier("t")), so
 * sql`${sql.raw('delete from')} firms f where ..` and sql`upd${"ate"} t ${set}` are read.
 * PROSE THAT READS LIKE SQL IS REFUSED; REWORD IT. "update failed", `update failed for run
 * ${id}`, "could not insert into the queue", "refusing to delete from the log", "could not
 * update the claim" and "Failed to update project." (the house-style 500: a dot that ends a
 * sentence has no name after it) pass, but prose in one of the shapes above is refused with its
 * file and line: `update .. set` with no `;` between ("could not update run: status was not
 * set"), `insert into <word> (` ("failed to insert into findings (run 5)"), `delete from <word>`
 * at the end ("refusing to delete from queue"), `update ${..}` (`could not update ${kind}`, and a
 * plural glued to the verb, `${n} update${n === 1 ? "" : "s"} applied`), a schema table after a
 * verb ("could not update users"), a dotted word after a verb ("failed to update run.status",
 * "please update node.js", "update v1.2 is available"), a quoted word ('could not update
 * "status" on the run'), a snake_case word ("cannot update run_id 5"), the bare words truncate /
 * merge into, and a SQL comment inside a raw-SQL template that says one of these ("-- update the
 * claim, then set attempts": the as-written read keeps comments).
 * NOT READ: SQL assembled at run time from anything but literals written in place (join,
 * concat, sql.append, String.fromCharCode, atob, a `${VERB}` const or any substitution that is
 * not literal text, `upd${a}`; and by the database itself, EXECUTE in a DO block); a target
 * that reads like no table (unquoted, unqualified, no underscore, not declared in this schema,
 * so not a table this database has unless code outside lib/db/src/schema declares one or one is
 * created outside the schema files) when what follows it is a bare alias
 * (`delete from t f where ..`), `*`, an INSERT's `AS alias` or `TABLE x`, or a substitution
 * (and so `public. t f`, whose dot has whitespace after it only, as a sentence's does),
 * and `COPY <it> FROM E'..'` / `FROM $$..$$` and `SELECT .. INTO <it>` with no FROM; and verbs
 * outside this list (CREATE TABLE .. AS, GRANT / REVOKE, CREATE TRIGGER / RULE, LOCK,
 * VACUUM FULL, REFRESH MATERIALIZED VIEW).
 * Unlike the substring scans the header names, this scan is NOT additive: the scan it
 * replaced (5de94c0) refused the verbs as words, so prose that one refused now passes, and the
 * inputs this one does not read are the ones listed above.
 */
/** The path, relative to a directory, of every .ts file under it at any depth (symbolic links followed once), sorted; null when it cannot be read. */
function tsFilesUnder(dir) {
  const out = [];
  const seen = new Set();
  const walk = (rel) => {
    const abs = at(rel ? `${dir}/${rel}` : dir);
    const real = realpathSync(abs);
    if (seen.has(real)) return;
    seen.add(real);
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const st = e.isSymbolicLink() ? statSync(at(`${dir}/${r}`)) : e;
      if (st.isDirectory()) walk(r);
      else if (st.isFile() && /\.[cm]?ts$/.test(e.name)) out.push(r);
    }
  };
  try {
    walk("");
  } catch {
    return null;
  }
  return out.sort();
}
/** [path, text] of every .ts file under a schema directory, or [] when it cannot be read. */
function schemaFiles(dir) {
  return (tsFilesUnder(dir) ?? []).map((f) => [f, read(`${dir}/${f}`)]);
}
/** drizzle's table makers: pgTable's first argument is the table's name; the other two build or qualify it. */
const TABLE_MAKERS = ["pgTable", "pgTableCreator", "pgSchema"];
/**
 * The table names a set of schema files declares, read with TypeScript's parser: the first argument of every
 * call of drizzle's pgTable, whatever sits between the callee, the `(` and the argument (a comment, whitespace, a
 * line break), whether pgTable is called by its own name, by the name an import gives it (`import { pgTable as
 * table } from "drizzle-orm/pg-core"`, or from a schema module that re-exports it), or as a property (`pg.pgTable(..)`
 * or `pg["pgTable"](..)` after `import * as pg`). `unread` names, by file and line, everything that declares a table
 * this reader cannot name: a pgTable call whose first argument is not a string literal; a use of pgTable other than a
 * direct call (`const t = pgTable`, `pgTable.withRLS(..)`, `(pgTable)(..)`, a re-export); and any use of
 * pgTableCreator or pgSchema (the names they make are built or qualified when the module runs).
 * schema-tables-are-read fails on any of them. Not read: pgTable reached through a computed key that is not a
 * literal (`pg[k](..)`); a table declared by code outside lib/db/src/schema (a helper elsewhere that calls pgTable
 * for the schema); and a table created outside the schema files altogether.
 */
function schemaTablesIn(files) {
  const names = [];
  const unread = [];
  for (const [file, text] of files) {
    const sf = parse(text);
    // local name -> the maker it is bound to: each maker under its own name, and under any name an import gives it
    const maker = new Map(TABLE_MAKERS.map((m) => [m, m]));
    for (const st of sf.statements) {
      const b = ts.isImportDeclaration(st) ? st.importClause?.namedBindings : undefined;
      if (b && ts.isNamedImports(b)) {
        for (const el of b.elements) if (TABLE_MAKERS.includes((el.propertyName ?? el.name).text)) maker.set(el.name.text, (el.propertyName ?? el.name).text);
      }
    }
    const where = (n) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
    const snippet = (n) => n.getText(sf).replace(/\s+/g, " ").slice(0, 60);
    const makerOf = (e) => {
      if (ts.isIdentifier(e)) return maker.get(e.text) ?? null;
      if (ts.isPropertyAccessExpression(e) && TABLE_MAKERS.includes(e.name.text)) return e.name.text;
      if (ts.isElementAccessExpression(e) && ts.isStringLiteralLike(e.argumentExpression) && TABLE_MAKERS.includes(e.argumentExpression.text)) return e.argumentExpression.text;
      return null;
    };
    // a property's own name (the `pgTable` of x.pgTable, of { pgTable: 1 }, of a method or a field) is not a use of a binding
    const isOwnName = (n) => {
      const p = n.parent;
      return !!p && p.name === n && (ts.isPropertyAccessExpression(p) || ts.isPropertyAssignment(p) || ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p));
    };
    const visit = (n) => {
      if (ts.isImportDeclaration(n)) return;
      if (ts.isCallExpression(n) && makerOf(n.expression) === "pgTable") {
        const a = n.arguments[0];
        if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) names.push(a.text);
        else unread.push(`${where(n)}: a pgTable call whose table name is not a string literal: ${snippet(n)}`);
        n.arguments.forEach(visit);
        return;
      }
      const m = ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n) || (ts.isIdentifier(n) && !isOwnName(n)) ? makerOf(n) : null;
      if (m) {
        const use = n.parent && !ts.isSourceFile(n.parent) ? n.parent : n;
        unread.push(m === "pgTable" ? `${where(n)}: pgTable used other than by a direct call: ${snippet(use)}` : `${where(n)}: a table made by ${m}, whose name this reader does not read: ${snippet(use)}`);
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { names, unread };
}
const schemaTableNames = (dir) => schemaTablesIn(schemaFiles(dir)).names;
// Usable means the names it must have are there: a schema directory that moved, or a reader
// that stopped matching, would otherwise drop the names silently and let `delete from firms f` by.
const schemaNamesUsable = (names) => ["firms", "users"].every((n) => names.includes(n));
/** The schema's tables whose name has neither an underscore nor a dot: by spelling they read like prose. */
const proseLike = (names) => [...new Set(names)].filter((n) => !/[_.]/.test(n)).sort();
/** What a schema (path -> text) declares, as the raw-SQL scan uses it; cached per schema object, which a teeth edit replaces. */
const schemaReads = new WeakMap();
function schemaReadOf(schema) {
  let r = schemaReads.get(schema);
  if (!r) {
    const { names, unread } = schemaTablesIn(Object.entries(schema));
    r = { tables: [...new Set(names)].sort(), unread, prose: proseLike(names) };
    schemaReads.set(schema, r);
  }
  return r;
}
const SCHEMA_READ = schemaReadOf(sources.schema);
const SCHEMA_TABLES = SCHEMA_READ.tables;
const PROSE_LIKE_TABLES = SCHEMA_READ.prose;
ok(
  schemaNamesUsable(PROSE_LIKE_TABLES),
  "precondition: the raw-SQL scan reads this schema's table names from lib/db/src/schema (the first argument of every pgTable call, read with TypeScript's parser, in every .ts file at any depth), and the ones with neither an underscore nor a dot include firms and users",
  `read ${SCHEMA_TABLES.length} table name(s); with no underscore: ${JSON.stringify(PROSE_LIKE_TABLES)}`,
);
// A quoted name, plain or Unicode-escaped (U&"\0066irms" is firms), and one part of a qualified name.
const SQL_QUOTED = String.raw`(?:u&)?"[^"]*"`;
const SQL_NAME = String.raw`(?:${SQL_QUOTED}|[\w$]+)`;
// Table-like: [a qualifier, with or without whitespace around its dot] then a quoted name, a substitution, a
// snake_case word or a schema table; or a qualified name whose dot has whitespace before it or a name right after
// it (`public.x`, `public .x`, `public . x`). A dot with neither, `project.` at the end of a sentence, is prose.
// The schema tables are the ones a schema read declares with neither an underscore nor a dot (each name taken
// literally, whatever characters it holds).
const reLiteral = (x) => x.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const sqlTableLike = (prose) =>
  String.raw`(?:(?:${SQL_NAME}\s*\.\s*)?(?:${SQL_QUOTED}|\$\{\}|[\w$]*_[\w$]*${prose.length ? `|(?:${prose.map(reLiteral).join("|")})\\b` : ""})|[\w$]+(?:(?:\s+\.\s*|\.)${SQL_NAME})+)`;
// What separates a verb (or ONLY) from its target: whitespace, or nothing at all before a quoted name or a
// substitution. Postgres reads `delete from"firms"` as `delete from "firms"`, and drizzle renders a table
// substitution as a quoted name, so sql`delete from${t}` and sql`update${t} ${set}` reach it as `from"t"`, `update"t"`.
const SQL_SEP = String.raw`(?:\s+|(?="|\$\{))`;
const SQL_TARGET = String.raw`(?:only${SQL_SEP})?(?:${SQL_QUOTED}|\$\{\}|[^\s(;),]+)`;
/** The write shapes, for a schema whose prose-like table names are `prose`; built once per list. */
const rawSqlShapesCache = new Map();
function rawSqlShapes(prose) {
  const key = prose.join("\n");
  if (rawSqlShapesCache.has(key)) return rawSqlShapesCache.get(key);
  const SQL_TABLE_LIKE = sqlTableLike(prose);
  const shapes = [
    String.raw`(?<!\bfor\s+(?:no\s+key\s+)?)\bupdate\b[^;]*?\bset\b`,
    String.raw`(?<!\bfor\s+(?:no\s+key\s+)?)\bupdate${SQL_SEP}(?:only${SQL_SEP})?${SQL_TABLE_LIKE}`,
    String.raw`\binsert\s+into${SQL_SEP}(?:${SQL_TABLE_LIKE}|${SQL_TARGET}\s*(?:\(|\b(?:values|select|default|overriding|with)\b))`,
    String.raw`\bdelete\s+from${SQL_SEP}(?:only${SQL_SEP})?(?:${SQL_TABLE_LIKE}|${SQL_TARGET}(?:\s+as\s+[\w$"]+)?\s*(?:$|;|\)|\b(?:where|using|returning)\b))`,
    String.raw`\bcopy${SQL_SEP}(?:${SQL_TABLE_LIKE}(?:\s*\([^)]*\))?\s+from\b|${SQL_TARGET}(?:\s*\([^)]*\))?\s+from\s+(?:program\b|stdin\b|'|"|\$\{\}))`,
    String.raw`\bselect\b[^;]*?\binto${SQL_SEP}(?:(?:temp|temporary|unlogged|table)\s+)*(?:${SQL_TABLE_LIKE}|${SQL_TARGET}\s+from\b)`,
    String.raw`\btruncate\b`,
    String.raw`\bmerge\s+into\b`,
    String.raw`\bon\s+conflict\b[\s\S]*?\bdo\s+update\b`,
    String.raw`\bdrop\s+(?:table|schema|owned)\b`,
    String.raw`\balter\s+table\b`,
  ].map((src) => new RegExp(src, "i"));
  rawSqlShapesCache.set(key, shapes);
  return shapes;
}
/**
 * Postgres lexes a comment as whitespace: blank each one the way its lexer reads it, left to right. A block
 * comment NESTS (`/* /* *\/ *\/` is one comment, and the text after the first `*\/` is still inside it), and a
 * line comment ends at a line feed OR a carriage return. With `quotes`, a comment opener inside a quoted
 * string ('..', E'..' with backslash escapes, "..", $tag$..$tag$) is text, as it is to Postgres; without, every
 * opener counts. The scan reads both, because a text here is not always one whole statement (a substitution
 * or a `+` operand reads as `${}`), so neither read alone is always the one Postgres makes.
 */
// a dollar-quote delimiter: $$ or $tag$ (a tag starts like an identifier)
const DOLLAR_TAG = /^\$(?:[A-Za-z_\P{ASCII}][\w\P{ASCII}]*)?\$/u;
const blankSqlComments = (t, quotes = false) => {
  if (!t.includes("--") && !t.includes("/*")) return t;
  const identChar = (c) => c !== undefined && /[\w$\P{ASCII}]/u.test(c);
  let out = "";
  let i = 0;
  while (i < t.length) {
    const c = t[i];
    if (c === "-" && t[i + 1] === "-") {
      let j = i + 2;
      while (j < t.length && t[j] !== "\n" && t[j] !== "\r") j++;
      out += " ";
      i = j;
    } else if (c === "/" && t[i + 1] === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < t.length && depth > 0) {
        if (t[j] === "/" && t[j + 1] === "*") {
          depth++;
          j += 2;
        } else if (t[j] === "*" && t[j + 1] === "/") {
          depth--;
          j += 2;
        } else j++;
      }
      out += " ";
      i = j;
    } else if (quotes && (c === "'" || c === '"')) {
      const backslash = c === "'" && /[eE]/.test(t[i - 1] ?? "") && !identChar(t[i - 2]);
      let j = i + 1;
      while (j < t.length) {
        if (backslash && t[j] === "\\") j += 2;
        else if (t[j] === c && t[j + 1] === c) j += 2;
        else if (t[j] === c) break;
        else j++;
      }
      out += t.slice(i, j + 1);
      i = j + 1;
    } else if (quotes && c === "$" && !identChar(t[i - 1]) && DOLLAR_TAG.test(t.slice(i))) {
      const tag = DOLLAR_TAG.exec(t.slice(i))[0];
      const close = t.indexOf(tag, i + tag.length);
      const j = close < 0 ? t.length : close + tag.length;
      out += t.slice(i, j);
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
};
// every shape above contains one of these words; a text with none of them is not looked at further
const RAW_SQL_WORD = /\b(?:update|insert|delete|copy|select|truncate|merge|conflict|drop|alter)\b/i;
// as written and with every comment opener blanked (the reads earlier versions made), or with the comments
// outside quotes blanked
const isRawSqlWrite = (t, shapes) => {
  const anyShape = (x) => shapes.some((re) => re.test(x));
  const all = blankSqlComments(t);
  if (RAW_SQL_WORD.test(all) && (anyShape(t) || anyShape(all))) return true;
  const outsideQuotes = blankSqlComments(t, true);
  return outsideQuotes !== t && outsideQuotes !== all && RAW_SQL_WORD.test(outsideQuotes) && anyShape(outsideQuotes);
};
const rawSqlCache = new Map();
/** The raw SQL writes in a source text, read with a schema's prose-like table names (this schema's by default). */
function rawSqlWrites(text, prose = PROSE_LIKE_TABLES) {
  const cacheKey = `${prose.join("\n")}\0${text}`;
  if (rawSqlCache.has(cacheKey)) return rawSqlCache.get(cacheKey);
  const shapes = rawSqlShapes(prose);
  const sf = parse(text);
  const hits = new Map();
  const consider = (node, s) => {
    if (typeof s === "string" && isRawSqlWrite(s, shapes) && !hits.has(node.getStart(sf))) {
      hits.set(node.getStart(sf), { line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: s.replace(/\s+/g, " ").trim().slice(0, 80) });
    }
  };
  const part = (t) => t.text ?? t.rawText ?? "";
  const templateText = (e) => part(e.head) + e.templateSpans.map((sp) => `\${}${part(sp.literal)}`).join("");
  const isPlus = (e) => ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken;
  const flat = (e) => {
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (isPlus(e)) return flat(e.left) + flat(e.right);
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) return templateText(e);
    return "${}";
  };
  // A template with each substitution that is literal text written in place inlined as that text: a string
  // literal, a template (its own substitutions inlined the same way), a tagged template (sql`delete from`), a `+`
  // of them, or a call of one such argument (sql.raw("delete from"), sql.identifier("firms")). Any other
  // substitution reads as `${}`. So sql`${sql.raw('delete from')} firms f where true` reads as the write it renders.
  const inlined = (e) => {
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e) || ts.isTypeAssertionExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    if (ts.isTemplateExpression(e)) return part(e.head) + e.templateSpans.map((sp) => (inlined(sp.expression) ?? "${}") + part(sp.literal)).join("");
    if (ts.isTaggedTemplateExpression(e)) return inlined(e.template);
    if (ts.isCallExpression(e) && e.arguments.length === 1) return inlined(e.arguments[0]);
    if (isPlus(e)) {
      const [l, r] = [inlined(e.left), inlined(e.right)];
      return l === null && r === null ? null : (l ?? "${}") + (r ?? "${}");
    }
    return null;
  };
  const visit = (n) => {
    // cooked, and as written between the delimiters (so an escape such as upd\u0061te cannot hide a verb either way)
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      consider(n, n.text);
      consider(n, n.getText(sf).slice(1, -1));
    } else if (ts.isTemplateExpression(n)) {
      consider(n, templateText(n));
      consider(n, n.getText(sf).slice(1, -1));
      consider(n, inlined(n));
    } else if (isPlus(n) && !(n.parent && isPlus(n.parent))) consider(n, flat(n));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const out = [...hits.values()];
  rawSqlCache.set(cacheKey, out);
  return out;
}
const fmtRawSql = (file, h) => `${pathOf(file)}:${h.line}: raw SQL write ${JSON.stringify(h.text)}`;

/** The function declaration called `name`, or null. */
function functionNamed(text, name) {
  let found = null;
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n;
    if (!found) ts.forEachChild(n, visit);
  };
  visit(parse(text));
  return found;
}

/** The expression after `const NAME =` up to its `;`, brackets and literals matched, or "". */
function initializerOf(src, name) {
  const found = src.indexOf(`const ${name} =`);
  if (found < 0) return "";
  const start = src.indexOf("=", found) + 1;
  let depth = 0;
  let q = null;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === ";" && depth === 0) return src.slice(start, i).trim();
  }
  return "";
}

const safe = (fn) => {
  try {
    return !!fn();
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// The contract module, EVALUATED. Its text is a handful of zod declarations
// with one `import` and one `export type`; stripping those and the `export`
// keywords leaves JavaScript that runs against the real zod. Grepping for
// "WITHDRAWN" and "superRefine" would pass on a refine that never fires.
// ---------------------------------------------------------------------------
const zodRequire = createRequire(at(`${ZOD_SRC}/../package.json`));
let z = null;
try {
  z = zodRequire("zod").z;
} catch {
  z = null;
}
ok(z !== null, "precondition: zod resolves from lib/tis-api-zod, so the contract can be evaluated rather than grepped");

function evalContract(code) {
  if (!z || !code) return null;
  try {
    const js = code
      .replace(/^import .*$/gm, "")
      .replace(/^export type .*$/gm, "")
      .replace(/^export const /gm, "const ");
    // OFFERED_DISPOSITIONS is read through typeof, so a contract without it evaluates (its own
    // check then goes red by name) instead of every contract check going red on a ReferenceError.
    return new Function(
      "z",
      `${js}\nreturn { ProofreadType, ProofreadDisposition, ProofreadDispositionBody, OFFERED_DISPOSITIONS: typeof OFFERED_DISPOSITIONS === "undefined" ? undefined : OFFERED_DISPOSITIONS, ProofreadReadResponse: typeof ProofreadReadResponse === "undefined" ? undefined : ProofreadReadResponse };`,
    )(z);
  } catch {
    return null;
  }
}

// The contract is evaluated by stripping its `import`, its single-line
// `export type` and its `export` keywords. A future edit that adds a multi-line
// type export or other TypeScript-only syntax makes evaluation return null and
// every contract-* check go red together: this says why, in one line.
ok(
  evalContract(stripComments(sources.contract)) !== null,
  "precondition: the contract module evaluates (keep `export type` on one line and avoid TypeScript-only syntax in it, or teach evalContract the new form)",
);

const SIX_DISPOSITIONS = ["FIXED", "BUG_FILED", "DISCLOSED", "WITHDRAWN", "CONTESTED_PE", "ACCEPTED_RISK"];
const PE_ONLY_NAMES = ["ACCEPTED_RISK", "CONTESTED_PE"];
const PERMITTED_NAMES = SIX_DISPOSITIONS.filter((n) => !PE_ONLY_NAMES.includes(n));
// What the store and the runner may import, by NAME. The scans of each file's
// own text (no .update/.insert/.delete of a study table, no tisProjectsTable
// outside the loader) cannot see a study write reached through ANOTHER module:
// `import { setProjectTheme } from "./tis-projects"` compiles, passes every one
// of them, and rewrites a tis_projects row. These are the only doors.
const STORE_IMPORTS = {
  "drizzle-orm": ["and", "desc", "eq", "inArray", "lt", "sql"],
  "@workspace/db": ["db", "studyProofreadDispositionsTable", "studyProofreadFindingsTable", "studyProofreadRunsTable", "tisProjectsTable", "type StudyProofreadRun"],
  "./logger": ["logger"],
  "./proofread/lifecycle.ts": ["CLAIM_PREDICATE_SQL"],
  "./proofread/index.ts": ["type ProofreadFinding", "findingFingerprint"],
};
const RUNNER_IMPORTS = {
  "node:fs": ["existsSync", "readFileSync"],
  "node:path": ["default as path"],
  // type-only: the runner has no connection of its own
  "@workspace/db": ["type StudyProofreadRun"],
  "./logger": ["logger"],
  "./proofread/index.ts": ["ALL_CLAUSES", "engineStamp", "RULES_VERSION", "runClauses", "type StudyRecord"],
  "./proofread/lifecycle.ts": ["MAX_ATTEMPTS", "nextStatusAfterFailure"],
  "./proofread-store": ["carryForwardDispositions", "claimOneRun", "completeRun", "insertQueuedRun", "loadStudyForRun", "previousRunForProject", "runHoldsFindings"],
};
const THREE_LIMITERS = ["proofreadRunLimiter", "proofreadDispositionLimiter", "proofreadReadLimiter"];

// Banned phrases (product-visible copy). Hyphenated and capitalised variants
// count: a literal-substring check passes on "Second-Opinion".
const BANNED_COPY = /independent[\s-]*review|second[\s-]*opinion|peer[\s-]*review|qa\s*[/\\-]?\s*qc/i;

const GUARD_404_PROJECT = 'if (!(await projectExistsForFirm(firm.id, id))) { res.status(404).json({ error: "Project not found." }); return; }';
const GUARD_404_FINDING =
  'if (!(await findingInFirmRun(firm.id, projectId, runId, findingId))) { res.status(404).json({ error: "Finding not found." }); return; }';
// The write path's own refusal of what the read path never shows: after the
// chain is verified, a finding whose audience is admin (a DEFECT) is answered
// exactly like an unknown one.
const AUDIENCE_GUARD =
  'const finding = await findingAudienceForFirm(firm.id, findingId); if (finding === null || finding.audience === "admin") { res.status(404).json({ error: "Finding not found." }); return; }';
// Which decision fits which finding type is the contract's (OFFERED_DISPOSITIONS); the route
// refuses any other pair with a 422, after the tenant checks and the 404s and before the write.
const TYPE_GUARD =
  'if (!decisionApplies(finding.type, parsed.data.disposition)) { res.status(422).json({ error: "This decision does not apply to this finding." }); return; }';
// A decision is taken only on the run the panel shows: the project's newest run for this firm,
// and only once it has finished (rules_ready, or ready once a later phase writes it: the panel shows
// findings and offers decisions on both, and the carry reads its source from both). Anything else is a 409 the panel answers by
// refetching — after the 422 and before the write.
const STALE_FINISHED = '(newest.status !== "rules_ready" && newest.status !== "ready")';
const STALE_GUARD = `const newest = await latestRunStatusForProject(firm.id, projectId); if (newest === null || newest.id !== runId || ${STALE_FINISHED}) { res.status(409).json({ error: "This check has been run again. Refresh to see the latest." }); return; }`;
// POST disposition's three URL ids and the route parameter each is read from. Each is read raw as url<Name>,
// gated, and then lowercased ONCE into <name>: the only spelling used after the gate.
const DISP_IDS = [
  ["projectId", "id"],
  ["runId", "runId"],
  ["findingId", "findingId"],
];
const urlName = (n) => `url${n[0].toUpperCase()}${n.slice(1)}`;
const DISP_GATE = 'if (!UUID.test(urlProjectId) || !UUID.test(urlRunId) || !UUID.test(urlFindingId)) { res.status(404).json({ error: "Finding not found." }); return; }';
const DISP_LOWER = DISP_IDS.map(([n]) => `const ${n} = ${urlName(n)}.toLowerCase();`);
// The protocol's mapping, written out by hand: this is the claim, the contract's
// OFFERED_DISPOSITIONS is the thing under test (verify-proofread-copy.mjs pins the panel's
// OFFERED equal to the contract's). A BLOCKER is a wrong number, so disclosing it does not
// close it; CONTESTED waits for the sealing engineer and DEFECT is the software team's, so
// neither takes a firm member's decision; BUG_FILED, ACCEPTED_RISK and CONTESTED_PE are
// never offered to a firm member.
const OFFERED_BY_TYPE = {
  BLOCKER: ["FIXED", "WITHDRAWN"],
  DISCLOSE: ["DISCLOSED", "FIXED", "WITHDRAWN"],
  NOTE: ["DISCLOSED", "FIXED", "WITHDRAWN"],
  UNVERIFIED: ["DISCLOSED", "FIXED", "WITHDRAWN"],
  CONTESTED: [],
  DEFECT: [],
};
/**
 * The route's own decisionApplies, transpiled by TypeScript and evaluated with `map` standing in
 * for the OFFERED_DISPOSITIONS it imports — or null when the routes have no such function.
 */
function routeDecisionApplies(routesSrc, map) {
  const fn = functionNamed(routesSrc, "decisionApplies");
  if (!fn) return null;
  const js = ts.transpileModule(fn.getText(), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return new Function("OFFERED_DISPOSITIONS", `${js}\nreturn decisionApplies;`)(map);
}
// What GET answers, written out by hand: this is the claim, and both the route's two answers
// and the contract's ProofreadReadResponse are held to it. A finding whose audience is admin (a
// DEFECT) is never sent; `withheld` is how many there are, and that count is all that leaves.
const READ_KEYS = [
  "status",
  "runId",
  "revision",
  "protocolVersion",
  "rulesVersion",
  "engineStamp",
  "inputManifest",
  "coverage",
  "createdAt",
  "finishedAt",
  "withheld",
  "rulesChanged",
  "findings",
  "dispositions",
];
/** The no-run answer, key by key, each value as its source text reads (whitespace-folded). */
const NONE_ANSWER = { status: '"none"', withheld: "0", rulesChanged: "false", findings: "[]", coverage: "[]", dispositions: "[]" };
const WITHHELD_COUNT = 'const withheld = findings.filter((f) => f.audience === "admin").length;';
/** A run's answer as the contract must accept it: a finished run with one visible finding and two withheld. */
const READ_SAMPLE = {
  status: "rules_ready",
  runId: "0b1f6c2e-8f4d-4c1e-9a55-6f1d2f9a7c10",
  revision: 2,
  protocolVersion: "2026-10-07.1",
  rulesVersion: "rules-1",
  engineStamp: "stamp-1",
  inputManifest: { currentVc: true, agencies: false },
  coverage: [
    { clauseId: "screeningClampDisclosed", section: 4, status: "ran", note: "37 of 40 reported delay fields judged" },
    { clauseId: "criteriaNamed", section: 5, status: "not-run", reason: "no agencies on the record" },
  ],
  createdAt: "2026-10-07T12:00:00.000Z",
  finishedAt: null,
  withheld: 2,
  rulesChanged: true,
  findings: [
    {
      id: "5d1c3f5e-0a52-4a6a-8d0c-3b7e2b0e9f11",
      clauseId: "screeningClampDisclosed",
      section: 4,
      type: "DISCLOSE",
      title: "t",
      detail: "d",
      sourceLabel: "s",
      readPaths: [{ path: "result.affectedIntersections[0].delay", value: 300 }],
      remedy: "r",
      fingerprint: "fp",
    },
  ],
  dispositions: [{ findingId: "5d1c3f5e-0a52-4a6a-8d0c-3b7e2b0e9f11", disposition: "DISCLOSED", note: null, sourceLabel: null, createdAt: "2026-10-07T12:05:00.000Z" }],
};
/**
 * The object literals GET hands to `res.json(...)`, read with the parser: each answer's keys, with
 * its value's source text (whitespace-folded), and how many members are not a plain `key: value`
 * or shorthand (a spread, a method, a computed key) — those carry keys no text names.
 */
function readAnswers(getText) {
  if (!getText) return [];
  const sf = parse(getText);
  const out = [];
  const visit = (n) => {
    if (ts.isCallExpression(n) && n.expression.getText(sf) === "res.json" && n.arguments.length === 1 && ts.isObjectLiteralExpression(n.arguments[0])) {
      const props = {};
      let other = 0;
      for (const p of n.arguments[0].properties) {
        if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) props[p.name.text] = sq(p.initializer.getText(sf));
        else if (ts.isShorthandPropertyAssignment(p)) props[p.name.text] = p.name.text;
        else other++;
      }
      out.push({ props, other });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}
const answersOf = (d) => readAnswers(getSeg(d));
const noneAnswers = (d) => answersOf(d).filter((a) => a.props.status === '"none"');
const runAnswers = (d) => answersOf(d).filter((a) => a.props.status !== '"none"');
const entriesSorted = (o) => JSON.stringify(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));

// The read path, value by value. GET answers the run row it read and the findings it read,
// unchanged: these name what it reads them through.
/** The run answer's values that come from the run row, each as its source text reads: the column itself, nothing derived from a finding. */
const RUN_ANSWER = {
  status: "run.status",
  runId: "run.id",
  revision: "run.revision",
  protocolVersion: "run.protocolVersion",
  rulesVersion: "run.rulesVersion",
  engineStamp: "run.engineStamp",
  inputManifest: "run.inputManifest",
  coverage: "run.coverage",
  createdAt: "run.createdAt.toISOString()",
  finishedAt: "run.finishedAt?.toISOString() ?? null",
};
/** The run row's columns the read path answers with: `run` is read through these and nothing else. */
const RUN_COLUMNS = new Set(["status", "id", "revision", "protocolVersion", "rulesVersion", "engineStamp", "inputManifest", "coverage", "createdAt", "finishedAt"]);
/** Member reads of a list that never change it. `forEach` is not one: its only use is a side effect. */
const LIST_READS = new Set(["length", "map", "filter", "some", "every", "find", "slice", "includes", "indexOf", "flatMap", "reduce", "at", "join", "concat"]);
/** latestRunForProject's read of the run's findings: every finding of the run, nothing else in the WHERE. */
const FINDINGS_READ = "const findings = await db.select().from(studyProofreadFindingsTable).where(eq(studyProofreadFindingsTable.runId, run.id));";
const LATEST_RETURN = "return { run, findings, dispositions, previous };";
/** latestRunForProject's read of the revision this run's carry read from: the runner's own call, with the runner's arguments. */
const PREVIOUS_READ = "const previous = await previousRunForProject(run.projectId, run.revision);";
/** GET's answer to "did the rules change since the revision the decisions would have carried from". */
const RULES_CHANGED = "const rulesChanged = previous !== null && previous.rulesVersion !== run.rulesVersion;";

/**
 * How code under `root` uses the binding `name`: `decls` are the identifiers that declare it (a
 * `const`, a destructured element or a parameter of that name anywhere inside — an inner one
 * shadows it); `other` is every use that is NOT a read through one of `members` (`name.member`,
 * the call of that member included), a copy (`[...name]`), the list a `for … of` walks, or the
 * binding handed back whole as a shorthand in a `return { … }`. A call that receives the binding, an element access, a
 * mutating method (`splice`, `push`, `sort`), a re-binding: each lands in `other`. Writes THROUGH
 * a member read (`name.length = 0`) are propertyWrites' to see.
 */
function bindingUses(root, name, members) {
  const sf = root.getSourceFile();
  const decls = [];
  const other = [];
  const visit = (n) => {
    if (ts.isIdentifier(n) && n.text === name) {
      const p = n.parent;
      const isDecl = (ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isBindingElement(p)) && p.name === n;
      const isKey = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || (ts.isBindingElement(p) && p.propertyName === n);
      const isMemberRead = ts.isPropertyAccessExpression(p) && p.expression === n && members.has(p.name.text);
      const isCopy = (ts.isSpreadElement(p) && ts.isArrayLiteralExpression(p.parent)) || (ts.isForOfStatement(p) && p.expression === n);
      const isHandedBack = ts.isShorthandPropertyAssignment(p) && ts.isObjectLiteralExpression(p.parent) && ts.isReturnStatement(p.parent.parent);
      if (isDecl) decls.push(n);
      else if (!(isKey || isMemberRead || isCopy || isHandedBack)) other.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return { decls, other: other.map((n) => n.parent.getText(sf).replace(/\s+/g, " ").slice(0, 90)) };
}
/** Whether a declaring identifier is a plain element of `const { … } = <source>;` (no rest element, no alias). */
const destructuredFrom = (decl, source) => {
  const el = decl?.parent;
  const pattern = el?.parent;
  const vd = pattern?.parent;
  return (
    !!el &&
    ts.isBindingElement(el) &&
    !el.dotDotDotToken &&
    !el.propertyName &&
    ts.isObjectBindingPattern(pattern) &&
    ts.isVariableDeclaration(vd) &&
    vd.initializer !== undefined &&
    ts.isIdentifier(vd.initializer) &&
    vd.initializer.text === source
  );
};
/**
 * Every write code under `root` makes through a property or an element: an assignment to one
 * (destructuring targets included), a `delete`, a ++/-- of one, and a call of Object.assign,
 * Object.defineProperty / defineProperties / setPrototypeOf or any Reflect.* — as text. A write
 * reached through a function that receives the value (`relabel(findings)`) is not followed here;
 * bindingUses refuses handing the binding to a call at all.
 */
function propertyWrites(root) {
  const sf = root.getSourceFile();
  const out = [];
  const isAccess = (e) => ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e);
  const holdsAccess = (e) => {
    let found = false;
    const v = (n) => {
      if (isAccess(n)) found = true;
      else ts.forEachChild(n, v);
    };
    v(e);
    return found;
  };
  const visit = (n) => {
    const assigns = ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
    if (assigns && (isAccess(n.left) || ((ts.isObjectLiteralExpression(n.left) || ts.isArrayLiteralExpression(n.left)) && holdsAccess(n.left)))) out.push(n);
    else if (ts.isDeleteExpression(n)) out.push(n);
    else if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) && isAccess(n.operand)) out.push(n);
    else if (ts.isCallExpression(n) && /^(?:Object\.(?:assign|defineProperty|defineProperties|setPrototypeOf)|Reflect\.\w+)$/.test(n.expression.getText(sf).replace(/\s+/g, ""))) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(root);
  return out.map((n) => n.getText(sf).replace(/\s+/g, " ").slice(0, 90));
}
/** GET's handler as parsed text (the segment from `router.get(` to the next registration). */
const getTree = (d) => (getSeg(d) ? parse(getSeg(d)) : null);
const FIRM_LOOKUP = "getOrCreateFirmForUser(user.id, { email: user.email, firstName: user.firstName, lastName: user.lastName })";

/** What a check sees: every source comment-stripped, plus the evaluated contract. */
const derive = (s) => {
  const contract = stripComments(s.contract);
  return {
    src: s,
    routes: stripComments(s.routes),
    routesIndex: stripComments(s.routesIndex),
    security: stripComments(s.security),
    contract,
    zodIndex: stripComments(s.zodIndex),
    store: stripComments(s.store),
    runner: stripComments(s.runner),
    tisProjects: stripComments(s.tisProjects),
    typesSrc: stripComments(s.typesSrc),
    clauseDir: Object.fromEntries(Object.entries(s.clauseDir).map(([k, v]) => [k, stripComments(v)])),
    schema: Object.fromEntries(Object.entries(s.schema).map(([k, v]) => [k, stripComments(v)])),
    // the schema's table names, read from the raw text (its comments are the parser's to skip)
    schemaRead: schemaReadOf(s.schema),
    otherNames: s.otherNames,
    mod: evalContract(contract),
  };
};

const limiterBlocks = (d) => THREE_LIMITERS.map((n) => limiterBlock(d.security, n));
const allLimiters = (d, pred) => {
  const blocks = limiterBlocks(d);
  return blocks.every((b) => b.length > 0) && blocks.every(pred);
};
const limitOf = (block) => Number(/\blimit:\s*(\d+)/.exec(block)?.[1] ?? NaN);
const windowOf = (block) => {
  const expr = /windowMs:\s*([\d\s*]+),/.exec(block)?.[1];
  return expr ? Function(`return (${expr});`)() : NaN;
};
const storePrefixOf = (block) => /makeRateLimitStore\("([^"]+)"\)/.exec(block)?.[1] ?? "";

const parseBody = (d, v) => d.mod.ProofreadDispositionBody.safeParse(v);

// The spellings of "a way into another module" that a regex parser let through.
// [description, source text, true when it must sit on the SAME line as the logger import]
const EVASIONS = [
  ["a block comment ahead of the import, on the same line", '/* import */ import { setProjectTheme } from "./tis-projects";'],
  ["a single-quoted specifier", "import { setProjectTheme } from './tis-projects';"],
  ["a second import on the same line as another statement", 'import { setProjectTheme } from "./tis-projects";', true],
  ["an import indented with spaces", '    import { setProjectTheme } from "./tis-projects";'],
  ["an import indented with a tab", '\timport { setProjectTheme } from "./tis-projects";'],
  ["no whitespace around the braces", 'import{setProjectTheme}from"./tis-projects";'],
  ["no space before from", 'import { setProjectTheme }from "./tis-projects";'],
  ["a namespace import with no whitespace", 'import*as tp from "./tis-projects";'],
  ["a single-quoted re-export", "export { setProjectTheme } from './tis-projects';"],
  ["a single-quoted side-effect import", "import './tis-projects';"],
  ["an ES2022 string-literal import name", 'import { "setProjectTheme" as sp } from "./tis-projects";'],
  ["an aliased import", 'import { setProjectTheme as logger2 } from "./tis-projects";'],
  ["a default import", 'import projectsModule from "./tis-projects";'],
  ["a namespace import", 'import * as projects from "./tis-projects";'],
  ["an import = require", 'import projects = require("./tis-projects");'],
  ["import attributes", 'import { setProjectTheme } from "./tis-projects" with { type: "json" };'],
  ["a multi-line import", 'import {\n  setProjectTheme,\n} from "./tis-projects";'],
  ["a multi-line import with CRLF line endings", 'import {\r\n  setProjectTheme,\r\n} from "./tis-projects";\r'],
  ["an export * from an allowed module", 'export * from "./logger";'],
  ["a forbidden name added to an allowed module's import", 'import { setProjectTheme } from "./logger";'],
];

// The ways of writing a study row that a regex over `.update(` / `.insert(` / `.delete(` cannot see.
// [description, statement(s) to insert, true when it is still a `<recv>.<verb>(<identifier>)` call]
const WRITE_FORMS = [
  ["an element access with a string literal", 'await db["update"](tisProjectsTable).set({ version: 2 });', true],
  ["an element access with a template literal", "await db[`update`](tisProjectsTable).set({ version: 2 });", true],
  ["a destructured binding from db", "const { update } = db; await update(tisProjectsTable).set({ version: 2 });", false],
  ["a renamed destructured binding", "const { update: u } = db; await u(tisProjectsTable).set({ version: 2 });", false],
  ["a destructured binding with a string-literal key", 'const { "update": u } = db; await u(tisProjectsTable).set({ version: 2 });', false],
  ["a destructured binding with a computed key", 'const { ["update"]: u } = db; await u(tisProjectsTable).set({ version: 2 });', false],
  ["a verb taken as a bound function", "const u = db.update.bind(db); await u(tisProjectsTable).set({ version: 2 });", false],
  ["a verb reached through .call", "await db.update.call(db, tisProjectsTable);", false],
  ["an assignment destructuring", "let u: any; ({ update: u } = db); await u(tisProjectsTable);", false],
  ["a computed element access on db", 'await db["upd" + "ate"](tisProjectsTable);', false],
  ["a parenthesised, cast table argument", "await db.update((tisProjectsTable as any)).set({ version: 2 });", true],
  ["a table chosen by a conditional", "await db.update(args.runId ? tisProjectsTable : studyProofreadRunsTable).set({});", false],
  ["a regex literal ending in // on the same line (the old comment stripper deleted the rest of the line)", "const rx = /\\//; await db.update(tisProjectsTable).set({ version: 2 });", true],
  ["a plain write split across lines and comments", "await db\n    /* not a write */\n    .update(tisProjectsTable)\n    .set({ version: 2 });", true],
];

// Ways of reaching a write verb WITHOUT spelling it, on a handle derived from db.
// [description, statements, true when it also names tisProjectsTable]
const REFLECTION_FORMS = [
  ["Reflect.get on db", 'await Reflect.get(db, "update")(tisProjectsTable);', true],
  ["a computed destructuring key taken from a variable", 'const k = "update"; const { [k]: u } = db; await u(tisProjectsTable);', true],
  ["a computed access through an alias of db", 'const d2 = db; await d2["upd" + "ate"](tisProjectsTable);', true],
  ["a spread of db and a computed access on the copy", 'const copy = { ...db }; const k2 = "update"; await copy[k2](tisProjectsTable);', true],
  ["an alias of an alias of db", 'const a1 = db; const a2 = a1; await a2["upd" + "ate"](tisProjectsTable);', true],
  ["a reassigned alias and a template-literal key built at run time", 'let h: any; h = db; await h[`up${"date"}`](tisProjectsTable);', true],
  ["Object.entries(db)", "const fns = Object.entries(db); void fns;", false],
  ["Object.getOwnPropertyDescriptors(db)", "void Object.getOwnPropertyDescriptors(db);", false],
  ["for-in over db", "for (const k3 in db) { void k3; }", false],
  ["new Proxy(db, ...)", "const px = new Proxy(db, {}); void px;", false],
  ["a query builder derived from db, with the upsert reached by a computed name", 'const q = db.insert(studyProofreadDispositionsTable).values({} as any); const kk = "onConflictDo" + "Update"; await q[kk]({});', false],
  // handles the round-3 taint did not follow
  ["a computed access on a transaction callback's parameter, whatever it is called", 'await db.transaction(async (t) => { await (t as any)["upd" + "ate"](tisProjectsTable); });', true],
  ["a spread of a transaction callback's parameter", "await db.transaction(async (t) => { const c = { ...t }; void c; });", false],
  ["Object.entries of a transaction callback's parameter", "await db.transaction(async (t) => { void Object.entries(t); });", false],
  ["for-in over a transaction callback's parameter", "await db.transaction(async (t) => { for (const k in t) void k; });", false],
  ["the loop variable of a for-of over [db]", 'for (const h of [db]) { await (h as any)["upd" + "ate"](tisProjectsTable); }', true],
  ["a parameter whose default is db", 'const f1 = (h: any = db) => h["upd" + "ate"](tisProjectsTable); await f1();', true],
  ["a class property initialised from db, read back as this.h", 'class H { h: any = db; m() { return this.h["upd" + "ate"](tisProjectsTable); } } await new H().m();', true],
  ["the parameter of a callback that .map hands an element of [db]", 'await Promise.all([db].map((d) => (d as any)["upd" + "ate"](tisProjectsTable)));', true],
  ["a property named db of another object", 'await (globalThis as any).db["upd" + "ate"](tisProjectsTable);', true],
  ["an object handed db in a property assignment", 'const box: any = {}; box.h = db; await box.h["upd" + "ate"](tisProjectsTable);', true],
  ["an assignment destructuring with a computed key from db", 'let u2: any; const k6 = "update"; ({ [k6]: u2 } = db); await u2(tisProjectsTable);', true],
  // awaiting the handle itself yields the handle (round 4 dropped every awaited value)
  ["an awaited db held in a const", 'const ah = await db; await (ah as any)["upd" + "ate"](tisProjectsTable);', true],
  ["an awaited db indexed in place", 'await ((await db) as any)["upd" + "ate"](tisProjectsTable);', true],
  ["an awaited property of db", 'const ac = await (db as any).$client; await ac["upd" + "ate"](tisProjectsTable);', true],
  ["an awaited db chosen by a conditional", 'const at = Date.now() > 0 ? await db : null; await (at as any)["upd" + "ate"](tisProjectsTable);', true],
  ["an awaited db inside an object literal, destructured", 'const { ad } = { ad: await db }; await (ad as any)["upd" + "ate"](tisProjectsTable);', true],
  // a var declared twice is one variable
  ["a var re-declared from a number to db", 'var vr: any = 1; var vr: any = db; await vr["upd" + "ate"](tisProjectsTable);', true],
  ["a parameter re-declared as a var holding db", 'async function f4(vp: any) { var vp: any = db; await vp["upd" + "ate"](tisProjectsTable); } await f4(1);', true],
  // a destructuring key called db reads a property named db
  ["a destructuring key called db", 'const { db: gd } = globalThis as any; await gd["upd" + "ate"](tisProjectsTable);', true],
  ["an assignment destructuring with the key db", 'let ga: any; ({ db: ga } = globalThis as any); await ga["upd" + "ate"](tisProjectsTable);', true],
  // destructuring defaults
  ["a declaration destructuring default", 'const { dh = db }: any = {}; await (dh as any)["upd" + "ate"](tisProjectsTable);', true],
  ["an array destructuring default", 'const [dh2 = db]: any[] = []; await (dh2 as any)["upd" + "ate"](tisProjectsTable);', true],
  ["a renamed destructuring default", 'const { a: dh3 = db }: any = {}; await (dh3 as any)["upd" + "ate"](tisProjectsTable);', true],
  ["a for-of destructuring default", 'for (const { dh4 = db } of [{} as any]) { await (dh4 as any)["upd" + "ate"](tisProjectsTable); }', true],
  ["a parameter destructuring default", 'const f9 = async ({ dh5 = db }: any = {}) => { await dh5["upd" + "ate"](tisProjectsTable); }; await f9();', true],
  ["an assignment destructuring default", 'let dh6: any; ({ dh6 = db } = {} as any); await dh6["upd" + "ate"](tisProjectsTable);', true],
  // a class property read or written through the cheap `this` spellings, a #private field, or a static
  ["a class property read through (this as any)", 'class C13 { h1: any = db; async m() { await (this as any).h1["upd" + "ate"](tisProjectsTable); } } await new C13().m();', true],
  ["a class property read through this!", 'class C16 { h1: any = db; async m() { await this!.h1["upd" + "ate"](tisProjectsTable); } } await new C16().m();', true],
  ["a class property read through this[\"h\"]", 'class C11 { h1: any = db; async m() { await this["h1"]["upd" + "ate"](tisProjectsTable); } } await new C11().m();', true],
  ["a #private class field", 'class C5 { #h1: any = db; async m() { await this.#h1["upd" + "ate"](tisProjectsTable); } } await new C5().m();', true],
  ["a static class field read as C.h", 'class C4 { static h1: any = db; static async m() { await C4.h1["upd" + "ate"](tisProjectsTable); } } await C4.m();', true],
  ["a class property assigned through (this as any)", 'class C17 { h1: any; constructor() { (this as any).h1 = db; } async m() { await this.h1["upd" + "ate"](tisProjectsTable); } } await new C17().m();', true],
  ["a static field assigned in a static block", 'class C20 { static h1: any; static { C20.h1 = db; } static async m() { await C20.h1["upd" + "ate"](tisProjectsTable); } } await C20.m();', true],
  ["the handle a transaction callback returns, awaited", 'const tr = await db.transaction(async (x: any) => x); await (tr as any)["upd" + "ate"](tisProjectsTable);', true],
  // a builder handed back inside a container is still a builder the caller can call
  ["a builder a transaction callback hands back inside an object literal", 'const tq = await db.transaction(async (x: any) => ({ q: x.select() })); await (tq as any).q["upd" + "ate"](tisProjectsTable);', true],
  ["a builder a transaction callback hands back inside an array literal", 'const [tb] = await db.transaction(async (x: any) => [x.select()]); await (tb as any)["upd" + "ate"](tisProjectsTable);', true],
  ["the handle a transaction callback's block returns through a conditional", 'const tc = await db.transaction(async (x: any) => { return Date.now() > 0 ? x : null; }); await (tc as any)["upd" + "ate"](tisProjectsTable);', true],
];


// The parser itself, against the strings it must read the same way however they
// are spelled, and the ones it must ignore.
{
  const P = (text) => importsOf(text);
  const eq = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  const target = { "./tis-projects": ["setProjectTheme"] };
  const spelled = [
    '/* import */ import { setProjectTheme } from "./tis-projects";',
    "import { setProjectTheme } from './tis-projects';",
    'import { "setProjectTheme" as sp } from "./tis-projects";',
    'import{setProjectTheme}from"./tis-projects";',
    '    import { setProjectTheme } from "./tis-projects";',
    '\timport { setProjectTheme } from "./tis-projects";',
    'import {\r\n  setProjectTheme as x,\r\n} from "./tis-projects";\r\n',
    'import { type A } from "./a";\nconst a = 1; import { setProjectTheme } from "./tis-projects";',
  ];
  ok(
    spelled.every((t) => P(t)["./tis-projects"]?.some((n) => n === "setProjectTheme" || n.startsWith("setProjectTheme as "))),
    "the import parser finds setProjectTheme in all of: after a block comment, single-quoted, as a string-literal name, with no whitespace, indented with spaces and with a tab, CRLF and aliased, and after another statement on the same line",
  );
  ok(eq(P('// import { x } from "y";\n/* import { z } from "w"; */\nconst s = "import { a } from \'b\'";'), {}), "the import parser ignores a commented-out import and the text of an import inside a string");
  ok(P('const rx = /\\//; await import("./tis-projects");')["./tis-projects"]?.[0] === "<dynamic import>", "the import parser sees an import() that follows a regex literal ending in // on the same line (the old comment stripper deleted it)");
  ok(
    eq(P('import { a as b } from "m";'), { m: ["a as b"] }) &&
      eq(P('import { a as b, b as a } from "m";'), { m: ["a as b", "b as a"] }) &&
      eq(P('import { "a" as b } from "m";'), { m: ["a as b"] }) &&
      eq(P('import { a as a } from "m";'), { m: ["a"] }) &&
      eq(P('import { type a as b } from "m";'), { m: ["type a as b"] }) &&
      eq(P('import type { a as b } from "m";'), { m: ["type a as b"] }) &&
      eq(P('import d from "m";'), { m: ["default as d"] }) &&
      eq(P('import { default as d } from "m";'), { m: ["default as d"] }),
    "the import parser keeps `imported as local` whenever an alias changes the name (so an alias swap cannot match a plain-name whitelist entry), reduces a no-op alias to the plain name, and writes a default import as `default as <local>`",
  );
  {
    const loaders = [
      'process.getBuiltinModule("module").createRequire(import.meta.url)("./tis-projects");',
      'const { createRequire: cr } = process.getBuiltinModule("module");',
      'void (globalThis as any)["createRequire"];',
      'void (process as any)["getBuiltinModule"]("fs");',
      "void (async () => 0).constructor(\"return import('./tis-projects')\")();",
      'void new ((() => 0)["constructor"] as any)("return this");',
      'module["require"]("./tis-projects");',
      'globalThis["require"]("./tis-projects");',
      // any read of a constructor, however it is then called
      "const c = (() => 0).constructor; void c;",
      "void ({}).constructor();",
      'const Cq = (async () => 0).constructor; void Cq("return import(\'./tis-projects\')")();',
      'void (() => 0).constructor.call(null, "return 1")();',
      'void (() => 0).constructor.apply(null, ["return 1"])();',
      'void (() => 0).constructor.bind(null)("return 1")();',
      'const { constructor: Cd } = () => 0; void Cd("return 1")();',
      'const { "constructor": Cs } = () => 0; void Cs;',
      // a cast or a string key on the way to .name does not make a call of it a read
      'void ((() => 0).constructor as any)("return 1")();',
      'void ((() => 0).constructor as any).name("return 1");',
      'void (() => 0).constructor["name"]("return 1");',
      "const c2 = ((() => 0).constructor as any); void c2;",
    ];
    const quiet = [
      "const n = (() => 0).constructor.name; void n;",
      'void (args as any)["constructor"].name;',
      "const o = { createRequireLater: 1 }; void o;",
      // a read of the class name through a cast or a string key is still only a read of the name
      "void ((args as any).constructor as any).name;",
      'void (args as any).constructor["name"];',
      "void (args as any)?.constructor?.name;",
      "void (((args as any).constructor)!).name;",
    ];
    const missed = loaders.filter((t) => !Object.keys(P(t)).some((m) => m.startsWith("<")));
    const flagged = quiet.filter((t) => Object.keys(P(t)).length > 0);
    ok(
      missed.length === 0 && flagged.length === 0,
      "the import parser sees the module loaders no import statement shows: createRequire and getBuiltinModule however reached (identifier, member, string key), any read of .constructor (aliased, destructured, called, .call / .apply / .bind — each a way to build a function from a string), and require through a string key; a read of .constructor.name (also spelled [\"name\"], through parentheses or a cast) is not one, and a call of that name is",
      [...missed.map((t) => `missed: ${t}`), ...flagged.map((t) => `flagged: ${t}`)],
    );
  }
  ok(eq(P('import { a } from "m";'), { m: ["a"] }) && eq(P('import type { a } from "m";'), { m: ["type a"] }) && eq(P('import { type a, b } from "m";'), { m: ["type a", "b"] }), "the import parser reads the names that were imported, with `type ` on type-only ones");
  void target;
}

// The raw-SQL scan, against what it must refuse in any letter case and spelling, and
// the reads it must leave alone (the store's own claim says FOR UPDATE SKIP LOCKED).
{
  const n = (src) => rawSqlWrites(src).length;
  const refused = [
    'const s = "update tis_projects set x = 1";',
    'const s = "UPDATE study_proofread_dispositions SET note = null";',
    "const s = `Update \"tis_projects\" set x = 1`;",
    'const s = "insert into t values (1)";',
    'const s = "delete from study_proofread_dispositions";',
    'const s = "truncate study_proofread_dispositions";',
    'const s = "TRUNCATE TABLE t";',
    "const s = \"insert into t values (1) on conflict (id) do update set x = 2\";",
    'const s = "merge into t using s on true";',
    'const s = "drop table t";',
    'const s = "alter table t add column c int";',
    "const s = sql`update ${tisProjectsTable} set version = 2`;",
    'const s = "update " + "tis_" + "projects set version = 2";',
    'const s = "upd\\u0061te tis_projects set v = 1";',
    // a comment is whitespace to Postgres
    'const s = "update/**/study_proofread_dispositions set note = null";',
    'const s = "update /* c */ study_proofread_dispositions set note = null";',
    'const s = "delete /**/ from study_proofread_dispositions";',
    'const s = "delete/**/from study_proofread_dispositions";',
    'const s = "delete -- c\\n from study_proofread_dispositions";',
    'const s = "insert /**/ into tis_" + "projects (id) values (1)";',
    'const s = "update/**/tis_" + "projects set version = 1";',
    'const s = "truncate/**/table study_proofread_dispositions";',
    'const s = "on conflict (id) do /**/ update set note = null";',
    // the other verbs that erase or replace the log
    'const s = "drop schema public cascade";',
    'const s = "drop owned by current_user";',
    'const s = "copy study_proofread_dispositions from program \'true\'";',
    'const s = "select * into study_proofread_dispositions_copy from study_proofread_dispositions";',
    'const s = "delete from study_proofread_dispositions d where d.id = 1";',
    'const s = "delete from runs as r where r.id = 1";',
    'const s = "insert into runs values (1)";',
    'const s = "with d as (update study_proofread_dispositions set note = null returning 1) select 1";',
    'const s = "select 1 for update; update study_proofread_dispositions set note = null";',
    // a table the schema declares with no underscore reads like a table (firms, users, ...)
    'const s = "delete from firms f where f.id = 1";',
    'const s = "DELETE FROM Users U";',
    'const s = "delete from firms * where id = 1";',
    'const s = "insert into firms as f (id) values (1)";',
    'const s = "insert into users table x";',
    "const s = sql`delete from firms ${cond}`;",
    'const s = "copy firms from E\'/x\'";',
    'const s = "select 1 as id into users";',
    // an UPDATE whose SET is not in the same literal: a table-like target is enough
    "const s = sql`update firms ${set}`;",
    "const s = sql`update study_proofread_dispositions ${set} where id = ${id}`;",
    "const s = sql`update ${tbl} ${set}`;",
    "const s = sql`update only ${tbl} ${set}`;",
    'const s = "update " + "firms" + " " + w;',
    'const s = "update " + tbl + " " + w;',
    // no whitespace between the verb and a quoted or substituted target: Postgres reads `from"firms"`, and
    // drizzle renders a table substitution as a quoted name (`delete from${t}` reaches it as `delete from"t"`)
    "const s = sql`delete from${tbl} where true`;",
    "const s = sql`DELETE FROM${tbl} WHERE true`;",
    "const s = sql`update${tbl} ${patch}`;",
    "const s = sql`update only${tbl} ${patch}`;",
    "const s = sql`insert into${tbl} (id) values (1)`;",
    "const s = sql`delete from only${tbl} where true`;",
    "const s = 'delete from\"firms\" where true';",
    "const s = 'delete from\"firms\"where id = 1';",
    "const s = 'insert into\"firms\"(id) values (1)';",
    "const s = 'delete from only\"users\" f where true';",
    "const s = 'copy\"firms\" from stdin';",
    "const s = 'select 1 as id into\"users\"';",
    // a Unicode-escaped quoted name (U&"..") and a schema qualifier with whitespace around its dot are names too
    "const s = 'delete from U&\"study_proofread_dispositions\" d where true';",
    "const s = 'delete from U&\"\\\\0066irms\" f where true';",
    "const s = 'insert into U&\"firms\" table x';",
    "const s = 'insert into u&\"users\" as u (id) values (1)';",
    "const s = sql`update U&\"firms\" ${patch}`;",
    "const s = 'copy U&\"firms\" from stdin';",
    "const s = 'select 1 as id into U&\"users\"';",
    "const s = 'delete from public . firms f where true';",
    "const s = 'delete from public .users u where true';",
    "const s = 'delete from public. users u where true';",
    "const s = 'delete from public . \"study_proofread_dispositions\" f where true';",
    "const s = 'insert into public . study_proofread_dispositions as d (id) values (1)';",
    "const s = sql`delete from public . ${tbl} where true`;",
    // comments lexed as Postgres lexes them: a block comment nests, and a line comment ends at CR as well as LF
    'const s = "delete from /* /* */ */ study_proofread_dispositions d where true";',
    'const s = "delete /* /* */ */ from firms f where true";',
    'const s = "insert /* /* */ */ into firms values (100)";',
    'const s = "delete from --x\\rstudy_proofread_dispositions d where true";',
    'const s = "delete --x\\rfrom firms f where true";',
    "const s = sql`update /* /* */ */ ${tbl} ${patch}`;",
    "const s = sql`merge /* /* */ */ into ${tbl} t using x on true when matched then delete`;",
    // and a comment opener inside a quoted string or identifier is not a comment
    "const s = \"select '--'; delete /**/ from firms f where true\";",
    "const s = \"select '/*'; delete /**/ from firms f where true\";",
    "const s = 'select \"--\"; delete /**/ from firms f where true';",
    "const s = 'select $q$ -- $q$; delete /**/ from firms f where true';",
    "const s = \"select E'\\\\' --'; delete /**/ from firms f where true\";",
    // a verb (or a word of it) in its own literal inside a substitution: the substitution is inlined as its text
    "const s = sql`${sql.raw('delete from')} study_proofread_dispositions d where true`;",
    "const s = sql`${sql.raw(\"delete from\")} firms f where true`;",
    "const s = sql`${sql`delete from`} firms f where true`;",
    "const s = sql`${sql.raw('insert into')} firms as f values (1)`;",
    "const s = sql`${sql.raw('delete from')} ${tbl} where true`;",
    "const s = sql`${sql.raw('update')} ${tbl} ${patch}`;",
    "const s = sql`delete ${sql.raw('from')} firms f where true`;",
    "const s = `${\"delete from\"} users u where true`;",
    "const s = sql`${sql`${sql.raw('delete')} from`} firms f where true`;",
    "const s = sql`upd${\"ate\"} firms ${patch}`;",
  ];
  const left = [
    "const s = sql`SELECT id FROM study_proofread_runs WHERE x ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`;",
    'const s = "select 1 for no key update";',
    "const s = sql`(SELECT coalesce(max(revision), 0) + 1 FROM study_proofread_runs WHERE project_id = ${id})`;",
    'const s = "x.update(y)";',
    'const s = "update";',
    'const s = "updated";',
    'const s = "proofread.dispositions_carried";',
    'const o = { "update": 1, "delete": 2 };',
    // prose that names a verb but is not SQL
    'const s = "update failed";',
    "const s = `update failed for run ${id}`;",
    'const s = "could not insert into the queue";',
    'const s = "refusing to delete from the log";',
    'const s = "could not update the claim";',
    'const s = "no update available";',
    'const s = "could not update run";',
    'const s = "deleted 0 rows from the queue";',
    // a sentence that ends after the verb's object is not a schema-qualified name: a dot needs a name after it
    'const s = "Failed to update project.";',
    'const s = "Failed to update run.";',
    'const s = "Could not update disposition.";',
    'const s = "Failed to update project. Please retry.";',
    'const s = "Could not insert into queue.";',
    // an inlined substitution that makes a read is still a read
    "const s = sql`select ${sql.raw('id')} from firms where id = ${id}`;",
    "const s = sql`select id from study_proofread_runs where id = ${id} for update ${skip}`;",
  ];
  // prose in a SQL shape is refused, and the comment at rawSqlWrites says to reword it
  const reword = [
    'const s = "could not update run: status was not set";',
    'const s = "failed to insert into findings (run 5)";',
    'const s = "refusing to delete from queue";',
    "const s = `could not update ${kind}`;",
    'const s = `${n} update${n === 1 ? "" : "s"} applied`;',
    'const s = "failed to update run.status";',
    'const s = "please update node.js";',
    "const s = 'could not update \"status\" on the run';",
    'const s = "cannot update run_id 5";',
    'const s = "could not update users";',
    "const s = sql`select 1 -- update the claim, then set attempts\n`;",
  ];
  const missed = [...refused, ...reword].filter((t) => n(t) !== 1);
  const flagged = left.filter((t) => n(t) !== 0);
  ok(
    missed.length === 0 && flagged.length === 0,
    "the raw-SQL scan refuses UPDATE .. SET, UPDATE of a table-like target (a SET in a substitution included), INSERT INTO, DELETE FROM, TRUNCATE, ON CONFLICT DO UPDATE, MERGE INTO, DROP TABLE / SCHEMA / OWNED, ALTER TABLE, COPY .. FROM and SELECT .. INTO in any letter case, with comments between the words (a nested block comment, a line comment ended by CR, a comment after a quoted string that holds a comment opener), with no whitespace between a verb and a quoted or substituted target (`delete from${t}`, `insert into\"t\"(`), in a string, a template with a substitution, a + chain, an escaped spelling or a substitution that is literal text (`${sql.raw('delete from')} firms`), on a snake_case table, on a schema table with no underscore (firms, users), on a Unicode-escaped quoted name (U&\"t\") and behind a qualifier with whitespace around its dot (`public . firms`), and the prose its comment says to reword; and leaves FOR UPDATE / FOR NO KEY UPDATE row locks, reads, a bare word, prose that names a verb outside those shapes (\"update failed\", \"could not insert into the queue\") and a sentence that ends after the verb's object (\"Failed to update project.\") alone",
    [...missed.map((t) => `missed: ${t}`), ...flagged.map((t) => `flagged: ${t}`)],
  );
  // The schema precondition has teeth: the reader goes empty on a directory that is not there,
  // and the precondition refuses a list without firms or users.
  ok(
    schemaTableNames("../no-such-schema-dir").length === 0 &&
      !schemaNamesUsable(schemaTableNames("../no-such-schema-dir")) &&
      !schemaNamesUsable(PROSE_LIKE_TABLES.filter((t) => t !== "firms")) &&
      !schemaNamesUsable(PROSE_LIKE_TABLES.filter((t) => t !== "users")) &&
      schemaNamesUsable(PROSE_LIKE_TABLES),
    "the schema precondition would be red for a schema directory that is not there, and for a table list without firms or without users",
  );
  // The schema reader reads a table however its pgTable call is spelled, and names what it cannot read.
  {
    const imp = 'import { integer, pgTable } from "drizzle-orm/pg-core";\n';
    const cases = [
      [imp + 'export const t = pgTable(/* the log */ "audits", { id: integer("id") });', ["audits"], 0],
      [imp + 'export const t = pgTable ("audits", {});', ["audits"], 0],
      [imp + 'export const t = pgTable /* c */ (\n  // the log\n  "audits",\n  {},\n);', ["audits"], 0],
      [imp + "export const t = pgTable(`audits`, {});", ["audits"], 0],
      ['import { pgTable as table } from "drizzle-orm/pg-core";\nexport const t = table("audits", {});', ["audits"], 0],
      ['import { pgTable as t } from "./tables";\nexport const a = t("audits", {});', ["audits"], 0],
      ['import * as pg from "drizzle-orm/pg-core";\nexport const t = pg.pgTable("audits", { id: pg.integer("id") });', ["audits"], 0],
      ['import * as pg from "drizzle-orm/pg-core";\nexport const t = pg["pgTable"]("audits", {});', ["audits"], 0],
      [imp + 'export const t = pgTable("audits", { id: integer("id") }, (t) => [{ pgTable: t.id }]);', ["audits"], 0],
      [imp + 'const NAME = "audits";\nexport const t = pgTable(NAME, {});', [], 1],
      [imp + "export const t = pgTable(`aud${'its'}`, {});", [], 1],
      [imp + 'const make = pgTable;\nexport const t = make("audits", {});', [], 1],
      ['import * as pg from "drizzle-orm/pg-core";\nconst make = pg.pgTable;\nexport const t = make("audits", {});', [], 1],
      ['import * as pg from "drizzle-orm/pg-core";\nconst make = pg["pgTable"];\nexport const t = make("audits", {});', [], 1],
      [imp + "export { pgTable };", [], 1],
      [imp + 'export const t = pgTable.withRLS("audits", {});', [], 1],
      [imp + 'export const t = (pgTable)("audits", {});', [], 1],
      ['import { pgSchema } from "drizzle-orm/pg-core";\nexport const t = pgSchema("app").table("audits", {});', [], 1],
      ['import { pgTableCreator as mk } from "drizzle-orm/pg-core";\nconst table = mk((n) => `app${n}`);\nexport const t = table("audits", {});', [], 1],
    ];
    const wrong = cases.filter(([text, names, unread]) => {
      const r = schemaTablesIn([["a.ts", text]]);
      return JSON.stringify(r.names) !== JSON.stringify(names) || r.unread.length !== unread;
    });
    // the walk goes into subdirectories: it finds the clause files under src/lib/proofread from src/lib
    const deep = (tsFilesUnder("../src/lib") ?? []).includes("proofread/types.ts");
    // a table name is taken literally in the scan, whatever characters it holds
    let literal = false;
    try {
      literal = rawSqlWrites('const s = "delete from a+b x where true";', ["a+b"]).length === 1 && rawSqlWrites('const s = "delete from aab x where true";', ["a+b"]).length === 0;
    } catch {
      literal = false;
    }
    ok(
      wrong.length === 0 && deep && tsFilesUnder("../no-such-schema-dir") === null && literal,
      "the schema reader reads a pgTable call with a comment or whitespace before its name or its `(`, across line breaks, with a template-literal name, under any name an import gives it (from drizzle-orm/pg-core or a module that re-exports it) and as a namespace's property (pg.pgTable, pg[\"pgTable\"]), and in subdirectories; it names, as unread, a call whose table name is not a string literal, a use of pgTable that is not a direct call (an alias, withRLS, a parenthesised callee, a re-export) and any use of pgSchema or pgTableCreator; and the scan takes each name it reads literally",
      [...wrong.map(([t]) => `read wrongly: ${JSON.stringify(t)}`), ...(deep ? [] : ["the walk did not find src/lib/proofread/types.ts from src/lib"]), ...(literal ? [] : ["a table name with a regex character is not read literally"])],
    );
  }
  ok(
    JSON.stringify(rawSqlWrites("const a = 1;\nconst b = 2;\nconst s = `\n  delete from t`;").map((h) => h.line)) === "[3]",
    "the raw-SQL scan reports the line a literal starts on",
  );
}

// ---------------------------------------------------------------------------
// The checks. `on` is the file the check is ABOUT: the file whose breakage it
// must detect. The teeth pass holds every check to it.
// ---------------------------------------------------------------------------
const CHECKS = [
  // --- routes/proofread.ts: the whole API --------------------------------
  {
    id: "surface-is-three-routes",
    on: "routes",
    msg: "the API is exactly three routes — read a run, request a run, record a disposition — and nothing that could change a study: no put, patch, delete, all or use",
    test: (d) => {
      const got = routeCalls(d.routes).map((c) => `${c.verb} ${c.path}`);
      return same(got, [`get ${P_RUN}`, `post ${P_RUN}`, `post ${P_DISP}`]);
    },
  },
  {
    id: "routes-registered",
    on: "routesIndex",
    msg: "routes/index.ts imports proofreadRouter and mounts it with router.use(proofreadRouter)",
    test: (d) => has(d.routesIndex, 'import proofreadRouter from "./proofread";') && has(d.routesIndex, "router.use(proofreadRouter);"),
  },
  {
    id: "limiter-per-route",
    on: "routes",
    msg: "each route is bound to ITS limiter, ahead of the handler: read -> proofreadReadLimiter, run -> proofreadRunLimiter, triage -> proofreadDispositionLimiter (a swap lets a long list of findings lock the engineer out of re-running)",
    test: (d) =>
      has(getSeg(d), 'router.get("/projects/:id/proofread", proofreadReadLimiter, async (req, res): Promise<void> => {') &&
      has(runSeg(d), 'router.post("/projects/:id/proofread", proofreadRunLimiter, async (req, res): Promise<void> => {') &&
      has(
        dispSeg(d),
        'router.post("/projects/:id/proofread/:runId/findings/:findingId/dispositions", proofreadDispositionLimiter, async (req, res): Promise<void> => {',
      ),
  },
  {
    id: "routes-use-only-proofread-limiters",
    on: "routes",
    msg: "the routes name no limiter but the three proofread ones: generateRateLimiter is per-IP 10/hr and shared by seven engine routes",
    test: (d) => {
      const used = new Set(d.routes.match(/\b\w*Limiter\b/g) ?? []);
      return used.size === THREE_LIMITERS.length && [...used].every((n) => THREE_LIMITERS.includes(n));
    },
  },
  {
    id: "handlers-authenticate-first",
    on: "routes",
    msg: "every registered handler's first statement is the req.isAuthenticated() check, answering 401 AND returning — a branch that responds and falls through goes on to read the database",
    test: (d) => {
      const calls = routeCalls(d.routes);
      return (
        calls.length > 0 &&
        calls.every((c) =>
          /async\(req,res\):Promise<void>=>\{if\(!req\.isAuthenticated\(\)\)\{res\.status\(401\)\.json\(\{error:"[^"]*"\}\);return;\}/.test(sq(c.text)),
        )
      );
    },
  },
  {
    id: "firm-from-session",
    on: "routes",
    msg: "the firm comes from the session user in every handler (getOrCreateFirmForUser(user.id, ...) once each, user = req.user!), and `firmId` appears nowhere but `firmId: firm.id` — the firm is never read from the request",
    test: (d) => {
      const firmIdWords = (d.routes.match(/\bfirmId\b/g) ?? []).length;
      return (
        occ(d.routes, FIRM_LOOKUP) === 3 &&
        occ(d.routes, "const user = req.user!;") === 3 &&
        firmIdWords === occ(d.routes, "firmId: firm.id") &&
        firmIdWords === 1
      );
    },
  },
  {
    id: "body-only-through-contract",
    on: "routes",
    msg: "the request body is read exactly once, through ProofreadDispositionBody.safeParse(req.body ?? {}), and the query string never — no field the contract does not name can reach a write",
    test: (d) =>
      (d.routes.match(/\breq\.body\b/g) ?? []).length === 1 &&
      has(d.routes, "const parsed = ProofreadDispositionBody.safeParse(req.body ?? {});") &&
      !/\breq\.(query|headers|cookies)\b/.test(d.routes),
  },

  // GET
  {
    id: "get-existence-before-read",
    on: "routes",
    msg: "GET checks the project is the firm's BEFORE it sweeps or reads, in that order, with the repo's 404 — a foreign or unknown id is never answered with 200",
    test: (d) => {
      const g = getSeg(d);
      return (
        g.length > 0 &&
        occ(g, GUARD_404_PROJECT) === 1 &&
        occ(g, "latestRunForProject(") === 1 &&
        inOrder(g, [FIRM_LOOKUP, GUARD_404_PROJECT, "claimAndRunOne()", "const latest = await latestRunForProject(firm.id, id);"])
      );
    },
  },
  {
    id: "polled-read-avoids-getproject",
    on: "routes",
    msg: "the polled read uses projectExistsForFirm and never getProject, which selects both jsonb study payloads on every poll",
    test: (d) => d.routes.length > 0 && !/\bgetProject\b/.test(d.routes) && occ(getSeg(d), "projectExistsForFirm(firm.id, id)") === 1,
  },
  {
    id: "get-sweep-is-detached",
    on: "routes",
    msg: "the opportunistic sweep on GET is `void claimAndRunOne().catch(...)`: awaited it makes every poll as slow as a clause pass, and without the catch a rejection is unhandled; the other two handlers never sweep on their own",
    test: (d) =>
      has(getSeg(d), "void claimAndRunOne().catch(() => undefined);") &&
      !/await\s+claimAndRunOne\(/.test(d.routes) &&
      occ(d.routes, "claimAndRunOne(") === 1,
  },
  {
    id: "get-hides-admin-findings",
    on: "routes",
    msg: "GET serves only findings whose audience is not admin (a software fault is not the engineer's to rule on), builds the response from that filtered list, and serves only the dispositions of those findings",
    test: (d) => {
      const g = getSeg(d);
      return (
        has(g, 'const visible = findings.filter((f) => f.audience !== "admin");') &&
        has(g, "const visibleIds = new Set(visible.map((f) => f.id));") &&
        has(g, "findings: visible.map((f) => ({") &&
        has(g, "dispositions: dispositions .filter((d) => visibleIds.has(d.findingId)) .map((d) => ({")
      );
    },
  },
  {
    id: "get-withheld-is-a-count",
    on: "routes",
    msg: `GET counts the run's admin-audience findings once (${WITHHELD_COUNT}), BEFORE the visible list is filtered, from \`findings\` exactly as latestRunForProject returned it — the one binding of that name, a plain element of \`const { … } = latest;\` (\`latest\` used nowhere else but its own declaration and \`if (!latest)\`), read only through list reads that change nothing (not re-bound, spliced, sorted or handed to a call) — and its run answer carries that number as \`withheld\`. Dropped from the list first, the count is always 0 and a run carrying a DEFECT reads as clear. (That the count is all that leaves: the answer's keys are get-answers-are-the-read-shape's, its run values get-run-answer-is-the-run-row's, its two lists get-hides-admin-findings'.)`,
    test: (d) => {
      const g = getSeg(d);
      const tree = getTree(d);
      if (!tree) return false;
      const u = bindingUses(tree, "findings", LIST_READS);
      const runs = runAnswers(d);
      return {
        ok:
          occ(g, WITHHELD_COUNT) === 1 &&
          inOrder(g, [WITHHELD_COUNT, "const visible ="]) &&
          u.decls.length === 1 &&
          destructuredFrom(u.decls[0], "latest") &&
          u.other.length === 0 &&
          (g.match(/\blatest\b/g) ?? []).length === 3 &&
          runs.length === 1 &&
          runs[0].props.withheld === "withheld",
        where: u.other.map((t) => `${pathOf("routes")}: findings used as: ${t}`),
      };
    },
  },
  {
    id: "get-none-withholds-nothing",
    on: "routes",
    msg: 'a project with no run is answered exactly { status: "none", withheld: 0, rulesChanged: false, findings: [], coverage: [], dispositions: [] }',
    test: (d) => {
      const n = noneAnswers(d);
      return n.length === 1 && n[0].other === 0 && entriesSorted(n[0].props) === entriesSorted(NONE_ANSWER);
    },
  },
  {
    id: "get-answers-are-the-read-shape",
    on: "routes",
    msg: `GET answers twice and each answer carries exactly the read shape's keys, no spread: the run's ${READ_KEYS.join(", ")}; the no-run answer ${Object.keys(NONE_ANSWER).join(", ")} — so nothing about a withheld finding can ride out under a new key`,
    test: (d) => {
      const n = noneAnswers(d);
      const r = runAnswers(d);
      return (
        answersOf(d).length === 2 &&
        n.length === 1 &&
        r.length === 1 &&
        n[0].other === 0 &&
        r[0].other === 0 &&
        same(Object.keys(r[0].props), READ_KEYS) &&
        same(Object.keys(n[0].props), Object.keys(NONE_ANSWER))
      );
    },
  },

  {
    id: "get-run-answer-is-the-run-row",
    on: "routes",
    msg: `GET's run answer gives each run value as the run row holds it — ${Object.entries(RUN_ANSWER).map(([k, v]) => `${k}: ${v}`).join(", ")} — and \`run\` is the row latestRunForProject returned: a plain element of \`const { … } = latest;\`, the one binding of that name, read only through those columns. Coverage marked with a withheld finding's clause, a manifest that says a DEFECT was found, a status not the run's: each tells the engineer something the count must not`,
    test: (d) => {
      const tree = getTree(d);
      if (!tree) return false;
      const r = runAnswers(d);
      const u = bindingUses(tree, "run", RUN_COLUMNS);
      const wrong = r.length === 1 ? Object.entries(RUN_ANSWER).filter(([k, v]) => r[0].props[k] !== sq(v)) : [];
      return {
        ok: r.length === 1 && wrong.length === 0 && u.decls.length === 1 && destructuredFrom(u.decls[0], "latest") && u.other.length === 0,
        where: [...wrong.map(([k, v]) => `${pathOf("routes")}: ${k} is ${JSON.stringify(r[0].props[k])}, want ${JSON.stringify(sq(v))}`), ...u.other.map((t) => `${pathOf("routes")}: run used as: ${t}`)],
      };
    },
  },
  {
    id: "get-writes-nothing-it-read",
    on: "routes",
    msg: "GET writes through no property or element of anything — no assignment to one, no delete, no ++/--, no Object.assign / defineProperty / Reflect call — so what latestRunForProject read is answered as it was read: a finding relabelled to the engineer's audience before the count is counted 0 and then served with its full text",
    test: (d) => {
      const tree = getTree(d);
      if (!tree) return false;
      const w = propertyWrites(tree);
      return { ok: w.length === 0, where: w.map((t) => `${pathOf("routes")}: GET writes: ${t}`) };
    },
  },

  {
    id: "get-rules-changed-is-the-carry-gate",
    on: "routes",
    msg: `GET says whether the rules changed since the revision this run's carry read from, as the carry gate decided it: \`${RULES_CHANGED}\` — \`previous\` a plain element of \`const { … } = latest;\` used nowhere else, \`run.rulesVersion\` the run's own (stamped when its clauses ran) — and the run answer carries it as \`rulesChanged\`. True means nothing carried and every earlier decision is open again on purpose; a hard-coded value, another column or the comparison inverted tells the engineer the opposite`,
    test: (d) => {
      const g = getSeg(d);
      const tree = getTree(d);
      if (!tree) return false;
      const u = bindingUses(tree, "previous", new Set(["rulesVersion"]));
      const r = runAnswers(d);
      return (
        occ(g, RULES_CHANGED) === 1 &&
        u.decls.length === 1 &&
        destructuredFrom(u.decls[0], "latest") &&
        (g.match(/\bprevious\b/g) ?? []).length === 3 &&
        (g.match(/\brulesChanged\b/g) ?? []).length === 3 &&
        r.length === 1 &&
        r[0].props.rulesChanged === "rulesChanged"
      );
    },
  },

  // POST run
  {
    id: "run-existence-before-enqueue",
    on: "routes",
    msg: "POST run checks the project is the firm's BEFORE it enqueues, enqueues once with the session firm and user, and awaits it — a run enqueued for a foreign project is a write under another tenant",
    test: (d) => {
      const r = runSeg(d);
      return (
        r.length > 0 &&
        occ(r, GUARD_404_PROJECT) === 1 &&
        occ(r, "enqueueProofread(") === 1 &&
        inOrder(r, [
          FIRM_LOOKUP,
          GUARD_404_PROJECT,
          "await enqueueProofread({ projectId: id, firmId: firm.id, userId: user.id });",
          "res.json({ ok: true });",
        ])
      );
    },
  },

  {
    id: "revision-conflict-helper",
    on: "routes",
    msg: "isRevisionConflict is true ONLY for unique violation 23505 on the (project_id, revision) key, whether the driver error is bare or wrapped in `cause` (drizzle wraps it) — a broader test would turn any other conflict into a silent success",
    test: (d) =>
      safe(() => {
        const key = initializerOf(d.routes, "REVISION_KEY");
        const fn = /function isRevisionConflict\([\s\S]*?\n\}\n/.exec(d.routes)?.[0];
        if (!key || !fn) return false;
        const js = fn.replace(/:\s*(unknown|boolean|any)\b/g, "");
        const isConflict = new Function(`const REVISION_KEY = ${key};\n${js}\nreturn isRevisionConflict;`)();
        const K = "UQ_study_proofread_runs_project_revision";
        return (
          key === `"${K}"` &&
          isConflict({ code: "23505", constraint: K }) === true &&
          isConflict({ cause: { code: "23505", constraint: K } }) === true &&
          isConflict({ cause: { cause: { code: "23505", constraint: K } } }) === true &&
          isConflict({ code: "23505", constraint: "some_other_unique_key" }) === false &&
          // The sibling unique key in the same table family, and near-misses of
          // the real name: a prefix test such as startsWith("UQ_study_proofread")
          // admits the findings key, and startsWith(KEY) admits KEY + "_x".
          isConflict({ code: "23505", constraint: "UQ_study_proofread_findings_run_fp" }) === false &&
          isConflict({ code: "23505", constraint: `${K}_x` }) === false &&
          isConflict({ code: "23505", constraint: `x${K}` }) === false &&
          isConflict({ code: "23505", constraint: K.slice(0, -1) }) === false &&
          // A proper SUFFIX too (K.endsWith(String(e.constraint)) accepts it), and the empty name.
          isConflict({ code: "23505", constraint: K.slice(1) }) === false &&
          isConflict({ code: "23505", constraint: "" }) === false &&
          isConflict({ cause: { code: "23505" } }) === false &&
          isConflict({ code: "23503", constraint: K }) === false &&
          isConflict(new Error("x")) === false &&
          isConflict(null) === false &&
          isConflict(undefined) === false
        );
      }),
  },
  {
    id: "run-revision-conflict-is-success",
    on: "routes",
    msg: "in POST run, a revision conflict is answered 200 { ok: true } AND returned, ahead of the 500 — two quick presses of \"Run again\" must not surface an error for a run that IS queued — and no other handler treats a conflict as success",
    test: (d) => {
      const r = runSeg(d);
      return (
        r.length > 0 &&
        occ(d.routes, "isRevisionConflict(err)") === 1 &&
        occ(r, "isRevisionConflict(err)") === 1 &&
        inOrder(r, [
          "} catch (err) {",
          "if (isRevisionConflict(err)) { res.json({ ok: true }); return; }",
          'req.log.error({ err }, "proofread.request_failed");',
          "res.status(500)",
        ])
      );
    },
  },

  // POST disposition
  {
    id: "disposition-chain-in-order",
    on: "routes",
    msg: "POST disposition runs in the order that matters: parse the body, refuse PE-only dispositions, gate the ids, resolve the firm, verify the finding chain, check the finding's audience, check the decision fits the finding's type, check the run is the project's newest finished one, and only then insert — once",
    test: (d) => {
      const p = dispSeg(d);
      return (
        p.length > 0 &&
        occ(p, "insertDisposition(") === 1 &&
        occ(p, "findingInFirmRun(") === 1 &&
        inOrder(p, [
          "ProofreadDispositionBody.safeParse(req.body ?? {})",
          "if (PE_ONLY.has(parsed.data.disposition))",
          "!UUID.test(urlProjectId)",
          DISP_LOWER[0],
          "getOrCreateFirmForUser(",
          "if (!(await findingInFirmRun(",
          "await findingAudienceForFirm(",
          "if (!decisionApplies(",
          "await latestRunStatusForProject(",
          "await insertDisposition(",
        ])
      );
    },
  },
  {
    id: "disposition-scope-guard-exact",
    on: "routes",
    msg: "the finding chain is verified as findingInFirmRun(firm.id, projectId, runId, findingId) — the arguments are all strings, so a transposition type-checks — and a miss answers the repo's 404, never 403",
    test: (d) => occ(dispSeg(d), GUARD_404_FINDING) === 1,
  },
  {
    id: "disposition-refuses-admin-findings",
    on: "routes",
    msg: "after the chain is verified, POST disposition asks the finding's audience for the FIRM's own finding id and answers an admin-audience finding (a DEFECT: a software fault a person outside admin cannot rule on) — or one with no audience at all — with the same 404 'Finding not found.' as an unknown one, AND a return, before anything is written; a 403 would confirm the record exists",
    test: (d) => {
      const p = dispSeg(d);
      return (
        p.length > 0 &&
        occ(p, AUDIENCE_GUARD) === 1 &&
        occ(p, "findingAudienceForFirm(") === 1 &&
        occ(p, "insertDisposition(") === 1 &&
        inOrder(p, ["if (!(await findingInFirmRun(", AUDIENCE_GUARD, "await insertDisposition("])
      );
    },
  },
  {
    id: "disposition-fits-the-finding-type",
    on: "routes",
    msg: "after the audience 404 and before anything is written, POST disposition refuses a decision the finding's TYPE is not offered (decisionApplies(finding.type, parsed.data.disposition), the type read in the same firm-scoped lookup as the audience) with 422 'This decision does not apply to this finding.' AND a return — the log is append-only, so a BLOCKER marked Disclosed or any decision on a CONTESTED item, once written, stays written",
    test: (d) => {
      const p = dispSeg(d);
      return (
        p.length > 0 &&
        occ(p, TYPE_GUARD) === 1 &&
        occ(d.routes, "decisionApplies(") === 2 &&
        occ(p, "insertDisposition(") === 1 &&
        inOrder(p, ["await findingAudienceForFirm(", TYPE_GUARD, "await insertDisposition("])
      );
    },
  },
  {
    id: "decision-applies-follows-the-contract",
    on: "routes",
    msg: "the routes' decisionApplies, run (transpiled by TypeScript), answers from the OFFERED_DISPOSITIONS it imports and from nothing else: true exactly for the decisions listed under the finding's type, false for every other pair, and false for a type the map does not name — including keys every object inherits (constructor, __proto__, toString), which must not read Object.prototype — and it follows a DIFFERENT map handed in its place, so it holds no table of its own; the routes declare no OFFERED_DISPOSITIONS of their own",
    test: (d) => {
      if (/\b(?:const|let|var|function|class)\s+OFFERED_DISPOSITIONS\b/.test(d.routes)) return { ok: false, where: [`${pathOf("routes")}: declares its own OFFERED_DISPOSITIONS`] };
      const TYPES = [...Object.keys(OFFERED_BY_TYPE), "SOMETHING_NEW", "", "constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "blocker"];
      const DECS = [...SIX_DISPOSITIONS, "", "nonsense", "length", "constructor", "fixed"];
      // A second map, unlike the real one in every type that has decisions: a function that
      // ignores the map it is handed (a table of its own, a hard-coded answer) fails one of the two.
      const OTHER = { BLOCKER: ["DISCLOSED"], DISCLOSE: ["FIXED"], NOTE: [], UNVERIFIED: ["WITHDRAWN"], CONTESTED: ["FIXED"], DEFECT: ["BUG_FILED"] };
      const wrong = [];
      for (const map of [OFFERED_BY_TYPE, OTHER]) {
        let fits;
        try {
          fits = routeDecisionApplies(d.src.routes, map);
        } catch (e) {
          return { ok: false, where: [`${pathOf("routes")}: decisionApplies does not evaluate: ${e?.message ?? e}`] };
        }
        if (typeof fits !== "function") return { ok: false, where: [`${pathOf("routes")}: no function decisionApplies`] };
        for (const t of TYPES)
          for (const x of DECS) {
            const want = Object.hasOwn(map, t) && map[t].includes(x);
            let got;
            try {
              got = fits(t, x);
            } catch (e) {
              got = `threw ${e?.message ?? e}`;
            }
            if (got !== want) wrong.push(`${map === OTHER ? "other map, " : ""}decisionApplies(${JSON.stringify(t)}, ${JSON.stringify(x)}) is ${JSON.stringify(got)}, want ${want}`);
          }
      }
      return { ok: wrong.length === 0, where: wrong.slice(0, 6) };
    },
  },
  {
    id: "disposition-refuses-superseded-run",
    on: "routes",
    msg: "after the 422 and before anything is written, POST disposition looks up the project's newest run for the FIRM (latestRunStatusForProject(firm.id, projectId)) and answers 409 'This check has been run again. Refresh to see the latest.' AND returns unless that run IS the run in the URL and has finished — rules_ready or ready, the pair the panel shows findings and offers decisions on (a 'ready' run refused here would answer every press with \"run again\" and record nothing) — a decision on an older revision is stranded once the newer one has carried, and one on an unfinished run races the carry",
    test: (d) => {
      const p = dispSeg(d);
      return (
        p.length > 0 &&
        occ(p, STALE_GUARD) === 1 &&
        occ(d.routes, "latestRunStatusForProject(") === 1 &&
        occ(p, "insertDisposition(") === 1 &&
        inOrder(p, [STALE_GUARD, "await insertDisposition("])
      );
    },
  },
  {
    id: "disposition-params-bound",
    on: "routes",
    msg: "projectId, runId and findingId are each read from their own route parameter",
    test: (d) => {
      const p = dispSeg(d);
      return (
        DISP_IDS.every(([n, param]) => has(p, `const ${urlName(n)} = String(req.params.${param});`))
      );
    },
  },
  {
    id: "disposition-ids-are-lowercased-once",
    on: "routes",
    msg: "right after the UUID gate, before anything reads them, POST disposition lowercases each URL id once (`const projectId = urlProjectId.toLowerCase();`, and the same for runId and findingId), and from then on uses only those: each url<Name> appears exactly three times (read, gated, lowercased) and each id is declared once. The gate accepts either case and Postgres compares uuid columns without regard to it, but the 409 compares the newest run's id, which Postgres renders in lowercase, with the URL's as text — an uppercase id of the newest run was refused as \"run again\" and nothing was recorded",
    test: (d) => {
      const p = dispSeg(d);
      const words = (re) => (p.match(re) ?? []).length;
      return (
        p.length > 0 &&
        DISP_LOWER.every((l) => occ(p, l) === 1) &&
        DISP_IDS.every(([n]) => words(new RegExp(`\\b${urlName(n)}\\b`, "g")) === 3 && words(new RegExp(`\\b(?:const|let|var)\\s+${n}\\b`, "g")) === 1) &&
        inOrder(p, [DISP_GATE, ...DISP_LOWER, "getOrCreateFirmForUser("])
      );
    },
  },
  {
    id: "disposition-written-as-session-user",
    on: "routes",
    msg: "the disposition is inserted for the finding that was verified (the same findingId), from the parsed body, attributed to the SESSION user — an actor taken from the body would let anyone sign another person's ACCEPTED_RISK",
    test: (d) =>
      has(
        dispSeg(d),
        "await insertDisposition({ findingId, disposition: parsed.data.disposition, note: parsed.data.note, sourceLabel: parsed.data.sourceLabel, actorUserId: user.id, });",
      ),
  },
  {
    id: "uuid-gate-is-strict",
    on: "routes",
    msg: "the UUID gate accepts a canonical uuid and rejects the strings the loose [0-9a-f-]{36} accepted (36 dashes, no dashes) — those reach Postgres and come back as a 500 instead of a 404",
    test: (d) => {
      const expr = initializerOf(d.routes, "UUID");
      const re = safe(() => Function(`return (${expr});`)()) ? Function(`return (${expr});`)() : null;
      if (!(re instanceof RegExp)) return false;
      const accept = ["3f2504e0-4f89-41d3-9a0c-0305e82c3301", "3F2504E0-4F89-41D3-9A0C-0305E82C3301"];
      const reject = ["-".repeat(36), "3f2504e04f8941d39a0c0305e82c3301", "", "not-a-uuid", "3f2504e0-4f89-41d3-9a0c-0305e82c330", "3f2504e0-4f89-41d3-9a0c-0305e82c3301x", "' OR 1=1 --"];
      return accept.every((v) => re.test(v)) && reject.every((v) => !re.test(v));
    },
  },
  {
    id: "every-id-is-uuid-gated",
    on: "routes",
    msg: "every id taken from the URL is UUID-gated before the database sees it, answering 404 and returning: id in GET and POST run, all three in POST disposition",
    test: (d) =>
      has(getSeg(d), 'if (!UUID.test(id)) { res.status(404).json({ error: "Project not found." }); return; }') &&
      has(runSeg(d), 'if (!UUID.test(id)) { res.status(404).json({ error: "Project not found." }); return; }') &&
      has(
        dispSeg(d),
        DISP_GATE,
      ),
  },
  {
    id: "foreign-is-404-not-403",
    on: "routes",
    msg: "a foreign or unknown id is a 404 everywhere (403 would confirm someone else's project exists): the only 403 in the file is the PE-only refusal, the only 422 the decision-type refusal, the only 409 the superseded-run refusal, no other status is answered but 400, 401 and 500, and the 404s are all present",
    test: (d) => {
      const r = sq(d.routes);
      const four = occ(d.routes, 'res.status(404).json({ error: "Project not found." })');
      const three = occ(d.routes, 'res.status(404).json({ error: "Finding not found." })');
      return (
        r.length > 0 &&
        four === 4 &&
        three === 3 &&
        occ(d.routes, "res.status(403)") === 1 &&
        occ(d.routes, "res.status(422)") <= 1 &&
        occ(d.routes, "res.status(409)") <= 1 &&
        !/status\((?!400|401|403|404|409|422|500)\d+\)/.test(d.routes.replace(/\s+/g, ""))
      );
    },
  },
  {
    id: "pe-only-set",
    on: "routes",
    msg: "the PE-only set is exactly ACCEPTED_RISK and CONTESTED_PE: the sealing engineer's decisions are refused, and none of the four a firm member may record is swept in (a misspelt member silently leaves the real one open)",
    test: (d) => {
      const m = /const PE_ONLY = new Set\(\[([^\]]*)\]\)/.exec(d.routes);
      if (!m) return false;
      const members = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      return same(members, PE_ONLY_NAMES) && PERMITTED_NAMES.every((n) => !members.includes(n));
    },
  },
  {
    id: "pe-only-refused-before-write",
    on: "routes",
    msg: "a PE-only disposition is refused with a 403 AND a return, ahead of the firm lookup and any write — there is no PE role in this schema to gate on, so the refusal is unconditional",
    test: (d) => {
      const p = dispSeg(d);
      return (
        p.length > 0 &&
        /if\(PE_ONLY\.has\(parsed\.data\.disposition\)\)\{res\.status\(403\)\.json\(\{error:"[^"]*"\}\);return;\}/.test(sq(p)) &&
        inOrder(p, ["if (PE_ONLY.has(parsed.data.disposition))", "getOrCreateFirmForUser(", "await insertDisposition("])
      );
    },
  },

  // The advisor boundary, in the route surface
  {
    id: "routes-import-whitelist",
    on: "routes",
    msg: "the routes import exactly the modules and names the design allows, and load no module any other way (dynamic import, require, createRequire, getBuiltinModule, eval, Function, a read of .constructor but .constructor.name): nothing that writes a study (saveProject, setProjectTheme, getProject, the db, a schema table) can be called without first appearing here",
    test: (d) => {
      const want = {
        express: ["Router", "type IRouter"],
        "@workspace/tis-api-zod": ["OFFERED_DISPOSITIONS", "ProofreadDispositionBody"],
        "../lib/firms": ["getOrCreateFirmForUser"],
        "../lib/tis-projects": ["projectExistsForFirm"],
        "../lib/security": THREE_LIMITERS,
        "../lib/proofread-run": ["claimAndRunOne", "enqueueProofread"],
        "../lib/proofread-store": ["findingAudienceForFirm", "findingInFirmRun", "insertDisposition", "latestRunForProject", "latestRunStatusForProject"],
      };
      return { ok: importsEqual(importsOf(d.src.routes), want), where: importDiff("routes", d.src.routes, want) };
    },
  },
  {
    id: "routes-do-not-touch-study",
    on: "routes",
    msg: "no route touches tis_projects, request_payload or result_payload, and none writes or reaches the database by itself: read from the AST, no write verb in any spelling the AST can see (member call, string-key element access, destructured, bound, .call, computed access, reflection on a db handle), no tisProjectsTable or payload name, no `db`, and no raw SQL in a write's shape in any string or template (any letter case; the shapes are listed at rawSqlWrites)",
    test: (d) => {
      const sc = dbScan(d.src.routes);
      const raw = rawSqlWrites(d.src.routes, d.schemaRead.prose);
      // The AST names whole identifiers and whole literals; these substrings stay as extra
      // conjuncts, because "select result_payload from tis_projects" is a string no
      // identifier match sees and the old check refused it.
      const text = /tisProjectsTable|requestPayload|resultPayload|request_payload|result_payload|tis_projects|\.update\(|\.insert\(|\.delete\(|\bdb\b|@workspace\/db/;
      return {
        ok: d.routes.length > 0 && sc.writes.length === 0 && sc.study.length === 0 && sc.dbIdents.length === 0 && raw.length === 0 && !text.test(d.routes),
        where: [
          ...sc.writes.map((w) => fmtWrite("routes", w)),
          ...sc.study.map((x) => fmtAt("routes", x, x.name)),
          ...sc.dbIdents.map((x) => fmtAt("routes", x, "db")),
          ...raw.map((h) => fmtRawSql("routes", h)),
          ...textHits("routes", d.src.routes, text),
        ],
      };
    },
  },
  {
    id: "routes-never-echo-internals",
    on: "routes",
    msg: "the read response carries none of a run's internals (error text, claim, attempts, requesting user, firm) and no disposition actor — the stored error is raw database text",
    test: (d) =>
      has(getSeg(d), "res.json({") &&
      !/\brun\.(error|firmId|attempts|claimedBy|claimedAt|requestedByUserId|model|inputTokens|outputTokens)\b/.test(d.routes) &&
      !/\bd\.actorUserId\b/.test(d.routes) &&
      !/\baudience:/.test(d.routes),
  },
  {
    id: "routes-500s-are-opaque",
    on: "routes",
    msg: "a failure is logged and answered with a fixed sentence: the caught error appears only as `req.log.error({ err }, ...)` (and as the argument of the revision-conflict test), never in a response",
    test: (d) => {
      const rest = d.routes.replace(/catch \(err\)/g, "").replace(/\{ err \}/g, "").replace(/isRevisionConflict\(err\)/g, "").replace(/function isRevisionConflict\(err: unknown\)[\s\S]*?\n\}\n/, "");
      return d.routes.length > 0 && occ(d.routes, "catch (err)") === 3 && !/\berr\b/.test(rest);
    },
  },
  {
    id: "copy-routes",
    on: "routes",
    msg: 'route copy avoids "independent review", "second opinion", "peer review" and "QA/QC" (permitted: an internal consistency and traceability check)',
    test: (d) => d.routes.length > 0 && !BANNED_COPY.test(d.routes),
  },

  // --- the contract, evaluated -------------------------------------------
  {
    id: "contract-dispositions-set",
    on: "contract",
    msg: "the contract's dispositions are the protocol's six, ACCEPTED_RISK and CONTESTED_PE included (the route refuses those two; the contract still recognises them)",
    test: (d) => safe(() => same(d.mod.ProofreadDisposition.options, SIX_DISPOSITIONS)),
  },
  {
    id: "contract-types-match-server",
    on: "contract",
    msg: "the contract's finding types equal the server's ProofreadType union in src/lib/proofread/types.ts",
    test: (d) => {
      const m = /export type ProofreadType =([^;]+);/.exec(d.typesSrc);
      const server = m ? [...m[1].matchAll(/"(\w+)"/g)].map((x) => x[1]) : [];
      return server.length === 6 && safe(() => same(d.mod.ProofreadType.options, server));
    },
  },
  {
    id: "contract-withdrawn-needs-source",
    on: "contract",
    msg: "WITHDRAWN without a sourceLabel is rejected on the sourceLabel path with a message that says so, and WITHDRAWN with one is accepted — Datum withdraws on a named source, never on an argument",
    test: (d) =>
      safe(() => {
        const bad = parseBody(d, { disposition: "WITHDRAWN" });
        const good = parseBody(d, { disposition: "WITHDRAWN", sourceLabel: "Redline S5 table 4" });
        return (
          !bad.success &&
          bad.error.issues[0].path[0] === "sourceLabel" &&
          /source/i.test(bad.error.issues[0].message) &&
          good.success &&
          good.data.sourceLabel === "Redline S5 table 4"
        );
      }),
  },
  {
    id: "contract-source-is-not-whitespace",
    on: "contract",
    msg: "a whitespace-only sourceLabel does not satisfy WITHDRAWN: a blank source is an argument with a field around it",
    test: (d) => safe(() => !parseBody(d, { disposition: "WITHDRAWN", sourceLabel: "   " }).success && !parseBody(d, { disposition: "WITHDRAWN", sourceLabel: "\n\t" }).success),
  },
  {
    id: "contract-other-dispositions-need-no-source",
    on: "contract",
    msg: "every other disposition is accepted without a source: the rule is WITHDRAWN's alone",
    test: (d) => safe(() => ["FIXED", "BUG_FILED", "DISCLOSED", "CONTESTED_PE", "ACCEPTED_RISK"].every((x) => parseBody(d, { disposition: x }).success)),
  },
  {
    id: "contract-body-ignores-actor",
    on: "contract",
    msg: "the body schema carries no actor, finding or firm: extra keys are stripped, so none can reach insertDisposition through parsed.data",
    test: (d) =>
      safe(() => {
        const r = parseBody(d, { disposition: "FIXED", note: "n", actorUserId: "u", findingId: "f", firmId: "x", runId: "r" });
        return r.success && Object.keys(r.data).every((k) => ["disposition", "note", "sourceLabel"].includes(k)) && r.data.note === "n";
      }),
  },
  {
    id: "contract-bounds",
    on: "contract",
    msg: "note is bounded at 2000 and sourceLabel at 500 characters",
    test: (d) =>
      safe(
        () =>
          parseBody(d, { disposition: "FIXED", note: "n".repeat(2000) }).success &&
          !parseBody(d, { disposition: "FIXED", note: "n".repeat(2001) }).success &&
          parseBody(d, { disposition: "WITHDRAWN", sourceLabel: "s".repeat(500) }).success &&
          !parseBody(d, { disposition: "WITHDRAWN", sourceLabel: "s".repeat(501) }).success,
      ),
  },
  {
    id: "contract-rejects-unknown-disposition",
    on: "contract",
    msg: "an unknown, lower-case or missing disposition is rejected — the PE-only refusal compares against parsed.data, so what the contract lets through is what the route must name",
    test: (d) => safe(() => ["fixed", "NOPE", "", undefined, 3].every((x) => !parseBody(d, { disposition: x }).success) && !parseBody(d, {}).success && !parseBody(d, null).success),
  },
  {
    id: "contract-offered-decisions",
    on: "contract",
    msg: "the contract's OFFERED_DISPOSITIONS, evaluated, names exactly the six finding types and offers each exactly the protocol's decisions: BLOCKER {FIXED, WITHDRAWN}; DISCLOSE, NOTE and UNVERIFIED {DISCLOSED, FIXED, WITHDRAWN}; CONTESTED and DEFECT nothing — so BUG_FILED, ACCEPTED_RISK and CONTESTED_PE fit no finding a firm member can rule on, and a disclosed BLOCKER cannot be written",
    test: (d) =>
      safe(() => {
        const m = d.mod.OFFERED_DISPOSITIONS;
        return (
          m !== null &&
          typeof m === "object" &&
          same(Object.keys(m), Object.keys(OFFERED_BY_TYPE)) &&
          Object.entries(OFFERED_BY_TYPE).every(([t, want]) => Array.isArray(m[t]) && m[t].length === want.length && same(m[t], want))
        );
      }),
  },
  {
    id: "contract-read-response",
    on: "contract",
    msg: `the contract's ProofreadReadResponse, evaluated, is GET's answer: exactly the read keys, required just ${Object.keys(NONE_ANSWER).join(", ")}; \`withheld\` a whole number of 0 or more and nothing else (not missing, negative, fractional, a string, null, or a list or object of findings); \`rulesChanged\` a boolean and nothing else (not missing, a string, a number or null); strict, so an extra key, or a finding that carries its audience, is refused; and it accepts the no-run answer and a finished run's answer`,
    test: (d) =>
      safe(() => {
        const S = d.mod.ProofreadReadResponse;
        if (!S || typeof S.safeParse !== "function" || !S.shape) return false;
        const accepts = (v) => S.safeParse(v).success;
        const none = { status: "none", withheld: 0, rulesChanged: false, findings: [], coverage: [], dispositions: [] };
        const keys = Object.keys(S.shape);
        const required = keys.filter((k) => !S.shape[k].isOptional());
        const { withheld: _w, ...noCount } = none;
        return (
          same(keys, READ_KEYS) &&
          same(required, Object.keys(NONE_ANSWER)) &&
          accepts(none) &&
          accepts(READ_SAMPLE) &&
          accepts({ ...READ_SAMPLE, withheld: 0 }) &&
          !accepts(noCount) &&
          [undefined, -1, 1.5, "1", null, [], [{ clauseId: "losMatchesDelay" }], { losMatchesDelay: 1 }].every((w) => !accepts({ ...none, withheld: w })) &&
          accepts({ ...READ_SAMPLE, rulesChanged: false }) &&
          [undefined, "true", "false", 1, 0, null, {}].every((v) => !accepts({ ...none, rulesChanged: v })) &&
          !accepts({ ...none, defects: [] }) &&
          !accepts({ ...READ_SAMPLE, findings: [{ ...READ_SAMPLE.findings[0], audience: "admin" }] })
        );
      }),
  },
  {
    id: "contract-no-collision",
    on: "contract",
    msg: "no name the contract exports is also exported by another module under lib/tis-api-zod/src (the two generated barrels and the five hand-written modules are re-exported with `export *` from one index)",
    test: (d) => {
      const mine = exportNames(d.contract);
      const others = new Set(d.otherNames);
      return mine.length >= 4 && mine.every((n) => !others.has(n)) && new Set(mine).size === mine.length;
    },
  },
  {
    id: "copy-contract",
    on: "contract",
    msg: "contract copy (the messages a 400 carries to the screen) avoids the banned phrases",
    test: (d) => d.contract.length > 0 && !BANNED_COPY.test(d.contract),
  },
  {
    id: "zod-index-reexports",
    on: "zodIndex",
    msg: 'lib/tis-api-zod/src/index.ts re-exports the contract once: export * from "./proofread";',
    test: (d) => occ(d.zodIndex, 'export * from "./proofread";') === 1,
  },

  // --- proofread-store.ts: where the writes actually live ------------------
  {
    id: "store-import-whitelist",
    on: "store",
    msg: "the store imports exactly the modules AND NAMES it needs (drizzle's six helpers; db, the three proofread tables, tisProjectsTable and the StudyProofreadRun type from @workspace/db; the logger; the two pure proofread/ modules) in whatever spelling (read from the TypeScript AST: quotes, comments, spacing, indentation, one line or many, aliases, string-literal names), with no re-export, side-effect import, dynamic import, require, createRequire, getBuiltinModule, eval, Function or read of .constructor (but .constructor.name) — the scans of the store's own text cannot see a study write reached through another module, and `import { setProjectTheme } from \"./tis-projects\"` left every one of them green",
    test: (d) => ({ ok: d.store.length > 0 && importsEqual(importsOf(d.src.store), STORE_IMPORTS), where: importDiff("store", d.src.store, STORE_IMPORTS) }),
  },
  {
    id: "store-writes-only-proofread-tables",
    on: "store",
    msg: "every write the store's OWN code makes is `<recv>.<verb>(<table>)` with a verb that table allows, exactly as today: the run table insert or update, the findings table insert, the disposition log insert, and no delete of anything — a write to tis_projects or any other table is the advisor boundary broken, a delete of a run or a finding cascades into the disposition log, and any other way of reaching a write verb (string-key element access with a non-table argument, destructured, bound, .call, computed access on db) is refused; a write reached through another module is the import whitelist's to catch",
    test: (d) => {
      const w = dbScan(d.src.store).writes;
      const bad = w.filter((x) => !(x.form === "call" && storeMayWrite(x.verb, x.table)));
      // the old text scan, kept as an extra conjunct and narrowed to the same verb-by-table rule:
      // every `.verb(Name` in the text is a write the table allows
      const textBad = [...d.store.matchAll(/\.(update|insert|delete)\(\s*(\w+)/g)].filter((m) => !storeMayWrite(m[1], m[2]));
      return {
        ok: d.store.length > 0 && w.length > 0 && bad.length === 0 && textBad.length === 0,
        where: [...bad.map((x) => fmtWrite("store", x)), ...textBad.map((m) => `${pathOf("store")}:${rawLine(d.src.store, m.index)}: ${m[0]} (text scan)`)],
      };
    },
  },
  {
    id: "store-write-scan-sees-the-writes",
    on: "store",
    msg: "the scan above is not vacuous: the store really does update the run table and insert runs, findings and dispositions",
    test: (d) => {
      const seen = new Set(dbScan(d.src.store).writes.filter((x) => x.form === "call").map((x) => `${x.verb}:${x.table}`));
      return [
        "update:studyProofreadRunsTable",
        "insert:studyProofreadRunsTable",
        "insert:studyProofreadFindingsTable",
        "insert:studyProofreadDispositionsTable",
      ].every((k) => seen.has(k));
    },
  },
  {
    id: "store-dispositions-are-append-only",
    on: "store",
    msg: "the disposition log is only ever inserted into, and only through the query builder: no update or delete of it, no delete of ANY table (runs -> findings -> dispositions cascade on delete, so deleting a run or a finding erases its dispositions), no upsert, no raw SQL in a write's shape in any letter case (a raw INSERT INTO the log included; the shapes, and what they do not read, are listed at rawSqlWrites), and no write verb reached in a form that hides its table (destructured, bound, .call, computed access, a table that is not a plain identifier) — ACCEPTED_RISK has to record who accepted it and when",
    test: (d) => {
      const sc = dbScan(d.src.store);
      const D = "studyProofreadDispositionsTable";
      const bad = sc.writes.filter((w) => !(w.form === "call" && w.table !== "<not a table identifier>" && w.verb !== "delete" && !(w.table === D && w.verb !== "insert")));
      const raw = rawSqlWrites(d.src.store, d.schemaRead.prose);
      // extra conjuncts from the old text scan: the AST sees property names and destructured keys,
      // not a destructure of the upsert off an insert builder written some other way
      const text = [/onConflictDoUpdate/, /\.(update|delete)\(\s*studyProofreadDispositionsTable/];
      return {
        ok: d.store.length > 0 && bad.length === 0 && !sc.members.has("onConflictDoUpdate") && raw.length === 0 && text.every((re) => !re.test(d.store)),
        where: [
          ...bad.map((w) => fmtWrite("store", w)),
          ...raw.map((h) => fmtRawSql("store", h)),
          ...text.flatMap((re) => textHits("store", d.src.store, re)),
          ...(sc.members.has("onConflictDoUpdate") && !/onConflictDoUpdate/.test(d.store) ? [`${pathOf("store")}: a member named onConflictDoUpdate (spelled with an escape)`] : []),
        ],
      };
    },
  },
  {
    id: "store-study-row-is-read-only",
    on: "store",
    msg: "tis_projects and its two payload columns appear in the store only in the import and inside loadStudyForRun, and there only as a select — the clause pass reads the study, nothing writes it; no write verb of any spelling appears inside the loader",
    test: (d) => {
      const loader = functionNamed(d.src.store, "loadStudyForRun");
      if (!loader) return false;
      const sc = dbScan(d.src.store);
      const text = loader.getText();
      // the old text scan, kept as an extra conjunct: outside the loader and the imports, the names
      // appear nowhere, in an identifier, a string or a comment-free template ("see tisProjectsTable")
      const oldLoader = body(d.store, "loadStudyForRun");
      const rest = oldLoader ? d.store.replace(oldLoader, "").replace(/^import[\s\S]*?from "[^"]+";\n/gm, "") : null;
      const outside = sc.study.filter((x) => !(x.inImport || x.fn === "loadStudyForRun"));
      const inLoader = sc.writes.filter((w) => w.fn === "loadStudyForRun");
      return {
        ok:
          /\.select\(/.test(text) &&
          /\.from\(tisProjectsTable\)/.test(text) &&
          outside.length === 0 &&
          inLoader.length === 0 &&
          rest !== null &&
          !/tisProjectsTable|requestPayload|resultPayload/.test(rest) &&
          !/\.(update|insert|delete)\(/.test(oldLoader),
        where: [
          ...outside.map((x) => fmtAt("store", x, `${x.name} outside loadStudyForRun${x.fn ? ` (in ${x.fn})` : ""}`)),
          ...inLoader.map((w) => fmtWrite("store", w)),
          ...(rest !== null && /tisProjectsTable|requestPayload|resultPayload/.test(rest) ? textHits("store", d.src.store, /tisProjectsTable|requestPayload|resultPayload/).filter((h) => !h.includes(":1")) : []),
          ...(/\.(update|insert|delete)\(/.test(oldLoader) ? [`${pathOf("store")}: a .update( / .insert( / .delete( in the text of loadStudyForRun (text scan)`] : []),
          ...(/\.select\(/.test(text) && /\.from\(tisProjectsTable\)/.test(text) ? [] : [`${pathOf("store")}:${lineAt(d.src.store, loader.getStart())}: loadStudyForRun no longer selects from tisProjectsTable`]),
        ],
      };
    },
  },
  {
    id: "store-no-raw-study-sql",
    on: "store",
    msg: "no raw SQL in the store has a write's shape, in any letter case and with comments between the words — no UPDATE .. SET or UPDATE of a table-like target, INSERT INTO, DELETE FROM, TRUNCATE, ON CONFLICT .. DO UPDATE, MERGE INTO, DROP TABLE / SCHEMA / OWNED, ALTER TABLE, COPY .. FROM or SELECT .. INTO in any string, template or `+` chain of them, read for SQL shape with this schema's table names (FOR UPDATE row locking exempt; prose such as \"update failed\" is not SQL, prose in a SQL shape is refused; what is not read is listed at rawSqlWrites) — and none names tis_projects: the builder scans above cannot see SQL text",
    test: (d) => {
      const raw = rawSqlWrites(d.src.store, d.schemaRead.prose);
      // the old text scans, kept as extra conjuncts (they read the code too, not only literals)
      const text = [/tis_projects/i, /(?<!FOR\s)\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\b/];
      return {
        ok: d.store.length > 0 && raw.length === 0 && text.every((re) => !re.test(d.store)),
        where: [...raw.map((h) => fmtRawSql("store", h)), ...text.flatMap((re) => textHits("store", d.src.store, re))],
      };
    },
  },
  // The raw-SQL scans of the store, the runner and the routes read a table with no underscore and no dot as a
  // table only when the schema declares it, so a table the reader cannot name is one a bare-alias write passes on.
  {
    id: "schema-tables-are-read",
    on: "schema",
    msg: "the raw-SQL scans know every table lib/db/src/schema declares: in every .ts file under it at any depth, every pgTable call (by its own name, by any name an import gives it, or as a property such as pg.pgTable or pg[\"pgTable\"]) names its table with a string literal, pgTable is used only by direct calls, pgTableCreator and pgSchema are not used, and the names with neither an underscore nor a dot include firms and users",
    test: (d) => {
      const r = d.schemaRead;
      const usable = schemaNamesUsable(r.prose);
      return {
        ok: Object.keys(d.schema).length > 0 && r.unread.length === 0 && usable,
        where: [
          ...r.unread.map((u) => `lib/db/src/schema/${u}`),
          ...(usable ? [] : [`lib/db/src/schema: read ${r.tables.length} table name(s) from ${Object.keys(d.schema).length} file(s); with no underscore: ${JSON.stringify(r.prose)} (firms and users must be among them)`]),
        ],
      };
    },
  },

  {
    id: "panel-read-serves-every-finding",
    on: "store",
    msg: `latestRunForProject serves every finding of the run, whatever its audience: its findings read is exactly \`${FINDINGS_READ}\` (once), it never names \`audience\`, \`findings\` is its one binding of that name and is read only through list reads that change nothing, it writes through no property or element, and it returns \`${LATEST_RETURN}\` or null — an audience filter here (in the WHERE, in JS, or by relabelling) makes GET's withheld 0 and the panel show a false clear`,
    test: (d) => {
      const fn = functionNamed(d.src.store, "latestRunForProject");
      const b = body(d.store, "latestRunForProject");
      if (!fn || !b) return false;
      const u = bindingUses(fn, "findings", LIST_READS);
      const w = propertyWrites(fn);
      return {
        ok:
          occ(b, FINDINGS_READ) === 1 &&
          !/\baudience\b/.test(b) &&
          u.decls.length === 1 &&
          u.other.length === 0 &&
          w.length === 0 &&
          occ(b, "return ") === 2 &&
          has(b, "if (!run) return null;") &&
          has(b, LATEST_RETURN),
        where: [...u.other.map((t) => `${pathOf("store")}: findings used as: ${t}`), ...w.map((t) => `${pathOf("store")}: writes: ${t}`)],
      };
    },
  },
  {
    id: "panel-read-names-the-carry-source",
    on: "store",
    msg: `latestRunForProject reads the revision this run's carry read its decisions from with the runner's own call — \`${PREVIOUS_READ}\`, once, after its firm-scoped run read — and hands it back unchanged as \`previous\` in its return, so GET's rulesChanged answers about the same revision the carry compared: another function, other arguments, or a second copy of the query would let the panel's explanation and the carry disagree`,
    test: (d) => {
      const fn = functionNamed(d.src.store, "latestRunForProject");
      const b = body(d.store, "latestRunForProject");
      if (!fn || !b) return false;
      const u = bindingUses(fn, "previous", new Set());
      return (
        occ(b, PREVIOUS_READ) === 1 &&
        occ(b, "previousRunForProject(") === 1 &&
        inOrder(b, ["if (!run) return null;", PREVIOUS_READ, "return {"]) &&
        /return\{(?:[^{}]*,)?previous(?:,[^{}]*)?\};/.test(sq(b)) &&
        u.decls.length === 1 &&
        u.other.length === 0
      );
    },
  },
  {
    id: "findings-written-with-their-audience",
    on: "store",
    msg: "completeRun writes each finding with its own audience: `audience: f.audience` inside `.values(args.findings.map((f) => ({ … })))`, the only audience it names — the column defaults to 'engineer' (so tsc is silent without it), and then every DEFECT is served to the engineer with its full text and withheld counts 0",
    test: (d) => {
      const b = sq(body(d.store, "completeRun"));
      return b.includes(sq(".values( args.findings.map((f) => ({")) && b.split("audience:").length - 1 === 1 && /audience:f\.audience[,}]/.test(b);
    },
  },
  {
    id: "audience-lookup-is-firm-scoped",
    on: "store",
    msg: "findingAudienceForFirm joins the finding to its run and matches the finding id AND the owning FIRM in one conjunction — an `or`, or a missing firm arm, reads the audience of another firm's finding",
    test: (d) =>
      has(
        body(d.store, "findingAudienceForFirm"),
        ".innerJoin(studyProofreadRunsTable, eq(studyProofreadFindingsTable.runId, studyProofreadRunsTable.id)) .where(and(eq(studyProofreadFindingsTable.id, findingId), eq(studyProofreadRunsTable.firmId, firmId))) .limit(1);",
      ),
  },
  {
    id: "audience-lookup-fails-closed",
    on: "store",
    msg: "findingAudienceForFirm is one read and the row it read: `const [row] = await db.select({ audience: studyProofreadFindingsTable.audience, type: studyProofreadFindingsTable.type }).from(studyProofreadFindingsTable).innerJoin(…).where(…).limit(…);` then `return row ?? null;` — no statement between them, no other link, no remap — so it answers the audience and type columns as stored, and null, never a default audience or type, for a finding that is not the firm's: a default of 'engineer' would let an unknown finding pass the very test that refuses the hidden ones, and a default or rewritten type would pick which decisions it is offered (a BLOCKER rewritten to NOTE is offered DISCLOSED)",
    test: (d) =>
      rowReadIs(
        body(d.store, "findingAudienceForFirm"),
        "findingAudienceForFirm( firmId: string, findingId: string, ): Promise<{ audience: string; type: string } | null>",
        ["select", "from", "innerJoin", "where", "limit"],
        "{ audience: studyProofreadFindingsTable.audience, type: studyProofreadFindingsTable.type }",
        "studyProofreadFindingsTable",
      ),
  },

  {
    id: "latest-run-status-is-the-firms-newest",
    on: "store",
    msg: "latestRunStatusForProject reads the run table where the FIRM and the project match in one conjunction, newest revision first, one row — an `or` or a missing firm arm answers with another firm's run, and any other order calls an older run the newest, so the 409 would let a decision land on a superseded run",
    test: (d) =>
      has(
        body(d.store, "latestRunStatusForProject"),
        ".from(studyProofreadRunsTable) .where(and(eq(studyProofreadRunsTable.firmId, firmId), eq(studyProofreadRunsTable.projectId, projectId))) .orderBy(desc(studyProofreadRunsTable.revision)) .limit(1);",
      ),
  },
  {
    id: "latest-run-status-fails-closed",
    on: "store",
    msg: "latestRunStatusForProject is one read and the row it read: `const [row] = await db.select({ id: studyProofreadRunsTable.id, status: studyProofreadRunsTable.status }).from(studyProofreadRunsTable).where(…).orderBy(…).limit(…);` then `return row ?? null;` — no statement between them, no other link, no remap — so it answers the run's id and status as stored, and null, never a default run or status, when the firm has no run of that project (the route then refuses with 409); a status rewritten after the read (to rules_ready, say) lets a decision through the 409 onto an unfinished run",
    test: (d) =>
      rowReadIs(
        body(d.store, "latestRunStatusForProject"),
        "latestRunStatusForProject( firmId: string, projectId: string, ): Promise<{ id: string; status: string } | null>",
        ["select", "from", "where", "orderBy", "limit"],
        "{ id: studyProofreadRunsTable.id, status: studyProofreadRunsTable.status }",
        "studyProofreadRunsTable",
      ),
  },

  // --- proofread-run.ts: the runner the routes call into -------------------
  {
    id: "runner-has-no-db-writes",
    on: "runner",
    msg: "the runner's OWN code has no database write in any spelling, names no study table or payload, has no `db` of its own, has no raw SQL in a write's shape in any string or template (any letter case; the shapes are listed at rawSqlWrites), and its @workspace/db import is type-only; that it reaches the database only through the store is the import whitelist's claim, not this scan's",
    test: (d) => {
      const sc = dbScan(d.src.runner);
      const raw = rawSqlWrites(d.src.runner, d.schemaRead.prose);
      const dbNames = importsOf(d.src.runner)["@workspace/db"] ?? [];
      // the old substring scan, kept as an extra conjunct ("study.requestPayload.rows" and
      // "see tisProjectsTable" are strings no identifier match sees)
      const text = /tisProjectsTable|requestPayload|resultPayload|\.update\(|\.insert\(|\.delete\(|\bdb\./;
      const typeOnly = dbNames.length > 0 && dbNames.every((n) => n.startsWith("type "));
      return {
        ok: d.runner.length > 0 && typeOnly && sc.writes.length === 0 && sc.study.length === 0 && sc.dbIdents.length === 0 && raw.length === 0 && !text.test(d.runner),
        where: [
          ...(typeOnly ? [] : [`${pathOf("runner")}: the @workspace/db import is not type-only: ${JSON.stringify(dbNames)}`]),
          ...sc.writes.map((w) => fmtWrite("runner", w)),
          ...sc.study.map((x) => fmtAt("runner", x, x.name)),
          ...sc.dbIdents.map((x) => fmtAt("runner", x, "db")),
          ...raw.map((h) => fmtRawSql("runner", h)),
          ...textHits("runner", d.src.runner, text),
        ],
      };
    },
  },
  {
    id: "runner-import-whitelist",
    on: "runner",
    msg: "the runner imports exactly the modules AND NAMES it needs (node:fs, node:path, the type-only StudyProofreadRun, the logger, the two pure proofread/ modules and the six store functions) in whatever spelling (read from the TypeScript AST), with no re-export, side-effect import, dynamic import, require, createRequire, getBuiltinModule, eval, Function or read of .constructor (but .constructor.name) — so it reaches the database only through the store, and `import { setProjectTheme } from \"./tis-projects\"` called after the clause pass (which compiled and left every other guard green while rewriting a tis_projects row) fails here",
    test: (d) => ({ ok: d.runner.length > 0 && importsEqual(importsOf(d.src.runner), RUNNER_IMPORTS), where: importDiff("runner", d.src.runner, RUNNER_IMPORTS) }),
  },
  {
    id: "proofread-dir-imports-whitelist",
    on: "clauseDir",
    msg: "every file under src/lib/proofread/ — the pure directory the store and the runner import, and so a way to reach a write without it appearing in either — imports only its own siblings, the dependency-free @workspace/tis-engine-core, and types from @workspace/tis-api-zod: no database, no node module, no other lib file, and no dynamic import(), require, eval, createRequire, getBuiltinModule or read of .constructor (but .constructor.name), of ANY specifier (a literal one included)",
    test: (d) => {
      const files = Object.keys(d.clauseDir);
      const allowed = (mod, name) => {
        if (mod.startsWith("<")) return false;
        // the clause layer is pure and never loads anything at run time: a literal
        // import("./types.ts") is as much a dynamic import as a computed one
        if (name === "<dynamic import>" || name === "<require>" || name === "<eval>" || name === "<import = require>") return false;
        if (/^\.\/[\w-]+\.ts$/.test(mod)) return files.includes(mod.slice(2));
        if (mod === "@workspace/tis-engine-core") return true;
        if (mod === "@workspace/tis-api-zod") return name === null || name.startsWith("type ");
        return false;
      };
      const bad = files.flatMap((f) => importEntries(d.src.clauseDir[f]).filter((e) => !allowed(e.mod, e.name)).map((e) => `${pathOf(f)}:${e.line}: ${e.name ?? "an import"} from ${e.mod}`));
      return { ok: files.length >= 8 && bad.length === 0, where: bad };
    },
  },

  // --- tis-projects.ts: the existence check --------------------------------
  {
    id: "exists-is-firm-scoped",
    on: "tisProjects",
    msg: "projectExistsForFirm matches the id AND the firm in one conjunction — an `or`, or a missing arm, answers yes for another firm's project",
    test: (d) =>
      has(
        body(d.tisProjects, "projectExistsForFirm"),
        ".where(and(eq(tisProjectsTable.id, id), eq(tisProjectsTable.firmId, firmId))) .limit(1); return !!row;",
      ),
  },
  {
    id: "exists-selects-the-id-only",
    on: "tisProjects",
    msg: "projectExistsForFirm selects the id column and nothing else: the panel polls this, and getProject drags both jsonb study payloads out of Postgres each time",
    test: (d) =>
      has(
        body(d.tisProjects, "projectExistsForFirm"),
        "export async function projectExistsForFirm(firmId: string, id: string): Promise<boolean> { const [row] = await db .select({ id: tisProjectsTable.id }) .from(tisProjectsTable)",
      ),
  },

  // --- security.ts: the limiters -------------------------------------------
  {
    id: "limiters-exist",
    on: "security",
    msg: "proofreadRunLimiter, proofreadDispositionLimiter and proofreadReadLimiter are each exported from security.ts as rateLimit({ ... })",
    test: (d) => limiterBlocks(d).every((b) => b.length > 0),
  },
  {
    id: "limiters-pin-draft-7",
    on: "security",
    msg: 'all three limiters pin standardHeaders: "draft-7", like every existing one (`true` silently emits different headers)',
    test: (d) => allLimiters(d, (b) => has(b, 'standardHeaders: "draft-7"')),
  },
  {
    id: "limiters-legacy-and-fail-open",
    on: "security",
    msg: "all three limiters set legacyHeaders: false and passOnStoreError: true (a Redis outage must not take the panel down)",
    test: (d) => allLimiters(d, (b) => has(b, "legacyHeaders: false") && has(b, "passOnStoreError: true")),
  },
  {
    id: "limiters-keyed-per-user",
    on: "security",
    msg: "all three limiters are keyed per user, falling back to ipKeyGenerator(req.ip ?? \"\") — raw req.ip loses express-rate-limit v8's IPv6 bucketing",
    test: (d) =>
      allLimiters(d, (b) => {
        const key = 'keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip ?? "")';
        return has(b, key) && !/\breq\.ip\b/.test(b.replace('ipKeyGenerator(req.ip ?? "")', ""));
      }),
  },
  {
    id: "limiters-have-own-prefixes",
    on: "security",
    msg: "each limiter has its own Redis prefix under rl:proofread, distinct from the other two and from every other prefix in the file — a shared prefix is a shared counter, so triage would spend the re-run budget",
    test: (d) => {
      const mine = limiterBlocks(d).map(storePrefixOf);
      const all = [...d.security.matchAll(/makeRateLimitStore\("([^"]+)"\)/g)].map((m) => m[1]);
      return (
        mine.every((p) => p.startsWith("rl:proofread")) &&
        new Set(mine).size === 3 &&
        new Set(all).size === all.length
      );
    },
  },
  {
    id: "limiters-exempt-dev-and-admin",
    on: "security",
    msg: "all three limiters carry whatIfRateLimiter's skip: dev auth and admin emails are exempt, so demoing the feature does not 429 the operator",
    test: (d) =>
      allLimiters(d, (b) =>
        has(
          b,
          'skip: (req) => { if (process.env.DEV_AUTH_ENABLED === "true") return true; const email = req.user?.email; return !!email && isAdminEmail(email); }',
        ),
      ),
  },
  {
    id: "triage-limit-exceeds-run-limit",
    on: "security",
    msg: "triage has a larger budget than re-running over the same window: a run that produces more findings than the run limit must not lock an engineer out of recording decisions or re-running",
    test: (d) => {
      const [run, disp] = [limiterBlock(d.security, "proofreadRunLimiter"), limiterBlock(d.security, "proofreadDispositionLimiter")];
      return run.length > 0 && disp.length > 0 && windowOf(run) === windowOf(disp) && limitOf(disp) > limitOf(run);
    },
  },
  {
    id: "no-boolean-standard-headers",
    on: "security",
    msg: 'no limiter anywhere in security.ts says `standardHeaders: true` (fourteen existing ones pin "draft-7")',
    test: (d) => d.security.length > 0 && !/standardHeaders:\s*true/.test(d.security),
  },
  {
    id: "copy-limiters",
    on: "security",
    msg: "the proofread limiters' 429 messages avoid the banned phrases",
    test: (d) => allLimiters(d, (b) => !BANNED_COPY.test(b)),
  },
];

const ids = CHECKS.map((c) => c.id);
ok(new Set(ids).size === ids.length, "precondition: every check id is unique (a duplicate would hide one of them in the teeth pass)");

// Sanity on the comment stripper itself: a quote inside a regex literal would
// flip it into string mode and swallow the rest of the file.
{
  const sec = stripComments(sources.security);
  const bal = (s, a, b) => s.split(a).length === s.split(b).length;
  ok(bal(sec, "{", "}") && bal(sec, "(", ")"), "precondition: security.ts strips cleanly (braces and parens balance), so the limiter blocks are read whole");
  const rt = stripComments(sources.routes);
  ok(bal(rt, "{", "}") && bal(rt, "(", ")"), "precondition: routes/proofread.ts strips cleanly (braces and parens balance)");
}

// A check's test returns a boolean, or { ok, where } where `where` lists the `file:line: what`
// of each thing that fired. A check that throws is a failure, never a pass.
const verdict = (c, d) => {
  try {
    const r = c.test(d);
    return r !== null && typeof r === "object" ? { ok: !!r.ok, where: r.ok ? [] : (r.where ?? []) } : { ok: !!r, where: [] };
  } catch (err) {
    return { ok: false, where: [`the check threw: ${err?.message ?? err}`] };
  }
};
const run = (s) => {
  const d = derive(s);
  return CHECKS.filter((c) => !verdict(c, d).ok).map((c) => c.id);
};
const failing = run(sources);
{
  const d = derive(sources);
  for (const c of CHECKS) {
    const v = verdict(c, d);
    ok(v.ok, c.msg, v.where.length ? v.where : undefined);
  }
}

// ---------------------------------------------------------------------------
// Teeth. Each mutation breaks one protected property in the in-memory source.
// `flips` names the checks that MUST notice it; `also` documents the checks the
// same edit knocks over on the way, so the red set is asserted EXACTLY and a
// mutation cannot quietly stop testing what it was written for. The last
// assertion of each keeps it honest about its file: a routes mutation that
// flips a check declared about the store means that check reads the wrong file.
// ---------------------------------------------------------------------------
const edit = (file, from, to) => (s) => ({ ...s, [file]: s[file].replace(from, to) });
/** Replace the first `from` found AFTER `marker` — the three limiters share most of their lines. */
const editAfter = (file, marker, from, to) => (s) => {
  const m = s[file].indexOf(marker);
  if (m < 0) return s;
  const i = s[file].indexOf(from, m);
  if (i < 0) return s;
  return { ...s, [file]: s[file].slice(0, i) + to + s[file].slice(i + from.length) };
};
/** Replace the nth (0-based) match of a global regex. */
const editNth = (file, re, n, to) => (s) => {
  const hits = [...s[file].matchAll(re)];
  const h = hits[n];
  if (!h) return s;
  return { ...s, [file]: s[file].slice(0, h.index) + to + s[file].slice(h.index + h[0].length) };
};
const editDir = (name, from, to) => (s) => ({ ...s, clauseDir: { ...s.clauseDir, [name]: s.clauseDir[name].replace(from, to) } });
const chain = (...fns) => (s) => fns.reduce((acc, f) => f(acc), s);
/** Edit one schema file (a path under lib/db/src/schema), or add one. An edit of a file that is not there changes nothing. */
const editSchema = (name, from, to) => (s) => (name in s.schema ? { ...s, schema: { ...s.schema, [name]: s.schema[name].replace(from, to) } } : s);
const addSchema = (name, text) => (s) => ({ ...s, schema: { ...s.schema, [name]: text } });
const GUARD_RE = /    if \(!\(await projectExistsForFirm\(firm\.id, id\)\)\) \{\n      res\.status\(404\)\.json\(\{ error: "Project not found\." \}\);\n      return;\n    \}\n/g;
const ENQUEUE_LINE = "    await enqueueProofread({ projectId: id, firmId: firm.id, userId: user.id });\n";
const LIMITER_PROPS = ["limiters-pin-draft-7", "limiters-legacy-and-fail-open", "limiters-keyed-per-user", "limiters-have-own-prefixes", "limiters-exempt-dev-and-admin", "triage-limit-exceeds-run-limit", "copy-limiters"];
const BASE_AUTH_GET = '  if (!req.isAuthenticated()) {\n    res.status(401).json({ error: "Sign in to view this check." });\n    return;\n  }\n';

// A failure names the file and line of what fired. Pinned on the real sources: a write
// placed at a known line must be reported at that line, by each kind of finding. Like the
// mutations below it edits the real files at fixed anchors, so it is a teeth line.
{
  const lineOfText = (raw, needle) => lineAt(raw, raw.indexOf(needle));
  const at = (file, needle, mutate, checkId) => {
    const mutated = mutate(sources);
    const v = verdict(CHECKS.find((c) => c.id === checkId), derive(mutated));
    const text = mutated[file] ?? mutated.clauseDir[file];
    const want = `${pathOf(file)}:${lineOfText(text, needle)}:`;
    return { ok: !v.ok && v.where.some((w) => w.startsWith(want)), want, where: v.where };
  };
  const ANCHOR = "  if (args.findings.length === 0) return;";
  const cases = [
    at("store", "Delete From", edit("store", ANCHOR, "  await db.execute(sql`Delete From study_proofread_dispositions`);\n" + ANCHOR), "store-no-raw-study-sql"),
    at("store", "delete(studyProofreadRunsTable)", edit("store", ANCHOR, "  await db\n    .delete(studyProofreadRunsTable);\n" + ANCHOR), "store-dispositions-are-append-only"),
    at("store", "update(studyProofreadFindingsTable)", edit("store", ANCHOR, "  await db.update(studyProofreadFindingsTable).set({});\n" + ANCHOR), "store-writes-only-proofread-tables"),
    at("runner", "delete from", edit("runner", "    const rec: StudyRecord", '    const q = "delete from t";\n    const rec: StudyRecord'), "runner-has-no-db-writes"),
    at("routes", "TRUNCATE", edit("routes", "const router: IRouter = Router();", 'const router: IRouter = Router();\nconst q = "TRUNCATE t";'), "routes-do-not-touch-study"),
    at("store", "setProjectTheme", edit("store", 'import { logger } from "./logger";', 'import { logger } from "./logger";\nimport { setProjectTheme } from "./tis-projects";'), "store-import-whitelist"),
    at("runner", "getBuiltinModule", edit("runner", "    const rec: StudyRecord", '    void process.getBuiltinModule("fs");\n    const rec: StudyRecord'), "runner-import-whitelist"),
    at("routes", "createRequire", edit("routes", "const router: IRouter = Router();", 'const router: IRouter = Router();\nimport { createRequire } from "node:module";'), "routes-import-whitelist"),
    at("fingerprint.ts", "constructor", (s) => ({ ...s, clauseDir: { ...s.clauseDir, "fingerprint.ts": s.clauseDir["fingerprint.ts"].replace('import type { ProofreadFinding } from "./types.ts";', 'import type { ProofreadFinding } from "./types.ts";\nvoid (() => 0).constructor("return this");') } }), "proofread-dir-imports-whitelist"),
  ];
  const bad = cases.filter((c) => !c.ok);
  ok(bad.length === 0, "teeth: a red names the file and line of what fired (raw SQL, a delete split over two lines, a verb a table does not allow, the runner's and the routes' scans, and each of the four import whitelists)", bad.map((c) => `wanted ${c.want} in: ${JSON.stringify(c.where)}`));
}

// Code that must stay GREEN: query RESULTS are data, and a helper's parameter is its own
// variable, whatever it is called. Each is applied to the real file and must leave every
// check as it was; round 3's name-wide taint turned each of these red.
const SEL = "await db.select().from(studyProofreadRunsTable).where(eq(studyProofreadRunsTable.id, args.runId))";
const LEGIT = [
  ["a row spread into an insert of the store's own run table", `const [row] = ${SEL}; await db.insert(studyProofreadRunsTable).values({ ...row, status: "queued" } as any);`],
  ["the last row by length - 1", `const rows = ${SEL}; void rows[rows.length - 1];`],
  ["a row indexed by a const", `const rows = ${SEL}; const idx = 2; void rows[idx];`],
  ["Object.keys and Object.entries of a row", `const [row] = ${SEL}; void Object.keys(row ?? {}); for (const [k, v] of Object.entries(row ?? {})) void [k, v];`],
  ["Object.fromEntries of rows.map", `const rows = ${SEL}; void Object.fromEntries(rows.map((r) => [r.id, r]));`],
  ["a sorted copy of rows", `const rows = ${SEL}; void [...rows].sort((a, b) => a.revision - b.revision);`],
  ["a column read by a computed key", `const [row] = ${SEL}; const col = args.status; void (row as any)?.[col];`],
  ["a query built, then awaited, then indexed (awaiting a builder yields rows)", "const qb = db.select().from(studyProofreadRunsTable); const rows = await qb; const i = rows.length - 1; void rows[i];"],
  ["a transaction that inserts and updates the run table", "await db.transaction(async (tx) => { const [r] = await tx.select().from(studyProofreadRunsTable).where(eq(studyProofreadRunsTable.id, args.runId)); if (r) await tx.update(studyProofreadRunsTable).set({ attempts: r.attempts }).where(eq(studyProofreadRunsTable.id, r.id)); });"],
  // a transaction whose callback hands back a bare builder: the transaction awaits it, so what
  // comes back is rows (round 5 found these refused)
  ["a concise transaction that returns a select builder, its rows indexed, spread and keyed", "const rows = await db.transaction(async (tx) => tx.select().from(studyProofreadRunsTable).where(eq(studyProofreadRunsTable.id, args.runId))); const i = rows.length - 1; void rows[i]; void { ...rows[0] }; void Object.keys(rows[0] ?? {}); const out: Record<string, unknown> = {}; for (const r of rows) out[r.id] = { ...r };"],
  ["a concise transaction that returns an update's returning(), the row spread", "const [r2] = await db.transaction(async (tx) => tx.update(studyProofreadRunsTable).set({ attempts: 1 }).where(eq(studyProofreadRunsTable.id, args.runId)).returning()); void { ...r2 };"],
  ["a transaction whose block returns a select builder, its rows indexed", "const rows = await db.transaction(async (tx) => { return tx.select().from(studyProofreadRunsTable).where(eq(studyProofreadRunsTable.id, args.runId)); }); void rows[rows.length - 1];"],
].map(([what, code]) => ({ label: `store completeRun: ${what}`, file: "store", apply: edit("store", "  if (args.findings.length === 0) return;", `  { ${code} }\n  if (args.findings.length === 0) return;`) }));
LEGIT.push(
  { label: "carryForwardDispositions: the prior row spread into the insert", file: "store", apply: edit("store", "    await db.insert(studyProofreadDispositionsTable).values({\n      findingId: nf.id,\n      disposition: prior[0].disposition,\n      note: prior[0].note,\n      sourceLabel: prior[0].sourceLabel,\n      actorUserId: prior[0].actorUserId,\n      createdAt: prior[0].createdAt,\n    });", "    await db.insert(studyProofreadDispositionsTable).values({ ...prior[0], findingId: nf.id } as any);") },
  { label: "carryForwardDispositions: prior[prior.length - 1]", file: "store", apply: edit("store", "    if (!prior[0]) continue;", "    if (!prior[0]) continue;\n    void prior[prior.length - 1];") },
  { label: "latestRunForProject: [...findings].sort()", file: "store", apply: edit("store", "  const dispositions = findings.length", "  const sortedF = [...findings].sort((a, b) => a.id.localeCompare(b.id)); void sortedF;\n  const dispositions = findings.length") },
  ...[
    "function firstN(findings: ProofreadFinding[], n: number): ProofreadFinding[] { const out: ProofreadFinding[] = []; for (let i = 0; i < n; i++) out.push(findings[i]!); return out; }",
    "function pick(run: Record<string, unknown>, key: string): unknown { return run[key]; }",
    "function withStatus(row: Record<string, unknown>) { return { ...row, status: 'x' }; }",
    "function count(dispositions: Record<string, number>): number { let n = 0; for (const k in dispositions) n += dispositions[k]!; return n; }",
    "function second(prior: number[], i: number) { return prior[i]; }",
  ].map((fn) => ({ label: `a module-level helper whose parameter shares a name with a query result elsewhere: ${fn.slice(9, fn.indexOf("("))}`, file: "store", apply: edit("store", "export async function insertQueuedRun(args: {", `${fn}\n\nexport async function insertQueuedRun(args: {`) })),
  // a sentence that ends after the verb's object is not a schema-qualified name ("Failed to update project." is
  // the house-style 500, routes/projects.ts)
  { label: "routes: the house-style 500 message, \"Failed to update project.\"", file: "routes", apply: edit("routes", "const router: IRouter = Router();", 'const router: IRouter = Router();\nconst e500 = { error: "Failed to update project." }; void e500;') },
  { label: "store: a warning that says \"Failed to update run.\"", file: "store", apply: edit("store", "  if (args.findings.length === 0) return;", '  logger.warn("Failed to update run.");\n  if (args.findings.length === 0) return;') },
  { label: "runner: a message that says \"Could not update disposition.\"", file: "runner", apply: edit("runner", "    const rec: StudyRecord", '    const m5 = "Could not update disposition."; void m5;\n    const rec: StudyRecord') },
  { label: "runner: a local array called tx, indexed", file: "runner", apply: edit("runner", "    const rec: StudyRecord", "    const tx = ['a']; const i = 0; void tx[i];\n    const rec: StudyRecord") },
  { label: "routes: a local array called tx, indexed", file: "routes", apply: edit("routes", "const router: IRouter = Router();", "const router: IRouter = Router();\nconst tx = ['a']; const i = 0; void tx[i];") },
  // a table the reader can name, however its pgTable call is spelled, is not refused as unread
  { label: "schema: a table added in a subdirectory through `pgTable as table`, a comment before its name", file: "schema", apply: addSchema("audit/audits.ts", 'import { integer, pgTable as table } from "drizzle-orm/pg-core";\nexport const auditsTable = table(/* the log */ "audits", { id: integer("id") });\n') },
);

const MUTATIONS = [
  // ---- routes: surface ----------------------------------------------------
  {
    label: "register a PATCH on the run path (a route that could change something) with its own auth check",
    file: "routes",
    flips: ["surface-is-three-routes"],
    apply: edit(
      "routes",
      "export default router;",
      'router.patch("/projects/:id/proofread", proofreadRunLimiter, async (req, res): Promise<void> => {\n  if (!req.isAuthenticated()) {\n    res.status(401).json({ error: "Sign in required." });\n    return;\n  }\n  res.json({ ok: true });\n});\n\nexport default router;',
    ),
  },
  {
    label: "register an unauthenticated DELETE",
    file: "routes",
    flips: ["surface-is-three-routes", "handlers-authenticate-first"],
    also: ["routes-do-not-touch-study"],
    apply: edit("routes", "export default router;", 'router.delete("/projects/:id/proofread", proofreadRunLimiter, async (_req, res): Promise<void> => {\n  res.json({ ok: true });\n});\n\nexport default router;'),
  },
  {
    label: "stop mounting the router in routes/index.ts",
    file: "routesIndex",
    flips: ["routes-registered"],
    apply: edit("routesIndex", "router.use(proofreadRouter);", ""),
  },
  {
    label: "drop the router import from routes/index.ts",
    file: "routesIndex",
    flips: ["routes-registered"],
    apply: edit("routesIndex", 'import proofreadRouter from "./proofread";', ""),
  },

  // ---- routes: limiters ---------------------------------------------------
  {
    label: "bind triage to the run limiter",
    file: "routes",
    flips: ["limiter-per-route"],
    apply: edit("routes", "  proofreadDispositionLimiter,\n  async (req, res)", "  proofreadRunLimiter,\n  async (req, res)"),
  },
  {
    label: "bind the polled read to the run limiter",
    file: "routes",
    flips: ["limiter-per-route"],
    apply: edit("routes", 'router.get("/projects/:id/proofread", proofreadReadLimiter,', 'router.get("/projects/:id/proofread", proofreadRunLimiter,'),
  },
  {
    label: "reuse the engine's generateRateLimiter on the run route",
    file: "routes",
    flips: ["limiter-per-route", "routes-use-only-proofread-limiters"],
    apply: edit("routes", 'router.post("/projects/:id/proofread", proofreadRunLimiter,', 'router.post("/projects/:id/proofread", generateRateLimiter,'),
  },
  {
    label: "drop the limiter from the disposition route",
    file: "routes",
    flips: ["limiter-per-route"],
    apply: edit("routes", "  proofreadDispositionLimiter,\n  async (req, res)", "  async (req, res)"),
  },

  // ---- routes: authentication --------------------------------------------
  {
    label: "remove the auth check from the read handler",
    file: "routes",
    flips: ["handlers-authenticate-first"],
    apply: edit("routes", BASE_AUTH_GET, ""),
  },
  {
    label: "remove the auth check from the disposition handler",
    file: "routes",
    flips: ["handlers-authenticate-first"],
    apply: edit("routes", '    if (!req.isAuthenticated()) {\n      res.status(401).json({ error: "Sign in required." });\n      return;\n    }\n    const parsed', "    const parsed"),
  },
  {
    label: "let the 401 branch of the read handler fall through (no return)",
    file: "routes",
    flips: ["handlers-authenticate-first"],
    apply: edit("routes", 'res.status(401).json({ error: "Sign in to view this check." });\n    return;', 'res.status(401).json({ error: "Sign in to view this check." });'),
  },

  // ---- routes: where the firm and the body come from ----------------------
  {
    label: "take the firm for the enqueue from the request body",
    file: "routes",
    flips: ["firm-from-session", "body-only-through-contract", "run-existence-before-enqueue"],
    apply: edit("routes", "firmId: firm.id, userId: user.id", "firmId: String(req.body?.firmId ?? firm.id), userId: user.id"),
  },
  {
    label: "enqueue under the user's id as the firm",
    file: "routes",
    flips: ["firm-from-session", "run-existence-before-enqueue"],
    apply: edit("routes", "firmId: firm.id, userId: user.id", "firmId: user.id, userId: user.id"),
  },
  {
    label: "resolve the firm from the URL instead of the session in the read handler",
    file: "routes",
    flips: ["firm-from-session", "get-existence-before-read"],
    apply: edit("routes", "getOrCreateFirmForUser(user.id, {", "getOrCreateFirmForUser(String(req.params.id), {"),
  },
  {
    label: "read the actor from the body in the disposition insert",
    file: "routes",
    flips: ["disposition-written-as-session-user", "body-only-through-contract"],
    apply: edit("routes", "actorUserId: user.id,", "actorUserId: String(req.body?.actorUserId ?? user.id),"),
  },
  {
    label: "insert against a finding id taken from the body rather than the one that was verified",
    file: "routes",
    flips: ["disposition-written-as-session-user", "body-only-through-contract"],
    apply: edit("routes", "      await insertDisposition({\n        findingId,", "      await insertDisposition({\n        findingId: String(req.body?.findingId ?? findingId),"),
  },
  {
    label: "read the query string",
    file: "routes",
    flips: ["body-only-through-contract"],
    apply: edit("routes", "const id = String(req.params.id);", "const id = String(req.params.id ?? req.query.id);"),
  },

  // ---- routes: GET --------------------------------------------------------
  {
    label: "drop the existence check from the read handler",
    file: "routes",
    flips: ["get-existence-before-read", "polled-read-avoids-getproject"],
    also: ["foreign-is-404-not-403"],
    apply: editNth("routes", GUARD_RE, 0, ""),
  },
  {
    label: "transpose the arguments of the read handler's existence check",
    file: "routes",
    flips: ["get-existence-before-read", "polled-read-avoids-getproject"],
    apply: edit("routes", "projectExistsForFirm(firm.id, id)", "projectExistsForFirm(id, firm.id)"),
  },
  {
    label: "answer 403 for a foreign project on the read handler",
    file: "routes",
    flips: ["foreign-is-404-not-403", "get-existence-before-read"],
    apply: editNth("routes", /res\.status\(404\)\.json\(\{ error: "Project not found\." \}\)/g, 1, 'res.status(403).json({ error: "Project not found." })'),
  },
  {
    label: "poll with getProject (both jsonb payloads on every read)",
    file: "routes",
    flips: ["get-existence-before-read", "polled-read-avoids-getproject"],
    apply: edit("routes", "await projectExistsForFirm(firm.id, id)", "await getProject(firm.id, id)"),
  },
  {
    label: "await the sweep inside the read handler",
    file: "routes",
    flips: ["get-sweep-is-detached"],
    apply: edit("routes", "void claimAndRunOne().catch(() => undefined);", "await claimAndRunOne();"),
  },
  {
    label: "detach the sweep without a catch",
    file: "routes",
    flips: ["get-sweep-is-detached"],
    apply: edit("routes", "void claimAndRunOne().catch(() => undefined);", "void claimAndRunOne();"),
  },
  {
    label: "sweep before the existence check (a foreign id could trigger compute)",
    file: "routes",
    flips: ["get-existence-before-read"],
    apply: chain(
      edit("routes", "    void claimAndRunOne().catch(() => undefined);\n", ""),
      edit("routes", "  try {\n    const user = req.user!;", "  try {\n    void claimAndRunOne().catch(() => undefined);\n    const user = req.user!;"),
    ),
  },
  {
    label: "serve admin-audience findings",
    file: "routes",
    flips: ["get-hides-admin-findings"],
    // `const visible = findings` hands the whole list on: that is a use get-withheld-is-a-count refuses too
    also: ["get-withheld-is-a-count"],
    apply: edit("routes", 'const visible = findings.filter((f) => f.audience !== "admin");', "const visible = findings;"),
  },
  {
    label: "invert the audience filter",
    file: "routes",
    flips: ["get-hides-admin-findings"],
    apply: edit("routes", 'f.audience !== "admin"', 'f.audience === "admin"'),
  },
  {
    label: "serve every disposition, including those of hidden findings",
    file: "routes",
    flips: ["get-hides-admin-findings"],
    apply: edit("routes", /dispositions\n        \.filter\(\(d\) => visibleIds\.has\(d\.findingId\)\)\n        \.map\(/, "dispositions.map("),
  },
  {
    label: "build the findings list from the unfiltered findings",
    file: "routes",
    flips: ["get-hides-admin-findings"],
    apply: edit("routes", "findings: visible.map(", "findings: findings.map("),
  },
  {
    label: "count the visible findings as withheld",
    file: "routes",
    flips: ["get-withheld-is-a-count"],
    apply: edit("routes", 'const withheld = findings.filter((f) => f.audience === "admin").length;', 'const withheld = findings.filter((f) => f.audience !== "admin").length;'),
  },
  {
    label: "count every finding as withheld",
    file: "routes",
    flips: ["get-withheld-is-a-count"],
    apply: edit("routes", 'const withheld = findings.filter((f) => f.audience === "admin").length;', "const withheld = findings.length;"),
  },
  {
    label: "send the withheld findings themselves under `withheld`",
    file: "routes",
    flips: ["get-withheld-is-a-count"],
    apply: edit("routes", 'const withheld = findings.filter((f) => f.audience === "admin").length;', 'const withheld = findings.filter((f) => f.audience === "admin");'),
  },
  {
    label: "send the withheld findings' clauses under `withheld`",
    file: "routes",
    flips: ["get-withheld-is-a-count"],
    apply: edit("routes", 'const withheld = findings.filter((f) => f.audience === "admin").length;', 'const withheld = findings.filter((f) => f.audience === "admin").map((f) => f.clauseId);'),
  },
  {
    label: "put something other than the count in the answer's `withheld`",
    file: "routes",
    flips: ["get-withheld-is-a-count"],
    apply: edit("routes", "      withheld,\n", '      withheld: findings.filter((f) => f.audience === "admin").map((f) => f.type),\n'),
  },
  {
    label: "drop `withheld` from the run's answer",
    file: "routes",
    flips: ["get-withheld-is-a-count", "get-answers-are-the-read-shape"],
    apply: edit("routes", "      withheld,\n", ""),
  },
  {
    label: "send each withheld finding's type beside the count",
    file: "routes",
    flips: ["get-answers-are-the-read-shape"],
    apply: edit("routes", "      withheld,\n", '      withheld,\n      withheldTypes: findings.filter((f) => f.audience === "admin").map((f) => f.type),\n'),
  },
  {
    label: "spread the run row into the answer",
    file: "routes",
    flips: ["get-answers-are-the-read-shape"],
    also: ["get-run-answer-is-the-run-row"],
    apply: edit("routes", "res.json({\n      status: run.status,", "res.json({\n      ...run,\n      status: run.status,"),
  },
  {
    label: "count the findings after dropping the admin ones from the list (re-bound from latest.findings)",
    file: "routes",
    flips: ["get-withheld-is-a-count"],
    apply: edit("routes", "    const { run, findings, dispositions, previous } = latest;\n", '    const { run, dispositions, previous } = latest;\n    const findings = latest.findings.filter(({ audience }) => audience !== "admin");\n'),
  },
  {
    label: "count the withheld findings after the visible list is filtered",
    file: "routes",
    flips: ["get-withheld-is-a-count"],
    apply: (s) => {
      const line = '    const withheld = findings.filter((f) => f.audience === "admin").length;\n';
      const after = "    const visibleIds = new Set(visible.map((f) => f.id));\n";
      return { ...s, routes: s.routes.replace(line, "").replace(after, after + line) };
    },
  },
  {
    label: "splice the admin findings out of the list before counting",
    file: "routes",
    flips: ["get-withheld-is-a-count"],
    apply: edit("routes", "    const { run, findings, dispositions, previous } = latest;\n", '    const { run, findings, dispositions, previous } = latest;\n    findings.splice(0, findings.length, ...findings.filter((f) => f.audience !== "admin"));\n'),
  },
  {
    label: "hand the findings list to a helper before counting",
    file: "routes",
    flips: ["get-withheld-is-a-count"],
    apply: edit("routes", "    const { run, findings, dispositions, previous } = latest;\n", "    const { run, findings, dispositions, previous } = latest;\n    void [findings].flat();\n"),
  },
  {
    label: "read the findings off `latest` a second time",
    file: "routes",
    flips: ["get-withheld-is-a-count"],
    apply: edit("routes", "    const visibleIds = new Set(", "    void latest.findings.length;\n    const visibleIds = new Set("),
  },
  {
    label: "relabel every DEFECT as the engineer's before counting",
    file: "routes",
    flips: ["get-writes-nothing-it-read"],
    apply: edit("routes", "    const { run, findings, dispositions, previous } = latest;\n", '    const { run, findings, dispositions, previous } = latest;\n    for (const f of findings) if (f.type === "DEFECT") f.audience = "engineer";\n'),
  },
  {
    label: "delete each finding's audience before counting",
    file: "routes",
    flips: ["get-writes-nothing-it-read"],
    apply: edit("routes", "    const { run, findings, dispositions, previous } = latest;\n", "    const { run, findings, dispositions, previous } = latest;\n    for (const f of findings) delete (f as { audience?: string }).audience;\n"),
  },
  {
    label: "Object.assign the engineer's audience onto each finding",
    file: "routes",
    flips: ["get-writes-nothing-it-read"],
    apply: edit("routes", "    const { run, findings, dispositions, previous } = latest;\n", '    const { run, findings, dispositions, previous } = latest;\n    for (const f of findings) Object.assign(f, { ["audience"]: "engineer" });\n'),
  },
  {
    label: "add a coverage entry for each withheld finding's clause",
    file: "routes",
    flips: ["get-run-answer-is-the-run-row"],
    apply: edit("routes", "      coverage: run.coverage,\n", '      coverage: [...(run.coverage as any[]), ...findings.filter((f) => f.audience === "admin").map((f) => ({ clauseId: f.clauseId, section: f.section, status: "ran" }))],\n'),
  },
  {
    label: "note in coverage which clause raised a withheld finding",
    file: "routes",
    flips: ["get-run-answer-is-the-run-row"],
    apply: edit("routes", "      coverage: run.coverage,\n", '      coverage: (run.coverage as any[]).map((c) => ({ ...c, ...(findings.some((f) => f.audience === "admin" && f.clauseId === c.clauseId) ? { note: "routed to the software team" } : {}) })),\n'),
  },
  {
    label: "say in the input manifest that a DEFECT was found",
    file: "routes",
    flips: ["get-run-answer-is-the-run-row"],
    apply: edit("routes", "      inputManifest: run.inputManifest,\n", '      inputManifest: { ...(run.inputManifest as object), defect: findings.some((f) => f.audience === "admin") },\n'),
  },
  {
    label: "answer a run carrying a withheld finding as still running",
    file: "routes",
    flips: ["get-run-answer-is-the-run-row"],
    apply: edit("routes", "      status: run.status,\n", '      status: withheld > 0 ? "running" : run.status,\n'),
  },
  {
    label: "answer from a copy of the run row with its coverage replaced",
    file: "routes",
    flips: ["get-run-answer-is-the-run-row"],
    apply: edit("routes", "    const { run, findings, dispositions, previous } = latest;\n", "    const { run: row, findings, dispositions, previous } = latest;\n    const run = { ...row, coverage: [] };\n"),
  },
  {
    label: "Object.assign an empty coverage onto the run row",
    file: "routes",
    flips: ["get-writes-nothing-it-read"],
    also: ["get-run-answer-is-the-run-row"],
    apply: edit("routes", "    const { run, findings, dispositions, previous } = latest;\n", "    const { run, findings, dispositions, previous } = latest;\n    Object.assign(run, { coverage: [] });\n"),
  },
  {
    label: "answer rulesChanged: false whatever the rules were",
    file: "routes",
    flips: ["get-rules-changed-is-the-carry-gate"],
    apply: edit("routes", "const rulesChanged = previous !== null && previous.rulesVersion !== run.rulesVersion;", "const rulesChanged = false && previous !== null;"),
  },
  {
    label: "compare the previous run's rules version with this run's engine stamp",
    file: "routes",
    flips: ["get-rules-changed-is-the-carry-gate"],
    apply: edit("routes", "previous.rulesVersion !== run.rulesVersion", "previous.rulesVersion !== run.engineStamp"),
  },
  {
    label: "invert the rules comparison (rulesChanged when they are the same)",
    file: "routes",
    flips: ["get-rules-changed-is-the-carry-gate"],
    apply: edit("routes", "previous.rulesVersion !== run.rulesVersion", "previous.rulesVersion === run.rulesVersion"),
  },
  {
    label: "say the rules changed on a first run (no previous revision)",
    file: "routes",
    flips: ["get-rules-changed-is-the-carry-gate"],
    apply: edit("routes", "const rulesChanged = previous !== null && previous", "const rulesChanged = previous === null || previous"),
  },
  {
    label: "drop rulesChanged from the run's answer",
    file: "routes",
    flips: ["get-rules-changed-is-the-carry-gate", "get-answers-are-the-read-shape"],
    apply: edit("routes", "      rulesChanged,\n", ""),
  },
  {
    label: "tell a project with no run that the rules changed",
    file: "routes",
    flips: ["get-none-withholds-nothing"],
    apply: edit("routes", 'res.json({ status: "none", withheld: 0, rulesChanged: false,', 'res.json({ status: "none", withheld: 0, rulesChanged: true,'),
  },
  {
    label: "answer a project with no run without `withheld`",
    file: "routes",
    flips: ["get-none-withholds-nothing", "get-answers-are-the-read-shape"],
    apply: edit("routes", 'res.json({ status: "none", withheld: 0, rulesChanged: false, findings: [], coverage: [], dispositions: [] });', 'res.json({ status: "none", rulesChanged: false, findings: [], coverage: [], dispositions: [] });'),
  },
  {
    label: "tell a project with no run that one item is withheld",
    file: "routes",
    flips: ["get-none-withholds-nothing"],
    apply: edit("routes", 'res.json({ status: "none", withheld: 0,', 'res.json({ status: "none", withheld: 1,'),
  },
  {
    label: "echo run.error in the read response",
    file: "routes",
    flips: ["routes-never-echo-internals"],
    also: ["get-answers-are-the-read-shape", "get-run-answer-is-the-run-row"],
    apply: edit("routes", "finishedAt: run.finishedAt?.toISOString() ?? null,", "finishedAt: run.finishedAt?.toISOString() ?? null,\n      error: run.error,"),
  },
  {
    label: "echo each disposition's actor in the read response",
    file: "routes",
    flips: ["routes-never-echo-internals"],
    apply: edit("routes", "sourceLabel: d.sourceLabel,", "sourceLabel: d.sourceLabel,\n        actorUserId: d.actorUserId,"),
  },
  {
    label: "echo each finding's audience in the read response",
    file: "routes",
    flips: ["routes-never-echo-internals"],
    apply: edit("routes", "fingerprint: f.fingerprint,", "fingerprint: f.fingerprint,\n          audience: f.audience,"),
  },

  // ---- routes: the revision conflict -----------------------------------------
  {
    label: "stop treating a revision conflict as success (a double-press shows a 500)",
    file: "routes",
    flips: ["run-revision-conflict-is-success"],
    apply: edit("routes", /    if \(isRevisionConflict\(err\)\) \{\n      res\.json\(\{ ok: true \}\);\n      return;\n    \}\n/, ""),
  },
  {
    label: "let the conflict branch fall through to the 500 (no return)",
    file: "routes",
    flips: ["run-revision-conflict-is-success"],
    apply: edit("routes", "if (isRevisionConflict(err)) {\n      res.json({ ok: true });\n      return;\n    }", "if (isRevisionConflict(err)) {\n      res.json({ ok: true });\n    }"),
  },
  {
    label: "treat the conflict as success in the disposition handler too",
    file: "routes",
    flips: ["run-revision-conflict-is-success"],
    apply: edit("routes", '    } catch (err) {\n      req.log.error({ err }, "proofread.disposition_failed");', '    } catch (err) {\n      if (isRevisionConflict(err)) {\n        res.json({ ok: true });\n        return;\n      }\n      req.log.error({ err }, "proofread.disposition_failed");'),
  },
  {
    label: "swallow ANY unique violation as success (drop the constraint name)",
    file: "routes",
    flips: ["revision-conflict-helper"],
    apply: edit("routes", ' && e.constraint === REVISION_KEY', ""),
  },
  {
    label: "drop the SQLSTATE half of the conflict test (any error that names the constraint counts)",
    file: "routes",
    flips: ["revision-conflict-helper"],
    apply: edit("routes", 'e.code === "23505" && e.constraint === REVISION_KEY', "e.constraint === REVISION_KEY"),
  },
  {
    label: "widen the conflict test to any unique key of the proofread tables (startsWith UQ_study_proofread, which admits the findings key)",
    file: "routes",
    flips: ["revision-conflict-helper"],
    apply: edit("routes", "e.constraint === REVISION_KEY", 'String(e.constraint).startsWith("UQ_study_proofread")'),
  },
  {
    label: "widen the conflict test to a name that merely starts with the real one",
    file: "routes",
    flips: ["revision-conflict-helper"],
    apply: edit("routes", "e.constraint === REVISION_KEY", "String(e.constraint).startsWith(REVISION_KEY)"),
  },
  {
    label: "widen the conflict test to a name that merely contains the real one",
    file: "routes",
    flips: ["revision-conflict-helper"],
    apply: edit("routes", "e.constraint === REVISION_KEY", "String(e.constraint).includes(REVISION_KEY)"),
  },
  {
    label: "accept a suffix of the real constraint name (endsWith, which no prefix or superstring negative can see)",
    file: "routes",
    flips: ["revision-conflict-helper"],
    apply: edit("routes", "e.constraint === REVISION_KEY", "REVISION_KEY.endsWith(String(e.constraint))"),
  },
  {
    label: "accept a prefix of the real constraint name",
    file: "routes",
    flips: ["revision-conflict-helper"],
    apply: edit("routes", "e.constraint === REVISION_KEY", "REVISION_KEY.startsWith(String(e.constraint))"),
  },
  {
    label: "swallow every error as a revision conflict",
    file: "routes",
    flips: ["revision-conflict-helper"],
    apply: edit("routes", 'if (e.code === "23505" && e.constraint === REVISION_KEY) return true;', "return true;"),
  },
  {
    label: "stop looking through the driver error's cause (drizzle wraps it, so the real conflict is missed)",
    file: "routes",
    flips: ["revision-conflict-helper"],
    apply: edit("routes", "e = e.cause, depth++", "depth++"),
  },
  {
    label: "name the wrong constraint",
    file: "routes",
    flips: ["revision-conflict-helper"],
    apply: edit("routes", '"UQ_study_proofread_runs_project_revision"', '"UQ_study_proofread_findings_run_fp"'),
  },
  {
    label: "answer a conflict with the error's text",
    file: "routes",
    flips: ["routes-500s-are-opaque", "run-revision-conflict-is-success"],
    apply: edit("routes", "if (isRevisionConflict(err)) {\n      res.json({ ok: true });", "if (isRevisionConflict(err)) {\n      res.json({ ok: String(err) });"),
  },

  // ---- routes: POST run ---------------------------------------------------
  {
    label: "drop the existence check from the run handler",
    file: "routes",
    flips: ["run-existence-before-enqueue"],
    also: ["foreign-is-404-not-403"],
    apply: editNth("routes", GUARD_RE, 1, ""),
  },
  {
    label: "enqueue BEFORE the run handler checks the project is the firm's",
    file: "routes",
    flips: ["run-existence-before-enqueue"],
    apply: chain(
      edit("routes", `${ENQUEUE_LINE}    res.json({ ok: true });`, "    res.json({ ok: true });"),
      editNth("routes", /    if \(!\(await projectExistsForFirm\(firm\.id, id\)\)\) \{/g, 1, `${ENQUEUE_LINE}    if (!(await projectExistsForFirm(firm.id, id))) {`),
    ),
  },
  {
    label: "fire the enqueue without awaiting it",
    file: "routes",
    flips: ["run-existence-before-enqueue"],
    apply: edit("routes", "await enqueueProofread(", "void enqueueProofread("),
  },
  {
    label: "answer a foreign project with a 403 on the run handler",
    file: "routes",
    flips: ["foreign-is-404-not-403", "run-existence-before-enqueue"],
    apply: editNth("routes", /res\.status\(404\)\.json\(\{ error: "Project not found\." \}\)/g, 3, 'res.status(403).json({ error: "Project not found." })'),
  },

  // ---- routes: POST disposition ------------------------------------------
  {
    label: "transpose projectId and runId in the finding-chain check",
    file: "routes",
    flips: ["disposition-scope-guard-exact"],
    apply: edit("routes", "findingInFirmRun(firm.id, projectId, runId, findingId)", "findingInFirmRun(firm.id, runId, projectId, findingId)"),
  },
  {
    label: "pass the user's id as the firm in the finding-chain check",
    file: "routes",
    flips: ["disposition-scope-guard-exact"],
    apply: edit("routes", "findingInFirmRun(firm.id, projectId, runId, findingId)", "findingInFirmRun(user.id, projectId, runId, findingId)"),
  },
  {
    label: "drop the finding-chain check altogether",
    file: "routes",
    flips: ["disposition-scope-guard-exact", "disposition-chain-in-order"],
    also: ["foreign-is-404-not-403", "disposition-refuses-admin-findings"],
    apply: edit("routes", /      if \(!\(await findingInFirmRun\([^\n]*\n        res\.status\(404\)\.json\(\{ error: "Finding not found\." \}\);\n        return;\n      \}\n/, ""),
  },
  {
    label: "invert the finding-chain check (drop the !)",
    file: "routes",
    flips: ["disposition-scope-guard-exact", "disposition-chain-in-order"],
    also: ["disposition-refuses-admin-findings"],
    apply: edit("routes", "if (!(await findingInFirmRun(", "if ((await findingInFirmRun("),
  },
  {
    label: "let the finding-chain miss fall through (no return)",
    file: "routes",
    flips: ["disposition-scope-guard-exact"],
    apply: editNth("routes", /(res\.status\(404\)\.json\(\{ error: "Finding not found\." \}\);)\n        return;/g, 0, 'res.status(404).json({ error: "Finding not found." });'),
  },
  {
    label: "answer a foreign finding with a 403",
    file: "routes",
    flips: ["foreign-is-404-not-403", "disposition-scope-guard-exact"],
    apply: editNth("routes", /res\.status\(404\)\.json\(\{ error: "Finding not found\." \}\)/g, 1, 'res.status(403).json({ error: "Finding not found." })'),
  },
  {
    label: "insert BEFORE the finding chain is verified",
    file: "routes",
    flips: ["disposition-chain-in-order"],
    also: ["disposition-refuses-admin-findings", "disposition-fits-the-finding-type", "disposition-refuses-superseded-run"],
    apply: chain(
      edit("routes", /      await insertDisposition\(\{[\s\S]*?\n      \}\);\n/, ""),
      edit(
        "routes",
        "      if (!(await findingInFirmRun(",
        "      await insertDisposition({ findingId, disposition: parsed.data.disposition, note: parsed.data.note, sourceLabel: parsed.data.sourceLabel, actorUserId: user.id });\n      if (!(await findingInFirmRun(",
      ),
    ),
  },
  {
    label: "delete the audience refusal (an engineer can rule on a DEFECT by id)",
    file: "routes",
    flips: ["disposition-refuses-admin-findings"],
    also: ["foreign-is-404-not-403"],
    apply: edit("routes", /      if \(finding === null \|\| finding\.audience === "admin"\) \{\n        res\.status\(404\)\.json\(\{ error: "Finding not found\." \}\);\n        return;\n      \}\n/, ""),
  },
  {
    label: "invert the audience comparison (refuse everything BUT admin)",
    file: "routes",
    flips: ["disposition-refuses-admin-findings"],
    apply: edit("routes", 'finding.audience === "admin"', 'finding.audience !== "admin"'),
  },
  {
    label: "answer an admin-audience finding with a 403 (confirms the record exists)",
    file: "routes",
    flips: ["disposition-refuses-admin-findings", "foreign-is-404-not-403"],
    apply: editNth("routes", /res\.status\(404\)\.json\(\{ error: "Finding not found\." \}\)/g, 2, 'res.status(403).json({ error: "Finding not found." })'),
  },
  {
    label: "refuse an admin-audience finding but fall through (no return)",
    file: "routes",
    flips: ["disposition-refuses-admin-findings"],
    apply: editNth("routes", /(res\.status\(404\)\.json\(\{ error: "Finding not found\." \}\);)\n        return;/g, 1, 'res.status(404).json({ error: "Finding not found." });'),
  },
  {
    label: "drop the null arm (a finding with no audience passes)",
    file: "routes",
    flips: ["disposition-refuses-admin-findings"],
    apply: edit("routes", 'finding === null || finding.audience === "admin"', 'finding.audience === "admin"'),
  },
  {
    label: "ask the audience of the run id instead of the finding",
    file: "routes",
    flips: ["disposition-refuses-admin-findings"],
    apply: edit("routes", "findingAudienceForFirm(firm.id, findingId)", "findingAudienceForFirm(firm.id, runId)"),
  },
  {
    label: "ask the audience under the user's id as the firm",
    file: "routes",
    flips: ["disposition-refuses-admin-findings"],
    apply: edit("routes", "findingAudienceForFirm(firm.id, findingId)", "findingAudienceForFirm(user.id, findingId)"),
  },
  {
    label: "check the audience AFTER the disposition is written",
    file: "routes",
    flips: ["disposition-refuses-admin-findings"],
    also: ["disposition-chain-in-order", "disposition-fits-the-finding-type"],
    apply: chain(
      edit("routes", /      const finding = await findingAudienceForFirm\(firm\.id, findingId\);\n      if \(finding === null \|\| finding\.audience === "admin"\) \{\n        res\.status\(404\)\.json\(\{ error: "Finding not found\." \}\);\n        return;\n      \}\n/, ""),
      edit("routes", "      res.json({ ok: true });\n    } catch (err) {\n      req.log.error({ err }, \"proofread.disposition_failed\");", "      const finding = await findingAudienceForFirm(firm.id, findingId);\n      if (finding === null || finding.audience === \"admin\") {\n        res.status(404).json({ error: \"Finding not found.\" });\n        return;\n      }\n      res.json({ ok: true });\n    } catch (err) {\n      req.log.error({ err }, \"proofread.disposition_failed\");"),
    ),
  },

  // ---- routes: the decision must fit the finding's type (422) -----------------
  {
    label: "delete the type refusal (a BLOCKER can be marked Disclosed)",
    file: "routes",
    flips: ["disposition-fits-the-finding-type", "disposition-chain-in-order"],
    apply: edit("routes", /      if \(!decisionApplies\(finding\.type, parsed\.data\.disposition\)\) \{\n        res\.status\(422\)[^\n]*\n        return;\n      \}\n/, ""),
  },
  {
    label: "refuse an unfitting decision but fall through (422 without a return, then insert)",
    file: "routes",
    flips: ["disposition-fits-the-finding-type"],
    apply: edit("routes", /(res\.status\(422\)\.json\(\{ error: "This decision does not apply to this finding\." \}\);)\n        return;/, "$1"),
  },
  {
    label: "check the decision against the finding's audience instead of its type",
    file: "routes",
    flips: ["disposition-fits-the-finding-type"],
    apply: edit("routes", "decisionApplies(finding.type, parsed.data.disposition)", "decisionApplies(finding.audience, parsed.data.disposition)"),
  },
  {
    label: "check the type against the raw body instead of the parsed disposition",
    file: "routes",
    flips: ["disposition-fits-the-finding-type"],
    also: ["body-only-through-contract"],
    apply: edit("routes", "decisionApplies(finding.type, parsed.data.disposition)", "decisionApplies(finding.type, String(req.body?.disposition))"),
  },
  {
    label: "negate the type check (refuse only the decisions that fit)",
    file: "routes",
    flips: ["disposition-fits-the-finding-type", "disposition-chain-in-order"],
    apply: edit("routes", "if (!decisionApplies(", "if (decisionApplies("),
  },
  {
    label: "answer an unfitting decision with a 400",
    file: "routes",
    flips: ["disposition-fits-the-finding-type"],
    apply: edit("routes", 'res.status(422).json({ error: "This decision does not apply to this finding." })', 'res.status(400).json({ error: "This decision does not apply to this finding." })'),
  },
  {
    label: "answer an unfitting decision with a 418",
    file: "routes",
    flips: ["disposition-fits-the-finding-type", "foreign-is-404-not-403"],
    apply: edit("routes", 'res.status(422).json({ error: "This decision does not apply to this finding." })', 'res.status(418).json({ error: "This decision does not apply to this finding." })'),
  },
  {
    label: "check the type BEFORE the audience 404 (a DEFECT is offered nothing, so a 422 would confirm a hidden finding exists)",
    file: "routes",
    flips: ["disposition-fits-the-finding-type", "disposition-chain-in-order"],
    also: ["disposition-refuses-admin-findings"],
    apply: chain(
      edit("routes", /      if \(!decisionApplies\(finding\.type, parsed\.data\.disposition\)\) \{\n        res\.status\(422\)[^\n]*\n        return;\n      \}\n/, ""),
      edit("routes", "      const finding = await findingAudienceForFirm(firm.id, findingId);\n", '      const finding = await findingAudienceForFirm(firm.id, findingId);\n      if (finding !== null && !decisionApplies(finding.type, parsed.data.disposition)) {\n        res.status(422).json({ error: "This decision does not apply to this finding." });\n        return;\n      }\n'),
    ),
  },
  {
    label: "check the type AFTER the disposition is written",
    file: "routes",
    flips: ["disposition-fits-the-finding-type", "disposition-chain-in-order"],
    apply: chain(
      edit("routes", /      if \(!decisionApplies\(finding\.type, parsed\.data\.disposition\)\) \{\n        res\.status\(422\)[^\n]*\n        return;\n      \}\n/, ""),
      edit("routes", "      res.json({ ok: true });\n    } catch (err) {\n      req.log.error({ err }, \"proofread.disposition_failed\");", "      if (!decisionApplies(finding.type, parsed.data.disposition)) {\n        res.status(422).json({ error: \"This decision does not apply to this finding.\" });\n        return;\n      }\n      res.json({ ok: true });\n    } catch (err) {\n      req.log.error({ err }, \"proofread.disposition_failed\");"),
    ),
  },
  {
    label: "decisionApplies answers yes to every decision on a known type",
    file: "routes",
    flips: ["decision-applies-follows-the-contract"],
    apply: edit("routes", "  return offered.includes(disposition);", "  return offered !== undefined || disposition.length > 0;"),
  },
  {
    label: "decisionApplies drops the own-property test (a type the map does not name reads undefined, \"constructor\" reads Object)",
    file: "routes",
    flips: ["decision-applies-follows-the-contract"],
    apply: edit("routes", "  if (!Object.hasOwn(OFFERED_DISPOSITIONS, type)) return false;\n", ""),
  },
  {
    label: "decisionApplies tests the type with `in` (inherited keys such as constructor pass)",
    file: "routes",
    flips: ["decision-applies-follows-the-contract"],
    apply: edit("routes", "if (!Object.hasOwn(OFFERED_DISPOSITIONS, type)) return false;", "if (!(type in OFFERED_DISPOSITIONS)) return false;"),
  },
  {
    label: "decisionApplies offers an unknown type a BLOCKER's set (the panel's fallback) instead of nothing",
    file: "routes",
    flips: ["decision-applies-follows-the-contract"],
    apply: edit("routes", "if (!Object.hasOwn(OFFERED_DISPOSITIONS, type)) return false;", 'if (!Object.hasOwn(OFFERED_DISPOSITIONS, type)) return disposition === "FIXED" || disposition === "WITHDRAWN";'),
  },
  {
    label: "decisionApplies matches decisions without regard to case",
    file: "routes",
    flips: ["decision-applies-follows-the-contract"],
    apply: edit("routes", "  return offered.includes(disposition);", "  return offered.some((x) => x.toLowerCase() === disposition.toLowerCase());"),
  },
  {
    label: "decisionApplies reads a table of its own, identical to the contract's today",
    file: "routes",
    flips: ["decision-applies-follows-the-contract"],
    apply: edit(
      "routes",
      "  const offered: readonly string[] = OFFERED_DISPOSITIONS[type as keyof typeof OFFERED_DISPOSITIONS];",
      '  const own: Record<string, string[]> = { BLOCKER: ["FIXED", "WITHDRAWN"], DISCLOSE: ["DISCLOSED", "FIXED", "WITHDRAWN"], NOTE: ["DISCLOSED", "FIXED", "WITHDRAWN"], UNVERIFIED: ["DISCLOSED", "FIXED", "WITHDRAWN"], CONTESTED: [], DEFECT: [] };\n  const offered: readonly string[] = own[type] ?? [];',
    ),
  },
  {
    label: "the routes declare an OFFERED_DISPOSITIONS of their own",
    file: "routes",
    flips: ["decision-applies-follows-the-contract"],
    apply: edit("routes", "const router: IRouter = Router();", "const router: IRouter = Router();\nconst OFFERED_DISPOSITIONS = { BLOCKER: [\"FIXED\", \"WITHDRAWN\"] };\nvoid OFFERED_DISPOSITIONS;"),
  },

  // ---- routes: a decision only on the project's newest finished run (409) -------
  {
    label: "delete the superseded-run refusal (a decision lands on an older revision)",
    file: "routes",
    flips: ["disposition-refuses-superseded-run", "disposition-chain-in-order"],
    apply: edit("routes", /      const newest = await latestRunStatusForProject\(firm\.id, projectId\);\n      if \(newest === null \|\| newest\.id !== runId \|\| \(newest\.status !== "rules_ready" && newest\.status !== "ready"\)\) \{\n        res\.status\(409\)[^\n]*\n        return;\n      \}\n/, ""),
  },
  {
    label: "accept a decision on an older revision (drop the run-id comparison)",
    file: "routes",
    flips: ["disposition-refuses-superseded-run"],
    apply: edit("routes", "newest === null || newest.id !== runId || (newest.status", "newest === null || (newest.status"),
  },
  {
    label: "accept a decision on an unfinished run (drop the status comparison)",
    file: "routes",
    flips: ["disposition-refuses-superseded-run"],
    apply: edit("routes", ' || (newest.status !== "rules_ready" && newest.status !== "ready")', ""),
  },
  {
    label: "accept a decision on a run that has not finished its carry (\"running\" taken for finished)",
    file: "routes",
    flips: ["disposition-refuses-superseded-run"],
    apply: edit("routes", '(newest.status !== "rules_ready" && newest.status !== "ready")', 'newest.status === "failed"'),
  },
  {
    label: "refuse a decision on a 'ready' run (rules_ready alone counts as finished)",
    file: "routes",
    flips: ["disposition-refuses-superseded-run"],
    apply: edit("routes", '(newest.status !== "rules_ready" && newest.status !== "ready")', 'newest.status !== "rules_ready"'),
  },
  {
    label: "test the two finished statuses with || (every decision refused)",
    file: "routes",
    flips: ["disposition-refuses-superseded-run"],
    apply: edit("routes", '(newest.status !== "rules_ready" && newest.status !== "ready")', '(newest.status !== "rules_ready" || newest.status !== "ready")'),
  },
  {
    label: "refuse only when BOTH the run differs and it is unfinished (&& for ||)",
    file: "routes",
    flips: ["disposition-refuses-superseded-run"],
    apply: edit("routes", 'newest.id !== runId || (newest.status', 'newest.id !== runId && (newest.status'),
  },
  {
    label: "drop the null arm of the superseded-run refusal (no run at all passes)",
    file: "routes",
    flips: ["disposition-refuses-superseded-run"],
    apply: edit("routes", "if (newest === null || newest.id !== runId", "if (newest?.id !== runId"),
  },
  {
    label: "look up the newest run under the user's id as the firm",
    file: "routes",
    flips: ["disposition-refuses-superseded-run"],
    apply: edit("routes", "latestRunStatusForProject(firm.id, projectId)", "latestRunStatusForProject(user.id, projectId)"),
  },
  {
    label: "look up the newest run of the run id instead of the project",
    file: "routes",
    flips: ["disposition-refuses-superseded-run"],
    apply: edit("routes", "latestRunStatusForProject(firm.id, projectId)", "latestRunStatusForProject(firm.id, runId)"),
  },
  {
    label: "transpose the newest-run lookup's arguments",
    file: "routes",
    flips: ["disposition-refuses-superseded-run"],
    apply: edit("routes", "latestRunStatusForProject(firm.id, projectId)", "latestRunStatusForProject(projectId, firm.id)"),
  },
  {
    label: "refuse a superseded run but fall through (409 without a return, then insert)",
    file: "routes",
    flips: ["disposition-refuses-superseded-run"],
    apply: edit("routes", /(res\.status\(409\)\.json\(\{ error: "This check has been run again\. Refresh to see the latest\." \}\);)\n        return;/, "$1"),
  },
  {
    label: "answer a superseded run with a 404",
    file: "routes",
    flips: ["disposition-refuses-superseded-run"],
    apply: edit("routes", 'res.status(409).json({ error: "This check has been run again. Refresh to see the latest." })', 'res.status(404).json({ error: "This check has been run again. Refresh to see the latest." })'),
  },
  {
    label: "answer a superseded run with a 418",
    file: "routes",
    flips: ["disposition-refuses-superseded-run", "foreign-is-404-not-403"],
    apply: edit("routes", 'res.status(409).json({ error: "This check has been run again. Refresh to see the latest." })', 'res.status(418).json({ error: "This check has been run again. Refresh to see the latest." })'),
  },
  {
    label: "check the run AFTER the disposition is written",
    file: "routes",
    flips: ["disposition-refuses-superseded-run", "disposition-chain-in-order"],
    apply: chain(
      edit("routes", /      const newest = await latestRunStatusForProject\(firm\.id, projectId\);\n      if \(newest === null \|\| newest\.id !== runId \|\| \(newest\.status !== "rules_ready" && newest\.status !== "ready"\)\) \{\n        res\.status\(409\)[^\n]*\n        return;\n      \}\n/, ""),
      edit("routes", "      res.json({ ok: true });\n    } catch (err) {\n      req.log.error({ err }, \"proofread.disposition_failed\");", "      const newest = await latestRunStatusForProject(firm.id, projectId);\n      if (newest === null || newest.id !== runId || (newest.status !== \"rules_ready\" && newest.status !== \"ready\")) {\n        res.status(409).json({ error: \"This check has been run again. Refresh to see the latest.\" });\n        return;\n      }\n      res.json({ ok: true });\n    } catch (err) {\n      req.log.error({ err }, \"proofread.disposition_failed\");"),
    ),
  },
  {
    label: "check the run BEFORE the finding chain (a foreign project's run state is read before the tenant check)",
    file: "routes",
    flips: ["disposition-chain-in-order"],
    apply: chain(
      edit("routes", /      const newest = await latestRunStatusForProject\(firm\.id, projectId\);\n      if \(newest === null \|\| newest\.id !== runId \|\| \(newest\.status !== "rules_ready" && newest\.status !== "ready"\)\) \{\n        res\.status\(409\)[^\n]*\n        return;\n      \}\n/, ""),
      edit("routes", "      if (!(await findingInFirmRun(", "      const newest = await latestRunStatusForProject(firm.id, projectId);\n      if (newest === null || newest.id !== runId || (newest.status !== \"rules_ready\" && newest.status !== \"ready\")) {\n        res.status(409).json({ error: \"This check has been run again. Refresh to see the latest.\" });\n        return;\n      }\n      if (!(await findingInFirmRun("),
    ),
  },
  {
    label: "read runId from the project-id parameter",
    file: "routes",
    flips: ["disposition-params-bound"],
    apply: edit("routes", "const urlRunId = String(req.params.runId);", "const urlRunId = String(req.params.id);"),
  },
  {
    label: "read findingId from the run-id parameter",
    file: "routes",
    flips: ["disposition-params-bound"],
    apply: edit("routes", "const urlFindingId = String(req.params.findingId);", "const urlFindingId = String(req.params.runId);"),
  },
  {
    label: "compare the URL's run id as given (no lowercasing)",
    file: "routes",
    flips: ["disposition-ids-are-lowercased-once"],
    apply: edit("routes", "const runId = urlRunId.toLowerCase();", "const runId = urlRunId;"),
  },
  {
    label: "uppercase the finding id instead of lowercasing it",
    file: "routes",
    flips: ["disposition-ids-are-lowercased-once"],
    apply: edit("routes", "const findingId = urlFindingId.toLowerCase();", "const findingId = urlFindingId.toUpperCase();"),
  },
  {
    label: "compare the raw URL run id in the 409",
    file: "routes",
    flips: ["disposition-ids-are-lowercased-once", "disposition-refuses-superseded-run"],
    apply: edit("routes", "newest.id !== runId", "newest.id !== urlRunId"),
  },
  {
    label: "lowercase the ids only after the firm is resolved",
    file: "routes",
    flips: ["disposition-ids-are-lowercased-once"],
    also: ["disposition-chain-in-order"],
    apply: (s) => {
      const block = "    const projectId = urlProjectId.toLowerCase();\n    const runId = urlRunId.toLowerCase();\n    const findingId = urlFindingId.toLowerCase();\n";
      const firm = "      const { firm } = await getOrCreateFirmForUser(user.id, {\n        email: user.email,\n        firstName: user.firstName,\n        lastName: user.lastName,\n      });\n";
      const at = s.routes.lastIndexOf(firm);
      if (!s.routes.includes(block) || at < 0) return s;
      const moved = s.routes.slice(0, at + firm.length) + block + s.routes.slice(at + firm.length);
      return { ...s, routes: moved.replace(block, "") };
    },
  },
  {
    label: "loosen the UUID gate back to [0-9a-f-]{36}",
    file: "routes",
    flips: ["uuid-gate-is-strict"],
    apply: edit("routes", /const UUID = [^\n]*;/, "const UUID = /^[0-9a-f-]{36}$/i;"),
  },
  {
    label: "stop gating runId",
    file: "routes",
    flips: ["every-id-is-uuid-gated"],
    // the raw run id is then read twice, not three times
    also: ["disposition-ids-are-lowercased-once"],
    apply: edit("routes", " || !UUID.test(urlRunId)", ""),
  },
  {
    label: "stop gating the id in the read handler",
    file: "routes",
    flips: ["every-id-is-uuid-gated"],
    also: ["foreign-is-404-not-403"],
    apply: editNth("routes", /  if \(!UUID\.test\(id\)\) \{\n    res\.status\(404\)\.json\(\{ error: "Project not found\." \}\);\n    return;\n  \}\n/g, 0, ""),
  },
  {
    label: "drop ACCEPTED_RISK from the PE-only set",
    file: "routes",
    flips: ["pe-only-set"],
    apply: edit("routes", 'new Set(["ACCEPTED_RISK", "CONTESTED_PE"])', 'new Set(["CONTESTED_PE"])'),
  },
  {
    label: "misspell a member of the PE-only set",
    file: "routes",
    flips: ["pe-only-set"],
    apply: edit("routes", '"ACCEPTED_RISK"', '"ACCEPTED_RISKS"'),
  },
  {
    label: "sweep a permitted disposition into the PE-only set",
    file: "routes",
    flips: ["pe-only-set"],
    apply: edit("routes", 'new Set(["ACCEPTED_RISK", "CONTESTED_PE"])', 'new Set(["ACCEPTED_RISK", "CONTESTED_PE", "FIXED"])'),
  },
  {
    label: "remove the PE-only refusal",
    file: "routes",
    flips: ["pe-only-refused-before-write", "disposition-chain-in-order"],
    also: ["foreign-is-404-not-403"],
    apply: edit("routes", /    if \(PE_ONLY\.has\(parsed\.data\.disposition\)\) \{[\s\S]*?\n      return;\n    \}\n/, ""),
  },
  {
    label: "let the PE-only refusal fall through (403 without a return, then insert)",
    file: "routes",
    flips: ["pe-only-refused-before-write"],
    apply: edit("routes", /(Only the sealing engineer[^\n]*\n      \}\);)\n      return;/, "$1"),
  },

  // ---- routes: the advisor boundary --------------------------------------
  {
    label: "import setProjectTheme (a study write) into the routes",
    file: "routes",
    flips: ["routes-import-whitelist"],
    apply: edit("routes", 'import { projectExistsForFirm } from "../lib/tis-projects";', 'import { projectExistsForFirm, setProjectTheme } from "../lib/tis-projects";'),
  },
  {
    label: "import getProject into the routes",
    file: "routes",
    flips: ["routes-import-whitelist"],
    also: ["polled-read-avoids-getproject"],
    apply: edit("routes", 'import { projectExistsForFirm } from "../lib/tis-projects";', 'import { getProject, projectExistsForFirm } from "../lib/tis-projects";'),
  },
  {
    label: "import the store's run writers into the routes",
    file: "routes",
    flips: ["routes-import-whitelist"],
    apply: edit("routes", "  latestRunStatusForProject,\n} from \"../lib/proofread-store\";", "  latestRunStatusForProject,\n  completeRun,\n} from \"../lib/proofread-store\";"),
  },
  {
    label: "import the database into the routes",
    file: "routes",
    flips: ["routes-import-whitelist", "routes-do-not-touch-study"],
    apply: edit("routes", 'import { Router, type IRouter } from "express";', 'import { Router, type IRouter } from "express";\nimport { db } from "@workspace/db";'),
  },
  {
    label: "name tisProjectsTable in the routes",
    file: "routes",
    flips: ["routes-do-not-touch-study"],
    apply: edit("routes", "const router: IRouter = Router();", "const router: IRouter = Router();\nvoid tisProjectsTable;"),
  },
  {
    label: "read resultPayload in the routes",
    file: "routes",
    flips: ["routes-do-not-touch-study"],
    apply: edit("routes", "const router: IRouter = Router();", "const router: IRouter = Router();\nvoid project.resultPayload;"),
  },
  {
    label: "call an .update( from a route",
    file: "routes",
    flips: ["routes-do-not-touch-study"],
    apply: edit("routes", "const router: IRouter = Router();", "const router: IRouter = Router();\nvoid store.update(1);"),
  },
  {
    label: "answer a failure with the error's message",
    file: "routes",
    flips: ["routes-500s-are-opaque"],
    apply: edit("routes", 'res.status(500).json({ error: "Failed to load the check." });', "res.status(500).json({ error: String(err) });"),
  },
  {
    label: "banned copy in a route message (capitalised)",
    file: "routes",
    flips: ["copy-routes"],
    apply: edit("routes", "Sign in to view this check.", "Sign in to view this Independent Review."),
  },
  {
    label: "banned copy in a route message (hyphenated)",
    file: "routes",
    flips: ["copy-routes"],
    apply: edit("routes", "Failed to start the check.", "Failed to start the second-opinion."),
  },
  {
    label: "banned copy in a route message (QA/QC)",
    file: "routes",
    flips: ["copy-routes"],
    apply: edit("routes", "Failed to record the decision.", "Failed to record the QA/QC decision."),
  },

  // ---- contract ------------------------------------------------------------
  {
    label: "drop the WITHDRAWN-needs-a-source refinement",
    file: "contract",
    flips: ["contract-withdrawn-needs-source"],
    apply: edit("contract", /\.superRefine\(\(val, ctx\) => \{[\s\S]*?\n  \}\);/, ";"),
  },
  {
    label: "require the source for DISCLOSED instead of WITHDRAWN",
    file: "contract",
    flips: ["contract-withdrawn-needs-source", "contract-other-dispositions-need-no-source"],
    apply: edit("contract", 'val.disposition === "WITHDRAWN"', 'val.disposition === "DISCLOSED"'),
  },
  {
    label: "require a source for every disposition",
    file: "contract",
    flips: ["contract-other-dispositions-need-no-source"],
    also: ["contract-body-ignores-actor", "contract-bounds"],
    apply: edit("contract", 'val.disposition === "WITHDRAWN" && !val.sourceLabel', "!val.sourceLabel"),
  },
  {
    label: "accept a whitespace-only source",
    file: "contract",
    flips: ["contract-source-is-not-whitespace"],
    apply: edit("contract", "z.string().trim().min(1).max(500)", "z.string().min(1).max(500)"),
  },
  {
    label: "drop ACCEPTED_RISK from the disposition enum",
    file: "contract",
    flips: ["contract-dispositions-set", "contract-other-dispositions-need-no-source"],
    apply: edit("contract", '  "ACCEPTED_RISK",\n', ""),
  },
  {
    label: "drop UNVERIFIED from the finding types",
    file: "contract",
    flips: ["contract-types-match-server"],
    apply: edit("contract", '"UNVERIFIED", ', ""),
  },
  {
    label: "let the body carry an actor",
    file: "contract",
    flips: ["contract-body-ignores-actor"],
    apply: edit("contract", "    disposition: ProofreadDisposition,", "    disposition: ProofreadDisposition,\n    actorUserId: z.string().optional(),"),
  },
  {
    label: "let the body carry a finding id",
    file: "contract",
    flips: ["contract-body-ignores-actor"],
    apply: edit("contract", "    disposition: ProofreadDisposition,", "    disposition: ProofreadDisposition,\n    findingId: z.string().optional(),"),
  },
  {
    label: "unbound the note",
    file: "contract",
    flips: ["contract-bounds"],
    apply: edit("contract", "z.string().max(2000)", "z.string()"),
  },
  {
    label: "unbound the source",
    file: "contract",
    flips: ["contract-bounds"],
    apply: edit("contract", ".max(500)", ".max(50000)"),
  },
  {
    label: "accept any string as a disposition",
    file: "contract",
    flips: ["contract-rejects-unknown-disposition"],
    apply: edit("contract", "    disposition: ProofreadDisposition,", "    disposition: z.string(),"),
  },
  {
    label: "export a name another contract module already exports",
    file: "contract",
    flips: ["contract-no-collision"],
    apply: edit("contract", "export type ProofreadDispositionBodyT", "export const GenerateRoadDietBody = z.string();\nexport type ProofreadDispositionBodyT"),
  },
  {
    label: "export the same name twice (a duplicate identifier, which TypeScript rejects but a text scan would not)",
    file: "contract",
    flips: ["contract-no-collision"],
    apply: edit("contract", "export type ProofreadDispositionBodyT", "export type ProofreadDispositionBodyT = string;\nexport type ProofreadDispositionBodyT"),
  },
  {
    label: "offer DISCLOSED on a BLOCKER (a disclosed wrong number would be written as resolved)",
    file: "contract",
    flips: ["contract-offered-decisions"],
    apply: edit("contract", "BLOCKER: [DECISION.FIXED, DECISION.WITHDRAWN],", "BLOCKER: [DECISION.DISCLOSED, DECISION.FIXED, DECISION.WITHDRAWN],"),
  },
  {
    label: "offer FIXED on a CONTESTED item",
    file: "contract",
    flips: ["contract-offered-decisions"],
    apply: edit("contract", "CONTESTED: [],", "CONTESTED: [DECISION.FIXED],"),
  },
  {
    label: "offer BUG_FILED on a DEFECT",
    file: "contract",
    flips: ["contract-offered-decisions"],
    apply: edit("contract", "DEFECT: [],", "DEFECT: [DECISION.BUG_FILED],"),
  },
  {
    label: "offer the sealing engineer's ACCEPTED_RISK on a NOTE",
    file: "contract",
    flips: ["contract-offered-decisions"],
    apply: edit("contract", "NOTE: [DECISION.DISCLOSED, DECISION.FIXED, DECISION.WITHDRAWN],", "NOTE: [DECISION.DISCLOSED, DECISION.FIXED, DECISION.WITHDRAWN, DECISION.ACCEPTED_RISK],"),
  },
  {
    label: "drop WITHDRAWN from UNVERIFIED",
    file: "contract",
    flips: ["contract-offered-decisions"],
    apply: edit("contract", "UNVERIFIED: [DECISION.DISCLOSED, DECISION.FIXED, DECISION.WITHDRAWN],", "UNVERIFIED: [DECISION.DISCLOSED, DECISION.FIXED],"),
  },
  {
    label: "list a decision twice on a DISCLOSE",
    file: "contract",
    flips: ["contract-offered-decisions"],
    apply: edit("contract", "DISCLOSE: [DECISION.DISCLOSED, DECISION.FIXED, DECISION.WITHDRAWN],", "DISCLOSE: [DECISION.DISCLOSED, DECISION.FIXED, DECISION.WITHDRAWN, DECISION.FIXED],"),
  },
  {
    label: "drop the DEFECT key from the map",
    file: "contract",
    flips: ["contract-offered-decisions"],
    apply: edit("contract", "  DEFECT: [],\n", ""),
  },
  {
    label: "add a type the protocol does not have to the map",
    file: "contract",
    flips: ["contract-offered-decisions"],
    apply: edit("contract", "  DEFECT: [],\n", "  DEFECT: [],\n  BUG: [DECISION.FIXED],\n"),
  },
  {
    label: "rename the map's export",
    file: "contract",
    flips: ["contract-offered-decisions"],
    apply: edit("contract", "export const OFFERED_DISPOSITIONS = {", "export const OFFERED = {"),
  },
  {
    label: "make the read answer's `withheld` optional",
    file: "contract",
    flips: ["contract-read-response"],
    apply: edit("contract", "withheld: z.number().int().nonnegative(),", "withheld: z.number().int().nonnegative().optional(),"),
  },
  {
    label: "make rulesChanged optional in the read contract",
    file: "contract",
    flips: ["contract-read-response"],
    apply: edit("contract", "rulesChanged: z.boolean(),", "rulesChanged: z.boolean().optional(),"),
  },
  {
    label: "let rulesChanged be a string in the read contract",
    file: "contract",
    flips: ["contract-read-response"],
    apply: edit("contract", "rulesChanged: z.boolean(),", "rulesChanged: z.union([z.boolean(), z.string()]),"),
  },
  {
    label: "let `withheld` be any number (negative, fractional)",
    file: "contract",
    flips: ["contract-read-response"],
    apply: edit("contract", "withheld: z.number().int().nonnegative(),", "withheld: z.number(),"),
  },
  {
    label: "let `withheld` carry the withheld findings",
    file: "contract",
    flips: ["contract-read-response"],
    apply: edit("contract", "withheld: z.number().int().nonnegative(),", "withheld: z.union([z.number().int().nonnegative(), z.array(z.unknown())]),"),
  },
  {
    label: "drop `withheld` from the read answer",
    file: "contract",
    flips: ["contract-read-response"],
    apply: edit("contract", "    withheld: z.number().int().nonnegative(),\n", ""),
  },
  {
    label: "let a finding in the read answer carry its audience",
    file: "contract",
    flips: ["contract-read-response"],
    apply: edit("contract", "          fingerprint: z.string(),\n", "          fingerprint: z.string(),\n          audience: z.string().optional(),\n"),
  },
  {
    label: "make the read answer non-strict (an extra key passes)",
    file: "contract",
    flips: ["contract-read-response"],
    apply: edit("contract", "  })\n  .strict();\n\nexport type ProofreadReadResponseT", "  });\n\nexport type ProofreadReadResponseT"),
  },
  {
    label: "rename the read answer's export",
    file: "contract",
    flips: ["contract-read-response"],
    apply: edit("contract", "export const ProofreadReadResponse = z", "export const ProofreadRead = z"),
  },
  {
    label: "banned copy in the contract's message",
    file: "contract",
    flips: ["copy-contract"],
    apply: edit("contract", "WITHDRAWN requires the source", "WITHDRAWN is a peer review that requires the source"),
  },
  {
    label: "stop re-exporting the contract from the package index",
    file: "zodIndex",
    flips: ["zod-index-reexports"],
    apply: edit("zodIndex", 'export * from "./proofread";', ""),
  },
  {
    label: "re-export the contract twice",
    file: "zodIndex",
    flips: ["zod-index-reexports"],
    apply: edit("zodIndex", 'export * from "./proofread";', 'export * from "./proofread";\nexport * from "./proofread";'),
  },

  // ---- store -----------------------------------------------------------------
  {
    label: "write tis_projects from completeRun",
    file: "store",
    flips: ["store-writes-only-proofread-tables", "store-study-row-is-read-only"],
    apply: edit("store", "  if (args.findings.length === 0) return;", "  await db.update(tisProjectsTable).set({ version: 2 }).where(eq(tisProjectsTable.id, args.runId));\n  if (args.findings.length === 0) return;"),
  },
  {
    label: "write tis_projects from inside the study loader",
    file: "store",
    flips: ["store-writes-only-proofread-tables", "store-study-row-is-read-only"],
    apply: edit("store", "  return row ?? null;\n}\n\n/**\n * Write a run's outcome.", "  await db.update(tisProjectsTable).set({ version: 2 }).where(eq(tisProjectsTable.id, run.projectId));\n  return row ?? null;\n}\n\n/**\n * Write a run's outcome."),
  },
  {
    label: "delete a study row from the store",
    file: "store",
    flips: ["store-writes-only-proofread-tables", "store-study-row-is-read-only", "store-dispositions-are-append-only"],
    apply: edit("store", "  if (args.findings.length === 0) return;", "  await db.delete(tisProjectsTable).where(eq(tisProjectsTable.id, args.runId));\n  if (args.findings.length === 0) return;"),
  },
  {
    label: "write some other table from the store",
    file: "store",
    flips: ["store-writes-only-proofread-tables"],
    apply: edit("store", "  if (args.findings.length === 0) return;", "  await db.update(firmsTable).set({}).where(eq(firmsTable.id, args.runId));\n  if (args.findings.length === 0) return;"),
  },
  {
    label: "write result_payload through a raw template",
    file: "store",
    flips: ["store-no-raw-study-sql", "store-dispositions-are-append-only"],
    apply: edit("store", "  if (args.findings.length === 0) return;", "  await db.execute(sql`UPDATE tis_projects SET result_payload = '{}'`);\n  if (args.findings.length === 0) return;"),
  },
  {
    label: "write to a study table through raw SQL that never names tis_projects (INSERT INTO)",
    file: "store",
    flips: ["store-no-raw-study-sql", "store-dispositions-are-append-only"],
    apply: edit("store", "  if (args.findings.length === 0) return;", "  await db.execute(sql`INSERT INTO other_table VALUES (1)`);\n  if (args.findings.length === 0) return;"),
  },
  {
    label: "update the disposition log in place",
    file: "store",
    flips: ["store-dispositions-are-append-only", "store-writes-only-proofread-tables"],
    apply: edit("store", "  if (args.findings.length === 0) return;", "  await db.update(studyProofreadDispositionsTable).set({ note: null });\n  if (args.findings.length === 0) return;"),
  },
  {
    label: "delete from the disposition log",
    file: "store",
    flips: ["store-dispositions-are-append-only", "store-writes-only-proofread-tables"],
    apply: edit("store", "  if (args.findings.length === 0) return;", "  await db.delete(studyProofreadDispositionsTable);\n  if (args.findings.length === 0) return;"),
  },
  {
    label: "make the disposition insert an upsert",
    file: "store",
    flips: ["store-dispositions-are-append-only"],
    apply: edit("store", "    actorUserId: args.actorUserId,\n  });\n}", "    actorUserId: args.actorUserId,\n  }).onConflictDoUpdate({ target: studyProofreadDispositionsTable.id, set: { note: null } });\n}"),
  },
  // ---- the verb-by-table allowlist: deletes cascade into the log, and no table gains a verb ----
  {
    label: "delete a run (runs -> findings -> dispositions cascade, so this erases the log under it)",
    file: "store",
    flips: ["store-dispositions-are-append-only", "store-writes-only-proofread-tables"],
    apply: edit("store", "  if (args.findings.length === 0) return;", "  await db.delete(studyProofreadRunsTable).where(eq(studyProofreadRunsTable.id, args.runId));\n  if (args.findings.length === 0) return;"),
  },
  {
    label: "delete a run's findings before re-inserting them (cascades into their dispositions)",
    file: "store",
    flips: ["store-dispositions-are-append-only", "store-writes-only-proofread-tables"],
    apply: edit("store", "  if (args.findings.length === 0) return;", "  await db.delete(studyProofreadFindingsTable).where(eq(studyProofreadFindingsTable.runId, args.runId));\n  if (args.findings.length === 0) return;"),
  },
  {
    label: "update the findings table (findings are inserted, never rewritten)",
    file: "store",
    flips: ["store-writes-only-proofread-tables"],
    apply: edit("store", "  if (args.findings.length === 0) return;", '  await db.update(studyProofreadFindingsTable).set({ origin: "rule" }).where(eq(studyProofreadFindingsTable.runId, args.runId));\n  if (args.findings.length === 0) return;'),
  },
  {
    label: "delete a run through a string-key element access",
    file: "store",
    flips: ["store-dispositions-are-append-only", "store-writes-only-proofread-tables"],
    apply: edit("store", "  if (args.findings.length === 0) return;", '  await db["delete"](studyProofreadRunsTable);\n  if (args.findings.length === 0) return;'),
  },
  // ---- raw SQL writes, in any letter case, of any table ----
  ...[
    ["a lowercase update of tis_projects with the table interpolated, inside the loader (the one function allowed to name it)", "await db.execute(sql`update ${tisProjectsTable} set version = 2`);", "loader"],
    ["a lowercase update of the disposition log", "await db.execute(sql`update study_proofread_dispositions set note = 'x'`);"],
    ["a lowercase delete from the disposition log", "await db.execute(sql`delete from study_proofread_dispositions`);"],
    ["a lowercase upsert into the disposition log", "await db.execute(sql`insert into study_proofread_dispositions (note) values ('x') on conflict (id) do update set note = 'y'`);"],
    ["TRUNCATE of the disposition log", "await db.execute(sql`TRUNCATE study_proofread_dispositions`);"],
    ["a lowercase truncate table", "await db.execute(sql`truncate table study_proofread_dispositions`);"],
    ["MERGE INTO the disposition log", "await db.execute(sql`merge into study_proofread_dispositions d using (select 1) s on true when matched then delete`);"],
    ["an update of the log with the table interpolated", "await db.execute(sql`update ${studyProofreadDispositionsTable} set note = null`);"],
    ["an update whose SQL is built from a + chain of strings", 'await db.execute(sql.raw("update " + "study_proofread_" + "dispositions set note = null"));'],
    ["a delete of a run in raw SQL (cascades into the log)", "await db.execute(sql`Delete From study_proofread_runs where id = ${args.runId}`);"],
    ["an update with a block comment between the words, on a split table name", 'await db.execute(sql.raw("update/**/tis_" + "projects set version = 1"));'],
    ["a delete with a line comment between the words", 'await db.execute(sql.raw("delete -- c\\n from study_proofread_dispositions"));'],
    ["an insert with a block comment between the words", 'await db.execute(sql.raw("insert /**/ into study_proofread_dispositions (note) values (null)"));'],
    ["DROP SCHEMA", "await db.execute(sql`drop schema public cascade`);"],
    ["DROP OWNED", "await db.execute(sql`drop owned by current_user`);"],
    ["COPY .. FROM PROGRAM into the log", "await db.execute(sql`copy study_proofread_dispositions from program 'true'`);"],
    ["SELECT .. INTO a copy of the log", "await db.execute(sql`select * into study_proofread_dispositions_copy from study_proofread_dispositions`);"],
    ["a delete with a bare alias on the log", "await db.execute(sql`delete from study_proofread_dispositions d where d.id = ${args.runId}`);"],
    // tables with no underscore, named from the schema (firms cascades to studies, runs and the log)
    ["a delete with a bare alias on firms, inside the loader", "await db.execute(sql`delete from firms f where f.id = ${args.runId}`);", "loader"],
    ["a delete with a bare alias on firms", "await db.execute(sql`delete from firms f where f.id = ${args.runId}`);"],
    ["a delete from users with a substituted condition", "{ const cond = sql.raw(\"where true\"); await db.execute(sql`delete from users ${cond}`); }"],
    ["an insert into users with an alias", "await db.execute(sql`insert into users as u (id) values (${args.runId})`);"],
    ["an insert into firms from a table", "await db.execute(sql.raw(\"insert into firms table firms_copy\"));"],
    // an UPDATE whose SET is not in the same literal
    ["an update of firms whose SET is a substitution", "{ const setF = sql.raw(\"set name = null\"); await db.execute(sql`update firms ${setF} where id = ${args.runId}`); }"],
    ["an update of the log by its table object, with the SET a substitution", "{ const setF = sql.raw(\"set note = null\"); await db.execute(sql`update ${studyProofreadDispositionsTable} ${setF}`); }"],
    ["an update whose table and SET are both substitutions", "{ const tbl = sql.raw(\"study_proofread_dispositions\"); const setF = sql.raw(\"set note = null\"); await db.execute(sql`update ${tbl} ${setF}`); }"],
    ["an update + chain whose SET is not a literal", "await db.execute(sql.raw(\"update \" + \"tis_\" + \"projects \" + (process.env.W ?? \"\")));"],
    // no whitespace between the verb and a quoted or substituted target (drizzle renders the table object as a quoted name)
    ["a delete from the log's table object with no space after FROM", "await db.execute(sql`delete from${studyProofreadDispositionsTable} where true`);"],
    ["an update of the log's table object with no space after UPDATE, the SET a substitution", "{ const patch = sql.raw(process.env.P ?? \"\"); await db.execute(sql`update${studyProofreadDispositionsTable} ${patch} where ${studyProofreadDispositionsTable.findingId} = ${args.runId}`); }"],
    ["an UPDATE ONLY of the log's table object with no space after ONLY", "{ const patch = sql.raw(process.env.P ?? \"\"); await db.execute(sql`update only${studyProofreadDispositionsTable} ${patch}`); }"],
    ["an insert into the log's table object with no space after INTO", "await db.execute(sql`insert into${studyProofreadDispositionsTable} (finding_id) values (${args.runId})`);"],
    ["a delete from a quoted firms with no space after FROM, inside the loader", "await db.execute(sql.raw('delete from\"firms\" where true'));", "loader"],
    ["a delete from ONLY a quoted users with no space after ONLY", "await db.execute(sql.raw('delete from only\"users\" f where true'));"],
    ["an insert into a quoted firms with no space either side", "await db.execute(sql.raw('insert into\"firms\"(id) values (1)'));"],
    // a Unicode-escaped quoted name, and a schema qualifier with whitespace around its dot
    ["a delete from the log by its Unicode-escaped quoted name", "await db.execute(sql.raw('delete from U&\"study_proofread_dispositions\" d where true'));"],
    ["a delete from firms spelled with Unicode escapes, inside the loader", "await db.execute(sql.raw('delete from U&\"\\\\0066irms\" f where true'));", "loader"],
    ["an insert into a Unicode-escaped firms from a table", "await db.execute(sql.raw('insert into U&\"firms\" table x'));"],
    ["a delete from firms qualified with spaces around the dot", "await db.execute(sql.raw(\"delete from public . firms f where true\"));"],
    ["an insert into users qualified with a space before the dot, with an alias", "await db.execute(sql.raw(\"insert into public .users as u (id) values (1)\"));"],
    // comments as Postgres lexes them: nested block comments, a line comment ended by CR, a comment opener in a string
    ["a delete from the log with a nested block comment before the table", "await db.execute(sql`delete from /* /* */ */ study_proofread_dispositions d where true`);"],
    ["a delete from the log with a line comment ended by a carriage return", "await db.execute(sql.raw(\"delete from --x\\rstudy_proofread_dispositions d where true\"));"],
    ["an insert into firms with a nested block comment between INSERT and INTO, inside the loader", "await db.execute(sql`insert /* /* */ */ into firms values (100)`);", "loader"],
    ["an update of the log's table object behind a nested comment, the SET a substitution", "{ const patch = sql.raw(process.env.P ?? \"\"); await db.execute(sql`update /* /* */ */ ${studyProofreadDispositionsTable} ${patch}`); }"],
    ["a delete of firms after a statement whose string holds a comment opener", "await db.execute(sql.raw(\"select '--'; delete /**/ from firms f where true\"));"],
    // the verb in its own literal inside a substitution
    ["a delete of the log whose verb is its own sql.raw literal", "await db.execute(sql`${sql.raw('delete from')} study_proofread_dispositions d where true`);"],
    ["a delete of firms whose verb is a nested sql template, inside the loader", "await db.execute(sql`${sql`delete from`} firms f where true`);", "loader"],
    ["an insert into firms with an alias whose verb is its own sql.raw literal", "await db.execute(sql`${sql.raw(\"insert into\")} firms as f values (default)`);"],
    ["a delete of the log's table object whose verb is its own sql.raw literal", "await db.execute(sql`${sql.raw('delete from')} ${studyProofreadDispositionsTable} where true`);"],
    ["an update whose verb is its own sql.raw literal, the table object and the SET substitutions", "{ const patch = sql.raw(process.env.P ?? \"\"); await db.execute(sql`${sql.raw('update')} ${studyProofreadDispositionsTable} ${patch}`); }"],
  ].map(([what, code, place]) => ({
    label: `store: raw SQL, ${what}`,
    file: "store",
    flips: ["store-no-raw-study-sql", "store-dispositions-are-append-only"],
    apply:
      place === "loader"
        ? edit("store", "  return row ?? null;\n}\n\n/**\n * Write a run's outcome.", `  ${code}\n  return row ?? null;\n}\n\n/**\n * Write a run's outcome.`)
        : edit("store", "  if (args.findings.length === 0) return;", `  ${code}\n  if (args.findings.length === 0) return;`),
  })),
  {
    label: "runner: a raw SQL delete with a bare alias on users (a schema table with no underscore)",
    file: "runner",
    flips: ["runner-has-no-db-writes"],
    apply: edit("runner", "    const rec: StudyRecord", '    const q = "delete from users u where u.id = $1";\n    const rec: StudyRecord'),
  },
  {
    label: "runner: a raw SQL update whose table and SET are substitutions",
    file: "runner",
    flips: ["runner-has-no-db-writes"],
    apply: edit("runner", "    const rec: StudyRecord", "    const tq = \"t\"; const sq = \"\"; const q = `update ${tq} ${sq}`;\n    const rec: StudyRecord"),
  },
  {
    label: "runner: a raw SQL delete from a quoted users with no space after FROM",
    file: "runner",
    flips: ["runner-has-no-db-writes"],
    apply: edit("runner", "    const rec: StudyRecord", "    const q = 'delete from\"users\" where true';\n    const rec: StudyRecord"),
  },
  {
    label: "runner: a raw SQL delete from users qualified with spaces around the dot",
    file: "runner",
    flips: ["runner-has-no-db-writes"],
    apply: edit("runner", "    const rec: StudyRecord", '    const q = "delete from public . users u where true";\n    const rec: StudyRecord'),
  },
  {
    label: "runner: a raw SQL delete with a nested block comment between DELETE and FROM",
    file: "runner",
    flips: ["runner-has-no-db-writes"],
    apply: edit("runner", "    const rec: StudyRecord", '    const q = "delete /* /* */ */ from firms f where true";\n    const rec: StudyRecord'),
  },
  {
    label: "routes: a raw SQL insert with a line comment ended by a carriage return between INSERT and INTO",
    file: "routes",
    flips: ["routes-do-not-touch-study"],
    apply: edit("routes", "const router: IRouter = Router();", 'const router: IRouter = Router();\nconst q10 = "insert --x\\rinto firms values (1)";'),
  },
  {
    label: "runner: a raw SQL delete whose verb is a string literal substituted into a template",
    file: "runner",
    flips: ["runner-has-no-db-writes"],
    apply: edit("runner", "    const rec: StudyRecord", '    const q = `${"delete from"} users u where true`;\n    const rec: StudyRecord'),
  },
  {
    label: "routes: a raw SQL insert whose verb is a call of one string literal, substituted into a template",
    file: "routes",
    flips: ["routes-do-not-touch-study"],
    apply: edit("routes", "const router: IRouter = Router();", 'const router: IRouter = Router();\nconst raw11 = (x: string) => x; const q11 = `${raw11("insert into")} firms as f values (1)`;'),
  },
  {
    label: "routes: a raw SQL delete from a Unicode-escaped quoted firms",
    file: "routes",
    flips: ["routes-do-not-touch-study"],
    apply: edit("routes", "const router: IRouter = Router();", "const router: IRouter = Router();\nconst q9 = 'delete from U&\"firms\" f where true';"),
  },
  {
    label: "routes: a raw SQL update whose substituted table follows UPDATE with no space",
    file: "routes",
    flips: ["routes-do-not-touch-study"],
    apply: edit("routes", "const router: IRouter = Router();", "const router: IRouter = Router();\nconst t8 = \"\"; const s8 = \"\"; const q8 = `update${t8} ${s8}`;"),
  },
  {
    label: "routes: a raw SQL delete with a bare alias on firms",
    file: "routes",
    flips: ["routes-do-not-touch-study"],
    apply: edit("routes", "const router: IRouter = Router();", 'const router: IRouter = Router();\nconst q6 = "delete from firms f where f.id = $1";'),
  },
  {
    label: "routes: a raw SQL update of users whose SET is a substitution",
    file: "routes",
    flips: ["routes-do-not-touch-study"],
    apply: edit("routes", "const router: IRouter = Router();", "const router: IRouter = Router();\nconst s7 = \"\"; const q7 = `update users ${s7}`;"),
  },
  {
    label: "runner: a raw SQL delete in a string (lowercase)",
    file: "runner",
    flips: ["runner-has-no-db-writes"],
    apply: edit("runner", "    const rec: StudyRecord", '    const q = "delete from study_proofread_dispositions where finding_id = $1";\n    const rec: StudyRecord'),
  },
  {
    label: "routes: a raw SQL update in a template (lowercase, table interpolated)",
    file: "routes",
    flips: ["routes-do-not-touch-study"],
    apply: edit("routes", "const router: IRouter = Router();", "const router: IRouter = Router();\nconst q3 = `update ${\"study_proofread_runs\"} set status = 'queued'`;"),
  },
  {
    label: "stop updating the run table (the write scan would then pass over nothing)",
    file: "store",
    flips: ["store-write-scan-sees-the-writes"],
    apply: edit("store", /\.update\(studyProofreadRunsTable\)/g, ".select(studyProofreadRunsTable)"),
  },
  {
    label: "stop inserting dispositions",
    file: "store",
    flips: ["store-write-scan-sees-the-writes"],
    apply: edit("store", /\.insert\(studyProofreadDispositionsTable\)/g, ".select(studyProofreadDispositionsTable)"),
  },

  {
    label: "drop the firm scope from findingAudienceForFirm",
    file: "store",
    flips: ["audience-lookup-is-firm-scoped"],
    apply: editAfter("store", "export async function findingAudienceForFirm", ", eq(studyProofreadRunsTable.firmId, firmId)", ""),
  },
  {
    label: "make findingAudienceForFirm's finding and firm conditions an `or`",
    file: "store",
    flips: ["audience-lookup-is-firm-scoped"],
    apply: editAfter("store", "export async function findingAudienceForFirm", ".where(and(eq(studyProofreadFindingsTable.id, findingId)", ".where(or(eq(studyProofreadFindingsTable.id, findingId)"),
  },
  {
    label: "drop the finding id from findingAudienceForFirm's WHERE (first finding of the firm)",
    file: "store",
    flips: ["audience-lookup-is-firm-scoped"],
    apply: editAfter("store", "export async function findingAudienceForFirm", "eq(studyProofreadFindingsTable.id, findingId), ", ""),
  },
  {
    label: "default an unknown finding's audience to 'engineer' (and its type to NOTE)",
    file: "store",
    flips: ["audience-lookup-fails-closed"],
    apply: editAfter("store", "export async function findingAudienceForFirm", "return row ?? null;", 'return row ?? { audience: "engineer", type: "NOTE" };'),
  },
  {
    label: "default a missing type to NOTE (the loosest set of decisions)",
    file: "store",
    flips: ["audience-lookup-fails-closed"],
    apply: editAfter("store", "export async function findingAudienceForFirm", "return row ?? null;", 'return row ? { ...row, type: row.type || "NOTE" } : null;'),
  },
  {
    label: "select the whole finding row for the audience",
    file: "store",
    flips: ["audience-lookup-fails-closed"],
    apply: editAfter("store", "export async function findingAudienceForFirm", ".select({ audience: studyProofreadFindingsTable.audience, type: studyProofreadFindingsTable.type })", ".select()"),
  },
  {
    label: "read the finding's type from another column (origin)",
    file: "store",
    flips: ["audience-lookup-fails-closed"],
    apply: editAfter("store", "export async function findingAudienceForFirm", "type: studyProofreadFindingsTable.type", "type: studyProofreadFindingsTable.origin"),
  },
  {
    label: "drop the firm scope from latestRunStatusForProject",
    file: "store",
    flips: ["latest-run-status-is-the-firms-newest"],
    apply: editAfter("store", "export async function latestRunStatusForProject", "eq(studyProofreadRunsTable.firmId, firmId), ", ""),
  },
  {
    label: "make latestRunStatusForProject's firm and project conditions an `or`",
    file: "store",
    flips: ["latest-run-status-is-the-firms-newest"],
    apply: editAfter("store", "export async function latestRunStatusForProject", ".where(and(eq(studyProofreadRunsTable.firmId, firmId)", ".where(or(eq(studyProofreadRunsTable.firmId, firmId)"),
  },
  {
    label: "drop the project from latestRunStatusForProject's WHERE (the firm's newest run of any project)",
    file: "store",
    flips: ["latest-run-status-is-the-firms-newest"],
    apply: editAfter("store", "export async function latestRunStatusForProject", ", eq(studyProofreadRunsTable.projectId, projectId)", ""),
  },
  {
    label: "order latestRunStatusForProject oldest first",
    file: "store",
    flips: ["latest-run-status-is-the-firms-newest"],
    apply: editAfter("store", "export async function latestRunStatusForProject", ".orderBy(desc(studyProofreadRunsTable.revision))", ".orderBy(studyProofreadRunsTable.revision)"),
  },
  {
    label: "order latestRunStatusForProject by creation time instead of revision",
    file: "store",
    flips: ["latest-run-status-is-the-firms-newest"],
    apply: editAfter("store", "export async function latestRunStatusForProject", ".orderBy(desc(studyProofreadRunsTable.revision))", ".orderBy(desc(studyProofreadRunsTable.createdAt))"),
  },
  {
    label: "latestRunStatusForProject defaults a missing run to a finished one",
    file: "store",
    flips: ["latest-run-status-fails-closed"],
    apply: editAfter("store", "export async function latestRunStatusForProject", "return row ?? null;", 'return row ?? { id: projectId, status: "rules_ready" };'),
  },
  {
    label: "latestRunStatusForProject reads the status from another column",
    file: "store",
    flips: ["latest-run-status-fails-closed"],
    apply: editAfter("store", "export async function latestRunStatusForProject", "status: studyProofreadRunsTable.status", "status: studyProofreadRunsTable.error"),
  },
  {
    label: "latestRunStatusForProject selects the whole run row",
    file: "store",
    flips: ["latest-run-status-fails-closed"],
    apply: editAfter("store", "export async function latestRunStatusForProject", ".select({ id: studyProofreadRunsTable.id, status: studyProofreadRunsTable.status })", ".select()"),
  },
  {
    label: "latestRunForProject drops the admin findings in JS (.filter on the read)",
    file: "store",
    flips: ["panel-read-serves-every-finding"],
    apply: edit("store", "    .where(eq(studyProofreadFindingsTable.runId, run.id));\n  // Scoped in SQL", '    .where(eq(studyProofreadFindingsTable.runId, run.id))\n    .then((rows) => rows.filter((f) => f.audience !== "admin"));\n  // Scoped in SQL'),
  },
  {
    label: "latestRunForProject drops the admin findings in the WHERE (sql)",
    file: "store",
    flips: ["panel-read-serves-every-finding"],
    apply: edit("store", "    .where(eq(studyProofreadFindingsTable.runId, run.id));\n  // Scoped in SQL", "    .where(and(eq(studyProofreadFindingsTable.runId, run.id), sql`${studyProofreadFindingsTable.audience} <> 'admin'`));\n  // Scoped in SQL"),
  },
  {
    label: "latestRunForProject reads every finding, then serves a filtered copy",
    file: "store",
    flips: ["panel-read-serves-every-finding"],
    apply: (s) => ({
      ...s,
      store: s.store
        .replace("  const findings = await db\n    .select()\n    .from(studyProofreadFindingsTable)\n    .where(eq(studyProofreadFindingsTable.runId, run.id));\n", '  const rows = await db\n    .select()\n    .from(studyProofreadFindingsTable)\n    .where(eq(studyProofreadFindingsTable.runId, run.id));\n  const findings = rows.filter((f) => f.audience !== "admin");\n'),
    }),
  },
  {
    label: "latestRunForProject splices the admin findings out of the list",
    file: "store",
    flips: ["panel-read-serves-every-finding"],
    apply: edit("store", "  const dispositions = findings.length", '  findings.splice(0, findings.length, ...findings.filter((f) => f.audience !== "admin"));\n  const dispositions = findings.length'),
  },
  {
    label: "latestRunForProject relabels every DEFECT as the engineer's",
    file: "store",
    flips: ["panel-read-serves-every-finding"],
    apply: edit("store", "  const dispositions = findings.length", '  for (const f of findings) if (f.type === "DEFECT") f.audience = "engineer";\n  const dispositions = findings.length'),
  },
  {
    label: "latestRunForProject returns a filtered list in place of the one it read",
    file: "store",
    flips: ["panel-read-serves-every-finding"],
    apply: edit("store", "  return { run, findings, dispositions, previous };", '  return { run, findings: findings.filter((f) => f.type !== "DEFECT"), dispositions, previous };'),
  },
  {
    label: "latestRunForProject reads the previous revision from one revision too far",
    file: "store",
    flips: ["panel-read-names-the-carry-source"],
    apply: edit("store", "previousRunForProject(run.projectId, run.revision);", "previousRunForProject(run.projectId, run.revision + 1);"),
  },
  {
    label: "latestRunForProject hands back no previous revision",
    file: "store",
    flips: ["panel-read-names-the-carry-source"],
    also: ["panel-read-serves-every-finding"],
    apply: edit("store", "  return { run, findings, dispositions, previous };", "  void previous;\n  return { run, findings, dispositions, previous: null };"),
  },
  {
    label: "latestRunForProject reads the previous revision with a query of its own (any status)",
    file: "store",
    flips: ["panel-read-names-the-carry-source"],
    apply: edit(
      "store",
      "  const previous = await previousRunForProject(run.projectId, run.revision);",
      "  const [previous = null] = await db\n    .select({ id: studyProofreadRunsTable.id, rulesVersion: studyProofreadRunsTable.rulesVersion })\n    .from(studyProofreadRunsTable)\n    .where(and(eq(studyProofreadRunsTable.projectId, run.projectId), lt(studyProofreadRunsTable.revision, run.revision)))\n    .orderBy(desc(studyProofreadRunsTable.revision))\n    .limit(1);",
    ),
  },
  {
    label: "completeRun writes findings without their audience (the column defaults to engineer)",
    file: "store",
    flips: ["findings-written-with-their-audience"],
    apply: edit("store", "        audience: f.audience,\n", ""),
  },
  {
    label: "completeRun writes every finding with the engineer's audience",
    file: "store",
    flips: ["findings-written-with-their-audience"],
    apply: edit("store", "        audience: f.audience,\n", '        audience: "engineer" as const,\n'),
  },
  {
    label: "completeRun names an audience twice (the later key wins)",
    file: "store",
    flips: ["findings-written-with-their-audience"],
    apply: edit("store", "        fingerprint: findingFingerprint(f),\n", '        fingerprint: findingFingerprint(f),\n        ...{ audience: "engineer" },\n'),
  },
  {
    label: "latestRunStatusForProject rewrites a found run's status to rules_ready after the read (every newest run passes the 409)",
    file: "store",
    flips: ["latest-run-status-fails-closed"],
    apply: editAfter("store", "export async function latestRunStatusForProject", "  return row ?? null;", '  if (row) row.status = "rules_ready";\n  return row ?? null;'),
  },
  {
    label: "latestRunStatusForProject rebuilds the row in its return",
    file: "store",
    flips: ["latest-run-status-fails-closed"],
    apply: editAfter("store", "export async function latestRunStatusForProject", "return row ?? null;", 'return row ? { id: row.id, status: "rules_ready" } : null;'),
  },
  {
    label: "latestRunStatusForProject remaps its rows inside the chain (.then)",
    file: "store",
    flips: ["latest-run-status-fails-closed"],
    // the read's text pin ends in `.limit(1);`, so a link after it moves that pin too
    also: ["latest-run-status-is-the-firms-newest"],
    apply: editAfter("store", "export async function latestRunStatusForProject", "    .limit(1);\n  return row ?? null;", '    .limit(1)\n    .then((rs) => rs.map((r) => ({ ...r, status: "rules_ready" })));\n  return row ?? null;'),
  },
  {
    label: "findingAudienceForFirm rewrites a BLOCKER's type to NOTE after the read (offered DISCLOSED)",
    file: "store",
    flips: ["audience-lookup-fails-closed"],
    apply: editAfter("store", "export async function findingAudienceForFirm", "  return row ?? null;", '  if (row && row.type === "BLOCKER") row.type = "NOTE";\n  return row ?? null;'),
  },
  {
    label: "findingAudienceForFirm rebuilds the row in its return with the engineer's audience",
    file: "store",
    flips: ["audience-lookup-fails-closed"],
    apply: editAfter("store", "export async function findingAudienceForFirm", "return row ?? null;", 'return row ? { audience: "engineer", type: row.type } : null;'),
  },
  {
    label: "findingAudienceForFirm remaps its rows inside the chain (.then)",
    file: "store",
    flips: ["audience-lookup-fails-closed"],
    // the read's text pin ends in `.limit(1);`, so a link after it moves that pin too
    also: ["audience-lookup-is-firm-scoped"],
    apply: editAfter("store", "export async function findingAudienceForFirm", "    .limit(1);\n  return row ?? null;", '    .limit(1)\n    .then((rs) => rs.map((r) => ({ ...r, audience: "engineer" })));\n  return row ?? null;'),
  },

  // ---- runner -----------------------------------------------------------------
  {
    label: "import the study table into the runner",
    file: "runner",
    flips: ["runner-has-no-db-writes"],
    also: ["runner-import-whitelist"],
    apply: edit("runner", 'import type { StudyProofreadRun } from "@workspace/db";', 'import { tisProjectsTable } from "@workspace/db";\nimport type { StudyProofreadRun } from "@workspace/db";'),
  },
  {
    label: "make the runner's db import a value import",
    file: "runner",
    flips: ["runner-has-no-db-writes"],
    also: ["runner-import-whitelist"],
    apply: edit("runner", 'import type { StudyProofreadRun } from "@workspace/db";', 'import { db, type StudyProofreadRun } from "@workspace/db";'),
  },
  {
    label: "write from the runner",
    file: "runner",
    flips: ["runner-has-no-db-writes"],
    apply: edit("runner", "    const rec: StudyRecord", "    await x.update(y);\n    const rec: StudyRecord"),
  },

  // ---- import whitelists: a study write reached THROUGH another module --------
  {
    label: "store imports setProjectTheme from ./tis-projects and calls it after a claim (the reviewer's attack, in the store)",
    file: "store",
    flips: ["store-import-whitelist"],
    apply: chain(
      edit("store", 'import { logger } from "./logger";', 'import { logger } from "./logger";\nimport { setProjectTheme } from "./tis-projects";'),
      edit("store", "    .returning();\n  return row ?? null;\n}\n\nexport async function loadStudyForRun", "    .returning();\n  if (row) await setProjectTheme(row.firmId, row.projectId, null);\n  return row ?? null;\n}\n\nexport async function loadStudyForRun"),
    ),
  },
  {
    label: "runner imports setProjectTheme from ./tis-projects and calls it after the clause pass (the reviewer's attack, in the runner)",
    file: "runner",
    flips: ["runner-import-whitelist"],
    apply: chain(
      edit("runner", 'import { logger } from "./logger";', 'import { logger } from "./logger";\nimport { setProjectTheme } from "./tis-projects";'),
      edit("runner", "    const { findings, coverage } = runClauses(rec, ALL_CLAUSES);", "    const { findings, coverage } = runClauses(rec, ALL_CLAUSES);\n    await setProjectTheme(run.firmId, run.projectId, null);"),
    ),
  },
  {
    label: "store adds a symbol to an allowed module's import list (drizzle's `or`)",
    file: "store",
    flips: ["store-import-whitelist"],
    apply: edit("store", 'import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";', 'import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";'),
  },
  {
    label: "store adds a symbol to the lifecycle import",
    file: "store",
    flips: ["store-import-whitelist"],
    apply: edit("store", 'import { CLAIM_PREDICATE_SQL } from "./proofread/lifecycle.ts";', 'import { CLAIM_PREDICATE_SQL, MAX_ATTEMPTS } from "./proofread/lifecycle.ts";'),
  },
  {
    label: "store imports the routes' limiters (an allowed module elsewhere is not an allowed module here)",
    file: "store",
    flips: ["store-import-whitelist"],
    apply: edit("store", 'import { logger } from "./logger";', 'import { logger } from "./logger";\nimport { proofreadRunLimiter } from "./security";'),
  },
  {
    label: "store re-exports from another module",
    file: "store",
    flips: ["store-import-whitelist"],
    apply: edit("store", 'import { logger } from "./logger";', 'import { logger } from "./logger";\nexport { setProjectTheme } from "./tis-projects";'),
  },
  {
    label: "store imports another module for its side effects",
    file: "store",
    flips: ["store-import-whitelist"],
    apply: edit("store", 'import { logger } from "./logger";', 'import { logger } from "./logger";\nimport "./tis-projects";'),
  },
  {
    label: "store imports with no trailing semicolon (a parser that insists on one never sees it)",
    file: "store",
    flips: ["store-import-whitelist"],
    apply: edit("store", 'import { logger } from "./logger";', 'import { logger } from "./logger"\nimport { setProjectTheme } from "./tis-projects"'),
  },
  {
    label: "store pulls a module in with a dynamic import",
    file: "store",
    flips: ["store-import-whitelist"],
    apply: edit("store", "  if (args.findings.length === 0) return;", '  await (await import("./tis-projects")).setProjectTheme(args.runId, args.runId, null);\n  if (args.findings.length === 0) return;'),
  },
  {
    label: "store pulls a module in with require",
    file: "store",
    flips: ["store-import-whitelist"],
    apply: edit("store", "  if (args.findings.length === 0) return;", '  await require("./tis-projects").setProjectTheme(args.runId, args.runId, null);\n  if (args.findings.length === 0) return;'),
  },
  {
    label: "store drops one of its legitimate imports (a whitelist that only checks for extras would not notice)",
    file: "store",
    flips: ["store-import-whitelist"],
    apply: edit("store", 'import { logger } from "./logger";\n', ""),
  },
  {
    label: "runner adds a symbol to the store import",
    file: "runner",
    flips: ["runner-import-whitelist"],
    apply: edit("runner", "  runHoldsFindings,\n} from \"./proofread-store\";", "  runHoldsFindings,\n  insertDisposition,\n} from \"./proofread-store\";"),
  },
  {
    label: "runner imports the whole projects module under a namespace",
    file: "runner",
    flips: ["runner-import-whitelist"],
    apply: edit("runner", 'import { logger } from "./logger";', 'import { logger } from "./logger";\nimport * as projects from "./tis-projects";'),
  },
  {
    label: "runner re-exports from another module",
    file: "runner",
    flips: ["runner-import-whitelist"],
    apply: edit("runner", 'import { logger } from "./logger";', 'import { logger } from "./logger";\nexport * from "./tis-projects";'),
  },
  {
    label: "runner imports another module for its side effects",
    file: "runner",
    flips: ["runner-import-whitelist"],
    apply: edit("runner", 'import { logger } from "./logger";', 'import { logger } from "./logger";\nimport "./tis-projects";'),
  },
  {
    label: "runner pulls a module in with a dynamic import",
    file: "runner",
    flips: ["runner-import-whitelist"],
    apply: edit("runner", "    const rec: StudyRecord", '    await (await import("./tis-projects")).setProjectTheme(run.firmId, run.projectId, null);\n    const rec: StudyRecord'),
  },
  {
    label: "runner imports a default export from another module",
    file: "runner",
    flips: ["runner-import-whitelist"],
    apply: edit("runner", 'import { logger } from "./logger";', 'import { logger } from "./logger";\nimport projectsModule from "./tis-projects";'),
  },
  // One mutation per spelling of a way into another module, on the REAL store and the
  // REAL runner. Every one compiles under TypeScript 5.9; a line-anchored regex parser
  // passed each of them.
  ...EVASIONS.flatMap(([what, text, sameLine]) =>
    [
      ["store", "store-import-whitelist"],
      ["runner", "runner-import-whitelist"],
    ].map(([file, check]) => ({
      label: `${file} imports a forbidden module through ${what}`,
      file,
      flips: [check],
      apply: edit(file, 'import { logger } from "./logger";', `import { logger } from "./logger";${sameLine ? " " : "\n"}${text}`),
    })),
  ),
  {
    label: "store: a regex literal ending in // on the same line as await import(...) (the hand-rolled comment stripper deleted the rest of that line)",
    file: "store",
    flips: ["store-import-whitelist"],
    apply: edit("store", "  if (args.findings.length === 0) return;", '  const rx = /\\//; await import("./tis-projects");\n  if (args.findings.length === 0) return;'),
  },
  {
    label: "runner: a regex literal ending in // on the same line as await import(...)",
    file: "runner",
    flips: ["runner-import-whitelist"],
    apply: edit("runner", "    const rec: StudyRecord", '    const rx = /\\//; await import("./tis-projects");\n    const rec: StudyRecord'),
  },
  {
    label: "store: a typeof import(...) type query naming another module",
    file: "store",
    flips: ["store-import-whitelist"],
    apply: edit("store", 'import { logger } from "./logger";', 'import { logger } from "./logger";\ntype Projects = typeof import("./tis-projects");'),
  },
  {
    label: "runner: module.require(...)",
    file: "runner",
    flips: ["runner-import-whitelist"],
    apply: edit("runner", "    const rec: StudyRecord", '    module.require("./tis-projects");\n    const rec: StudyRecord'),
  },
  {
    label: "runner: eval of an import",
    file: "runner",
    flips: ["runner-import-whitelist"],
    apply: edit("runner", "    const rec: StudyRecord", '    await eval(\'import("./tis-projects")\');\n    const rec: StudyRecord'),
  },
  {
    label: "a clause file imports the database with single quotes",
    file: "clauseDir",
    flips: ["proofread-dir-imports-whitelist"],
    apply: editDir("s1-inputs.ts", 'import { isGrowthOverride } from "@workspace/tis-engine-core";', "import { isGrowthOverride } from \"@workspace/tis-engine-core\";\n/* x */ import { db } from '@workspace/db';"),
  },
  // Module loaders no import statement shows, in each of the four scopes (live under Node 22.3+, the production pin).
  ...[
    ["process.getBuiltinModule(\"module\").createRequire", 'const rq1 = process.getBuiltinModule("module").createRequire(import.meta.url); void rq1("./tis-projects");'],
    ["an AsyncFunction built from a string through .constructor", "void (async () => 0).constructor(\"return import('./tis-projects')\")();"],
    ["createRequire reached through a string key", 'const cr = (globalThis as any)["createRequire"]; void cr;'],
    ["require reached through a string key", 'void (module as any)["require"]("./tis-projects");'],
    ["an aliased .constructor", "const Ca = (async () => 0).constructor; void Ca(\"return import('./tis-projects')\")();"],
    ["a destructured constructor", 'const { constructor: Cd } = () => 0; void Cd("return 1");'],
    [".constructor reached through .call", 'void (() => 0).constructor.call(null, "return 1");'],
  ].flatMap(([what, code]) => [
    { label: `store: a module loaded through ${what}`, file: "store", flips: ["store-import-whitelist"], apply: edit("store", "  if (args.findings.length === 0) return;", `  ${code}\n  if (args.findings.length === 0) return;`) },
    { label: `runner: a module loaded through ${what}`, file: "runner", flips: ["runner-import-whitelist"], apply: edit("runner", "    const rec: StudyRecord", `    ${code}\n    const rec: StudyRecord`) },
    { label: `routes: a module loaded through ${what}`, file: "routes", flips: ["routes-import-whitelist"], apply: edit("routes", "const router: IRouter = Router();", `const router: IRouter = Router();\n${code}`) },
    { label: `a clause file: a module loaded through ${what}`, file: "clauseDir", flips: ["proofread-dir-imports-whitelist"], apply: editDir("fingerprint.ts", 'import type { ProofreadFinding } from "./types.ts";', `import type { ProofreadFinding } from "./types.ts";\n${code}`) },
  ]),
  // An alias swap at import: the code keeps saying `studyProofreadRunsTable`, and every
  // check that reads local identifiers is satisfied, while the name now means another table.
  {
    label: "store swaps two allowed names by alias at the @workspace/db import (every db.update(studyProofreadRunsTable) now targets tis_projects)",
    file: "store",
    flips: ["store-import-whitelist"],
    apply: edit("store", "  studyProofreadRunsTable,\n  tisProjectsTable,\n", "  studyProofreadRunsTable as tisProjectsTable,\n  tisProjectsTable as studyProofreadRunsTable,\n"),
  },
  {
    label: "runner swaps two store functions by alias at its import (every claimOneRun(...) now calls completeRun)",
    file: "runner",
    flips: ["runner-import-whitelist"],
    apply: edit("runner", "  claimOneRun,\n  completeRun,\n", "  claimOneRun as completeRun,\n  completeRun as claimOneRun,\n"),
  },
  {
    label: "routes rotate the three limiters by alias (the read route is now bound to the disposition budget, and so on)",
    file: "routes",
    flips: ["routes-import-whitelist"],
    apply: edit("routes", "import { proofreadDispositionLimiter, proofreadReadLimiter, proofreadRunLimiter }", "import { proofreadDispositionLimiter as proofreadReadLimiter, proofreadReadLimiter as proofreadRunLimiter, proofreadRunLimiter as proofreadDispositionLimiter }"),
  },
  {
    label: "store renames one allowed name to a different one by alias (db as the logger's name)",
    file: "store",
    flips: ["store-import-whitelist"],
    apply: edit("store", 'import { logger } from "./logger";', 'import { logger as db } from "./logger";'),
  },
  {
    label: "runner renames its default import (node:path as posix)",
    file: "runner",
    flips: ["runner-import-whitelist"],
    apply: edit("runner", 'import path from "node:path";', 'import posix from "node:path";'),
  },
  {
    label: "store aliases a type-only import",
    file: "store",
    flips: ["store-import-whitelist"],
    apply: edit("store", "  type StudyProofreadRun,\n", "  type StudyProofreadRun as Run,\n"),
  },
  {
    label: "a clause file imports the database",
    file: "clauseDir",
    flips: ["proofread-dir-imports-whitelist"],
    apply: editDir("s1-inputs.ts", 'import { isGrowthOverride } from "@workspace/tis-engine-core";', 'import { isGrowthOverride } from "@workspace/tis-engine-core";\nimport { db } from "@workspace/db";'),
  },
  {
    label: "a clause file imports setProjectTheme from the lib directory",
    file: "clauseDir",
    flips: ["proofread-dir-imports-whitelist"],
    apply: editDir("prose.ts", 'import type { StudyRecord } from "./types.ts";', 'import type { StudyRecord } from "./types.ts";\nimport { setProjectTheme } from "../tis-projects";'),
  },
  {
    label: "types.ts turns its tis-api-zod import into a value import",
    file: "clauseDir",
    flips: ["proofread-dir-imports-whitelist"],
    apply: editDir("types.ts", 'import type { TisReport, TisRequest } from "@workspace/tis-api-zod";', 'import { TisReport, TisRequest } from "@workspace/tis-api-zod";'),
  },
  {
    label: "a clause file imports a node module",
    file: "clauseDir",
    flips: ["proofread-dir-imports-whitelist"],
    apply: editDir("s5-criteria.ts", 'import { authoredProse } from "./prose.ts";', 'import { authoredProse } from "./prose.ts";\nimport { readFileSync } from "node:fs";'),
  },
  {
    label: "a clause file imports a sibling that does not exist",
    file: "clauseDir",
    flips: ["proofread-dir-imports-whitelist"],
    apply: editDir("s6-limitations.ts", 'import { numeric } from "./types.ts";', 'import { numeric } from "./types.ts";\nimport { x } from "./writer.ts";'),
  },
  {
    label: "a clause file pulls a module in with a dynamic import",
    file: "clauseDir",
    flips: ["proofread-dir-imports-whitelist"],
    apply: editDir("fingerprint.ts", 'import type { ProofreadFinding } from "./types.ts";', 'import type { ProofreadFinding } from "./types.ts";\nconst late = () => import("../tis-projects");'),
  },
  {
    label: "the clause index re-exports from outside the directory",
    file: "clauseDir",
    flips: ["proofread-dir-imports-whitelist"],
    apply: editDir("index.ts", 'export * from "./types.ts";', 'export * from "./types.ts";\nexport { setProjectTheme } from "../tis-projects";'),
  },
  {
    label: "a clause file imports another package",
    file: "clauseDir",
    flips: ["proofread-dir-imports-whitelist"],
    apply: editDir("s2-trip-gen.ts", 'import { LAND_USES } from "@workspace/tis-engine-core";', 'import { LAND_USES } from "@workspace/tis-engine-core";\nimport { sql } from "drizzle-orm";'),
  },

  // ---- the write scan, one mutation per spelling of a write, on the REAL store/runner/routes ----
  ...WRITE_FORMS.flatMap(([what, code, callForm]) => {
    const flips = callForm ? ["store-writes-only-proofread-tables", "store-study-row-is-read-only"] : ["store-writes-only-proofread-tables", "store-study-row-is-read-only", "store-dispositions-are-append-only"];
    return [
      {
        label: `store: a study write through ${what}, inside loadStudyForRun`,
        file: "store",
        flips,
        apply: edit("store", "  return row ?? null;\n}\n\n/**\n * Write a run's outcome.", `  ${code}\n  return row ?? null;\n}\n\n/**\n * Write a run's outcome.`),
      },
      {
        label: `store: a study write through ${what}, inside completeRun`,
        file: "store",
        flips,
        apply: edit("store", "  if (args.findings.length === 0) return;", `  ${code}\n  if (args.findings.length === 0) return;`),
      },
    ];
  }),
  ...[
    ["an element access with a string literal", 'await db["update"](tisProjectsTable);'],
    ["a destructured binding from db", "const { update } = db; await update(tisProjectsTable);"],
    ["a regex literal ending in // on the same line", "const rx = /\\//; await db.update(tisProjectsTable);"],
  ].map(([what, code]) => ({
    label: `runner: a write through ${what}`,
    file: "runner",
    flips: ["runner-has-no-db-writes"],
    apply: edit("runner", "    const rec: StudyRecord", `    ${code}\n    const rec: StudyRecord`),
  })),
  ...[
    ["an element access with a string literal", 'void db["update"](x);'],
    ["a destructured binding", "const { insert } = db;"],
    ["a regex literal ending in // on the same line", "const rx = /\\//; void db.update(x);"],
  ].map(([what, code]) => ({
    label: `routes: a write through ${what}`,
    file: "routes",
    flips: ["routes-do-not-touch-study"],
    apply: edit("routes", "const router: IRouter = Router();", `const router: IRouter = Router();\n${code}`),
  })),

  // ---- reflection on a db-derived value, one mutation per form, in the loader and in completeRun ----
  ...REFLECTION_FORMS.flatMap(([what, code, usesStudy]) => [
    {
      label: `store: ${what}, inside loadStudyForRun`,
      file: "store",
      flips: ["store-writes-only-proofread-tables", "store-study-row-is-read-only", "store-dispositions-are-append-only"],
      apply: edit("store", "  return row ?? null;\n}\n\n/**\n * Write a run's outcome.", `  ${code}\n  return row ?? null;\n}\n\n/**\n * Write a run's outcome.`),
    },
    {
      label: `store: ${what}, inside completeRun`,
      file: "store",
      flips: usesStudy ? ["store-writes-only-proofread-tables", "store-study-row-is-read-only", "store-dispositions-are-append-only"] : ["store-writes-only-proofread-tables", "store-dispositions-are-append-only"],
      apply: edit("store", "  if (args.findings.length === 0) return;", `  ${code}\n  if (args.findings.length === 0) return;`),
    },
  ]),

  {
    label: "store: a module-level helper whose parameter is called tx (a transaction handle by convention), with a computed access",
    file: "store",
    flips: ["store-writes-only-proofread-tables", "store-dispositions-are-append-only"],
    apply: edit("store", "export async function insertQueuedRun(args: {", 'async function bump(tx: any, k: string) { await tx[k](studyProofreadRunsTable); }\n\nexport async function insertQueuedRun(args: {'),
  },

  // ---- the substring scans the exact AST matches had dropped, restored as extra conjuncts ----
  {
    label: "routes: a string that mentions result_payload and tis_projects (no identifier, no whole-literal match)",
    file: "routes",
    flips: ["routes-do-not-touch-study"],
    apply: edit("routes", "const router: IRouter = Router();", 'const router: IRouter = Router();\nconst q1 = "select result_payload from tis_projects";'),
  },
  {
    label: "routes: a template with a substitution that mentions request_payload",
    file: "routes",
    flips: ["routes-do-not-touch-study"],
    apply: edit("routes", "const router: IRouter = Router();", "const router: IRouter = Router();\nconst q2 = `select ${1}, request_payload`;"),
  },
  {
    label: "runner: a string that mentions requestPayload",
    file: "runner",
    flips: ["runner-has-no-db-writes"],
    apply: edit("runner", "    const rec: StudyRecord", '    const s1 = "study.requestPayload.rows";\n    const rec: StudyRecord'),
  },
  {
    label: "runner: a string that mentions tisProjectsTable",
    file: "runner",
    flips: ["runner-has-no-db-writes"],
    apply: edit("runner", "    const rec: StudyRecord", '    const s2 = "see tisProjectsTable";\n    const rec: StudyRecord'),
  },
  {
    label: "store: a string that mentions tisProjectsTable outside the loader",
    file: "store",
    flips: ["store-study-row-is-read-only"],
    apply: edit("store", "  if (args.findings.length === 0) return;", '  const s3 = "see tisProjectsTable";\n  if (args.findings.length === 0) return;'),
  },
  {
    label: "store: the upsert destructured off an insert builder, then called through .call",
    file: "store",
    flips: ["store-dispositions-are-append-only"],
    apply: edit("store", "  if (args.findings.length === 0) return;", "  const { onConflictDoUpdate } = db.insert(studyProofreadDispositionsTable).values({} as any);\n  onConflictDoUpdate.call(null, {});\n  if (args.findings.length === 0) return;"),
  },
  {
    label: "a clause file dynamically imports one of its own siblings by a literal specifier",
    file: "clauseDir",
    flips: ["proofread-dir-imports-whitelist"],
    apply: editDir("fingerprint.ts", 'import type { ProofreadFinding } from "./types.ts";', 'import type { ProofreadFinding } from "./types.ts";\nvoid import("./types.ts");'),
  },
  {
    label: "a clause file dynamically imports tis-engine-core by a literal specifier",
    file: "clauseDir",
    flips: ["proofread-dir-imports-whitelist"],
    apply: editDir("prose.ts", 'import type { StudyRecord } from "./types.ts";', 'import type { StudyRecord } from "./types.ts";\nvoid import("@workspace/tis-engine-core");'),
  },
  {
    label: "a clause file requires one of its siblings",
    file: "clauseDir",
    flips: ["proofread-dir-imports-whitelist"],
    apply: editDir("s6-limitations.ts", 'import { numeric } from "./types.ts";', 'import { numeric } from "./types.ts";\nvoid require("./types.ts");'),
  },

  // ---- tis-projects.ts --------------------------------------------------------
  {
    label: "match the project OR the firm in projectExistsForFirm",
    file: "tisProjects",
    flips: ["exists-is-firm-scoped"],
    apply: edit("tisProjects", /and\(eq\(tisProjectsTable\.id, id\), eq\(tisProjectsTable\.firmId, firmId\)\)\)\n    \.limit\(1\);\n  return !!row;/, "or(eq(tisProjectsTable.id, id), eq(tisProjectsTable.firmId, firmId)))\n    .limit(1);\n  return !!row;"),
  },
  {
    label: "drop the firm arm from projectExistsForFirm",
    file: "tisProjects",
    flips: ["exists-is-firm-scoped"],
    apply: edit("tisProjects", /and\(eq\(tisProjectsTable\.id, id\), eq\(tisProjectsTable\.firmId, firmId\)\)\)\n    \.limit\(1\);\n  return !!row;/, "eq(tisProjectsTable.id, id))\n    .limit(1);\n  return !!row;"),
  },
  {
    label: "select the whole project row in projectExistsForFirm",
    file: "tisProjects",
    flips: ["exists-selects-the-id-only"],
    apply: edit("tisProjects", ".select({ id: tisProjectsTable.id })\n    .from(tisProjectsTable)\n    .where(and(eq(tisProjectsTable.id, id), eq(tisProjectsTable.firmId, firmId)))\n    .limit(1);\n  return !!row;", ".select()\n    .from(tisProjectsTable)\n    .where(and(eq(tisProjectsTable.id, id), eq(tisProjectsTable.firmId, firmId)))\n    .limit(1);\n  return !!row;"),
  },
  {
    label: "select a payload column in projectExistsForFirm",
    file: "tisProjects",
    flips: ["exists-selects-the-id-only"],
    apply: edit("tisProjects", ".select({ id: tisProjectsTable.id })\n    .from(tisProjectsTable)\n    .where(and(eq(tisProjectsTable.id, id), eq(tisProjectsTable.firmId, firmId)))\n    .limit(1);\n  return !!row;", ".select({ id: tisProjectsTable.id, result: tisProjectsTable.resultPayload })\n    .from(tisProjectsTable)\n    .where(and(eq(tisProjectsTable.id, id), eq(tisProjectsTable.firmId, firmId)))\n    .limit(1);\n  return !!row;"),
  },

  // ---- security.ts ------------------------------------------------------------
  {
    label: "remove the run limiter",
    file: "security",
    flips: ["limiters-exist", ...LIMITER_PROPS],
    apply: edit("security", "export const proofreadRunLimiter = rateLimit(", "export const proofreadRunLimiterRenamed = rateLimit("),
  },
  {
    label: "run limiter says standardHeaders: true",
    file: "security",
    flips: ["limiters-pin-draft-7", "no-boolean-standard-headers"],
    apply: editAfter("security", "export const proofreadRunLimiter", 'standardHeaders: "draft-7"', "standardHeaders: true"),
  },
  {
    label: "read limiter says standardHeaders: true",
    file: "security",
    flips: ["limiters-pin-draft-7", "no-boolean-standard-headers"],
    apply: editAfter("security", "export const proofreadReadLimiter", 'standardHeaders: "draft-7"', "standardHeaders: true"),
  },
  {
    label: "an EXISTING limiter says standardHeaders: true",
    file: "security",
    flips: ["no-boolean-standard-headers"],
    apply: editAfter("security", "export const generateRateLimiter", 'standardHeaders: "draft-7"', "standardHeaders: true"),
  },
  {
    label: "triage limiter turns legacy headers on",
    file: "security",
    flips: ["limiters-legacy-and-fail-open"],
    apply: editAfter("security", "export const proofreadDispositionLimiter", "legacyHeaders: false", "legacyHeaders: true"),
  },
  {
    label: "read limiter drops passOnStoreError",
    file: "security",
    flips: ["limiters-legacy-and-fail-open"],
    apply: editAfter("security", "export const proofreadReadLimiter", "  passOnStoreError: true,\n", ""),
  },
  {
    label: "run limiter keys on raw req.ip",
    file: "security",
    flips: ["limiters-keyed-per-user"],
    apply: editAfter("security", "export const proofreadRunLimiter", 'req.user?.id ?? ipKeyGenerator(req.ip ?? "")', 'req.user?.id ?? req.ip ?? ""'),
  },
  {
    label: "triage limiter keys per IP only (one shared office = one budget)",
    file: "security",
    flips: ["limiters-keyed-per-user"],
    apply: editAfter("security", "export const proofreadDispositionLimiter", 'req.user?.id ?? ipKeyGenerator(req.ip ?? "")', 'ipKeyGenerator(req.ip ?? "")'),
  },
  {
    label: "triage shares the run limiter's Redis prefix (one counter for both)",
    file: "security",
    flips: ["limiters-have-own-prefixes"],
    apply: edit("security", 'makeRateLimitStore("rl:proofread-disp:")', 'makeRateLimitStore("rl:proofread:")'),
  },
  {
    label: "triage takes an existing limiter's prefix",
    file: "security",
    flips: ["limiters-have-own-prefixes"],
    apply: edit("security", 'makeRateLimitStore("rl:proofread-disp:")', 'makeRateLimitStore("rl:whatif:")'),
  },
  {
    label: "run limiter drops its admin exemption",
    file: "security",
    flips: ["limiters-exempt-dev-and-admin"],
    apply: editAfter("security", "export const proofreadRunLimiter", "return !!email && isAdminEmail(email);", "return false;"),
  },
  {
    label: "triage limiter drops its dev-auth exemption",
    file: "security",
    flips: ["limiters-exempt-dev-and-admin"],
    apply: editAfter("security", "export const proofreadDispositionLimiter", 'if (process.env.DEV_AUTH_ENABLED === "true") return true;', ""),
  },
  {
    label: "read limiter has no skip at all",
    file: "security",
    flips: ["limiters-exempt-dev-and-admin"],
    apply: edit("security", /(export const proofreadReadLimiter = rateLimit\([\s\S]*?store: makeRateLimitStore\("rl:proofread-read:"\),)\n  skip:[\s\S]*?\n  \},/, "$1"),
  },
  {
    label: "shrink the triage budget below the run budget",
    file: "security",
    flips: ["triage-limit-exceeds-run-limit"],
    apply: editAfter("security", "export const proofreadDispositionLimiter", "limit: 300", "limit: 10"),
  },
  {
    label: "give triage a different window",
    file: "security",
    flips: ["triage-limit-exceeds-run-limit"],
    apply: editAfter("security", "export const proofreadDispositionLimiter", "windowMs: 60 * 60 * 1000", "windowMs: 60 * 1000"),
  },
  {
    label: "banned copy in a limiter's 429 message",
    file: "security",
    flips: ["copy-limiters"],
    apply: edit("security", "Too many proofread runs this hour.", "Too many independent review runs this hour."),
  },

  // ---- schema: the table names the raw-SQL scans read ---------------------
  {
    label: "schema: a table whose name is a const, not a string literal (sessions)",
    file: "schema",
    flips: ["schema-tables-are-read"],
    apply: editSchema("auth.ts", 'export const sessionsTable = pgTable(\n  "sessions",', 'const SESSIONS = "sessions";\nexport const sessionsTable = pgTable(\n  SESSIONS,'),
  },
  {
    label: "schema: a table made through a local alias of pgTable (events)",
    file: "schema",
    flips: ["schema-tables-are-read"],
    apply: editSchema("events.ts", 'export const eventsTable = pgTable(\n  "events",', 'const make = pgTable;\nexport const eventsTable = make(\n  "events",'),
  },
  {
    label: "schema: a table added through pgSchema(..).table, in a subdirectory",
    file: "schema",
    flips: ["schema-tables-are-read"],
    apply: addSchema("app/audits.ts", 'import { integer, pgSchema } from "drizzle-orm/pg-core";\nexport const auditsTable = pgSchema("app").table("audits", { id: integer("id") });\n'),
  },
  {
    label: "schema: the firms table renamed, so the scans no longer know firms",
    file: "schema",
    flips: ["schema-tables-are-read"],
    apply: editSchema("firms.ts", 'export const firmsTable = pgTable("firms", {', 'export const firmsTable = pgTable("firm", {'),
  },
  // a table the schema declares in a spelling the old `pgTable("name"` regex did not read, in a file it did not
  // open, and a bare-alias raw delete of it: by spelling alone `delete from audits a where true` reads like prose
  {
    label: "store: a raw delete with a bare alias on a table declared in a schema subdirectory through `pgTable as table`, a comment before its name",
    file: "store",
    flips: ["store-no-raw-study-sql", "store-dispositions-are-append-only"],
    apply: chain(
      addSchema("audit/audits.ts", 'import { integer, pgTable as table } from "drizzle-orm/pg-core";\nexport const auditsTable = table(/* the log */ "audits", { id: integer("id") });\n'),
      edit("store", "  if (args.findings.length === 0) return;", '  await db.execute(sql.raw("delete from audits a where true"));\n  if (args.findings.length === 0) return;'),
    ),
  },
  {
    label: "runner: a raw delete with a bare alias on a table declared as pg.pgTable (\"audits\"), a space before its `(`",
    file: "runner",
    flips: ["runner-has-no-db-writes"],
    apply: chain(
      addSchema("audits.ts", 'import * as pg from "drizzle-orm/pg-core";\nexport const auditsTable = pg.pgTable ("audits", { id: pg.integer("id") });\n'),
      edit("runner", "    const rec: StudyRecord", '    const q = "delete from audits a where true";\n    const rec: StudyRecord'),
    ),
  },
  {
    label: "routes: a raw delete with a bare alias on a table declared two directories down, a line comment before its name",
    file: "routes",
    flips: ["routes-do-not-touch-study"],
    apply: chain(
      addSchema("log/2026/audits.ts", 'import { integer, pgTable } from "drizzle-orm/pg-core";\nexport const auditsTable = pgTable(\n  // kept for the log\n  "audits",\n  { id: integer("id") },\n);\n'),
      edit("routes", "const router: IRouter = Router();", 'const router: IRouter = Router();\nconst q7 = "delete from audits a where true";'),
    ),
  },
];

const teeth = new Map(CHECKS.map((c) => [c.id, c]));
// A file's code as the checks see it, for "did this edit change anything": comment-stripped, with
// runs of whitespace collapsed, so an edit that lands in a comment, or only adds a blank line where
// a comment was, counts as no change.
const codeOf = (d, file) => JSON.stringify(d[file], (_k, v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : v));
for (const m of MUTATIONS) {
  const unknown = [...m.flips, ...(m.also ?? [])].filter((id) => !teeth.has(id));
  ok(unknown.length === 0, `teeth: "${m.label}" names only real checks`, unknown.length ? `unknown check id(s): ${unknown.join(", ")}` : undefined);
  const mutated = m.apply(sources);
  const before = derive(sources);
  const after = derive(mutated);
  // Compared on the comment-STRIPPED text: an edit that landed in a comment
  // changes the raw file and nothing a check can see.
  const changed = codeOf(before, m.file) !== codeOf(after, m.file);
  ok(changed, `teeth: "${m.label}" actually changes the code (an edit that applied to nothing, or only to a comment, would prove nothing)`);
  const now = run(mutated).filter((id) => !failing.includes(id));
  const want = [...new Set([...m.flips, ...(m.also ?? [])])].sort().join(", ");
  const got = [...now].sort().join(", ");
  ok(want === got, `teeth: "${m.label}" is caught by exactly the checks that claim to protect it`, want === got ? undefined : `expected red: ${want || "(none)"}; actually red: ${got || "(none)"}`);
  const wrongFile = now.filter((id) => teeth.get(id).on !== m.file);
  ok(
    wrongFile.length === 0,
    `teeth: "${m.label}" (${m.file}) is caught only by checks declared about ${m.file} — an assertion pointed at the wrong file passes forever`,
    wrongFile.length ? `checks about another file went red: ${wrongFile.map((id) => `${id} (about ${teeth.get(id).on})`).join(", ")}` : undefined,
  );
}

for (const l of LEGIT) {
  const mutated = l.apply(sources);
  // The rule the mutations obey, for the same reason: an edit whose anchor is gone (the production
  // line was reworded), or that lands only in a comment, leaves the code as it was, and a case that
  // tests nothing stays green forever. Compared on the comment-stripped text of the case's file.
  const changed = typeof l.file === "string" && l.file in sources && codeOf(derive(sources), l.file) !== codeOf(derive(mutated), l.file);
  ok(changed, `stays green: "${l.label}" actually changes the code of ${l.file} (an edit that applied to nothing, or only to a comment, would prove nothing)`);
  const now = run(mutated).filter((id) => !failing.includes(id));
  ok(now.length === 0, `stays green: "${l.label}" is ordinary code, and no check refuses it`, now.length ? `went red: ${now.join(", ")}` : undefined);
}

const covered = new Set(MUTATIONS.flatMap((m) => m.flips));
const toothless = ids.filter((id) => !covered.has(id));
ok(toothless.length === 0, "every check has a mutation proving it has teeth", toothless.length ? `no mutation breaks: ${toothless.join(", ")}` : undefined);

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
