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
import { jobId, tamaLine, parseTama, acceptKey, checkLines, mealPrompt, outPrompt, playPayout, localDay, rewardOf } from "./tama_core.js";

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
  price() { return Number({ meal: this.box.meal_price, out: this.box.out_price, play: this.box.play_stake }[this.kind]); }
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

  async start({ st }) {
    if (this.busy()) return { ok: false, why: "いまは取引の途中です" };
    const ctx = await this.context(st);
    if (!ctx) return { ok: false, why: "霧で街がよく見えません。少したってから出かけてみてください" };
    const t = Date.now(), b = this.box;
    const offer = tclk.makeOffer({ from: this.app.did, role: "payer", lock: "hash", amount: String(this.price()), asset: "PAPER", rails: ["paper"],
      expiresMs: t + b.expires_min * 60_000, claimByMs: t + b.claim_by_min * 60_000, refundAfterMs: t + b.refund_after_min * 60_000,
      job: { proto: "tama", id: jobId(b, this.kind, this.app.did, t), context: JSON.stringify(ctx) } });
    this.st = { stage: "offering", kind: this.kind, offer, amount: this.price(), at: t, done: false };
    this.save();
    try { await this.app.signer.post(b.offers_room, tclk.encodeFrame(offer)); }
    catch (e) { this.set("offer_failed", { done: true }); return { ok: false, why: `注文を出せませんでした（${e.message}）` }; }
    this.set("offered");
    return { ok: true };
  }

  /** accept のノートを読み、確かめる → 使える accept か null */
  async findAccept() {
    const raw = await notes.get(this.box.accept_ns, acceptKey(this.app.did, this.kind)).catch(() => null);
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
      if (!a) { if (now >= o.expiresMs) { this.set("no_taker", { done: true }); this.note("相手が見つかりませんでした。PAPER は動いていません"); } return; }
      const contract = a.frame.contract, room = tclk.dealRoom(contract);
      this.set("locking", { contract, room, payee: a.frame.from, accept: a.frame });
      const existing = await this.rail.read(contract).catch(() => null);
      const ref = existing ? contract : await this.rail.lock(tclk.lockTerms(a.state));
      const lock = { type: "lock", from: this.app.did, contract, rail: "paper", ref };
      this.set("locking", { lock });
      try { await this.app.signer.post(room, tclk.encodeFrame(lock), { gateUntilMs: o.claimByMs }); }
      catch (e) { if (e.gate) { this.set("gate", { done: true }); this.note("会場が混んでいて部屋を開けませんでした。PAPER は動いていません"); return; }
        this.note(e.status === 429 ? "会場の部屋の数が今日の上限に近いので、少し待ってからもう一度開きます" : `部屋を開けませんでした（${e.message}）。もう一度試します`); return; }
      this.set("locked", { lock, locked: true });
      await this.app.signer.post(room, tamaLine({ t: "terms", offer: o, accept: a.frame }));
      await this.app.signer.post(b.board, tamaLine({ t: "deal", kind: this.kind, contract, n: rand() }));
      this.set("waiting");
      return;
    }
    if (st.stage === "locking") {   // lock の投稿が失敗した（429 = 新規部屋の枠切れ など）: claimByMs まで出し直す。過ぎたら PAPER は動いていない
      if (now >= o.claimByMs) { this.set("gate", { done: true }); this.note("会場が混んでいて部屋を開けませんでした。PAPER は動いていません"); return; }
      try { await this.app.signer.post(st.room, tclk.encodeFrame(st.lock ?? { type: "lock", from: this.app.did, contract: st.contract, rail: "paper", ref: st.contract }), { gateUntilMs: o.claimByMs }); }
      catch (e) { this.note(e.status === 429 ? "会場の部屋の数が今日の上限に近いので、少し待ってからもう一度開きます" : `部屋を開けませんでした（${e.message}）。もう一度試します`); return; }
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
          this.note(this.kind === "out" ? "今日は記事がうまく書けなかったみたい。PAPER は少したつと戻ります" : "うまく作れなかったみたい。PAPER は少したつと戻ります");
        }
      }
      if (reveal) return this.finish(lines, reveal.ms);
      if (now >= o.refundAfterMs) {
        try { await this.rail.refund(st.lock.ref); } catch { /* ノートは誰でも書けるので、帳簿係は部屋の refund を数える */ }
        await this.app.signer.post(st.room, tclk.encodeFrame({ type: "refund", from: this.app.did, contract: st.contract, ref: st.lock.ref }));
        this.set("refunded", { done: true, locked: false }); this.note("期限までに届かなかったので、PAPER を戻しました");
      }
    }
  }

  finish(lines, ms) {
    const b = this.box, st = this.st;
    let ok = true, say = "";
    if (this.kind === "meal") ok = checkLines(lines, { n: Number(b.meal_lines), maxChars: b.line_max_chars, instruction: b.meal_instruction, fragmentWords: b.fragment_words }).ok;
    if (this.kind === "out") ok = checkLines(lines, { n: Number(b.out_lines), maxChars: b.line_max_chars, instruction: b.out_instruction, fragmentWords: b.fragment_words, needs: [[3, "{V}"], [3, "{B}"]], digitsOk: false }).ok;
    if (!ok) { this.set("ng", { done: true, locked: false, lines }); this.note("届いたものが決まりに合わなかったので、成立しませんでした。PAPER は動いていません"); return; }
    let delta = -Number(st.amount);
    if (this.kind === "play") {
      const back = playPayout(st.contract, b.play_table);
      delta += back;
      say = back > st.amount ? `勝った！ ${back} $PAPER 戻ってきた` : back === st.amount ? `引き分け。${back} $PAPER 戻ってきた` : `負けちゃった。${back} $PAPER だけ戻ってきた`;
    }
    if (this.kind === "meal") say = lines?.[0] ?? "";
    if (this.kind === "out") {
      const nth = (this.app.st?.outsToday ?? 0) + 1;
      say = `記事ができました。ほうび ${rewardOf(b, nth)} $PAPER（今日 ${nth} 回目）は、帳簿係が確かめてから届きます`;
    }
    this.set("settled", { done: true, locked: false, lines, settledAt: ms, day: localDay(ms, b) });
    this.onEvent({ type: "settled", contract: st.contract, ms, delta, say, lines });
  }
}
