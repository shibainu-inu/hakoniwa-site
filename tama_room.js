// tama_room.js — 部屋（D-92、U-37 は仮）と、シェアの額縁（D-98）。家具の絵と解放の条件は tama_furniture.json（Python の tama_room.py も同じものを読む）。
// 部屋は見た目だけ（数字は動かさない）。解放は生涯の数で決める（生まれ変わっても部屋は残る。D-91）。
import { dotRows, pubFromDid, eggSvg } from "./hako_dot.js";

export const INK = "#f0ede6", WALL = "#1a1a1a", FLOOR = "#242424", BG = "#0d0d0d";
/** 出来事 → 生涯の数 {meals, outs, plays, days, rebirths} */
export function lifetime(events, box, localDay) {
  const n = { meals: 0, outs: 0, plays: 0, days: 0, rebirths: 0 };
  const days = new Set();
  for (const e of events) {
    if (e.t === "meal") n.meals++; else if (e.t === "out") n.outs++; else if (e.t === "play") n.plays++; else if (e.t === "reborn") n.rebirths++;
    if (["meal", "out", "play"].includes(e.t)) days.add(localDay(e.ms, box));
  }
  n.days = days.size;
  return n;
}
export const unlocked = (F, n) => F.items.filter((it) => (n[it.when[0]] ?? 0) >= it.when[1]);
export const nextUnlock = (F, n) => F.items.find((it) => (n[it.when[0]] ?? 0) < it.when[1]) ?? null;
const WHEN_JA = { meals: "ごはん", outs: "おでかけ", plays: "あそぶ", days: "お世話した日", rebirths: "生まれ変わり" };
export const whenText = (it) => `${WHEN_JA[it.when[0]]} ${it.when[1]} ${it.when[0] === "days" ? "日" : "回"}`;

function dots(ox, oy, rows, px, color) {
  let d = "";
  rows.forEach((r, y) => { let x = 0; while (x < r.length) { let k = 1; while (x + k < r.length && r[x + k] === r[x]) k++; if (r[x] === "#") d += `M${ox + x * px} ${oy + y * px}h${k * px}v${px}h-${k * px}z`; x += k; } });
  return d ? `<path d="${d}" fill="${color}" shape-rendering="crispEdges"/>` : "";
}
/** 部屋の SVG。w×h、HAKO は真ん中の床に立つ（grave なら墓、egg なら卵） */
export function roomSvg(F, did, n, { w = 480, h = 300, px = 6, hako = "alive", over = {} } = {}) {
  const floorY = Math.round(h * 0.62);
  let o = `<rect width="${w}" height="${h}" fill="${WALL}"/><rect y="${floorY}" width="${w}" height="${h - floorY}" fill="${FLOOR}"/><rect y="${floorY}" width="${w}" height="2" fill="#2e2e2e"/>`;
  for (const it of unlocked(F, n)) {
    const rows = it.art.map((r) => r.replace(/\./g, " "));
    const aw = rows[0].length * px, ah = rows.length * px;
    if (it.place === "floor") { const cx = F.floor_slots[it.slot] * w; o += dots(Math.round(cx - aw / 2), floorY - ah + px, rows, px, INK); }
    else { const [fx, fy] = F.wall_slots[it.slot]; o += dots(Math.round(fx * w - aw / 2), Math.round(fy * h), rows, px, "#6e6a63"); }
  }
  const hp = px + 2;
  if (hako === "grave") {
    const T = ["  ######  ", " #      # ", "#  ####  #", "#   ##   #", "#   ##   #", "#        #", "##########"];
    o += dots(Math.round(w / 2 - T[0].length * hp / 2), floorY - T.length * hp + hp, T, hp, INK);
  } else {
    const [rows, d] = dotRows(pubFromDid(did), over);
    o += dots(Math.round(w / 2 - rows[0].length * hp / 2), floorY - rows.length * hp + hp * 2, rows, hp, d.color);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${o}</svg>`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/** 額縁（1200×630。X のカードと同じ比）。inner は部屋の SVG、lines は下に添える文（記事や一言） */
export function frameSvg(innerSvg, title, lines = []) {
  const W = 1200, H = 630;
  const body = innerSvg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  const text = lines.slice(0, 5).map((l, i) => `<text x="80" y="${470 + i * 30}" font-family="sans-serif" font-size="${i === 0 ? 24 : 20}" fill="${i === 0 ? INK : "#b8b4ac"}">${esc(l.length > 90 ? l.slice(0, 89) + "…" : l)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${BG}"/>` +
    `<rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="none" stroke="#c9a181" stroke-width="12"/>` +
    (lines.length
      ? `<g transform="translate(80 60) scale(${1040 / 480 * 0.36})">${body}</g><text x="${W - 80}" y="96" text-anchor="end" font-family="monospace" font-size="28" fill="${INK}">${esc(title)}</text>`
      : `<g transform="translate(${(W - 480 * 1.4) / 2} 60) scale(1.4)">${body}</g><text x="${W / 2}" y="${H - 58}" text-anchor="middle" font-family="monospace" font-size="28" fill="${INK}">${esc(title)}</text>`) +
    `${text}</svg>`;
}
/** SVG → PNG の Blob（ブラウザ） */
export function svgToPng(svg, w = 1200, h = 630) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, w, h); c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"); };
    img.onerror = () => reject(new Error("svg image"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}
void eggSvg;
