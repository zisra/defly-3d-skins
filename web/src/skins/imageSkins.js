import * as THREE from 'three';
import { pillow, softCap } from '../geometry/inflate.js';

// Hand-tuning for the PNG-layer skins (see image.js for the builder).
//
// shape(info) may return, for any traced part:
//   { shell: { top, bottom, bevel }, spacing }  a hard-shell part (vertical
//       walls, crisp bevelled edges); top/bottom are (x, z, panel, round) =>
//       height above / depth below the waterline
//   { top, bottom, spacing }  a smooth part; (d, round, R, panel, x, z) => height
//   d      distance to the part's outline (world units)
//   round  smooth "balloon" height of the whole part (round cross-sections)
// info: { layer, role, index, area, box, centroid, outline, holeLoops, covered,
//         outlined, flat, spinning, tinted, skin, spin, placed, material, frame }

const smooth = (a, b, x) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = THREE.MathUtils.lerp;

// Armour plating: a hard shell of height H(x, z) with a slight crown. The
// art's drawn lines are printed on it, not cut in (like every other skin).
function armour(info, { H, crown = 0.08, under = 0.7, bevel = 0.4 }) {
  const h = typeof H === 'function' ? H : () => H;
  return {
    shell: {
      bevel,
      top: (x, z, panel, round) => h(x, z) + crown * round,
      bottom: (x, z, panel, round) => under * h(x, z) + 0.4 * crown * round,
    },
    spacing: 0.1,
  };
}

// Rigid grey hardware (gun blocks, gears): flat top and bottom, crisp edges.
const block = (T, bevel = 0.12, spacing = 0.08) => ({
  shell: { bevel, top: () => T, bottom: () => T },
  spacing,
});

const isGun = (info) => info.role === 'notint' && info.covered < 0.6;

export default {
  // ---------------------------------------------------------------- 17 Talon
  // A twin-wing fighter: a tall armoured fuselage, thick wings thinning to
  // their tips, crisp edges and panel lines.
  17: {
    shape(info) {
      if (info.role === 'base') {
        return armour(info, {
          H: (x, z) => {
            const a = Math.abs(z);
            return lerp(3.6, 2.7, smooth(2.6, 4.8, a)) - 1.2 * smooth(5, 11.5, a);
          },
          bevel: 0.38,
        });
      }
      if (isGun(info)) return block(0.9);
      return null;
    },
  },

  // ---------------------------------------------------------------- 19 Bulwark
  // A heavy armoured hull with two lift-fan ducts; the tail fin thinner.
  19: {
    shape(info) {
      if (info.role === 'base') return armour(info, { H: (x) => lerp(1.6, 3.2, smooth(-11.5, -6.5, x)), bevel: 0.42 });
      if (isGun(info)) return block(0.9);
      return null;
    },
  },

  // ---------------------------------------------------------------- 28 Orbiter
  // Chunky and round: a near-spherical core and pods, thick side rails, and
  // ball weights on the orbiting arms.
  28: {
    orbit: true, // the weights circle the pods
    shape(info) {
      if (info.role === 'base') {
        return {
          top: (d, round) => softCap(1.15 * round, 5.2),
          bottom: (d, round) => softCap(1.0 * round, 4.6),
          spacing: 0.1,
        };
      }
      if (info.role === 'rotor') { // the weights at the end of the orbiting arcs: low, flattened
        return { top: (d, round) => 0.4 * round, bottom: (d, round) => 0.35 * round, spacing: 0.06 };
      }
      if (isGun(info)) return block(0.6, 0.1, 0.06);
      return null;
    },
  },

  // ---------------------------------------------------------------- 55 Cogwork
  // A gearbox: three thick, crisp gears stacked under a raised frame plate,
  // whose hubs are tall tread drums on axles through the gears, with a button
  // cap in the middle.
  55: {
    spinGap: 0.04, // gears stacked close together
    shape(info) {
      if (info.role === 'rotor') return block(0.28, 0.08, 0.09); // gears: thin, crisp-edged teeth
      if (info.role === 'base') return armour(info, { H: 1.3, crown: 0.04, under: 0.85, bevel: 0.3 });
      if (info.role === 'notint' && info.covered >= 0.6) return { top: (d) => 1.0 * pillow(d, 0.55) }; // centre cap
      if (isGun(info)) return block(0.65, 0.1, 0.06);
      return null;
    },
    extras({ root, mats, parts, mesh: makeMesh }) {
      const frame = parts.find((p) => p.role === 'base');
      if (!frame) return;
      const gears = parts.filter((p) => p.role === 'rotor' && p.holeLoops.length);
      for (const gear of gears) {
        const hole = gear.holeLoops[0];
        const c = hole.reduce((a, p) => a.add(p), new THREE.Vector2()).divideScalar(hole.length);
        const r = hole.reduce((a, p) => a + p.distanceTo(c), 0) / hole.length;
        // Hub housing: the hubs are flush with the frame (as drawn); under each,
        // a bevelled housing reaches down to its gear, painted with the frame's
        // art so its sides take the frame's dark edge tone. Hidden from above.
        const top = frame.placed.min.y + 0.3, bot = gear.placed.max.y + 0.03;
        if (top - bot > 0.1) {
          const hr = Math.max(r * 1.6, 1.2), b = Math.min(0.2, (top - bot) / 3);
          const prof = [new THREE.Vector2(0, bot)];
          for (let k = 0; k <= 5; k++) { const t = (k / 5) * Math.PI / 2; prof.push(new THREE.Vector2(hr - b + b * Math.sin(t), bot + b - b * Math.cos(t))); }
          prof.push(new THREE.Vector2(hr, top), new THREE.Vector2(0, top));
          const g = new THREE.LatheGeometry(prof, 72).translate(c.x, 0, c.y);
          frame.projectUV(g);
          root.add(makeMesh(g, frame.material));
        }
        // Axle: the gear turns on a shaft rising into its housing.
        const y0 = gear.placed.min.y - 0.2, y1 = top - bot > 0.1 ? bot + 0.1 : gear.placed.max.y + 0.05;
        const axle = makeMesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, y1 - y0, 32), mats.metal);
        axle.position.set(c.x, (y0 + y1) / 2, c.y);
        root.add(axle);
      }
    },
  },

  // ---------------------------------------------------------------- 99 Serpent
  99: { muzzles: false },
};

// The frame's hubs: the round lobes at each gear's centre, with their radius
// measured from the outline (the farthest outline points facing away from
// the frame's centre).
function hubsOf(info) {
  const centres = info.skin.layers.filter((l) => l.role === 'rotor').map((l) => new THREE.Vector2(l.cx, l.cz));
  const mid = info.centroid;
  return centres.map((c) => {
    const out = c.clone().sub(mid).normalize();
    let r = 0;
    for (const p of info.outline) {
      const v = p.clone().sub(c);
      if (v.length() > 0.5 && v.clone().normalize().dot(out) > 0.7) r = Math.max(r, v.length());
    }
    return { x: c.x, z: c.y, r: r || 2.5 };
  });
}
