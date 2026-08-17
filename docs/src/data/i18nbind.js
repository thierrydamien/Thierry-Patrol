/*
 * WHAT GETS LOCALIZED, AND WHERE IT LIVES.
 *
 * The tables are read by dozens of call sites as plain fields - `m.name`,
 * `def.blurb`, `rank.name`. Rewriting every one of those to go through a
 * translator would be a huge diff for no benefit, so instead this registers
 * the fields with i18n.js, which rewrites them in place and keeps the
 * English so switching back is exact.
 *
 * LOADS LATE, DELIBERATELY. Every table named below has to exist by the time
 * this runs, and shipart is module 31 of 38 - registered from slot 11 this
 * file silently bound nothing for the hulls, the tunes and the ship parts,
 * which is why "Twin Barrels" stayed English through three passes of
 * translation. It sits immediately before ui.js, which boots the language.
 *
 * Separate from fr.js on purpose: this file says WHICH text is player-facing,
 * which is a fact about the game and not about French. A second language adds
 * a pack and touches nothing here.
 */
(function(){
"use strict";
const SF = window.SF;
const I = SF.i18n;
if(!I) return;

const C = SF.config || {};
const M = SF.missions || {};

/* Missions: everything the briefing, the map and the pause card show. */
(M.MISSIONS || []).forEach(m => I.bind(m, ["name", "subtitle", "brief", "goal"]));
/* ...and the boss cards, which the arrival cutscene names in full. */
Object.keys(M.BOSSES || {}).forEach(k => I.bind(M.BOSSES[k], ["name", "epithet"]));
/* Star objectives: the three lines on the briefing and the pause overlay. */
Object.keys(M.OBJECTIVES || {}).forEach(k => I.bind(M.OBJECTIVES[k], ["label"]));

/* The shop: categories, parts, hulls, paints, trails and their blurbs. */
(C.UPGRADES || []).forEach(u => I.bind(u, ["name", "desc", "blurb", "cat"]));
(C.SHIP_COLORS || []).forEach(c => I.bind(c, ["name"]));
(C.RANKS || []).forEach(r => I.bind(r, ["name"]));
(C.DIFFICULTIES || []).forEach(d => I.bind(d, ["name", "word", "blurb"]));
(C.ACHIEVEMENTS || []).forEach(a => I.bind(a, ["name", "blurb", "hint"]));
(C.CATEGORIES || []).forEach(c => I.bind(c, ["name"]));
if(SF.shipart && SF.shipart.HULLS)
  SF.shipart.HULLS.forEach(h => I.bind(h, ["name", "blurb"]));
if(SF.shipart && SF.shipart.PARTS)
  SF.shipart.PARTS.forEach(p => I.bind(p, ["name", "blurb"]));
if(SF.shipart && SF.shipart.TUNES)
  SF.shipart.TUNES.forEach(t => I.bind(t, ["name", "blurb"]));

/* Every enemy the roster panel names. */
const ET = (SF.enemyData && SF.enemyData.ENEMY_TYPES) || {};
Object.keys(ET).forEach(k => I.bind(ET[k], ["name"]));

/* Comms are arrays of interchangeable lines; the story beats are prose. */
const CD = (SF.commsData && SF.commsData.COMMS) || {};
Object.keys(CD).forEach(k => { if(CD[k] && CD[k].lines) I.bindList(CD[k].lines); });
const ST = (SF.storyData && SF.storyData.STORY) || {};
Object.keys(ST).forEach(k => {
  const b = ST[k];
  if(!b) return;
  I.bind(b, ["title", "text", "sub", "button"]);
  if(Array.isArray(b.lines)) I.bindList(b.lines);
  // The pages themselves: the panels' prose is the part a reader actually
  // reads, and it went untranslated for months because only the shell of
  // the beat was registered here.
  (b.panels || []).forEach(pn => I.bind(pn, ["text"]));
});
})();
