import { chromium } from 'playwright';

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
  await page.waitForTimeout(5000);

  // Click Category, select "Transporation Planning"
  console.log('Step 1: open Category, select Transporation Planning');
  await page
    .locator('text=Area Class Category')
    .locator('xpath=ancestor::tr[1]')
    .locator('.promptDropDownButton')
    .first()
    .click();
  await page.waitForTimeout(1000);
  await page.locator('.promptMenuOption:has-text("Transporation Planning")').first().click();
  await page.waitForTimeout(2000);

  // Now click Number
  console.log('Step 2: open Number');
  await page
    .locator('text=Area Class Number')
    .locator('xpath=ancestor::tr[1]')
    .locator('.promptDropDownButton')
    .first()
    .click();
  await page.waitForTimeout(2000);

  await page.screenshot({ path: '/tmp/gdot_recon/num_after_click.png', fullPage: true });

  const visible = await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('.promptMenuOption'));
    return opts
      .filter((el) => {
        const s = window.getComputedStyle(el as HTMLElement);
        return s.display !== 'none' && s.visibility !== 'hidden';
      })
      .map((el) => (el.textContent || '').trim());
  });
  console.log(`Visible promptMenuOptions after Number open: ${visible.length}`);
  for (const v of visible) console.log(`  - "${v}"`);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
