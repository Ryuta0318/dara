// About：ぷっくりした真珠のアイコン（招待制 / 雑談 / 写真 / 秘密）
import * as THREE from "three";
import {
  createRenderer,
  createEnvironment,
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
} from "./lib.js";
import { buildShape } from "./sdf.js";

const ICONS = ["invite", "chat", "photo", "lock"];

function flatShape(points, depth = 0.03) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  const g = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.02,
    bevelSegments: 4,
    curveSegments: 16,
  });
  return g;
}

function decorate(name, ink) {
  const shape = buildShape({ kind: "icon", shape: name });
  const z = (x, y) => shape.height(x, y);
  const g = new THREE.Group();
  if (name === "chat") {
    const dot = new THREE.SphereGeometry(0.058, 16, 12);
    for (const x of [-0.2, 0, 0.2]) {
      const m = new THREE.Mesh(dot, ink);
      m.position.set(x, 0.08, z(x, 0.08) - 0.015);
      m.scale.z = 0.6;
      g.add(m);
    }
  }
  if (name === "photo") {
    const mountain = flatShape([[-0.32, -0.26], [-0.08, 0.06], [0.04, -0.06], [0.14, 0.02], [0.34, -0.26]]);
    const m = new THREE.Mesh(mountain, ink);
    m.position.z = z(0, -0.1) - 0.02;
    g.add(m);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), ink);
    sun.position.set(0.2, 0.22, z(0.2, 0.22) - 0.015);
    sun.scale.z = 0.5;
    g.add(sun);
  }
  if (name === "lock") {
    const hole = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), ink);
    hole.position.set(0, -0.14, z(0, -0.14) - 0.015);
    hole.scale.z = 0.5;
    const stem = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.1, 6, 12), ink);
    stem.position.set(0, -0.26, z(0, -0.26) - 0.012);
    stem.scale.z = 0.5;
    g.add(hole, stem);
  }
  return g;
}

export async function initIcons(canvas) {
  const stage = canvas.parentElement;
  const renderer = createRenderer(canvas);
  const scene = new THREE.Scene();
  scene.environment = createEnvironment(renderer);
  const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 100);
  camera.position.z = 10;
  scene.add(new THREE.AmbientLight(0xffffff, 0.2));
  const key = new THREE.DirectionalLight(0xfff4ea, 1.5);
  key.position.set(-3, 4, 6);
  scene.add(key);
  const warm = new THREE.PointLight(0xffc6d9, 6, 12);
  warm.position.set(3, -1, 4);
  scene.add(warm);

  const pearl = pearlMaterial();
  const ink = inkMaterial();
  const geos = await Promise.all(ICONS.map((shape) => shapeGeometry({ kind: "icon", shape })));

  const icons = ICONS.map((name, i) => {
    const root = new THREE.Group();
    const body = new THREE.Group();
    const mesh = new THREE.Mesh(geos[i], pearl);
    body.add(mesh, decorate(name, ink));
    root.add(body);
    root.userData = {
      mesh,
      body,
      phase: i * 1.3,
      squash: new Spring(0, { stiffness: 240, damping: 9 }),
      spin: 0,
      spinV: 0,
      look: new THREE.Vector2(),
      pop: new Spring(0, { stiffness: 110, damping: 10 }),
    };
    scene.add(root);
    return root;
  });

  let colW = 1;
  observeSize(stage, (w, h) => {
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 4列のラベルと中心をそろえる
    const viewW = 4 * 1.7;
    camera.position.z = fitDistance(camera, viewW, 1.7);
    camera.updateProjectionMatrix();
    const vh = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.position.z;
    const vw = vh * camera.aspect;
    colW = vw / 4;
    const size = Math.min(colW * 0.62, vh * 0.62);
    icons.forEach((ic, i) => {
      ic.position.x = (i + 0.5) * colW - vw / 2;
      ic.userData.size = size;
    });
  });

  const pointer = new THREE.Vector2();
  window.addEventListener(
    "pointermove",
    (e) => pointer.copy(ndcFromEvent(e, canvas)).clampScalar(-3, 3),
    { passive: true }
  );

  const raycaster = new THREE.Raycaster();
  const kick = (ic) => {
    ic.userData.squash.kick(-11);
    ic.userData.spinV = Math.PI * 2 * 1.4;
  };
  onTap(canvas, (e) => {
    raycaster.setFromCamera(ndcFromEvent(e, canvas), camera);
    const hit = raycaster.intersectObjects(icons.map((c) => c.userData.mesh), false)[0];
    if (hit) kick(icons.find((c) => c.userData.mesh === hit.object));
  });

  let started = null;
  runWhenVisible(stage, (dt, t) => {
    const calm = reducedMotion.matches;
    if (started === null) started = t;
    icons.forEach((ic, i) => {
      const u = ic.userData;
      if (t - started > 0.15 + i * 0.12 || calm) u.pop.target = 1;
      if (calm) u.pop.value = u.pop.target = 1;
      const p = Math.max(u.pop.update(dt), 0.001);
      const s = u.squash.update(dt) * 0.05;
      u.spinV *= Math.exp(-dt * 1.8);
      u.spin += u.spinV * dt;
      if (Math.abs(u.spinV) < 0.8) u.spin += (Math.round(u.spin / (Math.PI * 2)) * Math.PI * 2 - u.spin) * dt * 5;
      const k = (u.size ?? 1) * p;
      ic.scale.set(k * (1 - s * 0.5), k * (1 + s), k);
      ic.position.y = calm ? 0 : Math.sin(t * 1.5 + u.phase) * 0.06;
      const tx = (pointer.x - (ic.position.x / (colW * 2))) * 0.35;
      u.look.y += (THREE.MathUtils.clamp(tx, -0.5, 0.5) - u.look.y) * (1 - Math.exp(-dt * 5));
      u.look.x += (THREE.MathUtils.clamp(-pointer.y * 0.25, -0.4, 0.4) - u.look.x) * (1 - Math.exp(-dt * 5));
      u.body.rotation.set(u.look.x, u.look.y + u.spin, calm ? 0 : Math.sin(t * 0.9 + u.phase) * 0.06);
    });
    renderer.render(scene, camera);
  });
}
