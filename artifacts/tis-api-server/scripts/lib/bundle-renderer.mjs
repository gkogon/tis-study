import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile, unlink } from "node:fs/promises";
import { build as esbuild } from "../../node_modules/esbuild/lib/main.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = path.resolve(here, "../../src/lib");

/**
 * Bundle pdf-export.ts (+ report-theme) into a temp ESM file inside src/lib so
 * relative data paths resolve, import it, and return the module. Call
 * `cleanup()` when done. Extra exports: pass source lines like
 * `export { foo } from "./report-theme/foo";`.
 */
export async function loadRendererBundle(extraExports = "") {
  if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgres://localhost/tis_check_stub_db";
  const entry = path.join(lib, `.theme-bundle-entry-${process.pid}.ts`);
  const out = path.join(lib, `.theme-bundle-${process.pid}.mjs`);
  await writeFile(entry, `export { renderStudyPdf } from "./pdf-export";\n${extraExports}\n`, "utf8");
  await esbuild({
    entryPoints: [entry], platform: "node", bundle: true, format: "esm", outfile: out, logLevel: "error",
    external: ["*.node", "pdfkit", "fontkit", "pino", "pino-pretty", "esbuild-plugin-pino", "argon2", "bcrypt", "better-sqlite3", "pg-native", "canvas", "sharp", "ioredis", "pdfjs-dist"],
    banner: { js: `import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);` },
  });
  const mod = await import(out);
  const cleanup = async () => { await unlink(entry).catch(() => {}); await unlink(out).catch(() => {}); };
  return { mod, cleanup };
}
