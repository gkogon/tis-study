// Copies the sample masters (gitignored, private/) into committed preview
// fixtures, one per regional renderer family. Re-run only when a master is
// regenerated. Run: node ./scripts/build-preview-fixtures.mjs
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const MASTERS = "/Users/geraldkogon/tis-study/private/county-samples-tampa";
// Deepened masters (17-20 intersections) are preferred where they exist —
// previews and the later overflow checks need multi-intersection studies,
// not the 2-intersection quick samples in the base directory.
const MASTERS_DEEP = "/Users/geraldkogon/tis-study/private/county-samples-tampa/deepened-2026-08-11";
const OUT = path.resolve(here, "../data/preview-fixtures");
const MAP = {
  fl: { file: "master-broward.json", dir: MASTERS_DEEP },
  ga: { file: "master-bartow.json", dir: MASTERS },
  tx: { file: "master-bexar.json", dir: MASTERS_DEEP },
  ny: { file: "master-nassau.json", dir: MASTERS },
  nc: { file: "master-wake.json", dir: MASTERS_DEEP },
  sc: { file: "master-richland.json", dir: MASTERS_DEEP },
};
mkdirSync(OUT, { recursive: true });
for (const [family, { file, dir }] of Object.entries(MAP)) {
  const m = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
  const report = m.report ?? m;
  const fx = { family, key: file.replace(/^master-|\.json$/g, ""), projectName: m.projectName, latitude: m.latitude, longitude: m.longitude, landUseCode: String(m.landUseCode ?? ""), report };
  writeFileSync(path.join(OUT, `${family}.json`), JSON.stringify(fx));
  console.log(family, file, `${Math.round(JSON.stringify(fx).length / 1024)} KB`);
}
