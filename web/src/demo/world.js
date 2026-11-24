import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SCENES } from '../styles.js';

// The stage: renderer, night sky, glowing grid floor, pads, lights, and the
// dawn that turns it all back into the viewer's daylight arena.

export const GRID_CELL = 18.5; // the arena grid, as in the viewer
export const PAD_GAP = 44;
export const PAD_COLS = 5;

const DAY_BG = '#eef4fd'; // the viewer's background
const lin = (hex) => new THREE.Color(hex);

const NIGHT = {
  sky: { zenith: lin('#03050d'), horizon: lin('#191343'), glow: lin('#4b2f9a'), ground: lin('#05070f') },
  fog: lin('#0b0b22'),
  hemi: { sky: lin('#8d9ce0'), ground: lin('#3a3470'), intensity: 1.35 },
  key: { color: lin('#e4ecff'), intensity: 2.5, dir: new THREE.Vector3(-0.35, 1, 0.45).normalize() },
  rim: { color: lin('#c9b8ff'), intensity: 0.7 },
  env: 0.38,
  exposure: 1.05,
  shadow: 0.55,
};
const SUNRISE = { zenith: lin('#4d6fc4'), horizon: lin('#ffc19a'), glow: lin('#ffa06e'), ground: lin('#c9d3e6') };
const DAY = {
  sky: { zenith: lin(DAY_BG), horizon: lin(DAY_BG), glow: lin('#000000'), ground: lin(DAY_BG) },
  fog: lin(DAY_BG),
  hemi: { sky: lin(SCENES.matte.hemi.sky), ground: lin(SCENES.matte.hemi.ground), intensity: SCENES.matte.hemi.intensity },
  key: { color: lin('#ffffff'), intensity: SCENES.matte.key.intensity, dir: new THREE.Vector3(...SCENES.matte.key.dir).normalize() },
  rim: { color: lin('#dbe8ff'), intensity: SCENES.matte.rim },
  env: SCENES.matte.env,
  exposure: 1,
  shadow: 0.2,
};

export class World {
  constructor(canvas, { quality }) {
    this.quality = quality;
    const high = quality === 'high';
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: !high, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, high ? 2 : 1.25));
    renderer.localClippingEnabled = true;
    renderer.shadowMap.enabled = high;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(NIGHT.fog.clone(), 300, 1600);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = this.envTexture;
    this.scene = scene;

    this.#lights();
    this.#sky();
    this.#floor();
    this.#pads();

    if (high) {
      const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(renderer, rt);
      this.renderPass = new RenderPass(scene, null);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.5, 1.5);
      this.composer.addPass(this.renderPass);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.dawn = -1;
    this.setDawn(0);
  }

  #lights() {
    this.hemi = new THREE.HemisphereLight();
    this.key = new THREE.DirectionalLight();
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0005;
    this.key.shadow.normalBias = 0.08;
    Object.assign(this.key.shadow.camera, { left: -190, right: 190, top: 190, bottom: -190, near: 1, far: 1400 });
    this.rim = new THREE.DirectionalLight();
    // at night a soft light rides with the camera, so whatever we look at
    // shows its paint (craft seen from below would otherwise go dark)
    this.fill = new THREE.DirectionalLight('#c8d4ff', 0);
    this.keyDir = new THREE.Vector3();
    this.scene.add(this.hemi, this.key, this.key.target, this.rim, this.rim.target, this.fill, this.fill.target);
  }

  #sky() {
    this.skyU = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
    };
    const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
      vertexShader: `varying vec3 vDir;
void main() {
  vDir = normalize( position );
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p.xyww;
}`,
      fragmentShader: `uniform vec3 uZenith, uHorizon, uGlow, uGround;
varying vec3 vDir;
void main() {
  float y = normalize( vDir ).y;
  vec3 c = y > 0.0 ? mix( uHorizon, uZenith, pow( clamp( y, 0.0, 1.0 ), 0.5 ) ) : mix( uHorizon, uGround, clamp( -y * 5.0, 0.0, 1.0 ) );
  c += uGlow * exp( -abs( y ) * 10.0 ) * 0.6;
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    }));
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    this.sky = sky;

    // stars on the upper sky, twinkling
    const n = 1600, pos = new Float32Array(n * 3), seed = new Float32Array(n);
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const u = rnd(), v = rnd() * 0.95 + 0.05;
      const th = u * Math.PI * 2, y = v ** 0.8;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * r * 9, y * 9, Math.sin(th) * r * 9], i * 3);
      seed[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.starU = { uTime: { value: 0 }, uFade: { value: 1 }, uScale: { value: 1 } };
    const stars = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.starU, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float seed; uniform float uTime, uScale; varying float vA;
void main() {
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p.xyww;
  vA = ( 0.35 + 0.65 * seed ) * ( 0.65 + 0.35 * sin( uTime * ( 1.0 + seed * 3.0 ) + seed * 40.0 ) );
  gl_PointSize = ( 1.0 + 2.2 * seed * seed ) * uScale;
}`,
      fragmentShader: `uniform float uFade; varying float vA;
void main() {
  float d = length( gl_PointCoord - 0.5 );
  gl_FragColor = vec4( vec3( 0.85, 0.9, 1.0 ) * vA * uFade * smoothstep( 0.5, 0.0, d ), 1.0 );
}`,
    }));
    stars.renderOrder = -9;
    stars.frustumCulled = false;
    this.stars = stars;
    this.scene.add(sky, stars);
  }

  #floor() {
    const rings = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -100, 0));
    this.ringIndex = 0;
    this.floorU = {
      uTime: { value: 0 }, uIgnite: { value: 0 }, uDawn: { value: 0 },
      uRings: { value: rings },
      uFogColor: { value: new THREE.Color() }, uFogNear: { value: 300 }, uFogFar: { value: 1600 },
      uDayBase: { value: lin('#f2f7ff') }, uDayLine: { value: lin('#dae1eb') },
      uCell: { value: GRID_CELL },
    };
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      uniforms: this.floorU, toneMapped: false,
      // (the plane is one big quad: distance is worked out per pixel from the
      // interpolated view position, never interpolated itself)
      vertexShader: `varying vec3 vW; varying vec3 vView;
void main() {
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vW = w.xyz;
  vec4 mv = viewMatrix * w;
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: `uniform float uTime, uIgnite, uDawn, uCell, uFogNear, uFogFar;
uniform vec4 uRings[ 8 ];
uniform vec3 uFogColor, uDayBase, uDayLine;
varying vec3 vW; varying vec3 vView;
// coverage of grid lines of half-width w every 'cell' units, anti-aliased,
// fading to their average where they get thinner than a pixel
float grid( vec2 p, float cell, float w ) {
  vec2 fw = max( fwidth( p ), vec2( 1e-4 ) );
  vec2 d = abs( fract( p / cell - 0.5 ) - 0.5 ) * cell;
  vec2 a = 1.0 - smoothstep( w - fw, w + fw, d );
  float fade = 1.0 - smoothstep( 0.06, 0.3, max( fw.x, fw.y ) / cell );
  return mix( 2.0 * w / cell, max( a.x, a.y ), fade );
}
void main() {
  vec2 p = vW.xz;
  float r = length( p );
  // night: dark floor, cyan lines; ignition ripples out from the centre
  float on = 1.0 - smoothstep( uIgnite - 40.0, uIgnite, r );
  float front = exp( -abs( r - uIgnite ) / 7.0 ) * step( 1.0, uIgnite );
  float minor = grid( p, uCell, 0.09 );
  float major = grid( p, uCell * 4.0, 0.17 );
  float pulse = 0.0;
  for ( int k = 0; k < 8; k++ ) {
    vec4 g = uRings[ k ];
    float age = uTime - g.z;
    if ( g.w <= 0.0 || age < 0.0 || age > 4.0 ) continue;
    float d = length( p - g.xy );
    pulse += g.w * exp( -pow( ( d - age * 75.0 ) / 4.0, 2.0 ) ) * exp( -age * 1.3 );
  }
  float glow = on * ( 0.55 + 0.45 * exp( -r / 500.0 ) );
  vec3 night = vec3( 0.006, 0.010, 0.026 ) + vec3( 0.01, 0.03, 0.07 ) * glow * 0.4;
  vec3 lineC = vec3( 0.12, 0.55, 1.25 );
  night += lineC * ( minor * 0.16 + major * 0.75 ) * glow;
  night += lineC * ( minor + major ) * ( front * 3.0 + pulse * 2.5 );
  night += vec3( 0.05, 0.25, 0.6 ) * ( front * 0.35 + pulse * 0.25 );
  // day: the viewer's arena
  vec3 day = mix( uDayBase, uDayLine, grid( p, uCell, 0.11 ) );
  vec3 c = mix( night, day, uDawn );
  c = mix( c, uFogColor, smoothstep( uFogNear, uFogFar, length( vView ) ) );
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    }));
    floor.renderOrder = -5;
    this.floor = floor;

    this.shadowMat = new THREE.ShadowMaterial({ color: '#02030a', opacity: 0.5, depthWrite: false });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2), this.shadowMat);
    shadow.position.y = 0.03;
    shadow.receiveShadow = true;
    shadow.renderOrder = -4;
    this.shadowPlane = shadow;
    this.scene.add(floor, shadow);
  }

  // A pulse ring rippling out over the floor grid from (x, z).
  ring(x, z, t, strength = 1) {
    this.floorU.uRings.value[this.ringIndex++ % 8].set(x, z, t, strength);
  }

  #pads() {
    const shape = (w, r) => {
      const s = new THREE.Shape();
      s.moveTo(-w + r, -w);
      s.lineTo(w - r, -w); s.quadraticCurveTo(w, -w, w, -w + r);
      s.lineTo(w, w - r); s.quadraticCurveTo(w, w, w - r, w);
      s.lineTo(-w + r, w); s.quadraticCurveTo(-w, w, -w, w - r);
      s.lineTo(-w, -w + r); s.quadraticCurveTo(-w, -w, -w + r, -w);
      return s;
    };
    const outline = shape(19, 6);
    outline.holes.push(shape(18.55, 5.6));
    const geo = new THREE.ShapeGeometry(outline, 6).rotateX(-Math.PI / 2);
    // corner ticks, like a printer bed
    this.pads = [];
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.12, 0.5, 1.1), transparent: true, opacity: 0, depthWrite: false, toneMapped: false, fog: false,
      }));
      m.position.y = 0.06; // placed under each craft's pad by the show
      m.renderOrder = -3;
      this.pads.push(m);
      this.scene.add(m);
    }
  }

  // 0 = night, 1 = the viewer's daylight (matte lighting); between: dawn.
  setDawn(k) {
    if (k === this.dawn) return;
    this.dawn = k;
    const e = k * k * (3 - 2 * k);
    const sunrise = Math.sin(Math.PI * Math.min(1, k * 1.15)) * (k < 0.87 ? 1 : 0);
    const mixC = (a, b, t) => a.clone().lerp(b, t);
    for (const part of ['zenith', 'horizon', 'glow', 'ground']) {
      const c = mixC(NIGHT.sky[part], DAY.sky[part], e).lerp(SUNRISE[part], sunrise * 0.85);
      this.skyU[`u${part[0].toUpperCase()}${part.slice(1)}`].value.copy(c);
    }
    this.scene.fog.color.copy(mixC(NIGHT.fog, DAY.fog, e));
    this.floorU.uFogColor.value.copy(this.scene.fog.color);
    this.floorU.uDawn.value = e;
    this.starU.uFade.value = Math.max(0, 1 - k * 2.2);
    this.hemi.color.copy(mixC(NIGHT.hemi.sky, DAY.hemi.sky, e));
    this.hemi.groundColor.copy(mixC(NIGHT.hemi.ground, DAY.hemi.ground, e));
    this.hemi.intensity = THREE.MathUtils.lerp(NIGHT.hemi.intensity, DAY.hemi.intensity, e);
    this.key.color.copy(mixC(NIGHT.key.color, DAY.key.color, e)).lerp(lin('#ffd2b0'), sunrise * 0.5);
    this.key.intensity = THREE.MathUtils.lerp(NIGHT.key.intensity, DAY.key.intensity, e);
    this.keyDir.copy(NIGHT.key.dir).lerp(DAY.key.dir, e).normalize();
    this.rim.color.copy(mixC(NIGHT.rim.color, DAY.rim.color, e));
    this.rim.intensity = THREE.MathUtils.lerp(NIGHT.rim.intensity, DAY.rim.intensity, e);
    this.scene.environmentIntensity = THREE.MathUtils.lerp(NIGHT.env, DAY.env, e);
    this.renderer.toneMappingExposure = THREE.MathUtils.lerp(NIGHT.exposure, DAY.exposure, e);
    this.shadowMat.opacity = THREE.MathUtils.lerp(NIGHT.shadow, DAY.shadow, e);
    this.shadowMat.color.copy(mixC(lin('#02030a'), lin('#2b4a7a'), e));
    if (this.bloom) this.bloom.strength = 0.8 * (1 - e);
    this.fill.intensity = 0.95 * (1 - e);
  }

  // Exactly the viewer's Sprite-style lighting, so the top view matches the
  // flat sprites (no tone mapping, no shadows, no bloom, no fog).
  spriteLighting() {
    const s = SCENES.sprite;
    this.spriteLit = true;
    this.renderer.toneMapping = s.toneMapping;
    this.renderer.toneMappingExposure = s.exposure;
    this.scene.environmentIntensity = s.env;
    this.keyDir.set(...s.key.dir).normalize();
    this.key.color.set('#ffffff');
    this.key.intensity = s.key.intensity;
    this.hemi.color.set(s.hemi.sky);
    this.hemi.groundColor.set(s.hemi.ground);
    this.hemi.intensity = s.hemi.intensity;
    this.rim.intensity = s.rim;
    this.fill.intensity = 0;
    this.key.castShadow = false;
    this.shadowMat.opacity = 0;
    this.scene.fog.near = 1e6;
    this.scene.fog.far = 2e6;
    this.floorU.uFogNear.value = 1e6;
    this.floorU.uFogFar.value = 2e6;
    if (this.bloom) this.bloom.enabled = false;
  }

  // Per frame, before rendering: keep sky/stars around the camera, the shadow
  // camera on the action, fog relative to the camera.
  update(camera, focus, t, fogDist = 0) {
    this.floorU.uTime.value = t;
    this.starU.uTime.value = t;
    this.starU.uScale.value = this.renderer.getPixelRatio();
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.key.target.position.copy(focus);
    this.key.position.copy(focus).addScaledVector(this.keyDir, 600);
    this.rim.position.set(-0.8, 0.45, -0.6).multiplyScalar(600).add(focus);
    this.rim.target.position.copy(focus);
    this.fill.position.copy(camera.position);
    this.fill.target.position.copy(focus);
    if (!this.spriteLit) {
      this.scene.fog.near = fogDist + 260;
      this.scene.fog.far = fogDist + 1500;
      this.floorU.uFogNear.value = this.scene.fog.near;
      this.floorU.uFogFar.value = this.scene.fog.far;
    }
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.composer?.setSize(w, h);
  }

  render(camera) {
    if (this.composer && !this.spriteLit) {
      this.renderPass.camera = camera;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, camera);
    }
  }

  // Drop to the light settings (slow device).
  degrade() {
    if (this.quality === 'low') return;
    this.quality = 'low';
    this.renderer.shadowMap.enabled = false;
    this.key.castShadow = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.composer = null;
  }

  dispose() {
    this.composer?.dispose?.();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this.envTexture.dispose();
    this.renderer.dispose();
  }
}
