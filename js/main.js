// DARA landing — ページ全体のふるまい

// アプリのURL（DARA用のURLが決まったらここを変える）
const APP_URL = "https://setroom.ryuta-suzuki.workers.dev";

document.documentElement.classList.remove("no-js");
document.getElementById("app-link").href = APP_URL;

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

// ナビ：スクロールしたら背景を付ける ------------------------------------------
const nav = document.querySelector(".nav");
const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 24);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// スクロールで出てくる -------------------------------------------------------
const reveals = document.querySelectorAll(".reveal");
const groups = new Map();
reveals.forEach((el) => {
  const key = el.parentElement;
  const i = groups.get(key) ?? 0;
  el.style.setProperty("--i", i);
  groups.set(key, i + 1);
});
const io = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-in");
        io.unobserve(entry.target);
      }
    }
  },
  { rootMargin: "0px 0px -10% 0px", threshold: 0.12 }
);
reveals.forEach((el) => io.observe(el));

// カード：触ると傾き、光の当たり方が変わる ------------------------------------
document.querySelectorAll(".tilt").forEach((card) => {
  const max = card.classList.contains("room") ? 8 : 14;
  const move = (e) => {
    if (reduced.matches) return;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    card.classList.add("is-hover");
    card.style.setProperty("--ry", `${(px - 0.5) * max}deg`);
    card.style.setProperty("--rx", `${(0.5 - py) * max}deg`);
    card.style.setProperty("--mx", `${px * 100}%`);
    card.style.setProperty("--my", `${py * 100}%`);
  };
  const leave = () => {
    card.classList.remove("is-hover");
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
    card.style.setProperty("--mx", "30%");
    card.style.setProperty("--my", "20%");
  };
  card.addEventListener("pointermove", move);
  card.addEventListener("pointerdown", move);
  card.addEventListener("pointerleave", leave);
  card.addEventListener("pointerup", (e) => e.pointerType !== "mouse" && leave());
  card.addEventListener("pointercancel", leave);
});

// ボタン：押すとぷにっと（タッチでも確実に見えるように） ------------------------
document.querySelectorAll(".pearl-btn").forEach((btn) => {
  btn.addEventListener("pointerdown", () => btn.classList.add("is-pressed"));
  const up = () => btn.classList.remove("is-pressed");
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointerleave", up);
  btn.addEventListener("pointercancel", up);
});

// スマホの画面：スクロールに合わせて向きが変わる --------------------------------
const phone = document.getElementById("phone");
let phoneRaf = 0;
const updatePhone = () => {
  phoneRaf = 0;
  if (reduced.matches) return;
  const r = phone.getBoundingClientRect();
  const p = Math.min(Math.max((innerHeight - r.top) / (innerHeight + r.height), 0), 1);
  phone.style.setProperty("--pry", `${(0.5 - p) * 44}deg`);
  phone.style.setProperty("--prx", `${(p - 0.5) * -14 + 6}deg`);
};
addEventListener("scroll", () => (phoneRaf ||= requestAnimationFrame(updatePhone)), { passive: true });
updatePhone();

if (finePointer.matches) {
  phone.addEventListener("pointermove", (e) => {
    if (reduced.matches) return;
    const r = phone.getBoundingClientRect();
    phone.style.setProperty("--pry", `${((e.clientX - r.left) / r.width - 0.5) * 24}deg`);
    phone.style.setProperty("--prx", `${(0.5 - (e.clientY - r.top) / r.height) * 18}deg`);
  });
  phone.addEventListener("pointerleave", updatePhone);
}

// 3D ---------------------------------------------------------------------------
function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

if (hasWebGL()) {
  Promise.all([import("./logo.js"), import("./characters.js")])
    .then(([{ initLogo }, { initCharacters }]) => {
      initLogo(document.getElementById("logo-canvas"));
      initCharacters(document.getElementById("chara-canvas"));
    })
    .catch((err) => {
      console.error(err);
      document.documentElement.classList.add("no-webgl");
    });
} else {
  document.documentElement.classList.add("no-webgl");
}
