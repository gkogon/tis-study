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

  // Click the Area Class Number dropdown
  const numberBtn = page
    .locator('text=Area Class Number')
    .locator('xpath=ancestor::tr[1]')
    .locator('.promptDropDownButton');
  await numberBtn.first().click();
  await page.waitForTimeout(1500);

  // Dump EVERY element that became visible after click
  const newlyVisible = await page.evaluate(() => {
    // Walk every element, return those visible with text length 3-100
    const results: Array<{ tag: string; cls: string; id: string; text: string; rect: { x: number; y: number; w: number; h: number } }> = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const he = el as HTMLElement;
      const s = window.getComputedStyle(he);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const rect = he.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Skip large containers
      if (rect.width > 800) continue;
      const text = (he.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 3 || text.length > 120) continue;
      // Looking for items that look like area class options
      if (/^\d+\.\d+\s/.test(text)) {
        results.push({
          tag: he.tagName,
          cls: he.className,
          id: he.id,
          text,
          rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        });
      }
    }
    return results;
  });

  await writeFile(`${OUT}/options.json`, JSON.stringify(newlyVisible, null, 2));
  console.log(`Found ${newlyVisible.length} elements matching area class pattern`);
  console.log('First 20:');
  for (const e of newlyVisible.slice(0, 20)) {
    console.log(`  <${e.tag} class="${e.cls.slice(0, 40)}">${e.text}</${e.tag}>`);
  }

  await page.screenshot({ path: `${OUT}/probe2.png`, fullPage: true });

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
