// tama_i18n.js — 表示の言語（日本語／英語）。L(日本語, 英語) が、いまの言語の文を返す。
// 覚えるのはこのブラウザだけ。はじめは、ブラウザの言語が日本語なら日本語、それ以外は英語。HAKO のひとことと記事は訳さない（英語のまま）。
let lang = "ja";
try {
  if (typeof document !== "undefined") {
    const s = localStorage.getItem("tama_lang");
    lang = s === "en" || s === "ja" ? s : String(navigator.language || "ja").toLowerCase().startsWith("ja") ? "ja" : "en";
  }
} catch { lang = "ja"; }
export const getLang = () => lang;
export function setLang(l) { lang = l === "en" ? "en" : "ja"; try { localStorage.setItem("tama_lang", lang); } catch { /* 覚えないだけ */ } }
export const L = (ja, en) => (lang === "en" ? en : ja);
