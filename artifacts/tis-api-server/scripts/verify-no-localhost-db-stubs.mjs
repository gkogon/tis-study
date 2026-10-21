// Check: no script gives DATABASE_URL a default that can reach a real
// Postgres.
//
// Several checks import modules that construct a pg Pool at module load, so
// they set a stub DATABASE_URL when none is given. A stub that names
// localhost and no port dials localhost:5432 -- where a developer's own
// Postgres usually runs -- and every query in the check then opens a real
// connection that fails only at the database name. The stub must instead be
// an address nothing listens on, so the pool fails at connect:
//
//   postgres://unused:unused@127.0.0.1:1/unused
//
// Rules, over every code file under artifacts/*/scripts, artifacts/*/src,
// scripts/ and lib/ (node_modules, dist, build and dot-files skipped):
//   1. Every postgres:// or postgresql:// URL literal must name a loopback
//      host (127.0.0.1, ::1 or localhost) AND an explicit port in
//      UNREACHABLE_PORTS. No port means 5432; any other port may be in use.
//   2. Every string-literal default given to DATABASE_URL (??=, ||=, =, ??,
//      ||, an object key, or a shell ${DATABASE_URL:-...} / DATABASE_URL=...)
//      must be such a URL. An empty or non-URL default fails too: pg falls
//      back to localhost:5432 when the connection string names no host.
//
// Run: node ./scripts/verify-no-localhost-db-stubs.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

// Nothing listens on TCP port 1 (tcpmux) on a dev machine or CI runner, so a
// connect there is refused at once (ECONNREFUSED, no handshake). Widen only
// with a port that is likewise never served.
const UNREACHABLE_PORTS = new Set(["1"]);
const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"]);
const CANONICAL = "postgres://unused:unused@127.0.0.1:1/unused";

const CODE_EXT = new Set([".mjs", ".js", ".cjs", ".ts", ".mts", ".cts", ".tsx", ".jsx", ".sh", ".bash", ".zsh"]);
const SHELL_EXT = new Set([".sh", ".bash", ".zsh"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build"]);

const PG_URL = /postgres(?:ql)?:\/\/[^\s"'`)}]*/g;
const JS_DEFAULT = /DATABASE_URL\b["'\]]*\s*(?:\?\?=|\|\|=|\?\?|\|\||=(?!=)|:(?!:))\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
const SH_EXPANSION = /\$\{DATABASE_URL:?[-=]([^}]*)\}/g;
const SH_ASSIGN = /(?:^|[\s;&|(])(?:export\s+)?DATABASE_URL=("[^"]*"|'[^']*'|[^\s;&|)]*)/gm;

/** Returns null when `url` is an acceptable stub, else the reason it is not. */
function urlProblem(url) {
  if (url.includes("${") || url.includes("$(")) return "interpolated URL: host/port cannot be verified";
  let u;
  try {
    u = new URL(url);
  } catch {
    return "unparseable URL";
  }
  if (!u.hostname) return "no host (pg falls back to localhost:5432 or the local socket)";
  if (!LOOPBACK.has(u.hostname)) return `host ${u.hostname} is not loopback`;
  if (!u.port) return "no explicit port (pg dials 5432)";
  if (!UNREACHABLE_PORTS.has(u.port)) return `port ${u.port} is not a known-unreachable port`;
  return null;
}

function unquote(v) {
  return /^(["'`]).*\1$/s.test(v) ? v.slice(1, -1) : v;
}

/** Scans one file's text; returns [{line, text, reason}] violations and the accepted stub count. */
function scan(text, { shell = false } = {}) {
  const out = [];
  let accepted = 0;
  const lineOf = (i) => text.slice(0, i).split("\n").length;
  for (const m of text.matchAll(PG_URL)) {
    const url = m[0].replace(/[.,;]+$/, "");
    if (/^postgres(?:ql)?:\/\/$/.test(url)) continue; // bare scheme, e.g. a startsWith() test
    const why = urlProblem(url);
    if (why) out.push({ line: lineOf(m.index), text: url, reason: why });
    else accepted++;
  }
  const defaults = [];
  if (shell) {
    for (const m of text.matchAll(SH_EXPANSION)) defaults.push({ i: m.index, v: unquote(m[1]) });
    for (const m of text.matchAll(SH_ASSIGN)) defaults.push({ i: m.index, v: unquote(m[1]) });
  } else {
    for (const m of text.matchAll(JS_DEFAULT)) defaults.push({ i: m.index, v: m[2] });
  }
  for (const { i, v } of defaults) {
    if (shell && v.startsWith("$")) continue; // passes a variable through; any literal inside is scanned above
    if (/^postgres(?:ql)?:\/\/./.test(v)) continue; // judged by the URL rule above
    out.push({ line: lineOf(i), text: `DATABASE_URL default ${JSON.stringify(v)}`, reason: `not a postgres URL (use ${CANONICAL})` });
  }
  return { violations: out, accepted };
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(p);
    } else if (e.isFile() && CODE_EXT.has(path.extname(e.name))) {
      yield p;
    }
  }
}

function roots() {
  const r = [path.join(repo, "scripts"), path.join(repo, "lib")];
  for (const e of readdirSync(path.join(repo, "artifacts"), { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    for (const sub of ["scripts", "src"]) {
      const p = path.join(repo, "artifacts", e.name, sub);
      try {
        if (statSync(p).isDirectory()) r.push(p);
      } catch {}
    }
  }
  return r;
}

// --- self-test: the rules must reject the hazards and accept the stub -------
// Literals are assembled at run time so this file's own text stays clean.
const S = "postgres" + "://";
const K = "DATABASE" + "_URL";
const selfTest = [
  [`process.env.${K} ??= "${S}localhost/tis_e2e_stub_db";`, false, "localhost, no port"],
  [`process.env.${K} = "${S}127.0.0.1:5432/x";`, false, "explicit 5432"],
  [`process.env.${K} ??= "${S}localhost:5433/x";`, false, "other live-able port"],
  [`process.env.${K} ??= "${S}/x";`, false, "no host"],
  [`process.env.${K} ??= "${S}u:p@db.example.com:1/x";`, false, "non-loopback host"],
  [`process.env.${K} ??= \`${S}localhost:\${port}/x\`;`, false, "interpolated port"],
  [`process.env["${K}"] ||= "";`, false, "empty default"],
  [`const env = { ...process.env, ${K}: "x" };`, false, "non-URL object default"],
  [`process.env.${K} ??= "${CANONICAL}";`, true, "canonical stub"],
  [`process.env.${K} ??= "postgresql://u@[::1]:1/x";`, true, "ipv6 loopback, port 1"],
  [`if (process.env.${K} === "") {}`, true, "comparison is not a default"],
];
const selfTestShell = [
  [`: "\${${K}:=${S}localhost/x}"`, false, "shell := default"],
  [`${K}=\${${K}:-${S}127.0.0.1/x} node a.mjs`, false, "shell :- default"],
  [`export ${K}=''`, false, "shell empty export"],
  [`${K}="${CANONICAL}" node a.mjs`, true, "shell canonical"],
  [`${K}="$${K}" node a.mjs`, true, "shell passthrough"],
];
let selfFails = 0;
for (const [cases, shell] of [[selfTest, false], [selfTestShell, true]]) {
  for (const [src, ok, label] of cases) {
    const { violations } = scan(src, { shell });
    if ((violations.length === 0) !== ok) {
      selfFails++;
      console.error(`SELF-TEST FAIL (${label}): expected ${ok ? "accept" : "reject"}: ${src}`);
    }
  }
}
if (selfFails) {
  console.error(`verify-no-localhost-db-stubs: ${selfFails} self-test case(s) failed — the scanner itself is broken`);
  process.exit(1);
}

// --- scan the repo -----------------------------------------------------------
let files = 0;
let accepted = 0;
const bad = [];
for (const root of roots()) {
  for (const f of walk(root)) {
    files++;
    const res = scan(readFileSync(f, "utf8"), { shell: SHELL_EXT.has(path.extname(f)) });
    accepted += res.accepted;
    for (const v of res.violations) bad.push({ file: path.relative(repo, f), ...v });
  }
}
if (files < 50) {
  console.error(`verify-no-localhost-db-stubs: only ${files} files scanned — the walk is broken`);
  process.exit(1);
}
if (bad.length) {
  for (const b of bad) console.error(`  ${b.file}:${b.line}  ${b.text}\n      -> ${b.reason}`);
  console.error(`\nverify-no-localhost-db-stubs: FAIL — ${bad.length} Postgres default(s) could reach a real server.`);
  console.error(`Use an address nothing listens on: ${CANONICAL}`);
  process.exit(1);
}
console.log(
  `verify-no-localhost-db-stubs: ok — ${files} files scanned; ${accepted} Postgres URL(s), all loopback on an unreachable port; ` +
    `${selfTest.length + selfTestShell.length} self-test cases pass`,
);
