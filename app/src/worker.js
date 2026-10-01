import { DurableObject } from "cloudflare:workers";
import { generateVapid, sendPush, endpointAllowed } from "./push.js";

const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const rid = (n = 12) => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));

async function pbkdf(pw, salt) {
  const k = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 1e5 }, k, 256));
}

const json = (o, status = 200, headers = {}) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

class HttpError extends Error {
  constructor(s, m) {
    super(m);
    this.status = s;
  }
}
const bad = (m = "bad_request") => new HttpError(400, m);
const pub = (u) => (u ? { id: u.id, handle: u.handle, name: u.name, color: u.color, avatar: u.avatar || null, bio: u.bio || "" } : null);
const pair = (a, b) => (a < b ? [a, b] : [b, a]);
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// 部屋のコード：読み間違えやすい文字（0/O, 1/I）を除いた8文字
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 8;
function makeCode() {
  const b = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  return [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
}
// 入力ゆれ（小文字・ハイフン・空白）を直す
function normCode(v) {
  const s = str(v, 40).toUpperCase().replace(/[\s-]/g, "");
  return new RegExp(`^[${CODE_CHARS}]{${CODE_LEN}}$`).test(s) ? s : "";
}

// ---- 見た目（部屋・スタンプ）の入力チェック ----
const HEX = /^#[0-9a-f]{6}$/i;
const cInt = (v, min, max, def) => {
  v = Number.isInteger(v) ? v : def;
  return Math.min(max, Math.max(min, v));
};
const cleanColor = (v) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : cInt(v, 0, 11, 0));
// スタンプの設計図。画像ではなく、形・色・顔・文字などの数字だけを保存する
function cleanSpec(s) {
  s = s && typeof s === "object" ? s : {};
  return {
    v: 1,
    shape: cInt(s.shape, 0, 8, 0),
    color: cleanColor(s.color),
    face: cInt(s.face, -1, 11, 0),
    text: str(typeof s.text === "string" ? s.text.replace(/[\r\n]/g, " ") : "", 12),
    font: cInt(s.font, 0, 9, 0),
    img: typeof s.img === "string" && /^[a-f0-9]{24}$/.test(s.img) ? s.img : "",
    iz: cInt(s.iz, 100, 300, 100),
    ix: cInt(s.ix, -50, 50, 0),
    iy: cInt(s.iy, -50, 50, 0),
    tcolor: typeof s.tcolor === "string" && HEX.test(s.tcolor) ? s.tcolor.toLowerCase() : "",
    tsize: cInt(s.tsize, 0, 2, 1),
    tpos: cInt(s.tpos, 0, 2, 0),
    deco: cInt(s.deco, 0, 4, 0),
    rot: cInt(s.rot, -20, 20, 0),
    ring: cInt(s.ring, 0, 1, 0),
  };
}
const STAMP_LIMIT = 100;
// 本文から @ユーザーID を取り出す
const handlesIn = (t) => [...new Set([...String(t || "").matchAll(/(?:^|[^a-z0-9_])@([a-z0-9_]{3,20})/g)].map((m) => m[1]))].slice(0, 10);
const snip = (t, fallback) => (str(t, 60) || fallback || "");
// 復旧コード（パスワードを忘れたとき用）：12文字
function makeRecovery() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  const c = [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}
const normRecovery = (v) => str(v, 40).toUpperCase().replace(/[\s-]/g, "");
const builtinStamp = (v) => typeof v === "string" && /^b:[a-z0-9]{1,12}$/.test(v);

export default {
  async fetch(req, env) {
    const stub = env.HUB.get(env.HUB.idFromName("main"));
    return stub.fetch(req);
  },
};

export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => this.init());
  }

  init() {
    const t = [
      "CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, handle TEXT UNIQUE, name TEXT, color INTEGER, avatar TEXT, pw TEXT, salt TEXT, ts INTEGER)",
      "CREATE TABLE IF NOT EXISTS sessions(tok TEXT PRIMARY KEY, uid TEXT, ts INTEGER)",
      "CREATE TABLE IF NOT EXISTS friends(a TEXT, b TEXT, status TEXT, frm TEXT, ts INTEGER, PRIMARY KEY(a,b))",
      "CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY, name TEXT, color INTEGER, owner TEXT, ts INTEGER, last INTEGER, last_text TEXT, code TEXT)",
      "CREATE TABLE IF NOT EXISTS gm(gid TEXT, uid TEXT, ts INTEGER, PRIMARY KEY(gid,uid))",
      "CREATE INDEX IF NOT EXISTS gm_uid ON gm(uid)",
      "CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY, gid TEXT, author TEXT, body TEXT, imgs TEXT, ts INTEGER, last INTEGER, ccount INTEGER DEFAULT 0)",
      "CREATE INDEX IF NOT EXISTS th_gid ON threads(gid, last)",
      "CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY, tid TEXT, author TEXT, body TEXT, imgs TEXT, ts INTEGER)",
      "CREATE INDEX IF NOT EXISTS cm_tid ON comments(tid, ts)",
      "CREATE TABLE IF NOT EXISTS images(id TEXT PRIMARY KEY, owner TEXT, mime TEXT, data BLOB, ts INTEGER)",
      "CREATE TABLE IF NOT EXISTS attempts(k TEXT PRIMARY KEY, n INTEGER, ts INTEGER)",
    ];
    for (const s of t) this.sql.exec(s);
    // 以前のデータベース（code 列なし）からの移行
    try {
      this.sql.exec("ALTER TABLE groups ADD COLUMN code TEXT");
    } catch {}
    this.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS groups_code ON groups(code)");
    for (const col of [
      "ALTER TABLE groups ADD COLUMN face INTEGER DEFAULT 0",
      "ALTER TABLE groups ADD COLUMN shape INTEGER DEFAULT 0",
      "ALTER TABLE groups ADD COLUMN descr TEXT DEFAULT ''",
      "ALTER TABLE groups ADD COLUMN ccolor TEXT",
      "ALTER TABLE groups ADD COLUMN pattern INTEGER DEFAULT 0",
      "ALTER TABLE comments ADD COLUMN stamp TEXT",
      "ALTER TABLE groups ADD COLUMN deco TEXT",
      "ALTER TABLE groups ADD COLUMN banner TEXT",
      "ALTER TABLE groups ADD COLUMN tfont INTEGER DEFAULT 0",
      "ALTER TABLE groups ADD COLUMN locked INTEGER DEFAULT 0",
      "ALTER TABLE groups ADD COLUMN animal INTEGER",
      "ALTER TABLE groups ADD COLUMN last_uid TEXT",
      "ALTER TABLE groups ADD COLUMN acolor TEXT",
      "ALTER TABLE threads ADD COLUMN edited INTEGER",
      "ALTER TABLE comments ADD COLUMN edited INTEGER",
      "ALTER TABLE users ADD COLUMN bio TEXT",
      "ALTER TABLE users ADD COLUMN hide_read INTEGER DEFAULT 0",
      "ALTER TABLE users ADD COLUMN recovery TEXT",
      "ALTER TABLE threads ADD COLUMN pinned INTEGER DEFAULT 0",
      "ALTER TABLE threads ADD COLUMN poll TEXT",
      "ALTER TABLE comments ADD COLUMN parent TEXT",
      "ALTER TABLE users ADD COLUMN push_dm INTEGER DEFAULT 1",
      "ALTER TABLE users ADD COLUMN push_other INTEGER DEFAULT 1",
    ]) {
      try {
        this.sql.exec(col);
      } catch {}
    }
    this.sql.exec("CREATE TABLE IF NOT EXISTS stamps(id TEXT PRIMARY KEY, owner TEXT, spec TEXT, ts INTEGER, del INTEGER DEFAULT 0)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS st_owner ON stamps(owner, ts)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS reactions(tgt TEXT, uid TEXT, stamp TEXT, ts INTEGER, PRIMARY KEY(tgt,uid,stamp))");
    this.sql.exec("CREATE INDEX IF NOT EXISTS rx_tgt ON reactions(tgt)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS dms(id TEXT PRIMARY KEY, pk TEXT, author TEXT, body TEXT, imgs TEXT, stamp TEXT, ts INTEGER)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS dm_pk ON dms(pk, ts)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS dm_reads(uid TEXT, peer TEXT, ts INTEGER, PRIMARY KEY(uid,peer))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS notifs(id TEXT PRIMARY KEY, uid TEXT, kind TEXT, actor TEXT, gid TEXT, tid TEXT, peer TEXT, text TEXT, ts INTEGER, rd INTEGER DEFAULT 0)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS nf_uid ON notifs(uid, ts)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS blocks(a TEXT, b TEXT, ts INTEGER, PRIMARY KEY(a,b))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, reporter TEXT, kind TEXT, tgt TEXT, gid TEXT, reason TEXT, ts INTEGER, status TEXT DEFAULT 'open')");
    this.sql.exec("CREATE TABLE IF NOT EXISTS votes(tid TEXT, uid TEXT, opt INTEGER, PRIMARY KEY(tid,uid))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv(k TEXT PRIMARY KEY, v TEXT)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS push_subs(id TEXT PRIMARY KEY, uid TEXT, endpoint TEXT UNIQUE, p256dh TEXT, auth TEXT, ts INTEGER)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS ps_uid ON push_subs(uid)");
    for (const g of this.q("SELECT id FROM groups WHERE code IS NULL")) {
      this.run("UPDATE groups SET code=? WHERE id=?", this.newCode(), g.id);
    }
  }

  q(sql, ...a) {
    return this.sql.exec(sql, ...a).toArray();
  }
  one(sql, ...a) {
    return this.q(sql, ...a)[0] || null;
  }
  run(sql, ...a) {
    this.sql.exec(sql, ...a);
  }

  newCode() {
    for (let i = 0; i < 20; i++) {
      const c = makeCode();
      if (!this.one("SELECT 1 x FROM groups WHERE code=?", c)) return c;
    }
    throw new HttpError(500, "server");
  }

  async fetch(req) {
    try {
      this.origin = new URL(req.url).origin;
      return await this.route(req, new URL(req.url));
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e && e.stack ? e.stack : e);
      return json({ error: "server" }, 500);
    }
  }

  async sessionUser(req) {
    const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)sr=([a-f0-9]{48})/);
    if (!m) return null;
    const s = this.one("SELECT uid FROM sessions WHERE tok=?", await sha(m[1]));
    return s ? this.one("SELECT id,handle,name,color,avatar,bio,hide_read FROM users WHERE id=?", s.uid) : null;
  }

  async startSession(uid) {
    const tok = rid(24);
    this.run("INSERT INTO sessions(tok,uid,ts) VALUES(?,?,?)", await sha(tok), uid, Date.now());
    return `sr=${tok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
  }

  users(ids) {
    const u = [...new Set(ids.filter(Boolean))].slice(0, 200);
    if (!u.length) return {};
    const rows = this.q(`SELECT id,handle,name,color,avatar,bio FROM users WHERE id IN (${u.map(() => "?").join(",")})`, ...u);
    const o = {};
    rows.forEach((r) => (o[r.id] = pub(r)));
    return o;
  }

  relation(a, b) {
    if (a === b) return "self";
    const [x, y] = pair(a, b);
    const r = this.one("SELECT status, frm FROM friends WHERE a=? AND b=?", x, y);
    if (!r) return "none";
    if (r.status === "accepted") return "friend";
    return r.frm === a ? "sent" : "incoming";
  }
  isFriend(a, b) {
    return this.relation(a, b) === "friend";
  }
  member(gid, uid) {
    return !!this.one("SELECT 1 x FROM gm WHERE gid=? AND uid=?", gid, uid);
  }
  needGroup(gid, uid) {
    const g = this.one("SELECT * FROM groups WHERE id=?", gid);
    if (!g || !this.member(gid, uid)) throw new HttpError(404, "not_found");
    return g;
  }
  ownImgs(list, uid) {
    if (!Array.isArray(list)) return [];
    const ids = list.filter((x) => typeof x === "string" && /^[a-f0-9]{24}$/.test(x)).slice(0, 4);
    return ids.filter((id) => this.one("SELECT 1 x FROM images WHERE id=? AND owner=?", id, uid));
  }
  async body(req) {
    try {
      return await req.json();
    } catch {
      throw bad("json");
    }
  }

  // プッシュ通知用の鍵（最初に1回だけつくって、保存しておく）
  async getVapid() {
    if (this._vapid) return this._vapid;
    const row = this.one("SELECT v FROM kv WHERE k='vapid'");
    if (row) this._vapid = JSON.parse(row.v);
    else {
      this._vapid = await generateVapid();
      this.run("INSERT INTO kv(k,v) VALUES('vapid',?)", JSON.stringify(this._vapid));
    }
    return this._vapid;
  }
  pushSubject() {
    return this.origin && this.origin.startsWith("https://") ? this.origin : "mailto:dara@example.com";
  }
  // 端末に通知を送る（cat: 'dm' か 'other'。相手が切っていたら送らない）
  pushTo(uid, cat, payload) {
    try {
      const pref = this.one("SELECT push_dm, push_other FROM users WHERE id=?", uid);
      if (!pref || (cat === "dm" ? pref.push_dm === 0 : pref.push_other === 0)) return;
      const subs = this.q("SELECT * FROM push_subs WHERE uid=?", uid);
      if (!subs.length) return;
      this.ctx.waitUntil(this.deliver(subs, payload, cat === "dm"));
    } catch (e) {
      console.error("push", String(e));
    }
  }
  async deliver(subs, payload, urgent) {
    const vapid = await this.getVapid();
    const body = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (sub) => {
        try {
          const code = await sendPush(sub, body, vapid, this.pushSubject(), { urgency: urgent ? "high" : "normal" });
          if (code === 404 || code === 410) this.run("DELETE FROM push_subs WHERE id=?", sub.id);
          else if (code >= 400) console.error("push status", code);
        } catch (e) {
          console.error("push fail", String(e));
        }
      })
    );
  }

  isAdmin(u) {
    const list = String((this.env && this.env.ADMIN_HANDLES) || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    return !!u && list.includes(u.handle);
  }
  selfOut(u) {
    return u ? { ...pub(u), hideRead: !!u.hide_read, admin: this.isAdmin(u) } : null;
  }
  // どちらかがブロックしているか
  blockedPair(a, b) {
    return !!this.one("SELECT 1 x FROM blocks WHERE (a=? AND b=?) OR (a=? AND b=?)", a, b, b, a);
  }
  blockedByMe(me, other) {
    return !!this.one("SELECT 1 x FROM blocks WHERE a=? AND b=?", me, other);
  }
  myBlocks(me) {
    return new Set(this.q("SELECT b FROM blocks WHERE a=?", me).map((r) => r.b));
  }
  // 通知をつくる（自分自身・ブロック関係の相手には送らない）
  notify(uid, kind, actor, o = {}) {
    if (!uid || uid === actor) return;
    if (actor && this.blockedPair(uid, actor)) return;
    this.run("INSERT INTO notifs(id,uid,kind,actor,gid,tid,peer,text,ts) VALUES(?,?,?,?,?,?,?,?,?)", rid(10), uid, kind, actor || "", o.gid || null, o.tid || null, o.peer || null, o.text || "", Date.now());
    this.run("DELETE FROM notifs WHERE uid=? AND id NOT IN (SELECT id FROM notifs WHERE uid=? ORDER BY ts DESC LIMIT 200)", uid, uid);
    // スマホへのプッシュ通知
    const name = actor ? this.one("SELECT name FROM users WHERE id=?", actor)?.name || "" : "";
    const room = o.gid ? this.one("SELECT name FROM groups WHERE id=?", o.gid)?.name : "";
    const what = { comment: "がコメントしました", reply: "が返信しました", mention: "があなたを呼びました", react: "がスタンプを押しました", friend_req: "から友達申請が届きました", friend_ok: "と友達になりました", report: "通報がありました" }[kind] || "";
    const url = o.tid ? `/#/t/${o.tid}` : kind === "mention" && o.peer ? `/#/dm/${o.peer}` : kind === "friend_req" || kind === "friend_ok" ? "/#/friends" : "/";
    this.pushTo(uid, "other", { t: room || "DARA", b: `${name}${what}${o.text && kind !== "report" ? "\n" + o.text : ""}`, u: url, g: `${kind}:${o.tid || actor}` });
  }
  // @ で呼ばれた人（部屋のメンバーだけ / DMは相手だけ）
  mentioned(text, { gid, peer }) {
    const hs = handlesIn(text);
    if (!hs.length) return [];
    const rows = this.q(`SELECT id FROM users WHERE handle IN (${hs.map(() => "?").join(",")})`, ...hs).map((r) => r.id);
    if (gid) return rows.filter((id) => this.member(gid, id));
    if (peer) return rows.filter((id) => id === peer);
    return [];
  }
  pollOut(t, meId) {
    if (!t.poll) return null;
    let options = [];
    try {
      options = JSON.parse(t.poll);
    } catch {}
    const counts = options.map(() => 0);
    for (const r of this.q("SELECT opt, COUNT(*) n FROM votes WHERE tid=? GROUP BY opt", t.id)) if (r.opt >= 0 && r.opt < counts.length) counts[r.opt] = r.n;
    const mine = this.one("SELECT opt FROM votes WHERE tid=? AND uid=?", t.id, meId);
    return { options, counts, total: counts.reduce((x, y) => x + y, 0), mine: mine ? mine.opt : null };
  }

  groupStyle(g) {
    let decos = [];
    try {
      decos = JSON.parse(g.deco || "[]");
    } catch {}
    return {
      face: g.face || 0, shape: g.shape || 0, ccolor: g.ccolor || null, pattern: g.pattern || 0, desc: g.descr || "",
      decos, banner: g.banner || null, tfont: g.tfont || 0, animal: g.animal === null || g.animal === undefined ? null : g.animal, acolor: g.acolor || null, owner: g.owner, locked: !!g.locked,
    };
  }

  // 部屋のデコに使われているスタンプの設計図
  decoStamps(groups) {
    return this.stampMap(groups.flatMap((g) => this.groupStyle(g).decos));
  }

  // 写真は自分がアップロードしたものだけ使える（ほかの人のスタンプのコピーは除く）
  stampSpec(uid, raw, trusted = false) {
    const spec = cleanSpec(raw);
    if (spec.img && !trusted && !this.one("SELECT 1 x FROM images WHERE id=? AND owner=?", spec.img, uid)) spec.img = "";
    return spec;
  }

  deleteGroup(gid) {
    this.run("DELETE FROM reactions WHERE tgt IN (SELECT id FROM comments WHERE tid IN (SELECT id FROM threads WHERE gid=?)) OR tgt IN (SELECT id FROM threads WHERE gid=?)", gid, gid);
    this.run("DELETE FROM comments WHERE tid IN (SELECT id FROM threads WHERE gid=?)", gid);
    this.run("DELETE FROM threads WHERE gid=?", gid);
    this.run("DELETE FROM gm WHERE gid=?", gid);
    this.run("DELETE FROM groups WHERE id=?", gid);
  }

  // 見た目を変えられるか（ロック中はオーナーだけ）
  canStyle(g, uid) {
    return !g.locked || g.owner === uid;
  }

  stampOk(id) {
    if (builtinStamp(id)) return true;
    return typeof id === "string" && /^[a-f0-9]{20}$/.test(id) && !!this.one("SELECT 1 x FROM stamps WHERE id=?", id);
  }

  // 投稿・コメントごとのリアクション [{s, n, me, u}]
  reactsFor(tgts, meId) {
    const out = {};
    const ids = [...new Set(tgts)].slice(0, 600);
    if (!ids.length) return out;
    const rows = this.q(
      `SELECT tgt, stamp, COUNT(*) n, MAX(uid=?) me, group_concat(uid) u FROM reactions WHERE tgt IN (${ids.map(() => "?").join(",")}) GROUP BY tgt, stamp ORDER BY MIN(ts)`,
      meId, ...ids
    );
    for (const r of rows) (out[r.tgt] ||= []).push({ s: r.stamp, n: r.n, me: !!r.me, u: String(r.u || "").split(",").slice(0, 8) });
    return out;
  }

  // 使われている自作スタンプの設計図
  stampMap(ids) {
    const u = [...new Set(ids.filter((x) => x && !builtinStamp(x)))].slice(0, 300);
    const o = {};
    if (!u.length) return o;
    for (const r of this.q(`SELECT id, spec FROM stamps WHERE id IN (${u.map(() => "?").join(",")})`, ...u)) {
      try {
        o[r.id] = JSON.parse(r.spec);
      } catch {}
    }
    return o;
  }

  createGroup(name, ownerId, memberIds) {
    const id = rid(10);
    const now = Date.now();
    const code = this.newCode();
    this.run(
      "INSERT INTO groups(id,name,color,owner,ts,last,last_text,code,face,shape) VALUES(?,?,?,?,?,?,?,?,?,?)",
      id, name, Math.floor(Math.random() * 12), ownerId, now, now, "", code, Math.floor(Math.random() * 4), Math.floor(Math.random() * 8)
    );
    [ownerId, ...new Set(memberIds)].forEach((u) => this.run("INSERT OR IGNORE INTO gm(gid,uid,ts) VALUES(?,?,?)", id, u, now));
    return { id, code };
  }

  async route(req, url) {
    const path = url.pathname;
    const M = req.method;
    if (M !== "GET" && req.headers.get("x-sr") !== "1") throw new HttpError(403, "csrf");
    if (path === "/api/signup" && M === "POST") return this.signup(req);
    if (path === "/api/login" && M === "POST") return this.login(req);
    if (path === "/api/reset" && M === "POST") return this.resetPassword(req);
    const me = await this.sessionUser(req);
    if (path === "/api/me" && M === "GET") return json({ me: this.selfOut(me) });
    if (!me) throw new HttpError(401, "auth");
    let m;

    if (path === "/api/logout" && M === "POST") {
      const c = (req.headers.get("cookie") || "").match(/sr=([a-f0-9]{48})/);
      if (c) this.run("DELETE FROM sessions WHERE tok=?", await sha(c[1]));
      return json({ ok: true }, 200, { "set-cookie": "sr=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
    }

    if (path === "/api/me" && M === "POST") {
      const b = await this.body(req);
      if (b.name !== undefined) {
        const n = str(b.name, 20);
        if (!n) throw bad("name");
        this.run("UPDATE users SET name=? WHERE id=?", n, me.id);
      }
      if (b.avatar !== undefined) {
        const a = b.avatar === null ? null : this.ownImgs([b.avatar], me.id)[0] || null;
        this.run("UPDATE users SET avatar=? WHERE id=?", a, me.id);
      }
      if (b.bio !== undefined) this.run("UPDATE users SET bio=? WHERE id=?", str(typeof b.bio === "string" ? b.bio.replace(/[\r\n]+/g, " ") : "", 80), me.id);
      if (b.hideRead !== undefined) this.run("UPDATE users SET hide_read=? WHERE id=?", b.hideRead ? 1 : 0, me.id);
      return json({ me: this.selfOut(this.one("SELECT id,handle,name,color,avatar,bio,hide_read FROM users WHERE id=?", me.id)) });
    }

    // ---- パスワード ----
    if (path === "/api/password" && M === "POST") {
      const b = await this.body(req);
      const key = "p:" + me.id;
      const n = this.throttle(key);
      const u = this.one("SELECT * FROM users WHERE id=?", me.id);
      if ((await pbkdf(String(b.old || ""), u.salt)) !== u.pw) {
        this.fail(key, n);
        throw new HttpError(401, "login");
      }
      const pw = typeof b.pw === "string" ? b.pw : "";
      if (pw.length < 8 || pw.length > 200) throw bad("password");
      const salt = rid(8);
      this.run("UPDATE users SET pw=?, salt=? WHERE id=?", await pbkdf(pw, salt), salt, me.id);
      const cur = (req.headers.get("cookie") || "").match(/sr=([a-f0-9]{48})/);
      this.run("DELETE FROM sessions WHERE uid=? AND tok!=?", me.id, cur ? await sha(cur[1]) : "");
      return json({ ok: true });
    }
    if (path === "/api/recovery" && M === "POST") {
      // 復旧コードをつくり直す（パスワードの確認つき）
      const b = await this.body(req);
      const key = "p:" + me.id;
      const n = this.throttle(key);
      const u = this.one("SELECT * FROM users WHERE id=?", me.id);
      if ((await pbkdf(String(b.pw || ""), u.salt)) !== u.pw) {
        this.fail(key, n);
        throw new HttpError(401, "login");
      }
      const code = makeRecovery();
      this.run("UPDATE users SET recovery=? WHERE id=?", await sha("rc:" + normRecovery(code)), me.id);
      return json({ recovery: code });
    }

    if (path === "/api/images" && M === "POST") {
      const mime = (req.headers.get("content-type") || "").split(";")[0];
      if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) throw bad("type");
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > 1.9e6) throw new HttpError(413, "too_large");
      const id = rid(12);
      this.run("INSERT INTO images(id,owner,mime,data,ts) VALUES(?,?,?,?,?)", id, me.id, mime, buf, Date.now());
      return json({ id });
    }
    if ((m = path.match(/^\/api\/images\/([a-f0-9]{24})$/)) && M === "GET") {
      const r = this.one("SELECT mime,data FROM images WHERE id=?", m[1]);
      if (!r) throw new HttpError(404, "not_found");
      return new Response(r.data, {
        headers: { "content-type": r.mime, "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
      });
    }

    // ---- 友達 ----
    if (path === "/api/search" && M === "GET") {
      const q = str(url.searchParams.get("q") || "", 30).replace(/[\\%_]/g, "").replace(/^@/, "");
      if (q.length < 2) return json({ users: [] });
      const rows = this.q(
        "SELECT id,handle,name,color,avatar,bio FROM users WHERE id!=? AND (handle LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY handle LIMIT 12",
        me.id, q.toLowerCase() + "%", "%" + q + "%"
      );
      return json({ users: rows.filter((u) => !this.blockedPair(me.id, u.id)).map(pub) });
    }
    // 友達追加リンク / QR から開いたときの相手の確認用
    if ((m = path.match(/^\/api\/u\/([a-z0-9_]{3,20})$/)) && M === "GET") {
      const u = this.one("SELECT id,handle,name,color,avatar,bio FROM users WHERE handle=?", m[1]);
      if (!u || this.blockedPair(me.id, u.id)) throw new HttpError(404, "not_found");
      return json({ user: pub(u), rel: this.relation(me.id, u.id), blocked: this.blockedByMe(me.id, u.id) });
    }
    if (path === "/api/friends" && M === "GET") {
      const rows = this.q("SELECT * FROM friends WHERE a=? OR b=?", me.id, me.id);
      const us = this.users(rows.map((r) => (r.a === me.id ? r.b : r.a)));
      const out = { friends: [], incoming: [], sent: [] };
      rows.forEach((r) => {
        const o = us[r.a === me.id ? r.b : r.a];
        if (!o) return;
        if (r.status === "accepted") out.friends.push(o);
        else if (r.frm === me.id) out.sent.push(o);
        else out.incoming.push(o);
      });
      return json(out);
    }
    if (path === "/api/friends/request" && M === "POST") {
      const b = await this.body(req);
      const target = b.handle
        ? this.one("SELECT id FROM users WHERE handle=?", str(b.handle, 20).toLowerCase().replace(/^@/, ""))
        : this.one("SELECT id FROM users WHERE id=?", str(b.id, 40));
      if (!target || target.id === me.id || this.blockedPair(me.id, target.id)) throw bad("user");
      this.rate("f:" + me.id, 60, 36e5);
      const [x, y] = pair(me.id, target.id);
      const r = this.one("SELECT * FROM friends WHERE a=? AND b=?", x, y);
      if (!r) {
        this.run("INSERT INTO friends(a,b,status,frm,ts) VALUES(?,?,?,?,?)", x, y, "pending", me.id, Date.now());
        this.notify(target.id, "friend_req", me.id);
      } else if (r.status === "pending" && r.frm !== me.id) {
        this.run("UPDATE friends SET status='accepted', ts=? WHERE a=? AND b=?", Date.now(), x, y);
        this.notify(target.id, "friend_ok", me.id);
      }
      return json({ ok: true, rel: this.relation(me.id, target.id) });
    }
    if (path === "/api/friends/accept" && M === "POST") {
      const b = await this.body(req);
      const [x, y] = pair(me.id, str(b.id, 40));
      const pend = this.one("SELECT frm FROM friends WHERE a=? AND b=? AND status='pending' AND frm!=?", x, y, me.id);
      this.run("UPDATE friends SET status='accepted', ts=? WHERE a=? AND b=? AND status='pending' AND frm!=?", Date.now(), x, y, me.id);
      if (pend) this.notify(pend.frm, "friend_ok", me.id);
      return json({ ok: true });
    }
    if (path === "/api/friends/remove" && M === "POST") {
      const b = await this.body(req);
      const [x, y] = pair(me.id, str(b.id, 40));
      this.run("DELETE FROM friends WHERE a=? AND b=?", x, y);
      return json({ ok: true });
    }

    // ---- 部屋 ----
    if (path === "/api/groups" && M === "GET") {
      const gs = this.q("SELECT g.* FROM groups g JOIN gm ON gm.gid=g.id WHERE gm.uid=? ORDER BY g.last DESC", me.id);
      let ids = [];
      const groups = gs.map((g) => {
        const mem = this.q("SELECT uid FROM gm WHERE gid=? ORDER BY ts", g.id).map((r) => r.uid);
        ids = ids.concat(mem.slice(0, 8), g.last_uid ? [g.last_uid] : []);
        return { id: g.id, name: g.name, color: g.color, ...this.groupStyle(g), last: g.last, lastText: g.last_text, lastUid: g.last_uid || null, members: mem };
      });
      return json({ groups, users: this.users(ids), stamps: this.decoStamps(gs) });
    }
    if (path === "/api/groups" && M === "POST") {
      const b = await this.body(req);
      const name = str(b.name, 30);
      if (!name) throw bad("name");
      this.rate("g:" + me.id, 30, 36e5);
      const mem = (Array.isArray(b.members) ? b.members : []).filter((x) => typeof x === "string" && this.isFriend(me.id, x)).slice(0, 50);
      return json(this.createGroup(name, me.id, mem));
    }
    // コードで部屋に入る：先に中身を確認する
    if ((m = path.match(/^\/api\/join\/([A-Za-z0-9-]{4,20})$/)) && M === "GET") {
      const code = normCode(m[1]);
      this.rate("j:" + me.id, 30, 6e5);
      const g = code && this.one("SELECT * FROM groups WHERE code=?", code);
      if (!g) throw new HttpError(404, "no_room");
      const n = this.one("SELECT COUNT(*) c FROM gm WHERE gid=?", g.id).c;
      return json({ group: { id: g.id, name: g.name, color: g.color, ...this.groupStyle(g), count: n }, already: this.member(g.id, me.id), stamps: this.decoStamps([g]) });
    }
    if (path === "/api/groups/join" && M === "POST") {
      const b = await this.body(req);
      const code = normCode(b.code);
      this.rate("j:" + me.id, 30, 6e5);
      const g = code && this.one("SELECT id FROM groups WHERE code=?", code);
      if (!g) throw new HttpError(404, "no_room");
      this.run("INSERT OR IGNORE INTO gm(gid,uid,ts) VALUES(?,?,?)", g.id, me.id, Date.now());
      return json({ id: g.id });
    }
    if ((m = path.match(/^\/api\/groups\/([a-f0-9]{20})$/)) && M === "GET") {
      const g = this.needGroup(m[1], me.id);
      const mem = this.q("SELECT uid FROM gm WHERE gid=? ORDER BY ts", g.id).map((r) => r.uid);
      return json({ group: { id: g.id, name: g.name, color: g.color, ...this.groupStyle(g), code: g.code, members: mem }, users: this.users(mem), stamps: this.decoStamps([g]) });
    }
    if ((m = path.match(/^\/api\/groups\/([a-f0-9]{20})\/code$/)) && M === "POST") {
      // 漏れたときのために作り直せる（古いコードは使えなくなる）。ロック中はオーナーだけ
      const g = this.needGroup(m[1], me.id);
      if (!this.canStyle(g, me.id)) throw new HttpError(403, "locked");
      const code = this.newCode();
      this.run("UPDATE groups SET code=? WHERE id=?", code, g.id);
      return json({ code });
    }
    if ((m = path.match(/^\/api\/groups\/([a-f0-9]{20})\/style$/)) && M === "POST") {
      // 部屋の見た目は、メンバーなら誰でも変えられる（オーナーがロックしたときは除く）
      const g = this.needGroup(m[1], me.id);
      if (!this.canStyle(g, me.id)) throw new HttpError(403, "locked");
      const b = await this.body(req);
      this.rate("st:" + me.id, 60, 36e5);
      const set = [];
      const val = [];
      const put = (col, v) => {
        set.push(col + "=?");
        val.push(v);
      };
      if (b.name !== undefined) {
        const n = str(b.name, 30);
        if (!n) throw bad("name");
        put("name", n);
      }
      if (b.color !== undefined) put("color", cInt(b.color, 0, 11, 0));
      if (b.ccolor !== undefined) put("ccolor", b.ccolor === null ? null : HEX.test(String(b.ccolor)) ? String(b.ccolor).toLowerCase() : null);
      if (b.face !== undefined) put("face", cInt(b.face, 0, 11, 0));
      if (b.shape !== undefined) put("shape", cInt(b.shape, 0, 7, 0));
      if (b.animal !== undefined) put("animal", b.animal === null ? null : cInt(b.animal, 0, 15, 0));
      if (b.acolor !== undefined) put("acolor", b.acolor === null ? null : HEX.test(String(b.acolor)) ? String(b.acolor).toLowerCase() : null);
      if (b.pattern !== undefined) put("pattern", cInt(b.pattern, 0, 4, 0));
      if (b.tfont !== undefined) put("tfont", cInt(b.tfont, 0, 9, 0));
      if (b.banner !== undefined) put("banner", b.banner === null ? null : this.ownImgs([b.banner], me.id)[0] || null);
      if (b.decos !== undefined) {
        const list = (Array.isArray(b.decos) ? b.decos : []).filter((x) => this.stampOk(x)).slice(0, 4);
        put("deco", JSON.stringify(list));
      }
      if (b.desc !== undefined) put("descr", str(typeof b.desc === "string" ? b.desc.replace(/[\r\n]/g, " ") : "", 60));
      if (set.length) this.run(`UPDATE groups SET ${set.join(",")} WHERE id=?`, ...val, g.id);
      return json({ ok: true });
    }
    // ---- 部屋の管理（オーナーだけ） ----
    if ((m = path.match(/^\/api\/groups\/([a-f0-9]{20})$/)) && M === "DELETE") {
      const g = this.needGroup(m[1], me.id);
      if (g.owner !== me.id) throw new HttpError(403, "owner_only");
      this.deleteGroup(g.id);
      return json({ ok: true });
    }
    if ((m = path.match(/^\/api\/groups\/([a-f0-9]{20})\/(kick|owner)$/)) && M === "POST") {
      const g = this.needGroup(m[1], me.id);
      if (g.owner !== me.id) throw new HttpError(403, "owner_only");
      const b = await this.body(req);
      const uid = str(b.uid, 40);
      if (!uid || uid === me.id || !this.member(g.id, uid)) throw bad("user");
      if (m[2] === "kick") this.run("DELETE FROM gm WHERE gid=? AND uid=?", g.id, uid);
      else this.run("UPDATE groups SET owner=? WHERE id=?", uid, g.id);
      return json({ ok: true });
    }
    if ((m = path.match(/^\/api\/groups\/([a-f0-9]{20})\/lock$/)) && M === "POST") {
      const g = this.needGroup(m[1], me.id);
      if (g.owner !== me.id) throw new HttpError(403, "owner_only");
      const b = await this.body(req);
      this.run("UPDATE groups SET locked=? WHERE id=?", b.locked ? 1 : 0, g.id);
      return json({ ok: true });
    }
    if ((m = path.match(/^\/api\/groups\/([a-f0-9]{20})\/members$/)) && M === "POST") {
      const g = this.needGroup(m[1], me.id);
      const b = await this.body(req);
      (Array.isArray(b.ids) ? b.ids : []).slice(0, 50).forEach((u) => {
        if (typeof u === "string" && this.isFriend(me.id, u)) this.run("INSERT OR IGNORE INTO gm(gid,uid,ts) VALUES(?,?,?)", g.id, u, Date.now());
      });
      return json({ ok: true });
    }
    if ((m = path.match(/^\/api\/groups\/([a-f0-9]{20})\/leave$/)) && M === "POST") {
      const g = this.needGroup(m[1], me.id);
      this.run("DELETE FROM gm WHERE gid=? AND uid=?", g.id, me.id);
      const next = this.one("SELECT uid FROM gm WHERE gid=? ORDER BY ts LIMIT 1", g.id);
      if (!next) this.deleteGroup(g.id);
      else if (g.owner === me.id) this.run("UPDATE groups SET owner=? WHERE id=?", next.uid, g.id);
      return json({ ok: true });
    }

    if ((m = path.match(/^\/api\/groups\/([a-f0-9]{20})\/threads$/))) {
      const g = this.needGroup(m[1], me.id);
      if (M === "GET") {
        const blocked = this.myBlocks(me.id);
        const rows = this.q("SELECT * FROM threads WHERE gid=? ORDER BY pinned DESC, last DESC LIMIT 100", g.id).filter((t) => !blocked.has(t.author));
        const rx = this.reactsFor(rows.map((t) => t.id), me.id);
        const threads = rows.map((t) => ({
          id: t.id, author: t.author, text: t.body, images: JSON.parse(t.imgs || "[]"), ts: t.ts, edited: t.edited || null, last: t.last, count: t.ccount,
          pinned: !!t.pinned, poll: this.pollOut(t, me.id), reacts: rx[t.id] || [],
        }));
        return json({ threads, users: this.users([...threads.map((t) => t.author), ...Object.values(rx).flat().flatMap((r) => r.u)]), stamps: this.stampMap(Object.values(rx).flat().map((r) => r.s)) });
      }
      if (M === "POST") {
        const b = await this.body(req);
        const text = str(b.text, 2e4);
        const imgs = this.ownImgs(b.images, me.id);
        // アンケート（選択肢は2〜6個）
        let poll = null;
        if (Array.isArray(b.poll)) {
          const opts = b.poll.map((x) => str(x, 30)).filter(Boolean).slice(0, 6);
          if (opts.length >= 2) poll = JSON.stringify(opts);
        }
        if (!text && !imgs.length && !poll) throw bad("empty");
        const id = rid(10);
        const now = Date.now();
        this.run("INSERT INTO threads(id,gid,author,body,imgs,ts,last,ccount,poll) VALUES(?,?,?,?,?,?,?,0,?)", id, g.id, me.id, text, JSON.stringify(imgs), now, now, poll);
        this.run("UPDATE groups SET last=?, last_text=?, last_uid=? WHERE id=?", now, (text || (poll ? "アンケート" : "写真")).slice(0, 60), me.id, g.id);
        for (const uid of this.mentioned(text, { gid: g.id })) this.notify(uid, "mention", me.id, { gid: g.id, tid: id, text: snip(text) });
        return json({ id });
      }
    }

    if ((m = path.match(/^\/api\/threads\/([a-f0-9]{20})$/))) {
      const t = this.one("SELECT * FROM threads WHERE id=?", m[1]);
      if (!t || !this.member(t.gid, me.id)) throw new HttpError(404, "not_found");
      if (M === "GET") {
        const blocked = this.myBlocks(me.id);
        const rows = this.q("SELECT * FROM comments WHERE tid=? ORDER BY ts LIMIT 500", t.id).filter((c) => !blocked.has(c.author));
        const rx = this.reactsFor([t.id, ...rows.map((c) => c.id)], me.id);
        const cs = rows.map((c) => ({
          id: c.id, author: c.author, text: c.body, images: JSON.parse(c.imgs || "[]"), stamp: c.stamp || null, parent: c.parent || null, ts: c.ts, edited: c.edited || null, reacts: rx[c.id] || [],
        }));
        const g = this.one("SELECT name,color,owner FROM groups WHERE id=?", t.gid);
        return json({
          stamps: this.stampMap([...Object.values(rx).flat().map((r) => r.s), ...cs.map((c) => c.stamp)]),
          thread: { id: t.id, gid: t.gid, author: t.author, text: t.body, images: JSON.parse(t.imgs || "[]"), ts: t.ts, edited: t.edited || null, count: t.ccount, pinned: !!t.pinned, poll: this.pollOut(t, me.id), reacts: rx[t.id] || [] },
          group: { id: t.gid, name: g.name, color: g.color, owner: g.owner, members: this.q("SELECT uid FROM gm WHERE gid=?", t.gid).map((r) => r.uid) },
          comments: cs,
          users: this.users([t.author, ...cs.map((c) => c.author), ...this.q("SELECT uid FROM gm WHERE gid=?", t.gid).map((r) => r.uid), ...Object.values(rx).flat().flatMap((r) => r.u)]),
        });
      }
      if (M === "PATCH") {
        if (t.author !== me.id) throw new HttpError(403, "forbidden");
        const b = await this.body(req);
        const text = str(b.text, 2e4);
        if (!text && !JSON.parse(t.imgs || "[]").length) throw bad("empty");
        this.run("UPDATE threads SET body=?, edited=? WHERE id=?", text, Date.now(), t.id);
        return json({ ok: true });
      }
      if (M === "DELETE") {
        // 自分の投稿と、自分が作った部屋の投稿は消せる
        if (t.author !== me.id && this.one("SELECT owner FROM groups WHERE id=?", t.gid)?.owner !== me.id) throw new HttpError(403, "forbidden");
        this.run("DELETE FROM reactions WHERE tgt IN (SELECT id FROM comments WHERE tid=?) OR tgt=?", t.id, t.id);
        this.run("DELETE FROM votes WHERE tid=?", t.id);
        this.run("DELETE FROM comments WHERE tid=?", t.id);
        this.run("DELETE FROM threads WHERE id=?", t.id);
        return json({ ok: true });
      }
    }

    if ((m = path.match(/^\/api\/threads\/([a-f0-9]{20})\/comments$/)) && M === "POST") {
      const t = this.one("SELECT * FROM threads WHERE id=?", m[1]);
      if (!t || !this.member(t.gid, me.id)) throw new HttpError(404, "not_found");
      const b = await this.body(req);
      const text = str(b.text, 2e4);
      const imgs = this.ownImgs(b.images, me.id);
      const stamp = b.stamp ? String(b.stamp) : null;
      if (stamp && !this.stampOk(stamp)) throw bad("stamp");
      if (!text && !imgs.length && !stamp) throw bad("empty");
      // 返信先（1段だけ入れ子にする）
      let parent = null;
      let parentAuthor = null;
      if (b.parent) {
        const pc = this.one("SELECT id, parent, author FROM comments WHERE id=? AND tid=?", String(b.parent), t.id);
        if (pc) {
          parent = pc.parent || pc.id;
          parentAuthor = pc.author;
        }
      }
      const id = rid(10);
      const now = Date.now();
      this.run("INSERT INTO comments(id,tid,author,body,imgs,ts,stamp,parent) VALUES(?,?,?,?,?,?,?,?)", id, t.id, me.id, text, JSON.stringify(imgs), now, stamp, parent);
      // 通知：メンション > 返信 > コメント の順に、同じ人には1つだけ
      const told = new Set([me.id]);
      const tell = (uid, kind) => {
        if (!uid || told.has(uid)) return;
        told.add(uid);
        this.notify(uid, kind, me.id, { gid: t.gid, tid: t.id, text: snip(text, stamp ? "スタンプ" : "写真") });
      };
      for (const uid of this.mentioned(text, { gid: t.gid })) tell(uid, "mention");
      tell(parentAuthor, "reply");
      tell(t.author, "comment");
      this.run("UPDATE threads SET ccount=ccount+1, last=? WHERE id=?", now, t.id);
      this.run("UPDATE groups SET last=?, last_text=?, last_uid=? WHERE id=?", now, (text || (stamp && !imgs.length ? "スタンプ" : "写真")).slice(0, 60), me.id, t.gid);
      return json({ id });
    }
    if ((m = path.match(/^\/api\/comments\/([a-f0-9]{20})$/)) && (M === "DELETE" || M === "PATCH")) {
      const c = this.one("SELECT * FROM comments WHERE id=?", m[1]);
      const ct = c && this.one("SELECT t.gid gid, g.owner owner FROM threads t JOIN groups g ON g.id=t.gid WHERE t.id=?", c.tid);
      if (!c || !ct || !this.member(ct.gid, me.id)) throw new HttpError(404, "not_found");
      if (M === "PATCH") {
        if (c.author !== me.id) throw new HttpError(403, "forbidden");
        const b = await this.body(req);
        const text = str(b.text, 2e4);
        if (!text && !JSON.parse(c.imgs || "[]").length && !c.stamp) throw bad("empty");
        this.run("UPDATE comments SET body=?, edited=? WHERE id=?", text, Date.now(), c.id);
        return json({ ok: true });
      }
      if (c.author !== me.id && ct.owner !== me.id) throw new HttpError(403, "forbidden");
      this.run("UPDATE comments SET parent=NULL WHERE parent=?", c.id);
      this.run("DELETE FROM comments WHERE id=?", c.id);
      this.run("DELETE FROM reactions WHERE tgt=?", c.id);
      this.run("UPDATE threads SET ccount=MAX(0,ccount-1) WHERE id=?", c.tid);
      return json({ ok: true });
    }

    // ---- プッシュ通知 ----
    if (path === "/api/push/key" && M === "GET") {
      const v = await this.getVapid();
      const pref = this.one("SELECT push_dm, push_other FROM users WHERE id=?", me.id);
      return json({ key: v.publicKey, dm: pref.push_dm !== 0, other: pref.push_other !== 0, devices: this.one("SELECT COUNT(*) c FROM push_subs WHERE uid=?", me.id).c });
    }
    if (path === "/api/push/subscribe" && M === "POST") {
      const b = await this.body(req);
      const local = /^(127\.0\.0\.1|localhost)$/.test(new URL(req.url).hostname);
      const endpoint = str(b.endpoint, 1000);
      const p256dh = str(b.keys?.p256dh, 200);
      const auth = str(b.keys?.auth, 100);
      if (!endpointAllowed(endpoint, local) || !p256dh || !auth) throw bad("push");
      this.rate("ps:" + me.id, 30, 36e5);
      // 同じ端末で別の人がログインしたときは、最後にログインした人のものにする
      this.run("DELETE FROM push_subs WHERE endpoint=?", endpoint);
      this.run("INSERT INTO push_subs(id,uid,endpoint,p256dh,auth,ts) VALUES(?,?,?,?,?,?)", rid(10), me.id, endpoint, p256dh, auth, Date.now());
      this.run("DELETE FROM push_subs WHERE uid=? AND id NOT IN (SELECT id FROM push_subs WHERE uid=? ORDER BY ts DESC LIMIT 8)", me.id, me.id);
      return json({ ok: true });
    }
    if (path === "/api/push/unsubscribe" && M === "POST") {
      const b = await this.body(req);
      this.run("DELETE FROM push_subs WHERE uid=? AND endpoint=?", me.id, str(b.endpoint, 1000));
      return json({ ok: true });
    }
    if (path === "/api/push/settings" && M === "POST") {
      const b = await this.body(req);
      if (b.dm !== undefined) this.run("UPDATE users SET push_dm=? WHERE id=?", b.dm ? 1 : 0, me.id);
      if (b.other !== undefined) this.run("UPDATE users SET push_other=? WHERE id=?", b.other ? 1 : 0, me.id);
      return json({ ok: true });
    }
    if (path === "/api/push/test" && M === "POST") {
      this.rate("pt:" + me.id, 10, 36e5);
      const subs = this.q("SELECT * FROM push_subs WHERE uid=?", me.id);
      if (!subs.length) throw bad("no_device");
      this.ctx.waitUntil(this.deliver(subs, { t: "DARA", b: "テスト通知です 届いていれば、ばっちりです", u: "/#/", g: "test" }, false));
      return json({ sent: subs.length });
    }

    // ---- ピン留め・アンケート ----
    if ((m = path.match(/^\/api\/threads\/([a-f0-9]{20})\/(pin|vote)$/)) && M === "POST") {
      const t = this.one("SELECT * FROM threads WHERE id=?", m[1]);
      if (!t || !this.member(t.gid, me.id)) throw new HttpError(404, "not_found");
      const b = await this.body(req);
      if (m[2] === "pin") {
        const owner = this.one("SELECT owner FROM groups WHERE id=?", t.gid)?.owner;
        if (t.author !== me.id && owner !== me.id) throw new HttpError(403, "forbidden");
        if (b.pinned) {
          if (this.one("SELECT COUNT(*) c FROM threads WHERE gid=? AND pinned>0 AND id!=?", t.gid, t.id).c >= 3) throw new HttpError(400, "pin_limit");
          this.run("UPDATE threads SET pinned=? WHERE id=?", Date.now(), t.id);
        } else this.run("UPDATE threads SET pinned=0 WHERE id=?", t.id);
        return json({ ok: true });
      }
      const poll = this.pollOut(t, me.id);
      if (!poll) throw bad("no_poll");
      const opt = Number.isInteger(b.opt) ? b.opt : -1;
      if (opt < 0 || opt >= poll.options.length) throw bad("opt");
      if (poll.mine === opt) this.run("DELETE FROM votes WHERE tid=? AND uid=?", t.id, me.id);
      else this.run("INSERT OR REPLACE INTO votes(tid,uid,opt) VALUES(?,?,?)", t.id, me.id, opt);
      return json({ poll: this.pollOut(t, me.id) });
    }

    // ---- 通知 ----
    if (path === "/api/notifs" && M === "GET") {
      const rows = this.q("SELECT * FROM notifs WHERE uid=? ORDER BY ts DESC LIMIT 60", me.id);
      const unread = this.one("SELECT COUNT(*) c FROM notifs WHERE uid=? AND rd=0", me.id).c;
      const items = rows.map((r) => ({ id: r.id, kind: r.kind, actor: r.actor || null, gid: r.gid, tid: r.tid, peer: r.peer, text: r.text, ts: r.ts, rd: !!r.rd }));
      return json({ items, unread, users: this.users(items.map((x) => x.actor)) });
    }
    if (path === "/api/notifs/read" && M === "POST") {
      const b = await this.body(req);
      if (b.id) this.run("UPDATE notifs SET rd=1 WHERE uid=? AND id=?", me.id, String(b.id));
      else this.run("UPDATE notifs SET rd=1 WHERE uid=?", me.id);
      return json({ ok: true });
    }

    // ---- 検索（自分が入っている部屋の投稿とコメント） ----
    if (path === "/api/find" && M === "GET") {
      const q = str(url.searchParams.get("q") || "", 40).replace(/[\\%_]/g, "");
      if (!q) return json({ items: [], users: {} });
      const like = "%" + q + "%";
      const gid = url.searchParams.get("gid");
      const gf = gid && /^[a-f0-9]{20}$/.test(gid) ? " AND t.gid=?" : "";
      const ga = gf ? [gid] : [];
      const blocked = this.myBlocks(me.id);
      const th = this.q(
        `SELECT t.id tid, t.gid gid, t.author author, t.body body, t.ts ts, g.name gname FROM threads t JOIN groups g ON g.id=t.gid JOIN gm ON gm.gid=t.gid AND gm.uid=? WHERE t.body LIKE ? ESCAPE '\\'${gf} ORDER BY t.ts DESC LIMIT 30`,
        me.id, like, ...ga
      ).map((r) => ({ kind: "thread", ...r }));
      const cm = this.q(
        `SELECT c.tid tid, t.gid gid, c.author author, c.body body, c.ts ts, g.name gname FROM comments c JOIN threads t ON t.id=c.tid JOIN groups g ON g.id=t.gid JOIN gm ON gm.gid=t.gid AND gm.uid=? WHERE c.body LIKE ? ESCAPE '\\'${gf} ORDER BY c.ts DESC LIMIT 30`,
        me.id, like, ...ga
      ).map((r) => ({ kind: "comment", ...r }));
      const items = [...th, ...cm].filter((x) => !blocked.has(x.author)).sort((x, y) => y.ts - x.ts).slice(0, 40);
      return json({ items, users: this.users(items.map((x) => x.author)) });
    }

    // ---- ブロック ----
    if (path === "/api/blocks" && M === "GET") {
      const ids = [...this.myBlocks(me.id)];
      return json({ users: ids.map((id) => this.users([id])[id]).filter(Boolean) });
    }
    if ((path === "/api/blocks" || path === "/api/blocks/remove") && M === "POST") {
      const b = await this.body(req);
      const uid = str(b.id, 40);
      const u = this.one("SELECT id FROM users WHERE id=?", uid);
      if (!u || uid === me.id) throw bad("user");
      if (path === "/api/blocks") {
        this.run("INSERT OR IGNORE INTO blocks(a,b,ts) VALUES(?,?,?)", me.id, uid, Date.now());
        const [x, y] = pair(me.id, uid);
        this.run("DELETE FROM friends WHERE a=? AND b=?", x, y);
      } else this.run("DELETE FROM blocks WHERE a=? AND b=?", me.id, uid);
      return json({ ok: true });
    }

    // ---- 通報 ----
    if (path === "/api/report" && M === "POST") {
      const b = await this.body(req);
      const kind = str(b.kind, 10);
      const tgt = str(b.tgt, 40);
      let gid = null;
      let owner = null;
      if (kind === "thread") {
        const t = this.one("SELECT gid FROM threads WHERE id=?", tgt);
        if (!t || !this.member(t.gid, me.id)) throw new HttpError(404, "not_found");
        gid = t.gid;
      } else if (kind === "comment") {
        const c = this.one("SELECT tid FROM comments WHERE id=?", tgt);
        const t = c && this.one("SELECT gid FROM threads WHERE id=?", c.tid);
        if (!t || !this.member(t.gid, me.id)) throw new HttpError(404, "not_found");
        gid = t.gid;
      } else if (kind === "dm") {
        const d = this.one("SELECT pk FROM dms WHERE id=?", tgt);
        if (!d || !d.pk.split(":").includes(me.id)) throw new HttpError(404, "not_found");
      } else if (kind === "user") {
        if (!this.one("SELECT 1 x FROM users WHERE id=?", tgt)) throw new HttpError(404, "not_found");
      } else throw bad("kind");
      this.rate("rp:" + me.id, 20, 36e5);
      this.run("INSERT INTO reports(id,reporter,kind,tgt,gid,reason,ts) VALUES(?,?,?,?,?,?,?)", rid(10), me.id, kind, tgt, gid, str(b.reason, 200), Date.now());
      if (gid) {
        owner = this.one("SELECT owner FROM groups WHERE id=?", gid)?.owner;
        // 部屋のオーナーには、匿名で知らせる
        if (owner && owner !== me.id) this.notify(owner, "report", "", { gid, tid: kind === "thread" ? tgt : this.one("SELECT tid FROM comments WHERE id=?", tgt)?.tid, text: str(b.reason, 60) });
      }
      return json({ ok: true });
    }
    if (path === "/api/admin/reports" && M === "GET") {
      if (!this.isAdmin(me)) throw new HttpError(403, "forbidden");
      const rows = this.q("SELECT * FROM reports WHERE status='open' ORDER BY ts DESC LIMIT 100");
      const us = this.users(rows.map((r) => r.reporter));
      const items = rows.map((r) => {
        let text = "";
        if (r.kind === "thread") text = this.one("SELECT body FROM threads WHERE id=?", r.tgt)?.body || "";
        else if (r.kind === "comment") text = this.one("SELECT body FROM comments WHERE id=?", r.tgt)?.body || "";
        else if (r.kind === "dm") text = this.one("SELECT body FROM dms WHERE id=?", r.tgt)?.body || "";
        else if (r.kind === "user") text = "@" + (this.one("SELECT handle FROM users WHERE id=?", r.tgt)?.handle || "");
        return { id: r.id, kind: r.kind, tgt: r.tgt, reason: r.reason, ts: r.ts, reporter: us[r.reporter]?.handle || "", text: snip(text) };
      });
      return json({ items });
    }
    if (path === "/api/admin/reports/resolve" && M === "POST") {
      if (!this.isAdmin(me)) throw new HttpError(403, "forbidden");
      const b = await this.body(req);
      this.run("UPDATE reports SET status='done' WHERE id=?", str(b.id, 40));
      return json({ ok: true });
    }

    // ---- DM（友達とのメッセージ） ----
    if (path === "/api/dms" && M === "GET") {
      const rows = this.q("SELECT * FROM friends WHERE (a=? OR b=?) AND status='accepted'", me.id, me.id).filter((r) => !this.blockedPair(me.id, r.a === me.id ? r.b : r.a));
      const convs = [];
      for (const r of rows) {
        const peer = r.a === me.id ? r.b : r.a;
        const pk = pair(me.id, peer).join(":");
        const last = this.one("SELECT * FROM dms WHERE pk=? ORDER BY ts DESC LIMIT 1", pk);
        if (!last) continue;
        const rd = this.one("SELECT ts FROM dm_reads WHERE uid=? AND peer=?", me.id, peer);
        const unread = this.one("SELECT COUNT(*) c FROM dms WHERE pk=? AND author!=? AND ts>?", pk, me.id, rd ? rd.ts : 0).c;
        convs.push({ peer, unread, last: { text: last.body, stamp: !!last.stamp && !last.body, photo: !!JSON.parse(last.imgs || "[]").length && !last.body, mine: last.author === me.id, ts: last.ts } });
      }
      convs.sort((x, y) => y.last.ts - x.last.ts);
      return json({ convs, unread: convs.reduce((n, c) => n + c.unread, 0), users: this.users(convs.map((c) => c.peer)) });
    }
    if ((m = path.match(/^\/api\/dms\/([a-f0-9]{20})$/))) {
      const peer = m[1];
      if (!this.isFriend(me.id, peer)) throw new HttpError(404, "not_found");
      const pk = pair(me.id, peer).join(":");
      if (M === "GET") {
        const rows = this.q("SELECT * FROM (SELECT * FROM dms WHERE pk=? ORDER BY ts DESC LIMIT 200) ORDER BY ts", pk);
        const rx = this.reactsFor(rows.map((x) => x.id), me.id);
        this.run("INSERT OR REPLACE INTO dm_reads(uid,peer,ts) VALUES(?,?,?)", me.id, peer, Date.now());
        const pr = this.one("SELECT ts FROM dm_reads WHERE uid=? AND peer=?", peer, me.id);
        const peerHides = this.one("SELECT hide_read FROM users WHERE id=?", peer)?.hide_read;
        const peerRead = pr && !peerHides && !me.hide_read ? pr.ts : 0;
        const messages = rows.map((x) => ({ id: x.id, author: x.author, text: x.body, images: JSON.parse(x.imgs || "[]"), stamp: x.stamp || null, ts: x.ts, reacts: rx[x.id] || [] }));
        return json({
          messages, peer, peerRead, users: this.users([peer, me.id, ...Object.values(rx).flat().flatMap((r) => r.u)]),
          stamps: this.stampMap([...Object.values(rx).flat().map((r) => r.s), ...messages.map((x) => x.stamp)]),
        });
      }
      if (M === "POST") {
        const b = await this.body(req);
        if (this.blockedPair(me.id, peer)) throw new HttpError(403, "blocked");
        this.rate("d:" + me.id, 600, 36e5);
        const text = str(b.text, 2e4);
        const imgs = this.ownImgs(b.images, me.id);
        const stamp = b.stamp ? String(b.stamp) : null;
        if (stamp && !this.stampOk(stamp)) throw bad("stamp");
        if (!text && !imgs.length && !stamp) throw bad("empty");
        const id = rid(10);
        this.run("INSERT INTO dms(id,pk,author,body,imgs,stamp,ts) VALUES(?,?,?,?,?,?,?)", id, pk, me.id, text, JSON.stringify(imgs), stamp, Date.now());
        for (const uid of this.mentioned(text, { peer })) this.notify(uid, "mention", me.id, { peer: me.id, text: snip(text) });
        this.pushTo(peer, "dm", { t: me.name, b: text ? str(text, 90) : stamp ? "スタンプを送りました" : "写真を送りました", u: `/#/dm/${me.id}`, g: `dm:${me.id}` });
        return json({ id });
      }
    }
    if ((m = path.match(/^\/api\/dmsg\/([a-f0-9]{20})$/)) && M === "DELETE") {
      const d = this.one("SELECT * FROM dms WHERE id=?", m[1]);
      if (!d || d.author !== me.id) throw new HttpError(404, "not_found");
      this.run("DELETE FROM reactions WHERE tgt=?", d.id);
      this.run("DELETE FROM dms WHERE id=?", d.id);
      return json({ ok: true });
    }

    // ---- スタンプ ----
    if (path === "/api/stamps" && M === "GET") {
      const rows = this.q("SELECT id,spec,ts FROM stamps WHERE owner=? AND del=0 ORDER BY ts DESC", me.id);
      return json({ stamps: rows.map((r) => ({ id: r.id, spec: JSON.parse(r.spec), ts: r.ts })), limit: STAMP_LIMIT });
    }
    if (path === "/api/stamps" && M === "POST") {
      const b = await this.body(req);
      return json({ stamp: this.addStamp(me.id, this.stampSpec(me.id, b.spec)) });
    }
    if ((m = path.match(/^\/api\/stamps\/([a-f0-9]{20})$/))) {
      const st = this.one("SELECT * FROM stamps WHERE id=?", m[1]);
      if (M === "GET") {
        if (!st) throw new HttpError(404, "not_found");
        return json({ stamp: { id: st.id, spec: JSON.parse(st.spec) } });
      }
      if (!st || st.owner !== me.id) throw new HttpError(404, "not_found");
      if (M === "PUT") {
        const b = await this.body(req);
        const spec = this.stampSpec(me.id, b.spec);
        this.run("UPDATE stamps SET spec=? WHERE id=?", JSON.stringify(spec), st.id);
        return json({ stamp: { id: st.id, spec } });
      }
      if (M === "DELETE") {
        // すでに使われたリアクションは残るように、一覧から隠すだけにする
        this.run("UPDATE stamps SET del=1 WHERE id=?", st.id);
        return json({ ok: true });
      }
    }
    if ((m = path.match(/^\/api\/stamps\/([a-f0-9]{20})\/copy$/)) && M === "POST") {
      const st = this.one("SELECT spec FROM stamps WHERE id=?", m[1]);
      if (!st) throw new HttpError(404, "not_found");
      return json({ stamp: this.addStamp(me.id, this.stampSpec(me.id, JSON.parse(st.spec), true)) });
    }

    // ---- リアクション（同じスタンプをもう一度押すと外れる） ----
    if (path === "/api/react" && M === "POST") {
      const b = await this.body(req);
      const tgt = str(b.tgt, 20);
      let gid = null;
      const t = this.one("SELECT gid FROM threads WHERE id=?", tgt);
      let allowed = false;
      if (t) gid = t.gid;
      else {
        const c = this.one("SELECT tid FROM comments WHERE id=?", tgt);
        const t2 = c && this.one("SELECT gid FROM threads WHERE id=?", c.tid);
        if (t2) gid = t2.gid;
        else {
          const d = this.one("SELECT pk FROM dms WHERE id=?", tgt);
          if (d && d.pk.split(":").includes(me.id)) allowed = true;
        }
      }
      if (!allowed && (!gid || !this.member(gid, me.id))) throw new HttpError(404, "not_found");
      const stamp = String(b.stamp || "");
      if (!this.stampOk(stamp)) throw bad("stamp");
      this.rate("x:" + me.id, 300, 36e5);
      const had = this.one("SELECT 1 x FROM reactions WHERE tgt=? AND uid=? AND stamp=?", tgt, me.id, stamp);
      if (had) this.run("DELETE FROM reactions WHERE tgt=? AND uid=? AND stamp=?", tgt, me.id, stamp);
      else {
        if (this.one("SELECT COUNT(*) c FROM reactions WHERE tgt=? AND uid=?", tgt, me.id).c >= 10) throw new HttpError(400, "too_many_reacts");
        this.run("INSERT INTO reactions(tgt,uid,stamp,ts) VALUES(?,?,?,?)", tgt, me.id, stamp, Date.now());
        // 投稿・コメントの書いた人に知らせる（DM には通知を出さない）
        const tt = this.one("SELECT author, body, gid FROM threads WHERE id=?", tgt);
        const cc = !tt && this.one("SELECT c.author, c.body, c.tid, t.gid FROM comments c JOIN threads t ON t.id=c.tid WHERE c.id=?", tgt);
        if (tt) this.notify(tt.author, "react", me.id, { gid: tt.gid, tid: tgt, text: snip(tt.body, "写真") });
        else if (cc) this.notify(cc.author, "react", me.id, { gid: cc.gid, tid: cc.tid, text: snip(cc.body, "スタンプ") });
      }
      const reacts = this.reactsFor([tgt], me.id)[tgt] || [];
      return json({ reacts, stamps: this.stampMap(reacts.map((r) => r.s)) });
    }
    throw new HttpError(404, "not_found");
  }

  addStamp(uid, spec) {
    if (this.one("SELECT COUNT(*) c FROM stamps WHERE owner=? AND del=0", uid).c >= STAMP_LIMIT) throw new HttpError(400, "limit");
    const id = rid(10);
    const ts = Date.now();
    this.run("INSERT INTO stamps(id,owner,spec,ts) VALUES(?,?,?,?)", id, uid, JSON.stringify(spec), ts);
    return { id, spec, ts };
  }

  // ---- 回数制限 ----
  // ログイン失敗：10分に8回まで（成功したら数えない）
  throttle(key) {
    const now = Date.now();
    const r = this.one("SELECT n,ts FROM attempts WHERE k=?", key);
    if (r && now - r.ts < 6e5 && r.n >= 8) throw new HttpError(429, "too_many");
    return r && now - r.ts < 6e5 ? r.n : 0;
  }
  fail(key, n) {
    this.run("INSERT OR REPLACE INTO attempts(k,n,ts) VALUES(?,?,?)", key, n + 1, Date.now());
  }
  // 決まった時間内の回数を数えて、超えたら止める（登録・部屋づくり・コード入力・友達申請）
  rate(key, limit, windowMs) {
    const now = Date.now();
    const r = this.one("SELECT n,ts FROM attempts WHERE k=?", key);
    if (r && now - r.ts < windowMs) {
      if (r.n >= limit) throw new HttpError(429, "too_many");
      this.run("UPDATE attempts SET n=n+1 WHERE k=?", key);
    } else {
      this.run("INSERT OR REPLACE INTO attempts(k,n,ts) VALUES(?,?,?)", key, 1, now);
    }
  }

  async signup(req) {
    const b = await this.body(req);
    // 招待コードは不要。かわりに、同じ回線からの登録は1時間に10人までにする
    this.rate("s:" + (req.headers.get("cf-connecting-ip") || "x"), 10, 36e5);
    const handle = str(b.handle, 20).toLowerCase();
    const name = str(b.name, 20);
    const pw = typeof b.password === "string" ? b.password : "";
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) throw bad("handle");
    if (!name) throw bad("name");
    if (pw.length < 8 || pw.length > 200) throw bad("password");
    if (this.one("SELECT 1 x FROM users WHERE handle=?", handle)) throw new HttpError(409, "taken");
    const id = rid(10);
    const salt = rid(8);
    this.run(
      "INSERT INTO users(id,handle,name,color,avatar,pw,salt,ts) VALUES(?,?,?,?,?,?,?,?)",
      id, handle, name, Math.floor(Math.random() * 6), null, await pbkdf(pw, salt), salt, Date.now()
    );
    // 最初から自分だけの部屋（メモ帳がわり）を1つ用意する
    this.createGroup("ひとりごと", id, []);
    // パスワードを忘れたときの復旧コード（この1回だけ表示する）
    const recovery = makeRecovery();
    this.run("UPDATE users SET recovery=? WHERE id=?", await sha("rc:" + normRecovery(recovery)), id);
    const cookie = await this.startSession(id);
    return json({ me: this.selfOut(this.one("SELECT id,handle,name,color,avatar,bio,hide_read FROM users WHERE id=?", id)), recovery }, 200, { "set-cookie": cookie });
  }

  async login(req) {
    const b = await this.body(req);
    const handle = str(b.handle, 20).toLowerCase();
    const pw = typeof b.password === "string" ? b.password : "";
    const key = "l:" + handle;
    const n = this.throttle(key);
    const u = this.one("SELECT * FROM users WHERE handle=?", handle);
    const ok = u && (await pbkdf(pw, u.salt)) === u.pw;
    if (!ok) {
      this.fail(key, n);
      throw new HttpError(401, "login");
    }
    const cookie = await this.startSession(u.id);
    return json({ me: this.selfOut(u) }, 200, { "set-cookie": cookie });
  }

  // パスワードの再設定（ユーザーID + 復旧コード）
  async resetPassword(req) {
    const b = await this.body(req);
    const handle = str(b.handle, 20).toLowerCase();
    const ip = "r:" + (req.headers.get("cf-connecting-ip") || "x");
    const n1 = this.throttle(ip);
    const n2 = this.throttle("r:" + handle);
    const pw = typeof b.pw === "string" ? b.pw : "";
    const u = this.one("SELECT * FROM users WHERE handle=?", handle);
    const ok = u && u.recovery && (await sha("rc:" + normRecovery(b.code))) === u.recovery;
    if (!ok) {
      this.fail(ip, n1);
      this.fail("r:" + handle, n2);
      throw new HttpError(401, "recovery");
    }
    if (pw.length < 8 || pw.length > 200) throw bad("password");
    const salt = rid(8);
    const code = makeRecovery();
    this.run("UPDATE users SET pw=?, salt=?, recovery=? WHERE id=?", await pbkdf(pw, salt), salt, await sha("rc:" + normRecovery(code)), u.id);
    this.run("DELETE FROM sessions WHERE uid=?", u.id);
    const cookie = await this.startSession(u.id);
    return json({ me: this.selfOut(this.one("SELECT id,handle,name,color,avatar,bio,hide_read FROM users WHERE id=?", u.id)), recovery: code }, 200, { "set-cookie": cookie });
  }
}
