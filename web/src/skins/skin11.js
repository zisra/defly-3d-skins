import { autoRecipe } from './auto.js';

// Skin 11, "Wasp": the automatic build, given an insect character: a taller
// body and curved side blades drooping like wings.
export default autoRecipe({
  tall: 1.3,
  parts: { 'path8380-4': { droop: 16 } },
  extras({ root, mats, svg, hf, mesh, THREE }) {
    const tail = svg.box('path6734-1-1'); // tail with its bulb
    const z = (tail.min.y + tail.max.y) / 2;
    const surf = (x) => { const h = hf.sample(x, z); return Number.isFinite(h) ? h : 0; };
    // the tail only touches the body end to end in the sprite: join them with
    // a dark collar (from above it reads as the outlines meeting)
    const xj = tail.max.x;
    const yj = Math.min(surf(xj - 0.9), surf(xj + 0.9)) - 0.5;
    const collar = mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.8, 28).rotateZ(Math.PI / 2), mats.trim);
    collar.position.set(xj, yj, z);
    root.add(collar);
  },
});
