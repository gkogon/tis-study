import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const URL =
  'https://gdotbiext.dot.ga.gov/ext-bi/saw.dll?Dashboard&PortalPath=%2Fshared%2FExternal%2F_portal%2FCMIS%20Prequalified%20Consultants%20by%20Area%20Class&Action=Navigate&Syndicate=true&anon=1';
const OUT = '/tmp/gdot_recon';

async function dumpVisibleMenuOptions(page: any, label: string) {
  const opts = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.promptMenuOption')) as HTMLElement[];
    return els
      .filter((el) => {
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim());
  });
  console.log(`  [${label}] visible promptMenuOption count: ${opts.length}`);
  for (const o of opts.slice(0, 20)) console.log(`    - "${o}"`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1600, height: 1200 },
  });
  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForLoadState('networkidle', { timeout: 30000 });
  } catch {}
  await page.waitForTimeout(5000);

  // Step 0: capture default state
  await page.screenshot({ path: `${OUT}/dbg_0_initial.png`, fullPage: true });

  // Step 1: click Category dropdown
  console.log('Step 1: click Category dropdown');
  const catBtn = page
    .locator('text=Area Class Category')
    .locator('xpath=ancestor::tr[1]')
    .locator('.promptDropDownButton');
  await catBtn.first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/dbg_1_cat_open.png`, fullPage: true });
  await dumpVisibleMenuOptions(page, 'category open');

  // Step 2: click "Transporation Planning"
  console.log('\nStep 2: select "Transporation Planning"');
  const catOpt = page.locator('.promptMenuOption:has-text("Transporation Planning")').first();
  await catOpt.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/dbg_2_cat_selected.png`, fullPage: true });

  // Step 3: click Number dropdown
  console.log('\nStep 3: click Number dropdown');
  const numBtn = page
    .locator('text=Area Class Number')
    .locator('xpath=ancestor::tr[1]')
    .locator('.promptDropDownButton');
  await numBtn.first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/dbg_3_num_open.png`, fullPage: true });
  await dumpVisibleMenuOptions(page, 'number open');

  // Step 4: try clicking 1.10
  console.log('\nStep 4: select 1.10');
  try {
    const numOpt = page.locator('.promptMenuOption:has-text("1.10")').first();
    await numOpt.waitFor({ state: 'visible', timeout: 5000 });
    await numOpt.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/dbg_4_num_selected.png`, fullPage: true });
    console.log('  selected 1.10 OK');
  } catch (e) {
    console.error(`  FAILED: ${(e as Error).message.split('\n')[0]}`);
    // Dump everything that's on screen
    const allText = await page.evaluate(() => document.body.innerText.slice(0, 5000));
    await writeFile(`${OUT}/dbg_4_screen_text.txt`, allText);
  }

  // Step 5: click Apply
  console.log('\nStep 5: click Apply');
  const apply = page.locator('a:has-text("Apply"), button:has-text("Apply"), input[value="Apply"]').first();
  if ((await apply.count()) > 0) {
    await apply.click();
    await page.waitForTimeout(3000);
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch {}
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/dbg_5_after_apply.png`, fullPage: true });
    console.log('  Apply clicked');
  } else {
    console.log('  no Apply button found');
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
