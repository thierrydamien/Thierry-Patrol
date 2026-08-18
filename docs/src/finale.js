/*
 * THE FINALE.
 *
 * Everything that exists only for the last fight in the game: the cinematic
 * arrival, the fleet of rescued pilots that flies in to save you, and a
 * death sequence long enough to deserve the word "sequence".
 *
 * Why it lives in its own file: none of it is a boss behaviour or a renderer
 * primitive - it is *choreography*, a timeline that reaches across the world,
 * the camera and the audio for about twenty seconds total. Keeping it here
 * means bosses.js stays a fight engine and render.js stays a draw layer, and
 * the whole spectacle can be read, tuned or deleted in one place.
 *
 * Two rules the whole file obeys:
 *  - Every clock is simulation time (dt), never wall clock, so pause works.
 *  - Nothing here can hurt the player. The intro and the death are theatre;
 *    the fight in between is where the danger lives.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp, rand, TAU } = SF.core;
let { VW, VH } = SF.entityConst;
SF.field.onChange(w => { VW = w; });
const fx = SF.fx;
const audio = SF.audio;

/* ---------------------------------------------------------
   THE ARRIVAL
   Four beats: the star dies, the shape comes down out of the
   dark, it lights up section by section, and it is named.
   --------------------------------------------------------- */
const INTRO_BEATS = [
  { id:"dark",  dur: 2.2 },   // black. one line of text. no ship, no HUD.
  { id:"rise",  dur: 3.4 },   // it descends, filling the sky
  { id:"power", dur: 2.4 },   // running lights come on in sequence, eye opens
  { id:"name",  dur: 2.6 },   // THE DEVOURER
];
const INTRO_TOTAL = INTRO_BEATS.reduce((n, b) => n + b.dur, 0);

let intro = null;     // { t, beat, said }
let fleet = [];       // the rescued pilots, in phase five
let death = null;     // { t, stage, plates:[...] }

function reset(){ intro = null; fleet = []; death = null; summoned = false; flyoff = false; }

function beginIntro(){
  intro = { t: 0, beat: 0, flashed: false };
  audio.play("devourerWake");
  return intro;
}
function introActive(){ return !!intro; }
/** 0..1 across the whole arrival - drives the letterbox and the darkness. */
function introProgress(){ return intro ? clamp(intro.t / INTRO_TOTAL, 0, 1) : 1; }
function introBeat(){
  if(!intro) return null;
  let t = intro.t;
  for(let i = 0; i < INTRO_BEATS.length; i++){
    if(t < INTRO_BEATS[i].dur) return { id: INTRO_BEATS[i].id, k: t / INTRO_BEATS[i].dur, i };
    t -= INTRO_BEATS[i].dur;
  }
  return null;
}

function updateIntro(dt, boss){
  if(!intro) return false;
  const before = introBeat();
  intro.t += dt;
  const beat = introBeat();

  // The boss flies its own entrance during "rise": from far above the screen
  // down to its station, slow and heavy, so its size lands.
  if(boss){
    if(!beat || beat.i >= 1){
      const k = beat && beat.id === "rise" ? beat.k : 1;
      boss.y = -boss.size*1.1 + (boss.targetY + boss.size*1.1) * easeOutCubic(k);
      boss.entering = false;      // finale.js owns the arrival, not bosses.js
    } else {
      boss.y = -boss.size*1.4;
    }
  }

  // Beat changes get their own punctuation.
  if(beat && (!before || before.id !== beat.id)){
    if(beat.id === "rise"){ audio.play("devourerRise"); fx.shake(6); }
    if(beat.id === "power"){ audio.play("devourerPower"); }
    if(beat.id === "name"){
      audio.play("devourerRoar");
      fx.shake(26);
      fx.flash(0.55, "255,60,80");
    }
  }
  // A heartbeat of shake through the descent - the room shakes, not the ship.
  if(beat && beat.id === "rise") fx.shake(2 + beat.k*6);

  if(intro.t >= INTRO_TOTAL){ intro = null; return true; }   // done
  return false;
}

function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

/* ---------------------------------------------------------
   THE FLEET
   Phase five: the rest of the household flies in to finish it
   with you. Mechanically they are a damage assist and a
   breather; emotionally they are the whole family paying the
   campaign off in one shot.
   --------------------------------------------------------- */
let summoned = false;   // one summons per fight, even if the household is empty
let flyoff = false;     // the end: everyone leaves the sky together

function summonFleet(world, profile){
  if(summoned) return fleet;
  summoned = true;
  const P = SF.profile;
  // Only the real squadron: the other pilots of this household, under their
  // own names, colours and builds. No invented wingmen - the customer was
  // explicit ("no made up planes"), and they're right: a made-up name in the
  // family's finest moment would mean nothing to the people it's for.
  const roster = P.listNames().map(P.load)
    .filter(q => q.name !== (profile && profile.name))
    .map(q => ({ name: (q.callsign || q.name).toUpperCase(), color: q.shipColor,
                 levels: SF.shipart.levelsOf(q), decal: q.decal || null }))
    .slice(0, 6);
  if(!roster.length) return fleet;   // an empty seat is honest; no fanfare

  fleet = roster.map((r, i) => {
    const lane = (i - (roster.length-1)/2);
    return {
      name: r.name, color: r.color, levels: r.levels, decal: r.decal,
      x: VW/2 + lane*74 + rand(-10, 10), y: VH + 90 + Math.abs(lane)*40,
      homeX: clamp(VW/2 + lane*74, 46, VW-46),
      homeY: VH*0.62 + Math.abs(lane)*16 + rand(-8, 8),
      t: -i*0.16,                 // they arrive in a ragged, human stagger
      fire: rand(0.4, 1.1),
      bank: 0,
      spd: 0,                     // fly-off throttle, wound up at the end
    };
  });
  audio.play("fleetArrive");
  fx.flash(0.4, "160,220,255");
  return fleet;
}

/** The end of the mission: the family leaves the sky with you. */
function beginFlyoff(){ flyoff = true; }

function updateFleet(dt, world, timeMs){
  if(!fleet.length) return;
  const boss = world.boss;
  for(let i = 0; i < fleet.length; i++){
    const f = fleet[i];
    f.t += dt;

    // The fly-off: throttle pinned, climbing hard, in the same ragged stagger
    // they arrived in - a squadron of people, not a formation of drones.
    if(flyoff){
      f.fly = (f.fly || 0) + dt;
      if(f.fly > i*0.14){
        f.spd += 1300*dt;
        f.y -= f.spd*dt;
        f.x += (f.homeX - f.x) * Math.min(1, dt*2);
        f.bank *= Math.max(0, 1 - dt*6);
        if(f.y > -60) fx.muzzle(f.x, f.y + 18, f.color, 0.5);
      }
      continue;
    }

    if(f.t < 0) continue;
    // Fly to station, then hold formation with a little life in it.
    const tx = f.homeX + Math.sin(timeMs/900 + i)*10;
    const ty = f.homeY + Math.sin(timeMs/700 + i*1.7)*7;
    f.bank = clamp((tx - f.x)/60, -1, 1);
    f.x += (tx - f.x) * Math.min(1, dt*2.2);
    f.y += (ty - f.y) * Math.min(1, dt*2.2);

    // They shoot at the boss. Their rounds are the player's rounds, so every
    // system downstream - collisions, weak points, hit flashes - just works.
    if(!boss || !boss.alive) continue;
    f.fire -= dt;
    if(f.fire <= 0 && f.y < VH){
      f.fire = rand(0.42, 0.78);
      const b = world.bullets.spawn();
      b.x = f.x; b.y = f.y - 16; b.vx = 0; b.vy = -700;
      b.r = 4.5; b.dmg = 3; b.pierce = 0; b.homing = 0;
      b.tier = 2; b.age = 0; b.fromDrone = true; b.hitBoss = false; b.hitWeak = false;
      b.fromMirror = false; b.petal = false;   // recycled slot: state every flag
      fx.muzzle(f.x, f.y - 18, f.color, 0.7);
    }
  }
}
function fleetSize(){ return fleet.length; }

/* ---------------------------------------------------------
   THE DEATH
   Eight seconds in five stages. Nothing else in the game gets
   more than two.
   --------------------------------------------------------- */
const DEATH_STAGES = [
  { id:"plates",   dur: 2.4 },   // the armour blows off, piece by piece
  { id:"cracks",   dur: 2.0 },   // light tears out through the seams
  { id:"implode",  dur: 1.4 },   // everything falls INTO it, and it goes quiet
  { id:"blast",    dur: 0.9 },   // white out
  { id:"settle",   dur: 2.4 },   // slow debris, the star coming back
];
const DEATH_TOTAL = DEATH_STAGES.reduce((n, s) => n + s.dur, 0);

function beginDeath(boss){
  death = { t: 0, stage: null, next: 0, popped: 0 };
  audio.play("devourerDeath");
  return death;
}
function deathActive(){ return !!death; }
function deathStage(){
  if(!death) return null;
  let t = death.t;
  for(let i = 0; i < DEATH_STAGES.length; i++){
    if(t < DEATH_STAGES[i].dur) return { id: DEATH_STAGES[i].id, k: t/DEATH_STAGES[i].dur, i };
    t -= DEATH_STAGES[i].dur;
  }
  return null;
}

/** Advances the death. Returns true on the frame it finishes. */
function updateDeath(dt, boss, world){
  if(!death) return false;
  const was = deathStage();
  death.t += dt;
  const st = deathStage();
  if(!boss) { death = null; return true; }

  const bx = boss.x, by = boss.y;
  if(st && st.id === "plates"){
    boss.y += 8*dt;
    boss.x += Math.sin(death.t*5)*22*dt;
    death.next -= dt;
    if(death.next <= 0){
      death.next = 0.34;
      const wp = boss.weakPoints[death.popped % boss.weakPoints.length];
      death.popped++;
      const px = bx + wp.ox, py = by + wp.oy;
      fx.explosion(px, py, 84, "#ffb03d", true);
      fx.ring(px, py, 120, "#ffffff", 4, 0.5);
      fx.shake(14);
      fx.hitStop(60);
      audio.play("enemyExplode", true);
    }
  } else if(st && st.id === "cracks"){
    // Light tearing out of the seams: bright lances from the hull, faster
    // and brighter as it goes.
    boss.y += 4*dt;
    death.next -= dt;
    if(death.next <= 0){
      death.next = 0.16 - st.k*0.10;
      const a = rand(0, TAU), d = rand(0, boss.size*0.42);
      fx.sparks(bx + Math.cos(a)*d, by + Math.sin(a)*d*0.7, 12, "#ffffff", 320);
      fx.fireball(bx + Math.cos(a)*d, by + Math.sin(a)*d*0.7, 2, 40 + st.k*40);
      fx.shake(6 + st.k*10);
      if(st.k > 0.5) audio.play("enemyExplode", false);
    }
  } else if(st && st.id === "implode"){
    // Everything reverses: debris and bullets fall INTO the hull, and the
    // sound drops away. The held breath before the bang.
    if(was && was.id !== "implode") audio.play("devourerImplode");
    const items = world.enemyBullets.items;
    for(let i = 0; i < items.length; i++){
      const b = items[i];
      if(!b.alive) continue;
      const dx = bx - b.x, dy = by - b.y, l = Math.max(30, Math.hypot(dx, dy));
      b.vx += dx/l * 900 * dt; b.vy += dy/l * 900 * dt;
      if(l < 60) b.alive = false;
    }
    boss.wobble = 10 + st.k*14;
  } else if(st && st.id === "blast"){
    if(was && was.id !== "blast"){
      // THE moment. Everything at once, and the sky is cleared.
      fx.flash(1, "255,255,255");
      fx.hitStop(240);
      fx.shake(46);
      audio.play("megaBoom");
      audio.play("devourerFinalBlast");
      for(let r = 0; r < 5; r++)
        fx.ring(bx, by, boss.size*(1.4 + r*0.85), r%2 ? "#ffd23f" : "#ffffff", 6 - r, 0.7 + r*0.22);
      fx.explosion(bx, by, boss.size*1.6, "#ffffff", true);
      for(let i = 0; i < 10; i++){
        const a = (TAU/10)*i;
        fx.explosion(bx + Math.cos(a)*boss.size*0.42, by + Math.sin(a)*boss.size*0.34,
                     70, i%2 ? "#ffd23f" : "#ff8a3d", true);
      }
      fx.debris(bx, by, 46, "#ff8a3d");
      fx.embers(bx, by, 40);
      fx.smoke(bx, by, 20);
      world.enemyBullets.killAll();
      const es = world.enemies.items;
      for(let i = 0; i < es.length; i++){
        if(!es[i].alive) continue;
        es[i].alive = false;
        fx.explosion(es[i].x, es[i].y, es[i].size || 22, "#ffb03d", false);
      }
    }
  } else if(st && st.id === "settle"){
    // Quiet. Embers falling, and the fleet holding station around you.
    death.next -= dt;
    if(death.next <= 0){
      death.next = rand(0.12, 0.3);
      fx.embers(rand(40, VW-40), rand(60, VH*0.5), 3);
    }
  }

  if(death.t >= DEATH_TOTAL){ death = null; return true; }
  return false;
}

SF.finale = {
  reset, beginIntro, introActive, introProgress, introBeat, updateIntro, INTRO_TOTAL,
  summonFleet, updateFleet, fleetSize, fleetList: () => fleet, beginFlyoff,
  beginDeath, deathActive, deathStage, updateDeath, DEATH_TOTAL,
};
})();
