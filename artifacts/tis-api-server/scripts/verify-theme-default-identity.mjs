// Byte-identity guard: with no firm theme, renderStudyPdf must produce exactly
// the bytes it produced before the theme layer existed (after masking PDFKit's
// clock-derived CreationDate/ID). TX, NC and SC render offline as they are;
// FL, GA and NY enrich from live services, and the UK path (the FL fixture
// relocated to the City of London, which selects the Velocity template
// engine) does too — those four render with `fetch` stubbed to fail, which
// pins the deterministic no-network fallback of each renderer.
// `--pin` re-baselines (only when a deliberate render change lands).
// Run: node ./scripts/verify-theme-default-identity.mjs [--pin]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadRendererBundle } from "./lib/bundle-renderer.mjs";
import { loadFixture, projectFromFixture } from "./lib/fixture-project.mjs";
import { pdfHash } from "./lib/pdf-norm.mjs";
import { deflateSync, inflateSync } from "node:zlib";

/**
 * The same PDF with every FlateDecode stream re-packed at another zlib level:
 * different bytes, identical content. The normalised hash must not move —
 * this is what makes a baseline pinned on arm64 hold on the x86_64 runner.
 */
function recompressed(buf) {
  const needle = Buffer.from("\nstream\n", "latin1"), objMark = Buffer.from(" obj", "latin1");
  const parts = []; let pos = 0;
  for (;;) {
    const s = buf.indexOf(needle, pos); if (s < 0) break;
    const objStart = buf.lastIndexOf(objMark, s);
    const dict = objStart >= pos ? buf.subarray(objStart, s).toString("latin1") : "";
    const m = /\/Length (\d+)/.exec(dict);
    if (!m || !/FlateDecode/.test(dict)) { parts.push(buf.subarray(pos, s + needle.length)); pos = s + needle.length; continue; }
    const len = Number(m[1]), dataStart = s + needle.length;
    const re = deflateSync(inflateSync(buf.subarray(dataStart, dataStart + len)), { level: 1 });
    parts.push(Buffer.from(buf.subarray(pos, s + needle.length).toString("latin1").replace(/\/Length \d+/, `/Length ${re.length}`), "latin1"), re);
    pos = dataStart + len;
  }
  parts.push(buf.subarray(pos));
  return Buffer.concat(parts);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.resolve(here, "fixtures/theme-identity-baseline.json");
const FAMILIES = ["tx", "nc", "sc", "fl", "ga", "ny", "uk"];
/** Families whose renderer reaches the network; rendered with fetch stubbed. */
const OFFLINE_STUB = new Set(["fl", "ga", "ny", "uk"]);
const CITY_OF_LONDON = { siteLat: "51.5136", siteLon: "-0.0866" };
const pin = process.argv.includes("--pin");
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) fails++; };

const { mod, cleanup } = await loadRendererBundle();
try {
  const firm = { name: "Identity Check Firm", logoUrl: null };
  const hashes = {};
  const realFetch = globalThis.fetch;
  const offline = () => Promise.reject(new Error("identity check: network disabled"));
  for (const fam of FAMILIES) {
    const project = fam === "uk"
      ? { ...projectFromFixture(loadFixture("fl")), ...CITY_OF_LONDON }
      : projectFromFixture(loadFixture(fam));
    if (OFFLINE_STUB.has(fam)) globalThis.fetch = offline;
    try {
      const first = await mod.renderStudyPdf(project, firm);
      const a = pdfHash(first);
      const b = pdfHash(await mod.renderStudyPdf(project, firm));
      ok(a === b, `${fam}: two renders are identical (deterministic${OFFLINE_STUB.has(fam) ? ", fetch stubbed" : ""})`);
      if (fam === "tx") ok(pdfHash(recompressed(first)) === a, "tx: the hash ignores how zlib packed the streams (cross-platform)");
      hashes[fam] = a;
    } finally {
      globalThis.fetch = realFetch;
    }
  }
  if (pin) {
    writeFileSync(BASELINE, JSON.stringify(hashes, null, 2) + "\n");
    console.log(`pinned ${BASELINE}`);
  } else {
    ok(existsSync(BASELINE), "baseline file exists (run with --pin once)");
    const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
    for (const fam of FAMILIES) ok(hashes[fam] === base[fam], `${fam}: matches pinned baseline`);
  }
} finally { await cleanup(); }
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nALL PASS");
