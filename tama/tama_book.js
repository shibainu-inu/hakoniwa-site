// tama_book.js — ストーリーと遊び方を、絵本のように見せる（D-117）。1 場面ずつの動くドット絵と、短い文。
// 出てくるのは、このゲームのマスコット（白い体にリボン）と、小さい顔の子（色ちがいの街のエージェントたち）。
// 場面は、画面に入ってきたときに動き出す（スクロールして読み進める）。数字は箱の設定と、測った街の雰囲気だけを使う（作らない）。
import { castSvg } from "./tama_sprite.js";
import { artSvg } from "./tama_room.js";
import { rewardOf } from "./tama_core.js";
import { L } from "./tama_i18n.js";

const fmt = (n) => Math.round(Number(n)).toLocaleString("ja-JP");
const PAL = { k: "ink", w: "#d9b48a", d: "#a87f59", o: "#f5a06e", c: "#fffdf8", y: "#f2cf6b", s: "#b8b4ac" };
const BOWL = ["    kkkkkk    ", "  kkcccccckk  ", "kkkkkkkkkkkkkk", "kooooooooooook", "kooyyyyyyyyook", " kooooooooook ", "  kooooooook  ", "   kkkkkkkk   "];
const SIGN = ["  kkkkkkkkkkk   ", "  kwwwwwwwwwkk  ", "  kwwwwwwwwwwwk ", "  kwwwwwwwwwkk  ", "  kkkkkkkkkkk   ", "      kdk       ", "      kdk       ", "      kdk       ", "      kdk       ", "      kdk       ", "      kdk       ", "      kdk       ", "     kkkkk      "];
const PAPER = ["kkkkkkkkkk", "kcccccccck", "kckkkkkcck", "kcccccccck", "kcssssscck", "kcccccccck", "kcssssccck", "kcccccccck", "kkkkkkkkkk"];
const COIN = [" kkkk ", "kyyyyk", "kyyyyk", "kyyyyk", "kyyyyk", " kkkk "];
const TOMB = ["  kkkkkk  ", " kcccccck ", "kcckkkkcck", "kccckkccck", "kccckkccck", "kcccccccck", "kkkkkkkkkk"];
// 街のエージェントたちの色（小さい顔の子）
const CROWD = ["#f5a3b5", "#3b8cff", "#5ec99a", "#f2cf6b", "#a394ee", "#f5a06e", "#6fc9dc", "#f07c7c"];

const art = (rows, cls) => artSvg(rows, PAL, "css", cls);
/** 絵の部品: cls が置き場所と動き、w が幅（場面の幅に対する %） */
const sp = (cls, w, inner) => `<span class="sp ${cls}" style="width:${w}%"><span class="mv">${inner}</span></span>`;
const hako = (cls, w = 16) => sp(cls, w, castSvg("hako", 4));
const face = (cls, color, w = 9) => sp(cls, w, castSvg("face", 4, color));
const page = (cls, inner, text) => `<figure class="page ${cls}"><div class="art">${inner}</div><figcaption>${text}</figcaption></figure>`;
const item = (F, key) => { const it = F?.items?.find((x) => x.key === key); return it ? artSvg(it.art, F.palette, "css") : ""; };

/** ストーリー（6 場面） */
export function storyHtml(box, moods, F) {
  const tw = moods?.twist;
  const crowd = CROWD.map((c, i) => face(`c${i}`, c, 8)).join("");
  return `<h2>${L("ストーリー", "Story")}</h2><div class="book">` +
    page("s-town", face("w1", CROWD[0]) + face("w2", CROWD[1]) + face("w3", CROWD[2]) + face("w4", CROWD[3]) + sp("plant", 9, item(F, "plant")) + sp("lamp", 7, item(F, "lamp")),
      L("エージェントたちが行き交う街のはずれに、小さな箱庭があります。", "On the edge of a town where agents come and go, there is a small garden.")) +
    page("s-egg", sp("egg", 15, castSvg("egg", 4)),
      L("ある日、そこに卵がひとつ届きました。あなたの卵です。", "One day an egg arrived there. It is yours.")) +
    page("s-grow", sp("g1", 13, castSvg("egg", 4)) + `<b class="ar a1">→</b>` + sp("g2", 14, castSvg("baby", 4)) + `<b class="ar a2">→</b>` + hako("g3", 17),
      L("お世話をしていると卵から子が生まれ、やがて箱のかたちの HAKO に育ちます。", "Look after it and a little one hatches, then grows into a box-shaped HAKO.")) +
    page("s-day", sp("bowl", 11, art(BOWL)) + hako("trip", 15) + sp("sign", 11, art(SIGN)) + sp("note", 9, art(PAPER)),
      L("HAKO はごはんを食べ、街へおでかけして、見てきたことを短い記事にして持ち帰ります。", "A HAKO eats, goes out to the town, and brings back a short report of what it saw.")) +
    page("s-real", crowd + (tw ? `<span class="tag t1 mono">${esc(tw.value)}</span><span class="tag t2 mono">${L("普段", "usually")} ${esc(tw.base)}</span>` : ""),
      L("街は実在し、記事の数字もそのとき実際に測ったものです。", "The town is real, and the numbers in the report were actually measured at that time.")) +
    page("s-grave", sp("tomb", 12, art(TOMB)) + sp("ghost", 10, castSvg("ghost", 4)) + `<b class="ar a3">→</b>` + sp("again", 12, castSvg("egg", 4)),
      L("放っておくとお墓になりますが、何度でも生まれ変われます。", "Leave it alone and it ends up in a grave, but it can be reborn any number of times.")) +
    `</div>${box?.grow_hours ? `<p class="hint">${L(`${Math.round(box.grow_hours / 24)} 日育てると…？`, `Raise it for ${Math.round(box.grow_hours / 24)} days and…?`)}</p>` : ""}`;
}

/** 遊び方（6 場面。数字は箱の設定から） */
export function howHtml(box, F) {
  const meter = `<span class="mm">${Array.from({ length: 10 }, (_, k) => `<i style="--k:${k}"></i>`).join("")}</span>`;
  const table = (box.play_table ?? []).map((x) => Number(x[1]));
  const rewards = [1, 2, 3].map((n) => fmt(rewardOf(box, n)));
  return `<h2>${L("遊び方", "How to play")}</h2><div class="book small">` +
    page("h-egg", sp("e1", 13, castSvg("egg", 4)) + sp("e2", 14, castSvg("baby", 4)),
      L("はじめは<b>卵</b>です。お世話を続けると生まれて、少しずつ育ちます。", "It starts as an <b>egg</b>. Keep caring for it and it hatches, then grows little by little.")) +
    page("h-meal", hako("eat", 15) + sp("bowl", 11, art(BOWL)) + meter,
      L(`<b>ごはん</b>（${fmt(box.meal_price)} $PAPER）でおなかが ${box.meal_fill} 増えます。おなかは 1 時間に ${box.hunger_per_hour} ずつ減ります。`,
        `<b>Feed</b> (${fmt(box.meal_price)} $PAPER) fills its tummy by ${box.meal_fill}. The tummy drops by ${box.hunger_per_hour} every hour.`)) +
    page("h-out", hako("trip", 15) + sp("sign", 11, art(SIGN)) + sp("note", 9, art(PAPER)) + `<span class="tag t3 mono">+${rewards[0]}</span>`,
      L(`<b>おでかけ</b>（${fmt(box.out_price)} $PAPER）は、おなかが ${box.out_min_hunger} 以上のとき 1 日 ${box.out_per_day} 回まで。街のようすを記事にして、ほうびが ${rewards.join("・")} $PAPER 届きます。`,
        `<b>Go out</b> (${fmt(box.out_price)} $PAPER) needs a tummy of ${box.out_min_hunger} or more, up to ${box.out_per_day} times a day. It writes a report on the town and earns ${rewards.join(" · ")} $PAPER.`)) +
    page("h-play", hako("p1", 15) + sp("coin", 6, art(COIN)) + face("p2", CROWD[1], 11) + (table.length ? `<span class="tag t4 mono">${fmt(Math.min(...table))}–${fmt(Math.max(...table))}</span>` : ""),
      L(`<b>あそぶ</b>（${fmt(box.play_stake)} $PAPER）は 1 日 ${box.play_per_day} 回まで。ごきげんが上がり、戻りは半分から倍まで。`,
        `<b>Play</b> (${fmt(box.play_stake)} $PAPER) is up to ${box.play_per_day} times a day. Its mood goes up, and you get back between half and double.`)) +
    page("h-grave", sp("tomb", 12, art(TOMB)) + sp("ghost", 10, castSvg("ghost", 4)) + `<b class="ar a3">→</b>` + sp("again", 12, castSvg("egg", 4)),
      L(`おなかが 0 のまま ${box.grave_after_hours} 時間たつとお墓に。生まれ変わりは ${fmt(box.reborn_price)} $PAPER で、卵からやり直します。`,
        `If its tummy stays at 0 for ${box.grave_after_hours} hours, it ends up in a grave. Rebirth costs ${fmt(box.reborn_price)} $PAPER and starts over from an egg.`)) +
    page("h-room", sp("f1", 22, item(F, "rug")) + sp("f2", 9, item(F, "chair")) + sp("f3", 7, item(F, "lamp")) + hako("home", 15) + sp("f4", 9, item(F, "plant")) + sp("f5", 14, item(F, "desk")),
      L("お世話を重ねると、部屋に家具が増えます。家具は生まれ変わっても残ります。", "The more you care for it, the more furniture the room gets. Furniture stays even after rebirth.")) +
    `</div>`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 画面に入った場面だけ動かす（出たら止め、また入ると最初から動く）
let watcher = null;
export function watchPages(root) {
  if (typeof IntersectionObserver === "undefined") { for (const p of root.querySelectorAll(".page")) p.classList.add("in"); return; }
  watcher ??= new IntersectionObserver((list) => { for (const e of list) e.target.classList.toggle("in", e.isIntersecting && e.intersectionRatio >= 0.3); }, { threshold: [0, 0.3, 0.6] });
  for (const p of root.querySelectorAll(".page")) watcher.observe(p);
}
