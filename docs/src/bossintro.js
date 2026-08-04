/*
 * THE BOSS ARRIVAL - every boss, introduced like the finale.
 *
 * The Devourer's entrance (finale.js) taught us what a boss arrival buys:
 * the player stops shooting, the room goes dark, something too big comes
 * down out of it, and then it is NAMED. The customer's verdict was "it puts
 * the player on edge and it's super cool" - so every boss gets one.
 *
 * This is the general engine: three beats and about six seconds, driven by
 * the boss's own identity (name, epithet, tint, hull) so seven bosses get
 * seven different cards from one timeline. The finale keeps its bespoke
 * four-beat, ten-second version in finale.js - the last boss must still be
 * the biggest arrival in the game, so this one is deliberately shorter,
 * brighter and higher-pitched than the Devourer's sub-bass ritual.
 *
 * Same rules as finale.js: simulation time only, and nothing here can hurt
 * the player - the intro is theatre, the fight afterwards is the danger.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp } = SF.core;
const fx = SF.fx;
const audio = SF.audio;

const BEATS = [
  { id:"alarm", dur: 1.5 },   // klaxon. the sky dims. letterbox slides in.
  { id:"rise",  dur: 2.4 },   // it comes down, slow and heavy
  { id:"name",  dur: 2.2 },   // WHO it is, in its own colour
];
const TOTAL = BEATS.reduce((n, b) => n + b.dur, 0);

let intro = null;    // { t }

function reset(){ intro = null; }
function active(){ return !!intro; }
function progress(){ return intro ? clamp(intro.t / TOTAL, 0, 1) : 1; }

function beat(){
  if(!intro) return null;
  let t = intro.t;
  for(let i = 0; i < BEATS.length; i++){
    if(t < BEATS[i].dur) return { id: BEATS[i].id, k: t / BEATS[i].dur, i };
    t -= BEATS[i].dur;
  }
  return null;
}

function begin(){
  intro = { t: 0 };
  audio.play("bossWake");
  return intro;
}

/** Advances the arrival; owns the boss's descent. True on the finishing frame. */
function update(dt, boss){
  if(!intro) return false;
  const before = beat();
  intro.t += dt;
  const b = beat();

  // The descent: from above the sky down to station, eased so the weight
  // lands. bossintro owns the arrival - bosses.js must not also fly it in.
  if(boss){
    if(!b || b.i >= 1){
      const k = b && b.id === "rise" ? b.k : 1;
      boss.y = -boss.size*1.1 + (boss.targetY + boss.size*1.1) * easeOutCubic(k);
      boss.entering = false;
    } else {
      boss.y = -boss.size*1.4;
    }
  }

  if(b && (!before || before.id !== b.id)){
    if(b.id === "rise"){ audio.play("bossRise"); fx.shake(5); }
    if(b.id === "name"){
      audio.play("bossRoar");
      fx.shake(16);
      if(boss) fx.flash(0.4, hexToRgbStr(boss.tint));
    }
  }
  // The room trembles while it descends - the same tell as the finale,
  // turned down.
  if(b && b.id === "rise") fx.shake(1.5 + b.k*4);

  if(intro.t >= TOTAL){ intro = null; return true; }
  return false;
}

function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }
function hexToRgbStr(hex){
  const n = parseInt((hex || "#ff2d55").slice(1), 16);
  return ((n>>16)&255) + "," + ((n>>8)&255) + "," + (n&255);
}

SF.bossintro = { reset, begin, active, beat, progress, update, TOTAL, hexToRgbStr };
})();
