/**
 * Convert per-region road files from raw `<slug>-roads.json` to
 * gzip-compressed `<slug>-roads.json.gz` (gzip -9 equivalent).
 *
 * Why: 316 road files total ~1.06GB raw today and a projected ~3.4GB after
 * the residential refetch. gzip -9 holds them at ~20-24% of raw, and — the
 * hard constraint — keeps florida-statewide (~116MB raw post-refetch) under
 * GitHub's 100MB per-file push block. Every reader (api-server
 * data-files.ts, scripts road-file-io.ts) prefers .json.gz with a .json
 * fallback, so conversion is safe one region at a time.
 *
 * Safety: each file is verified after writing — the .gz is read back from
 * disk, gunzipped, and must be byte-identical to the original raw JSON
 * (which implies parse-equality: same segments, same everything). The raw
 * .json is deleted ONLY when --replace is passed AND verification passed.
 * Idempotent: an existing, verified .gz is left alone.
 *
 * Run:
 *   pnpm --filter @workspace/scripts exec tsx src/gzip-roads.ts            # all regions, keep raw
 *   pnpm --filter @workspace/scripts exec tsx src/gzip-roads.ts --replace  # all regions, delete raw after verify
 *   pnpm --filter @workspace/scripts exec tsx src/gzip-roads.ts miami-dade atlanta   # specific slugs
 *   pnpm --filter @workspace/scripts exec tsx src/gzip-roads.ts --data-dir /path/to/data --replace
 */

import { readFileSync, writeFileSync, rmSync, readdirSync, existsSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipJson } from "./road-file-io";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATA_DIR = path.resolve(__dirname, "../../artifacts/api-server/src/data");

function fail(msg: string): never {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  const replace = args.includes("--replace");
  const ddIdx = args.indexOf("--data-dir");
  const dataDir = ddIdx >= 0 ? path.resolve(args[ddIdx + 1] ?? fail("--data-dir needs a path")) : DEFAULT_DATA_DIR;
  const slugArgs = args.filter((a, i) => !a.startsWith("--") && i !== ddIdx + 1);

  if (!existsSync(dataDir)) fail(`data dir not found: ${dataDir}`);

  const slugs = slugArgs.length
    ? slugArgs
    : readdirSync(dataDir)
        .filter((n) => n.endsWith("-roads.json"))
        .map((n) => n.slice(0, -"-roads.json".length))
        .sort();

  if (slugs.length === 0) {
    console.log(`Nothing to do: no *-roads.json in ${dataDir}`);
    return;
  }

  let rawTotal = 0;
  let gzTotal = 0;
  let converted = 0;
  let skipped = 0;
  let deleted = 0;
  let failures = 0;

  for (const slug of slugs) {
    const rawPath = path.resolve(dataDir, `${slug}-roads.json`);
    const gzPath = path.resolve(dataDir, `${slug}-roads.json.gz`);

    if (!existsSync(rawPath)) {
      if (existsSync(gzPath)) {
        console.log(`skip ${slug}: already gz-only`);
        skipped++;
      } else {
        console.error(`MISS ${slug}: neither ${rawPath} nor .gz exists`);
        failures++;
      }
      continue;
    }

    const raw = readFileSync(rawPath);

    // Idempotency: a pre-existing .gz that gunzips to exactly the raw bytes
    // needs no rewrite (a prior run was interrupted before --replace).
    let needWrite = true;
    if (existsSync(gzPath)) {
      try {
        needWrite = !gunzipSync(readFileSync(gzPath)).equals(raw);
      } catch {
        needWrite = true; // corrupt/partial .gz — rewrite it
      }
    }

    if (needWrite) writeFileSync(gzPath, gzipJson(raw));

    // Verify from DISK, not memory: read the .gz back, gunzip, and require
    // byte-identity with the raw source. Byte-identity implies parse
    // equality (same ways, segment for segment). Also parse once to prove
    // the round-trip yields well-formed JSON with the expected shape.
    let verified = false;
    try {
      const roundTrip = gunzipSync(readFileSync(gzPath));
      if (roundTrip.equals(raw)) {
        const doc = JSON.parse(roundTrip.toString("utf8")) as { classes?: unknown; ways?: unknown };
        verified = Array.isArray(doc.classes) && Array.isArray(doc.ways);
      }
    } catch {
      verified = false;
    }

    if (!verified) {
      console.error(`FAIL ${slug}: round-trip mismatch — raw file left untouched`);
      rmSync(gzPath, { force: true });
      failures++;
      continue;
    }

    const gzBytes = statSync(gzPath).size;
    rawTotal += raw.length;
    gzTotal += gzBytes;
    converted += needWrite ? 1 : 0;
    skipped += needWrite ? 0 : 1;

    if (replace) {
      rmSync(rawPath);
      deleted++;
    }

    console.log(
      `${needWrite ? "gzip" : "keep"} ${slug}: ${raw.length.toLocaleString()} B -> ${gzBytes.toLocaleString()} B `
      + `(${((100 * gzBytes) / raw.length).toFixed(1)}%)${replace ? " [raw deleted]" : ""}`,
    );
  }

  console.log(`\n=== Summary ===`);
  console.log(`  written: ${converted}, already-current: ${skipped}, raw deleted: ${deleted}, failures: ${failures}`);
  if (rawTotal > 0) {
    console.log(`  bytes: ${rawTotal.toLocaleString()} raw -> ${gzTotal.toLocaleString()} gz (${((100 * gzTotal) / rawTotal).toFixed(1)}%)`);
  }
  process.exit(failures > 0 ? 1 : 0);
}

main();
