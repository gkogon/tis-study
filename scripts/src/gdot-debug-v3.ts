/**
 * GDOT OBIEE recon v3: dump everything when popup is open to find OK button
 * + try alternative click strategies (LABEL element, force click, keyboard).
 */
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
  await page.waitForTimeout(8000);

  console.log('=== Phase 1: enumerate all visible buttons by text ===');
  const allBtns = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('a, button, input, [role="button"]'));
    return els
      .map((el) => {
        const he = el as HTMLElement;
        const r = he.getBoundingClientRect();
        const text = ((he.textContent || (he as HTMLInputElement).value || he.getAttribute('title') || '') as string)
          .replace(/\s+/g, ' ').trim();
        return {
          tag: he.tagName,
          text: text.slice(0, 60),
          id: he.id,
          name: (he as HTMLInputElement).name || '',
          cls: he.className.slice(0, 60),
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          visible: r.width > 0 && r.height > 0,
        };
      })
      .filter((b) => b.text && b.text.length < 40);
  });
  const apply = allBtns.filter((b) => /apply/i.test(b.text) || b.name === 'gobtn' || /apply/i.test(b.id));
  console.log(`Apply candidates (${apply.length}):`);
  for (const b of apply) console.log(`  <${b.tag} id="${b.id}" name="${b.name}" cls="${b.cls}" @(${b.x},${b.y}) ${b.w}px vis=${b.visible}> "${b.text}"`);

  console.log('\n=== Phase 2: open Category dropdown ===');
  await page.locator('text=Area Class Category').locator('xpath=ancestor::tr[1]').locator('.promptDropDownButton').first().click();
  await page.waitForTimeout(2000);

  // Capture full popup HTML — find which element became visible
  const popupCapture = await page.evaluate(() => {
    // The popup typically appears as a fixed/absolute positioned div near the click
    const allDivs = Array.from(document.querySelectorAll('div'));
    const popups = allDivs.filter((d) => {
      const he = d as HTMLElement;
      const s = window.getComputedStyle(he);
      if (s.position !== 'absolute' && s.position !== 'fixed') return false;
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      const r = he.getBoundingClientRect();
      if (r.width < 100 || r.width > 500 || r.height < 50) return false;
      const text = (he.textContent || '').slice(0, 200);
      if (!/Transporation Planning|Highway Design/.test(text)) return false;
      return true;
    });
    return popups.map((p) => ({
      class: (p as HTMLElement).className,
      id: (p as HTMLElement).id,
      html: (p as HTMLElement).outerHTML.slice(0, 5000),
    }));
  });
  console.log(`Open popups containing options: ${popupCapture.length}`);
  await writeFile(`${OUT}/dbgv3_popup.json`, JSON.stringify(popupCapture, null, 2));
  if (popupCapture.length > 0) {
    console.log(`  popup[0] class=${popupCapture[0].class.slice(0, 80)}`);
    console.log(`  popup[0] id=${popupCapture[0].id}`);
  }

  // Look for OK / Done buttons inside the popup specifically
  const popupBtns = await page.evaluate(() => {
    const popups = Array.from(document.querySelectorAll('div')).filter((d) => {
      const he = d as HTMLElement;
      const s = window.getComputedStyle(he);
      if (s.position !== 'absolute' && s.position !== 'fixed') return false;
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      const r = he.getBoundingClientRect();
      return r.width >= 100 && r.width < 500 && r.height >= 50;
    });
    const btns: any[] = [];
    for (const p of popups) {
      const inner = p.querySelectorAll('a, button, input');
      for (const b of Array.from(inner)) {
        const he = b as HTMLElement;
        const text = (he.textContent || (he as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim();
        if (text.length > 30) continue;
        btns.push({ tag: he.tagName, text, id: he.id, cls: he.className.slice(0, 60) });
      }
    }
    return btns;
  });
  console.log(`Buttons inside popup (${popupBtns.length}):`);
  for (const b of popupBtns.slice(0, 30)) console.log(`  <${b.tag} id="${b.id}" cls="${b.cls}">${b.text}</${b.tag}>`);

  await page.screenshot({ path: `${OUT}/dbgv3.png`, fullPage: true });
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
