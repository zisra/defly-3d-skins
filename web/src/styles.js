import * as THREE from 'three';

// Render styles. Each style is a full material set with the same role names
// (so a built model can switch style by swapping materials) plus the lighting
// that goes with it.
//
//   body       main paint           (sprite fill  #00b2e1)
//   trim       darker paint/edges   (sprite stroke #0088ac)
//   glow       emissive team colour
//   metal      grey parts           (sprite #999999)
//   metalDark  grey outlines        (sprite #727272)
//   rubber     near-black details
//   glass      canopy               (grey in the sprite)
//   light      white emissive
export const STYLE_LIST = [
  { id: 'matte', label: 'Matte', hint: 'Realistic, muted paint' },
  { id: 'sprite', label: 'Sprite', hint: 'Flat cel shading, closest to the 2D art' },
  { id: 'glossy', label: 'Glossy', hint: 'Shiny toy plastic' },
];

const PI = Math.PI;

// Lighting per style. Lit-from-above surfaces should come out at the sprite's
// own colours, so the top view matches the 2D art.
export const SCENES = {
  matte: {
    toneMapping: THREE.NeutralToneMapping,
    exposure: 1.0,
    env: 0.2,
    key: { dir: [0.3, 1, 0.38], intensity: 1.85 },
    hemi: { sky: '#ffffff', ground: '#c3cddc', intensity: 1.0 },
    rim: 0.3,
    shadow: 0.18,
  },
  sprite: {
    toneMapping: THREE.NoToneMapping,
    exposure: 1.0,
    env: 0,
    key: { dir: [0.02, 1, 0.03], intensity: 0.84 * PI },
    hemi: { sky: '#ffffff', ground: '#ffffff', intensity: 0.16 * PI },
    rim: 0,
    shadow: 0,
  },
  glossy: {
    toneMapping: THREE.NeutralToneMapping,
    exposure: 1.0,
    env: 0.55,
    key: { dir: [0.3, 1, 0.43], intensity: 1.8 },
    hemi: { sky: '#ffffff', ground: '#c9d6ea', intensity: 0.7 },
    rim: 0.8,
    shadow: 0.22,
  },
};

// Edge-band ("printed outline") materials. A mesh carries a per-vertex
// `edge` attribute: its top-view distance from the part's outline divided by
// the outline width (see shapes.js edgeBand). Where that is below 1 the
// surface is painted in the band colour, with an anti-aliased boundary, so the
// sprite's outline becomes paint on one smooth surface.
function banded(material, bandColor) {
  const uBand = { value: new THREE.Color(bandColor) };
  material.userData.band = uBand.value;
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uBandColor = uBand;
    sh.vertexShader = 'attribute float edge;\nvarying float vEdge;\n'
      + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vEdge = edge;');
    sh.fragmentShader = 'uniform vec3 uBandColor;\nvarying float vEdge;\n'
      + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  float bandAA = fwidth(vEdge) * 0.75 + 1e-4;
  diffuseColor.rgb = mix(diffuseColor.rgb, uBandColor, 1.0 - smoothstep(1.0 - bandAA, 1.0 + bandAA, vEdge));`);
  };
  material.customProgramCacheKey = () => 'edge-band';
  return material;
}

// Adds the printed-outline roles to a set:
//   paint       body colour with a trim-colour edge band (team-coloured parts)
//   paintMetal  metal with a metalDark edge band (grey parts)
//   paintGlass  glass with a metalDark edge band (canopy)
function named(set) {
  set.paint = banded(set.body.clone(), set.trim.color);
  set.paintMetal = banded(set.metal.clone(), set.metalDark.color);
  set.paintGlass = banded(set.glass.clone(), set.metalDark.color);
  for (const [role, m] of Object.entries(set)) m.name = role;
  return set;
}

function matteSet() {
  const paint = { roughness: 0.62, metalness: 0 };
  return named({
    body: new THREE.MeshStandardMaterial({ ...paint }),
    trim: new THREE.MeshStandardMaterial({ ...paint, roughness: 0.7 }),
    glow: new THREE.MeshStandardMaterial({ color: '#000000', emissiveIntensity: 2.0 }),
    metal: new THREE.MeshStandardMaterial({ color: '#929497', metalness: 0.15, roughness: 0.55 }),
    metalDark: new THREE.MeshStandardMaterial({ color: '#626365', metalness: 0.15, roughness: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#2e3238', roughness: 0.85 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: '#9ba3a9', metalness: 0.1, roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.08,
    }),
    light: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.4 }),
  });
}

function toonRamp() {
  // dot(n, l) mapped to 0..1 across 8 texels. Anything facing the light more
  // than ~75° gets the full colour, so the top view stays flat like the sprite.
  const steps = [0.5, 0.5, 0.5, 0.62, 0.8, 1, 1, 1];
  const data = new Uint8Array(steps.map((v) => Math.round(v * 255)));
  const tex = new THREE.DataTexture(data, steps.length, 1, THREE.RedFormat);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function spriteSet() {
  const gradientMap = toonRamp();
  const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap, ...extra });
  return named({
    body: toon('#00b2e1'),
    trim: toon('#0088ac'),
    glow: toon('#000000', { emissiveIntensity: 1.4 }),
    metal: toon('#999999'),
    metalDark: toon('#727272'),
    rubber: toon('#33373d'),
    glass: toon('#999999'),
    light: toon('#ffffff', { emissive: '#ffffff', emissiveIntensity: 1 }),
  });
}

function glossySet() {
  const paint = { roughness: 0.38, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.12, sheen: 0.25, sheenRoughness: 0.6 };
  return named({
    body: new THREE.MeshPhysicalMaterial({ ...paint }),
    trim: new THREE.MeshPhysicalMaterial({ ...paint, roughness: 0.45, clearcoat: 0.6 }),
    glow: new THREE.MeshStandardMaterial({ color: '#000000', emissiveIntensity: 2.2 }),
    metal: new THREE.MeshPhysicalMaterial({ color: '#8f949a', metalness: 0.75, roughness: 0.34, clearcoat: 0.3, clearcoatRoughness: 0.2 }),
    metalDark: new THREE.MeshStandardMaterial({ color: '#6c7178', metalness: 0.85, roughness: 0.4 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#2a2f36', metalness: 0.1, roughness: 0.75 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: '#22303b', metalness: 0.05, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8,
    }),
    light: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.6 }),
  });
}

export function createStyles() {
  const sets = { matte: matteSet(), sprite: spriteSet(), glossy: glossySet() };
  return {
    sets,
    setTint({ body, trim }) {
      for (const set of Object.values(sets)) {
        set.body.color.set(body);
        set.trim.color.set(trim);
        set.glow.color.set(body);
        set.glow.emissive.set(body);
        set.paint.color.set(body);
        set.paint.userData.band.set(trim);
        if (set.paint.sheenColor) set.paint.sheenColor.set(body);
        if (set.body.sheenColor) set.body.sheenColor.set(body);
        if (set.trim.sheenColor) set.trim.sheenColor.set(trim);
      }
    },
  };
}

// Swap every role material in a built model for the given style's.
export function applyStyle(object, set) {
  object.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material)
      ? o.material.map((m) => set[m.name] ?? m)
      : (set[o.material.name] ?? o.material);
  });
}
