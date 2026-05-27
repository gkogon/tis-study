import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const URL =
  'https://gdotbiext.dot.ga.gov/ext-bi/saw.dll?Dashboard&PortalPath=%2Fshared%2FExternal%2F_portal%2FCMIS%20Prequalified%20Consultants%20by%20Area%20Class&Action=Navigate&Syndicate=true&anon=1';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1600, height: 1200 },
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
  await page.waitForTimeout(8000);

  // Look for Apply button by every approach
  const candidates = await page.evaluate(() => {
    const results: Array<{ tag: string; class: string; id: string; text: string; visible: boolean; onclick: string }> = [];
    const all = Array.from(document.querySelectorAll('*'));
    for (const el of all) {
      const he = el as HTMLElement;
      const text = (he.innerText || he.textContent || '').trim();
      if (text === 'Apply' || (he.getAttribute('title') || '') === 'Apply' || (he.getAttribute('value') || '') === 'Apply') {
        const s = window.getComputedStyle(he);
        results.push({
          tag: he.tagName,
          class: he.className.substring(0, 100),
          id: he.id,
          text: text.substring(0, 50),
          visible: s.display !== 'none' && s.visibility !== 'hidden',
          onclick: (he.getAttribute('onclick') || '').substring(0, 100),
        });
      }
    }
    return results;
  });
  console.log(`Apply candidates: ${candidates.length}`);
  for (const c of candidates) console.log(JSON.stringify(c, null, 2));

  // Also check the prompt buttons cell
  const buttonsCell = await page.evaluate(() => {
    const cell = document.querySelector('.promptButtonsCell');
    return cell ? (cell as HTMLElement).outerHTML.slice(0, 3000) : 'not found';
  });
  console.log('\nbuttonsCell:');
  console.log(buttonsCell);

  await writeFile('/tmp/gdot_recon/apply_probe.html', await page.content());

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
