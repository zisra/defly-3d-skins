import * as THREE from 'three';
import { inflate, shellPart, pillow, softCap, Heightfield, signedArea } from '../geometry/inflate.js';
import { traceShapes } from '../geometry/trace.js';
import { mesh } from '../geometry/shapes.js';
import { principalFrame } from './auto.js';
import { addMuzzle } from './kit.js';

// ---------------------------------------------------------------------------
// Skins made of PNG layers (the game's skin file format).
//
// A skin file is JSON: { spec: { base, notint, rotors: [...], size }, images }.
// The game draws: base (tinted by the team colour), notint (as is), and each
// rotor image at (x, y) with its size, inserted at its `layer` in that stack,
// spinning at `speed` degrees per frame; `visibility` '1' = only while moving,
// '2' = only while idle.
//
// The 3D build keeps all of that and turns each layer into geometry:
//   - every opaque area of a layer is traced and inflated into a smooth part
//     (flat art: panels between its drawn lines bulge separately; grey
//     mechanical art: rigid, flat-topped parts), with the layer image itself
//     projected onto it from above. The Top view is the sprite, pixel for pixel,
//     and tinting works as in the game (image × team colour).
//   - see-through layers (glows, motion trails) become glowing effect planes.
//   - layers stack in the game's order: each sits just above what it covers.
// ---------------------------------------------------------------------------

const SPRITE_WORLD = 28; // world units across a full sprite image (before spec.size)
const EPS = 0.1;
const MAX_SPIN = 8; // rad/s: game speeds are capped so fast rotors don't strobe

export class ImageSkin {
  static cache = new Map();

  static load(url) {
    if (!ImageSkin.cache.has(url)) {
      ImageSkin.cache.set(url, fetch(url).then((r) => r.json()).then((json) => ImageSkin.from(json, url)));
    }
    return ImageSkin.cache.get(url);
  }

  static async from(json, key) {
    const skin = new ImageSkin();
    skin.key = key;
    skin.spec = json.spec;
    skin.world = SPRITE_WORLD * (json.spec.size || 1);
    skin.images = {};
    await Promise.all(Object.entries(json.images).map(async ([name, src]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      skin.images[name] = { img, w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
    }));
    skin.layers = gameOrder(json.spec, skin.images, skin.world);
    // extent of everything, for the compare overlay
    let e = skin.world / 2;
    for (const l of skin.layers) e = Math.max(e, Math.abs(l.cx) + l.size / 2, Math.abs(l.cz) + l.size / 2);
    skin.extent = e;
    skin.viewBox = { x: -e, y: -e, w: 2 * e, h: 2 * e };
    return skin;
  }

  // The sprite as the game draws it (moving state), tinted; for thumbnails
  // and the compare overlay. `crop` trims empty margins (thumbnails only).
  render(colour, { size = 512, crop = false } = {}) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const scale = size / (2 * this.extent);
    for (const l of this.layers) {
      if (l.visibility === '2') continue;
      const src = this.images[l.img];
      const s = l.size * scale;
      const x = size / 2 + l.cx * scale - s / 2, y = size / 2 + l.cz * scale - s / 2;
      g.drawImage(l.tinted ? tintedCanvas(src.img, colour.body) : src.img, x, y, s, s);
    }
    if (!crop) return c.toDataURL();
    const d = g.getImageData(0, 0, size, size).data;
    let x0 = size, y0 = size, x1 = 0, y1 = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (d[(y * size + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
    if (x1 < x0) return c.toDataURL();
    const side = Math.max(x1 - x0, y1 - y0) + 8;
    const out = document.createElement('canvas');
    out.width = out.height = side;
    out.getContext('2d').drawImage(c, (x0 + x1) / 2 - side / 2, (y0 + y1) / 2 - side / 2, side, side, 0, 0, side, side);
    return out.toDataURL();
  }

  overlay(colour) { return this.render(colour); }
  thumbnail(colour) { return this.render(colour, { size: 256, crop: true }); }
}

// The game's draw order: [base, notint], with each rotor inserted at its layer.
function gameOrder(spec, images, world) {
  const list = [];
  const add = (l) => { if (images[l.img]) list.push(l); };
  // base and notint are always shown (visibility '0'), like the game draws them
  if (spec.base) add({ img: spec.base, role: 'base', tinted: true, cx: 0, cz: 0, size: world, speed: 0, visibility: '0' });
  if (spec.notint) add({ img: spec.notint, role: 'notint', tinted: false, cx: 0, cz: 0, size: world, speed: 0, visibility: '0' });
  for (const r of spec.rotors ?? []) {
    if (!images[r.img]) continue;
    const l = {
      img: r.img, role: 'rotor', tinted: !!r.tinted,
      cx: (r.x / 2) * world, cz: (r.y / 2) * world, size: (r.size ?? 1) * world,
      speed: r.noRotation ? 0 : (r.speed ?? 0), visibility: ['1', '2'].includes(r.visibility) ? r.visibility : '0',
    };
    if (r.layer !== undefined && r.layer <= list.length) list.splice(r.layer, 0, l);
    else list.push(l);
  }
  return list;
}

function tintedCanvas(img, colour) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = colour;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------------------
// Layer analysis
// ---------------------------------------------------------------------------
function analyse(src) {
  const { w, h, data } = src;
  const n = w * h;
  const alpha = new Float32Array(n), lum = new Float32Array(n);
  let covered = 0, opaque = 0;
  const hist = new Float64Array(40);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    alpha[i] = a;
    lum[i] = (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 765;
    if (a > 0.04) covered++;
    if (a >= 0.9) { opaque++; hist[Math.min(39, Math.floor(lum[i] * 40))]++; }
  }
  // two-tone ("flat") art: almost every opaque pixel is one of two shades,
  // fill and line. Hand-shaded art spreads across many shades.
  let flat = false, lineLevel = 0, tones = null;
  if (opaque) {
    const order = [...hist.keys()].sort((a, b) => hist[b] - hist[a]);
    const b1 = order[0];
    const b2 = order.find((b) => Math.abs(b - b1) >= 3);
    if (b2 !== undefined) {
      let near = 0;
      for (let b = 0; b < 40; b++) if (Math.abs(b - b1) <= 1 || Math.abs(b - b2) <= 1) near += hist[b];
      flat = near / opaque >= 0.88;
      lineLevel = (Math.min(b1, b2) + Math.max(b1, b2) + 1) / 2 / 40;
      tones = [(Math.min(b1, b2) + 0.5) / 40, (Math.max(b1, b2) + 0.5) / 40]; // line, fill
    }
  }
  const opaqueShare = covered ? opaque / covered : 0;
  // edge tone: the average shade just inside the art's outline (its outline colour)
  let edgeSum = 0, edgeN = 0;
  for (let y = 2; y < h - 2; y += 1) for (let x = 2; x < w - 2; x += 1) {
    const i = y * w + x;
    if (alpha[i] < 0.6) continue;
    let rim = false;
    for (let dy = -2; dy <= 2 && !rim; dy++) for (let dx = -2; dx <= 2; dx++) if (alpha[i + dy * w + dx] < 0.4) { rim = true; break; }
    if (rim) { edgeSum += lum[i]; edgeN++; }
  }
  const edgeTone = edgeN ? edgeSum / edgeN : 0.6;
  let grey = true;
  for (let i = 0; i < n && grey; i += 7) {
    if (data[i * 4 + 3] > 40 && Math.max(Math.abs(data[i * 4] - data[i * 4 + 1]), Math.abs(data[i * 4 + 1] - data[i * 4 + 2])) > 12) grey = false;
  }
  return {
    alpha, lum, flat, lineLevel, tones, grey, edgeTone,
    // see-through layers (glows) are effects; partly see-through ones
    // (a motion-blurred arc with a solid weight) are both
    kind: opaqueShare < 0.15 ? 'effect' : opaqueShare < 0.6 ? 'mixed' : 'solid',
  };
}

// Cubic kernels for upscale(): B-spline smooths (no overshoot); Catmull-Rom
// keeps edges sharp.
function bspline(t) {
  t = Math.abs(t);
  if (t < 1) return (4 - 6 * t * t + 3 * t * t * t) / 6;
  if (t < 2) return (2 - t) ** 3 / 6;
  return 0;
}
function catmullRom(t) {
  t = Math.abs(t);
  if (t < 1) return 1.5 * t ** 3 - 2.5 * t * t + 1;
  if (t < 2) return -0.5 * t ** 3 + 2.5 * t * t - 4 * t + 2;
  return 0;
}

// Separable cubic upscale of RGBA bytes by an integer factor.
function upscale(src, w, h, S, kernel) {
  const W = w * S, H = h * S;
  const taps = (n, N) => { // for each output index: 4 source indices and weights
    const idx = new Int32Array(N * 4), wt = new Float32Array(N * 4);
    for (let o = 0; o < N; o++) {
      const f = (o + 0.5) / S - 0.5, i0 = Math.floor(f);
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const i = i0 - 1 + k;
        const v = kernel(f - i);
        idx[o * 4 + k] = Math.min(n - 1, Math.max(0, i));
        wt[o * 4 + k] = v;
        sum += v;
      }
      for (let k = 0; k < 4; k++) wt[o * 4 + k] /= sum;
    }
    return { idx, wt };
  };
  const tx = taps(w, W), ty = taps(h, H);
  const mid = new Float32Array(W * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < 4; c++) {
        let v = 0;
        for (let k = 0; k < 4; k++) v += tx.wt[x * 4 + k] * src[(y * w + tx.idx[x * 4 + k]) * 4 + c];
        mid[(y * W + x) * 4 + c] = v;
      }
    }
  }
  const outp = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < 4; c++) {
        let v = 0;
        for (let k = 0; k < 4; k++) v += ty.wt[y * 4 + k] * mid[(ty.idx[y * 4 + k] * W + x) * 4 + c];
        outp[(y * W + x) * 4 + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return outp;
}

// Image as a texture, with colour bled into transparent pixels so filtering
// never pulls in a dark fringe at the edges.
function layerTexture(src, an) {
  const { w, h, data } = src;
  const out = new Uint8Array(data);
  const filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = data[i * 4 + 3] > 4 ? 1 : 0;
  for (let pass = 0; pass < 6; pass++) {
    const add = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (filled[i]) continue;
      let r = 0, g = 0, b = 0, k = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const j = Y * w + X;
        if (!filled[j]) continue;
        r += out[j * 4]; g += out[j * 4 + 1]; b += out[j * 4 + 2]; k++;
      }
      if (k) add.push([i, r / k, g / k, b / k]);
    }
    for (const [i, r, g, b] of add) { out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; filled[i] = 1; }
  }
  // Enlarge with cubic filtering, so where the art is stretched over slopes it
  // shades smoothly instead of showing pixel columns as stripes.
  let tw = w, th = h, pixels = out;
  if (an.flat && an.grey && an.tones) {
    // Two-tone art: smoothing cubic 4x, then snap back to the two tones
    // (line / fill) with a narrow anti-aliased step; the alpha edge likewise.
    // Lines stay crisp and straight when magnified.
    const S = 4;
    const big = upscale(out, w, h, S, bspline);
    tw = w * S; th = h * S;
    pixels = new Uint8Array(tw * th * 4);
    const [lineTone, fillTone] = an.tones;
    const lv = an.lineLevel, soft = 0.07;
    const step = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let o = 0; o < tw * th * 4; o += 4) {
      const l = (big[o] + big[o + 1] + big[o + 2]) / 765;
      const g = 255 * (lineTone + (fillTone - lineTone) * step(lv - soft, lv + soft, l));
      pixels[o] = pixels[o + 1] = pixels[o + 2] = g;
      pixels[o + 3] = 255 * step(0.3, 0.7, big[o + 3] / 255);
    }
  } else {
    // Hand-shaded art: sharpness-preserving cubic (Catmull-Rom) 3x.
    pixels = upscale(out, w, h, 3, catmullRom);
    tw = w * 3; th = h * 3;
  }
  const tex = new THREE.DataTexture(pixels, tw, th, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
export function imageRecipe(config = {}) {
  return {
    load: (skin) => ImageSkin.load(skin.file),
    build: ({ svg: skin, mats }) => buildImageSkin(skin, mats, config),
  };
}

function buildImageSkin(skin, mats, cfg) {
  const root = new THREE.Group();
  const tall = cfg.tall ?? 1;
  const e = skin.extent + 2;
  const bounds = new THREE.Box2(new THREE.Vector2(-e, -e), new THREE.Vector2(e, e));
  const hf = new Heightfield(bounds, 0.1); // surfaces built so far
  const clear = new Heightfield(bounds, 0.1); // space swept by spinning layers: keep above, don't rest on
  const solids = []; // { area, box }
  const guns = []; // boxes of guns, for muzzles
  const spinners = []; // { group, speed, visibility }
  const effects = []; // built after the solids: { layer, analysis, tex, before }
  const toggles = []; // { object, visibility }

  // The seat for a part resting on others (a canopy on a hull): the surface
  // beneath with narrow dips bridged over (each point takes the highest
  // surface within a short radius), so it doesn't drape into them, while
  // still following broad curves such as a sphere.
  const restCache = new Map();
  const restCached = (x, z) => { // restOn on a 0.08 grid, cached (it's sampled a lot)
    const i = Math.round(x / 0.08), j = Math.round(z / 0.08), key = i * 100003 + j;
    let v = restCache.get(key);
    if (v === undefined) { v = restOn(i * 0.08, j * 0.08); restCache.set(key, v); }
    return v;
  };
  const bridged = (x, z) => {
    let best = restCached(x, z);
    const r = 0.38;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      best = Math.max(best, restCached(x + r * Math.cos(a), z + r * Math.sin(a)));
    }
    return best;
  };

  // blurred surface height, for parts resting on others
  const restOn = (x, z) => {
    for (const step of [0.15, 0.4, 0.9, 1.8]) {
      let sum = 0, n = 0;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        const v = hf.sample(x + a * step, z + b * step);
        if (Number.isFinite(v)) { sum += v; n++; }
      }
      // never below the highest surface right here (blurring lowers peaks)
      if (n) {
        const here = hf.sample(x, z); // smooth (interpolated), so steep flanks don't make steps
        return Math.max(sum / n, Number.isFinite(here) ? here : -Infinity) + 0.04;
      }
    }
    return 0.04;
  };

  skin.layers.forEach((layer, index) => {
    const src = skin.images[layer.img];
    const an = analyse(src);
    const tex = layerTexture(src, an);
    const x0 = layer.cx - layer.size / 2, z0 = layer.cz - layer.size / 2;
    const toWorld = ([px, py]) => new THREE.Vector2(x0 + (px / src.w) * layer.size, z0 + (py / src.h) * layer.size);
    const sampleAt = (field, x, z) => { // bilinear, in world coordinates
      const fx = ((x - x0) / layer.size) * src.w - 0.5, fy = ((z - z0) / layer.size) * src.h - 0.5;
      const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
      const g = (a, b) => (a < 0 || b < 0 || a >= src.w || b >= src.h ? 0 : field[b * src.w + a]);
      return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v;
    };
    const spinning = layer.speed !== 0;
    const group = new THREE.Group();
    if (spinning || layer.visibility !== '0') {
      root.add(group);
      if (spinning) {
        group.position.set(layer.cx, 0, layer.cz);
        spinners.push({ group, speed: THREE.MathUtils.clamp(layer.speed * Math.PI / 180 * 60, -MAX_SPIN, MAX_SPIN) });
      }
      if (layer.visibility !== '0') toggles.push({ object: group, visibility: layer.visibility });
    }
    const holder = spinning || layer.visibility !== '0' ? group : root;

    if (an.kind !== 'solid') effects.push({ layer, an, tex, holder, index });
    if (an.kind === 'effect') return;

    // ---- solid parts ------------------------------------------------------
    const level = an.kind === 'mixed' ? 0.85 : 0.5;
    const shapes = traceShapes(an.alpha, src.w, src.h, level, { minArea: 8 });
    // a spinning layer turns as one: it sits above everything its blades sweep
    let spinLevel = null;
    if (spinning) {
      const centre = new THREE.Vector2(layer.cx, layer.cz);
      let reach = 0, nearest = Infinity;
      for (const s of shapes) {
        for (const p of s.outline) {
          const r = toWorld(p).distanceTo(centre);
          reach = Math.max(reach, r);
          nearest = Math.min(nearest, r);
        }
      }
      let below;
      if (cfg.orbit && nearest > 0.5) {
        // parts that only travel round a ring (weights orbiting a pod) need
        // only that ring clear, so they can circle the pod instead of
        // floating over all of it
        below = -Infinity;
        for (let r = nearest; r <= reach; r += 0.15) {
          for (let a = 0; a < Math.PI * 2; a += 0.08) {
            const x = layer.cx + r * Math.cos(a), z = layer.cz + r * Math.sin(a);
            below = Math.max(below, hf.at(x, z), clear.at(x, z));
          }
        }
        spinLevel = (Number.isFinite(below) ? below : 0) + 0.1;
      } else {
        below = Math.max(hf.maxInCircle(layer.cx, layer.cz, reach), clear.maxInCircle(layer.cx, layer.cz, reach));
        spinLevel = (Number.isFinite(below) ? below : 0) + (cfg.spinGap ?? 0.3);
      }
      layer.reach = reach;
    }

    for (const shape of shapes) {
      const outline = shape.outline.map(toWorld);
      const holes = shape.holes.map((hl) => hl.map(toWorld));
      const area = Math.abs(signedArea(outline)) - holes.reduce((a, hl) => a + Math.abs(signedArea(hl)), 0);
      if (area < 0.05) continue;
      // how much of it lies on parts already built
      let on = 0, all = 0;
      const box = new THREE.Box2().setFromPoints(outline);
      const step = Math.max(0.12, Math.sqrt(area) / 30);
      for (let x = box.min.x; x <= box.max.x; x += step) {
        for (let z = box.min.y; z <= box.max.y; z += step) {
          if (sampleAt(an.alpha, x, z) < level) continue;
          all++;
          if (hf.at(x, z) > -Infinity) on++;
        }
      }
      const covered = all ? on / all : 0;
      // does this part have its own darker outline round its rim (a drawn
      // part, like a canopy), or is it one even tone (painted shading)?
      let rimSum = 0, rimN = 0, inSum = 0, inN = 0;
      {
        // in pixels: a rim pixel has a see-through pixel within 2 px; an inner one none within 4
        const px0 = Math.max(0, Math.floor(((box.min.x - x0) / layer.size) * src.w)), px1 = Math.min(src.w - 1, Math.ceil(((box.max.x - x0) / layer.size) * src.w));
        const py0 = Math.max(0, Math.floor(((box.min.y - z0) / layer.size) * src.h)), py1 = Math.min(src.h - 1, Math.ceil(((box.max.y - z0) / layer.size) * src.h));
        const clearWithin = (x, y, r) => {
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            const X = x + dx, Y = y + dy;
            if (X < 0 || Y < 0 || X >= src.w || Y >= src.h || an.alpha[Y * src.w + X] < 0.4) return true;
          }
          return false;
        };
        for (let y = py0; y <= py1; y++) {
          for (let x = px0; x <= px1; x++) {
            const k = y * src.w + x;
            if (an.alpha[k] < 0.6) continue;
            if (clearWithin(x, y, 2)) { rimSum += an.lum[k]; rimN++; } else if (!clearWithin(x, y, 4)) { inSum += an.lum[k]; inN++; }
          }
        }
      }
      const outlined = rimN && inN ? rimSum / rimN < inSum / inN - 0.06 : an.flat;
      const dome = !spinning && covered > 0.85;
      const metal = !layer.tinted;
      const centroid = outline.reduce((a, p) => a.add(p), new THREE.Vector2()).divideScalar(outline.length);
      const info = {
        layer: layer.img, role: layer.role, index: shapes.indexOf(shape), area, box, centroid,
        holes: holes.length, covered, outlined, flat: an.flat, spinning, tinted: layer.tinted,
        outline, holeLoops: holes, skin, spin: { x: layer.cx, z: layer.cz },
      };
      (root.userData.parts ??= []).push(info);
      const mechanical = metal && (an.flat || spinning); // grey drawn hardware: blades, gears, guns
      const R = Math.sqrt(area / Math.PI);
      const cap = THREE.MathUtils.clamp(0.28 * Math.sqrt(area), 0.5, 2.2) * tall;
      const opt = cfg.layers?.[layer.img] ?? {};
      let top, bottom;
      if (dome && !outlined) {
        // an overlay on hand-shaded art (a painted shadow, a highlight): it is
        // shading, not a part, so it's printed onto the surface
        top = (d, round) => Math.min(0.04 * round, 0.08);
      } else if (dome) {
        // flat-art parts lying on the body (canopies, plates): low domes
        top = (d, round) => softCap(0.45 * round, metal ? 1.0 : 0.8);
      } else if (opt.profile === 'box') {
        // a flat-topped plate with rounded edges
        const H = (opt.height ?? 0.9) * tall, rb = Math.min(R, 0.8);
        top = (d) => H * pillow(d, rb);
        bottom = (d) => 0.75 * H * pillow(d, rb);
      } else if (mechanical) {
        // grey mechanical art (blades, gears, guns): rigid, flat-topped, thinner when spinning
        const T = spinning ? THREE.MathUtils.clamp(0.08 * R, 0.1, 0.22) : THREE.MathUtils.clamp(0.4 * R, 0.15, 0.6);
        const rb = Math.min(R, 0.3);
        top = (d) => T * pillow(d, rb);
        bottom = (d) => T * pillow(d, rb);
      } else {
        // painted bodies: smooth balloons
        const k = an.flat ? 0.62 : 0.85;
        top = (d, round) => softCap(k * round * tall, cap);
        bottom = (d, round) => softCap(0.6 * round, cap * 0.8);
      }
      // a skin can sculpt any part by hand (see image skins in skins/index.js)
      const sculpt = cfg.shape?.(info) ?? null;
      if (sculpt?.top) top = sculpt.top;
      if (sculpt?.bottom) bottom = sculpt.bottom;
      const part = sculpt?.shell && !dome ? shellPart(outline, holes, {
        top: sculpt.shell.top, bottom: sculpt.shell.bottom, bevel: sculpt.shell.bevel ?? 0.3,
        spacing: sculpt.spacing ?? 0.12,
      }) : inflate(outline, holes, {
        mode: dome ? 'dome' : 'solid', top, bottom, base: dome ? bridged : restOn,
        spacing: sculpt?.spacing ?? THREE.MathUtils.clamp(Math.sqrt(area) / 40, 0.06, 0.2),
      });
      const geometry = part.geometry;

      if (!dome) {
        if (spinLevel !== null) {
          // a spinning part's underside sits on its clearance level
          geometry.computeBoundingBox();
          geometry.translate(0, spinLevel - geometry.boundingBox.min.y, 0);
        }
        else place(geometry, part, outline, area, covered);
      }
      if (spinLevel !== null) {
        geometry.computeBoundingBox();
        layer.top = Math.max(layer.top ?? -Infinity, geometry.boundingBox.max.y);
      }

      // project the layer image straight down onto the part
      const pos = geometry.attributes.position;
      const uv = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        uv[i * 2] = (pos.getX(i) - x0) / layer.size;
        uv[i * 2 + 1] = (pos.getZ(i) - z0) / layer.size;
      }
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

      if (!spinning) hf.add(geometry);
      const material = mats.textured({
        key: `${skin.key}:${layer.img}:${layer.tinted}`, map: tex, tinted: layer.tinted,
        // the art's lines are printed only (no relief), as on every other skin
        kind: metal ? 'metal' : 'paint', resting: dome,
        hard: !!(sculpt?.shell && !dome),
        sideTone: an.tones ? Math.min(an.edgeTone, an.tones[0] + 0.05) : an.edgeTone,
      });
      const m = mesh(geometry, material);
      info.material = material;
      info.projectUV = (g) => { // paint another geometry with this layer's art, projected from above
        const ps = g.attributes.position, u = new Float32Array(ps.count * 2);
        for (let i = 0; i < ps.count; i++) { u[i * 2] = (ps.getX(i) - x0) / layer.size; u[i * 2 + 1] = (ps.getZ(i) - z0) / layer.size; }
        g.setAttribute('uv', new THREE.BufferAttribute(u, 2));
        return g;
      };
      info.placed = new THREE.Box3().setFromBufferAttribute(pos); // final world box (before spin offset)
      if (spinning) geometry.translate(-layer.cx, 0, -layer.cz);
      holder.add(m);
      if (!dome && !spinning) {
        const box3 = new THREE.Box3().setFromBufferAttribute(pos);
        solids.push({ area, box: box3 });
        // a gun: grey, not resting on the body, on the centre line, ahead of the middle
        if (metal && covered < 0.6 && Math.abs(centroid.y) < 2 && centroid.x > 0 && (cfg.muzzles ?? true)) guns.push(box3);
      }
    }
    if (spinning && layer.reach) {
      // later layers clear the swept disc
      clear.add(new THREE.CircleGeometry(layer.reach, 48).rotateX(-Math.PI / 2).translate(layer.cx, layer.top + 0.02, layer.cz));
    }
  });

  // ---- glows and motion trails --------------------------------------------
  // Drawn under the craft if the game draws them first, otherwise over it.
  const firstSolid = skin.layers.findIndex((l, i) => !effects.some((f) => f.index === i && f.an.kind === 'effect'));
  const low = solids.length ? Math.min(...solids.map((s) => s.box.min.y)) : 0;
  const glows = [];
  effects.forEach(({ layer, tex, holder, index, an }, k) => {
    const under = index < firstSolid;
    // glows drawn under the craft sit just at its underside, touching it
    const y = under ? low + 0.04 - k * 0.03 : restOn(layer.cx, layer.cz) + 0.05;
    // +y of the plane -> +z, so the image's first row lies at -z (top of the sprite), as on the parts
    const plane = new THREE.PlaneGeometry(layer.size, layer.size).rotateX(Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      color: layer.tinted ? mats.body.color : '#ffffff',
    });
    const m = new THREE.Mesh(plane, material);
    if (an.kind === 'mixed') {
      // a motion trail: just under the spinning solid parts it belongs to
      const solidsY = holder.children.filter((c) => c.isMesh).map((c) => new THREE.Box3().setFromObject(c).min.y);
      m.position.y = solidsY.length ? Math.min(...solidsY) + 0.05 : y;
      if (holder === root) m.position.set(layer.cx, m.position.y, layer.cz);
    } else {
      m.position.set(holder === root || !layer.speed ? layer.cx : 0, y, holder === root || !layer.speed ? layer.cz : 0);
    }
    m.renderOrder = 3;
    m.userData.noFrame = true; // glows can be much bigger than the craft; don't frame on them
    holder.add(m);
    if (an.kind === 'effect') glows.push(m);
  });

  // ---- shared kit: a dark bore on the front face of each gun -----------------
  for (const box of guns) {
    addMuzzle(root, mats, {
      x: box.max.x, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2,
      radius: Math.min(box.max.z - box.min.z, box.max.y - box.min.y) * 0.3,
    });
  }
  cfg.extras?.({ root, mats, skin, hf, clear, parts: root.userData.parts ?? [], THREE, mesh });

  let spool = null;
  return {
    object: root,
    update(dt, t, state) {
      spool = THREE.MathUtils.damp(spool ?? (state.spin ? 1 : 0), state.spin ? 1 : 0, 1.6, dt);
      for (const s of spinners) s.group.rotation.y += dt * spool * s.speed;
      // moving-only / idle-only layers follow the Spin toggle
      for (const tg of toggles) tg.object.visible = tg.visibility === '1' ? state.spin : !state.spin;
      for (const [i, g] of glows.entries()) {
        const pulse = 1 + 0.025 * Math.sin(t * 2.2 + i);
        g.scale.set(pulse, 1, pulse);
        g.material.opacity = 0.88 + 0.12 * Math.sin(t * 3.1 + i * 1.7);
      }
    },
  };

  // Lift a part just above what it covers. Small parts attached to bigger ones
  // (booms, wings, a serpent wrapped over a body) hug the surface where they
  // overlap it and ease back down beyond, instead of floating as a block.
  function place(geometry, part, outline, area, covered) {
    const need = [];
    part.points.forEach((p, i) => {
      // highest surface near the point (not just at it): curved bodies bulge
      // between mesh points, and must not poke through the part above
      const under = Math.max(hf.maxNear(p.x, p.y, 0.15), clear.at(p.x, p.y));
      if (under > -Infinity) need.push([p, under + EPS - part.hTop[i]]);
    });
    if (!need.length) return;
    const biggest = Math.max(0, ...solids.map((s) => s.area));
    if (!(area < 0.6 * biggest && covered < 0.6)) {
      geometry.translate(0, Math.max(...need.map(([, l]) => l)), 0);
      return;
    }
    const frame = principalFrame(outline);
    const axis = (q) => frame.toLocal(q).x;
    const bin = 0.25;
    const req = new Map();
    for (const [p, l] of need) { const k = Math.round(axis(p) / bin); req.set(k, Math.max(req.get(k) ?? -Infinity, l)); }
    const peak = Math.max(...req.values());
    const raw = (sv) => {
      let v = peak - 1.4;
      for (const [k, l] of req) v = Math.max(v, l - 0.5 * Math.abs(sv - k * bin));
      return v;
    };
    const smooth = (sv) => {
      let sum = 0, ws = 0;
      for (let d = -8; d <= 8; d++) { const w = Math.exp(-(d * d) / 18); sum += w * raw(sv + d * bin * 0.4); ws += w; }
      return sum / ws;
    };
    let short = 0;
    for (const [p, l] of need) short = Math.max(short, l - smooth(axis(p)));
    const pos = geometry.attributes.position;
    const v2 = new THREE.Vector2();
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + smooth(axis(v2.set(pos.getX(i), pos.getZ(i)))) + short);
    pos.needsUpdate = true;
    geometry.userData.resmooth?.();
  }
}
