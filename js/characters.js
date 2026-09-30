// グループごとの、顔つきの丸いキャラクター
// ・ぷかぷか浮かぶ
// ・ポインターの方を見る
// ・タップするとジャンプしてくるっと回る
import * as THREE from "three";
import {
  createRenderer,
  createEnvironment,
  Spring,
  runWhenVisible,
  observeSize,
  reducedMotion,
  PASTELS,
} from "./lib.js";

function characterMaterial(color) {
  return new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.28,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    sheen: 0.35,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color(0xffffff),
    envMapIntensity: 0.75,
  });
}

function makeCharacter(color, inkMat) {
  const root = new THREE.Group(); // 位置
  const body = new THREE.Group(); // 伸び縮み・回転
  root.add(body);

  const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), characterMaterial(color));
  body.add(ball);

  const face = new THREE.Group(); // 視線
  body.add(face);

  // 黒い点の目
  const eyeGeo = new THREE.SphereGeometry(0.085, 20, 14);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, inkMat);
    const dir = new THREE.Vector3(sx * 0.3, 0.14, 1).normalize();
    eye.position.copy(dir.multiplyScalar(0.985));
    eye.scale.set(1, 1.25, 0.6);
    eye.lookAt(eye.position.clone().multiplyScalar(2));
    face.add(eye);
  }

  // 笑顔（球面に沿ったチューブ）
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const t = -1 + (2 * i) / 20;
    const v = new THREE.Vector3(t * 0.24, -0.12 - (1 - t * t) * 0.11, 1).normalize().multiplyScalar(1.005);
    pts.push(v);
  }
  const smile = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.028, 10, false),
    inkMat
  );
  face.add(smile);
  for (const end of [pts[0], pts[pts.length - 1]]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 8), inkMat);
    cap.position.copy(end);
    face.add(cap);
  }

  // ほっぺ
  const cheekMat = new THREE.MeshBasicMaterial({ color: 0xff8fb5, transparent: true, opacity: 0.35 });
  for (const sx of [-1, 1]) {
    const cheek = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), cheekMat);
    const dir = new THREE.Vector3(sx * 0.5, -0.08, 1).normalize();
    cheek.position.copy(dir.clone().multiplyScalar(1.004));
    cheek.lookAt(dir.multiplyScalar(3));
    cheek.scale.set(1.3, 0.8, 1);
    face.add(cheek);
  }

  root.userData = {
    ball,
    body,
    face,
    squash: new Spring(0, { stiffness: 220, damping: 8 }),
    jump: 0,
    jumpV: 0,
    spin: 0,
    spinV: 0,
    phase: Math.random() * Math.PI * 2,
    look: new THREE.Vector2(),
  };
  return root;
}

export function initCharacters(canvas) {
  const stage = canvas.parentElement;
  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  scene.environment = createEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(20, 1, 0.1, 100);
  camera.position.set(0, 0, 16);

  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(-4, 6, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xcdb8ff, 1.2);
  rim.position.set(5, -2, -4);
  scene.add(rim);

  const inkMat = new THREE.MeshPhysicalMaterial({ color: 0x141319, roughness: 0.25, clearcoat: 1 });

  // 影の代わりのやわらかい楕円
  const shadowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, "rgba(0,0,0,0.55)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();

  const colors = [PASTELS.blue, PASTELS.pink, PASTELS.mint, PASTELS.yellow, PASTELS.purple, PASTELS.orange];
  const sizes = [1.15, 0.9, 1.05, 0.8, 1.0, 0.85];
  const charas = colors.map((c, i) => {
    const ch = makeCharacter(c, inkMat);
    ch.userData.size = sizes[i];
    ch.scale.setScalar(sizes[i]);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.7),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
    );
    ch.userData.shadow = shadow;
    scene.add(shadow);
    scene.add(ch);
    return ch;
  });

  // 画面の縦横比に合わせて並べ方を変える
  let layout = [];
  function arrange(aspect) {
    if (aspect < 1.4) {
      // スマホ：3 × 2
      layout = [
        [-2.3, 1.9, 0], [0.2, 2.5, -1], [2.4, 1.6, 0.4],
        [-2.2, -1.5, 0.6], [0.3, -1.0, -0.4], [2.5, -1.9, 0],
      ];
    } else {
      // PC：ゆるい1列
      layout = [
        [-6.4, 0.2, 0], [-3.9, -0.9, 0.8], [-1.3, 0.6, -0.6],
        [1.3, -0.7, 0.6], [3.9, 0.7, -0.3], [6.3, -0.4, 0.3],
      ];
    }
    charas.forEach((c, i) => {
      c.userData.home = new THREE.Vector3(...layout[i]);
    });
  }

  observeSize(stage, (w, h) => {
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    arrange(camera.aspect);
    const fitW = camera.aspect < 1.4 ? 7.6 : 16.4;
    const fitH = camera.aspect < 1.4 ? 7.8 : 4.6;
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    camera.position.z = Math.max(fitH / 2 / Math.tan(vFov / 2), fitW / 2 / (Math.tan(vFov / 2) * camera.aspect));
    camera.updateProjectionMatrix();
  });

  // -------------------------------------------------------------------------
  // 入力
  // -------------------------------------------------------------------------
  const pointerNdc = new THREE.Vector2(0, 0);
  const pointerWorld = new THREE.Vector3(0, 0, 6);
  const raycaster = new THREE.Raycaster();
  let hasPointer = false;

  const toNdc = (e) => {
    const r = canvas.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };

  window.addEventListener(
    "pointermove",
    (e) => {
      pointerNdc.copy(toNdc(e));
      hasPointer = true;
    },
    { passive: true }
  );

  let down = null;
  canvas.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    pointerNdc.copy(toNdc(e));
    hasPointer = true;
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 10) return;
    raycaster.setFromCamera(toNdc(e), camera);
    const hit = raycaster.intersectObjects(charas.map((c) => c.userData.ball), false)[0];
    if (!hit) return;
    const ch = charas.find((c) => c.userData.ball === hit.object);
    boing(ch);
    // となりの子もつられて少し跳ねる
    charas.forEach((o) => {
      if (o === ch) return;
      const d = o.position.distanceTo(ch.position);
      if (d < 3.6) setTimeout(() => boing(o, 0.45), 120 + d * 40);
    });
  });

  function boing(ch, strength = 1) {
    const u = ch.userData;
    if (u.jump > 0.05 && strength < 1) return;
    u.squash.kick(-10 * strength);
    setTimeout(() => {
      u.jumpV = 9 * strength;
      u.spinV = strength >= 1 ? Math.PI * 2 * 1.6 : 0;
      u.squash.kick(12 * strength);
    }, 90);
  }

  canvas.style.cursor = "pointer";

  // -------------------------------------------------------------------------
  const tmp = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -5);

  runWhenVisible(stage, (dt, t) => {
    const calm = reducedMotion.matches;

    // 視線の先（カメラ手前の平面上）
    if (hasPointer) {
      raycaster.setFromCamera(pointerNdc, camera);
      raycaster.ray.intersectPlane(plane, tmp) && pointerWorld.lerp(tmp, 1 - Math.exp(-dt * 8));
    } else {
      pointerWorld.set(Math.sin(t * 0.5) * 4, Math.cos(t * 0.7) * 1.5, 5);
    }

    // スクロールに合わせて少しだけ全体を回す
    const rect = stage.getBoundingClientRect();
    const progress = THREE.MathUtils.clamp(1 - (rect.top + rect.height) / (innerHeight + rect.height), 0, 1);

    charas.forEach((ch, i) => {
      const u = ch.userData;
      if (!u.home) return;

      // ジャンプ（簡単な重力）
      u.jumpV -= 26 * dt;
      u.jump += u.jumpV * dt;
      if (u.jump < 0) {
        if (u.jumpV < -3) u.squash.kick(u.jumpV * 0.9);
        u.jump = 0;
        u.jumpV = 0;
      }
      u.spinV *= Math.exp(-dt * 1.5);
      u.spin += u.spinV * dt;
      if (Math.abs(u.spinV) < 0.8) u.spin += (Math.round(u.spin / (Math.PI * 2)) * Math.PI * 2 - u.spin) * dt * 5;

      const bob = calm ? 0 : Math.sin(t * 1.4 + u.phase) * 0.18;
      const drift = calm ? 0 : Math.sin(t * 0.5 + u.phase) * 0.15;
      ch.position.set(
        u.home.x + drift,
        u.home.y + bob + u.jump + (progress - 0.5) * (i % 2 ? 0.8 : -0.8),
        u.home.z
      );

      const s = u.squash.update(dt) * 0.035;
      const breathe = calm ? 0 : Math.sin(t * 2 + u.phase) * 0.015;
      u.body.scale.set(1 - s * 0.5 + breathe, 1 + s - breathe, 1 - s * 0.5 + breathe);
      u.body.rotation.y = u.spin;

      // ポインターの方を見る
      tmp.copy(pointerWorld).sub(ch.position);
      const yaw = THREE.MathUtils.clamp(Math.atan2(tmp.x, tmp.z), -0.7, 0.7);
      const pitch = THREE.MathUtils.clamp(-Math.atan2(tmp.y, tmp.z), -0.5, 0.5);
      u.look.x += (pitch - u.look.x) * (1 - Math.exp(-dt * 6));
      u.look.y += (yaw - u.look.y) * (1 - Math.exp(-dt * 6));
      u.face.rotation.set(u.look.x, u.look.y, 0);
      u.body.rotation.z = calm ? 0 : Math.sin(t + u.phase) * 0.05;

      // 影
      const sh = u.shadow;
      const floorY = u.home.y - u.size * 1.25;
      sh.position.set(ch.position.x, floorY, ch.position.z - 0.6);
      const lift = ch.position.y - u.home.y + 0.3;
      const k = THREE.MathUtils.clamp(1 - lift * 0.2, 0.35, 1.1) * u.size;
      sh.scale.set(k, k, 1);
      sh.material.opacity = THREE.MathUtils.clamp(0.8 - lift * 0.15, 0.1, 0.8);
    });

    renderer.render(scene, camera);
  });
}
