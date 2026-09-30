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
      pop: new Spring(1, { stiffness: 120, damping: 10 }),
      lift: new Spring(0, { stiffness: 200, damping: 10 }),
      drop: new Spring(0, { stiffness: 85, damping: 7 }), // 上から落ちてくる（1 → 0）。すこし弾む
      started: true,
      landed: true,
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
    pop: new Spring(1, { stiffness: 120, damping: 10 }),
    squash: new Spring(0, { stiffness: 260, damping: 9 }),
    started: true,
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
        pop: new Spring(1, { stiffness: 90, damping: 10 }),
        fly: new Spring(0, { stiffness: 38, damping: 7.5 }), // 画面の外から飛んでくる（1 → 0）
        started: true,
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
  let baseZ = 14;
  const clamp = THREE.MathUtils.clamp;
  const easeOutCubic = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const I = { on: false, done: true, t0: 0, landAt: null, bounces: 0, sy: 0, svy: 0, seedSq: 0, smileAt: null, sweepAt: null, doneAt: null, finish: null };
  function camZoom() {
    if (I.landAt === null) return 0.66;
    return 1 - 0.34 * (1 - easeOutCubic((introNow - I.landAt) / 2.7));
  }
  let introNow = 0;

  const logoCenter = capture ? 0.5 : 0.43; // 画面上端からの割合
  observeSize(stage, (w, h) => {
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const tall = camera.aspect < 1;
    const share = capture ? 0.98 : tall ? 0.9 : Math.min(0.58, 0.58 * (1.6 / camera.aspect) ** 0.3);
    baseZ = fitDistance(camera, LOGO_W / share, LOGO_H / (capture ? 0.95 : 0.4));
    camera.position.z = baseZ * (I.on && !I.done ? camZoom() : 1);
    camera.updateProjectionMatrix();
    const vh = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * baseZ;
    view = { w: vh * camera.aspect, h: vh, tall };
    tiltRoot.position.y = (0.5 - logoCenter) * vh;
  });

  // -------------------------------------------------------------------------
  // オープニング
  //   真珠が1粒おちる → 衝撃波 + カメラが引く → 文字が1つずつ落ちて着地 → 笑顔
  //   → 光がさっと走る → まわりの玉が飛んでくる → メニューと文字が出る
  // -------------------------------------------------------------------------

  // 飛び散る小さな真珠
  const PN = 110;
  const parts = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), pearlMaterial(0xffffff), PN);
  parts.frustumCulled = false;
  parts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const P = Array.from({ length: PN }, () => ({ life: 0, max: 1, s: 0.05, p: new THREE.Vector3(), v: new THREE.Vector3() }));
  const tints = [0xffffff, PASTELS.blue, PASTELS.pink, PASTELS.mint, PASTELS.yellow, PASTELS.purple].map((c) => new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.35));
  const m4 = new THREE.Matrix4(), qI = new THREE.Quaternion(), sv = new THREE.Vector3();
  let pIdx = 0;
  for (let k = 0; k < PN; k++) { parts.setColorAt(k, tints[0]); m4.compose(sv.set(0, 0, 0), qI, sv.set(0, 0, 0)); parts.setMatrixAt(k, m4); }
  scene.add(parts);
  function burst(pos, n, power = 1) {
    for (let k = 0; k < n; k++) {
      const q = P[pIdx++ % PN], a = Math.random() * Math.PI * 2, sp = (1.0 + Math.random() * 2.4) * power;
      q.max = q.life = 0.8 + Math.random() * 0.7;
      q.s = 0.03 + Math.random() * 0.075;
      q.p.copy(pos);
      q.v.set(Math.cos(a) * sp, 1.6 + Math.random() * 2.6 * power, Math.sin(a) * sp * 0.5 + 0.8);
      parts.setColorAt((pIdx - 1) % PN, tints[Math.floor(Math.random() * tints.length)]);
    }
    if (parts.instanceColor) parts.instanceColor.needsUpdate = true;
  }
  // 広がる光の輪
  const waveGeo = new THREE.RingGeometry(0.93, 1, 96);
  const waves = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(waveGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    m.visible = false; scene.add(m);
    return { m, t: -1, size: 1 };
  });
  function wave(pos, size) {
    const w = waves.find((x) => x.t < 0) || waves[0];
    w.t = 0; w.size = size; w.m.position.copy(pos); w.m.visible = true;
  }
  // 最初の真珠と、走る光
  const seed = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), pearl);
  seed.visible = false; scene.add(seed);
  const sweep = new THREE.PointLight(0xffffff, 0, 18);
  scene.add(sweep);

  const _w = new THREE.Vector3();
  function logoWorldY() { return tiltRoot.position.y + logo.position.y; }

  function startIntro() {
    I.on = true; I.done = false; I.t0 = performance.now() / 1000 + 0.25; I.landAt = null; I.bounces = 0; I.smileAt = null; I.sweepAt = null; I.doneAt = null; I.seedSq = 0;
    I.sy = 0; I.svy = 0;
    letters.forEach((l) => {
      const u = l.userData;
      u.started = false; u.landed = false; u.drop.value = 1; u.drop.velocity = 0; u.pop.value = 0.6; u.pop.velocity = 0; u.squash.value = 0; u.squash.velocity = 0;
    });
    smile.userData.started = false; smile.userData.pop.value = 0; smile.userData.pop.velocity = 0;
    floaters.forEach((m) => { const u = m.userData; u.started = false; u.fly.value = 1; u.fly.velocity = 0; u.pop.value = 0.3; u.pop.velocity = 0; });
    seed.visible = false;
    document.documentElement.classList.add("intro");
    const skip = () => I.finish && I.finish(true);
    const evs = ["pointerdown", "keydown", "wheel", "touchstart"];
    evs.forEach((ev) => window.addEventListener(ev, skip, { once: true, passive: true }));
    I.finish = (skipped) => {
      if (I.done) return;
      I.done = true; I.on = false;
      evs.forEach((ev) => window.removeEventListener(ev, skip));
      if (skipped) {
        letters.forEach((l) => { const u = l.userData; u.started = u.landed = true; u.drop.value = 0; u.drop.velocity = 0; u.pop.value = 1; });
        smile.userData.started = true; smile.userData.pop.value = 1;
        floaters.forEach((m) => { const u = m.userData; u.started = true; u.fly.value = 0; u.fly.velocity = 0; u.pop.value = 1; });
      }
      seed.visible = false; sweep.intensity = 0;
      camera.position.set(0, 0, baseZ); camera.rotation.set(0, 0, 0);
      document.documentElement.classList.remove("intro");
    };
  }

  const introReady = !capture && !reducedMotion.matches && document.documentElement.classList.contains("intro");
  if (introReady) startIntro();

  // -------------------------------------------------------------------------
  const tmp = new THREE.Vector3();

  const tick = (dt, t) => {
    const calm = reducedMotion.matches || capture;
    const active = I.on && !I.done;
    const now = t - I.t0;
    introNow = now;

    if (active) {
      // --- 最初の真珠：上から落ちて、2回はずむ
      if (now >= 0 && I.bounces < 3) {
        const ground = logoWorldY() - 0.5, H = view.h * 0.5, g = (2 * H) / (0.55 * 0.55);
        if (!seed.visible) { seed.visible = true; I.sy = ground + H; I.svy = 0; }
        I.svy -= g * dt; I.sy += I.svy * dt;
        if (I.sy <= ground && I.svy < 0) {
          I.sy = ground; I.svy = -I.svy * 0.42; I.bounces++; I.seedSq = 1;
          if (I.bounces === 1) {
            I.landAt = now; _w.set(0, ground, 0.3);
            burst(_w, 26, 1.3); wave(_w.set(0, logoWorldY(), -0.4), view.w * 0.9);
          }
        }
        I.seedSq *= Math.exp(-dt * 9);
        const sq = I.seedSq * 0.45;
        seed.position.set(0, I.sy, 0.3);
        seed.scale.set(0.26 * (1 + sq * 0.6), 0.26 * (1 - sq), 0.26 * (1 + sq * 0.6));
      } else if (I.bounces >= 3) {
        seed.scale.multiplyScalar(Math.exp(-dt * 14));
        if (seed.scale.x < 0.01) seed.visible = false;
      }
      // --- カメラ：近くから、すっと引く
      const z = baseZ * camZoom();
      const e = I.landAt === null ? 0 : easeOutCubic((now - I.landAt) / 2.7);
      camera.position.set(0, (1 - e) * -0.55, z); camera.lookAt(0, (1 - e) * -0.1, 0);
      // --- 進行
      if (I.landAt !== null) {
        const a = now - I.landAt;
        if (I.smileAt === null && a >= 0.05 + letters.length * 0.16 + 0.05) { I.smileAt = now; }
        if (I.sweepAt === null && a >= 1.15) I.sweepAt = now;
        if (I.doneAt === null && a >= 2.9) { I.doneAt = now; I.finish(false); }
      }
    }

    letters.forEach((l, i) => {
      const u = l.userData;
      if (active && !u.started) {
        if (I.landAt !== null && now - I.landAt >= 0.05 + i * 0.16) { u.started = true; u.pop.value = 0.6; }
        else { l.scale.setScalar(0.001); return; }
      }
      if (calm) u.pop.value = 1;
      const p = u.pop.update(dt);
      const d = calm ? 0 : u.drop.update(dt);
      const s = u.squash.update(dt) * 0.06;
      const lift = u.lift.update(dt) * 0.05;
      const bob = calm ? 0 : Math.sin(t * 1.6 + u.phase) * 0.035;
      // 落ちているあいだは縦にのびる
      const stretch = calm ? 0 : clamp(-u.drop.velocity * 0.022, 0, 0.32);
      const sy = p * (1 + s) * (1 + stretch), sxz = (p * (1 - s * 0.6)) / Math.sqrt(1 + stretch);
      l.scale.set(sxz, sy, sxz);
      l.position.y = u.baseY + bob + lift + d * 5.4;
      l.rotation.z = (calm ? 0 : Math.sin(t * 1.2 + i) * 0.02) + d * 0.7 * (i % 2 ? 1 : -1);
      if (!u.landed && u.started && d <= 0) {
        u.landed = true;
        u.squash.kick(-13);
        l.getWorldPosition(_w); _w.y -= 0.75; _w.z += 0.4;
        burst(_w, 12, 0.85);
      }
    });

    {
      const u = smile.userData;
      if (active && !u.started) {
        if (I.smileAt !== null) {
          u.started = true; u.pop.value = 0; u.squash.kick(-7);
          smile.getWorldPosition(_w); wave(_w.set(_w.x, _w.y, -0.3), view.w * 0.55); burst(_w, 10, 0.8);
        }
      }
      if (active && !u.started) smile.scale.setScalar(0.001);
      else {
        if (calm) u.pop.value = 1;
        const p = u.pop.update(dt);
        const s = u.squash.update(dt) * 0.08;
        smile.scale.set(p * (1 - s), p * (1 + s), p);
      }
    }

    // 飛び散る真珠・光の輪・走る光
    for (let k = 0; k < PN; k++) {
      const q = P[k];
      if (q.life > 0) {
        q.life -= dt; q.v.y -= 6.5 * dt; q.p.addScaledVector(q.v, dt);
        const sc = q.s * clamp((q.life / q.max) * 2.2, 0, 1);
        m4.compose(q.p, qI, sv.set(sc, sc, sc));
      } else m4.compose(q.p, qI, sv.set(0, 0, 0));
      parts.setMatrixAt(k, m4);
    }
    parts.instanceMatrix.needsUpdate = true;
    waves.forEach((w) => {
      if (w.t < 0) return;
      w.t += dt;
      const u = w.t / 1.0;
      if (u >= 1) { w.t = -1; w.m.visible = false; return; }
      w.m.scale.setScalar(Math.max(0.01, w.size * easeOutCubic(u)));
      w.m.material.opacity = 0.5 * (1 - u) * (1 - u);
    });
    if (active && I.sweepAt !== null) {
      const u = clamp((now - I.sweepAt) / 1.3, 0, 1);
      sweep.position.set(THREE.MathUtils.lerp(-view.w * 0.62, view.w * 0.62, u), logoWorldY() + 0.6, 3.4);
      sweep.intensity = 70 * Math.sin(Math.PI * u) ** 2;
    } else if (!active) sweep.intensity = 0;

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
      if (active && !u.started) {
        if (I.landAt !== null && now - I.landAt >= 0.85 + i * 0.12) { u.started = true; u.fly.value = 1; u.pop.value = 0.3; }
        else { m.scale.setScalar(0.001); return; }
      }
      if (calm) u.pop.value = 1;
      const p = u.pop.update(dt);
      const fly = calm ? 0 : u.fly.update(dt);
      const s = u.squash.update(dt) * 0.05;
      const size = (f.r ?? f.s) * (view.tall ? 0.85 : 1);
      tmp.set(f.at[0] * view.w, f.at[1] * view.h, f.z);
      tmp.x += pointer.x * (0.15 + f.z * -0.1);
      tmp.y += (calm ? 0 : Math.sin(t * 0.9 + u.phase) * 0.12) + pointer.y * 0.1;
      // 画面の外（中心から遠いほう）から、弧をえがいて飛んでくる
      const dir = Math.sign(tmp.x) || 1;
      tmp.x += dir * view.w * 0.9 * fly;
      tmp.y += view.h * 0.35 * fly * (tmp.y > 0 ? 1 : -1);
      m.position.copy(tmp);
      m.scale.set(size * p * (1 - s * 0.5), size * p * (1 + s), size * p * (1 - s * 0.5));
      if (!calm) {
        const spinK = 1 + fly * 6;
        m.rotation.x += u.spin.x * dt * spinK;
        m.rotation.y += u.spin.y * dt * spinK;
        m.rotation.z += u.spin.z * dt * spinK;
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
  return {
    // もう一度、オープニングから
    replay() {
      if (reducedMotion.matches) return;
      if (I.on && !I.done) return;
      spin.x = spin.y = spin.vx = spin.vy = 0;
      startIntro();
    },
  };
}
