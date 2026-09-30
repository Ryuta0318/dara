// Rooms：部屋ごとのキャラクター（ぷっくりした形 + 顔）が、つやのある床に並ぶ
// ・ポインターの方を見る
// ・タップするとジャンプしてくるっと回る
import * as THREE from "three";
import { Reflector } from "three/addons/Reflector.js";
import {
  createRenderer,
  createEnvironment,
  balloonMaterial,
  pearlMaterial,
  inkMaterial,
  shapeGeometry,
  Spring,
  runWhenVisible,
  observeSize,
  fitDistance,
  ndcFromEvent,
  onTap,
  reducedMotion,
  PASTELS,
} from "./lib.js";
import { buildShape } from "./sdf.js";

export const CHARACTERS = [
  { shape: "cloud", color: PASTELS.blue, face: [0.02, -0.02], tilt: 0.12 },
  { shape: "heart", color: PASTELS.pink, face: [0, -0.1], tilt: -0.04 },
  { shape: "flower", color: PASTELS.mint, face: [0, -0.02], tilt: 0.05 },
  { shape: "circle", color: PASTELS.yellow, face: [0.05, -0.06], tilt: 0 },
  { shape: "star", color: PASTELS.purple, face: [0, -0.06], tilt: -0.08 },
  { shape: "starfish", color: PASTELS.orange, face: [0.04, -0.04], tilt: 0.1 },
];

function softTexture(inner, outer) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function fadeTexture() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, "#fff");
  grd.addColorStop(0.45, "#ddd");
  grd.addColorStop(0.62, "#777");
  grd.addColorStop(1, "#333");
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  return new THREE.CanvasTexture(c);
}

// 顔：黒い点の目と、小さな笑顔
function makeFace(spec, ink) {
  const shape = buildShape({ kind: "blob", shape: spec.shape });
  const face = new THREE.Group();
  const [fx, fy] = spec.face;
  const surf = (x, y) => shape.height(x, y);
  const eye = new THREE.SphereGeometry(0.052, 18, 12);
  for (const sx of [-1, 1]) {
    const x = fx + sx * 0.2;
    const y = fy + 0.06;
    const m = new THREE.Mesh(eye, ink);
    m.position.set(x, y, surf(x, y) - 0.012);
    m.scale.set(1, 1.15, 0.6);
    face.add(m);
  }
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = -1 + (2 * i) / 16;
    const x = fx + t * 0.1;
    const y = fy - 0.05 - (1 - t * t) * 0.05 + t * t * 0.01;
    pts.push(new THREE.Vector3(x, y, surf(x, y) + 0.004));
  }
  face.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.017, 8, false), ink));
  const cap = new THREE.SphereGeometry(0.017, 8, 6);
  for (const p of [pts[0], pts[pts.length - 1]]) {
    const m = new THREE.Mesh(cap, ink);
    m.position.copy(p);
    face.add(m);
  }
  return face;
}

export async function initRooms(canvas, { onPick } = {}) {
  const stage = canvas.parentElement;
  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  scene.environment = createEnvironment(renderer);

  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-4, 7, 7);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xd9c8ff, 1.0);
  rim.position.set(5, 2, -5);
  scene.add(rim);

  // つやのある黒い床
  // 映り込みは色味を変えずに暗くするだけ
  const shader = {
    ...Reflector.ReflectorShader,
    fragmentShader: Reflector.ReflectorShader.fragmentShader.replace(
      "gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );",
      "gl_FragColor = vec4( base.rgb * color, 1.0 );"
    ),
  };
  const floor = new Reflector(new THREE.PlaneGeometry(60, 30), {
    textureWidth: 1024,
    textureHeight: 512,
    clipBias: 0.003,
    shader,
  });
  floor.material.uniforms.color.value.setRGB(0.17, 0.17, 0.19, THREE.LinearSRGBColorSpace);
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const veil = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 30),
    new THREE.MeshBasicMaterial({ color: 0x050507, transparent: true, alphaMap: fadeTexture(), depthWrite: false })
  );
  veil.rotation.x = -Math.PI / 2;
  veil.position.y = 0.002;
  scene.add(veil);

  // 真珠のライン
  const string = new THREE.Group();
  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 1, 8),
    new THREE.MeshPhysicalMaterial({ color: 0xd8c4a8, metalness: 0.6, roughness: 0.3 })
  );
  cord.rotation.z = Math.PI / 2;
  string.add(cord);
  const pearlGeo = new THREE.SphereGeometry(0.075, 20, 14);
  const pearlMat = pearlMaterial();
  string.position.y = 0.075;
  scene.add(string);

  const ink = inkMaterial();
  const shadowTex = softTexture("rgba(0,0,0,0.75)", "rgba(0,0,0,0)");

  const geos = await Promise.all(CHARACTERS.map((c) => shapeGeometry({ kind: "blob", shape: c.shape })));
  const charas = CHARACTERS.map((c, i) => {
    const root = new THREE.Group();
    const body = new THREE.Group();
    const mesh = new THREE.Mesh(geos[i], balloonMaterial(c.color));
    const inner = new THREE.Group();
    inner.add(mesh, makeFace(c, ink));
    inner.rotation.z = c.tilt;
    // 底を床につける
    inner.position.y = -geos[i].boundingBox.min.y;
    body.add(inner);
    root.add(body);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 2.4),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.004;
    scene.add(shadow, root);
    root.userData = {
      index: i,
      mesh,
      body,
      inner,
      shadow,
      squash: new Spring(0, { stiffness: 220, damping: 8 }),
      jump: 0,
      jumpV: 0,
      spin: 0,
      spinV: 0,
      phase: Math.random() * Math.PI * 2,
      look: new THREE.Vector2(),
      pop: new Spring(0, { stiffness: 110, damping: 10 }),
    };
    root.userData.pop.target = 1;
    return root;
  });

  // -------------------------------------------------------------------------
  // 並べ方
  // -------------------------------------------------------------------------
  let lookAt = new THREE.Vector3();
  let wide = true;
  function arrange() {
    wide = camera.aspect > 1.5;
    const size = wide ? 1.05 : 0.82;
    const slots = wide
      ? CHARACTERS.map((_, i) => [(i - 2.5) * 2.45, 0])
      : [[-2.2, -1.9], [0, -2.1], [2.2, -1.9], [-2.2, 1.0], [0, 0.8], [2.2, 1.0]];
    charas.forEach((c, i) => {
      c.userData.home = new THREE.Vector3(slots[i][0], 0, slots[i][1]);
      c.userData.size = size;
      c.scale.setScalar(size);
    });
    // 真珠のライン
    string.clear();
    string.add(cord);
    const len = wide ? 15 : 8;
    cord.scale.y = len;
    const zLine = wide ? 2.3 : 2.9;
    string.position.z = zLine;
    const n = wide ? 18 : 11;
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(pearlGeo, pearlMat);
      p.position.x = -len / 2 + 0.3 + ((len - 0.6) * i) / (n - 1);
      string.add(p);
    }
  }

  observeSize(stage, (w, h) => {
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    arrange();
    const d = wide ? fitDistance(camera, 15.2, 4.8) : fitDistance(camera, 7.4, 8.6);
    const elev = wide ? 0.2 : 0.62;
    lookAt = new THREE.Vector3(0, wide ? 0.1 : 0.2, 0);
    camera.position.set(0, lookAt.y + d * Math.sin(elev), d * Math.cos(elev));
    camera.lookAt(lookAt);
    camera.updateProjectionMatrix();
  });

  // -------------------------------------------------------------------------
  // 入力
  // -------------------------------------------------------------------------
  const pointerNdc = new THREE.Vector2();
  const pointerWorld = new THREE.Vector3(0, 1, 6);
  const raycaster = new THREE.Raycaster();
  let hasPointer = false;
  window.addEventListener(
    "pointermove",
    (e) => {
      pointerNdc.copy(ndcFromEvent(e, canvas));
      hasPointer = true;
    },
    { passive: true }
  );

  onTap(canvas, (e) => {
    const ndc = ndcFromEvent(e, canvas);
    pointerNdc.copy(ndc);
    hasPointer = true;
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(charas.map((c) => c.userData.mesh), false)[0];
    if (!hit) return;
    const ch = charas.find((c) => c.userData.mesh === hit.object);
    boing(ch);
    charas.forEach((o) => {
      if (o === ch) return;
      const d = o.position.distanceTo(ch.position);
      if (d < 3) setTimeout(() => boing(o, 0.4), 120 + d * 40);
    });
    if (onPick) {
      const p = ch.position.clone();
      p.y += 2.1 * ch.userData.size;
      p.project(camera);
      onPick(ch.userData.index, (p.x * 0.5 + 0.5) * 100, (-p.y * 0.5 + 0.5) * 100);
    }
  });

  function boing(ch, strength = 1) {
    const u = ch.userData;
    if (u.jump > 0.05 && strength < 1) return;
    u.squash.kick(-10 * strength);
    setTimeout(() => {
      u.jumpV = 8.5 * strength;
      u.spinV = strength >= 1 ? Math.PI * 2 * 1.5 : 0;
      u.squash.kick(12 * strength);
    }, 90);
  }

  // -------------------------------------------------------------------------
  const tmp = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -4);
  const start = performance.now() / 1000;
  let nextHop = start + 3;

  runWhenVisible(stage, (dt, t) => {
    const calm = reducedMotion.matches;

    if (hasPointer) {
      raycaster.setFromCamera(pointerNdc, camera);
      if (raycaster.ray.intersectPlane(plane, tmp)) pointerWorld.lerp(tmp, 1 - Math.exp(-dt * 8));
    } else {
      pointerWorld.set(Math.sin(t * 0.5) * 5, 1.2 + Math.cos(t * 0.7), 4);
    }

    // ときどき誰かが小さく跳ねる
    if (!calm && t > nextHop) {
      boing(charas[Math.floor(Math.random() * charas.length)], 0.45);
      nextHop = t + 2.5 + Math.random() * 3;
    }

    charas.forEach((ch, i) => {
      const u = ch.userData;
      if (!u.home) return;
      if (t < start + 0.2 + i * 0.1 && !calm) {
        ch.visible = false;
        return;
      }
      ch.visible = true;
      if (calm) u.pop.value = 1;
      const p = u.pop.update(dt);

      u.jumpV -= 24 * dt;
      u.jump += u.jumpV * dt;
      if (u.jump < 0) {
        if (u.jumpV < -3) u.squash.kick(u.jumpV * 0.9);
        u.jump = 0;
        u.jumpV = 0;
      }
      u.spinV *= Math.exp(-dt * 1.5);
      u.spin += u.spinV * dt;
      if (Math.abs(u.spinV) < 0.8) u.spin += (Math.round(u.spin / (Math.PI * 2)) * Math.PI * 2 - u.spin) * dt * 5;

      ch.position.set(u.home.x, u.jump, u.home.z);
      ch.scale.setScalar(u.size * p);

      const s = u.squash.update(dt) * 0.035;
      const breathe = calm ? 0 : Math.sin(t * 2 + u.phase) * 0.012;
      u.body.scale.set(1 - s * 0.5 + breathe, 1 + s - breathe, 1 - s * 0.5 + breathe);

      tmp.copy(pointerWorld).sub(ch.position);
      const yaw = THREE.MathUtils.clamp(Math.atan2(tmp.x, tmp.z), -0.55, 0.55);
      const pitch = THREE.MathUtils.clamp(-Math.atan2(tmp.y - 1, tmp.z) * 0.6, -0.3, 0.3);
      u.look.x += (pitch - u.look.x) * (1 - Math.exp(-dt * 6));
      u.look.y += (yaw - u.look.y) * (1 - Math.exp(-dt * 6));
      u.body.rotation.set(u.look.x, u.look.y + u.spin, calm ? 0 : Math.sin(t + u.phase) * 0.04);

      const k = THREE.MathUtils.clamp(1 - u.jump * 0.25, 0.3, 1) * u.size * p;
      u.shadow.position.x = ch.position.x;
      u.shadow.position.z = ch.position.z + 0.1;
      u.shadow.scale.set(k, k * 0.8, 1);
      u.shadow.material.opacity = THREE.MathUtils.clamp(1 - u.jump * 0.3, 0.15, 1);
    });

    renderer.render(scene, camera);
  });
}
