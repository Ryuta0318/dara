// 3Dシーン共通のユーティリティ
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/RoomEnvironment.js";
import { meshFromSpec } from "./sdf.js";

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export const PASTELS = {
  blue: 0x6f9bff,
  pink: 0xff8fb2,
  mint: 0x78d898,
  yellow: 0xffd65c,
  purple: 0xa57cff,
  orange: 0xff975f,
};

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

// 真珠の映り込み用の環境マップ
export function createEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return env;
}

// 白い真珠のようにふくらんだ質感
export function pearlMaterial(color = 0xf4ece9) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.16,
    metalness: 0.0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    sheen: 1,
    sheenRoughness: 0.3,
    sheenColor: new THREE.Color(0xffd6e4),
    iridescence: 0.5,
    iridescenceIOR: 1.35,
    iridescenceThicknessRange: [220, 520],
    envMapIntensity: 1.35,
  });
}

// パステルのつやつやした風船
export function balloonMaterial(color) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.22,
    metalness: 0.0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    sheen: 0.4,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0xffffff),
    envMapIntensity: 0.95,
  });
}

export const inkMaterial = () =>
  new THREE.MeshPhysicalMaterial({ color: 0x121117, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });

// ---------------------------------------------------------------------------
// メッシュ化（Worker のプールで並列に）
// ---------------------------------------------------------------------------
const cache = new Map();
let pool = null;
let nextId = 0;
const pending = new Map();

function getPool() {
  if (pool !== null) return pool;
  try {
    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    pool = Array.from({ length: n }, () => {
      const w = new Worker(new URL("./mesher-worker.js", import.meta.url), { type: "module" });
      w.onmessage = (e) => {
        const job = pending.get(e.data.id);
        pending.delete(e.data.id);
        w.busy--;
        if (e.data.error) job.reject(new Error(e.data.error));
        else job.resolve(e.data);
      };
      w.busy = 0;
      return w;
    });
  } catch {
    pool = [];
  }
  return pool;
}

function runJob(spec) {
  const workers = getPool();
  if (!workers.length) return Promise.resolve(meshFromSpec(spec));
  const w = workers.reduce((a, b) => (b.busy < a.busy ? b : a));
  const id = nextId++;
  w.busy++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, spec });
  }).catch(() => meshFromSpec(spec));
}

// 同じ形は1回だけつくる（各キャンバスで使い回せるよう、データを保持）
export function shapeGeometry(spec) {
  const key = JSON.stringify(spec);
  if (!cache.has(key)) cache.set(key, runJob(spec));
  return cache.get(key).then((m) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));
    g.setIndex(new THREE.BufferAttribute(m.indices, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  });
}

// ぷるんとした動きのためのバネ
export class Spring {
  constructor(value = 0, { stiffness = 180, damping = 12 } = {}) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }
  kick(v) {
    this.velocity += v;
  }
  update(dt) {
    const f = (this.target - this.value) * this.stiffness - this.velocity * this.damping;
    this.velocity += f * dt;
    this.value += this.velocity * dt;
    return this.value;
  }
}

// 画面内にあるときだけ描画する
export function runWhenVisible(el, tick) {
  let visible = false;
  let raf = 0;
  let last = performance.now();

  const loop = (now) => {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    tick(dt, now / 1000);
    raf = visible ? requestAnimationFrame(loop) : 0;
  };
  const start = () => {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };

  new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting && !document.hidden;
      if (visible) start();
    },
    { rootMargin: "120px" }
  ).observe(el);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      visible = false;
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.bottom > 0 && r.top < innerHeight) {
      visible = true;
      start();
    }
  });
}

export function observeSize(el, cb) {
  const ro = new ResizeObserver(() => cb(el.clientWidth, el.clientHeight));
  ro.observe(el);
  cb(el.clientWidth, el.clientHeight);
}

// 視野に収まるカメラ距離
export function fitDistance(camera, w, h) {
  const v = THREE.MathUtils.degToRad(camera.fov) / 2;
  return Math.max(h / 2 / Math.tan(v), w / 2 / (Math.tan(v) * camera.aspect));
}

export function ndcFromEvent(e, el) {
  const r = el.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}

// タップ（ドラッグやスクロールと区別する）
export function onTap(el, cb) {
  let down = null;
  el.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY, t: e.timeStamp }));
  el.addEventListener("pointerup", (e) => {
    if (!down) return;
    const ok = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10 && e.timeStamp - down.t < 600;
    down = null;
    if (ok) cb(e);
  });
  el.addEventListener("pointercancel", () => (down = null));
}
