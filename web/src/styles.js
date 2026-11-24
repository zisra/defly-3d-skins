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
  let tint = { body: '#3d5dff', trim: '#0a2fee' };
  const tinted = new Set(); // image materials that follow the team colour

  // Image-painted materials (for skins made from PNG layers): the style's own
  // paint (or metal) with the layer image projected on it. Tinted ones are
  // multiplied by the team colour, exactly like the game tints its sprites.
  // Cached per style + image, and remembered on the material so a style switch
  // can find the matching material in the other set.
  const cache = new Map();
  for (const [id, set] of Object.entries(sets)) {
    Object.defineProperty(set, 'textured', {
      enumerable: false,
      value: (opts) => {
        const key = `${id}|${opts.key}|${opts.tinted ? 't' : 'u'}|${opts.kind ?? 'paint'}|${opts.resting ? 'r' : ''}|${opts.hard ? 'h' : ''}`;
        if (cache.has(key)) return cache.get(key);
        const m = (opts.kind === 'metal' ? set.metal : set.body).clone();
        m.name = '';
        m.userData.tex = opts;
        m.color.set(opts.tinted ? tint.body : '#ffffff');
        if (m.sheenColor) m.sheenColor.set(opts.tinted ? tint.body : '#ffffff');
        m.map = opts.map;
        // the part's 3D outline already follows the art (holes included), so
        // the image's own alpha isn't used to cut it: on steep sides, where the
        // image is stretched, that cut leaves ragged drips
        m.alphaTest = opts.alphaTest ?? 0;
        if (opts.bump) { m.bumpMap = opts.bump; m.bumpScale = opts.bumpScale ?? 1; }
        // On steep sides the art (projected from above) would stretch into
        // streaks: fade to the layer's edge tone there (its outline shade,
        // times the team colour when tinted), like the printed outlines
        // wrapping down the sides of the other skins, and fade the relief too.
        const sideTone = opts.sideTone ?? 0.6;
        // hard shells: the whole bevel and wall take the edge tone; smooth parts
        // only their near-vertical silhouette band, so their painted art stays
        const [s0, s1] = opts.hard ? [0.55, 0.88] : [0.12, 0.38];
        m.onBeforeCompile = (sh) => {
          sh.uniforms.uSideTone = { value: sideTone };
          sh.vertexShader = 'varying float vUp;\n' + sh.vertexShader.replace(
            '#include <beginnormal_vertex>',
            '#include <beginnormal_vertex>\n  vUp = abs(normalize(mat3(modelMatrix) * objectNormal).y);',
          );
          sh.fragmentShader = 'uniform float uSideTone;\nvarying float vUp;\n' + sh.fragmentShader
            // the steeper the surface, the blurrier the art it samples: art
            // stretched down a slope shades smoothly instead of streaking
            .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv, (1.0 - smoothstep(0.25, 0.9, vUp)) * 3.5 );
  diffuseColor *= sampledDiffuseColor;
#endif`)
            // steepness from the per-pixel shading normal (smooth), not a
            // per-vertex value, which zigzags across the mesh's triangles
            .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
  {
    float upness = abs( normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz ).y );
    diffuseColor.rgb = mix( diffuse * uSideTone, diffuseColor.rgb, smoothstep( ${s0.toFixed(2)}, ${s1.toFixed(2)}, upness ) );
  }`)
            .replace('#include <bumpmap_pars_fragment>',
              THREE.ShaderChunk.bumpmap_pars_fragment.replace('return vec2( dBx, dBy );', 'return vec2( dBx, dBy ) * smoothstep( 0.55, 0.88, vUp );'));
        };
        // the tone is baked per shader: materials sharing a compiled shader
        // only get their onBeforeCompile run once
        m.customProgramCacheKey = () => `image-side-${opts.bump ? 'b' : ''}-${opts.hard ? 'h' : 's'}-${sideTone.toFixed(3)}`;
        if (opts.resting) {
          // a part lying on another: near its rim the two surfaces almost touch,
          // so bias its depth towards the camera to stop them flickering
          m.polygonOffset = true;
          m.polygonOffsetFactor = -1;
          m.polygonOffsetUnits = -4;
        }
        m.needsUpdate = true;
        if (opts.tinted) tinted.add(m);
        cache.set(key, m);
        return m;
      },
    });
  }

  return {
    sets,
    setTint({ body, trim }) {
      tint = { body, trim };
      for (const m of tinted) {
        m.color.set(body);
        if (m.sheenColor) m.sheenColor.set(body);
      }
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
  const swap = (m) => (m.userData?.tex ? set.textured(m.userData.tex) : (set[m.name] ?? m));
  object.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
}
