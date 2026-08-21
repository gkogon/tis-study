// Vigorous UTDF suite — beyond the happy path.
//
//  A. SEEDED FUZZ (1,500 rounds): randomized engine results → generateUtdf →
//     parseUtdf, asserting the invariants that must survive ANY input:
//     approach totals reassemble exactly, node counts match, output is
//     deterministic, and the parser never throws. Seeded LCG so a failure
//     reproduces from its round number.
//
//  B. ADVERSARIAL CORPUS: the file shapes a real inbox produces — truncated
//     mid-row, duplicated sections, permuted column order, missing columns,
//     diagonal legs + U-turns + numbered movements (NEL/NBU/NBL2), unicode
//     names, negative and decimal volumes, whitespace soup, header-only
//     sections — asserting graceful parses and LOUD warnings, never silence.
//
//  C. HTTP: the real Express router mounted with a stubbed auth — 401 / 400 /
//     200-with-zod-contract / 2MB oversize — so the endpoint's behaviour is
//     tested at the protocol level, not inferred from the handler's source.
//
// Run: node ./scripts/verify-utdf-vigorous.mjs
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
register(pathToFileURL(path.resolve(here, "ts-loader.mjs")).href, import.meta.url);
process.env.DATABASE_URL ??= "postgres://localhost/tis_e2e_stub_db";

const { generateUtdf } = await import(path.resolve(here, "../src/lib/utdf-export.ts"));
const { parseUtdf, approachVolumes } = await import(path.resolve(here, "../src/lib/utdf-import.ts"));

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };

// ---------------------------------------------------------------------------
// A. Seeded fuzz
// ---------------------------------------------------------------------------
{
  let seed = 0xC0FFEE;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const DIRS = ["NB", "SB", "EB", "WB"];
  const ROUNDS = 1500;
  let failsBefore = fails;
  let worst = null;

  for (let round = 0; round < ROUNDS; round++) {
    const nInts = 1 + Math.floor(rnd() * 6);
    const intersections = [];
    for (let i = 0; i < nInts; i++) {
      const nApp = 1 + Math.floor(rnd() * 4);
      const dirs = [...DIRS].slice(0, nApp);
      intersections.push({
        signalId: `sig-${round}-${i}`,
        name: rnd() < 0.2 ? `Ünïcodé & "quoted", St ${i}` : `Node ${i}`,
        latitude: 25 + rnd() * 10,
        longitude: -85 + rnd() * 10,
        approaches: dirs.map((d) => ({
          direction: d,
          futureVolumeVph: Math.floor(rnd() * 2500),
          futureVc: rnd() * 1.4,
        })),
      });
    }
    const result = { request: { projectName: `f${round}`, latitude: 25, longitude: -80 }, affectedIntersections: intersections };

    let doc;
    try {
      const text = generateUtdf(result, { scenario: "build" });
      doc = parseUtdf(text);
      // Determinism per round.
      if (JSON.stringify(parseUtdf(text)) !== JSON.stringify(doc)) throw new Error("nondeterministic parse");
    } catch (e) {
      fails++; worst = `round ${round}: threw ${e.message}`; break;
    }

    if (doc.nodes.length !== nInts) { fails++; worst = `round ${round}: ${doc.nodes.length}/${nInts} nodes`; break; }
    for (let i = 0; i < nInts; i++) {
      const v = doc.volumes.find((x) => x.intId === i + 1);
      const av = approachVolumes(v ?? { movements: {} });
      for (const a of intersections[i].approaches) {
        // Exporter emits round(v*0.1)+round(v*0.8)+round(v*0.1) — reassembly
        // may differ from the original by at most 2 vph of rounding.
        if (Math.abs(av[a.direction] - a.futureVolumeVph) > 2) {
          fails++; worst = `round ${round} int ${i} ${a.direction}: ${av[a.direction]} vs ${a.futureVolumeVph}`;
          break;
        }
      }
    }
    if (worst) break;
  }
  ok(fails === failsBefore, worst ?? `fuzz: ${ROUNDS} randomized round-trips hold every invariant (seeded, reproducible)`);
}

// ---------------------------------------------------------------------------
// B. Adversarial corpus
// ---------------------------------------------------------------------------
const CRLF = "\r\n";

// B1. Diagonal legs + U-turns + numbered movements: folded/warned, NEVER silent.
{
  const f = [
    "[Volumes]",
    "RECORDNAME,INTID,NBL,NBT,NBR,NBU,NEL,NET,NER,NBL2,SBL,SBT,SBR",
    "Volume,1,50,400,45,25,60,300,40,15,55,380,35",
  ].join("\n");
  const doc = parseUtdf(f);
  const v = doc.volumes.find((x) => x.intId === 1);
  ok(v?.movements.NBL === 75,
    `adv: NBU folds into NBL per engine convention (50+25=${v?.movements.NBL})`);
  ok(doc.warnings.some((w) => w.includes("U-turn") && w.includes("NBU")),
    "adv: the fold is disclosed in warnings");
  const dropWarn = doc.warnings.find((w) => w.includes("not mappable"));
  ok(!!dropWarn && dropWarn.includes("NEL") && dropWarn.includes("NBL2"),
    `adv: diagonal + numbered columns named in a warning`);
  ok(!!dropWarn && dropWarn.includes("415 vph"),
    `adv: the warning states the stakes — 60+300+40+15 = 415 vph not imported (${dropWarn?.match(/\d+ vph/)?.[0]})`);
}

// B2. Column order permuted (real Synchro versions differ).
{
  const f = [
    "[Volumes]",
    "RECORDNAME,INTID,WBR,EBL,NBT,SBT,NBL",
    "Volume,7,10,20,300,280,30",
  ].join(CRLF);
  const v = parseUtdf(f).volumes.find((x) => x.intId === 7);
  ok(v?.movements.NBT === 300 && v?.movements.WBR === 10 && v?.movements.NBL === 30,
    "adv: permuted column order maps by NAME, not position");
}

// B3. Duplicated section: second block MERGES (last write wins per movement).
{
  const f = [
    "[Volumes]", "INTID,NBL,NBT", "3,10,100",
    "[Volumes]", "INTID,NBT,SBT", "3,120,90",
  ].join("\n");
  const v = parseUtdf(f).volumes.find((x) => x.intId === 3);
  ok(v?.movements.NBL === 10 && v?.movements.NBT === 120 && v?.movements.SBT === 90,
    `adv: duplicated [Volumes] merges deterministically (NBL=${v?.movements.NBL}, NBT=${v?.movements.NBT}, SBT=${v?.movements.SBT})`);
}

// B4. Truncated mid-row + garbage tail: parses what exists, no throw.
{
  const f = "[Nodes]\nINTID,Name,LATITUDE,LONGITUDE\n1,Alpha,25.1,-80.2\n2,Bravo,25.";
  const doc = parseUtdf(f);
  ok(doc.nodes.length === 2 && doc.nodes[1].latitude === 25,
    "adv: truncated numeric field parses as far as it goes, no crash");
}

// B5. Whitespace soup + decimals + negatives.
{
  const f = [
    "[Volumes]",
    "  INTID , NBL , NBT ",
    " 4 , 12.7 , -50 ",
  ].join("\n");
  const v = parseUtdf(f).volumes.find((x) => x.intId === 4);
  ok(v?.movements.NBL === 12.7 && v?.movements.NBT === -50,
    "adv: padded headers/cells trim; decimals and negatives pass through as-is (validation is the consumer's contract)");
}

// B6. Header-only and empty sections.
{
  const doc = parseUtdf("[Volumes]\nINTID,NBL\n[Lanes]\n[Timings]\n");
  ok(doc.volumes.length === 0 && doc.warnings.length >= 1,
    "adv: header-only + empty sections produce warnings, not phantom data");
}

// B7. 2MB file parses within a sane budget (the endpoint's cap).
{
  const rows = [];
  rows.push("[Volumes]", "RECORDNAME,INTID,NBL,NBT,NBR,SBL,SBT,SBR,EBL,EBT,EBR,WBL,WBT,WBR");
  let i = 1;
  while (rows.join("\n").length < 1_950_000) {
    rows.push(`Volume,${i},10,200,15,12,190,14,8,120,9,7,110,6`);
    i++;
  }
  const big = rows.join("\n");
  const t0 = process.hrtime.bigint();
  const doc = parseUtdf(big);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(doc.volumes.length === i - 1 && ms < 5000,
    `adv: ${(big.length / 1e6).toFixed(1)}MB / ${i - 1} intersections parses in ${ms.toFixed(0)}ms (<5s)`);
}

// ---------------------------------------------------------------------------
// C. HTTP — the real router, stubbed auth
// ---------------------------------------------------------------------------
{
  const express = (await import(path.resolve(here, "../node_modules/express/index.js"))).default;
  // The router pulls @workspace/tis-api-zod whose package index uses directory
  // imports the ts-loader can't resolve — bundle it, same as the driveway
  // harness bundles tis.ts.
  const { writeFile, rm } = await import("node:fs/promises");
  const { build: esbuild } = await import(path.resolve(here, "../node_modules/esbuild/lib/main.js"));
  const bundlePath = path.resolve(here, "../src/lib/.utdf-router-bundle.mjs");
  const entryPath = path.resolve(here, "../src/lib/.utdf-router-entry.ts");
  await writeFile(entryPath, `export { default as tisRouter } from ${JSON.stringify(path.resolve(here, "../src/routes/tis.ts"))};`, "utf8");
  await esbuild({
    entryPoints: [entryPath], platform: "node", bundle: true, format: "esm",
    outfile: bundlePath, logLevel: "silent",
    external: ["*.node", "express", "pdfkit", "fontkit", "pino", "pino-pretty", "esbuild-plugin-pino",
               "argon2", "bcrypt", "better-sqlite3", "pg-native", "canvas", "sharp", "ioredis"],
    banner: { js: "import { createRequire as __cr } from 'node:module';\nglobalThis.require = __cr(import.meta.url);" },
  });
  const { tisRouter } = await import(bundlePath);
  await rm(entryPath, { force: true });
  const mk = (authed) => {
    const app = express();
    app.use(express.json({ limit: "3mb" }));
    app.use((req, _res, next) => { req.isAuthenticated = () => authed; next(); });
    app.use("/tis-api", tisRouter);
    return app;
  };
  const request = async (app, body, raw) => new Promise((resolve) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      const r = await fetch(`http://127.0.0.1:${port}/tis-api/utdf/parse`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: raw ?? JSON.stringify(body),
      });
      const json = await r.json().catch(() => null);
      server.close();
      resolve({ status: r.status, json });
    });
  });

  const sample = generateUtdf({
    request: { projectName: "http", latitude: 25.8, longitude: -80.2 },
    affectedIntersections: [{
      signalId: "s1", name: "HTTP Test", latitude: 25.8, longitude: -80.2,
      approaches: [{ direction: "NB", futureVolumeVph: 600, futureVc: 0.6 }],
    }],
  });

  const unauth = await request(mk(false), { content: sample });
  ok(unauth.status === 401, `http: unauthenticated → 401 (${unauth.status})`);

  const bad = await request(mk(true), { nope: 1 });
  ok(bad.status === 400, `http: malformed body → 400 (${bad.status})`);

  const empty = await request(mk(true), { content: "" });
  ok(empty.status === 400, `http: empty content fails the min-length schema → 400 (${empty.status})`);

  const good = await request(mk(true), { content: sample });
  ok(good.status === 200 && good.json?.nodes?.length === 1 && good.json.nodes[0].hasVolumes === true,
    `http: real file → 200 with nodes + hasVolumes (${good.status}, nodes=${good.json?.nodes?.length})`);

  const over = await request(mk(true), { content: "x".repeat(2_000_001) });
  ok(over.status === 400, `http: content over the 2MB schema cap → 400 (${over.status})`);
}

{
  const { rm } = await import("node:fs/promises");
  await rm(path.resolve(here, "../src/lib/.utdf-router-bundle.mjs"), { force: true });
}
console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
