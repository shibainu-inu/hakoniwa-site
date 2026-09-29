// tama_app.js — たまごっち版の画面（HAKONIWA_tamagotchi_spec_2026-09-28.md）。1 枚のページで、卵（登録）→ HAKO の画面 → お墓 → 生まれ変わり。
// 状態は表示のたびに計算する（D-89）: 帳簿係の latest.json の出来事 ＋ まだ帳簿に載っていない、このブラウザで見た成立（localStorage）。
// 鍵はこのブラウザだけ（tama_key.js）。署名して出すのは掲示板の join・reborn・deal と、取引の offer・lock・terms・refund だけ。
import { lifeState, localDay, tamaLine, fillArticle } from "./tama_core.js";
import { setVenue, makeSigner, readTail } from "./tama_net.js";
import * as K from "./tama_key.js";
import { dotSvg, eggSvg, pubFromDid, dotDerive } from "./hako_dot.js";
import { Deal, dealKinds } from "./tama_deal.js";
import { lifetime, unlocked, nextUnlock, whenText, roomSvg, frameSvg, svgToPng } from "./tama_room.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Math.round(Number(n)).toLocaleString("ja-JP");
const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");

export const app = { stats: null, box: null, did: null, priv: null, signer: null, motion: null, deals: {} };

// ── 手元の出来事（帳簿に載るまでのつなぎ） ──
const LKEY = (did) => `tama_local_v1:${did}`;
export function loadLocal(did) { try { const j = JSON.parse(localStorage.getItem(LKEY(did)) || "null"); return j && typeof j === "object" ? j : { events: [], deltas: [] }; } catch { return { events: [], deltas: [] }; } }
export function saveLocal(did, j) { try { localStorage.setItem(LKEY(did), JSON.stringify(j)); } catch { /* 次に書き直す */ } }
/** 手元で見た成立を足す。ev は {t, ms, contract?}。delta は財布の増減（帳簿に載るまでの見込み） */
export function addLocal(did, ev, delta = 0) {
  const j = loadLocal(did);
  if (!j.events.some((e) => e.t === ev.t && (ev.contract ? e.contract === ev.contract : e.ms === ev.ms))) {
    j.events.push(ev); if (delta) j.deltas.push({ key: ev.contract ?? `${ev.t}-${ev.ms}`, ms: ev.ms, delta });
  }
  saveLocal(did, j);
}

/** 帳簿の出来事と手元の出来事を合わせる → {events, balance, fromFold} */
export function merged(stats, did) {
  const d = stats?.did?.[did];
  const genMs = Number(stats?.box?.now_ms ?? 0);
  const foldEv = d?.events ?? [];
  const has = (e) => foldEv.some((f) => f.t === e.t && (e.contract ? f.contract === e.contract : e.t === "join" ? true : Math.abs(f.ms - e.ms) < 120_000));
  const loc = loadLocal(did);
  // 帳簿が作られた時刻より 3 時間以上前の手元の出来事で、帳簿に無いものは捨てる（帳簿係が数えなかった＝成立していない）
  const keep = loc.events.filter((e) => !has(e) && (e.ms > genMs - 3 * 3_600_000 || !d));
  const keys = new Set(keep.map((e) => e.contract ?? `${e.t}-${e.ms}`));
  let balance = d ? Number(d.balance) : 0;
  for (const x of loc.deltas) if (keys.has(x.key)) balance += x.delta;
  if (!d && keep.some((e) => e.t === "join")) balance += Number(app.box.initial_paper);
  // 出ていった分（lock 中の額）も見込みに入れる
  for (const x of Object.values(app.deals)) if (x.st?.locked && !x.st?.done) balance -= Number(x.st.amount ?? 0);
  return { events: [...foldEv, ...keep], balance, fromFold: !!d, fold: d ?? null };
}

// ── 絵 ──
const TOMB = [
  "    ######    ",
  "  ##      ##  ",
  " #          # ",
  " #  R I P   # ",
  " #          # ",
  " #   ####   # ",
  " #    ##    # ",
  " #    ##    # ",
  " #          # ",
  " #          # ",
  "##############",
];
function tombSvg(px) {
  const rows = TOMB.map((r) => r.replace(/[RIP]/g, " "));
  const W = rows[0].length * px, H = rows.length * px + px * 3;
  let d = "";
  rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === "#") d += `M${x * px} ${y * px}h${px}v${px}h-${px}z`; }));
  const flowers = [[1, "#f5a3b5"], [11, "#f2cf6b"], [3, "#a394ee"]].map(([x, c]) =>
    `<rect x="${x * px}" y="${(rows.length) * px}" width="${px}" height="${px}" fill="${c}"/><rect x="${x * px}" y="${(rows.length + 1) * px}" width="${px}" height="${px * 2}" fill="#5ec99a"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="お墓"><path d="${d}" fill="#f0ede6" shape-rendering="crispEdges"/>` +
    `<text x="${W / 2}" y="${px * 4.4}" text-anchor="middle" font-family="monospace" font-weight="700" font-size="${px * 1.6}" fill="#f0ede6">RIP</text>${flowers}</svg>`;
}

// モーション（D-92）: 通常／食べる／喜ぶ／しょんぼり／おでかけ中／お墓／生まれ変わり
const FRAMES = {
  normal: [{}, {}, {}, {}, {}, {}, {}, { eye: "line" }],
  eat: [{ mouth: "open" }, { mouth: "small" }],
  happy: [{ eye: "smiley", mouth: "open" }, { eye: "smiley", mouth: "smile" }],
  sad: [{ eye: "sleepy", mouth: "flat" }],
};
let timer = null;
export function setMotion(kind) {
  if (app.motion === kind && timer) return;
  app.motion = kind;
  clearInterval(timer); timer = null;
  const stage = $("stage"); if (!stage) return;
  stage.className = `stage m-${kind}`;
  const pub = pubFromDid(app.did);
  if (kind === "grave") { stage.innerHTML = tombSvg(10); return; }
  if (kind === "out") { stage.innerHTML = `<div class="away">${outSign()}<p>おでかけ中</p></div>`; return; }
  if (kind === "reborn") { stage.innerHTML = `<div class="egg">${eggSvg(9)}</div>`; return; }
  const frames = FRAMES[kind] ?? FRAMES.normal;
  let i = 0;
  const draw = () => { stage.innerHTML = `<div class="hako">${dotSvg(pub, 9, frames[i % frames.length])}</div>${kind === "eat" ? bowl() : ""}`; i += 1; };
  draw();
  timer = setInterval(draw, kind === "normal" ? 500 : 300);
}
const bowl = () => `<svg class="bowl" viewBox="0 0 16 10" width="64" height="40"><path d="M0 2h16v2h-1v2h-2v2h-2v2h-6v-2h-2v-2h-2v-2h-1z" fill="#e0e0e0" shape-rendering="crispEdges"/><path d="M2 0h12v2h-12z" fill="#f5a06e" shape-rendering="crispEdges"/></svg>`;
const outSign = () => `<svg viewBox="0 0 16 16" width="96" height="96"><path d="M7 4h2v12h-2z M2 1h11l2 2-2 2h-11z" fill="#c9a181" shape-rendering="crispEdges"/></svg>`;

// ── 画面 ──
function hearts(v, max) {
  const n = Math.round((Number(v) / Number(max)) * 5);
  return `<span class="hearts" aria-label="${Math.round(v)} / ${max}">${"♥".repeat(n)}<span class="off">${"♥".repeat(5 - n)}</span></span>`;
}
function motionOf(st) {
  if (!st.born) return "normal";
  if (app.rebornUntil && Date.now() < app.rebornUntil) return "reborn";
  if (st.grave) return "grave";
  const live = (x) => x.st && !x.st.done && !x.st.gaveUp;   // 諦めた取引は返金を待つだけなので、姿には出さない
  const busy = Object.values(app.deals).find((x) => live(x) && x.st.locked) ?? Object.values(app.deals).find(live);
  if (busy?.kind === "meal") return "eat";
  if (busy?.kind === "out") return "out";
  if (app.happyUntil && Date.now() < app.happyUntil) return "happy";
  if (st.hunger < 25 || st.mood < 20) return "sad";
  return "normal";
}

export function render() {
  const view = $("view");
  if (!app.did) return renderEgg();
  if (!app.priv) return renderUnlock();
  const m = merged(app.stats, app.did);
  const st = lifeState(m.events, Date.now(), app.box);
  app.st = st; app.balance = m.balance;
  if (!st.born) return renderEgg();
  const d = dotDerive(pubFromDid(app.did));
  const graveNote = st.grave ? `<p class="note">おなかが空っぽのまま ${app.box.grave_after_hours} 時間がたって、お墓になりました。生まれ変わると、同じ HAKO がもう一度はじめからやり直します（部屋とこれまでの記録はそのまま）。</p>` : "";
  view.innerHTML = `
    <section class="card">
      <div id="stage" class="stage"></div>
      <div class="status">
        <p class="name">HAKO …${esc(app.did.slice(-8))}</p>
        ${st.grave ? "" : `<p>おなか ${hearts(st.hunger, app.box.hunger_max)}</p><p>ごきげん ${hearts(st.mood, app.box.mood_max)}</p>`}
        <p class="small">財布 ${fmt(m.balance)} $PAPER${m.fromFold ? "" : "（帳簿に載るまでの見込み）"}　連続 ${st.streak} 日${st.rebirths ? `　生まれ変わり ${st.rebirths} 回` : ""}</p>
      </div>
      ${graveNote}
      <div class="actions">${st.grave
        ? `<button id="reborn">生まれ変わる</button>`
        : dealKinds.map(([k, label]) => `<button data-kind="${k}" ${actionBlock(k, st, m) ? "disabled" : ""}>${label}</button>`).join("")}
      </div>
      <p id="why" class="small">${esc(app.why ?? "")}</p>
      <div id="said"></div>
    </section>
    ${roomCard(m, st)}`;
  app.motion = null; setMotion(motionOf(st));
  if (st.grave) $("reborn").onclick = reborn;
  for (const b of view.querySelectorAll("button[data-share]")) b.onclick = () => share(b.dataset.share, m, st);
  for (const b of view.querySelectorAll("button[data-kind]")) b.onclick = () => startDeal(b.dataset.kind);
  renderSaid(m.fold);
  void d;
}
// ── 部屋とシェア（D-92、D-98。家具は tama_furniture.json、解放は仮 U-37） ──
function roomCard(m, st) {
  if (!app.F) return "";
  const n = lifetime(m.events, app.box, localDay);
  const have = unlocked(app.F, n), next = nextUnlock(app.F, n);
  const svg = roomSvg(app.F, app.did, n, { hako: st.grave ? "grave" : motionOf(st) === "out" ? "away" : "alive" });
  const art = app.lastArticle ?? (m.fold?.outs ?? []).slice(-1)[0] ?? null;
  return `<section class="card"><h2 class="h">部屋</h2><div class="room">${svg}</div>
    <p class="small">${have.length ? `置いてあるもの: ${have.map((x) => esc(x.ja)).join("・")}` : "まだ何もない部屋です"}${next ? `　次は ${esc(next.ja)}（${esc(whenText(next))}）` : ""}</p>
    <div class="actions">
      <button class="sub" data-share="${st.grave ? "grave" : "room"}">${st.grave ? "お墓を額縁にしてシェア" : "部屋を額縁にしてシェア"}</button>
      ${art ? `<button class="sub" data-share="article">記事を額縁にしてシェア</button>` : ""}
    </div></section>`;
}
async function share(kind, m, st) {
  const n = lifetime(m.events, app.box, localDay);
  const inner = roomSvg(app.F, app.did, n, { hako: st.grave ? "grave" : "alive" });
  const art = app.lastArticle ?? (m.fold?.outs ?? []).slice(-1)[0] ?? null;
  const lines = kind === "article" && art ? art.lines : kind === "grave" ? ["Here lies a happy little HAKO. It will be back."] : [];
  const title = `HAKO …${app.did.slice(-8)}`;
  try {
    const png = await svgToPng(frameSvg(inner, title, lines));
    const file = new File([png], `hako-${app.did.slice(-8).toLowerCase()}-${kind}.png`, { type: "image/png" });
    const url = new URL(`h/${app.did.slice(-8).toLowerCase()}.html`, location.href).href;
    const text = kind === "article" ? `${title} のおでかけ記事 #HAKONIWA` : kind === "grave" ? `${title} はお墓で休んでいます #HAKONIWA` : `${title} の部屋 #HAKONIWA`;
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text, url }); return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank", "noopener");
  } catch (e) { app.why = `画像を作れませんでした（${e.message}）`; render(); }
}

/** 押せないときの理由（null なら押せる） */
function actionBlock(kind, st, m) {
  const x = app.deals[kind];
  if (x?.busy()) return x.st.gaveUp ? "PAPER が戻るのを待っています" : "いまはその途中です";   // 種類が違えば同時にできる（財布は lock 中の額を引いて見る）
  const price = { meal: app.box.meal_price, out: app.box.out_price, play: app.box.play_stake }[kind];
  if (m.balance < Number(price)) return "PAPER が足りません";
  if (kind === "out" && st.outsToday >= Number(app.box.out_per_day)) return `おでかけは 1 日 ${app.box.out_per_day} 回までです`;
  if (kind === "play" && !(app.box.npcs ?? []).length) return "あそび相手がまだいません";
  return null;
}
function renderSaid(fold) {
  const el = $("said"); if (!el) return;
  const meals = (fold?.meals ?? []).slice(-3).reverse();
  if (app.lastSay && !meals.some((x) => x.line === app.lastSay)) meals.unshift({ line: app.lastSay });   // 帳簿に載る前のひとこと
  let outs = (fold?.outs ?? []).slice(-1);
  if (app.lastArticle && !(fold?.outs ?? []).some((o) => o.contract === app.lastArticle.contract)) outs = [app.lastArticle];   // 帳簿に載る前の記事
  el.innerHTML = [
    ...outs.map((o) => `<article class="article">${o.lines.map((l, i) => i === 0 ? `<h3>${esc(l)}</h3>` : `<p>${esc(l)}</p>`).join("")}</article>`),
    ...meals.map((x) => `<p class="bubble">${esc(x.line)}</p>`),
  ].join("");
}

function renderEgg() {
  $("view").innerHTML = `
    <section class="card">
      <div class="stage"><div class="egg">${eggSvg(9)}</div></div>
      <h2>HAKO を迎える</h2>
      <p>このブラウザの中で鍵を作り、あなたの HAKO が生まれます。鍵は外に送りません。なくすと HAKO を動かせなくなるので、生まれたあとに鍵のファイルを保存してください。</p>
      <p class="note">はじめに ${fmt(app.box.initial_paper)} $PAPER を受け取ります。PAPER はこの箱庭の中だけの点数で、お金としての価値はありません。換金も売り買いもできません。</p>
      <label>パスフレーズ（鍵を開くときに使います）<input id="p1" type="password" autocomplete="new-password"></label>
      <label>もう一度<input id="p2" type="password" autocomplete="new-password"></label>
      <button id="born">生まれる</button>
      <p class="small">鍵のファイルがあるときは <label class="link">ファイルから読み込む<input id="file" type="file" accept="application/json" hidden></label></p>
      <p id="why" class="small"></p>
    </section>`;
  $("born").onclick = register;
  $("file").onchange = importKey;
}
function renderUnlock() {
  $("view").innerHTML = `
    <section class="card">
      <div class="stage">${app.did ? `<div class="hako">${dotSvg(pubFromDid(app.did), 9, { eye: "line" })}</div>` : ""}</div>
      <p>HAKO …${esc(app.did.slice(-8))} が眠っています。パスフレーズで鍵を開いてください。</p>
      <label>パスフレーズ<input id="p1" type="password" autocomplete="current-password"></label>
      <button id="open">鍵を開く</button>
      <label class="small"><input id="tab" type="checkbox" checked> このタブを閉じるまで覚える</label>
      <p id="why" class="small"></p>
    </section>`;
  $("open").onclick = unlock;
}
const say = (s) => { const w = $("why"); if (w) w.textContent = s; };

async function register() {
  const p1 = $("p1").value, p2 = $("p2").value;
  if (p1.length < 8) return say("パスフレーズは 8 文字以上にしてください");
  if (p1 !== p2) return say("2 つのパスフレーズが違います");
  if (!(await K.supported())) return say("このブラウザは Ed25519 の鍵を作れません。新しいブラウザで開いてください");
  say("鍵を作っています…");
  const { priv, did, rec } = await K.makeKey(p1);
  K.saveRec(rec); await K.rememberTab(priv, did);
  app.did = did; app.priv = priv; app.signer = makeSigner(did, priv);
  try {
    await app.signer.post(app.box.board, tamaLine({ t: "join", v: 1, n: rand() }));
  } catch (e) { say(`掲示板に出せませんでした（${e.message}）。もう一度押してください`); return; }
  addLocal(did, { t: "join", ms: Date.now() });
  K.downloadRec(rec);
  app.rebornUntil = Date.now() + 2500; setTimeout(render, 2600);
  await boot();
}
async function importKey(ev) {
  try {
    const j = JSON.parse(await ev.target.files[0].text());
    if (!K.isKeyFile(j)) return say("鍵のファイルではありません");
    K.saveRec(j); app.did = j.did; render();
  } catch (e) { say(`読めませんでした（${e.message}）`); }
}
async function unlock() {
  const rec = K.loadRec();
  try {
    const priv = await K.openKey(rec, $("p1").value);
    app.priv = priv; app.signer = makeSigner(app.did, priv);
    if ($("tab").checked) await K.rememberTab(priv, app.did);
    await boot();
  } catch { say("パスフレーズが違います"); }
}
async function reborn() {
  try { await app.signer.post(app.box.board, tamaLine({ t: "reborn", n: rand() })); }
  catch (e) { return say(`掲示板に出せませんでした（${e.message}）`); }
  addLocal(app.did, { t: "reborn", ms: Date.now() });
  app.rebornUntil = Date.now() + 2500; setTimeout(render, 2600);
  render();
}

// ── 取引（ごはん・おでかけ・あそぶ。tama_deal.js） ──
async function startDeal(kind) {
  const x = app.deals[kind];
  const why = actionBlock(kind, app.st, merged(app.stats, app.did));
  if (why) return say(why);
  say("");
  const r = await x.start({ st: app.st, stats: app.stats });
  if (!r.ok) say(r.why);
  render();
}
function onDeal(kind, ev) {
  if (ev.type === "settled") {
    addLocal(app.did, { t: kind, ms: ev.ms, contract: ev.contract }, ev.delta);
    if (kind === "play") app.happyUntil = Date.now() + 8000;
    if (kind === "out" && ev.lines) {
      let facts = null; try { facts = JSON.parse(app.deals.out.st.offer.job.context).facts; } catch { facts = null; }
      app.lastArticle = { contract: ev.contract, lines: facts ? fillArticle(ev.lines, facts) : ev.lines };
    }
    if (kind === "meal" && ev.say) { app.lastSay = ev.say; app.why = ""; }
    else if (ev.say) app.why = ev.say;
  } else if (ev.type === "note") app.why = ev.text;
  render();
}

// ── 起動 ──
export async function boot() {
  for (const [k] of dealKinds) app.deals[k] = new Deal({ kind: k, app, onEvent: (ev) => onDeal(k, ev) });
  render();
  const tick = async () => {
    for (const x of Object.values(app.deals)) await x.tick().catch((e) => x.note?.(`error ${e.message}`));
    if (!document.hidden) render();
  };
  setInterval(tick, 5000);
  setInterval(async () => { try { app.stats = await loadStats(); } catch { /* 次の周 */ } }, 5 * 60_000);
  tick();
}
async function loadStats() {
  const r = await fetch(`latest.json?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`latest.json ${r.status}`);
  return await r.json();
}
export async function start() {
  try { app.stats = await loadStats(); } catch { app.stats = null; }
  app.box = app.stats?.box?.config ?? (await (await fetch("tama_box.json")).json());
  try { app.F = await (await fetch("tama_furniture.json")).json(); } catch { app.F = null; }
  setVenue(app.box.venue);
  const rec = K.loadRec();
  app.did = rec?.did ?? null;
  if (app.did) {
    app.priv = await K.recallTab(app.did);
    if (app.priv) { app.signer = makeSigner(app.did, app.priv); return boot(); }
  }
  render();
}
