/**
 * Probe NCDOT Vendor Directory work-code search to understand form interaction.
 * Targets work codes 252 (Traffic Impact Studies) and 205 (School & Traffic Operations Studies).
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const URL = 'https://www.ebs.nc.gov/VendorDirectory/search.html?s=wc&a=new';
const OUT = '/tmp/ncdot_recon';

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1600, height: 1200 },
  });
  const page = await ctx.newPage();

  console.log(`Loading...`);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
  await page.waitForTimeout(5000);

  await page.screenshot({ path: `${OUT}/probe_initial.png`, fullPage: true });
  await writeFile(`${OUT}/probe_initial.html`, await page.content());

  // Inspect: where can I enter the work code?
  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input, select, textarea, button')).map((el) => {
      const he = el as HTMLElement;
      const r = he.getBoundingClientRect();
      return {
        tag: he.tagName,
        type: (he as HTMLInputElement).type || '',
        name: (he as HTMLInputElement).name || '',
        id: he.id,
        value: (he as HTMLInputElement).value?.slice(0, 50) || '',
        placeholder: (he as HTMLInputElement).placeholder || '',
        cls: he.className.slice(0, 60),
        visible: r.width > 0 && r.height > 0,
        x: Math.round(r.x),
        y: Math.round(r.y),
      };
    }).filter((b) => b.visible);
  });
  console.log(`Visible inputs/buttons (${inputs.length}):`);
  for (const i of inputs.slice(0, 30)) {
    console.log(`  <${i.tag} type="${i.type}" name="${i.name}" id="${i.id}" placeholder="${i.placeholder}" cls="${i.cls.slice(0, 30)}" @(${i.x},${i.y})> "${i.value}"`);
  }

  // Look for work code references in the visible options/buttons
  const wkCodeRefs = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('option, label, button, a, td, span')).filter((el) => {
      const text = (el.textContent || '').trim();
      return /^(252|205|000252|000205|Traffic Impact)/i.test(text);
    });
    return all.slice(0, 20).map((el) => {
      const he = el as HTMLElement;
      const r = he.getBoundingClientRect();
      return {
        tag: he.tagName,
        text: (he.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        visible: r.width > 0 && r.height > 0,
      };
    });
  });
  console.log(`\nWork code 252/205/"Traffic Impact" references:`);
  for (const r of wkCodeRefs) console.log(`  <${r.tag} vis=${r.visible}>${r.text}</${r.tag}>`);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
