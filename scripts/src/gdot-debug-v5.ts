/**
 * GDOT full-flow recon: load → open dropdown → inspect popup deeply → find OK button.
 * All in one run with 10s+ waits.
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const URL =
  'https://gdotbiext.dot.ga.gov/ext-bi/saw.dll?Dashboard&PortalPath=%2Fshared%2FExternal%2F_portal%2FCMIS%20Prequalified%20Consultants%20by%20Area%20Class&Action=Navigate&Syndicate=true&anon=1';
const OUT = '/tmp/gdot_recon';

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1600, height: 1200 },
  });
  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  try { await page.waitForLoadState('networkidle', { timeout: 30000 }); } catch {}
  await page.waitForTimeout(12000);

  // Enumerate ALL clickable elements including icons/images
  console.log('=== Phase 1: enumerate ALL clickable ===');
  const clickables = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('a, button, input, [role="button"], [onclick], img[alt]'));
    return els
      .map((el) => {
        const he = el as HTMLElement;
        const r = he.getBoundingClientRect();
        const text = (he.textContent || (he as HTMLInputElement).value || he.getAttribute('alt') || he.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
        return {
          tag: he.tagName,
          text: text.slice(0, 60),
          id: he.id,
          name: (he as HTMLInputElement).name || '',
          cls: he.className.slice(0, 50),
          onclick: !!he.getAttribute('onclick'),
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
        };
      })
      .filter((b) => b.text && b.w > 0);
  });
  const applyCandidates = clickables.filter((b) =>
    /^(apply|reset|ok|done|go)$/i.test(b.text) ||
    /apply|reset|gobtn/i.test(b.id) ||
    /apply|reset|gobtn/i.test(b.name) ||
    b.name === 'gobtn'
  );
  console.log(`Apply/Reset/OK candidates (${applyCandidates.length}):`);
  for (const b of applyCandidates) console.log(`  <${b.tag} id="${b.id}" name="${b.name}" cls="${b.cls}" @(${b.x},${b.y}) ${b.w}px> "${b.text}"`);

  console.log('\n=== Phase 2: open Category dropdown ===');
  await page.locator('text=Area Class Category').locator('xpath=ancestor::tr[1]').locator('.promptDropDownButton').first().click();
  await page.waitForTimeout(2500);

  // Now enumerate clickables AGAIN — see what new things appeared (popup contents)
  const afterClick = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('a, button, input, [role="button"]'));
    return els
      .map((el) => {
        const he = el as HTMLElement;
        const r = he.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return null;
        const text = (he.textContent || (he as HTMLInputElement).value || he.getAttribute('alt') || he.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
        return {
          tag: he.tagName,
          text: text.slice(0, 60),
          id: he.id,
          name: (he as HTMLInputElement).name || '',
          cls: he.className.slice(0, 50),
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
        };
      })
      .filter((b: any) => b && b.text && b.w > 0);
  });
  const newButtons = afterClick.filter((b: any) =>
    /^(ok|done|apply|cancel|clear|all|none)$/i.test(b.text) ||
    /ok|done|apply|cancel/i.test(b.id) ||
    /idApplyBtn|idOKBtn|GoBtn/i.test(b.id)
  );
  console.log(`After-popup OK/Done/Apply candidates (${newButtons.length}):`);
  for (const b of newButtons.slice(0, 20)) console.log(`  <${b.tag} id="${b.id}" name="${b.name}" cls="${b.cls}" @(${b.x},${b.y})> "${b.text}"`);

  // Also list all checkboxRadioButtonLabel elements that are visible
  const checkboxLabels = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('label.checkboxRadioButtonLabel'));
    return els
      .filter((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el) => {
        const he = el as HTMLLabelElement;
        const r = he.getBoundingClientRect();
        return {
          text: (he.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          forAttr: he.htmlFor,
          x: Math.round(r.x),
          y: Math.round(r.y),
        };
      });
  });
  console.log(`\nVisible checkbox labels (${checkboxLabels.length}):`);
  for (const l of checkboxLabels.slice(0, 12)) console.log(`  for="${l.forAttr}" @(${l.x},${l.y}): "${l.text}"`);

  await page.screenshot({ path: `${OUT}/dbgv5.png`, fullPage: true });
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
