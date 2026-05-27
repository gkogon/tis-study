/**
 * Scrape GDOT CMIS Prequalified Consultants dashboard for firms prequalified
 * in traffic-relevant Area Classes (1.10, 1.11, 3.06, 3.07).
 *
 * The dashboard uses OBIEE multi-select checkbox dropdowns. Strategy:
 *  1. Open Category dropdown, set state {Transporation Planning, Highway Design Roadway} = on
 *  2. Open Number dropdown, set state for the 4 traffic classes = on
 *  3. Click Apply, scrape resulting table.
 *
 * Run: pnpm exec tsx src/fetch-gdot-prequalified.ts [--headed]
 *
 * NOTE: GDOT misspells "Transportation" as "Transporation" — don't fix it.
 */
import { chromium, type Page } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const URL =
  'https://gdotbiext.dot.ga.gov/ext-bi/saw.dll?Dashboard&PortalPath=%2Fshared%2FExternal%2F_portal%2FCMIS%20Prequalified%20Consultants%20by%20Area%20Class&Action=Navigate&Syndicate=true&anon=1';
const OUT_DIR = '/tmp/gdot_prequal';

// Match by NUMERIC PREFIX. Regex extracts "1" from "1. Transporation Planning" and "1.10" from
// "1.10 Traffic Studies". Don't include the dot for categories.
const TARGET_CATEGORY_PREFIXES = ['1', '3']; // Transporation Planning + Highway Design Roadway
const TARGET_NUMBER_PREFIXES = ['1.10', '1.11', '3.06', '3.07'];

interface Firm {
  company: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  dispositionDate: string;
  expirationDate: string;
  dbeCertNumber: string;
  dbeCertDate: string;
  dbeCertStatus: string;
}

/** Open a dropdown by prompt label substring. Returns the dropdown button locator. */
async function openDropdown(page: Page, labelSubstring: string) {
  const button = page
    .locator(`text=${labelSubstring}`)
    .locator('xpath=ancestor::tr[1]')
    .locator('.promptDropDownButton');
  await button.first().click();
  await page.waitForTimeout(1200);
  return button;
}

/** Close ALL open popup menus by clicking outside (use page coordinates known to be popup-free). */
async function closeAllPopups(page: Page) {
  // Click the dashboard title which is outside any popup
  try {
    await page.locator('text=CMIS Prequalified Vendor').first().click({ force: true });
  } catch {}
  await page.waitForTimeout(600);
  // Backup: press Escape twice
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

/** Set the checkbox state for each option in the currently-open dropdown.
 *  Matches by NUMBER PREFIX (e.g. "1.10", "3.06") to avoid whitespace inconsistencies. */
async function setDropdownState(page: Page, desiredPrefixes: string[]): Promise<{
  toggled: string[];
  finalChecked: string[];
}> {
  return await page.evaluate((desired) => {
    const toggled: string[] = [];
    const finalChecked: string[] = [];
    const popups = Array.from(document.querySelectorAll('.DropDownValueList'))
      .filter((el) => window.getComputedStyle(el as HTMLElement).display !== 'none');
    if (popups.length === 0) return { toggled: ['[no visible popup]'], finalChecked: [] };
    if (popups.length > 1) toggled.push(`[warning: ${popups.length} visible popups, using last]`);
    const popup = popups[popups.length - 1] as HTMLElement;
    const opts = Array.from(popup.querySelectorAll('.promptMenuOption')) as HTMLElement[];
    for (const opt of opts) {
      const cb = opt.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      if (!cb) continue;
      // Normalize whitespace: collapse multiple spaces, trim
      const rawLabel = (cb.value || opt.title || opt.textContent || '').trim();
      const normLabel = rawLabel.replace(/\s+/g, ' ');
      // Extract numeric prefix (e.g. "1.", "1.10", "3.07")
      const m = normLabel.match(/^(\d+(?:\.\d+)?)/);
      const prefix = m ? m[1] : '';
      // Match: prefix must equal one of desired (exact, not includes — "1." should not match "1.10")
      const shouldBeOn = desired.some((d) => prefix === d);
      const isOn = cb.checked;
      if (shouldBeOn !== isOn) {
        opt.click();
        toggled.push(`${shouldBeOn ? '+' : '-'} ${normLabel}`);
      }
      if (shouldBeOn) finalChecked.push(normLabel);
    }
    return { toggled, finalChecked };
  }, desiredPrefixes);
}

async function clickApply(page: Page) {
  await closeAllPopups(page);
  // Apply button: <input type="button" id="gobtn" value="Apply" class="promptApplyButton">
  await page.locator('#gobtn').first().click();
  await page.waitForTimeout(2000);
  try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
  await page.waitForTimeout(2000);
}

async function scrapeTable(page: Page): Promise<string[][]> {
  return await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    let best: HTMLTableElement | null = null;
    let bestCount = 0;
    for (const t of tables) {
      const c = t.querySelectorAll('td.mPTDC').length;
      if (c > bestCount) { bestCount = c; best = t as HTMLTableElement; }
    }
    if (!best) return [];
    // Cell IDs: e_saw_<viewID>_9_1_<COL>_<ROW>
    const cells = Array.from(best.querySelectorAll('td.mPTDC[id]')) as HTMLTableCellElement[];
    const matrix = new Map<number, Map<number, string>>();
    for (const cell of cells) {
      const m = cell.id.match(/_(\d+)_(\d+)$/);
      if (!m) continue;
      const col = parseInt(m[1], 10);
      const row = parseInt(m[2], 10);
      // Preserve internal spaces, just collapse whitespace
      const text = (cell.textContent || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
      if (!matrix.has(row)) matrix.set(row, new Map());
      matrix.get(row)!.set(col, text);
    }
    const rowIdxs = Array.from(matrix.keys()).sort((a, b) => a - b);
    const maxCol = Math.max(...Array.from(matrix.values()).flatMap((m) => Array.from(m.keys())));
    return rowIdxs.map((r) => {
      const m = matrix.get(r)!;
      const arr: string[] = [];
      for (let c = 0; c <= maxCol; c++) arr.push(m.get(c) ?? '');
      return arr;
    });
  });
}

async function getFirmCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('td, span, div'));
    for (const e of els) {
      const t = (e.textContent || '').trim();
      const m = t.match(/(\d+)\s+Consultants?\s+prequalified/i);
      if (m) return parseInt(m[1], 10);
    }
    return -1;
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const headed = process.argv.includes('--headed');
  const browser = await chromium.launch({ headless: !headed });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1600, height: 1200 },
  });
  const page = await ctx.newPage();

  console.log(`Loading dashboard...`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
  await page.waitForTimeout(8000);

  console.log(`\n--- Setting Category checkboxes ---`);
  await openDropdown(page, 'Area Class Category');
  const catResult = await setDropdownState(page, TARGET_CATEGORY_PREFIXES);
  console.log(`  Toggled: ${catResult.toggled.length}`);
  for (const t of catResult.toggled) console.log(`    ${t}`);
  console.log(`  Final checked: ${catResult.finalChecked.length}`);
  for (const f of catResult.finalChecked) console.log(`    ✓ ${f}`);
  await closeAllPopups(page);
  // Number options refresh after Category change — wait a bit
  await page.waitForTimeout(2000);

  console.log(`\n--- Setting Number checkboxes ---`);
  await openDropdown(page, 'Area Class Number');
  const numResult = await setDropdownState(page, TARGET_NUMBER_PREFIXES);
  console.log(`  Toggled: ${numResult.toggled.length}`);
  for (const t of numResult.toggled) console.log(`    ${t}`);
  console.log(`  Final checked: ${numResult.finalChecked.length}`);
  for (const f of numResult.finalChecked) console.log(`    ✓ ${f}`);

  console.log(`\n--- Apply ---`);
  await clickApply(page);

  await page.screenshot({ path: `${OUT_DIR}/final.png`, fullPage: true });
  await writeFile(`${OUT_DIR}/final.html`, await page.content());

  const count = await getFirmCount(page);
  console.log(`Dashboard claims: ${count} consultants`);

  const rows = await scrapeTable(page);
  console.log(`Scraped rows: ${rows.length}`);

  // Map to firms
  const firms: Firm[] = [];
  for (const row of rows) {
    const [company, address, city, state, zip, phone, dispositionDate, expirationDate, dbeCertNumber, dbeCertDate, dbeCertStatus] = row;
    if (!company) continue;
    firms.push({ company, address, city, state, zip, phone, dispositionDate, expirationDate, dbeCertNumber, dbeCertDate, dbeCertStatus });
  }

  // Dedupe by company name
  const dedup = new Map<string, Firm>();
  for (const f of firms) {
    const k = f.company.toUpperCase().trim();
    if (!dedup.has(k)) dedup.set(k, f);
  }
  const uniqueFirms = Array.from(dedup.values());

  console.log(`Unique firms: ${uniqueFirms.length} (of ${firms.length} rows)`);

  await writeFile(`${OUT_DIR}/firms.json`, JSON.stringify(uniqueFirms, null, 2));

  // CSV
  const headers = ['Company','Address','City','State','Zip','Phone','Disposition Date','Expiration Date','DBE Cert #','DBE Cert Date','DBE Cert Status'];
  const csvLines = [headers.join(',')];
  for (const f of uniqueFirms) {
    const cols = [f.company, f.address, f.city, f.state, f.zip, f.phone, f.dispositionDate, f.expirationDate, f.dbeCertNumber, f.dbeCertDate, f.dbeCertStatus];
    csvLines.push(cols.map((v) => {
      const s = String(v ?? '');
      return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','));
  }
  await writeFile(`${OUT_DIR}/firms.csv`, csvLines.join('\n'));

  console.log(`\nOutput:`);
  console.log(`  ${OUT_DIR}/firms.json`);
  console.log(`  ${OUT_DIR}/firms.csv`);
  const gaFirms = uniqueFirms.filter((f) => f.state === 'GA');
  console.log(`  GA firms: ${gaFirms.length}`);
  const dbe = uniqueFirms.filter((f) => f.dbeCertStatus);
  console.log(`  DBE-certified: ${dbe.length}`);

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
