import * as THREE from 'three';

// Scene effects. None of these are parts of a craft: trails, tracer bolts,
// sparks, smoke puffs and the scan beam all live in the scene.

const STEP = 1 / 60;

// ---------------------------------------------------------------------------
// Smoke trails: a camera-facing ribbon per craft that widens and fades with age.
export class Trails {
  constructor(scene, count, { life = 2.8 } = {}) {
    this.life = life;
    // soft across the width: bright core, feathered edges
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 1;
    const g2 = c.getContext('2d');
    const grad = g2.createLinearGradient(0, 0, 64, 0);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.3, 'rgba(150,150,150,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,1)');
    grad.addColorStop(0.7, 'rgba(150,150,150,1)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    g2.fillStyle = grad;
    g2.fillRect(0, 0, 64, 1);
    const soft = new THREE.CanvasTexture(c);
    this.cap = Math.ceil(life / STEP) + 2;
    this.list = [];
    for (let i = 0; i < count; i++) {
      const g = new THREE.BufferGeometry();
      const pairs = this.cap * 2; // room for the extra pairs at breaks
      const pos = new Float32Array(pairs * 2 * 3), col = new Float32Array(pairs * 2 * 4);
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
      const uv = new Float32Array(pairs * 2 * 2);
      for (let k = 0; k < pairs; k++) uv.set([0, 0, 1, 0], k * 4);
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const idx = [];
      for (let k = 0; k < pairs - 1; k++) {
        const a = k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      g.setIndex(idx);
      g.setDrawRange(0, 0);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, alphaMap: soft,
        blending: THREE.AdditiveBlending, fog: true,
      }));
      m.frustumCulled = false;
      m.renderOrder = 2;
      scene.add(m);
      this.list.push({
        mesh: m, pts: new Float32Array(this.cap * 3), times: new Float64Array(this.cap),
        head: 0, n: 0, on: false, colour: new THREE.Color(), width: 1.4,
      });
    }
  }

  emit(i, on, colour) {
    const tr = this.list[i];
    tr.on = on;
    if (colour) tr.colour.copy(colour);
  }

  // fixed step: record the emitting craft's tail position
  step(i, point, t) {
    const tr = this.list[i];
    if (!tr.on) return;
    tr.head = (tr.head + 1) % this.cap;
    tr.pts.set([point.x, point.y, point.z], tr.head * 3);
    tr.times[tr.head] = t;
    tr.n = Math.min(this.cap, tr.n + 1);
  }

  clear() { for (const tr of this.list) tr.n = 0; }

  // per frame: rebuild the ribbons facing the camera. Where emission paused
  // (a gap in the samples) the ribbon breaks instead of bridging the gap.
  update(camera, t) {
    const cam = camera.position, cap = this.cap;
    const a = new THREE.Vector3(), o = new THREE.Vector3(), tan = new THREE.Vector3();
    const side = new THREE.Vector3(), view = new THREE.Vector3(), last = new THREE.Vector3();
    for (const tr of this.list) {
      const pos = tr.mesh.geometry.attributes.position, col = tr.mesh.geometry.attributes.color;
      const max = pos.count / 2;
      let n = 0, prevTime = null;
      const r = tr.colour.r * 1.6, g = tr.colour.g * 1.6, b = tr.colour.b * 1.6;
      const put = (p, w, alpha) => {
        if (n >= max) return;
        pos.setXYZ(n * 2, p.x + side.x * w, p.y + side.y * w, p.z + side.z * w);
        pos.setXYZ(n * 2 + 1, p.x - side.x * w, p.y - side.y * w, p.z - side.z * w);
        col.setXYZW(n * 2, r, g, b, alpha);
        col.setXYZW(n * 2 + 1, r, g, b, alpha);
        n++;
      };
      for (let k = 0; k < tr.n; k++) {
        const j = (tr.head - k + cap) % cap;
        const age = t - tr.times[j];
        if (age > this.life || age < -1e-6) break;
        a.fromArray(tr.pts, j * 3);
        const jo = (j - 1 + cap) % cap;
        const hasOlder = k + 1 < tr.n && Math.abs(tr.times[j] - tr.times[jo] - STEP) < 1e-3;
        if (hasOlder) tan.subVectors(a, o.fromArray(tr.pts, jo * 3));
        else if (prevTime !== null) tan.subVectors(last, a);
        else tan.set(1, 0, 0);
        const gap = prevTime !== null && Math.abs(prevTime - tr.times[j] - STEP) > 1e-3;
        if (gap) put(last, 0, 0); // close the newer piece invisibly
        view.subVectors(cam, a);
        side.crossVectors(tan, view).normalize();
        const w = (tr.width + age * 1.2) * 0.5 * 1.6; // the feathered edges take some width
        if (gap) put(a, w, 0); // and open the older one invisibly
        // fade near the lens, where a ribbon would fill the screen
        const near = THREE.MathUtils.smoothstep(view.length(), 10, 40);
        const alpha = Math.pow(1 - age / this.life, 1.6) * 0.75 * Math.min(1, age / 0.12) * near;
        put(a, w, alpha);
        prevTime = tr.times[j];
        last.copy(a);
      }
      tr.mesh.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Tracer bolts: short glowing streaks, pooled.
export class Tracers {
  constructor(scene, max = 240) {
    this.max = max;
    this.items = [];
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: true }), max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  fire(from, dir, speed, colour, owner) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ pos: from.clone(), vel: dir.clone().multiplyScalar(speed), life: 0.55, colour, owner });
  }

  step(dt) {
    for (const it of this.items) { it.pos.addScaledVector(it.vel, dt); it.life -= dt; }
    this.items = this.items.filter((it) => it.life > 0);
  }

  update() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
    this.items.forEach((it, k) => {
      q.setFromUnitVectors(X, it.vel.clone().normalize());
      s.set(7, 0.32, 0.32);
      m.compose(it.pos, q, s);
      this.mesh.setMatrixAt(k, m);
      this.mesh.setColorAt(k, it.colour);
    });
    this.mesh.count = this.items.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Particles (sparks: additive and bright; puffs: soft smoke that grows).
export class Particles {
  constructor(scene, max, { additive = true, soft = false } = {}) {
    this.max = max;
    this.items = [];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 400 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `attribute vec4 color; attribute float size; uniform float uScale; varying vec4 vC;
void main() {
  vC = color;
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uScale / max( -mv.z, 1.0 );
}`,
      fragmentShader: `varying vec4 vC;
void main() {
  float d = length( gl_PointCoord - 0.5 ) * 2.0;
  float a = ${soft ? 'smoothstep( 1.0, 0.0, d ) * smoothstep( 1.0, 0.35, d )' : 'smoothstep( 1.0, 0.2, d )'};
  gl_FragColor = vec4( vC.rgb, vC.a * a );
  #include <colorspace_fragment>
}`,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }

  spawn(p) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ drag: 0.9, gravity: 0, grow: 0, ...p, age: 0 });
  }

  step(dt) {
    for (const it of this.items) {
      it.age += dt;
      it.vel.multiplyScalar(Math.pow(it.drag, dt * 60));
      it.vel.y -= it.gravity * dt;
      it.pos.addScaledVector(it.vel, dt);
      it.size += it.grow * dt;
    }
    this.items = this.items.filter((it) => it.age < it.life);
  }

  update(camera, height) {
    if (camera.isPerspectiveCamera) this.uniforms.uScale.value = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const g = this.points.geometry, P = g.attributes.position, C = g.attributes.color, S = g.attributes.size;
    this.items.forEach((it, k) => {
      const f = 1 - it.age / it.life;
      P.setXYZ(k, it.pos.x, it.pos.y, it.pos.z);
      C.setXYZW(k, it.colour.r, it.colour.g, it.colour.b, (it.alpha ?? 1) * f * f);
      S.setX(k, it.size);
    });
    g.setDrawRange(0, this.items.length);
    P.needsUpdate = C.needsUpdate = S.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Scan beam: a bright bar sweeping over a pad, a sheet of light rising from
// it and a glow on the floor behind it.
export class Beam {
  constructor(scene) {
    const g = new THREE.Group();
    const cyan = new THREE.Color(0.5, 2.8, 4.2);
    this.bar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 1), new THREE.MeshBasicMaterial({ color: cyan, toneMapped: true, transparent: true }));
    this.bar.position.y = 0.5;
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 128;
    const x = c.getContext('2d');
    const grad = x.createLinearGradient(0, 128, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = grad;
    x.fillRect(0, 0, 4, 128);
    const tex = new THREE.CanvasTexture(c);
    this.sheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({
      map: tex, color: new THREE.Color(0.25, 1.1, 1.8), transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, toneMapped: true,
    }));
    const fc = document.createElement('canvas');
    fc.width = 128;
    fc.height = 4;
    const fx = fc.getContext('2d');
    const fg = fx.createLinearGradient(0, 0, 128, 0);
    fg.addColorStop(0, 'rgba(255,255,255,0)');
    fg.addColorStop(1, 'rgba(255,255,255,1)');
    fx.fillStyle = fg;
    fx.fillRect(0, 0, 128, 4);
    this.trail = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(-0.5, 0, 0).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(fc), color: new THREE.Color(0.1, 0.5, 0.9), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: true,
    }));
    this.trail.position.y = 0.08;
    g.add(this.bar, this.sheet, this.trail);
    g.visible = false;
    g.renderOrder = 4;
    scene.add(g);
    this.group = g;
  }

  // at world x, across depth `depth` centred on z, with strength k (0..1)
  set(x, z, depth, k, height = 14) {
    this.group.visible = k > 0.001;
    this.group.position.set(x, 0, z);
    this.bar.scale.set(1, 1, depth + 6);
    this.bar.material.opacity = k;
    this.sheet.scale.set(1, height, depth + 4);
    this.sheet.material.opacity = 0.55 * k;
    this.trail.scale.set(16, 1, depth + 4);
    this.trail.material.opacity = 0.7 * k;
  }
}
