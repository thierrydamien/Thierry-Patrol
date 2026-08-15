/*
 * The WACKY SKY: an endless, procedurally generated mission where every
 * flight rolls two or three silly modifiers before launch - giant enemies,
 * a tiny ship, confetti explosions, bouncing coins, Papa heads raining from
 * space. The pull is "what did we get THIS time?!", which is a much stronger
 * reason for a seven-year-old to press the button than the fairness
 * leaderboard it replaces.
 *
 * (It replaces the Daily Patrol, and not only because the kids didn't care
 * about a same-sky-for-everyone contest: the same-sky promise was only ever
 * half true. The wave SCRIPT was seeded by the date, but placement, elites
 * and every per-enemy trait came from the global Math.random - two devices
 * agreed on the plan and then flew different skies. This mode promises
 * surprise instead of fairness, which the engine can actually deliver.)
 *
 * The wave script machinery is inherited: escalation in one-minute bands,
 * each widening the enemy pool, tightening the gap and growing the
 * formations; elites salting the waves from the fourth minute; a carrier
 * forced in ~every 45 seconds so rescues stay on the menu; the script cut at
 * 25 minutes - outlive it and the mission completes outright. The seeded RNG
 * is kept so the whole script comes from one draw.
 *
 * THE MODIFIER RULES, learned by imagining an eight-year-old mid-run:
 *  - Every modifier must be VISIBLE within seconds. "Enemies have 12% more
 *    hull" is a patch note, not a party.
 *  - No modifier may make the run harder than the campaign. This is the
 *    silly mode; NIGHTMARE exists for pain. Giant enemies get a little more
 *    hull but are far easier to hit - net easier, and meant to be.
 *  - Effects live in the systems they modify (spawnEnemy, updatePickups, the
 *    kill callback), switched by `world.mods` / `run.mods` - the same
 *    per-mission flag pattern as `world.silent`. This file only DECLARES
 *    them, so the table can grow without this file learning any physics.
 */
(function(){
"use strict";
const SF = window.SF;

/* Band pools only name types that exist in enemies.js - the smoke test walks
   every generated wave to hold that true. */
const BANDS = [
  { types:["grunt","weaver"],
    forms:["line","vee","arc","twinColumns"],                 gap:[5.2,6.2], n:[5,8]  },
  { types:["grunt","weaver","striker","swooper"],
    forms:["line","vee","arc","twinColumns","tripleColumns","scatter"],
                                                              gap:[4.6,5.6], n:[6,9]  },
  { types:["grunt","weaver","striker","swooper","kamikaze","asteroid","carrier"],
    forms:["vee","arc","twinColumns","tripleColumns","scatter","wall","pincer","sides"],
                                                              gap:[4.2,5.2], n:[6,10] },
  { types:["grunt","weaver","striker","swooper","kamikaze","asteroid","carrier",
           "brute","turret","sniper"],
    forms:["arc","twinColumns","tripleColumns","scatter","wall","pincer","sides"],
                                                              gap:[3.8,4.8], n:[7,11] },
  { types:["grunt","weaver","striker","swooper","kamikaze","asteroid","carrier",
           "brute","turret","sniper","interceptor","splitter","bomber","thief"],
    forms:["arc","twinColumns","tripleColumns","scatter","wall","pincer","sides"],
                                                              gap:[3.5,4.5], n:[7,12] },
  { types:["grunt","weaver","striker","swooper","kamikaze","asteroid","carrier",
           "brute","turret","sniper","interceptor","splitter","bomber","thief",
           "shielder","mender","hive","boulder"],
    forms:["arc","twinColumns","tripleColumns","scatter","wall","pincer","sides"],
                                                              gap:[3.2,4.2], n:[8,13] },
];
const MAX_SECONDS = 1500;   // 25 minutes of script, then the credits roll

/*
 * The table. `blurb` is written for the reveal, at reading level, in a kid's
 * own grammar of excitement. Implementation lives at the hook named in the
 * comment; this file never touches physics.
 */
const MODIFIERS = [
  { id:"giant",    name:"GIANT ENEMIES",   color:"#ff8a3d",
    blurb:"They're ENORMOUS! You can't miss. Really." },       // entities.spawnEnemy
  { id:"tiny",     name:"TINY SHIP",       color:"#7cc4ff",
    blurb:"Your ship is a little bug. Good luck hitting THAT!" }, // game.startMission -> player
  { id:"mega",     name:"MEGA SHIP",       color:"#ff5d73",
    blurb:"Your ship is ENORMOUS. Scare them off the screen!" },  // game.startMission -> player
  { id:"confetti", name:"CONFETTI BLASTS", color:"#c084fc",
    blurb:"Every enemy pops like a firework." },               // game.onEnemyKilled
  { id:"bouncy",   name:"BOUNCY COINS",    color:"#ffd23f",
    blurb:"Coins bounce around the sky. Chase them!" },        // entities.updatePickups
  { id:"papaRain", name:"PAPA RAIN",       color:"#ffe9a8",
    blurb:"Papa heads fall from space. Catch them!" },         // game.update
  { id:"gold",     name:"DOUBLE COINS",    color:"#ffd23f",
    blurb:"It rains money, and everything pays double!" },     // run.payScale + coin rain
  { id:"turbo",    name:"TURBO ENGINES",   color:"#4ade80",
    blurb:"Your ship is super fast. Hold on!" },               // game.startMission -> player
  { id:"sleepy",   name:"SLEEPY ENEMIES",  color:"#9bb0ff",
    blurb:"They fly half asleep, slow as clouds." },           // entities.spawnEnemy
  { id:"disco",    name:"DISCO SKY",       color:"#f472b6",
    blurb:"The whole sky is a dance floor. Everything changes colour!" }, // render.drawDisco
  { id:"vacuum",   name:"SUPER MAGNET",    color:"#38bdf8",
    blurb:"Every coin in the sky comes flying to you." },      // entities.updatePickups
  { id:"chain",    name:"CHAIN REACTION",  color:"#fb923c",
    blurb:"Pop one and its neighbours go off too. BOOM BOOM BOOM!" }, // game.onEnemyKilled
  { id:"bubbles",  name:"BUBBLE SHOTS",    color:"#a5f3fc",
    blurb:"Their bullets are slow floaty bubbles. Pop!" },     // entities.spawnEnemyBullet
];
const MOD_BY_ID = {};
MODIFIERS.forEach(m => MOD_BY_ID[m.id] = m);

/*
 * The pairs that cannot share a sky. Only one so far: a ship cannot be tiny
 * and enormous at once.
 */
const CONFLICTS = [
  ["tiny", "mega"],
  // BOUNCY COINS is a joke about coins going where you aren't; SUPER MAGNET
  // is a joke about coins coming to you. Together, neither one happens.
  ["bouncy", "vacuum"],
];
function conflicts(a, b){
  return CONFLICTS.some(pair => pair.includes(a.id) && pair.includes(b.id) && a.id !== b.id);
}

/**
 * Every modifier id that cannot share a sky with this one. The Drawing Board
 * hands the table to a child instead of a dice roll, so it needs to know what
 * to switch OFF when they tap something - "your ship is tiny AND enormous" has
 * to be impossible to build, not merely improbable to roll.
 */
function clashesWith(id){
  const out = [];
  CONFLICTS.forEach(pair => {
    if(pair.indexOf(id) < 0) return;
    pair.forEach(other => { if(other !== id && out.indexOf(other) < 0) out.push(other); });
  });
  return out;
}

/**
 * Rolls this flight's modifiers: two, with a one-in-three chance of a third.
 * A shuffled walk that skips anything conflicting with what's already in the
 * hand, so the count survives an exclusion.
 */
function roll(){
  const bag = MODIFIERS.slice();
  for(let i = bag.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
  }
  const want = Math.random() < 0.33 ? 3 : 2;
  const out = [];
  for(const m of bag){
    if(out.length >= want) break;
    if(out.some(o => conflicts(o, m))) continue;
    out.push(m);
  }
  return out;
}

/**
 * Builds one flight. `forced` (an array of modifier ids) pins the roll - the
 * smoke test uses it to exercise every modifier deliberately rather than
 * hoping the dice cooperate.
 */
function build(forced){
  const picked = forced ? forced.map(id => MOD_BY_ID[id]).filter(Boolean) : roll();
  const mods = {};
  picked.forEach(m => mods[m.id] = true);

  // One seed draws the whole script, so the flight is one coherent roll.
  const rng = SF.core.mulberry32((Math.floor(Math.random() * 2147483646) + 1) >>> 0);
  const between = (lo, hi) => lo + rng()*(hi - lo);
  const pick = arr => arr[Math.floor(rng()*arr.length)];

  const waves = [];
  let t = 1, nextCarrier = 40, nextSurge = 62;
  while(t < MAX_SECONDS){
    const minute = Math.floor(t/60);
    const band = BANDS[Math.min(minute, BANDS.length-1)];
    const late = Math.max(0, minute - (BANDS.length-1));  // past the last band, keep growing
    const type = pick(band.types);
    const n = Math.min(15, Math.round(between(band.n[0], band.n[1])) + late);
    const opts = {};
    const eliteChance = Math.min(0.35, Math.max(0, (minute - 3) * 0.07));
    if(rng() < eliteChance) opts.elite = 1 + (rng() < 0.3 ? 1 : 0);
    waves.push(Object.assign({ t: Math.round(t*10)/10, type, n, form: pick(band.forms) }, opts));

    if(t >= nextCarrier){        // rescues stay on the menu all run long
      waves.push({ t: Math.round(t*10)/10 + 1.5, type:"carrier",
                   n: 1 + (minute >= 4 ? 1 : 0), form:"column" });
      nextCarrier += between(40, 55);
    }
    if(t >= nextSurge){          // the once-a-minute wall that spikes the pulse
      waves.push({ t: Math.round(t*10)/10 + 2.2, type:"grunt",
                   n: Math.min(15, 10 + minute), form:"wall" });
      nextSurge += between(55, 70);
    }
    t += Math.max(2.8, between(band.gap[0], band.gap[1]) - late*0.1);
  }

  return {
    id: "wacky", endless: true,
    name: "WACKY SKY",
    // The roll IS the goal line: the launch banner is the reveal card, so the
    // first thing a kid reads is what the dice gave them.
    goal: picked.map(m => m.name).join(" + ") + "!",
    subtitle: "every flight is a surprise",
    brief: "Spin the sky! Every flight rolls new surprises - fly as far as you can!",
    waves,
    mods,
    modList: picked,           // the full entries, for the results screen
    objectives: [],            // no stars - the score IS the result
  };
}

/** Any sky from the campaign's set - the backdrop is part of the roll. */
function skyIndex(){
  return Math.floor(Math.random() * SF.missions.MISSIONS.length);
}

SF.wacky = { build, roll, skyIndex, MODIFIERS, MOD_BY_ID, clashesWith };
})();
