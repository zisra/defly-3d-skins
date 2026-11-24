import * as THREE from 'three';
import {
  loftOutline, offsetOutline, edgeBand, drapeDome, tubeAlong, sidePlate,
  roundedRect, mesh,
} from '../geometry/shapes.js';
import { addSkids, addMast, addMuzzle } from './kit.js';

// Skin 01, "Gunship": attack helicopter, nose pointing +x.
//
// Built so the Top view reproduces the sprite. Each part seen from above is
// one smooth shape the size of the sprite element including its stroke, with
// the stroke *printed* on it as a darker band (edgeBand + the paint*
// materials). Stacking follows the sprite's draw order (gun < tail < pods <
// fuselage < canopy < rotor): parts drawn later sit higher and cover the
// earlier ones, as in 2D. Invented parts (skids, mast, fin) are hidden from
// above or match what the sprite shows there.
//
// Sprite elements (skin_01.svg):
//   rect7195  export frame, centre = rotor hub (pivot)
//   rect7197  gun                    path7199  tail boom + stabiliser
//   path7201  two side pods          path7203  fuselage
//   path7205  canopy                 g7217     rotor: rect7207..7213, circle7215
//   ellipse7219 tail rotor
export default {
  pivot: 'rect7195',

  build({ svg, mats }) {
    const root = new THREE.Group();

    // A smooth lofted part whose top view is `poly` grown by half the stroke,
    // with the stroke printed along its edge.
    const printedLoft = (poly, sw, material, opts) => {
      const outer = offsetOutline(poly, -sw / 2);
      const loft = loftOutline(outer, opts);
      edgeBand(loft.geometry, outer, sw);
      root.add(mesh(loft.geometry, material));
      return loft;
    };
    // Team-colour part straight from a sprite element.
    const paintedPart = (id, opts, { samples = 240 } = {}) =>
      svg.outlines(id, samples).map((poly) => printedLoft(poly, svg.strokeWidth(id), mats.paint, opts));
    // Grey block (flat-topped, rounded) with the sprite's darker grey outline.
    const greyBlock = (poly, sw, opts) => printedLoft(poly, sw, mats.paintMetal, { power: 6, rings: 80, sides: 56, ...opts });
    const rectPoly = (cx, cz, w, h, r) => {
      const pts = roundedRect(cx, cz, w, h, r).getSpacedPoints(200);
      pts.pop();
      return pts;
    };

    // --- Fuselage ---------------------------------------------------------------
    const [fuse] = paintedPart('path7203', {
      rings: 120, sides: 80, y0: 0,
      top: (x, w) => w * 0.95,
      bottom: (x, w) => w * 0.82,
    });
    const fuseTop = (x) => { const s = fuse.sample(x); return s.y + s.top; };

    // --- Canopy: a glass dome draped over the fuselage, frame printed on ---------
    const csw = svg.strokeWidth('path7205');
    const canopyOuter = offsetOutline(svg.outline('path7205', 200), -csw / 2);
    const canopy = drapeDome(canopyOuter, {
      base: (x, z) => fuse.surfaceY(x, z) - 0.03,
      height: 0.95,
      along: (u) => Math.sin(Math.PI * Math.pow(u, 0.62)), // tall at the back, sloping to the nose
      rings: 64, cols: 48,
    });
    edgeBand(canopy, canopyOuter, csw);
    root.add(mesh(canopy, mats.paintGlass));

    // --- Side pods (sponsons), slung below the fuselage's widest line -------------
    paintedPart('path7201', {
      rings: 70, sides: 56, y0: -1.9,
      top: (x, w) => w * 0.82,
      bottom: (x, w) => w * 0.8,
    }, { samples: 180 });

    // --- Tail boom + stabiliser ------------------------------------------------------
    // Low where it meets the fuselage so the fuselage's tail tip stays on top,
    // as in the sprite; flattened at the stabiliser.
    const tb = svg.box('path7199');
    const stab = tb.min.x + 1.3; // stabiliser ends about here
    const tailY = (x) => THREE.MathUtils.lerp(0.3, -0.6, smooth(tb.min.x + 1, -5, x));
    const cap = (x, a, b) => THREE.MathUtils.lerp(a, b, smooth(stab - 0.2, stab + 0.5, x));
    const [tail] = paintedPart('path7199', {
      rings: 160, sides: 48, y0: tailY,
      top: (x, w) => Math.min(w * 0.9, cap(x, 0.28, 0.66)),
      bottom: (x, w) => Math.min(w * 0.8, cap(x, 0.22, 0.55)),
    }, { samples: 300 });
    const tailTop = (x) => { const s = tail.sample(x); return s.y + s.top; };

    // --- Fin with a fenestron (ducted tail rotor) on top ------------------------------
    // From above, the fenestron is the sprite's thin blue tail-rotor ellipse.
    const tr = svg.center('ellipse7219');
    const trBox = svg.box('ellipse7219');
    const trSw = svg.strokeWidth('ellipse7219');
    const trR = (trBox.max.x - trBox.min.x) / 2 + trSw / 2;
    const trHalf = (trBox.max.y - trBox.min.y) / 2 + trSw / 2;
    const ringY = tailTop(tr.x) + 1.35;
    const finBase = tailTop(tr.x) - 0.15;
    const fin = mesh(sidePlate([
      new THREE.Vector2(tb.min.x + 0.2, finBase),
      new THREE.Vector2(tr.x + 1.5, finBase),
      new THREE.Vector2(tr.x + 0.5, ringY),
      new THREE.Vector2(tr.x - 0.5, ringY),
      new THREE.Vector2(tb.min.x + 0.05, finBase + 1.0),
    ], { thickness: 0.14, bevel: 0.05 }), mats.body);
    fin.position.z = tr.y;
    root.add(fin);

    const duct = new THREE.LatheGeometry([
      new THREE.Vector2(trR - 0.3, -trHalf), new THREE.Vector2(trR - 0.04, -trHalf),
      new THREE.Vector2(trR, -trHalf + 0.04), new THREE.Vector2(trR, trHalf - 0.04),
      new THREE.Vector2(trR - 0.04, trHalf), new THREE.Vector2(trR - 0.3, trHalf),
      new THREE.Vector2(trR - 0.3, -trHalf),
    ], 64).rotateX(Math.PI / 2).translate(tr.x, ringY, tr.y);
    const trOuter = svg.outline('ellipse7219', 120).map((p) => {
      const d = p.clone().sub(tr);
      return tr.clone().add(d.setLength(d.length() + trSw / 2));
    });
    edgeBand(duct, trOuter, trSw);
    root.add(mesh(duct, mats.paint));
    const fan = new THREE.Group();
    fan.position.set(tr.x, ringY, tr.y);
    fan.add(mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 16).rotateX(Math.PI / 2), mats.metalDark));
    for (let i = 0; i < 7; i++) {
      const b = mesh(new THREE.BoxGeometry(trR - 0.35, 0.1, 0.02).translate((trR - 0.35) / 2, 0, 0), mats.metal);
      b.rotation.set(0.5, 0, (i / 7) * Math.PI * 2);
      fan.add(b);
    }
    root.add(fan);

    // --- Gun: one chunky cannon under the nose ----------------------------------------
    // Its top stays below the fuselage's widest line, so the nose covers all
    // but its tip, as in the sprite.
    const gb = svg.box('rect7197');
    const gsw = svg.strokeWidth('rect7197');
    const gc = gb.getCenter(new THREE.Vector2());
    const gs = gb.getSize(new THREE.Vector2());
    const gunH = 1.2;
    const gunMid = -0.45 - gunH / 2;
    greyBlock(rectPoly(gc.x, gc.y, gs.x, gs.y, 0.15), gsw, {
      y0: gunMid, top: () => gunH / 2, bottom: () => gunH / 2,
    });
    addMuzzle(root, mats, { x: gb.max.x + gsw / 2, y: gunMid, z: gc.y, radius: 0.38 });

    // --- Landing skids (shared kit; hidden from above, under the fuselage) -------------
    addSkids(root, mats, {
      x0: -3.4, x1: 3.0, c: fuse.sample(0).c, halfSpan: 2.2,
      bellyY: -fuse.sample(0).bottom * 0.6, groundY: -fuse.sample(0).bottom - 1.9,
    });

    // --- Main rotor --------------------------------------------------------------------
    const hubR = svg.box('circle7215').getSize(new THREE.Vector2()).x / 2;
    const hubSw = svg.strokeWidth('circle7215');
    const mastBase = fuseTop(0) - 0.2;
    const hubY = fuseTop(0) + 1.3;
    addMast(root, mats, { footY: mastBase, topY: hubY });

    // The rotor is built in its own frame (origin at the hub) and spins as a group.
    const rotor = new THREE.Group();
    rotor.position.y = hubY;
    const rotorParts = new THREE.Group();
    const addTo = (group, m) => { root.remove(m); group.add(m); return m; };

    // hub: a grey puck with the sprite's dark ring printed round its edge, above the blades
    const hubPoly = [];
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      hubPoly.push(new THREE.Vector2(Math.cos(a) * hubR, Math.sin(a) * hubR));
    }
    greyBlock(hubPoly, hubSw, { y0: 0.25, top: () => 0.28, bottom: () => 0.28, power: 8 });
    addTo(rotorParts, root.children.at(-1));

    const bladeSw = svg.strokeWidth('rect7207');
    const bladeW = 1.02; // the blade rect's width in SVG units
    let bladeLen = 0;
    for (const id of ['rect7207', 'rect7209', 'rect7211', 'rect7213']) {
      // each blade rect starts at the hub, so its centre lies half-way along it
      const pts = svg.outline(id, 64);
      const mid = pts.reduce((a, p) => a.add(p), new THREE.Vector2()).divideScalar(pts.length);
      bladeLen = mid.length() * 2;
      greyBlock(rectPoly(bladeLen / 2, 0, bladeLen, bladeW, 0.06), bladeSw, {
        y0: 0, top: () => 0.08, bottom: () => 0.07, power: 4, rings: 120, sides: 32,
      });
      const blade = addTo(new THREE.Group(), root.children.at(-1)).parent;
      blade.rotation.order = 'YXZ';
      blade.rotation.set(0.05, -Math.atan2(mid.y, mid.x), -0.02); // pitch, direction, slight droop
      rotorParts.add(blade);
    }
    rotor.add(rotorParts);
    root.add(rotor);

    // --- Animation ------------------------------------------------------------------------
    let spool = null; // 0..1 rotor speed, eased towards the Spin toggle
    return {
      object: root,
      update(dt, t, state) {
        spool = THREE.MathUtils.damp(spool ?? (state.spin ? 1 : 0), state.spin ? 1 : 0, 1.6, dt);
        rotor.rotation.y -= dt * spool * 9.5;
        fan.rotation.z -= dt * spool * 30;
      },
    };
  },
};

function smooth(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
