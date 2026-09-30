// 起動中のアプリ（http://127.0.0.1:8787）に対して、プッシュ通知が実際に届くか確かめる
//   受け取り側は、ブラウザのかわりに、この中の小さなサーバーが務める（復号して中身を確認する）
import http from "node:http";
import assert from "node:assert/strict";
import { b64u, unb64u } from "../src/push.js";

const B = process.env.BASE || "http://127.0.0.1:8787";
const te = new TextEncoder();
const concat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
async function hkdf(salt, ikm, info, bytes) { const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]); return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8)); }

// 受信側の端末（鍵つき）
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
const auth = crypto.getRandomValues(new Uint8Array(16));
async function decrypt(body) {
  const salt = body.slice(0, 16), idlen = body[20], asPub = body.slice(21, 21 + idlen), cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(te.encode("WebPush: info\0"), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16), nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, cipher));
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

const got = []; let respond = 201;
const srv = http.createServer((req, res) => {
  const chunks = []; req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    try { got.push({ url: req.url, headers: req.headers, msg: await decrypt(new Uint8Array(Buffer.concat(chunks))) }); } catch (e) { got.push({ error: String(e) }); }
    res.statusCode = respond; res.end();
  });
}).listen(9999);

const jar = {};
async function call(who, method, path, body) {
  const r = await fetch(B + path, { method, headers: { "x-sr": "1", "content-type": "application/json", cookie: jar[who] || "" }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie"); if (sc) jar[who] = sc.split(";")[0];
  return { status: r.status, data: await r.json().catch(() => null) };
}
const sfx = String(Date.now() % 100000);
const wait = async (n, ms = 4000) => { const t = Date.now(); while (got.length < n && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 50)); };

const A = "pa" + sfx, Bn = "pb" + sfx;
await call("a", "POST", "/api/signup", { handle: A, name: "アリス", password: "password1" });
await call("b", "POST", "/api/signup", { handle: Bn, name: "ボブ", password: "password1" });
const aid = (await call("a", "GET", "/api/me")).data.me.id, bid = (await call("b", "GET", "/api/me")).data.me.id;

// 公開鍵を受け取って、購読する
const key = await call("a", "GET", "/api/push/key");
assert.equal(unb64u(key.data.key).length, 65); assert.deepEqual([key.data.dm, key.data.other, key.data.devices], [true, true, 0]);
assert.equal((await call("a", "POST", "/api/push/subscribe", { endpoint: "https://evil.example.com/x", keys: { p256dh: b64u(uaPub), auth: b64u(auth) } })).status, 400);
const sub = await call("a", "POST", "/api/push/subscribe", { endpoint: "http://127.0.0.1:9999/push/alice", keys: { p256dh: b64u(uaPub), auth: b64u(auth) } });
assert.equal(sub.status, 200); assert.equal((await call("a", "GET", "/api/push/key")).data.devices, 1);
console.log("ok  subscribe (bad endpoint rejected)");

// テスト通知
await call("a", "POST", "/api/push/test"); await wait(1);
assert.equal(got[0].msg.b.startsWith("テスト通知です"), true); assert.match(got[0].headers.authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
assert.equal(got[0].headers["content-encoding"], "aes128gcm");
assert.equal(got[0].headers.authorization.split("k=")[1], key.data.key, "VAPID public key matches");
console.log("ok  test push delivered + decrypted:", got[0].msg.b);

// 部屋で、ボブがアリスを呼ぶ → 通知が届く
const room = (await call("a", "POST", "/api/groups", { name: "週末部" })).data;
await call("b", "POST", "/api/groups/join", { code: room.code });
const th = await call("b", "POST", `/api/groups/${room.id}/threads`, { text: `どう？ @${A}` }); await wait(2);
assert.equal(got[1].msg.t, "週末部"); assert.match(got[1].msg.b, /ボブがあなたを呼びました/); assert.equal(got[1].msg.u, `/#/t/${th.data.id}`);
console.log("ok  mention push:", JSON.stringify(got[1].msg));

// コメント → 通知 / 自分のコメントでは届かない
await call("b", "POST", `/api/threads/${th.data.id}/comments`, { text: "海がいい" });
await call("a", "POST", `/api/threads/${th.data.id}/comments`, { text: "いいね" }); await new Promise((r) => setTimeout(r, 600));
assert.equal(got.length, 2, "no push for own actions, and thread author Bob has no subscription");
// アリスの投稿へのコメント
const th2 = await call("a", "POST", `/api/groups/${room.id}/threads`, { text: "次の週末" });
await call("b", "POST", `/api/threads/${th2.data.id}/comments`, { text: "いいね！" }); await wait(3);
assert.match(got[2].msg.b, /ボブがコメントしました\nいいね！/);
console.log("ok  comment push:", JSON.stringify(got[2].msg.b));

// DM（友達どうし）
await call("a", "POST", "/api/friends/request", { handle: Bn }); await call("b", "POST", "/api/friends/request", { handle: A }); await wait(4);
const before = got.length;
await call("b", "POST", `/api/dms/${aid}`, { text: "こんにちは" }); await wait(before + 1);
const dm = got[got.length - 1].msg; assert.equal(dm.t, "ボブ"); assert.equal(dm.b, "こんにちは"); assert.equal(dm.u, `/#/dm/${bid}`);
console.log("ok  dm push:", JSON.stringify(dm));

// 種類ごとのオフ
await call("a", "POST", "/api/push/settings", { dm: false });
const n1 = got.length; await call("b", "POST", `/api/dms/${aid}`, { text: "届かない" }); await new Promise((r) => setTimeout(r, 700));
assert.equal(got.length, n1, "dm off"); 
await call("b", "POST", `/api/threads/${th2.data.id}/comments`, { text: "これは届く" }); await wait(n1 + 1);
assert.equal(got.length, n1 + 1, "other still on");
await call("a", "POST", "/api/push/settings", { other: false, dm: true });
const n2 = got.length; await call("b", "POST", `/api/threads/${th2.data.id}/comments`, { text: "届かない" }); await new Promise((r) => setTimeout(r, 700));
assert.equal(got.length, n2, "other off"); console.log("ok  per-category switches");

// 配信先が「もう無効（410）」と答えたら、その端末を消す
respond = 410; await call("a", "POST", "/api/push/settings", { other: true });
await call("b", "POST", `/api/threads/${th2.data.id}/comments`, { text: "410になる" }); await wait(n2 + 1);
await new Promise((r) => setTimeout(r, 500));
assert.equal((await call("a", "GET", "/api/push/key")).data.devices, 0); console.log("ok  expired subscription removed");

// 購読の解除
respond = 201; await call("a", "POST", "/api/push/subscribe", { endpoint: "http://127.0.0.1:9999/push/alice", keys: { p256dh: b64u(uaPub), auth: b64u(auth) } });
await call("a", "POST", "/api/push/unsubscribe", { endpoint: "http://127.0.0.1:9999/push/alice" });
assert.equal((await call("a", "GET", "/api/push/key")).data.devices, 0); console.log("ok  unsubscribe");
srv.close(); process.exit(0);
