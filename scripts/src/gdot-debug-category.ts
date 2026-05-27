import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const URL =
  'https://gdotbiext.dot.ga.gov/ext-bi/saw.dll?Dashboard&PortalPath=%2Fshared%2FExternal%2F_portal%2FCMIS%20Prequalified%20Consultants%20by%20Area%20Class&Action=Navigate&Syndicate=true&anon=1';

async function main() {
  await mkdir('/tmp/gdot_recon', { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1600, height: 1200 },
  });
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
  await page.waitForTimeout(5000);

  // 1. How many promptDropDownButton are on the page total?
  const btnCount = await page.locator('.promptDropDownButton').count();
  console.log(`Total promptDropDownButtons: ${btnCount}`);

  // 2. Look up the Category row specifically
  const categoryBtn = page
    .locator('text=Area Class Category')
    .locator('xpath=ancestor::tr[1]')
    .locator('.promptDropDownButton');
  console.log(`Category button count via locator: ${await categoryBtn.count()}`);

  // 3. Also try with text only
  const altCount = await page.locator('text=Area Class Category').count();
  console.log(`Elements matching "Area Class Category" text: ${altCount}`);

  // 4. Click and observe
  console.log('Clicking Category dropdown...');
  await categoryBtn.first().click();
  await page.waitForTimeout(2000);

  // 5. What's visible now?
  await page.screenshot({ path: '/tmp/gdot_recon/cat_after_click.png', fullPage: true });

  const visibleOptions = await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('.promptMenuOption'));
    return opts
      .filter((el) => {
        const s = window.getComputedStyle(el as HTMLElement);
        return s.display !== 'none' && s.visibility !== 'hidden';
      })
      .map((el) => (el.textContent || '').trim());
  });
  console.log(`Visible promptMenuOption count: ${visibleOptions.length}`);
  console.log(`First 30:`);
  for (const o of visibleOptions.slice(0, 30)) console.log(`  - ${o}`);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
