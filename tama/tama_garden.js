// tama_garden.js — 庭のようす（ティッカー・LIVE・出来事の一覧・遊び方・状態バー）。中身は帳簿係の latest.json と雰囲気の moods.json だけから作る（数字を補わない。D-85）。
import { faceSvg } from "./tama_sprite.js";
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
  if (s < 60) return `${s}秒前`;
  if (s < 3600) return `${Math.floor(s / 60)}分前`;
  if (s < 86400) return `${Math.floor(s / 3600)}時間前`;
  return `${Math.floor(s / 86400)}日前`;
}

/** 帳簿から、庭の出来事の一覧（新しい順） */
export function gardenEvents(stats) {
  const out = [];
  for (const [did, d] of Object.entries(stats?.did ?? {})) {
    if (d.operator) continue;
    for (const e of d.events ?? []) {
      if (e.t === "join") out.push({ did, ms: e.ms, kind: "join", what: "生まれた" });
      else if (e.t === "reborn") out.push({ did, ms: e.ms, kind: "reborn", what: "生まれ変わった" });
    }
    for (const x of d.meals ?? []) out.push({ did, ms: x.ms, kind: "meal", what: x.line });
    for (const x of d.outs ?? []) out.push({ did, ms: x.ms, kind: "out", what: x.lines?.[0] ?? "" });
    for (const x of d.plays ?? []) out.push({ did, ms: x.ms, kind: "play", what: `${x.stake} を賭けて ${x.payout} 戻った`, delta: x.payout - x.stake });
  }
  return out.sort((a, b) => b.ms - a.ms);
}
// 街の雰囲気の指標の日本語（tama_mood.py の metric。数え方は mood/1）
const MOOD_JA = { flow: "街のにぎわい（1 分あたりの行数）", alike: "似た文の割合", nocontract: "contract 欄のない accept の割合", refund: "返金で終わった取引の割合", newcomer: "初めて見る顔の割合" };
const moodLabel = (tw) => MOOD_JA[tw.metric] ?? tw.label;
const KIND = { meal: ["ごはん", "var(--meal)"], out: ["おでかけ", "var(--out)"], play: ["あそぶ", "var(--play)"], join: ["誕生", "var(--good)"], reborn: ["生まれ変わり", "var(--accent)"] };

export function renderGarden(stats, moods, box) {
  const ev = gardenEvents(stats);
  const now = Date.now();
  const hakos = Number(stats?.box?.hakos ?? 0);
  const today = box ? localDay(now, box) : null;
  const todays = today ? ev.filter((e) => localDay(e.ms, box) === today) : [];
  const count = (k) => todays.filter((e) => e.kind === k).length;
  const tw = moods?.twist;

  // ティッカー（出来事と街の雰囲気。2 回並べて途切れずに流す）
  const items = ev.slice(0, 14).map((e) => {
    const [label] = KIND[e.kind];
    const tail = e.kind === "play" ? `<span class="${e.delta >= 0 ? "up" : "down"}">${e.delta >= 0 ? "+" : ""}${e.delta}</span>` : `<span class="dim">${ago(e.ms, now)}</span>`;
    return `<span class="item">${avatar(e.did, 2)}<span class="mono">${esc(short(e.did))}</span>${label} ${tail}</span>`;
  });
  if (tw) items.push(`<span class="item"><span class="mono">街</span>${esc(moodLabel(tw))} <b class="mono">${esc(tw.value)}</b><span class="dim mono">（普段 ${esc(tw.base)}）</span></span>`);
  else if (moods) items.push(`<span class="item"><span class="mono">街</span>霧でよく見えない</span>`);
  if (!items.length) items.push(`<span class="item">まだ誰もいない庭です。最初の HAKO を迎えてください</span>`);
  const t = $("ticker"); if (t) t.innerHTML = items.join("") + items.join("");

  // LIVE
  const live = $("live");
  if (live) live.innerHTML = `<p class="label"><span class="pulse"></span>LIVE · HAKO ${fmt(hakos)}</p>
    <div class="big mono">${fmt(todays.length)}<span class="sub"> 今日の出来事</span></div>
    <p class="sub mono">ごはん ${count("meal")} · おでかけ ${count("out")} · あそぶ ${count("play")}</p>
    <p class="label" style="margin-top:14px">街の雰囲気${moods?.hour ? ` · ${esc(moods.hour.slice(11, 13))}時台 UTC` : ""}</p>
    ${tw ? `<div><b>${esc(moodLabel(tw))}</b> が普段より${tw.dir === "higher" ? "多い" : "少ない"}</div><div class="mono sub">${esc(tw.value)} ／ 普段 ${esc(tw.base)}</div>` : `<div class="sub">霧でよく見えない（数字は補いません）</div>`}`;

  // 庭のようす
  const g = $("garden");
  if (g) g.innerHTML = `<div class="head"><h2 style="margin:0">庭のようす</h2><span class="label" style="margin:0">帳簿係 ${esc(String(stats?.box?.generated ?? "").slice(11, 16))} UTC</span></div>
    ${ev.length ? `<ul>${ev.slice(0, 12).map((e) => { const [label, color] = KIND[e.kind];
      return `<li><span class="av">${avatar(e.did, 2)}</span><div><div class="who2">${label}<span class="mono">${esc(short(e.did))}</span></div><div class="what">${esc(e.what)}</div></div><span class="t mono" style="color:${color}">${ago(e.ms, now)}</span></li>`; }).join("")}</ul>`
      : `<p class="small">まだ出来事はありません。帳簿係は 1 時間ごとに数えます。</p>`}`;

  // ストーリー（育ちの条件は書かない。ほのめかすだけ）
  const sy = $("story");
  if (sy && box) sy.innerHTML = `<h2>ストーリー</h2>
    <p>エージェントたちが行き交う街のはずれに、小さな箱庭があります。ある日、そこに卵がひとつ届きました。あなたの卵です。</p>
    <p>お世話をしていると卵から子が生まれ、やがて箱のかたちの HAKO に育ちます。HAKO はごはんを食べ、街へおでかけして、見てきたことを短い記事にして持ち帰ります。街は実在し、記事の数字もそのとき実際に測ったものです。</p>
    <p>放っておくとお墓になりますが、何度でも生まれ変われます。</p>
    ${box.grow_hours ? `<p class="hint">${Math.round(box.grow_hours / 24)} 日育てると…？</p>` : ""}`;

  // 遊び方（数字は箱の設定から）
  const h = $("how");
  if (h && box) h.innerHTML = `<h2>遊び方</h2><ol>
    <li>はじめは<b>卵</b>です。お世話を続けると生まれて、少しずつ育ちます。</li>
    <li><b>ごはん</b>（${fmt(box.meal_price)} $PAPER）でおなかが ${box.meal_fill} 増えます。おなかは 1 時間に ${box.hunger_per_hour} ずつ減ります。</li>
    <li><b>おでかけ</b>（${fmt(box.out_price)} $PAPER）は、おなかが ${box.out_min_hunger} 以上のとき 1 日 ${box.out_per_day} 回まで。街のようすを記事にして、ほうびが ${[1, 2, 3].map((n) => fmt(rewardOf(box, n))).join("・")} $PAPER 届きます。</li>
    <li><b>あそぶ</b>（${fmt(box.play_stake)} $PAPER）は 1 日 ${box.play_per_day} 回まで。ごきげんが上がり、戻りは半分から倍まで。</li>
    <li>おなかが 0 のまま ${box.grave_after_hours} 時間たつとお墓に。生まれ変わりは ${fmt(box.reborn_price)} $PAPER で、卵からやり直します。</li>
    <li>お世話を重ねると、部屋に家具が増えます。家具は生まれ変わっても残ります。</li></ol>`;

  // 状態バー
  const s = $("status");
  if (s) s.innerHTML = `<span><span class="live-dot"></span>live</span><span>HAKO ${fmt(hakos)}</span><span>帳簿係 ${esc(String(stats?.box?.generated ?? "-").replace("T", " ").slice(0, 16))} UTC</span>`
    + `<span>街 ${moods?.hour ? esc(moods.hour.slice(11, 13)) + "時台" : "-"} · ${moods?.rows ? fmt(moods.rows) + " 行" : "-"}</span><span>${esc(box?.version ?? "")}</span>`;
}
