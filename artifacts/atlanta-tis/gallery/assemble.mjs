// Assembles alive-surfaces.html: title, Google Fonts link, the entire built app stylesheet
// (verbatim) + the gallery frame CSS, the root div, and the esbuild bundle inline.
//
// Run from artifacts/atlanta-tis, after `pnpm build` (APP_CSS is the hashed
// stylesheet vite emitted — update it when the build changes) and the bundle:
//   npx esbuild gallery/entry.tsx --bundle --format=iife --jsx=automatic --minify \
//     --target=es2022 --loader:.json=json --loader:.css=empty --alias:@=./src \
//     --define:process.env.NODE_ENV='"production"' --outfile=gallery/bundle.js
//   node gallery/assemble.mjs
// `.css=empty` drops the components' stylesheet imports (leaflet.css via the
// studio's DrivewayEditor): the app stylesheet inlined below already carries
// them, so the page needs no loader for Leaflet's marker PNGs.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const G = path.dirname(fileURLToPath(import.meta.url));
const APP_CSS = path.resolve(G, "../dist/public/assets/index-DZIf-2BZ.css");

const appCss = readFileSync(APP_CSS, "utf8");
const frameCss = readFileSync(`${G}/frame.css`, "utf8");
let bundle = readFileSync(`${G}/bundle.js`, "utf8");

// Post-processing of the bundle so nothing but the fonts host is referenced:
//  - lucide-react's default `xmlns` attribute (React already creates <svg> in the SVG namespace)
//  - React's minified-error doc URL prefix (a message string, never fetched) — drop the scheme
const before = { xmlns: (bundle.match(/xmlns:"http:\/\/www\.w3\.org\/2000\/svg",?/g) ?? []).length, react: (bundle.match(/https:\/\/react\.dev\/errors\//g) ?? []).length };
bundle = bundle.replace(/xmlns:"http:\/\/www\.w3\.org\/2000\/svg",?/g, "");
bundle = bundle.replace(/https:\/\/react\.dev\/errors\//g, "react.dev/errors/");
if (bundle.includes("</script")) throw new Error("bundle contains </script — would break inline embedding");
// Extra safety: `<!--` inside an inline script can confuse HTML parsing rules.
bundle = bundle.replace(/<!--/g, "<\\!--");

const html = `<title>Alive Surfaces</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap">
<style>
${appCss}
${frameCss}
</style>
<div id="root"></div>
<script>
${bundle}
</script>
`;
writeFileSync(`${G}/alive-surfaces.html`, html);
const bytes = Buffer.byteLength(html);
console.log(JSON.stringify({ bytes, replaced: before, httpHits: (html.match(/http/g) ?? []).length }));
