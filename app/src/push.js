// Web Push（RFC 8030 / 8291 / 8292）を WebCrypto だけで実装する
//   ・VAPID の鍵づくりと署名（ES256 の JWT）
//   ・本文の暗号化（aes128gcm）
//   ・送信
// Cloudflare Workers と Node 22 のどちらでも動く（テストは Node で行う）

const te = new TextEncoder();

export function b64u(bytes) {
  const b = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const concat = (...a) => {
  const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of a) {
    out.set(x, o);
    o += x.length;
  }
  return out;
};

// ---- VAPID ----
// 鍵を1組つくる。public は端末に渡す値（65バイトの生の点）、privateJwk はサーバーに保存する
export async function generateVapid() {
  const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", k.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", k.privateKey);
  return { publicKey: b64u(pub), privateJwk };
}

export async function vapidAuthorization(endpoint, vapid, subject) {
  const aud = new URL(endpoint).origin;
  const head = b64u(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(`${head}.${body}`)));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${vapid.publicKey}`;
}

// ---- 本文の暗号化（RFC 8291 / aes128gcm） ----
async function hkdf(salt, ikm, info, bytes) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8));
}

export async function encryptPayload(sub, payload) {
  const uaPublic = unb64u(sub.p256dh);
  const authSecret = unb64u(sub.auth);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(te.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const data = typeof payload === "string" ? te.encode(payload) : payload;
  if (data.length > 3000) throw new Error("payload too large");
  const plain = concat(data, new Uint8Array([2])); // 最後のレコードの印
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, plain));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// ---- 送信。HTTP のステータスを返す（404 / 410 は、その端末がもう無効） ----
export async function sendPush(sub, payload, vapid, subject, { ttl = 86400, urgency = "normal", fetchFn = fetch } = {}) {
  const body = await encryptPayload(sub, payload);
  const res = await fetchFn(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, vapid, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  });
  return res.status;
}

// 許可する配信元（端末のブラウザが教えてくる URL が、関係ないサーバーを指さないように）
const PUSH_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function endpointAllowed(endpoint, allowLocal = false) {
  let u;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  if (allowLocal && (u.hostname === "127.0.0.1" || u.hostname === "localhost")) return true;
  return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname)) && endpoint.length < 1000;
}
