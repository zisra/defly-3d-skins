import * as THREE from 'three';

// Arcade flight for the demo. Each craft is a point mass that steers towards a
// target the choreography sets every step (a PD controller with speed and
// acceleration limits), and turns its motion into an attitude: the nose
// follows the velocity, it banks into turns, pitches with climbs and dips its
// nose when accelerating. Stunts instead follow a scripted path that gives
// position and attitude directly.

const G = 32; // "gravity" for bank and tilt angles, units/s²
const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, 'YZX');
const basis = new THREE.Matrix4();

// Attitude with the nose along `forward` and the top towards `up`.
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
export function attitude(forward, up, out = new THREE.Quaternion()) {
  _f.copy(forward).normalize();
  _r.crossVectors(_f, up).normalize(); // the craft's right side (+z)
  _u.crossVectors(_r, _f);
  basis.makeBasis(_f, _u, _r);
  return out.setFromRotationMatrix(basis);
}

const dampAngle = (a, b, rate, dt) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * (1 - Math.exp(-rate * dt));
const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));

export class Flyer {
  constructor(radius) {
    this.radius = radius;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.acc = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.heading = 0; // yaw; 0 = nose along +x
    this.bank = 0;
    this.pitch = 0;
    this.roll = 0; // extra roll (hit wobble)
    this.mode = 'parked'; // 'parked' | 'steer' | 'script'
    this.target = new THREE.Vector3();
    this.targetVel = new THREE.Vector3();
    this.face = 0; // heading to hold when hovering slowly
    this.maxSpeed = 95;
    this.maxAcc = 75;
    this.kp = 1.15;
    this.kv = 2.3;
    this.floor = 6; // lowest centre height while steering
    this.wobbleT = Infinity;
    this.half = radius / 3; // half height (set by the show)
  }

  // Fixed step. `push` is an extra acceleration (separation from others).
  step(dt, push) {
    if (this.mode === 'script') {
      const s = this.script;
      s.t += dt;
      const prev = this.pos.clone();
      s.path(s.t, this.pos, this.quat);
      if (s.t < s.blend) {
        // ease in from where the craft actually was when the move started
        const k = s.t / s.blend, e = k * k * (3 - 2 * k);
        const from = s.start.pos.clone().addScaledVector(s.start.vel, s.t);
        this.pos.lerpVectors(from, this.pos, e);
        this.quat.slerpQuaternions(s.start.quat, this.quat, e);
      }
      this.vel.copy(this.pos).sub(prev).divideScalar(dt);
      if (s.t >= s.duration) {
        this.mode = 'steer';
        this.#adoptAttitude();
      }
      return;
    }
    if (this.mode !== 'steer') return;

    // PD steering towards the (moving) target
    const desired = tmp.copy(this.target).sub(this.pos).multiplyScalar(this.kp).add(this.targetVel);
    this.acc.copy(desired).sub(this.vel).multiplyScalar(this.kv);
    if (this.acc.length() > this.maxAcc) this.acc.setLength(this.maxAcc);
    // keeping clear of others has its own, larger budget
    if (push) this.acc.add(push.length() > this.maxAcc * 2.5 ? push.clone().setLength(this.maxAcc * 2.5) : push);
    this.vel.addScaledVector(this.acc, dt);
    if (this.vel.length() > this.maxSpeed) this.vel.setLength(this.maxSpeed);
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y < this.floor) {
      this.pos.y = this.floor;
      this.vel.y = Math.max(0, this.vel.y);
    }

    // attitude from the motion
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const speed = this.vel.length();
    const wantHeading = hs > 6 ? Math.atan2(-this.vel.z, this.vel.x) : this.face;
    this.heading = dampAngle(this.heading, wantHeading, hs > 6 ? 5 : 2.2, dt);
    const fwd = tmp.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
    const right = tmp2.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    const aLat = this.acc.dot(right), aFwd = this.acc.dot(fwd);
    const wantBank = THREE.MathUtils.clamp(Math.atan(aLat / G), -1.05, 1.05) * Math.min(1, speed / 25);
    const climb = speed > 6 ? Math.atan2(this.vel.y, Math.max(hs, 1)) * 0.6 : 0;
    const wantPitch = THREE.MathUtils.clamp(climb - Math.atan(aFwd / G) * 0.35, -0.6, 0.6);
    this.bank = damp(this.bank, wantBank, 4, dt);
    this.pitch = damp(this.pitch, wantPitch, 3, dt);

    // a hit: a sharp roll that rings down
    this.wobbleT += dt;
    this.roll = this.wobbleT < 2 ? 0.55 * Math.exp(-2.6 * this.wobbleT) * Math.sin(16 * this.wobbleT) : 0;

    euler.set(this.bank + this.roll, this.heading, this.pitch);
    this.quat.setFromEuler(euler);
  }

  // Start a scripted move: path(t, pos, quat) fills position and attitude.
  // The first `blend` seconds ease from the craft's own motion onto the path.
  fly(path, duration, blend = 1) {
    this.script = { path, duration, blend, t: 0, start: { pos: this.pos.clone(), vel: this.vel.clone(), quat: this.quat.clone() } };
    this.mode = 'script';
  }

  hit() { this.wobbleT = 0; }

  // after a scripted move, carry its attitude over into steering
  #adoptAttitude() {
    euler.setFromQuaternion(this.quat, 'YZX');
    this.heading = euler.y;
    this.pitch = THREE.MathUtils.clamp(euler.z, -0.6, 0.6);
    this.bank = THREE.MathUtils.clamp(Math.atan2(Math.sin(euler.x), Math.cos(euler.x)), -1, 1);
  }

  get forward() { return new THREE.Vector3(1, 0, 0).applyQuaternion(this.quat); }
}

// Separation. Craft are flat, so closeness is measured on an ellipsoid (their
// width across, their height up) and the push favours going over or under.
// It also looks half a second ahead, to steer clear before paths meet.
// Scripted craft hold their line; the others avoid them.
const LOOK = 0.5;
const d0 = new THREE.Vector3(), d1 = new THREE.Vector3(), dir = new THREE.Vector3();
const spacing = (d, R, H) => Math.sqrt((d.x * d.x + d.z * d.z) / (R * R) + (d.y * d.y) / (H * H));
export function separate(flyers, out) {
  for (const o of out) o.set(0, 0, 0);
  for (let a = 0; a < flyers.length; a++) {
    const A = flyers[a];
    if (A.mode === 'parked') continue;
    for (let b = a + 1; b < flyers.length; b++) {
      const B = flyers[b];
      if (B.mode === 'parked' || (A.mode === 'script' && B.mode === 'script')) continue;
      const R = A.radius + B.radius + 6, H = A.half + B.half + 6;
      d0.subVectors(A.pos, B.pos);
      d1.copy(d0).addScaledVector(A.vel, LOOK).addScaledVector(B.vel, -LOOK);
      const s0 = spacing(d0, R, H), s1 = spacing(d1, R, H);
      const s = Math.min(s0, s1);
      if (s >= 1.3) continue;
      dir.copy(s1 < s0 ? d1 : d0);
      dir.y *= 2.2 * R / H; // vertical moves are cheap for flat craft
      if (dir.lengthSq() < 1e-6) dir.set(0, a < b ? 1 : -1, 0);
      dir.normalize().multiplyScalar(((1.3 - s) / 1.3) * 380);
      if (A.mode === 'steer') out[a].add(dir);
      if (B.mode === 'steer') out[b].sub(dir);
    }
  }
  return out;
}

export { UP };
