import * as THREE from 'three';
import Delaunator from 'delaunator';
import { offsetOutline } from './shapes.js';

// ---------------------------------------------------------------------------
// Inflate: any outline (holes allowed) -> a smooth, puffed-up 3D part whose
// top view is exactly that outline. The outline is filled with a dense
// triangle mesh; every vertex is lifted by a profile of its distance to the
// edge, so the edge stays at the "waterline" and the middle rises. The same
// distance gives the printed-outline band (`edge` attribute).
//
// mode 'solid': top and bottom surfaces, closed at the edge.
// mode 'dome' : top surface only, resting on base(x, z) (a part sitting on
//               an earlier one, like a canopy on a fuselage).
// ---------------------------------------------------------------------------
export function inflate(contour, holes, {
  mode = 'solid',
  top, // (d, round, R) => height above the waterline; round = sqrt(2u), a round profile
  bottom = () => 0, // (d, round, R) => depth below it (solid only)
  base = () => 0, // (x, z) => surface under a dome
  band = 1, // printed outline width
  spacing,
}) {
  contour = clean(contour);
  holes = holes.map(clean);
  const loops = [contour, ...holes];
  const area = Math.abs(signedArea(contour)) - holes.reduce((a, h) => a + Math.abs(signedArea(h)), 0);
  const g = spacing ?? THREE.MathUtils.clamp(Math.sqrt(Math.max(area, 0.01)) / 45, 0.04, 0.16);

  // Edges densely sampled so the silhouette is smooth.
  const edgeLoops = loops.map((l) => resample(l, g * 0.6));
  const segs = [];
  for (const l of edgeLoops) for (let i = 0; i < l.length; i++) segs.push([l[i], l[(i + 1) % l.length]]);
  const dist = (p) => {
    let best = Infinity;
    for (const [a, b] of segs) {
      const ex = b.x - a.x, ey = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / (ex * ex + ey * ey || 1)));
      const dx = p.x - (a.x + ex * t), dy = p.y - (a.y + ey * t);
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const inside = (p) => {
    let c = false;
    for (const l of loops) {
      for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
        if ((l[i].y > p.y) !== (l[j].y > p.y) && p.x < (l[j].x - l[i].x) * (p.y - l[i].y) / (l[j].y - l[i].y) + l[i].x) c = !c;
      }
    }
    return c;
  };

  // Interior points: a fine, even triangular lattice. Even spacing keeps the
  // surface and the printed band's edge smooth all the way to the outline.
  const steiner = [];
  const box = new THREE.Box2().setFromPoints(contour);
  const rowH = g * 0.866;
  for (let y = box.min.y + rowH / 2, row = 0; y < box.max.y; y += rowH, row++) {
    for (let x = box.min.x + (row % 2 ? g / 2 : 0); x < box.max.x; x += g) {
      const p = new THREE.Vector2(x, y);
      if (inside(p) && dist(p) > 0.45 * g) steiner.push(p);
    }
  }

  // Delaunay over edge + interior points; keep triangles inside the shape.
  const pts = [...edgeLoops.flat(), ...steiner];
  const nEdge = edgeLoops.reduce((a, l) => a + l.length, 0);
  const del = new Delaunator(pts.flatMap((p) => [p.x, p.y]));
  const faces = [];
  const tri = del.triangles;
  for (let t = 0; t < tri.length; t += 3) {
    const a = pts[tri[t]], b = pts[tri[t + 1]], c = pts[tri[t + 2]];
    const centroid = new THREE.Vector2((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3);
    if (inside(centroid)) faces.push([tri[t], tri[t + 1], tri[t + 2]]);
  }
  const neighbours = pts.map(() => new Set());
  for (const [a, b, c] of faces) {
    neighbours[a].add(b).add(c); neighbours[b].add(a).add(c); neighbours[c].add(a).add(b);
  }
  const smoothValues = (vals, iterations) => {
    for (let it = 0; it < iterations; it++) {
      const next = vals.slice();
      for (let i = nEdge; i < vals.length; i++) {
        let sum = 0;
        for (const j of neighbours[i]) sum += vals[j];
        if (neighbours[i].size) next[i] = 0.5 * vals[i] + 0.5 * sum / neighbours[i].size;
      }
      vals = next;
    }
    return vals;
  };
  const d = pts.map((p, i) => (i < nEdge ? 0 : dist(p)));
  const R = Math.max(...d, 1e-3);

  // Smooth "balloon" height: solve the Poisson equation (Laplacian u = -1,
  // u = 0 on the outline) on the mesh with cotangent weights. sqrt(2u) is
  // exactly a round cross-section for a tube of any width and blends smoothly
  // wherever the width changes: no wobble.
  const n0 = pts.length;
  const W = pts.map(() => new Map());
  const A = new Float64Array(n0);
  for (const f of faces) {
    const P = f.map((k) => pts[k]);
    const area = Math.abs((P[1].x - P[0].x) * (P[2].y - P[0].y) - (P[1].y - P[0].y) * (P[2].x - P[0].x)) / 2;
    for (let k = 0; k < 3; k++) {
      A[f[k]] += area / 3;
      const i = f[k], j = f[(k + 1) % 3], o = P[(k + 2) % 3];
      const ux = P[k].x - o.x, uy = P[k].y - o.y, vx = P[(k + 1) % 3].x - o.x, vy = P[(k + 1) % 3].y - o.y;
      const w = Math.max(0, (ux * vx + uy * vy) / (Math.abs(ux * vy - uy * vx) || 1e-9)) / 2;
      W[i].set(j, (W[i].get(j) ?? 0) + w);
      W[j].set(i, (W[j].get(i) ?? 0) + w);
    }
  }
  const u = new Float64Array(n0);
  const lists = W.map((m) => [...m]);
  for (let it = 0; it < 900; it++) {
    let change = 0;
    for (let i = nEdge; i < n0; i++) {
      let s = 0, ws = 0;
      for (const [j, w] of lists[i]) { s += w * u[j]; ws += w; }
      if (!ws) continue;
      const next = u[i] + 1.85 * ((A[i] + s) / ws - u[i]);
      change = Math.max(change, Math.abs(next - u[i]));
      u[i] = next;
    }
    if (change < 1e-6 * (R * R)) break;
  }
  const M = Array.from(u, (v) => Math.sqrt(2 * Math.max(v, 0))); // round profile height
  const n = pts.length;
  const solid = mode === 'solid';
  const pos = new Float32Array((solid ? 2 : 1) * n * 3);
  const edge = new Float32Array((solid ? 2 : 1) * n);
  const hTop = Float32Array.from(smoothValues(pts.map((p, i) => top(d[i], M[i], R)), 1));
  const hBot = smoothValues(pts.map((p, i) => bottom(d[i], M[i], R)), 1);
  // a dome follows the (blocky) surface beneath it, so smooth what it rests on
  const under = solid ? null : smoothValues(pts.map((p) => base(p.x, p.y)), 4);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const y = solid ? hTop[i] : under[i] + hTop[i];
    pos.set([p.x, y, p.y], i * 3);
    edge[i] = d[i] / band;
    if (solid) {
      pos.set([p.x, -hBot[i], p.y], (n + i) * 3);
      edge[n + i] = d[i] / band;
    }
  }

  // Faces: top faces point up (with z = svg y, a negative 2D cross product
  // means an upward normal), bottom faces down.
  const index = [];
  for (const [a, b, c] of faces) {
    const A = pts[a], B = pts[b], C = pts[c];
    const up = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) < 0;
    if (up) index.push(a, b, c); else index.push(a, c, b);
    if (solid) {
      // the bottom shares the rim with the top, so the surface is smooth all round
      const B = (k) => (k < nEdge ? k : n + k);
      if (up) index.push(B(a), B(c), B(b)); else index.push(B(a), B(b), B(c));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('edge', new THREE.BufferAttribute(edge, 1));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  smoothNormals(geometry, neighbours, n, nEdge, solid, 3);
  // for callers that reshape the part afterwards
  geometry.userData.resmooth = () => {
    geometry.computeVertexNormals();
    smoothNormals(geometry, neighbours, n, nEdge, solid, 3);
  };

  return { geometry, points: pts, hTop, R, area };
}

// Average each interior vertex normal with its neighbours' (top and bottom
// surfaces separately). The surface itself doesn't move; reflections on
// glossy paint just stop showing the mesh's tiny irregularities.
export function smoothNormals(geometry, neighbours, n, nEdge, solid, passes) {
  const nrm = geometry.attributes.normal;
  const surfaces = solid ? [0, n] : [0];
  for (let pass = 0; pass < passes; pass++) {
    const next = Float32Array.from(nrm.array);
    for (const off of surfaces) {
      for (let i = nEdge; i < n; i++) {
        let x = nrm.getX(off + i), y = nrm.getY(off + i), z = nrm.getZ(off + i);
        for (const j of neighbours[i]) {
          const k = j < nEdge && off ? j : off + j; // the rim is shared with the top
          x += nrm.getX(k); y += nrm.getY(k); z += nrm.getZ(k);
        }
        const len = Math.hypot(x, y, z) || 1;
        next.set([x / len, y / len, z / len], (off + i) * 3);
      }
    }
    nrm.array.set(next);
  }
  nrm.needsUpdate = true;
}

// Half-height profile of a round tube of local half-width M at distance d
// from its edge.
export const circ = (d, M) => Math.sqrt(Math.max(0, d * (2 * M - d)));
// Flat top with rounded edges of radius r.
export const pillow = (d, r) => Math.sqrt(Math.max(0, 1 - (1 - Math.min(d / r, 1)) ** 2));
// Smoothly limit v to about `cap`.
export const softCap = (v, cap) => cap * Math.tanh(v / cap);

function clean(loop) {
  const l = loop.map((p) => new THREE.Vector2(p.x, p.y));
  while (l.length > 2 && l[0].distanceTo(l[l.length - 1]) < 1e-6) l.pop();
  return l;
}
export function signedArea(l) {
  let a = 0;
  for (let i = 0; i < l.length; i++) {
    const p = l[i], q = l[(i + 1) % l.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
function resample(loop, step) {
  let len = 0;
  for (let i = 0; i < loop.length; i++) len += loop[i].distanceTo(loop[(i + 1) % loop.length]);
  const n = Math.max(12, Math.min(900, Math.round(len / step)));
  const out = [];
  let seg = 0, segStart = 0;
  const segLen = (i) => loop[i].distanceTo(loop[(i + 1) % loop.length]);
  for (let k = 0; k < n; k++) {
    const target = (k / n) * len;
    while (segStart + segLen(seg) < target && seg < loop.length - 1) { segStart += segLen(seg); seg++; }
    const t = segLen(seg) ? (target - segStart) / segLen(seg) : 0;
    out.push(loop[seg].clone().lerp(loop[(seg + 1) % loop.length], Math.min(1, t)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Heightfield: the highest surface built so far over each top-view cell.
// Parts drawn later in the sprite are placed above whatever they overlap.
// ---------------------------------------------------------------------------
export class Heightfield {
  constructor(box, cell = 0.12) {
    this.cell = cell;
    this.x0 = box.min.x;
    this.z0 = box.min.y;
    this.nx = Math.ceil((box.max.x - box.min.x) / cell) + 1;
    this.nz = Math.ceil((box.max.y - box.min.y) / cell) + 1;
    this.h = new Float32Array(this.nx * this.nz).fill(-Infinity);
  }

  at(x, z) {
    const i = Math.round((x - this.x0) / this.cell), j = Math.round((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return -Infinity;
    return this.h[j * this.nx + i];
  }

  // Smooth (bilinear) height at (x, z); -Infinity where nothing is built.
  sample(x, z) {
    const fx = (x - this.x0) / this.cell, fz = (z - this.z0) / this.cell;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const get = (a, b) => (a < 0 || b < 0 || a >= this.nx || b >= this.nz ? -Infinity : this.h[b * this.nx + a]);
    const c = [get(i, j), get(i + 1, j), get(i, j + 1), get(i + 1, j + 1)];
    const known = c.filter(Number.isFinite);
    if (!known.length) return -Infinity;
    if (known.length < 4) return Math.max(...known);
    return (c[0] * (1 - u) + c[1] * u) * (1 - v) + (c[2] * (1 - u) + c[3] * u) * v;
  }

  // Highest surface within radius r of (x, z).
  maxNear(x, z, r) {
    let m = -Infinity;
    const k = Math.ceil(r / this.cell);
    for (let a = -k; a <= k; a++) for (let b = -k; b <= k; b++) m = Math.max(m, this.at(x + a * this.cell, z + b * this.cell));
    return m;
  }

  // Highest surface inside a circle.
  maxInCircle(cx, cz, r) {
    let m = -Infinity;
    for (let x = cx - r; x <= cx + r; x += this.cell) {
      for (let z = cz - r; z <= cz + r; z += this.cell) {
        if ((x - cx) ** 2 + (z - cz) ** 2 <= r * r) m = Math.max(m, this.at(x, z));
      }
    }
    return m;
  }

  // Record a geometry's top surface (its triangles, seen from above).
  add(geometry, matrix) {
    const p = geometry.attributes.position;
    const v = new THREE.Vector3();
    const xs = [], ys = [], zs = [];
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (matrix) v.applyMatrix4(matrix);
      xs.push(v.x); ys.push(v.y); zs.push(v.z);
    }
    const idx = geometry.index ? geometry.index.array : [...Array(p.count).keys()];
    const c = this.cell;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], d = idx[t + 2];
      const minI = Math.max(0, Math.floor((Math.min(xs[a], xs[b], xs[d]) - this.x0) / c));
      const maxI = Math.min(this.nx - 1, Math.ceil((Math.max(xs[a], xs[b], xs[d]) - this.x0) / c));
      const minJ = Math.max(0, Math.floor((Math.min(zs[a], zs[b], zs[d]) - this.z0) / c));
      const maxJ = Math.min(this.nz - 1, Math.ceil((Math.max(zs[a], zs[b], zs[d]) - this.z0) / c));
      const det = (zs[b] - zs[d]) * (xs[a] - xs[d]) + (xs[d] - xs[b]) * (zs[a] - zs[d]);
      if (Math.abs(det) < 1e-12) continue;
      for (let j = minJ; j <= maxJ; j++) {
        const z = this.z0 + j * c;
        for (let i = minI; i <= maxI; i++) {
          const x = this.x0 + i * c;
          const l1 = ((zs[b] - zs[d]) * (x - xs[d]) + (xs[d] - xs[b]) * (z - zs[d])) / det;
          const l2 = ((zs[d] - zs[a]) * (x - xs[d]) + (xs[a] - xs[d]) * (z - zs[d])) / det;
          const l3 = 1 - l1 - l2;
          if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
          const y = l1 * ys[a] + l2 * ys[b] + l3 * ys[d];
          const k = j * this.nx + i;
          if (y > this.h[k]) this.h[k] = y;
        }
      }
    }
  }
}
