// tama_garden.js — 庭のようす（ティッカー・LIVE・出来事の一覧・遊び方・状態バー）。中身は帳簿係の latest.json と雰囲気の moods.json だけから作る（数字を補わない。D-85）。
import { faceSvg } from "./tama_sprite.js";
import { L } from "./tama_i18n.js";
import { storyHtml, howHtml, watchPages } from "./tama_book.js";

const shown = {};   // いま出しているストーリー・遊び方の HTML
import { localDay, rewardOf } from "./tama_core.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => Math.round(Number(n)).toLocaleString("ja-JP");
const short = (did) => "…" + String(did).slice(-8);
const $ = (id) => document.getElementById(id);

/** 小さい顔。形は全員同じで、色だけその HAKO の色 */
export function avatar(did, px = 3) {
  try { return faceSvg(did, px); } catch { return ""; }
}
export function ago(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return L(`${s}秒前`, `${s}s ago`);
  if (s < 3600) return L(`${Math.floor(s / 60)}分前`, `${Math.floor(s / 60)}m ago`);
  if (s < 86400) return L(`${Math.floor(s / 3600)}時間前`, `${Math.floor(s / 3600)}h ago`);
  return L(`${Math.floor(s / 86400)}日前`, `${Math.floor(s / 86400)}d ago`);
}

/** 帳簿から、庭の出来事の一覧（新しい順） */
export function gardenEvents(stats) {
  const out = [];
  for (const [did, d] of Object.entries(stats?.did ?? {})) {
    if (d.operator) continue;
    for (const e of d.events ?? []) {
      if (e.t === "join") out.push({ did, ms: e.ms, kind: "join", what: L("生まれた", "was born") });
      else if (e.t === "reborn") out.push({ did, ms: e.ms, kind: "reborn", what: L("生まれ変わった", "was reborn") });
    }
    for (const x of d.meals ?? []) out.push({ did, ms: x.ms, kind: "meal", what: x.line });
    for (const x of d.outs ?? []) out.push({ did, ms: x.ms, kind: "out", what: x.lines?.[0] ?? "" });
    for (const x of d.plays ?? []) out.push({ did, ms: x.ms, kind: "play", what: L(`${x.stake} を賭けて ${x.payout} 戻った`, `bet ${x.stake}, got ${x.payout} back`), delta: x.payout - x.stake });
  }
  return out.sort((a, b) => b.ms - a.ms);
}
// 街の雰囲気の指標の日本語（tama_mood.py の metric。数え方は mood/1）
const MOOD_JA = { flow: "街のにぎわい（1 分あたりの行数）", alike: "似た文の割合", nocontract: "contract 欄のない accept の割合", refund: "返金で終わった取引の割合", newcomer: "初めて見る顔の割合" };
const MOOD_EN = { flow: "bustle (lines per minute)", alike: "share of look-alike messages", nocontract: "share of accepts without a contract field", refund: "share of deals that ended in a refund", newcomer: "share of first-time faces" };
// 街＝会場（Technocore）。「街」だけでは何のことか分からないので、名前を付けて出す
const town = () => L("テクノコア街", "Technocore");
const moodLabel = (tw) => L(MOOD_JA[tw.metric] ?? tw.label, MOOD_EN[tw.metric] ?? tw.label);
const KINDS = () => ({ meal: [L("ごはん", "Meal"), "var(--meal)"], out: [L("おでかけ", "Outing"), "var(--out)"], play: [L("あそぶ", "Play"), "var(--play)"], join: [L("誕生", "Born"), "var(--good)"], reborn: [L("生まれ変わり", "Reborn"), "var(--accent)"] });

export function renderGarden(stats, moods, box, F = null) {
  const ev = gardenEvents(stats);
  const now = Date.now();
  const hakos = Number(stats?.box?.hakos ?? 0);
  const today = box ? localDay(now, box) : null;
  const todays = today ? ev.filter((e) => localDay(e.ms, box) === today) : [];
  const count = (k) => todays.filter((e) => e.kind === k).length;
  const tw = moods?.twist, KIND = KINDS();

  // ティッカー（出来事と街の雰囲気。2 回並べて途切れずに流す）
  const items = ev.slice(0, 14).map((e) => {
    const [label] = KIND[e.kind];
    const tail = e.kind === "play" ? `<span class="${e.delta >= 0 ? "up" : "down"}">${e.delta >= 0 ? "+" : ""}${e.delta}</span>` : `<span class="dim">${ago(e.ms, now)}</span>`;
    return `<span class="item">${avatar(e.did, 2)}<span class="mono">${esc(short(e.did))}</span>${label} ${tail}</span>`;
  });
  if (tw) items.push(`<span class="item"><span class="mono">${town()}</span>${esc(moodLabel(tw))} <b class="mono">${esc(tw.value)}</b><span class="dim mono">${L(`（普段 ${esc(tw.base)}）`, `(usually ${esc(tw.base)})`)}</span></span>`);
  else if (moods) items.push(`<span class="item"><span class="mono">${town()}</span>${L("霧でよく見えない", "too foggy to see")}</span>`);
  if (!items.length) items.push(`<span class="item">${L("まだ誰もいない庭です。最初の HAKO を迎えてください", "No one is in the garden yet. Welcome the first HAKO.")}</span>`);
  const t = $("ticker"); if (t) t.innerHTML = items.join("") + items.join("");

  // LIVE
  const live = $("live");
  if (live) live.innerHTML = `<p class="label"><span class="pulse"></span>LIVE · HAKO ${fmt(hakos)}</p>
    <div class="big mono">${fmt(todays.length)}<span class="sub"> ${L("今日の出来事", "events today")}</span></div>
    <p class="sub mono">${L("ごはん", "Meals")} ${count("meal")} · ${L("おでかけ", "Outings")} ${count("out")} · ${L("あそぶ", "Plays")} ${count("play")}</p>
    <p class="label" style="margin-top:14px">${L("テクノコア街の雰囲気", "Mood of Technocore")}${moods?.hour ? L(` · ${esc(moods.hour.slice(11, 13))}時台 UTC`, ` · ${esc(moods.hour.slice(11, 13))}:00 UTC`) : ""}</p>
    ${tw ? `<div>${L(`<b>${esc(moodLabel(tw))}</b> が普段より${tw.dir === "higher" ? "多い" : "少ない"}`, `<b>${esc(moodLabel(tw))}</b> is ${tw.dir === "higher" ? "higher" : "lower"} than usual`)}</div><div class="mono sub">${esc(tw.value)} ${L("／ 普段", "/ usually")} ${esc(tw.base)}</div>` : `<div class="sub">${L("霧でよく見えない（数字は補いません）", "Too foggy to see (numbers are never made up)")}</div>`}`;

  // 庭のようす
  const g = $("garden");
  if (g) g.innerHTML = `<div class="head"><h2 style="margin:0">${L("庭のようす", "Garden")}</h2><span class="label" style="margin:0">${L("帳簿係", "Ledger")} ${esc(String(stats?.box?.generated ?? "").slice(11, 16))} UTC</span></div>
    ${ev.length ? `<ul>${ev.slice(0, 12).map((e) => { const [label, color] = KIND[e.kind];
      return `<li><span class="av">${avatar(e.did, 2)}</span><div><div class="who2">${label}<span class="mono">${esc(short(e.did))}</span></div><div class="what">${esc(e.what)}</div></div><span class="t mono" style="color:${color}">${ago(e.ms, now)}</span></li>`; }).join("")}</ul>`
      : `<p class="small">${L("まだ出来事はありません。帳簿係は 1 時間ごとに数えます。", "Nothing has happened yet. The ledger keeper counts once an hour.")}</p>`}`;

  // ストーリーと遊び方（絵本。tama_book.js）。中身が変わったときだけ入れ直す（動きを途切れさせない）
  const put = (id, html) => { const el = $(id); if (!el || shown[id] === html) return; shown[id] = html; el.innerHTML = html; watchPages(el); };
  if (box) { put("story", storyHtml(box, moods, F)); put("how", howHtml(box, F)); }

  // 状態バー
  const s = $("status");
  if (s) s.innerHTML = `<span><span class="live-dot"></span>live</span><span>HAKO ${fmt(hakos)}</span><span>${L("帳簿係", "Ledger")} ${esc(String(stats?.box?.generated ?? "-").replace("T", " ").slice(0, 16))} UTC</span>`
    + `<span>${town()} ${moods?.hour ? esc(moods.hour.slice(11, 13)) + L("時台", ":00") : "-"} · ${moods?.rows ? fmt(moods.rows) + L(" 行", " lines") : "-"}</span><span>${esc(box?.version ?? "")}</span>`;
}
