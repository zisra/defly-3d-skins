import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Silhouette loft
//
// Turns a top-view outline (as drawn in the sprite) into a rounded 3D body
// whose top view matches the outline exactly. The outline is sliced along x;
// each slice becomes a cross-section (an ellipse by default) spanning the
// outline's width at that x, with heights given by `top` / `bottom`.
//
// The upper half and lower half are separate geometry groups (0 and 1), so a
// mesh can paint them in different materials (e.g. body on top, trim below).
// ---------------------------------------------------------------------------
export function loftOutline(poly, opts = {}) {
  const {
    rings = 72,
    sides = 48,
    y0 = 0, // number or (x) => number: height of the widest line ("waterline")
    top = (x, w) => w, // half-height above the waterline
    bottom = (x, w) => w, // half-height below the waterline
    power = 2, // cross-section exponent: 2 = ellipse, higher = boxier
  } = opts;
  const yAt = typeof y0 === 'function' ? y0 : () => y0;

  let xmin = Infinity, xmax = -Infinity, iMin = 0, iMax = 0;
  poly.forEach((p, i) => {
    if (p.x < xmin) { xmin = p.x; iMin = i; }
    if (p.x > xmax) { xmax = p.x; iMax = i; }
  });

  const profile = [];
  for (let i = 1; i < rings; i++) {
    const t = i / rings;
    const x = xmin + (xmax - xmin) * (1 - Math.cos(Math.PI * t)) / 2;
    const s = sliceAt(poly, x);
    profile.push({ x, c: s.c, w: s.w, y: yAt(x), top: top(x, s.w), bottom: bottom(x, s.w) });
  }

  const e = 2 / power;
  const spow = (v) => Math.sign(v) * Math.pow(Math.abs(v), e);
  const positions = [];
  const pole0 = { x: xmin, y: yAt(xmin), z: poly[iMin].y };
  const pole1 = { x: xmax, y: yAt(xmax), z: poly[iMax].y };
  positions.push(pole0.x, pole0.y, pole0.z);
  for (const r of profile) {
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const h = sa >= 0 ? r.top : r.bottom;
      positions.push(r.x, r.y + h * spow(sa), r.c + r.w * spow(ca));
    }
  }
  positions.push(pole1.x, pole1.y, pole1.z);

  const ringStart = (i) => 1 + i * sides;
  const last = positions.length / 3 - 1;
  const upper = [], lower = [];
  const half = sides / 2;
  for (let j = 0; j < sides; j++) {
    const jn = (j + 1) % sides;
    const bucket = j < half ? upper : lower;
    // caps
    bucket.push(0, ringStart(0) + j, ringStart(0) + jn);
    const lr = ringStart(profile.length - 1);
    bucket.push(last, lr + jn, lr + j);
    // body
    for (let i = 0; i < profile.length - 1; i++) {
      const a = ringStart(i) + j, b = ringStart(i) + jn;
      const c = ringStart(i + 1) + j, d = ringStart(i + 1) + jn;
      bucket.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex([...upper, ...lower]);
  geometry.addGroup(0, upper.length, 0);
  geometry.addGroup(upper.length, lower.length, 1);
  geometry.computeVertexNormals();

  // Closed loop around the waterline, i.e. along the sprite's outline.
  const waterline = () => {
    const pts = [new THREE.Vector3(pole0.x, pole0.y, pole0.z)];
    for (const r of profile) pts.push(new THREE.Vector3(r.x, r.y, r.c + r.w));
    pts.push(new THREE.Vector3(pole1.x, pole1.y, pole1.z));
    for (let i = profile.length - 1; i >= 0; i--) {
      const r = profile[i];
      pts.push(new THREE.Vector3(r.x, r.y, r.c - r.w));
    }
    return pts;
  };

  // Height of the upper surface at (x, z); -Infinity outside the body.
  const surfaceY = (x, z) => {
    if (x <= xmin || x >= xmax) return -Infinity;
    const r = sampleProfile(profile, x);
    const u = r.w > 0 ? Math.abs(z - r.c) / r.w : 2;
    if (u >= 1) return -Infinity;
    return r.y + r.top * Math.pow(1 - Math.pow(u, power), 1 / power);
  };

  // A piece of the body's skin between x0..x1 and angles a0..a1 (radians,
  // 0 = the +z side at the waterline, positive = upwards), lifted by `offset`.
  // a0/a1 may be functions of u ∈ [0, 1] along x, for tapered panels.
  // Used for windows and panels that hug the body.
  const patch = (x0, x1, a0, a1, { offset = 0.02, rings: pr = 24, cols = 16 } = {}) => {
    const A0 = typeof a0 === 'function' ? a0 : () => a0;
    const A1 = typeof a1 === 'function' ? a1 : () => a1;
    const pos = [];
    const edge = [];
    for (let i = 0; i <= pr; i++) {
      const u = i / pr;
      const r = sampleProfile(profile, THREE.MathUtils.lerp(x0, x1, u));
      for (let j = 0; j <= cols; j++) {
        const a = THREE.MathUtils.lerp(A0(u), A1(u), j / cols);
        const ca = Math.cos(a), sa = Math.sin(a);
        const h = sa >= 0 ? r.top : r.bottom;
        pos.push(r.x, r.y + (h + offset) * spow(sa), r.c + (r.w + offset) * spow(ca));
      }
    }
    const idx = [];
    const row = cols + 1;
    for (let i = 0; i < pr; i++) {
      for (let j = 0; j < cols; j++) {
        const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const at = (i, j) => new THREE.Vector3(pos[(i * row + j) * 3], pos[(i * row + j) * 3 + 1], pos[(i * row + j) * 3 + 2]);
    for (let j = 0; j <= cols; j++) edge.push(at(0, j));
    for (let i = 1; i <= pr; i++) edge.push(at(i, cols));
    for (let j = cols - 1; j >= 0; j--) edge.push(at(pr, j));
    for (let i = pr - 1; i > 0; i--) edge.push(at(i, 0));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return { geometry: g, edge };
  };

  return { geometry, profile, waterline, surfaceY, patch, sample: (x) => sampleProfile(profile, x) };
}

// Move every point of a closed, smooth outline inward by d (outward if d < 0).
// Sprite strokes are centred on the path, so insetting the body by half the
// stroke and running a stroke-wide seam along the original path reproduces
// the sprite's fill + outline exactly from above.
export function offsetOutline(poly, d) {
  const n = poly.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  const sign = area > 0 ? 1 : -1;
  return poly.map((p, i) => {
    const a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
    const tx = b.x - a.x, ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    return new THREE.Vector2(p.x - (ty / len) * d * sign, p.y + (tx / len) * d * sign);
  });
}

// Printed outline: stores on every vertex its top-view (x, z) distance to the
// outline `poly`, divided by `width`, as the `edge` attribute that the paint*
// materials turn into a colour band (see styles.js). Build the part from the
// outline grown by half the sprite stroke and pass the stroke width here: from
// above, the band then covers exactly where the sprite draws its stroke.
export function edgeBand(geometry, poly, width) {
  const pos = geometry.attributes.position;
  const edge = new Float32Array(pos.count);
  const loops = Array.isArray(poly[0]) ? poly : [poly]; // an outline, or [outline, ...holes]
  const segs = loops.flatMap((l) => l.map((a, i) => [a, l[(i + 1) % l.length]]));
  for (let v = 0; v < pos.count; v++) {
    const px = pos.getX(v), pz = pos.getZ(v);
    let best = Infinity;
    for (const [a, b] of segs) {
      const ex = b.x - a.x, ez = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((px - a.x) * ex + (pz - a.y) * ez) / (ex * ex + ez * ez || 1)));
      const dx = px - (a.x + ex * t), dz = pz - (a.y + ez * t);
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    edge[v] = Math.sqrt(best) / width;
  }
  geometry.setAttribute('edge', new THREE.BufferAttribute(edge, 1));
  return geometry;
}

// A dome draped over a top-view footprint: its rim sits on base(x, z) and it
// rises by height * across(s) * along(u), where s ∈ [-1, 1] runs across the
// footprint and u ∈ [0, 1] along it. Used for canopies sitting on a body.
export function drapeDome(poly, {
  base = () => 0,
  height = 1,
  along = (u) => Math.sin(Math.PI * u),
  across = (s) => Math.sqrt(Math.max(0, 1 - s * s)),
  rings = 48,
  cols = 32,
} = {}) {
  let xmin = Infinity, xmax = -Infinity;
  for (const p of poly) { xmin = Math.min(xmin, p.x); xmax = Math.max(xmax, p.x); }
  const positions = [];
  for (let i = 0; i <= rings; i++) {
    const u = i / rings;
    const t = (1 - Math.cos(Math.PI * u)) / 2;
    const x = THREE.MathUtils.lerp(xmin + 1e-3, xmax - 1e-3, t);
    const sl = sliceAt(poly, x);
    for (let j = 0; j <= cols; j++) {
      const s = -Math.cos(Math.PI * (j / cols)); // denser near the rim
      const z = sl.c + s * sl.w;
      positions.push(x, base(x, z) + height * across(s) * along(t), z);
    }
  }
  const index = [];
  const row = cols + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// Vertical extent of a closed outline at a given x.
export function sliceAt(poly, x) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    if ((a.x <= x && b.x >= x) || (b.x <= x && a.x >= x)) {
      const t = b.x === a.x ? 0.5 : (x - a.x) / (b.x - a.x);
      const y = a.y + (b.y - a.y) * t;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  if (lo > hi) return { c: 0, w: 0 };
  return { c: (lo + hi) / 2, w: (hi - lo) / 2 };
}

function sampleProfile(profile, x) {
  if (x <= profile[0].x) return { ...profile[0] };
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i], b = profile[i + 1];
    if (x <= b.x) {
      const t = (x - a.x) / (b.x - a.x);
      const lerp = (k) => a[k] + (b[k] - a[k]) * t;
      return { x, c: lerp('c'), w: lerp('w'), y: lerp('y'), top: lerp('top'), bottom: lerp('bottom') };
    }
  }
  return { ...profile[profile.length - 1] };
}

// A tube following a list of points (closed by default). Used for the dark
// outline seams that echo the sprite's strokes.
export function tubeAlong(points, radius, { closed = true, segments, radial = 10 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  return new THREE.TubeGeometry(curve, segments ?? Math.max(64, points.length * 2), radius, radial, closed);
}

// ---------------------------------------------------------------------------
// Slab: a top-view shape extruded upward with soft, pillowy bevels. The bevel
// is inset so the top view still matches the shape.
// ---------------------------------------------------------------------------
export function slab(shapeOrPoints, { bottomY = 0, height = 1, bevel = 0.2, grow = 0, segments = 6, curveSegments = 24 } = {}) {
  const shape = shapeOrPoints instanceof THREE.Shape ? shapeOrPoints : new THREE.Shape(shapeOrPoints);
  const b = Math.min(bevel, height / 2 - 1e-3);
  const depth = Math.max(height - 2 * b, 1e-3);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: grow - b, // grow > 0 enlarges the outline, < 0 shrinks it
    bevelSegments: segments,
    curveSegments,
  });
  // Shape plane (x, y) -> world (x, z); extrusion goes downward, so lift it.
  g.rotateX(Math.PI / 2);
  g.translate(0, bottomY + depth + b, 0);
  g.computeVertexNormals();
  return g;
}

// Side-view profile extruded sideways (e.g. a tail fin). Points are (x, y)
// in the side view; the result is centred on z = 0 with the given thickness.
export function sidePlate(points, { thickness = 0.3, bevel = 0.1, segments = 4 } = {}) {
  const shape = new THREE.Shape(points);
  const b = Math.min(bevel, thickness / 2 - 1e-3);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(thickness - 2 * b, 1e-3),
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelOffset: -b,
    bevelSegments: segments,
    curveSegments: 16,
  });
  g.translate(0, 0, -thickness / 2 + b);
  return g;
}

// Rounded rectangle as a Shape, centred on (cx, cy).
export function roundedRect(cx, cy, w, h, r) {
  const x = cx - w / 2, y = cy - h / 2;
  r = Math.min(r, w / 2, h / 2);
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// Smooth lathe from a few (radius, height) control points.
export function smoothLathe(control, { samples = 64, segments = 96 } = {}) {
  const curve = new THREE.SplineCurve(control.map(([r, y]) => new THREE.Vector2(r, y)));
  const pts = curve.getSpacedPoints(samples).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  return new THREE.LatheGeometry(pts, segments);
}

// Cylinder lying along +x from x0 to x1.
export function cylinderX(x0, x1, r0, r1 = r0, radial = 24) {
  const g = new THREE.CylinderGeometry(r1, r0, Math.abs(x1 - x0), radial);
  g.rotateZ(-Math.PI / 2);
  g.translate((x0 + x1) / 2, 0, 0);
  return g;
}

// Translucent disc that suggests spinning blades: faint, densest near the tips.
export function blurDisc(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  const k = inner / outer;
  grad.addColorStop(0, 'rgba(70,80,95,0)');
  grad.addColorStop(k, 'rgba(90,100,115,0.02)');
  grad.addColorStop(0.86, 'rgba(90,100,115,0.06)');
  grad.addColorStop(0.95, 'rgba(90,100,115,0.13)');
  grad.addColorStop(1, 'rgba(90,100,115,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(outer, 96).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, toneMapped: false, side: THREE.DoubleSide }),
  );
  m.renderOrder = 2;
  return m;
}

export function mesh(geometry, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
