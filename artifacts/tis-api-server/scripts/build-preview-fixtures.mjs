// Copies the sample masters (gitignored, private/) into committed preview
// fixtures, one per regional renderer family. Re-run only when a master is
// regenerated. Run: node ./scripts/build-preview-fixtures.mjs
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const MASTERS = "/Users/geraldkogon/tis-study/private/county-samples-tampa";
const OUT = path.resolve(here, "../data/preview-fixtures");
const MAP = { fl: "master-broward.json", ga: "master-bartow.json", tx: "master-bexar.json", ny: "master-nassau.json", nc: "master-wake.json", sc: "master-richland.json" };
mkdirSync(OUT, { recursive: true });
for (const [family, file] of Object.entries(MAP)) {
  const m = JSON.parse(readFileSync(path.join(MASTERS, file), "utf8"));
  const report = m.report ?? m;
  const fx = { family, key: file.replace(/^master-|\.json$/g, ""), projectName: m.projectName, latitude: m.latitude, longitude: m.longitude, landUseCode: String(m.landUseCode ?? ""), report };
  writeFileSync(path.join(OUT, `${family}.json`), JSON.stringify(fx));
  console.log(family, file, `${Math.round(JSON.stringify(fx).length / 1024)} KB`);
}
