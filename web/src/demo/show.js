import * as THREE from 'three';
import { PAD_GAP, PAD_COLS } from './world.js';
import { attitude, separate } from './flight.js';
import { patchRise, riseUniforms, craftMaterials, startPark, stepPark, setStyle } from './fleet.js';
import { pose, cutList } from './camera.js';
import { Beam } from './fx.js';
import { TEAM_COLORS } from '../palette.js';

// The show: a fixed-step, deterministic simulation (so ?demo=<seconds> can
// fast-forward to any moment) plus, per rendered frame, the camera, effects
// and captions as functions of show time.

export const STEP = 1 / 60;
export const END = 128;
export const CHAPTERS = [
  [0, 'Lights out'], [7, 'Roll call'], [46, 'Paint shop'], [56, 'Formation'],
  [78, 'Solo display'], [93, 'Dogfight'], [111, 'Dawn'],
];

// key times
const TT = {
  ignite: 0.8, sprites: 1.6, roll: 7, paint: 46, wave: 47.5, form: 56, morph: 64.5, burst: 74.5,
  stunts: 78, loop: 80, barrel: 86, pass: 88.6, fightIn: 90, dog: 93, dogEnd: 109.5, dawn: 111,
  land: 116.6, park: 119.6, snap: 120.5, flash: 121, dolly: 121.4, ortho: 123.2,
  wipe1: 123.6, wipe2: 125.4, wipe3: 126.3, wipe4: 127.7,
};
const RING = { r: 150, h: 72, w: 0.2 };
const AUDIENCE = { r: 290, h: 150, w: 0.11 };
const UP = new THREE.Vector3(0, 1, 0);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const keyed = (T, keys) => {
  if (T <= keys[0][0]) return keys[0][1];
  for (let k = 0; k + 1 < keys.length; k++) {
    if (T <= keys[k + 1][0]) return THREE.MathUtils.lerp(keys[k][1], keys[k + 1][1], smooth(keys[k][0], keys[k + 1][0], T));
  }
  return keys.at(-1)[1];
};
function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hex = (c) => `#${c.getHexString()}`;

// The formation's reference: a constant-speed lap of an oval, with a height
// profile (dip for the low pass, pull-up before the burst).
class FormationPath {
  constructor() {
    this.A = 330;
    this.B = 230;
    this.v = 58;
    this.t0 = TT.form - 2;
    this.th = [];
    let th = 2.7;
    for (let k = 0; k < (TT.stunts + 4 - this.t0) * 60; k++) {
      this.th.push(th);
      th += STEP * this.v / Math.hypot(this.A * Math.sin(th), this.B * Math.cos(th));
    }
    this.heights = [[TT.form, 64], [61, 64], [64.6, 40], [67.2, 40], [69.5, 56], [72, 60], [TT.burst, 128]];
  }

  pos(T, out = V()) {
    const f = Math.min(Math.max((T - this.t0) * 60, 0), this.th.length - 1.001);
    const k = Math.floor(f), th = THREE.MathUtils.lerp(this.th[k], this.th[k + 1], f - k);
    return out.set(this.A * Math.cos(th), keyed(T, this.heights), this.B * Math.sin(th));
  }

  dir(T, out = V()) {
    out.subVectors(this.pos(T + 0.05), this.pos(T - 0.05));
    out.y = 0;
    return out.normalize();
  }
}

// Pairs each of a's slots with one of b's, closest pairs first.
function greedyMatch(a, b) {
  const pairs = [];
  a.forEach((p, i) => b.forEach((q, j) => pairs.push([p.distanceTo(q), i, j])));
  pairs.sort((x, y) => x[0] - y[0]);
  const out = new Array(a.length), usedB = new Set();
  for (const [, i, j] of pairs) {
    if (out[i] !== undefined || usedB.has(j)) continue;
    out[i] = j;
    usedB.add(j);
  }
  return out;
}

// Formation layouts: offsets (forward, up, right) per slot.
function arrowhead(n) {
  return Array.from({ length: n }, (_, k) => {
    if (!k) return V(0, 0, 0);
    const rank = Math.ceil(k / 2), side = k % 2 ? 1 : -1;
    return V(-rank * 27, rank * 1.2, side * rank * 30);
  });
}
function diamond(n) {
  const peak = Math.max(1, Math.round(Math.sqrt(n)));
  const rows = [];
  for (let c = 1, left = n; left > 0;) {
    rows.push(Math.min(c, left));
    left -= rows.at(-1);
    if (rows.length < peak) c++; else if (rows.length > peak) c = Math.max(1, c - 1);
  }
  const out = [];
  rows.forEach((cnt, r) => { for (let j = 0; j < cnt; j++) out.push(V(-r * 27, r * 2.2, (j - (cnt - 1) / 2) * 31)); });
  return out;
}

export class Show {
  constructor({ fleet, world, fx, audio, quality }) {
    this.fleet = fleet;
    this.world = world;
    this.fx = fx;
    this.audio = audio;
    this.N = fleet.length;
    this.n = 0; // steps taken
    this.T = 0;
    this.rand = rng(20261124);
    this.path = new FormationPath();
    this.push = fleet.map(() => V());
    this.beams = Array.from({ length: 4 }, () => new Beam(world.scene));
    const base = quality === 'high' ? 'glossy' : 'matte';
    const rows = Math.ceil(this.N / PAD_COLS);
    const arrow = arrowhead(this.N), dia = diamond(this.N);

    const byNo = (no, fallback) => fleet.find((c) => c.no === no) ?? fleet[fallback % this.N];
    this.loopCraft = byNo(1, 0);
    this.barrelCraft = byNo(17, 15);
    this.passCraft = [byNo(3, 2), byNo(13, 12)];
    this.attackers = [byNo(5, 4), byNo(6, 5), byNo(11, 10)];
    this.defenders = [byNo(9, 8), byNo(12, 11), byNo(55, 18)];
    this.fighters = new Set([...this.attackers, ...this.defenders]);
    this.teams = { attack: TEAM_COLORS[3], defend: TEAM_COLORS[0] }; // Orange vs Blue

    // reveal schedule: the first two slowly, a montage, then the last five
    const slow = (i) => i < 2 || i >= this.N - 5;
    const montage = [];
    for (let i = 2; i < this.N - 5; i++) montage.push(i);
    const mStep = montage.length > 1 ? Math.min(1, 12 / (montage.length - 1)) : 1;

    fleet.forEach((c, i) => {
      setStyle(c, base);
      c.styles.setTint(c.colour);
      c.tint = { body: new THREE.Color(c.colour.body), trim: new THREE.Color(c.colour.trim) };
      c.pad = V(((i % PAD_COLS) - 2) * PAD_GAP, 0, (Math.floor(i / PAD_COLS) - (rows - 1) / 2) * PAD_GAP);
      c.landed = c.pad.clone().setY(c.halfHeight);
      world.pads[i]?.position.set(c.pad.x, 0.06, c.pad.z);
      const t0 = i === 0 ? 7.4 : i === 1 ? 11.4 : slow(i) ? 30.2 + (i - (this.N - 5)) * 3 : 15.2 + montage.indexOf(i) * mStep;
      const s = slow(i);
      const sweep0 = t0 + 0.25, sweepDur = s ? 1.5 : 0.75;
      c.rv = { t0, slow: s, sweep0, sweepDur, sweepEnd: sweep0 + sweepDur, spin: sweep0 + sweepDur + 0.15, lift: t0 + (s ? 3 : 1.75) };
      c.beamX0 = c.pad.x + c.minX - 3;
      c.beamX1 = c.pad.x + c.maxX + 3;
      // rise effect on this craft's materials (shared uniforms, patched once per visit)
      c.U ??= riseUniforms();
      c.U.uRiseOn.value = 0;
      for (const m of craftMaterials(c)) patchRise(m, c.U);
      // shadows only once it has lifted off (its shadow would give it away)
      c.casters ??= [];
      if (!c.casters.length) c.root.traverse((o) => { if (o.isMesh && o.castShadow) c.casters.push(o); });
      c.casters.forEach((o) => { o.castShadow = false; });
      // the flat sprite on its pad
      const fp = c.footprint;
      c.clip = new THREE.Plane(V(1, 0, 0), 1e9);
      c.spriteMesh = new THREE.Mesh(new THREE.PlaneGeometry(fp.w, fp.h).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
        map: c.sprite, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, fog: false, clippingPlanes: [c.clip],
      }));
      c.spriteMesh.position.set(c.pad.x + fp.x, 0.14, c.pad.z + fp.z);
      c.spriteMesh.renderOrder = 1;
      world.scene.add(c.spriteMesh, c.root);
      c.root.visible = false;
      c.root.position.copy(c.landed);
      c.root.quaternion.identity();
      // authoritative pose per step; the root is set between steps per frame
      c.curPos = c.landed.clone();
      c.prevPos = c.landed.clone();
      c.curQuat = new THREE.Quaternion();
      c.prevQuat = new THREE.Quaternion();
      c.spinning = false;
      c.park = null;
      c.snap = null;
      c.state = 'hidden';
      c.whooshAt = -10;
      c.hitAt = -10;
      c.fireAt = -10;
      c.slot = { arrow: arrow[i], diamond: dia[i] }; // reassigned when forming up
      c.ringPhase = (i / this.N) * Math.PI * 2;
      c.hover = 28 + (i % PAD_COLS) * 7 + Math.floor(i / PAD_COLS) * 3;
      Object.assign(c.flyer, { mode: 'parked', maxSpeed: 95, maxAcc: 75, floor: c.halfHeight + 6, half: c.halfHeight });
      c.flyer.pos.copy(c.landed);
      c.flyer.vel.set(0, 0, 0);
      c.flyer.quat.identity();
    });
    // diamond slots matched to arrowhead slots by distance, so the change of
    // shape moves every craft the shortest way and nobody crosses
    this.arrow = arrow;
    this.diaOf = greedyMatch(arrow, dia);
    this.dia = dia;
    this.arrowOwner = fleet.slice();
    this.#buildShots();
  }

  // Forming up: the leader (skin 1) takes the point; every other arrowhead slot
  // goes to the nearest free craft (closest pairs first).
  #assignSlots(T) {
    const slots = this.arrow.map((off, k) => ({ k, pos: this.#slotWorld(off, T + 2.5) }));
    const lead = this.fleet[0];
    const pairs = [];
    for (const c of this.fleet) {
      if (c === lead) continue;
      for (const s of slots) if (s.k > 0) pairs.push([c.curPos.distanceTo(s.pos), c, s.k]);
    }
    pairs.sort((x, y) => x[0] - y[0]);
    const takenC = new Set([lead]), takenS = new Set([0]);
    const owner = [lead];
    for (const [, c, k] of pairs) {
      if (takenC.has(c) || takenS.has(k)) continue;
      takenC.add(c);
      takenS.add(k);
      owner[k] = c;
    }
    owner.forEach((c, k) => { c.slot = { arrow: this.arrow[k], diamond: this.dia[this.diaOf[k]] }; });
    this.arrowOwner = owner;
    this.diamondOwner = [];
    owner.forEach((c, k) => { this.diamondOwner[this.diaOf[k]] = c; });
  }

  #slotWorld(off, T) {
    const ref = this.path.pos(T), dir = this.path.dir(T);
    return ref.addScaledVector(dir, off.x).addScaledVector(UP, off.y).addScaledVector(V(-dir.z, 0, dir.x), off.z);
  }

  // ------------------------------------------------------------ targets
  ringPos(c, T) {
    const a = RING.w * T + c.ringPhase;
    return V(RING.r * Math.cos(a), RING.h + 4 * Math.sin(T * 0.7 + c.i), RING.r * Math.sin(a));
  }

  audiencePos(c, T) {
    const a = AUDIENCE.w * T + c.ringPhase;
    return V(AUDIENCE.r * Math.cos(a), AUDIENCE.h + c.i * 4 + 3 * Math.sin(T * 0.5 + c.i), AUDIENCE.r * Math.sin(a));
  }

  formationPos(c, T) {
    const ref = this.path.pos(T), dir = this.path.dir(T);
    const right = V(-dir.z, 0, dir.x); // forward x up: the formation's right
    const off = c.slot.arrow.clone().lerp(c.slot.diamond, smooth(TT.morph, TT.morph + 3, T));
    return ref.addScaledVector(dir, off.x).addScaledVector(UP, off.y).addScaledVector(right, off.z);
  }

  burstPos(c, T) {
    const t = Math.max(0, T - TT.burst);
    const R = 330 * (1 - Math.exp(-t / 1.3)), H = 75 * (1 - Math.exp(-t / 0.8)) - 9 * t;
    return c.burstFrom.clone().addScaledVector(c.burstDir, R).addScaledVector(UP, H);
  }

  // dogfight: each defender flies its own looping path; its attacker chases
  // along the same path 0.75 s behind
  defenderPos(k, T) {
    const t = T - TT.dog;
    return V(
      190 * Math.sin(0.42 * t + k * 2.1),
      60 + 22 * Math.sin(0.7 * t + k * 1.7),
      165 * Math.sin(0.4 * t + k * 1.3 + 0.8),
    );
  }

  // home: each craft comes over its pad at a height of its own (a stack, so
  // no two paths meet), then drops straight down into place
  padPos(c, T) {
    const t0 = TT.land - 0.8 + c.i * 0.05;
    const y = THREE.MathUtils.lerp(40 + c.i * 7, c.halfHeight, smooth(t0, t0 + 3.2, T));
    return c.pad.clone().setY(y);
  }

  // the target function for a steering craft at time T
  targetFn(c, T) {
    if (T < c.rv.lift + 1.4) return () => c.pad.clone().setY(42 + (c.i % 3) * 6);
    if (T < TT.form) return (t) => this.ringPos(c, t);
    if (T < TT.burst) return (t) => this.formationPos(c, t);
    // the leader peels away at the burst to line up for its loop
    if (c === this.loopCraft && T < TT.loop) return (t) => V(-96 - 60 * (TT.loop - t), 40, 0);
    if (T < TT.stunts) return (t) => this.burstPos(c, t);
    if (c === this.barrelCraft && T > 81 && T < TT.barrel) return (t) => this.barrelStart.clone().addScaledVector(this.barrelDir, 65 * (t - TT.barrel));
    if (this.passCraft.includes(c) && T > 82.5 && T < TT.pass) return () => (c === this.passCraft[0] ? V(-330, 30, 14) : V(330, 37, -14));
    if (this.fighters.has(c) && T >= TT.fightIn && T < TT.dogEnd) {
      const a = this.attackers.indexOf(c), d = this.defenders.indexOf(c);
      if (d >= 0) return (t) => this.defenderPos(d, t);
      return (t) => this.defenderPos(a, t - 0.75).add(V(0, 4, 0));
    }
    if (T < TT.dawn) return (t) => this.audiencePos(c, t);
    return (t) => this.padPos(c, t);
  }

  // ------------------------------------------------------------ scripted moves
  loopPath() {
    const R = 45, v = 60, Tl = (2 * Math.PI * R) / v, a = 96 / v;
    const fwd = V(), up = V();
    return {
      duration: 2 * a + Tl,
      path: (t, pos, quat) => {
        if (t < a) { pos.set(-96 + v * t, 40, 0); fwd.set(1, 0, 0); up.set(0, 1, 0); } else if (t < a + Tl) {
          const b = ((t - a) / Tl) * Math.PI * 2;
          pos.set(R * Math.sin(b), 40 + R * (1 - Math.cos(b)), 0);
          fwd.set(Math.cos(b), Math.sin(b), 0);
          up.set(-Math.sin(b), Math.cos(b), 0);
        } else { pos.set(v * (t - a - Tl), 40, 0); fwd.set(1, 0, 0); up.set(0, 1, 0); }
        attitude(fwd, up, quat);
      },
    };
  }

  barrelPath() {
    const d = this.barrelDir, S = this.barrelStart, speed = 65, rad = 11;
    const right = V().crossVectors(d, UP).normalize();
    const at = (t) => {
      const ph = Math.PI * 2 * smooth(1.6, 4.0, t);
      return S.clone().addScaledVector(d, speed * t)
        .addScaledVector(right, rad * Math.sin(ph)).addScaledVector(UP, rad * (1 - Math.cos(ph)));
    };
    return {
      duration: 6,
      path: (t, pos, quat) => {
        pos.copy(at(t));
        const fwd = at(t + 0.02).sub(at(t - 0.02));
        const ph = Math.PI * 2 * smooth(1.6, 4.0, t);
        const up = UP.clone().multiplyScalar(Math.cos(ph)).addScaledVector(right, -Math.sin(ph));
        attitude(fwd, up, quat);
      },
    };
  }

  passPath(k) {
    const sgn = k === 0 ? 1 : -1, y = k === 0 ? 30 : 37, z = k === 0 ? 14 : -14;
    return {
      duration: 5.5,
      path: (t, pos, quat) => {
        pos.set(sgn * (-330 + 120 * t), y, z);
        attitude(V(sgn, 0, 0), UP, quat);
      },
    };
  }

  // ------------------------------------------------------------ the fixed step
  step() {
    const prev = this.T;
    for (const c of this.fleet) { c.prevPos.copy(c.curPos); c.prevQuat.copy(c.curQuat); }
    this.n++;
    const T = (this.T = this.n / 60);
    const at = (t) => prev < t && t <= T;
    const { fx, audio, world } = this;

    // events -----------------------------------------------------
    if (at(TT.ignite)) audio.swell();
    if (at(TT.form)) this.#assignSlots(T);
    if (at(TT.burst)) {
      const from = this.path.pos(TT.burst), dir = this.path.dir(TT.burst);
      this.burstPoint = from.clone();
      this.burstDir = dir.clone();
      for (const c of this.fleet) {
        const off = c.flyer.pos.clone().sub(from).setY(0);
        if (off.length() < 5) off.copy(dir);
        c.burstFrom = c.flyer.pos.clone();
        c.burstDir = off.normalize();
      }
      audio.boom();
    }
    if (at(76)) {
      this.barrelDir = V(-1, 0, -0.38).normalize();
      this.barrelStart = V(215, 58, 105);
    }
    const fly = (c, m, blend) => c.flyer.fly(m.path, m.duration, blend);
    if (at(TT.loop)) fly(this.loopCraft, this.loopPath(), 1.2);
    if (at(TT.barrel)) fly(this.barrelCraft, this.barrelPath(), 1.0);
    if (at(TT.pass)) this.passCraft.forEach((c, k) => fly(c, this.passPath(k), 1.5));
    if (at(TT.wave)) audio.shimmer();
    if (at(TT.dog) || at(TT.dogEnd)) audio.zap();
    if (at(TT.flash)) this.#toSprite();

    // trails on / off --------------------------------------------
    const smoke = (c) => {
      if (T >= TT.form + 0.5 && T < TT.stunts + 0.6) return 1.4;
      if (c === this.loopCraft && T >= 79.4 && T < 88.2) return 1.4;
      if (c === this.barrelCraft && T >= 85.6 && T < 92.4) return 1.4;
      if (this.passCraft.includes(c) && T >= 88.8 && T < 94.2) return 1.4;
      if (this.fighters.has(c) && T >= TT.dog + 0.3 && T < TT.dogEnd) return 0.9;
      return 0;
    };

    // colours: paint wave, dogfight team paint ---------------------
    if (T >= TT.wave && T < TT.wave + 12) {
      for (const c of this.fleet) {
        const p = (T - TT.wave) * 2.6 - c.i * 0.6;
        if (p < 0 || p >= 12.5) { this.#tint(c, c.colour.body, c.colour.trim); continue; }
        const q = Math.min(p, 12), k = Math.floor(q), f = q - k;
        const a = TEAM_COLORS[(c.colourIndex + k) % 12], b = TEAM_COLORS[(c.colourIndex + k + 1) % 12];
        // round the hue wheel, so in-between colours stay vivid (no browns/greys)
        this.#tint(c, new THREE.Color(a.body).lerpHSL(new THREE.Color(b.body), f), new THREE.Color(a.trim).lerpHSL(new THREE.Color(b.trim), f));
      }
    }
    for (const [t0, toTeam] of [[TT.dog, true], [TT.dogEnd, false]]) {
      if (T < t0 || T > t0 + 0.6) continue;
      for (const c of this.fighters) {
        const team = this.attackers.includes(c) ? this.teams.attack : this.teams.defend;
        const [from, to] = toTeam ? [c.colour, team] : [team, c.colour];
        const w = new THREE.Color('#ffffff');
        const s = T - t0;
        const body = s < 0.15 ? new THREE.Color(from.body).lerp(w, s / 0.15) : w.clone().lerp(new THREE.Color(to.body), smooth(0.15, 0.5, s));
        const trim = s < 0.15 ? new THREE.Color(from.trim).lerp(w, s / 0.15) : w.clone().lerp(new THREE.Color(to.trim), smooth(0.15, 0.5, s));
        this.#tint(c, body, trim);
      }
    }

    // craft ----------------------------------------------------------
    for (const c of this.fleet) {
      const rv = c.rv, f = c.flyer;
      if (c.state === 'hidden' && T >= rv.t0) {
        c.state = 'reveal';
        c.root.visible = true;
        audio.scan(rv.sweepDur);
      }
      if (c.state === 'reveal') {
        // the beam sweeps tail to nose; behind it the craft appears and
        // swells from flat to full height (a little overshoot, then settles)
        const bx = c.beamX0 + (c.beamX1 - c.beamX0) * Math.min(1.2, (T - rv.sweep0) / rv.sweepDur);
        c.U.uBeamX.value = T < rv.sweep0 ? -1e9 : bx;
        const s = smooth(rv.sweep0, rv.sweepEnd + 0.4, T), km = s - 1;
        c.U.uRiseK.value = 0.06 + 0.94 * (1 + 2.36 * km * km * km + 1.36 * km * km);
        c.U.uRiseOn.value = T < rv.sweepEnd + 0.45 ? 1 : 0;
        c.clip.constant = T < rv.sweep0 ? 1e9 : -bx;
        c.spriteMesh.visible = T < rv.sweepEnd + 0.05;
        if (at(rv.sweepEnd)) audio.thump();
        c.spinning = T >= rv.spin;
        c.curPos.copy(c.landed).setY(c.halfHeight + 2.4 * smooth(rv.spin + 0.25, rv.lift, T));
        if (T >= rv.lift) {
          c.state = 'flying';
          c.U.uRiseOn.value = 0;
          c.spriteMesh.visible = false;
          f.pos.copy(c.curPos);
          f.vel.set(0, 8, 0);
          Object.assign(f, { mode: 'steer', heading: 0, bank: 0, pitch: 0, face: 0 });
          c.casters.forEach((o) => { o.castShadow = true; });
          world.ring(c.pad.x, c.pad.z, T, 1.2);
          audio.liftoff(c.pad.x / 200);
        }
      }
      if (c.state === 'flying' && f.mode !== 'script') {
        const fn = this.targetFn(c, T);
        f.target.copy(fn(T));
        f.targetVel.copy(fn(T + 0.04)).sub(fn(T - 0.04)).divideScalar(0.08);
        const fighting = this.fighters.has(c) && T >= TT.fightIn && T < TT.dogEnd;
        f.maxSpeed = fighting ? 125 : T >= TT.form && T < TT.stunts ? 112 : 95;
        f.maxAcc = fighting ? 115 : 80;
        f.floor = T >= TT.land - 1 ? c.halfHeight : c.halfHeight + 6;
        if (T >= TT.snap) {
          c.state = 'landed';
          f.mode = 'parked';
          c.snap = { t: 0, pos: f.pos.clone(), quat: f.quat.clone() };
        }
      }
    }

    // flight ---------------------------------------------------------
    separate(this.fleet.map((c) => c.flyer), this.push);
    this.fleet.forEach((c, i) => {
      const f = c.flyer;
      if (c.state === 'flying') {
        f.step(STEP, this.push[i]);
        c.curPos.copy(f.pos);
        c.curQuat.copy(f.quat);
      } else if (c.state === 'landed') {
        c.snap.t += STEP;
        const s = smooth(0, 0.6, c.snap.t);
        c.curPos.lerpVectors(c.snap.pos, c.landed, s);
        c.curQuat.slerpQuaternions(c.snap.quat, new THREE.Quaternion(), s);
      }
      // rotors: spin, then park at rest for the sprite match
      if (!c.park && T >= TT.park + c.i * 0.03) startPark(c, STEP, T);
      if (c.park) stepPark(c, STEP); else c.model.update(STEP, T, { spin: c.spinning });
      // smoke
      const w = c.state === 'flying' ? smoke(c) : 0;
      fx.trails.emit(i, w > 0, c.tint.body);
      fx.trails.list[i].width = w || 1.4;
      if (w > 0) fx.trails.step(i, c.curPos.clone().addScaledVector(f.forward, -c.size.x * 0.42), T);
    });

    // dogfight -------------------------------------------------------
    if (T >= TT.dog + 0.4 && T < TT.dogEnd - 0.3) this.#fight(T);
    fx.tracers.step(STEP);
    this.#hits(T);
    fx.sparks.step(STEP);
    fx.puffs.step(STEP);
  }

  #tint(c, body, trim) {
    const b = new THREE.Color(body), t = new THREE.Color(trim);
    if (b.equals(c.tint.body) && t.equals(c.tint.trim)) return;
    c.tint.body.copy(b);
    c.tint.trim.copy(t);
    c.styles.setTint({ body: hex(b), trim: hex(t) });
  }

  #fight(T) {
    const { fx, audio } = this;
    this.attackers.forEach((A, k) => {
      const D = this.defenders[k];
      const to = D.flyer.pos.clone().sub(A.flyer.pos);
      const dist = to.length();
      const fwd = A.flyer.forward;
      if (dist > 190 || fwd.dot(to) / dist < 0.982 || T - A.fireAt < 0.08) return;
      A.fireAt = T;
      const colour = new THREE.Color(3.2, 1.45, 0.35);
      for (const m of A.muzzles.slice(0, 2)) {
        const from = m.clone().applyQuaternion(A.flyer.quat).add(A.flyer.pos);
        const dir = fwd.clone().add(V((this.rand() - 0.5) * 0.025, (this.rand() - 0.5) * 0.025, (this.rand() - 0.5) * 0.025)).normalize();
        fx.tracers.fire(from, dir, 430 + A.flyer.vel.length(), colour, k);
      }
      if (T - (this.tracerSound ?? -1) > 0.11) { audio.tracer(); this.tracerSound = T; }
    });
  }

  #hits(T) {
    const { fx, audio } = this;
    for (const tr of fx.tracers.items) {
      const D = this.defenders[tr.owner];
      if (!D || tr.life <= 0) continue;
      if (tr.pos.distanceTo(D.flyer.pos) > D.flyer.radius * 1.1) continue;
      tr.life = 0;
      for (let s = 0; s < 14; s++) {
        const v = V(this.rand() - 0.5, this.rand() - 0.3, this.rand() - 0.5).normalize().multiplyScalar(30 + this.rand() * 60);
        fx.sparks.spawn({
          pos: tr.pos.clone(), vel: v.addScaledVector(D.flyer.vel, 0.6), life: 0.35 + this.rand() * 0.35,
          size: 1.2 + this.rand() * 1.4, colour: new THREE.Color(3.4, 2.2 + this.rand(), 0.9), gravity: 50, drag: 0.92,
        });
      }
      if (T - D.hitAt > 0.6) {
        D.hitAt = T;
        D.flyer.hit();
        for (let s = 0; s < 3; s++) {
          fx.puffs.spawn({
            pos: tr.pos.clone().add(V(this.rand() * 4 - 2, this.rand() * 4 - 2, this.rand() * 4 - 2)),
            vel: D.flyer.vel.clone().multiplyScalar(0.25).add(V(0, 5, 0)), life: 1.5, size: 5 + this.rand() * 3, grow: 12,
            colour: new THREE.Color(0.32, 0.33, 0.4), alpha: 0.75, drag: 0.96,
          });
        }
        audio.hit();
      }
    }
  }

  #toSprite() {
    this.world.spriteLighting();
    for (const c of this.fleet) {
      setStyle(c, 'sprite');
      c.U.uRiseOn.value = 0;
    }
    this.fx.trails.clear();
    this.audio.chime();
  }

  // ------------------------------------------------------------ camera
  #buildShots() {
    const F = this.fleet, path = this.path;
    const at = (c) => c.root.position.clone();
    const closeUp = (c, fov = 34) => (T) => {
      const a = 0.75 + 0.05 * (T - c.rv.t0);
      const k = smooth(c.rv.lift - 0.2, c.rv.lift + 1.4, T);
      const pos = c.pad.clone().add(V(Math.cos(a) * 52, 24 + k * 16, Math.sin(a) * 52));
      const look = c.pad.clone().add(V(0, 4, 0)).lerp(at(c), k * 0.75);
      return pose(pos, look, fov);
    };
    const montageIdx = F.filter((c) => !c.rv.slow).map((c) => c.i);
    const montage = (T) => {
      let k = 0;
      while (k + 1 < montageIdx.length && F[montageIdx[k + 1]].rv.t0 - 0.5 <= T) k++;
      const cur = F[montageIdx[k]], prev = F[montageIdx[Math.max(0, k - 1)]];
      const e = smooth(cur.rv.t0 - 0.5, cur.rv.t0 + 0.5, T);
      const look = prev.pad.clone().lerp(cur.pad, e);
      look.x *= 0.45;
      look.y = 2;
      return pose(look.clone().add(V(55 - T * 0.8, 78, 118)), look, 46);
    };
    const S = [];
    S.push({ at: 0, blend: 0, shot: (T) => {
      const k = smooth(0, 7.3, T);
      return pose(V(40, 640, 430).lerp(V(140, 118, 245), k), V(0, 0, 0).lerp(V(-50, 0, -25), k), 42);
    } });
    for (const c of F.filter((x) => x.rv.slow && x.i < 2)) S.push({ at: c.rv.t0 - 0.5, blend: c.i === 0 ? 1.4 : 1.0, shot: closeUp(c) });
    if (montageIdx.length) S.push({ at: F[montageIdx[0]].rv.t0 - 0.7, blend: 1.3, shot: montage });
    for (const c of F.filter((x) => x.rv.slow && x.i >= 2)) S.push({ at: c.rv.t0 - 0.7, blend: 0.95, shot: closeUp(c) });
    // Close camera work for the airshow acts --------------------------------
    // follow: rides with a craft (back > 0 behind it, < 0 ahead of it looking
    // back; side > 0 to its right), framed in its direction of travel
    const dirOf = (c) => {
      const v = c.flyer.vel.clone().setY(0);
      if (v.length() < 2) v.copy(c.flyer.forward).setY(0);
      return v.normalize();
    };
    const follow = (getC, { back = 40, side = 0, up = 9, look = 0, fov = 40 } = {}) => () => {
      const c = getC(), p = at(c), d = dirOf(c), r = V(-d.z, 0, d.x);
      return pose(p.clone().addScaledVector(d, -back).addScaledVector(r, side).addScaledVector(UP, up), p.clone().addScaledVector(d, look), fov);
    };
    // flyby: a fixed camera beside where a craft will be at tPass (from its
    // path function), panning to keep it in frame as it rushes past
    const flyby = (c, tPass, fn, { side = 26, up = 3, fov = 42 } = {}) => {
      let cam = null;
      return () => {
        if (!cam) {
          const P = fn(tPass), d = fn(tPass + 0.05).sub(fn(tPass - 0.05)).setY(0).normalize();
          cam = P.addScaledVector(V(-d.z, 0, d.x), side).addScaledVector(UP, up);
        }
        return pose(cam, at(c), fov);
      };
    };
    const F_ = (i) => F[Math.min(i, F.length - 1)];

    // paint shop: inside the ring; beside one craft as the colour wave repaints
    // it; high over the ring to see the wave go round; ahead of another
    S.push({ at: TT.paint, blend: 1.6, shot: (T) => {
      const a = RING.w * T + 0.5;
      return pose(V(0, 30, 0), V(RING.r * Math.cos(a), RING.h + 6, RING.r * Math.sin(a)), 48);
    } });
    S.push({ at: 48.2, blend: 0, shot: follow(() => F_(7), { back: 10, side: 34, up: 6, look: 4, fov: 40 }) });
    S.push({ at: 51.2, blend: 0, shot: (T) => pose(V(Math.sin(T * 0.1) * 60, 390, 250), V(0, RING.h - 10, 0), 50) });
    S.push({ at: 53.8, blend: 0, shot: follow(() => F_(F.length - 1), { back: -40, side: 12, up: 7, look: -4, fov: 40 }) });
    // formation
    const right = (d) => V(-d.z, 0, d.x);
    S.push({ at: TT.form, blend: 1.8, shot: (T) => {
      const p = path.pos(T), d = path.dir(T), r = right(d);
      return pose(p.clone().addScaledVector(d, -240).addScaledVector(UP, 100).addScaledVector(r, 95), p.clone().addScaledVector(d, -60), 46);
    } });
    // ahead of the leader, looking back down the arrowhead
    S.push({ at: 59.5, blend: 0, shot: follow(() => this.arrowOwner[0], { back: -52, side: 16, up: 8, look: -26, fov: 44 }) });
    const passT = 65.2;
    const g = path.pos(passT), gd = path.dir(passT);
    const ground = g.clone().setY(4).addScaledVector(right(gd), 22).addScaledVector(gd, 30);
    S.push({ at: 62.5, blend: 0, shot: (T) => {
      const p = path.pos(T), d = path.dir(T);
      return pose(ground, p.clone().addScaledVector(d, -60).setY(p.y - 6), 62);
    } });
    // wingman: beside the craft on the diamond's right edge
    S.push({ at: 66.5, blend: 0, shot: follow(() => this.diamondOwner?.[Math.min(9, F.length - 1)] ?? F_(9), { back: 4, side: 74, up: 28, look: 0, fov: 30 }) });
    S.push({ at: 70, blend: 0, shot: (T) => {
      const p = path.pos(T), d = path.dir(T), r = right(d);
      return pose(p.clone().addScaledVector(d, -95).addScaledVector(r, -200).addScaledVector(UP, 18), p.clone().addScaledVector(d, -95), 44);
    } });
    // tail chase into the pull-up, behind the last craft
    S.push({ at: 72.6, blend: 0, shot: follow(() => this.diamondOwner?.[F.length - 1] ?? F_(F.length - 1), { back: 52, side: -10, up: 16, look: 34, fov: 44 }) });
    S.push({ at: 74.3, blend: 0, shot: (T) => {
      const b = this.burstPoint ?? path.pos(TT.burst), d = this.burstDir ?? path.dir(TT.burst);
      const cam = b.clone().setY(3).addScaledVector(d, -50);
      return pose(cam, b.clone().addScaledVector(UP, 70 + (T - TT.burst) * 6).addScaledVector(d, 20), 82, d);
    } });
    // solo display
    S.push({ at: TT.stunts + 0.2, blend: 1.2, shot: (T) => pose(V(24 - (T - 78) * 2, 74, -178), V(0, 78, 0).lerp(at(this.loopCraft), 0.4), 42) });
    S.push({ at: 86.3, blend: 0.9, shot: (T) => {
      const d = this.barrelDir ?? V(-1, 0, 0), s = this.barrelStart ?? V();
      const lp = s.clone().addScaledVector(d, 65 * Math.max(0, T - TT.barrel));
      const r = V().crossVectors(d, UP).normalize();
      return pose(lp.clone().addScaledVector(d, -78).addScaledVector(UP, 24).addScaledVector(r, -30), at(this.barrelCraft).addScaledVector(d, 8), 44);
    } });
    S.push({ at: 90.3, blend: 0, shot: (T) => pose(V(0, 26, -100 + (T - 90.3) * 3), V(0, 33, 0), 52) });
    // dogfight: close chase; ahead of a defender looking back at its pursuer;
    // wide; a flyby; close side chase
    const chase = (k, { back = 38, side = 0, up = 11 } = {}) => () => {
      const A = this.attackers[k], D = this.defenders[k];
      const v = at(D).sub(at(A)).setY(0);
      if (v.length() < 1) v.copy(A.flyer.vel);
      v.normalize();
      const r = V(-v.z, 0, v.x);
      return pose(at(A).addScaledVector(v, -back).addScaledVector(UP, up).addScaledVector(r, side), at(A).lerp(at(D), 0.55), 46);
    };
    S.push({ at: TT.dog, blend: 0, shot: chase(0) });
    S.push({ at: 96.5, blend: 0, shot: follow(() => this.defenders[1], { back: -42, side: 14, up: 7, look: -12, fov: 44 }) });
    S.push({ at: 99.5, blend: 0, shot: (T) => {
      const a = 0.12 * T;
      return pose(V(Math.cos(a) * 330, 125, Math.sin(a) * 330), V(0, 55, 0), 48);
    } });
    S.push({ at: 102.5, blend: 0, shot: flyby(this.defenders[2], 104.1, (t) => this.defenderPos(2, t), { side: 28, up: 4, fov: 44 }) });
    S.push({ at: 105.5, blend: 0, shot: chase(2, { back: 30, side: 20, up: 8 }) });
    // dawn and the overhead finale
    S.push({ at: TT.dogEnd, blend: 1.6, shot: (T) => pose(V(320 - (T - TT.dogEnd) * 6, 165, 380), V(0, 30, 0), 46) });
    S.push({ at: 116.4, blend: 3.2, shot: () => this.#overhead(40) });
    S.push({ at: TT.dolly, blend: 0, shot: (T) => {
      // dolly-zoom: the lens narrows while the camera backs off, framing kept
      const k = smooth(TT.dolly, TT.ortho, T);
      const fov = Math.exp(THREE.MathUtils.lerp(Math.log(40), Math.log(1.2), k));
      return this.#overhead(fov);
    } });
    this.shots = S;
  }

  // Straight down over the pads. The grid sits in the upper part of the
  // frame, leaving room below it for the end card.
  #overheadFrame() {
    const [hw, hh] = this.#gridHalf();
    const half = Math.max(hh * 1.45, (hw / this.rig.aspect) * 1.04);
    return { half, cz: half - hh - half * 0.05 };
  }

  #overhead(fov) {
    const { half, cz } = this.#overheadFrame();
    const lens = this.rig.lensFov(fov);
    const d = half / Math.tan(THREE.MathUtils.degToRad(lens / 2));
    return pose(V(0, d, cz + 0.001), V(0, 0, cz), fov, V(0, 0, -1));
  }

  #gridHalf() {
    let x = 0, z = 0;
    for (const c of this.fleet) {
      x = Math.max(x, Math.abs(c.pad.x) + Math.max(c.footprint.w, c.size.x) / 2);
      z = Math.max(z, Math.abs(c.pad.z) + Math.max(c.footprint.h, c.size.z) / 2);
    }
    return [x * 1.08 + 6, z * 1.1 + 6];
  }

  // ------------------------------------------------------------ per frame
  // Camera, world, effects; returns what the captions should show.
  frame(T, alpha, rig, { width, height, reduced }) {
    this.rig = rig;
    const world = this.world, fx = this.fx;
    for (const c of this.fleet) {
      c.root.position.lerpVectors(c.prevPos, c.curPos, alpha);
      c.root.quaternion.slerpQuaternions(c.prevQuat, c.curQuat, alpha);
    }
    if (T >= TT.ortho) {
      const { half, cz } = this.#overheadFrame();
      rig.overhead(0, cz, half * rig.aspect, half);
    } else {
      rig.useOrtho = false;
      const p = cutList(this.shots, T);
      if (!reduced) {
        // a little shake when craft rush past the camera
        let amp = 0;
        for (const c of this.fleet) {
          if (c.state !== 'flying') continue;
          const d = c.root.position.distanceTo(p.pos);
          amp = Math.max(amp, clamp01(1 - d / 70) * Math.min(1, c.flyer.vel.length() / 80));
        }
        p.pos.add(V(Math.sin(T * 37) + Math.sin(T * 23.3), Math.sin(T * 31.7), Math.sin(T * 29.1)).multiplyScalar(amp * 0.5));
      }
      rig.apply(p);
    }
    const cam = rig.camera;

    // world look
    world.setDawn(smooth(TT.dawn, 119.5, T));
    world.floorU.uIgnite.value = T < TT.ignite ? 0 : 2400 * smooth(TT.ignite, TT.ignite + 6, T) ** 1.6;
    world.pads.forEach((m, i) => {
      const c = this.fleet[i];
      if (!c) { m.visible = false; return; }
      const on = smooth(TT.sprites + i * 0.05, TT.sprites + 0.8 + i * 0.05, T);
      const active = c.rv ? smooth(c.rv.t0 - 0.3, c.rv.t0, T) * (1 - smooth(c.rv.lift, c.rv.lift + 1.5, T)) : 0;
      m.material.opacity = (on * 0.4 + active * 0.6) * (1 - smooth(TT.dawn + 2, 119.5, T));
      m.visible = m.material.opacity > 0.003;
    });
    world.update(cam, rig.focus, T, rig.dist);

    // sprites: fade in on their pads; again for the wipe at the end
    let wipe = null;
    for (const c of this.fleet) {
      const m = c.spriteMesh.material;
      if (T >= TT.flash) {
        c.spriteMesh.visible = T >= TT.wipe1;
        m.depthTest = false;
        c.spriteMesh.renderOrder = 10;
        c.spriteMesh.position.y = 0.2;
      } else if (c.state === 'hidden' || (c.state === 'reveal' && c.spriteMesh.visible)) {
        m.opacity = smooth(TT.sprites + c.i * 0.05, TT.sprites + 0.7 + c.i * 0.05, T);
      }
    }
    if (T >= TT.wipe1) {
      const f = T < TT.wipe3 ? smooth(TT.wipe1, TT.wipe2, T) : 1 - smooth(TT.wipe3, TT.wipe4, T);
      const o = rig.ortho, frac = -0.02 + 1.04 * f;
      const x = o.position.x + o.left + (o.right - o.left) * frac;
      for (const c of this.fleet) {
        c.spriteMesh.material.opacity = 1;
        c.clip.normal.set(-1, 0, 0);
        c.clip.constant = x;
      }
      wipe = { frac, show: T < TT.wipe4 + 0.2 };
      if ((T > TT.wipe1 && T < TT.wipe1 + 0.05) || (T > TT.wipe3 && T < TT.wipe3 + 0.05)) this.#once(`wipe${T > TT.wipe3}`, () => this.audio.swish());
    }

    // scan beams
    let b = 0;
    for (const c of this.fleet) {
      const rv = c.rv;
      if (T < rv.sweep0 - 0.2 || T > rv.sweepEnd + 0.25 || b >= this.beams.length) continue;
      const k = smooth(rv.sweep0 - 0.2, rv.sweep0, T) * (1 - smooth(rv.sweepEnd, rv.sweepEnd + 0.25, T));
      const x = c.beamX0 + (c.beamX1 - c.beamX0) * clamp01((T - rv.sweep0) / rv.sweepDur);
      this.beams[b++].set(x, c.pad.z + c.footprint.z, Math.max(c.footprint.h, c.size.z), k, rv.slow ? 18 : 13);
    }
    for (; b < this.beams.length; b++) this.beams[b].set(0, 0, 1, 0);

    fx.trails.update(cam, T);
    fx.tracers.update();
    fx.sparks.update(cam, height);
    fx.puffs.update(cam, height);

    // flyby whooshes
    if (this.audio.live) {
      const right = V(1, 0, 0).applyQuaternion(cam.quaternion);
      for (const c of this.fleet) {
        if (c.state !== 'flying' || T - c.whooshAt < 2.5) continue;
        const rel = c.root.position.clone().sub(cam.position);
        const speed = c.flyer.vel.length();
        if (rel.length() < 62 && speed > 45) {
          c.whooshAt = T;
          this.audio.whoosh(right.dot(rel.normalize()), Math.min(1.2, speed / 90));
        }
      }
    }

    return this.#captions(T, cam, width, height, wipe);
  }

  #once(key, fn) {
    this.onceKeys ??= new Set();
    if (this.onceKeys.has(key)) return;
    this.onceKeys.add(key);
    fn();
  }

  #captions(T, cam, width, height, wipe) {
    let chapter = CHAPTERS[0][1];
    for (const [t, name] of CHAPTERS) if (T >= t) chapter = name;
    let card = null;
    const tags = [];
    for (const c of this.fleet) {
      const rv = c.rv;
      if (rv.slow && T >= rv.t0 + 0.35 && T < rv.lift + 1.1) {
        card = { no: c.no, name: c.name, colour: c.colour, out: T > rv.lift + 0.75 };
      }
      if (!rv.slow && T >= rv.t0 + 0.1 && T < rv.lift + 0.5) {
        const p = c.root.position.clone().add(V(0, c.halfHeight + 6, 0)).project(cam);
        tags.push({ i: c.i, text: `${String(c.no).padStart(2, '0')} · ${c.name}`, x: (p.x + 1) / 2 * width, y: (1 - p.y) / 2 * height, colour: c.colour, out: T > rv.lift + 0.2 });
      }
    }
    return {
      chapter: T < TT.flash ? chapter : null,
      card, tags, wipe,
      letterbox: T < 120.6,
      flash: T > TT.flash - 0.12 && T < TT.flash + 0.8 ? (T < TT.flash ? (T - TT.flash + 0.12) / 0.12 : 1 - (T - TT.flash) / 0.8) * 0.9 : 0,
      progress: T / END,
      done: T >= END - 0.2,
    };
  }
}
