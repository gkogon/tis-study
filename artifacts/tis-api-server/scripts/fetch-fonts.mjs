// Downloads the bundled substitute fonts listed in fonts-manifest.json into
// data/fonts/<family>/{Regular,Bold,Italic,BoldItalic}.ttf + LICENSE.txt.
// Idempotent: existing files are kept. Run: node ./scripts/fetch-fonts.mjs
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdirSync, existsSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.resolve(here, "fonts-manifest.json"), "utf8"));
const outRoot = path.resolve(here, "../data/fonts");

async function get(url) {
  const r = await fetch(url, { redirect: "follow" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

const archives = new Map(); // url → extracted dir
async function fromArchive(url) {
  if (archives.has(url)) return archives.get(url);
  const dir = mkdtempSync(path.join(os.tmpdir(), "fonts-"));
  writeFileSync(path.join(dir, "a.tgz"), await get(url));
  execFileSync("tar", ["xzf", "a.tgz"], { cwd: dir });
  archives.set(url, dir);
  return dir;
}

let failures = 0;
for (const [family, spec] of Object.entries(manifest)) {
  const dir = path.join(outRoot, family);
  mkdirSync(dir, { recursive: true });
  for (const [style, rel] of Object.entries(spec.files)) {
    const dest = path.join(dir, `${style}.ttf`);
    if (existsSync(dest)) { console.log(`keep  ${family}/${style}.ttf`); continue; }
    try {
      if (spec.archive) {
        const adir = await fromArchive(spec.archive);
        writeFileSync(dest, readFileSync(path.join(adir, spec.prefix, rel)));
      } else {
        writeFileSync(dest, await get(spec.base + rel));
      }
      console.log(`fetch ${family}/${style}.ttf`);
    } catch (e) { console.error(`FAIL  ${family}/${style}: ${e.message}`); failures++; }
  }
  const licDest = path.join(dir, "LICENSE.txt");
  if (!existsSync(licDest)) {
    const cands = Array.isArray(spec.licence) ? spec.licence : [spec.licence];
    let done = false;
    for (const c of cands) {
      try {
        const buf = spec.archive ? readFileSync(path.join(await fromArchive(spec.archive), spec.prefix, c)) : await get(spec.base + c);
        writeFileSync(licDest, buf); done = true; console.log(`fetch ${family}/LICENSE.txt (${c})`); break;
      } catch { /* try next */ }
    }
    if (!done) { console.error(`FAIL  ${family}: no licence file found among ${cands.join(", ")}`); failures++; }
  }
}
for (const dir of archives.values()) rmSync(dir, { recursive: true, force: true });
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("fonts ready");
