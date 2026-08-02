/*
 * Enemy archetypes and formation shapes.
 *
 * An archetype is pure data plus a named movement behaviour. Adding a new
 * enemy means adding an entry here and (only if it moves in a genuinely new
 * way) a function in BEHAVIOURS - no changes anywhere else in the game.
 *
 * Behaviours receive (e, dt, ctxObj) where ctxObj carries the player position,
 * the difficulty tier and the playfield size, so they can be smart without
 * reaching into globals.
 */
(function(){
"use strict";
const SF = window.SF;
const { clamp, lerp, rand, randInt } = SF.core;

/* ---------------------------------------------------------
   MOVEMENT BEHAVIOURS
   Each returns nothing; it just mutates the enemy.
   --------------------------------------------------------- */
const BEHAVIOURS = {
  /** Straight down. The bread and butter. */
  dive(e, dt){
    e.y += e.vy * dt;
    e.x += e.vx * dt;
  },

  /** Sine weave across its entry column. */
  weave(e, dt, c){
    e.phase += dt * e.weaveSpeed;
    e.y += e.vy * dt;
    e.x = e.anchorX + Math.sin(e.phase) * e.weaveWidth;
    e.x = clamp(e.x, 24, c.VW - 24);
  },

  /** Drops to a hover line, holds station and shoots, then leaves. */
  hover(e, dt, c){
    if(e.state === 0){
      e.y += e.vy * dt;
      if(e.y >= e.hoverY){ e.y = e.hoverY; e.state = 1; e.stateTimer = e.hoverTime; }
    } else if(e.state === 1){
      e.x += Math.sin(e.phase += dt * 1.2) * 40 * dt;
      e.stateTimer -= dt;
      if(e.stateTimer <= 0) e.state = 2;
    } else {
      e.y += e.vy * 1.3 * dt;
    }
  },

  /** Swoops at the player's column, then dives past. Smart tiers lead the target. */
  swoop(e, dt, c){
    if(e.y < e.hoverY){
      e.y += e.vy * dt;
      const target = c.player ? c.player.x : c.VW/2;
      e.x = lerp(e.x, target, Math.min(1, dt * (0.9 + c.smart * 0.5)));
    } else {
      e.y += e.vy * 1.5 * dt;
      e.x += e.vx * dt;
    }
  },

  /** Accelerates straight at wherever the player was when it locked on. */
  kamikaze(e, dt, c){
    if(!e.locked && e.y > 40 && c.player){
      e.lockX = c.player.x; e.lockY = c.player.y; e.locked = true;
      const dx = e.lockX - e.x, dy = Math.max(40, e.lockY - e.y);
      const l = Math.hypot(dx, dy);
      e.vx = dx/l * e.speed * 1.5;
      e.vy = dy/l * e.speed * 1.5;
    }
    e.speedMul = Math.min(2.2, (e.speedMul || 1) + dt * 0.7);
    e.x += e.vx * e.speedMul * dt;
    e.y += e.vy * e.speedMul * dt;
  },

  /** Slides in from a side, parks near the top edge and shells the playfield. */
  turret(e, dt, c){
    if(e.state === 0){
      e.y += e.vy * dt;
      if(e.y >= e.hoverY){ e.y = e.hoverY; e.state = 1; }
    } else {
      e.x += e.vx * dt;
      if(e.x < 44 || e.x > c.VW - 44) e.vx *= -1;
    }
  },

  /** Big, slow, and on smarter tiers it strafes away from your fire. */
  brute(e, dt, c){
    e.y += e.vy * dt;
    if(c.smart >= 1 && c.player){
      const away = e.x < c.player.x ? -1 : 1;
      e.x = clamp(e.x + away * 34 * c.smart * dt, 34, c.VW - 34);
    }
  },

  /** Carries a rescue pod - flees toward the bottom, so you must hurry. */
  carrier(e, dt, c){
    e.y += e.vy * dt;
    e.x += Math.sin(e.phase += dt) * 28 * dt;
  },
};

/* ---------------------------------------------------------
   ARCHETYPES
   hp/score/money are base values; difficulty scales them.
   fire: null, or { pattern, every:[min,max], speed, count }
   --------------------------------------------------------- */
const ENEMY_TYPES = {
  grunt: {
    name:"Grunt", behaviour:"dive", hp:1, r:13, size:42, speed:138,
    score:5, money:6, tint:null,
    fire:{ pattern:"straight", every:[2.4,4.0], speed:255 },
  },
  weaver: {
    name:"Weaver", behaviour:"weave", hp:1, r:13, size:42, speed:120,
    score:7, money:7, tint:"#ff9d4a",
    fire:{ pattern:"straight", every:[2.6,4.2], speed:245 },
  },
  striker: {
    name:"Striker", behaviour:"hover", hp:2, r:15, size:46, speed:162,
    score:10, money:10, tint:"#a855f7",
    fire:{ pattern:"aimed", every:[1.4,2.2], speed:280 },
  },
  swooper: {
    name:"Swooper", behaviour:"swoop", hp:2, r:15, size:44, speed:188,
    score:12, money:11, tint:"#4ade80",
    fire:{ pattern:"straight", every:[2.0,3.2], speed:268 },
  },
  kamikaze: {
    name:"Kamikaze", behaviour:"kamikaze", hp:1, r:13, size:40, speed:212,
    score:14, money:13, tint:"#ff2d55", fire:null,
  },
  turret: {
    name:"Gun Platform", behaviour:"turret", hp:5, r:20, size:62, speed:88,
    score:24, money:24, tint:"#60a5fa",
    fire:{ pattern:"spread3", every:[1.8,2.6], speed:245 },
  },
  brute: {
    name:"Brute", behaviour:"brute", hp:6, r:21, size:64, speed:88,
    score:26, money:26, tint:"#f43f5e",
    fire:{ pattern:"spread3", every:[2.2,3.4], speed:232 },
  },
  carrier: {
    name:"Prison Hauler", behaviour:"carrier", hp:8, r:23, size:72, speed:76,
    score:40, money:42, tint:"#facc15", carriesRescue:true,
    fire:{ pattern:"straight", every:[2.6,3.6], speed:220 },
  },
};

/**
 * Elite variant: any archetype can be promoted. Elites are tougher, glow, are
 * worth far more, and always drop something - they're the "kill this one"
 * target that makes a wave interesting.
 */
const ELITE = { hpMult: 3.5, scoreMult: 4, moneyMult: 4, sizeMult: 1.18, speedMult: 0.9 };

/* ---------------------------------------------------------
   FORMATIONS
   A formation places N enemies relative to an anchor. Waves in
   the mission data pick a shape by name.
   Each returns an array of {x, y, delay}.
   --------------------------------------------------------- */
const MARGIN = 50;   // no formation puts an enemy closer than this to an edge

const FORMATIONS = {
  /** Evenly spaced rank across most of the width. */
  line(n, VW){
    const usable = VW - MARGIN*2;
    const gap = Math.min(84, usable / Math.max(1, n - 1));
    const startX = VW/2 - gap*(n-1)/2;
    return Array.from({length:n}, (_,i) => ({ x: startX + i*gap, y: -40, delay: i*0.07 }));
  },
  /** Classic arrowhead. Wider field = wider wings, so it threatens more lanes. */
  vee(n, VW){
    const gap = 62, out = [];
    for(let i = 0; i < n; i++){
      const side = i % 2 === 0 ? -1 : 1;
      const rank = Math.floor(i/2) + 1;
      out.push({ x: clamp(VW/2 + side*rank*gap*0.75, MARGIN, VW-MARGIN),
                 y: -40 - rank*32, delay: i*0.06 });
    }
    return out;
  },
  /** Bowed rank - the middle arrives later, so it sweeps you outward. */
  arc(n, VW){
    return Array.from({length:n}, (_,i) => {
      const t = n === 1 ? 0.5 : i/(n-1);
      return { x: MARGIN + t*(VW-MARGIN*2), y: -40 - Math.sin(t*Math.PI)*72, delay: i*0.08 };
    });
  },
  /** Single file down one lane. */
  column(n, VW){
    const x = rand(MARGIN+30, VW-MARGIN-30);
    return Array.from({length:n}, (_,i) => ({ x, y: -40 - i*66, delay: i*0.11 }));
  },
  /** Two lanes, wide apart - you have to pick a side and commit. */
  twinColumns(n, VW){
    return Array.from({length:n}, (_,i) => ({
      x: i % 2 === 0 ? VW*0.24 : VW*0.76,
      y: -40 - Math.floor(i/2)*64, delay: i*0.09,
    }));
  },
  /** Three lanes - only possible now there's width for it. */
  tripleColumns(n, VW){
    const lanes = [VW*0.18, VW*0.5, VW*0.82];
    return Array.from({length:n}, (_,i) => ({
      x: lanes[i % 3], y: -40 - Math.floor(i/3)*62, delay: i*0.08,
    }));
  },
  /** Hugging both edges, squeezing you toward the middle. */
  sides(n, VW){
    return Array.from({length:n}, (_,i) => ({
      x: i % 2 === 0 ? MARGIN : VW-MARGIN,
      y: -40 - Math.floor(i/2)*58, delay: i*0.12,
    }));
  },
  /** A solid wall with one deliberate gap - find it and fly through. */
  wall(n, VW){
    const gapIndex = randInt(1, Math.max(1, n-2));
    const usable = VW - MARGIN*2;
    const step = usable / Math.max(1, n-1);
    const out = [];
    for(let i = 0; i < n; i++){
      if(i === gapIndex) continue;                 // the hole
      out.push({ x: MARGIN + i*step, y: -40, delay: 0.04*i });
    }
    // Keep the requested count by putting the spare enemy behind the wall.
    out.push({ x: MARGIN + gapIndex*step, y: -150, delay: 0.9 });
    return out;
  },
  /** Two diagonal streams crossing the middle - lots of lateral motion. */
  pincer(n, VW){
    return Array.from({length:n}, (_,i) => {
      const side = i % 2 === 0 ? 0 : 1;
      const rank = Math.floor(i/2);
      return { x: side ? VW - MARGIN - rank*26 : MARGIN + rank*26,
               y: -40 - rank*40, delay: i*0.09 };
    });
  },
  /** Loose spread over the whole width and some depth. */
  scatter(n, VW){
    return Array.from({length:n}, (_,i) => ({
      x: rand(MARGIN, VW-MARGIN), y: -40 - rand(0,190), delay: i*0.14,
    }));
  },
};

SF.enemyData = { BEHAVIOURS, ENEMY_TYPES, ELITE, FORMATIONS };
})();
