// tama_core.js — たまごっち版（HAKONIWA_tamagotchi_spec_2026-09-28.md）の計算の芯。ブラウザ・node（miner・NPC）の両方で動く。
// 帳簿係（tama_fold.py）は tama_core.py の同じ関数を使う。変えるときは両方を変え、tests/tama_vectors.json を両方に通す
// （tests/test_tama_core.py、tests/tama_core_check.mjs）。通信と sha256 は持たない（呼ぶ側が持つ）。
//
// 1 行ずつの規則:
//   1. 状態は時刻と帳簿の出来事から、表示のたびに計算する（D-89）。出来事は join・reborn・meal・out・play の成立時刻だけ
//   2. おなかは 1 時間に hunger_per_hour ずつ減り、0 で止まる。ごはんで +meal_fill、おでかけで −out_hunger、あそぶで −play_hunger
//   3. ごきげんは 1 時間に mood_per_hour ずつ減り、0 で止まる。あそぶで +play_mood（仮。仕様にはあそぶの +20 だけがある）
//   4. おなかが 0 のまま grave_after_hours 続いたら、その時刻にお墓（D-90）。お墓の間の出来事は状態を動かさない（PAPER は動く）
//   5. reborn はお墓のときだけ効く。同じ DID で、おなかは reborn_hunger、ごきげんは生まれたときの値、連続日数は 0 から（D-91、D-101）
//   6. 連続お世話日数は、いまの命の中で、ごはん・おでかけ・あそぶのどれかが成立した日（JST）が、今日か昨日から何日続いているか
//   8. 育ちの段は、いまの命について: 卵 →（お世話 hatch_cares 回 かつ hatch_hours 時間）生まれた子 →（grow_hours 時間 かつ お世話した日 grow_care_days 日）HAKO。生まれ変わると卵から
//   7. あそぶの戻りは契約 id（offer と accept を束ねたハッシュ）の先頭 8 桁の 16 進 mod 100 を、play_table の重みで引く（D-96）

export const HOUR = 3_600_000;

/** JST（box.day_utc_offset_min）の日付 YYYY-MM-DD */
export function localDay(ms, box) {
  return new Date(ms + Number(box.day_utc_offset_min ?? 540) * 60_000).toISOString().slice(0, 10);
}
const dayNum = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * 出来事 → いまの状態。events は [{t, ms}]（t: join | reborn | meal | out | play）。順は問わない（ms、同時なら並びの順）。
 * 返す: {born, alive, grave, graveAt, bornAt, hunger, mood, streak, rebirths, outsToday, careDays, lastCare}
 */
export function lifeState(events, now, box) {
  const ev = events.map((e, i) => ({ ...e, i })).sort((a, b) => (a.ms - b.ms) || (a.i - b.i));
  const hr = Number(box.hunger_per_hour), mr = Number(box.mood_per_hour);
  const hMax = Number(box.hunger_max), mMax = Number(box.mood_max);
  const graveMs = Number(box.grave_after_hours) * HOUR;
  let s = null;   // いまの命: {bornAt, hunger, mood, at, zeroSince, grave, graveAt, days:Set}
  let rebirths = 0;
  const fresh = (ms, reborn = false) => ({ bornAt: ms, hunger: Number(reborn ? (box.reborn_hunger ?? box.hunger_start) : box.hunger_start), mood: Number(box.mood_start), at: ms,
    zeroSince: null, grave: false, graveAt: null, days: new Set(), cares: 0 });
  // at から t まで時間を進める（お墓になる時刻を越えたらそこで止める）
  const advance = (t) => {
    if (!s || s.grave || t <= s.at) return;
    const dtH = (t - s.at) / HOUR;
    if (s.zeroSince === null) {
      const h = s.hunger - hr * dtH;
      if (h <= 0) {
        // 0 に着いた時刻
        s.zeroSince = hr > 0 ? s.at + (s.hunger / hr) * HOUR : t;
        s.hunger = 0;
      } else s.hunger = h;
    }
    s.mood = Math.max(0, s.mood - mr * dtH);
    if (s.zeroSince !== null && t - s.zeroSince >= graveMs) { s.grave = true; s.graveAt = s.zeroSince + graveMs; }
    s.at = t;
  };
  for (const e of ev) {
    if (e.t === "join") { if (!s) s = fresh(e.ms); continue; }
    if (!s) continue;
    advance(e.ms);
    if (e.t === "reborn") { if (s.grave) { rebirths += 1; s = fresh(e.ms, true); } continue; }
    if (s.grave) continue;
    if (e.t === "meal") s.hunger = clamp(s.hunger + Number(box.meal_fill), 0, hMax);
    else if (e.t === "out") s.hunger = clamp(s.hunger - Number(box.out_hunger), 0, hMax);
    else if (e.t === "play") { s.hunger = clamp(s.hunger - Number(box.play_hunger), 0, hMax); s.mood = clamp(s.mood + Number(box.play_mood), 0, mMax); }
    else continue;
    s.zeroSince = s.hunger > 0 ? null : (s.zeroSince ?? e.ms);
    s.days.add(localDay(e.ms, box));
    s.lastCare = e.ms;
    s.cares += 1;
  }
  if (!s) return { born: false };
  advance(now);
  const today = localDay(now, box);
  const days = [...s.days].sort();
  let streak = 0;
  if (!s.grave && days.length) {
    let want = days.includes(today) ? dayNum(today) : dayNum(today) - 1;
    const set = new Set(days.map(dayNum));
    while (set.has(want)) { streak += 1; want -= 1; }
  }
  const outsToday = ev.filter((e) => e.t === "out" && e.ms >= s.bornAt && localDay(e.ms, box) === today).length;
  return { born: true, alive: !s.grave, grave: s.grave, graveAt: s.graveAt, bornAt: s.bornAt,
    hunger: round2(s.hunger), mood: round2(s.mood), streak, rebirths, outsToday, careDays: days.length, lastCare: s.lastCare ?? null,
    cares: s.cares, stage: growthStage(s.cares, days.length, now - s.bornAt, box),
    accLevel: accLevel(s.cares, growthStage(s.cares, days.length, now - s.bornAt, box), box) };
}
export const round2 = (x) => Math.round(x * 100) / 100;
/** 飾りの段（D-119）: HAKO になってから、いまの命のお世話の合計が acc_grow_cares（毎日上限まで全部のお世話で 2 日ずつ）に届くたびに 1 段。1〜4。生まれ変わると 1 から */
export function accLevel(cares, stage, box) {
  if (stage !== "hako") return 1;
  let lv = 1;
  for (const c of box.acc_grow_cares ?? []) if (cares >= Number(c)) lv += 1;
  return Math.min(lv, 4);
}
/** 育ちの段（D-107、D-109）: 回数だけでは進まず、時間もかかる。値は仮（hatch_cares・hatch_hours・grow_hours・grow_care_days） */
export function growthStage(cares, careDays, ageMs, box) {
  const h = ageMs / HOUR;
  if (cares < Number(box.hatch_cares ?? 0) || h < Number(box.hatch_hours ?? 0)) return "egg";
  if (h < Number(box.grow_hours ?? 0) || careDays < Number(box.grow_care_days ?? 0)) return "baby";
  return "hako";
}

/** あそぶの戻り（D-96）。contract は 0x で始まる 64 桁の 16 進。table は [[重み, 額], …]（重みの合計 100） */
export function playPayout(contract, table) {
  const hex = String(contract).replace(/^0x/, "");
  if (!/^[0-9a-f]{8}/i.test(hex)) return null;
  const r = Number.parseInt(hex.slice(0, 8), 16) % 100;
  let acc = 0;
  for (const [w, amount] of table) { acc += Number(w); if (r < acc) return Number(amount); }
  return Number(table[table.length - 1][1]);
}

// ── 納品の検査（旧仕様 D-74 をそのまま。帳簿係と miner が同じものを使う） ──
const STRIP = /^[ \t\r]+|[ \t\r]+$/g;
const DID_RE = /did:key|z6mk[1-9a-z]{8,}/i;
const WORD_RE = /[a-z0-9{}']+/g;
const cpLen = (s) => Array.from(String(s)).length;
const words = (s) => String(s).toLowerCase().match(WORD_RE) ?? [];
export const collapseSpace = (s) => String(s).split(/\s+/).filter((x) => x).join(" ");

/** モデルの出力 → 行。頭と尻の空行は落とし、間の空行は残す（検査で ng） */
export function splitLines(output) {
  const lines = String(output).replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(STRIP, ""));
  while (lines.length && lines[0] === "") lines.shift();
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * 行の検査 → {ok, why}。規則: 行数が n／各行 maxChars 以内／DID を含まない／指示文の語が fragmentWords 続けて同じ順で出ない／
 * 空行なし／同じ行なし。needs は [[行番号(0 始まり), 含むべき文字列], …]。digitsOk が false なら、needs 以外の数字を許さない
 */
export function checkLines(lines, { n, maxChars = 140, instruction = "", fragmentWords = 5, needs = [], digitsOk = true }) {
  if (!Array.isArray(lines)) return { ok: false, why: "not lines" };
  if (lines.length !== n) return { ok: false, why: `${lines.length} lines, want ${n}` };
  const seen = new Set();
  const iw = words(instruction);
  for (let k = 0; k < lines.length; k++) {
    const l = String(lines[k]);
    if (l === "") return { ok: false, why: `${k + 1}:empty` };
    if (cpLen(l) > maxChars) return { ok: false, why: `${k + 1}:over ${maxChars}` };
    if (DID_RE.test(l)) return { ok: false, why: `${k + 1}:did` };
    if (seen.has(l)) return { ok: false, why: `${k + 1}:duplicate` };
    seen.add(l);
    const lw = words(l);
    for (let i = 0; i + fragmentWords <= lw.length; i++) {
      const g = lw.slice(i, i + fragmentWords).join(" ");
      for (let j = 0; j + fragmentWords <= iw.length; j++) if (iw.slice(j, j + fragmentWords).join(" ") === g) return { ok: false, why: `${k + 1}:instruction fragment` };
    }
    if (!digitsOk && /[0-9]/.test(l.replace(/\{[A-Z]\}/g, ""))) return { ok: false, why: `${k + 1}:digits` };
  }
  for (const [i, s] of needs) if (!String(lines[i] ?? "").includes(s)) return { ok: false, why: `${i + 1}:missing ${s}` };
  return { ok: true, why: "" };
}

/** その日の nth 回目（1 から）のおでかけの報酬（D-103。out_rewards の nth 番目。表の外は 0） */
export function rewardOf(box, nth) {
  const r = box.out_rewards;
  if (!Array.isArray(r)) return Number(box.out_reward ?? 0);
  return nth >= 1 && nth <= r.length ? Number(r[nth - 1]) : 0;
}

/** おでかけの記事: {V} {B} をコードで差し込む（D-87。数字はモデルに書かせない） */
export const fillArticle = (lines, facts) => lines.map((l) => l.split("{V}").join(String(facts.value)).split("{B}").join(String(facts.base)));

/** ごはんの入力（1 推論）: 指示文 ＋ 気分の言葉 */
export function mealPrompt(instruction, st) {
  const h = st.hunger < 25 ? "starving" : st.hunger < 60 ? "hungry" : "a bit peckish";
  const m = st.mood < 25 ? "gloomy" : st.mood < 60 ? "calm" : "cheerful";
  return collapseSpace(`${instruction} Mood words: ${h}, ${m}.`);
}
/** おでかけの入力（1 推論）: 指示文 ＋ 測った事実の 1 行（名前と、普段との違いの向き。数字は {V} {B} で渡す） */
export function outPrompt(instruction, facts) {
  return collapseSpace(`${instruction} Today's unusual thing: ${facts.label} was ${facts.dir} than usual.`);
}

/** tama/0 の行 */
export const TAMA = "tama/0 ";
export const toAscii = (s) => s.replace(/[\u0080-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
export const tamaLine = (obj) => TAMA + toAscii(JSON.stringify(obj));
export function parseTama(text) {
  const t = String(text ?? "");
  if (!t.startsWith(TAMA)) return null;
  try { const v = JSON.parse(t.slice(TAMA.length)); return v && typeof v === "object" && !Array.isArray(v) && typeof v.t === "string" ? v : null; } catch { return null; }
}

/** job.id: tama-<kind>-<DID 末尾 8 を小文字>-<ms> */
export const jobId = (box, kind, did, ms) => `${box.box}-${kind}-${String(did).slice(-8).toLowerCase()}-${ms}`;
export function jobKind(box, id) {
  const m = new RegExp(`^${box.box}-(meal|out|play)-[0-9a-z]{8}-[0-9]+$`).exec(String(id ?? ""));
  return m ? m[1] : null;
}
/** accept を知らせるノートのキー（miner・NPC が書き、ブラウザが読む） */
export const acceptKey = (payer, kind) => `${String(payer).slice(-8).toLowerCase()}-${kind}`;
