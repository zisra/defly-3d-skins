import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const BG = '#eef4fd';
const GRID_CELL = 18.5; // the arena grid in sprite_kit.svg, in SVG units
const HOVER_GAP = 5; // how far the craft floats above the floor

// Field of view per camera view. Top uses a very narrow lens from far away,
// which is practically orthographic: parts higher up (the rotor) are not
// enlarged, so the picture lines up with the flat sprite.
const VIEW_FOV = { orbit: 30, top: 4 };

// Owns the renderer, the arena and the camera. Models are added with
// setModel(); each frame calls model.update(dt, time, state).
export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = { spin: true, turntable: true, view: 'orbit' };
    this.fov = VIEW_FOV.orbit;
    this.radius = 10;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(BG);
    scene.fog = new THREE.Fog(BG, 90, 260);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(this.fov, 1, 0.5, 1000);
    this.controls = new OrbitControls(this.camera, canvas);
    Object.assign(this.controls, {
      enableDamping: true,
      dampingFactor: 0.08,
      autoRotateSpeed: 0.9,
      enablePan: false,
      maxPolarAngle: Math.PI * 0.49,
      minPolarAngle: 0,
    });
    this.controls.addEventListener('start', () => (this.tween = null));

    this.hemi = new THREE.HemisphereLight('#ffffff', '#c9d6ea', 0.9);
    this.key = new THREE.DirectionalLight('#ffffff', 2.2);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.07; // tall walls run nearly parallel to the light
    this.keyDir = new THREE.Vector3(0.3, 1, 0.4).normalize();
    this.rim = new THREE.DirectionalLight('#dbe8ff', 0.8);
    this.rim.position.set(-30, 20, -25);
    scene.add(this.hemi, this.key, this.key.target, this.rim);

    this.#buildArena();

    this.craft = new THREE.Group(); // bob/tilt
    scene.add(this.craft);

    this.timer = new THREE.Timer();
    this.time = 0;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    renderer.setAnimationLoop((now) => this.#frame(now));
  }

  // Stop / restart rendering (the flight demo takes over the screen meanwhile).
  pause() { this.renderer.setAnimationLoop(null); }
  resume() {
    this.timer.reset?.();
    this.renderer.setAnimationLoop((now) => this.#frame(now));
  }

  #buildArena() {
    // Grid floor in the game's arena colours; fog fades it into the sky.
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#f2f7ff';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#dae1eb';
    g.fillRect(0, 0, 256, 3);
    g.fillRect(0, 0, 3, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const size = 800;
    tex.repeat.set(size / GRID_CELL, size / GRID_CELL);
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
    );
    floor.rotation.x = -Math.PI / 2;

    this.shadowMat = new THREE.ShadowMaterial({ color: '#2b4a7a', opacity: 0.2 });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(size, size), this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    shadow.receiveShadow = true;

    // Soft contact blob under the craft.
    const bc = document.createElement('canvas');
    bc.width = bc.height = 128;
    const bg = bc.getContext('2d');
    const grad = bg.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(40,70,120,0.22)');
    grad.addColorStop(1, 'rgba(40,70,120,0)');
    bg.fillStyle = grad;
    bg.fillRect(0, 0, 128, 128);
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(bc), transparent: true, depthWrite: false, toneMapped: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;

    this.arena = new THREE.Group();
    this.arena.add(floor, shadow, blob);
    this.blob = blob;
    this.scene.add(this.arena);
  }

  // Lighting and tone mapping for a render style (see styles.js SCENES).
  setStyle(s) {
    this.renderer.toneMapping = s.toneMapping;
    this.renderer.toneMappingExposure = s.exposure;
    this.scene.environmentIntensity = s.env;
    this.keyDir.set(...s.key.dir).normalize();
    this.key.intensity = s.key.intensity;
    this.hemi.color.set(s.hemi.sky);
    this.hemi.groundColor.set(s.hemi.ground);
    this.hemi.intensity = s.hemi.intensity;
    this.rim.intensity = s.rim;
    this.shadowMat.opacity = s.shadow;
    this.key.castShadow = s.shadow > 0;
    this.#placeKey();
  }

  #placeKey() {
    const c = this.target ?? new THREE.Vector3();
    this.key.target.position.copy(c);
    this.key.position.copy(c).addScaledVector(this.keyDir, 60);
  }

  setModel(model) {
    if (this.model) {
      this.craft.remove(this.model.object);
      this.model.dispose?.();
    }
    this.model = model;
    this.craft.add(model.object);

    // Floor sits a fixed gap under the model; frame the camera on it
    // (ignoring effects marked noFrame, e.g. glows bigger than the craft).
    const box = new THREE.Box3();
    model.object.updateMatrixWorld(true);
    model.object.traverse((o) => {
      if (o.isMesh && !o.userData.noFrame) box.union(new THREE.Box3().setFromObject(o, true));
    });
    if (box.isEmpty()) box.setFromObject(model.object);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.arena.position.y = box.min.y - HOVER_GAP;
    const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    this.blob.scale.setScalar(span * 1.15);
    this.radius = sphere.radius;
    this.target = sphere.center.clone();

    const sc = this.key.shadow.camera;
    const r = sphere.radius * 1.3;
    Object.assign(sc, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 200 });
    sc.updateProjectionMatrix();
    this.#placeKey();

    this.controls.target.copy(this.target);
    this.setView(this.state.view, { instant: !this.hasFramed });
    this.hasFramed = true;
  }

  // 'orbit' = three-quarter showcase view; 'top' = straight down, like the game.
  setView(view, { instant = false } = {}) {
    this.state.view = view;
    const fov = VIEW_FOV[view];
    const fit = this.#fitDistance(fov);
    const to = view === 'top'
      ? new THREE.Spherical(fit * 0.74, 1e-4, 0)
      : new THREE.Spherical(fit * 0.66, THREE.MathUtils.degToRad(60), THREE.MathUtils.degToRad(38));
    this.controls.autoRotate = view === 'orbit' && this.state.turntable;
    this.controls.minDistance = fit * 0.3;
    this.controls.maxDistance = fit * 3;
    if (instant) {
      this.fov = fov;
      this.#applyProjection();
      this.#placeCamera(to);
      this.tween = null;
      return;
    }
    const from = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    let dTheta = to.theta - from.theta; // take the short way round
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
    this.tween = {
      from, fromFov: this.fov,
      to: new THREE.Spherical(to.radius, to.phi, from.theta + dTheta), toFov: fov,
      t: 0,
    };
  }

  // Look from a given azimuth/elevation (degrees); scale multiplies the fit distance.
  lookFrom(azimuth, elevation, scale = 1) {
    this.tween = null;
    this.controls.autoRotate = false;
    const fit = this.#fitDistance(this.fov);
    this.#placeCamera(new THREE.Spherical(fit * scale, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth)));
  }

  setTurntable(on) {
    this.state.turntable = on;
    this.controls.autoRotate = on && this.state.view === 'orbit';
  }

  // Screen space (px) covered by UI at the top and bottom; the craft is
  // framed in the space between and the picture is shifted to suit.
  setInsets(insets) {
    this.insets = insets;
    this.resize();
  }

  // Point in the craft's own coordinates -> CSS pixels on the canvas.
  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).applyMatrix4(this.craft.matrixWorld).project(this.camera);
    return { x: (v.x + 1) / 2 * this.canvas.clientWidth, y: (1 - v.y) / 2 * this.canvas.clientHeight };
  }

  #placeCamera(s) {
    this.camera.position.setFromSpherical(s).add(this.controls.target);
    this.camera.lookAt(this.controls.target);
  }

  // Narrow (portrait) screens widen the lens so the craft still fits.
  #lensScale() {
    const a = (this.canvas.clientWidth || 1) / (this.canvas.clientHeight || 1);
    return a < 1 ? 1 / Math.max(a, 0.55) : 1;
  }

  // Distance at which the bounding sphere fits the free (un-covered) height
  // and the full width, whichever is tighter.
  #fitDistance(fov) {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    const { top = 0, bottom = 0 } = this.insets ?? {};
    const free = Math.max(h - top - bottom, h * 0.4);
    const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * this.#lensScale();
    const half = Math.atan(Math.min(tanV * free / h, tanV * w / h * 0.92));
    return this.radius / Math.sin(half);
  }

  #applyProjection() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    const { top = 0, bottom = 0 } = this.insets ?? {};
    const shift = Math.max(0, Math.round((bottom - top) / 2)); // move the picture up by this
    const fullH = h + 2 * shift;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.fov / 2)) * this.#lensScale();
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanV * fullH / h));
    this.camera.aspect = w / fullH;
    this.camera.setViewOffset(w, fullH, 0, 2 * shift, w, h);
    this.camera.updateProjectionMatrix();
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.#applyProjection();
  }

  #frame(now) {
    this.timer.update(now);
    const raw = this.timer.getDelta();
    const dt = Math.min(raw, 0.05);
    this.time += dt;
    const t = this.time;

    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + Math.min(raw, 0.25) / 1.1); // real time, even on slow devices
      const k = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
      const lerpLog = (a, b) => Math.exp(THREE.MathUtils.lerp(Math.log(a), Math.log(b), k));
      // zoom the lens and move the camera together so the craft keeps its size
      const tan0 = Math.tan(THREE.MathUtils.degToRad(tw.fromFov / 2));
      const tan1 = Math.tan(THREE.MathUtils.degToRad(tw.toFov / 2));
      this.fov = THREE.MathUtils.radToDeg(2 * Math.atan(lerpLog(tan0, tan1)));
      this.#applyProjection();
      this.#placeCamera(new THREE.Spherical(
        lerpLog(tw.from.radius, tw.to.radius),
        THREE.MathUtils.lerp(tw.from.phi, tw.to.phi, k),
        THREE.MathUtils.lerp(tw.from.theta, tw.to.theta, k),
      ));
      if (tw.t >= 1) this.tween = null;
    }

    // Gentle hover. Kept flat in top view so it reads like the sprite.
    this.hover = THREE.MathUtils.damp(this.hover ?? 1, this.state.view === 'top' ? 0 : 1, 3, dt);
    const amp = this.hover;
    this.craft.position.y = Math.sin(t * 1.4) * 0.45 * amp;
    this.craft.rotation.z = Math.sin(t * 0.9) * 0.025 * amp;
    this.craft.rotation.x = Math.sin(t * 1.1 + 1) * 0.02 * amp;
    this.craft.updateMatrixWorld();

    this.model?.update?.(dt, t, this.state);
    if (!this.tween) this.controls.update(dt);

    // Keep clipping planes and fog relative to the camera distance (the Top
    // view sits far away behind its narrow lens).
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = Math.max(0.5, dist - this.radius * 3);
    this.camera.far = dist + 600;
    this.camera.updateProjectionMatrix();
    this.scene.fog.near = dist + 30;
    this.scene.fog.far = dist + 200;

    this.onFrame?.();
    this.renderer.render(this.scene, this.camera);
  }
}
