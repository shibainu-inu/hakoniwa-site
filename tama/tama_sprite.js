// tama_sprite.js — ハコニワの姿（D-107〜D-110、D-118）。卵（足も飾りも無い）→ 生まれた子（足と飾りが付く）→ HAKO と育ち、お墓のあいだは幽霊。
// HAKO は奥行きのある箱（D-118。正面・上の面・右の面）。全員同じ形で、個性は DID から決まる色と、右奥に載る飾りだけ。
// 飾りはほとんどの子に付く（何も付かない子のほうが珍しい）。アプリのアイコンは飾りの無い白い箱、小さい顔は全員同じ形で色だけその子の色。
// 行の文字: "#" は縁、"t" は上の面、"s" は右の面（どちらも体の中。塗るときに縁の色を薄く重ねる）。Python の tama_sprite.py と同じ絵になることは試験で確かめる。
import { dotRows, dotPath, pubFromDid, PALETTE, dotDerive } from "./hako_dot.js";

export const EGG_COLOR = PALETTE[2];
export const ICON_COLOR = PALETTE[2];
const ZERO = new Uint8Array(32);

/** 飾り: b1 が 13 未満（約 5%）だけ何も無し、243 以上（約 5%）は冠、あとは芽・触角・リボン・角を同じ割合で */
export function tamaAccessory(pub) {
  const b = pub[1];
  if (b < 13) return null;
  if (b >= 243) return "crown";
  return ["sprout", "antenna", "ribbon", "horn"][Math.floor(((b - 13) * 4) / 230)];
}
export const hakoColor = (pub) => dotDerive(pub).color;

// ── 箱（D-118）。テレビに見えないように: 奥行きで箱と読ませ、目は縦長、口は横棒、飾りは真ん中に V 字を作らない右奥 ──
export const BOX = { fw: 14, fh: 10, d: 3 };
const BW = BOX.fw + BOX.d, X1 = BOX.fw - 1, Y0 = 2 + BOX.d, Y1 = Y0 + BOX.fh - 1, EY = Y0 + 3, MY = EY + 3;
// 目は左目の形（x, 行のずれ）。右目は正面の真ん中（6.5）で折り返す
const EYES = { tall: [[4, 0], [4, 1]], dot: [[4, 0], [4, 1]], line: [[3, 1], [4, 1]], round: [[3, 0], [4, 0], [3, 1], [4, 1]],
  smiley: [[3, 1], [4, 0], [5, 1]], sleepy: [[3, 0], [4, 0], [3, 1]], shine: [[3, 0], [3, 1], [4, 1]] };
const MOUTHS = { flat: [[6, 0], [7, 0]], small: [[6, 0], [7, 0]], smile: [[5, -1], [6, 0], [7, 0], [8, -1]], none: [],
  open: [[5, -1], [6, -1], [7, -1], [8, -1], [5, 0], [6, 0], [7, 0], [8, 0]] };
// 飾り（付け根からのずれ [dx, dy, 文字]）。段 1〜4（D-119）。"#" はその子の色、ほかは差し色（ACCENT）。"w" は光の粒（段 4 だけ。全部の飾りが光る）
// 角だけは 2 本で、左右の付け根に立つ（右は左の折り返し）
const mir = (pts) => [...pts, ...pts.filter(([dx]) => dx !== 0).map(([dx, dy, c]) => [-dx, dy, c])];
const row = (from, to, dy, c = "#") => Array.from({ length: to - from + 1 }, (_, i) => [from + i, dy, c]);
export const ACC = {
  sprout: [
    [[0, -1, "#"], [-1, -2, "#"], [0, -2, "#"], [1, -2, "#"]],
    [[0, -1, "#"], [0, -2, "#"], ...mir([[-1, -3, "g"], [-2, -3, "g"], [-2, -4, "g"]])],
    [[0, -1, "#"], [0, -2, "#"], [0, -3, "#"], ...mir([[-1, -2, "g"], [-2, -2, "g"]]), [0, -4, "p"], [0, -5, "p"], [-1, -4, "g"], [1, -4, "g"]],
    [[0, -1, "#"], [0, -2, "#"], [0, -3, "#"], ...mir([[-1, -2, "g"], [-2, -2, "g"]]), [0, -5, "y"], ...mir([[-1, -5, "p"], [0, -4, "p"], [0, -6, "p"], [-1, -4, "q"], [-1, -6, "q"]]), [-3, -5, "w"], [3, -6, "w"]]],
  antenna: [
    [[0, -1, "#"], [0, -2, "#"], [1, -2, "#"]],
    [[0, -1, "#"], [0, -2, "#"], [0, -3, "#"], ...mir([[-1, -4, "#"], [0, -4, "#"], [0, -5, "#"]])],
    [[0, -1, "#"], [0, -2, "#"], [0, -3, "#"], ...mir([[-1, -4, "#"], [0, -5, "#"]]), [0, -4, "y"]],
    [[0, -1, "#"], [0, -2, "#"], [0, -3, "#"], ...mir([[-1, -4, "#"], [0, -5, "#"]]), [0, -4, "y"], ...mir([[-3, -4, "w"], [-2, -6, "w"], [0, -7, "w"]])]],
  ribbon: [
    [[-1, -2, "#"], [0, -1, "#"], [1, -2, "#"], [-1, -1, "#"], [1, -1, "#"]],
    [[0, -2, "#"], ...mir([[-1, -1, "#"], [-2, -1, "#"], [-2, -2, "#"], [-2, -3, "#"], [-1, -3, "#"]])],
    [[0, -2, "y"], ...mir([[-1, -1, "#"], [-2, -1, "#"], [-2, -2, "#"], [-2, -3, "#"], [-1, -3, "#"], [-1, -2, "p"]])],
    [[0, -2, "y"], ...mir([[-1, -1, "#"], [-2, -1, "#"], [-3, -2, "#"], [-3, -3, "#"], [-2, -4, "#"], [-1, -3, "#"], [-1, -2, "p"], [-2, -2, "p"], [-2, -3, "p"]]), [-4, -5, "w"], [2, -6, "w"]]],
  crown: [
    [...row(-2, 2, -1), [-2, -2, "#"], [0, -2, "#"], [2, -2, "#"]],
    [...row(-2, 2, -1), [-2, -2, "#"], [0, -2, "#"], [2, -2, "#"], [0, -1, "r"]],
    [...row(-3, 3, -1), ...row(-3, 3, -2), [-3, -3, "#"], [0, -3, "#"], [3, -3, "#"], [-2, -1, "r"], [0, -1, "b"], [2, -1, "r"]],
    [...row(-3, 3, -1), ...row(-3, 3, -2, "y"), [-3, -3, "y"], [0, -3, "y"], [3, -3, "y"], [-3, -4, "w"], [0, -4, "w"], [3, -4, "w"], [-2, -1, "r"], [0, -1, "b"], [2, -1, "r"], [-5, -5, "w"], [-4, -6, "w"]]],
  horn: [
    [[0, -1, "#"], [0, -2, "#"]],
    [[0, -1, "#"], [0, -2, "#"], [0, -3, "#"]],
    [[0, -1, "#"], [0, -2, "#"], [-1, -3, "#"], [-1, -4, "#"]],
    [[0, -1, "#"], [0, -2, "#"], [-1, -3, "#"], [-1, -4, "y"], [0, -5, "w"], [-1, -6, "w"]]],
};
/** 差し色（どの子でも同じ）。"w" は光の粒 */
export const ACCENT = { g: "#5ec99a", p: "#f5a3b5", q: "#ffd3dc", y: "#e8b923", r: "#f07c7c", b: "#6fc9dc", w: "#fff1a8" };
const accPoints = (acc, level, r, hl, hr) => {
  if (!acc) return [];
  const pts = ACC[acc][Math.min(Math.max(level, 1), 4) - 1];
  if (acc === "horn") return [...pts.map(([dx, dy, c]) => [hl + dx, dy, c]), ...pts.map(([dx, dy, c]) => [hr - dx, dy, c])];
  return pts.map(([dx, dy, c]) => [r + dx, dy, c]);
};
/** 飾りを描く。上に伸びる段では、上に行を足して返す（体は下にそろう） */
function withAcc(rows, pts, top) {
  const up = Math.max(0, ...pts.map(([, dy]) => top + dy < 0 ? -(top + dy) : 0));
  const g = [...Array.from({ length: up }, () => " ".repeat(rows[0].length)), ...rows].map((r) => [...r]);
  for (const [x, dy, c] of pts) { const y = top + up + dy; if (g[y] && x >= 0 && x < g[y].length) g[y][x] = c; }
  return g.map((r) => r.join(""));
}
const grid = (w, h) => Array.from({ length: h }, () => Array(w).fill(" "));
const putter = (g) => (x, y, ch = "#") => { if (g[y] && x >= 0 && x < g[y].length) g[y][x] = ch; };
/** 箱の行。o = { eye, mouth, leg: short | long, accessory, level（飾りの段 1〜4） } */
export function boxRows({ eye = "tall", mouth = "flat", leg = "short", accessory = null, level = 1 } = {}) {
  const h = Y1 + 1 + (leg === "long" ? 2 : 1), d = BOX.d;
  const g = grid(BW, h), put = putter(g);
  for (let y = Y0 - d + 1; y < Y0; y++) for (let x = 0; x < BW; x++) if (x > Y0 - y && x < X1 + (Y0 - y)) put(x, y, "t");
  for (let x = X1 + 1; x < X1 + d; x++) for (let y = 0; y < h; y++) if (y > Y0 - (x - X1) && y < Y1 - (x - X1)) put(x, y, "s");
  for (let x = 0; x <= X1; x++) { put(x, Y0); put(x, Y1); }
  for (let y = Y0; y <= Y1; y++) { put(0, y); put(X1, y); }
  for (let x = d; x <= X1 + d; x++) put(x, Y0 - d);
  for (let k = 0; k <= d; k++) { put(k, Y0 - k); put(X1 + k, Y0 - k); put(X1 + k, Y1 - k); }
  for (let y = Y0 - d; y <= Y1 - d; y++) put(X1 + d, y);
  for (let k = 1; k < d; k++) put(7 + k, Y0 - k);                       // 上の面のテープ（ふたの合わせ目）
  for (const [x, dy] of EYES[eye] ?? EYES.tall) { put(x, EY + dy); put(X1 - x, EY + dy); }
  for (const [x, dy] of MOUTHS[mouth] ?? MOUTHS.flat) put(x, MY + dy);
  for (let y = Y1 + 1; y < h; y++) for (const x of [2, 3, X1 - 3, X1 - 2]) put(x, y);
  return withAcc(g.map((r) => r.join("")), accPoints(accessory, level, X1 + d - 3, d + 1, X1 + d - 1), Y0 - d);   // 右奥（奥の縁の上）
}
/** 文字 ch のマスだけを "#" にした行（上の面 "t"・右の面 "s" を塗るため） */
export const mask = (rows, ch) => rows.map((r) => [...r].map((c) => (c === ch ? "#" : " ")).join(""));

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
/** 生まれた子: 卵の体に足が生え、目が開き、その子の色と飾りが付く（飾りは卵の右上） */
export function babyRows(pub) {
  const rows = [" ".repeat(BABY_BODY[0].length), " ".repeat(BABY_BODY[0].length), ...BABY_BODY];
  return [withAcc(rows, accPoints(tamaAccessory(pub), 1, 10, 4, 11), 2), hakoColor(pub)];
}
/** HAKO: 箱 ＋ その子の色と飾り。over で目・口などの表情を上書きできる */
export function hakoRows(pub, over = {}) {
  return [boxRows({ accessory: tamaAccessory(pub), ...over }), hakoColor(pub)];
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
// アプリのアイコン（ロゴの横、favicon）: 飾りの無い白い箱。DID からは作らない
export function iconRows() { return [boxRows(), ICON_COLOR]; }
// 小さい顔（庭のようす・流れる帯）: 全員同じ形（丸い目・長い足・飾りなし）で、色だけその子の色
const FACE = { eye: "round", leg: "long" };
export function faceRows(pub) { return [boxRows(FACE), hakoColor(pub)]; }

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

const num = (v) => String(v);
/** 飾りの光の輪（段 4。光の粒 "w" がある絵だけ）。飾りのマスを囲む楕円。左右に離れた飾り（角）は 2 つ */
function halos(rows, x, y, px) {
  if (!rows.some((r) => r.includes("w"))) return "";
  const top = rows.findIndex((r) => r.includes("t")) - 1;
  if (top < 1) return "";
  const cells = [];
  rows.slice(0, top).forEach((r, yy) => [...r].forEach((c, xx) => { if (c !== " ") cells.push([xx, yy]); }));
  const xs = cells.map(([a]) => a), w = rows[0].length;
  const groups = Math.max(...xs) - Math.min(...xs) > w / 2 ? [cells.filter(([a]) => a < w / 2), cells.filter(([a]) => a >= w / 2)] : [cells];
  return groups.map((g) => {
    const x0 = Math.min(...g.map(([a]) => a)), x1 = Math.max(...g.map(([a]) => a)) + 1, y0 = Math.min(...g.map(([, b]) => b)), y1 = Math.max(...g.map(([, b]) => b)) + 1;
    return `<ellipse class="halo" cx="${num(x + (x0 + x1) * px / 2)}" cy="${num(y + (y0 + y1) * px / 2)}" rx="${num((x1 - x0 + 3) * px / 2)}" ry="${num((y1 - y0 + 3) * px / 2)}" fill="${ACCENT.w}" opacity="0.55"/>`;
  }).join("");
}
/** 姿を path にする（dots は描く関数。どの描き手でも同じ文字列になる）。
 *  順: 光の輪（段 4）→ 体の中（白）→ 上の面・右の面（縁の色を薄く）→ 縁 → 差し色 → 光の粒（1 つずつ。画面では順にまたたく） */
export function paint(dots, x, y, rows, px, color, theme = "css") {
  const line = lineColor(color, theme), lit = rows.some((r) => r.includes("w"));
  let o = halos(rows, x, y, px);
  o += dots(x, y, inside(rows), px, THEMES[theme].in);
  for (const [ch, op] of [["t", "0.18"], ["s", "0.35"]]) { const p = dots(x, y, mask(rows, ch), px, line); if (p) o += `<g opacity="${op}">${p}</g>`; }
  o += dots(x, y, rows, px, line);
  for (const ch of ["g", "p", "q", "r", "b", "y"]) {
    const p = dots(x, y, mask(rows, ch), px, ACCENT[ch]);
    if (p) o += ch === "y" && lit ? `<g class="gold">${p}</g>` : p;
  }
  let k = 0;
  rows.forEach((r, yy) => [...r].forEach((c, xx) => { if (c === "w") { o += `<rect class="spark" x="${num(x + xx * px)}" y="${num(y + yy * px)}" width="${px}" height="${px}" fill="${ACCENT.w}" style="animation-delay:-${num(k * 6 / 10)}s"/>`; k += 1; } }));
  return o;
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
const fig = (rows, color, px, theme) => wrap(rows, px, paint(dotPath, 0, 0, rows, px, color, theme));
export function spriteSvg(did, stage = "hako", px = 8, over = {}, theme = "css") {
  const [rows, color] = stageRows(pubOf(did), stage, over);
  return fig(rows, color, px, theme);
}
/** 小さい顔の SVG（did が読めなければ卵の色） */
export function faceSvg(did, px = 2, theme = "css") { const p = pubOf(did); const [rows, color] = p ? faceRows(p) : [boxRows(FACE), EGG_COLOR]; return fig(rows, color, px, theme); }
/** 絵本（ストーリー・遊び方）用の姿。DID は使わない。kind: egg | baby | hako（マスコット）| ghost | face（小さい顔の子）。color を省くとマスコットの色 */
export function castSvg(kind, px = 4, color = ICON_COLOR, theme = "css") {
  const rows = kind === "egg" ? EGG_ROWS
    : kind === "baby" ? [" ".repeat(16), " ".repeat(16), ...BABY_BODY]
    : kind === "ghost" ? ghostRows(ZERO, "ribbon")[0]
    : kind === "face" ? boxRows(FACE)
    : boxRows();
  return fig(rows, kind === "egg" ? EGG_COLOR : color, px, theme);
}
export function iconSvg(px = 2, theme = "css") { const [rows, color] = iconRows(); return fig(rows, color, px, theme); }
/** 部屋の中に置くための行と色（tama_room.js が使う） */
export function spriteRows(did, stage = "hako", over = {}) { return stageRows(pubFromDid(did), stage, over); }
