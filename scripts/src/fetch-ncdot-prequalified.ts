/**
 * Scrape NCDOT Vendor Directory for firms prequalified in TIS-relevant work codes.
 *   - 000252: Traffic Impact Studies (primary target)
 *   - 000205: School and Traffic Operations Studies
 *
 * Form is at https://www.ebs.nc.gov/VendorDirectory/search.html?s=wc&a=new
 * Strategy: type code into txtcode field, click "Add to Selection", repeat, submit.
 *
 * Run: pnpm exec tsx src/fetch-ncdot-prequalified.ts [--headed]
 */
import { chromium, type Page } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const URL = 'https://www.ebs.nc.gov/VendorDirectory/search.html?s=wc&a=new';
const OUT_DIR = '/tmp/ncdot_prequal';

const TARGET_CODES = ['252', '205']; // Traffic Impact Studies, School & Traffic Ops Studies

interface Firm {
  company: string;
  city?: string;
  state?: string;
  workCode: string;
  // Extra fields if available on results page
  address?: string;
  zip?: string;
  phone?: string;
  email?: string;
  contact?: string;
  raw?: string[];
}

async function addCode(page: Page, code: string) {
  console.log(`  adding code ${code}`);
  await page.locator('#Text2').fill(code);
  await page.locator('#Button2').click();
  await page.waitForTimeout(500);
}

async function submitSearch(page: Page) {
  // Find the search/submit button — could have various labels
  // Try common candidates
  const candidates = [
    'input[type="submit"][value*="Search" i]',
    'input[type="button"][value*="Search" i]',
    'button:has-text("Search")',
    'input[type="submit"]:not([name*="reset"])',
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel);
    if ((await loc.count()) > 0) {
      console.log(`  submitting via ${sel}`);
      await loc.first().click();
      await page.waitForTimeout(2000);
      try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
      await page.waitForTimeout(2000);
      return true;
    }
  }
  return false;
}

async function scrapeResults(page: Page): Promise<Firm[]> {
  // Results table is likely an HTML table. Find it.
  return await page.evaluate(() => {
    const firms: any[] = [];
    // Find the largest table on the page (results table)
    const tables = Array.from(document.querySelectorAll('table'));
    let best: HTMLTableElement | null = null;
    let bestRows = 0;
    for (const t of tables) {
      const rows = t.querySelectorAll('tr').length;
      if (rows > bestRows) { bestRows = rows; best = t as HTMLTableElement; }
    }
    if (!best) return firms;
    // Determine header
    const headerRow = best.querySelector('tr');
    const headerCells = headerRow ? Array.from(headerRow.querySelectorAll('th, td')).map((c) => (c.textContent || '').trim()) : [];
    // Data rows
    const trs = Array.from(best.querySelectorAll('tr')).slice(1);
    for (const tr of trs) {
      const cells = Array.from(tr.querySelectorAll('td')).map((c) => (c.textContent || '').replace(/\s+/g, ' ').trim());
      if (cells.length < 2) continue;
      const firmName = cells[0];
      if (!firmName || firmName.toLowerCase().includes('no records') || firmName.toLowerCase().includes('search criteria')) continue;
      firms.push({
        company: firmName,
        raw: cells,
        _headers: headerCells,
      });
    }
    return firms;
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const headed = process.argv.includes('--headed');
  const browser = await chromium.launch({ headless: !headed });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1600, height: 1200 },
  });
  const page = await ctx.newPage();

  const allFirms = new Map<string, Firm>();

  for (const code of TARGET_CODES) {
    console.log(`\n=== Work code ${code} ===`);
    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
    await page.waitForTimeout(4000);

    await addCode(page, code);
    await page.screenshot({ path: `${OUT_DIR}/code_${code}_added.png`, fullPage: true });

    const submitted = await submitSearch(page);
    if (!submitted) {
      console.error(`  could not find submit button`);
      continue;
    }

    await page.screenshot({ path: `${OUT_DIR}/code_${code}_results.png`, fullPage: true });
    await writeFile(`${OUT_DIR}/code_${code}_results.html`, await page.content());

    const firms = await scrapeResults(page);
    console.log(`  Found ${firms.length} firms`);
    for (const f of firms.slice(0, 5)) console.log(`    - ${f.company} (raw cells: ${f.raw?.length})`);

    for (const f of firms) {
      f.workCode = `000${code}`;
      const key = f.company.toUpperCase().trim();
      if (!allFirms.has(key)) {
        allFirms.set(key, f);
      } else {
        // Merge work codes if duplicate
        const existing = allFirms.get(key)!;
        existing.workCode = `${existing.workCode}; 000${code}`;
      }
    }
  }

  const firms = Array.from(allFirms.values());
  console.log(`\n=== Total unique firms: ${firms.length} ===`);

  await writeFile(`${OUT_DIR}/firms.json`, JSON.stringify(firms, null, 2));

  // CSV — use raw cells with whatever headers we got
  if (firms.length > 0) {
    const maxCols = Math.max(...firms.map((f) => (f.raw?.length || 0)));
    const headers = ['Company', 'WorkCode', ...Array.from({ length: maxCols - 1 }, (_, i) => `Col${i + 2}`)];
    const csvLines = [headers.join(',')];
    for (const f of firms) {
      const raw = f.raw || [];
      const cols = [f.company, f.workCode, ...raw.slice(1, maxCols)];
      csvLines.push(cols.map((v) => {
        const s = String(v ?? '');
        return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(','));
    }
    await writeFile(`${OUT_DIR}/firms.csv`, csvLines.join('\n'));
  }

  console.log(`\nOutput:`);
  console.log(`  ${OUT_DIR}/firms.json (${firms.length} firms)`);
  console.log(`  ${OUT_DIR}/firms.csv`);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
