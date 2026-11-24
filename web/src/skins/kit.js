import * as THREE from 'three';
import { tubeAlong, mesh } from '../geometry/shapes.js';

// Shared hardware, so every craft is fitted the same way. None of it shows
// from above: skids and legs sit under the body, the mast under the hub,
// muzzles on the front face of a gun.
export const KIT = {
  skidRadius: 0.2,
  strutRadius: 0.14,
  mastRadius: [0.4, 0.55], // top, bottom
  legRadius: 0.16,
};

// Landing skids: two runners from x0 to x1 at ±halfSpan from centre line c,
// with upturned fronts, each held by two raked struts from the belly (bellyY).
export function addSkids(root, mats, { x0, x1, c = 0, halfSpan, bellyY, groundY, strutInset = 0.5 }) {
  const L = x1 - x0;
  for (const side of [-1, 1]) {
    const z = c + side * halfSpan;
    root.add(mesh(tubeAlong([
      new THREE.Vector3(x0 - 0.04 * L, groundY + 0.12, z),
      new THREE.Vector3(x0, groundY, z),
      new THREE.Vector3(x1 - 0.12 * L, groundY, z),
      new THREE.Vector3(x1 - 0.02 * L, groundY + 0.3, z),
      new THREE.Vector3(x1 + 0.04 * L, groundY + 0.85, z),
    ], KIT.skidRadius, { closed: false, segments: 64 }), mats.metalDark));
    for (const t of [0.22, 0.72]) {
      const x = x0 + t * L;
      root.add(mesh(tubeAlong([
        new THREE.Vector3(x, bellyY, c + side * halfSpan * strutInset),
        new THREE.Vector3(x - 0.15, groundY + 0.6, z - side * 0.03),
        new THREE.Vector3(x - 0.2, groundY, z),
      ], KIT.strutRadius, { closed: false, segments: 24 }), mats.metalDark));
    }
  }
}

// Rotor mast from the body (footY) up to the hub (topY), at (x, z).
export function addMast(root, mats, { x = 0, z = 0, footY, topY }) {
  const m = mesh(new THREE.CylinderGeometry(KIT.mastRadius[0], KIT.mastRadius[1], topY - footY, 24), mats.metal);
  m.position.set(x, (topY + footY) / 2, z);
  root.add(m);
  return m;
}

// Dark bore on the front (+x) face of a gun.
export function addMuzzle(root, mats, { x, y, z, radius }) {
  const bore = mesh(new THREE.CircleGeometry(radius, 28).rotateY(Math.PI / 2), mats.rubber, { cast: false });
  bore.position.set(x + 0.004, y, z);
  root.add(bore);
  return bore;
}

// Landing leg under a pod: a strut with a rubber foot.
export function addLeg(root, mats, { x, z, topY, groundY }) {
  root.add(mesh(tubeAlong([
    new THREE.Vector3(x, topY, z),
    new THREE.Vector3(x, (topY + groundY) / 2, z),
    new THREE.Vector3(x, groundY, z),
  ], KIT.legRadius, { closed: false, segments: 12 }), mats.metalDark));
  const pad = mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.18, 20), mats.rubber);
  pad.position.set(x, groundY, z);
  root.add(pad);
}
