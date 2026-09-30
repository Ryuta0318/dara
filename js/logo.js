// ふくらんだ真珠の「DARA」ロゴ
// ・マウス / 指の動きで傾く
// ・ドラッグで回転（慣性つき、手を離すと正面に戻る）
// ・タップでぷるんと弾む
import * as THREE from "three";
import {
  createRenderer,
  createEnvironment,
  pearlMaterial,
  Spring,
  runWhenVisible,
  observeSize,
  reducedMotion,
} from "./lib.js";

const STROKE = 0.165; // 文字の太さ（チューブの半径）
const GAP = 0.44; // 文字の間隔

// ---------------------------------------------------------------------------
// 文字の骨格（高さ1の中で、折れ線 + 円弧）
// ---------------------------------------------------------------------------
function arc(cx, cy, r, from, to, steps = 24) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    pts.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r]);
  }
  return pts;
}

const H = Math.PI / 2;
const GLYPHS = {
  D: {
    width: 0.8,
    strokes: [
      { closed: true, pts: [[0, 0], [0, 1], [0.3, 1], ...arc(0.3, 0.5, 0.5, H, -H), [0.3, 0]] },
    ],
  },
  A: {
    width: 0.84,
    strokes: [
      { pts: [[0, 0], [0.42, 1], [0.84, 0]] },
      { pts: [[0.17, 0.36], [0.67, 0.36]] },
    ],
  },
  R: {
    width: 0.74,
    strokes: [
      { pts: [[0, 0], [0, 1]] },
      { pts: [[0, 1], [0.36, 1], ...arc(0.36, 0.755, 0.245, H, -H), [0.36, 0.51], [0, 0.51]] },
      { pts: [[0.28, 0.51], [0.74, 0]] },
    ],
  },
};

// 角を丸めた密な点列にする
function filletPath(pts, closed, radius = 0.12) {
  const out = [];
  const n = pts.length;
  const get = (i) => new THREE.Vector2(...pts[(i + n) % n]);
  for (let i = 0; i < n; i++) {
    const p = get(i);
    const isEnd = !closed && (i === 0 || i === n - 1);
    if (isEnd) {
      out.push(p);
      continue;
    }
    const a = get(i - 1);
    const b = get(i + 1);
    const da = a.clone().sub(p);
    const db = b.clone().sub(p);
    const f = Math.min(radius, da.length() * 0.45, db.length() * 0.45);
    const p0 = p.clone().add(da.normalize().multiplyScalar(f));
    const p1 = p.clone().add(db.normalize().multiplyScalar(f));
    for (let s = 0; s <= 6; s++) {
      const t = s / 6;
      const q = new THREE.Vector2()
        .addScaledVector(p0, (1 - t) * (1 - t))
        .addScaledVector(p, 2 * (1 - t) * t)
        .addScaledVector(p1, t * t);
      out.push(q);
    }
  }
  return out;
}

function strokeMesh(stroke, material, radius = STROKE) {
  const pts2 = filletPath(stroke.pts, !!stroke.closed);
  const pts3 = pts2.map((p) => new THREE.Vector3(p.x, p.y, 0));
  const curve = new THREE.CatmullRomCurve3(pts3, !!stroke.closed, "centripetal");
  const segs = Math.max(48, Math.round(curve.getLength() * 90));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segs, radius, 28, !!stroke.closed), material));
  if (!stroke.closed) {
    // 端を丸く閉じる
    const cap = new THREE.SphereGeometry(radius, 28, 20);
    for (const end of [pts3[0], pts3[pts3.length - 1]]) {
      const m = new THREE.Mesh(cap, material);
      m.position.copy(end);
      group.add(m);
    }
  }
  return group;
}

// 黒い角丸の板
function roundedPlate(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.18,
    bevelEnabled: true,
    bevelThickness: 0.09,
    bevelSize: 0.09,
    bevelSegments: 8,
    curveSegments: 32,
  });
  geo.translate(0, 0, -0.09);
  return geo;
}

// ---------------------------------------------------------------------------
export function initLogo(canvas) {
  const stage = canvas.parentElement;
  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  scene.environment = createEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0, 12);

  // 色つきのライトで真珠にほんのりパステルを乗せる
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-3, 5, 6);
  scene.add(key);
  const pinkLight = new THREE.PointLight(0xffb8d5, 10, 14);
  pinkLight.position.set(4, -2, 5);
  scene.add(pinkLight);
  const blueLight = new THREE.PointLight(0xa9d2ff, 10, 14);
  blueLight.position.set(-4, -1, 5);
  scene.add(blueLight);

  const pearl = pearlMaterial();

  // ロゴ全体（傾き用）→ 回転用 → 文字
  const tiltRoot = new THREE.Group();
  const spinRoot = new THREE.Group();
  tiltRoot.add(spinRoot);
  scene.add(tiltRoot);

  // 黒い角丸の板
  const plate = new THREE.Mesh(
    roundedPlate(5.9, 3.5, 0.7),
    new THREE.MeshPhysicalMaterial({
      color: 0x050507,
      roughness: 0.3,
      metalness: 0.0,
      specularIntensity: 0.35,
      envMapIntensity: 0.6,
    })
  );
  plate.position.z = -0.36;
  spinRoot.add(plate);

  // 文字
  const word = "DARA";
  const totalW = [...word].reduce((w, c) => w + GLYPHS[c].width, 0) + GAP * (word.length - 1);
  const letters = [];
  let x = -totalW / 2;
  for (const ch of word) {
    const g = GLYPHS[ch];
    const inner = new THREE.Group();
    for (const s of g.strokes) inner.add(strokeMesh(s, pearl));
    // 文字の中心を原点にして、弾むときの基点にする
    inner.position.set(-g.width / 2, -0.5, 0);
    const holder = new THREE.Group();
    holder.add(inner);
    holder.position.set(x + g.width / 2, 0.32, 0.02);
    holder.scale.setScalar(0.001);
    holder.userData = {
      squash: new Spring(0, { stiffness: 260, damping: 9 }),
      pop: new Spring(0, { stiffness: 120, damping: 11 }),
      lift: new Spring(0, { stiffness: 200, damping: 10 }),
      baseX: holder.position.x,
    };
    spinRoot.add(holder);
    letters.push(holder);
    x += g.width + GAP;
  }
  // 手前に少し膨らませる
  spinRoot.scale.set(1, 1, 1.15);

  // 笑顔の曲線
  const smilePts = [];
  for (let i = 0; i <= 32; i++) {
    const t = -1 + (2 * i) / 32;
    smilePts.push([t * 1.05, -0.95 - (1 - t * t) * 0.3]);
  }
  const smile = new THREE.Group();
  smile.add(strokeMesh({ pts: smilePts }, pearl, 0.095));
  smile.scale.setScalar(0.001);
  smile.userData = { pop: new Spring(0, { stiffness: 120, damping: 11 }), squash: new Spring(0, { stiffness: 260, damping: 9 }) };
  spinRoot.add(smile);

  // 裏側にも同じロゴ（回したときに板の裏が寂しくないように）
  const back = new THREE.Group();
  back.rotation.y = Math.PI;
  back.position.z = -0.74;
  const mirrors = [...letters, smile].map((src) => {
    const c = src.clone();
    back.add(c);
    return [src, c];
  });
  spinRoot.add(back);

  // まわりに浮かぶ小さな真珠
  const dust = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), pearlMaterial(0xffffff), 34);
  const dustData = [];
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < dust.count; i++) {
    const r = 3.6 + Math.random() * 3.5;
    const a = Math.random() * Math.PI * 2;
    dustData.push({
      a,
      r,
      y: (Math.random() - 0.5) * 5,
      z: -2 - Math.random() * 5,
      s: 0.03 + Math.random() * 0.09,
      sp: 0.03 + Math.random() * 0.06,
      ph: Math.random() * 10,
    });
  }
  scene.add(dust);

  // -------------------------------------------------------------------------
  // 入力
  // -------------------------------------------------------------------------
  const pointer = new THREE.Vector2(0, 0); // -1..1
  const tilt = { x: new Spring(0, { stiffness: 40, damping: 9 }), y: new Spring(0, { stiffness: 40, damping: 9 }) };
  const spin = { y: 0, x: 0, vy: 0, vx: 0 };
  let dragging = false;
  let dragStart = null;
  let lastMove = null;
  let lastInteraction = -10;
  const raycaster = new THREE.Raycaster();

  const toNdc = (e) => {
    const r = canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };

  window.addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "mouse") {
        pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      }
      if (!dragging || !lastMove) return;
      const dx = e.clientX - lastMove.x;
      const dy = e.clientY - lastMove.y;
      const dt = Math.max((e.timeStamp - lastMove.t) / 1000, 1 / 240);
      spin.y += dx * 0.012;
      spin.x += dy * 0.006;
      spin.vy = (dx * 0.012) / dt;
      spin.vx = (dy * 0.006) / dt;
      lastMove = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      if (Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > 6) {
        canvas.classList.add("is-dragging");
      }
    },
    { passive: true }
  );

  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    dragStart = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    lastMove = { ...dragStart };
    spin.vx = spin.vy = 0;
    lastInteraction = performance.now() / 1000;
    canvas.setPointerCapture?.(e.pointerId);
  });

  const endDrag = (e, cancelled) => {
    if (!dragging) return;
    dragging = false;
    canvas.classList.remove("is-dragging");
    lastInteraction = performance.now() / 1000;
    const moved = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
    if (!cancelled && moved < 8 && e.timeStamp - dragStart.t < 500) tap(toNdc(e));
    // 止まっていたら慣性をつけない
    if (e.timeStamp - lastMove.t > 80) spin.vx = spin.vy = 0;
  };
  canvas.addEventListener("pointerup", (e) => endDrag(e, false));
  canvas.addEventListener("pointercancel", (e) => endDrag(e, true));

  // スマホは端末の傾きでも少し動く
  window.addEventListener(
    "deviceorientation",
    (e) => {
      if (e.gamma == null) return;
      pointer.set(THREE.MathUtils.clamp(e.gamma / 30, -1, 1), THREE.MathUtils.clamp((45 - e.beta) / 30, -1, 1));
    },
    { passive: true }
  );

  function tap(ndc) {
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(letters, true);
    let hitIndex = -1;
    if (hits.length) {
      let o = hits[0].object;
      while (o && !letters.includes(o)) o = o.parent;
      hitIndex = letters.indexOf(o);
    }
    // 全体をぷるんと
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
  }

  // -------------------------------------------------------------------------
  // サイズ
  // -------------------------------------------------------------------------
  observeSize(stage, (w, h) => {
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 板の幅が画面に収まるようにカメラの距離を決める
    const fitW = 6.9;
    const fitH = 4.4;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const distH = fitH / 2 / Math.tan(vFov / 2);
    const distW = fitW / 2 / (Math.tan(vFov / 2) * camera.aspect);
    camera.position.z = Math.max(distH, distW);
    camera.updateProjectionMatrix();
  });

  // -------------------------------------------------------------------------
  // 登場アニメーション
  // -------------------------------------------------------------------------
  const introStart = performance.now() / 1000 + 0.2;
  letters.forEach((l) => (l.userData.pop.target = 1));
  smile.userData.pop.target = 1;

  const e = new THREE.Euler();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();

  runWhenVisible(stage, (dt, t) => {
    const calm = reducedMotion.matches;

    // 登場：1文字ずつ、ぽんっと
    letters.forEach((l, i) => {
      const u = l.userData;
      if (t > introStart + i * 0.12 || calm) {
        if (calm) u.pop.value = 1;
        const p = u.pop.update(dt);
        const s = u.squash.update(dt) * 0.06;
        const lift = u.lift.update(dt) * 0.05;
        const bob = calm ? 0 : Math.sin(t * 1.6 + i * 0.9) * 0.035;
        l.scale.set(p * (1 - s * 0.6), p * (1 + s), p * (1 - s * 0.6));
        l.position.y = 0.32 + bob + lift;
        l.rotation.z = calm ? 0 : Math.sin(t * 1.2 + i) * 0.025;
      }
    });
    if (t > introStart + letters.length * 0.12 || calm) {
      const u = smile.userData;
      if (calm) u.pop.value = 1;
      const p = u.pop.update(dt);
      const s = u.squash.update(dt) * 0.08;
      smile.scale.set(p * (1 - s), p * (1 + s), p);
    }

    for (const [src, c] of mirrors) {
      c.position.y = src.position.y;
      c.scale.copy(src.scale);
      c.rotation.z = -src.rotation.z;
    }

    // 傾き（マウス / 端末）
    tilt.x.target = -pointer.y * 0.22;
    tilt.y.target = pointer.x * 0.32;
    tiltRoot.rotation.x = tilt.x.update(dt);
    tiltRoot.rotation.y = tilt.y.update(dt);
    tiltRoot.position.y = calm ? 0 : Math.sin(t * 0.8) * 0.06;

    // ドラッグ回転：慣性 → しばらくしたら正面へ戻る
    if (!dragging) {
      spin.y += spin.vy * dt;
      spin.x += spin.vx * dt;
      const friction = Math.exp(-dt * 2.4);
      spin.vy *= friction;
      spin.vx *= friction;
      const idle = t - lastInteraction;
      if (Math.abs(spin.vy) < 1.2 && idle > 0.6) {
        const home = Math.round(spin.y / (Math.PI * 2)) * Math.PI * 2;
        spin.vy += (home - spin.y) * dt * 9;
        spin.vy *= Math.exp(-dt * 4);
      }
      spin.vx += -spin.x * dt * 14;
      spin.vx *= Math.exp(-dt * 5);
    }
    spin.x = THREE.MathUtils.clamp(spin.x, -0.9, 0.9);
    spinRoot.rotation.set(spin.x, spin.y, 0);

    // ライトをゆっくり回して真珠の光り方を変える
    pinkLight.position.x = 4 * Math.cos(t * 0.4);
    pinkLight.position.y = -2 + Math.sin(t * 0.5) * 1.5;
    blueLight.position.x = -4 * Math.cos(t * 0.33);

    // 浮かぶ小さな真珠
    for (let i = 0; i < dust.count; i++) {
      const d = dustData[i];
      const a = d.a + (calm ? 0 : t * d.sp);
      pos.set(Math.cos(a) * d.r, d.y + Math.sin(t * 0.6 + d.ph) * 0.25, d.z + Math.sin(a) * 1.5);
      pos.x += pointer.x * 0.25 * (1 / -d.z) * 4;
      scl.setScalar(d.s);
      m4.compose(pos, q.setFromEuler(e.set(0, 0, 0)), scl);
      dust.setMatrixAt(i, m4);
    }
    dust.instanceMatrix.needsUpdate = true;

    renderer.render(scene, camera);
  });
}
