/**
 * Minimal: just open the dashboard, wait long, screenshot, dump basic state.
 * Page state might be flaky — find out what's there.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const URL =
  'https://gdotbiext.dot.ga.gov/ext-bi/saw.dll?Dashboard&PortalPath=%2Fshared%2FExternal%2F_portal%2FCMIS%20Prequalified%20Consultants%20by%20Area%20Class&Action=Navigate&Syndicate=true&anon=1';
const OUT = '/tmp/gdot_recon';

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1600, height: 1200 },
  });
  const page = await ctx.newPage();

  console.log(`Loading...`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('domcontentloaded');
  try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch { console.log('  no idle'); }
  console.log('post idle');
  await page.waitForTimeout(10000);
  console.log('post 10s wait');

  await page.screenshot({ path: `${OUT}/dbgv4_initial.png`, fullPage: true });
  await writeFile(`${OUT}/dbgv4.html`, await page.content());

  // Count things
  const counts = await page.evaluate(() => ({
    tables: document.querySelectorAll('table').length,
    promptLabels: document.querySelectorAll('.promptLabel').length,
    promptButtons: document.querySelectorAll('.promptDropDownButton').length,
    dataCells: document.querySelectorAll('td.mPTDC').length,
    allButtons: document.querySelectorAll('a, button, input[type=button], input[type=submit]').length,
    bodyTextLen: document.body.innerText.length,
    title: document.title,
  }));
  console.log(JSON.stringify(counts, null, 2));

  // Look for Area Class Category text anywhere
  const found = await page.evaluate(() => {
    return document.body.innerText.includes('Area Class Category');
  });
  console.log(`Body text contains "Area Class Category": ${found}`);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
