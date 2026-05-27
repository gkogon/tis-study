import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const DASHBOARD_URL_AREA_CLASS =
  'https://gdotbiext.dot.ga.gov/ext-bi/saw.dll?Dashboard&PortalPath=%2Fshared%2FExternal%2F_portal%2FCMIS%20Prequalified%20Consultants%20by%20Area%20Class&Action=Navigate&Syndicate=true&anon=1';

const OUT_DIR = '/tmp/gdot_recon';

async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

async function main() {
  await ensureDir(OUT_DIR);
  const headed = process.argv.includes('--headed');
  console.log(`Launching chromium (headed=${headed})...`);
  const browser = await chromium.launch({ headless: !headed });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1600, height: 1000 },
  });
  const page = await ctx.newPage();

  // Log network for debugging
  const requests: { url: string; method: string; status: number }[] = [];
  page.on('response', (r) => {
    requests.push({ url: r.url(), method: r.request().method(), status: r.status() });
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[browser-err] ${msg.text()}`);
  });

  console.log(`Navigating to ${DASHBOARD_URL_AREA_CLASS}`);
  await page.goto(DASHBOARD_URL_AREA_CLASS, { waitUntil: 'domcontentloaded', timeout: 60000 });
  console.log('DOM loaded. Waiting for network idle...');

  try {
    await page.waitForLoadState('networkidle', { timeout: 30000 });
  } catch {
    console.log('  network did not go idle in 30s — continuing');
  }

  // Give OBIEE a moment for any deferred renders
  await page.waitForTimeout(5000);

  console.log(`Final URL: ${page.url()}`);
  console.log(`Title: ${await page.title()}`);

  // Screenshot
  await page.screenshot({ path: `${OUT_DIR}/dashboard.png`, fullPage: true });
  console.log(`Screenshot → ${OUT_DIR}/dashboard.png`);

  // Dump main frame HTML
  const html = await page.content();
  await writeFile(`${OUT_DIR}/dashboard.html`, html);
  console.log(`HTML → ${OUT_DIR}/dashboard.html (${html.length} bytes)`);

  // Dump all iframes
  const frames = page.frames();
  console.log(`Frames: ${frames.length}`);
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    try {
      const content = await f.content();
      await writeFile(`${OUT_DIR}/frame_${i}.html`, content);
      console.log(`  frame[${i}] ${f.url()} → ${content.length} bytes`);
    } catch (e) {
      console.log(`  frame[${i}] ${f.url()} → ERROR: ${(e as Error).message}`);
    }
  }

  // Look for typical OBIEE elements
  const probes = [
    'select',
    'table',
    '[role="combobox"]',
    'a[href*="Dashboard"]',
    'input[type="text"]',
    '.PromptedFilterCaption',
    '.PTRowEdgeFilterCaption',
    '.DashboardPromptsView',
    '[id*="prompt"]',
    '[id*="filter"]',
    '[class*="Prompt"]',
    'button',
  ];
  console.log('\n--- DOM probes ---');
  for (const sel of probes) {
    const count = await page.locator(sel).count();
    if (count > 0) console.log(`  ${sel}: ${count}`);
  }

  // Save request log
  await writeFile(
    `${OUT_DIR}/requests.json`,
    JSON.stringify(requests, null, 2)
  );
  console.log(`\nNetwork log → ${OUT_DIR}/requests.json (${requests.length} requests)`);

  // If headed, keep open
  if (headed) {
    console.log('\nHeaded mode — pausing 60s for manual inspection');
    await page.waitForTimeout(60000);
  }

  await browser.close();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
