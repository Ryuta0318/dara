// DARA landing — ページ全体のふるまい

// アプリのURL（DARA用のURLが決まったらここを変える）
const APP_URL = "https://setroom.ryuta-suzuki.workers.dev";

document.documentElement.classList.remove("no-js");
document.getElementById("app-link").href = APP_URL;

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

// ---------------------------------------------------------------------------
// 言語（日本語は HTML の中身をそのまま使う）
// ---------------------------------------------------------------------------
const EN = {
  "nav.start": "Start",
  "hero.title": "A little place just for friends",
  "about.title": "With your people",
  "about.l1": "No strangers",
  "about.l2": "No endless timeline",
  "about.l3": "Just the usual crew",
  "about.i1": "Invite only",
  "about.i1d": "Sign up with an invite code",
  "about.i2": "Chat",
  "about.i2d": "No character limit",
  "about.i3": "Photos",
  "about.i3d": "Up to 4 per post",
  "about.i4": "Private",
  "about.i4d": "Only members can see",
  "rooms.title": "All kinds of rooms",
  "rooms.lead": "Pick your friends and make a room. Every room has its own round little character.",
  "rooms.hint": "Give them a poke",
  "play.title": "Peek inside a room",
  "play.lead": "Tap the card for the next room. Try sending a message too.",
  "play.next": "See the next room",
  "play.inputLabel": "Message",
  "play.placeholder": "Type a message",
  "play.send": "Send",
  "features.title": "What you can do",
  f1: "No character limit",
  f1d: "A single word, a long story, or just a photo",
  f2: "Up to 4 photos",
  f2d: "Resized on your device before sending, so it stays light",
  f3: "Threads and comments",
  f3d: "One post becomes a thread everyone can keep going",
  f4: "Friends-only groups",
  f4d: "Find friends by name or ID and send a request",
  f5: "Auto refresh",
  f5d: "New comments arrive every few seconds",
  f6: "Reduced motion",
  f6d: "Calmer when you'd rather skip the 3D wobble",
  "steps.title": "Getting started",
  s1: "Sign up with an invite",
  s2: "Add friends",
  s3: "Make a room",
  s4: "Start a thread",
  s5: "Chat together",
  "nots.title": "What we don't do",
  n1: "Public posts or going viral",
  n2: "Racing for likes and followers",
  n3: "Ads",
  n4: "Cluttered screens",
  "cta.title": "Hang out, just your crew",
  "cta.lead": "Got an invite code? Sign up here.",
  "cta.button": "Open DARA",
};

const i18nEls = [...document.querySelectorAll("[data-i18n]")];
const i18nAttrEls = [...document.querySelectorAll("[data-i18n-attr]")];
const JA = {};
i18nEls.forEach((el) => (JA[el.dataset.i18n] = el.innerHTML));
i18nAttrEls.forEach((el) => {
  const [attr, key] = el.dataset.i18nAttr.split(":");
  JA[key] = el.getAttribute(attr);
});

let lang = "ja";
try {
  lang = localStorage.getItem("dara.lang") || "ja";
} catch {}

function setLang(next) {
  lang = next === "en" ? "en" : "ja";
  const dict = lang === "en" ? EN : JA;
  document.documentElement.lang = lang;
  i18nEls.forEach((el) => {
    const v = dict[el.dataset.i18n];
    if (v != null) el.innerHTML = v;
  });
  i18nAttrEls.forEach((el) => {
    const [attr, key] = el.dataset.i18nAttr.split(":");
    if (dict[key] != null) el.setAttribute(attr, dict[key]);
  });
  document.querySelectorAll("[data-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lang === lang)));
  document.title = lang === "en" ? "DARA — A little place just for friends" : "DARA — 友達だけのちいさな場所";
  try {
    localStorage.setItem("dara.lang", lang);
  } catch {}
  renderStack();
  showRoom(current, { instant: true });
}
document.querySelectorAll("[data-lang]").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));

// ---------------------------------------------------------------------------
// 部屋のデータ
// ---------------------------------------------------------------------------
const ROOMS = [
  {
    color: "var(--pink)",
    ja: { name: "週末ドライブ部", pace: "ゆっくり" },
    en: { name: "Weekend Drive Club", pace: "slow" },
    members: 8,
    topics: 12,
    people: ["R", "M", "K"],
    chat: {
      ja: [["R", "次の週末 どこ行く"], ["R", { photo: "sea" }], ["M", "海がいい"], ["K", "朝出よう"]],
      en: [["R", "Where to next weekend?"], ["R", { photo: "sea" }], ["M", "The sea!"], ["K", "Let's leave early"]],
    },
    replies: { ja: ["いいね", "賛成", "運転するよ"], en: ["Nice", "Agreed", "I'll drive"] },
  },
  {
    color: "var(--blue)",
    ja: { name: "大学の同期", pace: "にぎやか" },
    en: { name: "College Friends", pace: "lively" },
    members: 12,
    topics: 34,
    people: ["S", "A", "T"],
    chat: {
      ja: [["S", "同窓会いつにする"], ["A", "11月の三連休は？"], ["T", "賛成"], ["S", "お店さがしとく"]],
      en: [["S", "When's the reunion?"], ["A", "The November long weekend?"], ["T", "I'm in"], ["S", "I'll find a place"]],
    },
    replies: { ja: ["たのしみ", "わかる", "それな"], en: ["Can't wait", "Same", "True"] },
  },
  {
    color: "var(--mint)",
    ja: { name: "ひとりごと", pace: "マイペース" },
    en: { name: "Notes to Self", pace: "my pace" },
    members: 1,
    topics: 58,
    people: ["R"],
    chat: {
      ja: [["R", "今日は富士山が見えた"], ["R", { photo: "fuji" }], ["R", "帰りにラーメンを食べた"], ["R", { photo: "ramen" }]],
      en: [["R", "Saw Mt. Fuji today"], ["R", { photo: "fuji" }], ["R", "Had ramen on the way home"], ["R", { photo: "ramen" }]],
    },
    replies: { ja: ["メモしておこう"], en: ["Noted"] },
  },
  {
    color: "var(--yellow)",
    ja: { name: "家族", pace: "のんびり" },
    en: { name: "Family", pace: "easy" },
    members: 4,
    topics: 21,
    people: ["H", "Y", "N"],
    chat: {
      ja: [["H", "晩ごはん何がいい"], ["Y", "カレー"], ["N", "カレー！"], ["H", "了解 買って帰る"]],
      en: [["H", "What's for dinner?"], ["Y", "Curry"], ["N", "Curry!"], ["H", "Got it, picking some up"]],
    },
    replies: { ja: ["ありがとう", "はーい"], en: ["Thanks", "Okay"] },
  },
  {
    color: "var(--purple)",
    ja: { name: "映画の会", pace: "ときどき" },
    en: { name: "Movie Night", pace: "now and then" },
    members: 5,
    topics: 9,
    people: ["E", "J", "K"],
    chat: {
      ja: [["E", "次なに観る"], ["J", "SFがいい"], ["K", "金曜の夜どう"], ["E", "いいね"]],
      en: [["E", "What should we watch?"], ["J", "Something sci-fi"], ["K", "Friday night?"], ["E", "Sounds good"]],
    },
    replies: { ja: ["ポップコーン係やる", "いいね"], en: ["I'll bring popcorn", "Nice"] },
  },
  {
    color: "var(--orange)",
    ja: { name: "サウナ部", pace: "ととのう" },
    en: { name: "Sauna Club", pace: "chill" },
    members: 6,
    topics: 15,
    people: ["D", "M", "R"],
    chat: {
      ja: [["D", "今日も行く？"], ["M", "19時に集合"], ["R", "水風呂が最高だった"], ["D", "ととのった"]],
      en: [["D", "Going again today?"], ["M", "Meet at 7"], ["R", "The cold plunge was perfect"], ["D", "So relaxed"]],
    },
    replies: { ja: ["ととのった", "また行こう"], en: ["So good", "Let's go again"] },
  },
];

// ---------------------------------------------------------------------------
// カードの山（タップ / スワイプで次の部屋へ）
// ---------------------------------------------------------------------------
const stack = document.getElementById("stack");
// css の .card と同じ値
const STACK_STEP = 7;
const STACK_SCALE = 0.035;
let order = ROOMS.map((_, i) => i); // order[0] が一番上
let current = 0;
let cardEls = [];

function cardHTML(i) {
  const r = ROOMS[i];
  const t = r[lang];
  const unit = lang === "ja" ? "人" : "";
  return `
    <div class="card__face" aria-hidden="true"><i></i><i></i><b></b></div>
    <p class="card__case">Case ${String(i + 1).padStart(2, "0")} | ${String(ROOMS.length).padStart(2, "0")}</p>
    <p class="card__name">${t.name}</p>
    <dl class="card__meta">
      <div><dt>members</dt><dd>${r.members}${unit}</dd></div>
      <div><dt>topics</dt><dd>${r.topics}</dd></div>
      <div><dt>pace</dt><dd>${t.pace}</dd></div>
    </dl>`;
}

function renderStack() {
  if (!cardEls.length) {
    cardEls = ROOMS.map((r, i) => {
      const el = document.createElement("div");
      el.className = "card";
      el.style.setProperty("--c", r.color);
      stack.appendChild(el);
      return el;
    });
  }
  cardEls.forEach((el, i) => (el.innerHTML = cardHTML(i)));
  layoutStack();
}

function layoutStack() {
  order.forEach((roomIndex, pos) => {
    const el = cardEls[roomIndex];
    el.style.setProperty("--pos", pos);
    el.style.zIndex = String(ROOMS.length - pos);
    el.setAttribute("aria-hidden", String(pos !== 0));
    el.classList.toggle("is-top", pos === 0);
  });
}

function nextRoom(dir = 1) {
  const top = cardEls[order[0]];
  const dx = top.style.getPropertyValue("--dx") || "0px";
  if (dir > 0) order = [...order.slice(1), order[0]];
  else order = [order[order.length - 1], ...order.slice(0, -1)];
  if (!reduced.matches && dir > 0) {
    // 一番上のカードが、ぽよんと浮いて後ろへ回る
    top.classList.add("is-leaving");
    top.animate(
      [
        { transform: `translate(${dx}, 0) rotate(0deg)`, zIndex: 20 },
        { transform: "translate(0, -34%) rotate(-7deg) scale(1.04)", zIndex: 20, offset: 0.45 },
        { transform: "translate(0, -34%) rotate(-7deg) scale(1.04)", zIndex: 0, offset: 0.46 },
        { transform: `translateY(${(ROOMS.length - 1) * STACK_STEP}%) scale(${1 - (ROOMS.length - 1) * STACK_SCALE})`, zIndex: 0 },
      ],
      { duration: 720, easing: "cubic-bezier(.34,1.3,.64,1)" }
    ).finished.then(() => top.classList.remove("is-leaving"));
  }
  top.style.removeProperty("--dx");
  top.style.removeProperty("--rot");
  layoutStack();
  showRoom(order[0]);
}

// スワイプ
let drag = null;
stack.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, moved: false };
  stack.setPointerCapture(e.pointerId);
});
stack.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  if (Math.abs(dx) > 6) drag.moved = true;
  const top = cardEls[order[0]];
  top.classList.add("is-dragging");
  top.style.setProperty("--dx", `${dx}px`);
  top.style.setProperty("--rot", `${dx * 0.04}deg`);
});
const endStackDrag = (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const top = cardEls[order[0]];
  top.classList.remove("is-dragging");
  const wasTap = !drag.moved;
  drag = null;
  if (wasTap || Math.abs(dx) > 60) nextRoom(1);
  else {
    top.style.removeProperty("--dx");
    top.style.removeProperty("--rot");
  }
};
stack.addEventListener("pointerup", endStackDrag);
stack.addEventListener("pointercancel", () => {
  if (!drag) return;
  cardEls[order[0]].classList.remove("is-dragging");
  cardEls[order[0]].style.removeProperty("--dx");
  cardEls[order[0]].style.removeProperty("--rot");
  drag = null;
});
stack.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " " || e.key === "ArrowRight") {
    e.preventDefault();
    nextRoom(1);
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    nextRoom(-1);
  }
});

// ---------------------------------------------------------------------------
// チャット
// ---------------------------------------------------------------------------
const chat = document.getElementById("chat");
const chatName = document.getElementById("chat-name");
const chatAvatar = document.getElementById("chat-avatar");
let chatTimers = [];

function bubble(who, content, mine = false) {
  const li = document.createElement("li");
  li.className = `msg${mine ? " msg--mine" : ""}`;
  const body =
    typeof content === "string"
      ? `<p class="msg__text"></p>`
      : `<span class="msg__photo ph--${content.photo}" role="img" aria-label="photo"></span>`;
  li.innerHTML = `${mine ? "" : `<span class="avatar avatar--sm" aria-hidden="true">${who}</span>`}${body}`;
  if (typeof content === "string") li.querySelector(".msg__text").textContent = content;
  chat.appendChild(li);
  chat.scrollTop = chat.scrollHeight;
  return li;
}

function showRoom(i, { instant = false } = {}) {
  current = i;
  const r = ROOMS[i];
  chatName.textContent = r[lang].name;
  chatAvatar.textContent = r.people[0];
  chatAvatar.style.setProperty("--c", r.color);
  chatTimers.forEach(clearTimeout);
  chatTimers = [];
  chat.innerHTML = "";
  r.chat[lang].forEach(([who, content], n) => {
    if (instant || reduced.matches) bubble(who, content).classList.add("is-in");
    else chatTimers.push(setTimeout(() => bubble(who, content), 180 + n * 420));
  });
}

const composer = document.getElementById("composer");
const input = document.getElementById("composer-input");
composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  bubble("", text, true);
  const r = ROOMS[current];
  const who = r.people[Math.floor(Math.random() * r.people.length)];
  const typing = document.createElement("li");
  typing.className = "msg msg--typing";
  typing.innerHTML = `<span class="avatar avatar--sm" aria-hidden="true">${who}</span><p class="msg__text"><i></i><i></i><i></i></p>`;
  chatTimers.push(
    setTimeout(() => {
      chat.appendChild(typing);
      chat.scrollTop = chat.scrollHeight;
    }, 350),
    setTimeout(() => {
      typing.remove();
      const list = r.replies[lang];
      bubble(who, list[Math.floor(Math.random() * list.length)]);
    }, 1500)
  );
});

// ---------------------------------------------------------------------------
// ナビ・スクロール表示・ボタン
// ---------------------------------------------------------------------------
const nav = document.querySelector(".nav");
const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 24);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

const reveals = document.querySelectorAll(".reveal");
const counters = new Map();
reveals.forEach((el) => {
  const key = el.parentElement;
  const i = counters.get(key) ?? 0;
  el.style.setProperty("--i", i);
  counters.set(key, i + 1);
});
const io = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-in");
      io.unobserve(entry.target);
    }
  },
  { rootMargin: "0px 0px -8% 0px", threshold: 0.1 }
);
reveals.forEach((el) => io.observe(el));

document.querySelectorAll(".pearl-btn").forEach((btn) => {
  btn.addEventListener("pointerdown", () => btn.classList.add("is-pressed"));
  const up = () => btn.classList.remove("is-pressed");
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointerleave", up);
  btn.addEventListener("pointercancel", up);
});

// カード・機能：触ると傾き、光の当たり方が変わる
document.querySelectorAll(".feature").forEach((card) => {
  card.addEventListener("pointermove", (e) => {
    if (reduced.matches) return;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    card.style.setProperty("--ry", `${(px - 0.5) * 12}deg`);
    card.style.setProperty("--rx", `${(0.5 - py) * 12}deg`);
    card.style.setProperty("--mx", `${px * 100}%`);
    card.style.setProperty("--my", `${py * 100}%`);
  });
  card.addEventListener("pointerleave", () => {
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
  });
});

setLang(lang);

// ---------------------------------------------------------------------------
// 3D
// ---------------------------------------------------------------------------
function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const roomLabel = document.getElementById("rooms-label");
let labelTimer = 0;
// キャラクターの並び（青・ピンク・ミント・黄・紫・オレンジ）→ 部屋
const CHARA_TO_ROOM = [1, 0, 2, 3, 4, 5];
function pickRoom(i, x, y) {
  roomLabel.textContent = ROOMS[CHARA_TO_ROOM[i]][lang].name;
  roomLabel.style.left = `${x}%`;
  roomLabel.style.top = `${y}%`;
  roomLabel.classList.remove("is-in");
  void roomLabel.offsetWidth;
  roomLabel.classList.add("is-in");
  clearTimeout(labelTimer);
  labelTimer = setTimeout(() => roomLabel.classList.remove("is-in"), 1800);
}

if (hasWebGL()) {
  const fail = (err) => {
    console.error(err);
    document.documentElement.classList.add("no-webgl");
  };
  import("./hero.js").then(({ initHero }) => initHero(document.getElementById("hero-canvas"))).catch(fail);
  import("./icons.js").then(({ initIcons }) => initIcons(document.getElementById("icons-canvas"))).catch(fail);
  import("./rooms.js")
    .then(({ initRooms }) => initRooms(document.getElementById("rooms-canvas"), { onPick: pickRoom }))
    .catch(fail);
} else {
  document.documentElement.classList.add("no-webgl");
}
