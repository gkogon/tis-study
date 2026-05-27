import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const DASHBOARD_URL_BY_FIRM =
  'https://gdotbiext.dot.ga.gov/ext-bi/saw.dll?Dashboard&PortalPath=%2Fshared%2FExternal%2F_portal%2FCMIS%20Prequalified%20Consultants%20by%20Firm&Action=Navigate&Syndicate=true&anon=1';

const OUT_DIR = '/tmp/gdot_recon';

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const headed = process.argv.includes('--headed');
  console.log(`Launching (headed=${headed})...`);
  const browser = await chromium.launch({ headless: !headed });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1600, height: 1200 },
  });
  const page = await ctx.newPage();

  console.log(`Loading by-firm dashboard...`);
  await page.goto(DASHBOARD_URL_BY_FIRM, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try {
    await page.waitForLoadState('networkidle', { timeout: 30000 });
  } catch {
    console.log('  network not idle in 30s — continuing');
  }
  await page.waitForTimeout(5000);

  console.log(`Title: ${await page.title()}`);
  await page.screenshot({ path: `${OUT_DIR}/by_firm.png`, fullPage: true });
  await writeFile(`${OUT_DIR}/by_firm.html`, await page.content());

  // Probe: how many tables, prompts, options
  const tableCount = await page.locator('table').count();
  const promptCount = await page.locator('[class*="Prompt"]').count();
  console.log(`tables=${tableCount} prompts=${promptCount}`);

  // Find any visible filter prompts and their captions
  const captions = await page.locator('.XUIPromptCaption, .masterPrompt').allInnerTexts();
  console.log(`Prompt captions: ${JSON.stringify(captions.slice(0, 10))}`);

  // Look for the OBIEE results table — pivot tables have class mPTDC on cells
  const dataCellCount = await page.locator('td.mPTDC').count();
  console.log(`Data cells (td.mPTDC): ${dataCellCount}`);

  // Try to extract row data
  const rows = await page.evaluate(() => {
    // OBIEE pivot tables: rows are <tr> containing td.mPTDC cells
    const tables = Array.from(document.querySelectorAll('table'));
    // Find the table that contains the most mPTDC cells
    let bestTable: HTMLTableElement | null = null;
    let bestCount = 0;
    for (const t of tables) {
      const c = t.querySelectorAll('td.mPTDC').length;
      if (c > bestCount) {
        bestCount = c;
        bestTable = t as HTMLTableElement;
      }
    }
    if (!bestTable) return { error: 'no table', rows: [] };
    const rows: string[][] = [];
    for (const tr of Array.from(bestTable.querySelectorAll('tr'))) {
      const cells = Array.from(tr.querySelectorAll('td.mPTDC')).map((td) =>
        (td.textContent || '').replace(/\s+/g, ' ').trim()
      );
      if (cells.length > 0) rows.push(cells);
    }
    return { rows, bestCount };
  });
  console.log(`Extracted ${rows.rows.length} data rows (${rows.bestCount} cells)`);
  if (rows.rows.length > 0) {
    console.log('First 3 rows:');
    for (const r of rows.rows.slice(0, 3)) console.log('  ', r);
  }

  await writeFile(`${OUT_DIR}/by_firm_rows.json`, JSON.stringify(rows, null, 2));

  if (headed) {
    console.log('Headed — pausing 60s');
    await page.waitForTimeout(60000);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
