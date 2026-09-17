// Shared page-text extraction + orphan-page classifier, factored out of
// verify-appendix-worksheet-pages.mjs so other checks (verify-leg-volumes-render.mjs)
// can reuse the exact same "no orphan pages" test against a rendered buffer
// without re-implementing or drifting from the pagination check's definition.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.mjs");

export const FOOTER_RE = /Screening estimate — not for design submittal.*?disclaimer\./s;
export const MIN_BODY_CHARS = 600;

export async function pageTexts(buf) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, disableFontFace: true }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    // Items arrive in content-stream order; join with a space and collapse.
    out.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" ").replace(/\s+/g, " ").trim());
  }
  await doc.destroy();
  return out;
}

/** An orphan page: nearly empty, and its body opens mid-sentence. */
export function orphanPages(texts) {
  const orphans = [];
  texts.forEach((t, idx) => {
    const body = t.replace(FOOTER_RE, "").trim();
    if (body.replace(/\s+/g, "").length >= MIN_BODY_CHARS) return;
    const opener = body.slice(0, 1);
    if (!opener || opener !== opener.toLowerCase() || !/[a-z]/.test(opener)) return;
    orphans.push({ page: idx + 1, chars: body.length, head: body.slice(0, 60) });
  });
  return orphans;
}
