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

  // Open Category dropdown
  await page.locator('text=Area Class Category')
    .locator('xpath=ancestor::tr[1]')
    .locator('.promptDropDownButton')
    .first().click();
  await page.waitForTimeout(1500);

  // Dump the FULL HTML of the dropdown menu/popup
  const popupHtml = await page.evaluate(() => {
    // Find the parent that contains promptMenuOption items
    const opt = document.querySelector('.promptMenuOption');
    if (!opt) return null;
    // Walk up to find a container with all the options
    let container: Element | null = opt;
    for (let i = 0; i < 8; i++) {
      container = container.parentElement;
      if (!container) break;
      const optCount = container.querySelectorAll('.promptMenuOption').length;
      if (optCount > 5) return (container as HTMLElement).outerHTML;
    }
    return (opt.parentElement as HTMLElement)?.outerHTML ?? null;
  });
  if (popupHtml) {
    await writeFile('/tmp/gdot_recon/cat_popup.html', popupHtml);
    console.log(`Popup HTML written (${popupHtml.length} bytes)`);
  }

  // Get details of a specific option
  const transOpt = await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('.promptMenuOption'));
    const target = opts.find((o) => o.textContent?.includes('Transporation Planning'));
    if (!target) return null;
    const he = target as HTMLElement;
    return {
      tag: he.tagName,
      class: he.className,
      id: he.id,
      outerHTML: he.outerHTML.slice(0, 2000),
      // Look for checkbox/radio input inside
      hasCheckbox: !!he.querySelector('input[type="checkbox"]'),
      hasRadio: !!he.querySelector('input[type="radio"]'),
      checkboxState: (he.querySelector('input[type="checkbox"], input[type="radio"]') as HTMLInputElement)?.checked,
      ariaChecked: he.getAttribute('aria-checked'),
      ariaSelected: he.getAttribute('aria-selected'),
    };
  });
  console.log('Transporation Planning option details:');
  console.log(JSON.stringify(transOpt, null, 2));

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
