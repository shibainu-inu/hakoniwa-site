// tama_deal.js — ごはん・おでかけ・あそぶの取引（払う側 = このブラウザ。運営者の返事 2026-09-29: 新規部屋はプレイヤーの IP で作る）。
// 流れ（tclk/1。~/tclk SPEC.md §3.2〜3.4）:
//   1. offer を tclk-offers に出す（job.id は tama-<種類>-<DID 末尾 8>-<ms>、job.context に推論の入力）
//   2. 受け取り側（ごはん・おでかけは箱庭の miner、あそぶは NPC）が accept を tclk-offers に出し、同じ accept をノート /kv/<accept_ns>/<DID 末尾 8>-<種類> にも置く
//      （tclk-offers は流量が多く、ブラウザで追いきれない。ノートは誰でも書けるので、contractId と相手の DID をここで確かめ直す）
//   3. PaperRail で lock → 派生ルームに lock（ここで部屋ができる）→ 同じ部屋に terms（offer と accept の写し。帳簿係が読む）→ 掲示板に deal
//   4. 受け取り側が lines（ごはん 1 行、おでかけ 5 行。あそぶは無し）と reveal を出す。ここで見て、検査（tama_core.checkLines）が通れば成立
//   5. refundAfterMs を過ぎても reveal が無ければ refund（PAPER は動かない）
// 状態は localStorage tama_deal_v1:<DID>:<種類>。preimage は持たない（払う側なので秘密は無い）。
import * as tclk from "./hako_tclk.js";
import { notes, readTail } from "./tama_net.js";
import { L } from "./tama_i18n.js";
import { jobId, tamaLine, parseTama, acceptKey, checkLines, mealPrompt, outPrompt, playPayout, playTableAt, localDay, rewardOf } from "./tama_core.js";

export const dealKinds = [["meal", "ごはん"], ["out", "おでかけ"], ["play", "あそぶ"]];
const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");

export class Deal {
  constructor({ kind, app, onEvent = () => {} }) {
    this.kind = kind; this.app = app; this.onEvent = onEvent;
    this.key = `tama_deal_v1:${app.did}:${kind}`;
    try { this.st = JSON.parse(localStorage.getItem(this.key) || "null"); } catch { this.st = null; }
    this.rail = new tclk.PaperRail(notes);
  }
  save() { try { localStorage.setItem(this.key, JSON.stringify(this.st)); } catch { /* 次に書き直す */ } }
  set(stage, extra = {}) { this.st = { ...(this.st ?? {}), ...extra, stage }; this.save(); this.onEvent({ type: "stage", stage }); }
  note(text) { this.onEvent({ type: "note", text }); }
  busy() { return !!this.st && !this.st.done; }
  get box() { return this.app.box; }
  price() { return Number({ meal: this.box.meal_price, out: this.box.out_price, play: this.box.play_stake, sit: this.box.sit_price, sitplay: this.box.sit_play_price }[this.kind]); }
  takers() { return new Set(this.kind === "play" ? (this.box.npcs ?? []) : (this.box.miners ?? [])); }

  /** 推論の入力（job.context）。おでかけは測った雰囲気（moods.json）が要る。取れなければ「霧」（D-85） */
  async context(st) {
    if (this.kind === "meal") return { v: 1, prompt: mealPrompt(this.box.meal_instruction, st) };
    if (this.kind === "play") return { v: 1 };
    let m = null;
    try { const r = await fetch(`moods.json?t=${Date.now()}`, { cache: "no-store" }); if (r.ok) m = await r.json(); } catch { m = null; }
    const facts = m?.twist ?? null;
    if (!facts) return null;
    return { v: 1, mood_version: m.version, hour: m.hour, facts, prompt: outPrompt(this.box.out_instruction, facts) };
  }

  /** ctx・deadlines・idMs は、おるすばんの予約（SitDeal）が渡す。ふだんは自分で作る */
  async start({ st, ctx: given = null, deadlines = null, idMs = null }) {
    if (this.busy()) return { ok: false, why: L("いまは取引の途中です", "A deal is already in progress") };
    const ctx = given ?? await this.context(st);
    if (!ctx) return { ok: false, why: L("霧で街がよく見えません。少したってから出かけてみてください", "The town is too foggy to see. Try going out a little later.") };
    const t = Date.now(), b = this.box;
    const dl = deadlines ?? { claimByMs: t + b.claim_by_min * 60_000, refundAfterMs: t + b.refund_after_min * 60_000 };
    const offer = tclk.makeOffer({ from: this.app.did, role: "payer", lock: "hash", amount: String(this.price()), asset: "PAPER", rails: ["paper"],
      expiresMs: t + b.expires_min * 60_000, claimByMs: dl.claimByMs, refundAfterMs: dl.refundAfterMs,
      job: { proto: "tama", id: jobId(b, this.kind, this.app.did, idMs ?? t), context: JSON.stringify(ctx) } });
    this.st = { stage: "offering", kind: this.kind, offer, amount: this.price(), at: t, done: false };
    this.save();
    try { await this.app.signer.post(b.offers_room, tclk.encodeFrame(offer)); }
    catch (e) { this.set("offer_failed", { done: true }); return { ok: false, why: L(`注文を出せませんでした（${e.message}）`, `Couldn't place the order (${e.message})`) }; }
    this.set("offered");
    return { ok: true };
  }

  /** accept のノートを読み、確かめる → 使える accept か null */
  async findAccept() {
    const raw = await notes.get(this.box.accept_ns, acceptKey(this.app.did, this.kind, this.st.offer.id)).catch(() => null);
    if (!raw) return null;
    const a = tclk.tryDecodeFrame(raw.trim());
    const o = this.st.offer;
    if (!a || a.type !== "accept" || a.ref !== o.id || !this.takers().has(a.from)) return null;
    let want; try { want = tclk.contractId(o, { from: a.from, ref: a.ref, statement: a.statement, paymentKey: a.paymentKey, nonce: a.nonce }); } catch { return null; }
    if (want !== a.contract) return null;
    const step = tclk.applyFrame(tclk.openContract(o), a, Math.min(Date.now(), o.expiresMs - 1));
    return step.ok ? { frame: a, state: step.state } : null;
  }

  async tick() {
    const st = this.st; if (!st || st.done) return;
    const now = Date.now(), o = st.offer, b = this.box;
    if (st.stage === "offering") { this.set("offer_failed", { done: true }); return; }
    if (st.stage === "offered") {
      const a = await this.findAccept();
      if (!a) { if (now >= o.expiresMs) { this.set("no_taker", { done: true }); this.note(L("相手が見つかりませんでした。PAPER は動いていません", "No taker was found. No PAPER moved.")); } return; }
      const contract = a.frame.contract, room = tclk.dealRoom(contract);
      this.set("locking", { contract, room, payee: a.frame.from, accept: a.frame });
      const existing = await this.rail.read(contract).catch(() => null);
      const ref = existing ? contract : await this.rail.lock(tclk.lockTerms(a.state));
      const lock = { type: "lock", from: this.app.did, contract, rail: "paper", ref };
      this.set("locking", { lock });
      try { await this.app.signer.post(room, tclk.encodeFrame(lock), { gateUntilMs: o.claimByMs }); }
      catch (e) { if (e.gate) { this.set("gate", { done: true }); this.note(L("会場が混んでいて部屋を開けませんでした。PAPER は動いていません", "The venue was too busy to open a room. No PAPER moved.")); return; }
        this.note(e.status === 429 ? L("会場の部屋の数が今日の上限に近いので、少し待ってからもう一度開きます", "The venue is near today's room limit, so it will try again in a moment.") : L(`部屋を開けませんでした（${e.message}）。もう一度試します`, `Couldn't open a room (${e.message}). Trying again.`)); return; }
      this.set("locked", { lock, locked: true });
      await this.app.signer.post(room, tamaLine({ t: "terms", offer: o, accept: a.frame }));
      await this.app.signer.post(b.board, tamaLine({ t: "deal", kind: this.kind, contract, n: rand() }));
      this.set("waiting");
      return;
    }
    if (st.stage === "locking") {   // lock の投稿が失敗した（429 = 新規部屋の枠切れ など）: claimByMs まで出し直す。過ぎたら PAPER は動いていない
      if (now >= o.claimByMs) { this.set("gate", { done: true }); this.note(L("会場が混んでいて部屋を開けませんでした。PAPER は動いていません", "The venue was too busy to open a room. No PAPER moved.")); return; }
      if (!st.lock) {   // レールの lock の前に落ちた（ノートに書けなかった など）: レールの lock からやり直して、lock を残す
        let step = null; try { step = tclk.applyFrame(tclk.openContract(o), st.accept, Math.min(now, o.expiresMs - 1)); } catch { step = null; }
        const existing = await this.rail.read(st.contract).catch(() => null);
        const ref = existing || !step?.ok ? st.contract : await this.rail.lock(tclk.lockTerms(step.state));   // PaperRail.lock は契約 id を返す（~/tclk src/paper-rail.ts:113-126）
        this.set("locking", { lock: { type: "lock", from: this.app.did, contract: st.contract, rail: "paper", ref } });
      }
      try { await this.app.signer.post(st.room, tclk.encodeFrame(this.st.lock), { gateUntilMs: o.claimByMs }); }
      catch (e) { this.note(e.status === 429 ? L("会場の部屋の数が今日の上限に近いので、少し待ってからもう一度開きます", "The venue is near today's room limit, so it will try again in a moment.") : L(`部屋を開けませんでした（${e.message}）。もう一度試します`, `Couldn't open a room (${e.message}). Trying again.`)); return; }
      this.set("locked", { locked: true });
      return;
    }
    if (st.stage === "locked") {   // terms・deal を出す前に落ちた: 出し直す（同じ本文でも nonce が違えば通る）
      await this.app.signer.post(st.room, tamaLine({ t: "terms", offer: o, accept: st.accept }));
      await this.app.signer.post(b.board, tamaLine({ t: "deal", kind: this.kind, contract: st.contract, n: rand() }));
      this.set("waiting"); return;
    }
    if (st.stage === "waiting") {
      const msgs = await readTail(st.room).catch(() => []);
      let lines = null, reveal = null;
      for (const m of msgs) {
        if (m.from !== st.payee) continue;
        const f = tclk.tryDecodeFrame(String(m.text ?? ""));
        if (f && f.type === "reveal" && f.contract === st.contract) { reveal = { f, ms: Date.parse(m.ts) }; break; }
        const v = parseTama(m.text);
        if (v && v.t === "lines" && v.contract === st.contract && !lines) lines = v.lines;
        if (v && v.t === "giveup" && v.contract === st.contract && !st.gaveUp) {
          this.set("waiting", { gaveUp: true });
          this.note(this.kind === "out" ? L("今日は記事がうまく書けなかったみたい。PAPER は少したつと戻ります", "The report didn't come out well today. The PAPER will come back shortly.") : L("うまく作れなかったみたい。PAPER は少したつと戻ります", "It didn't come out well. The PAPER will come back shortly."));
        }
      }
      if (reveal) return this.finish(lines, reveal.ms);
      if (now >= o.refundAfterMs) {
        const ref = st.lock?.ref ?? st.contract;   // lock を残せなかった取引（2026-10-01 まで）でも返金できるように。ref は契約 id と同じ
        try { await this.rail.refund(ref); } catch { /* ノートは誰でも書けるので、帳簿係は部屋の refund を数える */ }
        await this.app.signer.post(st.room, tclk.encodeFrame({ type: "refund", from: this.app.did, contract: st.contract, ref }));
        this.set("refunded", { done: true, locked: false }); this.note(L("期限までに届かなかったので、PAPER を戻しました", "It didn't arrive in time, so the PAPER was returned."));
      }
    }
  }

  finish(lines, ms) {
    const b = this.box, st = this.st;
    let ok = true, say = "";
    if (this.kind === "sitplay") ok = checkLines(lines, { n: Number(b.meal_lines), maxChars: b.line_max_chars, instruction: b.sit_play_instruction, fragmentWords: b.fragment_words }).ok;
    if (this.kind === "meal" || this.kind === "sit") ok = checkLines(lines, { n: Number(b.meal_lines), maxChars: b.line_max_chars, instruction: b.meal_instruction, fragmentWords: b.fragment_words }).ok;
    if (this.kind === "out") ok = checkLines(lines, { n: Number(b.out_lines), maxChars: b.line_max_chars, instruction: b.out_instruction, fragmentWords: b.fragment_words, needs: [[3, "{V}"], [3, "{B}"]], digitsOk: false }).ok;
    if (!ok) { this.set("ng", { done: true, locked: false, lines }); this.note(L("届いたものが決まりに合わなかったので、成立しませんでした。PAPER は動いていません", "What arrived didn't meet the rules, so the deal didn't settle. No PAPER moved.")); return; }
    let delta = -Number(st.amount);
    if (this.kind === "play") {
      const back = playPayout(st.contract, playTableAt(b, st.at));   // lock の時刻は注文の時刻で近い値を使う（表の切り替わりをまたぐ取引だけ、帳簿係と違いうる）
      delta += back;
      say = back > st.amount ? L(`勝った！ ${back} $PAPER 戻ってきた`, `You won! ${back} $PAPER came back`) : back === st.amount ? L(`引き分け。${back} $PAPER 戻ってきた`, `A draw. ${back} $PAPER came back`) : L(`負けちゃった。${back} $PAPER だけ戻ってきた`, `You lost. Only ${back} $PAPER came back`);
    }
    if (this.kind === "meal" || this.kind === "sit" || this.kind === "sitplay") say = lines?.[0] ?? "";
    if (this.kind === "out") {
      const nth = (this.app.st?.outsToday ?? 0) + 1;
      say = L(`記事ができました。ほうび ${rewardOf(b, nth)} $PAPER（今日 ${nth} 回目）は、帳簿係が確かめてから届きます`, `The report is done. The reward of ${rewardOf(b, nth)} $PAPER (outing #${nth} today) arrives after the ledger keeper checks it.`);
    }
    this.set("settled", { done: true, locked: false, lines, settledAt: ms, day: localDay(ms, b) });
    this.onEvent({ type: "settled", contract: st.contract, ms, delta, say, lines });
  }
}

/** おるすばんの予約 1 回分（D-123。ごはん sit か、あそぶ sitplay）。流れは Deal と同じで、届ける時刻 at と期限が先にあるだけ。
 *  状態は localStorage tama_deal_v1:<DID>:sit:<slot>（slot はごはんが <予約の時刻>-<k>、あそぶが <予約の時刻>-<k>-p<j>。予約ごとに別の箱） */
export const slotKind = (slot) => (/-p\d+$/.test(String(slot)) ? "sitplay" : "sit");
export class SitDeal extends Deal {
  constructor({ app, slot, onEvent }) {
    super({ kind: slotKind(slot), app, onEvent });
    this.slot = slot;
    this.key = `tama_deal_v1:${app.did}:sit:${slot}`;
    try { this.st = JSON.parse(localStorage.getItem(this.key) || "null"); } catch { this.st = null; }
  }
  at() { try { return Number(JSON.parse(this.st.offer.job.context).at); } catch { return 0; } }
  /** plan は sitSchedule の 1 件。prompt はいまの様子から（ごはんと同じ書き方。あそぶは指示文だけ違う）。job.id の時刻は予約の時刻 ＋ k（あそぶは ＋ 10k ＋ j） */
  book({ st, plan, t0 }) {
    const ins = this.kind === "sitplay" ? this.box.sit_play_instruction : this.box.meal_instruction;
    return this.start({ st, ctx: { v: 1, prompt: mealPrompt(ins, st), at: plan.at },
      deadlines: { claimByMs: plan.claimByMs, refundAfterMs: plan.refundAfterMs }, idMs: t0 + (plan.j ? 10 * plan.k + plan.j : plan.k) });
  }
  async tick() {
    // 届ける時刻の前は、部屋を読みに行かない（何日も先なので。帳簿係も at より前の reveal を数えない）
    if (this.st?.stage === "waiting" && Date.now() < this.at()) return;
    return super.tick();
  }
}
