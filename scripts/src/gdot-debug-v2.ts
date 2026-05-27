import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';

const URL =
  'https://gdotbiext.dot.ga.gov/ext-bi/saw.dll?Dashboard&PortalPath=%2Fshared%2FExternal%2F_portal%2FCMIS%20Prequalified%20Consultants%20by%20Area%20Class&Action=Navigate&Syndicate=true&anon=1';
const OUT = '/tmp/gdot_recon';

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0',
    viewport: { width: 1600, height: 1200 },
  });
  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
  await page.waitForTimeout(5000);

  // === Diagnostic 1: list all buttons on the page initially ===
  const buttons = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('a, button, input[type="button"], input[type="submit"]'));
    return all
      .map((el) => {
        const he = el as HTMLElement;
        const r = he.getBoundingClientRect();
        return {
          tag: he.tagName,
          text: (he.textContent || (he as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          id: he.id,
          name: (he as HTMLInputElement).name || '',
          cls: he.className.slice(0, 80),
          visible: r.width > 0 && r.height > 0,
          x: Math.round(r.x),
          y: Math.round(r.y),
        };
      })
      .filter((b) => b.visible && (b.text.match(/apply|reset|ok|done|go|submit/i) || b.name === 'gobtn'));
  });
  console.log(`Visible apply-ish buttons: ${buttons.length}`);
  for (const b of buttons.slice(0, 15)) {
    console.log(`  <${b.tag} id="${b.id}" name="${b.name}" class="${b.cls}" @(${b.x},${b.y})> "${b.text}"`);
  }

  // === Diagnostic 2: open Category dropdown and inspect its FULL structure ===
  const catBtn = page.locator('text=Area Class Category').locator('xpath=ancestor::tr[1]').locator('.promptDropDownButton');
  await catBtn.first().click();
  await page.waitForTimeout(1500);

  const popupInfo = await page.evaluate(() => {
    // Find any element with checkboxes visible
    const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"], input[type="radio"]'))
      .filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    const labels = Array.from(document.querySelectorAll('label.checkboxRadioButtonLabel'))
      .filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .slice(0, 15)
      .map((l) => ({
        text: (l.textContent || '').replace(/\s+/g, ' ').trim(),
        forAttr: (l as HTMLLabelElement).htmlFor,
      }));
    // Find all buttons that appeared in the popup
    const popupButtons = Array.from(document.querySelectorAll('a, button, input[type="button"]'))
      .filter((el) => {
        const he = el as HTMLElement;
        const r = he.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const text = (he.textContent || (he as HTMLInputElement).value || '').toLowerCase();
        return /^(ok|done|apply|cancel|clear|reset)$/.test(text.trim()) || text.includes('select all');
      })
      .map((el) => {
        const he = el as HTMLElement;
        return {
          tag: he.tagName,
          text: (he.textContent || (he as HTMLInputElement).value || '').trim(),
          id: he.id,
          cls: he.className.slice(0, 80),
        };
      });
    return {
      checkboxCount: checkboxes.length,
      labels,
      popupButtons,
    };
  });
  console.log(`\nPopup state after Category dropdown click:`);
  console.log(`  visible checkboxes: ${popupInfo.checkboxCount}`);
  console.log(`  visible checkbox labels:`);
  for (const l of popupInfo.labels) console.log(`    - "${l.text}" (for="${l.forAttr}")`);
  console.log(`  popup buttons (OK/Done/Apply etc):`);
  for (const b of popupInfo.popupButtons) console.log(`    <${b.tag} id="${b.id}" class="${b.cls}">${b.text}</${b.tag}>`);

  await page.screenshot({ path: `${OUT}/dbgv2_cat_open.png`, fullPage: true });
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
