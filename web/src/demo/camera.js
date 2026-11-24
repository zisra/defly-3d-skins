import * as THREE from 'three';

// Camera for the demo. A shot is a function of show time returning a pose
// { pos, look, fov, up? }; the rig blends between shots and widens the lens on
// narrow screens. The final overhead shot switches to an orthographic camera
// (after a dolly-zoom), so flat sprites and 3D craft line up exactly.

export class CameraRig {
  constructor() {
    this.persp = new THREE.PerspectiveCamera(45, 1, 0.5, 9000);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, 9000);
    this.useOrtho = false;
    this.aspect = 1;
    this.focus = new THREE.Vector3();
    this.dist = 100;
  }

  get camera() { return this.useOrtho ? this.ortho : this.persp; }

  setAspect(a) { this.aspect = a; }

  // Lens: on screens narrower than 16:10 the field of view grows so roughly
  // the same width of the scene stays in frame.
  lensFov(fov) {
    const k = Math.min(2.3, Math.max(1, 1.6 / this.aspect) ** 0.8);
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov / 2)) * k));
  }

  apply(pose) {
    const c = this.persp;
    c.position.copy(pose.pos);
    c.up.copy(pose.up ?? THREE.Object3D.DEFAULT_UP);
    c.lookAt(pose.look);
    c.fov = this.lensFov(pose.fov);
    c.aspect = this.aspect;
    const d = pose.pos.distanceTo(pose.look);
    if (pose.fov < 12) { c.near = d * 0.5; c.far = d * 2 + 2000; } else { c.near = 0.5; c.far = 9000; }
    c.updateProjectionMatrix();
    this.focus.copy(pose.look);
    this.dist = d;
  }

  // Straight down over (x, z), showing at least halfW x halfH of the floor.
  overhead(x, z, halfW, halfH) {
    const o = this.ortho;
    const h = Math.max(halfH, halfW / this.aspect);
    Object.assign(o, { left: -h * this.aspect, right: h * this.aspect, top: h, bottom: -h, near: 10, far: 4000 });
    o.position.set(x, 2000, z);
    o.up.set(0, 0, -1);
    o.lookAt(x, 0, z);
    o.updateProjectionMatrix();
    this.useOrtho = true;
    this.focus.set(x, 0, z);
    this.dist = 2000;
  }
}

// Pose helpers -------------------------------------------------------------
export const pose = (pos, look, fov = 45, up = null) => ({ pos, look, fov, up });

export function blendPose(a, b, k) {
  const e = k * k * (3 - 2 * k);
  return {
    pos: a.pos.clone().lerp(b.pos, e),
    look: a.look.clone().lerp(b.look, e),
    fov: THREE.MathUtils.lerp(a.fov, b.fov, e),
    up: a.up || b.up ? (a.up ?? THREE.Object3D.DEFAULT_UP).clone().lerp(b.up ?? THREE.Object3D.DEFAULT_UP, e).normalize() : null,
  };
}

// A list of shots [{ at, blend, shot(T) }]; returns the pose at T, blending
// from the previous shot over `blend` seconds after each start (0 = cut).
export function cutList(shots, T) {
  let k = 0;
  while (k + 1 < shots.length && shots[k + 1].at <= T) k++;
  const cur = shots[k];
  const p = cur.shot(T);
  if (k > 0 && cur.blend > 0 && T < cur.at + cur.blend) {
    return blendPose(shots[k - 1].shot(T), p, (T - cur.at) / cur.blend);
  }
  return p;
}
