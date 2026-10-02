/**
 * Guard for the proofread tables: the drizzle declaration and the raw
 * migration must agree, and every migration statement must be idempotent,
 * because lib/db/migrate.mjs has no ledger and re-runs every statement on
 * every boot.
 *
 * Why this is a model compare and not a set of regexes: nothing here can run
 * the SQL (importing @workspace/db throws without DATABASE_URL and CONNECTS
 * when it is set, and this guard must never touch a database). A regex like
 * `sourceLabel[\s\S]{0,120}notNull()` is satisfied by the NEXT column's
 * `.notNull()`, so it keeps passing after the column it names loses it. So
 * both sides are parsed into column / FK / index models and compared field
 * by field, and every parser fails loudly on text it does not recognise
 * rather than skipping it. Read as text only; never imports the db package.
 *
 * Run: `pnpm run check:proofread-schema`
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const SCHEMA_DIR = "lib/db/src/schema";
const read = (rel) => readFileSync(path.join(repo, rel), "utf8");

let fails = 0;
const ok = (cond, msg, why) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) {
    fails++;
    if (why) console.log(`        ${why}`);
  }
};

// ---------------------------------------------------------------------------
// Tiny text scanners. Drizzle files are TypeScript, so they are parsed by
// hand: strip comments, match brackets, split on top-level commas.
// ---------------------------------------------------------------------------

/** Drop // and block comments, leaving string / template literals intact. */
function stripComments(src) {
  let out = "";
  let i = 0;
  let q = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (q) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 2;
        continue;
      }
      if (c === q) q = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      q = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      const e = src.indexOf("*/", i + 2);
      i = e < 0 ? src.length : e + 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const CLOSER = { "(": ")", "{": "}", "[": "]" };

/** Index of the bracket that closes the one at `open`. Throws if unbalanced. */
function closeOf(s, open) {
  const stack = [];
  let q = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      q = c;
      continue;
    }
    if (CLOSER[c]) stack.push(CLOSER[c]);
    else if (c === ")" || c === "}" || c === "]") {
      if (stack.pop() !== c) throw new Error(`unbalanced bracket near "${s.slice(Math.max(0, i - 30), i + 1)}"`);
      if (!stack.length) return i;
    }
  }
  throw new Error(`unterminated bracket near "${s.slice(open, open + 40)}"`);
}

/** Split on commas that sit outside every bracket and string. Parts are trimmed; empties dropped. */
function splitTop(s) {
  const parts = [];
  let depth = 0;
  let q = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\") i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (CLOSER[c]) depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

const lit = (s) => (/^(["'`])([\s\S]*)\1$/.exec((s ?? "").trim()) ?? [])[2] ?? null;

/** `a("x").b(1, 2).c()` -> [{name, args}, ...]; `junk` is whatever was left unparsed. */
function parseChain(expr) {
  const calls = [];
  let i = 0;
  const ws = () => {
    while (i < expr.length && /\s/.test(expr[i])) i++;
  };
  ws();
  for (;;) {
    const m = /^([$\w]+)\s*\(/.exec(expr.slice(i));
    if (!m) return { calls, junk: expr.slice(i).trim() };
    const open = i + m[0].length - 1;
    const close = closeOf(expr, open);
    calls.push({ name: m[1], args: splitTop(expr.slice(open + 1, close)) });
    i = close + 1;
    ws();
    if (i >= expr.length) return { calls, junk: "" };
    if (expr[i] !== ".") return { calls, junk: expr.slice(i).trim() };
    i++;
    ws();
  }
}

// ---------------------------------------------------------------------------
// Drizzle side
// ---------------------------------------------------------------------------


function drizzleDefault(arg, problems, key) {
  const t = /^sql`([\s\S]*)`$/.exec(arg);
  if (t) return t[1].trim();
  const s = lit(arg);
  if (s !== null) return `'${s}'`;
  if (/^-?\d+(\.\d+)?$/.test(arg)) return arg;
  if (/^(true|false)$/.test(arg)) return arg.toUpperCase();
  problems.push(`${key}: unrecognised default ${arg}`);
  return `?${arg}`;
}

function drizzleColumn(key, expr, problems) {
  const { calls, junk } = parseChain(expr);
  if (!calls.length || junk) problems.push(`${key}: unparsed column expression "${junk || expr}"`);
  const [t, ...mods] = calls;
  const col = { key, name: lit(t?.args[0]), type: null, notNull: false, pk: false, def: null, fk: null };
  const opts = t?.args[1] ?? "";
  switch (t?.name) {
    case "uuid": col.type = "UUID"; break;
    case "integer": col.type = "INTEGER"; break;
    case "smallint": col.type = "SMALLINT"; break;
    case "text": col.type = "TEXT"; break;
    case "jsonb": col.type = "JSONB"; break;
    case "varchar": {
      const len = /length:\s*(\d+)/.exec(opts);
      col.type = len ? `VARCHAR(${len[1]})` : "VARCHAR";
      break;
    }
    case "timestamp": col.type = /withTimezone:\s*true/.test(opts) ? "TIMESTAMPTZ" : "TIMESTAMP"; break;
    default:
      col.type = `?${t?.name}`;
      problems.push(`${key}: unrecognised column type ${t?.name}()`);
  }
  if (col.name === null) problems.push(`${key}: column name is not a string literal`);
  for (const c of mods) {
    if (c.name === "notNull") col.notNull = true;
    else if (c.name === "primaryKey") col.pk = true;
    else if (c.name === "default") col.def = drizzleDefault(c.args[0] ?? "", problems, key);
    else if (c.name === "references") {
      const target = /^\(\)\s*=>\s*(\w+)\.(\w+)$/.exec(c.args[0] ?? "");
      const del = /onDelete:\s*["']([a-z ]+)["']/.exec(c.args[1] ?? "");
      if (!target) problems.push(`${key}: unparsed references() target`);
      col.fk = { constName: target?.[1], key: target?.[2], onDelete: del ? del[1].toUpperCase() : null };
    } else problems.push(`${key}: unrecognised modifier .${c.name}()`);
  }
  return col;
}

/** Every `export const X = pgTable(...)` in one schema file. */
function parseDrizzle(src) {
  const code = stripComments(src);
  const tables = [];
  for (const m of code.matchAll(/export const (\w+)\s*=\s*pgTable\(/g)) {
    const open = m.index + m[0].length - 1;
    const args = splitTop(code.slice(open + 1, closeOf(code, open)));
    const problems = [];
    const table = { constName: m[1], name: lit(args[0]), columns: new Map(), indexes: [], problems };
    const body = args[1] ?? "";
    if (body[0] !== "{") problems.push("columns argument is not an object literal");
    else {
      for (const entry of splitTop(body.slice(1, closeOf(body, 0)))) {
        const e = /^(\w+)\s*:\s*([\s\S]+)$/.exec(entry);
        if (!e) {
          problems.push(`unparsed column entry "${entry.slice(0, 40)}"`);
          continue;
        }
        const col = drizzleColumn(e[1], e[2], problems);
        table.columns.set(e[1], col);
      }
    }
    if (args[2]) {
      const a = /^\(\s*(\w+)\s*\)\s*=>\s*\[/.exec(args[2]);
      if (!a) problems.push("third argument is not `(table) => [ ... ]`");
      else {
        const open2 = args[2].indexOf("[", a[0].length - 1);
        for (const item of splitTop(args[2].slice(open2 + 1, closeOf(args[2], open2)))) {
          const { calls, junk } = parseChain(item);
          const [head, ...rest] = calls;
          if (junk || !head || !["index", "uniqueIndex"].includes(head.name)) {
            problems.push(`unrecognised table-level entry "${item.slice(0, 50)}"`);
            continue;
          }
          const idx = { name: lit(head.args[0]), unique: head.name === "uniqueIndex", cols: null };
          for (const c of rest) {
            if (c.name !== "on") {
              problems.push(`${idx.name}: unrecognised modifier .${c.name}()`);
              continue;
            }
            idx.cols = c.args.map((arg) => {
              const f = new RegExp(`^${a[1]}\\.(\\w+)$`).exec(arg);
              if (!f) problems.push(`${idx.name}: index column "${arg}" is not a bare ${a[1]}.<column>`);
              return f ? f[1] : `?${arg}`;
            });
          }
          table.indexes.push(idx);
        }
      }
    }
    // Resolve index columns from property key to database column name.
    for (const idx of table.indexes) {
      idx.cols = (idx.cols ?? []).map((k) => table.columns.get(k)?.name ?? `?${k}`);
    }
    tables.push(table);
  }
  return tables;
}

const schemaFiles = readdirSync(path.join(repo, SCHEMA_DIR)).filter((f) => f.endsWith(".ts"));
const tableCache = new Map();
/** Parsed drizzle table by its exported const name, searched across every schema file. */
function drizzleTableByConst(constName) {
  if (!tableCache.size) {
    for (const f of schemaFiles) {
      try {
        for (const t of parseDrizzle(read(`${SCHEMA_DIR}/${f}`))) tableCache.set(t.constName, t);
      } catch {
        // A file this scanner cannot read is only a problem if it holds a table we need.
      }
    }
  }
  return tableCache.get(constName) ?? null;
}

const proofreadSrc = read(`${SCHEMA_DIR}/study-proofread.ts`);
const proofreadCode = stripComments(proofreadSrc);
const barrelCode = stripComments(read(`${SCHEMA_DIR}/index.ts`));
const projectsCode = stripComments(read(`${SCHEMA_DIR}/tis-projects.ts`));
const migrateSrc = read("lib/db/migrate.mjs");

const TABLES = ["study_proofread_runs", "study_proofread_findings", "study_proofread_dispositions"];
const drizzleTables = parseDrizzle(proofreadSrc);
const dz = Object.fromEntries(drizzleTables.map((t) => [t.name, t]));

// ---------------------------------------------------------------------------
// Migration side. SQL_STATEMENTS is a literal array of {id, sql} strings, so
// the exact list the runner will execute (comments, order and all) is read by
// evaluating that array literal alone. The rest of the file, which imports pg
// and calls main(), is never loaded.
// ---------------------------------------------------------------------------

const arrayStart = migrateSrc.indexOf("const SQL_STATEMENTS = [");
const arrayEnd = arrayStart < 0 ? -1 : migrateSrc.indexOf("\n];", arrayStart);
let statements = [];
let statementsError = null;
try {
  if (arrayStart < 0 || arrayEnd < 0) throw new Error("could not find the SQL_STATEMENTS array");
  statements = new Function(`return ${migrateSrc.slice(arrayStart + "const SQL_STATEMENTS = ".length, arrayEnd + 2)}`)();
} catch (e) {
  statementsError = e instanceof Error ? e.message : String(e);
}

/** CREATE TABLE IF NOT EXISTS name (col defs); -> { name, columns, problems } or null if another shape. */
function parseSqlTable(sql) {
  const m = /^\s*CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*)\)\s*;\s*$/.exec(sql);
  if (!m) return null;
  const t = { name: m[1], columns: new Map(), problems: [] };
  for (const def of splitTop(m[2])) {
    if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY|LIKE|EXCLUDE)\b/i.test(def)) {
      t.problems.push(`table-level clause "${def.slice(0, 40)}" (the drizzle declaration cannot express it here)`);
      continue;
    }
    const c = /^(\w+)\s+(UUID|INTEGER|SMALLINT|TEXT|JSONB|TIMESTAMPTZ|TIMESTAMP|VARCHAR(?:\(\d+\))?)(?!\w)\s*([\s\S]*)$/i.exec(def);
    if (!c) {
      t.problems.push(`unparsed column definition "${def.slice(0, 50)}"`);
      continue;
    }
    const col = { name: c[1], type: c[2].toUpperCase(), notNull: false, pk: false, def: null, fk: null };
    let rest = c[3];
    const take = (re) => {
      const mm = re.exec(rest);
      if (mm) rest = `${rest.slice(0, mm.index)} ${rest.slice(mm.index + mm[0].length)}`.trim();
      return mm;
    };
    const ref = take(/\bREFERENCES\s+(\w+)\s*\(\s*(\w+)\s*\)(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION|SET\s+DEFAULT))?/i);
    if (ref) col.fk = { table: ref[1], column: ref[2], onDelete: ref[3] ? ref[3].toUpperCase().replace(/\s+/g, " ") : null };
    const def2 = take(/\bDEFAULT\s+(.+?)(?=\s+(?:NOT\s+NULL|PRIMARY\s+KEY|REFERENCES|NULL)\b|$)/i);
    if (def2) col.def = def2[1].trim();
    if (take(/\bPRIMARY\s+KEY\b/i)) col.pk = true;
    if (take(/\bNOT\s+NULL\b/i)) col.notNull = true;
    if (rest) t.problems.push(`${col.name}: unrecognised trailing "${rest}"`);
    t.columns.set(col.name, col);
  }
  return t;
}

/** CREATE [UNIQUE] INDEX IF NOT EXISTS "name" ON table (cols); -> {...} or null. */
function parseSqlIndex(sql) {
  const m = /^\s*CREATE (UNIQUE )?INDEX IF NOT EXISTS "([^"]+)" ON (\w+) \(([^)]*)\)\s*;\s*$/.exec(sql);
  if (!m) return null;
  return { name: m[2], unique: Boolean(m[1]), table: m[3], cols: m[4].split(",").map((c) => c.trim()) };
}

// ===========================================================================
// 1. The barrel and the exported names later tasks import
// ===========================================================================

ok(/export \* from "\.\/study-proofread";/.test(barrelCode), "schema barrel re-exports study-proofread (not commented out)");
for (const sym of ["studyProofreadRunsTable", "studyProofreadFindingsTable", "studyProofreadDispositionsTable"]) {
  ok(new RegExp(`export const ${sym}\\s*=\\s*pgTable\\(`).test(proofreadCode), `exports table ${sym}`);
}
for (const t of ["StudyProofreadRun", "StudyProofreadFinding", "StudyProofreadDisposition"]) {
  ok(new RegExp(`export type ${t}\\s*=\\s*typeof \\w+\\.\\$inferSelect;`).test(proofreadCode), `exports type ${t}`);
  ok(new RegExp(`export type Insert${t}\\s*=\\s*typeof \\w+\\.\\$inferInsert;`).test(proofreadCode), `exports type Insert${t}`);
}

// ===========================================================================
// 2. The migration statements themselves
// ===========================================================================

const EXPECTED_IDS = [
  "study_proofread_runs.create",
  "study_proofread_runs.uq_project_revision",
  "study_proofread_runs.idx_status",
  "study_proofread_findings.create",
  "study_proofread_findings.idx_run",
  "study_proofread_findings.idx_fp",
  "study_proofread_findings.uq_run_fp",
  "study_proofread_dispositions.create",
  "study_proofread_dispositions.idx_finding",
];

ok(statementsError === null, "migrate.mjs SQL_STATEMENTS evaluates as a plain array literal", statementsError ?? undefined);
ok(
  Array.isArray(statements) && statements.length > 0 && statements.every((s) => typeof s?.id === "string" && typeof s?.sql === "string"),
  "every SQL_STATEMENTS entry is { id: string, sql: string }",
);

// Anything that mentions proofread, by id or body: the set must be exactly ours,
// so a statement smuggled under another id (an ALTER on tis_projects) is seen.
const mine = statements.filter((s) => /proofread/i.test(s.id) || /proofread/i.test(s.sql));
const mineIds = mine.map((s) => s.id);
ok(
  JSON.stringify([...mineIds].sort()) === JSON.stringify([...EXPECTED_IDS].sort()),
  `the proofread statements are exactly the ${EXPECTED_IDS.length} expected, no more, no fewer`,
  `got [${mineIds.join(", ")}]`,
);
ok(new Set(mineIds).size === mineIds.length, "no duplicate proofread statement ids");

const sqlTables = new Map();
const sqlIndexes = [];
const created = new Set();
for (const s of mine) {
  const body = s.sql.trim();
  ok((body.match(/;/g) ?? []).length === 1 && body.endsWith(";"), `${s.id}: exactly one statement, ending in a single ;`);
  ok(
    !/\b(DROP|RENAME|TRUNCATE|ALTER)\b|ADD\s+CONSTRAINT|\b(INSERT|UPDATE)\b|DELETE\s+FROM/i.test(body),
    `${s.id}: no DROP / RENAME / ALTER / ADD CONSTRAINT / data write`,
  );
  const table = parseSqlTable(s.sql);
  const index = table ? null : parseSqlIndex(s.sql);
  ok(
    table !== null || index !== null,
    `${s.id}: is a CREATE TABLE IF NOT EXISTS or a CREATE [UNIQUE] INDEX IF NOT EXISTS "Quoted_Name" ON ... (idempotent, quoted)`,
    `unrecognised shape: ${s.sql.replace(/\s+/g, " ").slice(0, 90)}`,
  );
  // Ledgerless re-run: a statement whose dependency is created LATER is skipped on a
  // first deploy by the "relation does not exist" branch of migrate.mjs, silently.
  if (table) {
    ok(table.problems.length === 0, `${s.id}: every column definition is understood`, table.problems.join("; "));
    const deps = [...table.columns.values()].filter((c) => c.fk && c.fk.table.startsWith("study_proofread_")).map((c) => c.fk.table);
    ok(deps.every((d) => created.has(d)), `${s.id}: its proofread FK targets are created by an EARLIER statement`, `needs ${deps.join(", ")}`);
    ok(!sqlTables.has(table.name), `${s.id}: ${table.name} is created once`);
    sqlTables.set(table.name, table);
    created.add(table.name);
  } else if (index) {
    ok(created.has(index.table), `${s.id}: its table ${index.table} is created by an EARLIER statement`);
    sqlIndexes.push(index);
  }
}
ok(
  TABLES.every((t) => sqlTables.has(t)) && sqlTables.size === TABLES.length,
  "migrate creates study_proofread_runs, study_proofread_findings and study_proofread_dispositions, and nothing else",
);

// ===========================================================================
// 3. The drizzle declaration is fully understood
// ===========================================================================

ok(
  drizzleTables.length === TABLES.length && TABLES.every((t) => dz[t]),
  "drizzle declares exactly study_proofread_runs, study_proofread_findings and study_proofread_dispositions",
  `got [${drizzleTables.map((t) => t.name).join(", ")}]`,
);
for (const t of drizzleTables) {
  ok(t.problems.length === 0, `${t.name}: every drizzle column and index entry is understood`, t.problems.join("; "));
}

// ===========================================================================
// 4. Column-by-column: name, type, nullability, default, FK + ON DELETE
// ===========================================================================

const RUN_COLS = ["id", "project_id", "firm_id", "revision", "status", "protocol_version", "rules_version", "engine_stamp", "input_manifest", "coverage", "model", "input_tokens", "output_tokens", "attempts", "claimed_at", "claimed_by", "error", "requested_by_user_id", "created_at", "finished_at"];
const FINDING_COLS = ["id", "run_id", "clause_id", "section", "type", "origin", "title", "detail", "source_label", "read_paths", "remedy", "audience", "fingerprint", "created_at"];
const DISPOSITION_COLS = ["id", "finding_id", "disposition", "note", "source_label", "actor_user_id", "created_at"];
const COLUMN_CONTRACT = {
  study_proofread_runs: RUN_COLS,
  study_proofread_findings: FINDING_COLS,
  study_proofread_dispositions: DISPOSITION_COLS,
};

// Every foreign key there is, and what happens to the child on a parent delete.
const FK_CONTRACT = {
  study_proofread_runs: { project_id: "tis_projects(id) ON DELETE CASCADE", firm_id: "firms(id) ON DELETE CASCADE" },
  study_proofread_findings: { run_id: "study_proofread_runs(id) ON DELETE CASCADE" },
  study_proofread_dispositions: { finding_id: "study_proofread_findings(id) ON DELETE CASCADE" },
};

const dzCols = (t) => new Map([...dz[t].columns.values()].map((c) => [c.name, c]));
const fkText = (fk) => (fk ? `${fk.table}(${fk.column})${fk.onDelete ? ` ON DELETE ${fk.onDelete}` : ""}` : null);
function dzFk(col) {
  if (!col.fk) return null;
  const target = drizzleTableByConst(col.fk.constName);
  const targetCol = target?.columns.get(col.fk.key);
  return { table: target?.name ?? `?${col.fk.constName}`, column: targetCol?.name ?? `?${col.fk.key}`, onDelete: col.fk.onDelete, type: targetCol?.type };
}

for (const t of TABLES) {
  const want = COLUMN_CONTRACT[t];
  const d = dz[t] ? dzCols(t) : new Map();
  const s = sqlTables.get(t)?.columns ?? new Map();
  const names = (m) => [...m.keys()];
  const diff = (a, b) => a.filter((x) => !b.includes(x));
  ok(
    names(d).length === want.length && diff(want, names(d)).length === 0,
    `${t}: drizzle declares exactly the ${want.length} contract columns`,
    `missing [${diff(want, names(d))}] extra [${diff(names(d), want)}]`,
  );
  ok(
    names(s).length === want.length && diff(want, names(s)).length === 0,
    `${t}: the migration creates exactly the ${want.length} contract columns`,
    `missing [${diff(want, names(s))}] extra [${diff(names(s), want)}]`,
  );
  for (const name of want) {
    const a = d.get(name);
    const b = s.get(name);
    if (!a || !b) {
      ok(false, `${t}.${name}: present in both drizzle and the migration`, `drizzle ${a ? "has" : "lacks"} it, migration ${b ? "has" : "lacks"} it`);
      continue;
    }
    const af = dzFk(a);
    const model = (c, fk) => ({ type: c.type, nullable: !(c.notNull || c.pk), pk: c.pk, def: c.def, fk: fkText(fk) });
    const am = model(a, af);
    const bm = model(b, b.fk);
    const diffs = Object.keys(am).filter((k) => am[k] !== bm[k]).map((k) => `${k}: drizzle ${JSON.stringify(am[k])} vs sql ${JSON.stringify(bm[k])}`);
    // A foreign key needs the same type on both ends or Postgres refuses the CREATE TABLE.
    if (af && af.type && af.type !== a.type) diffs.push(`fk type: ${a.type} references a ${af.type} column`);
    ok(diffs.length === 0, `${t}.${name}: drizzle and sql agree (${bm.type}${bm.nullable ? "" : " NOT NULL"}${bm.def ? ` DEFAULT ${bm.def}` : ""}${bm.fk ? ` -> ${bm.fk}` : ""})`, diffs.join("; "));
  }
  // The FK set is a contract too: an extra or missing foreign key changes what a delete does.
  const wantFk = FK_CONTRACT[t];
  const actualFk = (m, fkOf) => Object.fromEntries([...m.values()].filter((c) => c.fk).map((c) => [c.name, fkText(fkOf(c))]));
  ok(JSON.stringify(sortKeys(actualFk(d, dzFk))) === JSON.stringify(sortKeys(wantFk)), `${t}: drizzle's foreign keys are exactly the contract (all ON DELETE CASCADE)`, JSON.stringify(actualFk(d, dzFk)));
  ok(JSON.stringify(sortKeys(actualFk(s, (c) => c.fk))) === JSON.stringify(sortKeys(wantFk)), `${t}: the migration's foreign keys are exactly the contract (all ON DELETE CASCADE)`, JSON.stringify(actualFk(s, (c) => c.fk)));
}
function sortKeys(o) {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

// A finding with no named source is an opinion, not a finding.
for (const [label, cols] of [["drizzle", dz.study_proofread_findings ? dzCols("study_proofread_findings") : new Map()], ["migration", sqlTables.get("study_proofread_findings")?.columns ?? new Map()]]) {
  ok(cols.get("source_label")?.notNull === true, `findings.source_label is NOT NULL in the ${label}`);
  ok(cols.get("read_paths")?.notNull === true, `findings.read_paths is NOT NULL in the ${label}`);
}

// ===========================================================================
// 5. Indexes. Two are UNIQUE on purpose (idempotent findings insert, one
//    revision number per project); losing the uniqueness loses the guarantee.
// ===========================================================================

const INDEX_CONTRACT = [
  { name: "UQ_study_proofread_runs_project_revision", table: "study_proofread_runs", unique: true, cols: ["project_id", "revision"] },
  { name: "IDX_study_proofread_runs_status", table: "study_proofread_runs", unique: false, cols: ["status", "created_at"] },
  { name: "IDX_study_proofread_findings_run", table: "study_proofread_findings", unique: false, cols: ["run_id"] },
  { name: "IDX_study_proofread_findings_fingerprint", table: "study_proofread_findings", unique: false, cols: ["fingerprint"] },
  { name: "UQ_study_proofread_findings_run_fp", table: "study_proofread_findings", unique: true, cols: ["run_id", "fingerprint"] },
  { name: "IDX_study_proofread_dispositions_finding", table: "study_proofread_dispositions", unique: false, cols: ["finding_id", "created_at"] },
];
const dzIndexes = drizzleTables.flatMap((t) => t.indexes.map((i) => ({ ...i, table: t.name })));
const shape = (i) => `${i.unique ? "UNIQUE " : ""}"${i.name}" ON ${i.table} (${i.cols.join(", ")})`;
for (const want of INDEX_CONTRACT) {
  const label = `${want.unique ? "UNIQUE " : ""}index ${want.name} on ${want.table} (${want.cols.join(", ")})`;
  const find = (list) => list.filter((i) => i.name === want.name);
  const exact = (i) => i.table === want.table && i.unique === want.unique && JSON.stringify(i.cols) === JSON.stringify(want.cols);
  const dzHit = find(dzIndexes);
  const sqlHit = find(sqlIndexes);
  ok(dzHit.length === 1 && exact(dzHit[0]), `drizzle declares ${label}`, `found ${dzHit.map(shape).join(" | ") || "nothing"}`);
  ok(sqlHit.length === 1 && exact(sqlHit[0]), `migration creates ${label}`, `found ${sqlHit.map(shape).join(" | ") || "nothing"}`);
}
ok(
  dzIndexes.length === INDEX_CONTRACT.length && sqlIndexes.length === INDEX_CONTRACT.length,
  `exactly ${INDEX_CONTRACT.length} indexes on each side, no strays`,
  `drizzle ${dzIndexes.length}, migration ${sqlIndexes.length}`,
);

// ===========================================================================
// 6. The advisor boundary: Datum cannot write to a study because there is
//    nowhere for it to write. No tis_projects column, no tis_projects ALTER.
// ===========================================================================

ok(!/proofread|datum/i.test(projectsCode), "tis_projects (drizzle) has no proofread or datum column or reference");
const touchesProjects = statements.filter((s) => /\btis_projects\b/i.test(s.sql) && /^\s*ALTER\b/i.test(s.sql));
ok(
  touchesProjects.every((s) => !/proofread|datum/i.test(s.sql)),
  "no migration ALTERs tis_projects for proofread or datum",
  `offending: ${touchesProjects.filter((s) => /proofread|datum/i.test(s.sql)).map((s) => s.id).join(", ")}`,
);
ok(
  !mine.some((s) => !/^\s*CREATE\b/i.test(s.sql)),
  "every proofread statement is a CREATE (it can add nothing to an existing table)",
);

console.log(fails === 0 ? "\nALL CHECKS PASSED" : `\n${fails} CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
