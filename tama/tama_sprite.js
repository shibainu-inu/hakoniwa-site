// tama_sprite.js — ハコニワの姿（D-107〜D-110）。卵（足も飾りも無い）→ 生まれた子（足と飾りが付く）→ HAKO と育ち、お墓のあいだは幽霊。
// HAKO の形は、前の版のマスコット（横長の体・点の目・への字の口・下の帯・短い足）で全員共通。個性は DID から決まる色と頭の飾りだけ。
// 飾りはほとんどの子に付く（何も付かない子のほうが珍しい）。アプリのアイコンはマスコット、小さい顔は全員同じ形で色だけその子の色。
// 素材は hako_dot.js をそのまま使い、形の決まりだけ上書きする。Python の tama_sprite.py と同じ絵になることは試験で確かめる。
import { dotRows, dotPath, pubFromDid, PALETTE, dotDerive } from "./hako_dot.js";

export const MASCOT = { body: "wide", eye: "dot", mouth: "flat", pattern: "band", leg: "short", eye_gap: 2 };
export const EGG_COLOR = PALETTE[2];
// アプリのアイコン（ロゴの横、favicon）はこのゲームのマスコット（白い体にリボン）。決まった 1 体で、DID からは作らない
export const ICON = { ...MASCOT, accessory: "ribbon" };
export const ICON_COLOR = PALETTE[2];
// 小さい顔（庭のようす・流れる帯）。全員同じ形（四角い目・リボン・長い足）で、色だけその子の色
export const FACE = { body: "wide", eye: "round", mouth: "open", pattern: "plain", leg: "long", eye_gap: 2, accessory: "ribbon" };
const ZERO = new Uint8Array(32);

/** 飾り: b1 が 13 未満（約 5%）だけ何も無し、243 以上（約 5%）は冠、あとは芽・触角・リボン・角を同じ割合で */
export function tamaAccessory(pub) {
  const b = pub[1];
  if (b < 13) return null;
  if (b >= 243) return "crown";
  return ["sprout", "antenna", "ribbon", "horn"][Math.floor(((b - 13) * 4) / 230)];
}
export const hakoColor = (pub) => dotDerive(pub).color;
const pad = (rows, w) => rows.map((r) => { const l = Math.floor((w - r.length) / 2); return " ".repeat(l) + r + " ".repeat(w - r.length - l); });

// 卵: 細い線で、足も飾りも無く、目を閉じている
export const EGG_ROWS = [
  "   ##########   ",
  "  #          #  ",
  " #            # ",
  "#              #",
  "#              #",
  "#   ##    ##   #",
  "#              #",
  "#              #",
  "#              #",
  " #            # ",
  "  #          #  ",
  "   ##########   ",
];
// 生まれた子の体: 卵と同じ形に、開いた目と足
export const BABY_BODY = [
  "   ##########   ",
  "  #          #  ",
  " #            # ",
  "#              #",
  "#   ##    ##   #",
  "#   ##    ##   #",
  "#              #",
  "#              #",
  "#              #",
  " #            # ",
  "  #          #  ",
  "   ##########   ",
  "   ##      ##   ",
];
/** 生まれた子: 卵の体に足が生え、目が開き、その子の色と飾りが付く */
export function babyRows(pub) {
  const [rows] = dotRows(pub, { ...MASCOT, accessory: tamaAccessory(pub) });
  const w = rows[0].length;
  return [[...rows.slice(0, 2), ...pad(BABY_BODY, w)], hakoColor(pub)];
}
/** HAKO: マスコットの形 ＋ その子の色と飾り。over で目・口などの表情を上書きできる */
export function hakoRows(pub, over = {}) {
  const [rows, d] = dotRows(pub, { ...MASCOT, accessory: tamaAccessory(pub), ...over });
  return [rows, d.color];
}
// 幽霊: お墓のあいだの姿。縦長の体・線の目・口なし。足は無く、すそが波。色と飾りはその子のまま
export const GHOST = { body: "tall", eye: "line", mouth: "none", pattern: "plain", leg: "float", eye_gap: 1 };
export function ghostRows(pub, accessory = tamaAccessory(pub)) {
  const [rows, d] = dotRows(pub, { ...GHOST, accessory });
  const w = rows[0].length;
  const hem = (on) => Array.from({ length: w }, (_, x) => (on(x) ? "#" : " ")).join("");
  rows[rows.length - 1] = hem((x) => x === 0 || x === w - 1 || x % 4 === 3 || x % 4 === 0);
  rows.push(hem((x) => x % 4 === 1 || x % 4 === 2));
  return [rows, d.color];
}
export function iconRows() { return [dotRows(ZERO, ICON)[0], ICON_COLOR]; }
export function faceRows(pub) { return [dotRows(ZERO, FACE)[0], hakoColor(pub)]; }

// ── 地の色に合わせた塗り（D-111）。縁はその子の色、体の中は白。白っぽい子は、明るい地では縁を黒にする ──
export const PALE = [PALETTE[2], PALETTE[11]];
export const THEMES = {
  light: { wall: "#f7f4ee", floor: "#ece7dc", edge: "#ddd6c8", ink: "#16151c", dim: "#a8a296", in: "#ffffff", pale: "#16151c" },
  dark: { wall: "#1a1a1a", floor: "#242424", edge: "#2e2e2e", ink: "#f0ede6", dim: "#6e6a63", in: "#1a1a1a", pale: "#f0ede6" },
  css: { wall: "var(--r-wall)", floor: "var(--r-floor)", edge: "var(--r-edge)", ink: "var(--r-ink)", dim: "var(--r-dim)", in: "var(--r-in)", pale: "var(--r-pale)" },
};
export const lineColor = (color, theme = "css") => (PALE.includes(color) ? THEMES[theme].pale : color);
/** 体の中（縁に囲まれたマス）を # にした行。外から上下左右にたどれない空きマスが「中」 */
export function inside(rows) {
  const h = rows.length, w = rows[0].length;
  const out = Array.from({ length: h }, () => Array(w).fill(false));
  const todo = [];
  const seed = (y, x) => { if (y >= 0 && y < h && x >= 0 && x < w && !out[y][x] && rows[y][x] !== "#") { out[y][x] = true; todo.push([y, x]); } };
  for (let y = 0; y < h; y++) { seed(y, 0); seed(y, w - 1); }
  for (let x = 0; x < w; x++) { seed(0, x); seed(h - 1, x); }
  while (todo.length) { const [y, x] = todo.pop(); seed(y - 1, x); seed(y + 1, x); seed(y, x - 1); seed(y, x + 1); }
  return rows.map((r, y) => [...r].map((c, x) => (c !== "#" && !out[y][x] ? "#" : " ")).join(""));
}

/** 行と色。stage: egg | baby | hako | ghost（pub が無ければ卵） */
export function stageRows(pub, stage = "hako", over = {}) {
  if (!pub || stage === "egg") return [EGG_ROWS, EGG_COLOR];
  if (stage === "baby") return babyRows(pub);
  if (stage === "ghost") return ghostRows(pub);
  return hakoRows(pub, over);
}
function wrap(rows, px, inner) {
  const w = rows[0].length * px, h = rows.length * px;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">${inner}</svg>`;
}
const pubOf = (did) => { try { return did ? pubFromDid(did) : null; } catch { return null; } };
const fig = (rows, color, px, theme) => wrap(rows, px, dotPath(0, 0, inside(rows), px, THEMES[theme].in) + dotPath(0, 0, rows, px, lineColor(color, theme)));
export function spriteSvg(did, stage = "hako", px = 8, over = {}, theme = "css") {
  const [rows, color] = stageRows(pubOf(did), stage, over);
  return fig(rows, color, px, theme);
}
/** 小さい顔の SVG（did が読めなければ卵の色） */
export function faceSvg(did, px = 2, theme = "css") { const p = pubOf(did); const [rows, color] = p ? faceRows(p) : [dotRows(ZERO, FACE)[0], EGG_COLOR]; return fig(rows, color, px, theme); }
/** 絵本（ストーリー・遊び方）用の姿。DID は使わない。kind: egg | baby | hako（マスコット）| ghost | face（小さい顔の子）。color を省くとマスコットの色 */
export function castSvg(kind, px = 4, color = ICON_COLOR, theme = "css") {
  const rows = kind === "egg" ? EGG_ROWS
    : kind === "baby" ? [...dotRows(ZERO, ICON)[0].slice(0, 2), ...pad(BABY_BODY, 18)]
    : kind === "ghost" ? ghostRows(ZERO, "ribbon")[0]
    : kind === "face" ? dotRows(ZERO, FACE)[0]
    : dotRows(ZERO, ICON)[0];
  return fig(rows, kind === "egg" ? EGG_COLOR : color, px, theme);
}
export function iconSvg(px = 2, theme = "css") { const [rows, color] = iconRows(); return fig(rows, color, px, theme); }
/** 部屋の中に置くための行と色（tama_room.js が使う） */
export function spriteRows(did, stage = "hako", over = {}) { return stageRows(pubFromDid(did), stage, over); }
