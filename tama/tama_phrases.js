// tama_phrases.js — ひとことの語録から、いまの状態に合う一言を選ぶ（D-121）。語録は tama_phrases.json。
// どれを言うかはコードが決める（D-87）。モデルが書いたごはんの一文は一覧に残し、吹き出しはこの語録から出す。
// 条件: morning（その人の時計で 5〜10 時）・night（21〜2 時）・hungry（おなか 30 未満）・fed（ごはん成立から 10 分）・happy（ごきげん 70 以上）・grumpy（30 未満）・
//       home（おでかけ成立から 30 分）・twist:<指標>（最後のおでかけの捻り）・lv4（飾りが段 4）・waiting（取引の成立待ち）・any（いつでも）。
// 状態に合うものがあれば specific_share（7 割）の確からしさでそこから選び、残りは any から。投資が元ネタのもの（invest）は 1 日 invest_per_day 個まで。

/** 文字列 → 0 以上 1 未満（FNV-1a 32 bit。同じ種なら同じ値） */
export function unit(seed) {
  let h = 0x811c9dc5;
  for (const ch of String(seed)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h / 2 ** 32;
}
/** いまの状態 → 当てはまる条件の集合。s = { hour, hunger, mood, fedAgoMin, homeAgoMin, twist, level, waiting } */
export function conditions(s) {
  const c = new Set();
  const h = s.hour;
  if (h >= 5 && h < 10) c.add("morning");
  if (h >= 21 || h < 2) c.add("night");
  if (s.hunger != null && s.hunger < 30) c.add("hungry");
  if (s.fedAgoMin != null && s.fedAgoMin <= 10) c.add("fed");
  if (s.mood != null && s.mood >= 70) c.add("happy");
  if (s.mood != null && s.mood < 30) c.add("grumpy");
  if (s.homeAgoMin != null && s.homeAgoMin <= 30) c.add("home");
  if (s.twist) c.add(`twist:${s.twist}`);
  if (s.level >= 4) c.add("lv4");
  if (s.waiting) c.add("waiting");
  return c;
}
/** 語録 P と状態 s から 1 つ選ぶ。seed は選び方の種（同じ種なら同じ一言）。avoid は直前の id、investLeft はきょう残っている投資ネタの数。
 *  force: "fed" など、その条件のものから必ず選ぶ（食べた直後の一言）。当てはまるものが無ければ null */
export function pickPhrase(P, s, seed, { avoid = null, investLeft = Infinity, force = null } = {}) {
  const list = (P?.phrases ?? []).filter((p) => p.id !== avoid && (!p.invest || investLeft > 0));
  const have = conditions(s);
  if (force) have.add(force);
  const specific = list.filter((p) => p.when.some((w) => w !== "any" && have.has(w)));
  const forced = force ? specific.filter((p) => p.when.includes(force)) : [];
  const any = list.filter((p) => p.when.includes("any"));
  const r = unit(`${seed}:pick`);
  const pool = forced.length ? forced : specific.length && (r < Number(P?.specific_share ?? 0.7) || !any.length) ? specific : any;
  if (!pool.length) return null;
  return pool[Math.floor(unit(`${seed}:which`) * pool.length)];
}
/** 吹き出しの文と、一覧・説明に出す全文（選んでいる言語で） */
export const phraseText = (p, lang) => ({ short: lang === "ja" ? p.ja : p.en, full: (lang === "ja" ? p.full_ja ?? p.ja : p.full_en ?? p.en) });
