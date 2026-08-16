/*
 * LANGUAGE.
 *
 * The family is French. The game was written in English, and every one of
 * roughly nineteen hundred player-facing strings lives inline in the module
 * that uses it - which is the right way to write a game and the wrong way to
 * translate one. So this adds a language layer that does not ask the rest of
 * the codebase to change shape.
 *
 * Three mechanisms, because the text lives in three different shapes:
 *
 *  1. ENGLISH IS THE KEY. `t("Fly a mission")` looks the English up in the
 *     active pack and hands back the English itself if there is no entry.
 *     No key invented, no key to keep in sync, and a missing translation
 *     shows English rather than a blank or a raw identifier - which matters
 *     for a game a seven-year-old is holding.
 *
 *  2. THE DOM SWEEP. index.html carries a hundred-odd fixed labels. Rather
 *     than tag every one with data-i18n, the sweep walks text nodes and
 *     translates the ones the pack knows. Untouched markup, and adding a
 *     language never means editing HTML again.
 *
 *  3. THE DATA TABLES. Missions, comms, enemies, bosses, upgrades and ranks
 *     are static objects read by dozens of call sites (`m.name`, `def.blurb`).
 *     Rewriting those call sites would be an enormous diff for no gain, so
 *     the fields are rewritten IN PLACE, with the English captured first so
 *     switching back is exact. Everything downstream just works.
 *
 * Adding a third language is one more pack object and nothing else.
 */
(function(){
"use strict";
const SF = window.SF;
const KEY = "patrol_lang";

const packs = { en: null };            // en is the identity: no lookup needed
let lang = "en";
const listeners = [];

/* What the device would like, used only when nothing has been chosen yet. */
function preferred(){
  try {
    const saved = window.localStorage.getItem(KEY);
    if(saved && (saved === "en" || packs[saved])) return saved;
    const nav = (window.navigator && (navigator.language || navigator.userLanguage)) || "";
    return nav.slice(0,2).toLowerCase() === "fr" ? "fr" : "en";
  } catch(e){ return "en"; }
}

/** Registers a pack. `strings` is English -> translation. */
function register(code, pack){ packs[code] = pack || {}; }

/**
 * The translator. `t("Ready, {name}?", {name:"Marc"})`.
 * Interpolation happens AFTER lookup, so a pack may reorder placeholders -
 * which French needs constantly, since it puts things in a different order.
 */
function t(en, vars){
  const pack = packs[lang];
  let out = en;
  if(pack && pack.s && Object.prototype.hasOwnProperty.call(pack.s, en)) out = pack.s[en];
  if(vars) out = String(out).replace(/\{(\w+)\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m);
  return out;
}

/* ---------------------------------------------------------
   THE DATA TABLES
   --------------------------------------------------------- */
/*
 * Every table this touches is registered as a list of {obj, fields}. The
 * English is snapshotted the first time we localize, never after - so a
 * second switch reads the original and not a translation of a translation.
 */
const bound = [];
let snapped = false;
function bind(obj, fields, keyer){
  if(obj) bound.push({ obj, fields, keyer });
}
function snapshot(){
  if(snapped) return;
  bound.forEach(b => {
    b.en = {};
    b.fields.forEach(f => { if(typeof b.obj[f] === "string") b.en[f] = b.obj[f]; });
  });
  snapped = true;
}
function applyData(){
  snapshot();
  const pack = packs[lang];
  bound.forEach(b => {
    b.fields.forEach(f => {
      const en = b.en[f];
      if(en === undefined) return;
      let out = en;
      if(pack && pack.s && Object.prototype.hasOwnProperty.call(pack.s, en)) out = pack.s[en];
      b.obj[f] = out;
    });
  });
}

/* Arrays of plain strings (comms lines, story beats) get their own pass. */
const boundLists = [];
function bindList(arr){ if(Array.isArray(arr)) boundLists.push({ arr, en: arr.slice() }); }
function applyLists(){
  const pack = packs[lang];
  boundLists.forEach(b => {
    for(let i=0;i<b.arr.length;i++){
      const en = b.en[i];
      if(typeof en !== "string") continue;
      b.arr[i] = (pack && pack.s && Object.prototype.hasOwnProperty.call(pack.s, en))
        ? pack.s[en] : en;
    }
  });
}

/* ---------------------------------------------------------
   THE DOM SWEEP
   --------------------------------------------------------- */
/*
 * Text nodes only, plus placeholders and aria-labels. Deliberately exact-
 * match: anything the pack does not know is left exactly as it was, so a
 * partial pack degrades to a partly-English game rather than a broken one.
 *
 * Numbers and score readouts are rewritten constantly by the UI and will
 * never match a pack entry, so they are safe by construction.
 */
function sweep(root){
  const scope = root || document.body;
  if(!scope || !document.createTreeWalker) return;
  const pack = packs[lang];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
  const jobs = [];
  let n;
  while((n = walker.nextNode())){
    const raw = n.nodeValue;
    if(!raw) continue;
    const key = raw.trim();
    if(key.length < 2) continue;
    if(!n.__enText) n.__enText = key;              // remember the original
    const src = n.__enText;
    const to = (pack && pack.s && Object.prototype.hasOwnProperty.call(pack.s, src))
      ? pack.s[src] : src;
    if(to !== key) jobs.push([n, raw.replace(key, to)]);
  }
  jobs.forEach(([node, v]) => { node.nodeValue = v; });

  ["placeholder", "aria-label", "title"].forEach(attr => {
    const els = scope.querySelectorAll("[" + attr + "]");
    for(let i=0;i<els.length;i++){
      const el = els[i];
      const store = "__en_" + attr;
      if(!el[store]) el[store] = el.getAttribute(attr);
      const src = el[store];
      const to = (pack && pack.s && Object.prototype.hasOwnProperty.call(pack.s, src))
        ? pack.s[src] : src;
      if(el.getAttribute(attr) !== to) el.setAttribute(attr, to);
    }
  });
}

/* ---------------------------------------------------------
   PUBLIC
   --------------------------------------------------------- */
function apply(){
  applyData();
  applyLists();
  sweep();
  try { document.documentElement.setAttribute("lang", lang); } catch(e){}
}
function setLang(code){
  if(code !== "en" && !packs[code]) return false;
  if(code === lang) return true;
  lang = code;
  try { window.localStorage.setItem(KEY, code); } catch(e){}
  apply();
  listeners.forEach(fn => { try { fn(code); } catch(e){} });
  return true;
}
/** Runs once everything else has loaded and the tables exist. */
function boot(){
  lang = preferred();
  try { window.localStorage.setItem(KEY, lang); } catch(e){}
  apply();
}
function onChange(fn){ if(typeof fn === "function") listeners.push(fn); }

SF.i18n = {
  t, register, setLang, boot, apply, sweep, onChange,
  bind, bindList,
  lang: () => lang,
  available: () => ["en"].concat(Object.keys(packs).filter(k => k !== "en")),
  // The suite reads these to prove coverage rather than infer it.
  _packs: packs, _bound: bound, _lists: boundLists,
};
})();
