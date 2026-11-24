// Frames of the flight demo at given show times, from one page load.
//   node scripts/demo-shots.mjs <baseUrl> <outDir> <w>x<h> t1 t2 ...
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:5173/', outDir = 'shots', size = '1280x720', ...times] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
// a portrait size is treated as a phone (touch, so the demo picks its light settings)
const phone = height > width;
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(`[error] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(`${base}?demo&still`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 180000 });
console.log(`ready after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const t of times.map(Number).sort((a, b) => a - b)) {
  const at = await page.evaluate((x) => window.__demoSeek(x), t);
  await page.waitForTimeout(250);
  const file = `${outDir}/t${String(t.toFixed(1)).padStart(5, '0')}.png`;
  await page.screenshot({ path: file });
  console.log('saved', file, 'T =', at.toFixed(2));
}
if (errors.length) console.log(errors.join('\n'));
await browser.close();
