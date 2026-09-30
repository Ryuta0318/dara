import { DurableObject } from "cloudflare:workers";

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
const pub = (u) => (u ? { id: u.id, handle: u.handle, name: u.name, color: u.color, avatar: u.avatar || null } : null);
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
    return s ? this.one("SELECT id,handle,name,color,avatar FROM users WHERE id=?", s.uid) : null;
  }

  async startSession(uid) {
    const tok = rid(24);
    this.run("INSERT INTO sessions(tok,uid,ts) VALUES(?,?,?)", await sha(tok), uid, Date.now());
    return `sr=${tok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000`;
  }

  users(ids) {
    const u = [...new Set(ids.filter(Boolean))].slice(0, 200);
    if (!u.length) return {};
    const rows = this.q(`SELECT id,handle,name,color,avatar FROM users WHERE id IN (${u.map(() => "?").join(",")})`, ...u);
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

  createGroup(name, ownerId, memberIds) {
    const id = rid(10);
    const now = Date.now();
    const code = this.newCode();
    this.run(
      "INSERT INTO groups(id,name,color,owner,ts,last,last_text,code) VALUES(?,?,?,?,?,?,?,?)",
      id, name, Math.floor(Math.random() * 6), ownerId, now, now, "", code
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
    const me = await this.sessionUser(req);
    if (path === "/api/me" && M === "GET") return json({ me: pub(me) });
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
      return json({ me: pub(this.one("SELECT id,handle,name,color,avatar FROM users WHERE id=?", me.id)) });
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
        "SELECT id,handle,name,color,avatar FROM users WHERE id!=? AND (handle LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY handle LIMIT 12",
        me.id, q.toLowerCase() + "%", "%" + q + "%"
      );
      return json({ users: rows.map(pub) });
    }
    // 友達追加リンク / QR から開いたときの相手の確認用
    if ((m = path.match(/^\/api\/u\/([a-z0-9_]{3,20})$/)) && M === "GET") {
      const u = this.one("SELECT id,handle,name,color,avatar FROM users WHERE handle=?", m[1]);
      if (!u) throw new HttpError(404, "not_found");
      return json({ user: pub(u), rel: this.relation(me.id, u.id) });
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
      if (!target || target.id === me.id) throw bad("user");
      this.rate("f:" + me.id, 60, 36e5);
      const [x, y] = pair(me.id, target.id);
      const r = this.one("SELECT * FROM friends WHERE a=? AND b=?", x, y);
      if (!r) this.run("INSERT INTO friends(a,b,status,frm,ts) VALUES(?,?,?,?,?)", x, y, "pending", me.id, Date.now());
      else if (r.status === "pending" && r.frm !== me.id) this.run("UPDATE friends SET status='accepted', ts=? WHERE a=? AND b=?", Date.now(), x, y);
      return json({ ok: true, rel: this.relation(me.id, target.id) });
    }
    if (path === "/api/friends/accept" && M === "POST") {
      const b = await this.body(req);
      const [x, y] = pair(me.id, str(b.id, 40));
      this.run("UPDATE friends SET status='accepted', ts=? WHERE a=? AND b=? AND status='pending' AND frm!=?", Date.now(), x, y, me.id);
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
        ids = ids.concat(mem.slice(0, 8));
        return { id: g.id, name: g.name, color: g.color, last: g.last, lastText: g.last_text, members: mem };
      });
      return json({ groups, users: this.users(ids) });
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
      const g = code && this.one("SELECT id,name,color FROM groups WHERE code=?", code);
      if (!g) throw new HttpError(404, "no_room");
      const n = this.one("SELECT COUNT(*) c FROM gm WHERE gid=?", g.id).c;
      return json({ group: { id: g.id, name: g.name, color: g.color, count: n }, already: this.member(g.id, me.id) });
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
      return json({ group: { id: g.id, name: g.name, color: g.color, code: g.code, members: mem }, users: this.users(mem) });
    }
    if ((m = path.match(/^\/api\/groups\/([a-f0-9]{20})\/code$/)) && M === "POST") {
      // 漏れたときのために、メンバーなら誰でも作り直せる（古いコードは使えなくなる）
      const g = this.needGroup(m[1], me.id);
      const code = this.newCode();
      this.run("UPDATE groups SET code=? WHERE id=?", code, g.id);
      return json({ code });
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
      if (!this.one("SELECT 1 x FROM gm WHERE gid=?", g.id)) {
        this.run("DELETE FROM comments WHERE tid IN (SELECT id FROM threads WHERE gid=?)", g.id);
        this.run("DELETE FROM threads WHERE gid=?", g.id);
        this.run("DELETE FROM groups WHERE id=?", g.id);
      }
      return json({ ok: true });
    }

    if ((m = path.match(/^\/api\/groups\/([a-f0-9]{20})\/threads$/))) {
      const g = this.needGroup(m[1], me.id);
      if (M === "GET") {
        const rows = this.q("SELECT * FROM threads WHERE gid=? ORDER BY last DESC LIMIT 100", g.id);
        const threads = rows.map((t) => ({ id: t.id, author: t.author, text: t.body, images: JSON.parse(t.imgs || "[]"), ts: t.ts, last: t.last, count: t.ccount }));
        return json({ threads, users: this.users(threads.map((t) => t.author)) });
      }
      if (M === "POST") {
        const b = await this.body(req);
        const text = str(b.text, 2e4);
        const imgs = this.ownImgs(b.images, me.id);
        if (!text && !imgs.length) throw bad("empty");
        const id = rid(10);
        const now = Date.now();
        this.run("INSERT INTO threads(id,gid,author,body,imgs,ts,last,ccount) VALUES(?,?,?,?,?,?,?,0)", id, g.id, me.id, text, JSON.stringify(imgs), now, now);
        this.run("UPDATE groups SET last=?, last_text=? WHERE id=?", now, (text || "写真").slice(0, 60), g.id);
        return json({ id });
      }
    }

    if ((m = path.match(/^\/api\/threads\/([a-f0-9]{20})$/))) {
      const t = this.one("SELECT * FROM threads WHERE id=?", m[1]);
      if (!t || !this.member(t.gid, me.id)) throw new HttpError(404, "not_found");
      if (M === "GET") {
        const cs = this.q("SELECT * FROM comments WHERE tid=? ORDER BY ts LIMIT 500", t.id).map((c) => ({
          id: c.id, author: c.author, text: c.body, images: JSON.parse(c.imgs || "[]"), ts: c.ts,
        }));
        const g = this.one("SELECT name,color FROM groups WHERE id=?", t.gid);
        return json({
          thread: { id: t.id, gid: t.gid, author: t.author, text: t.body, images: JSON.parse(t.imgs || "[]"), ts: t.ts, count: t.ccount },
          group: { id: t.gid, name: g.name, color: g.color },
          comments: cs,
          users: this.users([t.author, ...cs.map((c) => c.author)]),
        });
      }
      if (M === "DELETE") {
        if (t.author !== me.id) throw new HttpError(403, "forbidden");
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
      if (!text && !imgs.length) throw bad("empty");
      const id = rid(10);
      const now = Date.now();
      this.run("INSERT INTO comments(id,tid,author,body,imgs,ts) VALUES(?,?,?,?,?,?)", id, t.id, me.id, text, JSON.stringify(imgs), now);
      this.run("UPDATE threads SET ccount=ccount+1, last=? WHERE id=?", now, t.id);
      this.run("UPDATE groups SET last=?, last_text=? WHERE id=?", now, (text || "写真").slice(0, 60), t.gid);
      return json({ id });
    }
    if ((m = path.match(/^\/api\/comments\/([a-f0-9]{20})$/)) && M === "DELETE") {
      const c = this.one("SELECT * FROM comments WHERE id=?", m[1]);
      if (!c || c.author !== me.id) throw new HttpError(404, "not_found");
      this.run("DELETE FROM comments WHERE id=?", c.id);
      this.run("UPDATE threads SET ccount=MAX(0,ccount-1) WHERE id=?", c.tid);
      return json({ ok: true });
    }
    throw new HttpError(404, "not_found");
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
    const cookie = await this.startSession(id);
    return json({ me: pub(this.one("SELECT id,handle,name,color,avatar FROM users WHERE id=?", id)) }, 200, { "set-cookie": cookie });
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
    return json({ me: pub(u) }, 200, { "set-cookie": cookie });
  }
}
