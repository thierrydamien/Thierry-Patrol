/*
 * The Daily Patrol: an endless, procedurally generated mission that is THE
 * SAME for everyone on the same day. One seed per calendar day feeds the
 * deterministic RNG in core.js, so both brothers - and every device - fly an
 * identical sky, and the only variable left is who flies it better. That's
 * the whole design: a fair fight over one number.
 *
 * The script escalates in one-minute bands: each band widens the enemy pool,
 * tightens the wave gap and grows the formations, and from the fourth minute
 * elites start salting the waves. A carrier is forced in roughly every 45
 * seconds so rescues (and their pay) stay part of the run. The script is cut
 * at 25 minutes - if a kid outlives it, the mission completes outright and
 * they have earned the roll of credits.
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

function hash(str){
  let a = 0;
  for(let i = 0; i < str.length; i++) a = ((a << 5) - a + str.charCodeAt(i)) | 0;
  return Math.abs(a) || 1;
}

/** Matches the daily-double key, so "today" flips at the same midnight. */
function todayKey(){ return new Date().toDateString(); }

function build(key){
  const dayKey = key || todayKey();
  const rng = SF.core.mulberry32(hash(dayKey));
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
    id: "daily", endless: true,
    name: "Daily Patrol", subtitle: "Same sky for everyone - today only",
    brief: "Today's sky is the same for the whole squadron. Fly as far as you can - highest score holds the record!",
    waves,
    objectives: [],           // no stars - the score IS the result
  };
}

/** A stable sky for the day, drawn from the campaign's set. */
function skyIndex(key){
  return hash(key || todayKey()) % SF.missions.MISSIONS.length;
}

SF.daily = { build, todayKey, skyIndex, hash };
})();
