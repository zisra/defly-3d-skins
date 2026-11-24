import * as THREE from 'three';
import { createStyles, applyStyle } from '../styles.js';
import { SkinSvg } from '../geometry/svg.js';
import { TEAM_COLORS } from '../palette.js';
import { spriteUrl } from '../sprites.js';
import { Flyer } from './flight.js';

// The demo's fleet: every skin built once per visit, each with its own
// material set (createStyles) so each craft carries its own team colour.

let cache = null;
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// Builds (or returns the cached) fleet. `onSource` fires once a skin's art is
// loaded (for the loading card's icons), `onBuilt` after each model is built.
export async function loadFleet(skins, { onSource, onBuilt } = {}) {
  const list = skins.filter((s) => s.recipe);
  if (cache) {
    cache.forEach((c, i) => { onSource?.(c, i, list.length); onBuilt?.(c, i, list.length); });
    return cache;
  }
  // load everything first (fast), so the icons appear at once
  const loaded = await Promise.all(list.map(async (skin, i) => {
    const recipe = (await skin.recipe()).default;
    const source = recipe.load ? await recipe.load(skin) : await SkinSvg.load(skin.svg, recipe.pivot);
    const c = { i, skin, recipe, source, colourIndex: i % TEAM_COLORS.length };
    c.colour = TEAM_COLORS[c.colourIndex];
    c.icon = spriteUrl(source, c.colour, { mapping: 'trim' });
    onSource?.(c, i, list.length);
    return c;
  }));
  const fleet = [];
  for (const c of loaded) {
    await nextFrame(); // let the progress paint between (blocking) builds
    const styles = createStyles();
    styles.setTint(c.colour);
    const model = c.recipe.build({ svg: c.source, mats: styles.sets.glossy });
    const craft = makeCraft({ ...c, styles, model });
    craft.sprite = await spriteTexture(craft);
    fleet.push(craft);
    onBuilt?.(craft, c.i, list.length);
  }
  cache = fleet;
  return fleet;
}

// The model's framing box, ignoring effects bigger than the craft (glows).
function frameBox(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3();
  object.traverse((o) => {
    if (o.isMesh && !o.userData.noFrame) box.union(new THREE.Box3().setFromObject(o, true));
  });
  if (box.isEmpty()) box.setFromObject(object);
  return box;
}

function makeCraft({ i, skin, source, styles, model, colourIndex, colour, icon }) {
  const inner = model.object;
  const box = frameBox(inner);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  // root (flies) > holder (centres the model's box on the root) > model
  const holder = new THREE.Group();
  holder.position.copy(center).negate();
  holder.add(inner);
  const root = new THREE.Group();
  root.add(holder);
  root.updateMatrixWorld(true);

  const muzzles = [];
  inner.traverse((o) => { if (o.userData.muzzle) muzzles.push(o.getWorldPosition(new THREE.Vector3())); });
  if (!muzzles.length) muzzles.push(new THREE.Vector3(size.x / 2, 0, 0));

  const rest = [];
  inner.traverse((o) => rest.push([o, o.rotation.x, o.rotation.y, o.rotation.z]));
  const vb = source.viewBox;
  const flyer = new Flyer(Math.max(size.x, size.z) / 2);
  return {
    i, no: skin.no, name: skin.name, source, styles, model, root, holder, size, center, icon,
    colourIndex, colour, rest, muzzles, flyer,
    halfHeight: size.y / 2,
    minX: box.min.x - center.x,
    maxX: box.max.x - center.x,
    // where the flat sprite lies, relative to the root (x, z) and its size
    footprint: { x: vb.x + vb.w / 2 - center.x, z: vb.y + vb.h / 2 - center.z, w: vb.w, h: vb.h },
    spinning: false,
    park: null,
  };
}

// The sprite in the craft's own team colour, as a texture covering its viewBox.
async function spriteTexture(craft) {
  const img = new Image();
  img.src = craft.icon;
  await img.decode();
  const { w, h } = craft.footprint;
  const s = 900 / Math.max(w, h);
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function setStyle(craft, id) {
  applyStyle(craft.model.object, craft.styles.sets[id]);
}

// Every material on the craft right now.
export function craftMaterials(craft) {
  const set = new Set();
  craft.model.object.traverse((o) => { if (o.isMesh) [].concat(o.material).forEach((m) => set.add(m)); });
  return [...set];
}

// ---------------------------------------------------------------------------
// Rise: while a scan beam sweeps a pad (along +x), the craft appears behind
// the beam (parts ahead of it aren't drawn; the flat sprite still shows there)
// and swells up out of the floor as a whole, from flat to full height (uRiseK).
// Injected into every material of the craft; `uniforms` are shared by all.
export function riseUniforms() {
  return { uRiseOn: { value: 0 }, uBeamX: { value: -1e9 }, uRiseK: { value: 1 }, uRiseFloor: { value: 0 } };
}

export function patchRise(material, U) {
  if (material.userData.rise) return;
  material.userData.rise = true;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey.bind(material);
  const prevKeyValue = prevKey();
  material.onBeforeCompile = (sh, renderer) => {
    prev.call(material, sh, renderer);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'uniform float uRiseOn, uRiseK, uRiseFloor;\nvarying float vRiseX;\n' + sh.vertexShader.replace('#include <project_vertex>', `
  vec4 riseW = modelMatrix * vec4( transformed, 1.0 );
  vRiseX = riseW.x;
  if ( uRiseOn > 0.5 ) riseW.y = uRiseFloor + ( riseW.y - uRiseFloor ) * uRiseK;
  vec4 mvPosition = viewMatrix * riseW;
  gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = 'uniform float uRiseOn, uBeamX;\nvarying float vRiseX;\n' + sh.fragmentShader.replace('void main() {',
      'void main() {\n  if ( uRiseOn > 0.5 && vRiseX > uBeamX ) discard;');
  };
  material.customProgramCacheKey = () => `${prevKeyValue}|rise`;
  material.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Parking: spin the rotors down so they come to rest exactly at their built
// angle (which is how the sprite draws them). Works on any model: whatever
// the model's own update() turned is eased back to its rest angle, carrying on
// in the direction it was turning.
export function startPark(craft, dt, t) {
  const before = craft.rest.map(([o]) => [o.rotation.x, o.rotation.y, o.rotation.z]);
  craft.model.update(dt, t, { spin: craft.spinning });
  const D = 2.6;
  craft.park = { t: 0, D, list: [] };
  craft.rest.forEach(([o, ...restAngles], k) => {
    ['x', 'y', 'z'].forEach((ax, a) => {
      const now = o.rotation[ax], rest = restAngles[a];
      const v = (now - before[k][a]) / dt;
      if (Math.abs(now - rest) < 1e-7 && Math.abs(v) < 1e-7) return;
      const turns = Math.round((now + v * D / 2 - rest) / (2 * Math.PI));
      craft.park.list.push({ o, ax, from: now, v, to: rest + turns * 2 * Math.PI });
    });
  });
}

export function stepPark(craft, dt) {
  const p = craft.park;
  p.t = Math.min(p.D, p.t + dt);
  const s = p.t / p.D;
  const h00 = 2 * s ** 3 - 3 * s * s + 1, h10 = s ** 3 - 2 * s * s + s, h01 = -2 * s ** 3 + 3 * s * s;
  for (const q of p.list) q.o.rotation[q.ax] = h00 * q.from + h10 * p.D * q.v + h01 * q.to;
}
