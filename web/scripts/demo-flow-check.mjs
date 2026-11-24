//   node scripts/demo-flow-check.mjs <screenshotDir>   (with the dev server on :5173)
// The visitor's path: open the viewer, press Demo, watch with sound, Esc out,
// check the viewer is intact, come back (cached fleet), jump to the end, Replay.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
const D = process.argv[2] ?? '.'; // where to save screenshots
await page.goto('http://localhost:5173/?skin=19&colour=red&style=sprite', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ready === true);
const before = await page.evaluate(() => ({ name: document.querySelector('#skin-name').textContent, title: document.title }));
let t0 = Date.now();
await page.click('#demo');
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 180000 });
console.log('first start (build) s:', ((Date.now() - t0) / 1000).toFixed(1));
const st = await page.evaluate(() => ({ audio: window.__demo.show.audio.ctx?.state, live: window.__demo.show.audio.live }));
console.log('audio', JSON.stringify(st));
// real-time playback for a while; measure per-frame JS cost of show.frame
await page.evaluate(() => {
  const s = window.__demo.show, f = s.frame.bind(s);
  window.__fr = { n: 0, ms: 0 };
  s.frame = (...a) => { const t = performance.now(); const r = f(...a); window.__fr.ms += performance.now() - t; window.__fr.n++; return r; };
});
await page.waitForTimeout(6000);
const fr = await page.evaluate(() => ({ T: window.__demo.show.T, frames: window.__fr.n, msPerFrame: +(window.__fr.ms / window.__fr.n).toFixed(2) }));
console.log('playback', JSON.stringify(fr));
await page.keyboard.press(' ');
await page.waitForTimeout(500);
const p1 = await page.evaluate(() => window.__demo.show.T);
await page.waitForTimeout(800);
const p2 = await page.evaluate(() => window.__demo.show.T);
console.log('paused holds time:', p1 === p2, p1.toFixed(2));
await page.screenshot({ path: `${D}/flow_paused.png` });
await page.keyboard.press(' ');
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
const after = await page.evaluate(() => ({
  name: document.querySelector('#skin-name').textContent, title: document.title,
  demoOn: document.body.classList.contains('demo-on'), overlay: !!document.querySelector('.demo'),
  hudVisible: getComputedStyle(document.querySelector('.hud')).visibility,
}));
console.log('after exit', JSON.stringify(after), 'same skin:', after.name === before.name);
await page.screenshot({ path: `${D}/flow_viewer_after.png` });
// second start: cached fleet
t0 = Date.now();
await page.keyboard.press('d');
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 180000 });
console.log('second start s:', ((Date.now() - t0) / 1000).toFixed(1));
await page.evaluate(() => window.__demoSeek(128));
await page.waitForTimeout(1200);
await page.screenshot({ path: `${D}/flow_end.png` });
const endVisible = await page.evaluate(() => !document.querySelector('.demo-end').hidden);
console.log('end card visible:', endVisible);
await page.click('.demo-end .replay');
await page.waitForFunction(() => window.__demoReady === true && window.__demo.show.T < 1, null, { timeout: 180000 });
await page.waitForTimeout(1500);
console.log('replay running, T =', (await page.evaluate(() => window.__demo.show.T)).toFixed(2));
await page.click('.demo .close');
await page.waitForTimeout(500);
console.log('closed:', await page.evaluate(() => !document.querySelector('.demo') && !document.body.classList.contains('demo-on')));
console.log(errs.length ? errs.join('\n') : 'no errors');
await browser.close();
