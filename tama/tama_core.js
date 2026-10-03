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
//   6. 連続お世話日数は、いまの命の中で、ごはん・あそぶのどれかが成立した日（JST）が、今日か昨日から何日続いているか
//   8. 育ちの段は、いまの命について: 卵 →（お世話 hatch_cares 回 かつ hatch_hours 時間）生まれた子 →（grow_hours 時間 かつ お世話した日 grow_care_days 日）HAKO。生まれ変わると卵から
//   9. おるすばん（D-123）: 出来事 sit {ms, until} の間はお墓までの時計を止める。予約のごはん・あそぶ（meal・play に sit: true）は、ふだんと同じに
//      お世話として数える（育ちにも効く。運営者のヒアリング 2026-10-03）。連続日数は、お世話の届かなかったおるすばん中の日を飛ばして数える
//  10. おでかけは、おなかを減らすがお世話に数えない（回数・お世話した日・連続日数・育ち・飾りのどれにも。稼ぎと記事のもの。2026-10-03）
//   7. あそぶの戻りは契約 id（offer と accept を束ねたハッシュ）の先頭 8 桁の 16 進 mod 100 を、play_table の重みで引く（D-96）

export const HOUR = 3_600_000;

/** JST（box.day_utc_offset_min）の日付 YYYY-MM-DD */
export function localDay(ms, box) {
  return new Date(ms + Number(box.day_utc_offset_min ?? 540) * 60_000).toISOString().slice(0, 10);
}
const dayNum = (d) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** おるすばんの区間 [[from, until], …] を時刻順に重ねてまとめる（D-123） */
export function mergeCovers(list) {
  const out = [];
  for (const [a, b] of list.filter(([a, b]) => b > a).sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]))) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}
/** start から、おるすばんの外の時間が need たまる時刻（お墓になる時刻。区間の中は時計が止まる） */
export function graveTime(start, need, covers) {
  let t = start, left = need;
  for (const [a, b] of covers) {
    if (b <= t) continue;
    if (a > t) { if (a - t >= left) return t + left; left -= a - t; }
    t = Math.max(t, b);
  }
  return t + left;
}

/**
 * 出来事 → いまの状態。events は [{t, ms}]（t: join | reborn | meal | out | play）。順は問わない（ms、同時なら並びの順）。
 * 返す: {born, alive, grave, graveAt, bornAt, hunger, mood, streak, rebirths, outsToday, careDays, lastCare}
 */
export function lifeState(events, now, box) {
  const ev = events.map((e, i) => ({ ...e, i })).sort((a, b) => (a.ms - b.ms) || (a.i - b.i));
  const hr = Number(box.hunger_per_hour), mr = Number(box.mood_per_hour);
  const hMax = Number(box.hunger_max), mMax = Number(box.mood_max);
  const graveMs = Number(box.grave_after_hours) * HOUR;
  const covers = mergeCovers(ev.filter((e) => e.t === "sit").map((e) => [Number(e.ms), Number(e.until)]));
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
    if (s.zeroSince !== null) { const g = graveTime(s.zeroSince, graveMs, covers); if (t >= g) { s.grave = true; s.graveAt = g; } }
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
    if (e.t === "out") continue;   // おでかけはお世話に数えない（稼ぎと記事のもの。D-119・D-123 の改め 2026-10-03）
    s.days.add(localDay(e.ms, box));
    s.lastCare = e.ms;
    s.cares += 1;
  }
  if (!s) return { born: false };
  advance(now);
  const today = localDay(now, box);
  const days = [...s.days].sort();
  let streak = 0;
  // おるすばん中の日（いまの命の中）は飛ばす。今日はまだお世話していなくても途切れない
  const frozen = new Set();
  for (const [a, b] of covers) { for (let d = dayNum(localDay(Math.max(a, s.bornAt), box)), e = dayNum(localDay(Math.min(b, now), box)); d <= e; d++) frozen.add(d); }
  if (!s.grave && days.length) {
    const set = new Set(days.map(dayNum));
    const lo = Math.min(...set, ...frozen);
    for (let want = dayNum(today), first = true; want >= lo; want--, first = false) {
      if (set.has(want)) streak += 1;
      else if (!first && !frozen.has(want)) break;
    }
  }
  const cover = covers.find(([a, b]) => a <= now && now < b);
  const outsToday = ev.filter((e) => e.t === "out" && e.ms >= s.bornAt && localDay(e.ms, box) === today).length;
  return { born: true, alive: !s.grave, grave: s.grave, graveAt: s.graveAt, bornAt: s.bornAt,
    hunger: round2(s.hunger), mood: round2(s.mood), streak, rebirths, outsToday, careDays: days.length, lastCare: s.lastCare ?? null,
    cares: s.cares, stage: growthStage(s.cares, days.length, now - s.bornAt, box),
    accLevel: accLevel(days.length, growthStage(s.cares, days.length, now - s.bornAt, box), box), sitUntil: cover ? cover[1] : null };
}
export const round2 = (x) => Math.round(x * 100) / 100;
/** 飾りの段（D-119。2026-10-03 から日数で）: HAKO のとき、いまの命のお世話した日が acc_grow_days に届くたびに 1 段。1〜4。生まれ変わると 1 から。
 *  自分でお世話しても、シッターに頼んでも同じ速さで育つ（回数で数えない） */
export function accLevel(careDays, stage, box) {
  if (stage !== "hako") return 1;
  let lv = 1;
  for (const c of box.acc_grow_days ?? []) if (careDays >= Number(c)) lv += 1;
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
/** あそぶの表（2026-10-03 に戻りの平均を 100 → 150 に。D-31: 前の契約の結果は変えない）: lock の時刻が play_table_from より前なら play_table_before */
export const playTableAt = (box, lockMs) => (box.play_table_from != null && lockMs < Number(box.play_table_from) && box.play_table_before ? box.play_table_before : box.play_table);
/** あそぶの引き（2026-10-03 の点検から。tama_core.py の play_roll と同じ）: sha256(NPC の秘密 ‖ 契約 id)。秘密は払ったあとの reveal で初めて分かる */
export async function playRoll(secret, contract) {
  const hx = (s) => String(s ?? "").replace(/^0x/, "");
  const a = hx(secret), c = hx(contract);
  if (!/^([0-9a-f]{2})+$/i.test(a) || !/^([0-9a-f]{2})+$/i.test(c)) return null;
  const bytes = Uint8Array.from((a + c).match(/../g), (h) => parseInt(h, 16));
  return "0x" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
/** lock の時刻で決め方を切り替える（D-31）。play_secret_from より前は契約 id だけで引く */
export async function playPayoutAt(box, lockMs, contract, secret) {
  const table = playTableAt(box, lockMs);
  if (box.play_secret_from != null && lockMs >= Number(box.play_secret_from)) { const roll = await playRoll(secret, contract); return roll ? playPayout(roll, table) : null; }
  return playPayout(contract, table);
}
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
const URL_RE = /(:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|xyz|ly|me|app|dev|jp|co|gg|link|site|top|info|biz|ru|cn|tk|click|online|shop)\b)/i;   // URL を書かせない（庭に詐欺の誘いを出させない。2026-10-03 の点検）
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
    if (URL_RE.test(l)) return { ok: false, why: `${k + 1}:url` };
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
  const m = new RegExp(`^${box.box}-(meal|out|play|sit|sitplay)-[0-9a-z]{8}-[0-9]+$`).exec(String(id ?? ""));
  return m ? m[1] : null;
}
/** accept を知らせるノートのキー（miner・NPC が書き、ブラウザが読む） */
/** おるすばんの種類（D-123）: sit は予約のごはん、sitplay は予約のあそぶ（シッターが遊んであげる。賭けは無い） */
export const isSit = (kind) => kind === "sit" || kind === "sitplay";
export const acceptKey = (payer, kind, offerId = "") => `${String(payer).slice(-8).toLowerCase()}-${kind}` + (isSit(kind) ? `-${String(offerId).slice(2, 10)}` : "");
/** おるすばんの予約（D-123）: 1 回目のごはんは t0 ＋ first 時間（既定 sit_first_hours。頼んですぐに変化が見えるように）、そのあと sit_every_hours ごと。
 *  あそぶ（1 日 plays 回）は、その日のごはんの j × sit_play_gap_hours 後（j = 1..plays）。claimByMs ＝ at ＋ sit_window_hours、refundAfterMs ＝ claimByMs ＋ 1 時間。
 *  延長は t0 ＝ 前の予約の最後のごはん、first ＝ sit_every_hours で続ける */
export function sitSchedule(box, t0, n, plays = 0, first = Number(box.sit_first_hours ?? box.sit_every_hours)) {
  const one = (kind, k, j, at) => { const claimByMs = at + Math.round(Number(box.sit_window_hours) * HOUR); return { kind, k, j, at, claimByMs, refundAfterMs: claimByMs + HOUR }; };
  const out = [];
  for (let k = 1; k <= n; k++) {
    const meal = t0 + Math.round((first + (k - 1) * Number(box.sit_every_hours)) * HOUR);
    out.push(one("sit", k, 0, meal));
    for (let j = 1; j <= plays; j++) out.push(one("sitplay", k, j, meal + Math.round(j * Number(box.sit_play_gap_hours) * HOUR)));
  }
  return out;
}
/** sit の offer の期限と届ける時刻が決まりどおりか（lockMs は lock の時刻。miner は accept の前に now で見る）→ 理由か null */
export function sitWhy(box, offer, lockMs) {
  let at; try { at = JSON.parse(offer.job.context).at; } catch { return "no at"; }
  if (typeof at !== "number" || !Number.isInteger(at)) return "no at";
  if (offer.claimByMs !== at + Math.round(Number(box.sit_window_hours) * HOUR) || offer.refundAfterMs !== offer.claimByMs + HOUR) return "deadlines";
  if (at <= lockMs) return "at not ahead";
  if (at - lockMs > Number(box.sit_max_days) * Number(box.sit_every_hours) * HOUR + HOUR) return "too far";
  return null;
}

// ── 注文の指示文の確かめ（2026-10-03 の点検: 注文側が好きな指示文を送って、庭に詐欺や攻撃の文を出させない）。miner と帳簿係が同じものを使う ──
export const HUNGER_WORDS = ["starving", "hungry", "a bit peckish"], MOOD_WORDS = ["gloomy", "calm", "cheerful"];
/** 街の雰囲気の指標の名前（tama_mood.py の LABELS と同じ。試験で照らす） */
export const MOOD_LABELS = { flow: "how busy the market was", alike: "the share of messages that looked alike", nocontract: "the share of accepts without a contract field",
  refund: "the share of deals that ended in a refund", newcomer: "the share of faces never seen before" };
const FACT_VALUE = /^[0-9]{1,6}(%| lines a minute)$/;
/** job.context（文字列）が、その種類の公式の形か。play は指示文を使わないので常に true */
export function promptOk(box, kind, context) {
  if (kind === "play") return true;
  let c = null; try { c = JSON.parse(String(context)); } catch { return false; }
  if (!c || typeof c !== "object" || typeof c.prompt !== "string") return false;
  if (kind === "out") {
    const f = c.facts;
    if (!f || typeof f !== "object" || MOOD_LABELS[f.metric] !== f.label || !["higher", "lower"].includes(f.dir) || !FACT_VALUE.test(String(f.value)) || !FACT_VALUE.test(String(f.base))) return false;
    return c.prompt === outPrompt(box.out_instruction, f);
  }
  const ins = kind === "sitplay" ? box.sit_play_instruction : box.meal_instruction;
  return HUNGER_WORDS.some((h) => MOOD_WORDS.some((m) => c.prompt === collapseSpace(`${ins} Mood words: ${h}, ${m}.`)));
}
