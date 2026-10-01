// tama_key.js — たまごっち版のブラウザの鍵（D-93、D-20、D-38）。card-loop の web/hako_key.js の写しで、保存場所だけ分けた（旧サイトの hako_key_v1 と混ぜない）。
// 鍵はこのブラウザで作り、外に送らない。保存は localStorage の tama_key_v1（パスフレーズで暗号化。PBKDF2-SHA256 250,000 回 → AES-GCM）。
// 「このタブで覚える」を選んだときだけ、開いた鍵を sessionStorage（タブを閉じると消える）に置く。
export const KEY = "tama_key_v1", TAB_KEY = "tama_tab_key_v1";
const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const enc = new TextEncoder();
export const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64u = (bytes) => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function b58(bytes) {
  let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b);
  let s = ""; while (n > 0n) { s = ALPHA[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b === 0) s = "1" + s; else break; }
  return s;
}
export function didOf(pub) { const raw = new Uint8Array(34); raw[0] = 0xed; raw[1] = 0x01; raw.set(pub, 2); return "did:key:z" + b58(raw); }
export const short8 = (did) => String(did).slice(-8);
export async function supported() { try { return !!(await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])); } catch { return false; } }
async function kdf(pass, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function sealKey(priv, did, pass) {
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", priv));
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await kdf(pass, salt), pkcs8));
  return { v: 1, kind: "tama-key", did, kdf: { name: "PBKDF2-SHA256", iterations: 250000, salt: b64(salt) }, enc: { name: "AES-GCM", iv: b64(iv), ct: b64(ct) }, made: new Date().toISOString() };
}
export async function openKey(rec, pass) {
  const pkcs8 = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(rec.enc.iv) }, await kdf(pass, unb64(rec.kdf.salt)), unb64(rec.enc.ct));
  return crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, true, ["sign"]);
}
export function loadRec() { try { const s = localStorage.getItem(KEY); const j = s ? JSON.parse(s) : null; return j && j.did ? j : null; } catch { return null; } }
export function saveRec(rec) { try { localStorage.setItem(KEY, JSON.stringify(rec)); return true; } catch { return false; } }
/** ブラウザのパスワード保存で使う「ユーザー名」。どの HAKO のパスフレーズかが分かる名前（D-120） */
export const loginName = (did) => `HAKO …${short8(did)}`;
/** パスワード保存をすすめてもらう（対応しているブラウザだけ。Chrome など PasswordCredential を持つもの）。
 *  ほかのブラウザは、form の送信とそのあとの画面の切り替わりで、自分から保存をすすめる。ハコニワ側には何も残さない */
export async function offerSave(did, pass) {
  try { if (typeof PasswordCredential === "function" && navigator.credentials?.store) await navigator.credentials.store(new PasswordCredential({ id: loginName(did), password: pass, name: loginName(did) })); } catch { /* すすめないだけ */ }
}
export function isKeyFile(j) { return !!(j && j.kind === "tama-key" && j.did && j.kdf && j.enc); }
/** 鍵ファイル（暗号化されたまま）をダウンロードさせる */
export function downloadRec(rec) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(rec, null, 1)], { type: "application/json" }));
  a.download = `tama-key-${short8(rec.did).toLowerCase()}.json`; a.click();
}
export async function rememberTab(priv, did) { try { sessionStorage.setItem(TAB_KEY, JSON.stringify({ did, pkcs8: b64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", priv))) })); } catch { /* 覚えないだけ */ } }
export async function recallTab(did) {
  try { const j = JSON.parse(sessionStorage.getItem(TAB_KEY) || "null"); if (!j || j.did !== did) return null;
    return await crypto.subtle.importKey("pkcs8", unb64(j.pkcs8), { name: "Ed25519" }, true, ["sign"]); } catch { return null; }
}
// 開いているタブどうしで、覚えている鍵を渡す（同じブラウザの中だけ。どのタブも閉じれば消える。外には送らない）
const SHARE = "tama_key_share_v1";
/** ほかのタブが鍵を覚えていたら、このタブにも覚えさせる。もらえたら true */
export function askTabs(did, ms = 350) {
  return new Promise((resolve) => {
    let ch; try { ch = new BroadcastChannel(SHARE); } catch { return resolve(false); }
    const done = (v) => { try { ch.close(); } catch { /* 無視 */ } resolve(v); };
    ch.onmessage = (e) => {
      if (e.data?.t !== "have" || e.data.did !== did || !e.data.pkcs8) return;
      try { sessionStorage.setItem(TAB_KEY, JSON.stringify({ did, pkcs8: e.data.pkcs8 })); } catch { /* 覚えないだけ */ }
      done(true);
    };
    ch.postMessage({ t: "ask", did });
    setTimeout(() => done(false), ms);
  });
}
/** 覚えている鍵を、聞いてきたほかのタブへ渡す係 */
export function serveTabs() {
  try {
    const ch = new BroadcastChannel(SHARE);
    ch.onmessage = (e) => {
      if (e.data?.t !== "ask") return;
      try { const j = JSON.parse(sessionStorage.getItem(TAB_KEY) || "null"); if (j && j.did === e.data.did) ch.postMessage({ t: "have", did: j.did, pkcs8: j.pkcs8 }); } catch { /* 渡さないだけ */ }
    };
  } catch { /* 古いブラウザ: タブごとに開いてもらう */ }
}
export function forgetTab() { try { sessionStorage.removeItem(TAB_KEY); } catch { /* 無視 */ } }
/** 新しい鍵を作る → {priv, did, rec} */
export async function makeKey(pass) {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const did = didOf(pub);
  return { priv: kp.privateKey, did, rec: await sealKey(kp.privateKey, did, pass) };
}
/** 会場の署名の形で署名する: sign("<room>|<nonce>|<空白と制御文字を畳んだ text>") → base64url */
export const sweep = (s) => String(s).replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu, " ").trim();
export async function signLine(priv, room, nonce, text) { return b64u(new Uint8Array(await crypto.subtle.sign("Ed25519", priv, enc.encode(`${room}|${nonce}|${sweep(text)}`)))); }
