/**
 * Template registry + loader.
 *
 * Resolves a `ReportTemplate` from either a built-in id (the TS templates) or an
 * external JSON spec file (an *imported* template). Templates are pure data, so
 * an imported firm format is just a `.json` that passes `validateTemplate`. The
 * provider registry stays in code; the spec references providers by id.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Block, Chapter, ReportTemplate, Section } from "./engine";
import { velocityTemplate } from "./templates/velocity";
import { genericUsTemplate } from "./templates/generic-us";

/** Built-in, code-defined templates, keyed by `ReportTemplate.id`. */
export const BUILTIN_TEMPLATES: Record<string, ReportTemplate> = {
  [velocityTemplate.id]: velocityTemplate,
  [genericUsTemplate.id]: genericUsTemplate,
};

export function listTemplates(): Array<{ id: string; name: string; documentType: string }> {
  return Object.values(BUILTIN_TEMPLATES).map((t) => ({ id: t.id, name: t.name, documentType: t.documentType }));
}

const BLOCK_KINDS = new Set(["prose", "note", "bullets", "table", "metrics", "keyvalue", "chart", "if"]);

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Invalid template: ${msg}`);
}

function validateBlock(b: any, where: string): Block {
  assert(b && typeof b === "object", `${where} block must be an object`);
  assert(typeof b.kind === "string" && BLOCK_KINDS.has(b.kind), `${where} unknown block kind "${b?.kind}"`);
  switch (b.kind) {
    case "prose":
    case "note":
      assert(typeof b.text === "string", `${where} ${b.kind} needs a string text`);
      break;
    case "bullets":
      assert(Array.isArray(b.items), `${where} bullets needs items[]`);
      break;
    case "table":
    case "metrics":
    case "keyvalue":
    case "chart":
      assert(typeof b.provider === "string", `${where} ${b.kind} needs a provider id`);
      break;
    case "if":
      assert(typeof b.flag === "string", `${where} if needs a flag`);
      assert(Array.isArray(b.then), `${where} if needs then[]`);
      b.then.forEach((x: any, i: number) => validateBlock(x, `${where}.then[${i}]`));
      (b.else ?? []).forEach((x: any, i: number) => validateBlock(x, `${where}.else[${i}]`));
      break;
  }
  return b as Block;
}

function validateSection(s: any, where: string): Section {
  assert(s && typeof s === "object", `${where} section must be an object`);
  assert(typeof s.title === "string", `${where} section needs a title`);
  assert(Array.isArray(s.blocks), `${where} section needs blocks[]`);
  s.blocks.forEach((b: any, i: number) => validateBlock(b, `${where}.blocks[${i}]`));
  return s as Section;
}

function validateChapter(c: any, where: string): Chapter {
  assert(c && typeof c === "object", `${where} chapter must be an object`);
  assert(typeof c.title === "string", `${where} chapter needs a title`);
  assert(Array.isArray(c.sections), `${where} chapter needs sections[]`);
  c.sections.forEach((s: any, i: number) => validateSection(s, `${where}.sections[${i}]`));
  return c as Chapter;
}

/** Runtime-validate an untyped object (e.g. parsed JSON) as a ReportTemplate. */
export function validateTemplate(obj: unknown): ReportTemplate {
  const t = obj as any;
  assert(t && typeof t === "object", "must be an object");
  assert(typeof t.id === "string" && t.id, "needs an id");
  assert(typeof t.name === "string", "needs a name");
  assert(typeof t.documentType === "string", "needs a documentType");
  assert(t.brand && typeof t.brand === "object", "needs a brand");
  assert(t.brand.palette && typeof t.brand.palette === "object", "brand needs a palette");
  assert(t.brand.cover && typeof t.brand.cover.style === "string", "brand needs a cover.style");
  assert(typeof t.brand.footer === "string", "brand needs a footer");
  assert(Array.isArray(t.chapters) && t.chapters.length > 0, "needs chapters[]");
  t.chapters.forEach((c: any, i: number) => validateChapter(c, `chapters[${i}]`));
  return t as ReportTemplate;
}

/**
 * Resolve a template by built-in id, or load + validate an external JSON spec
 * when given a path ending in `.json`.
 */
export function loadTemplate(idOrPath: string): ReportTemplate {
  if (BUILTIN_TEMPLATES[idOrPath]) return BUILTIN_TEMPLATES[idOrPath];
  if (idOrPath.endsWith(".json")) {
    assert(existsSync(idOrPath), `template file not found: ${idOrPath}`);
    const parsed = JSON.parse(readFileSync(idOrPath, "utf8"));
    return validateTemplate(parsed);
  }
  throw new Error(`Unknown template "${idOrPath}". Known: ${Object.keys(BUILTIN_TEMPLATES).join(", ")}`);
}

/** Serialise a template to a JSON spec file (used by ingestion / export). */
export function writeTemplateJson(t: ReportTemplate, filePath: string): void {
  validateTemplate(t);
  writeFileSync(filePath, JSON.stringify(t, null, 2), "utf8");
}
