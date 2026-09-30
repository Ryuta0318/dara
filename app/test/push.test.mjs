// node app/test/push.test.mjs
// Web Push の暗号化・署名を、受け取る側（ブラウザ）の手順で検証する
import assert from "node:assert/strict";
import { b64u, unb64u, generateVapid, vapidAuthorization, encryptPayload, sendPush, endpointAllowed } from "../src/push.js";

const te = new TextEncoder();
const concat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8));
}

// ブラウザ側（受信者）の鍵
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
const auth = crypto.getRandomValues(new Uint8Array(16));
const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: b64u(uaPub), auth: b64u(auth) };

// 受信者の手順（RFC 8291 §3.4）で復号する
async function decrypt(body) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
  const idlen = body[20];
  const asPub = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  assert.equal(rs, 4096); assert.equal(idlen, 65);
  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(te.encode("WebPush: info\0"), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aes, cipher));
  assert.equal(plain[plain.length - 1], 2, "last record delimiter");
  return new TextDecoder().decode(plain.slice(0, -1));
}

// 1) 暗号化 → 復号（日本語・絵文字つき）
const msg = JSON.stringify({ t: "週末ドライブ部", b: "ベンさんがコメント: 海がいい 🌊", u: "/#/t/abc" });
const enc = await encryptPayload(sub, msg);
assert.equal(await decrypt(enc), msg);
// 毎回、違う暗号文になる
assert.notDeepEqual(Array.from(enc), Array.from(await encryptPayload(sub, msg)));
console.log("ok  encrypt/decrypt round trip (", enc.length, "bytes )");

// 2) VAPID の署名を、公開鍵で検証する
const vapid = await generateVapid();
assert.equal(unb64u(vapid.publicKey).length, 65);
const hdr = await vapidAuthorization(sub.endpoint, vapid, "mailto:test@example.com");
const m = hdr.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
assert.ok(m, "header format");
const pubKey = await crypto.subtle.importKey("raw", unb64u(m[4]), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
const okSig = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pubKey, unb64u(m[3]), te.encode(`${m[1]}.${m[2]}`));
assert.ok(okSig, "signature verifies");
const claims = JSON.parse(new TextDecoder().decode(unb64u(m[2])));
assert.equal(claims.aud, "https://fcm.googleapis.com"); assert.equal(claims.sub, "mailto:test@example.com");
assert.ok(claims.exp > Date.now() / 1000 && claims.exp - Date.now() / 1000 <= 12 * 3600 + 5);
assert.deepEqual(JSON.parse(new TextDecoder().decode(unb64u(m[1]))), { typ: "JWT", alg: "ES256" });
console.log("ok  vapid jwt verifies, claims =", JSON.stringify(claims));

// 3) 送信：ヘッダーと、返ってきたステータス
let seen;
const status = await sendPush(sub, msg, vapid, "mailto:test@example.com", { fetchFn: async (url, init) => { seen = { url, init }; return { status: 201 }; } });
assert.equal(status, 201); assert.equal(seen.url, sub.endpoint);
assert.equal(seen.init.headers["Content-Encoding"], "aes128gcm"); assert.equal(seen.init.headers.TTL, "86400");
assert.equal(await decrypt(seen.init.body), msg);
console.log("ok  sendPush headers + body");

// 4) 配信元の許可リスト
assert.ok(endpointAllowed("https://fcm.googleapis.com/fcm/send/x"));
assert.ok(endpointAllowed("https://updates.push.services.mozilla.com/wpush/v2/x"));
assert.ok(endpointAllowed("https://web.push.apple.com/x"));
assert.ok(endpointAllowed("https://wns2-par02p.notify.windows.com/x"));
assert.ok(!endpointAllowed("https://evil.example.com/x"));
assert.ok(!endpointAllowed("http://fcm.googleapis.com/x"));
assert.ok(!endpointAllowed("https://fcm.googleapis.com.evil.com/x"));
assert.ok(!endpointAllowed("http://127.0.0.1:9999/x")); assert.ok(endpointAllowed("http://127.0.0.1:9999/x", true));
console.log("ok  endpoint allow-list");
