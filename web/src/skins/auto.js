import * as THREE from 'three';
import { inflate, pillow, softCap, Heightfield, signedArea } from '../geometry/inflate.js';
import { addSkids, addMast, addMuzzle, addLeg } from './kit.js';
import { offsetOutline, sliceAt, tubeAlong, blurDisc, mesh, loftOutline, drapeDome, edgeBand } from '../geometry/shapes.js';

// ---------------------------------------------------------------------------
// Automatic skin builder.
//
// Reads a skin SVG in draw order and turns every element into a smooth part
// with its stroke printed on (same look as skin 01), so the Top view matches
// the sprite:
//   - filled shapes   -> inflated parts (team paint if blue, metal if grey,
//                        light if white). A shape lying almost entirely on
//                        earlier parts becomes a low dome resting on them.
//   - stroke-only     -> tubes: open lines drape over what's beneath; closed
//                        loops become rings (e.g. propeller guards).
//   - draw order      -> height: each part is placed just above whatever it
//                        overlaps, so later elements cover earlier ones.
//   - main rotors     -> any group of blade rects + a hub circle; built last,
//                        above everything, with a mast, and spinning.
//   - propellers      -> groups named in the config; spin about their pivots.
//   - skids           -> added under the main body of rotor craft.
//
// Config (all optional):
//   props:  [{ group: 'gId', pivots: ['id', ...] }]     pivots: elements whose centres are the hubs
//           [{ group: 'gId', pivotSubpaths: 'id' }]     or: the centres of one element's sub-paths
//   skids:  false to leave out landing skids
//   legs:   true to put landing legs under propeller pods
//   tall:   height multiplier for team-colour parts (1 = default)
//   spin:   [{ ids: ['id', ...], about: 'id', speed }]  extra parts that rotate about an element's centre
//   parts:  { id: { droop: degrees, height: k, profile: 'box' } }   per-element tweaks
//   profile: 'box' for flat-topped, round-edged bodies (default: smooth balloon)
//   pods:   'nacelle' to make small round pods short cylinders
//   rotorBars: ['id', ...]   lines that turn with the main rotor as extra spokes
//   extras: (ctx) => void   add custom detail; ctx = { root, mats, svg, hf, mesh, THREE }
// ---------------------------------------------------------------------------
export function autoRecipe(config = {}) {
  return {
    pivot: config.pivot ?? null,
    build: (ctx) => buildAuto(ctx, config),
  };
}

const BLUE = '#00b2e1';
const GREY = '#999999';
const WHITE = '#ffffff';
const EPS = 0.06; // clearance between stacked parts

function buildAuto({ svg, mats }, cfg) {
  const root = new THREE.Group();
  const vb = svg.viewBox;
  const hf = new Heightfield(new THREE.Box2(
    new THREE.Vector2(vb.x - 4, vb.y - 4), new THREE.Vector2(vb.x + vb.w + 4, vb.y + vb.h + 4),
  ), 0.1);
  const elements = svg.elements();
  const spinners = [];
  const solids = [];
  const guns = [];
  const tall = cfg.tall ?? 1;
  const freeBars = []; // straight rods, placed once everything else is built
  const rings = []; // guard rings: bars inside one sit at its height
  const made = new Map(); // element id -> meshes built for it

  const roleFill = (fill, banded) => {
    if (fill === GREY) return banded ? mats.paintMetal : mats.metal;
    if (fill === WHITE) return mats.light;
    return banded ? mats.paint : mats.body;
  };
  const roleStroke = (stroke) => (stroke === '#727272' ? mats.metalDark : mats.trim);

  // Height a dome rests on: the surface beneath, blurred so the dome stays
  // smooth even where that surface is irregular.
  // Over a gap (e.g. a canopy over a hole in the body) it looks further out
  // and bridges across at the height of the surrounding rim.
  const restOn = (x, z) => {
    for (const step of [0.15, 0.4, 0.9, 1.8]) {
      let sum = 0, n = 0;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        const h = hf.sample(x + a * step, z + b * step);
        if (Number.isFinite(h)) { sum += h; n++; }
      }
      // never below the highest surface right here (blurring lowers peaks)
      if (n) {
        const here = hf.sample(x, z); // smooth (interpolated), so steep flanks don't make steps
        return Math.max(sum / n, Number.isFinite(here) ? here : -Infinity) + 0.04;
      }
    }
    return 0.04;
  };

  // Least-squares plane through the surface under an ellipse's footprint.
  const planeUnder = (ell) => {
    const pts = [];
    for (const t of [0, 0.35, 0.7, 0.95]) {
      for (let k = 0; k < (t ? 24 : 1); k++) {
        const a = (k / 24) * Math.PI * 2;
        const x = ell.cx + ell.rx * t * Math.cos(a), z = ell.cy + ell.ry * t * Math.sin(a);
        pts.push([x - ell.cx, z - ell.cy, restOn(x, z)]);
      }
    }
    // normal equations for h = a*x + b*z + c (x, z centred)
    let sxx = 0, szz = 0, sxz = 0, sx = 0, sz = 0, sh = 0, sxh = 0, szh = 0;
    for (const [x, z, h] of pts) { sxx += x * x; szz += z * z; sxz += x * z; sx += x; sz += z; sh += h; sxh += x * h; szh += z * h; }
    const n = pts.length;
    const m = new THREE.Matrix3().set(sxx, sxz, sx, sxz, szz, sz, sx, sz, n);
    const r = new THREE.Vector3(sxh, szh, sh).applyMatrix3(m.invert());
    return (x, z) => r.x * (x - ell.cx) + r.y * (z - ell.cy) + r.z;
  };

  // ---- filled region -> smooth part ------------------------------------------
  // Most sprite parts are simple enough to loft along their main axis (clean,
  // even surfaces, as in skin 01); anything else (X shapes, holes) is inflated.
  const buildRegion = (region, el, { at = null } = {}) => {
    const sw = el.stroke ? el.strokeWidth : 0;
    const outer = sw ? offsetOutline(region.outline, -sw / 2) : region.outline;
    // a hole that a later shape covers completely (a socket for a canopy, say)
    // is filled in; real openings (ducts) stay open
    const order = elements.indexOf(el);
    const coveredLater = (h) => {
      const hb = new THREE.Box2().setFromPoints(h);
      return elements.slice(order + 1).some((e) => e.fill && svg.box(e.id).expandByScalar(0.05).containsBox(hb));
    };
    const holes = region.holes.filter((h) => !coveredLater(h)).map((h) => (sw ? offsetOutline(h, sw / 2) : h));
    const samples = samplesIn(outer, holes, 0.15);
    const covered = samples.filter((p) => hf.at(p.x, p.y) > -Infinity).length / Math.max(samples.length, 1);
    const area = Math.abs(signedArea(outer)) - holes.reduce((a, h) => a + Math.abs(signedArea(h)), 0);
    const grey = el.fill === GREY;
    const white = el.fill === WHITE;
    const R0 = Math.max(...samples.map((p) => distTo(p, [outer, ...holes])), 0.05);
    const elong = area / (Math.PI * R0 * R0);
    const dome = at === null && covered > 0.85;
    // grey shapes lying on the body that aren't round caps are canopies: glass
    const canopy = dome && grey && elong > 1.3 && area > 1.5;
    const material = white ? mats.light
      : canopy ? (sw ? mats.paintGlass : mats.glass)
        : roleFill(el.fill, sw > 0);

    // local frame along the part's main axis
    // (try the main axis, then across it; a loft fills small notches, which
    // is fine while they add under 8% to the area: usually hidden anyway)
    let frame = principalFrame(outer);
    let local = outer.map(frame.toLocal);
    if (!holes.length && loftExcess(local) > 1.08) {
      const alt = principalFrame(outer, Math.PI / 2);
      const altLocal = outer.map(alt.toLocal);
      if (loftExcess(altLocal) < loftExcess(local)) { frame = alt; local = altLocal; }
    }
    const loftable = !holes.length && loftExcess(local) <= 1.08;

    let geometry, surfaceAt; // surfaceAt(world x, z) -> top height, before lifting
    const ell = (el.tag === 'circle' || el.tag === 'ellipse') && !holes.length ? ellipseFit(outer) : null;
    if (ell) {
      // circles and ellipses: built round, ring by ring (no slicing, no wobble)
      const r = Math.min(ell.rx, ell.ry);
      let top, bottom = () => 0;
      if (dome) {
        const H = white ? 0.95 * r : THREE.MathUtils.clamp(0.45 * r, 0.15, 1.2) * (grey ? 1 : Math.sqrt(tall));
        top = (t) => H * Math.sqrt(Math.max(0, 1 - t * t));
      } else if (grey) { // hub: a puck with a rounded edge
        const T = THREE.MathUtils.clamp(0.4 * r, 0.12, 0.42);
        top = bottom = shoulder(T, Math.min(0.12, T * 0.4), r, 0);
      } else if (r < 2.6 && cfg.pods === 'nacelle') { // motor nacelle: a short rounded cylinder
        top = shoulder(0.9 * r, 0.35 * r, r, 0.55);
        bottom = shoulder(0.9 * r, 0.35 * r, r, 0.55);
      } else if (r < 2.6) { // pod: a smooth ellipsoid
        const H = 0.85 * r * Math.min(tall, 1.3);
        top = (t) => H * Math.sqrt(Math.max(0, 1 - t * t));
        bottom = (t) => 0.72 * r * Math.sqrt(Math.max(0, 1 - t * t));
      } else { // big disc: a rigid saucer with an upright rim, shoulder and dome
        const H = Math.min(0.34 * r, 2.6) * tall;
        top = shoulder(H, Math.min(1.2, 0.22 * r), r, 0.28);
        bottom = shoulder(H * 0.6, Math.min(1.0, 0.2 * r), r, 0.3);
      }
      // a round cap rests on the best-fit plane under it: perfectly smooth
      geometry = radialPart(ell, { top, bottom, dome, base: dome ? planeUnder(ell) : restOn, band: sw });
      if (!dome) surfaceAt = (x, z) => { const t = Math.hypot((x - ell.cx) / ell.rx, (z - ell.cy) / ell.ry); return t <= 1 ? top(t) : NaN; };
    } else if (loftable && dome) {
      const L = Math.max(...local.map((p) => p.x)) - Math.min(...local.map((p) => p.x));
      const short = 2 * Math.max(...Array.from({ length: 24 }, (_, k) => sliceAt(local, THREE.MathUtils.lerp(Math.min(...local.map((p) => p.x)), Math.min(...local.map((p) => p.x)) + L, (k + 0.5) / 24)).w));
      const height = white ? Math.min(0.7 * short / 2, 0.8) : THREE.MathUtils.clamp(0.3 * short, 0.12, canopy ? 1.2 : 0.8);
      geometry = drapeDome(local, {
        base: (x, z) => { const w = frame.toWorld(new THREE.Vector2(x, z)); return restOn(w.x, w.y); },
        height,
        along: canopy ? (u) => Math.sin(Math.PI * Math.pow(u, 0.7)) : (u) => Math.sin(Math.PI * u),
        rings: 56, cols: 40,
      });
      geometry.applyMatrix4(frame.matrix);
    } else if (loftable && grey) {
      const cap = THREE.MathUtils.clamp(0.28 * Math.sqrt(area), 0.5, 2.2);
      let opts;
      if (grey && elong > 5) { // blades and struts
        const T = THREE.MathUtils.clamp(0.16 * R0, 0.06, 0.16);
        opts = { power: 4, top: (x, w) => Math.min(w, T), bottom: (x, w) => Math.min(w, T) };
      } else { // guns, hubs, blocks
        const T = THREE.MathUtils.clamp(0.42 * R0, 0.15, 0.6);
        opts = { power: 5, top: (x, w) => Math.min(w * 0.9, T), bottom: (x, w) => Math.min(w * 0.9, T) };
      }
      const span = Math.max(...local.map((p) => p.x)) - Math.min(...local.map((p) => p.x));
      const loft = loftOutline(local, { ...opts, y0: 0, rings: THREE.MathUtils.clamp(Math.round(span / 0.1), 40, 180), sides: 56 });
      geometry = loft.geometry;
      geometry.applyMatrix4(frame.matrix);
      surfaceAt = (x, z) => { const l = frame.toLocal(new THREE.Vector2(x, z)); return loft.surfaceY(l.x, l.y); };
    } else {
      // fallback: inflate (any outline, holes allowed)
      root.userData.inflated = [...(root.userData.inflated ?? []), el.id];
      let top, bottom;
      if (dome) {
        top = (d, round) => softCap(0.45 * round, grey ? 1.0 : 0.8);
      } else if (grey) {
        const T = THREE.MathUtils.clamp(0.42 * R0, 0.15, 0.6);
        top = bottom = (d) => T * pillow(d, Math.min(R0, 0.4));
      } else {
        // team-colour body: a smooth balloon over the outline. Parts much wider
        // sideways than long (wings, stabilisers) are flattened like aerofoils;
        // cfg.parts[id].profile = 'box' gives a flat top with rounded edges.
        const bb = new THREE.Box2().setFromPoints(outer);
        const wing = bb.max.y - bb.min.y > 1.6 * (bb.max.x - bb.min.x);
        const k = (cfg.parts?.[el.id]?.height ?? 1) * (wing ? 0.38 : 1) * tall;
        const cap = THREE.MathUtils.clamp(0.28 * Math.sqrt(area), 0.5, 2.2);
        if ((cfg.parts?.[el.id]?.profile ?? cfg.profile) === 'box') {
          const H = Math.min(0.55 * R0, 1.8) * k, rb = Math.min(R0, 1.1);
          top = (d) => H * pillow(d, rb);
          bottom = (d) => 0.8 * H * pillow(d, rb);
        } else {
          top = (d, round) => softCap(0.92 * round * k, cap * k);
          bottom = (d, round) => softCap(0.74 * round * (wing ? 0.38 : 1), cap * 0.85);
        }
      }
      const part = inflate(outer, holes, {
        mode: dome ? 'dome' : 'solid', top, bottom, band: sw || 1, bandWidth: sw,
        base: restOn,
      });
      geometry = part.geometry;
      geometry.userData.smoothNormals = true; // smoothed inside inflate; lifting is redone below
      const tops = new Map(part.points.map((p, i) => [p, part.hTop[i]]));
      surfaceAt = null;
      if (!dome) {
        // how far each point must rise to clear what's already built
        const need = [];
        for (const [p, h] of tops) { const under = hf.at(p.x, p.y); if (under > -Infinity) need.push([p, under + EPS - h]); }
        const biggest = Math.max(0, ...solids.map((o) => o.area));
        if (at !== null) geometry.translate(0, at, 0);
        else if (!need.length) { /* stands alone at the base level */ } else if (area < 0.6 * biggest && covered < 0.6) {
          // an attached part (boom, pod, fin): rise only where it lies over the
          // bigger part, hugging its surface, and ease back down beyond it, so
          // it flows out of the body instead of sitting on it like a log
          const axis = (q) => frame.toLocal(q).x;
          const bin = 0.25;
          const req = new Map();
          for (const [p, l] of need) { const k = Math.round(axis(p) / bin); req.set(k, Math.max(req.get(k) ?? -Infinity, l)); }
          const peak = Math.max(...req.values());
          const floor = peak - 1.4;
          const slope = 0.5;
          const raw = (sv) => {
            let v = floor;
            for (const [k, l] of req) v = Math.max(v, l - slope * Math.abs(sv - k * bin));
            return v;
          };
          // a continuous, smoothed envelope (no per-step clamping, which left
          // faint ridges that gloss picks up), raised as a whole until it
          // clears every requirement
          const smoothLift = (sv) => {
            let sum = 0, wsum = 0;
            for (let d = -8; d <= 8; d++) { const w = Math.exp(-(d * d) / 18); sum += w * raw(sv + d * bin * 0.4); wsum += w; }
            return sum / wsum;
          };
          let short = 0;
          for (const [k, l] of req) short = Math.max(short, l - smoothLift(k * bin));
          for (const [p, l] of need) short = Math.max(short, l - smoothLift(axis(p)));
          const lift = (sv) => smoothLift(sv) + short;
          const pos = geometry.attributes.position;
          const v2 = new THREE.Vector2();
          for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) + lift(axis(v2.set(pos.getX(i), pos.getZ(i)))));
          pos.needsUpdate = true;
          geometry.userData.resmooth?.();
        } else {
          geometry.translate(0, Math.max(...need.map(([, l]) => l)), 0);
        }
      }
    }

    if (surfaceAt) { // lofted solid: lift it just above whatever it overlaps
      let y0 = at;
      if (y0 === null) {
        y0 = -Infinity;
        for (const p of samples) {
          const under = hf.at(p.x, p.y), own = surfaceAt(p.x, p.y);
          if (under > -Infinity && Number.isFinite(own)) y0 = Math.max(y0, under + EPS - own);
        }
        if (!Number.isFinite(y0)) y0 = 0;
      }
      geometry.translate(0, y0, 0);
    }
    if (sw && !white) edgeBand(geometry, [outer, ...holes], sw);
    if (!geometry.userData.smoothNormals) geometry.computeVertexNormals();

    const droop = cfg.parts?.[el.id]?.droop;
    if (droop && !dome) {
      // tilt down about the root (the edge nearest the centre line)
      const box0 = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
      const side = Math.sign(box0.min.z + box0.max.z) || 1;
      const zRoot = side > 0 ? box0.min.z : box0.max.z, yRoot = (box0.min.y + box0.max.y) / 2;
      geometry.translate(0, -yRoot, -zRoot).rotateX(side * THREE.MathUtils.degToRad(droop)).translate(0, yRoot, zRoot);
      geometry.userData.resmooth?.();
    }
    const m = mesh(geometry, material, { cast: !white });
    root.add(m);
    made.set(el.id, [...(made.get(el.id) ?? []), m]);
    if (white && ell) {
      // a light: give the glowing dome a dark socket ring where it meets the surface
      const ring = new THREE.TorusGeometry(Math.min(ell.rx, ell.ry), 0.11, 10, 48).rotateX(Math.PI / 2)
        .translate(ell.cx, restOn(ell.cx + Math.min(ell.rx, ell.ry), ell.cy), ell.cy);
      const socket = mesh(ring, mats.metalDark);
      root.add(socket);
      made.get(el.id).push(socket);
    }
    if (at === null) hf.add(geometry);
    const box = new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
    if (!dome && !grey && !white) solids.push({ outer, area, geometry });
    // a gun: a grey block, longer front-to-back than wide, on the centre line
    if (!dome && grey && at === null && box.max.x - box.min.x > 1.6 * (box.max.z - box.min.z)
      && Math.abs((box.min.z + box.max.z) / 2) < 1.5) guns.push(box);
    return m;
  };

  // ---- stroke-only paths -> tubes -------------------------------------------
  const buildStroke = (pts, closed, el) => {
    const r = Math.max(el.strokeWidth, 0.15) / 2;
    let line;
    if (closed) {
      const c = pts.reduce((a, p) => a.add(p), new THREE.Vector2()).divideScalar(pts.length);
      const rad = Math.max(...pts.map((p) => p.distanceTo(c)));
      const h = hf.maxInCircle(c.x, c.y, rad + r);
      const y = (Number.isFinite(h) ? h : 0) + r + 0.05;
      rings.push({ c, rad: rad + r + 0.3, y });
      line = pts.map((p) => new THREE.Vector3(p.x, y, p.y));
    } else {
      const dense = densify(pts, 0.1);
      const ys = dense.map((p) => hf.sample(p.x, p.y));
      const onSurface = ys.filter(Number.isFinite).length / ys.length;
      if (onSurface > 0.95) {
        // a line drawn across a part: print it on, as a thin strip hugging the surface
        const g = ribbon(dense, el.strokeWidth || 0.3, (x, z) => hf.sample(x, z));
        root.add(mesh(g, roleStroke(el.stroke), { cast: false }));
        return;
      }
      // a free-standing line (a strut, a bar across an opening): a straight
      // rod. Built at the end, so crossing bars can share one height.
      freeBars.push({ a: dense[0], b: dense[dense.length - 1], r, y: Math.max(...ys.filter(Number.isFinite), 0) + r, el });
      return;
    }
    const g = tubeAlong(line, r, { closed, segments: Math.max(24, line.length * 2), radial: 10 });
    root.add(mesh(g, roleStroke(el.stroke)));
    // rings are structure later parts stand on; open lines are surface detail,
    // so they don't lift what comes after (crossing spokes would stack up)
    if (closed) hf.add(g);
  };

  const buildElement = (el, opts) => {
    const made = [];
    for (const sp of svg.subpaths(el.id)) {
      if (!el.fill && sp.points.length > 1) buildStroke(sp.points, sp.closed, el);
      else if (!sp.closed && el.stroke) buildStroke(sp.points, false, el);
    }
    if (el.fill) {
      for (const region of svg.regions(el.id, 220)) {
        if (Math.abs(signedArea(region.outline)) < 0.02) continue;
        made.push(buildRegion(region, el, opts));
      }
    }
    return made;
  };

  // ---- spinning groups ----------------------------------------------------------
  const rotorGroups = detectRotors(elements);
  const rotorBars = new Set(cfg.rotorBars ?? []); // lines that turn with the main rotor, as spokes
  const propGroups = (cfg.props ?? []).map((p) => ({ ...p }));
  const doneGroups = new Set();
  const motors = [];

  const buildProps = (pg) => {
    const members = elements.filter((e) => e.parent === pg.group);
    const pivots = pg.pivots
      ? pg.pivots.map((id) => svg.center(id))
      : svg.subpaths(pg.pivotSubpaths).filter((s) => s.closed).map((s) =>
        s.points.reduce((a, p) => a.add(p), new THREE.Vector2()).divideScalar(s.points.length));
    const blades = pivots.map(() => []);
    for (const el of members) {
      for (const region of svg.regions(el.id, 160)) {
        if (Math.abs(signedArea(region.outline)) < 0.01) continue;
        const c = region.outline.reduce((a, p) => a.add(p), new THREE.Vector2()).divideScalar(region.outline.length);
        let k = 0;
        pivots.forEach((pv, i) => { if (pv.distanceTo(c) < pivots[k].distanceTo(c)) k = i; });
        blades[k].push({ region, el });
      }
    }
    pivots.forEach((pv, k) => {
      if (!blades[k].length) return;
      const reach = Math.max(...blades[k].flatMap(({ region }) => region.outline.map((p) => p.distanceTo(pv)))) + 0.2;
      const below = hf.maxInCircle(pv.x, pv.y, reach);
      if (Number.isFinite(hf.sample(pv.x, pv.y))) motors.push(pv); // a pod under the hub: give it a leg
      const level = (Number.isFinite(below) ? below : 0) + 0.25;
      const group = new THREE.Group();
      group.position.set(pv.x, 0, pv.y);
      blades[k].forEach(({ region, el }, i) => {
        const m = buildRegion(region, el, { at: level + 0.12 });
        m.geometry.translate(-pv.x, 0, -pv.y);
        root.remove(m);
        group.add(m);
      });
      root.add(group);
      spinners.push({ group, speed: cfg.propSpeed ?? 7 }); // rad/s; well under the strobing point at 60 fps
      // later parts must clear the spinning disc
      hf.add(new THREE.CircleGeometry(reach, 48).rotateX(-Math.PI / 2).translate(pv.x, level + 0.3, pv.y));
    });
  };

  for (const el of elements) {
    if (rotorGroups.has(el.parent)) continue; // main rotors go on last, above everything
    if (rotorBars.has(el.id)) continue;
    const pg = propGroups.find((p) => p.group === el.parent);
    if (pg) {
      if (!doneGroups.has(pg.group)) { doneGroups.add(pg.group); buildProps(pg); }
      continue;
    }
    buildElement(el);
  }

  // ---- free-standing bars: crossing bars share one height ----------------------
  {
    const cross = (p, q) => segmentsCross(p.a, p.b, q.a, q.b);
    const groups = [];
    for (const bar of freeBars.filter((b) => !rotorBars.has(b.el.id))) {
      const hits = groups.filter((g) => g.some((o) => cross(o, bar)));
      const merged = [bar, ...hits.flat()];
      for (const h of hits) groups.splice(groups.indexOf(h), 1);
      groups.push(merged);
    }
    for (const g of groups) {
      let y = Math.max(...g.map((b) => b.y));
      const ring = rings.find((rg) => g.every((b) => b.a.distanceTo(rg.c) <= rg.rad && b.b.distanceTo(rg.c) <= rg.rad));
      if (ring) y = ring.y;
      for (const b of g) {
        const tube = tubeAlong([new THREE.Vector3(b.a.x, y, b.a.y), new THREE.Vector3(b.b.x, y, b.b.y)], b.r, { closed: false, segments: 8, radial: 14 });
        root.add(mesh(tube, roleStroke(b.el.stroke)));
      }
    }
  }

  // ---- details that don't show from above -------------------------------------
  // muzzle opening on the front of a forward gun
  for (const box of guns) {
    addMuzzle(root, mats, {
      x: box.max.x, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2,
      radius: Math.min(box.max.z - box.min.z, box.max.y - box.min.y) * 0.28,
    });
  }
  // landing legs under propeller craft's motor pods
  if (cfg.legs && motors.length && solids.length) {
    const low = Math.min(...solids.map((b) => new THREE.Box3().setFromBufferAttribute(b.geometry.attributes.position).min.y));
    for (const pv of motors) addLeg(root, mats, { x: pv.x, z: pv.y, topY: low + 0.6, groundY: low - 1.8 });
  }

  // ---- landing skids under the main body (rotor craft) -------------------------
  const rotors = [...rotorGroups.entries()];
  if (rotors.length && cfg.skids !== false && solids.length) {
    const body = solids.reduce((a, b) => (b.area > a.area ? b : a));
    const box = new THREE.Box3().setFromBufferAttribute(body.geometry.attributes.position);
    const L = box.max.x - box.min.x;
    const x0 = box.min.x + 0.25 * L, x1 = box.max.x - 0.25 * L;
    let wMin = Infinity, c = 0;
    for (let i = 0; i <= 10; i++) {
      const s = sliceAt(body.outer, THREE.MathUtils.lerp(x0, x1, i / 10));
      if (s.w < wMin) { wMin = s.w; c = s.c; }
    }
    addSkids(root, mats, {
      x0, x1, c, halfSpan: wMin * 0.55,
      bellyY: box.min.y + Math.min(1.2, (box.max.y - box.min.y) * 0.3), groundY: box.min.y - 1.6,
    });
  }

  // ---- main rotors -----------------------------------------------------------------
  let prevLevel = -Infinity;
  for (const [groupId, hubId] of rotors) {
    const pv = svg.center(hubId);
    const members = elements.filter((e) => e.parent === groupId);
    const reach = Math.max(...members.flatMap((e) => svg.outline(e.id, 32).map((p) => p.distanceTo(pv))));
    const below = hf.maxInCircle(pv.x, pv.y, reach);
    let level = (Number.isFinite(below) ? below : 0) + 0.9;
    if (level < prevLevel + 0.6) level = prevLevel + 0.6; // stack tandem rotors
    prevLevel = level;

    const mastFoot = hf.maxNear(pv.x, pv.y, 0.3);
    const foot = Number.isFinite(mastFoot) ? mastFoot - 0.3 : level - 1.5;
    addMast(root, mats, { x: pv.x, z: pv.y, footY: foot, topY: level });

    const group = new THREE.Group();
    group.position.set(pv.x, 0, pv.y);
    members.forEach((el, i) => {
      const isHub = el.id === hubId;
      for (const m of buildElement(el, { at: isHub ? level + 0.22 : level })) {
        m.geometry.translate(-pv.x, 0, -pv.y);
        root.remove(m);
        group.add(m);
      }
    });
    // extra spokes (cfg.rotorBars) at exactly the blades' height
    for (const id of rotorBars) {
      const el = elements.find((e) => e.id === id);
      for (const sp of svg.subpaths(id)) {
        const [a, b] = [sp.points[0], sp.points.at(-1)];
        const r = Math.max(el.strokeWidth, 0.15) / 2;
        const tube = tubeAlong([new THREE.Vector3(a.x - pv.x, level, a.y - pv.y), new THREE.Vector3(b.x - pv.x, level, b.y - pv.y)], r, { closed: false, segments: 8, radial: 14 });
        group.add(mesh(tube, roleStroke(el.stroke)));
      }
    }
    const blur = blurDisc(1.8, reach);
    blur.position.y = level - 0.06;
    group.add(blur);
    root.add(group);
    spinners.push({ group, speed: 9.5, blur });
  }

  // extra rotating parts (e.g. a marker light circling a disc)
  for (const sp of cfg.spin ?? []) {
    const pv = svg.center(sp.about);
    const group = new THREE.Group();
    group.position.set(pv.x, 0, pv.y);
    for (const id of sp.ids) {
      for (const m of made.get(id) ?? []) {
        m.geometry.translate(-pv.x, 0, -pv.y);
        root.remove(m);
        group.add(m);
      }
    }
    root.add(group);
    spinners.push({ group, speed: sp.speed ?? 1.5 });
  }
  cfg.extras?.({ root, mats, svg, hf, mesh, THREE });

  let spool = null;
  return {
    object: root,
    update(dt, t, state) {
      spool = THREE.MathUtils.damp(spool ?? (state.spin ? 1 : 0), state.spin ? 1 : 0, 1.6, dt);
      for (const s of spinners) {
        s.group.rotation.y -= dt * spool * s.speed;
        if (s.blur) s.blur.material.opacity = spool;
      }
    },
  };
}

function segmentsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return d(p1, p2, p3) * d(p1, p2, p4) < 0 && d(p3, p4, p1) * d(p3, p4, p2) < 0;
}

// Groups that look like a main rotor: several grey blade rects plus a hub circle.
function detectRotors(elements) {
  const byGroup = new Map();
  for (const e of elements) {
    if (!e.parent) continue;
    const g = byGroup.get(e.parent) ?? { rects: 0, hub: null };
    if (e.tag === 'rect' && e.fill === GREY) g.rects++;
    if (e.tag === 'circle' && e.fill === GREY) g.hub = e.id;
    byGroup.set(e.parent, g);
  }
  const rotors = new Map();
  for (const [id, g] of byGroup) if (g.rects >= 2 && g.hub) rotors.set(id, g.hub);
  return rotors;
}

// Frame aligned with a shape's main axis (snapped to the sprite axes when
// close), so lofts run along the length of diagonal blades and sideways wings.
export function principalFrame(poly, turn = 0) {
  const c = poly.reduce((a, p) => a.add(p), new THREE.Vector2()).divideScalar(poly.length);
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of poly) { const dx = p.x - c.x, dy = p.y - c.y; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const elongated = Math.abs(sxx - syy) > 0.15 * (sxx + syy) || Math.abs(sxy) > 0.1 * (sxx + syy);
  const deg = THREE.MathUtils.radToDeg(angle);
  if (!elongated || Math.abs(deg) < 10) angle = 0;
  else if (Math.abs(Math.abs(deg) - 90) < 10) angle = Math.sign(deg) * Math.PI / 2;
  angle += turn;
  const cs = Math.cos(angle), sn = Math.sin(angle);
  return {
    angle,
    toLocal: (p) => new THREE.Vector2((p.x - c.x) * cs + (p.y - c.y) * sn, -(p.x - c.x) * sn + (p.y - c.y) * cs),
    toWorld: (p) => new THREE.Vector2(c.x + p.x * cs - p.y * sn, c.y + p.x * sn + p.y * cs),
    matrix: new THREE.Matrix4().set(cs, 0, -sn, c.x, 0, 1, 0, 0, sn, 0, cs, c.y, 0, 0, 0, 1),
  };
}

// Profile for round parts, t = 0 (centre) .. 1 (rim): an upright rim of
// height wall*H, a rounded shoulder of radius `rim`, then a gentle dome.
function shoulder(H, rim, r, wall) {
  const t0 = Math.max(0.05, 1 - rim / r);
  const hw = wall * H;
  const hs = Math.min(rim, H - hw);
  const hd = Math.max(0, H - hw - hs);
  return (t) => (t >= t0
    ? hw + hs * Math.sqrt(Math.max(0, 1 - ((t - t0) / (1 - t0)) ** 2))
    : hw + hs + hd * (1 - (t / t0) ** 2) ** 2);
}

// Axis-aligned ellipse matching an outline, or null if it isn't one.
function ellipseFit(poly) {
  const b = new THREE.Box2().setFromPoints(poly);
  const rx = (b.max.x - b.min.x) / 2, ry = (b.max.y - b.min.y) / 2;
  const ideal = Math.PI * rx * ry;
  if (Math.abs(Math.abs(signedArea(poly)) - ideal) / ideal > 0.04) return null;
  return { cx: (b.min.x + b.max.x) / 2, cy: (b.min.y + b.max.y) / 2, rx, ry };
}

// Round part built ring by ring. top(t)/bottom(t) give heights from the centre
// (t = 0) to the rim (t = 1); a non-zero height at t = 1 makes an upright wall.
// dome: top only, resting on base(x, z).
function radialPart(ell, { top, bottom, dome, base, band }) {
  const r = Math.min(ell.rx, ell.ry);
  const ts = new Set([1]);
  for (let k = 1; k < 56; k++) ts.add(1 - (1 - k / 56) ** 1.7);
  if (band) for (const f of [0.6, 0.85, 1, 1.15, 1.5]) { const t = 1 - (band * f) / r; if (t > 0.04) ts.add(t); }
  const T = [...ts].sort((a, b) => a - b);
  const S = 192;
  const pos = [];
  const ring = (t, y) => {
    const start = pos.length / 3;
    for (let j = 0; j < S; j++) {
      const a = (j / S) * Math.PI * 2;
      const x = ell.cx + ell.rx * t * Math.cos(a), z = ell.cy + ell.ry * t * Math.sin(a);
      pos.push(x, y(t, x, z), z);
    }
    return start;
  };
  const cap = (h) => {
    const c = pos.length / 3;
    pos.push(ell.cx, h(0, ell.cx, ell.cy), ell.cy);
    return [c, T.map((t) => ring(t, h))];
  };
  const index = [];
  const surface = ([c, rings], up) => {
    const faces = [];
    for (let j = 0; j < S; j++) faces.push([c, rings[0] + j, rings[0] + ((j + 1) % S)]);
    for (let k = 0; k < rings.length - 1; k++) {
      for (let j = 0; j < S; j++) {
        const a = rings[k] + j, b = rings[k] + ((j + 1) % S), d = rings[k + 1] + j, e = rings[k + 1] + ((j + 1) % S);
        faces.push([a, d, b], [b, d, e]);
      }
    }
    // a, d, b runs counter-clockwise seen from below (z = svg y); flip for up
    for (const [a, b, c2] of faces) index.push(...(up ? [a, c2, b] : [a, b, c2]));
  };
  const topH = dome ? (t, x, z) => base(x, z) + top(t) : (t) => top(t);
  const upper = cap(topH);
  surface(upper, true);
  if (!dome) {
    const lower = cap((t) => -bottom(t));
    const wall = top(1) + bottom(1) > 1e-3;
    if (!wall) lower[1][lower[1].length - 1] = upper[1].at(-1); // shared rim: smooth all round
    surface(lower, false);
    if (wall) { // upright wall between the two rims
      const a0 = upper[1].at(-1), b0 = lower[1].at(-1);
      for (let j = 0; j < S; j++) {
        const a = a0 + j, b = a0 + ((j + 1) % S), c = b0 + j, d = b0 + ((j + 1) % S);
        index.push(a, b, c, b, d, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// How much bigger a loft of this outline would be than the outline itself
// (1 = exact; a loft fills any notch between a slice's extremes).
function loftExcess(poly) {
  const xs = poly.map((p) => p.x);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const n = 120;
  let filled = 0;
  for (let k = 0; k < n; k++) filled += 2 * sliceAt(poly, x0 + (x1 - x0) * (k + 0.5) / n).w * (x1 - x0) / n;
  return filled / Math.max(Math.abs(signedArea(poly)), 1e-6);
}

function samplesIn(outer, holes, step) {
  const box = new THREE.Box2().setFromPoints(outer);
  const loops = [outer, ...holes];
  const out = [];
  for (let x = box.min.x + step / 2; x < box.max.x; x += step) {
    for (let y = box.min.y + step / 2; y < box.max.y; y += step) {
      let c = false;
      for (const l of loops) {
        for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
          if ((l[i].y > y) !== (l[j].y > y) && x < (l[j].x - l[i].x) * (y - l[i].y) / (l[j].y - l[i].y) + l[i].x) c = !c;
        }
      }
      if (c) out.push(new THREE.Vector2(x, y));
    }
  }
  if (!out.length) out.push(outer.reduce((a, p) => a.add(p), new THREE.Vector2()).divideScalar(outer.length));
  return out;
}

function distTo(p, loops) {
  let best = Infinity;
  for (const l of loops) {
    for (let i = 0; i < l.length; i++) {
      const a = l[i], b = l[(i + 1) % l.length];
      const ex = b.x - a.x, ey = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey || 1)));
      best = Math.min(best, Math.hypot(p.x - a.x - ex * t, p.y - a.y - ey * t));
    }
  }
  return best;
}

// Flat strip of the given width along a top-view polyline, draped just above
// surface(x, z): a printed line.
function ribbon(pts, width, surface) {
  const pos = [];
  const lift = 0.035;
  const fallback = (x, z) => { const h = surface(x, z); return Number.isFinite(h) ? h : 0; };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const t = b.clone().sub(a).normalize();
    const nx = -t.y * width / 2, nz = t.x * width / 2;
    const p = pts[i];
    for (const s of [-1, 1]) {
      const x = p.x + s * nx, z = p.y + s * nz;
      pos.push(x, Math.max(fallback(x, z), fallback(p.x, p.y) - width) + lift, z);
    }
  }
  const index = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = 2 * i, b = a + 1, c = a + 2, d = a + 3;
    index.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // face the strip upwards whichever way the line runs
  if (g.attributes.normal.getY(0) < 0) {
    index.reverse();
    g.setIndex(index);
    g.computeVertexNormals();
  }
  return g;
}

function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / step));
    for (let k = 1; k <= n; k++) out.push(a.clone().lerp(b, k / n));
  }
  return out;
}
