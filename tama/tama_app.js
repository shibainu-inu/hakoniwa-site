// tama_app.js — たまごっち版の画面（HAKONIWA_tamagotchi_spec_2026-09-28.md）。1 枚のページで、卵（登録）→ 卵からひび、HAKO へ育つ画面 → お墓（幽霊）→ 生まれ変わり。
// 状態は表示のたびに計算する（D-89）: 帳簿係の latest.json の出来事 ＋ まだ帳簿に載っていない、このブラウザで見た成立（localStorage）。
// 鍵はこのブラウザだけ（tama_key.js）。署名して出すのは掲示板の join・reborn・deal と、取引の offer・lock・terms・refund だけ。
import { lifeState, localDay, tamaLine, fillArticle, rewardOf, sitSchedule, sitWhy, HOUR } from "./tama_core.js";
import { spriteSvg, spriteRows } from "./tama_sprite.js";
import { L, getLang, setLang } from "./tama_i18n.js";
import { setVenue, makeSigner, readTail } from "./tama_net.js";
import * as K from "./tama_key.js";
import { Deal, SitDeal, slotKind, dealKinds } from "./tama_deal.js";
import { lifetime, unlocked, nextUnlock, whenText, roomSvg, artSvg, frameSvg, scrapSvg, svgToPng, spot, HAKO_PX } from "./tama_room.js";
import { renderGarden } from "./tama_garden.js";
import { pickPhrase, phraseText } from "./tama_phrases.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Math.round(Number(n)).toLocaleString("ja-JP");
const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");

export const app = { stats: null, box: null, did: null, priv: null, signer: null, motion: null, deals: {}, sits: [] };

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
  for (const x of [...Object.values(app.deals), ...(app.sits ?? [])]) if (x.st?.locked && !x.st?.done) balance -= Number(x.st.amount ?? 0);
  return { events: [...foldEv, ...keep], balance, fromFold: !!d, fold: d ?? null };
}

// ── 絵 ──
// モーション（D-92）: 通常／食べる／喜ぶ／しょんぼり／おでかけ中／お墓／生まれ変わり
const FRAMES = {
  normal: [{}],
  eat: [{ mouth: "open" }, { mouth: "small" }],
  happy: [{ eye: "smiley", mouth: "open" }, { eye: "smiley", mouth: "smile" }],
  sad: [{ eye: "sleepy", mouth: "flat" }],
};
// ── 会場に出した行を、部屋のすみに小さく出す（D-113）。署名して投稿した本文から、決まった欄だけを抜く。鍵と署名は出さない ──
const SHOW = ["type", "t", "kind", "amount", "asset", "rail", "contract"];   // 出してよい欄だけ
const short = (x) => (String(x).length > 14 ? `${String(x).slice(0, 6)}…${String(x).slice(-4)}` : String(x));
/** 投稿した 1 行 → 表示の 1 行（例: tclk1 offer · 240 PAPER → /r/tclk-offers）。読めない本文は種類だけ */
export function opLine(room, text) {
  const sp = String(text).indexOf(" "), proto = sp > 0 ? String(text).slice(0, sp) : "post";
  let o = null; try { o = JSON.parse(String(text).slice(sp + 1)); } catch { o = null; }
  const parts = [];
  if (o && typeof o === "object") {
    const pick = Object.fromEntries(SHOW.filter((k) => o[k] != null).map((k) => [k, o[k]]));
    parts.push(String(pick.type ?? pick.t ?? "line"));
    if (pick.kind) parts.push(String(pick.kind));
    if (pick.amount) parts.push(`${pick.amount} ${pick.asset ?? ""}`.trim());
    if (pick.rail) parts.push(String(pick.rail));
    if (pick.contract) parts.push(short(pick.contract));
  }
  return `${proto} ${parts.join(" · ")} → /r/${String(room).length > 22 ? String(room).slice(0, 21) + "…" : room}`;
}
function logOp(line) { app.ops = [...(app.ops ?? []), { line, at: Date.now() }].slice(-3); showOps(); }
function showOps() { const el = $("ops"), h = opsHtml(); if (el && app.opsShown !== h) { el.innerHTML = h; app.opsShown = h; } }
const opsHtml = () => (app.ops ?? []).map((x) => `<span class="${Date.now() - x.at > 12000 ? "old" : ""}">› ${esc(x.line)}</span>`).join("");
/** 署名して投稿する係に、表示を足す（投稿そのものは変えない） */
function watched(signer) {
  const post = signer.post.bind(signer);
  signer.post = async (room, text, opts) => { logOp(opLine(room, text)); return post(room, text, opts); };
  return signer;
}
// ── 待っている間の表示（探す → 預ける → 届くのを待つ）。小さな札が、いまの段の上で跳ねる ──
const waitOf = (stage) => ({ offering: [0, L("相手を探しています", "Looking for a taker")], offered: [0, L("相手を探しています", "Looking for a taker")], locking: [1, L("PAPER を預けています", "Locking PAPER")] }[stage] ?? [2, L("届くのを待っています", "Waiting for delivery")]);
function waitHtml() {
  const live = (x) => x.st && !x.st.done;
  const x = Object.values(app.deals).find((d) => live(d) && d.st.locked) ?? Object.values(app.deals).find(live);
  if (!x) return "";
  const [step, label] = x.st.gaveUp ? [2, L("PAPER が戻るのを待っています", "Waiting for the PAPER to come back")] : waitOf(x.st.stage);
  return `<div class="wait" role="status"><span class="track" style="--s:${step}">${[0, 1, 2].map((k) => `<i class="${k < step ? "done" : k === step ? "now" : ""}"></i>`).join("")}<b class="coin"></b></span>` +
    `<span>${label}</span><span class="dots"><i></i><i></i><i></i></span></div>`;
}

// ── 動き（D-112）。ドット絵のまま、見ていて落ち着く動きにする ──
//   呼吸: 1 周およそ 4 秒（安静時の呼吸の速さ）。吸う 4 割・吐く 6 割。縦に 6% ほど伸び、そのぶん横を縮めて体積を保つ。吸うたびに左右へ少し傾く
//   （はじめは伸びが 3% 弱で、スマホでは 1〜2px しか動かず見えなかった。見える大きさにした）
//   ゆらぎ: 周期と大きさを毎回少し変える（1/f ゆらぎ。同じ動きの繰り返しにしない）
//   跳ね: 呼吸 2〜4 回に 1 回、体の高さの 3 割ほど。しゃがむ（予備動作）→ 伸びて上がる → 頂点でゆっくり（重力に合う動き）→ 着地でつぶれる → 小さく戻る（余韻）
//   近づく: ごくまれに、床の上をゆっくり歩いてきて窓の下枠の下に隠れ、跳ねて窓からのぞき、歩いて戻る
//   まばたき: 2〜6 秒に 1 回、不規則に。1 回 0.16 秒。ときどき 2 回続ける
let timer = null, live = 0;
const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
/** 1/f に近いゆらぎ（Voss の方法: 1・2・4・8 回ごとに引き直す乱数の平均）。-1〜1 */
function pink() {
  let n = 0; const v = [0, 0, 0, 0];
  return () => { n += 1; for (let k = 0; k < 4; k++) if (n % (1 << k) === 0 || n === 1) v[k] = Math.random() * 2 - 1; return (v[0] + v[1] + v[2] + v[3]) / 4; };
}
const SINE = "cubic-bezier(.37,0,.63,1)";
function hopOnce(fig, shadow, h) {
  const up = `translateY(${-h * 100}%)`;
  const a = fig.animate([
    { transform: "translateY(0) scale(1,1)", easing: "cubic-bezier(.3,0,.6,1)" },
    { offset: 0.2, transform: "translateY(0) scale(1.06,.93)", easing: "cubic-bezier(.2,.7,.4,1)" },   // 予備動作
    { offset: 0.52, transform: `${up} scale(.97,1.04)`, easing: "cubic-bezier(.6,0,.85,.4)" },        // 頂点（上りは減速、下りは加速）
    { offset: 0.76, transform: "translateY(0) scale(1.08,.91)", easing: "cubic-bezier(.3,.6,.4,1)" },  // 着地のつぶれ
    { offset: 0.9, transform: "translateY(0) scale(.985,1.02)", easing: SINE },                         // 余韻
    { transform: "translateY(0) scale(1,1)" }], { duration: 1150 });
  shadow?.animate([{ transform: "scaleX(1)", opacity: 1 }, { offset: 0.2, transform: "scaleX(1.06)", opacity: 1 }, { offset: 0.52, transform: `scaleX(${Math.max(0.45, 1 - h * 1.2)})`, opacity: 0.5 },
    { offset: 0.76, transform: "scaleX(1.08)", opacity: 1 }, { transform: "scaleX(1)", opacity: 1 }], { duration: 1150 });
  return a.finished.catch(() => {});
}
/** めったにしない動き: 窓（部屋の枠）の向こうから、床の上をゆっくりこちらへ歩いてくる。
 *  近づくほど大きくなり、背が低いので窓の下枠の下へ沈んで見えなくなる。すぐ手前まで来たら、跳ねて窓からこちらをのぞく（2 回。2 回目は高く、左右を見る）。
 *  そのあと、来た道を歩いて戻る。HAKO のときは、のぞく間だけ目を丸くする */
function approach(fig, shadow, face) {
  const S = 2.6, FAR = 400, T = 16000;   // 手前での大きさ、窓の下に隠れる深さ（体の高さの %）、全体の長さ
  const smooth = (x) => x * x * (3 - 2 * x);
  const pose = (p, up = 0, rot = 0) => `translateY(${(FAR * p - up).toFixed(1)}%) rotate(${rot}deg) scale(${(1 + (S - 1) * p).toFixed(3)})`;
  const walk = (from, ms, dir) => Array.from({ length: 25 }, (_, i) => {   // 歩く: 少しずつ弾みながら、床に沿って進む
    const x = i / 24, p = dir > 0 ? smooth(x) : 1 - smooth(x);
    return { offset: (from + ms * x) / T, transform: pose(p, Math.abs(Math.sin(x * Math.PI * 9)) * 7 * (1 + (S - 1) * p)), easing: "linear" };
  });
  const UP = "cubic-bezier(.2,.7,.4,1)", DOWN = "cubic-bezier(.6,0,.85,.4)";
  const frames = [
    ...walk(0, 6000, 1),                                                   // 0〜6 秒: 歩いてくる（だんだん下枠に隠れる）
    { offset: 6800 / T, transform: pose(1), easing: UP },                   // 下枠の下で、ひと呼吸
    { offset: 7150 / T, transform: pose(1, 155), easing: "linear" },        // 1 回目: 跳ねて、目の高さまで
    { offset: 7600 / T, transform: pose(1, 148), easing: DOWN },
    { offset: 7950 / T, transform: pose(1), easing: "linear" },
    { offset: 8600 / T, transform: pose(1), easing: UP },
    { offset: 8950 / T, transform: pose(1, 225, -5), easing: SINE },        // 2 回目: 高く跳ねて（口まで見える）、左右を見る
    { offset: 9450 / T, transform: pose(1, 216, 5), easing: SINE },
    { offset: 9900 / T, transform: pose(1, 210, 0), easing: DOWN },
    { offset: 10250 / T, transform: pose(1), easing: "linear" },
    ...walk(10800, 5200, -1),                                              // 歩いて戻る
  ];
  frames[frames.length - 1].offset = 1;
  const a = fig.animate(frames, { duration: T });
  shadow?.animate([{ transform: "translateY(0) scale(1)" }, { offset: 6000 / T, transform: `translateY(${FAR * 10}%) scale(${S})` }, { offset: 10800 / T, transform: `translateY(${FAR * 10}%) scale(${S})` }, { transform: "translateY(0) scale(1)" }], { duration: T });
  fig.closest(".pos")?.querySelector(".say")?.classList.remove("on");
  const alive = () => fig.isConnected && a.playState === "running";
  setTimeout(() => { if (alive()) face?.({ eye: "round" }); }, 6600);
  setTimeout(() => { if (alive()) face?.({}); }, 10400);
  return a.finished.catch(() => {});
}
/** 通常（呼吸と、ときどきの小さな跳ね。ごくまれに近づいてくる）と、喜ぶ（呼吸 1 回ごとに跳ねる） */
function idle(fig, shadow, happy, face = null) {
  const my = live, noise = pink();
  let untilHop = happy ? 1 : 2 + Math.floor(Math.random() * 2), side = 1;
  const breath = () => {
    if (my !== live || !fig.isConnected) return;
    const dur = (happy ? 1600 : 4200) * (1 + 0.18 * noise()), amp = 0.06 * (1 + 0.3 * noise()), lean = 1.6 * side * (1 + 0.4 * noise());
    side = -side;   // 息を吸うたびに、左右へ交互に少し傾く（ゆれ）
    const a = fig.animate([{ transform: "rotate(0deg) scale(1,1)", easing: SINE }, { offset: 0.4, transform: `rotate(${lean}deg) scale(${1 - amp * 0.8},${1 + amp})`, easing: SINE }, { transform: "rotate(0deg) scale(1,1)" }], { duration: dur });
    shadow?.animate([{ transform: "scaleX(1)", opacity: 1 }, { offset: 0.4, transform: "scaleX(.96)", opacity: 0.85 }, { transform: "scaleX(1)", opacity: 1 }], { duration: dur });
    a.finished.then(() => {
      if (my !== live) return;
      if (!happy && (app.peekNow || Math.random() < 0.04)) { app.peekNow = false; app.peekAt = performance.now(); return approach(fig, shadow, face).then(breath); }   // まれに（平均 2 分に 1 回ほど）近づいてくる
      untilHop -= 1;
      if (untilHop > 0) return breath();
      untilHop = happy ? 1 : 2 + Math.floor(Math.random() * 3);
      hopOnce(fig, shadow, happy ? 0.45 : 0.3).then(breath);
    }).catch(() => {});
  };
  breath();
}
/** ひとことを 1〜2 言に縮める（吹き出しは小さく固定。全文は下の一覧に出す） */
export function brief(line) {
  const parts = String(line ?? "").split(/,\s+|、|[.!?。！？]\s+/).map((x) => x.trim().replace(/[.!?。！？]+$/, "")).filter(Boolean);
  let out = parts[0] ?? "";
  if (parts[1] && (out + ", " + parts[1]).length <= 40) out += ", " + parts[1];
  return out.length > 44 ? out.slice(0, 43).replace(/\s+\S*$/, "") + "…" : out;   // 語の途中で切らない
}
/** 最近のひとこと（新しい順。帳簿に載る前のものも） */
function sayLines(fold) {
  const out = [];
  if (app.lastSay && !app.lastSayMenu) out.push(app.lastSay);
  for (const x of (fold?.meals ?? []).filter((m) => !m.menu).slice(-3).reverse()) if (x.line && !out.includes(x.line)) out.push(x.line);   // メニュー名は HAKO の言葉ではないので言わせない
  return out;
}
/** 語録（D-121）を選ぶための、いまの状態。帳簿と手元の出来事・取引の段から作る */
function phraseState() {
  const st = app.st ?? {}, now = Date.now();
  const ev = merged(app.stats, app.did).events ?? [];
  const last = (t) => ev.reduce((m, e) => (e.t === t && e.ms > (m?.ms ?? 0) ? e : m), null);
  const meal = last("meal"), out = last("out");
  const outs = app.stats?.did?.[app.did]?.outs ?? [];
  const twist = outs.length ? outs[outs.length - 1]?.facts?.metric ?? null : null;
  const waiting = Object.values(app.deals ?? {}).some((d) => d.st && !d.st.done && ["offered", "locking", "locked", "waiting"].includes(d.st.stage));
  return { s: { hour: new Date().getHours(), hunger: st.hunger, mood: st.mood, fedAgoMin: meal ? (now - meal.ms) / 60_000 : null,
    homeAgoMin: out ? (now - out.ms) / 60_000 : null, twist, level: st.accLevel ?? 1, waiting }, seed: meal?.contract ?? app.did };
}
/** 次の一言（語録から）。投資が元ネタのものは 1 日 invest_per_day 個まで（この端末で数える） */
function nextPhrase(fresh) {
  if (!app.P) return null;
  const { s, seed } = phraseState();
  const day = localDay(Date.now(), app.box), ik = `tama_phr_inv:${app.did}:${day}`;
  let used = 0; try { used = Number(localStorage.getItem(ik) || 0); } catch { used = 0; }
  app.chatN = (app.chatN ?? 0) + 1;
  const p = pickPhrase(app.P, s, `${seed}:${app.chatN}:${Math.floor(Date.now() / 60_000)}`, { avoid: app.lastPhrase, investLeft: Number(app.P.invest_per_day ?? 2) - used, force: fresh ? "fed" : null });
  if (!p) return null;
  app.lastPhrase = p.id;
  if (p.invest) try { localStorage.setItem(ik, String(used + 1)); } catch { /* 数えないだけ */ }
  return p;
}
/** 喋ったり、黙ったり。食べた直後は必ず 1 回（食後の一言）喋り、あとは気まぐれに（6 割くらいで）いまの状態に合う一言を言う。
 *  語録が読めなかったときは、これまでどおり最近のひとこと（モデルの一文）の頭を言う */
function chatter(el, my) {
  if (!el) return;
  const speak = (fresh) => {
    if (my !== live || !el.isConnected) return;
    if (fresh || Math.random() < 0.6) {
      const p = nextPhrase(fresh), lines = app.sayLines ?? [];
      const t = p ? phraseText(p, getLang()) : lines.length ? { short: brief(fresh ? lines[0] : lines[Math.floor(Math.random() * Math.min(lines.length, 3))]), gloss: "", full: "" } : null;
      if (t) {
        el.firstChild.textContent = t.short;
        let g = el.querySelector("small");
        if (t.gloss) { if (!g) { g = document.createElement("small"); el.appendChild(g); } g.textContent = t.gloss; } else g?.remove();   // 日本語の意訳（日本語モード）
        if (t.full && t.full !== t.short) el.title = t.full; else el.removeAttribute("title");
        el.classList.add("on");
        setTimeout(() => { if (my === live) el.classList.remove("on"); }, 6000);
      }
    }
    setTimeout(() => speak(false), 14000 + Math.random() * 16000);
  };
  if (app.sayFresh) { app.sayFresh = false; speak(true); } else setTimeout(() => speak(false), 2500 + Math.random() * 5000);
}
/** 部屋の中の HAKO を動かす。部屋（背景）は render が描き、ここは上に重ねる姿だけを替える */
export function setMotion(kind) {
  const stage = $("stage"), slot = $("slot"); if (!stage || !slot) return;
  if (app.motion === kind && slot.firstChild) return;
  app.motion = kind;
  clearTimeout(timer); timer = null; live += 1;
  const grow = app.st?.stage ?? "egg";   // 育ちの段: egg → baby → hako（表情が変わるのは HAKO になってから）
  stage.className = `stage m-${kind} s-${grow}`;
  const at = (rows, k) => { const p = spot(rows, k); return `left:${p.left}%;bottom:${p.bottom}%;width:${p.width}%`; };
  if (kind === "grave") { slot.innerHTML = `<div class="pos" style="${at(spriteRows(app.did, "ghost")[0], "ghost")}"><div class="ghost">${spriteSvg(app.did, "ghost", HAKO_PX)}</div></div>`; return; }
  if (kind === "out") { slot.innerHTML = `<div class="away">${outSign()}<p>${L("おでかけ中", "Out for a walk")}</p></div>`; return; }
  const look = kind === "reborn" ? "egg" : grow;
  const fx = kind === "happy" ? `<span class="fx"><i></i><i></i><i></i></span>` : kind === "eat" ? `${bowl()}<span class="fx steam"><i></i><i></i></span>` : kind === "sad" && look === "hako" ? `<span class="fx drop"><i></i></span>` : "";
  slot.innerHTML = `<div class="pos" style="${at(spriteRows(app.did, look, { level: app.st?.accLevel ?? 1 })[0])}"><div class="shadow"></div><div class="hako"></div>${fx}<div class="say"><span></span></div></div>`;
  const fig = slot.querySelector(".hako"), shadow = slot.querySelector(".shadow");   // 動きが途切れないように、入れ物は残して中の絵だけ替える
  const frames = FRAMES[kind] ?? FRAMES.normal;
  const level = app.st?.accLevel ?? 1;   // 飾りの段（D-119）。段 4 は光って動く
  const show = (f) => { fig.innerHTML = spriteSvg(app.did, look, HAKO_PX, { level, ...f }); };
  show(frames[0]);
  const my = live;
  if (look !== "egg") chatter(slot.querySelector(".say"), my);
  if ((kind === "normal" || kind === "happy") && look !== "egg" && !calm() && fig.animate) idle(fig, shadow, kind === "happy", look === "hako" ? show : null);
  // 確かめ用: app.peekNow = true にすると、次の呼吸の切れ目で近づいてくる
  if (look !== "hako" || calm()) return;
  if (kind === "normal") {   // まばたき
    const blink = (again) => { timer = setTimeout(() => { if (my !== live) return; show({ eye: "line" });
      timer = setTimeout(() => { if (my !== live) return; show({}); blink(!again && Math.random() < 0.2); }, 160); }, again ? 220 : 2200 + Math.random() * 3800); };
    blink(false);
  } else if (frames.length > 1) {
    let i = 0; const step = () => { timer = setTimeout(() => { if (my !== live) return; i += 1; show(frames[i % frames.length]); step(); }, 900); };
    step();
  }
}
const ITEM_PAL = { k: "ink", w: "#d9b48a", d: "#a87f59", o: "#f5a06e", c: "#fffdf8", y: "#f2cf6b" };
const BOWL = ["    kkkkkk    ", "  kkcccccckk  ", "kkkkkkkkkkkkkk", "kooooooooooook", "kooyyyyyyyyook", " kooooooooook ", "  kooooooook  ", "   kkkkkkkk   "];
const SIGN = ["  kkkkkkkkkkk   ", "  kwwwwwwwwwkk  ", "  kwwwwwwwwwwwk ", "  kwwwwwwwwwkk  ", "  kkkkkkkkkkk   ", "      kdk       ", "      kdk       ", "      kdk       ", "      kdk       ", "      kdk       ", "      kdk       ", "      kdk       ", "     kkkkk      "];
const bowl = () => artSvg(BOWL, ITEM_PAL, "css", "bowl");
const outSign = () => artSvg(SIGN, ITEM_PAL, "css", "sign");

// ── 画面 ──
function meter(label, v, max) {
  const n = Math.round((Number(v) / Number(max)) * 10), cls = n >= 6 ? "good" : n >= 3 ? "mid" : "bad";
  return `<div class="meter"><div class="row"><span>${label}</span><span class="mono dim">${Math.round(v)}/${max}</span></div>` +
    `<div class="bar ${cls}" role="meter" aria-valuenow="${Math.round(v)}" aria-valuemax="${max}" aria-label="${label}">${Array.from({ length: 10 }, (_, k) => `<i class="${k < n ? "on" : ""}" style="--k:${k}"></i>`).join("")}</div></div>`;
}
const DOT = { meal: "var(--meal)", out: "var(--out)", play: "var(--play)" };
const KIND_EN = { meal: "Feed", out: "Go out", play: "Play" };
function stateWord(st) {
  const k = motionOf(st);
  return { grave: L("お墓", "Resting"), out: L("おでかけ中", "Out"), eat: L("食事中", "Eating"), happy: L("ごきげん", "Happy"), sad: L("しょんぼり", "Down"), reborn: L("生まれ変わり", "Reborn") }[k] ?? (st.hunger >= 60 ? L("げんき", "Lively") : L("ふつう", "OK"));
}
function lastSay(fold) {
  const meals = fold?.meals ?? [], x = app.lastSay ? { line: app.lastSay, menu: app.lastSayMenu } : meals[meals.length - 1];
  return !x ? null : x.menu ? `Today's meal: ${x.line}` : x.line;   // メニュー名は「今日のご飯」として写す
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

/** github.io の /tama/ を閉じる知らせ（2026-10-04 12:00 JST で閉じる。運営者 2026-10-04）。Firebase 側には出さない */
function movingNotice() {
  if (!location.hostname.endsWith("github.io")) return;
  let el = $("moving");
  if (!el) { el = document.createElement("section"); el.id = "moving"; el.className = "card"; $("view").before(el); }
  const h = `<p><b>${L("この場所での公開は 10月4日（日）12:00（日本時間）で終わります。", "This page closes on Sunday, October 4, at 12:00 noon Japan time.")}</b></p>
    <p>${L("あなたの HAKO を続けるには、それまでに鍵ファイルを保存してください。新しい場所では、その鍵ファイルを読み込んで続けられます。", "To keep your HAKO, save your key file before then. You can load it at the new location to carry on.")}</p>
    ${K.loadRec() ? `<div class="actions"><button class="btn" id="movesave">${L("鍵ファイルを保存", "Save key file")}</button></div>` : ""}`;
  if (el.dataset.h === h) return;
  el.innerHTML = h; el.dataset.h = h;
  const b = $("movesave");
  if (b) b.onclick = () => { const rec = K.loadRec(); if (rec) { K.downloadRec(rec); say(L("鍵ファイルを保存しました。パスフレーズと別の場所にしまってください", "Key file saved. Keep it somewhere separate from your passphrase."), false); } };
}

export function render() {
  const view = $("view");
  renderChrome();
  movingNotice();
  if (!app.did) return renderEgg();
  if (!app.priv) return renderUnlock();
  const m = merged(app.stats, app.did);
  const st = lifeState(m.events, Date.now(), app.box);
  app.st = st; app.balance = m.balance;
  if (app.why && app.whyAt && Date.now() - app.whyAt > 9000) app.why = "";   // 押したときの知らせは、しばらくしたら消す
  if (!st.born) return renderEgg();
  const fee = Number(app.box.reborn_price ?? 0);
  const graveNote = st.grave ? `<p class="note">` + L(`おなかが空っぽのまま ${app.box.grave_after_hours} 時間がたって、お墓になりました。生まれ変わると、同じ HAKO がもう一度はじめからやり直します（部屋とこれまでの記録はそのまま）。` +
    `生まれ変わりには ${fmt(fee)} $PAPER かかります${m.balance < fee ? `（いまは足りないので、財布が 0 になって生まれ変わります）` : ""}。お墓の間は、おでかけとあそぶはできません。`,
    `Its tummy stayed empty for ${app.box.grave_after_hours} hours, so it is resting in a grave. When it is reborn, the same HAKO starts over from an egg (the room and its record stay). ` +
    `Rebirth costs ${fmt(fee)} $PAPER${m.balance < fee ? ` (you don't have enough now, so your wallet will go to 0)` : ""}. While it rests, it can't go out or play.`) + `</p>` : "";
  app.sayLines = st.grave ? [] : sayLines(m.fold);
  const w = $("wallet"); if (w) { w.hidden = false; w.textContent = `${fmt(m.balance)} $PAPER${m.fromFold ? "" : " *"}`; w.title = m.fromFold ? L("財布", "Wallet") : L("帳簿に載るまでの見込み", "Estimate until the ledger catches up"); }
  const acts = actionsHtml(st, m);
  const html = `
    <section class="card" id="me">
      <div id="stage" class="stage"><div class="bg">${roomBg(m, st)}</div><div id="slot"></div><div class="ops mono" id="ops" aria-hidden="true"></div></div>
      ${waitHtml()}
      <div class="who"><span class="name">${nameHtml()}<button type="button" class="rename" id="rename" aria-expanded="${app.naming ? "true" : "false"}" title="${L("HAKO に名前をつける", "Name your HAKO")}" aria-label="${L("HAKO に名前をつける", "Name your HAKO")}">✎</button></span><span class="chip state"><span class="dot" style="background:${st.grave ? "var(--dim)" : st.hunger >= 60 ? "var(--good)" : st.hunger >= 30 ? "var(--mid)" : "var(--bad)"}"></span>${stateWord(st)}</span></div>
      ${app.naming ? nameForm() : ""}
      ${st.grave ? "" : `<div class="meters">${meter(L("おなか", "Tummy"), st.hunger, app.box.hunger_max)}${meter(L("ごきげん", "Mood"), st.mood, app.box.mood_max)}</div>`}
      <div class="chips mono">
        <span class="chip">${L(`連続 ${st.streak} 日`, `Streak ${st.streak}d`)}</span>
        ${st.grave ? "" : `<span class="chip">${L("おでかけ", "Outings")} ${st.outsToday}/${app.box.out_per_day}</span><span class="chip">${L("あそぶ", "Play")} ${playsToday(m)}/${app.box.play_per_day}</span>`}
        ${st.rebirths ? `<span class="chip">${L("生まれ変わり", "Rebirths")} ${st.rebirths}</span>` : ""}
        ${m.fromFold ? "" : `<span class="chip">${L("* 帳簿に載るまでの見込み", "* estimate until the ledger catches up")}</span>`}
      </div>
      ${!st.grave && st.stage !== "hako" && app.box.grow_hours ? `<p class="hint">${L(`${Math.round(app.box.grow_hours / 24)} 日育てると…？`, `Raise it for ${Math.round(app.box.grow_hours / 24)} days and…?`)}</p>` : ""}
      ${graveNote}
      <div class="actions main">${acts}</div>
      ${sitHtml(st, m)}
      <p id="why" class="why${app.why && app.whyBad ? " bad" : ""}">${esc(app.why ?? "")}</p>
      <div id="said"></div>
      ${roomInfo(m, st)}
    </section>`;
  app.m = m;
  if (app.viewHtml === html && $("stage")) { showOps(); setMotion(motionOf(st)); renderSaid(m.fold); return; }   // 変わっていなければ描き直さない（動きを途切れさせない）
  app.nmFocus = document.activeElement?.id === "nm";   // 名前の書きかけ（描き直す前に、入力中だったかを覚える）
  app.viewHtml = html; view.innerHTML = html; app.opsShown = null; showOps();
  app.motion = null; setMotion(motionOf(st));
  for (const b of document.querySelectorAll("#reborn")) b.onclick = reborn;
  const cam = $("snapshot"); if (cam) cam.onclick = () => snapshot(app.m, app.st);
  wireName(); wireSit();
  const sk = $("savekey"); if (sk) sk.onclick = () => { const rec = K.loadRec(); if (rec) { K.downloadRec(rec); say(L("鍵ファイルを保存しました。パスフレーズと別の場所にしまってください", "Key file saved. Keep it somewhere separate from your passphrase."), false); } };
  for (const b of document.querySelectorAll("button[data-kind]")) b.onclick = () => startDeal(b.dataset.kind);
  renderSaid(m.fold);
}
// 名前（D-122）。自分の画面だけ: 鍵の記録に置き、会場・庭・ほかの人の画面には出さない
function nameHtml() {
  const rec = K.loadRec(), named = rec?.did === app.did && K.cleanName(rec.name);
  return named ? `${esc(named)} <span class="mono sub">…${esc(app.did.slice(-8))}</span>` : `HAKO <span class="mono">${esc(app.did.slice(-8))}</span>`;
}
function nameForm() {
  return `<form class="namef" id="namef">
      <label>${L("名前", "Name")}<input id="nm" type="text" maxlength="${K.NAME_MAX}" autocomplete="off" placeholder="HAKO …${esc(app.did.slice(-8))}"></label>
      <div class="actions"><button type="submit" class="btn">${L("保存", "Save")}</button><button type="button" class="btn sub" id="nm-cancel">${L("やめる", "Cancel")}</button></div>
      <p class="small">${L(`${K.NAME_MAX} 文字まで。名前はこのブラウザと鍵ファイルにだけ保存され、庭やほかの人の画面には出ません。シェアする画像には出ます。空にすると元の呼び名に戻ります。鍵ファイルにも名前を入れるには、鍵ファイルをもう一度保存してください。`,
        `Up to ${K.NAME_MAX} characters. Saved only in this browser and your key file. It won't appear in the garden or on anyone else's screen, but it will show in images you share. Leave it empty to use the default name. To include it in your key file, save the key file again.`)}</p>
    </form>`;
}
function wireName() {
  const rn = $("rename"); if (rn) rn.onclick = () => { app.naming = !app.naming; app.nameDraft = K.cleanName(K.loadRec()?.name); render(); if (app.naming) $("nm")?.focus(); };
  const f = $("namef"), nm = $("nm"); if (!f || !nm) return;
  // 描き直しで入力が消えないように、書きかけを覚えておいて戻す
  nm.value = app.nameDraft ?? ""; if (app.nmFocus) nm.focus();
  nm.oninput = () => { app.nameDraft = nm.value; };
  f.onsubmit = (ev) => {
    ev.preventDefault();
    const ok = K.setName(nm.value), named = K.cleanName(nm.value); app.naming = false; app.nameDraft = "";
    say(!ok ? L("名前をこのブラウザに保存できませんでした", "Couldn't save the name in this browser")
      : named ? L(`名前を「${named}」にしました`, `Name set to “${named}”`) : L("元の呼び名に戻しました", "Back to the default name"), !ok);
    render();
  };
  $("nm-cancel").onclick = () => { app.naming = false; app.nameDraft = ""; render(); };
}
// ── おるすばん（D-123）: 出かける前に、N 日分のごはん（1 日 1 回）とあそぶ（1 日 0〜sit_plays_max 回）を予約する。届けるのは miner、払うのはこの HAKO ──
const SIT_INDEX = () => `tama_sit_v1:${app.did}`;
function loadSits() {
  let ix = null; try { ix = JSON.parse(localStorage.getItem(SIT_INDEX()) || "null"); } catch { ix = null; }
  return (ix?.slots ?? []).map(newSit);
}
const newSit = (slot) => new SitDeal({ app, slot, onEvent: (ev) => onSit(ev, slotKind(slot)) });
const sitLive = () => app.sits.filter((d) => d.st && !d.st.done);
// 1 回の予約は sit_max_slots 本まで（取引 1 本で会場の部屋が 1 つ。新しい部屋は 1 日 1 IP 20 まで。その日のふだんのお世話の分を残す）
const sitPlaysMax = (n) => Math.max(0, Math.min(Number(app.box.sit_plays_max ?? 0), Math.floor(Number(app.box.sit_max_slots ?? 99) / n) - 1));
function onSit(ev, kind) {
  if (ev.type === "settled") {
    addLocal(app.did, { t: kind === "sitplay" ? "play" : "meal", ms: ev.ms, contract: ev.contract, sit: true }, ev.delta);
    if (kind === "sit" && ev.lines?.[0]) { app.lastSay = ev.lines[0]; app.lastSayMenu = false; }   // 予約のときの指示文で書かれている。帳簿の menu の印に任せる
    logOp(`settled · ${kind} · ${short(ev.contract)} · ${ev.delta} PAPER`);
  }
  // 予約の途中の知らせは、頼んだ直後だけ出す（留守中に溜まった知らせで画面を埋めない）
  else if (ev.type === "note" && app.sitBooking) { app.why = ev.text; app.whyBad = false; app.whyAt = null; }
}
async function tickSits() {
  for (const d of app.sits) {
    await d.tick().catch(() => {});
    // lock できた回は、手元でもおるすばん中にする（帳簿係と同じ区間。lock の時刻は、気づいた今で近似する）
    if (d.st?.locked && d.st.contract && !d.coverNoted) {
      const until = Number(d.st.offer.claimByMs), from = Math.max(Date.now(), d.at() - Number(app.box.sit_cover_hours) * HOUR);
      addLocal(app.did, { t: "sit", ms: Math.min(from, until - 1), until, contract: d.st.contract });
      d.coverNoted = true;
    }
  }
  if (app.sitBooking && !sitPending()) {
    app.sitBooking = false;
    const mine = app.sits.filter((d) => app.sitNew?.has(d.slot) && (d.st?.locked || d.st?.stage === "settled"));
    const ok = mine.filter((d) => d.kind === "sit").length, okp = mine.length - ok;
    app.why = mine.length ? L(`シッターにお願いしました（ごはん ${ok} 回${okp ? `・あそぶ ${okp} 回` : ""}）。閉じても大丈夫です`, `Sitter booked (${ok} meal${ok === 1 ? "" : "s"}${okp ? `, ${okp} play${okp === 1 ? "" : "s"}` : ""}). You can close the page.`)
      : L("お願いできませんでした。PAPER は使われていません", "Couldn't book the sitter. No PAPER was spent.");
    app.whyBad = !mine.length; app.whyAt = Date.now();
  }
}
/** 頼んだ取引のうち、まだ結び終わっていない（lock の前の）ものがあるか */
const sitPending = () => app.sits.some((d) => d.st && !d.st.done && !d.st.locked && !["refunded", "settled"].includes(d.st.stage));
const whenShort = (ms) => new Date(ms).toLocaleString(getLang() === "ja" ? "ja-JP" : "en-US", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
/** 予約の起点。新しく頼むときは今から（最初のお世話は sit_first_hours 後）、延長は今の予約の最後のごはんから 1 日ごと */
function sitStart() {
  const meals = app.sits.filter((d) => d.kind === "sit" && d.st && !["refunded", "ng", "offer_failed"].includes(d.st.stage)).map((d) => d.at()).filter((t) => t > Date.now());
  return meals.length ? { t0: Math.max(...meals), first: Number(app.box.sit_every_hours), ext: true } : { t0: Date.now(), first: Number(app.box.sit_first_hours ?? app.box.sit_every_hours), ext: false };
}
/** n 日・あそぶ p 回が、帳簿係の決まり（届ける時刻は今から sit_max_days 日以内など）に収まるか */
const sitFits = (n, p, s) => sitSchedule(app.box, s.t0, n, p, s.first).every((x) => !sitWhy(app.box, { job: { context: JSON.stringify({ at: x.at }) }, claimByMs: x.claimByMs, refundAfterMs: x.refundAfterMs }, Date.now()));
function sitHtml(st, m) {
  if (!app.box?.sit_price) return "";
  const live = sitLive();
  // 頼むボタンは sit_enabled のときだけ（GCP の miner が sit を引き受けるようになってから入れる）。頼んだ分の表示は続ける
  if (!app.box.sit_enabled && !live.length && !(st.sitUntil > Date.now())) return "";
  if (live.length && sitPending()) return `<div class="sit"><p class="small">${L("お願いしています…（1〜2 分。このまま開いておいてください）", "Booking the sitter… (1–2 minutes. Please keep this open.)")}</p></div>`;
  const s = sitStart();
  let head = "";
  if (s.ext || (st.sitUntil && st.sitUntil > Date.now())) {
    const ats = app.sits.filter((d) => d.st && !["refunded", "ng", "offer_failed"].includes(d.st.stage)).map((d) => d.at()).filter((t) => t > 0).sort((a, b) => a - b);
    const last = ats.length ? ats[ats.length - 1] : null;
    const done = (d) => d.st?.stage === "settled", cnt = (k, f = () => true) => app.sits.filter((d) => d.kind === k && d.st && !["refunded", "ng", "offer_failed"].includes(d.st.stage) && f(d)).length;
    const nm = cnt("sit"), np = cnt("sitplay"), cm = cnt("sit", done), cp = cnt("sitplay", done);
    head = `<p class="small"><b>${L("おるすばん中", "Sitter on duty")}</b>${last ? L(`（${whenShort(last)} まで）`, ` (until ${whenShort(last)})`) : ""}　` +
      L(`ごはん ${cm}/${nm}${np ? `・あそぶ ${cp}/${np}` : ""}`, `meals ${cm}/${nm}${np ? `, plays ${cp}/${np}` : ""}`) + `</p>`;
    // 延長は、最後のごはんまで 1 日を切ってから聞く
    const soon = s.ext && s.t0 - Date.now() < Number(app.box.sit_every_hours) * HOUR;
    if (!app.box.sit_enabled || st.grave || !soon) return `<div class="sit">${head}</div>`;
  }
  if (st.grave || !app.box.sit_enabled) return head ? `<div class="sit">${head}</div>` : "";
  // 説明は遊び方に置き、ここはボタンだけ（延長は、最後のごはんまで 1 日を切ってから）
  const btn = `<div class="actions"><button type="button" class="btn sub" id="sit-open">${s.ext ? L("シッターを延長", "Extend sitter") : L("シッターにお願い", "Ask a sitter")}</button></div>`;
  if (!app.sitOpen) return head ? `<div class="sit">${head}${btn}</div>` : btn;
  const dmax = Array.from({ length: Number(app.box.sit_max_days) }, (_, i) => i + 1).filter((d) => sitFits(d, 0, s)).pop() ?? 0;
  if (!dmax) return `<div class="sit">${head}</div>`;
  const n = Math.min(Math.max(1, Number(app.sitDays ?? Math.min(3, dmax))), dmax);
  const pmax = Math.max(0, ...Array.from({ length: sitPlaysMax(n) + 1 }, (_, j) => j).filter((j) => sitFits(n, j, s)));
  const p = Math.min(Math.max(0, Number(app.sitPlays ?? Math.min(1, pmax))), pmax);
  const price = Number(app.box.sit_price), pprice = Number(app.box.sit_play_price ?? 0), total = n * (price + p * pprice), lack = m.balance < total;
  const opts = Array.from({ length: dmax }, (_, i) => `<option value="${i + 1}"${i + 1 === n ? " selected" : ""}>${L(`${i + 1} 日`, `${i + 1} day${i ? "s" : ""}`)}</option>`).join("");
  const popts = Array.from({ length: pmax + 1 }, (_, i) => `<option value="${i}"${i === p ? " selected" : ""}>${L(i ? `${i} 回` : "あそばない", ["None", "Once", "Twice"][i] ?? `${i} times`)}</option>`).join("");
  return `<div class="sit">${head}<form class="sitf" id="sitf">
      <label>${s.ext ? L("延長する日数", "Extra days") : L("留守にする日数", "Days away")}<select id="sit-days">${opts}</select></label>
      ${pmax ? `<label>${L("1 日にあそぶ回数", "Plays per day")}<select id="sit-plays">${popts}</select></label>` : ""}
      ${lack ? `<p class="why bad">${L("PAPER が足りません", "Not enough PAPER")}</p>` : ""}
      <div class="actions"><button type="submit" class="btn"${lack ? " disabled" : ""}>${L("お願いする", "Book")} <span class="price">${fmt(total)} $PAPER</span></button><button type="button" class="btn sub" id="sit-cancel">${L("やめる", "Cancel")}</button></div>
    </form></div>`;
}
function wireSit() {
  const o = $("sit-open"); if (o) o.onclick = () => { app.sitOpen = true; render(); };
  const sel = $("sit-days"); if (sel) sel.onchange = () => { app.sitDays = Number(sel.value); render(); };
  const ps = $("sit-plays"); if (ps) ps.onchange = () => { app.sitPlays = Number(ps.value); render(); };
  const c = $("sit-cancel"); if (c) c.onclick = () => { app.sitOpen = false; render(); };
  const f = $("sitf"); if (f) f.onsubmit = (ev) => { ev.preventDefault(); bookSit(Number($("sit-days").value), Number($("sit-plays")?.value ?? 0)); };
}
async function bookSit(n, p = 0) {
  if (sitPending() || app.sitBooking) return;
  const st = app.st, m = app.m;
  if (!st || st.grave) return;
  const s = sitStart();
  p = Math.min(Math.max(0, p), sitPlaysMax(n));
  if (!sitFits(n, p, s)) return say(L("その日数では頼めません", "That many days can't be booked"));
  if (m.balance < n * (Number(app.box.sit_price) + p * Number(app.box.sit_play_price ?? 0))) return say(L("PAPER が足りません", "Not enough PAPER"));
  const plan = sitSchedule(app.box, s.t0, n, p, s.first);   // ごはんが先（PAPER が途中で足りなくなっても、ごはんから引き当てる）
  plan.sort((a, b) => (a.j > 0) - (b.j > 0) || a.at - b.at);
  const slots = plan.map((x) => (x.j ? `${s.t0}-${x.k}-p${x.j}` : `${s.t0}-${x.k}`));
  let ix = null; try { ix = JSON.parse(localStorage.getItem(SIT_INDEX()) || "null"); } catch { ix = null; }
  // 延長は前の予約に足す。新しく頼むときは、前の予約の記録を置きかえる
  const keep = s.ext ? (ix?.slots ?? []) : [];
  try { localStorage.setItem(SIT_INDEX(), JSON.stringify({ t0: s.t0, n, p, slots: [...keep, ...slots] })); } catch { /* 開き直すと見えなくなるだけ */ }
  const fresh = slots.map(newSit);
  app.sits = s.ext ? [...app.sits, ...fresh] : fresh;
  app.sitNew = new Set(slots);
  app.sitOpen = false; app.sitBooking = true;
  say(L("お願いしています…（1〜2 分。このまま開いておいてください）", "Booking the sitter… (1–2 minutes. Please keep this open.)"), false);
  for (let i = 0; i < plan.length; i++) {
    const r = await fresh[i].book({ st, plan: plan[i], t0: s.t0 });
    if (!r.ok) logOp(`${plan[i].kind} · ${plan[i].k}${plan[i].j ? `-p${plan[i].j}` : ""} · ${r.why}`);
  }
  render();
}
function actionsHtml(st, m) {
  if (st.grave) return `<button class="btn" id="reborn" style="--c:var(--accent)"><span class="dot" style="background:var(--accent)"></span>${L("生まれ変わる", "Be reborn")} <span class="price">${fmt(Math.min(Number(app.box.reborn_price ?? 0), Math.max(0, m.balance)))} $PAPER</span></button>`;
  const price = { meal: app.box.meal_price, out: app.box.out_price, play: app.box.play_stake };
  return dealKinds.map(([k, label]) => { const why = actionBlock(k, st, m);
    return `<button class="btn${why ? " off" : ""}" data-kind="${k}" style="--c:${DOT[k]}" ${why ? `aria-disabled="true" title="${esc(why)}"` : ""}><span class="dot" style="background:${DOT[k]}"></span>${L(label, KIND_EN[k])} <span class="price">${fmt(price[k])} $PAPER</span></button>`; }).join("");
}
/** 画面の決まった文（切り替え、下のタブ、注意書き）を、いまの言語にする。HTML の data-en が英語、もとの文が日本語 */
function applyLang() {
  const en = getLang() === "en";
  document.documentElement.lang = en ? "en" : "ja";
  for (const el of document.querySelectorAll("[data-en]")) { if (el.dataset.ja == null) el.dataset.ja = el.textContent; el.textContent = en ? el.dataset.en : el.dataset.ja; }
  for (const el of document.querySelectorAll("[data-en-label]")) { if (el.dataset.jaLabel == null) el.dataset.jaLabel = el.getAttribute("aria-label") ?? ""; const t = en ? el.dataset.enLabel : el.dataset.jaLabel; el.setAttribute("aria-label", t); el.title = t; }
  const lg = $("lang"); if (lg) lg.textContent = en ? "JA" : "EN";   // 押すと切り替わる先の言語
}
/** ページの外枠（ロゴの HAKO、明るさ、庭のようす） */
function renderChrome() {
  if (!document.body.dataset.tabs) {   // タブ（上の切り替えと、スマホの下の並び）
    document.body.dataset.tabs = "1";
    const TABS = ["me", "garden", "story", "how"];
    const go = (t) => { document.body.dataset.tab = t; for (const a of document.querySelectorAll("[data-tab-to]")) { a.classList.toggle("on", a.dataset.tabTo === t); if (t === "me") a.classList.remove("ping"); } window.scrollTo({ top: 0 }); };
    for (const a of document.querySelectorAll("[data-tab-to]")) a.onclick = (e) => { e.preventDefault(); if (location.hash !== `#${a.dataset.tabTo}`) location.hash = a.dataset.tabTo; else go(a.dataset.tabTo); };
    addEventListener("hashchange", () => go(TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "me"));   // 戻るボタンで前の画面へ
    if (TABS.includes(location.hash.slice(1))) go(location.hash.slice(1));
  }
  const lg = $("lang");
  if (lg && !lg.dataset.done) {
    lg.dataset.done = "1";
    lg.onclick = () => { setLang(getLang() === "ja" ? "en" : "ja"); applyLang(); app.viewHtml = null; app.saidHtml = null; render(); };
    applyLang();
  }
  const th = $("theme");
  if (th && !th.dataset.done) {
    th.dataset.done = "1";
    try { const t = localStorage.getItem("tama_theme"); if (t) document.documentElement.dataset.theme = t; } catch { /* 覚えないだけ */ }
    th.onclick = () => {
      const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.dataset.theme = dark ? "light" : "dark";
      try { localStorage.setItem("tama_theme", document.documentElement.dataset.theme); } catch { /* 覚えないだけ */ }
    };
  }
  renderGarden(app.stats, app.moods, app.box, app.F);
}
// ── 部屋とシェア（D-92、D-98。家具は tama_furniture.json、解放は仮 U-37） ──
// 部屋にただよう小さな粒（空気の感じ）
const MOTES = [[14, 22, 0], [31, 48, 5], [58, 18, 9], [72, 40, 3], [88, 28, 12]].map(([x, y, d]) => `<i class="mote" style="left:${x}%;top:${y}%;animation-delay:${d}s"></i>`).join("");
const NO_F = { items: [], floor_slots: [], wall_slots: [] };
/** 部屋の背景（家具と、お墓のときは墓）。HAKO は setMotion が上に重ねる */
function roomBg(m, st) {
  const F = app.F ?? NO_F;
  return roomSvg(F, app.did, lifetime(m.events, app.box, localDay), { hako: st.grave ? "tomb" : "away", theme: "css" }) + MOTES;
}
function roomInfo(m, st) {
  if (!app.F) return "";
  const n = lifetime(m.events, app.box, localDay);
  const have = unlocked(app.F, n), next = nextUnlock(app.F, n);
  const art = app.lastArticle ?? (m.fold?.outs ?? []).slice(-1)[0] ?? null;
  return `<div class="roominfo" id="room"><p class="label">ROOM · ${have.length}/${app.F.items.length}</p>
    <div class="chips">${have.map((x) => `<span class="chip">${esc(L(x.ja, x.en ?? x.ja))}</span>`).join("") || `<span class="small">${L("まだ何もない部屋です", "The room is still empty")}</span>`}</div>
    ${next ? `<p class="small">${L("次は", "Next:")} <b>${esc(L(next.ja, next.en ?? next.ja))}</b>${L("（", " (")}${esc(whenText(next))}${L("）", ")")}</p>` : ""}
    <div class="actions">
      <button class="btn sub" id="snapshot">${L("HAKO をシェア", "Share HAKO")}</button>
      <button class="btn sub" id="savekey">${L("鍵ファイルを保存", "Save key file")}</button>
    </div></div>`;
}
/** HAKO をシェア: 部屋・記事（無ければひとこと）・様子とお世話の記録・ロゴを 1 枚の写真にする。撮る → 写真が浮かび上がる → シェアか保存 */
async function snapshot(m, st) {
  const n = lifetime(m.events, app.box, localDay);
  const art = st.grave ? null : app.lastArticle ?? (m.fold?.outs ?? []).slice(-1)[0] ?? null;
  const said = st.grave ? "Here lies a happy little HAKO. It will be back." : lastSay(m.fold);
  const title = K.nameOf(K.loadRec(), app.did);
  const stage = $("stage");
  if (stage) { stage.classList.remove("flash"); void stage.offsetWidth; stage.classList.add("flash"); }   // シャッターの光
  try {
    const png = await svgToPng(scrapSvg(app.F, app.did, n, title, { stage: st.stage, level: st.accLevel ?? 1, grave: st.grave, hunger: st.hunger, mood: st.mood, hungerMax: app.box.hunger_max, moodMax: app.box.mood_max,
      streak: st.streak, rebirths: st.rebirths, lines: art?.lines ?? [], say: said, day: localDay(Date.now(), app.box) }));
    const file = new File([png], `hako-${app.did.slice(-8).toLowerCase()}.png`, { type: "image/png" });
    const u = new URL(`h/${app.did.slice(-8).toLowerCase()}.html`, location.href);
    const v = String(app.stats?.box?.generated ?? "").replace(/[^0-9]/g, "");   // 帳簿係の回の番号（X が古い画像を出し続けないように）
    if (v) u.searchParams.set("v", v);
    const text = st.grave ? L(`${title} はお墓で休んでいます #HAKONIWA`, `${title} is resting in its grave #HAKONIWA`) : art ? L(`${title} のおでかけ記事 #HAKONIWA`, `${title}'s outing report #HAKONIWA`) : L(`${title} の部屋 #HAKONIWA`, `${title}'s room #HAKONIWA`);
    const src = URL.createObjectURL(file);
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    document.getElementById("snap")?.remove();
    const box = document.createElement("div"); box.className = "snap"; box.id = "snap";
    box.innerHTML = `<div class="photo"><img src="${src}" alt="${esc(L(`${title} の部屋の写真`, `A photo of ${title}'s room`))}"><p class="mono">${esc(title)}</p></div>
      <div class="actions"><button class="btn" id="snap-share" style="--c:var(--accent)">${L("シェアする", "Share")}</button><a class="btn sub" id="snap-save" href="${src}" download="${file.name}">${L("画像を保存", "Save image")}</a><button class="btn sub" id="snap-close">${L("とじる", "Close")}</button></div>`;
    document.body.appendChild(box);
    const close = () => { box.remove(); URL.revokeObjectURL(src); };
    box.onclick = (e) => { if (e.target === box) close(); };
    box.querySelector("#snap-close").onclick = close;
    box.querySelector("#snap-share").onclick = async () => {
      if (canShare) { try { await navigator.share({ files: [file], text, url: u.href }); } catch { /* やめただけ */ } return; }
      box.querySelector("#snap-save").click();   // 画像を渡せないブラウザ: 保存して、X の投稿画面を開く
      window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(u.href)}`, "_blank", "noopener");
    };
  } catch (e) { app.why = L(`画像を作れませんでした（${e.message}）`, `Couldn't make the image (${e.message})`); render(); }
}

/** 今日（JST）のあそぶの回数（帳簿と手元の成立 ＋ いま途中のもの）。シッターのあそぶ（sit: true）は 1 日の上限に数えない（帳簿係と同じ） */
function playsToday(m) {
  const today = localDay(Date.now(), app.box);
  const done = m.events.filter((e) => e.t === "play" && !e.sit && localDay(e.ms, app.box) === today).length;
  const live = app.deals.play?.busy() ? 1 : 0;
  return done + live;
}
/** 押せないときの理由（null なら押せる） */
function actionBlock(kind, st, m) {
  const x = app.deals[kind];
  if (x?.busy()) return x.st.gaveUp ? L("PAPER が戻るのを待っています", "Waiting for the PAPER to come back") : L("いまはその途中です", "Already in progress");   // 種類が違えば同時にできる（財布は lock 中の額を引いて見る）
  const price = { meal: app.box.meal_price, out: app.box.out_price, play: app.box.play_stake }[kind];
  if (st.grave) return L("お墓の間はできません", "Not while it rests in the grave");
  if (m.balance < Number(price)) return L("PAPER が足りません", "Not enough PAPER");
  if (kind === "out" && st.outsToday >= Number(app.box.out_per_day)) return L(`おでかけは 1 日 ${app.box.out_per_day} 回までです`, `Outings are limited to ${app.box.out_per_day} a day`);
  if (kind === "out" && st.hunger < Number(app.box.out_min_hunger ?? 0)) return L(`おなかが ${app.box.out_min_hunger} 以上ないと、おでかけできません`, `It needs a tummy of ${app.box.out_min_hunger} or more to go out`);
  if (kind === "play" && playsToday(m) >= Number(app.box.play_per_day ?? Infinity)) return L(`あそぶは 1 日 ${app.box.play_per_day} 回までです`, `Play is limited to ${app.box.play_per_day} a day`);
  if (kind === "play" && !(app.box.npcs ?? []).length) return L("あそび相手がまだいません", "No playmates yet");
  return null;
}
function renderSaid(fold) {
  const el = $("said"); if (!el) return;
  // これまで食べたご飯: ごはん屋さんのメニュー名を新しい順に 10 個まで（帳簿に載る前の、この画面で届いたものを先に）
  const meals = (fold?.meals ?? []).filter((x) => x.menu).reverse();
  if (app.lastSay && app.lastSayMenu && !meals.some((x) => x.line === app.lastSay)) meals.unshift({ line: app.lastSay });
  meals.splice(10);
  let outs = (fold?.outs ?? []).slice(-1);
  if (app.lastArticle && !(fold?.outs ?? []).some((o) => o.contract === app.lastArticle.contract)) outs = [app.lastArticle];   // 帳簿に載る前の記事
  const h = [
    ...outs.map((o) => `<article class="article">${o.lines.map((l, i) => i === 0 ? `<h3>${esc(l)}</h3>` : `<p>${esc(l)}</p>`).join("")}</article>`),
    ...(meals.length ? [`<p class="label" style="margin-top:12px">${L("これまで食べたご飯", "Meals so far")}</p><ul class="menu">${meals.map((x) => `<li>${esc(x.line)}</li>`).join("")}</ul>`] : []),
  ].join("");
  if (app.saidHtml !== h || (h && !el.firstChild)) { el.innerHTML = h; app.saidHtml = h; }
}

/** 満員か（帳簿の HAKO の数が max_hakos に届いた。帳簿は毎時なので、1 時間の間に少し超えて迎えても、帳簿係が超えた分を数えない） */
const isFull = () => app.box.max_hakos != null && Number(app.stats?.box?.hakos ?? 0) >= Number(app.box.max_hakos);
/** github.io の /tama/ は閉じるので、新しい HAKO を迎えない（運営者 2026-10-04） */
const isClosing = () => location.hostname.endsWith("github.io");
function renderEgg() {
  if (!app.did && (isFull() || isClosing())) {
    $("view").innerHTML = `
    <section class="card" id="me">
      <div class="stage plain short"><div class="egg">${spriteSvg(null, "egg", 5)}</div></div>
      <p class="label" style="margin-top:14px">NEW HAKO</p>
      ${isClosing() ? `<h2>${L("ここでは新しい HAKO を迎えていません", "No new HAKOs here")}</h2>`
        : `<h2>${L("いまは満員です", "We're full right now")}</h2>
      <p>${L("新しい HAKO は、空きが出るまで迎えられません。", "New HAKOs can't be welcomed until there's room.")}</p>`}
      <p class="small">${L("鍵ファイルがあるときは", "Have a key file?")} <label class="link">${L("ファイルから読み込む", "Load it from a file")}<input id="file" type="file" accept="application/json" hidden></label></p>
    </section>`;
    $("file").onchange = importKey;
    return;
  }
  $("view").innerHTML = `
    <section class="card" id="me">
      <div class="stage plain short"><div class="egg">${spriteSvg(null, "egg", 5)}</div></div>
      <p class="label" style="margin-top:14px">NEW HAKO</p>
      <h2>${L("HAKO を迎える", "Welcome a HAKO")}</h2>
      <p>${L("このブラウザの中で鍵を作り、あなたの HAKO が生まれます。鍵は外に送りません。なくすと HAKO を動かせなくなるので、生まれたあとに鍵ファイルを保存してください。", "A key is made inside this browser and your HAKO is born. The key is never sent anywhere. If you lose it you can't move your HAKO, so save the key file once it is born.")}</p>
      <p class="note">${L(`はじめに ${fmt(app.box.initial_paper)} $PAPER を受け取ります。PAPER はこの箱庭の中だけの点数で、お金としての価値はありません。換金も売り買いもできません。`, `You start with ${fmt(app.box.initial_paper)} $PAPER. PAPER is only a score inside this garden and has no monetary value. It can't be cashed out, bought or sold.`)}</p>
      <form class="keyf" id="kf" method="post" action="#">
      <input class="vh" id="u1" name="username" type="text" autocomplete="username" tabindex="-1" aria-hidden="true" value="">
      <label>${L("パスフレーズ（HAKO を起こすときに使います）", "Passphrase (to wake your HAKO)")}<span class="pw"><input id="p1" name="password" type="password" autocomplete="new-password"><button type="button" class="eye" data-eye="p1,p2"></button></span></label>
      <label>${L("もう一度", "Once more")}<span class="pw"><input id="p2" name="password2" type="password" autocomplete="new-password"></span></label>
      <p class="small">${L("ブラウザにパスワードの保存をすすめられたら、保存すると次から自動で入力されます。共用の端末では保存しないでください。", "If your browser offers to save it, you can, and it will fill in next time. Don't save it on a shared device.")}</p>
      <p id="why" class="why"></p>
      <div class="actions"><button type="submit" class="btn" id="born" style="--c:var(--good)"><span class="dot" style="background:var(--good)"></span>${L("生まれる", "Be born")}</button></div>
      </form>
      <p class="small">${L("鍵ファイルがあるときは", "Have a key file?")} <label class="link">${L("ファイルから読み込む", "Load it from a file")}<input id="file" type="file" accept="application/json" hidden></label></p>
    </section>`;
  eyes();
  $("kf").onsubmit = (e) => { e.preventDefault(); register(); };
  $("file").onchange = importKey;
}
/** パスフレーズの「表示／隠す」 */
function eyes() {
  for (const b of document.querySelectorAll("[data-eye]")) b.onclick = () => {
    b.dataset.on = b.dataset.on === "1" ? "" : "1";
    for (const id of b.dataset.eye.split(",")) { const el = $(id); if (el) el.type = b.dataset.on ? "text" : "password"; }
    label(b);
  };
  const label = (b) => { b.textContent = b.dataset.on ? L("隠す", "Hide") : L("表示", "Show"); b.setAttribute("aria-label", b.dataset.on ? L("パスフレーズを隠す", "Hide passphrase") : L("パスフレーズを表示する", "Show passphrase")); };
  for (const b of document.querySelectorAll("[data-eye]")) label(b);
}
/** 起こす前の姿（帳簿から分かる育ちの段で、目を閉じて眠る。お墓なら幽霊） */
function sleeping() {
  let st = null; try { st = lifeState(merged(app.stats, app.did).events, Date.now(), app.box); } catch { st = null; }
  return spriteSvg(app.did, st?.born ? (st.grave ? "ghost" : st.stage) : "egg", 6, { eye: "line", level: st?.accLevel ?? 1 });
}
function renderUnlock() {
  $("view").innerHTML = `
    <section class="card" id="me">
      <div class="stage plain">${app.did ? `<div class="hako">${sleeping()}</div>` : ""}</div>
      <p>${L(`${esc(K.nameOf(K.loadRec(), app.did))} が眠っています。パスフレーズを入れると起きます。`, `${esc(K.nameOf(K.loadRec(), app.did))} is asleep. Enter your passphrase to wake it.`)}</p>
      <form class="keyf" id="kf" method="post" action="#">
      <input class="vh" name="username" type="text" autocomplete="username" tabindex="-1" aria-hidden="true" value="${esc(K.loginName(app.did))}" readonly>
      <label>${L("パスフレーズ", "Passphrase")}<span class="pw"><input id="p1" name="password" type="password" autocomplete="current-password"><button type="button" class="eye" data-eye="p1"></button></span></label>
      <p class="small">${L("ブラウザにパスワードの保存をすすめられたら、保存すると次から自動で入力されます。共用の端末では保存しないでください。", "If your browser offers to save it, you can, and it will fill in next time. Don't save it on a shared device.")}</p>
      <p id="why" class="why"></p>
      <div class="actions"><button type="submit" class="btn" id="open">${L("HAKO を起こす", "Wake HAKO")}</button></div>
      <label class="small"><input id="tab" type="checkbox" checked> ${L("このタブを閉じるまで起こしたままにする（開いているほかのタブでも、入れ直さずに使えます）", "Keep awake until this tab is closed (works in your other open tabs too)")}</label>
      </form>
    </section>`;
  eyes();
  $("kf").onsubmit = (e) => { e.preventDefault(); unlock(); };
}
/** 知らせを出す。bad = うまくいかなかった知らせ（色を変える）。出したら見える所まで動かす */
const say = (s, bad = true) => { app.why = s; app.whyBad = !!s && bad; app.whyAt = Date.now(); const w = $("why"); if (!w) return; w.textContent = s; w.classList.toggle("bad", !!s && bad); if (s) w.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); };

async function register() {
  const p1 = $("p1").value, p2 = $("p2").value;
  if (p1.length < 12) return say(L("パスフレーズは 12 文字以上にしてください", "Use a passphrase of 12 characters or more"));
  if (p1 !== p2) return say(L("2 つのパスフレーズが違います", "The two passphrases don't match"));
  if (isClosing()) return say(L("ここでは新しい HAKO を迎えていません", "No new HAKOs here"));
  if (isFull()) return say(L("いまは満員です", "We're full right now"));
  if (!(await K.supported())) return say(L("このブラウザは Ed25519 の鍵を作れません。新しいブラウザで開いてください", "This browser can't make an Ed25519 key. Please open it in a newer browser."));
  say(L("鍵を作っています…", "Making your key…"), false);
  const { priv, did, rec } = await K.makeKey(p1);
  K.saveRec(rec); await K.rememberTab(priv, did);
  const u = $("u1"); if (u) u.value = K.loginName(did);   // パスワード保存の「ユーザー名」（どの HAKO のパスフレーズか）
  app.did = did; app.priv = priv; app.signer = watched(makeSigner(did, priv));
  try {
    await app.signer.post(app.box.board, tamaLine({ t: "join", v: 1, n: rand() }));
  } catch (e) { say(L(`掲示板に出せませんでした（${e.message}）。もう一度押してください`, `Couldn't post to the board (${e.message}). Please press again.`)); return; }
  addLocal(did, { t: "join", ms: Date.now() });
  K.offerSave(did, p1);
  K.downloadRec(rec);
  app.rebornUntil = Date.now() + 2500; setTimeout(render, 2600);
  await boot();
}
async function importKey(ev) {
  try {
    const j = JSON.parse(await ev.target.files[0].text());
    if (!K.isKeyFile(j)) return say(L("鍵ファイルではありません", "That is not a key file"));
    const cur = K.loadRec();   // 今の鍵を黙って上書きしない（2026-10-03 の点検）
    if (cur && cur.did !== j.did && !confirm(L(`今の ${K.nameOf(cur, cur.did)} の鍵を、読み込んだ鍵で置き換えます。今の鍵ファイルを保存していないと、今の HAKO には戻れません。置き換えますか？`, `This replaces the key for ${K.nameOf(cur, cur.did)} with the one you loaded. If you haven't saved the current key file, you can't get back to this HAKO. Replace it?`))) return;
    K.saveRec(j); app.did = j.did; render();
  } catch (e) { say(L(`読めませんでした（${e.message}）`, `Couldn't read it (${e.message})`)); }
}
async function unlock() {
  const rec = K.loadRec();
  try {
    const pass = $("p1").value;
    const priv = await K.openKey(rec, pass);
    app.priv = priv; app.signer = watched(makeSigner(app.did, priv));
    K.offerSave(app.did, pass);
    if ($("tab").checked) await K.rememberTab(priv, app.did);
    await boot();
  } catch { say(L("パスフレーズが違います", "Wrong passphrase")); }
}
async function reborn() {
  try { await app.signer.post(app.box.board, tamaLine({ t: "reborn", n: rand() })); }
  catch (e) { return say(L(`掲示板に出せませんでした（${e.message}）`, `Couldn't post to the board (${e.message})`)); }
  const fee = Math.min(Number(app.box.reborn_price ?? 0), Math.max(0, app.balance ?? 0));   // D-101: 足りなければ残高 0 まで
  addLocal(app.did, { t: "reborn", ms: Date.now() }, -fee);
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
    if (document.body.dataset.tab !== "me") for (const a of document.querySelectorAll('[data-tab-to="me"]')) a.classList.add("ping");   // ほかの画面を見ている間に終わった印
    addLocal(app.did, { t: kind, ms: ev.ms, contract: ev.contract, ...(kind === "play" ? { payout: ev.delta + Number(app.box.play_stake) } : {}) }, ev.delta);   // あそぶの戻りは部屋の稼ぎに数える
    if (kind === "play") app.happyUntil = Date.now() + 8000;
    if (kind === "out" && ev.lines) {
      let facts = null; try { facts = JSON.parse(app.deals.out.st.offer.job.context).facts; } catch { facts = null; }
      app.lastArticle = { contract: ev.contract, lines: facts ? fillArticle(ev.lines, facts) : ev.lines };
    }
    app.whyBad = false; app.whyAt = null;
    if (kind === "meal" && ev.say) { app.lastSay = ev.say; app.lastSayMenu = app.box.meal_menu_from != null && Date.now() >= Number(app.box.meal_menu_from); app.sayFresh = true; app.why = ""; }
    else if (ev.say) app.why = ev.say;
    logOp(`settled · ${kind} · ${short(ev.contract)} · ${ev.delta >= 0 ? "+" : ""}${ev.delta} PAPER`);
  } else if (ev.type === "note") { app.why = ev.text; app.whyBad = false; app.whyAt = null; }
  render();
}

// ── 起動 ──
export async function boot() {
  app.why = ""; app.viewHtml = null;
  for (const [k] of dealKinds) app.deals[k] = new Deal({ kind: k, app, onEvent: (ev) => onDeal(k, ev) });
  app.sits = loadSits();
  render();
  loadStats().then((s) => { app.stats = s; render(); }).catch(() => { /* 次の周 */ });   // 鍵を読み込んだ・生まれた直後は、その HAKO の帳簿をまだ読んでいない
  const tick = async () => {
    for (const x of Object.values(app.deals)) await x.tick().catch((e) => x.note?.(`error ${e.message}`));
    await tickSits();
    if (!document.hidden) render();
  };
  setInterval(tick, 5000);
  setInterval(async () => { try { app.stats = await loadStats(); } catch { /* 次の周 */ } }, 5 * 60_000);
  tick();
}
/** HAKO ごとの帳簿のファイル名（tama_site.py の did_file と同じ）。did:key:z… の z… の部分 */
const didFile = (did) => `${String(did).split(":").pop()}.json`;
/** 帳簿を読む: 庭用の garden.json と、自分の HAKO の d/<z…>.json だけ（運営者 2026-10-03。全員分の latest.json を 5 分ごとに読むと配信が匹数の 2 乗で増える）。
 *  返すのは latest.json と同じ形（box と、自分の分だけの did）に、庭の feed と counts を足したもの。garden.json が無い古いサイトでは latest.json を読む */
async function loadStats() {
  // 帳簿は 1 時間に 1 回しか変わらないので、毎回まるごと取り直さず再検証する（変わっていなければ 304 で中身を送らない。Firebase の配信を減らす）
  const get = (u) => fetch(u, { cache: "no-cache" });
  const r = await get("garden.json");
  if (!r.ok) { const old = await get("latest.json"); if (!old.ok) throw new Error(`garden.json ${r.status}`); return await old.json(); }
  const g = await r.json(), did = app.did ?? K.loadRec()?.did, out = { box: g.box, feed: g.feed, counts: g.counts, did: {} };
  if (did) { try { const m = await get(`d/${didFile(did)}`); if (m.ok) Object.assign(out.did, (await m.json()).did ?? {}); } catch { /* まだ帳簿に載っていない */ } }
  return out;
}
export async function start() {
  try { app.stats = await loadStats(); } catch { app.stats = null; }
  app.box = app.stats?.box?.config ?? (await (await fetch("tama_box.json")).json());
  try { app.F = await (await fetch("tama_furniture.json")).json(); } catch { app.F = null; }
  try { app.P = await (await fetch("tama_phrases.json")).json(); } catch { app.P = null; }   // ひとことの語録（D-121）
  try { app.moods = await (await fetch(`moods.json?t=${Date.now()}`, { cache: "no-store" })).json(); } catch { app.moods = null; }
  setVenue(app.box.venue);
  const rec = K.loadRec();
  app.did = rec?.did ?? null;
  if (app.did) {
    app.priv = await K.recallTab(app.did);
    if (app.priv) { app.signer = watched(makeSigner(app.did, app.priv)); return boot(); }
  }
  render();
}
