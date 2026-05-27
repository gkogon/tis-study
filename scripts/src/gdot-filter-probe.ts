import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const URL =
  'https://gdotbiext.dot.ga.gov/ext-bi/saw.dll?Dashboard&PortalPath=%2Fshared%2FExternal%2F_portal%2FCMIS%20Prequalified%20Consultants%20by%20Area%20Class&Action=Navigate&Syndicate=true&anon=1';

const OUT = '/tmp/gdot_recon';

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

  // Find every clickable element with promptDropDown class
  const dropDowns = await page.locator('.promptDropDownButton').all();
  console.log(`promptDropDownButton count: ${dropDowns.length}`);

  // Find every element with caption text
  const captionEls = await page.locator('.XUIPromptCaption, .masterPrompt').all();
  for (let i = 0; i < captionEls.length; i++) {
    const text = await captionEls[i].textContent();
    const tag = await captionEls[i].evaluate((el) => el.tagName);
    const cls = await captionEls[i].evaluate((el) => el.className);
    console.log(`[${i}] <${tag} class="${cls}">${text?.slice(0, 100)}</${tag}>`);
  }

  // Inspect the structure around the second dropdown
  // The two prompts should be siblings in a table
  const promptStructure = await page.evaluate(() => {
    const captions = document.querySelectorAll('.XUIPromptCaption');
    const result: Array<{ caption: string; html: string }> = [];
    for (const cap of Array.from(captions)) {
      const text = cap.textContent?.trim() ?? '';
      // Walk up to a row container
      let cell: Element | null = cap;
      while (cell && cell.tagName !== 'TR') cell = cell.parentElement;
      if (cell) {
        result.push({ caption: text, html: (cell as HTMLElement).outerHTML.slice(0, 3000) });
      }
    }
    return result;
  });
  await writeFile(`${OUT}/prompt_structure.json`, JSON.stringify(promptStructure, null, 2));
  console.log(`\nWrote prompt structure (${promptStructure.length} prompt rows)`);

  // Now try clicking the second prompt's dropdown button
  // Find the button element near "Area Class Number"
  console.log('\n--- Clicking Area Class Number dropdown ---');
  const result = await page.evaluate(() => {
    const captions = Array.from(document.querySelectorAll('.XUIPromptCaption'));
    const target = captions.find((c) => c.textContent?.includes('Area Class Number'));
    if (!target) return { found: false };
    // Walk up to row, then find the dropdown button inside
    let row: Element | null = target;
    while (row && row.tagName !== 'TR') row = row.parentElement;
    if (!row) return { found: true, row: false };
    const btn = row.querySelector('.promptDropDownButton, [class*="DropDown"], a[onclick]');
    if (!btn) return { found: true, row: true, btn: false };
    // Return info about the button, don't click yet (will click via locator)
    return {
      found: true,
      row: true,
      btn: true,
      btnTag: btn.tagName,
      btnClass: (btn as HTMLElement).className,
      btnText: btn.textContent?.slice(0, 100),
      btnId: (btn as HTMLElement).id,
    };
  });
  console.log(JSON.stringify(result, null, 2));

  // Try locator-based click
  const numberBtnLocator = page.locator('text=Area Class Number').locator('xpath=ancestor::tr[1]').locator('.promptDropDownButton');
  const btnCount = await numberBtnLocator.count();
  console.log(`number dropdown button count via locator: ${btnCount}`);
  if (btnCount > 0) {
    await numberBtnLocator.first().click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/after_click.png`, fullPage: true });
    // Capture popup HTML
    const popupHtml = await page.evaluate(() => {
      // OBIEE popups: look for visible elements with class containing 'Layer' or 'popup'
      const popups = Array.from(document.querySelectorAll('[class*="Layer"], [class*="Popup"], [class*="DropDown"]'))
        .filter((el) => {
          const s = window.getComputedStyle(el as HTMLElement);
          return s.display !== 'none' && s.visibility !== 'hidden';
        })
        .slice(0, 5);
      return popups.map((el) => ({ class: el.className, html: (el as HTMLElement).outerHTML.slice(0, 2000) }));
    });
    await writeFile(`${OUT}/popup.json`, JSON.stringify(popupHtml, null, 2));
    console.log(`Wrote popup info (${popupHtml.length} popups)`);
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
