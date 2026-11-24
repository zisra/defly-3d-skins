import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

// Read-only view of one skin SVG, addressed by the element ids Inkscape gave
// each part. All coordinates are SVG units, re-centred on the skin's pivot
// (the centre of its invisible export frame), so x = forward (the nose points
// right in the sprite) and y = sideways. Recipes map that onto 3D as
// (x, height, y): 3D x = svg x, 3D z = svg y, 3D y = up.
export class SkinSvg {
  static async load(url, pivotId = null) {
    const text = await (await fetch(url)).text();
    return new SkinSvg(text, pivotId);
  }

  constructor(text, pivotId) {
    const data = new SVGLoader().parse(text);
    this.byId = new Map();
    for (const path of data.paths) {
      const id = path.userData.node?.id;
      if (id) this.byId.set(id, path);
    }
    this.paths = data.paths;
    // Pivot = centre of the frame element (the invisible export square around
    // the sprite; the largest unfilled, unstroked rect if not given).
    pivotId ??= this.#findFrame();
    this.pivotId = pivotId;
    this.origin = new THREE.Vector2();
    this.origin.copy(this.#rawBox(pivotId).getCenter(new THREE.Vector2()));

    // The file's viewBox, pivot-relative: where the sprite image sits in 3D
    // (x, z), used to overlay the original for comparison.
    const vb = text.match(/viewBox="([^"]+)"/)?.[1].trim().split(/[\s,]+/).map(Number);
    this.text = text;
    this.viewBox = vb && { x: vb[0] - this.origin.x, y: vb[1] - this.origin.y, w: vb[2], h: vb[3] };
  }

  #findFrame() {
    let best = null, bestArea = 0;
    for (const p of this.paths) {
      const n = p.userData.node, st = p.userData.style;
      if (n?.tagName !== 'rect' || (st.fill && st.fill !== 'none') || (st.stroke && st.stroke !== 'none')) continue;
      const b = new THREE.Box2();
      for (const sp of p.subPaths) for (const q of sp.getPoints(4)) b.expandByPoint(q);
      const s = b.getSize(new THREE.Vector2());
      if (s.x * s.y > bestArea) { bestArea = s.x * s.y; best = n.id; }
    }
    return best;
  }

  // Every drawn element in draw order (bottom first), with its style and the
  // id of the group it sits in. Frames (no fill, no stroke) are left out.
  elements() {
    const out = [];
    for (const p of this.paths) {
      const n = p.userData.node, st = p.userData.style;
      const fill = st.fill && st.fill !== 'none' ? hex(st.fill) : null;
      const stroke = st.stroke && st.stroke !== 'none' ? hex(st.stroke) : null;
      if (!n?.id || (!fill && !stroke)) continue;
      out.push({
        id: n.id, tag: n.tagName, fill, stroke, strokeWidth: stroke ? st.strokeWidth : 0,
        parent: n.parentNode?.id ?? null, path: p,
      });
    }
    return out;
  }

  // Sub-paths as pivot-relative point lists, each flagged closed or open.
  subpaths(id, samples = 160) {
    return this.path(id).subPaths.map((sp) => {
      const raw = sp.getPoints(48);
      const closed = sp.autoClose || raw[0].distanceTo(raw[raw.length - 1]) < 1e-3;
      const pts = (closed ? sp.getSpacedPoints(samples) : sp.getPoints(24)).map((p) => p.clone().sub(this.origin));
      if (closed && pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
      return { points: pts, closed };
    });
  }

  // Filled regions (outline + holes) as pivot-relative point lists.
  regions(id, samples = 200) {
    return this.path(id).toShapes().map((shape) => ({
      outline: shape.getSpacedPoints(samples).map((p) => p.sub(this.origin)),
      holes: shape.holes.map((h) => h.getSpacedPoints(Math.round(samples / 2)).map((p) => p.sub(this.origin))),
    }));
  }

  has(id) {
    return this.byId.has(id);
  }

  path(id) {
    const p = this.byId.get(id);
    if (!p) throw new Error(`Skin SVG has no element #${id}`);
    return p;
  }

  // Closed outlines (one per sub-path), evenly resampled, pivot-relative.
  outlines(id, samples = 160) {
    return this.path(id).subPaths.map((sp) => {
      const pts = sp.getSpacedPoints(samples).map((p) => p.clone().sub(this.origin));
      if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
      return pts;
    });
  }

  outline(id, samples = 160) {
    return this.outlines(id, samples)[0];
  }

  // Filled shapes (holes resolved), translated to pivot-relative coordinates.
  shapes(id) {
    return this.path(id).toShapes().map((shape) => {
      const s = new THREE.Shape(shape.getPoints(24).map((p) => p.sub(this.origin)));
      for (const h of shape.holes) s.holes.push(new THREE.Path(h.getPoints(24).map((p) => p.sub(this.origin))));
      return s;
    });
  }

  box(id) {
    const b = this.#rawBox(id);
    b.min.sub(this.origin);
    b.max.sub(this.origin);
    return b;
  }

  center(id) {
    return this.box(id).getCenter(new THREE.Vector2());
  }

  strokeWidth(id) {
    return this.path(id).userData.style.strokeWidth ?? 0;
  }

  // Straight stroked line (e.g. a spoke): returns its start/end points.
  segment(id) {
    const pts = this.path(id).subPaths[0].getPoints(1);
    return [pts[0].clone().sub(this.origin), pts[pts.length - 1].clone().sub(this.origin)];
  }

  #rawBox(id) {
    const box = new THREE.Box2();
    for (const sp of this.path(id).subPaths) for (const p of sp.getPoints(32)) box.expandByPoint(p);
    return box;
  }
}

// '#00B2E1' / 'rgb(0, 178, 225)' -> '#00b2e1'
function hex(c) {
  return '#' + new THREE.Color().setStyle(c, THREE.NoColorSpace).getHexString(THREE.NoColorSpace);
}
