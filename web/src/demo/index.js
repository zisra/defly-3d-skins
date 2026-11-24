import './demo.css';
import { World } from './world.js';
import { loadFleet, setStyle } from './fleet.js';
import { Show, STEP, END } from './show.js';
import { CameraRig } from './camera.js';
import { Trails, Tracers, Particles } from './fx.js';
import { DemoAudio } from './audio.js';
import { DemoUI } from './ui.js';

// The flight demo: press Demo, watch the show, Esc to leave.
//   startDemo({ viewer, skins, seek, still, onExit })
// seek: start at this show time (testing); still: freeze there (screenshots).

const store = {
  get(k) { try { return localStorage.getItem(`skin-hangar-demo-${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`skin-hangar-demo-${k}`, v); } catch { /* private mode */ } },
};

export async function startDemo({ viewer, skins, seek = 0, still = false, onExit }) {
  const lowPower = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 500;
  const quality = lowPower ? 'low' : 'high';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let muted = store.get('muted') === '1';
  let closed = false, paused = false, loop = null, onResize = () => {};

  const audio = new DemoAudio({ muted }); // created inside the click, so it may play
  const ui = new DemoUI({
    muted,
    onClose: () => exit(),
    onMute: () => setMuted(!muted),
    onReplay: () => { exit({ keepViewerPaused: true }); startDemo({ viewer, skins, onExit }); },
  });
  document.body.classList.add('demo-on');
  viewer.pause();

  function setMuted(m) {
    muted = m;
    store.set('muted', m ? '1' : '0');
    audio.setMuted(m);
    ui.setMuted(m);
  }
  function setPaused(p) {
    paused = p;
    ui.paused(p);
    audio.setPaused(p);
  }
  const onKey = (e) => {
    if (e.key === 'Escape') exit();
    else if (e.key === ' ' && show) { e.preventDefault(); if (!show.finished) setPaused(!paused); }
    else if (e.key === 'm' || e.key === 'M') setMuted(!muted);
  };
  window.addEventListener('keydown', onKey);

  let world = null, show = null;
  function exit({ keepViewerPaused = false } = {}) {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    if (world) {
      world.renderer.setAnimationLoop(null);
      // the fleet is kept (cached) for a replay; only the stage is disposed
      for (const c of fleet ?? []) world.scene.remove(c.root);
      world.dispose();
    }
    audio.close();
    ui.remove();
    if (!keepViewerPaused) {
      document.body.classList.remove('demo-on');
      viewer.resume();
      onExit?.();
    }
    window.__demoReady = false;
  }

  // ---- loading: build every model before anything moves
  let fleet = null;
  fleet = await loadFleet(skins, {
    onSource: (c, i, n) => ui.icon(i, c.icon, n),
    onBuilt: (c, i, n) => ui.built(i, n),
  });
  if (closed) return;

  world = new World(ui.canvas, { quality });
  const rig = new CameraRig();
  const fx = {
    trails: new Trails(world.scene, fleet.length, { life: quality === 'high' ? 2.8 : 1.8 }),
    tracers: new Tracers(world.scene),
    sparks: new Particles(world.scene, quality === 'high' ? 700 : 300),
    puffs: new Particles(world.scene, 90, { additive: false, soft: true }),
  };
  show = new Show({ fleet, world, fx, audio, quality });

  onResize = () => {
    const w = ui.canvas.clientWidth || innerWidth, h = ui.canvas.clientHeight || innerHeight;
    world.resize(w, h);
    rig.setAspect(w / h);
  };
  window.addEventListener('resize', onResize);
  onResize();

  // ---- compile every shader now (both styles), so nothing stalls mid-show
  const warm = async () => {
    fleet.forEach((c) => { c.root.visible = true; });
    show.frame(0, 1, rig, { width: 2, height: 2, reduced });
    await world.renderer.compileAsync(world.scene, rig.camera);
    fleet.forEach((c) => setStyle(c, 'sprite'));
    await world.renderer.compileAsync(world.scene, rig.camera);
    fleet.forEach((c) => setStyle(c, quality === 'high' ? 'glossy' : 'matte'));
    fleet.forEach((c) => { c.root.visible = false; });
  };
  await warm().catch((e) => console.warn('shader warm-up', e));
  if (closed) return;

  // ---- jump ahead (testing): run the simulation silently
  if (seek > 0) {
    audio.enabled = false;
    while (show.T < Math.min(seek, END) - 1e-9) show.step();
    audio.enabled = true;
  }
  audio.restart(show.T);
  ui.start(fleet.length);

  // ---- the clock: fixed simulation steps, frames interpolate between them
  let acc = 0, last = performance.now(), slow = 0, slowFor = 0, frames = 0;
  loop = (now) => {
    const raw = Math.max(0, (now - last) / 1000);
    last = now;
    const dt = Math.min(raw, 0.1);
    frames++;
    if (!paused && !still && show.T < END) {
      acc += dt;
      let k = 0;
      while (acc >= STEP && k < 8) { show.step(); acc -= STEP; k++; }
      if (k === 8) acc = 0;
    }
    const alpha = still || paused || show.T >= END ? 1 : Math.min(1, acc / STEP);
    const Tr = show.T - STEP * (1 - alpha);
    const w = ui.canvas.clientWidth, h = ui.canvas.clientHeight;
    const cap = show.frame(Math.max(0, Tr), alpha, rig, { width: w, height: h, reduced });
    show.finished = cap.done;
    if (!paused && !still) audio.music(show.T); else audio.restart(show.T);
    ui.update(cap);
    world.render(rig.camera);

    // a device that can't keep up drops to the light settings
    if (frames > 120 && world.quality === 'high' && !still) {
      slow = slow * 0.95 + raw * 0.05;
      slowFor = slow > 0.028 ? slowFor + raw : 0;
      if (slowFor > 2) world.degrade();
    }
    if (frames === 3) window.__demoReady = true;
  };
  audio.resume();
  world.renderer.setAnimationLoop(loop);
  window.__demo = { world, show, rig }; // for debugging in the console
  // testing: freeze at a later show time (forward only)
  window.__demoSeek = (t) => new Promise((resolve) => {
    still = true;
    audio.enabled = false;
    while (show.T < Math.min(t, END) - 1e-9) show.step();
    audio.enabled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(show.T)));
  });
  return { exit };
}
