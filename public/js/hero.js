// ヒーロー：風船のようにふくらんだ真珠の「DARA」
// ・マウス / 指の動きで傾く
// ・ドラッグで回転（慣性つき、手を離すと正面に戻る）
// ・タップでぷるんと弾む
import * as THREE from "three";
import {
  createRenderer,
  createEnvironment,
  pearlMaterial,
  balloonMaterial,
  shapeGeometry,
  Spring,
  runWhenVisible,
  observeSize,
  fitDistance,
  ndcFromEvent,
  reducedMotion,
  PASTELS,
} from "./lib.js";

// 文字の並び（少しずつ傾けて、弾むようなベースラインに）
const LETTERS = [
  { ch: "D", w: 1.22, y: -0.06, rot: 0.1, z: 0.0 },
  { ch: "A", w: 1.54, y: 0.1, rot: -0.07, z: 0.14 },
  { ch: "R", w: 1.26, y: 0.13, rot: 0.06, z: 0.0 },
  { ch: "A", w: 1.54, y: -0.03, rot: -0.13, z: 0.12 },
];
const OVERLAP = 0.16;
const LOGO_W = 5.3;
const LOGO_H = 2.5;

// まわりに浮かぶもの（画面の割合で配置）
const FLOATERS = {
  wide: [
    { type: "sphere", color: PASTELS.blue, r: 0.4, at: [-0.29, 0.29], z: -1 },
    { type: "pearl", r: 0.17, at: [-0.28, 0.07], z: 0 },
    { type: "cluster", color: PASTELS.pink, s: 0.72, at: [-0.34, -0.14], z: -0.5 },
    { type: "cluster", color: PASTELS.mint, s: 0.8, at: [0.35, 0.24], z: -1 },
    { type: "pearl", r: 0.22, at: [0.36, -0.02], z: -0.3 },
    { type: "pearl", r: 0.13, at: [0.34, -0.2], z: -0.5 },
  ],
  // wide と同じ順番・同じ種類で
  tall: [
    { r: 0.36, at: [-0.28, 0.27], z: -1 },
    { r: 0.14, at: [-0.12, 0.35], z: -0.5 },
    { s: 0.62, at: [-0.3, -0.14], z: -0.5 },
    { s: 0.66, at: [0.3, 0.29], z: -1 },
    { r: 0.2, at: [0.36, 0.14], z: 0 },
    { r: 0.14, at: [0.3, -0.12], z: 0.2 },
  ],
};

const TREFOIL = [
  [0, 0.3, 0, 0.36],
  [-0.3, -0.2, 0.05, 0.36],
  [0.3, -0.2, -0.05, 0.36],
];

export async function initHero(canvas, { capture = false } = {}) {
  const stage = canvas.parentElement;
  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  scene.environment = createEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(0, 0, 14);

  scene.add(new THREE.AmbientLight(0xffffff, 0.06));
  const key = new THREE.DirectionalLight(0xfff4ea, 1.4);
  key.position.set(-3, 5, 6);
  scene.add(key);
  const warm = new THREE.PointLight(0xffc6d9, 12, 16);
  warm.position.set(3.5, -2, 5);
  scene.add(warm);
  const cool = new THREE.PointLight(0xb8d2ff, 10, 16);
  cool.position.set(-4, 1, 5);
  scene.add(cool);

  const pearl = pearlMaterial();

  const tiltRoot = new THREE.Group();
  const spinRoot = new THREE.Group();
  const logo = new THREE.Group();
  tiltRoot.add(spinRoot);
  spinRoot.add(logo);
  scene.add(tiltRoot);

  // -------------------------------------------------------------------------
  // ロゴ（メッシュは Worker でつくる）
  // -------------------------------------------------------------------------
  const [gD, gA, gR, gSmile] = await Promise.all(
    [{ kind: "glyph", ch: "D" }, { kind: "glyph", ch: "A" }, { kind: "glyph", ch: "R" }, { kind: "smile" }].map(shapeGeometry)
  );
  const geo = { D: gD, A: gA, R: gR };

  const totalW = LETTERS.reduce((w, l) => w + l.w, 0) - OVERLAP * (LETTERS.length - 1);
  let x = -totalW / 2;
  const letters = LETTERS.map((l, i) => {
    const holder = new THREE.Group();
    const mesh = new THREE.Mesh(geo[l.ch], pearl);
    mesh.rotation.z = l.rot;
    holder.add(mesh);
    holder.position.set(x + l.w / 2, l.y, l.z);
    holder.userData = {
      baseY: l.y,
      squash: new Spring(0, { stiffness: 260, damping: 9 }),
      pop: new Spring(capture ? 1 : 0, { stiffness: 120, damping: 10 }),
      lift: new Spring(0, { stiffness: 200, damping: 10 }),
      phase: i * 0.9,
    };
    holder.userData.pop.target = 1;
    logo.add(holder);
    x += l.w - OVERLAP;
    return holder;
  });

  const smile = new THREE.Group();
  smile.add(new THREE.Mesh(gSmile, pearl));
  smile.position.set(0.05, -1.02, 0.22);
  smile.userData = {
    pop: new Spring(capture ? 1 : 0, { stiffness: 120, damping: 10 }),
    squash: new Spring(0, { stiffness: 260, damping: 9 }),
  };
  smile.userData.pop.target = 1;
  logo.add(smile);
  logo.position.y = 0.2;
  logo.scale.set(1, 1, 1.1);

  // -------------------------------------------------------------------------
  // まわりに浮かぶ玉
  // -------------------------------------------------------------------------
  const floaters = [];
  if (!capture) {
    const gCluster = await shapeGeometry({ kind: "cluster", balls: TREFOIL, step: 0.026 });
    const sphere = new THREE.SphereGeometry(1, 48, 32);
    for (let i = 0; i < FLOATERS.wide.length; i++) {
      const f = FLOATERS.wide[i];
      let mesh;
      if (f.type === "cluster") {
        const m = balloonMaterial(f.color);
        m.emissive = new THREE.Color(f.color);
        m.emissiveIntensity = 0.12;
        mesh = new THREE.Mesh(gCluster, m);
      } else if (f.type === "sphere") {
        const m = balloonMaterial(f.color);
        m.emissive = new THREE.Color(f.color);
        m.emissiveIntensity = 0.12;
        mesh = new THREE.Mesh(sphere, m);
      } else {
        mesh = new THREE.Mesh(sphere, pearl);
      }
      mesh.userData = {
        index: i,
        phase: Math.random() * 10,
        spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.4),
        squash: new Spring(0, { stiffness: 200, damping: 8 }),
        pop: new Spring(0, { stiffness: 90, damping: 10 }),
      };
      mesh.userData.pop.target = 1;
      scene.add(mesh);
      floaters.push(mesh);
    }
  }

  // -------------------------------------------------------------------------
  // 入力
  // -------------------------------------------------------------------------
  const pointer = new THREE.Vector2(0, 0);
  const tilt = { x: new Spring(0, { stiffness: 40, damping: 9 }), y: new Spring(0, { stiffness: 40, damping: 9 }) };
  const spin = { y: 0, x: 0, vy: 0, vx: 0 };
  let dragging = false;
  let dragStart = null;
  let lastMove = null;
  let lastInteraction = -10;
  const raycaster = new THREE.Raycaster();

  if (!capture) {
    window.addEventListener(
      "pointermove",
      (e) => {
        if (e.pointerType === "mouse") pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
        if (!dragging || !lastMove) return;
        const dx = e.clientX - lastMove.x;
        const dy = e.clientY - lastMove.y;
        const dt = Math.max((e.timeStamp - lastMove.t) / 1000, 1 / 240);
        spin.y += dx * 0.011;
        spin.x += dy * 0.006;
        spin.vy = (dx * 0.011) / dt;
        spin.vx = (dy * 0.006) / dt;
        lastMove = { x: e.clientX, y: e.clientY, t: e.timeStamp };
        if (Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > 6) canvas.classList.add("is-dragging");
      },
      { passive: true }
    );

    canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      dragStart = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      lastMove = { ...dragStart };
      spin.vx = spin.vy = 0;
      lastInteraction = performance.now() / 1000;
    });

    const endDrag = (e, cancelled) => {
      if (!dragging) return;
      dragging = false;
      canvas.classList.remove("is-dragging");
      lastInteraction = performance.now() / 1000;
      const moved = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
      if (!cancelled && moved < 8 && e.timeStamp - dragStart.t < 500) tap(ndcFromEvent(e, canvas));
      if (e.timeStamp - lastMove.t > 80) spin.vx = spin.vy = 0;
    };
    window.addEventListener("pointerup", (e) => endDrag(e, false));
    window.addEventListener("pointercancel", (e) => endDrag(e, true));

    window.addEventListener(
      "deviceorientation",
      (e) => {
        if (e.gamma == null) return;
        pointer.set(THREE.MathUtils.clamp(e.gamma / 30, -1, 1), THREE.MathUtils.clamp((45 - e.beta) / 30, -1, 1));
      },
      { passive: true }
    );
  }

  function tap(ndc) {
    raycaster.setFromCamera(ndc, camera);
    const f = raycaster.intersectObjects(floaters, false)[0];
    if (f) {
      f.object.userData.squash.kick(-10);
      return;
    }
    const hits = raycaster.intersectObjects(letters, true);
    let hitIndex = -1;
    if (hits.length) {
      let o = hits[0].object;
      while (o && !letters.includes(o)) o = o.parent;
      hitIndex = letters.indexOf(o);
    }
    letters.forEach((l, i) => {
      const d = hitIndex < 0 ? 1 : Math.abs(i - hitIndex);
      const strength = hitIndex < 0 ? 0.8 : d === 0 ? 1.6 : 1 / (d + 0.6);
      setTimeout(() => {
        l.userData.squash.kick(-9 * strength);
        l.userData.lift.kick(5 * strength);
      }, d * 55);
    });
    smile.userData.squash.kick(-6);
    tilt.x.kick(-1.2);
    floaters.forEach((m) => m.userData.squash.kick(-3));
  }

  // -------------------------------------------------------------------------
  // サイズと配置
  // -------------------------------------------------------------------------
  let view = { w: 1, h: 1, tall: false };
  const logoCenter = capture ? 0.5 : 0.43; // 画面上端からの割合
  observeSize(stage, (w, h) => {
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tall = camera.aspect < 1;
    const share = capture ? 0.98 : tall ? 0.9 : Math.min(0.58, 0.58 * (1.6 / camera.aspect) ** 0.3);
    camera.position.z = fitDistance(camera, LOGO_W / share, LOGO_H / (capture ? 0.95 : 0.4));
    camera.updateProjectionMatrix();
    const vh = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.position.z;
    view = { w: vh * camera.aspect, h: vh, tall };
    tiltRoot.position.y = (0.5 - logoCenter) * vh;
  });

  // -------------------------------------------------------------------------
  const introStart = performance.now() / 1000 + 0.1;
  const tmp = new THREE.Vector3();

  const tick = (dt, t) => {
    const calm = reducedMotion.matches || capture;

    letters.forEach((l, i) => {
      const u = l.userData;
      if (t > introStart + i * 0.11 || calm) {
        if (calm) u.pop.value = 1;
        const p = u.pop.update(dt);
        const s = u.squash.update(dt) * 0.06;
        const lift = u.lift.update(dt) * 0.05;
        const bob = calm ? 0 : Math.sin(t * 1.6 + u.phase) * 0.035;
        l.scale.set(p * (1 - s * 0.6), p * (1 + s), p * (1 - s * 0.6));
        l.position.y = u.baseY + bob + lift;
        l.rotation.z = calm ? 0 : Math.sin(t * 1.2 + i) * 0.02;
      } else {
        l.scale.setScalar(0.001);
      }
    });
    if (t > introStart + letters.length * 0.11 || calm) {
      const u = smile.userData;
      if (calm) u.pop.value = 1;
      const p = u.pop.update(dt);
      const s = u.squash.update(dt) * 0.08;
      smile.scale.set(p * (1 - s), p * (1 + s), p);
    } else {
      smile.scale.setScalar(0.001);
    }

    if (!capture) {
      tilt.x.target = -pointer.y * 0.2;
      tilt.y.target = pointer.x * 0.3;
      tiltRoot.rotation.x = tilt.x.update(dt);
      tiltRoot.rotation.y = tilt.y.update(dt);
      tiltRoot.rotation.z = calm ? 0 : Math.sin(t * 0.5) * 0.015;

      if (!dragging) {
        spin.y += spin.vy * dt;
        spin.x += spin.vx * dt;
        const friction = Math.exp(-dt * 2.4);
        spin.vy *= friction;
        spin.vx *= friction;
        if (Math.abs(spin.vy) < 1.2 && t - lastInteraction > 0.6) {
          const home = Math.round(spin.y / (Math.PI * 2)) * Math.PI * 2;
          spin.vy += (home - spin.y) * dt * 9;
          spin.vy *= Math.exp(-dt * 4);
        }
        spin.vx += -spin.x * dt * 14;
        spin.vx *= Math.exp(-dt * 5);
      }
      spin.x = THREE.MathUtils.clamp(spin.x, -0.9, 0.9);
      spinRoot.rotation.set(spin.x, spin.y, 0);
    }

    warm.position.x = 3.5 * Math.cos(t * 0.4);
    cool.position.y = 1 + Math.sin(t * 0.5) * 1.5;

    const layout = view.tall ? FLOATERS.tall : FLOATERS.wide;
    floaters.forEach((m, i) => {
      const f = layout[i];
      const u = m.userData;
      if (t < introStart + 0.5 + i * 0.08 && !calm) {
        m.scale.setScalar(0.001);
        return;
      }
      if (calm) u.pop.value = 1;
      const p = u.pop.update(dt);
      const s = u.squash.update(dt) * 0.05;
      const size = (f.r ?? f.s) * (view.tall ? 0.85 : 1);
      tmp.set(f.at[0] * view.w, f.at[1] * view.h + tiltRoot.position.y * 0, f.z);
      tmp.x += pointer.x * (0.15 + f.z * -0.1);
      tmp.y += (calm ? 0 : Math.sin(t * 0.9 + u.phase) * 0.12) + pointer.y * 0.1;
      m.position.copy(tmp);
      m.scale.set(size * p * (1 - s * 0.5), size * p * (1 + s), size * p * (1 - s * 0.5));
      if (!calm) {
        m.rotation.x += u.spin.x * dt;
        m.rotation.y += u.spin.y * dt;
        m.rotation.z += u.spin.z * dt;
      }
    });

    renderer.render(scene, camera);
  };

  if (capture) {
    renderer.setClearColor(0x000000, 0);
    tick(0.016, 100);
    return { render: () => tick(0.016, 100) };
  }
  runWhenVisible(stage, tick);
  return {};
}
