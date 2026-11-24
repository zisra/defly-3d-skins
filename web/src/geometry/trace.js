// ---------------------------------------------------------------------------
// Outline tracing for raster sprites.
//
// traceShapes(field, w, h, level) finds where a scalar image (usually alpha,
// 0..1) crosses `level` (marching squares, with sub-pixel interpolation so
// anti-aliased edges give smooth outlines), joins the pieces into closed
// loops, and sorts them into shapes: { outline, holes } in pixel coordinates
// (x right, y down). Tiny specks are dropped.
// ---------------------------------------------------------------------------
export function traceShapes(field, w, h, level = 0.5, { minArea = 6 } = {}) {
  // pad with a zero border so every contour closes
  const W = w + 2, H = h + 2;
  const v = new Float32Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) v[(y + 1) * W + x + 1] = field[y * w + x];
  const at = (x, y) => v[y * W + x];

  // edge ids: horizontal edge (x,y)-(x+1,y) and vertical edge (x,y)-(x,y+1)
  const hId = (x, y) => (y * W + x) * 2;
  const vId = (x, y) => (y * W + x) * 2 + 1;
  const point = new Map(); // edge id -> crossing point
  const cross = (id, x0, y0, x1, y1) => {
    if (!point.has(id)) {
      const a = at(x0, y0), b = at(x1, y1);
      const t = (level - a) / (b - a || 1e-9);
      point.set(id, [x0 + (x1 - x0) * t - 1, y0 + (y1 - y0) * t - 1]); // undo the padding
    }
    return id;
  };
  const next = new Map(); // directed segment: edge id -> edge id (inside on the left)

  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const tl = at(x, y) > level, tr = at(x + 1, y) > level;
      const br = at(x + 1, y + 1) > level, bl = at(x, y + 1) > level;
      const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (c === 0 || c === 15) continue;
      const T = () => cross(hId(x, y), x, y, x + 1, y);
      const B = () => cross(hId(x, y + 1), x, y + 1, x + 1, y + 1);
      const L = () => cross(vId(x, y), x, y, x, y + 1);
      const R = () => cross(vId(x + 1, y), x + 1, y, x + 1, y + 1);
      const seg = (a, b) => next.set(a(), b());
      // segments run with the filled side on the left (y down), so loops are
      // consistently oriented: outlines one way, holes the other
      switch (c) {
        case 1: seg(B, L); break;
        case 2: seg(R, B); break;
        case 3: seg(R, L); break;
        case 4: seg(T, R); break;
        case 5: { // saddle: decide by the centre value
          const centre = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 > level;
          if (centre) { seg(T, L); seg(B, R); } else { seg(T, R); seg(B, L); }
          break;
        }
        case 6: seg(T, B); break;
        case 7: seg(T, L); break;
        case 8: seg(L, T); break;
        case 9: seg(B, T); break;
        case 10: {
          const centre = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 > level;
          if (centre) { seg(R, T); seg(L, B); } else { seg(L, T); seg(R, B); }
          break;
        }
        case 11: seg(R, T); break;
        case 12: seg(L, R); break;
        case 13: seg(B, R); break;
        case 14: seg(L, B); break;
        default: break;
      }
    }
  }

  // walk the directed segments into closed loops
  const loops = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let e = start;
    while (e !== undefined && !seen.has(e)) {
      seen.add(e);
      loop.push(point.get(e));
      e = next.get(e);
    }
    if (loop.length >= 4) loops.push(smoothLoop(loop));
  }

  // sort into outlines and holes by nesting depth
  const items = loops
    .map((l) => ({ l, area: signedArea(l) }))
    .filter((o) => Math.abs(o.area) >= minArea);
  items.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  const shapes = [];
  for (const it of items) {
    const p = it.l[0];
    const parents = items.filter((o) => o !== it && Math.abs(o.area) > Math.abs(it.area) && inside(p, o.l));
    if (parents.length % 2 === 0) shapes.push({ outline: it.l, holes: [], ref: it });
    else {
      // the smallest enclosing outline owns this hole
      const owner = shapes
        .filter((s) => inside(p, s.outline))
        .sort((a, b) => Math.abs(a.ref.area) - Math.abs(b.ref.area))[0];
      if (owner) owner.holes.push(it.l);
    }
  }
  return shapes.map(({ outline, holes }) => ({ outline, holes }));
}

// Traced outlines carry pixel-level wobble that tall walls and rounded rims
// would catch the light on (streaks, crinkled bevels). Resample evenly, then
// smooth without shrinking (Taubin: alternate shrink and inflate steps),
// keeping real corners (sharp turns) where they are.
function smoothLoop(raw) {
  const loop = resampleLoop(raw, 0.6);
  const n = loop.length;
  if (n < 12) return loop;
  const k = 4; // look ~2.4 px either side to judge corners
  const corner = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const [ax, ay] = loop[(i - k + n) % n], [bx, by] = loop[i], [cx, cy] = loop[(i + k) % n];
    const ux = bx - ax, uy = by - ay, vx = cx - bx, vy = cy - by;
    const cos = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1);
    if (cos < Math.cos((38 * Math.PI) / 180)) corner[i] = 1;
  }
  // a corner keeps its immediate neighbours too, so it stays crisp
  const fixed = corner.map((c, i) => c || corner[(i + 1) % n] || corner[(i - 1 + n) % n]);
  let pts = loop.map(([x, y]) => [x, y]);
  for (let it = 0; it < 12; it++) {
    for (const f of [0.55, -0.58]) {
      const next = pts.map((p) => [p[0], p[1]]);
      for (let i = 0; i < n; i++) {
        if (fixed[i]) continue;
        const a = pts[(i - 1 + n) % n], c = pts[(i + 1) % n];
        next[i][0] = pts[i][0] + f * ((a[0] + c[0]) / 2 - pts[i][0]);
        next[i][1] = pts[i][1] + f * ((a[1] + c[1]) / 2 - pts[i][1]);
      }
      pts = next;
    }
  }
  // thin out evenly (corners kept) so later steps aren't slowed by dense loops
  return pts.filter((_, i) => fixed[i] || i % 2 === 0);
}

function resampleLoop(loop, step) {
  let len = 0;
  const seg = loop.map((p, i) => { const q = loop[(i + 1) % loop.length]; const l = Math.hypot(q[0] - p[0], q[1] - p[1]); len += l; return l; });
  const n = Math.max(8, Math.round(len / step));
  const out = [];
  let i = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (k / n) * len;
    while (acc + seg[i] < target && i < loop.length - 1) { acc += seg[i]; i++; }
    const t = seg[i] ? (target - acc) / seg[i] : 0;
    const p = loop[i], q = loop[(i + 1) % loop.length];
    out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
  }
  return out;
}

export function signedArea(l) {
  let a = 0;
  for (let i = 0; i < l.length; i++) {
    const [x0, y0] = l[i], [x1, y1] = l[(i + 1) % l.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function inside([x, y], l) {
  let c = false;
  for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
    const [xi, yi] = l[i], [xj, yj] = l[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
