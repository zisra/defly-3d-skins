// Runs the whole flight demo simulation and reports any two craft whose
// bounding ellipsoids come closer than 1.25 (touching is < 1), the lowest any
// craft gets, tracer shots and hits, and the time per simulation step.
//   node scripts/demo-sim-check.mjs   (with the dev server on :5173)
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://localhost:5173/?demo&still', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 180000 });
const r = await page.evaluate(() => {
  const { show } = window.__demo;
  const F = show.fleet;
  const worst = []; let minFloor = Infinity, minFloorAt = null, fired = 0, hits = 0, stepMs = 0, steps = 0;
  const origFire = show.fx.tracers.fire.bind(show.fx.tracers);
  show.fx.tracers.fire = (...a) => { fired++; return origFire(...a); };
  const hitOrig = F.map((c) => c.flyer.hit.bind(c.flyer));
  F.forEach((c, i) => { c.flyer.hit = () => { hits++; hitOrig[i](); }; });
  while (show.T < 128) {
    const t0 = performance.now(); show.step(); stepMs += performance.now() - t0; steps++;
    for (let a = 0; a < F.length; a++) {
      const A = F[a];
      if (A.state !== 'flying') continue;
      const bottom = A.curPos.y - A.halfHeight;
      if (bottom < minFloor) { minFloor = bottom; minFloorAt = [show.T.toFixed(2), A.no]; }
      for (let b = a + 1; b < F.length; b++) {
        const B = F[b];
        if (B.state === 'hidden') continue;
        // overlap of the craft's bounding ellipsoids (width across, height up): < 1 touches
        const d = A.curPos.clone().sub(B.curPos), R = A.flyer.radius + B.flyer.radius, H = A.halfHeight + B.halfHeight;
        const sp = Math.sqrt((d.x * d.x + d.z * d.z) / (R * R) + (d.y * d.y) / (H * H));
        if (sp < 1.25) worst.push([+show.T.toFixed(2), A.no, B.no, +sp.toFixed(2)]);
      }
    }
  }
  // collapse consecutive reports per pair
  const byPair = new Map();
  for (const w of worst) { const k = `${w[1]}-${w[2]}`; const e = byPair.get(k); if (!e) byPair.set(k, { from: w[0], to: w[0], min: w[3] }); else { e.to = w[0]; e.min = Math.min(e.min, w[3]); } }
  return { overlaps: [...byPair.entries()].map(([k, e]) => `${k} @${e.from}-${e.to} min ${e.min}`), minFloor: +minFloor.toFixed(2), minFloorAt, fired, hits, msPerStep: +(stepMs / steps).toFixed(3) };
});
console.log(JSON.stringify(r, null, 1));
if (errs.length) console.log('ERRORS', errs);
await browser.close();
