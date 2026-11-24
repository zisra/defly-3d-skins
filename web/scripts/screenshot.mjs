// Headless screenshots of the viewer, for checking models without a browser.
//   node scripts/screenshot.mjs <baseUrl> <outDir> "skin=1" "skin=15&view=top" ...
// Each query gets &still so rotors and turntable are frozen.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5173/', outDir = 'shots', ...queries] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

for (const q of queries.length ? queries : ['skin=1', 'skin=15']) {
  await page.goto(`${base}?${q}&still`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
  await page.waitForTimeout(q.includes('view=top') ? 1500 : 600);
  const file = `${outDir}/${q.replace(/[^a-z0-9]+/gi, '_')}.png`;
  await page.screenshot({ path: file });
  console.log('saved', file);
}
if (errors.length) console.log(errors.join('\n'));
await browser.close();
