/**
 * The theme in force for the current synchronous draw pass.
 *
 * Module-level on purpose (the same pattern as `velocityPaletteActive` in
 * pdf-export.ts): the regional renderers call shared primitives from
 * hundreds of sites, and threading a parameter through them all is not
 * worth it. Safe because `withTheme` only wraps synchronous code — an
 * `await` inside it would let a concurrent request read the wrong theme,
 * which is why `withTheme` refuses a function that returns a Promise.
 */
import { DEFAULT_THEME, isDefaultTheme as isDefault, type Theme } from "./theme";

let active: Theme = DEFAULT_THEME;
let usedSynonyms = new Set<string>();
// Figure numbering for the draw pass: the running count and the chapter the
// last level-1 heading carried (chapter-style captions restart per chapter).
let figureCount = 0;
let chapter: number | null = null;

export function activeTheme(): Theme {
  return active;
}
export function isDefaultTheme(): boolean {
  return isDefault(active);
}
/** Left (= right) page margin of the active theme; 50 for the default. */
export function pageMargin(): number {
  return active.page.margins.left;
}
/**
 * The firm's wording for a canonical heading key, handed out once per draw
 * pass so two of our headings that map to the same key (e.g. FINDINGS and
 * CONCLUSIONS) cannot both become the sample's "Conclusions".
 */
export function takeSynonym(key: string): string | null {
  const w = active.synonyms[key];
  if (!w || usedSynonyms.has(key)) return null;
  usedSynonyms.add(key);
  return w;
}
/** Called by the themed level-1 heading; a chapter without a number passes null. */
export function noteChapter(n: number | null): void {
  if (active.figure.numbering === "chapter" && n !== chapter) figureCount = 0;
  chapter = n;
}
/** The next figure's number and the chapter it belongs to. */
export function nextFigureNumber(): { n: number; chapter: number | null } {
  figureCount += 1;
  return { n: figureCount, chapter };
}
export function withTheme<T>(theme: Theme, fn: () => T): T {
  const prevTheme = active;
  const prevUsed = usedSynonyms;
  const prevCount = figureCount;
  const prevChapter = chapter;
  active = theme;
  usedSynonyms = new Set();
  figureCount = 0;
  chapter = null;
  try {
    const out = fn();
    if (out instanceof Promise) throw new Error("withTheme(fn): fn must be synchronous — the active theme is module state");
    return out;
  } finally {
    active = prevTheme;
    usedSynonyms = prevUsed;
    figureCount = prevCount;
    chapter = prevChapter;
  }
}
