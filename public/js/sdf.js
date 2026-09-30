// ふくらんだ形をつくるための距離関数とメッシュ化（Surface Nets）
// three.js に依存しないので Web Worker からも使える

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const TAU = Math.PI * 2;

export function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// ---------------------------------------------------------------------------
// 2D の距離関数
// ---------------------------------------------------------------------------
function capsule(px, py, s) {
  const [ax, ay, bx, by, r] = s;
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay || 1e-9), 0, 1);
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

function arc(cx, cy, r, from, to, steps = 14) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
  }
  return pts;
}

function segmentsOf(polys, r) {
  const segs = [];
  for (const pts of polys) {
    for (let i = 0; i < pts.length - 1; i++) {
      segs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r]);
    }
  }
  return segs;
}

function strokesField(segs, k) {
  // 遠い線分は境界ボックスで先に除外する
  const boxes = segs.map(([ax, ay, bx, by]) => [Math.min(ax, bx), Math.max(ax, bx), Math.min(ay, by), Math.max(ay, by)]);
  return (x, y) => {
    let d = 1e9;
    for (let i = 0; i < segs.length; i++) {
      const b = boxes[i];
      const dx = x < b[0] ? b[0] - x : x > b[1] ? x - b[1] : 0;
      const dy = y < b[2] ? b[2] - y : y > b[3] ? y - b[3] : 0;
      if (Math.hypot(dx, dy) - segs[i][4] > d + k) continue;
      d = smin(d, capsule(x, y, segs[i]), k);
    }
    return d;
  };
}

function roundRect(px, py, bx, by, r) {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function heart(px, py) {
  // iq の sdHeart（先端が y=0、上端が y≈1）
  px = Math.abs(px);
  if (py + px > 1) return Math.hypot(px - 0.25, py - 0.75) - Math.SQRT2 / 4;
  const a = (px - 0) ** 2 + (py - 1) ** 2;
  const m = 0.5 * Math.max(px + py, 0);
  const b = (px - m) ** 2 + (py - m) ** 2;
  return Math.sqrt(Math.min(a, b)) * Math.sign(px - py);
}

// ---------------------------------------------------------------------------
// 文字（高さ1の骨格を、太い線でなぞる）
// ---------------------------------------------------------------------------
const H = Math.PI / 2;
export const GLYPH_R = 0.23;
export const GLYPHS = {
  D: { width: 0.76, polys: [[[0, 0], [0, 1], [0.26, 1], ...arc(0.26, 0.5, 0.5, H, -H), [0.26, 0], [0, 0]]] },
  A: { width: 1.08, polys: [[[0, 0], [0.54, 1], [1.08, 0]], [[0.12, 0.14], [0.96, 0.14]]] },
  R: {
    width: 0.8,
    polys: [
      [[0, 0], [0, 1]],
      [[0, 1], [0.3, 1], ...arc(0.3, 0.68, 0.32, H, -H), [0.3, 0.36], [0, 0.36]],
      [[0.3, 0.36], [0.8, 0]],
    ],
  },
};

// ---------------------------------------------------------------------------
// 2D の形を、風船のように厚みを持たせた 3D の陰関数にする
//   Re: ふちの丸みの幅 / T: 厚み / bulge: 内側のふくらみ
// ---------------------------------------------------------------------------
function inflate(d2, { T, Re, bulge = 0.35 }) {
  const height = (d) => {
    if (d >= 0) return 0;
    const u = -d / Re;
    if (u < 1) return T * Math.sqrt(1 - (1 - u) * (1 - u));
    const e = u - 1;
    return T * (1 + (bulge * e * e) / (1 + e));
  };
  return {
    d2,
    profile: height,
    height: (x, y) => height(d2(x, y)),
    F: (x, y, z) => {
      const d = d2(x, y);
      return Math.max(d, 0) + Math.abs(z) - height(d);
    },
  };
}

// ---------------------------------------------------------------------------
// 形のカタログ（Worker とメインスレッドで同じ spec から同じ形をつくる）
// ---------------------------------------------------------------------------
export function buildShape(spec) {
  switch (spec.kind) {
    case "glyph": {
      const g = GLYPHS[spec.ch];
      const r = GLYPH_R;
      // 文字の中心を原点に
      const polys = g.polys.map((pts) => pts.map(([x, y]) => [x - g.width / 2, y - 0.5]));
      const d2 = strokesField(segmentsOf(polys, r), 0.07);
      const s = inflate(d2, { T: r * 1.05, Re: r, bulge: 0.5 });
      const hw = g.width / 2 + r + 0.08;
      return { ...s, bounds: [-hw, hw, -0.5 - r - 0.08, 0.5 + r + 0.08, -0.42, 0.42], step: 0.017 };
    }
    case "smile": {
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const t = -1 + (2 * i) / 24;
        pts.push([t * 0.9, -(1 - t * t) * 0.26 + 0.13]);
      }
      const r = 0.2;
      const s = inflate(strokesField(segmentsOf([pts], r), 0.02), { T: r * 1.05, Re: r, bulge: 0.3 });
      return { ...s, bounds: [-1.2, 1.2, -0.42, 0.42, -0.3, 0.3], step: 0.017 };
    }
    case "blob": {
      const d2 = blob2d(spec.shape);
      const T = spec.shape === "circle" ? 1 : 0.62;
      const Re = spec.shape === "circle" ? 1 : 0.62;
      const s = inflate(d2, { T, Re, bulge: 0.35 });
      return { ...s, bounds: [-1.45, 1.45, -1.45, 1.45, -1.1, 1.1], step: 0.028 };
    }
    case "icon": {
      const d2 = icon2d(spec.shape);
      const s = inflate(d2, { T: 0.2, Re: 0.2, bulge: 0.45 });
      return { ...s, bounds: [-0.78, 0.78, -0.72, 0.78, -0.34, 0.34], step: 0.013 };
    }
    case "cluster": {
      // 小さな玉がくっついた形（ヒーローのまわりに浮かぶ）
      const balls = spec.balls;
      const F = (x, y, z) => {
        let d = 1e9;
        for (const [cx, cy, cz, r] of balls) d = smin(d, Math.hypot(x - cx, y - cy, z - cz) - r, 0.12);
        return d;
      };
      return { F, height: () => 0, bounds: [-1, 1, -1, 1, -0.8, 0.8], step: 0.02 };
    }
    default:
      throw new Error(`unknown shape ${spec.kind}`);
  }
}

function polar(fn, scale = 0.75) {
  return (x, y) => {
    const r = Math.hypot(x, y);
    const a = Math.atan2(y, x);
    return (r - fn(a)) * scale;
  };
}

function blob2d(shape) {
  switch (shape) {
    case "cloud":
      // ぽこぽこした、少しいびつな星
      return polar((a) => 1.0 + 0.2 * Math.cos(5 * a + 0.9) + 0.06 * Math.cos(2 * a + 0.4) + 0.04 * Math.sin(3 * a));
    case "heart": {
      const s = 1.85;
      return (x, y) => heart(x / s, (y + 0.9) / s) * s - 0.2;
    }
    case "flower":
      return (x, y) => {
        let d = Math.hypot(x, y) - 0.62;
        for (let i = 0; i < 5; i++) {
          const a = H + (i * TAU) / 5;
          d = smin(d, Math.hypot(x - Math.cos(a) * 0.62, y - Math.sin(a) * 0.62) - 0.47, 0.25);
        }
        return d;
      };
    case "circle":
      return (x, y) => Math.hypot(x, y) - 1;
    case "star":
      return polar((a) => 0.74 + 0.5 * Math.pow(0.5 + 0.5 * Math.cos(5 * (a - H)), 1.7), 0.7);
    case "starfish":
      return polar((a) => 0.82 + 0.42 * Math.pow(0.5 + 0.5 * Math.cos(5 * (a - H) + 0.25), 1.3) + 0.04 * Math.cos(2 * a), 0.72);
    default:
      throw new Error(`unknown blob ${shape}`);
  }
}

function icon2d(shape) {
  switch (shape) {
    case "invite": {
      // 人 + プラス
      const plus = segmentsOf([[[0.36, -0.2], [0.68, -0.2]], [[0.52, -0.36], [0.52, -0.04]]], 0.075);
      return (x, y) => {
        const head = Math.hypot(x + 0.1, y - 0.3) - 0.24;
        const bx = (x + 0.1) / 0.44;
        const by = (y + 0.34) / 0.3;
        let body = (Math.hypot(bx, by) - 1) * 0.3;
        body = Math.max(body, -(y + 0.46));
        let d = smin(head, body, 0.05);
        for (const s of plus) d = Math.min(d, capsule(x, y, s));
        return d;
      };
    }
    case "chat":
      return (x, y) => {
        const bubble = (Math.hypot(x / 0.62, (y - 0.08) / 0.5) - 1) * 0.5;
        const tail = capsule(x, y, [-0.22, -0.24, -0.46, -0.5, 0.07]);
        return smin(bubble, tail, 0.12);
      };
    case "photo":
      return (x, y) => roundRect(x, y - 0.03, 0.5, 0.44, 0.2);
    case "lock": {
      const shackle = segmentsOf([[[-0.25, 0.05], [-0.25, 0.28], ...arc(0, 0.28, 0.25, Math.PI, 0, 12), [0.25, 0.28], [0.25, 0.05]]], 0.08);
      return (x, y) => {
        let d = roundRect(x, y + 0.2, 0.44, 0.34, 0.18);
        for (const s of shackle) d = Math.min(d, capsule(x, y, s));
        return d;
      };
    }
    default:
      throw new Error(`unknown icon ${shape}`);
  }
}

// ---------------------------------------------------------------------------
// Surface Nets：陰関数から滑らかなメッシュをつくる
// ---------------------------------------------------------------------------
export function polygonize(shape, bounds, step) {
  const { F } = shape;
  const [x0, x1, y0, y1, z0, z1] = bounds;
  const nx = Math.ceil((x1 - x0) / step) + 1;
  const ny = Math.ceil((y1 - y0) / step) + 1;
  const nz = Math.ceil((z1 - z0) / step) + 1;
  const v = new Float32Array(nx * ny * nz);
  let n = 0;
  if (shape.d2 && shape.profile) {
    // ふくらませた形は z によらない 2D の距離を先に計算しておく
    const g = new Float32Array(nx * ny);
    const h = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const d = shape.d2(x0 + i * step, y0 + j * step);
        g[i + j * nx] = Math.max(d, 0);
        h[i + j * nx] = shape.profile(d);
      }
    }
    for (let k = 0; k < nz; k++) {
      const az = Math.abs(z0 + k * step);
      for (let m = 0; m < nx * ny; m++) v[n++] = g[m] + az - h[m];
    }
  } else {
    for (let k = 0; k < nz; k++) {
      const z = z0 + k * step;
      for (let j = 0; j < ny; j++) {
        const y = y0 + j * step;
        for (let i = 0; i < nx; i++) v[n++] = F(x0 + i * step, y, z);
      }
    }
  }

  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const cellVert = new Int32Array(cx * cy * cz).fill(-1);
  const pos = [];
  const sx = 1;
  const sy = nx;
  const sz = nx * ny;
  const corner = [0, sx, sy, sx + sy, sz, sz + sx, sz + sy, sz + sx + sy];
  const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const c = new Float32Array(8);

  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        const base = i + j * sy + k * sz;
        let inside = 0;
        for (let o = 0; o < 8; o++) {
          c[o] = v[base + corner[o]];
          if (c[o] < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let ax = 0;
        let ay = 0;
        let az = 0;
        let count = 0;
        for (const [a, b] of EDGES) {
          const va = c[a];
          const vb = c[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const pa = [a & 1, (a >> 1) & 1, (a >> 2) & 1];
          const pb = [b & 1, (b >> 1) & 1, (b >> 2) & 1];
          ax += pa[0] + (pb[0] - pa[0]) * t;
          ay += pa[1] + (pb[1] - pa[1]) * t;
          az += pa[2] + (pb[2] - pa[2]) * t;
          count++;
        }
        cellVert[i + j * cx + k * cx * cy] = pos.length / 3;
        pos.push(x0 + (i + ax / count) * step, y0 + (j + ay / count) * step, z0 + (k + az / count) * step);
      }
    }
  }

  // 面を張る
  const idx = [];
  const cell = (i, j, k) => cellVert[i + j * cx + k * cx * cy];
  const quad = (a, b, cc, d, flip) => {
    if (a < 0 || b < 0 || cc < 0 || d < 0) return;
    if (flip) idx.push(a, d, cc, a, cc, b);
    else idx.push(a, b, cc, a, cc, d);
  };
  for (let k = 1; k < cz; k++) {
    for (let j = 1; j < cy; j++) {
      for (let i = 1; i < cx; i++) {
        const p = i + j * sy + k * sz;
        const inside = v[p] < 0;
        // x 方向の辺
        if (inside !== v[p + sx] < 0) quad(cell(i, j - 1, k - 1), cell(i, j, k - 1), cell(i, j, k), cell(i, j - 1, k), !inside);
        // y 方向の辺
        if (inside !== v[p + sy] < 0) quad(cell(i - 1, j, k - 1), cell(i - 1, j, k), cell(i, j, k), cell(i, j, k - 1), !inside);
        // z 方向の辺
        if (inside !== v[p + sz] < 0) quad(cell(i - 1, j - 1, k), cell(i, j - 1, k), cell(i, j, k), cell(i - 1, j, k), !inside);
      }
    }
  }

  // 表面に吸い付けて、法線は陰関数の勾配から
  const count = pos.length / 3;
  const positions = new Float32Array(pos);
  const normals = new Float32Array(count * 3);
  const e = step * 0.35;
  // 値と勾配をまとめて返す
  let evalFG;
  if (shape.d2 && shape.profile) {
    const { d2, profile } = shape;
    evalFG = (x, y, z) => {
      const d = d2(x, y);
      const ddx = (d2(x + e, y) - d) / e;
      const ddy = (d2(x, y + e) - d) / e;
      const dp = (profile(d + e * 0.5) - profile(d - e * 0.5)) / e;
      const k = (d > 0 ? 1 : 0) - dp;
      return [Math.max(d, 0) + Math.abs(z) - profile(d), k * ddx, k * ddy, z >= 0 ? 1 : -1];
    };
  } else {
    evalFG = (x, y, z) => [
      F(x, y, z),
      (F(x + e, y, z) - F(x - e, y, z)) / (2 * e),
      (F(x, y + e, z) - F(x, y - e, z)) / (2 * e),
      (F(x, y, z + e) - F(x, y, z - e)) / (2 * e),
    ];
  }
  for (let q = 0; q < count; q++) {
    let x = positions[q * 3];
    let y = positions[q * 3 + 1];
    let z = positions[q * 3 + 2];
    let r = evalFG(x, y, z);
    const gl2 = r[1] * r[1] + r[2] * r[2] + r[3] * r[3];
    if (gl2 > 1e-10) {
      // 1回だけニュートン法で表面に寄せる
      const gl = Math.sqrt(gl2);
      const s = clamp(r[0] / gl, -step * 0.5, step * 0.5) / gl;
      x -= r[1] * s;
      y -= r[2] * s;
      z -= r[3] * s;
      r = evalFG(x, y, z);
    }
    const l = Math.hypot(r[1], r[2], r[3]) || 1;
    positions[q * 3] = x;
    positions[q * 3 + 1] = y;
    positions[q * 3 + 2] = z;
    normals[q * 3] = r[1] / l;
    normals[q * 3 + 1] = r[2] / l;
    normals[q * 3 + 2] = r[3] / l;
  }

  // 向きを法線にそろえる
  const indices = new Uint32Array(idx);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const cc = indices[t + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[cc] - positions[a];
    const vy = positions[cc + 1] - positions[a + 1];
    const vz = positions[cc + 2] - positions[a + 2];
    const fx = uy * vz - uz * vy;
    const fy = uz * vx - ux * vz;
    const fz = ux * vy - uy * vx;
    const nxs = normals[a] + normals[b] + normals[cc];
    const nys = normals[a + 1] + normals[b + 1] + normals[cc + 1];
    const nzs = normals[a + 2] + normals[b + 2] + normals[cc + 2];
    if (fx * nxs + fy * nys + fz * nzs < 0) {
      const tmp = indices[t + 1];
      indices[t + 1] = indices[t + 2];
      indices[t + 2] = tmp;
    }
  }

  return { positions, normals, indices };
}

export function meshFromSpec(spec) {
  const s = buildShape(spec);
  return polygonize(s, s.bounds, spec.step ?? s.step);
}
