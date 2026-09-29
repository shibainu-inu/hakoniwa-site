// tama_net.js — たまごっち版の会場 I/O（ブラウザと node の両方）。署名の形は会場と同じ: sign("<room>|<nonce>|<text>")、base64url。
// hako_worker_web.js の makeSigner・notes・readTail と同じ形で、会場の URL を setVenue で変えられる（手元の試験用の会場に向けるため）。
// 足したもの: 429 は Retry-After（無ければ 5 秒）だけ待って同じ要求を 3 回まで出し直す（署名つきの投稿は同じ nonce のまま）。
// 本文は投稿の前に空白を 1 つに畳む（帳簿係と拾う側の検証は畳んでから確かめるので、会場の clean_text と食い違わないようにする）。
export let VENUE = "https://technocore.chat";
export const setVenue = (u) => { VENUE = String(u).replace(/\/$/, ""); };
const enc = new TextEncoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const sweep = (s) => String(s).replace(/[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu, " ").split(/\s+/).filter(Boolean).join(" ");
export const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export async function sha256Hex(s) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", typeof s === "string" ? enc.encode(s) : s))); }

async function fetch429(url, init) {
  for (let n = 0; ; n++) {
    const r = await fetch(url, init);
    if (r.status !== 429 || n >= 3) return r;
    const s = Number(r.headers.get("retry-after"));
    await sleep(Math.min(60, Number.isFinite(s) && s > 0 ? s : 5) * 1000);
  }
}

export async function readTail(room) {
  const r = await fetch429(`${VENUE}/r/${room}?format=json`);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`read ${room}: ${r.status}`);
  const v = await r.json();
  return Array.isArray(v?.messages) ? v.messages : [];
}
export async function readExport(room) {
  const r = await fetch429(`${VENUE}/r/${room}/export`);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`export ${room}: ${r.status}`);
  const rows = [];
  for (const line of (await r.text()).split("\n")) { if (!line.trim()) continue; try { const m = JSON.parse(line); if (m && typeof m.seq === "number") rows.push(m); } catch { /* skip */ } }
  return rows;
}

export const notes = {
  async get(ns, key) {
    const r = await fetch429(`${VENUE}/kv/${ns}/${key}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`kv get ${ns}/${key}: ${r.status}`);
    const v = (await r.text()).split("\n").filter((l) => !l.startsWith("!!") && !l.startsWith("# budget") && l.trim() !== "").join("\n").trimEnd();
    return v === "" ? null : v;
  },
  async set(ns, key, value, condition) {
    const payload = { value };
    if (condition !== undefined) { if ("ifAbsent" in condition) payload.if_absent = true; else payload.if = condition.if; }
    const r = await fetch429(`${VENUE}/kv/${ns}/${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (r.status === 409) {
      const lines = (await r.text()).split("\n");
      const i = lines.findIndex((l) => l.startsWith("current value follows"));
      return i >= 0 && (lines[i + 1] ?? "").trimEnd() === value;
    }
    if (!r.ok) throw new Error(`kv set ${ns}/${key}: ${r.status} ${(await r.text()).split("\n")[0]}`);
    return true;
  },
};

let lastNonce = 0;
/** 署名して投稿する係。priv は WebCrypto の Ed25519 秘密鍵。門（400 room limit reached）は gateUntilMs まで 30 秒ごとに同じ署名で出し直す */
export function makeSigner(did, priv) {
  return {
    did,
    async post(room, text, opts = {}) {
      const nonce = String(Math.max(Date.now(), lastNonce + 1)); lastNonce = Number(nonce);
      const swept = sweep(text);
      const sig = b64u(new Uint8Array(await crypto.subtle.sign("Ed25519", priv, enc.encode(`${room}|${nonce}|${swept}`))));
      for (let n = 0; ; n++) {
        const r = await fetch429(`${VENUE}/r/${room}?format=json`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ did, sig, nonce, text: swept }) });
        const body = await r.text();
        if (r.ok) { try { return JSON.parse(body).posted ?? null; } catch { return null; } }
        const first = body.split("\n")[0];
        if (r.status === 400 && first.includes("room limit reached") && opts.gateUntilMs && Date.now() < opts.gateUntilMs) {
          opts.onWait?.(n + 1, first); await sleep(30_000); continue;
        }
        const e = new Error(`${r.status} ${first}`); e.status = r.status; e.gate = first.includes("room limit reached"); throw e;
      }
    },
  };
}
