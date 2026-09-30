// 3Dシーン共通のユーティリティ
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export const PASTELS = {
  blue: 0xa9d2ff,
  pink: 0xffb8d5,
  mint: 0xa6f0d3,
  yellow: 0xffe590,
  purple: 0xcdb8ff,
  orange: 0xffc9a0,
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
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

// 真珠の映り込み用の環境マップ
export function createEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
  pmrem.dispose();
  return env;
}

// 白い真珠のようにふくらんだ質感
export function pearlMaterial(color = 0xf7f5fc) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.2,
    metalness: 0.0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    sheen: 1,
    sheenRoughness: 0.35,
    sheenColor: new THREE.Color(0xd9ccff),
    iridescence: 0.55,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [180, 620],
    envMapIntensity: 1.15,
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
    { rootMargin: "80px" }
  ).observe(el);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) visible = false;
    else if (el.getBoundingClientRect().bottom > 0 && el.getBoundingClientRect().top < innerHeight) {
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
